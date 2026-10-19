import type { HierarchyFilterNode } from "../components/ui/HierarchyFilter.vue";

function parentOf(node: HierarchyFilterNode, nodes: HierarchyFilterNode[]) {
  return nodes.find(
    (row) => row.name === (node.parent || node.parent_warehouse),
  );
}

function ancestorLabels(
  node: HierarchyFilterNode,
  nodes: HierarchyFilterNode[],
) {
  const labels = [node.label || "上级位置暂不可用"];
  const seen = new Set([node.name]);
  let parent = parentOf(node, nodes);
  while (parent && !seen.has(parent.name)) {
    seen.add(parent.name);
    labels.unshift(parent.label || "上级位置暂不可用");
    parent = parentOf(parent, nodes);
  }
  return labels;
}

function shortRoomLabel(
  room: HierarchyFilterNode,
  nodes: HierarchyFilterNode[],
): string {
  const rooms = nodes.filter(
    (candidate) =>
      candidate.name !== room.name &&
      candidate.is_group &&
      candidate.type === "Room" &&
      candidate.label === room.label,
  );
  if (!rooms.length) return room.label || "位置暂不可用";

  const currentPath = ancestorLabels(room, nodes);
  const competingPaths = rooms.map((candidate) =>
    ancestorLabels(candidate, nodes),
  );
  for (let count = 1; count < currentPath.length; count += 1) {
    const suffix = currentPath.slice(-count);
    if (
      competingPaths.every((path) => {
        const candidateSuffix = path.slice(-count);
        return (
          candidateSuffix.length !== count ||
          candidateSuffix.some((part, index) => part !== suffix[index])
        );
      })
    )
      return suffix.join(" / ");
  }
  return currentPath.join(" / ");
}

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
  const label = String(node.label);
  if (node.room_default) {
    const room = parentOf(node, nodes);
    return room?.label ? shortRoomLabel(room, nodes) : label;
  }
  const duplicates = nodes.filter((row) => row.label === node.label);
  if (duplicates.length < 2) return label;
  return ancestorLabels(node, nodes).join(" / ");
}
