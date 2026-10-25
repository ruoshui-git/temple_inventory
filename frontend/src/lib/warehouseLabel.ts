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

export function warehousePath(
  name: unknown,
  nodes: LocationNode[],
  explicit?: unknown,
): string {
  if (!name) return "外部";
  const node = nodes.find((row) => row.name === name);
  if (node) return node.path;
  return typeof explicit === "string" && explicit ? explicit : "位置暂不可用";
}

export function warehouseSearchText(
  name: unknown,
  nodes: LocationNode[],
): string {
  return nodes.find((row) => row.name === name)?.search_text || "";
}
