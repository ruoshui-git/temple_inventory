import { afterEach, describe, expect, it } from "vitest";
import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import PreviewBrowsePages from "../src/design-preview/PreviewBrowsePages.vue";
import {
  createDraft,
  createReviewSession,
  pageFromHash,
  pageHash,
  previewPages,
  resetReviewSession,
  reviewSession,
  submitDraft,
  type PreviewPageKey,
} from "../src/design-preview/reviewModel";

const mounted: VueWrapper[] = [];
function render(route: PreviewPageKey) {
  const wrapper = mount(PreviewBrowsePages, {
    props: { route },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}
function button(wrapper: VueWrapper, label: string): DOMWrapper<Element> {
  let found = wrapper
    .findAll("button")
    .find((candidate) => candidate.text().includes(label));
  if (!found) {
    const target = [...document.body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.includes(label),
    );
    if (target) return new DOMWrapper(target);
  }
  if (!found) throw new Error(`Could not find button containing: ${label}`);
  return found;
}

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  resetReviewSession();
});

describe("interactive design preview browse pages", () => {
  it("registers canonical route variants and round-trips stable preview hashes", () => {
    expect(
      previewPages.some((row) => row.key === "movement-form/Opening"),
    ).toBe(false);
    expect(
      previewPages.some((row) => row.key === "movement-records/detail"),
    ).toBe(true);
    expect(previewPages.some((row) => row.key === "pending/actionable")).toBe(
      true,
    );
    expect(pageFromHash(pageHash("expiry/expired"))).toMatchObject({
      page: "expiry",
      variant: "expired",
      path: "/expiry",
    });
    expect(pageFromHash("#review/%E0%A4%A")).toBeUndefined();
  });

  it("keeps inventory variants registered for the original PreviewInventory renderer", () => {
    expect(
      previewPages
        .filter((row) => row.page === "inventory")
        .map((row) => row.variant),
    ).toEqual(["list", "filtered", "empty"]);
  });

  it("shows expired zero-available mushroom batch and its damaged quantity context", () => {
    const wrapper = render("expiry/expired");
    expect(wrapper.text()).toContain("香菇干货");
    expect(wrapper.text()).toContain("MUSH-2509");
    expect(wrapper.text()).toContain("0 袋");
    expect(
      reviewSession.stock.find((row) => row.code === "ITM-000132")?.damaged,
    ).toBe(3);
  });

  it("limits the upcoming expiry view to batches within thirty days", () => {
    const wrapper = render("expiry/soon");
    expect(wrapper.text()).toContain("OIL-2610");
    expect(wrapper.text()).not.toContain("RICE-2609");
    expect(wrapper.text()).not.toContain("TEXTILE-2610");
  });

  it("opens the exact movement record selected from the records table", async () => {
    const wrapper = render("movement-records/completed");
    await button(wrapper, "PREV-MOV-001").trigger("click");
    expect(reviewSession.selectedMovementName).toBe("PREV-MOV-001");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-records",
      "selected",
    ]);
  });

  it("opens the exact loan record and seeds a contextual return", async () => {
    const wrapper = render("loan-records/open");
    await button(wrapper, "PREV-LOAN-001").trigger("click");
    expect(reviewSession.selectedLoanName).toBe("PREV-LOAN-001");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "loan-detail",
      "selected",
    ]);
    await wrapper.setProps({ route: "loan-detail/selected" });
    await button(wrapper, "登记归还").trigger("click");
    expect(reviewSession.selectedDraftName).toContain("RETURN");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-form",
      "Return",
    ]);
  });

  it("seeds damaged-stock actions as the real Repair or Disposal form", async () => {
    const wrapper = render("pending/actionable");
    const mushroomCard = wrapper
      .findAll(".browse-pending-card")
      .find((card) => card.text().includes("香菇干货"));
    expect(mushroomCard).toBeTruthy();
    await button(mushroomCard!, "修复归库").trigger("click");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-form",
      "Repair",
    ]);
    const seeded = reviewSession.drafts.find(
      (draft) => draft.kind === "Repair",
    );
    expect(seeded?.lines[0]).toMatchObject({
      code: "ITM-000132",
      qty: 3,
      location: "斋堂 / A-01",
    });
    expect(wrapper.text()).not.toContain("到期复核");
  });

  it("preserves the warehouse distinction between Room, Location, and group", async () => {
    const wrapper = render("warehouses/tree");
    await button(wrapper, "新建仓库").trigger("click");
    await new DOMWrapper(
      document.body.querySelector(".browse-dialog input")!,
    ).setValue("新斋堂房间");
    await new DOMWrapper(
      document.body.querySelectorAll(".browse-dialog select")[1]!,
    ).setValue("Room");
    await button(wrapper, "保存到预览").trigger("click");
    expect(
      reviewSession.warehouses.find((row) => row.name === "新斋堂房间"),
    ).toMatchObject({
      warehouse_type: "Room",
      is_group: true,
    });
  });

  it("continues or deletes a draft only after explicit confirmation", async () => {
    const wrapper = render("drafts/open");
    const draft = reviewSession.drafts.find(
      (row) => row.name === "PREV-DRAFT-RECEIVE-001",
    )!;
    await button(wrapper, "继续填写").trigger("click");
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-form",
      "Receive",
    ]);
    await button(wrapper, "删除").trigger("click");
    expect(reviewSession.drafts.some((row) => row.name === draft.name)).toBe(
      true,
    );
    await button(wrapper, "删除草稿").trigger("click");
    expect(reviewSession.drafts.some((row) => row.name === draft.name)).toBe(
      false,
    );
  });

  it("creates independent fixture sessions with deterministic draft counters", () => {
    const firstSession = createReviewSession();
    const secondSession = createReviewSession();
    const first = createDraft("Repair", undefined, firstSession);
    const second = createDraft("Repair", undefined, secondSession);
    expect(first.name).toBe("PREV-REPAIR-001");
    expect(second.name).toBe(first.name);
    firstSession.stock[0].locations[0].available -= 1;
    expect(secondSession.stock[0].locations[0].available).toBe(80);
    expect(reviewSession.drafts.some((row) => row.name === first.name)).toBe(
      false,
    );
  });

  it("confirms a simulated movement without changing the fixed stock snapshot", () => {
    const item = reviewSession.stock.find((row) => row.code === "ITM-000128")!;
    const before = JSON.parse(JSON.stringify(item));
    const draft = reviewSession.drafts.find(
      (row) => row.name === "PREV-DRAFT-RECEIVE-001",
    )!;
    submitDraft("Receive", draft.name);
    expect(draft.status).toBe("completed");
    expect(reviewSession.stock.find((row) => row.code === item.code)).toEqual(
      before,
    );
    expect(reviewSession.movements[0]).toMatchObject({
      name: draft.name,
      kind: "Receive",
      docstatus: 1,
    });
  });
});
