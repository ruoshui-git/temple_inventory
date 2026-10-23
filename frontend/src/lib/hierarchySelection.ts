export type HierarchySelectionNode = {
  name: string;
  parent?: string;
  parent_item_group?: string;
  is_group?: number | boolean;
  lft?: number;
  rgt?: number;
};

const parentName = (node: HierarchySelectionNode) =>
  node.parent || node.parent_item_group || "";

function isAncestor(
  ancestor: HierarchySelectionNode,
  node: HierarchySelectionNode,
  byName: Map<string, HierarchySelectionNode>,
) {
  let parentId = parentName(node);
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestor.name) return true;
    seen.add(parentId);
    parentId = parentName(byName.get(parentId) || { name: parentId });
  }
  return (
    ancestor.name !== node.name &&
    ancestor.lft !== undefined &&
    ancestor.rgt !== undefined &&
    node.lft !== undefined &&
    node.rgt !== undefined &&
    Number(ancestor.lft) < Number(node.lft) &&
    Number(ancestor.rgt) > Number(node.rgt)
  );
}

/** Keep the shallowest selected groups and remove selections they already cover. */
export function normalizeHierarchySelection(
  values: string[],
  nodes: HierarchySelectionNode[],
) {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const unique = [...new Set(values)];
  return unique.filter((name) => {
    const node = byName.get(name);
    if (!node) return true;
    return !nodes.some(
      (ancestor) =>
        ancestor.is_group &&
        unique.includes(ancestor.name) &&
        isAncestor(ancestor, node, byName),
    );
  });
}
