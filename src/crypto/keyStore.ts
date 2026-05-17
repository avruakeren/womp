import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'womp-keystore';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Store for user's own cryptographic keys (Identity keys, prekeys, profile key)
        if (!db.objectStoreNames.contains('my-keys')) {
          db.createObjectStore('my-keys');
        }
        // Store for derived symmetric keys with friends, keyed by their userId
        if (!db.objectStoreNames.contains('session-keys')) {
          db.createObjectStore('session-keys');
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Save user's own private/public key
 */
export async function saveMyKey(keyName: string, key: CryptoKey | string): Promise<void> {
  const db = await getDB();
  await db.put('my-keys', key, keyName);
}

/**
 * Retrieve user's own private/public key
 */
export async function getMyKey(keyName: string): Promise<CryptoKey | string | undefined> {
  const db = await getDB();
  return await db.get('my-keys', keyName);
}

/**
 * Save a derived chat session key with a specific friend
 */
export async function saveSessionKey(friendId: string, key: CryptoKey): Promise<void> {
  const db = await getDB();
  await db.put('session-keys', key, friendId);
}

/**
 * Retrieve a derived chat session key with a specific friend
 */
export async function getSessionKey(friendId: string): Promise<CryptoKey | undefined> {
  const db = await getDB();
  return await db.get('session-keys', friendId);
}

/**
 * Clear all local keys on logout
 */
export async function clearAllLocalKeys(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['my-keys', 'session-keys'], 'readwrite');
  await tx.objectStore('my-keys').clear();
  await tx.objectStore('session-keys').clear();
  await tx.done;
}
