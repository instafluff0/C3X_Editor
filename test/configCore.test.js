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
  collectBiqMapEdits,
  collectBiqMapStructureOps,
  loadMapImport,
  buildReferenceTabs,
  loadBundle,
  saveBundle,
  previewSavePlan,
  prepareImportedDistrictArtWrites,
  collectUnitRuntimeDependencyCopiesForImportedAnimation
} = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-config-manager-'));
}

function makeMapField(baseKey, value, originalValue) {
  return {
    key: baseKey,
    baseKey,
    label: baseKey,
    value: String(value),
    originalValue: String(originalValue == null ? value : originalValue)
  };
}

function getSection(sections, code) {
  const target = String(code || '').trim().toUpperCase();
  return (Array.isArray(sections) ? sections : []).find((section) => String(section && section.code || '').trim().toUpperCase() === target) || null;
}

function getRecordField(record, baseKey) {
  const target = String(baseKey || '').trim().toLowerCase();
  return (Array.isArray(record && record.fields) ? record.fields : []).find((field) => (
    String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target
  )) || null;
}

function getRecordValue(record, baseKey, fallback = '') {
  const field = getRecordField(record, baseKey);
  return field ? String(field.value || '') : String(fallback);
}

test('loadBundle preserves GAME locked-alliance war flags for Pacific scenario', (t) => {
  const civ3Root = path.resolve(__dirname, '..', '..', '..');
  const scenarioPath = path.join(civ3Root, 'Conquests', 'Scenarios', '9 MP WWII in the Pacific.biq');
  if (!fs.existsSync(scenarioPath)) {
    t.skip('Missing stock 9 MP WWII in the Pacific BIQ.');
    return;
  }
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: civ3Root,
    c3xPath: path.join(civ3Root, 'Conquests', 'C3X_Districts'),
    scenarioPath
  });
  const tab = bundle && bundle.tabs && bundle.tabs.scenarioSettings;
  const game = getSection(tab && tab.sections, 'GAME');
  const record = game && game.records && game.records[0];

  assert.equal(getRecordValue(record, 'alliance1_is_at_war_with_alliance2_0'), 'true');
  assert.equal(getRecordValue(record, 'alliance2_is_at_war_with_alliance1_0'), 'true');
});

test('buildReferenceTabs reads scenario text from BIQ search folders before BIQ directory fallback', () => {
  const civ3Root = mkTmpDir();
  const biqRoot = mkTmpDir();
  const firstSearchRoot = mkTmpDir();
  const secondSearchRoot = mkTmpDir();
  fs.mkdirSync(path.join(civ3Root, 'Conquests', 'Text'), { recursive: true });
  fs.writeFileSync(path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt'), '', 'latin1');
  fs.writeFileSync(path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt'), '', 'latin1');
  fs.writeFileSync(path.join(biqRoot, 'PediaIcons.txt'), '#ICON_BLDG_WRONG\nwrong.pcx\n', 'latin1');
  fs.mkdirSync(path.join(secondSearchRoot, 'Text'), { recursive: true });
  fs.writeFileSync(path.join(secondSearchRoot, 'Text', 'PediaIcons.txt'), '#ICON_BLDG_RIGHT\nright.pcx\n', 'latin1');

  const tabs = buildReferenceTabs(civ3Root, {
    mode: 'scenario',
    scenarioPath: biqRoot,
    scenarioPaths: [firstSearchRoot, secondSearchRoot]
  });

  const details = tabs.civilizations.sourceDetails;
  assert.equal(path.normalize(details.pediaIconsScenario), path.normalize(path.join(secondSearchRoot, 'Text', 'PediaIcons.txt')));
});

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

test('buildBaseModel includes R28 UI defaults missing from installed default config', () => {
  const model = buildBaseModel('enable_districts = true\n', '', '', 'global', '');
  const byKey = new Map(model.rows.map((row) => [row.key, row]));

  assert.equal(byKey.get('radar_tower_detection_distance').value, '0');
  assert.equal(byKey.get('outpost_detection_distance').value, '0');
  assert.equal(byKey.get('steal_plans_duration').value, '1');
  assert.equal(byKey.get('unit_limit_groups').value, '[]');
  assert.equal(byKey.get('enable_unit_counters').value, 'false');
  assert.equal(byKey.get('unit_groups').value, '[]');
  assert.equal(byKey.get('counter_rules').value, '[]');
  assert.equal(byKey.get('base_visibility_range').value, '1');
  assert.equal(byKey.get('unit_visibility_rules').value, '[Sea: 2 when-fortified-same-continent]');
  assert.equal(model.defaultMap.radar_tower_detection_distance, '0');
  assert.ok(model.commentsByKey.radar_tower_detection_distance.some((line) => /radar towers and outposts/i.test(line)));
});

test('prepareImportedDistrictArtWrites reuses same-name byte-identical target PCX', () => {
  const tmp = mkTmpDir();
  const sourceRoot = path.join(tmp, 'source');
  const targetRoot = path.join(tmp, 'target');
  const sourceArt = path.join(sourceRoot, 'Art', 'Districts', '1200');
  const targetArt = path.join(targetRoot, 'Art', 'Districts', '1200');
  fs.mkdirSync(sourceArt, { recursive: true });
  fs.mkdirSync(targetArt, { recursive: true });
  const data = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]);
  fs.writeFileSync(path.join(sourceArt, 'Depot.pcx'), data);
  fs.writeFileSync(path.join(targetArt, 'Depot.pcx'), data);
  const imported = {
    marker: '#District',
    fields: [
      { key: 'name', value: 'Depot' },
      { key: 'img_paths', value: 'Depot.pcx' }
    ],
    _pendingDistrictImport: {
      sourceScenarioPaths: [sourceRoot]
    }
  };
  const result = prepareImportedDistrictArtWrites({
    tabs: { districts: { model: { sections: [imported] } } },
    targetContentRoot: targetRoot,
    targetScenarioRoots: [targetRoot],
    c3xPath: '',
    civ3Path: ''
  });
  assert.equal(result.ok, true);
  assert.equal(result.writes.length, 0);
  assert.equal(imported.fields.find((field) => field.key === 'img_paths').value, 'Depot.pcx');
});

test('prepareImportedDistrictArtWrites gives imported PCX a unique name before overwriting a different target file', () => {
  const tmp = mkTmpDir();
  const sourceRoot = path.join(tmp, 'source');
  const targetRoot = path.join(tmp, 'target');
  const sourceArt = path.join(sourceRoot, 'Art', 'Districts', '1200');
  const targetArt = path.join(targetRoot, 'Art', 'Districts', '1200');
  fs.mkdirSync(sourceArt, { recursive: true });
  fs.mkdirSync(targetArt, { recursive: true });
  fs.writeFileSync(path.join(sourceArt, 'Depot.pcx'), Buffer.from([0x01, 0x02, 0x03]));
  fs.writeFileSync(path.join(targetArt, 'Depot.pcx'), Buffer.from([0x09, 0x08, 0x07]));
  const imported = {
    marker: '#District',
    fields: [
      { key: 'name', value: 'Depot' },
      { key: 'img_paths', value: 'Depot.pcx' }
    ],
    _pendingDistrictImport: {
      sourceScenarioPaths: [sourceRoot]
    }
  };
  const result = prepareImportedDistrictArtWrites({
    tabs: { districts: { model: { sections: [imported] } } },
    targetContentRoot: targetRoot,
    targetScenarioRoots: [targetRoot],
    c3xPath: '',
    civ3Path: ''
  });
  assert.equal(result.ok, true);
  assert.equal(result.writes.length, 1);
  assert.equal(path.basename(result.writes[0].path), 'Depot_2.pcx');
  assert.equal(imported.fields.find((field) => field.key === 'img_paths').value, 'Depot_2.pcx');
  assert.equal(fs.readFileSync(path.join(targetArt, 'Depot.pcx')).toString('hex'), '090807');
});

test('loadBundle uses bundled C3X base docs when installed default config is incomplete', () => {
  const root = mkTmpDir();
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'enable_districts = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '; empty\n', 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath: root, scenarioPath: '' });
  const row = bundle.tabs.base.rows.find((candidate) => candidate.key === 'steal_plans_duration');

  assert.equal(row.value, '1');
  assert.match(bundle.tabs.base.fieldDocs.steal_plans_duration, /Steal Plans/i);
  assert.match(bundle.tabs.base.fieldDocs.enable_unit_counters, /defender selection/i);
  assert.match(bundle.tabs.base.fieldDocs.counter_rules, /self-atk/i);
  assert.match(bundle.tabs.base.fieldDocs.terrain_visibility_see_height, /Height a unit is considered/i);
  assert.doesNotMatch(bundle.tabs.base.fieldDocs.terrain_visibility_see_height, /Entries are ordered as/i);
  assert.match(bundle.tabs.base.fieldDocs.terrain_visibility_seen_height, /occludes tiles beyond/i);
  assert.match(bundle.tabs.base.fieldDocs.unit_visibility_rules, /last matching rule is used/i);
  const baseKeys = bundle.tabs.base.rows.map((candidate) => candidate.key);
  assert.ok(
    baseKeys.indexOf('terrain_visibility_flat_bonus') >= 0,
    'terrain_visibility_flat_bonus should load from bundled defaults'
  );
  assert.equal(
    baseKeys.indexOf('terrain_visibility_bonus_can_stack'),
    baseKeys.indexOf('terrain_visibility_flat_bonus') + 1,
    'terrain_visibility_bonus_can_stack should appear directly after terrain_visibility_flat_bonus'
  );
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

test('scenario districts codec writes C3X natural wonder entries with canonical district name', () => {
  const text = [
    'DISTRICTS',
    '',
    '#District',
    'coordinates  = 10,30',
    'district     = Natural Wonder',
    'wonder_name  = "Mount Everest"',
    ''
  ].join('\n');

  const parsed = parseScenarioDistrictsText(text);
  assert.deepEqual(parsed.entries, [{
    x: 10,
    y: 30,
    district: 'Natural Wonder',
    wonderName: 'Mount Everest',
    wonderCity: ''
  }]);

  const serialized = serializeScenarioDistrictsText(parsed);
  assert.match(serialized, /district\s+= Natural Wonder/);
  assert.match(serialized, /wonder_name\s+= Mount Everest/);
  assert.doesNotMatch(serialized, /wonder_city\s+=/);
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

test('loadMapImport returns sanitized map-only replacement sections for source BIQ maps', () => {
  const scenarioPath = path.resolve(__dirname, 'fixtures', 'biq_map_units_fixture.biq');
  const result = loadMapImport({
    mode: 'scenario',
    civ3Path: path.resolve(__dirname, '..', '..'),
    scenarioPath
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceScenarioPath, scenarioPath);
  assert.ok(result.width > 0, 'expected source WMAP width');
  assert.ok(result.height > 0, 'expected source WMAP height');
  assert.ok(result.tileCount > 0, 'expected imported TILE records');
  assert.ok(result.durationMs >= 0, 'expected loader timing metadata');

  const sectionCodes = result.importedSections.map((section) => section.code);
  assert.deepEqual(sectionCodes, ['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY']);
  assert.equal(getSection(result.importedSections, 'CITY').records.length, 0);
  assert.equal(getSection(result.importedSections, 'UNIT').records.length, 0);
  assert.equal(getSection(result.importedSections, 'CLNY').records.length, 0);
  assert.equal(getSection(result.importedSections, 'SLOC').records.length, 0);

  const wmapRecord = getSection(result.importedSections, 'WMAP').records[0];
  assert.equal(getRecordValue(wmapRecord, 'numresources'), '0');
  assert.equal(Number(getRecordValue(wmapRecord, 'width')), result.width);
  assert.equal(Number(getRecordValue(wmapRecord, 'height')), result.height);

  const tileSection = getSection(result.importedSections, 'TILE');
  assert.equal(tileSection.records.length, result.tileCount);
  for (const tile of tileSection.records.slice(0, Math.min(20, tileSection.records.length))) {
    assert.equal(getRecordValue(tile, 'resource'), '-1');
    assert.equal(getRecordValue(tile, 'barbariantribe'), '-1');
    assert.equal(getRecordValue(tile, 'city'), '-1');
    assert.equal(getRecordValue(tile, 'colony'), '-1');
    assert.equal(getRecordValue(tile, 'border'), '0');
    assert.notEqual(getRecordValue(tile, 'xpos', ''), '', 'expected tile x coordinate for preview rendering');
    assert.notEqual(getRecordValue(tile, 'ypos', ''), '', 'expected tile y coordinate for preview rendering');
  }
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

test('saveBundle writes staged Tile Animation INI repairs to scenario Art/Animations', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  const animationsText = serializeSectionedConfig({
    sections: [
      {
        marker: '#Animation',
        comments: [],
        fields: [
          { key: 'name', value: 'Cow' },
          { key: 'ini_path', value: 'Resources\\Cow\\Cow.INI' },
          { key: 'type', value: 'resource' }
        ]
      }
    ]
  }, '#Animation', { kind: 'animations', mode: 'scenario', includeComments: false, includeManagedHeader: false });
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), animationsText, 'utf8');
  fs.writeFileSync(path.join(scenario, 'scenario.tile_animations.txt'), animationsText, 'utf8');
  const scenarioTextDir = path.join(scenario, 'Text');
  fs.mkdirSync(scenarioTextDir, { recursive: true });
  const pediaIconsText = '#ICON_PRTO_TEST\nart\\civilopedia\\icons\\units\\test.pcx\n';
  const civilopediaText = '#PRTO_TEST\nTest unit\n#DESC_PRTO_TEST\nTest unit details\n#EOF\n';
  fs.writeFileSync(path.join(scenarioTextDir, 'PediaIcons.txt'), pediaIconsText, 'latin1');
  fs.writeFileSync(path.join(scenarioTextDir, 'Civilopedia.txt'), civilopediaText, 'latin1');
  const sourceDir = path.join(root, 'Art', 'Animations', 'Resources', 'Cow');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'Cow.INI'), [
    '[Speed]',
    'Normal Speed=225',
    'Fast Speed=225',
    '',
    '[Animations]',
    'DEFAULT=cow.flc',
    'RUN=cow.flc',
    '',
    '[Timing]',
    'DEFAULT=0.170000',
    ''
  ].join('\r\n'), 'latin1');
  const bundle = loadBundle({ mode: 'scenario', c3xPath: root, scenarioPath: scenario });
  const section = bundle.tabs.animations.model.sections[0];
  section.pendingTileAnimationIniRepair = {
    iniPath: 'Resources\\Cow\\Cow.INI',
    sourcePath: path.join(sourceDir, 'Cow.INI'),
    flcFileName: 'cow.flc'
  };
  const preview = previewSavePlan({
    mode: 'scenario',
    c3xPath: root,
    scenarioPath: scenario,
    dirtyTabs: ['animations'],
    tabs: bundle.tabs
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.writes.some((write) => write.kind === 'animations'), false);
  assert.ok(preview.writes.some((write) => write.kind === 'tileAnimationIni'));
  assert.equal(preview.writes.some((write) => write.kind === 'pediaIcons'), false);
  assert.equal(preview.writes.some((write) => write.kind === 'civilopedia'), false);

  const saveResult = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    scenarioPath: scenario,
    dirtyTabs: ['animations'],
    tabs: bundle.tabs
  });

  assert.equal(saveResult.ok, true);
  const targetPath = path.join(scenario, 'Art', 'Animations', 'Resources', 'Cow', 'Cow.INI');
  const saved = fs.readFileSync(targetPath, 'latin1');
  assert.match(saved, /\[Animations\]\r?\nBLANK=\r?\nDEFAULT=cow\.flc\r?\nWALK=\r?\nRUN=\r?\nATTACK1=cow\.flc/);
  assert.match(saved, /\[Timing\]\r?\nDEFAULT=0\.170000/);
  assert.match(saved, /\[Sound Effects\]\r?\nBLANK=\r?\nDEFAULT=\r?\nWALK=/);
  assert.match(saved, /\[Version\]\r?\nVERSION=1/);
  assert.match(saved, /\[Palette\]\r?\nPALETTE=/);
  assert.equal(fs.readFileSync(path.join(scenarioTextDir, 'PediaIcons.txt'), 'latin1'), pediaIconsText);
  assert.equal(fs.readFileSync(path.join(scenarioTextDir, 'Civilopedia.txt'), 'latin1'), civilopediaText);
});

test('saveBundle rejects staged Tile Animation INI repairs in Standard Game mode', () => {
  const root = mkTmpDir();
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = Cow\nini_path = Resources\\Cow\\Cow.INI\ntype = resource\n', 'utf8');
  const bundle = loadBundle({ mode: 'global', c3xPath: root, scenarioPath: '' });
  bundle.tabs.animations.model.sections[0].pendingTileAnimationIniRepair = {
    iniPath: 'Resources\\Cow\\Cow.INI',
    flcFileName: 'cow.flc'
  };

  const saveResult = saveBundle({
    mode: 'global',
    c3xPath: root,
    dirtyTabs: ['animations'],
    tabs: bundle.tabs
  });

  assert.equal(saveResult.ok, false);
  assert.match(saveResult.error, /Scenario mode/i);
});

test('scenario unit import collects direct INI runtime dependencies from sibling unit folders', () => {
  const sourceRoot = mkTmpDir();
  const targetRoot = mkTmpDir();
  const gravityDir = path.join(sourceRoot, 'Art', 'Units', 'Gravity Armor');
  const hoverDir = path.join(sourceRoot, 'Art', 'Units', 'Hover Tank');
  fs.mkdirSync(gravityDir, { recursive: true });
  fs.mkdirSync(hoverDir, { recursive: true });
  fs.writeFileSync(path.join(gravityDir, 'Gravity Armor.INI'), [
    '[Animations]',
    'DEFAULT=GravityDefault.flc',
    '[Sound Effects]',
    'RUN=..\\Hover Tank\\HovertankRun.wav',
    ''
  ].join('\r\n'), 'latin1');
  fs.writeFileSync(path.join(gravityDir, 'GravityDefault.flc'), Buffer.from('flc'));
  fs.writeFileSync(path.join(hoverDir, 'HoverTankRun.wav'), Buffer.from('wav'));

  const copies = collectUnitRuntimeDependencyCopiesForImportedAnimation({
    animationName: 'Gravity Armor',
    sourceRoots: [sourceRoot],
    targetContentRoot: targetRoot
  });

  assert.equal(copies.length, 1);
  assert.equal(copies[0].sourcePath, path.join(hoverDir, 'HoverTankRun.wav'));
  assert.equal(copies[0].targetPath, path.join(targetRoot, 'Art', 'Units', 'Hover Tank', 'HovertankRun.wav'));
});

test('collectBiqMapStructureOps emits resizemap and collectBiqMapEdits skips resize-managed preview fields', () => {
  const editedTerrain = makeMapField('baserealterrain', 34, 18);
  editedTerrain.mapEditorValueEdited = true;
  const tabs = {
    map: {
      hasMapData: true,
      originalHasMap: true,
      mapMutation: null,
      pendingMapResize: { width: 140, height: 120, fillTerrain: 1, horizontalAnchor: 'west', verticalAnchor: 'north' },
      sections: [
        {
          code: 'WMAP',
          records: [{
            index: 0,
            fields: [
              makeMapField('width', 140, 130),
              makeMapField('height', 120, 110),
              makeMapField('flags', 3, 1)
            ]
          }]
        },
        {
          code: 'TILE',
          records: [{
            index: 0,
            fields: [
              makeMapField('xpos', 2, 0),
              makeMapField('ypos', 0, 0),
              makeMapField('baseterrain', 2, 1),
              editedTerrain
            ]
          }]
        },
        {
          code: 'CONT',
          records: [{
            index: 0,
            fields: [
              makeMapField('numtiles', 4000, 3000)
            ]
          }]
        }
      ]
    }
  };

  assert.deepEqual(collectBiqMapStructureOps(tabs), [{
    op: 'resizemap',
    width: 140,
    height: 120,
    fillTerrain: 1,
    horizontalAnchor: 'west',
    verticalAnchor: 'north'
  }]);
  assert.deepEqual(collectBiqMapEdits(tabs), [
    {
      sectionCode: 'WMAP',
      recordRef: '@INDEX:0',
      fieldKey: 'flags',
      value: '3'
    },
    {
      sectionCode: 'TILE',
      recordRef: '@INDEX:0',
      fieldKey: 'baserealterrain',
      value: '34'
    }
  ]);
});

test('collectBiqMapEdits includes volcano terrain and C3C overlay edits from map modal paint', () => {
  const volcanoPackedOnGrassland = (10 << 4) | 2;
  const roadAndCrater = 0x00000001 | 0x00000100;
  const baseTerrain = makeMapField('baserealterrain', volcanoPackedOnGrassland, 2);
  const c3cTerrain = makeMapField('c3cbaserealterrain', volcanoPackedOnGrassland, 2);
  const c3cOverlays = makeMapField('c3coverlays', roadAndCrater, 0);
  baseTerrain.mapEditorValueEdited = true;
  c3cTerrain.mapEditorValueEdited = true;
  c3cOverlays.mapEditorValueEdited = true;
  const tabs = {
    map: {
      hasMapData: true,
      originalHasMap: true,
      mapMutation: null,
      sections: [{
        code: 'TILE',
        records: [{
          index: 7,
          fields: [
            baseTerrain,
            c3cTerrain,
            c3cOverlays
          ]
        }]
      }]
    }
  };

  assert.deepEqual(collectBiqMapEdits(tabs), [
    {
      sectionCode: 'TILE',
      recordRef: '@INDEX:7',
      fieldKey: 'baserealterrain',
      value: String(volcanoPackedOnGrassland)
    },
    {
      sectionCode: 'TILE',
      recordRef: '@INDEX:7',
      fieldKey: 'c3cbaserealterrain',
      value: String(volcanoPackedOnGrassland)
    },
    {
      sectionCode: 'TILE',
      recordRef: '@INDEX:7',
      fieldKey: 'c3coverlays',
      value: String(roadAndCrater)
    }
  ]);
});

test('map-only BIQ save planning ignores stale reference field edits', () => {
  const root = mkTmpDir();
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
  const scenario = path.join(root, 'map-save-filter.biq');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'biq_map_units_fixture.biq'), scenario);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: root, scenarioPath: scenario });
  const mapTab = bundle.tabs.map;
  const tileSection = mapTab.sections.find((section) => section.code === 'TILE');
  const tile = tileSection.records[0];
  const terrainField = tile.fields.find((field) => field.baseKey === 'baserealterrain');
  terrainField.value = String((10 << 4) | 2);
  terrainField.mapEditorValueEdited = true;
  const c3cTerrainField = tile.fields.find((field) => field.baseKey === 'c3cbaserealterrain');
  c3cTerrainField.value = String((10 << 4) | 2);
  c3cTerrainField.mapEditorValueEdited = true;

  const staleCivField = bundle.tabs.civilizations.entries[0].biqFields.find((field) => field.baseKey === 'civilizationname');
  staleCivField.originalValue = `${staleCivField.value} stale`;

  const preview = previewSavePlan({
    mode: 'scenario',
    c3xPath: root,
    scenarioPath: scenario,
    dirtyTabs: ['map'],
    tabs: bundle.tabs
  });

  assert.equal(preview.ok, true, preview.error || 'preview failed');
  const biqReport = preview.saveReport.find((entry) => entry.kind === 'biq');
  assert.ok(biqReport, 'expected BIQ write for map edits');
  assert.equal(biqReport.skipped, 0);
  assert.ok(biqReport.applied >= 2);
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
  assert.match(saved, /Managed by Civ 3 \| C3X Modern Editor/);
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
