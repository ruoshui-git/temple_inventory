# T8 baseline measurements

Captured on `http://development.localhost:8000/inventory` with the audit Playwright harness, Chromium headless shell, and the logged-in Administrator account. Each case opened the requested number of item groups, navigated to a history document, used browser Back, and waited for the expanded history rows to render. API durations are browser request start-to-finish timings (HTTP end-to-end), not isolated server CPU timings.

| View | Expanded groups | Histories rendered | Restore after Back | Browse calls | Per-call request duration |
|---|---:|---:|---:|---:|---|
| Movements items | 1 | 2 rows | 2.65 s | 1 | 527 ms |
| Movements items | 5 | 25 rows | 6.62 s | 5 | 2.17–2.53 s |
| Movements items | 10 | 38 rows | 6.97 s | 10 | 2.40–4.71 s |
| Loans items | 1 | 3 rows | 0.59 s | 1 | 70 ms |
| Loans items | 5 | 10 rows | 1.13 s | 5 | 134–568 ms |
| Loans items | 10 | 20 rows | 1.48 s | 10 | 154–864 ms |

The N movement history requests overlap on the server, so the latency of each grows with concurrency. The five-group movement case is the gating comparison for retaining the batch implementation; it must reduce restore time by at least about 30%.

Run script: `baseline.mjs`. Raw results: `baseline-movements-1.json`, `baseline-movements-5.json`, `baseline-movements-10.json`, `baseline-loans-1.json`, `baseline-loans-5.json`, and `baseline-loans-10.json`. Screenshots: `before-movements-5.jpg` and `before-loans-5.jpg`.

Backend validation: 1,322 tests ran; 1,320 passed and 2 failed. The failures were `test_expiry_digest_defaults_off_and_other_events_on` and `test_recipient_filter_requires_app_role_master_event_and_notification_settings` in `temple_inventory/tests/test_notifications.py`. The full console output is in `backend-suite.log`.
