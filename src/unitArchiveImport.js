const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const yauzl = require('yauzl');
const { decodePcx, encodePcx } = require('./artPreview');

const SUPPORTED_EXTENSIONS = new Set([
  '.amb',
  '.flc',
  '.gif',
  '.ini',
  '.jpg',
  '.jpeg',
  '.mp3',
  '.pcx',
  '.png',
  '.txt',
  '.wav'
]);

const UNIT_ACTION_KEYS = [
  'DEFAULT',
  'WALK',
  'RUN',
  'ATTACK1',
  'ATTACK2',
  'ATTACK3',
  'DEFEND',
  'DEATH',
  'DEAD',
  'FORTIFY',
  'FORTIFYHOLD',
  'FIDGET',
  'VICTORY',
  'TURNLEFT',
  'TURNRIGHT',
  'BUILD',
  'ROAD',
  'MINE',
  'IRRIGATE',
  'FORTRESS',
  'CAPTURE',
  'JUNGLE',
  'FOREST',
  'STOP_AT_LAST_FRAME'
];

const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 600 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 5000;
const UNIT_ATLAS_SPRITE_SIZE = 32;
const UNIT_ATLAS_GUTTER = 1;
const UNIT_ATLAS_MAGENTA = [255, 0, 255];

function toSlashPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeMemberPath(value) {
  return toSlashPath(value).replace(/^\/+/, '').replace(/^\.\//, '');
}

function isUnsafeMemberPath(value) {
  const raw = String(value || '');
  const normalized = normalizeMemberPath(raw);
  if (!normalized || /[\x00-\x1f]/.test(normalized)) return true;
  if (raw.startsWith('/') || raw.startsWith('\\')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return true;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..')) return true;
  if (parts.some((part) => /^[a-zA-Z]:$/.test(part))) return true;
  return false;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeTargetPath(root, relPath) {
  const normalized = normalizeMemberPath(relPath);
  if (isUnsafeMemberPath(normalized)) return null;
  const target = path.resolve(root, ...normalized.split('/').filter(Boolean));
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(`${rootResolved}${path.sep}`)) return null;
  return target;
}

function getExt(filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
}

function baseName(filePath) {
  return normalizeMemberPath(filePath).split('/').pop() || '';
}

function dirName(filePath) {
  const normalized = normalizeMemberPath(filePath);
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx) : '';
}

function stripExt(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/i, '');
}

function isAllowedAsset(filePath) {
  return SUPPORTED_EXTENSIONS.has(getExt(filePath));
}

function sanitizeUnitFolderName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || 'Imported Unit';
}

function parseIniSections(text) {
  const sections = {};
  let current = '';
  String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) return;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      current = String(section[1] || '').trim().toLowerCase();
      if (!sections[current]) sections[current] = {};
      return;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || !current) return;
    const key = line.slice(0, eq).trim().toUpperCase();
    if (!key) return;
    sections[current][key] = line.slice(eq + 1).trim();
  });
  return sections;
}

function scorePcxName(filePath, unitName, kind) {
  const name = baseName(filePath).toLowerCase();
  const unit = String(unitName || '').toLowerCase();
  if (kind === 'unit32') {
    if (name === 'unit32.pcx' || name === 'units_32.pcx') return 40;
    if (/\bunit\s*32\b/i.test(name) || /32\.pcx$/i.test(name)) return 30;
    return name.includes('32') ? 10 : 0;
  }
  if (kind === 'large') {
    if (name.includes('128')) return 25;
    if (name.includes('_lg') || name.includes(' lg') || name.includes('large')) return 30;
    return unit && name.includes(unit) ? 5 : 0;
  }
  if (kind === 'small') {
    if (name.includes('_32') || /32\.pcx$/i.test(name)) return 22;
    if (name.includes('_sm') || name.includes(' sm') || name.includes('small')) return 30;
    return unit && name.includes(unit) ? 5 : 0;
  }
  return 0;
}

function pickBestPcx(files, unitName, kind) {
  return files
    .filter((file) => getExt(file) === '.pcx')
    .map((file) => ({ file, score: scorePcxName(file, unitName, kind) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length)[0]?.file || '';
}

function findPaletteColorIndex(palette, rgb) {
  if (!palette || palette.length < 768) return -1;
  for (let i = 0; i < 256; i += 1) {
    const off = i * 3;
    if (palette[off] === rgb[0] && palette[off + 1] === rgb[1] && palette[off + 2] === rgb[2]) return i;
  }
  return -1;
}

function makeOneCellUnitAtlasBuffer(sourceBuffer) {
  const decoded = decodePcx(sourceBuffer, { returnIndexed: true, transparentIndexes: [] });
  if (!decoded || !decoded.indices || !decoded.palette) return sourceBuffer;
  const stride = UNIT_ATLAS_SPRITE_SIZE + UNIT_ATLAS_GUTTER;
  const cols = decoded.width >= UNIT_ATLAS_GUTTER + UNIT_ATLAS_SPRITE_SIZE
    ? Math.floor((decoded.width - UNIT_ATLAS_GUTTER) / stride)
    : 0;
  const rows = decoded.height >= UNIT_ATLAS_GUTTER + UNIT_ATLAS_SPRITE_SIZE
    ? Math.floor((decoded.height - UNIT_ATLAS_GUTTER) / stride)
    : 0;
  if (cols >= 1 && rows >= 1) return sourceBuffer;
  if (decoded.width < UNIT_ATLAS_SPRITE_SIZE || decoded.height < UNIT_ATLAS_SPRITE_SIZE) return sourceBuffer;
  let magentaIndex = findPaletteColorIndex(decoded.palette, UNIT_ATLAS_MAGENTA);
  if (magentaIndex < 0) magentaIndex = 255;
  const width = UNIT_ATLAS_SPRITE_SIZE + UNIT_ATLAS_GUTTER;
  const height = UNIT_ATLAS_SPRITE_SIZE + UNIT_ATLAS_GUTTER;
  const indices = new Uint8Array(width * height);
  indices.fill(magentaIndex);
  for (let y = 0; y < UNIT_ATLAS_SPRITE_SIZE; y += 1) {
    const srcY = Math.min(decoded.height - UNIT_ATLAS_SPRITE_SIZE, 0) + y;
    const srcOff = srcY * decoded.width;
    const dstOff = (y + UNIT_ATLAS_GUTTER) * width + UNIT_ATLAS_GUTTER;
    for (let x = 0; x < UNIT_ATLAS_SPRITE_SIZE; x += 1) {
      indices[dstOff + x] = decoded.indices[srcOff + x];
    }
  }
  const palette = Buffer.from(decoded.palette);
  if (findPaletteColorIndex(palette, UNIT_ATLAS_MAGENTA) < 0) {
    palette[255 * 3] = 255;
    palette[255 * 3 + 1] = 0;
    palette[255 * 3 + 2] = 255;
  }
  return encodePcx(indices, palette, width, height);
}

function findCaseInsensitiveFile(files, unitDir, relPath) {
  const wantedBase = baseName(relPath).toLowerCase();
  const wantedRel = normalizeMemberPath(relPath).toLowerCase();
  const inTree = files.filter((file) => {
    const normalized = normalizeMemberPath(file);
    return !unitDir || normalized === unitDir || normalized.startsWith(`${unitDir}/`);
  });
  return inTree.find((file) => normalizeMemberPath(file).toLowerCase().endsWith(`/${wantedRel}`))
    || inTree.find((file) => baseName(file).toLowerCase() === wantedBase)
    || '';
}

function editDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const prev = new Array(right.length + 1);
  const curr = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) prev[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
  }
  return prev[right.length];
}

function findNearFileName(files, relPath) {
  const wanted = stripExt(baseName(relPath)).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!wanted) return '';
  return files
    .filter((file) => getExt(file) === '.flc')
    .map((file) => {
      const candidate = stripExt(baseName(file)).toLowerCase().replace(/[^a-z0-9]/g, '');
      return { file, distance: editDistance(wanted, candidate) };
    })
    .filter((item) => item.distance <= 2)
    .sort((a, b) => a.distance - b.distance || a.file.length - b.file.length)[0]?.file || '';
}

function buildUnitCandidate({ archivePath, archiveId, files, iniPath, iniText }) {
  const unitDir = dirName(iniPath);
  const rawUnitName = baseName(unitDir) || stripExt(baseName(iniPath));
  const unitName = sanitizeUnitFolderName(rawUnitName);
  const treeFiles = files.filter((file) => {
    const normalized = normalizeMemberPath(file);
    return unitDir ? (normalized === unitDir || normalized.startsWith(`${unitDir}/`)) : !normalized.includes('/');
  });
  const sections = parseIniSections(iniText);
  const animationFields = sections.animations || {};
  const timingFields = sections.timing || {};
  const soundFields = sections['sound effects'] || {};
  const actions = [];
  const warnings = [];
  const suggestions = [];
	  UNIT_ACTION_KEYS.forEach((key) => {
	    const rawFlc = String(animationFields[key] || '').trim();
	    const rawSound = String(soundFields[key] || '').trim();
	    const foundFile = rawFlc ? findCaseInsensitiveFile(treeFiles, unitDir, rawFlc) : '';
	    const foundSoundFile = rawSound ? findCaseInsensitiveFile(treeFiles, unitDir, rawSound) : '';
	    const exists = !!foundFile;
    if (rawFlc && !exists) {
      const near = findNearFileName(treeFiles, rawFlc);
      if (near) {
        suggestions.push({ action: key, missing: rawFlc, suggested: baseName(near) });
        warnings.push(`${key} references ${rawFlc}, but the archive contains ${baseName(near)}.`);
      } else {
        warnings.push(`${key} references ${rawFlc}, but that FLC was not found.`);
      }
    }
    if (rawFlc) {
      actions.push({
        key,
        relativePath: rawFlc,
	        soundPath: rawSound,
	        timingSeconds: Number.isFinite(Number(timingFields[key])) ? Number(timingFields[key]) : null,
	        found: exists,
	        archivePath: foundFile,
	        soundArchivePath: foundSoundFile
	      });
	    }
	  });
  const unit32 = pickBestPcx(treeFiles, unitName, 'unit32');
  const large = pickBestPcx(treeFiles, unitName, 'large');
  const small = pickBestPcx(treeFiles, unitName, 'small');
  if (!unit32) warnings.push('No units_32 PCX candidate was found.');
  if (!large) warnings.push('No Civilopedia large PCX candidate was found.');
  if (!small) warnings.push('No Civilopedia small PCX candidate was found.');
  const referencedFlc = new Set(actions.map((action) => baseName(action.archivePath || action.relativePath).toLowerCase()).filter(Boolean));
  const extraFlcFiles = treeFiles
    .filter((file) => getExt(file) === '.flc' && !referencedFlc.has(baseName(file).toLowerCase()))
    .map((file) => normalizeMemberPath(file));
  if (extraFlcFiles.length > 0) warnings.push(`${extraFlcFiles.length} extra FLC file${extraFlcFiles.length === 1 ? '' : 's'} not referenced by the INI.`);
  const previewImage = treeFiles.find((file) => ['.gif', '.png', '.jpg', '.jpeg'].includes(getExt(file))) || '';
  return {
    id: crypto.createHash('sha1').update(`${archivePath}\0${iniPath}`).digest('hex').slice(0, 16),
    archiveId,
    archivePath,
    unitName,
    animationName: unitName,
    sourceIniPath: iniPath,
    sourceIniText: iniText,
    sourceUnitDir: unitDir,
    fileCount: treeFiles.length,
    flcCount: treeFiles.filter((file) => getExt(file) === '.flc').length,
    pcxCount: treeFiles.filter((file) => getExt(file) === '.pcx').length,
    unit32Source: unit32,
    largeSource: large,
    smallSource: small,
    previewImageSource: previewImage,
    actions,
    warnings,
    suggestions,
    extraFlcFiles,
    treeFiles
  };
}

function openZip(pathname) {
  return new Promise((resolve, reject) => {
    yauzl.open(pathname, { lazyEntries: true, decodeStrings: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile);
    });
  });
}

function readZipEntry(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function loadZipArchive(archivePath) {
  const zipfile = await openZip(archivePath);
  return new Promise((resolve, reject) => {
    const entries = [];
    const dataByPath = new Map();
    let count = 0;
    let total = 0;
    zipfile.on('entry', async (entry) => {
      try {
        count += 1;
        if (count > MAX_ARCHIVE_FILES) throw new Error('Archive has too many files.');
        const name = normalizeMemberPath(entry.fileName);
        const directory = /\/$/.test(name);
        if (!directory && isUnsafeMemberPath(name)) throw new Error(`Unsafe archive path: ${entry.fileName}`);
        if (!directory) {
          total += Number(entry.uncompressedSize || 0);
          if (total > MAX_EXTRACTED_BYTES) throw new Error('Archive expands beyond the import safety limit.');
          entries.push({ name, directory, size: Number(entry.uncompressedSize || 0) });
          if (isAllowedAsset(name)) {
            dataByPath.set(name, await readZipEntry(zipfile, entry));
          }
        }
        zipfile.readEntry();
      } catch (err) {
        zipfile.close();
        reject(err);
      }
    });
    zipfile.on('error', reject);
    zipfile.on('end', () => resolve({ entries, dataByPath }));
    zipfile.readEntry();
  });
}

async function loadRarArchive(archivePath) {
  const unrar = require('node-unrar-js');
  const data = Uint8Array.from(fs.readFileSync(archivePath)).buffer;
  const extractor = await unrar.createExtractorFromData({ data });
  const list = extractor.getFileList();
  const headers = Array.from(list.fileHeaders);
  if (headers.length > MAX_ARCHIVE_FILES) throw new Error('Archive has too many files.');
  let total = 0;
  const entries = [];
  const extractNames = [];
  headers.forEach((header) => {
    const name = normalizeMemberPath(header.name);
    const directory = !!(header.flags && header.flags.directory);
    if (!directory && isUnsafeMemberPath(name)) throw new Error(`Unsafe archive path: ${header.name}`);
    if (!directory) {
      total += Number(header.unpSize || 0);
      if (total > MAX_EXTRACTED_BYTES) throw new Error('Archive expands beyond the import safety limit.');
      entries.push({ name, directory, size: Number(header.unpSize || 0) });
      if (isAllowedAsset(name)) extractNames.push(name);
    }
  });
  const extracted = extractor.extract({ files: extractNames });
  const files = Array.from(extracted.files);
  const dataByPath = new Map();
  files.forEach((file) => {
    const name = normalizeMemberPath(file.fileHeader && file.fileHeader.name);
    if (!name || !file.extraction) return;
    dataByPath.set(name, Buffer.from(file.extraction));
  });
  return { entries, dataByPath };
}

async function loadLibarchiveArchive(archivePath) {
  const { Archive } = await import('libarchive.js/dist/libarchive-node.mjs');
  const defaultOptions = Archive._options || {};
  const workerPath = path.join(__dirname, '..', 'node_modules', 'libarchive.js', 'dist', 'worker-bundle-node.mjs');
  Archive.init({
    ...defaultOptions,
    getWorker: () => new Worker(pathToFileURL(workerPath), { type: 'module' })
  });
  const buffer = fs.readFileSync(archivePath);
  const archive = await Archive.open(new File([buffer], path.basename(archivePath)));
  try {
    const extractedTree = await archive.extractFiles();
    const listed = [];
    const visit = (node, prefix = '') => {
      if (!node || typeof node !== 'object') return;
      Object.entries(node).forEach(([name, value]) => {
        if (value instanceof File) {
          listed.push({ file: value, path: prefix });
        } else {
          visit(value, `${prefix}${name}/`);
        }
      });
    };
    visit(extractedTree);
    if (listed.length > MAX_ARCHIVE_FILES) throw new Error('Archive has too many files.');
    let total = 0;
    const entries = [];
    const dataByPath = new Map();
    for (const item of listed) {
      const file = item && item.file;
      if (!file || !file.name) continue;
      const name = normalizeMemberPath(`${String(item.path || '')}${String(file.name || '')}`);
      if (isUnsafeMemberPath(name)) throw new Error(`Unsafe archive path: ${name}`);
      total += Number(file.size || 0);
      if (total > MAX_EXTRACTED_BYTES) throw new Error('Archive expands beyond the import safety limit.');
      entries.push({ name, directory: false, size: Number(file.size || 0) });
      if (!isAllowedAsset(name)) continue;
      const arrayBuffer = await file.arrayBuffer();
      dataByPath.set(name, Buffer.from(arrayBuffer));
    }
    return { entries, dataByPath };
  } finally {
    if (archive && typeof archive.close === 'function') await archive.close().catch(() => {});
  }
}

function listFilesRecursiveSafe(root) {
  const out = [];
  const rootResolved = path.resolve(root);
  const stack = [''];
  while (stack.length > 0) {
    const relDir = stack.pop();
    const absDir = path.join(rootResolved, relDir);
    let entries = [];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (_err) {
      continue;
    }
    entries.forEach((entry) => {
      if (!entry || entry.isSymbolicLink()) return;
      const rel = normalizeMemberPath(path.join(relDir, entry.name));
      if (isUnsafeMemberPath(rel)) return;
      if (entry.isDirectory()) {
        stack.push(rel);
      } else if (entry.isFile()) {
        out.push({ rel, abs: path.join(rootResolved, rel) });
      }
    });
  }
  return out;
}

async function loadFolderSource(folderPath) {
  const root = String(folderPath || '').trim();
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error('Selected path is not a folder.');
  const found = listFilesRecursiveSafe(root);
  if (found.length > MAX_ARCHIVE_FILES) throw new Error('Folder has too many files.');
  let total = 0;
  const entries = [];
  const dataByPath = new Map();
  for (const item of found) {
    let size = 0;
    try {
      size = fs.statSync(item.abs).size;
    } catch (_err) {
      size = 0;
    }
    total += Number(size || 0);
    if (total > MAX_EXTRACTED_BYTES) throw new Error('Folder contents exceed the import safety limit.');
    entries.push({ name: item.rel, directory: false, size });
    if (isAllowedAsset(item.rel)) {
      dataByPath.set(item.rel, fs.readFileSync(item.abs));
    }
  }
  return { entries, dataByPath };
}

function writeStagedCandidate(candidate, dataByPath, stagingBase) {
  const candidateRoot = path.join(stagingBase, candidate.id);
  const stagedUnitDir = path.join(candidateRoot, 'Art', 'Units', candidate.animationName);
  const stagedChoiceDir = path.join(candidateRoot, 'Art', 'Units', '__unit32_choices__');
  ensureDir(stagedUnitDir);
  const unitDir = candidate.sourceUnitDir;
  const stagedBySource = new Map();
  const stageFile = (sourcePath, relOverride = '') => {
    const normalized = normalizeMemberPath(sourcePath);
    const data = dataByPath.get(normalized);
    if (!data || !isAllowedAsset(normalized)) return '';
    const relWithinUnit = relOverride || (unitDir && normalized.startsWith(`${unitDir}/`)
      ? normalized.slice(unitDir.length + 1)
      : baseName(normalized));
    const target = safeTargetPath(stagedUnitDir, relWithinUnit);
    if (!target) return '';
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, data);
    stagedBySource.set(normalized, target);
    return target;
  };
  candidate.treeFiles.forEach((sourcePath) => {
    stageFile(sourcePath);
  });
  const sourceIniData = dataByPath.get(normalizeMemberPath(candidate.sourceIniPath));
  if (sourceIniData) {
    fs.writeFileSync(path.join(stagedUnitDir, `${candidate.animationName}.ini`), sourceIniData);
  }
  const makeUnit32Choice = (sourcePath) => {
    const normalized = normalizeMemberPath(sourcePath);
    if (!normalized) return '';
    const data = dataByPath.get(normalized);
    if (!data) return '';
    const choiceName = `${crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 10)}-${baseName(normalized)}`;
    const target = path.join(stagedChoiceDir, choiceName);
    ensureDir(path.dirname(target));
    try {
      fs.writeFileSync(target, makeOneCellUnitAtlasBuffer(data));
    } catch (_err) {
      fs.writeFileSync(target, data);
    }
    return target;
  };
  const unit32Path = candidate.unit32Source
    ? (() => {
      const data = dataByPath.get(normalizeMemberPath(candidate.unit32Source));
      if (!data) return '';
      const target = path.join(candidateRoot, 'Art', 'Units', 'units_32.pcx');
      ensureDir(path.dirname(target));
      try {
        fs.writeFileSync(target, makeOneCellUnitAtlasBuffer(data));
      } catch (_err) {
        fs.writeFileSync(target, data);
      }
      return target;
    })()
    : '';
  const pcxFiles = candidate.treeFiles
    .filter((file) => getExt(file) === '.pcx')
    .map((file) => {
      const normalized = normalizeMemberPath(file);
      const stagedPath = stagedBySource.get(normalized) || path.join(stagedUnitDir, baseName(normalized));
      return {
        sourcePath: normalized,
        fileName: baseName(normalized),
        stagedPath,
        targetPath: `Art/Units/${candidate.animationName}/${baseName(normalized)}`,
        unit32AtlasPath: makeUnit32Choice(normalized),
        recommendedLarge: normalized === normalizeMemberPath(candidate.largeSource),
        recommendedSmall: normalized === normalizeMemberPath(candidate.smallSource),
        recommendedUnit32: normalized === normalizeMemberPath(candidate.unit32Source)
      };
    });
  const flcFiles = candidate.treeFiles
    .filter((file) => getExt(file) === '.flc')
    .map((file) => {
      const normalized = normalizeMemberPath(file);
      return {
        sourcePath: normalized,
        fileName: baseName(normalized),
        relativePath: baseName(normalized),
        stagedPath: stagedBySource.get(normalized) || path.join(stagedUnitDir, baseName(normalized))
      };
    });
  const soundFiles = candidate.treeFiles
    .filter((file) => ['.amb', '.mp3', '.wav'].includes(getExt(file)))
    .map((file) => {
      const normalized = normalizeMemberPath(file);
      return {
        sourcePath: normalized,
        fileName: baseName(normalized),
        relativePath: baseName(normalized),
        stagedPath: stagedBySource.get(normalized) || path.join(stagedUnitDir, baseName(normalized))
      };
    });
  const usedSources = new Set([
    normalizeMemberPath(candidate.sourceIniPath),
    normalizeMemberPath(candidate.largeSource),
	    normalizeMemberPath(candidate.smallSource),
	    normalizeMemberPath(candidate.unit32Source),
    ...candidate.actions.map((action) => normalizeMemberPath(action.archivePath || '')),
    ...candidate.actions.map((action) => normalizeMemberPath(action.soundArchivePath || ''))
	  ].filter(Boolean));
  const unusedFiles = candidate.treeFiles
    .map((file) => normalizeMemberPath(file))
    .filter((file) => file && !usedSources.has(file))
    .map((file) => ({
      sourcePath: file,
      fileName: baseName(file),
      ext: getExt(file).replace(/^\./, '').toUpperCase() || 'FILE',
      stagedPath: stagedBySource.get(file) || ''
    }));
  return {
    ...candidate,
    stagedScenarioRoot: candidateRoot,
    stagedUnitFolder: stagedUnitDir,
    stagedAnimationName: candidate.animationName,
    stagedIniPath: path.join(stagedUnitDir, `${candidate.animationName}.ini`),
    stagedUnit32Path: unit32Path,
    stagedLargePath: candidate.largeSource ? path.join(stagedUnitDir, baseName(candidate.largeSource)) : '',
    stagedSmallPath: candidate.smallSource ? path.join(stagedUnitDir, baseName(candidate.smallSource)) : '',
    targetLargePath: candidate.largeSource ? `Art/Units/${candidate.animationName}/${baseName(candidate.largeSource)}` : '',
    targetSmallPath: candidate.smallSource ? `Art/Units/${candidate.animationName}/${baseName(candidate.smallSource)}` : '',
    pcxFiles,
    flcFiles,
    soundFiles,
    unusedFiles
  };
}

async function loadArchive(archivePath) {
  const ext = getExt(archivePath);
  if (ext === '.zip') return loadZipArchive(archivePath);
  if (ext === '.rar') return loadRarArchive(archivePath);
  if (ext === '.7z') return loadLibarchiveArchive(archivePath);
  throw new Error(`${ext || 'Archive'} files are not supported yet.`);
}

async function scanUnitImportSources(sourcePaths, options = {}) {
  const paths = Array.isArray(sourcePaths) ? sourcePaths : [];
  const stagingRoot = String(options.stagingRoot || path.join(os.tmpdir(), 'c3x-unit-import-staging')).trim();
  ensureDir(stagingRoot);
  const batchRoot = path.join(stagingRoot, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  ensureDir(batchRoot);
  const archives = [];
  const candidates = [];
  for (const sourcePathRaw of paths) {
    const sourcePath = String(sourcePathRaw || '').trim();
    if (!sourcePath) continue;
    const archiveId = crypto.createHash('sha1').update(sourcePath).digest('hex').slice(0, 12);
    const archiveResult = {
      id: archiveId,
      path: sourcePath,
      fileName: path.basename(sourcePath),
      sourceType: 'archive',
      ok: false,
      warnings: [],
      candidates: []
    };
    try {
      const stat = fs.statSync(sourcePath);
      let loaded = null;
      if (stat.isDirectory()) {
        archiveResult.sourceType = 'folder';
        loaded = await loadFolderSource(sourcePath);
      } else {
        if (!stat.isFile()) throw new Error('Not a file or folder.');
        if (stat.size > MAX_ARCHIVE_BYTES) throw new Error('Archive is larger than the import safety limit.');
        loaded = await loadArchive(sourcePath);
      }
      const files = loaded.entries.filter((entry) => !entry.directory).map((entry) => entry.name);
      const iniFiles = files.filter((file) => getExt(file) === '.ini');
      const rawCandidates = [];
      iniFiles.forEach((iniPath) => {
        const data = loaded.dataByPath.get(normalizeMemberPath(iniPath));
        if (!data) return;
        const iniText = data.toString('latin1');
        const sections = parseIniSections(iniText);
        if (!sections.animations) return;
        rawCandidates.push(buildUnitCandidate({ archivePath: sourcePath, archiveId, files, iniPath, iniText }));
      });
      const archiveStageRoot = path.join(batchRoot, archiveId);
      ensureDir(archiveStageRoot);
      rawCandidates.forEach((candidate) => {
        const staged = writeStagedCandidate(candidate, loaded.dataByPath, archiveStageRoot);
        archiveResult.candidates.push(staged);
        candidates.push(staged);
      });
      archiveResult.ok = true;
      if (rawCandidates.length === 0) archiveResult.warnings.push('No Civ3 unit INI files were found.');
    } catch (err) {
      archiveResult.error = err && err.message ? err.message : String(err || 'Could not read archive.');
      archiveResult.warnings.push(archiveResult.error);
    }
    archives.push(archiveResult);
  }
  return {
    ok: true,
    stagingRoot: batchRoot,
    archives,
    candidates
  };
}

module.exports = {
  scanUnitArchives: scanUnitImportSources,
  scanUnitImportSources,
  parseIniSections,
  isUnsafeMemberPath
};
