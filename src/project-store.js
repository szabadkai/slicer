const DB_NAME = 'slicelab-projects';
const DB_VERSION = 1;
const STORE_NAME = 'autosaves';
const AUTOSAVE_KEY = 'latest';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let request;
    try {
      request = callback(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(request?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function loadAutosavedProject() {
  if (!('indexedDB' in window)) return null;
  return withStore('readonly', store => store.get(AUTOSAVE_KEY));
}

export async function saveAutosavedProject(projectSnapshot) {
  if (!('indexedDB' in window)) return;
  return withStore('readwrite', store => store.put({
    ...projectSnapshot,
    id: AUTOSAVE_KEY,
    savedAt: new Date().toISOString(),
  }));
}

export async function deleteAutosavedProject() {
  if (!('indexedDB' in window)) return;
  return withStore('readwrite', store => store.delete(AUTOSAVE_KEY));
}
