const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadBundle,
  saveBundle,
  previewFileDiff,
  parseIniLines,
  parseSectionedConfig
} = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-cfg-matrix-'));
}

function writeDefaults(c3xRoot) {
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), [
    '; default c3x',
    'flag = true',
    'limit = 10',
    'name = BaseName',
    ''
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(c3xRoot, 'default.districts_config.txt'), [
    '; header districts',
    '#District',
    'name = Encampment',
    'tooltip = Build Encampment',
    '',
    '#District',
    'name = Campus',
    'tooltip = Build Campus',
    ''
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(c3xRoot, 'default.districts_wonders_config.txt'), [
    '; header wonders',
    '#Wonder',
    'name = Great Library',
    'img_row = 0',
    'img_column = 0',
    'img_construct_row = 0',
    'img_construct_column = 0',
    '',
    '#Wonder',
    'name = Hanging Gardens',
    'img_row = 1',
    'img_column = 1',
    'img_construct_row = 1',
    'img_construct_column = 1',
    ''
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(c3xRoot, 'default.districts_natural_wonders_config.txt'), [
    '; header natural',
    '#Wonder',
    'name = Mt Fuji',
    'terrain_type = hills',
    'img_row = 0',
    'img_column = 0',
    '',
    '#Wonder',
    'name = Grand Canyon',
    'terrain_type = desert',
    'img_row = 1',
    'img_column = 1',
    ''
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(c3xRoot, 'default.tile_animations.txt'), [
    '; header animations',
    '#Animation',
    'name = Forest sway',
    'ini_path = Art\\Terrain\\Forest.ini',
    'type = terrain',
    'terrain_types = forest',
    '',
    '#Animation',
    'name = Volcano smoke',
    'ini_path = Art\\Terrain\\Volcano.ini',
    'type = terrain',
    'terrain_types = volcano',
    ''
  ].join('\n'), 'utf8');
}

const FIRAXIS_HOMELESS_BLOCK = [
  '#HomelessIcons',
  '#',
  'art\\civilopedia\\icons\\terrain\\borderslarge.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\borderssmall.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\riverslarge.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\riverssmall.pcx',
  '#END CIVILOPEDIA ART'
];

function pediaHomelessBody(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim().toUpperCase() === '#HOMELESSICONS');
  const end = start >= 0 ? lines.findIndex((line, idx) => idx > start && line.trim().toUpperCase() === '#END CIVILOPEDIA ART') : -1;
  return start >= 0 && end >= 0 ? lines.slice(start + 1, end) : [];
}

function sectionField(section, key) {
  return (section.fields || []).find((f) => String(f.key || '').trim().toLowerCase() === String(key || '').trim().toLowerCase()) || null;
}

function parseSectionFile(filePath, marker) {
  return parseSectionedConfig(fs.readFileSync(filePath, 'utf8'), marker);
}

function setBaseRowValue(bundle, key, value) {
  const rows = bundle && bundle.tabs && bundle.tabs.base && Array.isArray(bundle.tabs.base.rows)
    ? bundle.tabs.base.rows
    : [];
  const row = rows.find((r) => String(r && r.key || '') === String(key || ''));
  assert.ok(row, `Missing base row: ${key}`);
  row.value = String(value);
}

test('C3X base structured editor families persist and appear in file diff preview', () => {
  const c3xRoot = mkTmpDir();
  writeDefaults(c3xRoot);

  const defaultBasePath = path.join(c3xRoot, 'default.c3x_config.ini');
  fs.appendFileSync(defaultBasePath, [
    'limit_units_per_tile = false',
    'unit_cycle_search_criteria = [all]',
    'special_defensive_bombard_rules = [all]',
    'special_zone_of_control_rules = [all]',
    'land_transport_rules = [load-onto-boat]',
    'special_helicopter_rules = [allow-on-carriers]',
    'enabled_seasons = [summer fall winter spring]',
    'exclude_types_from_units_per_tile_limit = ["Worker"]',
    'limit_defensive_retreat_on_water_to_types = ["Submarine"]',
    'ptw_like_artillery_targeting = ["Artillery"]',
    'ai_multi_start_extra_palaces = ["Forbidden Palace"]',
    'production_perfume = ["Temple": 10]',
    'perfume_specs = ["Granary": 5]',
    'technology_perfume = ["Alphabet": 10]',
    'government_perfume = ["Despotism": 10]',
    'building_prereqs_for_units = ["Barracks": "Warrior"]',
    'buildings_generating_resources = ["Temple": local "Incense"]',
    'civ_aliases_by_era = []',
    'leader_aliases_by_era = []',
    'great_wall_auto_build_wonder_name = "The Great Wall"',
    ''
  ].join('\n'), 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });

  setBaseRowValue(bundle, 'limit_units_per_tile', '[2 3 4]');
  setBaseRowValue(bundle, 'unit_cycle_search_criteria', '[land, sea]');
  setBaseRowValue(bundle, 'special_defensive_bombard_rules', '[lethal aerial]');
  setBaseRowValue(bundle, 'special_zone_of_control_rules', '[amphibious not-from-inside]');
  setBaseRowValue(bundle, 'land_transport_rules', '[load-onto-boat no-escape]');
  setBaseRowValue(bundle, 'special_helicopter_rules', '[allow-on-carriers no-escape]');
  setBaseRowValue(bundle, 'enabled_seasons', '[summer winter]');
  setBaseRowValue(bundle, 'exclude_types_from_units_per_tile_limit', '["Settler" "Worker"]');
  setBaseRowValue(bundle, 'limit_defensive_retreat_on_water_to_types', '["Destroyer" "Aegis Cruiser"]');
  setBaseRowValue(bundle, 'ptw_like_artillery_targeting', '["Catapult" "Artillery"]');
  setBaseRowValue(bundle, 'ai_multi_start_extra_palaces', '["Forbidden Palace" Courthouse]');
  setBaseRowValue(bundle, 'production_perfume', '["Temple": 20, "Warrior": 8]');
  setBaseRowValue(bundle, 'perfume_specs', '["Granary": 15]');
  setBaseRowValue(bundle, 'technology_perfume', '["Alphabet": 12]');
  setBaseRowValue(bundle, 'government_perfume', '["Despotism": 5]');
  setBaseRowValue(bundle, 'building_prereqs_for_units', '["Barracks": "Warrior" "Archer"]');
  setBaseRowValue(bundle, 'buildings_generating_resources', '["Temple": local "Incense", "Marketplace": yields "Dyes"]');
  setBaseRowValue(bundle, 'civ_aliases_by_era', '[Rome: Rome "Byzantine Empire" Italy Italy, Roman: Roman Byzantine Italian Italian]');
  setBaseRowValue(bundle, 'leader_aliases_by_era', '["Caesar": "Augustus" (M, Princeps) "Trajan" (M) Hadrian]');
  setBaseRowValue(bundle, 'great_wall_auto_build_wonder_name', '"Pyramids"');

  const customPath = path.join(c3xRoot, 'custom.c3x_config.ini');
  const preview = previewFileDiff({
    mode: 'global',
    c3xPath: c3xRoot,
    scenarioPath: '',
    tabs: bundle.tabs,
    dirtyTabs: ['base'],
    targetPath: customPath
  });
  assert.equal(preview.ok, true, String(preview.error || 'preview failed'));
  assert.equal(preview.found, true, 'Expected pending write for custom.c3x_config.ini');
  const newText = String(preview.newText || '');
  [
    'limit_units_per_tile = [2 3 4]',
    'unit_cycle_search_criteria = [land, sea]',
    'special_defensive_bombard_rules = [lethal aerial]',
    'special_zone_of_control_rules = [amphibious not-from-inside]',
    'land_transport_rules = [load-onto-boat no-escape]',
    'special_helicopter_rules = [allow-on-carriers no-escape]',
    'enabled_seasons = [summer winter]',
    'exclude_types_from_units_per_tile_limit = ["Settler" "Worker"]',
    'limit_defensive_retreat_on_water_to_types = ["Destroyer" "Aegis Cruiser"]',
    'ptw_like_artillery_targeting = ["Catapult" "Artillery"]',
    'ai_multi_start_extra_palaces = ["Forbidden Palace" Courthouse]',
    'production_perfume = ["Temple": 20, "Warrior": 8]',
    'perfume_specs = ["Granary": 15]',
    'technology_perfume = ["Alphabet": 12]',
    'government_perfume = ["Despotism": 5]',
    'building_prereqs_for_units = ["Barracks": "Warrior" "Archer"]',
    'buildings_generating_resources = ["Temple": local "Incense", "Marketplace": yields "Dyes"]',
    'civ_aliases_by_era = [Rome: Rome "Byzantine Empire" Italy Italy, Roman: Roman Byzantine Italian Italian]',
    'leader_aliases_by_era = ["Caesar": "Augustus" (M, Princeps) "Trajan" (M) Hadrian]',
    'great_wall_auto_build_wonder_name = "Pyramids"'
  ].forEach((line) => assert.match(newText, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(' = ', '\\s*=\\s*'))));

  const save = saveBundle({
    mode: 'global',
    c3xPath: c3xRoot,
    scenarioPath: '',
    dirtyTabs: ['base'],
    tabs: bundle.tabs
  });
  assert.equal(save.ok, true, String(save.error || 'save failed'));

  const baseParsed = parseIniLines(fs.readFileSync(customPath, 'utf8'));
  assert.equal(baseParsed.map.limit_units_per_tile, '[2 3 4]');
  assert.equal(baseParsed.map.unit_cycle_search_criteria, '[land, sea]');
  assert.equal(baseParsed.map.special_defensive_bombard_rules, '[lethal aerial]');
  assert.equal(baseParsed.map.special_zone_of_control_rules, '[amphibious not-from-inside]');
  assert.equal(baseParsed.map.land_transport_rules, '[load-onto-boat no-escape]');
  assert.equal(baseParsed.map.special_helicopter_rules, '[allow-on-carriers no-escape]');
  assert.equal(baseParsed.map.enabled_seasons, '[summer winter]');
  assert.equal(baseParsed.map.exclude_types_from_units_per_tile_limit, '["Settler" "Worker"]');
  assert.equal(baseParsed.map.limit_defensive_retreat_on_water_to_types, '["Destroyer" "Aegis Cruiser"]');
  assert.equal(baseParsed.map.ptw_like_artillery_targeting, '["Catapult" "Artillery"]');
  assert.equal(baseParsed.map.ai_multi_start_extra_palaces, '["Forbidden Palace" Courthouse]');
  assert.equal(baseParsed.map.production_perfume, '["Temple": 20, "Warrior": 8]');
  assert.equal(baseParsed.map.perfume_specs, '["Granary": 15]');
  assert.equal(baseParsed.map.technology_perfume, '["Alphabet": 12]');
  assert.equal(baseParsed.map.government_perfume, '["Despotism": 5]');
  assert.equal(baseParsed.map.building_prereqs_for_units, '["Barracks": "Warrior" "Archer"]');
  assert.equal(baseParsed.map.buildings_generating_resources, '["Temple": local "Incense", "Marketplace": yields "Dyes"]');
  assert.equal(baseParsed.map.civ_aliases_by_era, '[Rome: Rome "Byzantine Empire" Italy Italy, Roman: Roman Byzantine Italian Italian]');
  assert.equal(baseParsed.map.leader_aliases_by_era, '["Caesar": "Augustus" (M, Princeps) "Trajan" (M) Hadrian]');
  assert.equal(baseParsed.map.great_wall_auto_build_wonder_name, '"Pyramids"');
});

test('C3X base parser reads CCM3-style multi-line alias lists as one value', () => {
  const parsed = parseIniLines([
    'civ_aliases_by_era = [Rome: Rome "The Italian city-states" Italy Italy, Italian: Roman,',
    'Greece: "The Greek city-states" "The Byzantine Empire", Greek: Greek Byzantine]',
    '',
    'leader_aliases_by_era = ["Julius Caesar": "Julius Caesar" (M, Emperor) "Lorenzo de Medici" (M, Duke) "Silvio Berlusconi" (M, "Prime Minister"),',
    '"Ramesses II": "Ramesses II" (M, Pharaoh) Baibars (M, Sultan)]',
    ''
  ].join('\n'));

  assert.equal(
    parsed.map.civ_aliases_by_era,
    '[Rome: Rome "The Italian city-states" Italy Italy, Italian: Roman,\nGreece: "The Greek city-states" "The Byzantine Empire", Greek: Greek Byzantine]'
  );
  assert.equal(
    parsed.map.leader_aliases_by_era,
    '["Julius Caesar": "Julius Caesar" (M, Emperor) "Lorenzo de Medici" (M, Duke) "Silvio Berlusconi" (M, "Prime Minister"),\n"Ramesses II": "Ramesses II" (M, Pharaoh) Baibars (M, Sultan)]'
  );
});

test('C3X write matrix (global): base + all sectioned files support edit/add/delete and preserve untouched entries', () => {
  const c3xRoot = mkTmpDir();
  writeDefaults(c3xRoot);

  const bundle = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });

  const flagRow = bundle.tabs.base.rows.find((r) => r.key === 'flag');
  const limitRow = bundle.tabs.base.rows.find((r) => r.key === 'limit');
  const nameRow = bundle.tabs.base.rows.find((r) => r.key === 'name');
  assert.ok(flagRow && limitRow && nameRow);
  flagRow.value = 'false';
  limitRow.value = '10';
  nameRow.value = 'New Base Name';
  bundle.tabs.base.rows.push({
    key: 'new_option',
    defaultValue: '',
    effectiveValue: '',
    value: '42',
    type: 'integer'
  });

  const mutateSectioned = (tabKey, newSectionName, markerFieldKey = 'name') => {
    const tab = bundle.tabs[tabKey];
    assert.ok(tab && tab.model && Array.isArray(tab.model.sections));

    const first = tab.model.sections[0];
    const second = tab.model.sections[1];
    assert.ok(first && second);

    const primary = sectionField(first, markerFieldKey);
    assert.ok(primary, `missing ${markerFieldKey} in ${tabKey}`);
    primary.value = `${primary.value} (edited)`;

    first.fields.push({ key: 'custom_unknown_field', value: `${tabKey}_custom_value` });

    tab.model.sections.splice(1, 1);

    tab.model.sections.unshift({
      marker: first.marker || (tab.marker || '#Section'),
      fields: [
        { key: markerFieldKey, value: newSectionName },
        { key: 'custom_unknown_field', value: `${tabKey}_new_section` }
      ],
      comments: []
    });
  };

  mutateSectioned('districts', 'Harbor', 'name');
  mutateSectioned('wonders', 'Pyramids', 'name');
  mutateSectioned('naturalWonders', 'Krakatoa', 'name');
  mutateSectioned('animations', 'New animation', 'name');

  const save = saveBundle({
    mode: 'global',
    c3xPath: c3xRoot,
    scenarioPath: '',
    tabs: bundle.tabs
  });
  assert.equal(save.ok, true, String(save.error || 'save failed'));

  const baseSaved = fs.readFileSync(path.join(c3xRoot, 'custom.c3x_config.ini'), 'utf8');
  const baseParsed = parseIniLines(baseSaved);
  assert.equal(baseParsed.map.flag, 'false');
  assert.equal(baseParsed.map.name, 'New Base Name');
  assert.equal(baseParsed.map.new_option, '42');
  assert.equal(Object.prototype.hasOwnProperty.call(baseParsed.map, 'limit'), false);

  const districts = parseSectionFile(path.join(c3xRoot, 'user.districts_config.txt'), '#District');
  const wonders = parseSectionFile(path.join(c3xRoot, 'user.districts_wonders_config.txt'), '#Wonder');
  const natural = parseSectionFile(path.join(c3xRoot, 'user.districts_natural_wonders_config.txt'), '#Wonder');
  const animations = parseSectionFile(path.join(c3xRoot, 'user.tile_animations.txt'), '#Animation');

  const verify = (model, expectedFirstName, tabKey) => {
    assert.ok(model.sections.length >= 2, `${tabKey} expected at least two sections`);
    assert.equal(sectionField(model.sections[0], 'name').value, expectedFirstName);
    assert.equal(sectionField(model.sections[0], 'custom_unknown_field').value, `${tabKey}_new_section`);
    assert.match(String(sectionField(model.sections[1], 'name').value), /\(edited\)$/);
    assert.equal(sectionField(model.sections[1], 'custom_unknown_field').value, `${tabKey}_custom_value`);
  };

  verify(districts, 'Harbor', 'districts');
  verify(wonders, 'Pyramids', 'wonders');
  verify(natural, 'Krakatoa', 'naturalWonders');
  verify(animations, 'New animation', 'animations');
});

test('C3X large sectioned files: single edit preserves all other entries', () => {
  const c3xRoot = mkTmpDir();
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_wonders_config.txt'), '; bulk wonders\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_natural_wonders_config.txt'), '; bulk natural\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.tile_animations.txt'), '; bulk animations\n', 'utf8');

  const districtsLines = ['; bulk districts'];
  for (let i = 0; i < 260; i += 1) {
    districtsLines.push('#District');
    districtsLines.push(`name = District ${i}`);
    districtsLines.push(`tooltip = Tooltip ${i}`);
    districtsLines.push('');
  }
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_config.txt'), `${districtsLines.join('\n')}\n`, 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });
  const sections = bundle.tabs.districts.model.sections;
  assert.equal(sections.length, 260);
  sectionField(sections[137], 'tooltip').value = 'Tooltip 137 edited';

  const result = saveBundle({
    mode: 'global',
    c3xPath: c3xRoot,
    scenarioPath: '',
    tabs: bundle.tabs
  });
  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const saved = parseSectionFile(path.join(c3xRoot, 'user.districts_config.txt'), '#District');
  assert.equal(saved.sections.length, 260);
  assert.equal(sectionField(saved.sections[0], 'name').value, 'District 0');
  assert.equal(sectionField(saved.sections[137], 'tooltip').value, 'Tooltip 137 edited');
  assert.equal(sectionField(saved.sections[259], 'name').value, 'District 259');
});

test('C3X scenario mode writes scenario-scoped files (not global user files)', () => {
  const c3xRoot = mkTmpDir();
  const scenarioDir = mkTmpDir();
  writeDefaults(c3xRoot);

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3xRoot, scenarioPath: scenarioDir });
  const flagRow = bundle.tabs.base.rows.find((r) => r.key === 'flag');
  assert.ok(flagRow);
  flagRow.value = 'false';

  const distFirst = bundle.tabs.districts.model.sections[0];
  sectionField(distFirst, 'name').value = 'Scenario Encampment';

  const saved = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    scenarioPath: scenarioDir,
    tabs: bundle.tabs
  });
  assert.equal(saved.ok, true, String(saved.error || 'save failed'));

  assert.equal(fs.existsSync(path.join(c3xRoot, 'custom.c3x_config.ini')), false);
  assert.equal(fs.existsSync(path.join(c3xRoot, 'user.districts_config.txt')), false);

  assert.equal(fs.existsSync(path.join(scenarioDir, 'scenario.c3x_config.ini')), true);
  assert.equal(fs.existsSync(path.join(scenarioDir, 'scenario.districts_config.txt')), true);

  const scenarioBase = parseIniLines(fs.readFileSync(path.join(scenarioDir, 'scenario.c3x_config.ini'), 'utf8'));
  assert.equal(scenarioBase.map.flag, 'false');
  const scenarioDistricts = parseSectionFile(path.join(scenarioDir, 'scenario.districts_config.txt'), '#District');
  assert.equal(sectionField(scenarioDistricts.sections[0], 'name').value, 'Scenario Encampment');
});

test('C3X scenario save repairs app-damaged PediaIcons HomelessIcons during unrelated base edit', () => {
  const c3xRoot = mkTmpDir();
  const scenarioDir = mkTmpDir();
  const textDir = path.join(scenarioDir, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  writeDefaults(c3xRoot);

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, [
    '#ICON_BLDG_GRANARY',
    'SINGLE',
    '10',
    'art\\civilopedia\\icons\\buildings\\granarylarge.pcx',
    'art\\civilopedia\\icons\\buildings\\granarysmall.pcx',
    '#HomelessIcons',
    '#ICON_BLDG_RESIN_SHOP',
    'SINGLE',
    '243',
    'Art\\Civilopedia\\Icons\\Buildings\\ResinL.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\ResinS.pcx',
    '#WON_SPLASH_BLDG_RESIN_SHOP',
    'Art\\Wonder Splash\\resin.pcx',
    '#END CIVILOPEDIA ART',
    '#WON_SPLASH_BLDG_Pyramids',
    'art\\wonder splash\\pyramid.pcx',
    ''
  ].join('\n'), 'latin1');

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3xRoot, scenarioPath: scenarioDir });
  const flagRow = bundle.tabs.base.rows.find((row) => row.key === 'flag');
  assert.ok(flagRow, 'expected base flag row');
  flagRow.value = 'false';

  const saved = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    scenarioPath: scenarioDir,
    tabs: bundle.tabs,
    dirtyTabs: ['base']
  });
  assert.equal(saved.ok, true, String(saved.error || 'save failed'));
  assert.ok((saved.saveReport || []).some((row) => row.kind === 'pediaIcons' && row.repaired), 'expected PediaIcons repair in save report');

  const repaired = fs.readFileSync(pediaIconsPath, 'latin1');
  assert.ok(repaired.includes(FIRAXIS_HOMELESS_BLOCK.join('\r\n')));
  assert.equal(pediaHomelessBody(repaired).some((line) => /^#(ICON_|WON_SPLASH_)/i.test(String(line || '').trim())), false);
  assert.ok(repaired.indexOf('#ICON_BLDG_RESIN_SHOP') < repaired.indexOf('#HomelessIcons'));
  assert.ok(repaired.indexOf('#WON_SPLASH_BLDG_RESIN_SHOP') > repaired.indexOf('#END CIVILOPEDIA ART'));
  assert.equal((repaired.match(/(?<!\r)\n/g) || []).length, 0);
});

test('C3X scenario mode writes edited scenario base values even when custom overrides them at runtime', () => {
  const c3xRoot = mkTmpDir();
  const scenarioDir = mkTmpDir();
  writeDefaults(c3xRoot);
  fs.appendFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), [
    'enable_stack_bombard = true',
    'enable_stack_unit_commands = true',
    ''
  ].join('\n'), 'utf8');

  fs.writeFileSync(path.join(c3xRoot, 'custom.c3x_config.ini'), [
    '; custom override',
    'flag = false',
    'limit = 25',
    'enable_stack_bombard = false',
    'enable_stack_unit_commands = false',
    ''
  ].join('\n'), 'utf8');

  const bundle = loadBundle({ mode: 'scenario', c3xPath: c3xRoot, scenarioPath: scenarioDir });
  const flagRow = bundle.tabs.base.rows.find((r) => r.key === 'flag');
  const limitRow = bundle.tabs.base.rows.find((r) => r.key === 'limit');
  const bombardRow = bundle.tabs.base.rows.find((r) => r.key === 'enable_stack_bombard');
  const commandsRow = bundle.tabs.base.rows.find((r) => r.key === 'enable_stack_unit_commands');
  assert.ok(flagRow && limitRow && bombardRow && commandsRow);

  // These values match defaults, but should still be written to scenario.c3x_config.ini
  // because the current effective values came from custom.c3x_config.ini.
  flagRow.value = 'true';
  limitRow.value = '10';
  bombardRow.value = 'true';

  const scenarioBasePath = path.join(scenarioDir, 'scenario.c3x_config.ini');
  const preview = previewFileDiff({
    mode: 'scenario',
    c3xPath: c3xRoot,
    scenarioPath: scenarioDir,
    tabs: bundle.tabs,
    dirtyTabs: ['base'],
    targetPath: scenarioBasePath
  });
  assert.equal(preview.ok, true, String(preview.error || 'preview failed'));
  assert.equal(preview.found, true, 'Expected pending write for scenario.c3x_config.ini');
  const newText = String(preview.newText || '');
  assert.match(newText, /flag\s*=\s*true/);
  assert.match(newText, /limit\s*=\s*10/);
  assert.match(newText, /enable_stack_bombard\s*=\s*true/);
  assert.doesNotMatch(newText, /enable_stack_unit_commands = false/);

  const saved = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    scenarioPath: scenarioDir,
    dirtyTabs: ['base'],
    tabs: bundle.tabs
  });
  assert.equal(saved.ok, true, String(saved.error || 'save failed'));

  const scenarioBase = parseIniLines(fs.readFileSync(scenarioBasePath, 'utf8'));
  assert.equal(scenarioBase.map.flag, 'true');
  assert.equal(scenarioBase.map.limit, '10');
  assert.equal(scenarioBase.map.enable_stack_bombard, 'true');
  assert.equal(Object.prototype.hasOwnProperty.call(scenarioBase.map, 'enable_stack_unit_commands'), false);
});

test('C3X-only transaction rollback restores earlier files when later commit fails', () => {
  const c3xRoot = mkTmpDir();
  writeDefaults(c3xRoot);

  const originalBasePath = path.join(c3xRoot, 'custom.c3x_config.ini');
  const originalDistrictsPath = path.join(c3xRoot, 'user.districts_config.txt');
  fs.writeFileSync(originalBasePath, 'flag = true\n', 'utf8');
  fs.writeFileSync(originalDistrictsPath, '#District\nname = Original District\n', 'utf8');
  const beforeBase = fs.readFileSync(originalBasePath, 'utf8');
  const beforeDistricts = fs.readFileSync(originalDistrictsPath, 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });
  bundle.tabs.base.rows.find((r) => r.key === 'flag').value = 'false';
  sectionField(bundle.tabs.districts.model.sections[0], 'name').value = 'Rollback Test District';

  const origRename = fs.renameSync;
  let injected = false;
  fs.renameSync = function patchedRename(from, to) {
    if (!injected && String(to || '').includes('user.districts_config.txt')) {
      injected = true;
      throw new Error('Injected rename failure');
    }
    return origRename.call(this, from, to);
  };

  try {
    const result = saveBundle({
      mode: 'global',
      c3xPath: c3xRoot,
      scenarioPath: '',
      tabs: bundle.tabs
    });
    assert.equal(result.ok, false);
    assert.match(String(result.error || ''), /rolled back/i);
  } finally {
    fs.renameSync = origRename;
  }

  assert.equal(fs.readFileSync(originalBasePath, 'utf8'), beforeBase);
  assert.equal(fs.readFileSync(originalDistrictsPath, 'utf8'), beforeDistricts);
});
