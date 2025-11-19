/**
 * SSH Known Hosts Management
 * Implements Trust On First Use (TOFU) host key verification to prevent MITM attacks
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { lock } from 'proper-lockfile';
import { Mutex } from 'async-mutex';
import { loggers } from '../services/Logger.js';

export interface HostKeyEntry {
  /** Host key algorithm (e.g., 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-ed25519') */
  algorithm: string;
  /** SHA256 fingerprint in base64 format (e.g., 'SHA256:...') */
  fingerprint: string;
  /** Base64-encoded public key */
  key: string;
  /** Timestamp of first connection */
  firstSeen: string;
  /** Timestamp of last successful connection */
  lastSeen: string;
}

export interface KnownHostsStore {
  [hostPort: string]: HostKeyEntry;
}

export class KnownHostsManager {
  private knownHostsPath: string;
  private knownHosts: KnownHostsStore = {};
  private initialized: boolean = false;
  private mutex: Mutex = new Mutex();

  constructor(customPath?: string) {
    if (customPath) {
      this.knownHostsPath = customPath;
    } else {
      // Default: ~/.win-cli-mcp/known_hosts.json
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, '.win-cli-mcp');
      this.knownHostsPath = path.join(configDir, 'known_hosts.json');
    }
  }

  /**
   * Initialize the known hosts storage
   * Creates the directory and file if they don't exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const dir = path.dirname(this.knownHostsPath);
      await fs.mkdir(dir, { recursive: true });

      // Try to read existing known_hosts file
      try {
        const data = await fs.readFile(this.knownHostsPath, 'utf8');
        this.knownHosts = JSON.parse(data);
      } catch (err) {
        // File doesn't exist yet - that's okay, we'll create it on first write
        this.knownHosts = {};
      }

      this.initialized = true;
    } catch (error) {
      loggers.knownHosts.error('Failed to initialize known hosts', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to initialize SSH host key verification');
    }
  }

  /**
   * Get the host:port key for the known hosts store
   */
  private getHostKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  /**
   * Calculate SHA256 fingerprint from public key buffer
   * Returns format: "SHA256:base64EncodedHash"
   */
  private calculateFingerprint(keyBuffer: Buffer): string {
    const hash = crypto.createHash('sha256');
    hash.update(keyBuffer);
    const digest = hash.digest('base64');
    return `SHA256:${digest}`;
  }

  /**
   * Verify a host key against the known hosts database
   * Implements Trust On First Use (TOFU)
   *
   * @param host - Hostname or IP address
   * @param port - SSH port number
   * @param hashedKey - Hashed host key (if hostHash is set in ssh2 config)
   * @param key - Raw public key buffer
   * @param strictMode - If true, reject unknown hosts; if false, use TOFU
   * @returns true if key is accepted, false if rejected
   */
  async verifyHostKey(
    host: string,
    port: number,
    hashedKey: string | undefined,
    key: Buffer,
    strictMode: boolean = true
  ): Promise<{ accepted: boolean; reason: string }> {
    await this.initialize();

    const hostKey = this.getHostKey(host, port);
    const keyBase64 = key.toString('base64');
    const fingerprint = this.calculateFingerprint(key);

    // Extract algorithm from key buffer
    // SSH key format starts with length-prefixed algorithm name
    let algorithm = 'unknown';
    try {
      const algLength = key.readUInt32BE(0);
      algorithm = key.toString('utf8', 4, 4 + algLength);
    } catch (err) {
      loggers.knownHosts.warn('Failed to parse key algorithm', { error: err instanceof Error ? err.message : String(err) });
    }

    const existingEntry = this.knownHosts[hostKey];

    if (!existingEntry) {
      // First time seeing this host
      if (strictMode) {
        // Strict mode: reject unknown hosts
        loggers.knownHosts.security('Unknown host rejected in strict mode', {
          host,
          port,
          fingerprint,
          mode: 'strict'
        });
        return {
          accepted: false,
          reason: `Unknown host ${host}:${port}. Enable TOFU mode (strictHostKeyChecking: false) to accept on first connection.`
        };
      } else {
        // TOFU mode: accept and store the key
        loggers.knownHosts.warn('Adding new host to known hosts (TOFU mode)', {
          host,
          port,
          fingerprint,
          algorithm
        });

        const now = new Date().toISOString();
        const newEntry: HostKeyEntry = {
          algorithm,
          fingerprint,
          key: keyBase64,
          firstSeen: now,
          lastSeen: now
        };

        await this.addOrUpdateHost(hostKey, newEntry);

        return {
          accepted: true,
          reason: `New host ${host}:${port} accepted (TOFU mode). Fingerprint: ${fingerprint}`
        };
      }
    } else {
      // Host is known - verify the key matches
      if (existingEntry.key === keyBase64 && existingEntry.fingerprint === fingerprint) {
        // Key matches - update last seen timestamp
        const updatedEntry: HostKeyEntry = {
          ...existingEntry,
          lastSeen: new Date().toISOString()
        };
        await this.addOrUpdateHost(hostKey, updatedEntry);

        return {
          accepted: true,
          reason: `Host ${host}:${port} verified successfully`
        };
      } else {
        // KEY MISMATCH - POSSIBLE MITM ATTACK!
        loggers.knownHosts.securityAlert('SSH HOST KEY MISMATCH - Possible MITM attack!', {
          host,
          port,
          expectedFingerprint: existingEntry.fingerprint,
          receivedFingerprint: fingerprint,
          expectedAlgorithm: existingEntry.algorithm,
          receivedAlgorithm: algorithm,
          knownHostsPath: this.knownHostsPath,
          possibleCauses: [
            'Man-in-the-Middle (MITM) attack in progress',
            'Host key has been legitimately changed',
            'DNS spoofing or IP address reassignment'
          ]
        });

        return {
          accepted: false,
          reason: `HOST KEY MISMATCH for ${host}:${port}! Possible MITM attack. Expected: ${existingEntry.fingerprint}, Got: ${fingerprint}. If you trust this new key, manually remove the old entry from known_hosts file at: ${this.knownHostsPath}`
        };
      }
    }
  }

  /**
   * Add or update a host entry in the known hosts database
   * Uses mutex and file locking to prevent concurrent write conflicts
   */
  private async addOrUpdateHost(hostKey: string, entry: HostKeyEntry): Promise<void> {
    // Use mutex to serialize all file operations
    return this.mutex.runExclusive(async () => {
      try {
        // Ensure directory exists
        const dir = path.dirname(this.knownHostsPath);
        await fs.mkdir(dir, { recursive: true });

        // Update in-memory cache
        this.knownHosts[hostKey] = entry;

        // Check if file exists, create empty object if not
        let fileExists = false;
        try {
          await fs.access(this.knownHostsPath);
          fileExists = true;
        } catch {
          // File doesn't exist yet
          await fs.writeFile(this.knownHostsPath, '{}', 'utf8');
          fileExists = true;
        }

        // Acquire lock on the file
        let release: (() => Promise<void>) | undefined;
        try {
          release = await lock(this.knownHostsPath, {
            retries: {
              retries: 10,
              minTimeout: 50,
              maxTimeout: 2000,
              factor: 2
            },
            stale: 15000, // 15 second stale lock timeout
            realpath: false // Don't resolve symlinks to avoid ENOENT errors
          });

          // Re-read the file to get latest state
          const data = await fs.readFile(this.knownHostsPath, 'utf8');
          const currentHosts = JSON.parse(data) as KnownHostsStore;

          // Merge our update
          currentHosts[hostKey] = entry;

          // Write back to file
          await fs.writeFile(
            this.knownHostsPath,
            JSON.stringify(currentHosts, null, 2),
            'utf8'
          );
        } finally {
          // Release the lock
          if (release) {
            await release();
          }
        }
      } catch (error) {
        loggers.knownHosts.error('Failed to update known hosts', { error: error instanceof Error ? error.message : String(error) });
        throw new Error('Failed to save SSH host key');
      }
    });
  }

  /**
   * Get the stored entry for a host
   */
  async getHostEntry(host: string, port: number): Promise<HostKeyEntry | null> {
    await this.initialize();
    const hostKey = this.getHostKey(host, port);
    return this.knownHosts[hostKey] || null;
  }

  /**
   * Remove a host entry from the known hosts database
   * This should be used carefully - typically only when a host key has legitimately changed
   */
  async removeHost(host: string, port: number): Promise<void> {
    await this.initialize();

    const hostKey = this.getHostKey(host, port);

    // Remove from in-memory cache
    delete this.knownHosts[hostKey];

    // Acquire lock and update file
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(this.knownHostsPath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000
        }
      });

      // Re-read the file to get latest state
      const data = await fs.readFile(this.knownHostsPath, 'utf8');
      const currentHosts = JSON.parse(data) as KnownHostsStore;

      // Remove the host
      delete currentHosts[hostKey];

      // Write back to file
      await fs.writeFile(
        this.knownHostsPath,
        JSON.stringify(currentHosts, null, 2),
        'utf8'
      );
    } catch (error) {
      loggers.knownHosts.error('Failed to remove host from known hosts', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to remove SSH host key');
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * Get all known hosts
   */
  async getAllHosts(): Promise<KnownHostsStore> {
    await this.initialize();
    return { ...this.knownHosts };
  }

  /**
   * Get the path to the known hosts file
   */
  getKnownHostsPath(): string {
    return this.knownHostsPath;
  }
}

// Singleton instance for global use
let globalKnownHostsManager: KnownHostsManager | null = null;

/**
 * Get the global KnownHostsManager instance
 */
export function getKnownHostsManager(customPath?: string): KnownHostsManager {
  if (!globalKnownHostsManager) {
    globalKnownHostsManager = new KnownHostsManager(customPath);
  }
  return globalKnownHostsManager;
}
