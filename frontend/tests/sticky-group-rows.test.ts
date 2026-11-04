import { describe, expect, it } from "vitest";
import {
  nextGroupIndex,
  stickyGroupPath,
  stickyRowsAllowed,
  stickyStack,
  type StickyGroupMeta,
} from "../src/composables/useStickyGroupRows";

const category = (depth = 1): StickyGroupMeta => ({ kind: "group", depth });
const item = (): StickyGroupMeta => ({ kind: "group", depth: 2 });
const record = (): StickyGroupMeta => ({ kind: "record" });

// 类别 0 (expanded, two 物品), 类别 1 (collapsed), 类别 2 (expanded, one 物品).
const nested: StickyGroupMeta[] = [
  category(), // 0 类别0
  item(), // 1 物品0.0
  record(), // 2
  record(), // 3
  item(), // 4 物品0.1
  record(), // 5
  category(), // 6 类别1, collapsed
  category(), // 7 类别2
  item(), // 8 物品2.0
  record(), // 9
  record(), // 10
];

describe("stickyGroupPath", () => {
  it("returns the category then the item above a row in a nested table", () => {
    expect(stickyGroupPath(nested, 2)).toEqual([0, 1]);
    expect(stickyGroupPath(nested, 5)).toEqual([0, 4]);
    expect(stickyGroupPath(nested, 10)).toEqual([7, 8]);
  });

  it("drops a previous expanded category's item once a collapsed category is above", () => {
    // Scrolled past 类别0's items into the collapsed 类别1: 类别1 alone, no stale 物品 row.
    expect(stickyGroupPath(nested, 7)).toEqual([6]);
  });

  it("never includes a group anchor that has not reached the line", () => {
    // Anchor is 类别1 (depth 1, not yet above the line): 类别0 and its current 物品0.1 stay
    // stuck while 类别1 slides up under them (see stickyStack).
    expect(stickyGroupPath(nested, 6)).toEqual([0, 4]);
    // Anchor is 物品2.0 (depth 2, not yet above the line): only its category 类别2 stays.
    expect(stickyGroupPath(nested, 8)).toEqual([7]);
    // Anchor is 物品0.1 (depth 2, not yet above the line): 类别0 and 物品0.0 stay.
    expect(stickyGroupPath(nested, 4)).toEqual([0, 1]);
  });

  it("returns the last group when the anchor is the end of the table", () => {
    expect(stickyGroupPath(nested, nested.length)).toEqual([7, 8]);
  });

  it("has no path above the first row or without groups", () => {
    expect(stickyGroupPath(nested, 0)).toEqual([]);
    expect(stickyGroupPath([record(), record()], 2)).toEqual([]);
    expect(stickyGroupPath([], 0)).toEqual([]);
  });

  it("handles a single level of groups", () => {
    const flat = [category(), record(), record(), category(), record()];
    expect(stickyGroupPath(flat, 2)).toEqual([0]);
    expect(stickyGroupPath(flat, 4)).toEqual([3]);
  });
});

describe("nextGroupIndex", () => {
  it("finds the next group of the same or a shallower depth", () => {
    expect(nextGroupIndex(nested, 1, 2)).toBe(4);
    expect(nextGroupIndex(nested, 1, 1)).toBe(6);
    expect(nextGroupIndex(nested, 10, 1)).toBe(-1);
  });
});

describe("stickyStack", () => {
  const rows: StickyGroupMeta[] = [
    category(),
    item(),
    record(),
    category(),
    record(),
  ];
  const heights = [40, 40];

  it("stacks the path rows below the sticky line without pushing", () => {
    const stack = stickyStack(rows, [0, 1], heights, 100, (index) =>
      index === 3 ? 600 : undefined,
    );
    expect(stack).toEqual({ tops: [100, 140], height: 80 });
  });

  it("pushes the nested and the category rows up when the next category reaches them", () => {
    // 类别1's top is 130, 10px under the stack's bottom (100 + 40 for 类别0 and 物品).
    const stack = stickyStack(rows, [0, 1], heights, 100, (index) =>
      index === 3 ? 130 : undefined,
    );
    expect(stack.tops).toEqual([90, 90]);
    expect(stack.height).toBe(80);
  });

  it("pushes only the deeper row when a nested group of the same depth arrives", () => {
    const nestedRows: StickyGroupMeta[] = [
      category(),
      item(),
      record(),
      item(),
      record(),
    ];
    const stack = stickyStack(nestedRows, [0, 1], heights, 100, (index) =>
      index === 3 ? 160 : undefined,
    );
    expect(stack.tops).toEqual([100, 120]);
  });

  it("leaves rows in place when the next group is still below the stack", () => {
    const stack = stickyStack(rows, [0, 1], heights, 100, (index) =>
      index === 3 ? 200 : undefined,
    );
    expect(stack.tops).toEqual([100, 140]);
  });
});

describe("stickyRowsAllowed", () => {
  it("allows sticky group rows only where the table box is a vertical clip", () => {
    expect(stickyRowsAllowed("clip")).toBe(true);
    expect(stickyRowsAllowed("hidden")).toBe(false);
    expect(stickyRowsAllowed("auto")).toBe(false);
    expect(stickyRowsAllowed("visible")).toBe(false);
  });
});
