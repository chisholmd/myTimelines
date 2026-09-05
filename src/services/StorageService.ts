// IndexedDB Local Storage Service for Pure Client-Side Persistence
const DB_NAME = 'MyTimelineDB';
const DB_VERSION = 1;
const STORE_NAME = 'app_datasets';
const DATA_KEY = 'current_dataset';

export interface PersistedDataset {
  status: any;
  timeline: any;
  places: any;
  myMaps: any;
  updatedAt: string;
}

class StorageServiceImpl {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB is not supported in this environment.'));
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  public async saveDataset(dataset: { status: any; timeline: any; places: any; myMaps: any }): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const payload: PersistedDataset = {
        ...dataset,
        updatedAt: new Date().toISOString(),
      };

      const req = store.put(payload, DATA_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async loadDataset(): Promise<PersistedDataset | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(DATA_KEY);

      req.onsuccess = () => {
        resolve(req.result || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async hasDataset(): Promise<boolean> {
    try {
      const data = await this.loadDataset();
      return !!data && (
        (data.timeline?.visits?.length > 0) ||
        (data.places?.savedPlaces?.length > 0) ||
        (data.myMaps?.length > 0)
      );
    } catch {
      return false;
    }
  }

  public async clearDataset(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(DATA_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const StorageService = new StorageServiceImpl();
