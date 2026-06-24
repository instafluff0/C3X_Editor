# CIV Tab

## Source
- `../Quint_Editor/Shared/Civ3_Editor/src/main/java/com/civfanatics/civ3/xplatformeditor/CIVTab.java`

## Backing BIQ Sections
- `RACE`

## Data Dependencies
- `PRTO`, `GOVT`, `ERAS`, `TECH`, scenario color data, `GAME` alliance state

## Quint Layout Contract
Quint uses a civilization list on the left and a multi-panel editor on the right.

### Top-Level Identity Strip
- `Civilopedia Entry`: text field
- `Noun`: text field
- `Adjective`: text field
- Grammar gender: radio buttons `Masculine`, `Feminine`, `Neuter`
- Number/plurality: radio buttons `Singular`, `Plural`
- `Culture Group`: dropdown
- `Default Color`: dropdown
- `Unique Color`: dropdown
- `Diplomacy Text Index`: numeric/text field
- `Unknown`: numeric/text field

### Panels
- `Leader`
  - `Title`: text field
  - `Name`: text field
  - Leader gender: radio buttons `Male`, `Female`
  - `Monarch unit`: dropdown
- `Personality`
  - `Favorite Govt`: dropdown
  - `Shunned Govt`: dropdown
  - `Aggression`: slider/range control
- `Traits`
  - Checkboxes for `Militaristic`, `Religious`, `Expansionist`, `Commercial`, `Industrious`, `Scientific`, `Agricultural`, `Seafaring`
- `Build Often/Never`
  - Two-column matrix of often/never toggles for AI priorities:
    - Offensive Land Units
    - Defensive Land Units
    - Artillery Units
    - Settlers
    - Workers
    - Naval Units
    - Air Units
    - Growth
    - Production
    - Happiness
    - Science
    - Capitalization
    - Trade
    - Exploration
    - Culture
- `Animations`
  - Era selector rows with `Fwd` and `Bwd` filename text fields
- `Free Technologies`
  - Technology dropdowns/slotted selectors
- `Governor Settings`
  - Checkboxes:
    - `Manage Citizens`
    - `Manage Production`
    - `No Wonders`
    - `No Small Wonders`
    - `Emphasize Food`
    - `Emphasize Production`
    - `Emphasize Trade`
- `Flavors`
  - Flavor list / flavor weight controls

### Auxiliary Lists
- Separate list editors for city names, military leaders, and scientific leaders sit alongside the main panels.

## Notes
- Quint keeps the civilization identity fields outside the titled panels, then uses titled panels for behavioral groupings.
