const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  buildBaseModel,
  parseCivilopediaDocumentWithOrder,
  serializeCivilopediaDocumentWithOrder,
  parseSectionedConfig,
  serializeSectionedConfig,
  parseScenarioDistrictsText,
  serializeScenarioDistrictsText,
  parseBiqSectionsFromBuffer,
  resolveScenarioDir,
  resolvePaths,
  loadBundle,
  saveBundle
} = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-config-manager-'));
}

test('base config precedence is default -> scenario -> custom', () => {
  const defaultText = 'a = 1\nb = 2\n';
  const scenarioText = 'b = 20\nc = 30\n';
  const customText = 'c = 300\n';

  const model = buildBaseModel(defaultText, scenarioText, customText, 'scenario', '');
  assert.equal(model.effectiveMap.a, '1');
  assert.equal(model.effectiveMap.b, '20');
  assert.equal(model.effectiveMap.c, '300');
  assert.deepEqual(model.sourceOrder, ['default', 'scenario', 'custom']);
});

test('sectioned config parsing round-trips marker blocks', () => {
  const text = [
    '; header',
    '#District',
    'name = Encampment',
    'tooltip = Build Encampment',
    '',
    '#District',
    'name = Campus'
  ].join('\n');

  const parsed = parseSectionedConfig(text, '#District');
  assert.equal(parsed.sections.length, 2);
  assert.equal(parsed.sections[0].fields[0].key, 'name');
  assert.equal(parsed.sections[1].fields[0].value, 'Campus');

  const serialized = serializeSectionedConfig(parsed, '#District');
  assert.match(serialized, /#District/);
  assert.match(serialized, /name\s*=\s*Encampment/);
  assert.ok(serialized.endsWith('\n'));
});

test('sectioned config serialization preserves section comments', () => {
  const text = [
    '; header',
    '#District',
    '; keep this comment',
    'name = Encampment',
    '[LegacyTag]',
    'tooltip = Build Encampment',
    '',
    '#District',
    '; keep second',
    'name = Campus'
  ].join('\n');

  const parsed = parseSectionedConfig(text, '#District');
  const serialized = serializeSectionedConfig(parsed, '#District');
  assert.match(serialized, /; keep this comment/);
  assert.match(serialized, /\[LegacyTag\]/);
  assert.match(serialized, /; keep second/);
});

test('Civilopedia parse/serialize preserves preamble comments before first section', () => {
  const input = [
    '; Civilopedia.txt',
    '; Notes: test preamble',
    '',
    '#RACE_TEST',
    'Legacy overview',
    ''
  ].join('\n');
  const parsed = parseCivilopediaDocumentWithOrder(input);
  const serialized = serializeCivilopediaDocumentWithOrder(parsed);
  assert.match(serialized, /^; Civilopedia\.txt$/m);
  assert.match(serialized, /^; Notes: test preamble$/m);
  assert.match(serialized, /^#RACE_TEST$/m);
});

test('resolvePaths applies replacement precedence for sectioned configs', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();

  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Default\n', 'utf8');
  fs.writeFileSync(path.join(root, 'user.districts_config.txt'), '#District\nname = User\n', 'utf8');
  fs.writeFileSync(path.join(scenario, 'scenario.districts_config.txt'), '#District\nname = Scenario\n', 'utf8');

  const globalPaths = resolvePaths({ c3xPath: root, scenarioPath: scenario, mode: 'global' });
  const scenarioPaths = resolvePaths({ c3xPath: root, scenarioPath: scenario, mode: 'scenario' });

  assert.equal(globalPaths.districts.effectiveSource, 'user');
  assert.equal(scenarioPaths.districts.effectiveSource, 'scenario');
});

test('resolveScenarioDir supports scenarioPath as .biq file', () => {
  assert.equal(resolveScenarioDir('/tmp/MyScenario.biq'), '/tmp');
  assert.equal(resolveScenarioDir('/tmp/scenarios'), '/tmp/scenarios');
});

test('scenario districts codec preserves wonder completion fields and named tiles', () => {
  const text = [
    'DISTRICTS',
    '',
    '#District',
    'coordinates  = 14,9',
    'district     = "The Great Wall"',
    'wonder_city  = Rome',
    'wonder_name  = "The Great Wall"',
    '',
    '#NamedTile',
    'coordinates  = 15,9',
    'name         = Tiber River',
    ''
  ].join('\n');

  const parsed = parseScenarioDistrictsText(text);
  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(parsed.entries[0], {
    x: 14,
    y: 9,
    district: 'The Great Wall',
    wonderName: 'The Great Wall',
    wonderCity: 'Rome'
  });
  assert.deepEqual(parsed.namedTiles, [{ x: 15, y: 9, name: 'Tiber River' }]);

  const serialized = serializeScenarioDistrictsText(parsed);
  assert.match(serialized, /#District/);
  assert.match(serialized, /wonder_city\s+= Rome/);
  assert.match(serialized, /wonder_name\s+= The Great Wall/);
  assert.match(serialized, /#NamedTile/);
  assert.ok(serialized.endsWith('\n'));
});

test('parseBiqSectionsFromBuffer reads basic BIQ section metadata', () => {
  const header = Buffer.alloc(736, 0);
  header.write('BICX', 0, 'latin1');
  header.write('VER#', 4, 'latin1');
  header.writeUInt32LE(1, 8); // num headers
  header.writeUInt32LE(0x2d0, 12); // header len
  header.writeUInt32LE(12, 24); // major
  header.writeUInt32LE(8, 28); // minor
  header.write('Test BIQ', 672, 'latin1');

  const bldg = Buffer.alloc(4 + 4 + 4 + 4, 0);
  bldg.write('BLDG', 0, 'latin1');
  bldg.writeUInt32LE(1, 4); // count
  bldg.writeUInt32LE(4, 8); // record len
  bldg.writeUInt32LE(0x12345678, 12); // record payload

  const zeroSections = ['CTZN', 'CULT', 'DIFF', 'ERAS', 'ESPN', 'EXPR', 'GOOD', 'GOVT', 'RULE', 'PRTO', 'RACE', 'TECH', 'TFRM', 'TERR', 'WSIZ', 'GAME'].map((code) => {
    const sec = Buffer.alloc(8, 0);
    sec.write(code, 0, 'latin1');
    sec.writeUInt32LE(0, 4);
    return sec;
  });

  const buf = Buffer.concat([header, bldg, ...zeroSections]);
  const parsed = parseBiqSectionsFromBuffer(buf);
  assert.equal(parsed.versionTag, 'BICX');
  assert.equal(parsed.sections[0].code, 'BLDG');
  assert.equal(parsed.sections[0].count, 1);
  assert.equal(parsed.sections[parsed.sections.length - 1].code, 'GAME');
});

test('loadBundle + saveBundle writes to scope targets', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();

  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\nlimit = 1\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath: root, scenarioPath: scenario });
  const flag = bundle.tabs.base.rows.find((r) => r.key === 'flag');
  flag.value = 'false';

  const saveResult = saveBundle({
    mode: 'global',
    c3xPath: root,
    scenarioPath: scenario,
    tabs: bundle.tabs
  });

  assert.equal(saveResult.ok, true);
  const customPath = path.join(root, 'custom.c3x_config.ini');
  assert.equal(fs.existsSync(customPath), true);
  const savedText = fs.readFileSync(customPath, 'utf8');
  assert.match(savedText, /flag = false/);
});

test('loadBundle does not write target files before save', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');

  const customBase = path.join(root, 'custom.c3x_config.ini');
  const userDistricts = path.join(root, 'user.districts_config.txt');
  assert.equal(fs.existsSync(customBase), false);
  assert.equal(fs.existsSync(userDistricts), false);

  const bundle = loadBundle({ mode: 'global', c3xPath: root, scenarioPath: scenario });
  assert.ok(bundle && bundle.tabs && bundle.tabs.base);
  assert.equal(fs.existsSync(customBase), false);
  assert.equal(fs.existsSync(userDistricts), false);
});

test('saving new sectioned override file does not copy default docs/comments', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), [
    '[======================================================================= NOTE =======================================================================]',
    '[Instead of editing this file, changes should be placed in user/scenario files.]',
    '',
    '#District',
    '; default comment that should not be copied',
    'name = Base',
    'tooltip = Build Base',
    'img_paths = Base.pcx'
  ].join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath: root, scenarioPath: scenario });
  const section = bundle.tabs.districts.model.sections[0];
  const nameField = section.fields.find((f) => String(f && f.key || '').trim().toLowerCase() === 'name');
  assert.ok(nameField);
  nameField.value = 'Changed Name';

  const saveResult = saveBundle({
    mode: 'global',
    c3xPath: root,
    scenarioPath: scenario,
    tabs: bundle.tabs
  });
  assert.equal(saveResult.ok, true);

  const userDistrictsPath = path.join(root, 'user.districts_config.txt');
  const saved = fs.readFileSync(userDistrictsPath, 'utf8');
  assert.match(saved, /Managed by Civ 3 \| C3X Modern Configuration Manager/);
  assert.match(saved, /Mode: global/);
  assert.doesNotMatch(saved, /\[======================================================================= NOTE/);
  assert.doesNotMatch(saved, /default comment that should not be copied/);
  assert.match(saved, /#District/);
  assert.match(saved, /name\s*=\s*"Changed Name"/);
});

test('scenario Civilopedia save preserves windows-1252 text while applying edits', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');

  const civPath = path.join(textDir, 'Civilopedia.txt');
  const initial = [
    '#RACE_AZTECS',
    'Legacy Aztecs overview',
    '',
    '#DESC_RACE_AZTECS',
    'Legacy entry',
    '',
    '#RACE_MAYANS',
    'founded Tenochtitl\u00e1n',
    ''
  ].join('\n');
  fs.writeFileSync(civPath, Buffer.from(initial, 'latin1'));

  const tabs = {
    civilizations: {
      title: 'Civs',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'RACE_AZTECS',
          civilopediaSection1: 'Updated overview text',
          originalCivilopediaSection1: 'Legacy Aztecs overview',
          civilopediaSection2: 'Legacy entry',
          originalCivilopediaSection2: 'Legacy entry',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ],
      sourceDetails: {
        civilopediaScenario: civPath
      }
    }
  };

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs
  });
  assert.equal(saveResult.ok, true);

  const saved = fs.readFileSync(civPath);
  assert.ok(saved.includes(Buffer.from([0xe1])), 'expected windows-1252 encoded accented character byte');
  const asLatin1 = saved.toString('latin1');
  assert.match(asLatin1, /Updated overview text/);
  assert.match(asLatin1, /Tenochtitl\u00e1n/);
});

test('saveBundle rolls back earlier file writes if a later target fails', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');

  const scenarioBasePath = path.join(scenario, 'scenario.c3x_config.ini');
  const originalBaseText = 'flag = true\nkeep = original\n';
  fs.writeFileSync(scenarioBasePath, originalBaseText, 'utf8');

  const bundle = loadBundle({ mode: 'scenario', c3xPath: root, scenarioPath: scenario });
  const flagRow = bundle.tabs.base.rows.find((row) => row.key === 'flag');
  assert.ok(flagRow, 'expected base flag row');
  flagRow.value = 'false';

  const blocker = path.join(scenario, 'not-a-dir');
  fs.writeFileSync(blocker, 'x', 'utf8');
  const invalidCivilopediaPath = path.join(blocker, 'Civilopedia.txt');
  const tabs = {
    ...bundle.tabs,
    civilizations: {
      title: 'Civs',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'RACE_AZTECS',
          civilopediaSection1: 'Changed overview text',
          originalCivilopediaSection1: 'Original overview text',
          civilopediaSection2: '',
          originalCivilopediaSection2: '',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ],
      sourceDetails: {
        civilopediaScenario: invalidCivilopediaPath
      }
    }
  };

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs
  });

  assert.equal(saveResult.ok, false);
  assert.match(String(saveResult.error || ''), /rolled back/i);
  assert.equal(fs.readFileSync(scenarioBasePath, 'utf8'), originalBaseText);
});
