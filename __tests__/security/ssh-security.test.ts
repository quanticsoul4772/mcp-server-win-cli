import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { KnownHostsManager } from '../../src/utils/knownHosts.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/**
 * Security Test Suite: SSH Host Key Verification
 *
 * This test suite covers SSH security mechanisms including:
 * - Trust On First Use (TOFU) host key verification
 * - Host key change detection (MITM protection)
 * - Strict vs permissive host key checking
 * - Key fingerprint validation
 * - Concurrent access safety
 * - Known hosts persistence
 *
 * References:
 * - RFC 4251: SSH Protocol Architecture
 * - RFC 4253: SSH Transport Layer Protocol
 * - Trust On First Use (TOFU): https://en.wikipedia.org/wiki/Trust_on_first_use
 * - SSH Security Best Practices: https://www.ssh.com/academy/ssh/security
 */

describe('SSH Host Key Verification Security', () => {
  let tempDir: string;
  let knownHostsPath: string;
  let manager: KnownHostsManager;

  beforeEach(async () => {
    // Create temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-test-'));
    knownHostsPath = path.join(tempDir, 'known_hosts.json');
    manager = new KnownHostsManager(knownHostsPath);
    await manager.initialize();
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to create a mock SSH public key buffer
   * SSH keys have format: [length][algorithm][...key data]
   */
  function createMockSSHKey(algorithm: string = 'ssh-rsa', keyData?: Buffer): Buffer {
    const algBuffer = Buffer.from(algorithm);
    const algLength = Buffer.alloc(4);
    algLength.writeUInt32BE(algBuffer.length, 0);

    const data = keyData || crypto.randomBytes(256); // Random key data
    const dataLength = Buffer.alloc(4);
    dataLength.writeUInt32BE(data.length, 0);

    return Buffer.concat([algLength, algBuffer, dataLength, data]);
  }

  describe('Trust On First Use (TOFU) Mode', () => {
    test('should accept new host in TOFU mode (strictMode=false)', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      const result = await manager.verifyHostKey(
        'example.com',
        22,
        undefined,
        hostKey,
        false // TOFU mode
      );

      expect(result.accepted).toBe(true);
      expect(result.reason).toMatch(/accepted.*TOFU/i);
      expect(result.reason).toMatch(/example\.com:22/);
    });

    test('should store host key on first connection in TOFU mode', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('test.example.com', 22, undefined, hostKey, false);

      // Verify it was stored
      const entry = await manager.getHostEntry('test.example.com', 22);
      expect(entry).not.toBeNull();
      expect(entry?.algorithm).toBe('ssh-ed25519');
      expect(entry?.fingerprint).toMatch(/^SHA256:/);
    });

    test('should include timestamps on first connection', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');
      const beforeTime = new Date();

      await manager.verifyHostKey('timestamped.example.com', 22, undefined, hostKey, false);

      const entry = await manager.getHostEntry('timestamped.example.com', 22);
      expect(entry).not.toBeNull();

      const firstSeen = new Date(entry!.firstSeen);
      const lastSeen = new Date(entry!.lastSeen);

      expect(firstSeen.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(lastSeen.getTime()).toBeGreaterThanOrEqual(firstSeen.getTime());
    });

    test('should persist host key to file system', async () => {
      const hostKey = createMockSSHKey('ssh-rsa');

      await manager.verifyHostKey('persist.example.com', 22, undefined, hostKey, false);

      // Read file directly
      const fileContent = await fs.readFile(knownHostsPath, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data['persist.example.com:22']).toBeDefined();
      expect(data['persist.example.com:22'].algorithm).toBe('ssh-rsa');
    });

    test('should accept same key on subsequent connections', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      // First connection
      await manager.verifyHostKey('repeat.example.com', 22, undefined, hostKey, false);

      // Second connection with same key
      const result = await manager.verifyHostKey('repeat.example.com', 22, undefined, hostKey, false);

      expect(result.accepted).toBe(true);
      expect(result.reason).toMatch(/verified successfully/i);
    });

    test('should update lastSeen timestamp on repeated connections', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      // First connection
      await manager.verifyHostKey('timestamp-update.example.com', 22, undefined, hostKey, false);
      const firstEntry = await manager.getHostEntry('timestamp-update.example.com', 22);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second connection
      await manager.verifyHostKey('timestamp-update.example.com', 22, undefined, hostKey, false);
      const secondEntry = await manager.getHostEntry('timestamp-update.example.com', 22);

      expect(secondEntry!.firstSeen).toBe(firstEntry!.firstSeen); // Should not change
      expect(new Date(secondEntry!.lastSeen).getTime()).toBeGreaterThan(
        new Date(firstEntry!.lastSeen).getTime()
      ); // Should be updated
    });
  });

  describe('Strict Mode Host Key Checking', () => {
    test('should reject unknown host in strict mode (strictMode=true)', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      const result = await manager.verifyHostKey(
        'unknown.example.com',
        22,
        undefined,
        hostKey,
        true // Strict mode
      );

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/unknown host/i);
      expect(result.reason).toMatch(/unknown\.example\.com:22/);
    });

    test('should not store host key when rejected in strict mode', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('rejected.example.com', 22, undefined, hostKey, true);

      // Verify it was NOT stored
      const entry = await manager.getHostEntry('rejected.example.com', 22);
      expect(entry).toBeNull();
    });

    test('should accept known host in strict mode', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      // First, add the host in TOFU mode
      await manager.verifyHostKey('known.example.com', 22, undefined, hostKey, false);

      // Now try in strict mode
      const result = await manager.verifyHostKey('known.example.com', 22, undefined, hostKey, true);

      expect(result.accepted).toBe(true);
      expect(result.reason).toMatch(/verified successfully/i);
    });

    test('should suggest TOFU mode in rejection message', async () => {
      const hostKey = createMockSSHKey('ssh-ed25519');

      const result = await manager.verifyHostKey('suggest.example.com', 22, undefined, hostKey, true);

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/TOFU/i);
      expect(result.reason).toMatch(/strictHostKeyChecking.*false/i);
    });
  });

  describe('Host Key Change Detection (MITM Protection)', () => {
    test('should detect when host key changes', async () => {
      const originalKey = createMockSSHKey('ssh-ed25519');
      const differentKey = createMockSSHKey('ssh-ed25519'); // Different random key

      // First connection with original key
      await manager.verifyHostKey('mitm.example.com', 22, undefined, originalKey, false);

      // Second connection with different key - MITM attack!
      const result = await manager.verifyHostKey('mitm.example.com', 22, undefined, differentKey, false);

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/HOST KEY MISMATCH/i);
      expect(result.reason).toMatch(/MITM/i);
    });

    test('should include fingerprints in MITM warning', async () => {
      const originalKey = createMockSSHKey('ssh-ed25519');
      const differentKey = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('fingerprint-check.example.com', 22, undefined, originalKey, false);
      const result = await manager.verifyHostKey('fingerprint-check.example.com', 22, undefined, differentKey, false);

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/Expected.*SHA256/);
      expect(result.reason).toMatch(/Got.*SHA256/);
      expect(result.reason).not.toMatch(/Expected.*Got.*SHA256:.*SHA256:/); // Should have different hashes
    });

    test('should detect algorithm change as MITM attack', async () => {
      const rsaKey = createMockSSHKey('ssh-rsa');
      const ed25519Key = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('algo-change.example.com', 22, undefined, rsaKey, false);
      const result = await manager.verifyHostKey('algo-change.example.com', 22, undefined, ed25519Key, false);

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/mismatch/i);
    });

    test('should not update stored key on MITM detection', async () => {
      const originalKey = createMockSSHKey('ssh-ed25519');
      const attackerKey = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('no-update.example.com', 22, undefined, originalKey, false);
      const beforeEntry = await manager.getHostEntry('no-update.example.com', 22);

      // MITM attempt
      await manager.verifyHostKey('no-update.example.com', 22, undefined, attackerKey, false);
      const afterEntry = await manager.getHostEntry('no-update.example.com', 22);

      // Key should remain unchanged
      expect(afterEntry?.key).toBe(beforeEntry?.key);
      expect(afterEntry?.fingerprint).toBe(beforeEntry?.fingerprint);
    });

    test('should provide guidance on resolving legitimate key changes', async () => {
      const oldKey = createMockSSHKey('ssh-ed25519');
      const newKey = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('legit-change.example.com', 22, undefined, oldKey, false);
      const result = await manager.verifyHostKey('legit-change.example.com', 22, undefined, newKey, false);

      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/manually remove/i);
      expect(result.reason).toMatch(/known_hosts/i);
    });
  });

  describe('Multiple Hosts and Ports', () => {
    test('should track different ports separately', async () => {
      const key22 = createMockSSHKey('ssh-ed25519');
      const key2222 = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('multi-port.example.com', 22, undefined, key22, false);
      await manager.verifyHostKey('multi-port.example.com', 2222, undefined, key2222, false);

      const entry22 = await manager.getHostEntry('multi-port.example.com', 22);
      const entry2222 = await manager.getHostEntry('multi-port.example.com', 2222);

      expect(entry22).not.toBeNull();
      expect(entry2222).not.toBeNull();
      expect(entry22?.key).not.toBe(entry2222?.key);
    });

    test('should not confuse hosts with same port', async () => {
      const key1 = createMockSSHKey('ssh-ed25519');
      const key2 = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('host1.example.com', 22, undefined, key1, false);
      await manager.verifyHostKey('host2.example.com', 22, undefined, key2, false);

      const entry1 = await manager.getHostEntry('host1.example.com', 22);
      const entry2 = await manager.getHostEntry('host2.example.com', 22);

      expect(entry1?.key).not.toBe(entry2?.key);
    });

    test('should handle IP addresses separately from hostnames', async () => {
      const hostnameKey = createMockSSHKey('ssh-ed25519');
      const ipKey = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('example.com', 22, undefined, hostnameKey, false);
      await manager.verifyHostKey('192.168.1.1', 22, undefined, ipKey, false);

      const hostnameEntry = await manager.getHostEntry('example.com', 22);
      const ipEntry = await manager.getHostEntry('192.168.1.1', 22);

      expect(hostnameEntry).not.toBeNull();
      expect(ipEntry).not.toBeNull();
      // These are separate entries
    });
  });

  describe('Key Fingerprint Calculation', () => {
    test('should calculate consistent SHA256 fingerprints', async () => {
      const key = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('fingerprint.example.com', 22, undefined, key, false);
      const entry = await manager.getHostEntry('fingerprint.example.com', 22);

      expect(entry?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/=]+$/);
    });

    test('should produce different fingerprints for different keys', async () => {
      const key1 = createMockSSHKey('ssh-ed25519');
      const key2 = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('fp1.example.com', 22, undefined, key1, false);
      await manager.verifyHostKey('fp2.example.com', 22, undefined, key2, false);

      const entry1 = await manager.getHostEntry('fp1.example.com', 22);
      const entry2 = await manager.getHostEntry('fp2.example.com', 22);

      expect(entry1?.fingerprint).not.toBe(entry2?.fingerprint);
    });

    test('should produce same fingerprint for same key data', async () => {
      const keyData = crypto.randomBytes(256);
      const key1 = createMockSSHKey('ssh-ed25519', keyData);
      const key2 = createMockSSHKey('ssh-ed25519', keyData);

      await manager.verifyHostKey('same-fp1.example.com', 22, undefined, key1, false);
      await manager.verifyHostKey('same-fp2.example.com', 22, undefined, key2, false);

      const entry1 = await manager.getHostEntry('same-fp1.example.com', 22);
      const entry2 = await manager.getHostEntry('same-fp2.example.com', 22);

      expect(entry1?.fingerprint).toBe(entry2?.fingerprint);
    });
  });

  describe('Algorithm Detection', () => {
    test('should detect ssh-rsa algorithm', async () => {
      const key = createMockSSHKey('ssh-rsa');

      await manager.verifyHostKey('rsa.example.com', 22, undefined, key, false);
      const entry = await manager.getHostEntry('rsa.example.com', 22);

      expect(entry?.algorithm).toBe('ssh-rsa');
    });

    test('should detect ssh-ed25519 algorithm', async () => {
      const key = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('ed25519.example.com', 22, undefined, key, false);
      const entry = await manager.getHostEntry('ed25519.example.com', 22);

      expect(entry?.algorithm).toBe('ssh-ed25519');
    });

    test('should detect ecdsa-sha2-nistp256 algorithm', async () => {
      const key = createMockSSHKey('ecdsa-sha2-nistp256');

      await manager.verifyHostKey('ecdsa.example.com', 22, undefined, key, false);
      const entry = await manager.getHostEntry('ecdsa.example.com', 22);

      expect(entry?.algorithm).toBe('ecdsa-sha2-nistp256');
    });

    test('should handle malformed key gracefully', async () => {
      const malformedKey = Buffer.from('invalid key data');

      const result = await manager.verifyHostKey('malformed.example.com', 22, undefined, malformedKey, false);

      // Should still work, but algorithm might be 'unknown'
      expect(result.accepted).toBe(true);
      const entry = await manager.getHostEntry('malformed.example.com', 22);
      expect(entry?.algorithm).toBeDefined();
    });
  });

  describe('Concurrent Access Safety', () => {
    test('should handle concurrent verifications safely', async () => {
      const keys = Array(10).fill(0).map(() => createMockSSHKey('ssh-ed25519'));

      // Simulate 10 concurrent connections to different hosts
      const promises = keys.map((key, i) =>
        manager.verifyHostKey(`concurrent${i}.example.com`, 22, undefined, key, false)
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(result => {
        expect(result.accepted).toBe(true);
      });

      // All should be stored
      for (let i = 0; i < 10; i++) {
        const entry = await manager.getHostEntry(`concurrent${i}.example.com`, 22);
        expect(entry).not.toBeNull();
      }
    });

    test('should handle concurrent updates to same host safely', async () => {
      const key = createMockSSHKey('ssh-ed25519');

      // Add host first
      await manager.verifyHostKey('concurrent-same.example.com', 22, undefined, key, false);

      // Now do 10 concurrent verifications of the same host
      const promises = Array(10).fill(0).map(() =>
        manager.verifyHostKey('concurrent-same.example.com', 22, undefined, key, false)
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(result => {
        expect(result.accepted).toBe(true);
      });

      // Should still have single entry
      const entry = await manager.getHostEntry('concurrent-same.example.com', 22);
      expect(entry).not.toBeNull();
    });
  });

  describe('Persistence and Reload', () => {
    test('should persist across manager instances', async () => {
      const key = createMockSSHKey('ssh-ed25519');

      // First manager instance
      await manager.verifyHostKey('persist-reload.example.com', 22, undefined, key, false);

      // Create new manager instance pointing to same file
      const newManager = new KnownHostsManager(knownHostsPath);
      await newManager.initialize();

      // Should find the host
      const entry = await newManager.getHostEntry('persist-reload.example.com', 22);
      expect(entry).not.toBeNull();
      expect(entry?.algorithm).toBe('ssh-ed25519');
    });

    test('should maintain security after reload', async () => {
      const originalKey = createMockSSHKey('ssh-ed25519');
      const differentKey = createMockSSHKey('ssh-ed25519');

      // First manager: add host
      await manager.verifyHostKey('reload-security.example.com', 22, undefined, originalKey, false);

      // New manager: try different key
      const newManager = new KnownHostsManager(knownHostsPath);
      await newManager.initialize();
      const result = await newManager.verifyHostKey('reload-security.example.com', 22, undefined, differentKey, false);

      // Should still detect mismatch
      expect(result.accepted).toBe(false);
      expect(result.reason).toMatch(/mismatch/i);
    });
  });

  describe('Host Removal', () => {
    test('should allow removing a host entry', async () => {
      const key = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('remove-me.example.com', 22, undefined, key, false);
      expect(await manager.getHostEntry('remove-me.example.com', 22)).not.toBeNull();

      await manager.removeHost('remove-me.example.com', 22);
      expect(await manager.getHostEntry('remove-me.example.com', 22)).toBeNull();
    });

    test('should allow re-adding host after removal', async () => {
      const oldKey = createMockSSHKey('ssh-ed25519');
      const newKey = createMockSSHKey('ssh-ed25519');

      // Add with old key
      await manager.verifyHostKey('readd.example.com', 22, undefined, oldKey, false);

      // Remove
      await manager.removeHost('readd.example.com', 22);

      // Add with new key (simulating legitimate key rotation)
      const result = await manager.verifyHostKey('readd.example.com', 22, undefined, newKey, false);

      expect(result.accepted).toBe(true);
      const entry = await manager.getHostEntry('readd.example.com', 22);
      expect(entry?.key).toBe(newKey.toString('base64'));
    });

    test('should not affect other hosts when removing one', async () => {
      const key1 = createMockSSHKey('ssh-ed25519');
      const key2 = createMockSSHKey('ssh-ed25519');

      await manager.verifyHostKey('keep.example.com', 22, undefined, key1, false);
      await manager.verifyHostKey('remove.example.com', 22, undefined, key2, false);

      await manager.removeHost('remove.example.com', 22);

      expect(await manager.getHostEntry('keep.example.com', 22)).not.toBeNull();
      expect(await manager.getHostEntry('remove.example.com', 22)).toBeNull();
    });
  });

  describe('Get All Hosts', () => {
    test('should return all stored hosts', async () => {
      const hosts = [
        { name: 'host1.example.com', port: 22 },
        { name: 'host2.example.com', port: 22 },
        { name: 'host3.example.com', port: 2222 }
      ];

      for (const host of hosts) {
        const key = createMockSSHKey('ssh-ed25519');
        await manager.verifyHostKey(host.name, host.port, undefined, key, false);
      }

      const allHosts = await manager.getAllHosts();

      expect(Object.keys(allHosts).length).toBe(3);
      expect(allHosts['host1.example.com:22']).toBeDefined();
      expect(allHosts['host2.example.com:22']).toBeDefined();
      expect(allHosts['host3.example.com:2222']).toBeDefined();
    });

    test('should return empty object for new manager', async () => {
      const allHosts = await manager.getAllHosts();
      expect(allHosts).toEqual({});
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty key buffer', async () => {
      const emptyKey = Buffer.alloc(0);

      const result = await manager.verifyHostKey('empty-key.example.com', 22, undefined, emptyKey, false);

      // Should handle gracefully
      expect(result).toBeDefined();
      expect(result.accepted).toBeDefined();
    });

    test('should handle very long hostname', async () => {
      const longHostname = 'a'.repeat(253) + '.example.com'; // Max DNS name length
      const key = createMockSSHKey('ssh-ed25519');

      const result = await manager.verifyHostKey(longHostname, 22, undefined, key, false);

      expect(result.accepted).toBe(true);
    });

    test('should handle non-standard ports', async () => {
      const key = createMockSSHKey('ssh-ed25519');

      const result = await manager.verifyHostKey('custom-port.example.com', 65535, undefined, key, false);

      expect(result.accepted).toBe(true);
      const entry = await manager.getHostEntry('custom-port.example.com', 65535);
      expect(entry).not.toBeNull();
    });

    test('should handle special characters in hostname', async () => {
      const hostname = 'test-host_123.example.com';
      const key = createMockSSHKey('ssh-ed25519');

      const result = await manager.verifyHostKey(hostname, 22, undefined, key, false);

      expect(result.accepted).toBe(true);
    });

    test('should provide path to known_hosts file', () => {
      const path = manager.getKnownHostsPath();
      expect(path).toBe(knownHostsPath);
    });
  });

  describe('Real-World Attack Scenarios', () => {
    test('should prevent SSH MITM attack scenario', async () => {
      const legitimateKey = createMockSSHKey('ssh-ed25519');
      const attackerKey = createMockSSHKey('ssh-ed25519');

      // User connects to server for the first time (TOFU)
      const firstConnection = await manager.verifyHostKey('bank.example.com', 22, undefined, legitimateKey, false);
      expect(firstConnection.accepted).toBe(true);

      // Attacker performs MITM attack, presenting different key
      const mitm = await manager.verifyHostKey('bank.example.com', 22, undefined, attackerKey, false);

      // Attack should be detected and blocked
      expect(mitm.accepted).toBe(false);
      expect(mitm.reason).toMatch(/MITM/i);
      expect(mitm.reason).toMatch(/mismatch/i);
    });

    test('should detect DNS spoofing attempt', async () => {
      const serverAKey = createMockSSHKey('ssh-ed25519');
      const serverBKey = createMockSSHKey('ssh-ed25519');

      // Connect to legitimate server A
      await manager.verifyHostKey('server.example.com', 22, undefined, serverAKey, false);

      // Attacker spoofs DNS to point to their server B with different key
      const spoofed = await manager.verifyHostKey('server.example.com', 22, undefined, serverBKey, false);

      // Should detect the different key
      expect(spoofed.accepted).toBe(false);
      expect(spoofed.reason).toMatch(/mismatch/i);
    });

    test('should handle legitimate server key rotation', async () => {
      const oldKey = createMockSSHKey('ssh-rsa');
      const newKey = createMockSSHKey('ssh-ed25519'); // Server upgraded to ed25519

      // Initial connection
      await manager.verifyHostKey('upgraded.example.com', 22, undefined, oldKey, false);

      // Server rotates key
      const rotated = await manager.verifyHostKey('upgraded.example.com', 22, undefined, newKey, false);

      // Should be rejected initially (security)
      expect(rotated.accepted).toBe(false);

      // Admin manually removes old key
      await manager.removeHost('upgraded.example.com', 22);

      // Now new key can be accepted
      const accepted = await manager.verifyHostKey('upgraded.example.com', 22, undefined, newKey, false);
      expect(accepted.accepted).toBe(true);
    });
  });
});
