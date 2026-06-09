'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const techBoxLayout = require('../src/techBoxLayout');
const scienceAdvisorArrows = require('../src/scienceAdvisorArrows');

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
