'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_PATH = path.join(__dirname, '..', 'src', 'renderer.js');
const ART_PREVIEW_PATH = path.join(__dirname, '..', 'src', 'artPreview.js');
const STYLES_PATH = path.join(__dirname, '..', 'src', 'styles.css');

test('Terrain Worker Jobs expose read-only command button atlas cells', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  assert.match(source, /const TFRM_COMMAND_BUTTON_ATLAS_CELLS = new Map/);
  [
    [0, 'Build Mine', 3, 1, 25],
    [1, 'Irrigate', 3, 2, 26],
    [2, 'Build Fortress', 3, 0, 24],
    [3, 'Build Road', 2, 6, 22],
    [4, 'Build Railroad', 2, 7, 23],
    [5, 'Plant Forest', 3, 5, 29],
    [6, 'Clear Forest', 3, 3, 27],
    [7, 'Clear Wetlands', 3, 4, 28],
    [8, 'Clear Damage', 3, 6, 30],
    [9, 'Build Airfield', 4, 1, 33],
    [10, 'Build Radar Tower', 4, 2, 34],
    [11, 'Build Outpost', 4, 3, 35],
    [12, 'Build Barricade', 4, 4, 36]
  ].forEach(([recordIndex, action, row, col, index]) => {
    assert.match(
      source,
      new RegExp(`\\[${recordIndex}, \\{ action: '${action}', row: ${row}, col: ${col}, index: ${index} \\}\\]`),
      `Expected ${action} command button mapping`
    );
  });
});

test('Terrain Worker Jobs render command buttons at the bottom of General', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  assert.match(
    source,
    /if \(selected\.code === 'TFRM' && groupName === 'General'\) \{[\s\S]*?groupCard\.appendChild\(renderTfrmCommandButtonRow\(record\)\);[\s\S]*?\}/,
    'Expected TFRM command button row to be appended to the General group'
  );
  const helperStart = source.indexOf('function renderTfrmCommandButtonRow(record)');
  assert.ok(helperStart >= 0, 'Expected TFRM command button row renderer');
  const helperEnd = source.indexOf('function parseCsvNumberLikeList', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  assert.ok(helperSource.includes('Command Button'), 'Expected command button row label');
  assert.ok(helperSource.includes('workerCommandButtonSheet'), 'Expected command button preview request');
  assert.ok(helperSource.includes('No command button mapping'), 'Expected command button empty state');
  assert.equal(helperSource.includes('worker-command-button-title'), false, 'Command name should not be repeated under the art');
});

test('Tech Tree worker-job unlocks draw 32px command button thumbnails', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  const helperStart = source.indexOf('function loadTfrmCommandButtonThumbnail(record, holder)');
  assert.ok(helperStart >= 0, 'Expected worker command button thumbnail loader');
  const helperEnd = source.indexOf('function renderTfrmCommandButtonRow', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);
  assert.ok(helperSource.includes("kind: 'workerCommandButtonSheet'"), 'Expected thumbnail loader to crop NormButtons.pcx');
  assert.ok(helperSource.includes('crop: { row: cell.row, col: cell.col, w: 32, h: 32 }'), 'Expected 32px atlas crop');
  assert.ok(helperSource.includes('getReferenceListThumbnailCanvasSize(holder)'), 'Expected thumbnail loader to honor the holder size');
  assert.ok(helperSource.includes('transparentBackground: true'), 'Expected command button thumbnails to preserve transparency');
  assert.match(
    source,
    /unlockThumb\.dataset\.thumbSize = '32'[\s\S]*?loadTfrmCommandButtonThumbnail\(item\.commandButtonRecord, holder\)/,
    'Expected Tech Tree worker-job unlock holders to request 32px command-button thumbnails'
  );
});

test('Worker command button preview resolves NormButtons through Conquests art lookup', () => {
  const source = fs.readFileSync(ART_PREVIEW_PATH, 'utf8');
  assert.match(
    source,
    /if \(kind === 'workerCommandButtonSheet'\) \{[\s\S]*?resolveConquestsAssetPath\([\s\S]*?NormButtons\.pcx[\s\S]*?decodeByPath\(pcxPath, request\.crop, \{ transparentIndexes: \[0, 254, 255\] \}\)/,
    'Expected worker command button previews to resolve and crop NormButtons.pcx'
  );
});

test('Tech Tree obsolete improvement thumbnails draw a red X overlay', () => {
  const styles = fs.readFileSync(STYLES_PATH, 'utf8');
  assert.match(styles, /\.tech-tree-node-game-box \.tech-tree-node-obsolete-thumb::before/);
  assert.match(styles, /\.tech-tree-node-game-box \.tech-tree-node-obsolete-thumb::after/);
  assert.match(styles, /background: #d71920/);
  assert.match(styles, /transform: rotate\(45deg\)/);
  assert.match(styles, /transform: rotate\(-45deg\)/);
});
