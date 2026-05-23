const test = require('node:test');
const assert = require('node:assert/strict');
const mapCore = require('../src/mapEditorCore');

function makeTile(index, width) {
  const half = Math.floor(width / 2);
  const row = Math.floor(index / half);
  const x = ((index % half) * 2) + ((row & 1) === 1 ? 1 : 0);
  const y = row;
  const terrain = packTerrain(2);
  return {
    index,
    fields: [
      { key: 'xpos', baseKey: 'xpos', value: String(x), originalValue: String(x) },
      { key: 'ypos', baseKey: 'ypos', value: String(y), originalValue: String(y) },
      { key: 'baserealterrain', baseKey: 'baserealterrain', value: terrain, originalValue: terrain },
      { key: 'c3cbaserealterrain', baseKey: 'c3cbaserealterrain', value: terrain, originalValue: terrain },
      { key: 'city', baseKey: 'city', value: '-1', originalValue: '-1' },
      { key: 'unit_on_tile', baseKey: 'unit_on_tile', value: '', originalValue: '' }
    ]
  };
}

function packTerrain(code) {
  return String(((code & 0x0f) << 4) | (code & 0x0f));
}

test('computeBrushTileIndexes expands with diameter', () => {
  const width = 10;
  const tileCount = 100;
  const center = 27;
  const one = mapCore.computeBrushTileIndexes(width, tileCount, center, 1);
  const three = mapCore.computeBrushTileIndexes(width, tileCount, center, 3);
  const five = mapCore.computeBrushTileIndexes(width, tileCount, center, 5);
  assert.equal(one.length, 1);
  assert.equal(three.length, 9);
  assert.equal(five.length, 25);
  assert.ok(one.includes(center));
});

test('computeBrushTileIndexes keeps 3x3 paint brushes centered on Civ3 logical tiles', () => {
  const width = 8;
  const tileCount = Math.floor((width * 8) / 2);
  const center = 10;
  const brush = mapCore.computeBrushTileIndexes(width, tileCount, center, 3);
  assert.deepEqual(brush, [2, 5, 6, 9, 10, 11, 13, 14, 18]);
});

test('applyTerrain writes baserealterrain and c3cbaserealterrain', () => {
  const tiles = [makeTile(0, 4), makeTile(1, 4), makeTile(2, 4)];
  const untouched = packTerrain(2);
  mapCore.applyTerrain(tiles, [0, 2], 7);
  assert.equal(mapCore.getField(tiles[0], 'baserealterrain').value, packTerrain(7));
  assert.equal(mapCore.getField(tiles[0], 'c3cbaserealterrain').value, packTerrain(7));
  assert.equal(mapCore.getField(tiles[2], 'baserealterrain').value, packTerrain(7));
  assert.equal(mapCore.getField(tiles[1], 'baserealterrain').value, untouched);
});

test('collectTundraTransitionNeighborFixups forces tundra-adjacent plains and desert to grassland', () => {
  const BIQ_TERRAIN = {
    DESERT: 0,
    PLAINS: 1,
    GRASSLAND: 2,
    TUNDRA: 3,
    COAST: 11,
    SEA: 12,
    OCEAN: 13
  };
  const terrainByIndex = [
    BIQ_TERRAIN.TUNDRA,
    BIQ_TERRAIN.PLAINS,
    BIQ_TERRAIN.DESERT,
    BIQ_TERRAIN.GRASSLAND,
    BIQ_TERRAIN.COAST,
    BIQ_TERRAIN.PLAINS
  ];
  const neighborsByIndex = [
    [1, 2, 3, 4],
    [0],
    [0],
    [0],
    [0],
    []
  ];
  const fixups = mapCore.collectTundraTransitionNeighborFixups(
    [0],
    (idx) => terrainByIndex[idx],
    (idx) => neighborsByIndex[idx] || [],
    BIQ_TERRAIN
  );
  assert.deepEqual(fixups, [
    { index: 1, terrainCode: BIQ_TERRAIN.GRASSLAND },
    { index: 2, terrainCode: BIQ_TERRAIN.GRASSLAND }
  ]);
});

test('collectGrasslandPlainsDesertCoastFixups promotes grassland edges to plains for invalid quartets', () => {
  const BIQ_TERRAIN = {
    DESERT: 0,
    PLAINS: 1,
    GRASSLAND: 2,
    COAST: 11
  };
  const fixups = mapCore.collectGrasslandPlainsDesertCoastFixups([
    [
      { index: 10, terrainCode: BIQ_TERRAIN.DESERT },
      { index: 11, terrainCode: BIQ_TERRAIN.PLAINS },
      { index: 12, terrainCode: BIQ_TERRAIN.GRASSLAND },
      { index: -1, terrainCode: BIQ_TERRAIN.COAST }
    ],
    [
      { index: 20, terrainCode: BIQ_TERRAIN.DESERT },
      { index: 21, terrainCode: BIQ_TERRAIN.GRASSLAND },
      { index: 22, terrainCode: BIQ_TERRAIN.COAST },
      { index: 23, terrainCode: BIQ_TERRAIN.PLAINS }
    ]
  ], BIQ_TERRAIN);
  assert.deepEqual(fixups, [
    { index: 12, terrainCode: BIQ_TERRAIN.PLAINS },
    { index: 21, terrainCode: BIQ_TERRAIN.PLAINS }
  ]);
});

test('resolveTerrainPaintCode only keeps floodplain on river tiles', () => {
  const BIQ_TERRAIN = {
    DESERT: 0,
    PLAINS: 1,
    GRASSLAND: 2,
    FOREST: 7,
    SEA: 12,
    FLOODPLAIN: 4
  };
  assert.equal(
    mapCore.resolveTerrainPaintCode(BIQ_TERRAIN.FLOODPLAIN, true, BIQ_TERRAIN),
    BIQ_TERRAIN.FLOODPLAIN
  );
  assert.equal(
    mapCore.resolveTerrainPaintCode(BIQ_TERRAIN.FLOODPLAIN, false, BIQ_TERRAIN),
    BIQ_TERRAIN.DESERT
  );
  assert.equal(
    mapCore.resolveTerrainPaintCode(BIQ_TERRAIN.DESERT, true, BIQ_TERRAIN),
    BIQ_TERRAIN.DESERT
  );
});

test('sanitizeTerrainBonusMask keeps only variants valid for the active terrain', () => {
  const BIQ_TERRAIN = {
    DESERT: 0,
    PLAINS: 1,
    GRASSLAND: 2,
    MOUNTAIN: 6,
    FOREST: 7,
    SEA: 12
  };
  const BIQ_TILE_BONUS = {
    BONUS_GRASSLAND: 0x01,
    SNOW_CAPPED_MOUNTAIN: 0x10,
    PINE_FOREST: 0x20,
    LANDMARK: 0x2000
  };
  const all = BIQ_TILE_BONUS.BONUS_GRASSLAND | BIQ_TILE_BONUS.SNOW_CAPPED_MOUNTAIN | BIQ_TILE_BONUS.PINE_FOREST | BIQ_TILE_BONUS.LANDMARK;
  assert.equal(
    mapCore.sanitizeTerrainBonusMask(BIQ_TERRAIN.GRASSLAND, all, BIQ_TERRAIN, BIQ_TILE_BONUS),
    BIQ_TILE_BONUS.BONUS_GRASSLAND | BIQ_TILE_BONUS.LANDMARK
  );
  assert.equal(
    mapCore.sanitizeTerrainBonusMask(BIQ_TERRAIN.FOREST, all, BIQ_TERRAIN, BIQ_TILE_BONUS),
    BIQ_TILE_BONUS.PINE_FOREST | BIQ_TILE_BONUS.LANDMARK
  );
  assert.equal(
    mapCore.sanitizeTerrainBonusMask(BIQ_TERRAIN.MOUNTAIN, all, BIQ_TERRAIN, BIQ_TILE_BONUS),
    BIQ_TILE_BONUS.SNOW_CAPPED_MOUNTAIN | BIQ_TILE_BONUS.LANDMARK
  );
  assert.equal(
    mapCore.sanitizeTerrainBonusMask(BIQ_TERRAIN.SEA, all, BIQ_TERRAIN, BIQ_TILE_BONUS),
    BIQ_TILE_BONUS.LANDMARK
  );
});

test('applyOverlay toggles bool-like overlay fields', () => {
  const tiles = [makeTile(0, 4), makeTile(1, 4)];
  mapCore.applyOverlay(tiles, [0, 1], 'road', true);
  assert.equal(mapCore.getField(tiles[0], 'c3coverlays').value, String(0x00000001));
  assert.equal(mapCore.getField(tiles[1], 'c3coverlays').value, String(0x00000001));
  mapCore.applyOverlay(tiles, [0], 'airfield', true);
  mapCore.applyOverlay(tiles, [0], 'radartower', true);
  mapCore.applyOverlay(tiles, [0], 'outpost', true);
  mapCore.applyOverlay(tiles, [0], 'colony', true);
  const expectedMask = (0x00000001 | 0x20000000 | 0x40000000 | 0x80000000) >>> 0;
  assert.equal(Number.parseInt(mapCore.getField(tiles[0], 'c3coverlays').value, 10) >>> 0, expectedMask);
  assert.equal(mapCore.getField(tiles[0], 'colony'), null);
  mapCore.applyOverlay(tiles, [1], 'road', false);
  assert.equal(Number.parseInt(mapCore.getField(tiles[1], 'c3coverlays').value, 10) >>> 0, 0);
});

test('applyOverlay supports special ruin/victory values', () => {
  const tiles = [makeTile(0, 4)];
  mapCore.applyOverlay(tiles, [0], 'ruins', true);
  mapCore.applyOverlay(tiles, [0], 'victorypoint', true);
  assert.equal(mapCore.getField(tiles[0], 'ruin').value, '1');
  assert.equal(mapCore.getField(tiles[0], 'victorypointlocation').value, '0');
});

test('applyRiverOverlay connects selected and existing neighboring river tiles reciprocally', () => {
  const width = 6;
  const tiles = Array.from({ length: 9 }, (_unused, idx) => makeTile(idx, width));
  const center = 4;
  const ne = 2;
  const se = 8;
  mapCore.setField(tiles[ne], 'riverconnectioninfo', String(mapCore.RIVER_MASK.SW), 'River Connection Info');

  const changed = mapCore.applyRiverOverlay(tiles, [center, se], true);

  assert.deepEqual(new Set(changed), new Set([center, se]));
  assert.equal(
    Number.parseInt(mapCore.getField(tiles[center], 'riverconnectioninfo').value, 10) >>> 0,
    mapCore.RIVER_MASK.NE | mapCore.RIVER_MASK.SE
  );
  assert.equal(
    Number.parseInt(mapCore.getField(tiles[ne], 'riverconnectioninfo').value, 10) >>> 0,
    mapCore.RIVER_MASK.SW
  );
  assert.equal(
    Number.parseInt(mapCore.getField(tiles[se], 'riverconnectioninfo').value, 10) >>> 0,
    mapCore.RIVER_MASK.NW
  );
});

test('applyRiverOverlay removal clears reciprocal bits on neighboring tiles', () => {
  const width = 6;
  const tiles = Array.from({ length: 9 }, (_unused, idx) => makeTile(idx, width));
  const center = 4;
  const ne = 2;
  const se = 8;
  mapCore.setField(tiles[center], 'riverconnectioninfo', String(mapCore.RIVER_MASK.NE | mapCore.RIVER_MASK.SE), 'River Connection Info');
  mapCore.setField(tiles[ne], 'riverconnectioninfo', String(mapCore.RIVER_MASK.SW), 'River Connection Info');
  mapCore.setField(tiles[se], 'riverconnectioninfo', String(mapCore.RIVER_MASK.NW), 'River Connection Info');

  const changed = mapCore.applyRiverOverlay(tiles, [center], false);

  assert.deepEqual(new Set(changed), new Set([center, ne, se]));
  assert.equal(Number.parseInt(mapCore.getField(tiles[center], 'riverconnectioninfo').value, 10) >>> 0, 0);
  assert.equal(Number.parseInt(mapCore.getField(tiles[ne], 'riverconnectioninfo').value, 10) >>> 0, 0);
  assert.equal(Number.parseInt(mapCore.getField(tiles[se], 'riverconnectioninfo').value, 10) >>> 0, 0);
});

test('applyFog writes fogofwar as 0 for add, 1 for remove', () => {
  const tiles = [makeTile(0, 4), makeTile(1, 4)];
  mapCore.applyFog(tiles, [0], true);
  mapCore.applyFog(tiles, [1], false);
  assert.equal(mapCore.getField(tiles[0], 'fogofwar').value, '0');
  assert.equal(mapCore.getField(tiles[1], 'fogofwar').value, '1');
});

test('applyDistrict writes encoded district value and can clear', () => {
  const tiles = [makeTile(0, 4), makeTile(1, 4)];
  mapCore.applyDistrict(tiles, [0, 1], 3, 1, true);
  assert.equal(mapCore.getField(tiles[0], 'district').value, '3,1');
  assert.equal(mapCore.getField(tiles[1], 'district').value, '3,1');
  mapCore.applyDistrict(tiles, [1], 0, 0, false);
  assert.equal(mapCore.getField(tiles[1], 'district').value, '');
});

test('addCity appends CITY record and links tile city index', () => {
  const citySection = { records: [{ index: 0, fields: [{ key: 'name', baseKey: 'name', value: 'Alpha', originalValue: 'Alpha' }] }] };
  const tile = makeTile(5, 8);
  const city = mapCore.addCity(citySection, tile, 4, 6, 2, 1, 'New City', 'CITY_NEW_1');
  assert.ok(city);
  assert.equal(citySection.records.length, 2);
  assert.equal(mapCore.getField(city, 'name').value, 'New City');
  assert.equal(mapCore.getField(city, 'x').value, '4');
  assert.equal(mapCore.getField(city, 'y').value, '6');
  assert.equal(mapCore.getField(tile, 'city').value, String(city.index));
});

test('addCity clears cloned CITY building state', () => {
  const citySection = {
    records: [{
      index: 0,
      fields: [
        { key: 'name', baseKey: 'name', value: 'Alpha', originalValue: 'Alpha' },
        { key: 'hasWalls', baseKey: 'hasWalls', value: '1', originalValue: '1' },
        { key: 'hasPalace', baseKey: 'hasPalace', value: '1', originalValue: '1' },
        { key: 'numBuildings', baseKey: 'numBuildings', value: '3', originalValue: '3' },
        { key: 'building', baseKey: 'building', value: '4', originalValue: '4' },
        { key: 'building_2', baseKey: 'building_2', value: '7', originalValue: '7' },
        { key: 'building_3', baseKey: 'building_3', value: '9', originalValue: '9' }
      ],
      buildings: [4, 7, 9],
      numBuildings: 3,
      hasWalls: 1,
      hasPalace: 1
    }]
  };
  const tile = makeTile(5, 8);
  const city = mapCore.addCity(citySection, tile, 4, 6, 2, 1, 'New City', 'CITY_NEW_1');

  assert.equal(mapCore.getField(city, 'hasWalls').value, '0');
  assert.equal(mapCore.getField(city, 'hasPalace').value, '0');
  assert.equal(mapCore.getField(city, 'numBuildings').value, '0');
  assert.equal(mapCore.getField(city, 'building'), null);
  assert.equal(mapCore.getField(city, 'building_2'), null);
  assert.deepEqual(city.buildings, []);
  assert.equal(city.numBuildings, 0);
  assert.equal(city.hasWalls, 0);
  assert.equal(city.hasPalace, 0);
});

test('addUnit appends UNIT record and links tile unit slot', () => {
  const unitSection = { records: [{ index: 0, fields: [{ key: 'name', baseKey: 'name', value: 'Warrior', originalValue: 'Warrior' }] }] };
  const tile = makeTile(7, 8);
  const unit = mapCore.addUnit(unitSection, tile, 8, 4, 1, 1, 12, 'UNIT_NEW_1');
  assert.ok(unit);
  assert.equal(unitSection.records.length, 2);
  assert.equal(mapCore.getField(unit, 'x').value, '8');
  assert.equal(mapCore.getField(unit, 'prtonumber').value, '12');
  assert.equal(mapCore.getField(tile, 'unit_on_tile').value, String(unit.index));
});

test('addOrUpdateStartingLocation moves duplicate civ-owned starts to the new tile', () => {
  const slocSection = {
    records: [
      {
        index: 0,
        newRecordRef: 'SLOC_OLD',
        fields: [
          { key: 'ownertype', baseKey: 'ownertype', value: '2', originalValue: '2' },
          { key: 'owner', baseKey: 'owner', value: '4', originalValue: '4' },
          { key: 'x', baseKey: 'x', value: '2', originalValue: '2' },
          { key: 'y', baseKey: 'y', value: '6', originalValue: '6' }
        ]
      }
    ]
  };
  const result = mapCore.addOrUpdateStartingLocation(slocSection, 8, 10, 4, 2, 'SLOC_NEW');
  assert.equal(result.changed, true);
  assert.equal(result.created, true);
  assert.equal(result.removedRecords.length, 1);
  assert.equal(result.removedRecords[0].newRecordRef, 'SLOC_OLD');
  assert.equal(slocSection.records.length, 1);
  assert.equal(mapCore.getField(slocSection.records[0], 'owner').value, '4');
  assert.equal(mapCore.getField(slocSection.records[0], 'ownertype').value, '2');
  assert.equal(mapCore.getField(slocSection.records[0], 'x').value, '8');
  assert.equal(mapCore.getField(slocSection.records[0], 'y').value, '10');
});

test('addOrUpdateStartingLocation keeps multiple unowned starts', () => {
  const slocSection = { records: [] };
  mapCore.addOrUpdateStartingLocation(slocSection, 1, 1, -1, 0, 'SLOC_A');
  mapCore.addOrUpdateStartingLocation(slocSection, 3, 5, -1, 0, 'SLOC_B');
  assert.equal(slocSection.records.length, 2);
});

test('setField creates missing fields and preserves existing entries', () => {
  const tile = makeTile(0, 4);
  mapCore.setField(tile, 'custom_flag', 'true', 'Custom Flag');
  assert.equal(mapCore.getField(tile, 'custom_flag').value, 'true');
  mapCore.setField(tile, 'custom_flag', 'false', 'Custom Flag');
  assert.equal(mapCore.getField(tile, 'custom_flag').value, 'false');
});

test('tileCoordsByIndex keeps Civ3 odd/even stagger pattern', () => {
  const width = 10;
  const a = mapCore.tileCoordsByIndex(width, 0);
  const b = mapCore.tileCoordsByIndex(width, 4);
  const c = mapCore.tileCoordsByIndex(width, 5);
  assert.deepEqual(a, { xPos: 0, yPos: 0 });
  assert.equal(b.yPos % 2, 0);
  assert.equal(c.yPos % 2, 1);
});

test('applyOverlay ignores unknown overlay types', () => {
  const tile = makeTile(0, 4);
  mapCore.applyOverlay([tile], [0], 'not-real-overlay', true);
  assert.equal(mapCore.getField(tile, 'not-real-overlay'), null);
});

test('applyTerrain ignores invalid terrain codes', () => {
  const tile = makeTile(0, 4);
  const original = mapCore.getField(tile, 'baserealterrain').value;
  mapCore.applyTerrain([tile], [0], -1);
  assert.equal(mapCore.getField(tile, 'baserealterrain').value, original);
  mapCore.applyTerrain([tile], [0], 'abc');
  assert.equal(mapCore.getField(tile, 'baserealterrain').value, original);
});

test('applyDistrict ignores invalid type while enabled', () => {
  const tile = makeTile(0, 4);
  mapCore.applyDistrict([tile], [0], -1, 1, true);
  assert.equal(mapCore.getField(tile, 'district'), null);
});

test('addCity/addUnit assign monotonically increasing record indexes', () => {
  const citySection = { records: [{ index: 5, fields: [{ key: 'name', baseKey: 'name', value: 'City5', originalValue: 'City5' }] }] };
  const unitSection = { records: [{ index: 9, fields: [{ key: 'name', baseKey: 'name', value: 'Unit9', originalValue: 'Unit9' }] }] };
  const tileA = makeTile(1, 8);
  const tileB = makeTile(2, 8);
  const cityA = mapCore.addCity(citySection, tileA, 2, 0, 0, 1, 'A', 'CITY_A');
  const cityB = mapCore.addCity(citySection, tileB, 4, 0, 0, 1, 'B', 'CITY_B');
  const unitA = mapCore.addUnit(unitSection, tileA, 2, 0, 0, 1, 3, 'UNIT_A');
  const unitB = mapCore.addUnit(unitSection, tileB, 4, 0, 0, 1, 4, 'UNIT_B');
  assert.equal(cityA.index, 6);
  assert.equal(cityB.index, 7);
  assert.equal(unitA.index, 10);
  assert.equal(unitB.index, 11);
});

test('multi-step map editing flow updates tile data consistently', () => {
  const width = 8;
  const height = 8;
  const tiles = new Array(Math.floor((width * height) / 2)).fill(null).map((_, idx) => makeTile(idx, width));
  const center = 10;
  const brush = mapCore.computeBrushTileIndexes(width, tiles.length, center, 3);
  assert.ok(brush.length > 1, 'expected multi-tile brush');
  mapCore.applyTerrain(tiles, brush, 5);
  mapCore.applyOverlay(tiles, brush, 'road', true);
  mapCore.applyFog(tiles, brush, true);
  mapCore.applyDistrict(tiles, brush, 2, 1, true);

  brush.forEach((idx) => {
    const tile = tiles[idx];
    assert.equal(mapCore.getField(tile, 'baserealterrain').value, packTerrain(5));
    assert.equal((Number.parseInt(mapCore.getField(tile, 'c3coverlays').value, 10) & 0x00000001), 0x00000001);
    assert.equal(mapCore.getField(tile, 'fogofwar').value, '0');
    assert.equal(mapCore.getField(tile, 'district').value, '2,1');
  });

  const citySection = { records: [{ index: 0, fields: [{ key: 'name', baseKey: 'name', value: 'StartCity', originalValue: 'StartCity' }] }] };
  const unitSection = { records: [{ index: 0, fields: [{ key: 'name', baseKey: 'name', value: 'StartUnit', originalValue: 'StartUnit' }] }] };
  const centerTile = tiles[center];
  const pos = mapCore.tileCoordsByIndex(width, center);
  mapCore.addCity(citySection, centerTile, pos.xPos, pos.yPos, 3, 1, 'Brush City', 'CITY_BRUSH');
  mapCore.addUnit(unitSection, centerTile, pos.xPos, pos.yPos, 3, 1, 7, 'UNIT_BRUSH');
  assert.equal(citySection.records.length, 2);
  assert.equal(unitSection.records.length, 2);
  assert.ok(Number.parseInt(mapCore.getField(centerTile, 'city').value, 10) >= 1);
  assert.ok(Number.parseInt(mapCore.getField(centerTile, 'unit_on_tile').value, 10) >= 1);
});
