import { inject, provide, reactive, type InjectionKey } from "vue";
import type { ReportQuery, ReportRow } from "../lib/reportContract";
import type { HierarchyFilterNode } from "../components/ui/HierarchyFilter.vue";

export interface PageOptions {
  start?: number;
  page_length?: number;
  table?: string;
  include_related?: boolean;
}
export interface ReportPage {
  query: ReportQuery;
  scope: ReportQuery["scope"];
  period: { key: string; date_from: string; date_to: string };
  snapshot: string;
  table: string;
  columns: string[];
  rows: ReportRow[];
  matched_count: number;
  next_start: number | null;
  summary: ReportRow[];
  tables: { id: string; label: string; count: number }[];
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
  company: string;
  categories: HierarchyFilterNode[];
  warehouses: HierarchyFilterNode[];
  physicalLeaves: string[];
  leasedLeaves: string[];
  damagedLeaves: string[];
  items: ReferenceOption[];
  activities: ReferenceOption[];
  activityTypes: ReferenceOption[];
  units: { name: string; whole: boolean }[];
  capabilities: Record<string, Record<string, boolean>>;
  operations: Record<string, boolean>;
  settings: Record<string, unknown>;
}
export function createReferenceData(): ReferenceData {
  return reactive({
    user: "",
    site: "",
    siteDate: "",
    siteTime: "",
    company: "",
    categories: [],
    warehouses: [],
    physicalLeaves: [],
    leasedLeaves: [],
    damagedLeaves: [],
    items: [],
    activities: [],
    activityTypes: [],
    units: [],
    capabilities: {},
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
}
export function useInventoryServices() {
  const services = inject(serviceKey);
  if (!services) throw new Error("未配置物资管理服务");
  return services;
}
export function provideReferenceData(reference: ReferenceData) {
  provide(referenceKey, reference);
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
  }[];
  warehouses: {
    name: string;
    local_label: string;
    breadcrumb: string;
    parent_warehouse?: string;
    is_group: boolean;
  }[];
  uoms: { name: string; must_be_whole_number: boolean }[];
  activity_types: { name: string; label: string; enabled: boolean | number }[];
  capabilities: ReferenceData["capabilities"];
  operations: ReferenceData["operations"];
}
export function hydrateReferenceData(
  reference: ReferenceData,
  result: BootstrapData,
) {
  Object.assign(reference, {
    user: result.user,
    site: result.site,
    siteDate: result.site_date,
    siteTime: result.site_time,
    company: String(result.settings.company || ""),
    settings: result.settings,
    categories: result.categories.map((row) => ({
      ...row,
      label: row.item_group_name,
      parent: row.parent_item_group,
    })),
    warehouses: result.warehouses.map((row) => ({
      ...row,
      label: row.local_label,
      search_text: row.breadcrumb,
      parent: row.parent_warehouse,
    })),
    units: result.uoms.map((row) => ({
      name: row.name,
      whole: Boolean(row.must_be_whole_number),
    })),
    activityTypes: result.activity_types.map((row) => ({
      value: row.name,
      label: row.label,
      enabled: Boolean(row.enabled),
    })),
    physicalLeaves: result.physical_leaves,
    leasedLeaves: result.leased_leaves,
    damagedLeaves: result.damaged_leaves,
    capabilities: result.capabilities,
    operations: result.operations,
  });
}
