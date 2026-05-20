# BIQ Map Edited-Save Parity Matrix

## Purpose

This document records the intended section-level change surface for BIQ map saves.

It answers:

- given a particular map edit class
- which BIQ sections are expected to change
- which BIQ sections should remain byte-stable
- which changes happen in BIQ bytes versus scenario sidecar files

Use it with:

- `docs/biq/MapPipelineParity.md`
- `docs/biq/MapSectionMutationMatrix.md`
- `docs/biq/MapFieldProjectionMatrix.md`
- `docs/biq/invariants.md`

## Scope

Map BIQ sections in scope:

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

Related non-BIQ sidecar:

- `scenario.districts.txt`

## Parity Rule

Normal map saves are intended to be surgical.

That means:

- unchanged map saves should preserve raw map section bytes byte-for-byte
- edited map saves should only change the sections logically touched by the edit plus any required cascade/repair sections
- unrelated map sections should remain byte-stable

Whole-map replacement is not part of the normal save contract.

## Evidence Already Covered By Tests

Current regression evidence in the repo already covers:

- unchanged save preserves raw `WCHR/WMAP/TILE/CONT/SLOC/CITY/UNIT/CLNY`
- city delete preserves surviving references and leaves untouched structural sections stable
- district/named-tile persistence writes sidecar data
- colony overlay/type mismatch detection
- whole-map replacement blocked outside explicit generated-map saves

Primary current test anchors:

- `test/biqMapCritical.test.js`
- `test/biqRoundtrip.test.js`

## Matrix

## 1. Unchanged map save

### Operation class

- load BIQ
- save without any map edits

### Expected BIQ section changes

- none

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

### Notes

This is the strongest baseline parity guarantee. If a no-op map save changes bytes, the projection/save path is not Quint-safe enough.

## 2. Sidecar-only district or named-tile edit

### Operation class

- paint district
- add/remove named tile
- modify `mapTab.scenarioDistricts`

### Expected BIQ section changes

- none, unless the user also changed real BIQ map fields

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

### Non-BIQ output

- `scenario.districts.txt` may be created or updated

### Notes

District/named-tile sidecar persistence is intentionally outside BIQ bytes.

## 3. City field edit without structural cascade

### Operation class

- rename city
- change city population/culture
- change city owner when the city record itself remains in place

### Expected BIQ section changes

- `CITY`

### Conditionally expected BIQ section changes

- `UNIT` if UI action intentionally transfers colocated units with the city owner
- `TILE` only if the specific city edit also changes tile-linked fields

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `CONT`
- `SLOC`
- `CLNY`

### Notes

The exact owner-transfer UI path may intentionally touch colocated units. That is allowed churn when the edit semantics include stack ownership transfer.

## 4. Unit field edit without structural cascade

### Operation class

- change unit owner
- change unit type
- change unit experience
- move or edit a placed unit record without deleting/reindexing sections

### Expected BIQ section changes

- `UNIT`

### Conditionally expected BIQ section changes

- `CITY` if the UI action intentionally transfers a colocated city owner together with the unit-owner operation

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `SLOC`
- `CLNY`

### Notes

Placed units are coordinate-based, not tile-index-linked like cities/colonies. Normal unit edits should not churn `TILE` unless a separate tile field changed too.

## 5. Starting-location edit

### Operation class

- add/update/remove starting location

### Expected BIQ section changes

- `SLOC`

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `CITY`
- `UNIT`
- `CLNY`

### Notes

Starting locations are coordinate/owner records and do not require `TILE` backreference rewrites.

## 6. Colony record edit

### Operation class

- change colony owner
- change colony coordinates
- change `CLNY.improvementType`

### Expected BIQ section changes

- `CLNY`

### Conditionally expected BIQ section changes

- `TILE` if the edit changes the `TILE.colony` link or tile overlay bits

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`

### Notes

Visible colony-like type is coupled to tile overlay state, so some colony-like edits logically touch both `CLNY` and `TILE`.

## 7. Tile overlay or terrain edit

### Operation class

- terrain paint
- overlay paint
- fog/ruin/victory-point tile flag change
- tile-level colony-like overlay change

### Expected BIQ section changes

- `TILE`

### Conditionally expected BIQ section changes

- `CLNY` if colony-like type semantics are also changed
- `WMAP` only for generated-map or whole-map-authority paths, not normal paint operations

### Expected byte-stable sections

- `WCHR`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`

### Notes

Normal tile paint should stay inside `TILE` unless a real linked record is also being modified.

## 8. Add city

### Operation class

- create a new `CITY` on a tile

### Expected BIQ section changes

- `CITY`
- `TILE`

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `CONT`
- `SLOC`
- `UNIT`
- `CLNY`

### Notes

The city record is new and the occupying tile’s `city` ref must be updated.

## 9. Delete city

### Operation class

- remove an existing `CITY`

### Expected BIQ section changes

- `CITY`
- `TILE`

### Conditionally expected BIQ section changes

- `UNIT` only if the editor operation also intentionally changes colocated units

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `CONT`
- `SLOC`
- `CLNY`

### Tested parity expectation

Current regression coverage explicitly checks that after city delete:

- surviving city/tile refs stay coherent
- untouched structural sections remain byte-stable:
  - `WCHR`
  - `WMAP`
  - `CONT`
  - `SLOC`

## 10. Add colony

### Operation class

- create a new `CLNY`

### Expected BIQ section changes

- `CLNY`
- `TILE`

### Notes

The occupying tile must link to the new colony record, and colony-like overlay semantics may also need to stay coherent.

## 11. Delete colony

### Operation class

- remove an existing `CLNY`

### Expected BIQ section changes

- `CLNY`
- `TILE`

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`

### Notes

Like city delete, colony delete must rewrite tile backreferences.

## 12. Add unit

### Operation class

- create a new `UNIT`

### Expected BIQ section changes

- `UNIT`

### Conditionally expected BIQ section changes

- `TILE` only if a tile-side visible-unit helper field is explicitly stored or changed by the operation

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `CONT`
- `SLOC`
- `CITY`
- `CLNY`

### Notes

Current BIQ semantics are coordinate-based for units, so normal add-unit persistence should remain localized to `UNIT`.

## 13. Delete unit

### Operation class

- remove an existing `UNIT`

### Expected BIQ section changes

- `UNIT`

### Expected byte-stable sections

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `SLOC`
- `CITY`
- `CLNY`

### Notes

No `TILE.city`/`TILE.colony` style backreference exists for placed units.

## 14. Delete player (`LEAD`) with map consequences

### Operation class

- structural non-map delete that cascades into map ownership

### Expected BIQ section changes

- `LEAD`
- `SLOC` when player-owned starting locations are removed or shifted
- `CITY` when player-owned cities are removed
- `UNIT` when player-owned units are removed
- `CLNY` when player-owned colonies are removed
- `TILE` when resulting `CITY` or `CLNY` index shifts must be rewritten

### Notes

This is not a pure map-tab operation, but it is part of BIQ map parity because of the map cascades it triggers.

## 15. Delete civilization (`RACE`) with map consequences

### Operation class

- structural non-map delete that cascades into map ownership

### Expected BIQ section changes

- `RACE`
- `SLOC` when civ-owned owner refs shift
- `CITY` when civ-owned owner refs shift
- `UNIT` when civ-owned owner refs shift
- `CLNY` when civ-owned owner refs shift

### Conditionally expected BIQ section changes

- `TILE` only if city/colony section indexes also changed due to other cascades

### Notes

If a surviving civ-owned map record would still point at a deleted civ, save should fail rather than write a semantically broken BIQ.

## 16. Delete unit type (`PRTO`) with map consequences

### Operation class

- structural non-map delete that affects placed map units

### Expected BIQ section changes if allowed

- `PRTO`
- `UNIT` when placed units are remapped
- `LEAD` when player start-unit definitions are remapped
- possibly `RULE` or other non-map sections through broader PRTO cascades

### Current normal behavior

- save is blocked if concrete placed `UNIT` refs or start-unit refs still use the deleted `PRTO`

### Notes

This is intentionally fail-safe. The edited-save contract is “block unsafe delete,” not “guess a replacement.”

## 17. Generated-map replacement

### Operation class

- explicit generated-map write path

### Expected BIQ section changes

- `WCHR`
- `WMAP`
- `TILE`
- `CONT`
- `SLOC`
- `CITY`
- `UNIT`
- `CLNY`

### Notes

This is the only normal allowed whole-map replacement class.

It is outside the ordinary surgical-edit parity contract and must remain explicitly marked as generated-map-only.

## Byte-Stability Summary

### Strong byte-stability expectations

These should hold whenever the logical operation does not touch them:

- `WCHR`
- `WMAP`
- `CONT`
- `SLOC`

These are especially important because current regressions already prove stability for them in targeted city-delete saves.

### Conditionally stable sections

- `TILE`
- `CITY`
- `UNIT`
- `CLNY`

These are expected to change more often because they carry most direct map entity state and section-index backreferences.

## Current Remaining Work

The next useful hardening step after this matrix is to turn the highest-value rows here into more explicit parity tests, especially:

- add city -> only `CITY` + `TILE` churn
- add unit -> only `UNIT` churn
- starting-location edit -> only `SLOC` churn
- colony edit -> only `CLNY` plus required `TILE` churn

That would convert this matrix from an audited contract into broader executable coverage.
