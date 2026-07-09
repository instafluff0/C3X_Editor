# CivAssist General Tab Notes

These notes capture the first pass at recreating CivAssist II's General tab from a `.SAV`.

Reference files used:

- Save: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 740 AD.SAV`
- CivAssist reference screenshot: General tab for `Tokugawa of the Japanese, 740 AD`
- Decompiled CivAssist file: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/CivAssist II/CivAssist.exe.c`
- Decompiled Civ3 source: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/C3X_Districts/ref/Civ3Conquests_master.exe.c`
- C3X patched source: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/C3X_Districts/injected_code.c`

The decompiled CivAssist file currently looks like a low-level PE/.NET metadata dump, not useful C# method logic. Treat it as a fallback; direct SAV section evidence is more productive.

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

The parser is covered by `test/civAssistGeneral.test.js`, which asserts every visible General value from the Tokugawa 740 AD screenshot when the local save is present.

## Rule Matching For Links

The `.SAV` embedded BIQ rules are authoritative for Civ Advisor labels. Do not assume the currently loaded editor bundle is the same scenario as the selected save.

Civ Advisor reference links and thumbnails must be conditional. For the General tab, `src/biq/civAssist.js` emits section signatures for:

- `RACE`: civilization name, Civilopedia key
- `GOOD`: resource name, Civilopedia key
- `GOVT`: name, Civilopedia key
- `ERAS`: name, Civilopedia key

The renderer compares these save-embedded signatures against the currently loaded bundle before turning a value into a link or loading a current-bundle thumbnail. If a section signature differs, display the save-native text without a link. The Tokugawa reference save matches `Scenarios/Instafluff_Scenario.biq` for `RACE`, `GOOD`, `GOVT`, and `ERAS`; `test/civAssistGeneral.test.js` covers this.

## Diplomacy

The Japan relation vector for visible rivals is present in Japan's live `LEAD` body. A byte vector at `LEAD body +3349` matches the screenshot if `0 = Peace` and `1 = War` for players 1 through 18, with Persia, Spain, and Aztecs marked as war.

This should be verified against another save before treating the offset as final.

## Recommended Next Implementation Step

Next CivAssist tabs should reuse `src/biq/civAssist.js` and add parser fields behind tests before exposing UI. Treat offsets validated only against this save, such as the diplomacy vector and score tail, as candidates for cross-save verification.

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
