# BIQ Map Field Projection Matrix

## Purpose

This document records how high-risk BIQ map fields move through the C3X editor pipeline:

1. raw BIQ storage
2. map-tab projection
3. renderer display helpers
4. edit-time source of truth
5. save-time source of truth
6. repair or validation rules

Use it with:

- `docs/biq/MapPipelineParity.md`
- `docs/biq/MapSectionMutationMatrix.md`
- `docs/biq/invariants.md`

## Core Projection Rules

### Raw record authority

When `buildMapTabFromBiq(...)` projects BIQ data into the map tab:

- raw BIQ section records are cloned into the editable record object
- projected UI fields receive `originalValue` from the raw record property
- the direct record property remains the authoritative raw value for save collection

This is the key rule that keeps display formatting from becoming save truth.

### Renderer read layers

For map records, renderer helpers conceptually distinguish three values:

- raw value: preserved BIQ value
- display value: UI-oriented string shown in controls or labels
- stored value: raw value unless the user explicitly edited the field in the map editor

Current important helpers:

- `getMapFieldStoredValue(...)`
- `setMapFieldValue(...)`
- `getFieldRawValue(...)`
- `getFieldDisplayValue(...)`

### Edit marker rule

`mapEditorValueEdited` means:

- use `field.value` as the current user-edited source
- do not fall back to `originalValue` for save or renderer stored-value reads

If `mapEditorValueEdited` is absent:

- `originalValue` is treated as the raw BIQ truth

## Matrix

## `TILE.city`

### Raw BIQ storage

- stored on `TILE` as a city section index

### Projected map-tab value

- direct record property: `record.city`
- field layer: `field.value` for UI, `field.originalValue` from raw `record.city`

### Display behavior

- may be rendered or resolved via city title/lookups
- UI can show city-oriented labels, but save must not use those labels

### Edit source of truth

- if user changed the tile field through map editing: `field.value`
- otherwise: raw `record.city` / `field.originalValue`

### Save source of truth

- `collectBiqMapEdits(...)` prefers direct record value via `getRawMapFieldValue(...)`
- save ignores display-only city labels

### Repair / validation

- `CITY` delete/reindex cascades rewrite `TILE.city`
- post-apply audit checks:
  - valid city ref range
  - matching city coordinates
  - exactly one tile backreference per city

## `TILE.colony`

### Raw BIQ storage

- stored on `TILE` as a colony section index

### Projected map-tab value

- direct record property: `record.colony`
- field layer: `field.value` plus raw `field.originalValue`

### Display behavior

- renderer may derive visible colony-like type from tile overlay bits
- the stored ref still identifies the owning `CLNY` record

### Edit source of truth

- user-edited field value if `mapEditorValueEdited`
- otherwise raw `record.colony`

### Save source of truth

- direct raw record property when unedited
- field value when explicitly edited

### Repair / validation

- `CLNY` delete/reindex cascades rewrite `TILE.colony`
- post-apply audit checks:
  - valid colony ref range
  - matching colony coordinates
  - exactly one tile backreference per colony

## `TILE.c3cOverlays`

### Raw BIQ storage

- stored on `TILE` as the packed Conquests overlay bitmask

### Projected map-tab value

- direct record property: `record.c3cOverlays`
- field `originalValue` preserves raw mask

### Display behavior

- renderer derives visible airfield / radar tower / outpost state from overlay bits
- this is intentionally preferred over stale `CLNY.improvementType` when deciding what the tile looks like

### Edit source of truth

- current field value if explicitly edited
- otherwise raw direct property

### Save source of truth

- direct raw property when unedited
- edited field value when touched by map tools

### Repair / validation

- colony-like edits are expected to keep overlay semantics coherent
- post-apply colony coherence audit checks overlay type versus `CLNY.improvementType`

## `TILE.baseRealTerrain` / `TILE.c3cBaseRealTerrain`

### Raw BIQ storage

- packed terrain bytes on `TILE`

### Projected map-tab value

- direct raw packed property is preserved
- editor tools may expose decoded terrain/base-terrain semantics

### Display behavior

- renderer and map tools decode packed terrain into base/real terrain concepts
- displayed terrain identity is derived, not the save source by itself

### Edit source of truth

- edited packed field value or map-tool-generated packed value

### Save source of truth

- packed direct record property or edited field value

### Repair / validation

- terrain paint tools are expected to keep packed terrain fields coherent
- tile coordinates and image/file derivation remain downstream concerns

## `CITY.ownerType` / `CITY.owner`

### Raw BIQ storage

- stored directly on `CITY`

### Projected map-tab value

- direct record properties: `record.ownerType`, `record.owner`
- field `originalValue` stores raw BIQ numeric values

### Display behavior

- owner pickers may show civ/player names and thumbnails
- renderer can derive picker values from raw owner fields

### Edit source of truth

- explicit owner changes use `setMapFieldValue(...)`
- that marks `mapEditorValueEdited` and updates field values

### Save source of truth

- save collector uses direct raw record property when not edited
- otherwise uses edited field value

### Repair / validation

- `RACE` delete shifts civ-owned city owners
- `LEAD` delete removes player-owned cities with deleted owners
- post-apply audit validates owner ref and coordinate coherence

## `UNIT.ownerType` / `UNIT.owner`

### Raw BIQ storage

- stored directly on `UNIT`

### Projected map-tab value

- raw properties preserved on the record object
- field `originalValue` tracks raw BIQ values

### Display behavior

- unit owner picker may show human-friendly civ/player info
- stacked-unit UI may apply one owner choice across colocated units

### Edit source of truth

- explicit unit owner edits set field values and mark them edited

### Save source of truth

- direct record property when untouched
- edited field value when changed in the map editor

### Repair / validation

- `RACE` delete shifts civ-owned unit owners
- `LEAD` delete removes player-owned units with deleted owners
- post-apply audit validates owner refs and coordinates

## `UNIT.pRTONumber`

### Raw BIQ storage

- stored directly on `UNIT` as a `PRTO` section index

### Projected map-tab value

- direct record property: `record.pRTONumber`
- field `originalValue` stores the raw index

### Display behavior

- add/edit UI may resolve the index to a unit name
- display name is never the save source

### Edit source of truth

- explicit unit type edit in the map UI
- or newly added unit record created by map tools

### Save source of truth

- direct raw property or explicit field edit value

### Repair / validation

- `PRTO` delete/reindex cascades rewrite `UNIT.pRTONumber`
- save-time unsafe delete checks block deleting unit types still used by placed units or player start-unit defs

## `SLOC.ownerType` / `SLOC.owner`

### Raw BIQ storage

- stored directly on `SLOC`

### Projected map-tab value

- raw properties preserved on the record object
- fields carry raw `originalValue`

### Display behavior

- starting-location UI may show owner names rather than numeric refs

### Edit source of truth

- explicit field edits or `addOrUpdateStartingLocation(...)`

### Save source of truth

- direct record property when untouched
- edited field value when changed

### Repair / validation

- `RACE` delete shifts civ-owned `SLOC` owners
- `LEAD` delete removes or shifts player-owned `SLOC`
- post-apply audit validates owner refs and in-bounds coordinates

## `CLNY.ownerType` / `CLNY.owner`

### Raw BIQ storage

- stored directly on `CLNY`

### Projected map-tab value

- raw properties preserved on the record
- fields get raw `originalValue`

### Display behavior

- renderer combines colony ownership from `CLNY` with visible type derived from tile overlays

### Edit source of truth

- explicit field edits in map tools

### Save source of truth

- direct raw property when untouched
- edited field value when changed

### Repair / validation

- `RACE` delete shifts civ-owned colony owners
- `LEAD` delete removes player-owned colonies with deleted owners
- post-apply audit validates owner refs and tile-coord coherence

## `CLNY.improvementType`

### Raw BIQ storage

- stored directly on `CLNY`

### Projected map-tab value

- raw property preserved on the record
- field `originalValue` mirrors the BIQ value

### Display behavior

- not the sole visual source of truth for airfield/radar/outpost appearance
- visible type is derived with help from `TILE.c3cOverlays`

### Edit source of truth

- map edits that change colony-like improvement state

### Save source of truth

- direct raw property or edited field value

### Repair / validation

- colony overlay coherence audit checks whether `CLNY.improvementType` agrees with the tile overlay bits after save

## `scenarioDistricts` sidecar-only fields

### Raw BIQ storage

- not stored in BIQ bytes

### Projected map-tab value

- attached on `mapTab.scenarioDistricts`
- tile records may also carry temporary district-facing UI fields

### Display behavior

- used by district and named-tile editing UI

### Edit source of truth

- sidecar metadata collections, not BIQ fields

### Save source of truth

- serialized into `scenario.districts.txt`
- explicitly skipped by `collectBiqMapEdits(...)`

### Repair / validation

- no BIQ index cascade
- relies on sidecar serialization and reload behavior instead

## Save-Truth Summary

For normal BIQ map saves, the intended precedence is:

1. if a field was explicitly edited in the map editor, save its current field value
2. otherwise save the direct raw record property preserved from BIQ load
3. never derive BIQ save values from display-only labels

This rule is the core defense against Quint drift caused by enriched UI strings.

## Remaining Mapping Work

The next useful parity pass after this matrix is the edited-save parity matrix:

- given a map operation class
- which BIQ sections are expected to change
- which sections must remain byte-stable

That is the last major documentation layer needed before the read/write pipeline is fully mapped from user edit to BIQ output boundary.
