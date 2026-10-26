// @vitest-environment jsdom
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
import {
  createReferenceData,
  hydrateReferenceData,
  type BootstrapData,
} from "../src/services/contracts";
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
      label: "房间",
      local_label: "房间",
      short_label: "",
      full_label: "房间",
      path: "寺院 / 房间",
      search_text: "寺院 / 房间 房间",
      kind: "room",
      owner: "",
      direct: false,
      storable: true,
      missing_direct: false,
      parent: "",
      is_group: false,
      disabled: false,
      lft: 1,
      rgt: 2,
      version: "",
      protected: false,
      can_edit: false,
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
  it("hydrates the canonical presenter labels for rooms and their direct leaves", () => {
    const reference = createReferenceData();
    const warehouse = (
      name: string,
      label: string,
      path: string,
      kind: "area" | "room" | "shelf" | "system",
      parent: string,
      is_group: boolean,
      direct = false,
      owner = "",
    ) => ({
      name,
      label,
      local_label: label,
      short_label: "",
      full_label: label,
      path,
      search_text: `${path} ${label}`,
      kind,
      owner,
      direct,
      storable: !is_group || direct,
      missing_direct: false,
      parent,
      is_group,
      disabled: false,
      lft: 0,
      rgt: 0,
      version: "",
      protected: false,
      can_edit: true,
    });
    const result: BootstrapData = {
      ...bootstrap(),
      warehouses: [
        warehouse("ROOT", "寺院仓库", "", "system", "", true),
        warehouse("PHYSICAL", "实体库房", "", "system", "ROOT", true),
        warehouse("T1", "T1", "T1", "area", "PHYSICAL", true),
        warehouse("T2", "T2", "T2", "area", "PHYSICAL", true),
        warehouse("ROOM-1", "T1 / A14", "T1 / A14", "room", "T1", true),
        warehouse("ROOM-2", "T2 / A14", "T2 / A14", "room", "T2", true),
        warehouse(
          "DIRECT-1",
          "T1 / A14",
          "T1 / A14",
          "room",
          "ROOM-1",
          false,
          true,
          "ROOM-1",
        ),
        warehouse(
          "DIRECT-2",
          "T2 / A14",
          "T2 / A14",
          "room",
          "ROOM-2",
          false,
          true,
          "ROOM-2",
        ),
      ],
    };

    hydrateReferenceData(reference, result);

    const room = reference.warehouses.find((row) => row.name === "ROOM-1");
    expect(room?.kind).toBe("room");
    expect(room?.label).toBe("T1 / A14");
    expect(room?.path).toBe("T1 / A14");
  });

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
