/**
 * Zod schemas for runtime validation
 * Provides type safety beyond TypeScript compile-time checks
 */

import { z } from 'zod';

// SSH Connection Config Schema
export const SSHConnectionConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  privateKeyPath: z.string().optional(),
  keepaliveInterval: z.number().int().positive().optional(),
  keepaliveCountMax: z.number().int().positive().optional(),
  readyTimeout: z.number().int().positive().optional(),
}).refine(
  (data) => data.password || data.privateKeyPath,
  {
    message: 'Either password or privateKeyPath must be provided',
    path: ['password'],
  }
);

// Shell Config Schema
export const ShellConfigSchema = z.object({
  enabled: z.boolean(),
  command: z.string().min(1),
  args: z.array(z.string()),
  blockedOperators: z.array(z.string()).optional(),
});

// Security Config Schema
export const SecurityConfigSchema = z.object({
  maxCommandLength: z.number().int().positive(),
  blockedCommands: z.array(z.string()),
  blockedArguments: z.array(z.string()),
  allowedPaths: z.array(z.string().min(1)),
  restrictWorkingDirectory: z.boolean(),
  logCommands: z.boolean(),
  maxHistorySize: z.number().int().positive(),
  commandTimeout: z.number().int().positive(),
  enableInjectionProtection: z.boolean(),
});

// SSH Config Schema
export const SSHConfigSchema = z.object({
  enabled: z.boolean(),
  connections: z.record(z.string(), SSHConnectionConfigSchema),
  defaultTimeout: z.number().int().positive(),
  maxConcurrentSessions: z.number().int().positive(),
  keepaliveInterval: z.number().int().positive(),
  keepaliveCountMax: z.number().int().positive(),
  readyTimeout: z.number().int().positive(),
});

// Server Config Schema
export const ServerConfigSchema = z.object({
  security: SecurityConfigSchema,
  shells: z.object({
    powershell: ShellConfigSchema,
    cmd: ShellConfigSchema,
    gitbash: ShellConfigSchema,
  }),
  ssh: SSHConfigSchema,
});

// Command History Entry Schema
export const CommandHistoryEntrySchema = z.object({
  command: z.string(),
  output: z.string(),
  timestamp: z.string(),
  exitCode: z.number().int(),
  connectionId: z.string().optional(),
});

// Export type inference
export type ValidatedSSHConnectionConfig = z.infer<typeof SSHConnectionConfigSchema>;
export type ValidatedShellConfig = z.infer<typeof ShellConfigSchema>;
export type ValidatedSecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type ValidatedSSHConfig = z.infer<typeof SSHConfigSchema>;
export type ValidatedServerConfig = z.infer<typeof ServerConfigSchema>;
export type ValidatedCommandHistoryEntry = z.infer<typeof CommandHistoryEntrySchema>;
