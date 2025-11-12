import { Client } from 'ssh2';
import { SSHConnectionConfig } from '../types/config.js';
import fs from 'fs/promises';
import { getKnownHostsManager } from './knownHosts.js';
import SftpClient from 'ssh2-sftp-client';

export class SSHConnection {
  private client: Client;
  private config: SSHConnectionConfig;
  private isConnected: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastActivity: number = Date.now();
  private detectedShellType: 'bash' | 'sh' | 'powershell' | 'cmd' | 'unknown' = 'unknown';
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private baseBackoffMs: number = 1000; // 1 second base delay
  private isFailed: boolean = false;
  private onFailureCallback?: () => void;
  private strictHostKeyChecking: boolean;

  constructor(config: SSHConnectionConfig, strictHostKeyChecking: boolean = true, onFailure?: () => void) {
    this.client = new Client();
    this.config = config;
    this.strictHostKeyChecking = strictHostKeyChecking;
    this.onFailureCallback = onFailure;
    this.setupClientEvents();
  }

  private setupClientEvents() {
    this.client
      .on('error', (err) => {
        console.error(`SSH connection error for ${this.config.host}:`, err.message);
        this.isConnected = false;
        this.scheduleReconnect();
      })
      .on('end', () => {
        console.error(`SSH connection ended for ${this.config.host}`);
        this.isConnected = false;
        this.scheduleReconnect();
      })
      .on('close', () => {
        console.error(`SSH connection closed for ${this.config.host}`);
        this.isConnected = false;
        this.scheduleReconnect();
      });
  }

  private scheduleReconnect() {
    // Clear any existing timer first
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Check if we've exceeded max reconnect attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${this.config.host}`);
      // Mark connection as permanently failed
      this.isFailed = true;
      // Notify pool to remove this connection
      if (this.onFailureCallback) {
        this.onFailureCallback();
      }
      return;
    }

    // Only attempt reconnect if there was recent activity
    const timeSinceLastActivity = Date.now() - this.lastActivity;
    if (timeSinceLastActivity < 30 * 60 * 1000) { // 30 minutes
      // Calculate exponential backoff with jitter
      const exponentialDelay = this.baseBackoffMs * Math.pow(2, this.reconnectAttempts);
      const jitter = Math.random() * 1000; // 0-1000ms jitter
      const totalDelay = Math.min(exponentialDelay + jitter, 60000); // Cap at 60 seconds

      this.reconnectAttempts++;
      console.error(
        `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} ` +
        `for ${this.config.host} in ${Math.round(totalDelay)}ms`
      );

      this.reconnectTimer = setTimeout(() => {
        this.attemptReconnect().catch(err => {
          console.error(`Critical reconnection error for ${this.config.host}:`, err instanceof Error ? err.message : String(err));
          // Error handlers on the client will trigger scheduleReconnect if needed
        });
      }, totalDelay);
    }
  }

  private async attemptReconnect(): Promise<void> {
    console.error(`Attempting to reconnect to ${this.config.host}...`);
    await this.connect();
    console.error(`Successfully reconnected to ${this.config.host}`);
    // Reset attempts on successful connection
    this.reconnectAttempts = 0;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    return new Promise(async (resolve, reject) => {
      try {
        const connectionConfig: any = {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          keepaliveInterval: this.config.keepaliveInterval || 10000,
          keepaliveCountMax: this.config.keepaliveCountMax || 3,
          readyTimeout: this.config.readyTimeout || 20000,
        };

        // Handle authentication
        if (this.config.privateKeyPath) {
          const privateKey = await fs.readFile(this.config.privateKeyPath, 'utf8');
          connectionConfig.privateKey = privateKey;
        } else if (this.config.password) {
          connectionConfig.password = this.config.password;
        } else {
          throw new Error('No authentication method provided');
        }

        // Add host key verification
        const knownHostsManager = getKnownHostsManager();
        connectionConfig.hostVerifier = async (key: Buffer, verify: (valid: boolean) => void) => {
          try {
            const result = await knownHostsManager.verifyHostKey(
              this.config.host,
              this.config.port,
              undefined, // hashedKey - we're not using hostHash
              key,
              this.strictHostKeyChecking
            );

            if (!result.accepted) {
              console.error(`Host key verification failed: ${result.reason}`);
            }

            verify(result.accepted);
          } catch (error) {
            console.error('Error during host key verification:', error instanceof Error ? error.message : String(error));
            verify(false);
          }
        };

        this.client
          .on('ready', () => {
            this.isConnected = true;
            this.lastActivity = Date.now();
            this.reconnectAttempts = 0; // Reset on successful connection
            // Clear any pending reconnect timer
            if (this.reconnectTimer) {
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = null;
            }
            resolve();
          })
          .on('error', (err) => {
            reject(err);
          })
          .connect(connectionConfig);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Detect the remote shell type by checking environment
   */
  async detectShellType(): Promise<'bash' | 'sh' | 'powershell' | 'cmd' | 'unknown'> {
    if (this.detectedShellType !== 'unknown') {
      return this.detectedShellType;
    }

    try {
      // Try to detect shell by checking SHELL environment variable
      const shellCheck = await this.executeCommandInternal('echo $SHELL');
      if (shellCheck.output.includes('bash')) {
        this.detectedShellType = 'bash';
      } else if (shellCheck.output.includes('sh')) {
        this.detectedShellType = 'sh';
      } else {
        // Try PowerShell detection
        const psCheck = await this.executeCommandInternal('$PSVersionTable.PSVersion');
        if (psCheck.exitCode === 0 && psCheck.output.trim()) {
          this.detectedShellType = 'powershell';
        }
        // Fail-closed: leave as 'unknown' if detection fails
      }
    } catch (error) {
      // Fail-closed: leave as 'unknown' if detection fails
      // Caller should use most restrictive validation rules
    }

    return this.detectedShellType;
  }

  getShellType(): 'bash' | 'sh' | 'powershell' | 'cmd' | 'unknown' {
    return this.detectedShellType;
  }

  private async executeCommandInternal(command: string): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let output = '';
        let errorOutput = '';

        stream
          .on('data', (data: Buffer) => {
            output += data.toString();
          })
          .stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
          });

        stream.on('close', (code: number) => {
          resolve({
            output: output || errorOutput,
            exitCode: code || 0
          });
        });
      });
    });
  }

  async executeCommand(command: string): Promise<{ output: string; exitCode: number }> {
    this.lastActivity = Date.now();

    // Check connection and attempt reconnect if needed
    if (!this.isConnected) {
      await this.connect();
    }

    // Detect shell type on first command if not already detected
    if (this.detectedShellType === 'unknown') {
      await this.detectShellType();
    }

    return this.executeCommandInternal(command);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.isConnected) {
      this.client.end();
      this.isConnected = false;
    }
  }

  isActive(): boolean {
    return this.isConnected;
  }

  hasFailed(): boolean {
    return this.isFailed;
  }

  /**
   * Get an SFTP client for file transfer operations
   */
  async getSFTPClient(): Promise<SftpClient> {
    this.lastActivity = Date.now();

    // Check connection and attempt reconnect if needed
    if (!this.isConnected) {
      await this.connect();
    }

    const sftp = new SftpClient();

    // Prepare connection config
    const connectionConfig: any = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
    };

    if (this.config.password) {
      connectionConfig.password = this.config.password;
    } else if (this.config.privateKeyPath) {
      try {
        connectionConfig.privateKey = await fs.readFile(this.config.privateKeyPath);
      } catch (error) {
        throw new Error(`Failed to read private key: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await sftp.connect(connectionConfig);
    return sftp;
  }

  getClient(): Client {
    return this.client;
  }
}

// Connection pool to manage multiple SSH connections with LRU eviction
export class SSHConnectionPool {
  private connections: Map<string, SSHConnection> = new Map();
  private lastAccessTime: Map<string, number> = new Map();
  private readonly maxPoolSize: number = 10;
  private readonly maxIdleTime: number = 30 * 60 * 1000; // 30 minutes
  private strictHostKeyChecking: boolean;

  constructor(strictHostKeyChecking: boolean = true) {
    this.strictHostKeyChecking = strictHostKeyChecking;
  }

  private evictIdleConnections(): void {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [id, lastAccess] of this.lastAccessTime) {
      if (now - lastAccess > this.maxIdleTime) {
        toEvict.push(id);
      }
    }

    for (const id of toEvict) {
      console.error(`Evicting idle SSH connection: ${id} (idle for ${Math.round((now - this.lastAccessTime.get(id)!) / 1000)}s)`);
      this.closeConnection(id);
    }
  }

  private evictLRU(): void {
    // Evict least recently used connection
    let lruId: string | null = null;
    let lruTime = Infinity;

    for (const [id, lastAccess] of this.lastAccessTime) {
      if (lastAccess < lruTime) {
        lruTime = lastAccess;
        lruId = id;
      }
    }

    if (lruId) {
      console.error(`Pool full, evicting LRU connection: ${lruId} (last used ${Math.round((Date.now() - lruTime) / 1000)}s ago)`);
      this.closeConnection(lruId);
    }
  }

  async getConnection(connectionId: string, config: SSHConnectionConfig): Promise<SSHConnection> {
    // Evict idle connections periodically
    this.evictIdleConnections();

    let connection = this.connections.get(connectionId);

    // Remove failed connections
    if (connection && connection.hasFailed()) {
      console.error(`Removing failed connection: ${connectionId}`);
      await this.closeConnection(connectionId);
      connection = undefined;
    }

    if (!connection) {
      // Check if we need to evict due to pool size limit (use LRU)
      if (this.connections.size >= this.maxPoolSize) {
        this.evictLRU();
      }

      // Create connection with failure callback
      connection = new SSHConnection(config, this.strictHostKeyChecking, () => {
        // Remove from pool when permanently failed
        this.closeConnection(connectionId).catch(err => {
          console.error(`Error removing failed connection ${connectionId}:`, err);
        });
      });
      this.connections.set(connectionId, connection);
      this.lastAccessTime.set(connectionId, Date.now());
      await connection.connect();
    } else if (!connection.isActive()) {
      await connection.connect();
    }

    // Update last access time for LRU tracking
    this.lastAccessTime.set(connectionId, Date.now());

    return connection;
  }

  async getRemoteShellType(connectionId: string): Promise<'bash' | 'sh' | 'powershell' | 'cmd' | 'unknown'> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return 'unknown';
    }
    return connection.getShellType();
  }

  hasConnection(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.disconnect();
      this.connections.delete(connectionId);
      this.lastAccessTime.delete(connectionId);
    }
  }

  closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.disconnect();
    }
    this.connections.clear();
    this.lastAccessTime.clear();
  }

  getPoolStats(): { size: number; maxSize: number; connectionIds: string[] } {
    return {
      size: this.connections.size,
      maxSize: this.maxPoolSize,
      connectionIds: Array.from(this.connections.keys())
    };
  }
}