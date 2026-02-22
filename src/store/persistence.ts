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

// Debounced save utility
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export function debouncedSave(key: string, value: unknown, delay = 2000): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveState(key, value).catch(console.error);
  }, delay);
}
