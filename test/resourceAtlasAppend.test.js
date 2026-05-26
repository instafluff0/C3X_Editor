'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findNextResourceAtlasSlot,
  getNextResourceAtlasAssignmentSlot,
  appendResourceIconToResourcesPcx,
  applyImportedResourceIconAtlasAssignments,
  findNextUnitAtlasSlot,
  getNextUnitAtlasAssignmentSlot,
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

function paintResourceGrid(indices, rows, borderIndex = 254, width = WIDTH) {
  for (let row = 0; row < rows; row += 1) {
    const startY = row * CELL;
    for (let x = 0; x < width; x += 1) {
      indices[startY * width + x] = borderIndex;
    }
  }
  for (let col = 0; col < COLS; col += 1) {
    const startX = col * CELL;
    for (let y = 0; y < rows * CELL; y += 1) {
      indices[y * width + startX] = borderIndex;
    }
  }
}

function paintResourceIconInterior(indices, slot, colorIndex, width = WIDTH) {
  const col = slot % COLS;
  const row = Math.floor(slot / COLS);
  const startX = col * CELL;
  const startY = row * CELL;
  for (let y = 12; y < 22; y += 1) {
    const rowOff = (startY + y) * width + startX;
    for (let x = 12; x < 22; x += 1) {
      indices[rowOff + x] = colorIndex;
    }
  }
}

function makeResourceGridAtlas(rows, occupied = {}, palette = makePalette()) {
  const indices = new Uint8Array(WIDTH * rows * CELL);
  indices.fill(MAGENTA);
  paintResourceGrid(indices, rows, 254);
  Object.entries(occupied).forEach(([slot, colorIndex]) => {
    paintResourceIconInterior(indices, Number(slot), Number(colorIndex));
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

test('findNextResourceAtlasSlot treats resources.pcx grid-only right-most cells as open', () => {
  const atlas = makeResourceGridAtlas(1, {
    0: 10,
    1: 11,
    2: 12,
    3: 13,
    4: 14
  });

  const slot = findNextResourceAtlasSlot(atlas);
  assert.equal(slot.lastOccupied, 4);
  assert.equal(slot.index, 5);
  assert.equal(slot.capacity, 6);
});

test('getNextResourceAtlasAssignmentSlot respects existing BIQ icon references beyond visible pixels', () => {
  const atlas = makeResourceGridAtlas(5, {
    0: 10
  });
  const resourceTab = {
    entries: [
      {
        civilopediaKey: 'GOOD_EXISTING_HIGH',
        biqFields: [{ baseKey: 'icon', value: '25', originalValue: '25' }]
      },
      {
        civilopediaKey: 'GOOD_IMPORT',
        _pendingImportedResourceIcon: { sourceIconIndex: 2, targetIconIndex: 1 },
        biqFields: [{ baseKey: 'icon', value: '1', originalValue: '' }]
      }
    ],
    recordOps: [{
      op: 'add',
      newRecordRef: 'GOOD_IMPORT',
      importArtFrom: '/source/scenario.biq'
    }]
  };

  const slot = getNextResourceAtlasAssignmentSlot(atlas, resourceTab);
  assert.equal(slot.scanIndex, 1);
  assert.equal(slot.referenceFloor, 26);
  assert.equal(slot.index, 26);
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

test('applyImportedResourceIconAtlasAssignments compacts pending targets after an imported resource is deleted before save', () => {
  const target = makeResourceGridAtlas(2, {
    0: 30
  });
  const source = makeAtlas(1, {
    1: 41,
    2: 42,
    3: 43
  });
  const resourceTab = {
    entries: [
      {
        civilopediaKey: 'GOOD_EXISTING_HIGH',
        biqFields: [{ baseKey: 'icon', value: '5', originalValue: '5' }]
      },
      {
        civilopediaKey: 'GOOD_IMPORT_A',
        _pendingImportedResourceIcon: { sourceIconIndex: 1, targetIconIndex: 6 },
        biqFields: [{ baseKey: 'icon', value: '6', originalValue: '' }]
      },
      {
        civilopediaKey: 'GOOD_IMPORT_C',
        _pendingImportedResourceIcon: { sourceIconIndex: 3, targetIconIndex: 8 },
        biqFields: [{ baseKey: 'icon', value: '8', originalValue: '' }]
      }
    ],
    recordOps: [
      { op: 'add', newRecordRef: 'GOOD_IMPORT_A', importArtFrom: '/source/scenario.biq' },
      { op: 'add', newRecordRef: 'GOOD_IMPORT_B', importArtFrom: '/source/scenario.biq' },
      { op: 'add', newRecordRef: 'GOOD_IMPORT_C', importArtFrom: '/source/scenario.biq' },
      { op: 'delete', recordRef: 'GOOD_IMPORT_B' }
    ]
  };

  const result = applyImportedResourceIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: target,
    loadSourceAtlasBuffer: () => source
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.ok, true);
  assert.deepEqual(result.assignments.map((item) => item.civilopediaKey), ['GOOD_IMPORT_A', 'GOOD_IMPORT_C']);
  assert.deepEqual(result.assignments.map((item) => item.targetIconIndex), [6, 7]);
  assert.equal(resourceTab.entries.find((entry) => entry.civilopediaKey === 'GOOD_IMPORT_A').biqFields[0].value, '6');
  assert.equal(resourceTab.entries.find((entry) => entry.civilopediaKey === 'GOOD_IMPORT_C').biqFields[0].value, '7');
  assert.equal(cellHasOnlyIndex(decoded, 6, 41), true);
  assert.equal(cellHasOnlyIndex(decoded, 7, 43), true);
});

test('applyImportedResourceIconAtlasAssignments keeps a same-key import active when an old record was deleted first', () => {
  const target = makeResourceGridAtlas(1, {
    0: 30
  });
  const source = makeAtlas(1, {
    2: 42
  });
  const resourceTab = {
    entries: [{
      civilopediaKey: 'GOOD_REUSED_KEY',
      _pendingImportedResourceIcon: { sourceIconIndex: 2, targetIconIndex: 1 },
      biqFields: [{ baseKey: 'icon', value: '1', originalValue: '' }]
    }],
    recordOps: [
      { op: 'delete', recordRef: 'GOOD_REUSED_KEY' },
      { op: 'add', newRecordRef: 'GOOD_REUSED_KEY', importArtFrom: '/source/scenario.biq' }
    ]
  };

  const result = applyImportedResourceIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: target,
    loadSourceAtlasBuffer: () => source
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.ok, true);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].targetIconIndex, 1);
  assert.equal(resourceTab.entries[0].biqFields[0].value, '1');
  assert.equal(cellHasOnlyIndex(decoded, 1, 42), true);
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

test('findNextUnitAtlasSlot uses the right-most open unit slot before adding a row', () => {
  const occupied = {};
  for (let i = 0; i < UNIT_COLS - 1; i += 1) occupied[i] = 20 + i;
  const atlas = makeUnitAtlas(1, occupied);

  const slot = findNextUnitAtlasSlot(atlas);
  assert.equal(slot.lastOccupied, UNIT_COLS - 2);
  assert.equal(slot.index, UNIT_COLS - 1);
  assert.equal(slot.capacity, UNIT_COLS);
});

test('getNextUnitAtlasAssignmentSlot respects existing BIQ icon references beyond visible pixels', () => {
  const atlas = makeUnitAtlas(3, {
    0: 10
  });
  const unitsTab = {
    entries: [
      {
        civilopediaKey: 'PRTO_EXISTING_HIGH',
        biqFields: [{ baseKey: 'iconindex', value: '20', originalValue: '20' }]
      },
      {
        civilopediaKey: 'PRTO_IMPORT',
        _pendingImportedUnitIcon: { sourceIconIndex: 2, targetIconIndex: 1 },
        biqFields: [{ baseKey: 'iconindex', value: '1', originalValue: '' }]
      }
    ],
    recordOps: [{
      op: 'add',
      newRecordRef: 'PRTO_IMPORT',
      importArtFrom: '/source/scenario.biq'
    }]
  };

  const slot = getNextUnitAtlasAssignmentSlot(atlas, unitsTab);
  assert.equal(slot.scanIndex, 1);
  assert.equal(slot.referenceFloor, 21);
  assert.equal(slot.index, 21);
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

test('applyImportedUnitIconAtlasAssignments compacts pending targets after an imported unit is deleted before save', () => {
  const target = makeUnitAtlas(2, {
    0: 30
  });
  const source = makeUnitAtlas(1, {
    1: 41,
    2: 42,
    3: 43
  });
  const unitsTab = {
    entries: [
      {
        civilopediaKey: 'PRTO_EXISTING_HIGH',
        biqFields: [{ baseKey: 'iconindex', value: '7', originalValue: '7' }]
      },
      {
        civilopediaKey: 'PRTO_IMPORT_A',
        _pendingImportedUnitIcon: { sourceIconIndex: 1, targetIconIndex: 8 },
        biqFields: [{ baseKey: 'iconindex', value: '8', originalValue: '' }]
      },
      {
        civilopediaKey: 'PRTO_IMPORT_C',
        _pendingImportedUnitIcon: { sourceIconIndex: 3, targetIconIndex: 10 },
        biqFields: [{ baseKey: 'iconindex', value: '10', originalValue: '' }]
      }
    ],
    recordOps: [
      { op: 'add', newRecordRef: 'PRTO_IMPORT_A', importArtFrom: '/source/scenario.biq' },
      { op: 'add', newRecordRef: 'PRTO_IMPORT_B', importArtFrom: '/source/scenario.biq' },
      { op: 'add', newRecordRef: 'PRTO_IMPORT_C', importArtFrom: '/source/scenario.biq' },
      { op: 'delete', recordRef: 'PRTO_IMPORT_B' }
    ]
  };

  const result = applyImportedUnitIconAtlasAssignments({
    unitsTab,
    targetAtlasBuffer: target,
    loadSourceAtlasBuffer: () => source
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.ok, true);
  assert.deepEqual(result.assignments.map((item) => item.civilopediaKey), ['PRTO_IMPORT_A', 'PRTO_IMPORT_C']);
  assert.deepEqual(result.assignments.map((item) => item.targetIconIndex), [8, 9]);
  assert.equal(unitsTab.entries.find((entry) => entry.civilopediaKey === 'PRTO_IMPORT_A').biqFields[0].value, '8');
  assert.equal(unitsTab.entries.find((entry) => entry.civilopediaKey === 'PRTO_IMPORT_C').biqFields[0].value, '9');
  assert.equal(unitCellHasOnlyIndex(decoded, 8, 41), true);
  assert.equal(unitCellHasOnlyIndex(decoded, 9, 43), true);
});
