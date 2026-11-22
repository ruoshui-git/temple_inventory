import type { LocationNode } from "../services/contracts";

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
  const segments = node.label.split(" / ");
  return node.full_label === segments[segments.length - 1]
    ? ""
    : node.full_label;
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
