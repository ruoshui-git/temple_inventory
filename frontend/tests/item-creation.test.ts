import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ItemCreateForm from "../src/components/ItemCreateForm.vue";
import ItemPicker from "../src/components/ItemPicker.vue";
import ScannableInput from "../src/components/ScannableInput.vue";
import NewItem from "../src/pages/NewItem.vue";

const state = vi.hoisted(() => ({
  api: vi.fn(),
  workspaceApi: vi.fn(),
  toast: vi.fn(),
  router: { replace: vi.fn(), back: vi.fn() },
}));

vi.mock("../src/lib/api", () => ({
  api: state.api,
  workspaceApi: state.workspaceApi,
  upload: vi.fn(),
}));
vi.mock("../src/lib/toast", () => ({ toast: state.toast }));
vi.mock("../src/lib/navigation", () => ({ returnToOpener: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => state.router }));
vi.mock("frappe-ui", () => ({
  Combobox: {
    props: ["modelValue", "options", "placeholder"],
    emits: ["update:modelValue"],
    template: `<select class="uom-combobox" :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
      <option value="">{{ placeholder }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>`,
  },
}));

const boot = (uoms = [{ name: "Nos", uom_name: "Nos" }]) => ({
  user: "Administrator",
  capabilities: { Item: true, UOM: true },
  uoms,
  item_groups: [{ name: "All Item Groups", item_group_name: "全部物品组" }],
  warehouses: [],
  warehouse_tree: [],
  batch: { enabled: true, error: null },
});

function creationApi(method: string, args?: any) {
  if (method === "suggest_item_code")
    return Promise.resolve({ item_code: "ITM-000099" });
  if (method === "check_item_code") {
    const itemCode = String(args?.item_code || "").trim();
    return Promise.resolve({
      item_code: itemCode,
      available: true,
      reason: null,
      message: "此编号可用",
    });
  }
  if (method === "search_items")
    return Promise.resolve({ results: [], total: 0 });
  if (method === "bootstrap") return Promise.resolve(boot());
  if (method === "create_item")
    return Promise.resolve({ item_code: args.data.item_code });
  throw new Error(`Unexpected API call: ${method}`);
}

async function fillRequiredName(
  wrapper: ReturnType<typeof mount>,
  name = "供品",
) {
  await wrapper.findAll("input[required]")[1].setValue(name);
}

describe("item creation entry points", () => {
  beforeEach(() => {
    state.api.mockReset();
    state.workspaceApi.mockReset();
    state.toast.mockReset();
    state.router.replace.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => vi.useRealTimers());

  it("keeps create-item above the infinitely loaded result list", async () => {
    state.api.mockImplementation(creationApi);
    const wrapper = mount(ItemPicker, { props: { boot: boot() } });
    await flushPromises();
    const create = wrapper.find(".item-picker-create").element;
    const results = wrapper.find("h3").element;
    expect(
      create.compareDocumentPosition(results) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses a dedicated standalone page instead of a drawer", async () => {
    state.api.mockImplementation(creationApi);
    const wrapper = mount(NewItem);
    await flushPromises();
    expect(wrapper.find(".item-create-page").exists()).toBe(true);
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(false);
    expect(wrapper.findComponent(ItemCreateForm).exists()).toBe(true);
  });

  it("previews an editable code and submits the selected non-Nos UOM exactly", async () => {
    let submitted: any;
    state.api.mockImplementation(async (method: string, args: any) => {
      if (method === "create_item") {
        submitted = args.data;
        return { item_code: args.data.item_code };
      }
      return creationApi(method, args);
    });
    const wrapper = mount(ItemCreateForm, {
      props: {
        boot: boot([
          { name: "Nos", uom_name: "Nos" },
          { name: "Box", uom_name: "Box" },
        ]),
      },
    });
    await flushPromises();
    expect(
      (wrapper.find("#new-item-code").element as HTMLInputElement).value,
    ).toBe("ITM-000099");
    expect(
      (wrapper.find(".uom-combobox").element as HTMLSelectElement).value,
    ).toBe("Nos");

    await wrapper.find("#new-item-code").setValue(" EXCEL-42 ");
    await wrapper.find("#new-item-code").trigger("blur");
    await wrapper.find(".uom-combobox").setValue("Box");
    await fillRequiredName(wrapper);
    await wrapper.find("form.item-create-form").trigger("submit");
    await flushPromises();

    expect(submitted.item_code).toBe("EXCEL-42");
    expect(submitted.stock_uom).toBe("Box");
    expect(state.toast).toHaveBeenCalledWith("已创建物品：供品");
  });

  it("starts with an empty UOM when Nos does not exist", async () => {
    state.api.mockImplementation(creationApi);
    const wrapper = mount(ItemCreateForm, {
      props: { boot: boot([{ name: "Ampere", uom_name: "Ampere" }]) },
    });
    await flushPromises();
    expect(
      (wrapper.find(".uom-combobox").element as HTMLSelectElement).value,
    ).toBe("");
  });

  it("selects a newly created UOM without clearing the draft", async () => {
    state.api.mockImplementation((method: string, args: any) => {
      if (method === "create_uom")
        return Promise.resolve({
          name: args.uom_name,
          uom_name: args.uom_name,
        });
      return creationApi(method, args);
    });
    const draft = boot();
    const wrapper = mount(ItemCreateForm, { props: { boot: draft } });
    await flushPromises();
    await fillRequiredName(wrapper, "保留的名称");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("新建单位"))!
      .trigger("click");
    const unitForm = wrapper.findAll("form")[1];
    await unitForm.find("input[required]").setValue("包");
    await unitForm.trigger("submit");
    await flushPromises();

    expect(
      (wrapper.find(".uom-combobox").element as HTMLSelectElement).value,
    ).toBe("包");
    expect(
      (wrapper.findAll("input[required]")[1].element as HTMLInputElement).value,
    ).toBe("保留的名称");
    expect(draft.uoms).toContainEqual({ name: "包", uom_name: "包" });
  });

  it("ignores a stale code-availability response", async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: any) => void;
    let resolveNew!: (value: any) => void;
    const oldResult = new Promise((resolve) => (resolveOld = resolve));
    const newResult = new Promise((resolve) => (resolveNew = resolve));
    state.api.mockImplementation((method: string, args: any) => {
      if (method === "suggest_item_code")
        return Promise.resolve({ item_code: "ITM-000099" });
      if (method === "check_item_code")
        return args.item_code === "OLD" ? oldResult : newResult;
      return creationApi(method, args);
    });
    const wrapper = mount(ItemCreateForm, { props: { boot: boot() } });
    await flushPromises();

    await wrapper.find("#new-item-code").setValue("OLD");
    await vi.advanceTimersByTimeAsync(350);
    await wrapper.find("#new-item-code").setValue("NEW");
    await vi.advanceTimersByTimeAsync(350);
    resolveNew({
      item_code: "NEW",
      available: true,
      reason: null,
      message: "NEW 可用",
    });
    await flushPromises();
    resolveOld({
      item_code: "OLD",
      available: false,
      reason: "exists",
      message: "OLD 已存在",
    });
    await flushPromises();

    expect(wrapper.find("#item-code-status").text()).toBe("NEW 可用");
    expect(wrapper.find("#item-code-status").classes()).toContain("success");
  });

  it("shows a collision without clearing the draft and can regenerate the code", async () => {
    let suggestions = 0;
    state.api.mockImplementation((method: string, args: any) => {
      if (method === "suggest_item_code") {
        suggestions += 1;
        return Promise.resolve({
          item_code: suggestions === 1 ? "ITM-000099" : "ITM-000100",
        });
      }
      if (method === "check_item_code") {
        const code = String(args.item_code).trim();
        return Promise.resolve(
          code === "USED"
            ? {
                item_code: code,
                available: false,
                reason: "exists",
                message: "此物品编号已存在。请输入其他编号，或使用自动编号。",
              }
            : {
                item_code: code,
                available: true,
                reason: null,
                message: "此编号可用",
              },
        );
      }
      return creationApi(method, args);
    });
    const wrapper = mount(ItemCreateForm, { props: { boot: boot() } });
    await flushPromises();
    await fillRequiredName(wrapper, "保留的名称");
    await wrapper.find("#new-item-code").setValue("USED");
    await wrapper.find("#new-item-code").trigger("blur");
    await flushPromises();

    expect(wrapper.find("#item-code-status").text()).toContain(
      "请输入其他编号",
    );
    expect(
      (wrapper.findAll("input[required]")[1].element as HTMLInputElement).value,
    ).toBe("保留的名称");
    await wrapper
      .find('button[aria-label="使用新的自动编号"]')
      .trigger("click");
    await flushPromises();
    expect(
      (wrapper.find("#new-item-code").element as HTMLInputElement).value,
    ).toBe("ITM-000100");
  });

  it("places an accessible scanner button beside its input", () => {
    const wrapper = mount(ScannableInput, {
      props: { modelValue: "typed", label: "条码", scanLabel: "扫描条码" },
    });
    const row = wrapper.find(".input-with-action");
    expect((row.find("input").element as HTMLInputElement).value).toBe("typed");
    expect(row.find('button[aria-label="扫描条码"]').exists()).toBe(true);
  });

  it("fills the associated input after one scan and closes the scanner", async () => {
    const scanner = {
      emits: ["scan", "close"],
      template:
        "<button class=\"test-scanner\" @click=\"$emit('scan', 'SCANNED-1')\">scan</button>",
    };
    const wrapper = mount(ScannableInput, {
      props: { modelValue: "typed", label: "条码", scanLabel: "扫描条码" },
      global: { stubs: { Scanner: scanner } },
    });
    await wrapper.find('button[aria-label="扫描条码"]').trigger("click");
    await wrapper.find(".test-scanner").trigger("click");

    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["SCANNED-1"]);
    expect(wrapper.emitted("scan")).toEqual([["SCANNED-1"]]);
    expect(wrapper.find(".test-scanner").exists()).toBe(false);
  });

  it("creates in the transaction drawer, shows a toast, and selects the new item", async () => {
    state.api.mockImplementation(creationApi);
    state.workspaceApi.mockResolvedValue({
      item_code: "ITM-000099",
      item_name: "供品",
    });
    const wrapper = mount(ItemPicker, { props: { boot: boot() } });
    await flushPromises();
    await wrapper.find(".item-picker-create").trigger("click");
    await flushPromises();
    await fillRequiredName(wrapper);
    await wrapper.find("form.item-create-form").trigger("submit");
    await flushPromises();

    expect(state.api).toHaveBeenCalledWith(
      "create_item",
      expect.objectContaining({ data: expect.any(Object) }),
    );
    expect(state.toast).toHaveBeenCalledWith("已创建物品：供品");
    expect(wrapper.emitted("select")).toEqual([
      [{ item_code: "ITM-000099", item_name: "供品" }],
    ]);
  });
});
