const fs = require('node:fs');
const path = require('node:path');

const CHUNK_FRAME = 0xf1fa;
const CHUNK_COLOR_256 = 4;
const CHUNK_DELTA_FLC = 7;
const CHUNK_DELTA_FLI = 12;
const CHUNK_BLACK = 13;
const CHUNK_BYTE_RUN = 15;
const CHUNK_FLI_COPY = 16;

const FLC_MAGIC = 0xaf12;
const GRID_SIZE = 1;
const FLICSTER_FXM_SIZE = 128;
const FLICSTER_FXM_HEADER_MARKER = 37;
const FLICSTER_FXM_VERSION = 2;
const DEFAULT_ORIGINAL_SIZE = 240;

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

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function readFileBuffer(filePathOrBuffer) {
  return Buffer.isBuffer(filePathOrBuffer) || filePathOrBuffer instanceof Uint8Array
    ? Buffer.from(filePathOrBuffer)
    : fs.readFileSync(filePathOrBuffer);
}

function makeDefaultPalette() {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = i;
    palette[i * 3 + 2] = i;
  }
  return palette;
}

function decodeColor256(payload, palette) {
  if (!payload || payload.length < 2) return;
  const packets = payload.readUInt16LE(0);
  let p = 2;
  let idx = 0;
  for (let n = 0; n < packets && p + 2 <= payload.length; n += 1) {
    const skip = payload[p++];
    let count = payload[p++];
    idx += skip;
    if (count === 0) count = 256;
    for (let i = 0; i < count && p + 3 <= payload.length && idx < 256; i += 1) {
      palette[idx * 3] = payload[p++];
      palette[idx * 3 + 1] = payload[p++];
      palette[idx * 3 + 2] = payload[p++];
      idx += 1;
    }
  }
}

function decodeByteRun(payload, width, height) {
  const out = new Uint8Array(width * height);
  let p = 0;
  for (let y = 0; y < height && p < payload.length; y += 1) {
    p += 1;
    let x = 0;
    const rowOff = y * width;
    while (x < width && p < payload.length) {
      const n = s8(payload[p++]);
      if (n >= 0) {
        if (p >= payload.length) break;
        const value = payload[p++];
        const run = Math.min(n, width - x);
        out.fill(value, rowOff + x, rowOff + x + run);
        x += run;
      } else {
        const run = Math.min(-n, width - x, payload.length - p);
        out.set(payload.subarray(p, p + run), rowOff + x);
        p += run;
        x += run;
      }
    }
  }
  return out;
}

function decodeDeltaFli(payload, frame, width, height) {
  if (payload.length < 4) return;
  let y = payload.readUInt16LE(0);
  let lines = payload.readUInt16LE(2);
  let p = 4;
  while (lines > 0 && y < height && p < payload.length) {
    const packets = payload[p++];
    let x = 0;
    const rowOff = y * width;
    for (let i = 0; i < packets && p + 2 <= payload.length; i += 1) {
      x += payload[p++];
      const n = s8(payload[p++]);
      if (n >= 0) {
        const run = Math.min(n, payload.length - p, Math.max(0, width - x));
        frame.set(payload.subarray(p, p + run), rowOff + x);
        p += n;
        x += n;
      } else {
        if (p >= payload.length) break;
        const value = payload[p++];
        const run = Math.min(-n, width - x);
        frame.fill(value, rowOff + x, rowOff + x + run);
        x += run;
      }
    }
    y += 1;
    lines -= 1;
  }
}

function decodeDeltaFlc(payload, frame, width, height) {
  if (payload.length < 2) return;
  let lines = payload.readUInt16LE(0);
  let p = 2;
  let y = 0;
  while (lines > 0 && y < height && p + 2 <= payload.length) {
    const op = s16(payload, p);
    p += 2;
    if (op < 0) {
      const flag = op & 0xc000;
      if (flag === 0xc000) {
        y += -op;
        continue;
      }
      if (flag === 0x8000) {
        if (width > 0) frame[y * width + width - 1] = op & 0xff;
        continue;
      }
      continue;
    }
    const packets = op;
    let x = 0;
    const rowOff = y * width;
    for (let i = 0; i < packets && p + 2 <= payload.length; i += 1) {
      x += payload[p++];
      const n = s8(payload[p++]);
      if (n >= 0) {
        const count = n * 2;
        const write = Math.min(count, payload.length - p, Math.max(0, width - x));
        frame.set(payload.subarray(p, p + write), rowOff + x);
        p += count;
        x += count;
      } else {
        if (p + 2 > payload.length) break;
        const b0 = payload[p++];
        const b1 = payload[p++];
        const reps = -n;
        for (let r = 0; r < reps && x + 1 < width; r += 1) {
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

function readCiv3Header(buf) {
  const hasHeader = buf.length >= 116 && u32(buf, 88) === 28;
  return {
    size: hasHeader ? u32(buf, 88) : 0,
    flags: hasHeader ? u32(buf, 92) : 0,
    numAnims: hasHeader ? u16(buf, 96) : 1,
    animLength: hasHeader ? u16(buf, 98) : u16(buf, 6),
    xOffset: hasHeader ? u16(buf, 100) : 0,
    yOffset: hasHeader ? u16(buf, 102) : 0,
    xsOrig: hasHeader ? u16(buf, 104) : u16(buf, 8),
    ysOrig: hasHeader ? u16(buf, 106) : u16(buf, 10),
    animTime: hasHeader ? u32(buf, 108) : 0,
    directions: hasHeader ? u32(buf, 112) : 1
  };
}

function inspectCiv3Flc(filePathOrBuffer) {
  const buf = readFileBuffer(filePathOrBuffer);
  if (buf.length < 128) throw new Error('FLC too small');
  const civ3 = readCiv3Header(buf);
  return {
    fileSize: u32(buf, 0),
    magic: u16(buf, 4),
    frameCountHeader: u16(buf, 6),
    width: u16(buf, 8),
    height: u16(buf, 10),
    depth: u16(buf, 12),
    flags: u16(buf, 14),
    speed: u32(buf, 16),
    oframe1: u32(buf, 80),
    oframe2: u32(buf, 84),
    civ3
  };
}

function decodeCiv3Flc(filePathOrBuffer, options = {}) {
  const buf = readFileBuffer(filePathOrBuffer);
  const meta = inspectCiv3Flc(buf);
  const palette = makeDefaultPalette();
  const frame = new Uint8Array(meta.width * meta.height);
  const frames = [];
  const chunkCounts = {};
  let current = frame;
  let off = 128;
  const maxFrames = Number.isFinite(Number(options.maxFrames)) && Number(options.maxFrames) > 0
    ? Math.floor(Number(options.maxFrames))
    : Number.MAX_SAFE_INTEGER;

  while (off + 6 <= buf.length) {
    const chunkSize = u32(buf, off);
    const chunkType = u16(buf, off + 4);
    if (chunkSize < 6 || off + chunkSize > buf.length) break;
    if (chunkType === CHUNK_FRAME) {
      const subCount = u16(buf, off + 6);
      let sub = off + 16;
      let touched = false;
      for (let i = 0; i < subCount && sub + 6 <= off + chunkSize; i += 1) {
        let subSize = u32(buf, sub);
        const subType = u16(buf, sub + 4);
        chunkCounts[subType] = (chunkCounts[subType] || 0) + 1;
        if (subType === CHUNK_COLOR_256 && (subSize < 6 || sub + subSize > off + chunkSize)) {
          const fallback = Math.min(778, (off + chunkSize) - sub);
          subSize = fallback >= 6 ? fallback : subSize;
        }
        if (subSize < 6 || sub + subSize > off + chunkSize) break;
        const payload = buf.subarray(sub + 6, sub + subSize);
        if (subType === CHUNK_COLOR_256) {
          decodeColor256(payload, palette);
        } else if (subType === CHUNK_BYTE_RUN) {
          current = decodeByteRun(payload, meta.width, meta.height);
          touched = true;
        } else if (subType === CHUNK_FLI_COPY && payload.length >= current.length) {
          current = new Uint8Array(payload.subarray(0, current.length));
          touched = true;
        } else if (subType === CHUNK_BLACK) {
          current = new Uint8Array(current.length);
          touched = true;
        } else if (subType === CHUNK_DELTA_FLI) {
          decodeDeltaFli(payload, current, meta.width, meta.height);
          touched = true;
        } else if (subType === CHUNK_DELTA_FLC) {
          decodeDeltaFlc(payload, current, meta.width, meta.height);
          touched = true;
        }
        sub += subSize;
      }
      if (touched) {
        frames.push(new Uint8Array(current));
        if (frames.length >= maxFrames) break;
      }
    }
    off += chunkSize;
  }
  if (frames.length === 0) throw new Error('Could not decode FLC frames');
  return { meta, palette, frames, chunkCounts };
}

function rgbaFromIndexed(indices, palette, options = {}) {
  const rgba = new Uint8Array(indices.length * 4);
  const civPalette = options.civPalette || null;
  const applyCivColor = !!options.applyCivColor && civPalette && civPalette.length >= 768;
  const alpha = options.alpha !== false;
  for (let i = 0; i < indices.length; i += 1) {
    const idx = indices[i];
    let pal = palette;
    let a = 255;
    if (alpha && idx === 255) {
      a = 0;
    } else if (alpha && idx >= 240 && idx <= 254) {
      rgba[i * 4] = 0;
      rgba[i * 4 + 1] = 0;
      rgba[i * 4 + 2] = 0;
      rgba[i * 4 + 3] = Math.min(255, (255 - idx) * 16);
      continue;
    } else if (alpha && idx >= 224 && idx <= 239) {
      rgba[i * 4] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = Math.min(255, (idx - 224) * 16);
      continue;
    } else if (applyCivColor && (idx <= 14 || (idx >= 16 && idx <= 62 && (idx & 1) === 0))) {
      pal = civPalette;
    }
    rgba[i * 4] = pal[idx * 3] || 0;
    rgba[i * 4 + 1] = pal[idx * 3 + 1] || 0;
    rgba[i * 4 + 2] = pal[idx * 3 + 2] || 0;
    rgba[i * 4 + 3] = a;
  }
  return rgba;
}

function previewFromDecoded(decoded, options = {}) {
  const frameLimit = Number.isFinite(Number(options.frameLimit)) && Number(options.frameLimit) > 0
    ? Math.floor(Number(options.frameLimit))
    : decoded.frames.length;
  const civ3 = decoded.meta && decoded.meta.civ3 ? decoded.meta.civ3 : {};
  const sourceFrames = civ3.numAnims && civ3.animLength
    ? selectCiv3AnimationFrames(decoded.frames, civ3.numAnims, civ3.animLength)
    : decoded.frames;
  const frames = sourceFrames.slice(0, frameLimit);
  return {
    ok: true,
    width: decoded.meta.width,
    height: decoded.meta.height,
    animated: frames.length > 1,
    sourcePath: String(options.sourcePath || ''),
    framesBase64: frames.map((frame) => Buffer.from(rgbaFromIndexed(frame, decoded.palette, options)).toString('base64')),
    indexedFramesBase64: frames.map((frame) => Buffer.from(frame).toString('base64')),
    paletteBase64: Buffer.from(decoded.palette).toString('base64'),
    meta: decoded.meta,
    chunkCounts: decoded.chunkCounts
  };
}

function encodePcxRle(data) {
  const out = [];
  for (let i = 0; i < data.length;) {
    const value = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === value && run < 63) run += 1;
    if (run > 1 || (value & 0xc0) === 0xc0) {
      out.push(0xc0 | run, value);
    } else {
      out.push(value);
    }
    i += run;
  }
  return Buffer.from(out);
}

function encodeIndexedPcx(indices, palette, width, height) {
  if (!indices || indices.length !== width * height) throw new Error('PCX index data does not match dimensions');
  if (!palette || palette.length < 768) throw new Error('PCX palette must contain 256 RGB entries');
  const bytesPerLine = width % 2 === 0 ? width : width + 1;
  const header = Buffer.alloc(128, 0);
  header[0] = 10;
  header[1] = 5;
  header[2] = 1;
  header[3] = 8;
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(width - 1, 8);
  header.writeUInt16LE(height - 1, 10);
  header.writeUInt16LE(60, 12);
  header.writeUInt16LE(60, 14);
  header[65] = 1;
  header.writeUInt16LE(bytesPerLine, 66);
  header.writeUInt16LE(1, 68);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(bytesPerLine, 0);
    Buffer.from(indices.subarray(y * width, y * width + width)).copy(row, 0);
    rows.push(encodePcxRle(row));
  }
  return Buffer.concat([header, ...rows, Buffer.from([12]), Buffer.from(palette.subarray(0, 768))]);
}

function decodeIndexedPcx(filePathOrBuffer) {
  const buf = readFileBuffer(filePathOrBuffer);
  if (buf.length < 897) throw new Error('PCX too small');
  if (buf[0] !== 10 || buf[2] !== 1) throw new Error('Not an RLE PCX file');
  const bits = buf[3];
  const planes = buf[65];
  if (bits !== 8 || planes !== 1) throw new Error('Storyboard PCX must be 8-bit indexed color');
  if (buf[buf.length - 769] !== 12) throw new Error('Storyboard PCX missing 256-color palette');
  const width = u16(buf, 8) - u16(buf, 4) + 1;
  const height = u16(buf, 10) - u16(buf, 6) + 1;
  const bytesPerLine = u16(buf, 66);
  const dataEnd = buf.length - 769;
  const indices = new Uint8Array(width * height);
  let src = 128;
  let out = 0;
  for (let y = 0; y < height; y += 1) {
    const row = new Uint8Array(bytesPerLine);
    let x = 0;
    while (x < bytesPerLine && src < dataEnd) {
      const value = buf[src++];
      if ((value & 0xc0) === 0xc0) {
        const run = value & 0x3f;
        const fill = src < dataEnd ? buf[src++] : 0;
        row.fill(fill, x, Math.min(bytesPerLine, x + run));
        x += run;
      } else {
        row[x++] = value;
      }
    }
    indices.set(row.subarray(0, width), out);
    out += width;
  }
  return { width, height, indices, palette: new Uint8Array(buf.subarray(buf.length - 768)) };
}

function parseJascPalette(filePathOrBuffer) {
  const text = readFileBuffer(filePathOrBuffer).toString('latin1').replace(/\r\n/g, '\n');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== 'JASC-PAL' || lines[1] !== '0100') throw new Error('Not a JASC palette');
  const count = Number.parseInt(lines[2], 10);
  if (count !== 256) throw new Error('JASC palette must contain 256 colors');
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i += 1) {
    const parts = String(lines[i + 3] || '').split(/\s+/).map((part) => Number.parseInt(part, 10));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
      throw new Error(`Invalid JASC palette color at row ${i}`);
    }
    palette[i * 3] = parts[0];
    palette[i * 3 + 1] = parts[1];
    palette[i * 3 + 2] = parts[2];
  }
  return palette;
}

function encodeJascPalette(palette) {
  if (!palette || palette.length < 768) throw new Error('JASC palette must contain 256 RGB entries');
  const lines = ['JASC-PAL', '0100', '256'];
  for (let i = 0; i < 256; i += 1) {
    lines.push(`${palette[i * 3] || 0} ${palette[i * 3 + 1] || 0} ${palette[i * 3 + 2] || 0}`);
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'latin1');
}

function parseFlicsterFxm(filePathOrBuffer) {
  const buf = readFileBuffer(filePathOrBuffer);
  if (buf.length < FLICSTER_FXM_SIZE) throw new Error('Storyboard metadata is too small');
  const meta = {
    marker: u16(buf, 0),
    version: u16(buf, 2),
    fileType: u16(buf, 4),
    frameWidth: u16(buf, 6),
    frameHeight: u16(buf, 8),
    delay: u16(buf, 10),
    background: u16(buf, 12),
    civ3: {
      size: u32(buf, 64),
      flags: u32(buf, 68),
      numAnims: u16(buf, 72),
      animLength: u16(buf, 74),
      xOffset: u16(buf, 76),
      yOffset: u16(buf, 78),
      xsOrig: u16(buf, 80),
      ysOrig: u16(buf, 82),
      animTime: u32(buf, 84),
      directions: u32(buf, 88)
    }
  };
  if (meta.marker !== FLICSTER_FXM_HEADER_MARKER || meta.version !== FLICSTER_FXM_VERSION) {
    throw new Error('Unsupported storyboard header');
  }
  return meta;
}

function encodeFlicsterFxm(options) {
  const frameWidth = clampInt(options.frameWidth, 1, 65535, 1);
  const frameHeight = clampInt(options.frameHeight, 1, 65535, 1);
  const delay = clampInt(options.delay, 1, 65535, 100);
  const directionCount = clampInt(options.directionCount, 1, 255, 1);
  const framesPerDirection = clampInt(options.framesPerDirection, 1, 65535, 1);
  const xOffset = clampInt(options.xOffset, 0, 65535, Math.floor((DEFAULT_ORIGINAL_SIZE - frameWidth) / 2));
  const yOffset = clampInt(options.yOffset, 0, 65535, Math.floor((DEFAULT_ORIGINAL_SIZE - frameHeight) / 2));
  const xsOrig = clampInt(options.xsOrig, 1, 65535, DEFAULT_ORIGINAL_SIZE);
  const ysOrig = clampInt(options.ysOrig, 1, 65535, DEFAULT_ORIGINAL_SIZE);
  const directions = clampInt(options.directions, 0, 0xffffffff, directionCount === 8 ? 255 : 1);
  const buf = Buffer.alloc(FLICSTER_FXM_SIZE, 0);
  buf.writeUInt16LE(FLICSTER_FXM_HEADER_MARKER, 0);
  buf.writeUInt16LE(FLICSTER_FXM_VERSION, 2);
  buf.writeUInt16LE(1, 4);
  buf.writeUInt16LE(frameWidth, 6);
  buf.writeUInt16LE(frameHeight, 8);
  buf.writeUInt16LE(delay, 10);
  buf.writeUInt16LE(0xffff, 12);
  buf.writeUInt32LE(28, 64);
  buf.writeUInt32LE(0, 68);
  buf.writeUInt16LE(directionCount, 72);
  buf.writeUInt16LE(framesPerDirection, 74);
  buf.writeUInt16LE(xOffset, 76);
  buf.writeUInt16LE(yOffset, 78);
  buf.writeUInt16LE(xsOrig, 80);
  buf.writeUInt16LE(ysOrig, 82);
  buf.writeUInt32LE(framesPerDirection * delay, 84);
  buf.writeUInt32LE(directions, 88);
  return buf;
}

function storyboardDimensions(frameWidth, frameHeight, framesPerDirection, directionCount) {
  return {
    width: (frameWidth + GRID_SIZE) * framesPerDirection + GRID_SIZE,
    height: (frameHeight + GRID_SIZE) * directionCount + GRID_SIZE
  };
}

function buildStoryboardIndices(frames, palette, meta) {
  const frameWidth = meta.frameWidth;
  const frameHeight = meta.frameHeight;
  const framesPerDirection = meta.framesPerDirection;
  const directionCount = meta.directionCount;
  const dims = storyboardDimensions(frameWidth, frameHeight, framesPerDirection, directionCount);
  const indices = new Uint8Array(dims.width * dims.height);
  indices.fill(255);
  for (let y = 0; y < dims.height; y += 1) {
    for (let x = 0; x < dims.width; x += 1) {
      if (x % (frameWidth + GRID_SIZE) === 0 || y % (frameHeight + GRID_SIZE) === 0) {
        indices[y * dims.width + x] = 0;
      }
    }
  }
  for (let dir = 0; dir < directionCount; dir += 1) {
    for (let frameIdx = 0; frameIdx < framesPerDirection; frameIdx += 1) {
      const src = frames[dir * framesPerDirection + frameIdx];
      if (!src || src.length !== frameWidth * frameHeight) continue;
      const dstX = 1 + frameIdx * (frameWidth + GRID_SIZE);
      const dstY = 1 + dir * (frameHeight + GRID_SIZE);
      for (let y = 0; y < frameHeight; y += 1) {
        indices.set(src.subarray(y * frameWidth, y * frameWidth + frameWidth), (dstY + y) * dims.width + dstX);
      }
    }
  }
  return { ...dims, indices, palette };
}

function framesFromStoryboard(storyboard, meta) {
  const frameWidth = meta.frameWidth;
  const frameHeight = meta.frameHeight;
  const framesPerDirection = meta.framesPerDirection;
  const directionCount = meta.directionCount;
  const expected = storyboardDimensions(frameWidth, frameHeight, framesPerDirection, directionCount);
  if (storyboard.width !== expected.width || storyboard.height !== expected.height) {
    throw new Error(`Storyboard PCX is ${storyboard.width}x${storyboard.height}; expected ${expected.width}x${expected.height}`);
  }
  const frames = [];
  for (let dir = 0; dir < directionCount; dir += 1) {
    for (let frameIdx = 0; frameIdx < framesPerDirection; frameIdx += 1) {
      const frame = new Uint8Array(frameWidth * frameHeight);
      const srcX = 1 + frameIdx * (frameWidth + GRID_SIZE);
      const srcY = 1 + dir * (frameHeight + GRID_SIZE);
      for (let y = 0; y < frameHeight; y += 1) {
        frame.set(storyboard.indices.subarray((srcY + y) * storyboard.width + srcX, (srcY + y) * storyboard.width + srcX + frameWidth), y * frameWidth);
      }
      frames.push(frame);
    }
  }
  return frames;
}

function makeColor256Chunk(palette) {
  const payload = Buffer.alloc(2 + 2 + 768);
  payload.writeUInt16LE(1, 0);
  payload[2] = 0;
  payload[3] = 0;
  Buffer.from(palette.subarray(0, 768)).copy(payload, 4);
  return makeChunk(CHUNK_COLOR_256, payload);
}

function makeChunk(type, payload) {
  const header = Buffer.alloc(6);
  header.writeUInt32LE(6 + payload.length, 0);
  header.writeUInt16LE(type, 4);
  return Buffer.concat([header, payload]);
}

function makeFrame(chunks) {
  const payload = Buffer.concat(chunks);
  const header = Buffer.alloc(16, 0);
  header.writeUInt32LE(16 + payload.length, 0);
  header.writeUInt16LE(CHUNK_FRAME, 4);
  header.writeUInt16LE(chunks.length, 6);
  return Buffer.concat([header, payload]);
}

function makeByteRunChunk(frame, width, height) {
  const parts = [];
  for (let y = 0; y < height; y += 1) {
    const row = frame.subarray(y * width, y * width + width);
    const bytes = [0xcd];
    for (let x = 0; x < width;) {
      const value = row[x];
      let run = 1;
      while (x + run < width && row[x + run] === value && run < 127) run += 1;
      if (run >= 2) {
        bytes.push(run & 0xff, value);
        x += run;
      } else {
        const start = x;
        x += 1;
        while (x < width) {
          let nextRun = 1;
          while (x + nextRun < width && row[x + nextRun] === row[x] && nextRun < 127) nextRun += 1;
          if (nextRun >= 2 || x - start >= 127) break;
          x += 1;
        }
        const count = x - start;
        bytes.push((256 - count) & 0xff);
        for (let i = start; i < x; i += 1) bytes.push(row[i]);
      }
    }
    parts.push(Buffer.from(bytes));
  }
  return makeChunk(CHUNK_BYTE_RUN, Buffer.concat(parts));
}

function makeDeltaFlcChunk(frame, width, height) {
  const encodedLines = [];
  for (let y = 0; y < height; y += 1) {
    const row = frame.subarray(y * width, y * width + width);
    const packets = [];
    let x = 0;
    while (x < width) {
      const remaining = width - x;
      const pixelCount = Math.min(remaining, 254);
      const evenCount = pixelCount % 2 === 0 ? pixelCount : pixelCount - 1;
      if (evenCount > 0) {
        const wordCount = evenCount / 2;
        packets.push(Buffer.from([0, wordCount]));
        packets.push(Buffer.from(row.subarray(x, x + evenCount)));
        x += evenCount;
      }
      if (x < width) {
        const last = Buffer.alloc(2);
        last.writeInt16LE(-32768 | row[x], 0);
        packets.push(last);
        x += 1;
      }
    }
    const lineHeader = Buffer.alloc(2);
    lineHeader.writeUInt16LE(packets.filter((packet) => packet.length >= 2 && packet[0] === 0 && packet[1] > 0).length, 0);
    encodedLines.push(Buffer.concat([lineHeader, ...packets]));
  }
  const header = Buffer.alloc(2);
  header.writeUInt16LE(encodedLines.length, 0);
  return makeChunk(CHUNK_DELTA_FLC, Buffer.concat([header, ...encodedLines]));
}

function selectCiv3AnimationFrames(frames, directionCount, framesPerDirection) {
  const selected = [];
  const blockSize = framesPerDirection + 1;
  if (frames.length >= directionCount * blockSize) {
    for (let dir = 0; dir < directionCount; dir += 1) {
      const start = dir * blockSize;
      for (let i = 0; i < framesPerDirection; i += 1) selected.push(frames[start + i]);
    }
    return selected;
  }
  return frames.slice(0, directionCount * framesPerDirection);
}

function chooseStoryboardBackgroundIndex(frames, width, height) {
  const counts = new Map();
  const add = (idx) => counts.set(idx, (counts.get(idx) || 0) + 1);
  (Array.isArray(frames) ? frames : []).forEach((frame) => {
    if (!frame || frame.length < width * height) return;
    for (let x = 0; x < width; x += 1) {
      add(frame[x]);
      add(frame[(height - 1) * width + x]);
    }
    for (let y = 1; y < height - 1; y += 1) {
      add(frame[y * width]);
      add(frame[y * width + width - 1]);
    }
  });
  let best = 255;
  let bestCount = -1;
  counts.forEach((count, idx) => {
    if (count > bestCount) {
      best = idx;
      bestCount = count;
    }
  });
  return best;
}

function resizeIndexedFrameCanvas(frame, srcWidth, srcHeight, dstWidth, dstHeight, backgroundIndex) {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return frame;
  const out = new Uint8Array(dstWidth * dstHeight);
  out.fill(backgroundIndex);
  const copyWidth = Math.min(srcWidth, dstWidth);
  const copyHeight = Math.min(srcHeight, dstHeight);
  const srcX = Math.max(0, Math.floor((srcWidth - copyWidth) / 2));
  const srcY = Math.max(0, Math.floor((srcHeight - copyHeight) / 2));
  const dstX = Math.max(0, Math.floor((dstWidth - copyWidth) / 2));
  const dstY = Math.max(0, Math.floor((dstHeight - copyHeight) / 2));
  for (let y = 0; y < copyHeight; y += 1) {
    const sourceStart = (srcY + y) * srcWidth + srcX;
    const targetStart = (dstY + y) * dstWidth + dstX;
    out.set(frame.subarray(sourceStart, sourceStart + copyWidth), targetStart);
  }
  return out;
}

function prepareStoryboardExportFrames(decoded, meta, options = {}) {
  const sourceMeta = metadataFromDecoded(decoded);
  const sourceFrames = selectCiv3AnimationFrames(decoded.frames, sourceMeta.directionCount, sourceMeta.framesPerDirection);
  const backgroundIndex = chooseStoryboardBackgroundIndex(sourceFrames, sourceMeta.frameWidth, sourceMeta.frameHeight);
  const blankFrame = new Uint8Array(meta.frameWidth * meta.frameHeight);
  blankFrame.fill(backgroundIndex);
  const resizedSource = sourceFrames.map((frame) => resizeIndexedFrameCanvas(
    frame,
    sourceMeta.frameWidth,
    sourceMeta.frameHeight,
    meta.frameWidth,
    meta.frameHeight,
    backgroundIndex
  ));
  const frames = [];
  for (let dir = 0; dir < meta.directionCount; dir += 1) {
    const sourceDirStart = dir * sourceMeta.framesPerDirection;
    for (let frameIdx = 0; frameIdx < meta.framesPerDirection; frameIdx += 1) {
      const source = frameIdx < sourceMeta.framesPerDirection ? resizedSource[sourceDirStart + frameIdx] : null;
      frames.push(source || new Uint8Array(blankFrame));
    }
  }
  if (options.requireSourceFrames && frames.length < meta.directionCount * meta.framesPerDirection) {
    throw new Error(`FLC decoded ${frames.length} animation frames; expected ${meta.directionCount * meta.framesPerDirection}`);
  }
  return frames;
}

function encodeCiv3UnitFlc(frames, palette, options) {
  const frameWidth = clampInt(options.frameWidth, 1, 255, 1);
  const frameHeight = clampInt(options.frameHeight, 1, 255, 1);
  const directionCount = clampInt(options.directionCount, 1, 255, 1);
  const framesPerDirection = clampInt(options.framesPerDirection, 1, 65535, 1);
  const delay = clampInt(options.delay, 1, 65535, 100);
  if (!Array.isArray(frames) || frames.length < directionCount * framesPerDirection) {
    throw new Error('Not enough storyboard frames to encode FLC');
  }
  frames.forEach((frame, idx) => {
    if (!frame || frame.length !== frameWidth * frameHeight) throw new Error(`Frame ${idx} has invalid dimensions`);
  });
  const flcFrames = [];
  for (let dir = 0; dir < directionCount; dir += 1) {
    const first = frames[dir * framesPerDirection];
    const chunks = [makeByteRunChunk(first, frameWidth, frameHeight)];
    if (dir === 0) chunks.push(makeColor256Chunk(palette));
    flcFrames.push(makeFrame(chunks));
    for (let i = 1; i < framesPerDirection; i += 1) {
      flcFrames.push(makeFrame([makeDeltaFlcChunk(frames[dir * framesPerDirection + i], frameWidth, frameHeight)]));
    }
    flcFrames.push(makeFrame([makeDeltaFlcChunk(first, frameWidth, frameHeight)]));
  }
  const frameBytes = Buffer.concat(flcFrames);
  const header = Buffer.alloc(128, 0);
  header.writeUInt32LE(128 + frameBytes.length, 0);
  header.writeUInt16LE(FLC_MAGIC, 4);
  header.writeUInt16LE(directionCount * framesPerDirection, 6);
  header.writeUInt16LE(frameWidth, 8);
  header.writeUInt16LE(frameHeight, 10);
  header.writeUInt16LE(8, 12);
  header.writeUInt32LE(delay, 16);
  header.writeUInt32LE(0xf2f20000, 24);
  header.writeUInt32LE(0xf1f1, 28);
  header.writeUInt32LE(128, 80);
  const firstFrameSize = flcFrames[0] ? flcFrames[0].length : 0;
  header.writeUInt32LE(128 + firstFrameSize, 84);
  header.writeUInt32LE(28, 88);
  header.writeUInt32LE(0, 92);
  header.writeUInt16LE(directionCount, 96);
  header.writeUInt16LE(framesPerDirection, 98);
  header.writeUInt16LE(clampInt(options.xOffset, 0, 65535, 0), 100);
  header.writeUInt16LE(clampInt(options.yOffset, 0, 65535, 0), 102);
  header.writeUInt16LE(clampInt(options.xsOrig, 1, 65535, DEFAULT_ORIGINAL_SIZE), 104);
  header.writeUInt16LE(clampInt(options.ysOrig, 1, 65535, DEFAULT_ORIGINAL_SIZE), 106);
  header.writeUInt32LE(framesPerDirection * delay, 108);
  header.writeUInt32LE(clampInt(options.directions, 0, 0xffffffff, directionCount === 8 ? 255 : 1), 112);
  return Buffer.concat([header, frameBytes]);
}

function metadataFromDecoded(decoded) {
  const civ3 = decoded.meta.civ3 || {};
  const directionCount = civ3.numAnims || 1;
  const framesPerDirection = civ3.animLength || Math.max(1, Math.floor(decoded.frames.length / directionCount));
  return {
    frameWidth: decoded.meta.width,
    frameHeight: decoded.meta.height,
    directionCount,
    framesPerDirection,
    delay: decoded.meta.speed || Math.max(1, Math.round((civ3.animTime || 100) / framesPerDirection)),
    xOffset: civ3.xOffset || 0,
    yOffset: civ3.yOffset || 0,
    xsOrig: civ3.xsOrig || DEFAULT_ORIGINAL_SIZE,
    ysOrig: civ3.ysOrig || DEFAULT_ORIGINAL_SIZE,
    directions: civ3.directions || (directionCount === 8 ? 255 : 1)
  };
}

function exportFlicsterStoryboardFromFlc(flcPath, outputDir, options = {}) {
  const decoded = decodeCiv3Flc(flcPath);
  const meta = { ...metadataFromDecoded(decoded), ...(options.meta || {}) };
  const exportPalette = options.palette && options.palette.length >= 768 ? options.palette : decoded.palette;
  const sourceWidth = meta.frameWidth;
  const sourceHeight = meta.frameHeight;
  if (Number.isFinite(Number(options.frameWidth))) {
    meta.frameWidth = Math.max(sourceWidth, clampInt(options.frameWidth, 1, 255, sourceWidth));
  }
  if (Number.isFinite(Number(options.frameHeight))) {
    meta.frameHeight = Math.max(sourceHeight, clampInt(options.frameHeight, 1, 255, sourceHeight));
  }
  if (Number.isFinite(Number(options.framesPerDirection))) {
    meta.framesPerDirection = clampInt(options.framesPerDirection, 1, 64, meta.framesPerDirection);
  }
  if (Number.isFinite(Number(options.delay))) {
    meta.delay = clampInt(options.delay, 1, 65535, meta.delay);
  }
  meta.xOffset = Math.max(0, Math.round((meta.xsOrig - meta.frameWidth) / 2));
  meta.yOffset = Math.max(0, Math.round((meta.ysOrig - meta.frameHeight) / 2));
  const frames = prepareStoryboardExportFrames(decoded, meta);
  const stem = String(options.baseName || path.basename(flcPath, path.extname(flcPath))).trim() || 'animation';
  fs.mkdirSync(outputDir, { recursive: true });
  const storyboard = buildStoryboardIndices(frames, exportPalette, meta);
  const pcxPath = path.join(outputDir, `${stem}.pcx`);
  const palPath = path.join(outputDir, `${stem}.pal`);
  const alphaPalPath = path.join(outputDir, `${stem}_Alpha.pal`);
  const fxmPath = path.join(outputDir, `${stem}_StoryBoard.FXM`);
  fs.writeFileSync(pcxPath, encodeIndexedPcx(storyboard.indices, exportPalette, storyboard.width, storyboard.height));
  fs.writeFileSync(palPath, encodeJascPalette(exportPalette));
  fs.writeFileSync(alphaPalPath, encodeJascPalette(exportPalette));
  fs.writeFileSync(fxmPath, encodeFlicsterFxm(meta));
  return {
    ok: true,
    paths: { pcxPath, palPath, alphaPalPath, fxmPath },
    meta,
    storyboard: { width: storyboard.width, height: storyboard.height }
  };
}

function storyboardStemFromFxm(fxmPath) {
  const base = path.basename(fxmPath, path.extname(fxmPath));
  return base.replace(/_StoryBoard$/i, '');
}

function loadFlicsterStoryboard(fxmPath) {
  const fxm = parseFlicsterFxm(fxmPath);
  const dir = path.dirname(fxmPath);
  const stem = storyboardStemFromFxm(fxmPath);
  const pcxPath = path.join(dir, `${stem}.pcx`);
  const palPath = path.join(dir, `${stem}.pal`);
  const alphaPalPath = path.join(dir, `${stem}_Alpha.pal`);
  const pcx = decodeIndexedPcx(pcxPath);
  const palette = fs.existsSync(palPath) ? parseJascPalette(palPath) : pcx.palette;
  const alphaPalette = fs.existsSync(alphaPalPath) ? parseJascPalette(alphaPalPath) : null;
  const meta = {
    frameWidth: fxm.frameWidth,
    frameHeight: fxm.frameHeight,
    directionCount: fxm.civ3.numAnims,
    framesPerDirection: fxm.civ3.animLength,
    delay: fxm.delay,
    xOffset: fxm.civ3.xOffset,
    yOffset: fxm.civ3.yOffset,
    xsOrig: fxm.civ3.xsOrig,
    ysOrig: fxm.civ3.ysOrig,
    directions: fxm.civ3.directions
  };
  const frames = framesFromStoryboard(pcx, meta);
  return {
    ok: true,
    fxm,
    meta,
    paths: { fxmPath, pcxPath, palPath, alphaPalPath },
    storyboard: pcx,
    palette,
    alphaPalette,
    frames
  };
}

function buildFlcFromFlicsterStoryboard(fxmPath, outputPath) {
  const loaded = loadFlicsterStoryboard(fxmPath);
  const flc = encodeCiv3UnitFlc(loaded.frames, loaded.palette, loaded.meta);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, flc);
  return { ok: true, outputPath, meta: loaded.meta };
}

function inspectFlicsterStoryboard(fxmPath) {
  const loaded = loadFlicsterStoryboard(fxmPath);
  return {
    ok: true,
    meta: loaded.meta,
    storyboard: { width: loaded.storyboard.width, height: loaded.storyboard.height },
    paths: loaded.paths,
    frameCount: loaded.frames.length
  };
}

function resolveFlcPathFromUnitIniValue(unitIniPath, flcValue) {
  const raw = String(flcValue || '').trim().replace(/^["']|["']$/g, '');
  const normalized = raw.replace(/\\/g, path.sep).replace(/\//g, path.sep);
  return path.isAbsolute(normalized) || path.win32.isAbsolute(raw)
    ? normalized
    : path.normalize(path.join(path.dirname(unitIniPath), normalized));
}

function handleFlicWorkshop(payload = {}) {
  const action = String(payload.action || '').trim();
  if (action === 'inspectFlc') {
    const flcPath = String(payload.flcPath || '').trim();
    const decoded = decodeCiv3Flc(flcPath, { maxFrames: 1000 });
    return previewFromDecoded(decoded, { sourcePath: flcPath, frameLimit: 1000, alpha: payload.alpha !== false });
  }
  if (action === 'inspectUnitFlc') {
    const unitIniPath = String(payload.unitIniPath || '').trim();
    const flcPath = resolveFlcPathFromUnitIniValue(unitIniPath, payload.flcPath || '');
    const decoded = decodeCiv3Flc(flcPath, { maxFrames: 1000 });
    return previewFromDecoded(decoded, { sourcePath: flcPath, frameLimit: 1000, alpha: payload.alpha !== false });
  }
  if (action === 'exportStoryboard') {
    const palette = payload.paletteBase64
      ? new Uint8Array(Buffer.from(String(payload.paletteBase64 || ''), 'base64'))
      : null;
    return exportFlicsterStoryboardFromFlc(String(payload.flcPath || '').trim(), String(payload.outputDir || '').trim(), {
      baseName: payload.baseName,
      palette,
      delay: Number(payload.delay),
      frameWidth: Number(payload.frameWidth),
      frameHeight: Number(payload.frameHeight),
      framesPerDirection: Number(payload.framesPerDirection)
    });
  }
  if (action === 'inspectStoryboard') {
    return inspectFlicsterStoryboard(String(payload.fxmPath || '').trim());
  }
  if (action === 'buildFlc') {
    return buildFlcFromFlicsterStoryboard(String(payload.fxmPath || '').trim(), String(payload.outputPath || '').trim());
  }
  return { ok: false, error: 'Unknown FLC Workshop action' };
}

module.exports = {
  decodeCiv3Flc,
  inspectCiv3Flc,
  previewFromDecoded,
  parseFlicsterFxm,
  encodeFlicsterFxm,
  parseJascPalette,
  encodeJascPalette,
  encodeIndexedPcx,
  decodeIndexedPcx,
  buildStoryboardIndices,
  framesFromStoryboard,
  exportFlicsterStoryboardFromFlc,
  loadFlicsterStoryboard,
  encodeCiv3UnitFlc,
  selectCiv3AnimationFrames,
  buildFlcFromFlicsterStoryboard,
  inspectFlicsterStoryboard,
  handleFlicWorkshop
};
