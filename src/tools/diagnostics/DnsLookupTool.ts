import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import dns from 'dns/promises';

interface DnsLookupArgs {
  hostname: string;
  record_type?: 'A' | 'AAAA' | 'MX' | 'TXT' | 'NS' | 'CNAME' | 'ALL';
  timeout?: number;
}

/**
 * DnsLookupTool
 *
 * Performs DNS lookups for various record types.
 * Uses Node.js dns module with timeout protection.
 */
export class DnsLookupTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'dns_lookup',
      `[Diagnostics] Perform DNS lookup for hostname

Example usage:
\`\`\`json
{
  "hostname": "google.com",
  "record_type": "A",
  "timeout": 5000
}
\`\`\`

Supported record types: A, AAAA, MX, TXT, NS, CNAME, ALL`,
      'Diagnostics'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        hostname: {
          type: 'string',
          description: 'Hostname to lookup (e.g., "google.com")'
        },
        record_type: {
          type: 'string',
          enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'ALL'],
          description: 'DNS record type to query (default: A)',
          default: 'A'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 5000, max: 10000)',
          default: 5000
        }
      },
      required: ['hostname']
    };
  }

  async execute(args: DnsLookupArgs): Promise<ToolResult> {
    const { hostname, record_type = 'A', timeout = 5000 } = args;

    try {
      // Validate hostname format
      if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(hostname)) {
        return this.validationError('Invalid hostname format');
      }

      // Validate timeout
      if (timeout < 1000 || timeout > 10000) {
        return this.validationError('Timeout must be between 1000 and 10000 milliseconds');
      }

      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('DNS lookup timeout')), timeout);
      });

      let result: any;

      // Perform DNS lookup based on record type
      switch (record_type) {
        case 'A':
          const a4 = await Promise.race([dns.resolve4(hostname), timeoutPromise]);
          result = { type: 'A', addresses: a4 };
          break;

        case 'AAAA':
          const a6 = await Promise.race([dns.resolve6(hostname), timeoutPromise]);
          result = { type: 'AAAA', addresses: a6 };
          break;

        case 'MX':
          const mx = await Promise.race([dns.resolveMx(hostname), timeoutPromise]);
          result = {
            type: 'MX',
            records: mx.map(r => ({ exchange: r.exchange, priority: r.priority }))
          };
          break;

        case 'TXT':
          const txt = await Promise.race([dns.resolveTxt(hostname), timeoutPromise]);
          result = { type: 'TXT', records: txt.map(r => r.join('')) };
          break;

        case 'NS':
          const ns = await Promise.race([dns.resolveNs(hostname), timeoutPromise]);
          result = { type: 'NS', nameservers: ns };
          break;

        case 'CNAME':
          const cname = await Promise.race([dns.resolveCname(hostname), timeoutPromise]);
          result = { type: 'CNAME', aliases: cname };
          break;

        case 'ALL':
          // Query multiple record types
          const [a4All, mxAll, txtAll, nsAll] = await Promise.all([
            dns.resolve4(hostname).catch(() => []),
            dns.resolveMx(hostname).catch(() => []),
            dns.resolveTxt(hostname).catch(() => []),
            dns.resolveNs(hostname).catch(() => [])
          ]);

          result = {
            type: 'ALL',
            A: a4All,
            MX: mxAll.map(r => ({ exchange: r.exchange, priority: r.priority })),
            TXT: txtAll.map(r => r.join('')),
            NS: nsAll
          };
          break;

        default:
          return this.validationError(`Unsupported record type: ${record_type}`);
      }

      const response = {
        hostname,
        ...result,
        timestamp: new Date().toISOString()
      };

      return this.success(JSON.stringify(response, null, 2), { exitCode: 0 });
    } catch (error: any) {
      if (error.code === 'ENOTFOUND') {
        return this.error(`Hostname not found: ${hostname}`, -2);
      }
      if (error.code === 'ENODATA' || error.code === 'ENOENT') {
        return this.error(`No ${record_type} records found for ${hostname}`, -2);
      }
      if (error.message?.includes('timeout')) {
        return this.error('DNS lookup timeout', -1);
      }
      return this.error(
        `DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
