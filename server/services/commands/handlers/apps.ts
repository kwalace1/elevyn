import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { macOnly } from '../../platform.js';
import type { CommandHandler } from '../registry.js';

const execFileAsync = promisify(execFile);

/**
 * Open a macOS application by name via `open -a`.
 * Extensible: args.app is free-form; aliases are resolved in ElevynBrain.
 */
export const openAppCommand: CommandHandler = {
  id: 'open.app',
  name: 'Open Application',
  description: 'Open a macOS application by name',
  examples: ['Open Cursor', 'Launch Spotify', 'Open Terminal'],
  intents: ['open', 'launch', 'start'],
  async execute({ args }) {
    const unsupported = macOnly();
    if (unsupported) return unsupported;

    const app = String(args.app ?? '').trim();
    if (!app) {
      return { success: false, message: 'No application specified.' };
    }

    await execFileAsync('open', ['-a', app]);
    return { success: true, message: `Opened ${app}.`, data: { app } };
  },
};

export const closeAppCommand: CommandHandler = {
  id: 'close.app',
  name: 'Close Application',
  description: 'Quit a macOS application by name',
  examples: ['Close Spotify', 'Quit Chrome'],
  intents: ['close', 'quit'],
  async execute({ args }) {
    const unsupported = macOnly();
    if (unsupported) return unsupported;

    const app = String(args.app ?? '').trim();
    if (!app) {
      return { success: false, message: 'No application specified.' };
    }

    const script = `tell application "${app.replace(/"/g, '\\"')}" to quit`;
    await execFileAsync('osascript', ['-e', script]);
    return { success: true, message: `Closed ${app}.`, data: { app } };
  },
};
