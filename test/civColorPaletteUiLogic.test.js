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

function loadPaletteUiHelpers() {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'getCivColorPaletteMainRampIndices',
    'getCivColorPaletteCityUiIndices',
    'getCivColorPaletteOtherUsefulIndices',
    'getCivColorPaletteAdditionalLinkedIndices',
    'getCivColorPaletteRhyeIndices',
    'getCivColorPaletteGrayIndices',
    'getCivColorPaletteProtectedIndices',
    'getCivColorPaletteMainAndUsefulIndices',
    'getCivColorPaletteAllOtherIndices',
    'getCivColorPaletteFilterFacetDefinitions',
    'normalizeCivColorPaletteFilterFacets',
    'getCivColorPaletteVisibleIndicesForFilter',
    'getCivColorPaletteAutoGenerateIndices',
    'getCivColorPaletteRoleMeta',
    'getCivColorPaletteDisplayLabel',
    'getCivColorPaletteColorFromPalette',
    'clampCivColorPaletteByte',
    'normalizeCivColorPaletteRgb',
    'clampCivColorPaletteUnit',
    'wrapCivColorPaletteHue',
    'rgbToHsv',
    'hsvToRgb',
    'getCivColorPaletteAdjustedRgb',
    'applyCivColorPaletteBatchAdjustmentToPalette',
    'generateCivColorPaletteFromMainColor',
    'formatCivilizationDefaultColorUsageSummary',
    'buildUniqueCivilizationColorSlotAssignments'
  ];
  const sandbox = {};
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-civ-palette-ui.vm' });
  return sandbox.__helpers;
}

test('generateCivColorPaletteFromMainColor retints linked shades but leaves stable slots alone', () => {
  const helpers = loadPaletteUiHelpers();
  const palette = new Array(70 * 3).fill(0);
  for (let index = 0; index < 70; index += 1) {
    const base = index * 3;
    palette[base] = (90 + index * 2) % 256;
    palette[base + 1] = (30 + index * 3) % 256;
    palette[base + 2] = (40 + index * 4) % 256;
  }
  palette[7 * 3] = 200;
  palette[7 * 3 + 1] = 30;
  palette[7 * 3 + 2] = 50;
  palette[17 * 3] = 120;
  palette[17 * 3 + 1] = 120;
  palette[17 * 3 + 2] = 120;
  palette[33 * 3] = 80;
  palette[33 * 3 + 1] = 70;
  palette[33 * 3 + 2] = 65;

  const next = helpers.generateCivColorPaletteFromMainColor(palette, { r: 35, g: 140, b: 230 });

  assert.equal(next.length, palette.length);
  assert.equal(JSON.stringify(helpers.getCivColorPaletteColorFromPalette(next, 7)), JSON.stringify({ r: 35, g: 140, b: 230 }));
  assert.notDeepEqual(helpers.getCivColorPaletteColorFromPalette(next, 64), helpers.getCivColorPaletteColorFromPalette(palette, 64));
  assert.equal(
    JSON.stringify(helpers.getCivColorPaletteColorFromPalette(next, 17)),
    JSON.stringify(helpers.getCivColorPaletteColorFromPalette(palette, 17))
  );
  assert.equal(
    JSON.stringify(helpers.getCivColorPaletteColorFromPalette(next, 33)),
    JSON.stringify(helpers.getCivColorPaletteColorFromPalette(palette, 33))
  );
});

test('renderer no longer exposes the old Core / City / All 70 filter labels', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  assert.ok(sourceText.includes('Set Main Color'));
  assert.ok(sourceText.includes('mainSeedLabel.appendChild(mainSeedInput)'));
  assert.ok(sourceText.includes('Other useful colors'));
  assert.ok(sourceText.includes('All others'));
  assert.ok(sourceText.includes('Hue'));
  assert.ok(sourceText.includes('Saturation'));
  assert.ok(sourceText.includes('Balance'));
  assert.ok(sourceText.includes('Tint'));
  assert.ok(!sourceText.includes('Monotone'));
  assert.ok(!sourceText.includes('Show RGB Values'));
  assert.ok(!sourceText.includes('Advanced values'));
  assert.ok(!sourceText.includes('Generate Palette'));
  assert.ok(!sourceText.includes("label: 'Core'"));
  assert.ok(!sourceText.includes("label: 'All 70'"));
  assert.ok(!sourceText.includes('label: "Rhye'));
  assert.ok(!sourceText.includes("label: 'Rhye"));
});

test("Other useful colors includes Quint's Rhye color index set", () => {
  const helpers = loadPaletteUiHelpers();
  const expected = [10, 11, 12, 13, 14, 15, 20, 24, 26, 30, 32, 38, 44, 48, 50, 56, 60, 62];
  assert.deepEqual(Array.from(helpers.getCivColorPaletteRhyeIndices()), expected);
  expected.forEach((index) => {
    assert.ok(Array.from(helpers.getCivColorPaletteOtherUsefulIndices()).includes(index), `Other useful colors includes ${index}`);
  });
});

test('civ color palette role labels match Quint guidance', () => {
  const helpers = loadPaletteUiHelpers();
  const expectedLabels = new Map([
    [6, '6: Color of starting location/civ color in editor'],
    [7, '7: Color of pixel in PCX file'],
    [9, '9: Color of circle around leaderhead on Diplomacy screen'],
    [64, '64: Inner pixels of city borders (in-game)'],
    [65, '65: Outer pixel of city borders (in-game)'],
    [66, '66: City for unit discs, histographs, and mini-map'],
    [67, '67: Color - unknown'],
    [68, '68: City color'],
    [69, '69: Civ name in histograph']
  ]);
  [17, 19, 21, 23, 25, 27, 29, 31].forEach((index) => {
    expectedLabels.set(index, `${index}: Shade of gray - changing not recommended`);
  });
  [33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63].forEach((index) => {
    expectedLabels.set(index, `${index}: Should remain the same for all colors - do not change`);
  });

  expectedLabels.forEach((label, index) => {
    assert.equal(helpers.getCivColorPaletteDisplayLabel(index), label);
    assert.equal(helpers.getCivColorPaletteRoleMeta(index).description, '');
  });
  assert.equal(helpers.getCivColorPaletteDisplayLabel(0), '0: Color');
  assert.equal(helpers.getCivColorPaletteDisplayLabel(32), '32: Color');
  assert.equal(helpers.getCivColorPaletteDisplayLabel(34), '34: Color');
});

test('civ color palette filters combine compact facets', () => {
  const helpers = loadPaletteUiHelpers();
  assert.deepEqual(Array.from(helpers.normalizeCivColorPaletteFilterFacets('linked')), ['useful']);
  assert.deepEqual(Array.from(helpers.normalizeCivColorPaletteFilterFacets('all')), ['main', 'useful', 'allOthers']);
  assert.deepEqual(
    Array.from(helpers.getCivColorPaletteVisibleIndicesForFilter(['main', 'gray'])),
    Array.from(new Set([
      ...helpers.getCivColorPaletteMainRampIndices(),
      ...helpers.getCivColorPaletteGrayIndices()
    ])).sort((a, b) => a - b)
  );
  assert.deepEqual(
    Array.from(helpers.getCivColorPaletteVisibleIndicesForFilter(['main', 'useful', 'allOthers'])),
    Array.from({ length: 70 }, (_v, idx) => idx)
  );
  assert.deepEqual(
    Array.from(helpers.getCivColorPaletteVisibleIndicesForFilter(['useful'])),
    Array.from(new Set([
      ...helpers.getCivColorPaletteAdditionalLinkedIndices(),
      ...helpers.getCivColorPaletteRhyeIndices(),
      ...helpers.getCivColorPaletteCityUiIndices()
    ])).sort((a, b) => a - b)
  );
});

test('batch palette adjustment only changes requested indices', () => {
  const helpers = loadPaletteUiHelpers();
  const palette = new Array(70 * 3).fill(0);
  palette[10 * 3] = 200;
  palette[10 * 3 + 1] = 20;
  palette[10 * 3 + 2] = 20;
  palette[11 * 3] = 20;
  palette[11 * 3 + 1] = 120;
  palette[11 * 3 + 2] = 20;
  palette[12 * 3] = 20;
  palette[12 * 3 + 1] = 20;
  palette[12 * 3 + 2] = 120;

  const shifted = helpers.applyCivColorPaletteBatchAdjustmentToPalette(palette, [10, 11], 'hue', 60);
  assert.notDeepEqual(
    helpers.getCivColorPaletteColorFromPalette(shifted, 10),
    helpers.getCivColorPaletteColorFromPalette(palette, 10)
  );
  assert.notDeepEqual(
    helpers.getCivColorPaletteColorFromPalette(shifted, 11),
    helpers.getCivColorPaletteColorFromPalette(palette, 11)
  );
  assert.deepEqual(
    helpers.getCivColorPaletteColorFromPalette(shifted, 12),
    helpers.getCivColorPaletteColorFromPalette(palette, 12)
  );

  const tinted = helpers.applyCivColorPaletteBatchAdjustmentToPalette(palette, [10], 'tint', { r: 128, g: 80, b: 220 });
  const sourceHsv = helpers.rgbToHsv(helpers.getCivColorPaletteColorFromPalette(palette, 10));
  const targetHsv = helpers.rgbToHsv({ r: 128, g: 80, b: 220 });
  const adjusted = helpers.rgbToHsv(helpers.getCivColorPaletteColorFromPalette(tinted, 10));
  assert.ok(Math.abs(adjusted.h - targetHsv.h) < 1);
  assert.equal(adjusted.v, sourceHsv.v);
  assert.ok(adjusted.s > 0);
});

test('unique civ color assignment preserves first slot users and moves duplicates', () => {
  const helpers = loadPaletteUiHelpers();
  const plan = helpers.buildUniqueCivilizationColorSlotAssignments([
    { defaultSlot: 3, alternateSlot: 3 },
    { defaultSlot: 3, alternateSlot: 8 },
    { defaultSlot: 5, alternateSlot: 5 },
    { defaultSlot: 5, alternateSlot: 5 },
    { defaultSlot: null, alternateSlot: 7 }
  ], 8);

  assert.equal(plan.ok, true);
  assert.deepEqual(Array.from(plan.assignments), [3, 0, 5, 1, 7]);
  assert.equal(plan.changedCount, 3);

  const impossible = helpers.buildUniqueCivilizationColorSlotAssignments([
    { defaultSlot: 0, alternateSlot: 0 },
    { defaultSlot: 1, alternateSlot: 1 },
    { defaultSlot: 1, alternateSlot: 1 }
  ], 2);
  assert.equal(impossible.ok, false);
});

test('default color usage summaries stay compact', () => {
  const helpers = loadPaletteUiHelpers();
  assert.equal(helpers.formatCivilizationDefaultColorUsageSummary({ defaultNames: [] }), null);
  assert.equal(
    JSON.stringify(helpers.formatCivilizationDefaultColorUsageSummary({ defaultNames: ['Germany'] })),
    JSON.stringify({ text: 'Default: Germany', title: 'Default: Germany' })
  );
  assert.equal(
    JSON.stringify(helpers.formatCivilizationDefaultColorUsageSummary({ defaultNames: ['Germany', 'Greece', 'Rome'] })),
    JSON.stringify({ text: 'Default: Germany, Greece +1', title: 'Default: Germany, Greece, Rome' })
  );
});
