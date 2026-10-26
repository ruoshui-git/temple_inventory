import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import CategoriesPage from "../src/features/references/CategoriesPage.vue";
import { useCategoriesController } from "../src/features/references/useCategoriesController";
import {
  createRecoveryStore,
  recoveryValues,
  type RecoverySnapshot,
} from "../src/lib/browserRecovery";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  document.body.innerHTML = "";
});

const category = (
  name: string,
  parent = "",
  is_group = false,
  version = `${name}-v1`,
) => ({
  name,
  label: name,
  parent,
  is_group,
  version,
  lft: parent ? 2 : 1,
  rgt: parent ? 3 : 4,
});

function setup(call: ReturnType<typeof vi.fn>, recovery?: RecoverySnapshot) {
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "unit-site",
    capabilities: { "Item Group": { create: true, write: true, delete: true } },
  });
  if (recovery)
    createRecoveryStore(reference.site, reference.user, localStorage).save(
      recovery,
    );
  let controller!: ReturnType<typeof useCategoriesController>;
  const child = defineComponent({
    setup() {
      controller = useCategoriesController();
      return () => h(CategoriesPage, { controller });
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(child);
    },
  });
  const wrapper = mount(root, { attachTo: document.body });
  wrappers.push(wrapper);
  return { wrapper, controller, reference };
}

function dialog() {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')!;
}

function editRecovery(name = "CAT-A", version = "CAT-A-v1"): RecoverySnapshot {
  return {
    schema: 1,
    site: "unit-site",
    account: "volunteer",
    tabId: "recovery-tab",
    editorId: "recovery-category",
    editorKind: "Item Group",
    revision: 4,
    updatedAt: "2026-10-19T10:00:00.000Z",
    pendingUploadReselection: false,
    values: recoveryValues({
      form: { label: "CAT-A 的本地改名", parent: "", is_group: false },
      editing: { name, version },
    }),
  };
}

describe("category management", () => {
  it("uses the shared accessible search field", async () => {
    const { wrapper } = setup(vi.fn(async () => []));
    await flushPromises();
    const search = wrapper.find(".shared-search-field input");
    expect(search.attributes("aria-label")).toBe("搜索分类");
    expect(wrapper.find(".category-tools > label.preview-field").exists()).toBe(
      false,
    );
  });
  it("creates a root category and separates successful mutation from failed list refresh", async () => {
    let treeReads = 0;
    const call = vi.fn(async (endpoint: string, args: Record<string, any>) => {
      if (endpoint === "catalog.category_tree") {
        treeReads++;
        if (treeReads > 1) throw new Error("分类列表暂不可用");
        return [];
      }
      if (endpoint === "catalog.create_category")
        return { ...category("新类别", args.parent || ""), version: "v2" };
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { wrapper } = setup(call);
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "新建分类")!
      .trigger("click");
    await flushPromises();
    const editor = dialog();
    const name = editor.querySelector<HTMLInputElement>(
      '.dialog-content input:not([type="checkbox"])',
    )!;
    name.value = "新类别";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await Array.from(editor.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("保存"))!
      .click();
    await flushPromises();
    expect(call).toHaveBeenCalledWith(
      "catalog.create_category",
      expect.objectContaining({ parent: null, is_group: false }),
    );
    expect(document.body.textContent).toContain("类别已创建");
    expect(document.body.textContent).toContain("分类列表暂不可用");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "重新读取分类")!
      .trigger("click");
    await flushPromises();
    expect(
      call.mock.calls.filter(
        ([endpoint]) => endpoint === "catalog.create_category",
      ),
    ).toHaveLength(1);
  });

  it("shows native delete guards and does not retry a failed delete automatically", async () => {
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint === "catalog.category_tree") return [category("CAT-A")];
      if (endpoint === "catalog.delete_category")
        throw new Error("类别仍被物品 ITEM-A 引用");
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { wrapper } = setup(call);
    await flushPromises();
    const row = wrapper
      .findAll(".category-row")
      .find((element) => element.text().includes("CAT-A"))!;
    await row.get('[aria-label="分类操作"]').trigger("click");
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(".popup-menu-panel button"),
    )
      .find((button) => button.textContent?.trim() === "删除")!
      .click();
    await flushPromises();
    await Array.from(dialog().querySelectorAll("button"))
      .find((button) => button.textContent?.includes("确认删除"))!
      .click();
    await flushPromises();
    expect(call).toHaveBeenCalledWith("catalog.delete_category", {
      name: "CAT-A",
      version: "CAT-A-v1",
    });
    expect(document.body.textContent).toContain("类别仍被物品 ITEM-A 引用");
    expect(
      call.mock.calls.filter(
        ([endpoint]) => endpoint === "catalog.delete_category",
      ),
    ).toHaveLength(1);
  });

  it("edits a parent without turning an unchanged category name into a rename", async () => {
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint === "catalog.category_tree")
        return [category("PARENT", "", true), category("CHILD", "PARENT")];
      if (endpoint === "catalog.save_category")
        return category("CHILD", "PARENT", true);
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { controller } = setup(call);
    await flushPromises();
    const child = controller.categories.value.find(
      (row) => row.name === "CHILD",
    )!;
    controller.openEdit(child);
    controller.form.value.parent = "";
    await controller.save();
    expect(call).toHaveBeenCalledWith(
      "catalog.save_category",
      expect.objectContaining({
        name: "CHILD",
        version: "CHILD-v1",
        data: { label: "CHILD", parent: "", is_group: false },
      }),
    );
  });

  it("ignores a stale category-list response after the account changes", async () => {
    let resolveOld!: (value: ReturnType<typeof category>[]) => void;
    let reads = 0;
    const call = vi.fn((endpoint: string) => {
      if (endpoint !== "catalog.category_tree")
        return Promise.reject(new Error("unexpected"));
      reads++;
      return reads === 1
        ? new Promise<ReturnType<typeof category>[]>(
            (resolve) => (resolveOld = resolve),
          )
        : Promise.resolve([category("NEW-ACCOUNT")]);
    });
    const { wrapper, controller, reference } = setup(call);
    reference.user = "other-volunteer";
    await flushPromises();
    resolveOld([category("OLD-ACCOUNT")]);
    await flushPromises();
    expect(controller.categories.value.map((row) => row.name)).toEqual([
      "NEW-ACCOUNT",
    ]);
    expect(wrapper.text()).toContain("NEW-ACCOUNT");
    expect(wrapper.text()).not.toContain("OLD-ACCOUNT");
  });

  it("stages edit discard and route-leave confirmations in one dialog", async () => {
    const call = vi.fn(async (endpoint: string) => {
      if (endpoint === "catalog.category_tree") return [category("CAT-A")];
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { wrapper, controller } = setup(call);
    await flushPromises();
    controller.openEdit(controller.categories.value[0]!);
    controller.form.value.label = "Unsaved label";
    await flushPromises();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    await Array.from(dialog().querySelectorAll("button"))
      .find((button) => button.textContent?.includes("取消"))!
      .click();
    await flushPromises();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog().textContent).toContain("放弃分类输入");
    await Array.from(dialog().querySelectorAll("button"))
      .find((button) => button.textContent?.includes("继续编辑"))!
      .click();
    await flushPromises();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog().textContent).toContain("编辑分类");
    const nameField = dialog().querySelector<HTMLInputElement>(
      "[data-category-name]",
    )!;
    expect(nameField.value).toBe("Unsaved label");
    expect(document.activeElement).toBe(nameField);

    const pending = controller.requestLeave();
    await flushPromises();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog().textContent).toContain("离开分类编辑");
    await Array.from(dialog().querySelectorAll("button"))
      .find((button) => button.textContent?.includes("继续编辑"))!
      .click();
    await pending;
    await flushPromises();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog().textContent).toContain("编辑分类");
  });

  it("recovers an edit against its native identity and version", async () => {
    const call = vi.fn(async (endpoint: string, args: Record<string, any>) => {
      if (endpoint === "catalog.category_tree") return [category("CAT-A")];
      if (endpoint === "catalog.save_category")
        return {
          ...category(args.name, args.data.parent, args.data.is_group),
          version: "v2",
        };
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { wrapper, controller } = setup(call, editRecovery());
    await flushPromises();
    await controller.recover(editRecovery());
    await flushPromises();
    expect(controller.editing.value?.name).toBe("CAT-A");
    expect(dialog().textContent).toContain("编辑分类");
    await Array.from(dialog().querySelectorAll("button"))
      .find((button) => button.textContent?.includes("保存"))!
      .click();
    await flushPromises();
    expect(call).toHaveBeenCalledWith(
      "catalog.save_category",
      expect.objectContaining({
        name: "CAT-A",
        version: "CAT-A-v1",
        data: { label: "CAT-A 的本地改名", parent: "", is_group: false },
      }),
    );
    expect(
      call.mock.calls.filter(
        ([endpoint]) => endpoint === "catalog.create_category",
      ),
    ).toHaveLength(0);
  });

  it.each([
    {
      label: "deleted",
      initial: [category("CAT-A")],
      refreshed: [] as ReturnType<typeof category>[],
    },
    {
      label: "changed",
      initial: [category("CAT-A")],
      refreshed: [category("CAT-A", "", false, "CAT-A-v2")],
    },
  ])(
    "retains a $label edit recovery without converting it to a create",
    async ({ initial, refreshed }) => {
      let treeReads = 0;
      const call = vi.fn(async (endpoint: string) => {
        if (endpoint === "catalog.category_tree") {
          treeReads++;
          return treeReads === 1 ? initial : refreshed;
        }
        throw new Error(`Unexpected ${endpoint}`);
      });
      const { wrapper, controller } = setup(call, editRecovery());
      await flushPromises();
      await controller.recover(editRecovery());
      await flushPromises();
      expect(controller.dialog.value).toBe(false);
      expect(treeReads).toBe(2);
      expect(wrapper.text()).not.toContain("此浏览器有未完成输入");
      expect(controller.recoveryConflict.value).toContain(
        refreshed.length ? "已更改" : "已删除",
      );
      expect(wrapper.text()).toContain(controller.recoveryConflict.value);
      expect(
        call.mock.calls.some(([endpoint]) =>
          ["catalog.save_category", "catalog.create_category"].includes(
            endpoint,
          ),
        ),
      ).toBe(false);
    },
  );
});
