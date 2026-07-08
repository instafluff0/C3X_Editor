const fs = require('node:fs');
const path = require('node:path');

const {
  loadBundle,
  parseCivilopediaDocumentWithOrder,
  parsePediaIconsDocumentWithOrder,
  readTextFileWithEncodingInfoIfExists
} = require('./configCore');
const { parseUnitAnimationIni, resolveConquestsAssetPath, resolvePcxPath } = require('./artPreview');
const C3X_BASE_MANIFEST = require('./c3xBaseManifest');

const DISTRICT_TRAIT_OPTIONS = [
  'militaristic',
  'religious',
  'commercial',
  'industrious',
  'expansionist',
  'scientific',
  'agricultural',
  'seafaring'
];

const DISTRICT_CULTURE_OPTIONS = [
  'american',
  'european',
  'roman',
  'mideast',
  'asian'
];

const DISTRICT_DEPENDENCY_RULES = [
  { key: 'advance_prereqs', label: 'Tech Prerequisites', setKey: 'technologies' },
  { key: 'obsoleted_by', label: 'Obsoleted By', setKey: 'technologies' },
  { key: 'dependent_improvs', label: 'Dependent Improvements', setKey: 'improvements' },
  { key: 'wonder_prereqs', label: 'Wonder Prerequisites', setKey: 'improvements' },
  { key: 'resource_prereqs', label: 'Resource Prerequisites', setKey: 'resources' },
  { key: 'buildable_by_civs', label: 'Allowed Civs', setKey: 'civilizations' },
  { key: 'buildable_by_civ_govs', label: 'Allowed Governments', setKey: 'governments' },
  { key: 'natural_wonder_prereqs', label: 'Natural Wonder Prerequisites', setKey: 'naturalWonders' },
  { key: 'buildable_on_districts', label: 'Buildable On Districts', setKey: 'districts' },
  { key: 'buildable_adjacent_to_districts', label: 'Adjacent Districts', setKey: 'districts' }
];

const WONDER_DEPENDENCY_RULES = [
  { key: 'name', label: 'Wonder Name', setKey: 'wonders', single: true },
  { key: 'buildable_by_civs', label: 'Allowed Civs', setKey: 'civilizations' },
  { key: 'buildable_by_civ_govs', label: 'Allowed Governments', setKey: 'governments' },
  { key: 'buildable_by_civ_traits', label: 'Allowed Traits', setKey: 'traits' },
  { key: 'buildable_by_civ_cultures', label: 'Allowed Cultures', setKey: 'cultures' }
];

const DAY_NIGHT_HOURS = [
  '2400', '0100', '0200', '0300', '0400', '0500', '0600', '0700',
  '0800', '0900', '1000', '1100', '1200', '1300', '1400', '1500',
  '1600', '1700', '1800', '1900', '2000', '2100', '2200', '2300'
];

const SEASON_DIRS = {
  summer: 'Summer',
  fall: 'Fall',
  autumn: 'Fall',
  winter: 'Winter',
  spring: 'Spring'
};

const DEFAULT_SEASON_KEYS = ['summer', 'fall', 'winter', 'spring'];

const DAY_NIGHT_TERRAIN_FILES = [
  'xtgc.pcx', 'xpgc.pcx', 'xdgc.pcx', 'xdpc.pcx', 'xdgp.pcx', 'xggc.pcx',
  'wCSO.pcx', 'wSSS.pcx', 'wOOO.pcx',
  'lxtgc.pcx', 'lxpgc.pcx', 'lxdgc.pcx', 'lxdpc.pcx', 'lxdgp.pcx', 'lxggc.pcx',
  'lwCSO.pcx', 'lwSSS.pcx', 'lwOOO.pcx',
  'polarICEcaps-final.pcx',
  'xhills.pcx', 'hill forests.pcx', 'hill jungle.pcx', 'LMHills.pcx',
  'floodplains.pcx',
  'deltaRivers.pcx', 'mtnRivers.pcx',
  'waterfalls.pcx',
  'irrigation DESETT.pcx', 'irrigation PLAINS.pcx', 'irrigation.pcx', 'irrigation TUNDRA.pcx',
  'Volcanos.pcx', 'Volcanos forests.pcx', 'Volcanos jungles.pcx', 'Volcanos-snow.pcx',
  'marsh.pcx',
  'LMMountains.pcx', 'Mountains.pcx', 'mountain forests.pcx', 'mountain jungles.pcx', 'Mountains-snow.pcx',
  'roads.pcx', 'railroads.pcx',
  'LMForests.pcx', 'grassland forests.pcx', 'plains forests.pcx', 'tundra forests.pcx',
  'landmark_terrain.pcx', 'tnt.pcx', 'goodyhuts.pcx', 'TerrainBuildings.pcx',
  'pollution.pcx', 'craters.pcx',
  'x_airfields and detect.pcx', 'x_victory.pcx',
  'resources.pcx',
  'rAMER.pcx', 'rEURO.pcx', 'rROMAN.pcx', 'rMIDEAST.pcx', 'rASIAN.pcx',
  'AMERWALL.pcx', 'EUROWALL.pcx', 'ROMANWALL.pcx', 'MIDEASTWALL.pcx', 'ASIANWALL.pcx',
  'DESTROY.pcx'
];

const REFERENCE_ART_TABS = [
  'civilizations',
  'technologies',
  'resources',
  'governments',
  'improvements',
  'units'
];

const CIV3_PEDIA_ART_PATH_MAX_CHARS = 65;

const FIRAXIS_HOMELESS_PLACEHOLDER_LINES = [
  '#',
  'art\\civilopedia\\icons\\terrain\\borderslarge.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\borderssmall.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\riverslarge.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\riverssmall.pcx'
];

const PEDIAICONS_REAL_BLOCK_PREFIXES = [
  'ANIMNAME_',
  'ERA_SPLASH_',
  'ICON_',
  'LARGE_',
  'SMALL_',
  'TECH_',
  'WON_SPLASH_'
];

const TERRAIN_OPTIONS = [
  'desert',
  'plains',
  'grassland',
  'tundra',
  'floodplain',
  'hill',
  'mountain',
  'forest',
  'jungle',
  'marsh',
  'volcano',
  'coast',
  'sea',
  'ocean'
];

const DIRECTION_OPTIONS = [
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
  'north',
  'northeast',
  'east'
];

const DISTRICT_BUILDABLE_SQUARE_TOKENS = [
  'desert', 'deserts',
  'plain', 'plains',
  'grassland', 'grasslands',
  'tundra', 'tundras',
  'floodplain', 'floodplains',
  'hill', 'hills',
  'mountain', 'mountains',
  'volcano', 'volcanoes',
  'coast', 'coasts',
  'sea', 'seas',
  'ocean', 'oceans',
  'snow-forest', 'snow-forests',
  'snow-mountain', 'snow-mountains',
  'snow-volcano', 'snow-volcanoes',
  'lake'
];

const BUILDING_RESOURCE_FLAGS = ['local', 'no-tech-req', 'yields', 'show-bonus', 'hide-non-bonus'];

const NATURAL_WONDER_TERRAIN_TOKENS = [
  ...DISTRICT_BUILDABLE_SQUARE_TOKENS.filter((token) => token !== 'lake'),
  'forest', 'forests',
  'jungle', 'jungles',
  'swamp', 'swamps'
];

const DISTRICT_ADJACENT_SQUARE_TOKENS = [
  ...DISTRICT_BUILDABLE_SQUARE_TOKENS,
  'city'
];

const NATURAL_WONDER_ADJACENT_TOKENS = [
  'any',
  'river',
  'rivers',
  ...NATURAL_WONDER_TERRAIN_TOKENS
];

const DISTRICT_OVERLAY_TOKENS = [
  'irrigation',
  'mine',
  'fortress',
  'barricade',
  'outpost',
  'radar-tower',
  'airfield',
  'jungle',
  'jungles',
  'forest',
  'forests',
  'swamp',
  'swamps'
];

const DISTRICT_ADJACENT_OVERLAY_TOKENS = [
  ...DISTRICT_OVERLAY_TOKENS,
  'river',
  'rivers'
];

const DISTRICT_BONUS_TERRAIN_TOKENS = new Set([
  'desert', 'deserts',
  'plain', 'plains',
  'grassland', 'grasslands',
  'tundra', 'tundras',
  'floodplain', 'floodplains',
  'hill', 'hills',
  'mountain', 'mountains',
  'forest', 'forests',
  'jungle', 'jungles',
  'marsh', 'marshes',
  'swamp', 'swamps',
  'volcano', 'volcanoes',
  'coast', 'coasts',
  'sea', 'seas',
  'ocean', 'oceans',
  'river', 'rivers',
  'snow-volcano', 'snow-volcanoes',
  'snow-forest', 'snow-forests',
  'snow-mountain', 'snow-mountains',
  'any'
]);

const DISTRICT_BONUS_REFERENCE_RULES = [
  { key: 'defense_bonus_percent', label: 'Defense Bonus' },
  { key: 'culture_bonus', label: 'Culture Bonus' },
  { key: 'science_bonus', label: 'Science Bonus' },
  { key: 'food_bonus', label: 'Food Bonus' },
  { key: 'gold_bonus', label: 'Gold Bonus' },
  { key: 'shield_bonus', label: 'Shield Bonus' },
  { key: 'happiness_bonus', label: 'Happiness Bonus' }
];

const SECTION_LINT_SPECS = {
  districts: {
    label: 'District',
    knownFields: new Map([
      ['name', { type: 'text' }],
      ['display_name', { type: 'text' }],
      ['tooltip', { type: 'text' }],
      ['img_paths', { type: 'list' }],
      ['img_column_count', { type: 'number' }],
      ['render_strategy', { type: 'select', options: ['by-count', 'by-building'] }],
      ['custom_width', { type: 'number' }],
      ['custom_height', { type: 'number' }],
      ['x_offset', { type: 'number' }],
      ['y_offset', { type: 'number' }],
      ['btn_tile_sheet_row', { type: 'number' }],
      ['btn_tile_sheet_column', { type: 'number' }],
      ['advance_prereqs', { type: 'list' }],
      ['advance_prereq', { type: 'list' }],
      ['obsoleted_by', { type: 'list' }],
      ['dependent_improvs', { type: 'list' }],
      ['generated_resource', { type: 'text' }],
      ['buildable_on', { type: 'list', acceptedOptions: DISTRICT_BUILDABLE_SQUARE_TOKENS }],
      ['buildable_on_rivers', { type: 'bool' }],
      ['buildable_adjacent_to', { type: 'list', acceptedOptions: DISTRICT_ADJACENT_SQUARE_TOKENS }],
      ['align_to_coast', { type: 'bool' }],
      ['auto_add_road', { type: 'bool' }],
      ['auto_add_railroad', { type: 'bool' }],
      ['buildable_on_overlays', { type: 'list', acceptedOptions: DISTRICT_OVERLAY_TOKENS }],
      ['buildable_without_removal', { type: 'list', acceptedOptions: ['jungle', 'jungles', 'forest', 'forests', 'marsh', 'marshes', 'swamp', 'swamps'] }],
      ['buildable_adjacent_to_overlays', { type: 'list', acceptedOptions: DISTRICT_ADJACENT_OVERLAY_TOKENS }],
      ['buildable_on_districts', { type: 'list' }],
      ['buildable_adjacent_to_districts', { type: 'list' }],
      ['buildable_by_civs', { type: 'list' }],
      ['buildable_by_civ_traits', { type: 'list' }],
      ['buildable_by_civ_govs', { type: 'list' }],
      ['buildable_by_civ_cultures', { type: 'list' }],
      ['resource_prereqs', { type: 'list' }],
      ['resource_prereq_on_tile', { type: 'select' }],
      ['wonder_prereqs', { type: 'list' }],
      ['natural_wonder_prereqs', { type: 'list' }],
      ['buildable_by_war_allies', { type: 'bool' }],
      ['buildable_by_pact_allies', { type: 'bool' }],
      ['ai_build_strategy', { type: 'select', options: ['district', 'tile-improvement'] }],
      ['allow_multiple', { type: 'bool' }],
      ['vary_img_by_era', { type: 'bool' }],
      ['vary_img_by_culture', { type: 'bool' }],
      ['draw_over_resources', { type: 'bool' }],
      ['Impassable', { type: 'bool' }],
      ['Impassable_to_wheeled', { type: 'bool' }],
      ['allow_irrigation_from', { type: 'bool' }],
      ['heal_units_in_one_turn', { type: 'bool' }],
      ['defense_bonus_percent', { type: 'text' }],
      ['culture_bonus', { type: 'text' }],
      ['science_bonus', { type: 'text' }],
      ['food_bonus', { type: 'text' }],
      ['gold_bonus', { type: 'text' }],
      ['shield_bonus', { type: 'text' }],
      ['happiness_bonus', { type: 'text' }]
    ])
  },
  wonders: {
    label: 'Wonder District',
    knownFields: new Map([
      ['name', { type: 'select' }],
      ['buildable_on', { type: 'list', acceptedOptions: DISTRICT_BUILDABLE_SQUARE_TOKENS }],
      ['buildable_adjacent_to', { type: 'list', acceptedOptions: DISTRICT_ADJACENT_SQUARE_TOKENS }],
      ['buildable_adjacent_to_overlays', { type: 'list', acceptedOptions: DISTRICT_ADJACENT_OVERLAY_TOKENS }],
      ['buildable_by_civs', { type: 'list' }],
      ['buildable_by_civ_traits', { type: 'list' }],
      ['buildable_by_civ_govs', { type: 'list' }],
      ['buildable_by_civ_cultures', { type: 'list' }],
      ['buildable_on_rivers', { type: 'bool' }],
      ['img_path', { type: 'text' }],
      ['img_construct_row', { type: 'number' }],
      ['img_construct_column', { type: 'number' }],
      ['img_row', { type: 'number' }],
      ['img_column', { type: 'number' }],
      ['enable_img_alt_dir', { type: 'bool' }],
      ['img_alt_dir_construct_row', { type: 'number' }],
      ['img_alt_dir_construct_column', { type: 'number' }],
      ['img_alt_dir_row', { type: 'number' }],
      ['img_alt_dir_column', { type: 'number' }],
      ['custom_width', { type: 'number' }],
      ['custom_height', { type: 'number' }]
    ])
  },
  naturalWonders: {
    label: 'Natural Wonder',
    knownFields: new Map([
      ['name', { type: 'text' }],
      ['terrain_type', { type: 'select', acceptedOptions: NATURAL_WONDER_TERRAIN_TOKENS }],
      ['adjacent_to', { type: 'select', acceptedOptions: NATURAL_WONDER_ADJACENT_TOKENS }],
      ['adjacency_dir', { type: 'select', options: DIRECTION_OPTIONS }],
      ['img_path', { type: 'text' }],
      ['img_row', { type: 'number' }],
      ['img_column', { type: 'number' }],
      ['culture_bonus', { type: 'number' }],
      ['science_bonus', { type: 'number' }],
      ['food_bonus', { type: 'number' }],
      ['gold_bonus', { type: 'number' }],
      ['shield_bonus', { type: 'number' }],
      ['happiness_bonus', { type: 'number' }],
      ['Impassable', { type: 'bool' }],
      ['Impassable_to_wheeled', { type: 'bool' }],
      ['animation', { type: 'text' }]
    ])
  }
};

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile();
  } catch (_err) {
    return false;
  }
}

function normalizeFsPathForCompare(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return path.normalize(raw).toLowerCase();
}

function normalizeConfigToken(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  return raw.replace(/^"(.*)"$/, '$1').trim();
}

function tokenizeListPreservingQuotes(text) {
  const src = String(text == null ? '' : text);
  const items = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === ',' || ch === '\n' || ch === '\r')) {
      const trimmed = cur.trim();
      if (trimmed) items.push(trimmed);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) items.push(tail);
  return items;
}

function tokenizeWhitespaceListPreservingQuotes(text) {
  const src = String(text == null ? '' : text);
  const items = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === ',' || ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t')) {
      const trimmed = cur.trim();
      if (trimmed) items.push(trimmed);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) items.push(tail);
  return items;
}

function parseConfigBool(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isConfigBoolToken(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  return raw === '1' || raw === '0' || raw === 'true' || raw === 'false' || raw === 'yes' || raw === 'no' || raw === 'on' || raw === 'off';
}

function isDisabledConfigToken(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'no' || raw === 'off';
}

function isIntegerToken(value) {
  return /^-?\d+$/.test(String(value == null ? '' : value).trim());
}

function normalizeReferenceLookup(value) {
  return normalizeConfigToken(value).toLowerCase();
}

function hasBalancedQuotes(value) {
  const src = String(value == null ? '' : value);
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '"') inQuotes = !inQuotes;
  }
  return !inQuotes;
}

function getFieldValue(section, key) {
  const fields = Array.isArray(section && section.fields) ? section.fields : [];
  const match = fields.find((field) => String(field && field.key || '').trim() === key);
  return match ? String(match.value || '').trim() : '';
}

function getBiqRecordField(record, key) {
  const target = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  return fields.find((field) => {
    const fieldKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return fieldKey === target;
  }) || null;
}

function getBiqRecordFieldValue(record, key) {
  const field = getBiqRecordField(record, key);
  return field ? String(field.value == null ? '' : field.value).trim() : '';
}

function getReferenceEntryField(entry, key) {
  const target = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
  return fields.find((field) => {
    const fieldKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    return fieldKey === target;
  }) || null;
}

function getReferenceEntryFieldValue(entry, key) {
  const field = getReferenceEntryField(entry, key);
  return field ? String(field.value == null ? '' : field.value).trim() : '';
}

function parseBiqReferenceIndex(value, fallback = NaN) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  if (/^any$/i.test(raw)) return -3;
  if (/^random$/i.test(raw)) return -2;
  const parenMatch = raw.match(/\((-?\d+)\)\s*$/);
  if (parenMatch) {
    const parsed = Number.parseInt(parenMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBiqSection(bundle, tabKey, sectionCode) {
  const tab = (((bundle || {}).tabs || {})[tabKey]) || null;
  const sections = Array.isArray(tab && tab.sections) ? tab.sections : [];
  return sections.find((section) => String(section && section.code || '').toUpperCase() === String(sectionCode || '').toUpperCase()) || null;
}

function getBaseRowValue(bundle, key) {
  const rows = (((bundle || {}).tabs || {}).base || {}).rows;
  const match = Array.isArray(rows)
    ? rows.find((row) => String(row && row.key || '').trim() === key)
    : null;
  return match ? String(match.value || '').trim() : '';
}

function isGreatWallAutoBuildReferenceActive(bundle) {
  return parseConfigBool(getBaseRowValue(bundle, 'enable_districts'))
    && parseConfigBool(getBaseRowValue(bundle, 'enable_great_wall_districts'))
    && parseConfigBool(getBaseRowValue(bundle, 'auto_build_great_wall_around_territory'));
}

function getSectionDisplayName(section, index, fallbackLabel) {
  const primary = normalizeConfigToken(getFieldValue(section, 'label'))
    || normalizeConfigToken(getFieldValue(section, 'name'));
  return primary || `${fallbackLabel} ${index + 1}`;
}

function resolveScenarioRoot(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return '';
  if (/\.biq$/i.test(raw)) return path.dirname(raw);
  return raw;
}

function getAssetRoots(bundle) {
  const roots = [];
  const seen = new Set();
  const add = (candidate) => {
    const resolved = resolveScenarioRoot(candidate);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    roots.push(resolved);
  };
  (Array.isArray(bundle && bundle.scenarioSearchPaths) ? bundle.scenarioSearchPaths : []).forEach(add);
  add(bundle && bundle.scenarioPath);
  add(bundle && bundle.scenarioInputPath);
  return roots;
}

function resolveModArtFile(bundle, relativeArtPath) {
  const normalizedRel = String(relativeArtPath || '').trim().replace(/^["']|["']$/g, '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  if (!normalizedRel) return '';
  const startsWithArt = /^art\//i.test(normalizedRel);
  const candidatePathsForRoot = (root) => {
    const candidates = startsWithArt
      ? [path.join(root, normalizedRel)]
      : [path.join(root, 'Art', normalizedRel)];
    if (startsWithArt && !/^art\/districts\//i.test(normalizedRel)) {
      candidates.push(path.join(root, 'Art', 'Districts', '1200', path.basename(normalizedRel)));
    }
    return candidates;
  };
  const assetRoots = getAssetRoots(bundle);
  for (const root of assetRoots) {
    const found = candidatePathsForRoot(root).find((candidate) => fileExists(candidate));
    if (found) return found;
  }
  const c3xPath = String(bundle && bundle.c3xPath || '').trim();
  if (!c3xPath) return '';
  return candidatePathsForRoot(c3xPath).find((candidate) => fileExists(candidate)) || '';
}

function districtFamilyArtRelativePath(fileName) {
  const normalized = String(fileName || '').trim().replace(/^["']|["']$/g, '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  if (!normalized) return '';
  if (/^art\//i.test(normalized)) return normalized;
  if (/^districts\//i.test(normalized)) return path.join('Art', normalized);
  return path.join('Districts', '1200', normalized);
}

function resolveCurrentDistrictFamilyArtFile(bundle, fileName) {
  const normalized = String(fileName || '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (!normalized) return '';
  const previewPath = /^districts\//i.test(normalized)
    ? path.join('Art', normalized)
    : normalized;
  const found = resolvePcxPath(
    String(bundle && bundle.c3xPath || '').trim(),
    previewPath,
    getAssetRoots(bundle)
  );
  if (found) return found;
  return resolveModArtFile(bundle, districtFamilyArtRelativePath(fileName));
}

function resolveCiv3InstallRoot(civ3Path) {
  const raw = String(civ3Path || '').trim();
  if (!raw) return '';
  if (/[/\\](conquests|civ3ptw)$/i.test(raw)) return path.dirname(raw);
  return raw;
}

function getUnitRuntimeSearchRoots(bundle) {
  const roots = [];
  const seen = new Set();
  const add = (candidate) => {
    const raw = String(candidate || '').trim();
    if (!raw) return;
    const resolved = resolveScenarioRoot(raw);
    const key = normalizeFsPathForCompare(resolved);
    if (!key || seen.has(key)) return;
    seen.add(key);
    roots.push(resolved);
  };
  getAssetRoots(bundle).forEach(add);
  const civ3Root = resolveCiv3InstallRoot(bundle && bundle.civ3Path);
  if (civ3Root) {
    add(path.join(civ3Root, 'Conquests'));
    add(path.join(civ3Root, 'civ3PTW'));
    add(civ3Root);
  }
  return roots;
}

function normalizeRuntimeAssetValue(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/');
}

function toCiv3DisplayPath(value) {
  return String(value || '').replace(/\//g, '\\');
}

function unitRuntimeRelativePath(animationName, assetValue) {
  const raw = normalizeRuntimeAssetValue(assetValue);
  if (!raw) return '';
  if (/^[A-Za-z]:\//.test(raw) || raw.startsWith('/')) return raw;
  if (/^art\//i.test(raw)) return raw;
  return `Art/Units/${String(animationName || '').trim()}/${raw}`;
}

function unitRuntimeCandidatePaths(bundle, animationName, assetValue) {
  const raw = normalizeRuntimeAssetValue(assetValue);
  if (!raw) return [];
  if (/^[A-Za-z]:\//.test(raw) || raw.startsWith('/')) return [raw];
  const rel = unitRuntimeRelativePath(animationName, raw);
  return getUnitRuntimeSearchRoots(bundle).map((root) => path.join(root, ...rel.split('/')));
}

function resolveUnitRuntimeAssetPath(bundle, animationName, assetValue) {
  return unitRuntimeCandidatePaths(bundle, animationName, assetValue).find((candidate) => fileExists(candidate)) || '';
}

function getRuntimeUnitIniPath(bundle, animationName) {
  const name = String(animationName || '').trim();
  if (!name) return '';
  const iniValue = `${name}.ini`;
  return unitRuntimeCandidatePaths(bundle, name, iniValue).find((candidate) => fileExists(candidate)) || '';
}

function getUnitRuntimeExpectedDisplayPath(animationName, assetValue) {
  const raw = normalizeRuntimeAssetValue(assetValue);
  if (!raw) return '';
  if (/^[A-Za-z]:\//.test(raw) || raw.startsWith('/')) return toCiv3DisplayPath(raw);
  return toCiv3DisplayPath(unitRuntimeRelativePath(animationName, raw));
}

function collectUnitIniRuntimeAssetRefs(manifest) {
  const refs = [];
  const sections = Array.isArray(manifest && manifest.sections) ? manifest.sections : [];
  sections.forEach((section) => {
    (Array.isArray(section && section.fields) ? section.fields : []).forEach((field) => {
      const value = String(field && field.value || '').trim();
      if (!/\.(flc|amb|wav)$/i.test(value)) return;
      refs.push({ value });
    });
  });
  return refs;
}

function createAuditAccumulator() {
  return {
    totalWarnings: 0,
    tabs: {}
  };
}

function ensureTabState(result, tabKey) {
  if (!result.tabs[tabKey]) {
    result.tabs[tabKey] = {
      general: [],
      sections: {},
      count: 0
    };
  }
  return result.tabs[tabKey];
}

function addGeneralIssue(result, tabKey, message, code = '') {
  const tab = ensureTabState(result, tabKey);
  tab.general.push({ message: String(message || '').trim(), code: String(code || '').trim() });
  tab.count += 1;
  result.totalWarnings += 1;
}

function addSectionIssue(result, tabKey, sectionIndex, message, code = '', extra = {}) {
  const tab = ensureTabState(result, tabKey);
  const key = String(sectionIndex);
  if (!Array.isArray(tab.sections[key])) tab.sections[key] = [];
  tab.sections[key].push({
    message: String(message || '').trim(),
    code: String(code || '').trim(),
    ...(extra && typeof extra === 'object' ? extra : {})
  });
  tab.count += 1;
  result.totalWarnings += 1;
}

function toNormalizedLookupSet(values) {
  const out = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = normalizeConfigToken(value).toLowerCase();
    if (normalized) out.add(normalized);
  });
  return out;
}

function getReferenceEntryDisplayName(tabKey, entry) {
  if (String(tabKey || '').trim() === 'improvements') {
    const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
    const nameField = fields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === 'name');
    const biqName = normalizeConfigToken(nameField && nameField.value);
    if (biqName) return biqName;
  }
  return String(entry && entry.name || '').trim();
}

function getReferenceSetFromBundle(bundle, tabKey, filterFn = null) {
  const tab = (((bundle || {}).tabs || {})[tabKey]) || null;
  if (!tab || !Array.isArray(tab.entries)) return new Set();
  const entries = typeof filterFn === 'function' ? tab.entries.filter((entry) => filterFn(entry)) : tab.entries;
  return toNormalizedLookupSet(entries.map((entry) => getReferenceEntryDisplayName(tabKey, entry)));
}

function buildDistrictCompatibilityContext(bundle) {
  const tabs = ((bundle || {}).tabs || {});
  const naturalWonderSections = ((((tabs.naturalWonders || {}).model || {}).sections) || []);
  const districtSections = ((((tabs.districts || {}).model || {}).sections) || []);
  return {
    technologies: getReferenceSetFromBundle(bundle, 'technologies'),
    improvements: getReferenceSetFromBundle(bundle, 'improvements'),
    resources: getReferenceSetFromBundle(bundle, 'resources'),
    civilizations: getReferenceSetFromBundle(bundle, 'civilizations'),
    governments: getReferenceSetFromBundle(bundle, 'governments'),
    naturalWonders: toNormalizedLookupSet(naturalWonderSections.map((section) => getFieldValue(section, 'name'))),
    districts: toNormalizedLookupSet(districtSections.map((section) => getFieldValue(section, 'name')))
  };
}

function buildWonderCompatibilityContext(bundle) {
  return {
    wonders: getReferenceSetFromBundle(bundle, 'improvements', (entry) => {
      const kind = String(entry && entry.improvementKind || '').trim().toLowerCase();
      return kind === 'wonder' || kind === 'small_wonder';
    }),
    civilizations: getReferenceSetFromBundle(bundle, 'civilizations'),
    governments: getReferenceSetFromBundle(bundle, 'governments'),
    traits: toNormalizedLookupSet(DISTRICT_TRAIT_OPTIONS),
    cultures: toNormalizedLookupSet(DISTRICT_CULTURE_OPTIONS)
  };
}

function collectDistrictDependencyIssues(section, context) {
  const issues = [];
  DISTRICT_DEPENDENCY_RULES.forEach((rule) => {
    const tokenValues = tokenizeListPreservingQuotes(getFieldValue(section, rule.key))
      .map((value) => normalizeConfigToken(value))
      .filter(Boolean);
    if (tokenValues.length <= 0) return;
    const allowedSet = context[rule.setKey] || new Set();
    if (!(allowedSet instanceof Set) || allowedSet.size <= 0) return;
    const invalidValues = tokenValues.filter((value) => !allowedSet.has(normalizeConfigToken(value).toLowerCase()));
    if (invalidValues.length <= 0) return;
    issues.push({
      label: rule.label,
      invalidValues
    });
  });
  return issues;
}

function collectWonderDependencyIssues(section, context) {
  const issues = [];
  WONDER_DEPENDENCY_RULES.forEach((rule) => {
    const tokenValues = rule.single
      ? [normalizeConfigToken(getFieldValue(section, rule.key))]
      : tokenizeListPreservingQuotes(getFieldValue(section, rule.key)).map((value) => normalizeConfigToken(value));
    const cleaned = tokenValues.filter(Boolean);
    if (cleaned.length <= 0) return;
    const allowedSet = context[rule.setKey] || new Set();
    if (!(allowedSet instanceof Set) || allowedSet.size <= 0) return;
    const invalidValues = cleaned.filter((value) => !allowedSet.has(normalizeConfigToken(value).toLowerCase()));
    if (invalidValues.length <= 0) return;
    issues.push({
      label: rule.label,
      invalidValues
    });
  });
  return issues;
}

function findUnquotedColon(value) {
  const input = String(value == null ? '' : value);
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === ':') return i;
  }
  return -1;
}

function collectDistrictBonusReferenceIssues(section, context) {
  const issues = [];
  const improvementSet = context && context.improvements instanceof Set ? context.improvements : new Set();
  if (improvementSet.size <= 0) return issues;
  DISTRICT_BONUS_REFERENCE_RULES.forEach((rule) => {
    const rawValue = getFieldValue(section, rule.key);
    const tokens = tokenizeListPreservingQuotes(rawValue);
    if (tokens.length <= 1) return;
    const invalidValues = [];
    const seen = new Set();
    tokens.slice(1).forEach((token) => {
      const colonIndex = findUnquotedColon(token);
      if (colonIndex < 0) return;
      const name = normalizeConfigToken(token.slice(0, colonIndex));
      const lookup = normalizeReferenceLookup(name);
      if (!lookup || seen.has(lookup) || DISTRICT_BONUS_TERRAIN_TOKENS.has(lookup) || improvementSet.has(lookup)) return;
      seen.add(lookup);
      invalidValues.push(name);
    });
    if (invalidValues.length <= 0) return;
    issues.push({
      key: rule.key,
      label: rule.label,
      invalidValues
    });
  });
  return issues;
}

function auditCompatibility(bundle, result) {
  const districtSections = (((bundle || {}).tabs || {}).districts || {}).model;
  const wonderSections = (((bundle || {}).tabs || {}).wonders || {}).model;
  const districtList = Array.isArray(districtSections && districtSections.sections) ? districtSections.sections : [];
  const wonderList = Array.isArray(wonderSections && wonderSections.sections) ? wonderSections.sections : [];
  const districtContext = buildDistrictCompatibilityContext(bundle);
  const wonderContext = buildWonderCompatibilityContext(bundle);

  districtList.forEach((section, index) => {
    collectDistrictDependencyIssues(section, districtContext).forEach((issue) => {
      addSectionIssue(
        result,
        'districts',
        index,
        `${issue.label}: ${issue.invalidValues.join(', ')}`,
        'district-dependency'
      );
    });
    collectDistrictBonusReferenceIssues(section, districtContext).forEach((issue) => {
      addSectionIssue(
        result,
        'districts',
        index,
        `${issue.label} conditional reference: ${issue.invalidValues.join(', ')}`,
        'district-bonus-reference'
      );
    });
  });

  wonderList.forEach((section, index) => {
    collectWonderDependencyIssues(section, wonderContext).forEach((issue) => {
      addSectionIssue(
        result,
        'wonders',
        index,
        `${issue.label}: ${issue.invalidValues.join(', ')}`,
        'wonder-dependency'
      );
    });
  });
}

function auditCurrentDistrictArt(bundle, result) {
  const sections = (((bundle || {}).tabs || {}).districts || {}).model;
  const list = Array.isArray(sections && sections.sections) ? sections.sections : [];
  list.forEach((section, index) => {
    const label = getSectionDisplayName(section, index, 'District');
    const imgPaths = tokenizeListPreservingQuotes(getFieldValue(section, 'img_paths'))
      .map((value) => normalizeConfigToken(value))
      .filter(Boolean);
    imgPaths.forEach((fileName) => {
      if (resolveCurrentDistrictFamilyArtFile(bundle, fileName)) return;
      addSectionIssue(
        result,
        'districts',
        index,
        `${label}: Missing district art "${fileName}" in Districts/1200.`,
        'district-art-missing'
      );
    });
  });

  const hasDistrictsEnabled = parseConfigBool(getBaseRowValue(bundle, 'enable_districts'));
  if (hasDistrictsEnabled && !resolveCurrentDistrictFamilyArtFile(bundle, 'Abandoned.pcx')) {
    addGeneralIssue(
      result,
      'districts',
      'Missing district art "Abandoned.pcx" in Districts/1200.',
      'district-art-missing'
    );
  }
}

function auditCurrentWonderArt(bundle, result) {
  const sections = (((bundle || {}).tabs || {}).wonders || {}).model;
  const list = Array.isArray(sections && sections.sections) ? sections.sections : [];
  list.forEach((section, index) => {
    const label = getSectionDisplayName(section, index, 'Wonder District');
    const fileName = normalizeConfigToken(getFieldValue(section, 'img_path')) || 'Wonders.pcx';
    if (resolveCurrentDistrictFamilyArtFile(bundle, fileName)) return;
    addSectionIssue(
      result,
      'wonders',
      index,
      `${label}: Missing wonder district art "${fileName}" in Districts/1200.`,
      'wonder-art-missing'
    );
  });
}

function auditCurrentNaturalWonderArt(bundle, result) {
  const sections = (((bundle || {}).tabs || {}).naturalWonders || {}).model;
  const list = Array.isArray(sections && sections.sections) ? sections.sections : [];
  list.forEach((section, index) => {
    const fileName = normalizeConfigToken(getFieldValue(section, 'img_path'));
    if (!fileName) return;
    const label = getSectionDisplayName(section, index, 'Natural Wonder');
    if (resolveCurrentDistrictFamilyArtFile(bundle, fileName)) return;
    addSectionIssue(
      result,
      'naturalWonders',
      index,
      `${label}: Missing natural wonder art "${fileName}" in Districts/1200.`,
      'natural-wonder-art-missing'
    );
  });
}

function formatHoursList(hours) {
  return Array.from(new Set(Array.isArray(hours) ? hours : []))
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function normalizeSeasonKey(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'autumn') return 'fall';
  return SEASON_DIRS[raw] ? raw : '';
}

function parseConfigListTokens(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return [];
  const unwrapped = raw.replace(/^\s*\[/, '').replace(/\]\s*$/, '');
  return tokenizeWhitespaceListPreservingQuotes(unwrapped)
    .map((token) => normalizeConfigToken(token))
    .filter(Boolean);
}

function getSeasonsToAudit(bundle) {
  const seasonalMode = String(getBaseRowValue(bundle, 'seasonal_cycle_mode') || '').trim().toLowerCase();
  if (!seasonalMode || seasonalMode === 'off') return ['summer'];
  if (seasonalMode === 'specified') {
    const pinned = normalizeSeasonKey(getBaseRowValue(bundle, 'pinned_season_for_seasonal_cycle'));
    return pinned ? [pinned] : ['summer'];
  }
  const enabled = parseConfigListTokens(getBaseRowValue(bundle, 'enabled_seasons'))
    .map(normalizeSeasonKey)
    .filter(Boolean);
  const seen = new Set();
  const unique = enabled.filter((season) => {
    if (seen.has(season)) return false;
    seen.add(season);
    return true;
  });
  return unique.length > 0 ? unique : DEFAULT_SEASON_KEYS;
}

function formatDayNightHour(hourNumber) {
  const normalized = ((Number(hourNumber) % 24) + 24) % 24;
  return normalized === 0 ? '2400' : `${String(normalized).padStart(2, '0')}00`;
}

function getHoursToAudit(bundle) {
  const mode = String(getBaseRowValue(bundle, 'day_night_cycle_mode') || '').trim().toLowerCase();
  if (mode === 'specified') {
    const raw = String(getBaseRowValue(bundle, 'pinned_hour_for_day_night_cycle') || '').trim();
    if (/^-?\d+$/.test(raw)) return [formatDayNightHour(Number(raw))];
  }
  return DAY_NIGHT_HOURS;
}

function normalizeArtLeafName(fileName) {
  const normalized = String(fileName || '').trim().replace(/^["']|["']$/g, '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  return normalized ? path.basename(normalized) : '';
}

function resolveDayNightArtFile(bundle, family, seasonKey, hour, fileName) {
  const leafName = normalizeArtLeafName(fileName);
  if (!leafName) return '';
  const seasonDir = SEASON_DIRS[seasonKey] || 'Summer';
  const root = family === 'terrain' ? 'DayNight' : 'Districts';
  const candidates = [
    path.join(root, seasonDir, hour, leafName)
  ];
  if (seasonKey === 'summer') candidates.push(path.join(root, hour, leafName));
  return candidates.find((relativePath) => resolveModArtFile(bundle, relativePath)) || '';
}

function formatSeasonHourLabel(seasons, seasonKey, hour) {
  if ((!Array.isArray(seasons) || seasons.length <= 1) && seasonKey === 'summer') return `hour ${hour}`;
  return `${SEASON_DIRS[seasonKey] || seasonKey} ${hour}`;
}

function formatSeasonHoursLabel(seasons, seasonKey) {
  if ((!Array.isArray(seasons) || seasons.length <= 1) && seasonKey === 'summer') return 'hour(s)';
  return `${SEASON_DIRS[seasonKey] || seasonKey} hour(s)`;
}

function getBaseLintMeta(key) {
  return C3X_BASE_MANIFEST[String(key || '').trim()] || null;
}

function stripOptionalBracketList(value) {
  const trimmed = String(value == null ? '' : value).trim();
  if (trimmed === '[]') return '';
  return trimmed.replace(/^\[\s*/, '').replace(/\s*\]$/, '');
}

function parseDelimitedStructuredEntries(value) {
  const inner = stripOptionalBracketList(value);
  if (!inner) return [];
  return tokenizeListPreservingQuotes(inner);
}

function parseBracketedOptionTokens(value) {
  const inner = stripOptionalBracketList(value);
  if (!inner) return [];
  const tokens = /[,\r\n]/.test(inner)
    ? tokenizeListPreservingQuotes(inner)
    : tokenizeWhitespaceListPreservingQuotes(inner);
  return tokens.map((token) => normalizeConfigToken(token)).filter(Boolean);
}

function parseNameAmountItems(value) {
  return parseDelimitedStructuredEntries(value).map((item) => {
    const i = item.indexOf(':');
    if (i < 0) return { name: normalizeConfigToken(item), amount: '' };
    return {
      name: normalizeConfigToken(item.slice(0, i)),
      amount: item.slice(i + 1).trim()
    };
  });
}

function parseBuildingPrereqItems(value) {
  return parseDelimitedStructuredEntries(value).map((item) => {
    const i = item.indexOf(':');
    if (i < 0) return { building: normalizeConfigToken(item), units: [] };
    return {
      building: normalizeConfigToken(item.slice(0, i)),
      units: parseBracketedOptionTokens(item.slice(i + 1))
    };
  });
}

function parseBuildingResourceItems(value) {
  return parseDelimitedStructuredEntries(value).map((item) => {
    const i = item.indexOf(':');
    if (i < 0) return { building: normalizeConfigToken(item), resource: '', flags: [] };
    const rhs = tokenizeWhitespaceListPreservingQuotes(item.slice(i + 1))
      .map((token) => normalizeConfigToken(token))
      .filter(Boolean);
    return {
      building: normalizeConfigToken(item.slice(0, i)),
      resource: rhs.length > 0 ? rhs[rhs.length - 1] : '',
      flags: rhs.filter((token) => BUILDING_RESOURCE_FLAGS.includes(token))
    };
  });
}

function isValidLimitRailroadMovementValue(value) {
  return isIntegerToken(value) || isDisabledConfigToken(value);
}

function isValidLimitUnitsPerTileValue(value) {
  const trimmed = String(value == null ? '' : value).trim();
  if (!trimmed) return true;
  if (isIntegerToken(trimmed) || isDisabledConfigToken(trimmed)) return true;
  const inner = stripOptionalBracketList(trimmed);
  const tokens = tokenizeWhitespaceListPreservingQuotes(inner).map((token) => normalizeConfigToken(token));
  return tokens.length === 3 && tokens.every((token) => isIntegerToken(token) || isDisabledConfigToken(token));
}

function lintBaseConfig(bundle, result) {
  const rows = (((bundle || {}).tabs || {}).base || {}).rows;
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row) => {
    const key = String(row && row.key || '').trim();
    if (!key) return;
    const value = String(row && row.value || '').trim();
    const meta = getBaseLintMeta(key);
    if (!meta) {
      addGeneralIssue(result, 'base', `Unknown C3X key "${key}". It will still be preserved, but may not be recognized.`, 'base-unknown-key');
      return;
    }
    if (key === 'limit_railroad_movement') {
      if (value && !isValidLimitRailroadMovementValue(value)) {
        addGeneralIssue(result, 'base', `C3X key "${key}" has invalid integer value "${value}".`, 'base-invalid-integer');
      }
      return;
    }
    if (key === 'limit_units_per_tile') {
      if (value && !isValidLimitUnitsPerTileValue(value)) {
        addGeneralIssue(result, 'base', `C3X key "${key}" has invalid stack limit value "${value}".`, 'base-invalid-stack-limit');
      }
      return;
    }
    if (meta.type === 'boolean' && value && !isConfigBoolToken(value)) {
      addGeneralIssue(result, 'base', `C3X key "${key}" has invalid boolean value "${value}".`, 'base-invalid-boolean');
      return;
    }
    if (meta.type === 'integer' && value && !isIntegerToken(value)) {
      addGeneralIssue(result, 'base', `C3X key "${key}" has invalid integer value "${value}".`, 'base-invalid-integer');
      return;
    }
    if (Array.isArray(meta.options) && meta.options.length > 0) {
      if (meta.type === 'string-list' || meta.family === 'bitfield_list') {
        if (!hasBalancedQuotes(value)) {
          addGeneralIssue(result, 'base', `C3X key "${key}" has malformed quoted list syntax.`, 'base-malformed-list');
          return;
        }
        const normalizedListValue = stripOptionalBracketList(value);
        const invalidValues = tokenizeWhitespaceListPreservingQuotes(normalizedListValue)
          .map((token) => normalizeConfigToken(token).replace(/^\[(.*)\]$/, '$1').trim())
          .filter(Boolean)
          .filter((token) => !meta.options.includes(token));
        if (invalidValues.length > 0) {
          addGeneralIssue(result, 'base', `C3X key "${key}" has unknown value${invalidValues.length === 1 ? '' : 's'}: ${invalidValues.join(', ')}.`, 'base-invalid-option');
        }
        return;
      }
      if (value && !meta.options.includes(value)) {
        addGeneralIssue(result, 'base', `C3X key "${key}" has unknown value "${value}". Expected one of: ${meta.options.join(', ')}.`, 'base-invalid-option');
      }
    }
  });
}

function buildBaseReferenceContext(bundle) {
  const improvementWonders = getReferenceSetFromBundle(bundle, 'improvements', (entry) => {
    const kind = String(entry && entry.improvementKind || '').trim().toLowerCase();
    return kind === 'wonder' || kind === 'small_wonder';
  });
  return {
    civilizations: getReferenceSetFromBundle(bundle, 'civilizations'),
    technologies: getReferenceSetFromBundle(bundle, 'technologies'),
    resources: getReferenceSetFromBundle(bundle, 'resources'),
    governments: getReferenceSetFromBundle(bundle, 'governments'),
    improvements: getReferenceSetFromBundle(bundle, 'improvements'),
    improvementWonders,
    units: getReferenceSetFromBundle(bundle, 'units')
  };
}

function collectInvalidReferences(values, set) {
  if (!(set instanceof Set) || set.size <= 0) return [];
  const seen = new Set();
  const invalid = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const display = normalizeConfigToken(value);
    const lookup = normalizeReferenceLookup(display);
    if (!display || !lookup || set.has(lookup) || seen.has(lookup)) return;
    seen.add(lookup);
    invalid.push(display);
  });
  return invalid;
}

function collectUniqueValues(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const display = normalizeConfigToken(value);
    const lookup = normalizeReferenceLookup(display);
    if (!display || !lookup || seen.has(lookup)) return;
    seen.add(lookup);
    out.push(display);
  });
  return out;
}

function referenceKnownInAny(value, sets) {
  const activeSets = (Array.isArray(sets) ? sets : [])
    .filter((set) => set instanceof Set && set.size > 0);
  if (activeSets.length <= 0) return true;
  const lookup = normalizeReferenceLookup(value);
  return !lookup || activeSets.some((set) => set.has(lookup));
}

function addBaseReferenceIssue(result, key, targetLabel, invalidValues) {
  const values = (Array.isArray(invalidValues) ? invalidValues : [])
    .map((value) => normalizeConfigToken(value))
    .filter(Boolean);
  if (values.length <= 0) return;
  addGeneralIssue(
    result,
    'base',
    `C3X key "${key}" references unknown ${targetLabel}${values.length === 1 ? '' : 's'}: ${values.join(', ')}. Civ3/C3X can error when loading unmatched names.`,
    'base-reference-missing'
  );
}

function auditBaseReferenceCompatibility(bundle, result) {
  const rows = (((bundle || {}).tabs || {}).base || {}).rows;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length <= 0) return;
  const context = buildBaseReferenceContext(bundle);

  list.forEach((row) => {
    const key = String(row && row.key || '').trim();
    if (!key) return;
    const value = String(row && row.value || '').trim();
    if (!value || value === '[]') return;

    if (key === 'buildings_generating_resources') {
      const items = parseBuildingResourceItems(value);
      addBaseReferenceIssue(result, key, 'improvement/building name', collectInvalidReferences(items.map((item) => item.building), context.improvements));
      addBaseReferenceIssue(result, key, 'resource name', collectInvalidReferences(items.map((item) => item.resource), context.resources));
      return;
    }

    if (key === 'building_prereqs_for_units') {
      const items = parseBuildingPrereqItems(value);
      addBaseReferenceIssue(result, key, 'improvement/building name', collectInvalidReferences(items.map((item) => item.building), context.improvements));
      addBaseReferenceIssue(result, key, 'unit name', collectInvalidReferences(items.flatMap((item) => item.units || []), context.units));
      return;
    }

    if (key === 'production_perfume' || key === 'perfume_specs') {
      const names = parseNameAmountItems(value).map((item) => item.name);
      const invalid = names.filter((name) => !referenceKnownInAny(name, [context.improvements, context.units]));
      addBaseReferenceIssue(result, key, 'unit or improvement name', collectUniqueValues(invalid));
      return;
    }

    if (key === 'technology_perfume') {
      addBaseReferenceIssue(result, key, 'technology name', collectInvalidReferences(parseNameAmountItems(value).map((item) => item.name), context.technologies));
      return;
    }

    if (key === 'resource_perfume') {
      addBaseReferenceIssue(result, key, 'resource name', collectInvalidReferences(parseNameAmountItems(value).map((item) => item.name), context.resources));
      return;
    }

    if (key === 'government_perfume') {
      addBaseReferenceIssue(result, key, 'government name', collectInvalidReferences(parseNameAmountItems(value).map((item) => item.name), context.governments));
      return;
    }

    if (key === 'work_area_improvements') {
      addBaseReferenceIssue(result, key, 'improvement/building name', collectInvalidReferences(parseNameAmountItems(value).map((item) => item.name), context.improvements));
      return;
    }

    if (key === 'unit_limits') {
      addBaseReferenceIssue(result, key, 'unit name', collectInvalidReferences(parseNameAmountItems(value).map((item) => item.name), context.units));
      return;
    }

    const meta = getBaseLintMeta(key);
    if (meta && meta.family === 'quoted_reference_list' && meta.referenceTab) {
      const labelByTab = {
        civilizations: 'civilization name',
        technologies: 'technology name',
        resources: 'resource name',
        governments: 'government name',
        improvements: 'improvement/building name',
        units: 'unit name'
      };
      addBaseReferenceIssue(result, key, labelByTab[meta.referenceTab] || 'reference name', collectInvalidReferences(parseBracketedOptionTokens(value), context[meta.referenceTab]));
      return;
    }

    if (key === 'great_wall_auto_build_wonder_name') {
      if (!isGreatWallAutoBuildReferenceActive(bundle)) return;
      const wonderName = normalizeConfigToken(value);
      if (!wonderName) return;
      const regularLookup = normalizeReferenceLookup(wonderName);
      const withoutArticle = regularLookup.replace(/^the\s+/, '').trim();
      const knownWonders = context.improvementWonders;
      if (knownWonders instanceof Set && knownWonders.size > 0 && !knownWonders.has(regularLookup) && !knownWonders.has(withoutArticle)) {
        addBaseReferenceIssue(result, key, 'wonder name', [wonderName]);
      }
    }
  });
}

function lintSectionFieldValue(fieldSpec, rawValue) {
  const value = String(rawValue == null ? '' : rawValue).trim();
  if (!fieldSpec || !value) return '';
  const acceptedOptions = Array.isArray(fieldSpec.acceptedOptions) && fieldSpec.acceptedOptions.length > 0
    ? fieldSpec.acceptedOptions
    : fieldSpec.options;
  if (fieldSpec.type === 'bool' && !isConfigBoolToken(value)) {
    return `Field "${fieldSpec.key}" has invalid boolean value "${value}".`;
  }
  if (fieldSpec.type === 'number' && !isIntegerToken(value)) {
    return `Field "${fieldSpec.key}" has invalid integer value "${value}".`;
  }
  if (fieldSpec.type === 'select' && Array.isArray(acceptedOptions) && acceptedOptions.length > 0 && !acceptedOptions.includes(value)) {
    return `Field "${fieldSpec.key}" has unknown value "${value}". Expected one of: ${acceptedOptions.join(', ')}.`;
  }
  if (fieldSpec.type === 'list') {
    if (!hasBalancedQuotes(value)) {
      return `Field "${fieldSpec.key}" has malformed quoted list syntax.`;
    }
    if (Array.isArray(acceptedOptions) && acceptedOptions.length > 0) {
      const invalidTokens = tokenizeListPreservingQuotes(value)
        .map((token) => normalizeConfigToken(token))
        .filter(Boolean)
        .filter((token) => !acceptedOptions.includes(token));
      if (invalidTokens.length > 0) {
        return `Field "${fieldSpec.key}" has unknown list value${invalidTokens.length === 1 ? '' : 's'}: ${invalidTokens.join(', ')}.`;
      }
    }
  }
  return '';
}

function lintSectionedTab(bundle, result, tabKey) {
  const spec = SECTION_LINT_SPECS[tabKey];
  if (!spec || !spec.knownFields) return;
  const model = ((((bundle || {}).tabs || {})[tabKey] || {}).model) || null;
  const sections = Array.isArray(model && model.sections) ? model.sections : [];
  sections.forEach((section, index) => {
    const label = getSectionDisplayName(section, index, spec.label);
    const fields = Array.isArray(section && section.fields) ? section.fields : [];
    fields.forEach((field) => {
      const key = String(field && field.key || '').trim();
      if (!key) return;
      const fieldSpec = spec.knownFields.get(key);
      if (!fieldSpec) {
        addSectionIssue(result, tabKey, index, `${label}: Unknown field "${key}". It will still be preserved, but may not be recognized.`, 'section-unknown-key');
        return;
      }
      const fieldIssue = lintSectionFieldValue({ ...fieldSpec, key }, field && field.value);
      if (fieldIssue) {
        addSectionIssue(result, tabKey, index, `${label}: ${fieldIssue}`, 'section-invalid-value');
      }
    });
  });
}

function getTechnologyAuditName(node) {
  return String(
    node
    && node.entry
    && (
      node.entry.name
      || getReferenceEntryFieldValue(node.entry, 'name')
      || node.entry.civilopediaKey
    )
    || `Technology ${node.index}`
  ).trim() || `Technology ${node.index}`;
}

const BIQ_REFERENCE_TARGETS = {
  technologies: { tabKey: 'technologies', sectionCode: 'TECH', label: 'tech' },
  resources: { tabKey: 'resources', sectionCode: 'GOOD', label: 'resource' },
  governments: { tabKey: 'governments', sectionCode: 'GOVT', label: 'government' },
  improvements: { tabKey: 'improvements', sectionCode: 'BLDG', label: 'improvement' },
  units: { tabKey: 'units', sectionCode: 'PRTO', label: 'unit' },
  civilizations: { tabKey: 'civilizations', sectionCode: 'RACE', label: 'civilization' },
  eras: { tabKey: '', sectionCode: 'ERAS', label: 'era' }
};

const BIQ_REFERENCE_FIELD_RULES = {
  resources: [
    { key: 'prerequisite', target: 'technologies', allowed: [-1] }
  ],
  improvements: [
    { key: 'reqimprovement', target: 'improvements', allowed: [-1] },
    { key: 'reqgovernment', target: 'governments', allowed: [-1] },
    { key: 'reqadvance', target: 'technologies', allowed: [-1] },
    { key: 'obsoleteby', target: 'technologies', allowed: [-1] },
    { key: 'reqresource1', target: 'resources', allowed: [-1] },
    { key: 'reqresource2', target: 'resources', allowed: [-1] },
    { key: 'unitproduced', target: 'units', allowed: [-1] },
    { key: 'gainineverycity', target: 'improvements', allowed: [-1] },
    { key: 'gainoncontinent', target: 'improvements', allowed: [-1] },
    { key: 'doubleshappiness', target: 'improvements', allowed: [-1] }
  ],
  units: [
    { key: 'requiredtech', target: 'technologies', allowed: [-1] },
    { key: 'upgradeto', target: 'units', allowed: [-1] },
    { key: 'requiredresource1', target: 'resources', allowed: [-1] },
    { key: 'requiredresource2', target: 'resources', allowed: [-1] },
    { key: 'requiredresource3', target: 'resources', allowed: [-1] },
    { key: 'enslaveresultsin', target: 'units', allowed: [-1] },
    { key: 'enslaveresultsinto', target: 'units', allowed: [-1] }
  ],
  civilizations: [
    { key: 'freetech1index', target: 'technologies', allowed: [-1] },
    { key: 'freetech2index', target: 'technologies', allowed: [-1] },
    { key: 'freetech3index', target: 'technologies', allowed: [-1] },
    { key: 'freetech4index', target: 'technologies', allowed: [-1] },
    { key: 'shunnedgovernment', target: 'governments', allowed: [-1] },
    { key: 'favoritegovernment', target: 'governments', allowed: [-1] },
    { key: 'kingunit', target: 'units', allowed: [-1] }
  ],
  governments: [
    { key: 'prerequisitetechnology', target: 'technologies', allowed: [-1] }
  ],
  technologies: [
    { key: 'era', target: 'eras', allowed: [-1] },
    { key: 'prerequisite1', target: 'technologies', allowed: [-1] },
    { key: 'prerequisite2', target: 'technologies', allowed: [-1] },
    { key: 'prerequisite3', target: 'technologies', allowed: [-1] },
    { key: 'prerequisite4', target: 'technologies', allowed: [-1] }
  ]
};

function getBiqSectionByCode(bundle, sectionCode) {
  const target = String(sectionCode || '').trim().toUpperCase();
  if (!target) return null;
  let summaryMatch = null;
  const directSections = ((bundle || {}).biq || {}).sections;
  if (Array.isArray(directSections)) {
    const match = directSections.find((section) => String(section && section.code || '').trim().toUpperCase() === target);
    if (match && (
      (Array.isArray(match.fullRecords) && match.fullRecords.length > 0) ||
      (Array.isArray(match.records) && match.records.length > 0) ||
      !match.summarized
    )) return match;
    if (match) summaryMatch = match;
  }
  const tabs = ((bundle || {}).tabs) || {};
  for (const tab of Object.values(tabs)) {
    const sections = Array.isArray(tab && tab.sections) ? tab.sections : [];
    const match = sections.find((section) => String(section && section.code || '').trim().toUpperCase() === target);
    if (match) return match;
  }
  return summaryMatch;
}

function getReferenceTargetIndexSet(bundle, targetKey) {
  const target = BIQ_REFERENCE_TARGETS[targetKey];
  const out = new Set();
  if (!target) return out;
  const tab = target.tabKey ? (((bundle || {}).tabs || {})[target.tabKey]) : null;
  if (tab && Array.isArray(tab.entries)) {
    tab.entries.forEach((entry, fallbackIndex) => {
      const rawIndex = entry && entry.biqIndex;
      const parsed = rawIndex == null || String(rawIndex).trim() === ''
        ? fallbackIndex
        : Number.parseInt(String(rawIndex), 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.add(parsed);
    });
  }
  const section = getBiqSectionByCode(bundle, target.sectionCode);
  const records = Array.isArray(section && section.fullRecords) && section.fullRecords.length > 0
    ? section.fullRecords
    : (Array.isArray(section && section.records) ? section.records : []);
  if (records.length > 0) {
    records.forEach((record, fallbackIndex) => {
      const parsed = Number.parseInt(String(record && record.index != null ? record.index : fallbackIndex), 10);
      if (Number.isFinite(parsed) && parsed >= 0) out.add(parsed);
    });
  } else if (section && Number.isFinite(Number(section.count)) && Number(section.count) > 0) {
    for (let i = 0; i < Number(section.count); i += 1) out.add(i);
  }
  return out;
}

function getReferenceEntryAuditName(entry, fallbackIndex) {
  return String(
    entry
    && (
      entry.name
      || getReferenceEntryFieldValue(entry, 'name')
      || entry.civilopediaKey
    )
    || `Record ${Number(fallbackIndex) + 1}`
  ).trim() || `Record ${Number(fallbackIndex) + 1}`;
}

function auditBiqReferenceIndexIntegrity(bundle, result) {
  const targetIndexSets = new Map();
  Object.keys(BIQ_REFERENCE_TARGETS).forEach((key) => {
    targetIndexSets.set(key, getReferenceTargetIndexSet(bundle, key));
  });

  let issueCount = 0;
  Object.entries(BIQ_REFERENCE_FIELD_RULES).forEach(([tabKey, rules]) => {
    const tab = (((bundle || {}).tabs || {})[tabKey]) || null;
    const entries = Array.isArray(tab && tab.entries) ? tab.entries : [];
    entries.forEach((entry, entryIndex) => {
      rules.forEach((rule) => {
        const field = getReferenceEntryField(entry, rule.key);
        if (!field) return;
        const raw = String(field.value == null ? '' : field.value).trim();
        if (!raw || /^none$/i.test(raw)) return;
        const idx = parseBiqReferenceIndex(raw, NaN);
        if (!Number.isFinite(idx)) return;
        if (Array.isArray(rule.allowed) && rule.allowed.includes(idx)) return;
        const validIndexes = targetIndexSets.get(rule.target) || new Set();
        if (validIndexes.has(idx)) return;
        const target = BIQ_REFERENCE_TARGETS[rule.target] || { label: 'record' };
        const label = String(field.label || rule.key || '').trim() || rule.key;
        const entryName = getReferenceEntryAuditName(entry, entryIndex);
        addSectionIssue(
          result,
          tabKey,
          entryIndex,
          `${entryName} ${label} points to missing ${target.label} index ${idx}. Civ3 can crash or hide dependent content when BIQ references point outside the target table.`,
          'biq-reference-out-of-range',
          {
            fieldKey: rule.key,
            target: rule.target,
            value: idx
          }
        );
        issueCount += 1;
      });
    });
  });

  if (issueCount > 0) {
    addGeneralIssue(
      result,
      'base',
      `${issueCount} BIQ reference index${issueCount === 1 ? '' : 'es'} point outside their target tables. Fix these before opening the scenario in Civ3.`,
      'biq-reference-integrity'
    );
  }
}

function getTechnologyPrerequisiteIndexes(entry) {
  const out = [];
  ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4'].forEach((key) => {
    const idx = parseBiqReferenceIndex(getReferenceEntryFieldValue(entry, key), NaN);
    if (Number.isFinite(idx) && idx >= 0 && !out.includes(idx)) out.push(idx);
  });
  return out;
}

function buildTechnologyPrerequisiteGraph(bundle) {
  const entries = ((((bundle || {}).tabs || {}).technologies || {}).entries) || [];
  const nodes = [];
  const byIndex = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry, fallbackIndex) => {
    const parsedIndex = Number.parseInt(String(entry && entry.biqIndex != null ? entry.biqIndex : fallbackIndex), 10);
    const index = Number.isFinite(parsedIndex) && parsedIndex >= 0 ? parsedIndex : fallbackIndex;
    const node = {
      entry,
      sectionIndex: fallbackIndex,
      index,
      prerequisites: getTechnologyPrerequisiteIndexes(entry)
    };
    nodes.push(node);
    if (!byIndex.has(index)) byIndex.set(index, node);
  });
  return { nodes, byIndex };
}

function canonicalizeTechCycle(cycleIndexes) {
  const cycle = Array.isArray(cycleIndexes) ? cycleIndexes.slice() : [];
  if (cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]) cycle.pop();
  if (cycle.length <= 0) return '';
  let best = null;
  for (let i = 0; i < cycle.length; i += 1) {
    const rotated = cycle.slice(i).concat(cycle.slice(0, i));
    const key = rotated.join('>');
    if (best == null || key < best) best = key;
  }
  return best || '';
}

function formatTechCycle(nodesByIndex, cycleIndexes) {
  const cycle = Array.isArray(cycleIndexes) ? cycleIndexes.slice() : [];
  return cycle.map((idx) => getTechnologyAuditName(nodesByIndex.get(idx) || { index: idx })).join(' -> ');
}

function auditTechnologyPrerequisiteCycles(bundle, result) {
  const { nodes, byIndex } = buildTechnologyPrerequisiteGraph(bundle);
  if (nodes.length <= 0) return;

  let selfReferenceCount = 0;
  nodes.forEach((node) => {
    if (!node.prerequisites.includes(node.index)) return;
    selfReferenceCount += 1;
    addSectionIssue(
      result,
      'technologies',
      node.sectionIndex,
      `${getTechnologyAuditName(node)} lists itself as a prerequisite. Civ3 can crash when opening the Tech Tree if a technology depends on itself.`,
      'tech-self-prerequisite'
    );
  });

  const graph = new Map();
  nodes.forEach((node) => {
    graph.set(
      node.index,
      node.prerequisites.filter((idx) => idx !== node.index && byIndex.has(idx))
    );
  });

  const state = new Map();
  const stack = [];
  const stackPos = new Map();
  const seenCycles = new Set();
  const cycles = [];

  const visit = (idx) => {
    state.set(idx, 1);
    stackPos.set(idx, stack.length);
    stack.push(idx);
    (graph.get(idx) || []).forEach((nextIdx) => {
      const nextState = state.get(nextIdx) || 0;
      if (nextState === 0) {
        visit(nextIdx);
        return;
      }
      if (nextState !== 1 || !stackPos.has(nextIdx)) return;
      const cycle = stack.slice(stackPos.get(nextIdx)).concat(nextIdx);
      const key = canonicalizeTechCycle(cycle);
      if (!key || seenCycles.has(key)) return;
      seenCycles.add(key);
      cycles.push(cycle);
    });
    stack.pop();
    stackPos.delete(idx);
    state.set(idx, 2);
  };

  nodes.forEach((node) => {
    if ((state.get(node.index) || 0) === 0) visit(node.index);
  });

  cycles.forEach((cycle) => {
    const display = formatTechCycle(byIndex, cycle);
    const uniqueIndexes = Array.from(new Set(cycle.slice(0, -1)));
    uniqueIndexes.forEach((idx) => {
      const node = byIndex.get(idx);
      if (!node) return;
      addSectionIssue(
        result,
        'technologies',
        node.sectionIndex,
        `Circular technology prerequisite chain detected: ${display}. Civ3 can crash when opening the Tech Tree because this loop cannot be completed.`,
        'tech-prerequisite-cycle'
      );
    });
  });

  if (selfReferenceCount > 0 || cycles.length > 0) {
    const parts = [];
    if (selfReferenceCount > 0) parts.push(`${selfReferenceCount} self-prerequisite tech${selfReferenceCount === 1 ? '' : 's'}`);
    if (cycles.length > 0) parts.push(`${cycles.length} circular prerequisite chain${cycles.length === 1 ? '' : 's'}`);
    addGeneralIssue(
      result,
      'technologies',
      `Technology prerequisite logic has ${parts.join(' and ')}. Fix these before opening the in-game Tech Tree.`,
      'tech-prerequisite-logic'
    );
  }
}

function auditDayNightAssets(bundle, result) {
  const mode = String(getBaseRowValue(bundle, 'day_night_cycle_mode') || '').trim().toLowerCase();
  if (!mode || mode === 'off') return;
  const seasons = getSeasonsToAudit(bundle);
  const hours = getHoursToAudit(bundle);

  seasons.forEach((season) => {
    hours.forEach((hour) => {
      const missingTerrain = DAY_NIGHT_TERRAIN_FILES.filter((fileName) => !resolveDayNightArtFile(bundle, 'terrain', season, hour, fileName));
      if (missingTerrain.length > 0) {
        addGeneralIssue(
          result,
          'base',
          `Day/night ${formatSeasonHourLabel(seasons, season, hour)} is missing terrain art: ${missingTerrain.join(', ')}.`,
          'day-night-terrain-missing'
        );
      }
    });
  });

  if (!parseConfigBool(getBaseRowValue(bundle, 'enable_districts'))) return;

  const districtSections = (((bundle || {}).tabs || {}).districts || {}).model;
  const districtList = Array.isArray(districtSections && districtSections.sections) ? districtSections.sections : [];

  districtList.forEach((section, index) => {
    const label = getSectionDisplayName(section, index, 'District');
    const imgPaths = tokenizeListPreservingQuotes(getFieldValue(section, 'img_paths'))
      .map((value) => normalizeConfigToken(value))
      .filter(Boolean);
    imgPaths.forEach((fileName) => {
      seasons.forEach((season) => {
        const missingHours = hours.filter((hour) => !resolveDayNightArtFile(bundle, 'district', season, hour, fileName));
        if (missingHours.length <= 0) return;
        addSectionIssue(
          result,
          'districts',
          index,
          `${label}: Day/night art "${fileName}" is missing for ${formatSeasonHoursLabel(seasons, season)}: ${formatHoursList(missingHours)}.`,
          'day-night-district-missing'
        );
      });
    });
  });

  seasons.forEach((season) => {
    const missingAbandonedHours = hours.filter((hour) => !resolveDayNightArtFile(bundle, 'district', season, hour, 'Abandoned.pcx'));
    if (missingAbandonedHours.length > 0) {
      addGeneralIssue(
        result,
        'districts',
        `Day/night art "Abandoned.pcx" is missing for ${formatSeasonHoursLabel(seasons, season)}: ${formatHoursList(missingAbandonedHours)}.`,
        'day-night-district-missing'
      );
    }
  });
}

function normalizePediaArtPathForCiv3Length(rawPath) {
  return String(rawPath || '').trim().replace(/^["']|["']$/g, '').replace(/\//g, '\\');
}

function getCiv3PediaArtPathLength(rawPath) {
  return normalizePediaArtPathForCiv3Length(rawPath).length;
}

function getExpectedReferenceArtDirectoryForAudit(tabKey, group, index) {
  const normalizedTab = String(tabKey || '').trim();
  const normalizedGroup = String(group || '').trim();
  const idx = Number(index);
  if (normalizedTab === 'civilizations' && normalizedGroup === 'iconPaths') return 'Art/Civilopedia/Icons/Races';
  if (normalizedTab === 'civilizations' && normalizedGroup === 'racePaths') {
    return idx === 0 ? 'Art/Leaderheads' : 'Art/Advisors';
  }
  if (normalizedTab === 'improvements' && normalizedGroup === 'wonderSplashPath') return 'Art/Wonder Splash';
  if (normalizedTab === 'improvements' && normalizedGroup === 'iconPaths') return 'Art/Civilopedia/Icons/Buildings';
  if (normalizedTab === 'technologies' && normalizedGroup === 'iconPaths') return 'Art/tech chooser/Icons';
  if (normalizedTab === 'units' && normalizedGroup === 'iconPaths') return 'Art/Civilopedia/Icons/Units';
  if (normalizedTab === 'resources' && normalizedGroup === 'iconPaths') return 'Art/Civilopedia/Icons/Resources';
  if (normalizedTab === 'governments' && normalizedGroup === 'iconPaths') return 'Art/Civilopedia/Icons/Governments';
  return 'Art/Civilopedia/Icons';
}

function sanitizePediaArtFileName(rawName, fallbackStem = 'art') {
  const base = path.posix.basename(String(rawName || '').replace(/\\/g, '/'))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '');
  const stem = base.replace(/\.[^.]+$/i, '').trim().replace(/[. ]+$/g, '') || fallbackStem;
  const ext = (path.posix.extname(base) || '.pcx').toLowerCase();
  return `${stem}${ext}`;
}

function splitPreservedPediaArtSuffix(stem) {
  const value = String(stem || '');
  const match = value.match(/^(.+?)([_ -]?)(small|large|sm|lg|32|128)$/i);
  if (!match) return { base: value, suffix: '' };
  const separator = match[2] || '_';
  return { base: match[1] || value, suffix: `${separator}${String(match[3] || '').toLowerCase()}` };
}

function appendStemNumberBeforePediaArtSuffix(stem, attempt, maxStemLength) {
  const suffixParts = splitPreservedPediaArtSuffix(stem);
  const numericSuffix = `_${Number(attempt) + 1}`;
  const preservedSuffix = suffixParts.suffix.length < maxStemLength ? suffixParts.suffix : '';
  const baseStem = preservedSuffix ? suffixParts.base : stem;
  const baseMax = Math.max(1, maxStemLength - numericSuffix.length - preservedSuffix.length);
  const trimmedBase = baseStem.slice(0, baseMax).replace(/[._ -]+$/g, '') || 'art';
  return `${trimmedBase}${numericSuffix}${preservedSuffix}`;
}

function shortenPediaArtRelativePath(rawPath) {
  const normalized = normalizeAssetReferencePath(rawPath);
  if (!normalized || getCiv3PediaArtPathLength(normalized) <= CIV3_PEDIA_ART_PATH_MAX_CHARS) return normalized;
  const dir = path.posix.dirname(normalized);
  const fileName = sanitizePediaArtFileName(path.posix.basename(normalized), 'art');
  const ext = path.posix.extname(fileName) || '.pcx';
  const stem = path.posix.basename(fileName, ext) || 'art';
  const prefix = dir && dir !== '.' ? `${dir}/` : '';
  const maxFileNameLength = CIV3_PEDIA_ART_PATH_MAX_CHARS - normalizePediaArtPathForCiv3Length(prefix).length;
  if (maxFileNameLength <= ext.length + 1) return normalized;
  const maxStemLength = Math.max(1, maxFileNameLength - ext.length);
  const suffixParts = splitPreservedPediaArtSuffix(stem);
  const suffix = suffixParts.suffix.length < maxStemLength ? suffixParts.suffix : '';
  const baseMax = Math.max(1, maxStemLength - suffix.length);
  const baseStem = suffix ? suffixParts.base : stem;
  const trimmedStem = `${baseStem.slice(0, baseMax).replace(/[._ -]+$/g, '') || 'art'}${suffix}`;
  return normalizeAssetReferencePath(`${prefix}${trimmedStem}${ext}`);
}

function appendNumericSuffixToPediaArtPath(relPath, attempt) {
  const normalized = normalizeAssetReferencePath(relPath);
  const dir = path.posix.dirname(normalized);
  const ext = path.posix.extname(normalized) || '.pcx';
  const stem = path.posix.basename(normalized, ext) || 'art';
  const prefix = dir && dir !== '.' ? `${dir}/` : '';
  const suffix = `_${Number(attempt) + 1}`;
  const maxFileNameLength = CIV3_PEDIA_ART_PATH_MAX_CHARS - normalizePediaArtPathForCiv3Length(prefix).length;
  if (maxFileNameLength > ext.length + suffix.length) {
    const maxStemLength = Math.max(1, maxFileNameLength - ext.length);
    const trimmedStem = appendStemNumberBeforePediaArtSuffix(stem, attempt, maxStemLength);
    return normalizeAssetReferencePath(`${prefix}${trimmedStem}${ext}`);
  }
  return shortenPediaArtRelativePath(normalized);
}

function filesHaveSameBytes(leftPath, rightPath) {
  const left = String(leftPath || '').trim();
  const right = String(rightPath || '').trim();
  if (!left || !right) return false;
  try {
    const leftResolved = path.resolve(left);
    const rightResolved = path.resolve(right);
    if (leftResolved.toLowerCase() === rightResolved.toLowerCase()) return true;
    const leftStats = fs.statSync(leftResolved);
    const rightStats = fs.statSync(rightResolved);
    if (!leftStats.isFile() || !rightStats.isFile() || leftStats.size !== rightStats.size) return false;
    return Buffer.compare(fs.readFileSync(leftResolved), fs.readFileSync(rightResolved)) === 0;
  } catch (_err) {
    return false;
  }
}

function buildShortReferenceArtPath(bundle, tabKey, entry, asset, reservedPaths = new Set()) {
  const fieldKey = String(asset && asset.fieldKey || '').trim() || (asset && asset.group === 'race' ? 'racePaths' : 'iconPaths');
  const index = Number.isFinite(Number(asset && asset.index)) ? Number(asset.index) : 0;
  const rawPath = normalizeAssetReferencePath(asset && asset.path);
  const dir = getExpectedReferenceArtDirectoryForAudit(tabKey, fieldKey, index);
  const fallbackStem = String(entry && entry.civilopediaKey || entry && entry.name || 'art')
    .replace(/^(RACE|TECH|GOOD|BLDG|GOVT|PRTO)_/i, '')
    .toLowerCase();
  const fileName = sanitizePediaArtFileName(path.posix.basename(rawPath || fallbackStem), fallbackStem);
  const baseCandidate = shortenPediaArtRelativePath(normalizeAssetReferencePath(`${dir}/${fileName}`));
  const sourcePath = resolveReferenceArtFile(bundle, entry, rawPath) || '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? baseCandidate : appendNumericSuffixToPediaArtPath(baseCandidate, attempt - 1);
    const candidateKey = candidate.toLowerCase();
    if (candidateKey === rawPath.toLowerCase()) continue;
    if (reservedPaths.has(candidateKey)) {
      const reservedSource = resolveReferenceArtFile(bundle, entry, reservedPaths.get(candidateKey)) || '';
      if (!filesHaveSameBytes(reservedSource, sourcePath)) continue;
    }
    const existingCandidate = resolveReferenceArtFile(bundle, entry, candidate);
    if (existingCandidate && !filesHaveSameBytes(existingCandidate, sourcePath)) continue;
    return candidate;
  }
  return baseCandidate;
}

function getReferenceEntryAssetPaths(tabKey, entry) {
  const assetPaths = [];
  const add = (group, value, fieldKey = group, index = 0) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    assetPaths.push({ group, fieldKey, index, path: normalized });
  };
  (Array.isArray(entry && entry.iconPaths) ? entry.iconPaths : []).forEach((value, index) => add('icon', value, 'iconPaths', index));
  if (String(tabKey || '').trim() === 'improvements' && entry && entry.wonderSplashPath) {
    add('icon', entry.wonderSplashPath, 'wonderSplashPath', 0);
  }
  if (String(tabKey || '').trim() === 'civilizations') {
    (Array.isArray(entry && entry.racePaths) ? entry.racePaths : []).forEach((value, index) => add('race', value, 'racePaths', index));
  }
  return assetPaths;
}

function resolveReferenceArtFile(bundle, entry, assetPath) {
  const scenarioPath = String(entry && entry._importScenarioPath || bundle && bundle.scenarioPath || bundle && bundle.scenarioInputPath || '').trim();
  const scenarioPaths = Array.isArray(entry && entry._importScenarioPaths) && entry._importScenarioPaths.length > 0
    ? entry._importScenarioPaths
    : (Array.isArray(bundle && bundle.scenarioSearchPaths) ? bundle.scenarioSearchPaths : []);
  return resolveConquestsAssetPath(
    bundle && bundle.civ3Path,
    assetPath,
    scenarioPath,
    scenarioPaths,
    String(entry && entry.civilopediaKey || '')
  );
}

function auditReferenceArt(bundle, result) {
  const resolvedPathCache = new Map();
  REFERENCE_ART_TABS.forEach((tabKey) => {
    const tab = (((bundle || {}).tabs || {})[tabKey]) || null;
    const entries = Array.isArray(tab && tab.entries) ? tab.entries : [];
    entries.forEach((entry, index) => {
      const label = getReferenceEntryDisplayName(tabKey, entry) || `${tabKey} ${index + 1}`;
      const seenPaths = new Set();
      const entryAssetPaths = getReferenceEntryAssetPaths(tabKey, entry);
      entryAssetPaths.forEach((asset) => {
        const dedupeKey = String(asset && asset.path || '').trim().toLowerCase();
        if (!dedupeKey || seenPaths.has(dedupeKey)) return;
        seenPaths.add(dedupeKey);
        const pathLength = getCiv3PediaArtPathLength(asset.path);
        if (pathLength > CIV3_PEDIA_ART_PATH_MAX_CHARS) {
          const currentPathKey = normalizeAssetReferencePath(asset.path).toLowerCase();
          const reservedPaths = new Map();
          entryAssetPaths.forEach((item) => {
            const itemPath = normalizeAssetReferencePath(item && item.path);
            const itemKey = itemPath.toLowerCase();
            if (itemKey && itemKey !== currentPathKey && !reservedPaths.has(itemKey)) {
              reservedPaths.set(itemKey, itemPath);
            }
          });
          const replacementPath = buildShortReferenceArtPath(bundle, tabKey, entry, asset, reservedPaths);
          const replacementLength = getCiv3PediaArtPathLength(replacementPath);
          const sourcePath = resolveReferenceArtFile(bundle, entry, asset.path) || '';
          const action = replacementPath
            && replacementLength <= CIV3_PEDIA_ART_PATH_MAX_CHARS
            && replacementPath.toLowerCase() !== normalizeAssetReferencePath(asset.path).toLowerCase()
            ? {
              type: 'shorten-reference-art-path',
              tabKey,
              group: String(asset.fieldKey || '').trim() || 'iconPaths',
              index: Number.isFinite(Number(asset.index)) ? Number(asset.index) : 0,
              civilopediaKey: String(entry && entry.civilopediaKey || ''),
              currentPath: String(asset.path || ''),
              replacementPath,
              sourcePath: String(sourcePath || ''),
              label: `Shorten to ${replacementPath}`,
              description: `Stage this art under ${replacementPath}.`
            }
            : null;
          addSectionIssue(
            result,
            tabKey,
            index,
            `${label}: Art path "${asset.path}" is ${pathLength} characters; Civ3 may truncate PediaIcons art paths after ${CIV3_PEDIA_ART_PATH_MAX_CHARS} characters.`,
            'reference-art-path-too-long',
            action ? { action } : {}
          );
        }
        const cacheKey = JSON.stringify({
          civ3Path: bundle && bundle.civ3Path,
          scenarioPath: String(entry && entry._importScenarioPath || bundle && bundle.scenarioPath || bundle && bundle.scenarioInputPath || ''),
          scenarioPaths: Array.isArray(entry && entry._importScenarioPaths) && entry._importScenarioPaths.length > 0
            ? entry._importScenarioPaths
            : (Array.isArray(bundle && bundle.scenarioSearchPaths) ? bundle.scenarioSearchPaths : []),
          civilopediaKey: String(entry && entry.civilopediaKey || ''),
          assetPath: String(asset && asset.path || '')
        });
        let resolved = resolvedPathCache.get(cacheKey);
        if (typeof resolved === 'undefined') {
          resolved = resolveReferenceArtFile(bundle, entry, asset.path);
          resolvedPathCache.set(cacheKey, resolved || null);
        }
        if (resolved) return;
        addSectionIssue(
          result,
          tabKey,
          index,
          `${label}: Missing art file "${asset.path}".`,
          asset.group === 'race' ? 'reference-race-art-missing' : 'reference-icon-art-missing'
        );
      });
    });
  });
}

function auditUnitRuntimeAssets(bundle, result) {
  const roots = getUnitRuntimeSearchRoots(bundle);
  if (roots.length <= 0) return;
  const tab = (((bundle || {}).tabs || {}).units) || null;
  const entries = Array.isArray(tab && tab.entries) ? tab.entries : [];
  const unitCache = new Map();

  entries.forEach((entry, index) => {
    const animationName = String(entry && entry.animationName || '').trim();
    if (!animationName) return;
    const label = getReferenceEntryAuditName(entry, index);
    let audit = unitCache.get(animationName);
    if (!audit) {
      const iniPath = getRuntimeUnitIniPath(bundle, animationName);
      const missing = [];
      if (!iniPath) {
        missing.push({
          displayPath: getUnitRuntimeExpectedDisplayPath(animationName, `${animationName}.ini`),
          sourceDisplayPath: ''
        });
      } else {
        const manifest = parseUnitAnimationIni(iniPath);
        const seen = new Set();
        collectUnitIniRuntimeAssetRefs(manifest).forEach((ref) => {
          const displayPath = getUnitRuntimeExpectedDisplayPath(animationName, ref.value);
          const key = displayPath.toLowerCase();
          if (!displayPath || seen.has(key)) return;
          seen.add(key);
          const resolved = resolveUnitRuntimeAssetPath(bundle, animationName, ref.value);
          if (!resolved) {
            missing.push({ displayPath, sourceDisplayPath: '' });
          }
        });
      }
      audit = missing;
      unitCache.set(animationName, audit);
    }

    audit.forEach((missing) => {
      const source = String(missing && missing.sourceDisplayPath || '').trim();
      const suffix = source ? ` referenced by "${source}"` : '';
      addSectionIssue(
        result,
        'units',
        index,
        `${label}: Missing unit runtime file "${missing.displayPath}"${suffix}. Civ3 may exit with FILE NOT FOUND when this unit loads.`,
        'unit-runtime-file-missing'
      );
    });
  });
}

function isBiqBackedReferenceEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (Number.isFinite(Number(entry.biqIndex))) return true;
  return !!String(entry.rawBiqCivilopediaKey || '').trim();
}

function getReferenceTextSourceDetails(bundle) {
  const tabs = ((bundle || {}).tabs || {});
  for (const tabKey of REFERENCE_ART_TABS) {
    const details = tabs[tabKey] && tabs[tabKey].sourceDetails;
    if (details && typeof details === 'object') return details;
  }
  return {};
}

function getScenarioTextAuditPaths(bundle) {
  const details = getReferenceTextSourceDetails(bundle);
  const pediaIconsScenario = String(details.pediaIconsScenario || '').trim();
  const civilopediaScenario = String(details.civilopediaScenario || '').trim();
  return {
    civilopedia: fileExists(civilopediaScenario) ? civilopediaScenario : '',
    civilopediaFallback: getFirstExistingPath([
      details.civilopediaConquests,
      details.civilopediaPtw,
      details.civilopediaVanilla
    ]),
    pediaIcons: fileExists(pediaIconsScenario) ? pediaIconsScenario : '',
    pediaIconsFallback: getFirstExistingPath([
      details.pediaIconsConquests,
      details.pediaIconsPtw,
      details.pediaIconsVanilla
    ])
  };
}

function getFirstExistingPath(paths) {
  return (Array.isArray(paths) ? paths : [])
    .map((value) => String(value || '').trim())
    .find((value) => fileExists(value)) || '';
}

function readAuditTextFile(filePath) {
  const info = readTextFileWithEncodingInfoIfExists(filePath, { preferredEncoding: 'windows-1252' });
  return info ? String(info.text || '') : '';
}

function normalizePediaIconLineForAudit(line) {
  return String(line || '').trim().replace(/\//g, '\\').toLowerCase();
}

function normalizeAssetReferencePath(rawPath) {
  return String(rawPath || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.?[\\/]+/, '');
}

function collectPediaIconsKeys(doc, predicate) {
  const keys = new Set();
  (Array.isArray(doc && doc.items) ? doc.items : []).forEach((item) => {
    const key = String(item && item.key || '').trim().toUpperCase();
    if (key && (!predicate || predicate(key))) keys.add(key);
  });
  return keys;
}

function missingCountFromFallback(scenarioKeys, fallbackKeys) {
  let missing = 0;
  fallbackKeys.forEach((key) => {
    if (!scenarioKeys.has(key)) missing += 1;
  });
  return missing;
}

function hasSuspiciousTextOverrideSize(scenarioDoc, fallbackDoc) {
  const scenarioCount = Array.isArray(scenarioDoc && scenarioDoc.items) ? scenarioDoc.items.length : 0;
  const fallbackCount = Array.isArray(fallbackDoc && fallbackDoc.items) ? fallbackDoc.items.length : 0;
  return fallbackCount >= 50 && scenarioCount > 0 && scenarioCount < 20 && scenarioCount < Math.ceil(fallbackCount * 0.1);
}

function isPediaIconsRealBlockKeyForAudit(key) {
  const normalized = String(key || '').trim().toUpperCase();
  if (!normalized || normalized === 'END CIVILOPEDIA ART' || normalized === 'HOMELESSICONS') return false;
  return PEDIAICONS_REAL_BLOCK_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || /^RACE_|^PRTO_|^BLDG_|^GOOD_|^GOVT_/.test(normalized);
}

function pediaIconsHasFiraxisHomelessPlaceholders(homelessItem) {
  const actual = (Array.isArray(homelessItem && homelessItem.rawLines) ? homelessItem.rawLines : [])
    .map(normalizePediaIconLineForAudit)
    .filter(Boolean);
  if (actual.length <= 0) return false;
  let cursor = 0;
  for (const expectedLine of FIRAXIS_HOMELESS_PLACEHOLDER_LINES) {
    const expected = normalizePediaIconLineForAudit(expectedLine);
    const found = actual.slice(cursor).findIndex((line) => line === expected);
    if (found < 0) return false;
    cursor += found + 1;
  }
  return true;
}

function collectScenarioTextHealthIssues(paths) {
  const issues = [];
  if (paths.pediaIcons) {
    const scenarioText = readAuditTextFile(paths.pediaIcons);
    const scenarioDoc = parsePediaIconsDocumentWithOrder(scenarioText);

    const homelessItem = (Array.isArray(scenarioDoc.items) ? scenarioDoc.items : [])
      .find((item) => String(item && item.key || '').trim().toUpperCase() === 'HOMELESSICONS');
    if (!homelessItem) {
      issues.push({
        code: 'scenario-pediaicons-homeless-missing',
        message: 'Scenario PediaIcons.txt is missing #HomelessIcons. Firaxis Conquests editor can freeze on Improvements and Wonders when this section is damaged; saving with this version will restore the safe placeholder block.'
      });
    } else {
      const misplaced = (Array.isArray(homelessItem.rawLines) ? homelessItem.rawLines : [])
        .filter((line) => String(line || '').trim().startsWith('#'))
        .map((line) => String(line || '').trim().slice(1).trim().toUpperCase())
        .filter(isPediaIconsRealBlockKeyForAudit);
      if (misplaced.length > 0 || !pediaIconsHasFiraxisHomelessPlaceholders(homelessItem)) {
        issues.push({
          code: 'scenario-pediaicons-homeless-damaged',
          message: 'Scenario PediaIcons.txt has a damaged #HomelessIcons section. Firaxis Conquests editor can freeze on Improvements and Wonders when real icon blocks are moved there or the safe placeholder rows are missing; saving with this version will repair it.'
        });
      }
    }

    if (paths.pediaIconsFallback) {
      const fallbackText = readAuditTextFile(paths.pediaIconsFallback);
      const fallbackDoc = parsePediaIconsDocumentWithOrder(fallbackText);
      const scenarioKeys = collectPediaIconsKeys(scenarioDoc);
      const fallbackEraSplashKeys = collectPediaIconsKeys(fallbackDoc, (key) => key.startsWith('ERA_SPLASH_'));
      const missingEraSplash = missingCountFromFallback(scenarioKeys, fallbackEraSplashKeys);
      if (missingEraSplash > 0) {
        issues.push({
          code: 'scenario-pediaicons-era-splash-missing',
          message: `Scenario PediaIcons.txt is missing ${missingEraSplash} stock EraSplash block(s) that exist in the fallback PediaIcons.txt. This can crash the game on era transitions; saving after a relevant edit with this version preserves/restores fallback text instead of creating a tiny override.`
        });
      }
      if (hasSuspiciousTextOverrideSize(scenarioDoc, fallbackDoc)) {
        issues.push({
          code: 'scenario-pediaicons-suspiciously-small',
          message: 'Scenario PediaIcons.txt is much smaller than its fallback source file. That often means stock entries were accidentally dropped; review the file or save after a PediaIcons-related edit with this version so it can be rebuilt from fallback text.'
        });
      }
    }
  }

  if (paths.civilopedia) {
    const scenarioText = readAuditTextFile(paths.civilopedia);
    const scenarioDoc = parseCivilopediaDocumentWithOrder(scenarioText);

    if (paths.civilopediaFallback) {
      const fallbackText = readAuditTextFile(paths.civilopediaFallback);
      const fallbackDoc = parseCivilopediaDocumentWithOrder(fallbackText);
      if (hasSuspiciousTextOverrideSize(scenarioDoc, fallbackDoc)) {
        issues.push({
          code: 'scenario-civilopedia-suspiciously-small',
          message: 'Scenario Civilopedia.txt is much smaller than its fallback source file. That often means stock articles were accidentally dropped; review the file or save after a Civilopedia-related edit with this version so it can be rebuilt from fallback text.'
        });
      }
    }
  }
  return issues;
}

function readPathMatchesScenario(readPath, scenarioPath) {
  const read = normalizeFsPathForCompare(readPath);
  const scenario = normalizeFsPathForCompare(scenarioPath);
  return !!read && !!scenario && read === scenario;
}

function getEntryCivilopediaKey(entry) {
  return String(
    entry && (
      entry.rawBiqCivilopediaKey
      || entry.displayCivilopediaKey
      || entry.rawCivilopediaKey
      || entry.civilopediaKey
    ) || ''
  ).trim();
}

function getExpectedReferencePediaIconsKeys(tabKey, civilopediaKey) {
  const key = String(civilopediaKey || '').trim();
  if (!key) return [];
  if (tabKey === 'improvements' && /^BLDG_/i.test(key)) return [`ICON_${key}`];
  if (tabKey === 'technologies' && /^TECH_/i.test(key)) return [key, `${key}_LARGE`];
  return [];
}

function formatExpectedReferencePediaIconsLabel(keys) {
  const normalized = (Array.isArray(keys) ? keys : [])
    .map((key) => String(key || '').trim())
    .filter(Boolean)
    .map((key) => `#${key}`);
  if (normalized.length <= 0) return 'matching PediaIcons block';
  if (normalized.length === 1) return normalized[0];
  return `${normalized.slice(0, -1).join(', ')} and ${normalized[normalized.length - 1]}`;
}

function auditScenarioTextCoverage(bundle, result) {
  const scenarioTextPaths = getScenarioTextAuditPaths(bundle);
  if (!scenarioTextPaths.pediaIcons) return;

  const scenarioText = readAuditTextFile(scenarioTextPaths.pediaIcons);
  const scenarioDoc = parsePediaIconsDocumentWithOrder(scenarioText);
  const scenarioKeys = collectPediaIconsKeys(scenarioDoc);

  ['improvements', 'technologies'].forEach((tabKey) => {
    const tab = (((bundle || {}).tabs || {})[tabKey]) || null;
    const entries = Array.isArray(tab && tab.entries) ? tab.entries : [];
    entries.forEach((entry, index) => {
      if (!isBiqBackedReferenceEntry(entry)) return;
      const civilopediaKey = getEntryCivilopediaKey(entry);
      const expectedKeys = getExpectedReferencePediaIconsKeys(tabKey, civilopediaKey);
      if (expectedKeys.length <= 0) return;
      const missingKeys = expectedKeys.filter((key) => !scenarioKeys.has(String(key || '').trim().toUpperCase()));
      if (missingKeys.length <= 0) return;
      const sourceMeta = (entry && entry.sourceMeta) || {};
      const iconReadPath = sourceMeta.iconPaths && sourceMeta.iconPaths.readPath;
      const expectedLabel = formatExpectedReferencePediaIconsLabel(missingKeys);
      const label = getReferenceEntryDisplayName(tabKey, entry) || civilopediaKey;
      const referenceLabel = tabKey === 'technologies' ? 'technology' : 'improvement';
      addSectionIssue(
        result,
        tabKey,
        index,
        `${label}: Scenario PediaIcons.txt is missing ${expectedLabel}; Civ3 can stop loading when this BIQ ${referenceLabel} is referenced.`,
        'scenario-pediaicons-entry-missing',
        {
          action: {
            type: 'copy-scenario-pediaicons-block',
            tabKey,
            label: `Add ${formatExpectedReferencePediaIconsLabel(expectedKeys)}`,
            expectedLabel: formatExpectedReferencePediaIconsLabel(expectedKeys),
            expectedKeys,
            civilopediaKey,
            sourcePath: String(iconReadPath || '').trim(),
            targetPath: scenarioTextPaths.pediaIcons
          }
        }
      );
    });
  });
}

function auditScenarioTextHealth(bundle, result) {
  const scenarioTextPaths = getScenarioTextAuditPaths(bundle);
  collectScenarioTextHealthIssues(scenarioTextPaths).forEach((issue) => {
    addGeneralIssue(result, 'civilizations', issue.message, issue.code);
  });
}

const CIVILOPEDIA_LINK_PATTERN = /\$LINK<([^=<>]+)=([^<>]+)>/g;
const CIVILOPEDIA_LINK_TARGET_PREFIX_RE = /^(?:RACE|TECH|GOOD|BLDG|PRTO|GCON|TERR|TFRM)_/i;

function collectCanonicalCivilopediaKeys(bundle) {
  const keys = new Map();
  Object.values(((bundle || {}).tabs || {})).forEach((tab) => {
    if (tab && Array.isArray(tab.entries)) {
      tab.entries.forEach((entry) => {
        const key = String(entry && entry.civilopediaKey || '').trim();
        const actualKey = String(entry && entry.rawCivilopediaKey || key).trim();
        if (key) keys.set(key.toUpperCase(), actualKey || key);
      });
    }
    const pedia = tab && tab.civilopedia;
    [pedia && pedia.terrain, pedia && pedia.workerActions].filter(Boolean).forEach((nested) => {
      (Array.isArray(nested && nested.entries) ? nested.entries : []).forEach((entry) => {
        const key = String(entry && entry.civilopediaKey || '').trim();
        const actualKey = String(entry && entry.rawCivilopediaKey || key).trim();
        if (key) keys.set(key.toUpperCase(), actualKey || key);
      });
    });
  });
  return keys;
}

function auditCivilopediaLinks(bundle, result) {
  const canonicalKeys = collectCanonicalCivilopediaKeys(bundle);
  if (canonicalKeys.size <= 0) return;
  Object.entries(((bundle || {}).tabs || {})).forEach(([tabKey, tab]) => {
    if (!tab || !Array.isArray(tab.entries)) return;
    tab.entries.forEach((entry, index) => {
      const label = getReferenceEntryDisplayName(tabKey, entry) || `${tabKey} ${index + 1}`;
      const text = `${String(entry && entry.civilopediaSection1 || '')}\n${String(entry && entry.civilopediaSection2 || '')}`;
      for (const match of text.matchAll(CIVILOPEDIA_LINK_PATTERN)) {
        const target = String(match[2] || '').trim();
        const canonical = canonicalKeys.get(target.toUpperCase());
        if (!target) continue;
        if (!canonical) {
          if (!CIVILOPEDIA_LINK_TARGET_PREFIX_RE.test(target)) continue;
          addSectionIssue(
            result,
            tabKey,
            index,
            `${label}: Civilopedia link target "${target}" has no matching entry.`,
            'civilopedia-link-target-missing'
          );
          continue;
        }
        if (target === canonical) continue;
        addSectionIssue(
          result,
          tabKey,
          index,
          `${label}: Civilopedia link target "${target}" differs in case from actual key "${canonical}". Civ3 links are case-sensitive.`,
          'civilopedia-link-case-mismatch'
        );
      }
    });
  });
}

function auditScenarioPlayableCivilizationSlots(bundle, result) {
  const gameSection = getBiqSection(bundle, 'scenarioSettings', 'GAME');
  const leadSection = getBiqSection(bundle, 'players', 'LEAD');
  const gameRecord = gameSection && Array.isArray(gameSection.records) ? gameSection.records[0] : null;
  const leadRecords = leadSection && Array.isArray(leadSection.records) ? leadSection.records : [];
  if (!gameRecord || leadRecords.length <= 0) return;

  const civEntries = Array.isArray((((bundle || {}).tabs || {}).civilizations || {}).entries)
    ? bundle.tabs.civilizations.entries
    : [];
  const civNamesByIndex = new Map();
  civEntries.forEach((entry, idx) => {
    const biqIndex = Number.parseInt(entry && entry.biqIndex, 10);
    const key = Number.isFinite(biqIndex) ? biqIndex : idx;
    const name = String(entry && entry.name || '').trim();
    if (Number.isFinite(key) && name) civNamesByIndex.set(key, name);
  });
  const civName = (idx) => civNamesByIndex.get(idx) || `RACE #${idx}`;

  let playableIds = (Array.isArray(gameRecord.fields) ? gameRecord.fields : [])
    .filter((field) => /^playable_civ(?:_\d+)?$/i.test(String(field && (field.baseKey || field.key) || '')))
    .map((field) => parseBiqReferenceIndex(field && field.value, NaN))
    .filter((idx) => Number.isFinite(idx) && idx >= 0);
  playableIds = Array.from(new Set(playableIds));
  const playableCount = parseBiqReferenceIndex(getBiqRecordFieldValue(gameRecord, 'numberofplayablecivs'), playableIds.length);
  if (playableCount === 0 && playableIds.length === 0 && civEntries.length > 1) {
    playableIds = civEntries
      .map((entry, idx) => {
        const biqIndex = Number.parseInt(entry && entry.biqIndex, 10);
        return Number.isFinite(biqIndex) ? biqIndex : idx;
      })
      .filter((idx) => idx > 0);
  }
  if (playableIds.length <= 0) return;

  const fixedLeadCivs = new Set();
  let hasHumanWildcard = false;
  leadRecords.forEach((record) => {
    const civ = parseBiqReferenceIndex(getBiqRecordFieldValue(record, 'civ'), -3);
    if (civ >= 0) fixedLeadCivs.add(civ);
    const human = parseConfigBool(getBiqRecordFieldValue(record, 'humanplayer'));
    if (human && (civ === -3 || civ === -2)) hasHumanWildcard = true;
  });
  if (hasHumanWildcard) return;

  const unsupported = playableIds.filter((idx) => !fixedLeadCivs.has(idx));
  if (unsupported.length <= 0) return;
  const firstNames = unsupported.slice(0, 6).map(civName).join(', ');
  const fixedNames = Array.from(fixedLeadCivs).sort((a, b) => a - b).map(civName).join(', ');
  addGeneralIssue(
    result,
    'players',
    `Playable Civilizations includes ${unsupported.length} civ(s) without fixed Scenario Player slots (${firstNames}). Civ3 can freeze while configuring AI players if one is chosen. Restrict Playable Civilizations to ${fixedNames || 'the fixed Scenario Player civs'}, add fixed player slots, or make a Human Player slot Any/Random.`,
    'playable-civ-without-lead-slot'
  );
}

function auditMusic(bundle, result) {
  const tab = bundle && bundle.tabs && bundle.tabs.music ? bundle.tabs.music : null;
  if (!tab || String(tab.layout || '').trim().toLowerCase() !== 'playlist') return;
  const tracks = ((((tab.assignments || {}).playlist || {}).all) || []);
  tracks.forEach((track, index) => {
    const title = String(track && (track.title || track.fileName || track.relativePath) || `Track ${index + 1}`).trim();
    const pendingSourcePath = String(track && track.pendingSourcePath || '').trim();
    if (pendingSourcePath && !fileExists(pendingSourcePath)) {
      addGeneralIssue(result, 'music', `${title} is staged for import, but the source MP3 file no longer exists.`, 'music-import-source-missing');
      return;
    }
    const playablePath = String(track && (track.playablePath || track.sourcePath) || '').trim();
    if (track && track.missing && !playablePath) {
      addGeneralIssue(result, 'music', `${title} is listed in Music.txt, but the MP3 could not be found.`, 'music-file-missing');
    }
    const rawBitrateKbps = track && track.bitrateKbps;
    const rawSampleRateHz = track && track.sampleRateHz;
    const bitrateKbps = rawBitrateKbps !== null && rawBitrateKbps !== undefined && rawBitrateKbps !== '' ? Number(rawBitrateKbps) : NaN;
    const sampleRateHz = rawSampleRateHz !== null && rawSampleRateHz !== undefined && rawSampleRateHz !== '' ? Number(rawSampleRateHz) : NaN;
    const channelMode = String(track && track.channelMode || '').trim().toLowerCase();
    const compatibilityNotes = [];
    if (Number.isFinite(bitrateKbps) && bitrateKbps !== 128) compatibilityNotes.push(`${bitrateKbps} kbps`);
    if (Number.isFinite(sampleRateHz) && sampleRateHz !== 44100) compatibilityNotes.push(`${sampleRateHz / 1000} kHz`);
    if (channelMode && channelMode !== 'stereo') compatibilityNotes.push(channelMode);
    if (compatibilityNotes.length > 0) {
      addGeneralIssue(
        result,
        'music',
        `${title} is ${compatibilityNotes.join(', ')}. Civ3 custom build music is safest as 128 kbps CBR, 44.1 kHz, stereo MP3; other encodings can freeze Civ3 when a scenario starts.`,
        'music-mp3-compatibility'
      );
    }
  });
}

function auditLoadedBundle(bundle, options = {}) {
  const result = createAuditAccumulator();
  const skipReferenceArt = !!(options && options.skipReferenceArt);
  if (!bundle || !bundle.tabs) return result;
  lintBaseConfig(bundle, result);
  auditBaseReferenceCompatibility(bundle, result);
  lintSectionedTab(bundle, result, 'districts');
  lintSectionedTab(bundle, result, 'wonders');
  lintSectionedTab(bundle, result, 'naturalWonders');
  auditCompatibility(bundle, result);
  auditCurrentDistrictArt(bundle, result);
  auditCurrentWonderArt(bundle, result);
  auditCurrentNaturalWonderArt(bundle, result);
  auditDayNightAssets(bundle, result);
  auditBiqReferenceIndexIntegrity(bundle, result);
  auditTechnologyPrerequisiteCycles(bundle, result);
  if (!skipReferenceArt) auditReferenceArt(bundle, result);
  auditUnitRuntimeAssets(bundle, result);
  auditScenarioTextCoverage(bundle, result);
  auditScenarioTextHealth(bundle, result);
  auditCivilopediaLinks(bundle, result);
  auditScenarioPlayableCivilizationSlots(bundle, result);
  auditMusic(bundle, result);
  return result;
}

function auditBundle(payload) {
  const bundle = payload && payload.bundleSnapshot && typeof payload.bundleSnapshot === 'object'
    ? payload.bundleSnapshot
    : loadBundle({ ...(payload || {}), deferMapTab: false });
  const options = payload && payload.auditOptions && typeof payload.auditOptions === 'object'
    ? payload.auditOptions
    : {};
  return auditLoadedBundle(bundle, options);
}

module.exports = {
  auditBundle,
  auditLoadedBundle
};
