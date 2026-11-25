import { describe, expect, it } from "vitest";
import { matchesWords, normalizeSearch } from "../src/lib/searchMatch";

const rooms = [
  "T2/FUN/A01 第2寺院 功能区域 阅览室",
  "T1/FUN/104 第1寺院 功能区域 办公室",
  "T2/FUN/B01 第2寺院 功能区域 办公室",
];
describe("location search", () => {
  it.each([
    ["阅览室", [0]],
    ["a01", [0]],
    ["T2 阅览室", [0]],
    ["办公室 T1", [1]],
    ["第2寺院 阅览室", [0]],
    ["Ａ01", [0]],
    ["T2/FUN/A01", [0]],
    ["Ｔ２ ／ ＦＵＮ / A01", [0]],
    ["阅览室 第2寺院", [0]],
    ["A01 办公室", []],
    ["T1 阅览室", []],
  ])("matches %s against one location at a time", (query, expected) => {
    expect(
      rooms.flatMap((room, index) =>
        matchesWords(query, room) ? [index] : [],
      ),
    ).toEqual(expected);
  });
  it("folds width and case, trims spaces, and compacts slash separators", () => {
    expect(normalizeSearch("　Ｔ２　／ FUN / a01　")).toBe("t2/fun/a01");
    expect(matchesWords(" ", "")).toBe(true);
  });
});
