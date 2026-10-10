# Dashboard Design


---
I think for the movement pages, I still want a row of summary cards on top, showing the sum for each category (unitless sum & a breakdown by unites).

Or maybe, this shouldn't be something that complicates the movement page. Instead should be on a homepage dashboard? This way, we have a location for the summary numbers, but that doesn't complicate the movement pages.

For this dashboard page:
1. Sections should exist for Inventory, Expiry, Movement, etc.
2. Stats should be filterable by warehouse, category, etc.
3. Similarly, the summary cards on top of the Inventory/Expiry pages, should also be moved to the dashboard
4. numbers should be color coded to indicate their role/importance.

Help me investigate my app and determine what should the dashboard page include. Read the GitHub repo for the most up to date code. I've attached screenshots of the current app UI (in no particular order).

Then, give me an image mockup of the dashboard page. Multiple images if needed. (Also need a mobile version).


---
Help me add a Dashboard page to the app.
Use the ![Design mockup](<20261010-Temple Supplies Inventory Dashboard Mockup.png>) image as the reference image. Do note that consistency in app should override what appears in the image. Make the style as close as possible as the mockup, however reuse existing style & components for consistency.
Use [design requirements](20261010-temple_inventory_dashboard_design_spec.md) file as the goal, but detailed implementation is up to you to decide based on current codebase.

---
The dashboard should not show 逾期借用/应归还日期. We do not want a seaparate data model. Display other types of data for the loans card if available.