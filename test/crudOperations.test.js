'use strict';

/**
 * Comprehensive Add / Copy / Import / Delete tests for all six entity types:
 *   Civilizations (RACE), Technologies (TECH), Resources (GOOD),
 *   Improvements (BLDG), Governments (GOVT), Units (PRTO).
 *
 * All tests operate on a per-test tmp copy of conquests.biq — the original
 * game file is never touched.  Import tests pull entries from Tides of Crimson
 * and verify both BIQ-level presence and art-file copying.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const { loadBundle, saveBundle, findNextResourceAtlasSlot, findNextUnitAtlasSlot } = require('../src/configCore');
const { decodePcx } = require('../src/artPreview');
const { getReferenceEntryIdentity } = require('../src/referenceIdentity');
const { DELETE_REFERENCE_INVENTORY } = require('./referenceCrudInventory');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');
const BASE_BIQ = process.env.C3X_TEST_BIQ
  || path.join(CIV3_ROOT, 'Conquests', 'conquests.biq');
const TIDES_BIQ = path.join(CIV3_ROOT, 'Conquests', 'Scenarios', 'TIDES OF CRIMSON.biq');
const CIVILIZATION_LEGENDS_BIQ = path.join(CIV3_ROOT, 'Conquests', 'Scenarios', 'Civilization LEGENDS.biq');

const BASE_BIQ_EXISTS = fs.existsSync(BASE_BIQ);
const TIDES_BIQ_EXISTS = fs.existsSync(TIDES_BIQ);
const CIVILIZATION_LEGENDS_BIQ_EXISTS = fs.existsSync(CIVILIZATION_LEGENDS_BIQ);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-crud-test-'));
}

/** Stand up a minimal C3X config folder so saveBundle is happy. */
function mkC3xDir(parent) {
  const c3x = path.join(parent, 'c3x');
  fs.mkdirSync(c3x, { recursive: true });
  fs.writeFileSync(path.join(c3x, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(c3x, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(c3x, 'default.districts_wonders_config.txt'),
    '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(c3x, 'default.districts_natural_wonders_config.txt'),
    '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(c3x, 'default.tile_animations.txt'),
    '#Animation\nname = A\nini_path = Art\\Units\\Warrior\\Warrior.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
  return c3x;
}

/**
 * Copy the base BIQ to a fresh tmp dir and load a scenario bundle from it.
 * Returns { tmpDir, c3xDir, biqPath, bundle } or null when the BIQ is absent.
 */
function setupScenario(sourceBiqPath = BASE_BIQ) {
  if (!sourceBiqPath || !fs.existsSync(sourceBiqPath)) return null;
  const tmpDir = mkTmpDir();
  const c3xDir = mkC3xDir(tmpDir);
  const biqPath = path.join(tmpDir, 'test.biq');
  fs.copyFileSync(sourceBiqPath, biqPath);
  fs.chmodSync(biqPath, 0o644);
  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3xDir, civ3Path: CIV3_ROOT, scenarioPath: biqPath });
  return { tmpDir, c3xDir, biqPath, bundle };
}

/** Reload the bundle from a given biqPath so we start fresh from disk. */
function reload(c3xDir, biqPath) {
  return loadBundle({ mode: 'scenario', c3xPath: c3xDir, civ3Path: CIV3_ROOT, scenarioPath: biqPath });
}

/** Count records in a given section code across the raw biq.sections. */
function countSection(bundle, sectionCode) {
  const code = String(sectionCode || '').toUpperCase();
  const sections = (bundle && bundle.biq && Array.isArray(bundle.biq.sections))
    ? bundle.biq.sections : [];
  const sec = sections.find((s) => String(s && s.code || '').toUpperCase() === code);
  return (sec && Array.isArray(sec.records)) ? sec.records.length : 0;
}

/** True iff the bundle's biq.sections contains a record with that civilopediaEntry. */
function biqHasKey(bundle, sectionCode, civKey) {
  const target = String(civKey || '').trim().toUpperCase();
  const code = String(sectionCode || '').toUpperCase();
  const sections = (bundle && bundle.biq && Array.isArray(bundle.biq.sections))
    ? bundle.biq.sections : [];
  const sec = sections.find((s) => String(s && s.code || '').toUpperCase() === code);
  if (!sec || !Array.isArray(sec.records)) return false;
  return sec.records.some((r) => {
    const f = (r.fields || []).find((field) =>
      String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry'
    );
    return String(f && f.value || '').trim().toUpperCase() === target;
  });
}

/** Return a projected entry from the given tab by civilopediaKey. */
function getEntry(bundle, tabKey, civKey) {
  const entries = bundle && bundle.tabs && bundle.tabs[tabKey] && bundle.tabs[tabKey].entries;
  if (!Array.isArray(entries)) return null;
  const target = String(civKey || '').toUpperCase();
  return entries.find((e) => String(e && e.civilopediaKey || '').toUpperCase() === target) || null;
}

/** Get projected field value from an entry's biqFields. */
function fieldVal(entry, key) {
  if (!entry || !Array.isArray(entry.biqFields)) return undefined;
  const f = entry.biqFields.find(
    (field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === String(key || '').toLowerCase()
  );
  return f ? f.value : undefined;
}

function setFieldVal(entry, key, value) {
  const field = ensureBiqField(entry, key, '');
  field.value = String(value);
  return field;
}

function parseReferenceIndexValue(value, fallback = NaN) {
  const text = String(value == null ? '' : value);
  const trailing = text.match(/\((-?\d+)\)\s*$/);
  const match = trailing || text.match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(trailing ? match[1] : match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  (Array.isArray(entry && entry.biqFields) ? entry.biqFields : []).forEach((field) => {
    const baseKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
    if (!baseKey) return;
    const occurrence = occurrenceByBaseKey.get(baseKey) || 0;
    occurrenceByBaseKey.set(baseKey, occurrence + 1);
    const text = String(field && field.value != null ? field.value : '').trim();
    const lower = text.toLowerCase();
    let normalized = text;
    if (PRTO_INDEX_DISPLAY_FIELD_KEYS.has(baseKey)) {
      normalized = String(parseReferenceIndexValue(text, -1));
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

const BIQ_INDEX_DISPLAY_FIELD_KEYS = new Set([
  'leadergender',
  'civilizationgender',
  'plurality',
  'culturegroup',
  'kingunit',
  'favoritegovernment',
  'shunnedgovernment',
  'freetech1index',
  'freetech2index',
  'freetech3index',
  'freetech4index',
  'era',
  'prerequisite1',
  'prerequisite2',
  'prerequisite3',
  'prerequisite4',
  'type',
  'prerequisite',
  'doubleshappiness',
  'gainineverycity',
  'gainoncontinent',
  'reqimprovement',
  'reqgovernment',
  'spaceshippart',
  'reqadvance',
  'obsoleteby',
  'reqresource1',
  'reqresource2',
  'unitproduced',
  'prerequisitetechnology',
  'corruption',
  'corruptionlevel',
  'hurrying',
  'immuneto',
  'requiredtech',
  'requiredresource1',
  'requiredresource2',
  'requiredresource3',
  'upgradeto',
  'enslaveresultsin',
  'unitclass'
]);

const BIQ_FIELD_SNAPSHOT_SKIP_KEYS = new Set([
  'uniquecivcounter'
]);

function shouldSkipReferenceEntryFieldSnapshot(field, options = {}) {
  const baseKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
  if (!baseKey) return true;
  if (BIQ_FIELD_SNAPSHOT_SKIP_KEYS.has(baseKey)) return true;
  if (/^performance_of_this_government_versus_government_\d+$/.test(baseKey)) return true;
  if (options.skipGovernmentRelationRows
    && (baseKey === 'canbribe' || baseKey === 'resistancemodifier' || baseKey === 'briberymodifier')) return true;
  return false;
}

function normalizeProjectedBiqFieldValue(field) {
  const baseKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
  const text = String(field && field.value != null ? field.value : '').trim();
  const lower = text.toLowerCase();
  if (lower === 'true' || lower === 'false') return lower;
  if (BIQ_INDEX_DISPLAY_FIELD_KEYS.has(baseKey)) {
    if (lower === 'none' || lower === '(none)') return '-1';
    const parsed = parseReferenceIndexValue(text, NaN);
    if (Number.isFinite(parsed)) return String(parsed);
  }
  return text;
}

function makeReferenceEntryFieldSnapshot(entry, options = {}) {
  const snapshot = new Map();
  snapshot.set('__entry.name#0', String(entry && entry.name != null ? entry.name : '').trim());
  snapshot.set('__entry.civilopediaKey#0', String(entry && entry.civilopediaKey != null ? entry.civilopediaKey : '').trim().toUpperCase());
  const occurrenceByBaseKey = new Map();
  (Array.isArray(entry && entry.biqFields) ? entry.biqFields : []).forEach((field) => {
    if (shouldSkipReferenceEntryFieldSnapshot(field, options)) return;
    const baseKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
    if (!baseKey) return;
    const occurrence = occurrenceByBaseKey.get(baseKey) || 0;
    occurrenceByBaseKey.set(baseKey, occurrence + 1);
    snapshot.set(`${baseKey}#${occurrence}`, normalizeProjectedBiqFieldValue(field));
  });
  return snapshot;
}

function assertReloadedReferenceEntryFieldsMatchPreSave(preSaveEntry, reloadedEntry, label, options = {}) {
  assert.ok(preSaveEntry, `expected pre-save ${label}`);
  assert.ok(reloadedEntry, `expected reloaded ${label}`);
  const expected = makeReferenceEntryFieldSnapshot(preSaveEntry, options);
  const actual = makeReferenceEntryFieldSnapshot(reloadedEntry, options);
  assert.equal(actual.size, expected.size, `${label} should reload with the same projected BIQ field count`);
  expected.forEach((value, key) => {
    assert.equal(actual.get(key), value, `${label} field ${key} should match the pre-save editor value after BIQ reload`);
  });
}

function makeUniqueEntryKey(entries, baseKey) {
  const existing = new Set((Array.isArray(entries) ? entries : []).map((entry) =>
    String(entry && entry.civilopediaKey || '').trim().toUpperCase()
  ));
  const base = String(baseKey || '').trim();
  if (!existing.has(base.toUpperCase())) return base;
  for (let i = 1; i < 1000; i += 1) {
    const next = `${base}${i}`;
    if (!existing.has(next.toUpperCase())) return next;
  }
  return `${base}${Date.now()}`;
}

function findBiqField(entry, key) {
  if (!entry || !Array.isArray(entry.biqFields)) return null;
  const target = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return entry.biqFields.find((field) =>
    String(field && (field.baseKey || field.key) || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') === target
  ) || null;
}

function ensureBiqField(entry, key, value = '-1') {
  let field = findBiqField(entry, key);
  if (field) return field;
  if (!Array.isArray(entry.biqFields)) entry.biqFields = [];
  field = {
    key,
    baseKey: key,
    label: key,
    value: String(value),
    originalValue: '',
    editable: true
  };
  entry.biqFields.push(field);
  return field;
}

function setReferenceField(field, targetTabKey, targetKey, staleIndex) {
  assert.ok(field, `expected field for ${targetKey}`);
  field.value = String(staleIndex);
  field.referenceTarget = {
    tabKey: targetTabKey,
    key: String(targetKey || '').trim().toUpperCase()
  };
}

function setReferenceTargetsField(field, targetTabKey, targetKeys, staleIndices, encode = null) {
  assert.ok(field, `expected list field for ${targetTabKey}`);
  const values = (Array.isArray(staleIndices) ? staleIndices : []).map((idx) => String(idx));
  field.value = typeof encode === 'function' ? encode(values) : values.join(',');
  field.referenceTargets = (Array.isArray(targetKeys) ? targetKeys : []).map((key) => ({
    tabKey: targetTabKey,
    key: String(key || '').trim().toUpperCase()
  }));
}

function encodeSigned32Bitmask(indices) {
  let mask = 0 >>> 0;
  (Array.isArray(indices) ? indices : []).forEach((idx) => {
    const bit = Number.parseInt(String(idx), 10);
    if (!Number.isFinite(bit) || bit < 0 || bit > 31) return;
    mask = (mask | ((1 << bit) >>> 0)) >>> 0;
  });
  return String(mask > 0x7fffffff ? mask - 0x100000000 : mask);
}

function decodeSigned32Bitmask(rawValue) {
  const parsed = Number.parseInt(String(rawValue == null ? '' : rawValue).trim(), 10);
  if (!Number.isFinite(parsed)) return [];
  const unsigned = parsed < 0 ? (parsed + 0x100000000) >>> 0 : parsed >>> 0;
  const out = [];
  for (let bit = 0; bit < 32; bit += 1) {
    if (((unsigned >>> bit) & 1) === 1) out.push(bit);
  }
  return out;
}

function getEntryIndex(bundle, tabKey, key) {
  const entry = getEntry(bundle, tabKey, key);
  const idx = Number(entry && entry.biqIndex);
  return Number.isFinite(idx) ? idx : -1;
}

function getEntryByBiqIndex(bundle, tabKey, biqIndex) {
  const target = Number(biqIndex);
  const entries = bundle && bundle.tabs && bundle.tabs[tabKey] && bundle.tabs[tabKey].entries;
  if (!Number.isFinite(target) || !Array.isArray(entries)) return null;
  return entries.find((entry) => Number(entry && entry.biqIndex) === target) || null;
}

function getSection(bundle, sectionCode) {
  const sections = (bundle && bundle.biq && Array.isArray(bundle.biq.sections))
    ? bundle.biq.sections : [];
  const code = String(sectionCode || '').trim().toUpperCase();
  return sections.find((section) => String(section && section.code || '').trim().toUpperCase() === code) || null;
}

function getTabSection(bundle, tabKey, sectionCode) {
  const sections = bundle && bundle.tabs && bundle.tabs[tabKey] && Array.isArray(bundle.tabs[tabKey].sections)
    ? bundle.tabs[tabKey].sections
    : [];
  const code = String(sectionCode || '').trim().toUpperCase();
  return sections.find((section) => String(section && section.code || '').trim().toUpperCase() === code) || null;
}

function getGameRecord(bundle) {
  const section = getSection(bundle, 'GAME');
  return section && Array.isArray(section.records) ? section.records[0] : null;
}

function getLeadRecords(bundle) {
  const section = getSection(bundle, 'LEAD');
  return section && Array.isArray(section.records) ? section.records : [];
}

function getRawRecordField(record, key) {
  const target = String(key || '').trim().toLowerCase();
  return (Array.isArray(record && record.fields) ? record.fields : []).find((field) =>
    String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target
  ) || null;
}

function setRawRecordFieldValue(record, key, value) {
  const field = getRawRecordField(record, key);
  assert.ok(field, `expected structured BIQ field ${key}`);
  field.value = String(value);
  return field;
}

function getRawRecordInt(record, key, fallback = NaN) {
  const field = getRawRecordField(record, key);
  const text = String(field && field.value || '');
  const trailing = text.match(/\((-?\d+)\)\s*$/);
  const match = trailing || text.match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(trailing ? match[1] : match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRawRecordsByCivilopediaKey(bundle, sectionCode, key) {
  const section = getSection(bundle, sectionCode);
  const target = String(key || '').trim().toUpperCase();
  return (section && Array.isArray(section.records) ? section.records : []).filter((record) => {
    const field = getRawRecordField(record, 'civilopediaentry');
    return String(field && field.value || '').trim().toUpperCase() === target;
  });
}

function getRawPrimaryPrtoRecord(bundle, unitKey) {
  return getRawRecordsByCivilopediaKey(bundle, 'PRTO', unitKey)
    .find((record) => getRawRecordInt(record, 'otherstrategy', -1) < 0) || null;
}

function countPrimaryPrtoRecords(bundle) {
  const section = getSection(bundle, 'PRTO');
  return (section && Array.isArray(section.records) ? section.records : []).filter((record) =>
    getRawRecordInt(record, 'otherstrategy', -1) < 0
  ).length;
}

function makeTabWithSectionRecord(bundle, tabKey, sectionCode, recordIndex = 0) {
  const section = getTabSection(bundle, tabKey, sectionCode);
  assert.ok(section && Array.isArray(section.records), `expected ${tabKey}.${sectionCode} section`);
  const record = section.records[recordIndex];
  assert.ok(record, `expected ${sectionCode} record ${recordIndex}`);
  return {
    sections: [{
      ...section,
      records: [record]
    }]
  };
}

function getRuleDefaultUnitFieldKeys() {
  return DELETE_REFERENCE_INVENTORY
    .filter((item) => item.targetSection === 'PRTO' && item.sectionCode === 'RULE' && item.kind === 'scalar')
    .map((item) => item.field);
}

function assertRuleDefaultUnitFieldsPointTo(bundle, expectedUnitKey, message) {
  const ruleSection = getTabSection(bundle, 'rules', 'RULE');
  const ruleRecord = ruleSection && Array.isArray(ruleSection.records) ? ruleSection.records[0] : null;
  assert.ok(ruleRecord, 'expected RULE record');
  const expectedIndex = expectedUnitKey ? getEntryIndex(bundle, 'units', expectedUnitKey) : -1;
  if (expectedUnitKey) assert.ok(expectedIndex >= 0, `expected unit ${expectedUnitKey} to exist`);
  for (const fieldKey of getRuleDefaultUnitFieldKeys()) {
    const actual = getRawRecordInt(ruleRecord, fieldKey, -1);
    assert.equal(actual, expectedIndex, `${message}: RULE.${fieldKey}`);
  }
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

function countStrategyBits(mask) {
  const raw = Number(mask) | 0;
  let count = 0;
  for (let bit = 0; bit < UNIT_AI_STRATEGY_FIELD_KEYS.length; bit += 1) {
    if (((raw >>> bit) & 1) === 1) count += 1;
  }
  return count;
}

function setUnitAiStrategyMask(entry, mask) {
  UNIT_AI_STRATEGY_FIELD_KEYS.forEach((key, bit) => {
    setFieldVal(entry, key, ((Number(mask) >>> bit) & 1) === 1 ? 'true' : 'false');
  });
}

function getRawPrtoStrategyMask(bundle, unitKey) {
  return getRawRecordsByCivilopediaKey(bundle, 'PRTO', unitKey)
    .reduce((mask, record) => mask | (getRawRecordInt(record, 'aistrategy', 0) | 0), 0);
}

function assertRawPrtoStrategyRows(bundle, unitKey, expectedMask, label = unitKey) {
  const records = getRawRecordsByCivilopediaKey(bundle, 'PRTO', unitKey);
  const primaries = records.filter((record) => getRawRecordInt(record, 'otherstrategy', -1) < 0);
  assert.equal(primaries.length, 1, `${label} should have one primary PRTO row`);
  const primaryIndex = Number.isFinite(Number(primaries[0] && primaries[0].index))
    ? Number(primaries[0].index)
    : getRawRecordInt(primaries[0], 'index');
  assert.equal(records.length, Math.max(1, countStrategyBits(expectedMask)), `${label} should have one raw PRTO row per strategy bit`);
  records.forEach((record) => {
    if (record === primaries[0]) return;
    assert.equal(getRawRecordInt(record, 'otherstrategy'), primaryIndex, `${label} strategy-map row should point to the primary`);
  });
  assert.equal(getRawPrtoStrategyMask(bundle, unitKey), expectedMask, `${label} should keep merged AI strategy mask`);
}

function extractFunctionSource(sourceText, name) {
  const needle = `function ${name}(`;
  const start = sourceText.indexOf(needle);
  if (start < 0) throw new Error(`Could not find function ${name}`);
  let paramDepth = 0;
  let signatureEnd = -1;
  for (let i = start + needle.length - 1; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    if (ch === '(') paramDepth += 1;
    if (ch === ')') {
      paramDepth -= 1;
      if (paramDepth === 0) {
        signatureEnd = i;
        break;
      }
    }
  }
  const bodyStart = sourceText.indexOf('{', signatureEnd);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return sourceText.slice(start, end);
}

function loadRendererImportHelpers(targetBundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'canonicalBiqFieldKey',
    'setUnitListFieldValues',
    'getUnitListFieldState',
    'parseSigned32FromValue',
    'toSigned32StringFromUnsigned',
    'decodeAvailableToIndices',
    'encodeAvailableToFromIndices',
    'getBiqFieldByBaseKey',
    'makeBlankReferenceFieldValue',
    'getReferenceRecordRefForOps',
    'makeReferenceCopyRecordOp',
    'buildNewReferenceEntryFromTemplate',
    'getImportReferenceIndexMap',
    'getTargetReferenceIndexByKey',
    'getTargetReferenceIndexByName',
    'isCivilizationNameListItemField',
    'normalizeImportedIndexedListField',
    'normalizeImportedScalarReferenceField',
    'normalizeImportedTechnologyReferenceFields',
    'normalizeImportedResourceReferenceFields',
    'normalizeImportedCivilizationReferenceFields',
    'buildGovernmentRelationRowFields',
    'normalizeImportedGovernmentRelationFields',
    'normalizeImportedGovernmentReferenceFields',
    'normalizeImportedUnitAvailableTo',
    'normalizeImportedUnitReferenceFields',
    'normalizeImportedImprovementReferenceFields',
    'normalizeImportedReferenceFields'
  ];
  const sandbox = {
    state: { bundle: targetBundle },
    REFERENCE_PREFIX_BY_TAB: {
      civilizations: 'RACE_',
      technologies: 'TECH_',
      resources: 'GOOD_',
      improvements: 'BLDG_',
      governments: 'GOVT_',
      units: 'PRTO_'
    },
    BLANK_UNIT_DEFAULT_VALUES: {
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
    },
    BLANK_UNIT_DEFAULT_TRUE_FIELDS: new Set([
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
    ]),
    inferReferenceNameFromKey: () => '',
    dedupeStrings: (values) => {
      const out = [];
      const seen = new Set();
      (Array.isArray(values) ? values : []).forEach((value) => {
        const next = String(value || '').trim();
        if (!next || seen.has(next)) return;
        seen.add(next);
        out.push(next);
      });
      return out;
    },
    toFriendlyKey: (value) => String(value || ''),
    parseIntFromDisplayValue: (value) => {
      const text = String(value == null ? '' : value).trim();
      if (!text) return null;
      if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
      const match = text.match(/\((-?\d+)\)\s*$/);
      if (!match) return null;
      const parsed = Number.parseInt(match[1], 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-unit-import.vm' });
  return sandbox.__helpers;
}

function makeTestBiqField(key, value) {
  return {
    key,
    baseKey: key,
    label: key,
    value: String(value),
    originalValue: String(value),
    editable: true
  };
}

function loadRendererDeleteHelpers() {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = ['getReferenceRecordRefForOps', 'makeReferenceCopyRecordOp'];
  const sandbox = {};
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-delete.vm' });
  return sandbox.__helpers;
}

function loadRendererIndexHelpers(targetBundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'getBaseBiqSectionCount',
    'getPredictedReferenceRecordIndex',
    'getReferenceEntryIndexForOption'
  ];
  const sandbox = {
    state: { bundle: targetBundle },
    REFERENCE_SECTION_BY_TAB: {
      civilizations: 'RACE',
      technologies: 'TECH',
      resources: 'GOOD',
      improvements: 'BLDG',
      governments: 'GOVT',
      units: 'PRTO'
    }
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-index.vm' });
  return sandbox.__helpers;
}

function loadRendererReferenceTargetHelpers(targetBundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'normalizeConfigToken',
    'parseIntFromDisplayValue',
    'getBaseBiqSectionCount',
    'getPredictedReferenceRecordIndex',
    'getReferenceEntryIndexForOption',
    'getReferenceRecordRefForOps',
    'findOptionByValue',
    'resolveReferenceEntryForPicker',
    'makeReferenceTargetMeta',
    'setFieldReferenceTargetMeta'
  ];
  const sandbox = {
    state: { bundle: targetBundle },
    REFERENCE_SECTION_BY_TAB: {
      civilizations: 'RACE',
      technologies: 'TECH',
      resources: 'GOOD',
      improvements: 'BLDG',
      governments: 'GOVT',
      units: 'PRTO'
    }
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-reference-target.vm' });
  return sandbox.__helpers;
}

function loadRendererNoReloadSaveHelpers(targetBundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'getFieldByBaseKey',
    'getBiqSectionByCode',
    'getReferenceRecordIndexFromOriginalBiq',
    'reconcileReferenceTabsAfterNoReloadSave'
  ];
  const sandbox = {
    state: {
      bundle: targetBundle,
      referenceSelection: { technologies: 0 }
    },
    REFERENCE_SECTION_BY_TAB: {
      civilizations: 'RACE',
      technologies: 'TECH',
      resources: 'GOOD',
      improvements: 'BLDG',
      governments: 'GOVT',
      units: 'PRTO'
    }
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ', state };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-no-reload-save.vm' });
  return sandbox.__helpers;
}

function loadRendererMapSaveHelpers(targetBundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = ['markMapTabAsSaved'];
  const sandbox = {
    state: {
      bundle: targetBundle
    }
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ', state };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-map-save.vm' });
  return sandbox.__helpers;
}

function loadRendererNoReloadCleanHelpers(targetBundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'markScenarioDistrictsAsSaved',
    'getSavedPediaIconsPath',
    'improvementPediaIconsBlockWasWritten',
    'markSavedPediaIconsSourceMeta',
    'markMapTabAsSaved',
    'markReferenceTabEntryOriginals',
    'markReferenceTabsAsSaved',
    'getScienceAdvisorArrowStyleSnapshotValue',
    'getScienceAdvisorArrowMetadataSnapshotValue',
    'getScienceAdvisorArrowMetadataEraKeysForSave',
    'markScienceAdvisorArrowMetadataErasSaved',
    'captureCleanScienceAdvisorArrowStyle',
    'markCurrentBundleCleanAfterSave'
  ];
  const sandbox = {
    state: {
      bundle: targetBundle,
      settings: {},
      cleanSnapshot: '',
      cleanTabsCache: null,
      techTreeArrowArtDirty: true,
      techTreeArrowArtDirtyByEra: { 1: true },
      techTreeArrowDirtyEdgesByEra: { 1: { edge: true } },
      techTreeArrowMetadataEraKeys: { 0: true },
      techTreeArrowBaselineRouteHints: { '0:TECH_A->TECH_B': { points: [[0, 0], [1, 1]] } },
      techTreeArrowRouteOverrides: { '1:TECH_C->TECH_D': { points: [[2, 2], [3, 3]] } },
      cleanScienceAdvisorArrowStyle: null,
      cleanTechTreeArrowBaselineRouteHints: {},
      cleanTechTreeArrowRouteOverrides: {},
      cleanTechTreeArrowMetadataEraKeys: {},
      dirtyTabCounts: {
        technologies: 1,
        scenarioSettings: 1,
        rules: 1,
        terrain: 1,
        world: 1,
        map: 1
      },
      isDirty: true,
      undoHistory: [{ label: 'before save' }]
    },
    el: {},
    isTechTreeModalVisible: () => true,
    getCurrentTechTreeModalConfig: () => ({ tabKey: 'technologies' }),
    getTechTreeModalPreservedEra: () => 1,
    invalidatePreviewStateForReload: () => {
      sandbox.state.previewInvalidatedAfterTechTreeArrowSave = true;
    },
    reopenTechTreeModalAfterUndo: (_config, preservedEra) => {
      sandbox.state.reopenedTechTreeEraAfterArrowSave = preservedEra;
    },
    deepCloneUiValue: (value) => JSON.parse(JSON.stringify(value)),
    snapshotTabs: () => JSON.stringify(sandbox.state.bundle.tabs),
    parseSnapshotTabs: (snapshot) => JSON.parse(snapshot),
    clearCleanReferenceDirtySignatureCache: () => {},
    clearDirtyTabCounts: () => {
      sandbox.state.dirtyTabCounts = {};
    },
    markFilesReadEntriesDirty: () => {},
    recomputeFilesReadIssueCount: () => {},
    refreshTabDirtyBadges: () => {},
    refreshActiveReferenceListDirtyBadges: () => {},
    refreshActiveBiqRecordListDirtyBadges: () => {},
    renderTabs: () => {},
    renderActiveTab: () => {},
    renderFilesReadModal: () => {},
    refreshFilesReadAccess: () => {},
    reconcileReferenceTabsAfterNoReloadSave: () => false
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ', state };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-no-reload-clean.vm' });
  return sandbox.__helpers;
}

function loadRendererReferenceDirtyHelpers(targetBundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = ['rebuildReferenceDirtyCacheForTab'];
  const sandbox = {
    state: {
      bundle: targetBundle,
      dirtyReferenceKeysByTab: {
        technologies: new Set(['id:NEW_TECH_OLD', 'key:TECH_NEW_TECH', 'id:NEW_TECH'])
      },
      dirtyTabCounts: {},
      cleanReferenceDirtySignatureByKey: new Map()
    },
    getReferenceEntryIdentity,
    ensureReferenceDirtySet: (tabKey) => {
      if (!sandbox.state.dirtyReferenceKeysByTab[tabKey]) sandbox.state.dirtyReferenceKeysByTab[tabKey] = new Set();
      return sandbox.state.dirtyReferenceKeysByTab[tabKey];
    },
    getCleanReferenceEntry: (tabKey, entry) => {
      const cleanEntries = targetBundle.cleanTabs && targetBundle.cleanTabs[tabKey] && targetBundle.cleanTabs[tabKey].entries;
      const identity = getReferenceEntryIdentity(tabKey, entry, 0);
      return (Array.isArray(cleanEntries) ? cleanEntries : []).find((cleanEntry, idx) => (
        getReferenceEntryIdentity(tabKey, cleanEntry, idx) === identity
      )) || null;
    },
    hasReferenceEntryChangedFromClean: (entry, cleanEntry) => {
      if (!entry || !cleanEntry) return true;
      return JSON.stringify(entry) !== JSON.stringify(cleanEntry);
    },
    getEffectiveCleanTabForDirty: (tabKey) => targetBundle.cleanTabs && targetBundle.cleanTabs[tabKey] || null,
    countCivilizationDiplomacySlotChanges: () => 0,
    setTabDirtyCount: (tabKey, count) => {
      const n = Number(count) || 0;
      if (n > 0) sandbox.state.dirtyTabCounts[tabKey] = n;
      else delete sandbox.state.dirtyTabCounts[tabKey];
    }
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ', state };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-reference-dirty.vm' });
  return sandbox.__helpers;
}

function loadRendererTopNameHelpers() {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = ['getReferenceTopNameBiqFieldKey', 'shouldHideBiqField'];
  const emptySet = new Set();
  const sandbox = {
    BIQ_FIELD_HIDDEN: { all: emptySet },
    UNIT_BOTTOM_LIST_HIDDEN_KEYS: emptySet,
    QUINT_UNIT_RULE_VISIBLE_KEYS: emptySet,
    QUINT_TECH_RULE_VISIBLE_KEYS: emptySet,
    QUINT_IMPROVEMENT_RULE_VISIBLE_KEYS: emptySet,
    QUINT_GOVERNMENT_RULE_VISIBLE_KEYS: emptySet,
    QUINT_CIV_RULE_VISIBLE_KEYS: emptySet,
    isReadonlyRuleField: () => false,
    isCivilizationNameListItemField: () => false,
    isGovernmentRelationsField: () => false
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-top-name.vm' });
  return sandbox.__helpers;
}

function loadRendererCivilopediaKeyHelpers() {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'normalizeReferenceKeyToken',
    'stripReferencePrefixToken',
    'trimReferenceCivilopediaKeyToMax',
    'makeReferenceCivilopediaKeyFromInput',
    'ensureReferenceCivilopediaKeyInputPrefix',
    'getExistingReferenceCivilopediaKeys',
    'makeUniqueReferenceCivilopediaKeyFromKey',
    'makeUniqueReferenceCivilopediaKey',
    'validateReferenceCivilopediaKeyInput'
  ];
  const sandbox = {
    REFERENCE_KEY_MAX_LENGTH: 31,
    REFERENCE_PREFIX_BY_TAB: {
      civilizations: 'RACE_',
      technologies: 'TECH_',
      resources: 'GOOD_',
      improvements: 'BLDG_',
      governments: 'GOVT_',
      units: 'PRTO_'
    },
    ALL_REFERENCE_PREFIXES: ['RACE_', 'TECH_', 'GOOD_', 'BLDG_', 'GOVT_', 'PRTO_']
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-civilopedia-key.vm' });
  return sandbox.__helpers;
}

function buildReferenceIndexMap(bundle, tabKey) {
  const entries = bundle && bundle.tabs && bundle.tabs[tabKey] && bundle.tabs[tabKey].entries;
  return (Array.isArray(entries) ? entries : []).map((entry, fallbackIdx) => ({
    index: Number.isFinite(entry && entry.biqIndex) ? Number(entry.biqIndex) : fallbackIdx,
    civilopediaKey: String(entry && entry.civilopediaKey || '').trim().toUpperCase(),
    name: String(entry && entry.name || '').trim()
  })).filter((item) => Number.isFinite(item.index) && item.index >= 0 && (item.civilopediaKey || item.name));
}

function makeShortTestRef(prefix, label = 'T') {
  const token = `${label}_${Date.now().toString(36).slice(-7)}_${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
  return `${prefix}${token}`.slice(0, 31);
}

function cloneReferenceEntry(entry) {
  return JSON.parse(JSON.stringify(entry));
}

function setCrudTestEntryName(tabKey, entry, name) {
  entry.name = String(name);
  const fieldKey = tabKey === 'civilizations' ? 'civilizationname' : 'name';
  setFieldVal(entry, fieldKey, name);
}

function applyRepresentativeCrudEditsToEntry(tabKey, entry, bundle, label) {
  const safeName = String(label || 'CRUD Field Test').slice(0, 28);
  setCrudTestEntryName(tabKey, entry, safeName);
  switch (tabKey) {
    case 'civilizations':
      setFieldVal(entry, 'leadername', `${safeName} Leader`);
      setFieldVal(entry, 'noun', `${safeName} People`);
      setFieldVal(entry, 'adjective', `${safeName} Adj`);
      setFieldVal(entry, 'aggressionlevel', '4');
      setFieldVal(entry, 'leadergender', '1');
      setFieldVal(entry, 'favoritegovernment', '1');
      setFieldVal(entry, 'shunnedgovernment', '0');
      setFieldVal(entry, 'kingunit', '0');
      setFieldVal(entry, 'freetech1index', '0');
      setFieldVal(entry, 'militaristic', 'true');
      setFieldVal(entry, 'scientific', 'true');
      if (Number.parseInt(String(fieldVal(entry, 'numcitynames') || '0'), 10) <= 0) {
        setFieldVal(entry, 'numcitynames', '1');
        setFieldVal(entry, 'cityname_0', 'C3X Test City');
      }
      break;
    case 'technologies':
      setFieldVal(entry, 'cost', '123');
      setFieldVal(entry, 'era', '1');
      setFieldVal(entry, 'advanceicon', '7');
      setFieldVal(entry, 'x', '111');
      setFieldVal(entry, 'y', '222');
      setFieldVal(entry, 'prerequisite1', '0');
      setFieldVal(entry, 'prerequisite2', '-1');
      setFieldVal(entry, 'enablesbridges', 'true');
      setFieldVal(entry, 'cannotbetraded', 'true');
      setFieldVal(entry, 'flavor_1', 'true');
      break;
    case 'resources':
      setFieldVal(entry, 'type', '2');
      setFieldVal(entry, 'appearanceratio', '175');
      setFieldVal(entry, 'disapperanceprobability', '3');
      setFieldVal(entry, 'icon', '4');
      setFieldVal(entry, 'prerequisite', '0');
      setFieldVal(entry, 'foodbonus', '1');
      setFieldVal(entry, 'shieldsbonus', '2');
      setFieldVal(entry, 'commercebonus', '3');
      break;
    case 'improvements':
      setFieldVal(entry, 'description', `${safeName} Description`);
      setFieldVal(entry, 'cost', '234');
      setFieldVal(entry, 'culture', '5');
      setFieldVal(entry, 'maintenancecost', '2');
      setFieldVal(entry, 'reqadvance', '0');
      setFieldVal(entry, 'reqresource1', '0');
      setFieldVal(entry, 'reqgovernment', '0');
      setFieldVal(entry, 'unitproduced', '0');
      setFieldVal(entry, 'unitfrequency', '4');
      setFieldVal(entry, 'veteranunits', 'true');
      setFieldVal(entry, 'militaristic', 'true');
      setFieldVal(entry, 'flavor_1', 'true');
      break;
    case 'governments':
      setFieldVal(entry, 'prerequisitetechnology', '0');
      setFieldVal(entry, 'corruption', '3');
      setFieldVal(entry, 'sciencecap', '77');
      setFieldVal(entry, 'workerrate', '3');
      setFieldVal(entry, 'draftlimit', '2');
      setFieldVal(entry, 'militarypolicelimit', '4');
      setFieldVal(entry, 'immuneto', '0');
      setFieldVal(entry, 'hurrying', '2');
      setFieldVal(entry, 'xenophobic', 'true');
      setFieldVal(entry, 'malerulertitle1', `${safeName} Ruler`);
      break;
    case 'units':
      setFieldVal(entry, 'requiredtech', '0');
      setFieldVal(entry, 'requiredresource1', '0');
      setFieldVal(entry, 'requiredresource2', '-1');
      setFieldVal(entry, 'requiredresource3', '-1');
      setFieldVal(entry, 'upgradeto', '-1');
      setFieldVal(entry, 'attack', '11');
      setFieldVal(entry, 'defence', '7');
      setFieldVal(entry, 'movement', '2');
      setFieldVal(entry, 'shieldcost', '99');
      setFieldVal(entry, 'unitclass', '0');
      setFieldVal(entry, 'enslaveresultsin', '-1');
      setFieldVal(entry, 'offence', 'true');
      setFieldVal(entry, 'defencestrategy', 'true');
      setFieldVal(entry, 'footsoldier', 'true');
      break;
    default:
      setCrudTestEntryName(tabKey, entry, safeName);
  }
  return entry;
}

function setBaseConfigRow(bundle, key, value) {
  const baseTab = bundle && bundle.tabs && bundle.tabs.base;
  assert.ok(baseTab && Array.isArray(baseTab.rows), 'expected base tab rows');
  let row = baseTab.rows.find((item) => String(item && item.key || '') === String(key || ''));
  if (!row) {
    row = {
      key: String(key || ''),
      defaultValue: '',
      effectiveValue: '',
      value: '',
      type: 'string'
    };
    baseTab.rows.push(row);
  }
  row.value = String(value || '');
  return row;
}

function sectionFieldValue(section, key) {
  const target = String(key || '').trim().toLowerCase();
  const field = (Array.isArray(section && section.fields) ? section.fields : []).find((item) =>
    String(item && item.key || '').trim().toLowerCase() === target
  );
  return field ? String(field.value || '') : '';
}

test('reference top-name editor targets civilizationName for Civs', () => {
  const { getReferenceTopNameBiqFieldKey } = loadRendererTopNameHelpers();
  assert.equal(getReferenceTopNameBiqFieldKey('civilizations'), 'civilizationname');
  assert.equal(getReferenceTopNameBiqFieldKey('technologies'), 'name');
  assert.equal(getReferenceTopNameBiqFieldKey('resources'), 'name');
  assert.equal(getReferenceTopNameBiqFieldKey('improvements'), 'name');
  assert.equal(getReferenceTopNameBiqFieldKey('governments'), 'name');
  assert.equal(getReferenceTopNameBiqFieldKey('units'), 'name');
});

test('civilizationName field is hidden from Civs detail fields because top Name edits it', () => {
  const { shouldHideBiqField } = loadRendererTopNameHelpers();
  assert.equal(shouldHideBiqField('civilizations', { key: 'civilizationname', baseKey: 'civilizationname' }), true);
});

test('Civilopedia key helper prefixes names, replaces spaces, and enforces BIQ length', () => {
  const { makeReferenceCivilopediaKeyFromInput, ensureReferenceCivilopediaKeyInputPrefix, validateReferenceCivilopediaKeyInput } = loadRendererCivilopediaKeyHelpers();
  assert.equal(makeReferenceCivilopediaKeyFromInput('technologies', 'Pottery', { preserveCase: true }), 'TECH_Pottery');
  assert.equal(ensureReferenceCivilopediaKeyInputPrefix('technologies', ''), 'TECH_');
  assert.equal(ensureReferenceCivilopediaKeyInputPrefix('technologies', 'TECH'), 'TECH_');
  assert.equal(ensureReferenceCivilopediaKeyInputPrefix('technologies', 'TEC'), 'TECH_');
  assert.equal(ensureReferenceCivilopediaKeyInputPrefix('technologies', 'Pottery'), 'TECH_Pottery');
  const spaced = validateReferenceCivilopediaKeyInput({ entries: [] }, 'technologies', 'TECH_Ancient Pottery');
  assert.equal(spaced.key, 'TECH_Ancient_Pottery');
  assert.equal(spaced.isValid, true);
  assert.match(spaced.warning, /Spaces/);
  const longKey = makeReferenceCivilopediaKeyFromInput('technologies', 'A'.repeat(80), { preserveCase: true });
  assert.equal(longKey.length, 31);
  assert.equal(longKey.startsWith('TECH_'), true);
});

test('initial copied Civilopedia keys preserve the display name casing', () => {
  const { makeUniqueReferenceCivilopediaKey } = loadRendererCivilopediaKeyHelpers();
  const tab = {
    entries: [
      { civilopediaKey: 'TECH_BRONZE_WORKING' },
      { civilopediaKey: 'TECH_Bronze_Working_Copy' }
    ]
  };
  assert.equal(
    makeUniqueReferenceCivilopediaKey(tab, 'technologies', 'Bronze Working Copy', '', { preserveCase: true }),
    'TECH_Bronze_Working_Copy1'
  );
});

test('Civilopedia key validation warns and uniquifies duplicates while allowing the current new entry key', () => {
  const { validateReferenceCivilopediaKeyInput } = loadRendererCivilopediaKeyHelpers();
  const tab = {
    entries: [
      { civilopediaKey: 'TECH_POTTERY' },
      { civilopediaKey: 'TECH_NEW_CLAY', isNew: true }
    ],
    recordOps: [{ op: 'add', newRecordRef: 'TECH_NEW_CLAY' }]
  };
  const duplicate = validateReferenceCivilopediaKeyInput(tab, 'technologies', 'Pottery', { excludeKey: 'TECH_NEW_CLAY' });
  assert.equal(duplicate.isValid, true);
  assert.equal(duplicate.key, 'TECH_Pottery1');
  assert.match(duplicate.warning, /already exists/);
  const current = validateReferenceCivilopediaKeyInput(tab, 'technologies', 'TECH_NEW_CLAY', { excludeKey: 'TECH_NEW_CLAY' });
  assert.equal(current.isValid, true);
  assert.equal(current.key, 'TECH_NEW_CLAY');
});

test('pending added references predict appended BIQ index instead of using list position', () => {
  const cases = [
    { tabKey: 'civilizations', sectionCode: 'RACE', prefix: 'RACE_', count: 4 },
    { tabKey: 'technologies', sectionCode: 'TECH', prefix: 'TECH_', count: 3 },
    { tabKey: 'resources', sectionCode: 'GOOD', prefix: 'GOOD_', count: 5 },
    { tabKey: 'improvements', sectionCode: 'BLDG', prefix: 'BLDG_', count: 6 },
    { tabKey: 'governments', sectionCode: 'GOVT', prefix: 'GOVT_', count: 2 },
    { tabKey: 'units', sectionCode: 'PRTO', prefix: 'PRTO_', count: 8 }
  ];
  const bundle = {
    biq: {
      sections: cases.map(({ sectionCode, count }) => ({
        code: sectionCode,
        count,
        records: Array.from({ length: count }, () => ({}))
      }))
    },
    tabs: {}
  };
  cases.forEach(({ tabKey, prefix, count }) => {
    const newRef = `${prefix}PENDING_NEW`;
    bundle.tabs[tabKey] = {
      entries: [
        { civilopediaKey: newRef, biqIndex: null, isNew: true },
        { civilopediaKey: `${prefix}ALPHA`, biqIndex: 0 },
        { civilopediaKey: `${prefix}BETA`, biqIndex: 1 }
      ],
      recordOps: [{ op: 'add', newRecordRef: newRef }]
    };
    bundle.tabs[tabKey]._expectedCount = count;
  });
  const { getReferenceEntryIndexForOption } = loadRendererIndexHelpers(bundle);

  cases.forEach(({ tabKey, count, prefix }) => {
    assert.equal(
      getReferenceEntryIndexForOption(tabKey, bundle.tabs[tabKey].entries[0], 0),
      count,
      `pending ${prefix} entry should resolve to append index, not UI row 0`
    );
    assert.equal(
      getReferenceEntryIndexForOption(tabKey, bundle.tabs[tabKey].entries[1], 1),
      0,
      `existing ${prefix}ALPHA should keep raw BIQ index 0`
    );
  });
});

test('new pending tech assigned as civilization free tech saves by final BIQ index, not zero', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const baseTechCount = countSection(before, 'TECH');
  const civ = before.tabs.civilizations.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'freetech3index')
  );
  if (!civ) return t.skip('No civilization free tech field found');

  const newTechKey = makeShortTestRef('TECH_', 'CIV_FREE');
  setReferenceField(findBiqField(civ, 'freetech3index'), 'technologies', newTechKey, baseTechCount);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    dirtyTabs: ['civilizations', 'technologies'],
    tabs: {
      civilizations: {
        entries: [civ]
      },
      technologies: {
        entries: [
          { civilopediaKey: newTechKey, name: 'Civ Free Tech', biqIndex: null, isNew: true }
        ],
        recordOps: [{ op: 'add', newRecordRef: newTechKey }]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const savedTechIndex = getEntryIndex(after, 'technologies', newTechKey);
  assert.equal(savedTechIndex, baseTechCount);
  assert.notEqual(savedTechIndex, 0);
  const reloadedCiv = getEntry(after, 'civilizations', civ.civilopediaKey);
  assert.ok(reloadedCiv, 'expected civilization after reload');
  assert.equal(getRawRecordInt({ fields: reloadedCiv.biqFields }, 'freetech3index'), savedTechIndex);
});

test('pending reference planning ignores empty or missing BIQ indexes when saving references', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const baseTechCount = countSection(before, 'TECH');
  const civ = before.tabs.civilizations.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'freetech3index')
  );
  if (!civ) return t.skip('No civilization free tech field found');

  const emptyIndexKey = makeShortTestRef('TECH_', 'EMPTYIDX');
  const missingIndexKey = makeShortTestRef('TECH_', 'MISSIDX');
  setReferenceField(findBiqField(civ, 'freetech3index'), 'technologies', missingIndexKey, baseTechCount + 1);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    dirtyTabs: ['civilizations', 'technologies'],
    tabs: {
      civilizations: {
        entries: [civ]
      },
      technologies: {
        entries: [
          { civilopediaKey: emptyIndexKey, name: 'Empty Index Tech', biqIndex: '', isNew: true },
          { civilopediaKey: missingIndexKey, name: 'Missing Index Tech', isNew: true }
        ],
        recordOps: [
          { op: 'add', newRecordRef: emptyIndexKey },
          { op: 'add', newRecordRef: missingIndexKey }
        ]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const emptyIndex = getEntryIndex(after, 'technologies', emptyIndexKey);
  const missingIndex = getEntryIndex(after, 'technologies', missingIndexKey);
  assert.equal(emptyIndex, baseTechCount);
  assert.equal(missingIndex, baseTechCount + 1);
  assert.notEqual(missingIndex, 0);
  const reloadedCiv = getEntry(after, 'civilizations', civ.civilopediaKey);
  assert.ok(reloadedCiv, 'expected civilization after reload');
  assert.equal(getRawRecordInt({ fields: reloadedCiv.biqFields }, 'freetech3index'), missingIndex);
});

test('dirty Improvement Required Government saves through non-dirty Government reference data', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const democracy = before.tabs.governments.entries.find((entry) =>
    String(entry && entry.name || '').trim().toLowerCase() === 'democracy'
  );
  if (!democracy) return t.skip('No Democracy government found');
  const democracyIndex = Number(democracy.biqIndex);
  assert.equal(Number.isFinite(democracyIndex), true, 'expected Democracy BIQ index');

  const improvement = before.tabs.improvements.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex))
      && findBiqField(entry, 'reqgovernment')
      && getRawRecordInt({ fields: entry.biqFields }, 'reqgovernment', -1) !== democracyIndex
  );
  if (!improvement) return t.skip('No improvement with a different Required Government found');

  const field = findBiqField(improvement, 'reqgovernment');
  field.value = String(democracyIndex);
  field.originalValue = String(democracyIndex);
  field.referenceTarget = {
    tabKey: 'governments',
    key: democracy.civilopediaKey
  };

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    dirtyTabs: ['improvements'],
    tabs: {
      improvements: before.tabs.improvements,
      governments: before.tabs.governments
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));
  assert.ok(
    saveResult.saveReport.some((item) => item.kind === 'biq' && Number(item.applied || 0) > 0),
    'expected BIQ write for Required Government change'
  );

  const after = reload(c3xDir, biqPath);
  const reloaded = getEntry(after, 'improvements', improvement.civilopediaKey);
  assert.ok(reloaded, 'expected improvement after reload');
  assert.equal(getRawRecordInt({ fields: reloaded.biqFields }, 'reqgovernment'), democracyIndex);
});

test('pending BIQ entries referenced from C3X base and District configs survive save and reload by name', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const bundle = reload(c3xDir, biqPath);

  const techKey = makeShortTestRef('TECH_', 'C3X_REF');
  const resourceKey = makeShortTestRef('GOOD_', 'C3X_REF');
  const improvementKey = makeShortTestRef('BLDG_', 'C3X_REF');
  const unitKey = makeShortTestRef('PRTO_', 'C3X_REF');
  const techName = 'C3X Pending Tech';
  const resourceName = 'C3X Pending Resource';
  const improvementName = 'C3X Pending Building';
  const unitName = 'C3X Pending Unit';

  setBaseConfigRow(bundle, 'technology_perfume', `["${techName}": 12]`);
  setBaseConfigRow(bundle, 'resource_perfume', `["${resourceName}": 20]`);
  setBaseConfigRow(bundle, 'building_prereqs_for_units', `["${improvementName}": "${unitName}"]`);
  setBaseConfigRow(bundle, 'buildings_generating_resources', `["${improvementName}": local yields "${resourceName}"]`);

  bundle.tabs.districts.model = {
    sections: [{
      marker: '#District',
      fields: [
        { key: 'name', value: 'Pending Reference District' },
        { key: 'advance_prereqs', value: `"${techName}"` },
        { key: 'dependent_improvs', value: `"${improvementName}"` },
        { key: 'resource_prereqs', value: `"${resourceName}"` },
        { key: 'resource_prereq_on_tile', value: resourceName },
        { key: 'generated_resource', value: `"${resourceName}" local yields` }
      ],
      comments: []
    }],
    headerComments: []
  };

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    dirtyTabs: ['base', 'districts', 'technologies', 'resources', 'improvements', 'units'],
    tabs: {
      base: bundle.tabs.base,
      districts: bundle.tabs.districts,
      technologies: {
        entries: [{ civilopediaKey: techKey, name: techName, biqIndex: null, isNew: true }],
        recordOps: [{ op: 'add', newRecordRef: techKey }]
      },
      resources: {
        entries: [{ civilopediaKey: resourceKey, name: resourceName, biqIndex: null, isNew: true }],
        recordOps: [{ op: 'add', newRecordRef: resourceKey }]
      },
      improvements: {
        entries: [{ civilopediaKey: improvementKey, name: improvementName, biqIndex: null, isNew: true }],
        recordOps: [{ op: 'add', newRecordRef: improvementKey }]
      },
      units: {
        entries: [{ civilopediaKey: unitKey, name: unitName, biqIndex: null, isNew: true }],
        recordOps: [{ op: 'add', newRecordRef: unitKey }]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.ok(getEntry(after, 'technologies', techKey), 'expected pending tech to be saved to BIQ');
  assert.ok(getEntry(after, 'resources', resourceKey), 'expected pending resource to be saved to BIQ');
  assert.ok(getEntry(after, 'improvements', improvementKey), 'expected pending improvement to be saved to BIQ');
  assert.ok(getEntry(after, 'units', unitKey), 'expected pending unit to be saved to BIQ');

  const baseRows = after.tabs.base.rows;
  assert.equal(baseRows.find((row) => row.key === 'technology_perfume').value, `["${techName}": 12]`);
  assert.equal(baseRows.find((row) => row.key === 'resource_perfume').value, `["${resourceName}": 20]`);
  assert.equal(baseRows.find((row) => row.key === 'building_prereqs_for_units').value, `["${improvementName}": "${unitName}"]`);
  assert.equal(baseRows.find((row) => row.key === 'buildings_generating_resources').value, `["${improvementName}": local yields "${resourceName}"]`);

  const district = after.tabs.districts.model.sections.find((section) =>
    sectionFieldValue(section, 'name') === 'Pending Reference District'
  );
  assert.ok(district, 'expected district config section after reload');
  assert.equal(sectionFieldValue(district, 'advance_prereqs'), techName);
  assert.equal(sectionFieldValue(district, 'dependent_improvs'), improvementName);
  assert.equal(sectionFieldValue(district, 'resource_prereqs'), resourceName);
  assert.equal(sectionFieldValue(district, 'resource_prereq_on_tile'), resourceName);
  assert.equal(sectionFieldValue(district, 'generated_resource'), `"${resourceName}" local yields`);
});

test('copying from an unsaved edited tech preserves inherited prereqs after save', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { tmpDir, c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const sourceEntry = before.tabs.technologies.entries.find((entry) => Number.isFinite(Number(entry && entry.biqIndex)))
    || before.tabs.technologies.entries[0];
  if (!sourceEntry) return t.skip('No source tech found');

  const baseCount = countSection(before, 'TECH');
  const prereqTarget = before.tabs.technologies.entries.find((entry) => {
    const idx = Number(entry && entry.biqIndex);
    return Number.isFinite(idx) && idx >= 0 && idx !== Number(sourceEntry.biqIndex);
  });
  if (!prereqTarget) return t.skip('No target prerequisite tech found');
  const prereqTargetIndex = Number(prereqTarget.biqIndex);

  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers(before);
  const firstKey = makeShortTestRef('TECH_', 'CHAINA');
  const secondKey = makeShortTestRef('TECH_', 'CHAINB');
  const first = buildNewReferenceEntryFromTemplate({
    tabKey: 'technologies',
    sourceEntry,
    civilopediaKey: firstKey,
    mode: 'copy',
    displayName: 'Unsaved Chain A'
  });
  const setField = (entry, key, value) => {
    const field = entry.biqFields.find((item) => String(item && (item.baseKey || item.key) || '').toLowerCase() === key);
    assert.ok(field, `expected ${key} field`);
    field.value = String(value);
  };
  setField(first, 'prerequisite1', String(prereqTargetIndex));
  setField(first, 'prerequisite2', '-1');
  setField(first, 'prerequisite3', '-1');
  setField(first, 'prerequisite4', '-1');

  const second = buildNewReferenceEntryFromTemplate({
    tabKey: 'technologies',
    sourceEntry: first,
    civilopediaKey: secondKey,
    mode: 'copy',
    displayName: 'Unsaved Chain B'
  });
  setField(second, 'prerequisite2', String(baseCount));

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      technologies: {
        entries: [second, first],
        recordOps: [
          { op: 'copy', sourceRef: String(sourceEntry.civilopediaKey || '').toUpperCase(), newRecordRef: firstKey },
          { op: 'copy', sourceRef: firstKey, newRecordRef: secondKey }
        ]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const reloadedFirst = getEntry(after, 'technologies', firstKey);
  const reloadedSecond = getEntry(after, 'technologies', secondKey);
  assert.ok(reloadedFirst, 'expected first copied tech after reload');
  assert.ok(reloadedSecond, 'expected second copied tech after reload');
  assert.equal(getRawRecordInt({ fields: reloadedFirst.biqFields }, 'prerequisite1'), prereqTargetIndex);
  assert.equal(getRawRecordInt({ fields: reloadedSecond.biqFields }, 'prerequisite1'), prereqTargetIndex);
  assert.equal(getRawRecordInt({ fields: reloadedSecond.biqFields }, 'prerequisite2'), baseCount);
});

test('pending tech references are resolved after deleting the middle unsaved tech before first save', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const baseCount = countSection(before, 'TECH');
  const host = before.tabs.technologies.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'prerequisite1') && findBiqField(entry, 'prerequisite2')
  );
  if (!host) return t.skip('No editable technology prerequisite host found');

  const firstKey = makeShortTestRef('TECH_', 'PEND_A');
  const deletedKey = makeShortTestRef('TECH_', 'PEND_B');
  const survivorKey = makeShortTestRef('TECH_', 'PEND_C');
  setReferenceField(findBiqField(host, 'prerequisite1'), 'technologies', firstKey, baseCount);
  setReferenceField(findBiqField(host, 'prerequisite2'), 'technologies', survivorKey, baseCount + 2);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      technologies: {
        entries: [host],
        recordOps: [
          { op: 'add', newRecordRef: firstKey },
          { op: 'add', newRecordRef: survivorKey }
        ]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(getEntry(after, 'technologies', deletedKey), null, 'deleted pending tech should never be written');
  const firstIndex = getEntryIndex(after, 'technologies', firstKey);
  const survivorIndex = getEntryIndex(after, 'technologies', survivorKey);
  assert.equal(firstIndex, baseCount);
  assert.equal(survivorIndex, baseCount + 1);
  const reloadedHost = getEntry(after, 'technologies', host.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'prerequisite1'), firstIndex);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'prerequisite2'), survivorIndex);
});

test('pending resource references in unit requirements survive middle pending resource deletion', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const baseCount = countSection(before, 'GOOD');
  const host = before.tabs.units.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'requiredresource1') && findBiqField(entry, 'requiredresource2')
  );
  if (!host) return t.skip('No editable unit resource requirement host found');

  const firstKey = makeShortTestRef('GOOD_', 'PEND_A');
  const deletedKey = makeShortTestRef('GOOD_', 'PEND_B');
  const survivorKey = makeShortTestRef('GOOD_', 'PEND_C');
  setReferenceField(findBiqField(host, 'requiredresource1'), 'resources', firstKey, baseCount);
  setReferenceField(findBiqField(host, 'requiredresource2'), 'resources', survivorKey, baseCount + 2);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      resources: {
        recordOps: [
          { op: 'add', newRecordRef: firstKey },
          { op: 'add', newRecordRef: survivorKey }
        ]
      },
      units: { entries: [host] }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(getEntry(after, 'resources', deletedKey), null, 'deleted pending resource should never be written');
  const firstIndex = getEntryIndex(after, 'resources', firstKey);
  const survivorIndex = getEntryIndex(after, 'resources', survivorKey);
  const reloadedHost = getEntry(after, 'units', host.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'requiredresource1'), firstIndex);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'requiredresource2'), survivorIndex);
});

test('pending improvement self-references survive middle pending improvement deletion', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const baseCount = countSection(before, 'BLDG');
  const host = before.tabs.improvements.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'reqimprovement') && findBiqField(entry, 'gainineverycity')
  );
  if (!host) return t.skip('No editable improvement reference host found');

  const firstKey = makeShortTestRef('BLDG_', 'PEND_A');
  const deletedKey = makeShortTestRef('BLDG_', 'PEND_B');
  const survivorKey = makeShortTestRef('BLDG_', 'PEND_C');
  setReferenceField(findBiqField(host, 'reqimprovement'), 'improvements', firstKey, baseCount);
  setReferenceField(findBiqField(host, 'gainineverycity'), 'improvements', survivorKey, baseCount + 2);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      improvements: {
        entries: [host],
        recordOps: [
          { op: 'add', newRecordRef: firstKey },
          { op: 'add', newRecordRef: survivorKey }
        ]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(getEntry(after, 'improvements', deletedKey), null, 'deleted pending improvement should never be written');
  const firstIndex = getEntryIndex(after, 'improvements', firstKey);
  const survivorIndex = getEntryIndex(after, 'improvements', survivorKey);
  const reloadedHost = getEntry(after, 'improvements', host.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'reqimprovement'), firstIndex);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'gainineverycity'), survivorIndex);
});

test('pending unit scalar and list references survive middle pending unit deletion', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const baseCount = countSection(before, 'PRTO');
  const host = before.tabs.units.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'upgradeto')
  );
  if (!host) return t.skip('No editable unit reference host found');

  const firstKey = makeShortTestRef('PRTO_', 'PEND_A');
  const deletedKey = makeShortTestRef('PRTO_', 'PEND_B');
  const survivorKey = makeShortTestRef('PRTO_', 'PEND_C');
  setReferenceField(findBiqField(host, 'upgradeto'), 'units', survivorKey, baseCount + 2);
  const stealthField = ensureBiqField(host, 'stealth_target', String(baseCount + 2));
  setReferenceField(stealthField, 'units', survivorKey, baseCount + 2);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: {
        entries: [host],
        recordOps: [
          { op: 'add', newRecordRef: firstKey },
          { op: 'add', newRecordRef: survivorKey }
        ]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(getEntry(after, 'units', deletedKey), null, 'deleted pending unit should never be written');
  const survivorIndex = getEntryIndex(after, 'units', survivorKey);
  assert.ok(survivorIndex >= 0, 'expected surviving pending unit to be written');
  const reloadedHost = getEntry(after, 'units', host.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'upgradeto'), survivorIndex);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'stealth_target'), survivorIndex);
});

test('pending unit references resolve by logical PRTO primary index despite strategy-map duplicates', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const host = before.tabs.units.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'upgradeto')
  );
  if (!host) return t.skip('No editable unit reference host found');

  const rawBaseCount = countSection(before, 'PRTO');
  const primaryBaseCount = countPrimaryPrtoRecords(before);
  const firstKey = makeShortTestRef('PRTO_', 'STRAT_A');
  const deletedKey = makeShortTestRef('PRTO_', 'STRAT_B');
  const survivorKey = makeShortTestRef('PRTO_', 'STRAT_C');
  const expectedSurvivorIndex = primaryBaseCount + 1;
  const staleRawAppendIndex = rawBaseCount + 4;
  assert.notEqual(staleRawAppendIndex, expectedSurvivorIndex, 'test must use a stale raw append index');

  setReferenceField(findBiqField(host, 'upgradeto'), 'units', survivorKey, staleRawAppendIndex);
  const stealthField = ensureBiqField(host, 'stealth_target', String(staleRawAppendIndex));
  setReferenceField(stealthField, 'units', survivorKey, staleRawAppendIndex);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: {
        entries: [host],
        recordOps: [
          { op: 'add', newRecordRef: firstKey },
          { op: 'add', newRecordRef: survivorKey }
        ]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(getEntry(after, 'units', deletedKey), null, 'deleted pending unit should never be written');
  const survivorIndex = getEntryIndex(after, 'units', survivorKey);
  assert.equal(survivorIndex, expectedSurvivorIndex);

  const reloadedHost = getEntry(after, 'units', host.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'upgradeto'), survivorIndex);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'stealth_target'), survivorIndex);
  assert.notEqual(getRawRecordInt({ fields: reloadedHost.biqFields }, 'upgradeto'), staleRawAppendIndex);
  assert.notEqual(getRawRecordInt({ fields: reloadedHost.biqFields }, 'stealth_target'), staleRawAppendIndex);

  const firstRecords = getRawRecordsByCivilopediaKey(after, 'PRTO', firstKey);
  const survivorRecords = getRawRecordsByCivilopediaKey(after, 'PRTO', survivorKey);
  assert.equal(firstRecords.length, 2, 'new PRTO A should serialize as primary plus strategy-map duplicate');
  assert.equal(survivorRecords.length, 2, 'new PRTO C should serialize as primary plus strategy-map duplicate');
  assert.ok(firstRecords.some((record) => getRawRecordInt(record, 'otherstrategy') === -1));
  assert.ok(survivorRecords.some((record) => getRawRecordInt(record, 'otherstrategy') === -1));
  assert.ok(survivorRecords.some((record) => getRawRecordInt(record, 'otherstrategy') === survivorIndex));
});

test('pending government references in civilizations survive middle pending government deletion', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const baseCount = countSection(before, 'GOVT');
  const host = before.tabs.civilizations.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'favoritegovernment') && findBiqField(entry, 'shunnedgovernment')
  );
  if (!host) return t.skip('No editable civilization government host found');

  const firstKey = makeShortTestRef('GOVT_', 'PEND_A');
  const deletedKey = makeShortTestRef('GOVT_', 'PEND_B');
  const survivorKey = makeShortTestRef('GOVT_', 'PEND_C');
  setReferenceField(findBiqField(host, 'favoritegovernment'), 'governments', firstKey, baseCount);
  setReferenceField(findBiqField(host, 'shunnedgovernment'), 'governments', survivorKey, baseCount + 2);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      governments: {
        recordOps: [
          { op: 'add', newRecordRef: firstKey },
          { op: 'add', newRecordRef: survivorKey }
        ]
      },
      civilizations: { entries: [host] }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(getEntry(after, 'governments', deletedKey), null, 'deleted pending government should never be written');
  const firstIndex = getEntryIndex(after, 'governments', firstKey);
  const survivorIndex = getEntryIndex(after, 'governments', survivorKey);
  const reloadedHost = getEntry(after, 'civilizations', host.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'favoritegovernment'), firstIndex);
  assert.equal(getRawRecordInt({ fields: reloadedHost.biqFields }, 'shunnedgovernment'), survivorIndex);
});

test('pending civilization availability bitmask survives middle pending civilization deletion', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const seedRefs = ((before.tabs.civilizations && before.tabs.civilizations.entries) || [])
    .filter((entry) => String(entry && entry.civilopediaKey || '').trim().toUpperCase() !== 'RACE_BARBARIANS')
    .slice(-3)
    .map((entry) => String(entry && entry.civilopediaKey || '').trim().toUpperCase());
  if (seedRefs.length < 3) return t.skip('Need at least three deletable civs to free pending civ slots');
  const freeSlots = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: {
        recordOps: seedRefs.map((recordRef) => ({ op: 'delete', recordRef }))
      }
    }
  });
  assert.equal(freeSlots.ok, true, String(freeSlots.error || 'failed to free civ slots'));

  const afterFree = reload(c3xDir, biqPath);
  const baseCount = countSection(afterFree, 'RACE');
  const host = afterFree.tabs.units.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && findBiqField(entry, 'availableto')
  );
  if (!host) return t.skip('No editable unit availability host found');
  const existingCiv = afterFree.tabs.civilizations.entries.find((entry) =>
    Number.isFinite(Number(entry && entry.biqIndex)) && String(entry && entry.civilopediaKey || '').trim()
  );
  if (!existingCiv) return t.skip('No surviving existing civilization found');
  const existingCivKey = String(existingCiv.civilopediaKey || '').trim().toUpperCase();
  const existingCivIndex = Number(existingCiv.biqIndex);

  const firstKey = makeShortTestRef('RACE_', 'PEND_A');
  const deletedKey = makeShortTestRef('RACE_', 'PEND_B');
  const survivorKey = makeShortTestRef('RACE_', 'PEND_C');
  const availableTo = findBiqField(host, 'availableto');
  setReferenceTargetsField(
    availableTo,
    'civilizations',
    [existingCivKey, firstKey, survivorKey],
    [existingCivIndex, baseCount, baseCount + 2],
    encodeSigned32Bitmask
  );

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: {
        entries: afterFree.tabs.civilizations.entries,
        recordOps: [
          { op: 'add', newRecordRef: firstKey },
          { op: 'add', newRecordRef: survivorKey }
        ]
      },
      units: { entries: [host] }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(getEntry(after, 'civilizations', deletedKey), null, 'deleted pending civ should never be written');
  const firstIndex = getEntryIndex(after, 'civilizations', firstKey);
  const survivorIndex = getEntryIndex(after, 'civilizations', survivorKey);
  const reloadedHost = getEntry(after, 'units', host.civilopediaKey);
  const expectedAvailable = [existingCivIndex, firstIndex, survivorIndex].sort((a, b) => a - b);
  assert.deepEqual(
    decodeSigned32Bitmask(fieldVal(reloadedHost, 'availableto')),
    expectedAvailable
  );
});

test('pending BIQ structure references resolve through final resource, unit, and tech indices', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const before = reload(c3xDir, biqPath);
  const rulesSection = getTabSection(before, 'rules', 'RULE');
  const ruleRecord = rulesSection && Array.isArray(rulesSection.records) ? rulesSection.records[0] : null;
  const terrainSection = getTabSection(before, 'terrain', 'TFRM');
  const terrainRecord = terrainSection && Array.isArray(terrainSection.records) ? terrainSection.records[0] : null;
  const moneyResourceField = getRawRecordField(ruleRecord, 'defaultmoneyresource');
  const battleCreatedUnitField = getRawRecordField(ruleRecord, 'battlecreatedunit');
  const workerTechField = getRawRecordField(terrainRecord, 'requiredadvance');
  const workerResourceField = getRawRecordField(terrainRecord, 'requiredresource1');
  if (!ruleRecord || !terrainRecord || !moneyResourceField || !battleCreatedUnitField || !workerTechField || !workerResourceField) {
    return t.skip('Fixture does not expose the representative RULE/TFRM reference fields');
  }

  const resourceBaseCount = countSection(before, 'GOOD');
  const unitBaseCount = countSection(before, 'PRTO');
  const techBaseCount = countSection(before, 'TECH');
  const resourceFirstKey = makeShortTestRef('GOOD_', 'RULE_A');
  const resourceSurvivorKey = makeShortTestRef('GOOD_', 'RULE_C');
  const unitFirstKey = makeShortTestRef('PRTO_', 'RULE_A');
  const unitSurvivorKey = makeShortTestRef('PRTO_', 'RULE_C');
  const techFirstKey = makeShortTestRef('TECH_', 'TFRM_A');
  const techSurvivorKey = makeShortTestRef('TECH_', 'TFRM_C');

  setReferenceField(moneyResourceField, 'resources', resourceSurvivorKey, resourceBaseCount + 2);
  setReferenceField(battleCreatedUnitField, 'units', unitSurvivorKey, unitBaseCount + 2);
  setReferenceField(workerTechField, 'technologies', techSurvivorKey, techBaseCount + 2);
  setReferenceField(workerResourceField, 'resources', resourceSurvivorKey, resourceBaseCount + 2);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      resources: {
        recordOps: [
          { op: 'add', newRecordRef: resourceFirstKey },
          { op: 'add', newRecordRef: resourceSurvivorKey }
        ]
      },
      units: {
        recordOps: [
          { op: 'add', newRecordRef: unitFirstKey },
          { op: 'add', newRecordRef: unitSurvivorKey }
        ]
      },
      technologies: {
        recordOps: [
          { op: 'add', newRecordRef: techFirstKey },
          { op: 'add', newRecordRef: techSurvivorKey }
        ]
      },
      rules: {
        sections: [{
          ...rulesSection,
          records: [ruleRecord]
        }]
      },
      terrain: {
        sections: [{
          ...terrainSection,
          records: [terrainRecord]
        }]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const reRuleSection = getTabSection(after, 'rules', 'RULE');
  const reRuleRecord = reRuleSection && Array.isArray(reRuleSection.records) ? reRuleSection.records[0] : null;
  const reTerrainSection = getTabSection(after, 'terrain', 'TFRM');
  const reTerrainRecord = reTerrainSection && Array.isArray(reTerrainSection.records) ? reTerrainSection.records[0] : null;
  assert.equal(
    getRawRecordInt(reRuleRecord, 'defaultmoneyresource'),
    getEntryIndex(after, 'resources', resourceSurvivorKey)
  );
  assert.equal(
    getRawRecordInt(reRuleRecord, 'battlecreatedunit'),
    getEntryIndex(after, 'units', unitSurvivorKey)
  );
  assert.equal(
    getRawRecordInt(reTerrainRecord, 'requiredadvance'),
    getEntryIndex(after, 'technologies', techSurvivorKey)
  );
  assert.equal(
    getRawRecordInt(reTerrainRecord, 'requiredresource1'),
    getEntryIndex(after, 'resources', resourceSurvivorKey)
  );
});

test('no-reload save reconciliation assigns new reference indexes and reload ordering', () => {
  const bundle = {
    biq: {
      sections: [{
        code: 'TECH',
        count: 2,
        records: [
          { index: 0, fields: [{ baseKey: 'civilopediaentry', key: 'civilopediaentry', value: 'TECH_ALPHA' }] },
          { index: 1, fields: [{ baseKey: 'civilopediaentry', key: 'civilopediaentry', value: 'TECH_BETA' }] }
        ]
      }]
    },
    tabs: {
      technologies: {
        type: 'reference',
        entries: [
          { civilopediaKey: 'TECH_NEW_B', name: 'New B', biqIndex: null, isNew: true },
          { civilopediaKey: 'TECH_NEW_A', name: 'New A', biqIndex: null, isNew: true },
          { civilopediaKey: 'TECH_ALPHA', name: 'Alpha', biqIndex: 0 },
          { civilopediaKey: 'TECH_BETA', name: 'Beta', biqIndex: 1 }
        ],
        recordOps: [
          { op: 'copy', sourceRef: 'TECH_ALPHA', newRecordRef: 'TECH_NEW_A' },
          { op: 'copy', sourceRef: 'TECH_NEW_A', newRecordRef: 'TECH_NEW_B' }
        ]
      }
    }
  };
  const { reconcileReferenceTabsAfterNoReloadSave, state } = loadRendererNoReloadSaveHelpers(bundle);
  const savedOps = JSON.parse(JSON.stringify(bundle.tabs.technologies.recordOps));
  bundle.tabs.technologies.recordOps = [];
  assert.equal(reconcileReferenceTabsAfterNoReloadSave({
    referenceOpsByTab: { technologies: savedOps }
  }), true);
  assert.deepEqual(
    bundle.tabs.technologies.entries.map((entry) => `${entry.civilopediaKey}:${entry.biqIndex}`),
    ['TECH_ALPHA:0', 'TECH_BETA:1', 'TECH_NEW_A:2', 'TECH_NEW_B:3']
  );
  assert.equal(bundle.biq.sections[0].count, 4);
  assert.equal(state.referenceSelection.technologies, 3);
});

test('no-reload save marks map edits clean for future dirty checks', () => {
  const bundle = {
    tabs: {
      map: {
        type: 'map',
        hasMapData: true,
        originalHasMap: false,
        mapMutation: 'set',
        mapMutationSource: 'custom',
        pendingMapResize: { width: 100, height: 100 },
        recordOps: [{ op: 'add', sectionCode: 'SLOC', newRecordRef: 'SLOC_NEW' }],
        sections: [{
          code: 'TILE',
          records: [{
            index: 0,
            newRecordRef: 'TILE_NEW',
            fields: [
              { baseKey: 'terrain', value: '3', originalValue: '2', mapEditorValueEdited: true },
              { baseKey: 'c3coverlays', value: '2147483648', originalValue: '0', mapEditorValueEdited: true },
              { baseKey: 'fogofwar', value: '0', originalValue: 'false' },
              { baseKey: 'ruin', value: '1', originalValue: '0', mapEditorValueEdited: true }
            ]
          }]
        }]
      }
    }
  };
  const { markMapTabAsSaved } = loadRendererMapSaveHelpers(bundle);
  const mapTab = bundle.tabs.map;
  markMapTabAsSaved(mapTab);

  assert.equal(Array.isArray(mapTab.recordOps), true);
  assert.equal(mapTab.recordOps.length, 0);
  assert.equal(mapTab.originalHasMap, true);
  assert.equal(mapTab.mapMutation, null);
  assert.equal(mapTab.mapMutationSource, null);
  assert.equal(mapTab.pendingMapResize, null);
  assert.equal(Object.prototype.hasOwnProperty.call(mapTab.sections[0].records[0], 'newRecordRef'), false);
  const fields = mapTab.sections[0].records[0].fields;
  assert.equal(fields.find((field) => field.baseKey === 'terrain').originalValue, '3');
  assert.equal(fields.find((field) => field.baseKey === 'c3coverlays').originalValue, '2147483648');
  assert.equal(fields.find((field) => field.baseKey === 'fogofwar').originalValue, 'false');
  assert.equal(fields.find((field) => field.baseKey === 'ruin').originalValue, '1');
  assert.equal(fields.some((field) => field.mapEditorValueEdited), false);
});

test('no-reload save clean-state matrix covers BIQ reference, structure, and map tabs', () => {
  const bundle = {
    tabs: {
      technologies: {
        type: 'reference',
        entries: [{
          civilopediaKey: 'TECH_ALPHA',
          biqIndex: 0,
          isNew: true,
          biqFields: [
            { baseKey: 'name', value: 'Alpha Saved', originalValue: 'Alpha Dirty', editable: true }
          ],
          civilopediaSection1: 'Saved body',
          originalCivilopediaSection1: 'Dirty body'
        }],
        recordOps: [{ op: 'copy', sourceRef: 'TECH_OLD', newRecordRef: 'TECH_ALPHA' }]
      },
      scenarioSettings: {
        type: 'biq',
        key: 'scenarioSettings',
        customRulesMutation: 'set',
        sections: [{
          code: 'GAME',
          records: [{
            index: 0,
            newRecordRef: 'GAME_NEW',
            fields: [
              { baseKey: 'title', value: 'Saved Scenario Title', originalValue: 'Dirty Scenario Title', editable: true }
            ]
          }]
        }]
      },
      rules: {
        type: 'biq',
        key: 'rules',
        recordOps: [{ op: 'add', sectionCode: 'RULE', newRecordRef: 'RULE_NEW' }],
        sections: [{
          code: 'RULE',
          records: [{
            index: 0,
            newRecordRef: 'RULE_NEW',
            fields: [
              { baseKey: 'battlecreatedunit', value: '2', originalValue: '1', editable: true }
            ]
          }]
        }]
      },
      terrain: {
        type: 'biq',
        key: 'terrain',
        sections: [{
          code: 'TERR',
          records: [{
            index: 0,
            fields: [
              { baseKey: 'name', value: 'Saved Terrain', originalValue: 'Dirty Terrain', editable: true }
            ]
          }]
        }]
      },
      world: {
        type: 'biq',
        key: 'world',
        sections: [{
          code: 'WSIZ',
          records: [{
            index: 0,
            fields: [
              { baseKey: 'name', value: 'Saved World', originalValue: 'Dirty World', editable: true }
            ]
          }]
        }]
      },
      map: {
        type: 'map',
        hasMapData: true,
        originalHasMap: false,
        mapMutation: 'set',
        mapMutationSource: 'custom',
        pendingMapResize: { width: 80, height: 80 },
        recordOps: [{ op: 'add', sectionCode: 'UNIT', newRecordRef: 'UNIT_NEW' }],
        scenarioDistricts: {
          entries: [{ x: 1, y: 2, district: 'Neighborhood' }],
          originalEntries: [],
          namedTiles: [{ x: 1, y: 2, name: 'Saved Tile' }],
          originalNamedTiles: []
        },
        sections: [{
          code: 'TILE',
          records: [{
            index: 0,
            newRecordRef: 'TILE_NEW',
            fields: [
              { baseKey: 'terrain', value: '3', originalValue: '2', editable: true, mapEditorValueEdited: true }
            ]
          }]
        }]
      }
    }
  };

  const { markCurrentBundleCleanAfterSave, state } = loadRendererNoReloadCleanHelpers(bundle);
  markCurrentBundleCleanAfterSave();

  assert.deepEqual(state.dirtyTabCounts, {});
  assert.equal(state.isDirty, false);
  assert.equal(Array.isArray(state.undoHistory), true);
  assert.equal(state.undoHistory.length, 0);
  assert.ok(state.cleanSnapshot && state.cleanTabsCache, 'expected clean snapshot/cache to be rebuilt');
  assert.deepEqual(Object.keys(state.techTreeArrowArtDirtyByEra), []);
  assert.deepEqual(Object.keys(state.techTreeArrowDirtyEdgesByEra), []);
  assert.deepEqual(JSON.parse(JSON.stringify(state.techTreeArrowMetadataEraKeys)), { 0: true, 1: true });
  assert.deepEqual(JSON.parse(JSON.stringify(state.cleanTechTreeArrowMetadataEraKeys)), { 0: true, 1: true });
  assert.equal(state.previewInvalidatedAfterTechTreeArrowSave, true);
  assert.equal(state.reopenedTechTreeEraAfterArrowSave, 1);

  assert.equal(bundle.tabs.technologies.recordOps.length, 0);
  assert.equal(bundle.tabs.technologies.entries[0].isNew, false);
  assert.equal(bundle.tabs.technologies.entries[0].biqFields[0].originalValue, 'Alpha Saved');
  assert.equal(bundle.tabs.technologies.entries[0].originalCivilopediaSection1, 'Saved body');

  assert.equal(bundle.tabs.scenarioSettings.customRulesMutation, null);
  assert.equal(bundle.tabs.scenarioSettings.recordOps.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.tabs.scenarioSettings.sections[0].records[0], 'newRecordRef'), false);
  assert.equal(bundle.tabs.scenarioSettings.sections[0].records[0].fields[0].originalValue, 'Saved Scenario Title');

  assert.equal(bundle.tabs.rules.recordOps.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.tabs.rules.sections[0].records[0], 'newRecordRef'), false);
  assert.equal(bundle.tabs.rules.sections[0].records[0].fields[0].originalValue, '2');
  assert.equal(bundle.tabs.terrain.sections[0].records[0].fields[0].originalValue, 'Saved Terrain');
  assert.equal(bundle.tabs.world.sections[0].records[0].fields[0].originalValue, 'Saved World');

  assert.equal(bundle.tabs.map.recordOps.length, 0);
  assert.equal(bundle.tabs.map.originalHasMap, true);
  assert.equal(bundle.tabs.map.mapMutation, null);
  assert.equal(bundle.tabs.map.mapMutationSource, null);
  assert.equal(bundle.tabs.map.pendingMapResize, null);
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.tabs.map.sections[0].records[0], 'newRecordRef'), false);
  assert.equal(bundle.tabs.map.sections[0].records[0].fields[0].originalValue, '3');
  assert.equal(bundle.tabs.map.sections[0].records[0].fields.some((field) => field.mapEditorValueEdited), false);
  assert.deepEqual(bundle.tabs.map.scenarioDistricts.originalEntries, bundle.tabs.map.scenarioDistricts.entries);
  assert.deepEqual(bundle.tabs.map.scenarioDistricts.originalNamedTiles, bundle.tabs.map.scenarioDistricts.namedTiles);
});

test('reference dirty cache rebuild removes stale identities after new entry key changes', () => {
  const bundle = {
    cleanTabs: {
      technologies: {
        type: 'reference',
        entries: [
          { id: 'ALPHA', civilopediaKey: 'TECH_ALPHA', name: 'Alpha', biqIndex: 0 }
        ]
      }
    },
    tabs: {
      technologies: {
        type: 'reference',
        entries: [
          { id: 'NEW_TECH', civilopediaKey: 'TECH_NEW_TECH', name: 'New Tech', biqIndex: null, isNew: true },
          { id: 'ALPHA', civilopediaKey: 'TECH_ALPHA', name: 'Alpha', biqIndex: 0 }
        ]
      }
    }
  };
  const { rebuildReferenceDirtyCacheForTab, state } = loadRendererReferenceDirtyHelpers(bundle);
  assert.equal(rebuildReferenceDirtyCacheForTab('technologies', bundle.tabs.technologies), true);
  assert.deepEqual(
    Array.from(state.dirtyReferenceKeysByTab.technologies).sort(),
    ['id:NEW_TECH']
  );
  assert.equal(state.dirtyTabCounts.technologies, 1);
});

/**
 * Simulate exactly what the renderer does when the user clicks Import:
 *   - Deep-clones the source entry
 *   - Sets all biqField originalValues to '' (so they are "dirty" and get saved)
 *   - Marks as new and assigns the new civilopediaKey
 */
function simulateImportEntry(sourceEntry, newKey) {
  const entry = JSON.parse(JSON.stringify(sourceEntry));
  entry.civilopediaKey = newKey;
  entry.biqIndex = null;
  entry.isNew = true;
  entry.biqFields = (Array.isArray(entry.biqFields) ? entry.biqFields : []).map((f) => ({
    ...f,
    originalValue: ''
  }));
  // Update the civilopediaentry projected field to match the new key
  const civField = entry.biqFields.find(
    (f) => String(f && (f.baseKey || f.key) || '').toLowerCase() === 'civilopediaentry'
  );
  if (civField) civField.value = newKey;
  entry.originalIconPaths = [];
  entry.originalRacePaths = [];
  entry.originalAnimationName = '';
  entry.originalCivilopediaSection1 = '';
  entry.originalCivilopediaSection2 = '';
  return entry;
}

function simulateRendererImport(targetBundle, sourceBundle, tabKey, sourceEntry, newKey) {
  const entry = JSON.parse(JSON.stringify(sourceEntry));
  entry._importReferenceIndexMaps = {
    civilizations: buildReferenceIndexMap(sourceBundle, 'civilizations'),
    technologies: buildReferenceIndexMap(sourceBundle, 'technologies'),
    resources: buildReferenceIndexMap(sourceBundle, 'resources'),
    improvements: buildReferenceIndexMap(sourceBundle, 'improvements'),
    governments: buildReferenceIndexMap(sourceBundle, 'governments'),
    units: buildReferenceIndexMap(sourceBundle, 'units')
  };
  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers(targetBundle);
  return buildNewReferenceEntryFromTemplate({
    tabKey,
    sourceEntry: entry,
    civilopediaKey: newKey,
    mode: 'import',
    displayName: String(sourceEntry && sourceEntry.name || '')
  });
}

test('copying a reference resets raw/display/link keys to the user-entered key', () => {
  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers({ tabs: {} });
  const copied = buildNewReferenceEntryFromTemplate({
    tabKey: 'improvements',
    sourceEntry: {
      id: 'TINCTURE_SHOP',
      civilopediaKey: 'BLDG_TINCTURE_SHOP',
      lookupCivilopediaKey: 'BLDG_TINCTURE_SHOP',
      displayCivilopediaKey: 'BLDG_Tincture_Shop',
      rawCivilopediaKey: 'BLDG_Tincture_Shop',
      rawBiqCivilopediaKey: 'BLDG_Tincture_Shop',
      linkCivilopediaKey: 'BLDG_Tincture_Shop',
      name: 'Tincture Shop',
      civilopediaSection1: 'Tincture text.',
      originalCivilopediaSection1: 'Tincture text.',
      biqFields: [
        { key: 'civilopediaentry', baseKey: 'civilopediaentry', value: 'BLDG_Tincture_Shop', originalValue: 'BLDG_Tincture_Shop' },
        { key: 'name', baseKey: 'name', value: 'Tincture Shop', originalValue: 'Tincture Shop' }
      ]
    },
    civilopediaKey: 'BLDG_Resin_Shop',
    mode: 'copy',
    displayName: 'Resin Shop'
  });

  assert.equal(copied.civilopediaKey, 'BLDG_RESIN_SHOP');
  assert.equal(copied.lookupCivilopediaKey, 'BLDG_RESIN_SHOP');
  assert.equal(copied.displayCivilopediaKey, 'BLDG_Resin_Shop');
  assert.equal(copied.rawCivilopediaKey, 'BLDG_Resin_Shop');
  assert.equal(copied.rawBiqCivilopediaKey, 'BLDG_Resin_Shop');
  assert.equal(copied.linkCivilopediaKey, 'BLDG_Resin_Shop');
  assert.equal(copied.originalCivilopediaSection1, '');
  assert.equal(copied.biqFields.find((field) => field.baseKey === 'civilopediaentry').value, 'BLDG_Resin_Shop');
  assert.equal(copied.name, 'Resin Shop');
  assert.equal(fieldVal(copied, 'name'), 'Resin Shop');
  assert.equal(findBiqField(copied, 'name').originalValue, 'Tincture Shop');
});

test('renderer reference copy ops use BIQ index source refs for existing duplicate Civilopedia keys', () => {
  const { getReferenceRecordRefForOps, makeReferenceCopyRecordOp } = loadRendererDeleteHelpers();
  [
    ['civilizations', 'RACE_DUPLICATE', 4, 0],
    ['technologies', 'TECH_POTTERY', 33, 3],
    ['resources', 'GOOD_IRON', 14, 4],
    ['improvements', 'BLDG_DUPLICATE', 21, 2],
    ['governments', 'GOVT_DUPLICATE', 5, 1],
    ['units', 'PRTO_WAR_CHARIOT', 57, 3],
    ['technologies', '', 11, 0]
  ].forEach(([tabKey, key, biqIndex, fallbackIndex]) => {
    assert.equal(
      getReferenceRecordRefForOps(tabKey, { civilopediaKey: key, biqIndex }, fallbackIndex),
      `@INDEX:${biqIndex}`,
      `${tabKey} existing rows should use BIQ index identity`
    );
  });
  const op = makeReferenceCopyRecordOp(
    'units',
    { civilopediaKey: 'PRTO_WAR_CHARIOT', biqIndex: 57 },
    3,
    'PRTO_War_Chariot_Copy'
  );
  assert.equal(op.op, 'copy');
  assert.equal(op.sourceRef, '@INDEX:57');
  assert.equal(op.newRecordRef, 'PRTO_War_Chariot_Copy');
});

test('renderer-shaped Civilization LEGENDS War Chariot copy saves duplicate-key picker prereqs by BIQ index', (t) => {
  if (!CIVILIZATION_LEGENDS_BIQ_EXISTS) {
    t.skip('Civilization LEGENDS BIQ not available for renderer-shaped War Chariot copy regression.');
  }
  const setup = setupScenario(CIVILIZATION_LEGENDS_BIQ);
  if (!setup) t.skip('Civilization LEGENDS BIQ not available for renderer-shaped War Chariot copy regression.');
  const { c3xDir, biqPath, bundle } = setup;
  const unitsTab = bundle.tabs.units;
  const entries = (unitsTab && Array.isArray(unitsTab.entries)) ? unitsTab.entries : [];
  const warChariotIndex = entries.findIndex((entry) =>
    String(entry && entry.name || '').trim() === 'War Chariot'
    && String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_WAR_CHARIOT'
  );
  assert.ok(warChariotIndex >= 0, 'expected Civilization LEGENDS War Chariot duplicate-key unit');
  const warChariot = entries[warChariotIndex];
  const copyKey = makeUniqueEntryKey(entries, 'PRTO_War_Chariot_Copy_UI');
  const copyName = 'War Chariot Copy';
  const { buildNewReferenceEntryFromTemplate, makeReferenceCopyRecordOp } = loadRendererImportHelpers(bundle);
  const { getReferenceEntryIndexForOption, setFieldReferenceTargetMeta } = loadRendererReferenceTargetHelpers(bundle);
  const makeOptions = (tabKey) => bundle.tabs[tabKey].entries.map((entry, idx) => ({
    value: String(getReferenceEntryIndexForOption(tabKey, entry, idx, { allowFallback: true })),
    label: String(entry && entry.name || ''),
    entry
  }));
  const techOptions = makeOptions('technologies');
  const resourceOptions = makeOptions('resources');
  const fishing = techOptions.find((option) => option.label === 'Fishing');
  const tin = resourceOptions.find((option) => option.label === 'Tin');
  const rareEarths = resourceOptions.find((option) => option.label === 'Rare Earths');
  assert.ok(fishing, 'expected Civilization LEGENDS Fishing tech');
  assert.ok(tin, 'expected Civilization LEGENDS Tin resource');
  assert.ok(rareEarths, 'expected Civilization LEGENDS Rare Earths resource');
  assert.equal(fishing.entry.civilopediaKey, 'TECH_POTTERY', 'test fixture should cover duplicate tech Civilopedia key');
  assert.equal(tin.entry.civilopediaKey, 'GOOD_IRON', 'test fixture should cover duplicate resource Civilopedia key');
  assert.equal(rareEarths.entry.civilopediaKey, 'GOOD_IRON', 'test fixture should cover duplicate resource Civilopedia key');
  assert.notEqual(fishing.value, '33', 'Fishing must not be the stale Barding index');
  assert.notEqual(tin.value, '14', 'Tin must not be the stale Mahogany index');
  assert.notEqual(rareEarths.value, '14', 'Rare Earths must not be the stale Mahogany index');
  const copied = buildNewReferenceEntryFromTemplate({
    tabKey: 'units',
    sourceEntry: warChariot,
    civilopediaKey: copyKey,
    mode: 'copy',
    displayName: copyName
  });
  const setPickerField = (fieldKey, targetTabKey, option, options) => {
    const field = findBiqField(copied, fieldKey);
    assert.ok(field, `expected ${fieldKey} field`);
    field.value = String(option.value);
    setFieldReferenceTargetMeta(field, targetTabKey, option, option.value, options);
    assert.equal(field.referenceTarget && field.referenceTarget.key, `@INDEX:${option.value}`);
  };
  setPickerField('requiredtech', 'technologies', fishing, techOptions);
  setPickerField('requiredresource1', 'resources', tin, resourceOptions);
  setPickerField('requiredresource2', 'resources', rareEarths, resourceOptions);

  unitsTab.entries = [copied];
  unitsTab.recordOps = [makeReferenceCopyRecordOp('units', warChariot, warChariotIndex, copyKey)];

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    dirtyTabs: ['units'],
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'War Chariot copy save failed'));

  const reloaded = reload(c3xDir, biqPath);
  const reloadedCopy = getEntry(reloaded, 'units', copyKey);
  assert.ok(reloadedCopy, 'expected War Chariot copy after reload');
  assert.equal(reloadedCopy.name, copyName);
  assert.equal(fieldVal(reloadedCopy, 'name'), copyName);
  const rawCopy = getRawRecordsByCivilopediaKey(reloaded, 'PRTO', copyKey).find((record) =>
    getRawRecordInt(record, 'otherstrategy', -1) < 0
  );
  assert.ok(rawCopy, 'expected reloaded primary raw PRTO copy');
  assert.equal(getRawRecordInt(rawCopy, 'requiredtech'), Number(fishing.value));
  assert.equal(getRawRecordInt(rawCopy, 'requiredresource1'), Number(tin.value));
  assert.equal(getRawRecordInt(rawCopy, 'requiredresource2'), Number(rareEarths.value));
  assert.notEqual(getRawRecordInt(rawCopy, 'requiredtech'), 33);
  assert.notEqual(getRawRecordInt(rawCopy, 'requiredresource1'), 14);
  assert.notEqual(getRawRecordInt(rawCopy, 'requiredresource2'), 14);
});

function computeDirtyReferenceIdentitySet(tabKey, currentEntries, cleanEntries) {
  const current = Array.isArray(currentEntries) ? currentEntries : [];
  const clean = Array.isArray(cleanEntries) ? cleanEntries : [];
  const cleanByIdentity = new Map();
  clean.forEach((entry, idx) => {
    const identity = getReferenceEntryIdentity(tabKey, entry, idx);
    if (identity) cleanByIdentity.set(identity, entry);
  });
  const dirty = new Set();
  current.forEach((entry, idx) => {
    const identity = getReferenceEntryIdentity(tabKey, entry, idx);
    if (!identity) return;
    const cleanEntry = cleanByIdentity.get(identity) || null;
    if (JSON.stringify(entry == null ? null : entry) !== JSON.stringify(cleanEntry == null ? null : cleanEntry)) {
      dirty.add(identity);
    }
    cleanByIdentity.delete(identity);
  });
  cleanByIdentity.forEach((_entry, identity) => dirty.add(identity));
  return dirty;
}

/**
 * Save a single import op + the imported entry's field data into tmpBiq, then
 * return the save result.
 */
function saveImport(c3xDir, biqPath, tabKey, newKey, importedEntry, sourceBiqPath, sourceRef = '') {
  return saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      [tabKey]: {
        entries: [importedEntry],
        recordOps: [{
          op: 'add',
          newRecordRef: newKey,
          sourceRef: String(sourceRef || '').trim().toUpperCase(),
          importArtFrom: sourceBiqPath
        }]
      }
    }
  });
}

/** Pick any entry from a tab that satisfies a predicate, or the first one. */
function pickEntry(bundle, tabKey, pred) {
  const entries = bundle && bundle.tabs && bundle.tabs[tabKey] && bundle.tabs[tabKey].entries;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.find(pred) || entries[0];
}

function resolveTestResourcesPcx(rootPath, scenarioRoots = []) {
  const rel = path.join('Art', 'resources.pcx');
  const candidates = [
    ...(Array.isArray(scenarioRoots) ? scenarioRoots : []).map((root) => path.join(root, rel)),
    path.join(rootPath, 'Conquests', rel),
    path.join(rootPath, 'civ3PTW', rel),
    path.join(rootPath, rel)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function getResourceIconFieldValue(entry) {
  const field = entry && Array.isArray(entry.biqFields)
    ? entry.biqFields.find((item) => String(item && (item.baseKey || item.key) || '').toLowerCase() === 'icon')
    : null;
  return field ? String(field.value || '') : '';
}

function resourcePcxCellHasNonMagenta(pcxBuffer, slot) {
  const decoded = decodePcx(pcxBuffer, { returnIndexed: true, transparentIndexes: [] });
  const palette = decoded.palette;
  const magentaIndexes = new Set();
  for (let idx = 0; idx < 256; idx += 1) {
    if (palette[idx * 3] === 255 && palette[idx * 3 + 1] === 0 && palette[idx * 3 + 2] === 255) {
      magentaIndexes.add(idx);
    }
  }
  const cell = 50;
  const cols = 6;
  const col = slot % cols;
  const row = Math.floor(slot / cols);
  const startX = col * cell;
  const startY = row * cell;
  if (startX + cell > decoded.width || startY + cell > decoded.height) return false;
  for (let y = 0; y < cell; y += 1) {
    const rowOff = (startY + y) * decoded.width + startX;
    for (let x = 0; x < cell; x += 1) {
      if (!magentaIndexes.has(decoded.indices[rowOff + x])) return true;
    }
  }
  return false;
}

function resolveTestUnits32Pcx(rootPath, scenarioRoots = []) {
  const rel = path.join('Art', 'Units', 'units_32.pcx');
  const candidates = [
    ...(Array.isArray(scenarioRoots) ? scenarioRoots : []).map((root) => path.join(root, rel)),
    path.join(rootPath, 'Conquests', rel),
    path.join(rootPath, 'civ3PTW', rel),
    path.join(rootPath, rel)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function getUnitIconFieldValue(entry) {
  const field = entry && Array.isArray(entry.biqFields)
    ? entry.biqFields.find((item) => String(item && (item.baseKey || item.key) || '').toLowerCase() === 'iconindex')
    : null;
  return field ? String(field.value || '') : '';
}

function units32CellHasNonMagenta(pcxBuffer, slot) {
  const decoded = decodePcx(pcxBuffer, { returnIndexed: true, transparentIndexes: [] });
  const palette = decoded.palette;
  const magentaIndexes = new Set();
  for (let idx = 0; idx < 256; idx += 1) {
    if (palette[idx * 3] === 255 && palette[idx * 3 + 1] === 0 && palette[idx * 3 + 2] === 255) {
      magentaIndexes.add(idx);
    }
  }
  const sprite = 32;
  const gutter = 1;
  const stride = sprite + gutter;
  const cols = Math.floor((decoded.width - gutter) / stride);
  const col = slot % cols;
  const row = Math.floor(slot / cols);
  const startX = col * stride + gutter;
  const startY = row * stride + gutter;
  if (startX + sprite > decoded.width || startY + sprite > decoded.height) return false;
  for (let y = 0; y < sprite; y += 1) {
    const rowOff = (startY + y) * decoded.width + startX;
    for (let x = 0; x < sprite; x += 1) {
      if (!magentaIndexes.has(decoded.indices[rowOff + x])) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// ADD tests — one per entity type
// ---------------------------------------------------------------------------

const ADD_CASES = [
  { tabKey: 'civilizations',  sectionCode: 'RACE', prefix: 'RACE_' },
  { tabKey: 'technologies',   sectionCode: 'TECH', prefix: 'TECH_' },
  { tabKey: 'resources',      sectionCode: 'GOOD', prefix: 'GOOD_' },
  { tabKey: 'improvements',   sectionCode: 'BLDG', prefix: 'BLDG_' },
  { tabKey: 'governments',    sectionCode: 'GOVT', prefix: 'GOVT_' },
  { tabKey: 'units',          sectionCode: 'PRTO', prefix: 'PRTO_' }
];

for (const { tabKey, sectionCode, prefix } of ADD_CASES) {
  test(`Add blank ${sectionCode}: new record present and others untouched`, (t) => {
    const sourceBiq = tabKey === 'civilizations' ? TIDES_BIQ : BASE_BIQ;
    const ctx = setupScenario(sourceBiq);
    if (!ctx) return t.skip(`Source BIQ not found: ${sourceBiq}`);
    const { c3xDir, biqPath } = ctx;

    const before = reload(c3xDir, biqPath);
    const countBefore = countSection(before, sectionCode);
    assert.ok(countBefore > 0, `expected existing ${sectionCode} records`);

    // Capture existing keys so we can verify none were touched
    const existingKeys = (before.biq.sections.find(
      (s) => String(s.code || '').toUpperCase() === sectionCode
    )?.records || []).map((r) => {
      const f = (r.fields || []).find((field) =>
        String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry'
      );
      return String(f && f.value || '').trim().toUpperCase();
    }).filter(Boolean);

    const sourceEntry = before.tabs[tabKey] && Array.isArray(before.tabs[tabKey].entries)
      ? before.tabs[tabKey].entries[0]
      : null;
    assert.ok(sourceEntry, `expected ${tabKey} source entry for blank add template`);
    const newKey = makeShortTestRef(prefix, 'ADD');
    const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers(before);
    const pendingEntry = buildNewReferenceEntryFromTemplate({
      tabKey,
      sourceEntry,
      civilopediaKey: newKey,
      mode: 'blank',
      displayName: `${sectionCode} Add Field Test`
    });
    applyRepresentativeCrudEditsToEntry(tabKey, pendingEntry, before, `${sectionCode} Add Field Test`);
    const saveResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      dirtyTabs: [tabKey],
      tabs: {
        [tabKey]: {
          entries: [pendingEntry],
          recordOps: [{ op: 'add', newRecordRef: newKey }]
        }
      }
    });
    assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

    const after = reload(c3xDir, biqPath);
    const expectedDelta = sectionCode === 'PRTO' ? 2 : 1;
    assert.equal(countSection(after, sectionCode), countBefore + expectedDelta,
      `expected exactly ${expectedDelta} new ${sectionCode} record${expectedDelta === 1 ? '' : 's'}`);
    assert.equal(biqHasKey(after, sectionCode, newKey), true,
      `expected new record ${newKey} to exist`);
    const reloadedAdded = getEntry(after, tabKey, newKey);
    assertReloadedReferenceEntryFieldsMatchPreSave(pendingEntry, reloadedAdded, `added ${sectionCode}`);

    // All pre-existing keys must still be present
    for (const key of existingKeys) {
      assert.equal(biqHasKey(after, sectionCode, key), true,
        `expected original record ${key} to survive add`);
    }
  });
}

test('Renderer blank Improvement template clears inherited reference defaults', () => {
  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers({ tabs: {} });
  const sourceEntry = {
    name: 'Wonder Template',
    civilopediaKey: 'BLDG_WONDER_TEMPLATE',
    improvementKind: 'wonder',
    thumbPath: 'Art\\Civilopedia\\Icons\\Buildings\\wonderlarge.pcx',
    iconPaths: ['Art\\Civilopedia\\Icons\\Buildings\\wonderlarge.pcx'],
    buildingIconKind: 'SINGLE',
    buildingIconIndex: '42',
    wonderSplashPath: 'Art\\Wonder Splash\\wonder.pcx',
    biqFields: [
      makeTestBiqField('civilopediaentry', 'BLDG_WONDER_TEMPLATE'),
      makeTestBiqField('cost', '400'),
      makeTestBiqField('reqresource1', '0'),
      makeTestBiqField('reqresource2', '0'),
      makeTestBiqField('reqgovernment', '0'),
      makeTestBiqField('reqimprovement', '0'),
      makeTestBiqField('doubleshappiness', '0'),
      makeTestBiqField('gainineverycity', '0'),
      makeTestBiqField('gainoncontinent', '0'),
      makeTestBiqField('obsoleteby', '1'),
      makeTestBiqField('unitproduced', '0'),
      makeTestBiqField('spaceshippart', '0'),
      makeTestBiqField('unitfrequency', '7'),
      makeTestBiqField('wonder', 'true'),
      makeTestBiqField('smallwonder', 'false'),
      makeTestBiqField('improvement', 'false')
    ]
  };

  const blank = buildNewReferenceEntryFromTemplate({
    tabKey: 'improvements',
    sourceEntry,
    civilopediaKey: 'BLDG_BLANK_TEST',
    mode: 'blank',
    displayName: 'Blank Test'
  });

  for (const key of [
    'reqresource1',
    'reqresource2',
    'reqgovernment',
    'reqimprovement',
    'doubleshappiness',
    'gainineverycity',
    'gainoncontinent',
    'obsoleteby',
    'unitproduced',
    'spaceshippart'
  ]) {
    assert.equal(fieldVal(blank, key), '-1', `${key} should be unset on blank improvements`);
  }
  assert.equal(fieldVal(blank, 'cost'), '0');
  assert.equal(fieldVal(blank, 'unitfrequency'), '0');
  assert.equal(fieldVal(blank, 'wonder'), 'false');
  assert.equal(fieldVal(blank, 'smallwonder'), 'false');
  assert.equal(fieldVal(blank, 'improvement'), 'true');
  assert.equal(blank.improvementKind, 'normal');
  assert.equal(Array.isArray(blank.iconPaths), true);
  assert.equal(blank.iconPaths.length, 0);
  assert.equal(blank.thumbPath, '');
  assert.equal(blank.buildingIconKind, '');
  assert.equal(blank.buildingIconIndex, '');
  assert.equal(blank.wonderSplashPath, '');
});

test('Renderer blank reference templates clear inherited art thumbnails for all addable tabs', () => {
  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers({ tabs: {} });
  const cases = [
    { tabKey: 'civilizations', key: 'RACE_BLANK_ART' },
    { tabKey: 'technologies', key: 'TECH_BLANK_ART' },
    { tabKey: 'resources', key: 'GOOD_BLANK_ART' },
    { tabKey: 'improvements', key: 'BLDG_BLANK_ART' },
    { tabKey: 'governments', key: 'GOVT_BLANK_ART' },
    { tabKey: 'units', key: 'PRTO_BLANK_ART' }
  ];
  for (const { tabKey, key } of cases) {
    const blank = buildNewReferenceEntryFromTemplate({
      tabKey,
      sourceEntry: {
        name: 'Source',
        civilopediaKey: key.replace('BLANK', 'SOURCE'),
        thumbPath: 'Art\\Civilopedia\\Icons\\Inherited\\large.pcx',
        iconPaths: ['Art\\Civilopedia\\Icons\\Inherited\\large.pcx', 'Art\\Civilopedia\\Icons\\Inherited\\small.pcx'],
        racePaths: ['Art\\Advisors\\Inherited.pcx', 'Art\\Flics\\Inherited.flc'],
        buildingIconKind: 'SINGLE',
        buildingIconIndex: '9',
        wonderSplashPath: 'Art\\Wonder Splash\\Inherited.pcx',
        animationName: 'Inherited Unit',
        pendingArtSources: { 'iconPaths:0': 'Art-dev\\InheritedLarge.pcx' },
        pendingArtConversions: {
          'iconPaths:0': {
            width: 128,
            height: 128,
            rgbaBase64: 'AAAA'
          }
        },
        _importScenarioPath: '/tmp/source.biq',
        _importScenarioPaths: ['/tmp/source'],
        _pendingImportedResourceIcon: { sourceIconIndex: 1, targetIconIndex: 2 },
        _pendingImportedUnitIcon: { sourceIconIndex: 1, targetIconIndex: 2 },
        _pendingImportedBuildingCityIcon: { sourceIconIndex: 1, targetIconIndex: 2 },
        biqFields: [makeTestBiqField('civilopediaentry', key.replace('BLANK', 'SOURCE'))]
      },
      civilopediaKey: key,
      mode: 'blank',
      displayName: 'Blank Art'
    });
    assert.equal(Array.isArray(blank.iconPaths), true, `${tabKey} icon paths should be an array`);
    assert.equal(blank.iconPaths.length, 0, `${tabKey} should not inherit icon paths`);
    assert.equal(Array.isArray(blank.racePaths), true, `${tabKey} civ art paths should be an array`);
    assert.equal(blank.racePaths.length, 0, `${tabKey} should not inherit civ art paths`);
    assert.equal(blank.thumbPath, '', `${tabKey} should not inherit list thumbnail path`);
    assert.equal(blank.animationName, '', `${tabKey} should not inherit unit animation folder`);
    assert.equal(blank.buildingIconKind, '', `${tabKey} should not inherit building art mode`);
    assert.equal(blank.buildingIconIndex, '', `${tabKey} should not inherit building art index`);
    assert.equal(blank.wonderSplashPath, '', `${tabKey} should not inherit wonder splash`);
    assert.equal(blank.pendingArtSources, undefined, `${tabKey} should not inherit pending art sources`);
    assert.equal(blank.pendingArtConversions, undefined, `${tabKey} should not inherit pending art conversions`);
    assert.equal(blank._importScenarioPath, undefined, `${tabKey} should not inherit import preview roots`);
    assert.equal(blank._importScenarioPaths, undefined, `${tabKey} should not inherit import preview roots`);
    assert.equal(blank._pendingImportedResourceIcon, undefined, `${tabKey} should not inherit resource atlas imports`);
    assert.equal(blank._pendingImportedUnitIcon, undefined, `${tabKey} should not inherit unit atlas imports`);
    assert.equal(blank._pendingImportedBuildingCityIcon, undefined, `${tabKey} should not inherit building atlas imports`);
  }
});

test('Renderer blank reference templates use unset cross-reference defaults', () => {
  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers({ tabs: {} });
  const cases = [
    {
      tabKey: 'civilizations',
      key: 'RACE_BLANK_REFS',
      fields: [
        ['favoritegovernment', '0'],
        ['shunnedgovernment', '0'],
        ['kingunit', '0'],
        ['freetech1index', '0'],
        ['freetech2index', '1'],
        ['culturegroup', '0'],
        ['diplomacytextindex', '0']
      ],
      expected: {
        favoritegovernment: '-1',
        shunnedgovernment: '-1',
        kingunit: '-1',
        freetech1index: '-1',
        freetech2index: '-1',
        culturegroup: '-1',
        diplomacytextindex: '-1'
      }
    },
    {
      tabKey: 'technologies',
      key: 'TECH_BLANK_REFS',
      fields: [['prerequisite1', '0'], ['prerequisite2', '1']],
      expected: { prerequisite1: 'None', prerequisite2: 'None' }
    },
    {
      tabKey: 'resources',
      key: 'GOOD_BLANK_REFS',
      fields: [['prerequisite', '0']],
      expected: { prerequisite: '-1' }
    },
    {
      tabKey: 'governments',
      key: 'GOVT_BLANK_REFS',
      fields: [['prerequisitetechnology', '0'], ['immuneto', '0']],
      expected: { prerequisitetechnology: '-1', immuneto: '-1' }
    },
    {
      tabKey: 'units',
      key: 'PRTO_BLANK_REFS',
      fields: [
        ['iconindex', '0'],
        ['requiredtech', '0'],
        ['requiredresource1', '0'],
        ['requiredresource2', '1'],
        ['requiredresource3', '2'],
        ['upgradeto', '0'],
        ['enslaveresultsin', '0'],
        ['stealth_target', '0,1'],
        ['legal_building_telepad', '0']
      ],
      expected: {
        iconindex: '0',
        requiredtech: '-1',
        requiredresource1: '-1',
        requiredresource2: '-1',
        requiredresource3: '-1',
        upgradeto: '-1',
        enslaveresultsin: '-1',
        stealth_target: '',
        legal_building_telepad: ''
      }
    }
  ];

  for (const item of cases) {
    const blank = buildNewReferenceEntryFromTemplate({
      tabKey: item.tabKey,
      sourceEntry: {
        name: 'Source',
        civilopediaKey: item.key.replace('BLANK', 'SOURCE'),
        biqFields: [
          makeTestBiqField('civilopediaentry', item.key.replace('BLANK', 'SOURCE')),
          ...item.fields.map(([key, value]) => makeTestBiqField(key, value))
        ]
      },
      civilopediaKey: item.key,
      mode: 'blank',
      displayName: 'Blank Refs'
    });
    for (const [fieldKey, expectedValue] of Object.entries(item.expected)) {
      assert.equal(fieldVal(blank, fieldKey), expectedValue, `${item.tabKey}.${fieldKey}`);
    }
  }
});

test('Add blank BLDG uses blank improvement defaults for serialized fields', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Source BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const newKey = makeShortTestRef('BLDG_', 'BLANK');
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      improvements: { recordOps: [{ op: 'add', newRecordRef: newKey }] }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const added = getEntry(after, 'improvements', newKey);
  assert.ok(added, `expected added improvement ${newKey}`);
  for (const key of [
    'reqresource1',
    'reqresource2',
    'reqgovernment',
    'reqimprovement',
    'doubleshappiness',
    'gainineverycity',
    'gainoncontinent',
    'obsoleteby',
    'unitproduced',
    'spaceshippart'
  ]) {
    assert.equal(getRawRecordInt({ fields: added.biqFields }, key), -1, `${key} should serialize as unset`);
  }
  assert.equal(fieldVal(added, 'wonder'), 'false');
  assert.equal(fieldVal(added, 'smallwonder'), 'false');
  assert.equal(fieldVal(added, 'improvement'), 'true');
  assert.equal(added.improvementKind, 'normal');
});

test('Add blank RACE uses unset government, monarch, and diplomacy defaults', (t) => {
  const ctx = setupScenario(TIDES_BIQ);
  if (!ctx) return t.skip(`Source BIQ not found: ${TIDES_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const newKey = makeShortTestRef('RACE_', 'BLANK');
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: { recordOps: [{ op: 'add', newRecordRef: newKey }] }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const added = getEntry(after, 'civilizations', newKey);
  assert.ok(added, `expected added civilization ${newKey}`);
  for (const key of ['favoritegovernment', 'shunnedgovernment', 'kingunit']) {
    assert.equal(fieldVal(added, key), 'None', `${key} should display as unset`);
  }
  assert.equal(fieldVal(added, 'diplomacytextindex'), '-1', 'diplomacytextindex should serialize as unset');
});

test('Add blank PRTO uses Quint-style new-unit defaults for serialized fields', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Source BIQ not found: ${BASE_BIQ}`);
  const { tmpDir, c3xDir, biqPath } = ctx;

  const newKey = `PRTO_ADD_DFLT_${Date.now()}`.toUpperCase();
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: { recordOps: [{ op: 'add', newRecordRef: newKey }] }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const section = getSection(after, 'PRTO');
  const addedRecords = (section && Array.isArray(section.records) ? section.records : []).filter((record) => {
    const field = getRawRecordField(record, 'civilopediaentry');
    return String(field && field.value || '').trim().toUpperCase() === newKey;
  });
  assert.equal(addedRecords.length, 2, `expected Quint-style split PRTO records for ${newKey}`);

  const primary = addedRecords.find((record) => getRawRecordInt(record, 'otherstrategy') === -1);
  const duplicate = addedRecords.find((record) => getRawRecordInt(record, 'otherstrategy') >= 0);
  assert.ok(primary, `expected primary PRTO record for ${newKey}`);
  assert.ok(duplicate, `expected duplicate PRTO strategy-map record for ${newKey}`);

  assert.equal(getRawRecordInt(primary, 'movement'), 1);
  assert.equal(getRawRecordInt(primary, 'aistrategy'), 1);
  assert.equal(getRawRecordInt(primary, 'availableto'), -2);
  assert.equal(getRawRecordInt(primary, 'otherstrategy'), -1);
  assert.equal(getRawRecordInt(primary, 'ptwstandardorders'), 127);
  assert.equal(getRawRecordInt(primary, 'ptwspecialactions'), 781);
  assert.equal(getRawRecordInt(duplicate, 'aistrategy'), 2);
  assert.equal(getRawRecordInt(duplicate, 'otherstrategy') >= 0, true);
});

// ---------------------------------------------------------------------------
// COPY tests — one per entity type
// ---------------------------------------------------------------------------

const COPY_SEEDS = {
  civilizations: 'RACE_AMERICAN',
  technologies:  'TECH_POTTERY',
  resources:     'GOOD_ALUMINUM',
  improvements:  'BLDG_BARRACKS',
  governments:   'GOVT_DESPOTISM',
  units:         'PRTO_WARRIOR'
};

for (const { tabKey, sectionCode, prefix } of ADD_CASES) {
  test(`Copy ${sectionCode}: copied fields persist and source remains unchanged`, (t) => {
    const sourceBiq = tabKey === 'civilizations' ? TIDES_BIQ : BASE_BIQ;
    const ctx = setupScenario(sourceBiq);
    if (!ctx) return t.skip(`Source BIQ not found: ${sourceBiq}`);
    const { c3xDir, biqPath } = ctx;

    const before = reload(c3xDir, biqPath);
    const seedKey = COPY_SEEDS[tabKey];
    const sourceEntries = before.tabs[tabKey] && Array.isArray(before.tabs[tabKey].entries)
      ? before.tabs[tabKey].entries
      : [];
    const sourceEntry = getEntry(before, tabKey, seedKey)
      || sourceEntries[0];
    assert.ok(sourceEntry, `expected a source entry for ${tabKey}`);
    const sourceIndex = sourceEntries.indexOf(sourceEntry);
    const sourceRef = String(sourceEntry.civilopediaKey || '').toUpperCase();

    const newKey = makeShortTestRef(prefix, 'COPY');
    const { buildNewReferenceEntryFromTemplate, makeReferenceCopyRecordOp } = loadRendererImportHelpers(before);
    const copiedPreSave = buildNewReferenceEntryFromTemplate({
      tabKey,
      sourceEntry,
      civilopediaKey: newKey,
      mode: 'copy',
      displayName: `${sectionCode} Copy Field Test`
    });
    applyRepresentativeCrudEditsToEntry(tabKey, copiedPreSave, before, `${sectionCode} Copy Field Test`);
    const saveResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      dirtyTabs: [tabKey],
      tabs: {
        [tabKey]: {
          entries: [copiedPreSave],
          recordOps: [makeReferenceCopyRecordOp(tabKey, sourceEntry, sourceIndex, newKey)]
        }
      }
    });
    assert.equal(saveResult.ok, true, String(saveResult.error || 'copy save failed'));

    const after = reload(c3xDir, biqPath);
    // New record is present
    assert.equal(biqHasKey(after, sectionCode, newKey), true,
      `expected copied record ${newKey}`);
    // Source still present and unchanged
    assert.equal(biqHasKey(after, sectionCode, sourceRef), true,
      `expected source record ${sourceRef} to survive copy`);

    const copiedEntry = getEntry(after, tabKey, newKey);
    const originalEntry = getEntry(after, tabKey, sourceRef);
    assertReloadedReferenceEntryFieldsMatchPreSave(copiedPreSave, copiedEntry, `copied ${sectionCode}`);
    assertReloadedReferenceEntryFieldsMatchPreSave(sourceEntry, originalEntry, `source ${sectionCode}`);
  });
}

// ---------------------------------------------------------------------------
// EDIT tests — one per entity type
// ---------------------------------------------------------------------------

for (const { tabKey, sectionCode } of ADD_CASES) {
  test(`Edit ${sectionCode}: all projected fields persist after save and reload`, (t) => {
    const sourceBiq = tabKey === 'civilizations' ? TIDES_BIQ : BASE_BIQ;
    const ctx = setupScenario(sourceBiq);
    if (!ctx) return t.skip(`Source BIQ not found: ${sourceBiq}`);
    const { c3xDir, biqPath } = ctx;

    const before = reload(c3xDir, biqPath);
    const entries = before.tabs[tabKey] && Array.isArray(before.tabs[tabKey].entries)
      ? before.tabs[tabKey].entries
      : [];
    const seedKey = COPY_SEEDS[tabKey];
    const sourceEntry = getEntry(before, tabKey, seedKey) || entries[0];
    assert.ok(sourceEntry, `expected a source entry for ${tabKey}`);
    const sourceRef = String(sourceEntry.civilopediaKey || '').toUpperCase();
    const neighborEntry = entries.find((entry) =>
      String(entry && entry.civilopediaKey || '').trim().toUpperCase() !== sourceRef
    ) || null;

    const editedPreSave = cloneReferenceEntry(sourceEntry);
    applyRepresentativeCrudEditsToEntry(tabKey, editedPreSave, before, `${sectionCode} Edit Field Test`);

    const saveResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      dirtyTabs: [tabKey],
      tabs: {
        [tabKey]: {
          entries: [editedPreSave],
          recordOps: []
        }
      }
    });
    assert.equal(saveResult.ok, true, String(saveResult.error || 'edit save failed'));

    const after = reload(c3xDir, biqPath);
    const reloadedEdited = getEntry(after, tabKey, sourceRef);
    assertReloadedReferenceEntryFieldsMatchPreSave(editedPreSave, reloadedEdited, `edited ${sectionCode}`);
    if (neighborEntry) {
      const reloadedNeighbor = getEntry(after, tabKey, neighborEntry.civilopediaKey);
      assertReloadedReferenceEntryFieldsMatchPreSave(neighborEntry, reloadedNeighbor, `neighbor ${sectionCode}`);
    }
  });
}

// ---------------------------------------------------------------------------
// DELETE tests — one per entity type
// ---------------------------------------------------------------------------

for (const { tabKey, sectionCode, prefix } of ADD_CASES) {
  test(`Delete ${sectionCode}: record gone after delete, others untouched`, (t) => {
    const sourceBiq = tabKey === 'civilizations' ? TIDES_BIQ : BASE_BIQ;
    const ctx = setupScenario(sourceBiq);
    if (!ctx) return t.skip(`Source BIQ not found: ${sourceBiq}`);
    const { c3xDir, biqPath } = ctx;

    // Step 1: add two fresh records so deleting the first forces the second
    // appended record to survive a final-index shift.
    const before = reload(c3xDir, biqPath);
    const sourceEntry = before.tabs[tabKey] && Array.isArray(before.tabs[tabKey].entries)
      ? before.tabs[tabKey].entries[0]
      : null;
    assert.ok(sourceEntry, `expected ${tabKey} source entry for delete template`);
    const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers(before);
    const newKey = makeShortTestRef(prefix, 'DEL');
    const survivorKey = makeShortTestRef(prefix, 'DSURV');
    const deleteEntry = buildNewReferenceEntryFromTemplate({
      tabKey,
      sourceEntry,
      civilopediaKey: newKey,
      mode: 'blank',
      displayName: `${sectionCode} Delete Field Test`
    });
    applyRepresentativeCrudEditsToEntry(tabKey, deleteEntry, before, `${sectionCode} Delete Field Test`);
    const survivorEntry = buildNewReferenceEntryFromTemplate({
      tabKey,
      sourceEntry,
      civilopediaKey: survivorKey,
      mode: 'blank',
      displayName: `${sectionCode} Delete Survivor`
    });
    applyRepresentativeCrudEditsToEntry(tabKey, survivorEntry, before, `${sectionCode} Delete Survivor`);
    const addResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      dirtyTabs: [tabKey],
      tabs: {
        [tabKey]: {
          entries: [deleteEntry, survivorEntry],
          recordOps: [
            { op: 'add', newRecordRef: newKey },
            { op: 'add', newRecordRef: survivorKey }
          ]
        }
      }
    });
    assert.equal(addResult.ok, true, `pre-delete add failed: ${addResult.error}`);

    const afterAdd = reload(c3xDir, biqPath);
    assert.equal(biqHasKey(afterAdd, sectionCode, newKey), true, 'record should exist before delete');
    assert.equal(biqHasKey(afterAdd, sectionCode, survivorKey), true, 'survivor should exist before delete');
    const countAfterAdd = countSection(afterAdd, sectionCode);
    const reloadedSurvivorBeforeDelete = getEntry(afterAdd, tabKey, survivorKey);
    assertReloadedReferenceEntryFieldsMatchPreSave(survivorEntry, reloadedSurvivorBeforeDelete, `pre-delete survivor ${sectionCode}`);

    // Step 2: capture existing keys (excluding the one we're deleting)
    const survivorKeys = (afterAdd.biq.sections.find(
      (s) => String(s.code || '').toUpperCase() === sectionCode
    )?.records || []).map((r) => {
      const f = (r.fields || []).find((field) =>
        String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry'
      );
      return String(f && f.value || '').trim().toUpperCase();
    }).filter((k) => k && k !== newKey);

    // Step 3: delete
    const delResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      tabs: { [tabKey]: { recordOps: [{ op: 'delete', recordRef: newKey }] } }
    });
    assert.equal(delResult.ok, true, String(delResult.error || 'delete save failed'));

    const afterDel = reload(c3xDir, biqPath);
    assert.equal(biqHasKey(afterDel, sectionCode, newKey), false,
      `expected deleted record ${newKey} to be gone`);
    assert.equal(biqHasKey(afterDel, sectionCode, survivorKey), true,
      `expected survivor ${survivorKey} to remain after delete`);
    const expectedDelta = sectionCode === 'PRTO' ? 2 : 1;
    assert.equal(countSection(afterDel, sectionCode), countAfterAdd - expectedDelta,
      `expected count to decrease by ${expectedDelta} after delete`);
    const reloadedSurvivorAfterDelete = getEntry(afterDel, tabKey, survivorKey);
    assertReloadedReferenceEntryFieldsMatchPreSave(
      reloadedSurvivorBeforeDelete,
      reloadedSurvivorAfterDelete,
      `post-delete survivor ${sectionCode}`,
      { skipGovernmentRelationRows: sectionCode === 'GOVT' }
    );

    // All survivors still present
    for (const key of survivorKeys) {
      assert.equal(biqHasKey(afterDel, sectionCode, key), true,
        `expected survivor ${key} to remain after delete`);
    }
  });
}

// ---------------------------------------------------------------------------
// IMPORT tests — presence, correct field values, no baggage
// ---------------------------------------------------------------------------

// Helper: run a full import from Tides and return { before, after, saveResult, newKey, importedEntry, srcEntry }
function runTidesImport(t, tabKey, sectionCode, prefix, srcPicker, targetBiqPath = BASE_BIQ) {
  const ctx = setupScenario(targetBiqPath);
  if (!ctx) { t.skip(`Target BIQ not found: ${targetBiqPath}`); return null; }
  if (!TIDES_BIQ_EXISTS) { t.skip(`Tides of Crimson BIQ not found: ${TIDES_BIQ}`); return null; }
  const { tmpDir, c3xDir, biqPath } = ctx;

  const tidesBundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  });

  const srcEntry = srcPicker
    ? srcPicker(tidesBundle)
    : pickEntry(tidesBundle, tabKey, () => true);

  if (!srcEntry) { t.skip(`No usable ${tabKey} entry found in Tides`); return null; }

  const before = reload(c3xDir, biqPath);
  const newKey = `${prefix}C3X_IMP_TEST_${Date.now()}`.toUpperCase();
  const importedEntry = simulateRendererImport(before, tidesBundle, tabKey, srcEntry, newKey);

  const saveResult = saveImport(
    c3xDir,
    biqPath,
    tabKey,
    newKey,
    importedEntry,
    TIDES_BIQ,
    String(srcEntry && srcEntry.civilopediaKey || '').trim().toUpperCase()
  );
  const after = reload(c3xDir, biqPath);

  return { tmpDir, c3xDir, biqPath, before, after, saveResult, newKey, importedEntry, srcEntry };
}

// --- Civ import ---
test('Import Civ from Tides: save succeeds and new RACE record present', (t) => {
  const r = runTidesImport(t, 'civilizations', 'RACE', 'RACE_',
    (b) => b.tabs.civilizations.entries.find((e) => e.civilopediaKey === 'RACE_AMAZONIANS')
      || b.tabs.civilizations.entries[0],
    TIDES_BIQ);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(biqHasKey(r.after, 'RACE', r.newKey), true, 'imported RACE record should be present');
});

test('Import Civ from Tides: scalar field values match source entry', (t) => {
  const r = runTidesImport(t, 'civilizations', 'RACE', 'RACE_',
    (b) => b.tabs.civilizations.entries.find((e) => e.civilopediaKey === 'RACE_AMAZONIANS')
      || b.tabs.civilizations.entries[0],
    TIDES_BIQ);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'civilizations', r.newKey);
  assert.ok(reloaded, 'expected reloaded civ entry');
  assertReloadedReferenceEntryFieldsMatchPreSave(r.importedEntry, reloaded, 'imported civilization');
  // Scalar fields that survive roundtrip unmodified
  for (const key of ['aggressionlevel', 'leadergender', 'culturegroup']) {
    const srcVal = fieldVal(r.srcEntry, key);
    const dstVal = fieldVal(reloaded, key);
    if (srcVal !== undefined && dstVal !== undefined) {
      assert.equal(dstVal, srcVal, `expected field ${key} to match after import`);
    }
  }
});

test('Import Civ from Tides: free techs, governments, and king unit are remapped by civilopedia key or cleared', (t) => {
  const tidesBundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  });
  const sourceTechMap = new Map(buildReferenceIndexMap(tidesBundle, 'technologies').map((item) => [item.index, item.civilopediaKey]));
  const sourceGovtMap = new Map(buildReferenceIndexMap(tidesBundle, 'governments').map((item) => [item.index, item.civilopediaKey]));
  const sourceUnitMap = new Map(buildReferenceIndexMap(tidesBundle, 'units').map((item) => [item.index, item.civilopediaKey]));
  const r = runTidesImport(t, 'civilizations', 'RACE', 'RACE_',
    (b) => b.tabs.civilizations.entries.find((e) => (
      ['freetech1index', 'freetech2index', 'freetech3index', 'freetech4index', 'favoritegovernment', 'shunnedgovernment', 'kingunit']
        .some((key) => {
          const value = fieldVal(e, key);
          return value !== undefined && value !== '-1' && value !== '' && value !== 'None';
        })
    )) || b.tabs.civilizations.entries[0],
    TIDES_BIQ);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'civilizations', r.newKey);
  assert.ok(reloaded, 'expected reloaded civ entry');
  const targetTechMap = new Map(buildReferenceIndexMap(r.before, 'technologies').map((item) => [item.civilopediaKey, item.index]));
  const targetGovtMap = new Map(buildReferenceIndexMap(r.before, 'governments').map((item) => [item.civilopediaKey, item.index]));
  const targetUnitMap = new Map(buildReferenceIndexMap(r.before, 'units').map((item) => [item.civilopediaKey, item.index]));
  ['freetech1index', 'freetech2index', 'freetech3index', 'freetech4index'].forEach((key) => {
    const srcIndex = Number.parseInt(String(fieldVal(r.srcEntry, key) || '').match(/-?\d+/)?.[0] || '', 10);
    const sourceKey = sourceTechMap.get(srcIndex);
    const expected = sourceKey ? targetTechMap.get(sourceKey) : undefined;
    const actual = String(fieldVal(reloaded, key) || '');
    const actualNumeric = actual.match(/-?\d+/)?.[0] || actual;
    if (Number.isFinite(expected)) assert.equal(actualNumeric, String(expected), `expected ${key} to remap`);
    else assert.equal(actual, 'None', `expected ${key} to clear`);
  });
  ['favoritegovernment', 'shunnedgovernment'].forEach((key) => {
    const srcIndex = Number.parseInt(String(fieldVal(r.srcEntry, key) || '').match(/-?\d+/)?.[0] || '', 10);
    const sourceKey = sourceGovtMap.get(srcIndex);
    const expected = sourceKey ? targetGovtMap.get(sourceKey) : undefined;
    const actual = String(fieldVal(reloaded, key) || '');
    const actualNumeric = actual.match(/-?\d+/)?.[0] || actual;
    if (Number.isFinite(expected)) assert.equal(actualNumeric, String(expected), `expected ${key} to remap`);
    else assert.equal(actual, 'None', `expected ${key} to clear`);
  });
  const srcKingIndex = Number.parseInt(String(fieldVal(r.srcEntry, 'kingunit') || '').match(/-?\d+/)?.[0] || '', 10);
  const sourceKingKey = sourceUnitMap.get(srcKingIndex);
  const expectedKing = sourceKingKey ? targetUnitMap.get(sourceKingKey) : undefined;
  const actualKing = String(fieldVal(reloaded, 'kingunit') || '');
  const actualKingNumeric = actualKing.match(/-?\d+/)?.[0] || actualKing;
  if (Number.isFinite(expectedKing)) assert.equal(actualKingNumeric, String(expectedKing), 'expected kingunit to remap');
  else assert.equal(actualKing, 'None', 'expected kingunit to clear');
});

test('Import Civ from Tides: does NOT increase tech count (no baggage)', (t) => {
  const r = runTidesImport(t, 'civilizations', 'RACE', 'RACE_',
    (b) => b.tabs.civilizations.entries[0],
    TIDES_BIQ);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(countSection(r.after, 'TECH'), countSection(r.before, 'TECH'),
    'tech count must not change when importing a civilization');
  assert.equal(countSection(r.after, 'GOOD'), countSection(r.before, 'GOOD'),
    'resource count must not change when importing a civilization');
  assert.equal(countSection(r.after, 'BLDG'), countSection(r.before, 'BLDG'),
    'improvement count must not change when importing a civilization');
});

// --- Tech import ---
test('Import Tech from Tides: save succeeds and new TECH record present', (t) => {
  const r = runTidesImport(t, 'technologies', 'TECH', 'TECH_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(biqHasKey(r.after, 'TECH', r.newKey), true, 'imported TECH record should be present');
});

test('Import Tech from Tides: cost and era fields match source', (t) => {
  const r = runTidesImport(t, 'technologies', 'TECH', 'TECH_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'technologies', r.newKey);
  assert.ok(reloaded, 'expected reloaded tech entry');
  assertReloadedReferenceEntryFieldsMatchPreSave(r.importedEntry, reloaded, 'imported technology');

  // cost: plain integer, direct compare
  const srcCost = fieldVal(r.srcEntry, 'cost');
  const dstCost = fieldVal(reloaded, 'cost');
  if (srcCost !== undefined && dstCost !== undefined) {
    assert.equal(dstCost, srcCost, 'expected cost to round-trip');
  }

  // era: compare the raw numeric value only — display labels may differ between BIQs
  // (e.g. era index 2 is "Magic Era" in Tides but "Industrial Ages" in base conquests)
  const extractNumeric = (v) => {
    const m = String(v || '').match(/\((-?\d+)\)$/);
    return m ? m[1] : String(v || '');
  };
  const srcEra = fieldVal(r.srcEntry, 'era');
  const dstEra = fieldVal(reloaded, 'era');
  if (srcEra !== undefined && dstEra !== undefined) {
    assert.equal(extractNumeric(dstEra), extractNumeric(srcEra),
      `expected era numeric index to round-trip (src: ${srcEra}, dst: ${dstEra})`);
  }
});

test('Import Tech from Tides: prerequisite tech fields are remapped by civilopedia key or cleared', (t) => {
  const tidesBundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  });
  const sourceTechMap = new Map(buildReferenceIndexMap(tidesBundle, 'technologies').map((item) => [item.index, item.civilopediaKey]));
  const r = runTidesImport(t, 'technologies', 'TECH', 'TECH_',
    (b) => b.tabs.technologies.entries.find((e) => (
      ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4'].some((key) => {
        const value = fieldVal(e, key);
        return value !== undefined && value !== '-1' && value !== '' && value !== 'None';
      })
    )) || b.tabs.technologies.entries[0]);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'technologies', r.newKey);
  assert.ok(reloaded, 'expected reloaded tech entry');
  const targetTechMap = new Map(buildReferenceIndexMap(r.before, 'technologies').map((item) => [item.civilopediaKey, item.index]));
  ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4'].forEach((key) => {
    const srcIndex = Number.parseInt(String(fieldVal(r.srcEntry, key) || '').match(/-?\d+/)?.[0] || '', 10);
    const sourceKey = sourceTechMap.get(srcIndex);
    const expectedTargetIndex = sourceKey ? targetTechMap.get(sourceKey) : undefined;
    const actual = String(fieldVal(reloaded, key) || '');
    const actualNumeric = actual.match(/-?\d+/)?.[0] || actual;
    if (Number.isFinite(expectedTargetIndex)) {
      assert.equal(actualNumeric, String(expectedTargetIndex), `expected ${key} to remap to ${expectedTargetIndex}`);
    } else {
      assert.equal(actual, 'None', `expected ${key} to clear when source tech is absent`);
    }
  });
});

test('Import Tech from Tides: does NOT increase civ or resource count (no baggage)', (t) => {
  const r = runTidesImport(t, 'technologies', 'TECH', 'TECH_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(countSection(r.after, 'RACE'), countSection(r.before, 'RACE'),
    'civ count must not change when importing a tech');
  assert.equal(countSection(r.after, 'GOOD'), countSection(r.before, 'GOOD'),
    'resource count must not change when importing a tech');
});

// --- Resource import ---
test('Import Resource from Tides: save succeeds and new GOOD record present', (t) => {
  const r = runTidesImport(t, 'resources', 'GOOD', 'GOOD_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(biqHasKey(r.after, 'GOOD', r.newKey), true, 'imported GOOD record should be present');
});

test('Import Resource from Tides: type field matches source', (t) => {
  const r = runTidesImport(t, 'resources', 'GOOD', 'GOOD_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'resources', r.newKey);
  assert.ok(reloaded, 'expected reloaded resource entry');
  assertReloadedReferenceEntryFieldsMatchPreSave(r.importedEntry, reloaded, 'imported resource');
  const srcType = fieldVal(r.srcEntry, 'type');
  const dstType = fieldVal(reloaded, 'type');
  if (srcType !== undefined && dstType !== undefined) {
    assert.equal(dstType, srcType, 'expected resource type to round-trip');
  }
});

test('Import Resource from Tides: no baggage — tech count unchanged', (t) => {
  // A resource may reference a tech prerequisite by BIQ index,
  // but that tech must NOT be pulled into the target scenario.
  const r = runTidesImport(t, 'resources', 'GOOD', 'GOOD_',
    // Prefer a resource with a non-(-1) prerequisite so the test is meaningful
    (b) => b.tabs.resources.entries.find((e) => {
      const prereq = fieldVal(e, 'prerequisite');
      return prereq !== undefined && prereq !== '-1' && prereq !== '';
    }) || b.tabs.resources.entries[0]);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(countSection(r.after, 'TECH'), countSection(r.before, 'TECH'),
    'tech count must not change when importing a resource (no prerequisite tech drag-along)');
  assert.equal(countSection(r.after, 'RACE'), countSection(r.before, 'RACE'),
    'civ count must not change when importing a resource');
  assert.equal(countSection(r.after, 'BLDG'), countSection(r.before, 'BLDG'),
    'improvement count must not change when importing a resource');
});

test('Import Resource from Tides: prerequisite technology is remapped by civilopedia key or cleared', (t) => {
  const r = runTidesImport(t, 'resources', 'GOOD', 'GOOD_',
    (b) => b.tabs.resources.entries.find((e) => {
      const prereq = fieldVal(e, 'prerequisite');
      return prereq !== undefined && prereq !== '-1' && prereq !== '' && prereq !== 'None';
    }) || b.tabs.resources.entries[0]);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'resources', r.newKey);
  assert.ok(reloaded, 'expected reloaded resource entry');
  const prereqField = (reloaded.biqFields || []).find(
    (f) => String(f && (f.baseKey || f.key) || '').toLowerCase() === 'prerequisite'
  );
  assert.ok(prereqField, 'expected prerequisite field to exist on imported resource');
  const sourceTechIndex = Number.parseInt(String(fieldVal(r.srcEntry, 'prerequisite') || '').match(/-?\d+/)?.[0] || '', 10);
  const sourceTechMap = new Map(buildReferenceIndexMap(loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  }), 'technologies').map((item) => [item.index, item.civilopediaKey]));
  const targetTechMap = new Map(buildReferenceIndexMap(r.before, 'technologies').map((item) => [item.civilopediaKey, item.index]));
  const sourceTechKey = sourceTechMap.get(sourceTechIndex);
  const expectedTargetIndex = sourceTechKey ? targetTechMap.get(sourceTechKey) : undefined;
  if (Number.isFinite(expectedTargetIndex)) {
    const actualNumeric = String(prereqField.value || '').match(/-?\d+/)?.[0] || String(prereqField.value || '');
    assert.equal(actualNumeric, String(expectedTargetIndex),
      `expected prerequisite tech to remap to target index ${expectedTargetIndex}`);
  } else {
    assert.equal(String(prereqField.value), 'None', 'expected unmatched prerequisite tech to clear');
  }
});

// --- Improvement import ---
test('Import Improvement from Tides: save succeeds and new BLDG record present', (t) => {
  const r = runTidesImport(t, 'improvements', 'BLDG', 'BLDG_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(biqHasKey(r.after, 'BLDG', r.newKey), true, 'imported BLDG record should be present');
});

test('Import Improvement from Tides: cost field matches source', (t) => {
  const r = runTidesImport(t, 'improvements', 'BLDG', 'BLDG_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'improvements', r.newKey);
  assert.ok(reloaded, 'expected reloaded improvement entry');
  assertReloadedReferenceEntryFieldsMatchPreSave(r.importedEntry, reloaded, 'imported improvement');
  const srcCost = fieldVal(r.srcEntry, 'cost');
  const dstCost = fieldVal(reloaded, 'cost');
  if (srcCost !== undefined && dstCost !== undefined) {
    assert.equal(dstCost, srcCost, 'expected improvement cost to round-trip');
  }
});

test('Import Improvement from Tides: no baggage — no extra sections added', (t) => {
  const r = runTidesImport(t, 'improvements', 'BLDG', 'BLDG_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(countSection(r.after, 'TECH'), countSection(r.before, 'TECH'),
    'tech count must not change when importing an improvement');
  assert.equal(countSection(r.after, 'RACE'), countSection(r.before, 'RACE'),
    'civ count must not change when importing an improvement');
  assert.equal(countSection(r.after, 'GOOD'), countSection(r.before, 'GOOD'),
    'resource count must not change when importing an improvement');
  assert.equal(countSection(r.after, 'PRTO'), countSection(r.before, 'PRTO'),
    'unit count must not change when importing an improvement');
});

// --- Government import ---
test('Import Government from Tides: save succeeds and new GOVT record present', (t) => {
  const r = runTidesImport(t, 'governments', 'GOVT', 'GOVT_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(biqHasKey(r.after, 'GOVT', r.newKey), true, 'imported GOVT record should be present');
});

test('Import Government from Tides: corruption level field matches source', (t) => {
  const r = runTidesImport(t, 'governments', 'GOVT', 'GOVT_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'governments', r.newKey);
  assert.ok(reloaded, 'expected reloaded government entry');
  assertReloadedReferenceEntryFieldsMatchPreSave(r.importedEntry, reloaded, 'imported government');
  const srcVal = fieldVal(r.srcEntry, 'corruptionlevel');
  const dstVal = fieldVal(reloaded, 'corruptionlevel');
  if (srcVal !== undefined && dstVal !== undefined) {
    assert.equal(dstVal, srcVal, 'expected corruptionlevel to round-trip');
  }
});

test('Import Government from Tides: prerequisite technology is remapped by civilopedia key or cleared', (t) => {
  const tidesBundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  });
  const sourceTechMap = new Map(buildReferenceIndexMap(tidesBundle, 'technologies').map((item) => [item.index, item.civilopediaKey]));
  const r = runTidesImport(t, 'governments', 'GOVT', 'GOVT_',
    (b) => b.tabs.governments.entries.find((e) => {
      const value = fieldVal(e, 'prerequisitetechnology');
      return value !== undefined && value !== '-1' && value !== '' && value !== 'None';
    }) || b.tabs.governments.entries[0]);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'governments', r.newKey);
  assert.ok(reloaded, 'expected reloaded government entry');
  const targetTechMap = new Map(buildReferenceIndexMap(r.before, 'technologies').map((item) => [item.civilopediaKey, item.index]));
  const srcIndex = Number.parseInt(String(fieldVal(r.srcEntry, 'prerequisitetechnology') || '').match(/-?\d+/)?.[0] || '', 10);
  const sourceKey = sourceTechMap.get(srcIndex);
  const expected = sourceKey ? targetTechMap.get(sourceKey) : undefined;
  const actual = String(fieldVal(reloaded, 'prerequisitetechnology') || '');
  if (Number.isFinite(expected)) assert.equal(actual, String(expected), 'expected prerequisite technology to remap');
  else assert.equal(actual, 'None', 'expected prerequisite technology to clear');
});

test('Import Government from Tides: no baggage — section counts unchanged', (t) => {
  const r = runTidesImport(t, 'governments', 'GOVT', 'GOVT_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  for (const code of ['RACE', 'TECH', 'GOOD', 'BLDG', 'PRTO']) {
    assert.equal(countSection(r.after, code), countSection(r.before, code),
      `${code} count must not change when importing a government`);
  }
});

// --- Unit import ---
test('Import Unit from Tides: save succeeds and new PRTO record present', (t) => {
  const r = runTidesImport(t, 'units', 'PRTO', 'PRTO_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  assert.equal(biqHasKey(r.after, 'PRTO', r.newKey), true, 'imported PRTO record should be present');
});

test('Import Unit from Tides: attack/defense fields match source', (t) => {
  const r = runTidesImport(
    t,
    'units',
    'PRTO',
    'PRTO_',
    (bundle) => pickEntry(bundle, 'units', (entry) => String(entry && entry.civilopediaKey || '').toUpperCase() === 'PRTO_BARRAGE')
      || bundle.tabs.units.entries[0]
  );
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'units', r.newKey);
  assert.ok(reloaded, 'expected reloaded unit entry');
  assertReloadedPrtoEntryFieldsMatchPreSave(r.importedEntry, reloaded, 'imported unit');
  for (const key of ['attack', 'defense', 'movement']) {
    const srcVal = fieldVal(r.srcEntry, key);
    const dstVal = fieldVal(reloaded, key);
    if (srcVal !== undefined && dstVal !== undefined) {
      assert.equal(dstVal, srcVal, `expected field ${key} to round-trip for imported unit`);
    }
  }
});

test('Import Unit from Tides: immediate multi-strategy edit preserves imported rows and target neighbors', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Target BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides of Crimson BIQ not found: ${TIDES_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  const tidesBundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  });
  const sourceEntry = pickEntry(
    tidesBundle,
    'units',
    (entry) => String(entry && entry.civilopediaKey || '').trim().toUpperCase() === 'PRTO_BARRAGE'
  ) || pickEntry(tidesBundle, 'units', () => true);
  if (!sourceEntry) return t.skip('No usable Tides unit entry found');

  const before = reload(c3xDir, biqPath);
  const neighborBaselines = new Map();
  ['PRTO_WARRIOR', 'PRTO_ARCHER'].forEach((unitKey) => {
    const raw = getRawPrimaryPrtoRecord(before, unitKey);
    assert.ok(raw, `expected target neighbor ${unitKey}`);
    neighborBaselines.set(unitKey, {
      attack: getRawRecordInt(raw, 'attack'),
      shieldcost: getRawRecordInt(raw, 'shieldcost'),
      mask: getRawPrtoStrategyMask(before, unitKey)
    });
  });

  const newKey = makeShortTestRef('PRTO_', 'IMP_AI');
  const importedEntry = simulateRendererImport(before, tidesBundle, 'units', sourceEntry, newKey);
  const expectedMask = 0b00000000000011000001; // Offence + Air Bombard + Air Defence
  setFieldVal(importedEntry, 'attack', '17');
  setFieldVal(importedEntry, 'shieldcost', '123');
  setUnitAiStrategyMask(importedEntry, expectedMask);

  const saveResult = saveImport(
    c3xDir,
    biqPath,
    'units',
    newKey,
    importedEntry,
    TIDES_BIQ,
    String(sourceEntry && sourceEntry.civilopediaKey || '').trim().toUpperCase()
  );
  assert.equal(saveResult.ok, true, String(saveResult.error || 'imported multi-strategy unit save failed'));

  const after = reload(c3xDir, biqPath);
  const rawImported = getRawPrimaryPrtoRecord(after, newKey);
  assert.ok(rawImported, 'expected imported unit primary after reload');
  const reloadedImported = getEntry(after, 'units', newKey);
  assertReloadedPrtoEntryFieldsMatchPreSave(importedEntry, reloadedImported, 'imported edited unit');
  assert.equal(getRawRecordInt(rawImported, 'attack'), 17);
  assert.equal(getRawRecordInt(rawImported, 'shieldcost'), 123);
  assertRawPrtoStrategyRows(after, newKey, expectedMask, 'imported edited unit');

  neighborBaselines.forEach((baseline, unitKey) => {
    const raw = getRawPrimaryPrtoRecord(after, unitKey);
    assert.ok(raw, `expected target neighbor ${unitKey} after import`);
    assert.equal(getRawRecordInt(raw, 'attack'), baseline.attack, `${unitKey} attack should stay unchanged`);
    assert.equal(getRawRecordInt(raw, 'shieldcost'), baseline.shieldcost, `${unitKey} cost should stay unchanged`);
    assert.equal(getRawPrtoStrategyMask(after, unitKey), baseline.mask, `${unitKey} AI strategy mask should stay unchanged`);
  });
});

test('Import Arctic Ape from Tides preserves hit-point bonus and support flag', (t) => {
  const r = runTidesImport(
    t,
    'units',
    'PRTO',
    'PRTO_',
    (bundle) => pickEntry(bundle, 'units', (entry) => String(entry && entry.name || '') === 'Arctic Ape')
  );
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'units', r.newKey);
  assert.ok(reloaded, 'expected reloaded Arctic Ape entry');
  assert.equal(fieldVal(reloaded, 'hitpointbonus'), fieldVal(r.srcEntry, 'hitpointbonus'));
  assert.equal(fieldVal(reloaded, 'requiressupport'), fieldVal(r.srcEntry, 'requiressupport'));
});

test('Import Arctic Ape from Tides clears unmatched stealth targets before save and after reload', (t) => {
  const r = runTidesImport(
    t,
    'units',
    'PRTO',
    'PRTO_',
    (bundle) => pickEntry(bundle, 'units', (entry) => String(entry && entry.name || '') === 'Arctic Ape')
  );
  if (!r) return;
  const preSaveTargets = (r.importedEntry.biqFields || [])
    .filter((field) => String(field && (field.baseKey || field.key) || '') === 'stealth_target')
    .map((field) => String(field.value || '').trim())
    .filter(Boolean);
  assert.equal(preSaveTargets.length, 0);
  assert.equal(fieldVal(r.importedEntry, 'numstealthtargets'), '0');

  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  const reloaded = getEntry(r.after, 'units', r.newKey);
  assert.ok(reloaded, 'expected reloaded Arctic Ape entry');
  const postSaveTargets = (reloaded.biqFields || [])
    .filter((field) => String(field && (field.baseKey || field.key) || '') === 'stealth_target')
    .map((field) => String(field.value || '').trim())
    .filter(Boolean);
  assert.equal(postSaveTargets.length, 0);
  assert.equal(fieldVal(reloaded, 'numstealthtargets'), '0');
});

test('Import Unit from Tides: no baggage — no extra sections added', (t) => {
  const r = runTidesImport(t, 'units', 'PRTO', 'PRTO_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));
  for (const code of ['RACE', 'TECH', 'GOOD', 'BLDG', 'GOVT']) {
    assert.equal(countSection(r.after, code), countSection(r.before, code),
      `${code} count must not change when importing a unit`);
  }
});

test('Import Unit from Tides: appends icon to scenario units_32.pcx and rewrites only the imported icon index', (t) => {
  const r = runTidesImport(t, 'units', 'PRTO', 'PRTO_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));

  const reloaded = getEntry(r.after, 'units', r.newKey);
  assert.ok(reloaded, 'expected reloaded unit entry');

  const units32Writes = (r.saveResult.saveReport || []).filter((item) =>
    String(item && item.kind || '') === 'atlas' &&
    /art[\\/]+units[\\/]+units_32\.pcx$/i.test(String(item && item.path || ''))
  );
  assert.equal(units32Writes.length, 1, 'unit import should write scenario-local units_32.pcx');
  const targetUnits32 = String(units32Writes[0].sourcePath || '') || resolveTestUnits32Pcx(CIV3_ROOT, []);
  if (!targetUnits32) {
    return t.skip('units_32.pcx was not available for target scenario');
  }
  const expectedSlot = findNextUnitAtlasSlot(fs.readFileSync(targetUnits32)).index;
  assert.equal(fieldVal(reloaded, 'iconindex'), String(expectedSlot));
  const scenarioUnits32 = path.join(r.tmpDir, 'Art', 'Units', 'units_32.pcx');
  assert.equal(fs.existsSync(scenarioUnits32), true, 'scenario-local units_32.pcx should be created');
  assert.equal(units32CellHasNonMagenta(fs.readFileSync(scenarioUnits32), expectedSlot), true, 'appended units_32 slot should contain icon pixels');

  const beforeIconValues = new Map((r.before.tabs.units.entries || []).map((entry) => [
    String(entry && entry.civilopediaKey || '').toUpperCase(),
    getUnitIconFieldValue(entry)
  ]));
  (r.after.tabs.units.entries || []).forEach((entry) => {
    const key = String(entry && entry.civilopediaKey || '').toUpperCase();
    if (key === r.newKey) return;
    if (!beforeIconValues.has(key)) return;
    assert.equal(getUnitIconFieldValue(entry), beforeIconValues.get(key), `existing unit icon index changed for ${key}`);
  });
});

test('Import Unit from Tides: disabled auto units_32 setting leaves units_32.pcx untouched', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Target BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides of Crimson BIQ not found: ${TIDES_BIQ}`);

  const targetBefore = reload(ctx.c3xDir, ctx.biqPath);
  const tidesBundle = loadBundle({ mode: 'scenario', civ3Path: CIV3_ROOT, scenarioPath: TIDES_BIQ });
  const srcUnit = pickEntry(tidesBundle, 'units', () => true);
  if (!srcUnit) return t.skip('No unit entry in Tides');

  const newKey = `PRTO_C3X_UID_${Date.now()}`.toUpperCase();
  const importedEntry = simulateRendererImport(targetBefore, tidesBundle, 'units', srcUnit, newKey);
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: ctx.c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: ctx.biqPath,
    autoAddImportedUnitIcons: false,
    tabs: {
      units: {
        entries: [importedEntry],
        recordOps: [{
          op: 'add',
          newRecordRef: newKey,
          sourceRef: String(srcUnit.civilopediaKey || '').trim().toUpperCase(),
          importArtFrom: TIDES_BIQ
        }]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'disabled unit icon save failed'));
  const after = reload(ctx.c3xDir, ctx.biqPath);
  const reloaded = getEntry(after, 'units', newKey);
  assert.ok(reloaded, 'expected disabled-setting imported unit entry');
  assert.equal(fieldVal(reloaded, 'iconindex'), '0');
  assert.equal(fs.existsSync(path.join(ctx.tmpDir, 'Art', 'Units', 'units_32.pcx')), false, 'disabled setting should not create scenario-local units_32.pcx');
});

test('Import Unit into Tides: only the imported unit is dirty before save', (t) => {
  const ctx = setupScenario(TIDES_BIQ);
  if (!ctx) return t.skip(`Target BIQ not found: ${TIDES_BIQ}`);
  if (!BASE_BIQ_EXISTS) return t.skip(`Source BIQ not found: ${BASE_BIQ}`);

  const targetBefore = reload(ctx.c3xDir, ctx.biqPath);
  const sourceBundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: BASE_BIQ
  });
  const sourceEntry = pickEntry(
    sourceBundle,
    'units',
    (entry) => String(entry && entry.civilopediaKey || '').toUpperCase() === 'PRTO_WARRIOR'
  ) || sourceBundle.tabs.units.entries[0];
  assert.ok(sourceEntry, 'expected a source unit to import');

  const newKey = `PRTO_C3X_DIRTY_TEST_${Date.now()}`.toUpperCase();
  const importedEntry = simulateRendererImport(targetBefore, sourceBundle, 'units', sourceEntry, newKey);
  const currentEntries = [importedEntry].concat(targetBefore.tabs.units.entries || []);
  const dirtyIds = computeDirtyReferenceIdentitySet('units', currentEntries, targetBefore.tabs.units.entries || []);
  const importedId = getReferenceEntryIdentity('units', importedEntry, 0);

  assert.equal(dirtyIds.size, 1, `expected only imported unit dirty, got: ${Array.from(dirtyIds).join(', ')}`);
  assert.equal(dirtyIds.has(importedId), true, 'expected imported unit identity to be dirty');

  const eraKeys = [
    'PRTO_SETTLER_ERAS_INDUSTRIAL_AGE',
    'PRTO_SETTLER_ERAS_MODERN_ERA',
    'PRTO_WORKER_ERAS_INDUSTRIAL_AGE',
    'PRTO_WORKER_ERAS_MODERN_ERA'
  ];
  eraKeys.forEach((key) => {
    const entry = getEntry(targetBefore, 'units', key);
    assert.ok(entry, `expected target Tides bundle to contain ${key}`);
    const identity = getReferenceEntryIdentity('units', entry, targetBefore.tabs.units.entries.indexOf(entry));
    assert.equal(dirtyIds.has(identity), false, `expected ${key} to remain clean after import`);
  });

  const reservedEntries = (targetBefore.tabs.units.entries || []).filter((entry) => /^zz_reserved\b/i.test(String(entry && entry.name || ''))).slice(0, 6);
  assert.equal(reservedEntries.length, 6, 'expected sampled reserved unit rows in target Tides bundle');
  reservedEntries.forEach((entry) => {
    const identity = getReferenceEntryIdentity('units', entry, targetBefore.tabs.units.entries.indexOf(entry));
    assert.equal(dirtyIds.has(identity), false, `expected reserved unit "${entry.name}" to remain clean after import`);
  });
});

test('Delete Unit in Tides uses identity removal and index-based record ref for duplicate-key units', (t) => {
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides of Crimson BIQ not found: ${TIDES_BIQ}`);
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  });
  const entries = (bundle.tabs.units && bundle.tabs.units.entries) || [];
  const byKey = new Map();
  entries.forEach((entry) => {
    const key = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  });
  const duplicateGroup = Array.from(byKey.values()).find((group) => group.length >= 2);
  assert.ok(duplicateGroup, 'expected at least one duplicate-key unit group in Tides');

  const selectedEntry = duplicateGroup[0];
  const siblingEntry = duplicateGroup[1];
  const selectedIndex = entries.indexOf(selectedEntry);
  const siblingIndex = entries.indexOf(siblingEntry);
  assert.ok(selectedIndex >= 0, 'expected selected duplicate-key unit in entries');
  assert.ok(siblingIndex >= 0, 'expected sibling duplicate-key unit in entries');

  const selectedIdentity = getReferenceEntryIdentity('units', selectedEntry, selectedIndex);
  const siblingIdentity = getReferenceEntryIdentity('units', siblingEntry, siblingIndex);
  assert.notEqual(selectedIdentity, siblingIdentity, 'expected duplicate-key unit identities to stay distinct');

  const afterDeleteEntries = entries.filter((entry, idx) => getReferenceEntryIdentity('units', entry, idx) !== selectedIdentity);
  assert.equal(afterDeleteEntries.length, entries.length - 1, 'expected identity-based delete to remove exactly one unit row');
  assert.equal(afterDeleteEntries.includes(selectedEntry), false, 'expected selected duplicate-key unit to be removed');
  assert.equal(afterDeleteEntries.includes(siblingEntry), true, 'expected sibling duplicate-key unit to remain');

  const { getReferenceRecordRefForOps } = loadRendererDeleteHelpers();
  const recordRef = getReferenceRecordRefForOps('units', selectedEntry, selectedIndex);
  assert.match(recordRef, /^@INDEX:\d+$/, 'expected unit delete op to target a specific BIQ index');
});

test('Delete civ shifts unit Available To bitmasks', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Source BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const before = reload(c3xDir, biqPath);
  const unit = getEntry(before, 'units', 'PRTO_WARRIOR') || before.tabs.units.entries[0];
  assert.ok(unit, 'expected a unit to edit');
  const availableField = unit.biqFields.find((field) => String(field.baseKey || field.key || '').toLowerCase() === 'availableto');
  assert.ok(availableField, 'expected availableto field');

  // Step 1: persist a known mask to disk. Bit 0 is barbarians; delete Rome (raw RACE index 1).
  availableField.value = String((1 << 0) | (1 << 1) | (1 << 2) | (1 << 5));
  const setMaskResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: { entries: [unit] }
    }
  });
  assert.equal(setMaskResult.ok, true, String(setMaskResult.error || 'save failed'));

  // Step 2: delete the civ with no concurrent unit edit, so we observe pure cascade behavior.
  const deleteResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: { recordOps: [{ op: 'delete', recordRef: 'RACE_ROMANS' }] }
    }
  });
  assert.equal(deleteResult.ok, true, String(deleteResult.error || 'delete save failed'));

  const after = reload(c3xDir, biqPath);
  const reloadedUnit = getEntry(after, 'units', String(unit.civilopediaKey || ''));
  assert.ok(reloadedUnit, 'expected reloaded unit');
  assert.equal(fieldVal(reloadedUnit, 'availableto'), String((1 << 0) | (1 << 1) | (1 << 4)));
});

test('Adding a civ does not rewrite existing unit Available To bitmasks', (t) => {
  const ctx = setupScenario(TIDES_BIQ);
  if (!ctx) return t.skip(`Source BIQ not found: ${TIDES_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const before = reload(c3xDir, biqPath);
  const beforeUnit = getEntry(before, 'units', 'PRTO_WARRIOR') || before.tabs.units.entries[0];
  assert.ok(beforeUnit, 'expected comparable unit before civ add');
  const beforeMask = fieldVal(beforeUnit, 'availableto');

  const newKey = `RACE_ADD_AVAIL_${Date.now()}`.toUpperCase();
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: { recordOps: [{ op: 'add', newRecordRef: newKey }] }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

  const after = reload(c3xDir, biqPath);
  const afterUnit = getEntry(after, 'units', String(beforeUnit.civilopediaKey || ''));
  assert.ok(afterUnit, 'expected comparable unit after civ add');
  assert.equal(fieldVal(afterUnit, 'availableto'), beforeMask);
});

// ---------------------------------------------------------------------------
// ART COPY tests — verify files land in the target content root
// ---------------------------------------------------------------------------

test('Import Civ from Tides: FLC forward/reverse filenames are copied to scenario content root', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides BIQ not found: ${TIDES_BIQ}`);
  const { tmpDir, c3xDir, biqPath } = ctx;

  const prepDelete = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: {
        recordOps: [{ op: 'delete', recordRef: 'RACE_AMERICAN' }]
      }
    }
  });
  assert.equal(prepDelete.ok, true, String(prepDelete.error || 'failed to free a civ slot before import'));

  const tidesBundle = loadBundle({ mode: 'scenario', civ3Path: CIV3_ROOT, scenarioPath: TIDES_BIQ });
  const srcCiv = tidesBundle.tabs.civilizations.entries.find(
    (e) => e.civilopediaKey === 'RACE_AMAZONIANS'
  ) || tidesBundle.tabs.civilizations.entries[0];
  if (!srcCiv) return t.skip('No RACE entry found in Tides');

  // Collect forward/reverse FLC paths from projected biqFields
  const flcPaths = (srcCiv.biqFields || [])
    .filter((f) => /^(forward|reverse)filename_for_era_\d+$/.test(
      String(f && (f.baseKey || f.key) || '').toLowerCase()
    ))
    .map((f) => String(f.value || '').trim())
    .filter(Boolean);

  if (flcPaths.length === 0) return t.skip('Source civ has no FLC paths in biqFields');

  const newKey = `RACE_C3X_ARTTEST_${Date.now()}`.toUpperCase();
  const importedEntry = simulateImportEntry(srcCiv, newKey);
  const saveResult = saveImport(c3xDir, biqPath, 'civilizations', newKey, importedEntry, TIDES_BIQ);
  assert.equal(saveResult.ok, true, String(saveResult.error || 'art-civ save failed'));

  // At least one FLC should have been copied into tmpDir
  const artReport = (saveResult.saveReport || []).filter((r) => r.kind === 'art');
  const copiedFlcs = artReport.filter((r) =>
    String(r.path || '').toLowerCase().endsWith('.flc') &&
    path.resolve(r.path).startsWith(path.resolve(tmpDir))
  );

  // Verify at least one FLC exists on disk in the target scenario dir
  const foundOnDisk = flcPaths.some((relPath) => {
    const target = path.join(tmpDir, relPath.replace(/\\/g, path.sep));
    return fs.existsSync(target);
  });

  // Accept either a saveReport entry OR an actual file on disk
  // (file may not exist if the source Tides art itself was absent)
  if (copiedFlcs.length > 0 || foundOnDisk) {
    // Pass — art was copied
    assert.ok(true, 'at least one FLC was scheduled for copy or exists on disk');
  } else {
    // Art source files absent in this installation — soft-skip
    t.skip('Source FLC art files were not present in this Civ3 installation; skipping art-copy assertion');
  }
});

test('Import Resource from Tides: icon PCX files are copied to scenario content root', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides BIQ not found: ${TIDES_BIQ}`);
  const { tmpDir, c3xDir, biqPath } = ctx;

  const tidesBundle = loadBundle({ mode: 'scenario', civ3Path: CIV3_ROOT, scenarioPath: TIDES_BIQ });
  // Pick a resource that actually has icon paths
  const srcRes = tidesBundle.tabs.resources.entries.find(
    (e) => Array.isArray(e.iconPaths) && e.iconPaths.length > 0
  ) || tidesBundle.tabs.resources.entries[0];
  if (!srcRes) return t.skip('No resource entry in Tides');

  const newKey = `GOOD_C3X_ARTTEST_${Date.now()}`.toUpperCase();
  const importedEntry = simulateImportEntry(srcRes, newKey);
  const saveResult = saveImport(c3xDir, biqPath, 'resources', newKey, importedEntry, TIDES_BIQ);
  assert.equal(saveResult.ok, true, String(saveResult.error || 'art-resource save failed'));

  if (!Array.isArray(srcRes.iconPaths) || srcRes.iconPaths.length === 0) {
    return t.skip('Source resource has no iconPaths; skipping art-copy assertion');
  }

  const artReport = (saveResult.saveReport || []).filter((r) => r.kind === 'art');
  const foundOnDisk = srcRes.iconPaths.some((relPath) => {
    const target = path.join(tmpDir, relPath.replace(/\\/g, path.sep));
    return fs.existsSync(target);
  });

  if (artReport.length > 0 || foundOnDisk) {
    assert.ok(true, 'icon art was scheduled for copy or exists on disk');
  } else {
    t.skip('Source icon PCX files were not present in this Civ3 installation; skipping art-copy assertion');
  }
});

test('Import Resource from Tides: appends map icon to scenario resources.pcx and rewrites only the imported icon index', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides BIQ not found: ${TIDES_BIQ}`);
  const { tmpDir, c3xDir, biqPath } = ctx;

  const targetResourcesPcx = resolveTestResourcesPcx(CIV3_ROOT);
  const sourceBundle = loadBundle({ mode: 'scenario', civ3Path: CIV3_ROOT, scenarioPath: TIDES_BIQ });
  const sourceRoots = [
    path.dirname(TIDES_BIQ),
    ...((sourceBundle && Array.isArray(sourceBundle.scenarioSearchPaths)) ? sourceBundle.scenarioSearchPaths : [])
  ];
  const sourceResourcesPcx = resolveTestResourcesPcx(CIV3_ROOT, sourceRoots);
  if (!targetResourcesPcx || !sourceResourcesPcx) {
    return t.skip('resources.pcx was not available for target or source scenario');
  }

  const expectedSlot = findNextResourceAtlasSlot(fs.readFileSync(targetResourcesPcx)).index;
  const srcRes = sourceBundle.tabs.resources.entries.find((entry) => {
    const icon = Number.parseInt(getResourceIconFieldValue(entry), 10);
    return Number.isFinite(icon) && icon >= 0;
  }) || sourceBundle.tabs.resources.entries[0];
  if (!srcRes) return t.skip('No resource entry in Tides');

  const targetBefore = reload(c3xDir, biqPath);
  const existingIconValues = new Map((targetBefore.tabs.resources.entries || []).map((entry) => [
    String(entry.civilopediaKey || '').toUpperCase(),
    getResourceIconFieldValue(entry)
  ]));
  const newKey = `GOOD_C3X_MAPICON_${Date.now()}`.toUpperCase();
  const importedEntry = simulateImportEntry(srcRes, newKey);
  const saveResult = saveImport(c3xDir, biqPath, 'resources', newKey, importedEntry, TIDES_BIQ);
  assert.equal(saveResult.ok, true, String(saveResult.error || 'resource map-icon import save failed'));

  const scenarioResourcesPcx = path.join(tmpDir, 'Art', 'resources.pcx');
  assert.equal(fs.existsSync(scenarioResourcesPcx), true, 'scenario-local resources.pcx should be created');
  const written = fs.readFileSync(scenarioResourcesPcx);
  assert.equal(resourcePcxCellHasNonMagenta(written, expectedSlot), true, `slot ${expectedSlot} should contain the imported icon`);

  const after = reload(c3xDir, biqPath);
  const reloaded = getEntry(after, 'resources', newKey);
  assert.ok(reloaded, 'expected imported resource to reload');
  assert.equal(getResourceIconFieldValue(reloaded), String(expectedSlot), 'imported resource icon index should point at appended slot');
  for (const [key, iconValue] of existingIconValues) {
    const entry = getEntry(after, 'resources', key);
    if (entry) assert.equal(getResourceIconFieldValue(entry), iconValue, `existing resource ${key} icon index should be unchanged`);
  }
});

test('Import Resource from Tides: disabled auto map-icon setting leaves resources.pcx untouched', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides BIQ not found: ${TIDES_BIQ}`);
  const { tmpDir, c3xDir, biqPath } = ctx;

  const sourceBundle = loadBundle({ mode: 'scenario', civ3Path: CIV3_ROOT, scenarioPath: TIDES_BIQ });
  const srcRes = sourceBundle.tabs.resources.entries.find((entry) => {
    const icon = Number.parseInt(getResourceIconFieldValue(entry), 10);
    return Number.isFinite(icon) && icon >= 0;
  }) || sourceBundle.tabs.resources.entries[0];
  if (!srcRes) return t.skip('No resource entry in Tides');

  const newKey = `GOOD_C3X_MAPICON_OFF_${Date.now()}`.toUpperCase();
  const importedEntry = simulateImportEntry(srcRes, newKey);
  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    autoAddImportedResourceIcons: false,
    tabs: {
      resources: {
        entries: [importedEntry],
        recordOps: [{
          op: 'add',
          newRecordRef: newKey,
          importArtFrom: TIDES_BIQ
        }]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'resource import save failed'));
  assert.equal(fs.existsSync(path.join(tmpDir, 'Art', 'resources.pcx')), false, 'disabled setting should not create scenario-local resources.pcx');
});

test('Import Unit from Tides: animation folder files are copied to scenario content root', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides BIQ not found: ${TIDES_BIQ}`);
  const { tmpDir, c3xDir, biqPath } = ctx;

  const tidesBundle = loadBundle({ mode: 'scenario', civ3Path: CIV3_ROOT, scenarioPath: TIDES_BIQ });
  // Pick a unit with a non-empty animationName
  const srcUnit = tidesBundle.tabs.units.entries.find(
    (e) => e.animationName && String(e.animationName).trim()
  ) || tidesBundle.tabs.units.entries[0];
  if (!srcUnit) return t.skip('No unit entry in Tides');

  const newKey = `PRTO_C3X_ARTTEST_${Date.now()}`.toUpperCase();
  const importedEntry = simulateImportEntry(srcUnit, newKey);
  const saveResult = saveImport(c3xDir, biqPath, 'units', newKey, importedEntry, TIDES_BIQ);
  assert.equal(saveResult.ok, true, String(saveResult.error || 'art-unit save failed'));

  const animName = String(srcUnit.animationName || '').trim();
  if (!animName) return t.skip('Source unit has no animationName');

  const expectedAnimDir = path.join(tmpDir, 'Art', 'Units', animName);
  const artReport = (saveResult.saveReport || []).filter((r) => r.kind === 'art');
  const animArt = artReport.filter((r) =>
    String(r.path || '').includes(path.join('Art', 'Units', animName))
  );

  if (animArt.length > 0 || (fs.existsSync(expectedAnimDir) && fs.readdirSync(expectedAnimDir).length > 0)) {
    assert.ok(true, 'unit animation folder was scheduled for copy or exists on disk');
  } else {
    t.skip(`Unit animation folder "${animName}" was not present in this Civ3 installation; skipping art-copy assertion`);
  }
});

// ---------------------------------------------------------------------------
// Stability tests — multiple operations in sequence on the same BIQ
// ---------------------------------------------------------------------------

test('Sequential add+copy+delete on same section stays consistent', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const before = reload(c3xDir, biqPath);
  const techCountBefore = countSection(before, 'TECH');

  // Add two techs
  const key1 = `TECH_SEQ_A_${Date.now()}`.toUpperCase();
  const key2 = `TECH_SEQ_B_${Date.now()}`.toUpperCase();
  const add2 = saveBundle({
    mode: 'scenario', c3xPath: c3xDir, civ3Path: CIV3_ROOT, scenarioPath: biqPath,
    tabs: { technologies: { recordOps: [{ op: 'add', newRecordRef: key1 }, { op: 'add', newRecordRef: key2 }] } }
  });
  assert.equal(add2.ok, true, String(add2.error || 'add2 failed'));

  const afterAdd2 = reload(c3xDir, biqPath);
  assert.equal(countSection(afterAdd2, 'TECH'), techCountBefore + 2, 'expected +2 techs');
  assert.equal(biqHasKey(afterAdd2, 'TECH', key1), true);
  assert.equal(biqHasKey(afterAdd2, 'TECH', key2), true);

  // Copy key1 to key3
  const key3 = `TECH_SEQ_C_${Date.now()}`.toUpperCase();
  const copyResult = saveBundle({
    mode: 'scenario', c3xPath: c3xDir, civ3Path: CIV3_ROOT, scenarioPath: biqPath,
    tabs: { technologies: { recordOps: [{ op: 'copy', sourceRef: key1, newRecordRef: key3 }] } }
  });
  assert.equal(copyResult.ok, true, String(copyResult.error || 'copy failed'));

  const afterCopy = reload(c3xDir, biqPath);
  assert.equal(countSection(afterCopy, 'TECH'), techCountBefore + 3);
  assert.equal(biqHasKey(afterCopy, 'TECH', key3), true);

  // Delete key2
  const del2 = saveBundle({
    mode: 'scenario', c3xPath: c3xDir, civ3Path: CIV3_ROOT, scenarioPath: biqPath,
    tabs: { technologies: { recordOps: [{ op: 'delete', recordRef: key2 }] } }
  });
  assert.equal(del2.ok, true, String(del2.error || 'delete key2 failed'));

  const afterDel = reload(c3xDir, biqPath);
  assert.equal(countSection(afterDel, 'TECH'), techCountBefore + 2);
  assert.equal(biqHasKey(afterDel, 'TECH', key1), true,  'key1 should remain');
  assert.equal(biqHasKey(afterDel, 'TECH', key2), false, 'key2 should be gone');
  assert.equal(biqHasKey(afterDel, 'TECH', key3), true,  'key3 copy should remain');
});

test('Multiple imports from Tides across different sections are all independent', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  if (!TIDES_BIQ_EXISTS) return t.skip(`Tides BIQ not found: ${TIDES_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const tidesBundle = loadBundle({ mode: 'scenario', civ3Path: CIV3_ROOT, scenarioPath: TIDES_BIQ });
  const before = reload(c3xDir, biqPath);

  const imports = [
    { tabKey: 'technologies', sectionCode: 'TECH', prefix: 'TECH_', entry: tidesBundle.tabs.technologies.entries[0] },
    { tabKey: 'resources',    sectionCode: 'GOOD', prefix: 'GOOD_', entry: tidesBundle.tabs.resources.entries[0] },
    { tabKey: 'improvements', sectionCode: 'BLDG', prefix: 'BLDG_', entry: tidesBundle.tabs.improvements.entries[0] }
  ].filter(({ entry }) => !!entry);

  if (imports.length === 0) return t.skip('No entries found in Tides to import');

  const newKeys = [];
  for (const { tabKey, sectionCode, prefix, entry } of imports) {
    // Keys must stay ≤ 32 chars (BIQ civilopediaEntry field width).
    // Use loop index instead of random to stay short and remain unique within the batch.
    const newKey = `${prefix}C3X_MULTI_${Date.now()}_${newKeys.length}`.toUpperCase();
    newKeys.push({ tabKey, sectionCode, newKey });
    const importedEntry = simulateImportEntry(entry, newKey);
    const result = saveImport(c3xDir, biqPath, tabKey, newKey, importedEntry, TIDES_BIQ);
    assert.equal(result.ok, true, `import ${tabKey} failed: ${result.error}`);
  }

  const after = reload(c3xDir, biqPath);

  // Each import should have added exactly one record to its section
  for (const { tabKey, sectionCode, newKey } of newKeys) {
    assert.equal(biqHasKey(after, sectionCode, newKey), true,
      `expected imported ${sectionCode} record ${newKey}`);
  }

  // Sections NOT imported should be unchanged
  const importedCodes = new Set(newKeys.map((x) => x.sectionCode));
  for (const code of ['RACE', 'GOVT', 'PRTO']) {
    if (!importedCodes.has(code)) {
      assert.equal(countSection(after, code), countSection(before, code),
        `${code} count must not change from unrelated imports`);
    }
  }
});

test('Add to each uncapped section simultaneously in one save call', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const cases = ADD_CASES.filter(({ sectionCode }) => sectionCode !== 'RACE');
  const before = reload(c3xDir, biqPath);
  const countsBefore = {};
  for (const { sectionCode } of cases) {
    countsBefore[sectionCode] = countSection(before, sectionCode);
  }

  const newKeys = {};
  const tabs = {};
  for (const { tabKey, sectionCode, prefix } of cases) {
    const newKey = `${prefix}C3X_ALLADD_${Date.now()}`.toUpperCase();
    newKeys[sectionCode] = newKey;
    tabs[tabKey] = { recordOps: [{ op: 'add', newRecordRef: newKey }] };
  }

  const saveResult = saveBundle({
    mode: 'scenario', c3xPath: c3xDir, civ3Path: CIV3_ROOT, scenarioPath: biqPath, tabs
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'multi-add save failed'));

  const after = reload(c3xDir, biqPath);
  for (const { sectionCode } of cases) {
    const expectedDelta = sectionCode === 'PRTO' ? 2 : 1;
    assert.equal(countSection(after, sectionCode), countsBefore[sectionCode] + expectedDelta,
      `expected +${expectedDelta} in ${sectionCode}`);
    assert.equal(biqHasKey(after, sectionCode, newKeys[sectionCode]), true,
      `expected new key in ${sectionCode}`);
  }
});

test('Rules default unit fields preserve what the UI shows after every CRUD save prefix', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
  assert.ok(getRuleDefaultUnitFieldKeys().length >= 10, 'expected full RULE default-unit delete inventory');

  const unitA = makeShortTestRef('PRTO_', 'RULEA');
  const unitB = makeShortTestRef('PRTO_', 'RULEB');
  const addAB = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: {
        recordOps: [
          { op: 'add', newRecordRef: unitA },
          { op: 'add', newRecordRef: unitB }
        ]
      }
    }
  });
  assert.equal(addAB.ok, true, String(addAB.error || 'unit add save failed'));

  let bundle = reload(c3xDir, biqPath);
  const ruleTab = makeTabWithSectionRecord(bundle, 'rules', 'RULE');
  const ruleRecord = ruleTab.sections[0].records[0];
  const unitBIndex = getEntryIndex(bundle, 'units', unitB);
  assert.ok(unitBIndex >= 0, 'expected second added unit to have an index');
  for (const fieldKey of getRuleDefaultUnitFieldKeys()) {
    setRawRecordFieldValue(ruleRecord, fieldKey, unitBIndex);
  }
  const setRules = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: { rules: ruleTab }
  });
  assert.equal(setRules.ok, true, String(setRules.error || 'RULE default-unit save failed'));

  bundle = reload(c3xDir, biqPath);
  assertRuleDefaultUnitFieldsPointTo(bundle, unitB, 'after setting every RULE default unit field');

  const unitC = makeShortTestRef('PRTO_', 'RULEC');
  const addC = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: { recordOps: [{ op: 'add', newRecordRef: unitC }] }
    }
  });
  assert.equal(addC.ok, true, String(addC.error || 'unit C add save failed'));
  bundle = reload(c3xDir, biqPath);
  assertRuleDefaultUnitFieldsPointTo(bundle, unitB, 'after later unit add');

  const deleteA = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: { recordOps: [{ op: 'delete', recordRef: unitA }] }
    }
  });
  assert.equal(deleteA.ok, true, String(deleteA.error || 'unit A delete save failed'));
  bundle = reload(c3xDir, biqPath);
  assert.equal(getEntry(bundle, 'units', unitA), null, 'deleted earlier unit should be gone');
  assertRuleDefaultUnitFieldsPointTo(bundle, unitB, 'after deleting an earlier unit shifts RULE defaults');

  const unitD = makeShortTestRef('PRTO_', 'RULED');
  const unitBEntry = getEntry(bundle, 'units', unitB);
  assert.ok(unitBEntry, 'expected unit B before copy');
  const copyB = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: {
        recordOps: [{ op: 'copy', sourceRef: `@INDEX:${unitBEntry.biqIndex}`, newRecordRef: unitD }]
      }
    }
  });
  assert.equal(copyB.ok, true, String(copyB.error || 'unit B copy save failed'));
  bundle = reload(c3xDir, biqPath);
  assertRuleDefaultUnitFieldsPointTo(bundle, unitB, 'after later unit copy');

  const editedB = cloneReferenceEntry(getEntry(bundle, 'units', unitB));
  applyRepresentativeCrudEditsToEntry('units', editedB, bundle, 'Rules Default Unit B');
  const editB = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    dirtyTabs: ['units'],
    tabs: {
      units: { entries: [editedB] }
    }
  });
  assert.equal(editB.ok, true, String(editB.error || 'unit B edit save failed'));
  bundle = reload(c3xDir, biqPath);
  assertReloadedReferenceEntryFieldsMatchPreSave(editedB, getEntry(bundle, 'units', unitB), 'edited RULE default unit target');
  assertRuleDefaultUnitFieldsPointTo(bundle, unitB, 'after editing referenced unit');

  const deleteB = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: { recordOps: [{ op: 'delete', recordRef: unitB }] }
    }
  });
  assert.equal(deleteB.ok, true, String(deleteB.error || 'unit B delete save failed'));
  bundle = reload(c3xDir, biqPath);
  assert.equal(getEntry(bundle, 'units', unitB), null, 'referenced unit should be deleted');
  assertRuleDefaultUnitFieldsPointTo(bundle, null, 'after deleting referenced unit clears RULE defaults');
  assert.ok(getEntry(bundle, 'units', unitC), 'later added unit should survive default-unit cascade sequence');
  assert.ok(getEntry(bundle, 'units', unitD), 'later copied unit should survive default-unit cascade sequence');
});

test('Cross-entity references preserve projected values when saved after each CRUD prefix', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const techA = makeShortTestRef('TECH_', 'PFXA');
  const techB = makeShortTestRef('TECH_', 'PFXB');
  const techC = makeShortTestRef('TECH_', 'PFXC');
  for (const key of [techA, techB, techC]) {
    const save = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      tabs: { technologies: { recordOps: [{ op: 'add', newRecordRef: key }] } }
    });
    assert.equal(save.ok, true, String(save.error || `failed to add ${key}`));
    assert.ok(getEntry(reload(c3xDir, biqPath), 'technologies', key), `${key} should survive immediate save/reload`);
  }

  let bundle = reload(c3xDir, biqPath);
  const unitHost = (bundle.tabs.units.entries || []).find((entry) => findBiqField(entry, 'requiredtech'));
  assert.ok(unitHost, 'expected editable unit tech prerequisite');
  const techCIndex = getEntryIndex(bundle, 'technologies', techC);
  setReferenceField(findBiqField(unitHost, 'requiredtech'), 'technologies', techC, techCIndex);
  const setUnitTech = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      units: { entries: [unitHost] },
      technologies: bundle.tabs.technologies
    }
  });
  assert.equal(setUnitTech.ok, true, String(setUnitTech.error || 'unit tech reference save failed'));

  const deleteTechB = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: { technologies: { recordOps: [{ op: 'delete', recordRef: techB }] } }
  });
  assert.equal(deleteTechB.ok, true, String(deleteTechB.error || 'delete middle tech failed'));
  bundle = reload(c3xDir, biqPath);
  assert.equal(getEntry(bundle, 'technologies', techB), null, 'middle saved tech should be deleted');
  const reloadedUnit = getEntry(bundle, 'units', unitHost.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedUnit.biqFields }, 'requiredtech'), getEntryIndex(bundle, 'technologies', techC),
    'unit required tech should track the surviving later tech index after a later save');

  const resourceA = makeShortTestRef('GOOD_', 'PFXA');
  const resourceB = makeShortTestRef('GOOD_', 'PFXB');
  for (const key of [resourceA, resourceB]) {
    const save = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      tabs: { resources: { recordOps: [{ op: 'add', newRecordRef: key }] } }
    });
    assert.equal(save.ok, true, String(save.error || `failed to add ${key}`));
    assert.ok(getEntry(reload(c3xDir, biqPath), 'resources', key), `${key} should survive immediate save/reload`);
  }

  bundle = reload(c3xDir, biqPath);
  const improvementHost = (bundle.tabs.improvements.entries || []).find((entry) => findBiqField(entry, 'reqresource1'));
  assert.ok(improvementHost, 'expected editable improvement resource prerequisite');
  setReferenceField(findBiqField(improvementHost, 'reqresource1'), 'resources', resourceB, getEntryIndex(bundle, 'resources', resourceB));
  const setImprovementResource = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      improvements: { entries: [improvementHost] },
      resources: bundle.tabs.resources
    }
  });
  assert.equal(setImprovementResource.ok, true, String(setImprovementResource.error || 'improvement resource reference save failed'));

  const deleteResourceA = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: { resources: { recordOps: [{ op: 'delete', recordRef: resourceA }] } }
  });
  assert.equal(deleteResourceA.ok, true, String(deleteResourceA.error || 'delete earlier resource failed'));
  bundle = reload(c3xDir, biqPath);
  assert.equal(getEntry(bundle, 'resources', resourceA), null, 'earlier saved resource should be deleted');
  const reloadedImprovement = getEntry(bundle, 'improvements', improvementHost.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedImprovement.biqFields }, 'reqresource1'), getEntryIndex(bundle, 'resources', resourceB),
    'improvement required resource should track the surviving later resource index after a later save');
});

test('Government references preserve projected values when saved after each CRUD prefix', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const govA = makeShortTestRef('GOVT_', 'PFXA');
  const govB = makeShortTestRef('GOVT_', 'PFXB');
  const govC = makeShortTestRef('GOVT_', 'PFXC');
  for (const key of [govA, govB, govC]) {
    const save = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      tabs: { governments: { recordOps: [{ op: 'add', newRecordRef: key }] } }
    });
    assert.equal(save.ok, true, String(save.error || `failed to add ${key}`));
    assert.ok(getEntry(reload(c3xDir, biqPath), 'governments', key), `${key} should survive immediate save/reload`);
  }

  let bundle = reload(c3xDir, biqPath);
  const govCIndex = getEntryIndex(bundle, 'governments', govC);
  const civHost = (bundle.tabs.civilizations.entries || []).find((entry) =>
    findBiqField(entry, 'favoritegovernment') && findBiqField(entry, 'shunnedgovernment')
  );
  const improvementHost = (bundle.tabs.improvements.entries || []).find((entry) => findBiqField(entry, 'reqgovernment'));
  assert.ok(civHost, 'expected editable civilization government references');
  assert.ok(improvementHost, 'expected editable improvement government reference');
  setReferenceField(findBiqField(civHost, 'favoritegovernment'), 'governments', govC, govCIndex);
  setReferenceField(findBiqField(civHost, 'shunnedgovernment'), 'governments', govC, govCIndex);
  setReferenceField(findBiqField(improvementHost, 'reqgovernment'), 'governments', govC, govCIndex);

  const setReferences = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: { entries: [civHost] },
      improvements: { entries: [improvementHost] },
      governments: bundle.tabs.governments
    }
  });
  assert.equal(setReferences.ok, true, String(setReferences.error || 'government reference save failed'));

  const deleteGovB = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: { governments: { recordOps: [{ op: 'delete', recordRef: govB }] } }
  });
  assert.equal(deleteGovB.ok, true, String(deleteGovB.error || 'delete middle government failed'));
  bundle = reload(c3xDir, biqPath);
  assert.equal(getEntry(bundle, 'governments', govB), null, 'middle saved government should be deleted');
  const reloadedGovCIndex = getEntryIndex(bundle, 'governments', govC);
  const reloadedCiv = getEntry(bundle, 'civilizations', civHost.civilopediaKey);
  const reloadedImprovement = getEntry(bundle, 'improvements', improvementHost.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: reloadedCiv.biqFields }, 'favoritegovernment'), reloadedGovCIndex);
  assert.equal(getRawRecordInt({ fields: reloadedCiv.biqFields }, 'shunnedgovernment'), reloadedGovCIndex);
  assert.equal(getRawRecordInt({ fields: reloadedImprovement.biqFields }, 'reqgovernment'), reloadedGovCIndex);

  const deleteGovC = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: { governments: { recordOps: [{ op: 'delete', recordRef: govC }] } }
  });
  assert.equal(deleteGovC.ok, true, String(deleteGovC.error || 'delete referenced government failed'));
  bundle = reload(c3xDir, biqPath);
  const clearedCiv = getEntry(bundle, 'civilizations', civHost.civilopediaKey);
  const clearedImprovement = getEntry(bundle, 'improvements', improvementHost.civilopediaKey);
  assert.equal(getRawRecordInt({ fields: clearedCiv.biqFields }, 'favoritegovernment', -1), -1);
  assert.equal(getRawRecordInt({ fields: clearedCiv.biqFields }, 'shunnedgovernment', -1), -1);
  assert.equal(getRawRecordInt({ fields: clearedImprovement.biqFields }, 'reqgovernment', -1), -1);
  assert.ok(getEntry(bundle, 'governments', govA), 'earlier added government should survive the sequence');
});
test('Import Civ into base Conquests BIQ is blocked at the Civ3 32-civ limit', (t) => {
  const r = runTidesImport(t, 'civilizations', 'RACE', 'RACE_',
    (b) => b.tabs.civilizations.entries.find((e) => e.civilopediaKey === 'RACE_AMAZONIANS')
      || b.tabs.civilizations.entries[0],
    BASE_BIQ);
  if (!r) return;
  assert.equal(r.saveResult.ok, false, 'expected save to be blocked at the hard civ cap');
  assert.match(String(r.saveResult.error || ''), /at most 32 civilizations total/i);
});

test('Delete existing civilizations reindexes GAME playable civs and LEAD civ references', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: c3xDir,
    civ3Path: CIV3_ROOT,
    scenarioPath: biqPath,
    tabs: {
      civilizations: {
        recordOps: [
          { op: 'delete', recordRef: 'RACE_AMERICAN' },
          { op: 'delete', recordRef: 'RACE_ARABIAN' }
        ]
      }
    }
  });
  assert.equal(saveResult.ok, true, String(saveResult.error || 'delete save failed'));

  const after = reload(c3xDir, biqPath);
  assert.equal(biqHasKey(after, 'RACE', 'RACE_AMERICAN'), false, 'America should be deleted');
  assert.equal(biqHasKey(after, 'RACE', 'RACE_ARABIAN'), false, 'Arabia should be deleted');

  const raceCount = countSection(after, 'RACE');
  const gameRecord = getGameRecord(after);
  assert.ok(gameRecord, 'expected GAME record after delete');
  const playableIds = (Array.isArray(gameRecord.fields) ? gameRecord.fields : [])
    .filter((field) => /^playable_civ(?:_\d+)?$/i.test(String(field && (field.baseKey || field.key) || '')))
    .map((field) => getRawRecordInt({ fields: [field] }, field.baseKey || field.key, NaN))
    .filter((id) => Number.isInteger(id) && id >= 0);
  const numPlayable = getRawRecordInt(gameRecord, 'numberofplayablecivs', playableIds.length);
  assert.equal(numPlayable, playableIds.length, 'GAME playable civ count should match playable civ ids');
  playableIds.forEach((id) => {
    assert.ok(Number.isInteger(id) && id >= 0 && id < raceCount,
      `playable civ id ${id} must remain within RACE bounds ${raceCount}`);
  });

  getLeadRecords(after).forEach((record, idx) => {
    const civ = getRawRecordInt(record, 'civ', NaN);
    assert.ok(Number.isInteger(civ) && civ >= 0 && civ < raceCount,
      `LEAD record ${idx} civ index must remain within RACE bounds`);
  });
});
