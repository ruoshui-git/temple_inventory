// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ConfigurationPage from "../src/features/setup/ConfigurationPage.vue";
import PreviewSetupWorkspace from "./support/components/FixtureHostSetupWorkspace.vue";
import { fixtureConfiguration } from "./support/fixtureConfiguration";
import { fixtureServices } from "./support/fixtureServices";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import type { ConfigurationStatus } from "../src/features/setup/useConfiguration";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  fixtureConfiguration.scenario = "ready";
});
const status: ConfigurationStatus = {
  version: "settings-v1",
  ready: false,
  setup_required: true,
  is_manager: true,
  can_initialize: true,
  companies: ["TEMPLE"],
  selected_company: "TEMPLE",
  warnings: [],
  blockers: [{ code: "missing", message: "缺少必需结构" }],
  pointers: [
    {
      field: "physical_root_warehouse",
      label: "实体仓库根目录",
      current: "OLD",
      issue: "missing",
    },
  ],
  candidates: [
    {
      value: "ROOM/A,1",
      label: "实体仓库",
      group: true,
      parent: "ROOT",
      type: "Location",
      version: "warehouse-v1",
    },
  ],
};
const preview = {
  field: "physical_root_warehouse",
  label: "实体仓库根目录",
  current: "OLD",
  replacement: "ROOM/A,1",
  version: "settings-v1",
  fingerprint: "exact-review-v1",
  visible_nodes: 3,
  visible_leaves: 2,
  impact: "仅修改此配置引用，库存与仓库上级保持原样。",
  affected_references: [],
};
function setup(call = vi.fn(async () => status), gallery = false) {
  const reference = createReferenceData();
  Object.assign(reference, { user: "manager", site: "site" });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          gallery
            ? fixtureServices
            : ({ call, report: vi.fn(), upload: vi.fn() } as never),
          reference,
        );
        return () => h(gallery ? PreviewSetupWorkspace : ConfigurationPage);
      },
    }),
  );
  wrappers.push(wrapper);
  const page = wrapper.findComponent(ConfigurationPage);
  return { wrapper, page, c: page.vm.controller, reference, call };
}
describe("explicit native setup and repair", () => {
  it("loads permissions before displaying actions and initializes only from the confirmation dialog", async () => {
    const call = vi.fn(async (endpoint) =>
      endpoint === "configuration.initialize"
        ? {
            ...status,
            ready: true,
            setup_required: false,
            can_initialize: false,
            blockers: [],
          }
        : status,
    );
    const { wrapper, c, page } = setup(call);
    expect(wrapper.find(".skeleton-block--detail").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("查看初始化结构");
    await flushPromises();
    expect(call).toHaveBeenCalledTimes(1);
    const review = wrapper
      .findAll("button")
      .find((button) => button.text() === "查看初始化结构")!;
    await review.trigger("click");
    expect(c.initializeOpen.value).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("借出（叶子）");
    await c.apply(true);
    expect(call).toHaveBeenLastCalledWith("configuration.initialize", {
      company: "TEMPLE",
      version: "settings-v1",
    });
    expect(page.emitted("changed")).toHaveLength(1);
    expect(c.status.value?.ready).toBe(true);
  });
  it("requires exact reviewed pointer and confirmation, and retains input when native versions conflict", async () => {
    const call = vi.fn(async (endpoint) => {
      if (endpoint === "configuration.repair_preview") return preview;
      if (endpoint === "configuration.repair_pointer")
        throw new Error("配置已更改，请重新检查后核对");
      return status;
    });
    const { c } = setup(call);
    await flushPromises();
    c.warehouse.value = "ROOM/A,1";
    await flushPromises();
    await c.review();
    await c.apply();
    expect(
      call.mock.calls.filter(
        (args) => args[0] === "configuration.repair_pointer",
      ),
    ).toHaveLength(0);
    c.confirmed.value = true;
    await c.apply();
    expect(call).toHaveBeenLastCalledWith("configuration.repair_pointer", {
      field: "physical_root_warehouse",
      warehouse: "ROOM/A,1",
      version: "settings-v1",
      fingerprint: "exact-review-v1",
      confirmed: true,
    });
    expect(c.error.value).toContain("配置已更改");
    expect(c.preview.value).toEqual(preview);
    expect(c.warehouse.value).toBe("ROOM/A,1");
    c.warehouse.value = "ANOTHER";
    await flushPromises();
    expect(c.preview.value).toBeUndefined();
    expect(c.confirmed.value).toBe(false);
  });
  it("keeps denied access distinct from missing setup and ignores late responses after account changes", async () => {
    const denied = setup(
      vi.fn(async () => {
        throw new Error("已存在仓库无权读取");
      }),
    );
    await flushPromises();
    expect(denied.wrapper.text()).toContain("已存在仓库无权读取");
    expect(denied.wrapper.text()).not.toContain("查看初始化结构");
    let resolve!: (value: ConfigurationStatus) => void;
    const pending = setup(
      vi.fn(() => new Promise<ConfigurationStatus>((done) => (resolve = done))),
    );
    pending.reference.user = "another";
    await flushPromises();
    resolve(status);
    await flushPromises();
    expect(pending.c.status.value).toBeUndefined();
    expect(pending.wrapper.text()).not.toContain("TEMPLE");
  });
  it("runs gallery states through the same shared page and explicit fixture service", async () => {
    fixtureConfiguration.scenario = "root";
    const { c, wrapper } = setup(undefined, true);
    await flushPromises();
    expect(c.status.value?.setup_required).toBe(true);
    expect(wrapper.text()).toContain("实体仓库根引用已失效");
    fixtureConfiguration.scenario = "denied";
    await flushPromises();
    expect(c.error.value).toContain("不能重新创建");
  });
});
