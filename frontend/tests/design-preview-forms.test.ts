import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewSearchSelect from "../src/design-preview/components/PreviewSearchSelect.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewUtilityPages from "../src/design-preview/PreviewUtilityPages.vue";
import {
  resetReviewSession,
  reviewSession,
} from "../src/design-preview/reviewModel";

const wrappers: VueWrapper[] = [];
async function chooseSearch(wrapper: VueWrapper, label: string, value: string) {
  const select = wrapper
    .findAllComponents(PreviewSearchSelect)
    .find((row) => row.props("label") === label)!;
  await select.get("input").setValue(value);
  const option = select
    .findAll("[role=option]")
    .find((row) => row.text().includes(value))!;
  await option.trigger("click");
}

function render(component: unknown, props: Record<string, unknown>) {
  const wrapper = mount(component as never, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => resetReviewSession());
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  delete document.documentElement.dataset.previewDensity;
});
function clickTeleported(text: string) {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  button.click();
}

describe("preview workflow forms", () => {
  it("renders the nine supported movement creation variants and omits Opening", () => {
    const supported = [
      "Receive",
      "Issue",
      "Transfer",
      "Loan",
      "Return",
      "Damage",
      "Loss",
      "Repair",
      "Disposal",
    ];
    for (const variant of supported) {
      resetReviewSession();
      const wrapper = render(PreviewFormPages, {
        page: "movement-form",
        variant,
      });
      expect(wrapper.find("h1").text()).toContain("登记");
    }
    expect(supported).not.toContain("Opening");
  });

  it("links Return to a specific outstanding loan and its eligible item", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Return",
    });
    await chooseSearch(wrapper, "关联借用记录", "MAT-STE-2026-00004");
    await wrapper
      .findAll("button")
      .find((row) => row.text() === "加入此借用")!
      .trigger("click");
    expect(wrapper.get(".receive-line").text()).toContain("ITM-000130");
    expect(
      reviewSession.drafts
        .find((draft) => draft.kind === "Return")
        ?.lines.map((line) => line.code),
    ).toEqual(["ITM-000130"]);
    expect(wrapper.find('input[type="number"]').element.value).toBe("4");
  });

  it("retains edited movement fields after save and requires explicit confirmation", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive",
    });
    const stockBefore = reviewSession.stock.find(
      (item) => item.code === "ITM-000128",
    )?.available;
    const qty = wrapper.find('input[type="number"]');
    await qty.setValue("18");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "模拟保存失败")!
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "重试保存")!
      .trigger("click");
    expect(
      reviewSession.drafts.find((draft) => draft.kind === "Receive")?.lines[0]
        .qty,
    ).toBe(18);
    expect(
      reviewSession.drafts.find((draft) => draft.kind === "Receive")?.status,
    ).toBe("draft");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("复核并确认"))!
      .trigger("click");
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    clickTeleported("确认提交");
    await nextTick();
    expect(
      reviewSession.drafts.find((draft) => draft.kind === "Receive")?.status,
    ).toBe("completed");
    expect(reviewSession.movements[0].qty).toBe(18);
    expect(
      reviewSession.stock.find((item) => item.code === "ITM-000128")?.available,
    ).toBe(stockBefore);
  });

  it("keeps item input after validation failure and accepts retry", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "item-form",
      variant: "new",
    });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "模拟保存失败")!
      .trigger("click");
    await wrapper
      .find('input[placeholder="填写清晰易识别的名称"]')
      .setValue("新添置的折叠桌");
    await wrapper
      .find('input[placeholder="例如 ITM-000134"]')
      .setValue("ITM-000134");
    expect(wrapper.find('[role="alert"]').text()).toContain("输入内容已保留");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "重试保存")!
      .trigger("click");
    expect(
      reviewSession.drafts.find((draft) => draft.name === "PREV-ITEM-NEW-001")
        ?.itemName,
    ).toBe("新添置的折叠桌");
  });

  it("filters the report preview and exports exactly its current result scope", async () => {
    const wrapper = render(PreviewUtilityPages, {
      page: "reports",
      variant: "overview",
    });
    const kindSelect = wrapper
      .findAll("select")
      .find((select) => select.element.innerHTML.includes("Receive"));
    expect(kindSelect).toBeDefined();
    await kindSelect!.setValue("Receive");
    const filteredCount = new Set(
      wrapper
        .findAll("tbody tr")
        .filter((row) => row.text().includes("入库"))
        .map((row) => (row.text().includes("珍珠米") ? "rice" : "oil")),
    ).size;
    expect(filteredCount).toBeGreaterThan(0);
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("复核并导出"))!
      .trigger("click");
    await nextTick();
    expect(
      document.body.querySelector('[role="dialog"]')?.textContent,
    ).toContain(`${filteredCount} 条结果`);
    clickTeleported("模拟导出");
    await nextTick();
    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("筛选和输入内容已保留");
    clickTeleported("重试导出");
    await nextTick();
    expect(wrapper.emitted("notify")?.at(-1)?.[0]).toContain(
      `${filteredCount} 条CSV记录`,
    );
  });

  it("applies preview display density without saving account preferences", async () => {
    const wrapper = render(PreviewUtilityPages, {
      page: "settings",
      variant: "density",
    });
    await wrapper.find('input[value="spacious"]').setValue();
    expect(document.documentElement.dataset.previewDensity).toBe("spacious");
    expect(wrapper.emitted("update-density")?.at(-1)?.[0]).toBe("spacious");
    expect(localStorage.getItem("ti:design-preview:v3")).toBeNull();
  });
});
