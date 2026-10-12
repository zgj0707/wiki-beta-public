import type { Query } from '@tanstack/react-query';
import type {
  PersistedClient,
  Persister,
} from '@tanstack/react-query-persist-client';
import { PUBLIC_CACHE_SCHEMA } from './cache-policy';

const DB_NAME = 'product-research-kb-cache';
const STORE_NAME = 'query-client';
const CACHE_KEY = 'public-approved';
const MAX_AGE = 24 * 60 * 60 * 1000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const indexedDbPersister: Persister = {
  persistClient: async (client) => {
    if (typeof indexedDB === 'undefined') return;
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put(client, CACHE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    database.close();
  },
  restoreClient: async () => {
    if (typeof indexedDB === 'undefined') return undefined;
    const database = await openDatabase();
    const value = await new Promise<PersistedClient | undefined>(
      (resolve, reject) => {
        const request = database
          .transaction(STORE_NAME, 'readonly')
          .objectStore(STORE_NAME)
          .get(CACHE_KEY);
        request.onsuccess = () =>
          resolve(request.result as PersistedClient | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    database.close();
    return value;
  },
  removeClient: async () => {
    if (typeof indexedDB === 'undefined') return;
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .delete(CACHE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    database.close();
  },
};

const buildSha =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_BUILD_SHA ?? 'dev';
const contentRevision =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_CONTENT_REVISION ?? 'dev';
const catalogRevision =
  (
    globalThis as typeof globalThis & {
      __INITIAL_DATA__?: { revision?: string } | null;
    }
  ).__INITIAL_DATA__?.revision ?? 'unknown';

export const publicCachePersistOptions = {
  persister: indexedDbPersister,
  maxAge: MAX_AGE,
  buster: `${PUBLIC_CACHE_SCHEMA}:${buildSha}:${contentRevision}:${catalogRevision}`,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.meta?.classification === 'PUBLIC_APPROVED',
  },
};
