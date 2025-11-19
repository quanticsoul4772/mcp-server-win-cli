/**
 * Session manager for persistent shell environments
 * Tracks session state like working directory between commands
 */

import { loggers } from '../services/Logger.js';

interface SessionState {
  workingDirectory: string;
  createdAt: number;
  lastAccessedAt: number;
}

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private readonly maxIdleTime: number = 30 * 60 * 1000; // 30 minutes
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const toDelete: string[] = [];

      for (const [id, state] of this.sessions) {
        if (now - state.lastAccessedAt > this.maxIdleTime) {
          toDelete.push(id);
        }
      }

      for (const id of toDelete) {
        this.sessions.delete(id);
        loggers.session.debug('Cleaned up idle session', { sessionId: id });
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  createSession(sessionId: string, initialWorkingDir: string): void {
    const now = Date.now();
    this.sessions.set(sessionId, {
      workingDirectory: initialWorkingDir,
      createdAt: now,
      lastAccessedAt: now
    });
  }

  getSession(sessionId: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = Date.now();
    }
    return session;
  }

  updateWorkingDirectory(sessionId: string, workingDir: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.workingDirectory = workingDir;
      session.lastAccessedAt = Date.now();
    }
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  listSessions(): Array<{ id: string; state: SessionState }> {
    return Array.from(this.sessions.entries()).map(([id, state]) => ({
      id,
      state
    }));
  }

  cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }
}
