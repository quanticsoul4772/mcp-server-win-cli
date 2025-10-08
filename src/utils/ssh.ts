import { Client } from 'ssh2';
import { SSHConnectionConfig } from '../types/config.js';
import fs from 'fs/promises';

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

  constructor(config: SSHConnectionConfig) {
    this.client = new Client();
    this.config = config;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Check if we've exceeded max reconnect attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${this.config.host}`);
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

      this.reconnectTimer = setTimeout(async () => {
        console.error(`Attempting to reconnect to ${this.config.host}...`);
        try {
          await this.connect();
          console.error(`Successfully reconnected to ${this.config.host}`);
          // Reset attempts on successful connection
          this.reconnectAttempts = 0;
        } catch (err) {
          console.error(`Reconnection failed for ${this.config.host}:`, err instanceof Error ? err.message : String(err));
          // scheduleReconnect will be called again by error handlers
        }
      }, totalDelay);
    }
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

        this.client
          .on('ready', () => {
            this.isConnected = true;
            this.lastActivity = Date.now();
            this.reconnectAttempts = 0; // Reset on successful connection
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
        } else {
          // Default to bash for Unix-like systems
          this.detectedShellType = 'bash';
        }
      }
    } catch (error) {
      // If detection fails, assume bash (most common for SSH)
      this.detectedShellType = 'bash';
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
}

// Connection pool to manage multiple SSH connections
export class SSHConnectionPool {
  private connections: Map<string, SSHConnection> = new Map();
  private connectionAges: Map<string, number> = new Map();
  private readonly maxPoolSize: number = 10;
  private readonly maxConnectionAge: number = 30 * 60 * 1000; // 30 minutes

  private evictStaleConnections(): void {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [id, age] of this.connectionAges) {
      if (now - age > this.maxConnectionAge) {
        toEvict.push(id);
      }
    }

    for (const id of toEvict) {
      console.error(`Evicting stale SSH connection: ${id}`);
      this.closeConnection(id);
    }
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestAge = Infinity;

    for (const [id, age] of this.connectionAges) {
      if (age < oldestAge) {
        oldestAge = age;
        oldestId = id;
      }
    }

    if (oldestId) {
      console.error(`Pool full, evicting oldest connection: ${oldestId}`);
      this.closeConnection(oldestId);
    }
  }

  async getConnection(connectionId: string, config: SSHConnectionConfig): Promise<SSHConnection> {
    // Evict stale connections periodically
    this.evictStaleConnections();

    let connection = this.connections.get(connectionId);

    if (!connection) {
      // Check if we need to evict due to pool size limit
      if (this.connections.size >= this.maxPoolSize) {
        this.evictOldest();
      }

      connection = new SSHConnection(config);
      this.connections.set(connectionId, connection);
      this.connectionAges.set(connectionId, Date.now());
      await connection.connect();
    } else if (!connection.isActive()) {
      await connection.connect();
    }

    // Update last access time
    this.connectionAges.set(connectionId, Date.now());

    return connection;
  }

  async getRemoteShellType(connectionId: string): Promise<'bash' | 'sh' | 'powershell' | 'cmd' | 'unknown'> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return 'unknown';
    }
    return connection.getShellType();
  }

  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.disconnect();
      this.connections.delete(connectionId);
      this.connectionAges.delete(connectionId);
    }
  }

  closeAll(): void {
    for (const connection of this.connections.values()) {
      connection.disconnect();
    }
    this.connections.clear();
    this.connectionAges.clear();
  }

  getPoolStats(): { size: number; maxSize: number; connectionIds: string[] } {
    return {
      size: this.connections.size,
      maxSize: this.maxPoolSize,
      connectionIds: Array.from(this.connections.keys())
    };
  }
}