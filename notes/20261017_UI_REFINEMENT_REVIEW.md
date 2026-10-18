# Production UI refinement — independent review

Date: 2026-10-17. Reviewed implementation: `cd2ef72`.

Status: **Reviewed and repaired locally.** The 16-item refinement handoff is
implemented; the gaps found in this review are fixed. This is not a deployment
or a reopening of the closed migration. Real-device limits below remain explicit.

## Findings fixed

- **Compact loan filters could clear the scope.** BrowseToolbar searched button
  text for “筛选”, which could select “清空筛选”. It now emits an explicit filter
  intention; CompactFilters exposes its panel-opening action. Desktop opens the
  first filter and mobile opens the full sheet. Opening never changes scope.
  The badge counts Item, Activity and all other scope fields consistently.
- **Inherited restrictions were invisible.** Movement/loan views supplied an
  unused `extra` slot. The supported `chips` slot now renders inherited Item,
  loan and allocation restrictions; removing one preserves other conditions.
- **Warehouse display omissions.** Item batch rows still displayed native names
  with company suffixes, expiry's Location column had lost its location text,
  and allocation chips/Quick Export captions exposed names embedded in keys.
  These use authorized display labels, including safe unavailable fallbacks.
  JSON and unambiguous legacy allocation keys retain their exact query values;
  movement document/child identities remain unchanged. Warehouse/setup native
  identifiers are explicitly labeled “ERPNext 名称” where audit context is needed.
- **Batch inspection lacked identity and quantities.** The Item batch modal now
  identifies its Item and Batch and includes available/loaned/damaged quantities.
- **Retained quantities lacked refresh context.** QuantitySummary keeps prior
  quantities while visibly announcing an update; a pending empty metric does not
  display a misleading zero. Existing image-error assertions were updated to
  distinguish a failed request from an absent image, and warehouse fixtures now
  provide display labels instead of expecting native identifiers.
- **Square geometry could be overridden.** AsyncImage previously accepted a
  conflicting explicit height despite its square aspect ratio. Thumbnail height
  now follows the square width; natural full-image viewing keeps its proportions.
- **Scanner controls were duplicated.** ScanPanel's embedded scanner repeated
  its manual field and close-camera action. A camera-only presentation retains
  camera feedback/retry while ScanPanel owns the single manual field and toggle.
  The engine remains ZXing-WASM; lifecycle and scan resolution are unchanged.
- **Long allocation context hid Close at large text.** At 390px/200% app text,
  record metadata filled the bounded modal header. It now heads the scrollable
  detail body, leaving the modal title and close action visible.

## Visual/browser review

Inspected the routed production app in Chromium against the existing local
development data, using the Administrator login explicitly authorized by the user.
No inventory documents, uploads or export jobs were saved by the visual review.
The temporary browser session was revoked and its private state file removed.

- Initial live capture covered Dashboard, Stock, Movement records, Loan records,
  Warehouses, Expiry, Reports, Activities, Drafts, new Receive and new Item at
  1440px and 390px. All 22 page captures had no page exception or page-level
  horizontal overflow. This is sampled coverage, not proof of every dynamic state.
- Inspected linked-loan chooser/preview, allocation details, Item batch details,
  expiry inspection → nested Quick Export → return/focus, compact loan filters,
  and scanner fallback without a physical camera.
- Exercised crop choice with an unsaved generated test image: desktop/phone
  preview, opt-in original, and resulting pending attachments. No file upload.
- Inspected phone layouts and result content at 200% app text, including stock
  cards, warehouse hierarchy and allocation details. Wide data tables retain
  internal scrolling instead of squeezing the page or individual text tracks.
- Controlled API browser cases separately cover 320/390/1440px, all three
  densities, 100/200% app text, collapse/expand, hierarchy, square thumbnails,
  responsive filter retention, modal pagination/focus, loans, expiry tabs and crop.

Selected evidence is in [the screenshot directory](assets/20261017-ui-refinement-review/):

- [Batch identity, quantities and display location](assets/20261017-ui-refinement-review/item-batch-modal-fixed.png)
- [Expiry location column](assets/20261017-ui-refinement-review/expiry-fixed.png)
- [Loaded Quick Export with readable allocation scope](assets/20261017-ui-refinement-review/export-loaded.png)
- [Compact filter action preserves the selection](assets/20261017-ui-refinement-review/loan-filter-after.png)
- [Phone crop dialog](assets/20261017-ui-refinement-review/crop-phone.png)
- [Scanner fallback without duplicate controls](assets/20261017-ui-refinement-review/scanner-fixed.png)
- [Large-text allocation dialog](assets/20261017-ui-refinement-review/allocation-large-fixed.png)

## Validation actually run

No automated suite was run before the initial source/browser review and fixes.
After changes:

- Final unit run: `pnpm exec vitest run --maxWorkers=1` — **49 files, 320 tests
  passed**. An earlier invocation unexpectedly ran the full suite rather than
  the intended file selection; its failures led to the summary repair and
  outdated assertion updates above. The large-receipt fixture timed out under
  parallel load, then passed in the focused serial run and final full serial run.
- `ui-refinement.spec.ts`: **15 passed**. After the final allocation-header fix,
  both affected phone/desktop cases and the new 200% Close-visibility regression
  passed (**3**, including two repeats).
- `native-scanner.spec.ts`: **2 passed**, including actual ZXing-WASM decoding
  of the existing deterministic Y4M camera fixture and release of media tracks.
  Browser total: **18 distinct passing cases**, with affected cases rerun.
- Final `pnpm type-check` and `pnpm build`: passed. Vite generated the production
  assets, including the bundled local WASM and PWA output. No generated files
  were edited by hand. Touched Vue/TypeScript files were formatted with Prettier.
- No backend suite rerun: this review changes frontend presentation and tests,
  not native inventory, authorization or upload service contracts.

## Remaining verification limits

Physical phone cameras, EXIF-oriented phone photos, real cropped-file uploads,
and native browser zoom were not independently certified here. App text scaling
and a deterministic camera stream are separate checks. Pending file bytes remain
tab-local: after recovery, a generated crop may need removal and re-addition from
the original, as the existing file-reselection UI explains; no persisted image
store was introduced. There is no claim that every possible long string or device
combination has been exhaustively inspected.

The shared layout approach remains: readable minimum text tracks, internal
scrolling for genuinely wide tables, wrapping action rows, bounded hierarchy
decoration, and long record context in the modal body. Preserve these patterns
when adding new screens; do not restore the retired preview application.
