Help implement a scanning engine to the temple_inventory app based on the following investigation and impl plan.

Make the 

## Investigation result

The change can remain entirely frontend-side. The app already routes every camera scan through [Scanner.vue](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/components/Scanner.vue:1), which is used by:

- [Inventory.vue](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/pages/Inventory.vue:8)
- [Workspace.vue](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/pages/Workspace.vue:6)
- The uncommitted [Reconciliation.vue](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/pages/Reconciliation.vue:6)

The current loader in [scanner.ts](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/lib/scanner.ts:1) loads Frappe’s `Scanner`, which delegates to `html5-qrcode` 2.3.8. That path ultimately uses the older JavaScript ZXing implementation when the browser’s native `BarcodeDetector` is unavailable.

The proposed second engine should be the current `zxing-wasm` reader-only package, presently version 3.1.4. It exposes ZXing-C++ through WebAssembly, accepts `ImageData`, and its reader binary is approximately 1.04 MiB. The binary must match the JavaScript package version and be served separately. [Official package documentation](https://github.com/Sec-ant/zxing-wasm/blob/main/README.md#zxing-wasmreader), [package exports](https://raw.githubusercontent.com/Sec-ant/zxing-wasm/main/package.json).

No files were changed during this investigation.

## Implementation plan

### 1. Add and self-host the dependency

Update:

- [frontend/package.json](/workspace/development/frappe-bench/apps/temple_inventory/frontend/package.json:1)
- `frontend/yarn.lock`
- [frontend/vite.config.ts](/workspace/development/frappe-bench/apps/temple_inventory/frontend/vite.config.ts:1)

Actions:

1. Add an exact dependency on `zxing-wasm` 3.1.4. An exact pin is preferable because the project explicitly warns that its JavaScript and WASM versions must match.
2. Import only `zxing-wasm/reader`, not the larger full reader/writer build.
3. Import `zxing-wasm/reader/zxing_reader.wasm?url` so Vite emits a hashed, same-origin asset under the app’s `/assets/temple_inventory/frontend/` base.
4. Configure `prepareZXingModule()` with `locateFile` before the first decode so it uses that emitted URL instead of the package’s default jsDelivr CDN.
5. Add `wasm` to the PWA `globPatterns`. The current service-worker configuration precaches JavaScript, CSS, fonts, and icons but excludes WASM.
6. Do not copy the binary manually into generated `temple_inventory/public/frontend/`.

This keeps scanning usable in strict-CSP, unreliable-network, and installed-PWA scenarios. The package documentation confirms that initialization is lazy and supports a custom `locateFile`. [WASM serving guidance](https://github.com/Sec-ant/zxing-wasm/blob/main/README.md#configuring-wasm-serving).

### 2. Define the scanner abstraction

Refactor [frontend/src/lib/scanner.ts](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/lib/scanner.ts:1) into an engine-neutral service, or turn it into a small `src/lib/scanner/` directory if separation improves readability.

Suggested contracts:

```ts
type ScannerEngineId = 'frappe' | 'zxing-wasm'

interface ScannerEngine {
  readonly id: ScannerEngineId
  readonly label: string
  start(container: HTMLElement, onScan: (value: string) => void): Promise<void>
  stop(): Promise<void>
}

class ScannerService {
  readonly engineId: ScannerEngineId
  readonly engineLabel: string

  start(container: HTMLElement, onScan: (value: string) => void): Promise<void>
  stop(): Promise<void>
  selectEngine(id: ScannerEngineId): Promise<void>
}
```

Service responsibilities:

- Validate secure-context and camera availability.
- Own exactly one active engine and camera stream.
- Fully stop the old engine before starting another.
- Serialize overlapping start, stop, pause, and switch operations.
- Guard late-resolving initialization with a generation token or disposed flag.
- Normalize both engines to decoded strings and common camera errors.
- Store the selected engine in `localStorage`, using a namespaced key such as `temple_inventory.scanner_engine`.
- Validate stored values and default to `frappe`, preserving existing behavior for all users.
- Do not silently fall back when an engine fails. Show its error and let the tester deliberately switch engines.
- Allow dependency injection of engine factories for deterministic unit tests.

Keep these concerns outside the service:

- Two-second duplicate suppression
- The `paused` business state
- Manual/scanner-gun input
- Vue events and rendering

Those are shared UI behavior rather than decoder behavior.

### 3. Encapsulate the current Frappe implementation

Create a `FrappeScannerEngine` adapter around the existing loader logic.

Move the following out of `Scanner.vue` and into the adapter:

- Loading jQuery, `frappe.provide`, the scanner script, and `html5-qrcode`
- Creating Frappe’s `Scanner`
- Installing the explicit `Html5Qrcode` handler used to observe startup errors
- Waiting for pending camera startup during cleanup
- Calling `stop()` and `clear()`
- Emptying the supplied container

Preserve the existing Frappe configuration:

- Environment-facing camera
- 10 FPS
- 250-pixel scan box
- Continuous scanning

Do not modify Frappe or ERPNext core.

### 4. Implement `ZxingWasmScannerEngine`

The ZXing-WASM adapter should:

1. Lazily load `zxing-wasm/reader` and initialize its reader-only WASM once.
2. Request `getUserMedia` with:

```ts
{
  audio: false,
  video: { facingMode: { ideal: 'environment' } },
}
```

3. Create a `<video muted autoplay playsinline>` inside the supplied container.
4. Wait until valid video dimensions are available and call `video.play()`.
5. Draw frames into a reusable canvas and pass `ImageData` to `readBarcodes`.
6. Use a throttled, non-overlapping decode loop. Start around 200–300 ms between attempts; never queue another decode while one is still running.
7. Set `maxNumberOfSymbols: 1`. Initially leave supported formats broad so retail, custom Code 128/39, QR, and other existing labels continue to work. Avoid optimization by narrowing formats until real inventory labels have been inventoried.
8. Emit `results[0].text` when a result is found; treat an empty result as a normal frame rather than an error.
9. On stop:
   - Cancel the frame/timer loop.
   - Prevent any in-flight decode from emitting.
   - Stop every `MediaStreamTrack`.
   - Pause the video and clear `srcObject`.
   - Remove engine-created DOM.
10. If startup finishes after stop or an engine switch, immediately stop the newly returned stream rather than attaching it.

The official API accepts `ImageData` and returns an array of results asynchronously. [Reader API example](https://github.com/Sec-ant/zxing-wasm/blob/main/README.md#readbarcodes).

### 5. Make `Scanner.vue` engine-neutral

Update [Scanner.vue](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/components/Scanner.vue:1) to instantiate `ScannerService` instead of knowing about `Html5Qrcode`.

UI behavior:

- Show a very small technical line such as `扫描引擎：Frappe 内置` or `扫描引擎：ZXing-WASM`.
- Add a touch-friendly button beside it:
  - `切换到 ZXing-WASM`
  - `切换到 Frappe 内置`
- The label may use very small text, but the switch button must retain the app’s minimum 44-pixel touch target.
- Disable the switch button while a start/stop/switch is actively transitioning.
- Preserve the existing Chinese loading, pause, error, retry, manual-entry, and close controls.
- Keep duplicate suppression across engine switches so switching cannot immediately emit the same barcode twice.

Lifecycle behavior:

- Mount: start the stored/default engine.
- `paused = true`: stop the camera and release its tracks.
- `paused = false`: restart the currently selected engine.
- Session expiration: stop the camera.
- Session recovery while still mounted and not paused: restart it.
- Switch: await stop, update/persist the engine, clear the prior error, then start the new engine.
- Close/unmount: await or safely initiate complete cleanup.

Stopping on `paused` is important because the repository instructions explicitly require camera resources to be released while scanning is paused. The current component only suppresses scan events while leaving the camera active.

### 6. Add minimal styling

Update [frontend/src/style.css](/workspace/development/frappe-bench/apps/temple_inventory/frontend/src/style.css:1):

- Add a compact `.scanner-engine` row.
- Use approximately 10–11px for the engine label.
- Keep adequate contrast and permit wrapping on narrow phones.
- Give the generated `<video>` `width: 100%`, `height: auto`, and an appropriate maximum height/object-fit rule.
- Preserve the existing `.scanner-camera` minimum height without leaving it in place after an engine is stopped.

Avoid changing the three consuming pages; the shared component should deliver the new UI everywhere automatically.

### 7. Replace and expand scanner tests

Refactor [frontend/tests/scanner.test.ts](/workspace/development/frappe-bench/apps/temple_inventory/frontend/tests/scanner.test.ts:1) so it mocks the service contract rather than Frappe globals.

Cover:

- Frappe is the default when no preference exists.
- The current engine label and opposite-engine button are rendered.
- Switching stops the first engine before starting the second.
- The selected engine survives component remount/reload through `localStorage`.
- Invalid stored values fall back to Frappe.
- Duplicate frames are suppressed for both engines.
- Manual entry works regardless of engine startup failure.
- Pause stops the engine and unpause restarts it.
- Session expiry stops it.
- Close and unmount stop it.
- Late startup after unmount cannot leave an active stream or emit a scan.
- An engine loading failure leaves manual entry and the switch button usable.

Add focused service/adapter tests, preferably `frontend/tests/scanner-service.test.ts`, covering:

- Frappe loader caching and retry after a script-load failure.
- Frappe cleanup.
- ZXing WASM initialization uses the emitted URL.
- ZXing sends canvas `ImageData` to `readBarcodes`.
- Empty decode results are ignored.
- Decode calls never overlap.
- Stream tracks are stopped during pause, switch, failed initialization, and disposal.
- Results from stale in-flight decodes are discarded.

Do not launch Playwright as part of implementation unless separately requested.

### 8. Verification

Run from `frontend/`:

```sh
yarn test tests/scanner.test.ts tests/scanner-service.test.ts
yarn type-check
yarn build
```

After the build, verify:

- A hashed `zxing_reader*.wasm` exists in the generated frontend assets.
- The service worker precache manifest includes the WASM file.
- Built JavaScript contains no jsDelivr/unpkg runtime dependency.
- The WASM URL uses `/assets/temple_inventory/frontend/`.
- Existing scanner call sites require no API changes.
- Generated frontend files are not hand-edited or unintentionally committed contrary to repository practice.

## Manual acceptance matrix

Test the same representative labels with both engines on the same device:

- EAN-13 retail barcode
- Code 128 inventory label
- QR code
- Small, partially blurred, angled, and low-light labels
- Several labels in rapid succession
- Permission denied and no-camera cases
- Switching engines while active
- Pausing for item quantity/location confirmation
- Closing and reopening the scanner
- Installed/offline PWA after the WASM has been precached

Record time-to-first-read, missed reads, false reads, and battery/device heat informally. No telemetry should be introduced for this experiment unless separately requested.

## Completion criteria

The implementation is complete when every shared scanner panel identifies its active engine, can deliberately switch engines, remembers the selection, retains manual input, and never leaves camera tracks running after pause, close, session expiry, unmount, or an engine switch. Backend APIs and barcode lookup behavior must remain unchanged.

The implementer should preserve the existing dirty working tree, particularly the uncommitted reconciliation work and overlapping `style.css` changes.