# BIQ Map Section Mutation Matrix

## Purpose

This document records the mutation semantics for the core BIQ map sections and maps them to current C3X repair behavior and Quint expectations.

Use it together with:

- `docs/biq/MapPipelineParity.md`
- `docs/biq/invariants.md`
- `docs/biq/sections/TILE.md`
- `docs/biq/sections/SLOC.md`
- `docs/biq/sections/CITY.md`
- `docs/biq/sections/UNIT.md`
- `docs/biq/sections/CLNY.md`

## Scope

Sections covered here:

- `TILE`
- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

Each section entry answers:

- what the record stores directly
- what other sections it points to
- what other sections point back to it
- what add/delete/reindex operations imply
- what C3X currently repairs automatically
- what is still intentionally blocked or high-risk

## Shared Owner Semantics

For `SLOC`, `CITY`, `UNIT`, and `CLNY`:

- `ownerType = 0`: none
- `ownerType = 1`: barbarians
- `ownerType = 2`: civilization-owned, `owner` indexes `RACE`
- `ownerType = 3`: player-owned, `owner` indexes `LEAD`

Current C3X integrity rules:

- civ-owned records must reference a valid `RACE`
- player-owned records must reference a valid `LEAD`
- barbarian `owner` payloads are treated as opaque
- unsupported `ownerType` values fail save

## TILE

### Stored role

`TILE` is the authoritative per-tile storage record.

It carries:

- tile overlays and improvements
- terrain/base-terrain fields
- resource and river data
- `city` record ref
- `colony` record ref
- derived ownership-related tile fields

`xpos` and `ypos` are derived from tile index and map width, not directly stored.

### Outbound references

- `city` -> `CITY` by section index
- `colony` -> `CLNY` by section index
- resource-like refs and terrain-related encoded fields

### Inbound references

- `CITY` uses matching `x`,`y` to identify the tile it occupies
- `CLNY` uses matching `x`,`y`
- `UNIT` uses matching `x`,`y`
- `SLOC` uses matching `x`,`y`

### Mutation implications

- deleting or reindexing `CITY` requires rewriting `TILE.city`
- deleting or reindexing `CLNY` requires rewriting `TILE.colony`
- changing terrain/overlay bits can affect visible colony-like rendering
- tile coordinates must remain deterministic from tile index and `WMAP.width`

### Current C3X repair behavior

- rewrites `TILE.city` after `CITY` delete cascades and player-owned city removal
- rewrites `TILE.colony` after `CLNY` delete cascades and player-owned colony removal
- validates tile/city/colony coordinate coherence after apply
- validates one-to-one backreference counts for city/colony links
- validates tile bounds against `WMAP`

### Quint-parity expectation

Quint treats `TILE` as the anchor for map placement and visual state. Any surviving `city` or `colony` ref must still identify the correct occupying record after mutation.

### Current blocked/high-risk cases

- whole-map replacement on normal saves
- any mutation path that would leave `TILE.city` or `TILE.colony` semantically shifted without an explicit remap

## SLOC

### Stored role

`SLOC` stores starting locations.

It carries:

- `ownerType`
- `owner`
- `x`
- `y`

### Outbound references

- `owner` -> `RACE` when `ownerType=2`
- `owner` -> `LEAD` when `ownerType=3`
- `x`,`y` -> implicit tile coordinate target

### Inbound references

- no direct BIQ index ref back into `SLOC`
- map editing and starting-location semantics rely on coordinate uniqueness and valid owner target

### Mutation implications

- deleting or reindexing `LEAD` may require deleting or shifting player-owned `SLOC`
- deleting or reindexing `RACE` may require shifting civ-owned `SLOC`
- coordinate edits must remain in bounds

### Current C3X repair behavior

- on `LEAD` delete, player-owned `SLOC` with deleted owners are removed and surviving player owner refs are shifted
- on `RACE` delete, civ-owned `SLOC` owner refs are shifted; deleted-owner cases fail save
- save-time audit validates `ownerType`, `owner`, and coordinates

### Quint-parity expectation

Quint ties starting locations to valid player/civ ownership and map coordinates. A starting location must never point at a deleted player/civ after save.

### Current blocked/high-risk cases

- civ delete where a surviving `SLOC` would still point at a deleted `RACE`

## CITY

### Stored role

`CITY` stores placed cities.

It carries:

- `name`
- `ownerType`
- `owner`
- `x`
- `y`
- `size`
- `culture`
- `cityLevel`
- `borderLevel`
- building list

### Outbound references

- `owner` -> `RACE` when `ownerType=2`
- `owner` -> `LEAD` when `ownerType=3`
- building list -> `BLDG`
- `x`,`y` -> occupying tile

### Inbound references

- `TILE.city` -> `CITY` by section index
- city influence / border rendering derives from city placement
- district and wonder-city semantics may depend on city presence by coordinate or sidecar metadata

### Mutation implications

- deleting or reindexing `CITY` requires rewriting `TILE.city`
- deleting or reindexing `BLDG` requires rewriting city building lists
- deleting or reindexing `LEAD` may delete player-owned cities and then shift `TILE.city`
- deleting or reindexing `RACE` may require shifting civ-owned city owners

### Current C3X repair behavior

- rewrites building lists after `BLDG` delete
- on `LEAD` delete, player-owned cities with deleted owners are removed; resulting `CITY` remap is composed into `TILE.city`
- on `RACE` delete, civ-owned city owner refs are shifted; deleted-owner cases fail save
- post-apply audit validates owner refs, coordinates, and tile backreference coherence

### Quint-parity expectation

Quint expects placed cities to remain attached to the correct tiles after index shifts and to retain coherent ownership semantics for borders, units, and city visuals.

### Current blocked/high-risk cases

- civ delete where surviving city ownership would still point at a deleted `RACE`

## UNIT

### Stored role

`UNIT` stores placed map units.

It carries:

- `ownerType`
- `owner`
- `pRTONumber`
- `experienceLevel`
- `AIStrategy`
- `x`
- `y`
- custom-name/king flags

### Outbound references

- `owner` -> `RACE` when `ownerType=2`
- `owner` -> `LEAD` when `ownerType=3`
- `pRTONumber` -> `PRTO`
- `x`,`y` -> tile coordinate

### Inbound references

- no tile section index backreference like `TILE.city`
- rendering and tile overlays derive unit stacks from coordinates
- delete validation for `PRTO` depends on placed `UNIT` refs

### Mutation implications

- deleting or reindexing `PRTO` requires rewriting `UNIT.pRTONumber`
- deleting or reindexing `LEAD` may delete player-owned units
- deleting or reindexing `RACE` may require shifting civ-owned unit owners
- coordinate edits must remain in bounds and coherent with visible tile stack logic

### Current C3X repair behavior

- rewrites `pRTONumber` after `PRTO` delete cascades
- on `LEAD` delete, player-owned units with deleted owners are removed
- on `RACE` delete, civ-owned unit owner refs are shifted; deleted-owner cases fail save
- post-apply audit validates owner refs and coordinates
- save-time delete safety blocks deleting a `PRTO` that concrete placed units still use

### Quint-parity expectation

Quint expects placed units to keep valid owner semantics and valid `PRTO` refs after mutations, with visible-unit selection derived from tile context rather than corrupt saved links.

### Current blocked/high-risk cases

- deleting a unit type still referenced by placed `UNIT` records or player start-unit definitions

## CLNY

### Stored role

`CLNY` stores colony-like improvements.

It carries:

- `ownerType`
- `owner`
- `x`
- `y`
- `improvementType`

`improvementType` values of interest from Quint docs:

- `0` colony
- `1` airfield
- `2` radar tower
- `3` outpost

### Outbound references

- `owner` -> `RACE` when `ownerType=2`
- `owner` -> `LEAD` when `ownerType=3`
- `x`,`y` -> occupying tile

### Inbound references

- `TILE.colony` -> `CLNY` by section index
- visible colony-like rendering may also depend on `TILE` overlay bits

### Mutation implications

- deleting or reindexing `CLNY` requires rewriting `TILE.colony`
- deleting or reindexing `LEAD` may delete player-owned colonies and shift `TILE.colony`
- deleting or reindexing `RACE` may require shifting civ-owned colony owners
- overlay/type mismatches can create render drift even when indexes are valid

### Current C3X repair behavior

- on `LEAD` delete, player-owned colonies with deleted owners are removed; resulting remap is composed into `TILE.colony`
- on `RACE` delete, civ-owned colony owner refs are shifted; deleted-owner cases fail save
- post-apply audit validates owner refs, coordinates, `TILE.colony` coherence, and overlay/type consistency
- renderer prefers tile overlay bits for visible airfield/radar/outpost classification

### Quint-parity expectation

Quint’s editor behavior implies visible colony-like type is derived from tile overlay state, while ownership/linkage still comes from the `CLNY` record.

### Current blocked/high-risk cases

- civ delete where surviving colony ownership would still point at a deleted `RACE`
- edits that would leave `TILE` overlay bits and `CLNY.improvementType` semantically inconsistent

## Operation Matrix

### Add

- `CITY`: allowed; must also set occupying `TILE.city`
- `UNIT`: allowed; no tile index ref, but tile-stack/render state depends on coordinates
- `SLOC`: allowed; owner and coords must be coherent
- `CLNY`: allowed; must also set occupying `TILE.colony` and keep overlay/type semantics coherent
- `TILE`: not added individually in normal saves

### Delete

- `CITY`: allowed with `TILE.city` remap
- `CLNY`: allowed with `TILE.colony` remap
- `UNIT`: allowed directly; no tile index rewrite required
- `SLOC`: allowed directly
- player-owned `CITY`/`UNIT`/`SLOC`/`CLNY`: may be removed automatically on `LEAD` delete
- civ-owned `CITY`/`UNIT`/`SLOC`/`CLNY`: owner refs are shifted on `RACE` delete; unresolved deleted-owner cases fail save

### Reindex / Cascade

- `CITY` index shifts must cascade into `TILE.city`
- `CLNY` index shifts must cascade into `TILE.colony`
- `PRTO` index shifts must cascade into `UNIT.pRTONumber`
- `LEAD` index shifts must cascade into player-owned map owner refs
- `RACE` index shifts must cascade into civ-owned map owner refs

## Current Parity Boundaries

The current normal-save design is intentionally narrow:

- surgical map field edits are supported
- map record add/copy/delete is supported
- delete cascades for `CITY`, `CLNY`, `LEAD`, `RACE`, and `PRTO` are supported
- post-apply semantic audits are required

The following remain intentionally quarantined:

- whole-map replacement on normal saves
- any unresolved delete case where a surviving map record would still point at a deleted civ/player/unit type
- any path that depends on UI labels instead of raw BIQ values

## Next Mapping Work

After this matrix, the next useful parity pass is the field-level projection matrix:

- raw stored value
- display value
- edit source of truth
- save source of truth
- dependent repair rules

That will close the remaining gap between section-level mutation semantics and individual field behavior.
