# Costume sample data package

Source: Notion export supplied by the user.

## What is in this package

- `costumes_source_normalized.csv` — all 96 source records, normalized but preserving the original information.
- `image_manifest.csv` — maps all 114 images to Item Codes and identifies the primary image.
- `../sample_assets/images/costumes/` — optimized images used by the canonical installer.
- `../sample_assets/manifest.json` — optimized image manifest used by the canonical installer.

## Warehouse assumption

Every source record is physically in:

- Site/group warehouse: `第2寺院`
- Room warehouse: `A04`

The canonical installer resolves the actual ERPNext Warehouse document by its warehouse labels and hierarchy.

## Suggested Item Group tree

The source file maps:

- `A-服装` → `服装`
- `B-鞋袜` → `鞋袜`
- `C-头饰` → `头饰`
- `D-道具` → `道具`

Suggested parent group: `演出用品`

The canonical installer creates the required Item Groups and uses the standard ERPNext stock UOM `Nos`.

## UOMs present in the source

`个`, `套`, `件`, `双`, `条`, `把`, `包`, `板`, `张`, `盒`

## How to run

Use the repository's canonical development reset from the Bench root:

```bash
./apps/temple_inventory/scripts/reset-development-samples --site development.localhost
```

The reset reinstalls the disposable site and imports this CSV together with the optimized image bundle.

## Opening stock

Opening stock is created by the canonical installer as part of the disposable development reset.
