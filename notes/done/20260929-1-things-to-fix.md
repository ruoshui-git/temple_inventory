# Inventory page

## Desktop

- On hover a batch summary badge in a card/table, display detailed batch information including batch number, quantity, and expiry date in the popout. (Change hover to Click on mobile)
- DataTable header font is too small
- On expiry page, instead of using the fab icon, also use the top 3 buttons like the inventory page


### Filters
- In 效期范围 filter, all options look squished together. Maybe make each option display on its own line. If possible, remove the checkbox icon and depend on highlight on the choice to show it's selected.
- 物品类别 filter should not show the root `All Item Groups` filter. Its descendants are the root options in the filters. This was a regression (something we fixed before).


---

More problems: (On desktop)

1. 寺院物资 on the top left should never be displayed as selected/hovered style. (as it is right now when the inventory page is open)
2. 库房 pages cannot be opened after clicking on another nav item such as 货物流动. It doesn't open on clik. Design and impl a fix.
3. Filters should not make the entire app scrollable if they go beyond the viewport height. They should only make the filter section scrollable.