const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SCRIPT_DEFAULTS,
  generatedHourFolders,
  inspectToolchain,
  previewDayNightImage,
  runDayNightGeneration,
  scanDayNightInputs,
  seedDayNightSourceArt
} = require('../src/dayNightGenerator');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'day-night');
const EXPECTED_HOURS = [
  '0100', '0200', '0300', '0400', '0500', '0600', '0700', '0800',
  '0900', '1000', '1100', '1300', '1400', '1500', '1600', '1700',
  '1800', '1900', '2000', '2100', '2200', '2300', '2400'
];
const EXPECTED_SEASONS = ['Fall', 'Spring', 'Summer', 'Winter'];
const EXPECTED_DISTRICT_SOURCE_FILES = ['Campus.PCX', 'DataCenter.PCX', 'Wonders.PCX'];
const EXPECTED_TERRAIN_SOURCE_FILES = ['goodyhuts.pcx', 'xdgc.pcx'];

const FAMILY_ROOTS = Object.freeze({
  terrain: 'DayNight',
  districts: 'Districts'
});

const FAMILY_SOURCE_FILES = Object.freeze({
  terrain: EXPECTED_TERRAIN_SOURCE_FILES,
  districts: EXPECTED_DISTRICT_SOURCE_FILES
});

function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch (_err) {
    return false;
  }
}

function makeFixtureC3xRoot(parent, name) {
  const root = path.join(parent, name);
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(FIXTURE_ROOT, 'Art'), path.join(root, 'Art'), { recursive: true });
  return root;
}

function collectGeneratedPcx(root, family) {
  const base = path.join(root, 'Art', FAMILY_ROOTS[family]);
  const out = [];
  if (!dirExists(base)) return out;
  const visit = (dirPath) => {
    fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
      const child = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '1200' && entry.name !== 'Annotations') visit(child);
      } else if (entry.isFile() && /\.pcx$/i.test(entry.name) && !/_lights\.pcx$/i.test(entry.name)) {
        out.push(path.relative(base, child).replace(/\\/g, '/'));
      }
    });
  };
  visit(base);
  return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function collectNonAnnotationLightsPcx(root, family) {
  const base = path.join(root, 'Art', FAMILY_ROOTS[family]);
  const out = [];
  if (!dirExists(base)) return out;
  const visit = (dirPath) => {
    fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
      const child = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'Annotations') visit(child);
      } else if (entry.isFile() && /_lights\.pcx$/i.test(entry.name)) {
        out.push(path.relative(base, child).replace(/\\/g, '/'));
      }
    });
  };
  visit(base);
  return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function expectedGeneratedRelPaths(family) {
  const out = [];
  EXPECTED_SEASONS.forEach((season) => {
    EXPECTED_HOURS.forEach((hour) => {
      FAMILY_SOURCE_FILES[family].forEach((fileName) => {
        out.push(`${season}/${hour}/${fileName}`);
      });
    });
  });
  return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

function readGeneratedBytes(root, family, relPaths) {
  const out = new Map();
  relPaths.forEach((rel) => {
    out.set(rel, fs.readFileSync(path.join(root, 'Art', FAMILY_ROOTS[family], rel)));
  });
  return out;
}

test('day-night generator reports portable JavaScript toolchain', () => {
  const toolchain = inspectToolchain();
  assert.deepEqual(toolchain, {
    engine: 'javascript',
    portable: true,
    ok: true,
    missingToolFiles: [],
    requiredFiles: []
  });
  assert.deepEqual(generatedHourFolders(), EXPECTED_HOURS);
  assert.equal(SCRIPT_DEFAULTS.onlyHour, '');
});

test('day-night scan reports season 1200 source files and annotation coverage', () => {
  assert.equal(dirExists(FIXTURE_ROOT), true, 'day-night fixture is missing');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-scan-'));
  try {
    const root = makeFixtureC3xRoot(temp, 'scan');
    const scan = scanDayNightInputs({
      mode: 'global',
      c3xPath: root
    });
    assert.equal(scan.ok, true);
    assert.equal(scan.toolchain.engine, 'javascript');
    assert.equal(scan.toolchain.portable, true);
    const districts = scan.roots.find((entry) => entry.family === 'districts');
    const terrain = scan.roots.find((entry) => entry.family === 'terrain');
    assert.ok(terrain);
    assert.ok(districts);
    assert.deepEqual(terrain.seasons.map((season) => season.name).sort(), EXPECTED_SEASONS);
    assert.deepEqual(districts.seasons.map((season) => season.name).sort(), EXPECTED_SEASONS);
    terrain.seasons.forEach((season) => {
      assert.equal(season.noonExists, true, `${season.name} terrain 1200 folder`);
      assert.equal(season.fileCount, 2, `${season.name} terrain file count`);
      const byName = new Map(season.files.map((file) => [file.name, file]));
      assert.equal(byName.get('xdgc.pcx').hasSeasonAnnotation, false, `${season.name} xdgc season annotation`);
      assert.equal(byName.get('xdgc.pcx').hasSummerAnnotation, false, `${season.name} xdgc summer annotation`);
      assert.equal(Boolean(byName.get('xdgc.pcx').annotationPath), false, `${season.name} xdgc annotation path`);
      assert.equal(byName.get('goodyhuts.pcx').hasSummerAnnotation, true, `${season.name} goodyhuts summer annotation`);
      assert.equal(Boolean(byName.get('goodyhuts.pcx').annotationPath), true, `${season.name} goodyhuts annotation path`);
      assert.equal(byName.get('goodyhuts.pcx').hasSeasonAnnotation, season.name === 'Summer', `${season.name} goodyhuts season annotation`);
    });
    districts.seasons.forEach((season) => {
      assert.equal(season.noonExists, true, `${season.name} 1200 folder`);
      assert.equal(season.fileCount, 3, `${season.name} file count`);
      assert.equal(season.files.every((file) => file.hasSeasonAnnotation), true, `${season.name} annotations`);
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('day-night scan ignores district art when districts are disabled', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-disabled-districts-'));
  try {
    const root = makeFixtureC3xRoot(temp, 'scan');
    const scan = scanDayNightInputs({
      mode: 'global',
      c3xPath: root,
      districtsEnabled: false
    });
    assert.equal(scan.ok, true);
    assert.deepEqual(scan.disabledFamilies, ['districts']);
    assert.deepEqual(scan.roots.map((entry) => entry.family), ['terrain']);
    assert.equal(scan.warnings.some((warning) => /Districts art root is missing/.test(warning)), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('day-night source art seeding copies fallback art into a fenced scenario target', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-seed-'));
  try {
    const sourceRoot = path.join(temp, 'c3x');
    const scenarioRoot = path.join(temp, 'scenario');
    const sourceFile = path.join(sourceRoot, 'Art', 'Districts', 'Summer', '1200', 'Seed.PCX');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, 'seed-pcx-placeholder', 'utf8');
    fs.mkdirSync(scenarioRoot, { recursive: true });
    const scenarioPath = path.join(scenarioRoot, 'Scenario.biq');
    fs.writeFileSync(scenarioPath, '', 'utf8');
    const scan = scanDayNightInputs({
      mode: 'scenario',
      c3xPath: sourceRoot,
      scenarioPath
    });
    const districtCandidate = scan.seedCandidates.find((entry) => entry.family === 'districts');
    assert.ok(districtCandidate);
    assert.equal(districtCandidate.sourceRoot, path.join(sourceRoot, 'Art', 'Districts'));
    const result = seedDayNightSourceArt({
      mode: 'scenario',
      c3xPath: sourceRoot,
      scenarioPath,
      families: ['districts']
    });
    assert.equal(result.ok, true, result.error || '');
    assert.equal(result.copiedCount, 1);
    assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Art', 'Districts', 'Summer', '1200', 'Seed.PCX'), 'utf8'), 'seed-pcx-placeholder');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('day-night JavaScript backend generates every non-noon hourly output in each fixture season', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-all-seasons-'));
  try {
    const root = makeFixtureC3xRoot(temp, 'app');
    const progressImages = [];
    const result = await runDayNightGeneration({
      mode: 'global',
      c3xPath: root,
      families: ['terrain', 'districts'],
      options: SCRIPT_DEFAULTS
    }, {
      onProgress(entry) {
        if (entry && entry.stage === 'image') progressImages.push(entry.previewPath);
      }
    });
    assert.equal(result.ok, true, result.error || '');
    const terrainFiles = collectGeneratedPcx(root, 'terrain');
    const districtFiles = collectGeneratedPcx(root, 'districts');
    assert.deepEqual(terrainFiles, expectedGeneratedRelPaths('terrain'));
    assert.deepEqual(districtFiles, expectedGeneratedRelPaths('districts'));
    assert.equal(result.engine, 'javascript');
    assert.equal(result.generatedCount, 460);
    assert.equal(progressImages.length, 460);
    [
      ['terrain', terrainFiles],
      ['districts', districtFiles]
    ].forEach(([family, files]) => EXPECTED_SEASONS.forEach((season) => {
      const seasonFiles = files.filter((rel) => rel.startsWith(`${season}/`));
      const expectedSeasonFiles = FAMILY_SOURCE_FILES[family].length * EXPECTED_HOURS.length;
      assert.equal(seasonFiles.length, expectedSeasonFiles, `${family} ${season}`);
      const hours = [...new Set(seasonFiles.map((rel) => rel.split('/')[1]))].sort();
      assert.deepEqual(hours, EXPECTED_HOURS, `${family} ${season}`);
    }));
    assert.deepEqual(collectNonAnnotationLightsPcx(root, 'terrain'), []);
    assert.deepEqual(collectNonAnnotationLightsPcx(root, 'districts'), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('day-night JavaScript backend is byte-deterministic for the Instafluff 1200 sample', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-deterministic-'));
  try {
    const firstRoot = makeFixtureC3xRoot(temp, 'first');
    const secondRoot = makeFixtureC3xRoot(temp, 'second');
    for (const root of [firstRoot, secondRoot]) {
      const result = await runDayNightGeneration({
        mode: 'global',
        c3xPath: root,
        families: ['terrain', 'districts'],
        options: SCRIPT_DEFAULTS
      });
      assert.equal(result.ok, true, result.error || '');
    }
    Object.keys(FAMILY_ROOTS).forEach((family) => {
      const relPaths = collectGeneratedPcx(firstRoot, family);
      assert.deepEqual(relPaths, expectedGeneratedRelPaths(family));
      assert.deepEqual(collectGeneratedPcx(secondRoot, family), relPaths);
      const firstBytes = readGeneratedBytes(firstRoot, family, relPaths);
      const secondBytes = readGeneratedBytes(secondRoot, family, relPaths);
      relPaths.forEach((rel) => {
        assert.deepEqual(firstBytes.get(rel), secondBytes.get(rel), `${family}/${rel}`);
      });
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('day-night preview generates a single portable JavaScript image', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-preview-test-'));
  try {
    const root = makeFixtureC3xRoot(temp, 'preview');
    const result = await previewDayNightImage({
      filePath: path.join(root, 'Art', 'Districts', 'Summer', '1200', 'Campus.PCX'),
      annotationPath: path.join(root, 'Art', 'Districts', 'Summer', 'Annotations', 'Campus_lights.PCX'),
      hour: '2100',
      options: SCRIPT_DEFAULTS
    });
    assert.equal(result.ok, true, result.error || '');
    assert.equal(result.hour, '2100');
    assert.equal(result.width > 0, true);
    assert.equal(result.height > 0, true);
    assert.equal(Buffer.from(result.rgbaBase64, 'base64').length, result.width * result.height * 4);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('day-night preview accepts 1200 as the source-art point in the preview cycle', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-noon-preview-test-'));
  try {
    const root = makeFixtureC3xRoot(temp, 'preview');
    const result = await previewDayNightImage({
      filePath: path.join(root, 'Art', 'Districts', 'Summer', '1200', 'Campus.PCX'),
      hour: '1200',
      options: SCRIPT_DEFAULTS
    });
    assert.equal(result.ok, true, result.error || '');
    assert.equal(result.hour, '1200');
    assert.equal(result.width > 0, true);
    assert.equal(result.height > 0, true);
    assert.equal(Buffer.from(result.rgbaBase64, 'base64').length, result.width * result.height * 4);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
