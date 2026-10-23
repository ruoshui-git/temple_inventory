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
the Temple Inventory catalog, opening stock, images, and representative inventory
movements. The costume catalog and its opening stock are real data and go into
`第2寺院 (T2) / A02`. All general demonstration items and movements use only the
`演示区` area (`演示室甲` with shelf `演示架1`, and `演示室乙`). ERPNext's default
warehouses are removed.

```bash
./apps/temple_inventory/scripts/reset-development-samples --site development.localhost
```

The command requires `developer_mode=1`, the MariaDB root password, and an exact
`RESET <site>` confirmation.

#### Devcontainer database credentials

In the development container, MariaDB runs on host `mariadb` with root user `root` and
password `123`, set by `MYSQL_ROOT_PASSWORD` in `/workspace/.devcontainer/docker-compose.yml`
(the frappe_docker devcontainer). This is a local development credential only; it is
unrelated to the site's `Administrator` password (`admin`). A non-interactive reset:

```bash
echo "RESET development.localhost" | MARIADB_ROOT_PASSWORD=123 \
	./apps/temple_inventory/scripts/reset-development-samples --site development.localhost
```

If the compose file changes the password, that file is the source of truth.
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
production site. Use a separate disposable presentation site.
