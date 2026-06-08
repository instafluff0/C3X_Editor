(function techBoxLayoutFactory(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.TechBoxLayout = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function techBoxLayoutInit() {
const TECH_BOX_ROWS_PER_ERA = 4;
const TECH_BOX_COLUMNS_PER_ROW = 4;
const TECH_BOX_DEFAULT_COLUMN_INDEX = 3;

function findRuns(counts, { threshold = 1, minLength = 1 } = {}) {
  const runs = [];
  let start = -1;
  for (let idx = 0; idx < counts.length; idx += 1) {
    const active = Number(counts[idx]) >= threshold;
    if (active && start < 0) {
      start = idx;
    } else if ((!active || idx === counts.length - 1) && start >= 0) {
      const end = active && idx === counts.length - 1 ? idx : idx - 1;
      if ((end - start + 1) >= minLength) {
        runs.push({ start, end, length: end - start + 1 });
      }
      start = -1;
    }
  }
  return runs;
}

function hasOpaquePixel(rgba, offset, alphaThreshold) {
  return rgba && Number(rgba[offset + 3]) > alphaThreshold;
}

function parseTechBoxSheetLayout(image, options = {}) {
  const width = Math.max(0, Number(image && image.width) || 0);
  const height = Math.max(0, Number(image && image.height) || 0);
  const rgba = image && image.rgba;
  if (!width || !height || !rgba || rgba.length < width * height * 4) {
    throw new Error('Techbox sheet layout requires decoded RGBA pixels.');
  }

  const rowsPerEra = Math.max(1, Number(options.rowsPerEra) || TECH_BOX_ROWS_PER_ERA);
  const alphaThreshold = Number.isFinite(Number(options.alphaThreshold)) ? Number(options.alphaThreshold) : 0;
  const rowThreshold = Number.isFinite(Number(options.rowThreshold)) ? Number(options.rowThreshold) : 5;
  const colThreshold = Number.isFinite(Number(options.colThreshold)) ? Number(options.colThreshold) : 5;
  const minFrameWidth = Math.max(1, Number(options.minFrameWidth) || 40);
  const minFrameHeight = Math.max(1, Number(options.minFrameHeight) || 30);

  const rowCounts = new Array(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      if (hasOpaquePixel(rgba, (y * width + x) * 4, alphaThreshold)) count += 1;
    }
    rowCounts[y] = count;
  }

  const rows = findRuns(rowCounts, { threshold: rowThreshold, minLength: minFrameHeight });
  const frames = [];
  rows.forEach((rowRun, rowIndex) => {
    const colCounts = new Array(width).fill(0);
    for (let x = 0; x < width; x += 1) {
      let count = 0;
      for (let y = rowRun.start; y <= rowRun.end; y += 1) {
        if (hasOpaquePixel(rgba, (y * width + x) * 4, alphaThreshold)) count += 1;
      }
      colCounts[x] = count;
    }
    const columns = findRuns(colCounts, { threshold: colThreshold, minLength: minFrameWidth });
    rowRun.columns = columns;
    columns.forEach((colRun, columnIndex) => {
      frames.push({
        x: colRun.start,
        y: rowRun.start,
        w: colRun.length,
        h: rowRun.length,
        rowIndex,
        columnIndex,
        eraIndex: Math.floor(rowIndex / rowsPerEra),
        sizeIndex: rowIndex % rowsPerEra
      });
    });
  });

  return {
    width,
    height,
    rowsPerEra,
    columnsPerRow: TECH_BOX_COLUMNS_PER_ROW,
    defaultColumnIndex: TECH_BOX_DEFAULT_COLUMN_INDEX,
    rows,
    frames
  };
}

function getTechBoxFrame(layout, eraIndex, sizeIndex, columnIndex = TECH_BOX_DEFAULT_COLUMN_INDEX) {
  const rowIndex = (Number(eraIndex) * Number(layout && layout.rowsPerEra || TECH_BOX_ROWS_PER_ERA)) + Number(sizeIndex);
  return (layout && Array.isArray(layout.frames) ? layout.frames : []).find((frame) => (
    frame.rowIndex === rowIndex && frame.columnIndex === Number(columnIndex)
  )) || null;
}

function chooseTechBoxSizeIndexForIconCount(iconCount) {
  const count = Math.max(1, Number(iconCount) || 1);
  if (count <= 2) return 0;
  if (count <= 4) return 1;
  if (count === 5) return 3;
  if (count <= 7) return 2;
  return 3;
}

function normalizeArrowRect(rect) {
  const x = Number(rect && rect.x) || 0;
  const y = Number(rect && rect.y) || 0;
  const w = Math.max(1, Number(rect && (rect.w || rect.width)) || 1);
  const h = Math.max(1, Number(rect && (rect.h || rect.height)) || 1);
  return { x, y, w, h };
}

function clamp(value, min, max) {
  const n = Number(value) || 0;
  return Math.max(min, Math.min(max, n));
}

function buildTechTreeArrowRoute(sourceRect, targetRect, options = {}) {
  const source = normalizeArrowRect(sourceRect);
  const target = normalizeArrowRect(targetRect);
  const sourceCenterX = source.x + (source.w / 2);
  const targetCenterX = target.x + (target.w / 2);
  const dir = targetCenterX >= sourceCenterX ? 1 : -1;
  const pad = Math.max(0, Number(options.pad) || 0);
  const sx = dir > 0 ? source.x + source.w + pad : source.x - pad;
  const tx = dir > 0 ? target.x - pad : target.x + target.w + pad;
  const sy = source.y + (source.h / 2);
  const ty = target.y + (target.h / 2);
  const dx = tx - sx;
  const points = [{ x: sx, y: sy }];
  if (Math.abs(ty - sy) <= 3 || Math.abs(dx) < 18) {
    if (Math.abs(dx) < 18 && Math.abs(ty - sy) > 3) {
      const midX = (sx + tx) / 2;
      points.push({ x: midX, y: sy }, { x: midX, y: ty });
    }
    points.push({ x: tx, y: ty });
    return { dir, points };
  }
  const elbow = clamp(Math.abs(dx) * 0.46, 28, Math.max(28, Number(options.maxElbow) || 140));
  const mx1 = sx + (elbow * dir);
  const mx2 = tx - (elbow * dir);
  if ((dir > 0 && mx1 < mx2) || (dir < 0 && mx1 > mx2)) {
    points.push({ x: mx1, y: sy }, { x: mx2, y: ty }, { x: tx, y: ty });
  } else {
    const midX = (sx + tx) / 2;
    points.push({ x: midX, y: sy }, { x: midX, y: ty }, { x: tx, y: ty });
  }
  return { dir, points };
}

function getDistance(a, b) {
  const dx = Number(b && b.x) - Number(a && a.x);
  const dy = Number(b && b.y) - Number(a && a.y);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function getPointAlong(from, to, distanceFromTo) {
  const dist = getDistance(from, to);
  if (!dist) return { x: Number(to && to.x) || 0, y: Number(to && to.y) || 0 };
  const ratio = clamp(distanceFromTo / dist, 0, 1);
  return {
    x: (Number(to && to.x) || 0) + (((Number(from && from.x) || 0) - (Number(to && to.x) || 0)) * ratio),
    y: (Number(to && to.y) || 0) + (((Number(from && from.y) || 0) - (Number(to && to.y) || 0)) * ratio)
  };
}

function buildSmoothedSegments(route, radius = 13) {
  const points = route && Array.isArray(route.points) ? route.points : [];
  if (points.length === 0) return [];
  if (points.length === 1) return [{ type: 'move', to: points[0] }];
  if (points.length === 2 || Number(radius) <= 0) {
    return [
      { type: 'move', to: points[0] },
      ...points.slice(1).map((pt) => ({ type: 'line', to: pt }))
    ];
  }
  const segments = [{ type: 'move', to: points[0] }];
  for (let idx = 1; idx < points.length - 1; idx += 1) {
    const prev = points[idx - 1];
    const curr = points[idx];
    const next = points[idx + 1];
    const cornerRadius = Math.min(Number(radius) || 0, getDistance(prev, curr) / 2, getDistance(curr, next) / 2);
    const before = getPointAlong(prev, curr, cornerRadius);
    const after = getPointAlong(next, curr, cornerRadius);
    segments.push({ type: 'line', to: before });
    segments.push({ type: 'quad', control: curr, to: after });
  }
  segments.push({ type: 'line', to: points[points.length - 1] });
  return segments;
}

function formatNumber(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatTechTreeArrowSvgPath(route, options = {}) {
  const segments = buildSmoothedSegments(route, options.radius || 13);
  if (segments.length === 0) return '';
  return segments.map((segment) => {
    if (segment.type === 'move') return `M ${formatNumber(segment.to.x)} ${formatNumber(segment.to.y)}`;
    if (segment.type === 'quad') return `Q ${formatNumber(segment.control.x)} ${formatNumber(segment.control.y)} ${formatNumber(segment.to.x)} ${formatNumber(segment.to.y)}`;
    return `L ${formatNumber(segment.to.x)} ${formatNumber(segment.to.y)}`;
  }).join(' ');
}

function sampleQuadratic(from, control, to, steps) {
  const out = [];
  const count = Math.max(1, Math.round(Number(steps) || 1));
  for (let idx = 1; idx <= count; idx += 1) {
    const t = idx / count;
    const inv = 1 - t;
    out.push({
      x: (inv * inv * from.x) + (2 * inv * t * control.x) + (t * t * to.x),
      y: (inv * inv * from.y) + (2 * inv * t * control.y) + (t * t * to.y)
    });
  }
  return out;
}

function sampleTechTreeArrowRoute(route, options = {}) {
  const segments = buildSmoothedSegments(route, options.radius || 13);
  const samples = [];
  let current = null;
  segments.forEach((segment) => {
    if (segment.type === 'move') {
      current = segment.to;
      samples.push(current);
    } else if (segment.type === 'quad' && current) {
      sampleQuadratic(current, segment.control, segment.to, options.curveSteps || 8).forEach((pt) => samples.push(pt));
      current = segment.to;
    } else if (segment.to) {
      samples.push(segment.to);
      current = segment.to;
    }
  });
  return samples;
}

return {
  TECH_BOX_ROWS_PER_ERA,
  TECH_BOX_COLUMNS_PER_ROW,
  TECH_BOX_DEFAULT_COLUMN_INDEX,
  parseTechBoxSheetLayout,
  getTechBoxFrame,
  chooseTechBoxSizeIndexForIconCount,
  buildTechTreeArrowRoute,
  formatTechTreeArrowSvgPath,
  sampleTechTreeArrowRoute
};
}));
