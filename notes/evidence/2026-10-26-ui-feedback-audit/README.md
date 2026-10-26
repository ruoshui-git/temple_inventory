# UI feedback batch — 2026-10-26

Evidence for the 21-item feedback batch on `feature/ui-feedback-batch`.
Screenshots were converted to JPEG to keep the folder small.

- `a/` — reproductions of the reported issues before the changes (hover
  inset, table edge glitch, stock popover, picker multi-add timing, item
  creation, conversion drawer, draft reopen timing, cropper, scanner, recent
  records, toasts, picker rail).
- `routes/` — every main route at 1440×900 (`-d`) and 390×844 (`-p`) before
  the changes; `mobile/` — touch-emulated phone, small phone, landscape and
  on-screen-keyboard checks.
- `t1/` … `t7/` — after-change captures from each implementation task:
  t1 data loading timings, t2 shared UI (hover, table edges, autocomplete,
  confirm, cropper, scanner, toasts, landscape shell), t3 item creation and
  lifecycle, t4 movement editor (batch cards, conversion dialog, sticky
  toolbar, reopen skeleton), t5 browse pages, t6 forms and confirmations,
  t7 polish.
- `*.mjs` — the Playwright scripts that produced the audit captures (run
  through `scripts/dx scripts/heavy scripts/ui-visual-preflight node …`).

Measured on development.localhost:

| Flow | Before | After |
| --- | ---: | ---: |
| Add six picked items until lines render | 16.6 s | 0.1 s |
| Reopen a six-line Receive draft until editable | 9.9 s | 0.3–0.5 s |
