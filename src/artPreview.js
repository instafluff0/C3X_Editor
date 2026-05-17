const fs = require('node:fs');
const path = require('node:path');
const log = require('./log');

const CHUNK_FRAME = 0xF1FA;
const CHUNK_COLOR_256 = 4;
const CHUNK_DELTA_FLC = 7;
const CHUNK_DELTA_FLI = 12;
const CHUNK_BLACK = 13;
const CHUNK_BYTE_RUN = 15;
const CHUNK_FLI_COPY = 16;
const CHUNK_LITERAL = 16;

function u16(buf, off) {
  return buf.readUInt16LE(off);
}

function u32(buf, off) {
  return buf.readUInt32LE(off);
}

function s8(v) {
  return v > 127 ? v - 256 : v;
}

function s16(buf, off) {
  return buf.readInt16LE(off);
}

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch (_err) {
    return false;
  }
}

function decodePcx(filePathOrBuffer, options = {}) {
  const srcLabel = Buffer.isBuffer(filePathOrBuffer) ? '<buffer>' : log.rel(filePathOrBuffer);
  const b = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer);
  if (b.length < 128) { log.warn('decodePcx', `${srcLabel}: too small (${b.length} bytes)`); throw new Error('PCX too small'); }
  if (b[0] !== 10) { log.warn('decodePcx', `${srcLabel}: bad magic byte 0x${b[0].toString(16)} (expected 0x0A)`); throw new Error('Not a PCX file'); }
  if (b[2] !== 1) { log.warn('decodePcx', `${srcLabel}: unsupported encoding byte ${b[2]} (expected 1 for RLE)`); throw new Error('Unsupported PCX encoding'); }

  const bitsPerPixel = b[3];
  const xMin = u16(b, 4);
  const yMin = u16(b, 6);
  const xMax = u16(b, 8);
  const yMax = u16(b, 10);
  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  const planes = b[65];
  const bytesPerLine = u16(b, 66);

  if (bitsPerPixel === 8 && planes === 3) {
    const dataEnd = b.length;
    let src = 128;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      const planeRows = [
        new Uint8Array(bytesPerLine),
        new Uint8Array(bytesPerLine),
        new Uint8Array(bytesPerLine)
      ];
      for (let plane = 0; plane < 3; plane += 1) {
        let rowWritten = 0;
        while (rowWritten < bytesPerLine && src < dataEnd) {
          const v = b[src++];
          if ((v & 0xc0) === 0xc0) {
            const run = v & 0x3f;
            const val = src < dataEnd ? b[src++] : 0;
            const n = Math.min(run, bytesPerLine - rowWritten);
            planeRows[plane].fill(val, rowWritten, rowWritten + n);
            rowWritten += n;
          } else {
            planeRows[plane][rowWritten++] = v;
          }
        }
      }
      for (let x = 0; x < width; x += 1) {
        const out = (y * width + x) * 4;
        rgba[out] = planeRows[0][x];
        rgba[out + 1] = planeRows[1][x];
        rgba[out + 2] = planeRows[2][x];
        rgba[out + 3] = 255;
      }
    }
    return { width, height, rgba, trueColor: true };
  }

  if (!(bitsPerPixel === 8 && planes === 1)) {
    log.warn('decodePcx', `${srcLabel}: unsupported format — bitsPerPixel=${bitsPerPixel}, planes=${planes} (expected 8-bit 1-plane indexed or 8-bit 3-plane truecolor)`);
    throw new Error('Only 8-bit indexed or 24-bit truecolor PCX supported');
  }

  if (b.length < 769 || b[b.length - 769] !== 12) {
    log.warn('decodePcx', `${srcLabel}: missing 256-color palette marker (file length=${b.length})`);
    throw new Error('Missing PCX 256-color palette');
  }
  const palette = b.slice(b.length - 768);

  const dataEnd = b.length - 769;
  const indices = new Uint8Array(width * height);
  let src = 128;
  let out = 0;

  for (let y = 0; y < height; y += 1) {
    let rowWritten = 0;
    const rowBuf = new Uint8Array(bytesPerLine);
    while (rowWritten < bytesPerLine && src < dataEnd) {
      const v = b[src++];
      if ((v & 0xc0) === 0xc0) {
        const run = v & 0x3f;
        const val = src < dataEnd ? b[src++] : 0;
        const n = Math.min(run, bytesPerLine - rowWritten);
        rowBuf.fill(val, rowWritten, rowWritten + n);
        rowWritten += n;
      } else {
        rowBuf[rowWritten++] = v;
      }
    }

    for (let x = 0; x < width; x += 1) {
      indices[out++] = rowBuf[x];
    }
  }

  const transparentIndexes = Array.isArray(options.transparentIndexes)
    ? options.transparentIndexes
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => Number.isFinite(v) && v >= 0 && v <= 255)
    : [254, 255];
  const transparentSet = new Set(transparentIndexes);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < indices.length; i += 1) {
    const idx = indices[i];
    rgba[i * 4] = palette[idx * 3];
    rgba[i * 4 + 1] = palette[idx * 3 + 1];
    rgba[i * 4 + 2] = palette[idx * 3 + 2];
    // Civ3 convention defaults to 254/255; specific files (e.g. Territory.pcx) use different slots.
    rgba[i * 4 + 3] = transparentSet.has(idx) ? 0 : 255;
  }

  if (options.returnIndexed) {
    return { width, height, rgba, indices, palette };
  }
  return { width, height, rgba };
}

function decodeColor256(payload, palette) {
  if (payload.length < 2) return;
  const packets = u16(payload, 0);
  let p = 2;
  let idx = 0;
  for (let n = 0; n < packets; n += 1) {
    if (p + 2 > payload.length) break;
    const skip = payload[p++];
    let count = payload[p++];
    idx += skip;
    if (count === 0) count = 256;
    for (let i = 0; i < count; i += 1) {
      if (p + 3 > payload.length || idx >= 256) break;
      palette[idx * 3] = payload[p++];
      palette[idx * 3 + 1] = payload[p++];
      palette[idx * 3 + 2] = payload[p++];
      idx += 1;
    }
  }
}

function decodeByteRun(payload, w, h) {
  const out = new Uint8Array(w * h);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    if (p >= payload.length) break;
    p += 1; // packet count byte
    let x = 0;
    const rowOff = y * w;
    while (x < w && p < payload.length) {
      const n = s8(payload[p++]);
      if (n >= 0) {
        if (p >= payload.length) break;
        const b = payload[p++];
        const run = Math.min(n, w - x);
        out.fill(b, rowOff + x, rowOff + x + run);
        x += run;
      } else {
        const run = Math.min(-n, w - x, payload.length - p);
        out.set(payload.subarray(p, p + run), rowOff + x);
        p += run;
        x += run;
      }
    }
  }
  return out;
}

function decodeDeltaFli(payload, frame, w, h) {
  if (payload.length < 4) return;
  let y = payload.readUInt16LE(0);
  let lines = payload.readUInt16LE(2);
  let p = 4;
  while (lines > 0 && y < h && p < payload.length) {
    const packets = payload[p++];
    let x = 0;
    const rowOff = y * w;
    for (let i = 0; i < packets; i += 1) {
      if (p + 2 > payload.length) break;
      x += payload[p++];
      const n = s8(payload[p++]);
      if (n >= 0) {
        const cnt = n;
        const avail = Math.min(cnt, payload.length - p);
        const write = Math.min(avail, Math.max(0, w - x));
        if (write > 0) {
          frame.set(payload.subarray(p, p + write), rowOff + x);
          x += write;
        }
        p += avail;
        x += Math.max(0, cnt - write);
      } else {
        if (p >= payload.length) break;
        const b = payload[p++];
        const run = Math.min(-n, w - x);
        frame.fill(b, rowOff + x, rowOff + x + run);
        x += run;
      }
    }
    y += 1;
    lines -= 1;
  }
}

function decodeDeltaFlc(payload, frame, w, h) {
  if (payload.length < 2) return;
  let lines = payload.readUInt16LE(0);
  let p = 2;
  let y = 0;
  while (lines > 0 && y < h && p + 2 <= payload.length) {
    const op = s16(payload, p);
    p += 2;
    if (op < 0) {
      const flag = op & 0xc000;
      if (flag === 0xc000) {
        y += -op;
        continue;
      }
      if (flag === 0x8000) {
        if (w > 0 && y < h) frame[y * w + (w - 1)] = op & 0xff;
        continue;
      }
      continue;
    }

    const packets = op;
    let x = 0;
    const rowOff = y * w;
    for (let i = 0; i < packets; i += 1) {
      if (p + 2 > payload.length) break;
      x += payload[p++];
      const n = s8(payload[p++]);
      if (n >= 0) {
        const cnt = n * 2;
        const avail = Math.min(cnt, payload.length - p);
        const write = Math.min(avail, Math.max(0, w - x));
        if (write > 0) {
          frame.set(payload.subarray(p, p + write), rowOff + x);
          x += write;
        }
        p += avail;
        x += Math.max(0, cnt - write);
      } else {
        if (p + 2 > payload.length) break;
        const b0 = payload[p++];
        const b1 = payload[p++];
        const reps = -n;
        for (let r = 0; r < reps; r += 1) {
          if (x + 1 >= w) break;
          frame[rowOff + x] = b0;
          frame[rowOff + x + 1] = b1;
          x += 2;
        }
      }
    }
    y += 1;
    lines -= 1;
  }
}

function decodeFlcFrames(filePath, maxFrames = null, options = {}) {
  const b = fs.readFileSync(filePath);
  if (b.length < 128) { log.warn('decodeFlc', `${log.rel(filePath)}: too small (${b.length} bytes)`); throw new Error('FLC too small'); }

  const magic = u16(b, 4);
  const w = u16(b, 8);
  const h = u16(b, 10);
  const depth = u16(b, 12);
  const headerFrameCount = u16(b, 6);
  const speedRaw = u32(b, 16);
  // Civ3 FlicAnimHeader at byte 88 (reserved3): num_anims at +8, anim_length at +10.
  const civ3NumAnims = b.length >= 98 ? u16(b, 96) : 0;
  const civ3AnimLength = b.length >= 100 ? u16(b, 98) : 0;
  // Clamp directionIndex to available directions so single-direction FLCs still yield a frame.
  const safeDir = (options.directionIndex > 0 && civ3NumAnims > 1)
    ? Math.min(options.directionIndex, civ3NumAnims - 1)
    : 0;
  // Each direction block = anim_length animation frames + 1 ring frame = (anim_length + 1) total.
  // Using anim_length alone undershoots by `safeDir` frames (one ring frame per skipped direction).
  const startFrame = (safeDir > 0 && civ3AnimLength > 0)
    ? (civ3AnimLength + 1) * safeDir
    : 0;
  // FLC (0xAF12) uses milliseconds; legacy FLI (0xAF11) uses 1/70s ticks.
  const speedField = (magic === 0xAF11)
    ? Math.round((speedRaw * 1000) / 70)
    : speedRaw;
  const frameLimit = Number.isFinite(maxFrames) && maxFrames > 0
    ? Math.floor(maxFrames)
    : Math.max(1, Math.min(240, headerFrameCount + 1));
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = i;
    palette[i * 3 + 2] = i;
  }

  const frames = [];
  let frame = new Uint8Array(w * h);
  const chunkCounts = {};
  let off = 128;
  let frameIdx = 0;
  while (off + 6 <= b.length) {
    const chunkSize = u32(b, off);
    const chunkType = u16(b, off + 4);
    if (chunkSize < 6 || off + chunkSize > b.length) break;

    if (chunkType === CHUNK_FRAME) {
      const subCount = u16(b, off + 6);
      let sub = off + 16;
      let touched = false;

      for (let i = 0; i < subCount && sub + 6 <= off + chunkSize; i += 1) {
        const ssRaw = u32(b, sub);
        const st = u16(b, sub + 4);
        chunkCounts[st] = (chunkCounts[st] || 0) + 1;
        let ss = ssRaw;
        // Civ3 unit FLCs sometimes have malformed COLOR_256 chunk sizes.
        if (st === CHUNK_COLOR_256 && (ss < 6 || sub + ss > off + chunkSize)) {
          const fallback = Math.min(778, (off + chunkSize) - sub);
          ss = fallback >= 6 ? fallback : ss;
        }
        if (ss < 6 || sub + ss > off + chunkSize) break;
        const payload = b.subarray(sub + 6, sub + ss);

        if (st === CHUNK_COLOR_256) {
          decodeColor256(payload, palette);
        } else if (st === CHUNK_BYTE_RUN) {
          frame = decodeByteRun(payload, w, h);
          touched = true;
        } else if (st === CHUNK_FLI_COPY && payload.length >= w * h) {
          frame = new Uint8Array(payload.subarray(0, w * h));
          touched = true;
        } else if (st === CHUNK_BLACK) {
          frame = new Uint8Array(w * h);
          touched = true;
        } else if (st === CHUNK_DELTA_FLI) {
          decodeDeltaFli(payload, frame, w, h);
          touched = true;
        } else if (st === CHUNK_DELTA_FLC) {
          decodeDeltaFlc(payload, frame, w, h);
          touched = true;
        }

        sub += ss;
      }

      if (touched) {
        if (frameIdx >= startFrame) {
          frames.push(new Uint8Array(frame));
          if (frames.length >= frameLimit) {
            break;
          }
        }
        frameIdx += 1;
      }
    }

    off += chunkSize;
  }

  if (frames.length === 0) {
    throw new Error('Could not decode FLC frames');
  }

  const framesBase64 = frames.map((pix) => {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < pix.length; i += 1) {
      const idx = pix[i];
      let r = palette[idx * 3];
      let g = palette[idx * 3 + 1];
      let b2 = palette[idx * 3 + 2];
      let a = 255;
      if (options && options.civ3UnitPalette) {
        if (idx === 255) {
          a = 0;
        } else if (idx >= 240 && idx <= 254) {
          // Civ3 shadow ramp (transparent black -> darker shadow).
          r = 0;
          g = 0;
          b2 = 0;
          a = Math.min(255, (255 - idx) * 16);
        } else if (idx >= 224 && idx <= 239) {
          // Civ3 smoke/haze ramp (transparent -> opaque white).
          r = 255;
          g = 255;
          b2 = 255;
          a = Math.min(255, (idx - 224) * 16);
        }
      }
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b2;
      rgba[i * 4 + 3] = a;
    }
    return Buffer.from(rgba).toString('base64');
  });

  const indexedBase64 = (options && options.returnIndexed)
    ? frames.map((pix) => Buffer.from(pix).toString('base64'))
    : undefined;
  const paletteBase64 = (options && options.returnIndexed)
    ? Buffer.from(palette).toString('base64')
    : undefined;

  return {
    width: w,
    height: h,
    depth,
    framesBase64,
    indexedBase64,
    paletteBase64,
    speedField,
    speedRaw,
    magic,
    frameCountHeader: headerFrameCount,
    civ3NumAnims,
    civ3AnimLength,
    debug: { chunkCounts, maxFramesRequested: frameLimit, framesDecoded: frames.length }
  };
}

function cropCell(image, row, col, cellW, cellH) {
  const x0 = Math.max(0, col * cellW);
  const y0 = Math.max(0, row * cellH);
  const w = Math.max(1, Math.min(cellW, image.width - x0));
  const h = Math.max(1, Math.min(cellH, image.height - y0));
  const rgba = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y += 1) {
    const srcOff = ((y0 + y) * image.width + x0) * 4;
    const dstOff = y * w * 4;
    rgba.set(image.rgba.subarray(srcOff, srcOff + w * 4), dstOff);
  }

  return { width: w, height: h, rgba };
}

function parseIniForFlc(iniPath) {
  if (!fileExists(iniPath)) return null;
  const text = fs.readFileSync(iniPath, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('[')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toUpperCase();
    const val = line.slice(i + 1).trim();
    if (!val) continue;
    if (key === 'ATTACK1' || key === 'DEFAULT' || key === 'RUN' || key === 'WALK') {
      if (val.toLowerCase().endsWith('.flc')) {
        return path.join(path.dirname(iniPath), val);
      }
    }
  }
  return null;
}

function readIniText(iniPath) {
  const raw = fs.readFileSync(iniPath);
  const utf8 = raw.toString('utf8');
  // If UTF-8 decoding introduced replacement chars, prefer latin1 fallback.
  return utf8.includes('\uFFFD') ? raw.toString('latin1') : utf8;
}

function stripInlineIniComment(value) {
  const s = String(value || '');
  let inQuote = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && ch === ';') return s.slice(0, i).trim();
  }
  return s.trim();
}

function parseUnitAnimationIni(iniPath) {
  if (!fileExists(iniPath)) return null;
  const text = readIniText(iniPath);
  const lines = text.split(/\r?\n/);
  const actions = [];
  const seen = new Set();
  const timings = new Map();
  const sections = [];
  const sectionByUpper = new Map();
  let normalSpeedMs = null;
  let fastSpeedMs = null;
  let section = '';
  const ensureSection = (name) => {
    const upper = String(name || '').trim().toUpperCase();
    if (!sectionByUpper.has(upper)) {
      const next = { name: String(name || '').trim() || 'General', nameUpper: upper, fields: [] };
      sectionByUpper.set(upper, next);
      sections.push(next);
    }
    return sectionByUpper.get(upper);
  };
  lines.forEach((raw) => {
    const line = String(raw || '').trim();
    if (!line || line.startsWith(';')) return;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = String(sec[1] || '').trim().toUpperCase();
      ensureSection(section);
      return;
    }
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const keyUpper = key.toUpperCase();
    if (!keyUpper) return;
    let val = stripInlineIniComment(line.slice(eq + 1));
    val = val.replace(/^["']|["']$/g, '').trim();
    ensureSection(section || 'General').fields.push({
      key,
      keyUpper,
      value: val
    });
    if (section === 'TIMING') {
      const t = Number.parseFloat(val);
      if (Number.isFinite(t) && t > 0) timings.set(keyUpper, t);
      return;
    }
    if (section === 'SPEED') {
      const speed = Number.parseFloat(val);
      if (Number.isFinite(speed) && speed > 0) {
        if (keyUpper === 'NORMAL SPEED') normalSpeedMs = speed;
        if (keyUpper === 'FAST SPEED') fastSpeedMs = speed;
      }
    }
    if (section && section !== 'ANIMATIONS') return;
    if (seen.has(keyUpper)) return;
    if (!val) return;
    if (!/\.flc$/i.test(val)) return;
    const flcPath = path.join(path.dirname(iniPath), val.replace(/\\/g, path.sep).replace(/\//g, path.sep));
    actions.push({
      key: keyUpper,
      relativePath: val,
      flcPath,
      exists: fileExists(flcPath),
      timingSeconds: timings.get(keyUpper) || null
    });
    seen.add(keyUpper);
  });
  actions.forEach((a) => {
    if (!a.timingSeconds && timings.has(a.key)) a.timingSeconds = timings.get(a.key);
  });
  if (!actions.length) {
    return {
      iniPath,
      actions: [],
      defaultActionKey: ''
    };
  }
  const defaultActionKey = (actions.find((a) => a.key === 'DEFAULT') || actions[0]).key;
  return {
    iniPath,
    sections: sections.map((sec) => ({
      name: sec.name,
      fields: (Array.isArray(sec.fields) ? sec.fields : []).map((field) => ({
        key: String(field && field.key || ''),
        keyUpper: String(field && field.keyUpper || '').toUpperCase(),
        value: String(field && field.value || '')
      }))
    })),
    actions,
    defaultActionKey,
    normalSpeedMs: Number.isFinite(normalSpeedMs) ? normalSpeedMs : null,
    fastSpeedMs: Number.isFinite(fastSpeedMs) ? fastSpeedMs : null
  };
}

function normalizeAssetPath(raw) {
  const value = String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, path.sep)
    .replace(/\//g, path.sep);
  if (!value) return '';
  if (path.isAbsolute(value) || path.win32.isAbsolute(String(raw || '').trim().replace(/^["']|["']$/g, ''))) {
    return value;
  }
  return value.replace(/^\.?[\\/]+/, '');
}

function resolveCiv3Root(civ3Path) {
  if (!civ3Path) return '';
  const base = path.basename(civ3Path).toLowerCase();
  if (base === 'conquests' || base === 'civ3ptw') return path.dirname(civ3Path);
  return civ3Path;
}

function resolveConquestsRoot(civ3Path) {
  const root = resolveCiv3Root(civ3Path);
  return root ? path.join(root, 'Conquests') : '';
}

function resolvePtwRoot(civ3Path) {
  const root = resolveCiv3Root(civ3Path);
  return root ? path.join(root, 'civ3PTW') : '';
}

function resolveScenarioRoot(scenarioPath) {
  const raw = String(scenarioPath || '').trim();
  if (!raw) return '';
  if (/\.biq$/i.test(raw)) return path.dirname(raw);
  return raw;
}

function normalizeScenarioRoots(scenarioPath, scenarioPaths) {
  const out = [];
  const seen = new Set();
  const add = (candidate) => {
    const resolved = resolveScenarioRoot(candidate);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
  };
  add(scenarioPath);
  (Array.isArray(scenarioPaths) ? scenarioPaths : []).forEach((p) => add(p));
  return out;
}

function resolveConquestsAssetPath(civ3Path, rawAssetPath, scenarioPath, scenarioPaths, civilopediaKey = '') {
  if (!civ3Path || (!rawAssetPath && !civilopediaKey)) {
    log.debug('resolveAsset', `Skipped — civ3Path=${!!civ3Path}, rawAssetPath=${!!rawAssetPath}, key=${civilopediaKey || '(none)'}`);
    return null;
  }
  const civ3Root = resolveCiv3Root(civ3Path);
  const conquestsRoot = resolveConquestsRoot(civ3Path);
  const ptwRoot = resolvePtwRoot(civ3Path);
  const scenarioRoots = normalizeScenarioRoots(scenarioPath, scenarioPaths);
  const relCandidates = [];
  const addRel = (rel) => {
    const normalized = normalizeAssetPath(rel);
    if (!normalized || relCandidates.includes(normalized)) return;
    relCandidates.push(normalized);
  };
  addRel(rawAssetPath);

  const civKey = String(civilopediaKey || '').trim().toUpperCase();
  if (civKey.startsWith('RACE_')) {
    const short = civKey.slice('RACE_'.length).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const compact = short.replace(/_/g, '');
    [short, compact].filter(Boolean).forEach((base) => {
      addRel(path.join('Art', 'Leaderheads', `${base} large.pcx`));
      addRel(path.join('Art', 'Leaderheads', `${base} lg.pcx`));
      addRel(path.join('Art', 'Leaderheads', `${base} large.pcx`));
      addRel(path.join('Art', 'Leaderheads', `${base} small.pcx`));
      addRel(path.join('Art', 'Leaderheads', `${base} sm.pcx`));
      addRel(path.join('Art', 'Advisors', `${base}_all.pcx`));
      addRel(path.join('Art', 'Advisors', `${base} all.pcx`));
      addRel(path.join('Art', 'Civilopedia', 'Icons', 'Races', `${base}large.pcx`));
      addRel(path.join('Art', 'Civilopedia', 'Icons', 'Races', `${base}small.pcx`));
      addRel(path.join('Art', 'Civilopedia', 'Icons', 'Races', `${base} lg.pcx`));
      addRel(path.join('Art', 'Civilopedia', 'Icons', 'Races', `${base} sm.pcx`));
    });
  }

  const roots = [];
  const addRoot = (root) => {
    if (!root || roots.includes(root)) return;
    roots.push(root);
  };
  scenarioRoots.forEach(addRoot);
  addRoot(conquestsRoot);
  addRoot(ptwRoot);
  addRoot(civ3Root);

  const directCandidates = [];
  relCandidates.forEach((rel) => {
    if (path.isAbsolute(rel)) directCandidates.push(rel);
    roots.forEach((root) => directCandidates.push(path.join(root, rel)));
  });
  const directHit = directCandidates.find((p) => fileExists(p));
  if (directHit) {
    log.debug('resolveAsset', `Found: ${log.rel(directHit)} (key=${civilopediaKey || rawAssetPath || '?'})`);
    return directHit;
  }

  // Some official civ art lives in sibling scenario folders rather than the
  // base Conquests directory. Try one level down before giving up.
  try {
    if (conquestsRoot && fs.existsSync(conquestsRoot)) {
      const childDirs = fs.readdirSync(conquestsRoot, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
      for (const childDir of childDirs) {
        for (const rel of relCandidates) {
          const childHit = path.join(conquestsRoot, childDir, rel);
          if (fileExists(childHit)) return childHit;
        }
      }
    }
  } catch (_err) {
    // Best effort only.
  }

  log.debug('resolveAsset', `NOT FOUND: key=${civilopediaKey || rawAssetPath || '?'} — checked ${directCandidates.length} path(s) + conquests subfolders`);
  return null;
}

function readAnimNameFromPedia(civ3Path, scenarioPath, scenarioPaths, animKey) {
  const civ3Root = resolveCiv3Root(civ3Path);
  const conquestsRoot = resolveConquestsRoot(civ3Path);
  const ptwRoot = resolvePtwRoot(civ3Path);
  const scenarioRoots = normalizeScenarioRoots(scenarioPath, scenarioPaths);
  const candidates = [];
  scenarioRoots.forEach((root) => candidates.push(path.join(root, 'Text', 'PediaIcons.txt')));
  candidates.push(
    path.join(conquestsRoot, 'Text', 'PediaIcons.txt'),
    path.join(ptwRoot, 'Text', 'PediaIcons.txt'),
    path.join(civ3Root, 'Text', 'PediaIcons.txt')
  );
  const upperKey = `#${animKey.toUpperCase()}`;
  for (const pediaPath of candidates) {
    if (!fileExists(pediaPath)) continue;
    try {
      const lines = fs.readFileSync(pediaPath, 'latin1').split(/\r?\n/);
      let inBlock = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.toUpperCase() === upperKey) { inBlock = true; continue; }
        if (inBlock) {
          if (trimmed.startsWith('#')) break;
          if (trimmed && !trimmed.startsWith(';')) {
            const val = trimmed.replace(/\s*;.*$/, '').replace(/^["']|["']$/g, '').trim();
            if (val) return val;
          }
        }
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

function resolveUnitIniPath(civ3Path, animationName, scenarioPath, scenarioPaths) {
  if (!civ3Path || !animationName) {
    log.debug('resolveUnitIni', `Skipped — civ3Path=${!!civ3Path}, animationName="${animationName || ''}"`);
    return null;
  }
  const civ3Root = resolveCiv3Root(civ3Path);
  const conquestsRoot = resolveConquestsRoot(civ3Path);
  const ptwRoot = resolvePtwRoot(civ3Path);
  const scenarioRoots = normalizeScenarioRoots(scenarioPath, scenarioPaths);
  const unitName = String(animationName).trim();
  const candidates = [];
  scenarioRoots.forEach((root) => candidates.push(path.join(root, 'Art', 'Units', unitName, `${unitName}.ini`)));
  candidates.push(
    path.join(conquestsRoot, 'Art', 'Units', unitName, `${unitName}.ini`),
    path.join(ptwRoot, 'Art', 'Units', unitName, `${unitName}.ini`),
    path.join(civ3Root, 'Art', 'Units', unitName, `${unitName}.ini`)
  );
  const existing = candidates.filter((p) => fileExists(p));
  if (existing.length === 0) {
    log.debug('resolveUnitIni', `NOT FOUND: "${animationName}" — checked ${candidates.length} candidate(s)`);
    return null;
  }
  const withResolvableFlc = existing.find((iniPath) => {
    const flcPath = parseIniForFlc(iniPath);
    return !!flcPath && fileExists(flcPath);
  });
  const chosen = withResolvableFlc || existing[0];
  log.debug('resolveUnitIni', `Resolved "${animationName}" -> ${log.rel(chosen)}${withResolvableFlc ? '' : ' (no FLC found, using first match)'}`);
  return chosen;
}

function resolvePcxPath(c3xPath, fileName, scenarioRoots) {
  if (!c3xPath || !fileName) return null;
  const normalizedFileName = String(fileName || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  const direct = path.isAbsolute(normalizedFileName) ? normalizedFileName : null;
  const startsWithArt = /^art\//i.test(normalizedFileName);
  const candidates = [direct];
  (Array.isArray(scenarioRoots) ? scenarioRoots : []).forEach((root) => {
    if (startsWithArt) {
      candidates.push(path.join(root, normalizedFileName));
      if (!/^art\/districts\//i.test(normalizedFileName)) {
        candidates.push(path.join(root, 'Art', 'Districts', '1200', path.basename(normalizedFileName)));
      }
    } else {
      candidates.push(
        path.join(root, 'Art', 'Districts', 'Summer', '1200', normalizedFileName),
        path.join(root, 'Art', 'Districts', '1200', normalizedFileName),
        path.join(root, 'Art', 'Summer', '1200', normalizedFileName),
        path.join(root, 'Art', '1200', normalizedFileName)
      );
    }
  });
  if (startsWithArt) {
    candidates.push(path.join(c3xPath, normalizedFileName));
    if (!/^art\/districts\//i.test(normalizedFileName)) {
      candidates.push(path.join(c3xPath, 'Art', 'Districts', '1200', path.basename(normalizedFileName)));
    }
  } else {
    candidates.push(
      path.join(c3xPath, 'Art', 'Districts', 'Summer', '1200', normalizedFileName),
      path.join(c3xPath, 'Art', 'Districts', '1200', normalizedFileName),
      path.join(c3xPath, 'Art', 'DayNight', 'Summer', '1200', normalizedFileName),
      path.join(c3xPath, 'Art', 'Terrain', normalizedFileName)
    );
  }
  return candidates.filter(Boolean).find((p) => fileExists(p)) || null;
}

function decodeByPath(filePath, crop, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  let image;
  if (ext === '.pcx') {
    image = decodePcx(filePath, options);
  } else if (ext === '.flc') {
    const maxFrames = Number.isFinite(options.maxFrames) ? Number(options.maxFrames) : null;
    image = decodeFlcFrames(filePath, maxFrames, options);
  } else {
    throw new Error(`Unsupported preview extension: ${ext}`);
  }

  if (crop && Number.isInteger(crop.row) && Number.isInteger(crop.col) && crop.w > 0 && crop.h > 0) {
    image = cropCell(image, crop.row, crop.col, crop.w, crop.h);
  }

  const base = {
    width: image.width,
    height: image.height,
    sourcePath: filePath,
    ext
  };

  if (image.framesBase64) {
    return {
      ...base,
      animated: true,
      framesBase64: image.framesBase64,
      speedField: image.speedField,
      speedRaw: image.speedRaw,
      magic: image.magic,
      depth: image.depth,
      frameCountHeader: image.frameCountHeader,
      civ3NumAnims: image.civ3NumAnims,
      civ3AnimLength: image.civ3AnimLength,
      debug: image.debug || null
    };
  }
  return {
    ...base,
    animated: false,
    rgbaBase64: Buffer.from(image.rgba).toString('base64'),
    ...(image.indices ? { indicesBase64: Buffer.from(image.indices).toString('base64') } : {}),
    ...(image.palette ? { paletteBase64: Buffer.from(image.palette).toString('base64') } : {})
  };
}

function parseNaturalWonderAnimationIniPath(animationSpec) {
  const s = String(animationSpec || '').trim();
  if (!s) return null;
  const chunks = s.split(';').map((chunk) => String(chunk || '').trim()).filter(Boolean);
  for (const chunk of chunks) {
    const m = chunk.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
    if (!m) continue;
    const rawKey = String(m[1] || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (rawKey !== 'ini' && rawKey !== 'ini_path') continue;
    return String(m[2] || '').trim().replace(/^"|"$/g, '');
  }
  const first = chunks[0] || '';
  if (!/[:=]/.test(first)) return first.replace(/^"|"$/g, '').trim();
  return null;
}

function getPreview(request) {
  const { c3xPath, civ3Path, scenarioPath, scenarioPaths, kind } = request;

  if (kind === 'district' || kind === 'wonder' || kind === 'naturalWonder') {
    const scenarioRoots = normalizeScenarioRoots(scenarioPath, scenarioPaths);
    const pcx = resolvePcxPath(c3xPath, request.fileName, scenarioRoots);
    if (!pcx) {
      log.warn('getPreview', `${kind}: PCX not found — fileName="${request.fileName}", c3x=${log.rel(c3xPath)}`);
      return { ok: false, error: 'PCX not found' };
    }
    return { ok: true, ...decodeByPath(pcx, request.crop) };
  }

  if (kind === 'districtButtonSheet') {
    const pcxPath = path.join(String(c3xPath || ''), 'Art', 'Districts', 'WorkerDistrictButtonsNorm.pcx');
    if (!fileExists(pcxPath)) {
      log.warn('getPreview', `districtButtonSheet: not found at ${log.rel(pcxPath)}`);
      return { ok: false, error: 'Button sheet not found' };
    }
    return { ok: true, ...decodeByPath(pcxPath, request.crop) };
  }

  if (kind === 'animationIni') {
    const iniRel = String(request.iniPath || '').replace(/\\/g, path.sep).replace(/\//g, path.sep);
    const iniAbs = path.isAbsolute(iniRel)
      ? iniRel
      : path.join(c3xPath, 'Art', 'Animations', iniRel);
    const flc = parseIniForFlc(iniAbs);
    if (!flc || !fileExists(flc)) {
      log.warn('getPreview', `animationIni: FLC not found for INI ${log.rel(iniAbs)}`);
      return { ok: false, error: 'FLC from INI not found' };
    }
    return { ok: true, ...decodeByPath(flc) };
  }

  if (kind === 'naturalWonderAnimationSpec') {
    const iniRel = parseNaturalWonderAnimationIniPath(request.animationSpec);
    if (!iniRel) {
      log.warn('getPreview', `naturalWonderAnimationSpec: no ini: found in spec "${request.animationSpec}"`);
      return { ok: false, error: 'No ini: in animation spec' };
    }
    const rel = iniRel.replace(/\\/g, path.sep).replace(/\//g, path.sep);
    const iniAbs = path.isAbsolute(rel) ? rel : path.join(c3xPath, 'Art', 'Animations', rel);
    const flc = parseIniForFlc(iniAbs);
    if (!flc || !fileExists(flc)) {
      log.warn('getPreview', `naturalWonderAnimationSpec: FLC not found for INI ${log.rel(iniAbs)}`);
      return { ok: false, error: 'FLC from animation spec not found' };
    }
    return { ok: true, ...decodeByPath(flc) };
  }

  if (kind === 'civilopediaIcon') {
    const iconPath = resolveConquestsAssetPath(civ3Path, request.assetPath, scenarioPath, scenarioPaths, request.civilopediaKey);
    if (!iconPath) {
      log.warn('getPreview', `civilopediaIcon: not found — key="${request.civilopediaKey}", assetPath="${request.assetPath}"`);
      return { ok: false, error: 'Civilopedia icon not found' };
    }
    return { ok: true, ...decodeByPath(iconPath, null, { transparentIndexes: [], ...(request.options || {}) }) };
  }

  if (kind === 'leaderAnimationPath') {
    const assetPath = String(request.assetPath || '').trim();
    if (!assetPath) {
      log.warn('getPreview', 'leaderAnimationPath: missing assetPath');
      return { ok: false, error: 'Leader animation path is empty' };
    }
    const maxFrames = Number.isFinite(Number(request.maxFrames)) && Number(request.maxFrames) > 0
      ? Math.floor(Number(request.maxFrames))
      : 80;
    log.debug('getPreview', `leaderAnimationPath: resolving key="${request.civilopediaKey || ''}", assetPath="${assetPath}", maxFrames=${maxFrames}`);
    const flcPath = resolveConquestsAssetPath(civ3Path, assetPath, scenarioPath, scenarioPaths, request.civilopediaKey);
    if (!flcPath) {
      log.warn('getPreview', `leaderAnimationPath: FLC not found — key="${request.civilopediaKey || ''}", assetPath="${assetPath}"`);
      return { ok: false, error: 'Leader animation FLC not found' };
    }
    const decoded = decodeByPath(flcPath, null, { maxFrames });
    log.debug('getPreview', `leaderAnimationPath: decoded ${log.rel(flcPath)} ${decoded.width}x${decoded.height}, frames=${decoded.framesBase64 ? decoded.framesBase64.length : 0}, speed=${decoded.speedField || '(none)'}`);
    return { ok: true, ...decoded };
  }

  if (kind === 'pcxPalette') {
    const iconPath = resolveConquestsAssetPath(civ3Path, request.assetPath, scenarioPath, scenarioPaths, request.civilopediaKey);
    if (!iconPath) {
      log.warn('getPreview', `pcxPalette: PCX not found — key="${request.civilopediaKey}", assetPath="${request.assetPath}"`);
      return { ok: false, error: 'PCX not found' };
    }
    const b = fs.readFileSync(iconPath);
    if (b.length < 769 || b[b.length - 769] !== 12) return { ok: false, error: 'Missing PCX palette' };
    const palette = b.slice(b.length - 768);
    return { ok: true, paletteBase64: Buffer.from(palette).toString('base64') };
  }

  if (kind === 'unitAnimation') {
    const unitIni = resolveUnitIniPath(civ3Path, request.animationName, scenarioPath, scenarioPaths);
    if (!unitIni) {
      log.warn('getPreview', `unitAnimation: INI not found for animationName="${request.animationName}"`);
      return { ok: false, error: 'Unit INI not found for animation name' };
    }
    const flc = parseIniForFlc(unitIni);
    if (!flc || !fileExists(flc)) {
      log.warn('getPreview', `unitAnimation: no FLC found in INI ${log.rel(unitIni)}`);
      return { ok: false, error: 'No FLC found in unit INI' };
    }
    return { ok: true, ...decodeByPath(flc) };
  }

  if (kind === 'unitFlcFirstFrame') {
    // Resolve ANIMNAME_PRTO_<NAME> from PediaIcons layers, then decode frame 0 (SW direction).
    const prtoName = String(request.prtoName || '').trim();
    if (!prtoName) return { ok: false, error: 'No prtoName provided' };
    const upperName = prtoName.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    const animKey = `ANIMNAME_PRTO_${upperName}`;
    const animationName = readAnimNameFromPedia(civ3Path, scenarioPath, scenarioPaths, animKey);
    if (!animationName) {
      log.warn('getPreview', `unitFlcFirstFrame: ${animKey} not found in PediaIcons`);
      return { ok: false, error: `${animKey} not found in PediaIcons` };
    }
    const unitIni = resolveUnitIniPath(civ3Path, animationName, scenarioPath, scenarioPaths);
    if (!unitIni) {
      log.warn('getPreview', `unitFlcFirstFrame: INI not found for "${animationName}"`);
      return { ok: false, error: `Unit INI not found for "${animationName}"` };
    }
    const manifest = parseUnitAnimationIni(unitIni);
    if (!manifest || !Array.isArray(manifest.actions) || manifest.actions.length === 0) {
      log.warn('getPreview', `unitFlcFirstFrame: no actions in unit INI ${log.rel(unitIni)}`);
      return { ok: false, error: 'No actions in unit INI' };
    }
    const action = manifest.actions.find((a) => a.key === 'DEFAULT' && a.exists)
      || manifest.actions.find((a) => a.exists);
    if (!action || !fileExists(action.flcPath)) {
      log.warn('getPreview', `unitFlcFirstFrame: no valid FLC for DEFAULT action in "${animationName}"`);
      return { ok: false, error: 'No valid FLC for DEFAULT action' };
    }
    // SE-facing: direction index 2, firstFrame = anim_length * 2.
    const decoded = decodeFlcFrames(action.flcPath, 1, { civ3UnitPalette: true, returnIndexed: true, directionIndex: 2 });
    const frameBase64 = decoded.framesBase64 && decoded.framesBase64[0];
    if (!frameBase64) return { ok: false, error: 'Could not decode first frame' };
    return {
      ok: true,
      animated: false,
      rgbaBase64: frameBase64,
      indexedBase64: decoded.indexedBase64 && decoded.indexedBase64[0],
      paletteBase64: decoded.paletteBase64,
      width: decoded.width,
      height: decoded.height
    };
  }

  if (kind === 'unitAnimationManifest') {
    const unitIni = resolveUnitIniPath(civ3Path, request.animationName, scenarioPath, scenarioPaths);
    if (!unitIni) return { ok: false, error: 'Unit INI not found for animation name' };
    const manifest = parseUnitAnimationIni(unitIni);
    if (!manifest) return { ok: false, error: 'Could not parse unit INI' };
    return {
      ok: true,
      iniPath: manifest.iniPath,
      defaultActionKey: manifest.defaultActionKey,
      normalSpeedMs: Number.isFinite(manifest.normalSpeedMs) ? manifest.normalSpeedMs : null,
      fastSpeedMs: Number.isFinite(manifest.fastSpeedMs) ? manifest.fastSpeedMs : null,
      sections: (Array.isArray(manifest.sections) ? manifest.sections : []).map((section) => ({
        name: String(section && section.name || ''),
        fields: (Array.isArray(section && section.fields) ? section.fields : []).map((field) => ({
          key: String(field && field.key || ''),
          keyUpper: String(field && field.keyUpper || '').toUpperCase(),
          value: String(field && field.value || '')
        }))
      })),
      actions: manifest.actions.map((a) => ({
        key: a.key,
        relativePath: a.relativePath,
        exists: !!a.exists,
        sourcePath: a.exists ? a.flcPath : '',
        timingSeconds: Number.isFinite(a.timingSeconds) ? a.timingSeconds : null
      }))
    };
  }

  if (kind === 'unitAnimationAction') {
    const unitIni = resolveUnitIniPath(civ3Path, request.animationName, scenarioPath, scenarioPaths);
    if (!unitIni) {
      log.warn('getPreview', `unitAnimationAction: INI not found for animationName="${request.animationName}"`);
      return { ok: false, error: 'Unit INI not found for animation name' };
    }
    const manifest = parseUnitAnimationIni(unitIni);
    if (!manifest || !Array.isArray(manifest.actions) || manifest.actions.length === 0) {
      log.warn('getPreview', `unitAnimationAction: no FLC entries in INI ${log.rel(unitIni)}`);
      return { ok: false, error: 'No FLC entries found in unit INI' };
    }
    const reqKey = String(request.actionKey || '').trim().toUpperCase();
    const selected = manifest.actions.find((a) => a.key === reqKey) || manifest.actions.find((a) => a.key === manifest.defaultActionKey) || manifest.actions[0];
    if (!selected || !selected.exists || !fileExists(selected.flcPath)) {
      log.warn('getPreview', `unitAnimationAction: FLC not found for action "${selected ? selected.key : reqKey || '(none)'}" in "${request.animationName}"`);
      return { ok: false, error: `FLC not found for action ${selected ? selected.key : reqKey || '(none)'}` };
    }
    return {
      ok: true,
      actionKey: selected.key,
      iniPath: manifest.iniPath,
      ...decodeByPath(selected.flcPath, null, { civ3UnitPalette: true, maxFrames: 1000 })
    };
  }

  if (kind === 'unitAnimationPath') {
    const iniPath = String(request.unitIniPath || '').trim();
    const flcRaw = String(request.flcPath || '').trim();
    const flcValue = stripInlineIniComment(flcRaw).replace(/^["']|["']$/g, '').trim();
    if (!iniPath || !flcValue) {
      log.warn('getPreview', `unitAnimationPath: missing iniPath or flcPath`);
      return { ok: false, error: 'Missing unitIniPath or flcPath' };
    }
    const normalizedFlc = flcValue.replace(/\\/g, path.sep).replace(/\//g, path.sep);
    const isAbs = path.isAbsolute(normalizedFlc) || path.win32.isAbsolute(flcValue);
    const flcPath = isAbs
      ? normalizedFlc
      : path.normalize(path.join(path.dirname(iniPath), normalizedFlc));
    if (!fileExists(flcPath)) {
      log.warn('getPreview', `unitAnimationPath: FLC not found: ${log.rel(flcPath)} (ini=${log.rel(iniPath)})`);
      return { ok: false, error: 'FLC not found for requested path' };
    }
    return { ok: true, ...decodeByPath(flcPath, null, { civ3UnitPalette: true, maxFrames: 1000 }) };
  }

  log.warn('getPreview', `Unknown preview kind: "${kind}"`);
  return { ok: false, error: 'Unknown preview kind' };
}

// Encode a palette-indexed image to PCX format.
// indices: Uint8Array of width*height palette index values (row-major)
// palette: Uint8Array of 768 bytes (256 * RGB)
// Returns a Buffer containing a valid 8-bit 1-plane PCX file.
function encodePcx(indices, palette, width, height) {
  const bytesPerLine = width % 2 === 0 ? width : width + 1;

  const header = Buffer.alloc(128, 0);
  header[0] = 10;  // manufacturer
  header[1] = 5;   // version (3.0 with 256-color palette)
  header[2] = 1;   // encoding (RLE)
  header[3] = 8;   // bits per plane
  header.writeUInt16LE(0, 4);            // xMin
  header.writeUInt16LE(0, 6);            // yMin
  header.writeUInt16LE(width - 1, 8);   // xMax
  header.writeUInt16LE(height - 1, 10); // yMax
  header.writeUInt16LE(72, 12);          // hDpi
  header.writeUInt16LE(72, 14);          // vDpi
  header[65] = 1;                         // planes
  header.writeUInt16LE(bytesPerLine, 66); // bytesPerLine
  header.writeUInt16LE(1, 68);            // paletteInfo (color)

  const encodedRows = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    let x = 0;
    while (x < bytesPerLine) {
      const val = x < width ? indices[y * width + x] : 0;
      let run = 1;
      while (
        run < 63 &&
        x + run < bytesPerLine &&
        (x + run < width ? indices[y * width + x + run] : 0) === val
      ) {
        run++;
      }
      if (run > 1 || val >= 0xC0) {
        row.push(0xC0 | run, val);
      } else {
        row.push(val);
      }
      x += run;
    }
    encodedRows.push(Buffer.from(row));
  }

  const palSection = Buffer.alloc(769);
  palSection[0] = 0x0C;
  Buffer.from(palette).copy(palSection, 1);

  return Buffer.concat([header, ...encodedRows, palSection]);
}

function getColorChannelRange(colors, channel) {
  let min = 255;
  let max = 0;
  for (const color of colors) {
    if (color[channel] < min) min = color[channel];
    if (color[channel] > max) max = color[channel];
  }
  return max - min;
}

function colorBoxWeight(colors) {
  let total = 0;
  for (const color of colors) total += Math.sqrt(Math.max(1, color.count));
  return total;
}

function chooseColorBoxSplitChannel(colors) {
  const rRange = getColorChannelRange(colors, 'r');
  const gRange = getColorChannelRange(colors, 'g');
  const bRange = getColorChannelRange(colors, 'b');
  if (gRange >= rRange && gRange >= bRange) return 'g';
  if (bRange >= rRange && bRange >= gRange) return 'b';
  return 'r';
}

function makeAveragePaletteColor(colors) {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const color of colors) {
    const weight = Math.sqrt(Math.max(1, color.count));
    r += color.r * weight;
    g += color.g * weight;
    b += color.b * weight;
    total += weight;
  }
  const inv = total > 0 ? 1 / total : 0;
  return {
    r: Math.round(r * inv),
    g: Math.round(g * inv),
    b: Math.round(b * inv),
    count: total
  };
}

function splitColorBox(colors) {
  if (colors.length <= 1) return [colors, []];
  const channel = chooseColorBoxSplitChannel(colors);
  const sorted = colors.slice().sort((a, b) => {
    const diff = a[channel] - b[channel];
    if (diff) return diff;
    const green = a.g - b.g;
    if (green) return green;
    const red = a.r - b.r;
    if (red) return red;
    return a.b - b.b;
  });
  const halfWeight = colorBoxWeight(sorted) / 2;
  let running = 0;
  let splitAt = 1;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    running += sorted[i].count;
    if (running >= halfWeight) {
      splitAt = i + 1;
      break;
    }
  }
  return [sorted.slice(0, splitAt), sorted.slice(splitAt)];
}

function makeOptimizedPalette(colors, maxColors) {
  if (colors.length <= maxColors) {
    return colors
      .slice()
      .sort((a, b) => b.count - a.count || a.r - b.r || a.g - b.g || a.b - b.b)
      .map((color) => ({ r: color.r, g: color.g, b: color.b, count: color.count }));
  }

  const boxes = [colors.slice()];
  while (boxes.length < maxColors) {
    let bestIndex = -1;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box.length <= 1) continue;
      const range = Math.max(
        getColorChannelRange(box, 'r'),
        getColorChannelRange(box, 'g'),
        getColorChannelRange(box, 'b')
      );
      const score = range * colorBoxWeight(box);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const [left, right] = splitColorBox(boxes[bestIndex]);
    boxes.splice(bestIndex, 1, left, right);
  }

  return boxes
    .map(makeAveragePaletteColor)
    .sort((a, b) => b.count - a.count || a.r - b.r || a.g - b.g || a.b - b.b);
}

function findNearestPaletteIndex(r, g, b, paletteColors) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < paletteColors.length; i += 1) {
    const color = paletteColors[i];
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const distance = (dr * dr) + (dg * dg) + (db * db);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      if (distance === 0) break;
    }
  }
  return bestIndex;
}

function flattenPcxColorOverWhite(source, off) {
  const a = source[off + 3];
  if (a >= 255) {
    return {
      r: source[off],
      g: source[off + 1],
      b: source[off + 2]
    };
  }
  const invA = 255 - a;
  return {
    r: Math.round(((source[off] * a) + (255 * invA)) / 255),
    g: Math.round(((source[off + 1] * a) + (255 * invA)) / 255),
    b: Math.round(((source[off + 2] * a) + (255 * invA)) / 255)
  };
}

function encodeRgbaToPcx(rgba, width, height) {
  const w = Math.max(1, Number(width) | 0);
  const h = Math.max(1, Number(height) | 0);
  const source = Buffer.isBuffer(rgba) || rgba instanceof Uint8Array ? rgba : Buffer.from([]);
  if (source.length < w * h * 4) throw new Error('RGBA buffer is too small for PCX conversion.');
  const colorCounts = new Map();
  for (let i = 0; i < w * h; i += 1) {
    const off = i * 4;
    if (source[off + 3] < 128) continue;
    const flattened = flattenPcxColorOverWhite(source, off);
    if (flattened.r === 255 && flattened.g === 0 && flattened.b === 255) continue;
    const key = (flattened.r << 16) | (flattened.g << 8) | flattened.b;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }
  const sourceColors = Array.from(colorCounts, ([key, count]) => ({
    r: (key >> 16) & 255,
    g: (key >> 8) & 255,
    b: key & 255,
    count
  }));
  const paletteColors = makeOptimizedPalette(sourceColors, 254);
  const palette = new Uint8Array(768);
  for (let p = 0; p < 254; p += 1) {
    const color = paletteColors[p] || { r: 0, g: 0, b: 0 };
    palette[p * 3] = color.r;
    palette[p * 3 + 1] = color.g;
    palette[p * 3 + 2] = color.b;
  }
  palette[254 * 3] = 0;
  palette[254 * 3 + 1] = 255;
  palette[254 * 3 + 2] = 0;
  palette[255 * 3] = 255;
  palette[255 * 3 + 1] = 0;
  palette[255 * 3 + 2] = 255;

  const indices = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const off = i * 4;
    const a = source[off + 3];
    if (a < 128) {
      indices[i] = 255;
      continue;
    }
    if (source[off] === 255 && source[off + 1] === 0 && source[off + 2] === 255) {
      indices[i] = 255;
      continue;
    }
    if (source[off] === 0 && source[off + 1] === 255 && source[off + 2] === 0) {
      indices[i] = 254;
      continue;
    }
    const flattened = flattenPcxColorOverWhite(source, off);
    indices[i] = findNearestPaletteIndex(flattened.r, flattened.g, flattened.b, paletteColors);
  }
  return encodePcx(indices, palette, w, h);
}

function buildIndexedImageFromRgba(rgba, width, height, maxColors = 255) {
  const w = Math.max(1, Number(width) | 0);
  const h = Math.max(1, Number(height) | 0);
  const source = Buffer.isBuffer(rgba) || rgba instanceof Uint8Array ? rgba : Buffer.from([]);
  if (source.length < w * h * 4) throw new Error('RGBA buffer is too small for indexed conversion.');
  const colorCounts = new Map();
  for (let i = 0; i < w * h; i += 1) {
    const off = i * 4;
    if (source[off + 3] < 128) continue;
    const flattened = flattenPcxColorOverWhite(source, off);
    const key = (flattened.r << 16) | (flattened.g << 8) | flattened.b;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
  }
  const sourceColors = Array.from(colorCounts, ([key, count]) => ({
    r: (key >> 16) & 255,
    g: (key >> 8) & 255,
    b: key & 255,
    count
  }));
  const paletteColors = makeOptimizedPalette(sourceColors, Math.max(1, Math.min(255, maxColors)));
  const palette = new Uint8Array(256 * 3);
  for (let p = 0; p < 255; p += 1) {
    const color = paletteColors[p] || { r: 0, g: 0, b: 0 };
    palette[p * 3] = color.r;
    palette[p * 3 + 1] = color.g;
    palette[p * 3 + 2] = color.b;
  }
  palette[255 * 3] = 255;
  palette[255 * 3 + 1] = 0;
  palette[255 * 3 + 2] = 255;
  const indices = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const off = i * 4;
    if (source[off + 3] < 128) {
      indices[i] = 255;
      continue;
    }
    const flattened = flattenPcxColorOverWhite(source, off);
    indices[i] = findNearestPaletteIndex(flattened.r, flattened.g, flattened.b, paletteColors);
  }
  return { indices, palette, width: w, height: h };
}

function makeFliCopyChunk(indices) {
  const payload = Buffer.from(indices);
  const chunk = Buffer.alloc(6 + payload.length);
  chunk.writeUInt32LE(chunk.length, 0);
  chunk.writeUInt16LE(CHUNK_FLI_COPY, 4);
  payload.copy(chunk, 6);
  return chunk;
}

function makeColor256Chunk(palette) {
  const packet = Buffer.alloc(2 + 1 + 1 + 256 * 3);
  packet.writeUInt16LE(1, 0);
  packet[2] = 0;
  packet[3] = 0;
  Buffer.from(palette).copy(packet, 4, 0, 256 * 3);
  const chunk = Buffer.alloc(6 + packet.length);
  chunk.writeUInt32LE(chunk.length, 0);
  chunk.writeUInt16LE(CHUNK_COLOR_256, 4);
  packet.copy(chunk, 6);
  return chunk;
}

function makeFlcFrame(chunks) {
  const body = Buffer.concat(chunks);
  const frame = Buffer.alloc(16 + body.length);
  frame.writeUInt32LE(frame.length, 0);
  frame.writeUInt16LE(CHUNK_FRAME, 4);
  frame.writeUInt16LE(chunks.length, 6);
  body.copy(frame, 16);
  return frame;
}

function makeDeltaFlcNoopChunk() {
  const payload = Buffer.alloc(2, 0);
  const chunk = Buffer.alloc(6 + payload.length);
  chunk.writeUInt32LE(chunk.length, 0);
  chunk.writeUInt16LE(CHUNK_DELTA_FLC, 4);
  payload.copy(chunk, 6);
  return chunk;
}

function encodeRgbaToLeaderFlc(rgba, width, height, options = {}) {
  const w = Math.max(1, Number(width) | 0);
  const h = Math.max(1, Number(height) | 0);
  if (w !== 200 || h !== 240) throw new Error('Leader FLC images must be 200x240.');
  const frameCount = Math.max(1, Math.min(240, Number(options.frameCount) || 121));
  const speedMs = Math.max(1, Math.min(65535, Number(options.speedMs) || 66));
  const indexed = buildIndexedImageFromRgba(rgba, w, h, 255);
  const firstFrame = makeFlcFrame([makeColor256Chunk(indexed.palette), makeFliCopyChunk(indexed.indices)]);
  const repeatFrame = makeFlcFrame([makeDeltaFlcNoopChunk()]);
  const frames = [firstFrame];
  for (let i = 0; i < frameCount; i += 1) frames.push(repeatFrame);
  const frameBytes = Buffer.concat(frames);
  const header = Buffer.alloc(128, 0);
  header.writeUInt32LE(128 + frameBytes.length, 0);
  header.writeUInt16LE(0xAF12, 4);
  header.writeUInt16LE(frameCount, 6);
  header.writeUInt16LE(w, 8);
  header.writeUInt16LE(h, 10);
  header.writeUInt16LE(8, 12);
  header.writeUInt16LE(3, 14);
  header.writeUInt32LE(speedMs, 16);
  header.writeUInt32LE(0, 20);
  header.writeUInt32LE(0, 24);
  header.writeUInt32LE(0, 28);
  header.writeUInt32LE(0, 32);
  header.writeUInt32LE(0, 36);
  header.writeUInt32LE(128, 80);
  header.writeUInt32LE(128 + firstFrame.length, 84);
  return Buffer.concat([header, frameBytes]);
}

module.exports = {
  getPreview,
  parseUnitAnimationIni,
  resolveConquestsAssetPath,
  resolveUnitIniPath,
  resolvePcxPath,
  decodePcx,
  encodePcx,
  encodeRgbaToPcx,
  encodeRgbaToLeaderFlc
};
