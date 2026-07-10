# agents.md

## Purpose
This repository is an Electron app (`Civ 3 | C3X Modern Editor`) for editing C3X/Civ3 configuration and scenario files safely.

This document is the agent contract: keep it short, durable, and implementation-focused.
Assume all users are on Windows.
Do not turn this file into a changelog.

## Scope and Mode Model
- UI editing modes:
  - `Standard Game` (global)
  - `Scenario`
- App is a file manager/editor, not a Civ3 rules reinterpretation engine.
- Preserve format compatibility with existing game/mod tools.

## Core Ground Truth (Do Not Violate)
Behavior follows C3X parsing semantics from `injected_code.c`.

1. Base config (`*.c3x_config.ini`)
- In current `C3X_Districts` scenario load path: `default` -> `scenario` (if present) -> `custom`.
- Merge style: key override (cumulative).
- Effective precedence in that path: `custom > scenario > default`.
- This precedence differs from district/wonder/natural/animation replacement configs.

2. District-like sectioned configs
- Applies to:
  - `*.districts_config.txt`
  - `*.districts_wonders_config.txt`
  - `*.districts_natural_wonders_config.txt`
  - `*.tile_animations.txt`
- Load attempts: `default`, then `user`, then `scenario`.
- Merge style: replacement (successful later file replaces earlier definitions).
- Effective precedence: `scenario` else `user` else `default`.
- Natural wonder animation entries are appended at runtime after tile animation load.

## Write Targets by Mode
- Standard Game writes:
  - Base: `custom.c3x_config.ini`
  - Districts: `user.districts_config.txt`
  - Wonders: `user.districts_wonders_config.txt`
  - Natural wonders: `user.districts_natural_wonders_config.txt`
  - Tile animations: `user.tile_animations.txt`
- Scenario writes:
  - Base: `scenario.c3x_config.ini`
  - Districts: `scenario.districts_config.txt`
  - Wonders: `scenario.districts_wonders_config.txt`
  - Natural wonders: `scenario.districts_natural_wonders_config.txt`
  - Tile animations: `scenario.tile_animations.txt`

## Scenario Isolation Guardrails
- Scenario mode writes must stay inside allowed scenario roots:
  - `.biq` directory
  - resolved scenario search roots
- Reject any write outside allowed roots.
- `Scenario Search Folders` is UI-locked and ignored on save payloads.
- Copy Scenario flow must localize referenced search roots and rewrite BIQ folder paths to local relative paths.

## Architecture Map
- Main process: `main.js`
- Renderer/UI: `src/renderer.js`
- Parsing/serialization: `src/configCore.js`
- Art decoding and preview: `src/artPreview.js`
- Preload IPC surface:
  - `getSettings`, `setSettings`
  - `loadBundle`, `saveBundle`
  - `getPreview`
  - `pickDirectory`, `pickFile`, `pathExists`

## File and Path Rules
- Persist settings in Electron `userData/settings.json`.
- Infer missing paths on startup; auto-load when inferred/saved paths are valid.
- Path inputs are browse/select driven to avoid typo drift.

# Changelog and Versioning
- Agent-authored changes must add a concise entry to `changelog.txt`; keep release notes there, not in this file.
- Check the current version in package.json and make sure that corresponds to your changelog entry.
- Never bump the version yourself. The human will handle that.
- If you don't see the package.json version in the changelog, add it to the top.
- Never add a changelog version (e.g. "R28.1") that is higher than the version shown in package.json.

## Civilopedia/Pedia Ground Truth
- Standard Game read-only sources are layered:
  - Vanilla: `Text/Civilopedia.txt`, `Text/PediaIcons.txt`
  - PTW: `civ3PTW/Text/Civilopedia.txt`, `civ3PTW/Text/PediaIcons.txt`
  - Conquests: `Conquests/Text/Civilopedia.txt`, `Conquests/Text/PediaIcons.txt`
- Layer precedence: `Conquests > PTW > Vanilla`.
- Key families:
  - Civs: `RACE_*`
  - Techs: `TECH_*`
  - Resources: `GOOD_*`
  - Improvements: `BLDG_*`
  - Units: `PRTO_*`
- Tech icon mapping is a special case in `PediaIcons.txt` (`#TECH_*`, `#TECH_*_LARGE`).
- Unit animation folder indirection uses `#ANIMNAME_PRTO_*`.
- Art preview resolution precedence: `Conquests/Art` -> `civ3PTW/Art` -> `Art`.

## UI Editing Invariants
- Keep `Standard Game` vs `Scenario` abstraction explicit in UI and save behavior.
- Prefer structured editors for known formats; do not regress to opaque raw strings when schema exists.
- Keep unknown keys editable (do not hide data).
- Preserve parser-safe serialization forms:
  - Base config: `key = value`
  - Sectioned files: section marker + `key = value`
- Preserve quoted list token semantics in sectioned text values.

## Known Hard Safety Constraints
- `Terrain -> Terrain Types` (`TERR`) is structurally immutable in UI (no add/copy/import/delete).
- Reason: terrain IDs are index-coded in map data; structural mutation risks map corruption without full cascade support.
- Scenario saves must block unresolved new unit animation folder references when edited keys cannot resolve valid INI paths.

## Save UX Contract
- Save feedback is in-app (snackbar + details modal), not OS confirmation popups.
- Save details states: `Saving`, `Saved`, `Rolled Back`, `Failed`.
- Save transaction remains atomic with rollback on failure.
- Main and modal Save/Undo/Undo All controls share one dirty/undo state contract; keep details in `docs/UIInvariants.md`.

## Art Preview Contract
- Supported previews:
  - Districts PCX
  - Wonder district PCX crops
  - Natural wonder PCX + optional animation
  - Tile animation INI -> FLC
- Renderer playback keeps aspect ratio and honors frame timing controls.

## Verification Commands
Run before finalizing normal feature changes:

```bash
node --check main.js
node --check src/renderer.js
node --check src/artPreview.js
npm test
```

`npm test` runs the fast tier. For BIQ parser/save/reference changes, also run `npm run test:biq`. Before release/version prep, run `npm run test:full`; it includes every test and can take 10+ minutes.

## Debug Logs
- For live app debugging, check the daily renderer/app log directly before asking the user to paste log lines.
- macOS log path: `~/Library/Application Support/Civ 3 C3X Modern Editor/logs/c3x-config-manager-YYYY-MM-DD.log`
- Windows log path: `%APPDATA%\Civ 3 C3X Modern Editor\logs\c3x-config-manager-YYYY-MM-DD.log`
- Use the user's local current date for `YYYY-MM-DD` and prefer tailing/filtering that file while reproducing issues.

## Deep-Dive References
- `docs/DomainGroundTruth.md` for detailed precedence and file semantics.
- `docs/UIInvariants.md` for stable UI/save behavior contracts.
- `docs/Quirks.md` for edge cases that commonly cause regressions.
- `docs/FlcReference.md` for Civ3 FLC parsing/palette/timing/direction behavior from Civ3FlcEdit source review.
- `docs/biq/README.md` for Quint_Editor-derived BIQ handling architecture.
- `docs/biq/IOPipeline.md` for BIQ read/write and optional-section pipeline details.
- `docs/biq/districts/ScenarioFormat.md` for Quint district companion file format (`<scenario>.c3x.txt`) and validation rules.
- `docs/biq/districts/ReadWriteFlow.md` for district sidecar load/save lifecycle and TILE runtime mapping.
- `docs/C3XScenarioDistrictsFile.md` for C3X `scenario.districts.txt` mixed format (`#District` + `#NamedTile`) and named-tile parsing rules.
- `docs/biq/sections/*.md` for per-section BIQ model deep dives.
- `docs/biq/tabs/*.md` for per-tab BIQ mapping and dependencies.
- `docs/Editing.md` for extended Civ3 data/storage notes.
- `docs/Civ3Music.md` for Civ3 music layout, scenario playlist behavior, and Music-tab UX implications.
- `docs/CivAdvisorGeneral.md` for the first-pass SAV source mapping needed to recreate CivAssist II's General tab.
- If a topic here grows beyond stable rules, move detail to `docs/` and keep only a short summary here.

## Maintenance Rules for This File
- Keep this file concise and evergreen.
- Prefer invariant statements over "recently changed" notes.
- Remove superseded guidance instead of stacking contradictory bullets.
- If a behavior is volatile, document it in a dedicated `docs/*` file and link it here.
