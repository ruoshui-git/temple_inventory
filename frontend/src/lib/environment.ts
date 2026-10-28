type EnvironmentName = "production" | "sample" | "staging" | "development";
export type EnvironmentDescriptor = {
  environment: EnvironmentName;
  label: string;
  title: string;
  short_name: string;
  theme_color: string;
};

const production: EnvironmentDescriptor = {
  environment: "production",
  label: "",
  title: "物资管理",
  short_name: "物资管理",
  theme_color: "#28684e",
};
const environmentNames: EnvironmentName[] = [
  "production",
  "sample",
  "staging",
  "development",
];

export function readEnvironment(value: unknown): EnvironmentDescriptor {
  if (!value || typeof value !== "object") return { ...production };
  const candidate = value as Partial<EnvironmentDescriptor>;
  if (
    !candidate.environment ||
    !environmentNames.includes(candidate.environment) ||
    typeof candidate.label !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.short_name !== "string" ||
    typeof candidate.theme_color !== "string"
  )
    return { ...production };
  return candidate as EnvironmentDescriptor;
}

declare global {
  interface Window {
    environment?: unknown;
  }
}

export const environment = readEnvironment(
  typeof window === "undefined" ? undefined : window.environment,
);

export function applyEnvironmentDocument(settings = environment): void {
  document.title = settings.title;
  const theme = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (theme) theme.content = settings.theme_color;
  document.documentElement.style.setProperty(
    "--ti-environment-color",
    settings.theme_color,
  );
}
