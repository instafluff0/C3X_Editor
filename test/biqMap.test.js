'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadBundle,
  saveBundle,
  collectBiqMapStructureOps,
  collectBiqMapRecordOps,
  collectBiqMapEdits
} = require('../src/configCore');
const {
  applyEdits,
  parseAllSections,
  serializeSection,
  collectMapReferenceIntegrityIssues,
  collectColonyOverlayCoherenceIssues
} = require('../src/biq/biqSections');
const { decompress } = require('../src/biq/decompress');
const mapCore = require('../src/mapEditorCore');
const {
  DEFAULT_MAP_SECTION_CODES,
  getChangedSectionCodes,
  assertRawSectionsEqual,
  assertNoMapReferenceIssues,
  assertNoColonyOverlayIssues
} = require('./biqMapAssertions');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-biq-map-'));
}

function ensureDefaultC3xFiles(root) {
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = Art\\Units\\Warrior\\Warrior.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
}

function getStableMapUnitsFixturePath() {
  return path.resolve(__dirname, 'fixtures', 'biq_map_units_fixture.biq');
}

function getStableLeadNoMapFixturePath() {
  return path.resolve(__dirname, 'fixtures', 'biq_lead_nomap_fixture.biq');
}

function getStableFixtureCiv3Root() {
  return path.resolve(__dirname, '..', '..');
}

function resolveCiv3RootFromBiq(biqPath) {
  return path.resolve(path.dirname(biqPath), '..');
}

function parseBiqFileForRawSections(filePath) {
  const raw = fs.readFileSync(filePath);
  const inflated = decompress(raw);
  return parseAllSections(inflated.ok ? inflated.data : raw);
}

function getSection(tab, code) {
  const target = String(code || '').trim().toUpperCase();
  return (tab && Array.isArray(tab.sections) ? tab.sections : []).find((section) => String(section && section.code || '').trim().toUpperCase() === target) || null;
}

function getRecordField(record, key) {
  const target = String(key || '').trim().toLowerCase();
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  return fields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target) || null;
}

function parseIntLoose(value, fallback = 0) {
  const match = String(value == null ? '' : value).trim().match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRecordInt(record, key, fallback = 0) {
  const field = getRecordField(record, key);
  return parseIntLoose(field && field.value, fallback);
}

function getRecordStoredInt(record, key, fallback = 0) {
  const field = getRecordField(record, key);
  const preferred = field && field.mapEditorValueEdited
    ? field.value
    : (field && field.originalValue != null && String(field.originalValue).trim() !== '' ? field.originalValue : field && field.value);
  return parseIntLoose(preferred, fallback);
}

function getMapSectionsOrSkip(t, mapTab) {
  const tileSection = getSection(mapTab, 'TILE');
  const citySection = getSection(mapTab, 'CITY');
  const unitSection = getSection(mapTab, 'UNIT');
  if (!(tileSection && citySection && unitSection)) {
    t.skip('Sample BIQ map tab is missing TILE/CITY/UNIT sections.');
    return null;
  }
  return { tileSection, citySection, unitSection };
}

function getRecordsAtCoords(section, x, y) {
  return ((section && section.records) || []).filter((record) => (
    getRecordInt(record, 'x', -1) === Number(x)
    && getRecordInt(record, 'y', -1) === Number(y)
  ));
}

function getTileAtCoords(section, x, y) {
  return ((section && section.records) || []).find((record) => (
    getRecordInt(record, 'xpos', -1) === Number(x)
    && getRecordInt(record, 'ypos', -1) === Number(y)
  )) || null;
}

function getParsedTileAtCoords(section, x, y) {
  return ((section && section.records) || []).find((record) => (
    Number(record && record.xpos) === Number(x)
    && Number(record && record.ypos) === Number(y)
  )) || null;
}

function parsedTileHasStartingLocationFlag(section, x, y) {
  const tile = getParsedTileAtCoords(section, x, y);
  return !!(tile && (((Number(tile.c3cBonuses) || 0) >>> 0) & 0x00000008));
}

function addSeedCity(mapTab, citySection, tile, name, owner = 0, ownerType = 2) {
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const ref = `CITY_${String(name || 'seed').replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_${Date.now()}_${Math.floor(Math.random() * 10000)}`.slice(0, 28);
  const x = getRecordInt(tile, 'xpos', -1);
  const y = getRecordInt(tile, 'ypos', -1);
  mapCore.addCity(citySection, tile, x, y, owner, ownerType, name, ref);
  mapTab.recordOps.push({ op: 'add', sectionCode: 'CITY', newRecordRef: ref });
  return { ref, x, y, name };
}

function addSeedUnit(mapTab, unitSection, tile, owner = 0, ownerType = 2, prtoNumber = 0, suffix = 'seed') {
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const ref = `UNIT_${String(suffix || 'seed').replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_${Date.now()}_${Math.floor(Math.random() * 10000)}`.slice(0, 28);
  const x = getRecordInt(tile, 'xpos', -1);
  const y = getRecordInt(tile, 'ypos', -1);
  mapCore.addUnit(unitSection, tile, x, y, owner, ownerType, prtoNumber, ref);
  mapTab.recordOps.push({ op: 'add', sectionCode: 'UNIT', newRecordRef: ref });
  return { ref, x, y, owner, ownerType, prtoNumber };
}

function addSeedStartingLocation(mapTab, slocSection, x, y, owner = 0, ownerType = 3, suffix = 'seed') {
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const ref = `SLOC_${String(suffix || 'seed').replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_${Date.now()}_${Math.floor(Math.random() * 10000)}`.slice(0, 28);
  const result = mapCore.addOrUpdateStartingLocation(slocSection, x, y, owner, ownerType, ref);
  if (result && result.created) {
    mapTab.recordOps.push({ op: 'add', sectionCode: 'SLOC', newRecordRef: ref });
  }
  return result;
}

function createMapField(baseKey, value, label) {
  return {
    baseKey,
    key: baseKey,
    value: String(value),
    originalValue: '',
    label: label || baseKey
  };
}

function buildGeneratedBlankMapSections(width = 16, height = 16) {
  const safeWidth = Math.max(16, Number(width) || 16);
  const safeHeight = Math.max(16, Number(height) || 16);
  const tileCount = Math.floor(safeWidth / 2) * safeHeight;
  const makeSection = (code, records) => ({ code, records });
  const tileRecords = Array.from({ length: tileCount }, (_, index) => {
    const row = Math.floor(index / Math.floor(safeWidth / 2));
    const column = (index % Math.floor(safeWidth / 2)) * 2 + ((row & 1) === 1 ? 1 : 0);
    return {
      index,
      fields: [
        createMapField('xpos', column, 'X Pos'),
        createMapField('ypos', row, 'Y Pos'),
        createMapField('terrain', 0, 'Terrain'),
        createMapField('baserealterrain', 0x22, 'Base Real Terrain'),
        createMapField('c3cbaserealterrain', 0x22, 'C3C Base Real Terrain'),
        createMapField('resource', -1, 'Resource'),
        createMapField('city', -1, 'City'),
        createMapField('colony', -1, 'Colony'),
        createMapField('continent', 0, 'Continent'),
        createMapField('overlay', 0, 'Overlay'),
        createMapField('c3coverlays', 0, 'C3C Overlays'),
        createMapField('file', 0, 'File'),
        createMapField('image', 0, 'Image')
      ]
    };
  });
  return [
    makeSection('WCHR', [{
      index: 0,
      fields: [
        createMapField('selectedclimate', 1, 'Selected Climate'),
        createMapField('actualclimate', 1, 'Actual Climate'),
        createMapField('selectedbarbarianactivity', 1, 'Selected Barbarian Activity'),
        createMapField('actualbarbarianactivity', 1, 'Actual Barbarian Activity'),
        createMapField('selectedlandform', 1, 'Selected Landform'),
        createMapField('actuallandform', 1, 'Actual Landform'),
        createMapField('selectedoceancoverage', 1, 'Selected Ocean Coverage'),
        createMapField('actualoceancoverage', 1, 'Actual Ocean Coverage'),
        createMapField('selectedtemperature', 1, 'Selected Temperature'),
        createMapField('actualtemperature', 1, 'Actual Temperature'),
        createMapField('selectedage', 1, 'Selected Age'),
        createMapField('actualage', 1, 'Actual Age'),
        createMapField('worldsize', 2, 'World Size')
      ]
    }]),
    makeSection('WMAP', [{
      index: 0,
      fields: [
        createMapField('width', safeWidth, 'Width'),
        createMapField('height', safeHeight, 'Height'),
        createMapField('numcontinents', 1, 'Num Continents'),
        createMapField('numcivs', 2, 'Num Civs'),
        createMapField('distancebetweencivs', 20, 'Distance Between Civs'),
        createMapField('questionmark1', 0, 'Question Mark 1'),
        createMapField('questionmark2', 0, 'Question Mark 2'),
        createMapField('questionmark3', -1, 'Question Mark 3'),
        createMapField('mapseed', 12345, 'Map Seed'),
        createMapField('flags', 0, 'Flags')
      ]
    }]),
    makeSection('TILE', tileRecords),
    makeSection('CONT', [{
      index: 0,
      fields: [
        createMapField('continentclass', 1, 'Continent Class'),
        createMapField('numtiles', tileCount, 'Num Tiles')
      ]
    }]),
    makeSection('SLOC', []),
    makeSection('CITY', []),
    makeSection('UNIT', []),
    makeSection('CLNY', [])
  ];
}

function buildSeededResizeMapBuffer(seedX = 4, seedY = 4) {
  const raw = fs.readFileSync(getStableLeadNoMapFixturePath());
  const sections = buildGeneratedBlankMapSections(16, 16);
  const mapTab = { sections, recordOps: [] };
  const tileSection = getSection(mapTab, 'TILE');
  const citySection = getSection(mapTab, 'CITY');
  const unitSection = getSection(mapTab, 'UNIT');
  const slocSection = getSection(mapTab, 'SLOC');
  const colonySection = getSection(mapTab, 'CLNY');
  const seedTile = getTileAtCoords(tileSection, seedX, seedY);
  assert.ok(seedTile, `expected seed tile ${seedX},${seedY}`);
  mapCore.setField(seedTile, 'resource', '3', 'Resource');
  mapCore.setField(seedTile, 'c3coverlays', '1234', 'C3C Overlays');
  const seededCity = addSeedCity(mapTab, citySection, seedTile, 'Directional Resize City');
  const seededUnit = addSeedUnit(mapTab, unitSection, seedTile, 0, 2, 0, 'directional_resize');
  const seededSloc = addSeedStartingLocation(mapTab, slocSection, seedX, seedY, 0, 3, 'directional_resize');
  const seededColony = addSeedColony(mapTab, colonySection, seedTile, 0, 2, 2, 'directional_resize');
  assert.ok(seededSloc && seededSloc.created, 'expected seeded starting location');
  const setMapResult = applyEdits(raw, [{
    op: 'setmap',
    sections,
    allowSetmapGeneration: true
  }], {
    allowSetmapGeneration: true
  });
  assert.equal(setMapResult.ok, true, String(setMapResult.error || 'failed to seed directional resize map'));
  return {
    buffer: setMapResult.buffer,
    seedX,
    seedY,
    seededCity,
    seededUnit,
    seededSloc,
    seededColony
  };
}

function addSeedColony(mapTab, colonySection, tile, owner = 0, ownerType = 2, improvementType = 2, suffix = 'seed') {
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  if (!Array.isArray(colonySection.records)) colonySection.records = [];
  const ref = `CLNY_${String(suffix || 'seed').replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_${Date.now()}_${Math.floor(Math.random() * 10000)}`.slice(0, 28);
  const x = getRecordInt(tile, 'xpos', -1);
  const y = getRecordInt(tile, 'ypos', -1);
  const nextIndex = colonySection.records.reduce((max, record) => {
    const idx = Number(record && record.index);
    return Number.isFinite(idx) ? Math.max(max, idx) : max;
  }, -1) + 1;
  const record = {
    index: nextIndex,
    newRecordRef: ref,
    ownerType,
    owner,
    x,
    y,
    improvementType,
    fields: [
      createMapField('ownerType', ownerType, 'Owner Type'),
      createMapField('owner', owner, 'Owner'),
      createMapField('x', x, 'X'),
      createMapField('y', y, 'Y'),
      createMapField('improvementType', improvementType, 'Improvement Type')
    ]
  };
  colonySection.records.push(record);
  mapTab.recordOps.push({ op: 'add', sectionCode: 'CLNY', newRecordRef: ref });
  mapCore.setField(tile, 'colony', String(nextIndex), 'Colony');
  const currentOverlays = getRecordInt(tile, 'c3coverlays', 0) & ~(0x20000000 | 0x40000000 | 0x80000000);
  let nextOverlays = currentOverlays;
  if (improvementType === 1) nextOverlays |= 0x20000000;
  else if (improvementType === 2) nextOverlays |= 0x40000000;
  else if (improvementType === 3) nextOverlays |= 0x80000000;
  mapCore.setField(tile, 'c3coverlays', String(nextOverlays), 'C3C Overlays');
  return { ref, x, y, owner, ownerType, improvementType, index: nextIndex };
}

function seedStableFixtureCitiesOrSkip(t, bundle) {
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  if (!mapTab) {
    t.skip('Map tab unavailable in stable fixture BIQ.');
    return null;
  }
  const sections = getMapSectionsOrSkip(t, mapTab);
  if (!sections) return null;
  const { tileSection, citySection } = sections;
  const openTiles = (tileSection.records || []).filter((tile) => getRecordInt(tile, 'city', -1) < 0).slice(0, 3);
  if (openTiles.length < 3) {
    t.skip('Stable fixture lacks enough empty tiles to seed city-delete regression.');
    return null;
  }
  const seeded = [
    addSeedCity(mapTab, citySection, openTiles[0], 'Seed Delete City A'),
    addSeedCity(mapTab, citySection, openTiles[1], 'Seed Delete City B'),
    addSeedCity(mapTab, citySection, openTiles[2], 'Seed Delete City C')
  ];
  return { mapTab, tileSection, citySection, seeded };
}

function assertMapReferenceIntegrityFromMapTab(mapTab, message = '') {
  const parsedWmap = getSection(mapTab, 'WMAP');
  const parsed = {
    io: {
      mapWidth: parsedWmap && Array.isArray(parsedWmap.records) && parsedWmap.records[0]
        ? getRecordStoredInt(parsedWmap.records[0], 'width', 0)
        : 0
    },
    sections: Array.isArray(mapTab && mapTab.sections) ? mapTab.sections.map((section) => ({
      code: section.code,
      records: Array.isArray(section.records) ? section.records.map((record) => {
        const out = { index: Number(record && record.index) };
        const sectionCode = String(section && section.code || '').toUpperCase();
        if (sectionCode === 'WMAP') {
          out.width = getRecordStoredInt(record, 'width', 0);
          out.height = getRecordStoredInt(record, 'height', 0);
        } else if (sectionCode === 'TILE') {
          out.xpos = getRecordStoredInt(record, 'xpos', -1);
          out.ypos = getRecordStoredInt(record, 'ypos', -1);
          out.city = getRecordStoredInt(record, 'city', -1);
          out.colony = getRecordStoredInt(record, 'colony', -1);
        } else if (sectionCode === 'SLOC') {
          out.ownerType = getRecordStoredInt(record, 'ownertype', -1);
          out.owner = getRecordStoredInt(record, 'owner', -1);
          out.x = getRecordStoredInt(record, 'x', -1);
          out.y = getRecordStoredInt(record, 'y', -1);
        } else if (sectionCode === 'CITY' || sectionCode === 'CLNY' || sectionCode === 'UNIT') {
          out.ownerType = getRecordStoredInt(record, 'ownertype', -1);
          out.owner = getRecordStoredInt(record, 'owner', -1);
          out.x = getRecordStoredInt(record, 'x', -1);
          out.y = getRecordStoredInt(record, 'y', -1);
        }
        return out;
      }) : []
    })) : []
  };
  assertNoMapReferenceIssues(parsed, message);
}

test('BIQ map: unchanged save preserves raw map section bytes', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioDir = path.join(tmp, 'scenario');
  fs.mkdirSync(c3x, { recursive: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(scenarioDir, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const before = parseBiqFileForRawSections(sampleBiq);
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(before.ok, true, 'expected original BIQ parse');
  assert.equal(after.ok, true, 'expected saved BIQ parse');

  assertRawSectionsEqual(before, after, DEFAULT_MAP_SECTION_CODES);
});

test('BIQ map: unchanged loaded map bundle emits no collected map ops or field edits', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected loaded map tab');
  assert.deepEqual(collectBiqMapStructureOps(bundle.tabs), [], 'expected unchanged map bundle to emit no map structure ops');
  assert.deepEqual(collectBiqMapRecordOps(bundle.tabs), [], 'expected unchanged map bundle to emit no map record ops');
  assert.deepEqual(collectBiqMapEdits(bundle.tabs), [], 'expected unchanged map bundle to emit no map field edits');
});

test('BIQ map: centered expansion shifts existing entities and tiles together', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle.tabs.map;
  const sections = getMapSectionsOrSkip(t, mapTab);
  if (!sections) return;
  const { tileSection, citySection, unitSection } = sections;
  const slocSection = getSection(mapTab, 'SLOC');
  assert.ok(slocSection, 'expected SLOC section for resize test');
  const openTile = (tileSection.records || []).find((tile) => (
    getRecordInt(tile, 'city', -1) < 0
  ));
  assert.ok(openTile, 'expected empty tile for resize test');
  const seedX = getRecordInt(openTile, 'xpos', -1);
  const seedY = getRecordInt(openTile, 'ypos', -1);
  const seededCity = addSeedCity(mapTab, citySection, openTile, 'Resize Seed City');
  const seededUnit = addSeedUnit(mapTab, unitSection, openTile, 0, 2, 0, 'resize');
  const seededSloc = addSeedStartingLocation(mapTab, slocSection, seedX, seedY, 0, 3, 'resize');
  assert.ok(seededSloc && seededSloc.created, 'expected seeded starting location');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed resize entities'));

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const seededMap = seededReload.tabs.map;
  const seededWmap = getSection(seededMap, 'WMAP');
  const seededTileSection = getSection(seededMap, 'TILE');
  const seededCitySection = getSection(seededMap, 'CITY');
  const seededUnitSection = getSection(seededMap, 'UNIT');
  const seededSlocSection = getSection(seededMap, 'SLOC');
  assert.ok(seededWmap && seededTileSection && seededCitySection && seededUnitSection && seededSlocSection, 'expected full map sections after seeding');
  const seededWmapRecord = seededWmap.records[0];
  const originalWidth = getRecordInt(seededWmapRecord, 'width', 0);
  const originalHeight = getRecordInt(seededWmapRecord, 'height', 0);
  const before = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(before.ok, true, 'expected seeded BIQ parse before resize');

  const stableCoords = [
    { x: seedX, y: seedY },
    { x: getRecordInt(seededTileSection.records[0], 'xpos', -1), y: getRecordInt(seededTileSection.records[0], 'ypos', -1) },
    { x: getRecordInt(seededTileSection.records[Math.floor(seededTileSection.records.length / 2)], 'xpos', -1), y: getRecordInt(seededTileSection.records[Math.floor(seededTileSection.records.length / 2)], 'ypos', -1) }
  ].filter((coord, index, arr) => (
    coord.x >= 0
    && coord.y >= 0
    && arr.findIndex((other) => other.x === coord.x && other.y === coord.y) === index
  ));
  const stableSnapshot = stableCoords.map((coord) => {
    const tile = getTileAtCoords(seededTileSection, coord.x, coord.y);
    return {
      x: coord.x,
      y: coord.y,
      base: getRecordInt(tile, 'baserealterrain', -1),
      overlays: getRecordInt(tile, 'c3coverlays', -1),
      resource: getRecordInt(tile, 'resource', -1)
    };
  });

  const widthField = getRecordField(seededWmapRecord, 'width');
  const heightField = getRecordField(seededWmapRecord, 'height');
  widthField.value = String(originalWidth + 2);
  heightField.value = String(originalHeight + 2);
  const shiftX = 1;
  const shiftY = 1;

  const resizeSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(resizeSaveResult.ok, true, String(resizeSaveResult.error || 'resize save failed'));

  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(after.ok, true, 'expected resized BIQ parse');
  assert.deepEqual(getChangedSectionCodes(before, after), ['WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT']);

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = reloaded.tabs.map;
  const reWmap = getSection(reMap, 'WMAP');
  const reTileSection = getSection(reMap, 'TILE');
  const reCitySection = getSection(reMap, 'CITY');
  const reUnitSection = getSection(reMap, 'UNIT');
  const reSlocSection = getSection(reMap, 'SLOC');
  assert.equal(getRecordInt(reWmap.records[0], 'width', 0), originalWidth + 2);
  assert.equal(getRecordInt(reWmap.records[0], 'height', 0), originalHeight + 2);

  const reSeedTile = getTileAtCoords(reTileSection, seedX + shiftX, seedY + shiftY);
  assert.ok(reSeedTile, 'expected seeded tile to remain after resize');
  const reCity = (reCitySection.records || []).find((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === seededCity.name);
  const reUnit = (reUnitSection.records || []).find((record) => (
    getRecordInt(record, 'x', -1) === (seededUnit.x + shiftX)
    && getRecordInt(record, 'y', -1) === (seededUnit.y + shiftY)
    && getRecordInt(record, 'prtonumber', -1) === seededUnit.prtoNumber
  ));
  const reSloc = getRecordsAtCoords(reSlocSection, seedX + shiftX, seedY + shiftY)[0];
  assert.ok(reCity, 'expected seeded city after resize');
  assert.ok(reUnit, 'expected seeded unit after resize');
  assert.ok(reSloc, 'expected seeded starting location after resize');
  assert.equal(getRecordInt(reCity, 'x', -1), seedX + shiftX);
  assert.equal(getRecordInt(reCity, 'y', -1), seedY + shiftY);
  assert.equal(getRecordInt(reUnit, 'x', -1), seedX + shiftX);
  assert.equal(getRecordInt(reUnit, 'y', -1), seedY + shiftY);
  assert.equal(getRecordInt(reSloc, 'x', -1), seedX + shiftX);
  assert.equal(getRecordInt(reSloc, 'y', -1), seedY + shiftY);
  assert.equal(getRecordInt(reSeedTile, 'city', -1), reCity.index);
  const newSeaTile = getTileAtCoords(reTileSection, 0, 0);
  assert.ok(newSeaTile, 'expected a new edge tile after centered expansion');
  assert.equal(getRecordInt(newSeaTile, 'c3cbaserealterrain', -1) & 0x0f, 12, 'expected new resize space to default to sea terrain');
  assert.equal(getRecordInt(newSeaTile, 'c3coverlays', -1), 0, 'expected new resize space to start without overlays');
  assert.equal(getRecordInt(newSeaTile, 'city', -1), -1, 'expected new resize space to start without a city backref');
  assert.equal(getRecordInt(newSeaTile, 'colony', -1), -1, 'expected new resize space to start without a colony backref');

  stableSnapshot.forEach((expected) => {
    const tile = getTileAtCoords(reTileSection, expected.x + shiftX, expected.y + shiftY);
    assert.ok(tile, `expected tile ${expected.x + shiftX},${expected.y + shiftY} after resize`);
    assert.equal(getRecordInt(tile, 'baserealterrain', -1), expected.base, `expected terrain at ${expected.x + shiftX},${expected.y + shiftY} to stay stable`);
    assert.equal(getRecordInt(tile, 'c3coverlays', -1), expected.overlays, `expected overlays at ${expected.x + shiftX},${expected.y + shiftY} to stay stable`);
    assert.equal(getRecordInt(tile, 'resource', -1), expected.resource, `expected resource at ${expected.x + shiftX},${expected.y + shiftY} to stay stable`);
  });

  assertMapReferenceIntegrityFromMapTab(reMap, 'expected resized map to keep valid entity/tile references');
});

test('BIQ map: directional resize anchors preserve placed content on the intended tile', () => {
  const cases = [
    {
      label: 'east/south expansion keeps existing coordinates fixed',
      width: 18,
      height: 18,
      horizontalAnchor: 'east',
      verticalAnchor: 'south',
      expectedDx: 0,
      expectedDy: 0,
      newTile: { x: 16, y: 4 }
    },
    {
      label: 'west/north expansion shifts existing content away from the new edges',
      width: 18,
      height: 18,
      horizontalAnchor: 'west',
      verticalAnchor: 'north',
      expectedDx: 2,
      expectedDy: 2,
      newTile: { x: 0, y: 0 }
    },
    {
      label: 'east/south shrink trims far edges without moving surviving content',
      width: 14,
      height: 14,
      horizontalAnchor: 'east',
      verticalAnchor: 'south',
      expectedDx: 0,
      expectedDy: 0
    },
    {
      label: 'west/north shrink moves surviving content after trimming near edges',
      width: 14,
      height: 14,
      horizontalAnchor: 'west',
      verticalAnchor: 'north',
      expectedDx: -2,
      expectedDy: -2
    }
  ];

  cases.forEach((spec) => {
    const seeded = buildSeededResizeMapBuffer(4, 4);
    const resizeResult = applyEdits(seeded.buffer, [{
      op: 'resizemap',
      width: spec.width,
      height: spec.height,
      fillTerrain: 12,
      horizontalAnchor: spec.horizontalAnchor,
      verticalAnchor: spec.verticalAnchor
    }]);
    assert.equal(resizeResult.ok, true, `${spec.label}: ${String(resizeResult.error || 'resize failed')}`);

    const parsed = parseAllSections(resizeResult.buffer);
    assert.equal(parsed.ok, true, `${spec.label}: expected resized BIQ to parse`);
    const wmapSection = getSection({ sections: parsed.sections }, 'WMAP');
    const tileSection = getSection({ sections: parsed.sections }, 'TILE');
    const citySection = getSection({ sections: parsed.sections }, 'CITY');
    const unitSection = getSection({ sections: parsed.sections }, 'UNIT');
    const slocSection = getSection({ sections: parsed.sections }, 'SLOC');
    const colonySection = getSection({ sections: parsed.sections }, 'CLNY');
    assert.equal(Number(wmapSection.records[0].width), spec.width, `${spec.label}: expected resized width`);
    assert.equal(Number(wmapSection.records[0].height), spec.height, `${spec.label}: expected resized height`);

    const expectedX = seeded.seedX + spec.expectedDx;
    const expectedY = seeded.seedY + spec.expectedDy;
    const shiftedTile = getParsedTileAtCoords(tileSection, expectedX, expectedY);
    assert.ok(shiftedTile, `${spec.label}: expected seeded tile at ${expectedX},${expectedY}`);
    assert.equal(Number(shiftedTile.resource), 3, `${spec.label}: expected resource to stay on the seeded tile`);
    assert.equal(Number(shiftedTile.c3cOverlays) & 0x0fffffff, 1234, `${spec.label}: expected overlays to stay on the seeded tile`);

    const city = (citySection.records || []).find((record) => String(record && record.name || '') === seeded.seededCity.name);
    assert.ok(city, `${spec.label}: expected seeded city`);
    assert.equal(Number(city.x), expectedX, `${spec.label}: expected city x to follow tile offset`);
    assert.equal(Number(city.y), expectedY, `${spec.label}: expected city y to follow tile offset`);
    assert.ok((unitSection.records || []).some((record) => (
      Number(record && record.x) === expectedX
      && Number(record && record.y) === expectedY
    )), `${spec.label}: expected seeded unit to follow tile offset`);
    assert.ok((slocSection.records || []).some((record) => (
      Number(record && record.x) === expectedX
      && Number(record && record.y) === expectedY
    )), `${spec.label}: expected starting location to follow tile offset`);
    assert.ok((colonySection.records || []).some((record) => (
      Number(record && record.x) === expectedX
      && Number(record && record.y) === expectedY
      && Number(record && record.improvementType) === seeded.seededColony.improvementType
    )), `${spec.label}: expected colony to follow tile offset`);
    assert.equal(Number(shiftedTile.city), 0, `${spec.label}: expected tile city back-reference to be rebuilt`);
    assert.equal(Number(shiftedTile.colony), 0, `${spec.label}: expected tile colony back-reference to be rebuilt`);

    if (spec.newTile) {
      const newTile = getParsedTileAtCoords(tileSection, spec.newTile.x, spec.newTile.y);
      assert.ok(newTile, `${spec.label}: expected new edge tile`);
      assert.equal(Number(newTile.c3cBaseRealTerrain) & 0x0f, 12, `${spec.label}: expected new edge tile to use selected fill terrain`);
      assert.equal(Number(newTile.resource), -1, `${spec.label}: expected new edge tile to start without a resource`);
      assert.equal(Number(newTile.city), -1, `${spec.label}: expected new edge tile to start without a city`);
      assert.equal(Number(newTile.colony), -1, `${spec.label}: expected new edge tile to start without a colony`);
    }

    assertNoMapReferenceIssues(parsed, `${spec.label}: expected reference-safe resized map`);
  });
});

test('BIQ map: resizing recomputes stored terrain sprite fields for shifted map edges', () => {
  const raw = fs.readFileSync(getStableLeadNoMapFixturePath());
  const blankSections = buildGeneratedBlankMapSections(16, 16);
  const setMapResult = applyEdits(raw, [{
    op: 'setmap',
    sections: blankSections,
    allowSetmapGeneration: true
  }], {
    allowSetmapGeneration: true
  });
  assert.equal(setMapResult.ok, true, String(setMapResult.error || 'failed to seed blank map'));

  const seededParsed = parseAllSections(setMapResult.buffer);
  assert.equal(seededParsed.ok, true, 'expected generated blank map to parse');
  const seededTileSection = getSection({ sections: seededParsed.sections }, 'TILE');
  const staleEdgeTile = getParsedTileAtCoords(seededTileSection, 15, 3);
  assert.ok(staleEdgeTile, 'expected old east-edge tile before resize');
  assert.equal(Number(staleEdgeTile.file), 0, 'expected seeded fixture tile file to start unset');
  assert.equal(Number(staleEdgeTile.image), 0, 'expected seeded fixture tile image to start unset');

  const resizeResult = applyEdits(setMapResult.buffer, [{
    op: 'resizemap',
    width: 18,
    height: 16
  }]);
  assert.equal(resizeResult.ok, true, String(resizeResult.error || 'resize save failed'));

  const resizedParsed = parseAllSections(resizeResult.buffer);
  assert.equal(resizedParsed.ok, true, 'expected resized blank map to parse');
  const resizedWmap = getSection({ sections: resizedParsed.sections }, 'WMAP');
  const resizedTileSection = getSection({ sections: resizedParsed.sections }, 'TILE');
  assert.equal(Number(resizedWmap.records[0].width), 18);
  assert.equal(Number(resizedWmap.records[0].height), 16);

  const noLongerEdgeTile = getParsedTileAtCoords(resizedTileSection, 15, 3);
  const newEastEdgeTile = getParsedTileAtCoords(resizedTileSection, 17, 3);
  assert.ok(noLongerEdgeTile, 'expected shifted interior tile after resize');
  assert.ok(newEastEdgeTile, 'expected new east-edge tile after resize');
  assert.equal(Number(noLongerEdgeTile.file), 4, 'expected shifted interior grassland tile to use inland sprite atlas');
  assert.equal(Number(noLongerEdgeTile.image), 40, 'expected shifted interior grassland tile to use inland sprite image');
  assert.equal(Number(newEastEdgeTile.file), 4, 'expected wrapped east-edge grassland tile to recompute from wrapped neighbors');
  assert.equal(Number(newEastEdgeTile.image), 40, 'expected wrapped east-edge grassland tile to use recomputed wrapped-neighbor sprite image');
});

test('BIQ map: width-only resize keeps terrain lookups on valid staggered-grid coordinates', () => {
  const raw = fs.readFileSync(getStableMapUnitsFixturePath());
  const parsedBefore = parseAllSections(raw);
  assert.equal(parsedBefore.ok, true, 'expected source BIQ to parse');
  const wmapBefore = getSection({ sections: parsedBefore.sections }, 'WMAP');
  const tileBefore = getSection({ sections: parsedBefore.sections }, 'TILE');
  assert.ok(wmapBefore && tileBefore, 'expected source BIQ map sections');
  const sourceWidth = Number(wmapBefore.records[0].width);
  const sourceHeight = Number(wmapBefore.records[0].height);

  const resizeResult = applyEdits(raw, [{
    op: 'resizemap',
    width: sourceWidth + 10,
    height: sourceHeight
  }]);
  assert.equal(resizeResult.ok, true, String(resizeResult.error || 'width-only resize save failed'));

  const parsedAfter = parseAllSections(resizeResult.buffer);
  assert.equal(parsedAfter.ok, true, 'expected width-only resized BIQ to parse');
  const resizedWmap = getSection({ sections: parsedAfter.sections }, 'WMAP');
  const resizedTileSection = getSection({ sections: parsedAfter.sections }, 'TILE');
  assert.equal(Number(resizedWmap.records[0].width), sourceWidth + 10);
  assert.equal(Number(resizedWmap.records[0].height), sourceHeight);

  const seaCode = 12;
  const nonSeaTiles = (resizedTileSection.records || []).filter((record) => (
    (getRecordInt(record, 'c3cbaserealterrain', getRecordInt(record, 'baserealterrain', -1)) & 0x0f) !== seaCode
  ));
  assert.ok(nonSeaTiles.length > 0, 'expected width-only resize to preserve some non-sea terrain instead of degenerating to an all-sea map');
});

test('BIQ map: resize fill terrain propagates into new edge tiles', () => {
  const raw = fs.readFileSync(getStableLeadNoMapFixturePath());
  const blankSections = buildGeneratedBlankMapSections(16, 16);
  const setMapResult = applyEdits(raw, [{
    op: 'setmap',
    sections: blankSections,
    allowSetmapGeneration: true
  }], {
    allowSetmapGeneration: true
  });
  assert.equal(setMapResult.ok, true, String(setMapResult.error || 'failed to seed blank map'));

  const resizeResult = applyEdits(setMapResult.buffer, [{
    op: 'resizemap',
    width: 18,
    height: 16,
    fillTerrain: 1
  }]);
  assert.equal(resizeResult.ok, true, String(resizeResult.error || 'resize save failed'));

  const resizedParsed = parseAllSections(resizeResult.buffer);
  assert.equal(resizedParsed.ok, true, 'expected resized blank map to parse');
  const resizedTileSection = getSection({ sections: resizedParsed.sections }, 'TILE');
  const newEdgeTile = getParsedTileAtCoords(resizedTileSection, 17, 3);
  assert.ok(newEdgeTile, 'expected new edge tile after resize');
  assert.equal(Number(newEdgeTile.c3cBaseRealTerrain) & 0x0f, 1, 'expected new resize space to honor the chosen fill terrain');
});

test('BIQ map: resizing desert terrain does not remap stored sprites to tundra', () => {
  const raw = fs.readFileSync(getStableLeadNoMapFixturePath());
  const blankSections = buildGeneratedBlankMapSections(16, 16);
  const tileSection = blankSections.find((section) => section && section.code === 'TILE');
  assert.ok(tileSection && Array.isArray(tileSection.records), 'expected generated TILE section');
  tileSection.records.forEach((record) => {
    const baseField = getRecordField(record, 'baserealterrain');
    const c3cBaseField = getRecordField(record, 'c3cbaserealterrain');
    const fileField = getRecordField(record, 'file');
    const imageField = getRecordField(record, 'image');
    assert.ok(baseField && c3cBaseField && fileField && imageField, 'expected generated desert test tile fields');
    baseField.value = '0';
    c3cBaseField.value = '0';
    fileField.value = '4';
    imageField.value = '0';
  });

  const setMapResult = applyEdits(raw, [{
    op: 'setmap',
    sections: blankSections,
    allowSetmapGeneration: true
  }], {
    allowSetmapGeneration: true
  });
  assert.equal(setMapResult.ok, true, String(setMapResult.error || 'failed to seed desert map'));

  const resizeResult = applyEdits(setMapResult.buffer, [{
    op: 'resizemap',
    width: 18,
    height: 16,
    fillTerrain: 0
  }]);
  assert.equal(resizeResult.ok, true, String(resizeResult.error || 'desert resize save failed'));

  const resizedParsed = parseAllSections(resizeResult.buffer);
  assert.equal(resizedParsed.ok, true, 'expected resized desert BIQ to parse');
  const resizedTileSection = getSection({ sections: resizedParsed.sections }, 'TILE');
  const interiorDesertTile = getParsedTileAtCoords(resizedTileSection, 5, 3);
  const newEdgeDesertTile = getParsedTileAtCoords(resizedTileSection, 16, 2);
  assert.ok(interiorDesertTile, 'expected preserved interior desert tile after resize');
  assert.ok(newEdgeDesertTile, 'expected new desert edge tile after resize');

  [interiorDesertTile, newEdgeDesertTile].forEach((tile, index) => {
    assert.equal(
      Number(tile.c3cbaserealterrain) & 0x0f,
      0,
      `expected desert tile ${index} to keep desert terrain id 0 instead of tundra 3`
    );
    assert.notEqual(Number(tile.file), 0, `expected desert tile ${index} to avoid tundra terrain atlas file 0`);
  });
});

test('BIQ map: shrinking dimensions removes out-of-bounds entities and still saves a valid BIQ', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle.tabs.map;
  const sections = getMapSectionsOrSkip(t, mapTab);
  if (!sections) return;
  const { tileSection, citySection, unitSection } = sections;
  const slocSection = getSection(mapTab, 'SLOC');
  const wmapSection = getSection(mapTab, 'WMAP');
  assert.ok(slocSection && wmapSection, 'expected SLOC and WMAP sections for shrink test');
  const wmapRecord = wmapSection.records[0];
  const originalWidth = getRecordInt(wmapRecord, 'width', 0);
  const originalHeight = getRecordInt(wmapRecord, 'height', 0);
  const edgeTile = (tileSection.records || []).find((tile) => {
    const x = getRecordInt(tile, 'xpos', -1);
    const y = getRecordInt(tile, 'ypos', -1);
    return x <= 1 && y <= 1 && getRecordInt(tile, 'city', -1) < 0;
  });
  assert.ok(edgeTile, 'expected edge tile for shrink test');
  const edgeX = getRecordInt(edgeTile, 'xpos', -1);
  const edgeY = getRecordInt(edgeTile, 'ypos', -1);
  const seededCity = addSeedCity(mapTab, citySection, edgeTile, 'Shrink Seed City');
  const seededUnit = addSeedUnit(mapTab, unitSection, edgeTile, 0, 2, 0, 'shrink');
  const seededSloc = addSeedStartingLocation(mapTab, slocSection, edgeX, edgeY, 0, 3, 'shrink');
  assert.ok(seededSloc && seededSloc.created, 'expected seeded starting location');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed shrink entities'));

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const seededMap = seededReload.tabs.map;
  const seededWmap = getSection(seededMap, 'WMAP');
  const seededWidthField = getRecordField(seededWmap.records[0], 'width');
  const seededHeightField = getRecordField(seededWmap.records[0], 'height');
  seededWidthField.value = String(originalWidth - 2);
  seededHeightField.value = String(originalHeight - 2);

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'shrink save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = reloaded.tabs.map;
  const reWmap = getSection(reMap, 'WMAP');
  const reTileSection = getSection(reMap, 'TILE');
  const reCitySection = getSection(reMap, 'CITY');
  const reUnitSection = getSection(reMap, 'UNIT');
  const reSlocSection = getSection(reMap, 'SLOC');
  assert.equal(getRecordInt(reWmap.records[0], 'width', 0), originalWidth - 2);
  assert.equal(getRecordInt(reWmap.records[0], 'height', 0), originalHeight - 2);
  assert.equal((reCitySection.records || []).some((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === seededCity.name), false, 'expected out-of-bounds city to be removed');
  assert.equal((reUnitSection.records || []).some((record) => getRecordInt(record, 'x', -1) === seededUnit.x && getRecordInt(record, 'y', -1) === seededUnit.y), false, 'expected out-of-bounds unit to be removed');
  assert.equal(getRecordsAtCoords(reSlocSection, edgeX, edgeY).length, 0, 'expected out-of-bounds starting location to be removed');
  assertMapReferenceIntegrityFromMapTab(reMap, 'expected shrunken map to remain reference-safe after trimming out-of-bounds entities');
});

test('BIQ map: city delete round-trip preserves surviving tile references', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const resolvedCiv3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: resolvedCiv3Root, scenarioPath: scenarioBiq });
  const seededState = seedStableFixtureCitiesOrSkip(t, bundle);
  if (!seededState) return;
  const seedSaveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: resolvedCiv3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed cities'));

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: resolvedCiv3Root, scenarioPath: scenarioBiq });
  const mapTab = seededReload.tabs.map;
  const sections = getMapSectionsOrSkip(t, mapTab);
  if (!sections) return;
  const { tileSection, citySection } = sections;
  const cityRecords = Array.isArray(citySection.records) ? citySection.records : [];
  const tileRecords = Array.isArray(tileSection.records) ? tileSection.records : [];
  const deletedIndex = cityRecords.findIndex((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Seed Delete City A');
  const survivorIndex = cityRecords.findIndex((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Seed Delete City C');
  const deleted = deletedIndex >= 0 ? cityRecords[deletedIndex] : null;
  const survivor = survivorIndex >= 0 ? cityRecords[survivorIndex] : null;
  assert.ok(deleted, 'expected seeded delete city after seed save');
  assert.ok(survivor, 'expected seeded survivor city after seed save');

  const survivorName = 'Seed Delete City C';
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  mapTab.recordOps.push({ op: 'delete', sectionCode: 'CITY', recordRef: `@INDEX:${deletedIndex}` });
  citySection.records = cityRecords.filter((record) => record !== deleted);
  tileRecords.forEach((tile) => {
    if (getRecordInt(tile, 'city', -1) !== deletedIndex) return;
    const cityField = getRecordField(tile, 'city');
    if (cityField) cityField.value = '-1';
    tile.city = -1;
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: resolvedCiv3Root,
    scenarioPath: scenarioBiq,
    tabs: seededReload.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: resolvedCiv3Root, scenarioPath: scenarioBiq });
  const reMap = reloaded.tabs.map;
  const reCitySection = getSection(reMap, 'CITY');
  const reSurvivor = (reCitySection.records || []).find((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === survivorName);
  assert.ok(reSurvivor, `expected survivor city ${survivorName} after delete/save`);
  assertMapReferenceIntegrityFromMapTab(reMap, 'expected all tile city/colony references to stay valid after city delete round-trip');
});

test('BIQ map: city delete only changes CITY and TILE sections', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const openTile = (sections.tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for city-delete parity test');
  addSeedCity(bundle.tabs.map, sections.citySection, openTile, 'Parity Delete City');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed delete city'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = seededReload.tabs.map;
  const reCitySection = getSection(reMap, 'CITY');
  const reTileSection = getSection(reMap, 'TILE');
  const city = (reCitySection.records || []).find((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Parity Delete City');
  assert.ok(city, 'expected seeded delete city after reload');
  const cityIndex = Number(city.index);
  assert.ok(Number.isFinite(cityIndex), 'expected finite city index for delete test');
  if (!Array.isArray(reMap.recordOps)) reMap.recordOps = [];
  reMap.recordOps.push({ op: 'delete', sectionCode: 'CITY', recordRef: `@INDEX:${cityIndex}` });
  reCitySection.records = (reCitySection.records || []).filter((record) => record !== city);
  (reTileSection.records || []).forEach((tile) => {
    if (getRecordInt(tile, 'city', -1) !== cityIndex) return;
    mapCore.setField(tile, 'city', '-1', 'City');
  });

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'CITY']);
});

test('BIQ map: scenario district sidecar round-trips entries and named tiles', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioDir = path.join(tmp, 'scenario');
  fs.mkdirSync(c3x, { recursive: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(scenarioDir, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  assert.ok(mapTab && mapTab.scenarioDistricts, 'expected scenario map metadata');
  mapTab.scenarioDistricts.entries = [{ x: 126, y: 2, district: 'Neighborhood', wonderName: '', wonderCity: '' }];
  mapTab.scenarioDistricts.namedTiles = [{ x: 126, y: 2, name: 'Test Named Tile' }];

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const sidecarPath = path.join(scenarioDir, 'scenario.districts.txt');
  assert.equal(fs.existsSync(sidecarPath), true, 'expected scenario.districts.txt to be created');
  const sidecarText = fs.readFileSync(sidecarPath, 'utf8');
  assert.match(sidecarText, /district\s*=\s*Neighborhood/);
  assert.match(sidecarText, /#NamedTile/);
  assert.match(sidecarText, /name\s*=\s*Test Named Tile/);
});

test('BIQ map: sidecar-only district edit changes no BIQ map sections', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioDir = path.join(tmp, 'scenario');
  fs.mkdirSync(c3x, { recursive: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(scenarioDir, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  const before = parseBiqFileForRawSections(scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  assert.ok(mapTab && mapTab.scenarioDistricts, 'expected scenario map metadata');
  mapTab.scenarioDistricts.entries = [{ x: 126, y: 2, district: 'Neighborhood', wonderName: '', wonderCity: '' }];
  mapTab.scenarioDistricts.namedTiles = [{ x: 126, y: 2, name: 'Parity Named Tile' }];

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), []);
});

test('BIQ map: colony overlay/type mismatches are detectable', () => {
  const issues = collectColonyOverlayCoherenceIssues({
    sections: [
      { code: 'TILE', records: [{ index: 0, colony: 0, c3cOverlays: 0x40000000 }] },
      { code: 'CLNY', records: [{ index: 0, x: 0, y: 0, improvementType: 0 }] }
    ]
  });
  assert.ok(issues.some((issue) => issue.kind === 'colony-overlay-type-mismatch' && issue.overlayType === 2 && issue.improvementType === 0), `expected colony overlay/type mismatch, got ${JSON.stringify(issues)}`);
});

test('BIQ map: civilization delete is blocked by concrete player and map ownership refs', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioDir = path.join(tmp, 'scenario');
  fs.mkdirSync(c3x, { recursive: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(scenarioDir, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  const sections = getMapSectionsOrSkip({ skip() {} }, mapTab);
  assert.ok(sections, 'expected stable fixture map sections');
  const { tileSection, citySection } = sections;
  const openTile = (tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected an empty tile for seeded civ-owned city');
  addSeedCity(mapTab, citySection, openTile, 'Seed Civ-Owned City', 1, 2);

  const civEntries = (bundle.tabs.civilizations && bundle.tabs.civilizations.entries) || [];
  const egyptEntry = civEntries.find((entry) => Number(entry && entry.biqIndex) === 1);
  assert.ok(egyptEntry, 'expected fixture civilization at index 1');

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      map: mapTab,
      civilizations: {
        recordOps: [{ op: 'delete', recordRef: String(egyptEntry.civilopediaKey || '').toUpperCase() }]
      }
    }
  });

  assert.equal(saveResult.ok, false);
  assert.match(String(saveResult.error || ''), /Cannot save yet because deleted items are still in use\./);
  assert.match(String(saveResult.error || ''), /Cities: Seed Civ-Owned City/);
  assert.match(String(saveResult.error || ''), /Players:/);
});

test('BIQ map: whole-map replacement is blocked outside generated-map saves', () => {
  const parsed = parseBiqFileForRawSections(getStableMapUnitsFixturePath());
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');
  const tileSection = (parsed.sections || []).find((section) => section.code === 'TILE');
  assert.ok(tileSection, 'expected TILE section in stable fixture');
  const result = applyEdits(Buffer.concat([
    parsed._headerBuf,
    ...parsed.sections.map((section) => serializeSection(section, parsed.io))
  ]), [{
    op: 'setmap',
    sections: [tileSection]
  }], {});
  assert.equal(result.ok, false, 'expected whole-map replacement to be rejected');
  assert.match(String(result.error || ''), /Whole-map BIQ replacement is blocked/i);
});

test('BIQ map: end-to-end save rejects whole-map replacement without explicit generated-map source', () => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected map tab for no-map fixture');
  assert.equal(bundle.tabs.map.hasMapData, false, 'expected no-map fixture to start without map data');

  bundle.tabs.map.sections = buildGeneratedBlankMapSections(16, 16);
  bundle.tabs.map.mapMutation = 'set';
  bundle.tabs.map.mapMutationSource = null;

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, false, 'expected ordinary whole-map replacement save to fail');
  assert.match(String(saveResult.error || ''), /Whole-map BIQ replacement is blocked/i);
});

test('BIQ map: explicit custom generated-map save can replace all map sections end-to-end', () => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(before.ok, true, 'expected no-map fixture parse before generated-map save');
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected map tab for no-map fixture');
  assert.equal(bundle.tabs.map.hasMapData, false, 'expected no-map fixture to start without map data');

  bundle.tabs.map.sections = buildGeneratedBlankMapSections(16, 16);
  bundle.tabs.map.mapMutation = 'set';
  bundle.tabs.map.mapMutationSource = 'custom';

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'generated-map save failed'));

  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(after.ok, true, 'expected generated-map BIQ parse after save');
  const expectedMapCodes = DEFAULT_MAP_SECTION_CODES;
  const beforeSectionCodes = new Set((before.sections || []).map((section) => String(section && section.code || '').toUpperCase()));
  const afterSectionCodes = new Set((after.sections || []).map((section) => String(section && section.code || '').toUpperCase()));
  expectedMapCodes.forEach((code) => {
    assert.equal(beforeSectionCodes.has(code), false, `expected no-map fixture to omit ${code} before generated-map save`);
    assert.equal(afterSectionCodes.has(code), true, `expected generated-map save to create ${code}`);
  });
  assertNoMapReferenceIssues(after, 'expected generated-map save to keep map references coherent');
  assertNoColonyOverlayIssues(after, 'expected generated-map save to keep colony overlay coherence intact');
});

test('BIQ map: explicit imported whole-map save can replace all map sections end-to-end', () => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  const scenarioDistrictsPath = path.join(tmp, 'scenario.districts.txt');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.writeFileSync(
    scenarioDistrictsPath,
    [
      'DISTRICTS',
      '',
      '#District',
      'coordinates = 1,2',
      'district = Neighborhood',
      '',
      '#NamedTile',
      'coordinates = 1,2',
      'name = Old Named Tile',
      ''
    ].join('\n'),
    'utf8'
  );

  const before = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(before.ok, true, 'expected no-map fixture parse before imported-map save');
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected map tab for no-map fixture');
  assert.equal(bundle.tabs.map.hasMapData, false, 'expected no-map fixture to start without map data');
  assert.ok(bundle.tabs.map.scenarioDistricts, 'expected scenario district sidecar metadata');
  assert.equal(bundle.tabs.map.scenarioDistricts.entries.length, 1, 'expected loaded district sidecar entry before import');
  assert.equal(bundle.tabs.map.scenarioDistricts.namedTiles.length, 1, 'expected loaded named tile before import');

  bundle.tabs.map.sections = buildGeneratedBlankMapSections(16, 16);
  bundle.tabs.map.mapMutation = 'set';
  bundle.tabs.map.mapMutationSource = 'imported';

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'imported-map save failed'));

  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(after.ok, true, 'expected imported-map BIQ parse after save');
  const expectedMapCodes = DEFAULT_MAP_SECTION_CODES;
  const beforeSectionCodes = new Set((before.sections || []).map((section) => String(section && section.code || '').toUpperCase()));
  const afterSectionCodes = new Set((after.sections || []).map((section) => String(section && section.code || '').toUpperCase()));
  expectedMapCodes.forEach((code) => {
    assert.equal(beforeSectionCodes.has(code), false, `expected no-map fixture to omit ${code} before imported-map save`);
    assert.equal(afterSectionCodes.has(code), true, `expected imported-map save to create ${code}`);
  });
  assertNoMapReferenceIssues(after, 'expected imported-map save to keep map references coherent');
  assertNoColonyOverlayIssues(after, 'expected imported-map save to keep colony overlay coherence intact');
  const scenarioDistrictsText = fs.readFileSync(scenarioDistrictsPath, 'utf8');
  assert.match(scenarioDistrictsText, /^DISTRICTS\b/);
  assert.doesNotMatch(scenarioDistrictsText, /#District\b/);
  assert.doesNotMatch(scenarioDistrictsText, /#NamedTile\b/);
});

test('BIQ map: explicit removemap save removes all BIQ map sections end-to-end', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  const scenarioDistrictsPath = path.join(tmp, 'scenario.districts.txt');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.writeFileSync(
    scenarioDistrictsPath,
    [
      'DISTRICTS',
      '',
      '#District',
      'coordinates = 126,2',
      'district = Neighborhood',
      '',
      '#NamedTile',
      'coordinates = 126,2',
      'name = Test Named Tile',
      ''
    ].join('\n'),
    'utf8'
  );

  const before = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(before.ok, true, 'expected map fixture parse before removemap save');
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected map tab for map fixture');
  assert.equal(bundle.tabs.map.hasMapData, true, 'expected fixture to start with map data');

  bundle.tabs.map.mapMutation = 'remove';
  bundle.tabs.map.mapMutationSource = null;

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'removemap save failed'));

  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(after.ok, true, 'expected BIQ parse after removemap save');
  const removedMapCodes = DEFAULT_MAP_SECTION_CODES;
  const beforeSectionCodes = new Set((before.sections || []).map((section) => String(section && section.code || '').toUpperCase()));
  const afterSectionCodes = new Set((after.sections || []).map((section) => String(section && section.code || '').toUpperCase()));
  removedMapCodes.forEach((code) => {
    assert.equal(beforeSectionCodes.has(code), true, `expected original fixture to contain ${code}`);
    assert.equal(afterSectionCodes.has(code), false, `expected removemap save to remove ${code}`);
  });
  const scenarioDistrictsText = fs.readFileSync(scenarioDistrictsPath, 'utf8');
  assert.match(scenarioDistrictsText, /^DISTRICTS\b/);
  assert.doesNotMatch(scenarioDistrictsText, /#District\b/);
  assert.doesNotMatch(scenarioDistrictsText, /#NamedTile\b/);

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.ok(reloaded && reloaded.tabs && reloaded.tabs.map, 'expected map tab after removemap reload');
  assert.equal(reloaded.tabs.map.hasMapData, false, 'expected removemap save to reload without map data');
});

test('BIQ map: edited save preserves untouched structural map sections', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const resolvedCiv3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: resolvedCiv3Root, scenarioPath: scenarioBiq });
  const seededState = seedStableFixtureCitiesOrSkip(t, bundle);
  if (!seededState) return;
  const seedSaveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: resolvedCiv3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed cities'));

  const before = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(before.ok, true, 'expected seeded BIQ parse before delete');

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: resolvedCiv3Root, scenarioPath: scenarioBiq });
  const mapTab = seededReload.tabs.map;
  const sections = getMapSectionsOrSkip(t, mapTab);
  if (!sections) return;
  const { tileSection, citySection } = sections;
  const cityRecords = Array.isArray(citySection.records) ? citySection.records : [];
  const tileRecords = Array.isArray(tileSection.records) ? tileSection.records : [];
  const deletedIndex = cityRecords.findIndex((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Seed Delete City A');
  const deleted = deletedIndex >= 0 ? cityRecords[deletedIndex] : null;
  assert.ok(deleted, 'expected seeded city delete candidate');
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  mapTab.recordOps.push({ op: 'delete', sectionCode: 'CITY', recordRef: `@INDEX:${deletedIndex}` });
  citySection.records = cityRecords.filter((record) => record !== deleted);
  tileRecords.forEach((tile) => {
    if (getRecordInt(tile, 'city', -1) !== deletedIndex) return;
    const cityField = getRecordField(tile, 'city');
    if (cityField) cityField.value = '-1';
    tile.city = -1;
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: resolvedCiv3Root,
    scenarioPath: scenarioBiq,
    tabs: seededReload.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(after.ok, true, 'expected edited seeded BIQ parse');

  ['WCHR', 'WMAP', 'CONT', 'SLOC'].forEach((code) => {
    const left = (before.sections || []).find((section) => section.code === code);
    const right = (after.sections || []).find((section) => section.code === code);
    assert.ok(left && right, `expected ${code} section before and after edit`);
    assert.deepEqual(
      serializeSection(left, before.io),
      serializeSection(right, after.io),
      `expected untouched ${code} section bytes to remain stable after city delete`
    );
  });
});

test('BIQ map: add city only changes CITY and TILE sections', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const { tileSection, citySection } = sections;
  const openTile = (tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for add-city parity test');
  addSeedCity(bundle.tabs.map, citySection, openTile, 'Parity Add City');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'CITY']);
});

test('BIQ map: tile terrain and overlay edit only changes TILE section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const tile = (sections.tileSection.records || [])[0];
  assert.ok(tile, 'expected tile for TILE-only parity test');
  mapCore.applyTerrain(sections.tileSection.records, [tile.index], 7);
  mapCore.applyOverlay(sections.tileSection.records, [tile.index], 'road', true);

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE']);
});

test('BIQ map: tile fog, ruin, and victory-point edits only change TILE section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const tile = (sections.tileSection.records || [])[0];
  assert.ok(tile, 'expected tile for scalar TILE-only parity test');
  mapCore.applyFog(sections.tileSection.records, [tile.index], true);
  mapCore.applyOverlay(sections.tileSection.records, [tile.index], 'ruins', true);
  mapCore.applyOverlay(sections.tileSection.records, [tile.index], 'victorypoint', true);

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE']);
});

test('BIQ map: city rename only changes CITY section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const openTile = (sections.tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for city-rename parity test');
  addSeedCity(bundle.tabs.map, sections.citySection, openTile, 'Parity Seed City');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed city'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const seededCitySection = getSection(seededReload.tabs.map, 'CITY');
  const city = (seededCitySection.records || []).find((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Parity Seed City');
  assert.ok(city, 'expected seeded city for city-rename parity test');
  mapCore.setField(city, 'name', 'Parity Renamed City', 'Name');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['CITY']);
});

test('BIQ map: city relocation only changes CITY and TILE sections', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const openTiles = (sections.tileSection.records || []).filter((tile) => getRecordInt(tile, 'city', -1) < 0).slice(0, 2);
  assert.equal(openTiles.length >= 2, true, 'expected two empty tiles for city-relocation parity test');
  const seededCity = addSeedCity(bundle.tabs.map, sections.citySection, openTiles[0], 'Parity Relocate City');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed relocation city'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = seededReload.tabs.map;
  const reCitySection = getSection(reMap, 'CITY');
  const reTileSection = getSection(reMap, 'TILE');
  const city = (reCitySection.records || []).find((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Parity Relocate City');
  assert.ok(city, 'expected seeded relocation city after reload');
  const sourceTile = (reTileSection.records || []).find((tile) => getRecordInt(tile, 'xpos', -1) === seededCity.x && getRecordInt(tile, 'ypos', -1) === seededCity.y);
  const destinationTile = (reTileSection.records || []).find((tile) => getRecordInt(tile, 'xpos', -1) === getRecordInt(openTiles[1], 'xpos', -1) && getRecordInt(tile, 'ypos', -1) === getRecordInt(openTiles[1], 'ypos', -1));
  assert.ok(sourceTile, 'expected source tile for city relocation');
  assert.ok(destinationTile, 'expected destination tile for city relocation');
  const cityIndex = Number(city.index);
  mapCore.setField(city, 'x', String(getRecordInt(destinationTile, 'xpos', seededCity.x)), 'X');
  mapCore.setField(city, 'y', String(getRecordInt(destinationTile, 'ypos', seededCity.y)), 'Y');
  mapCore.setField(sourceTile, 'city', '-1', 'City');
  mapCore.setField(destinationTile, 'city', String(cityIndex), 'City');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'CITY']);
});

test('BIQ map: city improvements edit only changes CITY section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const openTile = (sections.tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for city-improvement parity test');
  addSeedCity(bundle.tabs.map, sections.citySection, openTile, 'Parity Improvement City');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed improvement city'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reCitySection = getSection(seededReload.tabs.map, 'CITY');
  const city = (reCitySection.records || []).find((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Parity Improvement City');
  assert.ok(city, 'expected seeded city for improvement parity test');
  mapCore.setField(city, 'numbuildings', '1', 'Number of Buildings');
  mapCore.setField(city, 'buildings', '0', 'Buildings');
  mapCore.setField(city, 'haswalls', 'true', 'Has Walls');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['CITY']);
});

test('BIQ map: add unit only changes UNIT section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const { tileSection, unitSection } = sections;
  const openTile = (tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected tile for add-unit parity test');
  addSeedUnit(bundle.tabs.map, unitSection, openTile, 1, 2, 0, 'parity');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['UNIT']);
});

test('BIQ map: unit field edit only changes UNIT section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const unit = (sections.unitSection.records || [])[0];
  assert.ok(unit, 'expected existing unit for unit-field parity test');
  const currentPrto = getRecordInt(unit, 'prtonumber', 0);
  mapCore.setField(unit, 'prtonumber', String(currentPrto === 0 ? 1 : 0), 'PRTO Number');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['UNIT']);
});

test('BIQ map: unit delete only changes UNIT section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const unit = (sections.unitSection.records || [])[0];
  assert.ok(unit, 'expected existing unit for unit-delete parity test');
  const unitIndex = Number(unit.index);
  assert.ok(Number.isFinite(unitIndex), 'expected finite unit index for delete test');
  if (!Array.isArray(bundle.tabs.map.recordOps)) bundle.tabs.map.recordOps = [];
  bundle.tabs.map.recordOps.push({ op: 'delete', sectionCode: 'UNIT', recordRef: `@INDEX:${unitIndex}` });
  sections.unitSection.records = (sections.unitSection.records || []).filter((record) => record !== unit);

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['UNIT']);
});

test('BIQ map: city owner transfer keeps colocated units coherent and only changes CITY and UNIT', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const openTile = (sections.tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for owner-transfer parity test');
  const seededCity = addSeedCity(bundle.tabs.map, sections.citySection, openTile, 'Parity Owner Transfer City', 0, 2);
  addSeedUnit(bundle.tabs.map, sections.unitSection, openTile, 0, 2, 0, 'owner_transfer_a');
  addSeedUnit(bundle.tabs.map, sections.unitSection, openTile, 0, 2, 1, 'owner_transfer_b');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed city/unit stack'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = seededReload.tabs.map;
  const reCitySection = getSection(reMap, 'CITY');
  const reUnitSection = getSection(reMap, 'UNIT');
  const city = getRecordsAtCoords(reCitySection, seededCity.x, seededCity.y)[0];
  assert.ok(city, 'expected seeded city after reload');
  const stackUnits = getRecordsAtCoords(reUnitSection, seededCity.x, seededCity.y);
  assert.equal(stackUnits.length >= 2, true, 'expected colocated seeded units after reload');

  mapCore.setField(city, 'ownertype', '2', 'Owner Type');
  mapCore.setField(city, 'owner', '1', 'Owner');
  stackUnits.forEach((unit) => {
    mapCore.setField(unit, 'ownertype', '2', 'Owner Type');
    mapCore.setField(unit, 'owner', '1', 'Owner');
  });

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['CITY', 'UNIT']);

  const finalReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const finalMap = finalReload.tabs.map;
  const finalCitySection = getSection(finalMap, 'CITY');
  const finalUnitSection = getSection(finalMap, 'UNIT');
  const finalCity = getRecordsAtCoords(finalCitySection, seededCity.x, seededCity.y)[0];
  assert.ok(finalCity, 'expected transferred city after final reload');
  assert.equal(getRecordInt(finalCity, 'ownertype', -1), 2);
  assert.equal(getRecordInt(finalCity, 'owner', -1), 1);
  const finalStackUnits = getRecordsAtCoords(finalUnitSection, seededCity.x, seededCity.y);
  assert.equal(finalStackUnits.length >= 2, true, 'expected transferred unit stack after final reload');
  finalStackUnits.forEach((unit) => {
    assert.equal(getRecordInt(unit, 'ownertype', -1), 2);
    assert.equal(getRecordInt(unit, 'owner', -1), 1);
  });
});

test('BIQ map: unit owner transfer keeps colocated city coherent and only changes UNIT and CITY', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const sections = getMapSectionsOrSkip(t, bundle.tabs.map);
  if (!sections) return;
  const openTile = (sections.tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for reciprocal owner-transfer parity test');
  const seededCity = addSeedCity(bundle.tabs.map, sections.citySection, openTile, 'Parity Reciprocal Owner City', 0, 2);
  addSeedUnit(bundle.tabs.map, sections.unitSection, openTile, 0, 2, 0, 'reciprocal_owner_transfer');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed reciprocal city/unit stack'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = seededReload.tabs.map;
  const reCitySection = getSection(reMap, 'CITY');
  const reUnitSection = getSection(reMap, 'UNIT');
  const city = getRecordsAtCoords(reCitySection, seededCity.x, seededCity.y)[0];
  assert.ok(city, 'expected seeded city after reload');
  const stackUnits = getRecordsAtCoords(reUnitSection, seededCity.x, seededCity.y);
  assert.equal(stackUnits.length >= 1, true, 'expected colocated seeded unit after reload');

  stackUnits.forEach((unit) => {
    mapCore.setField(unit, 'ownertype', '2', 'Owner Type');
    mapCore.setField(unit, 'owner', '1', 'Owner');
  });
  mapCore.setField(city, 'ownertype', '2', 'Owner Type');
  mapCore.setField(city, 'owner', '1', 'Owner');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['CITY', 'UNIT']);

  const finalReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const finalMap = finalReload.tabs.map;
  const finalCitySection = getSection(finalMap, 'CITY');
  const finalUnitSection = getSection(finalMap, 'UNIT');
  const finalCity = getRecordsAtCoords(finalCitySection, seededCity.x, seededCity.y)[0];
  assert.ok(finalCity, 'expected reciprocal transferred city after final reload');
  assert.equal(getRecordInt(finalCity, 'ownertype', -1), 2);
  assert.equal(getRecordInt(finalCity, 'owner', -1), 1);
  const finalStackUnits = getRecordsAtCoords(finalUnitSection, seededCity.x, seededCity.y);
  assert.equal(finalStackUnits.length >= 1, true, 'expected reciprocal transferred unit after final reload');
  finalStackUnits.forEach((unit) => {
    assert.equal(getRecordInt(unit, 'ownertype', -1), 2);
    assert.equal(getRecordInt(unit, 'owner', -1), 1);
  });
});

test('BIQ map: starting-location edit changes SLOC and matching TILE start flag only', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const slocSection = getSection(bundle.tabs.map, 'SLOC');
  assert.ok(slocSection, 'expected SLOC section');
  const result = addSeedStartingLocation(bundle.tabs.map, slocSection, 4, 4, 0, 3, 'parity');
  assert.ok(result && result.changed, 'expected starting-location mutation');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'SLOC']);
  const afterTile = getSection({ sections: after.sections }, 'TILE');
  assert.equal(parsedTileHasStartingLocationFlag(afterTile, 4, 4), true);
});

test('BIQ map: starting-location delete changes SLOC and matching TILE start flag only', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const slocSection = getSection(bundle.tabs.map, 'SLOC');
  assert.ok(slocSection, 'expected SLOC section');
  const seeded = addSeedStartingLocation(bundle.tabs.map, slocSection, 4, 4, 0, 3, 'delete_parity');
  assert.ok(seeded && seeded.changed, 'expected starting-location seed mutation');
  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed starting location'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = seededReload.tabs.map;
  const reSlocSection = getSection(reMap, 'SLOC');
  const slocRecords = Array.isArray(reSlocSection.records) ? reSlocSection.records : [];
  const idx = slocRecords.findIndex((record) => getRecordInt(record, 'x', -1) === 4 && getRecordInt(record, 'y', -1) === 4);
  assert.ok(idx >= 0, 'expected seeded starting location after reload');
  if (!Array.isArray(reMap.recordOps)) reMap.recordOps = [];
  reMap.recordOps.push({ op: 'delete', sectionCode: 'SLOC', recordRef: `@INDEX:${idx}` });
  reSlocSection.records = slocRecords.filter((_, recordIndex) => recordIndex !== idx);

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'SLOC']);
  const afterTile = getSection({ sections: after.sections }, 'TILE');
  assert.equal(parsedTileHasStartingLocationFlag(afterTile, 4, 4), false);
});

test('BIQ map: colony edit only changes CLNY and TILE sections', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const before = parseBiqFileForRawSections(scenarioBiq);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle.tabs.map;
  const tileSection = getSection(mapTab, 'TILE');
  const colonySection = getSection(mapTab, 'CLNY');
  assert.ok(tileSection && colonySection, 'expected TILE and CLNY sections');
  const openTile = (tileSection.records || []).find((tile) => getRecordInt(tile, 'colony', -1) < 0 && getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for colony parity test');
  addSeedColony(mapTab, colonySection, openTile, 1, 2, 2, 'parity');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'CLNY']);
});

test('BIQ map: colony-like overlay transition only changes CLNY and TILE sections', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const tileSection = getSection(bundle.tabs.map, 'TILE');
  const colonySection = getSection(bundle.tabs.map, 'CLNY');
  assert.ok(tileSection && colonySection, 'expected TILE and CLNY sections for colony-like transition test');
  const openTile = (tileSection.records || []).find((tile) => getRecordInt(tile, 'city', -1) < 0 && getRecordInt(tile, 'colony', -1) < 0);
  assert.ok(openTile, 'expected empty tile for colony-like transition test');
  addSeedColony(bundle.tabs.map, colonySection, openTile, 0, 2, 1, 'parity_colony_like_transition');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed colony-like transition colony'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = seededReload.tabs.map;
  const reTileSection = getSection(reMap, 'TILE');
  const reColonySection = getSection(reMap, 'CLNY');
  const colony = (reColonySection.records || []).find((record) => getRecordInt(record, 'x', -1) === getRecordInt(openTile, 'xpos', -1) && getRecordInt(record, 'y', -1) === getRecordInt(openTile, 'ypos', -1));
  const tile = (reTileSection.records || []).find((record) => getRecordInt(record, 'xpos', -1) === getRecordInt(openTile, 'xpos', -1) && getRecordInt(record, 'ypos', -1) === getRecordInt(openTile, 'ypos', -1));
  assert.ok(colony, 'expected seeded colony after reload');
  assert.ok(tile, 'expected seeded colony tile after reload');
  mapCore.setField(colony, 'improvementType', '2', 'Improvement Type');
  const currentOverlays = getRecordInt(tile, 'c3coverlays', 0) >>> 0;
  const cleared = currentOverlays & ~((0x20000000 | 0x40000000 | 0x80000000) >>> 0);
  mapCore.setField(tile, 'c3coverlays', String((cleared | 0x40000000) >>> 0), 'C3C Overlays');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'CLNY']);
});

test('BIQ map: colony owner edit only changes CLNY section', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle.tabs.map;
  const tileSection = getSection(mapTab, 'TILE');
  const colonySection = getSection(mapTab, 'CLNY');
  assert.ok(tileSection && colonySection, 'expected TILE and CLNY sections');
  const openTile = (tileSection.records || []).find((tile) => getRecordInt(tile, 'colony', -1) < 0 && getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for colony-owner parity test');
  const seeded = addSeedColony(mapTab, colonySection, openTile, 1, 2, 2, 'owner_parity');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed colony'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reColonySection = getSection(seededReload.tabs.map, 'CLNY');
  assert.ok(reColonySection, 'expected CLNY section after seed save');
  const colony = getRecordsAtCoords(reColonySection, seeded.x, seeded.y)[0];
  assert.ok(colony, 'expected seeded colony after reload');
  const currentOwner = getRecordInt(colony, 'owner', 0);
  mapCore.setField(colony, 'owner', String(currentOwner === 0 ? 1 : 0), 'Owner');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['CLNY']);
});

test('BIQ map: colony delete only changes CLNY and TILE sections', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle.tabs.map;
  const tileSection = getSection(mapTab, 'TILE');
  const colonySection = getSection(mapTab, 'CLNY');
  assert.ok(tileSection && colonySection, 'expected TILE and CLNY sections');
  const openTile = (tileSection.records || []).find((tile) => getRecordInt(tile, 'colony', -1) < 0 && getRecordInt(tile, 'city', -1) < 0);
  assert.ok(openTile, 'expected empty tile for colony-delete parity test');
  const seeded = addSeedColony(mapTab, colonySection, openTile, 1, 2, 2, 'delete_parity');
  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed colony'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = seededReload.tabs.map;
  const reTileSection = getSection(reMap, 'TILE');
  const reColonySection = getSection(reMap, 'CLNY');
  const colonyRecords = Array.isArray(reColonySection.records) ? reColonySection.records : [];
  const idx = colonyRecords.findIndex((record) => getRecordInt(record, 'x', -1) === seeded.x && getRecordInt(record, 'y', -1) === seeded.y);
  assert.ok(idx >= 0, 'expected seeded colony after reload');
  if (!Array.isArray(reMap.recordOps)) reMap.recordOps = [];
  reMap.recordOps.push({ op: 'delete', sectionCode: 'CLNY', recordRef: `@INDEX:${idx}` });
  reColonySection.records = colonyRecords.filter((_, recordIndex) => recordIndex !== idx);
  (reTileSection.records || []).forEach((tile) => {
    if (getRecordInt(tile, 'colony', -1) !== idx) return;
    mapCore.setField(tile, 'colony', '-1', 'Colony');
  });

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['TILE', 'CLNY']);
});
