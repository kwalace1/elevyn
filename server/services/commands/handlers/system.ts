import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { macOnly } from '../../platform.js';
import type { CommandHandler } from '../registry.js';

const execFileAsync = promisify(execFile);

/**
 * System-level commands. Destructive actions (shutdown/restart) are registered
 * but gated — MVP only enables lock + sleep for safety during demos.
 */
export const lockComputerCommand: CommandHandler = {
  id: 'system.lock',
  name: 'Lock Computer',
  description: 'Lock the macOS screen',
  examples: ['Lock the computer', 'Lock screen'],
  async execute() {
    const unsupported = macOnly();
    if (unsupported) return unsupported;

    await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to keystroke "q" using {control down, command down}',
    ]);
    return { success: true, message: 'Screen locked.' };
  },
};

export const sleepComputerCommand: CommandHandler = {
  id: 'system.sleep',
  name: 'Sleep Computer',
  description: 'Put the Mac to sleep',
  examples: ['Sleep the computer', 'Put Mac to sleep'],
  async execute() {
    const unsupported = macOnly();
    if (unsupported) return unsupported;

    await execFileAsync('pmset', ['sleepnow']);
    return { success: true, message: 'Sleeping.' };
  },
};

export const runAppleScriptCommand: CommandHandler = {
  id: 'system.applescript',
  name: 'Run AppleScript',
  description: 'Execute an AppleScript snippet',
  examples: ['Run AppleScript to notify me'],
  async execute({ args }) {
    const unsupported = macOnly();
    if (unsupported) return unsupported;

    const script = String(args.script ?? '').trim();
    if (!script) {
      return { success: false, message: 'No AppleScript provided.' };
    }
    const { stdout } = await execFileAsync('osascript', ['-e', script]);
    return {
      success: true,
      message: 'AppleScript executed.',
      data: { stdout: stdout.trim() },
    };
  },
};

export const runTerminalCommand: CommandHandler = {
  id: 'system.terminal',
  name: 'Run Terminal Command',
  description: 'Execute a shell command (allowlisted in future versions)',
  examples: ['Run ls in terminal'],
  async execute({ args }) {
    // Safety: MVP refuses arbitrary shell. Registry exists; executor is gated.
    const command = String(args.command ?? '').trim();
    if (!command) {
      return { success: false, message: 'No command provided.' };
    }
    return {
      success: false,
      message:
        'Arbitrary terminal execution is disabled in MVP. Register an allowlisted handler to enable it.',
      data: { command },
    };
  },
};
