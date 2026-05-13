const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { getPreview, parseUnitAnimationIni, resolveUnitIniPath, encodePcx } = require('../src/artPreview');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-unit-anim-'));
}

function encodeTruecolorPcx({ width, height, rgbAt }) {
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
  header.writeUInt16LE(72, 12);
  header.writeUInt16LE(72, 14);
  header[65] = 3;
  header.writeUInt16LE(bytesPerLine, 66);
  header.writeUInt16LE(1, 68);
  const body = [];
  const emit = (value) => {
    const v = value & 0xff;
    if (v >= 0xc0) body.push(0xc1, v);
    else body.push(v);
  };
  for (let y = 0; y < height; y += 1) {
    for (let plane = 0; plane < 3; plane += 1) {
      for (let x = 0; x < bytesPerLine; x += 1) {
        const rgb = x < width ? rgbAt(x, y) : [0, 0, 0];
        emit(rgb[plane]);
      }
    }
  }
  return Buffer.concat([header, Buffer.from(body)]);
}

test('parseUnitAnimationIni reads all FLC actions and picks DEFAULT as default action', () => {
  const root = mkTmpDir();
  const iniPath = path.join(root, 'Warrior.ini');
  fs.writeFileSync(path.join(root, 'Run.flc'), '');
  fs.writeFileSync(path.join(root, 'Default.flc'), '');
  fs.writeFileSync(path.join(root, 'AttackA.flc'), '');
  fs.writeFileSync(iniPath, [
    '[Animations]',
    'RUN = Run.flc',
    'DEFAULT = "Default.flc" ; inline comment',
    'ATTACK1 = AttackA.flc',
    '[Timing]',
    'RUN = 0.45',
    'ATTACK1 = 0.80',
    'SOUND = AttackA.wav',
    '; DEATH = Death.flc (commented out)'
  ].join('\n'), 'utf8');

  const parsed = parseUnitAnimationIni(iniPath);
  assert.ok(parsed);
  assert.equal(parsed.defaultActionKey, 'DEFAULT');
  assert.deepEqual(parsed.actions.map((a) => a.key), ['RUN', 'DEFAULT', 'ATTACK1']);
  assert.ok(Array.isArray(parsed.sections));
  const animationSection = parsed.sections.find((section) => String(section.name).toUpperCase() === 'ANIMATIONS');
  assert.ok(animationSection);
  assert.ok(animationSection.fields.some((field) => String(field.key).toUpperCase() === 'DEFAULT'));
  const run = parsed.actions.find((a) => a.key === 'RUN');
  const attack = parsed.actions.find((a) => a.key === 'ATTACK1');
  assert.equal(run.timingSeconds, 0.45);
  assert.equal(attack.timingSeconds, 0.8);
  assert.equal(parsed.actions.every((a) => a.exists), true);
});

test('resolveUnitIniPath prefers scenario unit folder over conquests/ptw/base', () => {
  const civ3Root = mkTmpDir();
  const scenario = mkTmpDir();
  const unit = 'Warrior';
  const basePath = path.join(civ3Root, 'Art', 'Units', unit);
  const ptwPath = path.join(civ3Root, 'civ3PTW', 'Art', 'Units', unit);
  const conqPath = path.join(civ3Root, 'Conquests', 'Art', 'Units', unit);
  const scenPath = path.join(scenario, 'Art', 'Units', unit);
  [basePath, ptwPath, conqPath, scenPath].forEach((p) => fs.mkdirSync(p, { recursive: true }));
  fs.writeFileSync(path.join(basePath, `${unit}.ini`), 'DEFAULT=Base.flc\n', 'utf8');
  fs.writeFileSync(path.join(ptwPath, `${unit}.ini`), 'DEFAULT=Ptw.flc\n', 'utf8');
  fs.writeFileSync(path.join(conqPath, `${unit}.ini`), 'DEFAULT=Conquests.flc\n', 'utf8');
  fs.writeFileSync(path.join(scenPath, `${unit}.ini`), 'DEFAULT=Scenario.flc\n', 'utf8');

  const resolved = resolveUnitIniPath(civ3Root, unit, scenario, []);
  assert.equal(resolved, path.join(scenPath, `${unit}.ini`));
});

test('resolveUnitIniPath prefers candidate whose INI resolves an existing FLC', () => {
  const civ3Root = mkTmpDir();
  const unit = 'Worker Modern Times';
  const ptwPath = path.join(civ3Root, 'civ3PTW', 'Art', 'Units', unit);
  const basePath = path.join(civ3Root, 'Art', 'Units', unit);
  fs.mkdirSync(ptwPath, { recursive: true });
  fs.mkdirSync(basePath, { recursive: true });
  fs.writeFileSync(path.join(ptwPath, `${unit}.ini`), 'DEFAULT=WorkerModernDefault.flc\n', 'utf8');
  fs.writeFileSync(path.join(basePath, `${unit}.ini`), 'DEFAULT=WorkerModernDefault.flc\n', 'utf8');
  fs.writeFileSync(path.join(basePath, 'WorkerModernDefault.flc'), '');

  const resolved = resolveUnitIniPath(civ3Root, unit, '', []);
  assert.equal(resolved, path.join(basePath, `${unit}.ini`));
});

test('unitAnimationManifest returns all parsed actions and source paths', () => {
  const civ3Root = mkTmpDir();
  const conquestsUnitDir = path.join(civ3Root, 'Conquests', 'Art', 'Units', 'Archer');
  fs.mkdirSync(conquestsUnitDir, { recursive: true });
  fs.writeFileSync(path.join(conquestsUnitDir, 'Archer.ini'), [
    'DEFAULT = ArcherDefault.flc',
    'ATTACK1 = ArcherAttack.flc',
    'FIDGET = Missing.flc',
    '[Timing]',
    'DEFAULT = 0.5'
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(conquestsUnitDir, 'ArcherDefault.flc'), '');
  fs.writeFileSync(path.join(conquestsUnitDir, 'ArcherAttack.flc'), '');

  const res = getPreview({
    kind: 'unitAnimationManifest',
    civ3Path: civ3Root,
    animationName: 'Archer'
  });
  assert.equal(res.ok, true);
  assert.equal(res.defaultActionKey, 'DEFAULT');
  assert.deepEqual(res.actions.map((a) => a.key), ['DEFAULT', 'ATTACK1', 'FIDGET']);
  assert.ok(Array.isArray(res.sections));
  assert.ok(res.sections.some((section) => String(section.name).toUpperCase() === 'TIMING'));
  const missing = res.actions.find((a) => a.key === 'FIDGET');
  assert.ok(missing);
  assert.equal(missing.exists, false);
  const def = res.actions.find((a) => a.key === 'DEFAULT');
  assert.equal(def.timingSeconds, 0.5);
});

test('civilopediaIcon preview does not treat palette slot 255 as transparent', () => {
  const civ3Root = mkTmpDir();
  const pcxPath = path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Buildings', 'slot255.pcx');
  fs.mkdirSync(path.dirname(pcxPath), { recursive: true });
  const indices = new Uint8Array(4);
  indices.fill(255);
  const palette = new Uint8Array(768);
  palette[255 * 3] = 60;
  palette[255 * 3 + 1] = 120;
  palette[255 * 3 + 2] = 180;
  fs.writeFileSync(pcxPath, encodePcx(indices, palette, 2, 2));

  const res = getPreview({
    kind: 'civilopediaIcon',
    civ3Path: civ3Root,
    assetPath: 'Art/Civilopedia/Icons/Buildings/slot255.pcx'
  });
  assert.equal(res.ok, true);
  const rgba = Buffer.from(res.rgbaBase64, 'base64');
  assert.equal(rgba[3], 255);
  assert.equal(rgba[0], 60);
  assert.equal(rgba[1], 120);
  assert.equal(rgba[2], 180);
});

test('civilopediaIcon preview decodes 24-bit three-plane PCX files', () => {
  const civ3Root = mkTmpDir();
  const pcxPath = path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Buildings', 'truecolor.pcx');
  fs.mkdirSync(path.dirname(pcxPath), { recursive: true });
  fs.writeFileSync(pcxPath, encodeTruecolorPcx({
    width: 2,
    height: 1,
    rgbAt: (x) => (x === 0 ? [10, 20, 30] : [200, 160, 120])
  }));

  const res = getPreview({
    kind: 'civilopediaIcon',
    civ3Path: civ3Root,
    assetPath: 'Art/Civilopedia/Icons/Buildings/truecolor.pcx'
  });
  assert.equal(res.ok, true);
  assert.equal(res.width, 2);
  assert.equal(res.height, 1);
  const rgba = Buffer.from(res.rgbaBase64, 'base64');
  assert.deepEqual(Array.from(rgba.slice(0, 8)), [10, 20, 30, 255, 200, 160, 120, 255]);
});
