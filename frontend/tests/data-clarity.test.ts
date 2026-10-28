// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, reactive, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import LocationEndpoint from "../src/components/ui/LocationEndpoint.vue";
import RecordRef from "../src/components/ui/RecordRef.vue";
import RelatedLoanPreview from "../src/features/loans/RelatedLoanPreview.vue";
import { loanReferenceIdentity } from "../src/lib/relatedLoanPresentation";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function host(
  component: ReturnType<typeof defineComponent>,
  reference = createReferenceData(),
) {
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(component);
      },
    }),
  );
  wrappers.push(wrapper);
  return wrapper;
}

describe("data clarity components", () => {
  it("presents locations by topology pointer and kind-specific external meaning", () => {
    const reference = createReferenceData();
    reference.settings = {
      leased_warehouse: "LEASED",
      damaged_warehouse: "DAMAGED",
    };
    reference.warehouses = [
      {
        name: "ROOM",
        label: "A02",
        local_label: "A02",
        short_label: "",
        full_label: "剧场 / A02",
        path: "剧场 / A02",
        search_text: "A02",
        kind: "room",
        owner: "",
        direct: true,
        storable: true,
        missing_direct: false,
        parent: "",
        is_group: false,
        disabled: false,
        lft: 1,
        rgt: 2,
        version: "",
        protected: false,
        can_edit: true,
      },
      {
        name: "ROOM-2",
        label: "B01",
        local_label: "B01",
        short_label: "",
        full_label: "剧场 / B01",
        path: "剧场 / B01",
        search_text: "B01",
        kind: "room",
        owner: "",
        direct: true,
        storable: true,
        missing_direct: false,
        parent: "",
        is_group: false,
        disabled: false,
        lft: 3,
        rgt: 4,
        version: "",
        protected: false,
        can_edit: true,
      },
    ];
    const wrapper = host(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(LocationEndpoint, { warehouse: "ROOM", kind: "Transfer" }),
            h(LocationEndpoint, {
              warehouse: "LEASED",
              kind: "Return",
              borrower: "演出团队",
            }),
            h(LocationEndpoint, { warehouse: "DAMAGED", kind: "Repair" }),
            h(LocationEndpoint, { warehouse: "", kind: "Receive" }),
            h(LocationEndpoint, { warehouse: "", kind: "Loss" }),
          ]),
      }),
      reference,
    );
    expect(wrapper.text()).toContain("A02");
    expect(wrapper.text()).toContain("借出");
    expect(wrapper.text()).toContain("损坏待处理");
    expect(wrapper.text()).toContain("外部");
    expect(
      wrapper.findAll("[title]").map((node) => node.attributes("title")),
    ).toContain("来自库外");
    expect(
      wrapper.findAll("[title]").map((node) => node.attributes("title")),
    ).toContain("不再计入库存");
    expect(
      wrapper.findAll(".location-endpoint")[1]?.attributes("title"),
    ).toContain("演出团队");
  });

  it("shows unique counted locations in the source cell and an empty destination", () => {
    const reference = createReferenceData();
    reference.warehouses = [
      {
        name: "ROOM",
        label: "A02",
        local_label: "A02",
        short_label: "",
        full_label: "剧场 / A02",
        path: "剧场 / A02",
        search_text: "A02",
        kind: "room",
        owner: "",
        direct: true,
        storable: true,
        missing_direct: false,
        parent: "",
        is_group: false,
        disabled: false,
        lft: 1,
        rgt: 2,
        version: "",
        protected: false,
        can_edit: true,
      },
      {
        name: "ROOM-2",
        label: "B01",
        local_label: "B01",
        short_label: "",
        full_label: "剧场 / B01",
        path: "剧场 / B01",
        search_text: "B01",
        kind: "room",
        owner: "",
        direct: true,
        storable: true,
        missing_direct: false,
        parent: "",
        is_group: false,
        disabled: false,
        lft: 3,
        rgt: 4,
        version: "",
        protected: false,
        can_edit: true,
      },
    ];
    const wrapper = host(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(LocationEndpoint, {
              locations: ["ROOM", "ROOM-2", "ROOM"],
              kind: "Reconcile",
              role: "来源位置",
            }),
            h(LocationEndpoint, { kind: "Reconcile", role: "去向位置" }),
          ]),
      }),
      reference,
    );
    expect(wrapper.text()).toContain("A02 · B01");
    expect(wrapper.text()).toContain("—");
    expect(wrapper.text()).not.toContain("外部");
    expect(
      wrapper.findAll(".location-endpoint")[0]?.attributes("title"),
    ).toContain("剧场 / A02、剧场 / B01");
  });

  it("formats the original loan chip identity as borrower and month-day", () => {
    expect(loanReferenceIdentity("活动服务团队", "2026-07-14")).toBe(
      "活动服务团队 · 07-14",
    );
    const wrapper = mount(RecordRef, {
      props: {
        kind: "Loan",
        identity: loanReferenceIdentity("活动服务团队", "2026-07-14"),
        documentName: "MAT-STE-2026-01279",
        tooltip: "查看原借出记录",
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain("活动服务团队 · 07-14");
    expect(wrapper.text()).not.toContain("MAT-STE-2026-01279");
    expect(wrapper.get("button").attributes("title")).toBe(
      "MAT-STE-2026-01279",
    );
  });

  it("names the related kind and identity in RecordRef's accessible label", async () => {
    const wrapper = mount(RecordRef, {
      props: {
        kind: "Loan",
        identity: "演出团队 10月2日",
        count: 2,
        documentName: "STE-42",
        tooltip: "查看原借出记录",
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.get("button").attributes("aria-label")).toBe(
      "借出记录 2 笔借出",
    );
    expect(wrapper.get("button").attributes("title")).toBe("STE-42");
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("shows both read-only related-loan stages with labeled fields and item rows", async () => {
    const loan = {
      name: "STE-LOAN-1",
      kind: "Loan",
      doctype: "Stock Entry",
      docstatus: 1,
      posting_date: "2026-10-02",
      ti_borrower: "演出团队",
      activity_title: "秋季演出",
      remarks: "归还后清点",
      items: [
        {
          name: "LINE-1",
          item_code: "BOX-1",
          item_name: "活动周转箱",
          ti_display_image: "",
          stock_uom: "Nos",
          transfer_qty: 6,
          outstanding_qty: 2,
          outcomes: { Returned: 3, Damaged: 1, Lost: 0 },
          s_warehouse: "ROOM",
          t_warehouse: "LEASED",
        },
      ],
    };
    const controller = {
      open: ref(true),
      names: ref([loan.name]),
      selected: ref(""),
      records: reactive({ [loan.name]: { loading: false, loan, error: "" } }),
      current: computed(() =>
        controller.selected.value ? controller.records[loan.name] : undefined,
      ),
      close: vi.fn(),
      retry: vi.fn(),
      show: vi.fn(),
    };
    const reference = createReferenceData();
    reference.settings = { leased_warehouse: "LEASED" };
    reference.warehouses = [
      {
        name: "ROOM",
        label: "排练室",
        local_label: "排练室",
        short_label: "",
        full_label: "剧场 / 排练室",
        path: "剧场 / 排练室",
        search_text: "排练室",
        kind: "room",
        owner: "",
        direct: true,
        storable: true,
        missing_direct: false,
        parent: "",
        is_group: false,
        disabled: false,
        lft: 1,
        rgt: 2,
        version: "",
        protected: false,
        can_edit: true,
      },
    ];
    const wrapper = mount(
      defineComponent({
        setup() {
          provideInventoryServices(
            { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
            reference,
          );
          return () =>
            h(RelatedLoanPreview, { controller: controller as never });
        },
      }),
    );
    wrappers.push(wrapper);
    await flushPromises();
    expect(document.body.textContent).toContain("原借出记录 · 只读");
    expect(document.body.textContent).toContain(
      "这笔记录结算的是以下借出记录。数量与结清情况以原借出为准。",
    );
    expect(document.body.textContent).toContain("借用方");
    expect(document.body.textContent).toContain("STE-LOAN-1");
    document.querySelector<HTMLButtonElement>(".related-loan-card")?.click();
    await flushPromises();
    expect(document.body.textContent).toContain("完好归还");
    expect(document.body.textContent).toContain("原存放");
    expect(document.body.textContent).not.toContain("来源→去向");
    expect(document.body.textContent).toContain("活动周转箱");
    expect(document.body.textContent).toContain("备注");
  });
});
