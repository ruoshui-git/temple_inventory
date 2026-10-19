/** Isolated native Warehouse topology and metadata for the shared gallery. */
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
      warehouse_type: "Location",
      status: "active",
    });
  if (!rows.some((row) => row.name === physicalRoot))
    rows.push({
      name: physicalRoot,
      label: "实体库房",
      parent: templeRoot,
      is_group: true,
      warehouse_type: "Location",
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
  function visit(row: ReviewWarehouse, ancestors: string[]) {
    if (ancestors.includes(row.name)) throw new Error("图库仓库存在循环关系");
    const lft = ++position;
    const value: NativeWarehouse = {
      name: row.name,
      label: row.label,
      parent: row.parent || "",
      type: row.warehouse_type,
      room_default: false,
      is_group: row.is_group,
      disabled: row.status !== "active",
      version: String(versions.get(row.name) || 1),
      lft,
      rgt: 0,
      protected:
        [templeRoot, physicalRoot].includes(row.name) ||
        row.name === "借出" ||
        row.name.startsWith("损坏待处理"),
      can_edit:
        ![templeRoot, physicalRoot].includes(row.name) &&
        !row.name === "借出" &&
        !row.name.startsWith("损坏待处理"),
    };
    result.push(value);
    rows
      .filter((child) => child.parent === row.name)
      .forEach((child) => visit(child, [...ancestors, row.name]));
    value.rgt = ++position;
  }
  visit(
    rows.find((row) => row.name === templeRoot)!,
    [],
  );
  return result;
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
  if (endpoint !== "warehouses.save_warehouse")
    throw new Error("未实现的图库仓库操作");
  const parent = rows.find((row) => row.name === args.parent),
    previous = rows.find((row) => row.name === args.name);
  if (
    !String(args.label || "").trim() ||
    !parent?.is_group ||
    !["Room", "Location"].includes(String(args.warehouse_type))
  )
    throw new Error("请填写名称、有效上级与类型");
  if (previous && (!previous.can_edit || previous.version !== args.version))
    throw new Error("仓库已更改或无权编辑，请保留输入后核对");
  const descendants = previous
    ? rows
        .filter((row) => row.lft >= previous.lft && row.rgt <= previous.rgt)
        .map((row) => row.name)
    : [];
  if (descendants.includes(parent.name))
    throw new Error("不能将仓库移动到自身或其下级");
  if (
    previous &&
    (previous.parent !== parent.name || previous.is_group !== args.is_group)
  ) {
    const hasStock = reviewSession.stock.some((item) =>
      item.locations.some(
        (place) =>
          descendants.includes(place.location) &&
          place.available + place.loaned + place.damaged !== 0,
      ),
    );
    const hasDocuments = reviewSession.drafts.some((draft) =>
      draft.lines.some(
        (line) =>
          descendants.includes(line.location) ||
          descendants.includes(line.sourceLocation || ""),
      ),
    );
    if (hasStock || hasDocuments)
      throw new Error("此仓库已有库存或原生单据，请保留现有层级");
    if (!args.is_group && descendants.length > 1)
      throw new Error("仍有下级，不能改为叶子库位");
  }
  if (
    reviewSession.warehouses.some(
      (row) =>
        row.name !== args.name &&
        row.parent === parent.name &&
        row.label === args.label,
    )
  )
    throw new Error("同一上级内已存在此名称");
  const name = previous?.name || `GALLERY-WH-${++sequence}`;
  const value: ReviewWarehouse = {
    name,
    label: String(args.label),
    parent: parent.name,
    warehouse_type: args.warehouse_type as "Room" | "Location",
    is_group: Boolean(args.is_group),
    status: args.disabled ? "inactive" : "active",
  };
  const stored = reviewSession.warehouses.find((row) => row.name === name);
  if (stored) Object.assign(stored, value);
  else reviewSession.warehouses.push(value);
  versions.set(name, Number(previous?.version || 0) + 1);
  return topology().find((row) => row.name === name)!;
}
