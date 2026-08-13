/**
 * People memory — structured contacts Elevyn learns and reuses for mail/Teams.
 * Shared by client durable store and server Microsoft resolvers.
 */

export type PersonRecord = {
  name: string;
  email?: string;
  role?: string;
  notes?: string;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** Pull a person record out of a freeform “remember …” line. */
export function parsePersonFact(content: string): PersonRecord | null {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const email = cleaned.match(EMAIL_RE)?.[0]?.toLowerCase();

  // "Sarah's email is x@y.com" / "Sarah Chen email: x@y.com"
  const emailOf = cleaned.match(
    /^(.+?)(?:'s)?\s+(?:email|e-mail|mail)(?:\s+address)?\s*(?:is|:)?\s+/i,
  );
  if (emailOf && email) {
    const name = cleanPersonName(emailOf[1]);
    if (name) return { name, email };
  }

  // "email for Sarah is x" / "Sarah <x@y.com>"
  const emailFor = cleaned.match(
    /(?:email|e-mail|mail)(?:\s+address)?\s+(?:for|of)\s+(.+?)\s+(?:is|:)/i,
  );
  if (emailFor && email) {
    const name = cleanPersonName(emailFor[1]);
    if (name) return { name, email };
  }

  const angle = cleaned.match(/^(.+?)\s*<\s*([^>]+@[^>]+)\s*>/);
  if (angle) {
    const name = cleanPersonName(angle[1]);
    const addr = angle[2].trim().toLowerCase();
    if (name && EMAIL_RE.test(addr)) return { name, email: addr };
  }

  // "Sarah is my PM" / "Sarah Chen — product at Acme" (person-ish, may lack email)
  const roleMatch = cleaned.match(
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:is|—|-)\s+(?:my\s+)?(.+)$/,
  );
  if (roleMatch) {
    const name = cleanPersonName(roleMatch[1]);
    const rest = roleMatch[2].replace(EMAIL_RE, '').replace(/\s+/g, ' ').trim();
    if (name && /\b(pm|manager|lead|engineer|designer|client|investor|from|at|works)\b/i.test(rest)) {
      return {
        name,
        email,
        role: rest.slice(0, 120) || undefined,
      };
    }
  }

  if (email) {
    // "x@y.com is Sarah" / trailing name
    const nameAfter = cleaned.match(
      new RegExp(
        `${EMAIL_RE.source}\\s+(?:is|:)?\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)`,
        'i',
      ),
    );
    if (nameAfter) {
      const name = cleanPersonName(nameAfter[1]);
      if (name) return { name, email };
    }
    // Last resort: treat local-part as weak name only if explicit "contact/person"
    if (/\b(contact|person|colleague|coworker)\b/i.test(cleaned)) {
      const local = email.split('@')[0]?.replace(/[._]/g, ' ');
      const name = cleanPersonName(local ?? '');
      if (name) return { name, email };
    }
  }

  return null;
}

function cleanPersonName(raw: string): string | null {
  const name = raw
    .replace(/\b(the|a|an|my|our|their)\b/gi, ' ')
    .replace(/['’]s\b/gi, '')
    .replace(/[<>:"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < 2 || name.length > 60) return null;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(name)) return null;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format people for brain / route context. */
export function formatPeopleBlock(people: PersonRecord[]): string | undefined {
  if (!people.length) return undefined;
  const lines = people.slice(0, 40).map((p) => {
    const email = p.email ? ` <${p.email}>` : '';
    const role = p.role ? ` — ${p.role}` : '';
    return `- ${p.name}${email}${role}`;
  });
  return `=== PEOPLE ===\n${lines.join('\n')}`;
}

/** Parse === PEOPLE === (and loose durable person lines) from interpret context. */
export function parsePeopleFromContext(context?: string): PersonRecord[] {
  if (!context) return [];
  const people: PersonRecord[] = [];
  const seen = new Set<string>();

  const block = context.match(/=== PEOPLE ===\n([\s\S]*?)(?=\n===|\s*$)/);
  if (block?.[1]) {
    for (const line of block[1].split('\n')) {
      const m = line.match(
        /^\s*[-•*]\s+(.+?)(?:\s*<\s*([^>]+)\s*>)?(?:\s*[—-]\s*(.+))?$/,
      );
      if (!m) continue;
      const name = cleanPersonName(m[1]);
      if (!name) continue;
      const email = m[2]?.trim().toLowerCase();
      const role = m[3]?.trim().slice(0, 120);
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({
        name,
        email: email && EMAIL_RE.test(email) ? email : undefined,
        role: role || undefined,
      });
    }
  }

  // Also harvest [person] lines from durable memory block.
  const durable = context.match(
    /=== DURABLE MEMORY ===\n([\s\S]*?)(?=\n===|\s*$)/,
  );
  if (durable?.[1]) {
    for (const line of durable[1].split('\n')) {
      if (!/\[person\]/i.test(line)) continue;
      const content = line.replace(/^\s*[-•*]\s*\[person\]\s*/i, '').trim();
      const parsed = parsePersonFact(content);
      if (!parsed) continue;
      const key = parsed.name.toLowerCase();
      if (seen.has(key)) {
        const existing = people.find((p) => p.name.toLowerCase() === key);
        if (existing && parsed.email && !existing.email) {
          existing.email = parsed.email;
        }
        continue;
      }
      seen.add(key);
      people.push(parsed);
    }
  }

  return people;
}

/** Fuzzy match a spoken “who” against remembered people. */
export function findPersonInMemory(
  people: PersonRecord[],
  who: string,
): PersonRecord | null {
  const needle = who.trim().toLowerCase().replace(/\b(the|a|an|my)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!needle || !people.length) return null;

  if (EMAIL_RE.test(needle)) {
    const byEmail = people.find((p) => p.email?.toLowerCase() === needle);
    if (byEmail) return byEmail;
  }

  const exact = people.find((p) => p.name.toLowerCase() === needle);
  if (exact) return exact;

  const starts = people.filter(
    (p) =>
      p.name.toLowerCase().startsWith(needle) ||
      needle.startsWith(p.name.toLowerCase().split(/\s+/)[0] ?? ''),
  );
  if (starts.length === 1) return starts[0];

  const first = needle.split(/\s+/)[0] ?? needle;
  const firstHits = people.filter((p) => {
    const parts = p.name.toLowerCase().split(/\s+/);
    return parts[0] === first || parts.some((part) => part === needle);
  });
  if (firstHits.length === 1) return firstHits[0];

  const includes = people.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      needle.includes(p.name.toLowerCase()) ||
      (p.email && p.email.toLowerCase().includes(needle)),
  );
  if (includes.length === 1) return includes[0];

  return null;
}

/** Merge two person records (newer fields win when present). */
export function mergePerson(
  existing: PersonRecord | undefined,
  incoming: PersonRecord,
): PersonRecord {
  if (!existing) return { ...incoming };
  return {
    name: incoming.name || existing.name,
    email: incoming.email || existing.email,
    role: incoming.role || existing.role,
    notes: incoming.notes || existing.notes,
  };
}
