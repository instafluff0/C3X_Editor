# JS BIQ Bridge

Pure-JavaScript BIQ parsing and editing pipeline. No Java dependency.

## Source files

| File | Role |
|---|---|
| `src/biq/decompress.js` | PKWare IMPLODE decompressor (ported from Go reference) |
| `src/biq/biqBuffer.js` | `BiqReader` / `BiqWriter` — sequential little-endian I/O helpers |
| `src/biq/biqSections.js` | Per-section parsers, serializers, English-field generators, `applyEdits` |
| `src/biq/biqBridgeJs.js` | Public API: `parseBiqBuffer` / `applyBiqEdits` |

## Operation paths

```
inflateBiqIfNeeded:
  decompress(raw)             → ok → use result
                              → fail → return { ok: false, error }

runBiqBridgeOnInflatedBuffer:
  jsParseBiqBuffer(buf)       → ok → use result
                              → fail → return { ok: false, error }

applyBiqReferenceEdits:
  jsApplyBiqEdits(buf, edits) → ok → write output directly
                              → fail → return { ok: false, error }
```

On failure the caller receives `{ ok: false, error: ... }`.

## biqSections.js architecture

### BiqIO

Carries version context across all section parsers:

```js
{ versionTag, majorVersion, minorVersion, numEras, mapWidth, isConquests, isPTWPlus }
```

`isConquests` is true for `BICX` + `majorVersion === 12`.
`mapWidth` is populated when the WMAP section is encountered during a full parse pass.

### parseAllSections(buf) → parsed

1. Validates 736-byte header (`BICXVER#` or `BIC VER#`).
2. Scans the buffer for each section tag from `SECTION_ORDER` using `findSectionTag` (needle search + sanity-check on the count field).
3. For ERAS, captures `io.numEras = count`.
4. For WMAP, parses the first record to extract `io.mapWidth`.
5. For TILE (fixed-size), reads each raw record and calls `parseTILE(rawRecord, tileIndex, io)`.
6. For all other known sections (len-mode), reads `dataLen` + body and calls the section's `parse` function.
7. Unknown / unimplemented sections fall through to `parseGeneric` (stores `_rawData`).

Returns `{ ok, versionTag, majorVersion, ..., sections, io, _headerBuf }`.

### buildBiqBuffer(parsed) → Buffer

Concatenates `_headerBuf` with each section's bytes.
Sections with `_modified = true` are re-serialized via `serializeSection`.
Unmodified sections use their cached `_rawBuf` slice for zero-copy round-trip.

### applyEdits(buf, edits) → { ok, buffer, applied, skipped, warning }

Parses the buffer, applies each edit in order, then calls `buildBiqBuffer`.
Supported ops: `set`, `add`, `copy`, `delete`.
Records are located by civilopedia key or `@INDEX:N` ref.

### SECTION_REGISTRY

Maps section code → `{ parse, serialize, toEnglish, writableKeys, hasCivKey, mode }`.
`mode: 'fixed'` sections (TILE, CONT, SLOC, CLNY) are read/written as raw fixed-size records.
For Conquests, `CLNY` uses a 24-byte fixed record: 4-byte `dataLen` prefix plus a 20-byte body that includes `improvementType`.
`mode: 'len'` sections prefix each record with a 4-byte `dataLen`.

## Per-section notes

### TILE (fixed-size, surgical edits)

- Record size: 49 bytes (Conquests: 4-byte dataLen prefix + 45-byte body).
- `parseTILE` reads the raw record and decodes all named fields from `TILE_FIELDS`.
- `xpos` / `ypos` are computed from `tileIndex` and `io.mapWidth` — they are not stored in the binary.
- `applySetToRecord` for TILE writes the value directly into `rec._rawRecord` at the field's byte offset. This keeps the raw record authoritative and avoids a full re-serialize cycle for map edits.
- `serializeTILE` returns `Buffer.from(rec._rawRecord)` unchanged.

Tile index ↔ coordinate math (Civ3 staggered grid):
```
half = floor(mapWidth / 2)
yPos = floor(tileIndex / half)
xPos = (tileIndex % half) * 2 + (yPos & 1)
```

### PRTO (partial parse, _tail)

PRTO records contain several Conquests-only variable-length arrays (per-era animation filenames, requirement resource lists, etc.) whose exact layout is difficult to reconstruct without the full Quint_Editor model.

Strategy: parse the leading fixed fields (zoc flag, name 32 bytes, civKey 32 bytes, 14 scalar int32s), then store the remainder as `_tail: Buffer`. Serialization writes the parsed fields followed by `_tail` unchanged.

Consequence: individual PRTO fields beyond the 14 scalars are not exposed as editable. ADD/COPY operations produce simplified default records; complex array fields are zeroed/empty. This is acceptable for scenario-header edits (name, tech requirements, etc.) but not for full unit sheet editing.

### GAME (_tail)

`parseGAME` reads:
- `useDefaultRules`, `defaultVictoryConditions`
- `numPlayableCivs` + `playableCivIds[]`
- `victoryConditionsAndRules`

Then stores the remainder (timescale settings, scenario search folders) in `_tail`.

`scenarioSearchFolders` is exposed read-only in the English output. `applySetToRecord` explicitly blocks writes to it (`canonicalKey === 'scenariosearchfolders'` → returns false).

### Generic pass-through

Sections not in `SECTION_REGISTRY` (e.g., CTZN, CULT, DIFF, ERAS, ESPN, EXPR, RULE, TFRM, TERR, WSIZ, FLAV, WCHR, WMAP, CONT, SLOC, CLNY) are stored as `_rawData` and round-tripped byte-for-byte. They appear in the bridge output with a minimal English summary (byte length + first 12 uint32 values). They are not editable via the JS bridge.

## Known limitations

- PRTO complex arrays (per-era filenames, resource requirements) are opaque.
- GAME tail fields beyond the named scalars are opaque.
- ADD/COPY for PRTO/RACE produces simplified defaults; scenarios relying on precise per-era animation data should use COPY from an existing record, then refine via SET.
- No support for Vanilla (BIC) or PTW-only BIQ formats in the write path. The JS bridge reads them (generic pass-through for format differences) but always writes Conquests-style output. Use the Java fallback for non-Conquests files.
- No index-cascade on ADD/DELETE: adding or removing a TECH record does not update BLDG/GOVT/RACE prerequisite indices. The caller is responsible for patching cross-references via additional SET edits.
