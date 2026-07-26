/**
 * Browser session memory — lasts for this tab until cleared.
 * Facts Kevin asks Elevyn to remember + recent conversation turns.
 */

const STORAGE_KEY = 'elevyn.session.v1';
const MAX_TURNS = 16;
const MAX_FACTS = 40;

export interface SessionTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface SessionSnapshot {
  facts: string[];
  turns: SessionTurn[];
  startedAt: string;
}

function emptySession(): SessionSnapshot {
  return {
    facts: [],
    turns: [],
    startedAt: new Date().toISOString(),
  };
}

function load(): SessionSnapshot {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySession();
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed || !Array.isArray(parsed.facts) || !Array.isArray(parsed.turns)) {
      return emptySession();
    }
    return {
      facts: parsed.facts.slice(0, MAX_FACTS),
      turns: parsed.turns.slice(-MAX_TURNS),
      startedAt: parsed.startedAt || new Date().toISOString(),
    };
  } catch {
    return emptySession();
  }
}

function save(snapshot: SessionSnapshot): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode / quota — keep working from memory only.
  }
}

export class SessionMemory {
  private state: SessionSnapshot;

  constructor() {
    this.state = load();
  }

  snapshot(): SessionSnapshot {
    return {
      facts: [...this.state.facts],
      turns: [...this.state.turns],
      startedAt: this.state.startedAt,
    };
  }

  addFact(content: string): void {
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    const withoutDup = this.state.facts.filter(
      (f) => f.toLowerCase() !== cleaned.toLowerCase(),
    );
    this.state = {
      ...this.state,
      facts: [cleaned, ...withoutDup].slice(0, MAX_FACTS),
    };
    save(this.state);
  }

  addTurn(role: 'user' | 'assistant', text: string): void {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    this.state = {
      ...this.state,
      turns: [
        ...this.state.turns,
        { role, text: cleaned.slice(0, 600), at: new Date().toISOString() },
      ].slice(-MAX_TURNS),
    };
    save(this.state);
  }

  /** Drop the most recent user turn (e.g. silent meeting-capture lines). */
  dropLastUserTurn(): void {
    const last = this.state.turns[this.state.turns.length - 1];
    if (!last || last.role !== 'user') return;
    this.state = {
      ...this.state,
      turns: this.state.turns.slice(0, -1),
    };
    save(this.state);
  }

  clear(): void {
    this.state = emptySession();
    save(this.state);
  }

  isEmpty(): boolean {
    return this.state.facts.length === 0 && this.state.turns.length === 0;
  }

  /** Compact block for the brain interpret context. */
  toContextBlock(): string | undefined {
    const parts: string[] = [];

    if (this.state.facts.length) {
      parts.push(
        '=== SESSION FACTS ===\n' +
          this.state.facts.map((f) => `- ${f}`).join('\n'),
      );
    }

    if (this.state.turns.length) {
      const lines = this.state.turns.map((t) =>
        `${t.role === 'user' ? 'Kevin' : 'Elevyn'}: ${t.text}`,
      );
      parts.push('=== RECENT CONVERSATION ===\n' + lines.join('\n'));
    }

    return parts.length ? parts.join('\n\n') : undefined;
  }
}
