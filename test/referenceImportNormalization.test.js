'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-reference-import.vm' });
  return sandbox.__helpers;
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

function makeEntry(civilopediaKey, biqIndex, name = civilopediaKey) {
  return { civilopediaKey, biqIndex, name };
}

function buildImportedEntry(targetBundle, tabKey, sourceEntry, civilopediaKey) {
  const { buildNewReferenceEntryFromTemplate } = loadRendererImportHelpers(targetBundle);
  return buildNewReferenceEntryFromTemplate({
    tabKey,
    sourceEntry,
    civilopediaKey,
    mode: 'import',
    displayName: String(sourceEntry && sourceEntry.name || '')
  });
}

test('technology import remaps prerequisite tech indices by civilopedia key', () => {
  const targetBundle = {
    tabs: {
      technologies: {
        entries: [
          makeEntry('TECH_ALPHA', 10),
          makeEntry('TECH_GAMMA', 12)
        ]
      },
      rules: {
        sections: [{
          code: 'ERAS',
          records: [
            makeEntry('ERA_ALPHA', 4),
            makeEntry('ERA_GAMMA', 7)
          ]
        }]
      }
    }
  };

  const imported = buildImportedEntry(targetBundle, 'technologies', {
    civilopediaKey: 'TECH_SOURCE',
    biqIndex: 40,
    name: 'Imported Tech',
    _importReferenceIndexMaps: {
      eras: [
        { index: 0, civilopediaKey: 'ERA_ALPHA', name: 'Alpha Era' },
        { index: 1, civilopediaKey: 'ERA_BETA', name: 'Beta Era' },
        { index: 2, civilopediaKey: 'ERA_GAMMA', name: 'Gamma Era' }
      ],
      technologies: [
        { index: 1, civilopediaKey: 'TECH_ALPHA' },
        { index: 2, civilopediaKey: 'TECH_BETA' },
        { index: 3, civilopediaKey: 'TECH_GAMMA' }
      ]
    },
    biqFields: [
      makeField('civilopediaentry', 'TECH_SOURCE', { editable: false }),
      makeField('era', '2'),
      makeField('prerequisite1', '1'),
      makeField('prerequisite2', '2'),
      makeField('prerequisite3', '3'),
      makeField('prerequisite4', '-1')
    ]
  }, 'TECH_IMPORTED');

  assert.equal(imported.biqFields.find((field) => field.baseKey === 'era').value, '7');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'prerequisite1').value, '10');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'prerequisite2').value, 'None');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'prerequisite3').value, '12');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'prerequisite4').value, 'None');
});

test('resource import remaps prerequisite technology by civilopedia key', () => {
  const targetBundle = {
    tabs: {
      technologies: {
        entries: [makeEntry('TECH_ALPHA', 7)]
      }
    }
  };

  const imported = buildImportedEntry(targetBundle, 'resources', {
    civilopediaKey: 'GOOD_SOURCE',
    biqIndex: 12,
    name: 'Imported Resource',
    _importReferenceIndexMaps: {
      technologies: [
        { index: 3, civilopediaKey: 'TECH_ALPHA' },
        { index: 4, civilopediaKey: 'TECH_BETA' }
      ]
    },
    biqFields: [
      makeField('civilopediaentry', 'GOOD_SOURCE', { editable: false }),
      makeField('prerequisite', '4')
    ]
  }, 'GOOD_IMPORTED');

  assert.equal(imported.biqFields.find((field) => field.baseKey === 'prerequisite').value, 'None');
});

test('civilization import remaps free techs, governments, and king unit by civilopedia key', () => {
  const targetBundle = {
    tabs: {
      technologies: {
        entries: [makeEntry('TECH_ALPHA', 6)]
      },
      governments: {
        entries: [makeEntry('GOVT_ALPHA', 3)]
      },
      units: {
        entries: [makeEntry('PRTO_ALPHA', 9)]
      }
    }
  };

  const imported = buildImportedEntry(targetBundle, 'civilizations', {
    civilopediaKey: 'RACE_SOURCE',
    biqIndex: 5,
    name: 'Imported Civ',
    _importReferenceIndexMaps: {
      technologies: [
        { index: 1, civilopediaKey: 'TECH_ALPHA' },
        { index: 2, civilopediaKey: 'TECH_BETA' }
      ],
      governments: [
        { index: 4, civilopediaKey: 'GOVT_ALPHA' },
        { index: 5, civilopediaKey: 'GOVT_BETA' }
      ],
      units: [
        { index: 7, civilopediaKey: 'PRTO_ALPHA' },
        { index: 8, civilopediaKey: 'PRTO_BETA' }
      ]
    },
    biqFields: [
      makeField('civilopediaentry', 'RACE_SOURCE', { editable: false }),
      makeField('freetech1index', '1'),
      makeField('freetech2index', '2'),
      makeField('favoritegovernment', '4'),
      makeField('shunnedgovernment', '5'),
      makeField('kingunit', '7')
    ]
  }, 'RACE_IMPORTED');

  assert.equal(imported.biqFields.find((field) => field.baseKey === 'freetech1index').value, '6');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'freetech2index').value, 'None');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'favoritegovernment').value, '3');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'shunnedgovernment').value, 'None');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'kingunit').value, '9');
});

test('government import remaps prerequisite technology and relation rows by civilopedia key', () => {
  const targetBundle = {
    tabs: {
      technologies: {
        entries: [makeEntry('TECH_ALPHA', 2)]
      },
      governments: {
        entries: [
          makeEntry('GOVT_ALPHA', 4, 'Alpha'),
          makeEntry('GOVT_GAMMA', 7, 'Gamma')
        ]
      }
    }
  };

  const imported = buildImportedEntry(targetBundle, 'governments', {
    civilopediaKey: 'GOVT_SOURCE',
    biqIndex: 8,
    name: 'Imported Government',
    _importReferenceIndexMaps: {
      technologies: [
        { index: 10, civilopediaKey: 'TECH_ALPHA' }
      ],
      governments: [
        { index: 0, civilopediaKey: 'GOVT_ALPHA' },
        { index: 1, civilopediaKey: 'GOVT_BETA' },
        { index: 2, civilopediaKey: 'GOVT_GAMMA' }
      ]
    },
    biqFields: [
      makeField('civilopediaentry', 'GOVT_SOURCE', { editable: false }),
      makeField('prerequisitetechnology', '10'),
      makeField('performance_of_this_government_versus_government_0', 'Alpha', { editable: false }),
      makeField('canbribe', '1'),
      makeField('resistancemodifier', '11'),
      makeField('briberymodifier', '21'),
      makeField('performance_of_this_government_versus_government_1', 'Beta', { editable: false }),
      makeField('canbribe', '2'),
      makeField('resistancemodifier', '12'),
      makeField('briberymodifier', '22'),
      makeField('performance_of_this_government_versus_government_2', 'Gamma', { editable: false }),
      makeField('canbribe', '3'),
      makeField('resistancemodifier', '13'),
      makeField('briberymodifier', '23')
    ]
  }, 'GOVT_IMPORTED');

  assert.equal(imported.biqFields.find((field) => field.baseKey === 'prerequisitetechnology').value, '2');
  const relationHeaders = imported.biqFields
    .filter((field) => /^performance_of_this_government_versus_government_\d+$/.test(String(field.baseKey || '')))
    .map((field) => field.baseKey);
  assert.deepEqual(Array.from(relationHeaders), [
    'performance_of_this_government_versus_government_4',
    'performance_of_this_government_versus_government_7',
    'performance_of_this_government_versus_government_8'
  ]);
  const relationValues = imported.biqFields
    .filter((field) => field.baseKey === 'canbribe' || field.baseKey === 'resistancemodifier' || field.baseKey === 'briberymodifier')
    .map((field) => field.value);
  assert.deepEqual(Array.from(relationValues), ['1', '11', '21', '3', '13', '23', '0', '0', '0']);
});

test('government import remaps immuneto by civilopedia key', () => {
  const targetBundle = {
    tabs: {
      rules: {
        sections: [{
          code: 'ESPN',
          records: [makeEntry('ESPN_ALPHA', 2)]
        }]
      }
    }
  };

  const imported = buildImportedEntry(targetBundle, 'governments', {
    civilopediaKey: 'GOVT_SOURCE',
    biqIndex: 9,
    name: 'Imported Government',
    _importReferenceIndexMaps: {
      espionage: [
        { index: 10, civilopediaKey: 'ESPN_ALPHA' },
        { index: 11, civilopediaKey: 'ESPN_BETA' }
      ]
    },
    biqFields: [
      makeField('civilopediaentry', 'GOVT_SOURCE', { editable: false }),
      makeField('immuneto', '10')
    ]
  }, 'GOVT_IMPORTED');

  assert.equal(imported.biqFields.find((field) => field.baseKey === 'immuneto').value, '2');
});

test('improvement import remaps unit, tech, resource, improvement, and government refs by civilopedia key', () => {
  const targetBundle = {
    tabs: {
      units: { entries: [makeEntry('PRTO_ALPHA', 18)] },
      technologies: { entries: [makeEntry('TECH_ALPHA', 4)] },
      resources: { entries: [makeEntry('GOOD_ALPHA', 6)] },
      improvements: { entries: [makeEntry('BLDG_ALPHA', 8)] },
      governments: { entries: [makeEntry('GOVT_ALPHA', 2)] }
    }
  };

  const imported = buildImportedEntry(targetBundle, 'improvements', {
    civilopediaKey: 'BLDG_SOURCE',
    biqIndex: 30,
    name: 'Imported Improvement',
    _importReferenceIndexMaps: {
      units: [{ index: 1, civilopediaKey: 'PRTO_ALPHA' }],
      technologies: [{ index: 2, civilopediaKey: 'TECH_ALPHA' }],
      resources: [{ index: 3, civilopediaKey: 'GOOD_ALPHA' }],
      improvements: [{ index: 4, civilopediaKey: 'BLDG_ALPHA' }],
      governments: [{ index: 5, civilopediaKey: 'GOVT_ALPHA' }]
    },
    biqFields: [
      makeField('civilopediaentry', 'BLDG_SOURCE', { editable: false }),
      makeField('unitproduced', '1'),
      makeField('reqadvance', '2'),
      makeField('obsoleteby', '2'),
      makeField('reqresource1', '3'),
      makeField('reqresource2', '3'),
      makeField('reqimprovement', '4'),
      makeField('doubleshappiness', '4'),
      makeField('gainineverycity', '4'),
      makeField('gainoncontinent', '4'),
      makeField('reqgovernment', '5')
    ]
  }, 'BLDG_IMPORTED');

  assert.equal(imported.biqFields.find((field) => field.baseKey === 'unitproduced').value, '18');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'reqadvance').value, '4');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'obsoleteby').value, '4');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'reqresource1').value, '6');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'reqresource2').value, '6');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'reqimprovement').value, '8');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'doubleshappiness').value, '8');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'gainineverycity').value, '8');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'gainoncontinent').value, '8');
  assert.equal(imported.biqFields.find((field) => field.baseKey === 'reqgovernment').value, '2');
});
