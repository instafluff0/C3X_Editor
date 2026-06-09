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

function cloneArrowRgb(color) {
  return {
    r: Number(color && color.r) || 0,
    g: Number(color && color.g) || 0,
    b: Number(color && color.b) || 0
  };
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInteger(value, fallback, min, max) {
  return Math.round(clampNumber(value, fallback, min, max));
}

function normalizeArrowRgb(input, fallback) {
  const source = input && typeof input === 'object' ? input : null;
  const fallbackColor = fallback && typeof fallback === 'object' ? fallback : { r: 0, g: 0, b: 0 };
  return {
    r: clampInteger(source ? source.r : undefined, fallbackColor.r, 0, 255),
    g: clampInteger(source ? source.g : undefined, fallbackColor.g, 0, 255),
    b: clampInteger(source ? source.b : undefined, fallbackColor.b, 0, 255)
  };
}

function getScienceAdvisorArrowColorProfile(eraIndex) {
  const era = Number(eraIndex);
  return era >= 3 ? SCIENCE_ADVISOR_ARROW_COLOR_PROFILES.blue : SCIENCE_ADVISOR_ARROW_COLOR_PROFILES.red;
}

function normalizeScienceAdvisorArrowStyle(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = SCIENCE_ADVISOR_ARROW_STYLE;
  const profile = getScienceAdvisorArrowColorProfile(options && options.eraIndex);
  const defaultColors = profile && profile.colors ? profile.colors : defaults.colors;
  const colors = source.colors && typeof source.colors === 'object' ? source.colors : {};
  const body = source.body && typeof source.body === 'object' ? source.body : {};
  const head = source.head && typeof source.head === 'object' ? source.head : {};
  const headOutline = head.outline && typeof head.outline === 'object' ? head.outline : {};
  const headMain = head.main && typeof head.main === 'object' ? head.main : {};
  const headGlint = head.glint && typeof head.glint === 'object' ? head.glint : {};
  const offset = body.highlightOffset && typeof body.highlightOffset === 'object' ? body.highlightOffset : {};
  const defaultHead = defaults.head;
  return {
    curveRadius: clampNumber(source.curveRadius, defaults.curveRadius, 2, 40),
    curveSteps: clampInteger(source.curveSteps, defaults.curveSteps, 4, 64),
    segmentStep: clampNumber(source.segmentStep, defaults.segmentStep, 0.2, 2),
    rasterScale: clampInteger(source.rasterScale, defaults.rasterScale, 1, 6),
    coverageThreshold: clampInteger(source.coverageThreshold, defaults.coverageThreshold, 1, 36),
    colors: {
      outline: normalizeArrowRgb(colors.outline, defaultColors.outline),
      main: normalizeArrowRgb(colors.main, defaultColors.main),
      highlight: normalizeArrowRgb(colors.highlight, defaultColors.highlight)
    },
    body: {
      outlineRadius: clampNumber(body.outlineRadius, defaults.body.outlineRadius, 0.25, 3),
      mainRadius: clampNumber(body.mainRadius, defaults.body.mainRadius, 0, 2),
      highlightRadius: clampNumber(body.highlightRadius, defaults.body.highlightRadius, 0, 2),
      highlightOffset: {
        x: clampNumber(offset.x, defaults.body.highlightOffset.x, -4, 4),
        y: clampNumber(offset.y, defaults.body.highlightOffset.y, -4, 4)
      }
    },
    head: {
      outline: {
        length: clampNumber(headOutline.length, defaultHead.outline.length, 3, 14),
        half: clampNumber(headOutline.half, defaultHead.outline.half, 2, 10)
      },
      main: {
        length: clampNumber(headMain.length, defaultHead.main.length, 2, 13),
        half: clampNumber(headMain.half, defaultHead.main.half, 1, 9)
      },
      glint: {
        length: clampNumber(headGlint.length, defaultHead.glint.length, 0, 12),
        offsetBack: clampNumber(headGlint.offsetBack, defaultHead.glint.offsetBack, -6, 8),
        offsetPerp: clampNumber(headGlint.offsetPerp, defaultHead.glint.offsetPerp, -8, 8),
        tipBack: clampNumber(headGlint.tipBack, defaultHead.glint.tipBack, -4, 8),
        tipPerp: clampNumber(headGlint.tipPerp, defaultHead.glint.tipPerp, -8, 8)
      }
    }
  };
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
  const styleSource = options && options.style && typeof options.style === 'object' ? options.style : {};
  const customColors = styleSource.colors && typeof styleSource.colors === 'object' ? styleSource.colors : {};
  const normalizedStyle = normalizeScienceAdvisorArrowStyle(styleSource, { eraIndex: options && options.eraIndex });
  const colors = normalizedStyle.colors || (profile && profile.colors ? profile.colors : SCIENCE_ADVISOR_ARROW_STYLE.colors);
  const arrowPredicate = profile && typeof profile.predicate === 'function'
    ? profile.predicate
    : ((r, g, b) => isScienceAdvisorArrowColor(r, g, b));
  const outlineIndex = getNearestPaletteIndex(palette, colors.outline, 0, customColors.outline ? null : arrowPredicate);
  const mainIndex = getNearestPaletteIndex(palette, colors.main, outlineIndex, customColors.main ? null : arrowPredicate);
  const highlightIndex = getNearestPaletteIndex(palette, colors.highlight, mainIndex, customColors.highlight ? null : arrowPredicate);
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

function isScienceAdvisorArrowFringeColor(r, g, b) {
  const rn = Number(r) || 0;
  const gn = Number(g) || 0;
  const bn = Number(b) || 0;
  const redFringe = rn >= 42 && rn <= 235
    && gn >= 8 && gn <= 180
    && bn <= 130
    && rn >= gn + 4
    && rn >= bn + 18
    && gn >= bn - 26;
  const blueFringe = bn >= 42 && bn <= 235
    && gn >= 12 && gn <= 190
    && rn <= 150
    && bn >= rn + 16
    && bn >= gn - 20;
  return redFringe || blueFringe;
}

function isScienceAdvisorArrowResidueColor(r, g, b) {
  const rn = Number(r) || 0;
  const gn = Number(g) || 0;
  const bn = Number(b) || 0;
  const paleRedShadow = rn >= 175 && rn <= 225
    && gn >= 120 && gn <= 195
    && bn >= 85 && bn <= 165
    && rn >= gn + 18
    && gn >= bn + 15;
  const paleBlueShadow = rn >= 130 && rn <= 190
    && gn >= 145 && gn <= 205
    && bn >= 150 && bn <= 215
    && gn >= rn + 6
    && bn >= rn + 10
    && Math.abs(bn - gn) <= 28;
  const ccmRedDither = rn >= 110 && rn <= 255
    && gn <= 36
    && bn <= 36
    && rn >= gn + 70
    && rn >= bn + 70;
  const ccmOliveDither = rn >= 90 && rn <= 155
    && gn >= 90 && gn <= 155
    && bn <= 45
    && Math.abs(rn - gn) <= 24
    && rn >= bn + 70
    && gn >= bn + 70;
  return paleRedShadow || paleBlueShadow || ccmRedDither || ccmOliveDither;
}

function isScienceAdvisorPaleArrowScratchColor(r, g, b) {
  const rn = Number(r) || 0;
  const gn = Number(g) || 0;
  const bn = Number(b) || 0;
  return rn >= 208 && rn <= 248
    && gn >= 178 && gn <= 236
    && bn >= 130 && bn <= 205
    && rn >= gn + 5
    && gn >= bn + 20;
}

function expandArrowClearMask({ mask, candidate, width, height, x1, y1, x2, y2, iterations = 4 }) {
  const out = new Uint8Array(mask);
  const passes = Math.max(0, Number(iterations) || 0);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8Array(out);
    let changed = false;
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) {
        const offset = y * width + x;
        if (out[offset] || !candidate[offset]) continue;
        let touches = false;
        for (let oy = -1; oy <= 1 && !touches; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
            if (out[ny * width + nx]) {
              touches = true;
              break;
            }
          }
        }
        if (!touches) continue;
        next[offset] = 1;
        changed = true;
      }
    }
    out.set(next);
    if (!changed) break;
  }
  return out;
}

function includeSupportedResidueRuns({ mask, residue, width, height, x1, y1, x2, y2 }) {
  const out = new Uint8Array(mask);
  const maxGap = 2;
  const minPixels = 5;
  const minSpan = 10;
  const supportRadius = 6;
  const hasMaskSupport = (sx1, sy1, sx2, sy2) => {
    const left = Math.max(x1, sx1 - supportRadius);
    const top = Math.max(y1, sy1 - supportRadius);
    const right = Math.min(x2, sx2 + supportRadius);
    const bottom = Math.min(y2, sy2 + supportRadius);
    for (let sy = top; sy <= bottom; sy += 1) {
      for (let sx = left; sx <= right; sx += 1) {
        if (mask[sy * width + sx]) return true;
      }
    }
    return false;
  };
  const seedRun = (points) => {
    let pixels = 0;
    let minX = x2;
    let minY = y2;
    let maxX = x1;
    let maxY = y1;
    for (const point of points) {
      const offset = point.y * width + point.x;
      if (!residue[offset]) continue;
      pixels += 1;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const span = Math.max(maxX - minX, maxY - minY) + 1;
    if (pixels < minPixels || span < minSpan) return;
    if (!hasMaskSupport(minX, minY, maxX, maxY)) return;
    for (const point of points) {
      const offset = point.y * width + point.x;
      if (residue[offset]) out[offset] = 1;
    }
  };
  const seedHorizontalRun = (y, startX, endX) => {
    const points = [];
    for (let x = startX; x <= endX; x += 1) points.push({ x, y });
    seedRun(points);
  };
  const seedVerticalRun = (x, startY, endY) => {
    const points = [];
    for (let y = startY; y <= endY; y += 1) points.push({ x, y });
    seedRun(points);
  };
  const seedDiagonalRun = (startX, startY, endX, endY, dx, dy) => {
    const points = [];
    for (let x = startX, y = startY; ; x += dx, y += dy) {
      points.push({ x, y });
      if (x === endX && y === endY) break;
    }
    seedRun(points);
  };
  for (let y = y1; y <= y2; y += 1) {
    let start = -1;
    let lastResidue = -1;
    let gap = 0;
    for (let x = x1; x <= x2 + 1; x += 1) {
      const isResidue = x <= x2 && residue[y * width + x];
      if (isResidue) {
        if (start < 0) start = x;
        lastResidue = x;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        if (gap > maxGap || x > x2) {
          seedHorizontalRun(y, start, lastResidue);
          start = -1;
          lastResidue = -1;
          gap = 0;
        }
      }
    }
  }
  for (let x = x1; x <= x2; x += 1) {
    let start = -1;
    let lastResidue = -1;
    let gap = 0;
    for (let y = y1; y <= y2 + 1; y += 1) {
      const isResidue = y <= y2 && residue[y * width + x];
      if (isResidue) {
        if (start < 0) start = y;
        lastResidue = y;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        if (gap > maxGap || y > y2) {
          seedVerticalRun(x, start, lastResidue);
          start = -1;
          lastResidue = -1;
          gap = 0;
        }
      }
    }
  }
  const scanDiagonalResidueRuns = (starts, dx, dy) => {
    for (const startPoint of starts) {
      let startX = -1;
      let startY = -1;
      let lastResidueX = -1;
      let lastResidueY = -1;
      let gap = 0;
      for (let x = startPoint.x, y = startPoint.y; x >= x1 && x <= x2 && y >= y1 && y <= y2; x += dx, y += dy) {
        const isResidue = residue[y * width + x];
        if (isResidue) {
          if (startX < 0) {
            startX = x;
            startY = y;
          }
          lastResidueX = x;
          lastResidueY = y;
          gap = 0;
        } else if (startX >= 0) {
          gap += 1;
          if (gap > maxGap) {
            seedDiagonalRun(startX, startY, lastResidueX, lastResidueY, dx, dy);
            startX = -1;
            startY = -1;
            lastResidueX = -1;
            lastResidueY = -1;
            gap = 0;
          }
        }
      }
      if (startX >= 0) seedDiagonalRun(startX, startY, lastResidueX, lastResidueY, dx, dy);
    }
  };
  const downRightStarts = [];
  for (let x = x1; x <= x2; x += 1) downRightStarts.push({ x, y: y1 });
  for (let y = y1 + 1; y <= y2; y += 1) downRightStarts.push({ x: x1, y });
  scanDiagonalResidueRuns(downRightStarts, 1, 1);
  const downLeftStarts = [];
  for (let x = x1; x <= x2; x += 1) downLeftStarts.push({ x, y: y1 });
  for (let y = y1 + 1; y <= y2; y += 1) downLeftStarts.push({ x: x2, y });
  scanDiagonalResidueRuns(downLeftStarts, -1, 1);
  return out;
}

function dilateArrowClearMask({ mask, protectedFrame, width, height, x1, y1, x2, y2, radius = 3 }) {
  const out = new Uint8Array(mask);
  const r = Math.max(0, Math.round(Number(radius) || 0));
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const offset = y * width + x;
      if (!mask[offset]) continue;
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          if ((ox * ox) + (oy * oy) > r * r) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
          const outOffset = ny * width + nx;
          if (protectedFrame && protectedFrame[outOffset]) continue;
          out[outOffset] = 1;
        }
      }
    }
  }
  return out;
}

function scaleScienceAdvisorCoord(value, size, baseSize) {
  return Math.round((Number(value) || 0) * (Math.max(1, Number(size) || 1) / baseSize));
}

function getScienceAdvisorProtectedFrameRects(width, height) {
  const sx = (value) => scaleScienceAdvisorCoord(value, width, 1024);
  const sy = (value) => scaleScienceAdvisorCoord(value, height, 768);
  return [
    // Outer advisor chrome. These areas contain stripe/shadow colors that can resemble arrow fringe.
    { x1: 0, y1: 0, x2: width - 1, y2: sy(88) },
    { x1: 0, y1: 0, x2: sx(72), y2: height - 1 },
    { x1: sx(962), y1: 0, x2: width - 1, y2: height - 1 },
    { x1: 0, y1: sy(700), x2: width - 1, y2: height - 1 }
  ].map((rect) => ({
    x1: Math.max(0, Math.min(width - 1, rect.x1)),
    y1: Math.max(0, Math.min(height - 1, rect.y1)),
    x2: Math.max(0, Math.min(width - 1, rect.x2)),
    y2: Math.max(0, Math.min(height - 1, rect.y2))
  }));
}

function isScienceAdvisorCoordinateInRects(x, y, rects) {
  return (Array.isArray(rects) ? rects : [])
    .some((rect) => x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2);
}

function isScienceAdvisorProtectedFrameCoordinate(x, y, width, height) {
  return isScienceAdvisorCoordinateInRects(x, y, getScienceAdvisorProtectedFrameRects(width, height));
}

function buildProtectedArrowComponentExceptionMask({ width, height, x1, y1, x2, y2, protectedRects, getColor }) {
  const out = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  const minPixels = 100;
  const minDiagonalSpan = 26;
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const startOffset = y * width + x;
      if (seen[startOffset] || !isScienceAdvisorCoordinateInRects(x, y, protectedRects)) continue;
      const color = getColor(startOffset);
      if (!isScienceAdvisorArrowColor(color.r, color.g, color.b)) continue;
      const stack = [{ x, y }];
      const component = [];
      seen[startOffset] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (stack.length > 0) {
        const point = stack.pop();
        const offset = point.y * width + point.x;
        component.push(offset);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            const nx = point.x + ox;
            const ny = point.y + oy;
            if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
            if (!isScienceAdvisorCoordinateInRects(nx, ny, protectedRects)) continue;
            const nextOffset = ny * width + nx;
            if (seen[nextOffset]) continue;
            const nextColor = getColor(nextOffset);
            if (!isScienceAdvisorArrowColor(nextColor.r, nextColor.g, nextColor.b)) continue;
            seen[nextOffset] = 1;
            stack.push({ x: nx, y: ny });
          }
        }
      }
      if (component.length < minPixels) continue;
      if ((maxX - minX) < minDiagonalSpan || (maxY - minY) < minDiagonalSpan) continue;
      component.forEach((offset) => {
        out[offset] = 1;
      });
    }
  }
  return out;
}

function includeNearbyArrowCandidates({ mask, candidate, width, height, x1, y1, x2, y2, radius = 8 }) {
  const out = new Uint8Array(mask);
  const r = Math.max(0, Math.round(Number(radius) || 0));
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const offset = y * width + x;
      if (!mask[offset]) continue;
      for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          if ((ox * ox) + (oy * oy) > r * r) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
          const candidateOffset = ny * width + nx;
          if (candidate[candidateOffset]) out[candidateOffset] = 1;
        }
      }
    }
  }
  return out;
}

function seedArrowCandidateRuns({ seed, candidate, width, height, x1, y1, x2, y2 }) {
  const out = new Uint8Array(seed);
  const maxGap = 2;
  const minPixels = 10;
  const minSpan = 20;
  const minSeedSupport = 2;
  const hasNearbySeedSupport = (sx1, sy1, sx2, sy2) => {
    const left = Math.max(x1, sx1);
    const top = Math.max(y1, sy1);
    const right = Math.min(x2, sx2);
    const bottom = Math.min(y2, sy2);
    let seedPixels = 0;
    for (let sy = top; sy <= bottom; sy += 1) {
      for (let sx = left; sx <= right; sx += 1) {
        if (!seed[sy * width + sx]) continue;
        seedPixels += 1;
        if (seedPixels >= minSeedSupport) return true;
      }
    }
    return false;
  };
  const seedHorizontalRun = (y, startX, endX) => {
    let pixels = 0;
    for (let x = startX; x <= endX; x += 1) {
      const offset = y * width + x;
      if (candidate[offset]) pixels += 1;
    }
    if (pixels < minPixels || (endX - startX + 1) < minSpan) return;
    if (!hasNearbySeedSupport(startX - 12, y - 6, endX + 12, y + 6)) return;
    for (let x = startX; x <= endX; x += 1) {
      const offset = y * width + x;
      if (candidate[offset]) out[offset] = 1;
    }
  };
  const seedVerticalRun = (x, startY, endY) => {
    let pixels = 0;
    for (let y = startY; y <= endY; y += 1) {
      const offset = y * width + x;
      if (candidate[offset]) pixels += 1;
    }
    if (pixels < minPixels || (endY - startY + 1) < minSpan) return;
    if (!hasNearbySeedSupport(x - 6, startY - 12, x + 6, endY + 12)) return;
    for (let y = startY; y <= endY; y += 1) {
      const offset = y * width + x;
      if (candidate[offset]) out[offset] = 1;
    }
  };
  for (let y = y1; y <= y2; y += 1) {
    let start = -1;
    let lastCandidate = -1;
    let gap = 0;
    for (let x = x1; x <= x2 + 1; x += 1) {
      const isCandidate = x <= x2 && candidate[y * width + x];
      if (isCandidate) {
        if (start < 0) start = x;
        lastCandidate = x;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        if (gap > maxGap || x > x2) {
          seedHorizontalRun(y, start, lastCandidate);
          start = -1;
          lastCandidate = -1;
          gap = 0;
        }
      }
    }
  }
  for (let x = x1; x <= x2; x += 1) {
    let start = -1;
    let lastCandidate = -1;
    let gap = 0;
    for (let y = y1; y <= y2 + 1; y += 1) {
      const isCandidate = y <= y2 && candidate[y * width + x];
      if (isCandidate) {
        if (start < 0) start = y;
        lastCandidate = y;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        if (gap > maxGap || y > y2) {
          seedVerticalRun(x, start, lastCandidate);
          start = -1;
          lastCandidate = -1;
          gap = 0;
        }
      }
    }
  }
  return out;
}

function buildScienceAdvisorArrowClearMask({ width, height, bounds, getColor }) {
  const safeBounds = bounds || { x1: 0, y1: 0, x2: width - 1, y2: height - 1 };
  const x1 = Math.max(0, Math.min(width - 1, Math.floor(Number(safeBounds.x1) || 0)));
  const y1 = Math.max(0, Math.min(height - 1, Math.floor(Number(safeBounds.y1) || 0)));
  const x2 = Math.max(x1, Math.min(width - 1, Math.ceil(Number(safeBounds.x2) || 0)));
  const y2 = Math.max(y1, Math.min(height - 1, Math.ceil(Number(safeBounds.y2) || 0)));
  const seed = new Uint8Array(width * height);
  const candidate = new Uint8Array(width * height);
  const residue = new Uint8Array(width * height);
  const protectedFrame = new Uint8Array(width * height);
  const protectedRects = getScienceAdvisorProtectedFrameRects(width, height);
  const protectedArrowExceptions = buildProtectedArrowComponentExceptionMask({
    width,
    height,
    x1,
    y1,
    x2,
    y2,
    protectedRects,
    getColor
  });
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const offset = y * width + x;
      if (isScienceAdvisorCoordinateInRects(x, y, protectedRects) && !protectedArrowExceptions[offset]) {
        protectedFrame[offset] = 1;
        continue;
      }
      const color = getColor(offset);
      if (isScienceAdvisorArrowColor(color.r, color.g, color.b)) {
        seed[offset] = 1;
        candidate[offset] = 1;
      } else if (isScienceAdvisorArrowFringeColor(color.r, color.g, color.b)) {
        candidate[offset] = 1;
      } else if (isScienceAdvisorArrowResidueColor(color.r, color.g, color.b)) {
        residue[offset] = 1;
      }
    }
  }
  const seededRuns = seedArrowCandidateRuns({ seed, candidate, width, height, x1, y1, x2, y2 });
  const expanded = expandArrowClearMask({ mask: seededRuns, candidate, width, height, x1, y1, x2, y2, iterations: 5 });
  const withNearbyFringe = includeNearbyArrowCandidates({ mask: expanded, candidate, width, height, x1, y1, x2, y2, radius: 8 });
  const withResidue = includeSupportedResidueRuns({ mask: withNearbyFringe, residue, width, height, x1, y1, x2, y2 });
  const dilated = dilateArrowClearMask({ mask: withResidue, protectedFrame, width, height, x1, y1, x2, y2, radius: 3 });
  return { mask: dilated, candidate, protectedFrame, x1, y1, x2, y2 };
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

function getRgbDistanceSquared(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dr = (Number(a.r) || 0) - (Number(b.r) || 0);
  const dg = (Number(a.g) || 0) - (Number(b.g) || 0);
  const db = (Number(a.b) || 0) - (Number(b.b) || 0);
  return (dr * dr) + (dg * dg) + (db * db);
}

function collectScienceAdvisorClearContext({ x, y, width, height, x1, y1, x2, y2, mask, candidate, protectedFrame, getColor, radius = 6 }) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const limit = Math.max(1, Math.round(Number(radius) || 1));
  for (let oy = -limit; oy <= limit; oy += 1) {
    for (let ox = -limit; ox <= limit; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      if ((ox * ox) + (oy * oy) > limit * limit) continue;
      const nx = x + ox;
      const ny = y + oy;
      if (nx < x1 || nx > x2 || ny < y1 || ny > y2 || nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const offset = ny * width + nx;
      if (protectedFrame && protectedFrame[offset]) continue;
      if (mask[offset] || candidate[offset]) continue;
      const color = getColor(offset);
      r += Number(color.r) || 0;
      g += Number(color.g) || 0;
      b += Number(color.b) || 0;
      count += 1;
    }
  }
  if (count === 0) return null;
  return { r: r / count, g: g / count, b: b / count };
}

function getScienceAdvisorClearReplacementOffsets() {
  const offsets = [
    [0, -10], [0, 10], [-10, 0], [10, 0],
    [0, -18], [0, 18], [-18, 0], [18, 0],
    [-12, -12], [12, -12], [-12, 12], [12, 12],
    [0, -26], [0, 26], [-26, 0], [26, 0]
  ];
  for (let radius = 4; radius <= 36; radius += 4) {
    for (let oy = -radius; oy <= radius; oy += 2) {
      const oxLimit = radius - Math.abs(oy);
      if (oxLimit === 0) {
        offsets.push([0, oy]);
      } else {
        offsets.push([-oxLimit, oy], [oxLimit, oy]);
      }
    }
  }
  return offsets;
}

const SCIENCE_ADVISOR_CLEAR_REPLACEMENT_OFFSETS = getScienceAdvisorClearReplacementOffsets();

function findScienceAdvisorClearReplacementOffset({ x, y, width, height, x1, y1, x2, y2, mask, candidate, protectedFrame, getColor, rejectColor = null }) {
  const isCleanSource = (nx, ny) => {
    if (nx < x1 || nx > x2 || ny < y1 || ny > y2 || nx < 0 || nx >= width || ny < 0 || ny >= height) return false;
    const offset = ny * width + nx;
    if (protectedFrame && protectedFrame[offset]) return false;
    return !mask[offset] && !candidate[offset];
  };
  const context = collectScienceAdvisorClearContext({ x, y, width, height, x1, y1, x2, y2, mask, candidate, protectedFrame, getColor });
  let best = null;
  let fallback = null;
  for (const [ox, oy] of SCIENCE_ADVISOR_CLEAR_REPLACEMENT_OFFSETS) {
    const nx = x + ox;
    const ny = y + oy;
    if (!isCleanSource(nx, ny)) continue;
    const color = getColor(ny * width + nx);
    if (rejectColor && getRgbDistanceSquared(color, rejectColor) <= 8) continue;
    if (!fallback) fallback = { x: nx, y: ny };
    if (!context) return fallback;
    const distancePenalty = (Math.abs(ox) + Math.abs(oy)) * 0.75;
    const score = getRgbDistanceSquared(color, context) + distancePenalty;
    if (!best || score < best.score) best = { x: nx, y: ny, score };
  }
  return best || fallback;
}

function clearScienceAdvisorArrowPixelsIndexed({ indices, palette, width, height, bounds }) {
  if (!indices || !palette || !width || !height) return;
  const clear = buildScienceAdvisorArrowClearMask({
    width,
    height,
    bounds,
    getColor: (offset) => getIndexedRgb(indices, palette, offset)
  });
  const { mask, candidate, protectedFrame, x1, y1, x2, y2 } = clear;
  const findReplacement = (x, y) => {
    const targetColor = getIndexedRgb(indices, palette, y * width + x);
    const rejectColor = isScienceAdvisorPaleArrowScratchColor(targetColor.r, targetColor.g, targetColor.b)
      ? targetColor
      : null;
    const replacement = findScienceAdvisorClearReplacementOffset({
      x,
      y,
      width,
      height,
      x1,
      y1,
      x2,
      y2,
      mask,
      candidate,
      protectedFrame,
      rejectColor,
      getColor: (offset) => getIndexedRgb(indices, palette, offset)
    });
    return replacement ? indices[(replacement.y * width) + replacement.x] : indices[y * width + x];
  };
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const offset = y * width + x;
      if (mask[offset]) indices[offset] = findReplacement(x, y);
    }
  }
}

function clearScienceAdvisorArrowPixelsRgba({ rgba, width, height, bounds }) {
  if (!rgba || !width || !height) return;
  const clear = buildScienceAdvisorArrowClearMask({
    width,
    height,
    bounds,
    getColor: (pixel) => {
      const off = pixel * 4;
      return {
        r: Number(rgba[off]) || 0,
        g: Number(rgba[off + 1]) || 0,
        b: Number(rgba[off + 2]) || 0
      };
    }
  });
  const { mask, candidate, protectedFrame, x1, y1, x2, y2 } = clear;
  const copyFromNeighbor = (x, y, targetOff) => {
    const targetColor = {
      r: Number(rgba[targetOff]) || 0,
      g: Number(rgba[targetOff + 1]) || 0,
      b: Number(rgba[targetOff + 2]) || 0
    };
    const rejectColor = isScienceAdvisorPaleArrowScratchColor(targetColor.r, targetColor.g, targetColor.b)
      ? targetColor
      : null;
    const replacement = findScienceAdvisorClearReplacementOffset({
      x,
      y,
      width,
      height,
      x1,
      y1,
      x2,
      y2,
      mask,
      candidate,
      protectedFrame,
      rejectColor,
      getColor: (pixel) => {
        const off = pixel * 4;
        return {
          r: Number(rgba[off]) || 0,
          g: Number(rgba[off + 1]) || 0,
          b: Number(rgba[off + 2]) || 0
        };
      }
    });
    if (!replacement) return;
    const srcOff = ((replacement.y * width) + replacement.x) * 4;
    rgba[targetOff] = rgba[srcOff];
    rgba[targetOff + 1] = rgba[srcOff + 1];
    rgba[targetOff + 2] = rgba[srcOff + 2];
    rgba[targetOff + 3] = rgba[srcOff + 3];
  };
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) {
      const pixel = y * width + x;
      if (!mask[pixel]) continue;
      copyFromNeighbor(x, y, pixel * 4);
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

function drawSegment(setPixel, width, height, from, to, radius, value, style = SCIENCE_ADVISOR_ARROW_STYLE) {
  const fx = Number(from && from.x) || 0;
  const fy = Number(from && from.y) || 0;
  const txRaw = Number(to && to.x) || 0;
  const tyRaw = Number(to && to.y) || 0;
  const rawDx = txRaw - fx;
  const rawDy = tyRaw - fy;
  if (Math.abs(rawDx) > 0.001 && Math.abs(rawDy) > 0.001) {
    const distance = Math.sqrt((rawDx * rawDx) + (rawDy * rawDy)) || 1;
    const step = Math.max(0.2, Number(style && style.segmentStep) || 0.5);
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

function drawArrowHeadGlint(setPixel, width, height, tip, unit, value, scale = 1, style = SCIENCE_ADVISOR_ARROW_STYLE) {
  const glint = style.head.glint;
  const s = Math.max(1, Number(scale) || 1);
  const from = {
    x: tip.x - (unit.ux * glint.length * s) - (unit.ux * glint.offsetBack * s) + (unit.px * glint.offsetPerp * s),
    y: tip.y - (unit.uy * glint.length * s) - (unit.uy * glint.offsetBack * s) + (unit.py * glint.offsetPerp * s)
  };
  const to = {
    x: tip.x - (unit.ux * glint.tipBack * s) + (unit.px * glint.tipPerp * s),
    y: tip.y - (unit.uy * glint.tipBack * s) + (unit.py * glint.tipPerp * s)
  };
  drawSegment(setPixel, width, height, from, to, getScaledRadius(0, s), value, style);
}

function getRoutePoints(route, techBoxLayout, style = SCIENCE_ADVISOR_ARROW_STYLE) {
  if (techBoxLayout && typeof techBoxLayout.sampleTechTreeArrowRoute === 'function') {
    return techBoxLayout.sampleTechTreeArrowRoute(route, {
      radius: style.curveRadius,
      curveSteps: style.curveSteps
    });
  }
  return (route && Array.isArray(route.points)) ? route.points : [];
}

function drawRoute({ setPixel, width, height, route, techBoxLayout, values, scale = 1, style = SCIENCE_ADVISOR_ARROW_STYLE }) {
  const s = Math.max(1, Number(scale) || 1);
  const activeStyle = style || SCIENCE_ADVISOR_ARROW_STYLE;
  const points = getRoutePoints(route, techBoxLayout, activeStyle).map((point) => (
    s === 1 ? point : { x: point.x * s, y: point.y * s }
  ));
  if (points.length < 1) return;
  const outlineRadius = getScaledRadius(activeStyle.body.outlineRadius, s);
  const mainRadius = getScaledRadius(activeStyle.body.mainRadius, s);
  const highlightRadius = getScaledRadius(activeStyle.body.highlightRadius, s);
  for (let idx = 1; idx < points.length; idx += 1) {
    drawSegment(setPixel, width, height, points[idx - 1], points[idx], outlineRadius, values.outline, activeStyle);
  }
  for (let idx = 1; idx < points.length; idx += 1) {
    drawSegment(setPixel, width, height, points[idx - 1], points[idx], mainRadius, values.main, activeStyle);
  }
  const offset = activeStyle.body.highlightOffset;
  for (let idx = 1; idx < points.length; idx += 1) {
    drawSegment(
      setPixel,
      width,
      height,
      { x: points[idx - 1].x + (offset.x * s), y: points[idx - 1].y + (offset.y * s) },
      { x: points[idx].x + (offset.x * s), y: points[idx].y + (offset.y * s) },
      highlightRadius,
      values.highlight,
      activeStyle
    );
  }
  const tip = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : { x: tip.x - (route && route.dir || 1), y: tip.y };
  const unit = getUnitVector(route, tip, prev);
  drawArrowHead(setPixel, width, height, tip, unit, values.outline, {
    length: activeStyle.head.outline.length * s,
    half: activeStyle.head.outline.half * s
  });
  drawArrowHead(setPixel, width, height, tip, unit, values.main, {
    length: activeStyle.head.main.length * s,
    half: activeStyle.head.main.half * s
  });
  drawArrowHeadGlint(setPixel, width, height, tip, unit, values.highlight, s, activeStyle);
}

function rasterizeRouteLayers({ width, height, routes, techBoxLayout, style = SCIENCE_ADVISOR_ARROW_STYLE }) {
  const activeStyle = style || SCIENCE_ADVISOR_ARROW_STYLE;
  const scale = Math.max(1, Math.round(Number(activeStyle.rasterScale) || 1));
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
      scale,
      style: activeStyle
    });
  });
  const layerMap = new Uint8Array(width * height);
  const coverageMap = new Uint8Array(width * height);
  const threshold = Math.max(1, Math.min(scale * scale, Math.round(Number(activeStyle.coverageThreshold) || 1)));
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

function drawScienceAdvisorRouteIndexed({ indices, palette, width, height, route, techBoxLayout, eraIndex, style }) {
  drawScienceAdvisorRoutesIndexed({ indices, palette, width, height, routes: route ? [route] : [], techBoxLayout, eraIndex, style });
}

function drawScienceAdvisorRoutesIndexed({ indices, palette, width, height, routes, techBoxLayout, eraIndex, style }) {
  if (!indices || !width || !height) return;
  const routeList = (Array.isArray(routes) ? routes : []).filter(Boolean);
  if (routeList.length === 0) return;
  const activeStyle = normalizeScienceAdvisorArrowStyle(style, { eraIndex });
  const paletteStyle = makePaletteStyle(palette, { eraIndex, style });
  const raster = rasterizeRouteLayers({ width, height, routes: routeList, techBoxLayout, style: activeStyle });
  applyLayerMapIndexed({
    indices,
    palette,
    paletteStyle,
    layerMap: raster.layerMap,
    coverageMap: raster.coverageMap
  });
}

function drawScienceAdvisorRouteRgba({ rgba, palette, width, height, route, techBoxLayout, eraIndex, style }) {
  drawScienceAdvisorRoutesRgba({ rgba, palette, width, height, routes: route ? [route] : [], techBoxLayout, eraIndex, style });
}

function drawScienceAdvisorRoutesRgba({ rgba, palette, width, height, routes, techBoxLayout, eraIndex, style }) {
  if (!rgba || !width || !height) return;
  const routeList = (Array.isArray(routes) ? routes : []).filter(Boolean);
  if (routeList.length === 0) return;
  const activeStyle = normalizeScienceAdvisorArrowStyle(style, { eraIndex });
  const paletteStyle = makePaletteStyle(palette, { eraIndex, style });
  const raster = rasterizeRouteLayers({ width, height, routes: routeList, techBoxLayout, style: activeStyle });
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
  normalizeScienceAdvisorArrowStyle,
  getNearestPaletteIndex,
  makePaletteStyle,
  getScienceAdvisorArrowColorProfile,
  isScienceAdvisorRedArrowColor,
  isScienceAdvisorBlueArrowColor,
  isScienceAdvisorArrowColor,
  isScienceAdvisorArrowFringeColor,
  isScienceAdvisorArrowResidueColor,
  clearScienceAdvisorArrowPixelsIndexed,
  clearScienceAdvisorArrowPixelsRgba,
  drawScienceAdvisorRouteIndexed,
  drawScienceAdvisorRoutesIndexed,
  drawScienceAdvisorRouteRgba,
  drawScienceAdvisorRoutesRgba
};
}));
