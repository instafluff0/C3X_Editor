'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { loadBundle, saveBundle } = require('../src/configCore');
const {
  applyEdits,
  parseAllSections,
  serializeSection,
  collectMapReferenceIntegrityIssues,
  collectColonyOverlayCoherenceIssues
} = require('../src/biq/biqSections');
const { decompress } = require('../src/biq/decompress');
const mapCore = require('../src/mapEditorCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-biq-map-critical-'));
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

function getRawSectionBytesByCode(parsed, codes = ['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY']) {
  const out = new Map();
  codes.forEach((code) => {
    const section = (parsed.sections || []).find((entry) => entry.code === code);
    assert.ok(section, `expected ${code} section`);
    out.set(code, serializeSection(section, parsed.io));
  });
  return out;
}

function getChangedSectionCodes(before, after, codes = ['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY']) {
  const beforeBytes = getRawSectionBytesByCode(before, codes);
  const afterBytes = getRawSectionBytesByCode(after, codes);
  return codes.filter((code) => !beforeBytes.get(code).equals(afterBytes.get(code)));
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
      createMapField('ownerType', owner, 'Owner Type'),
      createMapField('owner', owner, 'Owner'),
      createMapField('x', x, 'X'),
      createMapField('y', y, 'Y'),
      createMapField('improvementType', improvementType, 'Improvement Type')
    ]
  };
  record.fields[0].value = String(ownerType);
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
  const issues = collectMapReferenceIntegrityIssues(parsed);
  assert.deepEqual(issues, [], message || `expected valid map references, got ${JSON.stringify(issues)}`);
}

test('critical BIQ map: unchanged save preserves raw map section bytes', () => {
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

  ['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY'].forEach((code) => {
    const left = (before.sections || []).find((section) => section.code === code);
    const right = (after.sections || []).find((section) => section.code === code);
    assert.ok(left, `expected original ${code} section`);
    assert.ok(right, `expected saved ${code} section`);
    assert.deepEqual(
      serializeSection(left, before.io),
      serializeSection(right, after.io),
      `expected unchanged save to preserve raw ${code} section bytes`
    );
  });
});

test('critical BIQ map: city delete round-trip preserves surviving tile references', (t) => {
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

test('critical BIQ map: scenario district sidecar round-trips entries and named tiles', () => {
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

test('critical BIQ map: sidecar-only district edit changes no BIQ map sections', () => {
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

test('critical BIQ map: colony overlay/type mismatches are detectable', () => {
  const issues = collectColonyOverlayCoherenceIssues({
    sections: [
      { code: 'TILE', records: [{ index: 0, colony: 0, c3cOverlays: 0x40000000 }] },
      { code: 'CLNY', records: [{ index: 0, x: 0, y: 0, improvementType: 0 }] }
    ]
  });
  assert.ok(issues.some((issue) => issue.kind === 'colony-overlay-type-mismatch' && issue.overlayType === 2 && issue.improvementType === 0), `expected colony overlay/type mismatch, got ${JSON.stringify(issues)}`);
});

test('critical BIQ map: civilization delete is blocked by concrete player and map ownership refs', () => {
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

test('critical BIQ map: whole-map replacement is blocked outside generated-map saves', () => {
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

test('critical BIQ map: edited save preserves untouched structural map sections', (t) => {
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

test('critical BIQ map: add city only changes CITY and TILE sections', (t) => {
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

test('critical BIQ map: city rename only changes CITY section', (t) => {
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
  const city = (sections.citySection.records || [])[0];
  assert.ok(city, 'expected existing city for city-rename parity test');
  mapCore.setField(city, 'name', 'Parity Renamed City', 'Name');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['CITY']);
});

test('critical BIQ map: add unit only changes UNIT section', (t) => {
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

test('critical BIQ map: unit field edit only changes UNIT section', (t) => {
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

test('critical BIQ map: starting-location edit only changes SLOC section', () => {
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
  assert.deepEqual(getChangedSectionCodes(before, after), ['SLOC']);
});

test('critical BIQ map: colony edit only changes CLNY and TILE sections', (t) => {
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

test('critical BIQ map: colony owner edit only changes CLNY section', (t) => {
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
  addSeedColony(mapTab, colonySection, openTile, 1, 2, 2, 'owner_parity');

  const seedSaveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed colony'));
  const before = parseBiqFileForRawSections(scenarioBiq);

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reColonySection = getSection(seededReload.tabs.map, 'CLNY');
  assert.ok(reColonySection, 'expected CLNY section after seed save');
  const colony = (reColonySection.records || []).find((record) => getRecordInt(record, 'x', -1) === getRecordInt(openTile, 'xpos', -1)
    && getRecordInt(record, 'y', -1) === getRecordInt(openTile, 'ypos', -1));
  assert.ok(colony, 'expected seeded colony after reload');
  const currentOwner = getRecordInt(colony, 'owner', 0);
  mapCore.setField(colony, 'owner', String(currentOwner === 0 ? 1 : 0), 'Owner');

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: seededReload.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const after = parseBiqFileForRawSections(scenarioBiq);
  assert.deepEqual(getChangedSectionCodes(before, after), ['CLNY']);
});
