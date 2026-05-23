'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findNextResourceAtlasSlot,
  appendResourceIconToResourcesPcx,
  applyImportedResourceIconAtlasAssignments,
  findNextUnitAtlasSlot,
  appendUnitIconToUnits32Pcx,
  applyImportedUnitIconAtlasAssignments
} = require('../src/configCore');
const { decodePcx, encodePcx } = require('../src/artPreview');

const CELL = 50;
const COLS = 6;
const WIDTH = CELL * COLS;
const UNIT_SIZE = 32;
const UNIT_GUTTER = 1;
const UNIT_STRIDE = UNIT_SIZE + UNIT_GUTTER;
const UNIT_COLS = 8;
const UNIT_WIDTH = UNIT_COLS * UNIT_STRIDE + UNIT_GUTTER;
const MAGENTA = 255;

function makePalette(overrides = {}) {
  const palette = new Uint8Array(256 * 3);
  for (let idx = 0; idx < 256; idx += 1) {
    palette[idx * 3] = idx;
    palette[idx * 3 + 1] = idx;
    palette[idx * 3 + 2] = idx;
  }
  palette[MAGENTA * 3] = 255;
  palette[MAGENTA * 3 + 1] = 0;
  palette[MAGENTA * 3 + 2] = 255;
  Object.entries(overrides).forEach(([rawIndex, rgb]) => {
    const idx = Number(rawIndex);
    palette[idx * 3] = rgb[0];
    palette[idx * 3 + 1] = rgb[1];
    palette[idx * 3 + 2] = rgb[2];
  });
  return palette;
}

function paintCell(indices, slot, colorIndex, width = WIDTH) {
  const col = slot % COLS;
  const row = Math.floor(slot / COLS);
  const startX = col * CELL;
  const startY = row * CELL;
  for (let y = 0; y < CELL; y += 1) {
    const rowOff = (startY + y) * width + startX;
    for (let x = 0; x < CELL; x += 1) {
      indices[rowOff + x] = colorIndex;
    }
  }
}

function makeAtlas(rows, occupied = {}, palette = makePalette()) {
  const indices = new Uint8Array(WIDTH * rows * CELL);
  indices.fill(MAGENTA);
  Object.entries(occupied).forEach(([slot, colorIndex]) => {
    paintCell(indices, Number(slot), Number(colorIndex));
  });
  return encodePcx(indices, palette, WIDTH, rows * CELL);
}

function decodeIndexed(buffer) {
  return decodePcx(buffer, { returnIndexed: true, transparentIndexes: [] });
}

function cellHasOnlyIndex(decoded, slot, expectedIndex) {
  const col = slot % COLS;
  const row = Math.floor(slot / COLS);
  const startX = col * CELL;
  const startY = row * CELL;
  for (let y = 0; y < CELL; y += 1) {
    const rowOff = (startY + y) * decoded.width + startX;
    for (let x = 0; x < CELL; x += 1) {
      if (decoded.indices[rowOff + x] !== expectedIndex) return false;
    }
  }
  return true;
}

function paintUnitCell(indices, slot, colorIndex, width = UNIT_WIDTH) {
  const col = slot % UNIT_COLS;
  const row = Math.floor(slot / UNIT_COLS);
  const startX = col * UNIT_STRIDE + UNIT_GUTTER;
  const startY = row * UNIT_STRIDE + UNIT_GUTTER;
  for (let y = 0; y < UNIT_SIZE; y += 1) {
    const rowOff = (startY + y) * width + startX;
    for (let x = 0; x < UNIT_SIZE; x += 1) {
      indices[rowOff + x] = colorIndex;
    }
  }
}

function makeUnitAtlas(rows, occupied = {}, palette = makePalette()) {
  const height = rows * UNIT_STRIDE + UNIT_GUTTER;
  const indices = new Uint8Array(UNIT_WIDTH * height);
  indices.fill(MAGENTA);
  Object.entries(occupied).forEach(([slot, colorIndex]) => {
    paintUnitCell(indices, Number(slot), Number(colorIndex));
  });
  return encodePcx(indices, palette, UNIT_WIDTH, height);
}

function unitCellHasOnlyIndex(decoded, slot, expectedIndex) {
  const col = slot % UNIT_COLS;
  const row = Math.floor(slot / UNIT_COLS);
  const startX = col * UNIT_STRIDE + UNIT_GUTTER;
  const startY = row * UNIT_STRIDE + UNIT_GUTTER;
  for (let y = 0; y < UNIT_SIZE; y += 1) {
    const rowOff = (startY + y) * decoded.width + startX;
    for (let x = 0; x < UNIT_SIZE; x += 1) {
      if (decoded.indices[rowOff + x] !== expectedIndex) return false;
    }
  }
  return true;
}

test('findNextResourceAtlasSlot appends after the last occupied PCX cell and ignores earlier holes', () => {
  const atlas = makeAtlas(13, {
    0: 10,
    11: 11,
    75: 12
  });

  const slot = findNextResourceAtlasSlot(atlas);
  assert.equal(slot.lastOccupied, 75);
  assert.equal(slot.index, 76);
  assert.equal(slot.capacity, 78);
});

test('appendResourceIconToResourcesPcx writes the next slot without touching existing resource indices', () => {
  const target = makeAtlas(13, {
    0: 10,
    75: 12
  });
  const source = makeAtlas(2, {
    7: 40
  });

  const result = appendResourceIconToResourcesPcx({
    targetBuffer: target,
    sourceBuffer: source,
    sourceIconIndex: 7
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.index, 76);
  assert.equal(result.appendedRow, false);
  assert.equal(decoded.width, WIDTH);
  assert.equal(decoded.height, 13 * CELL);
  assert.equal(cellHasOnlyIndex(decoded, 0, 10), true, 'slot 0 should be unchanged');
  assert.equal(cellHasOnlyIndex(decoded, 75, 12), true, 'slot 75 should be unchanged');
  assert.equal(cellHasOnlyIndex(decoded, 76, 40), true, 'slot 76 should receive the imported icon');
});

test('appendResourceIconToResourcesPcx adds one magenta row when the atlas is full', () => {
  const occupied = {};
  for (let i = 0; i < 6; i += 1) occupied[i] = 20 + i;
  const target = makeAtlas(1, occupied);
  const source = makeAtlas(1, { 0: 42 });

  const result = appendResourceIconToResourcesPcx({
    targetBuffer: target,
    sourceBuffer: source,
    sourceIconIndex: 0
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.index, 6);
  assert.equal(result.appendedRow, true);
  assert.equal(decoded.height, 2 * CELL);
  for (let i = 0; i < 6; i += 1) {
    assert.equal(cellHasOnlyIndex(decoded, i, 20 + i), true, `existing slot ${i} should be unchanged`);
  }
  assert.equal(cellHasOnlyIndex(decoded, 6, 42), true, 'first cell in the new row should receive the icon');
  for (let i = 7; i < 12; i += 1) {
    assert.equal(cellHasOnlyIndex(decoded, i, MAGENTA), true, `unused new slot ${i} should be magenta`);
  }
});

test('appendResourceIconToResourcesPcx remaps source palette indexes to the target palette by color', () => {
  const targetPalette = makePalette({
    40: [12, 34, 56]
  });
  const sourcePalette = makePalette({
    10: [12, 34, 56]
  });
  const target = makeAtlas(1, { 0: 30 }, targetPalette);
  const source = makeAtlas(1, { 3: 10 }, sourcePalette);

  const result = appendResourceIconToResourcesPcx({
    targetBuffer: target,
    sourceBuffer: source,
    sourceIconIndex: 3
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.index, 1);
  assert.equal(cellHasOnlyIndex(decoded, 1, 40), true, 'source color should use the matching target palette index');
});

test('applyImportedResourceIconAtlasAssignments mutates imported GOOD icon fields to assigned PCX slots', () => {
  const target = makeAtlas(1, { 0: 30 });
  const source = makeAtlas(1, { 5: 45 });
  const resourceTab = {
    entries: [{
      civilopediaKey: 'GOOD_TEST_IMPORT',
      biqFields: [
        { baseKey: 'civilopediaentry', value: 'GOOD_TEST_IMPORT', originalValue: '' },
        { baseKey: 'icon', value: '5', originalValue: '' }
      ]
    }],
    recordOps: [{
      op: 'add',
      newRecordRef: 'GOOD_TEST_IMPORT',
      importArtFrom: '/source/scenario.biq'
    }]
  };

  const result = applyImportedResourceIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: target,
    loadSourceAtlasBuffer: () => source
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].targetIconIndex, 1);
  assert.equal(resourceTab.entries[0].biqFields.find((field) => field.baseKey === 'icon').value, '1');
  assert.equal(cellHasOnlyIndex(decoded, 1, 45), true);
});

test('applyImportedResourceIconAtlasAssignments uses pending source index after renderer predicts target slot', () => {
  const target = makeAtlas(1, { 0: 30 });
  const source = makeAtlas(1, {
    2: 44,
    5: 45
  });
  const resourceTab = {
    entries: [{
      civilopediaKey: 'GOOD_TEST_PENDING',
      _pendingImportedResourceIcon: {
        sourceIconIndex: 5,
        targetIconIndex: 1
      },
      biqFields: [
        { baseKey: 'civilopediaentry', value: 'GOOD_TEST_PENDING', originalValue: '' },
        { baseKey: 'icon', value: '1', originalValue: '' }
      ]
    }],
    recordOps: [{
      op: 'add',
      newRecordRef: 'GOOD_TEST_PENDING',
      importArtFrom: '/source/scenario.biq'
    }]
  };

  const result = applyImportedResourceIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: target,
    loadSourceAtlasBuffer: () => source
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.ok, true);
  assert.equal(result.assignments[0].sourceIconIndex, 5);
  assert.equal(result.assignments[0].targetIconIndex, 1);
  assert.equal(resourceTab.entries[0].biqFields.find((field) => field.baseKey === 'icon').value, '1');
  assert.equal(cellHasOnlyIndex(decoded, 1, 45), true, 'target slot should use pending source icon 5, not predicted target value 1');
});

test('findNextUnitAtlasSlot appends after the last occupied units_32 cell and ignores earlier holes', () => {
  const atlas = makeUnitAtlas(4, {
    0: 10,
    5: 11,
    30: 12
  });

  const slot = findNextUnitAtlasSlot(atlas);
  assert.equal(slot.lastOccupied, 30);
  assert.equal(slot.index, 31);
  assert.equal(slot.capacity, 32);
});

test('appendUnitIconToUnits32Pcx writes the next slot without touching existing unit indices', () => {
  const target = makeUnitAtlas(4, {
    0: 10,
    30: 12
  });
  const source = makeUnitAtlas(2, {
    9: 40
  });

  const result = appendUnitIconToUnits32Pcx({
    targetBuffer: target,
    sourceBuffer: source,
    sourceIconIndex: 9
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.index, 31);
  assert.equal(result.appendedRow, false);
  assert.equal(decoded.width, UNIT_WIDTH);
  assert.equal(decoded.height, 4 * UNIT_STRIDE + UNIT_GUTTER);
  assert.equal(unitCellHasOnlyIndex(decoded, 0, 10), true, 'unit slot 0 should be unchanged');
  assert.equal(unitCellHasOnlyIndex(decoded, 30, 12), true, 'unit slot 30 should be unchanged');
  assert.equal(unitCellHasOnlyIndex(decoded, 31, 40), true, 'unit slot 31 should receive the imported icon');
});

test('appendUnitIconToUnits32Pcx adds one magenta row when the atlas is full', () => {
  const occupied = {};
  for (let i = 0; i < UNIT_COLS; i += 1) occupied[i] = 20 + i;
  const target = makeUnitAtlas(1, occupied);
  const source = makeUnitAtlas(1, { 0: 42 });

  const result = appendUnitIconToUnits32Pcx({
    targetBuffer: target,
    sourceBuffer: source,
    sourceIconIndex: 0
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.index, UNIT_COLS);
  assert.equal(result.appendedRow, true);
  assert.equal(decoded.height, 2 * UNIT_STRIDE + UNIT_GUTTER);
  for (let i = 0; i < UNIT_COLS; i += 1) {
    assert.equal(unitCellHasOnlyIndex(decoded, i, 20 + i), true, `existing unit slot ${i} should be unchanged`);
  }
  assert.equal(unitCellHasOnlyIndex(decoded, UNIT_COLS, 42), true, 'first unit cell in the new row should receive the icon');
  for (let i = UNIT_COLS + 1; i < UNIT_COLS * 2; i += 1) {
    assert.equal(unitCellHasOnlyIndex(decoded, i, MAGENTA), true, `unused new unit slot ${i} should be magenta`);
  }
});

test('applyImportedUnitIconAtlasAssignments uses pending source index after renderer predicts target slot', () => {
  const target = makeUnitAtlas(1, { 0: 30 });
  const source = makeUnitAtlas(1, {
    2: 44,
    5: 45
  });
  const unitsTab = {
    entries: [{
      civilopediaKey: 'PRTO_TEST_PENDING',
      _pendingImportedUnitIcon: {
        sourceIconIndex: 5,
        targetIconIndex: 1
      },
      biqFields: [
        { baseKey: 'civilopediaentry', value: 'PRTO_TEST_PENDING', originalValue: '' },
        { baseKey: 'iconindex', value: '1', originalValue: '' }
      ]
    }],
    recordOps: [{
      op: 'add',
      newRecordRef: 'PRTO_TEST_PENDING',
      importArtFrom: '/source/scenario.biq'
    }]
  };

  const result = applyImportedUnitIconAtlasAssignments({
    unitsTab,
    targetAtlasBuffer: target,
    loadSourceAtlasBuffer: () => source
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.ok, true);
  assert.equal(result.assignments[0].sourceIconIndex, 5);
  assert.equal(result.assignments[0].targetIconIndex, 1);
  assert.equal(unitsTab.entries[0].biqFields.find((field) => field.baseKey === 'iconindex').value, '1');
  assert.equal(unitCellHasOnlyIndex(decoded, 1, 45), true, 'target slot should use pending source icon 5, not predicted target value 1');
});
