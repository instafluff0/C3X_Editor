# CivAssist General Tab Notes

These notes capture the first pass at recreating CivAssist II's General tab from a `.SAV`.

Reference files used:

- Save: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 740 AD.SAV`
- CivAssist reference screenshot: General tab for `Tokugawa of the Japanese, 740 AD`
- Decompiled CivAssist file: `/Users/nicdobbins/fun/Civilization III Complete/Conquests/CivAssist II/CivAssist.exe.c`

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

## Diplomacy

The Japan relation vector for visible rivals is present in Japan's live `LEAD` body. A byte vector at `LEAD body +3349` matches the screenshot if `0 = Peace` and `1 = War` for players 1 through 18, with Persia, Spain, and Aztecs marked as war.

This should be verified against another save before treating the offset as final.

## Recommended Next Implementation Step

Next CivAssist tabs should reuse `src/biq/civAssist.js` and add parser fields behind tests before exposing UI. Treat offsets validated only against this save, such as the diplomacy vector and score tail, as candidates for cross-save verification.
