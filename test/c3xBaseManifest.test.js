const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const C3X_BASE_MANIFEST = require('../src/c3xBaseManifest');
const { loadBundle } = require('../src/configCore');

const DEFAULT_BASE_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'default.c3x_config.manifest-fixture.ini');

function parseDefaultBaseKeysAndValues() {
  const text = fs.readFileSync(DEFAULT_BASE_FIXTURE_PATH, 'utf8');
  const keys = [];
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = String(match[1] || '').trim();
    keys.push(key);
    values[key] = String(match[2] || '').trim();
  }
  return {
    keys: Array.from(new Set(keys)),
    values
  };
}

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-base-manifest-'));
}

test('C3X base manifest explicitly covers every shipped default key', () => {
  const { keys } = parseDefaultBaseKeysAndValues();
  const manifestKeys = Object.keys(C3X_BASE_MANIFEST);
  const manifestSet = new Set(manifestKeys);
  const missing = keys.filter((key) => !manifestSet.has(key));

  assert.deepEqual(missing, [], `Missing manifest coverage for: ${missing.join(', ')}`);
  assert.ok(manifestSet.has('great_wall_districts_impassable_by_others'));
  assert.equal(manifestSet.has('great_wall_districts_Impassable_by_others'), false);
});

test('C3X base manifest extras are limited to explicit forward-compat keys', () => {
  const { keys } = parseDefaultBaseKeysAndValues();
  const defaultSet = new Set(keys);
  const manifestKeys = Object.keys(C3X_BASE_MANIFEST);
  const extras = manifestKeys.filter((key) => !defaultSet.has(key)).sort();

  assert.deepEqual(extras, []);
});

test('C3X base manifest type classifications match shipped default values', () => {
  const { keys, values } = parseDefaultBaseKeysAndValues();
  const specialTypeExpectations = {
    limit_railroad_movement: 'integer',
    limit_units_per_tile: 'string'
  };
  keys.forEach((key) => {
    const meta = C3X_BASE_MANIFEST[key];
    assert.ok(meta, `Expected manifest entry for ${key}`);
    if (Object.prototype.hasOwnProperty.call(specialTypeExpectations, key)) {
      assert.equal(meta.type, specialTypeExpectations[key], `${key} should use special manifest type ${specialTypeExpectations[key]}`);
      return;
    }
    const raw = String(values[key] || '').trim().toLowerCase();
    if (raw === 'true' || raw === 'false') {
      assert.equal(meta.type, 'boolean', `${key} should be classified as boolean`);
    } else if (/^-?\d+$/.test(raw)) {
      assert.equal(meta.type, 'integer', `${key} should be classified as integer`);
    } else {
      assert.equal(meta.type, 'string', `${key} should be classified as string`);
    }
  });
});

test('C3X base manifest assigns an explicit family to every key', () => {
  const { keys } = parseDefaultBaseKeysAndValues();
  keys.forEach((key) => {
    const meta = C3X_BASE_MANIFEST[key];
    assert.ok(meta, `Expected manifest entry for ${key}`);
    assert.ok(meta.family, `Expected family classification for ${key}`);
    if (meta.type === 'boolean') assert.equal(meta.family, 'boolean', `${key} should use boolean family`);
    if (meta.type === 'integer') assert.equal(meta.family, 'integer', `${key} should use integer family`);
  });
});

test('C3X base manifest string families stay explicit and audited', () => {
  const expectedFamilies = {
    ai_auto_build_great_wall_strategy: 'segmented_enum',
    ai_distribution_hub_build_strategy: 'segmented_enum',
    ai_multi_start_extra_palaces: 'quoted_reference_list',
    aircraft_victory_animation: 'segmented_enum',
    building_prereqs_for_units: 'building_prereq_list',
    buildings_generating_resources: 'building_resource_list',
    can_bombard_only_sea_tiles: 'quoted_reference_list',
    civ_aliases_by_era: 'civ_aliases_by_era',
    day_night_cycle_mode: 'segmented_enum',
    distribution_hub_yield_division_mode: 'segmented_enum',
    double_minimap_size: 'segmented_enum',
    draw_lines_using_gdi_plus: 'segmented_enum',
    enabled_seasons: 'bitfield_list',
    exclude_types_from_units_per_tile_limit: 'quoted_reference_list',
    government_perfume: 'name_amount_list',
    great_wall_auto_build_wonder_name: 'quoted_string',
    land_retreat_rules: 'segmented_enum',
    land_transport_rules: 'bitfield_list',
    leader_aliases_by_era: 'leader_aliases_by_era',
    limit_units_per_tile: 'stack_limit',
    limit_defensive_retreat_on_water_to_types: 'quoted_reference_list',
    override_barbarian_activity_level_for_scenario_maps: 'segmented_enum',
    override_no_ai_patrol: 'segmented_enum',
    pinned_season_for_seasonal_cycle: 'plain_string',
    production_perfume: 'name_amount_list',
    ptw_like_artillery_targeting: 'quoted_reference_list',
    resource_perfume: 'name_amount_list',
    sea_retreat_rules: 'segmented_enum',
    seasonal_cycle_mode: 'segmented_enum',
    show_tile_destruct_animation_after: 'bitfield_list',
    special_defensive_bombard_rules: 'bitfield_list',
    special_helicopter_rules: 'bitfield_list',
    special_zone_of_control_rules: 'bitfield_list',
    technology_perfume: 'name_amount_list',
    unit_cycle_search_criteria: 'segmented_enum',
    unit_limits: 'unit_limits',
    work_area_improvements: 'name_amount_list',
    work_area_limit: 'segmented_enum'
  };

  const stringKeys = Object.entries(C3X_BASE_MANIFEST)
    .filter(([, meta]) => meta && meta.type === 'string')
    .map(([key]) => key)
    .sort();

  assert.deepEqual(stringKeys, Object.keys(expectedFamilies).sort());
  Object.entries(expectedFamilies).forEach(([key, family]) => {
    assert.equal(C3X_BASE_MANIFEST[key].family, family, `${key} family drifted`);
  });
});

test('C3X base manifest enum, bitfield, and reference metadata stays source-backed', () => {
  assert.deepEqual(C3X_BASE_MANIFEST.double_minimap_size.options, ['never', 'high-def', 'always']);
  assert.deepEqual(C3X_BASE_MANIFEST.land_retreat_rules.options, ['standard', 'none', 'all-units', 'if-faster', 'if-not-slower', 'if-fast-and-not-slower']);
  assert.deepEqual(C3X_BASE_MANIFEST.sea_retreat_rules.options, ['standard', 'none', 'all-units', 'if-faster', 'if-not-slower', 'if-fast-and-not-slower']);
  assert.deepEqual(C3X_BASE_MANIFEST.special_zone_of_control_rules.options, ['amphibious', 'lethal', 'aerial', 'not-from-inside', 'all']);
  assert.deepEqual(C3X_BASE_MANIFEST.special_defensive_bombard_rules.options, ['lethal', 'aerial', 'not-invisible', 'blitz', 'docked-vs-land', 'all']);
  assert.deepEqual(C3X_BASE_MANIFEST.land_transport_rules.options, ['load-onto-boat', 'join-army', 'no-defense-from-inside', 'no-escape']);
  assert.deepEqual(C3X_BASE_MANIFEST.special_helicopter_rules.options, ['allow-on-carriers', 'passenger-airdrop', 'no-defense-from-inside', 'no-escape']);
  assert.deepEqual(C3X_BASE_MANIFEST.enabled_seasons.options, ['summer', 'fall', 'winter', 'spring']);
  assert.deepEqual(C3X_BASE_MANIFEST.show_tile_destruct_animation_after.options, ['bombard', 'bomb', 'pillage']);
  assert.deepEqual(C3X_BASE_MANIFEST.override_no_ai_patrol.options, ['none', 'one', 'zero']);
  assert.deepEqual(C3X_BASE_MANIFEST.override_barbarian_activity_level_for_scenario_maps.options, ['none', 'No Barbarians', 'Sedentary', 'Roaming', 'Restless', 'Raging', 'Random']);

  assert.equal(C3X_BASE_MANIFEST.can_bombard_only_sea_tiles.referenceTab, 'units');
  assert.equal(C3X_BASE_MANIFEST.exclude_types_from_units_per_tile_limit.referenceTab, 'units');
  assert.equal(C3X_BASE_MANIFEST.limit_defensive_retreat_on_water_to_types.referenceTab, 'units');
  assert.equal(C3X_BASE_MANIFEST.ptw_like_artillery_targeting.referenceTab, 'units');
  assert.equal(C3X_BASE_MANIFEST.ai_multi_start_extra_palaces.referenceTab, 'improvements');
  assert.equal(C3X_BASE_MANIFEST.great_wall_auto_build_wonder_name.referenceTab, 'improvements');
  assert.deepEqual(C3X_BASE_MANIFEST.great_wall_auto_build_wonder_name.referenceFilterKinds, ['wonder']);
});

test('C3X base manifest assigns every key to an explicit audit tier', () => {
  const auditTierByFamily = {
    boolean: 'scalar-codec',
    integer: 'scalar-codec',
    plain_string: 'string-codec',
    quoted_string: 'string-codec',
    segmented_enum: 'string-codec',
    stack_limit: 'special-syntax-codec',
    bitfield_list: 'special-syntax-source-backed',
    quoted_reference_list: 'special-syntax-source-backed',
    building_prereq_list: 'special-syntax-codec',
    building_resource_list: 'special-syntax-codec',
    civ_aliases_by_era: 'special-syntax-codec',
    leader_aliases_by_era: 'special-syntax-codec',
    name_amount_list: 'special-syntax-codec',
    unit_limits: 'special-syntax-codec'
  };

  const missing = Object.entries(C3X_BASE_MANIFEST)
    .filter(([, meta]) => !auditTierByFamily[String(meta && meta.family || '')])
    .map(([key]) => key)
    .sort();

  assert.deepEqual(missing, [], `Manifest keys missing audit tier classification: ${missing.join(', ')}`);

  const tierCounts = {};
  Object.values(C3X_BASE_MANIFEST).forEach((meta) => {
    const tier = auditTierByFamily[meta.family];
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  });
  assert.ok(tierCounts['scalar-codec'] > 0, 'Expected scalar audit tier coverage');
  assert.ok(tierCounts['string-codec'] > 0, 'Expected simple string audit tier coverage');
  assert.ok(tierCounts['special-syntax-codec'] > 0, 'Expected special syntax codec tier coverage');
  assert.ok(tierCounts['special-syntax-source-backed'] > 0, 'Expected source-backed special syntax tier coverage');
});

test('C3X base rows use manifest-driven types for shipped keys', () => {
  const { values } = parseDefaultBaseKeysAndValues();
  const c3xRoot = mkTmpDir();
  fs.copyFileSync(
    DEFAULT_BASE_FIXTURE_PATH,
    path.join(c3xRoot, 'default.c3x_config.ini')
  );
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_config.txt'), '; empty districts\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_wonders_config.txt'), '; empty wonders\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.districts_natural_wonders_config.txt'), '; empty natural wonders\n', 'utf8');
  fs.writeFileSync(path.join(c3xRoot, 'default.tile_animations.txt'), '; empty animations\n', 'utf8');

  const bundle = loadBundle({ mode: 'global', c3xPath: c3xRoot, scenarioPath: '' });
  const rows = bundle && bundle.tabs && bundle.tabs.base && Array.isArray(bundle.tabs.base.rows)
    ? bundle.tabs.base.rows
    : [];
  const rowByKey = new Map(rows.map((row) => [String(row && row.key || ''), row]));

  assert.equal(bundle.tabs.base.sectionByKey.great_wall_districts_impassable_by_others, 'DISTRICTS');

  [
    'measure_turn_times',
    'max_ai_naval_escorts',
    'double_minimap_size',
    'special_zone_of_control_rules',
    'building_prereqs_for_units',
    'great_wall_auto_build_wonder_name'
  ].forEach((key) => {
    const row = rowByKey.get(key);
    assert.ok(row, `Expected loaded base row for ${key}`);
    assert.equal(row.type, C3X_BASE_MANIFEST[key].type, `${key} row type should come from manifest`);
    assert.equal(String(row.defaultValue || ''), String(values[key] || ''), `${key} default value mismatch`);
  });
});
