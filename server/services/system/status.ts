import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { isMac } from '../platform.js';
import type {
  RunningApp,
  SystemHealth,
  SystemSnapshot,
} from '../../../src/types/index.js';

const execFileAsync = promisify(execFile);

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  const [internetOnline, apps] = await Promise.all([
    checkInternet(),
    listRunningApps(),
  ]);

  const health = getHealth();

  return {
    macbook: {
      id: 'macbook',
      name: isMac ? 'MacBook' : 'Host',
      online: isMac,
      detail: isMac
        ? `${os.hostname()} · ${health.memoryUsedPercent}% memory`
        : 'Hosted brain — Mac control unavailable',
    },
    windows: {
      id: 'windows',
      name: 'Windows PC',
      online: false,
      detail: 'Bridge offline — coming in v0.2',
    },
    internet: {
      id: 'internet',
      name: 'Internet',
      online: internetOnline,
      detail: internetOnline ? 'Connected' : 'Offline',
    },
    health,
    apps,
    timestamp: new Date().toISOString(),
  };
}

function getHealth(): SystemHealth {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPercent = Math.round(((total - free) / total) * 100);
  const load = os.loadavg()[0] ?? 0;
  const cpuCount = os.cpus().length || 1;

  return {
    cpuLoad: Math.min(100, Math.round((load / cpuCount) * 100)),
    memoryUsedPercent: usedPercent,
    uptimeSeconds: Math.round(os.uptime()),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
  };
}

async function checkInternet(): Promise<boolean> {
  try {
    const res = await fetch('https://captive.apple.com/hotspot-detect.html', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function listRunningApps(): Promise<RunningApp[]> {
  // No desktop session on a hosted brain — don't shell out to osascript.
  if (!isMac) return [];

  try {
    const script = `
      tell application "System Events"
        set appNames to name of every process whose background only is false
      end tell
      set AppleScript's text item delimiters to linefeed
      return appNames as text
    `;
    const { stdout } = await execFileAsync('osascript', ['-e', script]);
    return stdout
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((name) => ({ name }));
  } catch {
    return [
      { name: 'Finder' },
      { name: 'Cursor' },
      { name: 'Terminal' },
    ];
  }
}
