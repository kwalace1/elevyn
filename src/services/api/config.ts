/**
 * Where the Elevyn brain lives.
 *
 * Default: same-origin `/api`
 *   - Local `npm run dev`  → Vite proxies /api → the Mac brain on :8787
 *   - Vercel production    → /api is the serverless Express brain
 *
 * Override with VITE_ELEVYN_API only if you intentionally point at a remote brain.
 */

const RAW_BASE = import.meta.env.VITE_ELEVYN_API?.trim();

export const API_BASE = (RAW_BASE ?? '').replace(/\/+$/, '');

export const API_TOKEN = import.meta.env.VITE_ELEVYN_TOKEN?.trim() ?? '';

/** True when a deployed HTTPS page is still pointed at a localhost brain. */
export const isMisconfigured =
  typeof window !== 'undefined' &&
  window.location.protocol === 'https:' &&
  /^https?:\/\/(127\.0\.0\.1|localhost)/.test(API_BASE);

if (isMisconfigured) {
  console.warn(
    '[elevyn] This deployment points VITE_ELEVYN_API at localhost. ' +
      'Clear that env var so the UI uses the same-origin /api brain on Vercel.',
  );
}

export function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}
