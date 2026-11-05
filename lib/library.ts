import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Clip, Duration, LookId, Ratio, Resolution } from "./options";

const root = path.join(process.cwd(), "data");
const videoDir = path.join(root, "videos");
const catalogPath = path.join(root, "library.json");
const MAX_CLIPS = 30;

export type NewClip = {
  video: Buffer;
  prompt: string;
  aspectRatio: Ratio;
  resolution: Resolution;
  duration: Duration;
  look: LookId;
  interactionId: string;
  hasImage: boolean;
  parentId: string | null;
};

async function ensure() {
  await mkdir(videoDir, { recursive: true });
}

async function readAll(): Promise<Clip[]> {
  try {
    const raw = await readFile(catalogPath, "utf8");
    const parsed = JSON.parse(raw) as Clip[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();

function lock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function videoPath(id: string) {
  if (!/^[a-zA-Z0-9-]{10,80}$/.test(id)) return null;
  return path.join(videoDir, `${id}.mp4`);
}

export async function listClips() {
  await ensure();
  return readAll();
}

export async function saveClip(input: NewClip) {
  return lock(async () => {
    await ensure();
    const id = randomUUID();
    const file = path.join(videoDir, `${id}.mp4`);
    await writeFile(file, input.video);
    const info = await stat(file);
    const clip: Clip = {
      id,
      createdAt: new Date().toISOString(),
      bytes: info.size,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      duration: input.duration,
      look: input.look,
      interactionId: input.interactionId,
      hasImage: input.hasImage,
      parentId: input.parentId,
    };
    const clips = await readAll();
    clips.unshift(clip);
    const extra = clips.splice(MAX_CLIPS);
    const tmp = `${catalogPath}.tmp`;
    await writeFile(tmp, JSON.stringify(clips, null, 2));
    await rename(tmp, catalogPath);
    await Promise.all(
      extra.map((item) =>
        unlink(path.join(videoDir, `${item.id}.mp4`)).catch(() => undefined),
      ),
    );
    return clip;
  });
}

export async function removeClip(id: string) {
  return lock(async () => {
    const file = videoPath(id);
    if (!file) return false;
    const clips = (await readAll()).filter((clip) => clip.id !== id);
    await ensure();
    const tmp = `${catalogPath}.tmp`;
    await writeFile(tmp, JSON.stringify(clips, null, 2));
    await rename(tmp, catalogPath);
    await unlink(file).catch(() => undefined);
    return true;
  });
}
