'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectBiqMapEdits,
  collectBiqMapRecordOps,
  collectBiqMapStructureOps,
  loadBundle,
  materializeMapTab,
  saveBundle
} = require('../src/configCore');
const {
  parseAllSections,
  collectMapReferenceIntegrityIssues,
  collectColonyOverlayCoherenceIssues,
  serializeSection
} = require('../src/biq/biqSections');
const { decompress } = require('../src/biq/decompress');
const mapCore = require('../src/mapEditorCore');

const CIV3_ROOT = path.resolve(__dirname, '..', '..');
const SCENARIOS_DIR = path.join(CIV3_ROOT, 'Scenarios');
const C3X_ROOT = path.join(CIV3_ROOT, 'C3X_Districts');
const CONQUESTS_BIQ = path.join(CIV3_ROOT, 'conquests.biq');
const AGE_OF_DISCOVERY_BIQ = path.join(SCENARIOS_DIR, '6 MP Age of Discovery.biq');
const WWII_PACIFIC_BIQ = path.join(SCENARIOS_DIR, '9 MP WWII in the Pacific.biq');
const STOCK_MAP_SCENARIOS = [
  '2 MP Rise of Rome.biq',
  '3 MP Fall of Rome.biq',
  '4 MP Middle Ages.biq',
  '5 MP Mesoamerica.biq',
  '6 MP Age of Discovery.biq',
  '7 MP Sengoku - Sword of the Shogun.biq',
  '8 MP Napoleonic Europe.biq',
  '9 MP WWII in the Pacific.biq'
];
const STOCK_NOOP_SAVE_SCENARIOS = STOCK_MAP_SCENARIOS.filter((fileName) => (
  fileName !== '7 MP Sengoku - Sword of the Shogun.biq'
));
const STOCK_NOOP_SECTION_CODES = [
  'GAME',
  'RACE',
  'PRTO',
  'TERR',
  'WMAP',
  'TILE',
  'CONT',
  'SLOC',
  'CITY',
  'UNIT',
  'CLNY'
];
const REFERENCE_TAB_FIELD_TARGETS = {
  civilizations: ['kingunit', 'favoritegovernment', 'shunnedgovernment', 'freetech1index', 'freetech2index'],
  technologies: ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4'],
  resources: ['prerequisite'],
  improvements: ['reqadvance', 'obsoleteby', 'reqresource1', 'reqresource2', 'reqgovernment', 'reqimprovement', 'unitproduced'],
  governments: ['prerequisitetechnology'],
  units: ['requiredtech', 'upgradeto', 'requiredresource1', 'requiredresource2', 'requiredresource3', 'enslaveresultsin', 'stealthtarget']
};
const LARGE_MAP_FIXTURES = [
  {
    label: 'Quint 100x100 desert blank map',
    fileName: '100x100_desert.biq'
  },
  {
    label: 'Firaxis 100x100 world blank map',
    fileName: '100x100_world_firaxis.biq'
  }
];

function getSection(tab, code) {
  const target = String(code || '').trim().toUpperCase();
  return (tab && Array.isArray(tab.sections) ? tab.sections : []).find((section) => (
    String(section && section.code || '').trim().toUpperCase() === target
  )) || null;
}

function getRecordField(record, key) {
  const target = String(key || '').trim().toLowerCase();
  return (Array.isArray(record && record.fields) ? record.fields : []).find((field) => (
    String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target
  )) || null;
}

function getEntryField(entry, key) {
  const target = String(key || '').trim().toLowerCase();
  const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
  return fields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target) || null;
}

function getEntryFields(entry, key) {
  const target = String(key || '').trim().toLowerCase();
  const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
  return fields.filter((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target);
}

function setEntryField(entry, key, value) {
  const field = getEntryField(entry, key);
  assert.ok(field, `expected ${key} field`);
  field.value = String(value);
  return field;
}

function getDirectRecordValue(record, key) {
  if (!record || typeof record !== 'object') return undefined;
  const target = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    const candidate = String(keys[i] || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candidate === target) return record[keys[i]];
  }
  return undefined;
}

function getStoredMapFieldValue(record, key, fallback = '') {
  const direct = getDirectRecordValue(record, key);
  if (direct != null) return String(direct);
  const field = getRecordField(record, key);
  if (!field) return String(fallback);
  if (field.mapEditorValueEdited) return String(field.value || '');
  const original = String(field.originalValue == null ? '' : field.originalValue).trim();
  if (original) return original;
  return String(field.value || '');
}

function getInterpretedMapIntField(record, key, fallback = 0) {
  return mapCore.parseIntLoose(getStoredMapFieldValue(record, key, String(fallback)), fallback);
}

function getFieldValue(record, key, fallback = '') {
  const field = getRecordField(record, key);
  return field ? String(field.value == null ? '' : field.value) : String(fallback);
}

function getEntryFieldValue(entry, key, fallback = '') {
  const field = getEntryField(entry, key);
  return field ? String(field.value == null ? '' : field.value) : String(fallback);
}

function setMapField(record, key, value, label) {
  mapCore.setField(record, key, String(value), label || key);
}

function copyFixtureBiq(sourcePath, label = 'biq') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `c3x-${label}-`));
  const scenarioPath = path.join(tmp, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, scenarioPath);
  fs.chmodSync(scenarioPath, 0o644);
  return scenarioPath;
}

function loadMaterializedMapBundle(scenarioPath) {
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath
  });
  assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected bundle to include a map tab');
  bundle.tabs.map = materializeMapTab({
    mode: 'scenario',
    biq: bundle.biq,
    mapTab: bundle.tabs.map,
    tabs: {
      districts: bundle.tabs.districts,
      naturalWonders: bundle.tabs.naturalWonders
    }
  });
  return bundle;
}

function parseBiqFileForRawSections(filePath) {
  const raw = fs.readFileSync(filePath);
  const inflated = decompress(raw);
  return parseAllSections(inflated.ok ? inflated.data : raw);
}

function getRawSection(parsed, code) {
  const target = String(code || '').toUpperCase();
  return (parsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === target) || null;
}

function getRawSectionBytesByCode(parsed, codes) {
  const out = new Map();
  codes.forEach((code) => {
    const section = getRawSection(parsed, code);
    if (section) out.set(code, serializeSection(section, parsed.io));
  });
  return out;
}

function getChangedSectionCodes(beforeParsed, afterParsed, codes = STOCK_NOOP_SECTION_CODES) {
  const beforeSections = getRawSectionBytesByCode(beforeParsed, codes);
  const afterSections = getRawSectionBytesByCode(afterParsed, codes);
  const changed = [];
  codes.forEach((code) => {
    const beforeBytes = beforeSections.get(code);
    const afterBytes = afterSections.get(code);
    if (!beforeBytes && !afterBytes) return;
    if (!beforeBytes || !afterBytes || !beforeBytes.equals(afterBytes)) changed.push(code);
  });
  return changed;
}

function withoutBaselineSections(changedCodes, baselineCodes) {
  const baseline = new Set((baselineCodes || []).map((code) => String(code || '').toUpperCase()));
  return (changedCodes || []).filter((code) => !baseline.has(String(code || '').toUpperCase()));
}

function getNoOpChangedSectionCodes(sourcePath, codes = STOCK_NOOP_SECTION_CODES) {
  const scenarioPath = copyFixtureBiq(sourcePath, 'noop-baseline-biq');
  const before = parseBiqFileForRawSections(scenarioPath);
  const bundle = loadMaterializedMapBundle(scenarioPath);
  const saveResult = saveBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, `${path.basename(sourcePath)} no-op baseline save failed: ${saveResult.error || ''}`);
  const after = parseBiqFileForRawSections(scenarioPath);
  return getChangedSectionCodes(before, after, codes);
}

function assertNoMapIntegrityIssues(filePath) {
  const parsed = parseBiqFileForRawSections(filePath);
  assert.deepEqual(
    collectMapReferenceIntegrityIssues(parsed),
    [],
    'expected saved BIQ map references to remain valid'
  );
  assert.deepEqual(
    collectColonyOverlayCoherenceIssues(parsed),
    [],
    'expected saved BIQ colony overlays to remain coherent'
  );
  return parsed;
}

function assertReferenceIndex(parsed, sectionCode, recordIndex, fieldName, value, maxExclusive, options = {}) {
  const sentinel = options.sentinel == null ? -1 : options.sentinel;
  if (value === sentinel) return;
  assert.ok(
    Number.isInteger(value) && value >= 0 && value < maxExclusive,
    `${sectionCode} ${recordIndex} ${fieldName} should reference 0..${maxExclusive - 1} or ${sentinel}, got ${value}`
  );
}

function assertBiqGlobalReferenceIntegrity(parsed) {
  const sectionRecords = (code) => {
    const section = getRawSection(parsed, code);
    return Array.isArray(section && section.records) ? section.records : [];
  };
  const techCount = sectionRecords('TECH').length;
  const resourceCount = sectionRecords('GOOD').length;
  const governmentCount = sectionRecords('GOVT').length;
  const improvementCount = sectionRecords('BLDG').length;
  const unitCount = sectionRecords('PRTO').length;

  sectionRecords('RACE').forEach((record, index) => {
    assertReferenceIndex(parsed, 'RACE', index, 'kingUnit', record.kingUnit, unitCount);
    assertReferenceIndex(parsed, 'RACE', index, 'favoriteGovernment', record.favoriteGovernment, governmentCount);
    assertReferenceIndex(parsed, 'RACE', index, 'shunnedGovernment', record.shunnedGovernment, governmentCount);
    (Array.isArray(record.freeTechs) ? record.freeTechs : []).forEach((value, slot) => {
      assertReferenceIndex(parsed, 'RACE', index, `freeTechs[${slot}]`, value, techCount);
    });
  });

  sectionRecords('TECH').forEach((record, index) => {
    (Array.isArray(record.prerequisites) ? record.prerequisites : []).forEach((value, slot) => {
      assertReferenceIndex(parsed, 'TECH', index, `prerequisites[${slot}]`, value, techCount);
    });
  });

  sectionRecords('GOOD').forEach((record, index) => {
    assertReferenceIndex(parsed, 'GOOD', index, 'prerequisite', record.prerequisite, techCount);
  });

  sectionRecords('GOVT').forEach((record, index) => {
    assertReferenceIndex(parsed, 'GOVT', index, 'prerequisiteTechnology', record.prerequisiteTechnology, techCount);
  });

  sectionRecords('BLDG').forEach((record, index) => {
    assertReferenceIndex(parsed, 'BLDG', index, 'reqAdvance', record.reqAdvance, techCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'obsoleteBy', record.obsoleteBy, techCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'reqResource1', record.reqResource1, resourceCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'reqResource2', record.reqResource2, resourceCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'reqGovernment', record.reqGovernment, governmentCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'reqImprovement', record.reqImprovement, improvementCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'doublesHappiness', record.doublesHappiness, improvementCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'gainInEveryCity', record.gainInEveryCity, improvementCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'gainOnContinent', record.gainOnContinent, improvementCount);
    assertReferenceIndex(parsed, 'BLDG', index, 'unitProduced', record.unitProduced, unitCount);
  });

  sectionRecords('PRTO').forEach((record, index) => {
    assertReferenceIndex(parsed, 'PRTO', index, 'requiredTech', record.requiredTech, techCount);
    assertReferenceIndex(parsed, 'PRTO', index, 'upgradeTo', record.upgradeTo, unitCount);
    assertReferenceIndex(parsed, 'PRTO', index, 'requiredResource1', record.requiredResource1, resourceCount);
    assertReferenceIndex(parsed, 'PRTO', index, 'requiredResource2', record.requiredResource2, resourceCount);
    assertReferenceIndex(parsed, 'PRTO', index, 'requiredResource3', record.requiredResource3, resourceCount);
    assertReferenceIndex(parsed, 'PRTO', index, 'enslaveResultsIn', record.enslaveResultsIn, unitCount);
    (Array.isArray(record.legalUnitTelepads) ? record.legalUnitTelepads : []).forEach((value, slot) => {
      assertReferenceIndex(parsed, 'PRTO', index, `legalUnitTelepads[${slot}]`, value, unitCount);
    });
    (Array.isArray(record.stealthTargets) ? record.stealthTargets : []).forEach((value, slot) => {
      assertReferenceIndex(parsed, 'PRTO', index, `stealthTargets[${slot}]`, value, unitCount);
    });
    (Array.isArray(record.legalBuildingTelepads) ? record.legalBuildingTelepads : []).forEach((value, slot) => {
      assertReferenceIndex(parsed, 'PRTO', index, `legalBuildingTelepads[${slot}]`, value, improvementCount);
    });
  });
}

function countFogVisibility(tileSection) {
  let fogged = 0;
  let visible = 0;
  (tileSection && Array.isArray(tileSection.records) ? tileSection.records : []).forEach((record) => {
    const fog = getInterpretedMapIntField(record, 'fogofwar', 1);
    if (fog === 0) fogged += 1;
    else visible += 1;
  });
  return { fogged, visible };
}

function expectedTileCountFromWmap(wmapSection) {
  const record = wmapSection && (wmapSection.records || [])[0];
  const width = getInterpretedMapIntField(record, 'width', 0);
  const height = getInterpretedMapIntField(record, 'height', 0);
  return Math.floor(width / 2) * height;
}

function countTrailingReferenceLabels(mapTab) {
  let checked = 0;
  let valid = 0;
  (mapTab.sections || []).forEach((section) => {
    (section.records || []).forEach((record) => {
      (record.fields || []).forEach((field) => {
        const value = String(field && field.value == null ? '' : field.value).trim();
        const match = value.match(/\((-?\d+)\)\s*$/);
        if (!match) return;
        checked += 1;
        const expected = Number.parseInt(match[1], 10);
        const actual = mapCore.parseIntLoose(value, NaN);
        if (actual === expected) valid += 1;
      });
    });
  });
  return { checked, valid };
}

function parseProjectedReferenceValue(value, fallback = -1) {
  const text = String(value == null ? '' : value).trim();
  if (!text || /^none$/i.test(text)) return -1;
  const trailing = text.match(/\((-?\d+)\)\s*$/);
  if (trailing) return Number.parseInt(trailing[1], 10);
  return mapCore.parseIntLoose(text, fallback);
}

function collectReferenceTabFieldSamples(bundle) {
  const samples = [];
  Object.entries(REFERENCE_TAB_FIELD_TARGETS).forEach(([tabKey, keys]) => {
    const entries = (bundle.tabs[tabKey] && bundle.tabs[tabKey].entries) || [];
    entries.forEach((entry) => {
      keys.forEach((key) => {
        getEntryFields(entry, key).forEach((field) => {
          const value = String(field && field.value == null ? '' : field.value).trim();
          if (!value || /^none$/i.test(value)) return;
          const parsed = parseProjectedReferenceValue(value, NaN);
          if (!Number.isFinite(parsed) || parsed < 0) return;
          samples.push({
            tabKey,
            key,
            value,
            labeled: /\((-?\d+)\)\s*$/.test(value)
          });
        });
      });
    });
  });
  return samples;
}

function assertParsedReferenceBounds(bundle) {
  const mapTab = bundle.tabs.map;
  const tileSection = getSection(mapTab, 'TILE');
  const citySection = getSection(mapTab, 'CITY');
  const unitSection = getSection(mapTab, 'UNIT');
  const colonySection = getSection(mapTab, 'CLNY');
  const slocSection = getSection(mapTab, 'SLOC');
  const contSection = getSection(mapTab, 'CONT');
  const resourceCount = ((bundle.tabs.resources && bundle.tabs.resources.entries) || []).length;
  const unitTypeCount = ((bundle.tabs.units && bundle.tabs.units.entries) || []).length;
  const cityCount = ((citySection && citySection.records) || []).length;
  const colonyCount = ((colonySection && colonySection.records) || []).length;
  const continentCount = ((contSection && contSection.records) || []).length;

  (tileSection.records || []).forEach((record, index) => {
    const resource = getInterpretedMapIntField(record, 'resource', -1);
    const continent = getInterpretedMapIntField(record, 'continent', -1);
    const city = getInterpretedMapIntField(record, 'city', -1);
    const colony = getInterpretedMapIntField(record, 'colony', -1);
    assert.ok(resource >= -1 && resource < resourceCount, `TILE ${index} resource reference should be in range`);
    assert.ok(continent >= 0 && continent < continentCount, `TILE ${index} continent reference should be in range`);
    assert.ok(city >= -1 && city < cityCount, `TILE ${index} city reference should be in range`);
    assert.ok(colony >= -1 && colony < colonyCount, `TILE ${index} colony reference should be in range`);
    const fog = getInterpretedMapIntField(record, 'fogofwar', 1);
    assert.ok(fog === 0 || fog === 1, `TILE ${index} fog flag should parse to a boolean numeric flag`);
  });

  (unitSection.records || []).forEach((record, index) => {
    const prtoNumber = getInterpretedMapIntField(record, 'prtonumber', -1);
    assert.ok(prtoNumber >= 0 && prtoNumber < unitTypeCount, `UNIT ${index} PRTO reference should be in range`);
  });

  [citySection, unitSection, colonySection, slocSection].forEach((section) => {
    (section.records || []).forEach((record, index) => {
      const ownerType = getInterpretedMapIntField(record, 'ownertype', -1);
      const owner = getInterpretedMapIntField(record, 'owner', -1);
      assert.ok(ownerType >= 0, `${section.code} ${index} owner type should parse numerically`);
      assert.ok(Number.isFinite(owner), `${section.code} ${index} owner should parse numerically`);
    });
  });
}

function getIntField(record, key, fallback = 0) {
  const field = getRecordField(record, key);
  const match = String(field && field.value != null ? field.value : '').match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

LARGE_MAP_FIXTURES.forEach(({ label, fileName }) => {
  test(`fixture-backed BIQ load parity: ${label}`, (t) => {
    const scenarioPath = path.join(SCENARIOS_DIR, fileName);
    if (!fs.existsSync(scenarioPath)) {
      t.skip(`Missing BIQ fixture: ${scenarioPath}`);
      return;
    }
    const bundle = loadBundle({
      mode: 'scenario',
      civ3Path: CIV3_ROOT,
      scenarioPath
    });
    assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected bundle to include a map tab');
    const mapTab = materializeMapTab({
      mode: 'scenario',
      biq: bundle.biq,
      mapTab: bundle.tabs.map,
      tabs: {
        districts: bundle.tabs.districts,
        naturalWonders: bundle.tabs.naturalWonders
      }
    });
    const wmap = getSection(mapTab, 'WMAP');
    const tile = getSection(mapTab, 'TILE');
    assert.ok(wmap, 'expected WMAP section');
    assert.ok(tile, 'expected TILE section');
    assert.equal(getIntField((wmap.records || [])[0], 'width', -1), 100, 'expected 100-tile map width');
    assert.equal(getIntField((wmap.records || [])[0], 'height', -1), 100, 'expected 100-tile map height');
    assert.equal((tile.records || []).length, 5000, 'expected Quint/Firaxis 100x100 BIQs to contain 5000 TILE records');
  });
});

test('fixture-backed BIQ semantic matrix: stock map references and booleans parse from projected labels', (t) => {
  const existing = STOCK_MAP_SCENARIOS
    .map((fileName) => path.join(SCENARIOS_DIR, fileName))
    .filter((scenarioPath) => fs.existsSync(scenarioPath));
  if (existing.length === 0) {
    t.skip('Missing stock BIQ map fixtures.');
    return;
  }

  existing.forEach((scenarioPath) => {
    const bundle = loadMaterializedMapBundle(scenarioPath);
    const mapTab = bundle.tabs.map;
    const wmap = getSection(mapTab, 'WMAP');
    const tile = getSection(mapTab, 'TILE');
    assert.ok(wmap, `${path.basename(scenarioPath)} should include WMAP`);
    assert.ok(tile, `${path.basename(scenarioPath)} should include TILE`);
    assert.equal(
      (tile.records || []).length,
      expectedTileCountFromWmap(wmap),
      `${path.basename(scenarioPath)} TILE count should match WMAP dimensions`
    );
    assertParsedReferenceBounds(bundle);
    const referenceLabels = countTrailingReferenceLabels(mapTab);
    assert.ok(referenceLabels.checked > 0, `${path.basename(scenarioPath)} should include projected reference labels`);
    assert.equal(
      referenceLabels.valid,
      referenceLabels.checked,
      `${path.basename(scenarioPath)} projected reference labels should parse to trailing BIQ ids`
    );
  });
});

test('fixture-backed BIQ reference tabs parse projected labels with trailing ids outside the map editor', (t) => {
  if (!fs.existsSync(CONQUESTS_BIQ)) {
    t.skip(`Missing BIQ fixture: ${CONQUESTS_BIQ}`);
    return;
  }
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath: CONQUESTS_BIQ
  });
  const samples = collectReferenceTabFieldSamples(bundle);
  assert.ok(samples.length > 0, 'expected reference-tab projected field samples');

  Object.keys(REFERENCE_TAB_FIELD_TARGETS).forEach((tabKey) => {
    assert.ok(samples.some((sample) => sample.tabKey === tabKey), `expected ${tabKey} reference-field samples`);
  });
  ['civilizations', 'technologies', 'resources', 'governments', 'units'].forEach((tabKey) => {
    assert.ok(samples.some((sample) => sample.tabKey === tabKey && sample.labeled), `expected ${tabKey} display-label samples`);
  });

  samples.forEach((sample) => {
    assert.equal(
      mapCore.parseIntLoose(sample.value, NaN),
      parseProjectedReferenceValue(sample.value, NaN),
      `${sample.tabKey}.${sample.key} should parse projected BIQ value ${sample.value} to the stored id`
    );
  });
});

test('fixture-backed BIQ no-op save: stock scenarios keep map sections unchanged and reference-integrity valid', (t) => {
  const existing = STOCK_NOOP_SAVE_SCENARIOS
    .map((fileName) => path.join(SCENARIOS_DIR, fileName))
    .filter((scenarioPath) => fs.existsSync(scenarioPath));
  if (existing.length === 0) {
    t.skip('Missing stock BIQ map fixtures.');
    return;
  }

  existing.forEach((sourcePath) => {
    const scenarioPath = copyFixtureBiq(sourcePath, 'stock-noop-biq');
    const beforeParsed = parseBiqFileForRawSections(scenarioPath);
    const beforeSections = getRawSectionBytesByCode(beforeParsed, ['WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY']);
    const bundle = loadMaterializedMapBundle(scenarioPath);

    const saveResult = saveBundle({
      mode: 'scenario',
      civ3Path: CIV3_ROOT,
      c3xPath: C3X_ROOT,
      scenarioPath,
      tabs: bundle.tabs
    });
    assert.equal(saveResult.ok, true, `${path.basename(sourcePath)} no-op save failed: ${saveResult.error || ''}`);

    const afterParsed = parseBiqFileForRawSections(scenarioPath);
    beforeSections.forEach((beforeBytes, code) => {
      const afterSection = getRawSection(afterParsed, code);
      assert.ok(afterSection, `${path.basename(sourcePath)} should keep ${code} section`);
      assert.deepEqual(
        serializeSection(afterSection, afterParsed.io),
        beforeBytes,
        `${path.basename(sourcePath)} no-op save should preserve ${code} bytes`
      );
    });
    assert.deepEqual(collectMapReferenceIntegrityIssues(afterParsed), [], `${path.basename(sourcePath)} no-op save should keep map references valid`);
    assert.deepEqual(collectColonyOverlayCoherenceIssues(afterParsed), [], `${path.basename(sourcePath)} no-op save should keep colony overlays coherent`);
    assertBiqGlobalReferenceIntegrity(afterParsed);
  });
});

test('fixture-backed BIQ section isolation: stock WWII single-field map edits touch only their owning section', (t) => {
  if (!fs.existsSync(WWII_PACIFIC_BIQ)) {
    t.skip(`Missing BIQ fixture: ${WWII_PACIFIC_BIQ}`);
    return;
  }
  const noOpChangedSections = getNoOpChangedSectionCodes(WWII_PACIFIC_BIQ);

  const cases = [
    {
      label: 'WMAP mapseed',
      sectionCode: 'WMAP',
      expectedChanged: ['WMAP'],
      edit: (sections) => {
        const record = (sections.WMAP.records || [])[0];
        setMapField(record, 'mapseed', getInterpretedMapIntField(record, 'mapseed', 0) + 1, 'Map Seed');
      }
    },
    {
      label: 'TILE fogofwar',
      sectionCode: 'TILE',
      expectedChanged: ['TILE'],
      edit: (sections) => {
        const record = (sections.TILE.records || [])[0];
        const nextFog = getInterpretedMapIntField(record, 'fogofwar', 1) === 0 ? 1 : 0;
        setMapField(record, 'fogofwar', nextFog, 'Fog Of War');
      }
    },
    {
      label: 'CITY name',
      sectionCode: 'CITY',
      expectedChanged: ['CITY'],
      edit: (sections) => {
        const record = (sections.CITY.records || [])[0];
        setMapField(record, 'name', `C3X ${getFieldValue(record, 'name', 'City')}`.slice(0, 31), 'Name');
      }
    },
    {
      label: 'UNIT experiencelevel',
      sectionCode: 'UNIT',
      expectedChanged: ['UNIT'],
      edit: (sections) => {
        const record = (sections.UNIT.records || [])[0];
        setMapField(record, 'experiencelevel', getInterpretedMapIntField(record, 'experiencelevel', 0) + 1, 'Experience Level');
      }
    },
    {
      label: 'CLNY owner',
      sectionCode: 'CLNY',
      expectedChanged: ['CLNY'],
      edit: (sections) => {
        const record = (sections.CLNY.records || [])[0];
        setMapField(record, 'owner', getInterpretedMapIntField(record, 'owner', 1) === 1 ? 2 : 1, 'Owner');
      }
    },
    {
      label: 'SLOC owner',
      sectionCode: 'SLOC',
      expectedChanged: ['SLOC'],
      edit: (sections) => {
        const record = (sections.SLOC.records || [])[0];
        setMapField(record, 'owner', getInterpretedMapIntField(record, 'owner', 1) === 1 ? 2 : 1, 'Owner');
      }
    }
  ];

  cases.forEach((entry) => {
    const scenarioPath = copyFixtureBiq(WWII_PACIFIC_BIQ, 'wwii-section-biq');
    const before = parseBiqFileForRawSections(scenarioPath);
    const bundle = loadMaterializedMapBundle(scenarioPath);
    const sections = {
      WMAP: getSection(bundle.tabs.map, 'WMAP'),
      TILE: getSection(bundle.tabs.map, 'TILE'),
      CITY: getSection(bundle.tabs.map, 'CITY'),
      UNIT: getSection(bundle.tabs.map, 'UNIT'),
      CLNY: getSection(bundle.tabs.map, 'CLNY'),
      SLOC: getSection(bundle.tabs.map, 'SLOC')
    };
    assert.ok(sections[entry.sectionCode] && (sections[entry.sectionCode].records || []).length > 0, `expected ${entry.sectionCode} records for ${entry.label}`);
    entry.edit(sections);

    const saveResult = saveBundle({
      mode: 'scenario',
      civ3Path: CIV3_ROOT,
      c3xPath: C3X_ROOT,
      scenarioPath,
      tabs: bundle.tabs
    });
    assert.equal(saveResult.ok, true, `${entry.label} save failed: ${saveResult.error || ''}`);

    const after = parseBiqFileForRawSections(scenarioPath);
    assert.deepEqual(
      withoutBaselineSections(getChangedSectionCodes(before, after, STOCK_NOOP_SECTION_CODES), noOpChangedSections),
      entry.expectedChanged,
      `${entry.label} should only change ${entry.expectedChanged.join(', ')} beyond no-op baseline changes`
    );
    assertNoMapIntegrityIssues(scenarioPath);
  });
});

test('fixture-backed BIQ fog parity: 6 MP Age of Discovery visibility flags', (t) => {
  if (!fs.existsSync(AGE_OF_DISCOVERY_BIQ)) {
    t.skip(`Missing BIQ fixture: ${AGE_OF_DISCOVERY_BIQ}`);
    return;
  }
  const bundle = loadMaterializedMapBundle(AGE_OF_DISCOVERY_BIQ);
  const mapTab = bundle.tabs.map;
  const tile = getSection(mapTab, 'TILE');
  assert.ok(tile, 'expected TILE section');

  const { fogged, visible } = countFogVisibility(tile);

  assert.equal((tile.records || []).length, 5460, 'expected Age of Discovery TILE record count');
  assert.equal(fogged, 4882, 'expected loaded false fog flags to remain fogged after map-modal interpretation');
  assert.equal(visible, 578, 'expected loaded true fog flags to remain visible after map-modal interpretation');
  assert.equal(getInterpretedMapIntField((tile.records || [])[0], 'continent', -1), 0, 'expected CONT 1 (0) display labels to resolve to raw continent id 0');
});

test('fixture-backed BIQ no-op map serialization: 6 MP Age of Discovery emits no edits when unchanged', (t) => {
  if (!fs.existsSync(AGE_OF_DISCOVERY_BIQ)) {
    t.skip(`Missing BIQ fixture: ${AGE_OF_DISCOVERY_BIQ}`);
    return;
  }
  const bundle = loadMaterializedMapBundle(AGE_OF_DISCOVERY_BIQ);

  assert.deepEqual(collectBiqMapStructureOps(bundle.tabs), [], 'unchanged loaded map should not emit structure ops');
  assert.deepEqual(collectBiqMapRecordOps(bundle.tabs), [], 'unchanged loaded map should not emit record ops');
  assert.deepEqual(collectBiqMapEdits(bundle.tabs), [], 'unchanged loaded map should not emit field edits');
});

test('fixture-backed BIQ save/reload: 6 MP Age of Discovery fog and city booleans stay game-parseable', (t) => {
  if (!fs.existsSync(AGE_OF_DISCOVERY_BIQ)) {
    t.skip(`Missing BIQ fixture: ${AGE_OF_DISCOVERY_BIQ}`);
    return;
  }
  const scenarioPath = copyFixtureBiq(AGE_OF_DISCOVERY_BIQ, 'aod-biq');

  const bundle = loadMaterializedMapBundle(scenarioPath);
  const tileSection = getSection(bundle.tabs.map, 'TILE');
  const citySection = getSection(bundle.tabs.map, 'CITY');
  assert.ok(tileSection, 'expected TILE section');
  assert.ok(citySection, 'expected CITY section');

  const targetTile = (tileSection.records || []).find((record) => getInterpretedMapIntField(record, 'fogofwar', 1) === 0);
  assert.ok(targetTile, 'expected at least one fogged tile to make visible');
  mapCore.setField(targetTile, 'fogofwar', '1', 'Fog Of War');

  const targetCity = (citySection.records || []).find((record) => getInterpretedMapIntField(record, 'haswalls', 0) === 1);
  assert.ok(targetCity, 'expected at least one walled city to clear');
  const cityName = String(getRecordField(targetCity, 'name') && getRecordField(targetCity, 'name').value || '');
  mapCore.setField(targetCity, 'haswalls', '0', 'Has Walls');

  const saveResult = saveBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadMaterializedMapBundle(scenarioPath);
  const reTileSection = getSection(reloaded.tabs.map, 'TILE');
  const reCitySection = getSection(reloaded.tabs.map, 'CITY');
  assert.ok(reTileSection, 'expected reloaded TILE section');
  assert.ok(reCitySection, 'expected reloaded CITY section');
  const counts = countFogVisibility(reTileSection);
  assert.equal(counts.fogged, 4881, 'expected saved BIQ to reload with one fewer fogged tile');
  assert.equal(counts.visible, 579, 'expected saved BIQ to reload with one more visible tile');

  const reCity = (reCitySection.records || []).find((record) => (
    String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === cityName
  ));
  assert.ok(reCity, 'expected edited city to reload by name');
  assert.equal(getInterpretedMapIntField(reCity, 'haswalls', 1), 0, 'expected saved city wall flag to reload as false/0');
  assert.deepEqual(collectBiqMapEdits(reloaded.tabs), [], 'reloaded saved BIQ should not produce phantom map edits');
  assertNoMapIntegrityIssues(scenarioPath);
});

test('fixture-backed BIQ reference integrity: edited cross-section references stay in range after save', (t) => {
  if (!fs.existsSync(CONQUESTS_BIQ)) {
    t.skip(`Missing BIQ fixture: ${CONQUESTS_BIQ}`);
    return;
  }
  const scenarioPath = copyFixtureBiq(CONQUESTS_BIQ, 'global-ref-biq');
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath
  });

  const firstEntry = (tabKey, requiredKey) => {
    const entries = (bundle.tabs[tabKey] && bundle.tabs[tabKey].entries) || [];
    const entry = entries.find((candidate) => getEntryField(candidate, requiredKey));
    assert.ok(entry, `expected ${tabKey} entry with ${requiredKey}`);
    return entry;
  };

  const civ = firstEntry('civilizations', 'favoritegovernment');
  setEntryField(civ, 'kingunit', '0');
  setEntryField(civ, 'favoritegovernment', '0');
  setEntryField(civ, 'shunnedgovernment', '0');
  setEntryField(civ, 'freetech1index', '0');

  const tech = firstEntry('technologies', 'prerequisite1');
  setEntryField(tech, 'prerequisite1', '0');
  setEntryField(tech, 'prerequisite2', '-1');
  setEntryField(tech, 'prerequisite3', '-1');
  setEntryField(tech, 'prerequisite4', '-1');

  const resource = firstEntry('resources', 'prerequisite');
  setEntryField(resource, 'prerequisite', '0');

  const government = firstEntry('governments', 'prerequisitetechnology');
  setEntryField(government, 'prerequisitetechnology', '0');

  const improvement = firstEntry('improvements', 'reqadvance');
  setEntryField(improvement, 'reqadvance', '0');
  setEntryField(improvement, 'obsoleteby', '-1');
  setEntryField(improvement, 'reqresource1', '0');
  setEntryField(improvement, 'reqresource2', '-1');
  setEntryField(improvement, 'reqgovernment', '0');
  setEntryField(improvement, 'reqimprovement', '-1');
  setEntryField(improvement, 'unitproduced', '-1');

  const unit = firstEntry('units', 'requiredtech');
  setEntryField(unit, 'requiredtech', '0');
  setEntryField(unit, 'upgradeto', '1');
  setEntryField(unit, 'requiredresource1', '0');
  setEntryField(unit, 'requiredresource2', '-1');
  setEntryField(unit, 'requiredresource3', '-1');
  if (getEntryField(unit, 'enslaveresultsin')) setEntryField(unit, 'enslaveresultsin', '-1');
  const stealthTargets = getEntryFields(unit, 'stealthtarget');
  stealthTargets.forEach((field, index) => {
    field.value = index === 0 ? '1' : '-1';
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const parsed = parseBiqFileForRawSections(scenarioPath);
  assertBiqGlobalReferenceIntegrity(parsed);

  const reloaded = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath
  });
  const reCiv = (reloaded.tabs.civilizations.entries || []).find((entry) => String(entry.civilopediaKey || '') === String(civ.civilopediaKey || ''));
  const reUnit = (reloaded.tabs.units.entries || []).find((entry) => String(entry.civilopediaKey || '') === String(unit.civilopediaKey || ''));
  assert.equal(parseProjectedReferenceValue(getEntryFieldValue(reCiv, 'favoritegovernment'), -1), 0);
  assert.equal(parseProjectedReferenceValue(getEntryFieldValue(reCiv, 'freetech1index'), -1), 0);
  assert.equal(parseProjectedReferenceValue(getEntryFieldValue(reUnit, 'requiredtech'), -1), 0);
  assert.equal(parseProjectedReferenceValue(getEntryFieldValue(reUnit, 'upgradeto'), -1), 1);
});

test('fixture-backed BIQ save/reload: stock WWII map edits stay parseable across WMAP, TILE, CITY, UNIT, CLNY, and SLOC', (t) => {
  if (!fs.existsSync(WWII_PACIFIC_BIQ)) {
    t.skip(`Missing BIQ fixture: ${WWII_PACIFIC_BIQ}`);
    return;
  }
  const scenarioPath = copyFixtureBiq(WWII_PACIFIC_BIQ, 'wwii-map-biq');
  const bundle = loadMaterializedMapBundle(scenarioPath);
  const mapTab = bundle.tabs.map;
  const wmapSection = getSection(mapTab, 'WMAP');
  const tileSection = getSection(mapTab, 'TILE');
  const citySection = getSection(mapTab, 'CITY');
  const unitSection = getSection(mapTab, 'UNIT');
  const colonySection = getSection(mapTab, 'CLNY');
  const slocSection = getSection(mapTab, 'SLOC');
  assert.ok(wmapSection && tileSection && citySection && unitSection && colonySection && slocSection, 'expected complete stock map sections');

  const wmap = (wmapSection.records || [])[0];
  const tile = (tileSection.records || [])[0];
  const city = (citySection.records || [])[0];
  const unit = (unitSection.records || [])[0];
  const colony = (colonySection.records || [])[0];
  const sloc = (slocSection.records || [])[0];
  assert.ok(wmap && tile && city && unit && colony && sloc, 'expected editable records in every stock map section');

  const nextMapSeed = getInterpretedMapIntField(wmap, 'mapseed', 0) + 1;
  const nextFog = getInterpretedMapIntField(tile, 'fogofwar', 1) === 0 ? 1 : 0;
  const cityName = `C3X ${getFieldValue(city, 'name', 'City')}`.slice(0, 31);
  const nextUnitExperience = Math.max(0, getInterpretedMapIntField(unit, 'experiencelevel', 0) + 1);
  const nextColonyOwner = getInterpretedMapIntField(colony, 'owner', 1) === 1 ? 2 : 1;
  const nextSlocOwner = getInterpretedMapIntField(sloc, 'owner', 1) === 1 ? 2 : 1;

  setMapField(wmap, 'mapseed', nextMapSeed, 'Map Seed');
  setMapField(tile, 'fogofwar', nextFog, 'Fog Of War');
  setMapField(city, 'name', cityName, 'Name');
  setMapField(unit, 'experiencelevel', nextUnitExperience, 'Experience Level');
  setMapField(colony, 'owner', nextColonyOwner, 'Owner');
  setMapField(sloc, 'owner', nextSlocOwner, 'Owner');

  const saveResult = saveBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadMaterializedMapBundle(scenarioPath);
  assert.equal(getInterpretedMapIntField((getSection(reloaded.tabs.map, 'WMAP').records || [])[0], 'mapseed', -1), nextMapSeed);
  assert.equal(getInterpretedMapIntField((getSection(reloaded.tabs.map, 'TILE').records || [])[0], 'fogofwar', -1), nextFog);
  assert.equal(getFieldValue((getSection(reloaded.tabs.map, 'CITY').records || [])[0], 'name'), cityName);
  assert.equal(getInterpretedMapIntField((getSection(reloaded.tabs.map, 'UNIT').records || [])[0], 'experiencelevel', -1), nextUnitExperience);
  assert.equal(getInterpretedMapIntField((getSection(reloaded.tabs.map, 'CLNY').records || [])[0], 'owner', -1), nextColonyOwner);
  assert.equal(getInterpretedMapIntField((getSection(reloaded.tabs.map, 'SLOC').records || [])[0], 'owner', -1), nextSlocOwner);
  assert.deepEqual(collectBiqMapEdits(reloaded.tabs), [], 'reloaded saved BIQ should not produce phantom map edits');
  assertNoMapIntegrityIssues(scenarioPath);
});
