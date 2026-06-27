const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decodePcx, encodePcx, encodeRgbaToPcx } = require('./artPreview');
const { deriveScenarioPathContext, isPathWithinAnyRoot } = require('./configCore');

const NOON_SUBFOLDER = '1200';
const BASE_SEASON = 'Summer';
const MAGENTA = Object.freeze([255, 0, 255]);
const GREEN = Object.freeze([0, 255, 0]);
const PROTECTED_RANGES_ENTERTAINMENT_COMPLEX = Object.freeze([
  [[159, 18], [169, 18]], [[157, 19], [170, 19]], [[155, 20], [171, 20]], [[153, 21], [172, 21]], [[158, 22], [166, 22]],
  [[159, 81], [169, 81]], [[157, 82], [170, 82]], [[155, 83], [171, 83]], [[153, 84], [172, 84]], [[158, 85], [166, 85]],
  [[165, 147], [171, 147]], [[163, 148], [171, 148]], [[161, 149], [175, 149]], [[159, 150], [176, 150]], [[158, 151], [178, 151]],
  [[155, 152], [180, 152]], [[157, 151], [178, 151]], [[155, 152], [181, 152]], [[154, 153], [182, 153]], [[152, 154], [183, 154]],
  [[151, 155], [184, 155]], [[149, 156], [185, 156]], [[148, 157], [184, 157]], [[146, 158], [186, 158]], [[146, 159], [186, 159]],
  [[145, 160], [185, 160]], [[146, 161], [185, 161]], [[147, 162], [184, 162]], [[148, 163], [183, 163]], [[151, 164], [178, 164]],
  [[155, 165], [176, 165]], [[157, 166], [175, 166]],
  [[161, 208], [163, 208]], [[159, 209], [165, 209]], [[157, 210], [167, 210]], [[155, 211], [169, 211]], [[153, 212], [171, 212]],
  [[151, 213], [173, 213]], [[149, 214], [175, 214]], [[147, 215], [177, 215]], [[146, 216], [179, 216]], [[148, 217], [181, 217]],
  [[151, 218], [183, 218]], [[151, 219], [185, 219]], [[150, 220], [186, 220]], [[150, 221], [167, 221]], [[169, 221], [184, 221]],
  [[148, 222], [165, 222]], [[173, 222], [183, 222]], [[149, 223], [165, 223]], [[173, 223], [181, 223]], [[151, 224], [165, 224]],
  [[173, 224], [179, 224]], [[151, 225], [165, 225]], [[173, 225], [177, 225]], [[152, 226], [168, 226]], [[170, 226], [175, 226]],
  [[154, 227], [168, 227]], [[170, 227], [174, 227]], [[155, 228], [168, 228]], [[170, 228], [172, 228]], [[157, 229], [168, 229]],
  [[170, 229], [171, 229]], [[161, 230], [168, 230]], [[170, 230], [172, 230]], [[163, 231], [168, 231]], [[170, 231], [171, 231]],
  [[161, 232], [168, 232]], [[161, 233], [168, 233]], [[162, 234], [167, 234]], [[161, 235], [165, 235]], [[161, 236], [163, 236]]
]);

const SCRIPT_DEFAULTS = Object.freeze({
  onlyHour: '',
  warmth: 1.7,
  blue: 1.6,
  darkness: 3.0,
  desat: 0.8,
  sat: 1.1,
  contrast: 1.08,
  sunriseCenter: 6.0,
  sunsetCenter: 18.0,
  twilightWidth: 2.6,
  noonBlend: 0.5,
  noonSigma: 1.0,
  coreColor: '#ff8a20',
  glowColor: '#dc6a00',
  coreRadius: 1.1,
  coreGain: 2.5,
  haloRadius: 13,
  haloGain: 20.0,
  haloSep: 0.75,
  haloGamma: 1.3,
  highlightGain: 0.5,
  sizeBoost: 1.7,
  sizeRadius: 6.5,
  sizeGamma: 0.75,
  clipInterior: 'yes',
  clipErode: 0,
  blendMode: 'screen'
});

const LIGHT_KEYS = Object.freeze([
  '#F6915E',
  '#FEF500',
  '#00feff',
  '#E4080A',
  '#BD15D0',
  '#2D9C01',
  '#FF25C8',
  '#0A02EB',
  '#8262ED'
]);

const LIGHT_STYLES = Object.freeze([
  'key=#F6915E; core=#ff8a20; glow=#dc6a00; core_gain=1.0; highlight_gain=0.0; size_radius=1.5; size_boost=0.05; halo_gain=6.0; halo_radius=1.0; core_radius=0.5; halo_gamma=1.5; size_gamma=0.1;',
  'key=#FEF500; core=#ff8a20; glow=#dc6a00; core_gain=2.5; highlight_gain=1.0; size_radius=6.5; size_boost=1.5; halo_gain=20.0; halo_radius=0.1; core_radius=1.1; halo_gamma=1.3; size_gamma=0.75;',
  'key=#E4080A; core=#E4080A; glow=#E4080A; core_gain=1.0; highlight_gain=0.0; size_radius=0.5; size_boost=0.0; halo_gain=6.0; halo_radius=1.0; core_radius=0.5; halo_gamma=0.9; size_gamma=0.0; blend_mode=add;',
  'key=#00feff; core=#00feff; glow=#00feff; core_gain=0.6; highlight_gain=0.0; size_radius=0.9; size_boost=0.3; halo_gain=8.0; halo_radius=0.1; core_radius=0.5; halo_gamma=1.5; size_gamma=0.1;',
  'key=#BD15D0; core=#BD15D0; glow=#BD15D0; core_gain=0.6; highlight_gain=0.0; size_radius=0.9; size_boost=0.3; halo_gain=8.0; halo_radius=0.1; core_radius=0.5; halo_gamma=1.5; size_gamma=0.1;',
  'key=#2D9C01; core=#2D9C01; glow=#2D9C01; core_gain=0.6; highlight_gain=0.0; size_radius=0.9; size_boost=0.3; halo_gain=8.0; halo_radius=0.1; core_radius=0.5; halo_gamma=1.5; size_gamma=0.1;',
  'key=#FF25C8; core=#FF25C8; glow=#FF25C8; core_gain=0.6; highlight_gain=0.0; size_radius=0.9; size_boost=0.3; halo_gain=8.0; halo_radius=0.1; core_radius=0.5; halo_gamma=1.5; size_gamma=0.1;',
  'key=#0A02EB; core=#0A02EB; glow=#0A02EB; core_gain=0.2; highlight_gain=0.0; size_radius=0.9; size_boost=0.3; halo_gain=8.0; halo_radius=0.1; core_radius=0.5; halo_gamma=1.5; size_gamma=0.1;',
  'key=#8262ED; core=#7521DC; glow=#7521DC; core_gain=0.2; highlight_gain=0.0; size_radius=0.9; size_boost=0.3; halo_gain=8.0; halo_radius=0.1; core_radius=0.5; halo_gamma=1.5; size_gamma=0.1;'
]);

function normalizePathText(value) {
  return String(value || '').trim();
}

function fileExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_err) {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return !!dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch (_err) {
    return false;
  }
}

function isHourFolderName(name) {
  return /^[0-9]{4}$/.test(String(name || ''));
}

function isPcxFileName(name) {
  return /\.pcx$/i.test(String(name || ''));
}

function isLightsFileName(name) {
  return /_lights\.pcx$/i.test(String(name || ''));
}

function listDirNames(dirPath) {
  if (!dirExists(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function listFileNames(dirPath) {
  if (!dirExists(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function normalizeHour(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[0-9]{1,2}$/.test(raw)) return `${raw.padStart(2, '0')}00`;
  if (/^[0-9]{4}$/.test(raw)) return raw === '0000' ? '2400' : raw;
  return raw;
}

function expectedHourFolders() {
  const out = [];
  for (let hour = 1; hour <= 24; hour += 1) out.push(`${String(hour).padStart(2, '0')}00`);
  return out;
}

function generatedHourFolders(onlyHour = '') {
  if (onlyHour) return [onlyHour].filter((hour) => hour && hour !== NOON_SUBFOLDER);
  return expectedHourFolders().filter((hour) => hour !== NOON_SUBFOLDER);
}

function normalizeOptions(options = {}) {
  const merged = { ...SCRIPT_DEFAULTS, ...(options || {}) };
  merged.onlyHour = normalizeHour(merged.onlyHour);
  [
    'warmth', 'blue', 'darkness', 'desat', 'sat', 'contrast', 'sunriseCenter',
    'sunsetCenter', 'twilightWidth', 'noonBlend', 'noonSigma', 'coreRadius',
    'coreGain', 'haloRadius', 'haloGain', 'haloSep', 'haloGamma',
    'highlightGain', 'sizeBoost', 'sizeRadius', 'sizeGamma'
  ].forEach((key) => {
    const n = Number(merged[key]);
    merged[key] = Number.isFinite(n) ? n : SCRIPT_DEFAULTS[key];
  });
  merged.coreColor = String(merged.coreColor || SCRIPT_DEFAULTS.coreColor);
  merged.glowColor = String(merged.glowColor || SCRIPT_DEFAULTS.glowColor);
  merged.clipInterior = String(merged.clipInterior || SCRIPT_DEFAULTS.clipInterior).toLowerCase() === 'no' ? 'no' : 'yes';
  merged.clipErode = Math.max(0, Number.parseInt(merged.clipErode, 10) || 0);
  merged.blendMode = String(merged.blendMode || SCRIPT_DEFAULTS.blendMode).toLowerCase() === 'add' ? 'add' : 'screen';
  return merged;
}

function inspectToolchain() {
  return {
    engine: 'javascript',
    portable: true,
    ok: true,
    missingToolFiles: [],
    requiredFiles: []
  };
}

function getScenarioTargetContext(payload = {}) {
  const mode = String(payload.mode || 'global').trim().toLowerCase();
  const c3xPath = normalizePathText(payload.c3xPath);
  if (mode !== 'scenario') {
    return {
      mode: 'global',
      targetRoot: c3xPath,
      writableRoots: c3xPath ? [c3xPath] : [],
      scenarioContext: null
    };
  }
  const scenarioPath = normalizePathText(payload.scenarioPath);
  const scenarioContext = deriveScenarioPathContext({
    scenarioPath,
    civ3Path: normalizePathText(payload.civ3Path),
    biqTab: payload.scenarioSettingsTab || null,
    includeMissingSearchRoots: true
  });
  const targetRoot = scenarioContext.contentWriteRoot || scenarioContext.expectedContentWriteRoot || scenarioContext.biqRoot || '';
  return {
    mode: 'scenario',
    targetRoot,
    writableRoots: scenarioContext.writableRoots || [],
    scenarioContext
  };
}

function getArtRoot(targetRoot, family) {
  if (!targetRoot) return '';
  return path.join(targetRoot, 'Art', family === 'terrain' ? 'DayNight' : 'Districts');
}

function getFamilyLabel(family) {
  return family === 'terrain' ? 'Terrain' : 'Districts';
}

function scanArtRoot(artRoot, family) {
  const summerAnnotations = path.join(artRoot, BASE_SEASON, 'Annotations');
  const seasons = listDirNames(artRoot)
    .filter((name) => name !== 'Annotations' && !isHourFolderName(name))
    .map((season) => {
      const seasonDir = path.join(artRoot, season);
      const noonDir = path.join(seasonDir, NOON_SUBFOLDER);
      const annotationDir = path.join(seasonDir, 'Annotations');
      const noonFiles = listFileNames(noonDir).filter((name) => isPcxFileName(name) && !isLightsFileName(name));
      const annotationNames = new Set(listFileNames(annotationDir).filter(isLightsFileName).map((name) => name.toLowerCase()));
      const summerAnnotationNames = new Set(listFileNames(summerAnnotations).filter(isLightsFileName).map((name) => name.toLowerCase()));
      const files = noonFiles.map((name) => {
        const annotationFileName = String(name).replace(/\.pcx$/i, '_lights.pcx');
        const lightName = annotationFileName.toLowerCase();
        return {
          name,
          path: path.join(noonDir, name),
          hasSeasonAnnotation: annotationNames.has(lightName),
          hasSummerAnnotation: summerAnnotationNames.has(lightName),
          annotationPath: annotationNames.has(lightName)
            ? path.join(annotationDir, annotationFileName)
            : (summerAnnotationNames.has(lightName) ? path.join(summerAnnotations, annotationFileName) : '')
        };
      });
      const hourFolders = listDirNames(seasonDir).filter(isHourFolderName);
      return {
        name: season,
        path: seasonDir,
        noonDir,
        annotationDir,
        noonExists: dirExists(noonDir),
        annotationExists: dirExists(annotationDir),
        hourFolderCount: hourFolders.length,
        missingHourFolders: expectedHourFolders().filter((hour) => !hourFolders.includes(hour)),
        fileCount: files.length,
        annotationCount: annotationNames.size,
        files
      };
    });
  return {
    family,
    label: getFamilyLabel(family),
    root: artRoot,
    exists: dirExists(artRoot),
    seasons
  };
}

function scanDayNightInputs(payload = {}) {
  const context = getScenarioTargetContext(payload);
  const toolchain = inspectToolchain();
  const families = payload.districtsEnabled === false ? ['terrain'] : ['terrain', 'districts'];
  const roots = families.map((family) => scanArtRoot(getArtRoot(context.targetRoot, family), family));
  const seedCandidates = roots
    .map((root) => makeSeedCandidate(payload, context, root))
    .filter(Boolean);
  const warnings = [];
  if (!context.targetRoot) warnings.push('No target art root could be resolved.');
  if (context.mode === 'scenario' && context.targetRoot && !isPathWithinAnyRoot(context.targetRoot, context.writableRoots)) {
    warnings.push('Resolved scenario art root is outside the allowed scenario roots.');
  }
  roots.forEach((root) => {
    if (!root.exists) warnings.push(`${root.label} art root is missing: ${root.root}`);
  });
  const canGenerate = !!context.targetRoot
    && !(context.mode === 'scenario' && context.targetRoot && !isPathWithinAnyRoot(context.targetRoot, context.writableRoots));
  return {
    ok: true,
    canGenerate,
    targetRoot: context.targetRoot,
    writableRoots: context.writableRoots,
    scenarioContext: context.scenarioContext,
    disabledFamilies: payload.districtsEnabled === false ? ['districts'] : [],
    toolchain,
    roots,
    seedCandidates,
    defaults: { ...SCRIPT_DEFAULTS },
    lightKeys: [...LIGHT_KEYS],
    lightStyles: [...LIGHT_STYLES],
    warnings
  };
}

function candidateSeedRoots(payload = {}, family = '', targetRoot = '') {
  const out = [];
  [
    normalizePathText(payload.c3xPath),
    normalizePathText(payload.civ3Path)
  ].forEach((root) => {
    if (!root) return;
    const artRoot = getArtRoot(root, family);
    if (dirExists(artRoot) && path.resolve(artRoot) !== path.resolve(getArtRoot(targetRoot, family))) out.push(artRoot);
  });
  return [...new Set(out.map((entry) => path.resolve(entry)))];
}

function makeSeedCandidate(payload, context, root) {
  if (!context.targetRoot || !root || !root.family) return null;
  const hasNoonFiles = (root.seasons || []).some((season) => season.noonExists && season.fileCount > 0);
  if (root.exists && hasNoonFiles) return null;
  const sourceRoot = candidateSeedRoots(payload, root.family, context.targetRoot)[0] || '';
  if (!sourceRoot) return null;
  return {
    family: root.family,
    label: root.label,
    targetRoot: root.root,
    sourceRoot,
    reason: root.exists ? 'No 1200 source PCX files found.' : 'Art root is missing.'
  };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function parseRgb(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('#') && raw.length === 7) {
    return [
      Number.parseInt(raw.slice(1, 3), 16),
      Number.parseInt(raw.slice(3, 5), 16),
      Number.parseInt(raw.slice(5, 7), 16)
    ];
  }
  const parts = raw.split(',').map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) return parts.map(clampByte);
  return [0, 0, 0];
}

function rgbKey(rgb) {
  return `${rgb[0]},${rgb[1]},${rgb[2]}`;
}

function colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function paletteRgb(palette, idx) {
  return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]];
}

function findPaletteColor(palette, rgb) {
  for (let i = 0; i < 256; i += 1) {
    if (palette[i * 3] === rgb[0] && palette[i * 3 + 1] === rgb[1] && palette[i * 3 + 2] === rgb[2]) return i;
  }
  return -1;
}

function setPaletteColor(palette, idx, rgb) {
  palette[idx * 3] = clampByte(rgb[0]);
  palette[idx * 3 + 1] = clampByte(rgb[1]);
  palette[idx * 3 + 2] = clampByte(rgb[2]);
}

function remapGreenToMagenta(indices, palette) {
  let magentaIdx = findPaletteColor(palette, MAGENTA);
  if (magentaIdx < 0) return;
  const greenIndices = [];
  for (let i = 0; i < 256; i += 1) {
    if (colorsEqual(paletteRgb(palette, i), GREEN)) greenIndices.push(i);
  }
  if (greenIndices.length === 0) return;
  const greenSet = new Set(greenIndices);
  for (let i = 0; i < indices.length; i += 1) {
    if (greenSet.has(indices[i])) indices[i] = magentaIdx;
  }
  greenIndices.forEach((idx) => setPaletteColor(palette, idx, [0, 0, 0]));
}

function bridgeProtectedRanges(ranges, maxGap = 1) {
  if (maxGap <= 0) return ranges.slice();
  const byY = new Map();
  const out = [];
  ranges.forEach((range) => {
    const [[x1, y1], [x2, y2]] = range;
    if (y1 !== y2) {
      out.push(range);
      return;
    }
    const list = byY.get(y1) || [];
    list.push([Math.min(x1, x2), Math.max(x1, x2)]);
    byY.set(y1, list);
  });
  byY.forEach((spans, y) => {
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let [curX1, curX2] = spans[0];
    for (let i = 1; i < spans.length; i += 1) {
      const [nextX1, nextX2] = spans[i];
      if (nextX1 - curX2 - 1 <= maxGap) curX2 = Math.max(curX2, nextX2);
      else {
        out.push([[curX1, y], [curX2, y]]);
        [curX1, curX2] = [nextX1, nextX2];
      }
    }
    out.push([[curX1, y], [curX2, y]]);
  });
  return out;
}

function collectUsedIndices(indices) {
  const used = new Set();
  for (let i = 0; i < indices.length; i += 1) used.add(indices[i]);
  return used;
}

function protectExactPixelsByIndex(indices, palette, width, height, ranges) {
  const bridged = bridgeProtectedRanges(ranges, 1);
  const used = collectUsedIndices(indices);
  const freePool = [];
  for (let i = 0; i < 256; i += 1) {
    if (!used.has(i)) freePool.push(i);
  }
  const indexMap = new Map();
  const reserved = new Set();
  bridged.forEach((range) => {
    const [[rawX1, rawY1], [rawX2, rawY2]] = range;
    const x1 = Math.max(0, Math.min(width - 1, Math.min(rawX1, rawX2)));
    const x2 = Math.max(0, Math.min(width - 1, Math.max(rawX1, rawX2)));
    const y1 = Math.max(0, Math.min(height - 1, Math.min(rawY1, rawY2)));
    const y2 = Math.max(0, Math.min(height - 1, Math.max(rawY1, rawY2)));
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) {
        const offset = y * width + x;
        const originalIdx = indices[offset];
        if (!indexMap.has(originalIdx)) {
          const dupIdx = freePool.shift();
          if (dupIdx == null) continue;
          setPaletteColor(palette, dupIdx, paletteRgb(palette, originalIdx));
          indexMap.set(originalIdx, dupIdx);
          reserved.add(dupIdx);
        }
        indices[offset] = indexMap.get(originalIdx);
      }
    }
  });
  return reserved;
}

function gauss(x, mu, sigma) {
  if (sigma <= 0) return 0;
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
}

function hourToValue(hourLabel) {
  const label = String(hourLabel || '');
  if (label === '2400') return 0;
  const h = Number.parseInt(label.slice(0, 2), 10) || 0;
  const m = Number.parseInt(label.slice(2, 4), 10) || 0;
  return (h % 24) + (m / 60);
}

function isNightHourLabel(hourLabel) {
  const hour = String(hourLabel) === '2400' ? 24 : Number.parseInt(String(hourLabel).slice(0, 2), 10);
  return (hour >= 18 && hour <= 24) || (hour >= 1 && hour <= 6);
}

function hourWeightLights(hourLabel, start = 18, end = 6, floor = 0.8) {
  const h = hourToValue(hourLabel) % 24;
  const inWindow = h >= start || h <= end;
  if (!inWindow) return 0;
  const length = (24 - start) + end;
  const p = h >= start ? (h - start) : ((24 - start) + h);
  const mid = 0.5 * length;
  const t = Math.abs(p - mid) / mid;
  const w = floor + (1 - floor) * 0.5 * (1 + Math.cos(Math.PI * t));
  return Math.max(0, Math.min(1, w));
}

function hourAdjustments(hourValue, options) {
  const h = ((hourValue % 24) + 24) % 24;
  const daylight = Math.max(0, Math.cos(Math.PI * (h - 12) / 12));
  const night = 1 - daylight;
  const warmth = 0.85 * (gauss(h, options.sunriseCenter, options.twilightWidth) + gauss(h, options.sunsetCenter, options.twilightWidth)) * options.warmth;
  const baseBrightness = 0.6 + 0.4 * daylight;
  const nightDarkening = 1 - (0.12 * (options.darkness - 1) * night);
  const brightness = baseBrightness * nightDarkening;
  return {
    brightness,
    rMul: Math.max(0.65, Math.min(1.45, 0.97 + 0.12 * daylight + 0.30 * warmth)),
    gMul: Math.max(0.65, Math.min(1.40, 0.97 + 0.12 * daylight + 0.12 * warmth)),
    bMul: Math.max(0.65, Math.min(1.55, 0.97 + 0.12 * daylight - 0.18 * warmth + (0.28 * options.blue) * night)),
    grayBlend: Math.max(0, Math.min(0.85, (0.10 + 0.50 * night) * options.desat)),
    bluePush: Math.max(0, options.blue - 1) * night
  };
}

function smoothstep01(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - (2 * t));
}

function intervalMembership(x, a, b, soft) {
  const segment = (value, start, end, edge) => {
    if (edge <= 0) return start <= value && value <= end ? 1 : 0;
    if (start - edge <= value && value < start) return smoothstep01((value - (start - edge)) / edge);
    if (start <= value && value <= end) return 1;
    if (end < value && value <= end + edge) return 1 - smoothstep01((value - end) / edge);
    return 0;
  };
  const h = ((x % 24) + 24) % 24;
  const start = ((a % 24) + 24) % 24;
  const end = ((b % 24) + 24) % 24;
  if (start <= end) return segment(h, start, end, soft);
  return Math.max(segment(h, start, 24, soft), segment(h, 0, end, soft));
}

function noonWeight(hourValue, blend, sigma) {
  if (blend <= 0) return 0;
  const h = ((hourValue % 24) + 24) % 24;
  const d = Math.min(Math.abs(h - 12), 24 - Math.abs(h - 12));
  const g = sigma > 0 ? Math.exp(-0.5 * (d / sigma) ** 2) * blend : 0;
  const window = intervalMembership(h, 10, 14, 0.7) * blend;
  return Math.max(0, Math.min(1, Math.max(g, window)));
}

function tintRgb(rgb, params, satBoost, contrast) {
  let r = rgb[0] * params.rMul * params.brightness;
  let g = rgb[1] * params.gMul * params.brightness;
  let b = rgb[2] * params.bMul * params.brightness;
  const gray = (r + g + b) / 3;
  const t = params.grayBlend;
  r = ((1 - t) * r) + (t * gray);
  g = ((1 - t) * g) + (t * gray);
  b = ((1 - t) * b) + (t * gray);
  const satGray = (r + g + b) / 3;
  r = satGray + ((r - satGray) * satBoost);
  g = satGray + ((g - satGray) * satBoost);
  b = satGray + ((b - satGray) * satBoost);
  if (params.bluePush > 0) {
    const c = params.bluePush;
    r *= (1 - (0.15 * c));
    g *= (1 - (0.10 * c));
    b *= (1 + (0.35 * c));
  }
  r = 128 + ((r - 128) * contrast);
  g = 128 + ((g - 128) * contrast);
  b = 128 + ((b - 128) * contrast);
  return [clampByte(r), clampByte(g), clampByte(b)];
}

function adjustPaletteForHour(sourcePalette, hourLabel, options, reservedIndices = new Set()) {
  const palette = new Uint8Array(sourcePalette);
  const params = hourAdjustments(hourToValue(hourLabel), options);
  const noonW = noonWeight(hourToValue(hourLabel), options.noonBlend, options.noonSigma);
  const satEff = 1 + ((options.sat - 1) * (1 - noonW));
  const contrastEff = 1 + ((options.contrast - 1) * (1 - noonW));
  const reserved = new Set([rgbKey(MAGENTA), ...LIGHT_KEYS.map((key) => rgbKey(parseRgb(key)))]);
  for (let i = 0; i < 256; i += 1) {
    const rgb = paletteRgb(sourcePalette, i);
    if (reservedIndices.has(i)) continue;
    if (reserved.has(rgbKey(rgb))) continue;
    let next = tintRgb(rgb, params, satEff, contrastEff);
    if (noonW > 0) {
      next = [
        clampByte(((1 - noonW) * next[0]) + (noonW * rgb[0])),
        clampByte(((1 - noonW) * next[1]) + (noonW * rgb[1])),
        clampByte(((1 - noonW) * next[2]) + (noonW * rgb[2]))
      ];
    }
    if (reserved.has(rgbKey(next))) {
      next = next.map((channel, idx) => clampByte(channel === rgb[idx] ? channel : (channel > rgb[idx] ? channel - 1 : channel + 1)));
    }
    setPaletteColor(palette, i, next);
  }
  return palette;
}

function decodeIndexedPcx(filePathOrBuffer) {
  return decodePcx(filePathOrBuffer, { returnIndexed: true, transparentIndexes: [] });
}

function indexedToRgba(indexed) {
  const rgba = new Uint8Array(indexed.width * indexed.height * 4);
  for (let i = 0; i < indexed.indices.length; i += 1) {
    const idx = indexed.indices[i];
    rgba[i * 4] = indexed.palette[idx * 3];
    rgba[i * 4 + 1] = indexed.palette[idx * 3 + 1];
    rgba[i * 4 + 2] = indexed.palette[idx * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function makeDayNightIndexed(sourcePath, hourLabel, options) {
  const decoded = decodeIndexedPcx(sourcePath);
  const indices = new Uint8Array(decoded.indices);
  const palette = new Uint8Array(decoded.palette);
  remapGreenToMagenta(indices, palette);
  const reservedIndices = /EntertainmentComplex/i.test(path.basename(sourcePath)) && isNightHourLabel(hourLabel)
    ? protectExactPixelsByIndex(indices, palette, decoded.width, decoded.height, PROTECTED_RANGES_ENTERTAINMENT_COMPLEX)
    : new Set();
  const adjustedPalette = adjustPaletteForHour(palette, hourLabel, options, reservedIndices);
  return {
    width: decoded.width,
    height: decoded.height,
    indices,
    palette: adjustedPalette
  };
}

function writeIndexedPcx(filePath, indexed) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encodePcx(indexed.indices, indexed.palette, indexed.width, indexed.height));
}

function parseLightStyles(styles = LIGHT_STYLES) {
  const out = new Map();
  styles.forEach((raw) => {
    const kv = {};
    String(raw || '').replace(/,/g, ';').split(';').forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed || !trimmed.includes('=')) return;
      const [k, ...rest] = trimmed.split('=');
      kv[k.trim().toLowerCase()] = rest.join('=').trim();
    });
    if (!kv.key) return;
    const style = {};
    if (kv.core) style.coreColor = parseRgb(kv.core);
    if (kv.glow) style.glowColor = parseRgb(kv.glow);
    [
      ['core_gain', 'coreGain'],
      ['halo_gain', 'haloGain'],
      ['core_radius', 'coreRadius'],
      ['halo_radius', 'haloRadius'],
      ['halo_sep', 'haloSep'],
      ['halo_gamma', 'haloGamma'],
      ['highlight', 'highlightGain'],
      ['size_boost', 'sizeBoost'],
      ['size_radius', 'sizeRadius'],
      ['size_gamma', 'sizeGamma']
    ].forEach(([from, to]) => {
      if (kv[from] == null) return;
      style[to] = Number(kv[from]);
    });
    out.set(rgbKey(parseRgb(kv.key)), style);
  });
  return out;
}

function makeMaskFromRgb(rgba, width, height, rgb) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const off = i * 4;
    if (rgba[off] === rgb[0] && rgba[off + 1] === rgb[1] && rgba[off + 2] === rgb[2]) out[i] = 255;
  }
  return out;
}

function makeInteriorMask(baseRgba, width, height, clip, erodePx) {
  const out = new Uint8Array(width * height);
  if (!clip) {
    out.fill(255);
    return out;
  }
  for (let i = 0; i < width * height; i += 1) {
    const off = i * 4;
    const isMagic = (baseRgba[off] === 255 && baseRgba[off + 1] === 0 && baseRgba[off + 2] === 255)
      || (baseRgba[off] === 0 && baseRgba[off + 1] === 255 && baseRgba[off + 2] === 0);
    out[i] = isMagic ? 0 : 255;
  }
  const r = Math.max(0, Number.parseInt(erodePx, 10) || 0);
  if (r <= 0) return out;
  const eroded = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let min = 255;
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy += 1) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx += 1) {
          min = Math.min(min, out[yy * width + xx]);
        }
      }
      eroded[y * width + x] = min;
    }
  }
  return eroded;
}

function gaussianKernel(radius) {
  const sigma = Math.max(0.01, Number(radius) || 0);
  if (sigma <= 0.01) return [1];
  const half = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  let sum = 0;
  for (let i = -half; i <= half; i += 1) {
    const v = Math.exp(-0.5 * (i / sigma) ** 2);
    kernel.push(v);
    sum += v;
  }
  return kernel.map((v) => v / sum);
}

function blurSeparable(src, width, height, radius) {
  const kernel = gaussianKernel(radius);
  if (kernel.length === 1) return Float32Array.from(src);
  const half = Math.floor(kernel.length / 2);
  const temp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const xx = Math.max(0, Math.min(width - 1, x + k - half));
        sum += src[y * width + xx] * kernel[k];
      }
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = 0; k < kernel.length; k += 1) {
        const yy = Math.max(0, Math.min(height - 1, y + k - half));
        sum += temp[yy * width + x] * kernel[k];
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

function boxBlur(src, width, height, radius) {
  const r = Math.max(0, Math.round(Number(radius) || 0));
  if (r <= 0) return Float32Array.from(src);
  const out = new Float32Array(width * height);
  const integral = new Float32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += src[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - r);
      const y1 = Math.max(0, y - r);
      const x2 = Math.min(width - 1, x + r);
      const y2 = Math.min(height - 1, y + r);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[(y2 + 1) * (width + 1) + x2 + 1]
        - integral[y1 * (width + 1) + x2 + 1]
        - integral[(y2 + 1) * (width + 1) + x1]
        + integral[y1 * (width + 1) + x1];
      out[y * width + x] = sum / area;
    }
  }
  return out;
}

function applyGamma(value, gamma) {
  const g = Math.max(0.05, Number(gamma) || 1);
  return Math.pow(Math.max(0, Math.min(255, value)) / 255, g) * 255;
}

function multiplyMask(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] * b[i]) / 255;
  return out;
}

function buildGlowMaps(mask, interior, width, height, wtime, style) {
  let core = blurSeparable(mask, width, height, style.coreRadius);
  let halo = blurSeparable(mask, width, height, style.haloRadius);
  if (style.sizeBoost > 0 && style.sizeRadius > 0) {
    const density = boxBlur(mask, width, height, style.sizeRadius);
    for (let i = 0; i < density.length; i += 1) {
      const boost = applyGamma(density[i], style.sizeGamma) * style.sizeBoost * wtime;
      core[i] = Math.min(255, core[i] + boost);
      halo[i] = Math.min(255, halo[i] + boost);
    }
  }
  const coreAlpha = new Float32Array(mask.length);
  const haloAlpha = new Float32Array(mask.length);
  const haloSep = Math.max(0, Math.min(1, style.haloSep));
  for (let i = 0; i < mask.length; i += 1) {
    const haloOnly = haloSep > 0 ? Math.max(0, halo[i] - (core[i] * haloSep)) : halo[i];
    coreAlpha[i] = Math.min(255, core[i] * wtime * Math.max(0, style.coreGain));
    haloAlpha[i] = Math.min(255, applyGamma(haloOnly, style.haloGamma) * wtime * Math.max(0, style.haloGain));
  }
  return [multiplyMask(coreAlpha, interior), multiplyMask(haloAlpha, interior)];
}

function mergeStyle(base, override = {}) {
  return {
    coreColor: override.coreColor || parseRgb(base.coreColor),
    glowColor: override.glowColor || parseRgb(base.glowColor),
    coreRadius: Number.isFinite(override.coreRadius) ? override.coreRadius : base.coreRadius,
    haloRadius: Number.isFinite(override.haloRadius) ? override.haloRadius : base.haloRadius,
    coreGain: Number.isFinite(override.coreGain) ? override.coreGain : base.coreGain,
    haloGain: Number.isFinite(override.haloGain) ? override.haloGain : base.haloGain,
    highlightGain: Number.isFinite(override.highlightGain) ? override.highlightGain : base.highlightGain,
    sizeBoost: Number.isFinite(override.sizeBoost) ? override.sizeBoost : base.sizeBoost,
    sizeRadius: Number.isFinite(override.sizeRadius) ? override.sizeRadius : base.sizeRadius,
    sizeGamma: Number.isFinite(override.sizeGamma) ? override.sizeGamma : base.sizeGamma,
    haloSep: Number.isFinite(override.haloSep) ? override.haloSep : base.haloSep,
    haloGamma: Number.isFinite(override.haloGamma) ? override.haloGamma : base.haloGamma,
    blendMode: override.blendMode || base.blendMode
  };
}

function compositeLights(baseRgba, annotationRgba, width, height, hourLabel, options) {
  const wtime = hourWeightLights(hourLabel);
  if (wtime <= 0) return baseRgba;
  const comp = new Uint8Array(baseRgba);
  const styles = parseLightStyles(LIGHT_STYLES);
  const keyMap = new Map();
  LIGHT_KEYS.map(parseRgb).forEach((rgb) => keyMap.set(rgbKey(rgb), rgb));
  styles.forEach((_style, key) => keyMap.set(key, key.split(',').map((v) => Number.parseInt(v, 10))));
  const interior = makeInteriorMask(baseRgba, width, height, options.clipInterior !== 'no', options.clipErode);
  keyMap.forEach((keyRgb, key) => {
    const mask = makeMaskFromRgb(annotationRgba, width, height, keyRgb);
    if (!mask.some((v) => v > 0)) return;
    const style = mergeStyle(options, styles.get(key));
    const [coreAlpha, haloAlpha] = buildGlowMaps(mask, interior, width, height, wtime, style);
    for (let i = 0; i < width * height; i += 1) {
      const off = i * 4;
      const layers = [
        [style.coreColor, coreAlpha[i]],
        [style.glowColor, haloAlpha[i]]
      ];
      layers.forEach(([color, alpha]) => {
        if (alpha <= 0) return;
        for (let c = 0; c < 3; c += 1) {
          const layer = (color[c] * alpha) / 255;
          if (style.blendMode === 'add') comp[off + c] = clampByte(comp[off + c] + layer);
          else comp[off + c] = clampByte(255 - (((255 - comp[off + c]) * (255 - layer)) / 255));
        }
      });
      if (style.highlightGain > 0 && coreAlpha[i] > 0) {
        const highlight = coreAlpha[i] * style.highlightGain;
        for (let c = 0; c < 3; c += 1) comp[off + c] = clampByte(comp[off + c] + highlight);
      }
    }
  });
  return comp;
}

function encodeRgbaWithMagic(rgba, width, height, baseRgba = rgba) {
  const encoded = encodeRgbaToPcx(rgba, width, height);
  const decoded = decodeIndexedPcx(encoded);
  let magentaIdx = findPaletteColor(decoded.palette, MAGENTA);
  if (magentaIdx < 0) {
    magentaIdx = 255;
    setPaletteColor(decoded.palette, magentaIdx, MAGENTA);
  }
  for (let i = 0; i < width * height; i += 1) {
    const off = i * 4;
    const isMagic = (baseRgba[off] === 255 && baseRgba[off + 1] === 0 && baseRgba[off + 2] === 255)
      || (baseRgba[off] === 0 && baseRgba[off + 1] === 255 && baseRgba[off + 2] === 0);
    if (isMagic) decoded.indices[i] = magentaIdx;
  }
  remapGreenToMagenta(decoded.indices, decoded.palette);
  return {
    width,
    height,
    indices: decoded.indices,
    palette: decoded.palette
  };
}

function generateOneFile(sourcePath, annotationPath, outPath, hourLabel, options) {
  const dayNight = makeDayNightIndexed(sourcePath, hourLabel, options);
  if (annotationPath && fileExists(annotationPath) && isNightHourLabel(hourLabel)) {
    const baseRgba = indexedToRgba(dayNight);
    const annotation = decodePcx(annotationPath, { transparentIndexes: [] });
    if (annotation.width === dayNight.width && annotation.height === dayNight.height) {
      const composite = compositeLights(baseRgba, annotation.rgba, dayNight.width, dayNight.height, hourLabel, options);
      writeIndexedPcx(outPath, encodeRgbaWithMagic(composite, dayNight.width, dayNight.height, baseRgba));
      return outPath;
    }
  }
  writeIndexedPcx(outPath, dayNight);
  return outPath;
}

function copyFileIfMissing(from, to) {
  if (!fileExists(from) || fileExists(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function copyFileAlways(from, to) {
  if (!fileExists(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function ensureSeasonNoonFolder(seasonDir, summerNoonDir) {
  const seasonNoonDir = path.join(seasonDir, NOON_SUBFOLDER);
  if (!dirExists(summerNoonDir) || path.resolve(seasonNoonDir) === path.resolve(summerNoonDir)) return 0;
  fs.mkdirSync(seasonNoonDir, { recursive: true });
  let copied = 0;
  listFileNames(summerNoonDir).forEach((name) => {
    if (isLightsFileName(name)) return;
    if (copyFileIfMissing(path.join(summerNoonDir, name), path.join(seasonNoonDir, name))) copied += 1;
  });
  return copied;
}

function ensureSeasonAnnotations(seasonDir, summerAnnotationDir) {
  const seasonAnnotationDir = path.join(seasonDir, 'Annotations');
  fs.mkdirSync(seasonAnnotationDir, { recursive: true });
  if (!dirExists(summerAnnotationDir)) return 0;
  let copied = 0;
  listFileNames(summerAnnotationDir).forEach((name) => {
    if (!isLightsFileName(name)) return;
    if (copyFileIfMissing(path.join(summerAnnotationDir, name), path.join(seasonAnnotationDir, name))) copied += 1;
  });
  return copied;
}

function ensureHourFolders(seasonDir) {
  expectedHourFolders().forEach((hour) => fs.mkdirSync(path.join(seasonDir, hour), { recursive: true }));
}

function copyAnnotationsIntoNoon(seasonDir, annotationDir) {
  const noonDir = path.join(seasonDir, NOON_SUBFOLDER);
  let copied = 0;
  listFileNames(noonDir).forEach((name) => {
    if (isLightsFileName(name)) {
      try {
        fs.unlinkSync(path.join(noonDir, name));
      } catch (_err) {}
    }
  });
  listFileNames(annotationDir).forEach((name) => {
    if (!isLightsFileName(name)) return;
    if (copyFileAlways(path.join(annotationDir, name), path.join(noonDir, name))) copied += 1;
  });
  return copied;
}

function cleanupGeneratedLightsFiles(seasonDir, onlyHour = '') {
  const hours = onlyHour ? [onlyHour, NOON_SUBFOLDER] : expectedHourFolders();
  hours.forEach((hour) => {
    const dirPath = path.join(seasonDir, hour);
    listFileNames(dirPath).forEach((name) => {
      if (!isLightsFileName(name)) return;
      try {
        fs.unlinkSync(path.join(dirPath, name));
      } catch (_err) {}
    });
  });
}

function listGeneratedPlainFiles(dataDir, onlyHour = '') {
  const out = [];
  const collect = (dirPath) => {
    if (!dirExists(dirPath)) return;
    fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
      const child = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        collect(child);
      } else if (entry.isFile() && isPcxFileName(entry.name) && !isLightsFileName(entry.name)) {
        out.push(child);
      }
    });
  };
  generatedHourFolders(onlyHour).forEach((hour) => collect(path.join(dataDir, hour)));
  return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function countExpectedGeneratedFiles(scan, families, onlyHour = '') {
  const wanted = families || new Set(['terrain', 'districts']);
  const perSource = generatedHourFolders(onlyHour).length;
  return scan.roots.reduce((sum, root) => {
    if (!wanted.has(root.family)) return sum;
    return sum + root.seasons.reduce((seasonSum, season) => seasonSum + (season.fileCount * perSource), 0);
  }, 0);
}

async function runDayNightGeneration(payload = {}, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const scan = scanDayNightInputs(payload);
  if (!scan.targetRoot) return { ok: false, error: 'No target art root could be resolved.' };
  if (payload.mode === 'scenario' && !isPathWithinAnyRoot(scan.targetRoot, scan.writableRoots)) {
    return { ok: false, error: 'Refusing to generate art outside the allowed scenario roots.' };
  }
  const generationOptions = normalizeOptions(payload.options || {});
  const requestedFamilies = Array.isArray(payload.families) && payload.families.length > 0
    ? new Set(payload.families.map((value) => String(value || '').toLowerCase()).filter((value) => value === 'terrain' || value === 'districts'))
    : new Set(['terrain', 'districts']);
  if (requestedFamilies.size === 0) return { ok: false, error: 'Choose at least one art family to generate.' };

  const total = Math.max(1, countExpectedGeneratedFiles(scan, requestedFamilies, generationOptions.onlyHour));
  let completed = 0;
  const generatedFiles = [];
  onProgress({
    stage: 'start',
    kind: 'daynight',
    label: 'Generating day-night PCXs with portable JavaScript...',
    completed,
    total
  });

  try {
    for (const root of scan.roots) {
      if (!requestedFamilies.has(root.family)) continue;
      const summerAnnotationDir = path.join(root.root, BASE_SEASON, 'Annotations');
      const summerNoonDir = path.join(root.root, BASE_SEASON, NOON_SUBFOLDER);
      for (const season of root.seasons) {
        ensureSeasonNoonFolder(season.path, summerNoonDir);
        ensureHourFolders(season.path);
        ensureSeasonAnnotations(season.path, summerAnnotationDir);
        const annotationDir = path.join(season.path, 'Annotations');
        copyAnnotationsIntoNoon(season.path, annotationDir);
        const summerAnnotations = path.join(root.root, BASE_SEASON, 'Annotations');
        const sourceFiles = listFileNames(path.join(season.path, NOON_SUBFOLDER))
          .filter((name) => isPcxFileName(name) && !isLightsFileName(name));
        for (const hour of generatedHourFolders(generationOptions.onlyHour)) {
          for (const fileName of sourceFiles) {
            const sourcePath = path.join(season.path, NOON_SUBFOLDER, fileName);
            const annotationName = fileName.replace(/\.pcx$/i, '_lights.pcx');
            const seasonAnnotation = path.join(annotationDir, annotationName);
            const summerAnnotation = path.join(summerAnnotations, annotationName);
            const annotationPath = fileExists(seasonAnnotation) ? seasonAnnotation : (fileExists(summerAnnotation) ? summerAnnotation : '');
            const outPath = path.join(season.path, hour, fileName);
            generateOneFile(sourcePath, annotationPath, outPath, hour, generationOptions);
            generatedFiles.push(outPath);
            completed += 1;
            onProgress({
              stage: 'image',
              kind: 'pcx',
              label: `${getFamilyLabel(root.family)} ${season.name} ${hour}: ${fileName}`,
              path: outPath,
              previewPath: outPath,
              completed,
              total
            });
          }
        }
        cleanupGeneratedLightsFiles(season.path, generationOptions.onlyHour);
      }
    }
    onProgress({
      stage: 'complete',
      kind: 'daynight',
      label: `Generated ${generatedFiles.length} PCX file${generatedFiles.length === 1 ? '' : 's'}.`,
      completed: generatedFiles.length,
      total: generatedFiles.length
    });
    return {
      ok: true,
      targetRoot: scan.targetRoot,
      generatedFiles,
      generatedCount: generatedFiles.length,
      engine: 'javascript'
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Day-night generation failed.' };
  }
}

function copyDirectoryMissingOnly(fromDir, toDir) {
  let copied = 0;
  const visit = (srcDir, rel = '') => {
    fs.mkdirSync(path.join(toDir, rel), { recursive: true });
    fs.readdirSync(srcDir, { withFileTypes: true }).forEach((entry) => {
      const src = path.join(srcDir, entry.name);
      const nextRel = path.join(rel, entry.name);
      const dst = path.join(toDir, nextRel);
      if (entry.isDirectory()) {
        visit(src, nextRel);
      } else if (entry.isFile() && !fileExists(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copied += 1;
      }
    });
  };
  if (dirExists(fromDir)) visit(fromDir);
  return copied;
}

function seedDayNightSourceArt(payload = {}) {
  const context = getScenarioTargetContext(payload);
  if (!context.targetRoot) return { ok: false, error: 'No target art root could be resolved.' };
  if (context.mode === 'scenario' && !isPathWithinAnyRoot(context.targetRoot, context.writableRoots)) {
    return { ok: false, error: 'Refusing to seed art outside the allowed scenario roots.' };
  }
  const requestedFamilies = Array.isArray(payload.families) && payload.families.length > 0
    ? payload.families.map((value) => String(value || '').toLowerCase()).filter((value) => value === 'terrain' || value === 'districts')
    : (payload.districtsEnabled === false ? ['terrain'] : ['terrain', 'districts']);
  const seeded = [];
  requestedFamilies.forEach((family) => {
    const targetRoot = getArtRoot(context.targetRoot, family);
    const sourceRoot = candidateSeedRoots(payload, family, context.targetRoot)[0] || '';
    if (!sourceRoot) return;
    const copied = copyDirectoryMissingOnly(sourceRoot, targetRoot);
    seeded.push({
      family,
      label: getFamilyLabel(family),
      sourceRoot,
      targetRoot,
      copied
    });
  });
  return {
    ok: true,
    targetRoot: context.targetRoot,
    seeded,
    copiedCount: seeded.reduce((sum, entry) => sum + Number(entry.copied || 0), 0)
  };
}

async function previewDayNightImage(payload = {}) {
  const sourcePath = normalizePathText(payload.filePath);
  if (!fileExists(sourcePath)) return { ok: false, error: 'Choose an existing 1200 PCX file.' };
  const hour = normalizeHour(payload.hour || payload.options && payload.options.onlyHour || '1800');
  if (!hour) return { ok: false, error: 'Choose a preview hour.' };
  if (hour === NOON_SUBFOLDER) {
    const decoded = decodePcx(sourcePath);
    return {
      ok: true,
      hour,
      sourcePath,
      width: decoded.width,
      height: decoded.height,
      rgbaBase64: Buffer.from(decoded.rgba).toString('base64')
    };
  }
  const generationOptions = normalizeOptions({ ...(payload.options || {}), onlyHour: hour });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-preview-'));
  try {
    const outPath = path.join(tempRoot, path.basename(sourcePath));
    generateOneFile(sourcePath, normalizePathText(payload.annotationPath), outPath, hour, generationOptions);
    const decoded = decodePcx(outPath);
    return {
      ok: true,
      hour,
      sourcePath: outPath,
      width: decoded.width,
      height: decoded.height,
      rgbaBase64: Buffer.from(decoded.rgba).toString('base64')
    };
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_err) {}
  }
}

function getPcxFilePreview(filePath) {
  const sourcePath = normalizePathText(filePath);
  if (!fileExists(sourcePath)) return { ok: false, error: 'PCX file not found.' };
  const decoded = decodePcx(sourcePath);
  return {
    ok: true,
    sourcePath,
    width: decoded.width,
    height: decoded.height,
    rgbaBase64: Buffer.from(decoded.rgba).toString('base64')
  };
}

module.exports = {
  SCRIPT_DEFAULTS,
  LIGHT_KEYS,
  LIGHT_STYLES,
  scanDayNightInputs,
  runDayNightGeneration,
  previewDayNightImage,
  getPcxFilePreview,
  seedDayNightSourceArt,
  normalizeOptions,
  getScenarioTargetContext,
  inspectToolchain,
  generatedHourFolders
};
