import { items, locations } from "./model";
import {
  createDraft,
  reviewSession,
  type ReviewDraft,
  type ReviewSession,
} from "./reviewModel";

// Keep templates independent of the live stock array, which grows as fixtures load.
const fixtureItems = items.map((item) => structuredClone(item));

/** Installed only when a reviewer explicitly opens one of the receiving samples. */
export function receivingFixture(
  invalid = false,
  session: ReviewSession = reviewSession,
): ReviewDraft {
  const name = invalid ? "PREVIEW-RECEIVE-50-INVALID" : "PREVIEW-RECEIVE-50";
  const existing = session.drafts.find((draft) => draft.name === name);
  if (existing) return existing;
  const draft = createDraft("Receive", name, session);
  for (let index = 0; index < 50; index++) {
    const source =
      fixtureItems[index % 10 === 0 ? 0 : index % fixtureItems.length]!;
    const code = `PREVIEW-50-${String(index + 1).padStart(3, "0")}`;
    if (!session.stock.some((item) => item.code === code))
      session.stock.push({
        ...source,
        code,
        name: `${source.name} · 评审物品 ${index + 1}${index % 7 === 0 ? " · 长名称与包装规格说明，交接时请核对完整编号" : ""}`,
        locations: [],
        available: 0,
        loaned: 0,
        damaged: 0,
      });
    draft.lines.push({
      id: `${name}-line-${index + 1}`,
      code,
      qty: (index % 5) + 1,
      uom: source.uom,
      location: locations[index % locations.length]!,
      batch: source.tracksBatch ? `REVIEW-BATCH-${index + 1}` : "",
      expiry: source.tracksExpiry ? "2027-03-01" : "",
    });
    if (index % 10 === 0)
      draft.lines.push({
        ...draft.lines.at(-1)!,
        id: `${name}-extra-${index + 1}`,
        qty: 2,
        batch: `REVIEW-ADDITIONAL-BATCH-${index + 1}`,
        expiry: "2027-04-01",
      });
  }
  if (invalid) {
    draft.lines[0]!.qty = 0;
    draft.lines[27]!.location = "";
    draft.lines.at(-1)!.qty = -1;
  }
  return draft;
}

/** Explicit opt-in, with mixed units, long identities and varied batch/location scope. */
function installLargePickerFixture(session: ReviewSession = reviewSession) {
  for (let index = 0; index < 1000; index++) {
    const source = fixtureItems[index % fixtureItems.length]!;
    const code = `PICKER-1000-${String(index + 1).padStart(4, "0")}`;
    if (session.stock.some((item) => item.code === code)) continue;
    session.stock.push({
      ...source,
      code,
      name: `${source.name} · 大型选择器物品 ${index + 1}${index % 3 === 0 ? " · 中文长名称、包装规格及库位交接说明，请核对完整名称与编号" : ""}`,
      alternateUnits: source.alternateUnits?.map((row) => ({ ...row })),
      locations: source.locations.slice(0, (index % 3) + 1).map((row) => ({
        ...row,
        batches: row.batches?.map((batch) => ({ ...batch })),
      })),
      illustration: index % 5 === 0 ? "none" : source.illustration,
      files:
        index % 7 < 3
          ? [
              {
                id: code + "-image",
                name: "选择器图片.svg",
                type: "image/svg+xml",
                state: index % 7 === 2 ? "uploading" : "ready",
                url:
                  index % 7 === 1
                    ? "/preview-fixtures/missing-image.svg"
                    : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" rx="6" fill="%23E5EEE7"/%3E%3Cpath d="M12 16h24v22H12z" fill="%2328684E"/%3E%3C/svg%3E',
              },
            ]
          : undefined,
    });
  }
}
