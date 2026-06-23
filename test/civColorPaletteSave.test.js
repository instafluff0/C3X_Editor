const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  inspectScenarioCivColorPalettes,
  saveBundle
} = require('../src/configCore');
const { encodePcx, decodePcx } = require('../src/artPreview');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-civ-palette-'));
}

function writeC3xDefaults(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = Wonder\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = Natural\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = Base\nini_path = Art\\Animations\\Base.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
}

function makePalette(slot, variant = 0) {
  const palette = new Uint8Array(256 * 3);
  for (let idx = 0; idx < 256; idx += 1) {
    const base = idx * 3;
    palette[base] = (idx + slot + variant) % 256;
    palette[base + 1] = (idx * 3 + slot + variant) % 256;
    palette[base + 2] = (idx * 7 + slot + variant) % 256;
  }
  const main = 7 * 3;
  palette[main] = (40 + slot * 5 + variant) % 256;
  palette[main + 1] = (90 + slot * 3 + variant) % 256;
  palette[main + 2] = (140 + slot * 7 + variant) % 256;
  return palette;
}

function writePalettePcx(filePath, slot, variant = 0) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const indices = new Uint8Array(16);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i % 16;
  fs.writeFileSync(filePath, encodePcx(indices, makePalette(slot, variant), 4, 4));
}

function setupPaletteScenario() {
  const civ3Root = mkTmpDir();
  const c3xRoot = mkTmpDir();
  writeC3xDefaults(c3xRoot);

  const basePaletteDir = path.join(civ3Root, 'Conquests', 'Art', 'Units', 'Palettes');
  for (let slot = 0; slot < 32; slot += 1) {
    writePalettePcx(path.join(basePaletteDir, `ntp${String(slot).padStart(2, '0')}.pcx`), slot, 0);
  }

  const scenarioDir = path.join(civ3Root, 'Conquests', 'Scenarios', 'PaletteScenario');
  fs.mkdirSync(scenarioDir, { recursive: true });
  const scenarioPath = path.join(scenarioDir, 'PaletteScenario.biq');
  fs.writeFileSync(scenarioPath, 'BICX', 'latin1');

  return { civ3Root, c3xRoot, scenarioDir, scenarioPath, basePaletteDir };
}

test('inspectScenarioCivColorPalettes resolves base palettes and scenario-local overrides', () => {
  const { civ3Root, scenarioDir, scenarioPath, basePaletteDir } = setupPaletteScenario();
  const scenarioPalettePath = path.join(scenarioDir, 'Art', 'Units', 'Palettes', 'ntp01.pcx');
  writePalettePcx(scenarioPalettePath, 1, 33);

  const result = inspectScenarioCivColorPalettes({
    civ3Path: civ3Root,
    scenarioPath
  });

  assert.equal(result.ok, true, String(result.error || 'inspect failed'));
  assert.equal(result.slots.length, 32);

  const slot0 = result.slots[0];
  assert.equal(slot0.sourceKind, 'base');
  assert.equal(slot0.sourcePath, path.join(basePaletteDir, 'ntp00.pcx'));
  assert.equal(slot0.targetPath, path.join(scenarioDir, 'Art', 'Units', 'Palettes', 'ntp00.pcx'));
  assert.deepEqual(slot0.representativeColor, {
    r: 40,
    g: 90,
    b: 140
  });

  const slot1 = result.slots[1];
  assert.equal(slot1.sourceKind, 'scenario');
  assert.equal(slot1.sourcePath, scenarioPalettePath);
  assert.equal(slot1.targetExists, true);
});

test('saveBundle writes scenario-local civ palette copies without changing source indices', () => {
  const { civ3Root, c3xRoot, scenarioPath, scenarioDir, basePaletteDir } = setupPaletteScenario();
  const inspect = inspectScenarioCivColorPalettes({
    civ3Path: civ3Root,
    scenarioPath
  });
  assert.equal(inspect.ok, true, String(inspect.error || 'inspect failed'));

  const slot = inspect.slots[3];
  const editedPalette = Buffer.from(slot.paletteBase64, 'base64');
  editedPalette[7 * 3] = 12;
  editedPalette[7 * 3 + 1] = 200;
  editedPalette[7 * 3 + 2] = 88;
  editedPalette[68 * 3] = 201;
  editedPalette[68 * 3 + 1] = 33;
  editedPalette[68 * 3 + 2] = 55;

  const save = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath,
    dirtyTabs: ['civpalettes'],
    tabs: {},
    civColorPalettes: {
      slots: [{
        slot: 3,
        sourcePath: slot.sourcePath,
        targetPath: slot.targetPath,
        paletteBase64: editedPalette.toString('base64')
      }]
    }
  });

  assert.equal(save.ok, true, String(save.error || 'save failed'));

  const targetPath = path.join(scenarioDir, 'Art', 'Units', 'Palettes', 'ntp03.pcx');
  assert.ok(fs.existsSync(targetPath), 'expected scenario-local ntp03 copy');

  const sourceDecoded = decodePcx(path.join(basePaletteDir, 'ntp03.pcx'), { returnIndexed: true, transparentIndexes: [] });
  const savedDecoded = decodePcx(targetPath, { returnIndexed: true, transparentIndexes: [] });
  assert.deepEqual(Array.from(savedDecoded.indices), Array.from(sourceDecoded.indices));
  assert.deepEqual(
    Array.from(savedDecoded.palette.slice(7 * 3, 7 * 3 + 3)),
    [12, 200, 88]
  );
  assert.deepEqual(
    Array.from(savedDecoded.palette.slice(68 * 3, 68 * 3 + 3)),
    [201, 33, 55]
  );
  assert.notDeepEqual(
    Array.from(sourceDecoded.palette.slice(7 * 3, 7 * 3 + 3)),
    [12, 200, 88]
  );
});

test('saveBundle refuses custom civ palette writes to base game targets', () => {
  const { civ3Root, c3xRoot, scenarioPath, basePaletteDir } = setupPaletteScenario();
  const sourcePath = path.join(basePaletteDir, 'ntp00.pcx');
  const palette = Buffer.from(decodePcx(sourcePath, { returnIndexed: true, transparentIndexes: [] }).palette);
  palette[7 * 3] = (palette[7 * 3] + 17) % 256;

  const save = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath,
    dirtyTabs: ['civpalettes'],
    tabs: {},
    civColorPalettes: {
      slots: [{
        slot: 0,
        sourcePath,
        targetPath: sourcePath,
        paletteBase64: palette.toString('base64')
      }]
    }
  });

  assert.equal(save.ok, false);
  assert.match(String(save.error || ''), /Refusing to modify (?:file outside scenario write roots|base Civilization III file)/i);
});
