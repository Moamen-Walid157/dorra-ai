export const MODEL_ID = "gemini-omni-1.1-flash";
export const MODEL_NAME = "Gemini Omni Flash 1.1";
export const KEY_LABEL = "Moamen api";

export const RATIOS = ["16:9", "9:16"] as const;
export const RESOLUTIONS = ["360p", "720p", "1080p", "4k"] as const;
export const DURATIONS = ["4s", "6s", "8s", "10s"] as const;

export const LOOKS = [
  {
    id: "natural",
    label: "Natural",
    note: "Your prompt, with nothing added.",
    suffix: "",
  },
  {
    id: "noir",
    label: "Noir",
    note: "Hard light, deep shadow, 35mm grain.",
    suffix:
      "Photographed like 35mm noir: hard key light, deep shadows, restrained color, fine grain.",
  },
  {
    id: "golden",
    label: "Golden hour",
    note: "Warm sun and a soft flare.",
    suffix: "Golden-hour sunlight, warm color, soft lens flare, gentle air.",
  },
  {
    id: "aerial",
    label: "Aerial",
    note: "A smooth, wide drone move.",
    suffix:
      "Smooth aerial camera, wide geography, crisp detail, light wind in the audio.",
  },
  {
    id: "product",
    label: "Product",
    note: "Clean studio light and a slow move.",
    suffix:
      "Clean studio product cinematography, soft controlled light, slow camera move, uncluttered background, no titles.",
  },
  {
    id: "neon",
    label: "Night city",
    note: "Wet streets and neon color.",
    suffix:
      "Rain-soaked city at night, neon reflections, anamorphic bokeh, atmospheric street audio.",
  },
] as const;

export type Ratio = (typeof RATIOS)[number];
export type Resolution = (typeof RESOLUTIONS)[number];
export type Duration = (typeof DURATIONS)[number];
export type LookId = (typeof LOOKS)[number]["id"];

export type Clip = {
  id: string;
  createdAt: string;
  bytes: number;
  prompt: string;
  aspectRatio: Ratio;
  resolution: Resolution;
  duration: Duration;
  look: LookId;
  interactionId: string;
  hasImage: boolean;
  parentId: string | null;
};

export function isRatio(value: string): value is Ratio {
  return (RATIOS as readonly string[]).includes(value);
}

export function isResolution(value: string): value is Resolution {
  return (RESOLUTIONS as readonly string[]).includes(value);
}

export function isDuration(value: string): value is Duration {
  return (DURATIONS as readonly string[]).includes(value);
}

export function isLook(value: string): value is LookId {
  return LOOKS.some((look) => look.id === value);
}

export function lookById(id: string) {
  return LOOKS.find((look) => look.id === id) ?? LOOKS[0];
}

export function composePrompt(prompt: string, look: LookId, avoid: string) {
  const parts = [prompt.trim()];
  const suffix = lookById(look).suffix;
  if (suffix) parts.push(suffix);
  const cleaned = avoid.trim();
  if (cleaned) parts.push(`Do not include: ${cleaned}.`);
  return parts.join("\n\n");
}

export const SAMPLES = [
  {
    title: "Paper boat",
    text: "A paper boat crosses a sunlit stone courtyard fountain. The camera stays low with the water. Soft courtyard ambience, no dialogue.",
  },
  {
    title: "Ink in water",
    text: "Macro of black ink blooming through clear water, then a slow pull back to a glass desk by a window. Quiet piano, no text.",
  },
  {
    title: "Candle dessert",
    text: "A chef plates a dark chocolate dessert beside one candle. Steam rises as the camera slowly orbits. Close, tactile, no talking.",
  },
];
