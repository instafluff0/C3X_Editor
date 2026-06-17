const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const {
  collectBiqMapEdits,
  collectBiqMapStructureOps,
  collectBiqReferenceEdits,
  collectBiqStructureEdits,
  loadBundle,
  previewFileDiff,
  previewSavePlan,
  saveBundle
} = require('../src/configCore');
const mapCore = require('../src/mapEditorCore');
const {
  applyEdits,
  parseAllSections,
  serializeSection,
  normalizeDeletedReferenceSections,
  collectMapReferenceIntegrityIssues,
  collectScenarioPlayerLoadabilityIssues,
  formatScenarioPlayerLoadabilityIssue,
  collectColonyOverlayCoherenceIssues
} = require('../src/biq/biqSections');
const { decompress } = require('../src/biq/decompress');
const {
  DEFAULT_MAP_SECTION_CODES,
  assertRawSectionsEqual,
  assertNoMapReferenceIssues
} = require('./biqMapAssertions');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-biq-test-'));
}

function ensureDefaultC3xFiles(root) {
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = Art\\Units\\Warrior\\Warrior.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
}

function findSampleBiqPath() {
  const envPath = String(process.env.C3X_TEST_BIQ || '').trim();
  const candidates = [
    envPath,
    path.resolve(__dirname, '..', '..', 'conquests.biq')
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || '';
}

function findSampleMapBiqPath() {
  const envPath = String(process.env.C3X_TEST_MAP_BIQ || '').trim();
  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const candidates = [
    envPath,
    path.join(civ3Root, 'Conquests', 'Scenarios', '2 MP Rise of Rome.biq'),
    path.join(civ3Root, 'Conquests', 'Scenarios', '3 MP Fall of Rome.biq'),
    path.join(civ3Root, 'Conquests', 'Scenarios', '8 MP Napoleonic Europe.biq'),
    path.join(civ3Root, 'Conquests', 'Scenarios', '9 MP WWII in the Pacific.biq')
  ].filter((p) => p && fs.existsSync(p));
  return candidates[0] || '';
}

function getStablePlayableCivsFixturePath() {
  return path.resolve(__dirname, 'fixtures', 'biq_playable_civs_fixture.biq');
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

function findTidesOfCrimsonBiqPath() {
  const conquestsRoot = getStableFixtureCiv3Root();
  const candidate = path.join(conquestsRoot, 'Scenarios', 'TIDES OF CRIMSON.biq');
  return fs.existsSync(candidate) ? candidate : '';
}

function findCivilizationLegendsBiqPath() {
  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const candidate = path.join(civ3Root, 'Conquests', 'Scenarios', 'Civilization LEGENDS.biq');
  return fs.existsSync(candidate) ? candidate : '';
}

function findExpansion2021BiqPath() {
  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const candidate = path.join(civ3Root, 'Conquests', 'Scenarios', '2021 EXPANSION.biq');
  return fs.existsSync(candidate) ? candidate : '';
}

function resolveCiv3RootFromBiq(biqPath) {
  return path.resolve(path.dirname(biqPath), '..');
}

function findField(entry, key) {
  if (!entry || !Array.isArray(entry.biqFields)) return null;
  const needle = String(key || '').trim().toLowerCase();
  return entry.biqFields.find((f) => String(f.baseKey || f.key || '').trim().toLowerCase() === needle) || null;
}

function findPrimaryNameField(entry) {
  return findField(entry, 'name') || findField(entry, 'leadername') || findField(entry, 'civilizationname');
}

function findMatrixEditableField(tab, entry) {
  if (tab === 'civilizations') return findField(entry, 'adjective') || findField(entry, 'noun') || findField(entry, 'leadername');
  return findPrimaryNameField(entry);
}

function biqSectionHasCivilopediaKey(bundle, sectionCode, wantedKey) {
  const biq = bundle && bundle.biq;
  const sections = biq && Array.isArray(biq.sections) ? biq.sections : [];
  const section = sections.find((s) => String(s.code || '').toUpperCase() === String(sectionCode || '').toUpperCase());
  if (!section || !Array.isArray(section.records)) return false;
  const target = String(wantedKey || '').trim().toUpperCase();
  return section.records.some((record) => {
    const fields = Array.isArray(record && record.fields) ? record.fields : [];
    const civField = fields.find((f) => String(f.baseKey || f.key || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').trim().toUpperCase() === target;
  });
}

function getBiqSectionRecordIndex(bundle, sectionCode, wantedKey) {
  const biq = bundle && bundle.biq;
  const sections = biq && Array.isArray(biq.sections) ? biq.sections : [];
  const section = sections.find((s) => String(s.code || '').toUpperCase() === String(sectionCode || '').toUpperCase());
  if (!section || !Array.isArray(section.records)) return -1;
  const target = String(wantedKey || '').trim().toUpperCase();
  return section.records.findIndex((record) => {
    const fields = Array.isArray(record && record.fields) ? record.fields : [];
    const civField = fields.find((f) => String(f.baseKey || f.key || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').trim().toUpperCase() === target;
  });
}

function getBiqSectionRecordKeyByIndex(bundle, sectionCode, wantedIndex) {
  const biq = bundle && bundle.biq;
  const sections = biq && Array.isArray(biq.sections) ? biq.sections : [];
  const section = sections.find((s) => String(s.code || '').toUpperCase() === String(sectionCode || '').toUpperCase());
  if (!section || !Array.isArray(section.records)) return '';
  const record = section.records[Number(wantedIndex)];
  if (!record) return '';
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  const civField = fields.find((f) => String(f.baseKey || f.key || '').toLowerCase() === 'civilopediaentry');
  return String(civField && civField.value || '').trim().toUpperCase();
}

function getEntryByCivKey(entries, civKey) {
  const target = String(civKey || '').trim().toUpperCase();
  return (Array.isArray(entries) ? entries : []).find((entry) => String(entry.civilopediaKey || '').trim().toUpperCase() === target) || null;
}

function makeShortBiqTestRef(prefix, label = 'T') {
  const token = `${label}_${Date.now().toString(36).slice(-7)}_${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
  return `${prefix}_${token}`.slice(0, 31);
}

function getRawPrtoRecordsByCivKey(parsed, civKey) {
  const target = String(civKey || '').trim().toUpperCase();
  const prto = (parsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'PRTO');
  const records = Array.isArray(prto && prto.records) ? prto.records : [];
  return records.filter((record) => String(record && record.civilopediaEntry || '').trim().toUpperCase() === target);
}

function isRawPrimaryPrtoRecord(record) {
  const otherStrategy = Number(record && record.otherStrategy);
  return !Number.isFinite(otherStrategy) || otherStrategy < 0;
}

function getRawPrtoPrimaryRecordsByCivKey(parsed, civKey) {
  return getRawPrtoRecordsByCivKey(parsed, civKey).filter(isRawPrimaryPrtoRecord);
}

function countPrtoStrategyBits(mask) {
  const raw = Number(mask) | 0;
  let count = 0;
  for (let bit = 0; bit < 20; bit += 1) {
    if (((raw >>> bit) & 1) === 1) count += 1;
  }
  return count;
}

function assertRawPrtoStrategyRows(parsed, civKey, expectedMask, label = civKey) {
  const records = getRawPrtoRecordsByCivKey(parsed, civKey);
  const primaries = records.filter(isRawPrimaryPrtoRecord);
  assert.equal(primaries.length, 1, `${label} should have exactly one primary PRTO row`);
  const primaryIndex = Number(primaries[0].index);
  const expectedRows = Math.max(1, countPrtoStrategyBits(expectedMask));
  assert.equal(records.length, expectedRows, `${label} should have one raw PRTO row per strategy bit, minimum one`);
  records.forEach((record) => {
    if (record === primaries[0]) return;
    assert.equal(Number(record.otherStrategy), primaryIndex, `${label} strategy-map child should point to the primary index`);
  });
  assert.equal(getMergedRawPrtoStrategyMask(parsed, civKey), expectedMask, `${label} should keep merged AI Strategy mask`);
}

function getRawRaceRecordByCivKey(parsed, civKey) {
  const target = String(civKey || '').trim().toUpperCase();
  const race = (parsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'RACE');
  const records = Array.isArray(race && race.records) ? race.records : [];
  return records.find((record) => String(record && record.civilopediaEntry || '').trim().toUpperCase() === target) || null;
}

function getRawRaceRecordsByCivKey(parsed, civKey) {
  const target = String(civKey || '').trim().toUpperCase();
  const race = (parsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'RACE');
  const records = Array.isArray(race && race.records) ? race.records : [];
  return records.filter((record) => String(record && record.civilopediaEntry || '').trim().toUpperCase() === target);
}

function parseBiqFileForRawSections(filePath) {
  const raw = fs.readFileSync(filePath);
  const inflated = decompress(raw);
  return parseAllSections(inflated.ok ? inflated.data : raw);
}

function parseDisplayedReferenceIndex(value, fallback = -1) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return fallback;
  if (/^none$/i.test(text)) return -1;
  const parenMatch = text.match(/\((-?\d+)\)\s*$/);
  if (parenMatch) {
    const parsed = Number.parseInt(parenMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return mapCore.parseIntLoose(text, fallback);
}

function decodeSigned32BitmaskIndices(value) {
  const parsed = mapCore.parseIntLoose(value, 0);
  const mask = Number.isFinite(parsed) ? (parsed >>> 0) : 0;
  const out = [];
  for (let bit = 0; bit < 32; bit += 1) {
    if (((mask >>> bit) & 1) === 1) out.push(bit);
  }
  return out;
}

const UNIT_AI_STRATEGY_FIELD_KEYS = [
  'offence',
  'defencestrategy',
  'artillery',
  'explorestrategy',
  'armyunit',
  'cruisemissileunit',
  'airbombard',
  'airdefencestrategy',
  'navalpower',
  'airtransport',
  'navaltransport',
  'navalcarrier',
  'terraform',
  'settle',
  'leaderunit',
  'tacticalnuke',
  'icbm',
  'navalmissiletransport',
  'flagstrategy',
  'kingstrategy'
];

function setFieldValue(entry, key, value) {
  const field = findField(entry, key);
  assert.ok(field, `expected editable field ${key} on ${entry && entry.civilopediaKey}`);
  field.value = String(value);
}

function setUnitName(entry, name) {
  entry.name = String(name);
  setFieldValue(entry, 'name', entry.name);
}

function setUnitScalarFields(entry, fields) {
  Object.entries(fields || {}).forEach(([key, value]) => {
    setFieldValue(entry, key, String(value));
  });
}

const PRTO_INDEX_DISPLAY_FIELD_KEYS = new Set([
  'requiredtech',
  'requiredresource1',
  'requiredresource2',
  'requiredresource3',
  'upgradeto',
  'enslaveresultsin',
  'unitclass'
]);

function makePrtoEntryFieldSnapshot(entry) {
  const snapshot = new Map();
  const occurrenceByBaseKey = new Map();
  getFieldCollection(entry).forEach((field) => {
    const baseKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
    if (!baseKey) return;
    const occurrence = occurrenceByBaseKey.get(baseKey) || 0;
    occurrenceByBaseKey.set(baseKey, occurrence + 1);
    const text = String(field && field.value != null ? field.value : '').trim();
    const lower = text.toLowerCase();
    let normalized = text;
    if (PRTO_INDEX_DISPLAY_FIELD_KEYS.has(baseKey)) {
      normalized = String(parseDisplayedReferenceIndex(text, -1));
    } else if (lower === 'true' || lower === 'false') {
      normalized = lower;
    }
    snapshot.set(`${baseKey}#${occurrence}`, normalized);
  });
  return snapshot;
}

function assertReloadedPrtoEntryFieldsMatchPreSave(preSaveEntry, reloadedEntry, label) {
  assert.ok(preSaveEntry, `expected pre-save ${label}`);
  assert.ok(reloadedEntry, `expected reloaded ${label}`);
  const expected = makePrtoEntryFieldSnapshot(preSaveEntry);
  const actual = makePrtoEntryFieldSnapshot(reloadedEntry);
  assert.equal(actual.size, expected.size, `${label} should reload with the same projected PRTO field count`);
  expected.forEach((value, key) => {
    assert.equal(actual.get(key), value, `${label} field ${key} should match the pre-save unit after BIQ reload`);
  });
}

function assertRawPrtoScalarFields(record, expected, label = 'PRTO record') {
  const rawKeyByUiKey = {
    requiredtech: 'requiredTech',
    requiredresource1: 'requiredResource1',
    requiredresource2: 'requiredResource2',
    requiredresource3: 'requiredResource3',
    attack: 'attack',
    defence: 'defence',
    movement: 'movement',
    shieldcost: 'shieldCost'
  };
  Object.entries(expected || {}).forEach(([key, value]) => {
    const rawKey = rawKeyByUiKey[String(key).toLowerCase()] || key;
    assert.equal(Number(record && record[rawKey]), Number(value), `${label} ${rawKey} should persist`);
  });
}

function getRawPrtoScalarSnapshot(record) {
  return {
    requiredtech: Number(record && record.requiredTech),
    requiredresource1: Number(record && record.requiredResource1),
    requiredresource2: Number(record && record.requiredResource2),
    requiredresource3: Number(record && record.requiredResource3),
    attack: Number(record && record.attack),
    defence: Number(record && record.defence),
    movement: Number(record && record.movement),
    shieldcost: Number(record && record.shieldCost)
  };
}

function setUnitAiStrategyMask(entry, mask) {
  UNIT_AI_STRATEGY_FIELD_KEYS.forEach((key, bit) => {
    setFieldValue(entry, key, ((mask >>> bit) & 1) === 1 ? 'true' : 'false');
  });
}

function makePendingCopiedUnitEntry(sourceEntry, newRef) {
  assert.ok(sourceEntry, 'expected source unit entry for pending copy');
  const entry = JSON.parse(JSON.stringify(sourceEntry));
  const lookupRef = String(newRef || '').trim().toUpperCase();
  entry.id = lookupRef.startsWith('PRTO_') ? lookupRef.slice(5) : lookupRef;
  entry.civilopediaKey = lookupRef;
  entry.displayCivilopediaKey = newRef;
  entry.rawCivilopediaKey = newRef;
  entry.rawBiqCivilopediaKey = newRef;
  entry.linkCivilopediaKey = newRef;
  entry.lookupCivilopediaKey = lookupRef;
  entry.biqIndex = null;
  entry.newRecordRef = lookupRef;
  entry.isNew = true;
  entry.name = lookupRef.replace(/^PRTO_/, 'Test ');
  entry.biqFields = (Array.isArray(entry.biqFields) ? entry.biqFields : []).map((field) => {
    const next = {
      ...field,
      originalValue: String(field && field.originalValue != null ? field.originalValue : (field && field.value) || '')
    };
    if (String(next.baseKey || next.key || '').trim().toLowerCase() === 'civilopediaentry') {
      next.value = newRef;
      next.originalValue = newRef;
    }
    if (String(next.baseKey || next.key || '').trim().toLowerCase() === 'name') {
      next.value = entry.name;
    }
    return next;
  });
  return entry;
}

const BLANK_UNIT_DEFAULT_VALUES = {
  requiredtech: '-1',
  requiredresource1: '-1',
  requiredresource2: '-1',
  requiredresource3: '-1',
  upgradeto: '-1',
  enslaveresultsin: '-1',
  iconindex: '0',
  movement: '1',
  availableto: '-2',
  otherstrategy: '-1',
  useexactcost: '7',
  questionmark3: '1',
  questionmark5: '1',
  questionmark6: '1'
};

const BLANK_UNIT_DEFAULT_TRUE_FIELDS = new Set([
  'offence',
  'defencestrategy',
  'skipturn',
  'wait',
  'fortify',
  'disband',
  'goto',
  'exploreorder',
  'sentry',
  'load',
  'airlift',
  'pillage',
  'upgrade',
  'capture'
]);

function makeBlankUnitFieldValueForTest(field) {
  const base = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(BLANK_UNIT_DEFAULT_VALUES, base)) return BLANK_UNIT_DEFAULT_VALUES[base];
  if (BLANK_UNIT_DEFAULT_TRUE_FIELDS.has(base)) return 'true';
  if (base === 'stealth_target' || base === 'stealthtarget' || base === 'stealthtargets'
    || base === 'legal_unit_telepad' || base === 'legalunittelepad' || base === 'legalunittelepads'
    || base === 'legal_building_telepad' || base === 'legalbuildingtelepad' || base === 'legalbuildingtelepads') {
    return '';
  }
  if (/^(freetech|prerequisite|reqadvance|requiredtech)/.test(base)) return '';
  if (base === 'name' || base === 'description' || base === 'civilizationname') return '';
  const raw = String(field && field.value || '').trim().toLowerCase();
  if (raw === 'true' || raw === 'false') return 'false';
  const parsed = parseDisplayedReferenceIndex(field && field.value, NaN);
  return Number.isFinite(parsed) ? '0' : '';
}

function makePendingBlankUnitEntry(sourceEntry, newRef, displayName = 'New Unit') {
  assert.ok(sourceEntry, 'expected source unit entry for pending blank unit');
  const entry = JSON.parse(JSON.stringify(sourceEntry));
  const lookupRef = String(newRef || '').trim().toUpperCase();
  entry.id = lookupRef.startsWith('PRTO_') ? lookupRef.slice(5) : lookupRef;
  entry.civilopediaKey = lookupRef;
  entry.displayCivilopediaKey = newRef;
  entry.rawCivilopediaKey = newRef;
  entry.rawBiqCivilopediaKey = newRef;
  entry.linkCivilopediaKey = newRef;
  entry.lookupCivilopediaKey = lookupRef;
  entry.biqIndex = null;
  entry.newRecordRef = lookupRef;
  entry.isNew = true;
  entry.name = String(displayName || '').trim() || 'New Unit';
  entry.biqFields = (Array.isArray(entry.biqFields) ? entry.biqFields : []).map((field) => {
    const base = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
    let value = makeBlankUnitFieldValueForTest(field);
    if (base === 'civilopediaentry') value = newRef;
    if (base === 'name') value = entry.name;
    return {
      ...field,
      value,
      originalValue: ''
    };
  });
  return entry;
}

function makePendingCopiedCivilizationEntry(sourceEntry, newRef) {
  assert.ok(sourceEntry, 'expected source civilization entry for pending copy');
  const entry = JSON.parse(JSON.stringify(sourceEntry));
  const lookupRef = String(newRef || '').trim().toUpperCase();
  entry.id = lookupRef.startsWith('RACE_') ? lookupRef.slice(5) : lookupRef;
  entry.civilopediaKey = lookupRef;
  entry.displayCivilopediaKey = newRef;
  entry.rawCivilopediaKey = newRef;
  entry.rawBiqCivilopediaKey = newRef;
  entry.linkCivilopediaKey = newRef;
  entry.lookupCivilopediaKey = lookupRef;
  entry.biqIndex = null;
  entry.newRecordRef = lookupRef;
  entry.isNew = true;
  entry.name = lookupRef.replace(/^RACE_/, 'Test ');
  entry.biqFields = (Array.isArray(entry.biqFields) ? entry.biqFields : []).map((field) => {
    const next = {
      ...field,
      originalValue: String(field && field.originalValue != null ? field.originalValue : (field && field.value) || '')
    };
    const base = String(next.baseKey || next.key || '').trim().toLowerCase();
    if (base === 'civilopediaentry') {
      next.value = newRef;
      next.originalValue = newRef;
    }
    if (base === 'civilizationname' || base === 'noun' || base === 'adjective') {
      next.value = entry.name;
    }
    return next;
  });
  return entry;
}

function getMergedRawPrtoStrategyMask(parsed, civKey) {
  const records = getRawPrtoRecordsByCivKey(parsed, civKey);
  return records.reduce((mask, record) => mask | (Number(record && record.AIStrategy) | 0), 0);
}

function getMergedRawPrtoStrategyMaskByPrimaryName(parsed, unitName) {
  const target = String(unitName || '').trim();
  const prto = (parsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'PRTO');
  const records = Array.isArray(prto && prto.records) ? prto.records : [];
  const primary = records.find((record) => {
    const name = String(record && record.name || '').trim();
    const otherStrategy = Number(record && record.otherStrategy);
    return name === target && (!Number.isFinite(otherStrategy) || otherStrategy < 0);
  });
  assert.ok(primary, `expected raw primary PRTO record named ${unitName}`);
  const primaryIndex = Number(primary.index);
  return records.reduce((mask, record) => {
    if (record === primary) return mask | (Number(record && record.AIStrategy) | 0);
    const otherStrategy = Number(record && record.otherStrategy);
    if (Number.isFinite(primaryIndex) && Number.isFinite(otherStrategy) && otherStrategy === primaryIndex) {
      return mask | (Number(record && record.AIStrategy) | 0);
    }
    return mask;
  }, 0);
}

function getRawPrtoPrimaryByName(parsed, unitName) {
  const target = String(unitName || '').trim();
  const prto = (parsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'PRTO');
  const records = Array.isArray(prto && prto.records) ? prto.records : [];
  return records.find((record) => {
    const name = String(record && record.name || '').trim();
    const otherStrategy = Number(record && record.otherStrategy);
    return name === target && (!Number.isFinite(otherStrategy) || otherStrategy < 0);
  }) || null;
}

function assertRawPrtoStrategyMasks(parsed, expectedMasks, label = '') {
  expectedMasks.forEach((mask, unitKey) => {
    assert.equal(
      getMergedRawPrtoStrategyMask(parsed, unitKey),
      mask,
      `${unitKey} should keep AI strategy mask ${mask}${label ? ` after ${label}` : ''}`
    );
  });
}

function getRawRaceFlavorMask(parsed, civKey) {
  const record = getRawRaceRecordByCivKey(parsed, civKey);
  assert.ok(record, `expected raw RACE record ${civKey}`);
  return Number(record.flavors) | 0;
}

function setCivilizationFlavorMask(entry, mask) {
  for (let idx = 0; idx < 7; idx += 1) {
    setFieldValue(entry, `flavor_${idx + 1}`, ((mask >>> idx) & 1) === 1 ? 'true' : 'false');
  }
}

function assertRawRaceFlavorMasks(parsed, expectedMasks, label = '') {
  expectedMasks.forEach((mask, civKey) => {
    assert.equal(
      getRawRaceFlavorMask(parsed, civKey),
      mask,
      `${civKey} should keep civilization flavor mask ${mask}${label ? ` after ${label}` : ''}`
    );
  });
}

function getSection(tab, code) {
  const sections = tab && Array.isArray(tab.sections) ? tab.sections : [];
  return sections.find((section) => String(section && section.code || '').toUpperCase() === String(code || '').toUpperCase()) || null;
}

function getRecordField(record, key) {
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  const target = String(key || '').trim().toLowerCase();
  return fields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target) || null;
}

function getRecordFields(record, key) {
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  const target = String(key || '').trim().toLowerCase();
  return fields.filter((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target);
}

function getBiqFieldsByCanonicalPrefix(entry, prefix) {
  const target = String(prefix || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return getFieldCollection(entry).filter((field) => {
    const key = String(field && (field.baseKey || field.key) || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return key === target || new RegExp(`^${target}\\d+$`).test(key);
  });
}

function getRecordInt(record, key, fallback) {
  const field = getRecordField(record, key);
  const parsed = mapCore.parseIntLoose(field && field.value, fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRecordStoredInt(record, key, fallback) {
  const field = getRecordField(record, key);
  const preferred = field && field.mapEditorValueEdited
    ? field.value
    : (field && field.originalValue != null && String(field.originalValue).trim() !== '' ? field.originalValue : field && field.value);
  const parsed = mapCore.parseIntLoose(preferred, fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildTileLookup(tileSection) {
  const lookup = new Map();
  const records = (tileSection && Array.isArray(tileSection.records)) ? tileSection.records : [];
  records.forEach((record) => {
    const x = getRecordInt(record, 'xpos', NaN);
    const y = getRecordInt(record, 'ypos', NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) lookup.set(`${x},${y}`, record);
  });
  return lookup;
}

function getMapSectionsOrSkip(t, mapTab, options = {}) {
  const tileSection = getSection(mapTab, 'TILE');
  const citySection = getSection(mapTab, 'CITY');
  const unitSection = getSection(mapTab, 'UNIT');
  const minTileRecords = Number.isFinite(options.minTileRecords) ? Number(options.minTileRecords) : 2;
  const minCityRecords = Number.isFinite(options.minCityRecords) ? Number(options.minCityRecords) : 1;
  const minUnitRecords = Number.isFinite(options.minUnitRecords) ? Number(options.minUnitRecords) : 1;
  if (!(tileSection && citySection && unitSection)) {
    t.skip('Sample BIQ map tab is missing TILE/CITY/UNIT sections.');
    return null;
  }
  if (!Array.isArray(tileSection.records) || tileSection.records.length < minTileRecords) {
    t.skip('Sample BIQ has insufficient TILE records.');
    return null;
  }
  if (!Array.isArray(citySection.records) || citySection.records.length < minCityRecords) {
    t.skip('Sample BIQ has insufficient CITY records.');
    return null;
  }
  if (!Array.isArray(unitSection.records) || unitSection.records.length < minUnitRecords) {
    t.skip('Sample BIQ has insufficient UNIT records.');
    return null;
  }
  return { tileSection, citySection, unitSection };
}

function getMapSectionsForSeedOrSkip(t, mapTab) {
  const tileSection = getSection(mapTab, 'TILE');
  const citySection = getSection(mapTab, 'CITY');
  const unitSection = getSection(mapTab, 'UNIT');
  if (!(tileSection && citySection && unitSection)) {
    t.skip('Sample BIQ map tab is missing TILE/CITY/UNIT sections.');
    return null;
  }
  if (!Array.isArray(tileSection.records) || tileSection.records.length < 3) {
    t.skip('Sample BIQ has insufficient TILE records to seed delete regression.');
    return null;
  }
  if (!Array.isArray(citySection.records)) {
    t.skip('Sample BIQ CITY section is unavailable.');
    return null;
  }
  if (!Array.isArray(unitSection.records)) {
    t.skip('Sample BIQ UNIT section is unavailable.');
    return null;
  }
  return { tileSection, citySection, unitSection };
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

function seedFixtureCitiesForDeleteRegression(t, mapTab) {
  const sections = getMapSectionsForSeedOrSkip(t, mapTab);
  if (!sections) return null;
  const { tileSection, citySection } = sections;
  const openTiles = (tileSection.records || []).filter((tile) => getRecordInt(tile, 'city', -1) < 0).slice(0, 3);
  if (openTiles.length < 3) {
    t.skip('Stable fixture lacks enough empty tiles to seed city-delete regression.');
    return null;
  }
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const seed = (tile, name, suffix) => {
    const ref = makeShortBiqTestRef('CITY', suffix);
    const x = getRecordInt(tile, 'xpos', -1);
    const y = getRecordInt(tile, 'ypos', -1);
    mapCore.addCity(citySection, tile, x, y, 0, 2, name, ref);
    mapTab.recordOps.push({ op: 'add', sectionCode: 'CITY', newRecordRef: ref });
    return { ref, x, y, name };
  };
  return {
    seeded: [
      seed(openTiles[0], 'Seed Delete City A', 'SDA'),
      seed(openTiles[1], 'Seed Delete City B', 'SDB'),
      seed(openTiles[2], 'Seed Delete City C', 'SDC')
    ],
    tileSection,
    citySection
  };
}

function getScenarioSettingsField(bundle, key) {
  const tab = bundle && bundle.tabs && bundle.tabs.scenarioSettings;
  const section = getSection(tab, 'GAME');
  const record = section && Array.isArray(section.records) ? section.records[0] : null;
  return getRecordField(record, key);
}

function getScenarioSettingsRecord(bundle) {
  const tab = bundle && bundle.tabs && bundle.tabs.scenarioSettings;
  const section = getSection(tab, 'GAME');
  return section && Array.isArray(section.records) ? section.records[0] : null;
}

function rewriteScenarioPlayableCivilizations(gameRecord, playableIds) {
  assert.ok(gameRecord, 'expected GAME record for playable civilization rewrite');
  const fields = Array.isArray(gameRecord.fields) ? gameRecord.fields : [];
  const countField = getRecordField(gameRecord, 'numberofplayablecivs') || getRecordField(gameRecord, 'number_of_playable_civs');
  assert.ok(countField, 'expected GAME playable civ count field');
  const replacement = Array.from(new Set((playableIds || [])
    .map((id) => Number.parseInt(String(id), 10))
    .filter((id) => Number.isFinite(id) && id >= 0)));
  const playableFieldPattern = /^playable_civ(?:_\d+)?$/;
  const preserved = fields.filter((field) => !playableFieldPattern.test(String(field && (field.baseKey || field.key) || '').toLowerCase()));
  const insertAt = Math.max(0, preserved.indexOf(countField) + 1);
  const rewrittenPlayable = replacement.map((id, idx) => ({
    key: `playable_civ_${idx}`,
    baseKey: `playable_civ_${idx}`,
    label: 'Playable Civilization',
    value: String(id),
    originalValue: '',
    editable: true
  }));
  preserved.splice(insertAt, 0, ...rewrittenPlayable);
  gameRecord.fields = preserved;
  countField.value = String(replacement.length);
  return replacement.slice();
}

function getFieldCollection(holder) {
  if (holder && Array.isArray(holder.biqFields)) return holder.biqFields;
  if (holder && Array.isArray(holder.fields)) return holder.fields;
  return [];
}

function getNthFieldByBaseKey(holder, key, occurrence = 0) {
  const target = String(key || '').trim().toLowerCase();
  const matches = getFieldCollection(holder).filter((field) => {
    return String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target;
  });
  return matches[occurrence] || null;
}

function computeGenericRoundtripMutation(field, occurrence = 0) {
  const raw = String(field && field.value || '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'true' || lower === 'false') {
    const expected = lower === 'true' ? 'false' : 'true';
    return { kind: 'boolText', assigned: expected, expected };
  }

  const parsed = parseDisplayedReferenceIndex(raw, NaN);
  if (Number.isFinite(parsed) || /^none$/i.test(raw)) {
    const hasLetters = /[A-Za-z]/.test(raw) || /^none$/i.test(raw);
    if (hasLetters) {
      const expected = parsed === 1 ? 2 : 1;
      return { kind: 'numeric', assigned: String(expected), expected };
    }
    if (raw === '0' || raw === '1') {
      const expected = raw === '0' ? 1 : 0;
      return { kind: 'numeric', assigned: String(expected), expected };
    }
    const expected = Number.isFinite(parsed) ? parsed + 1 : 1;
    return { kind: 'numeric', assigned: String(expected), expected };
  }

  const suffix = occurrence > 0 ? `_${occurrence + 1}` : '';
  const expected = `${String(field && (field.baseKey || field.key) || 'FIELD').toUpperCase()}_ROUNDTRIP${suffix}`;
  return { kind: 'string', assigned: expected, expected };
}

function mutateEditableFieldsForRoundtrip(holder, { exclude } = {}) {
  const expectations = [];
  const occurrenceByBaseKey = new Map();
  const holderCode = String(holder && holder.code || holder && holder.sectionCode || '').trim().toUpperCase();
  const forceMapEditedFlag = ['WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY'].includes(holderCode);

  getFieldCollection(holder).forEach((field) => {
    if (!field || !field.editable) return;
    const baseKey = String(field.baseKey || field.key || '').trim().toLowerCase();
    if (!baseKey) return;
    if (typeof exclude === 'function' && exclude(field, baseKey)) return;
    const occurrence = occurrenceByBaseKey.get(baseKey) || 0;
    occurrenceByBaseKey.set(baseKey, occurrence + 1);
    const mutation = computeGenericRoundtripMutation(field, occurrence);
    field.value = mutation.assigned;
    if (forceMapEditedFlag) field.mapEditorValueEdited = true;
    expectations.push({
      baseKey,
      occurrence,
      kind: mutation.kind,
      expected: mutation.expected
    });
  });

  return expectations;
}

function assertEditableFieldRoundtrip(holder, expectations, label) {
  expectations.forEach(({ baseKey, occurrence, kind, expected }) => {
    const field = getNthFieldByBaseKey(holder, baseKey, occurrence);
    assert.ok(field, `expected ${label} field ${baseKey}[${occurrence}] after reload`);
    if (kind === 'boolText') {
      assert.equal(String(field.value || '').trim().toLowerCase(), expected, `expected ${label} field ${baseKey}[${occurrence}] to persist`);
      return;
    }
    if (kind === 'string') {
      assert.equal(String(field.value || ''), expected, `expected ${label} field ${baseKey}[${occurrence}] to persist`);
      return;
    }
    const normalizedExpected = String(label || '').startsWith('WMAP:')
      && String(baseKey || '').trim().toLowerCase() === 'width'
      && Number.isFinite(expected)
      && expected > 0
      && (expected % 2) !== 0
      ? expected + 1
      : expected;
    assert.equal(parseDisplayedReferenceIndex(field.value, NaN), normalizedExpected, `expected ${label} field ${baseKey}[${occurrence}] to persist`);
  });
}

function canonicalBiqInventoryKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function makeBiqInventoryKey(sectionCode, fieldKey) {
  const code = String(sectionCode || '').trim().toUpperCase();
  const key = canonicalBiqInventoryKey(fieldKey);
  return code && key ? `${code}:${key}` : '';
}

function isPlayerSetupInvariantSensitiveInventoryKey(key) {
  const normalized = String(key || '');
  return normalized === 'LEAD:civ'
    || normalized === 'GAME:numberofplayablecivs'
    || normalized === 'GAME:numberofplayableciv'
    || /^GAME:playableciv\d*$/.test(normalized);
}

function addBiqInventoryField(inventory, sectionCode, field, source, options = {}) {
  if (!field) return;
  const fieldKey = field.baseKey || field.key;
  const key = makeBiqInventoryKey(sectionCode, fieldKey);
  if (!key) return;
  if (options.editableOnly !== false && !field.editable) return;
  if (!inventory.has(key)) inventory.set(key, new Set());
  inventory.get(key).add(source || 'unknown');
}

function addBiqInventoryFields(inventory, sectionCode, holder, source, options = {}) {
  getFieldCollection(holder).forEach((field) => {
    const baseKey = canonicalBiqInventoryKey(field && (field.baseKey || field.key));
    if (!baseKey) return;
    if (typeof options.exclude === 'function' && options.exclude(field, baseKey)) return;
    addBiqInventoryField(inventory, sectionCode, field, source, options);
  });
}

function addBiqCoverageField(coverage, sectionCode, fieldKey, source) {
  const key = makeBiqInventoryKey(sectionCode, fieldKey);
  if (!key) return;
  if (!coverage.has(key)) coverage.set(key, new Set());
  coverage.get(key).add(source || 'unknown');
}

function addBiqCoverageFields(coverage, sectionCode, holder, source, options = {}) {
  getFieldCollection(holder).forEach((field) => {
    const baseKey = canonicalBiqInventoryKey(field && (field.baseKey || field.key));
    if (!baseKey || !field.editable) return;
    if (typeof options.exclude === 'function' && options.exclude(field, baseKey)) return;
    addBiqCoverageField(coverage, sectionCode, baseKey, source);
  });
}

function collectEditableBiqUiFieldInventory(bundle) {
  const inventory = new Map();
  const tabs = bundle && bundle.tabs ? bundle.tabs : {};
  const referenceTabs = ['civilizations', 'technologies', 'resources', 'improvements', 'governments', 'units'];
  referenceTabs.forEach((tabKey) => {
    const entries = Array.isArray(tabs[tabKey] && tabs[tabKey].entries) ? tabs[tabKey].entries : [];
    entries.forEach((entry) => addBiqInventoryFields(
      inventory,
      entry && entry.biqSectionCode,
      entry,
      `${tabKey} reference fields`
    ));
  });

  const structuredTabs = ['scenarioSettings', 'players', 'terrain', 'world', 'rules'];
  structuredTabs.forEach((tabKey) => {
    const sections = Array.isArray(tabs[tabKey] && tabs[tabKey].sections) ? tabs[tabKey].sections : [];
    sections.forEach((section) => {
      const records = Array.isArray(section && section.records) ? section.records : [];
      records.forEach((record) => addBiqInventoryFields(
        inventory,
        section && section.code,
        record,
        `${tabKey} structured fields`
      ));
    });
  });

  const mapSections = Array.isArray(tabs.map && tabs.map.sections) ? tabs.map.sections : [];
  const mapCodes = new Set(DEFAULT_MAP_SECTION_CODES.concat(['CONT']));
  mapSections.forEach((section) => {
    const code = String(section && section.code || '').trim().toUpperCase();
    if (!mapCodes.has(code)) return;
    const records = Array.isArray(section && section.records) ? section.records : [];
    records.forEach((record) => addBiqInventoryFields(inventory, code, record, 'map fields'));
  });

  ['title', 'description'].forEach((key) => {
    const field = getScenarioSettingsField(bundle, key);
    if (field) addBiqInventoryField(inventory, 'GAME', field, 'scenario header synthetic fields', { editableOnly: false });
  });

  return inventory;
}

function collectEditableBiqUiFieldSamples(bundle) {
  const samples = new Map();
  const tabs = bundle && bundle.tabs ? bundle.tabs : {};
  const addSample = ({ tabKey, tab, sectionCode, holder, field, source, kind }) => {
    const key = makeBiqInventoryKey(sectionCode, field && (field.baseKey || field.key));
    if (!key || samples.has(key)) return;
    if (!field || !field.editable) return;
    samples.set(key, { tabKey, tab, sectionCode, holder, field, source, kind });
  };

  const referenceTabs = ['civilizations', 'technologies', 'resources', 'improvements', 'governments', 'units'];
  referenceTabs.forEach((tabKey) => {
    const tab = tabs[tabKey];
    const entries = Array.isArray(tab && tab.entries) ? tab.entries : [];
    entries.forEach((entry) => {
      getFieldCollection(entry).forEach((field) => addSample({
        tabKey,
        tab,
        sectionCode: entry && entry.biqSectionCode,
        holder: entry,
        field,
        source: `${tabKey} reference fields`,
        kind: 'reference'
      }));
    });
  });

  const structuredTabs = ['scenarioSettings', 'players', 'terrain', 'world', 'rules'];
  structuredTabs.forEach((tabKey) => {
    const tab = tabs[tabKey];
    const sections = Array.isArray(tab && tab.sections) ? tab.sections : [];
    sections.forEach((section) => {
      const records = Array.isArray(section && section.records) ? section.records : [];
      records.forEach((record) => {
        getFieldCollection(record).forEach((field) => addSample({
          tabKey,
          tab,
          sectionCode: section && section.code,
          holder: record,
          field,
          source: `${tabKey} structured fields`,
          kind: 'structure'
        }));
      });
    });
  });

  const mapTab = tabs.map;
  const mapSections = Array.isArray(mapTab && mapTab.sections) ? mapTab.sections : [];
  const mapCodes = new Set(DEFAULT_MAP_SECTION_CODES.concat(['CONT']));
  mapSections.forEach((section) => {
    const sectionCode = String(section && section.code || '').trim().toUpperCase();
    if (!mapCodes.has(sectionCode)) return;
    const records = Array.isArray(section && section.records) ? section.records : [];
    records.forEach((record) => {
      getFieldCollection(record).forEach((field) => addSample({
        tabKey: 'map',
        tab: mapTab,
        sectionCode,
        holder: record,
        field,
        source: 'map fields',
        kind: 'map'
      }));
    });
  });

  ['title', 'description'].forEach((key) => {
    const field = getScenarioSettingsField(bundle, key);
    const sampleKey = makeBiqInventoryKey('GAME', key);
    if (field && !samples.has(sampleKey)) {
      samples.set(sampleKey, {
        tabKey: 'scenarioSettings',
        tab: tabs.scenarioSettings,
        sectionCode: 'GAME',
        holder: getScenarioSettingsRecord(bundle),
        field,
        source: 'scenario header synthetic fields',
        kind: 'structure'
      });
    }
  });

  return samples;
}

function collectGeneratedBiqMutationCoverage(bundle) {
  const coverage = new Map();
  const tabs = bundle && bundle.tabs ? bundle.tabs : {};

  const referenceCoverage = [
    {
      tabKey: 'civilizations',
      sectionCode: 'RACE',
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    {
      tabKey: 'technologies',
      sectionCode: 'TECH',
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    {
      tabKey: 'resources',
      sectionCode: 'GOOD',
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    {
      tabKey: 'improvements',
      sectionCode: 'BLDG',
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    {
      tabKey: 'units',
      sectionCode: 'PRTO',
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    }
  ];
  referenceCoverage.forEach(({ tabKey, sectionCode, exclude }) => {
    const entries = Array.isArray(tabs[tabKey] && tabs[tabKey].entries) ? tabs[tabKey].entries : [];
    entries.forEach((entry) => addBiqCoverageFields(
      coverage,
      sectionCode,
      entry,
      'reference-tab generated field round-trip',
      { exclude }
    ));
  });

  const govEntries = Array.isArray(tabs.governments && tabs.governments.entries) ? tabs.governments.entries : [];
  govEntries.forEach((entry) => addBiqCoverageFields(
    coverage,
    'GOVT',
    entry,
    'government generated field round-trip',
    {
      exclude: (_field, baseKey) => (
        baseKey === 'civilopediaentry'
        || /^performanceofthisgovernmentversusgovernment\d+$/.test(baseKey)
      )
    }
  ));

  const structuredCoverage = [
    {
      sectionCode: 'GAME',
      tabKey: 'scenarioSettings',
      exclude: (_field, baseKey) => /^playableciv\d*$/.test(baseKey) || baseKey === 'numberofplayablecivs'
    },
    { sectionCode: 'LEAD', tabKey: 'players' },
    { sectionCode: 'RULE', tabKey: 'rules' },
    { sectionCode: 'TERR', tabKey: 'terrain' },
    {
      sectionCode: 'TFRM',
      tabKey: 'terrain',
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    { sectionCode: 'CTZN', tabKey: 'rules' },
    { sectionCode: 'CULT', tabKey: 'rules' },
    { sectionCode: 'DIFF', tabKey: 'rules' },
    { sectionCode: 'ERAS', tabKey: 'world' },
    { sectionCode: 'ESPN', tabKey: 'rules' },
    { sectionCode: 'EXPR', tabKey: 'rules' },
    { sectionCode: 'FLAV', tabKey: 'rules' },
    { sectionCode: 'WSIZ', tabKey: 'world' },
    { sectionCode: 'WCHR', tabKey: 'world' },
    { sectionCode: 'WMAP', tabKey: 'map' }
  ];
  structuredCoverage.forEach(({ sectionCode, tabKey, exclude }) => {
    const section = getSection(tabs[tabKey], sectionCode);
    const records = Array.isArray(section && section.records) ? section.records : [];
    records.forEach((record) => addBiqCoverageFields(
      coverage,
      sectionCode,
      record,
      'structured-section generated field round-trip',
      { exclude }
    ));
  });

  const mapCoverageCodes = ['TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY'];
  mapCoverageCodes.forEach((sectionCode) => {
    const section = getSection(tabs.map, sectionCode);
    const records = Array.isArray(section && section.records) ? section.records : [];
    records.forEach((record) => addBiqCoverageFields(
      coverage,
      sectionCode,
      record,
      'map mutation round-trip suites'
    ));
  });

  ['title', 'description'].forEach((fieldKey) => {
    addBiqCoverageField(coverage, 'GAME', fieldKey, 'scenario header round-trip');
  });

  return coverage;
}

function parseDisplayIndex(value) {
  const text = String(value || '').trim();
  const match = text.match(/\((-?\d+)\)\s*$/) || text.match(/^-?\d+/);
  return match ? Number.parseInt(match[1] || match[0], 10) : NaN;
}

function parseRawBiqFromDisk(biqPath) {
  let buf = fs.readFileSync(biqPath);
  const inflated = decompress(buf);
  if (inflated && inflated.ok && Buffer.isBuffer(inflated.data)) {
    buf = inflated.data;
  }
  const parsed = parseAllSections(buf);
  assert.equal(parsed && parsed.ok, true, 'expected raw BIQ parse to succeed');
  return parsed;
}

function getRawParsedSectionFromDisk(biqPath, code) {
  const parsed = parseRawBiqFromDisk(biqPath);
  return ((parsed && parsed.sections) || []).find((section) => String(section && section.code || '').toUpperCase() === String(code || '').toUpperCase()) || null;
}

test('BIQ round-trip persists tech tree coordinate edits on scenario copy', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);
  const beforeMagic = fs.readFileSync(scenarioBiq).subarray(0, 4).toString('latin1');

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.equal(Boolean(bundle && bundle.tabs && bundle.tabs.technologies), true);

  const tech = bundle.tabs.technologies.entries.find((entry) => entry.civilopediaKey === 'TECH_MAP_MAKING')
    || bundle.tabs.technologies.entries.find((entry) => findField(entry, 'x') && findField(entry, 'y'));
  assert.ok(tech, 'expected at least one tech with x/y BIQ coordinates');

  const xField = findField(tech, 'x');
  assert.ok(xField, 'expected tech X field');
  const original = Number(String(xField.value || '').replace(/[^\d-]+/g, ''));
  assert.ok(Number.isFinite(original), 'expected numeric original x value');
  xField.value = String(original + 9);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const afterMagic = fs.readFileSync(scenarioBiq).subarray(0, 4).toString('latin1');
  if (!beforeMagic.startsWith('BIC')) {
    assert.ok(afterMagic.startsWith('BIC'), 'compressed BIQ should be inflated and saved in editable BIQ form');
  }

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reTech = reloaded.tabs.technologies.entries.find((entry) => entry.civilopediaKey === tech.civilopediaKey);
  assert.ok(reTech, 'expected edited tech to exist after save/reload');
  const reX = findField(reTech, 'x');
  assert.ok(reX, 'expected reloaded tech X field');
  assert.equal(Number(String(reX.value || '').replace(/[^\d-]+/g, '')), original + 9);
});

test('BIQ round-trip persists Scenario Search Folder edits from UI payload', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const before = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const beforeField = getScenarioSettingsField(before, 'scenariosearchfolders');
  if (!beforeField) {
    t.skip('Sample BIQ has no Scenario Search Folders field.');
    return;
  }
  const originalValue = String(beforeField.value || '');
  beforeField.value = '__C3X_SHOULD_NOT_PERSIST__';

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: before.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const afterField = getScenarioSettingsField(reloaded, 'scenariosearchfolders');
  assert.ok(afterField, 'expected Scenario Search Folders field after reload');
  assert.notEqual(String(afterField.value || ''), originalValue);
  assert.equal(String(afterField.value || ''), '__C3X_SHOULD_NOT_PERSIST__');
});

test('BIQ round-trip persists scenario header title and description edits', () => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-title-description.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const titleField = getScenarioSettingsField(bundle, 'title');
  const descriptionField = getScenarioSettingsField(bundle, 'description');
  assert.ok(titleField, 'expected scenario Title field');
  assert.ok(descriptionField, 'expected scenario Description field');
  titleField.value = 'Saved Header Title';
  descriptionField.value = 'Saved header description from editor.';

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs,
    dirtyTabs: ['scenarioSettings']
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.equal(String(getScenarioSettingsField(reloaded, 'title')?.value || ''), 'Saved Header Title');
  assert.equal(String(getScenarioSettingsField(reloaded, 'description')?.value || ''), 'Saved header description from editor.');
});

test('scenario save auto-creates a sibling search folder for BIQs under shared Scenarios root', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const tmp = mkTmpDir();
  const civ3Root = path.join(tmp, 'Civ3');
  const scenariosRoot = path.join(civ3Root, 'Conquests', 'Scenarios');
  fs.mkdirSync(scenariosRoot, { recursive: true });
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(scenariosRoot, 'AutoFolderScenario.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const searchField = getScenarioSettingsField(bundle, 'scenariosearchfolders');
  if (!searchField) {
    t.skip('Sample BIQ has no Scenario Search Folder field.');
    return;
  }
  searchField.value = '';
  const flag = bundle.tabs.base.rows.find((row) => String(row && row.key || '').trim().toLowerCase() === 'flag');
  assert.ok(flag, 'expected base flag field');
  flag.value = 'false';

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const inferredDir = path.join(scenariosRoot, 'AutoFolderScenario');
  assert.equal(fs.existsSync(inferredDir), true);
  assert.equal(fs.statSync(inferredDir).isDirectory(), true);
  assert.equal(fs.existsSync(path.join(inferredDir, 'scenario.c3x_config.ini')), true);

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const field = getScenarioSettingsField(reloaded, 'scenariosearchfolders');
  assert.ok(field, 'expected Scenario Search Folder field after auto-localize save');
  assert.equal(String(field.value || '').trim(), 'AutoFolderScenario');
});

test('BIQ round-trip persists deterministic playable civilization list rewrites', (t) => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable playable civ fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const gameRecord = getScenarioSettingsRecord(bundle);
  if (!gameRecord) {
    t.skip('Sample BIQ has no GAME record.');
    return;
  }

  const fields = Array.isArray(gameRecord.fields) ? gameRecord.fields : [];
  const countField = getRecordField(gameRecord, 'numberofplayablecivs') || getRecordField(gameRecord, 'number_of_playable_civs');
  assert.ok(countField, 'expected GAME numberofplayablecivs field');

  const originalPlayable = fields
    .filter((field) => /^playable_civ(?:_\d+)?$/.test(String(field && (field.baseKey || field.key) || '').toLowerCase()))
    .map((field) => parseDisplayIndex(field.value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (originalPlayable.length < 2) {
    t.skip('Sample BIQ does not have enough playable civilizations to rewrite deterministically.');
    return;
  }

  const replacement = rewriteScenarioPlayableCivilizations(gameRecord, [originalPlayable[1], originalPlayable[0]]).sort((a, b) => a - b);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reGameRecord = getScenarioSettingsRecord(reloaded);
  assert.ok(reGameRecord, 'expected reloaded GAME record');
  const reCountField = getRecordField(reGameRecord, 'numberofplayablecivs') || getRecordField(reGameRecord, 'number_of_playable_civs');
  assert.ok(reCountField, 'expected reloaded count field');
  assert.equal(String(reCountField.value || ''), String(replacement.length));

  const rePlayable = (Array.isArray(reGameRecord.fields) ? reGameRecord.fields : [])
    .filter((field) => /^playable_civ(?:_\d+)?$/.test(String(field && (field.baseKey || field.key) || '').toLowerCase()))
    .map((field) => parseDisplayIndex(field.value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  assert.deepEqual(rePlayable, replacement);
});

test('BIQ round-trip keeps playable civilization rewrites separate from LEAD player count', (t) => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable LEAD no-map fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const leadSectionBefore = getSection(bundle.tabs.players, 'LEAD');
  const leadCountBefore = Array.isArray(leadSectionBefore && leadSectionBefore.records) ? leadSectionBefore.records.length : 0;
  if (leadCountBefore < 1) {
    t.skip('Sample BIQ has no LEAD player records.');
    return;
  }

  const gameRecord = getScenarioSettingsRecord(bundle);
  if (!gameRecord) {
    t.skip('Sample BIQ has no GAME record.');
    return;
  }
  const fields = Array.isArray(gameRecord.fields) ? gameRecord.fields : [];
  const countField = getRecordField(gameRecord, 'numberofplayablecivs') || getRecordField(gameRecord, 'number_of_playable_civs');
  assert.ok(countField, 'expected GAME numberofplayablecivs field');
  const playableFields = fields
    .filter((field) => /^playable_civ(?:_\d+)?$/.test(String(field && (field.baseKey || field.key) || '').toLowerCase()));
  const playableIds = playableFields
    .map((field) => parseDisplayIndex(field.value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (playableIds.length < 2) {
    t.skip('Sample BIQ does not expose enough playable civilizations.');
    return;
  }

  const replacement = [playableIds[1]];
  const preserved = fields.filter((field) => !/^playable_civ(?:_\d+)?$/.test(String(field && (field.baseKey || field.key) || '').toLowerCase()));
  const insertAt = Math.max(0, preserved.indexOf(countField) + 1);
  preserved.splice(insertAt, 0, {
    key: 'playable_civ_0',
    baseKey: 'playable_civ_0',
    label: 'Playable Civilization',
    value: String(replacement[0]),
    originalValue: '',
    editable: true
  });
  gameRecord.fields = preserved;
  countField.value = String(replacement.length);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const parsedGame = getRawParsedSectionFromDisk(scenarioBiq, 'GAME');
  const rawPlayable = (parsedGame && parsedGame.records && parsedGame.records[0] && Array.isArray(parsedGame.records[0].playableCivIds))
    ? parsedGame.records[0].playableCivIds.slice()
    : [];
  assert.deepEqual(rawPlayable, replacement);

  const parsedLead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  const leadCountAfter = Array.isArray(parsedLead && parsedLead.records) ? parsedLead.records.length : 0;
  assert.equal(leadCountAfter, leadCountBefore, 'GAME playable civ count must not resize LEAD players');
});

test('BIQ round-trip persists direct LEAD player add with Quint defaults', (t) => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable LEAD no-map fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const leadSectionBefore = getSection(bundle.tabs.players, 'LEAD');
  const leadCountBefore = Array.isArray(leadSectionBefore && leadSectionBefore.records) ? leadSectionBefore.records.length : 0;

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      players: {
        recordOps: [{ op: 'add', sectionCode: 'LEAD', newRecordRef: 'LEAD_QUINT_DEFAULT_TEST' }]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const parsedLead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  const records = Array.isArray(parsedLead && parsedLead.records) ? parsedLead.records : [];
  assert.equal(records.length, leadCountBefore + 1);

  const added = records[records.length - 1];
  assert.equal(added.customCivData, 0);
  assert.equal(added.humanPlayer, 0);
  assert.equal(added.civ, -3, 'new players should start as Any civilization');
  assert.equal(added.government, 1);
  assert.equal(added.initialEra, 0);
  assert.equal(added.difficulty, -2);
  assert.equal(added.startCash, 10);
  assert.equal(added.skipFirstTurn, 0);
  assert.equal(added.startEmbassies, 0);
  assert.deepEqual(added.startUnits, [
    { startUnitCount: 1, startUnitIndex: 0 },
    { startUnitCount: 1, startUnitIndex: 1 }
  ]);
  assert.equal(added.numStartUnits, 2);
});

test('BIQ round-trip persists LEAD Any difficulty as Conquests -2 sentinel', (t) => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable LEAD no-map fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const leadSection = getSection(bundle.tabs.players, 'LEAD');
  const leadRecord = leadSection && Array.isArray(leadSection.records) ? leadSection.records[0] : null;
  const difficultyField = getRecordField(leadRecord, 'difficulty');
  if (!difficultyField) {
    t.skip('Sample BIQ has no editable LEAD difficulty field.');
    return;
  }
  difficultyField.value = 'Any';

  const saveResult = saveBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq, tabs: bundle.tabs });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const parsedLead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  const savedRecord = parsedLead && Array.isArray(parsedLead.records) ? parsedLead.records[0] : null;
  assert.ok(savedRecord, 'expected saved LEAD record');
  assert.equal(savedRecord.difficulty, -2);
});

test('BIQ round-trip persists LEAD starting unit list edits', (t) => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable LEAD no-map fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const leadSection = getSection(bundle.tabs.players, 'LEAD');
  const leadRecord = leadSection && Array.isArray(leadSection.records) ? leadSection.records[0] : null;
  if (!leadRecord) {
    t.skip('Sample BIQ has no LEAD player record.');
    return;
  }

  const parseStartUnitFieldIndex = (field) => {
    const base = String(field && (field.baseKey || field.key) || '').toLowerCase();
    const match = base.match(/^starting_units_of_type_(.+)$/);
    if (!match) return null;
    const suffix = String(match[1] || '').trim().toLowerCase();
    const numeric = Number.parseInt(suffix, 10);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    if (suffix === 'settler') return 0;
    if (suffix === 'worker') return 1;
    return null;
  };
  const startUnitFields = (Array.isArray(leadRecord.fields) ? leadRecord.fields : [])
    .map((field) => ({ field, unitIndex: parseStartUnitFieldIndex(field) }))
    .filter((entry) => Number.isFinite(entry.unitIndex) && entry.unitIndex >= 0);
  if (startUnitFields.length < 1) {
    t.skip('Sample BIQ has no editable LEAD starting unit fields.');
    return;
  }

  const removeEntry = startUnitFields[0];
  const used = new Set(startUnitFields.map((entry) => entry.unitIndex));
  const unitEntries = (bundle.tabs.units && Array.isArray(bundle.tabs.units.entries)) ? bundle.tabs.units.entries : [];
  const addUnitIndex = unitEntries
    .map((entry, idx) => Number.isFinite(Number(entry && entry.biqIndex)) ? Number(entry.biqIndex) : idx)
    .find((idx) => Number.isFinite(idx) && idx >= 0 && !used.has(idx));
  if (!Number.isFinite(addUnitIndex)) {
    t.skip('Sample BIQ has no unused unit index to add as a starting unit.');
    return;
  }

  removeEntry.field.value = '0';
  leadRecord.fields.push({
    key: `starting_units_of_type_${addUnitIndex}`,
    baseKey: `starting_units_of_type_${addUnitIndex}`,
    label: 'Starting Unit',
    value: '3',
    originalValue: ''
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const parsedLead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  const savedLeadRecord = parsedLead && Array.isArray(parsedLead.records) ? parsedLead.records[0] : null;
  assert.ok(savedLeadRecord, 'expected saved LEAD record');
  const savedStartUnits = Array.isArray(savedLeadRecord.startUnits) ? savedLeadRecord.startUnits : [];
  assert.equal(
    savedStartUnits.some((entry) => Number(entry && entry.startUnitIndex) === removeEntry.unitIndex),
    false,
    'zero-count starting unit field should remove that unit from LEAD.startUnits'
  );
  const added = savedStartUnits.find((entry) => Number(entry && entry.startUnitIndex) === addUnitIndex);
  assert.ok(added, 'expected newly added starting unit to persist');
  assert.equal(Number(added.startUnitCount), 3);
  assert.equal(Number(savedLeadRecord.numStartUnits), savedStartUnits.length);
});

test('BIQ round-trip persists direct LEAD player delete', (t) => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable LEAD no-map fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const leadSectionBefore = getSection(bundle.tabs.players, 'LEAD');
  const leadCountBefore = Array.isArray(leadSectionBefore && leadSectionBefore.records) ? leadSectionBefore.records.length : 0;
  if (leadCountBefore < 2) {
    t.skip('Sample BIQ does not have enough LEAD records to delete deterministically.');
    return;
  }
  const fixedLeadCivsAfterDelete = leadSectionBefore.records
    .slice(0, leadCountBefore - 1)
    .map((record) => parseDisplayIndex(getRecordField(record, 'civ')?.value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  rewriteScenarioPlayableCivilizations(getScenarioSettingsRecord(bundle), fixedLeadCivsAfterDelete);
  if (!Array.isArray(bundle.tabs.players.recordOps)) bundle.tabs.players.recordOps = [];
  bundle.tabs.players.recordOps.push({ op: 'delete', sectionCode: 'LEAD', recordRef: `@INDEX:${leadCountBefore - 1}` });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const parsedLead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  const records = Array.isArray(parsedLead && parsedLead.records) ? parsedLead.records : [];
  assert.equal(records.length, leadCountBefore - 1);
});

test('BIQ round-trip syncs WMAP civilization count after direct LEAD player delete', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable map fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const leadSectionBefore = getSection(bundle.tabs.players, 'LEAD');
  const leadCountBefore = Array.isArray(leadSectionBefore && leadSectionBefore.records) ? leadSectionBefore.records.length : 0;
  if (leadCountBefore < 2) {
    t.skip('Sample BIQ does not have enough LEAD records to delete deterministically.');
    return;
  }
  const fixedLeadCivsAfterDelete = leadSectionBefore.records
    .slice(0, leadCountBefore - 1)
    .map((record) => parseDisplayIndex(getRecordField(record, 'civ')?.value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  rewriteScenarioPlayableCivilizations(getScenarioSettingsRecord(bundle), fixedLeadCivsAfterDelete);
  if (!Array.isArray(bundle.tabs.players.recordOps)) bundle.tabs.players.recordOps = [];
  bundle.tabs.players.recordOps.push({ op: 'delete', sectionCode: 'LEAD', recordRef: `@INDEX:${leadCountBefore - 1}` });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const wmap = getRawParsedSectionFromDisk(scenarioBiq, 'WMAP');
  const lead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  assert.equal(wmap.records[0].numCivs, lead.records.length);
  assert.equal(lead.records.length, leadCountBefore - 1);
});

test('BIQ round-trip persists array-backed projected and synthetic BIQ fields', (t) => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable playable civ fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });

  const techOptions = ((bundle.tabs.technologies && bundle.tabs.technologies.entries) || [])
    .filter((entry) => Number.isFinite(Number(entry && entry.biqIndex)));
  if (techOptions.length < 4) t.skip('Sample BIQ does not expose enough technology references for matrix edits.');

  const civEntry = ((bundle.tabs.civilizations && bundle.tabs.civilizations.entries) || []).find((entry) => findField(entry, 'freetech1index'));
  assert.ok(civEntry, 'expected civilization entry with free tech fields');
  const civFreeTech1 = findField(civEntry, 'freetech1index');
  const civFreeTech2 = findField(civEntry, 'freetech2index');
  assert.ok(civFreeTech1 && civFreeTech2, 'expected civilization free tech slots');
  civFreeTech1.value = String(techOptions[1].biqIndex);
  civFreeTech2.value = String(techOptions[2].biqIndex);

  const techEntry = ((bundle.tabs.technologies && bundle.tabs.technologies.entries) || []).find((entry) => findField(entry, 'prerequisite1'));
  assert.ok(techEntry, 'expected technology entry with prerequisite fields');
  const prereq1 = findField(techEntry, 'prerequisite1');
  const prereq2 = findField(techEntry, 'prerequisite2');
  assert.ok(prereq1 && prereq2, 'expected prerequisite fields');
  prereq1.value = String(techOptions[0].biqIndex);
  prereq2.value = String(techOptions[3].biqIndex);

  const govEntry = ((bundle.tabs.governments && bundle.tabs.governments.entries) || []).find((entry) => findField(entry, 'malerulertitle1'));
  assert.ok(govEntry, 'expected government entry with ruler title fields');
  const maleTitle1 = findField(govEntry, 'malerulertitle1');
  const femaleTitle1 = findField(govEntry, 'femalerulertitle1');
  assert.ok(maleTitle1 && femaleTitle1, 'expected ruler title fields');
  maleTitle1.value = 'Chief Tester';
  femaleTitle1.value = 'Chief Testeress';
  const canBribeFields = getRecordFields({ fields: govEntry.biqFields }, 'canbribe');
  const briberyFields = getRecordFields({ fields: govEntry.biqFields }, 'briberymodifier');
  const resistanceFields = getRecordFields({ fields: govEntry.biqFields }, 'resistancemodifier');
  if (canBribeFields[0]) canBribeFields[0].value = canBribeFields[0].value === '1' ? '0' : '1';
  if (briberyFields[0]) briberyFields[0].value = '33';
  if (resistanceFields[0]) resistanceFields[0].value = '44';

  const gameRecord = getScenarioSettingsRecord(bundle);
  assert.ok(gameRecord, 'expected GAME record');
  const gameFields = Array.isArray(gameRecord.fields) ? gameRecord.fields : [];
  const countField = getRecordField(gameRecord, 'numberofplayablecivs') || getRecordField(gameRecord, 'number_of_playable_civs');
  assert.ok(countField, 'expected GAME playable civ count field');
  const originalPlayable = gameFields
    .filter((field) => /^playable_civ(?:_\d+)?$/.test(String(field && (field.baseKey || field.key) || '').toLowerCase()))
    .map((field) => parseDisplayIndex(field.value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (originalPlayable.length < 2) {
    t.skip('Sample BIQ does not have enough playable civilizations.');
    return;
  }
  const playableReplacement = rewriteScenarioPlayableCivilizations(gameRecord, [originalPlayable[1], originalPlayable[0]]).sort((a, b) => a - b);
  const turnsField0 = getRecordField(gameRecord, 'turns_in_time_section_0');
  const perTurnField0 = getRecordField(gameRecord, 'time_per_turn_in_time_section_0');
  assert.ok(turnsField0 && perTurnField0, 'expected time scale fields');
  const expectedTurns = String((Number.parseInt(String(turnsField0.value || '0'), 10) || 0) + 5);
  const expectedPerTurn = String((Number.parseInt(String(perTurnField0.value || '0'), 10) || 0) + 1);
  turnsField0.value = expectedTurns;
  perTurnField0.value = expectedPerTurn;

  const terrTab = bundle.tabs.terrain;
  const terrSection = getSection(terrTab, 'TERR');
  assert.ok(terrSection && Array.isArray(terrSection.records) && terrSection.records.length > 0, 'expected TERR section');
  const terrRecord = terrSection.records[0];
  let terrMaskField = getRecordField(terrRecord, 'possible_resources_mask') || getRecordField(terrRecord, 'possibleResourcesMask');
  if (!terrMaskField) {
    terrMaskField = {
      key: 'possible_resources_mask',
      baseKey: 'possible_resources_mask',
      label: 'Possible Resources Mask',
      value: '1,0,0,0',
      originalValue: '0,0,0,0',
      editable: true
    };
    terrRecord.fields.push(terrMaskField);
  }
  const originalMask = String(terrMaskField.value || '').split(/[,\s]+/).filter(Boolean).map((part) => Number.parseInt(part, 10) ? 1 : 0);
  while (originalMask.length < 4) originalMask.push(0);
  originalMask[0] = originalMask[0] ? 0 : 1;
  originalMask[1] = originalMask[1] ? 0 : 1;
  const expectedMask = originalMask.join(',');
  terrMaskField.value = expectedMask;

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });

  const reloadedCivEntry = getEntryByCivKey(reloaded.tabs.civilizations.entries, civEntry.civilopediaKey);
  assert.ok(reloadedCivEntry, 'expected reloaded civilization entry');
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedCivEntry, 'freetech1index')?.value, -1), Number(techOptions[1].biqIndex));
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedCivEntry, 'freetech2index')?.value, -1), Number(techOptions[2].biqIndex));

  const reloadedTechEntry = getEntryByCivKey(reloaded.tabs.technologies.entries, techEntry.civilopediaKey);
  assert.ok(reloadedTechEntry, 'expected reloaded technology entry');
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedTechEntry, 'prerequisite1')?.value, -1), Number(techOptions[0].biqIndex));
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedTechEntry, 'prerequisite2')?.value, -1), Number(techOptions[3].biqIndex));

  const reloadedGovEntry = getEntryByCivKey(reloaded.tabs.governments.entries, govEntry.civilopediaKey);
  assert.ok(reloadedGovEntry, 'expected reloaded government entry');
  assert.equal(String(findField(reloadedGovEntry, 'malerulertitle1')?.value || ''), 'Chief Tester');
  assert.equal(String(findField(reloadedGovEntry, 'femalerulertitle1')?.value || ''), 'Chief Testeress');
  if (canBribeFields[0]) {
    const reloadedCanBribe = getRecordFields({ fields: reloadedGovEntry.biqFields }, 'canbribe');
    assert.ok(reloadedCanBribe[0], 'expected reloaded canbribe field');
    assert.equal(String(reloadedCanBribe[0].value || ''), String(canBribeFields[0].value || ''));
  }
  if (briberyFields[0]) {
    const reloadedBribery = getRecordFields({ fields: reloadedGovEntry.biqFields }, 'briberymodifier');
    assert.ok(reloadedBribery[0], 'expected reloaded bribery field');
    assert.equal(String(reloadedBribery[0].value || ''), '33');
  }
  if (resistanceFields[0]) {
    const reloadedResistance = getRecordFields({ fields: reloadedGovEntry.biqFields }, 'resistancemodifier');
    assert.ok(reloadedResistance[0], 'expected reloaded resistance field');
    assert.equal(String(reloadedResistance[0].value || ''), '44');
  }

  const reGameRecord = getScenarioSettingsRecord(reloaded);
  assert.ok(reGameRecord, 'expected reloaded GAME record');
  const rePlayable = (Array.isArray(reGameRecord.fields) ? reGameRecord.fields : [])
    .filter((field) => /^playable_civ(?:_\d+)?$/.test(String(field && (field.baseKey || field.key) || '').toLowerCase()))
    .map((field) => parseDisplayIndex(field.value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  assert.deepEqual(rePlayable, playableReplacement);
  assert.equal(String((getRecordField(reGameRecord, 'turns_in_time_section_0') || {}).value || ''), expectedTurns);
  assert.equal(String((getRecordField(reGameRecord, 'time_per_turn_in_time_section_0') || {}).value || ''), expectedPerTurn);

  const reTerrSection = getSection(reloaded.tabs.terrain, 'TERR');
  assert.ok(reTerrSection && reTerrSection.records[0], 'expected reloaded TERR record');
  const reTerrMaskField = getRecordField(reTerrSection.records[0], 'possibleResourcesMask');
  assert.ok(reTerrMaskField, 'expected reloaded terrain possible-resources mask field');
  assert.equal(String(reTerrMaskField.value || ''), expectedMask);
});

test('BIQ round-trip persists civilization city-name list deletions and edits', (t) => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable playable civ fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'city-list-roundtrip.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const civEntry = ((bundle.tabs.civilizations && bundle.tabs.civilizations.entries) || [])
    .find((entry) => getBiqFieldsByCanonicalPrefix(entry, 'cityname').length >= 2);
  assert.ok(civEntry, 'expected a civilization with at least two city names');

  const cityNameFields = getBiqFieldsByCanonicalPrefix(civEntry, 'cityname');
  cityNameFields[0].value = 'Codexburg';
  const cityCountField = findField(civEntry, 'numcitynames');
  assert.ok(cityCountField, 'expected civilization city-name count field');
  const fieldsToRemove = new Set(cityNameFields.slice(1));
  civEntry.biqFields = getFieldCollection(civEntry).filter((field) => !fieldsToRemove.has(field));
  cityCountField.value = '1';

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedCivEntry = getEntryByCivKey(reloaded.tabs.civilizations.entries, civEntry.civilopediaKey);
  assert.ok(reloadedCivEntry, 'expected reloaded civilization entry');
  const reloadedCityNames = getBiqFieldsByCanonicalPrefix(reloadedCivEntry, 'cityname').map((field) => String(field.value || ''));
  assert.deepEqual(reloadedCityNames, ['Codexburg']);
});

test('BIQ round-trip supports add/copy/delete record ops for technology section', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const importedRef = 'TECH_C3X_TEST_IMPORTED';
  const copiedRef = 'TECH_C3X_TEST_COPIED';

  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      technologies: {
        recordOps: [
          { op: 'add', newRecordRef: importedRef },
          { op: 'copy', sourceRef: 'TECH_POTTERY', newRecordRef: copiedRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'save add/copy failed'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.equal(biqSectionHasCivilopediaKey(afterAdd, 'TECH', importedRef), true);
  assert.equal(biqSectionHasCivilopediaKey(afterAdd, 'TECH', copiedRef), true);

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      technologies: {
        recordOps: [
          { op: 'delete', recordRef: importedRef },
          { op: 'delete', recordRef: copiedRef }
        ]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'save delete failed'));

  const afterDelete = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.equal(biqSectionHasCivilopediaKey(afterDelete, 'TECH', importedRef), false);
  assert.equal(biqSectionHasCivilopediaKey(afterDelete, 'TECH', copiedRef), false);
});

test('BIQ save keeps exact-width technology Civilopedia keys null-terminated', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-exact-width-key.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const exactWidthRef = 'TECH_HIGH_DENSITY_ENERGY_STORAGE';
  assert.equal(exactWidthRef.length, 32);
  const expectedStoredRef = exactWidthRef.slice(0, 31);

  const save = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      technologies: {
        recordOps: [
          { op: 'copy', sourceRef: 'TECH_POTTERY', newRecordRef: exactWidthRef }
        ]
      }
    }
  });
  assert.equal(save.ok, true, String(save.error || 'save exact-width key failed'));

  const bytes = fs.readFileSync(scenarioBiq);
  assert.equal(bytes.includes(Buffer.from(`${exactWidthRef}X`, 'latin1')), false);

  const afterSave = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.equal(biqSectionHasCivilopediaKey(afterSave, 'TECH', expectedStoredRef), true);
});

test('BIQ round-trip persists editable government fields from fixture BIQ', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'government-roundtrip.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const govEntry = ((bundle.tabs.governments && bundle.tabs.governments.entries) || []).find((entry) => {
    const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
    return fields.some((field) => field && field.editable);
  });
  assert.ok(govEntry, 'expected editable government entry');

  const techEntries = ((bundle.tabs.technologies && bundle.tabs.technologies.entries) || []);
  const exprSection = getSection(bundle.tabs.rules, 'EXPR');
  const espnSection = getSection(bundle.tabs.rules, 'ESPN');
  const exprCount = Array.isArray(exprSection && exprSection.records) ? exprSection.records.length : 0;
  const espnCount = Array.isArray(espnSection && espnSection.records) ? espnSection.records.length : 0;
  const expectedByField = new Map();
  const boolFields = new Set(['defaulttype', 'transitiontype', 'requiresmaintenance', 'tilepenalty', 'commercebonus', 'xenophobic', 'forceresettlement']);
  const textBoolFields = new Set(['requiresmaintenance', 'xenophobic', 'forceresettlement']);
  const stringFields = new Set(['name', 'malerulertitle1', 'femalerulertitle1', 'malerulertitle2', 'femalerulertitle2', 'malerulertitle3', 'femalerulertitle3', 'malerulertitle4', 'femalerulertitle4']);

  (govEntry.biqFields || []).forEach((field) => {
    if (!field || !field.editable) return;
    const baseKey = String(field.baseKey || field.key || '').toLowerCase();
    if (!baseKey || baseKey === 'civilopediaentry' || /^performance_of_this_government_versus_government_\d+$/.test(baseKey)) return;

    let nextValue = null;
    let expectedKind = 'number';
    if (boolFields.has(baseKey)) {
      const normalized = String(field.value || '').trim().toLowerCase();
      const isTrue = normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on' || normalized === 'enabled';
      nextValue = isTrue ? 'false' : 'true';
      expectedKind = textBoolFields.has(baseKey) ? 'boolText' : 'boolNumeric';
    } else if (stringFields.has(baseKey)) {
      nextValue = `${baseKey.toUpperCase()}_ROUNDTRIP`;
      expectedKind = 'string';
    } else if (baseKey === 'prerequisitetechnology') {
      const tech = techEntries.find((entry) => Number.isFinite(entry && entry.biqIndex) && Number(entry.biqIndex) >= 0);
      nextValue = tech ? String(tech.biqIndex) : '-1';
    } else if (baseKey === 'immuneto') {
      nextValue = espnCount > 0 ? String(Math.min(1, espnCount - 1)) : '-1';
    } else if (baseKey === 'diplomatlevel' || baseKey === 'spylevel') {
      nextValue = exprCount > 0 ? String(Math.min(1, exprCount - 1)) : '0';
    } else {
      const parsed = parseDisplayedReferenceIndex(field.value, NaN);
      const current = Number.isFinite(parsed) ? parsed : 0;
      nextValue = String(current + 1);
    }

    field.value = nextValue;
    expectedByField.set(baseKey, { kind: expectedKind, value: nextValue });
  });

  assert.ok(expectedByField.size > 0, 'expected at least one editable government field mutation');

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedGov = getEntryByCivKey(reloaded.tabs.governments.entries, govEntry.civilopediaKey);
  assert.ok(reloadedGov, 'expected reloaded government entry');

  expectedByField.forEach((expected, baseKey) => {
    const field = findField(reloadedGov, baseKey);
    assert.ok(field, `expected reloaded government field ${baseKey}`);
    if (expected.kind === 'boolText') {
      assert.equal(String(field.value || '').trim().toLowerCase(), expected.value, `expected ${baseKey} boolean value to persist`);
      return;
    }
    if (expected.kind === 'boolNumeric') {
      assert.equal(parseDisplayedReferenceIndex(field.value, NaN), expected.value === 'true' ? 1 : 0, `expected ${baseKey} numeric boolean value to persist`);
      return;
    }
    if (expected.kind === 'string') {
      assert.equal(String(field.value || ''), expected.value, `expected ${baseKey} string value to persist`);
      return;
    }
    assert.equal(parseDisplayedReferenceIndex(field.value, NaN), Number.parseInt(expected.value, 10), `expected ${baseKey} numeric value to persist`);
  });
});

test('BIQ round-trip persists unit AI strategy bit toggles from fixture BIQ', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'unit-ai-strategy-roundtrip.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitEntry = ((bundle.tabs.units && bundle.tabs.units.entries) || []).find((entry) => {
    return findField(entry, 'explorestrategy') && findField(entry, 'explorestrategy').editable;
  });
  assert.ok(unitEntry, 'expected editable unit entry with explorestrategy');

  const exploreField = findField(unitEntry, 'explorestrategy');
  const originalValue = String(exploreField.value || '').trim().toLowerCase();
  const expectedValue = originalValue === 'true' ? 'false' : 'true';
  exploreField.value = expectedValue;

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedUnit = getEntryByCivKey(reloaded.tabs.units.entries, unitEntry.civilopediaKey);
  assert.ok(reloadedUnit, `expected reloaded unit entry ${unitEntry.civilopediaKey}`);
  assert.equal(
    String((findField(reloadedUnit, 'explorestrategy') || {}).value || '').trim().toLowerCase(),
    expectedValue,
    'expected explorestrategy bit to persist'
  );
});

test('BIQ round-trip follows Quint PRTO strategy-map handling for duplicate-strategy units', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'unit-ai-quint-roundtrip.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const unitKey = 'PRTO_CHASQUIS_SCOUT';
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitEntry = getEntryByCivKey(bundle.tabs.units.entries, unitKey);
  assert.ok(unitEntry, `expected ${unitKey} unit entry`);
  assert.equal(String(findField(unitEntry, 'offence')?.value || '').trim().toLowerCase(), 'true');
  assert.equal(String(findField(unitEntry, 'explorestrategy')?.value || '').trim().toLowerCase(), 'true');

  findField(unitEntry, 'explorestrategy').value = 'false';

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedUnit = getEntryByCivKey(reloaded.tabs.units.entries, unitKey);
  assert.ok(reloadedUnit, `expected reloaded ${unitKey} unit entry`);
  assert.equal(String(findField(reloadedUnit, 'offence')?.value || '').trim().toLowerCase(), 'true');
  assert.equal(String(findField(reloadedUnit, 'explorestrategy')?.value || '').trim().toLowerCase(), 'false');

  const parsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(parsed.ok, true, String(parsed.error || 'parse failed'));
  const rawRecords = getRawPrtoRecordsByCivKey(parsed, unitKey);
  assert.equal(rawRecords.length, 1, 'expected Quint-style output to collapse to one Firaxis PRTO record when one strategy remains');
  assert.equal(Number(rawRecords[0].otherStrategy), -1);
  assert.equal(Number(rawRecords[0].AIStrategy), 1);

  findField(reloadedUnit, 'explorestrategy').value = 'true';
  const secondSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: reloaded.tabs
  });
  assert.equal(secondSave.ok, true, String(secondSave.error || 'second save failed'));

  const reparsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(reparsed.ok, true, String(reparsed.error || 'reparse failed'));
  const reparsedRecords = getRawPrtoRecordsByCivKey(reparsed, unitKey);
  assert.equal(reparsedRecords.length, 2, 'expected Quint-style output to emit one duplicate PRTO record per extra strategy');
  assert.deepEqual(
    reparsedRecords.map((record) => ({ other: Number(record.otherStrategy), ai: Number(record.AIStrategy) })),
    [{ other: -1, ai: 1 }, { other: 12, ai: 8 }]
  );
});

test('BIQ round-trip keeps adjacent unit AI strategy masks attached to the correct units', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'unit-ai-neighbor-regression.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const desiredMasks = new Map([
    ['PRTO_WARRIOR', 0b00000000000000000011], // Offence + Defence
    ['PRTO_ARCHER', 0b00000000000000001001], // Offence + Exploration
    ['PRTO_SPEARMAN', 0b00000000000010000010], // Defence + Air Defence
    ['PRTO_PIKEMAN', 0b00000000000001000010] // Defence + Air Bombard
  ]);

  const initialParsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(initialParsed.ok, true, String(initialParsed.error || 'initial parse failed'));
  const untouchedBefore = new Map([
    ['PRTO_SETTLER', getMergedRawPrtoStrategyMask(initialParsed, 'PRTO_SETTLER')],
    ['PRTO_CHASQUIS_SCOUT', getMergedRawPrtoStrategyMask(initialParsed, 'PRTO_CHASQUIS_SCOUT')],
    ['PRTO_JAVELIN_THROWER', getMergedRawPrtoStrategyMask(initialParsed, 'PRTO_JAVELIN_THROWER')]
  ]);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  desiredMasks.forEach((mask, unitKey) => {
    const entry = getEntryByCivKey(bundle.tabs.units.entries, unitKey);
    assert.ok(entry, `expected unit entry ${unitKey}`);
    setUnitAiStrategyMask(entry, mask);
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const afterStrategySave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterStrategySave.ok, true, String(afterStrategySave.error || 'parse after strategy save failed'));
  desiredMasks.forEach((mask, unitKey) => {
    assert.equal(getMergedRawPrtoStrategyMask(afterStrategySave, unitKey), mask, `${unitKey} should keep its assigned AI strategy mask`);
  });
  untouchedBefore.forEach((mask, unitKey) => {
    assert.equal(getMergedRawPrtoStrategyMask(afterStrategySave, unitKey), mask, `${unitKey} should not receive a neighboring unit's strategy bits`);
  });

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const worker = getEntryByCivKey(reloaded.tabs.units.entries, 'PRTO_WORKER');
  assert.ok(worker, 'expected Worker unit entry for unrelated edit');
  const workerCost = findField(worker, 'shieldcost');
  assert.ok(workerCost, 'expected Worker shield cost field');
  workerCost.value = String(mapCore.parseIntLoose(workerCost.value, 0) + 1);

  const unrelatedSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: reloaded.tabs
  });
  assert.equal(unrelatedSave.ok, true, String(unrelatedSave.error || 'unrelated save failed'));

  const afterUnrelatedSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterUnrelatedSave.ok, true, String(afterUnrelatedSave.error || 'parse after unrelated save failed'));
  desiredMasks.forEach((mask, unitKey) => {
    assert.equal(getMergedRawPrtoStrategyMask(afterUnrelatedSave, unitKey), mask, `${unitKey} should keep its AI strategy mask after an unrelated unit edit`);
  });
  untouchedBefore.forEach((mask, unitKey) => {
    assert.equal(getMergedRawPrtoStrategyMask(afterUnrelatedSave, unitKey), mask, `${unitKey} should remain untouched after an unrelated unit edit`);
  });
});

test('BIQ round-trip preserves pending newly added unit multi-strategy rows and existing neighbors', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'unit-ai-pending-add-regression.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const initialParsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(initialParsed.ok, true, String(initialParsed.error || 'initial parse failed'));
  const neighborBaselines = new Map();
  ['PRTO_WARRIOR', 'PRTO_ARCHER'].forEach((unitKey) => {
    const raw = getRawPrtoPrimaryRecordsByCivKey(initialParsed, unitKey)[0];
    assert.ok(raw, `expected raw primary ${unitKey}`);
    neighborBaselines.set(unitKey, {
      scalars: getRawPrtoScalarSnapshot(raw),
      mask: getMergedRawPrtoStrategyMask(initialParsed, unitKey)
    });
  });

  const newUnitRef = makeShortBiqTestRef('PRTO', 'AIADD');
  const expectedMask = 0b00000000000010000001; // Offence + Air Defence
  const expectedScalars = {
    requiredtech: 4,
    requiredresource1: 1,
    requiredresource2: -1,
    attack: 14,
    defence: 6,
    movement: 2,
    shieldcost: 95
  };

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitsTab = bundle.tabs.units;
  assert.ok(unitsTab && Array.isArray(unitsTab.entries), 'expected units tab entries');
  if (!Array.isArray(unitsTab.recordOps)) unitsTab.recordOps = [];
  const template = getEntryByCivKey(unitsTab.entries, 'PRTO_WARRIOR') || unitsTab.entries[0];
  assert.ok(template, 'expected unit template for pending add');
  const pending = makePendingBlankUnitEntry(template, newUnitRef, 'Pending Strategy Unit');
  setUnitName(pending, 'Pending Strategy Unit');
  setUnitScalarFields(pending, expectedScalars);
  setUnitAiStrategyMask(pending, expectedMask);

  unitsTab.entries.push(pending);
  unitsTab.recordOps.push({ op: 'add', newRecordRef: newUnitRef });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'pending add strategy save failed'));

  const parsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(parsed.ok, true, String(parsed.error || 'parse after pending add strategy save failed'));
  const rawPending = getRawPrtoPrimaryRecordsByCivKey(parsed, newUnitRef)[0];
  assert.ok(rawPending, 'expected pending added unit primary after save');
  assert.equal(String(rawPending.name || '').trim(), 'Pending Strategy Unit');
  assertRawPrtoScalarFields(rawPending, expectedScalars, 'Pending Strategy Unit');
  assertRawPrtoStrategyRows(parsed, newUnitRef, expectedMask, 'Pending Strategy Unit');

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedPending = getEntryByCivKey(reloaded.tabs.units.entries, newUnitRef);
  assertReloadedPrtoEntryFieldsMatchPreSave(pending, reloadedPending, 'Pending Strategy Unit');

  neighborBaselines.forEach((baseline, unitKey) => {
    const raw = getRawPrtoPrimaryRecordsByCivKey(parsed, unitKey)[0];
    assert.ok(raw, `expected neighboring primary ${unitKey} after save`);
    assertRawPrtoScalarFields(raw, baseline.scalars, `${unitKey} neighboring unit`);
    assert.equal(getMergedRawPrtoStrategyMask(parsed, unitKey), baseline.mask, `${unitKey} should keep neighboring AI strategy mask`);
  });
});

test('BIQ round-trip preserves unit AI strategies through pending copies and repeated saves', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'unit-ai-pending-copy-regression.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const copiedDefenderRef = makeShortBiqTestRef('PRTO', 'AIDF');
  const copiedAirRef = makeShortBiqTestRef('PRTO', 'AIAIR');
  const expectedMasks = new Map([
    ['PRTO_WARRIOR', 0b00000000000000000011], // Offence + Defence
    ['PRTO_ARCHER', 0b00000000000000001001], // Offence + Exploration
    ['PRTO_SPEARMAN', 0b00000000000000000110], // Defence + Artillery
    ['PRTO_PIKEMAN', 0b00000000000011000000], // Air Bombard + Air Defence
    [copiedDefenderRef, 0b00000000000000000011],
    [copiedAirRef, 0b00000000000011000000]
  ]);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitsTab = bundle.tabs.units;
  assert.ok(unitsTab && Array.isArray(unitsTab.entries), 'expected units tab entries');
  if (!Array.isArray(unitsTab.recordOps)) unitsTab.recordOps = [];

  ['PRTO_WARRIOR', 'PRTO_ARCHER', 'PRTO_SPEARMAN', 'PRTO_PIKEMAN'].forEach((unitKey) => {
    const entry = getEntryByCivKey(unitsTab.entries, unitKey);
    assert.ok(entry, `expected unit entry ${unitKey}`);
    setUnitAiStrategyMask(entry, expectedMasks.get(unitKey));
  });

  const warrior = getEntryByCivKey(unitsTab.entries, 'PRTO_WARRIOR');
  const pikeman = getEntryByCivKey(unitsTab.entries, 'PRTO_PIKEMAN');
  const copiedDefender = makePendingCopiedUnitEntry(warrior, copiedDefenderRef);
  const copiedAir = makePendingCopiedUnitEntry(pikeman, copiedAirRef);
  setUnitAiStrategyMask(copiedDefender, expectedMasks.get(copiedDefenderRef));
  setUnitAiStrategyMask(copiedAir, expectedMasks.get(copiedAirRef));
  unitsTab.entries.push(copiedDefender, copiedAir);
  unitsTab.recordOps.push(
    { op: 'copy', sourceRef: 'PRTO_WARRIOR', newRecordRef: copiedDefenderRef },
    { op: 'copy', sourceRef: 'PRTO_PIKEMAN', newRecordRef: copiedAirRef }
  );

  const firstSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(firstSave.ok, true, String(firstSave.error || 'first save failed'));

  const afterFirstSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterFirstSave.ok, true, String(afterFirstSave.error || 'parse after first save failed'));
  assertRawPrtoStrategyMasks(afterFirstSave, expectedMasks, 'first save');

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const nextMasks = new Map(expectedMasks);
  nextMasks.set('PRTO_WARRIOR', 0b00000000000000000010); // Defence only
  nextMasks.set(copiedDefenderRef, 0b00000000000000001001); // Offence + Exploration

  const reloadedWarrior = getEntryByCivKey(reloaded.tabs.units.entries, 'PRTO_WARRIOR');
  const reloadedCopiedDefender = getEntryByCivKey(reloaded.tabs.units.entries, copiedDefenderRef);
  const reloadedCopiedAir = getEntryByCivKey(reloaded.tabs.units.entries, copiedAirRef);
  const reloadedWorker = getEntryByCivKey(reloaded.tabs.units.entries, 'PRTO_WORKER');
  assert.ok(reloadedWarrior, 'expected reloaded Warrior unit entry');
  assert.ok(reloadedCopiedDefender, 'expected reloaded copied defender unit entry');
  assert.ok(reloadedCopiedAir, 'expected reloaded copied air unit entry');
  assert.ok(reloadedWorker, 'expected reloaded Worker unit entry');
  assertReloadedPrtoEntryFieldsMatchPreSave(copiedDefender, reloadedCopiedDefender, 'copied defender unit');
  assertReloadedPrtoEntryFieldsMatchPreSave(copiedAir, reloadedCopiedAir, 'copied air unit');
  setUnitAiStrategyMask(reloadedWarrior, nextMasks.get('PRTO_WARRIOR'));
  setUnitAiStrategyMask(reloadedCopiedDefender, nextMasks.get(copiedDefenderRef));
  const workerCost = findField(reloadedWorker, 'shieldcost');
  assert.ok(workerCost, 'expected Worker shield cost field');
  workerCost.value = String(mapCore.parseIntLoose(workerCost.value, 0) + 2);

  const secondSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: reloaded.tabs
  });
  assert.equal(secondSave.ok, true, String(secondSave.error || 'second save failed'));

  const afterSecondSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterSecondSave.ok, true, String(afterSecondSave.error || 'parse after second save failed'));
  assertRawPrtoStrategyMasks(afterSecondSave, nextMasks, 'second save');

  const reloadedAgain = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  if (!Array.isArray(reloadedAgain.tabs.units.recordOps)) reloadedAgain.tabs.units.recordOps = [];
  reloadedAgain.tabs.units.recordOps.push({ op: 'delete', recordRef: copiedAirRef });
  const archerAgain = getEntryByCivKey(reloadedAgain.tabs.units.entries, 'PRTO_ARCHER');
  assert.ok(archerAgain, 'expected reloaded Archer unit entry');
  nextMasks.set('PRTO_ARCHER', 0b00000000000000000001); // Offence only
  setUnitAiStrategyMask(archerAgain, nextMasks.get('PRTO_ARCHER'));

  const thirdSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: reloadedAgain.tabs
  });
  assert.equal(thirdSave.ok, true, String(thirdSave.error || 'third save failed'));

  const afterThirdSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterThirdSave.ok, true, String(afterThirdSave.error || 'parse after third save failed'));
  nextMasks.delete(copiedAirRef);
  assertRawPrtoStrategyMasks(afterThirdSave, nextMasks, 'third save');
  assert.equal(getRawPrtoRecordsByCivKey(afterThirdSave, copiedAirRef).length, 0, 'expected deleted copied air unit to be removed');
});

test('BIQ round-trip keeps same-Civilopedia-key unit AI strategies attached to the selected BIQ row', (t) => {
  const sampleBiq = findTidesOfCrimsonBiqPath();
  if (!sampleBiq) t.skip('Tides of Crimson BIQ not available for duplicate-key unit regression coverage.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'unit-ai-duplicate-key-regression.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const entries = (bundle.tabs.units && bundle.tabs.units.entries) || [];
  const byKey = new Map();
  entries.forEach((entry) => {
    const key = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
    if (!key || !Number.isFinite(Number(entry && entry.biqIndex))) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  });
  const duplicateGroup = Array.from(byKey.values()).find((group) => {
    const names = new Set(group.map((entry) => String(entry && entry.name || '').trim()).filter(Boolean));
    return group.length >= 2 && names.size >= 2;
  });
  assert.ok(duplicateGroup, 'expected at least one duplicate-key primary unit group');

  const first = duplicateGroup[0];
  const second = duplicateGroup.find((entry) => String(entry && entry.name || '').trim() !== String(first && first.name || '').trim());
  assert.ok(second, 'expected a second duplicate-key unit with a distinct name');
  assert.equal(String(first.civilopediaKey || '').toUpperCase(), String(second.civilopediaKey || '').toUpperCase(), 'expected duplicate-key unit pair');
  assert.notEqual(Number(first.biqIndex), Number(second.biqIndex), 'expected duplicate-key units to be separate BIQ rows');

  const firstName = String(first.name || '').trim();
  const secondName = String(second.name || '').trim();
  setUnitAiStrategyMask(first, 0b00000000000000000011); // Offence + Defence
  setUnitAiStrategyMask(second, 0b00000000000011000000); // Air Bombard + Air Defence

  const firstSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(firstSave.ok, true, String(firstSave.error || 'duplicate-key strategy save failed'));

  const afterFirstSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterFirstSave.ok, true, String(afterFirstSave.error || 'parse after duplicate-key strategy save failed'));
  const duplicateKeyPrimaries = getRawPrtoRecordsByCivKey(afterFirstSave, first.civilopediaKey)
    .filter((record) => {
      const otherStrategy = Number(record && record.otherStrategy);
      return !Number.isFinite(otherStrategy) || otherStrategy < 0;
    });
  assert.ok(duplicateKeyPrimaries.length >= 2, 'expected same-Civilopedia-key primary units to remain distinct after save');
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(afterFirstSave, firstName), 0b00000000000000000011, `${firstName} should keep its own strategy mask`);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(afterFirstSave, secondName), 0b00000000000011000000, `${secondName} should keep its own strategy mask`);

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedFirst = (reloaded.tabs.units.entries || []).find((entry) =>
    String(entry && entry.civilopediaKey || '').toUpperCase() === String(first.civilopediaKey || '').toUpperCase()
    && String(entry && entry.name || '').trim() === firstName);
  const reloadedSecond = (reloaded.tabs.units.entries || []).find((entry) =>
    String(entry && entry.civilopediaKey || '').toUpperCase() === String(second.civilopediaKey || '').toUpperCase()
    && String(entry && entry.name || '').trim() === secondName);
  assert.ok(reloadedFirst, 'expected first duplicate-key unit after reload');
  assert.ok(reloadedSecond, 'expected second duplicate-key unit after reload');
  setUnitAiStrategyMask(reloadedSecond, 0b00000000000000001001); // Offence + Exploration

  const secondSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: reloaded.tabs
  });
  assert.equal(secondSave.ok, true, String(secondSave.error || 'duplicate-key second strategy save failed'));

  const afterSecondSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterSecondSave.ok, true, String(afterSecondSave.error || 'parse after duplicate-key second strategy save failed'));
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(afterSecondSave, firstName), 0b00000000000000000011, `${firstName} should stay unchanged after editing its same-key sibling`);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(afterSecondSave, secondName), 0b00000000000000001001, `${secondName} should persist the later edit`);
});

test('BIQ round-trip keeps Civilization LEGENDS duplicate-key unit edits and copied adds attached without delete', (t) => {
  const sampleBiq = findCivilizationLegendsBiqPath();
  if (!sampleBiq) t.skip('Civilization LEGENDS BIQ not available for duplicate-key unit edit/copy regression coverage.');

  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'civilization-legends-duplicate-prto-edit-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitsTab = bundle.tabs.units;
  const entries = (unitsTab && unitsTab.entries) || [];
  const chariot = entries.find((entry) =>
    String(entry && entry.name || '').trim() === 'Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT');
  const warChariot = entries.find((entry) =>
    String(entry && entry.name || '').trim() === 'War Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT');
  assert.ok(chariot, 'expected Civilization LEGENDS Chariot duplicate-key unit');
  assert.ok(warChariot, 'expected Civilization LEGENDS War Chariot duplicate-key unit');
  assert.notEqual(Number(chariot.biqIndex), Number(warChariot.biqIndex), 'duplicate-key units must be distinct BIQ rows');

  const copyKey = makeShortBiqTestRef('PRTO', 'LEG_COPY');
  const copiedWarChariot = makePendingCopiedUnitEntry(warChariot, copyKey);
  setUnitName(copiedWarChariot, 'War Chariot Copy');

  const chariotFields = {
    requiredtech: 43,
    requiredresource1: 2,
    requiredresource2: -1,
    attack: 12,
    defence: 4,
    movement: 3,
    shieldcost: 88
  };
  const warChariotFields = {
    requiredtech: 45,
    requiredresource1: 7,
    requiredresource2: -1,
    attack: 9,
    defence: 3,
    movement: 2,
    shieldcost: 66
  };
  const copyFields = {
    requiredtech: 46,
    requiredresource1: 2,
    requiredresource2: 7,
    attack: 10,
    defence: 5,
    movement: 2,
    shieldcost: 77
  };
  setUnitScalarFields(chariot, chariotFields);
  setUnitAiStrategyMask(chariot, 0b00000000000000001001); // Offence + Exploration
  setUnitScalarFields(warChariot, warChariotFields);
  setUnitAiStrategyMask(warChariot, 0b00000000000000000011); // Offence + Defence
  setUnitScalarFields(copiedWarChariot, copyFields);
  setUnitAiStrategyMask(copiedWarChariot, 0b00000000000011000000); // Air Bombard + Air Defence

  unitsTab.entries = [chariot, warChariot, copiedWarChariot];
  unitsTab.recordOps = [
    { op: 'copy', sourceRef: `@INDEX:${Number(warChariot.biqIndex)}`, newRecordRef: copyKey }
  ];

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'Civilization LEGENDS duplicate-key edit/copy save failed'));

  const parsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(parsed.ok, true, String(parsed.error || 'parse after Civilization LEGENDS duplicate-key edit/copy save failed'));
  const rawChariot = getRawPrtoPrimaryByName(parsed, 'Chariot');
  const rawWarChariot = getRawPrtoPrimaryByName(parsed, 'War Chariot');
  const rawCopy = getRawPrtoPrimaryByName(parsed, 'War Chariot Copy');
  assert.ok(rawChariot, 'expected Chariot after save');
  assert.ok(rawWarChariot, 'expected War Chariot after save');
  assert.ok(rawCopy, 'expected copied War Chariot after save');
  assert.equal(getRawPrtoPrimaryRecordsByCivKey(parsed, 'PRTO_WAR_CHARIOT').length, 2, 'same-key primary units must remain separate after edit/copy save');
  assertRawPrtoScalarFields(rawChariot, chariotFields, 'Chariot');
  assertRawPrtoScalarFields(rawWarChariot, warChariotFields, 'War Chariot');
  assertRawPrtoScalarFields(rawCopy, copyFields, 'War Chariot Copy');
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(parsed, 'Chariot'), 0b00000000000000001001);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(parsed, 'War Chariot'), 0b00000000000000000011);
  assertRawPrtoStrategyRows(parsed, copyKey, 0b00000000000011000000, 'War Chariot Copy');

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedChariot = (reloaded.tabs.units.entries || []).find((entry) =>
    String(entry && entry.name || '').trim() === 'Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT');
  const reloadedWarChariot = (reloaded.tabs.units.entries || []).find((entry) =>
    String(entry && entry.name || '').trim() === 'War Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT');
  const reloadedCopy = (reloaded.tabs.units.entries || []).find((entry) =>
    String(entry && entry.name || '').trim() === 'War Chariot Copy'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === copyKey);
  assert.ok(reloadedChariot, 'expected reloaded Chariot');
  assert.ok(reloadedWarChariot, 'expected reloaded War Chariot');
  assert.ok(reloadedCopy, 'expected reloaded War Chariot Copy');
  assertReloadedPrtoEntryFieldsMatchPreSave(chariot, reloadedChariot, 'Chariot');
  assertReloadedPrtoEntryFieldsMatchPreSave(warChariot, reloadedWarChariot, 'War Chariot');
  assertReloadedPrtoEntryFieldsMatchPreSave(copiedWarChariot, reloadedCopy, 'War Chariot Copy');
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedChariot, 'requiredtech') && findField(reloadedChariot, 'requiredtech').value, NaN), chariotFields.requiredtech);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedWarChariot, 'requiredtech') && findField(reloadedWarChariot, 'requiredtech').value, NaN), warChariotFields.requiredtech);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedCopy, 'requiredtech') && findField(reloadedCopy, 'requiredtech').value, NaN), copyFields.requiredtech);
});

test('BIQ round-trip keeps Civilization LEGENDS duplicate-key unit edits attached across delete and replacement', (t) => {
  const sampleBiq = findCivilizationLegendsBiqPath();
  if (!sampleBiq) t.skip('Civilization LEGENDS BIQ not available for duplicate-key unit delete/replacement regression coverage.');

  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'civilization-legends-duplicate-prto-delete.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitsTab = bundle.tabs.units;
  const entries = (unitsTab && unitsTab.entries) || [];
  const survivor = entries.find((entry) =>
    String(entry && entry.name || '').trim() === 'Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT');
  const doomed = entries.find((entry) =>
    String(entry && entry.name || '').trim() === 'War Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT');
  assert.ok(survivor, 'expected Civilization LEGENDS Chariot duplicate-key unit');
  assert.ok(doomed, 'expected Civilization LEGENDS War Chariot duplicate-key unit');
  assert.notEqual(Number(survivor.biqIndex), Number(doomed.biqIndex), 'duplicate-key units must be distinct BIQ rows');

  const nextAfterDeleted = entries.find((entry) => Number(entry && entry.biqIndex) === Number(doomed.biqIndex) + 1);
  assert.ok(nextAfterDeleted, 'expected a unit row immediately after the deleted duplicate-key unit');
  const nextAfterDeletedName = String(nextAfterDeleted.name || '').trim();
  const nextAfterDeletedBaseline = {
    requiredTech: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'requiredtech') && findField(nextAfterDeleted, 'requiredtech').value, NaN),
    requiredResource1: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'requiredresource1') && findField(nextAfterDeleted, 'requiredresource1').value, NaN),
    requiredResource2: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'requiredresource2') && findField(nextAfterDeleted, 'requiredresource2').value, NaN),
    attack: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'attack') && findField(nextAfterDeleted, 'attack').value, NaN),
    shieldCost: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'shieldcost') && findField(nextAfterDeleted, 'shieldcost').value, NaN)
  };

  const replacementKey = makeShortBiqTestRef('PRTO', 'LEG_REPL');
  const replacement = makePendingCopiedUnitEntry(doomed, replacementKey);
  replacement.name = 'War Chariot Replacement';
  (replacement.biqFields || []).forEach((field) => {
    if (String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === 'name') field.value = replacement.name;
  });

  setFieldValue(survivor, 'requiredtech', '43');
  setFieldValue(survivor, 'requiredresource1', '2');
  setFieldValue(survivor, 'requiredresource2', '-1');
  setFieldValue(survivor, 'attack', '12');
  setFieldValue(survivor, 'defence', '4');
  setFieldValue(survivor, 'movement', '3');
  setFieldValue(survivor, 'shieldcost', '88');
  setUnitAiStrategyMask(survivor, 0b00000000000000001001); // Offence + Exploration

  setFieldValue(doomed, 'requiredtech', '7');
  setFieldValue(doomed, 'requiredresource1', '-1');
  setFieldValue(doomed, 'requiredresource2', '7');
  setFieldValue(doomed, 'attack', '1');
  setFieldValue(doomed, 'shieldcost', '22');

  setFieldValue(replacement, 'requiredtech', '45');
  setFieldValue(replacement, 'requiredresource1', '7');
  setFieldValue(replacement, 'requiredresource2', '-1');
  setFieldValue(replacement, 'attack', '9');
  setFieldValue(replacement, 'defence', '3');
  setFieldValue(replacement, 'movement', '2');
  setFieldValue(replacement, 'shieldcost', '66');
  setUnitAiStrategyMask(replacement, 0b00000000000000000011); // Offence + Defence

  unitsTab.entries = [survivor, doomed, replacement];
  unitsTab.recordOps = [
    { op: 'copy', sourceRef: `@INDEX:${Number(doomed.biqIndex)}`, newRecordRef: replacementKey },
    { op: 'delete', recordRef: `@INDEX:${Number(doomed.biqIndex)}` }
  ];

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'Civilization LEGENDS duplicate-key unit save failed'));

  const parsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(parsed.ok, true, String(parsed.error || 'parse after Civilization LEGENDS duplicate-key save failed'));
  const rawSurvivor = getRawPrtoPrimaryByName(parsed, 'Chariot');
  const rawDoomed = getRawPrtoPrimaryByName(parsed, 'War Chariot');
  const rawReplacement = getRawPrtoPrimaryByName(parsed, 'War Chariot Replacement');
  const rawNextAfterDeleted = getRawPrtoPrimaryByName(parsed, nextAfterDeletedName);
  assert.ok(rawSurvivor, 'expected Chariot survivor after save');
  assert.equal(rawDoomed, null, 'deleted War Chariot row must not remain');
  assert.ok(rawReplacement, 'expected replacement unit after save');
  assert.ok(rawNextAfterDeleted, `expected shifted neighbor "${nextAfterDeletedName}" after save`);

  assert.equal(Number(rawSurvivor.requiredTech), 43);
  assert.equal(Number(rawSurvivor.requiredResource1), 2);
  assert.equal(Number(rawSurvivor.requiredResource2), -1);
  assert.equal(Number(rawSurvivor.attack), 12);
  assert.equal(Number(rawSurvivor.defence), 4);
  assert.equal(Number(rawSurvivor.movement), 3);
  assert.equal(Number(rawSurvivor.shieldCost), 88);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(parsed, 'Chariot'), 0b00000000000000001001);

  assert.equal(Number(rawReplacement.requiredTech), 45);
  assert.equal(Number(rawReplacement.requiredResource1), 7);
  assert.equal(Number(rawReplacement.requiredResource2), -1);
  assert.equal(Number(rawReplacement.attack), 9);
  assert.equal(Number(rawReplacement.defence), 3);
  assert.equal(Number(rawReplacement.movement), 2);
  assert.equal(Number(rawReplacement.shieldCost), 66);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(parsed, 'War Chariot Replacement'), 0b00000000000000000011);

  assert.equal(Number(rawNextAfterDeleted.requiredTech), nextAfterDeletedBaseline.requiredTech);
  assert.equal(Number(rawNextAfterDeleted.requiredResource1), nextAfterDeletedBaseline.requiredResource1);
  assert.equal(Number(rawNextAfterDeleted.requiredResource2), nextAfterDeletedBaseline.requiredResource2);
  assert.equal(Number(rawNextAfterDeleted.attack), nextAfterDeletedBaseline.attack);
  assert.equal(Number(rawNextAfterDeleted.shieldCost), nextAfterDeletedBaseline.shieldCost);
  assert.notEqual(Number(rawNextAfterDeleted.requiredTech), 7, 'deleted unit field edits must not poison the shifted neighbor row');
  assert.notEqual(Number(rawNextAfterDeleted.attack), 1, 'deleted unit stat edits must not poison the shifted neighbor row');

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedSurvivor = (reloaded.tabs.units.entries || []).find((entry) =>
    String(entry && entry.name || '').trim() === 'Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT');
  const reloadedReplacement = (reloaded.tabs.units.entries || []).find((entry) =>
    String(entry && entry.name || '').trim() === 'War Chariot Replacement'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === replacementKey);
  assert.ok(reloadedSurvivor, 'expected Chariot survivor after reload');
  assert.ok(reloadedReplacement, 'expected replacement unit after reload');
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedSurvivor, 'requiredtech') && findField(reloadedSurvivor, 'requiredtech').value, NaN), 43);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedSurvivor, 'requiredresource1') && findField(reloadedSurvivor, 'requiredresource1').value, NaN), 2);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedSurvivor, 'requiredresource2') && findField(reloadedSurvivor, 'requiredresource2').value, NaN), -1);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedSurvivor, 'attack') && findField(reloadedSurvivor, 'attack').value, NaN), 12);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedReplacement, 'requiredtech') && findField(reloadedReplacement, 'requiredtech').value, NaN), 45);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedReplacement, 'attack') && findField(reloadedReplacement, 'attack').value, NaN), 9);
});

test('BIQ round-trip keeps 2021 Expansion PRTO strategy-map edits and copied adds attached without delete', (t) => {
  const sampleBiq = findExpansion2021BiqPath();
  if (!sampleBiq) t.skip('2021 EXPANSION BIQ not available for PRTO strategy-map edit/copy regression coverage.');

  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'expansion-2021-prto-strategy-edit-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitsTab = bundle.tabs.units;
  const entries = (unitsTab && unitsTab.entries) || [];
  const enkidu = entries.find((entry) =>
    String(entry && entry.name || '').trim() === 'Enkidu Warrior'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_ENKIDU_WARRIOR');
  const archer = entries.find((entry) =>
    String(entry && entry.name || '').trim() === 'Archer'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_ARCHER');
  assert.ok(enkidu, 'expected 2021 Expansion Enkidu Warrior unit with strategy-map duplicate');
  assert.ok(archer, 'expected 2021 Expansion Archer neighbor unit');
  assert.equal(Number(archer.biqIndex), Number(enkidu.biqIndex) + 1, 'fixture assumption: Archer follows Enkidu Warrior');

  const copyKey = makeShortBiqTestRef('PRTO', 'X21_COPY');
  const copiedEnkidu = makePendingCopiedUnitEntry(enkidu, copyKey);
  setUnitName(copiedEnkidu, 'Enkidu Warrior Copy');

  const enkiduFields = {
    requiredtech: 43,
    requiredresource1: 2,
    requiredresource2: -1,
    attack: 8,
    defence: 5,
    movement: 2,
    shieldcost: 52
  };
  const archerFields = {
    requiredtech: 44,
    requiredresource1: -1,
    requiredresource2: -1,
    attack: 6,
    defence: 2,
    movement: 1,
    shieldcost: 34
  };
  const copyFields = {
    requiredtech: 45,
    requiredresource1: 7,
    requiredresource2: -1,
    attack: 9,
    defence: 4,
    movement: 2,
    shieldcost: 64
  };
  setUnitScalarFields(enkidu, enkiduFields);
  setUnitAiStrategyMask(enkidu, 0b00000000000000000011); // Offence + Defence
  setUnitScalarFields(archer, archerFields);
  setUnitAiStrategyMask(archer, 0b00000000000000001001); // Offence + Exploration
  setUnitScalarFields(copiedEnkidu, copyFields);
  setUnitAiStrategyMask(copiedEnkidu, 0b00000000000000001001); // Offence + Exploration

  unitsTab.entries = [enkidu, archer, copiedEnkidu];
  unitsTab.recordOps = [
    { op: 'copy', sourceRef: `@INDEX:${Number(enkidu.biqIndex)}`, newRecordRef: copyKey }
  ];

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || '2021 Expansion PRTO strategy-map edit/copy save failed'));

  const parsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(parsed.ok, true, String(parsed.error || 'parse after 2021 Expansion strategy-map edit/copy save failed'));
  const rawEnkidu = getRawPrtoPrimaryByName(parsed, 'Enkidu Warrior');
  const rawArcher = getRawPrtoPrimaryByName(parsed, 'Archer');
  const rawCopy = getRawPrtoPrimaryByName(parsed, 'Enkidu Warrior Copy');
  assert.ok(rawEnkidu, 'expected Enkidu Warrior after save');
  assert.ok(rawArcher, 'expected Archer after save');
  assert.ok(rawCopy, 'expected copied Enkidu Warrior after save');
  assertRawPrtoScalarFields(rawEnkidu, enkiduFields, 'Enkidu Warrior');
  assertRawPrtoScalarFields(rawArcher, archerFields, 'Archer');
  assertRawPrtoScalarFields(rawCopy, copyFields, 'Enkidu Warrior Copy');
  assertRawPrtoStrategyRows(parsed, 'PRTO_ENKIDU_WARRIOR', 0b00000000000000000011, 'Enkidu Warrior');
  assertRawPrtoStrategyRows(parsed, 'PRTO_ARCHER', 0b00000000000000001001, 'Archer');
  assertRawPrtoStrategyRows(parsed, copyKey, 0b00000000000000001001, 'Enkidu Warrior Copy');

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedEnkidu = getEntryByCivKey(reloaded.tabs.units.entries, 'PRTO_ENKIDU_WARRIOR');
  const reloadedArcher = getEntryByCivKey(reloaded.tabs.units.entries, 'PRTO_ARCHER');
  const reloadedCopy = getEntryByCivKey(reloaded.tabs.units.entries, copyKey);
  assert.ok(reloadedEnkidu, 'expected reloaded Enkidu Warrior');
  assert.ok(reloadedArcher, 'expected reloaded Archer');
  assert.ok(reloadedCopy, 'expected reloaded Enkidu Warrior Copy');
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedEnkidu, 'requiredtech') && findField(reloadedEnkidu, 'requiredtech').value, NaN), enkiduFields.requiredtech);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedArcher, 'requiredtech') && findField(reloadedArcher, 'requiredtech').value, NaN), archerFields.requiredtech);
  assert.equal(parseDisplayedReferenceIndex(findField(reloadedCopy, 'requiredtech') && findField(reloadedCopy, 'requiredtech').value, NaN), copyFields.requiredtech);
});

test('BIQ round-trip keeps 2021 Expansion PRTO strategy-map rows attached after primary unit delete', (t) => {
  const sampleBiq = findExpansion2021BiqPath();
  if (!sampleBiq) t.skip('2021 EXPANSION BIQ not available for PRTO strategy-map delete regression coverage.');

  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'expansion-2021-prto-strategy-delete.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const initialParsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(initialParsed.ok, true, String(initialParsed.error || 'parse before 2021 strategy-map delete failed'));

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const unitsTab = bundle.tabs.units;
  const entries = (unitsTab && unitsTab.entries) || [];
  const doomed = entries.find((entry) =>
    String(entry && entry.name || '').trim() === 'Enkidu Warrior'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_ENKIDU_WARRIOR');
  assert.ok(doomed, 'expected 2021 Expansion Enkidu Warrior unit with strategy-map duplicate');

  const nextAfterDeleted = entries.find((entry) => Number(entry && entry.biqIndex) === Number(doomed.biqIndex) + 1);
  assert.ok(nextAfterDeleted, 'expected a unit row immediately after Enkidu Warrior');
  const nextAfterDeletedName = String(nextAfterDeleted.name || '').trim();
  assert.equal(nextAfterDeletedName, 'Archer', 'fixture assumption: Archer follows Enkidu Warrior');
  const laterStrategyUnitName = 'Legionary';
  const nextAfterDeletedBaseline = {
    requiredTech: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'requiredtech') && findField(nextAfterDeleted, 'requiredtech').value, NaN),
    requiredResource1: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'requiredresource1') && findField(nextAfterDeleted, 'requiredresource1').value, NaN),
    requiredResource2: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'requiredresource2') && findField(nextAfterDeleted, 'requiredresource2').value, NaN),
    attack: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'attack') && findField(nextAfterDeleted, 'attack').value, NaN),
    shieldCost: parseDisplayedReferenceIndex(findField(nextAfterDeleted, 'shieldcost') && findField(nextAfterDeleted, 'shieldcost').value, NaN),
    strategyMask: getMergedRawPrtoStrategyMaskByPrimaryName(initialParsed, nextAfterDeletedName)
  };
  const laterStrategyBaseline = getMergedRawPrtoStrategyMaskByPrimaryName(initialParsed, laterStrategyUnitName);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(initialParsed, 'Enkidu Warrior'), 0b00000000000000001001);
  assert.equal(nextAfterDeletedBaseline.strategyMask, 0b00000000000000000001);
  assert.equal(laterStrategyBaseline, 0b00000000000000000011);

  setFieldValue(doomed, 'requiredtech', '7');
  setFieldValue(doomed, 'requiredresource1', '7');
  setFieldValue(doomed, 'requiredresource2', '-1');
  setFieldValue(doomed, 'attack', '1');
  setFieldValue(doomed, 'shieldcost', '22');

  unitsTab.entries = [doomed];
  unitsTab.recordOps = [
    { op: 'delete', recordRef: `@INDEX:${Number(doomed.biqIndex)}` }
  ];

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || '2021 Expansion PRTO strategy-map delete save failed'));

  const parsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(parsed.ok, true, String(parsed.error || 'parse after 2021 strategy-map delete failed'));
  const rawDoomed = getRawPrtoPrimaryByName(parsed, 'Enkidu Warrior');
  const rawNextAfterDeleted = getRawPrtoPrimaryByName(parsed, nextAfterDeletedName);
  assert.equal(rawDoomed, null, 'deleted Enkidu Warrior primary row must not remain');
  assert.ok(rawNextAfterDeleted, `expected shifted neighbor "${nextAfterDeletedName}" after save`);

  const prto = (parsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'PRTO');
  const prtoRecords = Array.isArray(prto && prto.records) ? prto.records : [];
  assert.equal(
    prtoRecords.filter((record) => String(record && record.name || '').trim() === 'Enkidu Warrior').length,
    0,
    'deleted Enkidu Warrior strategy-map duplicate row must be removed with its primary'
  );

  assert.equal(Number(rawNextAfterDeleted.requiredTech), nextAfterDeletedBaseline.requiredTech);
  assert.equal(Number(rawNextAfterDeleted.requiredResource1), nextAfterDeletedBaseline.requiredResource1);
  assert.equal(Number(rawNextAfterDeleted.requiredResource2), nextAfterDeletedBaseline.requiredResource2);
  assert.equal(Number(rawNextAfterDeleted.attack), nextAfterDeletedBaseline.attack);
  assert.equal(Number(rawNextAfterDeleted.shieldCost), nextAfterDeletedBaseline.shieldCost);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(parsed, nextAfterDeletedName), nextAfterDeletedBaseline.strategyMask);
  assert.equal(getMergedRawPrtoStrategyMaskByPrimaryName(parsed, laterStrategyUnitName), laterStrategyBaseline);
});

test('BIQ round-trip preserves civilization flavor masks across later unrelated civilization edits', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'civilization-flavor-regression.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const desiredFlavorMasks = new Map([
    ['RACE_MOCHE', 0b0000101],
    ['RACE_AZTECS', 0b0000010],
    ['RACE_OLMECS', 0b1000001]
  ]);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  desiredFlavorMasks.forEach((mask, civKey) => {
    const entry = getEntryByCivKey(bundle.tabs.civilizations.entries, civKey);
    assert.ok(entry, `expected civilization entry ${civKey}`);
    setCivilizationFlavorMask(entry, mask);
  });

  const flavorSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['civilizations'],
    tabs: bundle.tabs
  });
  assert.equal(flavorSave.ok, true, String(flavorSave.error || 'flavor save failed'));

  const afterFlavorSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterFlavorSave.ok, true, String(afterFlavorSave.error || 'parse after flavor save failed'));
  desiredFlavorMasks.forEach((mask, civKey) => {
    assert.equal(getRawRaceFlavorMask(afterFlavorSave, civKey), mask, `${civKey} should persist its assigned flavor mask`);
  });

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mayans = getEntryByCivKey(reloaded.tabs.civilizations.entries, 'RACE_MAYANS');
  assert.ok(mayans, 'expected Mayans civilization entry for unrelated edit');
  const adjective = findField(mayans, 'adjective');
  assert.ok(adjective, 'expected Mayans adjective field');
  adjective.value = `${String(adjective.value || 'Mayan').trim()} Test`;

  const unrelatedSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['civilizations'],
    tabs: reloaded.tabs
  });
  assert.equal(unrelatedSave.ok, true, String(unrelatedSave.error || 'unrelated civilization save failed'));

  const afterUnrelatedSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterUnrelatedSave.ok, true, String(afterUnrelatedSave.error || 'parse after unrelated civilization save failed'));
  desiredFlavorMasks.forEach((mask, civKey) => {
    assert.equal(getRawRaceFlavorMask(afterUnrelatedSave, civKey), mask, `${civKey} should keep its flavor mask after an unrelated civilization edit`);
  });
});

test('BIQ round-trip preserves civilization flavors through pending copies and repeated saves', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'civilization-flavor-pending-copy-regression.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const copiedBuilderRef = makeShortBiqTestRef('RACE', 'FLBLD');
  const copiedWarriorRef = makeShortBiqTestRef('RACE', 'FLWAR');
  const expectedMasks = new Map([
    ['RACE_MOCHE', 0b0000001], // Warrior
    ['RACE_AZTECS', 0b0000010], // Balanced
    ['RACE_OLMECS', 0b0000100], // Builder
    ['RACE_TOLTECS', 0b0000101], // Warrior + Builder
    [copiedBuilderRef, 0b0000100],
    [copiedWarriorRef, 0b0000011] // Warrior + Balanced
  ]);

  const initialParsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(initialParsed.ok, true, String(initialParsed.error || 'initial parse failed'));
  const untouchedBefore = new Map([
    ['RACE_INCANS', getRawRaceFlavorMask(initialParsed, 'RACE_INCANS')],
    ['RACE_MAYANS', getRawRaceFlavorMask(initialParsed, 'RACE_MAYANS')]
  ]);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const civsTab = bundle.tabs.civilizations;
  assert.ok(civsTab && Array.isArray(civsTab.entries), 'expected civilization tab entries');
  if (!Array.isArray(civsTab.recordOps)) civsTab.recordOps = [];

  ['RACE_MOCHE', 'RACE_AZTECS', 'RACE_OLMECS', 'RACE_TOLTECS'].forEach((civKey) => {
    const entry = getEntryByCivKey(civsTab.entries, civKey);
    assert.ok(entry, `expected civilization entry ${civKey}`);
    setCivilizationFlavorMask(entry, expectedMasks.get(civKey));
  });

  const moche = getEntryByCivKey(civsTab.entries, 'RACE_MOCHE');
  const aztecs = getEntryByCivKey(civsTab.entries, 'RACE_AZTECS');
  const copiedBuilder = makePendingCopiedCivilizationEntry(moche, copiedBuilderRef);
  const copiedWarrior = makePendingCopiedCivilizationEntry(aztecs, copiedWarriorRef);
  setCivilizationFlavorMask(copiedBuilder, expectedMasks.get(copiedBuilderRef));
  setCivilizationFlavorMask(copiedWarrior, expectedMasks.get(copiedWarriorRef));
  civsTab.entries.push(copiedBuilder, copiedWarrior);
  civsTab.recordOps.push(
    { op: 'copy', sourceRef: 'RACE_MOCHE', newRecordRef: copiedBuilderRef },
    { op: 'copy', sourceRef: 'RACE_AZTECS', newRecordRef: copiedWarriorRef }
  );

  const firstSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['civilizations'],
    tabs: bundle.tabs
  });
  assert.equal(firstSave.ok, true, String(firstSave.error || 'first flavor save failed'));

  const afterFirstSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterFirstSave.ok, true, String(afterFirstSave.error || 'parse after first flavor save failed'));
  assertRawRaceFlavorMasks(afterFirstSave, expectedMasks, 'first save');
  untouchedBefore.forEach((mask, civKey) => {
    assert.equal(getRawRaceFlavorMask(afterFirstSave, civKey), mask, `${civKey} should not receive a neighboring civilization's flavor bits`);
  });

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const nextMasks = new Map(expectedMasks);
  nextMasks.set('RACE_MOCHE', 0b0000100); // Builder only
  nextMasks.set(copiedBuilderRef, 0b0000001); // Warrior only

  const reloadedMoche = getEntryByCivKey(reloaded.tabs.civilizations.entries, 'RACE_MOCHE');
  const reloadedCopiedBuilder = getEntryByCivKey(reloaded.tabs.civilizations.entries, copiedBuilderRef);
  const reloadedMayans = getEntryByCivKey(reloaded.tabs.civilizations.entries, 'RACE_MAYANS');
  assert.ok(reloadedMoche, 'expected reloaded Moche civilization entry');
  assert.ok(reloadedCopiedBuilder, 'expected reloaded copied builder civilization entry');
  assert.ok(reloadedMayans, 'expected reloaded Mayans civilization entry');
  setCivilizationFlavorMask(reloadedMoche, nextMasks.get('RACE_MOCHE'));
  setCivilizationFlavorMask(reloadedCopiedBuilder, nextMasks.get(copiedBuilderRef));
  const adjective = findField(reloadedMayans, 'adjective');
  assert.ok(adjective, 'expected Mayans adjective field');
  adjective.value = `${String(adjective.value || 'Mayan').trim()} Flavor`;

  const secondSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['civilizations'],
    tabs: reloaded.tabs
  });
  assert.equal(secondSave.ok, true, String(secondSave.error || 'second flavor save failed'));

  const afterSecondSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterSecondSave.ok, true, String(afterSecondSave.error || 'parse after second flavor save failed'));
  assertRawRaceFlavorMasks(afterSecondSave, nextMasks, 'second save');
  assert.equal(getRawRaceFlavorMask(afterSecondSave, 'RACE_INCANS'), untouchedBefore.get('RACE_INCANS'), 'RACE_INCANS should remain untouched after second save');
  assert.equal(getRawRaceFlavorMask(afterSecondSave, 'RACE_MAYANS'), untouchedBefore.get('RACE_MAYANS'), 'RACE_MAYANS should keep its flavor mask after an unrelated adjective edit');

  const reloadedAgain = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  if (!Array.isArray(reloadedAgain.tabs.civilizations.recordOps)) reloadedAgain.tabs.civilizations.recordOps = [];
  reloadedAgain.tabs.civilizations.recordOps.push({ op: 'delete', recordRef: copiedWarriorRef });
  const olmecsAgain = getEntryByCivKey(reloadedAgain.tabs.civilizations.entries, 'RACE_OLMECS');
  assert.ok(olmecsAgain, 'expected reloaded Olmecs civilization entry');
  nextMasks.set('RACE_OLMECS', 0b0000110); // Balanced + Builder
  setCivilizationFlavorMask(olmecsAgain, nextMasks.get('RACE_OLMECS'));

  const thirdSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['civilizations'],
    tabs: reloadedAgain.tabs
  });
  assert.equal(thirdSave.ok, true, String(thirdSave.error || 'third flavor save failed'));

  const afterThirdSave = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(afterThirdSave.ok, true, String(afterThirdSave.error || 'parse after third flavor save failed'));
  nextMasks.delete(copiedWarriorRef);
  assertRawRaceFlavorMasks(afterThirdSave, nextMasks, 'third save');
  assert.equal(getRawRaceRecordsByCivKey(afterThirdSave, copiedWarriorRef).length, 0, 'expected deleted copied civilization to be removed');
  assert.equal(getRawRaceFlavorMask(afterThirdSave, 'RACE_INCANS'), untouchedBefore.get('RACE_INCANS'), 'RACE_INCANS should remain untouched after deleting a copied civilization');
  assert.equal(getRawRaceFlavorMask(afterThirdSave, 'RACE_MAYANS'), untouchedBefore.get('RACE_MAYANS'), 'RACE_MAYANS should keep its flavor mask after repeated saves');
});

test('BIQ generated mutation inventory covers every editable BIQ UI field', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: sampleBiq });
  const inventory = collectEditableBiqUiFieldInventory(bundle);
  const coverage = collectGeneratedBiqMutationCoverage(bundle);
  const missing = Array.from(inventory.keys()).filter((key) => !coverage.has(key)).sort();

  assert.deepEqual(
    missing,
    [],
    [
      'Every editable or synthetic BIQ UI field must be represented in generated BIQ mutation coverage.',
      'Add the field to a generated round-trip pass, or add a narrowly named coverage bucket only when generic mutation would violate BIQ/map invariants.',
      ...missing.map((key) => {
        const sources = Array.from(inventory.get(key) || []).sort().join(', ');
        return `- ${key} from ${sources || 'unknown inventory source'}`;
      })
    ].join('\n')
  );
});

test('BIQ editable field writer inventory emits save edits and accepted BIQ writes', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: sampleBiq });
  const inventory = collectEditableBiqUiFieldInventory(bundle);
  const samples = collectEditableBiqUiFieldSamples(bundle);
  const derivedNoOpKeys = new Set([
    'PRTO:numstealthtargets',
    'PRTO:numlegalunittelepads',
    'PRTO:numlegalbuildingtelepads',
    'RACE:uniquecivcounter'
  ].map((key) => {
    const [sectionCode, fieldKey] = key.split(':');
    return makeBiqInventoryKey(sectionCode, fieldKey);
  }));
  const mapResizeKeys = new Set(['WMAP:width', 'WMAP:height'].map((key) => {
    const [sectionCode, fieldKey] = key.split(':');
    return makeBiqInventoryKey(sectionCode, fieldKey);
  }));
  const nonMapEdits = [];
  const missingSamples = [];
  const missingCollectedEdits = [];

  Array.from(inventory.keys()).sort().forEach((key) => {
    if (derivedNoOpKeys.has(key) || mapResizeKeys.has(key)) return;
    if (isPlayerSetupInvariantSensitiveInventoryKey(key)) return;
    const sample = samples.get(key);
    if (!sample) {
      missingSamples.push(key);
      return;
    }
    const field = sample.field;
    const originalValue = field.value;
    const originalOriginalValue = field.originalValue;
    const originalMapEditorValueEdited = field.mapEditorValueEdited;
    const mutation = computeGenericRoundtripMutation(field);
    field.originalValue = String(originalValue == null ? '' : originalValue);
    field.value = mutation.assigned;
    if (sample.kind === 'map') field.mapEditorValueEdited = true;

    let edits = [];
    if (sample.kind === 'reference') {
      edits = collectBiqReferenceEdits({ [sample.tabKey]: sample.tab });
    } else if (sample.kind === 'structure') {
      edits = collectBiqStructureEdits({ [sample.tabKey]: sample.tab });
    } else if (sample.kind === 'map') {
      edits = collectBiqMapEdits({ map: sample.tab });
    }

    field.value = originalValue;
    field.originalValue = originalOriginalValue;
    if (originalMapEditorValueEdited == null) delete field.mapEditorValueEdited;
    else field.mapEditorValueEdited = originalMapEditorValueEdited;

    if (!Array.isArray(edits) || edits.length === 0) {
      missingCollectedEdits.push(`${key} from ${sample.source}`);
      return;
    }
    if (sample.kind !== 'map') {
      nonMapEdits.push(...edits.map((edit) => ({ ...edit, __inventoryKey: key })));
    }
  });

  assert.deepEqual(missingSamples, [], `expected every editable BIQ field inventory key to have a representative sample:\n${missingSamples.join('\n')}`);
  assert.deepEqual(
    missingCollectedEdits,
    [],
    [
      'Every editable BIQ UI field must be wired into a save edit collector unless it is an explicit derived/no-op field.',
      ...missingCollectedEdits.map((key) => `- ${key}`)
    ].join('\n')
  );

  const resizeBundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: sampleBiq });
  const wmap = getSection(resizeBundle.tabs.map, 'WMAP');
  const wmapRecord = wmap && Array.isArray(wmap.records) ? wmap.records[0] : null;
  const widthField = getRecordField(wmapRecord, 'width');
  const heightField = getRecordField(wmapRecord, 'height');
  assert.ok(widthField && heightField, 'expected WMAP width/height fields for resize writer guard');
  const nextWidth = Math.max(2, (parseDisplayedReferenceIndex(widthField.value, 0) || 100) + 2);
  const nextHeight = Math.max(2, (parseDisplayedReferenceIndex(heightField.value, 0) || 100) + 2);
  widthField.value = String(nextWidth);
  heightField.value = String(nextHeight);
  resizeBundle.tabs.map.pendingMapResize = { width: nextWidth, height: nextHeight, fillTerrain: 0 };
  const resizeOps = collectBiqMapStructureOps({ map: resizeBundle.tabs.map });
  assert.equal(resizeOps.some((op) => String(op && op.op || '').toLowerCase() === 'resizemap'), true, 'expected WMAP width/height edits to use the resizemap writer path');

  const uniqueNonMapEdits = [];
  const seenEditKeys = new Set();
  nonMapEdits.forEach((edit) => {
    const editKey = `${edit.sectionCode}:${edit.recordRef}:${canonicalBiqInventoryKey(edit.fieldKey)}:${String(edit.value || '')}`;
    if (seenEditKeys.has(editKey)) return;
    seenEditKeys.add(editKey);
    const { __inventoryKey: _inventoryKey, ...cleanEdit } = edit;
    uniqueNonMapEdits.push(cleanEdit);
  });
  assert.ok(uniqueNonMapEdits.length > 0, 'expected collected non-map BIQ writer edits');

  const applyResult = applyEdits(fs.readFileSync(sampleBiq), uniqueNonMapEdits);
  assert.equal(applyResult.ok, true, String(applyResult.error || 'applyEdits failed'));
  assert.equal(Number(applyResult.skipped || 0), 0, String(applyResult.warning || 'expected no skipped BIQ writer edits'));
});

test('BIQ reference edit collection uses BIQ index for existing rows with blank Civilopedia keys', () => {
  const edits = collectBiqReferenceEdits({
    governments: {
      entries: [{
        civilopediaKey: '',
        biqIndex: 6,
        biqFields: [
          { baseKey: 'name', value: 'Blank Key Government', originalValue: 'Old Government' },
          { baseKey: 'civilopediaentry', value: '', originalValue: '' }
        ]
      }]
    }
  });

  assert.deepEqual(edits, [{
    sectionCode: 'GOVT',
    recordRef: '@INDEX:6',
    fieldKey: 'name',
    value: 'Blank Key Government'
  }]);
});

test('BIQ round-trip persists editable reference-tab fields across the other core BIQ tabs', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'reference-tabs-roundtrip.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const cases = [
    {
      tabKey: 'civilizations',
      entry: (bundle.tabs.civilizations.entries || [])[0],
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry' || baseKey === 'uniquecivcounter'
    },
    {
      tabKey: 'technologies',
      entry: (bundle.tabs.technologies.entries || [])[0],
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    {
      tabKey: 'resources',
      entry: (bundle.tabs.resources.entries || [])[0],
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    {
      tabKey: 'improvements',
      entry: (bundle.tabs.improvements.entries || [])[0],
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    },
    {
      tabKey: 'units',
      entry: (bundle.tabs.units.entries || [])[0],
      exclude: (_field, baseKey) => (
        baseKey === 'civilopediaentry'
        || baseKey === 'numstealthtargets'
        || baseKey === 'numlegalunittelepads'
        || baseKey === 'numlegalbuildingtelepads'
      )
    }
  ];

  const expectedByTab = new Map();
  cases.forEach(({ tabKey, entry, exclude }) => {
    assert.ok(entry && entry.civilopediaKey, `expected ${tabKey} fixture entry`);
    const expectations = mutateEditableFieldsForRoundtrip(entry, { exclude });
    assert.ok(expectations.length > 0, `expected editable ${tabKey} fields to mutate`);
    expectedByTab.set(tabKey, { civKey: entry.civilopediaKey, expectations });
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  expectedByTab.forEach(({ civKey, expectations }, tabKey) => {
    const reloadedEntry = getEntryByCivKey(reloaded.tabs[tabKey].entries, civKey);
    assert.ok(reloadedEntry, `expected reloaded ${tabKey} entry ${civKey}`);
    assertEditableFieldRoundtrip(reloadedEntry, expectations, `${tabKey}:${civKey}`);
  });
});

test('BIQ round-trip persists editable GAME, LEAD, RULE, TERR, and TFRM fields from fixture BIQ', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'structured-sections-roundtrip.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const cases = [
    {
      label: 'GAME',
      getRecord: (loaded) => getScenarioSettingsRecord(loaded),
      exclude: (_field, baseKey) => /^playable_civ(?:_\d+)?$/.test(baseKey) || baseKey === 'numberofplayablecivs' || baseKey === 'number_of_playable_civs'
    },
    {
      label: 'LEAD',
      getRecord: (loaded) => {
        const section = getSection(loaded.tabs.players, 'LEAD');
        return section && section.records ? section.records[0] : null;
      },
      exclude: (_field, baseKey) => baseKey === 'difficulty' || baseKey === 'civ'
    },
    {
      label: 'RULE',
      getRecord: (loaded) => {
        const section = getSection(loaded.tabs.rules, 'RULE');
        return section && section.records ? section.records[0] : null;
      }
    },
    {
      label: 'TERR',
      getRecord: (loaded) => {
        const section = getSection(loaded.tabs.terrain, 'TERR');
        return section && section.records ? section.records[0] : null;
      }
    },
    {
      label: 'TFRM',
      getRecord: (loaded) => {
        const section = getSection(loaded.tabs.terrain, 'TFRM');
        return section && section.records ? section.records[0] : null;
      },
      exclude: (_field, baseKey) => baseKey === 'civilopediaentry'
    }
  ];

  const expectedByLabel = new Map();
  cases.forEach(({ label, getRecord, exclude }) => {
    const record = getRecord(bundle);
    assert.ok(record, `expected ${label} fixture record`);
    const expectations = mutateEditableFieldsForRoundtrip(record, { exclude });
    assert.ok(expectations.length > 0, `expected editable ${label} fields to mutate`);
    expectedByLabel.set(label, { expectations, getRecord });
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  expectedByLabel.forEach(({ expectations, getRecord }, label) => {
    const record = getRecord(reloaded);
    assert.ok(record, `expected reloaded ${label} record`);
    assertEditableFieldRoundtrip(record, expectations, label);
  });
});

test('BIQ round-trip persists editable remaining structured BIQ section fields from fixture BIQ', () => {
  const sampleBiq = getStablePlayableCivsFixturePath();
  assert.ok(fs.existsSync(sampleBiq), `Fixture missing: ${sampleBiq}`);

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'remaining-structured-sections-roundtrip.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const cases = [
    { label: 'CTZN', getSection: (loaded) => getSection(loaded.tabs.rules, 'CTZN') },
    { label: 'CULT', getSection: (loaded) => getSection(loaded.tabs.rules, 'CULT') },
    { label: 'DIFF', getSection: (loaded) => getSection(loaded.tabs.rules, 'DIFF') },
    { label: 'ERAS', getSection: (loaded) => getSection(loaded.tabs.world, 'ERAS') },
    { label: 'ESPN', getSection: (loaded) => getSection(loaded.tabs.rules, 'ESPN') },
    { label: 'EXPR', getSection: (loaded) => getSection(loaded.tabs.rules, 'EXPR') },
    { label: 'FLAV', getSection: (loaded) => getSection(loaded.tabs.rules, 'FLAV') },
    { label: 'WSIZ', getSection: (loaded) => getSection(loaded.tabs.world, 'WSIZ') },
    { label: 'WCHR', getSection: (loaded) => getSection(loaded.tabs.world, 'WCHR') },
    { label: 'WMAP', getSection: (loaded) => getSection(loaded.tabs.map, 'WMAP') }
  ];

  const expectedByLabel = new Map();
  cases.forEach(({ label, getSection }) => {
    const section = getSection(bundle);
    assert.ok(section && Array.isArray(section.records) && section.records.length > 0, `expected ${label} fixture section`);
    section.records.forEach((record, index) => {
      record.sectionCode = label;
      const expectations = mutateEditableFieldsForRoundtrip(record, {
        exclude: (_field, baseKey) => label === 'WMAP' && baseKey === 'numcivs'
      });
      assert.ok(expectations.length > 0, `expected editable ${label} record ${index} fields to mutate`);
      expectedByLabel.set(`${label}:${index}`, { expectations, getSection, index });
    });
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  expectedByLabel.forEach(({ expectations, getSection, index }, label) => {
    const section = getSection(reloaded);
    assert.ok(section && Array.isArray(section.records) && section.records[index], `expected reloaded ${label} record`);
    assertEditableFieldRoundtrip(section.records[index], expectations, label);
  });
});

test('BIQ matrix set test persists edits across core reference sections', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const firstCivilizationEntry = Array.isArray(bundle.tabs.civilizations && bundle.tabs.civilizations.entries)
    ? bundle.tabs.civilizations.entries[0]
    : null;
  assert.ok(firstCivilizationEntry && firstCivilizationEntry.civilopediaKey, 'expected at least one civilization entry in scenario bundle');
  const matrix = [
    { tab: 'civilizations', key: firstCivilizationEntry.civilopediaKey },
    { tab: 'technologies', key: 'TECH_POTTERY' },
    { tab: 'resources', key: 'GOOD_ALUMINUM' },
    { tab: 'improvements', key: 'BLDG_BARRACKS' },
    { tab: 'governments', key: 'GOVT_DESPOTISM' },
    { tab: 'units', key: 'PRTO_WARRIOR' }
  ];

  const edits = [];
  matrix.forEach(({ tab, key }) => {
    const tabData = bundle.tabs[tab];
    const entry = getEntryByCivKey(tabData && tabData.entries, key)
      || (tabData && Array.isArray(tabData.entries) ? tabData.entries.find((e) => findField(e, 'name')) : null);
    assert.ok(entry, `expected entry for ${tab}:${key}`);
    const nameField = findMatrixEditableField(tab, entry);
    assert.ok(nameField, `expected name field for ${tab}:${entry.civilopediaKey}`);
    const original = String(nameField.value || '').trim();
    const next = `${original} X`;
    nameField.value = next;
    edits.push({ tab, civKey: entry.civilopediaKey, expectedName: next });
  });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  edits.forEach(({ tab, civKey, expectedName }) => {
    const entry = getEntryByCivKey(reloaded.tabs[tab] && reloaded.tabs[tab].entries, civKey);
    assert.ok(entry, `expected reloaded entry for ${tab}:${civKey}`);
    const nameField = findMatrixEditableField(tab, entry);
    assert.ok(nameField, `expected reloaded name field for ${tab}:${civKey}`);
    assert.equal(String(nameField.value || '').trim(), expectedName, `expected persisted name for ${tab}:${civKey}`);
  });
});

test('BIQ matrix copy/delete test works for multiple sections', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const base = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const copyPlan = [
    { tab: 'technologies', section: 'TECH', prefix: 'TECH', seed: 'TECH_POTTERY' },
    { tab: 'resources', section: 'GOOD', prefix: 'GOOD', seed: 'GOOD_ALUMINUM' },
    { tab: 'improvements', section: 'BLDG', prefix: 'BLDG', seed: 'BLDG_BARRACKS' },
    { tab: 'governments', section: 'GOVT', prefix: 'GOVT', seed: 'GOVT_DESPOTISM' }
  ];

  const addTabs = {};
  const createdRefs = [];
  copyPlan.forEach((spec) => {
    const entries = (base.tabs[spec.tab] && base.tabs[spec.tab].entries) || [];
    const source = getEntryByCivKey(entries, spec.seed) || entries[0];
    assert.ok(source, `expected source entry for ${spec.tab}`);
    const newRef = makeShortBiqTestRef(spec.prefix, 'COPY');
    addTabs[spec.tab] = {
      recordOps: [
        { op: 'copy', sourceRef: String(source.civilopediaKey || '').toUpperCase(), newRecordRef: newRef }
      ]
    };
    createdRefs.push({ section: spec.section, tab: spec.tab, ref: newRef });
  });

  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: addTabs
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'copy save failed'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  createdRefs.forEach((item) => {
    assert.equal(biqSectionHasCivilopediaKey(afterAdd, item.section, item.ref), true, `expected copied ref ${item.ref}`);
  });

  const delTabs = {};
  createdRefs.forEach((item) => {
    delTabs[item.tab] = {
      recordOps: [{ op: 'delete', recordRef: item.ref }]
    };
  });

  const delSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: delTabs
  });
  assert.equal(delSave.ok, true, String(delSave.error || 'delete save failed'));

  const afterDelete = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  createdRefs.forEach((item) => {
    assert.equal(biqSectionHasCivilopediaKey(afterDelete, item.section, item.ref), false, `expected deleted ref ${item.ref}`);
  });
});

test('BIQ delete cascade reindexes supported technology references end-to-end', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const techDeleteRef = 'TECH_C3X_DEL_A';
  const techShiftRef = 'TECH_C3X_DEL_B';

  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      technologies: {
        recordOps: [
          { op: 'add', newRecordRef: techDeleteRef },
          { op: 'add', newRecordRef: techShiftRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'save add failed'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteTechIndex = getBiqSectionRecordIndex(afterAdd, 'TECH', techDeleteRef);
  const shiftTechIndex = getBiqSectionRecordIndex(afterAdd, 'TECH', techShiftRef);
  assert.ok(deleteTechIndex >= 0, 'expected delete-target tech with BIQ index');
  assert.ok(shiftTechIndex >= 0, 'expected shift-target tech with BIQ index');

  const techHost = (afterAdd.tabs.technologies && afterAdd.tabs.technologies.entries || []).find((entry) =>
    entry && entry.civilopediaKey !== techDeleteRef && entry.civilopediaKey !== techShiftRef && findField(entry, 'prerequisite1')
  );
  if (!techHost) {
    t.skip('Sample BIQ did not expose enough editable TECH references.');
    return;
  }

  findField(techHost, 'prerequisite1').value = String(deleteTechIndex);
  findField(techHost, 'prerequisite2').value = String(shiftTechIndex);

  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      technologies: afterAdd.tabs.technologies
    }
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'save setup refs failed'));

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      technologies: {
        recordOps: [{ op: 'delete', recordRef: techDeleteRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'delete cascade save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedShiftTechIndex = getBiqSectionRecordIndex(reloaded, 'TECH', techShiftRef);
  assert.ok(reloadedShiftTechIndex >= 0, 'expected surviving tech after delete');
  const reTechHost = getEntryByCivKey(reloaded.tabs.technologies.entries, techHost.civilopediaKey);
  assert.equal(String(findField(reTechHost, 'prerequisite1').value), 'None', 'deleted self-tech prereq should clear to None');
  assert.equal(parseDisplayedReferenceIndex(findField(reTechHost, 'prerequisite2').value, -1), reloadedShiftTechIndex, 'higher self-tech prereq should decrement');
});

test('BIQ delete cascade reindexes supported resource references end-to-end', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const deleteGoodRef = 'GOOD_C3X_DEL_A';
  const shiftGoodRef = 'GOOD_C3X_DEL_B';

  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      resources: {
        recordOps: [
          { op: 'add', newRecordRef: deleteGoodRef },
          { op: 'add', newRecordRef: shiftGoodRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'save add failed'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteGoodIndex = getBiqSectionRecordIndex(afterAdd, 'GOOD', deleteGoodRef);
  const shiftGoodIndex = getBiqSectionRecordIndex(afterAdd, 'GOOD', shiftGoodRef);
  assert.ok(deleteGoodIndex >= 0, 'expected delete-target resource with BIQ index');
  assert.ok(shiftGoodIndex >= 0, 'expected shift-target resource with BIQ index');

  const unitHost = (afterAdd.tabs.units && afterAdd.tabs.units.entries || []).find((entry) =>
    entry && findField(entry, 'requiredresource1') && findField(entry, 'requiredresource2')
  );
  if (!unitHost) {
    t.skip('Sample BIQ did not expose enough editable unit resource references.');
    return;
  }

  findField(unitHost, 'requiredresource1').value = String(deleteGoodIndex);
  findField(unitHost, 'requiredresource2').value = String(shiftGoodIndex);

  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['districts'],
    tabs: afterAdd.tabs
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'save setup refs failed'));

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      resources: {
        recordOps: [{ op: 'delete', recordRef: deleteGoodRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'delete cascade save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedShiftGoodIndex = getBiqSectionRecordIndex(reloaded, 'GOOD', shiftGoodRef);
  assert.ok(reloadedShiftGoodIndex >= 0, 'expected surviving resource after delete');
  const reUnitHost = getEntryByCivKey(reloaded.tabs.units.entries, unitHost.civilopediaKey);
  assert.equal(String(findField(reUnitHost, 'requiredresource1').value), 'None', 'deleted unit resource prerequisite should clear to None');
  assert.equal(parseDisplayedReferenceIndex(findField(reUnitHost, 'requiredresource2').value, -1), reloadedShiftGoodIndex, 'higher unit resource prerequisite should decrement');
});

test('BIQ delete cascade reindexes supported government references end-to-end', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const deleteGovRef = 'GOVT_C3X_DEL_A';
  const shiftGovRef = 'GOVT_C3X_DEL_B';

  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      governments: {
        recordOps: [
          { op: 'add', newRecordRef: deleteGovRef },
          { op: 'add', newRecordRef: shiftGovRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'save add failed'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteGovIndex = getBiqSectionRecordIndex(afterAdd, 'GOVT', deleteGovRef);
  const shiftGovIndex = getBiqSectionRecordIndex(afterAdd, 'GOVT', shiftGovRef);
  assert.ok(deleteGovIndex >= 0, 'expected delete-target government with BIQ index');
  assert.ok(shiftGovIndex >= 0, 'expected shift-target government with BIQ index');

  const civHost = (afterAdd.tabs.civilizations && afterAdd.tabs.civilizations.entries || []).find((entry) =>
    entry && findField(entry, 'favoritegovernment') && findField(entry, 'shunnedgovernment')
  );
  if (!civHost) {
    t.skip('Sample BIQ did not expose enough editable civilization government references.');
    return;
  }

  findField(civHost, 'favoritegovernment').value = String(deleteGovIndex);
  findField(civHost, 'shunnedgovernment').value = String(shiftGovIndex);

  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: afterAdd.tabs
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'save setup refs failed'));

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      governments: {
        recordOps: [{ op: 'delete', recordRef: deleteGovRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'delete cascade save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedShiftGovIndex = getBiqSectionRecordIndex(reloaded, 'GOVT', shiftGovRef);
  assert.ok(reloadedShiftGovIndex >= 0, 'expected surviving government after delete');
  const reCivHost = getEntryByCivKey(reloaded.tabs.civilizations.entries, civHost.civilopediaKey);
  assert.equal(String(findField(reCivHost, 'favoritegovernment').value), 'None', 'deleted favorite government should clear to None');
  assert.equal(parseDisplayedReferenceIndex(findField(reCivHost, 'shunnedgovernment').value, -1), reloadedShiftGovIndex, 'higher shunned government should decrement');
});

test('BIQ delete cascade reindexes supported building references end-to-end', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const deleteBldgRef = 'BLDG_C3X_DEL_A';
  const shiftBldgRef = 'BLDG_C3X_DEL_B';

  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      improvements: {
        recordOps: [
          { op: 'add', newRecordRef: deleteBldgRef },
          { op: 'add', newRecordRef: shiftBldgRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'save add failed'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteBldgIndex = getBiqSectionRecordIndex(afterAdd, 'BLDG', deleteBldgRef);
  const shiftBldgIndex = getBiqSectionRecordIndex(afterAdd, 'BLDG', shiftBldgRef);
  assert.ok(deleteBldgIndex >= 0, 'expected delete-target building with BIQ index');
  assert.ok(shiftBldgIndex >= 0, 'expected shift-target building with BIQ index');

  const bldgHost = (afterAdd.tabs.improvements && afterAdd.tabs.improvements.entries || []).find((entry) =>
    entry && findField(entry, 'reqimprovement') && findField(entry, 'doubleshappiness')
  );
  if (!bldgHost) {
    t.skip('Sample BIQ did not expose enough editable building references.');
    return;
  }

  findField(bldgHost, 'reqimprovement').value = String(deleteBldgIndex);
  findField(bldgHost, 'doubleshappiness').value = String(shiftBldgIndex);

  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: afterAdd.tabs
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'save setup refs failed'));

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    dirtyTabs: ['districts'],
    tabs: {
      improvements: {
        recordOps: [{ op: 'delete', recordRef: deleteBldgRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'delete cascade save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedShiftBldgIndex = getBiqSectionRecordIndex(reloaded, 'BLDG', shiftBldgRef);
  assert.ok(reloadedShiftBldgIndex >= 0, 'expected surviving building after delete');
  const reBldgHost = getEntryByCivKey(reloaded.tabs.improvements.entries, bldgHost.civilopediaKey);
  assert.equal(parseDisplayedReferenceIndex(findField(reBldgHost, 'reqimprovement').value, -1), 0, 'deleted required improvement should reset to zero sentinel');
  assert.equal(parseDisplayedReferenceIndex(findField(reBldgHost, 'doubleshappiness').value, -1), reloadedShiftBldgIndex, 'higher doubles-happiness building should decrement');
});

test('BIQ delete cascade reindexes supported unit references end-to-end', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const unitEntries = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq }).tabs.units.entries || [];
  const unitSeed = unitEntries.find((entry) => String(entry && entry.civilopediaKey || '').trim());
  if (!unitSeed) {
    t.skip('Sample BIQ did not expose a unit seed for copy tests.');
    return;
  }

  const deleteUnitRef = 'PRTO_C3X_DEL_A';
  const shiftUnitRef = 'PRTO_C3X_DEL_B';
  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      units: {
        recordOps: [
          { op: 'copy', sourceRef: String(unitSeed.civilopediaKey || '').toUpperCase(), newRecordRef: deleteUnitRef },
          { op: 'copy', sourceRef: String(unitSeed.civilopediaKey || '').toUpperCase(), newRecordRef: shiftUnitRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'save add failed'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteUnitIndex = getBiqSectionRecordIndex(afterAdd, 'PRTO', deleteUnitRef);
  const shiftUnitIndex = getBiqSectionRecordIndex(afterAdd, 'PRTO', shiftUnitRef);
  assert.ok(deleteUnitIndex >= 0, 'expected delete-target unit with BIQ index');
  assert.ok(shiftUnitIndex >= 0, 'expected shift-target unit with BIQ index');

  const unitHost = (afterAdd.tabs.units && afterAdd.tabs.units.entries || []).find((entry) =>
    entry
      && String(entry.civilopediaKey || '').toUpperCase() !== deleteUnitRef
      && String(entry.civilopediaKey || '').toUpperCase() !== shiftUnitRef
      && findField(entry, 'upgradeto')
      && findField(entry, 'enslaveresultsin')
  );
  if (!unitHost) {
    t.skip('Sample BIQ did not expose enough editable unit references.');
    return;
  }

  findField(unitHost, 'upgradeto').value = String(deleteUnitIndex);
  findField(unitHost, 'enslaveresultsin').value = String(shiftUnitIndex);

  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: afterAdd.tabs
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'save setup refs failed'));

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      units: {
        recordOps: [{ op: 'delete', recordRef: deleteUnitRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'delete cascade save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedShiftUnitIndex = getBiqSectionRecordIndex(reloaded, 'PRTO', shiftUnitRef);
  assert.ok(reloadedShiftUnitIndex >= 0, 'expected surviving unit after delete');
  const reUnitHost = getEntryByCivKey(reloaded.tabs.units.entries, unitHost.civilopediaKey);
  assert.equal(String(findField(reUnitHost, 'upgradeto').value), 'None', 'deleted upgrade target should clear to None');
  assert.equal(parseDisplayedReferenceIndex(findField(reUnitHost, 'enslaveresultsin').value, -1), reloadedShiftUnitIndex, 'higher enslave-result unit should decrement');
});

test('BIQ CRUD sequence keeps civilization-linked unit and GAME references consistent end-to-end', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const before = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const civEntries = (before.tabs.civilizations && before.tabs.civilizations.entries) || [];
  if (civEntries.length < 4) {
    t.skip('Sample BIQ does not expose enough civilizations for CRUD sequencing.');
    return;
  }
  const leadSectionBefore = getSection(before.tabs.players, 'LEAD');
  const leadRecordsBefore = leadSectionBefore && Array.isArray(leadSectionBefore.records) ? leadSectionBefore.records : [];
  const usedLeadCivIndexes = new Set(
    leadRecordsBefore
      .map((record) => getRecordField(record, 'civ'))
      .map((field) => parseDisplayedReferenceIndex(field && field.value, NaN))
      .filter((value) => Number.isFinite(value) && value >= 0)
  );
  const deleteSeedRefs = civEntries
    .filter((entry) => String(entry && entry.civilopediaKey || '').trim())
    .filter((entry) => !usedLeadCivIndexes.has(Number(entry && entry.biqIndex)))
    .slice(-2)
    .map((entry) => String(entry.civilopediaKey || '').trim().toUpperCase());
  if (deleteSeedRefs.length < 2) {
    t.skip('Sample BIQ did not expose enough unused civilization refs for CRUD sequencing.');
    return;
  }

  if (civEntries.length > 30) {
    const freeSlotsSave = saveBundle({
      mode: 'scenario',
      c3xPath: c3x,
      civ3Path: civ3Root,
      scenarioPath: scenarioBiq,
      tabs: {
        civilizations: {
          recordOps: deleteSeedRefs.map((recordRef) => ({ op: 'delete', recordRef }))
        }
      }
    });
    assert.equal(freeSlotsSave.ok, true, String(freeSlotsSave.error || 'failed to free civ slots'));
  }

  const addDeleteRef = 'RACE_C3X_SEQ_A';
  const addShiftRef = 'RACE_C3X_SEQ_B';
  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      civilizations: {
        recordOps: [
          { op: 'add', newRecordRef: addDeleteRef },
          { op: 'add', newRecordRef: addShiftRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'failed to add test civilizations'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteCivIndex = getBiqSectionRecordIndex(afterAdd, 'RACE', addDeleteRef);
  const shiftCivIndex = getBiqSectionRecordIndex(afterAdd, 'RACE', addShiftRef);
  assert.ok(deleteCivIndex >= 0, 'expected delete-target civilization with BIQ index');
  assert.ok(shiftCivIndex >= 0, 'expected shift-target civilization with BIQ index');

  const unitHost = ((afterAdd.tabs.units && afterAdd.tabs.units.entries) || []).find((entry) =>
    entry
      && findField(entry, 'availableto')
      && String(entry.civilopediaKey || '').toUpperCase() !== addDeleteRef
      && String(entry.civilopediaKey || '').toUpperCase() !== addShiftRef
  );
  if (!unitHost) {
    t.skip('Sample BIQ did not expose a unit with an editable Available To field.');
    return;
  }
  findField(unitHost, 'availableto').value = String((1 << 0) | (1 << deleteCivIndex) | (1 << shiftCivIndex));

  const gameRecord = getScenarioSettingsRecord(afterAdd);
  if (!gameRecord) {
    t.skip('Sample BIQ has no GAME record.');
    return;
  }
  const gameFields = Array.isArray(gameRecord.fields) ? gameRecord.fields : [];
  const countField = getRecordField(gameRecord, 'numberofplayablecivs') || getRecordField(gameRecord, 'number_of_playable_civs');
  assert.ok(countField, 'expected GAME playable civ count field');
  const preservedGameFields = gameFields.filter((field) => !/^playable_civ(?:_\d+)?$/.test(String(field && (field.baseKey || field.key) || '').toLowerCase()));
  const playableIds = [deleteCivIndex, shiftCivIndex];
  const insertAt = Math.max(0, preservedGameFields.indexOf(countField) + 1);
  const rewrittenPlayable = playableIds.map((id, idx) => ({
    key: `playable_civ_${idx}`,
    baseKey: `playable_civ_${idx}`,
    label: 'Playable Civilization',
    value: String(id),
    originalValue: '',
    editable: true
  }));
  preservedGameFields.splice(insertAt, 0, ...rewrittenPlayable);
  gameRecord.fields = preservedGameFields;
  countField.value = String(playableIds.length);

  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: afterAdd.tabs
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'failed to save civ-linked setup'));

  const afterSet = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const afterSetUnitHost = getEntryByCivKey(afterSet.tabs.units.entries, unitHost.civilopediaKey);
  assert.ok(afterSetUnitHost, 'expected unit host after setup save');
  assert.deepEqual(
    decodeSigned32BitmaskIndices(findField(afterSetUnitHost, 'availableto').value),
    [0, deleteCivIndex, shiftCivIndex],
    'unit Available To setup should persist before delete'
  );
  const afterSetParsedGame = getRawParsedSectionFromDisk(scenarioBiq, 'GAME');
  const afterSetPlayable = (afterSetParsedGame && Array.isArray(afterSetParsedGame.records) && afterSetParsedGame.records[0] && Array.isArray(afterSetParsedGame.records[0].playableCivIds))
    ? afterSetParsedGame.records[0].playableCivIds.slice()
    : [];
  assert.deepEqual(afterSetPlayable, [deleteCivIndex, shiftCivIndex], 'GAME playable civ setup should persist before delete');

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      civilizations: {
        recordOps: [{ op: 'delete', recordRef: addDeleteRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'delete cascade save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  assert.equal(biqSectionHasCivilopediaKey(reloaded, 'RACE', addDeleteRef), false, 'expected deleted civilization to be gone');
  const reloadedShiftCivIndex = getBiqSectionRecordIndex(reloaded, 'RACE', addShiftRef);
  assert.ok(reloadedShiftCivIndex >= 0, 'expected surviving civilization after delete');

  const reUnitHost = getEntryByCivKey(reloaded.tabs.units.entries, unitHost.civilopediaKey);
  assert.ok(reUnitHost, 'expected reloaded unit host');
  assert.deepEqual(
    decodeSigned32BitmaskIndices(findField(reUnitHost, 'availableto').value),
    [0, reloadedShiftCivIndex],
    'unit Available To mask should drop deleted civ and shift surviving civ'
  );

  const reParsedGame = getRawParsedSectionFromDisk(scenarioBiq, 'GAME');
  const rePlayable = (reParsedGame && Array.isArray(reParsedGame.records) && reParsedGame.records[0] && Array.isArray(reParsedGame.records[0].playableCivIds))
    ? reParsedGame.records[0].playableCivIds.slice()
    : [];
  assert.deepEqual(rePlayable, [reloadedShiftCivIndex], 'GAME playable civ list should drop deleted civ and shift surviving civ');

});

test('BIQ CRUD sequence keeps LEAD civilization references consistent end-to-end', (t) => {
  const sampleBiq = getStableLeadNoMapFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable LEAD no-map fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const before = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const leadSectionBefore = getSection(before.tabs.players, 'LEAD');
  const leadRecordBefore = leadSectionBefore && Array.isArray(leadSectionBefore.records) ? leadSectionBefore.records[0] : null;
  const leadCivFieldBefore = getRecordField(leadRecordBefore, 'civ');
  if (!(leadRecordBefore && leadCivFieldBefore)) {
    t.skip('Sample BIQ has no editable LEAD civ reference.');
    return;
  }

  const civEntries = (before.tabs.civilizations && before.tabs.civilizations.entries) || [];
  if (civEntries.length < 4) {
    t.skip('Sample BIQ does not expose enough civilizations for CRUD sequencing.');
    return;
  }
  if (civEntries.length > 30) {
    const leadRecordsBefore = leadSectionBefore && Array.isArray(leadSectionBefore.records) ? leadSectionBefore.records : [];
    const usedLeadCivIndexes = new Set(
      leadRecordsBefore
        .map((record) => getRecordField(record, 'civ'))
        .map((field) => parseDisplayedReferenceIndex(field && field.value, NaN))
        .filter((value) => Number.isFinite(value) && value >= 0)
    );
    const deleteSeedRefs = civEntries
      .filter((entry) => String(entry && entry.civilopediaKey || '').trim())
      .filter((entry) => !usedLeadCivIndexes.has(Number(entry && entry.biqIndex)))
      .slice(-2)
      .map((entry) => String(entry.civilopediaKey || '').trim().toUpperCase());
    if (deleteSeedRefs.length < 2) {
      t.skip('Sample BIQ did not expose enough unused civilization refs for CRUD sequencing.');
      return;
    }

    const freeSlotsSave = saveBundle({
      mode: 'scenario',
      c3xPath: c3x,
      civ3Path: civ3Root,
      scenarioPath: scenarioBiq,
      tabs: {
        civilizations: {
          recordOps: deleteSeedRefs.map((recordRef) => ({ op: 'delete', recordRef }))
        }
      }
    });
    assert.equal(freeSlotsSave.ok, true, String(freeSlotsSave.error || 'failed to free civ slots'));
  }

  const addDeleteRef = 'RACE_C3X_LEAD_A';
  const addShiftRef = 'RACE_C3X_LEAD_B';
  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      civilizations: {
        recordOps: [
          { op: 'add', newRecordRef: addDeleteRef },
          { op: 'add', newRecordRef: addShiftRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'failed to add test civilizations'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const shiftCivIndex = getBiqSectionRecordIndex(afterAdd, 'RACE', addShiftRef);
  assert.ok(shiftCivIndex >= 0, 'expected shift-target civilization with BIQ index');

  const leadSection = getSection(afterAdd.tabs.players, 'LEAD');
  const leadRecord = leadSection && Array.isArray(leadSection.records) ? leadSection.records[0] : null;
  const leadCivField = getRecordField(leadRecord, 'civ');
  assert.ok(leadCivField, 'expected editable LEAD civ field');
  leadCivField.value = String(shiftCivIndex);

  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: afterAdd.tabs
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'failed to save LEAD setup'));

  const afterSetParsedLead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  const afterSetLeadRecord = afterSetParsedLead && Array.isArray(afterSetParsedLead.records) ? afterSetParsedLead.records[0] : null;
  assert.ok(afterSetLeadRecord, 'expected LEAD record after setup save');
  assert.equal(Number(afterSetLeadRecord.civ), shiftCivIndex, 'LEAD civ setup should persist before delete');

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      civilizations: {
        recordOps: [{ op: 'delete', recordRef: addDeleteRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'delete cascade save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedShiftCivIndex = getBiqSectionRecordIndex(reloaded, 'RACE', addShiftRef);
  assert.ok(reloadedShiftCivIndex >= 0, 'expected surviving civilization after delete');
  const reParsedLead = getRawParsedSectionFromDisk(scenarioBiq, 'LEAD');
  const reLeadRecord = reParsedLead && Array.isArray(reParsedLead.records) ? reParsedLead.records[0] : null;
  assert.ok(reLeadRecord, 'expected reloaded LEAD record');
  assert.equal(Number(reLeadRecord.civ), reloadedShiftCivIndex, 'LEAD civ reference should shift with surviving civ');
});

test('BIQ round-trip reindexes unit Available To after deleting a newly added civ', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const before = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteSeedRefs = ((before.tabs.civilizations && before.tabs.civilizations.entries) || [])
    .filter((entry) => String(entry && entry.civilopediaKey || '').trim())
    .slice(-2)
    .map((entry) => String(entry && entry.civilopediaKey || '').trim().toUpperCase());
  if (deleteSeedRefs.length < 2) {
    t.skip('Sample BIQ did not expose enough deletable civs.');
    return;
  }

  const freeSlotsSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      civilizations: {
        recordOps: deleteSeedRefs.map((recordRef) => ({ op: 'delete', recordRef }))
      }
    }
  });
  assert.equal(freeSlotsSave.ok, true, String(freeSlotsSave.error || 'failed to free civ slots'));

  const deleteRef = 'RACE_C3X_AVAIL_A';
  const shiftRef = 'RACE_C3X_AVAIL_B';
  const addSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      civilizations: {
        recordOps: [
          { op: 'add', newRecordRef: deleteRef },
          { op: 'add', newRecordRef: shiftRef }
        ]
      }
    }
  });
  assert.equal(addSave.ok, true, String(addSave.error || 'failed to add civs'));

  const afterAdd = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const deleteCivIndex = getBiqSectionRecordIndex(afterAdd, 'RACE', deleteRef);
  const shiftCivIndex = getBiqSectionRecordIndex(afterAdd, 'RACE', shiftRef);
  assert.ok(deleteCivIndex >= 0 && shiftCivIndex >= 0, 'expected added civ indices');

  const unitHost = ((afterAdd.tabs.units && afterAdd.tabs.units.entries) || []).find((entry) => entry && findField(entry, 'availableto'));
  if (!unitHost) {
    t.skip('Sample BIQ did not expose a unit with Available To.');
    return;
  }
  findField(unitHost, 'availableto').value = String((1 << 0) | (1 << deleteCivIndex) | (1 << shiftCivIndex));
  const setSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      units: { entries: [unitHost] }
    }
  });
  assert.equal(setSave.ok, true, String(setSave.error || 'failed to save unit availability setup'));

  const deleteSave = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      civilizations: {
        recordOps: [{ op: 'delete', recordRef: deleteRef }]
      }
    }
  });
  assert.equal(deleteSave.ok, true, String(deleteSave.error || 'failed to delete added civ'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reloadedShiftIndex = getBiqSectionRecordIndex(reloaded, 'RACE', shiftRef);
  assert.ok(reloadedShiftIndex >= 0, 'expected surviving added civ');
  const reloadedUnit = getEntryByCivKey(reloaded.tabs.units.entries, unitHost.civilopediaKey);
  assert.ok(reloadedUnit, 'expected reloaded unit');
  assert.deepEqual(
    decodeSigned32BitmaskIndices(findField(reloadedUnit, 'availableto').value),
    [0, reloadedShiftIndex]
  );
});

test('BIQ save blocks deleting a unit when concrete map-unit references still exist', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  if (!fs.existsSync(sampleBiq)) t.skip('Stable map-unit fixture BIQ is missing.');

  const civ3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-map-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle.tabs.map;
  const unitSection = getSection(mapTab, 'UNIT');
  const mapUnit = Array.isArray(unitSection && unitSection.records) ? unitSection.records[0] : null;
  if (!mapUnit) return t.skip('Sample BIQ has no map units.');

  const prtoIndex = getRecordInt(mapUnit, 'prtonumber', -1);
  if (prtoIndex < 0) return t.skip('Sample BIQ map unit does not reference a unit type.');

  const unitEntries = (bundle.tabs.units && bundle.tabs.units.entries) || [];
  const targetUnit = unitEntries.find((entry) => Number(entry && entry.biqIndex) === prtoIndex);
  if (!targetUnit) return t.skip('Could not resolve the unit type used by the map unit.');

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: {
      units: {
        recordOps: [{ op: 'delete', recordRef: String(targetUnit.civilopediaKey || '').toUpperCase() }]
      }
    }
  });

  assert.equal(saveResult.ok, false);
  assert.match(String(saveResult.error || ''), /Cannot save yet because deleted items are still in use\./);
  assert.match(String(saveResult.error || ''), /still used by .*Map Units:/);
});

test('BIQ map round-trip supports map painting + adding city/unit records', (t) => {
  const sampleBiq = findSampleMapBiqPath();
  if (!sampleBiq) t.skip('No map-enabled BIQ available. Set C3X_TEST_MAP_BIQ to run this test.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  if (!mapTab) {
    t.skip('Sample BIQ has no map tab.');
    return;
  }
  const sections = getMapSectionsOrSkip(t, mapTab, { minCityRecords: 0, minUnitRecords: 0 });
  if (!sections) return;
  const { tileSection, citySection, unitSection } = sections;

  const tile = tileSection.records[0];
  mapCore.setField(tile, 'baserealterrain', '0', 'Base Real Terrain');
  mapCore.setField(tile, 'c3cbaserealterrain', '0', 'C3C Base Real Terrain');
  mapCore.setField(tile, 'fogofwar', '1', 'Fog Of War');
  const seededTerrain = String(getRecordField(tile, 'baserealterrain') && getRecordField(tile, 'baserealterrain').value || '');
  const seededFog = String(getRecordField(tile, 'fogofwar') && getRecordField(tile, 'fogofwar').value || '');
  mapCore.applyTerrain(tileSection.records, [0], 2);
  mapCore.applyOverlay(tileSection.records, [0], 'road', true);
  mapCore.applyFog(tileSection.records, [0], true);
  mapCore.applyDistrict(tileSection.records, [0], 1, 1, true);

  const x = mapCore.parseIntLoose(mapCore.getField(tile, 'xpos') && mapCore.getField(tile, 'xpos').value, 0);
  const y = mapCore.parseIntLoose(mapCore.getField(tile, 'ypos') && mapCore.getField(tile, 'ypos').value, 0);

  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const cityRef = `CITY_C3X_TEST_${Date.now()}`.toUpperCase();
  const unitRef = `UNIT_C3X_TEST_${Date.now()}`.toUpperCase();
  mapCore.addCity(citySection, tile, x, y, 0, 1, 'C3X Test City', cityRef);
  mapCore.addUnit(unitSection, tile, x, y, 0, 1, 0, unitRef);
  mapTab.recordOps.push({ op: 'add', sectionCode: 'CITY', newRecordRef: cityRef });
  mapTab.recordOps.push({ op: 'add', sectionCode: 'UNIT', newRecordRef: unitRef });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = reloaded.tabs.map;
  const reTileSection = getSection(reMap, 'TILE');
  const reCitySection = getSection(reMap, 'CITY');
  const reUnitSection = getSection(reMap, 'UNIT');
  assert.ok(reTileSection && reTileSection.records.length > 0);
  const reTile = reTileSection.records[0];
  const afterTerrain = String(mapCore.getField(reTile, 'baserealterrain') && mapCore.getField(reTile, 'baserealterrain').value || '');
  const afterFog = String(mapCore.getField(reTile, 'fogofwar') && mapCore.getField(reTile, 'fogofwar').value || '');
  assert.notEqual(afterTerrain, seededTerrain, 'expected terrain field to change after paint/save');
  assert.notEqual(afterFog, seededFog, 'expected fog field to change after paint/save');
  const roadField = mapCore.getField(reTile, 'road') || mapCore.getField(reTile, 'overlays');
  assert.ok(roadField, 'expected road/overlay data on tile after save');
  const districtField = mapCore.getField(reTile, 'district') || mapCore.getField(reTile, 'c3coverlays');
  assert.ok(districtField, 'expected district/c3coverlays data on tile after save');
  assert.ok((reCitySection && reCitySection.records && reCitySection.records.length) >= citySection.records.length);
  assert.ok((reUnitSection && reUnitSection.records && reUnitSection.records.length) >= unitSection.records.length);
  const savedCity = (reCitySection && Array.isArray(reCitySection.records) ? reCitySection.records : []).find((record) => {
    return String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'C3X Test City'
      && getRecordInt(record, 'x', -1) === x
      && getRecordInt(record, 'y', -1) === y;
  });
  assert.ok(savedCity, 'expected newly added city to persist at the edited tile');
  const savedUnit = (reUnitSection && Array.isArray(reUnitSection.records) ? reUnitSection.records : []).find((record) => {
    return getRecordInt(record, 'x', -1) === x
      && getRecordInt(record, 'y', -1) === y
      && getRecordInt(record, 'prtonumber', -1) === 0;
  });
  assert.ok(savedUnit, 'expected newly added unit to persist at the edited tile');
});

test('BIQ map save is a no-op when a loaded map bundle is unchanged', () => {
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
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  const biqReport = (Array.isArray(saveResult.saveReport) ? saveResult.saveReport : []).find((entry) => String(entry && entry.kind || '') === 'biq');
  assert.ok(biqReport, 'expected BIQ save report entry');
  assert.ok(Number(biqReport.applied) <= 100, `expected unchanged map save to avoid large BIQ churn, got ${Number(biqReport.applied)}`);
  const after = parseBiqFileForRawSections(scenarioBiq);
  assertRawSectionsEqual(before, after, DEFAULT_MAP_SECTION_CODES, 'expected unchanged map save to preserve raw');
});

test('unchanged map save preserves raw BIQ map sections byte-for-byte', () => {
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

  const reparsedOriginal = parseBiqFileForRawSections(sampleBiq);
  const reparsedSaved = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(reparsedOriginal.ok, true, 'expected original BIQ parse to succeed');
  assert.equal(reparsedSaved.ok, true, 'expected saved BIQ parse to succeed');

  assertRawSectionsEqual(reparsedOriginal, reparsedSaved, DEFAULT_MAP_SECTION_CODES, 'expected unchanged save to preserve raw');
});

test('BIQ map round-trip persists added city/unit records at a deterministic stable fixture tile', (t) => {
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
  const sections = getMapSectionsOrSkip(t, mapTab, { minCityRecords: 0, minUnitRecords: 0 });
  if (!sections) return;
  const { tileSection, citySection, unitSection } = sections;

  const tile = (tileSection.records || []).find((record) => {
    return getRecordInt(record, 'city', -1) < 0 && getRecordInt(record, 'colony', -1) < 0;
  });
  assert.ok(tile, 'expected stable fixture tile available for add-city/add-unit roundtrip');
  const tileX = getRecordInt(tile, 'xpos', -1);
  const tileY = getRecordInt(tile, 'ypos', -1);
  assert.ok(tileX >= 0 && tileY >= 0, 'expected selected stable fixture tile to expose valid coordinates');

  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const cityRef = makeShortBiqTestRef('CITY', `${tileX}${tileY}`);
  const unitRef = makeShortBiqTestRef('UNIT', `${tileX}${tileY}`);
  mapCore.addCity(citySection, tile, tileX, tileY, 1, 2, 'Stable Fixture City', cityRef);
  mapCore.addUnit(unitSection, tile, tileX, tileY, 1, 2, 0, unitRef);
  mapTab.recordOps.push({ op: 'add', sectionCode: 'CITY', newRecordRef: cityRef });
  mapTab.recordOps.push({ op: 'add', sectionCode: 'UNIT', newRecordRef: unitRef });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = reloaded.tabs.map;
  const reCitySection = getSection(reMap, 'CITY');
  const reUnitSection = getSection(reMap, 'UNIT');
  const savedCity = (reCitySection && Array.isArray(reCitySection.records) ? reCitySection.records : []).find((record) => {
    return String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Stable Fixture City'
      && getRecordInt(record, 'x', -1) === tileX
      && getRecordInt(record, 'y', -1) === tileY;
  });
  assert.ok(savedCity, `expected added city at ${tileX},${tileY} to persist`);
  assert.match(String(getRecordField(savedCity, 'ownertype') && getRecordField(savedCity, 'ownertype').value || ''), /Civilization \(2\)/);
  assert.match(String(getRecordField(savedCity, 'owner') && getRecordField(savedCity, 'owner').value || ''), /\(1\)$/);
  const savedUnit = (reUnitSection && Array.isArray(reUnitSection.records) ? reUnitSection.records : []).find((record) => {
    return getRecordInt(record, 'x', -1) === tileX
      && getRecordInt(record, 'y', -1) === tileY
      && getRecordInt(record, 'owner', -1) === 1
      && getRecordInt(record, 'ownertype', -1) === 2
      && getRecordInt(record, 'prtonumber', -1) === 0;
  });
  assert.ok(savedUnit, `expected added unit at ${tileX},${tileY} to persist`);
});

test('BIQ map reload preserves Player 1 city ownership as a real owner', (t) => {
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
  const sections = getMapSectionsOrSkip(t, mapTab, { minCityRecords: 0, minUnitRecords: 0 });
  if (!sections) return;
  const { tileSection, citySection } = sections;

  const tile = (tileSection.records || []).find((record) => {
    return getRecordInt(record, 'city', -1) < 0 && getRecordInt(record, 'colony', -1) < 0;
  });
  assert.ok(tile, 'expected stable fixture tile available for player-owned city roundtrip');
  const tileX = getRecordInt(tile, 'xpos', -1);
  const tileY = getRecordInt(tile, 'ypos', -1);

  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const cityRef = makeShortBiqTestRef('CITY', `P1${tileX}${tileY}`);
  mapCore.addCity(citySection, tile, tileX, tileY, 0, 3, 'Player One City', cityRef);
  mapTab.recordOps.push({ op: 'add', sectionCode: 'CITY', newRecordRef: cityRef });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reCitySection = getSection(reloaded.tabs.map, 'CITY');
  const savedCity = (reCitySection && Array.isArray(reCitySection.records) ? reCitySection.records : []).find((record) => {
    return String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Player One City';
  });
  assert.ok(savedCity, 'expected player-owned city after reload');
  assert.match(String(getRecordField(savedCity, 'ownertype') && getRecordField(savedCity, 'ownertype').value || ''), /Player \(3\)/);
  assert.notEqual(String(getRecordField(savedCity, 'owner') && getRecordField(savedCity, 'owner').value || ''), 'None');
  assert.match(String(getRecordField(savedCity, 'owner') && getRecordField(savedCity, 'owner').value || ''), /\(0\)$/);
});

test('BIQ map reload keeps barbarian owner zero distinct from Player 1 owner zero', (t) => {
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
  const sections = getMapSectionsOrSkip(t, mapTab, { minCityRecords: 0, minUnitRecords: 0 });
  if (!sections) return;
  const { tileSection, citySection, unitSection } = sections;

  const openTiles = (tileSection.records || []).filter((record) => {
    return getRecordInt(record, 'city', -1) < 0 && getRecordInt(record, 'colony', -1) < 0;
  }).slice(0, 2);
  if (openTiles.length < 2) {
    t.skip('Stable fixture lacks two empty tiles for owner namespace regression.');
    return;
  }

  const barbarianTile = openTiles[0];
  const playerTile = openTiles[1];
  const barbarianX = getRecordInt(barbarianTile, 'xpos', -1);
  const barbarianY = getRecordInt(barbarianTile, 'ypos', -1);
  const playerX = getRecordInt(playerTile, 'xpos', -1);
  const playerY = getRecordInt(playerTile, 'ypos', -1);

  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  const barbarianCityRef = makeShortBiqTestRef('CITY', `B0${barbarianX}${barbarianY}`);
  const playerCityRef = makeShortBiqTestRef('CITY', `P0${playerX}${playerY}`);
  const barbarianUnitRef = makeShortBiqTestRef('UNIT', `B0${barbarianX}${barbarianY}`);
  const playerUnitRef = makeShortBiqTestRef('UNIT', `P0${playerX}${playerY}`);
  mapCore.addCity(citySection, barbarianTile, barbarianX, barbarianY, 0, 1, 'Barb Owner Zero City', barbarianCityRef);
  mapCore.addCity(citySection, playerTile, playerX, playerY, 0, 3, 'Player Owner Zero City', playerCityRef);
  mapCore.addUnit(unitSection, barbarianTile, barbarianX, barbarianY, 0, 1, 0, barbarianUnitRef);
  mapCore.addUnit(unitSection, playerTile, playerX, playerY, 0, 3, 0, playerUnitRef);
  mapTab.recordOps.push({ op: 'add', sectionCode: 'CITY', newRecordRef: barbarianCityRef });
  mapTab.recordOps.push({ op: 'add', sectionCode: 'CITY', newRecordRef: playerCityRef });
  mapTab.recordOps.push({ op: 'add', sectionCode: 'UNIT', newRecordRef: barbarianUnitRef });
  mapTab.recordOps.push({ op: 'add', sectionCode: 'UNIT', newRecordRef: playerUnitRef });

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reCitySection = getSection(reloaded.tabs.map, 'CITY');
  const reUnitSection = getSection(reloaded.tabs.map, 'UNIT');
  const reloadedCities = reCitySection && Array.isArray(reCitySection.records) ? reCitySection.records : [];
  const reloadedUnits = reUnitSection && Array.isArray(reUnitSection.records) ? reUnitSection.records : [];
  const barbarianCity = reloadedCities.find((record) => {
    return String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Barb Owner Zero City';
  });
  const playerCity = reloadedCities.find((record) => {
    return String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Player Owner Zero City';
  });
  const barbarianUnit = reloadedUnits.find((record) => {
    return getRecordInt(record, 'x', -1) === barbarianX
      && getRecordInt(record, 'y', -1) === barbarianY
      && getRecordInt(record, 'prtonumber', -1) === 0
      && String(getRecordField(record, 'ownertype') && getRecordField(record, 'ownertype').value || '').includes('Barbarians');
  });
  const playerUnit = reloadedUnits.find((record) => {
    return getRecordInt(record, 'x', -1) === playerX
      && getRecordInt(record, 'y', -1) === playerY
      && getRecordInt(record, 'prtonumber', -1) === 0
      && String(getRecordField(record, 'ownertype') && getRecordField(record, 'ownertype').value || '').includes('Player');
  });
  assert.ok(barbarianCity, 'expected barbarian-owned city after reload');
  assert.ok(playerCity, 'expected Player 1-owned city after reload');
  assert.ok(barbarianUnit, 'expected barbarian-owned unit after reload');
  assert.ok(playerUnit, 'expected Player 1-owned unit after reload');

  assert.match(String(getRecordField(barbarianCity, 'ownertype') && getRecordField(barbarianCity, 'ownertype').value || ''), /Barbarians \(1\)/);
  assert.equal(String(getRecordField(barbarianCity, 'owner') && getRecordField(barbarianCity, 'owner').value || ''), '0');
  assert.match(String(getRecordField(playerCity, 'ownertype') && getRecordField(playerCity, 'ownertype').value || ''), /Player \(3\)/);
  assert.match(String(getRecordField(playerCity, 'owner') && getRecordField(playerCity, 'owner').value || ''), /\(0\)$/);
  assert.notEqual(String(getRecordField(playerCity, 'owner') && getRecordField(playerCity, 'owner').value || ''), 'None');
  assert.equal(String(getRecordField(barbarianUnit, 'owner') && getRecordField(barbarianUnit, 'owner').value || ''), '0');
  assert.match(String(getRecordField(playerUnit, 'owner') && getRecordField(playerUnit, 'owner').value || ''), /\(0\)$/);
  assert.notEqual(String(getRecordField(playerUnit, 'owner') && getRecordField(playerUnit, 'owner').value || ''), 'None');

  const reparsed = parseBiqFileForRawSections(scenarioBiq);
  assert.equal(reparsed.ok, true, 'expected saved BIQ parse to succeed');
  const rawCitySection = (reparsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'CITY');
  const rawUnitSection = (reparsed.sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'UNIT');
  const rawCities = rawCitySection && Array.isArray(rawCitySection.records) ? rawCitySection.records : [];
  const rawUnits = rawUnitSection && Array.isArray(rawUnitSection.records) ? rawUnitSection.records : [];
  const rawBarbarianCity = rawCities.find((record) => String(record && record.name || '').trim() === 'Barb Owner Zero City');
  const rawPlayerCity = rawCities.find((record) => String(record && record.name || '').trim() === 'Player Owner Zero City');
  const rawBarbarianUnit = rawUnits.find((record) => record
    && record.x === barbarianX
    && record.y === barbarianY
    && record.pRTONumber === 0
    && record.ownerType === 1
    && record.owner === 0);
  const rawPlayerUnit = rawUnits.find((record) => record
    && record.x === playerX
    && record.y === playerY
    && record.pRTONumber === 0
    && record.ownerType === 3
    && record.owner === 0);
  assert.ok(rawBarbarianCity, 'expected raw barbarian city record after save');
  assert.ok(rawPlayerCity, 'expected raw Player 1 city record after save');
  assert.ok(rawBarbarianUnit, 'expected raw barbarian unit record after save');
  assert.ok(rawPlayerUnit, 'expected raw Player 1 unit record after save');
  assert.equal(rawBarbarianCity.ownerType, 1, 'expected raw barbarian city ownerType to stay Barbarians');
  assert.equal(rawBarbarianCity.owner, 0, 'expected raw barbarian city owner payload to stay zero');
  assert.equal(rawPlayerCity.ownerType, 3, 'expected raw player city ownerType to stay Player');
  assert.equal(rawPlayerCity.owner, 0, 'expected raw player city owner payload to stay Player 1');
});

test('scenario save writes and reloads scenario.districts.txt entries and named tiles', () => {
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

  mapTab.scenarioDistricts.entries = [
    { x: 126, y: 2, district: 'Neighborhood', wonderName: '', wonderCity: '' },
    { x: 128, y: 4, district: 'Aerodrome', wonderName: '', wonderCity: '' }
  ];
  mapTab.scenarioDistricts.namedTiles = [
    { x: 126, y: 2, name: 'Test Named Tile' }
  ];

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
  assert.match(sidecarText, /#District/);
  assert.match(sidecarText, /coordinates\s*=\s*126,2/);
  assert.match(sidecarText, /district\s*=\s*Neighborhood/);
  assert.match(sidecarText, /#NamedTile/);
  assert.match(sidecarText, /name\s*=\s*Test Named Tile/);

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const scenarioDistricts = reloaded && reloaded.tabs && reloaded.tabs.map && reloaded.tabs.map.scenarioDistricts;
  assert.ok(scenarioDistricts, 'expected scenario districts metadata after reload');
  assert.equal(Array.isArray(scenarioDistricts.entries), true);
  assert.equal(Array.isArray(scenarioDistricts.namedTiles), true);
  assert.ok(scenarioDistricts.entries.some((entry) => Number(entry && entry.x) === 126 && Number(entry && entry.y) === 2 && String(entry && entry.district || '') === 'Neighborhood'));
  assert.ok(scenarioDistricts.namedTiles.some((entry) => Number(entry && entry.x) === 126 && Number(entry && entry.y) === 2 && String(entry && entry.name || '') === 'Test Named Tile'));
});

test('scenario districts map edits appear in save plan and file diff preview', () => {
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

  mapTab.scenarioDistricts.entries = [
    { x: 126, y: 2, district: 'Neighborhood', wonderName: '', wonderCity: '' }
  ];
  mapTab.scenarioDistricts.namedTiles = [
    { x: 126, y: 2, name: 'Preview Named Tile' }
  ];

  const sidecarPath = path.join(scenarioDir, 'scenario.districts.txt');
  const payload = {
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs,
    dirtyTabs: ['map']
  };
  const plan = previewSavePlan(payload);
  assert.equal(plan.ok, true, String(plan.error || 'preview save plan failed'));
  assert.ok(
    (plan.writes || []).some((entry) => path.resolve(String(entry && entry.path || '')) === path.resolve(sidecarPath) && String(entry && entry.kind || '') === 'scenarioDistricts'),
    'expected scenario.districts.txt in pending save plan'
  );

  const diff = previewFileDiff({ ...payload, targetPath: sidecarPath });
  assert.equal(diff.ok, true, String(diff.error || 'preview diff failed'));
  assert.equal(diff.found, true, 'expected pending diff for scenario.districts.txt');
  assert.match(String(diff.newText || ''), /#District/);
  assert.match(String(diff.newText || ''), /district\s*=\s*Neighborhood/);
  assert.match(String(diff.newText || ''), /#NamedTile/);
  assert.match(String(diff.newText || ''), /name\s*=\s*Preview Named Tile/);
});

test('normalizeDeletedReferenceSections remaps TILE city and colony references after map deletes', () => {
  const parsed = {
    io: { mapWidth: 4 },
    sections: [
      { code: 'RACE', records: [{ index: 0 }, { index: 1 }] },
      { code: 'LEAD', records: [{ index: 0 }] },
      { code: 'WMAP', records: [{ width: 4, height: 2 }] },
      {
        code: 'CITY',
        records: [
          { index: 0, ownerType: 2, owner: 1, x: 2, y: 0 }
        ]
      },
      {
        code: 'CLNY',
        records: [
          { index: 0, ownerType: 2, owner: 1, x: 2, y: 0, improvementType: 2 }
        ]
      },
      {
        code: 'TILE',
        records: [
          { index: 0, xpos: 0, ypos: 0, city: 0, colony: 0 },
          { index: 1, xpos: 2, ypos: 0, city: 1, colony: 1 },
          { index: 2, xpos: 0, ypos: 1, city: -1, colony: -1 },
          { index: 3, xpos: 2, ypos: 1, city: -1, colony: -1 }
        ]
      }
    ]
  };
  const result = normalizeDeletedReferenceSections(parsed, [
    { op: 'delete', sectionCode: 'CITY', recordRef: '@INDEX:0' },
    { op: 'delete', sectionCode: 'CLNY', recordRef: '@INDEX:0' }
  ], {
    CITY: ['@INDEX:0', '@INDEX:1'],
    CLNY: ['@INDEX:0', '@INDEX:1']
  });
  assert.equal(result.ok, true, String(result.error || 'normalize failed'));
  const tileRecords = parsed.sections.find((section) => section.code === 'TILE').records;
  assert.equal(tileRecords[0].city, -1, 'expected deleted city tile ref to clear');
  assert.equal(tileRecords[1].city, 0, 'expected later city tile ref to shift down');
  assert.equal(tileRecords[0].colony, -1, 'expected deleted colony tile ref to clear');
  assert.equal(tileRecords[1].colony, 0, 'expected later colony tile ref to shift down');
  assertNoMapReferenceIssues(parsed, 'expected no invalid tile references after remap');
});

test('collectMapReferenceIntegrityIssues rejects wrong-but-in-range city and colony links', () => {
  const parsed = {
    io: { mapWidth: 4 },
    sections: [
      { code: 'RACE', records: [{ index: 0 }, { index: 1 }] },
      { code: 'LEAD', records: [{ index: 0 }] },
      { code: 'WMAP', records: [{ width: 4, height: 2 }] },
      {
        code: 'TILE',
        records: [
          { index: 0, xpos: 0, ypos: 0, city: 1, colony: -1 },
          { index: 1, xpos: 2, ypos: 0, city: -1, colony: 1 },
          { index: 2, xpos: 1, ypos: 1, city: -1, colony: -1 },
          { index: 3, xpos: 3, ypos: 1, city: -1, colony: -1 }
        ]
      },
      {
        code: 'CITY',
        records: [
          { index: 0, x: 0, y: 0, ownerType: 2, owner: 0 },
          { index: 1, x: 2, y: 0, ownerType: 2, owner: 1 }
        ]
      },
      {
        code: 'CLNY',
        records: [
          { index: 0, x: 1, y: 1, improvementType: 0, ownerType: 2, owner: 0 },
          { index: 1, x: 3, y: 1, improvementType: 2, ownerType: 2, owner: 1 }
        ]
      },
      {
        code: 'UNIT',
        records: [
          { index: 0, x: 0, y: 0, ownerType: 3, owner: 0 },
          { index: 1, x: 9, y: 9, ownerType: 3, owner: 0 }
        ]
      }
    ]
  };
  const issues = collectMapReferenceIntegrityIssues(parsed);
  assert.ok(issues.some((issue) => issue.kind === 'tile-city-coords' && issue.cityRef === 1), `expected tile-city coordinate mismatch, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'tile-colony-coords' && issue.colonyRef === 1), `expected tile-colony coordinate mismatch, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'city-tile-backref' && issue.cityRef === 0), `expected city backref mismatch, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'colony-tile-backref' && issue.colonyRef === 0), `expected colony backref mismatch, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'city-ref-count' && issue.cityRef === 0 && issue.count === 0), `expected city ref-count issue, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'colony-ref-count' && issue.colonyRef === 0 && issue.count === 0), `expected colony ref-count issue, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'unit-out-of-bounds' && issue.unitRef === 1), `expected unit out-of-bounds issue, got ${JSON.stringify(issues)}`);
});

test('collectMapReferenceIntegrityIssues rejects invalid city/unit/colony owner references', () => {
  const parsed = {
    io: { mapWidth: 4 },
    sections: [
      { code: 'RACE', records: [{ index: 0 }, { index: 1 }] },
      { code: 'LEAD', records: [{ index: 0 }] },
      { code: 'WMAP', records: [{ width: 4, height: 2 }] },
      {
        code: 'TILE',
        records: [
          { index: 0, xpos: 0, ypos: 0, city: 0, colony: 0 },
          { index: 1, xpos: 2, ypos: 0, city: -1, colony: -1 }
        ]
      },
      {
        code: 'CITY',
        records: [
          { index: 0, x: 0, y: 0, ownerType: 2, owner: 9 }
        ]
      },
      {
        code: 'CLNY',
        records: [
          { index: 0, x: 0, y: 0, ownerType: 3, owner: 4, improvementType: 0 }
        ]
      },
      {
        code: 'UNIT',
        records: [
          { index: 0, x: 2, y: 0, ownerType: 7, owner: 0 }
        ]
      }
    ]
  };
  const issues = collectMapReferenceIntegrityIssues(parsed);
  assert.ok(issues.some((issue) => issue.kind === 'city-owner-ref' && issue.recordRef === 0), `expected invalid city owner ref, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'clny-owner-ref' && issue.recordRef === 0), `expected invalid colony owner ref, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'unit-owner-type' && issue.recordRef === 0), `expected invalid unit owner type, got ${JSON.stringify(issues)}`);
});

test('collectMapReferenceIntegrityIssues allows opaque barbarian owner payloads', () => {
  const parsed = {
    io: { mapWidth: 4 },
    sections: [
      { code: 'RACE', records: [{ index: 0 }, { index: 1 }] },
      { code: 'LEAD', records: [{ index: 0 }] },
      { code: 'WMAP', records: [{ width: 4, height: 2 }] },
      {
        code: 'TILE',
        records: [
          { index: 0, xpos: 0, ypos: 0, city: 0, colony: 0 },
          { index: 1, xpos: 2, ypos: 0, city: -1, colony: -1 }
        ]
      },
      {
        code: 'CITY',
        records: [
          { index: 0, x: 0, y: 0, ownerType: 1, owner: 99 }
        ]
      },
      {
        code: 'CLNY',
        records: [
          { index: 0, x: 0, y: 0, ownerType: 1, owner: 75, improvementType: 0 }
        ]
      },
      {
        code: 'UNIT',
        records: [
          { index: 0, x: 2, y: 0, ownerType: 1, owner: 75 }
        ]
      }
    ]
  };
  const issues = collectMapReferenceIntegrityIssues(parsed);
  assert.equal(issues.length, 0, `expected no issues for opaque barbarian owner payloads, got ${JSON.stringify(issues)}`);
});

test('collectMapReferenceIntegrityIssues rejects invalid starting location owner references and coords', () => {
  const parsed = {
    io: { mapWidth: 4 },
    sections: [
      { code: 'RACE', records: [{ index: 0 }, { index: 1 }] },
      { code: 'LEAD', records: [{ index: 0 }] },
      { code: 'WMAP', records: [{ width: 4, height: 2 }] },
      {
        code: 'TILE',
        records: [
          { index: 0, xpos: 0, ypos: 0, city: -1, colony: -1 },
          { index: 1, xpos: 2, ypos: 0, city: -1, colony: -1 }
        ]
      },
      {
        code: 'SLOC',
        records: [
          { ownerType: 3, owner: 9, x: 0, y: 0 },
          { ownerType: 2, owner: 1, x: 7, y: 7 }
        ]
      }
    ]
  };
  const issues = collectMapReferenceIntegrityIssues(parsed);
  assert.ok(issues.some((issue) => issue.kind === 'sloc-owner-ref' && issue.recordRef === 0), `expected invalid SLOC owner ref, got ${JSON.stringify(issues)}`);
  assert.ok(issues.some((issue) => issue.kind === 'sloc-out-of-bounds' && issue.slocRef === 1), `expected out-of-bounds SLOC, got ${JSON.stringify(issues)}`);
});

test('collectColonyOverlayCoherenceIssues rejects mismatched colony overlay types', () => {
  const parsed = {
    sections: [
      {
        code: 'TILE',
        records: [
          { index: 0, colony: 0, c3cOverlays: 0x40000000 }
        ]
      },
      {
        code: 'CLNY',
        records: [
          { index: 0, x: 0, y: 0, improvementType: 0 }
        ]
      }
    ]
  };
  const issues = collectColonyOverlayCoherenceIssues(parsed);
  assert.ok(issues.some((issue) => issue.kind === 'colony-overlay-type-mismatch' && issue.colonyRef === 0 && issue.overlayType === 2 && issue.improvementType === 0), `expected colony overlay mismatch, got ${JSON.stringify(issues)}`);
});

test('applyEdits rejects whole-map replacement outside explicit generated-map saves', () => {
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
  assert.equal(result.ok, false, 'expected setmap to be rejected without explicit generated-map allowance');
  assert.match(String(result.error || ''), /Whole-map BIQ replacement is blocked/i);
});

test('applyEdits keeps unowned tile-only starting locations out of save warning channel', () => {
  const parsed = parseBiqFileForRawSections(getStableMapUnitsFixturePath());
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');
  const slocSection = (parsed.sections || []).find((section) => section.code === 'SLOC');
  assert.ok(slocSection, 'expected SLOC section in stable fixture');
  slocSection.records = [];
  slocSection._modified = true;

  const result = applyEdits(Buffer.concat([
    parsed._headerBuf,
    ...parsed.sections.map((section) => serializeSection(section, parsed.io))
  ]), [{
    op: 'set',
    sectionCode: 'LEAD',
    recordRef: '@INDEX:0',
    fieldKey: 'initialera',
    value: '2'
  }], {});
  assert.equal(result.ok, true, String(result.error || 'save failed'));
  assert.equal(result.skipped, 0);
  assert.equal(String(result.warning || ''), '');
});

test('applyEdits reports actionable map reference blocker messages', () => {
  const parsed = parseBiqFileForRawSections(getStableMapUnitsFixturePath());
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');
  const unitSection = (parsed.sections || []).find((section) => section.code === 'UNIT');
  assert.ok(unitSection && Array.isArray(unitSection.records) && unitSection.records[0], 'expected UNIT section in stable fixture');
  unitSection.records[0].x = 999;
  unitSection.records[0].y = 999;
  unitSection._modified = true;

  const result = applyEdits(Buffer.concat([
    parsed._headerBuf,
    ...parsed.sections.map((section) => serializeSection(section, parsed.io))
  ]), [{
    op: 'set',
    sectionCode: 'LEAD',
    recordRef: '@INDEX:0',
    fieldKey: 'initialera',
    value: '1'
  }], {});
  assert.equal(result.ok, false, 'expected save to be blocked for off-map unit');
  assert.match(String(result.error || ''), /Save blocked to protect the BIQ/);
  assert.match(String(result.error || ''), /UNIT #0 is outside/);
  assert.match(String(result.error || ''), /Open Map and move\/delete the unit/);
});

test('scenario player loadability flags playable civs without fixed LEAD slots', () => {
  const parsed = {
    sections: [
      { code: 'DIFF', records: [{}] },
      {
        code: 'RACE',
        records: [
          { civilizationName: 'Barbarians' },
          { civilizationName: 'Rome' },
          { civilizationName: 'Egypt' },
          { civilizationName: 'Greece' },
          { civilizationName: 'Japan' }
        ]
      },
      { code: 'GAME', records: [{ numPlayableCivs: 4, playableCivIds: [1, 2, 3, 4] }] },
      {
        code: 'LEAD',
        records: [
          { difficulty: -2, humanPlayer: 1, civ: 4 },
          { difficulty: -2, humanPlayer: 0, civ: -3 }
        ]
      },
      { code: 'WMAP', records: [{ numCivs: 2 }] },
      { code: 'TILE', records: [] }
    ]
  };

  const issues = collectScenarioPlayerLoadabilityIssues(parsed);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'playable-civ-without-lead-slot');
  assert.deepEqual(issues[0].unsupportedCivIds.slice(0, 3), [1, 2, 3]);
  const detail = formatScenarioPlayerLoadabilityIssue(issues[0]);
  assert.match(detail, /Playable Civilizations includes 3 civ\(s\)/);
  assert.match(detail, /Rome, Egypt, Greece/);
  assert.match(detail, /Civ3 can freeze/);
});

test('scenario player loadability accepts stock MP-style playable civs fixed to AI slots', () => {
  const parsed = {
    sections: [
      { code: 'DIFF', records: [{}] },
      {
        code: 'RACE',
        records: [
          { civilizationName: 'Barbarians' },
          { civilizationName: 'Rome' },
          { civilizationName: 'Egypt' }
        ]
      },
      { code: 'GAME', records: [{ numPlayableCivs: 2, playableCivIds: [1, 2] }] },
      {
        code: 'LEAD',
        records: [
          { difficulty: -2, humanPlayer: 1, civ: 1 },
          { difficulty: -2, humanPlayer: 0, civ: 2 }
        ]
      },
      { code: 'WMAP', records: [{ numCivs: 2 }] },
      { code: 'TILE', records: [] }
    ]
  };

  assert.deepEqual(collectScenarioPlayerLoadabilityIssues(parsed), []);
});

test('scenario player loadability accepts explicit human wildcard civ choice', () => {
  const parsed = {
    sections: [
      { code: 'DIFF', records: [{}] },
      {
        code: 'RACE',
        records: [
          { civilizationName: 'Barbarians' },
          { civilizationName: 'Rome' },
          { civilizationName: 'Egypt' },
          { civilizationName: 'Greece' }
        ]
      },
      { code: 'GAME', records: [{ numPlayableCivs: 3, playableCivIds: [1, 2, 3] }] },
      { code: 'LEAD', records: [{ difficulty: -2, humanPlayer: 1, civ: -3 }] },
      { code: 'WMAP', records: [{ numCivs: 1 }] },
      { code: 'TILE', records: [] }
    ]
  };

  assert.deepEqual(collectScenarioPlayerLoadabilityIssues(parsed), []);
});

test('BIQ map round-trip keeps surviving city tile references stable after deleting an earlier city', (t) => {
  const sampleBiq = getStableMapUnitsFixturePath();
  const resolvedCiv3Root = getStableFixtureCiv3Root();
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: resolvedCiv3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  if (!mapTab) {
    t.skip('Map tab unavailable in stable fixture BIQ.');
    return;
  }
  const seededState = seedFixtureCitiesForDeleteRegression(t, mapTab);
  if (!seededState) return;
  const seedSaveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: resolvedCiv3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(seedSaveResult.ok, true, String(seedSaveResult.error || 'failed to seed delete-regression cities'));

  const seededReload = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: resolvedCiv3Root, scenarioPath: scenarioBiq });
  const reloadedMapForDelete = seededReload.tabs.map;
  const sections = getMapSectionsOrSkip(t, reloadedMapForDelete);
  if (!sections) return;
  const { tileSection, citySection } = sections;
  const cityRecords = Array.isArray(citySection.records) ? citySection.records : [];
  const tileRecords = Array.isArray(tileSection.records) ? tileSection.records : [];
  const deletedIndex = cityRecords.findIndex((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Seed Delete City A');
  const survivorIndex = cityRecords.findIndex((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === 'Seed Delete City C');
  const deleted = deletedIndex >= 0 ? cityRecords[deletedIndex] : null;
  const survivor = survivorIndex >= 0 ? cityRecords[survivorIndex] : null;
  assert.ok(deleted, 'expected seeded city delete candidate after seed save');
  assert.ok(survivor, 'expected seeded survivor city after seed save');

  const survivorName = 'Seed Delete City C';
  const survivorX = getRecordInt(survivor, 'x', -1);
  const survivorY = getRecordInt(survivor, 'y', -1);
  const survivorTileBefore = tileRecords.find((tile) => getRecordInt(tile, 'city', -1) === survivorIndex);
  assert.ok(survivorTileBefore, 'expected survivor tile before delete');
  const survivorTileBeforeX = getRecordInt(survivorTileBefore, 'xpos', -1);
  const survivorTileBeforeY = getRecordInt(survivorTileBefore, 'ypos', -1);

  const mapTabAfterSeed = reloadedMapForDelete;
  if (!Array.isArray(mapTabAfterSeed.recordOps)) mapTabAfterSeed.recordOps = [];
  mapTabAfterSeed.recordOps.push({ op: 'delete', sectionCode: 'CITY', recordRef: `@INDEX:${deletedIndex}` });
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
  const reTileSection = getSection(reMap, 'TILE');
  const reSurvivor = (reCitySection.records || []).find((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === survivorName);
  assert.ok(reSurvivor, `expected survivor city ${survivorName} after delete/save`);
  assert.equal(getRecordInt(reSurvivor, 'x', -1), survivorX, 'expected survivor city X to remain stable');
  assert.equal(getRecordInt(reSurvivor, 'y', -1), survivorY, 'expected survivor city Y to remain stable');
  const reSurvivorTile = (reTileSection.records || []).find((tile) => getRecordInt(tile, 'xpos', -1) === survivorTileBeforeX && getRecordInt(tile, 'ypos', -1) === survivorTileBeforeY);
  assert.ok(reSurvivorTile, 'expected survivor tile after reload');
  const reSurvivorIndex = (reCitySection.records || []).findIndex((record) => String(getRecordField(record, 'name') && getRecordField(record, 'name').value || '') === survivorName);
  assert.ok(reSurvivorIndex >= 0, 'expected survivor city index after reload');
  assert.equal(getRecordInt(reSurvivorTile, 'city', -1), reSurvivorIndex, 'expected survivor tile to reference the survivor city after reindex');
  assertMapReferenceIntegrityFromMapTab(reMap, 'expected all tile city/colony references to stay valid after city delete round-trip');
});

test('mixed BIQ + text save failure rolls back all committed changes', (t) => {
  const sampleBiq = findSampleBiqPath();
  if (!sampleBiq) t.skip('No sample BIQ available. Set C3X_TEST_BIQ to run BIQ integration tests.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  const scenarioDir = path.join(tmp, 'scenario');
  fs.mkdirSync(c3x, { recursive: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  ensureDefaultC3xFiles(c3x);

  const scenarioBiq = path.join(scenarioDir, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const scenarioBasePath = path.join(scenarioDir, 'scenario.c3x_config.ini');
  const originalBaseText = 'flag = true\nkeep = baseline\n';
  fs.writeFileSync(scenarioBasePath, originalBaseText, 'utf8');

  const beforeBiqHash = crypto.createHash('sha256').update(fs.readFileSync(scenarioBiq)).digest('hex');
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const tech = getEntryByCivKey(bundle.tabs.technologies.entries, 'TECH_MAP_MAKING')
    || bundle.tabs.technologies.entries.find((entry) => findField(entry, 'x'));
  assert.ok(tech, 'expected a tech entry');
  const xField = findField(tech, 'x');
  assert.ok(xField, 'expected tech x field');
  const oldX = Number(String(xField.value || '').replace(/[^\d-]+/g, ''));
  xField.value = String(oldX + 4);

  const flagRow = bundle.tabs.base.rows.find((row) => row.key === 'flag');
  assert.ok(flagRow, 'expected base flag row');
  flagRow.value = 'false';

  const blocker = path.join(scenarioDir, 'not-a-dir');
  fs.writeFileSync(blocker, 'x', 'utf8');
  const invalidPediaPath = path.join(blocker, 'PediaIcons.txt');
  const civEntries = (bundle.tabs.civilizations && bundle.tabs.civilizations.entries) || [];
  const targetCivKey = String((civEntries[0] && civEntries[0].civilopediaKey) || '').toUpperCase();
  assert.ok(targetCivKey, 'expected at least one civilization entry');
  bundle.tabs.civilizations = {
    ...(bundle.tabs.civilizations || {}),
    sourceDetails: {
      ...((bundle.tabs.civilizations && bundle.tabs.civilizations.sourceDetails) || {}),
      pediaIconsScenarioWrite: invalidPediaPath
    },
    entries: civEntries.map((entry) => {
      if (String(entry.civilopediaKey || '').toUpperCase() !== targetCivKey) return entry;
      return {
        ...entry,
        iconPaths: ['Art\\civilopedia\\icons\\races\\test-large.pcx'],
        originalIconPaths: Array.isArray(entry.originalIconPaths) ? entry.originalIconPaths : []
      };
    })
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(result.ok, false);
  assert.match(String(result.error || ''), /rolled back/i);

  const afterBiqHash = crypto.createHash('sha256').update(fs.readFileSync(scenarioBiq)).digest('hex');
  assert.equal(afterBiqHash, beforeBiqHash, 'expected BIQ file to be unchanged after rollback');
  assert.equal(fs.readFileSync(scenarioBasePath, 'utf8'), originalBaseText, 'expected scenario base file rollback');
});

test('BIQ map round-trip persists city relocation and city improvements edits', (t) => {
  const sampleBiq = findSampleMapBiqPath();
  if (!sampleBiq) t.skip('No map-enabled BIQ available. Set C3X_TEST_MAP_BIQ to run this test.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  if (!mapTab) {
    t.skip('Map tab unavailable in sample BIQ.');
    return;
  }
  const sections = getMapSectionsOrSkip(t, mapTab);
  if (!sections) return;
  const { tileSection, citySection } = sections;
  const tileRecords = tileSection.records || [];
  const tileLookup = buildTileLookup(tileSection);
  const city = citySection.records[0];
  const originalCityX = getRecordInt(city, 'x', 0);
  const originalCityY = getRecordInt(city, 'y', 0);
  const sourceTile = tileLookup.get(`${originalCityX},${originalCityY}`);
  assert.ok(sourceTile, 'expected tile matching city source coords');
  const destinationTile = tileRecords.find((tile) => (
    Number(tile && tile.index) !== Number(sourceTile && sourceTile.index)
    && getRecordInt(tile, 'city', -1) < 0
  ));
  assert.ok(destinationTile, 'expected empty destination tile for city relocation test');
  const destinationTileIndex = Number(destinationTile && destinationTile.index);
  const sourceX = getRecordInt(sourceTile, 'xpos', 0);
  const sourceY = getRecordInt(sourceTile, 'ypos', 0);
  const destX = getRecordInt(destinationTile, 'xpos', sourceX + 1);
  const destY = getRecordInt(destinationTile, 'ypos', sourceY + 1);

  const cityIndex = Number(city.index);
  assert.ok(Number.isFinite(cityIndex), 'expected finite city index');
  mapCore.setField(city, 'x', String(sourceX), 'X');
  mapCore.setField(city, 'y', String(sourceY), 'Y');
  mapCore.setField(sourceTile, 'city', String(cityIndex), 'City');
  mapCore.setField(destinationTile, 'city', '-1', 'City');
  getRecordField(city, 'x').value = String(destX);
  getRecordField(city, 'y').value = String(destY);
  mapCore.setField(sourceTile, 'city', '-1', 'City');
  mapCore.setField(destinationTile, 'city', String(cityIndex), 'City');
  mapCore.setField(city, 'numbuildings', '1', 'Number of Buildings');
  mapCore.setField(city, 'buildings', '0', 'Buildings');

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = reloaded.tabs.map;
  const reTile = getSection(reMap, 'TILE');
  const reCity = getSection(reMap, 'CITY');
  const reCityRecord = (reCity.records || []).find((record) => Number(record && record.index) === cityIndex);
  assert.ok(reCityRecord, 'expected relocated city record');
  assert.equal(Number(getRecordField(reCityRecord, 'x').value), destX);
  assert.equal(Number(getRecordField(reCityRecord, 'y').value), destY);
  const bCount = Number(getRecordField(reCityRecord, 'numbuildings') && getRecordField(reCityRecord, 'numbuildings').value);
  assert.ok(Number.isFinite(bCount) && bCount >= 1, 'expected persisted city improvement data');
  const reDestinationTile = (reTile.records || []).find((record) => Number(record && record.index) === destinationTileIndex);
  assert.ok(reDestinationTile, 'expected destination tile after reload');
  const reDestinationCity = String((getRecordField(reDestinationTile, 'city') && getRecordField(reDestinationTile, 'city').value) || '');
  assert.match(reDestinationCity, new RegExp(`\\(${cityIndex}\\)$`), 'expected destination tile city field to reference relocated city index');
});

test('BIQ map round-trip persists multi-unit edits on same tile', (t) => {
  const sampleBiq = findSampleMapBiqPath();
  if (!sampleBiq) t.skip('No map-enabled BIQ available. Set C3X_TEST_MAP_BIQ to run this test.');

  const civ3Root = resolveCiv3RootFromBiq(sampleBiq);
  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  const scenarioBiq = path.join(tmp, 'scenario-copy.biq');
  fs.copyFileSync(sampleBiq, scenarioBiq);
  fs.chmodSync(scenarioBiq, 0o644);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const mapTab = bundle && bundle.tabs && bundle.tabs.map;
  if (!mapTab) {
    t.skip('Map tab unavailable in sample BIQ.');
    return;
  }
  const sections = getMapSectionsOrSkip(t, mapTab);
  if (!sections) return;
  const { unitSection, tileSection } = sections;
  const seed = unitSection.records[0];
  const tile = tileSection.records[0];
  const sx = getRecordInt(tile, 'xpos', 0);
  const sy = getRecordInt(tile, 'ypos', 0);
  mapCore.setField(seed, 'x', String(sx), 'X');
  mapCore.setField(seed, 'y', String(sy), 'Y');
  const sameTileUnits = unitSection.records.filter((record) => {
    const ux = Number(getRecordField(record, 'x') && getRecordField(record, 'x').value);
    const uy = Number(getRecordField(record, 'y') && getRecordField(record, 'y').value);
    return ux === sx && uy === sy;
  });
  const beforeCount = sameTileUnits.length;
  const owner = Number(getRecordField(seed, 'owner') && getRecordField(seed, 'owner').value) || 0;
  const ownerType = Number(getRecordField(seed, 'ownertype') && getRecordField(seed, 'ownertype').value) || 1;
  const prto = Number(getRecordField(seed, 'prtonumber') && getRecordField(seed, 'prtonumber').value)
    || Number(getRecordField(seed, 'unit_type') && getRecordField(seed, 'unit_type').value)
    || 0;

  const addRef = `UNIT_C3X_MULTI_${Date.now()}`.toUpperCase();
  const added = mapCore.addUnit(unitSection, tile, sx, sy, owner, ownerType, prto, addRef);
  if (!Array.isArray(mapTab.recordOps)) mapTab.recordOps = [];
  mapTab.recordOps.push({ op: 'add', sectionCode: 'UNIT', newRecordRef: addRef });
  assert.ok(added && Number.isFinite(Number(added.index)), 'expected added unit');

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: civ3Root,
    scenarioPath: scenarioBiq,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const reloaded = loadBundle({ mode: 'scenario', c3xPath: c3x, civ3Path: civ3Root, scenarioPath: scenarioBiq });
  const reMap = reloaded.tabs.map;
  const reUnits = getSection(reMap, 'UNIT').records || [];
  const afterSameTile = reUnits.filter((record) => {
    const ux = Number(getRecordField(record, 'x') && getRecordField(record, 'x').value);
    const uy = Number(getRecordField(record, 'y') && getRecordField(record, 'y').value);
    return ux === sx && uy === sy;
  });
  assert.ok(afterSameTile.length >= beforeCount + 1, 'expected additional unit on same tile after save/reload');
});
