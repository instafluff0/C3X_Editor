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

function loadDirtyHelpers(bundle, cleanSnapshot) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'parseSnapshotTabs',
    'getCleanTabsObject',
    'normalizeDirtyComparableValue',
    'hasChangedFromClean',
    'getEffectiveCleanTabForDirty',
    'isTabDirty'
  ];
  const sandbox = {
    state: {
      isDirty: true,
      bundle,
      cleanSnapshot,
      cleanTabsCache: null
    },
    EDITABLE_TAB_KEYS: ['scenarioSettings', 'terrain', 'world', 'rules'],
    CUSTOM_RULES_UI_TAB_KEYS: ['civilizations', 'technologies', 'resources', 'improvements', 'governments', 'units', 'terrain', 'world', 'rules'],
    globalThis: null
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-custom-rules-dirty-preview.vm' });
  return sandbox.__helpers;
}

test('custom-rules preview tabs stay clean until edited against their preview baseline', () => {
  const previewBaseline = {
    type: 'biqStructure',
    sections: [{ code: 'RULE', records: [{ index: 0, fields: [{ baseKey: 'difficulty', value: '4' }] }] }]
  };
  const currentRulesTab = JSON.parse(JSON.stringify(previewBaseline));
  currentRulesTab.previewDirtyBaseline = JSON.parse(JSON.stringify(previewBaseline));
  const bundle = {
    tabs: {
      scenarioSettings: {
        customRulesMutation: 'enable'
      },
      rules: currentRulesTab
    }
  };
  const cleanSnapshot = JSON.stringify({
    rules: {
      type: 'biqStructure',
      sections: []
    }
  });
  const { isTabDirty } = loadDirtyHelpers(bundle, cleanSnapshot);

  assert.equal(isTabDirty('rules'), false);

  bundle.tabs.rules.sections[0].records[0].fields[0].value = '5';
  assert.equal(isTabDirty('rules'), true);
});
