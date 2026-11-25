import type { LocationNode } from "../services/contracts";
import type { LocationLevel, LocationTooltip } from "./tooltip";

export function warehouseLabel(
  name: unknown,
  nodes: LocationNode[],
  explicit?: unknown,
): string {
  if (!name) return "外部";
  const node = nodes.find((row) => row.name === name);
  if (node) return node.label;
  return typeof explicit === "string" && explicit ? explicit : "位置暂不可用";
}

/** The location's own name (e.g. 阅览室), when the codes-only label does not already show it. */
export function warehouseName(name: unknown, nodes: LocationNode[]): string {
  const node = nodes.find((row) => row.name === name);
  if (!node?.full_label) return "";
  const lastSegment =
    node.path_segments?.at(-1) ?? node.label.split("/").at(-1);
  return node.full_label === lastSegment ? "" : node.full_label;
}

/** Tooltip text: the canonical path followed by the location's own name. */
export function warehouseTitle(
  name: unknown,
  nodes: LocationNode[],
  explicit?: unknown,
): string {
  const label = warehouseLabel(name, nodes, explicit);
  const own = warehouseName(name, nodes);
  return own ? `${label} · ${own}` : label;
}

export function warehouseSearchText(
  name: unknown,
  nodes: LocationNode[],
): string {
  return nodes.find((row) => row.name === name)?.search_text || "";
}

type LocationPathNode = {
  name: string;
  label?: string;
  path?: string;
  path_segments?: string[];
  path_names?: string[];
  full_label?: string;
  local_label?: string;
  parent?: string;
  owner?: string;
  direct?: boolean;
  search_text?: string;
};

export function locationLevels(
  name: unknown,
  nodes: readonly LocationPathNode[],
): LocationLevel[] {
  const node = nodes.find((row) => row.name === name);
  if (!node) return [];
  const codes = node.path_segments?.length
    ? node.path_segments
    : (node.path || node.label || "")
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean);
  if (!codes.length) return [];
  const names = node.path_names ? [...node.path_names] : [];
  if (!node.path_names) {
    // Older responses still identify the visible ancestors. Match the whole prefix
    // so a skipped root or a similarly coded room cannot supply the wrong name.
    let current = node.direct
      ? nodes.find((row) => row.name === node.owner) || node
      : node;
    names[codes.length - 1] = ownLocationName(current);
    for (let index = codes.length - 2; index >= 0; index--) {
      const parent = nodes.find((row) => row.name === current.parent);
      if (!parent) break;
      const prefix = codes.slice(0, index + 1);
      const matches = parent.path_segments
        ? parent.path_segments.length === prefix.length &&
          parent.path_segments.every((code, part) => code === prefix[part])
        : (parent.path || parent.label) === prefix.join("/");
      if (!matches) break;
      names[index] = ownLocationName(parent);
      current = parent;
    }
  }
  return codes.map((code, index) => ({
    code,
    name: names[index] && names[index] !== code ? names[index] : "",
  }));
}

function ownLocationName(node: LocationPathNode): string {
  return node.local_label || node.full_label?.split("/").at(-1)?.trim() || "";
}

export function locationTip(
  name: unknown,
  nodes: readonly LocationPathNode[],
  explicit?: string,
): LocationTooltip | string | undefined {
  const levels = locationLevels(name, nodes);
  return levels.length
    ? { location: { path: levels.map(({ code }) => code).join("/"), levels } }
    : explicit;
}

type WarehouseOptionExtra = {
  label?: string;
  title?: string;
  detail?: string;
  keywords?: string;
  disabled?: boolean;
};

export function warehouseOption(
  name: string,
  nodes: LocationNode[],
  extra?: WarehouseOptionExtra,
) {
  const label = warehouseLabel(name, nodes, extra?.label);
  const tip = locationTip(name, nodes, extra?.title || label);
  const levels = typeof tip === "object" ? tip.location.levels : [];
  const names = levels.map((level) => level.name).filter(Boolean);
  return {
    ...extra,
    value: name,
    label,
    detail: extra?.detail ?? levels.at(-1)?.name ?? warehouseName(name, nodes),
    keywords: [warehouseSearchText(name, nodes), ...names, extra?.keywords]
      .filter(Boolean)
      .join(" "),
    tip,
  };
}
