# Independent live-browser review — 2026-10-20

See the [repair handoff](../../20261020_INDEPENDENT_REVIEW_HANDOFF.md) for findings,
source locations, reproduction steps, and coverage limits.

Screenshots show the actual development app, with Chinese-capable fonts.
Desktop initial captures use 1440×900; compact/panel examples also include
1366×768. Phone captures use 390×844.

| Evidence | File |
| --- | --- |
| Default Stock | [stock.png](stock.png) |
| Default Movement Items | [movements.png](movements.png) |
| Default Loan Items | [loans.png](loans.png) |
| Movement status raw integer | [records.png](records.png) |
| Reports title/badge | [reports.png](reports.png) |
| Collapsed tools still leave large summary | [stock-compact.png](stock-compact.png) |
| Stock desktop filter panel | [stock-filter.png](stock-filter.png) |
| Reports desktop filter panel | [reports-filter.png](reports-filter.png) |
| Phone Stock first viewport | [phone-stock.png](phone-stock.png) |
| Phone Loan first viewport | [phone-loans.png](phone-loans.png) |
| Movement grouping chip but flat records | [records-grouped-kind.png](records-grouped-kind.png) |
| Loan grouping chip but flat records | [loan-records-grouped.png](loan-records-grouped.png) |
| Loan history HTTP 417 error | [history-after-eight-seconds.png](history-after-eight-seconds.png) |
| History remains after collapse | [history-collapse-final.png](history-collapse-final.png) |
| Settled Food filter result | [food-filter-settled.png](food-filter-settled.png) |
| Representative blue/compact filter panel | [theme-blue-compact.png](theme-blue-compact.png) |
| Existing in-panel date controls | [movement-date-menu.png](movement-date-menu.png) |

[observations.json](observations.json) records the initial route sweep, unchanged
group disclosure state/request count, and the Loan history HTTP error. Session
cookies and browser authentication state are deliberately excluded.
