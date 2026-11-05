"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { listClips, readVideo, removeClip, saveClip } from "@/lib/clips";
import { checkModel, generateVideo } from "@/lib/gemini";
import {
  DURATIONS,
  KEY_LABEL,
  LOOKS,
  MODEL_NAME,
  RATIOS,
  RESOLUTIONS,
  SAMPLES,
  lookById,
  type Clip,
  type Duration,
  type LookId,
  type Ratio,
  type Resolution,
} from "@/lib/options";

type Status = { ok: boolean; name: string; reason?: string };

const draftRatio = (clip: Clip | null, ratio: Ratio) => clip?.aspectRatio ?? ratio;

function formatTc(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 24);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `00:${pad(minutes)}:${pad(whole)}:${pad(frames)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

async function stillFromFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Use a JPG, PNG, or WebP still.");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not read that still.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Could not prepare that still.");
  const dataUrl = await blobToDataUrl(blob);
  return { data: dataUrl.split(",")[1] || "", preview: dataUrl };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that still."));
    reader.readAsDataURL(blob);
  });
}

export default function Studio({
  apiKey,
  onLock,
  onReplaceKey,
}: {
  apiKey: string;
  onLock: () => void;
  onReplaceKey: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [revision, setRevision] = useState("");
  const [avoid, setAvoid] = useState("");
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [duration, setDuration] = useState<Duration>("6s");
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [look, setLook] = useState<LookId>("natural");
  const [image, setImage] = useState<{ data: string; preview: string } | null>(null);
  const [over, setOver] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState<"new" | "edit" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(true);
  const [armed, setArmed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);

  const active = clips.find((clip) => clip.id === activeId) ?? null;
  const frame = draftRatio(active, ratio);
  const selectedLook = lookById(look);

  useEffect(() => {
    let cancelled = false;
    checkModel(apiKey)
      .then((name) => {
        if (!cancelled) setStatus({ ok: true, name });
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setStatus({
            ok: false,
            name: MODEL_NAME,
            reason: caught instanceof Error ? caught.message : "Could not reach Google.",
          });
        }
      });
    listClips()
      .then(async (stored) => {
        const nextUrls: Record<string, string> = {};
        for (const clip of stored) {
          const video = await readVideo(clip.id);
          if (!video) continue;
          nextUrls[clip.id] = URL.createObjectURL(video);
        }
        if (cancelled) {
          Object.values(nextUrls).forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        urlsRef.current = nextUrls;
        setUrls(nextUrls);
        setClips(stored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    return () => {
      Object.values(urlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!rendering) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [rendering]);

  useEffect(() => {
    setMuted(true);
    setTime(0);
    const node = videoRef.current;
    if (!node || !active) return;
    node.play().catch(() => undefined);
  }, [active]);

  async function takeFile(file: File | undefined) {
    if (!file) return;
    try {
      setError("");
      setImage(await stillFromFile(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not use that still.");
    }
  }

  async function render(kind: "new" | "edit") {
    if (busy.current) return;
    const text = kind === "edit" ? revision.trim() : prompt.trim();
    if (text.length < 8) {
      setError(kind === "edit" ? "Say what should change." : "Describe the shot in a little more detail.");
      return;
    }
    if (kind === "edit" && !active?.interactionId) {
      setError("This cut cannot be revised. Render a new shot instead.");
      return;
    }
    busy.current = true;
    setRendering(kind);
    setElapsed(0);
    setError("");
    try {
      const aspectRatio = kind === "edit" && active ? active.aspectRatio : ratio;
      const resolutionChoice = kind === "edit" && active ? active.resolution : resolution;
      const durationChoice = kind === "edit" && active ? active.duration : duration;
      const lookChoice = kind === "edit" && active ? active.look : look;
      const result = await generateVideo(apiKey, {
        prompt: text,
        aspectRatio,
        resolution: resolutionChoice,
        duration: durationChoice,
        look: lookChoice,
        avoid: kind === "edit" ? "" : avoid,
        image: kind === "new" && image ? { data: image.data, mimeType: "image/jpeg" } : null,
        previousInteractionId: kind === "edit" ? active?.interactionId ?? null : null,
      });
      const clip: Clip = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        bytes: result.video.size,
        prompt: text,
        aspectRatio,
        resolution: resolutionChoice,
        duration: durationChoice,
        look: lookChoice,
        interactionId: result.interactionId,
        hasImage: kind === "new" && Boolean(image),
        parentId: kind === "edit" ? active?.id ?? null : null,
      };
      const dropped = await saveClip(clip, result.video);
      const url = URL.createObjectURL(result.video);
      for (const id of dropped) {
        const old = urlsRef.current[id];
        if (old) URL.revokeObjectURL(old);
        delete urlsRef.current[id];
      }
      urlsRef.current[clip.id] = url;
      setUrls({ ...urlsRef.current });
      setClips((current) => [clip, ...current.filter((item) => item.id !== clip.id && !dropped.includes(item.id))]);
      setActiveId(clip.id);
      if (kind === "edit") setRevision("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The render failed.");
    } finally {
      busy.current = false;
      setRendering(null);
    }
  }

  async function remove(id: string) {
    if (armed !== id) {
      setArmed(id);
      return;
    }
    setArmed(null);
    try {
      await removeClip(id);
    } catch {
      setError("Could not delete that shot.");
      return;
    }
    const old = urlsRef.current[id];
    if (old) URL.revokeObjectURL(old);
    delete urlsRef.current[id];
    setUrls({ ...urlsRef.current });
    setClips((current) => current.filter((clip) => clip.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function onPromptKey(event: KeyboardEvent<HTMLTextAreaElement>, kind: "new" | "edit") {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void render(kind);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="6.5" stroke="#e0a36a" strokeWidth="1.4" />
              <circle cx="11" cy="11" r="1.7" fill="#f4efe6" />
              <path d="M11 1.5v2.4M11 18.1v2.4M1.5 11h2.4M18.1 11h2.4" stroke="#e0a36a" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1>Dorra</h1>
            <p>Private screening room</p>
          </div>
        </div>
        <div className="status-wrap">
          <div className={`status ${status ? (status.ok ? "ok" : "bad") : ""}`} title={status?.reason || MODEL_NAME}>
            <strong>
              <i className="dot" />
              {status?.ok ? `${KEY_LABEL} · connected` : status ? "Key needs attention" : "Checking the key"}
            </strong>
            <span>{MODEL_NAME}</span>
          </div>
          {status && !status.ok && (
            <button type="button" className="ghost" onClick={onReplaceKey}>
              Replace key
            </button>
          )}
          <button type="button" className="ghost" onClick={onLock}>
            Lock
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="stage">
          <div className="fit">
          <div className={`frame ${frame === "9:16" ? "portrait" : ""}`}>
            {active ? (
              <video
                ref={videoRef}
                key={active.id}
                src={urls[active.id]}
                controls
                playsInline
                muted={muted}
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              />
            ) : (
              <div className="empty">
                <p className="ghostline">{prompt.trim() || "Describe the shot, and the frame will answer."}</p>
              </div>
            )}
            <div className="marks" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="tc">{formatTc(rendering ? elapsed : time)}</div>
            {rendering && (
              <>
                <div className="rec">
                  <i /> REC {formatTc(elapsed).slice(3, 8)}
                </div>
                <div className="scan" />
                <div className="indeterminate" aria-hidden>
                  <i />
                </div>
              </>
            )}
          </div>
          </div>

          <div className="under">
            <div>
              <p>{active?.prompt || "The next shot uses the direction on the right."}</p>
              <div className="meta">
                <span>{active ? `${active.aspectRatio} · ${active.resolution} · ${active.duration}` : `Next · ${ratio} · ${resolution} · ${duration}`}</span>
                <span>{active ? lookById(active.look).label : selectedLook.label}</span>
                {active && <span>{formatBytes(active.bytes)}</span>}
                <span>Sound included</span>
              </div>
            </div>
            {active && (
              <div className="row">
                <button type="button" className="ghost" onClick={() => setMuted((value) => !value)}>
                  {muted ? "Sound on" : "Mute"}
                </button>
                {urls[active.id] && (
                  <a className="ghost" href={urls[active.id]} download={`dorra-${active.id}.mp4`}>
                    Download
                  </a>
                )}
                <button type="button" className="ghost" onClick={() => setActiveId(null)}>
                  Clear screen
                </button>
              </div>
            )}
          </div>
        </div>

        <form
          className="console"
          onSubmit={(event) => {
            event.preventDefault();
            void render("new");
          }}
        >
          <div className="console-scroll">
          <h2>Direction</h2>
          <p className="fine">
            {MODEL_NAME} is the fast video model on this key. Veo Fast left the Gemini API on 22 October 2026. Each render is billed to your key.
          </p>
          {status && !status.ok && status.reason && <p className="alert">{status.reason}</p>}
          {error && <p className="alert" role="alert">{error}</p>}

          <div>
            <label htmlFor="prompt">Shot</label>
            <textarea
              id="prompt"
              value={prompt}
              maxLength={4000}
              placeholder="A single lantern drifts down a quiet canal at dusk. The camera glides beside it. Water, distant bells, no dialogue."
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => onPromptKey(event, "new")}
            />
            <div className="count">{prompt.length} / 4000</div>
          </div>

          <div className="samples" aria-label="Sample shots">
            {SAMPLES.map((sample) => (
              <button key={sample.title} type="button" onClick={() => setPrompt(sample.text)}>
                {sample.title}
              </button>
            ))}
          </div>

          <div
            className={`drop ${over ? "over" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              void takeFile(event.dataTransfer.files[0]);
            }}
          >
            {image ? <img className="thumb" alt="" src={image.preview} /> : <div className="ph">+</div>}
            <div>
              <button type="button" className="texty" onClick={() => fileRef.current?.click()}>
                {image ? "Replace starting still" : "Add a starting still"}
              </button>
              <p className="note">Optional. The still guides the first frame. Describe the motion in the shot.</p>
            </div>
            {image && (
              <button type="button" className="ghost" onClick={() => setImage(null)}>
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                void takeFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>

          <div>
            <div className="label">Look</div>
            <div className="looks">
              {LOOKS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={look === item.id}
                  onClick={() => setLook(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="note">{selectedLook.note}</p>
          </div>

          <div>
            <div className="label">Frame</div>
            <div className="segment">
              {RATIOS.map((item) => (
                <button key={item} type="button" aria-pressed={ratio === item} onClick={() => setRatio(item)}>
                  {item === "16:9" ? "Landscape 16:9" : "Portrait 9:16"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label">Length</div>
            <div className="segment">
              {DURATIONS.map((item) => (
                <button key={item} type="button" aria-pressed={duration === item} onClick={() => setDuration(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label">Resolution</div>
            <div className="segment">
              {RESOLUTIONS.map((item) => (
                <button key={item} type="button" aria-pressed={resolution === item} onClick={() => setResolution(item)}>
                  {item === "4k" ? "4K" : item}
                </button>
              ))}
            </div>
            <p className="note">720p is the native default. 1080p and 4K are upscaled and take longer.</p>
          </div>

          <details>
            <summary>Leave something out</summary>
            <textarea
              value={avoid}
              maxLength={300}
              placeholder="captions, logos, extra people"
              onChange={(event) => setAvoid(event.target.value)}
            />
          </details>

          {active && (
            <div className="revise">
              <label htmlFor="revision">Revise this cut</label>
              <textarea
                id="revision"
                value={revision}
                maxLength={2000}
                placeholder="Make the light warmer. Keep everything else the same."
                onChange={(event) => setRevision(event.target.value)}
                onKeyDown={(event) => onPromptKey(event, "edit")}
              />
              <button
                className="ghost"
                type="button"
                disabled={Boolean(rendering) || revision.trim().length < 8}
                onClick={() => void render("edit")}
              >
                {rendering === "edit" ? `Revising · ${elapsed}s` : "Apply revision"}
              </button>
            </div>
          )}
          </div>

          <div className="actions">
            <button className="primary" type="submit" disabled={Boolean(rendering) || prompt.trim().length < 8}>
              {rendering === "new" ? `Rendering · ${elapsed}s` : "Render shot"}
            </button>
            <div className="action-line">
              <span className="hint">Ctrl + Enter</span>
              <span className="hint">{rendering ? "Keep this tab open." : "Usually about a minute."}</span>
            </div>
          </div>
        </form>
      </section>

      <footer className="reelbar">
        <div className="reel-head">
          <h2>Screened</h2>
          <span className="hint">{clips.length === 0 ? "Nothing on the reel yet" : `${clips.length} shot${clips.length === 1 ? "" : "s"}`}</span>
        </div>
        {clips.length === 0 ? (
          <div className="empty-reel">Rendered shots collect here, newest first.</div>
        ) : (
          <div className="reel">
            {clips.map((clip) => (
              <div key={clip.id} className={`tile ${clip.id === activeId ? "active" : ""}`}>
                <button type="button" className="tile-main" onClick={() => setActiveId(clip.id)}>
                  <span>
                    {clip.parentId ? "Revision · " : ""}
                    {formatWhen(clip.createdAt)} · {clip.aspectRatio} · {clip.duration}
                  </span>
                </button>
                {urls[clip.id] && <video src={`${urls[clip.id]}#t=0.4`} muted preload="metadata" />}
                <button type="button" className="tile-x" onClick={() => void remove(clip.id)}>
                  {armed === clip.id ? "Sure?" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}
      </footer>
    </main>
  );
}
