import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import {
  api,
  workspaceApi,
  upload,
  labels,
  roomFor,
  sessionExpired,
} from "../../lib/api";
import { warehousePresentation } from "../../lib/warehousePresenter";
import { SaveQueue } from "../../lib/autosave";
import { toast } from "../../lib/toast";
import { returnToOpener } from "../../lib/navigation";

export function useWorkspaceController() {
  const route = useRoute(),
    router = useRouter();
  const boot = ref<any>(),
    record = ref<any>(),
    form = ref<any>(),
    error = ref(""),
    saveStatus = ref("正在加载…");
  const dirty = ref(false),
    conflict = ref(false),
    saving = ref(false),
    confirming = ref(false);
  const picker = ref(false),
    loanPicker = ref(false),
    scanner = ref(false),
    unknown = ref(""),
    scanBusy = ref(false),
    recentScans = ref<string[]>([]);
  const catalog = ref<Record<string, any>>({}),
    activities = ref<any[]>([]);
  const seedQueue = ref<any[]>([]);
  const review = ref(false),
    activityDialog = ref(false),
    activitySearch = ref(""),
    detailsOpen = ref(false);
  const currentRoom = ref(""),
    currentLocation = ref(""),
    currentTo = ref(""),
    lastScannedWarehouse = ref(""),
    scopeGroup = ref("");
  const chosen = ref<any>(),
    line = ref<any>(),
    editingIndex = ref(-1),
    batchRows = ref<any[]>([]);
  const activity = ref({
    title: "",
    activity_type: "Other",
    start_date: "",
    end_date: "",
    description: "",
  });
  const activityTypeLabel = (t: string) =>
    (
      ({
        Distribution: "分发",
        Event: "活动",
        Performance: "演出",
        "Religious Activity": "宗教活动",
        Maintenance: "维护",
        Other: "其他",
      }) as any
    )[t] || t;
  const newRequestId = ref("");
  let applying = false,
    editVersion = 0;

  const readonly = computed(
    () => !!record.value?.docstatus || !!record.value?.direct_entry,
  );
  const tree = computed<any[]>(() => boot.value?.warehouse_tree || []);
  const allowed = computed<any[]>(
    () => boot.value?.warehouses || boot.value?.physical_warehouses || [],
  );
  const inScope = (name: string) => {
    if (!scopeGroup.value) return true;
    const group = tree.value.find(
      (node: any) => node.name === scopeGroup.value,
    );
    const node = tree.value.find((item: any) => item.name === name);
    return Boolean(
      group &&
      node &&
      Number(node.lft) >= Number(group.lft) &&
      Number(node.rgt) <= Number(group.rgt),
    );
  };
  const scopedAllowed = computed(() =>
    allowed.value.filter((w) => inScope(w.name)),
  );
  const rooms = computed(() => {
    const names = new Set(
      scopedAllowed.value.map((w) => roomFor(w.name, tree.value)),
    );
    return [...names]
      .map((name) => tree.value.find((w) => w.name === name))
      .filter(Boolean);
  });
  const locations = computed(() =>
    scopedAllowed.value.filter(
      (w) =>
        !currentRoom.value || roomFor(w.name, tree.value) === currentRoom.value,
    ),
  );
  const isReceive = computed(() => form.value?.movement_kind === "Receive");
  const isIssue = computed(() =>
    ["Issue", "Loss", "Disposal"].includes(form.value?.movement_kind),
  );
  const isTransfer = computed(() =>
    ["Transfer", "Loan", "Return", "Damage", "Repair"].includes(
      form.value?.movement_kind,
    ),
  );
  const postingTimeMode = computed(
    () => form.value?.posting_time_mode || "current",
  );
  const groups = computed(() => {
    const result: Record<
      string,
      { room: string; location: string; lines: any[]; first: number }
    > = {};
    for (const section of form.value?.sections || [])
      result[section.warehouse] ||= {
        room: roomFor(section.warehouse, tree.value),
        location: section.warehouse,
        lines: [],
        first: Number.MAX_SAFE_INTEGER,
      };
    for (const [index, row] of (form.value?.items || []).entries()) {
      const location = isReceive.value
        ? row.warehouse
        : row.from_warehouse || row.warehouse;
      if (!location) continue;
      result[location] ||= {
        room: roomFor(location, tree.value),
        location,
        lines: [],
        first: index,
      };
      result[location].lines.push({ ...row, index });
      result[location].first = Math.min(result[location].first, index);
    }
    return Object.values(result).sort((a, b) => a.first - b.first);
  });
  const totals = computed(() => {
    const result: Record<string, number> = {};
    for (const row of form.value?.items || [])
      result[row.uom] = (result[row.uom] || 0) + Number(row.qty || 0);
    return result;
  });
  const lineStockEquivalent = computed(() => {
    if (!chosen.value || !line.value || !(Number(line.value.qty) > 0))
      return null;
    const factor =
      line.value.uom === chosen.value.stock_uom
        ? 1
        : Number(
            chosen.value.uoms.find((row: any) => row.uom === line.value.uom)
              ?.conversion_factor || 0,
          );
    return factor ? Number(line.value.qty) * factor : null;
  });
  const sourceOptions = computed(() => {
    const names = new Set(allowed.value.map((w) => w.name));
    return (chosen.value?.stock || []).filter(
      (row: any) => names.has(row.warehouse) && Number(row.actual_qty) > 0,
    );
  });
  const label = (name: string) =>
    warehousePresentation(name, tree.value).breadcrumb;
  const leafLabel = (name: string) =>
    warehousePresentation(name, tree.value).localLabel;
  const requiredMark =
    '<span class="required-mark" aria-hidden="true">*</span><span class="sr-only">必填</span>';
  const today = () => {
    const value = new Date();
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  };
  const isExpiredDate = (value: string) => Boolean(value && value < today());

  function changed(immediate = false) {
    if (applying || readonly.value) return;
    editVersion++;
    dirty.value = true;
    saveStatus.value = "尚未保存";
    queue.schedule(immediate);
  }
  function invalidate() {}
  function markManualTime() {
    if (form.value && form.value.posting_time_mode !== "manual")
      form.value.posting_time_mode = "manual";
  }
  function setCurrentTime() {
    if (!form.value) return;
    const now = new Date(),
      pad = (n: number) => String(n).padStart(2, "0");
    form.value.posting_date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    form.value.posting_time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    form.value.posting_time_mode = "current";
    changed(true);
  }
  watch(form, () => changed(), { deep: true, flush: "sync" });

  async function adoptWorkspaceRoute(name: string, movementKind: string) {
    try {
      const failure = await router.replace(`/workspace/${name}`);
      if (!failure) sessionStorage.removeItem(`ti-new:${movementKind}`);
      else if (!dirty.value)
        error.value = "已保存，但无法打开记录页面，请刷新重试";
    } catch (e: any) {
      error.value = e?.message || "已保存，但无法打开记录页面，请刷新重试";
    }
  }
  function close() {
    void returnToOpener(router, "/movements");
  }

  const queue = new SaveQueue(
    async () => {
      if (!record.value || readonly.value) return;
      saving.value = true;
      saveStatus.value = record.value.name ? "正在保存…" : "正在创建草稿…";
      const version = editVersion,
        creating = !record.value.name;
      try {
        const payload = JSON.parse(JSON.stringify(form.value));
        const result = record.value.name
          ? await workspaceApi("save_workspace", {
              name: record.value.name,
              revision: record.value.revision,
              data: payload,
            })
          : await workspaceApi("create_workspace", {
              request_id: newRequestId.value,
              movement_kind: payload.movement_kind,
              data: payload,
            });
        record.value = result;
        if (version === editVersion) {
          applying = true;
          form.value = result.data;
          applying = false;
          dirty.value = false;
          saveStatus.value = "✓ 已保存";
        } else saveStatus.value = "尚未保存";
        if (creating && route.path.startsWith("/new/"))
          void adoptWorkspaceRoute(result.name, payload.movement_kind);
      } finally {
        saving.value = false;
      }
    },
    (e) => {
      error.value = e.message;
      saveStatus.value = "⚠ 尚未保存";
      if (e.kind === "TimestampMismatchError") conflict.value = true;
    },
    () => sessionExpired.value || conflict.value,
  );

  async function hydrate() {
    for (const row of form.value.items || [])
      if (!catalog.value[row.item_code]) {
        try {
          catalog.value[row.item_code] = await workspaceApi("item_detail", {
            item_code: row.item_code,
          });
        } catch (e: any) {
          error.value = e.message;
        }
      }
  }
  async function load() {
    try {
      boot.value = await api("bootstrap");
      activities.value = await workspaceApi("activities");
      let scopedWarehouse = "";
      let d: any;
      if (route.params.name)
        d = await workspaceApi("load_workspace", { name: route.params.name });
      else if (route.params.entry)
        d = await workspaceApi("open_entry", { name: route.params.entry });
      else {
        const kind = String(route.params.kind || "Receive"),
          key = sessionStorage.getItem(`ti-new:${kind}`) || crypto.randomUUID();
        const scopeKey = `ti-scope:${kind}`;
        const scope = sessionStorage.getItem(scopeKey);
        if (scope) {
          try {
            const parsedScope = JSON.parse(scope);
            scopeGroup.value = parsedScope.group || "";
            scopedWarehouse = parsedScope.warehouse || "";
          } catch {
            scopeGroup.value = "";
          }
          sessionStorage.removeItem(scopeKey);
        }
        sessionStorage.setItem(`ti-new:${kind}`, key);
        newRequestId.value = key;
        const now = new Date(),
          pad = (n: number) => String(n).padStart(2, "0");
        d = {
          name: "",
          revision: 0,
          stock_entry: null,
          docstatus: 0,
          sync_error: "",
          attachments: [],
          data: {
            movement_kind: kind,
            posting_date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
            posting_time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
            posting_time_mode: "current",
            handler_name: "",
            recorder_name: "",
            activity: "",
            notes: "",
            source_text: "",
            purpose_text: "",
            borrower: "",
            recorded_by: boot.value.user,
            reviewer_name: "",
            loan_record: "",
            return_record: "",
            loss_record: "",
            items: [],
            sections: [],
            from_warehouse: "",
            to_warehouse: "",
          },
        };
        if (kind === "Loss" && route.query.loan_item) {
          const candidates = await api("outstanding_loan_items");
          const row = candidates.find(
            (candidate: any) => candidate.loan_item === route.query.loan_item,
          );
          if (row)
            d.data.items = [
              {
                id: crypto.randomUUID(),
                item_code: row.item_code,
                qty: row.outstanding,
                uom: row.uom,
                batch_no: row.batch_no || "",
                original_loan_item: row.loan_item,
                loan_item: row.loan_item,
                warehouse: boot.value.settings.loan_warehouse,
                from_warehouse: boot.value.settings.loan_warehouse,
              },
            ];
        }
      }
      record.value = d;
      applying = true;
      form.value = d.data;
      applying = false;
      dirty.value = false;
      conflict.value = false;
      saveStatus.value = d.name ? "✓ 已保存" : "正在创建草稿…";
      const physical = scopedAllowed.value.length
        ? scopedAllowed.value
        : allowed.value;
      const requestedLocation = String(
        route.query.warehouse || scopedWarehouse || "",
      );
      currentLocation.value = physical.some(
        (row: any) => row.name === requestedLocation,
      )
        ? requestedLocation
        : physical[0]?.name || "";
      if (isIssue.value && currentLocation.value)
        lastScannedWarehouse.value = currentLocation.value;
      currentRoom.value = roomFor(currentLocation.value, tree.value);
      currentTo.value =
        boot.value.settings.loan_warehouse ||
        boot.value.settings.leased_warehouse ||
        boot.value.settings.default_lease_program_warehouse ||
        "";
      if (!d.name) {
        const unknownBarcode =
          sessionStorage.getItem("ti-unknown-barcode") || "";
        if (unknownBarcode && d.data.movement_kind === "Receive") {
          unknown.value = unknownBarcode;
          sessionStorage.removeItem("ti-unknown-barcode");
          picker.value = true;
        }
        const seed = sessionStorage.getItem(`ti-seed:${d.data.movement_kind}`);
        if (seed) {
          try {
            const parsed = JSON.parse(seed);
            seedQueue.value = await Promise.all(
              (parsed.items || []).map(async (entry: any) => {
                const itemCode =
                  typeof entry === "string" ? entry : entry.item_code;
                const detail = await workspaceApi("item_detail", {
                  item_code: itemCode,
                });
                catalog.value[itemCode] = detail;
                return { ...entry, item_code: itemCode, detail };
              }),
            );
          } catch (cause: any) {
            error.value = cause.message || "无法恢复预选物品";
          }
        }
      }
      await hydrate();
      // Opening a flow is not a business edit.  The first meaningful change
      // enters the existing serialized queue and creates the workspace then.
      saveStatus.value = d.name ? "✓ 已保存" : "尚未保存";
    } catch (e: any) {
      error.value = e.message;
      saveStatus.value = "加载失败";
    }
  }
  async function selectLoanItem(row: any) {
    try {
      const item =
        row.detail ||
        catalog.value[row.item_code] ||
        (await workspaceApi("item_detail", { item_code: row.item_code }));
      catalog.value[row.item_code] = item;
      loanPicker.value = false;
      picker.value = false;
      editingIndex.value = -1;
      chosen.value = item;
      line.value = {
        id: crypto.randomUUID(),
        item_code: row.item_code,
        qty: row.outstanding,
        uom: row.uom,
        batch_no: row.batch_no || "",
        loan_item: row.loan_item,
        original_loan_item: row.loan_item,
        from_warehouse: boot.value.settings.loan_warehouse,
        to_warehouse: row.original_warehouse,
        outcome: "Returned",
        warehouse: boot.value.settings.loan_warehouse,
      };
      form.value.borrower = row.borrower;
      form.value.activity = row.activity || "";
      changed(true);
      await loadBatches();
      return true;
    } catch (cause: any) {
      error.value = cause.message || "无法加载物品详情";
      return false;
    }
  }
  async function configureSeed(seed: any) {
    if (seed.loan_item && !(await selectLoanItem(seed))) return;
    if (!seed.loan_item)
      await selectItem(seed.detail || catalog.value[seed.item_code]);
    seedQueue.value = seedQueue.value.filter((item) => item !== seed);
  }
  async function selectItem(item: any) {
    if (isIssue.value) {
      const stock = (item.stock || []).filter(
        (row: any) =>
          allowed.value.some((w) => w.name === row.warehouse) &&
          Number(row.actual_qty) > 0,
      );
      const preferred =
        lastScannedWarehouse.value &&
        stock.find((row: any) => row.warehouse === lastScannedWarehouse.value);
      if (lastScannedWarehouse.value && !preferred) {
        error.value = `该物品在${label(lastScannedWarehouse.value)}没有库存`;
        return;
      }
      if (!stock.length) {
        error.value = "该物品没有可用库存";
        return;
      }
      item = { ...item, stock };
      catalog.value[item.item_code] = item;
      chosen.value = item;
      picker.value = false;
      unknown.value = "";
      editingIndex.value = -1;
      const warehouse =
        preferred?.warehouse || (stock.length === 1 ? stock[0].warehouse : "");
      line.value = {
        id: crypto.randomUUID(),
        item_code: item.item_code,
        qty: null,
        uom: item.stock_uom,
        warehouse,
        from_warehouse: warehouse,
        to_warehouse: currentTo.value,
        batch_no: "",
        new_batch: false,
      };
    } else {
      catalog.value[item.item_code] = item;
      chosen.value = item;
      picker.value = false;
      unknown.value = "";
      editingIndex.value = -1;
      line.value = {
        id: crypto.randomUUID(),
        item_code: item.item_code,
        qty: null,
        uom: item.stock_uom,
        warehouse: currentLocation.value,
        from_warehouse: currentLocation.value,
        to_warehouse:
          form.value.movement_kind === "Loan"
            ? boot.value.settings.loan_warehouse ||
              boot.value.settings.leased_warehouse ||
              boot.value.settings.default_lease_program_warehouse
            : form.value.movement_kind === "Damage"
              ? boot.value.settings.damaged_warehouse
              : currentTo.value,
        batch_no: "",
        new_batch: false,
      };
    }
    await loadBatches();
  }
  async function editLine(index: number) {
    editingIndex.value = index;
    line.value = JSON.parse(JSON.stringify(form.value.items[index]));
    chosen.value =
      catalog.value[line.value.item_code] ||
      (await workspaceApi("item_detail", { item_code: line.value.item_code }));
    await loadBatches();
  }
  async function loadBatches() {
    if (!chosen.value?.has_batch_no || !line.value) return;
    try {
      batchRows.value = await workspaceApi("batches", {
        item_code: chosen.value.item_code,
        warehouse: isReceive.value
          ? undefined
          : line.value.from_warehouse || line.value.warehouse,
      });
    } catch (e: any) {
      error.value = e.message;
    }
  }
  async function scan(value: string) {
    if (scanBusy.value || chosen.value) return;
    scanBusy.value = true;
    try {
      const d = await api("scan", { value });
      if (d.unknown) {
        unknown.value = value;
        picker.value = true;
      } else if (d.item_code) {
        const detail = await workspaceApi("item_detail", {
          item_code: d.item_code,
        });
        if (
          isIssue.value &&
          lastScannedWarehouse.value &&
          !(detail.stock || []).some(
            (row: any) =>
              row.warehouse === lastScannedWarehouse.value &&
              Number(row.actual_qty) > 0,
          )
        ) {
          error.value = `该物品在${label(lastScannedWarehouse.value)}没有库存`;
          return;
        }
        await selectItem(detail);
        if (d.batch_no) line.value.batch_no = d.batch_no;
      } else if (d.warehouse) {
        if (
          isIssue.value &&
          !allowed.value.some((w) => w.name === d.warehouse)
        ) {
          error.value = "该仓库不能用于出库";
          return;
        }
        lastScannedWarehouse.value = d.warehouse;
        currentLocation.value = d.warehouse;
        currentRoom.value = roomFor(d.warehouse, tree.value);
      }
    } catch (e: any) {
      error.value = e.message;
    } finally {
      scanBusy.value = false;
    }
  }
  function addLine() {
    if (!line.value || !(Number(line.value.qty) > 0)) return;
    if (isIssue.value) {
      const source = sourceOptions.value.find(
        (row: any) => row.warehouse === line.value.from_warehouse,
      );
      if (!source) {
        error.value = "请选择有库存的来源仓库";
        return;
      }
      const conversion =
        line.value.uom === chosen.value.stock_uom
          ? 1
          : Number(
              chosen.value.uoms.find((u: any) => u.uom === line.value.uom)
                ?.conversion_factor || 0,
            );
      const existing = (form.value.items || [])
        .filter(
          (row: any) =>
            row.item_code === line.value.item_code &&
            (row.from_warehouse || row.warehouse) === line.value.from_warehouse,
        )
        .reduce(
          (sum: number, row: any) =>
            sum +
            Number(row.qty || 0) *
              (row.uom === chosen.value.stock_uom
                ? 1
                : Number(
                    chosen.value.uoms.find((u: any) => u.uom === row.uom)
                      ?.conversion_factor || 0,
                  )),
          0,
        );
      if (
        !conversion ||
        existing + Number(line.value.qty) * conversion >
          Number(source.actual_qty) + 1e-8
      ) {
        error.value = `数量超过${label(source.warehouse)}的可用库存`;
        return;
      }
    }
    invalidate();
    const row = { ...line.value };
    if (row.batch_no && !row.expiry_date) {
      const batch = batchRows.value.find(
        (candidate: any) => candidate.name === row.batch_no,
      );
      if (batch?.expiry_date) row.expiry_date = batch.expiry_date;
    }
    if (!isReceive.value) row.warehouse = row.from_warehouse;
    if (editingIndex.value >= 0)
      form.value.items.splice(editingIndex.value, 1, row);
    else form.value.items.unshift(row);
    currentLocation.value = isReceive.value
      ? row.warehouse
      : row.from_warehouse;
    currentRoom.value = roomFor(currentLocation.value, tree.value);
    currentTo.value = row.to_warehouse;
    recentScans.value.unshift(
      `${chosen.value.item_name} · ${row.qty} ${row.uom}`,
    );
    chosen.value = undefined;
    line.value = undefined;
    editingIndex.value = -1;
    error.value = "";
    changed(true);
  }
  function removeLine(index: number) {
    invalidate();
    form.value.items.splice(index, 1);
    changed(true);
  }
  async function attach(event: Event) {
    const input = event.target as HTMLInputElement;
    error.value = "";
    try {
      if (!record.value.name) {
        dirty.value = true;
        queue.schedule(true);
      }
      await queue.flush();
      if (dirty.value || !record.value.name) return;
      for (const file of Array.from(input.files || []))
        await upload(file, "Inventory Workspace", record.value.name);
      record.value = await workspaceApi("load_workspace", {
        name: record.value.name,
      });
    } catch (e: any) {
      error.value = e.message;
    } finally {
      input.value = "";
    }
  }
  async function uploadAttachmentFiles(files: File[]) {
    error.value = "";
    try {
      if (!record.value.name) {
        dirty.value = true;
        queue.schedule(true);
      }
      await queue.flush();
      if (dirty.value || !record.value.name) return;
      for (const file of files)
        await upload(file, "Inventory Workspace", record.value.name);
      record.value = await workspaceApi("load_workspace", {
        name: record.value.name,
      });
    } catch (e: any) {
      error.value = e.message;
    }
  }
  async function removeFile(name: string) {
    try {
      record.value = await workspaceApi("remove_attachment", {
        name: record.value.name,
        file_name: name,
      });
    } catch (e: any) {
      error.value = e.message;
    }
  }
  async function removeAttachmentFile(file: any) {
    await removeFile(file.name);
  }
  async function createActivity() {
    try {
      const d = await workspaceApi("create_activity", { data: activity.value });
      activities.value.unshift(d);
      invalidate();
      form.value.activity = d.name;
      activityDialog.value = false;
      changed(true);
    } catch (e: any) {
      error.value = e.message;
    }
  }
  async function showReview() {
    error.value = "";
    await queue.flush();
    if (dirty.value || conflict.value) {
      error.value = conflict.value
        ? "记录有冲突，请重新加载"
        : "请先保存所有修改";
      return;
    }
    if (!form.value.items?.length) {
      error.value = "请至少添加一个物品";
      return;
    }
    if (record.value.sync_error) {
      error.value = record.value.sync_error;
      return;
    }
    review.value = true;
  }
  async function confirm() {
    if (confirming.value) return;
    confirming.value = true;
    error.value = "";
    try {
      await queue.flush();
      if (dirty.value) throw new Error("请先保存所有修改");
      const d = await workspaceApi("confirm_workspace", {
        name: record.value.name,
        revision: record.value.revision,
      });
      record.value = d;
      applying = true;
      form.value = d.data;
      applying = false;
      review.value = false;
      scanner.value = false;
      saveStatus.value = "已完成 ✓";
      toast(`${labels[form.value.movement_kind]}已完成`);
      window.dispatchEvent(new Event("ti:refresh-shell"));
      if (form.value.movement_kind === "Return") {
        const outstanding = await api("outstanding_loan_items");
        const candidate = outstanding.find((row: any) => row.loan_item);
        if (
          candidate &&
          window.confirm("该借出明细仍有未结数量。是否继续记录遗失？")
        )
          await router.push(
            `/new/Loss?loan_item=${encodeURIComponent(candidate.loan_item)}`,
          );
      }
    } catch (e: any) {
      error.value = e.message;
      toast(e.message, "error");
    } finally {
      confirming.value = false;
    }
  }
  function beforeUnload(e: BeforeUnloadEvent) {
    if (dirty.value) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  watch(sessionExpired, (v) => {
    if (v) scanner.value = false;
    else if (dirty.value) queue.schedule(true);
  });
  async function deleteDraft() {
    if (
      !record.value?.name ||
      !window.confirm("确定删除这条未完成记录吗？此操作无法撤销。")
    )
      return;
    try {
      await queue.flush();
      await workspaceApi("delete_draft", { name: record.value.name });
      window.dispatchEvent(new Event("ti:refresh-shell"));
      await returnToOpener(router, "/movements?status=unfinished");
    } catch (e: any) {
      error.value = e.message;
    }
  }
  onBeforeRouteLeave(async () => {
    await queue.flush();
    if (dirty.value) return window.confirm("还有尚未保存的修改。确定离开？");
  });
  onMounted(() => {
    void load();
    window.addEventListener("beforeunload", beforeUnload);
  });
  onBeforeUnmount(() => {
    queue.dispose();
    window.removeEventListener("beforeunload", beforeUnload);
  });

  return {
    route,
    router,
    labels,
    sessionExpired,
    boot,
    record,
    form,
    error,
    saveStatus,
    dirty,
    conflict,
    saving,
    confirming,
    picker,
    loanPicker,
    scanner,
    unknown,
    scanBusy,
    recentScans,
    catalog,
    activities,
    seedQueue,
    review,
    activityDialog,
    activitySearch,
    detailsOpen,
    currentRoom,
    currentLocation,
    currentTo,
    lastScannedWarehouse,
    scopeGroup,
    chosen,
    line,
    editingIndex,
    batchRows,
    activity,
    activityTypeLabel,
    newRequestId,
    applying,
    editVersion,
    readonly,
    tree,
    allowed,
    inScope,
    scopedAllowed,
    rooms,
    locations,
    isReceive,
    isIssue,
    isTransfer,
    postingTimeMode,
    groups,
    totals,
    lineStockEquivalent,
    sourceOptions,
    label,
    leafLabel,
    requiredMark,
    today,
    isExpiredDate,
    changed,
    invalidate,
    markManualTime,
    setCurrentTime,
    adoptWorkspaceRoute,
    close,
    queue,
    hydrate,
    load,
    selectLoanItem,
    configureSeed,
    selectItem,
    editLine,
    loadBatches,
    scan,
    addLine,
    removeLine,
    attach,
    uploadAttachmentFiles,
    removeFile,
    removeAttachmentFile,
    createActivity,
    showReview,
    confirm,
    beforeUnload,
    deleteDraft,
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
