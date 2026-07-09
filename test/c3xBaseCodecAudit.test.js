const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadBundle,
  saveBundle,
  parseIniLines
} = require('../src/configCore');
const C3X_BASE_MANIFEST = require('../src/c3xBaseManifest');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-base-codec-'));
}

function writeMinimalNonBaseDefaults(c3xRoot) {
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_config.txt'), '; empty districts\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_wonders_config.txt'), '; empty wonders\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_natural_wonders_config.txt'), '; empty natural wonders\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.tile_animations.txt'), '; empty animations\n', 'utf8');
}

function getBaseRow(bundle, key) {
  const rows = bundle && bundle.tabs && bundle.tabs.base && Array.isArray(bundle.tabs.base.rows)
    ? bundle.tabs.base.rows
    : [];
  return rows.find((row) => String(row && row.key || '') === String(key || '')) || null;
}

test('C3X base string families serialize and reload with explicit audited syntax', () => {
  const sampleValueByKey = {
    ai_auto_build_great_wall_strategy: 'all-borders',
    ai_distribution_hub_build_strategy: 'by-city-count',
    ai_multi_start_extra_palaces: '["Forbidden Palace" "Heroic Epic"]',
    aircraft_victory_animation: 'victory',
    building_prereqs_for_units: '["Barracks": "Warrior" "Archer"]',
    buildings_generating_resources: '["Temple": local yields "Incense"]',
    can_bombard_only_sea_tiles: '["Submarine" "Torpedo Bomber"]',
    civ_aliases_by_era: '["America": "Roman Republic" "Roman Empire" "Modern America" "Future America"]',
    day_night_cycle_mode: 'specified',
    distribution_hub_yield_division_mode: 'scale-by-city-count',
    double_minimap_size: 'high-def',
    draw_lines_using_gdi_plus: 'always',
    enabled_seasons: '[summer winter]',
    exclude_types_from_units_per_tile_limit: '["Settler" "Worker"]',
    government_perfume: '["Despotism": 5]',
    great_wall_auto_build_wonder_name: '"The Great Wall"',
    land_retreat_rules: 'if-faster',
    land_transport_rules: '[load-onto-boat no-escape]',
    leader_aliases_by_era: '["Caesar": "Augustus" (M, Princeps) "Trajan" (M) "Hadrian" "Marcus Aurelius" (M, Emperor)]',
    limit_defensive_retreat_on_water_to_types: '["Destroyer" "Aegis Cruiser"]',
    override_barbarian_activity_level_for_scenario_maps: 'Raging',
    override_no_ai_patrol: 'zero',
    limit_units_per_tile: '[false false 10]',
    pinned_season_for_seasonal_cycle: 'winter',
    production_perfume: '["Temple": 20, "Warrior": -50%]',
    ptw_like_artillery_targeting: '["Catapult" "Artillery"]',
    resource_perfume: '["Coal": 20, "Iron": -50%]',
    sea_retreat_rules: 'if-not-slower',
    seasonal_cycle_mode: 'specified',
    show_tile_destruct_animation_after: '[bombard pillage]',
    special_defensive_bombard_rules: '[lethal aerial]',
    special_helicopter_rules: '[allow-on-carriers no-escape]',
    special_zone_of_control_rules: '[amphibious not-from-inside]',
    technology_perfume: '["Alphabet": 12]',
    unit_cycle_search_criteria: 'similar-near-destination',
    unit_limit_groups: '["Infantry Units": "Warrior" "Archer", Tanks: Tank Panzer]',
    unit_limits: '["Settler": 1 per-city]',
    work_area_improvements: '["Aqueduct": 3]',
    work_area_limit: 'cultural-or-adjacent'
  };

  const stringKeys = Object.entries(C3X_BASE_MANIFEST)
    .filter(([, meta]) => meta && meta.type === 'string')
    .map(([key]) => key)
    .sort();
  assert.deepEqual(stringKeys, Object.keys(sampleValueByKey).sort(), 'String audit map must cover every manifest string key');

  const c3xRoot = mkTmpDir();
  const defaultLines = ['; synthetic defaults for C3X string codec audit'];
  stringKeys.forEach((key) => {
    defaultLines.push(`${key} = `);
  });
  defaultLines.push('');
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), defaultLines.join('\n'), 'utf8');
  writeMinimalNonBaseDefaults(c3xRoot);

  const bundle = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });
  stringKeys.forEach((key) => {
    const row = getBaseRow(bundle, key);
    assert.ok(row, `Expected loaded base row for ${key}`);
    assert.equal(row.type, 'string', `${key} should load as string`);
    row.value = sampleValueByKey[key];
  });

  const save = saveBundle({
    mode: 'global',
    c3xPath: c3xRoot,
    scenarioPath: '',
    dirtyTabs: ['base'],
    tabs: bundle.tabs
  });
  assert.equal(save.ok, true, String(save.error || 'save failed'));

  const customPath = path.join(c3xRoot, 'custom.c3x_config.ini');
  const parsed = parseIniLines(fs.readFileSync(customPath, 'utf8'));
  stringKeys.forEach((key) => {
    assert.equal(parsed.map[key], sampleValueByKey[key], `${key} serialized with unexpected syntax`);
  });

  const reloaded = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });
  stringKeys.forEach((key) => {
    const row = getBaseRow(reloaded, key);
    assert.ok(row, `Expected reloaded row for ${key}`);
    assert.equal(row.value, sampleValueByKey[key], `${key} should round-trip through load/save without mutation`);
  });
});

test('C3X boolean and integer scalar families serialize and reload with explicit audited syntax', () => {
  const scalarKeys = Object.entries(C3X_BASE_MANIFEST)
    .filter(([, meta]) => meta && (meta.type === 'boolean' || meta.type === 'integer'))
    .map(([key]) => key)
    .sort();
  assert.ok(scalarKeys.length > 0, 'Expected scalar C3X base keys');

  const sampleValueByKey = {};
  scalarKeys.forEach((key, idx) => {
    const meta = C3X_BASE_MANIFEST[key];
    if (meta.type === 'boolean') sampleValueByKey[key] = idx % 2 === 0 ? 'true' : 'false';
    else sampleValueByKey[key] = String((idx + 1) * 7);
  });

  const c3xRoot = mkTmpDir();
  const defaultLines = ['; synthetic defaults for scalar C3X codec audit'];
  scalarKeys.forEach((key) => {
    defaultLines.push(`${key} = `);
  });
  defaultLines.push('');
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), defaultLines.join('\n'), 'utf8');
  writeMinimalNonBaseDefaults(c3xRoot);

  const bundle = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });
  scalarKeys.forEach((key) => {
    const row = getBaseRow(bundle, key);
    assert.ok(row, `Expected loaded scalar base row for ${key}`);
    assert.equal(row.type, C3X_BASE_MANIFEST[key].type, `${key} should load with manifest scalar type`);
    row.value = sampleValueByKey[key];
  });

  const save = saveBundle({
    mode: 'global',
    c3xPath: c3xRoot,
    scenarioPath: '',
    dirtyTabs: ['base'],
    tabs: bundle.tabs
  });
  assert.equal(save.ok, true, String(save.error || 'save failed'));

  const customPath = path.join(c3xRoot, 'custom.c3x_config.ini');
  const parsed = parseIniLines(fs.readFileSync(customPath, 'utf8'));
  scalarKeys.forEach((key) => {
    assert.equal(parsed.map[key], sampleValueByKey[key], `${key} scalar serialization drifted`);
  });

  const reloaded = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });
  scalarKeys.forEach((key) => {
    const row = getBaseRow(reloaded, key);
    assert.ok(row, `Expected reloaded scalar row for ${key}`);
    assert.equal(row.value, sampleValueByKey[key], `${key} scalar round-trip drifted`);
  });
});
