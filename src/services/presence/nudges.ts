/**
 * Proactive nudges — Elevyn speaks first, sparsely.
 * Meeting soon, unread spikes, timer cues. Never chatty.
 */

import {
  meetingSoonFromEvents,
  speakMeetingSoon,
  type MeetingSoon,
} from './threads';

export type NudgeEvent = {
  id: string;
  text: string;
};

/** Meeting starting within this many minutes → proactive announce. */
export const MEETING_NUDGE_WINDOW_MIN = 5;

/** Minimum gap between any two proactive announces. */
export const NUDGE_COOLDOWN_MS = 90_000;

export function buildMeetingNudge(
  events: { title: string; start: string }[],
  alreadyFired: Set<string>,
): NudgeEvent | null {
  const soon = meetingSoonFromEvents(events, MEETING_NUDGE_WINDOW_MIN);
  if (!soon) return null;
  const match = events.find((e) => {
    const clean = e.title.replace(/\s*\(Teams\)\s*/g, ' ').trim();
    return clean === soon.title || e.title === soon.title;
  });
  const id = `meeting:${match?.start ?? soon.title}:${soon.title}`;
  if (alreadyFired.has(id)) return null;
  return {
    id,
    text:
      soon.minutes <= 0
        ? `${soon.title} is starting.`
        : `Heads up — ${speakMeetingSoon(soon)}`,
  };
}

/**
 * Unread spike vs last known baseline.
 * Returns null on first sample (baseline only) or when count did not rise.
 */
export function buildUnreadNudge(
  previous: number | null,
  current: number,
): { baseline: number; nudge: NudgeEvent | null } {
  if (previous === null) {
    return { baseline: current, nudge: null };
  }
  if (current <= previous) {
    return { baseline: current, nudge: null };
  }
  const gained = current - previous;
  const text =
    previous === 0 && current === 1
      ? 'You have a new unread message.'
      : previous === 0
        ? `You have ${current} unread messages.`
        : gained === 1
          ? 'New mail just landed.'
          : `${gained} new messages in the inbox.`;
  return {
    baseline: current,
    nudge: { id: `mail:${previous}->${current}:${Date.now()}`, text },
  };
}

export function buildTimerDoneNudge(title?: string | null): string {
  if (title && title.trim() && title.trim() !== 'Timer') {
    return `${title.trim()} is up.`;
  }
  return "Time's up.";
}

export function canAnnounceNow(
  lastAnnounceAt: number,
  now = Date.now(),
  cooldownMs = NUDGE_COOLDOWN_MS,
): boolean {
  return now - lastAnnounceAt >= cooldownMs;
}

/** Re-export for callers that already have a MeetingSoon. */
export function formatMeetingSoon(m: MeetingSoon): string {
  return speakMeetingSoon(m);
}
