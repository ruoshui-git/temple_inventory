# Costume → ERPNext migration package

Source: Notion export supplied by the user.

## What is in this package

- `costumes_source_normalized.csv` — all 96 source records, normalized but preserving the original information.
- `items_staging.csv` — ERPNext Item staging data.
- `opening_stock_A04_staging.csv` — the 96 current quantities assigned to `第2寺院 / A04`. This is **not posted automatically**.
- `image_manifest.csv` — maps all 114 images to Item Codes and identifies the primary image.
- `images/` — all 114 exported image files.
- `migration_config.json` — migration behavior and category mapping.
- `upload_costumes.py` — idempotent REST uploader for Item masters + images.

## Warehouse assumption

Every source record is physically in:

- Site/group warehouse: `第2寺院`
- Room warehouse: `A04`

The uploader resolves the actual ERPNext Warehouse document by `warehouse_name`, walking its parent hierarchy.
That means it does not need you to hard-code ERPNext's company abbreviation suffix.

## Suggested Item Group tree

The staging file maps:

- `A-服装` → `服装`
- `B-鞋袜` → `鞋袜`
- `C-头饰` → `头饰`
- `D-道具` → `道具`

Suggested parent group: `演出用品`

The uploader does not create missing groups or UOMs by default. Run `check` first.

## UOMs present in the source

`个`, `套`, `件`, `双`, `条`, `把`, `包`, `板`, `张`, `盒`

If you want the script to create missing Item Groups/UOMs, set the corresponding flags in
`migration_config.json` to `true`.

## How to run

Create an ERPNext API key/secret for a user with permission to manage Item, File, UOM, Item Group,
and Warehouse read access.

Set environment variables:

### Linux/macOS

```bash
export ERP_URL="https://your-erp-site.example"
export ERP_API_KEY="..."
export ERP_API_SECRET="..."
```

### PowerShell

```powershell
$env:ERP_URL="https://your-erp-site.example"
$env:ERP_API_KEY="..."
$env:ERP_API_SECRET="..."
```

Install requests if necessary:

```bash
python -m pip install requests
```

### 1. Validate the target system

```bash
python upload_costumes.py check
```

This verifies the `第2寺院 / A04` warehouse and reports any missing Item Groups/UOMs.

### 2. Import/update the 96 Item masters

```bash
python upload_costumes.py items
```

### 3. Attach the 114 image files and set each Item's first image as its primary image

```bash
python upload_costumes.py images
```

Or perform both:

```bash
python upload_costumes.py all
```

The image operation is designed to be rerunnable: an already-attached image with the same filename is skipped.

## Opening stock

Do **not** post the quantity values blindly as part of the Item/image import.

ERPNext opening stock is an inventory/accounting transaction and requires a valuation rate.
Use `opening_stock_A04_staging.csv` to prepare a Stock Reconciliation with Purpose = Opening Stock.
All rows belong to the A04 warehouse under 第2寺院.

The staging file deliberately leaves `valuation_rate` blank so you can decide the appropriate valuation policy before submission.
