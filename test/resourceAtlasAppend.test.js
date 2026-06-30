'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findNextResourceAtlasSlot,
  getNextResourceAtlasAssignmentSlot,
  appendResourceIconToResourcesPcx,
  applyImportedResourceIconAtlasAssignments,
  getIndexedLuxuryIconsSmallAtlas,
  findNextLuxuryIconsSmallAtlasSlot,
  getResourceLuxuryOrdinal,
  appendLuxuryIconToLuxuryIconsSmallPcx,
  applyImportedLuxuryIconAtlasAssignments,
  findNextUnitAtlasSlot,
  getNextUnitAtlasAssignmentSlot,
  appendUnitIconToUnits32Pcx,
  applyImportedUnitIconAtlasAssignments,
  findNextBuildingCityAtlasRow,
  findNextBuildingCityAtlasPairRow,
  getNextBuildingCityAtlasAssignmentRow,
  appendBuildingCityIconRowToAtlases,
  applyImportedBuildingCityIconAtlasAssignments
} = require('../src/configCore');
const { decodePcx, encodePcx } = require('../src/artPreview');

const CELL = 50;
const COLS = 6;
const WIDTH = CELL * COLS;
const LUXURY_CELL = 22;
const LUXURY_COLS = 8;
const LUXURY_WIDTH = 200;
const UNIT_SIZE = 32;
const UNIT_GUTTER = 1;
const UNIT_STRIDE = UNIT_SIZE + UNIT_GUTTER;
const UNIT_COLS = 8;
const UNIT_WIDTH = UNIT_COLS * UNIT_STRIDE + UNIT_GUTTER;
const MAGENTA = 255;
const GUIDE = 254;
const BUILDING_ORIGIN = 32;
const BUILDING_LARGE = { size: 'large', cellW: 51, cellH: 41, drawW: 50, drawH: 40, cols: 8 };
const BUILDING_SMALL = { size: 'small', cellW: 33, cellH: 33, drawW: 32, drawH: 32, cols: 12 };

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
  palette[GUIDE * 3] = 0;
  palette[GUIDE * 3 + 1] = 255;
  palette[GUIDE * 3 + 2] = 0;
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

function paintLuxuryGuides(indices, rows, width = LUXURY_WIDTH, guideIndex = GUIDE) {
  const gridHeight = rows * LUXURY_CELL;
  for (let row = 0; row <= rows; row += 1) {
    const y = row * LUXURY_CELL;
    if (y >= gridHeight) continue;
    for (let x = 0; x <= LUXURY_COLS * LUXURY_CELL && x < width; x += 1) {
      indices[y * width + x] = guideIndex;
    }
  }
  for (let col = 0; col <= LUXURY_COLS; col += 1) {
    const x = col * LUXURY_CELL;
    if (x >= width) continue;
    for (let y = 0; y < gridHeight; y += 1) {
      indices[y * width + x] = guideIndex;
    }
  }
}

function paintLuxuryIconInterior(indices, slot, colorIndex, width = LUXURY_WIDTH) {
  const col = slot % LUXURY_COLS;
  const row = Math.floor(slot / LUXURY_COLS);
  const startX = col * LUXURY_CELL;
  const startY = row * LUXURY_CELL;
  for (let y = 5; y < 17; y += 1) {
    const rowOff = (startY + y) * width + startX;
    for (let x = 5; x < 17; x += 1) {
      indices[rowOff + x] = colorIndex;
    }
  }
}

function makeLuxuryAtlas(rows, occupied = {}, palette = makePalette(), { footerHeight = 12, rightAnnotationIndex = 77, footerIndex = 78 } = {}) {
  const height = rows * LUXURY_CELL + footerHeight;
  const indices = new Uint8Array(LUXURY_WIDTH * height);
  indices.fill(MAGENTA);
  paintLuxuryGuides(indices, rows);
  for (let y = 0; y < rows * LUXURY_CELL; y += 1) {
    const rowOff = y * LUXURY_WIDTH;
    for (let x = LUXURY_COLS * LUXURY_CELL; x < LUXURY_WIDTH; x += 1) {
      indices[rowOff + x] = rightAnnotationIndex;
    }
  }
  for (let y = rows * LUXURY_CELL; y < height; y += 1) {
    const rowOff = y * LUXURY_WIDTH;
    for (let x = 0; x < LUXURY_WIDTH; x += 1) {
      indices[rowOff + x] = footerIndex;
    }
  }
  Object.entries(occupied).forEach(([slot, colorIndex]) => {
    paintLuxuryIconInterior(indices, Number(slot), Number(colorIndex));
  });
  return encodePcx(indices, palette, LUXURY_WIDTH, height);
}

function luxuryCellInteriorHasOnlyIndex(decoded, slot, expectedIndex) {
  const col = slot % LUXURY_COLS;
  const row = Math.floor(slot / LUXURY_COLS);
  const startX = col * LUXURY_CELL;
  const startY = row * LUXURY_CELL;
  for (let y = 1; y < LUXURY_CELL; y += 1) {
    const rowOff = (startY + y) * decoded.width + startX;
    for (let x = 1; x < LUXURY_CELL; x += 1) {
      if (decoded.indices[rowOff + x] !== expectedIndex) return false;
    }
  }
  return true;
}

function luxuryIconPaintedRegionHasIndex(decoded, slot, expectedIndex) {
  const col = slot % LUXURY_COLS;
  const row = Math.floor(slot / LUXURY_COLS);
  const startX = col * LUXURY_CELL;
  const startY = row * LUXURY_CELL;
  for (let y = 5; y < 17; y += 1) {
    const rowOff = (startY + y) * decoded.width + startX;
    for (let x = 5; x < 17; x += 1) {
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

function makeBuildingAtlas(sizeSpec, rows, occupied = {}, palette = makePalette()) {
  const width = BUILDING_ORIGIN + sizeSpec.cols * sizeSpec.cellW + 8;
  const height = BUILDING_ORIGIN + rows * sizeSpec.cellH + 7;
  const indices = new Uint8Array(width * height);
  indices.fill(MAGENTA);
  paintBuildingGuides(indices, width, height, sizeSpec);
  Object.entries(occupied).forEach(([key, colorIndex]) => {
    const [row, col] = String(key).split(':').map((v) => Number(v));
    paintBuildingCell(indices, width, sizeSpec, row, col, Number(colorIndex));
  });
  return encodePcx(indices, palette, width, height);
}

function paintBuildingGuides(indices, width, height, sizeSpec) {
  for (let row = 0; row <= Math.floor((height - BUILDING_ORIGIN - 1) / sizeSpec.cellH); row += 1) {
    const y = BUILDING_ORIGIN + row * sizeSpec.cellH;
    if (y >= height) continue;
    for (let x = BUILDING_ORIGIN; x <= BUILDING_ORIGIN + sizeSpec.cols * sizeSpec.cellW && x < width; x += 1) {
      indices[y * width + x] = GUIDE;
    }
  }
  for (let col = 0; col <= sizeSpec.cols; col += 1) {
    const x = BUILDING_ORIGIN + col * sizeSpec.cellW;
    if (x >= width) continue;
    for (let y = BUILDING_ORIGIN; y < height; y += 1) {
      indices[y * width + x] = GUIDE;
    }
  }
}

function paintBuildingCell(indices, width, sizeSpec, row, col, colorIndex) {
  const startX = BUILDING_ORIGIN + col * sizeSpec.cellW + 1;
  const startY = BUILDING_ORIGIN + row * sizeSpec.cellH + 1;
  for (let y = 0; y < sizeSpec.drawH; y += 1) {
    const rowOff = (startY + y) * width + startX;
    for (let x = 0; x < sizeSpec.drawW; x += 1) {
      indices[rowOff + x] = colorIndex;
    }
  }
}

function buildingCellHasOnlyIndex(decoded, sizeSpec, row, col, expectedIndex) {
  const startX = BUILDING_ORIGIN + col * sizeSpec.cellW + 1;
  const startY = BUILDING_ORIGIN + row * sizeSpec.cellH + 1;
  for (let y = 0; y < sizeSpec.drawH; y += 1) {
    const rowOff = (startY + y) * decoded.width + startX;
    for (let x = 0; x < sizeSpec.drawW; x += 1) {
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

test('luxuryicons_small.pcx geometry uses 22px cells, 8 icon columns, and ignores annotation margins', () => {
  const atlas = makeLuxuryAtlas(4, {
    0: 10,
    9: 11
  });
  const decoded = getIndexedLuxuryIconsSmallAtlas(atlas);
  const slot = findNextLuxuryIconsSmallAtlasSlot(atlas);

  assert.equal(decoded.width, LUXURY_WIDTH);
  assert.equal(decoded.rows, 4);
  assert.equal(decoded.cols, 8);
  assert.equal(decoded.footerHeight, 12);
  assert.equal(slot.lastOccupied, 9);
  assert.equal(slot.index, 10);
  assert.equal(slot.capacity, 32);
});

test('getResourceLuxuryOrdinal counts only BIQ Luxury resources in order', () => {
  const makeResource = (key, type) => ({
    civilopediaKey: key,
    biqFields: [{ baseKey: 'type', value: type, originalValue: type }]
  });
  const resourceTab = {
    entries: [
      makeResource('GOOD_CATTLE', 'Bonus (0)'),
      makeResource('GOOD_DYES', 'Luxury (1)'),
      makeResource('GOOD_IRON', 'Strategic (2)'),
      makeResource('GOOD_INCENSE', '1'),
      makeResource('GOOD_WHEAT', '0')
    ]
  };

  assert.equal(getResourceLuxuryOrdinal(resourceTab, 'GOOD_DYES'), 0);
  assert.equal(getResourceLuxuryOrdinal(resourceTab, 'GOOD_INCENSE'), 1);
  assert.equal(getResourceLuxuryOrdinal(resourceTab, 'GOOD_IRON'), -1);
});

test('appendLuxuryIconToLuxuryIconsSmallPcx copies a source Luxury slot to the target BIQ Luxury slot', () => {
  const target = makeLuxuryAtlas(2, {
    0: 20
  });
  const source = makeLuxuryAtlas(2, {
    9: 40
  });

  const result = appendLuxuryIconToLuxuryIconsSmallPcx({
    targetBuffer: target,
    sourceBuffer: source,
    sourceIconIndex: 9,
    targetIconIndex: 2
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.index, 2);
  assert.equal(result.appendedRow, false);
  assert.equal(decoded.width, LUXURY_WIDTH);
  assert.equal(decoded.height, 2 * LUXURY_CELL + 12);
  assert.equal(luxuryIconPaintedRegionHasIndex(decoded, 0, 20), true, 'existing target luxury icon should be unchanged');
  assert.equal(luxuryIconPaintedRegionHasIndex(decoded, 2, 40), true, 'target Luxury slot should receive source icon');
});

test('appendLuxuryIconToLuxuryIconsSmallPcx remaps source palette indexes and preserves bottom annotation when adding a row', () => {
  const targetPalette = makePalette({
    44: [21, 45, 89]
  });
  const sourcePalette = makePalette({
    9: [21, 45, 89]
  });
  const target = makeLuxuryAtlas(1, { 0: 20 }, targetPalette, { footerHeight: 12, footerIndex: 70 });
  const source = makeLuxuryAtlas(1, { 1: 9 }, sourcePalette);

  const result = appendLuxuryIconToLuxuryIconsSmallPcx({
    targetBuffer: target,
    sourceBuffer: source,
    sourceIconIndex: 1,
    targetIconIndex: 8
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.appendedRow, true);
  assert.equal(decoded.height, 2 * LUXURY_CELL + 12);
  assert.equal(luxuryIconPaintedRegionHasIndex(decoded, 8, 44), true, 'source color should use matching target palette index');
  const footerY = 2 * LUXURY_CELL;
  assert.equal(decoded.indices[footerY * decoded.width], 70, 'bottom annotation should move below the inserted grid row');
});

test('applyImportedLuxuryIconAtlasAssignments copies only imported Luxury resources', () => {
  const makeResource = (key, type, sourceLuxuryIndex = null) => ({
    civilopediaKey: key,
    _pendingImportedLuxuryIcon: sourceLuxuryIndex == null ? undefined : { sourceIconIndex: sourceLuxuryIndex, targetIconIndex: null },
    biqFields: [{ baseKey: 'type', value: type, originalValue: type }]
  });
  const target = makeLuxuryAtlas(1, { 0: 20 });
  const source = makeLuxuryAtlas(1, {
    1: 41,
    2: 42
  });
  const resourceTab = {
    entries: [
      makeResource('GOOD_EXISTING_LUX', 'Luxury (1)'),
      makeResource('GOOD_IMPORT_BONUS', 'Bonus (0)'),
      makeResource('GOOD_IMPORT_LUXURY', 'Luxury (1)', 2)
    ],
    recordOps: [
      { op: 'add', newRecordRef: 'GOOD_IMPORT_BONUS', importArtFrom: '/source/scenario.biq', sourceRef: 'GOOD_SOURCE_BONUS' },
      { op: 'add', newRecordRef: 'GOOD_IMPORT_LUXURY', importArtFrom: '/source/scenario.biq', sourceRef: 'GOOD_SOURCE_LUXURY' }
    ]
  };

  const result = applyImportedLuxuryIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: target,
    loadSourceAtlasBuffer: () => source
  });
  const decoded = decodeIndexed(result.buffer);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.assignments.map((item) => item.civilopediaKey), ['GOOD_IMPORT_LUXURY']);
  assert.equal(result.assignments[0].targetIconIndex, 1);
  assert.equal(luxuryIconPaintedRegionHasIndex(decoded, 1, 42), true);
});

test('imported Luxury resources update both resources.pcx and luxuryicons_small.pcx assignments', () => {
  const targetResourceAtlas = makeAtlas(1, {
    0: 20
  });
  const sourceResourceAtlas = makeAtlas(1, {
    4: 40
  });
  const targetLuxuryAtlas = makeLuxuryAtlas(1, {
    0: 21
  });
  const sourceLuxuryAtlas = makeLuxuryAtlas(1, {
    2: 42
  });
  const iconField = { baseKey: 'icon', value: '0', originalValue: '0' };
  const resourceTab = {
    entries: [
      {
        civilopediaKey: 'GOOD_EXISTING_LUXURY',
        biqFields: [{ baseKey: 'type', value: 'Luxury (1)', originalValue: 'Luxury (1)' }]
      },
      {
        civilopediaKey: 'GOOD_IMPORTED_LUXURY',
        _pendingImportedResourceIcon: { sourceIconIndex: 4, targetIconIndex: null },
        _pendingImportedLuxuryIcon: { sourceIconIndex: 2, targetIconIndex: null },
        biqFields: [
          iconField,
          { baseKey: 'type', value: 'Luxury (1)', originalValue: 'Luxury (1)' }
        ]
      }
    ],
    recordOps: [{
      op: 'add',
      newRecordRef: 'GOOD_IMPORTED_LUXURY',
      importArtFrom: '/source/scenario.biq',
      sourceRef: 'GOOD_SOURCE_LUXURY'
    }]
  };

  const resourceResult = applyImportedResourceIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: targetResourceAtlas,
    loadSourceAtlasBuffer: () => sourceResourceAtlas
  });
  const luxuryResult = applyImportedLuxuryIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: targetLuxuryAtlas,
    loadSourceAtlasBuffer: () => sourceLuxuryAtlas
  });
  const resourceDecoded = decodeIndexed(resourceResult.buffer);
  const luxuryDecoded = decodeIndexed(luxuryResult.buffer);

  assert.equal(resourceResult.changed, true);
  assert.equal(luxuryResult.changed, true);
  assert.equal(iconField.value, '1', 'resources.pcx icon field should point at appended map icon slot');
  assert.equal(cellHasOnlyIndex(resourceDecoded, 1, 40), true, 'resources.pcx should receive the source map icon');
  assert.equal(luxuryResult.assignments[0].targetIconIndex, 1);
  assert.equal(luxuryIconPaintedRegionHasIndex(luxuryDecoded, 1, 42), true, 'luxuryicons_small.pcx should receive the source city icon');
});

test('applyImportedLuxuryIconAtlasAssignments warns but still succeeds when luxuryicons_small.pcx is missing', () => {
  const resourceTab = {
    entries: [{
      civilopediaKey: 'GOOD_IMPORT_LUXURY',
      _pendingImportedLuxuryIcon: { sourceIconIndex: 0, targetIconIndex: null },
      biqFields: [{ baseKey: 'type', value: 'Luxury (1)', originalValue: 'Luxury (1)' }]
    }],
    recordOps: [{
      op: 'add',
      newRecordRef: 'GOOD_IMPORT_LUXURY',
      importArtFrom: '/source/scenario.biq',
      sourceRef: 'GOOD_SOURCE_LUXURY'
    }]
  };

  const result = applyImportedLuxuryIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer: null,
    loadSourceAtlasBuffer: () => null
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.match(result.warnings.join(' '), /target luxuryicons_small\.pcx/i);
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

test('findNextBuildingCityAtlasRow uses Civ3 city-screen row geometry and ignores guide-only rows', () => {
  const large = makeBuildingAtlas(BUILDING_LARGE, 5, {
    '0:0': 10,
    '2:4': 14
  });
  const small = makeBuildingAtlas(BUILDING_SMALL, 7, {
    '0:0': 10,
    '3:4': 15
  });

  const largeSlot = findNextBuildingCityAtlasRow(large, 'large');
  const smallSlot = findNextBuildingCityAtlasRow(small, 'small');
  const pairSlot = findNextBuildingCityAtlasPairRow({ large, small });

  assert.equal(largeSlot.lastOccupied, 2);
  assert.equal(largeSlot.index, 3);
  assert.equal(largeSlot.cols, 8);
  assert.equal(smallSlot.lastOccupied, 3);
  assert.equal(smallSlot.index, 4);
  assert.equal(smallSlot.cols, 12);
  assert.equal(pairSlot.index, 4);
});

test('getNextBuildingCityAtlasAssignmentRow respects existing PediaIcons row indexes beyond visible pixels', () => {
  const large = makeBuildingAtlas(BUILDING_LARGE, 4, { '0:0': 10 });
  const small = makeBuildingAtlas(BUILDING_SMALL, 4, { '0:0': 10 });
  const improvementsTab = {
    entries: [
      { civilopediaKey: 'BLDG_EXISTING_HIGH', buildingIconIndex: '8' },
      {
        civilopediaKey: 'BLDG_IMPORT',
        buildingIconIndex: '1',
        _pendingImportedBuildingCityIcon: { sourceIconIndex: 2, targetIconIndex: 1 }
      }
    ],
    recordOps: [{
      op: 'add',
      newRecordRef: 'BLDG_IMPORT',
      importArtFrom: '/source/scenario.biq'
    }]
  };

  const slot = getNextBuildingCityAtlasAssignmentRow({ large, small }, improvementsTab);
  assert.equal(slot.scanIndex, 1);
  assert.equal(slot.referenceFloor, 9);
  assert.equal(slot.index, 9);
});

test('appendBuildingCityIconRowToAtlases copies the correct culture columns in both large and small PCX files', () => {
  const targetLarge = makeBuildingAtlas(BUILDING_LARGE, 2, { '0:0': 10 });
  const targetSmall = makeBuildingAtlas(BUILDING_SMALL, 2, { '0:0': 11 });
  const sourceLarge = makeBuildingAtlas(BUILDING_LARGE, 4, {
    '3:0': 40,
    '3:1': 41,
    '3:2': 42,
    '3:3': 43,
    '3:4': 44,
    '3:5': 45
  });
  const sourceSmall = makeBuildingAtlas(BUILDING_SMALL, 4, {
    '3:0': 50,
    '3:1': 51,
    '3:2': 52,
    '3:3': 53,
    '3:4': 54,
    '3:5': 55
  });

  const result = appendBuildingCityIconRowToAtlases({
    targetBuffers: { large: targetLarge, small: targetSmall },
    sourceBuffers: { large: sourceLarge, small: sourceSmall },
    sourceIconIndex: 3,
    kind: 'CULTURE'
  });
  const decodedLarge = decodeIndexed(result.buffers.large);
  const decodedSmall = decodeIndexed(result.buffers.small);

  assert.equal(result.index, 1);
  assert.equal(result.large.columnCount, 5);
  assert.equal(result.small.columnCount, 5);
  assert.equal(buildingCellHasOnlyIndex(decodedLarge, BUILDING_LARGE, 0, 0, 10), true, 'existing large row should be unchanged');
  assert.equal(buildingCellHasOnlyIndex(decodedSmall, BUILDING_SMALL, 0, 0, 11), true, 'existing small row should be unchanged');
  for (let col = 0; col < 5; col += 1) {
    assert.equal(buildingCellHasOnlyIndex(decodedLarge, BUILDING_LARGE, 1, col, 40 + col), true, `large culture col ${col} should be copied`);
    assert.equal(buildingCellHasOnlyIndex(decodedSmall, BUILDING_SMALL, 1, col, 50 + col), true, `small culture col ${col} should be copied`);
  }
  assert.equal(buildingCellHasOnlyIndex(decodedLarge, BUILDING_LARGE, 1, 5, MAGENTA), true, 'unused large culture-adjacent column should stay magenta');
  assert.equal(buildingCellHasOnlyIndex(decodedSmall, BUILDING_SMALL, 1, 5, MAGENTA), true, 'unused small culture-adjacent column should stay magenta');
});

test('applyImportedBuildingCityIconAtlasAssignments uses pending source row and mutates imported BLDG city icon indexes', () => {
  const targetLarge = makeBuildingAtlas(BUILDING_LARGE, 2, { '0:0': 10 });
  const targetSmall = makeBuildingAtlas(BUILDING_SMALL, 2, { '0:0': 11 });
  const sourceLarge = makeBuildingAtlas(BUILDING_LARGE, 4, {
    '2:0': 42,
    '3:0': 43
  });
  const sourceSmall = makeBuildingAtlas(BUILDING_SMALL, 4, {
    '2:0': 52,
    '3:0': 53
  });
  const improvementsTab = {
    entries: [{
      civilopediaKey: 'BLDG_TEST_IMPORT',
      buildingIconKind: 'SINGLE',
      buildingIconIndex: '1',
      _pendingImportedBuildingCityIcon: {
        sourceIconIndex: 3,
        targetIconIndex: 1,
        kind: 'SINGLE'
      }
    }],
    recordOps: [{
      op: 'add',
      newRecordRef: 'BLDG_TEST_IMPORT',
      importArtFrom: '/source/scenario.biq'
    }]
  };

  const result = applyImportedBuildingCityIconAtlasAssignments({
    improvementsTab,
    targetAtlasBuffers: { large: targetLarge, small: targetSmall },
    loadSourceAtlasBuffers: () => ({ large: sourceLarge, small: sourceSmall })
  });
  const decodedLarge = decodeIndexed(result.buffers.large);
  const decodedSmall = decodeIndexed(result.buffers.small);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.assignments[0].sourceIconIndex, 3);
  assert.equal(result.assignments[0].targetIconIndex, 1);
  assert.equal(improvementsTab.entries[0].buildingIconIndex, '1');
  assert.equal(buildingCellHasOnlyIndex(decodedLarge, BUILDING_LARGE, 1, 0, 43), true, 'target large row should use pending source row 3');
  assert.equal(buildingCellHasOnlyIndex(decodedSmall, BUILDING_SMALL, 1, 0, 53), true, 'target small row should use pending source row 3');
});

test('applyImportedBuildingCityIconAtlasAssignments compacts pending city icon rows after an imported improvement is deleted before save', () => {
  const targetLarge = makeBuildingAtlas(BUILDING_LARGE, 3, { '0:0': 10 });
  const targetSmall = makeBuildingAtlas(BUILDING_SMALL, 3, { '0:0': 11 });
  const sourceLarge = makeBuildingAtlas(BUILDING_LARGE, 5, {
    '1:0': 41,
    '2:0': 42,
    '3:0': 43
  });
  const sourceSmall = makeBuildingAtlas(BUILDING_SMALL, 5, {
    '1:0': 51,
    '2:0': 52,
    '3:0': 53
  });
  const improvementsTab = {
    entries: [
      { civilopediaKey: 'BLDG_EXISTING_HIGH', buildingIconIndex: '4' },
      {
        civilopediaKey: 'BLDG_IMPORT_A',
        buildingIconKind: 'SINGLE',
        buildingIconIndex: '5',
        _pendingImportedBuildingCityIcon: { sourceIconIndex: 1, targetIconIndex: 5, kind: 'SINGLE' }
      },
      {
        civilopediaKey: 'BLDG_IMPORT_C',
        buildingIconKind: 'SINGLE',
        buildingIconIndex: '7',
        _pendingImportedBuildingCityIcon: { sourceIconIndex: 3, targetIconIndex: 7, kind: 'SINGLE' }
      }
    ],
    recordOps: [
      { op: 'add', newRecordRef: 'BLDG_IMPORT_A', importArtFrom: '/source/scenario.biq' },
      { op: 'add', newRecordRef: 'BLDG_IMPORT_B', importArtFrom: '/source/scenario.biq' },
      { op: 'add', newRecordRef: 'BLDG_IMPORT_C', importArtFrom: '/source/scenario.biq' },
      { op: 'delete', recordRef: 'BLDG_IMPORT_B' }
    ]
  };

  const result = applyImportedBuildingCityIconAtlasAssignments({
    improvementsTab,
    targetAtlasBuffers: { large: targetLarge, small: targetSmall },
    loadSourceAtlasBuffers: () => ({ large: sourceLarge, small: sourceSmall })
  });
  const decodedLarge = decodeIndexed(result.buffers.large);
  const decodedSmall = decodeIndexed(result.buffers.small);

  assert.equal(result.ok, true);
  assert.deepEqual(result.assignments.map((item) => item.civilopediaKey), ['BLDG_IMPORT_A', 'BLDG_IMPORT_C']);
  assert.deepEqual(result.assignments.map((item) => item.targetIconIndex), [5, 6]);
  assert.equal(improvementsTab.entries.find((entry) => entry.civilopediaKey === 'BLDG_IMPORT_A').buildingIconIndex, '5');
  assert.equal(improvementsTab.entries.find((entry) => entry.civilopediaKey === 'BLDG_IMPORT_C').buildingIconIndex, '6');
  assert.equal(buildingCellHasOnlyIndex(decodedLarge, BUILDING_LARGE, 5, 0, 41), true);
  assert.equal(buildingCellHasOnlyIndex(decodedSmall, BUILDING_SMALL, 5, 0, 51), true);
  assert.equal(buildingCellHasOnlyIndex(decodedLarge, BUILDING_LARGE, 6, 0, 43), true);
  assert.equal(buildingCellHasOnlyIndex(decodedSmall, BUILDING_SMALL, 6, 0, 53), true);
});
