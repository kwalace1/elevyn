/**
 * Open threads — sparse unfinished work Elevyn can mention on wake
 * or “where were we” without monologuing.
 */

const STORAGE_KEY = 'elevyn.threads.v1';
const MAX_THREADS = 6;

export type ThreadKind = 'pending_send' | 'plan' | 'draft';

export interface OpenThread {
  id: string;
  kind: ThreadKind;
  /** Short human label, e.g. "email to Sarah" */
  label: string;
  createdAt: string;
  /** ISO expiry — stale threads drop automatically. */
  expiresAt: string;
}

type ThreadSnapshot = { threads: OpenThread[] };

function empty(): ThreadSnapshot {
  return { threads: [] };
}

function load(): ThreadSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as ThreadSnapshot;
    if (!parsed || !Array.isArray(parsed.threads)) return empty();
    return { threads: prune(parsed.threads) };
  } catch {
    return empty();
  }
}

function save(state: ThreadSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / private mode.
  }
}

function prune(threads: OpenThread[]): OpenThread[] {
  const now = Date.now();
  return threads
    .filter((t) => new Date(t.expiresAt).getTime() > now)
    .slice(0, MAX_THREADS);
}

const KIND_TTL_MS: Record<ThreadKind, number> = {
  pending_send: 3 * 60_000,
  plan: 20 * 60_000,
  draft: 45 * 60_000,
};

const KIND_PRIORITY: Record<ThreadKind, number> = {
  pending_send: 0,
  plan: 1,
  draft: 2,
};

export class OpenThreads {
  private state: ThreadSnapshot;

  constructor() {
    this.state = load();
  }

  list(): OpenThread[] {
    this.state = { threads: prune(this.state.threads) };
    save(this.state);
    return [...this.state.threads].sort(
      (a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind],
    );
  }

  /** Highest-priority fresh thread, if any. */
  primary(): OpenThread | null {
    return this.list()[0] ?? null;
  }

  upsert(input: {
    kind: ThreadKind;
    label: string;
    id?: string;
    ttlMs?: number;
  }): OpenThread {
    const label = input.label.replace(/\s+/g, ' ').trim().slice(0, 80);
    const now = Date.now();
    const ttl = input.ttlMs ?? KIND_TTL_MS[input.kind];
    const id = input.id ?? input.kind;
    const thread: OpenThread = {
      id,
      kind: input.kind,
      label,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
    };
    const others = this.state.threads.filter((t) => t.kind !== input.kind);
    this.state = {
      threads: prune([thread, ...others]),
    };
    save(this.state);
    return thread;
  }

  clear(kind?: ThreadKind): void {
    if (!kind) {
      this.state = empty();
    } else {
      this.state = {
        threads: this.state.threads.filter((t) => t.kind !== kind),
      };
    }
    save(this.state);
  }

  toContextBlock(): string | undefined {
    const threads = this.list();
    if (!threads.length) return undefined;
    const lines = threads.map((t) => `- [${t.kind}] ${t.label}`);
    return `=== OPEN THREADS ===\n${lines.join('\n')}`;
  }
}

/** Spoken fragment for a thread (no opener). */
export function speakThreadCue(thread: OpenThread): string {
  if (thread.kind === 'pending_send') {
    return `Still waiting on your say-so to ${thread.label}.`;
  }
  if (thread.kind === 'plan') {
    return `We left a plan open: ${thread.label}.`;
  }
  return `Still holding ${thread.label} on the board.`;
}

export type MeetingSoon = {
  title: string;
  minutes: number;
};

/** Next meeting within the given window (minutes). */
export function meetingSoonFromEvents(
  events: { title: string; start: string }[],
  withinMinutes = 10,
): MeetingSoon | null {
  const now = Date.now();
  for (const e of events) {
    const start = new Date(e.start).getTime();
    if (!Number.isFinite(start)) continue;
    const mins = Math.round((start - now) / 60_000);
    if (mins >= -1 && mins <= withinMinutes) {
      return {
        title: e.title.replace(/\s*\(Teams\)\s*/g, ' ').trim(),
        minutes: Math.max(0, mins),
      };
    }
  }
  return null;
}

export function speakMeetingSoon(m: MeetingSoon): string {
  if (m.minutes <= 0) return `${m.title} is starting now.`;
  if (m.minutes === 1) return `${m.title} starts in about a minute.`;
  return `${m.title} starts in about ${m.minutes} minutes.`;
}

/** Apply thread hints from brain/route intent args. */
export function applyThreadArgs(
  threads: OpenThreads,
  args?: Record<string, unknown>,
): void {
  if (!args) return;

  if (args.clearThread === true || args.clearThread === 'all') {
    threads.clear();
    return;
  }
  if (typeof args.clearThread === 'string') {
    const kind = args.clearThread as ThreadKind;
    if (kind === 'pending_send' || kind === 'plan' || kind === 'draft') {
      threads.clear(kind);
    }
  }

  const raw = args.openThread;
  if (!raw || typeof raw !== 'object') return;
  const rec = raw as { kind?: string; label?: string };
  if (
    (rec.kind === 'pending_send' ||
      rec.kind === 'plan' ||
      rec.kind === 'draft') &&
    typeof rec.label === 'string' &&
    rec.label.trim()
  ) {
    threads.upsert({ kind: rec.kind, label: rec.label.trim() });
  }
}
