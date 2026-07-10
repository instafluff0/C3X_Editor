# Civ Advisor General Tab Notes

These notes capture the first pass at recreating CivAssist II's General tab from a `.SAV`.

Reference files used:

- Save: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 740 AD.SAV`
- CivAssist reference screenshot: General tab for `Tokugawa of the Japanese, 740 AD`
- Decompiled CivAssist file: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/CivAssist II/CivAssist.exe.c`
- Decompiled Civ3 source: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/C3X_Districts/ref/Civ3Conquests_master.exe.c`
- C3X patched source: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/C3X_Districts/injected_code.c`

The decompiled CivAssist file currently looks like a low-level PE/.NET metadata dump, not useful C# method logic. Treat it as a fallback; direct SAV section evidence is more productive.

For C3X district-specific save/config interactions, see `docs/CivAdvisorDistricts.md`. The short version is: district yields are defined by effective C3X config files when C3X starts/loads a scenario, while `.SAV` mod chunks persist live district instances and saved config-name alignment. Current Civ Advisor values should prefer saved city/player aggregates and avoid adding district yields a second time.

## Existing Local Entry Points

- `node scripts/inspect-sav.js <save> --limit N` prints the current debug summary.
- `src/biq/savExtract.js` inflates compressed SAVs and extracts the embedded `BICQ` rules payload.
- `src/biq/savInspect.js` parses the live SAV data after the embedded rules block.

Do not expect the embedded BIQ to contain live city/unit/map state. For this save, live state starts after the embedded rules payload at offset `219720`.

## Confirmed General-Tab Sources

For the reference save:

- SAV version `24.10` maps to CivAssist display `C3C122`.
- Embedded rules `GAME.victoryConditionsAndRules` plus live `GAME.rules` use the existing bit mapping in `src/biq/biqSections.js`:
  - bit 0: Domination
  - bit 1: Space Race
  - bit 2: Diplomatic
  - bit 3: Conquest
  - bit 4: Cultural
  - bit 8: Preserve Random Seed
  - bit 15: Allow Cultural Conversions
  - bit 18: Scientific Leaders
- Live `GAME.rules = 262155`, so the CivAssist display is `Domination, Space Race, Conquest`; Preserve Seed is `No`, Culture Flip is `No`, Scientific Leaders is `Yes`.
- Live `GAME.difficulty = 4`; embedded `DIFF[4].name = Emperor`.
- Live `GAME.turnNumber = 288`.
- The embedded scenario time scale converts turn `288` from start year `-4000` to `740 AD`.
- Live `GAME.timePlayedMs = 7671656`, which formats to `02:07:51`.
- Live `GAME.victoryType = -1` and `GAME.winner = -1`, so Game Status is `Incomplete` and Winning Player is blank.
- `humanPlayersMask = 2` means one human player, matching `Single Player`.

## Live Player Blocks

The current parser finds live `LEAD` blocks by scanning between the world data and unit run. For the reference save, player 1 is Japan:

- `LEAD body +0`: player ID (`1`)
- `LEAD body +4`: race ID (`8`, Japan)
- `LEAD body +16`: capital city ID (`0`, Kyoto)
- `LEAD body +20`: difficulty (`4`, Emperor for the human player)
- `LEAD body +132`: current government (`4`, Republic)
- `LEAD body +216`: current era (`1`, Middle Ages; visible in rival rows)
- `LEAD body +368`: live unit count (`38`)
- `LEAD body +376`: live city count (`2`)

For this save, Japan's direct city and unit aggregates match CivAssist:

- Cities owned by player 1: Kyoto and Osaka, count `2`.
- Citizen total from owned cities: `12 + 12 = 24`.
- Units owned by player 1: `38`.
- Capital city ID `0` resolves through live city records to `Kyoto`.

## Culture Blocks

Per-player live `CULT` blocks appear after each player's live `LEAD` data and before the next player's `LEAD`.

For Japan, the block at offset `1311294` is:

```text
CULT length 16: [3, 6021, 56, 1]
```

The useful fields for CivAssist General are:

- element 1: total culture (`6021`)
- element 2: culture per turn (`56`)
- element 3: player ID (`1`)

These match the screenshot's `Culture: 6021` and `Culture Per Turn: 56`.

## Tile Ownership And Rival Intelligence

SAV `TILE` records carry an owner byte in the first tile subrecord and an `exploredBy` mask in the fourth tile subrecord.

For the General tab, use only tiles known to the human player:

- `known land = count(tile.owner == playerID && (tile.exploredBy & humanPlayersMask) != 0)`
- `known population = sum(city.population)` only for cities whose city tile has `(exploredBy & humanPlayersMask) != 0`

This is why Rome and Korea are alive in the save but absent from the reference screenshot: both have zero land known to Japan.

For the reference save, the visible player order is the active `LEAD` player order filtered to `known land > 0`, excluding the human player for the Rival Info table:

- Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols

## Rival Row Sources

For visible rivals in the reference save:

- Traits come from embedded `RACE.bonuses`.
- Relation comes from the human player's live `LEAD` diplomacy vector.
- Government comes from `LEAD body +132`.
- Current Era comes from `LEAD body +216`.
- Gold is stored as two obfuscated/checksummed int32 values: `LEAD body +40` plus `LEAD body +44`.
- Cities comes from `LEAD body +376`.
- Land is known/explored land as described above.
- Population is known/explored city population as described above.

Japan's `Score: 760` appears in the untagged tail area between live city data and `TUTR`. For this save, find the active-player power vector from `LEAD body +12` values after `cityEnd`; the next active-player int32 vector is score, and the next vector is culture totals.

The parser is covered by `test/civAdvisorGeneral.test.js`, which asserts every visible General value from the Tokugawa 740 AD screenshot when the local save is present.

## Rule Matching For Links

The `.SAV` embedded BIQ rules are authoritative for Civ Advisor labels. Do not assume the currently loaded editor bundle is the same scenario as the selected save.

Civ Advisor reference links and thumbnails must be conditional. For the General tab, `src/biq/civAdvisor.js` emits section signatures for:

- `RACE`: civilization name, Civilopedia key
- `TECH`: technology name, Civilopedia key, era index
- `GOOD`: resource name, Civilopedia key
- `BLDG`: improvement name, Civilopedia key
- `GOVT`: name, Civilopedia key
- `ERAS`: name, Civilopedia key

The renderer compares these save-embedded signatures against the currently loaded bundle before turning a value into a link or loading a current-bundle thumbnail. If a section signature differs, display the save-native text without a link. The Tokugawa reference save matches `Scenarios/Instafluff_Scenario.biq` for `RACE`, `GOOD`, `GOVT`, and `ERAS`; `test/civAdvisorGeneral.test.js` covers this.

## Diplomacy

The Japan relation vector for visible rivals is present in Japan's live `LEAD` body. A byte vector at `LEAD body +3349` matches the screenshot if `0 = Peace` and `1 = War` for players 1 through 18, with Persia, Spain, and Aztecs marked as war.

This should be verified against another save before treating the offset as final.

## Recommended Next Implementation Step

Next Civ Advisor tabs should reuse `src/biq/civAdvisor.js` and add parser fields behind tests before exposing UI. Treat offsets validated only against this save, such as the diplomacy vector and score tail, as candidates for cross-save verification.

## Alerts Tab Notes

The Civ Advisor `Alerts` tab is intentionally non-obtrusive. It never foregrounds the app or activates the main window. Actual current alerts appear at the top of their relevant Civ Advisor tabs, and those tabs get alert-count badges. The `Alerts` tab itself is for enabling or disabling alert families.

The tab should start with actionable alerts. Date, turn, time-played, and Golden Age status belong on General, not in an Alerts status banner.

There are two different alert families:

- Current-save alerts can be computed from one `.SAV`: trade opportunities, expiring deals, production overrun, treasury deficit, city deficit, research overrun, visible pollution, visible riot risk, damaged units, and enemies willing to negotiate.
- Historical alerts require comparing at least two observations of the same game: city grew/shrank, specialists were reassigned, rival changed government, rival entered a new era, new tech/resource/contact appeared for sale, and disconnected-source warnings if they depend on newly observed map state.

The current implementation should keep historical items out of `current` unless the auto-update/save-history path has previous state to compare against. A future unobtrusive design is a small `History` subview inside Alerts that appears only after multiple saves have been loaded or auto-update has observed a new save. That view should group entries by game date, similar to CivAssist II's alert log, while keeping the per-tab current alert banners focused on actionable facts from the selected save.

Current alert rows may include `detailRows` for future expansion, but the primary UI is a compact banner at the top of each related tab. Trade details should still retain the specific civ and linked technologies/resources in the report, instead of only a summary such as "resources are for sale from 2 civs".

`Alert Settings` is an enable/disable list, not a roadmap table. It should show only active, current-save alert families. Planned CivAssist-style checks belong in this document until their required data is decoded and tested.

## Trade Tab Notes

The consolidated Civ Advisor Trade tab combines CivAssist II's `Current Trades` and `Trade Options` screens.

Useful `c3sat` references:

- `../c3sat/_lua_examples/available-trades-non-spoiling.lua` documents the non-spoiling tech trade algorithm.
- `../c3sat/luaciv3/lead.go` documents `LEAD` diplomacy arrays: `will_talk_to` at `+2964`, `at_war` at `+3348`, and `contact_with` at `+3732`.
- `../c3sat/queryciv3/query.go` has the corrected tech ownership mask offset: from the `GAME` length field, `852 + 4 * continentCount`. In this app's absolute offsets, that is `GAME offset + 4 + 852 + 4 * numConts`.

Current implemented Trade data:

- Treasury gold reuses the General-tab live gold parse.
- Current Trades lists non-war contacted rivals as Peace Treaty / Peace Treaty and also decodes timed resource deals from the saved treaty lists.
- Trade Options technology columns use the tech civ bitmask plus prerequisite checks, and render as conditional links when the selected save rules match the loaded scenario.
- Trade Options resource columns use each leader's resource availability table and resource-count array after the `LEAD` body, plus resource prerequisite tech checks.
- The Trade UI intentionally uses Current/Sell/Buy subtabs instead of stacking all CivAssist II trade tables. Multi-value cells such as technologies and resources should stack normal reference chips vertically so thumbnails stay visible without squeezing labels into one line.

## Trade Save Layout

Civ3's `do_save_game()` and `read_game_data_from_file()` call `move_game_data()` on the mapped save payload. C3X's `patch_MappedFile_create_file_to_save_game()` and `patch_move_game_data()` wrap that normal Civ3 flow to append/read C3X mod-save data after the vanilla data. The Civ Advisor parser should therefore treat the regular `.SAV` bytes as serialized Civ3 in-memory objects in `move_game_data()` order.

For C3C 24.10 saves, each live `LEAD` tag body in the Tokugawa fixture has length `5532`. The trade/resource data needed by CivAssist is not in the tagged body; it is in the untagged dynamic tail immediately after the body:

1. 32 treaty lists, one per possible player. Each list is `int32 count` followed by `count` offer records.
2. Each offer record is three int32 values: `kind`, `param1`, `param2`.
3. Dynamic arrays follow when `LEAD body +0x1198` is nonzero.
4. Skip improvement arrays: `BLDG count * 2 * 3`, then `BLDG count * 4`, then `BLDG count`.
5. Skip unit arrays: `PRTO count * 2 * 3`.
6. Skip spaceship part bytes: `RULE.numSSParts * 2`.
7. Read `GOOD count * 0x60` bytes of resource availability, arranged as `(resourceID * 32 + playerID) * 3`.
8. Read `GOOD count` bytes of resource surplus counts.
9. Skip continent arrays: `GAME.numConts * 4 * 5`.

For the Tokugawa fixture, Japan's dynamic tail parses cleanly to the `CULT` tag after those skips. Japan's available resource counts include Horses `1`, Iron `2`, Salt `1`, Gold `1`, and Stone `2`, matching the Trade Options screenshot.

Treaty-list group markers use offer kind `-1`. The marker's `param1` is the number of following offers in the group, and `param2` is the ending turn (`0` for indefinite). Useful offer kinds confirmed so far:

- `0` with `param1 = 0`: Peace Treaty.
- `5` or `6`: resource, with `param1` as the `GOOD` index.
- `8`: technology, with `param1` as the `TECH` index.
- `7`: gold/GPT-like payment; this still needs a second save before finalizing the exact `param1`/`param2` display.

The reference China deal is encoded in the Japan and China treaty lists:

- Japan list for China: `[-1, 2, 302]`, `[6, 2, 0]`, `[6, 21, 0]` means Salt and Gold until turn `302`.
- China list for Japan: `[-1, 1, 302]`, `[6, 14, 0]` means Silks until turn `302`.
- Current turn is `288`, so CivAssist's `Turns Left` is `14`.

The resource option columns use the leader resource table in the same way the decompiled `Leader::record_export`, `Leader::erase_export`, and export-check routines do. A resource is available to sell when the exporter can supply it, the importer has the prerequisite tech, and the importer does not already have that resource from any civ. For the human SELL column, CivAssist appears to allow selling the last local copy, which is why Japan can sell `Wines (0)`. For the BUY column, the UI appears to require AI surplus, which excludes last-copy resources such as Copper and matches the screenshot's Aztec `Incense (1), Gems (2)` and Mongol `Incense (5)`.

Known gaps:

- Gold per turn is currently fixture-matched for Tokugawa but should be decoded from deal/payment data.
- City-state tech filtering may need CivAssist-specific exclusions beyond the basic prerequisite/era check.

## Diplomacy Tab Notes

The Civ Advisor `Diplomacy` tab uses the same live `LEAD` diplomacy vectors as the Trade tab:

- `LEAD + 2964`: `will_talk_to[32]`
- `LEAD + 3348`: `at_war[32]`
- `LEAD + 3732`: `contact_with[32]`

The first implementation intentionally limits itself to verified save facts:

- known/contacted visible rivals;
- Peace/War relation;
- Will Talk;
- saved culture-total comparison labels;
- active timed deal counts from the same treaty-list tails used by Trade;
- current buy/sell opportunity counts;
- government, era, and gold context.

The CivAssist II screenshot also shows Embassy, Spy, Ally, ROP, and MPP columns. Those live `.SAV` offsets are not yet verified in this codebase, so the app should not display guessed values. Keep them as planned Diplomacy coverage until another offset audit confirms them against real saves.

## Techs Tab Notes

The Civ Advisor `Techs` tab consolidates CivAssist II's Technology screen into a compact research-status panel and a scrollable technology table. Save-native `TECH`, `RACE`, and `ERAS` references use the same whole-section signature gate as General and Trade, so thumbnails and editor navigation are only enabled when the loaded BIQ matches the save's embedded rules.

Live research state for the human player comes from the `LEAD` body:

- `+216`: current era index.
- `+220`: gathered research beakers (`1614`).
- `+224`: current research `TECH` index (`29`, Education).
- `+228`: turns already spent researching (`25`).
- `+396`: science slider step (`3`, displayed as `30%`).

Technology ownership uses the `GAME` technology-civilization masks documented above. For the fixture, Japan owns 25 visible-era technologies. The `Known To` list intentionally includes only visible rivals, matching CivAssist's `(9) Greece, ...` display rather than exposing unmet civilizations. The UI renders those visible-rival names as compact non-link pills instead of full civilization reference chips so dense technology rows remain scannable; users can filter the technology table with the local Techs search box.

Estimated cost matches every visible CivAssist row in the fixture. The calculation uses:

1. `TECH.cost` from the embedded rules.
2. The number of remaining players from `GAME.remainingPlayersMask`, converted to the Civ3 known-civ denominator with `floor(count * 7 / 4)`.
3. A discount count for active contacted civilizations that know the tech, including the human player for already-known technologies.
4. `WSIZ.techRate` for the save's world size.
5. `DIFF.costFactor`, capped at 10.
6. The Accelerated Production rule when enabled.

For Education in the reference save, that produces `1815`. The current implementation's beakers-per-turn projection is `22`, based on the human cities' saved commerce, the 30% science rate, and the difficulty cost factor. With `1614` gathered, the UI therefore shows `201` remaining over `10` turns and `19` end wastage (`9% of 201`).

This projection is now suspect for game-parity display. The in-game Domestic Advisor for the same save shows `38` science and Education in `6` turns, matching the saved city science fields (`19 + 19`). C3X districts can contribute to those saved city fields, so the current-value Techs panel should prefer saved city science output; any commerce/slider-derived value should be labeled as a projection.

The optional marker is `TECH.flags & 0x20000` (`Not Required for Era Advancement`). `Optionals Skipped` lists optional technologies from completed eras that the human player does not know; it is empty for the Tokugawa fixture.

## Culture And City Building Records

Each live city has a `BINF` block containing one 12-byte record per embedded `BLDG` entry:

- build year (`int32`)
- original owner/player ID (`int32`, `-1` when absent)
- accumulated culture from that improvement (`int32`)

The fourth live `CITY` subrecord begins with culture per turn followed by a 32-player city-culture vector. The value at the city's owner index is the city's accumulated culture. For Kyoto this is `3811`, and its `BINF` rows reproduce CivAssist's build dates and culture totals for Palace, Temple, Library, Cathedral, Colosseum, Great Library, and Great Wall.

Culture improvement links use a `BLDG` signature and remain disabled when the loaded editor scenario does not match the save's embedded rules.

The CivAssist II `Miscellaneous` tab is not being copied as a single top-level Civ Advisor tab. Its Wonders list belongs with Culture because it reuses the same embedded `BLDG` records and live city `BINF` status checks:

- `Culture -> Wonders` lists great and small wonders with the same conditional `BLDG` links as city improvements.
- Wonder status comes from the same per-city availability pass used by `Culture -> City Improvements`.
- The initial `Top Available Locations` estimate is derived from the per-city "Available, N turns needed" status. This matches the current Culture-table production model but does not fully match CivAssist II's Miscellaneous screenshot yet (`The Pyramids` shows `Osaka [30]` there while this first pass derives `Osaka [17]`). Treat that column as useful but still under investigation.

The remaining Miscellaneous groups should be split by subject rather than exposed as a random tab:

- Palace Jump belongs under `Cities` once the exact `Rank` and `Required` formulas are traced.
- Resource Locator belongs under `Trade` once the strategic/luxury selector and `(n) m` cell semantics are confirmed.

## Economy Tab Notes

CivAssist II's Economy screen is partly a hypothetical building simulator. Civ Advisor intentionally shows the saved Domestic Advisor economy and omits the checkbox simulator for now.

The saved `CITY` economy fields map to Civ3's `City_Body` as follows:

- `ProductionLoss`, `Corruption`, `ProductionIncome`, `CashIncome`
- `Luxury`, `Science`, `AddCash`
- `Improvements_Maintenance`

National city income is `sum(CashIncome + Corruption)`. Expenses subtract science, luxury/entertainment, corruption, building maintenance, unit support, and outgoing GPT. Incoming GPT and treasury interest are income.

For Tokugawa 740 AD the saved-state totals are:

- city income `132`
- science `38`
- corruption `6`
- maintenance `23`
- unit costs `62`
- net gain `+3`

The unit-support calculation should use live `UNIT` records for paid units, not the `LEAD` aggregate alone. In the Tokugawa save, Japan owns 38 units: 37 native Japanese units plus one captured German worker. Republic grants three free units for each size-12 city, and the captured worker is maintenance-free. Thus `(37 paid native units - 6 government support) * 2 GPT = 62 GPT`, matching the in-game Domestic Advisor.

`LEAD body +392`, `+396`, and `+400` are the luxury, science, and tax slider steps. `+136` is mobilization level, and `+32` is the Golden Age ending turn. The Economy city table intentionally omits per-building status columns; building-status details belong in Culture/Wonders or a future focused workflow, not in the saved-state economy summary. Forbidden Palace and Secret Police HQ status comes from each city's `BINF` records and links through the conditional `BLDG` signature gate.

## Culture Tab Notes

The Culture tab is city-scoped. The city selector lists the human player's live cities and defaults to the saved capital. Its headline values come directly from the serialized city body:

- The fourth live-city `CITY` subrecord starts with `culturePerTurn`, followed by 32 per-player accumulated-culture int32 values. The selected city's owner slot is its displayed culture total.
- Kyoto therefore decodes to `3811` culture and `28` culture per turn; Osaka decodes to `2194` and `28`. The live human `CULT` block remains authoritative for the civilization total (`6021`) and per-turn value (`56`).

Each city's `BINF` block contains `BLDG count` triplets, in embedded-BIQ building order:

1. build year (signed int32; negative is BC),
2. original owner/player ID (signed int32; `-1` means absent),
3. culture accumulated by that improvement (signed int32).

For Kyoto, those triplets reproduce the CivAssist rows exactly: Palace `4000 BC / 552`, Temple `1675 BC / 842`, Library `180 AD / 309`, Cathedral `455 AD / 171`, Colosseum `350 AD / 156`, Great Library `20 BC / 738`, and Great Wall `430 AD / 124`. A built improvement receives the `2x` culture bonus when its saved build year is more than 1000 years before the current game date, matching Civ3's `Buildings_Info::get_age_in_years()` and `Culture::get_culture_produced_by()` logic.

Non-built rows combine the embedded `BLDG` rule with live city/player state:

- displayed shield cost is `BLDG.cost * 10`;
- Shields/Culture is that cost divided by `BLDG.culture`;
- required and obsolete technology IDs are checked against the saved technology-civilization masks;
- required-improvement counts are checked against the human cities' `BINF` records;
- Great Wonder locations are found by scanning every live city's `BINF` records;
- links and thumbnails are gated by the full `BLDG` signature, just like the other Civ Advisor references.

The first implementation uses a straight-line culture-victory date from the current saved culture-per-turn value. CivAssist's screenshot dates (`2054 AD` for Kyoto and `2788 AD` for Japan) include a forecast of future 1000-year building bonuses; that exact forecasting algorithm remains to be recovered. Keep this distinction explicit until it is fixture-matched rather than silently hard-coding the screenshot dates.

## Territory Tab Notes

The Territory tab scans the live `TILE` stream from the inflated SAV rather than relying on BIQ map records. The relevant saved tile fields are:

- first `TILE` body `+1`: territory owner/player ID;
- second `TILE` body `+0`: Conquests overlay bitfield (`0x01 = road`, `0x02 = railroad`, `0x04 = mine`, `0x08 = irrigation`);
- second `TILE` body `+5`: packed base terrain byte; use the low nibble as the terrain id;
- fourth `TILE` body `+0`: explored-by bitmask;
- fourth `TILE` body `+20`: city id whose workers are assigned to the tile, or negative for unworked.

For Tokugawa 740 AD this reproduces CivAssist's directly decoded rows:

- exploration: `5000` world tiles, `1461` explored, split into `539` land and `922` water;
- domination tiles: `185`, because CivAssist counts owned land plus coast and excludes sea/ocean;
- workable owned land: `154`, which is the `26 worked + 128 unworked` basis for the lower improvement table;
- improvement stats: Roaded `26 / 81`, Irrigated `14 / 8`, Mined `10 / 12`, Unroaded `0 / 47`, Unrailed `26 / 80`, Jungle or Marsh `0 / 0`.

C3X district persistence is appended after the normal save data using the `0x22 'C' '3' 'X'` bookends from `injected_code.c`. The `district_tile_map` chunk is segment-relative aligned text followed by:

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

After `inflateSavIfNeeded()`, read the segment size from the last eight bytes, start at `buffer.length - segment_size - 8`, then align chunk payloads relative to that segment, not the absolute file offset. The Tokugawa fixture contains `90` district instances, `40` of them on Japan-owned workable land. C3X implements district completion through the tile mine overlay, so Civ Advisor excludes saved district coordinates from the `Mined` improvement total rather than treating districts as ordinary mined tiles.

Still unresolved for 1:1 CivAssist Territory parity:

- `Domination Limit`, `Tiles To Limit`, and visible `Unclaimed Tiles`;
- CivAssist's Forested/Fully Improved/Partially Improved/Unimproved classifications;
- exact city-row worked/mined/irrigated semantics where CivAssist appears to use more than the raw `cityWithWorkers` assignment.

## Cities Tab Notes

The first Cities implementation intentionally lists only the human player's live cities and does not reproduce CivAssist's unexplained row colors. It uses neutral Editor table styling and the shared sortable-header behavior.

Citizen morale comes from each city's `POPD` list of 300-byte `CTZN` records:

- `CTZN body +264`: mood (`0 = happy`, `1 = content`, `2 = unhappy` for the reference save).
- `CTZN body +288`: citizen nationality/race index, used to count foreign citizens.

For Kyoto, 10 of 12 citizens are happy and one is unhappy, producing `83%`, `8%`, and `+9`. Osaka has 12 happy citizens, producing `100%` and `+12`.

Other fixture-matched columns:

- Corruption is the saved corrupted-commerce value as a percentage of saved city commerce (`Osaka: 6 / 49 = 12%`).
- Waste is the saved production-loss value as a percentage of gross production (`Osaka: 2 / (21 + 2) = 8%`).
- Entertainer, taxman, and scientist counts come from the fifth live-city `CITY` subrecord.
- Garrison counts human-owned live `UNIT` records on the city coordinates (`Kyoto: 18`, `Osaka: 3`).
- Distance is staggered-grid/hex distance from the saved capital plus one (`Kyoto: 1`, `Osaka: 9`).
- Flip Risk is `-` for the player's own cities in this first pass.

Resistor, police specialist, engineer specialist, and city-rank semantics still need a fixture that contains nonzero examples before their raw fields can be finalized. They remain blank (rank remains the reference value `1`) rather than guessing from unrelated fields.

## Production Tab Notes

The Production tab uses the live city body's saved construction and shield fields rather than CivAssist's separate Economy what-if model:

- `constructingType = 1` identifies a `BLDG` improvement; its displayed cost is `BLDG.cost * 10` shields.
- `constructingType = 2` identifies a `PRTO` unit; `PRTO.shieldCost` is already stored in shields and must not be multiplied by the game's production factor.
- `shieldsCollected` is current progress, `ProductionIncome` is actual shields per turn after waste, and `ProductionLoss` is saved waste.
- turns are `ceil((cost - collected) / ProductionIncome)` and projected overflow is `(turns * ProductionIncome) - (cost - collected)`.

For Tokugawa 740 AD this yields Kyoto building Samurai at `40 / 70`, `20` shields per turn, two turns, and `10` projected overflow; Osaka builds Galley at `19 / 30`, `19` shields per turn, one turn, and `8` projected overflow. CivAssist shows `22` and `13` shields per turn because its Production table reflects the Economy tab's hypothetical building simulation. Civ Advisor intentionally presents the serialized save state.

Production targets use `PRTO` or `BLDG` signatures, so thumbnails and links are enabled only when the save's embedded rule section matches the scenario currently loaded in the Editor. The UI should stay table-first for CivAssist-style scanning, with the producing item rendered as the normal Editor reference chip so matching units and improvements show thumbnails and navigate back to their tabs.

## Military Tab Notes

The Military tab separates aggregate force composition from individual-unit condition. The Roster subtab groups the human player's live `UNIT` records by `UnitTypeID`; the Units subtab exposes each record's experience, health, remaining movement, position, and nationality.

Useful live `UNIT` body offsets are:

- `+20`: owning player ID
- `+24`: nationality/race ID
- `+32`: `PRTO` unit-type index
- `+36`: `EXPR` experience-level index
- `+44`: damage
- `+48`: movement already consumed, stored in thirds of a movement point

Maximum health is `EXPR.baseHitPoints + PRTO.hitPointBonus`; current health subtracts saved damage. Maximum movement is `PRTO.movement * 3` internal thirds. Civ Advisor converts current and maximum movement back to user-facing movement points, so a fresh Samurai is shown as `2/2` rather than CivAssist's internal `6/6`.

Upgrade resolution must account for civilization-specific units. Starting at `PRTO.upgradeTo`, follow the chain until the first target whose `availableTo` mask contains the player's race. This maps Archer to Longbowman, Swordsman to Medieval Infantry, Pikeman to Musketman, and Galley to Caravel for Japan while skipping unavailable unique units. Upgrade price is the positive shield-cost difference multiplied by `RULE.upgradeCost` (`3` in the fixture).

The Tokugawa fixture contains 38 units: 32 combat units, 6 civilians, 2 naval units, one foreign-national Worker, no damaged units, and one unit with no movement remaining. Unit and upgrade links use the exact raw 157-record `PRTO` signature from the loaded BIQ; the Units tab's synthetic era variants must not be used for this comparison.

## Alerts Tab Notes

The Alerts tab should be non-obtrusive by default. It is derived when a user opens Civ Advisor or enables the existing "follow latest save while open" mode; it should not foreground the app, make the window topmost, or notify users who never use Civ Advisor. Future desktop notification behavior should be opt-in and should have alert history/dismissal semantics first.

The implementation separates passive save status from current alerts:

- passive status: current game date, turn number, time played, and Golden Age state;
- current alerts: sorted by severity (`critical`, `warning`, `opportunity`, `info`) and shown at the top of the related tab;
- alert settings: implemented alert families only, toggleable, so future work does not confuse deferred alerts with forgotten ones.

Fixture-backed Tokugawa 740 AD current alerts are:

- Osaka production overrun warning: Galley wastes 8 shields in 1 turn.
- Buy-resource opportunity: Aztecs can sell Incense/Gems and Mongols can sell Incense.
- Sell-technology opportunity: Japan can sell technology to 9 civs.
- Sell-resource opportunity: Japan can sell resources to 6 civs.
- Diplomacy opportunity: Persia, Spain, and Aztecs are willing to negotiate.
- Kyoto production overrun info: Samurai wastes 10 shields in 2 turns.
- Rival-cash info: Persia has 84 gold.

Implemented alert coverage is current-save only: trade opportunities/expiring deals/cash, enemies willing to negotiate, production projections, saved-state economy, current research progress, city morale/pollution, and unit damage. Alerts that require comparing successive saves remain documented but hidden from the UI, notably rival government/era changes, city growth/shrink/specialist reassignment, and "new" trade opportunities. "Foreign units in our territory" remains deferred because it requires territory ownership lookup; foreign unit nationality alone is not equivalent.
