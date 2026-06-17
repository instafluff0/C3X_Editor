'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunctionSource(sourceText, name) {
  const needle = `function ${name}(`;
  const start = sourceText.indexOf(needle);
  if (start < 0) {
    throw new Error(`Could not find function ${name} in renderer.js`);
  }
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
  if (signatureEnd < 0) {
    throw new Error(`Could not find parameter list end for function ${name}`);
  }
  const bodyStart = sourceText.indexOf('{', signatureEnd);
  if (bodyStart < 0) {
    throw new Error(`Could not find body for function ${name}`);
  }
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
  if (end < 0) {
    throw new Error(`Could not determine end of function ${name}`);
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
        const next = String(value || '');
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
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-import-helpers.vm' });
  return sandbox.__helpers;
}

function makeField(baseKey, value, extra = {}) {
  return {
    baseKey,
    key: baseKey,
    value: String(value),
    originalValue: String(value),
    editable: true,
    ...extra
  };
}

function makeEntry(civilopediaKey, biqIndex) {
  return { civilopediaKey, biqIndex, name: civilopediaKey };
}

test('unit import remaps mutual references by civilopedia key and filters non-matches', () => {
  const targetBundle = {
    tabs: {
      civilizations: {
        entries: [
          makeEntry('RACE_ALPHA', 5),
          makeEntry('RACE_GAMMA', 7)
        ]
      },
      technologies: {
        entries: [
          makeEntry('TECH_ALPHA', 13)
        ]
      },
      resources: {
        entries: [
          makeEntry('GOOD_ALPHA', 17)
        ]
      },
      units: {
        entries: [
          makeEntry('PRTO_ALPHA', 10),
          makeEntry('PRTO_GAMMA', 22)
        ]
      },
      improvements: {
        entries: [
          makeEntry('BLDG_ALPHA', 9)
        ]
      }
    }
  };
  const { buildNewReferenceEntryFromTemplate, decodeAvailableToIndices } = loadRendererImportHelpers(targetBundle);

  const sourceEntry = {
    civilopediaKey: 'PRTO_SOURCE',
    biqIndex: 99,
    name: 'Imported Unit',
    _importReferenceIndexMaps: {
      civilizations: [
        { index: 1, civilopediaKey: 'RACE_ALPHA' },
        { index: 2, civilopediaKey: 'RACE_BETA' },
        { index: 3, civilopediaKey: 'RACE_GAMMA' }
      ],
      technologies: [
        { index: 21, civilopediaKey: 'TECH_ALPHA' }
      ],
      resources: [
        { index: 31, civilopediaKey: 'GOOD_ALPHA' }
      ],
      units: [
        { index: 4, civilopediaKey: 'PRTO_ALPHA' },
        { index: 5, civilopediaKey: 'PRTO_BETA' },
        { index: 6, civilopediaKey: 'PRTO_GAMMA' }
      ],
      improvements: [
        { index: 11, civilopediaKey: 'BLDG_ALPHA' },
        { index: 12, civilopediaKey: 'BLDG_BETA' }
      ]
    },
    biqFields: [
      makeField('civilopediaentry', 'PRTO_SOURCE', { editable: false }),
      makeField('availableto', '-1'),
      makeField('requiredtech', '21'),
      makeField('requiredresource1', '31'),
      makeField('upgradeto', '4'),
      makeField('enslaveresultsin', '6'),
      makeField('numstealthtargets', '3'),
      makeField('stealth_target', '4'),
      makeField('stealth_target', '5', { key: 'stealth_target_2' }),
      makeField('stealth_target', '6', { key: 'stealth_target_3' }),
      makeField('numlegalunittelepads', '2'),
      makeField('legal_unit_telepad', '4'),
      makeField('legal_unit_telepad', '5', { key: 'legal_unit_telepad_2' }),
      makeField('numlegalbuildingtelepads', '2'),
      makeField('legal_building_telepad', '11'),
      makeField('legal_building_telepad', '12', { key: 'legal_building_telepad_2' })
    ]
  };
  sourceEntry.biqFields.find((field) => field.baseKey === 'availableto').value = String((1 << 1) | (1 << 2) | (1 << 3));

  const imported = buildNewReferenceEntryFromTemplate({
    tabKey: 'units',
    sourceEntry,
    civilopediaKey: 'PRTO_IMPORTED',
    mode: 'import',
    displayName: 'Imported Unit'
  });

  const byBaseKey = (key) => imported.biqFields.filter((field) => field.baseKey === key);
  const availableTo = imported.biqFields.find((field) => field.baseKey === 'availableto');

  assert.deepEqual(Array.from(decodeAvailableToIndices(availableTo.value)), [5, 7]);
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'requiredtech').value, '13');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'requiredresource1').value, '17');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'upgradeto').value, '10');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'enslaveresultsin').value, '22');
  assert.deepEqual(
    Array.from(byBaseKey('stealth_target'), (field) => field.value).filter(Boolean),
    ['10', '22']
  );
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'numstealthtargets').value, '2');
  assert.deepEqual(
    Array.from(byBaseKey('legal_unit_telepad'), (field) => field.value).filter(Boolean),
    ['10']
  );
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'numlegalunittelepads').value, '1');
  assert.deepEqual(
    Array.from(byBaseKey('legal_building_telepad'), (field) => field.value).filter(Boolean),
    ['9']
  );
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'numlegalbuildingtelepads').value, '1');
});

test('unit import clears orphaned list references and zeroes count fields when nothing matches', () => {
  const targetBundle = {
    tabs: {
      civilizations: { entries: [makeEntry('RACE_ALPHA', 5)] },
      technologies: { entries: [] },
      resources: { entries: [] },
      units: { entries: [makeEntry('PRTO_ALPHA', 10)] },
      improvements: { entries: [makeEntry('BLDG_ALPHA', 9)] }
    }
  };
  const { buildNewReferenceEntryFromTemplate, decodeAvailableToIndices } = loadRendererImportHelpers(targetBundle);

  const sourceEntry = {
    civilopediaKey: 'PRTO_SOURCE',
    biqIndex: 12,
    name: 'Imported Unit',
    _importReferenceIndexMaps: {
      civilizations: [{ index: 1, civilopediaKey: 'RACE_BETA' }],
      technologies: [{ index: 21, civilopediaKey: 'TECH_BETA' }],
      resources: [{ index: 31, civilopediaKey: 'GOOD_BETA' }],
      units: [{ index: 4, civilopediaKey: 'PRTO_BETA' }],
      improvements: [{ index: 11, civilopediaKey: 'BLDG_BETA' }]
    },
    biqFields: [
      makeField('civilopediaentry', 'PRTO_SOURCE', { editable: false }),
      makeField('availableto', String(1 << 1)),
      makeField('requiredtech', '21'),
      makeField('requiredresource1', '31'),
      makeField('upgradeto', '4'),
      makeField('enslaveresultsin', '4'),
      makeField('numstealthtargets', '1'),
      makeField('stealth_target', '4'),
      makeField('numlegalunittelepads', '1'),
      makeField('legal_unit_telepad', '4'),
      makeField('numlegalbuildingtelepads', '1'),
      makeField('legal_building_telepad', '11')
    ]
  };

  const imported = buildNewReferenceEntryFromTemplate({
    tabKey: 'units',
    sourceEntry,
    civilopediaKey: 'PRTO_IMPORTED',
    mode: 'import',
    displayName: 'Imported Unit'
  });

  assert.equal(Array.from(decodeAvailableToIndices(imported.biqFields.find((field) => field.baseKey === 'availableto').value)).length, 0);
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'requiredtech').value, 'None');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'requiredresource1').value, 'None');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'upgradeto').value, 'None');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'enslaveresultsin').value, 'None');
  assert.equal(
    imported.biqFields.filter((field) => field.baseKey === 'stealth_target').map((field) => field.value).filter(Boolean).length,
    0
  );
  assert.deepEqual(
    Array.from(imported.biqFields.filter((field) => field.baseKey === 'stealth_target').map((field) => field.originalValue).filter(Boolean)),
    ['4']
  );
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'numstealthtargets').value, '0');
  assert.equal(
    imported.biqFields.filter((field) => field.baseKey === 'legal_unit_telepad').map((field) => field.value).filter(Boolean).length,
    0
  );
  assert.deepEqual(
    Array.from(imported.biqFields.filter((field) => field.baseKey === 'legal_unit_telepad').map((field) => field.originalValue).filter(Boolean)),
    ['4']
  );
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'numlegalunittelepads').value, '0');
  assert.equal(
    imported.biqFields.filter((field) => field.baseKey === 'legal_building_telepad').map((field) => field.value).filter(Boolean).length,
    0
  );
  assert.deepEqual(
    Array.from(imported.biqFields.filter((field) => field.baseKey === 'legal_building_telepad').map((field) => field.originalValue).filter(Boolean)),
    ['11']
  );
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'numlegalbuildingtelepads').value, '0');
});

test('unit import falls back to name-based matching for stealth targets without civilopedia keys', () => {
  const targetBundle = {
    tabs: {
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      units: {
        entries: [
          makeEntry('PRTO_ALPHA', 10),
          { civilopediaKey: '', biqIndex: 15, name: 'Hunter' },
          { civilopediaKey: '', biqIndex: 20, name: 'Villager' }
        ]
      },
      improvements: { entries: [] }
    }
  };
  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers(targetBundle);

  const sourceEntry = {
    civilopediaKey: 'PRTO_SOURCE',
    biqIndex: 99,
    name: 'Imported Unit',
    _importReferenceIndexMaps: {
      civilizations: [],
      technologies: [],
      resources: [],
      units: [
        { index: 4, civilopediaKey: 'PRTO_ALPHA', name: 'Alpha' },
        { index: 5, civilopediaKey: '', name: 'Hunter' },
        { index: 6, civilopediaKey: '', name: 'Villager' },
        { index: 7, civilopediaKey: '', name: 'Ambiguous' },
        { index: 8, civilopediaKey: '', name: 'Ambiguous' }
      ],
      improvements: []
    },
    biqFields: [
      makeField('civilopediaentry', 'PRTO_SOURCE', { editable: false }),
      makeField('numstealthtargets', '5'),
      makeField('stealth_target', '4'),
      makeField('stealth_target', '5'),
      makeField('stealth_target', '6'),
      makeField('stealth_target', '7'),
      makeField('stealth_target', '8')
    ]
  };

  const imported = buildNewReferenceEntryFromTemplate({
    tabKey: 'units',
    sourceEntry,
    civilopediaKey: 'PRTO_IMPORTED',
    mode: 'import',
    displayName: 'Imported Unit'
  });

  const stealthValues = imported.biqFields
    .filter((f) => f.baseKey === 'stealth_target')
    .map((f) => f.value)
    .filter(Boolean);
  // PRTO_ALPHA matched by civkey -> 10; Hunter matched by name -> 15; Villager matched by name -> 20
  // Ambiguous (indices 7 and 8) dropped because name is duplicated in target (no, actually target has no Ambiguous)
  // so indices 7 and 8 have name 'Ambiguous', target has no unit named 'Ambiguous' -> dropped
  assert.deepEqual(Array.from(stealthValues).sort(), ['10', '15', '20'].sort());
  assert.equal(imported.biqFields.find((f) => f.baseKey === 'numstealthtargets').value, '3');
});
