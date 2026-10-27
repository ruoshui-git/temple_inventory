import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { siteWallTimestamp } from "../src/lib/nativeTime";
import {
  createReferenceData,
  provideReferenceData,
} from "../src/services/contracts";
import {
  notificationGroups,
  relativeTime,
  type InventoryNotification,
} from "../src/features/notifications/model";

describe("site timezone helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("converts site wall-time with the bootstrap timezone", () => {
    expect(siteWallTimestamp("2026-10-27 09:00:00", "America/New_York")).toBe(
      Date.parse("2026-10-27T13:00:00Z"),
    );
  });

  it("uses the site timezone and the real clock for grouping and relative labels", async () => {
    // 13:00 UTC is 09:00 in New York; a browser in another zone must not shift it.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-27T13:00:00Z"));
    const reference = createReferenceData();
    reference.timezone = "America/New_York";
    const rows: InventoryNotification[] = [
      {
        name: "NL-today",
        type: "库存流动",
        subject: "样例",
        link: "/inventory/stock",
        read: 0,
        creation: "2026-10-27 08:00:00",
        email_content: "{}",
      },
    ];
    let result: unknown;
    const Consumer = defineComponent({
      setup() {
        result = {
          groups: notificationGroups(rows).map((group) => group.label),
          relative: relativeTime(rows[0]!.creation),
        };
        return () => h("div");
      },
    });
    const Host = defineComponent({
      setup() {
        provideReferenceData(reference);
        return () => h(Consumer);
      },
    });
    await renderToString(createSSRApp(Host));
    expect(result).toEqual({ groups: ["今天"], relative: "1 小时前" });
  });
});
