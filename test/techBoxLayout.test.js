const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { decodePcx } = require('../src/artPreview');
const { loadBundle } = require('../src/configCore');
const scienceAdvisorArrows = require('../src/scienceAdvisorArrows');
const {
  TECH_BOX_DEFAULT_COLUMN_INDEX,
  parseTechBoxSheetLayout,
  getTechBoxFrame,
  chooseTechBoxSizeIndexForIconCount,
  autoLayoutTechTreeNodes,
  layoutTechTreeArrowEdges,
  buildTechTreeArrowRoute,
  formatTechTreeArrowSvgPath,
  sampleTechTreeArrowRoute
} = require('../src/techBoxLayout');

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');

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

function getEntries(bundle, tabKey) {
  return (((bundle || {}).tabs || {})[tabKey] || {}).entries || [];
}

function getBiqField(entry, key) {
  const normalizedKey = String(key || '').toLowerCase();
  return (Array.isArray(entry && entry.biqFields) ? entry.biqFields : [])
    .find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === normalizedKey);
}

function getBiqFieldValue(entry, key) {
  const field = getBiqField(entry, key);
  return field ? field.value : undefined;
}

function parseLastNumber(value, fallback = -1) {
  const matches = String(value == null ? '' : value).match(/-?\d+/g);
  if (!matches || matches.length === 0) return fallback;
  const parsed = Number(matches[matches.length - 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function countStockTechUnlockIcons(bundle, techIndex) {
  let count = 1;
  getEntries(bundle, 'units').forEach((entry) => {
    if (parseLastNumber(getBiqFieldValue(entry, 'requiredtech')) === techIndex) count += 1;
  });
  getEntries(bundle, 'improvements').forEach((entry) => {
    if (parseLastNumber(getBiqFieldValue(entry, 'reqadvance')) === techIndex) count += 1;
    if (parseLastNumber(getBiqFieldValue(entry, 'obsoleteby')) === techIndex) count += 1;
  });
  getEntries(bundle, 'workerActions').forEach((entry) => {
    if (parseLastNumber(getBiqFieldValue(entry, 'requiredtech')) === techIndex) count += 1;
  });
  return count;
}

function getStockTechRect(bundle, techBoxLayout, name) {
  const entry = getStockTechEntry(bundle, name);
  assert.ok(entry, `Expected stock technology "${name}"`);
  const eraIndex = parseLastNumber(getBiqFieldValue(entry, 'era'), 0);
  const sizeIndex = chooseTechBoxSizeIndexForIconCount(countStockTechUnlockIcons(bundle, entry.biqIndex));
  const frame = getTechBoxFrame(techBoxLayout, eraIndex, sizeIndex);
  return {
    id: entry.id,
    x: parseLastNumber(getBiqFieldValue(entry, 'x'), 0),
    y: parseLastNumber(getBiqFieldValue(entry, 'y'), 0),
    w: frame.w,
    h: frame.h
  };
}

function getStockTechEntry(bundle, name) {
  return getEntries(bundle, 'technologies').find((tech) => String(tech && tech.name || '') === name);
}

function getStockTechEra(entry) {
  return parseLastNumber(getBiqFieldValue(entry, 'era'), 0);
}

function getStockTechPrerequisiteEdges(bundle, eraIndex) {
  const byIndex = new Map(getEntries(bundle, 'technologies').map((tech) => [tech.biqIndex, tech]));
  const edges = [];
  getEntries(bundle, 'technologies')
    .filter((tech) => getStockTechEra(tech) === eraIndex)
    .forEach((target) => {
      ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4'].forEach((fieldKey) => {
        const sourceIndex = parseLastNumber(getBiqFieldValue(target, fieldKey));
        const source = byIndex.get(sourceIndex);
        if (!source) return;
        edges.push({ source, target });
      });
    });
  return edges;
}

function isIndexedArrowPixel(image, x, y) {
  if (!image || !image.indices || !image.palette) return false;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return false;
  const index = image.indices[(iy * image.width) + ix];
  const off = index * 3;
  return scienceAdvisorArrows.isScienceAdvisorArrowColor(
    image.palette[off],
    image.palette[off + 1],
    image.palette[off + 2]
  );
}

function getFiraxisSideBandStats(image, rect, side) {
  const band = 28;
  const inset = 4;
  let count = 0;
  let axisSum = 0;
  const visit = (x, y) => {
    if (!isIndexedArrowPixel(image, x, y)) return;
    count += 1;
    axisSum += side === 'left' || side === 'right' ? y : x;
  };
  if (side === 'left') {
    for (let y = Math.max(0, rect.y - inset); y <= Math.min(image.height - 1, rect.y + rect.h + inset); y += 1) {
      for (let x = Math.max(0, rect.x - band); x < rect.x; x += 1) visit(x, y);
    }
  } else if (side === 'right') {
    for (let y = Math.max(0, rect.y - inset); y <= Math.min(image.height - 1, rect.y + rect.h + inset); y += 1) {
      for (let x = rect.x + rect.w + 1; x <= Math.min(image.width - 1, rect.x + rect.w + band); x += 1) visit(x, y);
    }
  } else if (side === 'top') {
    for (let y = Math.max(0, rect.y - band); y < rect.y; y += 1) {
      for (let x = Math.max(0, rect.x - inset); x <= Math.min(image.width - 1, rect.x + rect.w + inset); x += 1) visit(x, y);
    }
  } else if (side === 'bottom') {
    for (let y = rect.y + rect.h + 1; y <= Math.min(image.height - 1, rect.y + rect.h + band); y += 1) {
      for (let x = Math.max(0, rect.x - inset); x <= Math.min(image.width - 1, rect.x + rect.w + inset); x += 1) visit(x, y);
    }
  }
  return { side, count, mean: count > 0 ? axisSum / count : null };
}

function uniqueSides(sides) {
  return Array.from(new Set(sides.filter(Boolean)));
}

function getSourceSideCandidates(sourceRect, targetRect) {
  const sc = { x: sourceRect.x + (sourceRect.w / 2), y: sourceRect.y + (sourceRect.h / 2) };
  const tc = { x: targetRect.x + (targetRect.w / 2), y: targetRect.y + (targetRect.h / 2) };
  return uniqueSides([
    tc.x >= sc.x ? 'right' : 'left',
    tc.y >= sc.y ? 'bottom' : 'top'
  ]);
}

function getTargetSideCandidates(sourceRect, targetRect) {
  const sc = { x: sourceRect.x + (sourceRect.w / 2), y: sourceRect.y + (sourceRect.h / 2) };
  const tc = { x: targetRect.x + (targetRect.w / 2), y: targetRect.y + (targetRect.h / 2) };
  return uniqueSides([
    tc.x >= sc.x ? 'left' : 'right',
    tc.y >= sc.y ? 'top' : 'bottom'
  ]);
}

function inferFiraxisEndpointSide(image, rect, candidates) {
  const stats = candidates.map((side) => getFiraxisSideBandStats(image, rect, side));
  stats.sort((a, b) => b.count - a.count);
  return { ...stats[0], secondCount: stats[1] ? stats[1].count : 0 };
}

function endpointAxisValue(point, side) {
  return side === 'left' || side === 'right' ? point.y : point.x;
}

function rectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap
    && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap
    && a.y + a.h + gap > b.y;
}

function pointInRect(point, rect, inset = 0) {
  return point.x >= rect.x - inset
    && point.x <= rect.x + rect.w + inset
    && point.y >= rect.y - inset
    && point.y <= rect.y + rect.h + inset;
}

function countRouteObstacleHits(nodes, positions) {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const rectById = new Map(positions.map((position) => [
    String(position.id),
    { x: position.x, y: position.y, w: position.w, h: position.h }
  ]));
  const edges = [];
  nodes.forEach((node) => {
    (node.prereqs || []).forEach((sourceId) => {
      if (!byId.has(String(sourceId))) return;
      edges.push({
        source: { id: String(sourceId) },
        target: { id: String(node.id) },
        sourceRect: rectById.get(String(sourceId)),
        targetRect: rectById.get(String(node.id))
      });
    });
  });
  const routed = layoutTechTreeArrowEdges(edges);
  let hits = 0;
  routed.forEach((edge) => {
    const route = buildTechTreeArrowRoute(edge.sourceRect, edge.targetRect, {
      sourceSide: edge.sourceSide,
      targetSide: edge.targetSide,
      sourceOffset: edge.sourceOffset,
      targetOffset: edge.targetOffset,
      horizontalTolerance: 18
    });
    const samples = sampleTechTreeArrowRoute(route, { curveSteps: 8 });
    const hit = positions.some((position) => {
      const id = String(position.id);
      if (id === String(edge.source.id) || id === String(edge.target.id)) return false;
      return samples.some((point) => pointInRect(point, position, 4));
    });
    if (hit) hits += 1;
  });
  return hits;
}

function getRouteForStockEdge(sourceName, targetName, bundle, techBoxLayout) {
  const sourceRect = getStockTechRect(bundle, techBoxLayout, sourceName);
  const targetRect = getStockTechRect(bundle, techBoxLayout, targetName);
  const edge = layoutTechTreeArrowEdges([{
    source: { id: sourceName },
    target: { id: targetName },
    sourceRect,
    targetRect
  }])[0];
  const route = buildTechTreeArrowRoute(sourceRect, targetRect, {
    sourceSide: edge.sourceSide,
    targetSide: edge.targetSide,
    sourceOffset: edge.sourceOffset,
    targetOffset: edge.targetOffset,
    horizontalTolerance: 18
  });
  return { sourceRect, targetRect, edge, route };
}

function isConfidentFiraxisSide(stat) {
  return stat
    && stat.count >= 25
    && stat.count >= (stat.secondCount * 1.35) + 8;
}

function countDominantAxisBacktracking(route, sourceRect, targetRect) {
  const points = route && Array.isArray(route.points) ? route.points : [];
  const sourceCenter = {
    x: sourceRect.x + (sourceRect.w / 2),
    y: sourceRect.y + (sourceRect.h / 2)
  };
  const targetCenter = {
    x: targetRect.x + (targetRect.w / 2),
    y: targetRect.y + (targetRect.h / 2)
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const useX = Math.abs(dx) >= Math.abs(dy);
  const sign = useX ? Math.sign(dx || 1) : Math.sign(dy || 1);
  let backtrack = 0;
  for (let idx = 1; idx < points.length; idx += 1) {
    const delta = useX ? points[idx].x - points[idx - 1].x : points[idx].y - points[idx - 1].y;
    if ((delta * sign) < -0.5) backtrack += Math.abs(delta);
  }
  return backtrack;
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
  const techboxesPath = path.join(CIV3_ROOT, 'Art', 'Advisors', 'techboxes.pcx');
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

test('stock Conquests Science Advisor routes match Firaxis PCX endpoint side bands across every era', (t) => {
  const techboxesPath = path.join(CIV3_ROOT, 'Art', 'Advisors', 'techboxes.pcx');
  const advisorFilesByEra = [
    'science_ancient.pcx',
    'science_middle.pcx',
    'science_industrial.pcx',
    'science_modern.pcx'
  ];
  const biqPath = path.join(CIV3_ROOT, 'Conquests', 'conquests.biq');
  const advisorPaths = advisorFilesByEra.map((fileName) => path.join(CIV3_ROOT, 'Art', 'Advisors', fileName));
  [techboxesPath, biqPath, ...advisorPaths].forEach((requiredPath) => {
    if (!fs.existsSync(requiredPath)) t.skip(`Missing local Civ3 stock fixture at ${requiredPath}`);
  });
  if ([techboxesPath, biqPath, ...advisorPaths].some((requiredPath) => !fs.existsSync(requiredPath))) return;

  const bundle = loadBundle({ mode: 'global', civ3Path: CIV3_ROOT });
  const techBoxLayout = parseTechBoxSheetLayout(decodePcx(techboxesPath));
  const advisorsByEra = advisorPaths.map((advisorPath) => decodePcx(advisorPath, { returnIndexed: true, transparentIndexes: [] }));

  advisorsByEra.forEach((advisor, eraIndex) => {
    let comparable = 0;
    let sourceMatches = 0;
    let targetMatches = 0;
    let confident = 0;
    let confidentMatches = 0;
    getStockTechPrerequisiteEdges(bundle, eraIndex).forEach(({ source, target }) => {
      const sourceRect = getStockTechRect(bundle, techBoxLayout, source.name);
      const targetRect = getStockTechRect(bundle, techBoxLayout, target.name);
      const sourceFiraxis = inferFiraxisEndpointSide(advisor, sourceRect, getSourceSideCandidates(sourceRect, targetRect));
      const targetFiraxis = inferFiraxisEndpointSide(advisor, targetRect, getTargetSideCandidates(sourceRect, targetRect));
      if (sourceFiraxis.count < 25 || targetFiraxis.count < 25) return;
      const { edge } = getRouteForStockEdge(source.name, target.name, bundle, techBoxLayout);
      comparable += 1;
      if (edge.sourceSide === sourceFiraxis.side) sourceMatches += 1;
      if (edge.targetSide === targetFiraxis.side) targetMatches += 1;
      if (isConfidentFiraxisSide(sourceFiraxis) && isConfidentFiraxisSide(targetFiraxis)) {
        confident += 1;
        if (edge.sourceSide === sourceFiraxis.side && edge.targetSide === targetFiraxis.side) confidentMatches += 1;
      }
    });
    assert.ok(comparable >= 14, `Era ${eraIndex} has broad comparable stock arrow coverage`);
    assert.ok(sourceMatches / comparable >= 0.7, `Era ${eraIndex} source side match rate`);
    assert.ok(targetMatches / comparable >= 0.7, `Era ${eraIndex} target side match rate`);
    assert.ok(confident >= 10, `Era ${eraIndex} has enough confident stock arrow samples`);
    assert.ok(confidentMatches / confident >= 0.65, `Era ${eraIndex} confident side-pair match rate`);
  });
});

test('stock Conquests Science Advisor routes keep tight Firaxis-like endpoint placement on clear examples', (t) => {
  const techboxesPath = path.join(CIV3_ROOT, 'Art', 'Advisors', 'techboxes.pcx');
  const biqPath = path.join(CIV3_ROOT, 'Conquests', 'conquests.biq');
  const fixtures = [
    { era: 0, file: 'science_ancient.pcx', source: 'Bronze Working', target: 'Iron Working', sides: ['right', 'left'], maxAxisDelta: 20 },
    { era: 1, file: 'science_middle.pcx', source: 'Monotheism', target: 'Theology', sides: ['right', 'left'], maxAxisDelta: 20 },
    { era: 1, file: 'science_middle.pcx', source: 'Monotheism', target: 'Chivalry', sides: ['right', 'left'], maxAxisDelta: 24 },
    { era: 1, file: 'science_middle.pcx', source: 'Feudalism', target: 'Chivalry', sides: ['top', 'left'], maxAxisDelta: 24 },
    { era: 1, file: 'science_middle.pcx', source: 'Feudalism', target: 'Invention', sides: ['bottom', 'left'], maxAxisDelta: 26 },
    { era: 1, file: 'science_middle.pcx', source: 'Engineering', target: 'Invention', sides: ['right', 'left'], maxAxisDelta: 24 },
    { era: 1, file: 'science_middle.pcx', source: 'Theology', target: 'Printing Press', sides: ['right', 'left'], maxAxisDelta: 20 },
    { era: 1, file: 'science_middle.pcx', source: 'Theology', target: 'Education', sides: ['bottom', 'top'], maxAxisDelta: 24 },
    { era: 2, file: 'science_industrial.pcx', source: 'Industrialization', target: 'The Corporation', sides: ['bottom', 'left'], maxAxisDelta: 30 },
    { era: 2, file: 'science_industrial.pcx', source: 'The Corporation', target: 'Steel', sides: ['bottom', 'left'], maxAxisDelta: 28 },
    { era: 3, file: 'science_modern.pcx', source: 'Rocketry', target: 'Space Flight', sides: ['right', 'left'], maxAxisDelta: 24 },
    { era: 3, file: 'science_modern.pcx', source: 'Space Flight', target: 'Satellites', sides: ['right', 'left'], maxAxisDelta: 28 }
  ];
  const requiredPaths = [
    techboxesPath,
    biqPath,
    ...fixtures.map((fixture) => path.join(CIV3_ROOT, 'Art', 'Advisors', fixture.file))
  ];
  requiredPaths.forEach((requiredPath) => {
    if (!fs.existsSync(requiredPath)) t.skip(`Missing local Civ3 stock fixture at ${requiredPath}`);
  });
  if (requiredPaths.some((requiredPath) => !fs.existsSync(requiredPath))) return;

  const bundle = loadBundle({ mode: 'global', civ3Path: CIV3_ROOT });
  const techBoxLayout = parseTechBoxSheetLayout(decodePcx(techboxesPath));
  fixtures.forEach((fixture) => {
    const advisor = decodePcx(path.join(CIV3_ROOT, 'Art', 'Advisors', fixture.file), { returnIndexed: true, transparentIndexes: [] });
    const { sourceRect, targetRect, edge, route } = getRouteForStockEdge(fixture.source, fixture.target, bundle, techBoxLayout);
    const sourceFiraxis = inferFiraxisEndpointSide(advisor, sourceRect, fixture.sides[0] ? [fixture.sides[0]] : getSourceSideCandidates(sourceRect, targetRect));
    const targetFiraxis = inferFiraxisEndpointSide(advisor, targetRect, fixture.sides[1] ? [fixture.sides[1]] : getTargetSideCandidates(sourceRect, targetRect));
    assert.equal(getStockTechEra(getStockTechEntry(bundle, fixture.source)), fixture.era, `${fixture.source} fixture era`);
    assert.equal(edge.sourceSide, fixture.sides[0], `${fixture.source} -> ${fixture.target} source side`);
    assert.equal(edge.targetSide, fixture.sides[1], `${fixture.source} -> ${fixture.target} target side`);
    assert.ok(sourceFiraxis.count >= 25, `${fixture.source} has detectable Firaxis source arrow pixels`);
    assert.ok(targetFiraxis.count >= 25, `${fixture.target} has detectable Firaxis target arrow pixels`);
    const start = route.points[0];
    const end = route.points[route.points.length - 1];
    assert.ok(
      Math.abs(endpointAxisValue(start, edge.sourceSide) - sourceFiraxis.mean) <= fixture.maxAxisDelta,
      `${fixture.source} -> ${fixture.target} source anchor is near Firaxis side-axis cluster`
    );
    assert.ok(
      Math.abs(endpointAxisValue(end, edge.targetSide) - targetFiraxis.mean) <= fixture.maxAxisDelta,
      `${fixture.source} -> ${fixture.target} target anchor is near Firaxis side-axis cluster`
    );
  });
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

test('tech tree auto-layout produces deterministic left-to-right non-overlapping coordinates', () => {
  const nodes = [
    { id: 'alphabet', name: 'Alphabet', x: 80, y: 560, w: 98, h: 64, prereqs: [] },
    { id: 'bronze', name: 'Bronze Working', x: 80, y: 100, w: 159, h: 70, prereqs: [] },
    { id: 'writing', name: 'Writing', x: 240, y: 520, w: 159, h: 70, prereqs: ['alphabet'] },
    { id: 'iron', name: 'Iron Working', x: 260, y: 90, w: 188, h: 70, prereqs: ['bronze'] },
    { id: 'code', name: 'Code of Laws', x: 430, y: 500, w: 159, h: 70, prereqs: ['writing'] },
    { id: 'philosophy', name: 'Philosophy', x: 430, y: 650, w: 159, h: 70, prereqs: ['writing'] },
    { id: 'construction', name: 'Construction', x: 600, y: 120, w: 188, h: 70, prereqs: ['iron'] },
    { id: 'republic', name: 'The Republic', x: 780, y: 520, w: 188, h: 70, prereqs: ['code', 'philosophy'] }
  ];

  const result = autoLayoutTechTreeNodes(nodes, { width: 1024, height: 768, grid: 16 });
  const repeat = autoLayoutTechTreeNodes(nodes, { width: 1024, height: 768, grid: 16 });
  assert.deepEqual(result.positions, repeat.positions);
  assert.equal(result.stats.backwardEdges, 0);
  assert.equal(result.stats.obstacleHits, 0);

  const byId = new Map(result.positions.map((position) => [String(position.id), position]));
  nodes.forEach((node) => {
    (node.prereqs || []).forEach((sourceId) => {
      assert.ok(
        byId.get(String(sourceId)).x + byId.get(String(sourceId)).w < byId.get(String(node.id)).x,
        `${sourceId} should be left of ${node.id}`
      );
    });
  });
  for (let i = 0; i < result.positions.length; i += 1) {
    for (let j = i + 1; j < result.positions.length; j += 1) {
      assert.equal(rectsOverlap(result.positions[i], result.positions[j], 12), false, `${result.positions[i].id} overlaps ${result.positions[j].id}`);
    }
  }
  assert.equal(countRouteObstacleHits(nodes, result.positions), 0);
});

test('tech tree auto-layout improves route clearance for long prerequisite links', () => {
  const nodes = [
    { id: 'a', name: 'A', x: 80, y: 350, w: 120, h: 60, prereqs: [] },
    { id: 'b', name: 'B', x: 360, y: 350, w: 160, h: 70, prereqs: ['a'] },
    { id: 'c', name: 'C', x: 360, y: 470, w: 160, h: 70, prereqs: ['a'] },
    { id: 'd', name: 'D', x: 700, y: 350, w: 180, h: 70, prereqs: ['a', 'b'] },
    { id: 'e', name: 'E', x: 700, y: 470, w: 180, h: 70, prereqs: ['c'] }
  ];

  const result = autoLayoutTechTreeNodes(nodes, { width: 1024, height: 768, grid: 16 });
  const byId = new Map(result.positions.map((position) => [String(position.id), position]));
  assert.equal(result.stats.obstacleHits, 0);
  assert.equal(countRouteObstacleHits(nodes, result.positions), 0);
  assert.ok(byId.get('a').x < byId.get('d').x, 'long prerequisite edge still flows left to right');
  assert.ok(Math.abs((byId.get('b').y + byId.get('b').h / 2) - (byId.get('d').y + byId.get('d').h / 2)) < 220);
});

test('science advisor arrow routes anchor to techbox edges and smooth corners', () => {
  const route = buildTechTreeArrowRoute(
    { x: 100, y: 40, w: 84, h: 54 },
    { x: 300, y: 120, w: 140, h: 54 }
  );
  assert.deepEqual(route.headVector, { x: 18, y: 0 });
  assert.deepEqual(route.points[0], { x: 184, y: 67 });
  assert.deepEqual(route.points[route.points.length - 1], { x: 300, y: 147 });
  assert.match(formatTechTreeArrowSvgPath(route), /^M 184 67 L .* Q /);
  assert.ok(sampleTechTreeArrowRoute(route).length > route.points.length);

  const horizontal = buildTechTreeArrowRoute(
    { x: 100, y: 40, w: 84, h: 54 },
    { x: 240, y: 40, w: 84, h: 54 }
  );
  assert.match(formatTechTreeArrowSvgPath(horizontal, { radius: 0 }), /^M 184 67 L 240 67$/);
});

test('science advisor arrow layout distributes shared node attachment slots', () => {
  const source = { id: 1 };
  const targetA = { id: 2 };
  const targetB = { id: 3 };
  const routed = layoutTechTreeArrowEdges([
    {
      source,
      target: targetA,
      sourceRect: { x: 100, y: 100, w: 100, h: 60 },
      targetRect: { x: 280, y: 80, w: 100, h: 60 }
    },
    {
      source,
      target: targetB,
      sourceRect: { x: 100, y: 100, w: 100, h: 60 },
      targetRect: { x: 280, y: 160, w: 100, h: 60 }
    }
  ]);
  assert.deepEqual(routed.map((edge) => edge.sourceSide), ['right', 'right']);
  assert.deepEqual(routed.map((edge) => edge.sourceOffset), [-5, 5]);
});

test('science advisor arrow layout uses vertical source anchors when stacked techs are close', () => {
  const routed = layoutTechTreeArrowEdges([
    {
      source: { id: 1 },
      target: { id: 2 },
      sourceRect: { x: 100, y: 220, w: 120, h: 60 },
      targetRect: { x: 130, y: 80, w: 120, h: 60 }
    }
  ]);
  assert.equal(routed[0].sourceSide, 'top');
  assert.equal(routed[0].targetSide, 'bottom');
});

test('science advisor arrow layout enters side of vertically offset targets', () => {
  const routed = layoutTechTreeArrowEdges([
    {
      source: { id: 1 },
      target: { id: 2 },
      sourceRect: { x: 100, y: 100, w: 120, h: 60 },
      targetRect: { x: 285, y: 240, w: 120, h: 60 }
    }
  ]);
  assert.equal(routed[0].sourceSide, 'bottom');
  assert.equal(routed[0].targetSide, 'left');
  const route = buildTechTreeArrowRoute(routed[0].sourceRect, routed[0].targetRect, {
    sourceSide: routed[0].sourceSide,
    targetSide: routed[0].targetSide
  });
  assert.deepEqual(route.points[0], { x: 160, y: 160 });
  assert.deepEqual(route.points[route.points.length - 1], { x: 285, y: 270 });
});

test('science advisor arrow routes snap nearly aligned side links flat', () => {
  const route = buildTechTreeArrowRoute(
    { x: 80, y: 100, w: 100, h: 60 },
    { x: 260, y: 109, w: 100, h: 60 },
    { horizontalTolerance: 18 }
  );
  const ys = new Set(route.points.map((point) => Math.round(point.y)));
  assert.deepEqual(Array.from(ys), [130]);
});

test('science advisor arrow routes use off-center border anchors to keep straight links flat', () => {
  const horizontal = buildTechTreeArrowRoute(
    { x: 80, y: 100, w: 100, h: 60 },
    { x: 260, y: 140, w: 100, h: 60 },
    { sourceSide: 'right', targetSide: 'left', horizontalTolerance: 0 }
  );
  assert.deepEqual(horizontal.points[0], { x: 180, y: 145 });
  assert.deepEqual(horizontal.points[horizontal.points.length - 1], { x: 260, y: 145 });
  assert.deepEqual(Array.from(new Set(horizontal.points.map((point) => point.y))), [145]);

  const vertical = buildTechTreeArrowRoute(
    { x: 100, y: 80, w: 100, h: 60 },
    { x: 140, y: 230, w: 100, h: 60 },
    { sourceSide: 'bottom', targetSide: 'top' }
  );
  assert.deepEqual(vertical.points[0], { x: 190, y: 140 });
  assert.deepEqual(vertical.points[vertical.points.length - 1], { x: 190, y: 230 });
  assert.deepEqual(Array.from(new Set(vertical.points.map((point) => point.x))), [190]);
});

test('science advisor arrow routes preserve shared endpoint slot offsets while straightening', () => {
  const target = { id: 'target' };
  const routed = layoutTechTreeArrowEdges([
    {
      source: { id: 'source-a' },
      target,
      sourceRect: { x: 80, y: 100, w: 100, h: 60 },
      targetRect: { x: 260, y: 140, w: 100, h: 60 }
    },
    {
      source: { id: 'source-b' },
      target,
      sourceRect: { x: 80, y: 100, w: 100, h: 60 },
      targetRect: { x: 260, y: 140, w: 100, h: 60 }
    }
  ]);
  assert.deepEqual(routed.map((edge) => edge.targetOffset), [-5, 5]);
  const routes = routed.map((edge) => buildTechTreeArrowRoute(edge.sourceRect, edge.targetRect, {
    sourceSide: edge.sourceSide,
    targetSide: edge.targetSide,
    sourceOffset: edge.sourceOffset,
    targetOffset: edge.targetOffset,
    horizontalTolerance: 0
  }));
  const targetYs = routes.map((route) => route.points[route.points.length - 1].y);
  assert.deepEqual(targetYs, [165, 175]);
});

test('science advisor arrow routes remove avoidable source doglegs on mixed side links', () => {
  const route = buildTechTreeArrowRoute(
    { x: 433, y: 245, w: 104, h: 67 },
    { x: 518, y: 335, w: 158, h: 75 },
    { sourceSide: 'bottom', targetSide: 'left', targetOffset: -5 }
  );
  assert.deepEqual(route.points, [
    { x: 500, y: 312 },
    { x: 500, y: 330 },
    { x: 500, y: 367.5 },
    { x: 518, y: 367.5 }
  ]);
});

test('science advisor arrow routes do not overshoot short final target approaches', () => {
  const monotheismToChivalry = buildTechTreeArrowRoute(
    { x: 75, y: 180, w: 98, h: 64 },
    { x: 210, y: 295, w: 188, h: 70 },
    { sourceSide: 'right', targetSide: 'left', horizontalTolerance: 18 }
  );
  assert.deepEqual(monotheismToChivalry.points, [
    { x: 173, y: 212 },
    { x: 191, y: 212 },
    { x: 191, y: 330 },
    { x: 210, y: 330 }
  ]);
  assert.equal(countDominantAxisBacktracking(
    monotheismToChivalry,
    { x: 75, y: 180, w: 98, h: 64 },
    { x: 210, y: 295, w: 188, h: 70 }
  ), 0);

  const engineeringToInvention = buildTechTreeArrowRoute(
    { x: 73, y: 610, w: 98, h: 64 },
    { x: 209, y: 531, w: 159, h: 71 },
    { sourceSide: 'right', targetSide: 'left', horizontalTolerance: 18 }
  );
  assert.deepEqual(engineeringToInvention.points, [
    { x: 171, y: 642 },
    { x: 189, y: 642 },
    { x: 189, y: 566.5 },
    { x: 209, y: 566.5 }
  ]);
  assert.equal(countDominantAxisBacktracking(
    engineeringToInvention,
    { x: 73, y: 610, w: 98, h: 64 },
    { x: 209, y: 531, w: 159, h: 71 }
  ), 0);
});

test('science advisor arrow heuristics avoid double-back routes for close offset tech boxes', () => {
  const sourceRect = { x: 500, y: 230, w: 220, h: 70 };
  const targetRect = { x: 720, y: 120, w: 220, h: 70 };
  const routed = layoutTechTreeArrowEdges([
    { source: { id: 1 }, target: { id: 2 }, sourceRect, targetRect }
  ])[0];
  const route = buildTechTreeArrowRoute(sourceRect, targetRect, {
    sourceSide: routed.sourceSide,
    targetSide: routed.targetSide,
    sourceOffset: routed.sourceOffset,
    targetOffset: routed.targetOffset
  });

  assert.equal(countDominantAxisBacktracking(route, sourceRect, targetRect), 0);
  assert.deepEqual(route.points[0], { x: 702, y: 230 });
  assert.deepEqual(route.points[route.points.length - 1], { x: 720, y: 155 });
});

test('science advisor arrow heuristics mimic Firaxis default route classes', () => {
  const fixtures = [
    {
      name: 'long mostly-horizontal prerequisite',
      sourceRect: { x: 360, y: 120, w: 240, h: 70 },
      targetRect: { x: 900, y: 230, w: 220, h: 70 },
      expectedSides: ['right', 'left']
    },
    {
      name: 'close vertically-offset prerequisite',
      sourceRect: { x: 500, y: 230, w: 220, h: 70 },
      targetRect: { x: 720, y: 120, w: 220, h: 70 },
      expectedSides: ['top', 'left']
    },
    {
      name: 'stacked prerequisite',
      sourceRect: { x: 100, y: 220, w: 120, h: 60 },
      targetRect: { x: 130, y: 80, w: 120, h: 60 },
      expectedSides: ['top', 'bottom']
    }
  ];

  fixtures.forEach((fixture) => {
    const routed = layoutTechTreeArrowEdges([
      {
        source: { id: 1 },
        target: { id: 2 },
        sourceRect: fixture.sourceRect,
        targetRect: fixture.targetRect
      }
    ])[0];
    assert.deepEqual([routed.sourceSide, routed.targetSide], fixture.expectedSides, fixture.name);
    const route = buildTechTreeArrowRoute(fixture.sourceRect, fixture.targetRect, {
      sourceSide: routed.sourceSide,
      targetSide: routed.targetSide,
      sourceOffset: routed.sourceOffset,
      targetOffset: routed.targetOffset,
      horizontalTolerance: 18
    });
    assert.equal(countDominantAxisBacktracking(route, fixture.sourceRect, fixture.targetRect), 0, fixture.name);
    assert.ok(sampleTechTreeArrowRoute(route).length >= 2, fixture.name);
  });
});

test('science advisor arrow smoothing avoids rounded reverse turns', () => {
  const pathText = formatTechTreeArrowSvgPath({
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 }
    ],
    headVector: { x: 0, y: 1 }
  });
  assert.match(pathText, /^M 0 0 L 20 0 L 10 0 L/);
});
