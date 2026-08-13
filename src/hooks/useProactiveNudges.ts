/**
 * Sparse proactive announces — meeting soon, unread spike, timer polish.
 * Runs in the Shell; never interrupts thinking/speaking/command phase
 * (elevyn.announce already guards that).
 */

import { useEffect, useRef } from 'react';
import { elevynApi } from '../services/api/client';
import {
  buildMeetingNudge,
  buildUnreadNudge,
  canAnnounceNow,
  NUDGE_COOLDOWN_MS,
} from '../services/presence/nudges';

type Upcoming = { title: string; start: string };

export function useProactiveNudges(opts: {
  announce: (text: string) => void;
  getUpcomingAgenda: () => Upcoming[];
  microsoftConnected: boolean;
  /** When false, skip MS pulse (tab hidden / offline). */
  enabled?: boolean;
}) {
  const announceRef = useRef(opts.announce);
  const agendaRef = useRef(opts.getUpcomingAgenda);
  announceRef.current = opts.announce;
  agendaRef.current = opts.getUpcomingAgenda;

  const firedRef = useRef(new Set<string>());
  const lastAnnounceAtRef = useRef(0);
  const unreadBaselineRef = useRef<number | null>(null);
  const outlookNextRef = useRef<Upcoming | null>(null);

  const tryAnnounce = (id: string, text: string) => {
    if (firedRef.current.has(id)) return;
    if (!canAnnounceNow(lastAnnounceAtRef.current)) return;
    firedRef.current.add(id);
    lastAnnounceAtRef.current = Date.now();
    announceRef.current(text);
  };

  // Local agenda + cached Outlook next meeting — every 20s.
  useEffect(() => {
    if (opts.enabled === false) return;

    const tick = () => {
      const local = agendaRef.current() ?? [];
      const outlook = outlookNextRef.current;
      const merged = outlook
        ? [
            outlook,
            ...local.filter(
              (e) =>
                e.start !== outlook.start ||
                e.title.toLowerCase() !== outlook.title.toLowerCase(),
            ),
          ]
        : local;
      const nudge = buildMeetingNudge(merged, firedRef.current);
      if (nudge) tryAnnounce(nudge.id, nudge.text);
    };

    tick();
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [opts.enabled]);

  // Microsoft pulse — unread + next meeting, every 3 minutes when connected.
  useEffect(() => {
    if (opts.enabled === false || !opts.microsoftConnected) return;

    let cancelled = false;

    const pulse = async () => {
      try {
        const data = await elevynApi.microsoft.pulse();
        if (cancelled || !data.connected) return;

        if (data.nextMeeting?.title && data.nextMeeting.start) {
          outlookNextRef.current = {
            title: data.nextMeeting.title,
            start: data.nextMeeting.start,
          };
        } else {
          outlookNextRef.current = null;
        }

        const { baseline, nudge } = buildUnreadNudge(
          unreadBaselineRef.current,
          Number(data.unread) || 0,
        );
        unreadBaselineRef.current = baseline;
        if (nudge && canAnnounceNow(lastAnnounceAtRef.current)) {
          // Soft-dedupe: only one unread spike per cooldown window.
          const softId = `mail-spike:${Math.floor(Date.now() / NUDGE_COOLDOWN_MS)}`;
          if (!firedRef.current.has(softId)) {
            firedRef.current.add(softId);
            lastAnnounceAtRef.current = Date.now();
            announceRef.current(nudge.text);
          }
        }
      } catch {
        // Pulse is best-effort — stay quiet on errors.
      }
    };

    void pulse();
    const id = window.setInterval(() => void pulse(), 3 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [opts.enabled, opts.microsoftConnected]);
}
