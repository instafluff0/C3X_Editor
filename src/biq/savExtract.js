'use strict';

const fs = require('node:fs');
const iconv = require('iconv-lite');
const { decompress } = require('./decompress');

function readAscii(buf, off, len) {
  if (!Buffer.isBuffer(buf) || off < 0 || off + len > buf.length) return '';
  return buf.subarray(off, off + len).toString('latin1');
}

function readCStringWin1252(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const nullPos = bytes.indexOf(0);
  const body = nullPos >= 0 ? bytes.subarray(0, nullPos) : bytes;
  return iconv.decode(body, 'win1252').trim();
}

function ensureReadableRange(buf, off, len, label) {
  if (!Buffer.isBuffer(buf)) return { ok: false, error: 'Input is not a Buffer.' };
  if (off < 0 || len < 0 || off + len > buf.length) {
    return { ok: false, error: `SAV is truncated while reading ${label}.` };
  }
  return { ok: true };
}

function inflateSavIfNeeded(input) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (raw.length < 4) return { ok: false, error: 'SAV is too small to contain a Civ3 header.' };
  const magic = readAscii(raw, 0, 4);
  if (magic === 'CIV3') return { ok: true, buffer: raw, compressed: false };

  const inflated = decompress(raw);
  if (!inflated.ok) {
    return { ok: false, error: `SAV decompression failed: ${inflated.error || 'unknown error'}` };
  }
  if (readAscii(inflated.data, 0, 4) !== 'CIV3') {
    return { ok: false, error: 'Decompressed SAV does not start with CIV3.' };
  }
  return { ok: true, buffer: inflated.data, compressed: true };
}

function readSavPrefix(buf) {
  let off = 0;
  let range = ensureReadableRange(buf, off, 10, 'SAV prefix');
  if (!range.ok) return range;

  const header = readAscii(buf, off, 4); off += 4;
  if (header !== 'CIV3') return { ok: false, error: `Invalid SAV header: ${header || '(empty)'}` };

  const magicShort = buf.readUInt16LE(off); off += 2;
  const majorVersion = buf.readInt32LE(off); off += 4;
  let minorVersion = 0;
  let random16 = Buffer.alloc(0);

  if (majorVersion >= 17) {
    range = ensureReadableRange(buf, off, 4, 'SAV minor version');
    if (!range.ok) return range;
    minorVersion = buf.readInt32LE(off); off += 4;
    if (minorVersion >= 7) {
      range = ensureReadableRange(buf, off, 16, 'SAV random header bytes');
      if (!range.ok) return range;
      random16 = Buffer.from(buf.subarray(off, off + 16));
      off += 16;
    }
  }

  return {
    ok: true,
    offset: off,
    header,
    magicShort,
    majorVersion,
    minorVersion,
    random16,
  };
}

function extractEmbeddedBiqFromSavBuffer(input) {
  const inflated = inflateSavIfNeeded(input);
  if (!inflated.ok) return inflated;

  const sav = inflated.buffer;
  const prefix = readSavPrefix(sav);
  if (!prefix.ok) return prefix;

  const embeddedOffset = prefix.offset;
  const range = ensureReadableRange(sav, embeddedOffset, 12, 'embedded rules header');
  if (!range.ok) return range;

  const embeddedHeader = readAscii(sav, embeddedOffset, 4);
  if (!embeddedHeader.startsWith('BIC')) {
    return { ok: false, error: `Embedded rules header not found at offset ${embeddedOffset}: ${embeddedHeader || '(empty)'}` };
  }

  const sectionHeaderLength = sav.readUInt32LE(embeddedOffset + 4);
  const biqDataLength = sav.readUInt32LE(embeddedOffset + 8);
  if (sectionHeaderLength < 4) {
    return { ok: false, error: `Invalid embedded rules header length: ${sectionHeaderLength}` };
  }

  const embeddedInfoLength = sectionHeaderLength - 4;
  const embeddedInfoOffset = embeddedOffset + 12;
  const embeddedInfoRange = ensureReadableRange(sav, embeddedInfoOffset, embeddedInfoLength, 'embedded rules metadata');
  if (!embeddedInfoRange.ok) return embeddedInfoRange;

  const biqOffset = embeddedInfoOffset + embeddedInfoLength;
  const biqRange = ensureReadableRange(sav, biqOffset, biqDataLength, 'embedded BIQ data');
  if (!biqRange.ok) return biqRange;

  const biqBuffer = Buffer.from(sav.subarray(biqOffset, biqOffset + biqDataLength));
  const biqVersionTag = readAscii(biqBuffer, 0, 4);
  const biqVersionHeader = readAscii(biqBuffer, 4, 4);
  if (!biqVersionTag.startsWith('BIC') || biqVersionHeader !== 'VER#') {
    return { ok: false, error: `Embedded BIQ has invalid header: ${biqVersionTag} ${biqVersionHeader}` };
  }

  const embeddedInfo = sav.subarray(embeddedInfoOffset, embeddedInfoOffset + embeddedInfoLength);
  let searchPath = '';
  let saveFileName = '';
  if (embeddedInfo.length >= 520) {
    searchPath = readCStringWin1252(embeddedInfo.subarray(0, 260));
    saveFileName = readCStringWin1252(embeddedInfo.subarray(260, 520));
  }

  return {
    ok: true,
    buffer: biqBuffer,
    metadata: {
      compressed: inflated.compressed,
      savLength: sav.length,
      embeddedOffset,
      embeddedHeader,
      sectionHeaderLength,
      embeddedInfoLength,
      biqOffset,
      biqDataLength,
      biqVersionTag,
      biqVersionHeader,
      searchPath,
      saveFileName,
      savHeader: prefix.header,
      savMagicShort: prefix.magicShort,
      savMajorVersion: prefix.majorVersion,
      savMinorVersion: prefix.minorVersion,
    },
  };
}

function extractEmbeddedBiqFromSavFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: `SAV file not found: ${filePath || '(empty path)'}` };
  }
  return extractEmbeddedBiqFromSavBuffer(fs.readFileSync(filePath));
}

module.exports = {
  extractEmbeddedBiqFromSavBuffer,
  extractEmbeddedBiqFromSavFile,
  inflateSavIfNeeded,
};
