import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryCategory, MemoryEntry } from '../../../src/types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../../data/memory');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

/**
 * Memory is intentionally NOT part of the AI provider.
 * Models are ephemeral; Elevyn's memory is durable, categorized, and searchable.
 * MVP: JSON file. V2: SQLite / vector index with the same interface.
 */
export class MemoryService {
  private cache: MemoryEntry[] | null = null;

  private async ensure(): Promise<MemoryEntry[]> {
    if (this.cache) return this.cache;
    await mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await readFile(STORE_PATH, 'utf8');
      this.cache = JSON.parse(raw) as MemoryEntry[];
    } catch {
      this.cache = seedMemory();
      await this.persist();
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    await writeFile(STORE_PATH, JSON.stringify(this.cache ?? [], null, 2), 'utf8');
  }

  async list(category?: MemoryCategory): Promise<MemoryEntry[]> {
    const all = await this.ensure();
    return category ? all.filter((e) => e.category === category) : [...all];
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    const all = await this.ensure();
    return all.find((e) => e.id === id);
  }

  async create(
    input: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MemoryEntry> {
    const all = await this.ensure();
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    all.push(entry);
    await this.persist();
    return entry;
  }

  async search(query: string): Promise<MemoryEntry[]> {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    const all = await this.ensure();
    return all.filter((entry) => {
      const haystack = [
        entry.title,
        entry.content,
        entry.category,
        ...entry.tags,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }
}

function seedMemory(): MemoryEntry[] {
  const now = new Date().toISOString();
  return [
    {
      id: randomUUID(),
      category: 'personal',
      title: 'Owner',
      content: 'Kevin Wallace. Primary interaction is voice. Projector is the main display.',
      tags: ['owner', 'kevin'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      category: 'devices',
      title: 'MacBook',
      content: 'Primary brain for Elevyn. Runs the local server and Ollama.',
      tags: ['mac', 'brain'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      category: 'devices',
      title: 'Windows Workstation',
      content: 'Secondary machine. Status is placeholder until agent bridge ships.',
      tags: ['windows', 'pc'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      category: 'preferences',
      title: 'Voice first',
      content: 'Prefer concise spoken replies. Avoid chatbot tone.',
      tags: ['voice', 'ux'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      category: 'projects',
      title: 'Elevyn',
      content: 'Building a local-first AI operating system for the room.',
      tags: ['elevyn', 'os'],
      createdAt: now,
      updatedAt: now,
    },
  ];
}
