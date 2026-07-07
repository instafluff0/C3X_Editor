(function mapRenderPlannerFactory(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.MapRenderPlanner = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function mapRenderPlannerInit() {
  const DEFAULT_ZOOM_LEVELS = [3, 5, 7, 9, 12, 16];
  const DEFAULT_CHUNK_SIZE = 1024;
  const DEFAULT_PIXEL_BUDGET = 20 * 1000 * 1000;
  const DEFAULT_MAX_FULL_CANVAS_EDGE = 12000;
  const DEFAULT_VIEWPORT_OVERSCAN_PX = 512;

  function clampZoom(rawZoom, zoomLevels = DEFAULT_ZOOM_LEVELS) {
    const levels = Array.isArray(zoomLevels) && zoomLevels.length > 0 ? zoomLevels : DEFAULT_ZOOM_LEVELS;
    const raw = Number(rawZoom);
    const target = Number.isFinite(raw) ? raw : levels[0];
    let best = levels[0];
    let bestDist = Math.abs(target - best);
    for (let i = 1; i < levels.length; i += 1) {
      const candidate = levels[i];
      const dist = Math.abs(target - candidate);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    return best;
  }

  function scaleForZoom(zoom) {
    return Math.max(0.18, clampZoom(zoom) / 16);
  }

  function computeTileMetrics(zoom) {
    const tilePx = Math.max(2, clampZoom(zoom));
    const scale = scaleForZoom(tilePx);
    return {
      tilePx,
      scale,
      tileW: Math.max(24, Math.round(128 * scale)),
      tileH: Math.max(12, Math.round(64 * scale)),
      stepX: Math.max(12, Math.round(64 * scale)),
      stepY: Math.max(6, Math.round(32 * scale))
    };
  }

  function computeWorldMetrics(width, height, zoom, options = {}) {
    const mapWidth = Math.max(0, Math.floor(Number(width) || 0));
    const mapHeight = Math.max(0, Math.floor(Number(height) || 0));
    const tile = computeTileMetrics(zoom);
    const padX = tile.tileW + 24;
    const padY = tile.tileH + 24;
    const minSx = padX - tile.stepX;
    const minSy = padY - tile.stepY;
    const maxSx = padX + Math.max(0, mapWidth - 1) * tile.stepX - tile.stepX;
    const maxSy = padY + Math.max(0, mapHeight - 1) * tile.stepY - tile.stepY;
    const wrapCenterOffset = Math.max(0, Number(options.wrapCenterOffset) || 0);
    const wrapCenterOffsetY = Math.max(0, Number(options.wrapCenterOffsetY) || 0);
    const canvasW = Math.max(1200, (maxSx - minSx) + tile.tileW + padX * 2 + wrapCenterOffset * 2);
    const canvasH = Math.max(800, (maxSy - minSy) + tile.tileH + padY * 2 + wrapCenterOffsetY * 2);
    const originX = padX - minSx + wrapCenterOffset;
    const originY = padY - minSy + wrapCenterOffsetY;
    return {
      width: mapWidth,
      height: mapHeight,
      expectedTileCount: Math.floor((mapWidth * mapHeight) / 2),
      ...tile,
      padX,
      padY,
      minSx,
      minSy,
      maxSx,
      maxSy,
      originX,
      originY,
      canvasW,
      canvasH,
      pixelCount: canvasW * canvasH,
      rgbaBytes: canvasW * canvasH * 4,
      baseWorldLeftPx: originX + minSx,
      baseWorldTopPx: originY + minSy,
      baseWorldWidthPx: (maxSx - minSx) + tile.tileW,
      baseWorldHeightPx: (maxSy - minSy) + tile.tileH
    };
  }

  function shouldUseChunkedRenderer(metrics, options = {}) {
    if (!metrics) return false;
    const pixelBudget = Math.max(1, Number(options.pixelBudget) || DEFAULT_PIXEL_BUDGET);
    const maxFullCanvasEdge = Math.max(1, Number(options.maxFullCanvasEdge) || DEFAULT_MAX_FULL_CANVAS_EDGE);
    return (
      Number(metrics.pixelCount) > pixelBudget
      || Number(metrics.canvasW) > maxFullCanvasEdge
      || Number(metrics.canvasH) > maxFullCanvasEdge
    );
  }

  function chooseSafeFullCanvasZoom(width, height, requestedZoom, options = {}) {
    const levels = (Array.isArray(options.zoomLevels) && options.zoomLevels.length > 0 ? options.zoomLevels : DEFAULT_ZOOM_LEVELS)
      .slice()
      .sort((a, b) => b - a);
    const requested = clampZoom(requestedZoom, levels);
    const eligible = levels.filter((level) => level <= requested);
    for (let i = 0; i < eligible.length; i += 1) {
      const metrics = computeWorldMetrics(width, height, eligible[i], options);
      if (!shouldUseChunkedRenderer(metrics, options)) return eligible[i];
    }
    return levels[levels.length - 1];
  }

  function normalizeRect(rect) {
    if (!rect) return null;
    const x = Math.floor(Number(rect.x) || 0);
    const y = Math.floor(Number(rect.y) || 0);
    const w = Math.ceil(Number(rect.w) || 0);
    const h = Math.ceil(Number(rect.h) || 0);
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function expandRect(rect, amount) {
    const base = normalizeRect(rect);
    if (!base) return null;
    const pad = Math.max(0, Math.ceil(Number(amount) || 0));
    return {
      x: base.x - pad,
      y: base.y - pad,
      w: base.w + pad * 2,
      h: base.h + pad * 2
    };
  }

  function clampRectToWorld(rect, metrics) {
    const base = normalizeRect(rect);
    if (!base || !metrics) return null;
    const maxW = Math.max(1, Math.ceil(Number(metrics.canvasW) || 1));
    const maxH = Math.max(1, Math.ceil(Number(metrics.canvasH) || 1));
    const x1 = Math.max(0, Math.min(maxW, base.x));
    const y1 = Math.max(0, Math.min(maxH, base.y));
    const x2 = Math.max(0, Math.min(maxW, base.x + base.w));
    const y2 = Math.max(0, Math.min(maxH, base.y + base.h));
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function rectIntersects(a, b) {
    const left = normalizeRect(a);
    const right = normalizeRect(b);
    if (!left || !right) return false;
    return (
      left.x < right.x + right.w
      && left.x + left.w > right.x
      && left.y < right.y + right.h
      && left.y + left.h > right.y
    );
  }

  function chunkKey(chunkX, chunkY) {
    return `${chunkX},${chunkY}`;
  }

  function buildChunksForRect(metrics, rect, options = {}) {
    if (!metrics) return [];
    const chunkSize = Math.max(128, Math.floor(Number(options.chunkSize) || DEFAULT_CHUNK_SIZE));
    const clipped = clampRectToWorld(rect, metrics);
    if (!clipped) return [];
    const firstX = Math.floor(clipped.x / chunkSize);
    const lastX = Math.floor((clipped.x + clipped.w - 1) / chunkSize);
    const firstY = Math.floor(clipped.y / chunkSize);
    const lastY = Math.floor((clipped.y + clipped.h - 1) / chunkSize);
    const chunks = [];
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        const left = x * chunkSize;
        const top = y * chunkSize;
        chunks.push({
          key: chunkKey(x, y),
          chunkX: x,
          chunkY: y,
          x: left,
          y: top,
          w: Math.min(chunkSize, Math.max(0, metrics.canvasW - left)),
          h: Math.min(chunkSize, Math.max(0, metrics.canvasH - top))
        });
      }
    }
    return chunks;
  }

  function viewportRect(scrollLeft, scrollTop, clientWidth, clientHeight, overscanPx = DEFAULT_VIEWPORT_OVERSCAN_PX) {
    return expandRect({
      x: Math.floor(Number(scrollLeft) || 0),
      y: Math.floor(Number(scrollTop) || 0),
      w: Math.max(1, Math.ceil(Number(clientWidth) || 1)),
      h: Math.max(1, Math.ceil(Number(clientHeight) || 1))
    }, overscanPx);
  }

  function tileToScreenTopLeft(geom, metrics) {
    const xPos = Number(geom && geom.xPos) || 0;
    const yPos = Number(geom && geom.yPos) || 0;
    return {
      sx: metrics.padX + xPos * metrics.stepX - metrics.stepX + metrics.originX,
      sy: metrics.padY + yPos * metrics.stepY - metrics.stepY + metrics.originY
    };
  }

  function tileInfluenceRect(sx, sy, metrics) {
    return {
      x: sx - Math.round(metrics.tileW * 1.08),
      y: sy - Math.round(metrics.tileH * 1.18),
      w: Math.round(metrics.tileW * 3.18),
      h: Math.round(metrics.tileH * 4.05)
    };
  }

  function collectTileIndexesForRect(tileGeom, metrics, rect) {
    const clipped = normalizeRect(rect);
    if (!Array.isArray(tileGeom) || !metrics || !clipped) return [];
    const out = [];
    for (let i = 0; i < tileGeom.length; i += 1) {
      const geom = tileGeom[i];
      if (!geom) continue;
      const pos = tileToScreenTopLeft(geom, metrics);
      if (rectIntersects(tileInfluenceRect(pos.sx, pos.sy, metrics), clipped)) out.push(i);
    }
    return out;
  }

  return {
    DEFAULT_ZOOM_LEVELS,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_PIXEL_BUDGET,
    DEFAULT_MAX_FULL_CANVAS_EDGE,
    DEFAULT_VIEWPORT_OVERSCAN_PX,
    clampZoom,
    scaleForZoom,
    computeTileMetrics,
    computeWorldMetrics,
    shouldUseChunkedRenderer,
    chooseSafeFullCanvasZoom,
    normalizeRect,
    expandRect,
    clampRectToWorld,
    rectIntersects,
    chunkKey,
    buildChunksForRect,
    viewportRect,
    tileToScreenTopLeft,
    tileInfluenceRect,
    collectTileIndexesForRect
  };
}));
