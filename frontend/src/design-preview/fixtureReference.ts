import FixtureArtwork from "./FixtureArtwork.vue";
import { provideItemArtwork } from "../services/itemArtwork";
import { reactive } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../services/contracts";
import { activityTypes, activities } from "./activityData";
import { reviewSession } from "./reviewModel";
import { fixtureServices } from "./fixtureServices";
import { previewDate } from "./model";

export const galleryReference = reactive({
  ...createReferenceData(),
  site: "design-gallery",
  user: "gallery-reviewer",
  company: "图库示例",
  siteDate: previewDate,
  siteTime: `${previewDate} 10:00:00`,
  get physicalLeaves() {
    return reviewSession.warehouses
      .filter(
        (row) =>
          !row.is_group &&
          !row.name.startsWith("借出") &&
          !row.name.startsWith("损坏待处理"),
      )
      .map((row) => row.name);
  },
  get leasedLeaves() {
    return reviewSession.warehouses
      .filter((row) => !row.is_group && row.name.startsWith("借出"))
      .map((row) => row.name);
  },
  get damagedLeaves() {
    return reviewSession.warehouses
      .filter((row) => !row.is_group && row.name.startsWith("损坏待处理"))
      .map((row) => row.name);
  },
  operations: Object.fromEntries(
    [
      "Receive",
      "Issue",
      "Transfer",
      "Loan",
      "Return",
      "Damage",
      "Loss",
      "Repair",
      "Disposal",
      "Reconcile",
    ].map((kind) => [kind, true]),
  ),
  capabilities: Object.fromEntries(
    [
      "Item",
      "UOM",
      "Item Group",
      "Warehouse",
      "Batch",
      "Stock Entry",
      "Stock Reconciliation",
      "Inventory Activity",
      "File",
    ].map((doctype) => [
      doctype,
      {
        read: true,
        create: true,
        write: true,
        delete: true,
        submit: true,
        cancel: true,
        amend: true,
      },
    ]),
  ),
  get units() {
    return reviewSession.units;
  },
  get items() {
    return reviewSession.stock.map((row) => ({
      value: row.code,
      label: row.name,
      detail: row.code,
    }));
  },
  get activities() {
    return activities.map((row) => ({
      value: row.id,
      label: row.title,
      detail: row.id,
    }));
  },
  get activityTypes() {
    return activityTypes.map((row) => ({
      value: row.id,
      label: row.label,
      enabled: row.enabled,
    }));
  },
  get categories() {
    return reviewSession.categories;
  },
  get warehouses() {
    return reviewSession.warehouses;
  },
});
export function provideGalleryReference() {
  provideInventoryServices(fixtureServices, galleryReference);
  provideItemArtwork({
    component: FixtureArtwork,
    has: (code) => {
      const item = reviewSession.stock.find((row) => row.code === code);
      return !!item && item.illustration !== "none";
    },
  });
}
