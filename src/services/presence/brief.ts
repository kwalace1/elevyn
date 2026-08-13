/**
 * Proactive presence — sparse situational awareness for Jarvis-like wake briefs
 * and soft status lines. Never chatty; one or two cues max.
 */

import type { SurfacePanel } from '../../types';
import {
  meetingSoonFromEvents,
  speakMeetingSoon,
  speakThreadCue,
  type MeetingSoon,
  type OpenThread,
} from './threads';

export interface PresenceSnapshot {
  openTasks: number;
  taskPreview: string[];
  capturing: boolean;
  captureLines: number;
  timerSecondsLeft: number | null;
  timerTitle: string | null;
  factCount: number;
  recentTurns: number;
  /** Next agenda line already formatted for speech, if any. */
  nextAgenda: string | null;
  /** Meeting starting within ~10 minutes. */
  meetingSoon: MeetingSoon | null;
  /** Highest-priority open thread. */
  openThread: OpenThread | null;
}

export function buildPresenceSnapshot(
  panels: SurfacePanel[],
  session: { facts: string[]; turns: unknown[] },
  nextAgenda: string | null = null,
  opts?: {
    upcoming?: { title: string; start: string }[];
    openThread?: OpenThread | null;
  },
): PresenceSnapshot {
  const tasks = panels.find((p) => p.kind === 'task');
  const openItems = (tasks?.items ?? []).filter((it) => !it.done);
  const capture = panels.find((p) => p.kind === 'capture');
  const timer = panels.find((p) => p.kind === 'timer' && p.endsAt);
  let timerSecondsLeft: number | null = null;
  if (timer?.endsAt) {
    timerSecondsLeft = Math.max(
      0,
      Math.round((new Date(timer.endsAt).getTime() - Date.now()) / 1000),
    );
  }

  const meetingSoon = meetingSoonFromEvents(opts?.upcoming ?? [], 10);

  return {
    openTasks: openItems.length,
    taskPreview: openItems.slice(0, 2).map((it) => it.text),
    capturing: Boolean(capture?.armed),
    captureLines: capture?.items?.length ?? 0,
    timerSecondsLeft,
    timerTitle: timer?.title ?? null,
    factCount: session.facts.length,
    recentTurns: session.turns.length,
    nextAgenda,
    meetingSoon,
    openThread: opts?.openThread ?? null,
  };
}

function formatMinutesLeft(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? 'about a minute' : `about ${m} minutes`;
}

/**
 * Spoken wake brief when there is something worth noticing.
 * Returns null → caller should use a short ack instead.
 */
export function buildWakeBrief(
  snap: PresenceSnapshot,
  greeting: 'morning' | 'afternoon' | 'evening' | 'generic' = 'generic',
): string | null {
  const cues: string[] = [];

  // Priority: imminent meeting → pending confirm → capture → timer → thread → tasks.
  if (snap.meetingSoon) {
    cues.push(speakMeetingSoon(snap.meetingSoon));
  }

  if (snap.openThread?.kind === 'pending_send') {
    cues.push(speakThreadCue(snap.openThread));
  }

  if (snap.capturing) {
    cues.push(
      snap.captureLines > 0
        ? `Capture is still live with ${snap.captureLines} line${snap.captureLines === 1 ? '' : 's'}.`
        : 'Capture is still live.',
    );
  }

  if (snap.timerSecondsLeft != null && snap.timerSecondsLeft > 0) {
    cues.push(`Timer has ${formatMinutesLeft(snap.timerSecondsLeft)} left.`);
  }

  if (
    snap.openThread &&
    snap.openThread.kind !== 'pending_send' &&
    cues.length < 2
  ) {
    cues.push(speakThreadCue(snap.openThread));
  }

  if (!snap.meetingSoon && snap.nextAgenda && cues.length < 2) {
    cues.push(`Next up: ${snap.nextAgenda}.`);
  }

  if (snap.openTasks === 1 && snap.taskPreview[0] && cues.length < 2) {
    const preview = snap.taskPreview[0].slice(0, 60);
    cues.push(`One open task: ${preview}.`);
  } else if (snap.openTasks > 1 && cues.length < 2) {
    cues.push(`${snap.openTasks} open tasks on the board.`);
  }

  // Only mention session memory if nothing more urgent, and there is history.
  if (!cues.length && snap.factCount > 0 && snap.recentTurns >= 2) {
    cues.push(
      snap.factCount === 1
        ? 'I am holding one note from this session.'
        : `I am holding ${snap.factCount} notes from this session.`,
    );
  }

  if (!cues.length) return null;

  const opener =
    greeting === 'morning'
      ? 'Good morning'
      : greeting === 'afternoon'
        ? 'Good afternoon'
        : greeting === 'evening'
          ? 'Good evening'
          : 'Standing by';

  // Max two cues — stay Jarvis-short.
  return `${opener}. ${cues.slice(0, 2).join(' ')}`;
}

/** Quiet status line under the brand (not spoken). */
export function buildPresenceStatus(snap: PresenceSnapshot): string {
  const bits: string[] = [];
  if (snap.meetingSoon) {
    bits.push(
      snap.meetingSoon.minutes <= 0
        ? 'Meeting now'
        : `Meeting in ${snap.meetingSoon.minutes}m`,
    );
  } else if (snap.nextAgenda) {
    bits.push(`Next: ${snap.nextAgenda}`);
  }
  if (snap.openThread?.kind === 'pending_send') bits.push('Confirm pending');
  else if (snap.openThread) bits.push('Open thread');
  if (snap.capturing) bits.push('Capture live');
  if (snap.timerSecondsLeft != null && snap.timerSecondsLeft > 0) {
    bits.push(`Timer ${formatMinutesLeft(snap.timerSecondsLeft)}`);
  }
  if (snap.openTasks > 0) {
    bits.push(
      snap.openTasks === 1 ? '1 open task' : `${snap.openTasks} open tasks`,
    );
  }
  if (!bits.length && snap.factCount > 0) {
    bits.push('Session memory armed');
  }
  return bits.length ? bits.join(' · ') : 'All systems standing by';
}

/** Soft spoken nudge when a timer crosses the one-minute mark. */
export function buildTimerNudge(secondsLeft: number, title?: string | null): string {
  const label = title && title !== 'Timer' ? title : 'Timer';
  if (secondsLeft <= 15) return `${label} almost up.`;
  return `One minute remaining on ${label.toLowerCase()}.`;
}
