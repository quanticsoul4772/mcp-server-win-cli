# Phase 5C: System Monitoring Tools - Implementation Research

## Executive Summary

This document provides comprehensive research and implementation recommendations for Phase 5C System Monitoring Tools. The analysis covers Node.js built-in modules, npm packages, Windows-specific APIs, and security considerations for implementing CPU, memory, disk, process monitoring, DNS lookup, and network connectivity testing.

## Current State Analysis

### Existing Monitoring Capabilities

The server already has **partial system monitoring** implemented in `ReadSystemInfoTool.ts`:

**Currently Available:**
- ✅ Memory monitoring (total, free, used, usage %)
- ✅ CPU info (core count, model)
- ✅ Basic system info (OS, Node.js version, uptime)
- ✅ Shell availability detection
- ✅ Admin rights checking

**Missing Capabilities (Phase 5C Scope):**
- ❌ Real-time CPU usage monitoring
- ❌ Disk space monitoring (per drive)
- ❌ Process listing and monitoring
- ❌ DNS lookup capabilities
- ❌ Network connectivity testing (ping/connectivity check)

## Recommended Implementation Approach

### Strategy: **Hybrid Built-in + PowerShell Commands**

**Rationale:**
1. **No new dependencies** - Leverages existing Node.js built-in modules
2. **Windows-optimized** - Uses PowerShell for Windows-specific features
3. **Security-aligned** - Reuses existing CommandExecutor with validation
4. **Maintainability** - Minimal external dependencies to maintain

---

## Tool-by-Tool Implementation Plan

### 1. CPU Usage Monitoring Tool

#### Tool Name: `get_cpu_usage`

#### Implementation Options:

**Option A: Built-in `os` module (RECOMMENDED for cross-platform)**
```typescript
import os from 'os';

// Snapshot approach - measure over time interval
function getCPUUsage(duration: number = 1000): Promise<number> {
  const startMeasure = cpuAverage();

  return new Promise((resolve) => {
    setTimeout(() => {
      const endMeasure = cpuAverage();
      const idleDifference = endMeasure.idle - startMeasure.idle;
      const totalDifference = endMeasure.total - startMeasure.total;
      const percentageCPU = 100 - ~~(100 * idleDifference / totalDifference);
      resolve(percentageCPU);
    }, duration);
  });
}

function cpuAverage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;

  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}
```

**Option B: PowerShell Performance Counters (Windows-specific, more accurate)**
```typescript
// Via CommandExecutor
const command = `Get-Counter '\\Processor(_Total)\\% Processor Time' | Select-Object -ExpandProperty CounterSamples | Select-Object -ExpandProperty CookedValue`;

// Returns: numeric value (e.g., 45.2 for 45.2% CPU usage)
```

**RECOMMENDATION:** Use **Option A (os module)** for consistency with existing code
- Already used in `ReadSystemInfoTool.ts`
- Cross-platform compatible
- No command execution overhead
- Measurement interval configurable (default: 1 second)

#### Security Considerations:
- No command execution required
- Pure Node.js API usage
- No privilege escalation risk

---

### 2. Memory Usage Monitoring Tool

#### Tool Name: `get_memory_usage`

#### Implementation: **Enhance existing `ReadSystemInfoTool`**

The server already monitors memory via `os.totalmem()` and `os.freemem()`.

**Enhancement: Add detailed breakdown**
```typescript
import os from 'os';

interface MemoryInfo {
  total: {
    bytes: number;
    mb: number;
    gb: number;
  };
  free: {
    bytes: number;
    mb: number;
    gb: number;
  };
  used: {
    bytes: number;
    mb: number;
    gb: number;
  };
  usage_percent: number;
  available_percent: number;
}

function getMemoryUsage(): MemoryInfo {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    total: {
      bytes: total,
      mb: Math.round(total / 1024 / 1024),
      gb: Math.round(total / 1024 / 1024 / 1024 * 100) / 100
    },
    free: {
      bytes: free,
      mb: Math.round(free / 1024 / 1024),
      gb: Math.round(free / 1024 / 1024 / 1024 * 100) / 100
    },
    used: {
      bytes: used,
      mb: Math.round(used / 1024 / 1024),
      gb: Math.round(used / 1024 / 1024 / 1024 * 100) / 100
    },
    usage_percent: Math.round((used / total) * 100),
    available_percent: Math.round((free / total) * 100)
  };
}
```

**RECOMMENDATION:** Keep existing implementation, add as separate tool if more detail needed

---

### 3. Disk Space Monitoring Tool

#### Tool Name: `get_disk_space`

#### Implementation Options:

**Option A: PowerShell Get-PSDrive (RECOMMENDED)**
```typescript
// Via CommandExecutor
const command = `Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free, @{Name='Total';Expression={$_.Used + $_.Free}} | ConvertTo-Json`;

// Returns JSON array of drives:
// [
//   {
//     "Name": "C",
//     "Used": 123456789012,
//     "Free": 234567890123,
//     "Total": 358024679135
//   }
// ]
```

**Option B: PowerShell Get-Volume**
```typescript
const command = `Get-Volume | Where-Object {$_.DriveLetter} | Select-Object DriveLetter, FileSystemLabel, Size, SizeRemaining, @{Name='SizeUsed';Expression={$_.Size - $_.SizeRemaining}}, @{Name='PercentUsed';Expression={[math]::Round((($_.Size - $_.SizeRemaining) / $_.Size) * 100, 2)}} | ConvertTo-Json`;
```

**Option C: WMI Win32_LogicalDisk**
```typescript
const command = `Get-WmiObject -Class Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, Size, FreeSpace, @{Name='UsedSpace';Expression={$_.Size - $_.FreeSpace}}, @{Name='PercentFree';Expression={[math]::Round(($_.FreeSpace / $_.Size) * 100, 2)}} | ConvertTo-Json`;
```

**RECOMMENDATION:** Use **Option A (Get-PSDrive)**
- Simpler output parsing
- Faster execution
- Already returns values in bytes (consistent units)
- Native PowerShell cmdlet (no WMI overhead)

#### Parameters:
```typescript
interface GetDiskSpaceArgs {
  drive?: string;  // Optional: specific drive letter (e.g., "C", "D")
  format?: 'bytes' | 'mb' | 'gb';  // Default: 'gb'
}
```

#### Security Considerations:
- Read-only operation
- No file system modification
- Uses existing CommandExecutor validation
- PowerShell command is safe (no operators)

---

### 4. Process Listing Tool

#### Tool Name: `list_processes`

#### Implementation Options:

**Option A: PowerShell Get-Process (RECOMMENDED)**
```typescript
// Basic list
const command = `Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet, StartTime | ConvertTo-Json`;

// Filtered by name
const command = `Get-Process -Name ${processName} | Select-Object Id, ProcessName, CPU, WorkingSet, StartTime, Path | ConvertTo-Json`;

// Top N by CPU
const command = `Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} Id, ProcessName, CPU, WorkingSet | ConvertTo-Json`;

// Top N by Memory
const command = `Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First ${limit} Id, ProcessName, CPU, WorkingSet | ConvertTo-Json`;
```

**Option B: tasklist command (legacy)**
```typescript
const command = `tasklist /FO CSV /V`;
// Requires CSV parsing, less structured than PowerShell
```

**Option C: npm package `tasklist`**
- External dependency
- Not recommended (adds dependency)

**RECOMMENDATION:** Use **Option A (Get-Process)**
- Native PowerShell cmdlet
- Structured JSON output
- Rich filtering capabilities
- Consistent with server architecture

#### Parameters:
```typescript
interface ListProcessesArgs {
  filter?: {
    name?: string;           // Process name filter
    top_cpu?: number;        // Top N by CPU usage
    top_memory?: number;     // Top N by memory usage
  };
  include_system?: boolean;  // Include system processes (default: true)
}
```

#### Security Considerations - **CRITICAL**:

**Privacy & Security Risks:**
1. **Process Enumeration Attack Vector** - MITRE ATT&CK T1057
   - Adversaries enumerate processes to understand running software
   - Can reveal security tools, monitoring agents
   - Exposes user applications and behavior

2. **Sensitive Information Disclosure**
   - Process command lines may contain credentials, API keys
   - File paths reveal directory structure
   - Running processes indicate installed software

3. **Privilege Escalation Discovery**
   - Reveals high-privilege processes (LSASS, services)
   - Can be used to identify injection targets

**Mitigations:**
```typescript
// Security controls in implementation:
1. **Limit output fields** - Only return: PID, Name, CPU, Memory
   - DO NOT return: CommandLine, Path (unless explicitly requested)

2. **Implement filtering whitelist**
   - Block queries for sensitive processes by default:
     - lsass.exe (credential dumping target)
     - SecurityHealthService.exe
     - MsMpEng.exe (Windows Defender)

3. **Rate limiting**
   - Max 1 request per 5 seconds
   - Prevent rapid enumeration

4. **Audit logging**
   - Log all process listing requests
   - Include timestamp, user, filters used

5. **Configuration option**
   - `security.allowProcessListing: boolean` (default: false)
   - Require explicit opt-in
```

**Recommended Security Config Addition:**
```typescript
// In config.ts
export interface SecurityConfig {
  // ... existing fields
  allowProcessListing?: boolean;  // Default: false
  processListingFilters?: {
    blockedProcesses?: string[];  // Default: ['lsass.exe', 'csrss.exe', 'smss.exe']
    maxResults?: number;           // Default: 50
    rateLimitSeconds?: number;     // Default: 5
  };
}
```

---

### 5. DNS Lookup Tool

#### Tool Name: `dns_lookup`

#### Implementation: **Built-in `dns` module (RECOMMENDED)**

```typescript
import dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);
const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);
const dnsResolveMx = promisify(dns.resolveMx);
const dnsResolveTxt = promisify(dns.resolveTxt);

interface DnsLookupArgs {
  hostname: string;
  type?: 'A' | 'AAAA' | 'MX' | 'TXT' | 'ALL';  // Default: 'A'
  timeout?: number;  // Default: 5000ms
}

async function performDnsLookup(args: DnsLookupArgs): Promise<DnsResult> {
  const resolver = new dns.Resolver();
  resolver.setServers(['8.8.8.8', '8.8.4.4']);  // Google DNS

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('DNS lookup timeout')), args.timeout || 5000)
  );

  try {
    switch (args.type || 'A') {
      case 'A':
        const ipv4 = await Promise.race([dnsResolve4(args.hostname), timeoutPromise]);
        return { hostname: args.hostname, type: 'A', addresses: ipv4 };

      case 'AAAA':
        const ipv6 = await Promise.race([dnsResolve6(args.hostname), timeoutPromise]);
        return { hostname: args.hostname, type: 'AAAA', addresses: ipv6 };

      case 'MX':
        const mx = await Promise.race([dnsResolveMx(args.hostname), timeoutPromise]);
        return { hostname: args.hostname, type: 'MX', records: mx };

      case 'TXT':
        const txt = await Promise.race([dnsResolveTxt(args.hostname), timeoutPromise]);
        return { hostname: args.hostname, type: 'TXT', records: txt };

      case 'ALL':
        // Resolve all types
        const [a, aaaa, mx, txt] = await Promise.all([
          dnsResolve4(args.hostname).catch(() => []),
          dnsResolve6(args.hostname).catch(() => []),
          dnsResolveMx(args.hostname).catch(() => []),
          dnsResolveTxt(args.hostname).catch(() => [])
        ]);
        return { hostname: args.hostname, type: 'ALL', a, aaaa, mx, txt };
    }
  } catch (error) {
    throw new Error(`DNS lookup failed: ${error.message}`);
  }
}
```

#### Alternative: PowerShell Resolve-DnsName
```typescript
const command = `Resolve-DnsName -Name ${hostname} -Type ${type} | ConvertTo-Json`;
```

**RECOMMENDATION:** Use **Built-in dns module**
- No command execution overhead
- Better timeout control
- Cross-platform compatible
- Proper async/promise handling

#### Security Considerations:
- **DNS Tunneling Risk** - Validate hostname format
- **Rate Limiting** - Prevent DNS amplification abuse
- **Timeout Enforcement** - Prevent hanging requests
- **Hostname Validation** - Regex check for valid DNS names

```typescript
// Hostname validation
function isValidHostname(hostname: string): boolean {
  const hostnameRegex = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.?$/;
  return hostnameRegex.test(hostname) && hostname.length <= 253;
}
```

---

### 6. Network Connectivity Testing Tool

#### Tool Name: `test_connectivity`

#### Implementation Options:

**Option A: TCP Connection Test (RECOMMENDED)**
```typescript
import net from 'net';

interface ConnectivityTestArgs {
  host: string;
  port?: number;      // Default: 80 (HTTP) or 443 (HTTPS)
  timeout?: number;   // Default: 5000ms
  protocol?: 'http' | 'https' | 'tcp';
}

async function testConnectivity(args: ConnectivityTestArgs): Promise<ConnectivityResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const port = args.port || (args.protocol === 'https' ? 443 : 80);

    const socket = net.createConnection({
      host: args.host,
      port: port,
      timeout: args.timeout || 5000
    });

    socket.on('connect', () => {
      const latency = Date.now() - startTime;
      socket.destroy();
      resolve({
        status: 'connected',
        host: args.host,
        port: port,
        latency_ms: latency,
        reachable: true
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`Connection timeout after ${args.timeout}ms`));
    });

    socket.on('error', (error) => {
      socket.destroy();
      reject(new Error(`Connection failed: ${error.message}`));
    });
  });
}
```

**Option B: PowerShell Test-NetConnection**
```typescript
const command = `Test-NetConnection -ComputerName ${host} -Port ${port} | Select-Object ComputerName, RemotePort, TcpTestSucceeded, PingSucceeded | ConvertTo-Json`;
```

**Option C: ICMP Ping (requires elevated privileges on Windows)**
```typescript
// NOT RECOMMENDED - requires admin rights
const command = `ping -n 4 ${host}`;
```

**Option D: npm package `net-ping`**
- External dependency
- Requires raw socket access (admin rights)
- Not recommended

**RECOMMENDATION:** Use **Option A (TCP Connection)**
- No admin privileges required
- Built-in Node.js module
- Accurate latency measurement
- Works behind firewalls (ICMP often blocked)

#### Hybrid Approach (Best Coverage):
```typescript
async function testConnectivity(args: ConnectivityTestArgs): Promise<ConnectivityResult> {
  // 1. DNS resolution check
  const dnsResult = await performDnsLookup({ hostname: args.host, type: 'A' })
    .catch(error => ({ error: error.message, resolved: false }));

  // 2. TCP connection test
  const tcpResult = await tcpConnectTest({ host: args.host, port: args.port || 80 })
    .catch(error => ({ error: error.message, connected: false }));

  // 3. HTTP(S) request test (optional)
  if (args.protocol === 'http' || args.protocol === 'https') {
    const httpResult = await httpConnectTest({
      url: `${args.protocol}://${args.host}`
    }).catch(error => ({ error: error.message, success: false }));
  }

  return {
    host: args.host,
    dns_resolved: dnsResult.resolved,
    tcp_connected: tcpResult.connected,
    http_accessible: httpResult?.success || false,
    latency_ms: tcpResult.latency,
    ip_address: dnsResult.addresses?.[0],
    timestamp: new Date().toISOString()
  };
}
```

#### Security Considerations:
- **Port Scanning Prevention**
  - Limit to common ports: 80, 443, 22, 3389, 5432, 3306
  - Rate limit: 1 request per 5 seconds
  - Block private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)

- **SSRF Protection**
  - Validate target hostname
  - Block localhost/loopback (127.0.0.0/8, ::1)
  - Block metadata endpoints (169.254.169.254)

- **Timeout Enforcement**
  - Hard timeout: 10 seconds maximum
  - Prevent resource exhaustion

```typescript
// IP validation
function isPrivateOrLocalIP(ip: string): boolean {
  const privateRanges = [
    /^127\./,                      // Loopback
    /^10\./,                       // Private Class A
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
    /^192\.168\./,                 // Private Class C
    /^169\.254\./,                 // Link-local
    /^::1$/,                       // IPv6 loopback
    /^fe80:/,                      // IPv6 link-local
    /^fc00:/                       // IPv6 unique local
  ];

  return privateRanges.some(regex => regex.test(ip));
}
```

---

## NPM Package Recommendations

### Required: **NONE** ✅
All functionality can be implemented using built-in Node.js modules:
- `os` - CPU, memory, system info
- `dns` - DNS lookups
- `net` - Network connectivity
- `child_process` - PowerShell commands (already used)

### Optional (Not Recommended):
1. **systeminformation** (5.27.10)
   - ❌ Large dependency (869 dependents)
   - ❌ Cross-platform complexity unnecessary
   - ❌ Overkill for Windows-only server

2. **node-system-stats** (2.0.5)
   - ❌ Less maintained (5 months old)
   - ❌ Adds unnecessary abstraction

3. **tasklist** / **node-processlist**
   - ❌ External dependency for simple PowerShell command
   - ❌ Not actively maintained

4. **net-ping**
   - ❌ Requires raw sockets (admin rights)
   - ❌ TCP connection test is more reliable

### Decision: **Zero New Dependencies**
- Maintains project simplicity
- Reduces supply chain risk
- Leverages existing patterns (CommandExecutor for PowerShell)
- Built-in modules are well-tested and stable

---

## Built-in Node.js Modules Usage

### 1. `os` Module
**Documentation:** https://nodejs.org/api/os.html

**Used For:**
- `os.cpus()` - CPU info and usage calculation
- `os.totalmem()` - Total system memory
- `os.freemem()` - Free system memory
- `os.loadavg()` - System load average (Unix-like systems)
- `os.type()` - OS type
- `os.release()` - OS release version
- `os.hostname()` - System hostname
- `os.homedir()` - User home directory
- `os.tmpdir()` - Temp directory

**Example:**
```typescript
import os from 'os';

// CPU usage calculation
function getCPUInfo() {
  const cpus = os.cpus();
  return {
    count: cpus.length,
    model: cpus[0].model,
    speed_mhz: cpus[0].speed
  };
}

// Memory info
function getMemoryInfo() {
  return {
    total_bytes: os.totalmem(),
    free_bytes: os.freemem(),
    used_bytes: os.totalmem() - os.freemem()
  };
}
```

### 2. `dns` Module
**Documentation:** https://nodejs.org/api/dns.html

**Used For:**
- `dns.lookup()` - OS-level resolution (uses getaddrinfo)
- `dns.resolve4()` - IPv4 A records
- `dns.resolve6()` - IPv6 AAAA records
- `dns.resolveMx()` - MX records
- `dns.resolveTxt()` - TXT records
- `dns.Resolver` - Custom DNS resolver with timeout

**Example:**
```typescript
import dns from 'dns';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);

async function lookupDNS(hostname: string) {
  const addresses = await resolve4(hostname);
  return addresses;
}
```

### 3. `net` Module
**Documentation:** https://nodejs.org/api/net.html

**Used For:**
- `net.createConnection()` - TCP connection testing
- Socket timeout handling
- Connection latency measurement

**Example:**
```typescript
import net from 'net';

function testTCPConnection(host: string, port: number, timeout: number = 5000): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout });

    socket.on('connect', () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve(latency);
    });

    socket.on('error', reject);
    socket.on('timeout', () => reject(new Error('Timeout')));
  });
}
```

### 4. `child_process` Module (Already Used)
**Documentation:** https://nodejs.org/api/child_process.html

**Used For:**
- PowerShell command execution via `CommandExecutor`
- Already integrated with security validation

---

## Windows-Specific Command Patterns

### PowerShell Commands

#### 1. CPU Usage
```powershell
# Current CPU usage (one sample)
Get-Counter '\Processor(_Total)\% Processor Time' | Select-Object -ExpandProperty CounterSamples | Select-Object -ExpandProperty CookedValue

# Average over multiple samples
Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 5 | Select-Object -ExpandProperty CounterSamples | Measure-Object -Property CookedValue -Average | Select-Object -ExpandProperty Average
```

#### 2. Memory Usage
```powershell
# Basic memory info
Get-WmiObject -Class Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory | ConvertTo-Json

# Performance counter
Get-Counter '\Memory\Available MBytes' | Select-Object -ExpandProperty CounterSamples | Select-Object -ExpandProperty CookedValue
```

#### 3. Disk Space
```powershell
# All drives (recommended)
Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free, @{Name='Total';Expression={$_.Used + $_.Free}} | ConvertTo-Json

# Specific drive
Get-PSDrive C | Select-Object Name, Used, Free, @{Name='Total';Expression={$_.Used + $_.Free}} | ConvertTo-Json

# Detailed volume info
Get-Volume | Where-Object {$_.DriveLetter} | Select-Object DriveLetter, FileSystemLabel, Size, SizeRemaining, @{Name='PercentUsed';Expression={[math]::Round((($_.Size - $_.SizeRemaining) / $_.Size) * 100, 2)}} | ConvertTo-Json
```

#### 4. Process Listing
```powershell
# All processes (basic)
Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet | ConvertTo-Json

# Filter by name
Get-Process -Name chrome | Select-Object Id, ProcessName, CPU, WorkingSet, Path | ConvertTo-Json

# Top 10 by CPU
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Id, ProcessName, CPU, WorkingSet | ConvertTo-Json

# Top 10 by Memory
Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 10 Id, ProcessName, CPU, WorkingSet | ConvertTo-Json

# With detailed info (CAUTION: includes Path/CommandLine)
Get-Process | Select-Object Id, ProcessName, CPU, WorkingSet, StartTime, Path, Company | ConvertTo-Json
```

#### 5. Network Connectivity
```powershell
# Test TCP connection
Test-NetConnection -ComputerName google.com -Port 443 | Select-Object ComputerName, RemotePort, TcpTestSucceeded, PingSucceeded | ConvertTo-Json

# DNS resolution
Resolve-DnsName -Name google.com -Type A | ConvertTo-Json

# Ping (requires ICMP, often blocked)
Test-Connection -ComputerName google.com -Count 4 -Quiet
```

### WMIC Commands (Legacy, Deprecated in Windows 10+)

```cmd
# CPU info (legacy - use PowerShell instead)
wmic cpu get name, numberofcores, maxclockspeed

# Memory info (legacy)
wmic memorychip get capacity

# Disk info (legacy)
wmic logicaldisk get deviceid,size,freespace

# Process list (legacy)
wmic process list brief
```

**NOTE:** WMIC is deprecated and will be removed in future Windows versions. Use PowerShell equivalents.

---

## Security Considerations Summary

### 1. Process Listing - **HIGH RISK**

**Threats:**
- **T1057 - Process Discovery** (MITRE ATT&CK)
- Information disclosure (installed software, security tools)
- Privilege escalation reconnaissance
- Credential harvesting preparation (LSASS targeting)

**Mitigations:**
- ✅ Configuration gating (`allowProcessListing: false` by default)
- ✅ Blocked process list (LSASS, CSRSS, etc.)
- ✅ Limited output fields (no CommandLine/Path by default)
- ✅ Rate limiting (1 request per 5 seconds)
- ✅ Audit logging (all requests logged)
- ✅ Maximum results limit (50 default)

### 2. Network Connectivity - **MEDIUM RISK**

**Threats:**
- Server-Side Request Forgery (SSRF)
- Internal network scanning
- Port scanning/enumeration
- Cloud metadata endpoint access

**Mitigations:**
- ✅ IP range validation (block private/local IPs)
- ✅ Port whitelist (80, 443, 22, 3389, 5432, 3306)
- ✅ Timeout enforcement (10 second max)
- ✅ Rate limiting (1 request per 5 seconds)
- ✅ Hostname validation (DNS format check)
- ✅ Block metadata endpoints (169.254.169.254)

### 3. DNS Lookup - **LOW RISK**

**Threats:**
- DNS tunneling (data exfiltration)
- DNS amplification abuse

**Mitigations:**
- ✅ Hostname format validation
- ✅ Timeout enforcement (5 second default)
- ✅ Rate limiting
- ✅ Query type restrictions

### 4. CPU/Memory/Disk Monitoring - **LOW RISK**

**Threats:**
- Minimal - read-only operations
- Potential timing side-channel (negligible)

**Mitigations:**
- ✅ No command execution (use `os` module)
- ✅ No file system access
- ✅ Built-in module usage only

---

## Recommended Configuration Schema Updates

```typescript
// Add to src/types/config.ts

export interface SecurityConfig {
  // ... existing fields

  // Process listing controls
  allowProcessListing?: boolean;  // Default: false
  processListingFilters?: {
    blockedProcesses?: string[];   // Default: ['lsass.exe', 'csrss.exe', 'smss.exe']
    maxResults?: number;            // Default: 50
    rateLimitSeconds?: number;      // Default: 5
    includeCommandLine?: boolean;   // Default: false (security risk)
    includePath?: boolean;          // Default: false (security risk)
  };

  // Network connectivity controls
  allowNetworkTests?: boolean;     // Default: true
  networkTestFilters?: {
    allowedPorts?: number[];        // Default: [80, 443, 22, 3389, 5432, 3306]
    blockPrivateIPs?: boolean;      // Default: true
    blockLocalhost?: boolean;       // Default: true
    maxTimeoutSeconds?: number;     // Default: 10
    rateLimitSeconds?: number;      // Default: 5
  };

  // DNS lookup controls
  allowDnsLookup?: boolean;         // Default: true
  dnsLookupFilters?: {
    allowedTypes?: string[];        // Default: ['A', 'AAAA', 'MX', 'TXT']
    maxTimeoutSeconds?: number;     // Default: 5
    rateLimitSeconds?: number;      // Default: 2
  };
}

export interface MonitoringConfig {
  // CPU monitoring
  cpu?: {
    enabled?: boolean;              // Default: true
    sampleIntervalMs?: number;      // Default: 1000
  };

  // Memory monitoring
  memory?: {
    enabled?: boolean;              // Default: true
  };

  // Disk monitoring
  disk?: {
    enabled?: boolean;              // Default: true
    includedDrives?: string[];      // Default: [] (all drives)
  };
}
```

---

## Sample Implementation for Each Tool

### Tool 1: GetCpuUsageTool

```typescript
import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import os from 'os';

interface GetCpuUsageArgs {
  sample_interval_ms?: number;  // Default: 1000
}

export class GetCpuUsageTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'get_cpu_usage',
      '[System Monitoring] Get current CPU usage percentage',
      'System Monitoring'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        sample_interval_ms: {
          type: 'number',
          description: 'Sampling interval in milliseconds (default: 1000, min: 100, max: 10000)',
          minimum: 100,
          maximum: 10000
        }
      }
    };
  }

  async execute(args: GetCpuUsageArgs): Promise<ToolResult> {
    const interval = args.sample_interval_ms || 1000;

    try {
      const cpuUsage = await this.measureCPUUsage(interval);
      const cpus = os.cpus();

      const result = {
        cpu_usage_percent: cpuUsage,
        cores: cpus.length,
        model: cpus[0]?.model || 'unknown',
        speed_mhz: cpus[0]?.speed || 0,
        sample_interval_ms: interval,
        timestamp: new Date().toISOString()
      };

      return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to get CPU usage: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }

  private measureCPUUsage(duration: number): Promise<number> {
    const startMeasure = this.cpuAverage();

    return new Promise((resolve) => {
      setTimeout(() => {
        const endMeasure = this.cpuAverage();
        const idleDifference = endMeasure.idle - startMeasure.idle;
        const totalDifference = endMeasure.total - startMeasure.total;
        const percentageCPU = 100 - Math.floor(100 * idleDifference / totalDifference);
        resolve(percentageCPU);
      }, duration);
    });
  }

  private cpuAverage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });

    return {
      idle: totalIdle / cpus.length,
      total: totalTick / cpus.length
    };
  }
}
```

### Tool 2: GetDiskSpaceTool

```typescript
import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import type { CommandExecutor } from '../../services/CommandExecutor.js';

interface GetDiskSpaceArgs {
  drive?: string;  // Optional: specific drive letter (e.g., "C")
  format?: 'bytes' | 'mb' | 'gb';  // Default: 'gb'
}

export class GetDiskSpaceTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'get_disk_space',
      '[System Monitoring] Get disk space usage for all drives or a specific drive',
      'System Monitoring'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        drive: {
          type: 'string',
          description: 'Optional: specific drive letter (e.g., "C", "D")',
          pattern: '^[A-Za-z]$'
        },
        format: {
          type: 'string',
          enum: ['bytes', 'mb', 'gb'],
          description: 'Output format (default: gb)'
        }
      }
    };
  }

  async execute(args: GetDiskSpaceArgs): Promise<ToolResult> {
    const executor = this.getService<CommandExecutor>('CommandExecutor');
    const format = args.format || 'gb';

    // Build PowerShell command
    const command = args.drive
      ? `Get-PSDrive ${args.drive.toUpperCase()} | Select-Object Name, Used, Free, @{Name='Total';Expression={$_.Used + $_.Free}} | ConvertTo-Json`
      : `Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free, @{Name='Total';Expression={$_.Used + $_.Free}} | ConvertTo-Json`;

    try {
      const result = await executor.execute({
        shell: 'powershell',
        command: command,
        timeout: 10
      });

      if (result.exitCode !== 0) {
        return this.error(`Failed to get disk space: ${result.output}`, result.exitCode);
      }

      // Parse JSON output
      const drives = JSON.parse(result.output);
      const driveArray = Array.isArray(drives) ? drives : [drives];

      // Convert to requested format
      const formatted = driveArray.map(drive => ({
        drive: drive.Name,
        total: this.convertBytes(drive.Total || 0, format),
        used: this.convertBytes(drive.Used || 0, format),
        free: this.convertBytes(drive.Free || 0, format),
        usage_percent: drive.Total ? Math.round((drive.Used / drive.Total) * 100) : 0,
        format: format
      }));

      return this.success(JSON.stringify({ drives: formatted, timestamp: new Date().toISOString() }, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `Failed to get disk space: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }

  private convertBytes(bytes: number, format: string): number {
    switch (format) {
      case 'mb':
        return Math.round(bytes / 1024 / 1024);
      case 'gb':
        return Math.round(bytes / 1024 / 1024 / 1024 * 100) / 100;
      default:
        return bytes;
    }
  }
}
```

### Tool 3: DnsLookupTool

```typescript
import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import dns from 'dns';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);
const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);

interface DnsLookupArgs {
  hostname: string;
  type?: 'A' | 'AAAA' | 'MX' | 'TXT' | 'ALL';
  timeout?: number;  // Default: 5000ms
}

export class DnsLookupTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'dns_lookup',
      '[System Monitoring] Perform DNS lookup for a hostname',
      'System Monitoring'
    );
  }

  getInputSchema() {
    return {
      type: 'object',
      properties: {
        hostname: {
          type: 'string',
          description: 'Hostname to lookup (e.g., google.com)'
        },
        type: {
          type: 'string',
          enum: ['A', 'AAAA', 'MX', 'TXT', 'ALL'],
          description: 'DNS record type (default: A)'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 5000, max: 10000)',
          minimum: 1000,
          maximum: 10000
        }
      },
      required: ['hostname']
    };
  }

  async execute(args: DnsLookupArgs): Promise<ToolResult> {
    // Validate hostname
    if (!this.isValidHostname(args.hostname)) {
      return this.validationError(`Invalid hostname format: ${args.hostname}`);
    }

    const timeout = args.timeout || 5000;
    const type = args.type || 'A';

    try {
      const result = await this.performLookup(args.hostname, type, timeout);

      return this.success(JSON.stringify({
        hostname: args.hostname,
        type: type,
        result: result,
        timestamp: new Date().toISOString()
      }, null, 2), { exitCode: 0 });
    } catch (error) {
      return this.error(
        `DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        -1
      );
    }
  }

  private async performLookup(hostname: string, type: string, timeout: number): Promise<any> {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`DNS lookup timeout after ${timeout}ms`)), timeout)
    );

    try {
      switch (type) {
        case 'A':
          return { addresses: await Promise.race([resolve4(hostname), timeoutPromise]) };
        case 'AAAA':
          return { addresses: await Promise.race([resolve6(hostname), timeoutPromise]) };
        case 'MX':
          return { records: await Promise.race([resolveMx(hostname), timeoutPromise]) };
        case 'TXT':
          return { records: await Promise.race([resolveTxt(hostname), timeoutPromise]) };
        case 'ALL':
          const [a, aaaa, mx, txt] = await Promise.all([
            resolve4(hostname).catch(() => []),
            resolve6(hostname).catch(() => []),
            resolveMx(hostname).catch(() => []),
            resolveTxt(hostname).catch(() => [])
          ]);
          return { a, aaaa, mx, txt };
        default:
          throw new Error(`Unsupported DNS type: ${type}`);
      }
    } catch (error) {
      throw error;
    }
  }

  private isValidHostname(hostname: string): boolean {
    const hostnameRegex = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.?$/;
    return hostnameRegex.test(hostname) && hostname.length <= 253;
  }
}
```

### Tool 4: TestConnectivityTool

```typescript
import { BaseTool } from '../base/BaseTool.js';
import type { ServiceContainer } from '../../server/ServiceContainer.js';
import type { ToolResult } from '../base/types.js';
import net from 'net';
import dns from 'dns';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);

interface TestConnectivityArgs {
  host: string;
  port?: number;
  timeout?: number;  // Default: 5000ms
  include_dns?: boolean;  // Default: true
}

export class TestConnectivityTool extends BaseTool {
  constructor(container: ServiceContainer) {
    super(
      container,
      'test_connectivity',
      '[System Monitoring] Test network connectivity to a host',
      'System Monitoring'
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
          description: 'Port number (default: 80)',
          minimum: 1,
          maximum: 65535
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 5000, max: 10000)',
          minimum: 1000,
          maximum: 10000
        },
        include_dns: {
          type: 'boolean',
          description: 'Include DNS resolution check (default: true)'
        }
      },
      required: ['host']
    };
  }

  async execute(args: TestConnectivityArgs): Promise<ToolResult> {
    const configManager = this.getService<any>('ConfigManager');
    const security = configManager.getSecurity();

    // Security check
    if (security.networkTestFilters?.blockPrivateIPs && this.isPrivateIP(args.host)) {
      return this.validationError('Cannot test connectivity to private IP addresses');
    }

    const port = args.port || 80;
    const timeout = args.timeout || 5000;
    const includeDns = args.include_dns !== false;

    // Check port whitelist
    const allowedPorts = security.networkTestFilters?.allowedPorts || [80, 443, 22, 3389, 5432, 3306];
    if (!allowedPorts.includes(port)) {
      return this.validationError(`Port ${port} is not in the allowed ports list: ${allowedPorts.join(', ')}`);
    }

    const result: any = {
      host: args.host,
      port: port,
      timestamp: new Date().toISOString()
    };

    try {
      // DNS resolution
      if (includeDns) {
        try {
          const addresses = await resolve4(args.host);
          result.dns_resolved = true;
          result.ip_address = addresses[0];
        } catch (error) {
          result.dns_resolved = false;
          result.dns_error = error instanceof Error ? error.message : String(error);
        }
      }

      // TCP connection test
      const startTime = Date.now();
      const connected = await this.testTCPConnection(args.host, port, timeout);

      if (connected) {
        result.tcp_connected = true;
        result.latency_ms = Date.now() - startTime;
        result.status = 'reachable';

        return this.success(JSON.stringify(result, null, 2), { exitCode: 0 });
      } else {
        result.tcp_connected = false;
        result.status = 'unreachable';

        return this.error(JSON.stringify(result, null, 2), -1);
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.status = 'failed';

      return this.error(JSON.stringify(result, null, 2), -1);
    }
  }

  private testTCPConnection(host: string, port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout });

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  private isPrivateIP(ip: string): boolean {
    const privateRanges = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
      /^::1$/,
      /^fe80:/,
      /^fc00:/
    ];

    return privateRanges.some(regex => regex.test(ip));
  }
}
```

---

## Implementation Priority

### Phase 1 (Essential - Low Risk)
1. ✅ **GetCpuUsageTool** - Pure `os` module, no security concerns
2. ✅ **GetDiskSpaceTool** - PowerShell read-only, minimal risk
3. ✅ **DnsLookupTool** - Built-in module, basic validation needed

### Phase 2 (Medium Risk - Requires Security Controls)
4. ⚠️ **TestConnectivityTool** - Needs SSRF protection, port whitelist
5. ⚠️ **ListProcessesTool** - HIGH RISK, requires extensive controls

### Phase 3 (Optional Enhancements)
6. 📊 Enhanced metrics (CPU per-core, memory breakdown)
7. 📊 Historical monitoring (time-series data)
8. 📊 Alert thresholds (configurable limits)

---

## Testing Strategy

### Unit Tests (Jest)

```typescript
// __tests__/tools/GetCpuUsageTool.test.ts
describe('GetCpuUsageTool', () => {
  it('should return CPU usage between 0-100', async () => {
    const tool = new GetCpuUsageTool(container);
    const result = await tool.execute({ sample_interval_ms: 100 });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content);
    expect(data.cpu_usage_percent).toBeGreaterThanOrEqual(0);
    expect(data.cpu_usage_percent).toBeLessThanOrEqual(100);
  });
});

// __tests__/tools/TestConnectivityTool.test.ts
describe('TestConnectivityTool', () => {
  it('should block private IP addresses', async () => {
    const tool = new TestConnectivityTool(container);
    const result = await tool.execute({ host: '192.168.1.1', port: 80 });

    expect(result.success).toBe(false);
    expect(result.content).toContain('private IP');
  });

  it('should block non-whitelisted ports', async () => {
    const tool = new TestConnectivityTool(container);
    const result = await tool.execute({ host: 'google.com', port: 9999 });

    expect(result.success).toBe(false);
    expect(result.content).toContain('not in the allowed ports');
  });
});
```

### Integration Tests

```typescript
// Test PowerShell command execution
describe('GetDiskSpaceTool Integration', () => {
  it('should retrieve disk space from PowerShell', async () => {
    const tool = new GetDiskSpaceTool(container);
    const result = await tool.execute({ drive: 'C' });

    expect(result.success).toBe(true);
    const data = JSON.parse(result.content);
    expect(data.drives).toHaveLength(1);
    expect(data.drives[0].drive).toBe('C');
  });
});
```

---

## Documentation Requirements

### 1. Update README.md
Add new tools section:
```markdown
### System Monitoring Tools

- **get_cpu_usage** - Get current CPU usage percentage
- **get_disk_space** - Get disk space usage for all drives
- **dns_lookup** - Perform DNS lookups (A, AAAA, MX, TXT records)
- **test_connectivity** - Test network connectivity to hosts
- **list_processes** - List running processes (requires opt-in configuration)
```

### 2. Update CLAUDE.md
Add implementation patterns for monitoring tools

### 3. Create SECURITY_MONITORING.md
Document security controls for process listing and network testing

### 4. Update Configuration Guide
Document new security settings in config schema

---

## Conclusion

### Summary of Recommendations

1. **Zero New Dependencies** - Use built-in Node.js modules exclusively
2. **Hybrid Approach** - Combine `os` module + PowerShell commands
3. **Security-First** - Implement strict controls for high-risk tools
4. **Phased Rollout** - Start with low-risk tools, add security controls progressively

### Implementation Checklist

- [ ] Implement GetCpuUsageTool (os module)
- [ ] Implement GetDiskSpaceTool (PowerShell)
- [ ] Implement DnsLookupTool (dns module)
- [ ] Implement TestConnectivityTool (net module + security)
- [ ] Implement ListProcessesTool (PowerShell + extensive security)
- [ ] Add security configuration schema
- [ ] Write unit tests for all tools
- [ ] Write integration tests for PowerShell commands
- [ ] Update documentation (README, CLAUDE.md, security docs)
- [ ] Add audit logging for high-risk operations

### Next Steps

1. Review and approve this research document
2. Prioritize tool implementation order
3. Create GitHub issues for each tool
4. Begin implementation starting with low-risk tools
5. Conduct security review before enabling process listing

---

**Document Version:** 1.0
**Last Updated:** 2025-10-09
**Author:** Research Analysis for Phase 5C Implementation
