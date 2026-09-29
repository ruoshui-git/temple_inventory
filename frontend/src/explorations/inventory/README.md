# Inventory redesign exploration

Review `Explorations/Inventory Redesign` for the desktop item and batch pages and
the dedicated `Mobile Inventory` and `Mobile Expiry` groups for the redesigned
mobile states. The mobile canvas has an explicit 390 × 844 frame so it also works
without the viewport toolbar.

This folder is imported only by Storybook. It makes no Frappe calls and does not
mount the production page, shell, router, or camera. Destination and operation
links expose their existing destination in a labeled preview. The scan preview
accepts fixture codes such as `ITM-000161` and preserves the search field.

The mobile composition reuses `InventoryCardGrid`, `ActiveFilterChips`,
`ItemImagePreview`, `warehousePresentation`, and the exploration filter/icon
primitives. Opt-in props leave existing production rendering unchanged. Shell,
fixture state, compact rows, summaries, expiry rows, and dialogs remain isolated
from routed production pages and APIs.

## Reference adaptations

The supplied references in `docs/ui/explorations` are used only for this static
review surface. Table thumbnails remain CSS windows into the original desktop
reference. Item Card View uses nine deterministic square crops from the card
reference, kept local and unmodified apart from cropping, scaling, and white
padding. These are review assets, not production item images. Unmatched fixtures
deliberately use the missing-image placeholder.

- Use actual destinations; omit suppliers and other invented areas.
- Keep one highlighted `库存` parent with exactly two child destinations:
  `库存列表` and `效期批次`.
- Keep `有库存`, `需关注`, and all expiry windows inside their pages as filters.
- Use one filter trigger: it reveals a secondary sidebar beside desktop navigation
  and a full-screen filter on mobile. Warehouse and category selectors are
  searchable, independently expandable trees rather than dropdowns. Mobile browse
  chips omit `清除全部`; that action exists inside the full-screen filter only.
- Put sorting directly in the desktop table headers instead of a separate select.
- Keep item-code sorting independent from item-name sorting.
- Keep item rows in `库存列表`; show one row per batch in `效期批次`.
- Mobile Inventory uses a two-column image-forward Card View and a denser list
  view. Its collapsed summary shows only unitless comparison aggregates and
  reveals one stock-UOM breakdown at a time. The compact scrolled state keeps
  browse controls and the view switch but never the summary.
- Mobile expiry is fundamentally batch-level. `ITM-000161` deliberately has three
  batches with distinct dates and quantities; Inventory renders the Item once,
  while Expiry renders all three batch rows. `即将到期` means 0–30 remaining days
  and never includes expired batches.
- Use large square, lazy-loaded, contained images in both item and expiry Card
  Views. A roughly 230px minimum card target naturally gives the wide canvas six
  columns, then adds or removes columns with the available result width.
- Replace numbered pagination with observer-driven loading of local fixtures.
- Show a unitless visual aggregate on each summary, followed by the stock-UOM
  breakdown across all matching fixtures. The breakdown remains the meaningful
  quantity representation; the aggregate is exploration-only comparison chrome.
- Keep available, total, loaned, and damaged visible per item.
- Do not invent trend percentages or stock changes.
- Desktop deliberately starts in table view; production remains card-first.
  Manual selections persist independently per exploration canvas, never writing
  the production preference.

Fixture date: **2026-09-29**. Rooms and category groups are browse-only parents;
items reference leaf locations/categories. Parent selection matches descendants.
Future expiry windows are cumulative and exclude expired batches. Undated batches
remain available to the desktop `无效期` filter but do not appear in the mobile
expiry results; unbatched items never appear in either batch page.

## Manual review

1. Compare initial and scrolled chrome. Scroll back to restore the full header;
   scroll down to reveal more fixtures without numbered pages.
2. Search by code, bilingual name, or a nonmatch; clear the search.
3. Expand both filter trees, search within each, select parent/child checkboxes,
   clear a section, and open `更多条件`.
4. Switch between `库存列表` and `效期批次`; shared filters/search persist while
   each page retains its own stock/expiry state.
5. Check the expiry boundaries and undated behavior, then sort by item code and
   quantities and change the card/table view.
6. Open location/batch details by keyboard and touch; use Escape to dismiss.
7. Open filters and scanner preview; check Escape, focus return, and manual sample
   lookup. Stock actions and navigation stay in preview dialogs.
8. Compare the responsive wide, laptop, filter-open, and expiry Card View states.
   The 1774px canvas should naturally show six columns at 100% zoom, while each
   grid adds or removes columns as its result area changes. Inspect lazy images,
   missing images, two-line names, chips, unit labels, and 10,081 quantities.
   Table view intentionally scrolls horizontally on small screens.
9. Compare all six named Mobile Inventory stories and all six Mobile Expiry
   stories. Confirm search/scan/filter stay on one row, the filter clear action is
   dialog-only, summary cards disappear in scrolled states, and the three
   `ITM-000161` batches remain separate.

Storybook play checks cover search, view switching, hierarchy semantics, filters,
mobile sticky states, two-column cards, and batch-level expiry identity.
Browser/device comparison remains manual; no browser automation is used.
