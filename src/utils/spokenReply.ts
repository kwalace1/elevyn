/** Fallback when Elevyn is unsure or the model leaks technical junk. */
export const UNSURE_REPLY =
  "I'm not quite sure what you need. Could you say that another way?";

/** Detect model leakage: tool XML, fake APIs, raw JSON scaffolding, etc. */
export function looksTechnical(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/<\/?[a-zA-Z_][\w:-]*\b[^>]*>/.test(t)) return true;
  if (
    /\b(tool_call|function_call|arg_key|arg_value|commandId|tool_calls)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(microsoft\.\d|getUpcomingMeetings|graph\.microsoft|invoke[A-Z]|api[_-]?key)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^\s*[{[]/.test(t) && /"type"\s*:/.test(t)) return true;
  if (
    /\b(OAuth|Graph API|endpoint|schema|JSON|HTTP\s*\d{3}|status\s*\d{3})\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{20,})\b/.test(t)) {
    return true;
  }
  return false;
}

/** Clean a reply for TTS — returns null if it is not speakable. */
export function sanitizeSpokenReply(
  text: string | undefined | null,
): string | null {
  if (!text) return null;
  let t = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\/?[a-zA-Z_][\w:-]*\b[^>]*>/g, ' ')
    .replace(
      /\b(tool_call|function_call|arg_key|arg_value|tool_calls)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || looksTechnical(t)) return null;
  // Drop leftover JSON-ish fragments.
  t = t.replace(/\{[^{}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || looksTechnical(t) || t.length < 2) return null;
  return t.slice(0, 400);
}

/** Always return something safe to speak aloud. */
export function safeSpeakReply(text: string | undefined | null): string {
  return sanitizeSpokenReply(text) ?? UNSURE_REPLY;
}
