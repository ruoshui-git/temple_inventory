import { describe, expect, it } from "vitest";
import type { LocationNode } from "../src/services/contracts";
import { warehouseLabel, warehousePath } from "../src/lib/warehouseLabel";
const room: LocationNode = {
  name: "ROOM-A",
  label: "A02",
  local_label: "演示室甲",
  short_label: "A02",
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
  it("uses the short display label and preserves the full path separately", () => {
    expect(warehouseLabel(room.name, [room, direct])).toBe("A02");
    expect(warehouseLabel(direct.name, [room, direct])).toBe("A02");
    expect(warehousePath(direct.name, [room, direct])).toBe("T2 / A02");
  });
  it("uses explicit labels only when a presenter row is unavailable", () => {
    expect(warehouseLabel("UNKNOWN", [], "可见位置")).toBe("可见位置");
    expect(warehousePath("UNKNOWN", [], "可见路径")).toBe("可见路径");
    expect(warehouseLabel("UNKNOWN", [])).toBe("位置暂不可用");
  });
  it("keeps same-named locations distinct through the presenter label and path", () => {
    const first = {
      ...room,
      name: "ROOM-T1",
      label: "T1 / A14",
      path: "T1 / A14",
    };
    const second = {
      ...room,
      name: "ROOM-T2",
      label: "T2 / A14",
      path: "T2 / A14",
    };
    expect(warehouseLabel(first.name, [first, second])).toBe("T1 / A14");
    expect(warehouseLabel(second.name, [first, second])).toBe("T2 / A14");
    expect(warehousePath(first.name, [first, second])).toBe("T1 / A14");
    expect(warehousePath(second.name, [first, second])).toBe("T2 / A14");
  });
});
