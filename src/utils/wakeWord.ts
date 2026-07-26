/**
 * Wake-word matching for Elevyn.
 *
 * Browser STT mangles "Elevyn" constantly — keep a wide alias net plus light
 * fuzzy matching on name-like tokens. Recognition engines can swap later
 * (Porcupine, etc.).
 */

/** Common wake greetings STT may attach before the name. */
const GREETING_WORDS = new Set(['hey', 'hi', 'ok', 'okay', 'yo', 'hello', 'hai']);
/** Filler STT often prepends before a wake. */
const FILLER_WORDS = new Set([
  'um',
  'uh',
  'uhm',
  'erm',
  'so',
  'well',
  'and',
  'like',
  'please',
]);
const EXACT_NAME =
  /^(?:elevyn|eleven|elevan|elevin|elevon|elevation|evelyn|ellen|elevynn|elevenn|elevene|elevens|elevum|eleva|elven|leven|11)$/i;

/** Canonical forms for edit-distance checks (avoid short/ambiguous targets). */
const FUZZY_TARGETS = [
  'elevyn',
  'eleven',
  'evelyn',
  'elevan',
  'elevin',
  'elevon',
  'elevation',
  'elevynn',
  'elevenn',
  'elevens',
  'elven',
];

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * True when a single STT token is (or is close to) Elevyn.
 * Kept strict on shape so common words like "oliver" / "even" do not wake.
 */
export function isElevynNameToken(token: string): boolean {
  const w = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return false;
  if (w === '11') return true;
  if (EXACT_NAME.test(w)) return true;
  if (w.length < 5 || w.length > 11) return false;
  // Must look like Elevyn / Eleven family — not arbitrary English.
  if (!/^e[lv]/.test(w)) return false;
  return FUZZY_TARGETS.some((t) => {
    const max = t.length <= 6 ? 1 : 2;
    return levenshtein(w, t) <= max;
  });
}

/** Score how strongly a transcript looks like it contains the wake name. */
export function elevynNameScore(text: string): number {
  const words = normalizeTranscript(text).split(' ').filter(Boolean);
  let score = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i] === 'a' && words[i + 1] && isElevynNameToken(words[i + 1])) {
      score += 120;
      i += 1;
      continue;
    }
    if (isElevynNameToken(words[i])) score += 100;
  }
  return score;
}

export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNameSpan(words: string[]): { start: number; end: number } | null {
  for (let i = 0; i < words.length; i++) {
    if (words[i] === 'a' && words[i + 1] && isElevynNameToken(words[i + 1])) {
      return { start: i, end: i + 2 };
    }
    if (isElevynNameToken(words[i])) {
      return { start: i, end: i + 1 };
    }
  }
  return null;
}

export function matchWakeWord(transcript: string): {
  heard: boolean;
  remainder: string;
} {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return { heard: false, remainder: '' };

  const words = normalized.split(' ').filter(Boolean);
  const span = findNameSpan(words);
  if (!span) return { heard: false, remainder: normalized };

  const before = words.slice(0, span.start);
  const after = words.slice(span.end).join(' ').trim();

  // Strip leading fillers: "um hey Elevyn…" / "so Elevyn…"
  let i = 0;
  while (i < before.length && FILLER_WORDS.has(before[i])) i += 1;
  const lead = before.slice(i);

  // "Hey Elevyn …" / "Okay Elevyn …"
  if (lead.length === 1 && GREETING_WORDS.has(lead[0])) {
    return { heard: true, remainder: after };
  }
  // Bare name at the start (after optional fillers): "Elevyn open notes"
  if (lead.length === 0) {
    return { heard: true, remainder: after };
  }

  return { heard: false, remainder: normalized };
}

/**
 * Decide whether Elevyn is being addressed.
 * - Default: "Hey Elevyn" / bare name at the start.
 * - Work wake: name may appear mid-sentence (address only).
 * - Command phase: only strip a *leading* name — never mid-phrase
 *   tokens like "eleven" in "remind me at eleven".
 */
export function matchAddress(
  transcript: string,
  opts: { workMode?: boolean; leadingOnly?: boolean } = {},
): { heard: boolean; remainder: string } {
  if (opts.leadingOnly || !opts.workMode) return matchWakeWord(transcript);

  const normalized = normalizeTranscript(transcript);
  if (!normalized) return { heard: false, remainder: '' };

  const words = normalized.split(' ').filter(Boolean);
  const span = findNameSpan(words);
  if (!span) return { heard: false, remainder: normalized };

  // Drop an optional greeting immediately before the name.
  let start = span.start;
  if (start > 0 && GREETING_WORDS.has(words[start - 1])) start -= 1;

  const after = words.slice(span.end).join(' ').trim();
  return { heard: true, remainder: after };
}

/**
 * Interrupt words that halt Elevyn mid-speech, with or without the name.
 * "Elevyn stop" / "stop" / "hold on" all cut speech instantly.
 */
const STOP_BARE =
  /^(?:stop|wait|hold on|hang on|shut up|quiet|silence|enough|pause|never ?mind|cancel|that'?s enough)$/i;

export function matchStopCommand(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return false;

  const words = normalized.split(' ').filter(Boolean);
  const check = (slice: string[]) => {
    if (!slice.length) return false;
    let i = 0;
    if (GREETING_WORDS.has(slice[0])) i += 1;
    if (i < slice.length && isElevynNameToken(slice[i])) i += 1;
    const rest = slice.slice(i).join(' ');
    return STOP_BARE.test(rest);
  };

  if (check(words)) return true;
  for (let take = 1; take <= Math.min(4, words.length); take++) {
    if (check(words.slice(-take))) return true;
  }
  return false;
}

/**
 * Echo guard: Chrome's mic often hears Elevyn's own TTS.
 * Treat as echo when heard content is largely already in the reply.
 */
export function isEchoOfReply(heard: string, reply: string): boolean {
  const words = (s: string) =>
    normalizeTranscript(s)
      .split(' ')
      .filter(Boolean)
      .filter((w) => w.length > 1 || w === 'i' || w === 'a');
  const heardWords = words(heard);
  if (!heardWords.length) return true;
  if (!reply.trim()) return false;

  const replyNorm = normalizeTranscript(reply);
  const heardNorm = normalizeTranscript(heard);
  // Direct containment — classic speaker bleed.
  if (heardNorm.length >= 4 && replyNorm.includes(heardNorm)) return true;
  if (replyNorm.length >= 4 && heardNorm.includes(replyNorm)) return true;

  const STOP = new Set([
    'stop',
    'wait',
    'quiet',
    'enough',
    'pause',
    'cancel',
  ]);
  // One-word barge-ins that are not the name: allow through.
  if (heardWords.length === 1 && STOP.has(heardWords[0])) return false;
  // Bare name / "hey Elevyn" during/after speech is usually the user
  // re-addressing — never treat as echo.
  if (heardWords.length === 1 && isElevynNameToken(heardWords[0])) return false;
  if (
    heardWords.length === 2 &&
    GREETING_WORDS.has(heardWords[0]) &&
    isElevynNameToken(heardWords[1])
  ) {
    return false;
  }

  const replyWords = words(reply);
  if (!replyWords.length) return false;
  const replySet = new Set(replyWords);
  const hits = heardWords.filter((w) => replySet.has(w)).length;
  const ratio = hits / heardWords.length;
  // Short fragments of the reply are almost always bleed-through.
  if (heardWords.length <= 4) return ratio >= 0.5;
  return ratio >= 0.55;
}

/**
 * Capture lines Kevin can fire without saying "Elevyn" while recording is armed.
 */
const CAPTURE_LINE =
  /^(?:note that|capture that|capture this|for the record|minute that|log that|jot that)\s+(.+)$/i;

export function matchCaptureShortcut(transcript: string): string | null {
  const cleaned = transcript.trim();
  if (!cleaned) return null;
  // Allow the shortcut even if STT prepends filler ("um note that…").
  const idx = cleaned.search(
    /\b(?:note that|capture that|capture this|for the record|minute that|log that|jot that)\b/i,
  );
  if (idx < 0) return null;
  const sliced = cleaned.slice(idx);
  if (!CAPTURE_LINE.test(sliced)) return null;
  return sliced;
}
