'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunctionSource(sourceText, name) {
  let needle = `async function ${name}(`;
  let start = sourceText.indexOf(needle);
  if (start < 0) {
    needle = `function ${name}(`;
    start = sourceText.indexOf(needle);
  }
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
    'getBiqRecordFieldByBaseKey',
    'parsePossibleResourceMaskList',
    'possibleResourceMaskHasIndex',
    'setPossibleResourceMaskIndex',
    'buildImportedResourceTerrainMembership',
    'getBaseBiqSectionCount',
    'getPredictedReferenceRecordIndex',
    'isBiqRecordChangedFromClean',
    'countDirtyBiqStructureRecords',
    'setTabDirtyCount',
    'applyImportedResourceTerrainMembership',
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
    state: { bundle: targetBundle, dirtyTabCounts: {}, cleanTabs: targetBundle.cleanTabs || {} },
    REFERENCE_SECTION_BY_TAB: {
      civilizations: 'RACE',
      technologies: 'TECH',
      resources: 'GOOD',
      improvements: 'BLDG',
      governments: 'GOVT',
      units: 'PRTO'
    },
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
    },
    getEffectiveCleanTabForDirty: (tabKey) => sandbox.state.cleanTabs[String(tabKey || '')] || null,
    hasChangedFromClean: (currentValue, cleanValue) => JSON.stringify(currentValue == null ? null : currentValue) !== JSON.stringify(cleanValue == null ? null : cleanValue)
  };
  sandbox.globalThis = sandbox;

  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-reference-import.vm' });
  return sandbox.__helpers;
}

function loadRendererImportSourceHelpers(loadBundleImpl) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'buildLoadBundlePayload',
    'getBiqRecordFieldByBaseKey',
    'parsePossibleResourceMaskList',
    'possibleResourceMaskHasIndex',
    'buildImportedResourceTerrainMembership',
    'loadImportEntriesForTab'
  ];
  const sandbox = {
    state: {
      settings: {
        mode: 'scenario',
        c3xPath: '/c3x',
        civ3Path: '/civ3',
        scenarioPath: '/civ3/Conquests/Scenarios/Target.biq',
        textFileEncoding: 'windows-1252'
      }
    },
    window: {
      c3xManager: {
        loadBundle: loadBundleImpl
      }
    },
    normalizeTextFileEncoding: (value) => String(value || '')
  };
  sandbox.globalThis = sandbox;

  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-reference-import-source.vm' });
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

test('standard game import source loads the global bundle and exposes entries', async () => {
  const calls = [];
  const helpers = loadRendererImportSourceHelpers(async (payload) => {
    calls.push(payload);
    return {
      biq: { sourcePath: '/civ3/Conquests/conquests.biq' },
      scenarioSearchPaths: [],
      tabs: {
        units: {
          entries: [
            makeEntry('PRTO_SETTLER', 0, 'Settler')
          ]
        },
        civilizations: { entries: [makeEntry('RACE_ROMANS', 0, 'Romans')] },
        technologies: { entries: [makeEntry('TECH_BRONZE_WORKING', 2, 'Bronze Working')] },
        resources: { entries: [] },
        improvements: { entries: [] },
        governments: { entries: [] },
        rules: {
          sections: [{
            code: 'ERAS',
            records: [makeEntry('ERA_ANCIENT_TIMES', 0, 'Ancient Times')]
          }]
        }
      }
    };
  });

  const loaded = await helpers.loadImportEntriesForTab('units', { kind: 'standard' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'global');
  assert.equal(calls[0].scenarioPath, '');
  assert.equal(calls[0].c3xPath, '/c3x');
  assert.equal(calls[0].civ3Path, '/civ3');
  assert.equal(loaded.importSourceKind, 'standard');
  assert.equal(loaded.importSourcePath, '/civ3/Conquests/conquests.biq');
  assert.equal(loaded.entries[0].civilopediaKey, 'PRTO_SETTLER');
  assert.equal(loaded.referenceIndexMaps.units.length, 1);
  assert.equal(loaded.referenceIndexMaps.units[0].index, 0);
  assert.equal(loaded.referenceIndexMaps.units[0].civilopediaKey, 'PRTO_SETTLER');
  assert.equal(loaded.referenceIndexMaps.units[0].name, 'Settler');
});

test('scenario import source keeps scenario bundle loading', async () => {
  const calls = [];
  const helpers = loadRendererImportSourceHelpers(async (payload) => {
    calls.push(payload);
    return {
      biq: { sourcePath: payload.scenarioPath },
      scenarioSearchPaths: ['/civ3/Conquests/Scenarios/Source'],
      tabs: {
        resources: {
          entries: [
            makeEntry('GOOD_IRON', 1, 'Iron')
          ]
        },
        civilizations: { entries: [] },
        technologies: { entries: [] },
        improvements: { entries: [] },
        governments: { entries: [] },
        units: { entries: [] },
        rules: { sections: [] }
      }
    };
  });

  const loaded = await helpers.loadImportEntriesForTab('resources', '/civ3/Conquests/Scenarios/Source.biq');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'scenario');
  assert.equal(calls[0].scenarioPath, '/civ3/Conquests/Scenarios/Source.biq');
  assert.equal(loaded.importSourceKind, 'scenario');
  assert.equal(loaded.importSourcePath, '/civ3/Conquests/Scenarios/Source.biq');
  assert.deepEqual(loaded.importScenarioPaths, ['/civ3/Conquests/Scenarios/Source']);
  assert.equal(loaded.entries[0].civilopediaKey, 'GOOD_IRON');
});

test('resource import source records terrain possible-resource membership', async () => {
  const helpers = loadRendererImportSourceHelpers(async () => ({
    biq: { sourcePath: '/civ3/Conquests/Scenarios/Source.biq' },
    scenarioSearchPaths: [],
    tabs: {
      resources: {
        entries: [
          makeEntry('GOOD_IRON', 1, 'Iron')
        ]
      },
      terrain: {
        sections: [{
          code: 'TERR',
          records: [
            { index: 0, fields: [makeField('name', 'Grassland'), makeField('civilopediaentry', 'TERR_GRASSLAND'), makeField('possibleResourcesMask', '0,1,0')] },
            { index: 1, fields: [makeField('name', 'Desert'), makeField('civilopediaentry', 'TERR_DESERT'), makeField('possibleResourcesMask', '0,0,0')] },
            { index: 2, fields: [makeField('name', 'Plains'), makeField('civilopediaentry', 'TERR_PLAINS'), makeField('possibleResourcesMask', '0,1')] }
          ]
        }]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      improvements: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      rules: { sections: [] }
    }
  }));

  const loaded = await helpers.loadImportEntriesForTab('resources', '/civ3/Conquests/Scenarios/Source.biq');
  const membership = loaded.entries[0]._importResourceTerrainMembership;

  assert.deepEqual(
    membership.map((item) => item.civilopediaKey),
    ['TERR_GRASSLAND', 'TERR_PLAINS']
  );
});

test('resource import applies source terrain membership to the target possible-resource mask', () => {
  const targetBundle = {
    biq: {
      sections: [
        { code: 'GOOD', count: 3 }
      ]
    },
    tabs: {
      resources: {
        entries: [
          makeEntry('GOOD_ALPHA', 0, 'Alpha'),
          makeEntry('GOOD_BETA', 1, 'Beta'),
          makeEntry('GOOD_GAMMA', 2, 'Gamma')
        ],
        recordOps: [{
          op: 'add',
          newRecordRef: 'GOOD_IMPORTED'
        }]
      },
      terrain: {
        type: 'biqStructure',
        sections: [{
          code: 'TERR',
          records: [
            {
              index: 0,
              fields: [
                makeField('name', 'Grassland'),
                makeField('civilopediaentry', 'TERR_GRASSLAND'),
                makeField('numPossibleResources', '3'),
                makeField('possibleResourcesMask', '0,0,0')
              ]
            },
            {
              index: 1,
              fields: [
                makeField('name', 'Desert'),
                makeField('civilopediaentry', 'TERR_DESERT'),
                makeField('numPossibleResources', '3'),
                makeField('possibleResourcesMask', '0,0,0')
              ]
            }
          ]
        }]
      }
    }
  };
  targetBundle.cleanTabs = {
    terrain: JSON.parse(JSON.stringify(targetBundle.tabs.terrain))
  };
  const helpers = loadRendererImportHelpers(targetBundle);
  const imported = {
    civilopediaKey: 'GOOD_IMPORTED',
    biqIndex: null,
    _importResourceTerrainMembership: [
      { civilopediaKey: 'TERR_GRASSLAND', name: 'Grassland' }
    ]
  };

  assert.equal(helpers.applyImportedResourceTerrainMembership(imported), 1);
  const grassland = targetBundle.tabs.terrain.sections[0].records[0];
  assert.equal(grassland.fields.find((field) => field.baseKey === 'possibleResourcesMask').value, '0,0,0,1');
  assert.equal(grassland.fields.find((field) => field.baseKey === 'numPossibleResources').value, '4');
  assert.equal(targetBundle.tabs.terrain.sections[0].records[1].fields.find((field) => field.baseKey === 'possibleResourcesMask').value, '0,0,0');
  assert.equal(helpers.countDirtyBiqStructureRecords('terrain'), 1);

  const importedSecond = {
    civilopediaKey: 'GOOD_IMPORTED_TWO',
    biqIndex: null,
    _importResourceTerrainMembership: [
      { civilopediaKey: 'TERR_DESERT', name: 'Desert' }
    ]
  };
  targetBundle.tabs.resources.recordOps.push({
    op: 'add',
    newRecordRef: 'GOOD_IMPORTED_TWO'
  });

  assert.equal(helpers.applyImportedResourceTerrainMembership(importedSecond), 1);
  const desert = targetBundle.tabs.terrain.sections[0].records[1];
  assert.equal(desert.fields.find((field) => field.baseKey === 'possibleResourcesMask').value, '0,0,0,0,1');
  assert.equal(desert.fields.find((field) => field.baseKey === 'numPossibleResources').value, '5');
  assert.equal(helpers.countDirtyBiqStructureRecords('terrain'), 2);
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
