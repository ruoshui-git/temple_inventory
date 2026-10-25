### Temple Inventory

Custom Inventory Frontend For ERPNext

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch main
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

Seeding takes several minutes, so the reset saves the seeded site (database and
files) under `development/.sample-snapshots/` and restores it on later resets
instead of seeding again. [scripts/sample-snapshot](scripts/sample-snapshot) keys a
snapshot by the app's backend source (tests excluded), the Frappe and ERPNext
commits and the seed arguments. A snapshot is used only on the day, in the site's
time zone, it was seeded, because sample dates are relative to that day. Pass
`--no-snapshot` to seed from scratch. CI caches the same snapshot between runs.

#### Development database credentials

In the development stack, MariaDB runs on host `mariadb` with root user `root` and
password `123`, set by `MYSQL_ROOT_PASSWORD` in [dev/compose.yaml](dev/compose.yaml).
This is a local development credential only; it is unrelated to the site's
`Administrator` password (`admin`). A non-interactive reset, from the bench root on
the WSL host:

```bash
echo "RESET development.localhost" | apps/temple_inventory/scripts/dx env MARIADB_ROOT_PASSWORD=123 \
	./apps/temple_inventory/scripts/reset-development-samples --site development.localhost
```

If the compose file changes the password, that file is the source of truth.
It permanently removes all database records, does not create a backup, and must
never be used on a production site. Progress, server errors, and tracebacks are
shown directly in the terminal and written to `logs/temple-sample-reset-*.log`.
The script accepts only `development.localhost`. The public sample site is created
once by [deploy/sample/bootstrap.sh](deploy/sample/bootstrap.sh); see
[deploy/README.md](deploy/README.md).

### Development environment and deployment

Agents and Git run on the WSL2 host; Bench, MariaDB and Redis run in Docker. See
AGENTS.md ("Development environment") for the `scripts/dx` wrapper and compose
commands, and [deploy/README.md](deploy/README.md) for the sample deployment that
every push to `main` triggers.

### Running the app locally

Run these from this app's directory in a WSL terminal (VS Code opened on the WSL
folder, not "Reopen in Container").

1. **Start the stack.** This starts MariaDB, Redis, `bench serve` (the `web`
   service, port 8000) and `bench worker`. They restart on their own after a
   reboot, so you only need this after `docker compose ... down`:

   ```bash
   docker compose -f dev/compose.yaml up -d
   ```

   Python changes reload automatically. Run
   `docker compose -f dev/compose.yaml restart web worker` after changing hooks or
   if the server looks stuck. Server logs:
   `docker compose -f dev/compose.yaml logs -f web worker`.

2. **Frontend with hot reload (optional).** Port 8000 serves the last
   `pnpm build`. For live editing, run the Vite dev server in the container. It
   serves on port 8080 and passes API calls through to port 8000. Stop it with
   Ctrl+C:

   ```bash
   cd frontend
   ../scripts/dx pnpm dev --host 0.0.0.0
   ```

   To see frontend changes on port 8000 instead, rebuild with
   `../scripts/dx ../scripts/heavy pnpm build`.

3. **Open it.** Log in as `Administrator` / `admin`.

   | What | URL |
   |---|---|
   | Inventory app, built (port 8000) | <http://localhost:8000/inventory> |
   | Inventory app, Vite hot reload (port 8080) | <http://localhost:8080/inventory/> |
   | ERPNext Desk | <http://localhost:8000/desk> |

   `localhost:8000` serves the default site, `development.localhost`.
   `http://development.localhost:8000` also works in Chrome and Edge.

#### Reaching the servers from a Windows browser

The ports are published on WSL's `localhost`. The former devcontainer worked
because VS Code tunnelled its ports. Since the move to WSL, Windows reaches WSL
only through WSL's own networking, and plain localhost forwarding does not work
on this machine. Even a bare `python3 -m http.server` on WSL's `127.0.0.1` is
unreachable from Windows.

**Recommended: mirrored networking.** Windows and WSL then share `localhost`, so
every URL above works as written in a Windows browser. That includes the
service-worker, PWA-install and camera-scanner features, which browsers allow only
on `localhost` or HTTPS. Do this once:

1. Add to `C:\Users\<you>\.wslconfig`, under the existing `[wsl2]` section:

   ```ini
   networkingMode=mirrored
   ```

2. In PowerShell, run `wsl --shutdown`. This stops every WSL session, the Docker
   stack and any agent running in WSL, so save your work first. Then reopen your
   WSL terminal or VS Code window. Docker brings the stack back up by itself.

This needs Windows 11 22H2 or later; this machine has build 26300 with WSL 2.7.8.

**Fallback without restarting WSL: the WSL IP address.** Publish the ports on
every WSL interface, then browse to WSL's IP:

```bash
TI_DEV_BIND=0.0.0.0 docker compose -f dev/compose.yaml up -d
hostname -I | awk '{print $1}'   # e.g. 172.28.172.239; changes after each WSL restart
```

Then open `http://<that IP>:8000/inventory` or `http://<that IP>:8080/inventory/`.
A plain-HTTP IP address is not a secure context, so PWA install, the service worker
and the camera scanner do not work there. To go back to loopback-only, run
`docker compose -f dev/compose.yaml up -d` without the variable. The WSL IP is
reachable only from this PC, not from the rest of the network.

To test PWA install against a real HTTPS site without any of this, use the sample
deployment at <https://sample.kufang.online/inventory>.
