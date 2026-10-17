# Design migration follow-up fixes — 2026-10-17

F1–F4 from the [follow-up review](20261017_DESIGN_MIGRATION_FOLLOWUP_REVIEW.md)
are implemented. This record covers the remaining findings; it does not certify
the broader migration's outstanding acceptance work. The pre-existing `AGENTS.md`
changes were preserved.

| Finding | Result |
| --- | --- |
| F2 saved Opening Stock export | `savedDocumentExport` uses saved native purpose as well as DocType. Opening reconciliations use movements with exact DocType/name/status, opening quantities and adjustments included. Physical counts still use Counts and their existing review/baseline/difference tables. Local editor values never determine export scope. |
| F1 activity titles | `useLinkedActivity` is shared by Operation and Count controllers and supplies every shared context/summary. It resolves exact IDs through the existing authorized `activities.load_activity`, including archived activities, independently of picker/search cache. Native reload, window focus and session restoration recheck titles; unchanged document versions do not prevent rename refresh. Inline activity saves update the shared label. Stale/aborted/account-switched responses are discarded and listeners cleaned up. Unverified links show 活动暂不可用 while preserving identity and input. |
| F3 inactive document buttons | Quick Export opts out of shared ReportTable document links. Identifiers are selectable text without button semantics. Full Reports retains native document navigation; file generation remains a separate action. |
| F4 dashboard fixture coverage | Injected movement rows supply Item names, native type, kind and activity title; loan rows supply activity context. The default gallery shows realistic populated records. A labeled missing-context service scenario exercises fallback presentation independently through the same production component. |

## Validation

From `frontend/`:

- `pnpm test`: **326 passed in 49 files** on the final source.
- `pnpm type-check`: passed.
- `pnpm build` and `pnpm design:build`: passed on the final source. Generated
  Frappe frontend/PWA assets came from Vite. Gallery retains the existing large-chunk warning.
- `NATIVE_UI_PORT=8107 NATIVE_UI_RESULTS=/tmp/temple-followup-native-browser pnpm exec playwright test --config playwright.config.ts tests/browser/native-followup.spec.ts`:
  **2 passed**, at 375px and 1440px. Fresh/reloaded archived activity titles,
  renamed title, truthful denied state, opening preview quantity, exact full-workspace
  query and keyboard activation of the full-export control. Preview IDs have no buttons.
- `DESIGN_PREVIEW_PORT=5297 DESIGN_PREVIEW_RESULTS=/tmp/temple-followup-gallery-browser pnpm exec playwright test --config playwright.design-preview.config.ts migration-review.spec.ts --grep 'dashboard named'`:
  **2 passed**, populated and deliberate fallback dashboard cases at both widths.

Component/controller tests also cover active and archived activity titles in both
native editors, native reload after an Activity rename without a stock-document
version change, restored local input, permission fallback despite stale cache,
competing link responses, account switches, focus/session refresh and cleanup.
Existing native report-table document navigation remains covered.

From the bench root, each command below passed **1 rollback integration case**:

```sh
bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run --kwargs '{"test_name":"test_saved_opening_export_uses_native_movement_quantities_and_excludes_counts"}'
bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run --kwargs '{"test_name":"test_saved_record_scope_requires_exact_doctype_name_and_status"}'
```

The opening case creates a real ERPNext Opening Stock reconciliation with quantity 7
and a native Temporary Opening account. Draft/submitted/cancelled previews and full
related-data projections retain Opening kind, quantity, native parent/child identities;
Counts and mismatched DocType filters exclude it. The existing regression verifies
ordinary movements and physical Counts in all three native states. Records/settings
are rolled back; no development reset or lasting stock write occurred.

Touched Python passed Ruff format/check; touched frontend source/tests were formatted
with Prettier. Restricted execution initially could not resolve `mariadb` or bind the
gallery test server; approved unsandboxed runs passed. The initial native opening
fixture needed its proper balance-sheet account, and the first browser run hit Vite's
shared dependency-cache invalidation during concurrent gallery startup. Corrected
setup and the isolated final runs passed.

## Visual evidence and limits

Directly inspected shared-production dashboard screenshots with Chinese font:
[375px](assets/20261017-design-migration-followup-fixes/dashboard-375.png) and
[1440px](assets/20261017-design-migration-followup-fixes/dashboard-1440.png).
Names lead recent records; native IDs/dates/kind/activity remain secondary. Loan
activity context is populated. Ordinary unlinked records retain the truthful fallback.

The new native-UI browser cases use controlled HTTP contracts, not live Frappe
responses. Real opening quantities and persisted scope are independently verified
by the rollback database tests above. No export jobs/downloads, full backend/gallery
sweep, real-device camera, native browser zoom or stock-write race were rerun for
this scoped follow-up. No deployment occurred.
