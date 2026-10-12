import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'ot-scheduler';
const DB_VERSION = 1;
const STORE_NAME = 'app-state';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function saveState(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, value, key);
}

export async function loadState<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, key);
}

export async function clearState(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}

// Debounced save utility — one timer PER key, so saving one key (e.g. custom
// rules) never cancels a pending save of another (e.g. app-state).
const saveTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedSave(key: string, value: unknown, delay = 2000): void {
  const existing = saveTimeouts.get(key);
  if (existing) clearTimeout(existing);
  saveTimeouts.set(
    key,
    setTimeout(() => {
      saveTimeouts.delete(key);
      saveState(key, value).catch(console.error);
    }, delay)
  );
}
