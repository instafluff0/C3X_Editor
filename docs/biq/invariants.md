# BIQ Invariants and Safety Rules

## Purpose
Checklist for safe BIQ mutations and robust import/export behavior.

## Structural Invariants
- Section headers must appear in expected order for the targeted output format.
- Section count fields must match serialized element counts.
- Optional blocks must remain internally consistent:
  - map sections only when map payload is present
  - LEAD only when custom player data is present

## Index/Reference Invariants
- Any add/remove/reorder in a section requires updating all int-index links pointing to that section.
- Preserve `-1` sentinel semantics for “none/unset” references.
- After import or mutation, run link-repair/post-processing equivalent logic before save.
- Pending BIQ reference entries must be referenced by stable metadata until save assigns final indices.
  - Structured controls should store `referenceTarget` / `referenceTargets` with `{ tabKey, key }`.
  - Final numeric indices are calculated by save planning after surviving add/copy/delete operations are known.
  - `null`, `undefined`, empty strings, booleans, and non-finite values are not assigned BIQ indices.
  - Do not use `Number(value)` directly for assigned-index tests.
  - See `docs/biq/PendingReferenceSaveFlow.md`.

## Map Invariants
- TILE, CITY, UNIT, CLNY, SLOC links must remain mutually coherent.
- TILE x/y/index mapping must remain deterministic and world-size consistent.
- Owner fields (`owner`, `ownerType`) must remain valid after player/civ edits.
- Shared map-section ownership rule:
  - if a UI operation intentionally transfers ownership of a city stack on one tile, the colocated `CITY` and `UNIT` records must save and reload with matching `ownerType`/`owner` values.
  - if a UI operation intentionally transfers ownership of a unit stack on one tile and a colocated city is part of that operation, the city must match the units after save/reload.
- Shared map-section coordinate rule:
  - `CITY`, `UNIT`, `CLNY`, and `SLOC` are coordinate-anchored records.
  - `TILE.city` and `TILE.colony` add index-backed links that must still resolve to records at the same tile coordinates after any add/delete/reindex cascade.
- Section-churn rule for surgical saves:
  - tile-only terrain/overlay edits should only mutate `TILE`.
  - non-structural city field edits should only mutate `CITY`, unless the action explicitly includes colocated unit transfer.
  - non-structural unit field edits should only mutate `UNIT`, unless the action explicitly includes colocated city transfer.
  - starting-location edits should only mutate `SLOC`.
  - colony add/type edits may mutate `CLNY` and `TILE` together because visible colony-like type is coupled to tile overlay bits.
- Preserve Quint tile-index math:
  - `index = (y/2)*width + (y odd ? width/2 : 0) + (x/2)` with x-wrap and y-bounds checks.
- Keep logical and render terrain fields in sync:
  - `C3CRealBaseTerrain` nibble pair must match decoded real/base terrain fields.
  - `TILE.file`/`TILE.image` must be recalculated when surrounding base terrain changes.
- Distinguish hard ownership from border ownership:
  - hard owner from tile city/colony/unit links;
  - border owner from city influence + nearest/highest-culture resolution.

## Version/Format Invariants
- Respect version-specific optional sections and field widths.
- Conversions (Vanilla/PTW -> Conquests model) must explicitly initialize added structures.
- Compression/decompression is transport detail; semantic data must survive round-trip unchanged.

## Unknown Field Policy
- Do not drop unknown/question-mark fields.
- Preserve raw values unless a tested interpretation exists.
- Mark edits to unknown fields as high risk and document rationale.

## Serialization Safety
- Write path must emit headers and payload lengths consistent with parser expectations.
- For variable-length sections (notably CITY), avoid assumptions from fixed-length sections.
- Validate with representative files covering:
  - custom rules only
  - custom map + map entities
  - custom player data
  - mixed-version inputs

## Agent Workflow Checklist
1. Identify all sections touched.
2. List inbound/outbound index references.
3. Apply mutation.
4. Recalculate links and dependent counts.
5. Re-run map/player post-processing if map/player data touched.
6. Verify round-trip with known BIQ fixtures.
