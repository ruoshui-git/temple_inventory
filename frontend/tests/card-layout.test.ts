import { describe, expect, it } from "vitest";
import {
  CARD_FIELD_LIMIT,
  ROW_FIELD_LIMIT,
  partitionCardColumns,
} from "../src/lib/cardLayout";
import {
  orderedVisibleColumns,
  type ColumnPreferencesController,
  type DataColumn,
} from "../src/lib/dataTable";
import { ref } from "vue";

const column = (id: string, extra: Partial<DataColumn> = {}): DataColumn => ({
  id,
  label: id,
  ...extra,
});

describe("partitionCardColumns", () => {
  it("places visible role columns in their slots", () => {
    const visible = [
      column("photo"),
      column("name"),
      column("category"),
      column("code"),
      column("qty"),
      column("status"),
      column("location"),
    ];
    const result = partitionCardColumns(visible, {
      media: "photo",
      title: "name",
      eyebrow: ["category", "code"],
      hero: "qty",
      status: "status",
    });
    expect(result.media?.id).toBe("photo");
    expect(result.title?.id).toBe("name");
    expect(result.eyebrow.map((item) => item.id)).toEqual(["category", "code"]);
    expect(result.hero?.id).toBe("qty");
    expect(result.status?.id).toBe("status");
    expect(result.fields.map((item) => item.id)).toEqual(["location"]);
    expect(result.overflow).toBe(0);
  });

  it("leaves hidden role columns undefined or empty", () => {
    const result = partitionCardColumns([column("location")], {
      media: "photo",
      title: "name",
      eyebrow: ["category", "code"],
      hero: "qty",
      status: "status",
    });
    expect(result.media).toBeUndefined();
    expect(result.title).toBeUndefined();
    expect(result.eyebrow).toEqual([]);
    expect(result.hero).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.fields.map((item) => item.id)).toEqual(["location"]);
  });

  it("keeps eyebrow in role order and skips hidden eyebrow columns", () => {
    const result = partitionCardColumns([column("code"), column("category")], {
      title: "name",
      eyebrow: ["category", "warehouse", "code"],
    });
    expect(result.eyebrow.map((item) => item.id)).toEqual(["category", "code"]);
    expect(result.fields).toEqual([]);
  });

  it("removes omitted columns and keeps the remaining visible order", () => {
    const visible = [
      column("a"),
      column("secret"),
      column("b"),
      column("title"),
      column("c"),
    ];
    const result = partitionCardColumns(visible, {
      title: "title",
      omit: ["secret"],
    });
    expect(result.fields.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("counts fields cut by the limit as overflow", () => {
    const visible = Array.from({ length: 11 }, (_, index) =>
      column(`f${index}`),
    );
    const result = partitionCardColumns(visible, { title: "title" });
    expect(CARD_FIELD_LIMIT).toBe(8);
    expect(result.fields).toHaveLength(8);
    expect(result.fields.at(-1)?.id).toBe("f7");
    expect(result.overflow).toBe(3);
  });

  it("honours a custom limit such as the row cap", () => {
    const visible = Array.from({ length: 9 }, (_, index) =>
      column(`f${index}`),
    );
    const result = partitionCardColumns(
      visible,
      { title: "title" },
      ROW_FIELD_LIMIT,
    );
    expect(ROW_FIELD_LIMIT).toBe(6);
    expect(result.fields).toHaveLength(6);
    expect(result.overflow).toBe(3);
  });
});

describe("orderedVisibleColumns", () => {
  const columns = [
    column("item", { required: true }),
    column("qty"),
    column("retired", { defaultVisible: false }),
    column("warehouse"),
  ];

  it("falls back to declaration order and default visibility without a controller", () => {
    expect(orderedVisibleColumns(columns).map((item) => item.id)).toEqual([
      "item",
      "qty",
      "warehouse",
    ]);
  });

  it("follows the controller's order and effective visibility", () => {
    const controller = {
      order: ref(["warehouse", "item", "qty", "retired"]),
      visible: ref(["item", "warehouse", "retired"]),
      effectiveVisible: ref(["item", "warehouse", "qty"]),
    } as unknown as ColumnPreferencesController;
    expect(
      orderedVisibleColumns(columns, controller).map((item) => item.id),
    ).toEqual(["warehouse", "item", "qty"]);
  });

  it("uses visible when effectiveVisible is absent", () => {
    const controller = {
      order: ref(["qty", "item"]),
      visible: ref(["item", "qty"]),
    } as unknown as ColumnPreferencesController;
    expect(
      orderedVisibleColumns(columns, controller).map((item) => item.id),
    ).toEqual(["qty", "item"]);
  });
});
