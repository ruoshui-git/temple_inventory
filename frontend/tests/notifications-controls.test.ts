// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { ref } from "vue";
import { useNotifications } from "../src/features/notifications/useNotifications";
import {
  useNotificationSettings,
  type NotificationPreferences,
} from "../src/features/settings/useNotificationSettings";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import MoreView from "../src/features/more/MoreView.vue";

const wrappers: VueWrapper[] = [];
const prefs = (): NotificationPreferences => ({
  enabled: true,
  movement_submitted: true,
  movement_cancelled: true,
  count_adjustment: true,
  export_result: true,
  expiry_digest: false,
  movement_kinds: { Receive: true, Issue: true },
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});
function harness(
  controller: "inbox" | "settings",
  call: ReturnType<typeof vi.fn>,
) {
  const reference = createReferenceData();
  Object.assign(reference, { user: "alice", site: "site" });
  const Child = defineComponent({
    setup() {
      const c =
        controller === "inbox" ? useNotifications() : useNotificationSettings();
      const settings = "preferences" in c;
      return () =>
        h("div", [
          h(
            "button",
            {
              id: "mark",
              onClick: () => ("markRead" in c ? c.markRead("N-1") : undefined),
            },
            "mark",
          ),
          h(
            "button",
            { id: "save", onClick: () => ("save" in c ? c.save() : undefined) },
            "save",
          ),
          settings
            ? h("input", {
                id: "movement-event",
                type: "checkbox",
                checked: c.preferences.value?.movement_submitted,
                onChange: () => {
                  if (c.preferences.value)
                    c.preferences.value.movement_submitted = false;
                },
              })
            : null,
          h("input", {
            id: "movement-kind",
            type: "checkbox",
            disabled: settings
              ? !c.preferences.value?.movement_submitted
              : true,
          }),
        ]);
    },
  });
  const Root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(Child);
    },
  });
  const wrapper = mount(Root);
  wrappers.push(wrapper);
  return wrapper;
}

describe("notification controller flows", () => {
  it("refreshes unread count on focus and visibility and after marking a row read", async () => {
    let unread = 1;
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint === "notifications.inbox")
        return {
          items: [
            {
              name: "N-1",
              type: "库存流动",
              subject: "新入库",
              link: "/inventory",
              read: 0,
              creation: "2026-10-24 09:00:00",
              email_content: "{}",
            },
          ],
          unread_count: unread,
          has_running_exports: false,
        };
      if (endpoint === "notifications.unread_count") return unread;
      if (endpoint === "notifications.mark_read") {
        unread = 0;
        return { updated: true };
      }
      return {};
    });
    const wrapper = harness("inbox", call);
    await flushPromises();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    await wrapper.get("#mark").trigger("click");
    await flushPromises();
    expect(
      call.mock.calls.filter(([name]) => name === "notifications.unread_count")
        .length,
    ).toBeGreaterThanOrEqual(3);
    expect(call).toHaveBeenCalledWith("notifications.mark_read", {
      names: '["N-1"]',
    });
  });

  it("persists preference edits and disables movement-kind selection with its event", async () => {
    const current = prefs();
    const call = vi.fn(
      async (endpoint: string, args: Record<string, unknown> = {}) => {
        if (endpoint === "notifications.get_preferences")
          return structuredClone(current);
        if (endpoint === "push.my_devices") return [];
        if (endpoint === "notifications.save_preferences")
          return JSON.parse(String(args.preferences));
        return {};
      },
    );
    const wrapper = harness("settings", call);
    await flushPromises();
    expect(
      wrapper.get("#movement-kind").attributes("disabled"),
    ).toBeUndefined();
    await wrapper.get("#movement-event").setValue(false);
    expect(wrapper.get("#movement-kind").attributes("disabled")).toBeDefined();
    await wrapper.get("#save").trigger("click");
    await flushPromises();
    expect(call).toHaveBeenCalledWith("notifications.save_preferences", {
      preferences: JSON.stringify({ ...prefs(), movement_submitted: false }),
    });
  });
});

it("keeps the install card on the same native more-card markup as sibling cards", () => {
  const controller = {
    reference: { user: "alice" },
    groups: [],
    installOpen: ref(false),
    installBusy: ref(false),
    logoutOpen: ref(false),
    busy: ref(false),
    error: ref(""),
    summaryError: ref(""),
    loading: ref(false),
    draftCount: ref(0),
    guidance: ref("安装说明"),
    canInstall: ref(true),
    install: vi.fn(),
    close: vi.fn(),
    logout: vi.fn(),
    load: vi.fn(),
  } as any;
  const wrapper = mount(MoreView, { props: { controller } });
  wrappers.push(wrapper);
  const card = wrapper.get("button.more-card");
  expect(card.text()).toContain("安装到手机 / 电脑");
  expect(card.classes()).toContain("surface");
  expect(card.classes()).toContain("more-card");
  expect(card.classes()).not.toContain("ui-button");
});
