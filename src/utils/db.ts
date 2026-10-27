/**
 * AuraBeats IndexedDB Wrapper.
 * ----------------------------------------------------------------------------
 * Used for storing large binary blobs (MP3 files) for offline playback.
 * localStorage is too small for media, but IndexedDB can store gigabytes.
 */

import type { Track } from "@/types";

const DB_NAME = "aurabeats_media";
const STORE_NAME = "tracks";
const DB_VERSION = 1;

export interface OfflineEntry {
  id: string;
  track: Track;
  /** the audio itself (web, other sources)… */
  blob?: Blob;
  /** …or a file the Android app keeps in its own storage (YouTube songs) */
  path?: string;
  bytes?: number;
  savedAt: number;
}

export interface OfflineSource {
  blob?: Blob;
  path?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** One shared connection (re-opened if it is ever closed or fails). */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onsuccess = () => {
      const conn = request.result;
      conn.onversionchange = () => {
        conn.close();
        dbPromise = null;
      };
      conn.onclose = () => {
        dbPromise = null;
      };
      resolve(conn);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
  return dbPromise;
}

export const db = {
  async saveTrack(track: Track, blob: Blob): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const entry: OfflineEntry = { id: track.id, track, blob, savedAt: Date.now() };
      const request = store.put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },

  async saveTrackFile(track: Track, path: string, bytes: number): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const entry: OfflineEntry = { id: track.id, track, path, bytes, savedAt: Date.now() };
      const request = tx.objectStore(STORE_NAME).put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },

  /** What to play for a saved track: its blob or its file. */
  async getTrackSource(id: string): Promise<OfflineSource | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const res = request.result as OfflineEntry | undefined;
        resolve(res && (res.blob || res.path) ? { blob: res.blob, path: res.path } : null);
      };
    });
  },

  /** Files kept on the device by saved tracks, and the total size of everything saved. */
  async usage(): Promise<{ count: number; bytes: number; paths: string[] }> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const all = request.result as OfflineEntry[];
        resolve({
          count: all.length,
          bytes: all.reduce((n, e) => n + (e.blob?.size ?? e.bytes ?? 0), 0),
          paths: all.flatMap((e) => (e.path ? [e.path] : [])),
        });
      };
    });
  },

  async getTrackBlob(id: string): Promise<Blob | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const res = request.result as OfflineEntry | undefined;
        resolve(res?.blob ?? null);
      };
    });
  },

  async getAllTracks(): Promise<Track[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const results = request.result as OfflineEntry[];
        // Sort by savedAt desc
        resolve(results.sort((a, b) => b.savedAt - a.savedAt).map((r) => r.track));
      };
    });
  },

  /** Every saved record (full backup). */
  async allEntries(): Promise<OfflineEntry[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as OfflineEntry[]);
    });
  },

  /** The whole saved record (for Undo after a removal). */
  async getEntry(id: string): Promise<OfflineEntry | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve((request.result as OfflineEntry | undefined) ?? null);
    });
  },

  async putEntry(entry: OfflineEntry): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },

  async deleteTrack(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },

  async clearAll(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  },
};
