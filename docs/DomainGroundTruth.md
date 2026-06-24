# Domain Ground Truth

## Purpose
Durable Civ3/C3X data semantics used by this app. Keep this file factual and code-backed.

## C3X Load and Precedence Semantics
Source basis: `injected_code.c` behavior.

### Base Config (`*.c3x_config.ini`)
- In `C3X_Districts` current source snapshot (`patch_load_scenario`), load order is:
  - `default.c3x_config.ini` -> `scenario.c3x_config.ini` (if present) -> `custom.c3x_config.ini`.
- Merge semantics: cumulative key override.
- Effective precedence in that path: `custom > scenario > default`.
- This is different from district/wonder/natural/animation replacement files and should be treated explicitly in app UX/docs.

### Replacement-Style Sectioned Configs
Applies to:
- `*.districts_config.txt`
- `*.districts_wonders_config.txt`
- `*.districts_natural_wonders_config.txt`
- `*.tile_animations.txt`

Rules:
- Attempt order: `default`, then `user`, then `scenario`.
- Successful later load replaces prior definitions (not key-merge).
- Effective precedence: `scenario` else `user` else `default`.
- Natural wonder animation entries are appended at runtime after tile animation load.
- Scenario files are discovered via scenario asset lookup (`BIC_get_asset_path`), so the effective scenario override file must be in scenario search paths.

## Format and Parsing Behavior
- List fields accept comma-delimited values with optional quoted items.
  - Quoted tokens preserve embedded spaces/commas as a single item.
  - Missing closing quote is a hard parse error for that key.
- For square-type lists, token validation is strict.
  - `buildable_adjacent_to` allows `city`.
  - `buildable_on` does not allow `city`.

## Tile Animation Resolution Rules
- Tile animation configs are loaded in replacement order (`default` -> `user` -> `scenario`) only when custom animations are enabled.
- Natural wonder animation entries are appended after tile animation files are loaded.
- Winner selection priority for multiple matching animations on one tile is:
  - `resource > natural wonder > pcx > terrain > coastal-wave`
  - if tied, entries with season/hour constraints are preferred
  - if still tied, later config entry wins

## Capacity and Limit Constants (C3X.h)
- `MAX_DISTRICT_DEPENDENTS = 64`
- `MAX_WONDER_DISTRICT_TYPES = 32`
- `MAX_NATURAL_WONDER_DISTRICT_TYPES = 32`
- `MAX_TILE_ANIMATION_CONFIGS = 128`
- `MAX_TILE_ANIMATION_ADJACENCY = 8`
- `MAX_DISTRICT_VARIANT_COUNT = 5` (culture variants)

## Mode-Specific Write Targets

### Standard Game
- Base: `custom.c3x_config.ini`
- Districts: `user.districts_config.txt`
- Wonders: `user.districts_wonders_config.txt`
- Natural wonders: `user.districts_natural_wonders_config.txt`
- Tile animations: `user.tile_animations.txt`

### Scenario
- Base: `scenario.c3x_config.ini`
- Districts: `scenario.districts_config.txt`
- Wonders: `scenario.districts_wonders_config.txt`
- Natural wonders: `scenario.districts_natural_wonders_config.txt`
- Tile animations: `scenario.tile_animations.txt`

## Civilopedia/Pedia Layering
Read-only sources and precedence:
- Vanilla: `Text/Civilopedia.txt`, `Text/PediaIcons.txt`
- PTW: `civ3PTW/Text/Civilopedia.txt`, `civ3PTW/Text/PediaIcons.txt`
- Conquests: `Conquests/Text/Civilopedia.txt`, `Conquests/Text/PediaIcons.txt`
- Precedence: `Conquests > PTW > Vanilla`.

Key families:
- Civs: `RACE_*`
- Techs: `TECH_*`
- Resources: `GOOD_*`
- Improvements: `BLDG_*`
- Units: `PRTO_*`

Pedia quirks:
- Tech icons use `#TECH_*` and `#TECH_*_LARGE` (not `#ICON_TECH_*`).
- Unit animation indirection uses `#ANIMNAME_PRTO_*`.
- Art lookup precedence: `Conquests/Art` -> `civ3PTW/Art` -> `Art`.

## Serialization Compatibility Requirements
- Base config line format: `key = value`.
- Sectioned file format: section marker + `key = value` lines.
- Preserve quoted token lists where present.

## C3X and District References to BIQ Data
- C3X base and District config references are serialized as names/tokens, not BIQ numeric indices.
- These references are not vulnerable to final-BIQ-index drift when pending BIQ entries are saved.
- They can still become stale if a referenced item is renamed or deleted; treat that as a name-integrity problem, not an index-normalization problem.
- Save/reload coverage should include pending BIQ entries referenced by name from C3X base and District fields.
- See `docs/biq/PendingReferenceSaveFlow.md`.

## C3X Named Tiles (Scenario Placement File)
- C3X named tiles are parsed from `scenario.districts.txt` using `#NamedTile` sections in the same file family as pre-placed districts.
- Required fields per named tile section:
  - `coordinates = x,y`
  - `name = ...`
- `name` parsing strips matching double quotes; single quotes are not stripped by this parser path.
- Coordinates are wrapped to map bounds before lookup.
- Tiles containing Natural Wonder districts are rejected for naming.
- Reference: `docs/C3XScenarioDistrictsFile.md`.

## Quint Editor District Persistence
- Quint Editor map district placement is persisted in a scenario companion file:
  - `<scenario basename>.c3x.txt` (for example `MyScenario.biq` -> `MyScenario.c3x.txt`)
- This companion format is separate from BIQ core section serialization.
- See:
  - `docs/biq/districts/ScenarioFormat.md`
  - `docs/biq/districts/ReadWriteFlow.md`

## Update Policy
- Add only durable semantics and invariants.
- If uncertain, validate behavior in code/tests before documenting.
