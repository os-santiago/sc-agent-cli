import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const MEMORY_DIR = path.join(homedir(), '.sc-agent', 'memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');

export interface MemoryEntry {
  key: string;
  content: string;
  timestamp: number;
  tags: string[];
}

interface MemoryStore {
  entries: MemoryEntry[];
  created: number;
  updated: number;
  version: number;
}

export class PersistentMemory {
  private store: MemoryStore;
  private initialized = false;

  constructor() {
    this.store = {
      entries: [],
      created: Date.now(),
      updated: Date.now(),
      version: 1,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(MEMORY_DIR, { recursive: true });
    await this.load();
    this.initialized = true;
  }

  private async load(): Promise<void> {
    try {
      if (existsSync(MEMORY_FILE)) {
        const data = await readFile(MEMORY_FILE, 'utf-8');
        this.store = JSON.parse(data);
      }
    } catch {
      // Start fresh if corrupt
    }
  }

  private async save(): Promise<void> {
    this.store.updated = Date.now();
    await writeFile(MEMORY_FILE, JSON.stringify(this.store, null, 2), 'utf-8');
  }

  async remember(key: string, content: string, tags: string[] = []): Promise<void> {
    await this.init();
    const existing = this.store.entries.findIndex(e => e.key === key);
    const entry: MemoryEntry = { key, content, timestamp: Date.now(), tags };
    if (existing >= 0) {
      this.store.entries[existing] = entry;
    } else {
      this.store.entries.push(entry);
    }
    await this.save();
  }

  async recall(key: string): Promise<string | null> {
    await this.init();
    const entry = this.store.entries.find(e => e.key === key);
    return entry ? entry.content : null;
  }

  async search(query: string): Promise<MemoryEntry[]> {
    await this.init();
    const lower = query.toLowerCase();
    return this.store.entries
      .filter(e =>
        e.key.toLowerCase().includes(lower) ||
        e.content.toLowerCase().includes(lower) ||
        e.tags.some(t => t.toLowerCase().includes(lower))
      )
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async forget(key: string): Promise<boolean> {
    await this.init();
    const len = this.store.entries.length;
    this.store.entries = this.store.entries.filter(e => e.key !== key);
    if (this.store.entries.length !== len) {
      await this.save();
      return true;
    }
    return false;
  }

  async getAll(): Promise<MemoryEntry[]> {
    await this.init();
    return [...this.store.entries].sort((a, b) => b.timestamp - a.timestamp);
  }

  async clear(): Promise<void> {
    await this.init();
    this.store.entries = [];
    await this.save();
  }

  async getSummary(): Promise<string> {
    await this.init();
    if (this.store.entries.length === 0) return 'No stored memories.';
    const lines = this.store.entries.map(e => {
      const date = new Date(e.timestamp).toISOString().split('T')[0];
      const tags = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : '';
      const preview = e.content.substring(0, 80).replace(/\n/g, ' ');
      return `  • ${e.key}${tags} (${date}): ${preview}${e.content.length > 80 ? '...' : ''}`;
    });
    return `📝 Memories (${this.store.entries.length} total)\n${lines.join('\n')}`;
  }

  async getContextString(): Promise<string> {
    await this.init();
    if (this.store.entries.length === 0) return '';
    const entries = this.store.entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
    const lines = entries.map(e => {
      const truncated = e.content.length > 200 ? e.content.substring(0, 200) + '...' : e.content;
      return `[${e.key}]: ${truncated}`;
    });
    return `\n# Persistent Memories (from previous sessions)\n${lines.join('\n')}\n`;
  }
}

export const persistentMemory = new PersistentMemory();
