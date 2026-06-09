'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { decodePcx } = require('../src/artPreview');
const techBoxLayout = require('../src/techBoxLayout');
const scienceAdvisorArrows = require('../src/scienceAdvisorArrows');

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');
const CCM3_SCIENCE_ANCIENT_PCX = path.join(CIV3_ROOT, 'Conquests', 'Scenarios', 'CCM3', 'Art', 'Advisors', 'science_ancient.pcx');

function makePalette() {
  const palette = new Uint8Array(256 * 3);
  for (let idx = 0; idx < 256; idx += 1) {
    palette[idx * 3] = idx;
    palette[idx * 3 + 1] = idx;
    palette[idx * 3 + 2] = idx;
  }
  const colors = [
    [10, 91, 33, 13],
    [11, 144, 72, 36],
    [12, 226, 151, 82]
  ];
  colors.forEach(([idx, r, g, b]) => {
    palette[idx * 3] = r;
    palette[idx * 3 + 1] = g;
    palette[idx * 3 + 2] = b;
  });
  return palette;
}

function makeMixedEraPalette() {
  const palette = makePalette();
  const colors = [
    [20, 8, 49, 88],
    [21, 18, 86, 148],
    [22, 75, 142, 199]
  ];
  colors.forEach(([idx, r, g, b]) => {
    palette[idx * 3] = r;
    palette[idx * 3 + 1] = g;
    palette[idx * 3 + 2] = b;
  });
  return palette;
}

test('Science Advisor palette style prefers arrow-like reds over closer neutral colors', () => {
  const palette = new Uint8Array(256 * 3);
  palette[1 * 3] = 90;
  palette[1 * 3 + 1] = 70;
  palette[1 * 3 + 2] = 50;
  palette[2 * 3] = 180;
  palette[2 * 3 + 1] = 50;
  palette[2 * 3 + 2] = 30;

  const style = scienceAdvisorArrows.makePaletteStyle(palette);
  assert.equal(style.outlineIndex, 2);
  assert.equal(style.mainIndex, 2);
  assert.equal(style.highlightIndex, 2);
});

test('Science Advisor palette style is era-specific for reddish and modern blue arrows', () => {
  const palette = makeMixedEraPalette();

  const ancientStyle = scienceAdvisorArrows.makePaletteStyle(palette, { eraIndex: 0 });
  assert.equal(ancientStyle.outlineIndex, 10);
  assert.equal(ancientStyle.mainIndex, 11);
  assert.equal(ancientStyle.highlightIndex, 12);

  const industrialStyle = scienceAdvisorArrows.makePaletteStyle(palette, { eraIndex: 2 });
  assert.equal(industrialStyle.outlineIndex, 10);
  assert.equal(industrialStyle.mainIndex, 11);
  assert.equal(industrialStyle.highlightIndex, 12);

  const modernStyle = scienceAdvisorArrows.makePaletteStyle(palette, { eraIndex: 3 });
  assert.equal(modernStyle.outlineIndex, 20);
  assert.equal(modernStyle.mainIndex, 21);
  assert.equal(modernStyle.highlightIndex, 22);
});

test('Science Advisor arrow clearing recognizes both reddish and modern blue source arrows', () => {
  const width = 35;
  const height = 20;
  const palette = makeMixedEraPalette();
  palette[23 * 3] = 54;
  palette[23 * 3 + 1] = 92;
  palette[23 * 3 + 2] = 126;
  const indices = new Uint8Array(width * height);
  const redPixel = (10 * width) + 10;
  const bluePixel = (10 * width) + 24;
  const mutedBluePixel = (15 * width) + 18;
  indices[redPixel] = 11;
  indices[bluePixel] = 21;
  indices[mutedBluePixel] = 23;
  const originalBackground = 0;

  scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({
    indices,
    palette,
    width,
    height,
    bounds: { x1: 0, y1: 0, x2: width - 1, y2: height - 1 }
  });

  assert.equal(indices[redPixel], originalBackground);
  assert.equal(indices[bluePixel], originalBackground);
  assert.equal(indices[mutedBluePixel], originalBackground);
});

test('Science Advisor arrow clearing removes connected muted fringe pixels', () => {
  const width = 48;
  const height = 18;
  const palette = makePalette();
  palette[30 * 3] = 86;
  palette[30 * 3 + 1] = 70;
  palette[30 * 3 + 2] = 52;
  const indices = new Uint8Array(width * height);
  const y = 8;
  for (let x = 8; x <= 32; x += 1) {
    indices[(y * width) + x] = x % 3 === 0 ? 30 : 11;
    indices[((y + 1) * width) + x] = 30;
  }
  const unrelatedBrown = (14 * width) + 40;
  indices[unrelatedBrown] = 30;

  scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({
    indices,
    palette,
    width,
    height,
    bounds: { x1: 0, y1: 0, x2: width - 1, y2: height - 1 }
  });

  for (let x = 8; x <= 32; x += 1) {
    assert.equal(indices[(y * width) + x], 0);
    assert.equal(indices[((y + 1) * width) + x], 0);
  }
  assert.equal(indices[unrelatedBrown], 30);
});

test('Science Advisor arrow clearing leaves detached border-colored runs without arrow support', () => {
  const width = 72;
  const height = 24;
  const palette = makePalette();
  palette[30 * 3] = 189;
  palette[30 * 3 + 1] = 148;
  palette[30 * 3 + 2] = 123;
  const indices = new Uint8Array(width * height);
  const y = 7;
  for (let x = 8; x <= 58; x += 1) {
    indices[(y * width) + x] = 30;
    if (x % 3 !== 1) indices[((y + 2) * width) + x] = 30;
  }

  scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({
    indices,
    palette,
    width,
    height,
    bounds: { x1: 0, y1: 0, x2: width - 1, y2: height - 1 }
  });

  for (let x = 8; x <= 58; x += 1) {
    assert.equal(indices[(y * width) + x], 30);
    if (x % 3 !== 1) assert.equal(indices[((y + 2) * width) + x], 30);
  }
});

test('Science Advisor arrow clearing removes detached CCM3 glint and shadow runs', (t) => {
  if (!fs.existsSync(CCM3_SCIENCE_ANCIENT_PCX)) {
    t.skip('CCM3 Science Advisor art is not installed');
    return;
  }

  const decoded = decodePcx(CCM3_SCIENCE_ANCIENT_PCX, { returnIndexed: true, transparentIndexes: [] });
  const { width, height, palette } = decoded;
  const indices = new Uint8Array(decoded.indices);
  const original = new Uint8Array(decoded.indices);
  const problemRuns = [
    { x1: 182, x2: 269, y: 108, index: 141 },
    { x1: 317, x2: 407, y: 108, index: 141 },
    { x1: 377, x2: 453, y: 176, index: 141 },
    { x1: 317, x2: 467, y: 110, index: 29 }
  ];

  for (const run of problemRuns) {
    assert.equal(original[run.y * width + run.x1], run.index, `Expected CCM3 fixture pixel at ${run.x1},${run.y}`);
  }

  scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({
    indices,
    palette,
    width,
    height,
    bounds: { x1: 60, y1: 80, x2: 970, y2: 735 }
  });

  for (const run of problemRuns) {
    for (let x = run.x1; x <= run.x2; x += 1) {
      const offset = run.y * width + x;
      assert.notEqual(indices[offset], original[offset], `Expected CCM3 arrow residue at ${x},${run.y} to be replaced`);
      assert.notEqual(indices[offset], run.index, `Expected CCM3 arrow residue index ${run.index} at ${x},${run.y} to be removed`);
    }
  }
});

test('Science Advisor arrow rasterer uses identical palette colors for indexed save and RGBA preview', () => {
  const width = 90;
  const height = 40;
  const palette = makePalette();
  const route = techBoxLayout.buildTechTreeArrowRoute(
    { x: 5, y: 10, w: 20, h: 12 },
    { x: 60, y: 10, w: 20, h: 12 },
    { pad: 0 }
  );
  const indices = new Uint8Array(width * height);
  const image = new Uint8ClampedArray(width * height * 4);

  scienceAdvisorArrows.drawScienceAdvisorRouteIndexed({ indices, palette, width, height, route, techBoxLayout });
  scienceAdvisorArrows.drawScienceAdvisorRouteRgba({ rgba: image, palette, width, height, route, techBoxLayout });

  let drawn = 0;
  let previewDrawn = 0;
  let partialPreviewPixels = 0;
  let solidPreviewPixels = 0;
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const rgbaOff = pixel * 4;
    if (indices[pixel]) drawn += 1;
    if (image[rgbaOff + 3]) {
      previewDrawn += 1;
      if (image[rgbaOff + 3] < 255) {
        partialPreviewPixels += 1;
      } else {
        solidPreviewPixels += 1;
        const paletteOff = indices[pixel] * 3;
        assert.equal(image[rgbaOff], palette[paletteOff]);
        assert.equal(image[rgbaOff + 1], palette[paletteOff + 1]);
        assert.equal(image[rgbaOff + 2], palette[paletteOff + 2]);
      }
    }
  }
  assert.ok(drawn > 40, 'Expected arrow rasterer to draw visible pixels');
  assert.ok(previewDrawn > 40, 'Expected arrow preview rasterer to draw visible pixels');
  assert.ok(partialPreviewPixels > 0, 'Expected supersampled arrow preview to include antialiased edge pixels');
  assert.ok(solidPreviewPixels > 0, 'Expected supersampled arrow preview to include solid core pixels');
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.colors.outline.r, 103);
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.colors.main.r, 160);
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.body.outlineRadius, 1.5);
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.head.outline.half, 5);
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.curveSteps, 24);
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.segmentStep, 0.45);
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.rasterScale, 4);
  assert.equal(scienceAdvisorArrows.SCIENCE_ADVISOR_ARROW_STYLE.coverageThreshold, 3);
});

test('Science Advisor arrow rasterer uses modern blue palette colors in the modern era', () => {
  const width = 90;
  const height = 40;
  const palette = makeMixedEraPalette();
  const route = techBoxLayout.buildTechTreeArrowRoute(
    { x: 5, y: 10, w: 20, h: 12 },
    { x: 60, y: 10, w: 20, h: 12 },
    { pad: 0 }
  );
  const indices = new Uint8Array(width * height);
  const image = new Uint8ClampedArray(width * height * 4);

  scienceAdvisorArrows.drawScienceAdvisorRouteIndexed({ indices, palette, width, height, route, techBoxLayout, eraIndex: 3 });
  scienceAdvisorArrows.drawScienceAdvisorRouteRgba({ rgba: image, palette, width, height, route, techBoxLayout, eraIndex: 3 });

  const drawnIndexes = new Set(Array.from(indices).filter((idx) => idx !== 0));
  assert.ok(drawnIndexes.has(20), 'Expected modern arrow outline to use the blue outline palette index');
  assert.ok(drawnIndexes.has(21), 'Expected modern arrow body to use the blue body palette index');
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    if (!indices[pixel]) continue;
    const rgbaOff = pixel * 4;
    if (!image[rgbaOff + 3]) continue;
    assert.notEqual(indices[pixel], 10);
    assert.notEqual(indices[pixel], 11);
    assert.notEqual(indices[pixel], 12);
  }
});

test('Science Advisor arrow style normalizes overrides and preserves era color defaults', () => {
  const normalized = scienceAdvisorArrows.normalizeScienceAdvisorArrowStyle({
    coverageThreshold: 99,
    body: { outlineRadius: 9 },
    head: { outline: { half: 20 } },
    colors: { main: { r: 999, g: -4, b: 7 } }
  }, { eraIndex: 3 });

  assert.equal(normalized.coverageThreshold, 36);
  assert.equal(normalized.body.outlineRadius, 3);
  assert.equal(normalized.head.outline.half, 10);
  assert.deepEqual(normalized.colors.outline, { r: 9, g: 53, b: 93 });
  assert.deepEqual(normalized.colors.main, { r: 255, g: 0, b: 7 });
});

test('Science Advisor arrow style overrides affect raster output and custom palette colors', () => {
  const width = 90;
  const height = 40;
  const palette = makeMixedEraPalette();
  palette[30 * 3] = 250;
  palette[30 * 3 + 1] = 10;
  palette[30 * 3 + 2] = 20;
  const route = techBoxLayout.buildTechTreeArrowRoute(
    { x: 5, y: 10, w: 20, h: 12 },
    { x: 60, y: 10, w: 20, h: 12 },
    { pad: 0 }
  );
  const defaultImage = new Uint8ClampedArray(width * height * 4);
  const customImage = new Uint8ClampedArray(width * height * 4);
  const customStyle = {
    body: { outlineRadius: 2.2 },
    head: { outline: { half: 8, length: 8 }, main: { half: 7, length: 7 } },
    colors: { main: { r: 250, g: 10, b: 20 } }
  };

  scienceAdvisorArrows.drawScienceAdvisorRouteRgba({ rgba: defaultImage, palette, width, height, route, techBoxLayout, eraIndex: 3 });
  scienceAdvisorArrows.drawScienceAdvisorRouteRgba({ rgba: customImage, palette, width, height, route, techBoxLayout, eraIndex: 3, style: customStyle });

  assert.notDeepEqual(Buffer.from(customImage), Buffer.from(defaultImage));
  const paletteStyle = scienceAdvisorArrows.makePaletteStyle(palette, { eraIndex: 3, style: customStyle });
  assert.equal(paletteStyle.mainIndex, 30);
});
