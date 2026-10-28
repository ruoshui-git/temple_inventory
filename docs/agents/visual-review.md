# Visual browser review

## Font preflight

Before every visual browser inspection, launch the browser command under `scripts/ui-visual-preflight`. It finds a readable Noto Sans CJK font, creates an isolated Fontconfig config/cache, runs `fc-cache`, and confirms the Chinese sans-serif match advertises `zh`. Known font files include `/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf` and `/tmp/NotoSansSC.ttf`; the script also checks system Noto paths. If no font is available, install the platform’s Noto CJK package (Debian/Ubuntu: `fonts-noto-cjk`) or set `TEMPLE_UI_CJK_FONT`, then rerun. The dev image includes the package; use `scripts/dx` for container commands. Do not change product font setup.

## Ad hoc Chromium screenshots

Use `/usr/bin/chromium-headless-shell` through `frontend/node_modules/@playwright/test`, with `--no-sandbox` and `--host-resolver-rules=MAP development.localhost 127.0.0.1`; Node cannot resolve that hostname by itself. Run the browser process beneath `scripts/ui-visual-preflight` so it inherits the verified font config. Log in from the page with `fetch('/api/method/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({usr:'Administrator', pwd:'admin'})})`. Navigate to `http://development.localhost:8000/inventory/...` and wait for data to load unless deliberately capturing loading UI.

Save review evidence under the gitignored `notes/evidence/<date>-<topic>/`. Container scripts can write under `/workspace`; host and container `/tmp` directories are not shared. Do not add evidence to committed paths.

Inspect realistic Chinese and long names at desktop, phone and 1024px; cover density/text scaling, retained refresh, image placeholders, scroll containment, keyboard access and overlapping touch targets. Distinguish fixture browser results from live-service or device evidence.
