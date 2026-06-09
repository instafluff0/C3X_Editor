'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { decodePcx } = require('../src/artPreview');
const {
  buildScienceAdvisorArrowRoutesForEra,
  prepareScienceAdvisorArrowArtWrites,
  loadScienceAdvisorArrowMetadata,
  buildScienceAdvisorArrowMetadataWrite,
  countScienceAdvisorUnlockIconsForTech
} = require('../src/configCore');
const techBoxLayout = require('../src/techBoxLayout');
const scienceAdvisorArrows = require('../src/scienceAdvisorArrows');

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');
const STOCK_SCIENCE_ANCIENT_PCX = path.join(CIV3_ROOT, 'Conquests', 'Art', 'Advisors', 'science_ancient.pcx');
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

function makeTechEntry({ biqIndex, name, era, x, y, prereq = -1 }) {
  const fields = [
    ['era', era],
    ['x', x],
    ['y', y],
    ['prerequisite1', prereq],
    ['prerequisite2', -1],
    ['prerequisite3', -1],
    ['prerequisite4', -1]
  ];
  return {
    biqIndex,
    name,
    biqFields: fields.map(([baseKey, value]) => ({
      key: baseKey,
      baseKey,
      label: baseKey,
      value: String(value)
    }))
  };
}

function makeBiqEntry(fields) {
  return {
    biqFields: Object.entries(fields || {}).map(([baseKey, value]) => ({
      key: baseKey,
      baseKey,
      label: baseKey,
      value: String(value)
    }))
  };
}

function indexedToRgba(indices, palette) {
  const rgba = new Uint8ClampedArray(indices.length * 4);
  for (let idx = 0; idx < indices.length; idx += 1) {
    const paletteOffset = indices[idx] * 3;
    const rgbaOffset = idx * 4;
    rgba[rgbaOffset] = palette[paletteOffset];
    rgba[rgbaOffset + 1] = palette[paletteOffset + 1];
    rgba[rgbaOffset + 2] = palette[paletteOffset + 2];
    rgba[rgbaOffset + 3] = 255;
  }
  return rgba;
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

test('Science Advisor save tech-box sizing uses the preview civ unit filter', () => {
  const tabs = {
    units: {
      entries: [
        makeBiqEntry({ requiredtech: '4', availableto: String((1 << 0) | (1 << 1)) }),
        makeBiqEntry({ requiredtech: '4', availableto: String(1 << 0) }),
        makeBiqEntry({ requiredtech: '4', availableto: String(1 << 1) }),
        makeBiqEntry({ requiredtech: '4', availableto: '0' }),
        makeBiqEntry({ requiredtech: '7', availableto: String(1 << 0) })
      ]
    },
    improvements: {
      entries: [
        makeBiqEntry({ reqadvance: '4', obsoleteby: '-1' }),
        makeBiqEntry({ reqadvance: '-1', obsoleteby: '4' })
      ]
    },
    workerActions: {
      entries: [
        makeBiqEntry({ requiredadvance: '4' })
      ]
    }
  };

  assert.equal(countScienceAdvisorUnlockIconsForTech(tabs, 4, { selectedCivIndex: 0, generalCivIndices: [0, 1] }), 6);
  assert.equal(countScienceAdvisorUnlockIconsForTech(tabs, 4, { selectedCivIndex: 1, generalCivIndices: [0, 1] }), 6);
  assert.equal(countScienceAdvisorUnlockIconsForTech(tabs, 4, { selectedCivIndex: null, generalCivIndices: [0, 1] }), 5);
  assert.equal(countScienceAdvisorUnlockIconsForTech(tabs, 4, null), 7);
});

test('Science Advisor arrow metadata loads scenario-local route overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-science-advisor-metadata-load-'));
  const metadataPath = path.join(root, 'c3x_editor_tech_tree_arrows.json');
  fs.writeFileSync(metadataPath, JSON.stringify({
    format: 'c3x-editor-tech-tree-arrows',
    version: 1,
    routeOverrides: {
      '0:1->2': {
        points: [
          { x: 12.2, y: 24.8 },
          { x: 90.6, y: 25.1 }
        ]
      },
      '0:bad': {
        points: [
          { x: 1, y: 2 }
        ]
      }
    },
    baselineRouteHints: {
      '0:1->2': {
        sourceSide: 'right',
        targetSide: 'left',
        sourceOffset: 4.5,
        targetOffset: -2,
        horizontalTolerance: 22
      },
      '0:bad': {
        sourceSide: 'diagonal',
        targetSide: 'left'
      }
    }
  }), 'utf8');

  const metadata = loadScienceAdvisorArrowMetadata(root);

  assert.equal(metadata.path, metadataPath);
  assert.equal(metadata.exists, true);
  assert.deepEqual(metadata.routeOverrides, {
    '0:1->2': {
      points: [
        { x: 12, y: 25 },
        { x: 91, y: 25 }
      ]
    }
  });
  assert.deepEqual(metadata.baselineRouteHints, {
    '0:1->2': {
      sourceSide: 'right',
      targetSide: 'left',
      sourceOffset: 4.5,
      targetOffset: -2,
      horizontalTolerance: 22
    }
  });
});

test('Science Advisor arrow metadata write is editor-only scenario sidecar JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-science-advisor-metadata-write-'));
  const write = buildScienceAdvisorArrowMetadataWrite({
    targetContentRoot: root,
    routeOverrides: {
      '2:10->11': {
        points: [
          { x: 20.4, y: 30.5 },
          { x: 44.7, y: 52.2 }
        ]
      }
    },
    baselineRouteHints: {
      '2:10->11': {
        sourceSide: 'bottom',
        targetSide: 'left',
        sourceOffset: -6,
        targetOffset: 8
      }
    }
  });

  assert.equal(write.kind, 'scienceAdvisorArrowMetadata');
  assert.equal(write.path, path.join(root, 'c3x_editor_tech_tree_arrows.json'));
  assert.equal(write.encoding, 'utf8');
  const parsed = JSON.parse(write.data);
  assert.equal(parsed.format, 'c3x-editor-tech-tree-arrows');
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.routeOverrides['2:10->11'].points, [
    { x: 20, y: 31 },
    { x: 45, y: 52 }
  ]);
  assert.equal(parsed.baselineRouteHints['2:10->11'].horizontalTolerance, 18);
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

test('Science Advisor arrow clearing does not smear nearby advisor-frame texture into cleared arrows', () => {
  const width = 72;
  const height = 32;
  const palette = makePalette();
  palette[1 * 3] = 221;
  palette[1 * 3 + 1] = 207;
  palette[1 * 3 + 2] = 170;
  palette[2 * 3] = 166;
  palette[2 * 3 + 1] = 158;
  palette[2 * 3 + 2] = 137;
  const indices = new Uint8Array(width * height);
  indices.fill(1);
  for (let x = 6; x <= 60; x += 1) {
    indices[(2 * width) + x] = 2;
    indices[(3 * width) + x] = 2;
  }
  for (let x = 12; x <= 48; x += 1) {
    indices[(12 * width) + x] = 11;
  }

  scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({
    indices,
    palette,
    width,
    height,
    bounds: { x1: 0, y1: 0, x2: width - 1, y2: height - 1 }
  });

  for (let x = 6; x <= 60; x += 1) {
    assert.equal(indices[(2 * width) + x], 2);
    assert.equal(indices[(3 * width) + x], 2);
  }
  for (let x = 12; x <= 48; x += 1) {
    assert.equal(indices[(12 * width) + x], 1, `Expected cleared arrow at ${x},12 to use parchment fill, not frame stripe`);
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

test('Science Advisor route builder uses cached router baseline hints until an edge is dirty', () => {
  const source = { id: 0, era: 0, x: 10, y: 10, w: 12, h: 12, prereqs: [] };
  const target = { id: 1, era: 0, x: 50, y: 10, w: 12, h: 12, prereqs: [0] };
  const nodes = [source, target];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const routeKey = '0:0->1';
  const baselineRouteHints = {
    [routeKey]: {
      sourceSide: 'bottom',
      targetSide: 'top',
      sourceOffset: -2,
      targetOffset: 2,
      horizontalTolerance: 18
    }
  };

  const inherited = buildScienceAdvisorArrowRoutesForEra({
    nodes,
    byId,
    eraIndex: 0,
    baselineRouteHints,
    dirtyEdgesByEra: {}
  })[0];
  assert.equal(Math.round(inherited.points[0].y), source.y + source.h);
  assert.equal(Math.round(inherited.points[inherited.points.length - 1].y), target.y);

  const recomputed = buildScienceAdvisorArrowRoutesForEra({
    nodes,
    byId,
    eraIndex: 0,
    baselineRouteHints,
    dirtyEdgesByEra: { 0: { [routeKey]: true } }
  })[0];
  assert.equal(Math.round(recomputed.points[0].x), source.x + source.w);
  assert.equal(Math.round(recomputed.points[recomputed.points.length - 1].x), target.x);
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

test('Science Advisor saved PCX arrows match the palette-quantized generated preview', (t) => {
  if (!fs.existsSync(STOCK_SCIENCE_ANCIENT_PCX)) {
    t.skip('Stock Science Advisor art is not installed');
    return;
  }

  const routePoints = [
    { x: 150, y: 152 },
    { x: 238, y: 152 },
    { x: 260, y: 180 },
    { x: 332, y: 180 }
  ];
  const routeOverrides = {
    '0:0->1': { points: routePoints }
  };
  const arrowStyle = {
    body: {
      outlineRadius: 1.75,
      highlightOffset: { x: 1, y: -1 }
    },
    head: {
      outline: { length: 7, half: 6 },
      main: { length: 6, half: 5 },
      glint: { offsetPerp: -2.4 }
    }
  };
  const tabs = {
    technologies: {
      entries: [
        makeTechEntry({ biqIndex: 0, name: 'Source', era: 0, x: 118, y: 130 }),
        makeTechEntry({ biqIndex: 1, name: 'Target', era: 0, x: 320, y: 158, prereq: 0 })
      ]
    }
  };
  const targetContentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-science-advisor-save-'));
  const result = prepareScienceAdvisorArrowArtWrites({
    tabs,
    targetContentRoot,
    scenarioPath: '',
    scenarioRoots: [],
    civ3Path: CIV3_ROOT,
    routeOverrides,
    dirtyEraIndexes: [0],
    arrowStyle
  });

  assert.equal(result.ok, true, String(result.error || 'science advisor save preparation failed'));
  assert.equal(result.writes.length, 1);
  const write = result.writes[0];
  assert.equal(write.kind, 'scienceAdvisor');
  assert.equal(write.eraIndex, 0);

  const source = decodePcx(write.sourcePath, { returnIndexed: true, transparentIndexes: [] });
  const saved = decodePcx(write.data, { returnIndexed: true, transparentIndexes: [] });
  assert.equal(saved.width, source.width);
  assert.equal(saved.height, source.height);
  assert.deepEqual(Buffer.from(saved.palette), Buffer.from(source.palette));

  const previewBase = indexedToRgba(source.indices, source.palette);
  const previewBaseIndices = Uint8Array.from(source.indices);
  scienceAdvisorArrows.clearScienceAdvisorArrowPixelsRgba({
    rgba: previewBase,
    width: source.width,
    height: source.height,
    bounds: { x1: 0, y1: 0, x2: source.width - 1, y2: source.height - 1 }
  });
  scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({
    indices: previewBaseIndices,
    palette: source.palette,
    width: source.width,
    height: source.height,
    bounds: { x1: 0, y1: 0, x2: source.width - 1, y2: source.height - 1 }
  });

  const overlay = new Uint8ClampedArray(source.width * source.height * 4);
  const previewRoute = {
    dir: 1,
    headVector: {
      x: routePoints[routePoints.length - 1].x - routePoints[routePoints.length - 2].x,
      y: routePoints[routePoints.length - 1].y - routePoints[routePoints.length - 2].y
    },
    points: routePoints
  };
  scienceAdvisorArrows.drawScienceAdvisorRoutesRgba({
    rgba: overlay,
    palette: source.palette,
    width: source.width,
    height: source.height,
    routes: [previewRoute],
    techBoxLayout,
    eraIndex: 0,
    style: arrowStyle
  });

  let compared = 0;
  for (let pixel = 0; pixel < saved.indices.length; pixel += 1) {
    const overlayOffset = pixel * 4;
    const alphaByte = overlay[overlayOffset + 3];
    if (!alphaByte) continue;
    const alpha = alphaByte / 255;
    const baseRgbaOffset = pixel * 4;
    const composite = {
      r: Math.round((overlay[overlayOffset] * alpha) + (previewBase[baseRgbaOffset] * (1 - alpha))),
      g: Math.round((overlay[overlayOffset + 1] * alpha) + (previewBase[baseRgbaOffset + 1] * (1 - alpha))),
      b: Math.round((overlay[overlayOffset + 2] * alpha) + (previewBase[baseRgbaOffset + 2] * (1 - alpha)))
    };
    const expectedIndex = scienceAdvisorArrows.getNearestPaletteIndex(
      source.palette,
      composite,
      previewBaseIndices[pixel]
    );
    assert.equal(saved.indices[pixel], expectedIndex, `saved PCX pixel ${pixel} should match generated preview`);
    compared += 1;
  }
  assert.ok(compared > 40, 'Expected preview/save equivalence test to compare visible arrow pixels');
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
