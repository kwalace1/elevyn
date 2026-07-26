/**
 * Platform capabilities.
 *
 * Elevyn's brain runs in two places:
 *   - Kevin's Mac  → full OS control (open apps, lock, AppleScript, `say`).
 *   - Cloud host   → Linux container, no desktop. Those commands must fail
 *                    politely instead of throwing ENOENT at the user.
 */

import type { CommandExecutionResult } from '../../src/types/index.js';

export const isMac = process.platform === 'darwin';

/** True when this brain is running as a hosted (non-desktop) instance. */
export const isHosted = !isMac || process.env.ELEVYN_HOSTED === '1';

export const MAC_ONLY_MESSAGE =
  'That control needs the brain running on your Mac, sir. This instance is hosted.';

/** Guard for handlers that shell out to macOS-only binaries. */
export function macOnly(): CommandExecutionResult | null {
  if (isMac) return null;
  return { success: false, message: MAC_ONLY_MESSAGE };
}
