// @vitest-environment jsdom
import { useLinkedActivity } from "../src/features/activities/useLinkedActivity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
  type ReferenceData,
} from "../src/services/contracts";
import {
  useActivityEditor,
  type NativeActivity,
} from "../src/features/activities/useActivityEditor";
import { useReferenceCreation } from "../src/features/references/useReferenceCreation";
import { resolveConfirm } from "../src/services/confirm";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
});
function setup<T>(call: InventoryServices["call"], create: () => T) {
  let controller!: T;
  const reference = createReferenceData();
  reference.site = "unit-site";
  reference.user = "volunteer";
  reference.activityTypes = [
    { value: "TYPE-A", label: "活动", enabled: true },
    { value: "TYPE-DISABLED", label: "停用", enabled: false },
  ];
  reference.categories = [{ name: "ROOT", label: "全部", is_group: true }];
  const child = defineComponent({
    setup() {
      controller = create();
      return () => h("div");
    },
  });
  const parent = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(child);
    },
  });
  wrappers.push(mount(parent));
  return { controller, reference };
}
function activity(overrides: Partial<NativeActivity> = {}): NativeActivity {
  return {
    name: "IMMUTABLE-A",
    title: "原活动",
    activity_type: "TYPE-A",
    status: "Active",
    start_date: "",
    end_date: "",
    description: "",
    notes: "第一段\n\n<b>纯文本</b>",
    modified: "v1",
    creation: "2026-10-16",
    owner: "Administrator",
    modified_by: "Administrator",
    ...overrides,
  };
}

describe("native Activity editing", () => {
  it("marks required activity fields before submitting", async () => {
    const call = vi.fn();
    const { controller } = setup(call as InventoryServices["call"], () =>
      useActivityEditor({}, vi.fn()),
    );
    await flushPromises();
    await controller.save();
    expect(controller.validation.errors["activity-title"]).toBe(
      "请输入活动名称",
    );
    expect(controller.validation.errors["activity-type"]).toBe(
      "请选择活动类型",
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps the native identity and version when renaming and preserves multiline plain notes", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(activity())
      .mockResolvedValueOnce(
        activity({ title: "改名后的活动", modified: "v2" }),
      );
    const saved = vi.fn();
    const { controller, reference } = setup(call, () =>
      useActivityEditor({ activityId: "IMMUTABLE-A" }, saved),
    );
    await flushPromises();
    controller.input.title = "改名后的活动";
    await controller.save();
    expect(call).toHaveBeenLastCalledWith("activities.save_activity", {
      name: "IMMUTABLE-A",
      version: "v1",
      data: expect.objectContaining({
        title: "改名后的活动",
        notes: "第一段\n\n<b>纯文本</b>",
      }),
    });
    expect(saved).toHaveBeenCalledWith("IMMUTABLE-A");
    expect(reference.activities).toContainEqual(
      expect.objectContaining({ value: "IMMUTABLE-A", label: "改名后的活动" }),
    );
  });
  it("keeps input for copy and blocks stale resubmission after another editor changes the record", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(activity())
      .mockRejectedValueOnce(
        Object.assign(new Error("Desk 已更改活动"), {
          kind: "TimestampMismatchError",
        }),
      );
    const saved = vi.fn();
    const { controller } = setup(call, () =>
      useActivityEditor({ activityId: "IMMUTABLE-A" }, saved),
    );
    await flushPromises();
    controller.input.title = "我的未保存修改";
    await controller.save();
    expect(controller.conflict.value).toBe(true);
    expect(controller.recoveryText.value).toContain("我的未保存修改");
    expect(saved).not.toHaveBeenCalled();
    await controller.save();
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("cannot turn a forbidden or deleted edit target into a newly created Activity", async () => {
    const call = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("不可访问"), { kind: "DoesNotExistError" }),
      );
    const { controller } = setup(call, () =>
      useActivityEditor({ activityId: "DELETED" }, vi.fn()),
    );
    await flushPromises();
    controller.input.title = "不应新建";
    controller.input.typeId = "TYPE-A";
    await controller.save();
    expect(controller.writable.value).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("allows retaining a disabled type only for the existing Activity", async () => {
    const call = vi
      .fn()
      .mockResolvedValue(activity({ activity_type: "TYPE-DISABLED" }));
    const { controller } = setup(call, () =>
      useActivityEditor({ activityId: "IMMUTABLE-A" }, vi.fn()),
    );
    await flushPromises();
    expect(controller.types.value.map((row) => row.value)).toEqual([
      "TYPE-A",
      "TYPE-DISABLED",
    ]);
    const fresh = setup(call, () => useActivityEditor({}, vi.fn()));
    expect(fresh.controller.types.value.map((row) => row.value)).toEqual([
      "TYPE-A",
    ]);
  });
});

describe("native supporting reference creation", () => {
  it("uses the exact chosen unit and integer setting only after successful native creation", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error("没有权限"))
      .mockResolvedValueOnce({ name: "箱", must_be_whole_number: true });
    const selected = vi.fn();
    const { controller, reference } = setup(call, () =>
      useReferenceCreation("unit", selected),
    );
    controller.name.value = "箱";
    controller.whole.value = true;
    controller.creating.value = true;
    await controller.create();
    expect(selected).not.toHaveBeenCalled();
    expect(reference.units).toEqual([]);
    expect(controller.name.value).toBe("箱");
    expect(controller.error.value).toBe("没有权限");
    await controller.create();
    expect(call).toHaveBeenLastCalledWith("catalog.create_uom", {
      label: "箱",
      display_label: "",
      must_be_whole_number: true,
    });
    expect(selected).toHaveBeenCalledWith("箱");
    expect(reference.units).toEqual([
      expect.objectContaining({ name: "箱", whole: true }),
    ]);
  });
  it("preserves the selected parent and group meaning for a new category", async () => {
    const call = vi.fn().mockResolvedValue({
      name: "服装",
      label: "服装",
      parent: "ROOT",
      is_group: true,
    });
    const selected = vi.fn();
    const { controller, reference } = setup(call, () =>
      useReferenceCreation("category", selected),
    );
    controller.name.value = "服装";
    controller.group.value = true;
    controller.parent.value = "ROOT";
    await controller.create();
    expect(call).toHaveBeenCalledWith("catalog.create_category", {
      label: "服装",
      parent: "ROOT",
      is_group: true,
    });
    expect(reference.categories).toContainEqual({
      name: "服装",
      label: "服装",
      parent: "ROOT",
      is_group: true,
    });
    expect(selected).toHaveBeenCalledWith("服装");
  });
});

describe("Activity browser recovery", () => {
  it("retains invalid multiline input locally and checks the current native version before applying recovered edits", async () => {
    const call = vi.fn().mockResolvedValue(activity());
    const { controller: c } = setup(call, () =>
      useActivityEditor({ activityId: "IMMUTABLE-A" }, vi.fn()),
    );
    await flushPromises();
    c.input.notes = "未保存\n\n保持段落";
    const snapshot = c.recovery.list().entries[0]!;
    expect(snapshot.values.notes).toBe("未保存\n\n保持段落");
    call.mockResolvedValue(activity({ modified: "changed" }));
    await c.recover(snapshot);
    expect(c.error.value).toContain("原活动已更改");
    expect(c.input.notes).toBe("未保存\n\n保持段落");
  });
  it("keeps newer Activity input while a native save is in flight", async () => {
    let resolve!: (value: NativeActivity) => void;
    const call = vi
      .fn()
      .mockResolvedValueOnce(activity())
      .mockImplementationOnce(
        () =>
          new Promise<NativeActivity>((done) => {
            resolve = done;
          }),
      );
    const saved = vi.fn();
    const { controller: c } = setup(call, () =>
      useActivityEditor({ activityId: "IMMUTABLE-A" }, saved),
    );
    await flushPromises();
    c.input.title = "保存时的标题";
    const pending = c.save();
    await flushPromises();
    c.input.notes = "等待期间补充";
    resolve(activity({ title: "保存时的标题", modified: "v2" }));
    await pending;
    expect(c.input.notes).toBe("等待期间补充");
    expect(saved).not.toHaveBeenCalled();
    expect(c.recovery.list().entries[0]?.baseVersion).toBe("v2");
  });
  it("uses the shared confirmation before leaving and retains the recovery draft", async () => {
    const { controller: c } = setup(vi.fn(), () =>
      useActivityEditor({}, vi.fn()),
    );
    await flushPromises();
    c.input.notes = "尚未填写名称";
    const leaving = c.requestLeave();
    resolveConfirm(false);
    expect(await leaving).toBe(false);
    const next = c.requestLeave();
    resolveConfirm(true);
    expect(await next).toBe(true);
    expect(c.recovery.list().entries).toHaveLength(1);
  });
});

describe("linked Activity resolution", () => {
  it("ignores stale resolutions when the link changes", async () => {
    const pending: Record<string, (value: unknown) => void> = {};
    const id = ref("A");
    const call = vi.fn(
      (_endpoint, args) =>
        new Promise((resolve) => {
          pending[String(args.name)] = resolve;
        }),
    );
    const { controller: label, reference } = setup(call, () =>
      useLinkedActivity(
        () => id.value,
        () => undefined,
      ),
    );
    id.value = "B";
    await flushPromises();
    pending.B!({ name: "B", title: "当前活动" });
    await flushPromises();
    pending.A!({ name: "A", title: "旧活动" });
    await flushPromises();
    expect(label.value).toBe("当前活动");
    expect(reference.activities).toEqual([{ value: "B", label: "当前活动" }]);
    expect(call.mock.calls[0]?.[2].aborted).toBe(true);
  });
  it("discards an in-flight title after an account switch", async () => {
    let finish!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { controller: label, reference } = setup(call, () =>
      useLinkedActivity(
        () => "A",
        () => undefined,
      ),
    );
    reference.user = "another-account";
    finish({ name: "A", title: "前一账户的活动" });
    await flushPromises();
    expect(label.value).toBe("活动暂不可用");
    expect(reference.activities).toEqual([]);
  });
  it("rechecks renames and revoked access on focus/session restoration and cleans up", async () => {
    const call = vi.fn().mockResolvedValue({ name: "A", title: "原活动" });
    const { controller: label, reference } = setup(call, () =>
      useLinkedActivity(
        () => "A",
        () => undefined,
      ),
    );
    await flushPromises();
    expect(label.value).toBe("原活动");
    reference.activities[0]!.label = "本页已保存的改名";
    expect(label.value).toBe("本页已保存的改名");
    call.mockRejectedValueOnce(new Error("PermissionError"));
    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(label.value).toBe("活动暂不可用");
    call.mockResolvedValue({ name: "A", title: "服务器改名" });
    document.dispatchEvent(new Event("inventory-session-restored"));
    await flushPromises();
    expect(label.value).toBe("服务器改名");
    wrappers.at(-1)!.unmount();
    call.mockClear();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("inventory-session-restored"));
    await flushPromises();
    expect(call).not.toHaveBeenCalled();
  });
});
