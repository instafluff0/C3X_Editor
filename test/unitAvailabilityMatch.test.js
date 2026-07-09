const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RENDERER_PATH = path.join(__dirname, '..', 'src', 'renderer.js');
const STYLES_PATH = path.join(__dirname, '..', 'src', 'styles.css');

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

function loadAvailabilityHelpers() {
  const rendererText = fs.readFileSync(RENDERER_PATH, 'utf8');
  const context = {
    module: { exports: {} },
    exports: {},
    state: {
      bundle: {
        tabs: {
          civilizations: {
            entries: [
              { name: 'Rome', biqIndex: 0 },
              { name: 'Greece', biqIndex: 1 },
              { name: 'Egypt', biqIndex: 2 }
            ]
          }
        }
      }
    }
  };
  vm.runInNewContext([
    'function getReferenceEntryIndexForOption(tabKey, entry, fallbackIdx) { return Number.isFinite(Number(entry && entry.biqIndex)) ? Number(entry.biqIndex) : fallbackIdx; }',
    'function setFieldReferenceTargetsMeta(field, targetTabKey, values) { field.referenceTargets = { targetTabKey, values: values.slice() }; }',
    extractFunctionSource(rendererText, 'parseIntFromDisplayValue'),
    extractFunctionSource(rendererText, 'getBiqFieldByBaseKey'),
    extractFunctionSource(rendererText, 'parseSigned32FromValue'),
    extractFunctionSource(rendererText, 'toSigned32StringFromUnsigned'),
    extractFunctionSource(rendererText, 'decodeAvailableToIndices'),
    extractFunctionSource(rendererText, 'encodeAvailableToFromIndices'),
    extractFunctionSource(rendererText, 'getCivilizationBitmaskOptions'),
    extractFunctionSource(rendererText, 'ensureUnitAvailableToField'),
    extractFunctionSource(rendererText, 'isUnitAvailableToCivilization'),
    extractFunctionSource(rendererText, 'setUnitAvailableToCivilization'),
    extractFunctionSource(rendererText, 'copyUnitAvailabilityBetweenCivilizations'),
    'module.exports = { decodeAvailableToIndices, copyUnitAvailabilityBetweenCivilizations };'
  ].join('\n'), context);
  return context.module.exports;
}

function makeUnit(mask) {
  return {
    biqFields: [
      { key: 'availableto', baseKey: 'availableto', label: 'Available To', value: String(mask), originalValue: String(mask), editable: true }
    ]
  };
}

function targetAvailabilityMatchesSource(rows, sourceCiv, targetCiv, decodeAvailableToIndices) {
  return rows.every((row) => {
    const indices = decodeAvailableToIndices(row.entry.biqFields[0].value);
    return indices.includes(sourceCiv) === indices.includes(targetCiv);
  });
}

test('Availability by Civ can copy one civilization availability column to another across every row', () => {
  const { decodeAvailableToIndices, copyUnitAvailabilityBetweenCivilizations } = loadAvailabilityHelpers();
  const rows = [
    { entry: makeUnit(1 << 1), hiddenByFilter: false },
    { entry: makeUnit(1 << 0), hiddenByFilter: false },
    { entry: makeUnit((1 << 0) | (1 << 1) | (1 << 2)), hiddenByFilter: false },
    { entry: makeUnit((1 << 1) | (1 << 2)), hiddenByFilter: true }
  ];

  const changed = copyUnitAvailabilityBetweenCivilizations(rows, 0, 1);

  assert.equal(changed, 3);
  assert.equal(targetAvailabilityMatchesSource(rows, 1, 0, decodeAvailableToIndices), true);
  assert.deepEqual(
    rows.map((row) => decodeAvailableToIndices(row.entry.biqFields[0].value).includes(2)),
    [false, false, true, true],
    'copying one civ column must preserve unrelated civ availability bits'
  );
  assert.equal(copyUnitAvailabilityBetweenCivilizations(rows, 0, 1), 0);
});

test('Availability by Civ match action is an immediate dropdown in the bulk action row', () => {
  const rendererText = fs.readFileSync(RENDERER_PATH, 'utf8');
  const stylesText = fs.readFileSync(STYLES_PATH, 'utf8');
  const panelSource = extractFunctionSource(rendererText, 'createUnitAvailabilityPanel');

  assert.match(
    panelSource,
    /summary\.className = 'unit-availability-summary';[\s\S]*?actionRow\.appendChild\(summary\);[\s\S]*?const matchPicker = createReferencePicker\(\{[\s\S]*?noneLabel: 'Match another civ\.\.\.',[\s\S]*?resetAfterSelect: true,[\s\S]*?onSelect: \(value, option\) => \{[\s\S]*?applyUnitAvailabilityMatch\(value, option\);[\s\S]*?actionRow\.appendChild\(matchPicker\);[\s\S]*?setVisibleBtn\.className = 'ghost unit-availability-bulk-btn unit-availability-bulk-available';/,
    'match action should be a reset-after-select picker in the secondary action row before filter-scoped bulk buttons'
  );
  assert.match(
    panelSource,
    /const changed = copyUnitAvailabilityBetweenCivilizations\(currentRows, targetIdx, sourceIdx\);/,
    'matching another civ should copy across all current unit rows, not only visible filtered rows'
  );
  assert.match(
    stylesText,
    /\.unit-availability-match-picker \{[\s\S]*?flex: 0 0 226px;[\s\S]*?\.unit-availability-match-picker \.tech-picker-btn \{[\s\S]*?font-weight: 800;/,
    'match source picker should be styled as a compact toolbar control'
  );
  assert.doesNotMatch(panelSource, /unit-availability-match-panel|applyMatchBtn|cancelMatchBtn/);
});
