import { useUpdateBlocker } from "../../lib/updateSafety";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  createRecoveryStore,
  recoveryValues,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";
import { showToast } from "../../services/toast";
import { useFormValidation } from "../../composables/useFormValidation";
import { useConfirm } from "../../services/confirm";
export interface NativeActivity {
  name: string;
  title: string;
  activity_type: string;
  status: "Active" | "Archived";
  start_date: string;
  end_date: string;
  description: string;
  notes: string;
  modified: string;
  creation: string;
  owner: string;
  modified_by: string;
}
export function useActivityEditor(
  props: { activityId?: string; recoveryId?: string },
  saved: (activity: { name: string; title: string }) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const validation = useFormValidation();
  const existing = ref<NativeActivity>(),
    input = reactive({
      title: "",
      typeId: "",
      start: "",
      end: "",
      description: "",
      notes: "",
    });
  const loading = ref(false),
    busy = ref(false),
    error = ref(""),
    conflict = ref(false),
    recoveryError = ref(""),
    baseline = ref(JSON.stringify(input));
  let generation = 0,
    disposed = false,
    ready = false,
    discarded = false,
    revision = 0,
    allowLeave = false;
  let request: AbortController | undefined, storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Keep the open input usable. */
  }
  const recovery = createRecoveryStore(reference.site, account, storage),
    editorId = crypto.randomUUID(),
    tabId = crypto.randomUUID();
  const active = () => !disposed && account === reference.user;
  const dirty = computed(() => JSON.stringify(input) !== baseline.value);
  validation.register(
    "activity-title",
    () => input.title,
    [(v) => (v.trim() ? true : "请输入活动名称")],
    () => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
  validation.register(
    "activity-type",
    () => input.typeId,
    [(v) => (v ? true : "请选择活动类型")],
    () => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
  validation.register(
    "activity-start",
    () => input.start,
    [
      (v) =>
        !input.end || !v || v <= input.end ? true : "开始日期不能晚于结束日期",
    ],
    () => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
  validation.register(
    "activity-end",
    () => input.end,
    [
      (v) =>
        !v || !input.start || v >= input.start
          ? true
          : "结束日期不能早于开始日期",
    ],
    () => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
  const writable = computed(
    () => active() && (existing.value ? true : !props.activityId),
  );
  function retain() {
    if (!ready || !active() || discarded) return;
    revision++;
    const result = recovery.save({
      schema: 1,
      site: reference.site,
      account,
      tabId,
      editorId,
      editorKind: "Inventory Activity",
      baseVersion: existing.value?.modified,
      revision,
      updatedAt: new Date().toISOString(),
      pendingUploadReselection: false,
      values: recoveryValues({
        ...input,
        editingActivity: existing.value?.name || props.activityId || "",
        creating: !props.activityId,
      }),
    });
    recoveryError.value = result.error;
  }
  async function load() {
    const current = ++generation,
      name = props.activityId || existing.value?.name;
    request?.abort();
    ready = false;
    loading.value = true;
    error.value = "";
    conflict.value = false;
    try {
      if (name) {
        request = new AbortController();
        const result = await services.call<NativeActivity>(
          "activities.load_activity",
          { name },
          request.signal,
        );
        if (!active() || current !== generation) return;
        existing.value = result;
        Object.assign(input, {
          title: result.title,
          typeId: result.activity_type,
          start: result.start_date || "",
          end: result.end_date || "",
          description: result.description || "",
          notes: result.notes || "",
        });
      }
      baseline.value = JSON.stringify(input);
      recoveryError.value = recovery.list().error;
      ready = true;
      if (props.recoveryId) {
        const entry = recovery.read(props.recoveryId);
        if (entry?.editorKind === "Inventory Activity") await recover(entry);
        else
          recoveryError.value =
            "未找到这份浏览器暂存内容，请从草稿列表重新打开";
      }
    } catch (reason) {
      if (active() && current === generation)
        error.value = reason instanceof Error ? reason.message : "活动读取失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  async function recover(snapshot: RecoverySnapshot) {
    if (
      !active() ||
      snapshot.site !== reference.site ||
      snapshot.account !== account
    )
      return;
    const name = String(snapshot.values.editingActivity || "");
    if (props.activityId && name !== props.activityId) {
      error.value = "此输入属于其它活动";
      return;
    }
    if (name) {
      try {
        const current = await services.call<NativeActivity>(
          "activities.load_activity",
          { name },
        );
        if (!active()) return;
        if (current.modified !== snapshot.baseVersion) {
          error.value = "原活动已更改；请复制恢复文字后核对";
          return;
        }
        existing.value = current;
      } catch (reason) {
        error.value =
          reason instanceof Error ? reason.message : "原活动无法读取";
        return;
      }
    }
    ready = false;
    for (const key of Object.keys(input))
      if (key in snapshot.values)
        Object.assign(input, { [key]: snapshot.values[key] });
    ready = true;
    retain();
    recovery.remove(snapshot.editorId, snapshot.revision);
    showToast("已恢复上次在此浏览器暂存的内容");
  }
  async function save() {
    if (
      !active() ||
      busy.value ||
      loading.value ||
      !writable.value ||
      conflict.value
    )
      return;
    error.value = "";
    if (!validation.validate().ok) return;
    busy.value = true;
    error.value = "";
    const current = generation,
      sentRevision = revision,
      sent = JSON.stringify(input),
      wasExisting = Boolean(existing.value);
    try {
      const result = await services.call<NativeActivity>(
        "activities.save_activity",
        {
          data: {
            title: input.title,
            activity_type: input.typeId,
            start_date: input.start || null,
            end_date: input.end || null,
            description: input.description,
            notes: input.notes,
            status: existing.value?.status || "Active",
          },
          ...(existing.value
            ? { name: existing.value.name, version: existing.value.modified }
            : {}),
        },
      );
      if (!active() || current !== generation) return;
      existing.value = result;
      baseline.value = sent;
      const option = reference.activities.find(
        (row) => row.value === result.name,
      );
      if (option) option.label = result.title;
      else
        reference.activities.push({
          value: result.name,
          label: result.title,
          detail: result.name,
        });
      if (sentRevision !== revision) {
        retain();
        error.value = "已保存之前的输入，当前还有更新内容，请再次保存";
        return;
      }
      recovery.remove(editorId, sentRevision);
      showToast(wasExisting ? "活动资料已更新" : "活动已创建");
      saved({ name: result.name, title: result.title });
    } catch (reason) {
      if (!active() || current !== generation) return;
      error.value =
        reason instanceof Error ? reason.message : "活动保存失败，输入已保留";
      showToast(`活动保存失败：${error.value}`, "danger");
      conflict.value = [
        "TimestampMismatchError",
        "DoesNotExistError",
        "PermissionError",
      ].includes(String((reason as { kind?: string })?.kind));
      retain();
    } finally {
      if (active() && current === generation) busy.value = false;
    }
  }
  function discard() {
    discarded = true;
    recovery.remove(editorId, revision);
  }
  async function requestLeave(): Promise<boolean> {
    if (allowLeave || !dirty.value) return true;
    const confirm = useConfirm();
    const choice = await confirm.confirm({
      title: "离开活动编辑？",
      message: "未完成输入将保留在此浏览器。选择继续编辑可取消离开。",
      confirmLabel: "保留并离开",
      cancelLabel: "继续编辑",
      tone: "default",
    });
    if (choice) retain();
    allowLeave = choice;
    return choice;
  }
  async function reload() {
    if (!dirty.value) return load();
    const accepted = await useConfirm().confirm({
      title: "重新读取活动？",
      message: "重新读取会替换当前输入。",
      confirmLabel: "放弃输入并重新读取",
      tone: "danger",
    });
    if (accepted) {
      void load();
    }
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value && !discarded) {
      retain();
      event.preventDefault();
    }
  }
  if (typeof window !== "undefined")
    window.addEventListener("beforeunload", beforeUnload);
  watch(input, retain, { deep: true, flush: "sync" });
  watch(
    () => props.activityId,
    () => {
      void load();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (dirty.value && !discarded) retain();
    disposed = true;
    generation++;
    request?.abort();
    window.removeEventListener("beforeunload", beforeUnload);
  });
  const types = computed(() =>
    reference.activityTypes
      .filter(
        (row) =>
          row.enabled !== false || row.value === existing.value?.activity_type,
      )
      .map((row) => ({
        ...row,
        detail: row.enabled === false ? "已停用 · 保留原类型" : row.detail,
      })),
  );
  useUpdateBlocker(() => dirty.value || busy.value);

  return {
    input,
    existing,
    loading,
    busy,
    writable,
    error,
    conflict,
    save,
    load,
    types,
    reference,
    recoveryText: computed(() => JSON.stringify(input, null, 2)),
    dirty,
    recoveryError,
    recovery,
    recover,
    discard,
    requestLeave,
    reload,
    validation,
  };
}
