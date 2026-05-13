import { promises as fs } from 'node:fs';
import os from 'node:os';

/**
 * Snapshot of host-level metadata used by both `/health/deep` and the
 * telemetry agent. **No PHI** — everything here is process- or
 * OS-level. Disk usage is best-effort (uses statfs where available;
 * falls back to NaN on platforms that don't support it). All fields are
 * percentages 0-100 unless otherwise documented.
 */
export interface SystemMetrics {
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  loadAverage1m: number;
  uptimeSeconds: number;
}

let lastSample: { idle: number; total: number } | null = null;

function readCpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const value of Object.values(cpu.times)) {
      total += value;
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

/**
 * CPU percent over the interval since the previous call. The first
 * call returns 0 because there's no baseline yet; subsequent calls
 * return the load between samples. This is the standard "delta of
 * /proc/stat" pattern, and works on macOS/Linux via Node's `os.cpus()`.
 */
export function sampleCpuPercent(): number {
  const sample = readCpuTimes();
  if (!lastSample) {
    lastSample = sample;
    return 0;
  }
  const idleDelta = sample.idle - lastSample.idle;
  const totalDelta = sample.total - lastSample.total;
  lastSample = sample;
  if (totalDelta <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

/** Memory in use as a percentage of total. Includes buffers/cache on Linux. */
export function ramPercent(): number {
  const total = os.totalmem();
  if (total <= 0) {
    return 0;
  }
  const used = total - os.freemem();
  return Math.max(0, Math.min(100, (used / total) * 100));
}

/**
 * Disk usage for the path containing the working directory.
 * `fs.statfs` lands in Node 18.15+; older platforms get NaN.
 */
export async function diskPercent(probePath = '.'): Promise<number> {
  type Statfs = (path: string) => Promise<{ blocks: bigint | number; bfree: bigint | number; bsize: bigint | number }>;
  const statfs = (fs as unknown as { statfs?: Statfs }).statfs;
  if (typeof statfs !== 'function') {
    return Number.NaN;
  }
  try {
    const s = await statfs(probePath);
    const blocks = Number(s.blocks);
    const free = Number(s.bfree);
    if (blocks <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, ((blocks - free) / blocks) * 100));
  } catch {
    return Number.NaN;
  }
}

export async function sampleSystemMetrics(): Promise<SystemMetrics> {
  const [cpu, ram, disk] = [sampleCpuPercent(), ramPercent(), await diskPercent()];
  return {
    cpuPercent: Number(cpu.toFixed(2)),
    ramPercent: Number(ram.toFixed(2)),
    diskPercent: Number.isNaN(disk) ? 0 : Number(disk.toFixed(2)),
    loadAverage1m: os.loadavg()[0] ?? 0,
    uptimeSeconds: Math.floor(os.uptime()),
  };
}

/** For tests — reset the CPU baseline so a test gets a deterministic first reading. */
export function _resetCpuSamplerForTests(): void {
  lastSample = null;
}
