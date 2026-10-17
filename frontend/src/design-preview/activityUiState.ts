import { reactive } from "vue";
import type { PreviewPeriod } from "./browseModel";
import type { ReportQuery } from "../lib/reportContract";
export const activityQueries = reactive<Record<string, ReportQuery>>({});
export const activityUi = reactive({
  relatedKind: "",
  relatedSearch: "",
  relatedStatus: "1",
  relatedPeriod: { key: "all", from: "", to: "" } as PreviewPeriod,
  detailTab: "records",
  selected: "ACT-0001",
  search: "",
  status: "active" as "active" | "archived" | "all",
  typeId: "",
  period: { key: "all", from: "", to: "" } as PreviewPeriod,
  kind: "",
  presence: "all",
  outstanding: false,
  sort: "updated",
});
