# PLYR Tab

## Source
- `../Quint_Editor/Shared/Civ3_Editor/src/main/java/com/civfanatics/civ3/xplatformeditor/PLYRTab.java`

## Backing BIQ Sections
- `LEAD`

## Data Dependencies
- `GAME`, colors, `TECH`, `PRTO`, `DIFF`, `GOVT`, `ERAS`, `RACE`, full IO object list

## Quint Layout Contract
Quint uses a player list on the left and grouped player-setup panels on the right.

### Top-Level Fields
- `# of Players`: numeric field
- `Playable Civilizations`: multi-select / list control. These values are stored in the `GAME` section, but Quint presents them on the players tab beside the `LEAD` player list; keep the editor UI aligned with that placement.

### Panels
- `Player Options`
  - Dropdowns:
    - `Civilization`
    - `Government`
    - `Difficulty`
    - `Initial Era`
  - `Starting Treasury`: numeric field
  - Checkboxes:
    - `Human Player`
    - `Civilization Defaults`
    - `Start with Embassies`
    - `Skip First Turn`
- `Player Information`
  - `Player Color`: dropdown
  - `Leader Name`: text field
  - `Gender` subpanel: radio buttons `Male`, `Female`
- `Starting Units`
  - Repeated `Unit` + `Amount` rows
  - Note indicating at least one must be edited above
- `Civilization Settings`
  - `Free Techs` area with technology selectors

## Notes
- Quint separates player-level overrides from civ defaults, but keeps both on the same tab.
- In Conquests saves, the `Difficulty` dropdown value `Any` is persisted in `LEAD.difficulty` as `-2`. Quint's `LEAD` constructor may temporarily hold `-1`, but `PLYRTab.storeData()` writes `-2`; editor saves must normalize `-1` to `-2` before writing.
- On custom maps, `WMAP.numCivs` must match the saved `LEAD` record count. Changing Scenario -> Players must update this map-level count, while `GAME` playable civilizations remains a separate rules-level list.
- Quint keeps the `LEAD.Civilization` dropdown constrained to `Any`, `Random`, and the civs selected in `GAME.playableCivIds`. A scenario with custom `LEAD` players should not mark civs playable unless those civs are fixed to some `LEAD` slot, or there is an explicit `Human Player` wildcard slot (`Any`/`Random`). Allowing extra playable civs can make Civ3 freeze during player setup when one is chosen.
- Fixed playable-civ scenarios with preplaced cities for every active player should save those cities as civ-owned (`CITY.ownerType = 2`), not player-slot-owned. Firaxis scenarios use this shape so choosing one of the allowed civs on the setup screen does not leave cities bound to stale `LEAD` slot ownership.
- Deleting a player must cascade player-owned map records (`SLOC`, `CITY`, `UNIT`, `CLNY`) and shift higher player owner indexes down. Do not leave ownerType `3` references pointing beyond the final `LEAD` count.
- Removing a BIQ map must also clear `scenario.districts.txt`; district and named-tile sidecar placements are map-coordinate data and must not survive after the map sections are removed.
