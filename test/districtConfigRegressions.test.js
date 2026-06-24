const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { parseSectionedConfig, resolvePaths, loadBundle } = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-district-reg-'));
}

function seedDefaultFiles(c3xPath) {
  fs.writeFileSync(
    path.join(c3xPath, 'default.districts_config.txt'),
    '#District\nname = Base\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(c3xPath, 'default.districts_wonders_config.txt'),
    '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(c3xPath, 'default.districts_natural_wonders_config.txt'),
    '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(c3xPath, 'default.tile_animations.txt'),
    '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n',
    'utf8'
  );
  fs.writeFileSync(path.join(c3xPath, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Bug 1: mixed quoted/unquoted lists in parseSectionedConfig
// ---------------------------------------------------------------------------

test('parseSectionedConfig preserves mixed quoted/unquoted list value intact', () => {
  // Regression: the old regex /^"[\s\S]*"$/ && !/",\s*"/ incorrectly stripped outer
  // quotes from values like `"Trading Post", Bazaar, Marketplace, "Town Hall"` because
  // the inner-quotes guard (",\s*") only matched adjacent quoted tokens.
  const raw = '"Trading Post", Bazaar, Marketplace, "Town Hall"';
  const text = ['#District', 'name = Trade District', `dependent_improvs = ${raw}`].join('\n');

  const parsed = parseSectionedConfig(text, '#District');
  const field = parsed.sections[0].fields.find((f) => f.key === 'dependent_improvs');
  assert.ok(field, 'expected dependent_improvs field');
  assert.equal(field.value, raw, 'mixed quoted/unquoted list must be preserved as-is');
});

test('parseSectionedConfig unquotes a simple single-token quoted value', () => {
  // The fix must not break the existing behaviour of stripping outer quotes from
  // simple single-token values like `"Trade District"`.
  const text = ['#District', 'name = "Trade District"'].join('\n');

  const parsed = parseSectionedConfig(text, '#District');
  const field = parsed.sections[0].fields.find((f) => f.key === 'name');
  assert.ok(field, 'expected name field');
  assert.equal(field.value, 'Trade District', 'simple quoted token should be unquoted');
});

test('parseSectionedConfig preserves comma-separated quoted list', () => {
  // Ensure a fully-quoted list `"A", "B", "C"` is also kept intact (inner quotes present).
  const raw = '"Trading Post", "Bazaar"';
  const text = ['#District', `dependent_improvs = ${raw}`].join('\n');

  const parsed = parseSectionedConfig(text, '#District');
  const field = parsed.sections[0].fields.find((f) => f.key === 'dependent_improvs');
  assert.ok(field, 'expected dependent_improvs field');
  assert.equal(field.value, raw, 'fully-quoted list must be preserved as-is');
});

// ---------------------------------------------------------------------------
// Bug 2: effectiveSource gates applySpecialDistrictDefaultsToSections in renderer
// The renderer only injects specials when effectiveSource === 'default'.
// Here we verify that resolvePaths correctly reports effectiveSource so the
// renderer gate can work.
// ---------------------------------------------------------------------------

test('resolvePaths districts effectiveSource is default when no user or scenario file exists', () => {
  const c3xPath = mkTmpDir();
  const scenDir = mkTmpDir();
  seedDefaultFiles(c3xPath);

  const paths = resolvePaths({ c3xPath, scenarioPath: scenDir, mode: 'scenario' });
  assert.equal(
    paths.districts.effectiveSource,
    'default',
    'should fall back to default when no user or scenario districts file exists'
  );
});

test('resolvePaths districts effectiveSource is user when user file exists', () => {
  // When a user.districts_config.txt exists it is the authoritative source; the
  // renderer must NOT re-inject special district defaults into the model.
  const c3xPath = mkTmpDir();
  seedDefaultFiles(c3xPath);
  fs.writeFileSync(
    path.join(c3xPath, 'user.districts_config.txt'),
    '#District\nname = User Custom\n',
    'utf8'
  );

  const paths = resolvePaths({ c3xPath, scenarioPath: '', mode: 'global' });
  assert.equal(
    paths.districts.effectiveSource,
    'user',
    'effectiveSource must be user when user.districts_config.txt exists'
  );
});

test('resolvePaths districts effectiveSource is scenario when scenario file exists', () => {
  // When a scenario.districts_config.txt exists it is the authoritative source; the
  // renderer must NOT re-inject special district defaults (like Aerodrome/Bridge) into
  // the model on load — doing so caused deleted districts to reappear after save/reload.
  const c3xPath = mkTmpDir();
  const scenDir = mkTmpDir();
  seedDefaultFiles(c3xPath);
  fs.writeFileSync(
    path.join(scenDir, 'scenario.districts_config.txt'),
    '#District\nname = Scenario Only\n',
    'utf8'
  );

  const paths = resolvePaths({ c3xPath, scenarioPath: scenDir, mode: 'scenario' });
  assert.equal(
    paths.districts.effectiveSource,
    'scenario',
    'effectiveSource must be scenario when scenario.districts_config.txt exists'
  );
});

test('loadBundle districts sourceDetails.hasScenario is false when no scenario districts file exists (default source)', () => {
  // filterDistrictSectionsForScenarioFallback (renderer) uses this flag to decide whether
  // to show the "Include these Districts in Scenario" button. It must be false when no
  // scenario.districts_config.txt exists, so the button is rendered.
  const c3xPath = mkTmpDir();
  const scenDir = mkTmpDir();
  seedDefaultFiles(c3xPath);

  const bundle = loadBundle({ mode: 'scenario', c3xPath, civ3Path: '', scenarioPath: scenDir });

  assert.ok(bundle && bundle.tabs && bundle.tabs.districts, 'expected districts tab');
  const sourceDetails = bundle.tabs.districts.sourceDetails || {};
  assert.equal(sourceDetails.hasScenario, false, 'hasScenario must be false when no scenario file');
  assert.equal(String(bundle.tabs.districts.effectiveSource || '').toLowerCase(), 'default');
});

test('loadBundle districts sourceDetails.hasScenario is false when user file present but no scenario file', () => {
  // Regression: when user.districts_config.txt exists, effectiveSource='user'.
  // filterDistrictSectionsForScenarioFallback used to guard on effectiveSource==='default' only,
  // so the "Include these Districts in Scenario" button never appeared even though hasScenario=false.
  const c3xPath = mkTmpDir();
  const scenDir = mkTmpDir();
  seedDefaultFiles(c3xPath);
  fs.writeFileSync(
    path.join(c3xPath, 'user.districts_config.txt'),
    '#District\nname = User Custom\n',
    'utf8'
  );

  const bundle = loadBundle({ mode: 'scenario', c3xPath, civ3Path: '', scenarioPath: scenDir });

  assert.ok(bundle && bundle.tabs && bundle.tabs.districts, 'expected districts tab');
  const sourceDetails = bundle.tabs.districts.sourceDetails || {};
  assert.equal(sourceDetails.hasScenario, false, 'hasScenario must be false when no scenario file exists');
  assert.equal(
    String(bundle.tabs.districts.effectiveSource || '').toLowerCase(),
    'user',
    'effectiveSource must be user when user.districts_config.txt exists but no scenario file'
  );
});

// ---------------------------------------------------------------------------
// Bug 3: targetPath must be non-null for new scenario files whose directory
// doesn't exist yet, so the Files Modal can show "View Changes".
// ---------------------------------------------------------------------------

test('loadBundle districts targetPath is non-null for shared-Scenarios BIQ with no sibling directory', () => {
  // Regression: when a BIQ lives in Conquests/Scenarios/ (shared-Scenarios layout) and
  // the companion sibling directory (e.g. Conquests/Scenarios/MyScen/) doesn't exist yet,
  // deriveScenarioPathContext returned contentWriteRoot='' which propagated to
  // resolvePaths as scenarioPath='' -> scenarioFilePath=null -> targetPath=null.
  // The fix adds expectedContentWriteRoot that is computed even when the directory is absent.
  const civ3Root = mkTmpDir();
  const scenariosDir = path.join(civ3Root, 'Conquests', 'Scenarios');
  fs.mkdirSync(scenariosDir, { recursive: true });
  // The sibling content directory intentionally does NOT exist:
  //   scenariosDir/MyScen  <-- absent
  const scenarioPath = path.join(scenariosDir, 'MyScen.biq');
  // Don't create the .biq file; loadBiqTab handles a missing file gracefully.

  const c3xPath = mkTmpDir();
  seedDefaultFiles(c3xPath);

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath,
    civ3Path: civ3Root,
    scenarioPath
  });

  assert.ok(bundle && bundle.tabs && bundle.tabs.districts, 'expected districts tab in bundle');
  const targetPath = bundle.tabs.districts.targetPath;
  assert.ok(targetPath, 'targetPath must be non-null/non-empty for new scenario district file');

  const expectedDir = path.join(scenariosDir, 'MyScen');
  const expectedTarget = path.join(expectedDir, 'scenario.districts_config.txt');
  assert.equal(
    path.normalize(targetPath),
    path.normalize(expectedTarget),
    'targetPath should point to scenario.districts_config.txt inside the expected sibling directory'
  );
});

test('loadBundle districts targetPath is non-null for a plain (non-shared) scenario directory', () => {
  // Ensure the common case (BIQ in its own self-contained directory) still gets a
  // non-null targetPath even before any scenario.districts_config.txt exists.
  const scenDir = mkTmpDir();
  const c3xPath = mkTmpDir();
  seedDefaultFiles(c3xPath);
  // Place a dummy .biq file so resolveBiqPath resolves it (or use the dir directly).
  const scenarioPath = path.join(scenDir, 'MyScen.biq');

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath,
    civ3Path: '',
    scenarioPath
  });

  assert.ok(bundle && bundle.tabs && bundle.tabs.districts, 'expected districts tab');
  const targetPath = bundle.tabs.districts.targetPath;
  assert.ok(targetPath, 'targetPath must be non-null for a plain scenario directory');
  assert.equal(
    path.normalize(targetPath),
    path.normalize(path.join(scenDir, 'scenario.districts_config.txt'))
  );
});
