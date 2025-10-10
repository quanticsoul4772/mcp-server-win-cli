import type { ConfigManager } from './ConfigManager.js';
import { spawn, type ChildProcess } from 'child_process';

export interface Job {
  id: string;
  shell: 'powershell' | 'cmd' | 'gitbash';
  command: string;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  startTime: number;
  endTime?: number;
  exitCode?: number;
  output: string;
  pid?: number;
}

/**
 * JobManager
 *
 * Manages background command execution jobs.
 * Tracks job state, output, and provides job lifecycle management.
 */
export class JobManager {
  private jobs: Map<string, Job> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private readonly maxJobs: number = 20;
  private readonly maxOutputSize: number = 1024 * 1024; // 1MB per job
  private nextJobId: number = 1;

  constructor(private configManager: ConfigManager) {
    // Periodic cleanup of completed jobs older than 1 hour
    setInterval(() => {
      this.cleanupOldJobs();
    }, 10 * 60 * 1000); // 10 minutes
  }

  /**
   * Start a new background job
   */
  startJob(shell: 'powershell' | 'cmd' | 'gitbash', command: string, timeout: number = 300): string {
    // Check job limit
    if (this.jobs.size >= this.maxJobs) {
      this.cleanupOldJobs();
      if (this.jobs.size >= this.maxJobs) {
        throw new Error(`Job limit reached (${this.maxJobs}). Complete or cancel existing jobs first.`);
      }
    }

    const jobId = `job_${this.nextJobId++}`;
    const config = this.configManager.getConfig();
    const shellConfig = config.shells[shell];

    if (!shellConfig || !shellConfig.enabled) {
      throw new Error(`Shell '${shell}' is not enabled`);
    }

    const job: Job = {
      id: jobId,
      shell,
      command,
      status: 'running',
      startTime: Date.now(),
      output: ''
    };

    this.jobs.set(jobId, job);

    // Spawn process
    const childProcess = spawn(shellConfig.command, [...shellConfig.args, command], {
      windowsHide: true,
      env: process.env
    });

    job.pid = childProcess.pid;
    this.processes.set(jobId, childProcess);

    // Capture output
    childProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      job.output += output;
      // Truncate if too large
      if (job.output.length > this.maxOutputSize) {
        job.output = job.output.substring(job.output.length - this.maxOutputSize);
      }
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      job.output += output;
      // Truncate if too large
      if (job.output.length > this.maxOutputSize) {
        job.output = job.output.substring(job.output.length - this.maxOutputSize);
      }
    });

    // Handle completion
    childProcess.on('exit', (code: number | null) => {
      job.status = code === 0 ? 'completed' : 'failed';
      job.exitCode = code ?? -1;
      job.endTime = Date.now();
      this.processes.delete(jobId);
    });

    childProcess.on('error', (error: Error) => {
      job.status = 'failed';
      job.output += `\nProcess error: ${error.message}`;
      job.exitCode = -1;
      job.endTime = Date.now();
      this.processes.delete(jobId);
    });

    // Set timeout
    setTimeout(() => {
      if (job.status === 'running') {
        const process = this.processes.get(jobId);
        if (process) {
          process.kill('SIGTERM');
          job.status = 'timeout';
          job.output += `\n[Job timeout after ${timeout}s]`;
          job.exitCode = -1;
          job.endTime = Date.now();
          this.processes.delete(jobId);
        }
      }
    }, timeout * 1000);

    return jobId;
  }

  /**
   * Get job status and metadata
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get job output (streaming)
   */
  getJobOutput(jobId: string, offset: number = 0): { output: string; totalSize: number; complete: boolean } {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const output = offset < job.output.length ? job.output.substring(offset) : '';
    return {
      output,
      totalSize: job.output.length,
      complete: job.status !== 'running'
    };
  }

  /**
   * Terminate a running job
   */
  terminateJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }

    const process = this.processes.get(jobId);
    if (process) {
      process.kill('SIGTERM');
      job.status = 'failed';
      job.output += '\n[Job terminated by user]';
      job.exitCode = -1;
      job.endTime = Date.now();
      this.processes.delete(jobId);
      return true;
    }

    return false;
  }

  /**
   * Delete a job (only if completed/failed/timeout)
   */
  deleteJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'running') {
      return false;
    }

    this.jobs.delete(jobId);
    return true;
  }

  /**
   * Cleanup completed jobs older than 1 hour
   */
  private cleanupOldJobs(): void {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status !== 'running' && job.endTime && job.endTime < oneHourAgo) {
        this.jobs.delete(jobId);
      }
    }
  }

  /**
   * Cleanup all jobs and processes (for shutdown)
   */
  cleanup(): void {
    // Terminate all running processes
    for (const [jobId, process] of this.processes.entries()) {
      process.kill('SIGTERM');
    }

    this.processes.clear();
    this.jobs.clear();
  }
}
