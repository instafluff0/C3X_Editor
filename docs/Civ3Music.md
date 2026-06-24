# Civ3 Music Notes

## Source Basis

These notes summarize observed shipped Civ3 Complete scenario files, the CivFanatics music-editing explanation kept with the project notes, and the Conquests 1.22 music loader in `Civ3Conquests_master.exe.c`. Treat this as practical editor guidance, not a complete reverse-engineered audio engine spec.

## Stock Music Shape

Civ3 music is stored under `Sounds/Build`. A fully culture-specific setup can cover:

- Ancient, Middle, and Industrial eras by culture group: American, European, Roman, Mideast, Asian.
- Modern era as non-culture-specific tracks shared across cultures.

That full layout is a capability, not a requirement. A complete culture-specific set is roughly 15 era/culture slots for the first three eras plus modern shared tracks. Modders commonly use fewer tracks, such as one song per era, a short mood playlist, or a single broad scenario playlist.

The tutorial describes the stock-era naming patterns:

- Ancient culture groups use `AncNA`, `AncEC`, `AncGR`, `AncME`, and `AncOR` naming. Ancient has extra WAV progression behavior in the full game data, then a full MP3.
- Middle Ages full tracks use names like `MidNAFull`, `MidECFull`, `MidGRFull`, `MidMEFull`, and `MidORFull`.
- Industrial tracks use `IndNAFull`, `IndECFull`, `IndGRFull`, `IndMEFull`, and `IndORFull`.
- Modern tracks are shared rather than culture-specific, with names such as `SmashFull`, `StarsFull`, and `Techno MixFull`.

Local installs may not contain every named stock file. This repo's current Civ3 Complete tree has no global `Conquests/Text/music.txt`; the editor therefore infers a stock-library view from available MP3s under `Sounds/Build`. Filenames that explicitly encode an era/culture pattern belong in the era/culture matrix. Other available MP3s should remain playable as generic playlist entries inside the same matrix rather than being forced into fake Middle or Industrial cells. Inferred empty cells must not be presented as explicit "no music" decisions.

## Scenario `Text/music.txt`

Scenario `Text/music.txt` files are flat playlist files, one relative music path per line. The Conquests loader resolves `Text/music.txt`, prepends `Sounds\Build\` to each non-empty line, and adds each result to the music sound object. It does not read era/culture metadata from the file, so scenario playlists are not guaranteed to be a complete 18-slot era/culture matrix.

Observed shipped examples:

- `Conquests/Fall of Rome/Text/music.txt` has 6 entries.
- `Conquests/Rise of Rome/Text/music.txt` has 4 entries.
- `Conquests/WWII in the Pacific/Text/music.txt` has 5 entries.
- `Scenarios/Tides of Crimson/Text/music.txt` has 40 entries.
- `Scenarios/Star Wars TMA/Text/Music.txt` is a long scenario-specific playlist.

This means sparse rows and empty cells in the editor are often intentional. They should read as unassigned or inherited/stock behavior, not as validation failures.

## Editor UX Implications

- The Music tab can organize entries by era and culture because that matches Civ3 modders' mental model, but it should not imply every cell is mandatory.
- Empty inferred stock cells should stay visually quiet and should not claim a specific default track.
- Empty explicit playlist cells should use quiet wording such as `No assigned song`.
- Ambiguous MP3s should be playable in a matrix-integrated `Playlist` row rather than inferred into era/culture cells or shown in a separate side section.
- Missing warnings should be reserved for explicit playlist entries that point to files the editor cannot resolve.
- Scenario saves that modify music should become scenario-local: write scenario `Text/music.txt` and copy required MP3s under scenario `Sounds/Build`.
- Drag/drop MP3 import should preserve the scenario-local write model and never silently edit base game assets in Scenario mode.

## Compatibility Notes

- MP3s are the supported music import format for this editor.
- Pending imports should be checked for Civ3-safe metadata, but existing shipped scenarios should not be flagged unless an explicit referenced file is unresolved.
- The CivFanatics note reports that low-bitrate MP3s may play too fast in-game; editor QA should keep this as a pending-import compatibility warning rather than a hard error for existing content.
