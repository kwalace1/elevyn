/**
 * Microsoft 365 routes.
 *
 * Vercel’s /api catch-all reliably serves /api/:segment but can 404 on
 * /api/:a/:b — so every public MS path is a single segment (mslogin, msauth, …).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  beginLogin,
  clearSession,
  completeLogin,
  getValidAccessToken,
  isMicrosoftConfigured,
  statusFromBundle,
} from '../services/ms/oauth.js';
import {
  buildMicrosoftBrief,
  fetchGraphCalendar,
  fetchRecentMail,
  fetchRecentTeamsChats,
  mailFromSender,
  speakMailBrief,
  speakTeamsBrief,
} from '../services/ms/graph.js';

async function withMs(
  _req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    next();
  } catch (err) {
    next(err);
  }
}

function mountLogin(router: Router, path: string): void {
  router.get(path, withMs, (req, res) => {
    beginLogin(req, res);
  });
}

function mountStatus(router: Router, path: string): void {
  router.get(path, withMs, async (req, res) => {
    const bundle = await getValidAccessToken(req, res);
    res.json(statusFromBundle(bundle));
  });
}

function mountLogout(router: Router, path: string): void {
  router.post(path, withMs, (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
  });
}

function mountBrief(router: Router, path: string): void {
  router.get(path, withMs, async (req, res) => {
    const bundle = await getValidAccessToken(req, res);
    if (!bundle) {
      res.status(401).json({
        connected: false,
        configured: isMicrosoftConfigured(),
        brief: null,
        error: isMicrosoftConfigured()
          ? 'Not connected. Say “connect Microsoft” or open /api/mslogin.'
          : 'Microsoft 365 is not configured on this brain.',
      });
      return;
    }
    try {
      const brief = await buildMicrosoftBrief(bundle.accessToken);
      res.json({
        connected: true,
        configured: true,
        account: bundle.account ?? null,
        brief,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Brief failed';
      res.status(502).json({ connected: true, configured: true, error: message });
    }
  });
}

function mountPulse(router: Router, path: string): void {
  router.get(path, withMs, async (req, res) => {
    const bundle = await getValidAccessToken(req, res);
    if (!bundle) {
      res.status(401).json({
        connected: false,
        configured: isMicrosoftConfigured(),
        unread: 0,
        nextMeeting: null,
      });
      return;
    }
    try {
      const [mail, calendar] = await Promise.all([
        fetchRecentMail(bundle.accessToken, 8).catch(() => []),
        fetchGraphCalendar(bundle.accessToken).catch(() => []),
      ]);
      const unread = mail.filter((m) => m.unread).length;
      const upcoming = calendar.filter(
        (e) => new Date(e.end ?? e.start).getTime() >= Date.now() - 60_000,
      );
      const next = upcoming[0] ?? null;
      res.json({
        connected: true,
        configured: true,
        account: bundle.account ?? null,
        unread,
        nextMeeting: next
          ? { title: next.title, start: next.start, end: next.end ?? null }
          : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pulse failed';
      res.status(502).json({
        connected: true,
        configured: true,
        error: message,
        unread: 0,
        nextMeeting: null,
      });
    }
  });
}

function mountMail(router: Router, path: string): void {
  router.get(path, withMs, async (req, res) => {
    const bundle = await getValidAccessToken(req, res);
    if (!bundle) {
      res.status(401).json({ error: 'Not connected' });
      return;
    }
    const from = String(req.query.from ?? '').trim();
    try {
      const mail = await fetchRecentMail(bundle.accessToken);
      const spoken = from ? mailFromSender(mail, from) : speakMailBrief(mail);
      res.json({ spoken, mail });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mail failed';
      res.status(502).json({ error: message });
    }
  });
}

function mountTeams(router: Router, path: string): void {
  router.get(path, withMs, async (req, res) => {
    const bundle = await getValidAccessToken(req, res);
    if (!bundle) {
      res.status(401).json({ error: 'Not connected' });
      return;
    }
    try {
      const chats = await fetchRecentTeamsChats(bundle.accessToken);
      res.json({ spoken: speakTeamsBrief(chats), chats });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Teams failed';
      res.status(502).json({ error: message });
    }
  });
}

export function createMsRouter(): Router {
  const router = Router();

  // Flat paths — required on Vercel.
  mountLogin(router, '/mslogin');
  mountStatus(router, '/msstatus');
  mountLogout(router, '/mslogout');
  mountBrief(router, '/msbrief');
  mountPulse(router, '/mspulse');
  mountMail(router, '/msmail');
  mountTeams(router, '/msteams');

  // Nested aliases — fine on local Express / Vite proxy.
  mountLogin(router, '/ms/login');
  mountStatus(router, '/ms/status');
  mountLogout(router, '/ms/logout');
  mountBrief(router, '/ms/brief');
  mountPulse(router, '/ms/pulse');
  mountMail(router, '/ms/mail');
  mountTeams(router, '/ms/teams');

  return router;
}

/** Single-segment OAuth callback for Vercel catch-all. */
export function createMsAuthRouter(): Router {
  const router = Router();
  router.get('/msauth', async (req, res) => {
    await completeLogin(req, res);
  });
  return router;
}

export async function microsoftCalendarEvents(
  req: Request,
  res: Response,
): Promise<{ configured: boolean; events: Awaited<ReturnType<typeof fetchGraphCalendar>> } | null> {
  if (!isMicrosoftConfigured()) return null;
  const bundle = await getValidAccessToken(req, res);
  if (!bundle) return null;
  const events = await fetchGraphCalendar(bundle.accessToken);
  return { configured: true, events };
}
