import type { HierarchyFilterNode } from "../components/ui/HierarchyFilter.vue";
/** Resolve authorized labels without guessing from company suffixes or changing native keys. */
export function warehouseLabel(
  name: unknown,
  nodes: HierarchyFilterNode[],
  explicit?: unknown,
): string {
  if (!name) return "外部";
  const node = nodes.find((row) => row.name === name);
  if (!node?.label)
    return typeof explicit === "string" && explicit ? explicit : "位置暂不可用";
  const duplicates = nodes.filter((row) => row.label === node.label);
  if (duplicates.length < 2) return node.label;
  const path = [node.label];
  const seen = new Set([node.name]);
  let parent = nodes.find(
    (row) => row.name === (node.parent || node.parent_warehouse),
  );
  while (parent && !seen.has(parent.name)) {
    seen.add(parent.name);
    path.unshift(parent.label || "上级位置暂不可用");
    parent = nodes.find(
      (row) => row.name === (parent!.parent || parent!.parent_warehouse),
    );
  }
  return path.join(" / ");
}
