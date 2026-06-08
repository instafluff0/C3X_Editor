const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { decodePcx } = require('../src/artPreview');
const {
  TECH_BOX_DEFAULT_COLUMN_INDEX,
  parseTechBoxSheetLayout,
  getTechBoxFrame,
  chooseTechBoxSizeIndexForIconCount
} = require('../src/techBoxLayout');

function makeSyntheticSheet() {
  const width = 1000;
  const height = 1483;
  const rgba = new Uint8Array(width * height * 4);
  const xBySizeAndColumn = [
    [3, 192, 381, 570],
    [1, 190, 379, 568],
    [1, 190, 379, 568],
    [1, 190, 379, 568]
  ];
  const yByRow = [
    9, 88, 170, 278,
    365, 444, 529, 636,
    719, 798, 883, 989,
    1075, 1156, 1238, 1346
  ];
  const widthsBySize = [98, 159, 161, 188];
  const heightsBySize = [64, 70, 101, 70];

  yByRow.forEach((y, rowIndex) => {
    const sizeIndex = rowIndex % 4;
    xBySizeAndColumn[sizeIndex].forEach((x) => {
      const w = widthsBySize[sizeIndex];
      const h = heightsBySize[sizeIndex];
      for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) {
          const off = (yy * width + xx) * 4;
          rgba[off] = 220;
          rgba[off + 1] = 210;
          rgba[off + 2] = 180;
          rgba[off + 3] = 255;
        }
      }
    });
  });

  return { width, height, rgba };
}

test('techbox layout parser groups four columns and four size rows per era', () => {
  const layout = parseTechBoxSheetLayout(makeSyntheticSheet());

  assert.equal(layout.rows.length, 16);
  assert.equal(layout.frames.length, 64);
  assert.equal(layout.defaultColumnIndex, 3);

  const ancientBasic = getTechBoxFrame(layout, 0, 0, TECH_BOX_DEFAULT_COLUMN_INDEX);
  assert.deepEqual(
    { x: ancientBasic.x, y: ancientBasic.y, w: ancientBasic.w, h: ancientBasic.h, era: ancientBasic.eraIndex, size: ancientBasic.sizeIndex },
    { x: 570, y: 9, w: 98, h: 64, era: 0, size: 0 }
  );

  const middleLarge = getTechBoxFrame(layout, 1, 3, TECH_BOX_DEFAULT_COLUMN_INDEX);
  assert.deepEqual(
    { x: middleLarge.x, y: middleLarge.y, w: middleLarge.w, h: middleLarge.h, era: middleLarge.eraIndex, size: middleLarge.sizeIndex },
    { x: 568, y: 636, w: 188, h: 70, era: 1, size: 3 }
  );
});

test('installed Civ3 techboxes.pcx parses the inactive column at x 568', (t) => {
  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const techboxesPath = path.join(civ3Root, 'Art', 'Advisors', 'techboxes.pcx');
  if (!fs.existsSync(techboxesPath)) {
    t.skip(`Missing local Civ3 techboxes.pcx at ${techboxesPath}`);
    return;
  }

  const image = decodePcx(techboxesPath);
  const layout = parseTechBoxSheetLayout(image);
  assert.equal(layout.rows.length, 16);
  assert.equal(layout.frames.length, 64);

  const ancientFrames = [0, 1, 2, 3].map((sizeIndex) => getTechBoxFrame(layout, 0, sizeIndex));
  assert.deepEqual(ancientFrames.map((frame) => frame.x), [570, 568, 568, 568]);
  assert.deepEqual(ancientFrames.map((frame) => frame.y), [9, 88, 170, 278]);
  assert.deepEqual(ancientFrames.map((frame) => frame.w), [98, 159, 161, 188]);

  const eraStarts = [0, 1, 2, 3].map((eraIndex) => getTechBoxFrame(layout, eraIndex, 0).y);
  assert.deepEqual(eraStarts, [9, 365, 719, 1075]);
});

test('techbox size tier selection matches Civ3 row use by icon count', () => {
  assert.equal(chooseTechBoxSizeIndexForIconCount(1), 0);
  assert.equal(chooseTechBoxSizeIndexForIconCount(2), 0);
  assert.equal(chooseTechBoxSizeIndexForIconCount(3), 1);
  assert.equal(chooseTechBoxSizeIndexForIconCount(4), 1);
  assert.equal(chooseTechBoxSizeIndexForIconCount(5), 3);
  assert.equal(chooseTechBoxSizeIndexForIconCount(6), 2);
  assert.equal(chooseTechBoxSizeIndexForIconCount(7), 2);
  assert.equal(chooseTechBoxSizeIndexForIconCount(8), 3);
});
