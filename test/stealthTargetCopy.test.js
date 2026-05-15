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

function loadStealthTargetCopyHelpers(bundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'canonicalBiqFieldKey',
    'getUnitListFieldState',
    'getBaseBiqSectionCount',
    'getPredictedReferenceRecordIndex',
    'getReferenceEntryIndexForOption',
    'makeIndexOptionsForTab',
    'getStealthTargetCopySourceOptions',
    'mergeStealthTargetValues'
  ];
  const sandbox = {
    state: { bundle },
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
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-stealth-target-copy.vm' });
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

function makeUnitEntry(name, biqIndex, targets = []) {
  return {
    name,
    biqIndex,
    biqFields: [
      makeField('numstealthtargets', String(targets.length)),
      ...targets.map((value, idx) => makeField('stealth_target', value, idx > 0 ? { key: `stealth_target_${idx + 1}` } : {}))
    ]
  };
}

function toLocalArray(values) {
  return Array.from(values || []);
}

test('getStealthTargetCopySourceOptions only includes other units with stealth targets', () => {
  const current = makeUnitEntry('Current Unit', 100, ['2']);
  const sourceA = makeUnitEntry('Source A', 101, ['4', '5']);
  const sourceB = makeUnitEntry('Source B', 102, []);
  const sourceC = makeUnitEntry('Source C', 103, ['9']);
  const bundle = {
    tabs: {
      units: {
        entries: [current, sourceA, sourceB, sourceC]
      }
    }
  };
  const { getStealthTargetCopySourceOptions } = loadStealthTargetCopyHelpers(bundle);

  const options = getStealthTargetCopySourceOptions(current);

  assert.deepEqual(toLocalArray(options).map((opt) => opt.label), ['Source A', 'Source C']);
  assert.deepEqual(toLocalArray(options).map((opt) => opt.value), ['101', '103']);
});

test('mergeStealthTargetValues preserves existing values and appends only new source targets', () => {
  const { mergeStealthTargetValues } = loadStealthTargetCopyHelpers({ tabs: { units: { entries: [] } } });

  const merged = mergeStealthTargetValues(['4', '5'], ['5', '6', '7']);

  assert.deepEqual(toLocalArray(merged), ['4', '5', '6', '7']);
});

test('mergeStealthTargetValues ignores blanks and safely handles non-arrays', () => {
  const { mergeStealthTargetValues } = loadStealthTargetCopyHelpers({ tabs: { units: { entries: [] } } });

  const merged = mergeStealthTargetValues(null, ['4', '', '  ', '5']);

  assert.deepEqual(toLocalArray(merged), ['4', '5']);
});

test('getStealthTargetCopySourceOptions keeps strategy-map duplicate sources when targets use primary indexes', () => {
  const current = makeUnitEntry('Target Unit', 20, ['10']);
  const duplicateSource = makeUnitEntry('Dragon Slayer', 401, ['399', '401']);
  const noTargets = makeUnitEntry('Empty Unit', 500, []);
  const bundle = {
    tabs: {
      units: {
        entries: [current, duplicateSource, noTargets]
      }
    }
  };
  const { getStealthTargetCopySourceOptions, mergeStealthTargetValues } = loadStealthTargetCopyHelpers(bundle);

  const options = getStealthTargetCopySourceOptions(current);
  assert.deepEqual(toLocalArray(options).map((opt) => opt.label), ['Dragon Slayer']);
  assert.deepEqual(toLocalArray(options).map((opt) => opt.value), ['401']);

  const merged = mergeStealthTargetValues(
    current.biqFields.filter((field) => field.baseKey === 'stealth_target').map((field) => field.value),
    duplicateSource.biqFields.filter((field) => field.baseKey === 'stealth_target').map((field) => field.value)
  );
  assert.deepEqual(toLocalArray(merged), ['10', '399', '401']);
});
