import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import ItemPicker from "../src/features/items/ItemPicker.vue";

const wrappers: VueWrapper[] = [];
const panelActions: string[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  vi.restoreAllMocks();
  panelActions.length = 0;
});

const ButtonStub = defineComponent({
  name: "UiButton",
  props: ["disabled", "type", "loading", "variant"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" :type="type || \'button\'" @click="$emit(\'click\')"><slot /></button>',
});
const ToolbarStub = defineComponent({
  name: "BrowseToolbar",
  emits: ["scan", "sidebar", "update:search"],
  template:
    '<div class="browse-toolbar"><button @click="$emit(\'scan\')">扫码</button><slot name="persistent"/><slot name="filters"/><slot name="chips"/></div>',
});
const PanelStub = defineComponent({
  name: "ScanPanel",
  props: ["acceptItem", "hideFinishAction"],
  emits: ["create", "close", "finish"],
  setup(props, { emit, expose }) {
    expose({
      show: () => panelActions.push("show"),
      resumeAfterCreate: () => panelActions.push("resume"),
      finishScanning: () => {
        panelActions.push("finish");
        emit("finish");
        emit("close");
      },
      scan: () => props.acceptItem?.("ITEM-A"),
    });
    return {};
  },
  template:
    "<div class=\"scan-panel-stub\"><button v-if=\"!hideFinishAction\">完成扫描</button><button @click=\"$emit('create', 'UNKNOWN-123', { activeWarehouse: 'ROOM-A', destination: 'ROOM-B' })\">新建未知条码</button></div>",
});
const EditorStub = defineComponent({
  name: "ItemEditorView",
  props: ["controller", "contextual"],
  template:
    '<div class="item-editor-stub"><button @click="save">保存物品</button></div>',
  methods: {
    async save() {
      const controller = this.$props.controller as {
        model: { code: string; name: string; uom: string };
        save: () => Promise<void>;
      };
      controller.model.code = "ITEM-NEW";
      controller.model.name = "新建物品";
      controller.model.uom = "Nos";
      await controller.save();
    },
  },
});
const OverlayStub = defineComponent({
  name: "Overlay",
  template: '<div class="overlay-stub"><slot/><slot name="footer"/></div>',
});

describe("ItemPicker unknown barcode creation", () => {
  it("returns to the scan stage and resumes queued scanning after a new item is saved", async () => {
    const accept = vi.fn(async () => {});
    const call = vi.fn<InventoryServices["call"]>(async (endpoint) => {
      if (endpoint === "catalog.search_items")
        return { results: [], matched_count: 0, next_start: null } as never;
      if (endpoint === "catalog.suggest_item_code")
        return { item_code: "ITEM-SUGGESTED" } as never;
      if (endpoint === "catalog.save_item")
        return {
          item_code: "ITEM-NEW",
          item_name: "新建物品",
          item_group: "ROOT",
          stock_uom: "Nos",
          version: "item-v1",
          can_edit: true,
          description: "",
          has_batch_no: false,
          has_expiry_date: false,
          barcodes: [],
          uoms: [{ uom: "Nos", conversion_factor: 1 }],
          stock: [],
        } as never;
      throw new Error(`Unexpected ${endpoint}`);
    });
    const reference = createReferenceData();
    Object.assign(reference, {
      user: "operator",
      site: "picker-test.local",
      units: [{ name: "Nos", whole: true }],
      capabilities: { Item: { create: true } },
      categories: [
        { name: "ROOT", label: "用品", parent: "", is_group: false },
      ],
      physicalLeaves: ["ROOM-A", "ROOM-B"],
      warehouses: [
        { name: "ROOM-A", label: "房间甲", is_group: false },
        { name: "ROOM-B", label: "房间乙", is_group: false },
      ],
    });
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(ItemPicker, {
            allowCreate: true,
            mode: "add-multiple",
            scanMode: "operation",
            timestamp: "2026-10-21 10:00:00",
            activeWarehouse: "ROOM-A",
            scanDestination: "ROOM-B",
            scanDestinationLabel: "目标库位",
            scanDestinationOptions: [{ value: "ROOM-B", label: "房间乙" }],
            onOperationScan: accept,
          });
      },
    });
    const wrapper = mount(host, {
      global: {
        stubs: {
          Overlay: OverlayStub,
          UiButton: ButtonStub,
          BrowseToolbar: ToolbarStub,
          BrowseFilters: true,
          BrowseChip: true,
          VirtualList: true,
          ItemImage: true,
          SearchSelect: true,
          ScanPanel: PanelStub,
          ItemEditorView: EditorStub,
        },
      },
    });
    wrappers.push(wrapper);
    await flushPromises();
    await wrapper.get(".browse-toolbar button").trigger("click");
    await flushPromises();
    const scan = wrapper.findComponent(PanelStub);
    expect(wrapper.text()).toContain("每次扫描添加1个库存单位");
    scan.vm.$emit("create", "UNKNOWN-123", {
      activeWarehouse: "ROOM-A",
      destination: "ROOM-B",
    });
    await flushPromises();
    expect(wrapper.find(".item-editor-stub").exists()).toBe(true);
    expect(
      call.mock.calls.some(
        ([endpoint]) => endpoint === "catalog.suggest_item_code",
      ),
    ).toBe(true);

    await wrapper.get(".item-editor-stub button").trigger("click");
    await flushPromises();
    expect(accept).toHaveBeenCalledWith("ITEM-NEW", undefined, {
      activeWarehouse: "ROOM-A",
      destination: "ROOM-B",
    });
    expect(panelActions).toEqual(["show", "show", "resume"]);
    expect(
      wrapper.get(".picker-scan-stage").element.getAttribute("style"),
    ).not.toContain("display: none");
    const finishButtons = wrapper
      .findAll("button")
      .filter((button) => button.text() === "完成扫描");
    expect(finishButtons).toHaveLength(1);
    await finishButtons[0]!.trigger("click");
    await flushPromises();
    expect(panelActions).toEqual(["show", "show", "resume", "finish"]);
    expect(
      wrapper.get(".picker-scan-stage").element.getAttribute("style"),
    ).toContain("display: none");
    expect(
      wrapper
        .get(".item-editor-stub")
        .element.parentElement?.getAttribute("style"),
    ).toContain("display: none");
  });

  it("keeps count and selection scans selected when the same item is scanned again", async () => {
    const call = vi.fn<InventoryServices["call"]>(
      async () =>
        ({
          results: [],
          matched_count: 0,
          next_start: null,
        }) as never,
    );
    const reference = createReferenceData();
    Object.assign(reference, { user: "operator", site: "picker-test.local" });
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(ItemPicker, {
            mode: "add-multiple",
            scanMode: "selection",
          });
      },
    });
    const wrapper = mount(host, {
      global: {
        stubs: {
          Overlay: OverlayStub,
          UiButton: ButtonStub,
          BrowseToolbar: ToolbarStub,
          BrowseFilters: true,
          BrowseChip: true,
          VirtualList: true,
          ItemImage: true,
          SearchSelect: true,
          ScanPanel: PanelStub,
          ItemEditorView: EditorStub,
        },
      },
    });
    wrappers.push(wrapper);
    await flushPromises();
    const scanItem = (
      wrapper.findComponent(PanelStub).vm.$.exposed as { scan: () => void }
    ).scan;
    scanItem();
    await flushPromises();
    const selectedButton = wrapper
      .findAll("button")
      .find((button) => button.text().startsWith("添加所选"));
    expect(selectedButton?.text()).toContain("（1）");
    expect(selectedButton?.attributes("disabled")).toBeUndefined();

    scanItem();
    await flushPromises();
    expect(selectedButton?.text()).toContain("（1）");
    expect(selectedButton?.attributes("disabled")).toBeUndefined();
  });
});
