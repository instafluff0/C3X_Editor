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

function normalizeAutoLayoutExclusionZones(zones) {
  return (Array.isArray(zones) ? zones : [])
    .map((zone) => {
      const x = Number(zone && zone.x);
      const y = Number(zone && zone.y);
      const w = Number(zone && (zone.w || zone.width));
      const h = Number(zone && (zone.h || zone.height));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0)) return null;
      return { x, y, w, h };
    })
    .filter(Boolean);
}

function normalizeTechTreeRouteConstraintArea(area) {
  const source = area && typeof area === 'object' ? area : {};
  const rawBounds = source.bounds && typeof source.bounds === 'object' ? source.bounds : null;
  const margin = Math.max(0, Number(source.margin) || 0);
  if (!rawBounds) return null;
  const x = Number(rawBounds.x);
  const y = Number(rawBounds.y);
  const w = Number(rawBounds.w || rawBounds.width);
  const h = Number(rawBounds.h || rawBounds.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0)) return null;
  const bounds = {
    x: x + margin,
    y: y + margin,
    w: Math.max(1, w - (margin * 2)),
    h: Math.max(1, h - (margin * 2))
  };
  const exclusionZones = normalizeAutoLayoutExclusionZones(source.exclusionZones)
    .map((zone) => ({
      x: zone.x - margin,
      y: zone.y - margin,
      w: zone.w + (margin * 2),
      h: zone.h + (margin * 2)
    }));
  return { bounds, exclusionZones };
}

function isPointInsideRouteExclusion(point, rect) {
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !rect) return false;
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function clampPointToRouteBounds(point, bounds) {
  return {
    x: clamp(Number(point && point.x) || 0, bounds.x, bounds.x + bounds.w),
    y: clamp(Number(point && point.y) || 0, bounds.y, bounds.y + bounds.h)
  };
}

function movePointOutsideRouteExclusions(point, area) {
  let out = clampPointToRouteBounds(point, area.bounds);
  area.exclusionZones.forEach((rect) => {
    if (!isPointInsideRouteExclusion(out, rect)) return;
    const candidates = [
      { x: rect.x - 1, y: out.y, score: Math.abs(out.x - (rect.x - 1)) },
      { x: rect.x + rect.w + 1, y: out.y, score: Math.abs(out.x - (rect.x + rect.w + 1)) },
      { x: out.x, y: rect.y - 1, score: Math.abs(out.y - (rect.y - 1)) },
      { x: out.x, y: rect.y + rect.h + 1, score: Math.abs(out.y - (rect.y + rect.h + 1)) }
    ]
      .map((candidate) => clampPointToRouteBounds(candidate, area.bounds))
      .filter((candidate) => !isPointInsideRouteExclusion(candidate, rect))
      .sort((a, b) => {
        const ad = Math.abs(a.x - out.x) + Math.abs(a.y - out.y);
        const bd = Math.abs(b.x - out.x) + Math.abs(b.y - out.y);
        return ad - bd;
      });
    if (candidates.length > 0) out = candidates[0];
  });
  return out;
}

function segmentCrossesRouteExclusion(a, b, rect) {
  if (!a || !b || !rect) return false;
  if (Math.abs(a.y - b.y) <= 0.01) {
    const y = a.y;
    if (y < rect.y || y > rect.y + rect.h) return false;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return maxX >= rect.x && minX <= rect.x + rect.w;
  }
  if (Math.abs(a.x - b.x) <= 0.01) {
    const x = a.x;
    if (x < rect.x || x > rect.x + rect.w) return false;
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return maxY >= rect.y && minY <= rect.y + rect.h;
  }
  return false;
}

function chooseRouteDetourCoordinate(current, lower, upper, min, max) {
  const before = lower - 1;
  const after = upper + 1;
  const candidates = [];
  if (before >= min) candidates.push(before);
  if (after <= max) candidates.push(after);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a - current) - Math.abs(b - current));
  return candidates[0];
}

function detourRouteSegmentAroundExclusion(a, b, rect, area) {
  if (!segmentCrossesRouteExclusion(a, b, rect)) return [b];
  if (Math.abs(a.y - b.y) <= 0.01) {
    const detourY = chooseRouteDetourCoordinate(a.y, rect.y, rect.y + rect.h, area.bounds.y, area.bounds.y + area.bounds.h);
    if (detourY == null) return [b];
    return [
      { x: a.x, y: detourY },
      { x: b.x, y: detourY },
      b
    ];
  }
  if (Math.abs(a.x - b.x) <= 0.01) {
    const detourX = chooseRouteDetourCoordinate(a.x, rect.x, rect.x + rect.w, area.bounds.x, area.bounds.x + area.bounds.w);
    if (detourX == null) return [b];
    return [
      { x: detourX, y: a.y },
      { x: detourX, y: b.y },
      b
    ];
  }
  return [b];
}

function splitDiagonalRouteSegmentForExclusion(a, b, rect, area) {
  if (!a || !b || !rect || Math.abs(a.x - b.x) <= 0.01 || Math.abs(a.y - b.y) <= 0.01) return [b];
  const candidates = [
    { x: b.x, y: a.y },
    { x: a.x, y: b.y }
  ]
    .map((candidate) => movePointOutsideRouteExclusions(candidate, area))
    .filter((candidate) => (
      !isPointInsideRouteExclusion(candidate, rect)
      && getPointDistance(a, candidate) >= 0.5
      && getPointDistance(candidate, b) >= 0.5
      && !segmentCrossesRouteExclusion(a, candidate, rect)
      && !segmentCrossesRouteExclusion(candidate, b, rect)
    ))
    .sort((left, right) => {
      const leftDistance = Math.abs(left.x - a.x) + Math.abs(left.y - a.y) + Math.abs(b.x - left.x) + Math.abs(b.y - left.y);
      const rightDistance = Math.abs(right.x - a.x) + Math.abs(right.y - a.y) + Math.abs(b.x - right.x) + Math.abs(b.y - right.y);
      return leftDistance - rightDistance;
    });
  return candidates.length > 0 ? [candidates[0], b] : [b];
}

function constrainTechTreeArrowRoute(route, areaOptions = {}) {
  const sourcePoints = route && Array.isArray(route.points) ? route.points : [];
  const area = normalizeTechTreeRouteConstraintArea(areaOptions);
  if (!area || sourcePoints.length === 0) return route;
  let points = sourcePoints.map((point) => movePointOutsideRouteExclusions(point, area));
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    area.exclusionZones.forEach((rect) => {
      const next = [];
      points.forEach((point, index) => {
        const safePoint = movePointOutsideRouteExclusions(point, area);
        if (index === 0) {
          next.push(safePoint);
          return;
        }
        const prev = next[next.length - 1];
        const split = splitDiagonalRouteSegmentForExclusion(prev, safePoint, rect, area);
        const additions = split.flatMap((candidate, candidateIndex) => {
          const segmentStart = candidateIndex === 0 ? prev : split[candidateIndex - 1];
          return detourRouteSegmentAroundExclusion(segmentStart, candidate, rect, area);
        })
          .map((candidate) => movePointOutsideRouteExclusions(candidate, area));
        if (additions.length !== 1 || additions[0].x !== safePoint.x || additions[0].y !== safePoint.y) changed = true;
        additions.forEach((candidate) => pushDistinctPoint(next, candidate));
      });
      points = simplifyRoutePoints(next);
    });
    if (!changed) break;
  }
  const end = points[points.length - 1];
  const beforeEnd = points.length > 1 ? points[points.length - 2] : { x: end.x - 1, y: end.y };
  return {
    ...route,
    dir: end.x >= beforeEnd.x ? 1 : -1,
    headVector: { x: end.x - beforeEnd.x, y: end.y - beforeEnd.y },
    points
  };
}

function getRectCenter(rect) {
  const r = normalizeArrowRect(rect);
  return { x: r.x + (r.w / 2), y: r.y + (r.h / 2) };
}

function getSideVector(side) {
  switch (String(side || '').toLowerCase()) {
    case 'left': return { x: -1, y: 0 };
    case 'top': return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
    case 'right':
    default:
      return { x: 1, y: 0 };
  }
}

function getAttachmentPoint(rect, side, offset = 0, pad = 0) {
  const r = normalizeArrowRect(rect);
  const vector = getSideVector(side);
  const o = Number(offset) || 0;
  if (side === 'left') return { x: r.x - pad, y: r.y + (r.h / 2) + o };
  if (side === 'right') return { x: r.x + r.w + pad, y: r.y + (r.h / 2) + o };
  if (side === 'top') return { x: r.x + (r.w / 2) + o, y: r.y - pad };
  if (side === 'bottom') return { x: r.x + (r.w / 2) + o, y: r.y + r.h + pad };
  return { x: r.x + (r.w / 2) + (vector.x * pad), y: r.y + (r.h / 2) + (vector.y * pad) };
}

function isPointAttachedToRectBorder(point, rect, tolerance = 8) {
  const r = normalizeArrowRect(rect);
  const px = Number(point && point.x);
  const py = Number(point && point.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const tol = Math.max(0, Number(tolerance) || 0);
  const inX = px >= r.x - tol && px <= r.x + r.w + tol;
  const inY = py >= r.y - tol && py <= r.y + r.h + tol;
  const onLeft = Math.abs(px - r.x) <= tol && inY;
  const onRight = Math.abs(px - (r.x + r.w)) <= tol && inY;
  const onTop = Math.abs(py - r.y) <= tol && inX;
  const onBottom = Math.abs(py - (r.y + r.h)) <= tol && inX;
  return onLeft || onRight || onTop || onBottom;
}

function isTechTreeArrowRouteAttachedToRects(route, sourceRect, targetRect, options = {}) {
  const points = Array.isArray(route) ? route : (Array.isArray(route && route.points) ? route.points : []);
  if (points.length < 2) return false;
  const tolerance = Object.prototype.hasOwnProperty.call(options, 'tolerance')
    ? Number(options.tolerance)
    : 4;
  return isPointAttachedToRectBorder(points[0], sourceRect, tolerance)
    && isPointAttachedToRectBorder(points[points.length - 1], targetRect, tolerance);
}

function getBorderAxisRange(rect, side, inset = 5) {
  const r = normalizeArrowRect(rect);
  const safeInset = clamp(Number(inset) || 0, 0, Math.min(r.w, r.h) / 2);
  if (side === 'left' || side === 'right') {
    return { min: r.y + safeInset, max: r.y + r.h - safeInset };
  }
  return { min: r.x + safeInset, max: r.x + r.w - safeInset };
}

function getOverlappingBorderAxisCoordinate(source, sourceSide, target, targetSide, preferredAxis) {
  const sourceRange = getBorderAxisRange(source, sourceSide);
  const targetRange = getBorderAxisRange(target, targetSide);
  const min = Math.max(sourceRange.min, targetRange.min);
  const max = Math.min(sourceRange.max, targetRange.max);
  if (min > max) return null;
  return clamp(preferredAxis, min, max);
}

function getRangeOverlapAmount(aMin, aMax, bMin, bMax) {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

function chooseTechTreeArrowSides(sourceRect, targetRect) {
  const source = normalizeArrowRect(sourceRect);
  const target = normalizeArrowRect(targetRect);
  const sc = getRectCenter(source);
  const tc = getRectCenter(target);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const horizontalGap = absDx - ((source.w + target.w) / 2);
  const verticalGap = absDy - ((source.h + target.h) / 2);
  const targetSideForHorizontal = dx >= 0 ? 'left' : 'right';
  const sourceSideForHorizontal = dx >= 0 ? 'right' : 'left';
  const directVerticalThreshold = Math.min(source.w, target.w) * 0.35;
  const horizontalOverlap = getRangeOverlapAmount(source.x, source.x + source.w, target.x, target.x + target.w);
  const closeDiagonalStack = horizontalOverlap > Math.min(source.w, target.w) * 0.4
    && absDx > directVerticalThreshold
    && verticalGap > -8
    && verticalGap <= Math.min(source.h, target.h) * 0.8;
  if (closeDiagonalStack) {
    return {
      sourceSide: dy < 0 ? 'top' : 'bottom',
      targetSide: targetSideForHorizontal
    };
  }

  if (horizontalGap > -20 && (absDy <= 18 || (horizontalGap > 30 && absDx > absDy * 1.45))) {
    if (verticalGap > 18 && verticalGap <= 44 && absDy > absDx * 0.5) {
      return {
        sourceSide: sourceSideForHorizontal,
        targetSide: dy < 0 ? 'bottom' : 'top'
      };
    }
    return {
      sourceSide: sourceSideForHorizontal,
      targetSide: targetSideForHorizontal
    };
  }

  if (horizontalGap > -40 && horizontalGap < 36 && absDy > 35 && absDy < absDx * 0.95) {
    return {
      sourceSide: dy < 0 ? 'top' : 'bottom',
      targetSide: targetSideForHorizontal
    };
  }

  if (verticalGap > 12 && (horizontalGap < 36 || absDy > absDx * 0.55)) {
    const sourceSide = dy < 0 ? 'top' : 'bottom';
    const strongVerticalStack = horizontalOverlap > 8
      && absDx <= Math.min(source.w, target.w) * 0.65
      && verticalGap > Math.min(source.h, target.h) * 0.85;
    if (!strongVerticalStack && absDx > directVerticalThreshold && absDy > absDx * 1.1) {
      return {
        sourceSide: sourceSideForHorizontal,
        targetSide: dy < 0 ? 'bottom' : 'top'
      };
    }
    const targetSide = strongVerticalStack || absDx <= directVerticalThreshold
      ? (dy < 0 ? 'bottom' : 'top')
      : targetSideForHorizontal;
    return { sourceSide, targetSide };
  }

  return chooseLowestCostArrowSides(source, target, [
    { sourceSide: sourceSideForHorizontal, targetSide: targetSideForHorizontal },
    { sourceSide: dy < 0 ? 'top' : 'bottom', targetSide: targetSideForHorizontal },
    { sourceSide: sourceSideForHorizontal, targetSide: dy < 0 ? 'bottom' : 'top' }
  ]);
}

function edgeSortValueForSide(edge, side, endpoint) {
  const other = endpoint === 'source' ? getRectCenter(edge.targetRect) : getRectCenter(edge.sourceRect);
  if (side === 'top' || side === 'bottom') return other.x;
  return other.y;
}

function slotOffset(index, count, spacing = 10) {
  if (count <= 1) return 0;
  return (index - ((count - 1) / 2)) * spacing;
}

function layoutTechTreeArrowEdges(edges, options = {}) {
  const list = (Array.isArray(edges) ? edges : []).map((edge, index) => {
    const sourceRect = normalizeArrowRect(edge && edge.sourceRect);
    const targetRect = normalizeArrowRect(edge && edge.targetRect);
    const sides = chooseTechTreeArrowSides(sourceRect, targetRect);
    return {
      ...edge,
      sourceRect,
      targetRect,
      sourceSide: edge && edge.sourceSide || sides.sourceSide,
      targetSide: edge && edge.targetSide || sides.targetSide,
      sourceOffset: 0,
      targetOffset: 0,
      _order: index
    };
  });
  const spacing = Number.isFinite(Number(options.slotSpacing)) ? Number(options.slotSpacing) : 10;
  const groupAndAssign = (endpoint) => {
    const groups = new Map();
    list.forEach((edge) => {
      const node = edge[endpoint];
      const side = edge[`${endpoint}Side`];
      const key = `${node && node.id != null ? node.id : edge._order}:${side}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(edge);
    });
    groups.forEach((group) => {
      group.sort((a, b) => {
        const side = a[`${endpoint}Side`];
        const av = edgeSortValueForSide(a, side, endpoint);
        const bv = edgeSortValueForSide(b, side, endpoint);
        if (av !== bv) return av - bv;
        return a._order - b._order;
      });
      group.forEach((edge, index) => {
        edge[`${endpoint}Offset`] = slotOffset(index, group.length, spacing);
      });
    });
  };
  groupAndAssign('source');
  groupAndAssign('target');
  return list;
}

function medianNumber(values) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function normalizeAutoLayoutNode(node, fallbackIndex) {
  const id = node && node.id != null ? String(node.id) : String(fallbackIndex);
  const w = Math.max(48, Number(node && (node.w || node.width)) || 136);
  const h = Math.max(36, Number(node && (node.h || node.height)) || 64);
  return {
    id,
    originalId: node && node.id,
    label: String(node && (node.label || node.name) || id),
    x: Math.max(0, Number(node && node.x) || 0),
    y: Math.max(0, Number(node && node.y) || 0),
    w,
    h,
    prereqs: Array.isArray(node && node.prereqs)
      ? node.prereqs.map((value) => String(value)).filter((value, index, arr) => value !== id && arr.indexOf(value) === index)
      : [],
    _index: fallbackIndex
  };
}

function compareAutoLayoutNodesByStableOrder(a, b) {
  const ay = Number(a && a.y) || 0;
  const by = Number(b && b.y) || 0;
  if (Math.abs(ay - by) > 2) return ay - by;
  const ax = Number(a && a.x) || 0;
  const bx = Number(b && b.x) || 0;
  if (Math.abs(ax - bx) > 2) return ax - bx;
  const nameCmp = String(a && a.label || '').localeCompare(String(b && b.label || ''), 'en', { sensitivity: 'base' });
  if (nameCmp) return nameCmp;
  return (Number(a && a._index) || 0) - (Number(b && b._index) || 0);
}

function compareAutoLayoutNodesByInputOrder(a, b) {
  const ai = Number(a && a._index);
  const bi = Number(b && b._index);
  if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) return ai - bi;
  const nameCmp = String(a && a.label || '').localeCompare(String(b && b.label || ''), 'en', { sensitivity: 'base' });
  if (nameCmp) return nameCmp;
  return String(a && a.id || '').localeCompare(String(b && b.id || ''), 'en', { sensitivity: 'base' });
}

function buildAutoLayoutRanks(nodes, edges, compareNodes = compareAutoLayoutNodesByStableOrder) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenById = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    childrenById.get(edge.source).push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });
  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .sort(compareNodes)
    .map((node) => node.id);
  const rankById = new Map(nodes.map((node) => [node.id, 0]));
  const visited = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const rank = rankById.get(id) || 0;
    (childrenById.get(id) || []).forEach((childId) => {
      rankById.set(childId, Math.max(rankById.get(childId) || 0, rank + 1));
      indegree.set(childId, Math.max(0, (indegree.get(childId) || 0) - 1));
      if ((indegree.get(childId) || 0) === 0) queue.push(childId);
    });
    queue.sort((a, b) => compareNodes(byId.get(a), byId.get(b)));
  }
  nodes.filter((node) => !visited.has(node.id)).forEach((node) => {
    const parentRanks = edges
      .filter((edge) => edge.target === node.id && rankById.has(edge.source))
      .map((edge) => rankById.get(edge.source) + 1);
    rankById.set(node.id, parentRanks.length > 0 ? Math.max(...parentRanks) : 0);
  });
  return rankById;
}

function getAutoLayoutOrderMap(columns) {
  const order = new Map();
  columns.forEach((column, columnIndex) => {
    column.forEach((node, rowIndex) => {
      order.set(node.id, { column: columnIndex, row: rowIndex });
    });
  });
  return order;
}

function sortAutoLayoutColumnByNeighbors(column, edges, orderMap, direction, compareNodes = compareAutoLayoutNodesByStableOrder) {
  const edgeKey = direction === 'forward' ? 'target' : 'source';
  const neighborKey = direction === 'forward' ? 'source' : 'target';
  return column.slice().sort((a, b) => {
    const av = medianNumber(edges
      .filter((edge) => edge[edgeKey] === a.id && orderMap.has(edge[neighborKey]))
      .map((edge) => orderMap.get(edge[neighborKey]).row));
    const bv = medianNumber(edges
      .filter((edge) => edge[edgeKey] === b.id && orderMap.has(edge[neighborKey]))
      .map((edge) => orderMap.get(edge[neighborKey]).row));
    const af = av == null ? Number.POSITIVE_INFINITY : av;
    const bf = bv == null ? Number.POSITIVE_INFINITY : bv;
    if (af !== bf) return af - bf;
    return compareNodes(a, b);
  });
}

function compactAutoLayoutColumnsToFit(columns, options = {}) {
  const list = Array.isArray(columns) ? columns.filter((column) => Array.isArray(column) && column.length > 0) : [];
  if (list.length <= 1 || options.preserveExisting !== false) return list;
  const bounds = getAutoLayoutUsableBounds(list.flat(), options);
  const maxNodeWidth = list.reduce((max, column) => (
    Math.max(max, column.reduce((colMax, node) => Math.max(colMax, Number(node && node.w) || 0), 0))
  ), 1);
  const maxNodeHeight = list.reduce((max, column) => (
    Math.max(max, column.reduce((colMax, node) => Math.max(colMax, Number(node && node.h) || 0), 0))
  ), 1);
  const minRowGap = Math.max(8, Number(options.minRowGap) || 30);
  const fitColumnGap = Math.max(24, Math.min(40, Number(options.minColumnGap) || 40));
  const columnWidths = list.map((column) => column.reduce((max, node) => Math.max(max, Number(node && node.w) || 0), 0));
  const getWidthFloor = (widths) => {
    const sorted = widths.slice().sort((a, b) => a - b);
    if (sorted.length === 0) return 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.25)))] || 1;
  };
  const getScaledStep = (widths) => widths.length > 1
    ? (bounds.w - widths[widths.length - 1]) / (widths.length - 1)
    : bounds.w;
  const compactToColumnCount = (targetColumnCount) => {
    const compacted = list.map((column) => column.slice());
    const columnHeight = (column) => column.reduce((sum, node) => sum + (Number(node && node.h) || 0), 0) + (minRowGap * Math.max(0, column.length - 1));
    const columnWidth = (column) => column.reduce((max, node) => Math.max(max, Number(node && node.w) || 0), 0);
    while (compacted.length > targetColumnCount && compacted.length > 1) {
      let bestIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index < compacted.length - 1; index += 1) {
        const merged = compacted[index].concat(compacted[index + 1]);
        const score = (columnHeight(merged) * 8) + columnWidth(merged) + (merged.length * 20);
        if (score < bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      compacted.splice(bestIndex, 2, compacted[bestIndex].concat(compacted[bestIndex + 1]));
    }
    return compacted.filter((column) => column.length > 0);
  };
  const fitWidth = columnWidths.reduce((sum, value) => sum + value, 0) + (fitColumnGap * Math.max(0, list.length - 1));
  if (fitWidth <= bounds.w) return list;
  const widthFloor = getWidthFloor(columnWidths);
  const scaledColumnStep = getScaledStep(columnWidths);
  if (scaledColumnStep >= widthFloor * 0.8) return list;
  const maxRowsPerColumn = Math.max(1, Math.floor((bounds.h + minRowGap) / (maxNodeHeight + minRowGap)));
  const nodeCount = list.reduce((sum, column) => sum + column.length, 0);
  const minColumnsForHeight = Math.max(1, Math.ceil(nodeCount / maxRowsPerColumn));
  for (let count = list.length - 1; count >= Math.max(2, minColumnsForHeight); count -= 1) {
    const compacted = compactToColumnCount(count);
    const compactedWidths = compacted.map((column) => column.reduce((max, node) => Math.max(max, Number(node && node.w) || 0), 0));
    if (getScaledStep(compactedWidths) >= getWidthFloor(compactedWidths) * 0.8) return compacted;
  }
  const maxColumnsForWidth = Math.max(1, Math.floor((bounds.w + fitColumnGap) / (maxNodeWidth + fitColumnGap)));
  const targetColumnCount = Math.max(1, Math.min(list.length, Math.min(maxColumnsForWidth, Math.max(2, minColumnsForHeight))));
  if (targetColumnCount >= list.length) return list;
  return compactToColumnCount(targetColumnCount);
}

function pointIsInsideRect(point, rect, inset = 0) {
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= (rect.x - inset)
    && x <= (rect.x + rect.w + inset)
    && y >= (rect.y - inset)
    && y <= (rect.y + rect.h + inset);
}

function pointRectDistance(point, rect) {
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Number.POSITIVE_INFINITY;
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

function getAutoLayoutRoutedEdges(layout, edges) {
  return layoutTechTreeArrowEdges(edges.map((edge) => ({
    source: { id: edge.source },
    target: { id: edge.target },
    sourceRect: layout.rectById.get(edge.source),
    targetRect: layout.rectById.get(edge.target)
  })), { slotSpacing: 10 });
}

function countAutoLayoutRouteObstacleHits(layout, edges) {
  const rects = Array.from(layout.rectById.entries()).map(([id, rect]) => ({ id, rect }));
  let hits = 0;
  const routed = getAutoLayoutRoutedEdges(layout, edges);
  routed.forEach((edge) => {
    const route = buildTechTreeArrowRoute(edge.sourceRect, edge.targetRect, {
      sourceSide: edge.sourceSide,
      targetSide: edge.targetSide,
      sourceOffset: edge.sourceOffset,
      targetOffset: edge.targetOffset,
      horizontalTolerance: 18
    });
    const samples = sampleTechTreeArrowRoute(route, { curveSteps: 8, radius: 13 });
    const hit = rects.some((item) => {
      if (item.id === String(edge.source && edge.source.id) || item.id === String(edge.target && edge.target.id)) return false;
      return samples.some((point) => pointIsInsideRect(point, item.rect, 4));
    });
    if (hit) hits += 1;
  });
  return hits;
}

function scoreAutoLayoutRouteClearance(layout, edges) {
  const rects = Array.from(layout.rectById.entries()).map(([id, rect]) => ({ id, rect }));
  let penalty = 0;
  const routed = getAutoLayoutRoutedEdges(layout, edges);
  routed.forEach((edge) => {
    const route = buildTechTreeArrowRoute(edge.sourceRect, edge.targetRect, {
      sourceSide: edge.sourceSide,
      targetSide: edge.targetSide,
      sourceOffset: edge.sourceOffset,
      targetOffset: edge.targetOffset,
      horizontalTolerance: 18
    });
    const samples = sampleTechTreeArrowRoute(route, { curveSteps: 8, radius: 13 });
    rects.forEach((item) => {
      if (item.id === String(edge.source && edge.source.id) || item.id === String(edge.target && edge.target.id)) return;
      let nearest = Number.POSITIVE_INFINITY;
      samples.forEach((point) => {
        nearest = Math.min(nearest, pointRectDistance(point, item.rect));
      });
      if (nearest < 24) penalty += 24 - nearest;
    });
  });
  return Number(penalty.toFixed(2));
}

function countAutoLayoutBoxOverlaps(layout, gap = 0) {
  const rects = Array.from(layout.rectById.entries()).map(([id, rect]) => ({ id, rect }));
  let overlaps = 0;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (autoLayoutRectsOverlap(rects[i].rect, rects[j].rect, gap)) overlaps += 1;
    }
  }
  return overlaps;
}

function scoreAutoLayoutBoundsOverflow(layout) {
  const bounds = layout && layout.bounds;
  if (!bounds || !Number.isFinite(Number(bounds.x)) || !Number.isFinite(Number(bounds.y)) || !(Number(bounds.w) > 0) || !(Number(bounds.h) > 0)) return 0;
  const left = Number(bounds.x) || 0;
  const top = Number(bounds.y) || 0;
  const right = left + (Number(bounds.w) || 0);
  const bottom = top + (Number(bounds.h) || 0);
  let overflow = 0;
  Array.from(layout.rectById.values()).forEach((rect) => {
    overflow += Math.max(0, left - rect.x);
    overflow += Math.max(0, top - rect.y);
    overflow += Math.max(0, (rect.x + rect.w) - right);
    overflow += Math.max(0, (rect.y + rect.h) - bottom);
  });
  return Number(overflow.toFixed(2));
}

function scoreAutoLayoutExclusionOverlap(layout) {
  const zones = normalizeAutoLayoutExclusionZones(layout && layout.exclusionZones);
  if (zones.length === 0) return 0;
  let overlap = 0;
  Array.from(layout.rectById.values()).forEach((rect) => {
    zones.forEach((zone) => {
      overlap += getAutoLayoutRectOverlapArea(rect, zone);
    });
  });
  return Number(overlap.toFixed(2));
}

function countAutoLayoutEdgeCrossings(layout, edges) {
  let crossings = 0;
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const a = edges[i];
      const b = edges[j];
      if (layout.rankById.get(a.source) !== layout.rankById.get(b.source)) continue;
      if (layout.rankById.get(a.target) !== layout.rankById.get(b.target)) continue;
      const ar = layout.rectById.get(a.source);
      const br = layout.rectById.get(b.source);
      const at = layout.rectById.get(a.target);
      const bt = layout.rectById.get(b.target);
      if (!ar || !br || !at || !bt) continue;
      const sourceDelta = (ar.y + ar.h / 2) - (br.y + br.h / 2);
      const targetDelta = (at.y + at.h / 2) - (bt.y + bt.h / 2);
      if ((sourceDelta * targetDelta) < 0) crossings += 1;
    }
  }
  return crossings;
}

function getLineSegmentIntersection(a, b) {
  const ax1 = Number(a && a.a && a.a.x);
  const ay1 = Number(a && a.a && a.a.y);
  const ax2 = Number(a && a.b && a.b.x);
  const ay2 = Number(a && a.b && a.b.y);
  const bx1 = Number(b && b.a && b.a.x);
  const by1 = Number(b && b.a && b.a.y);
  const bx2 = Number(b && b.b && b.b.x);
  const by2 = Number(b && b.b && b.b.y);
  if (![ax1, ay1, ax2, ay2, bx1, by1, bx2, by2].every(Number.isFinite)) return null;
  const denominator = ((ax1 - ax2) * (by1 - by2)) - ((ay1 - ay2) * (bx1 - bx2));
  const within = (value, one, two) => value >= Math.min(one, two) - 0.01 && value <= Math.max(one, two) + 0.01;
  if (Math.abs(denominator) < 0.01) {
    const cross = ((bx1 - ax1) * (ay2 - ay1)) - ((by1 - ay1) * (ax2 - ax1));
    if (Math.abs(cross) > 0.01) return null;
    const points = [
      { x: ax1, y: ay1 },
      { x: ax2, y: ay2 },
      { x: bx1, y: by1 },
      { x: bx2, y: by2 }
    ].filter((point) => (
      within(point.x, ax1, ax2)
      && within(point.y, ay1, ay2)
      && within(point.x, bx1, bx2)
      && within(point.y, by1, by2)
    ));
    return points.length > 0 ? points[0] : null;
  }
  const px = (((ax1 * ay2 - ay1 * ax2) * (bx1 - bx2)) - ((ax1 - ax2) * (bx1 * by2 - by1 * bx2))) / denominator;
  const py = (((ax1 * ay2 - ay1 * ax2) * (by1 - by2)) - ((ay1 - ay2) * (bx1 * by2 - by1 * bx2))) / denominator;
  if (!within(px, ax1, ax2) || !within(py, ay1, ay2) || !within(px, bx1, bx2) || !within(py, by1, by2)) return null;
  return { x: px, y: py };
}

function pointNearRect(point, rect, distance = 8) {
  if (!point || !rect) return false;
  return pointRectDistance(point, rect) <= distance;
}

function countAutoLayoutRouteCrossings(layout, edges) {
  const routed = getAutoLayoutRoutedEdges(layout, edges);
  const routes = routed.map((edge) => {
    const route = buildTechTreeArrowRoute(edge.sourceRect, edge.targetRect, {
      sourceSide: edge.sourceSide,
      targetSide: edge.targetSide,
      sourceOffset: edge.sourceOffset,
      targetOffset: edge.targetOffset,
      horizontalTolerance: 18
    });
    const points = route && Array.isArray(route.points) ? route.points : [];
    const segments = [];
    for (let idx = 1; idx < points.length; idx += 1) {
      const a = points[idx - 1];
      const b = points[idx];
      if (getPointDistance(a, b) < 1) continue;
      segments.push({ a, b });
    }
    return {
      edge,
      segments,
      sourceRect: edge.sourceRect,
      targetRect: edge.targetRect
    };
  });
  let crossings = 0;
  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      const a = routes[i];
      const b = routes[j];
      const aSourceId = String(a.edge && a.edge.source && a.edge.source.id);
      const aTargetId = String(a.edge && a.edge.target && a.edge.target.id);
      const bSourceId = String(b.edge && b.edge.source && b.edge.source.id);
      const bTargetId = String(b.edge && b.edge.target && b.edge.target.id);
      if (aSourceId === bSourceId || aSourceId === bTargetId || aTargetId === bSourceId || aTargetId === bTargetId) continue;
      let crossed = false;
      for (let ai = 0; ai < a.segments.length && !crossed; ai += 1) {
        for (let bi = 0; bi < b.segments.length && !crossed; bi += 1) {
          const intersection = getLineSegmentIntersection(a.segments[ai], b.segments[bi]);
          if (!intersection) continue;
          if (
            pointNearRect(intersection, a.sourceRect)
            || pointNearRect(intersection, a.targetRect)
            || pointNearRect(intersection, b.sourceRect)
            || pointNearRect(intersection, b.targetRect)
          ) continue;
          crossed = true;
        }
      }
      if (crossed) crossings += 1;
    }
  }
  return crossings;
}

function scoreAutoLayout(layout, edges) {
  let backwardEdges = 0;
  let verticalSpan = 0;
  edges.forEach((edge) => {
    const source = layout.rectById.get(edge.source);
    const target = layout.rectById.get(edge.target);
    if (!source || !target) return;
    if ((source.x + source.w) >= target.x) backwardEdges += 1;
    verticalSpan += Math.abs((source.y + source.h / 2) - (target.y + target.h / 2));
  });
  const boxOverlaps = countAutoLayoutBoxOverlaps(layout, 0);
  const boundsOverflow = scoreAutoLayoutBoundsOverflow(layout);
  const exclusionOverlap = scoreAutoLayoutExclusionOverlap(layout);
  const obstacleHits = countAutoLayoutRouteObstacleHits(layout, edges);
  const edgeCrossings = countAutoLayoutEdgeCrossings(layout, edges);
  const routeCrossings = countAutoLayoutRouteCrossings(layout, edges);
  const routeClearancePenalty = scoreAutoLayoutRouteClearance(layout, edges);
  return {
    score: (boxOverlaps * 100000000) + (exclusionOverlap * 1000000) + (boundsOverflow * 10000) + (backwardEdges * 100000) + (obstacleHits * 10000) + (routeCrossings * 8000) + (edgeCrossings * 1200) + (routeClearancePenalty * 80) + verticalSpan,
    boxOverlaps,
    boundsOverflow,
    exclusionOverlap,
    backwardEdges,
    obstacleHits,
    edgeCrossings,
    routeCrossings,
    routeClearancePenalty,
    verticalSpan
  };
}

function autoLayoutRectsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.w + gap
    && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap
    && a.y + a.h + gap > b.y;
}

function getAutoLayoutRectOverlapArea(a, b) {
  if (!a || !b) return 0;
  const overlapW = Math.min((Number(a.x) || 0) + (Number(a.w) || 0), (Number(b.x) || 0) + (Number(b.w) || 0))
    - Math.max(Number(a.x) || 0, Number(b.x) || 0);
  const overlapH = Math.min((Number(a.y) || 0) + (Number(a.h) || 0), (Number(b.y) || 0) + (Number(b.h) || 0))
    - Math.max(Number(a.y) || 0, Number(b.y) || 0);
  return Math.max(0, overlapW) * Math.max(0, overlapH);
}

function getAutoLayoutPositionBounds(bounds) {
  if (!bounds || !Number.isFinite(Number(bounds.left)) || !Number.isFinite(Number(bounds.top))) return null;
  const left = Number(bounds.left) || 0;
  const top = Number(bounds.top) || 0;
  const right = Number.isFinite(Number(bounds.right)) ? Number(bounds.right) : Number.POSITIVE_INFINITY;
  const bottom = Number.isFinite(Number(bounds.bottom)) ? Number(bounds.bottom) : Number.POSITIVE_INFINITY;
  if (!(right > left) || !(bottom > top)) return null;
  return { left, top, right, bottom };
}

function clampAutoLayoutPositionToBounds(position, bounds) {
  const box = getAutoLayoutPositionBounds(bounds);
  if (!box || !position) return false;
  const maxX = box.right - (Number(position.w) || 0);
  const maxY = box.bottom - (Number(position.h) || 0);
  const nextX = Math.max(box.left, Math.min(maxX, Number(position.x) || 0));
  const nextY = Math.max(box.top, Math.min(maxY, Number(position.y) || 0));
  const moved = Math.abs(nextX - position.x) > 0.01 || Math.abs(nextY - position.y) > 0.01;
  position.x = nextX;
  position.y = nextY;
  return moved;
}

function repairAutoLayoutOverlapPairInsideBounds(a, b, bounds, gap = 0) {
  if (!a || !b || !autoLayoutRectsOverlap(a, b, gap)) return false;
  const box = getAutoLayoutPositionBounds(bounds);
  if (!box) return false;
  const overlapX = Math.min(a.x + a.w + gap, b.x + b.w + gap) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h + gap, b.y + b.h + gap) - Math.max(a.y, b.y);
  const aCenterX = a.x + (a.w / 2);
  const bCenterX = b.x + (b.w / 2);
  const aCenterY = a.y + (a.h / 2);
  const bCenterY = b.y + (b.h / 2);
  const xDirection = aCenterX <= bCenterX ? -1 : 1;
  const yDirection = aCenterY <= bCenterY ? -1 : 1;
  const candidates = [];
  const addCandidate = (target, dx, dy) => {
    const other = target === a ? b : a;
    const next = { ...target, x: target.x + dx, y: target.y + dy };
    if (next.x < box.left - 0.01 || next.y < box.top - 0.01 || next.x + next.w > box.right + 0.01 || next.y + next.h > box.bottom + 0.01) return;
    if (autoLayoutRectsOverlap(next, other, gap)) return;
    candidates.push({ target, dx, dy, score: Math.abs(dx) + Math.abs(dy) });
  };
  const nudgeX = Math.max(1, overlapX + 1);
  const nudgeY = Math.max(1, overlapY + 1);
  addCandidate(a, xDirection * nudgeX, 0);
  addCandidate(b, -xDirection * nudgeX, 0);
  addCandidate(a, -xDirection * nudgeX, 0);
  addCandidate(b, xDirection * nudgeX, 0);
  addCandidate(a, 0, yDirection * nudgeY);
  addCandidate(b, 0, -yDirection * nudgeY);
  addCandidate(a, 0, -yDirection * nudgeY);
  addCandidate(b, 0, yDirection * nudgeY);
  if (candidates.length === 0) return false;
  candidates.sort((left, right) => left.score - right.score);
  const best = candidates[0];
  best.target.x += best.dx;
  best.target.y += best.dy;
  return true;
}

function repairAutoLayoutHardBounds(positions, bounds, options = {}) {
  const list = Array.isArray(positions) ? positions : [];
  if (list.length === 0) return;
  const box = getAutoLayoutPositionBounds(bounds);
  if (!box) return;
  const gap = Math.max(0, Number(options.gap) || 0);
  const maxPasses = Math.max(1, Number(options.maxPasses) || 120);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;
    list.forEach((position) => {
      if (clampAutoLayoutPositionToBounds(position, box)) moved = true;
    });
    let repairedPair = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (!autoLayoutRectsOverlap(list[i], list[j], gap)) continue;
        if (repairAutoLayoutOverlapPairInsideBounds(list[i], list[j], box, gap)) {
          moved = true;
          repairedPair = true;
          break;
        }
      }
      if (repairedPair) break;
    }
    if (!moved) break;
  }
  list.forEach((position) => {
    clampAutoLayoutPositionToBounds(position, box);
  });
}

function countAutoLayoutOverlapAreaForPosition(list, position, ignore = null, gap = 0) {
  return (Array.isArray(list) ? list : []).reduce((sum, other) => {
    if (!other || other === position || other === ignore) return sum;
    return sum + getAutoLayoutRectOverlapArea(
      {
        x: position.x,
        y: position.y,
        w: position.w + gap,
        h: position.h + gap
      },
      other
    );
  }, 0);
}

function resolveAutoLayoutPairOverlaps2D(positions, bounds, options = {}) {
  const list = Array.isArray(positions) ? positions : [];
  if (list.length < 2) return;
  const box = getAutoLayoutPositionBounds(bounds);
  if (!box) return;
  const gap = Math.max(0, Number(options.gap) || 0);
  const maxPasses = Math.max(1, Number(options.maxPasses) || 240);
  const clampCandidate = (position, x, y) => ({
    ...position,
    x: Math.max(box.left, Math.min(box.right - position.w, x)),
    y: Math.max(box.top, Math.min(box.bottom - position.h, y))
  });
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let best = null;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (!autoLayoutRectsOverlap(a, b, gap)) continue;
        const addCandidate = (target, other, x, y) => {
          const next = clampCandidate(target, x, y);
          if (Math.abs(next.x - target.x) < 0.01 && Math.abs(next.y - target.y) < 0.01) return;
          const currentOverlap = countAutoLayoutOverlapAreaForPosition(list, target, null, gap);
          const nextOverlap = countAutoLayoutOverlapAreaForPosition(list, next, target, gap);
          if (nextOverlap >= currentOverlap - 0.01) return;
          const movement = Math.abs(next.x - target.x) + Math.abs(next.y - target.y);
          const sidePenalty = next.x < other.x ? 2 : 0;
          const score = (nextOverlap * 1000000) + movement + sidePenalty;
          if (!best || score < best.score) best = { target, next, score };
        };
        addCandidate(a, b, b.x - a.w - gap, a.y);
        addCandidate(a, b, b.x + b.w + gap, a.y);
        addCandidate(a, b, a.x, b.y - a.h - gap);
        addCandidate(a, b, a.x, b.y + b.h + gap);
        addCandidate(b, a, a.x - b.w - gap, b.y);
        addCandidate(b, a, a.x + a.w + gap, b.y);
        addCandidate(b, a, b.x, a.y - b.h - gap);
        addCandidate(b, a, b.x, a.y + a.h + gap);
      }
    }
    if (!best) break;
    best.target.x = best.next.x;
    best.target.y = best.next.y;
  }
}

function positionExclusionOverlapArea(position, exclusionZones) {
  return normalizeAutoLayoutExclusionZones(exclusionZones).reduce((sum, zone) => sum + getAutoLayoutRectOverlapArea(position, zone), 0);
}

function resolveAutoLayoutExclusions(positions, bounds, exclusionZones, options = {}) {
  const list = Array.isArray(positions) ? positions : [];
  const zones = normalizeAutoLayoutExclusionZones(exclusionZones);
  if (list.length === 0 || zones.length === 0) return;
  const box = getAutoLayoutPositionBounds(bounds);
  if (!box) return;
  const gap = Math.max(0, Number(options.gap) || 8);
  const maxPasses = Math.max(1, Number(options.maxPasses) || 60);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;
    list.forEach((position) => {
      const intersectingZones = zones.filter((zone) => getAutoLayoutRectOverlapArea(position, zone) > 0);
      if (intersectingZones.length === 0) return;
      const candidates = [];
      const addCandidate = (nextX, nextY) => {
        const next = {
          ...position,
          x: Math.max(box.left, Math.min(box.right - position.w, nextX)),
          y: Math.max(box.top, Math.min(box.bottom - position.h, nextY))
        };
        const exclusionOverlap = positionExclusionOverlapArea(next, zones);
        const boxOverlap = list.reduce((sum, other) => {
          if (other === position) return sum;
          return sum + getAutoLayoutRectOverlapArea(next, other);
        }, 0);
        const leftwardPenalty = next.x < position.x ? Math.abs(next.x - position.x) * 4 : 0;
        candidates.push({
          next,
          score: (exclusionOverlap * 100000) + (boxOverlap * 1000) + leftwardPenalty + Math.abs(next.x - position.x) + Math.abs(next.y - position.y),
          exclusionOverlap,
          boxOverlap
        });
      };
      intersectingZones.forEach((zone) => {
        addCandidate(zone.x - position.w - gap, position.y);
        addCandidate(position.x, zone.y + zone.h + gap);
        addCandidate(zone.x - position.w - gap, zone.y + zone.h + gap);
      });
      if (candidates.length === 0) return;
      candidates.sort((a, b) => a.score - b.score);
      const best = candidates[0];
      if (!best || best.exclusionOverlap >= positionExclusionOverlapArea(position, zones)) return;
      if (Math.abs(best.next.x - position.x) > 0.01 || Math.abs(best.next.y - position.y) > 0.01) {
        position.x = best.next.x;
        position.y = best.next.y;
        moved = true;
      }
    });
    if (!moved) break;
  }
}

function resolveAutoLayoutOverlaps(positions, bounds, options = {}) {
  const list = Array.isArray(positions) ? positions : [];
  if (list.length < 2) return;
  const topLimit = Number.isFinite(Number(bounds && bounds.top)) ? Number(bounds.top) : 0;
  const bottomLimit = Number.isFinite(Number(bounds && bounds.bottom)) ? Number(bounds.bottom) : Number.POSITIVE_INFINITY;
  const gap = Math.max(0, Number(options.gap) || 6);
  const maxPasses = Math.max(1, Number(options.maxPasses) || 80);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;
    const ordered = list.slice().sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return String(a.id).localeCompare(String(b.id));
    });
    const placed = [];
    ordered.forEach((position) => {
      let nextY = Math.max(topLimit, position.y);
      placed.forEach((other) => {
        if (!autoLayoutRectsOverlap({ ...position, y: nextY }, other, gap)) return;
        nextY = Math.max(nextY, other.y + other.h + gap);
      });
      if (Math.abs(nextY - position.y) > 0.01) {
        position.y = nextY;
        moved = true;
      }
      placed.push(position);
    });
    const minY = Math.min(...list.map((position) => position.y));
    const maxBottom = Math.max(...list.map((position) => position.y + position.h));
    const overflow = maxBottom - bottomLimit;
    if (overflow > 0) {
      const shift = Math.min(overflow, Math.max(0, minY - topLimit));
      if (shift > 0) {
        list.forEach((position) => { position.y -= shift; });
        moved = true;
      }
      const stillOverflow = Math.max(...list.map((position) => position.y + position.h)) - bottomLimit;
      if (stillOverflow > 0) {
        const bottomOrdered = list.slice().sort((a, b) => {
          if ((a.y + a.h) !== (b.y + b.h)) return (b.y + b.h) - (a.y + a.h);
          if (a.x !== b.x) return b.x - a.x;
          return String(a.id).localeCompare(String(b.id));
        });
        const placedFromBottom = [];
        bottomOrdered.forEach((position) => {
          let nextY = Math.min(position.y, bottomLimit - position.h);
          placedFromBottom.forEach((other) => {
            if (!autoLayoutRectsOverlap({ ...position, y: nextY }, other, gap)) return;
            nextY = Math.min(nextY, other.y - position.h - gap);
          });
          nextY = Math.max(topLimit, nextY);
          if (Math.abs(nextY - position.y) > 0.01) {
            position.y = nextY;
            moved = true;
          }
          placedFromBottom.push(position);
        });
      }
    }
    if (!moved) break;
  }
}

function refreshAutoLayoutRectById(rectById, positions) {
  if (!rectById || typeof rectById.clear !== 'function') return;
  rectById.clear();
  (Array.isArray(positions) ? positions : []).forEach((position) => {
    rectById.set(String(position.key), { x: position.x, y: position.y, w: position.w, h: position.h });
  });
}

function buildAutoLayoutPositions(columns, rankById, options) {
  const width = Math.max(480, Number(options.width) || 1024);
  const height = Math.max(360, Number(options.height) || 768);
  const rawBounds = options && options.bounds && typeof options.bounds === 'object' ? options.bounds : null;
  const useBounds = rawBounds
    && Number.isFinite(Number(rawBounds.x))
    && Number.isFinite(Number(rawBounds.y))
    && Number(rawBounds.w) > 0
    && Number(rawBounds.h) > 0;
  const grid = Math.max(1, Number(options.grid) || 16);
  const paddingLeft = Math.max(0, Number(options.paddingLeft) || 72);
  const paddingRight = Math.max(0, Number(options.paddingRight) || 72);
  const paddingTop = Math.max(0, Number(options.paddingTop) || 56);
  const paddingBottom = Math.max(0, Number(options.paddingBottom) || 56);
  const preserveExisting = options.preserveExisting !== false;
  const minColumnGap = Math.max(24, Number(options.minColumnGap) || (preserveExisting ? 64 : 88));
  const minRowGap = Math.max(8, Number(options.minRowGap) || (preserveExisting ? 20 : 30));
  const exclusionZones = normalizeAutoLayoutExclusionZones(options.exclusionZones || (rawBounds && rawBounds.exclusionZones));
  const layoutLeft = useBounds ? Math.max(0, Number(rawBounds.x) || 0) : paddingLeft;
  const layoutTop = useBounds ? Math.max(0, Number(rawBounds.y) || 0) : paddingTop;
  const availableWidth = useBounds
    ? Math.max(1, Number(rawBounds.w) || 1)
    : Math.max(1, width - paddingLeft - paddingRight);
  const availableHeight = useBounds
    ? Math.max(1, Number(rawBounds.h) || 1)
    : Math.max(1, height - paddingTop - paddingBottom);
  const columnWidths = columns.map((column) => column.reduce((max, node) => Math.max(max, node.w), 0));
  const totalNodeWidth = columnWidths.reduce((sum, value) => sum + value, 0);
  const columnCount = Math.max(1, columns.length);
  const naturalGap = columnCount > 1
    ? Math.floor((availableWidth - totalNodeWidth) / (columnCount - 1))
    : 0;
  const columnGap = columnCount > 1 ? Math.max(minColumnGap, naturalGap) : 0;
  const totalWidth = totalNodeWidth + (columnGap * Math.max(0, columnCount - 1));
  const scaledColumnStep = columnCount > 1
    ? Math.max(1, (availableWidth - columnWidths[columnWidths.length - 1]) / (columnCount - 1))
    : 0;
  let x = Math.max(0, layoutLeft + Math.floor(Math.max(0, availableWidth - totalWidth) / 2));
  const naturalColumnLefts = columns.map((column, columnIndex) => {
    const left = totalWidth > availableWidth && columnCount > 1
      ? layoutLeft + (columnIndex * scaledColumnStep)
      : x;
    x += (columnWidths[columnIndex] || 0) + columnGap;
    return left;
  });
  let columnLefts = naturalColumnLefts.slice();
  const existingColumnLefts = columns.map((column) => {
    const value = medianNumber(column.map((node) => node.x));
    return value == null ? null : value;
  });
  const validExistingLefts = existingColumnLefts.filter((value) => value != null);
  if (preserveExisting && validExistingLefts.length === columns.length) {
    const existingMin = Math.min(...validExistingLefts);
    const existingMax = Math.max(...validExistingLefts);
    if ((existingMax - existingMin) >= availableWidth * 0.25) {
      columnLefts = existingColumnLefts.map((value) => Number(value) || layoutLeft);
      for (let idx = 1; idx < columnLefts.length; idx += 1) {
        columnLefts[idx] = Math.max(columnLefts[idx], columnLefts[idx - 1] + Math.min(36, minColumnGap));
      }
      const minLeft = Math.min(...columnLefts);
      const maxRight = Math.max(...columnLefts.map((left, idx) => left + (columnWidths[idx] || 0)));
      const targetRight = layoutLeft + availableWidth;
      if (minLeft < layoutLeft || maxRight > targetRight) {
        const span = Math.max(1, maxRight - minLeft);
        const fitSpan = Math.max(1, availableWidth);
        const scale = Math.min(1, fitSpan / span);
        columnLefts = columnLefts.map((left, idx) => {
          const scaled = layoutLeft + ((left - minLeft) * scale);
          return Math.max(layoutLeft, Math.min(targetRight - (columnWidths[idx] || 0), scaled));
        });
      }
    }
  }
  const maxRows = columns.reduce((max, column) => Math.max(max, column.length), 1);
  const maxNodeHeight = columns.reduce((max, column) => (
    Math.max(max, column.reduce((colMax, node) => Math.max(colMax, node.h), 0))
  ), 0);
  const naturalRowStep = maxRows > 1 ? Math.floor(Math.max(1, availableHeight - maxNodeHeight) / (maxRows - 1)) : 0;
  const rowStep = maxRows > 1
    ? (useBounds ? Math.max(1, naturalRowStep) : Math.max(maxNodeHeight + minRowGap, naturalRowStep))
    : 0;
  const positions = [];
  const rectById = new Map();
  columns.forEach((column, columnIndex) => {
    const renderColumn = preserveExisting ? column.slice().sort(compareAutoLayoutNodesByStableOrder) : column;
    const columnWidth = columnWidths[columnIndex] || 0;
    const columnMaxHeight = renderColumn.reduce((max, node) => Math.max(max, node.h), 0);
    const columnSpan = renderColumn.length > 1 ? ((renderColumn.length - 1) * rowStep) + columnMaxHeight : columnMaxHeight;
    let y = layoutTop + Math.max(0, Math.floor((availableHeight - columnSpan) / 2));
    const columnLeft = columnLefts[columnIndex] == null ? layoutLeft : columnLefts[columnIndex];
    let packedYById = null;
    if (preserveExisting) {
      packedYById = new Map();
      let cursor = layoutTop;
      renderColumn.forEach((node) => {
        const maxY = useBounds ? layoutTop + availableHeight - node.h : Number.POSITIVE_INFINITY;
        const preferredY = Math.max(layoutTop, Math.min(maxY, Number(node.y) || layoutTop));
        const nextY = Math.max(preferredY, cursor);
        packedYById.set(node.id, nextY);
        cursor = nextY + node.h + minRowGap;
      });
      const last = renderColumn[renderColumn.length - 1];
      if (last) {
        const lastBottom = (packedYById.get(last.id) || layoutTop) + last.h;
        const overflow = lastBottom - (layoutTop + availableHeight);
        if (overflow > 0) {
          const first = renderColumn[0];
          const maxShift = Math.max(0, (packedYById.get(first.id) || layoutTop) - layoutTop);
          const shift = Math.min(overflow, maxShift);
          renderColumn.forEach((node) => {
            packedYById.set(node.id, Math.max(layoutTop, (packedYById.get(node.id) || layoutTop) - shift));
          });
        }
      }
    }
    renderColumn.forEach((node, rowIndex) => {
      const align = String(options.columnAlign || 'left').toLowerCase();
      const alignOffset = align === 'center' ? ((columnWidth - node.w) / 2) : 0;
      const maxX = useBounds ? layoutLeft + availableWidth - node.w : Number.POSITIVE_INFINITY;
      const maxY = useBounds ? layoutTop + availableHeight - node.h : Number.POSITIVE_INFINITY;
      const rawX = Math.round(Math.min(maxX, columnLeft + alignOffset) / grid) * grid;
      const rawPackedY = preserveExisting && packedYById
        ? packedYById.get(node.id)
        : (y + (rowIndex * rowStep) + ((columnMaxHeight - node.h) / 2));
      const rawY = Math.round(rawPackedY / grid) * grid;
      const px = Math.min(maxX, rawX);
      const py = Math.min(maxY, rawY);
      const position = {
        id: node.originalId,
        key: node.id,
        x: Math.max(0, px),
        y: Math.max(0, Math.min(maxY, py)),
        w: node.w,
        h: node.h,
        rank: rankById.get(node.id) || 0,
        row: rowIndex
      };
      positions.push(position);
      rectById.set(node.id, { x: position.x, y: position.y, w: position.w, h: position.h });
    });
  });
  if (preserveExisting || useBounds) {
    resolveAutoLayoutExclusions(positions, {
      left: layoutLeft,
      top: layoutTop,
      right: layoutLeft + availableWidth,
      bottom: layoutTop + availableHeight
    }, exclusionZones, { gap: Math.min(16, Math.max(8, minRowGap / 2)), maxPasses: 80 });
    refreshAutoLayoutRectById(rectById, positions);
    resolveAutoLayoutOverlaps(positions, {
      top: layoutTop,
      bottom: layoutTop + availableHeight
    }, { gap: preserveExisting ? Math.min(10, minRowGap) : minRowGap, maxPasses: 120 });
    refreshAutoLayoutRectById(rectById, positions);
    if (countAutoLayoutBoxOverlaps({ rectById }, 0) > 0) {
      resolveAutoLayoutOverlaps(positions, {
        top: layoutTop,
        bottom: layoutTop + availableHeight
      }, { gap: 0, maxPasses: 240 });
      refreshAutoLayoutRectById(rectById, positions);
    }
    if (!preserveExisting && countAutoLayoutBoxOverlaps({ rectById }, 0) > 0) {
      resolveAutoLayoutOverlaps(positions, {
        top: layoutTop,
        bottom: Number.POSITIVE_INFINITY
      }, { gap: minRowGap, maxPasses: 240 });
      refreshAutoLayoutRectById(rectById, positions);
    }
    repairAutoLayoutHardBounds(positions, {
      left: layoutLeft,
      top: layoutTop,
      right: layoutLeft + availableWidth,
      bottom: layoutTop + availableHeight
    }, { gap: 0, maxPasses: 240 });
    refreshAutoLayoutRectById(rectById, positions);
    if (countAutoLayoutBoxOverlaps({ rectById }, 0) > 0) {
      resolveAutoLayoutPairOverlaps2D(positions, {
        left: layoutLeft,
        top: layoutTop,
        right: layoutLeft + availableWidth,
        bottom: layoutTop + availableHeight
      }, { gap: 0, maxPasses: 360 });
    }
    resolveAutoLayoutExclusions(positions, {
      left: layoutLeft,
      top: layoutTop,
      right: layoutLeft + availableWidth,
      bottom: layoutTop + availableHeight
    }, exclusionZones, { gap: Math.min(16, Math.max(8, minRowGap / 2)), maxPasses: 80 });
    for (let pass = 0; pass < 3; pass += 1) {
      refreshAutoLayoutRectById(rectById, positions);
      if (countAutoLayoutBoxOverlaps({ rectById }, 0) === 0) break;
      resolveAutoLayoutOverlaps(positions, {
        top: layoutTop,
        bottom: layoutTop + availableHeight
      }, { gap: 0, maxPasses: 240 });
      repairAutoLayoutHardBounds(positions, {
        left: layoutLeft,
        top: layoutTop,
        right: layoutLeft + availableWidth,
        bottom: layoutTop + availableHeight
      }, { gap: 0, maxPasses: 240 });
      refreshAutoLayoutRectById(rectById, positions);
      if (countAutoLayoutBoxOverlaps({ rectById }, 0) > 0) {
        resolveAutoLayoutPairOverlaps2D(positions, {
          left: layoutLeft,
          top: layoutTop,
          right: layoutLeft + availableWidth,
          bottom: layoutTop + availableHeight
        }, { gap: 0, maxPasses: 360 });
      }
      resolveAutoLayoutExclusions(positions, {
        left: layoutLeft,
        top: layoutTop,
        right: layoutLeft + availableWidth,
        bottom: layoutTop + availableHeight
      }, exclusionZones, { gap: Math.min(16, Math.max(8, minRowGap / 2)), maxPasses: 80 });
    }
    refreshAutoLayoutRectById(rectById, positions);
  }
  return { positions, rectById, rankById, bounds: { x: layoutLeft, y: layoutTop, w: availableWidth, h: availableHeight }, exclusionZones };
}

function getAutoLayoutUsableBounds(nodes, options = {}) {
  const width = Math.max(480, Number(options.width) || 1024);
  const height = Math.max(360, Number(options.height) || 768);
  const rawBounds = options && options.bounds && typeof options.bounds === 'object' ? options.bounds : null;
  if (
    rawBounds
    && Number.isFinite(Number(rawBounds.x))
    && Number.isFinite(Number(rawBounds.y))
    && Number(rawBounds.w) > 0
    && Number(rawBounds.h) > 0
  ) {
    return {
      x: Math.max(0, Number(rawBounds.x) || 0),
      y: Math.max(0, Number(rawBounds.y) || 0),
      w: Math.max(1, Number(rawBounds.w) || 1),
      h: Math.max(1, Number(rawBounds.h) || 1)
    };
  }
  const paddingLeft = Math.max(0, Number(options.paddingLeft) || 72);
  const paddingRight = Math.max(0, Number(options.paddingRight) || 72);
  const paddingTop = Math.max(0, Number(options.paddingTop) || 56);
  const paddingBottom = Math.max(0, Number(options.paddingBottom) || 56);
  return {
    x: paddingLeft,
    y: paddingTop,
    w: Math.max(1, width - paddingLeft - paddingRight),
    h: Math.max(1, height - paddingTop - paddingBottom)
  };
}

function buildConservativeAutoLayout(nodes, edges, rankById, options = {}) {
  const bounds = getAutoLayoutUsableBounds(nodes, options);
  const grid = Math.max(1, Number(options.grid) || 16);
  const columnThreshold = Math.max(12, Number(options.columnThreshold) || 36);
  const exclusionZones = normalizeAutoLayoutExclusionZones(options.exclusionZones || (options.bounds && options.bounds.exclusionZones));
  const positions = nodes.map((node) => {
    const maxX = bounds.x + bounds.w - node.w;
    const maxY = bounds.y + bounds.h - node.h;
    return {
      id: node.originalId,
      key: node.id,
      x: Math.max(bounds.x, Math.min(maxX, Math.round(node.x / grid) * grid)),
      y: Math.max(bounds.y, Math.min(maxY, Math.round(node.y / grid) * grid)),
      w: node.w,
      h: node.h,
      rank: rankById.get(node.id) || 0,
      row: 0
    };
  });
  const sorted = positions.slice().sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });
  let group = [];
  const flushGroup = () => {
    if (group.length === 0) return;
    const alignedX = Math.min(...group.map((position) => position.x));
    group.forEach((position) => { position.x = alignedX; });
    group = [];
  };
  sorted.forEach((position) => {
    if (group.length === 0) {
      group.push(position);
      return;
    }
    const anchor = medianNumber(group.map((item) => item.x));
    if (Math.abs(position.x - anchor) <= columnThreshold) {
      group.push(position);
    } else {
      flushGroup();
      group.push(position);
    }
  });
  flushGroup();
  resolveAutoLayoutOverlaps(positions, {
    top: bounds.y,
    bottom: bounds.y + bounds.h
  }, { gap: Math.min(10, Math.max(6, Number(options.minRowGap) || 20)), maxPasses: 120 });
  resolveAutoLayoutExclusions(positions, {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.w,
    bottom: bounds.y + bounds.h
  }, exclusionZones, { gap: 8, maxPasses: 80 });
  const rectById = new Map();
  positions.forEach((position) => {
    rectById.set(String(position.key), { x: position.x, y: position.y, w: position.w, h: position.h });
  });
  if (countAutoLayoutBoxOverlaps({ rectById }, 0) > 0) {
    resolveAutoLayoutOverlaps(positions, {
      top: bounds.y,
      bottom: bounds.y + bounds.h
    }, { gap: 0, maxPasses: 240 });
    refreshAutoLayoutRectById(rectById, positions);
  }
  if (countAutoLayoutBoxOverlaps({ rectById }, 0) > 0) {
    resolveAutoLayoutOverlaps(positions, {
      top: bounds.y,
      bottom: Number.POSITIVE_INFINITY
    }, { gap: 0, maxPasses: 240 });
    refreshAutoLayoutRectById(rectById, positions);
  }
  repairAutoLayoutHardBounds(positions, {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.w,
    bottom: bounds.y + bounds.h
  }, { gap: 0, maxPasses: 240 });
  refreshAutoLayoutRectById(rectById, positions);
  if (countAutoLayoutBoxOverlaps({ rectById }, 0) > 0) {
    resolveAutoLayoutPairOverlaps2D(positions, {
      left: bounds.x,
      top: bounds.y,
      right: bounds.x + bounds.w,
      bottom: bounds.y + bounds.h
    }, { gap: 0, maxPasses: 360 });
  }
  resolveAutoLayoutExclusions(positions, {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.w,
    bottom: bounds.y + bounds.h
  }, exclusionZones, { gap: 8, maxPasses: 80 });
  refreshAutoLayoutRectById(rectById, positions);
  return { positions, rectById, rankById, bounds, exclusionZones };
}

function autoLayoutTechTreeNodes(inputNodes, options = {}) {
  const nodes = (Array.isArray(inputNodes) ? inputNodes : [])
    .map((node, index) => normalizeAutoLayoutNode(node, index));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = [];
  nodes.forEach((node) => {
    node.prereqs.forEach((sourceId) => {
      if (!byId.has(sourceId)) return;
      edges.push({ source: sourceId, target: node.id });
    });
  });
  if (nodes.length === 0) {
    return { positions: [], stats: { score: 0, boxOverlaps: 0, obstacleHits: 0, edgeCrossings: 0, backwardEdges: 0 } };
  }
  const preserveMode = String(options.preserveExisting || '').trim().toLowerCase();
  const autoPreserveExisting = preserveMode === 'auto';
  const rebuildFromScratch = options.preserveExisting === false;
  const compareNodesForLayout = rebuildFromScratch ? compareAutoLayoutNodesByInputOrder : compareAutoLayoutNodesByStableOrder;
  const rankById = buildAutoLayoutRanks(nodes, edges, compareNodesForLayout);
  let conservativeCandidate = null;
  if (options.preserveExisting !== false) {
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxRight = Math.max(...nodes.map((node) => node.x + node.w));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxBottom = Math.max(...nodes.map((node) => node.y + node.h));
    const bounds = getAutoLayoutUsableBounds(nodes, options);
    const hasUsefulExistingSpread = (maxRight - minX) >= bounds.w * 0.35
      && (maxBottom - minY) >= bounds.h * 0.35;
    if (hasUsefulExistingSpread) {
      const layout = buildConservativeAutoLayout(nodes, edges, rankById, options);
      conservativeCandidate = {
        positions: layout.positions,
        stats: {
          ...scoreAutoLayout(layout, edges),
          nodeCount: nodes.length,
          edgeCount: edges.length,
          columnCount: new Set(layout.positions.map((position) => Math.round(position.x))).size
        }
      };
      if (!autoPreserveExisting) {
        const stats = conservativeCandidate.stats || {};
        if (
          Number(stats.boxOverlaps) === 0
          && Number(stats.boundsOverflow) === 0
          && Number(stats.exclusionOverlap) === 0
        ) {
          return conservativeCandidate;
        }
      }
    }
  }
  const layoutOptions = autoPreserveExisting ? { ...options, preserveExisting: false } : options;
  const maxRank = nodes.reduce((max, node) => Math.max(max, rankById.get(node.id) || 0), 0);
  let columns = [];
  for (let rank = 0; rank <= maxRank; rank += 1) {
    columns.push(nodes
      .filter((node) => (rankById.get(node.id) || 0) === rank)
      .sort(compareNodesForLayout));
  }
  columns = columns.filter((column) => column.length > 0);
  const orderSweepCount = rebuildFromScratch ? 2 : 4;
  for (let pass = 0; pass < orderSweepCount; pass += 1) {
    let orderMap = getAutoLayoutOrderMap(columns);
    for (let col = 1; col < columns.length; col += 1) {
      columns[col] = sortAutoLayoutColumnByNeighbors(columns[col], edges, orderMap, 'forward', compareNodesForLayout);
      orderMap = getAutoLayoutOrderMap(columns);
    }
    if (!rebuildFromScratch) {
      for (let col = columns.length - 2; col >= 0; col -= 1) {
        columns[col] = sortAutoLayoutColumnByNeighbors(columns[col], edges, orderMap, 'backward', compareNodesForLayout);
        orderMap = getAutoLayoutOrderMap(columns);
      }
    }
  }
  columns = compactAutoLayoutColumnsToFit(columns, layoutOptions);

  const makeLayout = () => buildAutoLayoutPositions(columns, rankById, layoutOptions);
  let bestLayout = makeLayout();
  let bestStats = scoreAutoLayout(bestLayout, edges);
  for (let pass = 0; layoutOptions.preserveExisting === false && pass < 3; pass += 1) {
    let improved = false;
    for (let col = 0; col < columns.length; col += 1) {
      for (let row = 0; row < columns[col].length - 1; row += 1) {
        const nextColumns = columns.map((column) => column.slice());
        const tmp = nextColumns[col][row];
        nextColumns[col][row] = nextColumns[col][row + 1];
        nextColumns[col][row + 1] = tmp;
        const previousColumns = columns;
        columns = nextColumns;
        const candidateLayout = makeLayout();
        const candidateStats = scoreAutoLayout(candidateLayout, edges);
        if (candidateStats.score + 0.01 < bestStats.score) {
          bestLayout = candidateLayout;
          bestStats = candidateStats;
          improved = true;
        } else {
          columns = previousColumns;
        }
      }
    }
    if (!improved) break;
  }

  const graphCandidate = {
    positions: bestLayout.positions,
    stats: {
      ...bestStats,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      columnCount: columns.length
    }
  };
  if (conservativeCandidate && conservativeCandidate.stats && conservativeCandidate.stats.score <= graphCandidate.stats.score) {
    return {
      ...conservativeCandidate,
      stats: {
        ...conservativeCandidate.stats,
        selectedLayout: 'existing'
      }
    };
  }
  return {
    ...graphCandidate,
    stats: {
      ...graphCandidate.stats,
      selectedLayout: conservativeCandidate ? 'rebuild' : 'generated'
    }
  };
}

function pushDistinctPoint(points, point) {
  const last = points[points.length - 1];
  if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) return;
  points.push(point);
}

function getPointDistance(a, b) {
  const dx = Number(b && b.x) - Number(a && a.x);
  const dy = Number(b && b.y) - Number(a && a.y);
  return Math.sqrt((dx * dx) + (dy * dy));
}

function simplifyRoutePoints(rawPoints) {
  const points = [];
  (Array.isArray(rawPoints) ? rawPoints : []).forEach((point) => {
    const next = { x: Number(point && point.x), y: Number(point && point.y) };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return;
    if (points.length > 0 && getPointDistance(points[points.length - 1], next) < 0.5) return;
    points.push(next);
  });
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  for (let idx = 1; idx < points.length - 1; idx += 1) {
    const prev = simplified[simplified.length - 1];
    const curr = points[idx];
    const next = points[idx + 1];
    if (getPointDistance(prev, next) < 0.5) continue;
    const ax = curr.x - prev.x;
    const ay = curr.y - prev.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    const cross = (ax * by) - (ay * bx);
    const dot = (ax * bx) + (ay * by);
    if (Math.abs(cross) < 0.01 && dot >= 0) continue;
    simplified.push(curr);
  }
  simplified.push(points[points.length - 1]);
  return simplified;
}

function getRoutePointDistanceTotal(points) {
  let total = 0;
  for (let idx = 1; idx < points.length; idx += 1) {
    total += getPointDistance(points[idx - 1], points[idx]);
  }
  return total;
}

function getRouteTurnCount(points) {
  let turns = 0;
  for (let idx = 1; idx < points.length - 1; idx += 1) {
    const prev = points[idx - 1];
    const curr = points[idx];
    const next = points[idx + 1];
    const ax = curr.x - prev.x;
    const ay = curr.y - prev.y;
    const bx = next.x - curr.x;
    const by = next.y - curr.y;
    if (Math.abs((ax * by) - (ay * bx)) > 0.01) turns += 1;
  }
  return turns;
}

function getRouteBacktrackCost(points, source, target) {
  const sc = getRectCenter(source);
  const tc = getRectCenter(target);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const useX = Math.abs(dx) >= Math.abs(dy);
  const sign = useX ? Math.sign(dx || 1) : Math.sign(dy || 1);
  let cost = 0;
  for (let idx = 1; idx < points.length; idx += 1) {
    const delta = useX ? points[idx].x - points[idx - 1].x : points[idx].y - points[idx - 1].y;
    if ((delta * sign) < -0.5) cost += Math.abs(delta);
  }
  return cost;
}

function getRouteSidePreferenceCost(route, source, target, sourceSide, targetSide) {
  const sc = getRectCenter(source);
  const tc = getRectCenter(target);
  const towardTarget = { x: tc.x - sc.x, y: tc.y - sc.y };
  const targetToSource = { x: sc.x - tc.x, y: sc.y - tc.y };
  const sourceVector = getSideVector(sourceSide);
  const targetVector = getSideVector(targetSide);
  let cost = 0;
  if (((sourceVector.x * towardTarget.x) + (sourceVector.y * towardTarget.y)) < -0.01) cost += 90;
  if (((targetVector.x * targetToSource.x) + (targetVector.y * targetToSource.y)) < -0.01) cost += 70;
  const points = route && Array.isArray(route.points) ? route.points : [];
  if (points.length >= 2) {
    const startDelta = {
      x: points[1].x - points[0].x,
      y: points[1].y - points[0].y
    };
    if (((startDelta.x * towardTarget.x) + (startDelta.y * towardTarget.y)) < -0.01) cost += 80;
  }
  return cost;
}

function scoreTechTreeArrowRoute(route, sourceRect, targetRect, sides = {}) {
  const source = normalizeArrowRect(sourceRect);
  const target = normalizeArrowRect(targetRect);
  const points = simplifyRoutePoints(route && Array.isArray(route.points) ? route.points : []);
  if (points.length < 2) return Number.POSITIVE_INFINITY;
  const sc = getRectCenter(source);
  const tc = getRectCenter(target);
  const direct = Math.abs(tc.x - sc.x) + Math.abs(tc.y - sc.y);
  const length = getRoutePointDistanceTotal(points);
  return length
    + (Math.max(0, length - direct) * 1.4)
    + (getRouteTurnCount(points) * 18)
    + (getRouteBacktrackCost(points, source, target) * 7)
    + getRouteSidePreferenceCost(route, source, target, sides.sourceSide, sides.targetSide);
}

function chooseLowestCostArrowSides(sourceRect, targetRect, candidates) {
  const source = normalizeArrowRect(sourceRect);
  const target = normalizeArrowRect(targetRect);
  const seen = new Set();
  const sidePairs = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && candidate.sourceSide && candidate.targetSide)
    .filter((candidate) => {
      const key = `${candidate.sourceSide}:${candidate.targetSide}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (sidePairs.length === 0) return { sourceSide: 'right', targetSide: 'left' };
  let best = sidePairs[0];
  let bestScore = Number.POSITIVE_INFINITY;
  sidePairs.forEach((candidate) => {
    const route = buildTechTreeArrowRouteForSides(source, target, {
      sourceSide: candidate.sourceSide,
      targetSide: candidate.targetSide,
      pad: 0,
      horizontalTolerance: 18
    });
    const score = scoreTechTreeArrowRoute(route, source, target, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

function buildTechTreeArrowRouteForSides(sourceRect, targetRect, options = {}) {
  const source = normalizeArrowRect(sourceRect);
  const target = normalizeArrowRect(targetRect);
  const pad = Math.max(0, Number(options.pad) || 0);
  const sourceSide = String(options.sourceSide || 'right');
  const targetSide = String(options.targetSide || 'left');
  const sourceOffset = Number(options.sourceOffset) || 0;
  const targetOffset = Number(options.targetOffset) || 0;
  const stem = Math.max(10, Number(options.stem) || 18);
  const sourceVector = getSideVector(sourceSide);
  const targetVector = getSideVector(targetSide);
  const start = getAttachmentPoint(source, sourceSide, sourceOffset, pad);
  const end = getAttachmentPoint(target, targetSide, targetOffset, pad);
  const sourceHorizontal = sourceVector.x !== 0;
  const targetHorizontal = targetVector.x !== 0;
  const canSlideBothEndpoints = Math.abs(sourceOffset) < 0.01 && Math.abs(targetOffset) < 0.01;
  if (canSlideBothEndpoints && sourceHorizontal && targetHorizontal) {
    const straightY = getOverlappingBorderAxisCoordinate(source, sourceSide, target, targetSide, start.y);
    if (straightY != null) {
      start.y = straightY;
      end.y = straightY;
    }
  } else if (!sourceHorizontal && !targetHorizontal) {
    const straightX = getOverlappingBorderAxisCoordinate(source, sourceSide, target, targetSide, end.x);
    if (straightX != null && (canSlideBothEndpoints || Math.abs(start.x - end.x) <= 18)) {
      start.x = straightX;
      end.x = straightX;
    }
  }
  const sourceExit = { x: start.x + (sourceVector.x * stem), y: start.y + (sourceVector.y * stem) };
  const targetApproach = { x: end.x + (targetVector.x * stem), y: end.y + (targetVector.y * stem) };
  const sourceCenter = getRectCenter(source);
  const targetCenter = getRectCenter(target);
  if (!sourceHorizontal && targetHorizontal) {
    const sourceRange = getBorderAxisRange(source, sourceSide);
    const axisDelta = targetApproach.x - start.x;
    const targetDelta = targetCenter.x - sourceCenter.x;
    const canSlideSourceAxis = Math.abs(sourceOffset) < 0.01
      || Math.abs(axisDelta) <= 24
      || (targetApproach.x >= source.x + 5 && targetApproach.x <= source.x + source.w - 5);
    if (canSlideSourceAxis
      && (axisDelta * targetDelta >= -0.01 || Math.abs(axisDelta) <= 24)
      && targetApproach.x >= sourceRange.min
      && targetApproach.x <= sourceRange.max) {
      start.x = targetApproach.x;
      sourceExit.x = targetApproach.x;
    }
  } else if (sourceHorizontal && !targetHorizontal && Math.abs(sourceOffset) < 0.01) {
    const sourceRange = getBorderAxisRange(source, sourceSide);
    const axisDelta = targetApproach.y - start.y;
    const targetDelta = targetCenter.y - sourceCenter.y;
    if (axisDelta * targetDelta >= -0.01 && targetApproach.y >= sourceRange.min && targetApproach.y <= sourceRange.max) {
      start.y = targetApproach.y;
      sourceExit.y = targetApproach.y;
    }
    if (targetSide === 'top' && Math.abs(targetOffset) < 0.01) {
      const targetRange = getBorderAxisRange(target, targetSide);
      const inset = Math.min(28, Math.max(10, target.w * 0.16));
      const minAxis = Math.min(targetRange.max, targetRange.min + inset);
      const maxAxis = Math.max(targetRange.min, targetRange.max - inset);
      const desiredAxis = clamp(sourceExit.x, minAxis, maxAxis);
      end.x = desiredAxis;
      targetApproach.x = desiredAxis;
    }
  }
  const points = [start];
  pushDistinctPoint(points, sourceExit);
  if (sourceHorizontal && targetHorizontal) {
    const dir = sourceVector.x || (targetApproach.x >= sourceExit.x ? 1 : -1);
    const dx = targetApproach.x - sourceExit.x;
    const horizontalTolerance = Number.isFinite(Number(options.horizontalTolerance)) ? Number(options.horizontalTolerance) : 15;
    if (Math.abs(targetApproach.y - sourceExit.y) <= horizontalTolerance) {
      targetApproach.y = sourceExit.y;
      end.y = sourceExit.y;
    } else if ((dir > 0 && targetApproach.x > sourceExit.x) || (dir < 0 && targetApproach.x < sourceExit.x)) {
      const elbow = clamp(Math.abs(dx) * 0.46, 24, Math.max(24, Number(options.maxElbow) || 140));
      let turnX = sourceExit.x + (elbow * dir);
      if (dir > 0) {
        turnX = Math.min(turnX, targetApproach.x);
      } else {
        turnX = Math.max(turnX, targetApproach.x);
      }
      if (Math.abs(turnX - sourceExit.x) <= 2) {
        turnX = sourceExit.x;
        targetApproach.x = turnX;
      }
      pushDistinctPoint(points, { x: turnX, y: sourceExit.y });
      pushDistinctPoint(points, { x: turnX, y: targetApproach.y });
    } else {
      const midX = (sourceExit.x + targetApproach.x) / 2;
      pushDistinctPoint(points, { x: midX, y: sourceExit.y });
      pushDistinctPoint(points, { x: midX, y: targetApproach.y });
    }
  } else if (!sourceHorizontal && !targetHorizontal) {
    const midY = (sourceExit.y + targetApproach.y) / 2;
    pushDistinctPoint(points, { x: sourceExit.x, y: midY });
    pushDistinctPoint(points, { x: targetApproach.x, y: midY });
  } else if (sourceHorizontal && !targetHorizontal) {
    pushDistinctPoint(points, { x: targetApproach.x, y: sourceExit.y });
  } else {
    pushDistinctPoint(points, { x: targetApproach.x, y: sourceExit.y });
  }
  pushDistinctPoint(points, targetApproach);
  pushDistinctPoint(points, end);
  return {
    dir: targetVector.x || 1,
    headVector: { x: end.x - targetApproach.x, y: end.y - targetApproach.y },
    points
  };
}

function buildTechTreeArrowRoute(sourceRect, targetRect, options = {}) {
  const source = normalizeArrowRect(sourceRect);
  const target = normalizeArrowRect(targetRect);
  const sides = options.sourceSide && options.targetSide
    ? { sourceSide: String(options.sourceSide), targetSide: String(options.targetSide) }
    : chooseTechTreeArrowSides(source, target);
  return buildTechTreeArrowRouteForSides(source, target, {
    ...options,
    sourceSide: sides.sourceSide,
    targetSide: sides.targetSide
  });
}

function getPointAlong(from, to, distanceFromTo) {
  const dist = getPointDistance(from, to);
  if (!dist) return { x: Number(to && to.x) || 0, y: Number(to && to.y) || 0 };
  const ratio = clamp(distanceFromTo / dist, 0, 1);
  return {
    x: (Number(to && to.x) || 0) + (((Number(from && from.x) || 0) - (Number(to && to.x) || 0)) * ratio),
    y: (Number(to && to.y) || 0) + (((Number(from && from.y) || 0) - (Number(to && to.y) || 0)) * ratio)
  };
}

function buildSmoothedSegments(route, radius = 13) {
  const points = simplifyRoutePoints(route && Array.isArray(route.points) ? route.points : []);
  if (points.length === 0) return [];
  if (points.length === 1) return [{ type: 'move', to: points[0] }];
  if (points.length === 2 || Number(radius) <= 0) {
    return [
      { type: 'move', to: points[0] },
      ...points.slice(1).map((pt) => ({ type: 'line', to: pt }))
    ];
  }
  const segments = [{ type: 'move', to: points[0] }];
  let suppressNextCorner = false;
  for (let idx = 1; idx < points.length - 1; idx += 1) {
    const prev = points[idx - 1];
    const curr = points[idx];
    const next = points[idx + 1];
    const prevDistance = getPointDistance(prev, curr);
    const nextDistance = getPointDistance(curr, next);
    if (prevDistance < 1 || nextDistance < 1 || suppressNextCorner) {
      segments.push({ type: 'line', to: curr });
      suppressNextCorner = false;
      continue;
    }
    const inVector = { x: (curr.x - prev.x) / prevDistance, y: (curr.y - prev.y) / prevDistance };
    const outVector = { x: (next.x - curr.x) / nextDistance, y: (next.y - curr.y) / nextDistance };
    const dot = (inVector.x * outVector.x) + (inVector.y * outVector.y);
    if (dot < -0.05 || dot > 0.985) {
      segments.push({ type: 'line', to: curr });
      suppressNextCorner = dot < -0.05;
      continue;
    }
    const cornerRadius = Math.min(Number(radius) || 0, prevDistance / 2, nextDistance / 2);
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
  const segments = buildSmoothedSegments(route, Object.prototype.hasOwnProperty.call(options, 'radius') ? options.radius : 13);
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
  const segments = buildSmoothedSegments(route, Object.prototype.hasOwnProperty.call(options, 'radius') ? options.radius : 13);
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
  autoLayoutTechTreeNodes,
  layoutTechTreeArrowEdges,
  buildTechTreeArrowRoute,
  isTechTreeArrowRouteAttachedToRects,
  constrainTechTreeArrowRoute,
  formatTechTreeArrowSvgPath,
  sampleTechTreeArrowRoute
};
}));
