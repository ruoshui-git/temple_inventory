from temple_inventory.setup import import_costumes as ic

cos_src = {
    "source_csv": "/workspace/development/frappe-bench/apps/temple_inventory/temple_inventory/setup/costumes-data/costumes_source_normalized.csv",
    "image_manifest_csv": "/workspace/development/frappe-bench/apps/temple_inventory/temple_inventory/setup/costumes-data/image_manifest.csv",
    "image_dir": "/workspace/development/frappe-bench/apps/temple_inventory/temple_inventory/setup/sample_assets/images/costumes",
}

ic.run(**cos_src)

ic.run(**cos_src,
    create_opening_stock=1,
    submit_opening_stock=0,
    dry_run=0,
)

import frappe
frappe.db.commit()

from temple_inventory.setup import sample_inventory_data as sid

sid.import_sample_data()

frappe.db.commit()