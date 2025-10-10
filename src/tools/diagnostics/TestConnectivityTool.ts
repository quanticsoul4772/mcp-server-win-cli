import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import net from 'net';
import dns from 'dns/promises';

interface TestConnectivityArgs {
  host: string;
  port?: number;
  timeout?: number;
}

/**
 * TestConnectivityTool
 *
 * Tests network connectivity to a host and port.
 * Includes SSRF protection (blocks private IPs, localhost, cloud metadata).
 */
export class TestConnectivityTool extends BaseTool {
  private readonly BLOCKED_IP_RANGES = [
    /^10\./,                    // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,              // 192.168.0.0/16
    /^127\./,                   // 127.0.0.0/8 (localhost)
    /^169\.254\./,              // 169.254.0.0/16 (link-local + cloud metadata)
    /^fe80:/i,                  // fe80::/10 (IPv6 link-local)
    /^::1$/,                    // ::1 (IPv6 localhost)
    /^fc00:/i,                  // fc00::/7 (IPv6 unique local)
    /^fd00:/i                   // fd00::/8 (IPv6 unique local)
  ];

  private readonly ALLOWED_PORTS = [
    22, 80, 443, 3389, // Common services
    3306, 5432,  // Databases
    27017, 6379, // MongoDB, Redis
    8080, 8443   // Alt HTTP/HTTPS
  ];

  constructor(container: ServiceContainer) {
    super(
      container,
      'test_connectivity',
      `[Diagnostics] Test network connectivity to host and port

Example usage:
\`\`\`json
{
  "host": "google.com",
  "port": 443,
  "timeout": 5000
}
\`\`\`

Security: Blocks connections to private IPs, localhost, and cloud metadata endpoints.`,
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'Hostname or IP address to test'
        },
        port: {
          type: 'number',
          description: 'Port number to test (default: 80)',
          default: 80
        },
        timeout: {
          type: 'number',
          description: 'Connection timeout in milliseconds (default: 5000, max: 10000)',
          default: 5000
        }
      },
      required: ['host']
    };
  }

  async execute(args: TestConnectivityArgs): Promise<ToolResult> {
    const { host, port = 80, timeout = 5000 } = args;

    try {
      // Validate timeout
      if (timeout < 1000 || timeout > 10000) {
        return this.validationError('Timeout must be between 1000 and 10000 milliseconds');
      }

      // Validate port
      if (!this.ALLOWED_PORTS.includes(port)) {
        return this.validationError(
          `Port ${port} not allowed. Allowed ports: ${this.ALLOWED_PORTS.join(', ')}`
        );
      }

      const startTime = Date.now();

      // Resolve hostname to IP
      let resolvedIp: string;
      try {
        const addresses = await dns.resolve4(host);
        resolvedIp = addresses[0];
      } catch (error) {
        return this.error(`Failed to resolve hostname: ${host}`, -2);
      }

      // SSRF Protection: Block private IPs
      const isBlocked = this.BLOCKED_IP_RANGES.some(regex => regex.test(resolvedIp));
      if (isBlocked) {
        return this.error(
          `Connection to ${resolvedIp} blocked for security (private IP/localhost/cloud metadata)`,
          -2
        );
      }

      // Attempt TCP connection
      const connected = await this.testTcpConnection(resolvedIp, port, timeout);
      const latency = Date.now() - startTime;

      const result = {
        host,
        resolved_ip: resolvedIp,
        port,
        connected,
        latency_ms: latency,
        timestamp: new Date().toISOString()
      };

      if (!connected) {
        return this.error(
          `Connection failed to ${host}:${port} (${resolvedIp})`,
          -1,
          result
        );
      }

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Connectivity test failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }

  private testTcpConnection(host: string, port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      const timeoutId = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, timeout);

      socket.on('connect', () => {
        clearTimeout(timeoutId);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeoutId);
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }
}
