# TILE Section

## Source
- Class path: ../Quint_Editor/Shared/Civ3_Shared_Components/src/main/java/com/civfanatics/civ3/biqFile/TILE.java
- Base type: BIQSection

## Implementation Notes
- 18:    public int dataLength = 45;

## Cross-Section Mentions
- No explicit Other sections comment found in class header.

## Declared Fields (from source)
- 18:    public int dataLength = 45;
- 22:    public final static int ROAD_MASK = 0x00000001;
- 23:    public final static int RAILROAD_MASK = 0x00000002;
- 24:    public final static int MINE_MASK = 0x00000004;
- 25:    public final static int IRRIGATION_MASK = 0x00000008;
- 26:    public final static int FORT_MASK = 0x00000010;
- 27:    public final static int GOODY_HUT_MASK = 0x00000020;
- 28:    public final static int POLLUTION_MASK = 0x00000040;
- 29:    public final static int BARBARIAN_CAMP_MASK = 0x00000080;
- 30:    public final static int CRATER_MASK = 0x00000100;
- 31:    public final static int BARRICADE_MASK = 0x10000000;
- 32:    public final static int AIRFIELD_MASK = 0x20000000;
- 33:    public final static int RADAR_TOWER_MASK = 0x40000000;
- 34:    public final static int OUTPOST_MASK = 0x80000000;
- 36:    public final static int RUINS_PRESENT = 1;
- 37:    public final static int RUINS_NOT_PRESENT = 0;
- 38:    public final static short VICTORY_POINT_LOCATION_PRESENT = 0;
- 39:    public final static short VICTORY_POINT_LOCATION_NOT_PRESENT = -1;
- 40:    public final static int PLAYER_START_MASK = 0x00000008;
- 42:    public final static byte RIVER_NORTHEAST = 2;
- 43:    public final static byte RIVER_SOUTHEAST = 8;
- 44:    public final static byte RIVER_SOUTHWEST = 32;
- 47:    public final static byte XTGC = 0;
- 48:    public final static byte XPGC = 1;
- 49:    public final static byte XDGC = 2;
- 50:    public final static byte XDPC = 3;
- 51:    public final static byte XDGP = 4;
- 52:    public final static byte XGGC = 5;
- 53:    public final static byte WCSO = 6;
- 54:    public final static byte WSSS = 7;
- 55:    public final static byte WOOO = 8;
- 62:    private GOOD resource;
- 63:    public int resourceInt = -1;
- 115:    public int ruin;
- 120:    private byte C3CRealBaseTerrain;
- 124:    private byte c3cBaseTerrain;
- 127:    public int C3CBonuses;
- 133:    public static final byte PINE_FOREST = 32;
- 134:    public static final byte SNOW_CAPPED_MOUNTAIN = 16;
- 135:    public static final byte BONUS_GRASSLAND = 1;
- 161:    public int owner;
- 162:    public int ownerType;
- 164:    public int borderColor;
- 165:    public int tileID;
- 166:    public int xPos;
- 167:    public int yPos;
- 170:    public int unitWithBestDefence = -1;
- 1130:    public final static int DISTRICT_STATE_COMPLETED = 2;
- 1131:    public final static int WDS_COMPLETED = 2;
- 1134:    private DistrictData districtData;
- 1140:        public int districtId = -1;
- 1141:        public int districtType = -1;
- 1142:        public int state = 0;
- 1143:        public WonderDistrictInfo wonderInfo;
- 1144:        public int naturalWonderId = -1;
- 1151:        public int wonderId = -1;
- 1152:        public int wonderIndex = -1;
- 1153:        public int cityId = -1;
- 1154:        public int state = 0;

## Constants / Flags
- 22:    public final static int ROAD_MASK = 0x00000001;
- 23:    public final static int RAILROAD_MASK = 0x00000002;
- 24:    public final static int MINE_MASK = 0x00000004;
- 25:    public final static int IRRIGATION_MASK = 0x00000008;
- 26:    public final static int FORT_MASK = 0x00000010;
- 27:    public final static int GOODY_HUT_MASK = 0x00000020;
- 28:    public final static int POLLUTION_MASK = 0x00000040;
- 29:    public final static int BARBARIAN_CAMP_MASK = 0x00000080;
- 30:    public final static int CRATER_MASK = 0x00000100;
- 31:    public final static int BARRICADE_MASK = 0x10000000;
- 32:    public final static int AIRFIELD_MASK = 0x20000000;
- 33:    public final static int RADAR_TOWER_MASK = 0x40000000;
- 34:    public final static int OUTPOST_MASK = 0x80000000;
- 36:    public final static int RUINS_PRESENT = 1;
- 37:    public final static int RUINS_NOT_PRESENT = 0;
- 38:    public final static short VICTORY_POINT_LOCATION_PRESENT = 0;
- 39:    public final static short VICTORY_POINT_LOCATION_NOT_PRESENT = -1;
- 40:    public final static int PLAYER_START_MASK = 0x00000008;
- 42:    public final static byte RIVER_NORTHEAST = 2;
- 43:    public final static byte RIVER_SOUTHEAST = 8;
- 44:    public final static byte RIVER_SOUTHWEST = 32;
- 45:    public final static byte RIVER_NORTHWEST = (byte)128;
- 47:    public final static byte XTGC = 0;
- 48:    public final static byte XPGC = 1;
- 49:    public final static byte XDGC = 2;

## Unknown / Reverse-Engineering Markers
- 92:     * Decoding guesses: questionMark3 = landmark tile (could also be ?2)
- 93:     * questionMark = two bytes for image/file for overlay (ex. forest, hill, etc.)
- 98:    short questionMark;
- 108:    //TODO: It appears that the "city" and "colony" tags in the BIQ documentation
- 113:    byte questionMark2 = 6; //Unknown.  Crashes Civ if it's zero.  Firaxis's editor seems to default in 6 for new tiles.  However, it IS zero in Gamelord's Euro.bic file.
- 117:    byte questionMark3;
- 125:    short questionMark4;
- 157:    short questionMark5;
- 240:        return questionMark;
- 285:        return questionMark2;
- 305:        return questionMark3;
- 315:        return questionMark4;
- 330:        return questionMark5;
- 408:    public void setQuestionMark(short questionMark)
- 410:        this.questionMark = questionMark;

## Notes for C3XConfigManager Docs
- Use this class as authoritative for binary field names, flag packing, and unresolved unknowns.
- When documenting a field in app UI, verify both declaration semantics in this class and read/write behavior in IO.java.

## Starting Location Notes
- `PLAYER_START_MASK` (`0x00000008`) is stored in `C3CBonuses`, not the older bonus mask. It marks the tile itself as a player starting position.
- `SLOC` records are optional owner metadata for start tiles. Editor add/remove flows should keep `SLOC` and this tile flag in sync, while save-time repair should only add missing tile flags for existing `SLOC` records.
