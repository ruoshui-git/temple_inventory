import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { useUpdateBlocker, updateBlocked } from "../src/lib/updateSafety";
const applyUpdateSpy = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/pwa", () => ({
  applyUpdate: applyUpdateSpy,
  registerPwa: vi.fn(),
}));
import { ApiError } from "../src/lib/api";
import { createReferenceData } from "../src/services/contracts";
import { useApplication } from "../src/features/application/useApplication";
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const sessionValue = (user = "alice") => ({
  user,
  csrf_token: "token",
  ui_preferences: {
    theme: "jade" as const,
    density: "balanced" as const,
    textScale: 100 as const,
  },
});
const bootstrap = (user = "alice") => ({
  user,
  site: "site",
  site_date: "2026-10-16",
  site_time: "2026-10-16 12:00:00",
  settings: { company: "TEMPLE" },
  physical_leaves: ["ROOM"],
  leased_leaves: [],
  damaged_leaves: [],
  categories: [],
  uoms: [],
  activity_types: [],
  warehouses: [
    {
      name: "ROOM",
      local_label: "房间",
      breadcrumb: "寺院 / 房间",
      is_group: false,
    },
  ],
  capabilities: {},
  operations: {},
});
function setup(
  session = vi.fn(async () => sessionValue()),
  call = vi.fn(async (endpoint) =>
    endpoint === "browse.bootstrap"
      ? bootstrap()
      : { setup_required: false, warnings: [], blockers: [] },
  ),
) {
  const reference = createReferenceData();
  let c!: ReturnType<typeof useApplication>;
  const root = defineComponent({
    setup() {
      c = useApplication(
        reference,
        { call, report: vi.fn(), upload: vi.fn() },
        session,
      );
      return () =>
        c.state.gate === "ready"
          ? h("input", { "aria-label": "当前输入" })
          : h("p", c.state.gate);
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { c, reference, wrapper, session, call };
}
describe("native application boundary", () => {
  it("delays worker activation while an editor retains unsaved input and releases its guard on unmount", async () => {
    const pending = ref(true),
      child = defineComponent({
        setup() {
          useUpdateBlocker(() => pending.value);
          return () => h("span");
        },
      });
    const guard = mount(child);
    wrappers.push(guard);
    const { c } = setup();
    await flushPromises();
    c.update();
    expect(applyUpdateSpy).not.toHaveBeenCalled();
    expect(updateBlocked.value).toBe(true);
    pending.value = false;
    c.update();
    expect(applyUpdateSpy).toHaveBeenCalledOnce();
    pending.value = true;
    guard.unmount();
    wrappers.splice(wrappers.indexOf(guard), 1);
    expect(updateBlocked.value).toBe(false);
  });
  it("distinguishes guest and forbidden account before inventory/config reads", async () => {
    const call = vi.fn(),
      forbidden = setup(
        vi.fn(async () => {
          throw new ApiError("没有权限", 403, "PermissionError");
        }),
        call,
      );
    await flushPromises();
    expect(forbidden.c.state.gate).toBe("forbidden");
    expect(call).not.toHaveBeenCalled();
    const guest = setup(
      vi.fn(async () => {
        throw new ApiError("请登录", 403, "AuthenticationError");
      }),
      call,
    );
    await flushPromises();
    expect(guest.c.state.gate).toBe("login");
    expect(call).not.toHaveBeenCalled();
  });
  it("keeps open input mounted when same-account resumption fails or succeeds", async () => {
    const { c, wrapper, session } = setup();
    await flushPromises();
    await wrapper.find("input").setValue("未保存输入");
    session.mockRejectedValueOnce(new ApiError("网络中断", 0, "NetworkError"));
    await c.resume();
    expect(c.state.gate).toBe("ready");
    expect(wrapper.find("input").element.value).toBe("未保存输入");
    expect(c.state.error).toBe("网络中断");
    const retainedInput = wrapper.find("input").element;
    session.mockRejectedValueOnce(
      new ApiError("当前无权访问", 403, "PermissionError"),
    );
    await c.resume();
    expect(c.state.gate).toBe("ready");
    expect(c.state.accessBlocked).toBe(true);
    expect(wrapper.find("input").element).toBe(retainedInput);
    session.mockRejectedValueOnce(
      new ApiError("网络仍中断", 0, "NetworkError"),
    );
    await c.resume();
    expect(c.state.accessBlocked).toBe(true);
    await c.resume();
    expect(c.state.gate).toBe("ready");
    expect(wrapper.find("input").element.value).toBe("未保存输入");
    expect(c.state.version).toBe(0);
    expect(c.state.accessBlocked).toBe(false);
  });
  it("clears previous account references before a new-account bootstrap can fail", async () => {
    const { c, reference, session, call, wrapper } = setup();
    await flushPromises();
    expect(reference.warehouses).toHaveLength(1);
    session.mockResolvedValueOnce(sessionValue("bob"));
    call.mockRejectedValueOnce(new ApiError("网络中断", 0, "NetworkError"));
    await c.resume();
    expect(c.state.gate).toBe("error");
    expect(reference.user).toBe("bob");
    expect(reference.warehouses).toEqual([]);
    expect(wrapper.find("input").exists()).toBe(false);
  });
  it("initializes required structure without installing example stock", async () => {
    let configured = false;
    const call = vi.fn(async (endpoint) => {
      if (endpoint === "browse.bootstrap") return bootstrap();
      if (endpoint === "configuration.initialize") {
        configured = true;
        return {};
      }
      return {
        setup_required: !configured,
        version: "settings-v1",
        is_manager: true,
        can_initialize: true,
        selected_company: "TEMPLE",
        companies: ["TEMPLE"],
        warnings: [],
        blockers: [],
      };
    });
    const { c } = setup(undefined, call);
    await flushPromises();
    expect(c.state.gate).toBe("setup");
    await c.initialize();
    expect(c.state.gate).toBe("ready");
    expect(call).toHaveBeenCalledWith("configuration.initialize", {
      company: "TEMPLE",
      version: "settings-v1",
    });
  });
});
