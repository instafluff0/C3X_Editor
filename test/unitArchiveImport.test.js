const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { encodePcx, decodePcx } = require('../src/artPreview');
const { scanUnitImportSources, isUnsafeMemberPath } = require('../src/unitArchiveImport');

function makeIndexedPcx(width, height) {
  const palette = Buffer.alloc(768, 0);
  palette[255 * 3] = 255;
  palette[255 * 3 + 1] = 0;
  palette[255 * 3 + 2] = 255;
  const indices = new Uint8Array(width * height);
  indices.fill(255);
  for (let i = 0; i < indices.length; i += 7) indices[i] = 12;
  return encodePcx(indices, palette, width, height);
}

test('unit archive scanner detects unpacked unit folder and stages runtime-safe files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-unit-folder-'));
  const unitDir = path.join(root, 'Sample Unit');
  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(path.join(unitDir, 'Sample Unit.ini'), [
    '[Speed]',
    'Normal Speed=225',
    'Fast Speed=225',
    '',
    '[Animations]',
    'DEFAULT=Default.flc',
    'RUN=Run.flc',
    '',
    '[Timing]',
    'DEFAULT=0.500000',
    'RUN=0.500000',
    '',
    '[Sound Effects]',
    'DEFAULT=',
    'RUN='
  ].join('\n'));
  fs.writeFileSync(path.join(unitDir, 'Default.flc'), Buffer.from('not-a-real-flc'));
  fs.writeFileSync(path.join(unitDir, 'Run.flc'), Buffer.from('not-a-real-flc'));
  fs.writeFileSync(path.join(unitDir, 'Sample Unit_128.pcx'), makeIndexedPcx(128, 128));
  fs.writeFileSync(path.join(unitDir, 'Sample Unit_32.pcx'), makeIndexedPcx(32, 32));

  const result = await scanUnitImportSources([root]);
  assert.equal(result.ok, true);
  assert.equal(result.archives.length, 1);
  assert.equal(result.archives[0].sourceType, 'folder');
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.unitName, 'Sample Unit');
  assert.equal(candidate.targetLargePath, 'Art/Units/Sample Unit/Sample Unit_128.pcx');
  assert.equal(candidate.targetSmallPath, 'Art/Units/Sample Unit/Sample Unit_32.pcx');
  assert.equal(fs.existsSync(candidate.stagedIniPath), true);
  assert.equal(fs.existsSync(candidate.stagedUnit32Path), true);
  const stagedAtlas = decodePcx(fs.readFileSync(candidate.stagedUnit32Path), { returnIndexed: true });
  assert.equal(stagedAtlas.width, 33);
  assert.equal(stagedAtlas.height, 33);
});

test('unit archive scanner rejects traversal-style member paths', () => {
  assert.equal(isUnsafeMemberPath('../Art/Units/Evil.ini'), true);
  assert.equal(isUnsafeMemberPath('/Art/Units/Evil.ini'), true);
  assert.equal(isUnsafeMemberPath('Art/Units/Good/Good.ini'), false);
});
