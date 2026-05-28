# Pending Reference Save Flow

## Purpose
This document describes how unsaved BIQ reference entries keep their references correct when they receive final BIQ indices during save.

The high-risk case is:
1. Add several new Civs, Techs, Resources, Improvements, Governments, or Units.
2. Reference those new entries elsewhere before the first save.
3. Delete one of the pending entries before save.
4. Save and reload.

The final saved references must point to the surviving records' final BIQ indices, not to stale provisional positions.

## Source Of Truth While Editing
Structured reference controls must store stable target metadata:

```js
{ tabKey: 'technologies', key: 'TECH_MY_NEW_TECH' }
```

The visible numeric field value can be provisional. The metadata is the save-time source of truth for known BIQ references.

Scalar references use `field.referenceTarget`. List references use `field.referenceTargets`.

If a new known BIQ reference field is added without this metadata path, it is outside the pending-reference guarantee until wired and tested.

## Save-Time Planning
Save planning builds final reference index maps before BIQ edits are collected.

The planner:
1. Starts from the original BIQ records in each reference section.
2. Applies surviving `recordOps` adds/copies/imports in order.
3. Applies delete operations and compacts the planned list.
4. Builds key-to-final-index maps from Civilopedia keys and original index refs.
5. Rewrites metadata-backed reference fields to final numeric indices.

Example:

```text
Original TECH count: 84
Pending adds: TECH_A, TECH_B, TECH_C
User deletes: TECH_B
Final planned adds: TECH_A -> 84, TECH_C -> 85
Reference target TECH_C saves as 85, not stale 86.
```

The BIQ writer should receive already-normalized numeric values.

## Assigned Index Parsing
Never use `Number(value)` directly to decide whether a BIQ index is assigned.

JavaScript treats `null` as zero:

```js
Number(null) === 0
```

That is wrong for unsaved BIQ entries. `null`, `undefined`, empty strings, booleans, and non-finite values mean "not assigned yet" and must not be treated as index `0`.

Pending entries must resolve through planned record operations keyed by Civilopedia key, not through fake original BIQ indices.

## Renderer Payload Shape Matters
Tests must include real renderer-shaped pending entries, not only planner-shaped operation lists.

Important payload details:
- Pending entries commonly have `biqIndex: null`.
- Some pending entries may have an empty or missing `biqIndex`.
- The tab may contain both `entries` and `recordOps`.
- The referenced entry may live in another tab than the edited field.

A test that only passes `recordOps` can prove planned add ordering, but it cannot catch an unsafe entry-index backfill path.

## C3X And District References
C3X base and District config references are name/token based, not BIQ-index based.

They are not vulnerable to BIQ index drift, but they can still become stale if a referenced item is renamed or deleted. Save/reload tests should cover pending BIQ entries referenced by name from:
- C3X base structured fields such as `technology_perfume`, `resource_perfume`, `building_prereqs_for_units`, and `buildings_generating_resources`.
- District fields such as `advance_prereqs`, `dependent_improvs`, `resource_prereqs`, `resource_prereq_on_tile`, and `generated_resource`.

## Verification Expectations
For changes to pending reference save behavior, run:

```bash
node --check src/configCore.js
node --check src/renderer.js
npm test
```

Also run `npm run test:biq` when parser/writer behavior, BIQ sections, or reference cascades are touched.

Regression coverage should include:
- New pending entry referenced from another BIQ tab.
- Middle pending entry deleted before first save.
- `biqIndex: null`, empty, and missing pending entries.
- Scalar references, list references, bitmask references, and BIQ structure tabs.
- C3X/District name references to pending BIQ entries.
