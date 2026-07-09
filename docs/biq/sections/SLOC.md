# SLOC Section

## Source
- Class path: ../Quint_Editor/Shared/Civ3_Shared_Components/src/main/java/com/civfanatics/civ3/biqFile/SLOC.java
- Base type: BIQSection

## Implementation Notes
- 12:    private int dataLength = 16;

## Cross-Section Mentions
- No explicit Other sections comment found in class header.

## Declared Fields (from source)
- 12:    private int dataLength = 16;
- 13:    private int ownerType;
- 14:    private int owner;
- 15:    private int x;
- 16:    private int y;

## Constants / Flags
- No section-specific public constants found.

## Unknown / Reverse-Engineering Markers
- No explicit questionMark/unknown markers detected by scan.

## Notes for C3XConfigManager Docs
- Use this class as authoritative for binary field names, flag packing, and unresolved unknowns.
- When documenting a field in app UI, verify both declaration semantics in this class and read/write behavior in IO.java.

## Quint Behavior Notes
- Starting positions are dual-represented: `TILE.C3CBonuses & TILE.PLAYER_START_MASK` marks the tile as a start, while `SLOC` stores optional owner metadata for that coordinate.
- Quint creates or updates a `SLOC` when the map editor assigns a starting location, sets the matching tile start flag, and removes both the `SLOC` and tile flag when the start is cleared.
- A tile start flag without `SLOC` is still a valid unassigned/random start in Conquests scenarios. Treat it as a warning/coherence note, not a save-blocking error.
- Do not mix orphan tile-only starts into a fixed playable-civ scenario where every active player already has a preplaced city and there are no `SLOC` records. Stock city-start scenarios such as Middle Ages use civ-owned cities and no `SLOC`/TILE starts; save should clear those orphan start flags in this shape.
- A `SLOC` without the matching tile start flag should be repaired on save by setting the tile flag. Do not synthesize new `SLOC` records from tile flags in normal Conquests saves.
