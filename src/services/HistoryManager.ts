import type { CommandHistoryEntry } from '../types/config.js';
import { loggers } from './Logger.js';

/**
 * HistoryManager Service
 *
 * Manages command history with:
 * - Size-limited storage with automatic cleanup
 * - Optional logging control
 * - Thread-safe operations
 * - Periodic cleanup timer
 * - Retrieval with pagination
 *
 * @example
 * ```typescript
 * const history = new HistoryManager(100, true);
 *
 * // Add entry
 * history.add({
 *   command: 'dir',
 *   output: '...',
 *   timestamp: new Date().toISOString(),
 *   exitCode: 0
 * });
 *
 * // Get recent entries
 * const recent = history.getRecent(10);
 *
 * // Start automatic cleanup
 * history.startCleanup();
 * ```
 */
export class HistoryManager {
  private history: CommandHistoryEntry[] = [];
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly maxSize: number,
    private readonly enabled: boolean
  ) {}

  /**
   * Add an entry to command history
   * Automatically removes oldest entries if size limit exceeded
   *
   * @param entry - Command history entry to add
   */
  add(entry: CommandHistoryEntry): void {
    if (!this.enabled) {
      return;
    }

    // Clean up immediately if at limit (prevents memory spikes)
    if (this.history.length >= this.maxSize) {
      this.history.shift(); // Remove oldest entry (FIFO)
    }

    this.history.push(entry);
  }

  /**
   * Get all history entries
   *
   * @returns Array of all history entries
   */
  getAll(): CommandHistoryEntry[] {
    return [...this.history]; // Return copy to prevent external modification
  }

  /**
   * Get recent history entries with pagination
   *
   * @param limit - Maximum number of entries to return
   * @param offset - Number of entries to skip from the end
   * @returns Array of recent history entries
   */
  getRecent(limit: number = 10, offset: number = 0): CommandHistoryEntry[] {
    const start = Math.max(0, this.history.length - limit - offset);
    const end = this.history.length - offset;
    return this.history.slice(start, end).reverse(); // Most recent first
  }

  /**
   * Get history entry count
   *
   * @returns Number of entries in history
   */
  count(): number {
    return this.history.length;
  }

  /**
   * Clear all history entries
   */
  clear(): void {
    this.history = [];
  }

  /**
   * Start periodic cleanup timer
   * Runs every 5 minutes to enforce size limits
   */
  startCleanup(): void {
    if (this.cleanupTimer) {
      return; // Already running
    }

    this.cleanupTimer = setInterval(() => {
      if (this.history.length > this.maxSize) {
        const excess = this.history.length - this.maxSize;
        this.history.splice(0, excess);
        loggers.history.debug('Cleaned up old command history entries', { excess });
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop periodic cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Check if history logging is enabled
   *
   * @returns True if logging enabled, false otherwise
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get maximum history size
   *
   * @returns Maximum number of entries allowed
   */
  getMaxSize(): number {
    return this.maxSize;
  }
}
