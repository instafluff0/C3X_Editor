const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { decodePcx } = require('../src/artPreview');
const { loadBundle } = require('../src/configCore');
const scienceAdvisorArrows = require('../src/scienceAdvisorArrows');
const {
  parseTechBoxSheetLayout,
  getTechBoxFrame,
  chooseTechBoxSizeIndexForIconCount,
  layoutTechTreeArrowEdges,
  buildTechTreeArrowRoute,
  sampleTechTreeArrowRoute
} = require('../src/techBoxLayout');

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');
const ADVISOR_FILES_BY_ERA = [
  'science_ancient.pcx',
  'science_middle.pcx',
  'science_industrial.pcx',
  'science_modern.pcx'
];

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

function getStockTechEntry(bundle, name) {
  return getEntries(bundle, 'technologies').find((tech) => String(tech && tech.name || '') === name);
}

function getStockTechEra(entry) {
  return parseLastNumber(getBiqFieldValue(entry, 'era'), 0);
}

function getStockTechRect(bundle, techBoxLayout, name) {
  const entry = getStockTechEntry(bundle, name);
  assert.ok(entry, `Expected stock technology "${name}"`);
  const eraIndex = getStockTechEra(entry);
  const sizeIndex = chooseTechBoxSizeIndexForIconCount(countStockTechUnlockIcons(bundle, entry.biqIndex));
  const frame = getTechBoxFrame(techBoxLayout, eraIndex, sizeIndex);
  return {
    x: parseLastNumber(getBiqFieldValue(entry, 'x'), 0),
    y: parseLastNumber(getBiqFieldValue(entry, 'y'), 0),
    w: frame.w,
    h: frame.h
  };
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
        if (source && getStockTechEra(source) === eraIndex) edges.push({ source, target });
      });
    });
  return edges;
}

function isIndexedArrowPixel(image, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (!image || !image.indices || !image.palette || ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) {
    return false;
  }
  const index = image.indices[(iy * image.width) + ix];
  const off = index * 3;
  return scienceAdvisorArrows.isScienceAdvisorArrowColor(
    image.palette[off],
    image.palette[off + 1],
    image.palette[off + 2]
  );
}

function collectArrowPixels(image, bounds) {
  const pixels = [];
  const minX = Math.max(0, Math.floor(bounds.x));
  const minY = Math.max(0, Math.floor(bounds.y));
  const maxX = Math.min(image.width - 1, Math.ceil(bounds.x + bounds.w));
  const maxY = Math.min(image.height - 1, Math.ceil(bounds.y + bounds.h));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (isIndexedArrowPixel(image, x, y)) pixels.push({ x, y });
    }
  }
  return pixels;
}

function getSideAxisValue(point, side) {
  return side === 'left' || side === 'right' ? point.y : point.x;
}

function collectSideArrowPixels(image, rect, side, axisValue, { band = 32, axisRadius = 44 } = {}) {
  if (side === 'left') {
    return collectArrowPixels(image, {
      x: rect.x - band,
      y: axisValue - axisRadius,
      w: band,
      h: axisRadius * 2
    });
  }
  if (side === 'right') {
    return collectArrowPixels(image, {
      x: rect.x + rect.w + 1,
      y: axisValue - axisRadius,
      w: band,
      h: axisRadius * 2
    });
  }
  if (side === 'top') {
    return collectArrowPixels(image, {
      x: axisValue - axisRadius,
      y: rect.y - band,
      w: axisRadius * 2,
      h: band
    });
  }
  return collectArrowPixels(image, {
    x: axisValue - axisRadius,
    y: rect.y + rect.h + 1,
    w: axisRadius * 2,
    h: band
  });
}

function getPrincipalAxisAngle(points) {
  if (!Array.isArray(points) || points.length < 8) return null;
  const mean = points.reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y
  }), { x: 0, y: 0 });
  mean.x /= points.length;
  mean.y /= points.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  points.forEach((point) => {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  });
  return Math.atan2(2 * xy, xx - yy) / 2;
}

function normalizeUnsignedAngle(angle) {
  let normalized = Number(angle) % Math.PI;
  if (normalized < 0) normalized += Math.PI;
  return normalized;
}

function angleDeltaDegrees(a, b) {
  const delta = Math.abs(normalizeUnsignedAngle(a) - normalizeUnsignedAngle(b));
  return Math.min(delta, Math.PI - delta) * 180 / Math.PI;
}

function getRouteTangentAngle(samples, atEnd = false) {
  const ordered = atEnd ? samples.slice().reverse() : samples;
  const anchor = ordered[0];
  for (let idx = 1; idx < ordered.length; idx += 1) {
    const next = ordered[idx];
    const dx = next.x - anchor.x;
    const dy = next.y - anchor.y;
    if (Math.hypot(dx, dy) > 6) return Math.atan2(dy, dx);
  }
  return 0;
}

function getNearestDistance(point, pixels) {
  let nearest = Number.POSITIVE_INFINITY;
  pixels.forEach((pixel) => {
    nearest = Math.min(nearest, Math.hypot(point.x - pixel.x, point.y - pixel.y));
  });
  return nearest;
}

function getRouteDistanceStats(route, image) {
  const samples = sampleTechTreeArrowRoute(route, { curveSteps: 16, radius: 13 });
  const xs = samples.map((point) => point.x);
  const ys = samples.map((point) => point.y);
  const pixels = collectArrowPixels(image, {
    x: Math.min(...xs) - 32,
    y: Math.min(...ys) - 32,
    w: Math.max(...xs) - Math.min(...xs) + 64,
    h: Math.max(...ys) - Math.min(...ys) + 64
  });
  assert.ok(pixels.length >= 40, 'Expected enough Firaxis arrow pixels near generated route');
  const distances = samples.map((point) => getNearestDistance(point, pixels)).sort((a, b) => a - b);
  const mean = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  const p90 = distances[Math.floor(distances.length * 0.9)];
  return { mean, p90, samples };
}

function makeFixtureContext(t) {
  const techboxesPath = path.join(CIV3_ROOT, 'Art', 'Advisors', 'techboxes.pcx');
  const biqPath = path.join(CIV3_ROOT, 'Conquests', 'conquests.biq');
  const advisorPaths = ADVISOR_FILES_BY_ERA.map((file) => path.join(CIV3_ROOT, 'Art', 'Advisors', file));
  [techboxesPath, biqPath, ...advisorPaths].forEach((requiredPath) => {
    if (!fs.existsSync(requiredPath)) t.skip(`Missing local Civ3 stock fixture at ${requiredPath}`);
  });
  if ([techboxesPath, biqPath, ...advisorPaths].some((requiredPath) => !fs.existsSync(requiredPath))) return null;

  const bundle = loadBundle({ mode: 'global', civ3Path: CIV3_ROOT });
  const techBoxLayout = parseTechBoxSheetLayout(decodePcx(techboxesPath));
  const advisorsByEra = advisorPaths.map((advisorPath) => decodePcx(advisorPath, {
    returnIndexed: true,
    transparentIndexes: []
  }));

  const routedByEra = new Map();
  const routeFor = (sourceName, targetName) => {
    const target = getStockTechEntry(bundle, targetName);
    assert.ok(target, `Expected stock technology "${targetName}"`);
    const eraIndex = getStockTechEra(target);
    if (!routedByEra.has(eraIndex)) {
      routedByEra.set(eraIndex, layoutTechTreeArrowEdges(getStockTechPrerequisiteEdges(bundle, eraIndex).map(({ source, target: edgeTarget }) => ({
        source: { id: source.name },
        target: { id: edgeTarget.name },
        sourceRect: getStockTechRect(bundle, techBoxLayout, source.name),
        targetRect: getStockTechRect(bundle, techBoxLayout, edgeTarget.name)
      })), { slotSpacing: 10 }));
    }
    const edge = routedByEra.get(eraIndex).find((candidate) => (
      candidate.source.id === sourceName && candidate.target.id === targetName
    ));
    assert.ok(edge, `Expected stock prerequisite ${sourceName} -> ${targetName}`);
    const route = buildTechTreeArrowRoute(edge.sourceRect, edge.targetRect, {
      sourceSide: edge.sourceSide,
      targetSide: edge.targetSide,
      sourceOffset: edge.sourceOffset,
      targetOffset: edge.targetOffset,
      horizontalTolerance: 18
    });
    return { advisor: advisorsByEra[eraIndex], edge, route };
  };

  return { routeFor };
}

test('stock Conquests clear Science Advisor arrows match Firaxis endpoint tangent angles', (t) => {
  const context = makeFixtureContext(t);
  if (!context) return;
  [
    ['Bronze Working', 'Iron Working'],
    ['Theology', 'Education'],
    ['Mass Production', 'Amphibious War'],
    ['Rocketry', 'Space Flight']
  ].forEach(([sourceName, targetName]) => {
    const { advisor, edge, route } = context.routeFor(sourceName, targetName);
    const samples = sampleTechTreeArrowRoute(route, { curveSteps: 16, radius: 13 });
    const start = samples[0];
    const end = samples[samples.length - 1];
    const sourcePixels = collectSideArrowPixels(advisor, edge.sourceRect, edge.sourceSide, getSideAxisValue(start, edge.sourceSide));
    const targetPixels = collectSideArrowPixels(advisor, edge.targetRect, edge.targetSide, getSideAxisValue(end, edge.targetSide));
    const sourceAngle = getPrincipalAxisAngle(sourcePixels);
    const targetAngle = getPrincipalAxisAngle(targetPixels);
    assert.ok(sourceAngle != null, `${sourceName} -> ${targetName} has source tangent pixels`);
    assert.ok(targetAngle != null, `${sourceName} -> ${targetName} has target tangent pixels`);
    assert.ok(
      angleDeltaDegrees(getRouteTangentAngle(samples), sourceAngle) <= 14,
      `${sourceName} -> ${targetName} source tangent follows Firaxis`
    );
    assert.ok(
      angleDeltaDegrees(getRouteTangentAngle(samples, true), targetAngle) <= 14,
      `${sourceName} -> ${targetName} target tangent follows Firaxis`
    );
  });
});

test('stock Conquests clear Science Advisor arrow curves stay close to Firaxis PCX pixels', (t) => {
  const context = makeFixtureContext(t);
  if (!context) return;
  [
    { source: 'Bronze Working', target: 'Iron Working', mean: 8, p90: 9 },
    { source: 'Writing', target: 'Code of Laws', mean: 14, p90: 28 },
    { source: 'Theology', target: 'Education', mean: 14, p90: 16 },
    { source: 'Feudalism', target: 'Invention', mean: 8, p90: 10 },
    { source: 'Industrialization', target: 'The Corporation', mean: 12, p90: 16 },
    { source: 'Steam Power', target: 'Ironclads', mean: 19, p90: 24 },
    { source: 'Mass Production', target: 'Amphibious War', mean: 8, p90: 10 },
    { source: 'Rocketry', target: 'Space Flight', mean: 22, p90: 24 },
    { source: 'Space Flight', target: 'Satellites', mean: 22, p90: 32 }
  ].forEach((fixture) => {
    const { advisor, route } = context.routeFor(fixture.source, fixture.target);
    const stats = getRouteDistanceStats(route, advisor);
    assert.ok(
      stats.mean <= fixture.mean,
      `${fixture.source} -> ${fixture.target} mean curve distance ${stats.mean.toFixed(2)} <= ${fixture.mean}`
    );
    assert.ok(
      stats.p90 <= fixture.p90,
      `${fixture.source} -> ${fixture.target} p90 curve distance ${stats.p90.toFixed(2)} <= ${fixture.p90}`
    );
  });
});
