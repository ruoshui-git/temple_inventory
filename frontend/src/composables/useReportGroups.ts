import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type {
  DataTableEntry,
  DataTableGroup,
  DataTableRecord,
} from "../lib/dataTable";
import type { ReportQuery } from "../lib/reportContract";
import { movementLabels } from "../lib/filterPresentation";
import {
  useReferenceData,
  type GroupedReportRow,
  type GroupPage,
  type InventoryServices,
} from "../services/contracts";

interface GroupPageState {
  rows: GroupedReportRow[];
  next: number | null;
  loading: boolean;
  error: string;
  initialized: boolean;
  leafColumns: string[];
}

interface GroupSnapshot {
  loaded: Record<string, number>;
  expanded: Array<{ id: string; path: string[]; unit: string | null }>;
}

const groupSnapshots = new Map<string, GroupSnapshot>();

function pageKey(path: string[], unit?: string | null) {
  return JSON.stringify([path, unit ?? null]);
}

export function useReportGroups(
  query: Ref<ReportQuery>,
  services: InventoryServices,
  autoLoadRoot = true,
) {
  const reference = useReferenceData();
  let scopeIdentity = JSON.stringify([reference.site, reference.user]);
  let activeQueryKey = "";
  const pages = ref<Record<string, GroupPageState>>({});
  const expanded = ref(new Set<string>());
  const rootKey = pageKey([]);
  let generation = 0;
  const requests = new Map<string, AbortController>();
  let pendingRestore: { key: string; snapshot: GroupSnapshot } | undefined;
  const cacheKey = () =>
    JSON.stringify([reference.site, reference.user, query.value]);
  const stateFor = (path: string[], unit?: string | null) =>
    pages.value[pageKey(path, unit)];
  const current = (token: number) =>
    token === generation &&
    JSON.stringify([reference.site, reference.user]) === scopeIdentity;
  function cancel() {
    generation++;
    requests.forEach((request) => request.abort());
    requests.clear();
  }
  function remember(key = activeQueryKey) {
    if (!key || !Object.keys(pages.value).length) return;
    const nodes = new Map<
      string,
      { id: string; path: string[]; unit: string | null }
    >();
    Object.values(pages.value).forEach((page) =>
      page.rows.forEach((row) => {
        if (row.row_grain === "group")
          nodes.set(row.id, {
            id: row.id,
            path: [...(row.group_path || [])],
            unit: row.stock_uom || null,
          });
      }),
    );
    const snapshot: GroupSnapshot = {
      loaded: Object.fromEntries(
        Object.entries(pages.value).map(([key, page]) => [
          key,
          page.rows.length,
        ]),
      ),
      expanded: [...expanded.value].flatMap((id) => {
        const node = nodes.get(id);
        return node ? [node] : [];
      }),
    };
    groupSnapshots.delete(key);
    groupSnapshots.set(key, snapshot);
    while (groupSnapshots.size > 24)
      groupSnapshots.delete(groupSnapshots.keys().next().value!);
  }
  function restore(key: string) {
    const snapshot = groupSnapshots.get(key);
    if (!snapshot) return false;
    pages.value = {};
    expanded.value = new Set(snapshot.expanded.map((node) => node.id));
    pendingRestore = { key, snapshot };
    groupSnapshots.delete(key);
    groupSnapshots.set(key, snapshot);
    if (autoLoadRoot) void load([], null);
    return true;
  }
  async function load(
    path: string[],
    unit: string | null | undefined,
    more = false,
    refresh = false,
  ) {
    const key = pageKey(path, unit);
    let page = pages.value[key];
    if (!page) {
      pages.value[key] = {
        rows: [],
        next: 0,
        loading: false,
        error: "",
        initialized: false,
        leafColumns: [],
      };
      page = pages.value[key];
    }
    if (page.loading || (more && page.next === null)) return;
    if (!more) {
      const previous = requests.get(key);
      previous?.abort();
    }
    const token = generation;
    const request = new AbortController();
    requests.set(key, request);
    page.loading = true;
    page.error = "";
    try {
      const result = await services.call<GroupPage>(
        "temple_inventory.projections.group_page",
        {
          query: JSON.parse(JSON.stringify(query.value)),
          parent_path: path,
          parent_unit: unit ?? null,
          start: more ? page.next : 0,
          page_length: 30,
          ...(refresh ? { refresh: true } : {}),
        },
        request.signal,
      );
      if (!current(token) || request.signal.aborted) return;
      page.rows = more
        ? [
            ...page.rows,
            ...result.rows.filter(
              (row) => !page!.rows.some((old) => old.id === row.id),
            ),
          ]
        : result.rows;
      page.next = result.next_start;
      if (result.leaf_columns?.length) page.leafColumns = result.leaf_columns;
      page.initialized = true;
      remember();
      if (key === rootKey && pendingRestore?.key === activeQueryKey) {
        const restored = pendingRestore;
        pendingRestore = undefined;
        void rehydrate(restored.snapshot, restored.key);
      }
    } catch (reason) {
      if (!request.signal.aborted && current(token))
        page.error = reason instanceof Error ? reason.message : "加载分组失败";
    } finally {
      requests.delete(key);
      if (current(token)) page.loading = false;
    }
  }
  function rowEntries(
    rows: GroupedReportRow[],
    parentPath: string[],
    parentUnit?: string | null,
  ): DataTableEntry[] {
    const seenDocuments = new Set<string>();
    return rows.flatMap((row) => {
      if (row.row_grain !== "group") {
        if (query.value.view === "records") {
          const value = row as unknown as Record<string, unknown>;
          const identity = `${value.doctype || ""}:${value.document || ""}`;
          if (seenDocuments.has(identity)) return [];
          seenDocuments.add(identity);
        }
        return [
          {
            kind: "record",
            id: row.id,
            value: row as Record<string, unknown>,
          } satisfies DataTableRecord,
        ];
      }
      const children = stateFor(row.group_path || [], row.stock_uom);
      const groupField =
        query.value.groupBy[(row.group_depth || parentPath.length + 1) - 1] ||
        "";
      const rawLabel = String(row.group_label || "未分类");
      const label =
        groupField === "kind"
          ? movementLabels[rawLabel] || rawLabel
          : groupField === "status" &&
              query.value.dataset === "loans" &&
              query.value.view === "records"
            ? {
                Draft: "草稿",
                Cancelled: "已取消",
                Open: "未结清",
                Settled: "已结清",
                Closed: "已结清",
              }[rawLabel] || rawLabel
            : groupField === "docstatus"
              ? {
                  "0": "草稿",
                  Draft: "草稿",
                  "1": "已提交",
                  Submitted: "已提交",
                  "2": "已取消",
                  Cancelled: "已取消",
                }[rawLabel] || (/^\d+$/.test(rawLabel) ? "状态未知" : rawLabel)
              : groupField === "outcome_key"
                ? {
                    outstanding: "未归还",
                    returned: "完好归还",
                    damaged: "损坏归还",
                    lost: "遗失",
                  }[rawLabel] || rawLabel
                : rawLabel;
      const group: DataTableGroup = {
        kind: "group",
        id: row.id,
        parentId: row.parent_group_id || undefined,
        label,
        labelColumn:
          {
            item: "item_name",
            activity: "activity_title",
            activity_type: "activity_type_label",
            warehouse: "warehouse",
            source_warehouse: "source_warehouse",
            destination_warehouse: "destination_warehouse",
            kind: "kind",
            borrower: "borrower",
          }[
            query.value.groupBy[
              (row.group_depth || parentPath.length + 1) - 1
            ] || ""
          ] || undefined,
        countColumn: undefined,
        depth: row.group_depth || parentPath.length + 1,
        count: Number(
          query.value.view === "records"
            ? (row.document_count ?? row.display_count ?? row.row_count ?? 0)
            : (row.display_count ?? row.row_count ?? 0),
        ),
        countLabel:
          query.value.view === "records"
            ? "记录数"
            : query.value.dataset === "inventory" ||
                query.value.dataset === "expiry"
              ? "库存行数"
              : "明细条数",
        expanded: expanded.value.has(row.id),
        hasChildren: Boolean(row.has_children),
        loading: children?.loading,
        error: children?.error,
        detailRow: expanded.value.has(row.id),
        value: row as Record<string, unknown>,
      };
      return [
        group,
        ...(group.expanded && children?.initialized
          ? rowEntries(children.rows, row.group_path || [], row.stock_uom)
          : []),
      ];
    });
  }
  const entries = computed<DataTableEntry[]>(() => {
    const page = pages.value[rootKey];
    return page?.initialized ? rowEntries(page.rows, [], null) : [];
  });
  async function rehydrate(snapshot: GroupSnapshot, key: string) {
    const token = generation;
    for (const node of [...snapshot.expanded].sort(
      (left, right) => left.path.length - right.path.length,
    )) {
      if (!current(token) || activeQueryKey !== key) return;
      const parent = entries.value.find(
        (entry): entry is DataTableGroup =>
          entry.kind === "group" && entry.id === node.id,
      );
      if (!parent) continue;
      const targetRows = snapshot.loaded[pageKey(node.path, node.unit)] ?? 0;
      if (!stateFor(node.path, node.unit)?.initialized)
        await load(node.path, node.unit);
      let page = stateFor(node.path, node.unit);
      while (
        current(token) &&
        activeQueryKey === key &&
        page?.next !== null &&
        page?.next !== undefined &&
        page.rows.length < targetRows
      ) {
        await load(node.path, node.unit, true);
        page = stateFor(node.path, node.unit);
      }
    }
    if (current(token)) remember(key);
  }
  async function toggleGroup(id: string) {
    const row = entries.value.find(
      (entry): entry is DataTableGroup =>
        entry.kind === "group" && entry.id === id,
    );
    if (!row) return;
    if (expanded.value.has(id)) {
      expanded.value.delete(id);
      remember();
      return;
    }
    expanded.value.add(id);
    const value = row.value as unknown as GroupedReportRow;
    const childPage = stateFor(value.group_path || [], value.stock_uom);
    if (!childPage?.initialized && !childPage?.error)
      await load(value.group_path || [], value.stock_uom);
    else remember();
  }
  function loadMore(groupId?: string) {
    if (!groupId) return load([], null, true);
    const group = entries.value.find(
      (entry): entry is DataTableGroup =>
        entry.kind === "group" && entry.id === groupId,
    );
    if (!group) return;
    const value = group.value as unknown as GroupedReportRow;
    return load(value.group_path || [], value.stock_uom, true);
  }
  function seed(
    rows: GroupedReportRow[],
    next: number | null,
    leafColumns: string[] = [],
  ) {
    pages.value[rootKey] = {
      rows,
      next,
      loading: false,
      error: "",
      initialized: true,
      leafColumns,
    };
    remember();
    if (pendingRestore?.key === activeQueryKey) {
      const restored = pendingRestore;
      pendingRestore = undefined;
      void rehydrate(restored.snapshot, restored.key);
    }
  }
  function hasMore(groupId?: string) {
    if (!groupId) return stateFor([], null)?.next != null;
    const group = entries.value.find(
      (entry): entry is DataTableGroup =>
        entry.kind === "group" && entry.id === groupId,
    );
    if (!group) return false;
    const value = group.value as unknown as GroupedReportRow;
    return stateFor(value.group_path || [], value.stock_uom)?.next != null;
  }
  function retry(groupId?: string) {
    if (!groupId) return load([], null, false, true);
    const group = entries.value.find(
      (entry): entry is DataTableGroup =>
        entry.kind === "group" && entry.id === groupId,
    );
    if (!group) return;
    const value = group.value as unknown as GroupedReportRow;
    return load(value.group_path || [], value.stock_uom, false, true);
  }
  watch(
    [
      () => JSON.stringify(query.value),
      () => reference.site,
      () => reference.user,
    ],
    () => {
      const identity = JSON.stringify([reference.site, reference.user]);
      if (identity !== scopeIdentity) {
        groupSnapshots.clear();
        pendingRestore = undefined;
        scopeIdentity = identity;
        activeQueryKey = "";
        cancel();
        pages.value = {};
        expanded.value.clear();
      } else if (activeQueryKey) {
        remember(activeQueryKey);
        cancel();
        pages.value = {};
        expanded.value.clear();
      }
      activeQueryKey = cacheKey();
      const restored = restore(activeQueryKey);
      if (!restored && query.value.groupBy.length && autoLoadRoot)
        void load([], null);
    },
    { immediate: true },
  );
  onBeforeUnmount(cancel);
  return {
    entries,
    leafColumns: computed(() => pages.value[rootKey]?.leafColumns || []),
    expanded,
    toggleGroup,
    loadMore,
    hasMore,
    retry,
    pages,
    seed,
  };
}
