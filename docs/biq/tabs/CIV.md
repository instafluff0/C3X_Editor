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
- `Unique Color`: dropdown in BIQ/Quint terms; use `Alternate` as the app label.
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
- Custom civilization color editing is scenario-only and edits `Art/Units/Palettes/ntp00.pcx` through `ntp31.pcx`; the BIQ only stores each civilization's selected default/alternate slot numbers.
- The Custom Civ Colors modal should stay compact and table-oriented, close to Quint's mental model: slot list on the left, selected palette rows on the right, row labels using Quint's known in-game role text.
- Color row filters should include `Rhye's Recommended`, `Main shades`, `Other useful colors`, `Gray`, `Protected`, and `All others`.
- Setting the main color means editing row 7 and regenerating linked rows immediately from the stock Civ3 palette template for that slot. Do not derive the generated ramp from the current row colors, because scenario palettes may already be flattened or manually damaged.
- Per-row hex/RGB/color-picker edits remain valid manual overrides. Hex edits to row 7 must trigger the same main-color generation path as the native color picker.
- Hue, Saturation, Balance, and Tint adjustments should live with the row filters as compact batch controls and update every currently affected visible row preview live.
- `Assign Unique Colors` should be minimally disruptive: keep the first civ already using a slot, move later duplicates to unused slots, and set default and alternate to the same slot for each changed civ.
