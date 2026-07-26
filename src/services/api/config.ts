/**
 * Where the Elevyn brain lives.
 *
 * Local:  defaults to the loopback brain on this Mac.
 * Hosted: set VITE_ELEVYN_API (and VITE_ELEVYN_TOKEN if the brain is gated)
 *         at build time — Vercel injects them into the bundle.
 */

const RAW_BASE = import.meta.env.VITE_ELEVYN_API?.trim();

export const API_BASE = (RAW_BASE || 'http://127.0.0.1:8787').replace(/\/+$/, '');

export const API_TOKEN = import.meta.env.VITE_ELEVYN_TOKEN?.trim() ?? '';

/** True when a deployed page is pointing at a localhost brain — it can never connect. */
export const isMisconfigured =
  typeof window !== 'undefined' &&
  window.location.protocol === 'https:' &&
  /^https?:\/\/(127\.0\.0\.1|localhost)/.test(API_BASE);

if (isMisconfigured) {
  console.warn(
    '[elevyn] This deployment has no VITE_ELEVYN_API set, so it is trying to reach a local brain. ' +
      'Set VITE_ELEVYN_API to your hosted brain URL and redeploy.',
  );
}

export function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}
