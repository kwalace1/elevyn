/**
 * Microsoft 365 OAuth (work/school) — authorization code + PKCE.
 * Tokens live in encrypted httpOnly cookies (Kevin-only, no DB).
 */

import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Request, Response } from 'express';

const COOKIE_SESSION = 'elevyn_ms';
const COOKIE_PKCE = 'elevyn_ms_pkce';
const SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.Read',
  'Mail.Read',
  'Chat.Read',
  'OnlineMeetings.Read',
].join(' ');

export type MsTokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  account?: string;
};

type PkceBundle = {
  verifier: string;
  state: string;
};

function cfg() {
  const clientId = process.env.MS_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim() ?? '';
  const tenantId = process.env.MS_TENANT_ID?.trim() ?? '';
  const redirectUri = process.env.MS_REDIRECT_URI?.trim() ?? '';
  const secret = process.env.ELEVYN_TOKEN_SECRET?.trim() ?? '';
  return { clientId, clientSecret, tenantId, redirectUri, secret };
}

export function isMicrosoftConfigured(): boolean {
  const { clientId, clientSecret, tenantId, redirectUri, secret } = cfg();
  return Boolean(clientId && clientSecret && tenantId && redirectUri && secret);
}

function cookieSecure(req: Request): boolean {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

function baseCookie(req: Request) {
  return {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'lax' as const,
    path: '/',
  };
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function encryptPayload(secret: string, value: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decryptPayload(secret: string, packed: string): string | null {
  try {
    const buf = Buffer.from(packed, 'base64url');
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const key = deriveKey(secret);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Split large payloads across cookies (4KB limit). */
function writeChunkedCookie(
  res: Response,
  req: Request,
  name: string,
  value: string,
  maxAgeSec: number,
): void {
  const chunkSize = 3000;
  const chunks = Math.max(1, Math.ceil(value.length / chunkSize));
  for (let i = 0; i < chunks; i++) {
    res.cookie(`${name}_${i}`, value.slice(i * chunkSize, (i + 1) * chunkSize), {
      ...baseCookie(req),
      maxAge: maxAgeSec * 1000,
    });
  }
  // Clear a possible leftover next chunk from a prior larger session.
  res.clearCookie(`${name}_${chunks}`, { ...baseCookie(req) });
  res.cookie(`${name}_n`, String(chunks), {
    ...baseCookie(req),
    maxAge: maxAgeSec * 1000,
  });
}

function readChunkedCookie(req: Request, name: string): string | null {
  const cookies = parseCookies(req);
  const n = Number(cookies[`${name}_n`] ?? '0');
  if (!Number.isFinite(n) || n < 1) {
    // Legacy single cookie.
    return cookies[name] ?? null;
  }
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = cookies[`${name}_${i}`];
    if (!part) return null;
    out += part;
  }
  return out;
}

function clearChunkedCookie(res: Response, req: Request, name: string): void {
  const cookies = parseCookies(req);
  const n = Number(cookies[`${name}_n`] ?? '8');
  for (let i = 0; i < Math.max(n, 8); i++) {
    res.clearCookie(`${name}_${i}`, { ...baseCookie(req) });
  }
  res.clearCookie(`${name}_n`, { ...baseCookie(req) });
  res.clearCookie(name, { ...baseCookie(req) });
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.get('cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function authority(): string {
  const { tenantId } = cfg();
  return `https://login.microsoftonline.com/${tenantId}`;
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function beginLogin(req: Request, res: Response): void {
  if (!isMicrosoftConfigured()) {
    res.status(503).json({
      error: 'Microsoft 365 is not configured. Set MS_* and ELEVYN_TOKEN_SECRET.',
    });
    return;
  }
  const { clientId, redirectUri, secret } = cfg();
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const packed = encryptPayload(secret, JSON.stringify({ verifier, state } satisfies PkceBundle));
  res.cookie(COOKIE_PKCE, packed, {
    ...baseCookie(req),
    maxAge: 10 * 60 * 1000,
  });

  const url = new URL(`${authority()}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
}

async function exchangeToken(body: Record<string, string>): Promise<MsTokenBundle> {
  const { clientId, clientSecret, redirectUri } = cfg();
  const res = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      ...body,
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || 'Token exchange failed');
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + Math.max(60, Number(json.expires_in ?? 3600) - 90) * 1000,
  };
}

async function fetchAccount(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const me = (await res.json()) as {
      displayName?: string;
      mail?: string;
      userPrincipalName?: string;
    };
    return me.mail || me.userPrincipalName || me.displayName;
  } catch {
    return undefined;
  }
}

function saveSession(req: Request, res: Response, bundle: MsTokenBundle): void {
  const { secret } = cfg();
  const packed = encryptPayload(secret, JSON.stringify(bundle));
  writeChunkedCookie(res, req, COOKIE_SESSION, packed, 60 * 60 * 24 * 90);
}

export function clearSession(req: Request, res: Response): void {
  clearChunkedCookie(res, req, COOKIE_SESSION);
  res.clearCookie(COOKIE_PKCE, { ...baseCookie(req) });
}

function readSessionRaw(req: Request): MsTokenBundle | null {
  const { secret } = cfg();
  if (!secret) return null;
  const packed = readChunkedCookie(req, COOKIE_SESSION);
  if (!packed) return null;
  const raw = decryptPayload(secret, packed);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MsTokenBundle;
    if (!parsed.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function completeLogin(req: Request, res: Response): Promise<void> {
  if (!isMicrosoftConfigured()) {
    res.status(503).send('Microsoft 365 is not configured.');
    return;
  }
  const { secret } = cfg();
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const err = String(req.query.error_description ?? req.query.error ?? '');
  if (err) {
    res.status(400).send(`Microsoft sign-in failed: ${err}`);
    return;
  }
  if (!code || !state) {
    res.status(400).send('Missing code/state.');
    return;
  }

  const cookies = parseCookies(req);
  const pkcePacked = cookies[COOKIE_PKCE];
  const pkceRaw = pkcePacked ? decryptPayload(secret, pkcePacked) : null;
  let pkce: PkceBundle | null = null;
  try {
    pkce = pkceRaw ? (JSON.parse(pkceRaw) as PkceBundle) : null;
  } catch {
    pkce = null;
  }
  res.clearCookie(COOKIE_PKCE, { ...baseCookie(req) });

  if (!pkce || pkce.state !== state) {
    res.status(400).send('Invalid or expired sign-in state. Try again.');
    return;
  }

  try {
    const tokens = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: pkce.verifier,
    });
    tokens.account = await fetchAccount(tokens.accessToken);
    if (!tokens.refreshToken) {
      // Still usable until access expires; warn via account tag.
      tokens.account = tokens.account
        ? `${tokens.account} (no refresh)`
        : 'connected (no refresh)';
    }
    saveSession(req, res, tokens);
    res.redirect('/');
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sign-in failed';
    res.status(502).send(`Microsoft sign-in failed: ${message}`);
  }
}

async function refresh(bundle: MsTokenBundle): Promise<MsTokenBundle> {
  if (!bundle.refreshToken) throw new Error('No refresh token');
  const next = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: bundle.refreshToken,
    scope: SCOPES,
  });
  return {
    ...next,
    refreshToken: next.refreshToken || bundle.refreshToken,
    account: bundle.account,
  };
}

/**
 * Return a valid access token, refreshing and rewriting cookies when needed.
 */
export async function getValidAccessToken(
  req: Request,
  res: Response,
): Promise<MsTokenBundle | null> {
  if (!isMicrosoftConfigured()) return null;
  let bundle = readSessionRaw(req);
  if (!bundle) return null;

  if (bundle.expiresAt > Date.now() + 30_000) {
    return bundle;
  }

  if (!bundle.refreshToken) return null;

  try {
    bundle = await refresh(bundle);
    if (!bundle.account) {
      bundle.account = await fetchAccount(bundle.accessToken);
    }
    saveSession(req, res, bundle);
    return bundle;
  } catch {
    clearSession(req, res);
    return null;
  }
}

export function statusFromBundle(bundle: MsTokenBundle | null): {
  configured: boolean;
  connected: boolean;
  account: string | null;
} {
  return {
    configured: isMicrosoftConfigured(),
    connected: Boolean(bundle?.accessToken),
    account: bundle?.account ?? null,
  };
}

/** Timing-safe compare for optional future CSRF tokens. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'elevyn').update(a).digest();
  const hb = createHmac('sha256', 'elevyn').update(b).digest();
  return ha.equals(hb);
}
