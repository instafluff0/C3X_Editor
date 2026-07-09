# TFRM Tab

## Source
- `../Quint_Editor/Shared/Civ3_Editor/src/main/java/com/civfanatics/civ3/xplatformeditor/TRFMTab.java`

## Backing BIQ Sections
- `TFRM`

## Data Dependencies
- `TECH`, `GOOD`

## Quint Layout Contract
Quint uses a worker-job list on the left and a compact form on the right.

### Top-Level Fields
- `Civilopedia Entry`: text field
- `Order`: text field
- `Turns to Complete`: numeric field
- `Prerequisite`: technology dropdown

### Panel
- `Required Resources`
  - Two resource dropdown slots

## Notes
- Quint treats required resources as a grouped subpanel, even though the rest of the tab is flat.
- BIQ `TFRM` records do not store in-game command button art coordinates. The game uses the fixed command-button atlas convention from `Conquests/Art/interface/NormButtons.pcx`.

## Command Button Atlas
The Conquests `NormButtons.pcx` worker command icons are 32x32 cells in an 8-column atlas. Indices below are 0-based, row-major, with crop coordinates `x = column * 32`, `y = row * 32`, `w = 32`, `h = 32`.

| Action | Row | Column | Index |
| --- | ---: | ---: | ---: |
| Build Colony | 2 | 4 | 20 |
| Build Road | 2 | 6 | 22 |
| Build Railroad | 2 | 7 | 23 |
| Build Fortress | 3 | 0 | 24 |
| Build Mine | 3 | 1 | 25 |
| Irrigate | 3 | 2 | 26 |
| Clear Forest | 3 | 3 | 27 |
| Clear Wetlands | 3 | 4 | 28 |
| Plant Forest | 3 | 5 | 29 |
| Clear Damage | 3 | 6 | 30 |
| Build Airfield | 4 | 1 | 33 |
| Build Radar Tower | 4 | 2 | 34 |
| Build Outpost | 4 | 3 | 35 |
| Build Barricade | 4 | 4 | 36 |

Build Colony is a worker-action command icon, but it is not one of the standard `TFRM` terrain transformation records. Scenario art can replace the atlas file, but the cell convention is fixed by the game UI.
