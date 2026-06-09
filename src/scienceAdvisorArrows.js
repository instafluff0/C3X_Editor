(function scienceAdvisorArrowsFactory(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.ScienceAdvisorArrows = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function scienceAdvisorArrowsInit() {
const SCIENCE_ADVISOR_ARROW_STYLE = {
  curveRadius: 13,
  curveSteps: 24,
  segmentStep: 0.45,
  rasterScale: 4,
  coverageThreshold: 3,
  colors: {
    outline: { r: 103, g: 28, b: 18 },
    main: { r: 160, g: 45, b: 34 },
    highlight: { r: 218, g: 116, b: 76 }
  },
  body: {
    outlineRadius: 1.5,
    mainRadius: 0,
    highlightRadius: 0,
    highlightOffset: { x: 1, y: -1 }
  },
  head: {
    outline: { length: 6, half: 5 },
    main: { length: 5, half: 4 },
    glint: { length: 5, offsetBack: 1.5, offsetPerp: -2.1, tipBack: 1.1, tipPerp: -0.8 }
  }
};

const SCIENCE_ADVISOR_ARROW_COLOR_PROFILES = {
  red: {
    colors: {
      outline: { r: 103, g: 28, b: 18 },
      main: { r: 160, g: 45, b: 34 },
      highlight: { r: 218, g: 116, b: 76 }
    },
    predicate: isScienceAdvisorRedArrowColor
  },
  blue: {
    colors: {
      outline: { r: 9, g: 53, b: 93 },
      main: { r: 18, g: 84, b: 146 },
      highlight: { r: 73, g: 141, b: 198 }
    },
    predicate: isScienceAdvisorBlueArrowColor
  }
};

function getScienceAdvisorArrowColorProfile(eraIndex) {
  const era = Number(eraIndex);
  return era >= 3 ? SCIENCE_ADVISOR_ARROW_COLOR_PROFILES.blue : SCIENCE_ADVISOR_ARROW_COLOR_PROFILES.red;
}

function getNearestPaletteIndex(palette, target, fallback = 0, predicate = null) {
  if (!palette || typeof palette.length !== 'number' || palette.length < 3 || !target) return fallback;
  let best = fallback;
  let bestDist = Number.POSITIVE_INFINITY;
  let found = false;
  const colorCount = Math.floor(palette.length / 3);
  for (let idx = 0; idx < colorCount; idx += 1) {
    const off = idx * 3;
    const r = Number(palette[off]) || 0;
    const g = Number(palette[off + 1]) || 0;
    const b = Number(palette[off + 2]) || 0;
    if (typeof predicate === 'function' && !predicate(r, g, b, idx)) continue;
    const dr = r - target.r;
    const dg = g - target.g;
    const db = b - target.b;
    const dist = (dr * dr) + (dg * dg) + (db * db);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
      found = true;
    }
  }
  if (!found && typeof predicate === 'function') {
    return getNearestPaletteIndex(palette, target, fallback, null);
  }
  return best;
}

function getPaletteColor(palette, index, fallback) {
  const idx = Number(index);
  if (!palette || !Number.isFinite(idx) || idx < 0 || (idx * 3 + 2) >= palette.length) return fallback;
  const off = idx * 3;
  return { r: palette[off], g: palette[off + 1], b: palette[off + 2] };
}

function makePaletteStyle(palette, options = {}) {
  const profile = getScienceAdvisorArrowColorProfile(options && options.eraIndex);
  const colors = profile && profile.colors ? profile.colors : SCIENCE_ADVISOR_ARROW_STYLE.colors;
  const arrowPredicate = profile && typeof profile.predicate === 'function'
    ? profile.predicate
    : ((r, g, b) => isScienceAdvisorArrowColor(r, g, b));
  const outlineIndex = getNearestPaletteIndex(palette, colors.outline, 0, arrowPredicate);
  const mainIndex = getNearestPaletteIndex(palette, colors.main, outlineIndex, arrowPredicate);
  const highlightIndex = getNearestPaletteIndex(palette, colors.highlight, mainIndex, arrowPredicate);
  return {
    outlineIndex,
    mainIndex,
    highlightIndex,
    outlineColor: getPaletteColor(palette, outlineIndex, colors.outline),
    mainColor: getPaletteColor(palette, mainIndex, colors.main),
    highlightColor: getPaletteColor(palette, highlightIndex, colors.highlight)
  };
}

function isScienceAdvisorRedArrowColor(r, g, b) {
  return r >= 58 && r <= 235
    && g >= 12 && g <= 170
    && b <= 95
    && r > g + 22
    && g >= b - 12;
}

function isScienceAdvisorBlueArrowColor(r, g, b) {
  return b >= 58 && b <= 235
    && g >= 24 && g <= 185
    && r <= 125
    && b > r + 18
    && b >= g - 10;
}

function isScienceAdvisorArrowColor(r, g, b) {
  return isScienceAdvisorRedArrowColor(r, g, b) || isScienceAdvisorBlueArrowColor(r, g, b);
}

function getIndexedRgb(indices, palette, offset) {
  const idx = indices[offset];
  const palOff = idx * 3;
  return {
    r: palette && palOff < palette.length ? Number(palette[palOff]) || 0 : 0,
    g: palette && palOff + 1 < palette.length ? Number(palette[palOff + 1]) || 0 : 0,
    b: palette && palOff + 2 < palette.length ? Number(palette[palOff + 2]) || 0 : 0
  };
}

function clearScienceAdvisorArrowPixelsIndexed({ indices, palette, width, height, bounds }) {
  if (!indices || !palette || !width || !height) return;
  const safeBounds = bounds || { x1: 0, y1: 0, x2: width - 1, y2: height - 1 };
  const x1 = Math.max(0, Math.min(width - 1, Math.floor(Number(safeBounds.x1) || 0)));
  const y1 = Math.max(0, Math.min(height - 1, Math.floor(Number(safeBounds.y1) || 0)));
  const x2 = Math.max(x1, Math.min(width - 1, Math.ceil(Number(safeBounds.x2) || 0)));
  const y2 = Math.max(y1, Math.min(height - 1, Math.ceil(Number(safeBounds.y2) || 0)));
  const mask = new Uint8Array(width * height);
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const offset = y * width + x;
      const color = getIndexedRgb(indices, palette, offset);
      if (isScienceAdvisorArrowColor(color.r, color.g, color.b)) mask[offset] = 1;
    }
  }
  const dilated = new Uint8Array(mask);
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const offset = y * width + x;
      if (!mask[offset]) continue;
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
          dilated[ny * width + nx] = 1;
        }
      }
    }
  }
  const findReplacement = (x, y) => {
    const candidates = [
      [0, -7], [0, 7], [-7, 0], [7, 0],
      [0, -12], [0, 12], [-12, 0], [12, 0],
      [-8, -8], [8, -8], [-8, 8], [8, 8]
    ];
    for (const [ox, oy] of candidates) {
      const nx = x + ox;
      const ny = y + oy;
      if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
      const offset = ny * width + nx;
      if (!dilated[offset]) return indices[offset];
    }
    return indices[y * width + x];
  };
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const offset = y * width + x;
      if (dilated[offset]) indices[offset] = findReplacement(x, y);
    }
  }
}

function setIndexedPixel(indices, width, height, x, y, paletteIndex) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= width || iy < 0 || iy >= height) return;
  indices[iy * width + ix] = paletteIndex;
}

function setRgbaPixel(rgba, width, height, x, y, color) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || ix >= width || iy < 0 || iy >= height || !color) return;
  const off = ((iy * width) + ix) * 4;
  rgba[off] = color.r;
  rgba[off + 1] = color.g;
  rgba[off + 2] = color.b;
  rgba[off + 3] = 255;
}

function drawCircle(setPixel, width, height, x, y, radius, value) {
  const r = Math.max(0, Math.round(radius));
  for (let oy = -r; oy <= r; oy += 1) {
    for (let ox = -r; ox <= r; ox += 1) {
      if ((ox * ox) + (oy * oy) > r * r) continue;
      setPixel(width, height, x + ox, y + oy, value);
    }
  }
}

function getScaledRadius(radius, scale) {
  const r = Math.max(0, Number(radius) || 0);
  const s = Math.max(1, Number(scale) || 1);
  if (s === 1) return Math.round(r);
  return r > 0 ? Math.max(1, Math.round(r * s)) : 0;
}

function drawSegment(setPixel, width, height, from, to, radius, value) {
  const fx = Number(from && from.x) || 0;
  const fy = Number(from && from.y) || 0;
  const txRaw = Number(to && to.x) || 0;
  const tyRaw = Number(to && to.y) || 0;
  const rawDx = txRaw - fx;
  const rawDy = tyRaw - fy;
  if (Math.abs(rawDx) > 0.001 && Math.abs(rawDy) > 0.001) {
    const distance = Math.sqrt((rawDx * rawDx) + (rawDy * rawDy)) || 1;
    const step = Math.max(0.2, Number(SCIENCE_ADVISOR_ARROW_STYLE.segmentStep) || 0.5);
    const samples = Math.max(1, Math.ceil(distance / step));
    for (let idx = 0; idx <= samples; idx += 1) {
      const t = idx / samples;
      drawCircle(setPixel, width, height, fx + (rawDx * t), fy + (rawDy * t), radius, value);
    }
    return;
  }
  let x0 = Math.round(from.x);
  let y0 = Math.round(from.y);
  const x1 = Math.round(to.x);
  const y1 = Math.round(to.y);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    drawCircle(setPixel, width, height, x0, y0, radius, value);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function getUnitVector(route, tip, prev) {
  const vector = route && route.headVector
    ? route.headVector
    : { x: tip.x - prev.x, y: tip.y - prev.y };
  const magnitude = Math.sqrt((vector.x * vector.x) + (vector.y * vector.y)) || 1;
  return {
    ux: vector.x / magnitude,
    uy: vector.y / magnitude,
    px: -(vector.y / magnitude),
    py: vector.x / magnitude
  };
}

function drawArrowHead(setPixel, width, height, tip, unit, value, options = {}) {
  const length = Math.max(4, Number(options.length) || 7);
  const half = Math.max(2, Number(options.half) || 3);
  const tx = Math.round(tip.x);
  const ty = Math.round(tip.y);
  for (let ix = 0; ix <= length; ix += 1) {
    const cx = tx - (unit.ux * ix);
    const cy = ty - (unit.uy * ix);
    const maxY = Math.round((ix / length) * half);
    for (let oy = -maxY; oy <= maxY; oy += 1) {
      setPixel(width, height, cx + (unit.px * oy), cy + (unit.py * oy), value);
    }
  }
}

function drawArrowHeadGlint(setPixel, width, height, tip, unit, value, scale = 1) {
  const glint = SCIENCE_ADVISOR_ARROW_STYLE.head.glint;
  const s = Math.max(1, Number(scale) || 1);
  const from = {
    x: tip.x - (unit.ux * glint.length * s) - (unit.ux * glint.offsetBack * s) + (unit.px * glint.offsetPerp * s),
    y: tip.y - (unit.uy * glint.length * s) - (unit.uy * glint.offsetBack * s) + (unit.py * glint.offsetPerp * s)
  };
  const to = {
    x: tip.x - (unit.ux * glint.tipBack * s) + (unit.px * glint.tipPerp * s),
    y: tip.y - (unit.uy * glint.tipBack * s) + (unit.py * glint.tipPerp * s)
  };
  drawSegment(setPixel, width, height, from, to, getScaledRadius(0, s), value);
}

function getRoutePoints(route, techBoxLayout) {
  if (techBoxLayout && typeof techBoxLayout.sampleTechTreeArrowRoute === 'function') {
    return techBoxLayout.sampleTechTreeArrowRoute(route, {
      radius: SCIENCE_ADVISOR_ARROW_STYLE.curveRadius,
      curveSteps: SCIENCE_ADVISOR_ARROW_STYLE.curveSteps
    });
  }
  return (route && Array.isArray(route.points)) ? route.points : [];
}

function drawRoute({ setPixel, width, height, route, techBoxLayout, values, scale = 1 }) {
  const s = Math.max(1, Number(scale) || 1);
  const points = getRoutePoints(route, techBoxLayout).map((point) => (
    s === 1 ? point : { x: point.x * s, y: point.y * s }
  ));
  if (points.length < 1) return;
  const outlineRadius = getScaledRadius(SCIENCE_ADVISOR_ARROW_STYLE.body.outlineRadius, s);
  const mainRadius = getScaledRadius(SCIENCE_ADVISOR_ARROW_STYLE.body.mainRadius, s);
  const highlightRadius = getScaledRadius(SCIENCE_ADVISOR_ARROW_STYLE.body.highlightRadius, s);
  for (let idx = 1; idx < points.length; idx += 1) {
    drawSegment(setPixel, width, height, points[idx - 1], points[idx], outlineRadius, values.outline);
  }
  for (let idx = 1; idx < points.length; idx += 1) {
    drawSegment(setPixel, width, height, points[idx - 1], points[idx], mainRadius, values.main);
  }
  const offset = SCIENCE_ADVISOR_ARROW_STYLE.body.highlightOffset;
  for (let idx = 1; idx < points.length; idx += 1) {
    drawSegment(
      setPixel,
      width,
      height,
      { x: points[idx - 1].x + (offset.x * s), y: points[idx - 1].y + (offset.y * s) },
      { x: points[idx].x + (offset.x * s), y: points[idx].y + (offset.y * s) },
      highlightRadius,
      values.highlight
    );
  }
  const tip = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : { x: tip.x - (route && route.dir || 1), y: tip.y };
  const unit = getUnitVector(route, tip, prev);
  drawArrowHead(setPixel, width, height, tip, unit, values.outline, {
    length: SCIENCE_ADVISOR_ARROW_STYLE.head.outline.length * s,
    half: SCIENCE_ADVISOR_ARROW_STYLE.head.outline.half * s
  });
  drawArrowHead(setPixel, width, height, tip, unit, values.main, {
    length: SCIENCE_ADVISOR_ARROW_STYLE.head.main.length * s,
    half: SCIENCE_ADVISOR_ARROW_STYLE.head.main.half * s
  });
  drawArrowHeadGlint(setPixel, width, height, tip, unit, values.highlight, s);
}

function rasterizeRouteLayers({ width, height, routes, techBoxLayout }) {
  const scale = Math.max(1, Math.round(Number(SCIENCE_ADVISOR_ARROW_STYLE.rasterScale) || 1));
  const scaledWidth = Math.max(1, width * scale);
  const scaledHeight = Math.max(1, height * scale);
  const highRes = new Uint8Array(scaledWidth * scaledHeight);
  const setLayerPixel = (w, h, x, y, value) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;
    highRes[iy * w + ix] = value;
  };
  (Array.isArray(routes) ? routes : []).forEach((route) => {
    drawRoute({
      setPixel: setLayerPixel,
      width: scaledWidth,
      height: scaledHeight,
      route,
      techBoxLayout,
      values: { outline: 1, main: 2, highlight: 3 },
      scale
    });
  });
  const layerMap = new Uint8Array(width * height);
  const coverageMap = new Uint8Array(width * height);
  const threshold = Math.max(1, Math.min(scale * scale, Math.round(Number(SCIENCE_ADVISOR_ARROW_STYLE.coverageThreshold) || 1)));
  const maxCoverage = scale * scale;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const counts = [0, 0, 0, 0];
      for (let oy = 0; oy < scale; oy += 1) {
        const row = ((y * scale) + oy) * scaledWidth;
        for (let ox = 0; ox < scale; ox += 1) {
          counts[highRes[row + (x * scale) + ox]] += 1;
        }
      }
      let bestLayer = 0;
      let bestCount = 0;
      for (let layer = 1; layer <= 3; layer += 1) {
        if (counts[layer] > bestCount || (counts[layer] === bestCount && layer > bestLayer)) {
          bestLayer = layer;
          bestCount = counts[layer];
        }
      }
      if (bestCount >= threshold) {
        const out = (y * width) + x;
        layerMap[out] = bestLayer;
        coverageMap[out] = Math.max(1, Math.min(255, Math.round((bestCount / maxCoverage) * 255)));
      }
    }
  }
  return { layerMap, coverageMap };
}

function blendColor(base, arrow, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  return {
    r: Math.round((arrow.r * a) + (base.r * (1 - a))),
    g: Math.round((arrow.g * a) + (base.g * (1 - a))),
    b: Math.round((arrow.b * a) + (base.b * (1 - a)))
  };
}

function applyLayerMapIndexed({ indices, palette, paletteStyle, layerMap, coverageMap }) {
  if (!indices || !palette || !layerMap || !coverageMap || !paletteStyle) return;
  for (let idx = 0; idx < layerMap.length; idx += 1) {
    const layer = layerMap[idx];
    if (!layer) continue;
    const alpha = (Number(coverageMap[idx]) || 0) / 255;
    if (layer === 1 && alpha >= 0.98) {
      indices[idx] = paletteStyle.outlineIndex;
    } else if (layer === 2 && alpha >= 0.98) {
      indices[idx] = paletteStyle.mainIndex;
    } else if (layer === 3 && alpha >= 0.98) {
      indices[idx] = paletteStyle.highlightIndex;
    } else {
      const arrow = layer === 1 ? paletteStyle.outlineColor : (layer === 2 ? paletteStyle.mainColor : paletteStyle.highlightColor);
      const blended = blendColor(getIndexedRgb(indices, palette, idx), arrow, alpha);
      indices[idx] = getNearestPaletteIndex(palette, blended, indices[idx]);
    }
  }
}

function applyLayerMapRgba({ rgba, paletteStyle, layerMap, coverageMap }) {
  if (!rgba || !layerMap || !coverageMap || !paletteStyle) return;
  for (let idx = 0; idx < layerMap.length; idx += 1) {
    const layer = layerMap[idx];
    let color = null;
    if (layer === 1) color = paletteStyle.outlineColor;
    else if (layer === 2) color = paletteStyle.mainColor;
    else if (layer === 3) color = paletteStyle.highlightColor;
    if (!color) continue;
    const off = idx * 4;
    rgba[off] = color.r;
    rgba[off + 1] = color.g;
    rgba[off + 2] = color.b;
    rgba[off + 3] = Math.max(0, Math.min(255, Number(coverageMap[idx]) || 0));
  }
}

function drawScienceAdvisorRouteIndexed({ indices, palette, width, height, route, techBoxLayout, eraIndex }) {
  drawScienceAdvisorRoutesIndexed({ indices, palette, width, height, routes: route ? [route] : [], techBoxLayout, eraIndex });
}

function drawScienceAdvisorRoutesIndexed({ indices, palette, width, height, routes, techBoxLayout, eraIndex }) {
  if (!indices || !width || !height) return;
  const routeList = (Array.isArray(routes) ? routes : []).filter(Boolean);
  if (routeList.length === 0) return;
  const paletteStyle = makePaletteStyle(palette, { eraIndex });
  const raster = rasterizeRouteLayers({ width, height, routes: routeList, techBoxLayout });
  applyLayerMapIndexed({
    indices,
    palette,
    paletteStyle,
    layerMap: raster.layerMap,
    coverageMap: raster.coverageMap
  });
}

function drawScienceAdvisorRouteRgba({ rgba, palette, width, height, route, techBoxLayout, eraIndex }) {
  drawScienceAdvisorRoutesRgba({ rgba, palette, width, height, routes: route ? [route] : [], techBoxLayout, eraIndex });
}

function drawScienceAdvisorRoutesRgba({ rgba, palette, width, height, routes, techBoxLayout, eraIndex }) {
  if (!rgba || !width || !height) return;
  const routeList = (Array.isArray(routes) ? routes : []).filter(Boolean);
  if (routeList.length === 0) return;
  const paletteStyle = makePaletteStyle(palette, { eraIndex });
  const raster = rasterizeRouteLayers({ width, height, routes: routeList, techBoxLayout });
  applyLayerMapRgba({
    rgba,
    paletteStyle,
    layerMap: raster.layerMap,
    coverageMap: raster.coverageMap
  });
}

return {
  SCIENCE_ADVISOR_ARROW_STYLE,
  SCIENCE_ADVISOR_ARROW_COLOR_PROFILES,
  getNearestPaletteIndex,
  makePaletteStyle,
  getScienceAdvisorArrowColorProfile,
  isScienceAdvisorRedArrowColor,
  isScienceAdvisorBlueArrowColor,
  isScienceAdvisorArrowColor,
  clearScienceAdvisorArrowPixelsIndexed,
  drawScienceAdvisorRouteIndexed,
  drawScienceAdvisorRoutesIndexed,
  drawScienceAdvisorRouteRgba,
  drawScienceAdvisorRoutesRgba
};
}));
