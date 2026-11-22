import { describe, expect, it } from "vitest";
import type { LocationNode } from "../src/services/contracts";
import {
  warehouseLabel,
  warehouseName,
  warehouseTitle,
  warehouseSearchText,
} from "../src/lib/warehouseLabel";
const room: LocationNode = {
  name: "ROOM-A",
  label: "T2 / A02",
  local_label: "演示室甲",
  short_label: "T2 / A02",
  full_label: "演示室甲",
  path: "T2 / A02",
  search_text: "T2 A02 演示室甲",
  kind: "room",
  owner: "",
  direct: false,
  storable: true,
  missing_direct: false,
  parent: "T2",
  is_group: true,
  disabled: false,
  lft: 2,
  rgt: 5,
  version: "v1",
  protected: false,
  can_edit: true,
};
const direct: LocationNode = {
  ...room,
  name: "ROOM-A-DIRECT",
  parent: room.name,
  owner: room.name,
  direct: true,
  is_group: false,
  can_edit: false,
};
describe("warehouse presenter readers", () => {
  it("uses the full canonical path for labels", () => {
    expect(warehouseLabel(room.name, [room, direct])).toBe("T2 / A02");
    expect(warehouseLabel(direct.name, [room, direct])).toBe("T2 / A02");
    expect(warehouseTitle(direct.name, [room, direct])).toBe(
      "T2 / A02 · 演示室甲",
    );
  });
  it("adds the location's own name only when the codes path does not show it", () => {
    expect(warehouseName(room.name, [room])).toBe("演示室甲");
    const unnamed = { ...room, full_label: "A02" };
    expect(warehouseName(unnamed.name, [unnamed])).toBe("");
    expect(warehouseTitle(unnamed.name, [unnamed])).toBe("T2 / A02");
    expect(warehouseName("UNKNOWN", [room])).toBe("");
  });
  it("uses explicit labels only when a presenter row is unavailable", () => {
    expect(warehouseLabel("UNKNOWN", [], "可见位置")).toBe("可见位置");
    expect(warehouseTitle("UNKNOWN", [], "可见路径")).toBe("可见路径");
    expect(warehouseLabel("UNKNOWN", [])).toBe("位置暂不可用");
  });
  it("keeps same-named locations distinct through the presenter label and path", () => {
    const first = {
      ...room,
      name: "ROOM-T1",
      label: "T1 / A14",
      path: "T1 / A14",
      search_text: "T1 A14 演示室甲",
    };
    const second = {
      ...room,
      name: "ROOM-T2",
      label: "T2 / A14",
      path: "T2 / A14",
      search_text: "T2 A14 演示室甲",
    };
    expect(warehouseLabel(first.name, [first, second])).toBe("T1 / A14");
    expect(warehouseLabel(second.name, [first, second])).toBe("T2 / A14");
    expect(warehouseSearchText(first.name, [first, second])).toContain("T1");
    expect(warehouseSearchText(second.name, [first, second])).toContain("T2");
  });
});
