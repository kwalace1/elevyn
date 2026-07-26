/**
 * Durable memory vault — survives tab closes and days in this browser.
 * Kevin's Chrome monitor is the daily surface, so localStorage is the right
 * store until a cloud vault is worth the complexity.
 */

const STORAGE_KEY = 'elevyn.durable.v1';
const MAX_FACTS = 120;
const MAX_EVENTS = 80;

export type DurableKind = 'fact' | 'person' | 'preference' | 'project';

export interface DurableFact {
  id: string;
  kind: DurableKind;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgendaEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  source: 'voice' | 'calendar';
  createdAt: string;
}

export interface DurableSnapshot {
  facts: DurableFact[];
  events: AgendaEvent[];
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function empty(): DurableSnapshot {
  return { facts: [], events: [] };
}

function load(): DurableSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as DurableSnapshot;
    if (!parsed || !Array.isArray(parsed.facts) || !Array.isArray(parsed.events)) {
      return empty();
    }
    return {
      facts: parsed.facts.slice(0, MAX_FACTS),
      events: prunePastEvents(parsed.events).slice(0, MAX_EVENTS),
    };
  } catch {
    return empty();
  }
}

function save(state: DurableSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / private mode.
  }
}

/** Drop events that ended more than 36 hours ago. */
function prunePastEvents(events: AgendaEvent[]): AgendaEvent[] {
  const cutoff = Date.now() - 36 * 3600_000;
  return events.filter((e) => {
    const end = new Date(e.end ?? e.start).getTime();
    return Number.isFinite(end) && end >= cutoff;
  });
}

function inferKind(content: string): DurableKind {
  const lower = content.toLowerCase();
  if (/\b(prefer|preference|always|never|usually|don'?t like)\b/.test(lower)) {
    return 'preference';
  }
  if (/\b(project|building|shipping|startup|company|business)\b/.test(lower)) {
    return 'project';
  }
  if (
    /\b(met|meeting|said|told|from|with)\b/.test(lower) ||
    /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/.test(content)
  ) {
    // "Sarah said…" / "Alex from Acme…"
    if (/\b(said|told|from|called|email|pricing|deal|client|investor)\b/i.test(content)) {
      return 'person';
    }
  }
  return 'fact';
}

export class DurableMemory {
  private state: DurableSnapshot;

  constructor() {
    this.state = load();
  }

  snapshot(): DurableSnapshot {
    return {
      facts: [...this.state.facts],
      events: [...this.state.events],
    };
  }

  addFact(content: string, kind?: DurableKind): DurableFact | null {
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    const now = new Date().toISOString();
    const withoutDup = this.state.facts.filter(
      (f) => f.content.toLowerCase() !== cleaned.toLowerCase(),
    );
    const entry: DurableFact = {
      id: uid(),
      kind: kind ?? inferKind(cleaned),
      content: cleaned,
      tags: ['voice'],
      createdAt: now,
      updatedAt: now,
    };
    this.state = {
      ...this.state,
      facts: [entry, ...withoutDup].slice(0, MAX_FACTS),
    };
    save(this.state);
    return entry;
  }

  search(query: string): DurableFact[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...this.state.facts];
    return this.state.facts.filter((f) => {
      const hay = `${f.kind} ${f.content} ${f.tags.join(' ')}`.toLowerCase();
      return hay.includes(q) || q.split(/\s+/).every((w) => hay.includes(w));
    });
  }

  addEvent(input: Omit<AgendaEvent, 'id' | 'createdAt'>): AgendaEvent {
    const event: AgendaEvent = {
      ...input,
      id: uid(),
      createdAt: new Date().toISOString(),
    };
    // Replace same-title same-day voice events to avoid duplicates.
    const day = event.start.slice(0, 10);
    const filtered = this.state.events.filter((e) => {
      if (e.source === 'calendar') return true;
      return !(
        e.title.toLowerCase() === event.title.toLowerCase() &&
        e.start.slice(0, 10) === day
      );
    });
    this.state = {
      ...this.state,
      events: prunePastEvents([event, ...filtered]).slice(0, MAX_EVENTS),
    };
    save(this.state);
    return event;
  }

  /** Merge remote calendar events (ICS) without wiping voice-added ones. */
  mergeCalendarEvents(remote: Omit<AgendaEvent, 'id' | 'createdAt' | 'source'>[]): void {
    const voice = this.state.events.filter((e) => e.source === 'voice');
    const mapped: AgendaEvent[] = remote.map((e) => ({
      ...e,
      id: `cal-${e.start}-${e.title}`.slice(0, 80),
      source: 'calendar' as const,
      createdAt: new Date().toISOString(),
    }));
    this.state = {
      ...this.state,
      events: prunePastEvents([...voice, ...mapped]).slice(0, MAX_EVENTS),
    };
    save(this.state);
  }

  upcoming(withinHours = 36): AgendaEvent[] {
    const now = Date.now();
    const horizon = now + withinHours * 3600_000;
    return this.state.events
      .filter((e) => {
        const start = new Date(e.start).getTime();
        const end = new Date(e.end ?? e.start).getTime();
        return end >= now && start <= horizon;
      })
      .sort((a, b) => +new Date(a.start) - +new Date(b.start));
  }

  clearFacts(): void {
    this.state = { ...this.state, facts: [] };
    save(this.state);
  }

  clearEvents(): void {
    this.state = { ...this.state, events: [] };
    save(this.state);
  }

  /** Context block for the brain. */
  toContextBlock(timeZone = 'America/New_York'): string | undefined {
    const parts: string[] = [];
    const facts = this.state.facts.slice(0, 24);
    if (facts.length) {
      parts.push(
        '=== DURABLE MEMORY ===\n' +
          facts.map((f) => `- [${f.kind}] ${f.content}`).join('\n'),
      );
    }

    const upcoming = this.upcoming(36);
    if (upcoming.length) {
      const lines = upcoming.slice(0, 8).map((e) => {
        const when = new Date(e.start).toLocaleString('en-US', {
          weekday: 'short',
          hour: 'numeric',
          minute: '2-digit',
          timeZone,
        });
        return `- ${when}: ${e.title}`;
      });
      parts.push("=== TODAY'S AGENDA ===\n" + lines.join('\n'));
    }

    return parts.length ? parts.join('\n\n') : undefined;
  }
}
