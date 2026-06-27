const fs = require('node:fs');
const path = require('node:path');

const { decodePcx, encodePcx } = require('./artPreview');

const GREEN = Object.freeze([0, 255, 0]);
const MAGENTA = Object.freeze([255, 0, 255]);
const DEFAULT_LIGHT_KEYS = Object.freeze([
  [0xF6, 0x91, 0x5E],
  [0xFE, 0xF5, 0x00],
  [0x00, 0xFE, 0xFF],
  [0xE4, 0x08, 0x0A],
  [0xBD, 0x15, 0xD0],
  [0x2D, 0x9C, 0x01],
  [0xFF, 0x25, 0xC8],
  [0x0A, 0x02, 0xEB],
  [0x82, 0x62, 0xED]
]);

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function rgbKey(rgb) {
  return `${rgb[0]},${rgb[1]},${rgb[2]}`;
}

function paletteRgb(palette, idx) {
  return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
}

function setPaletteRgb(palette, idx, rgb) {
  palette[idx * 3] = clampByte(rgb[0]);
  palette[idx * 3 + 1] = clampByte(rgb[1]);
  palette[idx * 3 + 2] = clampByte(rgb[2]);
}

function colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function isMagicRgb(rgb) {
  return colorsEqual(rgb, GREEN) || colorsEqual(rgb, MAGENTA);
}

function luminance(rgb) {
  return (0.299 * rgb[0]) + (0.587 * rgb[1]) + (0.114 * rgb[2]);
}

function saturationApprox(rgb) {
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  const min = Math.min(rgb[0], rgb[1], rgb[2]);
  return max <= 0 ? 0 : (max - min) / max;
}

function normalizeLightKeys(keys = DEFAULT_LIGHT_KEYS) {
  const out = [];
  const seen = new Set();
  keys.forEach((raw) => {
    const rgb = Array.isArray(raw)
      ? raw.slice(0, 3).map(clampByte)
      : String(raw || '').replace(/^#/, '').match(/.{1,2}/g);
    if (!rgb || rgb.length < 3) return;
    const parsed = Array.isArray(raw)
      ? rgb
      : rgb.slice(0, 3).map((v) => Number.parseInt(v, 16)).map(clampByte);
    const key = rgbKey(parsed);
    if (!seen.has(key) && !isMagicRgb(parsed)) {
      seen.add(key);
      out.push(parsed);
    }
  });
  return out.length > 0 ? out : DEFAULT_LIGHT_KEYS.map((rgb) => rgb.slice());
}

function makeHistogram(indices) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < indices.length; i += 1) hist[indices[i]] += 1;
  return hist;
}

function makeReservedLightSlots(lightKeys) {
  const count = Math.max(1, Math.min(9, lightKeys.length));
  const start = 254 - count;
  const slots = [];
  for (let i = 0; i < count; i += 1) slots.push(start + i);
  return slots;
}

function findCoverIndex(indices, palette, width, height, pixelIndex, forbiddenIndexes, forbiddenColors) {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  for (let radius = 1; radius <= 6; radius += 1) {
    const counts = new Map();
    for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
        const i = yy * width + xx;
        if (i === pixelIndex) continue;
        const idx = indices[i];
        const rgb = paletteRgb(palette, idx);
        if (forbiddenIndexes.has(idx) || forbiddenColors.has(rgbKey(rgb)) || isMagicRgb(rgb)) continue;
        counts.set(idx, (counts.get(idx) || 0) + 1);
      }
    }
    if (counts.size > 0) {
      return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    }
  }
  for (let idx = 0; idx < 254; idx += 1) {
    const rgb = paletteRgb(palette, idx);
    if (!forbiddenIndexes.has(idx) && !forbiddenColors.has(rgbKey(rgb)) && !isMagicRgb(rgb)) return idx;
  }
  return 0;
}

function remapIndex(indices, from, to) {
  if (from === to) return 0;
  let changed = 0;
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] === from) {
      indices[i] = to;
      changed += 1;
    }
  }
  return changed;
}

function swapPaletteSlots(indices, palette, hist, a, b) {
  if (a === b) return;
  const ar = paletteRgb(palette, a);
  const br = paletteRgb(palette, b);
  setPaletteRgb(palette, a, br);
  setPaletteRgb(palette, b, ar);
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] === a) indices[i] = b;
    else if (indices[i] === b) indices[i] = a;
  }
  const oldA = hist[a];
  hist[a] = hist[b];
  hist[b] = oldA;
}

function coverPixelsMatching(indices, palette, width, height, predicate, forbiddenIndexes, forbiddenColors) {
  let covered = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const idx = indices[i];
    const rgb = paletteRgb(palette, idx);
    if (!predicate(idx, rgb)) continue;
    indices[i] = findCoverIndex(indices, palette, width, height, i, forbiddenIndexes, forbiddenColors);
    covered += 1;
  }
  return covered;
}

function reserveLightKeySlots(decoded, lightKeys) {
  const indices = new Uint8Array(decoded.indices);
  const palette = new Uint8Array(decoded.palette);
  const lightSlots = makeReservedLightSlots(lightKeys);
  const forbiddenIndexes = new Set([...lightSlots, 254, 255]);
  const lightColorKeys = new Set(lightKeys.map(rgbKey));
  const width = decoded.width;
  const height = decoded.height;
  let coveredPixels = 0;

  coveredPixels += coverPixelsMatching(
    indices,
    palette,
    width,
    height,
    (idx, rgb) => (idx === 254 && !colorsEqual(rgb, GREEN)) || (idx === 255 && !colorsEqual(rgb, MAGENTA)),
    forbiddenIndexes,
    lightColorKeys
  );

  for (let idx = 0; idx < 256; idx += 1) {
    const rgb = paletteRgb(palette, idx);
    if (colorsEqual(rgb, GREEN)) remapIndex(indices, idx, 254);
    else if (colorsEqual(rgb, MAGENTA)) remapIndex(indices, idx, 255);
  }
  setPaletteRgb(palette, 254, GREEN);
  setPaletteRgb(palette, 255, MAGENTA);

  const hist = makeHistogram(indices);
  const movableSlots = [];
  for (let idx = 0; idx < 254; idx += 1) {
    if (forbiddenIndexes.has(idx)) continue;
    const rgb = paletteRgb(palette, idx);
    if (isMagicRgb(rgb) || lightColorKeys.has(rgbKey(rgb))) continue;
    movableSlots.push(idx);
  }
  movableSlots.sort((a, b) => hist[a] - hist[b] || a - b);

  for (const lightSlot of lightSlots) {
    const best = movableSlots.find((idx) => idx !== lightSlot && hist[idx] < hist[lightSlot]);
    if (best == null) continue;
    swapPaletteSlots(indices, palette, hist, lightSlot, best);
  }

  coveredPixels += coverPixelsMatching(
    indices,
    palette,
    width,
    height,
    (idx, rgb) => lightSlots.includes(idx) || lightColorKeys.has(rgbKey(rgb)),
    forbiddenIndexes,
    lightColorKeys
  );

  lightKeys.forEach((rgb, i) => setPaletteRgb(palette, lightSlots[i], rgb));
  setPaletteRgb(palette, 254, GREEN);
  setPaletteRgb(palette, 255, MAGENTA);

  return { indices, palette, lightSlots, coveredPixels };
}

function sourceRgbAt(decoded, i) {
  return paletteRgb(decoded.palette, decoded.indices[i]);
}

function localStats(decoded, pixelIndex, radius = 1) {
  const x = pixelIndex % decoded.width;
  const y = Math.floor(pixelIndex / decoded.width);
  let count = 0;
  let sum = 0;
  let darker = 0;
  let nonMagicNeighbors = 0;
  const center = sourceRgbAt(decoded, pixelIndex);
  const centerLum = luminance(center);
  for (let yy = Math.max(0, y - radius); yy <= Math.min(decoded.height - 1, y + radius); yy += 1) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(decoded.width - 1, x + radius); xx += 1) {
      const i = yy * decoded.width + xx;
      if (i === pixelIndex) continue;
      const rgb = sourceRgbAt(decoded, i);
      if (isMagicRgb(rgb)) continue;
      const lum = luminance(rgb);
      sum += lum;
      count += 1;
      nonMagicNeighbors += 1;
      if (lum + 12 < centerLum) darker += 1;
    }
  }
  return {
    avg: count > 0 ? sum / count : centerLum,
    darkerRatio: nonMagicNeighbors > 0 ? darker / nonMagicNeighbors : 0,
    nonMagicNeighbors
  };
}

function scoreWarmWindow(rgb, lum, sat, stats) {
  const warm = rgb[0] >= 70 && rgb[1] >= 34 && rgb[2] <= 150 && rgb[0] >= rgb[1] * 0.76 && rgb[1] >= rgb[2] - 4;
  if (!warm) return 0;
  const orange = Math.max(0, rgb[0] - rgb[2]) + Math.max(0, rgb[1] - rgb[2]);
  const contrast = Math.max(0, lum - stats.avg);
  const shadowPocket = Math.max(0, stats.avg - lum - 4);
  const facade = Math.max(0, stats.darkerRatio - 0.18) * 90;
  return (orange * 0.18) + (contrast * 1.15) + (shadowPocket * 0.7) + (sat * 34) + facade + (stats.nonMagicNeighbors * 2);
}

function classifyLightKey(rgb, lightKeys) {
  const warmScore = (rgb[0] - rgb[2]) + Math.max(0, rgb[1] - rgb[2]);
  if (rgb[1] >= 130 && rgb[0] >= 145 && rgb[2] <= 100 && warmScore > 160) return 1; // yellow
  return Math.min(0, lightKeys.length - 1); // orange
}

function detectLightCandidates(decoded, options, lightKeys) {
  const candidates = [];
  const minScore = Number.isFinite(Number(options.minScore)) ? Number(options.minScore) : 78;
  for (let i = 0; i < decoded.indices.length; i += 1) {
    const rgb = sourceRgbAt(decoded, i);
    if (isMagicRgb(rgb)) continue;
    const lum = luminance(rgb);
    if (lum < 24 || lum > 238) continue;
    const sat = saturationApprox(rgb);
    const stats = localStats(decoded, i, 1);
    if (stats.nonMagicNeighbors < 4) continue;
    const warmScore = scoreWarmWindow(rgb, lum, sat, stats);
    const score = warmScore;
    if (score < minScore) continue;
    candidates.push({
      index: i,
      score,
      keyIndex: Math.max(0, Math.min(lightKeys.length - 1, classifyLightKey(rgb, lightKeys)))
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.index - b.index);
}

function selectCandidates(candidates, width, height, options) {
  const maxLights = Math.max(0, Number.isFinite(Number(options.maxLights)) ? Math.floor(Number(options.maxLights)) : Infinity);
  const maxRatio = Number.isFinite(Number(options.maxLightRatio)) ? Number(options.maxLightRatio) : 0.008;
  const targetMax = Math.min(maxLights, Math.max(1, Math.floor(width * height * maxRatio)));
  const selected = [];
  const occupied = new Uint8Array(width * height);
  const minDistance = Math.max(0, Number.isFinite(Number(options.minDistance)) ? Math.floor(Number(options.minDistance)) : 2);
  const cellSize = Math.max(1, Number.isFinite(Number(options.cellSize)) ? Math.floor(Number(options.cellSize)) : 8);
  const cellLimit = Math.max(1, Number.isFinite(Number(options.cellLimit)) ? Math.floor(Number(options.cellLimit)) : 3);
  const cellCounts = new Map();
  for (const candidate of candidates) {
    if (selected.length >= targetMax) break;
    const x = candidate.index % width;
    const y = Math.floor(candidate.index / width);
    const cellKey = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    if ((cellCounts.get(cellKey) || 0) >= cellLimit) continue;
    let nearby = 0;
    for (let yy = Math.max(0, y - minDistance); yy <= Math.min(height - 1, y + minDistance); yy += 1) {
      for (let xx = Math.max(0, x - minDistance); xx <= Math.min(width - 1, x + minDistance); xx += 1) {
        nearby += occupied[yy * width + xx];
      }
    }
    if (nearby > 1) continue;
    occupied[candidate.index] = 1;
    cellCounts.set(cellKey, (cellCounts.get(cellKey) || 0) + 1);
    selected.push(candidate);
  }
  return selected;
}

function draftLightAnnotation(sourcePathOrBuffer, options = {}) {
  const decoded = decodePcx(sourcePathOrBuffer, { returnIndexed: true, transparentIndexes: [] });
  const lightKeys = normalizeLightKeys(options.lightKeys);
  const reserved = reserveLightKeySlots(decoded, lightKeys);
  const candidates = detectLightCandidates(decoded, options, lightKeys);
  const selected = selectCandidates(candidates, decoded.width, decoded.height, options);
  selected.forEach((candidate) => {
    reserved.indices[candidate.index] = reserved.lightSlots[candidate.keyIndex] || reserved.lightSlots[0];
  });
  return {
    ok: true,
    width: decoded.width,
    height: decoded.height,
    indices: reserved.indices,
    palette: reserved.palette,
    lightSlots: reserved.lightSlots,
    lightKeys,
    candidateCount: candidates.length,
    selectedCount: selected.length,
    coveredPixels: reserved.coveredPixels,
    buffer: encodePcx(reserved.indices, reserved.palette, decoded.width, decoded.height)
  };
}

function writeDraftLightAnnotation(sourcePath, outputPath, options = {}) {
  const result = draftLightAnnotation(sourcePath, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.buffer);
  return { ...result, outputPath };
}

module.exports = {
  DEFAULT_LIGHT_KEYS,
  draftLightAnnotation,
  writeDraftLightAnnotation,
  makeReservedLightSlots
};
