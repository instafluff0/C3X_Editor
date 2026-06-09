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

  if (horizontalGap > -20 && (absDy <= 18 || (horizontalGap > 30 && absDx > absDy * 1.45))) {
    return {
      sourceSide: sourceSideForHorizontal,
      targetSide: targetSideForHorizontal
    };
  }

  if (verticalGap > 12 && (horizontalGap < 36 || absDy > absDx * 0.55)) {
    const sourceSide = dy < 0 ? 'top' : 'bottom';
    const directVerticalThreshold = Math.min(source.w, target.w) * 0.35;
    const horizontalOverlap = getRangeOverlapAmount(source.x, source.x + source.w, target.x, target.x + target.w);
    const strongVerticalStack = horizontalOverlap > 8
      && absDx <= Math.min(source.w, target.w) * 0.65
      && verticalGap > Math.min(source.h, target.h) * 0.85;
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

function buildAutoLayoutRanks(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenById = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    childrenById.get(edge.source).push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  });
  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .sort(compareAutoLayoutNodesByStableOrder)
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
    queue.sort((a, b) => compareAutoLayoutNodesByStableOrder(byId.get(a), byId.get(b)));
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

function sortAutoLayoutColumnByNeighbors(column, edges, orderMap, direction) {
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
    return compareAutoLayoutNodesByStableOrder(a, b);
  });
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

function countAutoLayoutRouteObstacleHits(layout, edges) {
  const rects = Array.from(layout.rectById.entries()).map(([id, rect]) => ({ id, rect }));
  let hits = 0;
  const routed = layoutTechTreeArrowEdges(edges.map((edge) => ({
    source: { id: edge.source },
    target: { id: edge.target },
    sourceRect: layout.rectById.get(edge.source),
    targetRect: layout.rectById.get(edge.target)
  })), { slotSpacing: 10 });
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
  const obstacleHits = countAutoLayoutRouteObstacleHits(layout, edges);
  const edgeCrossings = countAutoLayoutEdgeCrossings(layout, edges);
  return {
    score: (backwardEdges * 100000) + (obstacleHits * 10000) + (edgeCrossings * 1200) + verticalSpan,
    backwardEdges,
    obstacleHits,
    edgeCrossings,
    verticalSpan
  };
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
  const minColumnGap = Math.max(24, Number(options.minColumnGap) || 64);
  const minRowGap = Math.max(8, Number(options.minRowGap) || 20);
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
    const columnWidth = columnWidths[columnIndex] || 0;
    const columnMaxHeight = column.reduce((max, node) => Math.max(max, node.h), 0);
    const columnSpan = column.length > 1 ? ((column.length - 1) * rowStep) + columnMaxHeight : columnMaxHeight;
    let y = layoutTop + Math.max(0, Math.floor((availableHeight - columnSpan) / 2));
    const columnLeft = totalWidth > availableWidth && columnCount > 1
      ? layoutLeft + (columnIndex * scaledColumnStep)
      : x;
    column.forEach((node, rowIndex) => {
      const align = String(options.columnAlign || 'left').toLowerCase();
      const alignOffset = align === 'center' ? ((columnWidth - node.w) / 2) : 0;
      const maxX = useBounds ? layoutLeft + availableWidth - node.w : Number.POSITIVE_INFINITY;
      const maxY = useBounds ? layoutTop + availableHeight - node.h : Number.POSITIVE_INFINITY;
      const rawX = Math.round(Math.min(maxX, columnLeft + alignOffset) / grid) * grid;
      const rawY = Math.round((y + (rowIndex * rowStep) + ((columnMaxHeight - node.h) / 2)) / grid) * grid;
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
    x += columnWidth + columnGap;
  });
  return { positions, rectById, rankById };
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
    return { positions: [], stats: { score: 0, obstacleHits: 0, edgeCrossings: 0, backwardEdges: 0 } };
  }
  const rankById = buildAutoLayoutRanks(nodes, edges);
  const maxRank = nodes.reduce((max, node) => Math.max(max, rankById.get(node.id) || 0), 0);
  let columns = [];
  for (let rank = 0; rank <= maxRank; rank += 1) {
    columns.push(nodes
      .filter((node) => (rankById.get(node.id) || 0) === rank)
      .sort(compareAutoLayoutNodesByStableOrder));
  }
  columns = columns.filter((column) => column.length > 0);
  for (let pass = 0; pass < 4; pass += 1) {
    let orderMap = getAutoLayoutOrderMap(columns);
    for (let col = 1; col < columns.length; col += 1) {
      columns[col] = sortAutoLayoutColumnByNeighbors(columns[col], edges, orderMap, 'forward');
      orderMap = getAutoLayoutOrderMap(columns);
    }
    for (let col = columns.length - 2; col >= 0; col -= 1) {
      columns[col] = sortAutoLayoutColumnByNeighbors(columns[col], edges, orderMap, 'backward');
      orderMap = getAutoLayoutOrderMap(columns);
    }
  }

  const makeLayout = () => buildAutoLayoutPositions(columns, rankById, options);
  let bestLayout = makeLayout();
  let bestStats = scoreAutoLayout(bestLayout, edges);
  for (let pass = 0; pass < 3; pass += 1) {
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

  return {
    positions: bestLayout.positions,
    stats: {
      ...bestStats,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      columnCount: columns.length
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
  } else if (canSlideBothEndpoints && !sourceHorizontal && !targetHorizontal) {
    const straightX = getOverlappingBorderAxisCoordinate(source, sourceSide, target, targetSide, end.x);
    if (straightX != null) {
      start.x = straightX;
      end.x = straightX;
    }
  }
  const sourceExit = { x: start.x + (sourceVector.x * stem), y: start.y + (sourceVector.y * stem) };
  const targetApproach = { x: end.x + (targetVector.x * stem), y: end.y + (targetVector.y * stem) };
  const sourceCenter = getRectCenter(source);
  const targetCenter = getRectCenter(target);
  if (!sourceHorizontal && targetHorizontal && Math.abs(sourceOffset) < 0.01) {
    const sourceRange = getBorderAxisRange(source, sourceSide);
    const axisDelta = targetApproach.x - start.x;
    const targetDelta = targetCenter.x - sourceCenter.x;
    if (axisDelta * targetDelta >= -0.01 && targetApproach.x >= sourceRange.min && targetApproach.x <= sourceRange.max) {
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
  formatTechTreeArrowSvgPath,
  sampleTechTreeArrowRoute
};
}));
