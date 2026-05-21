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

function loadPreviewOptionHelpers(bundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'getFallbackBiqSectionForOptions',
    'makeBiqSectionIndexOptions'
  ];
  const sandbox = {
    state: { bundle },
    BIQ_SECTION_TO_REFERENCE_TAB: {
      RACE: 'civilizations',
      TECH: 'technologies',
      GOOD: 'resources',
      BLDG: 'improvements',
      GOVT: 'governments',
      PRTO: 'units'
    },
    getReferenceEntryIndexForOption: (_targetTabKey, entry, fallbackIdx, options = {}) => {
      if (Number.isFinite(Number(entry && entry.biqIndex))) return Number(entry.biqIndex);
      return options && options.allowFallback ? Number(fallbackIdx) : null;
    },
    getFieldByBaseKey: (record, baseKey) => {
      const fields = Array.isArray(record && record.fields) ? record.fields : [];
      return fields.find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === String(baseKey || '').toLowerCase()) || null;
    },
    ensureSyntheticReferenceEntryForBiqRecord: (_tabKey, _sectionCode, rec) => ({
      name: String(rec && rec.name || ''),
      civilopediaKey: String((sandbox.getFieldByBaseKey(rec, 'civilopediaentry') || {}).value || '').trim().toUpperCase()
    }),
    globalThis: null
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-biq-section-index-options-preview.vm' });
  return sandbox.__helpers;
}

function makeField(baseKey, value) {
  return {
    baseKey,
    key: baseKey,
    value: String(value)
  };
}

test('makeBiqSectionIndexOptions prefers live tab RACE records over stale BIQ sections', () => {
  const bundle = {
    biq: {
      sections: []
    },
    tabs: {
      civilizations: {
        entries: [
          { civilopediaKey: 'RACE_ROMANS', biqIndex: 1, name: 'Romans' }
        ],
        sections: [{
          code: 'RACE',
          records: [{
            index: 1,
            name: 'Romans',
            fields: [makeField('civilopediaentry', 'RACE_ROMANS')]
          }]
        }]
      }
    }
  };
  const { makeBiqSectionIndexOptions } = loadPreviewOptionHelpers(bundle);

  const options = makeBiqSectionIndexOptions('RACE', false);

  assert.deepEqual(options.map((opt) => ({ value: opt.value, label: opt.label })), [
    { value: '1', label: 'Romans' }
  ]);
});

test('makeBiqSectionIndexOptions can build non-reference section options from preview tabs', () => {
  const bundle = {
    biq: {
      sections: []
    },
    tabs: {
      rules: {
        sections: [{
          code: 'ERAS',
          records: [
            { index: 0, name: 'Ancient Times', fields: [] },
            { index: 1, name: 'Middle Ages', fields: [] }
          ]
        }]
      }
    }
  };
  const { makeBiqSectionIndexOptions } = loadPreviewOptionHelpers(bundle);

  const options = makeBiqSectionIndexOptions('ERAS', false);

  assert.deepEqual(options.map((opt) => ({ value: opt.value, label: opt.label })), [
    { value: '0', label: 'Ancient Times' },
    { value: '1', label: 'Middle Ages' }
  ]);
});
