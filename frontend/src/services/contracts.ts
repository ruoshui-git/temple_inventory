import { inject, provide, reactive, type InjectionKey } from "vue";
import type { ReportQuery, ReportRow } from "../lib/reportContract";
import type { HierarchyFilterNode } from "../components/ui/HierarchyFilter.vue";
import { setUnitSource } from "../lib/units";

export interface LocationNode {
  name: string;
  label: string;
  local_label: string;
  short_label: string;
  full_label: string;
  path: string;
  search_text: string;
  kind: "area" | "room" | "shelf" | "system";
  owner: string;
  direct: boolean;
  storable: boolean;
  missing_direct: boolean;
  parent: string;
  is_group: boolean;
  disabled: boolean;
  lft: number;
  rgt: number;
  version: string;
  protected: boolean;
  can_edit: boolean;
}

export interface PageOptions {
  start?: number;
  page_length?: number;
  table?: string;
  include_related?: boolean;
  refresh?: boolean;
}
export interface ReportPage {
  query: ReportQuery;
  scope: ReportQuery["scope"];
  period: { key: string; date_from: string; date_to: string };
  snapshot: string;
  table: string;
  columns: string[];
  leaf_columns?: string[];
  sortable_columns: string[];
  rows: ReportRow[];
  matched_count: number;
  next_start: number | null;
  summary: ReportRow[];
  tables: { id: string; label: string; count: number }[];
}
export interface GroupPage {
  rows: GroupedReportRow[];
  matched_count: number;
  next_start: number | null;
  parent_path: string[];
  parent_unit?: string | null;
  row_grain: "group" | "record" | "allocation" | "stock";
  count_grain?: "stock_row" | "activity" | "native_document" | "allocation";
  query: ReportQuery;
  leaf_columns?: string[];
}
export interface GroupedReportRow {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | string[]
    | MovementQuantityBreakdown[]
    | GroupedUnitTotal[]
    | GroupedNativeWhole
    | undefined;
  id: string;
  group_path?: string[];
  group_depth?: number;
  parent_group_id?: string | null;
  group_label?: string;
  group_field?: string;
  has_children?: boolean;
  row_grain?: "group" | "record" | "allocation" | "stock";
  row_count?: number;
  count_grain?: "stock_row" | "activity" | "native_document" | "allocation";
  count_label?: string;
  display_count?: number;
  item_count?: number;
  document_count?: number;
  allocation_count?: number;
  stock_uom?: string;
  unit_totals?: GroupedUnitTotal[];
  quantity_breakdown?: MovementQuantityBreakdown[];
  whole?: GroupedNativeWhole;
  original_loans?: string[];
  can_settle?: boolean;
}
export interface GroupedUnitTotal {
  stock_uom: string;
  [field: string]: string | number | null;
}
export interface GroupedNativeWhole {
  quantities: { uom: string; qty: number }[];
  available_effects: { uom: string; qty: number }[];
  outstanding?: { uom: string; qty: number }[];
  item_count: number;
  line_count: number;
  branches: { source: string; destination: string }[];
  original_loans: string[];
  loan_status?: string;
}
export interface MovementQuantityBreakdown {
  kind: string;
  docstatus: number;
  stock_qty: number;
  available_effect: number;
  document_count: number;
  allocation_count: number;
}
export interface NamedView {
  id: string;
  title: string;
  query: ReportQuery;
  revision: number;
}
export interface ExportJob {
  name: string;
  status: "Queued" | "Running" | "Completed" | "Failed";
  progress: number;
  error: string;
  version: string;
  attempt: number;
  generated_at: string;
  row_count: number;
  download_url: string | null;
  table?: string;
  columns?: string[];
  file_label?: string;
  grouped?: boolean;
  include_files?: "none" | "images" | "all";
}
export interface InventoryServices {
  fileDisplayUrl?(file: { name: string; file_url: string }): string;
  call<T>(
    endpoint: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T>;
  report(
    query: ReportQuery,
    options?: PageOptions,
    signal?: AbortSignal,
  ): Promise<ReportPage>;
  upload(
    file: File,
    doctype: string,
    name: string,
    progress?: (value: number) => void,
  ): Promise<Record<string, unknown>>;
}
export interface ReferenceOption {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  enabled?: boolean;
}
export interface ReferenceData {
  user: string;
  site: string;
  siteDate: string;
  siteTime: string;
  timezone: string;
  company: string;
  categories: HierarchyFilterNode[];
  categoryRoot: string;
  warehouses: LocationNode[];
  physicalLeaves: string[];
  leasedLeaves: string[];
  damagedLeaves: string[];
  items: ReferenceOption[];
  activities: ReferenceOption[];
  activityTypes: ReferenceOption[];
  units: {
    name: string;
    label: string;
    whole: boolean;
    category?: string | null;
    enabled?: boolean;
  }[];
  operations: Record<string, boolean>;
  settings: Record<string, unknown>;
}
export function createReferenceData(): ReferenceData {
  return reactive({
    user: "",
    site: "",
    siteDate: "",
    siteTime: "",
    timezone: "",
    company: "",
    categories: [],
    categoryRoot: "",
    warehouses: [],
    physicalLeaves: [],
    leasedLeaves: [],
    damagedLeaves: [],
    items: [],
    activities: [],
    activityTypes: [],
    units: [],
    operations: {},
    settings: {},
  });
}
const serviceKey: InjectionKey<InventoryServices> =
  Symbol("inventory-services");
const referenceKey: InjectionKey<ReferenceData> = Symbol(
  "inventory-reference-data",
);
export function provideInventoryServices(
  services: InventoryServices,
  reference: ReferenceData,
) {
  provide(serviceKey, services);
  provide(referenceKey, reference);
  setUnitSource(reference);
}
export function useInventoryServices() {
  const services = inject(serviceKey);
  if (!services) throw new Error("未配置物资管理服务");
  return services;
}
export function useOptionalInventoryServices() {
  return inject(serviceKey, undefined);
}
export function provideReferenceData(reference: ReferenceData) {
  provide(referenceKey, reference);
  setUnitSource(reference);
}
export function useReferenceData() {
  const reference = inject(referenceKey);
  if (!reference) throw new Error("未加载物资管理基础资料");
  return reference;
}

export interface BootstrapData {
  user: string;
  site: string;
  site_date: string;
  site_time: string;
  timezone: string;
  category_root: string;
  settings: Record<string, unknown>;
  physical_leaves: string[];
  leased_leaves: string[];
  damaged_leaves: string[];
  categories: {
    name: string;
    item_group_name: string;
    parent_item_group?: string;
    is_group: boolean;
    lft: number;
    rgt: number;
    modified: string;
  }[];
  warehouses: {
    name: string;
    label: string;
    local_label: string;
    short_label: string;
    full_label: string;
    path: string;
    search_text: string;
    kind: "area" | "room" | "shelf" | "system";
    owner: string;
    direct: boolean;
    storable: boolean;
    missing_direct: boolean;
    parent: string;
    is_group: boolean;
    disabled: boolean;
    lft: number;
    rgt: number;
    version: string;
    protected: boolean;
    can_edit: boolean;
  }[];
  uoms: {
    name: string;
    label: string;
    must_be_whole_number: boolean;
    category: string | null;
    enabled: boolean;
  }[];
  activity_types: { name: string; label: string; enabled: boolean | number }[];
  operations: ReferenceData["operations"];
}
export function hydrateReferenceData(
  reference: ReferenceData,
  result: BootstrapData,
) {
  const warehousePaths = new Map(
    result.warehouses.map((row) => [row.name, row.path]),
  );
  Object.assign(reference, {
    user: result.user,
    site: result.site,
    siteDate: result.site_date,
    siteTime: result.site_time,
    timezone: result.timezone || "",
    company: String(result.settings.company || ""),
    categoryRoot: result.category_root,
    settings: result.settings,
    categories: result.categories.map((row) => ({
      ...row,
      label: row.item_group_name,
      parent:
        row.parent_item_group === result.category_root
          ? ""
          : row.parent_item_group,
      version: row.modified,
    })),
    warehouses: result.warehouses,
    units: result.uoms.map((row) => ({
      name: row.name,
      label: row.label || row.name,
      whole: Boolean(row.must_be_whole_number),
      category: row.category,
      enabled: Boolean(row.enabled),
    })),
    activityTypes: result.activity_types.map((row) => ({
      value: row.name,
      label: row.label,
      enabled: Boolean(row.enabled),
    })),
    physicalLeaves: [...result.physical_leaves].sort((left, right) => {
      const leftPath = warehousePaths.get(left) || left;
      const rightPath = warehousePaths.get(right) || right;
      return leftPath.localeCompare(rightPath, "zh-CN", {
        sensitivity: "base",
      });
    }),
    leasedLeaves: result.leased_leaves,
    damagedLeaves: result.damaged_leaves,
    operations: result.operations,
  });
}

export function useOptionalReferenceData() {
  return inject(referenceKey, undefined);
}
