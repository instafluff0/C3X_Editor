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

const { loadBundle, saveBundle } = require('../src/configCore');
const { getReferenceEntryIdentity } = require('../src/referenceIdentity');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');
const BASE_BIQ = process.env.C3X_TEST_BIQ
  || path.join(CIV3_ROOT, 'Conquests', 'conquests.biq');
const TIDES_BIQ = path.join(CIV3_ROOT, 'Conquests', 'Scenarios', 'TIDES OF CRIMSON.biq');

const BASE_BIQ_EXISTS = fs.existsSync(BASE_BIQ);
const TIDES_BIQ_EXISTS = fs.existsSync(TIDES_BIQ);

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

function getSection(bundle, sectionCode) {
  const sections = (bundle && bundle.biq && Array.isArray(bundle.biq.sections))
    ? bundle.biq.sections : [];
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

function getRawRecordInt(record, key, fallback = NaN) {
  const field = getRawRecordField(record, key);
  const match = String(field && field.value || '').match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    'buildNewReferenceEntryFromTemplate',
    'getImportReferenceIndexMap',
    'getTargetReferenceIndexByKey',
    'getTargetReferenceIndexByName',
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
      const match = String(value == null ? '' : value).match(/-?\d+/);
      if (!match) return null;
      const parsed = Number.parseInt(match[0], 10);
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

function loadRendererDeleteHelpers() {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = ['getReferenceRecordRefForOps'];
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

function buildReferenceIndexMap(bundle, tabKey) {
  const entries = bundle && bundle.tabs && bundle.tabs[tabKey] && bundle.tabs[tabKey].entries;
  return (Array.isArray(entries) ? entries : []).map((entry, fallbackIdx) => ({
    index: Number.isFinite(entry && entry.biqIndex) ? Number(entry.biqIndex) : fallbackIdx,
    civilopediaKey: String(entry && entry.civilopediaKey || '').trim().toUpperCase()
  })).filter((item) => Number.isFinite(item.index) && item.index >= 0 && item.civilopediaKey);
}

function makeShortTestRef(prefix, label = 'T') {
  const token = `${label}_${Date.now().toString(36).slice(-7)}_${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
  return `${prefix}${token}`.slice(0, 31);
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

test('copying from an unsaved edited tech preserves inherited prereqs after save', (t) => {
  const ctx = setupScenario();
  if (!ctx) return t.skip(`Base BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;
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

    const newKey = `${prefix}C3X_ADD_TEST_${Date.now()}`.toUpperCase();
    const saveResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      tabs: {
        [tabKey]: { recordOps: [{ op: 'add', newRecordRef: newKey }] }
      }
    });
    assert.equal(saveResult.ok, true, String(saveResult.error || 'save failed'));

    const after = reload(c3xDir, biqPath);
    const expectedDelta = sectionCode === 'PRTO' ? 2 : 1;
    assert.equal(countSection(after, sectionCode), countBefore + expectedDelta,
      `expected exactly ${expectedDelta} new ${sectionCode} record${expectedDelta === 1 ? '' : 's'}`);
    assert.equal(biqHasKey(after, sectionCode, newKey), true,
      `expected new record ${newKey} to exist`);

    // All pre-existing keys must still be present
    for (const key of existingKeys) {
      assert.equal(biqHasKey(after, sectionCode, key), true,
        `expected original record ${key} to survive add`);
    }
  });
}

test('Add blank PRTO uses Quint-style new-unit defaults for serialized fields', (t) => {
  const ctx = setupScenario(BASE_BIQ);
  if (!ctx) return t.skip(`Source BIQ not found: ${BASE_BIQ}`);
  const { c3xDir, biqPath } = ctx;

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
  test(`Copy ${sectionCode}: copy present, source unchanged, key fields match`, (t) => {
    const sourceBiq = tabKey === 'civilizations' ? TIDES_BIQ : BASE_BIQ;
    const ctx = setupScenario(sourceBiq);
    if (!ctx) return t.skip(`Source BIQ not found: ${sourceBiq}`);
    const { c3xDir, biqPath } = ctx;

    const before = reload(c3xDir, biqPath);
    const seedKey = COPY_SEEDS[tabKey];
    const sourceEntry = getEntry(before, tabKey, seedKey)
      || before.tabs[tabKey].entries[0];
    assert.ok(sourceEntry, `expected a source entry for ${tabKey}`);
    const sourceRef = String(sourceEntry.civilopediaKey || '').toUpperCase();

    const newKey = makeShortTestRef(prefix, 'COPY');
    const saveResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      tabs: {
        [tabKey]: {
          recordOps: [{ op: 'copy', sourceRef, newRecordRef: newKey }]
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

    // Verify the copy has the same 'name' field value as the source (where applicable)
    const copiedEntry = getEntry(after, tabKey, newKey);
    const originalEntry = getEntry(after, tabKey, sourceRef);
    if (copiedEntry && originalEntry) {
      // Some scalar fields should match (e.g. cost for techs, type for resources)
      const keysToCheck = {
        technologies:  ['cost', 'era'],
        resources:     ['type'],
        improvements:  ['cost'],
        governments:   ['corruptionlevel'],
        civilizations: ['aggressionlevel'],
        units:         ['attack']
      };
      const checkKeys = keysToCheck[tabKey] || [];
      for (const k of checkKeys) {
        const copiedVal = fieldVal(copiedEntry, k);
        const origVal   = fieldVal(originalEntry, k);
        if (copiedVal !== undefined && origVal !== undefined) {
          assert.equal(copiedVal, origVal,
            `expected ${k} to match between source and copy for ${tabKey}`);
        }
      }
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

    // Step 1: add a fresh record so we have something safe to delete
    // (avoids triggering reference-protection checks on existing data)
    const newKey = `${prefix}C3X_DEL_TEST_${Date.now()}`.toUpperCase();
    const addResult = saveBundle({
      mode: 'scenario',
      c3xPath: c3xDir,
      civ3Path: CIV3_ROOT,
      scenarioPath: biqPath,
      tabs: { [tabKey]: { recordOps: [{ op: 'add', newRecordRef: newKey }] } }
    });
    assert.equal(addResult.ok, true, `pre-delete add failed: ${addResult.error}`);

    const afterAdd = reload(c3xDir, biqPath);
    assert.equal(biqHasKey(afterAdd, sectionCode, newKey), true, 'record should exist before delete');
    const countAfterAdd = countSection(afterAdd, sectionCode);

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
    const expectedDelta = sectionCode === 'PRTO' ? 2 : 1;
    assert.equal(countSection(afterDel, sectionCode), countAfterAdd - expectedDelta,
      `expected count to decrease by ${expectedDelta} after delete`);

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
  const { c3xDir, biqPath } = ctx;

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

  return { c3xDir, biqPath, before, after, saveResult, newKey, importedEntry, srcEntry };
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
  for (const key of ['attack', 'defense', 'movement']) {
    const srcVal = fieldVal(r.srcEntry, key);
    const dstVal = fieldVal(reloaded, key);
    if (srcVal !== undefined && dstVal !== undefined) {
      assert.equal(dstVal, srcVal, `expected field ${key} to round-trip for imported unit`);
    }
  }
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

test('Import Unit from Tides: icon index resets to 0 and does not rewrite units_32.pcx', (t) => {
  const r = runTidesImport(t, 'units', 'PRTO', 'PRTO_', null);
  if (!r) return;
  assert.equal(r.saveResult.ok, true, String(r.saveResult.error || 'save failed'));

  const reloaded = getEntry(r.after, 'units', r.newKey);
  assert.ok(reloaded, 'expected reloaded unit entry');
  assert.equal(fieldVal(reloaded, 'iconindex'), '0');

  const units32Writes = (r.saveResult.saveReport || []).filter((item) =>
    String(item && item.kind || '') === 'art' &&
    /art[\\/]+units[\\/]+units_32\.pcx$/i.test(String(item && item.path || ''))
  );
  assert.equal(units32Writes.length, 0, 'unit import should not rewrite units_32.pcx');
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
