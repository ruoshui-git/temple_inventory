/** Isolated native location topology for the shared gallery. */
import { reviewSession, type ReviewWarehouse } from "./reviewModel";
import type { NativeWarehouse } from "../../src/features/warehouses/useNativeWarehouses";
export const templeRoot = "GALLERY-TEMPLE",
  physicalRoot = "GALLERY-PHYSICAL";
const versions = new Map<string, number>();
let sequence = 0;
function topology() {
  const rows = reviewSession.warehouses;
  if (!rows.some((row) => row.name === templeRoot))
    rows.unshift({
      name: templeRoot,
      label: "寺院仓库",
      is_group: true,
      warehouse_type: "Group",
      status: "active",
    });
  if (!rows.some((row) => row.name === physicalRoot))
    rows.push({
      name: physicalRoot,
      label: "实体库房",
      parent: templeRoot,
      is_group: true,
      warehouse_type: "Group",
      status: "active",
    });
  for (const row of rows)
    if (!row.parent && row.name !== templeRoot)
      row.parent =
        row.name === "借出" || row.name.startsWith("损坏待处理")
          ? templeRoot
          : physicalRoot;
  const result: NativeWarehouse[] = [];
  let position = 0;
  function visit(row: ReviewWarehouse, ancestors: ReviewWarehouse[]) {
    if (ancestors.some((item) => item.name === row.name))
      throw new Error("图库位置存在循环关系");
    const lft = ++position,
      kind =
        row.warehouse_type === "Room"
          ? "room"
          : row.warehouse_type === "Shelf"
            ? "shelf"
            : row.is_group
              ? "area"
              : "shelf";
    const pathParts = ancestors
      .filter((item) => item.name !== templeRoot && item.name !== physicalRoot)
      .map((item) => item.label);
    if (row.name !== templeRoot && row.name !== physicalRoot)
      pathParts.push(row.label);
    const path = pathParts.join(" / "),
      node: NativeWarehouse = {
        name: row.name,
        label: row.label,
        local_label: row.label,
        short_label: "",
        full_label: row.label,
        path,
        search_text: `${path} ${row.label}`,
        kind,
        owner: "",
        direct: false,
        storable: !row.is_group,
        missing_direct: ["room", "shelf"].includes(kind) && row.is_group,
        parent: row.parent || "",
        is_group: row.is_group,
        disabled: row.status !== "active",
        version: String(versions.get(row.name) || 1),
        lft,
        rgt: 0,
        protected:
          [templeRoot, physicalRoot, "借出"].includes(row.name) ||
          row.name.startsWith("损坏待处理"),
        can_edit:
          ![templeRoot, physicalRoot, "借出"].includes(row.name) &&
          !row.name.startsWith("损坏待处理"),
      };
    result.push(node);
    if (["room", "shelf"].includes(kind) && row.is_group) {
      const directName = `${row.name}-DIRECT`;
      result.push({
        ...node,
        name: directName,
        parent: row.name,
        owner: row.name,
        direct: true,
        is_group: false,
        storable: true,
        can_edit: false,
        lft: ++position,
        rgt: ++position,
      });
      node.missing_direct = false;
    }
    reviewSession.warehouses
      .filter((child) => child.parent === row.name)
      .forEach((child) => visit(child, [...ancestors, row]));
    node.rgt = ++position;
  }
  visit(
    rows.find((row) => row.name === templeRoot)!,
    [],
  );
  return result;
}
function makeChild(parent: string, label: string, kind: string) {
  const room = kind === "room",
    area = kind === "area",
    name = `GALLERY-WH-${++sequence}`;
  const value: ReviewWarehouse = {
    name,
    label,
    parent,
    warehouse_type: room ? "Room" : area ? "Group" : "Location",
    is_group: room || area,
    status: "active",
  };
  reviewSession.warehouses.push(value);
  versions.set(name, 1);
  return value;
}
export function fixtureWarehouseCall(
  endpoint: string,
  args: Record<string, unknown>,
) {
  const rows = topology();
  if (endpoint === "warehouses.tree")
    return {
      rows,
      physical_root: physicalRoot,
      can_create: true,
      company: "图库示例",
    };
  if (endpoint === "configuration.status")
    return { needs_first_room: !rows.some((row) => row.kind === "room") };
  const previous = rows.find((row) => row.name === args.name),
    version = previous?.version;
  if (
    previous &&
    (!previous.can_edit || (args.version && version !== args.version))
  )
    throw new Error("位置已更改或无权编辑");
  if (endpoint === "warehouses.create_location") {
    makeChild(String(args.parent), String(args.label), String(args.kind));
    return fixtureWarehouseCall("warehouses.tree", {});
  }
  if (endpoint === "warehouses.rename_location" && previous) {
    const stored = reviewSession.warehouses.find(
      (row) => row.name === previous.name,
    );
    if (stored) stored.label = String(args.label);
    versions.set(previous.name, Number(version || 0) + 1);
    return fixtureWarehouseCall("warehouses.tree", {});
  }
  if (endpoint === "warehouses.move_location" && previous) {
    const stored = reviewSession.warehouses.find(
      (row) => row.name === previous.name,
    );
    if (stored) stored.parent = String(args.parent);
    versions.set(previous.name, Number(version || 0) + 1);
    return fixtureWarehouseCall("warehouses.tree", {});
  }
  if (endpoint === "warehouses.set_disabled" && previous) {
    const stored = reviewSession.warehouses.find(
      (row) => row.name === previous.name,
    );
    if (stored) stored.status = args.disabled ? "inactive" : "active";
    versions.set(previous.name, Number(version || 0) + 1);
    return fixtureWarehouseCall("warehouses.tree", {});
  }
  if (endpoint === "warehouses.subdivide_shelf" && previous) {
    const stored = reviewSession.warehouses.find(
      (row) => row.name === previous.name,
    );
    if (stored) {
      stored.is_group = true;
      stored.warehouse_type = "Shelf" as ReviewWarehouse["warehouse_type"];
    }
    versions.set(previous.name, Number(version || 0) + 1);
    return fixtureWarehouseCall("warehouses.tree", {});
  }
  if (endpoint === "warehouses.repair_direct_storage")
    return fixtureWarehouseCall("warehouses.tree", {});
  throw new Error("未实现的图库位置操作");
}
