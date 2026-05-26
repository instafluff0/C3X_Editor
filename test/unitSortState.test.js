const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected ${name} function to exist`);
  let parenDepth = 0;
  let braceStart = -1;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;
    if (char === '{' && parenDepth === 0) {
      braceStart = index;
      break;
    }
  }
  assert.notEqual(braceStart, -1, `expected ${name} function body to exist`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function loadSortHelpers() {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const context = { module: { exports: {} }, exports: {} };
  vm.runInNewContext([
    extractFunctionSource(rendererText, 'cloneStateMap'),
    extractFunctionSource(rendererText, 'normalizeMainUnitReferenceSort'),
    extractFunctionSource(rendererText, 'sanitizeReferenceUnitSortMap'),
    extractFunctionSource(rendererText, 'getUnitReferenceSortOptions'),
    extractFunctionSource(rendererText, 'getUnitReferenceInGameSortIndex'),
    extractFunctionSource(rendererText, 'compareUnitReferenceInGameOrder'),
    'module.exports = { normalizeMainUnitReferenceSort, sanitizeReferenceUnitSortMap, getUnitReferenceSortOptions, compareUnitReferenceInGameOrder };'
  ].join('\n'), context);
  return { rendererText, ...context.module.exports };
}

test('main Units sort excludes Manual and sanitizes persisted Manual to In-game order', () => {
  const {
    rendererText,
    normalizeMainUnitReferenceSort,
    sanitizeReferenceUnitSortMap,
    getUnitReferenceSortOptions
  } = loadSortHelpers();

  assert.deepEqual(
    Array.from(getUnitReferenceSortOptions().map((opt) => opt.value)),
    ['ingame', 'az', 'za']
  );
  assert.deepEqual(
    Array.from(getUnitReferenceSortOptions({ includeManual: true }).map((opt) => opt.value)),
    ['ingame', 'az', 'za', 'manual']
  );
  assert.equal(normalizeMainUnitReferenceSort('manual'), 'ingame');
  assert.equal(normalizeMainUnitReferenceSort('az'), 'az');
  assert.deepEqual({ ...sanitizeReferenceUnitSortMap({ units: 'manual' }) }, { units: 'ingame' });

  const unitTablePanelSource = extractFunctionSource(rendererText, 'createUnitTablePanel');
  assert.match(
    unitTablePanelSource,
    /getUnitReferenceSortOptions\(\{ includeManual: true \}\)/,
    'Unit Table should be the only Units UI that asks for Manual sort'
  );
  assert.doesNotMatch(
    unitTablePanelSource,
    /state\.referenceUnitSort/,
    'Unit Table sort state must not leak into the main Units list sort state'
  );
});

test('in-game unit ordering keeps BIQ records before synthetic era variants after no-reload save reconciliation', () => {
  const { compareUnitReferenceInGameOrder } = loadSortHelpers();
  const rows = [
    { name: 'Army Eras Ancient Times', biqIndex: null },
    { name: 'Tomb Crawler', biqIndex: 120 },
    { name: 'Settler', biqIndex: 0 },
    { name: 'Worker Eras Modern Era', biqIndex: null },
    { name: 'Crusader', biqIndex: 41 }
  ];

  rows.sort(compareUnitReferenceInGameOrder);

  assert.deepEqual(
    rows.map((row) => row.name),
    ['Settler', 'Crusader', 'Tomb Crawler', 'Army Eras Ancient Times', 'Worker Eras Modern Era']
  );
});

test('main Units in-game sort surfaces unsaved new entries until save reconciliation assigns final order', () => {
  const { compareUnitReferenceInGameOrder } = loadSortHelpers();
  const rows = [
    { name: 'Settler Eras Modern Era', biqIndex: null, isNew: false },
    { name: 'Tomb Crawler', biqIndex: 120, isNew: false },
    { name: 'Tomb Crawler Copy', biqIndex: null, isNew: true },
    { name: 'Settler', biqIndex: 0, isNew: false }
  ];

  const liveRows = rows.slice().sort((a, b) => compareUnitReferenceInGameOrder(a, b, { preferUnsavedNew: true }));
  assert.deepEqual(
    liveRows.map((row) => row.name),
    ['Tomb Crawler Copy', 'Settler', 'Tomb Crawler', 'Settler Eras Modern Era']
  );

  const reconciledRows = [
    { name: 'Tomb Crawler Copy', biqIndex: 121, isNew: true },
    { name: 'Settler', biqIndex: 0, isNew: false },
    { name: 'Tomb Crawler', biqIndex: 120, isNew: false }
  ].sort(compareUnitReferenceInGameOrder);
  assert.deepEqual(
    reconciledRows.map((row) => row.name),
    ['Settler', 'Tomb Crawler', 'Tomb Crawler Copy']
  );
});
