// IndexedDB-backed local backup for the visit form auto-save.
//
// When a save fails (network/server error), we write the dirty values
// to a per-visit row in IndexedDB so refreshing the page doesn't lose
// the doctor's work. The next successful save clears the backup.
//
// IndexedDB was chosen over localStorage for three reasons:
//   1. PHI must never sit in localStorage/sessionStorage (CLAUDE.md
//      §6). IndexedDB is allowed because it's same-origin scoped to
//      the user's browser, can be wiped on logout, and isn't included
//      in 3rd-party tracking inventories.
//   2. The browser flushes localStorage synchronously on the main
//      thread — IndexedDB is async and won't jank typing.
//   3. We need structured storage (per-visit keys, timestamps); a
//      single localStorage key would race the auto-save.
//
// On logout we wipe the database entirely. The platform admin tooling
// has no read access to it — it's user-device-local only.

import type { VisitFormValues } from './visit-client';

const DB_NAME = 'klinika-visit-backup';
const STORE = 'visits';
const DB_VERSION = 1;

interface BackupRecord {
  visitId: string;
  values: VisitFormValues;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'visitId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function writeBackup(
  visitId: string,
  values: VisitFormValues,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const record: BackupRecord = { visitId, values, savedAt: Date.now() };
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function readBackup(visitId: string): Promise<BackupRecord | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<BackupRecord | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.get(visitId);
      req.onsuccess = () => {
        const value = req.result as BackupRecord | undefined;
        resolve(value ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return result;
}

export async function clearBackup(visitId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(visitId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function clearAllBackups(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
