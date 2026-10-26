# T1 timing capture

Captured 2026-10-26 against the local development site at 1440×900, zh-CN.

| Scenario | Before | After | Notes |
| --- | ---: | ---: | --- |
| Add six selected items until all six quantity fields are interactive | 16.6 s | 103 ms | One `catalog.operation_items` POST (40 ms observed); picker closed at 103 ms. |
| Reopen a six-line Receive draft until all six quantity fields are interactive | 9.9 s | 263 ms | Opened from the drafts list. |

Screenshots: `add-six-interactive.png` and `reopen-six-interactive.png`.
