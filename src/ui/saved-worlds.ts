import type { SavedWorld } from '../sim/protocol';

/**
 * Saved worlds in this browser (IndexedDB): one auto-save, which the app
 * resumes from when reopened, and any number of branch points to jump back
 * to. A small summary is stored apart from each world, so listing branches
 * never reads whole worlds. Every call fails soft (private mode, storage
 * full, blocked): it resolves to null / false / [] instead of throwing.
 */

export const AUTOSAVE_KEY = 'autosave';

export interface SavedWorldInfo {
  readonly key: string;
  readonly kind: 'auto' | 'branch';
  readonly label: string;
  readonly tick: number;
  readonly seed: string | number;
  readonly population: number;
  readonly savedAt: string;
}

const DB_NAME = 'alife-lab';
const WORLDS = 'worlds';
const INFO = 'info';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(WORLDS);
        request.result.createObjectStore(INFO, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Runs one transaction; resolves to `fallback` on any failure. */
async function withStores<T>(
  mode: IDBTransactionMode,
  fallback: T,
  body: (worlds: IDBObjectStore, info: IDBObjectStore) => IDBRequest | void,
  read?: (request: IDBRequest) => T
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise<T>((resolve) => {
    try {
      const tx = db.transaction([WORLDS, INFO], mode);
      const request = body(tx.objectStore(WORLDS), tx.objectStore(INFO));
      tx.oncomplete = () => {
        db.close();
        resolve(request && read ? read(request) : (true as unknown as T));
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(fallback);
      };
    } catch {
      db.close();
      resolve(fallback);
    }
  });
}

export function infoFor(key: string, kind: SavedWorldInfo['kind'], label: string, saved: SavedWorld): SavedWorldInfo {
  return {
    key,
    kind,
    label,
    tick: saved.world.tick,
    seed: saved.world.config.seed,
    population: saved.world.organisms.length,
    savedAt: saved.savedAt,
  };
}

export function putWorld(info: SavedWorldInfo, saved: SavedWorld): Promise<boolean> {
  return withStores('readwrite', false, (worlds, infos) => {
    worlds.put(saved, info.key);
    infos.put(info);
  });
}

export function getWorld(key: string): Promise<SavedWorld | null> {
  return withStores<SavedWorld | null>('readonly', null, (worlds) => worlds.get(key), (r) => (r.result as SavedWorld) ?? null);
}

export function getInfo(key: string): Promise<SavedWorldInfo | null> {
  return withStores<SavedWorldInfo | null>('readonly', null, (_w, infos) => infos.get(key), (r) => (r.result as SavedWorldInfo) ?? null);
}

/** Branch points, newest first. */
export async function listBranches(): Promise<SavedWorldInfo[]> {
  const all = await withStores<SavedWorldInfo[]>('readonly', [], (_w, infos) => infos.getAll(), (r) => r.result as SavedWorldInfo[]);
  return all.filter((i) => i.kind === 'branch').sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function deleteWorld(key: string): Promise<boolean> {
  return withStores('readwrite', false, (worlds, infos) => {
    worlds.delete(key);
    infos.delete(key);
  });
}
