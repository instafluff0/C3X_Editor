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

return {
  TECH_BOX_ROWS_PER_ERA,
  TECH_BOX_COLUMNS_PER_ROW,
  TECH_BOX_DEFAULT_COLUMN_INDEX,
  parseTechBoxSheetLayout,
  getTechBoxFrame,
  chooseTechBoxSizeIndexForIconCount
};
}));
