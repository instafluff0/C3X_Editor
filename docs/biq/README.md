# BIQ Handling Deep Reference

## Scope
This directory documents BIQ binary layout and parsing behavior.
The app is a pure-JS implementation (`src/biq/`). No Java or JAR dependencies at runtime.

Binary layout was derived from the Quint_Editor source (read-only reference):
- `Shared/Civ3_Shared_Components/.../biqFile/IO.java` — file IO, section ordering, optional blocks
- `Shared/Civ3_Shared_Components/.../biqFile/*.java` — section models and field semantics
- `Shared/Civ3_Editor/.../xplatformeditor/*Tab.java` — UI tab-to-section mappings

## BIQ Processing Pipeline
- Reads little-endian BIQ data.
- Detects compressed files by checking first 4 bytes for BIC; if absent, decompresses with `src/biq/decompress.js` (PKWare IMPLODE).
- Detects version using header and major/minor values:
  - BICX + major 12 -> Conquests
  - BICX + non-12 -> PTW
  - BIC  -> Vanilla
  - BICQ + major 12 -> Conquests-in-SAV embedded rules
- Character-set handling is language-aware (Windows-1252, Windows-1251, GBK) with Windows-1252 as default.

## Section Order and Optional Blocks
In IO.inputBIQ(...), sections are processed in this order (with conditional branches):
1. Core header + metadata (description, title)
2. If BLDG header present: custom rules block
3. Optional custom map block beginning with WCHR (then WMAP, TILE, CONT, optional SLOC/CITY/UNIT/CLNY)
4. GAME block (present in PTW+ and later Vanilla versions)
5. Optional LEAD block (custom player data)

If custom rules are absent:
- Default rules are loaded via DefaultRulesLoader and section lists are populated from defaults.

## Conversion Behavior
- Pre-Conquests files may be converted to Conquests in-memory (convertToConquests flag).
- Conversion includes adding Conquests-specific defaults in selected areas (for example extra TRFM entries and flavor scaffolding).
- Save path writes Conquests-style sections in canonical order.

## Post-Processing and Link Repair
After raw section import, IO performs cross-linking and extraction:
- Resolves int references to object links (tech/resource/unit/building/civ/etc.).
- Performs map post-processing (tile positions, ownership/influence helpers, etc.).
- Repairs/normalizes some older-scenario structures when needed.

## Per-Section Docs
See docs/biq/sections/*.md for each BIQ section class.

Current section files:
- BLDG, CTZN, CULT, DIFF, ERAS, ESPN, EXPR, FLAV, GAME, GOOD, GOVT, LEAD, PRTO, RACE, RULE, TECH, TERR, TFRM, WSIZ, WCHR, WMAP, TILE, CONT, SLOC, CITY, UNIT, CLNY

## Per-Tab Docs
See docs/biq/tabs/*.md for editor tab mappings and dependencies.

Current tab files:
- BIC, BLDG, CIV, CTZN, CULT, DIFF, ERA, ESPN, EXPR, FLAV, GOOD, GOVT, PLYR, RULE, PROP, TECH, TERR, TFRM, UNIT, WSIZ, MAP

## Structured Knowledge Artifacts
- `docs/biq/catalog/schema.md`: machine-readable catalog schema.
- `docs/biq/catalog/fields.json`: initial field catalog for high-impact BIQ fields and links.
- `docs/biq/graph.md`: section dependency graph and optional-block gates.
- `docs/biq/invariants.md`: mutation safety rules and invariant checklist.
- `docs/biq/MapPipelineParity.md`: Quint-to-C3X map read/write pipeline mapping and current parity boundaries.
- `docs/biq/MapSectionMutationMatrix.md`: per-section mutation/ref-cascade matrix for `TILE`, `SLOC`, `CITY`, `UNIT`, and `CLNY`.
- `docs/biq/MapFieldProjectionMatrix.md`: raw-vs-display-vs-save source-of-truth matrix for high-risk BIQ map fields.
- `docs/biq/MapEditedSaveParityMatrix.md`: per-operation map save parity matrix listing which BIQ sections may change and which should remain byte-stable.
- `docs/biq/MapUnsupportedAndQuarantined.md`: explicit register of blocked, unsupported-safe, and quarantined BIQ map mutation classes.

## District Companion Files
Quint Editor district tile placement is persisted via sidecar text (not BIQ bytes):
- `docs/biq/districts/README.md`
- `docs/biq/districts/ScenarioFormat.md`
- `docs/biq/districts/ReadWriteFlow.md`

Related C3X runtime format:
- `docs/C3XScenarioDistrictsFile.md` (`scenario.districts.txt`, including `#NamedTile`)
