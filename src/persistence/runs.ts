import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Mode, PipelineEvent } from '../pipeline/events';

/** Every run is logged so it can be scrubbed and replayed without another API call. */

export interface RunSummary {
  id: string;
  createdAt: number;
  mode: Mode;
  prompt: string;
  model: string;
  eventCount: number;
  done: boolean;
  /** Final reply text, for the history list. */
  reply: string;
}

export interface RunRecord extends RunSummary {
  events: PipelineEvent[];
}

interface Schema extends DBSchema {
  runs: {
    key: string;
    value: RunRecord;
    indexes: { createdAt: number };
  };
}

const KEEP = 20;
let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>('tokenscope', 1, {
      upgrade(d) {
        const store = d.createObjectStore('runs', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      },
    });
  }
  return dbPromise;
}

export async function saveRun(rec: RunRecord): Promise<void> {
  const d = await db();
  await d.put('runs', rec);
  await prune(d);
}

async function prune(d: IDBPDatabase<Schema>): Promise<void> {
  const keys = await d.getAllKeysFromIndex('runs', 'createdAt');
  if (keys.length <= KEEP) return;
  const tx = d.transaction('runs', 'readwrite');
  for (const k of keys.slice(0, keys.length - KEEP)) await tx.store.delete(k);
  await tx.done;
}

export async function listRuns(): Promise<RunSummary[]> {
  const d = await db();
  const out: RunSummary[] = [];
  let cursor = await d.transaction('runs').store.index('createdAt').openCursor(null, 'prev');
  while (cursor) {
    const { events: _events, ...summary } = cursor.value;
    void _events;
    out.push(summary);
    cursor = await cursor.continue();
  }
  return out;
}

export async function loadRun(id: string): Promise<RunRecord | undefined> {
  const d = await db();
  return d.get('runs', id);
}

export async function deleteRun(id: string): Promise<void> {
  const d = await db();
  await d.delete('runs', id);
}

export function summarize(events: readonly PipelineEvent[], done: boolean): RunSummary | null {
  const start = events.find((e) => e.type === 'run_start');
  if (!start || start.type !== 'run_start') return null;
  const det = events.find((e) => e.type === 'detokenized');
  const reply = det && det.type === 'detokenized' ? det.text : events.filter((e) => e.type === 'token_streamed').map((e) => (e.type === 'token_streamed' ? e.text : '')).join('');
  return {
    id: start.runId,
    createdAt: Date.now(),
    mode: start.mode,
    prompt: start.prompt,
    model: start.model,
    eventCount: events.length,
    done,
    reply,
  };
}
