# BIQ Map Pipeline Parity

## Purpose

This document maps the C3X Config Manager BIQ map read/write pipeline to the corresponding Quint_Editor responsibilities.

It is not a byte-layout reference. For section formats see:
- `docs/biq/README.md`
- `docs/biq/IOPipeline.md`
- `docs/biq/sections/*.md`

This file answers a different question:

- where BIQ map data enters our JS pipeline
- where it is projected into editable map-tab state
- where map edits are collected back into BIQ edits
- where save-time remap/repair/integrity checks happen
- which responsibilities are intended to match Quint, and which paths are intentionally quarantined

## Quint Reference Points

Primary Quint sources for this pipeline:

- `../Quint_Editor/Shared/Civ3_Shared_Components/src/main/java/com/civfanatics/civ3/biqFile/IO.java`
- `../Quint_Editor/Shared/Civ3_Shared_Components/src/main/java/com/civfanatics/civ3/biqFile/*.java`
- `../Quint_Editor/Shared/Civ3_Editor/src/main/java/com/civfanatics/civ3/xplatformeditor/MapTab.java`
- `../Quint_Editor/Shared/Civ3_Editor/src/main/java/com/civfanatics/civ3/xplatformeditor/tabs/map/*`

Quint is the behavioral reference. Our runtime is pure JS and does not call into Java.

## Section Scope

This map pipeline covers:

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

It also depends on non-map sections when map semantics require them:

- `RACE`
- `LEAD`
- `PRTO`
- `BLDG`
- `GAME`

## High-Level Parity Model

Quint-style responsibilities are split across four stages in our app:

1. BIQ inflate + parse
2. Projection into editable map-tab records
3. Save-plan collection of map ops and field edits
4. Apply/remap/validate/serialize back to BIQ bytes

The goal is surgical mutation of existing BIQ structures, not whole-map reconstruction during ordinary saves.

## Stage 1: Inflate And Parse

### Quint responsibility

Quint `IO.inputBIQ(...)` is responsible for:

- reading raw or compressed BIQ bytes
- decoding section order and optional blocks
- parsing section records
- establishing post-parse map object state

### C3X implementation

Entry point:

- `src/configCore.js -> loadBiqTab(...)`

Concrete steps:

1. `inflateBiqIfNeeded(...)`
   - reads the file
   - keeps raw `BIC*` files as-is
   - otherwise runs PKWare IMPLODE decompression

2. `runBiqBridgeOnInflatedBuffer(...)`
   - calls `src/biq/biqBridgeJs.js -> parseBiqBuffer(...)`

3. `parseBiqBuffer(...)`
   - delegates to `src/biq/biqSections.js -> parseAllSections(...)`

4. `parseAllSections(...)`
   - parses the BIQ header and version context
   - walks the canonical section order
   - decodes map sections and their records
   - retains raw section buffers for unchanged-section byte preservation

### Parity intent

This is our JS equivalent of Quint’s “import BIQ into an in-memory model” stage.

### Important differences

- We preserve raw section buffers so unchanged sections can round-trip byte-for-byte.
- We do not build Quint’s full Java object graph. Instead we keep JS section records plus enough metadata to support surgical edits and parity checks.

## Stage 2: Projection Into Editable Map-Tab State

### Quint responsibility

Quint’s map tab works from the imported BIQ model and exposes:

- tile coordinates and overlays
- selected tile ownership
- placed city/unit/colony/start-location data
- context-sensitive controls for active map tools

### C3X implementation

Projection happens during `loadBundle(...)` in `src/configCore.js`.

Relevant responsibilities:

- build map-tab sections from parsed BIQ sections
- carry raw BIQ values alongside display-oriented values
- attach section/record metadata needed for later edit collection
- keep scenario district sidecar state attached to the map tab

### Current C3X rule

For map records, raw BIQ values must remain the source of truth for save decisions.

Display formatting may enrich values like:

- `ownerType`
- `owner`
- display names for civs/players
- section titles

But save logic must read raw record values, not UI-only labels.

### Parity intent

This is the C3X equivalent of Quint’s map canvas backing state.

### Current hard rule

Normal save paths must not depend on display-only strings such as:

- `CITY 4`
- `CLNY 2`
- `Egypt (1)`

They must use raw refs/indexes/owner fields preserved on the record model.

## Stage 3: Collecting Map Edits For Save

### Quint responsibility

Quint mutates its in-memory model directly and then writes the BIQ from that model.

### C3X implementation

We collect explicit BIQ-style edit operations from map-tab state in `src/configCore.js`.

There are three separate map edit streams:

1. `collectBiqMapStructureOps(...)`
   - only for whole-map set/remove flows
   - emits `setmap` or `removemap`

2. `collectBiqMapRecordOps(...)`
   - emits map record `add` / `copy` / `delete`
   - applies to `CITY`, `UNIT`, `CLNY`, `SLOC`, and other map-backed record sections as exposed by the UI

3. `collectBiqMapEdits(...)`
   - emits field-level `set` edits for existing map records
   - reads direct raw values from the record object when available
   - skips map-sidecar-only fields such as district metadata that are not BIQ bytes

These streams are merged in `buildSavePlan(...)` together with:

- BIQ reference-tab ops/edits
- BIQ structure-tab ops/edits
- optional scenario search-folder edits

### Parity intent

This is our explicit JS equivalent of “the user changed the imported Quint map model.”

### Quarantined path

`setmap` is intentionally blocked for normal saves.

Only explicit generated-map writes may replace all map sections at once.

That means ordinary map editing is expected to use:

- field edits
- record add/copy/delete
- targeted remap/repair

not wholesale map reconstruction.

## Stage 4: Save-Time Validation Before BIQ Apply

### Quint responsibility

Quint’s save path relies on its linked object model and internal assumptions to avoid broken references after mutation.

### C3X implementation

Before writing BIQ bytes, `buildSavePlan(...)` performs delete-safety validation against the merged live bundle state.

Current key gate:

- `collectUnsafeReferenceDeleteIssues(...)`

This validates that deleted high-impact records are not still referenced by:

- map units
- map cities
- colonies
- starting locations
- players
- other reference-bearing BIQ sections

### Parity intent

This is a defensive JS equivalent of Quint’s linked-model safety assumptions.

### Current policy

We prefer failing save with a concrete reference error over writing a BIQ that is structurally valid but semantically wrong.

## Stage 5: Apply BIQ Edits

### Quint responsibility

Quint writes the mutated BIQ model back into section bytes and preserves section ordering and optional-block behavior.

### C3X implementation

Entry point:

- `src/configCore.js -> applyBiqReferenceEdits(...)`

Concrete steps:

1. inflate source BIQ again
2. call `src/biq/biqBridgeJs.js -> applyBiqEdits(...)`
3. delegate to `src/biq/biqSections.js -> applyEdits(...)`
4. write staged output bytes

`applyEdits(...)` is where BIQ mutation semantics live.

## Stage 6: Remap, Cascade, And Map Repair

### Quint responsibility

When Quint removes or shifts linked records, surviving map references must continue to point at the correct entities.

### C3X implementation

Map-related normalization currently lives primarily in `src/biq/biqSections.js`.

Important responsibilities:

- remap deleted section indexes
- normalize owner refs after `RACE` or `LEAD` deletes
- remove player-owned map records when deleted players owned them
- rewrite `TILE.city` and `TILE.colony` after `CITY` / `CLNY` index shifts
- remap placed `UNIT.pRTONumber` after `PRTO` deletes
- keep `LEAD`-dependent player map ownership coherent

Key helper families:

- `normalizeMapOwnerSection(...)`
- `composeDeletedSectionRemaps(...)`
- section-remap helpers for `CITY`, `CLNY`, `UNIT`, `LEAD`, `RACE`, `PRTO`

### Parity intent

This is the closest C3X equivalent to Quint’s post-mutation link repair.

### Current design rule

If we cannot prove a safe remap for a map-dependent mutation, save should fail rather than guess.

## Stage 7: Post-Apply Map Integrity Audits

### Quint responsibility

Quint’s editor/runtime model implicitly assumes coherent map references and interpretable owner/overlay semantics.

### C3X implementation

After edits are applied, we run explicit BIQ integrity audits in `src/biq/biqSections.js`.

Current core checks:

- `collectMapReferenceIntegrityIssues(...)`
- `collectColonyOverlayCoherenceIssues(...)`

These validate:

- tile/city/colony backreferences
- coordinate coherence
- map bounds
- ownerType/owner validity for civ and player ownership
- colony overlay vs `CLNY.improvementType` coherence

### Parity intent

This is a stricter explicit audit layer on top of Quint-compatible mutation behavior.

Quint may rely on object-model invariants instead of an explicit audit function; we make those invariants visible and testable.

## Stage 8: Serialize And Preserve Unchanged Bytes

### Quint responsibility

Quint writes BIQ sections in canonical order with valid counts and optional blocks.

### C3X implementation

`buildBiqBuffer(...)` in `src/biq/biqSections.js`:

- preserves unchanged sections via cached raw bytes
- reserializes only modified sections
- writes canonical section order
- preserves version-aware serialization behavior

### Parity intent

This is the JS equivalent of Quint’s final BIQ output stage, with an extra emphasis on minimal churn.

## Current Parity Status

### Normal map save path

Current intended parity:

- surgical BIQ map field edits
- map record add/copy/delete
- delete cascades for `CITY`, `CLNY`, `LEAD`, `RACE`, `PRTO`
- raw-value-based save decisions
- post-apply integrity audits

### Intentionally blocked or quarantined

- whole-map replacement during ordinary saves
- unsafe unresolved delete cases where concrete surviving refs still exist
- any save path that would rely on display-only labels instead of raw BIQ values

## Remaining Mapping Work

The per-section mutation matrix now lives in:

- `docs/biq/MapSectionMutationMatrix.md`

The field-level projection matrix now lives in:

- `docs/biq/MapFieldProjectionMatrix.md`

The edited-save parity matrix now lives in:

- `docs/biq/MapEditedSaveParityMatrix.md`

The unsupported/quarantined map-operations register now lives in:

- `docs/biq/MapUnsupportedAndQuarantined.md`

## Quick Reference

### Read path

- `src/configCore.js -> loadBiqTab(...)`
- `src/biq/biqBridgeJs.js -> parseBiqBuffer(...)`
- `src/biq/biqSections.js -> parseAllSections(...)`

### Save-plan map collection

- `src/configCore.js -> buildSavePlan(...)`
- `src/configCore.js -> collectBiqMapStructureOps(...)`
- `src/configCore.js -> collectBiqMapRecordOps(...)`
- `src/configCore.js -> collectBiqMapEdits(...)`
- `src/configCore.js -> collectUnsafeReferenceDeleteIssues(...)`

### Apply/remap/audit

- `src/configCore.js -> applyBiqReferenceEdits(...)`
- `src/biq/biqBridgeJs.js -> applyBiqEdits(...)`
- `src/biq/biqSections.js -> applyEdits(...)`
- `src/biq/biqSections.js -> collectMapReferenceIntegrityIssues(...)`
- `src/biq/biqSections.js -> collectColonyOverlayCoherenceIssues(...)`
