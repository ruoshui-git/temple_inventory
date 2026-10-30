// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import TransactionContext from "../src/features/documents/TransactionContext.vue";
import Overlay from "../src/components/ui/Overlay.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

function activityEditorStub() {
  return defineComponent({
    setup(_, { expose, emit }) {
      expose({ requestLeave: async () => true });
      return () =>
        h(
          "button",
          {
            onClick: () =>
              emit("saved", { name: "NEW-ACTIVITY", title: "新活动标题" }),
          },
          "创建活动",
        );
    },
  });
}

function mountContext() {
  const draft = reactive({
    source: "",
    purpose: "",
    activity: "",
    loanName: "",
    kind: "Loan",
  });
  const reference = createReferenceData();
  const host = defineComponent({
    setup() {
      provideInventoryServices(
        {
          call: async () => ({ rows: [], total: 0, next: null }),
          report: vi.fn(),
          upload: vi.fn(),
        },
        reference,
      );
      return () =>
        h(
          Overlay,
          { title: "借出记录" },
          {
            default: () =>
              h(TransactionContext, { draft, activityLabel: "未填写" }),
          },
        );
    },
  });
  const wrapper = mount(host, {
    attachTo: document.body,
    global: {
      stubs: {
        ActivityEditor: activityEditorStub(),
        RemoteSelect: defineComponent({
          props: ["selectedLabel"],
          render() {
            return h(
              "div",
              { "data-testid": "selected-label" },
              this.selectedLabel,
            );
          },
        }),
      },
    },
  });
  wrappers.push(wrapper);
  return { wrapper, draft };
}

it("opens the nested activity dialog and selects its saved title before closing", async () => {
  const { draft } = mountContext();
  document
    .querySelector<HTMLButtonElement>("button.form-field-action")!
    .click();
  await flushPromises();
  expect(document.body.querySelectorAll(".ui-overlay")).toHaveLength(2);
  await Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.textContent === "创建活动")!
    .click();
  await flushPromises();
  expect(draft.activity).toBe("NEW-ACTIVITY");
  expect(document.body.querySelector(".ui-overlay")).not.toBeNull();
  expect(document.body.querySelectorAll(".ui-overlay")).toHaveLength(1);
  expect(document.body.textContent).toContain("新活动标题");
});

it("Escape closes only the top activity dialog", async () => {
  mountContext();
  await document
    .querySelector<HTMLButtonElement>("button.form-field-action")!
    .click();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await flushPromises();
  expect(document.body.querySelectorAll(".ui-overlay")).toHaveLength(1);
  expect(document.body.querySelectorAll(".overlay-stage")).toHaveLength(0);
  expect(document.body.textContent).toContain("借出记录");
});
