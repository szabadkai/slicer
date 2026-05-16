const DB_NAME = 'slicelab-projects';
const DB_VERSION = 1;
const STORE_NAME = 'autosaves';
const AUTOSAVE_KEY = 'latest';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let request: IDBRequest<T>;
    try {
      request = callback(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }

    tx.oncomplete = (): void => {
      db.close();
      resolve(request?.result);
    };
    tx.onerror = (): void => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = (): void => {
      db.close();
      reject(tx.error);
    };
  });
}

// ─── Serialized object shape (stored in IndexedDB) ─────────

export interface SerializedMesh {
  positions: ArrayBuffer;
  normals: ArrayBuffer | null;
  position: [number, number, number];
  rotation: [number, number, number, string];
  scale: [number, number, number];
}

export interface SerializedPillar {
  id: string;
  origin: 'auto' | 'manual';
  route: { x: number; y: number; z: number; internalResting?: boolean }[];
  tipDiameter: number;
  pillarRadius: number;
  baseRadius: number;
  tipHeight: number;
  baseHeight: number;
  contact: { x: number; y: number; z: number };
  bridgeTarget?: { x: number; y: number; z: number };
}

export interface SerializedSupportTouchpoint {
  id: string;
  nodeId?: string;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  diameter: number;
  shape: 'point' | 'ball' | 'cone' | 'pad';
  priority: 'light' | 'normal' | 'heavy';
  enabled: boolean;
}

export interface SerializedSupportGraphNode {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  kind: 'tip' | 'branch' | 'trunk' | 'base';
}

export interface SerializedSupportGraphEdge {
  from: string;
  to: string;
  radius: number;
}

export interface SerializedSupportStructure {
  id: string;
  origin: 'auto' | 'manual' | 'paint';
  kind: 'pillar' | 'branching' | 'bridge';
  touchpoints: SerializedSupportTouchpoint[];
  nodes: SerializedSupportGraphNode[];
  edges: SerializedSupportGraphEdge[];
}

export interface SerializedPillarSet {
  pillars: SerializedPillar[];
  supportStructures?: SerializedSupportStructure[];
  settings: {
    crossBracing: boolean;
    basePan: { margin: number; thickness: number; lipWidth: number; lipHeight: number } | null;
    sphericalConnection: { radius: number } | null;
    supportFloorY: number;
    bracingCollisionRadius: number;
  };
}

export interface SerializedObject {
  id: string;
  positions: ArrayBuffer;
  normals: ArrayBuffer | null;
  position: [number, number, number];
  rotation: [number, number, number, string];
  scale: [number, number, number];
  elevation: number;
  materialPreset: Record<string, unknown>;
  paintStrokes?: import('./viewer-core').PaintStroke[];
  intentBuffer?: number[];
  supports: SerializedMesh | null;
  pillarSet?: SerializedPillarSet | null;
}

export interface SerializedPlate {
  id: string;
  name: string;
  objects: SerializedObject[];
  originX: number;
  originZ: number;
}

export interface ProjectSnapshot {
  version: number;
  app: string;
  selectedPrinterKey: string;
  activePlateId: string;
  plates: SerializedPlate[];
}

export async function loadAutosavedProject(): Promise<ProjectSnapshot | null> {
  if (!('indexedDB' in globalThis)) return null;
  const result = await withStore<ProjectSnapshot & { id: string }>('readonly', (store) =>
    store.get(AUTOSAVE_KEY),
  );
  if (result?.version !== 2) return null;
  return result;
}

export async function saveAutosavedProject(snapshot: ProjectSnapshot): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  await withStore('readwrite', (store) =>
    store.put({
      ...snapshot,
      id: AUTOSAVE_KEY,
      savedAt: new Date().toISOString(),
    }),
  );
}

export async function deleteAutosavedProject(): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  await withStore('readwrite', (store) => store.delete(AUTOSAVE_KEY));
}
