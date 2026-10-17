# Unit-test support

Native-shaped service fixtures and mount hosts retained from the retired gallery.
These are imported only by tests; there is no HTML, main, router or Vite entry.
Routed browser verification uses the production app with controlled HTTP contracts
in `tests/browser/fixtures/nativeUi.ts`. Historical visual reference: commit
`63c7f26` on `version-16`. Do not recreate a preview application.
