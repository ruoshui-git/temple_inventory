# App refinements — live-login acceptance

Completed 2026-10-19 against `development.localhost`, using the real Frappe login
form and the existing Administrator account supplied by the user. Production
assets, API responses, private images and database reads/writes were real; no
HTTP requests or native data were mocked. Chromium used an existing local CJK
font configuration for readable Chinese screenshots.

## Results

All **24 live checks passed**, followed by a separate successful logout and
session-invalidation check. The submitted datasets contained 14 movement records,
2 loan records and 19 expiry batches.

- Stock, Movement items/records, Loan items/records and Expiry loaded live results
  at 1440px and 390px with no horizontal document overflow.
- Collapsed Movement/Loan headings retained working item/record switches. The
  mobile navigation scrolled, exposed 更多 and highlighted its active destination.
- Loan outcome filtering had one selector. Warehouse selection survived desktop /
  mobile transitions. Desktop controls measured below 44px; mobile hierarchy
  targets retained their 44px minimum.
- Native movement effects matched available-stock semantics: receipt, usable
  return and repair increased it; issue, loan and damage decreased it; transfers
  between available locations were neutral. Damaged returns remained neutral.
- A partial-item record filter retained whole-document quantities across all stock
  units. Real report projection totals matched those quantities, and Quick Export
  loaded a real bounded preview. The record date header changed sort direction.
- Expiry private thumbnails loaded and opened an independent lightbox. Batch links
  opened live location balances/history, and returning preserved exact batch scope.
- A disposable zero-stock Batch saved its expiry and description through the UI.
  Native Item stock rows remained unchanged and no movement history was created.
  A concurrent native metadata update caused the expected stale-version rejection;
  the UI retained the local edits. The unsaved-navigation guard also blocked a
  dismissed departure.
- Dashboard loaded real data and used the same increase/decrease quantity colors.
- No uncaught browser errors or unexpected API errors occurred. The single HTTP
  417 was the intentional `TimestampMismatchError` conflict test.

## Cleanup

- The disposable `TI-LIVE-REVIEW-*` Batch was deleted and its absence verified.
- Normal logout invalidated the test session: the subsequent account-handshake
  request returned HTTP 401.
- The private login file was deleted. Credentials, cookies and authenticated
  browser storage were not included in the evidence.
- The existing Administrator account remained enabled; its password and roles
  were not changed. No temporary user was created and no stock transaction was
  submitted.
- The temporary Frappe server was stopped.

## Evidence

- [Sanitized check results](assets/20261019-app-refinement-live/results.json)
- [Movement records desktop](assets/20261019-app-refinement-live/movements-records-1440-live.png)
- [Collapsed Movement phone](assets/20261019-app-refinement-live/movements-collapsed-switch-390-live.png)
- [Loan records desktop](assets/20261019-app-refinement-live/loans-records-1440-live.png)
- [Expiry desktop](assets/20261019-app-refinement-live/expiry-1440-live.png)
- [Private-image lightbox](assets/20261019-app-refinement-live/expiry-private-lightbox-live.png)
- [Batch stock/history](assets/20261019-app-refinement-live/batch-live-stock-and-history.png)
- [Saved batch metadata](assets/20261019-app-refinement-live/batch-saved-metadata-live.png)
- [Retained input after a real version conflict](assets/20261019-app-refinement-live/batch-stale-version-preserves-input-live.png)
- [Batch phone](assets/20261019-app-refinement-live/batch-mobile-live.png)
- [Dashboard](assets/20261019-app-refinement-live/dashboard-live.png)
