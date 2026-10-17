export const themes = [
  {
    id: "bronze",
    name: "暖砂 · 铜棕",
    en: "Warm bronze",
    canvas: "#F7F5F0",
    ink: "#292622",
    accent: "#895024",
    muted: "#686158",
    border: "#938A7D",
    soft: "#EEE4D6",
    strong: "#683A18",
    radius: "10px",
    cardRadius: "14px",
    description: "温润、有序，延续寺院物资的熟悉感。",
  },
  {
    id: "blue",
    name: "清透 · 靛蓝",
    en: "Clear blue",
    canvas: "#F5F7FA",
    ink: "#202938",
    accent: "#245DB5",
    muted: "#596577",
    border: "#7D8B9C",
    soft: "#E8EFFA",
    strong: "#194587",
    radius: "6px",
    cardRadius: "8px",
    description: "清晰、利落，让操作与数据更突出。",
  },
  {
    id: "jade",
    name: "静石 · 青玉",
    en: "Quiet jade",
    canvas: "#F4F6F3",
    ink: "#24332D",
    accent: "#28684E",
    muted: "#5E6B63",
    border: "#829288",
    soft: "#E5EEE7",
    strong: "#194C37",
    radius: "12px",
    cardRadius: "18px",
    description: "安静、柔和，为日常协作留一点呼吸。",
  },
] as const;
export type ThemeId = (typeof themes)[number]["id"];
export type Density = "compact" | "balanced" | "spacious";
export const textScales = [100, 125, 150, 175, 200] as const;
export type TextScale = (typeof textScales)[number];

export interface DisplayPreferences {
  theme: ThemeId;
  density: Density;
  textScale: TextScale;
}

export const defaultDisplayPreferences: DisplayPreferences = {
  theme: "jade",
  density: "balanced",
  textScale: 100,
};

/** Apply the same exact tokens to the app, gallery and teleported surfaces. */
export function applyDisplayPreferences(values: DisplayPreferences) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.tiDensity = values.density;
  root.dataset.tiTheme = values.theme;
  root.dataset.tiTextScale = String(values.textScale);
  root.style.setProperty("--p-text-scale", String(values.textScale / 100));
  const selected = themes.find((entry) => entry.id === values.theme)!;
  const properties = {
    canvas: selected.canvas,
    ink: selected.ink,
    accent: selected.accent,
    muted: selected.muted,
    "control-border": selected.border,
    soft: selected.soft,
    "accent-strong": selected.strong,
    "radius-control": selected.radius,
    "radius-card": selected.cardRadius,
  };
  for (const [key, value] of Object.entries(properties))
    root.style.setProperty(`--p-${key}`, value);
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("inventory-text-scale"));
}
