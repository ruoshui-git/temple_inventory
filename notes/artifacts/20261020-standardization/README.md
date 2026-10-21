# Standardization review evidence — 2026-10-20

The [implementation/review record](../../20261020_BROWSE_API_STANDARDIZATION_IMPLEMENTATION.md)
explains the scope, checks, findings, exceptions and device limits. All final
screenshots use the actual development Frappe application with Chinese fonts.

| Representative surface | Screenshot |
| --- | --- |
| Stock with synchronized hierarchy sidebar | [stock.png](stock.png) |
| Expanded Category → Item groups | [grouped-stock.png](grouped-stock.png) |
| Scrolled Stock sidebar and persistent search | [sticky-desktop.png](sticky-desktop.png) |
| Scrolled Stock at 200% text | [sticky-200percent.png](sticky-200percent.png) |
| Phone Item cards with loaded private images | [phone-item-cards.png](phone-item-cards.png) |
| Item movement history | [history.png](history.png) |
| Column settings in a short viewport | [columns-short-viewport.png](columns-short-viewport.png) |
| Editable reconciliation, blue/spacious | [editable-count-blue-spacious.png](editable-count-blue-spacious.png) |
| In-place fixed quarter editor | [date-quarter.png](date-quarter.png) |
| Enlarged text and filter overlay | [filter-200percent.png](filter-200percent.png) |
| Quick Export preview | [quick-export.png](quick-export.png) |
| Scanner with emulated camera | [scanner.png](scanner.png) |
| Browser recovery summary | [recovery-summary.png](recovery-summary.png) |

Final results are in [final-smoke.json](final-smoke.json), [sticky-layout.json](sticky-layout.json), [routes.json](routes.json),
[recovery-and-density.json](recovery-and-density.json), [dates-and-scanner.json](dates-and-scanner.json)
and the performance/audit JSON files. Files explicitly named `before-...-fix` are
historical review findings; their resolution is recorded in the final review.
