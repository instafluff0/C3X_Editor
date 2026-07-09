'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  DELETE_REFERENCE_INVENTORY,
  IMPORT_REFERENCE_INVENTORY
} = require('./referenceCrudInventory');
const {
  GENERATED_IMPORT_REFERENCE_INVENTORY,
  GENERATED_DELETE_REFERENCE_INVENTORY,
  makeImportSignature,
  makeDeleteSignature
} = require('./referenceCrudGeneratedInventory');

function extractFunctionSource(sourceText, name) {
  const needle = `function ${name}(`;
  const start = sourceText.indexOf(needle);
  if (start < 0) throw new Error(`Could not find function ${name} in renderer.js`);
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
    'getTargetReferenceEntries',
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
    'normalizeImportedRuleReferenceFields',
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
  vm.runInNewContext(scriptSource, sandbox, { filename: 'reference-crud-inventory.vm' });
  return sandbox.__helpers;
}

function makeEntry(civilopediaKey, biqIndex, name = civilopediaKey) {
  return { civilopediaKey, biqIndex, name };
}

function makeField(baseKey, value, extra = {}) {
  return {
    baseKey,
    key: baseKey,
    label: baseKey,
    value: String(value),
    originalValue: String(value),
    editable: true,
    ...extra
  };
}

function listCountFieldFor(baseKey) {
  if (baseKey === 'stealth_target') return 'numstealthtargets';
  if (baseKey === 'legal_unit_telepad') return 'numlegalunittelepads';
  if (baseKey === 'legal_building_telepad') return 'numlegalbuildingtelepads';
  return '';
}

function buildSourceEntryForImportCase(item) {
  if (item.kind === 'bitmask') {
    return {
      civilopediaKey: 'PRTO_SOURCE',
      name: 'Imported Entry',
      _importReferenceIndexMaps: {
        [item.sourceTabKey]: [{ index: 5, civilopediaKey: 'REF_KEEP', name: 'Keep' }]
      },
      biqFields: [
        makeField('civilopediaentry', 'PRTO_SOURCE', { editable: false }),
        makeField(item.field, String(1 << 5))
      ]
    };
  }
  if (item.kind === 'relation-table') {
    return {
      civilopediaKey: 'GOVT_SOURCE',
      name: 'Imported Entry',
      _importReferenceIndexMaps: {
        governments: [{ index: 5, civilopediaKey: 'REF_KEEP', name: 'Keep' }]
      },
      biqFields: [
        makeField('civilopediaentry', 'GOVT_SOURCE', { editable: false }),
        makeField('performance_of_this_government_versus_government_5', 'Keep', { editable: false }),
        makeField('canbribe', '1'),
        makeField('resistancemodifier', '2'),
        makeField('briberymodifier', '3')
      ]
    };
  }
  if (item.kind === 'list') {
    const countField = listCountFieldFor(item.field);
    return {
      civilopediaKey: 'PRTO_SOURCE',
      name: 'Imported Entry',
      _importReferenceIndexMaps: {
        [item.sourceTabKey]: [{ index: 5, civilopediaKey: 'REF_KEEP', name: 'Keep' }]
      },
      biqFields: [
        makeField('civilopediaentry', 'PRTO_SOURCE', { editable: false }),
        makeField(countField, '1'),
        makeField(item.field, '5')
      ]
    };
  }
  return {
    civilopediaKey: 'REF_SOURCE',
    name: 'Imported Entry',
    _importReferenceIndexMaps: {
      [item.sourceTabKey]: [{ index: 5, civilopediaKey: 'REF_KEEP', name: 'Keep' }]
    },
    biqFields: [
      makeField('civilopediaentry', 'REF_SOURCE', { editable: false }),
      makeField(item.field, '5')
    ]
  };
}

function buildTargetBundleForImportCase(item) {
  const tabs = {
    civilizations: { entries: [] },
    technologies: { entries: [] },
    resources: { entries: [] },
    improvements: { entries: [] },
    governments: { entries: [] },
    units: { entries: [] },
    rules: { sections: [] }
  };
  const makeRuleSection = (code, entry) => ({ code, records: [entry] });
  if (item.kind === 'relation-table') {
    tabs.governments.entries = [makeEntry('REF_KEEP', 11, 'Keep')];
    return { tabs };
  }
  const targetTabKey = item.targetTabKey;
  if (targetTabKey === 'eras') tabs.rules.sections.push(makeRuleSection('ERAS', makeEntry('REF_KEEP', 11, 'Keep')));
  else if (targetTabKey === 'difficulties') tabs.rules.sections.push(makeRuleSection('DIFF', makeEntry('REF_KEEP', 11, 'Keep')));
  else if (targetTabKey === 'espionage') tabs.rules.sections.push(makeRuleSection('ESPN', makeEntry('REF_KEEP', 11, 'Keep')));
  else if (targetTabKey === 'workerActions') tabs.rules.sections.push(makeRuleSection('TFRM', makeEntry('REF_KEEP', 11, 'Keep')));
  else if (targetTabKey === 'terrainPedia') tabs.rules.sections.push(makeRuleSection('TERR', makeEntry('REF_KEEP', 11, 'Keep')));
  else tabs[targetTabKey].entries = [makeEntry('REF_KEEP', 11, 'Keep')];
  return { tabs };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCamelLike(value) {
  const text = String(value || '').trim();
  if (!text) return text;
  return text
    .replace(/[_-]+([a-z0-9])/gi, (_m, ch) => String(ch || '').toUpperCase())
    .replace(/^([A-Z])/, (m) => m.toLowerCase());
}

test('reference CRUD inventory ids are unique and gaps are explicit', () => {
  const ids = new Set();
  [...DELETE_REFERENCE_INVENTORY, ...IMPORT_REFERENCE_INVENTORY].forEach((item) => {
    assert.ok(item && item.id, 'every inventory entry must have an id');
    assert.equal(ids.has(item.id), false, `duplicate inventory id: ${item.id}`);
    ids.add(item.id);
    if (item.status === 'gap') {
      assert.ok(String(item.reason || '').trim(), `gap entry ${item.id} must document a reason`);
    }
  });
});

test('delete inventory fields are wired in normalizeDeletedReferenceSections', () => {
  const sourceText = fs.readFileSync(path.join(__dirname, '..', 'src', 'biq', 'biqSections.js'), 'utf8');
  const start = sourceText.indexOf('function normalizeDeletedReferenceSections(');
  const end = sourceText.indexOf('function buildMapSectionRecordFromUi(', start);
  const body = sourceText.slice(start, end);
  const normalizedBody = body.toLowerCase();
  DELETE_REFERENCE_INVENTORY.filter((item) => item.status !== 'gap').forEach((item) => {
    const patterns = new Set([
      String(item.field || ''),
      toCamelLike(item.field)
    ].filter(Boolean));
    if (String(item.field || '').toLowerCase() === 'playable_civ') patterns.add('playableCivIds');
    const matched = Array.from(patterns).some((pattern) => normalizedBody.includes(String(pattern).toLowerCase()));
    assert.equal(matched, true, `expected delete cascade wiring for ${item.id}`);
  });
});

test('generated metadata-backed CRUD reference families are all inventoried', () => {
  const importSignatures = new Set(IMPORT_REFERENCE_INVENTORY.map((item) => makeImportSignature(item)));
  GENERATED_IMPORT_REFERENCE_INVENTORY.forEach((item) => {
    assert.equal(importSignatures.has(makeImportSignature(item)), true,
      `missing import inventory coverage declaration for ${item.tabKey}.${item.field}`);
  });

  const deleteSignatures = new Set(DELETE_REFERENCE_INVENTORY.map((item) => makeDeleteSignature(item)));
  GENERATED_DELETE_REFERENCE_INVENTORY.forEach((item) => {
    assert.equal(deleteSignatures.has(makeDeleteSignature(item)), true,
      `missing delete inventory coverage declaration for ${item.sectionCode}.${item.field}`);
  });
});

for (const item of IMPORT_REFERENCE_INVENTORY.filter((entry) => entry.status === 'covered')) {
  test(`import inventory covered: ${item.id}`, () => {
    const targetBundle = buildTargetBundleForImportCase(item);
    const sourceEntry = buildSourceEntryForImportCase(item);
    const { buildNewReferenceEntryFromTemplate, decodeAvailableToIndices } = loadRendererImportHelpers(targetBundle);
    const imported = buildNewReferenceEntryFromTemplate({
      tabKey: item.tabKey,
      sourceEntry,
      civilopediaKey: 'IMPORTED_REF',
      mode: 'import',
      displayName: 'Imported Entry'
    });
    if (item.kind === 'bitmask') {
      const field = imported.biqFields.find((entry) => entry.baseKey === item.field);
      assert.deepEqual(Array.from(decodeAvailableToIndices(field.value)), [11]);
      return;
    }
    if (item.kind === 'relation-table') {
      const header = imported.biqFields.find((field) => field.baseKey === 'performance_of_this_government_versus_government_11');
      assert.ok(header, `expected remapped relation header for ${item.id}`);
      const values = imported.biqFields
        .filter((field) => field.baseKey === 'canbribe' || field.baseKey === 'resistancemodifier' || field.baseKey === 'briberymodifier')
        .map((field) => field.value);
      assert.deepEqual(Array.from(values.slice(0, 3)), ['1', '2', '3']);
      assert.equal(values.length % 3, 0, 'relation rows should serialize as canbribe/resistance/bribery triples');
      assert.deepEqual(Array.from(values.slice(3)), Array(values.length - 3).fill('0'));
      return;
    }
    if (item.kind === 'list') {
      const values = imported.biqFields
        .filter((field) => field.baseKey === item.field)
        .map((field) => field.value)
        .filter(Boolean);
      assert.deepEqual(Array.from(values), ['11']);
      const countField = imported.biqFields.find((field) => field.baseKey === listCountFieldFor(item.field));
      assert.equal(String(countField && countField.value || ''), '1');
      return;
    }
    const field = imported.biqFields.find((entry) => entry.baseKey === item.field);
    assert.ok(field, `expected field ${item.field} on imported entry`);
    assert.equal(String(field.value), '11');
  });
}

test('covered import inventory fields are wired in normalizeImportedReferenceFields', () => {
  const sourceText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const start = sourceText.indexOf('function normalizeImportedReferenceFields(');
  const end = sourceText.indexOf('async function promptReferenceCreateAction(', start);
  const body = sourceText.slice(start, end);
  IMPORT_REFERENCE_INVENTORY
    .filter((item) => item.status === 'covered')
    .forEach((item) => {
      assert.match(body, new RegExp(String(item.tabKey)), `expected import tab wiring for ${item.id}`);
    });
});
