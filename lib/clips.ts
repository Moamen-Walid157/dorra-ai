import type { Clip } from "./options";

const DB_NAME = "dorra";
const DB_VERSION = 1;
const META = "clips";
const FILES = "files";
const MAX_CLIPS = 30;

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listClips() {
  const db = await openDb();
  const clips = await requestToPromise(db.transaction(META).objectStore(META).getAll() as IDBRequest<Clip[]>);
  db.close();
  return clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readVideo(id: string) {
  const db = await openDb();
  const video = await requestToPromise(db.transaction(FILES).objectStore(FILES).get(id) as IDBRequest<Blob | undefined>);
  db.close();
  return video ?? null;
}

export async function saveClip(clip: Clip, video: Blob) {
  const db = await openDb();
  const current = await requestToPromise(db.transaction(META).objectStore(META).getAll() as IDBRequest<Clip[]>);
  const next = [clip, ...current.filter((item) => item.id !== clip.id)].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const extra = next.splice(MAX_CLIPS);
  const tx = db.transaction([META, FILES], "readwrite");
  tx.objectStore(FILES).put(video, clip.id);
  tx.objectStore(META).put(clip);
  for (const item of extra) {
    tx.objectStore(META).delete(item.id);
    tx.objectStore(FILES).delete(item.id);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return extra.map((item) => item.id);
}

export async function removeClip(id: string) {
  const db = await openDb();
  const tx = db.transaction([META, FILES], "readwrite");
  tx.objectStore(META).delete(id);
  tx.objectStore(FILES).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
