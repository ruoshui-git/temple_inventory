import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WarehousesView from "../src/features/warehouses/WarehousesView.vue";

describe("WarehousesView loading state", () => {
  it("removes inert while idle and keeps search usable during retained-data refresh", async () => {
    const row = {
      name: "WH-1",
      localLabel: "主仓",
      breadcrumb: "主仓",
      displayDepth: 0,
      canOperate: true,
      semanticType: "warehouse",
      parentName: "",
    };
    const controller = {
      boot: ref(null),
      loading: ref(false),
      error: ref(""),
      search: ref(""),
      dialog: ref(null),
      saving: ref(false),
      repairing: ref(null),
      quantityTotals: ref({}),
      summaryLoading: ref(false),
      summaryMetrics: ref([]),
      form: reactive({ parentSearch: "", parent: "", label: "" }),
      expanded: ref(new Set<string>()),
      list: ref(),
      dialogElement: ref(),
      labelInput: ref(),
      rowRefs: ref(new Map()),
      previousFocus: ref(),
      summaryTimer: ref(),
      rawRows: ref([row]),
      rows: ref([row]),
      filtered: ref([row]),
      roots: ref([row]),
      visibleRows: ref([row]),
      context: ref(null),
      actions: ref([]),
      physicalRoot: ref(null),
      parentOptions: ref([]),
      matchingParents: ref([]),
      selectedParent: ref(null),
      dialogTitle: ref(""),
      nameLabel: ref("仓库名称"),
      remember: () => undefined,
      toggle: () => undefined,
      open: () => undefined,
      defaultParent: () => "",
      start: () => undefined,
      chooseParent: () => undefined,
      closeDialog: () => undefined,
      onDialogKeydown: () => undefined,
      load: () => undefined,
      loadSummary: () => undefined,
      repairMetadata: () => undefined,
      save: () => undefined,
    };
    const Host = defineComponent({
      setup() {
        return () => h(WarehousesView, { controller: controller as never });
      },
    });
    const wrapper = mount(Host, {
      global: {
        stubs: { QuantitySummary: true, FloatingActionMenu: true },
      },
    });

    expect(
      wrapper.find(".warehouse-data-region").attributes("inert"),
    ).toBeUndefined();
    controller.loading.value = true;
    await nextTick();
    expect(
      wrapper.find(".warehouse-data-region").attributes("inert"),
    ).toBeDefined();
    expect(
      wrapper.get('input[type="search"]').attributes("disabled"),
    ).toBeUndefined();
    controller.loading.value = false;
    await nextTick();
    expect(
      wrapper.find(".warehouse-data-region").attributes("inert"),
    ).toBeUndefined();
    wrapper.unmount();
  });
});
