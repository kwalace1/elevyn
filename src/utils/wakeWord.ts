/**
 * Wake-word matching for Elevyn.
 *
 * Browser STT mangles "Elevyn" constantly — keep a wide alias net.
 * Recognition engines can swap later (Porcupine, etc.).
 */

/** Common STT renderings of the name Elevyn. */
const NAME =
  '(?:elevyn|eleven|elevan|elevin|elevon|elevation|evelyn|ellen|levin|alevin|oliven|elevynn|elevenn|a ?eleven|11)';

const WAKE_PHRASE = new RegExp(
  String.raw`\b(?:hey|hi|ok|okay|yo|hello)\s+${NAME}\b`,
  'i',
);

const BARE_WAKE = new RegExp(String.raw`^(?:${NAME})\b`, 'i');

const ADDRESS_ANYWHERE = new RegExp(
  String.raw`\b(?:(?:hey|hi|ok|okay|yo|hello)\s+)?${NAME}\b`,
  'i',
);

export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchWakeWord(transcript: string): {
  heard: boolean;
  remainder: string;
} {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return { heard: false, remainder: '' };

  const phraseMatch = normalized.match(WAKE_PHRASE);
  if (phraseMatch && phraseMatch.index !== undefined) {
    const after = normalized
      .slice(phraseMatch.index + phraseMatch[0].length)
      .trim();
    return { heard: true, remainder: after };
  }

  if (BARE_WAKE.test(normalized)) {
    return {
      heard: true,
      remainder: normalized.replace(BARE_WAKE, '').trim(),
    };
  }

  return { heard: false, remainder: normalized };
}

/**
 * Decide whether Elevyn is being addressed.
 * - Dashboard: "Hey Elevyn" / "Hey Eleven" OR bare name at the start.
 * - Work / focus: name may appear anywhere (incl. mid-sentence).
 */
export function matchAddress(
  transcript: string,
  opts: { workMode?: boolean } = {},
): { heard: boolean; remainder: string } {
  if (!opts.workMode) return matchWakeWord(transcript);

  const normalized = normalizeTranscript(transcript);
  if (!normalized) return { heard: false, remainder: '' };

  const match = normalized.match(ADDRESS_ANYWHERE);
  if (match && match.index !== undefined) {
    const after = normalized.slice(match.index + match[0].length).trim();
    return { heard: true, remainder: after };
  }

  return { heard: false, remainder: normalized };
}

/**
 * Interrupt words that halt Elevyn mid-speech, with or without the name.
 * "Elevyn stop" / "stop" / "hold on" all cut speech instantly.
 */
const STOP_COMMAND = new RegExp(
  String.raw`^(?:(?:hey\s+)?${NAME}[\s,]+)?(?:stop|wait|hold on|hang on|shut up|quiet|silence|enough|pause|never ?mind|cancel|that'?s enough)$`,
  'i',
);

export function matchStopCommand(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return false;
  if (STOP_COMMAND.test(normalized)) return true;
  // Chrome accumulates the session transcript — also check the trailing words
  // so "…background noise… elevyn stop" still registers.
  const words = normalized.split(' ');
  for (let take = 1; take <= Math.min(3, words.length); take++) {
    if (STOP_COMMAND.test(words.slice(-take).join(' '))) return true;
  }
  return false;
}

/**
 * Echo guard: Chrome's mic sometimes hears Elevyn's own TTS. If nearly every
 * word the mic heard is already in the reply being spoken, it's an echo —
 * not Kevin interrupting.
 */
export function isEchoOfReply(heard: string, reply: string): boolean {
  const words = (s: string) => normalizeTranscript(s).split(' ').filter(Boolean);
  const heardWords = words(heard);
  if (!heardWords.length) return true;
  const replySet = new Set(words(reply));
  const hits = heardWords.filter((w) => replySet.has(w)).length;
  return hits / heardWords.length >= 0.7;
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
