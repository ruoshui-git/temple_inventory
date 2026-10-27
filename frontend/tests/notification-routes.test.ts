// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { routeRegistry } from "../src/lib/routeRegistry";
import NotificationRows from "../src/features/notifications/NotificationRows.vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

function matchesRoute(path: string) {
  return routeRegistry.find((route) => {
    const pattern = route.path.replace(/:[^/]+/g, "[^/]+");
    return new RegExp(`^${pattern}/?$`).test(path);
  });
}

describe("notification links", () => {
  it("marks an unknown legacy route read without navigating", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/:pathMatch(.*)*", component: { template: "<div />" } },
      ],
    });
    const markRead = vi.fn(async () => {});
    const wrapper = mount(NotificationRows, {
      props: {
        rows: [
          {
            name: "N",
            type: "提醒",
            subject: "过期提醒",
            link: "/inventory/expiry",
            read: 0,
            creation: "2026-10-27 10:00:00",
            email_content: "{}",
          },
        ],
        markRead,
      },
      global: { plugins: [router] },
    });
    const push = vi.spyOn(router, "push");
    await wrapper.get(".notification-subject").trigger("click");
    expect(markRead).toHaveBeenCalledWith("N");
    expect(push).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("resolves every SPA notification path to a named route", () => {
    const patterns = [
      "/movements/STE-test",
      "/counts/REC-test",
      "/reports",
      "/stock/expiry",
    ];
    for (const path of patterns) {
      expect(matchesRoute(path)?.name, path).toBeTruthy();
    }
  });
});
