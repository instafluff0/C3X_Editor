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
  if (signatureEnd < 0) throw new Error(`Could not find parameter list end for function ${name}`);
  const bodyStart = sourceText.indexOf('{', signatureEnd);
  if (bodyStart < 0) throw new Error(`Could not find body for function ${name}`);
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
  if (end < 0) throw new Error(`Could not determine end of function ${name}`);
  return sourceText.slice(start, end);
}

function loadReferenceOptionHelpers(bundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'getBaseBiqSectionCount',
    'getPredictedReferenceRecordIndex',
    'getReferenceEntryIndexForOption',
    'normalizeRuleLookupKey',
    'makeIndexOptionsForTab',
    'shouldRestrictResourceReferenceOptions',
    'getReferenceOptionsForField'
  ];
  const sandbox = {
    state: { bundle },
    BIQ_FIELD_REFS: {
      resources: { prerequisite: 'technologies' },
      improvements: {
        reqimprovement: 'improvements',
        reqgovernment: 'governments',
        reqadvance: 'technologies',
        obsoleteby: 'technologies',
        reqresource1: 'resources',
        reqresource2: 'resources',
        unitproduced: 'units',
        gainineverycity: 'improvements',
        gainoncontinent: 'improvements',
        doubleshappiness: 'improvements'
      },
      units: {
        requiredtech: 'technologies',
        upgradeto: 'units',
        requiredresource1: 'resources',
        requiredresource2: 'resources',
        requiredresource3: 'resources',
        enslaveresultsin: 'units',
        enslaveresultsinto: 'units'
      }
    },
    makeBiqSectionIndexOptions: () => [],
    rebuildCivilizationDiplomacyOptions: () => [],
    REFERENCE_SECTION_BY_TAB: {
      civilizations: 'RACE',
      technologies: 'TECH',
      resources: 'GOOD',
      improvements: 'BLDG',
      governments: 'GOVT',
      units: 'PRTO'
    },
    globalThis: null
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-resource-reference-options.vm' });
  return sandbox.__helpers;
}

function makeField(baseKey, value) {
  return {
    baseKey,
    key: baseKey,
    value: String(value),
    originalValue: String(value),
    editable: true
  };
}

function makeResource(civilopediaKey, biqIndex, typeValue) {
  return {
    civilopediaKey,
    biqIndex,
    name: civilopediaKey,
    biqFields: [makeField('type', typeValue)]
  };
}

function makeEntry(civilopediaKey, biqIndex) {
  return { civilopediaKey, biqIndex, name: civilopediaKey, biqFields: [] };
}

test('improvement resource dropdown includes bonus resources', () => {
  const bundle = {
    tabs: {
      resources: {
        entries: [
          makeResource('GOOD_CATTLE', 0, 'Bonus (0)'),
          makeResource('GOOD_SILK', 1, 'Luxury (1)'),
          makeResource('GOOD_IRON', 2, 'Strategic (2)')
        ]
      }
    }
  };
  const { getReferenceOptionsForField } = loadReferenceOptionHelpers(bundle);

  const options = getReferenceOptionsForField('improvements', { baseKey: 'reqresource1' });

  assert.deepEqual(options.map((opt) => opt.entry.civilopediaKey), ['GOOD_CATTLE', 'GOOD_SILK', 'GOOD_IRON']);
});

test('unit resource dropdown includes bonus resources for all required resource slots', () => {
  const bundle = {
    tabs: {
      resources: {
        entries: [
          makeResource('GOOD_WHEAT', 3, 'Bonus (0)'),
          makeResource('GOOD_DYES', 4, 'Luxury (1)'),
          makeResource('GOOD_COAL', 5, 'Strategic (2)')
        ]
      }
    }
  };
  const { getReferenceOptionsForField } = loadReferenceOptionHelpers(bundle);

  const options = getReferenceOptionsForField('units', { baseKey: 'requiredresource3' });

  assert.deepEqual(options.map((opt) => opt.entry.civilopediaKey), ['GOOD_WHEAT', 'GOOD_DYES', 'GOOD_COAL']);
});

test('resource options remain unfiltered for improvements and units resource prerequisites', () => {
  const bundle = {
    tabs: {
      resources: {
        entries: [
          makeResource('GOOD_GAME', 6, 'Bonus (0)'),
          makeResource('GOOD_SPICES', 7, 'Luxury (1)'),
          makeResource('GOOD_OIL', 8, 'Strategic (2)')
        ]
      },
      improvements: {
        entries: [makeEntry('BLDG_TEMPLE', 9)]
      }
    }
  };
  const { makeIndexOptionsForTab, getReferenceOptionsForField, shouldRestrictResourceReferenceOptions } = loadReferenceOptionHelpers(bundle);

  assert.equal(shouldRestrictResourceReferenceOptions('improvements', 'reqresource1'), true);
  assert.equal(shouldRestrictResourceReferenceOptions('improvements', 'doubleshappiness'), false);
  assert.equal(shouldRestrictResourceReferenceOptions('resources', 'prerequisite'), false);
  assert.deepEqual(
    makeIndexOptionsForTab('resources').map((opt) => opt.entry.civilopediaKey),
    ['GOOD_GAME', 'GOOD_SPICES', 'GOOD_OIL']
  );
  assert.deepEqual(
    getReferenceOptionsForField('improvements', { baseKey: 'reqresource1' }).map((opt) => opt.entry.civilopediaKey),
    ['GOOD_GAME', 'GOOD_SPICES', 'GOOD_OIL']
  );
  assert.deepEqual(
    getReferenceOptionsForField('improvements', { baseKey: 'doubleshappiness' }).map((opt) => opt.entry.civilopediaKey),
    ['BLDG_TEMPLE']
  );
});
