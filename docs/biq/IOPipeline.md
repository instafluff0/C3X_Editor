# IO Pipeline Details

## Binary layout reference

The binary layout for all BIQ sections was derived from the Quint_Editor Java source at:
`../Quint_Editor/Shared/Civ3_Shared_Components/src/main/java/com/civfanatics/civ3/biqFile/IO.java`

This file is a read-only layout reference only. It is not used at runtime and there is no Java dependency.

### Key layout notes
- All integers are little-endian.
- Optional section families: custom rules (`BLDG`…`FLAV`), custom map (`WCHR`…map payload), custom player data (`LEAD`).
- Version-sensitive fields: Conquests (`majorVersion=12`) adds extra tail data to GAME; `minorVersion>=7` adds MP timer fields.
- Compressed BIQs use PKWare IMPLODE; raw BIQs start with `BIC`.

---

## JS pipeline (C3X implementation)

The app uses a pure-JS pipeline with no external dependencies.

See `docs/biq/JSBridge.md` for the full architecture and per-section notes.
See `docs/biq/MapPipelineParity.md` for the Quint-to-C3X map pipeline mapping and current save-path boundaries.

### Inflate path (`src/configCore.js → inflateBiqIfNeeded`)
1. Read raw file bytes.
2. If magic starts with `BIC`, file is uncompressed — use as-is.
3. Otherwise call `decompress(raw)` from `src/biq/decompress.js` (PKWare IMPLODE).
4. On failure, return an error.

### Parse path (`src/configCore.js → runBiqBridgeOnInflatedBuffer`)
1. Call `parseBiqBuffer(buf)` from `src/biq/biqBridgeJs.js`.
2. On failure, return an error.

### Edit/save path (`src/configCore.js → applyBiqReferenceEdits`)
1. Inflate the BIQ.
2. Call `applyBiqEdits({ buffer, edits })` from `src/biq/biqBridgeJs.js`.
3. Write the returned buffer directly to the output path.
