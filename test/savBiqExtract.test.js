'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseAllSections } = require('../src/biq/biqSections');
const { decompress } = require('../src/biq/decompress');
const {
  extractEmbeddedBiqFromSavBuffer,
  extractEmbeddedBiqFromSavFile,
} = require('../src/biq/savExtract');

function fixedString(str, len) {
  const out = Buffer.alloc(len, 0);
  Buffer.from(String(str || ''), 'latin1').copy(out, 0, 0, len);
  return out;
}

function makeSavWithEmbeddedBiq(biqBuffer) {
  const savHeader = Buffer.alloc(30, 0);
  savHeader.write('CIV3', 0, 'latin1');
  savHeader.writeUInt16LE(0x1a00, 4);
  savHeader.writeInt32LE(24, 6);
  savHeader.writeInt32LE(10, 10);
  Buffer.from('0123456789ABCDEF', 'latin1').copy(savHeader, 14);

  const embeddedInfo = Buffer.concat([
    fixedString('Scenarios\\DebugScenario', 260),
    fixedString('DebugSave.SAV', 260),
  ]);
  const embeddedHeader = Buffer.alloc(12, 0);
  embeddedHeader.write('BIC ', 0, 'latin1');
  embeddedHeader.writeUInt32LE(524, 4);
  embeddedHeader.writeUInt32LE(biqBuffer.length, 8);

  return Buffer.concat([
    savHeader,
    embeddedHeader,
    embeddedInfo,
    biqBuffer,
    Buffer.from('GAME', 'latin1'),
  ]);
}

function readInflatedBiqFixture() {
  const biqPath = path.resolve(__dirname, 'fixtures', 'biq_playable_civs_fixture.biq');
  const raw = fs.readFileSync(biqPath);
  if (raw.subarray(0, 4).toString('latin1').startsWith('BIC')) return raw;
  const inflated = decompress(raw);
  assert.equal(inflated.ok, true, inflated.error);
  return inflated.data;
}

test('extractEmbeddedBiqFromSavBuffer returns exact embedded BIQ bytes', () => {
  const biq = readInflatedBiqFixture();
  const sav = makeSavWithEmbeddedBiq(biq);

  const result = extractEmbeddedBiqFromSavBuffer(sav);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.buffer, biq);
  assert.equal(result.metadata.savMajorVersion, 24);
  assert.equal(result.metadata.savMinorVersion, 10);
  assert.equal(result.metadata.embeddedOffset, 30);
  assert.equal(result.metadata.biqOffset, 562);
  assert.equal(result.metadata.biqDataLength, biq.length);
  assert.equal(result.metadata.searchPath, 'Scenarios\\DebugScenario');
  assert.equal(result.metadata.saveFileName, 'DebugSave.SAV');

  const parsed = parseAllSections(result.buffer);
  assert.equal(parsed.ok, true, parsed.error);
  assert.ok(parsed.sections.length > 0);
});

test('extract-biq-from-sav CLI writes extracted BIQ', (t) => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'c3x-sav-biq-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const biq = readInflatedBiqFixture();
  const savPath = path.join(tmp, 'debug.sav');
  const outPath = path.join(tmp, 'debug.biq');
  fs.writeFileSync(savPath, makeSavWithEmbeddedBiq(biq));

  const script = path.resolve(__dirname, '..', 'scripts', 'extract-biq-from-sav.js');
  const run = spawnSync(process.execPath, [script, savPath, outPath], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(fs.readFileSync(outPath), biq);
  assert.match(run.stdout, /BIQ bytes:/);
  assert.match(run.stdout, /SAV version: 24\.10/);
});

test('local Conquests save sample exposes parseable embedded BICQ rules', (t) => {
  const savPath = path.resolve(__dirname, '..', '..', 'Saves', 'Conquests Autosave 120 BC.SAV');
  if (!fs.existsSync(savPath)) {
    t.skip('Local Conquests save sample is not available.');
    return;
  }

  const result = extractEmbeddedBiqFromSavFile(savPath);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.metadata.biqVersionTag, 'BICQ');
  assert.equal(result.metadata.biqDataLength, 217086);

  const parsed = parseAllSections(result.buffer);
  assert.equal(parsed.ok, true, parsed.error);
  assert.ok(parsed.sections.some((section) => section.code === 'GOOD'), 'expected embedded save rules to include resources');
  assert.ok(parsed.sections.some((section) => section.code === 'GAME'), 'expected embedded save rules to include GAME options');
  assert.equal(parsed.sections.some((section) => section.code === 'TILE'), false, 'expected this sample embedded BIQ to be rules-only');
});
