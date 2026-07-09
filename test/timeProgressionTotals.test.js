const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunctionSource(sourceText, functionName) {
  const start = sourceText.indexOf(`function ${functionName}`);
  if (start < 0) throw new Error(`Missing function ${functionName}`);
  const signatureEnd = sourceText.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = signatureEnd; i < sourceText.length; i += 1) {
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

function extractBlockSource(sourceText, needle) {
  const start = sourceText.indexOf(needle);
  if (start < 0) throw new Error(`Missing block ${needle}`);
  const signatureEnd = sourceText.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = signatureEnd; i < sourceText.length; i += 1) {
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

function loadHelpers() {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${extractFunctionSource(sourceText, 'parseFiniteNumber')}\n`
      + `${extractFunctionSource(sourceText, 'formatScenarioYearLabel')}\n`
      + `${extractFunctionSource(sourceText, 'getTimeProgressionBaseUnit')}\n`
      + `${extractFunctionSource(sourceText, 'formatTimeProgressionSummaryNumber')}\n`
      + `${extractFunctionSource(sourceText, 'formatTimeProgressionUnitQuantity')}\n`
      + `${extractFunctionSource(sourceText, 'getTimeProgressionYearRanges')}\n`
      + `${extractFunctionSource(sourceText, 'getTimeProgressionTotals')}\n`
      + 'globalThis.__helpers = { getTimeProgressionTotals, getTimeProgressionYearRanges };',
    sandbox,
    { filename: 'time-progression-totals.vm' }
  );
  return sandbox.__helpers;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('time progression totals summarize visible rows', () => {
  const { getTimeProgressionTotals } = loadHelpers();
  const rows = [
    { turnsValue: '25', perTurnValue: '50' },
    { turnsValue: '25', perTurnValue: '40' },
    { turnsValue: '40', perTurnValue: '25' },
    { turnsValue: '50', perTurnValue: '20' },
    { turnsValue: '100', perTurnValue: '10' },
    { turnsValue: '100', perTurnValue: '5' },
    { turnsValue: '100', perTurnValue: '2' }
  ];

  assert.deepEqual(plain(getTimeProgressionTotals(rows, '-4000')), {
    turnsText: '440',
    elapsedText: '5950 years',
    rangeText: '4000 BC to 1950 AD'
  });
});

test('time progression ranges convert weeks into displayed years', () => {
  const { getTimeProgressionTotals, getTimeProgressionYearRanges } = loadHelpers();
  const rows = [
    { turnsValue: '25', perTurnValue: '50' },
    { turnsValue: '25', perTurnValue: '40' }
  ];

  assert.deepEqual(getTimeProgressionYearRanges(rows, '-4000', '2'), [
    '4000 BC to 3975.96 BC',
    '3975.96 BC to 3956.73 BC'
  ]);
  assert.deepEqual(plain(getTimeProgressionTotals(rows, '-4000', '2')), {
    turnsText: '50',
    elapsedText: '2250 weeks',
    rangeText: '4000 BC to 3956.73 BC'
  });
});

test('time progression ranges convert months into displayed years', () => {
  const { getTimeProgressionTotals, getTimeProgressionYearRanges } = loadHelpers();
  const rows = [
    { turnsValue: '300', perTurnValue: '1' }
  ];

  assert.deepEqual(getTimeProgressionYearRanges(rows, '1941', '1'), [
    '1941 AD to 1966 AD'
  ]);
  assert.deepEqual(plain(getTimeProgressionTotals(rows, '1941', '1')), {
    turnsText: '300',
    elapsedText: '300 months',
    rangeText: '1941 AD to 1966 AD'
  });
});

test('base time unit enum follows Quint order', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    sourceText,
    /basetimeunit:\s*\[\s*\{\s*value: '0', label: 'Years'\s*\},\s*\{\s*value: '1', label: 'Months'\s*\},\s*\{\s*value: '2', label: 'Weeks'\s*\}\s*\]/,
    'Base Time Unit must match Quint/BIQ order: 0=Years, 1=Months, 2=Weeks'
  );
});

test('base time unit refreshes dependent Scenario rows without rerendering tab', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const handler = extractBlockSource(sourceText, "if (selected.code === 'GAME' && baseKey === 'basetimeunit')");

  assert.match(
    handler,
    /if \(selected\.code === 'GAME' && baseKey === 'basetimeunit'\) \{[\s\S]*?refreshScenarioTimeProgressionDisplay\(\);[\s\S]*?refreshScenarioStartDateVisibility\(\);[\s\S]*?return;/,
    'Base Time Unit should update dependent Scenario fields in place so the tab scroll does not reset'
  );
  assert.doesNotMatch(
    handler,
    /state\.tabContentScrollTop|renderActiveTab\(\{ preserveTabScroll: true \}\);/,
    'Base Time Unit must not use the old full-tab rerender scroll-restore path'
  );
});

test('time progression totals show unknown when a row is incomplete', () => {
  const { getTimeProgressionTotals } = loadHelpers();

  assert.deepEqual(plain(getTimeProgressionTotals([
    { turnsValue: '10', perTurnValue: '5' },
    { turnsValue: '', perTurnValue: '2' }
  ], '-4000')), {
    turnsText: '(unknown)',
    elapsedText: '(unknown)',
    rangeText: '(unknown)'
  });
});
