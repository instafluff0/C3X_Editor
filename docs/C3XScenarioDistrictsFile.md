# C3X Scenario Districts File (`scenario.districts.txt`)

## Scope
This document covers C3X parsing semantics for the mixed scenario placement file that can contain:
- District placements (`#District`)
- Named tile labels (`#NamedTile`)

Primary source:
- `../C3X_Districts/injected_code.c` (`load_scenario_districts_from_file`, `handle_scenario_district_key`, `handle_scenario_named_tile_key`, `finalize_scenario_district_entry`, `finalize_scenario_named_tile_entry`)
- `../C3X_Districts/C3X.h` (`scenario_district_entry`, `scenario_named_tile_entry`, `named_tile_entry`)

## File Discovery
- Filename is fixed: `scenario.districts.txt`.
- Located via `BIC_get_asset_path(...)`, so it must be reachable through scenario search roots.
- If file is missing/unreadable, parser no-ops.

## Top-Level Rules
- Legacy header `DISTRICTS` is accepted but optional.
- Parsing is line-based.
- Ignored lines:
  - empty lines
  - lines starting with `;`
  - lines starting with `[` (treated as comments/documentation lines)

## Section Directives
- `#District` starts a district section.
- `#NamedTile` starts a named-tile section.
- Directive matching is case-sensitive in source (`slice_matches_str`).

Important quirk:
- Unknown `#...` directives are ignored and do **not** explicitly terminate the current section type.

## `#District` Schema
Supported keys:
- `coordinates = x,y` (required)
- `district = ...` (required)
- `wonder_city = ...` (required only for Wonder District entries)
- `wonder_name = ...` (required for Wonder District and Natural Wonder entries)

Validation:
- `district` must match a loaded district config name exactly.
- Wonder District entries require both `wonder_city` and a `wonder_name` that resolves to a known wonder district config.
- Natural Wonder entries require `district = Natural Wonder` and `wonder_name = <natural wonder name>`.
- `wonder_city` on a Natural Wonder entry is reported as an ignored-field issue.
- `wonder_*` fields on non-wonder districts are reported as invalid-field issues.

## `#NamedTile` Schema
Supported keys:
- `coordinates = x,y` (required)
- `name = ...` (required)

Validation:
- Missing `coordinates` or `name` -> parse error.
- Coordinates must parse as two ints separated by comma.
- Coordinates are wrapped with map wrap logic before tile lookup.
- Tile must exist and must pass `tile_can_be_named(...)`.
  - Currently rejected if tile has a Natural Wonder district.

Application behavior:
- Valid entry calls `set_named_tile_entry(tile, x, y, name)`.
- Runtime entry stored in `is->named_tile_map`.

## String/Quote Behavior
- `district`, `wonder_city`, `wonder_name`, and named-tile `name` use `copy_trimmed_string_or_null(..., remove_quotes=1)`.
- `remove_quotes=1` strips matching **double quotes only**.
- Single quotes are not stripped by this parser path.
- Runtime storage is `char name[100]`, so stored label is truncated to 99 chars + null terminator.

## Error/Warning Reporting
- Parse errors and unrecognized keys are accumulated.
- End-of-load issues are shown in C3X popup under “District scenario file issues...”.
- Unrecognized keys are reported in a separate “Unrecognized keys” list.

## Named Tiles and Config Gates
- `enable_named_tiles = false`:
  - Named tile sections are parsed but finalized as no-op.
  - No named tile entries are created.
- Loading is invoked when any of:
  - `enable_districts`
  - `enable_natural_wonders`
  - `enable_named_tiles`

## Savegame Persistence (Not Scenario Text Export)
C3X persists named tiles into savegame mod chunk `named_tiles`:
- Per-entry payload: `int tile_x`, `int tile_y`, `char name[100]`.
- On save load, entries are restored into `is->named_tile_map`.

Critical distinction:
- C3X code shown here **reads** `scenario.districts.txt`, but does not provide a writer for that text file.
- If the app needs serialize support, treat this doc as the compatibility contract and emit canonical text accordingly.

## Suggested Canonical Output Shape
```ini
DISTRICTS

#District
coordinates  = 10,30
district     = Natural Wonder
wonder_name  = Mount Everest

#NamedTile
coordinates  = 41,23
name         = Tiber River
```

`#District` and `#NamedTile` sections may be mixed in a single file.
