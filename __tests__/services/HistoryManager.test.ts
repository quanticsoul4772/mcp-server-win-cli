import { jest } from '@jest/globals';
import { HistoryManager } from '../../src/services/HistoryManager.js';
import type { CommandHistoryEntry } from '../../src/types/config.js';

describe('HistoryManager', () => {
  let history: HistoryManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    if (history) {
      history.stopCleanup();
    }
  });

  describe('constructor', () => {
    it('should create history manager with specified max size', () => {
      history = new HistoryManager(50, true);
      expect(history.getMaxSize()).toBe(50);
      expect(history.isEnabled()).toBe(true);
    });

    it('should create disabled history manager', () => {
      history = new HistoryManager(100, false);
      expect(history.isEnabled()).toBe(false);
    });
  });

  describe('add()', () => {
    it('should add entry when enabled', () => {
      history = new HistoryManager(10, true);
      const entry: CommandHistoryEntry = {
        command: 'test-command',
        output: 'test output',
        timestamp: new Date().toISOString(),
        exitCode: 0
      };

      history.add(entry);
      expect(history.count()).toBe(1);
      expect(history.getAll()).toContainEqual(entry);
    });

    it('should not add entry when disabled', () => {
      history = new HistoryManager(10, false);
      const entry: CommandHistoryEntry = {
        command: 'test-command',
        output: 'test output',
        timestamp: new Date().toISOString(),
        exitCode: 0
      };

      history.add(entry);
      expect(history.count()).toBe(0);
    });

    it('should enforce FIFO eviction when at max size', () => {
      history = new HistoryManager(3, true);

      const entry1: CommandHistoryEntry = {
        command: 'command-1',
        output: 'output-1',
        timestamp: new Date().toISOString(),
        exitCode: 0
      };
      const entry2: CommandHistoryEntry = {
        command: 'command-2',
        output: 'output-2',
        timestamp: new Date().toISOString(),
        exitCode: 0
      };
      const entry3: CommandHistoryEntry = {
        command: 'command-3',
        output: 'output-3',
        timestamp: new Date().toISOString(),
        exitCode: 0
      };
      const entry4: CommandHistoryEntry = {
        command: 'command-4',
        output: 'output-4',
        timestamp: new Date().toISOString(),
        exitCode: 0
      };

      history.add(entry1);
      history.add(entry2);
      history.add(entry3);
      expect(history.count()).toBe(3);

      // Adding 4th entry should evict entry1
      history.add(entry4);
      expect(history.count()).toBe(3);
      expect(history.getAll()).not.toContainEqual(entry1);
      expect(history.getAll()).toContainEqual(entry2);
      expect(history.getAll()).toContainEqual(entry3);
      expect(history.getAll()).toContainEqual(entry4);
    });
  });

  describe('getAll()', () => {
    it('should return copy of history array', () => {
      history = new HistoryManager(10, true);
      const entry: CommandHistoryEntry = {
        command: 'test',
        output: 'output',
        timestamp: new Date().toISOString(),
        exitCode: 0
      };

      history.add(entry);
      const all = history.getAll();

      // Modifying returned array should not affect internal state
      all.push({
        command: 'external',
        output: 'external',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });

      expect(history.count()).toBe(1);
    });

    it('should return empty array when no entries', () => {
      history = new HistoryManager(10, true);
      expect(history.getAll()).toEqual([]);
    });
  });

  describe('getRecent()', () => {
    beforeEach(() => {
      history = new HistoryManager(100, true);
      // Add 5 entries
      for (let i = 1; i <= 5; i++) {
        history.add({
          command: `command-${i}`,
          output: `output-${i}`,
          timestamp: new Date().toISOString(),
          exitCode: 0
        });
      }
    });

    it('should return most recent entries in reverse order', () => {
      const recent = history.getRecent(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].command).toBe('command-5'); // Most recent first
      expect(recent[1].command).toBe('command-4');
      expect(recent[2].command).toBe('command-3');
    });

    it('should use default limit of 10', () => {
      const recent = history.getRecent();
      expect(recent.length).toBeLessThanOrEqual(10);
    });

    it('should support pagination with offset', () => {
      const recent = history.getRecent(2, 1);
      expect(recent).toHaveLength(2);
      expect(recent[0].command).toBe('command-4'); // Skip 1 most recent
      expect(recent[1].command).toBe('command-3');
    });

    it('should handle limit exceeding available entries', () => {
      const recent = history.getRecent(100);
      expect(recent).toHaveLength(5);
    });

    it('should handle offset exceeding available entries', () => {
      const recent = history.getRecent(10, 10);
      expect(recent).toEqual([]);
    });
  });

  describe('count()', () => {
    it('should return correct entry count', () => {
      history = new HistoryManager(10, true);
      expect(history.count()).toBe(0);

      history.add({
        command: 'test1',
        output: 'output1',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });
      expect(history.count()).toBe(1);

      history.add({
        command: 'test2',
        output: 'output2',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });
      expect(history.count()).toBe(2);
    });
  });

  describe('clear()', () => {
    it('should remove all entries', () => {
      history = new HistoryManager(10, true);
      history.add({
        command: 'test1',
        output: 'output1',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });
      history.add({
        command: 'test2',
        output: 'output2',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });

      expect(history.count()).toBe(2);
      history.clear();
      expect(history.count()).toBe(0);
      expect(history.getAll()).toEqual([]);
    });
  });

  describe('startCleanup() / stopCleanup()', () => {
    it('should start periodic cleanup timer', () => {
      jest.useFakeTimers();
      history = new HistoryManager(3, true);

      // Add 5 entries (exceeds max)
      for (let i = 1; i <= 5; i++) {
        history.add({
          command: `command-${i}`,
          output: `output-${i}`,
          timestamp: new Date().toISOString(),
          exitCode: 0
        });
      }

      expect(history.count()).toBe(3); // Already limited by add()

      // Manually exceed limit
      (history as any).history.push({
        command: 'manual-1',
        output: 'output',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });
      (history as any).history.push({
        command: 'manual-2',
        output: 'output',
        timestamp: new Date().toISOString(),
        exitCode: 0
      });

      expect(history.count()).toBe(5);

      history.startCleanup();

      // Fast-forward 5 minutes
      jest.advanceTimersByTime(5 * 60 * 1000);

      expect(history.count()).toBe(3); // Cleaned up to max size

      jest.useRealTimers();
    });

    it('should not start multiple cleanup timers', () => {
      history = new HistoryManager(10, true);
      history.startCleanup();
      history.startCleanup(); // Should be ignored

      // No error should occur
      expect(() => history.stopCleanup()).not.toThrow();
    });

    it('should stop cleanup timer', () => {
      jest.useFakeTimers();
      history = new HistoryManager(10, true);

      history.startCleanup();
      history.stopCleanup();

      // Manually exceed limit
      for (let i = 1; i <= 15; i++) {
        (history as any).history.push({
          command: `command-${i}`,
          output: 'output',
          timestamp: new Date().toISOString(),
          exitCode: 0
        });
      }

      // Fast-forward 5 minutes - cleanup should NOT run
      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(history.count()).toBe(15); // Not cleaned up

      jest.useRealTimers();
    });

    it('should handle stopCleanup when not started', () => {
      history = new HistoryManager(10, true);
      expect(() => history.stopCleanup()).not.toThrow();
    });
  });

  describe('isEnabled() / getMaxSize()', () => {
    it('should return enabled state', () => {
      history = new HistoryManager(10, true);
      expect(history.isEnabled()).toBe(true);

      const disabledHistory = new HistoryManager(10, false);
      expect(disabledHistory.isEnabled()).toBe(false);
    });

    it('should return max size', () => {
      history = new HistoryManager(50, true);
      expect(history.getMaxSize()).toBe(50);

      const largeHistory = new HistoryManager(1000, true);
      expect(largeHistory.getMaxSize()).toBe(1000);
    });
  });
});
