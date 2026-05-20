# BIQ Map Unsupported And Quarantined Operations

## Purpose

This document is the explicit register of BIQ map mutation classes that are intentionally unsupported, blocked, or quarantined in the current C3X implementation.

Use it with:

- `docs/biq/MapPipelineParity.md`
- `docs/biq/MapSectionMutationMatrix.md`
- `docs/biq/MapFieldProjectionMatrix.md`
- `docs/biq/MapEditedSaveParityMatrix.md`
- `docs/biq/invariants.md`

## Policy

For BIQ map handling, current policy is:

- prefer fail-safe blocking over speculative repair
- prefer surgical edits over whole-map reconstruction
- prefer preserving raw BIQ semantics over normalizing through display labels

If a map mutation cannot be proven safe and Quint-compatible enough, save should fail or the path should remain explicitly quarantined.

## Categories

This register distinguishes:

- `Blocked`: rejected at save/apply time
- `Quarantined`: only allowed in a narrow explicit path, not in normal map editing
- `Unsupported safely`: not guaranteed correct; current code intentionally refuses to continue when encountered

## 1. Whole-map BIQ replacement during normal saves

### Status

- `Blocked`

### Current rule

Normal saves may not replace all BIQ map sections at once.

`setmap` is only allowed for explicit generated-map writes.

### Enforcement points

- `src/configCore.js -> collectBiqMapStructureOps(...)`
- `src/configCore.js -> applyBiqReferenceEdits(...)`
- `src/biq/biqSections.js -> applyEdits(...)`

### Error shape

- whole-map replacement is rejected unless `allowSetmapGeneration` is explicitly true

### Why quarantined

Whole-map reconstruction is materially riskier than surgical BIQ edits because it can normalize or discard raw bytes and unknown fields in ways that diverge from Quint.

## 2. Deleting a civilization still referenced by civ-owned map records

### Status

- `Unsupported safely`

### Current rule

If a surviving civ-owned `SLOC`, `CITY`, `UNIT`, or `CLNY` would still point at a deleted `RACE`, save must fail.

### Enforcement points

- `src/configCore.js -> collectUnsafeReferenceDeleteIssues(...)`
- `src/biq/biqSections.js -> normalizeMapOwnerSection(...)`

### Why blocked

Owner refs must remain semantically valid after delete cascades. If we cannot prove a safe shift/remap, guessing would corrupt map ownership.

## 3. Deleting a unit type still used by placed units or player start-unit definitions

### Status

- `Blocked`

### Current rule

Deleting a `PRTO` is blocked when concrete surviving refs still exist in:

- `UNIT`
- `LEAD` player start-unit fields

### Enforcement points

- `src/configCore.js -> collectUnsafeReferenceDeleteIssues(...)`

### Why blocked

The safe contract is to reject the delete rather than invent a replacement `PRTO`.

## 4. Deleting reference records that still have concrete inbound dependencies

### Status

- `Blocked`

### Current rule

Reference-record deletes are blocked whenever the save validator can prove the target is still in use by concrete BIQ fields.

### Examples

- `TECH` still referenced by worker jobs or citizens
- `GOOD` still referenced by worker jobs
- `RACE` still referenced by players or civ-owned map records
- `PRTO` still referenced by placed units or player start units

### Enforcement point

- `src/configCore.js -> collectUnsafeReferenceDeleteIssues(...)`

### Why blocked

This is the explicit JS equivalent of refusing to save a BIQ with known broken inbound links.

## 5. Unsupported `ownerType` values in map entity sections

### Status

- `Blocked`

### Current rule

Map record owner types outside the supported set are rejected by the post-apply integrity audit.

Affected sections:

- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

### Enforcement point

- `src/biq/biqSections.js -> collectMapReferenceIntegrityIssues(...)`

### Why blocked

Unsupported owner semantics cannot be trusted to survive Quint-style read/render/save behavior.

## 6. Invalid owner refs for civ-owned or player-owned map records

### Status

- `Blocked`

### Current rule

After edits are applied:

- civ-owned map records must point at a valid `RACE`
- player-owned map records must point at a valid `LEAD`

### Enforcement point

- `src/biq/biqSections.js -> collectMapReferenceIntegrityIssues(...)`

### Notes

Barbarian `owner` payloads are treated as opaque and are not blocked purely for being outside civ/player index ranges.

## 7. Broken `TILE.city` / `TILE.colony` backreferences

### Status

- `Blocked`

### Current rule

Save fails if BIQ edits leave:

- out-of-range `TILE.city` or `TILE.colony`
- tile-to-city or tile-to-colony coordinate mismatch
- missing tile backreferences from `CITY` or `CLNY`
- non-1:1 tile reference counts for cities or colonies

### Enforcement point

- `src/biq/biqSections.js -> collectMapReferenceIntegrityIssues(...)`

### Why blocked

This is exactly the class of corruption that previously caused city teleporting and wrong-city-on-wrong-tile symptoms.

## 8. Out-of-bounds map entity coordinates

### Status

- `Blocked`

### Current rule

Save fails if any of these records end up outside the map bounds:

- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

### Enforcement point

- `src/biq/biqSections.js -> collectMapReferenceIntegrityIssues(...)`

### Why blocked

Out-of-bounds map records are not reliable BIQ state and are not safe to round-trip.

## 9. Colony overlay/type semantic mismatch after colony-like edits

### Status

- `Blocked`

### Current rule

If BIQ edits touched colony-like state and the resulting `TILE.c3cOverlays` disagrees with `CLNY.improvementType`, save fails.

### Enforcement point

- `src/biq/biqSections.js -> collectColonyOverlayCoherenceIssues(...)`

### Why blocked

Visible colony-like type must remain coherent with what Quint/Firaxis-style rendering expects from tile overlay state.

## 10. Save paths that derive BIQ truth from display-only labels

### Status

- `Quarantined by design`

### Current rule

Display labels such as:

- `Egypt (1)`
- `CLNY 3 (2)`
- `CITY 4`

must not be the source of truth for BIQ writes.

### Enforcement points

- `src/configCore.js -> buildMapTabFromBiq(...)`
- `src/configCore.js -> collectBiqMapEdits(...)`
- `src/renderer.js -> getMapFieldStoredValue(...)`

### Why quarantined

This is a design boundary rather than a single thrown error. The protection comes from preserving raw record values and preferring them at save time.

## 11. Ordinary map editing through generated-map-only authority paths

### Status

- `Quarantined`

### Current rule

Generated-map flows are allowed to authoritatively replace all map sections. Ordinary map editing is not.

### Examples

- procedural map generation may emit full `WCHR/WMAP/TILE/CONT/SLOC/CITY/UNIT/CLNY`
- hand-edited scenario maps must use surgical edits instead

### Why quarantined

These are fundamentally different trust models and should not share the same ordinary save path.

## 12. Unknown-field normalization through reconstructive map writes

### Status

- `Quarantined`

### Current rule

Unknown/question-mark BIQ map bytes should be preserved unless a tested interpretation exists.

### Operational consequence

Any path that would rebuild map sections from incomplete UI semantics rather than preserve raw bytes is treated as high risk and kept out of normal save flows.

### Why quarantined

This is the main compatibility reason whole-map reconstruction is not part of the ordinary map editor contract.

## 13. Unsafe delete classes where the code cannot prove a correct remap

### Status

- `Unsupported safely`

### Current rule

If a delete cascade reaches a state where the code cannot prove a correct post-delete mapping, save fails instead of continuing.

### Examples

- surviving civ-owned map record still points at deleted civ
- surviving section-index backreference cannot be made coherent

### Enforcement points

- delete-safety validation in `src/configCore.js`
- post-apply normalization and integrity checks in `src/biq/biqSections.js`

## What Is Still Allowed

These boundaries do not mean map BIQ editing is broadly disabled. Normal supported flows still include:

- surgical tile edits
- city add/edit/delete
- unit add/edit/delete
- colony add/edit/delete
- starting-location edit
- player-delete and civ-delete cascades when the resulting refs can be proven coherent
- generated-map whole-section replacement when explicitly marked as generated

## Next Practical Step

With this register in place, the main remaining hardening work is no longer “map the pipeline.” It becomes:

- add executable parity tests for the highest-value rows in `docs/biq/MapEditedSaveParityMatrix.md`
- keep this register updated when a quarantined path becomes safely supported
