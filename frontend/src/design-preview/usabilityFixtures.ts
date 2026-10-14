import { items, locations } from "./model";
import {
  createDraft,
  reviewSession,
  type ReviewDraft,
  type ReviewSession,
} from "./reviewModel";

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
    const source = items[index % 10 === 0 ? 0 : index % items.length]!;
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
