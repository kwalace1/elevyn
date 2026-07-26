/**
 * Microsoft 365 routes — login, callback alias, status, logout, brief.
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
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    next();
  } catch (err) {
    next(err);
  }
}

export function createMsRouter(): Router {
  const router = Router();

  router.get('/ms/login', withMs, (req, res) => {
    beginLogin(req, res);
  });

  router.get('/ms/status', withMs, async (req, res) => {
    const bundle = await getValidAccessToken(req, res);
    res.json(statusFromBundle(bundle));
  });

  router.post('/ms/logout', withMs, (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
  });

  router.get('/ms/brief', withMs, async (req, res) => {
    const bundle = await getValidAccessToken(req, res);
    if (!bundle) {
      res.status(401).json({
        connected: false,
        configured: isMicrosoftConfigured(),
        brief: null,
        error: isMicrosoftConfigured()
          ? 'Not connected. Say “connect Microsoft” or open /api/ms/login.'
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

  router.get('/ms/mail', withMs, async (req, res) => {
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

  router.get('/ms/teams', withMs, async (req, res) => {
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
