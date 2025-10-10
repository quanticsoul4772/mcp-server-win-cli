import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import os from 'os';

interface GetCpuUsageArgs {
  interval?: number;
}

/**
 * GetCpuUsageTool
 *
 * Measures CPU usage over a sampling interval.
 * Uses Node.js os module for cross-platform compatibility.
 */
export class GetCpuUsageTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'get_cpu_usage',
      `[System Info] Get CPU usage percentage with configurable sampling interval

Example usage:
\`\`\`json
{
  "interval": 1000
}
\`\`\`

Returns CPU usage percentage measured over the interval (default: 1 second).`,
      'System Info'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        interval: {
          type: 'number',
          description: 'Measurement interval in milliseconds (default: 1000, min: 100, max: 10000)',
          default: 1000
        }
      }
    };
  }

  async execute(args: GetCpuUsageArgs): Promise<ToolResult> {
    const { interval = 1000 } = args;

    try {
      // Validate interval
      if (interval < 100 || interval > 10000) {
        return this.validationError('Interval must be between 100 and 10000 milliseconds');
      }

      // Get initial CPU times
      const startCpus = os.cpus();
      const startTime = Date.now();

      // Wait for the interval
      await new Promise(resolve => setTimeout(resolve, interval));

      // Get final CPU times
      const endCpus = os.cpus();
      const endTime = Date.now();
      const actualInterval = endTime - startTime;

      // Calculate CPU usage
      let totalIdle = 0;
      let totalTick = 0;

      for (let i = 0; i < startCpus.length; i++) {
        const start = startCpus[i].times;
        const end = endCpus[i].times;

        const idleDiff = end.idle - start.idle;
        const totalDiff =
          (end.user - start.user) +
          (end.nice - start.nice) +
          (end.sys - start.sys) +
          (end.idle - start.idle) +
          (end.irq - start.irq);

        totalIdle += idleDiff;
        totalTick += totalDiff;
      }

      const cpuUsage = 100 - (100 * totalIdle / totalTick);

      const result = {
        cpu_usage_percent: parseFloat(cpuUsage.toFixed(2)),
        cores: startCpus.length,
        measurement_interval_ms: actualInterval,
        per_core: startCpus.map((cpu, i) => {
          const start = startCpus[i].times;
          const end = endCpus[i].times;

          const idle = end.idle - start.idle;
          const total =
            (end.user - start.user) +
            (end.nice - start.nice) +
            (end.sys - start.sys) +
            (end.idle - start.idle) +
            (end.irq - start.irq);

          const usage = 100 - (100 * idle / total);

          return {
            core: i,
            model: cpu.model,
            speed_mhz: cpu.speed,
            usage_percent: parseFloat(usage.toFixed(2))
          };
        })
      };

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to get CPU usage: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }
}
