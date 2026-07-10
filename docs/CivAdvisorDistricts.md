# Civ Advisor and C3X Districts

These notes capture how Civ Advisor should treat C3X districts when reading `.SAV` files. The goal is to avoid rediscovering the same distinction later: current save values, saved C3X district state, and current scenario/config files are related but not interchangeable.

Primary sources:

- `../C3X_Districts/injected_code.c`
  - `patch_move_game_data(...)`
  - `get_effective_district_yields(...)`
  - `apply_district_bonus_entries(...)`
  - `district_tile_bonus_applies_to_city(...)`
  - `district_tile_should_be_unworkable(...)`
  - `draw_district_generated_resource_on_tile(...)`
- `../C3X_Districts/C3X.h`
  - `struct district_instance`
  - `struct wonder_district_info`
  - `struct natural_wonder_district_info`
- C3X config families:
  - `*.c3x_config.ini`
  - `*.districts_config.txt`
  - `*.districts_wonders_config.txt`
  - `*.districts_natural_wonders_config.txt`
- Scenario placement file:
  - `scenario.districts.txt`, documented in `docs/C3XScenarioDistrictsFile.md`

## Core rule

For current-game advisor values, prefer live `.SAV` city/player/tile aggregates. Do not reconstruct food, shields, commerce, science, happiness, culture, maintenance, corruption, or waste from BIQ rules plus C3X district configs unless the save lacks the serialized field we need.

C3X recalculates city state in-game. When a save is written after that recalculation, city fields such as food, production, commerce, tax, science, luxury, corruption, waste, maintenance, happiness, and culture-related outputs can already include district effects. Adding district config bonuses on top of those saved fields would double-count them.

District parsing is still necessary for:

- explaining why saved values look the way they do;
- territory/tile classification, especially district tiles that carry mine-like overlays;
- build availability and production legality;
- projections that simulate a future state instead of displaying the saved current state;
- resource availability explanations when generated district resources are involved;
- detecting config mismatch between the saved district IDs and the currently loaded scenario/user configs.

## Config files define district yields; saves define live instances

C3X reads district yield definitions from the effective C3X config files when Civ3/C3X starts and when the scenario is loaded. The save does not store the full district yield tables.

For Civ Advisor this means:

- current saved city aggregates are the source of truth for current output;
- the save's C3X chunks are the source of truth for which district instances exist in that save;
- current C3X config files are needed only when we want to name, explain, or project those district instances;
- config-derived yield interpretation is safe only when the saved `district_config_names` match the effective loaded district config names.

## Save chunks are authoritative for live district instances

C3X appends a mod-save segment around the vanilla Civ3 save data. `patch_move_game_data(...)` reads/writes named chunks inside that segment. For districts, relevant chunks are:

- `district_config_names`
- `district_pending_requests`
- `building_pending_orders`
- `district_tile_map`
- `natural_wonder_districts`
- `distribution_hub_records`
- `aerodrome_airlift_usage`
- `named_tiles`

The current save's `district_tile_map` is the authoritative source for live district instances. It stores placement/state, not yield definitions. `scenario.districts.txt` is a scenario seed/fallback, not proof of what exists after turns have been played.

`district_tile_map` payload:

```text
int32 count
repeat count times:
  int32 x
  int32 y
  int32 district_id
  int32 state
  int32 built_by_civ_id
  int32 completed_turn
  int32 wonder_state
  int32 wonder_city_id
  int32 wonder_index
```

`natural_wonder_districts` payload:

```text
int32 count
repeat count times:
  int32 x
  int32 y
  int32 natural_wonder_id
```

`distribution_hub_records` has a legacy fixed shape and a newer variable-length shape. Newer saves write a negative count:

```text
int32 negative_count
repeat abs(count) times:
  int32 x
  int32 y
  int32 civ_id
  int32 city_selection_mode
  int32 selected_city_count
  int32 selected_city_id[selected_city_count]
```

Important implementation detail: inside the C3X mod-save segment, these payload ints are little-endian. The segment's label alignment is relative to the segment buffer, not necessarily to the absolute `.SAV` file offset.

## District IDs are config-order dependent

`district_id` is an index into the loaded `district_configs` array. It is not a stable semantic ID by itself.

C3X saves `district_config_names` and compares each saved ID/name pair against the current district config on load. If the count or any name at an ID differs, C3X warns the player that the save's district config does not match the currently configured district list.

Civ Advisor should follow the same principle:

- It may count/locate saved district instances without loading current district configs.
- It must not interpret `district_id = N` as a specific district name or bonus unless the saved `district_config_names` match the loaded effective district config names.
- If names mismatch, the UI should show save-native district IDs/coordinates conservatively or mark config-derived explanations unavailable.

## Scenario/config fallback rules

Use current scenario/config files only when the advisor is doing something that requires C3X rules rather than current saved aggregates.

Valid uses:

- projecting a hypothetical future city yield;
- explaining saved district output by name/bonus after `district_config_names` match;
- checking whether an improvement/unit/build order is legal under current district requirements;
- showing district names/art for a save that matches the loaded scenario/config.

Invalid uses:

- replacing saved city science/tax/production/happiness/current culture with recomputed values;
- applying district bonuses again to saved city output fields;
- interpreting saved district IDs through a different loaded scenario's district config;
- assuming `scenario.districts.txt` reflects a mid-game save after districts have been built, destroyed, or generated by gameplay.

If no district save chunks are present, `scenario.districts.txt` can be used only as a seed approximation when the selected save's embedded rules and scenario identity match the currently loaded scenario. It should not be treated as authoritative live state.

## Runtime effects relevant to Civ Advisor

C3X district effects touch more than visuals. They can affect these advisor domains:

| Advisor area | District impact | Current-value guidance |
| --- | --- | --- |
| Economy | Gold, science, luxury, tax, corruption/waste-visible city outputs, maintenance context, unit/building implications | Use saved city/player aggregates. Do not add district bonuses again. |
| Techs | Science output and research pace can include district science | Prefer saved city science output for game-parity research pace; use configs only for future projections/explanations. |
| Cities | Food, shields, commerce, happiness, worked/unworked tile behavior, population caps from Neighborhoods | Use saved city fields for current rows. Use district chunks for tile classification and explanations. |
| Culture | District culture bonuses and district-enabled buildings/wonders can affect city/civ culture outputs | Use saved culture fields for current culture. Use district configs for availability/projection only. |
| Production | Shields, district-required improvements, Aerodrome/Port production/base restrictions, Wonder District state | Use saved production progress/current output. Use district chunks/configs for legality and forecast rows. |
| Trade/resources | Generated district resources can affect resource availability and city resource checks | Use saved `LEAD` resource tables for current trade options. Use district data only to explain/projection-check generated resources. |
| Alerts | Missing district prerequisites, pending district/building orders, config mismatch, district-generated resources | District chunks/configs are useful alert inputs. |

## Yield model

`get_effective_district_yields(...)` combines:

1. base district config fields:
   - `food_bonus`
   - `shield_bonus`
   - `gold_bonus`
   - `science_bonus`
   - `culture_bonus`
   - `happiness_bonus`
2. optional named extra entries on those fields, via `apply_district_bonus_entries(...)`;
3. natural wonder bonuses when the instance is `NATURAL_WONDER_DISTRICT_ID` and natural wonders are enabled.

Extra entries can depend on tile type or building presence. Building-dependent extras differ by district type:

- tile-improvement style districts use the city working/containing the tile;
- normal districts can consider cities in the district radius.

District completion matters. `district_is_complete(...)` treats `DS_COMPLETED` as complete. Under-construction districts can become complete when the tile reaches the expected mine state.

## Tile workability and tile classification

Completed districts that `district_tile_should_be_unworkable(...)` returns true for are made unworkable for all cities. Distribution hub coverage can also make tiles unworkable.

Civ Advisor should be careful with territory/improvement rows:

- C3X district tiles may carry raw mine overlays.
- Territory mine totals should exclude district coordinates so district placement does not appear as ordinary tile mining.
- Counting worked/non-district tiles should exclude district coordinates when trying to classify city-worked improvements.

The Tokugawa 740 fixture demonstrates this: the save has 90 saved district instances and 40 owned-land district tiles. The current Territory report tracks those counts and excludes district mine overlays from the Mined improvement totals so district placement does not masquerade as ordinary tile mining.

## Generated resources

District configs can define `generated_resource` with flags such as:

- `local`
- `yields`
- `no-tech-req`

`draw_district_generated_resource_on_tile(...)` only displays a district-generated resource when the district is complete and `district_generates_resource_for_civ(...)` succeeds for the tile owner/visible civ. This affects visual map output and can affect resource availability.

For current trade/resource tables, use saved `LEAD` resource availability and count arrays. Those are the game-state result. District generated resources are useful for explaining why a resource is available, or for projecting what would happen if a district/resource/config changes.

## Tokugawa 740 fixture findings

The reference save `/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 740 AD.SAV` is compressed, but after inflation it contains C3X district chunks.

Parsed C3X district state:

- `district_config_names`: 19 names
- `district_tile_map`: 90 completed instances
- `natural_wonder_districts`: 12 records
- `distribution_hub_records`: 3 records
- `district_pending_requests`: 46 records
- `building_pending_orders`: 14 records

Saved district names include:

- `Neighborhood`
- `Wonder District`
- `Distribution Hub`
- `Aerodrome`
- `Natural Wonder`
- `Port`
- `Central Rail Hub`
- `Energy Grid`
- `Bridge`
- `Canal`
- `Great Wall`
- `Technology Park`
- `Entertainment Complex`
- `Commercial Hub`
- `Industrial Zone`
- `Data Center`
- `Offshore Extraction Zone`
- `Wind Farm`
- `Solar Farm`

Japan has 14 saved completed district instances:

- 5 Neighborhoods
- 2 Entertainment Complexes
- 1 Commercial Hub
- 4 Wonder Districts
- 2 Ports

This confirms districts are active in the fixture. However, the previously observed `Gold per Turn` mismatch (`+7` in Civ Advisor vs `+3` in-game) is not caused by missing district yield reconstruction. The immediate mismatch is the unit-support computation: current Civ Advisor code uses the wrong rules object for town/city/metropolis support thresholds, so size-12 Republic cities are categorized incorrectly. Saved city science/tax/production fields already include current city output.

The Techs tab also needs a separate current-value correction: current code estimates beakers-per-turn from gross commerce and slider. The in-game Domestic Advisor shows 38 science and Education in 6 turns for the fixture, matching the saved city science outputs, not the current 22-beaker projection.

## Current implementation status

As of this note:

- Civ Advisor already reads many saved city aggregate fields directly.
- `src/biq/civAdvisor.js` parses `district_tile_map` for territory classification.
- A regression covers the Tokugawa fixture's 90 saved district instances and 40 owned-land district tiles.
- Civ Advisor does not yet parse `district_config_names`, `natural_wonder_districts`, or `distribution_hub_records` into a structured public report.
- Civ Advisor does not yet load/match effective C3X district configs for district-based explanations or projections.

## Recommended implementation order

1. Fix current-value bugs before adding district yield simulation:
   - Republic unit support should use `RULE.maxCity1Size`/`RULE.maxCity2Size`, not the live `GAME` object.
   - Tech research pace should prefer saved city science output for game parity.
2. Parse C3X mod-save district chunks into a structured internal object:
   - config names;
   - district tile map;
   - natural wonder records;
   - distribution hub records;
   - pending district/building orders.
3. Match saved `district_config_names` against the effective loaded C3X district config before resolving names/bonuses.
4. Add explanation/projection UI only after the current saved values are trusted.
5. For any simulated value, label it as a projection and keep it separate from saved current-value rows.
