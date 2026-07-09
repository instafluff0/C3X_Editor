# UI Invariants

## Purpose
Stable UI behavior contracts agents should preserve during implementation changes.

## Mode and Scope
- Keep editing scope explicit: `Standard Game` vs `Scenario`.
- Save/write logic must match active mode and file targets.

## Editing Experience
- Prefer structured controls for known schemas.
- Keep unknown fields visible and editable.
- Avoid hiding data behind destructive transforms.

## Scenario Safety Behavior
- Enforce scenario write fencing to allowed roots only.
- Keep `Scenario Search Folders` lock-managed and ignored on save payload writes.
- Copy Scenario must localize references and avoid back-linking into source assets.

## Hard Constraints
- `Terrain -> Terrain Types` (`TERR`) is structurally immutable in UI.
- Scenario saves must block unresolved new unit animation folder references when key edits cannot resolve valid INI paths.

## Save UX Contract
- In-app save status feedback only (snackbar + details modal).
- Preserve transactional semantics and explicit result states:
  - `Saving`
  - `Saved`
  - `Rolled Back`
  - `Failed`

## Save, Undo, and Undo All Synchronization
- Main UI and modal header actions must reflect the same underlying dirty and undo state. Do not maintain modal-only Save, Undo, or Undo All truth sources.
- Save is enabled only when there is saveable dirty data, the app is not loading/saving, a bundle is loaded, and validation is clear. Modal Save buttons must share the main Save handler and disabled-state rules.
- Undo is enabled only when there is an immediate undoable action, including pending grouped edit sessions that have not yet committed a snapshot.
- Undo All is enabled when there are effective unsaved changes, including normal dirty tabs, pending grouped edit sessions, and side-channel save state such as generated art or modal-managed metadata.
- Modal Save must not be active when the matching modal Undo action is inactive. If a modal exposes Save, Undo, and Undo All together, derive all three from the same immediate/effective predicates used by the main UI.
- After any Undo, Undo All, Save, no-reload clean-state update, or modal-local restore, recompute dirty state before refreshing buttons and badges. If later cleanup clears side-channel dirty state, refresh the main toolbar and active tab badges again after that cleanup.
- Dirty badges must describe actual pending data differences, not merely the currently selected row. Reference-tab restores should rebuild the row dirty cache for the affected tab when entries are replaced from a snapshot.
- Modal Undo should restore data without surprising navigation. Preserve the user's current modal view, filter, selected era, scroll anchor, or active pane unless the action explicitly changes navigation.
- Closing a modal after an in-modal restore must leave the main UI already consistent. If modal refresh is intentionally suppressed, mark the owning main tab for refresh on close.

## Reference CRUD and Undo
- Visible reference-tab state and hidden pending BIQ `recordOps` must move together.
- Capture Undo before mutating Add/Copy/Import/Delete `recordOps`; otherwise Undo can restore the visible list while leaving hidden pending BIQ operations behind.
- Deleting a pending unsaved entry should remove its create operation rather than creating a delete operation for a record that does not exist yet.
- Blank Add must clear both visible art fields and hidden pending art/import metadata so new entries do not inherit thumbnails or staged assets from the selected entry.

## Save Clean State and Dirty Badges
- Dirty badges, clean snapshots, reference ordering, and no-reload reconciliation are separate responsibilities.
- Do not fix save-state bugs with broad dirty-cache resets or full UI rebuilds unless the workflow genuinely requires it.
- No-reload saves must reconcile final BIQ indices, clear saved pending operations, update original field values, and then refresh only the UI surfaces whose data changed.
- VM-extracted renderer tests must include direct helper dependencies used by the extracted function; otherwise failures may reflect a harness gap rather than app behavior.

## Art Preview Contract
Supported previews:
- District PCX
- Wonder district PCX crops
- Natural wonder PCX and optional animation
- Tile animation INI to FLC

Playback rules:
- Preserve aspect ratio.
- Honor configured frame timing.

## C3X Version Gating

Some UI features require a minimum C3X release. The mechanism is driven by the `c3xVersion` setting (`settings.json`), which stores the user's installed C3X release as a string like `'R27'`.

The default value is defined in the `defaults` object inside the `manager:get-settings` handler in `main.js`. Change it there to shift the baseline for users who have no saved setting yet.

The app also defines `SUPPORTED_C3X_RELEASE` in `main.js` and `src/renderer.js`. Saved versions newer than that release are clamped back to the supported release, so forward-compatibility metadata can exist without exposing unfinished fields.

### Gating a whole tab

Add an entry to `TAB_MIN_RELEASE` in `src/renderer.js`:

```js
const TAB_MIN_RELEASE = Object.freeze({
  animations: 'R28',
  myNewTab: 'R29'   // ← add here
});
```

`renderTabs()` checks `isTabVersionAllowed(key)` and omits any tab whose minimum release exceeds `c3xVersion`.

### Gating a field within Districts, Wonder Districts, Natural Wonders, or Tile Animations

Add `minRelease` to the field object in `SECTION_SCHEMAS`:

```js
{ key: 'some_new_key', label: 'Some New Field', desc: '...', type: 'text', minRelease: 'R28' }
```

`isSectionFieldVersionAllowed(field)` is applied to every field in the `orderedSchemaFields` pipeline before rendering.

### Rules
- Settings normalization should keep `c3xVersion` at `SUPPORTED_C3X_RELEASE` until newer C3X support is ready.
- Renderer helpers treat an empty `c3xVersion` as "show all", but app settings should not persist an empty value.
- Both helpers reuse `parseReleaseNumber()`, which strips the leading `'R'` and compares integers.
- Gate the smallest unit possible: prefer field-level gating over tab-level gating unless the entire tab is new.

## Verification Gate
Before finalizing significant UI work:

```bash
node --check main.js
node --check src/renderer.js
node --check src/artPreview.js
npm test
```

Use `npm run test:biq` for UI changes that touch BIQ-backed reference behavior, save transactions, or parser/serializer contracts. Use `npm run test:full` as the release gate.

## Update Policy
- Keep this file to long-lived UI contracts.
- Put transient implementation details or one-off fixes in `docs/Quirks.md` until they are proven stable.
