// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { useItemEditor } from "../src/features/items/useItemEditor";
import type { CatalogItem } from "../src/lib/catalogPresentation";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
});
const item: CatalogItem = {
  item_code: "ITM-000999",
  item_name: "新物品",
  item_group: "ROOT",
  stock_uom: "Kg",
  version: "v1",
  can_edit: true,
  description: "说明",
  has_batch_no: false,
  has_expiry_date: false,
  barcodes: [{ barcode: "A" }, { barcode: "B" }],
  uoms: [{ uom: "Kg", conversion_factor: 1 }],
  attachments: [],
};
function setup(
  call: ReturnType<typeof vi.fn>,
  props: Parameters<typeof useItemEditor>[0] = {},
  units = [
    { name: "Nos", whole: true },
    { name: "Kg", whole: false },
  ],
  upload = vi.fn(),
) {
  let c!: ReturnType<typeof useItemEditor>;
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "unit-site",
    user: "volunteer",
    units,
    capabilities: { Item: { create: true } },
  });
  const saved = vi.fn(),
    child = defineComponent({
      setup() {
        c = useItemEditor(props, saved);
        return () => h("div");
      },
    });
  const parent = defineComponent({
    setup() {
      provideInventoryServices({ call, upload, report: vi.fn() }, reference);
      return () => h(child);
    },
  });
  const wrapper = mount(parent);
  wrappers.push(wrapper);
  return { c, saved, wrapper, reference };
}
function service() {
  return vi.fn(async (method, args) => {
    if (method === "catalog.suggest_item_code")
      return { item_code: item.item_code };
    if (method === "catalog.save_item")
      return {
        ...item,
        ...args.data,
        version: args.item_code ? "v2" : "v1",
        barcodes: String(args.data.barcodes)
          .split("\n")
          .map((barcode) => ({ barcode })),
      };
    if (method === "catalog.operation_items")
      return { items: [structuredClone(item)], errors: [] };
    if (method === "catalog.item_lifecycle")
      return {
        tracking_changeable: true,
        tracking_change_reason: "",
        can_delete: true,
        disabled: false,
      };
    if (method === "catalog.item_lifecycle")
      return {
        tracking_changeable: true,
        tracking_change_reason: "",
        can_delete: true,
        disabled: false,
      };
    throw new Error(`Unexpected ${method}`);
  });
}
function fill(c: ReturnType<typeof useItemEditor>) {
  Object.assign(c.model, {
    name: "新物品",
    category: "ROOT",
    uom: "Kg",
    barcode: "A\nB",
  });
}
describe("native Item editing and pending uploads", () => {
  it("uses Nos only when it exists and preserves the user's selected native UOM and multiline barcodes", async () => {
    const call = service(),
      { c, saved } = setup(call);
    await flushPromises();
    expect(c.model.uom).toBe("Nos");
    fill(c);
    await c.save();
    expect(call).toHaveBeenCalledWith(
      "catalog.save_item",
      expect.objectContaining({
        data: expect.objectContaining({ stock_uom: "Kg", barcodes: "A\nB" }),
      }),
    );
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ stock_uom: "Kg" }),
    );
    const { c: unknown } = setup(service(), {}, [{ name: "Kg", whole: false }]);
    await flushPromises();
    expect(unknown.model.uom).toBe("");
  });
  it("keeps the created native Item identity after upload failure and retries without creating a duplicate", async () => {
    const call = service(),
      upload = vi
        .fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue({
          name: "FILE",
          file_url: "/private/files/photo.jpg",
          file_name: "photo.jpg",
          is_private: 1,
        });
    const { c, saved } = setup(call, {}, undefined, upload);
    await flushPromises();
    fill(c);
    c.files.add([new File(["picture"], "photo.jpg", { type: "image/jpeg" })]);
    await c.save();
    expect(saved).not.toHaveBeenCalled();
    expect(c.existing.value?.item_code).toBe(item.item_code);
    const snapshot = c.recovery.list().entries[0]!;
    expect(snapshot.values.editingCode).toBe(item.item_code);
    expect(snapshot.values.creating).toBe(true);
    expect(snapshot.pendingUploadReselection).toBe(true);
    await c.save();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(
      call.mock.calls.filter(
        ([method, args]) => method === "catalog.save_item" && !args.item_code,
      ),
    ).toHaveLength(1);
    expect(
      call.mock.calls.filter(
        ([method, args]) =>
          method === "catalog.save_item" && args.item_code === item.item_code,
      ),
    ).toHaveLength(1);
  });
  it("reloads the actual created Item before recovering files and refuses a stale native version", async () => {
    const call = service(),
      { c } = setup(call);
    await flushPromises();
    fill(c);
    const snapshot = {
      schema: 1 as const,
      site: "unit-site",
      account: "volunteer",
      tabId: "old",
      editorId: "old-editor",
      editorKind: "Item",
      baseVersion: "v1",
      revision: 2,
      updatedAt: "2026-10-16",
      pendingUploadReselection: true,
      values: {
        ...c.model,
        editingCode: item.item_code,
        creating: true,
        attachments: [
          {
            id: "pending",
            name: "photo.jpg",
            type: "image/jpeg",
            state: "pending",
            progress: 0,
            error: "",
          },
        ],
      },
    };
    await c.recover(snapshot);
    expect(c.existing.value?.item_code).toBe(item.item_code);
    expect(c.files.files[0]?.state).toBe("reselect");
    call.mockImplementation(async (method) =>
      method === "catalog.operation_items"
        ? { items: [{ ...item, version: "changed" }], errors: [] }
        : method === "catalog.item_lifecycle"
          ? {
              tracking_changeable: true,
              tracking_change_reason: "",
              can_delete: true,
              disabled: false,
            }
          : { item_code: item.item_code },
    );
    await c.recover({
      ...snapshot,
      values: { ...snapshot.values, name: "不得覆盖" },
    });
    expect(c.model.name).not.toBe("不得覆盖");
    expect(c.error.value).toContain("物品已更改");
  });
  it("durably replaces the recovered Item snapshot and leaves a competing revision intact", async () => {
    const { c } = setup(service());
    await flushPromises();
    const snapshot = {
      schema: 1 as const,
      site: "unit-site",
      account: "volunteer",
      tabId: "old-tab",
      editorId: "source-item-editor",
      editorKind: "Item",
      baseVersion: "v1",
      revision: 2,
      updatedAt: "now",
      pendingUploadReselection: false,
      values: {
        ...c.model,
        editingCode: item.item_code,
        name: "Recovered",
        attachments: [],
      },
    };
    c.recovery.save(snapshot);
    await c.recover(snapshot);
    expect(c.recovery.list().entries).toHaveLength(1);
    expect(c.recovery.list().entries[0]?.editorId).not.toBe(snapshot.editorId);
    expect(c.recovery.list().entries[0]?.values.name).toBe("Recovered");

    const competing = {
      ...snapshot,
      tabId: "other-tab",
      revision: 3,
      values: { ...snapshot.values, name: "Other tab" },
    };
    localStorage.setItem(
      "temple-inventory:recovery:v1:unit-site:volunteer:source-item-editor",
      JSON.stringify(competing),
    );
    await c.recover(snapshot);
    const entries = c.recovery.list().entries;
    expect(
      entries.some(
        (entry) => entry.editorId === snapshot.editorId && entry.revision === 3,
      ),
    ).toBe(true);
    expect(entries.some((entry) => entry.values.name === "Recovered")).toBe(
      true,
    );
  });
  it("keeps the source Item recovery snapshot when replacement persistence fails", async () => {
    const { c } = setup(service());
    await flushPromises();
    const snapshot = {
      schema: 1 as const,
      site: "unit-site",
      account: "volunteer",
      tabId: "old-tab",
      editorId: "source-item-editor",
      editorKind: "Item",
      baseVersion: "v1",
      revision: 2,
      updatedAt: "now",
      pendingUploadReselection: false,
      values: {
        ...c.model,
        editingCode: item.item_code,
        name: "Recovered",
        attachments: [],
      },
    };
    c.recovery.save(snapshot);
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (key, value) {
        if (key.endsWith(encodeURIComponent(snapshot.editorId)))
          originalSetItem.call(this, key, value);
        else throw new DOMException("storage full", "QuotaExceededError");
      });

    await c.recover(snapshot);

    setItem.mockRestore();
    const entries = c.recovery.list().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.editorId).toBe(snapshot.editorId);
    expect(entries[0]?.revision).toBe(snapshot.revision);
    expect(entries[0]?.values.name).toBe("Recovered");
  });
  it("does not recreate a discarded recovery entry on unmount and resets contextual creation to a fresh native identity", async () => {
    const { c, wrapper } = setup(service());
    await flushPromises();
    fill(c);
    expect(c.recovery.list().entries.length).toBeGreaterThan(0);
    c.discard();
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(c.recovery.list().entries).toHaveLength(0);
    const { c: next } = setup(service());
    await flushPromises();
    fill(next);
    await next.save();
    expect(next.existing.value).toBeDefined();
    await next.reset();
    expect(next.existing.value).toBeUndefined();
    expect(next.model.name).toBe("");
    expect(next.files.files).toHaveLength(0);
  });
});

it("does not mark an untouched lazy contextual Item editor as dirty", () => {
  const { c } = setup(service(), { contextual: true, lazy: true });
  expect(c.dirty.value).toBe(false);
});
