'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const planner = require('../src/mapRenderPlanner');
const mapCore = require('../src/mapEditorCore');

function buildTileGeom(width, height) {
  const tileCount = Math.floor((width * height) / 2);
  return Array.from({ length: tileCount }, (_, index) => mapCore.tileCoordsByIndex(width, index));
}

test('large 362x306 world map is above the full-canvas safety budget at high zoom', () => {
  const metrics = planner.computeWorldMetrics(362, 306, 16);

  assert.equal(metrics.width, 362);
  assert.equal(metrics.height, 306);
  assert.equal(metrics.expectedTileCount, 55386);
  assert.equal(metrics.canvasW, 23536);
  assert.equal(metrics.canvasH, 10000);
  assert.equal(metrics.pixelCount, 235360000);
  assert.equal(Math.round(metrics.rgbaBytes / 1024 / 1024), 898);
  assert.equal(planner.shouldUseChunkedRenderer(metrics), true);
});

test('large map can still keep native scroll dimensions without allocating one huge bitmap', () => {
  const metrics = planner.computeWorldMetrics(362, 306, 16);
  const rect = planner.viewportRect(11056, 4597, 1424, 806, 512);
  const chunks = planner.buildChunksForRect(metrics, rect, { chunkSize: 1024 });

  assert.equal(chunks.length, 9, 'viewport plus overscan should cover a bounded 3x3 chunk window');
  assert.deepEqual(
    chunks.map((chunk) => chunk.key),
    ['10,3', '11,3', '12,3', '10,4', '11,4', '12,4', '10,5', '11,5', '12,5']
  );
  assert.ok(
    chunks.every((chunk) => chunk.w <= 1024 && chunk.h <= 1024),
    'large-map backing stores must be bounded by chunk size'
  );
});

test('chunked rendering uses tile influence bleed so viewport-edge art is not dropped', () => {
  const metrics = planner.computeWorldMetrics(362, 306, 16);
  const tileGeom = buildTileGeom(362, 306);
  const viewport = { x: 11056, y: 4597, w: 1424, h: 806 };
  const withBleed = planner.collectTileIndexesForRect(
    tileGeom,
    metrics,
    planner.expandRect(viewport, 512)
  );
  const withoutBleed = planner.collectTileIndexesForRect(tileGeom, metrics, viewport);

  assert.ok(withBleed.length > withoutBleed.length, 'overscan must draw source tiles outside the viewport');
  assert.ok(withBleed.length < 5000, 'visible chunk redraw should stay far below full-map tile count');
  assert.ok(withBleed.length > 0);
});

test('safe full-canvas zoom selection avoids accidental high-zoom giant canvases', () => {
  const selected = planner.chooseSafeFullCanvasZoom(362, 306, 16, {
    pixelBudget: 32 * 1000 * 1000,
    maxFullCanvasEdge: 12000
  });

  assert.equal(selected, 5);
  assert.equal(
    planner.shouldUseChunkedRenderer(planner.computeWorldMetrics(362, 306, selected), {
      pixelBudget: 32 * 1000 * 1000,
      maxFullCanvasEdge: 12000
    }),
    false
  );
});

test('small and medium maps stay on the existing full-canvas path', () => {
  assert.equal(planner.shouldUseChunkedRenderer(planner.computeWorldMetrics(180, 180, 5)), false);
  assert.equal(planner.shouldUseChunkedRenderer(planner.computeWorldMetrics(256, 191, 5)), false);
});

test('renderer loads planner before renderer.js and keeps minimap independent from chunks', () => {
  const indexText = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    indexText,
    /<script src="\.\/mapEditorCore\.js"><\/script>\s*<script src="\.\/mapRenderPlanner\.js"><\/script>\s*<script src="\.\/mapGeneratorCore\.js"><\/script>/
  );
  assert.match(
    rendererText,
    /const mapRenderPlanner = \(typeof window !== 'undefined' && window\.MapRenderPlanner\) \? window\.MapRenderPlanner : null;/
  );
  assert.match(
    rendererText,
    /const minimapBaseCanvas = document\.createElement\('canvas'\);[\s\S]*?for \(let i = 0; i <= maxIdx; i \+= 1\) \{[\s\S]*?drawTerrainSpriteToContext\(baseCtx, record, geom, sx, sy, miniTileW, miniTileH\);/,
    'minimap should remain a whole-map data render instead of depending on visible chunks'
  );
});

test('renderer uses bounded base and hover canvases for chunked maps', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const useChunkedMapRenderer = !!\([\s\S]*?mapRenderPlanner\.shouldUseChunkedRenderer\(renderPlannerMetrics\)[\s\S]*?\);/
  );
  assert.match(
    rendererText,
    /canvas\.width = useChunkedMapRenderer \? 1 : canvasLogicalWidth;[\s\S]*?canvas\.height = useChunkedMapRenderer \? 1 : canvasLogicalHeight;/
  );
  assert.match(
    rendererText,
    /hoverCanvas\.width = useChunkedMapRenderer \? 1 : canvasLogicalWidth;[\s\S]*?hoverCanvas\.height = useChunkedMapRenderer \? 1 : canvasLogicalHeight;/
  );
  assert.match(
    rendererText,
    /const syncHoverCanvasToViewport = \(\) => \{[\s\S]*?hoverCanvas\.style\.transform = `translate\(\$\{Math\.round\(mapPane\.scrollLeft \|\| 0\)\}px, \$\{Math\.round\(mapPane\.scrollTop \|\| 0\)\}px\)`;[\s\S]*?hoverCtx\.setTransform\(1, 0, 0, 1, -Math\.round\(mapPane\.scrollLeft \|\| 0\), -Math\.round\(mapPane\.scrollTop \|\| 0\)\);/,
    'chunked hover overlay should be viewport-sized and translated into world coordinates'
  );
});

test('renderer preserves interaction math while redirecting large redraws to chunks', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const getCanvasPointFromEvent = \(ev\) => \{[\s\S]*?x: \(\(ev\.clientX - rect\.left\) \/ Math\.max\(1, rect\.width\)\) \* canvasLogicalWidth,[\s\S]*?y: \(\(ev\.clientY - rect\.top\) \/ Math\.max\(1, rect\.height\)\) \* canvasLogicalHeight/,
    'hit testing and zoom anchors should use logical map dimensions, not the bounded backing canvas size'
  );
  assert.match(
    rendererText,
    /const redrawMapCanvasInPlace = \(clipRects = null, renderOptions = \{\}\) => \{[\s\S]*?if \(useChunkedMapRenderer && !\(renderOptions && renderOptions\.chunkDraw\)\) \{[\s\S]*?redrawChunkedMapCanvas\(clipRects, \{ force: true \}\);[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    rendererText,
    /const getChunkCandidateIndexes = \(chunk\) => \{[\s\S]*?const indexes = collectTileIndexesForRects\(\[\{ x: chunk\.x, y: chunk\.y, w: chunk\.w, h: chunk\.h \}\]\) \|\| \[\];[\s\S]*?mapChunkCandidateCache\.set\(chunk\.key, indexes\);[\s\S]*?\};[\s\S]*?candidateIndexes: getChunkCandidateIndexes\(chunk\)/,
    'chunk redraws should iterate only source tiles whose pixels can intersect that chunk'
  );
  assert.match(
    rendererText,
    /const candidateCount = candidateIndexes \? candidateIndexes\.length : maxIdx \+ 1;[\s\S]*?candidateMode: candidateIndexes \? 'bounded' : 'full'/,
    'redraw logs should expose bounded candidate mode for large-map performance diagnosis'
  );
  assert.ok(
    rendererText.includes("const scheduleChunkedMapViewportRefresh = (reason = 'scroll') => {")
      && rendererText.includes('redrawChunkedMapCanvas(null, { reason });')
      && rendererText.includes("scheduleChunkedMapViewportRefresh('scroll');"),
    'scrolling should schedule visible chunk refreshes without replacing native scroll behavior'
  );
  assert.match(
    rendererText,
    /if \(chunkLayer\) mapCanvasStack\.appendChild\(chunkLayer\);[\s\S]*?mapCanvasStack\.appendChild\(canvas\);[\s\S]*?mapCanvasStack\.appendChild\(hoverCanvas\);/,
    'chunk pixels should sit under the existing interaction and hover layers'
  );
});
