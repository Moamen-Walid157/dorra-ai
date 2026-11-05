import { composePrompt, MODEL_ID, type Duration, type LookId, type Ratio, type Resolution } from "./options";

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export type GenerateInput = {
  prompt: string;
  aspectRatio: Ratio;
  resolution: Resolution;
  duration: Duration;
  look: LookId;
  avoid: string;
  image: { data: string; mimeType: string } | null;
  previousInteractionId: string | null;
};

type VideoPart = { data?: string; uri?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function requireKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) throw new GeminiError("Paste the Google AI key to render.", 400);
  return key;
}

function blobFromBase64(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "video/mp4" });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function unwrap(payload: unknown) {
  const root = asRecord(payload);
  return asRecord(root?.interaction) ?? root;
}

function videoFrom(payload: unknown): VideoPart | null {
  const root = unwrap(payload);
  if (!root) return null;
  const direct = asRecord(root.output_video);
  if (direct && (typeof direct.data === "string" || typeof direct.uri === "string")) {
    return {
      data: typeof direct.data === "string" ? direct.data : undefined,
      uri: typeof direct.uri === "string" ? direct.uri : undefined,
    };
  }
  const steps = Array.isArray(root.steps) ? root.steps : [];
  for (const step of steps) {
    const content = asRecord(step)?.content;
    const parts = Array.isArray(content) ? content : [];
    for (const part of parts) {
      const record = asRecord(part);
      if (
        record?.type === "video" &&
        (typeof record.data === "string" || typeof record.uri === "string")
      ) {
        return {
          data: typeof record.data === "string" ? record.data : undefined,
          uri: typeof record.uri === "string" ? record.uri : undefined,
        };
      }
    }
  }
  return null;
}

function textFrom(payload: unknown) {
  const root = unwrap(payload);
  const chunks: string[] = [];
  const steps = Array.isArray(root?.steps) ? root.steps : [];
  for (const step of steps) {
    const content = asRecord(step)?.content;
    const parts = Array.isArray(content) ? content : [];
    for (const part of parts) {
      const record = asRecord(part);
      if (typeof record?.text === "string" && record.type !== "thought") {
        chunks.push(record.text);
      }
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function stateOf(payload: unknown) {
  const root = asRecord(payload);
  const state = root?.state;
  if (typeof state === "string") return state.toUpperCase();
  const named = asRecord(state);
  return typeof named?.name === "string" ? named.name.toUpperCase() : "";
}

async function googleError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  const message = payload?.error?.message || response.statusText || "Google rejected the render.";
  return message.replace(/\s+/g, " ").trim().slice(0, 700);
}

function buildBody(input: GenerateInput, includeDuration: boolean) {
  let prompt = composePrompt(input.prompt, input.look, input.avoid);
  if (!includeDuration) {
    prompt += `\n\nThe shot lasts about ${input.duration.replace("s", "")} seconds.`;
  }

  const responseFormat: Record<string, string> = {
    type: "video",
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
    delivery: "uri",
  };
  if (includeDuration) responseFormat.duration = input.duration;

  const task = input.previousInteractionId
    ? "edit"
    : input.image
      ? "image_to_video"
      : "text_to_video";

  const body: Record<string, unknown> = {
    model: MODEL_ID,
    input:
      input.image && !input.previousInteractionId
        ? [
            { type: "image", data: input.image.data, mime_type: input.image.mimeType },
            { type: "text", text: prompt },
          ]
        : prompt,
    response_format: responseFormat,
    store: true,
    background: false,
    stream: false,
    generation_config: { video_config: { task } },
  };

  if (input.previousInteractionId) {
    body.previous_interaction_id = input.previousInteractionId;
  }
  return body;
}

async function createInteraction(key: string, body: Record<string, unknown>) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  });

  if (!response.ok) {
    throw new GeminiError(await googleError(response), response.status);
  }

  return response.json() as Promise<unknown>;
}

async function pollInteraction(key: string, id: string) {
  const deadline = Date.now() + 180_000;
  let latest: unknown = null;
  while (Date.now() < deadline) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(id)}`,
      {
        headers: { "x-goog-api-key": key },
        cache: "no-store",
      },
    );
    if (!response.ok) throw new GeminiError(await googleError(response), response.status);
    latest = await response.json();
    const status = String(unwrap(latest)?.status || "").toLowerCase();
    if (status === "completed" || status === "failed" || status === "cancelled" || videoFrom(latest)) {
      return latest;
    }
    await sleep(4000);
  }
  return latest;
}

async function downloadUri(key: string, uri: string) {
  const id = uri.match(/files\/([^/:?]+)/)?.[1];
  if (!id) throw new GeminiError("Google returned a video link Dorra could not read.");

  const deadline = Date.now() + 90_000;
  let state = "";
  while (Date.now() < deadline) {
    const info = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${id}`, {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
    });
    if (info.ok) {
      state = stateOf(await info.json());
      if (state.includes("ACTIVE")) break;
      if (state.includes("FAIL")) throw new GeminiError("Google failed while preparing the video file.");
    }
    await sleep(3000);
  }

  if (!state.includes("ACTIVE")) {
    throw new GeminiError("The video stayed in processing too long. Try 720p or a shorter shot.");
  }

  const file = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/files/${id}:download?alt=media`,
    {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
    },
  );
  if (!file.ok) throw new GeminiError(await googleError(file), file.status);
  const video = await file.blob();
  if (video.size < 1000) throw new GeminiError("Google returned an empty video.");
  return video;
}

async function videoBytes(key: string, payload: unknown) {
  const part = videoFrom(payload);
  if (part?.data && part.data.length > 100) {
    const video = blobFromBase64(part.data);
    if (video.size < 1000) throw new GeminiError("Google returned an empty video.");
    return video;
  }
  if (part?.uri) return downloadUri(key, part.uri);
  const status = String(unwrap(payload)?.status || "").toLowerCase();
  const detail = textFrom(payload);
  if (status === "failed" || status === "cancelled") {
    throw new GeminiError(detail || "Google cancelled this render.");
  }
  throw new GeminiError(detail || "The model did not return a video. Try a more concrete shot.");
}

async function renderOnce(key: string, input: GenerateInput, includeDuration: boolean) {
  let payload = await createInteraction(key, buildBody(input, includeDuration));
  const id = typeof unwrap(payload)?.id === "string" ? String(unwrap(payload)?.id) : "";
  const status = String(unwrap(payload)?.status || "").toLowerCase();
  if (id && status && status !== "completed" && status !== "failed" && !videoFrom(payload)) {
    payload = await pollInteraction(key, id);
  }
  const video = await videoBytes(key, payload);
  const interactionId = typeof unwrap(payload)?.id === "string" ? String(unwrap(payload)?.id) : id;
  if (!interactionId) throw new GeminiError("Google finished the video without an id, so it cannot be revised.");
  return { interactionId, video };
}

export async function generateVideo(apiKey: string, input: GenerateInput) {
  const key = requireKey(apiKey);
  try {
    return await renderOnce(key, input, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof GeminiError ? error.status : 0;
    const durationRejected = status === 400 && /duration/i.test(message) && /invalid|unknown|allowed|must|enum/i.test(message);
    if (!durationRejected) throw error;
    return renderOnce(key, input, false);
  }
}

export async function checkModel(apiKey: string) {
  const key = requireKey(apiKey);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}`,
    {
      headers: { "x-goog-api-key": key },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new GeminiError(await googleError(response), response.status);
  const payload = (await response.json()) as { displayName?: string };
  return payload.displayName || MODEL_ID;
}
