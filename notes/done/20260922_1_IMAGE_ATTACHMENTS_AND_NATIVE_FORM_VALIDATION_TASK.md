# Task 1: Image Previews, Attachments, and Native Form Validation

## Status and authority

This is an implementation handoff based on investigation performed on
2026-09-22. It covers the remaining frontend defects reported after the scanner,
navigation, and datatable work.

Preserve unrelated working-tree changes. Do not edit generated files under
`temple_inventory/public/frontend/` or `temple_inventory/www/inventory.html` by
hand. The user will perform manual browser/device validation; do not run
Playwright or launch a browser unless separately requested.

## Confirmed reset-and-seed conclusion

The failure from
`logs/temple-sample-reset-20260921T150002Z.log` was a real warehouse-contract
failure in the code used for that reset, but it was not caused by stale data or
an old schema:

- the log begins with a complete destructive site reinstall;
- all three applications were installed afresh;
- sample warehouse, catalog, stock, image, and transaction installation
  completed successfully;
- only the post-install `verify_development_sample` call failed;
- ordinary group/Room Warehouses such as `第1寺院 - O` and `A02 - O` had
  incorrectly inherited `ti_fallback_role = room_default`; and
- the generated fallback leaves were not the rows named by the verifier's
  errors.

This was the Frappe nested-set/custom-field propagation defect documented in
`_canonicalize_fallback_roles()`. Commit `938dafc` (2026-09-21 15:45 UTC), made
after the failing reset log (15:00 UTC), changed warehouse creation to clear all
fallback roles after the final nested-set updates and then assign roles only to
the intended fallback leaves.

The current revision was verified read-only on `development.localhost`:

```json
{"company":"Org","physical_groups":12,"rooms":10,"fallback_roles":{"group_default":1,"room_default":10},"allowed_leaves":11}
```

No additional warehouse implementation or data migration is required for this
report unless a fresh reset using the current revision reproduces the contract
failure.

The trailing `NameError: name 'temple_inventory' is not defined` is secondary.
Frappe Bench catches every exception raised by `frappe.get_attr(method)`, then
tries to evaluate the dotted method string as Python source. That fallback
masks/repeats the original `ValidationError`; it is not a separate missing-app
or import failure.

One diagnostic limitation is worth preserving in future script maintenance:
the reset script pipes `run_reset` into the log, but runs the final verifier
after that pipe has closed. Therefore “Full output saved to” does not currently
include verifier output. Do not turn this observation into unrelated framework
work; if the reset wrapper is touched, append the verification output/status to
the same log while retaining the original exit status and readable console
output.

## Goal

Make list image previews dismissible without redundant close icons, make Item
Detail a true large-image/read-only-first view, let iOS use its native file/photo
chooser, put transaction attachments before signatures, and make Workspace and
Reconciliation submission use valid browser forms with conditional native
required-field validation.

Keep server-side validation authoritative. Native validation is earlier,
friendlier feedback, not a replacement for `workspace_api._audit_check()` or
stock/reconciliation validation.

## Confirmed frontend causes

### Shared preview used for two incompatible jobs

`ItemImagePreview.vue` is a 52x52 list thumbnail that opens a popover. A mouse
click always sets `pinned = true`; clicking again only calls `show(false)` and
can never toggle it closed. On desktop the backdrop has `pointer-events: none`,
so its `@click.self` close path cannot run. The visible close button or Escape is
currently the only reliable way to unpin it.

Item Detail reuses this same thumbnail/popover component as its gallery hero.
That is the wrong interaction contract for a large primary image. CSS attempts
to resize descendants under `.item-gallery`, but the component still carries
thumbnail dimensions and popover/pinning behavior.

### Item attachments are permission-editable instead of mode-editable

Item Detail passes `:editable="item.can_edit"` to `AttachmentList`. A user with
write permission therefore sees upload, remove, and set-primary controls even
while the page is in its default view mode. These controls must additionally be
gated by the page's explicit `editing` state.

### iPhone camera is explicitly forced

All real attachment sections already use the shared `AttachmentList.vue`:
Workspace, Reconciliation, Item Detail, and read-only Loan Detail. The component
sets `capture="environment"`, which asks mobile Safari for direct rear-camera
capture. Removing `capture` while retaining an appropriate file `accept` value
allows iOS to present its native choice of Files, camera, or photo library.

`ItemPicker.vue` has a separate new-Item image field, not a transaction
attachment section, and it already has no `capture` attribute. Do not create a
second attachment component or conflate Item creation with attached `File`
records.

### Required controls are not owned by a submit form

Workspace's main editor and Reconciliation are composed from sections and
ordinary `type="button"` controls rather than one submission `<form>`. Some
inputs already say `required`, but the browser never runs constraint validation
before `showReview()`/opening the reconciliation review dialog.

Signatures are canvases, so their required state also needs a form-associated
validation contract. `SignaturePad` always paints a required marker today but
does not expose a native required control and has no optional/required prop.

## Workstream A — separate list previews from the Item gallery

1. Keep one reusable list-thumbnail preview behavior for Inventory, Expiry,
   Loans, and Loan Detail.
2. Remove the visible `×` control from transient list/datatable preview boxes.
3. Do not merely delete the button while retaining the current pinned state.
   A mouse/touch click must toggle the preview, and an open clicked preview must
   close through an intuitive outside click and Escape. Hover previews should
   still disappear after leaving the thumbnail/preview interaction area.
4. Preserve keyboard access, an accurate `aria-expanded`, focus restoration
   where appropriate, and usable mobile dismissal. No user may be trapped with
   a pinned preview after the visible close control is removed.
5. Give Item Detail a deliberate gallery/hero contract rather than treating the
   hero as a 52x52 list thumbnail. A plain responsive image is acceptable; a
   component variant is also acceptable if its API makes the distinction
   explicit.
6. The selected Item image should be visibly large (target approximately
   320–420 CSS pixels when space permits), responsive on narrow screens,
   contained without distortion, and accompanied by the existing selectable
   thumbnail strip.
7. Clicking the Item Detail hero must not open the known non-dismissible list
   popover. If a full-screen/lightbox interaction is deliberately retained, it
   must have tested click/tap, outside-click, and Escape dismissal.

Do not add page-specific event listeners that duplicate the shared list-preview
lifecycle.

## Workstream B — make Item Detail read-only first

1. Continue showing existing attachments and images in view mode.
2. Show upload, remove, and `设为主图` controls only when both conditions hold:
   the API grants Item edit capability and the user has entered Item Detail's
   explicit edit mode.
3. Leaving/cancelling edit mode immediately restores a view-only attachment
   surface. Do not mistake frontend hiding for authorization; retain the current
   server permission checks.
4. Verify that users without `can_edit` never receive edit controls.

## Workstream C — use the native iOS file/photo chooser everywhere

1. Remove `capture="environment"` from the shared attachment file input.
2. Keep `multiple`, supported image/document `accept` types, ordinary desktop
   file selection, and the existing upload event contract.
3. Use copy such as `选择文件或照片` rather than promising that clicking the
   control directly takes a photo.
4. Keep every attachment surface on `AttachmentList`; do not introduce raw file
   inputs in Workspace, Reconciliation, Item Detail, or Loan Detail.
5. Audit the source after the change. Any remaining `capture` attribute must
   have a separately documented feature reason and must not belong to an
   attachment upload.

Expected device behavior is supplied by the operating system/browser. Do not
build a custom three-option menu.

## Workstream D — reorder attachments before signatures

For both transaction submission surfaces:

- Workspace (all movement kinds rendered by `Workspace.vue`); and
- Reconciliation (`Reconciliation.vue`),

place the shared attachment section after the transaction content/notes and
before the responsibility/signature section. In completed/read-only views keep
the same understandable record order, with no upload/remove controls.

Uploading an attachment may continue to create/save a draft as needed. It must
not submit stock, bypass autosave serialization, invalidate a signature
incorrectly, or open the final review dialog.

## Workstream E — real forms and conditional native validation

### Form structure

1. Give each editable Workspace and Reconciliation submission surface a valid
   HTML `<form>` with an explicit `@submit.prevent` handler that opens its review
   step only after browser constraint validation passes.
2. Make the primary `提交`/review button `type="submit"`. Give every other button
   an explicit non-submit type unless it intentionally submits its own form.
3. Avoid nested forms. Workspace already has separate forms for the line drawer
   and new Activity dialog; move/teleport those dialogs outside the main form or
   otherwise structure ownership with valid HTML.
4. Preserve autosave, revision conflicts, final confirmation idempotency, modal
   focus management, and server error display.

### Required fields

Use native required controls (and accessible visible required labels) for all
scalar fields that are required for the active operation, including at minimum:

- Workspace date/time when manual values are active;
- Workspace handler name;
- Workspace borrower when Loan does not declare that the borrower is the
  handler or witness;
- Workspace reviewer name only when an independent reviewer is required;
- Reconciliation warehouse;
- Reconciliation handler name; and
- Reconciliation reviewer name only when an independent reviewer is required.

Dynamic line/business rules such as “at least one Item,” completed signature
drawing, whole-count row state, permitted Warehouses, stock, batches, and stale
attestations remain server/client business validation as applicable. Where a
missing signature must participate in the requested pre-review browser prompt,
extend `SignaturePad` with an explicit `required` contract backed by a
form-associated constraint-validation control. On invalid, present/focus the
visible signature interaction and an understandable message; do not focus an
invisible dead-end control.

`SignaturePad` must not display a required marker when it is genuinely optional.
Handler signature is required. Reviewer signature is required only while an
independent reviewer is active.

### `无独立鉴证人` conditional behavior

- When selected, reviewer name and reviewer signature are not required and
  must not remain as hidden successful/invalid controls that block submission.
- When cleared, both reviewer name and reviewer signature immediately become
  visible and required.
- Toggling the choice must update browser validity without losing unrelated
  form input.
- Keep `workspace_api._audit_check()` as the final authority for the identical
  rule.

Workspace currently performs some hand-written checks in `showReview()`. Keep
business checks that HTML cannot express, but do not duplicate ordinary empty
text-field validation in a way that prevents the browser from focusing and
prompting the invalid control.

Apply the same rule to Reconciliation, whose backend already calls
`_audit_check()` but whose current frontend does not mark audit fields required.

## Required automated coverage

Add or update focused frontend tests for:

1. list preview hover, click-toggle, outside-click, and Escape dismissal with no
   visible `×` control;
2. Item Detail's large hero contract and absence of the list popover trap;
3. Item attachments read-only by default, editable only in explicit edit mode,
   and permanently read-only without `can_edit`;
4. `AttachmentList` having no `capture` attribute while retaining `accept`,
   `multiple`, upload emission, metadata, removal, and Item-only primary-image
   capability;
5. Workspace and Reconciliation rendering valid submission forms with their
   attachments before signatures;
6. submit buttons using native submit behavior;
7. missing active required controls blocking the review step;
8. `无独立鉴证人` removing reviewer name/signature from the active required
   set, and clearing it restoring both requirements; and
9. SignaturePad required/optional validity behavior and accessible error focus.

Do not weaken backend audit tests. Add backend coverage only if implementation
changes backend behavior; this task should ordinarily be frontend-only.

## Validation gate

From `frontend/`, run:

```sh
yarn test frontend/tests/attachments.test.ts <new focused test files>
yarn type-check
yarn test
```

Run `yarn build` only if the final implementation changes production bundling,
generated integration assets, or routing. Do not hand-edit generated output.

Manual handoff should explicitly ask the user to verify on iPhone Safari that
the attachment control offers the native Files/camera/photo-library choices;
unit tests can prove only that the forcing `capture` attribute is absent.

## Completion checklist

- [ ] No list/datatable image preview displays an `×` button.
- [ ] Clicked/tapped previews can still be dismissed without a mouse.
- [ ] Item Detail displays a genuinely large selected image.
- [ ] Item attachment mutation controls appear only in explicit edit mode.
- [ ] Shared attachment inputs do not force camera capture.
- [ ] Workspace and Reconciliation attachments precede signatures.
- [ ] Both submission surfaces use valid, non-nested HTML forms.
- [ ] Native required-field validation runs before review opens.
- [ ] Reviewer requirements toggle correctly with `无独立鉴证人`.
- [ ] Server-side permission, audit, stock, and signature checks remain intact.
- [ ] Focused tests, full frontend tests, and type checking pass.
- [ ] iPhone native chooser behavior is left as a clearly stated manual check.
