### Temple Inventory

Custom Inventory Frontend For ERPNext

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch version-16
bench install-app temple_inventory
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/temple_inventory
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit

### Development sample reset

For a disposable development site only, rebuild the complete site database and load
all Temple Inventory sample catalog, opening stock, images, and representative
inventory movements:

```bash
./apps/temple_inventory/scripts/reset-development-samples --site development.localhost
```

The command requires `developer_mode=1` and an exact `RESET <site>` confirmation.
It permanently removes all database records, does not create a backup, and must
never be used on a production site. Progress, server errors, and tracebacks are
shown directly in the terminal and written to `logs/temple-sample-reset-*.log`.

The site name is configurable and must already exist in this Bench:

```bash
./apps/temple_inventory/scripts/reset-development-samples --site inventory-demo
```

For a disposable presentation site that is not configured with `developer_mode=1`,
both explicit override flags are required:

```bash
./apps/temple_inventory/scripts/reset-development-samples \
	--site inventory-demo \
	--allow-non-developer \
	--yes-i-understand-this-is-destructive
```

This still permanently reinstalls the database and is not appropriate for a live
production site. Use a separate disposable presentation site or the non-destructive
sample merge workflow instead.

### Development sample merge

To add missing sample Items, images, warehouses, zero-balance opening stock, and
production-style sample movements to an existing development site, run this
non-whitelisted function from `bench console`:

```python
from temple_inventory.setup.merge_sample_data import run
report = run(company="Org")
```

The merge requires `developer_mode=1`, runs as Administrator, preserves existing
non-zero balances and primary images, and prints/returns a structured
`completed` or `completed_with_errors` report. It is not exposed in Desk, HTTP,
or background jobs.
