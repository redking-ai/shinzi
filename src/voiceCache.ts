/**
 * voiceCache.ts
 *
 * Local IndexedDB cache ("Client CDN") for voice notes.
 * - Stores voice audio Blobs locally on the user's device.
 * - Senders can play their own voice notes instantly without waiting for Drive uploads.
 * - Receivers cache the audio upon first play so subsequent plays use 0 data and work offline.
 */

const DB_NAME = 'shinzi_voice_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'voice_audios';

const memoryCache = new Map<string, Blob>();
const objectUrlMap = new Map<string, string>();

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB not supported'));
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Cache an audio Blob for a message ID.
 */
export async function cacheAudioBlob(id: string, blob: Blob): Promise<string> {
  if (!id || !blob) return '';
  memoryCache.set(id, blob);

  if (objectUrlMap.has(id)) {
    try {
      URL.revokeObjectURL(objectUrlMap.get(id)!);
    } catch {}
  }
  const url = URL.createObjectURL(blob);
  objectUrlMap.set(id, url);

  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(blob, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[voiceCache] IndexedDB store warning (memory fallback active):', err);
  }

  return url;
}

/**
 * Retrieve cached audio object URL for a message ID.
 * Returns null if not cached yet.
 */
export async function getCachedAudioUrl(id: string): Promise<string | null> {
  if (!id) return null;

  if (objectUrlMap.has(id)) {
    return objectUrlMap.get(id)!;
  }

  if (memoryCache.has(id)) {
    const blob = memoryCache.get(id)!;
    const url = URL.createObjectURL(blob);
    objectUrlMap.set(id, url);
    return url;
  }

  try {
    const db = await getDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });

    if (blob instanceof Blob) {
      memoryCache.set(id, blob);
      const url = URL.createObjectURL(blob);
      objectUrlMap.set(id, url);
      return url;
    }
  } catch (err) {
    console.warn('[voiceCache] IndexedDB read warning:', err);
  }

  return null;
}

/**
 * Remove cached audio for a message ID.
 */
export async function removeCachedAudio(id: string): Promise<void> {
  if (!id) return;
  memoryCache.delete(id);

  if (objectUrlMap.has(id)) {
    try {
      URL.revokeObjectURL(objectUrlMap.get(id)!);
    } catch {}
    objectUrlMap.delete(id);
  }

  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
}
