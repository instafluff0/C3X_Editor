const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseSectionedConfig,
  serializeSectionedConfig,
  loadBundle,
  saveBundle
} = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-district-fields-'));
}

function seedMinimalC3x(c3xPath) {
  fs.writeFileSync(path.join(c3xPath, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(c3xPath, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
}

function fieldValue(section, key) {
  const found = (section.fields || []).find((field) => String(field && field.key || '').trim().toLowerCase() === String(key || '').trim().toLowerCase());
  return found ? String(found.value == null ? '' : found.value) : '';
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DISTRICT_INPUT_LINES = [
  '#District',
  'name = "Mega District"',
  'display_name = "Mega District Display"',
  'tooltip = "Build Mega District"',
  'img_paths = "Mega District Amer.pcx", "Mega District Euro.pcx"',
  'img_column_count = 5',
  'render_strategy = by-building',
  'custom_width = 144',
  'custom_height = 72',
  'x_offset = -3',
  'y_offset = 5',
  'btn_tile_sheet_column = 4',
  'btn_tile_sheet_row = 2',
  'advance_prereqs = "Alpha Tech", "Beta Tech"',
  'obsoleted_by = "Future Tech"',
  'dependent_improvs = "Research Lab", "Market Square"',
  'generated_resource = "Rare Earths" local yields no-tech-req',
  'buildable_on = desert, plains, grassland',
  'buildable_on_rivers = 1',
  'buildable_adjacent_to = coast, city',
  'align_to_coast = 1',
  'auto_add_road = 1',
  'auto_add_railroad = 0',
  'buildable_on_overlays = forest, jungle',
  'buildable_without_removal = forest',
  'buildable_adjacent_to_overlays = river, mine',
  'buildable_on_districts = "Harbor District", "Trade District"',
  'buildable_adjacent_to_districts = "Commercial Hub", "Data Center"',
  'buildable_by_civs = Babylon, "The Ottomans"',
  'buildable_by_civ_traits = Seafaring, Scientific',
  'buildable_by_civ_govs = Republic, Monarchy',
  'buildable_by_civ_cultures = European, Mideast',
  'resource_prereqs = "Rare Earths", Oil',
  'resource_prereq_on_tile = "Rare Earths"',
  'wonder_prereqs = "The Great Wall", "Sun Tzu\'s Art of War"',
  'natural_wonder_prereqs = "Grand Canyon", Uluru',
  'buildable_by_war_allies = 1',
  'buildable_by_pact_allies = 0',
  'ai_build_strategy = tile-improvement',
  'allow_multiple = 1',
  'vary_img_by_era = 1',
  'vary_img_by_culture = 1',
  'draw_over_resources = 1',
  'Impassable = 0',
  'Impassable_to_wheeled = 1',
  'allow_irrigation_from = 0',
  'heal_units_in_one_turn = 1',
  'defense_bonus_percent = 25, "City Walls": 50, grassland: 10',
  'culture_bonus = 2, "Research Lab": 4',
  'science_bonus = 3, "Research Lab": 6',
  'food_bonus = 1, grassland: 2',
  'gold_bonus = 4, "Market Square": 5',
  'shield_bonus = 2, "Machine Shop": 3',
  'happiness_bonus = 1, Temple: 2'
];

const DISTRICT_EXPECTED_SERIALIZED_LINES = [
  '#District',
  'name = "Mega District"',
  'display_name = "Mega District Display"',
  'tooltip = "Build Mega District"',
  'img_paths = "Mega District Amer.pcx", "Mega District Euro.pcx"',
  'img_column_count = 5',
  'render_strategy = by-building',
  'custom_width = 144',
  'custom_height = 72',
  'x_offset = -3',
  'y_offset = 5',
  'btn_tile_sheet_column = 4',
  'btn_tile_sheet_row = 2',
  'advance_prereqs = "Alpha Tech", "Beta Tech"',
  'obsoleted_by = "Future Tech"',
  'dependent_improvs = "Research Lab", "Market Square"',
  'generated_resource = "Rare Earths" local yields no-tech-req',
  'buildable_on = desert, plains, grassland',
  'buildable_on_rivers = 1',
  'buildable_adjacent_to = coast, city',
  'align_to_coast = 1',
  'auto_add_road = 1',
  'auto_add_railroad = 0',
  'buildable_on_overlays = forest, jungle',
  'buildable_without_removal = forest',
  'buildable_adjacent_to_overlays = river, mine',
  'buildable_on_districts = "Harbor District", "Trade District"',
  'buildable_adjacent_to_districts = "Commercial Hub", "Data Center"',
  'buildable_by_civs = "Babylon", "The Ottomans"',
  'buildable_by_civ_traits = "Seafaring", "Scientific"',
  'buildable_by_civ_govs = "Republic", "Monarchy"',
  'buildable_by_civ_cultures = "European", "Mideast"',
  'resource_prereqs = "Rare Earths", "Oil"',
  'resource_prereq_on_tile = "Rare Earths"',
  'wonder_prereqs = "The Great Wall", "Sun Tzu\'s Art of War"',
  'natural_wonder_prereqs = "Grand Canyon", "Uluru"',
  'buildable_by_war_allies = 1',
  'buildable_by_pact_allies = 0',
  'ai_build_strategy = tile-improvement',
  'allow_multiple = 1',
  'vary_img_by_era = 1',
  'vary_img_by_culture = 1',
  'draw_over_resources = 1',
  'Impassable = 0',
  'Impassable_to_wheeled = 1',
  'allow_irrigation_from = 0',
  'heal_units_in_one_turn = 1',
  'defense_bonus_percent = 25, "City Walls": 50, grassland: 10',
  'culture_bonus = 2, "Research Lab": 4',
  'science_bonus = 3, "Research Lab": 6',
  'food_bonus = 1, grassland: 2',
  'gold_bonus = 4, "Market Square": 5',
  'shield_bonus = 2, "Machine Shop": 3',
  'happiness_bonus = 1, Temple: 2'
];

const DISTRICT_EXPECTED_RELOADED_VALUES = new Map([
  ['name', 'Mega District'],
  ['display_name', 'Mega District Display'],
  ['tooltip', 'Build Mega District'],
  ['img_paths', '"Mega District Amer.pcx", "Mega District Euro.pcx"'],
  ['img_column_count', '5'],
  ['render_strategy', 'by-building'],
  ['custom_width', '144'],
  ['custom_height', '72'],
  ['x_offset', '-3'],
  ['y_offset', '5'],
  ['btn_tile_sheet_column', '4'],
  ['btn_tile_sheet_row', '2'],
  ['advance_prereqs', '"Alpha Tech", "Beta Tech"'],
  ['obsoleted_by', 'Future Tech'],
  ['dependent_improvs', '"Research Lab", "Market Square"'],
  ['generated_resource', '"Rare Earths" local yields no-tech-req'],
  ['buildable_on', 'desert, plains, grassland'],
  ['buildable_on_rivers', '1'],
  ['buildable_adjacent_to', 'coast, city'],
  ['align_to_coast', '1'],
  ['auto_add_road', '1'],
  ['auto_add_railroad', '0'],
  ['buildable_on_overlays', 'forest, jungle'],
  ['buildable_without_removal', 'forest'],
  ['buildable_adjacent_to_overlays', 'river, mine'],
  ['buildable_on_districts', '"Harbor District", "Trade District"'],
  ['buildable_adjacent_to_districts', '"Commercial Hub", "Data Center"'],
  ['buildable_by_civs', '"Babylon", "The Ottomans"'],
  ['buildable_by_civ_traits', '"Seafaring", "Scientific"'],
  ['buildable_by_civ_govs', '"Republic", "Monarchy"'],
  ['buildable_by_civ_cultures', '"European", "Mideast"'],
  ['resource_prereqs', '"Rare Earths", "Oil"'],
  ['resource_prereq_on_tile', 'Rare Earths'],
  ['wonder_prereqs', '"The Great Wall", "Sun Tzu\'s Art of War"'],
  ['natural_wonder_prereqs', '"Grand Canyon", "Uluru"'],
  ['buildable_by_war_allies', '1'],
  ['buildable_by_pact_allies', '0'],
  ['ai_build_strategy', 'tile-improvement'],
  ['allow_multiple', '1'],
  ['vary_img_by_era', '1'],
  ['vary_img_by_culture', '1'],
  ['draw_over_resources', '1'],
  ['Impassable', '0'],
  ['Impassable_to_wheeled', '1'],
  ['allow_irrigation_from', '0'],
  ['heal_units_in_one_turn', '1'],
  ['defense_bonus_percent', '25, "City Walls": 50, grassland: 10'],
  ['culture_bonus', '2, "Research Lab": 4'],
  ['science_bonus', '3, "Research Lab": 6'],
  ['food_bonus', '1, grassland: 2'],
  ['gold_bonus', '4, "Market Square": 5'],
  ['shield_bonus', '2, "Machine Shop": 3'],
  ['happiness_bonus', '1, Temple: 2']
]);

test('serializeSectionedConfig canonicalizes district field formats for C3X-compatible output', () => {
  const model = parseSectionedConfig(DISTRICT_INPUT_LINES.join('\n'), '#District');
  const serialized = serializeSectionedConfig(model, '#District', { kind: 'districts' });

  for (const line of DISTRICT_EXPECTED_SERIALIZED_LINES) {
    if (line === '#District') continue;
    const [key, rawValue] = line.split(/\s*=\s*/, 2);
    assert.match(serialized, new RegExp(`${escapeRegex(key)}\\s*=\\s*${escapeRegex(rawValue)}`));
  }
  assert.doesNotMatch(serialized, /generated_resource\s*=\s*.*,\s*(local|yields|no-tech-req)/);
});

test('saveBundle rewrites district and wonder district improvement-name references after improvement rename', () => {
  const c3xPath = mkTmpDir();
  seedMinimalC3x(c3xPath);
  const result = saveBundle({
    mode: 'standard',
    c3xPath,
    civ3Path: c3xPath,
    dirtyTabs: ['improvements'],
    tabs: {
      improvements: {
        entries: [{
          name: 'Library Place',
          biqFields: [
            { key: 'name', baseKey: 'name', value: 'Library Place', originalValue: 'Library' }
          ]
        }]
      },
      districts: {
        model: {
          sections: [{
            marker: '#District',
            comments: [],
            fields: [
              { key: 'name', value: 'Campus' },
              { key: 'dependent_improvs', value: 'Library, University' },
              { key: 'wonder_prereqs', value: '"Library"' },
              { key: 'culture_bonus', value: '1, Library: 2, grassland: 1' },
              { key: 'science_bonus', value: '1, "Library": 4' }
            ]
          }],
          headerComments: []
        }
      },
      wonders: {
        model: {
          sections: [{
            marker: '#Wonder',
            comments: [],
            fields: [
              { key: 'name', value: 'Library' },
              { key: 'img_row', value: '0' },
              { key: 'img_column', value: '0' }
            ]
          }],
          headerComments: []
        }
      }
    }
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  const districtsText = fs.readFileSync(path.join(c3xPath, 'user.districts_config.txt'), 'utf8');
  const wondersText = fs.readFileSync(path.join(c3xPath, 'user.districts_wonders_config.txt'), 'utf8');
  assert.match(districtsText, /dependent_improvs\s*=\s*"Library Place", "University"/);
  assert.match(districtsText, /wonder_prereqs\s*=\s*"Library Place"/);
  assert.match(districtsText, /culture_bonus\s*=\s*1, "Library Place": 2, grassland: 1/);
  assert.match(districtsText, /science_bonus\s*=\s*1, "Library Place": 4/);
  assert.match(wondersText, /name\s*=\s*"Library Place"/);
});

test('district and wonder image paths serialize as filenames instead of full file paths', () => {
  const districts = parseSectionedConfig([
    '#District',
    'name = Market',
    'img_paths = "C:\\Games\\Civ3\\Conquests\\Scenarios\\MyScenario\\Art\\Districts\\Market Amer.pcx", /tmp/imports/Market Euro.pcx'
  ].join('\n'), '#District');
  const wonders = parseSectionedConfig([
    '#Wonder',
    'name = Great Library',
    'img_path = C:\\Games\\Civ3\\Conquests\\Scenarios\\MyScenario\\Art\\Wonders\\Great Library.pcx'
  ].join('\n'), '#Wonder');
  const naturalWonders = parseSectionedConfig([
    '#Wonder',
    'name = Grand Canyon',
    'img_path = NaturalWonders.pcx'
  ].join('\n'), '#Wonder');

  assert.match(
    serializeSectionedConfig(districts, '#District', { kind: 'districts' }),
    /img_paths\s*=\s*"Market Amer\.pcx", "Market Euro\.pcx"/
  );
  assert.match(
    serializeSectionedConfig(wonders, '#Wonder', { kind: 'wonders' }),
    /img_path\s*=\s*"Great Library\.pcx"/
  );
  assert.match(
    serializeSectionedConfig(naturalWonders, '#Wonder', { kind: 'naturalWonders' }),
    /img_path\s*=\s*"NaturalWonders\.pcx"/
  );
});

test('district save and reload preserves all configured district field values and edge cases', () => {
  const c3xPath = mkTmpDir();
  const scenarioPath = mkTmpDir();
  seedMinimalC3x(c3xPath);

  const bundle = loadBundle({ mode: 'global', c3xPath, civ3Path: '', scenarioPath });
  const parsed = parseSectionedConfig(DISTRICT_INPUT_LINES.join('\n'), '#District');
  bundle.tabs.districts.model = parsed;

  const result = saveBundle({
    mode: 'global',
    c3xPath,
    civ3Path: '',
    scenarioPath,
    tabs: bundle.tabs
  });

  assert.equal(result.ok, true);

  const savedPath = path.join(c3xPath, 'user.districts_config.txt');
  const savedText = fs.readFileSync(savedPath, 'utf8');
  for (const line of DISTRICT_EXPECTED_SERIALIZED_LINES) {
    if (line === '#District') continue;
    const [key, rawValue] = line.split(/\s*=\s*/, 2);
    assert.match(savedText, new RegExp(`${escapeRegex(key)}\\s*=\\s*${escapeRegex(rawValue)}`));
  }

  const reloaded = loadBundle({ mode: 'global', c3xPath, civ3Path: '', scenarioPath });
  const section = reloaded.tabs.districts.model.sections[0];
  for (const [key, expected] of DISTRICT_EXPECTED_RELOADED_VALUES.entries()) {
    assert.equal(fieldValue(section, key), expected, `expected ${key} to round-trip`);
  }
});

test('district generated_resource remains whitespace-tokenized and supports multi-word resources', () => {
  const model = parseSectionedConfig([
    '#District',
    'name = Test District',
    'generated_resource = "Rare Earths" local yields'
  ].join('\n'), '#District');
  const serialized = serializeSectionedConfig(model, '#District', { kind: 'districts' });
  assert.match(serialized, /generated_resource\s*=\s*"Rare Earths" local yields/);
  assert.doesNotMatch(serialized, /generated_resource\s*=\s*"Rare Earths",/);
  assert.doesNotMatch(serialized, /generated_resource\s*=\s*.*,\s*local/);
});

test('district resource_prereq_on_tile is quoted when needed and unquoted on reload', () => {
  const c3xPath = mkTmpDir();
  const scenarioPath = mkTmpDir();
  seedMinimalC3x(c3xPath);

  const bundle = loadBundle({ mode: 'global', c3xPath, civ3Path: '', scenarioPath });
  const parsed = parseSectionedConfig([
    '#District',
    'name = Test District',
    'resource_prereq_on_tile = Rare Earths'
  ].join('\n'), '#District');
  bundle.tabs.districts.model = parsed;

  const result = saveBundle({
    mode: 'global',
    c3xPath,
    civ3Path: '',
    scenarioPath,
    tabs: bundle.tabs
  });

  assert.equal(result.ok, true);
  const savedText = fs.readFileSync(path.join(c3xPath, 'user.districts_config.txt'), 'utf8');
  assert.match(savedText, /resource_prereq_on_tile\s*=\s*"Rare Earths"/);

  const reloaded = loadBundle({ mode: 'global', c3xPath, civ3Path: '', scenarioPath });
  assert.equal(fieldValue(reloaded.tabs.districts.model.sections[0], 'resource_prereq_on_tile'), 'Rare Earths');
});
