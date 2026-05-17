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

Some UI features require a minimum C3X release. The mechanism is driven by the `c3xVersion` setting (`settings.json`), which stores the user's installed C3X release as a string like `'R28'`. An empty string means no filtering — all features are shown.

The default value is defined in the `defaults` object inside the `manager:get-settings` handler in `main.js`. Change it there to shift the baseline for users who have no saved setting yet.

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
- `c3xVersion` empty → all gated features are shown (safe default).
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
