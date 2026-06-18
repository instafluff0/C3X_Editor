const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');
const { resolveConquestsAssetPath, resolveUnitIniPath, decodePcx, encodePcx, encodeRgbaToPcx, encodeRgbaToLeaderFlc } = require('./artPreview');
const log = require('./log');
const techBoxLayout = require('./techBoxLayout');
const scienceAdvisorArrows = require('./scienceAdvisorArrows');
const { decompress: biqDecompress } = require('./biq/decompress');
const { parseBiqBuffer: jsParseBiqBuffer, applyBiqEdits: jsApplyBiqEdits } = require('./biq/biqBridgeJs');
const { projectImprovementBiqFields, collapseImprovementBiqFields } = require('./biq/bldgCodec');
const { projectCivilizationBiqFields, collapseCivilizationBiqFields } = require('./biq/civCodec');
const { projectResourceBiqFields, collapseResourceBiqFields } = require('./biq/goodCodec');
const { projectGovernmentBiqFields, collapseGovernmentBiqFields } = require('./biq/govtCodec');
const { projectTechnologyBiqFields, collapseTechnologyBiqFields } = require('./biq/techCodec');
const { projectUnitBiqFields, collapseUnitBiqFields } = require('./biq/unitCodec');
const { parseAllSections } = require('./biq/biqSections');
const C3X_BASE_MANIFEST = require('./c3xBaseManifest');

const RESOURCE_ATLAS_RELATIVE_PATH = 'Art/resources.pcx';
const RESOURCE_ATLAS_COLS = 6;
const RESOURCE_ATLAS_CELL_SIZE = 50;
const RESOURCE_ATLAS_MAGENTA = { r: 255, g: 0, b: 255 };
const UNIT_ATLAS_RELATIVE_PATH = 'Art/Units/units_32.pcx';
const UNIT_ATLAS_SPRITE_SIZE = 32;
const UNIT_ATLAS_GUTTER = 1;
const UNIT_ATLAS_MAGENTA = RESOURCE_ATLAS_MAGENTA;
const BUILDING_CITY_ATLAS_RELATIVE_PATHS = {
  large: 'Art/city screen/buildings-large.pcx',
  small: 'Art/city screen/buildings-small.pcx'
};
const BUILDING_CITY_ATLAS_ORIGIN = 32;
const BUILDING_CITY_ATLAS_GUIDE = { r: 0, g: 255, b: 0 };
const BUILDING_CITY_ATLAS_MAGENTA = RESOURCE_ATLAS_MAGENTA;
const BUILDING_CITY_ATLAS_GEOMETRY = {
  large: { cellW: 51, cellH: 41, drawW: 50, drawH: 40 },
  small: { cellW: 33, cellH: 33, drawW: 32, drawH: 32 }
};
const SCIENCE_ADVISOR_BACKGROUND_RELATIVE_PATHS = [
  ['Art/Advisors/science_ancient.pcx'],
  ['Art/Advisors/science_middle.pcx', 'Art/Advisors/science_middle_ages.pcx'],
  ['Art/Advisors/science_industrial_new.pcx', 'Art/Advisors/science_industrial.pcx'],
  ['Art/Advisors/science_modern.pcx']
];
const SCIENCE_ADVISOR_TECHBOX_RELATIVE_PATH = 'Art/Advisors/techboxes.pcx';
const SCIENCE_ADVISOR_ARROW_METADATA_RELATIVE_PATH = 'c3x_editor_tech_tree_arrows.json';
const SCIENCE_ADVISOR_ARROW_METADATA_FORMAT = 'c3x-editor-tech-tree-arrows';
const SCIENCE_ADVISOR_FALLBACK_TECHBOX_FRAMES = [
  { w: 84, h: 54 },
  { w: 140, h: 54 },
  { w: 140, h: 85 },
  { w: 170, h: 54 }
];

const FILE_SPECS = {
  base: {
    defaultName: 'default.c3x_config.ini',
    userName: 'custom.c3x_config.ini',
    scenarioName: 'scenario.c3x_config.ini',
    sectionMarker: null,
    title: 'C3X'
  },
  districts: {
    defaultName: 'default.districts_config.txt',
    userName: 'user.districts_config.txt',
    scenarioName: 'scenario.districts_config.txt',
    sectionMarker: '#District',
    title: 'Districts'
  },
  wonders: {
    defaultName: 'default.districts_wonders_config.txt',
    userName: 'user.districts_wonders_config.txt',
    scenarioName: 'scenario.districts_wonders_config.txt',
    sectionMarker: '#Wonder',
    title: 'Wonder Districts'
  },
  naturalWonders: {
    defaultName: 'default.districts_natural_wonders_config.txt',
    userName: 'user.districts_natural_wonders_config.txt',
    scenarioName: 'scenario.districts_natural_wonders_config.txt',
    sectionMarker: '#Wonder',
    title: 'Natural Wonders'
  },
  animations: {
    defaultName: 'default.tile_animations.txt',
    userName: 'user.tile_animations.txt',
    scenarioName: 'scenario.tile_animations.txt',
    sectionMarker: '#Animation',
    title: 'Tile Animations',
    createScenarioOptional: true
  }
};

const REFERENCE_TAB_SPECS = [
  { key: 'civilizations', title: 'Civs', prefix: 'RACE_' },
  { key: 'technologies', title: 'Techs', prefix: 'TECH_' },
  { key: 'resources', title: 'Resources', prefix: 'GOOD_' },
  { key: 'improvements', title: 'Improvements', prefix: 'BLDG_' },
  { key: 'governments', title: 'Governments', prefix: 'GOVT_' },
  { key: 'units', title: 'Units', prefix: 'PRTO_' },
  { key: 'gameConcepts', title: 'Game Concepts', prefix: 'GCON_' },
  { key: 'terrainPedia', title: 'Terrain', prefix: 'TERR_' },
  { key: 'workerActions', title: 'Worker Actions', prefix: 'TFRM_' }
];

const DEFAULT_TEXT_FILE_ENCODING = 'auto';
const TEXT_FILE_ENCODING_OPTIONS = [
  'auto',
  'utf8',
  'windows-1252',
  'windows-1251',
  'gbk',
  'big5',
  'shift_jis',
  'euc-kr'
];

const TEXT_FILE_ENCODING_ALIASES = {
  auto: 'auto',
  utf8: 'utf8',
  'utf-8': 'utf8',
  utf_8: 'utf8',
  'windows-1252': 'windows-1252',
  cp1252: 'windows-1252',
  win1252: 'windows-1252',
  ansi: 'windows-1252',
  latin1: 'windows-1252',
  'windows-1251': 'windows-1251',
  cp1251: 'windows-1251',
  win1251: 'windows-1251',
  gbk: 'gbk',
  cp936: 'gbk',
  gb2312: 'gbk',
  big5: 'big5',
  cp950: 'big5',
  big5hkscs: 'big5',
  shift_jis: 'shift_jis',
  'shift-jis': 'shift_jis',
  sjis: 'shift_jis',
  cp932: 'shift_jis',
  euc_kr: 'euc-kr',
  'euc-kr': 'euc-kr',
  cp949: 'euc-kr'
};

const BIQ_STRUCTURE_TAB_SPECS = [
  { key: 'scenarioSettings', title: 'Scenario', sectionCodes: ['GAME'] },
  { key: 'players', title: 'Players', sectionCodes: ['LEAD'] },
  { key: 'terrain', title: 'Terrain', sectionCodes: ['TERR', 'TFRM'] },
  { key: 'world', title: 'World', sectionCodes: ['WSIZ', 'WCHR', 'ERAS'] },
  { key: 'rules', title: 'Rules', sectionCodes: ['RULE', 'DIFF', 'ESPN', 'CTZN', 'CULT', 'EXPR', 'FLAV'] }
];

const BIQ_SECTION_DEFS = [
  { code: 'BLDG', title: 'Buildings', mode: 'len' },
  { code: 'CTZN', title: 'Citizens', mode: 'len' },
  { code: 'CULT', title: 'Culture', mode: 'len' },
  { code: 'DIFF', title: 'Difficulties', mode: 'len' },
  { code: 'ERAS', title: 'Eras', mode: 'len' },
  { code: 'ESPN', title: 'Espionage', mode: 'len' },
  { code: 'EXPR', title: 'Experience', mode: 'len' },
  { code: 'GOOD', title: 'Resources', mode: 'len' },
  { code: 'GOVT', title: 'Governments', mode: 'len' },
  { code: 'RULE', title: 'Rules', mode: 'len' },
  { code: 'PRTO', title: 'Units', mode: 'len' },
  { code: 'RACE', title: 'Civilizations', mode: 'len' },
  { code: 'TECH', title: 'Technologies', mode: 'len' },
  { code: 'TFRM', title: 'Worker Jobs', mode: 'len' },
  { code: 'TERR', title: 'Terrain', mode: 'len' },
  { code: 'WSIZ', title: 'World Sizes', mode: 'len' },
  { code: 'FLAV', title: 'Flavors', mode: 'len', optional: true },
  { code: 'WCHR', title: 'World Characteristics', mode: 'len', optional: true },
  { code: 'WMAP', title: 'World Map', mode: 'len', optional: true },
  { code: 'TILE', title: 'Tiles', mode: 'fixed', fixedByVersion: true, optional: true },
  { code: 'CONT', title: 'Continents', mode: 'fixed', fixedSize: 12, optional: true },
  { code: 'SLOC', title: 'Starting Locations', mode: 'fixed', fixedSize: 20, optional: true },
  { code: 'CITY', title: 'Cities', mode: 'len', optional: true },
  { code: 'UNIT', title: 'Map Units', mode: 'len', optional: true },
  { code: 'CLNY', title: 'Colonies', mode: 'len', optional: true },
  { code: 'GAME', title: 'Scenario Properties', mode: 'len' },
  { code: 'LEAD', title: 'Players', mode: 'len', optional: true }
];
const MAX_BIQ_RECORDS_PER_SECTION = 400;
let activeReadCollector = null;

function getBiqBridgeRecordLimit(sectionCode) {
  const code = String(sectionCode || '').toUpperCase();
  if (code === 'CITY' || code === 'UNIT' || code === 'CLNY') return 8000;
  return Number.POSITIVE_INFINITY;
}

function readUInt32LESafe(buf, offset) {
  if (offset < 0 || offset + 4 > buf.length) return null;
  return buf.readUInt32LE(offset);
}

function toBiqString(buf, start, end, encoding = 'windows-1252') {
  const out = decodeTextBuffer(buf.subarray(start, end), resolveAutoTextEncoding(encoding));
  const nullPos = out.indexOf('\0');
  return (nullPos >= 0 ? out.slice(0, nullPos) : out).trim();
}

function readBiqTag(buf, offset) {
  if (offset < 0 || offset + 4 > buf.length) return '';
  return buf.subarray(offset, offset + 4).toString('latin1');
}

function inflateBiqIfNeeded(filePath, civ3Path) {
  if (!filePath || !fs.existsSync(filePath)) {
    log.warn('inflateBiq', `File not found: ${log.rel(filePath)}`);
    return { ok: false, error: `BIQ file not found: ${filePath || '(empty path)'}` };
  }
  const raw = fs.readFileSync(filePath);
  const magic = raw.subarray(0, 4).toString('latin1');
  log.debug('inflateBiq', `${log.rel(filePath)} — size=${raw.length} bytes, magic="${magic.replace(/[^\x20-\x7e]/g, '?')}"`);
  if (magic.startsWith('BIC')) {
    log.debug('inflateBiq', 'Already decompressed (BIC magic), using as-is.');
    return { ok: true, buffer: raw, compressed: false, decompressorPath: '' };
  }

  log.debug('inflateBiq', 'Compressed BIQ — running JS decompressor...');
  const jsResult = biqDecompress(raw);
  if (jsResult.ok) {
    log.debug('inflateBiq', `JS decompression OK — decompressed size=${jsResult.data && jsResult.data.length} bytes`);
    return { ok: true, buffer: jsResult.data, compressed: true, decompressorPath: 'js' };
  }
  log.error('inflateBiq', `JS decompression failed: ${jsResult.error}`);
  return { ok: false, error: `BIQ decompression failed: ${jsResult.error}` };
}

function normalizeBiqFieldKey(rawKey) {
  return String(rawKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function canonicalFieldKey(raw) {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toExpectedSetterFromBaseKey(baseKey) {
  const parts = String(baseKey || '').split(/_+/).filter(Boolean);
  if (parts.length === 0) return '';
  return `set${parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}`;
}

function cleanDisplayText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f]+/g, '')
    .trim();
}

function parseIntLoose(value, fallback = NaN) {
  const text = String(value == null ? '' : value).trim();
  const lower = text.toLowerCase();
  if (lower === 'false') return 0;
  if (lower === 'true') return 1;
  const referenceMatch = text.match(/\((-?\d+)\)\s*$/);
  if (referenceMatch) return Number.parseInt(referenceMatch[1], 10);
  const match = text.match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scoreHumanReadableText(text) {
  const s = String(text || '');
  if (!s) return 0;
  let letters = 0;
  let digits = 0;
  let spaces = 0;
  let punctuation = 0;
  let weird = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) || 0;
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp > 159) letters += 1;
    else if (cp >= 48 && cp <= 57) digits += 1;
    else if (cp === 32 || cp === 9) spaces += 1;
    else if (',.;:!?()[]{}\'"\\/+-_%&'.includes(ch)) punctuation += 1;
    else weird += 1;
  }
  return (letters * 2) + digits + spaces + punctuation - (weird * 3);
}

function maybeNormalizeMojibake(text) {
  const raw = cleanDisplayText(text);
  if (!raw) return raw;
  let best = raw;
  let bestScore = scoreHumanReadableText(raw);
  try {
    const latinAsUtf8 = Buffer.from(raw, 'latin1').toString('utf8').trim();
    if (latinAsUtf8) {
      const s = scoreHumanReadableText(latinAsUtf8);
      if (s > bestScore + 2) {
        best = latinAsUtf8;
        bestScore = s;
      }
    }
  } catch (_err) {
    // ignore conversion failures
  }
  const highChars = Array.from(best).filter((ch) => (ch.codePointAt(0) || 0) > 159).length;
  if (best.length >= 7 && highChars / Math.max(1, best.length) > 0.45 && bestScore < (best.length * 0.9)) {
    return '(unreadable text)';
  }
  return best;
}

function cleanRecordName(value, fallback = '') {
  const raw = String(value == null ? '' : value);
  const truncated = raw.includes('\0') ? raw.slice(0, raw.indexOf('\0')) : raw;
  const cleaned = maybeNormalizeMojibake(truncated);
  return cleaned || fallback;
}

function toTitleFromKey(key) {
  const words = String(key || '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function friendlyFieldValue(sectionCode, key, value) {
  const v = cleanDisplayText(value);
  if (sectionCode === 'GOVT' && key === 'corruption') {
    const map = {
      '0': 'Minimal',
      '1': 'Nuisance',
      '2': 'Problematic',
      '3': 'Rampant',
      '4': 'Communal'
    };
    return map[v] ? `${map[v]} (${v})` : v;
  }
  if (sectionCode === 'GOVT' && key === 'hurrying') {
    const map = {
      '0': 'Impossible',
      '1': 'Forced Labor',
      '2': 'Paid Labor'
    };
    return map[v] ? `${map[v]} (${v})` : v;
  }
  return value;
}

function parseEnglishFields(sectionCode, englishText) {
  const fields = [];
  const keyCounts = {};
  const lines = String(englishText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) {
      fields.push({ key: 'note', baseKey: 'note', label: 'Note', value: line, editable: false });
      continue;
    }
    const rawKey = line.slice(0, colon).trim();
    const baseKey = normalizeBiqFieldKey(rawKey) || 'field';
    keyCounts[baseKey] = (keyCounts[baseKey] || 0) + 1;
    const key = keyCounts[baseKey] > 1 ? `${baseKey}_${keyCounts[baseKey]}` : baseKey;
    const rawValue = maybeNormalizeMojibake(line.slice(colon + 1));
    const value = friendlyFieldValue(sectionCode, baseKey, rawValue);
    fields.push({ key, baseKey, label: toTitleFromKey(rawKey), value: cleanDisplayText(value), editable: false });
  }
  return fields;
}

function parseIntMaybe(value) {
  const s = cleanDisplayText(value);
  if (!/^[-+]?\d+$/.test(s)) return null;
  return Number.parseInt(s, 10);
}

function getRecordNameByIndex(indexMap, idxValue) {
  const idx = parseIntMaybe(idxValue);
  if (idx == null || idx < 0) return '';
  return indexMap[idx] || '';
}

function maybeFormatIdReference(indexMap, value, noneLabel = 'None') {
  const idx = parseIntMaybe(value);
  if (idx == null) return cleanDisplayText(value);
  if (idx < 0) return noneLabel;
  const name = indexMap[idx];
  return name ? `${name} (${idx})` : String(idx);
}

function formatLeadCivilizationReference(indexMap, value) {
  const idx = parseIntMaybe(value);
  if (idx == null) return cleanDisplayText(value);
  if (idx === -3) return 'Any (-3)';
  if (idx === -2) return 'Random (-2)';
  return maybeFormatIdReference(indexMap, idx);
}

function toBoolStringFromInt(value) {
  const n = parseIntMaybe(value);
  if (n == null) return cleanDisplayText(value);
  return n === 0 ? 'false' : 'true';
}

function normalizeBoolish(value) {
  const s = cleanDisplayText(value).toLowerCase();
  if (s === 'true' || s === 'false') return s;
  return toBoolStringFromInt(value);
}

function maybeFormatIdReferenceOneBased(indexMap, value, noneLabel = 'None') {
  const idx = parseIntMaybe(value);
  if (idx == null) return cleanDisplayText(value);
  if (idx <= 0) return noneLabel;
  const name = indexMap[idx - 1];
  return name ? `${name} (${idx})` : String(idx);
}

function toMonthName(value) {
  const n = parseIntMaybe(value);
  if (n == null || n < 1 || n > 12) return cleanDisplayText(value);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];
  return `${months[n - 1]} (${n})`;
}

function applyFieldLabelOverrides(sectionCode, field) {
  const key = String(field.key || '').toLowerCase();
  const overrides = {
    GOOD: {
      appearanceratio: 'Appearance Ratio',
      disapperanceprobability: 'Disappearance Probability',
      foodbonus: 'Food Bonus',
      shieldsbonus: 'Shields Bonus',
      commercebonus: 'Commerce Bonus',
      type: 'Type',
      prerequisite: 'Required Technology',
      icon: 'Civilopedia Icon Index'
    },
    TFRM: {
      turnstocomplete: 'Turns To Complete',
      requiredadvance: 'Required Technology',
      requiredresource1: 'Required Resource 1',
      requiredresource2: 'Required Resource 2',
      order: 'Worker Order'
    },
    CTZN: {
      defaultcitizen: 'Default Citizen',
      prerequisite: 'Required Technology',
      pluralname: 'Plural Name',
      luxuries: 'Luxury Output',
      research: 'Research Output',
      taxes: 'Tax Output',
      corruption: 'Corruption Output',
      construction: 'Construction Output'
    },
    RULE: {
      townname: 'Level One',
      cityname: 'Level Two',
      metropolisname: 'Level Three',
      numspaceshipparts: 'Number of Parts',
      advancedbarbarian: 'Adv. Barbarian',
      basicbarbarian: 'Basic Barbarian',
      barbarianseaunit: 'Barbarian Ship',
      citiesforarmy: 'Cities Needed to Support an Army',
      chanceofrioting: 'Chance of Rioting with Unhappiness',
      draftturnpenalty: 'Turn Penalty for Each Drafted Citizen',
      shieldcostingold: 'Shield Cost in Gold',
      fortressdefencebonus: 'Fortress',
      citizensaffectedbyhappyface: 'Citizens affected by each Happy Face',
      forestvalueinshields: 'Forest Value in Shields',
      shieldvalueingold: 'Shield Value in Gold',
      citizenvalueinshields: 'Citizen Value in Shields',
      battlecreatedunit: 'Battle-Created',
      buildarmyunit: 'Build-Army',
      buildingdefensivebonus: 'Building',
      citizendefensivebonus: 'Citizen',
      defaultmoneyresource: 'Default Money Resource',
      chancetointerceptairmissions: 'Chance of Intercepting Air Missions',
      chancetointerceptstealthmissions: 'Chance of Intercepting Stealth Missions',
      startingtreasury: 'Starting Treasury',
      questionmark1: 'Unknown 1',
      questionmark2: 'Unknown 2',
      questionmark3: 'Unknown 3',
      questionmark4: 'Unknown 4',
      foodconsumptionpercitizen: 'Food Consumption Per Citizen',
      riverdefensivebonus: 'River',
      turnpenaltyforwhip: 'Turn Penalty for Each Hurry Sacrifice',
      scout: 'Scout',
      slave: 'Captured Unit',
      roadmovementrate: 'Road movement rate',
      startunit1: 'Start Unit 1',
      startunit2: 'Start Unit 2',
      wltkdminimumpop: 'Minimum Population for We Love the King',
      towndefencebonus: 'Town',
      citydefencebonus: 'City',
      metropolisdefencebonus: 'Metropolis',
      maxcity1size: 'Maximum Size',
      maxcity2size: 'Maximum Size',
      fortificationsdefencebonus: 'Fortification',
      numculturallevels: 'Number Of Cultural Levels',
      borderexpansionmultiplier: 'Border Expansion Multiplier',
      borderfactor: 'Border Factor',
      futuretechcost: 'Future Tech Cost',
      goldenageduration: 'Golden Age Duration',
      maximumresearchtime: 'Maximum Research Time',
      minimumresearchtime: 'Minimum Research Time',
      flagunit: 'Flag Unit',
      upgradecost: 'Upgrade Cost',
      defaultdifficultylevel: 'Default AI Difficulty'
    },
    BLDG: {
      gainineverycity: 'Gain In Every City',
      gainoncontinent: 'Gain On Continent',
      reqimprovement: 'Required Improvement',
      reqgovernment: 'Required Government',
      reqadvance: 'Required Technology',
      obsoleteby: 'Obsolete By',
      reqresource1: 'Required Resource 1',
      reqresource2: 'Required Resource 2',
      spaceshippart: 'Spaceship Part',
      unitproduced: 'Unit Produced',
      unitfrequency: 'Unit Production Frequency'
    },
    PRTO: {
      requiredtech: 'Required Technology',
      upgradeto: 'Upgrade To',
      requiredresource1: 'Required Resource 1',
      requiredresource2: 'Required Resource 2',
      requiredresource3: 'Required Resource 3',
      enslaveresultsin: 'Enslave Results In',
      enslaveresultsinto: 'Enslave Results Into',
      requiressupport: 'Requires Support',
      bombardeffects: 'Bombard Effects',
      createscraters: 'Creates Craters',
      hitpointbonus: 'Hit Point Bonus',
      zoneofcontrol: 'Zone Of Control',
      iconindex: 'Civilopedia Icon Index',
      unitclass: 'Unit Class'
    },
    RACE: {
      culturegroup: 'Culture Group',
      defaultcolor: 'Default Color',
      diplomacytextindex: 'Diplomacy Dialogue Slot',
      freetech1index: 'Free Tech 1',
      freetech2index: 'Free Tech 2',
      freetech3index: 'Free Tech 3',
      freetech4index: 'Free Tech 4',
      favoritegovernment: 'Favorite Government',
      shunnedgovernment: 'Shunned Government',
      kingunit: 'King Unit',
      leadername: 'Leader Name',
      leadertitle: 'Leader Title'
    },
    TECH: {
      prerequisite1: 'Prerequisite 1',
      prerequisite2: 'Prerequisite 2',
      prerequisite3: 'Prerequisite 3',
      prerequisite4: 'Prerequisite 4',
      advanceicon: 'Advance Icon Index'
    },
    TERR: {
      numpossibleresources: 'Number Of Possible Resources',
      foodbonus: 'Food Bonus',
      shieldsbonus: 'Shields Bonus',
      commercebonus: 'Commerce Bonus',
      defencebonus: 'Defense Bonus (%)',
      movementcost: 'Movement Cost',
      workerjob: 'Related Worker Job',
      pollutioneffect: 'Pollution Effect',
      allowcities: 'Allow Cities',
      allowcolonies: 'Allow Colonies',
      impassable: 'Impassable',
      impassablebywheeled: 'Impassable By Wheeled Units',
      allowairfields: 'Allow Airfields',
      allowforts: 'Allow Forts',
      allowoutposts: 'Allow Outposts',
      allowradartowers: 'Allow Radar Towers',
      landmarkenabled: 'Landmark Enabled',
      landmarkfood: 'Landmark Food',
      landmarkshields: 'Landmark Shields',
      landmarkcommerce: 'Landmark Commerce',
      landmarkfoodbonus: 'Landmark Food Bonus',
      landmarkshieldsbonus: 'Landmark Shields Bonus',
      landmarkcommercebonus: 'Landmark Commerce Bonus',
      landmarkmovementcost: 'Landmark Movement Cost',
      landmarkdefencebonus: 'Landmark Defense Bonus (%)',
      landmarkname: 'Landmark Name',
      landmarkcivilopediaentry: 'Landmark Civilopedia Entry',
      terrainflags: 'Terrain Flags',
      diseasestrength: 'Disease Strength'
    },
    WSIZ: {
      optimalnumberofcities: 'Optimal Number Of Cities',
      techrate: 'Tech Rate (%)',
      distancebetweencivs: 'Distance Between Civilizations',
      numberofcivs: 'Number Of Civilizations',
      width: 'Map Width',
      height: 'Map Height'
    },
    ERAS: {
      usedresearchernames: 'Used Researcher Names',
      researcher1: 'Researcher Name 1',
      researcher2: 'Researcher Name 2',
      researcher3: 'Researcher Name 3',
      researcher4: 'Researcher Name 4',
      researcher5: 'Researcher Name 5'
    },
    DIFF: {
      contentcitizens: 'Content Citizens',
      maxgovttransition: 'Max Government Transition Turns',
      aidefencestart: 'AI Defense Units At Start',
      aioffencestart: 'AI Offense Units At Start',
      extrastart1: 'Extra Start Unit 1',
      extrastart2: 'Extra Start Unit 2',
      additionalfreesupport: 'Additional Free Unit Support',
      bonuspercity: 'Bonus Per City',
      attackbarbariansbonus: 'Attack Barbarians Bonus (%)',
      costfactor: 'Cost Factor',
      percentoptimal: 'Optimal City Number Percent',
      aiaitrade: 'AI-AI Trade Rate (%)',
      corruptionpercent: 'Corruption Percent',
      militarylaw: 'Military Law Units'
    },
    ESPN: {
      missionperformedby: 'Mission Performed By',
      basecost: 'Base Cost'
    },
    EXPR: {
      basehitpoints: 'Base Hit Points',
      retreatbonus: 'Retreat Bonus (%)'
    },
    FLAV: {
      numberofflavors: 'Number Of Flavors'
    },
    CULT: {
      initresistancechance: 'Initial Resistance Chance (%)',
      continuedresistancechance: 'Continued Resistance Chance (%)',
      propagandasuccess: 'Propaganda Success (%)',
      rationumerator: 'Culture Ratio Numerator',
      ratiodenominator: 'Culture Ratio Denominator',
      cultratiopercent: 'Culture Ratio Percent'
    },
    GOVT: {
      defaulttype: 'Default Type',
      numberofgovernments: 'Number Of Governments',
      rulertitlepairsused: 'Ruler Title Pairs Used',
      malerulertitle1: 'Male Ruler Title 1',
      malerulertitle2: 'Male Ruler Title 2',
      malerulertitle3: 'Male Ruler Title 3',
      malerulertitle4: 'Male Ruler Title 4',
      femalerulertitle1: 'Female Ruler Title 1',
      femalerulertitle2: 'Female Ruler Title 2',
      femalerulertitle3: 'Female Ruler Title 3',
      femalerulertitle4: 'Female Ruler Title 4',
      freeunitspertown: 'Free Units Per Town',
      freeunitspercity: 'Free Units Per City',
      freeunitspermetropolis: 'Free Units Per Metropolis',
      costperunit: 'Unit Cost Over Free Limit',
      militarypolicelimit: 'Military Police Limit',
      draftlimit: 'Draft Limit',
      transitiontype: 'Transition Type',
      resistancemodifier: 'Resistance Modifier',
      briberymodifier: 'Bribery Modifier',
      assimilationchance: 'Assimilation Chance (%)',
      warweariness: 'War Weariness',
      commercebonus: 'Commerce Bonus (%)',
      tilepenalty: 'Tile Penalty',
      sciencecap: 'Science Cap (%)',
      workerrate: 'Worker Rate',
      canbribe: 'Can Bribe',
      requiresmaintenance: 'Requires Maintenance',
      forceresettlement: 'Force Resettlement',
      xenophobic: 'Xenophobic'
    },
    GAME: {
      usedefaultrules: 'Use Default Rules',
      defaultvictoryconditions: 'Default Victory Conditions',
      numberofplayablecivs: 'Number Of Playable Civilizations',
      advancementvp: 'Advancement Victory Points',
      defeatingopposingunitvp: 'Defeating Unit Victory Points',
      cityconquestvp: 'City Conquest Victory Points',
      victorypointvp: 'Victory Point Victory Points',
      capturespecialunitvp: 'Capture Special Unit Victory Points',
      victorypointlimit: 'Victory Point Limit',
      cityeliminationcount: 'City Elimination Count',
      onecityculturewinlimit: 'One-City Culture Win Limit',
      allcitiesculturewinlimit: 'All-Cities Culture Win Limit',
      dominationterrainpercent: 'Domination Terrain Percent',
      dominationpopulationpercent: 'Domination Population Percent',
      wondervp: 'Wonder Victory Points',
      usetimelimit: 'Use Time Limit',
      basetimeunit: 'Base Time Unit',
      startmonth: 'Start Month',
      startweek: 'Start Week',
      startyear: 'Start Year',
      minutetimelimit: 'Minute Time Limit',
      turntimelimit: 'Turn Time Limit',
      scenariosearchfolders: 'Scenario Search Folder',
      alliancevictorytype: 'Alliance Victory Type',
      plaugename: 'Plague Name',
      permitplagues: 'Permit Plagues',
      plagueearlieststart: 'Plague Earliest Start',
      plaguevariation: 'Plague Variation',
      plagueduration: 'Plague Duration',
      plaguestrength: 'Plague Strength',
      plaguegraceperiod: 'Plague Grace Period',
      plaguemaxoccurance: 'Plague Max Occurrence',
      respawnflagunits: 'Respawn Flag Units',
      captureanyflag: 'Capture Any Flag',
      goldforcapture: 'Gold For Capture',
      mapvisible: 'Map Visible',
      retainculture: 'Retain Culture',
      eruptionperiod: 'Eruption Period',
      mpbasetime: 'Multiplayer Base Time',
      mpcitytime: 'Multiplayer City Time',
      mpunittime: 'Multiplayer Unit Time'
    },
    LEAD: {
      civ: 'Civilization',
      leadername: 'Leader Name',
      genderofleadername: 'Leader Name Gender',
      government: 'Government',
      color: 'Color Index',
      initialera: 'Initial Era',
      startcash: 'Start Cash',
      humanplayer: 'Human Player',
      customcivdata: 'Custom Civilization Data',
      startembassies: 'Start Embassies',
      skipfirstturn: 'Skip First Turn',
      numberofdifferentstartunits: 'Number Of Different Start Units',
      numberofstartingtechnologies: 'Number Of Starting Technologies'
    },
    WCHR: {
      worldsize: 'World Size',
      selectedlandform: 'Selected Landform',
      selectedtemperature: 'Selected Temperature',
      selectedclimate: 'Selected Climate',
      selectedage: 'Selected Age',
      selectedbarbarianactivity: 'Selected Barbarian Activity',
      selectedoceancoverage: 'Selected Ocean Coverage',
      actuallandform: 'Actual Landform',
      actualtemperature: 'Actual Temperature',
      actualclimate: 'Actual Climate',
      actualage: 'Actual Age',
      actualbarbarianactivity: 'Actual Barbarian Activity',
      actualoceancoverage: 'Actual Ocean Coverage'
    },
    WMAP: {
      mapseed: 'Map Seed',
      width: 'Map Width',
      height: 'Map Height',
      numcivs: 'Number Of Civilizations',
      numcontinents: 'Number Of Continents',
      numresources: 'Number Of Resources',
      distancebetweencivs: 'Distance Between Civilizations',
      xwrapping: 'X Wrapping',
      ywrapping: 'Y Wrapping',
      polar_ice_caps: 'Polar Ice Caps'
    },
    CITY: {
      owner: 'Owner',
      ownertype: 'Owner Type',
      citylevel: 'City Level',
      useautoname: 'Use Auto Name',
      haspalace: 'Has Palace',
      haswalls: 'Has Walls',
      numbuildings: 'Number Of Buildings',
      borderlevel: 'Border Level',
      culture: 'Culture'
    },
    UNIT: {
      unit_index: 'Unit',
      owner: 'Owner',
      ownertype: 'Owner Type',
      experiencelevel: 'Experience Level',
      aistrategy: 'AI Strategy',
      ptwcustomname: 'Custom Name',
      usecivilizationking: 'Use Civilization King'
    },
    CLNY: {
      owner: 'Owner',
      ownertype: 'Owner Type',
      improvementtype: 'Improvement Type'
    },
    TILE: {
      tileid: 'Tile Id',
      baserealterrain: 'Base Real Terrain',
      c3cbaserealterrain: 'C3C Base Real Terrain',
      bonuses: 'Bonuses',
      c3cbonuses: 'C3C Bonuses',
      overlays: 'Overlays',
      c3coverlays: 'C3C Overlays',
      riverconnectioninfo: 'River Connection Info',
      rivercrossingdata: 'River Crossing Data',
      resource: 'Resource',
      city: 'City',
      colony: 'Colony',
      continent: 'Continent',
      owner: 'Owner',
      border: 'Border',
      bordercolor: 'Border Color',
      fogofwar: 'Fog Of War',
      barbariantribe: 'Barbarian Tribe',
      victorypointlocation: 'Victory Point Location',
      unit_on_tile: 'Unit On Tile',
      ruin: 'Ruin'
    },
    CONT: {
      numtiles: 'Number Of Tiles',
      continentclass: 'Continent Class'
    }
  };
  if (overrides[sectionCode] && overrides[sectionCode][key]) {
    field.label = overrides[sectionCode][key];
  }
}

function enrichBridgeSections(sections) {
  const byCode = new Map();
  sections.forEach((s) => byCode.set(s.code, s));
  const makeIndex = (code) => {
    const section = byCode.get(code);
    const map = {};
    const records = Array.isArray(section && section.fullRecords) ? section.fullRecords : (section && section.records);
    if (!section || !Array.isArray(records)) return map;
    records.forEach((r, idx) => {
      map[idx] = cleanDisplayText(r.name || `${code} ${idx + 1}`);
    });
    return map;
  };

  const techIndex = makeIndex('TECH');
  const govIndex = makeIndex('GOVT');
  const unitIndex = makeIndex('PRTO');
  const bldgIndex = makeIndex('BLDG');
  const goodIndex = makeIndex('GOOD');
  const eraIndex = makeIndex('ERAS');
  const raceIndex = makeIndex('RACE');
  const leadIndex = makeIndex('LEAD');
  const wsizIndex = makeIndex('WSIZ');
  const cityIndex = makeIndex('CITY');
  const colonyIndex = makeIndex('CLNY');
  const contIndex = makeIndex('CONT');
  const diffIndex = makeIndex('DIFF');
  const tfrmIndex = makeIndex('TFRM');
  const terrIndex = makeIndex('TERR');
  const flavIndex = makeIndex('FLAV');
  const spaceshipPartByIndex = {};
  const bldgSection = byCode.get('BLDG');
  if (bldgSection && Array.isArray(bldgSection.records)) {
    bldgSection.records.forEach((record, idx) => {
      const partField = (record.fields || []).find((field) => {
        const k = String(field && (field.baseKey || field.key) || '').toLowerCase();
        const canon = k.replace(/[^a-z0-9]/g, '');
        return canon === 'spaceshippart';
      });
      if (!partField) return;
      const raw = cleanDisplayText(partField.value);
      const partIdx = Number.parseInt(String(raw || '').replace(/\s*\(.*\)\s*$/, ''), 10);
      if (!Number.isFinite(partIdx) || partIdx < 0) return;
      if (spaceshipPartByIndex[partIdx]) return;
      const name = cleanDisplayText(record.name || bldgIndex[idx] || `Spaceship Part ${partIdx + 1}`);
      spaceshipPartByIndex[partIdx] = name || `Spaceship Part ${partIdx + 1}`;
    });
  }

  const ownerTypeForRecord = (record) => {
    if (!record || !Array.isArray(record.fields)) return NaN;
    const field = record.fields.find((candidate) => {
      const key = String(candidate && (candidate.baseKey || candidate.key) || '').toLowerCase();
      return key === 'ownertype';
    });
    if (!field) return NaN;
    const raw = cleanDisplayText(field.originalValue);
    const rawParsed = parseIntLoose(raw, NaN);
    if (Number.isFinite(rawParsed)) return rawParsed;
    return parseIntLoose(cleanDisplayText(field.value), NaN);
  };

  const formatOwnerField = (record, rawValue) => {
    const ownerType = ownerTypeForRecord(record);
    if (ownerType === 2) return maybeFormatIdReference(raceIndex, rawValue);
    if (ownerType === 3) return maybeFormatIdReference(leadIndex, rawValue);
    return rawValue;
  };

  sections.forEach((section) => {
    const code = section.code;
    (section.records || []).forEach((record) => {
      const writableBaseKeySet = new Set(
        Array.isArray(record.writableBaseKeys)
          ? record.writableBaseKeys.map((k) => canonicalFieldKey(k))
          : []
      );
      (record.fields || []).forEach((field) => {
        const k = String(field.key || '').toLowerCase();
        const baseKey = String(field.baseKey || '').toLowerCase() || k.replace(/_\d+$/, '');
        field.baseKey = baseKey;
        field.expectedSetter = toExpectedSetterFromBaseKey(baseKey);
        field.editable = writableBaseKeySet.has(canonicalFieldKey(baseKey));
        if (isLockedBiqField(code, baseKey)) {
          field.editable = false;
        }
        const v = cleanDisplayText(field.value);

        // Batch 1: explicit cross-reference decoding for GOVT/TECH/PRTO/BLDG/RACE.
        if (code === 'GOVT') {
          if (k === 'prerequisitetechnology') field.value = maybeFormatIdReference(techIndex, v);
          else if (k === 'immuneto') field.value = maybeFormatIdReference(govIndex, v);
          else if (k === 'canbribe' || k === 'requiresmaintenance' || k === 'forceresettlement' || k === 'xenophobic') field.value = toBoolStringFromInt(v);
        } else if (code === 'TECH') {
          if (k === 'era') field.value = maybeFormatIdReference(eraIndex, v);
          else if (k.startsWith('prerequisite')) field.value = maybeFormatIdReference(techIndex, v);
        } else if (code === 'PRTO') {
          if (k === 'requiredtech') field.value = maybeFormatIdReference(techIndex, v);
          else if (k === 'upgradeto') field.value = maybeFormatIdReference(unitIndex, v);
          else if (k.startsWith('requiredresource')) field.value = maybeFormatIdReference(goodIndex, v);
          else if (k === 'enslaveresultsin' || k === 'enslaveresultsinto') field.value = maybeFormatIdReference(unitIndex, v);
          else if (k === 'unitclass') {
            const unitClassMap = { '0': 'Land (0)', '1': 'Sea (1)', '2': 'Air (2)' };
            field.value = unitClassMap[v] || v;
          } else if (k === 'requiressupport' || k === 'bombardeffects' || k === 'createscraters' || k === 'zoneofcontrol') {
            field.value = toBoolStringFromInt(v);
          }
        } else if (code === 'BLDG') {
          if (k === 'reqimprovement') field.value = maybeFormatIdReference(bldgIndex, v);
          else if (k === 'reqgovernment') field.value = maybeFormatIdReference(govIndex, v);
          else if (k === 'obsoleteby') field.value = maybeFormatIdReference(techIndex, v);
          else if (k.startsWith('reqresource')) field.value = maybeFormatIdReference(goodIndex, v);
          else if (k === 'reqadvance' && /^name\s*:/i.test(v)) field.value = cleanDisplayText(v.replace(/^name\s*:/i, ''));
          else if (k === 'unitproduced') field.value = maybeFormatIdReference(unitIndex, v);
        } else if (code === 'RACE') {
          if (k.startsWith('freetech')) field.value = maybeFormatIdReference(techIndex, v);
          else if (k === 'shunnedgovernment' || k === 'favoritegovernment') field.value = maybeFormatIdReference(govIndex, v);
          else if (k === 'kingunit') field.value = maybeFormatIdReference(unitIndex, v);
          else if (k === 'leadergender') field.value = v === '0' ? 'Male (0)' : v === '1' ? 'Female (1)' : v;
        } else if (code === 'GOOD') {
          if (k === 'type') {
            const typeMap = { '0': 'Bonus', '1': 'Luxury', '2': 'Strategic' };
            const mapped = typeMap[v];
            if (mapped) field.value = `${mapped} (${v})`;
          } else if (k === 'prerequisite') {
            field.value = maybeFormatIdReference(techIndex, v);
          }
        } else if (code === 'TFRM') {
          if (k === 'requiredadvance') field.value = maybeFormatIdReference(techIndex, v);
          else if (k === 'requiredresource1' || k === 'requiredresource2') field.value = maybeFormatIdReference(goodIndex, v);
        } else if (code === 'CTZN') {
          if (k === 'defaultcitizen') field.value = toBoolStringFromInt(v);
          else if (k === 'prerequisite') field.value = maybeFormatIdReference(techIndex, v);
        } else if (code === 'RULE') {
          if (
            k === 'advancedbarbarian' ||
            k === 'basicbarbarian' ||
            k === 'barbarianseaunit' ||
            k === 'battlecreatedunit' ||
            k === 'buildarmyunit' ||
            k === 'scout' ||
            k === 'slave' ||
            k === 'startunit1' ||
            k === 'startunit2' ||
            k === 'flagunit'
          ) {
            field.value = maybeFormatIdReference(unitIndex, v);
          } else if (k === 'defaultmoneyresource') {
            field.value = maybeFormatIdReference(goodIndex, v);
          } else if (k === 'defaultdifficultylevel') {
            field.value = maybeFormatIdReference(diffIndex, v);
          }
        } else if (code === 'TERR') {
          if (k === 'workerjob') {
            field.value = maybeFormatIdReference(tfrmIndex, v);
          } else if (k === 'pollutioneffect') {
            field.value = maybeFormatIdReference(terrIndex, v);
          } else if (['allowcities','allowcolonies','impassable','impassablebywheeled','allowairfields','allowforts','allowoutposts','allowradartowers','landmarkenabled'].includes(k)) {
            field.value = toBoolStringFromInt(v);
          }
        } else if (code === 'ESPN') {
          if (k === 'missionperformedby') {
            field.value = v.charAt(0).toUpperCase() + v.slice(1);
          }
        } else if (code === 'GAME') {
          if (k === 'startmonth') {
            field.value = toMonthName(v);
          } else if (k.startsWith('playable_civ')) {
            field.value = maybeFormatIdReference(raceIndex, v);
          } else if (k === 'acceleratedproduction' ||
            k === 'allowculturalconversions' ||
            k === 'autoplacekings' ||
            k === 'autoplacevictorylocations' ||
            k === 'captureanyflag' ||
            k === 'capturetheflag' ||
            k === 'civspecificabilitiesenabled' ||
            k === 'conquestenabled' ||
            k === 'culturalenabled' ||
            k === 'culturallylinkedstart' ||
            k === 'debugmode' ||
            k === 'defaultvictoryconditions' ||
            k === 'diplomacticenabled' ||
            k === 'dominationenabled' ||
            k === 'eliminationenabled' ||
            k === 'mapvisible' ||
            k === 'massregicideenabled' ||
            k === 'permitplagues' ||
            k === 'placecaptureunits' ||
            k === 'preserverandomseed' ||
            k === 'regicideenabled' ||
            k === 'respawnflagunits' ||
            k === 'restartplayersenabled' ||
            k === 'retainculture' ||
            k === 'reversecapturetheflag' ||
            k === 'spaceraceenabled' ||
            k === 'usedefaultrules' ||
            k === 'usetimelimit' ||
            k === 'victorylocationsenabled' ||
            k === 'wondervictoryenabled') {
            field.value = toBoolStringFromInt(v);
          }
        } else if (code === 'LEAD') {
          if (k === 'civ') field.value = formatLeadCivilizationReference(raceIndex, v);
          else if (k === 'government') field.value = maybeFormatIdReference(govIndex, v);
          else if (k === 'initialera') field.value = maybeFormatIdReference(eraIndex, v);
          else if (k === 'humanplayer' || k === 'customcivdata' || k === 'startembassies' || k === 'skipfirstturn') field.value = normalizeBoolish(v);
          else if (k === 'genderofleadername') {
            const g = cleanDisplayText(v).toLowerCase();
            field.value = g === 'male' || g === 'female' ? g.charAt(0).toUpperCase() + g.slice(1) : v;
          }
        } else if (code === 'WCHR') {
          if (k === 'worldsize') field.value = maybeFormatIdReference(wsizIndex, v);
        } else if (code === 'WMAP') {
          if (k === 'xwrapping' || k === 'ywrapping' || k === 'polar_ice_caps') field.value = normalizeBoolish(v);
        } else if (code === 'CITY') {
          if (k === 'owner') field.value = formatOwnerField(record, v);
          else if (k === 'ownertype') {
            const ownerType = { '0': 'None (0)', '1': 'Barbarians (1)', '2': 'Civilization (2)', '3': 'Player (3)' };
            field.value = ownerType[v] || v;
          } else if (k === 'citylevel') {
            const cityLevel = { '0': 'Town (0)', '1': 'City (1)', '2': 'Metropolis (2)' };
            field.value = cityLevel[v] || v;
          } else if (k === 'useautoname' || k === 'haspalace' || k === 'haswalls') field.value = toBoolStringFromInt(v);
          else if (k.startsWith('building')) field.value = maybeFormatIdReference(bldgIndex, v);
        } else if (code === 'UNIT') {
          if (k === 'unit_index') field.value = maybeFormatIdReference(unitIndex, v);
          else if (k === 'owner') field.value = formatOwnerField(record, v);
          else if (k === 'ownertype') {
            const ownerType = { '0': 'None (0)', '1': 'Barbarians (1)', '2': 'Civilization (2)', '3': 'Player (3)' };
            field.value = ownerType[v] || v;
          } else if (k === 'usecivilizationking') field.value = toBoolStringFromInt(v);
        } else if (code === 'CLNY') {
          if (k === 'owner') field.value = formatOwnerField(record, v);
          else if (k === 'ownertype') {
            const ownerType = { '0': 'None (0)', '1': 'Barbarians (1)', '2': 'Civilization (2)', '3': 'Player (3)' };
            field.value = ownerType[v] || v;
          }
        } else if (code === 'TILE') {
          if (k === 'resource') field.value = maybeFormatIdReference(goodIndex, v);
          else if (k === 'city') field.value = maybeFormatIdReference(cityIndex, v);
          else if (k === 'colony') field.value = maybeFormatIdReference(colonyIndex, v);
          else if (k === 'continent') field.value = maybeFormatIdReference(contIndex, v);
          else if (k === 'owner') field.value = formatOwnerField(record, v);
          else if (k === 'fogofwar' || k === 'ruin') {
            field.originalValue = String(v == null ? '' : v);
            field.value = toBoolStringFromInt(v);
          }
        } else if (code === 'CONT') {
          if (k === 'continentclass') {
            const cls = { '0': 'Water (0)', '1': 'Land (1)' };
            field.value = cls[v] || v;
          }
        } else if (code === 'FLAV') {
          const relMatch = k.match(/^relation_with_flavor_(\d+)$/);
          if (relMatch) {
            const idx = Number.parseInt(relMatch[1], 10);
            const flavorName = flavIndex[idx];
            field.label = flavorName ? `Relation With ${flavorName}` : `Relation With Flavor ${idx + 1}`;
          }
        }

        if (code === 'RULE') {
          const partReqMatch = k.match(/^number_of_parts_(\d+)_required$/);
          if (partReqMatch) {
            const partIdx = Number.parseInt(partReqMatch[1], 10);
            const partName = spaceshipPartByIndex[partIdx] || `Spaceship Part ${partIdx + 1}`;
            field.label = `${partName} Required`;
          }
        } else if (code === 'GOVT') {
          const vsGovMatch = k.match(/^performance_of_this_government_versus_government_(\d+)$/);
          if (vsGovMatch) {
            const idx = Number.parseInt(vsGovMatch[1], 10);
            const govName = govIndex[idx];
            field.label = govName
              ? `Performance Vs ${govName}`
              : `Performance Vs Government ${idx + 1}`;
          }
        } else if (code === 'BLDG' || code === 'TECH' || code === 'RACE') {
          const flavorMatch = k.match(/^flavor_(\d+)$/);
          if (flavorMatch) {
            const idx = Number.parseInt(flavorMatch[1], 10) - 1;
            const flavorName = flavIndex[idx];
            field.label = flavorName ? `Flavor ${flavorName}` : `Flavor ${flavorMatch[1]}`;
          }
          if (code === 'RACE') {
            const fwdEraMatch = k.match(/^forwardfilename_for_era_(\d+)$/);
            if (fwdEraMatch) {
              const idx = Number.parseInt(fwdEraMatch[1], 10);
              const eraName = eraIndex[idx];
              field.label = eraName ? `Forward Filename For ${eraName}` : `Forward Filename For Era ${idx + 1}`;
            }
            const revEraMatch = k.match(/^reversefilename_for_era_(\d+)$/);
            if (revEraMatch) {
              const idx = Number.parseInt(revEraMatch[1], 10);
              const eraName = eraIndex[idx];
              field.label = eraName ? `Reverse Filename For ${eraName}` : `Reverse Filename For Era ${idx + 1}`;
            }
          }
        } else if (code === 'GAME') {
          const timeTurnsMatch = k.match(/^turns_in_time_section_(\d+)$/);
          if (timeTurnsMatch) {
            const idx = Number.parseInt(timeTurnsMatch[1], 10);
            field.label = `Turns In Time Section ${idx + 1}`;
          }
          const timePerTurnMatch = k.match(/^time_per_turn_in_time_section_(\d+)$/);
          if (timePerTurnMatch) {
            const idx = Number.parseInt(timePerTurnMatch[1], 10);
            field.label = `Time Per Turn In Time Section ${idx + 1}`;
          }
          const allianceNameMatch = k.match(/^alliance(\d+)$/);
          if (allianceNameMatch) {
            const idx = Number.parseInt(allianceNameMatch[1], 10);
            field.label = idx === 0 ? 'No Alliances Name' : `Alliance ${idx} Name`;
          }
          const warMatch = k.match(/^alliance(\d+)_is_at_war_with_alliance(\d+)_(\d+)$/);
          if (warMatch) {
            const a = Number.parseInt(warMatch[1], 10);
            const b = Number.parseInt(warMatch[2], 10);
            field.label = `Alliance ${a} At War With Alliance ${b}`;
            field.value = toBoolStringFromInt(field.value);
          }
        } else if (code === 'CITY') {
          if (k === 'building') {
            field.label = 'Building 1';
          } else {
            const bldMatch = k.match(/^building_(\d+)$/);
            if (bldMatch) {
              const idx = Number.parseInt(bldMatch[1], 10);
              field.label = `Building ${idx}`;
            }
          }
        }

        field.value = cleanDisplayText(field.value);
        applyFieldLabelOverrides(code, field);
      });
    });
  });
  return sections;
}

function normalizeBridgeSections(parsed) {
  const sections = (parsed.sections || []).map((section) => {
    const fullRecords = Array.isArray(section.records)
      ? section.records.map((record) => ({ ...record }))
      : [];
    const limit = getBiqBridgeRecordLimit(section.code);
    const records = fullRecords
      .slice(0, limit)
      .map((record) => ({
        index: record.index || 0,
        name: cleanRecordName(record.name, `${section.code} ${(record.index || 0) + 1}`),
        fields: parseEnglishFields(section.code, record.english || ''),
        writableBaseKeys: Array.isArray(record.writableBaseKeys) ? record.writableBaseKeys : []
      }));
    return {
      id: `${section.code}-${section.count || records.length}`,
      code: section.code,
      title: section.title || section.code,
      count: Number(section.count || records.length),
      records,
      fullRecords,
      recordsTruncated: Number(section.count || 0) > records.length
    };
  });
  return { ok: true, sections: enrichBridgeSections(sections) };
}

function runBiqBridgeOnInflatedBuffer({ buffer, textEncoding }) {
  try {
    const jsResult = jsParseBiqBuffer(buffer, { textEncoding: resolveAutoTextEncoding(textEncoding) });
    if (jsResult.ok) return normalizeBridgeSections(jsResult);
    return { ok: false, error: jsResult.error || 'BIQ parse failed' };
  } catch (err) {
    return { ok: false, error: `BIQ parse failed: ${err.message}` };
  }
}

function getTileRecordLength(versionTag, majorVersion) {
  if (versionTag === 'BICX' && majorVersion === 12) return 0x2d + 4;
  if (versionTag === 'BICX') return 33;
  if (versionTag === 'BIC ' && majorVersion === 2) return 0x16 + 4;
  return 0x17 + 4;
}

function decodeAsciiSamples(buf, maxSamples = 3) {
  const text = buf.toString('latin1');
  const matches = text.match(/[ -~]{4,}/g) || [];
  return matches.slice(0, maxSamples).map((s) => s.trim()).filter(Boolean);
}

function parseGenericRecordFields(recordData) {
  const fields = [];
  fields.push({ key: 'byte_length', value: String(recordData.length) });
  const maxInts = Math.min(16, Math.floor(recordData.length / 4));
  for (let i = 0; i < maxInts; i += 1) {
    fields.push({ key: `u32_${i}`, value: String(recordData.readUInt32LE(i * 4)) });
  }
  const ascii = decodeAsciiSamples(recordData);
  if (ascii.length > 0) {
    fields.push({ key: 'text_preview', value: ascii.join(' | ') });
  }
  return fields;
}

function parseGameRecordFields(recordData) {
  const fields = [];
  const readI32 = (off) => (off + 4 <= recordData.length ? recordData.readInt32LE(off) : null);
  let offset = 0;
  const pushInt = (key) => {
    const v = readI32(offset);
    fields.push({ key, value: v == null ? '(truncated)' : String(v) });
    offset += 4;
    return v;
  };

  pushInt('use_default_rules');
  pushInt('default_victory_conditions');
  const numPlayableCivs = pushInt('number_of_playable_civs');
  const playableCount = Number.isFinite(numPlayableCivs) && numPlayableCivs > 0 ? numPlayableCivs : 0;
  const playableIds = [];
  for (let i = 0; i < playableCount; i += 1) {
    const v = readI32(offset);
    if (v == null) break;
    playableIds.push(v);
    offset += 4;
  }
  fields.push({ key: 'playable_civ_ids', value: playableIds.join(', ') || '(none)' });
  pushInt('victory_conditions_and_rules');
  pushInt('place_capture_units');
  pushInt('auto_place_kings');
  pushInt('auto_place_victory_locations');
  pushInt('debug_mode');
  pushInt('use_time_limit');
  pushInt('base_time_unit');
  pushInt('start_month');
  pushInt('start_week');
  pushInt('start_year');
  pushInt('minute_time_limit');
  pushInt('turn_time_limit');

  const turnsPerScale = [];
  for (let i = 0; i < 7; i += 1) {
    const v = readI32(offset);
    if (v == null) break;
    turnsPerScale.push(v);
    offset += 4;
  }
  fields.push({ key: 'turns_per_timescale_part', value: turnsPerScale.join(', ') || '(none)' });

  const timeUnitsPerTurn = [];
  for (let i = 0; i < 7; i += 1) {
    const v = readI32(offset);
    if (v == null) break;
    timeUnitsPerTurn.push(v);
    offset += 4;
  }
  fields.push({ key: 'time_units_per_turn', value: timeUnitsPerTurn.join(', ') || '(none)' });

  if (offset + 5200 <= recordData.length) {
    const folders = toBiqString(recordData, offset, offset + 5200);
    fields.push({ key: 'scenario_search_folders', value: folders || '(none)' });
  } else {
    fields.push({ key: 'scenario_search_folders', value: '(truncated)' });
  }

  return fields;
}

function decodeBiqRecordFields(sectionCode, recordData) {
  if (sectionCode === 'GAME') {
    return parseGameRecordFields(recordData);
  }
  return parseGenericRecordFields(recordData);
}

function parseSectionRecords(buf, section, versionTag, majorVersion) {
  const records = [];
  let pos = section.startOffset + 8;
  if (pos > section.endOffset) return records;

  if (section.parseMode === 'fixed') {
    const fixedSize = section.fixedByVersion
      ? getTileRecordLength(versionTag, majorVersion)
      : section.fixedSize;
    if (!fixedSize || fixedSize < 1) return records;
    for (let i = 0; i < section.count && i < MAX_BIQ_RECORDS_PER_SECTION; i += 1) {
      const recStart = pos + i * fixedSize;
      const recEnd = recStart + fixedSize;
      if (recEnd > section.endOffset) break;
      const recordData = buf.subarray(recStart, recEnd);
      records.push({
        index: i,
        recordLength: fixedSize,
        fields: decodeBiqRecordFields(section.code, recordData)
      });
    }
    return records;
  }

  for (let i = 0; i < section.count && i < MAX_BIQ_RECORDS_PER_SECTION && pos + 4 <= section.endOffset; i += 1) {
    const recLen = readUInt32LESafe(buf, pos);
    if (recLen == null || recLen < 0) break;
    const recStart = pos + 4;
    const recEnd = recStart + recLen;
    if (recEnd > section.endOffset) break;
    const recordData = buf.subarray(recStart, recEnd);
    records.push({
      index: i,
      recordLength: recLen,
      fields: decodeBiqRecordFields(section.code, recordData)
    });
    pos = recEnd;
  }
  return records;
}

function parseBiqHeaderMetadata(buf, options = {}) {
  const textEncoding = resolveAutoTextEncoding(options && options.textEncoding);
  const versionTag = readBiqTag(buf, 0);
  const verHeaderTag = readBiqTag(buf, 4);
  const majorVersion = readUInt32LESafe(buf, 24) || 0;
  const minorVersion = readUInt32LESafe(buf, 28) || 0;
  const biqDescription = toBiqString(buf, 32, 672, textEncoding);
  const biqTitle = toBiqString(buf, 672, 736, textEncoding);
  const numHeaders = readUInt32LESafe(buf, 8) || 0;
  const headerLength = readUInt32LESafe(buf, 12) || 0;
  return {
    versionTag,
    verHeaderTag,
    majorVersion,
    minorVersion,
    biqDescription,
    biqTitle,
    numHeaders,
    headerLength
  };
}

function parseBiqSectionsFromBuffer(buf, options = {}) {
  const textEncoding = resolveAutoTextEncoding(options && options.textEncoding);
  const header = parseBiqHeaderMetadata(buf, { textEncoding });
  const {
    versionTag,
    verHeaderTag,
    majorVersion,
    minorVersion,
    biqDescription,
    biqTitle,
    numHeaders,
    headerLength
  } = header;
  if (!versionTag.startsWith('BIC') || verHeaderTag !== 'VER#') {
    throw new Error('Invalid BIQ header');
  }

  const findSectionStart = (code, fromOffset) => {
    const needle = Buffer.from(code, 'latin1');
    let idx = buf.indexOf(needle, fromOffset);
    while (idx >= 0) {
      const count = readUInt32LESafe(buf, idx + 4);
      if (count !== null && count < 50_000_000) {
        return { offset: idx, count };
      }
      idx = buf.indexOf(needle, idx + 1);
    }
    return null;
  };

  let searchFrom = 736;
  const located = [];
  for (const def of BIQ_SECTION_DEFS) {
    const found = findSectionStart(def.code, searchFrom);
    if (!found) {
      if (def.optional) continue;
      throw new Error(`Expected section ${def.code} after 0x${searchFrom.toString(16)}`);
    }
    located.push({ ...def, startOffset: found.offset, count: found.count });
    searchFrom = found.offset + 4;
  }

  const sections = [];
  for (let i = 0; i < located.length; i += 1) {
    const def = located[i];
    const next = located[i + 1];
    const endOffset = next ? next.startOffset : buf.length;
    const section = {
      id: `${def.code}-${sections.length + 1}`,
      code: def.code,
      title: def.title,
      count: def.count,
      startOffset: def.startOffset,
      endOffset,
      byteLength: endOffset - def.startOffset,
      parseMode: def.mode,
      textEncoding
    };
    section.records = parseSectionRecords(buf, section, versionTag, majorVersion);
    section.recordsTruncated = section.count > section.records.length;
    sections.push(section);
  }

  return {
    versionTag,
    verHeaderTag,
    majorVersion,
    minorVersion,
    numHeaders,
    headerLength,
    biqDescription,
    biqTitle,
    totalBytes: buf.length,
    sections
  };
}

function resolveScenarioDir(scenarioPath) {
  const trimmed = String(scenarioPath || '').trim();
  if (!trimmed) return '';
  if (/\.biq$/i.test(trimmed)) return path.dirname(trimmed);
  return trimmed;
}

function getSharedScenariosRoot(civ3Path) {
  const root = resolveCiv3RootPath(civ3Path);
  return root ? path.join(root, 'Conquests', 'Scenarios') : '';
}

function isSharedScenariosRootDir(dirPath, civ3Path) {
  const dir = String(dirPath || '').trim();
  const sharedRoot = getSharedScenariosRoot(civ3Path);
  if (!dir || !sharedRoot) return false;
  return canonicalizeForPathFence(dir) === canonicalizeForPathFence(sharedRoot);
}

function getScenarioStemFromPath(scenarioPath) {
  const trimmed = String(scenarioPath || '').trim();
  if (!trimmed) return '';
  const baseName = path.basename(trimmed);
  return sanitizeScenarioStem(baseName);
}

function splitScenarioSearchFolderValue(value) {
  return String(value || '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v && v !== '(none)' && v !== '(truncated)');
}

function normalizeScenarioSearchFolderOverride(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter((v) => v && v !== '(none)' && v !== '(truncated)');
  }
  return splitScenarioSearchFolderValue(value);
}

function resolveScenarioSearchDirs({ scenarioPath, civ3Path, folders, includeMissing = false }) {
  const biqDir = resolveScenarioDir(scenarioPath);
  const root = resolveCiv3RootPath(civ3Path);
  const ordered = [];
  const seen = new Set();
  const pushCandidate = (candidate) => {
    const p = String(candidate || '').trim();
    if (!p || seen.has(p)) return;
    try {
      if (includeMissing || (fs.existsSync(p) && fs.statSync(p).isDirectory())) {
        seen.add(p);
        ordered.push(p);
      }
    } catch (_err) {
      // ignore invalid paths
    }
  };

  (Array.isArray(folders) ? folders : []).forEach((folder) => {
    const normalizedFolder = String(folder).replace(/\\/g, '/').trim();
    if (!normalizedFolder) return;
    if (path.isAbsolute(folder) || /^[A-Za-z]:\//.test(normalizedFolder)) {
      pushCandidate(normalizedFolder);
      return;
    }
    pushCandidate(path.join(biqDir, normalizedFolder));
    if (root) {
      pushCandidate(path.join(root, 'Conquests', 'Scenarios', normalizedFolder));
      pushCandidate(path.join(root, 'Conquests', normalizedFolder));
    }
  });
  return ordered;
}

function pickPreferredScenarioContentRoot(roots) {
  const list = dedupePathList(roots);
  return list.find((root) => {
    try {
      return fs.existsSync(path.join(root, 'Art')) || fs.existsSync(path.join(root, 'Text'));
    } catch (_err) {
      return false;
    }
  }) || list[0] || '';
}

function allocateScenarioSearchFolderPath({ scenarioPath, civ3Path }) {
  const biqDir = resolveScenarioDir(scenarioPath);
  if (!biqDir) return '';
  const preferred = getScenarioStemFromPath(scenarioPath) || 'Scenario';
  let candidate = path.join(biqDir, preferred);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(biqDir, `${preferred} ${suffix}`);
    suffix += 1;
  }
  return candidate;
}

function toScenarioSearchFolderValue(targetDir, scenarioPath) {
  const absoluteTarget = String(targetDir || '').trim();
  const biqDir = resolveScenarioDir(scenarioPath);
  if (!absoluteTarget || !biqDir) return '';
  const rel = path.relative(biqDir, absoluteTarget).replace(/\\/g, '/').trim();
  if (!rel || rel === '.') return '';
  return rel;
}

function getPendingScenarioSearchFolderOverride(tabs) {
  const tab = tabs && tabs.scenarioSettings;
  if (!tab || !Array.isArray(tab.sections)) return null;
  for (const section of tab.sections) {
    const sectionCode = String(section && section.code || '').trim().toUpperCase();
    if (sectionCode !== 'GAME' || !Array.isArray(section.records)) continue;
    for (const record of section.records) {
      if (!record || !Array.isArray(record.fields)) continue;
      const field = record.fields.find((entry) => {
        const key = canonicalFieldKey(entry && (entry.baseKey || entry.key));
        return key === 'scenariosearchfolders' || key === 'scenariosearchfolder';
      });
      if (field) {
        return splitScenarioSearchFolderValue(field.value);
      }
    }
  }
  return null;
}

function resolveScenarioSearchDirsFromBiq({ scenarioPath, civ3Path, biqTab }) {
  return resolveScenarioSearchDirs({
    scenarioPath,
    civ3Path,
    folders: extractScenarioSearchFolders(biqTab),
    includeMissing: false
  });
}

function extractScenarioSearchFolders(biqTab) {
  if (!biqTab || !Array.isArray(biqTab.sections)) return [];
  const game = biqTab.sections.find((s) => s.code === 'GAME');
  if (!game || !Array.isArray(game.records) || game.records.length === 0) return [];
  const field = (game.records[0].fields || []).find((f) => {
    const key = String(f.key || '').toLowerCase();
    const label = String(f.label || '').toLowerCase();
    return key.includes('scenariosearchfolder') ||
      label.includes('scenario search folder');
  });
  if (!field || !field.value || field.value === '(none)' || field.value === '(truncated)') return [];
  return splitScenarioSearchFolderValue(field.value);
}

function getScenarioSearchFieldMeta(biqTab) {
  if (!biqTab || !Array.isArray(biqTab.sections)) return null;
  const game = biqTab.sections.find((s) => s.code === 'GAME');
  if (!game || !Array.isArray(game.records) || game.records.length === 0) return null;
  const field = (game.records[0].fields || []).find((f) => {
    const key = String((f.baseKey || f.key || '')).toLowerCase();
    const label = String(f.label || '').toLowerCase();
    return key.includes('scenario_search') ||
      key.includes('scenariosearchfolders') ||
      label.includes('scenariosearchfolders') ||
      label.includes('scenario search folders');
  });
  if (!field) return null;
  return {
    fieldKey: String(field.baseKey || field.key || '').trim(),
    value: String(field.value || '')
  };
}

function resolveScenarioDirFromBiq({ scenarioPath, civ3Path, biqTab }) {
  const fallback = resolveScenarioDir(scenarioPath);
  const dirs = resolveScenarioSearchDirsFromBiq({ scenarioPath, civ3Path, biqTab });
  if (dirs.length > 1) {
    const fallbackResolved = path.resolve(String(fallback || ''));
    const fallbackIsScenariosRoot = /[\\/]Conquests[\\/]Scenarios$/i.test(String(fallbackResolved || ''));
    if (fallbackIsScenariosRoot) {
      const preferred = dirs.find((candidate) => {
        const resolved = path.resolve(String(candidate || ''));
        if (!resolved || resolved === fallbackResolved) return false;
        try {
          return fs.existsSync(path.join(resolved, 'Art')) || fs.existsSync(path.join(resolved, 'Text'));
        } catch (_err) {
          return false;
        }
      });
      if (preferred) return preferred;
    }
  }
  return dirs[0] || fallback;
}

function resolveBiqPath({ mode, civ3Path, scenarioPath }) {
  if (mode === 'scenario') {
    const raw = String(scenarioPath || '').trim();
    if (/\.biq$/i.test(raw)) return raw;
    return '';
  }
  const root = resolveCiv3RootPath(civ3Path);
  if (!root) return '';
  return path.join(root, 'Conquests', 'conquests.biq');
}

function loadBiqTab({ mode, civ3Path, scenarioPath, textEncoding = 'windows-1252' }) {
  const biqPath = resolveBiqPath({ mode, civ3Path, scenarioPath });
  if (!biqPath) {
    log.warn('loadBiqTab', mode === 'scenario'
      ? 'No scenario BIQ path — pick a .biq file.'
      : `Cannot resolve conquests.biq from civ3Path=${log.rel(civ3Path)}`);
    return {
      title: 'BIQ',
      type: 'biq',
      readOnly: true,
      sourcePath: '',
      error: mode === 'scenario'
        ? 'No scenario BIQ selected. Pick a .biq file in Scenario mode.'
        : 'Could not resolve Conquests/conquests.biq from Civilization 3 path.',
      sections: []
    };
  }
  log.info('loadBiqTab', `Loading: ${log.rel(biqPath)}`);
  const inflated = inflateBiqIfNeeded(biqPath, civ3Path);
  if (!inflated.ok) {
    log.error('loadBiqTab', `Inflate failed: ${inflated.error}`);
    return {
      title: 'BIQ',
      type: 'biq',
      readOnly: true,
      sourcePath: biqPath,
      error: inflated.error,
      sections: []
    };
  }
  try {
    const resolvedTextEncoding = detectBiqTextEncodingFromBuffer(inflated.buffer, textEncoding);
    const headerMeta = parseBiqHeaderMetadata(inflated.buffer, { textEncoding: resolvedTextEncoding });
    const bridged = runBiqBridgeOnInflatedBuffer({ buffer: inflated.buffer, textEncoding: resolvedTextEncoding });
    if (bridged.ok) {
      log.info('loadBiqTab', `Parsed via JS bridge — ${bridged.sections && bridged.sections.length} section(s)`);
      return {
        title: 'BIQ',
        type: 'biq',
        readOnly: true,
        sourcePath: biqPath,
        compressedSource: inflated.compressed,
        decompressorPath: inflated.decompressorPath || '',
        textEncoding: resolvedTextEncoding,
        ...headerMeta,
        sections: bridged.sections,
        bridgeMode: true
      };
    }

    log.warn('loadBiqTab', `JS bridge failed (${bridged.error || 'unknown'}) — falling back to binary parser`);
    const parsed = parseBiqSectionsFromBuffer(inflated.buffer, { textEncoding: resolvedTextEncoding });
    log.info('loadBiqTab', `Parsed via binary parser — ${parsed.sections && parsed.sections.length} section(s)`);
    return {
      title: 'BIQ',
      type: 'biq',
      readOnly: true,
      sourcePath: biqPath,
      compressedSource: inflated.compressed,
      decompressorPath: inflated.decompressorPath || '',
      textEncoding: resolvedTextEncoding,
      bridgeMode: false,
      bridgeError: bridged.error || '',
      ...parsed
    };
  } catch (err) {
    log.error('loadBiqTab', `Parse threw: ${err.message}`);
    return {
      title: 'BIQ',
      type: 'biq',
      readOnly: true,
      sourcePath: biqPath,
      error: `Failed to parse BIQ sections: ${err.message}`,
      sections: []
    };
  }
}

function readTextIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    if (activeReadCollector) activeReadCollector.add(path.resolve(String(filePath)));
    return fs.readFileSync(filePath, 'utf8');
  } catch (_err) {
    return null;
  }
}

const WINDOWS_1252_DECODE_MAP = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178
};

function decodeWindows1252Buffer(buffer) {
  let out = '';
  for (let i = 0; i < buffer.length; i += 1) {
    const b = buffer[i];
    if (b >= 0x80 && b <= 0x9f && WINDOWS_1252_DECODE_MAP[b]) {
      out += String.fromCharCode(WINDOWS_1252_DECODE_MAP[b]);
      continue;
    }
    out += String.fromCharCode(b);
  }
  return out;
}

function normalizeTextFileEncoding(value) {
  const raw = String(value == null ? DEFAULT_TEXT_FILE_ENCODING : value).trim().toLowerCase();
  return TEXT_FILE_ENCODING_ALIASES[raw] || DEFAULT_TEXT_FILE_ENCODING;
}

function resolveAutoTextEncoding(value, fallback = 'windows-1252') {
  const normalized = normalizeTextFileEncoding(value);
  return normalized === 'auto' ? fallback : normalized;
}

function mapTextEncodingToCodec(value) {
  const encoding = normalizeTextFileEncoding(value);
  if (encoding === 'auto') return 'windows-1252';
  return encoding;
}

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function scoreDecodedTextCandidate(text) {
  const value = String(text || '');
  if (!value) return 0;
  const length = value.length || 1;
  const replacementCount = countMatches(value, /\uFFFD/g);
  const controlCount = countMatches(value, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g);
  const cjkCount = countMatches(value, /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g);
  const kanaCount = countMatches(value, /[\u3040-\u30FF]/g);
  const hangulCount = countMatches(value, /[\uAC00-\uD7AF]/g);
  const cyrillicCount = countMatches(value, /[\u0400-\u04FF]/g);
  const latinCount = countMatches(value, /[A-Za-z\u00C0-\u024F]/g);
  const mixedLatinCyrillicTokenCount = countMatches(value, /\b(?=[A-Za-z\u00C0-\u024F\u0400-\u04FF]*[A-Za-z\u00C0-\u024F])(?=[A-Za-z\u00C0-\u024F\u0400-\u04FF]*[\u0400-\u04FF])[A-Za-z\u00C0-\u024F\u0400-\u04FF]+\b/gu);
  const mixedLatinCjkTokenCount = countMatches(value, /\b(?=[A-Za-z\u00C0-\u024F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]*[A-Za-z\u00C0-\u024F])(?=[A-Za-z\u00C0-\u024F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]*[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF])[A-Za-z\u00C0-\u024F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+\b/gu);
  const mixedLatinKanaTokenCount = countMatches(value, /\b(?=[A-Za-z\u00C0-\u024F\u3040-\u30FF]*[A-Za-z\u00C0-\u024F])(?=[A-Za-z\u00C0-\u024F\u3040-\u30FF]*[\u3040-\u30FF])[A-Za-z\u00C0-\u024F\u3040-\u30FF]+\b/gu);
  const mixedLatinHangulTokenCount = countMatches(value, /\b(?=[A-Za-z\u00C0-\u024F\uAC00-\uD7AF]*[A-Za-z\u00C0-\u024F])(?=[A-Za-z\u00C0-\u024F\uAC00-\uD7AF]*[\uAC00-\uD7AF])[A-Za-z\u00C0-\u024F\uAC00-\uD7AF]+\b/gu);
  const latinToCyrillicAdjacencyCount = countMatches(value, /[A-Za-z\u00C0-\u024F][\u0400-\u04FF]|[\u0400-\u04FF][A-Za-z\u00C0-\u024F]/gu);
  const latinToCjkAdjacencyCount = countMatches(value, /[A-Za-z\u00C0-\u024F][\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]|[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF][A-Za-z\u00C0-\u024F]/gu);
  const latinToKanaAdjacencyCount = countMatches(value, /[A-Za-z\u00C0-\u024F][\u3040-\u30FF]|[\u3040-\u30FF][A-Za-z\u00C0-\u024F]/gu);
  const latinToHangulAdjacencyCount = countMatches(value, /[A-Za-z\u00C0-\u024F][\uAC00-\uD7AF]|[\uAC00-\uD7AF][A-Za-z\u00C0-\u024F]/gu);
  const whitespaceCount = countMatches(value, /[\t\r\n ]/g);
  const markerCount = countMatches(value, /(^|\n)\s*#[A-Z0-9_]+/g) + countMatches(value, /\$LINK<|\^\{|\b(?:ICON|DESC|RACE|TECH|GOOD|BLDG|PRTO|GCON|TERR|TFRM)_/g);
  const suspiciousMojibakeCount = countMatches(value, /[¤¦¨¯´¸¼½¾Ð×Þàãðõ÷øþÿ]/g)
    + countMatches(value, /[ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝ]/g);
  const printableCount = countMatches(value, /[\p{L}\p{N}\p{P}\p{S}\s]/gu);
  const eastAsianCount = cjkCount + kanaCount + hangulCount;
  const mixedEastAsianCount = mixedLatinCjkTokenCount + mixedLatinKanaTokenCount + mixedLatinHangulTokenCount
    + latinToCjkAdjacencyCount + latinToKanaAdjacencyCount + latinToHangulAdjacencyCount;
  const mixedCyrillicCount = mixedLatinCyrillicTokenCount + latinToCyrillicAdjacencyCount;
  const eastAsianShare = eastAsianCount / Math.max(1, latinCount + cyrillicCount + eastAsianCount);
  const cyrillicShare = cyrillicCount / Math.max(1, latinCount + cyrillicCount + eastAsianCount);
  let score = 0;
  score -= replacementCount * 180;
  score -= controlCount * 60;
  score += cjkCount * 8;
  score += kanaCount * 12;
  score += hangulCount * 12;
  score += cyrillicCount * 1.5;
  score += latinCount * 0.5;
  score -= mixedLatinCyrillicTokenCount * 18;
  score -= mixedLatinCjkTokenCount * 24;
  score -= mixedLatinKanaTokenCount * 24;
  score -= mixedLatinHangulTokenCount * 24;
  score -= latinToCyrillicAdjacencyCount * 22;
  score -= latinToCjkAdjacencyCount * 28;
  score -= latinToKanaAdjacencyCount * 28;
  score -= latinToHangulAdjacencyCount * 28;
  score += whitespaceCount * 0.1;
  score += markerCount * 12;
  score += printableCount / length;
  if (eastAsianCount > 0 && mixedEastAsianCount > 0 && latinCount > eastAsianCount * 12) {
    score -= mixedEastAsianCount * 80;
    if (eastAsianShare < 0.02) {
      score -= eastAsianCount * 6;
    }
  }
  if (cyrillicCount > 0 && mixedCyrillicCount > 0 && latinCount > cyrillicCount * 12 && cyrillicShare < 0.04) {
    score -= mixedCyrillicCount * 32;
  }
  if (hangulCount > 0 && cjkCount > 0 && kanaCount === 0) {
    score -= Math.min(hangulCount, cjkCount) * 10;
  }
  if ((cjkCount + kanaCount + hangulCount + cyrillicCount) === 0 && suspiciousMojibakeCount > Math.max(3, length * 0.04)) {
    score -= suspiciousMojibakeCount * 4;
  }
  return score;
}

function detectTextFileEncodingFromBuffer(buffer, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING) {
  const preferred = normalizeTextFileEncoding(preferredEncoding);
  if (preferred !== 'auto') return preferred;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 'windows-1252';
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf8';
  const hasHighBytes = buffer.some((byte) => byte >= 0x80);
  if (!hasHighBytes) return 'windows-1252';
  let bestEncoding = 'windows-1252';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of ['utf8', 'windows-1252', 'windows-1251', 'gbk', 'big5', 'shift_jis', 'euc-kr']) {
    let decoded = '';
    try {
      if (candidate === 'windows-1252') decoded = decodeWindows1252Buffer(buffer);
      else decoded = iconv.decode(buffer, mapTextEncodingToCodec(candidate));
    } catch (_err) {
      continue;
    }
    const score = scoreDecodedTextCandidate(decoded);
    if (score > bestScore) {
      bestScore = score;
      bestEncoding = candidate;
    }
  }
  return bestEncoding;
}

function collectBiqDecodedTextSamples(parsed, headerMeta = {}) {
  const parts = [
    headerMeta && headerMeta.biqTitle,
    headerMeta && headerMeta.biqDescription
  ];
  const sections = Array.isArray(parsed && parsed.sections) ? parsed.sections : [];
  sections.slice(0, 48).forEach((section) => {
    parts.push(section && section.title);
    const records = Array.isArray(section && section.records) ? section.records : [];
    records.slice(0, 256).forEach((record) => {
      parts.push(record && record.name);
      parts.push(record && record.english);
    });
  });
  return parts.filter(Boolean).join('\n');
}

function detectBiqTextEncodingFromBuffer(buffer, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING) {
  const preferred = normalizeTextFileEncoding(preferredEncoding);
  if (preferred !== 'auto') return preferred;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 'windows-1252';
  const hasHighBytes = buffer.some((byte) => byte >= 0x80);
  if (!hasHighBytes) return 'windows-1252';
  let bestEncoding = 'windows-1252';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of ['utf8', 'windows-1252', 'windows-1251', 'gbk', 'big5', 'shift_jis', 'euc-kr']) {
    try {
      const headerMeta = parseBiqHeaderMetadata(buffer, { textEncoding: candidate });
      const bridged = jsParseBiqBuffer(buffer, { textEncoding: candidate });
      const sampleText = collectBiqDecodedTextSamples(bridged && bridged.ok ? bridged : null, headerMeta);
      const score = scoreDecodedTextCandidate(sampleText) + (bridged && bridged.ok ? 8 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestEncoding = candidate;
      }
    } catch (_err) {
      continue;
    }
  }
  return bestEncoding;
}

function decodeTextBuffer(buffer, encoding) {
  const normalized = normalizeTextFileEncoding(encoding);
  if (normalized === 'windows-1252') return decodeWindows1252Buffer(buffer);
  return iconv.decode(buffer, mapTextEncodingToCodec(normalized));
}

function encodeTextBuffer(text, encoding, options = {}) {
  const normalized = normalizeTextFileEncoding(encoding);
  let buffer = normalized === 'windows-1252'
    ? encodeWindows1252Text(text)
    : iconv.encode(String(text == null ? '' : text), mapTextEncodingToCodec(normalized));
  if (options && options.bom && normalized === 'utf8') {
    buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buffer]);
  }
  return buffer;
}

function readTextFileWithEncodingInfoIfExists(filePath, options = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    if (activeReadCollector) activeReadCollector.add(path.resolve(String(filePath)));
    const buf = fs.readFileSync(filePath);
    const hasUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const source = hasUtf8Bom ? buf.subarray(3) : buf;
    const encoding = hasUtf8Bom
      ? 'utf8'
      : detectTextFileEncodingFromBuffer(source, options.preferredEncoding);
    const text = decodeTextBuffer(source, encoding);
    return {
      text,
      encoding,
      bom: hasUtf8Bom
    };
  } catch (_err) {
    return null;
  }
}

function readEncodedTextIfExists(filePath, options = {}) {
  const result = readTextFileWithEncodingInfoIfExists(filePath, options);
  return result ? result.text : null;
}

function readTextWithEncodingFallback(primaryPath, fallbackPath, options = {}) {
  const primary = String(primaryPath || '').trim();
  const fallback = String(fallbackPath || '').trim();
  const candidates = [primary, fallback].filter(Boolean);
  for (const candidate of candidates) {
    const info = readTextFileWithEncodingInfoIfExists(candidate, options);
    if (info != null) return info;
  }
  return { text: '', encoding: normalizeTextFileEncoding(options.preferredEncoding), bom: false };
}

function readWindows1252TextWithFallback(primaryPath, fallbackPath) {
  const result = readTextWithEncodingFallback(primaryPath, fallbackPath, { preferredEncoding: 'windows-1252' });
  return result ? result.text : '';
}

function readTextWithEncodingInfo(primaryPath, fallbackPath, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING) {
  return readTextWithEncodingFallback(primaryPath, fallbackPath, { preferredEncoding });
}

function readWindows1252TextIfExists(filePath) {
  const result = readTextFileWithEncodingInfoIfExists(filePath, { preferredEncoding: 'windows-1252' });
  return result ? result.text : null;
}

function readEncodedTextWithFallback(primaryPath, fallbackPath, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING) {
  const result = readTextWithEncodingFallback(primaryPath, fallbackPath, { preferredEncoding });
  return result ? result.text : '';
}

function readEncodedTextWithFallbackInfo(primaryPath, fallbackPath, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING) {
  return readTextWithEncodingFallback(primaryPath, fallbackPath, { preferredEncoding });
}

const WINDOWS_1252_ENCODE_MAP = Object.fromEntries(
  Object.entries(WINDOWS_1252_DECODE_MAP).map(([byte, codePoint]) => [codePoint, Number(byte)])
);

function encodeWindows1252Text(text) {
  const src = String(text == null ? '' : text);
  const bytes = [];
  for (let i = 0; i < src.length; i += 1) {
    const code = src.charCodeAt(i);
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
      continue;
    }
    const mapped = WINDOWS_1252_ENCODE_MAP[code];
    if (Number.isInteger(mapped)) {
      bytes.push(mapped);
      continue;
    }
    bytes.push(0x3f); // '?'
  }
  return Buffer.from(bytes);
}

function normalizeRelativePath(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^\.?[\\/]+/, '')
    .replace(/\\/g, '/');
}

function isAbsoluteFilesystemPath(raw) {
  const value = String(raw || '').trim().replace(/^["']|["']$/g, '');
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeAssetReferencePath(raw) {
  const value = String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/');
  if (!value) return '';
  if (isAbsoluteFilesystemPath(value)) return value;
  return value.replace(/^\.?[\\/]+/, '');
}

function normalizeScenarioArtRelativePath(raw) {
  const normalized = normalizeAssetReferencePath(raw);
  if (!normalized) return '';
  return path.basename(normalized);
}

function isSectionArtImagePathField(kind, key) {
  const kindKey = String(kind || '');
  const keyLower = String(key || '').trim().toLowerCase();
  return (kindKey === 'districts' && keyLower === 'img_paths')
    || ((kindKey === 'wonders' || kindKey === 'naturalWonders') && keyLower === 'img_path');
}

function resolveCiv3RootPath(civ3Path) {
  if (!civ3Path) return '';
  const base = path.basename(civ3Path).toLowerCase();
  if (base === 'conquests' || base === 'civ3ptw') {
    return path.dirname(civ3Path);
  }
  return civ3Path;
}

function normalizePathLike(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function dedupePathList(paths) {
  const out = [];
  const seen = new Set();
  (Array.isArray(paths) ? paths : []).forEach((raw) => {
    const candidate = String(raw || '').trim();
    if (!candidate) return;
    const key = normalizePathLike(path.resolve(candidate)).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(path.resolve(candidate));
  });
  return out;
}

function findNearestExistingParent(targetPath) {
  let cursor = path.resolve(String(targetPath || ''));
  while (cursor && !fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (!parent || parent === cursor) break;
    cursor = parent;
  }
  if (cursor && fs.existsSync(cursor)) return cursor;
  return '';
}

function canonicalizeForPathFence(targetPath) {
  const absolute = path.resolve(String(targetPath || ''));
  const existingParent = findNearestExistingParent(absolute);
  if (!existingParent) return normalizePathLike(absolute).toLowerCase();
  let canonicalParent = '';
  try {
    canonicalParent = fs.realpathSync.native(existingParent);
  } catch (_err) {
    canonicalParent = path.resolve(existingParent);
  }
  const relativeTail = path.relative(existingParent, absolute);
  const canonical = path.resolve(canonicalParent, relativeTail || '');
  return normalizePathLike(canonical).toLowerCase();
}

function isPathWithinRoot(targetPath, rootPath) {
  const targetNorm = canonicalizeForPathFence(targetPath);
  const rootNorm = canonicalizeForPathFence(rootPath);
  return targetNorm === rootNorm || targetNorm.startsWith(`${rootNorm}/`);
}

function isPathWithinAnyRoot(targetPath, roots) {
  const list = dedupePathList(roots);
  return list.some((root) => isPathWithinRoot(targetPath, root));
}

function deriveScenarioPathContext({
  scenarioPath,
  civ3Path,
  biqTab,
  searchFolderOverride = null,
  includeMissingSearchRoots = false,
  ensureLocalSearchRoot = false
}) {
  const biqRoot = resolveScenarioDir(scenarioPath);
  const explicitSearchRoots = resolveScenarioSearchDirs({
    scenarioPath,
    civ3Path,
    folders: searchFolderOverride != null ? searchFolderOverride : extractScenarioSearchFolders(biqTab),
    includeMissing: includeMissingSearchRoots
  });
  const biqInSharedScenarios = isSharedScenariosRootDir(biqRoot, civ3Path);
  let autoCreatedSearchRoot = '';
  let autoCreatedSearchValue = '';
  let searchRoots = dedupePathList(explicitSearchRoots);

  if (searchRoots.length === 0) {
    if (biqInSharedScenarios) {
      const sibling = path.join(biqRoot, getScenarioStemFromPath(scenarioPath));
      try {
        if (fs.existsSync(sibling) && fs.statSync(sibling).isDirectory()) {
          searchRoots = [path.resolve(sibling)];
        } else if (ensureLocalSearchRoot) {
          autoCreatedSearchRoot = allocateScenarioSearchFolderPath({ scenarioPath, civ3Path });
          autoCreatedSearchValue = toScenarioSearchFolderValue(autoCreatedSearchRoot, scenarioPath);
          if (autoCreatedSearchRoot) searchRoots = [path.resolve(autoCreatedSearchRoot)];
        }
      } catch (_err) {
        if (ensureLocalSearchRoot) {
          autoCreatedSearchRoot = allocateScenarioSearchFolderPath({ scenarioPath, civ3Path });
          autoCreatedSearchValue = toScenarioSearchFolderValue(autoCreatedSearchRoot, scenarioPath);
          if (autoCreatedSearchRoot) searchRoots = [path.resolve(autoCreatedSearchRoot)];
        }
      }
    } else if (biqRoot) {
      searchRoots = [path.resolve(biqRoot)];
    }
  }

  const writableRoots = dedupePathList([biqRoot, ...searchRoots]);
  const localSearchRoots = biqRoot
    ? searchRoots.filter((root) => isPathWithinRoot(root, biqRoot))
    : [];
  const contentRootCandidates = biqInSharedScenarios
    ? searchRoots
    : dedupePathList([biqRoot, ...localSearchRoots]);
  const contentWriteRoot = pickPreferredScenarioContentRoot(contentRootCandidates);
  // The directory the scenario files would be written to, even if it doesn't exist yet.
  // Used during load to keep targetPath non-null for new scenario files so the Files Modal
  // can show a pending-write entry and "View Changes" before the first save.
  const expectedContentWriteRoot = contentWriteRoot
    || (biqInSharedScenarios ? path.join(biqRoot, getScenarioStemFromPath(scenarioPath)) : biqRoot);
  return {
    biqRoot,
    searchRoots,
    writableRoots,
    contentWriteRoot,
    expectedContentWriteRoot,
    autoCreatedSearchRoot,
    autoCreatedSearchValue
  };
}

function sanitizeScenarioStem(rawName) {
  return String(rawName || '')
    .trim()
    .replace(/\.biq$/i, '')
    .trim();
}

function validateSimpleFolderName(stem, label = 'Name') {
  const labelText = String(label || 'Name');
  if (!stem) return `${labelText} is required.`;
  if (/^\.+$/.test(stem)) return `${labelText} cannot be only dots.`;
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(stem)) {
    return `${labelText} contains invalid filename characters.`;
  }
  return '';
}

function validateScenarioStem(stem) {
  return validateSimpleFolderName(stem, 'Scenario name');
}

function makeUniqueTempScenarioDir(parentDir, scenarioStem) {
  const safeStem = scenarioStem.replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 36) || 'scenario';
  for (let i = 0; i < 40; i += 1) {
    const candidate = path.join(
      parentDir,
      `.c3x-new-scenario-${safeStem}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${i}`
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function reportOperationProgress(onProgress, entry) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(entry);
  } catch (_err) {
    // Ignore renderer progress failures; core work should continue.
  }
}

function copyFileWithParents(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectoryFilesTracked(sourceDir, targetDir, tracker, metadata = {}) {
  const files = listFilesRecursive(sourceDir);
  files.forEach((sourcePath) => {
    const relativePath = path.relative(sourceDir, sourcePath);
    const targetPath = path.join(targetDir, relativePath);
    tracker.copyFile(sourcePath, targetPath, metadata);
  });
  return files.length;
}

function createCopyProgressTracker({ onProgress, total, kind }) {
  let completed = 0;
  return {
    copyFile(sourcePath, targetPath, metadata = {}) {
      reportOperationProgress(onProgress, {
        stage: 'item-start',
        total,
        completed,
        kind: metadata.kind || kind || '',
        path: targetPath,
        label: metadata.itemLabel || `Copying ${path.basename(targetPath)}...`
      });
      copyFileWithParents(sourcePath, targetPath);
      completed += 1;
      reportOperationProgress(onProgress, {
        stage: 'item-complete',
        total,
        completed,
        kind: metadata.kind || kind || '',
        path: targetPath,
        label: metadata.itemLabel || `Copied ${path.basename(targetPath)}`
      });
    },
    completeStep(step) {
      completed += 1;
      reportOperationProgress(onProgress, {
        stage: 'item-complete',
        total,
        completed,
        kind: step.kind || kind || '',
        path: step.path || '',
        label: step.label || ''
      });
    },
    startStep(step) {
      reportOperationProgress(onProgress, {
        stage: 'item-start',
        total,
        completed,
        kind: step.kind || kind || '',
        path: step.path || '',
        label: step.label || ''
      });
    }
  };
}

function buildBaseScenarioPlannedFiles({ copyPlan, parentDir, scenarioDir }) {
  return copyPlan.map((entry) => ({
    kind: String(entry && entry.kind || ''),
    sourcePath: String(entry && entry.from || ''),
    targetPath: entry && entry.toParentDir
      ? path.join(parentDir, entry.relTo)
      : path.join(scenarioDir, entry.relTo)
  }));
}

function fileExists(pathValue) {
  return !!(pathValue && fs.existsSync(pathValue) && fs.statSync(pathValue).isFile());
}

function buildCopiedScenarioPlannedFiles({
  sourceScenarioPath,
  sourceScenarioDir,
  sourceContentRoot,
  sourceSearchRoots,
  scenarioDir,
  scenarioBiqPath,
  localizedSearchFolderStem
}) {
  const files = [];
  const byTargetPath = new Map();
  const addFile = (kind, sourcePath, targetPath) => {
    const targetText = String(targetPath || '').trim();
    if (!targetText) return;
    byTargetPath.set(targetText, {
      kind: String(kind || ''),
      sourcePath: String(sourcePath || ''),
      targetPath: targetText
    });
  };
  const sourceBiqResolved = path.resolve(String(sourceScenarioPath || ''));
  const contentRootResolved = sourceContentRoot ? path.resolve(sourceContentRoot) : '';
  const scenarioDirResolved = sourceScenarioDir ? path.resolve(sourceScenarioDir) : '';
  if (contentRootResolved && contentRootResolved === scenarioDirResolved) {
    listFilesRecursive(sourceScenarioDir).forEach((sourcePath) => {
      if (path.resolve(sourcePath) === sourceBiqResolved) return;
      addFile('scenario', sourcePath, path.join(scenarioDir, path.relative(sourceScenarioDir, sourcePath)));
    });
  } else if (sourceContentRoot) {
    listFilesRecursive(sourceContentRoot).forEach((sourcePath) => {
      addFile('scenarioContent', sourcePath, path.join(scenarioDir, path.relative(sourceContentRoot, sourcePath)));
    });
  }
  addFile('biq', sourceScenarioPath, scenarioBiqPath);
  const usedSearchRoots = new Set();
  const localizedRootParent = path.join(scenarioDir, localizedSearchFolderStem);
  dedupePathList(sourceSearchRoots)
    .filter((root) => !contentRootResolved || path.resolve(root) !== contentRootResolved)
    .forEach((sourceRoot, idx) => {
      const safeTailBase = path.basename(sourceRoot)
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || `search_${idx + 1}`;
      let safeTail = safeTailBase;
      let suffix = 2;
      while (usedSearchRoots.has(safeTail)) {
        safeTail = `${safeTailBase}_${suffix}`;
        suffix += 1;
      }
      usedSearchRoots.add(safeTail);
      const targetRoot = path.join(localizedRootParent, safeTail);
      listFilesRecursive(sourceRoot).forEach((sourcePath) => {
        addFile('searchRoot', sourcePath, path.join(targetRoot, path.relative(sourceRoot, sourcePath)));
      });
    });
  byTargetPath.forEach((entry) => files.push(entry));
  return files;
}

function createScenario(payload = {}, options = {}) {
  try {
    const onProgress = options && options.onProgress;
    const template = String(payload.template || 'base').trim().toLowerCase() === 'copy' ? 'copy' : 'base';
    const scenarioStem = sanitizeScenarioStem(payload.scenarioName);
    log.info('createScenario', `template=${template}, name="${scenarioStem}"`);
    const stemErr = validateScenarioStem(scenarioStem);
    if (stemErr) {
      log.warn('createScenario', `Validation error: ${stemErr}`);
      return { ok: false, error: stemErr };
    }

    const c3xPath = String(payload.c3xPath || '').trim();
    const civ3Root = resolveCiv3RootPath(String(payload.civ3Path || '').trim());
    const includeBaseText = payload.includeBaseText !== false;
    const includeC3xDefaults = payload.includeC3xDefaults !== false;
    const dryRun = payload.dryRun === true;
    const requestedParent = String(payload.scenarioParentDir || '').trim();
    const requestedSearchFolderName = sanitizeScenarioStem(payload.scenarioSearchFolderName || '');
    const defaultParent = civ3Root ? path.join(civ3Root, 'Conquests', 'Scenarios') : '';
    if (!requestedParent && !defaultParent) {
      return { ok: false, error: 'Civilization 3 path is required.' };
    }
    if (template === 'base') {
      if (!civ3Root) return { ok: false, error: 'Civilization 3 path is required.' };
      if (!fs.existsSync(civ3Root) || !fs.statSync(civ3Root).isDirectory()) {
        return { ok: false, error: 'Civilization 3 path does not exist or is not a directory.' };
      }
    }

    const parentDir = path.resolve(requestedParent || defaultParent);
    const baseScenarioFolderStem = template === 'base' ? (requestedSearchFolderName || scenarioStem) : '';
    if (template === 'base') {
      const searchFolderErr = validateSimpleFolderName(baseScenarioFolderStem, 'Scenario folder name');
      if (searchFolderErr) return { ok: false, error: searchFolderErr };
    }
    const scenarioDir = path.join(parentDir, template === 'base' ? baseScenarioFolderStem : scenarioStem);
    const scenarioBiqPath = path.join(parentDir, `${scenarioStem}.biq`);

    if (fs.existsSync(scenarioDir)) {
      return { ok: false, error: `Scenario folder already exists: ${scenarioDir}` };
    }

    const copyPlan = [];
    let sourceScenarioPath = '';
    let sourceScenarioDir = '';
    let sourceBiqTab = null;
    let sourceSearchRoots = [];
    let sourceSearchField = null;
    let localizedSearchFolderStem = '';
    if (template === 'copy') {
      localizedSearchFolderStem = requestedSearchFolderName || scenarioStem;
      const searchFolderErr = validateSimpleFolderName(localizedSearchFolderStem, 'Localized search folder name');
      if (searchFolderErr) return { ok: false, error: searchFolderErr };
      sourceScenarioPath = String(payload.sourceScenarioPath || '').trim();
      if (!sourceScenarioPath) return { ok: false, error: 'Source scenario .biq file is required for copy template.' };
      if (!/\.biq$/i.test(sourceScenarioPath)) return { ok: false, error: 'Source scenario must be a .biq file.' };
      if (!fs.existsSync(sourceScenarioPath) || !fs.statSync(sourceScenarioPath).isFile()) {
        return { ok: false, error: `Source scenario BIQ was not found: ${sourceScenarioPath}` };
      }
      sourceScenarioDir = resolveScenarioDir(sourceScenarioPath);
      if (!sourceScenarioDir || !fs.existsSync(sourceScenarioDir) || !fs.statSync(sourceScenarioDir).isDirectory()) {
        return { ok: false, error: `Source scenario folder was not found: ${sourceScenarioDir || '(empty)'}` };
      }
      sourceBiqTab = loadBiqTab({
        mode: 'scenario',
        civ3Path: civ3Root,
        scenarioPath: sourceScenarioPath
      });
      const sourceScenarioContext = deriveScenarioPathContext({
        scenarioPath: sourceScenarioPath,
        civ3Path: civ3Root,
        biqTab: sourceBiqTab
      });
      sourceSearchRoots = sourceScenarioContext.searchRoots;
      sourceSearchField = getScenarioSearchFieldMeta(sourceBiqTab);
    } else {
      copyPlan.push({
        kind: 'biq',
        from: path.join(civ3Root, 'Conquests', 'conquests.biq'),
        relTo: `${scenarioStem}.biq`,
        toParentDir: true,
        required: true
      });

      if (includeBaseText) {
        ['Civilopedia.txt', 'PediaIcons.txt', 'diplomacy.txt'].forEach((name) => {
          copyPlan.push({
            kind: 'text',
            from: path.join(civ3Root, 'Conquests', 'Text', name),
            relTo: path.join('Text', name),
            required: true
          });
        });
      }

      if (includeC3xDefaults) {
        if (!c3xPath) return { ok: false, error: 'C3X path is required to copy default C3X config files.' };
        if (!fs.existsSync(c3xPath) || !fs.statSync(c3xPath).isDirectory()) {
          return { ok: false, error: 'C3X path does not exist or is not a directory.' };
        }
        Object.values(FILE_SPECS).forEach((spec) => {
          copyPlan.push({
            kind: 'c3x',
            from: path.join(c3xPath, spec.defaultName),
            relTo: spec.scenarioName,
            required: spec.createScenarioOptional !== true
          });
        });
      }
    }

    if (copyPlan.length > 0) {
      const missing = copyPlan.find((entry) => entry.required !== false && !fileExists(entry.from));
      if (missing) {
        return { ok: false, error: `Missing required source file for new scenario: ${missing.from}` };
      }
    }
    const executableCopyPlan = copyPlan.filter((entry) => fileExists(entry.from));

    const scenarioAudit = {
      template,
      scenarioName: scenarioStem,
      parentDir,
      scenarioDir,
      scenarioBiqPath,
      scenarioWriteRoots: dedupePathList([scenarioDir]),
      sourceScenarioPath,
      sourceScenarioDir,
      sourceSearchRoots: dedupePathList(sourceSearchRoots)
    };
    let plannedFiles = [];
    if (template === 'copy') {
      const sourceScenarioContext = deriveScenarioPathContext({
        scenarioPath: sourceScenarioPath,
        civ3Path: civ3Root,
        biqTab: sourceBiqTab
      });
      plannedFiles = buildCopiedScenarioPlannedFiles({
        sourceScenarioPath,
        sourceScenarioDir,
        sourceContentRoot: sourceScenarioContext.contentWriteRoot || '',
        sourceSearchRoots,
        scenarioDir,
        scenarioBiqPath,
        localizedSearchFolderStem
      });
    } else {
      plannedFiles = buildBaseScenarioPlannedFiles({
        copyPlan: executableCopyPlan,
        parentDir,
        scenarioDir
      });
    }
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        plannedFiles,
        ...scenarioAudit
      };
    }

    fs.mkdirSync(parentDir, { recursive: true });
    const tempDir = makeUniqueTempScenarioDir(parentDir, scenarioStem);
    if (!tempDir) return { ok: false, error: 'Could not allocate a temporary folder for scenario creation.' };

    const copiedFiles = [];
    let tempCreated = false;
    try {
      if (template === 'copy') {
        const sourceScenarioContext = deriveScenarioPathContext({
          scenarioPath: sourceScenarioPath,
          civ3Path: civ3Root,
          biqTab: sourceBiqTab
        });
        const sourceContentRoot = sourceScenarioContext.contentWriteRoot || '';
        reportOperationProgress(onProgress, {
          stage: 'scan',
          completed: 0,
          total: 0,
          label: 'Scanning scenario files...'
        });
        const externalRoots = dedupePathList(sourceSearchRoots)
          .filter((root) => !sourceContentRoot || path.resolve(root) !== path.resolve(sourceContentRoot));
        const copyWork = [];
        if (sourceContentRoot && path.resolve(sourceContentRoot) === path.resolve(sourceScenarioDir)) {
          copyWork.push({ sourceDir: sourceScenarioDir, targetDir: tempDir, kind: 'scenario', label: 'Copying scenario files...' });
        } else if (sourceContentRoot) {
          copyWork.push({ sourceDir: sourceContentRoot, targetDir: tempDir, kind: 'scenarioContent', label: 'Copying scenario content files...' });
        }
        const localizedSearchRootParent = path.join(tempDir, localizedSearchFolderStem);
        const copiedSearchRootMap = new Map();
        if (sourceContentRoot) copiedSearchRootMap.set(path.resolve(sourceContentRoot), path.resolve(tempDir));
        externalRoots.forEach((sourceRoot, idx) => {
          const safeTail = path.basename(sourceRoot)
            .replace(/[^A-Za-z0-9._-]/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 48) || `search_${idx + 1}`;
          let destRoot = path.join(localizedSearchRootParent, safeTail);
          let suffix = 2;
          while (fs.existsSync(destRoot)) {
            destRoot = path.join(localizedSearchRootParent, `${safeTail}_${suffix}`);
            suffix += 1;
          }
          copiedSearchRootMap.set(path.resolve(sourceRoot), path.resolve(destRoot));
          copyWork.push({ sourceDir: sourceRoot, targetDir: destRoot, kind: 'searchRoot', label: `Copying search root ${path.basename(sourceRoot)}...` });
        });
        const totalCopyFiles = copyWork.reduce((sum, entry) => sum + listFilesRecursive(entry.sourceDir).length, 0);
        const totalSteps = totalCopyFiles + 1;
        reportOperationProgress(onProgress, {
          stage: 'start',
          completed: 0,
          total: totalSteps,
          label: totalCopyFiles > 0 ? `Copying ${totalCopyFiles} file${totalCopyFiles === 1 ? '' : 's'}...` : 'Preparing scenario copy...'
        });
        fs.mkdirSync(tempDir, { recursive: true });
        tempCreated = true;
        const tracker = createCopyProgressTracker({ onProgress, total: totalSteps, kind: 'scenario' });
        copyWork.forEach((entry) => {
          copyDirectoryFilesTracked(entry.sourceDir, entry.targetDir, tracker, {
            kind: entry.kind,
            label: entry.label
          });
          copiedFiles.push({
            kind: entry.kind,
            from: entry.sourceDir,
            to: entry.targetDir === tempDir ? scenarioDir : path.join(scenarioDir, path.relative(tempDir, entry.targetDir))
          });
        });
        const sourceBiqInTemp = path.join(tempDir, path.basename(sourceScenarioPath));
        const targetBiqInTemp = scenarioBiqPath;
        if (path.normalize(sourceBiqInTemp) !== path.normalize(targetBiqInTemp)) {
          tracker.startStep({
            kind: 'biq',
            path: targetBiqInTemp,
            label: `Updating ${path.basename(targetBiqInTemp)}...`
          });
          if (fs.existsSync(sourceBiqInTemp)) {
            fs.renameSync(sourceBiqInTemp, targetBiqInTemp);
          } else {
            copyFileWithParents(sourceScenarioPath, targetBiqInTemp);
          }
          fs.chmodSync(targetBiqInTemp, 0o644);
          tracker.completeStep({
            kind: 'biq',
            path: targetBiqInTemp,
            label: `Updated ${path.basename(targetBiqInTemp)}`
          });
        } else {
          tracker.startStep({
            kind: 'biq',
            path: targetBiqInTemp,
            label: `Updating ${path.basename(targetBiqInTemp)}...`
          });
          fs.chmodSync(targetBiqInTemp, 0o644);
          tracker.completeStep({
            kind: 'biq',
            path: targetBiqInTemp,
            label: `Updated ${path.basename(targetBiqInTemp)}`
          });
        }
        if (sourceSearchField && sourceSearchField.fieldKey) {
          const rewrittenFolders = [scenarioStem];
          dedupePathList(sourceSearchRoots).forEach((sourceRoot) => {
            const srcResolved = path.resolve(sourceRoot);
            const mapped = copiedSearchRootMap.get(srcResolved);
            if (!mapped || path.resolve(mapped) === path.resolve(tempDir)) return;
            const rel = path.relative(parentDir, path.join(scenarioDir, path.relative(tempDir, mapped))).replace(/\\/g, '/').trim();
            if (rel && !rewrittenFolders.includes(rel)) rewrittenFolders.push(rel);
          });
          const rewrittenValue = rewrittenFolders.join('; ');
          const biqRewrite = applyBiqReferenceEdits({
            biqPath: targetBiqInTemp,
            edits: [{
              sectionCode: 'GAME',
              recordRef: '@INDEX:0',
              fieldKey: sourceSearchField.fieldKey,
              value: rewrittenValue
            }],
            civ3Path: civ3Root,
            outputPath: targetBiqInTemp
          });
          if (!biqRewrite.ok) {
            throw new Error(biqRewrite.error || 'Failed to rewrite copied scenario search folders in BIQ.');
          }
        }
      } else {
        const totalSteps = executableCopyPlan.length + 1;
        reportOperationProgress(onProgress, {
          stage: 'start',
          completed: 0,
          total: totalSteps,
          label: `Creating ${executableCopyPlan.length} file${executableCopyPlan.length === 1 ? '' : 's'}...`
        });
        fs.mkdirSync(tempDir, { recursive: true });
        tempCreated = true;
        const tracker = createCopyProgressTracker({ onProgress, total: totalSteps, kind: 'text' });
        executableCopyPlan.forEach((entry) => {
          const destPath = entry.toParentDir
            ? path.join(parentDir, entry.relTo)
            : path.join(tempDir, entry.relTo);
          tracker.copyFile(entry.from, destPath, {
            kind: entry.kind,
            label: `Copying ${path.basename(destPath)}...`
          });
          if (entry.kind === 'biq') fs.chmodSync(destPath, 0o644);
          copiedFiles.push({
            kind: entry.kind,
            from: entry.from,
            to: entry.toParentDir ? path.join(parentDir, entry.relTo) : path.join(scenarioDir, entry.relTo)
          });
        });
        const baseBiqTab = loadBiqTab({ mode: 'scenario', civ3Path: civ3Root, scenarioPath: scenarioBiqPath });
        const baseSearchField = getScenarioSearchFieldMeta(baseBiqTab);
        if (baseSearchField && baseSearchField.fieldKey) {
          tracker.startStep({
            kind: 'biq',
            path: scenarioBiqPath,
            label: `Updating ${path.basename(scenarioBiqPath)}...`
          });
          const biqRewrite = applyBiqReferenceEdits({
            biqPath: scenarioBiqPath,
            edits: [{
              sectionCode: 'GAME',
              recordRef: '@INDEX:0',
              fieldKey: baseSearchField.fieldKey,
              value: baseScenarioFolderStem
            }],
            civ3Path: civ3Root,
            outputPath: scenarioBiqPath
          });
          if (!biqRewrite.ok) {
            throw new Error(biqRewrite.error || 'Failed to write scenario search folder into BIQ.');
          }
          tracker.completeStep({
            kind: 'biq',
            path: scenarioBiqPath,
            label: `Updated ${path.basename(scenarioBiqPath)}`
          });
        } else {
          tracker.completeStep({
            kind: 'biq',
            path: scenarioBiqPath,
            label: `Prepared ${path.basename(scenarioBiqPath)}`
          });
        }
      }
      fs.renameSync(tempDir, scenarioDir);
      tempCreated = false;
    } catch (err) {
      if (tempCreated) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (_cleanupErr) {
          // best effort cleanup
        }
      }
      return { ok: false, error: `Failed to create scenario: ${err.message}` };
    }

    log.info('createScenario', `Created OK: biq=${log.rel(scenarioBiqPath)}, files=${copiedFiles.length}`);
    return {
      ok: true,
      template,
      scenarioName: scenarioStem,
      scenarioDir,
      scenarioBiqPath,
      scenarioWriteRoots: dedupePathList([scenarioDir]),
      copiedFiles
    };
  } catch (err) {
    log.error('createScenario', `Threw: ${err.message}`);
    return { ok: false, error: `Failed to create scenario: ${err.message}` };
  }
}

function buildScenarioDeletePlan(payload = {}) {
  const civ3Path = resolveCiv3RootPath(String(payload.civ3Path || '').trim());
  const scenarioPath = String(payload.scenarioPath || '').trim();
  if (!scenarioPath) return { ok: false, error: 'Scenario path is required.' };
  if (!/\.biq$/i.test(scenarioPath)) return { ok: false, error: 'Scenario path must point to a .biq file.' };
  if (!fs.existsSync(scenarioPath) || !fs.statSync(scenarioPath).isFile()) {
    return { ok: false, error: `Scenario BIQ was not found: ${scenarioPath}` };
  }
  if (isProtectedBaseCiv3Path(civ3Path, scenarioPath)) {
    return { ok: false, error: 'Refusing to delete the base game BIQ.' };
  }

  const biqTab = loadBiqTab({ mode: 'scenario', civ3Path, scenarioPath });
  const scenarioContext = deriveScenarioPathContext({ scenarioPath, civ3Path, biqTab });
  const scenarioName = getScenarioStemFromPath(scenarioPath) || sanitizeScenarioStem(path.basename(scenarioPath));
  const biqRoot = String(scenarioContext.biqRoot || '').trim();
  const contentWriteRoot = String(scenarioContext.contentWriteRoot || '').trim();
  const searchRoots = dedupePathList(scenarioContext.searchRoots || []);
  const writableRoots = dedupePathList(scenarioContext.writableRoots || []);
  const sharedScenariosRoot = isSharedScenariosRootDir(biqRoot, civ3Path);
  const deletions = [];
  const retainedPaths = [];
  const warnings = [];
  const seen = new Set();
  const scenarioStemKey = String(scenarioName || '').trim().toLowerCase();

  const addDeletion = (targetPath, kind, reason = '') => {
    const target = String(targetPath || '').trim();
    if (!target || !fs.existsSync(target)) return;
    if (!isPathWithinAnyRoot(target, writableRoots)) return;
    const resolved = path.resolve(target);
    const key = normalizePathLike(resolved).toLowerCase();
    if (seen.has(key)) return;
    if (isProtectedBaseCiv3Path(civ3Path, resolved)) return;
    if (civ3Path && normalizePathForCompare(resolved) === normalizePathForCompare(civ3Path)) return;
    if (biqRoot && normalizePathForCompare(resolved) === normalizePathForCompare(path.join(civ3Path, 'Conquests'))) return;
    if (sharedScenariosRoot && biqRoot && normalizePathForCompare(resolved) === normalizePathForCompare(biqRoot)) return;
    seen.add(key);
    deletions.push({
      path: resolved,
      kind: String(kind || ''),
      reason: String(reason || ''),
      isDirectory: fs.statSync(resolved).isDirectory()
    });
  };

  if (!sharedScenariosRoot && biqRoot) {
    addDeletion(biqRoot, 'scenarioDir', 'Scenario folder');
  } else {
    addDeletion(scenarioPath, 'biq', 'Scenario BIQ');
    const contentIsOwnedFolder = contentWriteRoot
      && contentWriteRoot !== biqRoot
      && isPathWithinRoot(contentWriteRoot, biqRoot)
      && (
        path.basename(contentWriteRoot).trim().toLowerCase() === scenarioStemKey
        || searchRoots.length === 1
      );
    if (contentIsOwnedFolder) {
      addDeletion(contentWriteRoot, 'scenarioContent', 'Scenario content folder');
    }
    searchRoots.forEach((root) => {
      const resolved = path.resolve(root);
      if (!resolved || (contentWriteRoot && normalizePathForCompare(resolved) === normalizePathForCompare(contentWriteRoot))) return;
      if (!isPathWithinRoot(resolved, biqRoot)) {
        retainedPaths.push(resolved);
        return;
      }
      const looksOwned = path.basename(resolved).trim().toLowerCase() === scenarioStemKey;
      if (looksOwned) {
        addDeletion(resolved, 'searchRoot', 'Scenario search folder');
      } else {
        retainedPaths.push(resolved);
      }
    });
  }

  const deletablePaths = deletions.map((entry) => entry.path);
  if (deletablePaths.length === 0) {
    return { ok: false, error: 'Could not determine any safe scenario paths to delete.' };
  }
  retainedPaths.forEach((retained) => {
    warnings.push(`Retaining search root outside conservative delete scope: ${retained}`);
  });
  return {
    ok: true,
    scenarioName,
    deletions,
    retainedPaths,
    warnings
  };
}

function copyDeleteBackupSync(sourcePath, backupPath) {
  const stat = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, backupPath, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  } else {
    fs.copyFileSync(sourcePath, backupPath, fs.constants.COPYFILE_EXCL);
  }
}

function buildDeleteBackupPath(targetPath) {
  const parent = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const suffix = crypto.randomBytes(6).toString('hex');
  return path.join(parent, `.${base}.c3x-delete-backup-${suffix}`);
}

function deleteScenario(payload = {}, options = {}) {
  try {
    const dryRun = payload && payload.dryRun === true;
    const onProgress = options && options.onProgress;
    const plan = buildScenarioDeletePlan(payload);
    if (!plan.ok) return plan;
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        scenarioName: plan.scenarioName,
        plannedDeletes: plan.deletions,
        retainedPaths: plan.retainedPaths,
        warnings: plan.warnings
      };
    }

    const total = plan.deletions.length * 2;
    const deleteResults = [];
    const backups = [];
    let completed = 0;
    reportOperationProgress(onProgress, {
      stage: 'start',
      completed,
      total,
      label: `Preparing to delete ${plan.deletions.length} item${plan.deletions.length === 1 ? '' : 's'}...`
    });

    for (const entry of plan.deletions) {
      const backupPath = buildDeleteBackupPath(entry.path);
      reportOperationProgress(onProgress, {
        stage: 'item-start',
        completed,
        total,
        kind: entry.kind,
        path: entry.path,
        label: `Backing up ${path.basename(entry.path)}...`
      });
      copyDeleteBackupSync(entry.path, backupPath);
      backups.push({ ...entry, backupPath });
      completed += 1;
      reportOperationProgress(onProgress, {
        stage: 'item-complete',
        completed,
        total,
        kind: entry.kind,
        path: entry.path,
        label: `Backed up ${path.basename(entry.path)}`
      });
    }

    try {
      for (const entry of plan.deletions) {
        reportOperationProgress(onProgress, {
          stage: 'item-start',
          completed,
          total,
          kind: entry.kind,
          path: entry.path,
          label: `Deleting ${path.basename(entry.path)}...`
        });
        fs.rmSync(entry.path, { recursive: true, force: false });
        deleteResults.push({
          path: entry.path,
          kind: entry.kind,
          status: 'deleted'
        });
        completed += 1;
        reportOperationProgress(onProgress, {
          stage: 'item-complete',
          completed,
          total,
          kind: entry.kind,
          path: entry.path,
          label: `Deleted ${path.basename(entry.path)}`
        });
      }
    } catch (err) {
      const rollbackResults = [];
      const rollbackErrors = [];
      for (let idx = backups.length - 1; idx >= 0; idx -= 1) {
        const entry = backups[idx];
        try {
          reportOperationProgress(onProgress, {
            stage: 'rollback-item',
            completed: backups.length - idx - 1,
            total: backups.length,
            kind: entry.kind,
            path: entry.path,
            label: `Restoring ${path.basename(entry.path)}...`
          });
          if (fs.existsSync(entry.path)) {
            fs.rmSync(entry.path, { recursive: true, force: true });
          }
          if (fs.existsSync(entry.backupPath)) {
            fs.renameSync(entry.backupPath, entry.path);
          }
          rollbackResults.push({
            path: entry.path,
            action: 'restore',
            status: 'rolledBack'
          });
        } catch (rollbackErr) {
          rollbackErrors.push(`${entry.path}: ${rollbackErr.message}`);
          rollbackResults.push({
            path: entry.path,
            action: 'restore',
            status: 'rollbackFailed',
            error: rollbackErr && rollbackErr.message ? String(rollbackErr.message) : 'unknown error'
          });
        }
      }
      return {
        ok: false,
        error: `Failed to delete scenario: ${err.message}`,
        scenarioName: plan.scenarioName,
        deleteResults,
        retainedPaths: plan.retainedPaths,
        warnings: plan.warnings,
        rollback: {
          attempted: rollbackResults.length,
          failed: rollbackResults.filter((entry) => entry.status === 'rollbackFailed').length,
          results: rollbackResults
        },
        cleanupWarnings: rollbackErrors
      };
    }

    const cleanupWarnings = [];
    backups.forEach((entry) => {
      try {
        fs.rmSync(entry.backupPath, { recursive: true, force: true });
      } catch (err) {
        cleanupWarnings.push(`Could not remove delete backup ${entry.backupPath}: ${err.message}`);
      }
    });
    return {
      ok: true,
      scenarioName: plan.scenarioName,
      deleteResults,
      retainedPaths: plan.retainedPaths,
      warnings: plan.warnings,
      cleanupWarnings
    };
  } catch (err) {
    log.error('deleteScenario', `Threw: ${err.message}`);
    return { ok: false, error: `Failed to delete scenario: ${err.message}` };
  }
}

function normalizePathForCompare(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function getProtectedBaseCiv3Paths(civ3Path) {
  const root = resolveCiv3RootPath(civ3Path);
  if (!root) return new Set();
  const out = new Set();
  const coreTextBases = [
    path.join(root, 'Text'),
    path.join(root, 'civ3PTW', 'Text'),
    path.join(root, 'Conquests', 'Text')
  ];
  ['Civilopedia.txt', 'PediaIcons.txt', 'diplomacy.txt'].forEach((name) => {
    coreTextBases.forEach((base) => out.add(normalizePathForCompare(path.join(base, name))));
  });
  [
    path.join(root, 'Art', 'resources.pcx'),
    path.join(root, 'Conquests', 'Art', 'resources.pcx'),
    path.join(root, 'civ3PTW', 'Art', 'resources.pcx'),
    path.join(root, 'Art', 'Units', 'units_32.pcx'),
    path.join(root, 'Conquests', 'Art', 'Units', 'units_32.pcx'),
    path.join(root, 'civ3PTW', 'Art', 'Units', 'units_32.pcx')
  ].forEach((candidate) => out.add(normalizePathForCompare(candidate)));
  out.add(normalizePathForCompare(path.join(root, 'Conquests', 'conquests.biq')));
  return out;
}

function isProtectedBaseCiv3Path(civ3Path, targetPath) {
  if (!targetPath) return false;
  const normalized = normalizePathForCompare(path.resolve(String(targetPath)));
  return getProtectedBaseCiv3Paths(civ3Path).has(normalized);
}

function isProtectedC3xDefaultPath(c3xPath, targetPath) {
  const c3xRoot = String(c3xPath || '').trim();
  const target = String(targetPath || '').trim();
  if (!c3xRoot || !target) return false;
  const resolvedRoot = normalizePathForCompare(path.resolve(c3xRoot));
  const resolvedTarget = normalizePathForCompare(path.resolve(target));
  if (!resolvedTarget.startsWith(`${resolvedRoot}/`) && resolvedTarget !== resolvedRoot) return false;
  const fileName = path.basename(target).toLowerCase();
  return fileName.startsWith('default.');
}

function getTextLayerFiles(civ3Path, name) {
  const root = resolveCiv3RootPath(civ3Path);
  if (!root) {
    return [];
  }
  return [
    { layer: 'vanilla', filePath: path.join(root, 'Text', name) },
    { layer: 'ptw', filePath: path.join(root, 'civ3PTW', 'Text', name) },
    { layer: 'conquests', filePath: path.join(root, 'Conquests', 'Text', name) }
  ];
}

function resolveScenarioTextPath(scenarioPath, name, scenarioPaths = []) {
  const roots = [];
  const seen = new Set();
  const addRoot = (root) => {
    const normalized = String(root || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    roots.push(normalized);
  };
  addRoot(resolveScenarioDir(scenarioPath));
  (scenarioPaths || []).forEach((p) => addRoot(p));

  const candidates = [];
  roots.forEach((root) => {
    candidates.push(path.join(root, 'Text', name));
    candidates.push(path.join(root, name));
  });
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function stripScenarioDistrictValueQuotes(value) {
  const text = String(value == null ? '' : value).trim();
  if (text.length >= 2) {
    const first = text.charAt(0);
    const last = text.charAt(text.length - 1);
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return text.slice(1, -1).trim();
    }
  }
  return text;
}

function parseScenarioDistrictCoordinates(value) {
  const parts = String(value || '').split(',').map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return { x: parts[0], y: parts[1] };
}

function quoteScenarioDistrictValue(value) {
  const text = String(value == null ? '' : value).trim().slice(0, 99);
  if (!text) return '';
  if (/^[A-Za-z0-9_. -]+$/.test(text) && !/^\s|\s$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function parseScenarioDistrictsText(text) {
  const entries = [];
  const namedTiles = [];
  const issues = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    const coords = parseScenarioDistrictCoordinates(current.fields.coordinates);
    if (!coords) {
      issues.push(`${current.type} section missing valid coordinates.`);
      current = null;
      return;
    }
    if (current.type === 'district') {
      const district = stripScenarioDistrictValueQuotes(current.fields.district);
      if (!district) {
        issues.push(`District section at ${coords.x},${coords.y} is missing district.`);
      } else {
        entries.push({
          x: coords.x,
          y: coords.y,
          district,
          wonderName: stripScenarioDistrictValueQuotes(current.fields.wonder_name),
          wonderCity: stripScenarioDistrictValueQuotes(current.fields.wonder_city)
        });
      }
    } else if (current.type === 'namedTile') {
      const name = stripScenarioDistrictValueQuotes(current.fields.name);
      if (!name) {
        issues.push(`NamedTile section at ${coords.x},${coords.y} is missing name.`);
      } else {
        namedTiles.push({ x: coords.x, y: coords.y, name: name.slice(0, 99) });
      }
    }
    current = null;
  };

  String(text || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('[')) return;
    if (trimmed === 'DISTRICTS') return;
    if (trimmed === '#District' || trimmed === '#NamedTile') {
      finish();
      current = { type: trimmed === '#District' ? 'district' : 'namedTile', fields: {} };
      return;
    }
    if (!current) return;
    const match = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!match) return;
    const key = String(match[1] || '').trim().toLowerCase();
    const value = String(match[2] || '').trim();
    current.fields[key] = value;
  });
  finish();
  return { entries, namedTiles, issues };
}

function serializeScenarioDistrictsText(model) {
  const entries = Array.isArray(model && model.entries) ? model.entries : [];
  const namedTiles = Array.isArray(model && model.namedTiles) ? model.namedTiles : [];
  const rows = ['DISTRICTS', ''];
  const sortable = [];
  entries.forEach((entry) => {
    const x = Number.parseInt(entry && entry.x, 10);
    const y = Number.parseInt(entry && entry.y, 10);
    const district = String(entry && entry.district || '').trim();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !district) return;
    sortable.push({ kind: 'district', x, y, entry });
  });
  namedTiles.forEach((entry) => {
    const x = Number.parseInt(entry && entry.x, 10);
    const y = Number.parseInt(entry && entry.y, 10);
    const name = String(entry && entry.name || '').trim();
    if (!Number.isFinite(x) || !Number.isFinite(y) || !name) return;
    sortable.push({ kind: 'namedTile', x, y, entry: { ...entry, name: name.slice(0, 99) } });
  });
  sortable.sort((a, b) => (a.y - b.y) || (a.x - b.x) || a.kind.localeCompare(b.kind));
  sortable.forEach((item) => {
    if (item.kind === 'district') {
      rows.push('#District');
      rows.push(`coordinates  = ${item.x},${item.y}`);
      rows.push(`district     = ${quoteScenarioDistrictValue(item.entry.district)}`);
      if (String(item.entry.wonderCity || '').trim()) rows.push(`wonder_city  = ${quoteScenarioDistrictValue(item.entry.wonderCity)}`);
      if (String(item.entry.wonderName || '').trim()) rows.push(`wonder_name  = ${quoteScenarioDistrictValue(item.entry.wonderName)}`);
      rows.push('');
      return;
    }
    rows.push('#NamedTile');
    rows.push(`coordinates  = ${item.x},${item.y}`);
    rows.push(`name         = ${quoteScenarioDistrictValue(item.entry.name)}`);
    rows.push('');
  });
  return ensureTrailingNewline(rows.join('\n'));
}

function loadScenarioDistrictsMetadata({ scenarioPath, scenarioPaths = [], targetRoot = '', preferredEncoding = DEFAULT_TEXT_FILE_ENCODING }) {
  const sourcePath = resolveScenarioTextPath(scenarioPath, 'scenario.districts.txt', scenarioPaths);
  const targetPath = path.join(targetRoot || resolveScenarioDir(scenarioPath), 'scenario.districts.txt');
  const info = readTextFileWithEncodingInfoIfExists(sourcePath, { preferredEncoding });
  const parsed = parseScenarioDistrictsText(info ? info.text : '');
  return {
    sourcePath,
    targetPath,
    encoding: (info && info.encoding) || '',
    bom: !!(info && info.bom),
    entries: parsed.entries,
    originalEntries: JSON.parse(JSON.stringify(parsed.entries)),
    namedTiles: parsed.namedTiles,
    originalNamedTiles: JSON.parse(JSON.stringify(parsed.namedTiles)),
    issues: parsed.issues
  };
}

function collectScenarioDistrictsEdit(tabs) {
  const mapTab = tabs && tabs.map;
  const meta = mapTab && mapTab.scenarioDistricts;
  if (!meta) return null;
  const mapMutation = String(mapTab && mapTab.mapMutation || '').trim().toLowerCase();
  const entries = Array.isArray(meta.entries) ? meta.entries : [];
  const namedTiles = Array.isArray(meta.namedTiles) ? meta.namedTiles : [];
  const beforeEntries = Array.isArray(meta.originalEntries) ? meta.originalEntries : [];
  const beforeNamedTiles = Array.isArray(meta.originalNamedTiles) ? meta.originalNamedTiles : [];
  const targetPath = String(meta.targetPath || '').trim();
  const sourcePath = String(meta.sourcePath || '').trim();
  const wholeMapReplacementSource = String(mapTab && mapTab.mapMutationSource || '').trim().toLowerCase();
  const clearsCoordinateSidecar = mapMutation === 'remove'
    || (mapMutation === 'set' && ['generated', 'imported', 'custom'].includes(wholeMapReplacementSource));
  if (clearsCoordinateSidecar) {
    const hadScenarioDistricts = entries.length > 0
      || namedTiles.length > 0
      || beforeEntries.length > 0
      || beforeNamedTiles.length > 0
      || (sourcePath && fs.existsSync(sourcePath))
      || (targetPath && fs.existsSync(targetPath));
    if (hadScenarioDistricts) {
      return {
        targetPath,
        sourcePath,
        encoding: String(meta.encoding || ''),
        bom: !!meta.bom,
        entries: [],
        namedTiles: [],
        cleared: true
      };
    }
  }
  const now = JSON.stringify({ entries, namedTiles });
  const before = JSON.stringify({ entries: beforeEntries, namedTiles: beforeNamedTiles });
  if (now === before) return null;
  return {
    targetPath,
    sourcePath,
    encoding: String(meta.encoding || ''),
    bom: !!meta.bom,
    entries,
    namedTiles
  };
}

function findMapSection(mapTab, code) {
  const target = String(code || '').trim().toUpperCase();
  return (Array.isArray(mapTab && mapTab.sections) ? mapTab.sections : [])
    .find((section) => String(section && section.code || '').trim().toUpperCase() === target) || null;
}

function setRecordDisplayField(record, key, value, label) {
  if (!record) return;
  if (!Array.isArray(record.fields)) record.fields = [];
  const canonical = canonicalFieldKey(key);
  let field = record.fields.find((entry) => canonicalFieldKey(entry && (entry.baseKey || entry.key)) === canonical);
  if (!field) {
    field = {
      key,
      baseKey: key,
      label: label || key,
      value: '',
      originalValue: ''
    };
    record.fields.push(field);
  }
  field.value = String(value == null ? '' : value);
  field.originalValue = String(value == null ? '' : value);
}

function getSectionFieldDisplayName(section, key, fallback = '') {
  const fields = Array.isArray(section && section.fields) ? section.fields : [];
  const field = fields.find((entry) => canonicalFieldKey(entry && entry.key) === canonicalFieldKey(key));
  return cleanDisplayText(field && field.value) || fallback;
}

function applyScenarioDistrictsToMapTab(mapTab, tabs) {
  const meta = mapTab && mapTab.scenarioDistricts;
  if (!meta) return;
  const tileSection = findMapSection(mapTab, 'TILE');
  const tiles = tileSection && Array.isArray(tileSection.records) ? tileSection.records : [];
  if (tiles.length === 0) return;
  const byCoord = new Map();
  tiles.forEach((record) => {
    const fields = Array.isArray(record && record.fields) ? record.fields : [];
    const xField = fields.find((field) => canonicalFieldKey(field && (field.baseKey || field.key)) === 'xpos');
    const yField = fields.find((field) => canonicalFieldKey(field && (field.baseKey || field.key)) === 'ypos');
    const x = Number.parseInt(String(xField && xField.value || ''), 10);
    const y = Number.parseInt(String(yField && yField.value || ''), 10);
    if (Number.isFinite(x) && Number.isFinite(y)) byCoord.set(`${x},${y}`, record);
  });
  const districtSections = ((((tabs && tabs.districts) || {}).model || {}).sections || []);
  const naturalSections = ((((tabs && tabs.naturalWonders) || {}).model || {}).sections || []);
  const districtIndexByName = new Map();
  districtSections.forEach((section, idx) => {
    const name = getSectionFieldDisplayName(section, 'name', `District ${idx + 1}`);
    if (name) districtIndexByName.set(name.toLowerCase(), idx);
  });
  const naturalIndexByName = new Map();
  naturalSections.forEach((section, idx) => {
    const name = getSectionFieldDisplayName(section, 'name', `Natural Wonder ${idx + 1}`);
    if (name) naturalIndexByName.set(name.toLowerCase(), idx);
  });
  (Array.isArray(meta.entries) ? meta.entries : []).forEach((entry) => {
    const tile = byCoord.get(`${Number(entry && entry.x)},${Number(entry && entry.y)}`);
    if (!tile) return;
    const districtName = String(entry && entry.district || '').trim();
    const districtIndex = districtIndexByName.has(districtName.toLowerCase()) ? districtIndexByName.get(districtName.toLowerCase()) : -1;
    if (districtIndex >= 0) setRecordDisplayField(tile, 'district', `${districtIndex},2`, 'District');
    setRecordDisplayField(tile, 'districtname', districtName, 'District Name');
    if (String(entry && entry.wonderName || '').trim()) {
      const wonderName = String(entry.wonderName || '').trim();
      const naturalIndex = naturalIndexByName.has(wonderName.toLowerCase()) ? naturalIndexByName.get(wonderName.toLowerCase()) : -1;
      setRecordDisplayField(tile, 'wondername', wonderName, 'Wonder Name');
      if (naturalIndex >= 0) setRecordDisplayField(tile, 'naturalwonder', String(naturalIndex), 'Natural Wonder');
    }
    if (String(entry && entry.wonderCity || '').trim()) {
      setRecordDisplayField(tile, 'wondercity', String(entry.wonderCity || '').trim(), 'Wonder City');
    }
  });
  (Array.isArray(meta.namedTiles) ? meta.namedTiles : []).forEach((entry) => {
    const tile = byCoord.get(`${Number(entry && entry.x)},${Number(entry && entry.y)}`);
    if (!tile) return;
    setRecordDisplayField(tile, 'namedtile', String(entry && entry.name || '').trim(), 'Named Tile');
  });
}

function readTextLayers(civ3Path, name, scenarioPath, scenarioPaths = [], options = {}) {
  const layers = {};
  for (const ref of getTextLayerFiles(civ3Path, name)) {
    const fileInfo = readTextFileWithEncodingInfoIfExists(ref.filePath, options);
    layers[ref.layer] = {
      filePath: ref.filePath,
      text: fileInfo ? fileInfo.text : null,
      encoding: fileInfo ? fileInfo.encoding : '',
      bom: !!(fileInfo && fileInfo.bom)
    };
  }
  if (scenarioPath || (scenarioPaths && scenarioPaths.length > 0)) {
    const scenarioTextPath = resolveScenarioTextPath(scenarioPath, name, scenarioPaths);
    if (scenarioTextPath) {
      const fileInfo = readTextFileWithEncodingInfoIfExists(scenarioTextPath, options);
      layers.scenario = {
        filePath: scenarioTextPath,
        text: fileInfo ? fileInfo.text : null,
        encoding: fileInfo ? fileInfo.encoding : '',
        bom: !!(fileInfo && fileInfo.bom)
      };
    }
  }
  return layers;
}

function pickHighestLayerText(layers, order = ['scenario', 'conquests', 'ptw', 'vanilla']) {
  for (const layerKey of order) {
    const layer = layers && layers[layerKey];
    if (layer && typeof layer.text === 'string' && layer.text.trim()) {
      return layer;
    }
  }
  return null;
}

function parseCivilopediaSections(text) {
  const sections = {};
  if (!text) return sections;

  const lines = text.split(/\r?\n/);
  let currentKey = null;
  let currentLines = [];
  const flush = () => {
    if (!currentKey) return;
    sections[currentKey] = {
      key: currentKey,
      rawLines: [...currentLines]
    };
  };

  for (const line of lines) {
    if (line.startsWith('#')) {
      flush();
      currentKey = line.slice(1).trim();
      currentLines = [];
      continue;
    }
    if (currentKey) {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

function parsePediaIconsBlocks(text) {
  const blocks = {};
  if (!text) return blocks;
  const lines = text.split(/\r?\n/);
  let currentKey = null;
  let currentLines = [];
  const flush = () => {
    if (!currentKey) return;
    blocks[currentKey] = [...currentLines];
  };

  for (const line of lines) {
    if (line.startsWith('#')) {
      flush();
      currentKey = line.slice(1).trim();
      currentLines = [];
      continue;
    }
    if (!currentKey) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    currentLines.push(trimmed);
  }
  flush();
  return blocks;
}

function parseDiplomacySectionSlotLines(text, sectionName) {
  const src = String(text || '');
  if (!src.trim()) return [];
  const lines = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const slots = [];
  let inSection = false;
  let civ = null;
  let power = null;
  let mood = null;
  let random = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = String(lines[i] || '');
    const trimmed = raw.trim();
    const upper = trimmed.toUpperCase();
    if (upper === `#${String(sectionName || '').toUpperCase()}`) {
      inSection = true;
      civ = null;
      power = null;
      mood = null;
      random = null;
      continue;
    }
    if (!inSection) continue;
    if (trimmed.startsWith('#') && !upper.startsWith('#CIV ') && !upper.startsWith('#POWER ') && !upper.startsWith('#MOOD ') && !upper.startsWith('#RANDOM ')) {
      break;
    }
    if (upper.startsWith('#CIV ')) {
      civ = Number.parseInt(upper.slice(5).trim(), 10);
      continue;
    }
    if (upper.startsWith('#POWER ')) {
      power = Number.parseInt(upper.slice(7).trim(), 10);
      continue;
    }
    if (upper.startsWith('#MOOD ')) {
      mood = Number.parseInt(upper.slice(6).trim(), 10);
      continue;
    }
    if (upper.startsWith('#RANDOM ')) {
      random = Number.parseInt(upper.slice(8).trim(), 10);
      continue;
    }
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    if (!(civ === 1 && power === 0 && mood === 0 && random === 1)) continue;
    let textLine = trimmed
      .replace(/^["“”„«»]+/, '')
      .replace(/["“”„«»]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!textLine) continue;
    slots.push(textLine);
  }
  return slots;
}

function parseDiplomacySlotOptions(text) {
  const firstContact = parseDiplomacySectionSlotLines(text, 'AIFIRSTCONTACT');
  const firstDeal = parseDiplomacySectionSlotLines(text, 'AIFIRSTDEAL');
  const count = Math.max(firstContact.length, firstDeal.length);
  const options = [];
  for (let i = 0; i < count; i += 1) {
    let contact = String(firstContact[i] || '').trim();
    let deal = String(firstDeal[i] || '').trim();
    if (contact.length > 90) contact = `${contact.slice(0, 87)}...`;
    if (deal.length > 90) deal = `${deal.slice(0, 87)}...`;
    const parts = [];
    if (contact) parts.push(`First contact: ${contact}`);
    if (deal) parts.push(`Trade intro: ${deal}`);
    const preview = parts.join(' | ');
    options.push({
      value: String(i),
      label: preview ? `Slot ${i} - ${preview}` : `Slot ${i}`
    });
  }
  return options;
}

const DIPLOMACY_EOF_SENTINEL = '; THIS LINE MUST REMAIN AT END OF FILE';

function normalizeDiplomacySentinelLine(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function isDiplomacyEofSentinelLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed;
  const normalized = normalizeDiplomacySentinelLine(withoutHash);
  if (!normalized) return false;
  const withSemicolon = normalizeDiplomacySentinelLine(DIPLOMACY_EOF_SENTINEL);
  const withoutSemicolon = normalizeDiplomacySentinelLine(DIPLOMACY_EOF_SENTINEL.replace(/^;\s*/, ''));
  return normalized === withSemicolon || normalized === withoutSemicolon;
}

function ensureDiplomacyEofSentinel(text) {
  const lines = String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => !isDiplomacyEofSentinelLine(line));
  while (lines.length > 0 && !String(lines[lines.length - 1] || '').trim()) lines.pop();
  lines.push(DIPLOMACY_EOF_SENTINEL);
  return ensureTrailingNewline(lines.join('\n'));
}

function normalizeDiplomacyDialogueLine(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoteDiplomacyDialogueLine(value) {
  const text = normalizeDiplomacyDialogueLine(value);
  if (!text) return '';
  return `"${text.replace(/"/g, '\\"')}"`;
}

function parseDiplomacyDocumentWithOrder(text) {
  const src = String(text || '');
  const doc = {
    preamble: [],
    sections: [],
    hadTrailingNewline: /\r\n$|\n$|\r$/.test(src)
  };
  if (!src) return doc;
  const lines = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let currentSection = null;
  lines.forEach((raw) => {
    const line = String(raw || '');
    const trimmed = line.trim();
    const isDirective = /^#(CIV|POWER|MOOD|RANDOM)\b/i.test(trimmed);
    const isSectionHeader = trimmed.startsWith('#') && !isDirective;
    if (isSectionHeader) {
      currentSection = {
        header: line,
        key: trimmed.slice(1).trim().toUpperCase(),
        lines: []
      };
      doc.sections.push(currentSection);
      return;
    }
    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      doc.preamble.push(line);
    }
  });
  return doc;
}

function serializeDiplomacyDocumentWithOrder(doc) {
  const preamble = Array.isArray(doc && doc.preamble) ? doc.preamble : [];
  const sections = Array.isArray(doc && doc.sections) ? doc.sections : [];
  const hadTrailingNewline = !!(doc && doc.hadTrailingNewline);
  const out = [];
  preamble.forEach((line) => out.push(String(line || '')));
  sections.forEach((section) => {
    if (!section) return;
    const rawHeader = String(section.header || '');
    const key = String(section.key || '').trim().toUpperCase();
    if (!rawHeader && !key) return;
    const header = rawHeader
      ? (rawHeader.startsWith('#') ? rawHeader : `#${rawHeader}`)
      : `#${key}`;
    out.push(header);
    (Array.isArray(section.lines) ? section.lines : []).forEach((line) => out.push(String(line || '')));
  });
  const serialized = out.join('\n');
  return hadTrailingNewline ? ensureTrailingNewline(serialized) : serialized;
}

function parseDiplomacySlotsFromDocument(doc) {
  const sections = Array.isArray(doc && doc.sections) ? doc.sections : [];
  const findSection = (name) => sections.find((section) => String(section && section.key || '').trim().toUpperCase() === String(name || '').toUpperCase());
  const findLines = (sectionName) => {
    const section = findSection(sectionName);
    if (!section) return [];
    return parseDiplomacySectionSlotLines(
      ['#X', ...(Array.isArray(section.lines) ? section.lines : [])].join('\n'),
      'X'
    );
  };
  const firstContact = findLines('AIFIRSTCONTACT');
  const firstDeal = findLines('AIFIRSTDEAL');
  const count = Math.max(firstContact.length, firstDeal.length);
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    slots.push({
      index: i,
      firstContact: String(firstContact[i] || ''),
      firstDeal: String(firstDeal[i] || '')
    });
  }
  return slots;
}

function applyDiplomacySectionSlotLines(section, values) {
  const target = section && Array.isArray(section.lines) ? section : null;
  const desired = (Array.isArray(values) ? values : [])
    .map((line) => normalizeDiplomacyDialogueLine(line))
    .filter(Boolean)
    .map((line) => quoteDiplomacyDialogueLine(line));
  if (!target) return false;

  const lines = target.lines.slice();
  const indices = [];
  let civ = null;
  let power = null;
  let mood = null;
  let random = null;
  let firstSelectorLine = -1;
  let firstMatchLine = -1;
  let lastMatchLine = -1;

  const isDialogueLine = (line) => {
    const trimmed = String(line || '').trim();
    return !!trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#');
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = String(lines[i] || '');
    const trimmed = raw.trim();
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('#CIV ')) {
      civ = Number.parseInt(upper.slice(5).trim(), 10);
      continue;
    }
    if (upper.startsWith('#POWER ')) {
      power = Number.parseInt(upper.slice(7).trim(), 10);
      continue;
    }
    if (upper.startsWith('#MOOD ')) {
      mood = Number.parseInt(upper.slice(6).trim(), 10);
      continue;
    }
    if (upper.startsWith('#RANDOM ')) {
      random = Number.parseInt(upper.slice(8).trim(), 10);
      if (civ === 1 && power === 0 && mood === 0 && random === 1 && firstSelectorLine < 0) {
        firstSelectorLine = i;
      }
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    const inTargetSelector = civ === 1 && power === 0 && mood === 0 && random === 1;
    if (!inTargetSelector) continue;
    if (firstMatchLine < 0) firstMatchLine = i;
    lastMatchLine = i;
    if (isDialogueLine(trimmed)) indices.push(i);
  }

  const before = JSON.stringify(lines);
  if (indices.length > 0) {
    const capped = Math.min(indices.length, desired.length);
    for (let i = 0; i < capped; i += 1) {
      lines[indices[i]] = desired[i];
    }
    if (desired.length > indices.length) {
      const insertAt = (lastMatchLine >= 0 ? lastMatchLine + 1 : indices[indices.length - 1] + 1);
      lines.splice(insertAt, 0, ...desired.slice(indices.length));
    } else if (desired.length < indices.length) {
      for (let i = indices.length - 1; i >= desired.length; i -= 1) {
        lines.splice(indices[i], 1);
      }
    }
  } else if (firstSelectorLine >= 0) {
    lines.splice(firstSelectorLine + 1, 0, ...desired);
  } else {
    if (lines.length > 0 && String(lines[lines.length - 1] || '').trim()) lines.push('');
    lines.push('#CIV 1');
    lines.push('#POWER 0');
    lines.push('#MOOD 0');
    lines.push('#RANDOM 1');
    desired.forEach((line) => lines.push(line));
  }

  target.lines = lines;
  return JSON.stringify(lines) !== before;
}

function detectDominantLineEnding(text) {
  const src = String(text == null ? '' : text);
  const crlf = (src.match(/\r\n/g) || []).length;
  const loneLf = (src.match(/(?<!\r)\n/g) || []).length;
  const loneCr = (src.match(/\r(?!\n)/g) || []).length;
  if (crlf > 0 && crlf >= loneLf && crlf >= loneCr) return '\r\n';
  if (loneLf > 0) return '\n';
  if (loneCr > 0) return '\n';
  return '\n';
}

function normalizeTextLineEndingsToCrlf(text) {
  return String(text == null ? '' : text).replace(/\r\n|\r|\n/g, '\r\n');
}

function hasNonCrlfLineEndings(text) {
  const src = String(text == null ? '' : text);
  return normalizeTextLineEndingsToCrlf(src) !== src;
}

function bufferMatchesExistingFile(filePath, data) {
  const target = String(filePath || '').trim();
  if (!target || !Buffer.isBuffer(data) || !fs.existsSync(target)) return false;
  try {
    return Buffer.compare(fs.readFileSync(target), data) === 0;
  } catch (_err) {
    return false;
  }
}

const PEDIA_HOMELESS_PLACEHOLDER_LINES = [
  '#',
  'art\\civilopedia\\icons\\terrain\\borderslarge.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\borderssmall.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\riverslarge.pcx',
  '#',
  'art\\civilopedia\\icons\\terrain\\riverssmall.pcx'
];

function normalizePediaIconsKey(key) {
  return String(key || '').trim().toUpperCase();
}

function isPediaIconsRealDataBlockKey(key) {
  const k = normalizePediaIconsKey(key);
  if (!k || k === 'HOMELESSICONS' || k === 'END CIVILOPEDIA ART') return false;
  return /^(ICON_|WON_SPLASH_|TECH_|ANIMNAME_|RACE_|HAPPY_|CULTCON_|ERA_|PRTO_|GOOD_|BLDG_|GOVT_|TERR_|TFRM_)/.test(k);
}

function isPediaIconsWonderSplashBlockKey(key) {
  return normalizePediaIconsKey(key).startsWith('WON_SPLASH_');
}

function findPediaIconsInsertionIndex(order, blockKey) {
  const keys = Array.isArray(order) ? order.map(normalizePediaIconsKey) : [];
  const targetKey = normalizePediaIconsKey(blockKey);
  const homelessIdx = keys.indexOf('HOMELESSICONS');
  const endIdx = keys.indexOf('END CIVILOPEDIA ART');
  if (isPediaIconsWonderSplashBlockKey(targetKey)) {
    let lastSplashIdx = -1;
    keys.forEach((key, idx) => {
      if (idx > endIdx && isPediaIconsWonderSplashBlockKey(key)) lastSplashIdx = idx;
    });
    if (lastSplashIdx >= 0) return lastSplashIdx + 1;
    const wonderMarkerIdx = keys.findIndex((key, idx) => (
      idx > endIdx && key.includes('WONDER_SPLASH_ART')
    ));
    if (wonderMarkerIdx >= 0) return wonderMarkerIdx + 1;
    if (endIdx >= 0) return endIdx + 1;
    return keys.length;
  }
  if (homelessIdx >= 0) return homelessIdx;
  if (endIdx >= 0) return endIdx;
  return keys.length;
}

function getPediaIconsItemKey(item) {
  return normalizePediaIconsKey(item && item.key);
}

function getPediaIconsItemKeys(doc) {
  return Array.isArray(doc && doc.items)
    ? doc.items.map(getPediaIconsItemKey)
    : (Array.isArray(doc && doc.order) ? doc.order.map(normalizePediaIconsKey) : []);
}

function rebuildPediaIconsDocumentIndexes(doc) {
  if (!doc) return doc;
  const items = Array.isArray(doc.items) ? doc.items : null;
  const blocks = {};
  const headers = {};
  const order = [];
  if (items) {
    items.forEach((item) => {
      const key = getPediaIconsItemKey(item);
      if (!key) return;
      item.key = key;
      if (!Object.prototype.hasOwnProperty.call(item, 'headerKey') || String(item.headerKey || '').length === 0) {
        item.headerKey = key;
      }
      if (!Array.isArray(item.rawLines)) item.rawLines = [];
      blocks[key] = item.rawLines;
      headers[key] = String(item.headerKey || key);
      if (!order.includes(key)) order.push(key);
    });
  } else {
    (Array.isArray(doc.order) ? doc.order : []).forEach((rawKey) => {
      const key = normalizePediaIconsKey(rawKey);
      if (!key) return;
      if (!order.includes(key)) order.push(key);
      const rawLines = Array.isArray(doc.blocks && doc.blocks[key]) ? doc.blocks[key] : [];
      blocks[key] = rawLines;
      headers[key] = Object.prototype.hasOwnProperty.call(doc.headers || {}, key)
        ? String(doc.headers[key])
        : key;
    });
  }
  doc.order = order;
  doc.blocks = blocks;
  doc.headers = headers;
  return doc;
}

function findLastPediaIconsItemIndexByKey(doc, key) {
  const target = normalizePediaIconsKey(key);
  if (!target || !Array.isArray(doc && doc.items)) return -1;
  for (let i = doc.items.length - 1; i >= 0; i -= 1) {
    if (getPediaIconsItemKey(doc.items[i]) === target) return i;
  }
  return -1;
}

function insertPediaIconsItemsAt(doc, blockKey, itemsToInsert) {
  if (!doc || !Array.isArray(doc.items) || !Array.isArray(itemsToInsert) || itemsToInsert.length === 0) return;
  const itemKeys = getPediaIconsItemKeys(doc);
  const idx = findPediaIconsInsertionIndex(itemKeys, blockKey);
  doc.items.splice(Math.max(0, Math.min(idx, doc.items.length)), 0, ...itemsToInsert);
}

function pediaIconsLinesEqual(a, b) {
  const left = (Array.isArray(a) ? a : []).map((line) => String(line || '').trim());
  const right = (Array.isArray(b) ? b : []).map((line) => String(line || '').trim());
  return JSON.stringify(left) === JSON.stringify(right);
}

function repairPediaIconsDocumentForFiraxis(doc) {
  if (!doc) return { changed: false, moved: 0, restoredHomeless: false };
  rebuildPediaIconsDocumentIndexes(doc);
  if (!Array.isArray(doc.items)) {
    doc.items = (Array.isArray(doc.order) ? doc.order : []).map((key) => ({
      key: normalizePediaIconsKey(key),
      headerKey: Object.prototype.hasOwnProperty.call(doc.headers || {}, normalizePediaIconsKey(key))
        ? String(doc.headers[normalizePediaIconsKey(key)])
        : normalizePediaIconsKey(key),
      rawLines: Array.isArray(doc.blocks && doc.blocks[normalizePediaIconsKey(key)])
        ? doc.blocks[normalizePediaIconsKey(key)].slice()
        : []
    })).filter((item) => item.key);
  }
  const keys = getPediaIconsItemKeys(doc);
  const homelessIdx = keys.indexOf('HOMELESSICONS');
  const endIdx = keys.indexOf('END CIVILOPEDIA ART');
  if (homelessIdx < 0 || endIdx < 0 || endIdx <= homelessIdx) {
    return { changed: false, moved: 0, restoredHomeless: false };
  }

  let changed = false;
  const misplacedItems = doc.items
    .slice(homelessIdx + 1, endIdx)
    .filter((item) => isPediaIconsRealDataBlockKey(getPediaIconsItemKey(item)));
  if (misplacedItems.length > 0) {
    const misplacedSet = new Set(misplacedItems);
    doc.items = doc.items.filter((item) => !misplacedSet.has(item));
    const nonSplash = misplacedItems.filter((item) => !isPediaIconsWonderSplashBlockKey(getPediaIconsItemKey(item)));
    const splash = misplacedItems.filter((item) => isPediaIconsWonderSplashBlockKey(getPediaIconsItemKey(item)));
    if (nonSplash.length > 0) {
      insertPediaIconsItemsAt(doc, getPediaIconsItemKey(nonSplash[0]), nonSplash);
    }
    if (splash.length > 0) {
      insertPediaIconsItemsAt(doc, getPediaIconsItemKey(splash[0]), splash);
    }
    changed = true;
  }

  const currentHomelessIdx = findLastPediaIconsItemIndexByKey(doc, 'HOMELESSICONS');
  const homelessItem = currentHomelessIdx >= 0 ? doc.items[currentHomelessIdx] : null;
  const currentHomeless = Array.isArray(homelessItem && homelessItem.rawLines) ? homelessItem.rawLines : [];
  let restoredHomeless = false;
  if (!pediaIconsLinesEqual(currentHomeless, PEDIA_HOMELESS_PLACEHOLDER_LINES)) {
    if (homelessItem) {
      homelessItem.rawLines = PEDIA_HOMELESS_PLACEHOLDER_LINES.slice();
      homelessItem.normalized = true;
      if (!String(homelessItem.headerKey || '').trim()) homelessItem.headerKey = 'HomelessIcons';
    }
    restoredHomeless = true;
    changed = true;
  }

  if (changed) doc.lineEnding = '\r\n';
  rebuildPediaIconsDocumentIndexes(doc);
  return { changed, moved: misplacedItems.length, restoredHomeless };
}

function parsePediaIconsDocumentWithOrder(text) {
  const src = String(text || '');
  const doc = {
    preamble: [],
    items: [],
    order: [],
    blocks: {},
    headers: {},
    hadTrailingNewline: /\r\n$|\n$|\r$/.test(src),
    lineEnding: detectDominantLineEnding(src)
  };
  const lines = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let currentKey = null;
  let currentHeader = '';
  let currentLines = [];
  const flush = () => {
    if (!currentKey) return;
    const item = {
      key: currentKey,
      headerKey: currentHeader || currentKey,
      rawLines: currentLines.slice()
    };
    doc.items.push(item);
    doc.blocks[currentKey] = [...currentLines];
    if (!doc.order.includes(currentKey)) doc.order.push(currentKey);
    if (!doc.headers[currentKey]) doc.headers[currentKey] = currentHeader || currentKey;
  };
  lines.forEach((raw) => {
    const line = String(raw || '');
    if (line.trim() === '#') {
      if (currentKey) currentLines.push(line);
      else doc.preamble.push(line);
      return;
    }
    if (line.startsWith('#')) {
      flush();
      currentHeader = line.slice(1);
      currentKey = currentHeader.trim().toUpperCase();
      if (!currentKey) {
        currentHeader = '';
        currentLines = [];
        return;
      }
      currentLines = [];
      return;
    }
    if (currentKey) currentLines.push(line);
    else doc.preamble.push(line);
  });
  flush();
  rebuildPediaIconsDocumentIndexes(doc);
  return doc;
}

function normalizePediaIconsLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || '').trim())
    .filter((line) => !!line && !line.startsWith(';'));
}

function toWindowsPediaIconsLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return '';
  return /[\\/]/.test(trimmed) ? trimmed.replace(/\//g, '\\') : trimmed;
}

function serializePediaIconsDocumentWithOrder(doc) {
  const order = Array.isArray(doc && doc.order) ? doc.order : [];
  const blocks = (doc && doc.blocks) || {};
  const headers = (doc && doc.headers) || {};
  const items = Array.isArray(doc && doc.items) ? doc.items : null;
  const preamble = Array.isArray(doc && doc.preamble) ? doc.preamble : [];
  const hadTrailingNewline = !!(doc && doc.hadTrailingNewline);
  const lineEnding = (doc && doc.lineEnding === '\r\n') ? '\r\n' : '\n';
  const out = [];
  preamble.forEach((line) => out.push(String(line || '')));
  if (items && items.length > 0) {
    items.forEach((item) => {
      const k = getPediaIconsItemKey(item);
      if (!k) return;
      const headingRaw = Object.prototype.hasOwnProperty.call(item, 'headerKey') ? String(item.headerKey) : String(k);
      const heading = headingRaw.length > 0 ? headingRaw : String(k);
      out.push(`#${heading}`);
      const lines = Array.isArray(item.rawLines) ? item.rawLines : [];
      lines.forEach((line) => out.push(item.normalized ? toWindowsPediaIconsLine(line) : String(line || '')));
    });
  } else {
    order.forEach((key) => {
      const k = String(key || '').trim().toUpperCase();
      if (!k) return;
      const headingRaw = Object.prototype.hasOwnProperty.call(headers, k) ? String(headers[k]) : String(k);
      const heading = headingRaw.length > 0 ? headingRaw : String(k);
      out.push(`#${heading}`);
      const lines = Array.isArray(blocks[k]) ? blocks[k] : [];
      lines.forEach((line) => out.push(toWindowsPediaIconsLine(line)));
    });
  }
  const serialized = out.join(lineEnding);
  return (hadTrailingNewline && !serialized.endsWith(lineEnding)) ? `${serialized}${lineEnding}` : serialized;
}

function toCanonicalKeyMap(rawMap) {
  const out = {};
  for (const [key, value] of Object.entries(rawMap || {})) {
    out[String(key || '').toUpperCase()] = {
      rawKey: key,
      value
    };
  }
  return out;
}

function mergeByPrecedence(mapsByLayer, order = ['vanilla', 'ptw', 'conquests']) {
  const merged = {};
  for (const layer of order) {
    const src = mapsByLayer[layer] || {};
    for (const [key, value] of Object.entries(src)) {
      merged[key] = value;
    }
  }
  return merged;
}

function inferDisplayNameFromKey(shortKey) {
  const acronyms = new Set(['AEGIS']);
  return String(shortKey || '')
    .split('_')
    .filter(Boolean)
    .map((word) => {
      if (acronyms.has(word)) return word;
      if (/^[IVX]+$/.test(word)) return word;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .trim();
}

function isLikelyDisplayHeading(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (text.length > 72) return false;
  if (/[<>{}=]/.test(text)) return false;
  if (/\$LINK<|^\^/.test(text)) return false;
  if (/[.!?]$/.test(text)) return false;
  if (text.includes(':')) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 9) return false;
  return true;
}

function normalizePediaHeadingText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBodyFromCivilopediaSection(civilopediaSection, options = {}) {
  const lines = (civilopediaSection && civilopediaSection.rawLines) || [];
  const bodyLines = [];
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    const cleaned = trimmed
      .replace(/\$LINK<([^=<>]+)=([^<>]+)>/gi, '$1')
      .replace(/\$LINK<([^<>]+)>/gi, '$1')
      .replace(/\$LINK\b/gi, '')
      .replace(/[{}]/g, ' ')
      .replace(/\^/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) continue;
    bodyLines.push(cleaned);
  }
  const filtered = bodyLines.filter((line) => !/^\(?continued\)?$/i.test(String(line || '').trim()));
  const displayName = String(options && options.displayName || '').trim();
  if (filtered.length > 1 && displayName) {
    const first = normalizePediaHeadingText(filtered[0]);
    const name = normalizePediaHeadingText(displayName);
    if (first && name && (first === name || first.endsWith(` ${name}`) || first.startsWith(`${name} `))) {
      filtered.shift();
    }
  }
  return filtered;
}

function normalizeCivilopediaTextValue(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+$/g, '');
}

function textToCivilopediaLines(value) {
  const normalized = normalizeCivilopediaTextValue(value);
  if (!normalized) return [];
  return normalized.split('\n');
}

function countTrailingEmptyLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  let count = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (String(list[i] || '') !== '') break;
    count += 1;
  }
  return count;
}

function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function extractTechDependenciesFromText(bodyLines) {
  const deps = [];
  for (const line of bodyLines || []) {
    const linkMatches = line.match(/=TECH_[A-Za-z0-9_]+/g) || [];
    for (const token of linkMatches) {
      deps.push(token.slice(1).replace(/^TECH_/, '').replace(/_/g, ' '));
    }
    const tokenMatches = line.match(/\bTECH_[A-Za-z0-9_]+\b/g) || [];
    for (const token of tokenMatches) {
      deps.push(token.replace(/^TECH_/, '').replace(/_/g, ' '));
    }

    const requires = line.match(/\brequires?\b\s*[:\-]?\s*(.+)$/i);
    if (!requires) continue;
    const rhs = requires[1].split(/[.;]/)[0];
    if (/\$LINK\b/i.test(rhs) && !/\bTECH_[A-Za-z0-9_]+\b/i.test(rhs)) continue;
    rhs.split(/,|\/|\band\b/i).forEach((piece) => {
      const cleaned = piece.replace(/[\[\]()]/g, '').trim();
      if (cleaned.length > 1) deps.push(cleaned);
    });
  }
  return dedupeStrings(deps);
}

function mergeSimplePrecedence(...maps) {
  const out = {};
  maps.forEach((map) => {
    Object.assign(out, map || {});
  });
  return out;
}

function parseReferenceIdFromFieldValue(value) {
  const raw = cleanDisplayText(value);
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  const match = raw.match(/\((-?\d+)\)\s*$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function getFieldValueByBaseKey(record, baseKey) {
  const fields = (record && record.fields) || [];
  const target = String(baseKey || '').toLowerCase();
  const found = fields.find((f) => String(f.key || '').toLowerCase() === target);
  return found ? cleanDisplayText(found.value) : '';
}

function collectCivilopediaKeysBySection(biqTab, sectionCode, prefix) {
  const out = new Set();
  if (!biqTab || !Array.isArray(biqTab.sections)) return out;
  const section = biqTab.sections.find((s) => s.code === sectionCode);
  if (!section || !Array.isArray(section.records)) return out;
  section.records.forEach((record) => {
    const raw = getFieldValueByBaseKey(record, 'civilopediaentry');
    const key = String(raw || '').toUpperCase();
    if (key && key.startsWith(prefix)) {
      out.add(key);
    }
  });
  return out;
}

function collectNonBarbarianRaceKeys(biqTab) {
  const raceKeys = collectCivilopediaKeysBySection(biqTab, 'RACE', 'RACE_');
  if (raceKeys.size === 0) return raceKeys;
  const filtered = new Set(Array.from(raceKeys).filter((key) => key !== 'RACE_BARBARIANS'));
  return filtered.size > 0 ? filtered : raceKeys;
}

function collectScenarioReferenceKeySets(biqTab) {
  return {
    civilizations: collectNonBarbarianRaceKeys(biqTab),
    technologies: collectCivilopediaKeysBySection(biqTab, 'TECH', 'TECH_'),
    resources: collectCivilopediaKeysBySection(biqTab, 'GOOD', 'GOOD_'),
    improvements: collectCivilopediaKeysBySection(biqTab, 'BLDG', 'BLDG_'),
    units: collectCivilopediaKeysBySection(biqTab, 'PRTO', 'PRTO_'),
    terrainPedia: collectCivilopediaKeysBySection(biqTab, 'TERR', 'TERR_'),
    workerActions: collectCivilopediaKeysBySection(biqTab, 'TFRM', 'TFRM_')
  };
}

function collectStandardReferenceKeySets(biqTab) {
  return {
    civilizations: collectCivilopediaKeysBySection(biqTab, 'RACE', 'RACE_'),
    technologies: collectCivilopediaKeysBySection(biqTab, 'TECH', 'TECH_'),
    resources: collectCivilopediaKeysBySection(biqTab, 'GOOD', 'GOOD_'),
    improvements: collectCivilopediaKeysBySection(biqTab, 'BLDG', 'BLDG_'),
    units: collectCivilopediaKeysBySection(biqTab, 'PRTO', 'PRTO_'),
    terrainPedia: collectCivilopediaKeysBySection(biqTab, 'TERR', 'TERR_'),
    workerActions: collectCivilopediaKeysBySection(biqTab, 'TFRM', 'TFRM_')
  };
}

const CUSTOM_RULES_SECTION_CODES = [
  'BLDG', 'CTZN', 'CULT', 'DIFF', 'ERAS', 'ESPN', 'EXPR', 'FLAV',
  'GOOD', 'GOVT', 'PRTO', 'RACE', 'RULE', 'TECH', 'TERR', 'TFRM', 'WSIZ'
];
const DEFAULT_RULES_REFERENCE_TAB_KEYS = ['civilizations', 'technologies', 'resources', 'improvements', 'governments', 'units'];
const DEFAULT_RULES_STRUCTURE_TAB_KEYS = ['terrain', 'world', 'rules'];
const CUSTOM_RULES_FALLBACK_NOTICE = 'Showing standard-game rules because Enabled Custom Rules is off for this scenario BIQ.';
const CUSTOM_RULES_DISABLED_REASON = 'Enabled Custom Rules is off for this scenario BIQ. Showing standard-game rules instead of scenario-local rule tabs.';
const CUSTOM_PLAYER_DATA_DISABLED_REASON = 'Enabled Custom Player Data is off for this scenario BIQ. The Players tab is unavailable until custom player data is enabled.';

function parseBooleanishFieldValue(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function findGameFieldValue(biqTab, baseKey) {
  if (!biqTab || !Array.isArray(biqTab.sections)) return '';
  const gameSection = biqTab.sections.find((section) => String(section && section.code || '').toUpperCase() === 'GAME');
  const record = gameSection && Array.isArray(gameSection.records) ? gameSection.records[0] : null;
  if (!record || !Array.isArray(record.fields)) return '';
  const target = canonicalFieldKey(baseKey);
  const field = record.fields.find((entry) => canonicalFieldKey(entry && (entry.baseKey || entry.key)) === target);
  return field ? String(field.value == null ? '' : field.value) : '';
}

function biqUsesDefaultRules(biqTab) {
  return parseBooleanishFieldValue(findGameFieldValue(biqTab, 'useDefaultRules'));
}

function hasBiqCustomRulesSections(biqTab) {
  if (!biqTab || !Array.isArray(biqTab.sections)) return false;
  return biqTab.sections.some((section) => {
    const code = String(section && section.code || '').toUpperCase();
    if (!CUSTOM_RULES_SECTION_CODES.includes(code)) return false;
    const count = Number(section && section.count);
    const records = Array.isArray(section && section.records) ? section.records.length : 0;
    const fullRecords = Array.isArray(section && section.fullRecords) ? section.fullRecords.length : 0;
    return count > 0 || records > 0 || fullRecords > 0;
  });
}

function shouldUseScenarioDefaultRulesFallback(mode, biqTab) {
  if (mode !== 'scenario') return false;
  return !hasBiqCustomRulesSections(biqTab);
}

function applyScenarioDefaultRulesFallbackToReferenceTabs(referenceTabs, fallbackTabs) {
  const out = { ...(referenceTabs || {}) };
  DEFAULT_RULES_REFERENCE_TAB_KEYS.forEach((key) => {
    const fallbackTab = fallbackTabs && fallbackTabs[key];
    if (!fallbackTab) return;
    out[key] = {
      ...fallbackTab,
      readOnly: true,
      disabled: true,
      fallbackSourcePath: fallbackTab.sourcePath || '',
      fallbackNotice: CUSTOM_RULES_FALLBACK_NOTICE,
      disabledReason: CUSTOM_RULES_DISABLED_REASON
    };
  });
  return out;
}

function applyScenarioDefaultRulesFallbackToStructureTabs(structureTabs, fallbackTabs) {
  const out = { ...(structureTabs || {}) };
  DEFAULT_RULES_STRUCTURE_TAB_KEYS.forEach((key) => {
    const fallbackTab = fallbackTabs && fallbackTabs[key];
    if (!fallbackTab) return;
    out[key] = {
      ...fallbackTab,
      readOnly: true,
      disabled: true,
      fallbackSourcePath: fallbackTab.sourcePath || '',
      fallbackNotice: CUSTOM_RULES_FALLBACK_NOTICE,
      disabledReason: CUSTOM_RULES_DISABLED_REASON
    };
  });
  return out;
}

function applyCustomPlayerDataDisabledState(structureTabs, mode) {
  if (mode !== 'scenario') return structureTabs;
  const out = { ...(structureTabs || {}) };
  const playersTab = out.players;
  const hasLeadRecords = !!(playersTab
    && Array.isArray(playersTab.sections)
    && playersTab.sections.some((section) => String(section && section.code || '').toUpperCase() === 'LEAD'
      && Array.isArray(section.records)
      && section.records.length > 0));
  if (!playersTab || hasLeadRecords) return out;
  out.players = {
    ...playersTab,
    readOnly: true,
    disabled: true,
    fallbackNotice: 'Custom player data is currently off for this scenario BIQ.',
    disabledReason: CUSTOM_PLAYER_DATA_DISABLED_REASON
  };
  return out;
}

function buildEffectiveReferenceTabs(civ3Path, options = {}) {
  const mode = options.mode === 'scenario' ? 'scenario' : 'global';
  const referenceTabs = buildReferenceTabs(civ3Path, options);
  if (!shouldUseScenarioDefaultRulesFallback(mode, options.biqTab)) return referenceTabs;
  const fallbackBiqTab = options.defaultRulesBiqTab || null;
  const fallbackTabs = buildReferenceTabs(civ3Path, {
    mode: 'global',
    scenarioPath: '',
    scenarioPaths: [],
    biqTab: fallbackBiqTab,
    textFileEncoding: options.textFileEncoding
  });
  return applyScenarioDefaultRulesFallbackToReferenceTabs(referenceTabs, fallbackTabs);
}

function collectBiqCustomRulesMutationOps({ tabs, civ3Path, textEncoding = DEFAULT_TEXT_FILE_ENCODING } = {}) {
  const scenarioTab = tabs && tabs.scenarioSettings;
  const mutation = String(scenarioTab && scenarioTab.customRulesMutation || '').trim().toLowerCase();
  if (!mutation) return [];
  if (mutation === 'disable') {
    return [{ op: 'removecustomrules' }];
  }
  if (mutation !== 'enable') return [];
  const globalBiqTab = loadBiqTab({ mode: 'global', civ3Path, scenarioPath: '', textEncoding });
  if (!globalBiqTab || !Array.isArray(globalBiqTab.sections)) return [];
  const sections = globalBiqTab.sections
    .filter((section) => CUSTOM_RULES_SECTION_CODES.includes(String(section && section.code || '').trim().toUpperCase()))
    .map((section) => JSON.parse(JSON.stringify(section)));
  if (sections.length === 0) return [];
  return [{ op: 'setcustomrules', sections }];
}

function collectBiqCustomPlayerDataMutationOps({ tabs } = {}) {
  const playersTab = tabs && tabs.players;
  const mutation = String(playersTab && playersTab.customPlayerDataMutation || '').trim().toLowerCase();
  if (!mutation) return [];
  if (mutation === 'disable') {
    return [{ op: 'removecustomplayerdata' }];
  }
  if (mutation !== 'enable') return [];
  return [{ op: 'addcustomplayerdata' }];
}

function getSectionCodeForReferencePrefix(prefix) {
  const p = String(prefix || '').toUpperCase().replace(/_+$/, '');
  if (!p) return '';
  if (p === 'GOVT') return 'GOVT';
  if (p === 'RACE') return 'RACE';
  if (p === 'TECH') return 'TECH';
  if (p === 'GOOD') return 'GOOD';
  if (p === 'BLDG') return 'BLDG';
  if (p === 'PRTO') return 'PRTO';
  return p;
}

function indexBiqRecordsByCivilopediaKey(biqTab, sectionCode) {
  const out = new Map();
  if (!biqTab || !Array.isArray(biqTab.sections)) return out;
  const section = biqTab.sections.find((s) => s.code === sectionCode);
  if (!section || !Array.isArray(section.records)) return out;
  section.records.forEach((record) => {
    const key = String(getFieldValueByBaseKey(record, 'civilopediaentry') || '').toUpperCase();
    if (key) out.set(key, record);
  });
  return out;
}

function listBiqRecordsBySectionOrder(biqTab, sectionCode) {
  if (!biqTab || !Array.isArray(biqTab.sections)) return [];
  const section = biqTab.sections.find((s) => String(s && s.code || '').toUpperCase() === String(sectionCode || '').toUpperCase());
  const records = Array.isArray(section && section.records) ? section.records : [];
  return records
    .map((record) => {
      const idx = Number(record && record.index);
      return Number.isFinite(idx) ? { ...record, index: idx } : null;
    })
    .filter(Boolean);
}

function cloneRecordField(field) {
  return {
    ...field,
    value: field && field.value != null ? String(field.value) : '',
    originalValue: field && field.originalValue != null
      ? String(field.originalValue)
      : String(field && field.value != null ? field.value : '')
  };
}

function mergePrtoStrategyMapRecords(biqTab) {
  const out = [];
  if (!biqTab || !Array.isArray(biqTab.sections)) return out;
  const section = biqTab.sections.find((s) => String(s && s.code || '').toUpperCase() === 'PRTO');
  const records = Array.isArray(section && section.records) ? section.records : [];
  if (records.length === 0) return out;

  const duplicatesByPrimary = new Map();
  const parseAiBits = (value, fallback = 0) => parseIntLoose(String(value == null ? '' : value), fallback);

  records.forEach((record) => {
    const otherRaw = getRecordFieldValue(record, 'PRTO', 'otherStrategy');
    const primaryIdx = parseReferenceIdFromFieldValue(otherRaw);
    if (!Number.isFinite(primaryIdx) || primaryIdx < 0) return;
    if (!duplicatesByPrimary.has(primaryIdx)) duplicatesByPrimary.set(primaryIdx, []);
    duplicatesByPrimary.get(primaryIdx).push(record);
  });

  records.forEach((record) => {
    const idx = Number(record && record.index);
    if (!Number.isFinite(idx)) return;
    const otherRaw = getRecordFieldValue(record, 'PRTO', 'otherStrategy');
    const primaryIdx = parseReferenceIdFromFieldValue(otherRaw);
    if (Number.isFinite(primaryIdx) && primaryIdx >= 0) return;

    const baseFields = Array.isArray(record.fields) ? record.fields.map(cloneRecordField) : [];
    const aiField = baseFields.find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'aistrategy');
    let mergedValue = parseAiBits(aiField && aiField.value, 0);
    let mergedOriginal = parseAiBits(aiField && aiField.originalValue, mergedValue);
    const duplicates = duplicatesByPrimary.get(idx) || [];
    const prtoStrategyRowIndexes = duplicates
      .map((dupRecord) => Number(dupRecord && dupRecord.index))
      .filter((rowIndex) => Number.isInteger(rowIndex) && rowIndex >= 0);
    duplicates.forEach((dupRecord) => {
      mergedValue |= parseAiBits(getRecordFieldValue(dupRecord, 'PRTO', 'AIStrategy'), 0);
      const dupAiField = Array.isArray(dupRecord && dupRecord.fields)
        ? dupRecord.fields.find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'aistrategy')
        : null;
      mergedOriginal |= parseAiBits(dupAiField && dupAiField.originalValue, parseAiBits(dupAiField && dupAiField.value, 0));
    });
    if (aiField) {
      aiField.value = String(mergedValue | 0);
      aiField.originalValue = String(mergedOriginal | 0);
    }

    out.push({
      ...record,
      fields: baseFields,
      index: idx,
      prtoStrategyRowIndexes
    });
  });
  return out;
}

function getRecordFieldsForSection(record, sectionCode) {
  if (record && Array.isArray(record.fields) && record.fields.length > 0) return record.fields;
  const english = String(record && record.english || '');
  if (!english) return [];
  return parseEnglishFields(sectionCode, english || '');
}

function getRecordFieldValue(record, sectionCode, baseKey) {
  const target = String(baseKey || '').trim().toLowerCase();
  if (!target) return '';
  const fields = getRecordFieldsForSection(record, sectionCode);
  const hit = fields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target);
  return cleanDisplayText(hit && hit.value || '');
}

function isPrtoStrategyMapRecord(record) {
  const raw = getRecordFieldValue(record, 'PRTO', 'otherStrategy');
  const parsed = parseReferenceIdFromFieldValue(raw);
  return Number.isFinite(parsed) && parsed >= 0;
}

// Returns a Map<string(duplicateIdx), number(primaryIdx)> for every PRTO record
// whose otherStrategy >= 0 (i.e. strategy-map duplicates Civ3 creates when a unit
// has multiple AI strategies assigned).  The caller uses this to resolve stealth-
// target indices that point at duplicates back to the primary unit's index.
// Input: the sections array from a normalised bridge biqTab (bundle.biq.sections).
function buildPrtoStrategyMapAliases(biqSections) {
  const aliases = new Map();
  if (!Array.isArray(biqSections)) return aliases;
  const prtoSection = biqSections.find((s) => String(s && s.code || '').toUpperCase() === 'PRTO');
  if (!prtoSection) return aliases;
  const records = Array.isArray(prtoSection.records) ? prtoSection.records
    : (Array.isArray(prtoSection.fullRecords) ? prtoSection.fullRecords : []);
  records.forEach((record) => {
    const idx = Number(record && record.index);
    if (!Number.isFinite(idx)) return;
    const raw = getRecordFieldValue(record, 'PRTO', 'otherStrategy');
    const primaryIdx = parseReferenceIdFromFieldValue(raw);
    if (!Number.isFinite(primaryIdx) || primaryIdx < 0) return;
    aliases.set(String(idx), primaryIdx);
  });
  return aliases;
}

function buildSyntheticUnitReferenceEntry(record, biqSourcePath, mode) {
  const index = Number(record && record.index);
  const name = cleanDisplayText(record && record.name || '') || `Unit ${Number.isFinite(index) ? index + 1 : '?'}`;
  const civilopediaEntry = cleanDisplayText(getRecordFieldValue(record, 'PRTO', 'civilopediaentry'));
  const lookupCivilopediaEntry = civilopediaEntry.toUpperCase();
  const rawRecordFields = getRecordFieldsForSection(record, 'PRTO');
  const rawBiqFields = rawRecordFields
    .filter((f) => String(f && (f.baseKey || f.key) || '').toLowerCase() !== 'civilopediaentry')
    .map((f) => ({
      key: f.key,
      baseKey: f.baseKey || String(f.key || '').replace(/_\d+$/, ''),
      label: f.label || toTitleFromKey(f.key),
      value: cleanDisplayText(f.value),
      originalValue: cleanDisplayText(f.originalValue == null ? f.value : f.originalValue),
      editable: !!f.editable,
      expectedSetter: String(f.expectedSetter || '')
    }));
  return {
    id: `biq-prto-${Number.isFinite(index) ? index : name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    civilopediaKey: lookupCivilopediaEntry || '',
    displayCivilopediaKey: civilopediaEntry || '',
    lookupCivilopediaKey: lookupCivilopediaEntry || '',
    rawCivilopediaKey: civilopediaEntry || '',
    rawBiqCivilopediaKey: civilopediaEntry || '',
    linkCivilopediaKey: civilopediaEntry || '',
    biqIndex: Number.isFinite(index) ? index : null,
    prtoStrategyRowIndexes: Array.isArray(record && record.prtoStrategyRowIndexes)
      ? record.prtoStrategyRowIndexes.slice()
      : [],
    name,
    civilopediaSection1: '',
    originalCivilopediaSection1: '',
    civilopediaSection2: '',
    originalCivilopediaSection2: '',
    techDependencies: [],
    improvementKind: null,
    iconPaths: [],
    originalIconPaths: [],
    racePaths: [],
    originalRacePaths: [],
    thumbPath: '',
    animationName: '',
    originalAnimationName: '',
    biqSectionCode: 'PRTO',
    biqSectionTitle: 'PRTO',
    biqFields: projectUnitBiqFields({
      rawFields: rawBiqFields,
      civilopediaEntry: civilopediaEntry || `PRTO_${name.replace(/\s+/g, '_')}`
    }),
    improvementFlavorCount: 0,
    civilizationFlavorCount: 0,
    technologyFlavorCount: 0,
    sourceMeta: {
      civilopediaSection1: { source: 'BIQ', readPath: biqSourcePath || '', writePath: mode === 'scenario' ? (biqSourcePath || '') : '' },
      civilopediaSection2: { source: 'BIQ', readPath: biqSourcePath || '', writePath: mode === 'scenario' ? (biqSourcePath || '') : '' },
      iconPaths: { source: 'BIQ', readPath: biqSourcePath || '', writePath: mode === 'scenario' ? (biqSourcePath || '') : '' },
      animationName: { source: 'BIQ', readPath: biqSourcePath || '', writePath: mode === 'scenario' ? (biqSourcePath || '') : '' },
      biq: {
        source: 'BIQ',
        readPath: biqSourcePath || '',
        writePath: mode === 'scenario' ? (biqSourcePath || '') : ''
      }
    },
    syntheticBiqOnly: true
  };
}

function findLayerPathForKey(mapsByLayer, layerFilesByLayer, key, order) {
  const upperKey = String(key || '').toUpperCase();
  if (!upperKey) return '';
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const layer = order[i];
    const map = mapsByLayer[layer] || {};
    if (map[upperKey]) {
      return (layerFilesByLayer[layer] && layerFilesByLayer[layer].filePath) || '';
    }
  }
  return '';
}

function parseImprovementKindsFromCivilopediaText(text) {
  const kinds = {};
  if (!text) return kinds;

  const lines = text.split(/\r?\n/);
  let scope = 'normal';
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;

    if (line.startsWith(';')) {
      const upper = line.toUpperCase();
      if (upper.includes('SMALL WONDERS')) {
        scope = 'small_wonder';
      } else if (upper.includes('GREAT WONDERS')) {
        scope = 'wonder';
      } else if (upper.includes('CITY IMPROVEMENTS') || upper.includes('END SMALL WONDERS') || upper.includes('END GREAT WONDERS')) {
        scope = 'normal';
      }
      continue;
    }

    if (!line.startsWith('#BLDG_')) continue;
    const key = line.slice(1).trim().toUpperCase();
    if (!key) continue;
    kinds[key] = scope;
  }
  return kinds;
}

function parseImprovementKindsFromPediaIconsBlocks(blocks) {
  const kinds = {};
  for (const key of Object.keys(blocks || {})) {
    const upper = String(key || '').toUpperCase();
    if (!upper.startsWith('WON_SPLASH_BLDG_')) continue;
    const bldg = `BLDG_${upper.slice('WON_SPLASH_BLDG_'.length)}`;
    kinds[bldg] = 'wonder';
  }
  return kinds;
}

function isProjectedBoolTruthy(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function inferImprovementKindFromBiqFields(fields) {
  const byKey = new Map();
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const key = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
    if (key) byKey.set(key, field);
  });
  const read = (key) => byKey.get(key) && byKey.get(key).value;
  if (isProjectedBoolTruthy(read('smallwonder'))) return 'small_wonder';
  if (isProjectedBoolTruthy(read('wonder'))) return 'wonder';
  if (isProjectedBoolTruthy(read('improvement'))) return 'normal';
  return '';
}

function parseBuildingIconBlockLines(lines) {
  const rawLines = Array.isArray(lines) ? lines.map((line) => String(line || '').trim()).filter(Boolean) : [];
  const pathLines = rawLines.filter((line) => /[\\/]/.test(line) || /\.(pcx|flc|ini)$/i.test(line));
  const kind = rawLines.find((line) => /^[A-Za-z_]+$/.test(line) && !/[\\/]/.test(line)) || '';
  const iconIndex = rawLines.find((line) => /^-?\d+$/.test(line)) || '';
  return {
    kind,
    iconIndex,
    iconPaths: pathLines.map((line) => normalizeRelativePath(line)).filter(Boolean)
  };
}

function normalizeRaceIconPaths(values) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((raw) => {
    const normalized = normalizeAssetReferencePath(raw);
    if (!normalized) return;
    const lower = normalized.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(normalized);
  });
  return out.slice(0, 4);
}

function appendFileNameStemSuffix(fileName, suffix) {
  const base = String(fileName || '').trim();
  const safeSuffix = String(suffix || '').trim();
  if (!base || !safeSuffix) return base;
  const ext = path.extname(base) || '.pcx';
  const stem = path.basename(base, ext) || 'art';
  if (stem.toLowerCase().endsWith(safeSuffix.toLowerCase())) return `${stem}${ext}`;
  return `${stem}${safeSuffix}${ext}`;
}

function getReferenceArtCollisionSuffix(tabKey, group, index) {
  const normalizedTab = String(tabKey || '').trim();
  const normalizedGroup = String(group || '').trim();
  const idx = Number(index);
  if (normalizedTab === 'civilizations' && normalizedGroup === 'iconPaths') {
    if (idx === 0) return '_large';
    if (idx === 1) return '_small';
    if (Number.isFinite(idx) && idx >= 2) return `_icon${idx + 1}`;
  }
  if (normalizedTab === 'civilizations' && normalizedGroup === 'racePaths') {
    if (idx === 0) return '_leaderhead';
    if (idx === 1) return '_advisor';
  }
  return Number.isFinite(idx) ? `_slot${idx + 1}` : '_slot';
}

function applyReferenceArtDefaultFileNameSuffix(fileName, tabKey, group, index) {
  const normalizedTab = String(tabKey || '').trim();
  const normalizedGroup = String(group || '').trim();
  const idx = Number(index);
  if (normalizedTab === 'civilizations' && normalizedGroup === 'iconPaths' && Number.isFinite(idx) && idx >= 2) {
    return appendFileNameStemSuffix(fileName, `_icon${idx + 1}`);
  }
  return fileName;
}

function findFirstPathLine(lines) {
  const rawLines = Array.isArray(lines) ? lines : [];
  const line = rawLines.find((value) => {
    const text = String(value || '').trim();
    return !!text && (/[\\/]/.test(text) || /\.(pcx|flc|ini)$/i.test(text));
  });
  return line ? normalizeRelativePath(line) : '';
}

function buildBuildingIconLines(entry, iconPaths) {
  const paths = (Array.isArray(iconPaths) ? iconPaths : [])
    .map((v) => normalizeAssetReferencePath(v))
    .filter(Boolean);
  const kind = String(entry && entry.buildingIconKind || '').trim() || 'SINGLE';
  const iconIndex = String(entry && entry.buildingIconIndex || '').trim();
  const lines = [kind];
  if (iconIndex) lines.push(iconIndex);
  paths.forEach((p) => lines.push(p));
  return lines;
}

function mapPediaIconsForKey(pediaBlocks, civilopediaKey) {
  const collectIconLines = (upperKey) => {
    const iconKey = `ICON_${upperKey}`;
    const iconBlock = (pediaBlocks[iconKey] && pediaBlocks[iconKey].value) || [];
    const techSmallBlock = (pediaBlocks[upperKey] && pediaBlocks[upperKey].value) || [];
    const techLargeBlock = (pediaBlocks[`${upperKey}_LARGE`] && pediaBlocks[`${upperKey}_LARGE`].value) || [];
    return [...iconBlock, ...techLargeBlock, ...techSmallBlock]
      .filter((line) => /[\\/]/.test(line) || /\.(pcx|flc|ini)$/i.test(line));
  };

  const upperKey = civilopediaKey.toUpperCase();
  const isRaceKey = upperKey.startsWith('RACE_');
  const buildingIconBlock = upperKey.startsWith('BLDG_')
    ? parseBuildingIconBlockLines((pediaBlocks[`ICON_${upperKey}`] && pediaBlocks[`ICON_${upperKey}`].value) || [])
    : null;
  const usableLines = buildingIconBlock ? buildingIconBlock.iconPaths : (isRaceKey ? [] : collectIconLines(upperKey));
  const raceIconKey = `ICON_RACE_${upperKey.replace(/^RACE_/, '')}`;
  const raceIconBlock = (pediaBlocks[raceIconKey] && pediaBlocks[raceIconKey].value) || [];
  const raceUsable = raceIconBlock.filter((line) => /[\\/]/.test(line) || /\.(pcx|flc|ini)$/i.test(line));

  const govFallback = [];
  if (upperKey.startsWith('GOVT_') && usableLines.length === 0) {
    const short = upperKey.slice('GOVT_'.length);
    govFallback.push(...collectIconLines(`TECH_${short}`));
    if (govFallback.length === 0) {
      const techCandidates = Object.keys(pediaBlocks)
        .filter((key) => key.startsWith('TECH_') && !key.endsWith('_LARGE') && !key.startsWith('ICON_'));
      const bySuffix = techCandidates.find((key) => key.endsWith(`_${short}`));
      const byToken = bySuffix || techCandidates.find((key) => key.split('_').includes(short));
      if (byToken) {
        govFallback.push(...collectIconLines(byToken));
      }
    }
  }

  const rawPaths = [...usableLines, ...govFallback, ...raceUsable].map((line) => normalizeRelativePath(line));
  const originalIconPaths = buildingIconBlock
    ? rawPaths.filter(Boolean)
    : dedupeStrings(rawPaths.filter(Boolean));
  const iconPaths = buildingIconBlock
    ? originalIconPaths
    : (isRaceKey ? normalizeRaceIconPaths(rawPaths) : dedupeStrings(rawPaths.filter(Boolean)));

  const readAnimationName = (key) => {
    const block = (pediaBlocks[key] && pediaBlocks[key].value) || [];
    for (const raw of block) {
      const cleaned = String(raw || '').replace(/\s*;.*$/, '').trim().replace(/^["']|["']$/g, '').trim();
      if (cleaned) return cleaned;
    }
    return '';
  };
  const animKey = `ANIMNAME_${upperKey}`;
  let animName = readAnimationName(animKey);
  if (!animName && upperKey.startsWith('PRTO_')) {
    const eraIdx = upperKey.indexOf('_ERAS_');
    if (eraIdx > 0) {
      animName = readAnimationName(`ANIMNAME_${upperKey.slice(0, eraIdx)}`);
    }
  }

  const raceBlock = (pediaBlocks[civilopediaKey.toUpperCase()] && pediaBlocks[civilopediaKey.toUpperCase()].value) || [];
  const racePaths = raceBlock.map((line) => normalizeRelativePath(line)).filter(Boolean);
  const normalizedRacePaths = dedupeStrings(racePaths);
  const displayIconPaths = isRaceKey ? iconPaths.slice(0, 4) : iconPaths;
  if (isRaceKey) {
    if (!displayIconPaths[2] && normalizedRacePaths[0]) displayIconPaths[2] = normalizedRacePaths[0];
    if (!displayIconPaths[3] && normalizedRacePaths[1]) displayIconPaths[3] = normalizedRacePaths[1];
  }
  const wonderSplashPath = upperKey.startsWith('BLDG_')
    ? findFirstPathLine((pediaBlocks[`WON_SPLASH_${upperKey}`] && pediaBlocks[`WON_SPLASH_${upperKey}`].value) || [])
    : '';

  return {
    iconPaths: displayIconPaths,
    originalIconPaths,
    animationName: animName,
    racePaths: normalizedRacePaths,
    buildingIconKind: buildingIconBlock ? buildingIconBlock.kind : '',
    buildingIconIndex: buildingIconBlock ? buildingIconBlock.iconIndex : '',
    wonderSplashPath
  };
}

function buildReferenceTabs(civ3Path, options = {}) {
  const mode = options.mode === 'scenario' ? 'scenario' : 'global';
  const scenarioPath = mode === 'scenario' ? (options.scenarioPath || '') : '';
  const scenarioPaths = Array.isArray(options.scenarioPaths) ? options.scenarioPaths : [];
  const preferredTextEncoding = normalizeTextFileEncoding(options.textFileEncoding);
  const biqKeySets = options.biqTab
    ? (mode === 'scenario' ? collectScenarioReferenceKeySets(options.biqTab) : collectStandardReferenceKeySets(options.biqTab))
    : null;
  const includeScenarioLayer = mode === 'scenario' && !!scenarioPath;
  const layerOrder = includeScenarioLayer
    ? ['vanilla', 'ptw', 'conquests', 'scenario']
    : ['vanilla', 'ptw', 'conquests'];
  const civilopediaLayers = readTextLayers(civ3Path, 'Civilopedia.txt', scenarioPath, scenarioPaths, { preferredEncoding: preferredTextEncoding });
  const pediaIconLayers = readTextLayers(civ3Path, 'PediaIcons.txt', scenarioPath, scenarioPaths, { preferredEncoding: preferredTextEncoding });
  const improvementKindsByKey = mergeSimplePrecedence(
    mergeSimplePrecedence(
      parseImprovementKindsFromPediaIconsBlocks(parsePediaIconsBlocks((pediaIconLayers.vanilla && pediaIconLayers.vanilla.text) || '')),
      parseImprovementKindsFromCivilopediaText((civilopediaLayers.vanilla && civilopediaLayers.vanilla.text) || '')
    ),
    mergeSimplePrecedence(
      parseImprovementKindsFromPediaIconsBlocks(parsePediaIconsBlocks((pediaIconLayers.ptw && pediaIconLayers.ptw.text) || '')),
      parseImprovementKindsFromCivilopediaText((civilopediaLayers.ptw && civilopediaLayers.ptw.text) || '')
    ),
    mergeSimplePrecedence(
      parseImprovementKindsFromPediaIconsBlocks(parsePediaIconsBlocks((pediaIconLayers.conquests && pediaIconLayers.conquests.text) || '')),
      parseImprovementKindsFromCivilopediaText((civilopediaLayers.conquests && civilopediaLayers.conquests.text) || '')
    ),
    mergeSimplePrecedence(
      parseImprovementKindsFromPediaIconsBlocks(parsePediaIconsBlocks((pediaIconLayers.scenario && pediaIconLayers.scenario.text) || '')),
      parseImprovementKindsFromCivilopediaText((civilopediaLayers.scenario && civilopediaLayers.scenario.text) || '')
    )
  );
  const civilopediaSectionsByLayer = {
    vanilla: toCanonicalKeyMap(parseCivilopediaSections((civilopediaLayers.vanilla && civilopediaLayers.vanilla.text) || '')),
    ptw: toCanonicalKeyMap(parseCivilopediaSections((civilopediaLayers.ptw && civilopediaLayers.ptw.text) || '')),
    conquests: toCanonicalKeyMap(parseCivilopediaSections((civilopediaLayers.conquests && civilopediaLayers.conquests.text) || '')),
    scenario: toCanonicalKeyMap(parseCivilopediaSections((civilopediaLayers.scenario && civilopediaLayers.scenario.text) || ''))
  };
  const pediaBlocksByLayer = {
    vanilla: toCanonicalKeyMap(parsePediaIconsBlocks((pediaIconLayers.vanilla && pediaIconLayers.vanilla.text) || '')),
    ptw: toCanonicalKeyMap(parsePediaIconsBlocks((pediaIconLayers.ptw && pediaIconLayers.ptw.text) || '')),
    conquests: toCanonicalKeyMap(parsePediaIconsBlocks((pediaIconLayers.conquests && pediaIconLayers.conquests.text) || '')),
    scenario: toCanonicalKeyMap(parsePediaIconsBlocks((pediaIconLayers.scenario && pediaIconLayers.scenario.text) || ''))
  };
  const scenarioCivilopediaWritePath = mode === 'scenario'
    ? (
      ((civilopediaLayers.scenario && civilopediaLayers.scenario.filePath) || '')
      || resolveScenarioTextPath(scenarioPath, 'Civilopedia.txt', scenarioPaths)
      || (scenarioPath ? path.join(resolveScenarioDir(scenarioPath), 'Text', 'Civilopedia.txt') : '')
    )
    : '';
  const scenarioPediaIconsWritePath = mode === 'scenario'
    ? (
      ((pediaIconLayers.scenario && pediaIconLayers.scenario.filePath) || '')
      || resolveScenarioTextPath(scenarioPath, 'PediaIcons.txt', scenarioPaths)
      || (scenarioPath ? path.join(resolveScenarioDir(scenarioPath), 'Text', 'PediaIcons.txt') : '')
    )
    : '';
  const diplomacyLayers = readTextLayers(civ3Path, 'diplomacy.txt', scenarioPath, scenarioPaths, { preferredEncoding: preferredTextEncoding });
  const diplomacyTopLayer = pickHighestLayerText(diplomacyLayers);
  const diplomacyDoc = parseDiplomacyDocumentWithOrder((diplomacyTopLayer && diplomacyTopLayer.text) || '');
  const diplomacySlots = parseDiplomacySlotsFromDocument(diplomacyDoc);
  const diplomacyOptions = parseDiplomacySlotOptions(serializeDiplomacyDocumentWithOrder(diplomacyDoc));
  const scenarioDiplomacyWritePath = mode === 'scenario'
    ? (
      ((diplomacyLayers.scenario && diplomacyLayers.scenario.filePath) || '')
      || resolveScenarioTextPath(scenarioPath, 'diplomacy.txt', scenarioPaths)
      || (scenarioPath ? path.join(resolveScenarioDir(scenarioPath), 'Text', 'diplomacy.txt') : '')
    )
    : '';
  const civilopediaSections = mergeByPrecedence(civilopediaSectionsByLayer, layerOrder);
  const pediaBlocks = mergeByPrecedence(pediaBlocksByLayer, layerOrder);
  const flavorSection = (((options || {}).biqTab || {}).sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'FLAV');
  const flavorCount = Array.isArray(flavorSection && flavorSection.records) ? flavorSection.records.length : 0;
  const governmentSection = (((options || {}).biqTab || {}).sections || []).find((section) => String(section && section.code || '').toUpperCase() === 'GOVT');
  const governmentNames = Array.isArray(governmentSection && governmentSection.records)
    ? governmentSection.records.map((record, idx) => cleanDisplayText(record && record.name || `Government ${idx + 1}`))
    : [];

  const tabs = {};
  for (const tabSpec of REFERENCE_TAB_SPECS) {
    const biqSectionCode = getSectionCodeForReferencePrefix(tabSpec.prefix);
    const biqRecordsInOrder = tabSpec.key === 'units'
      ? mergePrtoStrategyMapRecords(options.biqTab)
      : listBiqRecordsBySectionOrder(options.biqTab, biqSectionCode);
    const hasOrderedBiqSeeds = biqRecordsInOrder.length > 0;
    const biqRecordByCivilopediaKey = hasOrderedBiqSeeds
      ? new Map()
      : (tabSpec.key === 'units'
        ? new Map()
        : indexBiqRecordsByCivilopediaKey(options.biqTab, biqSectionCode));
    const entrySeeds = [];
    const prefix = tabSpec.prefix;

    const canonicalPrefix = prefix.toUpperCase();
    if (hasOrderedBiqSeeds) {
      biqRecordsInOrder.forEach((record) => {
        const idx = Number(record && record.index);
        const rawCivilopediaKey = String(getRecordFieldValue(record, biqSectionCode, 'civilopediaentry') || '').trim();
        const lookupCivilopediaKey = rawCivilopediaKey.toUpperCase();
        entrySeeds.push({
          civilopediaKey: lookupCivilopediaKey,
          lookupCivilopediaKey,
          rawCivilopediaKey,
          rawBiqCivilopediaKey: rawCivilopediaKey,
          biqRecord: record,
          biqIndex: Number.isFinite(idx) ? idx : null,
          prtoStrategyRowIndexes: tabSpec.key === 'units' && Array.isArray(record && record.prtoStrategyRowIndexes)
            ? record.prtoStrategyRowIndexes.slice()
            : []
        });
      });
      const allowedKeys = biqKeySets && biqKeySets[tabSpec.key] instanceof Set ? biqKeySets[tabSpec.key] : null;
      if (allowedKeys && allowedKeys.size > 0) {
        const seenExactKeys = new Set(entrySeeds.map((entry) => String(entry && (entry.lookupCivilopediaKey || entry.civilopediaKey) || '').toUpperCase()).filter(Boolean));
        const maybeAppendPediaSeed = (candidateKey) => {
          const rawCivilopediaKey = String(candidateKey || '').trim();
          const lookupCivilopediaKey = rawCivilopediaKey.toUpperCase();
          if (!lookupCivilopediaKey || seenExactKeys.has(lookupCivilopediaKey)) return;
          if (!allowedKeys.has(lookupCivilopediaKey)) {
            if (!(tabSpec.key === 'units' && lookupCivilopediaKey.startsWith('PRTO_') && lookupCivilopediaKey.includes('_ERAS_') && allowedKeys.has(lookupCivilopediaKey.split('_ERAS_')[0]))) {
              return;
            }
          }
          seenExactKeys.add(lookupCivilopediaKey);
          entrySeeds.push({
            civilopediaKey: lookupCivilopediaKey,
            lookupCivilopediaKey,
            rawCivilopediaKey,
            rawBiqCivilopediaKey: '',
            biqRecord: null,
            biqIndex: null,
            prtoStrategyRowIndexes: []
          });
        };
        Object.keys(civilopediaSections)
          .filter((key) => key.startsWith(canonicalPrefix))
          .forEach(maybeAppendPediaSeed);
        Object.keys(pediaBlocks)
          .filter((key) => key.startsWith(`ICON_${canonicalPrefix}`)
            || key.startsWith(`ANIMNAME_${canonicalPrefix}`)
            || (canonicalPrefix === 'BLDG_' && key.startsWith('WON_SPLASH_BLDG_'))
            || key.startsWith(`ICON_RACE_`)
            || (canonicalPrefix === 'RACE_' && key.startsWith(canonicalPrefix))
            || (tabSpec.key === 'technologies' && key.startsWith(canonicalPrefix)))
          .forEach((key) => {
            let civilopediaKey = key.startsWith('ICON_') ? key.slice(5) : key.startsWith('ANIMNAME_') ? key.slice(9) : key;
            if (canonicalPrefix === 'BLDG_' && key.startsWith('WON_SPLASH_BLDG_')) {
              civilopediaKey = `BLDG_${key.slice('WON_SPLASH_BLDG_'.length)}`;
            }
            if (canonicalPrefix === 'RACE_' && key.startsWith('ICON_RACE_')) {
              civilopediaKey = `RACE_${key.slice('ICON_RACE_'.length)}`;
            }
            if (tabSpec.key === 'technologies' && civilopediaKey.startsWith('TECH_') && civilopediaKey.endsWith('_LARGE')) {
              civilopediaKey = civilopediaKey.slice(0, -6);
            }
            if (civilopediaKey.startsWith(canonicalPrefix)) maybeAppendPediaSeed(civilopediaKey);
          });
      }
    } else {
      const entriesByKey = new Map();
      Object.keys(civilopediaSections)
        .filter((key) => key.startsWith(canonicalPrefix))
        .forEach((civilopediaKey) => entriesByKey.set(civilopediaKey, {
          civilopediaKey,
          lookupCivilopediaKey: civilopediaKey,
          rawCivilopediaKey: (civilopediaSections[civilopediaKey] && civilopediaSections[civilopediaKey].rawKey) || civilopediaKey,
          rawBiqCivilopediaKey: ''
        }));

      Object.keys(pediaBlocks)
        .filter((key) => key.startsWith(`ICON_${canonicalPrefix}`)
          || key.startsWith(`ANIMNAME_${canonicalPrefix}`)
          || (canonicalPrefix === 'BLDG_' && key.startsWith('WON_SPLASH_BLDG_'))
          || key.startsWith(`ICON_RACE_`)
          || (canonicalPrefix === 'RACE_' && key.startsWith(canonicalPrefix))
          || (tabSpec.key === 'technologies' && key.startsWith(canonicalPrefix)))
        .forEach((key) => {
          let civilopediaKey = key.startsWith('ICON_') ? key.slice(5) : key.startsWith('ANIMNAME_') ? key.slice(9) : key;
          if (canonicalPrefix === 'BLDG_' && key.startsWith('WON_SPLASH_BLDG_')) {
            civilopediaKey = `BLDG_${key.slice('WON_SPLASH_BLDG_'.length)}`;
          }
          if (canonicalPrefix === 'RACE_' && key.startsWith('ICON_RACE_')) {
            civilopediaKey = `RACE_${key.slice('ICON_RACE_'.length)}`;
          }
          if (tabSpec.key === 'technologies' && civilopediaKey.startsWith('TECH_') && civilopediaKey.endsWith('_LARGE')) {
            civilopediaKey = civilopediaKey.slice(0, -6);
          }
          if (civilopediaKey.startsWith(canonicalPrefix)) {
            entriesByKey.set(civilopediaKey, {
              civilopediaKey,
              lookupCivilopediaKey: civilopediaKey,
              rawCivilopediaKey: (pediaBlocks[civilopediaKey] && pediaBlocks[civilopediaKey].rawKey) || civilopediaKey,
              rawBiqCivilopediaKey: ''
            });
          }
        });
      entrySeeds.push(...Array.from(entriesByKey.values()));
    }

    let entries = entrySeeds
      .map((entry) => {
        const lookupCivilopediaKey = String(entry && (entry.lookupCivilopediaKey || entry.civilopediaKey) || '').trim().toUpperCase();
        const civilopediaSection = (lookupCivilopediaKey && civilopediaSections[lookupCivilopediaKey] && civilopediaSections[lookupCivilopediaKey].value) || null;
        const descSection = (lookupCivilopediaKey && civilopediaSections[`DESC_${lookupCivilopediaKey}`] && civilopediaSections[`DESC_${lookupCivilopediaKey}`].value) || null;
        const shortKey = lookupCivilopediaKey.startsWith(prefix) ? lookupCivilopediaKey.slice(prefix.length) : '';
        const inferredDisplayName = inferDisplayNameFromKey(shortKey);
        const pedia = lookupCivilopediaKey ? mapPediaIconsForKey(pediaBlocks, lookupCivilopediaKey) : { iconPaths: [], animationName: '', racePaths: [] };
        const section1Lines = parseBodyFromCivilopediaSection(civilopediaSection, { displayName: inferredDisplayName });
        const section2Lines = parseBodyFromCivilopediaSection(descSection, { displayName: inferredDisplayName });
        const section1RawText = (civilopediaSection && Array.isArray(civilopediaSection.rawLines))
          ? civilopediaSection.rawLines.join('\n')
          : '';
        const section2RawText = (descSection && Array.isArray(descSection.rawLines))
          ? descSection.rawLines.join('\n')
          : '';
        const rawCivilopediaKey = String(
          (civilopediaSections[lookupCivilopediaKey] && civilopediaSections[lookupCivilopediaKey].rawKey)
          || (entry && entry.rawCivilopediaKey)
          || lookupCivilopediaKey
        ).trim();
        const rawBiqCivilopediaKey = String((entry && entry.rawBiqCivilopediaKey) || '').trim();
        const displayCivilopediaKey = rawBiqCivilopediaKey || rawCivilopediaKey || String(entry && entry.civilopediaKey || '').trim() || lookupCivilopediaKey;
        const thumbPath =
          tabSpec.key === 'civilizations'
            ? (pedia.iconPaths[0] || pedia.racePaths[0] || pedia.iconPaths[pedia.iconPaths.length - 1] || '')
            : (pedia.iconPaths[pedia.iconPaths.length - 1] || pedia.iconPaths[0] || '');

        const section1SourcePath = lookupCivilopediaKey
          ? findLayerPathForKey(civilopediaSectionsByLayer, civilopediaLayers, lookupCivilopediaKey, layerOrder)
          : '';
        const section2SourcePath = lookupCivilopediaKey
          ? (
            findLayerPathForKey(civilopediaSectionsByLayer, civilopediaLayers, `DESC_${lookupCivilopediaKey}`, layerOrder)
            || section1SourcePath
          )
          : '';
        const iconBlockSourcePath = lookupCivilopediaKey
          ? (
            findLayerPathForKey(pediaBlocksByLayer, pediaIconLayers, `ICON_${lookupCivilopediaKey}`, layerOrder)
            || findLayerPathForKey(pediaBlocksByLayer, pediaIconLayers, `WON_SPLASH_${lookupCivilopediaKey}`, layerOrder)
            || findLayerPathForKey(pediaBlocksByLayer, pediaIconLayers, lookupCivilopediaKey, layerOrder)
            || findLayerPathForKey(pediaBlocksByLayer, pediaIconLayers, `${lookupCivilopediaKey}_LARGE`, layerOrder)
            || findLayerPathForKey(pediaBlocksByLayer, pediaIconLayers, `ICON_RACE_${lookupCivilopediaKey.replace(/^RACE_/, '')}`, layerOrder)
          )
          : '';
        const eraAnimFallbackKey = lookupCivilopediaKey.includes('_ERAS_')
          ? `ANIMNAME_${String(lookupCivilopediaKey || '').split('_ERAS_')[0]}`
          : '';
        const animSourcePath = lookupCivilopediaKey
          ? findLayerPathForKey(pediaBlocksByLayer, pediaIconLayers, `ANIMNAME_${lookupCivilopediaKey}`, layerOrder)
          || (eraAnimFallbackKey ? findLayerPathForKey(pediaBlocksByLayer, pediaIconLayers, eraAnimFallbackKey, layerOrder) : '')
          || iconBlockSourcePath
          : '';
        const biqRecord = entry && entry.biqRecord
          ? entry.biqRecord
          : biqRecordByCivilopediaKey.get(lookupCivilopediaKey);
        const rawBiqFields = (biqRecord && Array.isArray(biqRecord.fields))
          ? biqRecord.fields.filter((f) => String(f.key || '').toLowerCase() !== 'civilopediaentry').map((f) => ({
            key: f.key,
            baseKey: f.baseKey || String(f.key || '').replace(/_\d+$/, ''),
            label: f.label || toTitleFromKey(f.key),
            value: cleanDisplayText(f.value),
            originalValue: cleanDisplayText(f.value),
            editable: !!f.editable,
            expectedSetter: String(f.expectedSetter || '')
          }))
          : [];
        let biqFields = rawBiqFields;
        if (tabSpec.key === 'improvements') {
          biqFields = projectImprovementBiqFields({
            rawFields: rawBiqFields,
            civilopediaEntry: displayCivilopediaKey,
            flavorCount
          });
        } else if (tabSpec.key === 'resources') {
          biqFields = projectResourceBiqFields({
            rawFields: rawBiqFields,
            civilopediaEntry: displayCivilopediaKey
          });
        } else if (tabSpec.key === 'civilizations') {
          biqFields = projectCivilizationBiqFields({
            rawFields: rawBiqFields,
            civilopediaEntry: displayCivilopediaKey,
            flavorCount
          });
        } else if (tabSpec.key === 'governments') {
          biqFields = projectGovernmentBiqFields({
            rawFields: rawBiqFields,
            civilopediaEntry: displayCivilopediaKey,
            governmentNames
          });
        } else if (tabSpec.key === 'technologies') {
          biqFields = projectTechnologyBiqFields({
            rawFields: rawBiqFields,
            civilopediaEntry: displayCivilopediaKey,
            flavorCount
          });
        } else if (tabSpec.key === 'units') {
          biqFields = projectUnitBiqFields({
            rawFields: rawBiqFields,
            civilopediaEntry: displayCivilopediaKey
          });
        }
        const biqImprovementKind = tabSpec.key === 'improvements' && rawBiqFields.length > 0
          ? inferImprovementKindFromBiqFields(biqFields)
          : '';
        const preferredNameBaseKey = tabSpec.key === 'civilizations' ? 'civilizationname' : 'name';
        const biqNameField = biqFields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === preferredNameBaseKey);
        const fallbackBiqNameField = preferredNameBaseKey === 'name'
          ? null
          : biqFields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === 'name');
        const biqDisplayName = String(((biqNameField || fallbackBiqNameField) && (biqNameField || fallbackBiqNameField).value) || '').trim();
        const pediaHeadingName = String((section1Lines && section1Lines[0]) || '').trim();
        let displayName = inferredDisplayName;
        if (tabSpec.key === 'improvements') {
          if (biqDisplayName) displayName = biqDisplayName;
          else if (isLikelyDisplayHeading(pediaHeadingName)) displayName = pediaHeadingName;
        } else if (biqDisplayName) {
          displayName = biqDisplayName;
        }

        return {
          id: Number.isFinite(entry && entry.biqIndex)
            ? `biq-${String(biqSectionCode || '').toLowerCase()}-${Number(entry.biqIndex)}`
            : (lookupCivilopediaKey || `${tabSpec.key}-${entrySeeds.indexOf(entry)}`),
          civilopediaKey: lookupCivilopediaKey,
          lookupCivilopediaKey,
          displayCivilopediaKey,
          rawCivilopediaKey,
          rawBiqCivilopediaKey,
          linkCivilopediaKey: rawCivilopediaKey || displayCivilopediaKey,
          biqIndex: Number.isFinite(entry && entry.biqIndex)
            ? Number(entry.biqIndex)
            : (biqRecord ? Number(biqRecord.index) : null),
          prtoStrategyRowIndexes: tabSpec.key === 'units' && Array.isArray(entry && entry.prtoStrategyRowIndexes)
            ? entry.prtoStrategyRowIndexes.slice()
            : [],
          name: displayName,
          civilopediaSection1: section1RawText,
          originalCivilopediaSection1: section1RawText,
          civilopediaSection2: section2RawText,
          originalCivilopediaSection2: section2RawText,
          techDependencies: tabSpec.key === 'technologies' ? [] : extractTechDependenciesFromText(section1Lines),
          improvementKind: tabSpec.key === 'improvements' ? (biqImprovementKind || improvementKindsByKey[lookupCivilopediaKey] || 'normal') : null,
          iconPaths: pedia.iconPaths,
          originalIconPaths: [...(pedia.originalIconPaths || pedia.iconPaths)],
          buildingIconKind: tabSpec.key === 'improvements' ? (pedia.buildingIconKind || '') : '',
          originalBuildingIconKind: tabSpec.key === 'improvements' ? (pedia.buildingIconKind || '') : '',
          buildingIconIndex: tabSpec.key === 'improvements' ? (pedia.buildingIconIndex || '') : '',
          originalBuildingIconIndex: tabSpec.key === 'improvements' ? (pedia.buildingIconIndex || '') : '',
          wonderSplashPath: tabSpec.key === 'improvements' ? (pedia.wonderSplashPath || '') : '',
          originalWonderSplashPath: tabSpec.key === 'improvements' ? (pedia.wonderSplashPath || '') : '',
          racePaths: pedia.racePaths,
          originalRacePaths: [...pedia.racePaths],
          thumbPath,
          animationName: pedia.animationName,
          originalAnimationName: pedia.animationName,
          biqSectionCode,
          biqSectionTitle: biqSectionCode,
          biqFields,
          improvementFlavorCount: tabSpec.key === 'improvements' ? flavorCount : 0,
          civilizationFlavorCount: tabSpec.key === 'civilizations' ? flavorCount : 0,
          technologyFlavorCount: tabSpec.key === 'technologies' ? flavorCount : 0,
          sourceMeta: {
            civilopediaSection1: { source: 'Civilopedia', readPath: section1SourcePath, writePath: scenarioCivilopediaWritePath },
            civilopediaSection2: { source: 'Civilopedia', readPath: section2SourcePath, writePath: scenarioCivilopediaWritePath },
            iconPaths: { source: 'PediaIcons', readPath: iconBlockSourcePath, writePath: scenarioPediaIconsWritePath },
            animationName: { source: 'PediaIcons', readPath: animSourcePath, writePath: scenarioPediaIconsWritePath },
            biq: {
              source: 'BIQ',
              readPath: (options.biqTab && options.biqTab.sourcePath) || '',
              writePath: mode === 'scenario' ? ((options.biqTab && options.biqTab.sourcePath) || '') : ''
            }
          }
        };
      });

    if (!hasOrderedBiqSeeds) {
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }

    if (!hasOrderedBiqSeeds && biqKeySets && biqKeySets[tabSpec.key] instanceof Set && biqKeySets[tabSpec.key].size > 0) {
      const allowedKeys = biqKeySets[tabSpec.key];
      entries = entries.filter((entry) => {
        const key = String(entry.lookupCivilopediaKey || entry.civilopediaKey || '').toUpperCase();
        if (allowedKeys.has(key)) return true;
        if (tabSpec.key === 'units' && key.startsWith('PRTO_') && key.includes('_ERAS_')) {
          const baseKey = key.split('_ERAS_')[0];
          return allowedKeys.has(baseKey);
        }
        return false;
      });
    }

    if (!hasOrderedBiqSeeds && (tabSpec.key === 'civilizations' || tabSpec.key === 'resources') && options.biqTab && Array.isArray(options.biqTab.sections)) {
      const syntheticSectionCode = tabSpec.key === 'civilizations' ? 'RACE' : 'GOOD';
      const syntheticSection = options.biqTab.sections.find((s) => String(s && s.code || '').toUpperCase() === syntheticSectionCode);
      const syntheticRecords = Array.isArray(syntheticSection && syntheticSection.fullRecords)
        ? syntheticSection.fullRecords
        : (syntheticSection && Array.isArray(syntheticSection.records) ? syntheticSection.records : []);
      const seenSyntheticIndexes = new Set(
        entries
          .map((entry) => (Number.isFinite(entry && entry.biqIndex) ? Number(entry.biqIndex) : NaN))
          .filter((n) => Number.isFinite(n))
      );
      const seenSyntheticKeys = new Set(entries.map((entry) => String(entry && (entry.lookupCivilopediaKey || entry.civilopediaKey) || '').toUpperCase()).filter(Boolean));
      syntheticRecords.forEach((record) => {
        const idx = Number(record && record.index);
        if (!Number.isFinite(idx) || seenSyntheticIndexes.has(idx)) return;
        const civilopediaEntry = String(getRecordFieldValue(record, syntheticSectionCode, 'civilopediaentry') || '').trim();
        const lookupCivilopediaEntry = civilopediaEntry.toUpperCase();
        if (syntheticSectionCode === 'RACE' && lookupCivilopediaEntry === 'RACE_BARBARIANS') return;
        if (lookupCivilopediaEntry && seenSyntheticKeys.has(lookupCivilopediaEntry)) return;
        const recordName = cleanDisplayText(record && record.name || '') || `${syntheticSectionCode} ${Number.isFinite(idx) ? idx + 1 : '?'}`;
        // Prefer the enriched record (section.records) if available — it has display-formatted fields.
        // fullRecords have raw english text; section.records have fields processed by enrichBridgeSections.
        const enrichedRecord = Array.isArray(syntheticSection.records)
          ? syntheticSection.records.find((r) => Number(r && r.index) === idx)
          : null;
        const rawRecordFields = (enrichedRecord && Array.isArray(enrichedRecord.fields) && enrichedRecord.fields.length > 0)
          ? enrichedRecord.fields
          : getRecordFieldsForSection(record, syntheticSectionCode);
        const rawBiqFields = rawRecordFields
          .filter((f) => String(f && (f.baseKey || f.key) || '').toLowerCase() !== 'civilopediaentry')
          .map((f) => ({
            key: f.key,
            baseKey: f.baseKey || String(f.key || '').replace(/_\d+$/, ''),
            label: f.label || toTitleFromKey(f.key),
            value: cleanDisplayText(f.value),
            originalValue: cleanDisplayText(f.originalValue == null ? f.value : f.originalValue),
            editable: !!f.editable,
            expectedSetter: String(f.expectedSetter || '')
          }));
        const biqSourcePath = (options.biqTab && options.biqTab.sourcePath) || '';
        const fallbackCivilopediaEntry = civilopediaEntry || `${syntheticSectionCode}_${recordName.replace(/\s+/g, '_')}`;
        const lookupFallbackCivilopediaEntry = fallbackCivilopediaEntry.toUpperCase();
        let biqFields = rawBiqFields;
        if (tabSpec.key === 'civilizations') {
          biqFields = projectCivilizationBiqFields({ rawFields: rawBiqFields, civilopediaEntry: fallbackCivilopediaEntry, flavorCount });
        } else if (tabSpec.key === 'resources') {
          biqFields = projectResourceBiqFields({ rawFields: rawBiqFields, civilopediaEntry: fallbackCivilopediaEntry });
        }
        const preferredNameBaseKey = tabSpec.key === 'civilizations' ? 'civilizationname' : 'name';
        const biqNameField = biqFields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === preferredNameBaseKey)
          || biqFields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === 'name');
        const displayName = (biqNameField && biqNameField.value) ? String(biqNameField.value).trim() : recordName;
        const syntheticPedia = mapPediaIconsForKey(pediaBlocks, lookupFallbackCivilopediaEntry);
        const syntheticThumbPath = tabSpec.key === 'civilizations'
          ? (syntheticPedia.iconPaths[0] || syntheticPedia.racePaths[0] || syntheticPedia.iconPaths[syntheticPedia.iconPaths.length - 1] || '')
          : (syntheticPedia.iconPaths[syntheticPedia.iconPaths.length - 1] || syntheticPedia.iconPaths[0] || '');
        entries.push({
          id: `biq-${syntheticSectionCode.toLowerCase()}-${Number.isFinite(idx) ? idx : displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          civilopediaKey: lookupCivilopediaEntry || '',
          displayCivilopediaKey: civilopediaEntry || '',
          lookupCivilopediaKey: lookupCivilopediaEntry || '',
          rawCivilopediaKey: (civilopediaSections[lookupCivilopediaEntry] && civilopediaSections[lookupCivilopediaEntry].rawKey) || civilopediaEntry || '',
          rawBiqCivilopediaKey: civilopediaEntry || '',
          linkCivilopediaKey: (civilopediaSections[lookupCivilopediaEntry] && civilopediaSections[lookupCivilopediaEntry].rawKey) || civilopediaEntry || '',
          biqIndex: Number.isFinite(idx) ? idx : null,
          name: displayName,
          civilopediaSection1: '',
          originalCivilopediaSection1: '',
          civilopediaSection2: '',
          originalCivilopediaSection2: '',
          techDependencies: [],
          improvementKind: null,
          iconPaths: syntheticPedia.iconPaths,
          originalIconPaths: [...(syntheticPedia.originalIconPaths || syntheticPedia.iconPaths)],
          buildingIconKind: '',
          originalBuildingIconKind: '',
          buildingIconIndex: '',
          originalBuildingIconIndex: '',
          wonderSplashPath: '',
          originalWonderSplashPath: '',
          racePaths: syntheticPedia.racePaths,
          originalRacePaths: [...syntheticPedia.racePaths],
          thumbPath: syntheticThumbPath,
          animationName: syntheticPedia.animationName,
          originalAnimationName: syntheticPedia.animationName,
          biqSectionCode: syntheticSectionCode,
          biqSectionTitle: syntheticSectionCode,
          biqFields,
          improvementFlavorCount: 0,
          civilizationFlavorCount: tabSpec.key === 'civilizations' ? flavorCount : 0,
          technologyFlavorCount: 0,
          sourceMeta: {
            civilopediaSection1: { source: 'BIQ', readPath: biqSourcePath, writePath: mode === 'scenario' ? biqSourcePath : '' },
            civilopediaSection2: { source: 'BIQ', readPath: biqSourcePath, writePath: mode === 'scenario' ? biqSourcePath : '' },
            iconPaths: { source: 'BIQ', readPath: biqSourcePath, writePath: mode === 'scenario' ? biqSourcePath : '' },
            animationName: { source: 'BIQ', readPath: biqSourcePath, writePath: mode === 'scenario' ? biqSourcePath : '' },
            biq: { source: 'BIQ', readPath: biqSourcePath, writePath: mode === 'scenario' ? biqSourcePath : '' }
          },
          syntheticBiqOnly: true
        });
        seenSyntheticIndexes.add(idx);
        if (lookupCivilopediaEntry) seenSyntheticKeys.add(lookupCivilopediaEntry);
      });
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }

    if (!hasOrderedBiqSeeds && tabSpec.key === 'units' && options.biqTab && Array.isArray(options.biqTab.sections)) {
      const prtoSection = options.biqTab.sections.find((section) => String(section && section.code || '').toUpperCase() === 'PRTO');
      const prtoRecords = Array.isArray(prtoSection && prtoSection.fullRecords)
        ? prtoSection.fullRecords
        : (prtoSection && Array.isArray(prtoSection.records) ? prtoSection.records : []);
      const seenIndexes = new Set(
        entries
          .map((entry) => (Number.isFinite(entry && entry.biqIndex) ? Number(entry.biqIndex) : NaN))
          .filter((n) => Number.isFinite(n))
      );
      const seenCivilopediaKeys = new Set(entries.map((entry) => String(entry && (entry.lookupCivilopediaKey || entry.civilopediaKey) || '').toUpperCase()).filter(Boolean));
      prtoRecords.forEach((record) => {
        const idx = Number(record && record.index);
        if (!Number.isFinite(idx) || seenIndexes.has(idx)) return;
        if (isPrtoStrategyMapRecord(record)) return;
        const civilopediaEntry = String(getRecordFieldValue(record, 'PRTO', 'civilopediaentry') || '').trim();
        const lookupCivilopediaEntry = civilopediaEntry.toUpperCase();
        if (lookupCivilopediaEntry && seenCivilopediaKeys.has(lookupCivilopediaEntry)) return;
        entries.push(buildSyntheticUnitReferenceEntry(record, (options.biqTab && options.biqTab.sourcePath) || '', mode));
        seenIndexes.add(idx);
        if (lookupCivilopediaEntry) seenCivilopediaKeys.add(lookupCivilopediaEntry);
      });
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }

    tabs[tabSpec.key] = {
      title: tabSpec.title,
      type: 'reference',
      readOnly: true,
      recordOps: [],
      sourcePath:
        ((includeScenarioLayer && civilopediaLayers.scenario && civilopediaLayers.scenario.text) ? civilopediaLayers.scenario.filePath : '')
        || (civilopediaLayers.conquests && civilopediaLayers.conquests.filePath)
        || '',
      sourceDetails: {
        civilopediaVanilla: (civilopediaLayers.vanilla && civilopediaLayers.vanilla.filePath) || '',
        civilopediaPtw: (civilopediaLayers.ptw && civilopediaLayers.ptw.filePath) || '',
        civilopediaConquests: (civilopediaLayers.conquests && civilopediaLayers.conquests.filePath) || '',
        civilopediaScenario: scenarioCivilopediaWritePath,
        civilopediaActiveEncoding: (pickHighestLayerText(civilopediaLayers) && pickHighestLayerText(civilopediaLayers).encoding) || '',
        civilopediaScenarioEncoding: (civilopediaLayers.scenario && civilopediaLayers.scenario.encoding) || '',
        civilopediaScenarioBom: !!(civilopediaLayers.scenario && civilopediaLayers.scenario.bom),
        pediaIconsVanilla: (pediaIconLayers.vanilla && pediaIconLayers.vanilla.filePath) || '',
        pediaIconsPtw: (pediaIconLayers.ptw && pediaIconLayers.ptw.filePath) || '',
        pediaIconsConquests: (pediaIconLayers.conquests && pediaIconLayers.conquests.filePath) || '',
        pediaIconsScenario: (pediaIconLayers.scenario && pediaIconLayers.scenario.filePath) || '',
        pediaIconsScenarioWrite: scenarioPediaIconsWritePath,
        pediaIconsActiveEncoding: (pickHighestLayerText(pediaIconLayers) && pickHighestLayerText(pediaIconLayers).encoding) || '',
        pediaIconsScenarioEncoding: (pediaIconLayers.scenario && pediaIconLayers.scenario.encoding) || '',
        pediaIconsScenarioBom: !!(pediaIconLayers.scenario && pediaIconLayers.scenario.bom),
        diplomacyVanilla: (diplomacyLayers.vanilla && diplomacyLayers.vanilla.filePath) || '',
        diplomacyPtw: (diplomacyLayers.ptw && diplomacyLayers.ptw.filePath) || '',
        diplomacyConquests: (diplomacyLayers.conquests && diplomacyLayers.conquests.filePath) || '',
        diplomacyScenario: (diplomacyLayers.scenario && diplomacyLayers.scenario.filePath) || '',
        diplomacyScenarioWrite: scenarioDiplomacyWritePath,
        diplomacyActive: (diplomacyTopLayer && diplomacyTopLayer.filePath) || '',
        diplomacyActiveEncoding: (diplomacyTopLayer && diplomacyTopLayer.encoding) || '',
        diplomacyScenarioEncoding: (diplomacyLayers.scenario && diplomacyLayers.scenario.encoding) || '',
        diplomacyScenarioBom: !!(diplomacyLayers.scenario && diplomacyLayers.scenario.bom)
      },
      entries,
      diplomacyOptions: tabSpec.key === 'civilizations' ? diplomacyOptions : [],
      diplomacySlots: tabSpec.key === 'civilizations'
        ? diplomacySlots.map((slot) => ({
          index: Number(slot && slot.index),
          firstContact: String(slot && slot.firstContact || ''),
          originalFirstContact: String(slot && slot.firstContact || ''),
          firstDeal: String(slot && slot.firstDeal || ''),
          originalFirstDeal: String(slot && slot.firstDeal || '')
        }))
        : [],
      diplomacyText: tabSpec.key === 'civilizations' ? String((diplomacyTopLayer && diplomacyTopLayer.text) || '') : '',
      originalDiplomacyText: tabSpec.key === 'civilizations' ? String((diplomacyTopLayer && diplomacyTopLayer.text) || '') : ''
    };
  }

  return tabs;
}

function buildMapTabFromBiq(biqTab, mode, options = {}) {
  const sections = (biqTab && Array.isArray(biqTab.sections)) ? biqTab.sections.map((section) => ({
    ...section,
    records: Array.isArray(section && section.records)
      ? section.records.map((record, index) => {
        const rawRecord = Array.isArray(section && section.fullRecords) ? section.fullRecords[index] : null;
        const recordClone = { ...(rawRecord || {}), ...record };
        const rawFields = Array.isArray(rawRecord && rawRecord.fields)
          ? rawRecord.fields
          : (Array.isArray(record && record.fields)
            ? record.fields
            : parseEnglishFields(String(section && section.code || ''), String(rawRecord && rawRecord.english || '')));
        rawFields.forEach((field) => {
          const baseKey = String(field && (field.baseKey || field.key) || '').trim();
          if (!baseKey) return;
          const canonical = String(baseKey).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
          const alreadyPresent = Object.keys(recordClone).some((key) => String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') === canonical);
          if (alreadyPresent) return;
          recordClone[baseKey] = cleanDisplayText(field && field.value);
        });
        recordClone.fields = Array.isArray(record && record.fields)
          ? record.fields.map((field) => {
            const baseKey = field && (field.baseKey || field.key);
            const canonical = String(baseKey || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            let rawValue = field && field.value;
            if (canonical) {
              const keys = Object.keys(recordClone);
              for (let i = 0; i < keys.length; i += 1) {
                const key = keys[i];
                const keyCanonical = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
                if (keyCanonical !== canonical) continue;
                rawValue = recordClone[key];
                break;
              }
            }
            return {
              ...field,
              baseKey: field.baseKey || String(field.key || '').replace(/_\d+$/, ''),
              originalValue: cleanDisplayText(rawValue)
            };
          })
          : [];
        return recordClone;
      })
      : []
  })) : [];
  const hasMapData = sections.some((s) => s.code === 'TILE') && sections.some((s) => s.code === 'WMAP');
  return {
    title: 'Map',
    type: 'map',
    readOnly: mode !== 'scenario',
    sourcePath: (biqTab && biqTab.sourcePath) || '',
    error: (biqTab && biqTab.error) || '',
    hasMapData,
    originalHasMap: hasMapData,
    mapMutation: null,
    mapMutationSource: null,
    recordOps: [],
    scenarioDistricts: options.scenarioDistricts || null,
    sections
  };
}

function isBiqMapImportSectionCode(code) {
  return ['WCHR', 'WMAP', 'TILE', 'CONT'].includes(String(code || '').trim().toUpperCase());
}

function getRecordFieldByBaseKey(record, baseKey) {
  if (!record || !Array.isArray(record.fields)) return null;
  const canonical = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetRaw = String(baseKey || '').trim().toLowerCase();
  const targetCanonical = canonical(baseKey);
  return record.fields.find((field) => {
    const keyRaw = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
    return keyRaw === targetRaw || canonical(keyRaw) === targetCanonical;
  }) || null;
}

function setRecordFieldByBaseKey(record, baseKey, value) {
  const field = getRecordFieldByBaseKey(record, baseKey);
  const nextValue = String(value == null ? '' : value);
  if (field) {
    field.value = nextValue;
    field.originalValue = nextValue;
  }
  if (record && typeof record === 'object') {
    const canonical = (text) => String(text || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = canonical(baseKey);
    Object.keys(record).forEach((key) => {
      if (canonical(key) === target) record[key] = nextValue;
    });
  }
  return !!field;
}

function getMapImportFieldInt(record, baseKey, fallback = 0) {
  const field = getRecordFieldByBaseKey(record, baseKey);
  if (field) return parseIntLoose(field.value, fallback);
  if (record && typeof record === 'object') {
    const canonical = (text) => String(text || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = canonical(baseKey);
    const key = Object.keys(record).find((candidate) => canonical(candidate) === target);
    if (key) return parseIntLoose(record[key], fallback);
  }
  return fallback;
}

function cloneMapImportSection(section) {
  return section ? JSON.parse(JSON.stringify(section)) : null;
}

function findMapImportSection(sections, code) {
  const target = String(code || '').trim().toUpperCase();
  return (Array.isArray(sections) ? sections : []).find((section) => String(section && section.code || '').trim().toUpperCase() === target) || null;
}

function buildImportedTerrainOverlayMapSectionsFromMapTab(sourceMapTab) {
  const sourceSections = Array.isArray(sourceMapTab && sourceMapTab.sections) ? sourceMapTab.sections : [];
  const wchr = cloneMapImportSection(findMapImportSection(sourceSections, 'WCHR'));
  const wmap = cloneMapImportSection(findMapImportSection(sourceSections, 'WMAP'));
  const sourceTile = cloneMapImportSection(findMapImportSection(sourceSections, 'TILE'));
  const cont = cloneMapImportSection(findMapImportSection(sourceSections, 'CONT'));
  if (!wmap || !sourceTile) {
    throw new Error('Selected scenario is missing required WMAP/TILE map sections.');
  }
  if (Array.isArray(wmap.records) && wmap.records[0]) {
    setRecordFieldByBaseKey(wmap.records[0], 'numresources', '0');
  }
  const sanitizeTileRecord = (record) => {
    const next = cloneMapImportSection(record) || {};
    setRecordFieldByBaseKey(next, 'border', '0');
    setRecordFieldByBaseKey(next, 'resource', '-1');
    setRecordFieldByBaseKey(next, 'barbariantribe', '-1');
    setRecordFieldByBaseKey(next, 'city', '-1');
    setRecordFieldByBaseKey(next, 'colony', '-1');
    return next;
  };
  const tile = {
    ...sourceTile,
    records: Array.isArray(sourceTile.records) ? sourceTile.records.map(sanitizeTileRecord) : []
  };
  const emptySection = (code) => ({
    code,
    title: code,
    records: []
  });
  return [
    ...(wchr ? [wchr] : []),
    wmap,
    tile,
    ...(cont ? [cont] : []),
    emptySection('SLOC'),
    emptySection('CITY'),
    emptySection('UNIT'),
    emptySection('CLNY')
  ];
}

function buildMapImportBiqTab(biqTab) {
  const mapSections = (Array.isArray(biqTab && biqTab.sections) ? biqTab.sections : [])
    .filter((section) => isBiqMapImportSectionCode(section && section.code));
  return {
    ...(biqTab || {}),
    sections: mapSections
  };
}

function loadMapImport(payload = {}) {
  const startedAt = Date.now();
  const mode = 'scenario';
  const civ3Path = payload.civ3Path || '';
  const scenarioPath = String(payload.scenarioPath || '').trim();
  if (!/\.biq$/i.test(scenarioPath)) {
    throw new Error('Choose a source scenario BIQ file to import a map.');
  }
  log.info('loadMapImport', `Loading map-only import source: ${log.rel(scenarioPath)}`);
  const biqTab = loadBiqTab({
    mode,
    civ3Path,
    scenarioPath,
    textEncoding: payload.textFileEncoding || payload.textEncoding || 'windows-1252'
  });
  if (biqTab && biqTab.error) throw new Error(biqTab.error);
  const mapTab = buildMapTabFromBiq(buildMapImportBiqTab(biqTab), mode);
  if (!detectBiqHasMapData({ sections: mapTab.sections })) {
    throw new Error('Selected scenario does not contain a map.');
  }
  const importedSections = buildImportedTerrainOverlayMapSectionsFromMapTab(mapTab);
  const wmap = findMapImportSection(importedSections, 'WMAP');
  const tile = findMapImportSection(importedSections, 'TILE');
  const wmapRecord = wmap && Array.isArray(wmap.records) ? wmap.records[0] : null;
  const width = getMapImportFieldInt(wmapRecord, 'width', 0);
  const height = getMapImportFieldInt(wmapRecord, 'height', 0);
  const tileCount = tile && Array.isArray(tile.records) ? tile.records.length : 0;
  const durationMs = Date.now() - startedAt;
  log.info('loadMapImport', `Complete — ${width}x${height}, tiles=${tileCount}, sections=${importedSections.length}, durationMs=${durationMs}`);
  return {
    ok: true,
    sourceScenarioPath: scenarioPath,
    importedSections,
    width,
    height,
    tileCount,
    compressedSource: !!biqTab.compressedSource,
    textEncoding: biqTab.textEncoding || '',
    durationMs
  };
}

function detectBiqHasMapData(biqTab) {
  const sections = (biqTab && Array.isArray(biqTab.sections)) ? biqTab.sections : [];
  const wmapSection = sections.find((section) => String(section && section.code || '').toUpperCase() === 'WMAP');
  const tileSection = sections.find((section) => String(section && section.code || '').toUpperCase() === 'TILE');
  const wmapCount = Number(
    (wmapSection && wmapSection.count)
      || (Array.isArray(wmapSection && wmapSection.records) ? wmapSection.records.length : 0)
      || 0
  );
  const tileCount = Number(
    (tileSection && tileSection.count)
      || (Array.isArray(tileSection && tileSection.records) ? tileSection.records.length : 0)
      || 0
  );
  return !!(wmapSection && tileSection && wmapCount > 0 && tileCount > 0);
}

function buildDeferredMapTab(biqTab, mode, options = {}) {
  const hasMapData = detectBiqHasMapData(biqTab);
  return {
    title: 'Map',
    type: 'map',
    readOnly: mode !== 'scenario',
    sourcePath: (biqTab && biqTab.sourcePath) || '',
    error: (biqTab && biqTab.error) || '',
    hasMapData,
    originalHasMap: hasMapData,
    mapMutation: null,
    mapMutationSource: null,
    recordOps: [],
    scenarioDistricts: options.scenarioDistricts || null,
    sections: [],
    deferred: true
  };
}

function materializeMapTab(payload = {}) {
  const mode = payload.mode === 'scenario' ? 'scenario' : 'global';
  const biqTab = payload.biqTab || payload.biq || null;
  const existingMapTab = payload.mapTab && typeof payload.mapTab === 'object' ? payload.mapTab : null;
  const supportingTabs = payload.tabs && typeof payload.tabs === 'object' ? payload.tabs : {};
  const scenarioDistricts = Object.prototype.hasOwnProperty.call(payload, 'scenarioDistricts')
    ? payload.scenarioDistricts
    : (existingMapTab && existingMapTab.scenarioDistricts) || null;
  const mapTab = buildMapTabFromBiq(biqTab, mode, { scenarioDistricts });
  mapTab.recordOps = Array.isArray(existingMapTab && existingMapTab.recordOps) ? existingMapTab.recordOps : [];
  mapTab.mapMutation = existingMapTab && existingMapTab.mapMutation ? existingMapTab.mapMutation : null;
  mapTab.mapMutationSource = existingMapTab && existingMapTab.mapMutationSource ? existingMapTab.mapMutationSource : null;
  mapTab.pendingMapResize = existingMapTab && existingMapTab.pendingMapResize ? existingMapTab.pendingMapResize : null;
  applyScenarioDistrictsToMapTab(mapTab, supportingTabs);
  return mapTab;
}

function buildBiqStructureTabs(biqTab, mode) {
  const sections = (biqTab && Array.isArray(biqTab.sections)) ? biqTab.sections : [];
  const headerTitle = cleanDisplayText((biqTab && biqTab.biqTitle) || '');
  const headerDescription = cleanDisplayText((biqTab && biqTab.biqDescription) || '');
  const byCode = new Map();
  sections.forEach((section) => {
    byCode.set(String(section.code || '').toUpperCase(), section);
  });
  const tabs = {};
  BIQ_STRUCTURE_TAB_SPECS.forEach((spec) => {
    const selectedSections = spec.sectionCodes
      .map((code) => byCode.get(String(code || '').toUpperCase()))
      .filter(Boolean)
      .map((section) => ({
        ...section,
        records: Array.isArray(section.records)
          ? section.records.map((record) => ({
            ...record,
            fields: Array.isArray(record.fields)
              ? record.fields.map((field) => ({
                ...field,
                baseKey: field.baseKey || String(field.key || '').replace(/_\d+$/, ''),
                originalValue: cleanDisplayText(field.value)
              }))
              : []
          }))
          : []
      }));
    if (spec.key === 'scenarioSettings') {
      selectedSections.forEach((section) => {
        if (String(section && section.code || '').toUpperCase() !== 'GAME') return;
        const firstRecord = Array.isArray(section.records) ? section.records[0] : null;
        if (!firstRecord) return;
        if (!Array.isArray(firstRecord.fields)) firstRecord.fields = [];
        const hasBaseKey = (targetKey) => {
          const normalized = String(targetKey || '').trim().toLowerCase();
          return firstRecord.fields.some((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === normalized);
        };
        if (!hasBaseKey('title')) {
          firstRecord.fields.push({
            key: 'title',
            baseKey: 'title',
            label: 'Title',
            value: headerTitle,
            originalValue: headerTitle
          });
        }
        if (!hasBaseKey('description')) {
          firstRecord.fields.push({
            key: 'description',
            baseKey: 'description',
            label: 'Description',
            value: headerDescription,
            originalValue: headerDescription
          });
        }
      });
    }
    tabs[spec.key] = {
      key: spec.key,
      title: spec.title,
      type: 'biqStructure',
      readOnly: mode !== 'scenario',
      sourcePath: (biqTab && biqTab.sourcePath) || '',
      error: (biqTab && biqTab.error) || '',
      bridgeError: (biqTab && biqTab.bridgeError) || '',
      sections: selectedSections
    };
  });
  return tabs;
}

function ensureTrailingNewline(text) {
  if (!text.endsWith('\n')) {
    return `${text}\n`;
  }
  return text;
}

function parseCivilopediaDocumentWithOrder(text) {
  const src = String(text || '');
  const order = [];
  const sections = {};
  const items = [];
  const preamble = [];
  if (!text) return { order, sections, items, preamble, hadTrailingNewline: false, lineEnding: '\n' };
  const lines = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let currentKey = '';
  let currentHeader = '';
  let currentLines = [];
  const flush = () => {
    if (!currentKey) return;
    const item = { key: currentKey, headerKey: currentHeader || currentKey, rawLines: currentLines.slice() };
    items.push(item);
    sections[currentKey] = item;
    if (!order.includes(currentKey)) order.push(currentKey);
  };
  lines.forEach((line) => {
    if (line.startsWith('#')) {
      flush();
      currentHeader = line.slice(1);
      currentKey = currentHeader.trim().toUpperCase();
      if (!currentKey) {
        currentHeader = '';
        currentLines = [];
        return;
      }
      currentLines = [];
      return;
    }
    if (currentKey) currentLines.push(line);
    else preamble.push(line);
  });
  flush();
  return {
    order,
    sections,
    items,
    preamble,
    hadTrailingNewline: /\r\n$|\n$|\r$/.test(src),
    lineEnding: detectDominantLineEnding(src)
  };
}

function serializeCivilopediaDocumentWithOrder(doc) {
  const order = Array.isArray(doc && doc.order) ? doc.order : [];
  const sections = (doc && doc.sections) || {};
  const items = Array.isArray(doc && doc.items) ? doc.items : null;
  const preamble = Array.isArray(doc && doc.preamble) ? doc.preamble : [];
  const hadTrailingNewline = !!(doc && doc.hadTrailingNewline);
  const lineEnding = (doc && doc.lineEnding === '\r\n') ? '\r\n' : '\n';
  const lines = [];
  preamble.forEach((line) => lines.push(String(line || '')));
  if (items && items.length > 0) {
    items.forEach((sectionItem) => {
      const key = String(sectionItem && sectionItem.key || '').trim().toUpperCase();
      if (!key) return;
      const headingRaw = (sectionItem && Object.prototype.hasOwnProperty.call(sectionItem, 'headerKey'))
        ? String(sectionItem.headerKey)
        : String(key);
      const heading = headingRaw.length > 0 ? headingRaw : String(key);
      const rawLines = Array.isArray(sectionItem && sectionItem.rawLines) ? sectionItem.rawLines : [];
      lines.push(`#${heading}`);
      rawLines.forEach((line) => lines.push(String(line || '')));
    });
  } else {
    order.forEach((rawKey) => {
      const key = String(rawKey || '').toUpperCase();
      if (!key || !sections[key]) return;
      const section = sections[key] || {};
      const headingRaw = (section && Object.prototype.hasOwnProperty.call(section, 'headerKey'))
        ? String(section.headerKey)
        : String(key);
      const heading = headingRaw.length > 0 ? headingRaw : String(key);
      const rawLines = Array.isArray(section.rawLines) ? section.rawLines : [];
      lines.push(`#${heading}`);
      rawLines.forEach((line) => lines.push(String(line || '')));
    });
  }
  const serialized = lines.join(lineEnding);
  return (hadTrailingNewline && !serialized.endsWith(lineEnding)) ? `${serialized}${lineEnding}` : serialized;
}

function parseIniLines(text) {
  const rows = [];
  const map = {};
  if (!text) {
    return { rows, map };
  }

  const lines = text.split(/\r?\n/);
  let pendingComments = [];
  const bracketDepth = (value) => {
    const raw = String(value || '');
    let depth = 0;
    let inQuotes = false;
    for (let idx = 0; idx < raw.length; idx += 1) {
      const ch = raw[idx];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (inQuotes) continue;
      if (ch === '[') depth += 1;
      else if (ch === ']' && depth > 0) depth -= 1;
    }
    return depth;
  };
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx];
    const trimmed = line.trim();
    if (trimmed.startsWith(';')) {
      pendingComments.push(line);
      continue;
    }
    if (!trimmed) {
      pendingComments = [];
      continue;
    }
    if (trimmed.startsWith('[')) {
      continue;
    }
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) {
      pendingComments = [];
      continue;
    }
    const key = match[1];
    const valueLines = [match[2]];
    while (bracketDepth(valueLines.join('\n')) > 0 && lineIdx + 1 < lines.length) {
      lineIdx += 1;
      valueLines.push(lines[lineIdx].trim());
    }
    const value = valueLines.join('\n').trim();
    rows.push({ key, value, leadingComments: pendingComments });
    pendingComments = [];
    map[key] = value;
  }

  return { rows, map };
}

function normalizeIniSectionName(raw) {
  const cleaned = raw.replace(/^\[+|\]+$/g, '').replace(/=/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length > 56) return null;
  if (!/[A-Za-z]/.test(cleaned)) return null;
  if (/^NOTE$/i.test(cleaned)) return null;
  return cleaned.replace(/\b\w/g, (m) => m.toUpperCase());
}

function parseIniSectionMap(text) {
  const sectionByKey = {};
  const sectionOrder = [];
  const seen = new Set();
  if (!text) {
    return { sectionByKey, sectionOrder };
  }

  const lines = text.split(/\r?\n/);
  let currentSection = 'General';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const section = normalizeIniSectionName(trimmed);
      if (section) {
        currentSection = section;
      }
      continue;
    }

    const keyMatch = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (keyMatch) {
      const key = keyMatch[1];
      sectionByKey[key] = currentSection;
      if (!seen.has(currentSection)) {
        seen.add(currentSection);
        sectionOrder.push(currentSection);
      }
    }
  }

  return { sectionByKey, sectionOrder };
}

function normalizeDocLine(line) {
  return line.replace(/\s+/g, ' ').trim();
}

function parseInlineDocBlock(commentLines) {
  const docs = {};
  let currentKey = null;
  let sawExplicitKey = false;

  for (const rawLine of commentLines) {
    const body = normalizeDocLine(rawLine.replace(/^;\s?/, ''));
    if (!body) {
      currentKey = null;
      continue;
    }

    const match = body.match(/^([A-Za-z0-9_]*_[A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (match) {
      currentKey = match[1];
      docs[currentKey] = match[2].trim();
      sawExplicitKey = true;
      continue;
    }

    if (sawExplicitKey && currentKey) {
      docs[currentKey] = `${docs[currentKey]} ${body}`.trim();
    }
  }

  return sawExplicitKey ? docs : null;
}

function parseIniFieldDocs(text) {
  const docs = {};
  if (!text) {
    return docs;
  }

  const lines = text.split(/\r?\n/);
  let commentBuffer = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(';')) {
      commentBuffer.push(trimmed);
      continue;
    }

    const keyMatch = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (keyMatch) {
      const key = keyMatch[1];
      if (commentBuffer.length > 0 && !docs[key]) {
        const inlineDocs = parseInlineDocBlock(commentBuffer);
        if (inlineDocs) {
          Object.keys(inlineDocs).forEach((inlineKey) => {
            if (!docs[inlineKey]) docs[inlineKey] = inlineDocs[inlineKey];
          });
        } else {
          const joined = commentBuffer
            .map((body) => normalizeDocLine(body.replace(/^;\s?/, '')))
            .filter(Boolean)
            .join(' ');
          if (joined) docs[key] = joined;
        }
      }
    }

    if (!trimmed || trimmed.startsWith('[') || keyMatch) {
      commentBuffer = [];
    }
  }
  return docs;
}

function parseSectionFieldDocs(text) {
  const docs = {};
  if (!text) {
    return docs;
  }

  const lines = text.split(/\r?\n/);
  let activeKey = null;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith(';')) {
      activeKey = null;
      continue;
    }
    const body = normalizeDocLine(trimmed.replace(/^;\s?/, ''));
    if (!body) {
      activeKey = null;
      continue;
    }

    const start = body.match(/^-+\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (start) {
      const key = start[1];
      const desc = start[2].trim();
      docs[key] = desc;
      activeKey = key;
      continue;
    }

    if (activeKey && !/^-+\s*[A-Za-z0-9_]+\s*:/.test(body)) {
      docs[activeKey] = `${docs[activeKey]} ${body}`.trim();
    }
  }

  return docs;
}

function inferBaseType(key, value) {
  const manifestType = C3X_BASE_MANIFEST[String(key || '').trim()];
  if (manifestType && manifestType.type) {
    return manifestType.type;
  }
  const v = String(value).trim().toLowerCase();
  if (v === 'true' || v === 'false') {
    return 'boolean';
  }
  if (/^-?\d+$/.test(v)) {
    return 'integer';
  }
  return 'string';
}

function buildBaseModel(defaultText, scenarioText, customText, mode, targetText) {
  const defaultParsed = parseIniLines(defaultText);
  const scenarioParsed = parseIniLines(scenarioText);
  const customParsed = parseIniLines(customText);
  const targetParsed = parseIniLines(targetText);

  const effective = { ...defaultParsed.map };
  if (mode === 'scenario') {
    Object.assign(effective, scenarioParsed.map);
    Object.assign(effective, customParsed.map);
  } else {
    Object.assign(effective, customParsed.map);
  }

  const orderedKeys = [];
  const keySet = new Set();

  for (const row of defaultParsed.rows) {
    orderedKeys.push(row.key);
    keySet.add(row.key);
  }

  for (const key of Object.keys(effective)) {
    if (!keySet.has(key)) {
      keySet.add(key);
      orderedKeys.push(key);
    }
  }

  const editableMap = Object.keys(targetParsed.map).length > 0 ? targetParsed.map : effective;

  const rows = orderedKeys.map((key) => {
    const defaultValue = defaultParsed.map[key] ?? '';
    const hasScenarioValue = Object.prototype.hasOwnProperty.call(scenarioParsed.map, key);
    const hasCustomValue = Object.prototype.hasOwnProperty.call(customParsed.map, key);
    const scenarioValue = hasScenarioValue ? scenarioParsed.map[key] : defaultValue;
    const customValue = hasCustomValue ? customParsed.map[key] : scenarioValue;
    const effectiveValue = effective[key] ?? '';
    const editableValue = editableMap[key] ?? effectiveValue;
    let source = 'default';
    if (hasCustomValue) {
      source = 'custom';
    } else if (mode === 'scenario' && hasScenarioValue) {
      source = 'scenario';
    }
    return {
      key,
      defaultValue,
      scenarioValue,
      customValue,
      effectiveValue,
      value: editableValue,
      hasScenarioValue,
      hasCustomValue,
      source,
      type: inferBaseType(key, defaultValue || effectiveValue || editableValue)
    };
  });

  const commentsByKey = {};
  for (const row of targetParsed.rows) {
    if (row.leadingComments && row.leadingComments.length > 0) {
      commentsByKey[row.key] = row.leadingComments;
    }
  }

  return {
    rows,
    defaultMap: defaultParsed.map,
    effectiveMap: effective,
    sourceOrder: mode === 'scenario' ? ['default', 'scenario', 'custom'] : ['default', 'custom'],
    commentsByKey
  };
}

function parseSectionedConfig(text, marker) {
  const result = {
    sections: [],
    headerComments: []
  };

  if (!text) {
    return result;
  }

  const lines = text.split(/\r?\n/);
  let current = null;
  let beforeFirstSection = true;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith(marker)) {
      if (current) {
        result.sections.push(current);
      }
      current = {
        marker,
        fields: [],
        comments: []
      };
      beforeFirstSection = false;
      continue;
    }

    if (beforeFirstSection) {
      result.headerComments.push(rawLine);
      continue;
    }

    if (!current) {
      continue;
    }

    if (!line) {
      continue;
    }

    if (line.startsWith(';') || line.startsWith('[')) {
      current.comments.push(rawLine);
      continue;
    }

    const match = rawLine.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (match) {
      const parsedValue = String(match[2] == null ? '' : match[2]).trim();
      // Only unquote simple single tokens (no inner quotes); keep quoted lists intact.
      const shouldUnquoteWholeValue = /^"[^"]*"$/.test(parsedValue);
      const normalizedValue = shouldUnquoteWholeValue ? parsedValue.slice(1, -1) : parsedValue;
      current.fields.push({ key: match[1].trim(), value: normalizedValue });
    }
  }

  if (current) {
    result.sections.push(current);
  }

  return result;
}

function quoteSectionToken(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const unquoted = raw.replace(/^"(.*)"$/, '$1');
  const escaped = unquoted.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function tokenizeSectionListPreservingQuotes(text) {
  const input = String(text == null ? '' : text);
  const items = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === ',' || ch === '\n' || ch === '\r')) {
      const t = cur.trim();
      if (t) items.push(t);
      cur = '';
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) items.push(tail);
  return items;
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

function normalizeSectionReferenceToken(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  return raw.replace(/^"(.*)"$/, '$1').trim();
}

function formatRenamedSectionReferenceToken(originalToken, nextName) {
  const next = String(nextName == null ? '' : nextName).trim();
  if (!next) return '';
  const raw = String(originalToken == null ? '' : originalToken).trim();
  if (/^".*"$/.test(raw) || /[,\s:]/.test(next)) return quoteSectionToken(next);
  return next;
}

function replaceSectionReferenceListNames(value, renameByLookup) {
  if (!(renameByLookup instanceof Map) || renameByLookup.size <= 0) return { value: String(value == null ? '' : value), changed: false };
  const raw = String(value == null ? '' : value);
  const tokens = tokenizeSectionListPreservingQuotes(raw);
  let changed = false;
  const nextTokens = tokens.map((token) => {
    const normalized = normalizeSectionReferenceToken(token);
    const replacement = renameByLookup.get(normalized.toLowerCase());
    if (!replacement) return token;
    changed = true;
    return formatRenamedSectionReferenceToken(token, replacement);
  });
  return { value: changed ? nextTokens.join(', ') : raw, changed };
}

function replaceSectionBonusReferenceNames(value, renameByLookup) {
  if (!(renameByLookup instanceof Map) || renameByLookup.size <= 0) return { value: String(value == null ? '' : value), changed: false };
  const raw = String(value == null ? '' : value);
  const tokens = tokenizeSectionListPreservingQuotes(raw);
  let changed = false;
  const nextTokens = tokens.map((token, index) => {
    if (index === 0) return token;
    const colonIndex = findUnquotedColon(token);
    if (colonIndex < 0) return token;
    const rawName = token.slice(0, colonIndex).trim();
    const replacement = renameByLookup.get(normalizeSectionReferenceToken(rawName).toLowerCase());
    if (!replacement) return token;
    changed = true;
    const rhs = token.slice(colonIndex + 1).trim();
    return `${formatRenamedSectionReferenceToken(rawName, replacement)}: ${rhs}`;
  });
  return { value: changed ? nextTokens.join(', ') : raw, changed };
}

function replaceSectionSingleReferenceName(value, renameByLookup) {
  if (!(renameByLookup instanceof Map) || renameByLookup.size <= 0) return { value: String(value == null ? '' : value), changed: false };
  const raw = String(value == null ? '' : value).trim();
  const replacement = renameByLookup.get(normalizeSectionReferenceToken(raw).toLowerCase());
  if (!replacement) return { value: String(value == null ? '' : value), changed: false };
  return { value: replacement, changed: true };
}

const DISTRICT_IMPROVEMENT_REFERENCE_LIST_KEYS = new Set(['dependent_improvs', 'wonder_prereqs']);
const DISTRICT_IMPROVEMENT_BONUS_KEYS = new Set([
  'defense_bonus_percent',
  'culture_bonus',
  'science_bonus',
  'food_bonus',
  'gold_bonus',
  'shield_bonus',
  'happiness_bonus'
]);

function getImprovementEntryNameField(entry) {
  const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
  return fields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === 'name') || null;
}

function getImprovementEntryCurrentName(entry) {
  const field = getImprovementEntryNameField(entry);
  return normalizeSectionReferenceToken(field && field.value) || normalizeSectionReferenceToken(entry && entry.name);
}

function getImprovementEntryOriginalName(entry) {
  const field = getImprovementEntryNameField(entry);
  return normalizeSectionReferenceToken(field && field.originalValue) || normalizeSectionReferenceToken(entry && entry.originalName);
}

function collectImprovementNameRenames(tabs) {
  const entries = Array.isArray(tabs && tabs.improvements && tabs.improvements.entries)
    ? tabs.improvements.entries
    : [];
  const renameByLookup = new Map();
  entries.forEach((entry) => {
    const oldName = getImprovementEntryOriginalName(entry);
    const newName = getImprovementEntryCurrentName(entry);
    if (!oldName || !newName) return;
    if (oldName.toLowerCase() === newName.toLowerCase() && oldName === newName) return;
    renameByLookup.set(oldName.toLowerCase(), newName);
  });
  return renameByLookup;
}

function applyImprovementNameRenamesToSectionedTabs(tabs) {
  const renameByLookup = collectImprovementNameRenames(tabs || {});
  const changedTabs = new Set();
  if (renameByLookup.size <= 0) return changedTabs;

  const updateFields = (tabKey, section, updater) => {
    const fields = Array.isArray(section && section.fields) ? section.fields : [];
    fields.forEach((field) => {
      const result = updater(field);
      if (!result || !result.changed) return;
      field.value = result.value;
      changedTabs.add(tabKey);
    });
  };

  const districtSections = (((tabs || {}).districts || {}).model || {}).sections;
  (Array.isArray(districtSections) ? districtSections : []).forEach((section) => {
    updateFields('districts', section, (field) => {
      const key = String(field && field.key || '').trim().toLowerCase();
      if (DISTRICT_IMPROVEMENT_REFERENCE_LIST_KEYS.has(key)) {
        return replaceSectionReferenceListNames(field.value, renameByLookup);
      }
      if (DISTRICT_IMPROVEMENT_BONUS_KEYS.has(key)) {
        return replaceSectionBonusReferenceNames(field.value, renameByLookup);
      }
      return null;
    });
  });

  const wonderSections = (((tabs || {}).wonders || {}).model || {}).sections;
  (Array.isArray(wonderSections) ? wonderSections : []).forEach((section) => {
    updateFields('wonders', section, (field) => {
      const key = String(field && field.key || '').trim().toLowerCase();
      if (key !== 'name') return null;
      return replaceSectionSingleReferenceName(field.value, renameByLookup);
    });
  });

  return changedTabs;
}

const SECTION_QUOTED_VALUE_KEYS_BY_KIND = {
  districts: new Set([
    'name', 'display_name', 'tooltip', 'obsoleted_by',
    'advance_prereqs', 'resource_prereqs', 'dependent_improvs', 'wonder_prereqs', 'natural_wonder_prereqs',
    'buildable_on_districts', 'buildable_adjacent_to_districts',
    'buildable_by_civs', 'buildable_by_civ_traits', 'buildable_by_civ_govs', 'buildable_by_civ_cultures',
    'img_paths', 'resource_prereq_on_tile'
  ]),
  wonders: new Set([
    'name', 'buildable_by_civs', 'buildable_by_civ_traits', 'buildable_by_civ_govs', 'buildable_by_civ_cultures', 'img_path'
  ]),
  naturalWonders: new Set(['name', 'img_path', 'animation'])
};

function normalizeSectionFieldValueForWrite(kind, key, value) {
  const kindKey = String(kind || '');
  const rawKey = String(key || '').trim();
  const keyLower = rawKey.toLowerCase();
  const rawValue = String(value == null ? '' : value).trim();
  const quotedKeys = SECTION_QUOTED_VALUE_KEYS_BY_KIND[kindKey];
  if (!quotedKeys || !quotedKeys.has(rawKey) || !rawValue) return rawValue;
  const normalizeArtPath = isSectionArtImagePathField(kindKey, rawKey);
  const tokens = tokenizeSectionListPreservingQuotes(rawValue).map((token) => {
    const clean = String(token || '').trim();
    if (!clean) return '';
    return quoteSectionToken(normalizeArtPath ? normalizeScenarioArtRelativePath(clean) : clean);
  }).filter(Boolean);
  if (tokens.length > 1 || rawValue.includes(',')) {
    return tokens.join(', ');
  }
  if (tokens.length === 1 && keyLower !== 'img_path' && keyLower !== 'name' && keyLower !== 'display_name' && keyLower !== 'tooltip' && keyLower !== 'obsoleted_by') {
    return tokens[0];
  }
  return tokens[0] || rawValue;
}

function serializeSectionedConfig(model, marker, options = null) {
  const lines = [];
  const kind = options && options.kind ? String(options.kind) : '';
  const includeComments = !(options && options.includeComments === false);
  const includeManagedHeader = !!(options && options.includeManagedHeader);
  const managedMode = options && options.mode ? String(options.mode) : '';

  if (includeManagedHeader) {
    lines.push('; Managed by Civ 3 | C3X Modern Editor');
    if (managedMode) lines.push(`; Mode: ${managedMode}`);
    lines.push('');
  }

  if (includeComments && model.headerComments && model.headerComments.length > 0) {
    for (const line of model.headerComments) {
      lines.push(line);
    }
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('');
    }
  }

  for (let i = 0; i < model.sections.length; i += 1) {
    const section = model.sections[i];
    lines.push(marker);
    if (includeComments) {
      const sectionComments = Array.isArray(section && section.comments) ? section.comments : [];
      sectionComments.forEach((line) => {
        lines.push(String(line || ''));
      });
    }
    const sectionFields = section.fields.filter((f) => f.key);
    const maxKeyLen = sectionFields.reduce((m, f) => Math.max(m, f.key.length), 0);
    for (const field of sectionFields) {
      const normalized = normalizeSectionFieldValueForWrite(kind, field.key, field.value ?? '');
      lines.push(`${field.key.padEnd(maxKeyLen)} = ${normalized}`);
    }
    if (i !== model.sections.length - 1) {
      lines.push('');
    }
  }

  return ensureTrailingNewline(lines.join('\n'));
}

function serializeBaseConfig(baseRows, defaultMap, mode, commentsByKey = {}) {
  const lines = [];
  lines.push('; Managed by Civ 3 | C3X Modern Editor');
  lines.push(`; Mode: ${mode}`);
  lines.push('');

  const rowsToWrite = baseRows.filter((row) => {
    const val = String(row.value ?? '').trim();
    const defaultVal = String(defaultMap[row.key] ?? '').trim();
    return mode === 'scenario'
      ? val !== '' && val !== String(((row && row.hasCustomValue) ? row.customValue : defaultVal) ?? '').trim()
      : val !== '' && val !== defaultVal;
  });
  const maxKeyLen = rowsToWrite.reduce((m, row) => Math.max(m, row.key.length), 0);

  for (const row of rowsToWrite) {
    const key = row.key;
    const val = String(row.value ?? '').trim();
    const comments = commentsByKey[key];
    if (comments && comments.length > 0) {
      for (const c of comments) lines.push(c);
    }
    lines.push(`${key.padEnd(maxKeyLen)} = ${val}`);
  }

  return ensureTrailingNewline(lines.join('\n'));
}

function resolvePaths({ c3xPath, scenarioPath, mode }) {
  const scenarioDir = resolveScenarioDir(scenarioPath);
  const paths = {};
  for (const [kind, spec] of Object.entries(FILE_SPECS)) {
    const defaultPath = c3xPath ? path.join(c3xPath, spec.defaultName) : null;
    const userPath = c3xPath ? path.join(c3xPath, spec.userName) : null;
    const scenarioFilePath = scenarioDir ? path.join(scenarioDir, spec.scenarioName) : null;

    let effectivePath = defaultPath;
    let effectiveSource = 'default';

    if (kind === 'base') {
      if (mode === 'scenario' && scenarioFilePath && fs.existsSync(scenarioFilePath)) {
        effectivePath = scenarioFilePath;
        effectiveSource = 'scenario+custom';
      }
      if (userPath && fs.existsSync(userPath)) {
        effectivePath = userPath;
        effectiveSource = mode === 'scenario' ? 'scenario+custom' : 'custom';
      }
    } else {
      if (mode === 'scenario' && scenarioFilePath && fs.existsSync(scenarioFilePath)) {
        effectivePath = scenarioFilePath;
        effectiveSource = 'scenario';
      } else if (userPath && fs.existsSync(userPath)) {
        effectivePath = userPath;
        effectiveSource = 'user';
      }
    }

    const targetPath = mode === 'scenario' ? scenarioFilePath : userPath;

    const defaultExists = !!(defaultPath && fs.existsSync(defaultPath));
    const userExists = !!(userPath && fs.existsSync(userPath));
    const scenarioExists = !!(scenarioFilePath && fs.existsSync(scenarioFilePath));
    log.debug('resolvePaths', `${kind}: source=${effectiveSource}, default=${defaultExists ? 'Y' : 'N'}, user=${userExists ? 'Y' : 'N'}, scenario=${scenarioExists ? 'Y' : 'N'} -> ${log.rel(effectivePath)}`);

    paths[kind] = {
      defaultPath,
      userPath,
      scenarioPath: scenarioFilePath,
      effectivePath,
      effectiveSource,
      targetPath
    };
  }
  return paths;
}

function loadBundle(payload) {
  const readPaths = new Set();
  activeReadCollector = readPaths;
  const mode = payload.mode === 'scenario' ? 'scenario' : 'global';
  const deferMapTab = !!(payload && payload.deferMapTab);
  const c3xPath = payload.c3xPath || '';
  const civ3Path = payload.civ3Path || '';
  const scenarioPath = payload.scenarioPath || '';
  const textFileEncoding = normalizeTextFileEncoding(payload.textFileEncoding);
  const initialBiqTextEncoding = textFileEncoding;
  const scenarioSearchFolderOverride = normalizeScenarioSearchFolderOverride(payload.scenarioSearchFolderOverride);
  log.setCiv3Root(civ3Path);
  log.info('loadBundle', `mode=${mode}`);
  if (!c3xPath) log.warn('loadBundle', 'c3xPath is empty — config files will not load.');
  if (!civ3Path) log.warn('loadBundle', 'civ3Path is empty — reference data will not load.');
  if (mode === 'scenario' && !scenarioPath) log.warn('loadBundle', 'scenarioPath is empty in scenario mode.');
  try {
    let biqTab = loadBiqTab({ mode, civ3Path, scenarioPath, textEncoding: initialBiqTextEncoding });
    const scenarioContext = mode === 'scenario'
      ? deriveScenarioPathContext({
        scenarioPath,
        civ3Path,
        biqTab,
        searchFolderOverride: scenarioSearchFolderOverride.length > 0 ? scenarioSearchFolderOverride : null,
        includeMissingSearchRoots: scenarioSearchFolderOverride.length > 0
      })
      : {
        biqRoot: resolveScenarioDir(scenarioPath),
        searchRoots: [],
        writableRoots: [],
        contentWriteRoot: resolveScenarioDir(scenarioPath),
        expectedContentWriteRoot: resolveScenarioDir(scenarioPath)
      };
    const scenarioDir = scenarioContext.biqRoot;
    const scenarioSearchPaths = scenarioContext.searchRoots;

    // Use expectedContentWriteRoot (falls back to a computed path when contentWriteRoot is
    // empty) so that targetPath is always set for new scenario files whose directory doesn't
    // exist yet. This lets the Files Modal show a pending-write entry and "View Changes".
    const scenarioPathForFilePaths = mode === 'scenario'
      ? (scenarioContext.expectedContentWriteRoot || scenarioContext.contentWriteRoot || scenarioContext.biqRoot)
      : scenarioContext.biqRoot;
    const filePaths = resolvePaths({ c3xPath, scenarioPath: scenarioPathForFilePaths, mode });
    const bundle = {
      mode,
      c3xPath,
      civ3Path,
      scenarioPath: scenarioDir,
      scenarioInputPath: scenarioPath,
      textFileEncoding,
      biqTextEncoding: String(biqTab && biqTab.textEncoding || initialBiqTextEncoding),
      scenarioSearchPaths,
      scenarioWriteRoots: scenarioContext.writableRoots,
      tabs: {}
    };
    bundle.scienceAdvisorArrowMetadata = mode === 'scenario'
      ? loadScienceAdvisorArrowMetadata(scenarioContext.contentWriteRoot || scenarioContext.expectedContentWriteRoot || scenarioDir)
      : loadScienceAdvisorArrowMetadata('');

    bundle.biq = biqTab;
    if (mode === 'scenario' && scenarioSearchFolderOverride.length > 0 && biqTab && Array.isArray(biqTab.sections)) {
      const game = biqTab.sections.find((section) => String(section && section.code || '').trim().toUpperCase() === 'GAME');
      const record = game && Array.isArray(game.records) ? game.records[0] : null;
      const field = record && Array.isArray(record.fields)
        ? record.fields.find((entry) => {
          const key = String(entry && (entry.baseKey || entry.key) || '').toLowerCase();
          return key.includes('scenariosearchfolder');
        })
        : null;
      if (field) {
        field.value = scenarioSearchFolderOverride.join('; ') || '(none)';
      }
    }
    if (biqTab && biqTab.sourcePath) {
      readPaths.add(path.resolve(String(biqTab.sourcePath)));
    }

    let globalBiqTab = null;
    const needsDefaultRulesFallback = shouldUseScenarioDefaultRulesFallback(mode, biqTab);
    if (needsDefaultRulesFallback) {
      globalBiqTab = loadBiqTab({ mode: 'global', civ3Path, scenarioPath: '', textEncoding: String(biqTab && biqTab.textEncoding || textFileEncoding || 'windows-1252') });
    }

    let referenceTabs = buildEffectiveReferenceTabs(civ3Path, {
      mode,
      scenarioPath: mode === 'scenario' ? (scenarioContext.contentWriteRoot || scenarioDir) : scenarioDir,
      scenarioPaths: scenarioSearchPaths,
      biqTab,
      defaultRulesBiqTab: globalBiqTab,
      textFileEncoding
    });
    for (const spec of REFERENCE_TAB_SPECS) {
      if (referenceTabs[spec.key]) {
        if (spec.key === 'terrainPedia' || spec.key === 'workerActions') continue;
        bundle.tabs[spec.key] = referenceTabs[spec.key];
      }
    }
    const scenarioDistrictsMetadata = mode === 'scenario'
      ? loadScenarioDistrictsMetadata({
        scenarioPath: mode === 'scenario' ? (scenarioContext.contentWriteRoot || scenarioDir) : scenarioDir,
        scenarioPaths: scenarioSearchPaths,
        targetRoot: scenarioContext.expectedContentWriteRoot || scenarioContext.contentWriteRoot || scenarioDir,
        preferredEncoding: textFileEncoding
      })
      : null;
    bundle.tabs.map = buildDeferredMapTab(biqTab, mode, { scenarioDistricts: scenarioDistrictsMetadata });
    let biqStructureTabs = buildBiqStructureTabs(biqTab, mode);
    if (shouldUseScenarioDefaultRulesFallback(mode, biqTab)) {
      globalBiqTab = globalBiqTab || loadBiqTab({ mode: 'global', civ3Path, scenarioPath: '', textEncoding: bundle.biqTextEncoding || textFileEncoding });
      const globalStructureTabs = buildBiqStructureTabs(globalBiqTab, 'global');
      biqStructureTabs = applyScenarioDefaultRulesFallbackToStructureTabs(biqStructureTabs, globalStructureTabs);
    }
    biqStructureTabs = applyCustomPlayerDataDisabledState(biqStructureTabs, mode);
    Object.keys(biqStructureTabs).forEach((key) => {
      bundle.tabs[key] = biqStructureTabs[key];
    });
    if (bundle.tabs.terrain) {
      bundle.tabs.terrain.civilopedia = {
        terrain: referenceTabs.terrainPedia || null,
        workerActions: referenceTabs.workerActions || null
      };
    } else {
      if (referenceTabs.terrainPedia) bundle.tabs.terrainPedia = referenceTabs.terrainPedia;
      if (referenceTabs.workerActions) bundle.tabs.workerActions = referenceTabs.workerActions;
    }

    if (!deferMapTab && bundle.tabs.map) {
      bundle.tabs.map = materializeMapTab({
        mode,
        biqTab,
        mapTab: bundle.tabs.map,
        tabs: bundle.tabs
      });
    }

    const defaultBaseText = readTextIfExists(filePaths.base.defaultPath) || '';
    const scenarioBaseText = readTextIfExists(filePaths.base.scenarioPath) || '';
    const customBaseText = readTextIfExists(filePaths.base.userPath) || '';
    const targetBaseText = readTextIfExists(filePaths.base.targetPath) || '';

    bundle.tabs.base = {
      title: FILE_SPECS.base.title,
      effectiveSource: filePaths.base.effectiveSource,
      targetPath: filePaths.base.targetPath,
      fieldDocs: parseIniFieldDocs(defaultBaseText),
      ...parseIniSectionMap(defaultBaseText),
      ...buildBaseModel(defaultBaseText, scenarioBaseText, customBaseText, mode, targetBaseText)
    };

    for (const kind of ['districts', 'wonders', 'naturalWonders', 'animations']) {
      const spec = FILE_SPECS[kind];
      const defaultInfo = readTextFileWithEncodingInfoIfExists(filePaths[kind].defaultPath, { preferredEncoding: textFileEncoding });
      const targetInfo = readTextFileWithEncodingInfoIfExists(filePaths[kind].targetPath, { preferredEncoding: textFileEncoding });
      const fallbackInfo = readTextFileWithEncodingInfoIfExists(filePaths[kind].effectivePath, { preferredEncoding: textFileEncoding });
      const defaultText = defaultInfo ? defaultInfo.text : '';
      const textInfo = targetInfo || fallbackInfo;
      const text = textInfo ? textInfo.text : '';
      const defaultPath = filePaths[kind].defaultPath || '';
      const userPath = filePaths[kind].userPath || '';
      const scenarioFilePath = filePaths[kind].scenarioPath || '';
      const effectivePath = filePaths[kind].effectivePath || '';
      const targetPath = filePaths[kind].targetPath || '';

      bundle.tabs[kind] = {
        title: spec.title,
        effectiveSource: filePaths[kind].effectiveSource,
        targetPath,
        marker: spec.sectionMarker,
        fieldDocs: parseSectionFieldDocs(defaultText),
        model: parseSectionedConfig(text, spec.sectionMarker),
        sourceDetails: {
          defaultPath,
          userPath,
          scenarioPath: scenarioFilePath,
          effectivePath,
          targetPath,
          hasDefault: !!(defaultPath && fs.existsSync(defaultPath)),
          hasUser: !!(userPath && fs.existsSync(userPath)),
          hasScenario: !!(scenarioFilePath && fs.existsSync(scenarioFilePath)),
          defaultEncoding: defaultInfo ? defaultInfo.encoding : '',
          defaultBom: !!(defaultInfo && defaultInfo.bom),
          effectiveEncoding: fallbackInfo ? fallbackInfo.encoding : '',
          effectiveBom: !!(fallbackInfo && fallbackInfo.bom),
          targetEncoding: targetInfo ? targetInfo.encoding : '',
          targetBom: !!(targetInfo && targetInfo.bom),
          activeEncoding: textInfo ? textInfo.encoding : '',
          activeBom: !!(textInfo && textInfo.bom)
        }
      };
    }
    bundle.readFiles = Array.from(readPaths).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    log.info('loadBundle', `Complete — ${bundle.readFiles.length} file(s) read, tabs=[${Object.keys(bundle.tabs).join(', ')}]`);
    if (mode === 'scenario') {
      log.info('loadBundle', `scenarioDir=${log.rel(bundle.scenarioPath)}, searchPaths=${log.relList(bundle.scenarioSearchPaths)}`);
    }
    return bundle;
  } finally {
    activeReadCollector = null;
  }
}

function buildScenarioPediaIconsEditResult({ targetPath, edits, sourcePath = '', encoding = DEFAULT_TEXT_FILE_ENCODING, bom = false, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING }) {
  if (!targetPath || !Array.isArray(edits) || edits.length === 0) {
    return { ok: true, applied: 0, buffer: null };
  }
  try {
    const existingInfo = readEncodedTextWithFallbackInfo(targetPath, sourcePath, preferredEncoding);
    const existing = existingInfo ? existingInfo.text || '' : '';
    const existingTargetHasLineEndingRepair = fs.existsSync(targetPath) && hasNonCrlfLineEndings(existing);
    const doc = parsePediaIconsDocumentWithOrder(existing);
    let applied = 0;
    edits.forEach((edit) => {
      const blockKey = String(edit && edit.blockKey || '').trim().toUpperCase();
      if (!blockKey) return;
      const op = String(edit && edit.op || 'upsert').trim().toLowerCase();
      if (op === 'delete') {
        if (Array.isArray(doc.items)) {
          const before = doc.items.length;
          doc.items = doc.items.filter((item) => getPediaIconsItemKey(item) !== blockKey);
          if (doc.items.length !== before) {
            rebuildPediaIconsDocumentIndexes(doc);
            applied += 1;
          }
          return;
        }
        if (doc.blocks[blockKey]) {
          delete doc.blocks[blockKey];
          delete doc.headers[blockKey];
          doc.order = doc.order.filter((key) => String(key || '').trim().toUpperCase() !== blockKey);
          applied += 1;
        }
        return;
      }
      const nextLines = normalizePediaIconsLines(edit.lines || []);
      const existingItemIdx = findLastPediaIconsItemIndexByKey(doc, blockKey);
      const existingItem = existingItemIdx >= 0 ? doc.items[existingItemIdx] : null;
      const prevLines = normalizePediaIconsLines((existingItem && existingItem.rawLines) || doc.blocks[blockKey] || []);
      if (JSON.stringify(prevLines) === JSON.stringify(nextLines)) return;
      if (Array.isArray(doc.items)) {
        if (existingItem) {
          existingItem.key = blockKey;
          if (!String(existingItem.headerKey || '').trim()) existingItem.headerKey = blockKey;
          existingItem.rawLines = nextLines;
          existingItem.normalized = true;
        } else {
          insertPediaIconsItemsAt(doc, blockKey, [{
            key: blockKey,
            headerKey: blockKey,
            rawLines: nextLines,
            normalized: true
          }]);
        }
        rebuildPediaIconsDocumentIndexes(doc);
      } else {
        doc.blocks[blockKey] = nextLines;
        if (!doc.order.includes(blockKey)) {
          doc.order.splice(findPediaIconsInsertionIndex(doc.order, blockKey), 0, blockKey);
        }
        if (!doc.headers) doc.headers = {};
        if (!doc.headers[blockKey]) doc.headers[blockKey] = blockKey;
      }
      applied += 1;
    });
    const repair = repairPediaIconsDocumentForFiraxis(doc);
    if (repair.changed) applied += 1;
    if (applied > 0 || existingTargetHasLineEndingRepair) doc.lineEnding = '\r\n';
    if (applied === 0 && !existingTargetHasLineEndingRepair) return { ok: true, applied: 0, buffer: null };
    const serialized = serializePediaIconsDocumentWithOrder(doc);
    const resolvedEncoding = resolveScenarioTextWriteEncoding({
      targetPath,
      sourcePath,
      explicitEncoding: encoding,
      preferredEncoding
    });
    return {
      ok: true,
      applied: existingTargetHasLineEndingRepair ? Math.max(applied, 1) : applied,
      repaired: !!repair.changed,
      movedHomelessBlocks: repair.moved || 0,
      restoredHomeless: !!repair.restoredHomeless,
      lineEndingsNormalized: existingTargetHasLineEndingRepair,
      buffer: encodeTextBuffer(serialized, resolvedEncoding.encoding, { bom: bom || resolvedEncoding.bom }),
      encoding: resolvedEncoding.encoding,
      bom: bom || resolvedEncoding.bom
    };
  } catch (err) {
    return { ok: false, error: `Failed to save PediaIcons edits: ${err.message}` };
  }
}

function buildScenarioPediaIconsRepairResult({ targetPath, sourcePath = '', encoding = DEFAULT_TEXT_FILE_ENCODING, bom = false, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING }) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { ok: true, applied: 0, buffer: null };
  }
  try {
    const existing = readEncodedTextIfExists(targetPath, { preferredEncoding }) || '';
    const lineEndingsNormalized = hasNonCrlfLineEndings(existing);
    const doc = parsePediaIconsDocumentWithOrder(existing);
    const repair = repairPediaIconsDocumentForFiraxis(doc);
    if (repair.changed || lineEndingsNormalized) doc.lineEnding = '\r\n';
    if (!repair.changed && !lineEndingsNormalized) return { ok: true, applied: 0, buffer: null };
    const serialized = repair.changed
      ? serializePediaIconsDocumentWithOrder(doc)
      : normalizeTextLineEndingsToCrlf(existing);
    const resolvedEncoding = resolveScenarioTextWriteEncoding({
      targetPath,
      sourcePath,
      explicitEncoding: encoding,
      preferredEncoding
    });
    return {
      ok: true,
      applied: 1,
      repaired: !!repair.changed,
      movedHomelessBlocks: repair.moved || 0,
      restoredHomeless: !!repair.restoredHomeless,
      lineEndingsNormalized,
      buffer: encodeTextBuffer(serialized, resolvedEncoding.encoding, { bom: bom || resolvedEncoding.bom }),
      encoding: resolvedEncoding.encoding,
      bom: bom || resolvedEncoding.bom
    };
  } catch (err) {
    return { ok: false, error: `Failed to repair PediaIcons: ${err.message}` };
  }
}

function buildScenarioCivilopediaEditResult({ targetPath, edits, sourcePath = '', encoding = DEFAULT_TEXT_FILE_ENCODING, bom = false, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING }) {
  if (!targetPath || !Array.isArray(edits) || edits.length === 0) {
    return { ok: true, applied: 0, buffer: null };
  }
  try {
    const existingInfo = readEncodedTextWithFallbackInfo(targetPath, sourcePath, preferredEncoding);
    const existing = existingInfo ? existingInfo.text || '' : '';
    const existingTargetHasLineEndingRepair = fs.existsSync(targetPath) && hasNonCrlfLineEndings(existing);
    const doc = parseCivilopediaDocumentWithOrder(existing);
    const items = Array.isArray(doc.items) ? doc.items.slice() : [];
    let applied = 0;
    edits.forEach((edit) => {
      const sectionKey = String(edit && edit.sectionKey || '').trim().toUpperCase();
      if (!sectionKey) return;
      const op = String(edit && edit.op || 'upsert').trim().toLowerCase();
      if (op === 'delete') {
        if (items.length > 0) {
          const before = items.length;
          for (let i = items.length - 1; i >= 0; i -= 1) {
            if (String(items[i] && items[i].key || '').trim().toUpperCase() === sectionKey) items.splice(i, 1);
          }
          if (items.length !== before) applied += 1;
          return;
        }
        if (doc.sections[sectionKey]) {
          delete doc.sections[sectionKey];
          doc.order = (doc.order || []).filter((k) => String(k || '').trim().toUpperCase() !== sectionKey);
          applied += 1;
        }
        return;
      }
      let targetItem = null;
      if (items.length > 0) {
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const candidate = items[i];
          if (String(candidate && candidate.key || '').trim().toUpperCase() === sectionKey) {
            targetItem = candidate;
            break;
          }
        }
      } else if (doc.sections[sectionKey]) {
        targetItem = doc.sections[sectionKey];
      }
      const nextLines = textToCivilopediaLines(edit.value);
      const prevLines = (targetItem && Array.isArray(targetItem.rawLines))
        ? targetItem.rawLines
        : [];
      if (prevLines.length > 0 && nextLines.length > 0) {
        const prevTrailingEmpty = countTrailingEmptyLines(prevLines);
        const nextTrailingEmpty = countTrailingEmptyLines(nextLines);
        if (prevTrailingEmpty > nextTrailingEmpty) {
          for (let i = 0; i < (prevTrailingEmpty - nextTrailingEmpty); i += 1) nextLines.push('');
        }
      }
      const prevNorm = normalizeCivilopediaTextValue(prevLines.join('\n'));
      const nextNorm = normalizeCivilopediaTextValue(nextLines.join('\n'));
      if (prevNorm === nextNorm) return;
      const existingSection = targetItem || {};
      const requestedHeaderRaw = String(edit && edit.headerKey || '').trim();
      const existingHeaderRaw = Object.prototype.hasOwnProperty.call(existingSection, 'headerKey')
        ? String(existingSection.headerKey)
        : String(sectionKey);
      const headerKey = existingHeaderRaw.length > 0 ? existingHeaderRaw : (requestedHeaderRaw || String(sectionKey));
      if (items.length > 0) {
        if (targetItem) {
          targetItem.key = sectionKey;
          targetItem.headerKey = headerKey;
          targetItem.rawLines = nextLines;
        } else {
          const markerIdx = items.findIndex((item) => String(item && item.key || '').trim().toUpperCase() === 'EOF');
          const nextItem = { key: sectionKey, headerKey: requestedHeaderRaw || headerKey, rawLines: nextLines };
          if (markerIdx >= 0) items.splice(markerIdx, 0, nextItem);
          else items.push(nextItem);
        }
      } else {
        doc.sections[sectionKey] = { key: sectionKey, headerKey: requestedHeaderRaw || headerKey, rawLines: nextLines };
        if (!doc.order.includes(sectionKey)) {
          const markerIdx = doc.order.findIndex((key) => String(key || '').trim().toUpperCase() === 'EOF');
          if (markerIdx >= 0) doc.order.splice(markerIdx, 0, sectionKey);
          else doc.order.push(sectionKey);
        }
      }
      applied += 1;
    });
    if (applied > 0 || existingTargetHasLineEndingRepair) doc.lineEnding = '\r\n';
    if (applied === 0 && !existingTargetHasLineEndingRepair) return { ok: true, applied: 0, buffer: null };
    if (items.length > 0) {
      const eofItems = [];
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (String(items[i] && items[i].key || '').trim().toUpperCase() === 'EOF') {
          eofItems.unshift(items.splice(i, 1)[0]);
        }
      }
      if (eofItems.length > 0) {
        items.push(eofItems[eofItems.length - 1]);
      }
      doc.items = items;
      doc.sections = {};
      doc.order = [];
      items.forEach((item) => {
        const key = String(item && item.key || '').trim().toUpperCase();
        if (!key) return;
        doc.sections[key] = item;
        if (!doc.order.includes(key)) doc.order.push(key);
      });
    }
    const serialized = serializeCivilopediaDocumentWithOrder(doc);
    const resolvedEncoding = resolveScenarioTextWriteEncoding({
      targetPath,
      sourcePath,
      explicitEncoding: encoding,
      preferredEncoding
    });
    return {
      ok: true,
      applied: existingTargetHasLineEndingRepair ? Math.max(applied, 1) : applied,
      lineEndingsNormalized: existingTargetHasLineEndingRepair,
      buffer: encodeTextBuffer(serialized, resolvedEncoding.encoding, { bom: bom || resolvedEncoding.bom }),
      encoding: resolvedEncoding.encoding,
      bom: bom || resolvedEncoding.bom
    };
  } catch (err) {
    return { ok: false, error: `Failed to save Civilopedia edits: ${err.message}` };
  }
}

function buildScenarioCivilopediaRepairResult({ targetPath, sourcePath = '', encoding = DEFAULT_TEXT_FILE_ENCODING, bom = false, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING }) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { ok: true, applied: 0, buffer: null };
  }
  try {
    const existing = readEncodedTextIfExists(targetPath, { preferredEncoding }) || '';
    if (!hasNonCrlfLineEndings(existing)) return { ok: true, applied: 0, buffer: null };
    const resolvedEncoding = resolveScenarioTextWriteEncoding({
      targetPath,
      sourcePath,
      explicitEncoding: encoding,
      preferredEncoding
    });
    return {
      ok: true,
      applied: 1,
      lineEndingsNormalized: true,
      buffer: encodeTextBuffer(normalizeTextLineEndingsToCrlf(existing), resolvedEncoding.encoding, { bom: bom || resolvedEncoding.bom }),
      encoding: resolvedEncoding.encoding,
      bom: bom || resolvedEncoding.bom
    };
  } catch (err) {
    return { ok: false, error: `Failed to repair Civilopedia: ${err.message}` };
  }
}

function buildScenarioDiplomacyEditResult({ targetPath, sourcePath, edits, encoding = DEFAULT_TEXT_FILE_ENCODING, bom = false, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING }) {
  if (!targetPath || !Array.isArray(edits) || edits.length === 0) {
    return { ok: true, applied: 0, buffer: null };
  }
  try {
    const existingInfo = readEncodedTextWithFallbackInfo(targetPath, sourcePath, preferredEncoding);
    const existing = existingInfo.text || '';
    const normalizedExisting = ensureDiplomacyEofSentinel(existing);
    const replaceEdit = edits.find((edit) => String(edit && edit.op || '').toLowerCase() === 'replace');
    if (replaceEdit) {
      const nextText = ensureDiplomacyEofSentinel(String(replaceEdit.text || ''));
      if (nextText.replace(/\r\n/g, '\n').replace(/\r/g, '\n') === normalizedExisting.replace(/\r\n/g, '\n').replace(/\r/g, '\n')) {
        return { ok: true, applied: 0, buffer: null };
      }
      const resolvedEncoding = resolveScenarioTextWriteEncoding({
        targetPath,
        sourcePath,
        explicitEncoding: encoding,
        preferredEncoding
      });
      return {
        ok: true,
        applied: 1,
        buffer: encodeTextBuffer(nextText, resolvedEncoding.encoding, { bom: bom || resolvedEncoding.bom }),
        encoding: resolvedEncoding.encoding,
        bom: bom || resolvedEncoding.bom
      };
    }
    const doc = parseDiplomacyDocumentWithOrder(existing);
    const sectionByKey = new Map(
      (Array.isArray(doc.sections) ? doc.sections : [])
        .map((section) => [String(section && section.key || '').trim().toUpperCase(), section])
    );
    const ensureSection = (key) => {
      const upper = String(key || '').trim().toUpperCase();
      if (!upper) return null;
      const existingSection = sectionByKey.get(upper);
      if (existingSection) return existingSection;
      const created = { key: upper, header: `#${upper}`, lines: [] };
      doc.sections.push(created);
      sectionByKey.set(upper, created);
      return created;
    };

    const contactByIndex = new Map();
    const dealByIndex = new Map();
    edits.forEach((edit) => {
      const idx = Number(edit && edit.index);
      if (!Number.isFinite(idx) || idx < 0) return;
      contactByIndex.set(idx, normalizeDiplomacyDialogueLine(edit && edit.firstContact));
      dealByIndex.set(idx, normalizeDiplomacyDialogueLine(edit && edit.firstDeal));
    });
    if (contactByIndex.size === 0 && dealByIndex.size === 0) {
      return { ok: true, applied: 0, buffer: null };
    }

    const maxIndex = Math.max(
      -1,
      ...Array.from(contactByIndex.keys()),
      ...Array.from(dealByIndex.keys())
    );
    const existingSlots = parseDiplomacySlotsFromDocument(doc);
    const nextContact = [];
    const nextDeal = [];
    for (let i = 0; i <= Math.max(maxIndex, existingSlots.length - 1); i += 1) {
      const existingSlot = existingSlots[i] || {};
      nextContact[i] = contactByIndex.has(i)
        ? contactByIndex.get(i)
        : normalizeDiplomacyDialogueLine(existingSlot.firstContact);
      nextDeal[i] = dealByIndex.has(i)
        ? dealByIndex.get(i)
        : normalizeDiplomacyDialogueLine(existingSlot.firstDeal);
    }
    while (nextContact.length > 0 && !nextContact[nextContact.length - 1] && !nextDeal[nextDeal.length - 1]) {
      nextContact.pop();
      nextDeal.pop();
    }

    let applied = 0;
    const contactSection = ensureSection('AIFIRSTCONTACT');
    const dealSection = ensureSection('AIFIRSTDEAL');
    if (applyDiplomacySectionSlotLines(contactSection, nextContact)) applied += 1;
    if (applyDiplomacySectionSlotLines(dealSection, nextDeal)) applied += 1;
    if (applied === 0) return { ok: true, applied: 0, buffer: null };

    const serialized = ensureDiplomacyEofSentinel(serializeDiplomacyDocumentWithOrder(doc));
    const resolvedEncoding = resolveScenarioTextWriteEncoding({
      targetPath,
      sourcePath,
      explicitEncoding: encoding,
      preferredEncoding
    });
    return {
      ok: true,
      applied,
      buffer: encodeTextBuffer(serialized, resolvedEncoding.encoding, { bom: bom || resolvedEncoding.bom }),
      encoding: resolvedEncoding.encoding,
      bom: bom || resolvedEncoding.bom
    };
  } catch (err) {
    return { ok: false, error: `Failed to save diplomacy edits: ${err.message}` };
  }
}

function uniqueWritesByPath(writes) {
  const map = new Map();
  writes.forEach((entry) => {
    const targetPath = String((entry && entry.path) || '').trim();
    if (!targetPath) return;
    map.set(targetPath, { ...entry, path: targetPath });
  });
  return Array.from(map.values());
}

function resolveScenarioTextWriteEncoding({ targetPath, sourcePath, explicitEncoding, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING, fallbackEncoding = 'windows-1252' }) {
  const normalizedExplicit = normalizeTextFileEncoding(explicitEncoding);
  if (normalizedExplicit && normalizedExplicit !== 'auto') {
    return { encoding: normalizedExplicit, bom: false };
  }
  const existingInfo = readTextFileWithEncodingInfoIfExists(targetPath, { preferredEncoding });
  if (existingInfo) {
    return { encoding: existingInfo.encoding || fallbackEncoding, bom: !!existingInfo.bom };
  }
  const sourceInfo = readTextFileWithEncodingInfoIfExists(sourcePath, { preferredEncoding });
  if (sourceInfo) {
    return { encoding: sourceInfo.encoding || fallbackEncoding, bom: !!sourceInfo.bom };
  }
  const preferred = normalizeTextFileEncoding(preferredEncoding);
  return {
    encoding: preferred === 'auto' ? fallbackEncoding : preferred,
    bom: false
  };
}

function inferBiqTextEncodingFromReferenceTabs(referenceTabs, preferredEncoding = DEFAULT_TEXT_FILE_ENCODING) {
  const preferred = normalizeTextFileEncoding(preferredEncoding);
  if (preferred !== 'auto') return preferred;
  const sourceDetails = (((referenceTabs || {}).civilizations || {}).sourceDetails || {});
  const candidates = [
    sourceDetails.civilopediaScenarioEncoding,
    sourceDetails.civilopediaActiveEncoding,
    sourceDetails.pediaIconsScenarioEncoding,
    sourceDetails.pediaIconsActiveEncoding,
    sourceDetails.diplomacyScenarioEncoding,
    sourceDetails.diplomacyActiveEncoding
  ].map((value) => normalizeTextFileEncoding(value)).filter((value) => value && value !== 'auto');
  return candidates[0] || 'windows-1252';
}

function writeAtomicFileSync(targetPath, data, options = {}) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.c3x-tmp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${path.basename(targetPath)}`
  );
  let wroteTemp = false;
  try {
    if (Buffer.isBuffer(data)) {
      fs.writeFileSync(tempPath, data);
    } else {
      fs.writeFileSync(tempPath, String(data == null ? '' : data), options.encoding || 'utf8');
    }
    wroteTemp = true;

    try {
      const fd = fs.openSync(tempPath, 'r');
      try {
        fs.fsyncSync(fd);
      } finally {
        try {
          fs.closeSync(fd);
        } catch (_closeErr) {
          // best effort cleanup
        }
      }
    } catch (_err) {
      // best effort durability
    }

    fs.renameSync(tempPath, targetPath);
    wroteTemp = false;

    try {
      const dfd = fs.openSync(dir, 'r');
      try {
        fs.fsyncSync(dfd);
      } finally {
        try {
          fs.closeSync(dfd);
        } catch (_closeErr) {
          // best effort cleanup
        }
      }
    } catch (_err) {
      // best effort durability
    }
  } finally {
    if (wroteTemp) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_err) {
        // best effort cleanup
      }
    }
  }
}

function commitWritesWithRollback(writes, options = {}) {
  const ordered = uniqueWritesByPath(writes);
  const onProgress = options && options.onProgress;
  if (ordered.length === 0) return { ok: true, writeResults: [] };
  reportOperationProgress(onProgress, {
    stage: 'start',
    completed: 0,
    total: ordered.length,
    label: `Saving ${ordered.length} file${ordered.length === 1 ? '' : 's'}...`
  });
  log.info('commitWrites', `Starting transaction: ${ordered.length} file(s) to write`);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-save-backup-'));
  const backups = new Map();
  const committed = [];
  const writeResults = [];
  try {
    ordered.forEach((entry, idx) => {
      const targetPath = entry.path;
      if (fs.existsSync(targetPath)) {
        const backupPath = path.join(backupDir, `${idx}.bak`);
        fs.copyFileSync(targetPath, backupPath);
        backups.set(targetPath, { existed: true, backupPath });
        log.debug('commitWrites', `Backed up: ${log.rel(targetPath)}`);
      } else {
        backups.set(targetPath, { existed: false, backupPath: '' });
        log.debug('commitWrites', `New file (no backup needed): ${log.rel(targetPath)}`);
      }
    });

    for (const entry of ordered) {
      const targetPath = String(entry && entry.path || '').trim();
      if (!targetPath) continue;
      try {
        reportOperationProgress(onProgress, {
          stage: 'item-start',
          completed: committed.length,
          total: ordered.length,
          kind: String(entry && entry.kind || ''),
          path: targetPath,
          label: `Updating ${path.basename(targetPath)}...`
        });
        const dataSize = Buffer.isBuffer(entry.data) ? entry.data.length : String(entry.data || '').length;
        log.info('commitWrites', `Writing: ${log.rel(targetPath)} (kind=${entry.kind || '?'}, size=${dataSize} bytes)`);
        writeAtomicFileSync(targetPath, entry.data, { encoding: entry.encoding || 'utf8' });
        committed.push(targetPath);
        log.info('commitWrites', `Wrote OK: ${log.rel(targetPath)}`);
        writeResults.push({
          path: targetPath,
          kind: String(entry && entry.kind || ''),
          status: 'saved'
        });
        reportOperationProgress(onProgress, {
          stage: 'item-complete',
          completed: committed.length,
          total: ordered.length,
          kind: String(entry && entry.kind || ''),
          path: targetPath,
          label: `Updated ${path.basename(targetPath)}`
        });
      } catch (err) {
        log.error('commitWrites', `Write FAILED for ${log.rel(targetPath)}: ${err.message}`);
        writeResults.push({
          path: targetPath,
          kind: String(entry && entry.kind || ''),
          status: 'failed',
          error: err && err.message ? String(err.message) : 'unknown error'
        });
        throw err;
      }
    }

    log.info('commitWrites', `Transaction complete — ${committed.length} file(s) saved successfully`);
    return { ok: true, writeResults };
  } catch (err) {
    log.error('commitWrites', `Transaction failed: ${err.message} — initiating rollback of ${committed.length} file(s)`);
    const rollbackErrors = [];
    const rollbackResults = [];
    for (let i = committed.length - 1; i >= 0; i -= 1) {
      const targetPath = committed[i];
      const backup = backups.get(targetPath);
      if (!backup) continue;
      try {
        reportOperationProgress(onProgress, {
          stage: 'rollback-item',
          completed: committed.length - i - 1,
          total: committed.length,
          path: targetPath,
          label: `Rolling back ${path.basename(targetPath)}...`
        });
        if (backup.existed && backup.backupPath && fs.existsSync(backup.backupPath)) {
          const original = fs.readFileSync(backup.backupPath);
          writeAtomicFileSync(targetPath, original);
          log.info('commitWrites', `Rolled back (restored): ${log.rel(targetPath)}`);
          rollbackResults.push({
            path: targetPath,
            action: 'restore',
            status: 'rolledBack'
          });
        } else if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
          log.info('commitWrites', `Rolled back (removed new file): ${log.rel(targetPath)}`);
          rollbackResults.push({
            path: targetPath,
            action: 'removeNewFile',
            status: 'rolledBack'
          });
        } else {
          rollbackResults.push({
            path: targetPath,
            action: 'removeNewFile',
            status: 'rolledBack'
          });
        }
      } catch (rollbackErr) {
        log.error('commitWrites', `Rollback FAILED for ${log.rel(targetPath)}: ${rollbackErr.message}`);
        rollbackErrors.push(`${targetPath}: ${rollbackErr.message}`);
        rollbackResults.push({
          path: targetPath,
          action: backup.existed ? 'restore' : 'removeNewFile',
          status: 'rollbackFailed',
          error: rollbackErr && rollbackErr.message ? String(rollbackErr.message) : 'unknown error'
        });
      }
    }
    const rollbackFailed = rollbackResults.filter((entry) => entry.status === 'rollbackFailed').length;
    log.warn('commitWrites', `Rollback complete — attempted=${rollbackResults.length}, failed=${rollbackFailed}`);
    const rollbackSuffix = rollbackErrors.length > 0
      ? ` Rollback encountered errors: ${rollbackErrors.join(' | ')}`
      : '';
    return {
      ok: false,
      error: `Save transaction failed and was rolled back: ${err.message}.${rollbackSuffix}`,
      writeResults,
      rollback: {
        attempted: rollbackResults.length,
        failed: rollbackFailed,
        results: rollbackResults
      }
    };
  } finally {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (_err) {
      // best effort cleanup
    }
  }
}

// Recursively list all files under a directory, returning absolute paths.
function listFilesRecursive(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// Resolve a relative art path against a list of search roots, returning the
// first absolute path that exists, or null.
function resolveArtFileFromRoots(relPath, searchRoots) {
  const normalized = normalizeRelativePath(relPath);
  if (!normalized) return null;
  for (const root of searchRoots) {
    const abs = path.join(root, normalized);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    } catch (_err) {
      // skip
    }
  }
  return null;
}

function paletteRgbAt(palette, index) {
  const idx = Number(index) | 0;
  return {
    r: palette[idx * 3],
    g: palette[idx * 3 + 1],
    b: palette[idx * 3 + 2]
  };
}

function paletteColorMatches(palette, index, color) {
  if (!palette || index < 0 || index > 255) return false;
  return palette[index * 3] === color.r
    && palette[index * 3 + 1] === color.g
    && palette[index * 3 + 2] === color.b;
}

function findPaletteColorIndex(palette, color, preferredIndex = -1) {
  if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex <= 255 && paletteColorMatches(palette, preferredIndex, color)) {
    return preferredIndex;
  }
  for (let idx = 0; idx < 256; idx += 1) {
    if (paletteColorMatches(palette, idx, color)) return idx;
  }
  return -1;
}

function getIndexedResourceAtlas(buffer, label = 'resources.pcx') {
  const decoded = decodePcx(buffer, { returnIndexed: true, transparentIndexes: [] });
  if (!decoded || !decoded.indices || !decoded.palette) {
    throw new Error(`${label} must be an indexed 256-color PCX file.`);
  }
  if (decoded.width < RESOURCE_ATLAS_COLS * RESOURCE_ATLAS_CELL_SIZE) {
    throw new Error(`${label} is too narrow for a Civ3 resources.pcx atlas.`);
  }
  const rows = Math.floor(decoded.height / RESOURCE_ATLAS_CELL_SIZE);
  if (rows < 1) {
    throw new Error(`${label} does not contain any full resource icon rows.`);
  }
  const magentaIndex = findPaletteColorIndex(decoded.palette, RESOURCE_ATLAS_MAGENTA, 255);
  if (magentaIndex < 0) {
    throw new Error(`${label} palette does not contain Civ3 magenta (#ff00ff).`);
  }
  return { ...decoded, rows, magentaIndex };
}

function isPaletteIndexMagenta(palette, index, magentaIndex) {
  return index === magentaIndex || paletteColorMatches(palette, index, RESOURCE_ATLAS_MAGENTA);
}

function isResourceAtlasCellEmpty(atlas, cellIndex) {
  const idx = Number(cellIndex) | 0;
  if (!atlas || idx < 0) return false;
  const row = Math.floor(idx / RESOURCE_ATLAS_COLS);
  const col = idx % RESOURCE_ATLAS_COLS;
  if (row < 0 || row >= atlas.rows) return false;
  const startX = col * RESOURCE_ATLAS_CELL_SIZE;
  const startY = row * RESOURCE_ATLAS_CELL_SIZE;
  // Civ3 resources.pcx cells include non-magenta top/left grid lines inside each
  // 50x50 slot. Those guide pixels are not icon content and must not make an
  // otherwise empty right-most slot look occupied.
  for (let y = 1; y < RESOURCE_ATLAS_CELL_SIZE; y += 1) {
    const rowOff = (startY + y) * atlas.width + startX;
    for (let x = 1; x < RESOURCE_ATLAS_CELL_SIZE; x += 1) {
      const paletteIndex = atlas.indices[rowOff + x];
      if (!isPaletteIndexMagenta(atlas.palette, paletteIndex, atlas.magentaIndex)) {
        return false;
      }
    }
  }
  return true;
}

function findNextResourceAtlasSlot(targetBuffer) {
  const atlas = getIndexedResourceAtlas(targetBuffer, 'target resources.pcx');
  const slotCount = atlas.rows * RESOURCE_ATLAS_COLS;
  let lastOccupied = -1;
  for (let idx = 0; idx < slotCount; idx += 1) {
    if (!isResourceAtlasCellEmpty(atlas, idx)) lastOccupied = idx;
  }
  return {
    index: lastOccupied + 1,
    lastOccupied,
    rows: atlas.rows,
    capacity: slotCount
  };
}

function getActiveImportedAtlasOps(tab) {
  if (!tab || !Array.isArray(tab.recordOps) || !Array.isArray(tab.entries)) return [];
  const entriesByRef = new Map();
  tab.entries.forEach((entry) => {
    const ref = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
    if (ref) entriesByRef.set(ref, entry);
  });
  const activeByRef = new Map();
  tab.recordOps.forEach((op) => {
    const kind = String(op && op.op || '').trim().toLowerCase();
    if (kind === 'delete') {
      const ref = String(op && op.recordRef || '').trim().toUpperCase();
      if (ref && activeByRef.has(ref)) activeByRef.delete(ref);
      return;
    }
    if (kind === 'add' && String(op && op.importArtFrom || '').trim()) {
      const newRef = String(op && op.newRecordRef || '').trim().toUpperCase();
      if (!newRef) return;
      const entry = entriesByRef.get(newRef) || null;
      if (!entry) return;
      activeByRef.set(newRef, { op, newRef, entry });
    }
  });
  return Array.from(activeByRef.values());
}

function getBiqIconIndexAllocationFloor(tab, fieldKey, excludedRefs = new Set()) {
  const fields = Array.isArray(tab && tab.entries) ? tab.entries : [];
  let maxIndex = -1;
  fields.forEach((entry) => {
    const ref = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
    if (ref && excludedRefs.has(ref)) return;
    const field = getBiqFieldByBaseKey(entry, fieldKey);
    const raw = field ? (field.value == null ? field.originalValue : field.value) : '';
    const idx = Number.parseInt(String(raw == null ? '' : raw), 10);
    if (Number.isFinite(idx) && idx >= 0) maxIndex = Math.max(maxIndex, idx);
  });
  return maxIndex + 1;
}

function getNextResourceAtlasAssignmentSlot(targetBuffer, resourceTab, activeImports = null) {
  const scan = findNextResourceAtlasSlot(targetBuffer);
  const imports = Array.isArray(activeImports) ? activeImports : getActiveImportedAtlasOps(resourceTab);
  const excludedRefs = new Set(imports.map((item) => String(item && item.newRef || '').trim().toUpperCase()).filter(Boolean));
  const referenceFloor = getBiqIconIndexAllocationFloor(resourceTab, 'icon', excludedRefs);
  return {
    ...scan,
    index: Math.max(scan.index, referenceFloor),
    scanIndex: scan.index,
    referenceFloor
  };
}

function getIndexedUnitAtlas(buffer, label = 'units_32.pcx') {
  const decoded = decodePcx(buffer, { returnIndexed: true, transparentIndexes: [] });
  if (!decoded || !decoded.indices || !decoded.palette) {
    throw new Error(`${label} must be an indexed 256-color PCX file.`);
  }
  const stride = UNIT_ATLAS_SPRITE_SIZE + UNIT_ATLAS_GUTTER;
  if (decoded.width < UNIT_ATLAS_GUTTER + UNIT_ATLAS_SPRITE_SIZE) {
    throw new Error(`${label} is too narrow for a Civ3 units_32.pcx atlas.`);
  }
  const cols = Math.floor((decoded.width - UNIT_ATLAS_GUTTER) / stride);
  const rows = Math.floor((decoded.height - UNIT_ATLAS_GUTTER) / stride);
  if (cols < 1 || rows < 1) {
    throw new Error(`${label} does not contain any full unit icon cells.`);
  }
  const magentaIndex = findPaletteColorIndex(decoded.palette, UNIT_ATLAS_MAGENTA, 255);
  if (magentaIndex < 0) {
    throw new Error(`${label} palette does not contain Civ3 magenta (#ff00ff).`);
  }
  return { ...decoded, cols, rows, stride, gutter: UNIT_ATLAS_GUTTER, spriteSize: UNIT_ATLAS_SPRITE_SIZE, magentaIndex };
}

function isUnitAtlasCellEmpty(atlas, cellIndex) {
  const idx = Number(cellIndex) | 0;
  if (!atlas || idx < 0) return false;
  const row = Math.floor(idx / atlas.cols);
  const col = idx % atlas.cols;
  if (row < 0 || row >= atlas.rows) return false;
  const startX = col * atlas.stride + atlas.gutter;
  const startY = row * atlas.stride + atlas.gutter;
  for (let y = 0; y < atlas.spriteSize; y += 1) {
    const rowOff = (startY + y) * atlas.width + startX;
    for (let x = 0; x < atlas.spriteSize; x += 1) {
      const paletteIndex = atlas.indices[rowOff + x];
      if (!isPaletteIndexMagenta(atlas.palette, paletteIndex, atlas.magentaIndex)) {
        return false;
      }
    }
  }
  return true;
}

function findNextUnitAtlasSlot(targetBuffer) {
  const atlas = getIndexedUnitAtlas(targetBuffer, 'target units_32.pcx');
  const slotCount = atlas.rows * atlas.cols;
  let lastOccupied = -1;
  for (let idx = 0; idx < slotCount; idx += 1) {
    if (!isUnitAtlasCellEmpty(atlas, idx)) lastOccupied = idx;
  }
  return {
    index: lastOccupied + 1,
    lastOccupied,
    rows: atlas.rows,
    cols: atlas.cols,
    capacity: slotCount
  };
}

function getNextUnitAtlasAssignmentSlot(targetBuffer, unitsTab, activeImports = null) {
  const scan = findNextUnitAtlasSlot(targetBuffer);
  const imports = Array.isArray(activeImports) ? activeImports : getActiveImportedAtlasOps(unitsTab);
  const excludedRefs = new Set(imports.map((item) => String(item && item.newRef || '').trim().toUpperCase()).filter(Boolean));
  const referenceFloor = getBiqIconIndexAllocationFloor(unitsTab, 'iconindex', excludedRefs);
  return {
    ...scan,
    index: Math.max(scan.index, referenceFloor),
    scanIndex: scan.index,
    referenceFloor
  };
}

function makePaletteRemap(sourcePalette, targetPalette, targetMagentaIndex) {
  const remap = new Uint8Array(256);
  for (let srcIdx = 0; srcIdx < 256; srcIdx += 1) {
    const color = paletteRgbAt(sourcePalette, srcIdx);
    if (color.r === RESOURCE_ATLAS_MAGENTA.r && color.g === RESOURCE_ATLAS_MAGENTA.g && color.b === RESOURCE_ATLAS_MAGENTA.b) {
      remap[srcIdx] = targetMagentaIndex;
      continue;
    }
    const exact = findPaletteColorIndex(targetPalette, color);
    if (exact >= 0 && exact !== targetMagentaIndex) {
      remap[srcIdx] = exact;
      continue;
    }
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let targetIdx = 0; targetIdx < 256; targetIdx += 1) {
      if (targetIdx === targetMagentaIndex) continue;
      const targetColor = paletteRgbAt(targetPalette, targetIdx);
      const dr = color.r - targetColor.r;
      const dg = color.g - targetColor.g;
      const db = color.b - targetColor.b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = targetIdx;
        if (distance === 0) break;
      }
    }
    remap[srcIdx] = bestIndex;
  }
  return remap;
}

function appendResourceIconToResourcesPcx({ targetBuffer, sourceBuffer, sourceIconIndex, targetIconIndex = null }) {
  const sourceIndex = Number.parseInt(String(sourceIconIndex == null ? '' : sourceIconIndex), 10);
  if (!Number.isFinite(sourceIndex) || sourceIndex < 0) {
    throw new Error(`Invalid source resource icon index: ${sourceIconIndex}`);
  }
  const explicitTargetIndex = Number.parseInt(String(targetIconIndex == null ? '' : targetIconIndex), 10);
  const target = getIndexedResourceAtlas(targetBuffer, 'target resources.pcx');
  const source = getIndexedResourceAtlas(sourceBuffer, 'source resources.pcx');
  if (sourceIndex >= source.rows * RESOURCE_ATLAS_COLS) {
    throw new Error(`Source resource icon index ${sourceIndex} is outside source resources.pcx.`);
  }

  const slot = findNextResourceAtlasSlot(targetBuffer);
  const targetIndex = Number.isFinite(explicitTargetIndex) && explicitTargetIndex >= 0
    ? explicitTargetIndex
    : slot.index;
  const requiredRows = Math.floor(targetIndex / RESOURCE_ATLAS_COLS) + 1;
  const newHeight = Math.max(target.height, requiredRows * RESOURCE_ATLAS_CELL_SIZE);
  const nextIndices = new Uint8Array(target.width * newHeight);
  nextIndices.fill(target.magentaIndex);
  for (let y = 0; y < target.height; y += 1) {
    nextIndices.set(
      target.indices.subarray(y * target.width, (y + 1) * target.width),
      y * target.width
    );
  }

  const remap = makePaletteRemap(source.palette, target.palette, target.magentaIndex);
  const srcCol = sourceIndex % RESOURCE_ATLAS_COLS;
  const srcRow = Math.floor(sourceIndex / RESOURCE_ATLAS_COLS);
  const dstCol = targetIndex % RESOURCE_ATLAS_COLS;
  const dstRow = Math.floor(targetIndex / RESOURCE_ATLAS_COLS);
  const srcX = srcCol * RESOURCE_ATLAS_CELL_SIZE;
  const srcY = srcRow * RESOURCE_ATLAS_CELL_SIZE;
  const dstX = dstCol * RESOURCE_ATLAS_CELL_SIZE;
  const dstY = dstRow * RESOURCE_ATLAS_CELL_SIZE;

  for (let y = 0; y < RESOURCE_ATLAS_CELL_SIZE; y += 1) {
    const sourceRow = (srcY + y) * source.width + srcX;
    const targetRow = (dstY + y) * target.width + dstX;
    for (let x = 0; x < RESOURCE_ATLAS_CELL_SIZE; x += 1) {
      nextIndices[targetRow + x] = remap[source.indices[sourceRow + x]];
    }
  }

  return {
    buffer: encodePcx(nextIndices, target.palette, target.width, newHeight),
    index: targetIndex,
    lastOccupied: slot.lastOccupied,
    scanIndex: slot.index,
    oldRows: target.rows,
    newRows: Math.floor(newHeight / RESOURCE_ATLAS_CELL_SIZE),
    appendedRow: newHeight > target.height
  };
}

function appendUnitIconToUnits32Pcx({ targetBuffer, sourceBuffer, sourceIconIndex, targetIconIndex = null }) {
  const sourceIndex = Number.parseInt(String(sourceIconIndex == null ? '' : sourceIconIndex), 10);
  if (!Number.isFinite(sourceIndex) || sourceIndex < 0) {
    throw new Error(`Invalid source unit icon index: ${sourceIconIndex}`);
  }
  const explicitTargetIndex = Number.parseInt(String(targetIconIndex == null ? '' : targetIconIndex), 10);
  const target = getIndexedUnitAtlas(targetBuffer, 'target units_32.pcx');
  const source = getIndexedUnitAtlas(sourceBuffer, 'source units_32.pcx');
  if (sourceIndex >= source.rows * source.cols) {
    throw new Error(`Source unit icon index ${sourceIndex} is outside source units_32.pcx.`);
  }

  const slot = findNextUnitAtlasSlot(targetBuffer);
  const targetIndex = Number.isFinite(explicitTargetIndex) && explicitTargetIndex >= 0
    ? explicitTargetIndex
    : slot.index;
  const requiredRows = Math.floor(targetIndex / target.cols) + 1;
  const requiredHeight = requiredRows * target.stride + target.gutter;
  const newHeight = Math.max(target.height, requiredHeight);
  const nextIndices = new Uint8Array(target.width * newHeight);
  nextIndices.fill(target.magentaIndex);
  for (let y = 0; y < target.height; y += 1) {
    nextIndices.set(
      target.indices.subarray(y * target.width, (y + 1) * target.width),
      y * target.width
    );
  }

  const remap = makePaletteRemap(source.palette, target.palette, target.magentaIndex);
  const srcCol = sourceIndex % source.cols;
  const srcRow = Math.floor(sourceIndex / source.cols);
  const dstCol = targetIndex % target.cols;
  const dstRow = Math.floor(targetIndex / target.cols);
  const srcX = srcCol * source.stride + source.gutter;
  const srcY = srcRow * source.stride + source.gutter;
  const dstX = dstCol * target.stride + target.gutter;
  const dstY = dstRow * target.stride + target.gutter;

  for (let y = 0; y < UNIT_ATLAS_SPRITE_SIZE; y += 1) {
    const sourceRow = (srcY + y) * source.width + srcX;
    const targetRow = (dstY + y) * target.width + dstX;
    for (let x = 0; x < UNIT_ATLAS_SPRITE_SIZE; x += 1) {
      nextIndices[targetRow + x] = remap[source.indices[sourceRow + x]];
    }
  }

  return {
    buffer: encodePcx(nextIndices, target.palette, target.width, newHeight),
    index: targetIndex,
    lastOccupied: slot.lastOccupied,
    scanIndex: slot.index,
    oldRows: target.rows,
    newRows: Math.floor((newHeight - target.gutter) / target.stride),
    appendedRow: newHeight > target.height
  };
}

function getBiqFieldByBaseKey(entry, key) {
  const target = String(key || '').trim().toLowerCase();
  return (Array.isArray(entry && entry.biqFields) ? entry.biqFields : []).find((field) =>
    String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target
  ) || null;
}

function parseScienceAdvisorTechFieldInt(entry, key, fallback = 0) {
  const field = getBiqFieldByBaseKey(entry, key);
  const parsed = parseReferenceIdFromFieldValue(field && field.value);
  if (parsed != null) return parsed;
  const n = Number.parseInt(String(field && field.value || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function collectScienceAdvisorTechNodes(tabs) {
  const entries = (tabs && tabs.technologies && Array.isArray(tabs.technologies.entries))
    ? tabs.technologies.entries
    : [];
  const nodes = entries.map((entry, fallbackIdx) => {
    const id = Number.isFinite(entry && entry.biqIndex) ? entry.biqIndex : fallbackIdx;
    const prereqs = ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4', 'prerequisite']
      .map((key) => {
        const field = getBiqFieldByBaseKey(entry, key);
        return parseReferenceIdFromFieldValue(field && field.value);
      })
      .filter((value, idx, arr) => value != null && value >= 0 && arr.indexOf(value) === idx);
    return {
      id,
      entry,
      era: parseScienceAdvisorTechFieldInt(entry, 'era', -1),
      x: Math.max(0, parseScienceAdvisorTechFieldInt(entry, 'x', 0)),
      y: Math.max(0, parseScienceAdvisorTechFieldInt(entry, 'y', 0)),
      prereqs
    };
  });
  const byId = new Map();
  nodes.forEach((node) => byId.set(node.id, node));
  return { nodes, byId };
}

function decodeScienceAdvisorAvailableToIndices(rawValue) {
  const raw = cleanDisplayText(rawValue);
  const parsed = /^-?\d+$/.test(raw) ? Number.parseInt(raw, 10) : 0;
  const mask = (Number.isFinite(parsed) ? parsed : 0) >>> 0;
  const out = [];
  for (let idx = 0; idx < 32; idx += 1) {
    if (((mask >>> idx) & 1) === 1) out.push(idx);
  }
  return out;
}

function normalizeScienceAdvisorUnitCivFilter(filter) {
  if (!filter || typeof filter !== 'object') return null;
  const rawSelectedCivIndex = filter.selectedCivIndex;
  const selectedCivIndex = rawSelectedCivIndex == null || rawSelectedCivIndex === '' ? NaN : Number(rawSelectedCivIndex);
  const generalCivIndices = Array.isArray(filter.generalCivIndices)
    ? filter.generalCivIndices
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  return {
    selectedCivIndex: Number.isFinite(selectedCivIndex) && selectedCivIndex >= 0 ? selectedCivIndex : null,
    generalCivIndices
  };
}

function shouldShowScienceAdvisorUnitInTechBox(entry, unitCivFilter = null) {
  const availableTo = new Set(decodeScienceAdvisorAvailableToIndices(getBiqFieldByBaseKey(entry, 'availableto') && getBiqFieldByBaseKey(entry, 'availableto').value));
  if (availableTo.size === 0) return false;
  const filter = normalizeScienceAdvisorUnitCivFilter(unitCivFilter);
  if (filter && filter.selectedCivIndex != null) return availableTo.has(filter.selectedCivIndex);
  const generalCivIndices = filter ? filter.generalCivIndices : [];
  if (generalCivIndices.length === 0) return true;
  return generalCivIndices.every((idx) => availableTo.has(idx));
}

function getScienceAdvisorCivFilterForEra(civFiltersByEra, eraIndex) {
  const root = civFiltersByEra && typeof civFiltersByEra === 'object' ? civFiltersByEra : {};
  return normalizeScienceAdvisorUnitCivFilter(root[String(Number(eraIndex) || 0)] || null);
}

function countScienceAdvisorUnlockIconsForTech(tabs, techId, unitCivFilter = null) {
  let count = 1;
  const unitEntries = (((tabs || {}).units || {}).entries) || [];
  unitEntries.forEach((entry) => {
    const required = parseReferenceIdFromFieldValue(getBiqFieldByBaseKey(entry, 'requiredtech') && getBiqFieldByBaseKey(entry, 'requiredtech').value);
    if (required === techId && shouldShowScienceAdvisorUnitInTechBox(entry, unitCivFilter)) count += 1;
  });
  const improvementEntries = (((tabs || {}).improvements || {}).entries) || [];
  improvementEntries.forEach((entry) => {
    const required = parseReferenceIdFromFieldValue(getBiqFieldByBaseKey(entry, 'reqadvance') && getBiqFieldByBaseKey(entry, 'reqadvance').value);
    if (required === techId) count += 1;
    const obsoleteBy = parseReferenceIdFromFieldValue(getBiqFieldByBaseKey(entry, 'obsoleteby') && getBiqFieldByBaseKey(entry, 'obsoleteby').value);
    if (obsoleteBy === techId) count += 1;
  });
  const workerEntries = (((tabs || {}).workerActions || {}).entries) || [];
  workerEntries.forEach((entry) => {
    const required = parseReferenceIdFromFieldValue(getBiqFieldByBaseKey(entry, 'requiredadvance') && getBiqFieldByBaseKey(entry, 'requiredadvance').value);
    if (required === techId) count += 1;
  });
  return count;
}

function loadScienceAdvisorTechBoxLayout({ civ3Path, scenarioPath, scenarioRoots }) {
  const sourcePath = resolveConquestsAssetPath(civ3Path, SCIENCE_ADVISOR_TECHBOX_RELATIVE_PATH, scenarioPath, scenarioRoots);
  if (!sourcePath) return null;
  try {
    const decoded = decodePcx(sourcePath, { returnIndexed: true, transparentIndexes: [254, 255] });
    return techBoxLayout.parseTechBoxSheetLayout(decoded);
  } catch (_err) {
    return null;
  }
}

function getScienceAdvisorTechBoxRect({ layout, eraIndex, sizeIndex }) {
  const frame = layout
    ? techBoxLayout.getTechBoxFrame(layout, eraIndex, sizeIndex, techBoxLayout.TECH_BOX_DEFAULT_COLUMN_INDEX)
    : null;
  if (frame) return { w: Math.max(1, Number(frame.w) || 1), h: Math.max(1, Number(frame.h) || 1) };
  return SCIENCE_ADVISOR_FALLBACK_TECHBOX_FRAMES[sizeIndex] || SCIENCE_ADVISOR_FALLBACK_TECHBOX_FRAMES[0];
}

function annotateScienceAdvisorNodeRects({ nodes, tabs, layout, civFiltersByEra = {} }) {
  nodes.forEach((node) => {
    const iconCount = countScienceAdvisorUnlockIconsForTech(tabs, node.id, getScienceAdvisorCivFilterForEra(civFiltersByEra, node.era));
    const sizeIndex = techBoxLayout.chooseTechBoxSizeIndexForIconCount(iconCount);
    const rect = getScienceAdvisorTechBoxRect({ layout, eraIndex: node.era, sizeIndex });
    node.w = rect.w;
    node.h = rect.h;
    node.sizeIndex = sizeIndex;
  });
}

function getScienceAdvisorArrowBounds(nodes, width, height) {
  const visible = nodes.filter((node) => node && node.era >= 0);
  if (visible.length === 0) return { x1: 0, y1: 0, x2: width - 1, y2: height - 1 };
  let x1 = width;
  let y1 = height;
  let x2 = 0;
  let y2 = 0;
  visible.forEach((node) => {
    x1 = Math.min(x1, Number(node.x) || 0);
    y1 = Math.min(y1, Number(node.y) || 0);
    x2 = Math.max(x2, (Number(node.x) || 0) + (Number(node.w) || 120));
    y2 = Math.max(y2, (Number(node.y) || 0) + (Number(node.h) || 60));
  });
  return {
    x1: Math.max(0, Math.floor(x1 - 90)),
    y1: Math.max(0, Math.floor(y1 - 70)),
    x2: Math.min(width - 1, Math.ceil(x2 + 120)),
    y2: Math.min(height - 1, Math.ceil(y2 + 90))
  };
}

function normalizeScienceAdvisorArrowBounds(bounds, width, height) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (!w || !h) return { x1: 0, y1: 0, x2: -1, y2: -1 };
  return {
    x1: Math.max(0, Math.min(w - 1, Math.floor(Number(bounds && bounds.x1) || 0))),
    y1: Math.max(0, Math.min(h - 1, Math.floor(Number(bounds && bounds.y1) || 0))),
    x2: Math.max(0, Math.min(w - 1, Math.ceil(Number(bounds && bounds.x2) || 0))),
    y2: Math.max(0, Math.min(h - 1, Math.ceil(Number(bounds && bounds.y2) || 0)))
  };
}

function getScienceAdvisorPreviewClearBounds(width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  return {
    x1: Math.max(0, Math.floor(w * 0.04)),
    y1: Math.max(0, Math.floor(h * 0.11)),
    x2: Math.min(w - 1, Math.ceil(w * 0.94)),
    y2: Math.min(h - 1, Math.ceil(h * 0.9))
  };
}

function getScienceAdvisorArrowRouteConstraintArea(width, height) {
  const w = Math.max(1, Number(width) || 1024);
  const h = Math.max(1, Number(height) || 768);
  if (scienceAdvisorArrows && typeof scienceAdvisorArrows.getScienceAdvisorFrameInnerLayoutArea === 'function') {
    const area = scienceAdvisorArrows.getScienceAdvisorFrameInnerLayoutArea(w, h);
    const bounds = area && area.bounds;
    if (bounds && Number(bounds.w) > 0 && Number(bounds.h) > 0) {
      return {
        bounds: {
          x: Math.max(0, Number(bounds.x) || 0),
          y: Math.max(0, Number(bounds.y) || 0),
          w: Math.max(1, Number(bounds.w) || 1),
          h: Math.max(1, Number(bounds.h) || 1)
        },
        exclusionZones: Array.isArray(area.exclusionZones) ? area.exclusionZones : [],
        margin: 10
      };
    }
  }
  return { bounds: { x: 0, y: 0, w, h }, exclusionZones: [], margin: 10 };
}

function isScienceAdvisorArrowPixelIndexed(indices, palette, offset) {
  if (!indices || !palette || offset < 0 || offset >= indices.length) return false;
  const idx = Number(indices[offset]) || 0;
  const paletteOffset = idx * 3;
  if (paletteOffset + 2 >= palette.length) return false;
  return scienceAdvisorArrows.isScienceAdvisorArrowColor(
    Number(palette[paletteOffset]) || 0,
    Number(palette[paletteOffset + 1]) || 0,
    Number(palette[paletteOffset + 2]) || 0
  );
}

function collectScienceAdvisorResidualArrowDiagnostics({ indices, palette, width, height, bounds, clusterLimit = 8 }) {
  const normalizedBounds = normalizeScienceAdvisorArrowBounds(bounds, width, height);
  if (!indices || !palette || normalizedBounds.x2 < normalizedBounds.x1 || normalizedBounds.y2 < normalizedBounds.y1) {
    return { count: 0, bounds: null, clusters: [], omittedClusters: 0 };
  }
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const visited = new Uint8Array(Math.max(0, w * h));
  const queue = new Int32Array(Math.max(1, w * h));
  const clusters = [];
  let total = 0;
  let globalBounds = null;
  const addGlobal = (x, y) => {
    if (!globalBounds) globalBounds = { x1: x, y1: y, x2: x, y2: y };
    else {
      globalBounds.x1 = Math.min(globalBounds.x1, x);
      globalBounds.y1 = Math.min(globalBounds.y1, y);
      globalBounds.x2 = Math.max(globalBounds.x2, x);
      globalBounds.y2 = Math.max(globalBounds.y2, y);
    }
  };
  for (let y = normalizedBounds.y1; y <= normalizedBounds.y2; y += 1) {
    for (let x = normalizedBounds.x1; x <= normalizedBounds.x2; x += 1) {
      const start = (y * w) + x;
      if (visited[start] || !isScienceAdvisorArrowPixelIndexed(indices, palette, start)) continue;
      let head = 0;
      let tail = 0;
      let count = 0;
      const cluster = { count: 0, x1: x, y1: y, x2: x, y2: y };
      visited[start] = 1;
      queue[tail] = start;
      tail += 1;
      while (head < tail) {
        const pixel = queue[head];
        head += 1;
        const px = pixel % w;
        const py = Math.floor(pixel / w);
        count += 1;
        addGlobal(px, py);
        cluster.x1 = Math.min(cluster.x1, px);
        cluster.y1 = Math.min(cluster.y1, py);
        cluster.x2 = Math.max(cluster.x2, px);
        cluster.y2 = Math.max(cluster.y2, py);
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            const nx = px + ox;
            const ny = py + oy;
            if (nx < normalizedBounds.x1 || nx > normalizedBounds.x2 || ny < normalizedBounds.y1 || ny > normalizedBounds.y2) continue;
            const next = (ny * w) + nx;
            if (visited[next] || !isScienceAdvisorArrowPixelIndexed(indices, palette, next)) continue;
            visited[next] = 1;
            queue[tail] = next;
            tail += 1;
          }
        }
      }
      cluster.count = count;
      total += count;
      clusters.push(cluster);
    }
  }
  clusters.sort((a, b) => b.count - a.count);
  const limit = Math.max(0, Number(clusterLimit) || 0);
  return {
    count: total,
    bounds: globalBounds,
    clusters: clusters.slice(0, limit),
    omittedClusters: Math.max(0, clusters.length - limit)
  };
}

function compareScienceAdvisorIndexedPixels(a, b, width, height) {
  const total = Math.min(
    a && a.length ? a.length : 0,
    b && b.length ? b.length : 0,
    Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0)
  );
  const w = Math.max(1, Number(width) || 1);
  let count = 0;
  let bounds = null;
  for (let offset = 0; offset < total; offset += 1) {
    if (a[offset] === b[offset]) continue;
    count += 1;
    const x = offset % w;
    const y = Math.floor(offset / w);
    if (!bounds) bounds = { x1: x, y1: y, x2: x, y2: y };
    else {
      bounds.x1 = Math.min(bounds.x1, x);
      bounds.y1 = Math.min(bounds.y1, y);
      bounds.x2 = Math.max(bounds.x2, x);
      bounds.y2 = Math.max(bounds.y2, y);
    }
  }
  return { count, bounds };
}

function formatScienceAdvisorBoundsForLog(bounds) {
  if (!bounds) return 'none';
  return `${bounds.x1},${bounds.y1}-${bounds.x2},${bounds.y2}`;
}

function formatScienceAdvisorClustersForLog(clusters, omittedClusters = 0) {
  const list = Array.isArray(clusters) ? clusters : [];
  if (list.length === 0) return 'none';
  const text = list.map((cluster) => (
    `${cluster.count}@${formatScienceAdvisorBoundsForLog(cluster)}`
  )).join(';');
  return omittedClusters > 0 ? `${text};+${omittedClusters} more` : text;
}

function formatScienceAdvisorRectForLog(rect) {
  if (!rect) return 'none';
  return `${Math.round(Number(rect.x) || 0)},${Math.round(Number(rect.y) || 0)},${Math.round(Number(rect.w) || 0)}x${Math.round(Number(rect.h) || 0)}`;
}

function formatScienceAdvisorRoutePointsForLog(points) {
  const list = Array.isArray(points) ? points : [];
  if (list.length === 0) return 'none';
  return list.map((point) => `${Math.round(Number(point.x) || 0)},${Math.round(Number(point.y) || 0)}`).join(';');
}

function getScienceAdvisorRouteNodeName(node) {
  return String((node && (node.name || node.title || node.label)) || '').trim() || 'unknown';
}

function getScienceAdvisorRoutePointSide(rect, point) {
  if (!rect || !point) return '';
  const x = Number(point.x) || 0;
  const y = Number(point.y) || 0;
  const left = Math.abs(x - (Number(rect.x) || 0));
  const right = Math.abs(x - ((Number(rect.x) || 0) + (Number(rect.w) || 0)));
  const top = Math.abs(y - (Number(rect.y) || 0));
  const bottom = Math.abs(y - ((Number(rect.y) || 0) + (Number(rect.h) || 0)));
  const min = Math.min(left, right, top, bottom);
  if (min === left) return 'left';
  if (min === right) return 'right';
  if (min === top) return 'top';
  return 'bottom';
}

function buildScienceAdvisorArrowRouteKey(eraIndex, sourceId, targetId) {
  return `${Number(eraIndex) || 0}:${Number(sourceId)}->${Number(targetId)}`;
}

function getScienceAdvisorArrowRouteEraKey(routeKey) {
  const match = String(routeKey || '').match(/^(\d+):/);
  return match ? String(Number.parseInt(match[1], 10) || 0) : '';
}

function normalizeScienceAdvisorOverrideRoute(route) {
  const points = Array.isArray(route && route.points) ? route.points : [];
  const normalized = points
    .map((point) => ({ x: Number(point && point.x), y: Number(point && point.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return normalized.length >= 2 ? normalized : null;
}

function normalizeScienceAdvisorRouteOverrides(input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  Object.entries(source).forEach(([key, value]) => {
    const route = normalizeScienceAdvisorOverrideRoute(value);
    if (!route) return;
    out[String(key)] = {
      points: route.map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y)
      }))
    };
  });
  return out;
}

function normalizeScienceAdvisorRouteHint(hint) {
  const sourceSide = String(hint && hint.sourceSide || '').toLowerCase();
  const targetSide = String(hint && hint.targetSide || '').toLowerCase();
  const validSides = new Set(['left', 'right', 'top', 'bottom']);
  if (!validSides.has(sourceSide) || !validSides.has(targetSide)) return null;
  return {
    sourceSide,
    targetSide,
    sourceOffset: Number(hint && hint.sourceOffset) || 0,
    targetOffset: Number(hint && hint.targetOffset) || 0,
    horizontalTolerance: Number.isFinite(Number(hint && hint.horizontalTolerance)) ? Number(hint.horizontalTolerance) : 18
  };
}

function normalizeScienceAdvisorRouteHints(input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  Object.entries(source).forEach(([key, value]) => {
    const hint = normalizeScienceAdvisorRouteHint(value);
    if (!hint) return;
    out[String(key)] = hint;
  });
  return out;
}

function loadScienceAdvisorArrowMetadata(targetContentRoot) {
  const root = String(targetContentRoot || '').trim();
  const metadataPath = root ? path.join(root, SCIENCE_ADVISOR_ARROW_METADATA_RELATIVE_PATH) : '';
  if (!metadataPath) {
    return {
      path: '',
      exists: false,
      routeOverrides: {},
      routeSnapshots: {},
      baselineRouteHints: {}
    };
  }
  let parsed = null;
  const text = readTextIfExists(metadataPath);
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      parsed = null;
    }
  }
  return {
    path: metadataPath,
    exists: !!text,
    format: parsed && typeof parsed === 'object' ? String(parsed.format || '') : '',
    version: parsed && typeof parsed === 'object' ? Number(parsed.version) || 0 : 0,
    routeOverrides: normalizeScienceAdvisorRouteOverrides(parsed && parsed.routeOverrides),
    routeSnapshots: normalizeScienceAdvisorRouteOverrides(parsed && parsed.routeSnapshots),
    baselineRouteHints: normalizeScienceAdvisorRouteHints(parsed && parsed.baselineRouteHints)
  };
}

function mergeScienceAdvisorArrowMetadataForDirtyEras(existingMap, incomingMap, dirtyEraKeys) {
  const out = {};
  const dirtyKeys = dirtyEraKeys instanceof Set ? dirtyEraKeys : new Set();
  Object.entries(existingMap && typeof existingMap === 'object' ? existingMap : {}).forEach(([key, value]) => {
    const eraKey = getScienceAdvisorArrowRouteEraKey(key);
    if (eraKey && !dirtyKeys.has(eraKey)) out[key] = value;
  });
  Object.entries(incomingMap && typeof incomingMap === 'object' ? incomingMap : {}).forEach(([key, value]) => {
    out[key] = value;
  });
  return out;
}

function buildScienceAdvisorArrowMetadataWrite({
  targetContentRoot,
  routeOverrides = {},
  routeSnapshots = {},
  baselineRouteHints = {},
  dirtyEraIndexes = []
}) {
  const root = String(targetContentRoot || '').trim();
  if (!root) return null;
  const dirtyEraKeys = new Set((Array.isArray(dirtyEraIndexes) ? dirtyEraIndexes : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0)
    .map((value) => String(value)));
  const incoming = {
    routeOverrides: normalizeScienceAdvisorRouteOverrides(routeOverrides),
    routeSnapshots: normalizeScienceAdvisorRouteOverrides(routeSnapshots),
    baselineRouteHints: normalizeScienceAdvisorRouteHints(baselineRouteHints)
  };
  const existing = dirtyEraKeys.size > 0
    ? loadScienceAdvisorArrowMetadata(root)
    : null;
  const metadata = {
    format: SCIENCE_ADVISOR_ARROW_METADATA_FORMAT,
    version: 1,
    routeOverrides: existing && existing.exists
      ? mergeScienceAdvisorArrowMetadataForDirtyEras(existing.routeOverrides, incoming.routeOverrides, dirtyEraKeys)
      : incoming.routeOverrides,
    routeSnapshots: existing && existing.exists
      ? mergeScienceAdvisorArrowMetadataForDirtyEras(existing.routeSnapshots, incoming.routeSnapshots, dirtyEraKeys)
      : incoming.routeSnapshots,
    baselineRouteHints: existing && existing.exists
      ? mergeScienceAdvisorArrowMetadataForDirtyEras(existing.baselineRouteHints, incoming.baselineRouteHints, dirtyEraKeys)
      : incoming.baselineRouteHints
  };
  return {
    kind: 'scienceAdvisorArrowMetadata',
    path: path.join(root, SCIENCE_ADVISOR_ARROW_METADATA_RELATIVE_PATH),
    data: `${JSON.stringify(metadata, null, 2)}\n`,
    encoding: 'utf8',
    applied: Object.keys(metadata.routeOverrides).length + Object.keys(metadata.routeSnapshots).length + Object.keys(metadata.baselineRouteHints).length,
    detail: 'Saved generated Science Advisor arrow routing metadata'
  };
}

function getScienceAdvisorEraDirtyEdgeSet(dirtyEdgesByEra, eraIndex) {
  const root = dirtyEdgesByEra && typeof dirtyEdgesByEra === 'object' ? dirtyEdgesByEra : {};
  const value = root[String(Number(eraIndex) || 0)];
  if (!value || typeof value !== 'object') return new Set();
  return new Set(Object.keys(value).filter((key) => value[key]));
}

function buildScienceAdvisorArrowRoutesForEra({
  nodes,
  byId,
  eraIndex,
  routeOverrides = {},
  routeSnapshots = {},
  baselineRouteHints = {},
  dirtyEdgesByEra = {}
}) {
  const edges = [];
  const eraNodes = nodes.filter((node) => node && node.era === eraIndex);
  eraNodes.forEach((target) => {
      target.prereqs.forEach((sourceId) => {
        const source = byId.get(sourceId);
        if (!source || source.era !== eraIndex) return;
        edges.push({
          key: buildScienceAdvisorArrowRouteKey(eraIndex, source.id, target.id),
          source,
          target,
          sourceRect: { x: source.x, y: source.y, w: source.w, h: source.h },
          targetRect: { x: target.x, y: target.y, w: target.w, h: target.h }
        });
      });
    });
  const dirtyEdgeSet = getScienceAdvisorEraDirtyEdgeSet(dirtyEdgesByEra, eraIndex);
  const makeRouteDebug = (edge, routeKey, routeSource, points, extra = {}) => {
    const first = Array.isArray(points) && points.length > 0 ? points[0] : null;
    const last = Array.isArray(points) && points.length > 0 ? points[points.length - 1] : null;
    return {
      key: routeKey,
      sourceId: edge.source.id,
      targetId: edge.target.id,
      sourceName: getScienceAdvisorRouteNodeName(edge.source),
      targetName: getScienceAdvisorRouteNodeName(edge.target),
      sourceRect: edge.sourceRect,
      targetRect: edge.targetRect,
      edgeSourceSide: edge.sourceSide || '',
      edgeTargetSide: edge.targetSide || '',
      routeSource,
      routeSourceSide: extra.routeSourceSide || getScienceAdvisorRoutePointSide(edge.sourceRect, first),
      routeTargetSide: extra.routeTargetSide || getScienceAdvisorRoutePointSide(edge.targetRect, last),
      dirty: extra.dirty === true,
      ignoredSnapshot: extra.ignoredSnapshot === true,
      ignoredHint: extra.ignoredHint === true
    };
  };
  const makeRouteFromPoints = (points, edge, routeKey, routeSource, extra = {}) => {
    const tip = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2] : { x: tip.x - 1, y: tip.y };
    return {
      dir: tip.x >= prev.x ? 1 : -1,
      headVector: { x: tip.x - prev.x, y: tip.y - prev.y },
      points,
      debug: makeRouteDebug(edge, routeKey, routeSource, points, extra)
    };
  };
  return techBoxLayout.layoutTechTreeArrowEdges(edges, { slotSpacing: 10 })
    .map((edge) => {
      const routeKey = edge.key || buildScienceAdvisorArrowRouteKey(eraIndex, edge.source.id, edge.target.id);
      const isDirtyEdge = dirtyEdgeSet.has(routeKey);
      const override = normalizeScienceAdvisorOverrideRoute(routeOverrides[routeKey]);
      if (override) {
        return makeRouteFromPoints(override, edge, routeKey, 'override', { dirty: isDirtyEdge });
      }
      const rawSnapshot = normalizeScienceAdvisorOverrideRoute(routeSnapshots[routeKey]);
      const snapshotAttached = rawSnapshot
        && techBoxLayout
        && typeof techBoxLayout.isTechTreeArrowRouteAttachedToRects === 'function'
        && techBoxLayout.isTechTreeArrowRouteAttachedToRects(rawSnapshot, edge.sourceRect, edge.targetRect, { tolerance: 4 });
      const snapshot = !isDirtyEdge && snapshotAttached ? rawSnapshot : null;
      if (snapshot) {
        return makeRouteFromPoints(snapshot, edge, routeKey, 'snapshot', { dirty: false });
      }
      const rawBaselineHint = normalizeScienceAdvisorRouteHint(baselineRouteHints[routeKey]);
      const baselineHint = !isDirtyEdge ? rawBaselineHint : null;
      const routeOptions = baselineHint || {
        sourceSide: edge.sourceSide,
        targetSide: edge.targetSide,
        sourceOffset: edge.sourceOffset,
        targetOffset: edge.targetOffset,
        horizontalTolerance: 18
      };
      const route = techBoxLayout.buildTechTreeArrowRoute(
        edge.sourceRect,
        edge.targetRect,
        {
          pad: 0,
          maxElbow: 140,
          sourceSide: routeOptions.sourceSide,
          targetSide: routeOptions.targetSide,
          sourceOffset: routeOptions.sourceOffset,
          targetOffset: routeOptions.targetOffset,
          horizontalTolerance: routeOptions.horizontalTolerance
        }
      );
      return {
        ...route,
        debug: makeRouteDebug(
          edge,
          routeKey,
          baselineHint ? 'baseline-hint' : 'generated',
          route.points,
          {
            routeSourceSide: routeOptions.sourceSide,
            routeTargetSide: routeOptions.targetSide,
            dirty: isDirtyEdge,
            ignoredSnapshot: !!rawSnapshot && (isDirtyEdge || !snapshotAttached),
            ignoredHint: isDirtyEdge && !!rawBaselineHint
          }
        )
      };
    });
}

function prepareScienceAdvisorArrowArtWrites({
  tabs,
  targetContentRoot,
  scenarioPath,
  scenarioRoots,
  civ3Path,
  routeOverrides = {},
  routeSnapshots = {},
  baselineRouteHints = {},
  dirtyEdgesByEra = {},
  dirtyEraIndexes = [],
  arrowStyle = null,
  civFiltersByEra = {}
}) {
  if (!targetContentRoot) return { ok: true, changed: false, writes: [] };
  const { nodes, byId } = collectScienceAdvisorTechNodes(tabs || {});
  if (nodes.length === 0) return { ok: true, changed: false, writes: [] };
  const layout = loadScienceAdvisorTechBoxLayout({ civ3Path, scenarioPath, scenarioRoots });
  annotateScienceAdvisorNodeRects({ nodes, tabs: tabs || {}, layout, civFiltersByEra });
  const writes = [];
  const dirtyEraSet = new Set((Array.isArray(dirtyEraIndexes) ? dirtyEraIndexes : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0));
  SCIENCE_ADVISOR_BACKGROUND_RELATIVE_PATHS.forEach((candidates, eraIndex) => {
    if (dirtyEraSet.size > 0 && !dirtyEraSet.has(eraIndex)) return;
    const eraNodes = nodes.filter((node) => node.era === eraIndex);
    if (eraNodes.length === 0) return;
    let routes = buildScienceAdvisorArrowRoutesForEra({
      nodes,
      byId,
      eraIndex,
      routeOverrides,
      routeSnapshots,
      baselineRouteHints,
      dirtyEdgesByEra
    });
    if (routes.length === 0) return;
    const relativePath = candidates.find((assetPath) => resolveConquestsAssetPath(civ3Path, assetPath, scenarioPath, scenarioRoots));
    if (!relativePath) return;
    const sourcePath = resolveConquestsAssetPath(civ3Path, relativePath, scenarioPath, scenarioRoots);
    if (!sourcePath) return;
    let decoded;
    try {
      decoded = decodePcx(sourcePath, { returnIndexed: true, transparentIndexes: [] });
    } catch (_err) {
      return;
    }
    if (!decoded || !decoded.indices || !decoded.palette || typeof decoded.palette.length !== 'number') return;
    const width = Number(decoded.width) || 0;
    const height = Number(decoded.height) || 0;
    if (techBoxLayout && typeof techBoxLayout.constrainTechTreeArrowRoute === 'function') {
      const routeConstraintArea = getScienceAdvisorArrowRouteConstraintArea(width, height);
      routes = routes.map((route) => (
        route && route.debug && route.debug.routeSource === 'override'
          ? route
          : techBoxLayout.constrainTechTreeArrowRoute(route, routeConstraintArea)
      ));
    }
    const sourceIndices = decoded.indices;
    const indices = Uint8Array.from(sourceIndices);
    const bounds = getScienceAdvisorArrowBounds(eraNodes, width, height);
    const broadBounds = getScienceAdvisorPreviewClearBounds(width, height);
    scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({ indices, palette: decoded.palette, width, height, bounds });
    const residualAfterCurrentClear = collectScienceAdvisorResidualArrowDiagnostics({
      indices,
      palette: decoded.palette,
      width,
      height,
      bounds: broadBounds
    });
    const broadIndices = Uint8Array.from(sourceIndices);
    scienceAdvisorArrows.clearScienceAdvisorArrowPixelsIndexed({ indices: broadIndices, palette: decoded.palette, width, height, bounds: broadBounds });
    const residualAfterBroadClear = collectScienceAdvisorResidualArrowDiagnostics({
      indices: broadIndices,
      palette: decoded.palette,
      width,
      height,
      bounds: broadBounds
    });
    if (typeof scienceAdvisorArrows.restoreScienceAdvisorFramePixelsIndexed === 'function') {
      scienceAdvisorArrows.restoreScienceAdvisorFramePixelsIndexed({ indices: broadIndices, sourceIndices, width, height });
      scienceAdvisorArrows.restoreScienceAdvisorFramePixelsIndexed({ indices, sourceIndices, width, height });
    }
    scienceAdvisorArrows.drawScienceAdvisorRoutesIndexed({ indices: broadIndices, palette: decoded.palette, width, height, routes, techBoxLayout, eraIndex, style: arrowStyle });
    scienceAdvisorArrows.drawScienceAdvisorRoutesIndexed({ indices, palette: decoded.palette, width, height, routes, techBoxLayout, eraIndex, style: arrowStyle });
    const broadOutputDiff = compareScienceAdvisorIndexedPixels(indices, broadIndices, width, height);
    const targetPath = path.join(targetContentRoot, relativePath);
    routes.forEach((route) => {
      const debug = route && route.debug;
      if (!debug) return;
      log.info(
        'ScienceAdvisor',
        `arrow-route era=${eraIndex} key=${debug.key} target=${log.rel(targetPath)} `
          + `source="${String(debug.sourceName || '').replace(/"/g, "'")}"(${debug.sourceId}) `
          + `dest="${String(debug.targetName || '').replace(/"/g, "'")}"(${debug.targetId}) `
          + `routeSource=${debug.routeSource} dirty=${debug.dirty ? 1 : 0} `
          + `edgeSides=${debug.edgeSourceSide || ''}->${debug.edgeTargetSide || ''} `
          + `routeSides=${debug.routeSourceSide || ''}->${debug.routeTargetSide || ''} `
          + `ignoredSnapshot=${debug.ignoredSnapshot ? 1 : 0} ignoredHint=${debug.ignoredHint ? 1 : 0} `
          + `sourceRect=${formatScienceAdvisorRectForLog(debug.sourceRect)} `
          + `targetRect=${formatScienceAdvisorRectForLog(debug.targetRect)} `
          + `points=${formatScienceAdvisorRoutePointsForLog(route.points)}`
      );
    });
    const clearDiagnostics = {
      clearBounds: bounds,
      residualAfterCurrentClear,
      broadClearBounds: broadBounds,
      residualAfterBroadClear,
      broadOutputDiff
    };
    log.info(
      'ScienceAdvisor',
      `arrow-clear era=${eraIndex} routes=${routes.length} source=${log.rel(sourcePath)} target=${log.rel(targetPath)} `
        + `clearBounds=${formatScienceAdvisorBoundsForLog(bounds)} residual=${residualAfterCurrentClear.count} `
        + `residualBounds=${formatScienceAdvisorBoundsForLog(residualAfterCurrentClear.bounds)} `
        + `clusters=${formatScienceAdvisorClustersForLog(residualAfterCurrentClear.clusters, residualAfterCurrentClear.omittedClusters)} `
        + `broadBounds=${formatScienceAdvisorBoundsForLog(broadBounds)} broadResidual=${residualAfterBroadClear.count} `
        + `broadClusters=${formatScienceAdvisorClustersForLog(residualAfterBroadClear.clusters, residualAfterBroadClear.omittedClusters)} `
        + `broadOutputDiff=${broadOutputDiff.count} diffBounds=${formatScienceAdvisorBoundsForLog(broadOutputDiff.bounds)}`
    );
    try {
      const data = encodePcx(indices, decoded.palette, width, height);
      writes.push({
        kind: 'scienceAdvisor',
        path: targetPath,
        sourcePath,
        data,
        eraIndex,
        applied: routes.length,
        clearDiagnostics
      });
    } catch (_err) {
      // Skip this era; other scenario saves should not be blocked by one unreadable advisor PCX.
    }
  });
  return { ok: true, changed: writes.some((write) => write.kind === 'scienceAdvisor'), writes };
}

function applyImportedResourceIconAtlasAssignments({ resourceTab, targetAtlasBuffer, loadSourceAtlasBuffer }) {
  if (!resourceTab || !Array.isArray(resourceTab.recordOps) || !Array.isArray(resourceTab.entries)) {
    return { ok: true, changed: false, buffer: targetAtlasBuffer, assignments: [] };
  }
  const importOps = getActiveImportedAtlasOps(resourceTab);
  if (importOps.length === 0) {
    return { ok: true, changed: false, buffer: targetAtlasBuffer, assignments: [] };
  }
  if (!Buffer.isBuffer(targetAtlasBuffer)) {
    return { ok: false, error: 'Could not load target resources.pcx for imported resource icons.' };
  }
  let workingBuffer = targetAtlasBuffer;
  const assignments = [];
  const sourceBufferCache = new Map();
  let nextTargetIndex = getNextResourceAtlasAssignmentSlot(workingBuffer, resourceTab, importOps).index;

  for (const importItem of importOps) {
    const op = importItem.op;
    const newRef = importItem.newRef;
    const sourceBiqPath = String(op && op.importArtFrom || '').trim();
    if (!newRef || !sourceBiqPath) continue;
    const entry = importItem.entry;
    if (!entry) {
      return { ok: false, error: `Could not find imported resource entry ${newRef} for resources.pcx update.` };
    }
    const iconField = getBiqFieldByBaseKey(entry, 'icon');
    if (!iconField) {
      return { ok: false, error: `Imported resource ${newRef} has no resources.pcx icon field.` };
    }
    const pendingIcon = entry && entry._pendingImportedResourceIcon && typeof entry._pendingImportedResourceIcon === 'object'
      ? entry._pendingImportedResourceIcon
      : null;
    const pendingSourceIndex = Number.parseInt(String(pendingIcon && pendingIcon.sourceIconIndex), 10);
    const sourceIconIndex = Number.isFinite(pendingSourceIndex) && pendingSourceIndex >= 0
      ? pendingSourceIndex
      : Number.parseInt(String(iconField.value == null ? iconField.originalValue : iconField.value), 10);
    if (!Number.isFinite(sourceIconIndex) || sourceIconIndex < 0) {
      return { ok: false, error: `Imported resource ${newRef} has invalid source resources.pcx icon index.` };
    }
    if (!sourceBufferCache.has(sourceBiqPath)) {
      let sourceBuffer = null;
      try {
        sourceBuffer = typeof loadSourceAtlasBuffer === 'function' ? loadSourceAtlasBuffer(sourceBiqPath) : null;
      } catch (_err) {
        sourceBuffer = null;
      }
      if (!Buffer.isBuffer(sourceBuffer)) {
        return { ok: false, error: `Could not load source resources.pcx for imported resource ${newRef}.` };
      }
      sourceBufferCache.set(sourceBiqPath, sourceBuffer);
    }
    try {
      const result = appendResourceIconToResourcesPcx({
        targetBuffer: workingBuffer,
        sourceBuffer: sourceBufferCache.get(sourceBiqPath),
        sourceIconIndex,
        targetIconIndex: nextTargetIndex
      });
      workingBuffer = result.buffer;
      iconField.value = String(result.index);
      nextTargetIndex = result.index + 1;
      assignments.push({
        civilopediaKey: newRef,
        sourceIconIndex,
        targetIconIndex: result.index,
        appendedRow: result.appendedRow
      });
    } catch (err) {
      return { ok: false, error: `Could not append resources.pcx icon for ${newRef}: ${err.message}` };
    }
  }

  return {
    ok: true,
    changed: assignments.length > 0,
    buffer: workingBuffer,
    assignments
  };
}

function applyImportedUnitIconAtlasAssignments({ unitsTab, targetAtlasBuffer, loadSourceAtlasBuffer }) {
  if (!unitsTab || !Array.isArray(unitsTab.recordOps) || !Array.isArray(unitsTab.entries)) {
    return { ok: true, changed: false, buffer: targetAtlasBuffer, assignments: [] };
  }
  const importOps = getActiveImportedAtlasOps(unitsTab);
  if (importOps.length === 0) {
    return { ok: true, changed: false, buffer: targetAtlasBuffer, assignments: [] };
  }
  if (!Buffer.isBuffer(targetAtlasBuffer)) {
    return { ok: false, error: 'Could not load target units_32.pcx for imported unit icons.' };
  }
  let workingBuffer = targetAtlasBuffer;
  const assignments = [];
  const sourceBufferCache = new Map();
  let nextTargetIndex = getNextUnitAtlasAssignmentSlot(workingBuffer, unitsTab, importOps).index;

  for (const importItem of importOps) {
    const op = importItem.op;
    const newRef = importItem.newRef;
    const sourceBiqPath = String(op && op.importArtFrom || '').trim();
    if (!newRef || !sourceBiqPath) continue;
    const entry = importItem.entry;
    if (!entry) {
      return { ok: false, error: `Could not find imported unit entry ${newRef} for units_32.pcx update.` };
    }
    const iconField = getBiqFieldByBaseKey(entry, 'iconindex');
    if (!iconField) {
      return { ok: false, error: `Imported unit ${newRef} has no units_32 icon index field.` };
    }
    const pendingIcon = entry && entry._pendingImportedUnitIcon && typeof entry._pendingImportedUnitIcon === 'object'
      ? entry._pendingImportedUnitIcon
      : null;
    const pendingSourceIndex = Number.parseInt(String(pendingIcon && pendingIcon.sourceIconIndex), 10);
    const sourceIconIndex = Number.isFinite(pendingSourceIndex) && pendingSourceIndex >= 0
      ? pendingSourceIndex
      : Number.parseInt(String(iconField.value == null ? iconField.originalValue : iconField.value), 10);
    if (!Number.isFinite(sourceIconIndex) || sourceIconIndex < 0) {
      return { ok: false, error: `Imported unit ${newRef} has invalid source units_32 icon index.` };
    }
    if (!sourceBufferCache.has(sourceBiqPath)) {
      let sourceBuffer = null;
      try {
        sourceBuffer = typeof loadSourceAtlasBuffer === 'function' ? loadSourceAtlasBuffer(sourceBiqPath) : null;
      } catch (_err) {
        sourceBuffer = null;
      }
      if (!Buffer.isBuffer(sourceBuffer)) {
        return { ok: false, error: `Could not load source units_32.pcx for imported unit ${newRef}.` };
      }
      sourceBufferCache.set(sourceBiqPath, sourceBuffer);
    }
    try {
      const result = appendUnitIconToUnits32Pcx({
        targetBuffer: workingBuffer,
        sourceBuffer: sourceBufferCache.get(sourceBiqPath),
        sourceIconIndex,
        targetIconIndex: nextTargetIndex
      });
      workingBuffer = result.buffer;
      iconField.value = String(result.index);
      nextTargetIndex = result.index + 1;
      assignments.push({
        civilopediaKey: newRef,
        sourceIconIndex,
        targetIconIndex: result.index,
        appendedRow: result.appendedRow
      });
    } catch (err) {
      return { ok: false, error: `Could not append units_32.pcx icon for ${newRef}: ${err.message}` };
    }
  }

  return {
    ok: true,
    changed: assignments.length > 0,
    buffer: workingBuffer,
    assignments
  };
}

function normalizeBuildingCityIconKind(value) {
  const kind = String(value || '').trim().toUpperCase();
  if (kind === 'ERA' || kind === 'CULTURE' || kind === 'SINGLE') return kind;
  return 'SINGLE';
}

function getBuildingCityIconColumnCount(kind) {
  const normalized = normalizeBuildingCityIconKind(kind);
  if (normalized === 'ERA') return 4;
  if (normalized === 'CULTURE') return 5;
  return 1;
}

function getIndexedBuildingCityAtlas(buffer, size, label = 'buildings.pcx') {
  const atlasSize = String(size || '').trim().toLowerCase() === 'small' ? 'small' : 'large';
  const geometry = BUILDING_CITY_ATLAS_GEOMETRY[atlasSize];
  const decoded = decodePcx(buffer, { returnIndexed: true, transparentIndexes: [] });
  if (!decoded || !decoded.indices || !decoded.palette) {
    throw new Error(`${label} must be an indexed 256-color PCX file.`);
  }
  if (decoded.width < BUILDING_CITY_ATLAS_ORIGIN + geometry.cellW) {
    throw new Error(`${label} is too narrow for a Civ3 city building atlas.`);
  }
  if (decoded.height < BUILDING_CITY_ATLAS_ORIGIN + geometry.cellH) {
    throw new Error(`${label} does not contain any full city building icon rows.`);
  }
  const cols = Math.floor((decoded.width - BUILDING_CITY_ATLAS_ORIGIN) / geometry.cellW);
  const rows = Math.floor((decoded.height - BUILDING_CITY_ATLAS_ORIGIN) / geometry.cellH);
  if (cols < 1 || rows < 1) {
    throw new Error(`${label} does not contain any full city building icon cells.`);
  }
  const magentaIndex = findPaletteColorIndex(decoded.palette, BUILDING_CITY_ATLAS_MAGENTA, 255);
  if (magentaIndex < 0) {
    throw new Error(`${label} palette does not contain Civ3 magenta (#ff00ff).`);
  }
  const guideIndex = findPaletteColorIndex(decoded.palette, BUILDING_CITY_ATLAS_GUIDE, 254);
  if (guideIndex < 0) {
    throw new Error(`${label} palette does not contain Civ3 city-building guide green (#00ff00).`);
  }
  return { ...decoded, size: atlasSize, ...geometry, cols, rows, magentaIndex, guideIndex, origin: BUILDING_CITY_ATLAS_ORIGIN };
}

function isBuildingCityAtlasGuideOrBackground(atlas, index) {
  if (!atlas) return false;
  return index === atlas.magentaIndex
    || index === atlas.guideIndex
    || paletteColorMatches(atlas.palette, index, BUILDING_CITY_ATLAS_MAGENTA)
    || paletteColorMatches(atlas.palette, index, BUILDING_CITY_ATLAS_GUIDE);
}

function isBuildingCityAtlasRowEmpty(atlas, rowIndex) {
  const row = Number(rowIndex) | 0;
  if (!atlas || row < 0 || row >= atlas.rows) return false;
  const y0 = atlas.origin + row * atlas.cellH;
  for (let col = 0; col < atlas.cols; col += 1) {
    const x0 = atlas.origin + col * atlas.cellW;
    for (let y = 1; y < atlas.cellH; y += 1) {
      const rowOff = (y0 + y) * atlas.width + x0;
      for (let x = 1; x < atlas.cellW; x += 1) {
        if (!isBuildingCityAtlasGuideOrBackground(atlas, atlas.indices[rowOff + x])) {
          return false;
        }
      }
    }
  }
  return true;
}

function findNextBuildingCityAtlasRow(targetBuffer, size) {
  const atlas = getIndexedBuildingCityAtlas(targetBuffer, size, `target buildings-${size}.pcx`);
  let lastOccupied = -1;
  for (let row = 0; row < atlas.rows; row += 1) {
    if (!isBuildingCityAtlasRowEmpty(atlas, row)) lastOccupied = row;
  }
  return {
    index: lastOccupied + 1,
    lastOccupied,
    rows: atlas.rows,
    cols: atlas.cols
  };
}

function findNextBuildingCityAtlasPairRow(targetBuffers) {
  const large = findNextBuildingCityAtlasRow(targetBuffers && targetBuffers.large, 'large');
  const small = findNextBuildingCityAtlasRow(targetBuffers && targetBuffers.small, 'small');
  return {
    index: Math.max(large.index, small.index),
    lastOccupied: Math.max(large.lastOccupied, small.lastOccupied),
    large,
    small
  };
}

function getBuildingCityIconIndexAllocationFloor(improvementsTab, excludedRefs = new Set()) {
  let maxIndex = -1;
  (Array.isArray(improvementsTab && improvementsTab.entries) ? improvementsTab.entries : []).forEach((entry) => {
    const ref = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
    if (ref && excludedRefs.has(ref)) return;
    const idx = Number.parseInt(String(entry && entry.buildingIconIndex || ''), 10);
    if (Number.isFinite(idx) && idx >= 0) maxIndex = Math.max(maxIndex, idx);
  });
  return maxIndex + 1;
}

function getNextBuildingCityAtlasAssignmentRow(targetBuffers, improvementsTab, activeImports = null) {
  const scan = findNextBuildingCityAtlasPairRow(targetBuffers);
  const imports = Array.isArray(activeImports) ? activeImports : getActiveImportedAtlasOps(improvementsTab);
  const excludedRefs = new Set(imports.map((item) => String(item && item.newRef || '').trim().toUpperCase()).filter(Boolean));
  const referenceFloor = getBuildingCityIconIndexAllocationFloor(improvementsTab, excludedRefs);
  return {
    ...scan,
    index: Math.max(scan.index, referenceFloor),
    scanIndex: scan.index,
    referenceFloor
  };
}

function drawBuildingCityAtlasGuideLines(indices, atlas, newHeight) {
  const maxX = Math.min(atlas.width - 1, atlas.origin + atlas.cols * atlas.cellW);
  for (let row = 0; row <= Math.floor((newHeight - atlas.origin - 1) / atlas.cellH); row += 1) {
    const y = atlas.origin + row * atlas.cellH;
    if (y < 0 || y >= newHeight) continue;
    const rowOff = y * atlas.width;
    for (let x = atlas.origin; x <= maxX; x += 1) {
      indices[rowOff + x] = atlas.guideIndex;
    }
  }
  for (let col = 0; col <= atlas.cols; col += 1) {
    const x = atlas.origin + col * atlas.cellW;
    if (x < 0 || x >= atlas.width) continue;
    for (let y = atlas.origin; y < newHeight; y += 1) {
      indices[y * atlas.width + x] = atlas.guideIndex;
    }
  }
}

function appendBuildingCityIconRowToAtlas({ targetBuffer, sourceBuffer, sourceIconIndex, targetIconIndex = null, size = 'large', kind = 'SINGLE' }) {
  const atlasSize = String(size || '').trim().toLowerCase() === 'small' ? 'small' : 'large';
  const sourceIndex = Number.parseInt(String(sourceIconIndex == null ? '' : sourceIconIndex), 10);
  if (!Number.isFinite(sourceIndex) || sourceIndex < 0) {
    throw new Error(`Invalid source city building icon index: ${sourceIconIndex}`);
  }
  const explicitTargetIndex = Number.parseInt(String(targetIconIndex == null ? '' : targetIconIndex), 10);
  const target = getIndexedBuildingCityAtlas(targetBuffer, atlasSize, `target buildings-${atlasSize}.pcx`);
  const source = getIndexedBuildingCityAtlas(sourceBuffer, atlasSize, `source buildings-${atlasSize}.pcx`);
  if (sourceIndex >= source.rows) {
    throw new Error(`Source city building icon index ${sourceIndex} is outside source buildings-${atlasSize}.pcx.`);
  }
  const columnCount = Math.min(getBuildingCityIconColumnCount(kind), source.cols, target.cols);
  if (columnCount < 1) {
    throw new Error(`Could not determine city building icon columns for ${kind}.`);
  }

  const slot = findNextBuildingCityAtlasRow(targetBuffer, atlasSize);
  const targetIndex = Number.isFinite(explicitTargetIndex) && explicitTargetIndex >= 0
    ? explicitTargetIndex
    : slot.index;
  const requiredHeight = target.origin + (targetIndex + 1) * target.cellH + 1;
  const newHeight = Math.max(target.height, requiredHeight);
  const nextIndices = new Uint8Array(target.width * newHeight);
  nextIndices.fill(target.magentaIndex);
  for (let y = 0; y < target.height; y += 1) {
    nextIndices.set(
      target.indices.subarray(y * target.width, (y + 1) * target.width),
      y * target.width
    );
  }
  drawBuildingCityAtlasGuideLines(nextIndices, target, newHeight);

  const targetRowY = target.origin + targetIndex * target.cellH;
  for (let col = 0; col < target.cols; col += 1) {
    const targetColX = target.origin + col * target.cellW;
    for (let y = 1; y < target.cellH; y += 1) {
      const rowOff = (targetRowY + y) * target.width + targetColX;
      for (let x = 1; x < target.cellW; x += 1) {
        nextIndices[rowOff + x] = target.magentaIndex;
      }
    }
  }

  const remap = makePaletteRemap(source.palette, target.palette, target.magentaIndex);
  const sourceRowY = source.origin + sourceIndex * source.cellH;
  for (let col = 0; col < columnCount; col += 1) {
    const sourceColX = source.origin + col * source.cellW;
    const targetColX = target.origin + col * target.cellW;
    for (let y = 1; y <= target.drawH; y += 1) {
      const sourceRow = (sourceRowY + y) * source.width + sourceColX;
      const targetRow = (targetRowY + y) * target.width + targetColX;
      for (let x = 1; x <= target.drawW; x += 1) {
        nextIndices[targetRow + x] = remap[source.indices[sourceRow + x]];
      }
    }
  }

  return {
    buffer: encodePcx(nextIndices, target.palette, target.width, newHeight),
    index: targetIndex,
    lastOccupied: slot.lastOccupied,
    scanIndex: slot.index,
    oldRows: target.rows,
    newRows: Math.floor((newHeight - target.origin) / target.cellH),
    appendedRow: newHeight > target.height,
    columnCount
  };
}

function appendBuildingCityIconRowToAtlases({ targetBuffers, sourceBuffers, sourceIconIndex, targetIconIndex = null, kind = 'SINGLE' }) {
  const large = appendBuildingCityIconRowToAtlas({
    targetBuffer: targetBuffers && targetBuffers.large,
    sourceBuffer: sourceBuffers && sourceBuffers.large,
    sourceIconIndex,
    targetIconIndex,
    size: 'large',
    kind
  });
  const small = appendBuildingCityIconRowToAtlas({
    targetBuffer: targetBuffers && targetBuffers.small,
    sourceBuffer: sourceBuffers && sourceBuffers.small,
    sourceIconIndex,
    targetIconIndex: large.index,
    size: 'small',
    kind
  });
  return {
    buffers: { large: large.buffer, small: small.buffer },
    index: large.index,
    large,
    small,
    appendedRow: large.appendedRow || small.appendedRow
  };
}

function applyImportedBuildingCityIconAtlasAssignments({ improvementsTab, targetAtlasBuffers, loadSourceAtlasBuffers }) {
  if (!improvementsTab || !Array.isArray(improvementsTab.recordOps) || !Array.isArray(improvementsTab.entries)) {
    return { ok: true, changed: false, buffers: targetAtlasBuffers, assignments: [] };
  }
  const importOps = getActiveImportedAtlasOps(improvementsTab);
  if (importOps.length === 0) {
    return { ok: true, changed: false, buffers: targetAtlasBuffers, assignments: [] };
  }
  if (!Buffer.isBuffer(targetAtlasBuffers && targetAtlasBuffers.large) || !Buffer.isBuffer(targetAtlasBuffers && targetAtlasBuffers.small)) {
    return { ok: false, error: 'Could not load target city building PCX files for imported improvement icons.' };
  }
  let workingBuffers = { large: targetAtlasBuffers.large, small: targetAtlasBuffers.small };
  const assignments = [];
  const sourceBufferCache = new Map();
  let nextTargetIndex = getNextBuildingCityAtlasAssignmentRow(workingBuffers, improvementsTab, importOps).index;

  for (const importItem of importOps) {
    const op = importItem.op;
    const newRef = importItem.newRef;
    const sourceBiqPath = String(op && op.importArtFrom || '').trim();
    if (!newRef || !sourceBiqPath) continue;
    const entry = importItem.entry;
    if (!entry) {
      return { ok: false, error: `Could not find imported improvement entry ${newRef} for city building atlas update.` };
    }
    const pendingIcon = entry && entry._pendingImportedBuildingCityIcon && typeof entry._pendingImportedBuildingCityIcon === 'object'
      ? entry._pendingImportedBuildingCityIcon
      : null;
    const pendingSourceIndex = Number.parseInt(String(pendingIcon && pendingIcon.sourceIconIndex), 10);
    const sourceIconIndex = Number.isFinite(pendingSourceIndex) && pendingSourceIndex >= 0
      ? pendingSourceIndex
      : Number.parseInt(String(entry.buildingIconIndex || ''), 10);
    if (!Number.isFinite(sourceIconIndex) || sourceIconIndex < 0) {
      return { ok: false, error: `Imported improvement ${newRef} has invalid source city building icon index.` };
    }
    const kind = normalizeBuildingCityIconKind((pendingIcon && pendingIcon.kind) || entry.buildingIconKind);
    if (!sourceBufferCache.has(sourceBiqPath)) {
      let sourceBuffers = null;
      try {
        sourceBuffers = typeof loadSourceAtlasBuffers === 'function' ? loadSourceAtlasBuffers(sourceBiqPath) : null;
      } catch (_err) {
        sourceBuffers = null;
      }
      if (!sourceBuffers || !Buffer.isBuffer(sourceBuffers.large) || !Buffer.isBuffer(sourceBuffers.small)) {
        return { ok: false, error: `Could not load source city building PCX files for imported improvement ${newRef}.` };
      }
      sourceBufferCache.set(sourceBiqPath, sourceBuffers);
    }
    try {
      const result = appendBuildingCityIconRowToAtlases({
        targetBuffers: workingBuffers,
        sourceBuffers: sourceBufferCache.get(sourceBiqPath),
        sourceIconIndex,
        targetIconIndex: nextTargetIndex,
        kind
      });
      workingBuffers = result.buffers;
      entry.buildingIconIndex = String(result.index);
      nextTargetIndex = result.index + 1;
      assignments.push({
        civilopediaKey: newRef,
        kind,
        sourceIconIndex,
        targetIconIndex: result.index,
        appendedRow: result.appendedRow
      });
    } catch (err) {
      return { ok: false, error: `Could not append city building icon for ${newRef}: ${err.message}` };
    }
  }

  return {
    ok: true,
    changed: assignments.length > 0,
    buffers: workingBuffers,
    assignments
  };
}

function resolveResourcesAtlasPath({ civ3Path, targetContentRoot, scenarioRoots }) {
  const rel = RESOURCE_ATLAS_RELATIVE_PATH;
  const candidates = [];
  const add = (candidate) => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (candidates.some((entry) => normalizePathForCompare(entry) === normalizePathForCompare(resolved))) return;
    candidates.push(resolved);
  };
  add(targetContentRoot ? path.join(targetContentRoot, rel) : '');
  (Array.isArray(scenarioRoots) ? scenarioRoots : []).forEach((root) => add(path.join(root, rel)));
  const civ3Root = resolveCiv3RootPath(civ3Path);
  if (civ3Root) {
    add(path.join(civ3Root, 'Conquests', rel));
    add(path.join(civ3Root, 'civ3PTW', rel));
    add(path.join(civ3Root, rel));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (_err) {
      // skip unreadable candidates
    }
  }
  return '';
}

function resolveUnits32AtlasPath({ civ3Path, targetContentRoot, scenarioRoots }) {
  const rel = UNIT_ATLAS_RELATIVE_PATH;
  const candidates = [];
  const add = (candidate) => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (candidates.some((entry) => normalizePathForCompare(entry) === normalizePathForCompare(resolved))) return;
    candidates.push(resolved);
  };
  add(targetContentRoot ? path.join(targetContentRoot, ...rel.split('/')) : '');
  (Array.isArray(scenarioRoots) ? scenarioRoots : []).forEach((root) => add(path.join(root, ...rel.split('/'))));
  const civ3Root = resolveCiv3RootPath(civ3Path);
  if (civ3Root) {
    add(path.join(civ3Root, 'Conquests', ...rel.split('/')));
    add(path.join(civ3Root, 'civ3PTW', ...rel.split('/')));
    add(path.join(civ3Root, ...rel.split('/')));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (_err) {
      // skip unreadable candidates
    }
  }
  return '';
}

function resolveBuildingCityAtlasPath({ civ3Path, targetContentRoot, scenarioRoots, size }) {
  const atlasSize = String(size || '').trim().toLowerCase() === 'small' ? 'small' : 'large';
  const rel = BUILDING_CITY_ATLAS_RELATIVE_PATHS[atlasSize];
  const candidates = [];
  const add = (candidate) => {
    if (!candidate) return;
    const resolved = path.resolve(candidate);
    if (candidates.some((entry) => normalizePathForCompare(entry) === normalizePathForCompare(resolved))) return;
    candidates.push(resolved);
  };
  add(targetContentRoot ? path.join(targetContentRoot, ...rel.split('/')) : '');
  (Array.isArray(scenarioRoots) ? scenarioRoots : []).forEach((root) => add(path.join(root, ...rel.split('/'))));
  const civ3Root = resolveCiv3RootPath(civ3Path);
  if (civ3Root) {
    add(path.join(civ3Root, 'Conquests', ...rel.split('/')));
    add(path.join(civ3Root, 'civ3PTW', ...rel.split('/')));
    add(path.join(civ3Root, ...rel.split('/')));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (_err) {
      // skip unreadable candidates
    }
  }
  return '';
}

function resolveBuildingCityAtlasPaths({ civ3Path, targetContentRoot, scenarioRoots }) {
  return {
    large: resolveBuildingCityAtlasPath({ civ3Path, targetContentRoot, scenarioRoots, size: 'large' }),
    small: resolveBuildingCityAtlasPath({ civ3Path, targetContentRoot, scenarioRoots, size: 'small' })
  };
}

function prepareImportedResourceIconAtlasWrite({ tabs, targetContentRoot, scenarioRoots, civ3Path }) {
  const resourceTab = tabs && tabs.resources;
  if (!resourceTab || !Array.isArray(resourceTab.recordOps)) return { ok: true, changed: false };
  const activeResourceImports = getActiveImportedAtlasOps(resourceTab);
  if (activeResourceImports.length === 0) return { ok: true, changed: false };

  const targetRoot = String(targetContentRoot || '').trim();
  if (!targetRoot) return { ok: false, error: 'Could not determine target scenario folder for resources.pcx.' };
  const targetPath = path.join(targetRoot, ...RESOURCE_ATLAS_RELATIVE_PATH.split('/'));
  let targetSourcePath = '';
  const pending = resourceTab.pendingAtlasCopies && typeof resourceTab.pendingAtlasCopies === 'object'
    ? resourceTab.pendingAtlasCopies.resources
    : null;
  if (pending && pending.staged && isAbsoluteFilesystemPath(pending.sourcePath)) {
    targetSourcePath = String(pending.sourcePath || '').trim();
  } else {
    targetSourcePath = resolveResourcesAtlasPath({
      civ3Path,
      targetContentRoot: targetRoot,
      scenarioRoots
    });
  }
  if (!targetSourcePath) {
    return { ok: false, error: 'Could not find a target resources.pcx to copy before importing resource icons.' };
  }

  let targetAtlasBuffer;
  try {
    targetAtlasBuffer = fs.readFileSync(targetSourcePath);
  } catch (err) {
    return { ok: false, error: `Could not read target resources.pcx: ${targetSourcePath} (${err.message})` };
  }

  const sourceRootsCache = new Map();
  const getSourceRoots = (sourceBiqPath) => {
    const cacheKey = String(sourceBiqPath || '').trim();
    if (sourceRootsCache.has(cacheKey)) return sourceRootsCache.get(cacheKey);
    let roots = [];
    try {
      const sourceBiqTab = loadBiqTab({ mode: 'scenario', civ3Path, scenarioPath: sourceBiqPath });
      const ctx = deriveScenarioPathContext({ scenarioPath: sourceBiqPath, civ3Path, biqTab: sourceBiqTab });
      roots = dedupePathList([ctx.biqRoot, ...ctx.searchRoots]);
    } catch (_err) {
      roots = dedupePathList([resolveScenarioDir(sourceBiqPath)]);
    }
    sourceRootsCache.set(cacheKey, roots);
    return roots;
  };

  const update = applyImportedResourceIconAtlasAssignments({
    resourceTab,
    targetAtlasBuffer,
    loadSourceAtlasBuffer: (sourceBiqPath) => {
      const sourcePath = resolveResourcesAtlasPath({
        civ3Path,
        targetContentRoot: '',
        scenarioRoots: getSourceRoots(sourceBiqPath)
      });
      return sourcePath ? fs.readFileSync(sourcePath) : null;
    }
  });
  if (!update.ok) return update;
  if (!update.changed) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    path: targetPath,
    sourcePath: targetSourcePath,
    data: update.buffer,
    assignments: update.assignments
  };
}

function prepareImportedUnitIconAtlasWrite({ tabs, targetContentRoot, scenarioRoots, civ3Path }) {
  const unitsTab = tabs && tabs.units;
  if (!unitsTab || !Array.isArray(unitsTab.recordOps)) return { ok: true, changed: false };
  const activeUnitImports = getActiveImportedAtlasOps(unitsTab);
  if (activeUnitImports.length === 0) return { ok: true, changed: false };

  const targetRoot = String(targetContentRoot || '').trim();
  if (!targetRoot) return { ok: false, error: 'Could not determine target scenario folder for units_32.pcx.' };
  const targetPath = path.join(targetRoot, ...UNIT_ATLAS_RELATIVE_PATH.split('/'));
  let targetSourcePath = '';
  const pending = unitsTab.pendingAtlasCopies && typeof unitsTab.pendingAtlasCopies === 'object'
    ? unitsTab.pendingAtlasCopies.units32
    : null;
  if (pending && pending.staged && isAbsoluteFilesystemPath(pending.sourcePath)) {
    targetSourcePath = String(pending.sourcePath || '').trim();
  } else {
    targetSourcePath = resolveUnits32AtlasPath({
      civ3Path,
      targetContentRoot: targetRoot,
      scenarioRoots
    });
  }
  if (!targetSourcePath) {
    return { ok: false, error: 'Could not find a target units_32.pcx to copy before importing unit icons.' };
  }

  let targetAtlasBuffer;
  try {
    targetAtlasBuffer = fs.readFileSync(targetSourcePath);
  } catch (err) {
    return { ok: false, error: `Could not read target units_32.pcx: ${targetSourcePath} (${err.message})` };
  }

  const sourceRootsCache = new Map();
  const getSourceRoots = (sourceBiqPath) => {
    const cacheKey = String(sourceBiqPath || '').trim();
    if (sourceRootsCache.has(cacheKey)) return sourceRootsCache.get(cacheKey);
    let roots = [];
    try {
      const sourceBiqTab = loadBiqTab({ mode: 'scenario', civ3Path, scenarioPath: sourceBiqPath });
      const ctx = deriveScenarioPathContext({ scenarioPath: sourceBiqPath, civ3Path, biqTab: sourceBiqTab });
      roots = dedupePathList([ctx.biqRoot, ...ctx.searchRoots]);
    } catch (_err) {
      roots = dedupePathList([resolveScenarioDir(sourceBiqPath)]);
    }
    sourceRootsCache.set(cacheKey, roots);
    return roots;
  };

  const update = applyImportedUnitIconAtlasAssignments({
    unitsTab,
    targetAtlasBuffer,
    loadSourceAtlasBuffer: (sourceBiqPath) => {
      const sourcePath = resolveUnits32AtlasPath({
        civ3Path,
        targetContentRoot: '',
        scenarioRoots: getSourceRoots(sourceBiqPath)
      });
      return sourcePath ? fs.readFileSync(sourcePath) : null;
    }
  });
  if (!update.ok) return update;
  if (!update.changed) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    path: targetPath,
    sourcePath: targetSourcePath,
    data: update.buffer,
    assignments: update.assignments
  };
}

function prepareImportedBuildingCityIconAtlasWrite({ tabs, targetContentRoot, scenarioRoots, civ3Path }) {
  const improvementsTab = tabs && tabs.improvements;
  if (!improvementsTab || !Array.isArray(improvementsTab.recordOps)) return { ok: true, changed: false };
  const activeImprovementImports = getActiveImportedAtlasOps(improvementsTab);
  if (activeImprovementImports.length === 0) return { ok: true, changed: false };

  const targetRoot = String(targetContentRoot || '').trim();
  if (!targetRoot) return { ok: false, error: 'Could not determine target scenario folder for city building PCX files.' };
  const targetPaths = {
    large: path.join(targetRoot, ...BUILDING_CITY_ATLAS_RELATIVE_PATHS.large.split('/')),
    small: path.join(targetRoot, ...BUILDING_CITY_ATLAS_RELATIVE_PATHS.small.split('/'))
  };
  const pending = improvementsTab.pendingAtlasCopies && typeof improvementsTab.pendingAtlasCopies === 'object'
    ? improvementsTab.pendingAtlasCopies
    : {};
  const targetSourcePaths = {};
  ['large', 'small'].forEach((size) => {
    const atlasKey = size === 'large' ? 'buildingCityLarge' : 'buildingCitySmall';
    const staged = pending && pending[atlasKey];
    if (staged && staged.staged && isAbsoluteFilesystemPath(staged.sourcePath)) {
      targetSourcePaths[size] = String(staged.sourcePath || '').trim();
    }
  });
  const resolvedTargetSourcePaths = resolveBuildingCityAtlasPaths({
    civ3Path,
    targetContentRoot: targetRoot,
    scenarioRoots
  });
  if (!targetSourcePaths.large) targetSourcePaths.large = resolvedTargetSourcePaths.large;
  if (!targetSourcePaths.small) targetSourcePaths.small = resolvedTargetSourcePaths.small;
  if (!targetSourcePaths.large || !targetSourcePaths.small) {
    return { ok: false, error: 'Could not find target city building PCX files to copy before importing improvement city icons.' };
  }

  let targetAtlasBuffers;
  try {
    targetAtlasBuffers = {
      large: fs.readFileSync(targetSourcePaths.large),
      small: fs.readFileSync(targetSourcePaths.small)
    };
  } catch (err) {
    return { ok: false, error: `Could not read target city building PCX files: ${err.message}` };
  }

  const sourceRootsCache = new Map();
  const getSourceRoots = (sourceBiqPath) => {
    const cacheKey = String(sourceBiqPath || '').trim();
    if (sourceRootsCache.has(cacheKey)) return sourceRootsCache.get(cacheKey);
    let roots = [];
    try {
      const sourceBiqTab = loadBiqTab({ mode: 'scenario', civ3Path, scenarioPath: sourceBiqPath });
      const ctx = deriveScenarioPathContext({ scenarioPath: sourceBiqPath, civ3Path, biqTab: sourceBiqTab });
      roots = dedupePathList([ctx.biqRoot, ...ctx.searchRoots]);
    } catch (_err) {
      roots = dedupePathList([resolveScenarioDir(sourceBiqPath)]);
    }
    sourceRootsCache.set(cacheKey, roots);
    return roots;
  };

  const update = applyImportedBuildingCityIconAtlasAssignments({
    improvementsTab,
    targetAtlasBuffers,
    loadSourceAtlasBuffers: (sourceBiqPath) => {
      const sourcePaths = resolveBuildingCityAtlasPaths({
        civ3Path,
        targetContentRoot: '',
        scenarioRoots: getSourceRoots(sourceBiqPath)
      });
      return sourcePaths.large && sourcePaths.small
        ? { large: fs.readFileSync(sourcePaths.large), small: fs.readFileSync(sourcePaths.small) }
        : null;
    }
  });
  if (!update.ok) return update;
  if (!update.changed) return { ok: true, changed: false };
  return {
    ok: true,
    changed: true,
    paths: targetPaths,
    sourcePaths: targetSourcePaths,
    data: update.buffers,
    assignments: update.assignments
  };
}

// Imported units always start at icon index 0. The target scenario's units_32.pcx
// is never rewritten automatically because atlas layout is mod-specific.
function spliceImportedUnitIconsIntoAtlas({ tabs }) {
  const unitsTab = tabs && tabs.units;
  if (!unitsTab || !Array.isArray(unitsTab.recordOps) || !Array.isArray(unitsTab.entries)) return;

  const importOps = unitsTab.recordOps.filter(
    (op) => String(op && op.op || '').toLowerCase() === 'add' &&
             String(op && op.importArtFrom || '').trim()
  );
  if (importOps.length === 0) return;

  for (const op of importOps) {
    const newRef = String(op.newRecordRef || '').trim().toUpperCase();
    if (!newRef) continue;

    const entry = unitsTab.entries.find(
      (e) => String(e && e.civilopediaKey || '').toUpperCase() === newRef
    );
    if (!entry || !Array.isArray(entry.biqFields)) continue;

    const iconField = entry.biqFields.find(
      (f) => String(f && (f.baseKey || f.key) || '').toLowerCase() === 'iconindex'
    );
    if (!iconField) continue;
    iconField.value = '0';
  }
}

// For each import op (op:'add' with importArtFrom), collect { sourcePath, targetPath }
// pairs for all art files that should be copied into the target content root.
function collectImportArtCopies({ tabs, targetContentRoot, civ3Path }) {
  if (!targetContentRoot) return [];
  const copies = [];
  // Cache source search roots per source BIQ path to avoid repeated BIQ loads.
  const sourceRootsCache = new Map();

  const getSourceRoots = (sourceBiqPath) => {
    if (sourceRootsCache.has(sourceBiqPath)) return sourceRootsCache.get(sourceBiqPath);
    let roots = [];
    try {
      const sourceBiqTab = loadBiqTab({ mode: 'scenario', civ3Path, scenarioPath: sourceBiqPath });
      const ctx = deriveScenarioPathContext({ scenarioPath: sourceBiqPath, civ3Path, biqTab: sourceBiqTab });
      // Prefer: source scenario dir → its search roots → civ3 base.
      roots = dedupePathList([ctx.biqRoot, ...ctx.searchRoots, civ3Path].filter(Boolean));
    } catch (_err) {
      roots = [];
    }
    sourceRootsCache.set(sourceBiqPath, roots);
    return roots;
  };

  const addFileCopy = (sourcePath, relPath) => {
    if (!sourcePath) return;
    const targetPath = path.join(targetContentRoot, normalizeRelativePath(relPath));
    copies.push({ sourcePath, targetPath });
  };

  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.recordOps)) continue;

    const importOps = getActiveImportedAtlasOps(tab);
    if (importOps.length === 0) continue;

    const sectionCode = getSectionCodeForReferenceTabKey(spec.key);

    for (const importItem of importOps) {
      const op = importItem.op;
      const newRef = importItem.newRef;
      const sourceBiqPath = String(op && op.importArtFrom || '').trim();
      if (!newRef || !sourceBiqPath) continue;
      let sourceExists = false;
      try { sourceExists = fs.existsSync(sourceBiqPath) && fs.statSync(sourceBiqPath).isFile(); } catch (_e) { /* skip */ }
      if (!sourceExists) continue;

      const entry = importItem.entry;
      if (!entry) continue;

      const sourceRoots = getSourceRoots(sourceBiqPath);

      // Copy icon PCX files (used by tech, resource, improvement, government, etc.)
      for (const relPath of (Array.isArray(entry.iconPaths) ? entry.iconPaths : [])) {
        if (!relPath) continue;
        addFileCopy(resolveArtFileFromRoots(relPath, sourceRoots), relPath);
      }
      if (sectionCode === 'BLDG' && entry.wonderSplashPath) {
        addFileCopy(resolveArtFileFromRoots(entry.wonderSplashPath, sourceRoots), entry.wonderSplashPath);
      }

      // Copy race/civ PCX icon files
      for (const relPath of (Array.isArray(entry.racePaths) ? entry.racePaths : [])) {
        if (!relPath) continue;
        addFileCopy(resolveArtFileFromRoots(relPath, sourceRoots), relPath);
      }

      // Copy unit animation folder (entire directory, all files)
      if (sectionCode === 'PRTO' && entry.animationName) {
        const animFolderRel = path.join('Art', 'Units', entry.animationName);
        for (const root of sourceRoots) {
          const srcDir = path.join(root, animFolderRel);
          let isDir = false;
          try { isDir = fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory(); } catch (_e) { /* skip */ }
          if (isDir) {
            for (const absFile of listFilesRecursive(srcDir)) {
              const relFile = path.relative(root, absFile);
              addFileCopy(absFile, relFile);
            }
            break;
          }
        }
      }

      // Copy FLC files embedded in RACE BIQ fields (forward/reverse era filenames)
      if (sectionCode === 'RACE' && Array.isArray(entry.biqFields)) {
        for (const field of entry.biqFields) {
          const key = String(field && (field.baseKey || field.key) || '').toLowerCase();
          if (/^(forward|reverse)filename_for_era_\d+$/.test(key)) {
            const relPath = String(field && field.value || '').trim();
            if (relPath) addFileCopy(resolveArtFileFromRoots(relPath, sourceRoots), relPath);
          }
        }
      }
    }
  }

  return copies;
}

function collectScenarioAtlasCopies({ tabs, targetContentRoot }) {
  const root = String(targetContentRoot || '').trim();
  if (!tabs || !root) return [];
  const copySpecs = [];
  [
    { tabKey: 'resources', atlasKey: 'resources', relativePath: 'Art/resources.pcx' },
    { tabKey: 'units', atlasKey: 'units32', relativePath: 'Art/Units/units_32.pcx' },
    { tabKey: 'improvements', atlasKey: 'buildingCityLarge', relativePath: BUILDING_CITY_ATLAS_RELATIVE_PATHS.large },
    { tabKey: 'improvements', atlasKey: 'buildingCitySmall', relativePath: BUILDING_CITY_ATLAS_RELATIVE_PATHS.small }
  ].forEach((spec) => {
    const tab = tabs[spec.tabKey];
    const pending = tab && tab.pendingAtlasCopies && typeof tab.pendingAtlasCopies === 'object'
      ? tab.pendingAtlasCopies
      : null;
    const copy = pending && pending[spec.atlasKey];
    if (!copy || !copy.staged) return;
    const sourcePath = String(copy.sourcePath || '').trim();
    if (!sourcePath || !isAbsoluteFilesystemPath(sourcePath)) return;
    const relativePath = normalizeAssetReferencePath(copy.relativePath || spec.relativePath);
    if (!relativePath || isAbsoluteFilesystemPath(relativePath)) return;
    copySpecs.push({
      kind: 'atlas',
      sourcePath,
      targetPath: path.join(root, ...relativePath.split('/').filter(Boolean))
    });
  });
  return copySpecs;
}

function buildSavePlan(payload) {
  const mode = payload.mode === 'scenario' ? 'scenario' : 'global';
  const c3xPath = payload.c3xPath || '';
  const civ3Path = payload.civ3Path || '';
  const scenarioPath = payload.scenarioPath || '';
  const textFileEncoding = normalizeTextFileEncoding(payload.textFileEncoding);
  const biqTab = loadBiqTab({ mode, civ3Path, scenarioPath, textEncoding: textFileEncoding });
  const inferredBiqTextEncoding = String(biqTab && biqTab.textEncoding || resolveAutoTextEncoding(textFileEncoding));
  const pendingSearchFolderOverride = mode === 'scenario'
    ? getPendingScenarioSearchFolderOverride(payload.tabs || {})
    : null;
  const scenarioContext = mode === 'scenario'
    ? deriveScenarioPathContext({
      scenarioPath,
      civ3Path,
      biqTab,
      searchFolderOverride: pendingSearchFolderOverride,
      includeMissingSearchRoots: true,
      ensureLocalSearchRoot: true
    })
    : {
      biqRoot: resolveScenarioDir(scenarioPath),
      searchRoots: [],
      writableRoots: [],
      contentWriteRoot: resolveScenarioDir(scenarioPath)
    };
  const scenarioDir = scenarioContext.biqRoot;

  const filePaths = resolvePaths({ c3xPath, scenarioPath: mode === 'scenario' ? scenarioContext.contentWriteRoot : scenarioContext.biqRoot, mode });
  if (mode === 'scenario' && scenarioContext.autoCreatedSearchRoot && !scenarioContext.autoCreatedSearchValue) {
    return { ok: false, error: 'Could not derive a valid scenario search folder path for this BIQ.' };
  }
  const failIfProtected = (candidatePath, label) => {
    if (!candidatePath) return null;
    if (mode === 'scenario') {
      if (!isPathWithinAnyRoot(candidatePath, scenarioContext.writableRoots)) {
        const rootsText = scenarioContext.writableRoots.length > 0
          ? scenarioContext.writableRoots.join(', ')
          : '(none)';
        return `Refusing to modify file outside scenario write roots (${label}): ${candidatePath}. Allowed roots: ${rootsText}`;
      }
    }
    if (isProtectedBaseCiv3Path(civ3Path, candidatePath)) {
      return `Refusing to modify base Civilization III file (${label}): ${candidatePath}`;
    }
    if (isProtectedC3xDefaultPath(c3xPath, candidatePath)) {
      return `Refusing to modify protected C3X default file (${label}): ${candidatePath}`;
    }
    return null;
  };

  const saveReport = [];
  const plannedWrites = [];
  let importedResourceAtlasWrite = null;
  let importedUnitAtlasWrite = null;
  let importedBuildingCityAtlasWrite = null;
  const dirtyTabs = new Set(
    Array.isArray(payload && payload.dirtyTabs)
      ? payload.dirtyTabs.map((tabKey) => String(tabKey || ''))
      : []
  );
  const unitValidationError = validateUnitAnimationReferenceChanges({
    tabs: payload.tabs || {},
    mode,
    civ3Path,
    scenarioRoot: scenarioContext.biqRoot,
    scenarioSearchPaths: scenarioContext.searchRoots,
    scenarioContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
    importedKeys: new Set(
      ((((payload.tabs || {}).units || {}).recordOps) || [])
        .filter((op) => op && op.op === 'add' && op.importArtFrom)
        .map((op) => String(op.newRecordRef || ''))
    )
  });
  if (unitValidationError) return { ok: false, error: unitValidationError };

  const sectionTabsChangedByImprovementRenames = applyImprovementNameRenamesToSectionedTabs(payload.tabs || {});
  sectionTabsChangedByImprovementRenames.forEach((tabKey) => dirtyTabs.add(tabKey));

  const baseTab = payload.tabs.base;
  const shouldSaveBase = dirtyTabs.size === 0 || dirtyTabs.has('base');
  if (shouldSaveBase && baseTab && filePaths.base.targetPath) {
    const protectErr = failIfProtected(filePaths.base.targetPath, 'base config target');
    if (protectErr) return { ok: false, error: protectErr };
    const serialized = serializeBaseConfig(baseTab.rows, baseTab.defaultMap || {}, mode, baseTab.commentsByKey || {});
    plannedWrites.push({
      kind: 'base',
      path: filePaths.base.targetPath,
      data: serialized,
      encoding: 'utf8'
    });
    saveReport.push({ kind: 'base', path: filePaths.base.targetPath });
  }

  for (const kind of ['districts', 'wonders', 'naturalWonders', 'animations']) {
    const tab = payload.tabs[kind];
    const spec = FILE_SPECS[kind];
    const targetPath = filePaths[kind].targetPath;
    if (!tab || !targetPath) {
      continue;
    }
    const shouldSaveKind = dirtyTabs.size === 0 || dirtyTabs.has(kind);
    if (!shouldSaveKind) {
      continue;
    }
    const protectErr = failIfProtected(targetPath, `${kind} target`);
    if (protectErr) return { ok: false, error: protectErr };
    const targetExists = fs.existsSync(targetPath);
    const serialized = serializeSectionedConfig(tab.model, spec.sectionMarker, {
      kind,
      mode,
      includeComments: targetExists,
      includeManagedHeader: !targetExists
    });
    const sourceDetails = tab.sourceDetails || {};
    const resolvedEncoding = resolveScenarioTextWriteEncoding({
      targetPath,
      sourcePath: String(sourceDetails.effectivePath || ''),
      explicitEncoding: '',
      preferredEncoding: textFileEncoding,
      fallbackEncoding: 'windows-1252'
    });
    plannedWrites.push({
      kind,
      path: targetPath,
      data: encodeTextBuffer(serialized, resolvedEncoding.encoding, { bom: resolvedEncoding.bom }),
      encoding: resolvedEncoding.encoding,
      bom: resolvedEncoding.bom
    });
    saveReport.push({ kind, path: targetPath });
  }

  if (mode === 'scenario' && isBiqPath(scenarioPath)) {
    const protectErr = failIfProtected(scenarioPath, 'scenario BIQ target');
    if (protectErr) return { ok: false, error: protectErr };

    const nonBiqDirtyTabs = new Set(['base', 'districts', 'wonders', 'naturalWonders', 'animations']);
    const dirtyTabsAreOnlyNonBiq = dirtyTabs.size > 0
      && Array.from(dirtyTabs).every((tabKey) => nonBiqDirtyTabs.has(String(tabKey || '')));
    const hasPendingBiqOperations = hasPendingBiqOperationPayload(payload.tabs || {});
    const hasPendingBiqFieldEdits = dirtyTabsAreOnlyNonBiq && !hasPendingBiqOperations
      ? hasPendingBiqFieldEditPayload(payload.tabs || {})
      : false;
    const shouldCollectBiqEdits = !dirtyTabsAreOnlyNonBiq
      || hasPendingBiqOperations
      || hasPendingBiqFieldEdits
      || !!scenarioContext.autoCreatedSearchValue;
    if (!shouldCollectBiqEdits) {
      log.debug('BiqSave', `buildSavePlan: skipped BIQ edit collection for non-BIQ dirtyTabs=[${Array.from(dirtyTabs).join(', ')}]`);
    } else {
      if (payload.autoAddImportedUnitIcons === false) {
        // Disabled compatibility path: keep imported units on the first units_32 slot for manual reassignment.
        spliceImportedUnitIconsIntoAtlas({
          tabs: payload.tabs || {}
        });
      } else {
        importedUnitAtlasWrite = prepareImportedUnitIconAtlasWrite({
          tabs: payload.tabs || {},
          targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
          scenarioRoots: scenarioContext.searchRoots,
          civ3Path
        });
        if (importedUnitAtlasWrite && !importedUnitAtlasWrite.ok) {
          return { ok: false, error: importedUnitAtlasWrite.error || 'Failed to update units_32.pcx for imported unit icons.' };
        }
      }
      if (payload.autoAddImportedResourceIcons !== false) {
        importedResourceAtlasWrite = prepareImportedResourceIconAtlasWrite({
          tabs: payload.tabs || {},
          targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
          scenarioRoots: scenarioContext.searchRoots,
          civ3Path
        });
        if (importedResourceAtlasWrite && !importedResourceAtlasWrite.ok) {
          return { ok: false, error: importedResourceAtlasWrite.error || 'Failed to update resources.pcx for imported resource icons.' };
        }
      }
      if (payload.autoAddImportedBuildingCityIcons !== false) {
        importedBuildingCityAtlasWrite = prepareImportedBuildingCityIconAtlasWrite({
          tabs: payload.tabs || {},
          targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
          scenarioRoots: scenarioContext.searchRoots,
          civ3Path
        });
        if (importedBuildingCityAtlasWrite && !importedBuildingCityAtlasWrite.ok) {
          return { ok: false, error: importedBuildingCityAtlasWrite.error || 'Failed to update city building PCX files for imported improvement icons.' };
        }
      }

      const biqTabsForCollection = getTabsForDirtyBiqCollection(payload.tabs || {}, {
        dirtyTabs,
        includeAllFieldEdits: hasPendingBiqFieldEdits
      });
      normalizePendingReferenceTargetsForSave({
        tabs: biqTabsForCollection,
        indexTabs: payload.tabs || {},
        biqTab
      });
      const biqCustomRulesOps = collectBiqCustomRulesMutationOps({
        tabs: biqTabsForCollection,
        civ3Path,
        textEncoding: inferredBiqTextEncoding
      });
      const biqCustomPlayerDataOps = collectBiqCustomPlayerDataMutationOps({
        tabs: biqTabsForCollection
      });
      const biqRecordOps = resolveExternalImportedPrtoRecordOps(
        collectBiqReferenceRecordOps(biqTabsForCollection),
        civ3Path
      );
      const biqStructureRecordOps = collectBiqStructureRecordOps(biqTabsForCollection);
      const biqMapStructureOps = collectBiqMapStructureOps(biqTabsForCollection);
      const biqMapRecordOps = collectBiqMapRecordOps(biqTabsForCollection);
      const biqEdits = collectBiqReferenceEdits(biqTabsForCollection, { biqTab });
      const structureEdits = collectBiqStructureEdits(biqTabsForCollection);
      const mapEdits = collectBiqMapEdits(biqTabsForCollection);
      const autoSearchField = !pendingSearchFolderOverride || pendingSearchFolderOverride.length === 0
        ? getScenarioSearchFieldMeta(biqTab)
        : null;
      if (scenarioContext.autoCreatedSearchValue && !autoSearchField) {
        return { ok: false, error: 'This BIQ does not expose a writable Scenario Search Folder field.' };
      }
      const autoSearchEdits = (scenarioContext.autoCreatedSearchValue && autoSearchField && autoSearchField.fieldKey)
        ? [{
          sectionCode: 'GAME',
          recordRef: '@INDEX:0',
          fieldKey: autoSearchField.fieldKey,
          value: scenarioContext.autoCreatedSearchValue
        }]
        : [];
      const allBiqEdits = biqCustomRulesOps
        .concat(biqCustomPlayerDataOps)
        .concat(biqRecordOps)
        .concat(biqStructureRecordOps)
        .concat(biqMapStructureOps)
        .concat(biqMapRecordOps)
        .concat(biqEdits)
        .concat(structureEdits)
        .concat(mapEdits)
        .concat(autoSearchEdits);
      log.info('BiqSave', `buildSavePlan: BIQ edit summary for ${log.rel(scenarioPath)}`
        + ` — customRulesOps=${biqCustomRulesOps.length}`
        + ` — customPlayerDataOps=${biqCustomPlayerDataOps.length}`
        + ` — referenceRecordOps=${biqRecordOps.length}`
        + ` structureRecordOps=${biqStructureRecordOps.length}`
        + ` mapStructureOps=${biqMapStructureOps.length}`
        + ` mapRecordOps=${biqMapRecordOps.length}`
        + ` referenceEdits=${biqEdits.length}`
        + ` structureEdits=${structureEdits.length}`
        + ` mapEdits=${mapEdits.length}`
        + ` autoSearchEdits=${autoSearchEdits.length}`
        + ` total=${allBiqEdits.length}`);
      const hasReferenceDeleteOp = biqRecordOps.some((op) => String(op && op.op || '').trim().toLowerCase() === 'delete');
      if (hasReferenceDeleteOp) {
        const currentBundle = loadBundle({ mode, c3xPath, civ3Path, scenarioPath, textFileEncoding });
        const validationTabs = mergeTabsForDeleteValidation((currentBundle && currentBundle.tabs) || {}, payload.tabs || {});
        const unsafeDeleteIssues = collectUnsafeReferenceDeleteIssues({ tabs: validationTabs, biqTab });
        if (unsafeDeleteIssues.length > 0) {
          log.warn('BiqSave', `buildSavePlan: unsafe delete check failed — ${unsafeDeleteIssues.length} issue(s): ${unsafeDeleteIssues.map((i) => String(i && i.message || i)).slice(0, 3).join('; ')}`);
          return { ok: false, error: formatUnsafeReferenceDeleteError(unsafeDeleteIssues) };
        }
      } else {
        log.debug('BiqSave', 'buildSavePlan: skipped unsafe delete reload — no reference delete ops');
      }
      if (allBiqEdits.length > 0) {
        log.debug('BiqSave', `buildSavePlan: unsafe delete check passed — proceeding to apply ${allBiqEdits.length} BIQ edit(s)`);
        const biqSave = applyBiqReferenceEdits({
          biqPath: scenarioPath,
          edits: allBiqEdits,
          civ3Path,
          textEncoding: inferredBiqTextEncoding,
          returnBuffer: true
        });
        if (!biqSave.ok) {
          return { ok: false, error: biqSave.error || 'Failed to save BIQ edits.' };
        }
        if (Buffer.isBuffer(biqSave.buffer)) {
          plannedWrites.push({
            kind: 'biq',
            path: scenarioPath,
            data: biqSave.buffer
          });
        }
        saveReport.push({
          kind: 'biq',
          path: scenarioPath,
          applied: biqSave.applied || 0,
          skipped: biqSave.skipped || 0,
          warning: biqSave.warning || ''
        });
      }
    }
  }

  if (mode === 'scenario') {
    try {
      const localization = localizeScenarioReferenceArtAssets({
        tabs: payload.tabs || {},
        targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
        plannedWrites,
        saveReport
      });
      if (!localization.ok) {
        return { ok: false, error: localization.error || 'Failed to localize scenario art.' };
      }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Failed to localize scenario art.' };
    }

    const pediaIconsEdits = collectPediaIconsReferenceEdits(payload.tabs || {});
    {
      const sourceDetails = (((payload.tabs || {}).civilizations || {}).sourceDetails || {});
      const explicitPediaTarget = String(sourceDetails.pediaIconsScenarioWrite || sourceDetails.pediaIconsScenario || '').trim();
      const targetPath = explicitPediaTarget || path.join(scenarioContext.contentWriteRoot || scenarioDir, 'Text', 'PediaIcons.txt');
      const protectErr = failIfProtected(targetPath, 'PediaIcons target');
      if (protectErr) return { ok: false, error: protectErr };
      const pediaSourcePath = String(sourceDetails.pediaIconsScenario || '').trim()
        || String(sourceDetails.pediaIconsConquests || '').trim()
        || String(sourceDetails.pediaIconsPtw || '').trim()
        || String(sourceDetails.pediaIconsVanilla || '').trim();
      const pediaSave = pediaIconsEdits.length > 0
        ? buildScenarioPediaIconsEditResult({
          targetPath,
          sourcePath: pediaSourcePath,
          edits: pediaIconsEdits,
          encoding: String(sourceDetails.pediaIconsScenarioEncoding || sourceDetails.pediaIconsActiveEncoding || ''),
          bom: !!sourceDetails.pediaIconsScenarioBom,
          preferredEncoding: textFileEncoding
        })
        : buildScenarioPediaIconsRepairResult({
          targetPath,
          sourcePath: pediaSourcePath,
          encoding: String(sourceDetails.pediaIconsScenarioEncoding || sourceDetails.pediaIconsActiveEncoding || ''),
          bom: !!sourceDetails.pediaIconsScenarioBom,
          preferredEncoding: textFileEncoding
        });
      if (!pediaSave.ok) {
        return { ok: false, error: pediaSave.error || 'Failed to save PediaIcons edits.' };
      }
      if (pediaSave.applied > 0 && !bufferMatchesExistingFile(targetPath, pediaSave.buffer)) {
        plannedWrites.push({
          kind: 'pediaIcons',
          path: targetPath,
          data: pediaSave.buffer,
          encoding: pediaSave.encoding,
          bom: pediaSave.bom
        });
        saveReport.push({
          kind: 'pediaIcons',
          path: targetPath,
          applied: pediaSave.applied,
          repaired: !!pediaSave.repaired,
          movedHomelessBlocks: pediaSave.movedHomelessBlocks || 0,
          restoredHomeless: !!pediaSave.restoredHomeless,
          lineEndingsNormalized: !!pediaSave.lineEndingsNormalized
        });
      }
    }

    const civilopediaEdits = collectCivilopediaReferenceEdits(payload.tabs || {});
    {
      const sourceDetails = (((payload.tabs || {}).civilizations || {}).sourceDetails || {});
      const explicitTarget = (sourceDetails.civilopediaScenario || '').trim();
      const targetPath = explicitTarget || path.join(scenarioContext.contentWriteRoot || scenarioDir, 'Text', 'Civilopedia.txt');
      const protectErr = failIfProtected(targetPath, 'Civilopedia target');
      if (protectErr) return { ok: false, error: protectErr };
      const civilopediaSourcePath = String(sourceDetails.civilopediaScenario || '').trim()
        || String(sourceDetails.civilopediaConquests || '').trim()
        || String(sourceDetails.civilopediaPtw || '').trim()
        || String(sourceDetails.civilopediaVanilla || '').trim();
      const civilopediaSave = civilopediaEdits.length > 0
        ? buildScenarioCivilopediaEditResult({
          targetPath,
          sourcePath: civilopediaSourcePath,
          edits: civilopediaEdits,
          encoding: String(sourceDetails.civilopediaScenarioEncoding || sourceDetails.civilopediaActiveEncoding || ''),
          bom: !!sourceDetails.civilopediaScenarioBom,
          preferredEncoding: textFileEncoding
        })
        : buildScenarioCivilopediaRepairResult({
          targetPath,
          sourcePath: civilopediaSourcePath,
          encoding: String(sourceDetails.civilopediaScenarioEncoding || sourceDetails.civilopediaActiveEncoding || ''),
          bom: !!sourceDetails.civilopediaScenarioBom,
          preferredEncoding: textFileEncoding
        });
      if (!civilopediaSave.ok) {
        return { ok: false, error: civilopediaSave.error || 'Failed to save Civilopedia edits.' };
      }
      if (civilopediaSave.applied > 0 && !bufferMatchesExistingFile(targetPath, civilopediaSave.buffer)) {
        plannedWrites.push({
          kind: 'civilopedia',
          path: targetPath,
          data: civilopediaSave.buffer,
          encoding: civilopediaSave.encoding,
          bom: civilopediaSave.bom
        });
        saveReport.push({
          kind: 'civilopedia',
          path: targetPath,
          applied: civilopediaSave.applied,
          lineEndingsNormalized: !!civilopediaSave.lineEndingsNormalized
        });
      }
    }

    const diplomacyEdits = collectDiplomacyReferenceEdits(payload.tabs || {});
    if (diplomacyEdits.length > 0) {
      const civSourceDetails = (((payload.tabs || {}).civilizations || {}).sourceDetails || {});
      const explicitTarget = String(civSourceDetails.diplomacyScenarioWrite || '').trim()
        || String(civSourceDetails.diplomacyScenario || '').trim();
      const sourcePath = String(civSourceDetails.diplomacyActive || '').trim();
      const targetPath = explicitTarget || path.join(scenarioContext.contentWriteRoot || scenarioDir, 'Text', 'diplomacy.txt');
      const protectErr = failIfProtected(targetPath, 'diplomacy target');
      if (protectErr) return { ok: false, error: protectErr };
      const diplomacySave = buildScenarioDiplomacyEditResult({
        targetPath,
        sourcePath,
        edits: diplomacyEdits,
        encoding: String(civSourceDetails.diplomacyScenarioEncoding || civSourceDetails.diplomacyActiveEncoding || ''),
        bom: !!civSourceDetails.diplomacyScenarioBom,
        preferredEncoding: textFileEncoding
      });
      if (!diplomacySave.ok) {
        return { ok: false, error: diplomacySave.error || 'Failed to save diplomacy edits.' };
      }
      if (diplomacySave.applied > 0) {
        plannedWrites.push({
          kind: 'diplomacy',
          path: targetPath,
          sourcePath,
          data: diplomacySave.buffer,
          encoding: diplomacySave.encoding,
          bom: diplomacySave.bom
        });
        saveReport.push({ kind: 'diplomacy', path: targetPath, applied: diplomacySave.applied });
      }
    }

    const unitIniEdits = collectUnitIniReferenceEdits(payload.tabs || {}, scenarioContext.contentWriteRoot || scenarioDir);
    for (const edit of unitIniEdits) {
      const protectErr = failIfProtected(edit.targetPath, 'Unit INI target');
      if (protectErr) return { ok: false, error: protectErr };
      const unitIniSave = buildScenarioUnitIniEditResult({
        targetPath: edit.targetPath,
        sourcePath: edit.sourcePath,
        sections: edit.sections,
        originalSections: edit.originalSections,
        actions: edit.actions,
        originalActions: edit.originalActions
      });
      if (!unitIniSave.ok) {
        return { ok: false, error: unitIniSave.error || 'Failed to save unit INI edits.' };
      }
      if (unitIniSave.applied > 0) {
        plannedWrites.push({
          kind: 'unitIni',
          path: edit.targetPath,
          data: unitIniSave.buffer
        });
        saveReport.push({ kind: 'unitIni', path: edit.targetPath, applied: unitIniSave.applied });
      }
    }

    const scenarioDistrictsEdit = collectScenarioDistrictsEdit(payload.tabs || {});
    if (scenarioDistrictsEdit) {
      const targetPath = scenarioDistrictsEdit.targetPath || path.join(scenarioContext.contentWriteRoot || scenarioDir, 'scenario.districts.txt');
      const protectErr = failIfProtected(targetPath, 'scenario districts target');
      if (protectErr) return { ok: false, error: protectErr };
      const text = serializeScenarioDistrictsText({
        entries: scenarioDistrictsEdit.entries,
        namedTiles: scenarioDistrictsEdit.namedTiles
      });
      const encoding = resolveScenarioTextWriteEncoding({
        targetPath,
        sourcePath: scenarioDistrictsEdit.sourcePath,
        explicitEncoding: scenarioDistrictsEdit.encoding,
        preferredEncoding: textFileEncoding
      });
      plannedWrites.push({
        kind: 'scenarioDistricts',
        path: targetPath,
        data: encodeTextBuffer(text, encoding.encoding, { bom: encoding.bom }),
        encoding: encoding.encoding,
        bom: encoding.bom
      });
      saveReport.push({ kind: 'scenarioDistricts', path: targetPath, applied: scenarioDistrictsEdit.entries.length + scenarioDistrictsEdit.namedTiles.length });
    }

    if (payload.autoUpdateScienceAdvisorArrows === true) {
      const scienceAdvisorWrites = prepareScienceAdvisorArrowArtWrites({
        tabs: payload.tabs || {},
        targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
        scenarioPath,
        scenarioRoots: scenarioContext.searchRoots,
        civ3Path,
        routeOverrides: payload.techTreeArrowRouteOverrides || {},
        routeSnapshots: payload.techTreeArrowRouteSnapshots || {},
        baselineRouteHints: payload.techTreeArrowBaselineRouteHints || {},
        dirtyEdgesByEra: payload.techTreeArrowDirtyEdgesByEra || {},
        dirtyEraIndexes: payload.techTreeArrowDirtyEras || [],
        arrowStyle: payload.scienceAdvisorArrowStyle || null,
        civFiltersByEra: payload.techTreeArrowCivFiltersByEra || {}
      });
      if (scienceAdvisorWrites && !scienceAdvisorWrites.ok) {
        return { ok: false, error: scienceAdvisorWrites.error || 'Failed to update Science Advisor arrow art.' };
      }
      for (const write of (scienceAdvisorWrites && scienceAdvisorWrites.writes) || []) {
        const protectErr = failIfProtected(write.path, 'Science Advisor background target');
        if (protectErr) return { ok: false, error: protectErr };
        if (isProtectedBaseCiv3Path(civ3Path, write.path)) {
          return { ok: false, error: `Refusing to modify base Civilization III file (Science Advisor background target): ${write.path}` };
        }
        plannedWrites.push(write);
        saveReport.push({
          kind: write.kind,
          path: write.path,
          sourcePath: write.sourcePath,
          applied: write.applied || 0,
          clearDiagnostics: write.clearDiagnostics || null,
          detail: `Regenerated ${write.applied || 0} Science Advisor arrow connector${(write.applied || 0) === 1 ? '' : 's'}`
        });
      }
      const metadataWrite = buildScienceAdvisorArrowMetadataWrite({
        targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
        routeOverrides: payload.techTreeArrowRouteOverrides || {},
        routeSnapshots: payload.techTreeArrowRouteSnapshots || {},
        baselineRouteHints: payload.techTreeArrowBaselineRouteHints || {},
        dirtyEraIndexes: payload.techTreeArrowDirtyEras || []
      });
      if (metadataWrite) {
        const protectErr = failIfProtected(metadataWrite.path, 'Science Advisor arrow metadata target');
        if (protectErr) return { ok: false, error: protectErr };
        plannedWrites.push(metadataWrite);
        saveReport.push({
          kind: metadataWrite.kind,
          path: metadataWrite.path,
          applied: metadataWrite.applied || 0,
          detail: metadataWrite.detail
        });
      }
    }

    // Copy art files referenced by imported entries into the local scenario content root.
    // Skips files that cannot be resolved; never blocks a save.
    const artCopies = collectImportArtCopies({
      tabs: payload.tabs || {},
      targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir,
      civ3Path
    });
    for (const artCopy of artCopies) {
      let data;
      try {
        data = fs.readFileSync(artCopy.sourcePath);
      } catch (_err) {
        continue; // source unreadable – skip gracefully
      }
      plannedWrites.push({ kind: 'art', path: artCopy.targetPath, data });
      saveReport.push({ kind: 'art', path: artCopy.targetPath });
    }

    const atlasCopies = collectScenarioAtlasCopies({
      tabs: payload.tabs || {},
      targetContentRoot: scenarioContext.contentWriteRoot || scenarioDir
    });
    for (const atlasCopy of atlasCopies) {
      if (importedResourceAtlasWrite && importedResourceAtlasWrite.changed && normalizePathForCompare(atlasCopy.targetPath) === normalizePathForCompare(importedResourceAtlasWrite.path)) {
        continue;
      }
      if (importedUnitAtlasWrite && importedUnitAtlasWrite.changed && normalizePathForCompare(atlasCopy.targetPath) === normalizePathForCompare(importedUnitAtlasWrite.path)) {
        continue;
      }
      if (importedBuildingCityAtlasWrite && importedBuildingCityAtlasWrite.changed) {
        const importedPaths = importedBuildingCityAtlasWrite.paths || {};
        if (normalizePathForCompare(atlasCopy.targetPath) === normalizePathForCompare(importedPaths.large)
            || normalizePathForCompare(atlasCopy.targetPath) === normalizePathForCompare(importedPaths.small)) {
          continue;
        }
      }
      const protectErr = failIfProtected(atlasCopy.targetPath, 'scenario atlas copy target');
      if (protectErr) return { ok: false, error: protectErr };
      if (isProtectedBaseCiv3Path(civ3Path, atlasCopy.targetPath)) {
        return { ok: false, error: `Refusing to modify base Civilization III file (scenario atlas copy target): ${atlasCopy.targetPath}` };
      }
      let data;
      try {
        data = fs.readFileSync(atlasCopy.sourcePath);
      } catch (_err) {
        return { ok: false, error: `Could not read source atlas file: ${atlasCopy.sourcePath}` };
      }
      plannedWrites.push({ kind: 'atlas', path: atlasCopy.targetPath, sourcePath: atlasCopy.sourcePath, data });
      saveReport.push({ kind: 'atlas', path: atlasCopy.targetPath });
    }

    if (importedResourceAtlasWrite && importedResourceAtlasWrite.changed) {
      const protectErr = failIfProtected(importedResourceAtlasWrite.path, 'scenario resources.pcx target');
      if (protectErr) return { ok: false, error: protectErr };
      if (isProtectedBaseCiv3Path(civ3Path, importedResourceAtlasWrite.path)) {
        return { ok: false, error: `Refusing to modify base Civilization III file (scenario resources.pcx target): ${importedResourceAtlasWrite.path}` };
      }
      plannedWrites.push({
        kind: 'atlas',
        path: importedResourceAtlasWrite.path,
        sourcePath: importedResourceAtlasWrite.sourcePath,
        data: importedResourceAtlasWrite.data
      });
      saveReport.push({
        kind: 'atlas',
        path: importedResourceAtlasWrite.path,
        applied: importedResourceAtlasWrite.assignments.length,
        detail: `Added ${importedResourceAtlasWrite.assignments.length} imported resource icon${importedResourceAtlasWrite.assignments.length === 1 ? '' : 's'}`
      });
    }

    if (importedUnitAtlasWrite && importedUnitAtlasWrite.changed) {
      const protectErr = failIfProtected(importedUnitAtlasWrite.path, 'scenario units_32.pcx target');
      if (protectErr) return { ok: false, error: protectErr };
      if (isProtectedBaseCiv3Path(civ3Path, importedUnitAtlasWrite.path)) {
        return { ok: false, error: `Refusing to modify base Civilization III file (scenario units_32.pcx target): ${importedUnitAtlasWrite.path}` };
      }
      plannedWrites.push({
        kind: 'atlas',
        path: importedUnitAtlasWrite.path,
        sourcePath: importedUnitAtlasWrite.sourcePath,
        data: importedUnitAtlasWrite.data
      });
      saveReport.push({
        kind: 'atlas',
        path: importedUnitAtlasWrite.path,
        applied: importedUnitAtlasWrite.assignments.length,
        detail: `Added ${importedUnitAtlasWrite.assignments.length} imported unit icon${importedUnitAtlasWrite.assignments.length === 1 ? '' : 's'}`
      });
    }

    if (importedBuildingCityAtlasWrite && importedBuildingCityAtlasWrite.changed) {
      const importedPaths = importedBuildingCityAtlasWrite.paths || {};
      const importedSources = importedBuildingCityAtlasWrite.sourcePaths || {};
      const importedData = importedBuildingCityAtlasWrite.data || {};
      for (const size of ['large', 'small']) {
        const targetPath = importedPaths[size];
        const protectErr = failIfProtected(targetPath, `scenario buildings-${size}.pcx target`);
        if (protectErr) return { ok: false, error: protectErr };
        if (isProtectedBaseCiv3Path(civ3Path, targetPath)) {
          return { ok: false, error: `Refusing to modify base Civilization III file (scenario buildings-${size}.pcx target): ${targetPath}` };
        }
        plannedWrites.push({
          kind: 'atlas',
          path: targetPath,
          sourcePath: importedSources[size],
          data: importedData[size]
        });
        saveReport.push({
          kind: 'atlas',
          path: targetPath,
          applied: importedBuildingCityAtlasWrite.assignments.length,
          detail: `Added ${importedBuildingCityAtlasWrite.assignments.length} imported improvement city icon row${importedBuildingCityAtlasWrite.assignments.length === 1 ? '' : 's'}`
        });
      }
    }
  }

  log.info('buildSavePlan', `Plan complete: ${plannedWrites.length} write(s) — [${plannedWrites.map((w) => `${w.kind}:${log.rel(w.path)}`).join(', ')}]`);
  return {
    ok: true,
    plannedWrites,
    saveReport,
    scenarioWriteRoots: mode === 'scenario' ? scenarioContext.writableRoots : [],
    ensureDirs: mode === 'scenario' && scenarioContext.autoCreatedSearchRoot
      ? [scenarioContext.autoCreatedSearchRoot]
      : []
  };
}

function saveBundle(payload, options = {}) {
  const mode = (payload && payload.mode) === 'scenario' ? 'scenario' : 'global';
  log.setCiv3Root(payload && payload.civ3Path || '');
  log.info('saveBundle', `mode=${mode}, dirtyTabs=[${Array.isArray(payload && payload.dirtyTabs) ? payload.dirtyTabs.join(', ') : '(all)'}]`);
  const plan = buildSavePlan(payload);
  if (!plan.ok) {
    log.error('saveBundle', `Save plan failed: ${plan.error}`);
    return plan;
  }
  const orderedWrites = Array.isArray(plan.plannedWrites) ? uniqueWritesByPath(plan.plannedWrites) : [];
  reportOperationProgress(options && options.onProgress, {
    stage: 'scan',
    completed: 0,
    total: orderedWrites.length,
    label: orderedWrites.length > 0
      ? `Saving ${orderedWrites.length} file${orderedWrites.length === 1 ? '' : 's'}...`
      : 'No file changes to save.',
    items: orderedWrites.map((entry) => ({
      path: String(entry && entry.path || ''),
      kind: String(entry && entry.kind || ''),
      exists: !!(entry && entry.path && fs.existsSync(entry.path))
    }))
  });
  const committed = commitWritesWithRollback(plan.plannedWrites, options);
  if (!committed.ok) {
    return {
      ok: false,
      error: committed.error || 'Failed to commit save transaction.',
      saveReport: plan.saveReport,
      writeResults: committed.writeResults || [],
      rollback: committed.rollback || null
    };
  }

  (Array.isArray(plan.ensureDirs) ? plan.ensureDirs : []).forEach((dirPath) => {
    if (!dirPath) return;
    fs.mkdirSync(dirPath, { recursive: true });
  });

  return {
    ok: true,
    saveReport: plan.saveReport,
    writeResults: committed.writeResults || []
  };
}

function previewSavePlan(payload) {
  const plan = buildSavePlan(payload);
  if (!plan.ok) return plan;
  const writes = uniqueWritesByPath(plan.plannedWrites).map((entry) => {
    const targetPath = String(entry && entry.path || '').trim();
    const exists = targetPath ? fs.existsSync(targetPath) : false;
    return {
      path: targetPath,
      kind: String(entry && entry.kind || ''),
      exists
    };
  });
  return {
    ok: true,
    writes,
    saveReport: plan.saveReport
  };
}

function previewFileDiff(payload) {
  const targetPath = String(payload && payload.targetPath || '').trim();
  if (!targetPath) return { ok: false, error: 'No target file path provided.' };
  const plan = buildSavePlan(payload || {});
  if (!plan.ok) return plan;
  const targetResolved = path.resolve(targetPath);
  const write = (plan.plannedWrites || []).find((entry) => {
    const p = String(entry && entry.path || '').trim();
    if (!p) return false;
    return path.resolve(p) === targetResolved;
  });
  if (!write) {
    return { ok: true, found: false, error: 'No pending write for that file.' };
  }
  const filePath = String(write.path || '').trim();
  const lowerPath = filePath.toLowerCase();
  if (!lowerPath.endsWith('.txt') && !lowerPath.endsWith('.ini')) {
    return { ok: true, found: false, error: 'Diff preview is only available for text/INI files.' };
  }
  const encoding = normalizeTextFileEncoding(write && write.encoding);
  const nextText = Buffer.isBuffer(write.data)
    ? (() => {
      const raw = write.data;
      const hasBom = !!(write && write.bom && normalizeTextFileEncoding(encoding) === 'utf8'
        && raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf);
      return decodeTextBuffer(hasBom ? raw.subarray(3) : raw, encoding === 'auto' ? 'windows-1252' : encoding);
    })()
    : String(write.data || '');
  let prevText = '';
  let exists = false;
  try {
    if (fs.existsSync(filePath)) {
      exists = true;
      if (Buffer.isBuffer(write.data)) {
        const prevInfo = readTextFileWithEncodingInfoIfExists(filePath, { preferredEncoding: encoding });
        prevText = prevInfo ? prevInfo.text : '';
      } else {
        prevText = fs.readFileSync(filePath, 'utf8');
      }
    }
  } catch (_err) {
    prevText = '';
    exists = false;
  }
  const lineEndingsNormalized = hasNonCrlfLineEndings(prevText) && !hasNonCrlfLineEndings(nextText);
  const lineEndingOnlyChange = lineEndingsNormalized
    && normalizeTextLineEndingsToCrlf(prevText) === normalizeTextLineEndingsToCrlf(nextText);
  const diffRows = buildUnifiedDiffRows(prevText, nextText, { context: 3 });
  return {
    ok: true,
    found: true,
    path: filePath,
    kind: String(write.kind || ''),
    exists,
    encoding,
    oldText: prevText,
    newText: nextText,
    lineEndingsNormalized,
    lineEndingOnlyChange,
    diffRows
  };
}

function buildLineOpsForDiff(oldText, newText) {
  const oldLines = String(oldText || '').replace(/\r\n/g, '\n').split('\n');
  const newLines = String(newText || '').replace(/\r\n/g, '\n').split('\n');
  const a = oldLines.map((line) => String(line || '').replace(/\r$/, ''));
  const b = newLines.map((line) => String(line || '').replace(/\r$/, ''));
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const size = 2 * max + 1;
  const trace = [];
  let v = new Array(size).fill(0);
  let endD = 0;

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + offset;
      let x;
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1];
      } else {
        x = v[kIdx - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[kIdx] = x;
      if (x >= n && y >= m) {
        endD = d;
        trace.push(v.slice());
        d = max + 1;
        break;
      }
    }
  }

  const ops = [];
  let x = n;
  let y = m;
  for (let d = endD; d > 0; d -= 1) {
    const prevV = trace[d];
    const k = x - y;
    const kIdx = k + offset;
    let prevK;
    if (k === -d || (k !== d && prevV[kIdx - 1] < prevV[kIdx + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prevV[prevK + offset];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ kind: 'ctx', text: oldLines[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (x === prevX) {
      if (y > 0) {
        ops.push({ kind: 'add', text: newLines[y - 1] });
        y -= 1;
      }
    } else if (x > 0) {
      ops.push({ kind: 'del', text: oldLines[x - 1] });
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    ops.push({ kind: 'ctx', text: oldLines[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    ops.push({ kind: 'del', text: oldLines[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    ops.push({ kind: 'add', text: newLines[y - 1] });
    y -= 1;
  }
  return ops.reverse();
}

function buildUnifiedDiffRows(oldText, newText, options = {}) {
  const context = Math.max(0, Number(options.context) || 3);
  const ops = buildLineOpsForDiff(oldText, newText);
  if (!ops.some((op) => op.kind === 'add' || op.kind === 'del')) {
    return [{ kind: 'meta', text: 'No textual differences.' }];
  }

  const rows = [];
  let oldNo = 1;
  let newNo = 1;
  ops.forEach((op) => {
    const row = { kind: op.kind, text: String(op.text || ''), oldLine: null, newLine: null };
    if (op.kind === 'ctx') {
      row.oldLine = oldNo;
      row.newLine = newNo;
      oldNo += 1;
      newNo += 1;
    } else if (op.kind === 'del') {
      row.oldLine = oldNo;
      oldNo += 1;
    } else if (op.kind === 'add') {
      row.newLine = newNo;
      newNo += 1;
    }
    rows.push(row);
  });

  const changed = [];
  rows.forEach((row, idx) => {
    if (row.kind === 'add' || row.kind === 'del') changed.push(idx);
  });
  if (!changed.length) return [{ kind: 'meta', text: 'No textual differences.' }];

  const ranges = [];
  let cur = { start: Math.max(0, changed[0] - context), end: Math.min(rows.length - 1, changed[0] + context) };
  for (let i = 1; i < changed.length; i += 1) {
    const idx = changed[i];
    const start = Math.max(0, idx - context);
    const end = Math.min(rows.length - 1, idx + context);
    if (start <= cur.end + 1) cur.end = Math.max(cur.end, end);
    else {
      ranges.push(cur);
      cur = { start, end };
    }
  }
  ranges.push(cur);

  const out = [];
  ranges.forEach((range) => {
    const slice = rows.slice(range.start, range.end + 1);
    let oldStart = 1;
    let newStart = 1;
    const firstOld = slice.find((r) => r.oldLine != null);
    const firstNew = slice.find((r) => r.newLine != null);
    if (firstOld && firstOld.oldLine != null) oldStart = firstOld.oldLine;
    if (firstNew && firstNew.newLine != null) newStart = firstNew.newLine;
    const oldCount = slice.reduce((n, r) => n + (r.oldLine != null ? 1 : 0), 0);
    const newCount = slice.reduce((n, r) => n + (r.newLine != null ? 1 : 0), 0);
    out.push({ kind: 'hunk', text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, oldLine: null, newLine: null });
    slice.forEach((r) => out.push(r));
  });

  return out;
}

function isBiqPath(value) {
  return /\.biq$/i.test(String(value || '').trim());
}

function getSectionCodeForReferenceTabKey(tabKey) {
  const spec = REFERENCE_TAB_SPECS.find((s) => s.key === tabKey);
  return spec ? getSectionCodeForReferencePrefix(spec.prefix) : '';
}

function getReferenceTabKeyForSectionCode(sectionCode) {
  const code = String(sectionCode || '').trim().toUpperCase();
  const spec = REFERENCE_TAB_SPECS.find((entry) => getSectionCodeForReferencePrefix(entry.prefix) === code);
  return spec ? spec.key : '';
}

const BIQ_SAVE_REFERENCE_FIELD_TARGETS = {
  resources: {
    prerequisite: 'technologies'
  },
  improvements: {
    reqimprovement: 'improvements',
    reqgovernment: 'governments',
    reqadvance: 'technologies',
    obsoleteby: 'technologies',
    reqresource1: 'resources',
    reqresource2: 'resources',
    unitproduced: 'units',
    gainineverycity: 'improvements',
    gainoncontinent: 'improvements',
    doubleshappiness: 'improvements'
  },
  units: {
    requiredtech: 'technologies',
    upgradeto: 'units',
    requiredresource1: 'resources',
    requiredresource2: 'resources',
    requiredresource3: 'resources',
    enslaveresultsin: 'units',
    enslaveresultsinto: 'units',
    stealthtarget: 'units',
    legalunittelepad: 'units',
    legalbuildingtelepad: 'improvements'
  },
  civilizations: {
    freetech1index: 'technologies',
    freetech1: 'technologies',
    freetech2index: 'technologies',
    freetech2: 'technologies',
    freetech3index: 'technologies',
    freetech3: 'technologies',
    freetech4index: 'technologies',
    freetech4: 'technologies',
    shunnedgovernment: 'governments',
    favoritegovernment: 'governments',
    kingunit: 'units'
  },
  governments: {
    prerequisitetechnology: 'technologies',
    immuneto: ''
  },
  technologies: {
    prerequisite1: 'technologies',
    prerequisite2: 'technologies',
    prerequisite3: 'technologies',
    prerequisite4: 'technologies'
  },
  rules: {
    slave: 'units',
    startunit1: 'units',
    startunit2: 'units',
    scout: 'units',
    battlecreatedunit: 'units',
    buildarmyunit: 'units',
    basicbarbarian: 'units',
    advancedbarbarian: 'units',
    barbarianseaunit: 'units',
    flagunit: 'units',
    defaultmoneyresource: 'resources'
  }
};

const BIQ_SAVE_SECTION_TO_REFERENCE_TAB = {
  RACE: 'civilizations',
  TECH: 'technologies',
  GOOD: 'resources',
  BLDG: 'improvements',
  GOVT: 'governments',
  PRTO: 'units'
};

function getSaveReferenceTargetTabKey(sourceTabKey, fieldKey) {
  const source = String(sourceTabKey || '').trim();
  const canon = canonicalFieldKey(fieldKey);
  if (!source || !canon) return '';
  return ((BIQ_SAVE_REFERENCE_FIELD_TARGETS[source] || {})[canon]) || '';
}

function getBiqStructureSaveRefSpec(sectionCode, fieldKey) {
  const code = String(sectionCode || '').trim().toUpperCase();
  const canon = canonicalFieldKey(fieldKey);
  if (!code || !canon) return null;
  const unitRefKeys = new Set([
    'advancedbarbarian', 'basicbarbarian', 'barbarianseaunit', 'battlecreatedunit', 'buildarmyunit',
    'scout', 'slave', 'startunit1', 'startunit2', 'flagunit'
  ]);
  if ((code === 'GAME' || code === 'RULE') && unitRefKeys.has(canon)) return { tabKey: 'units' };
  if ((code === 'GAME' || code === 'RULE') && canon === 'defaultmoneyresource') return { tabKey: 'resources' };
  if (code === 'GAME' && (canon === 'playableciv' || canon.startsWith('playableciv'))) return { tabKey: 'civilizations' };
  if (code === 'LEAD' && canon === 'civ') return { tabKey: 'civilizations' };
  if (code === 'LEAD' && canon === 'government') return { tabKey: 'governments' };
  if (code === 'LEAD' && /^startingtechnology\d+$/.test(canon)) return { tabKey: 'technologies' };
  if (code === 'TFRM' && canon === 'requiredadvance') return { tabKey: 'technologies' };
  if (code === 'TFRM' && (canon === 'requiredresource1' || canon === 'requiredresource2')) return { tabKey: 'resources' };
  if (code === 'CTZN' && canon === 'prerequisite') return { tabKey: 'technologies' };
  return null;
}

function normalizeReferenceTargetPayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const key = String(raw || '').trim().toUpperCase();
    return key ? { key } : null;
  }
  if (typeof raw !== 'object') return null;
  const key = String(raw.key || raw.civilopediaKey || raw.referenceKey || raw.recordRef || '').trim().toUpperCase();
  if (!key) return null;
  const tabKey = String(raw.tabKey || raw.targetTabKey || '').trim();
  return {
    key,
    tabKey
  };
}

function getFieldReferenceTarget(field) {
  if (!field || typeof field !== 'object') return null;
  return normalizeReferenceTargetPayload(field.referenceTarget)
    || normalizeReferenceTargetPayload(field.reference)
    || normalizeReferenceTargetPayload(field._referenceTarget)
    || normalizeReferenceTargetPayload(field.pendingReferenceTarget)
    || normalizeReferenceTargetPayload(field.referenceTargetKey)
    || normalizeReferenceTargetPayload(field._referenceTargetKey);
}

function getFieldReferenceTargets(field) {
  if (!field || typeof field !== 'object') return [];
  const candidates = [
    field.referenceTargets,
    field.referenceTargetKeys,
    field._referenceTargets,
    field._referenceTargetKeys,
    field.pendingReferenceTargets
  ];
  for (const value of candidates) {
    if (!Array.isArray(value)) continue;
    return value.map((entry) => normalizeReferenceTargetPayload(entry)).filter(Boolean);
  }
  return [];
}

function encodeSigned32Bitmask(indices) {
  let mask = 0 >>> 0;
  (Array.isArray(indices) ? indices : []).forEach((idx) => {
    const bit = Number.parseInt(String(idx), 10);
    if (!Number.isFinite(bit) || bit < 0 || bit > 31) return;
    mask = (mask | ((1 << bit) >>> 0)) >>> 0;
  });
  return String(mask > 0x7fffffff ? mask - 0x100000000 : mask);
}

function getPlannedReferenceIndex(indexMaps, targetTabKey, target) {
  const normalizedTarget = normalizeReferenceTargetPayload(target);
  if (!normalizedTarget || !normalizedTarget.key) return NaN;
  const expectedTabKey = String(targetTabKey || normalizedTarget.tabKey || '').trim();
  if (!expectedTabKey) return NaN;
  if (normalizedTarget.tabKey && String(normalizedTarget.tabKey).trim() !== expectedTabKey) return NaN;
  const map = indexMaps && indexMaps[expectedTabKey];
  if (!map || !(map.byKey instanceof Map)) return NaN;
  const value = map.byKey.get(String(normalizedTarget.key || '').trim().toUpperCase());
  return Number.isFinite(value) ? value : NaN;
}

function getBiqRecordPlanningRef(record) {
  const key = String(getBiqRecordCivilopediaKey(record) || '').trim().toUpperCase();
  if (key) return key;
  const idx = parseAssignedBiqIndex(record && record.index);
  return Number.isFinite(idx) && idx >= 0 ? `@INDEX:${idx}` : '';
}

function parseAssignedBiqIndex(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'string' && raw.trim() === '') return NaN;
  if (typeof raw === 'boolean') return NaN;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function findPlannedRecordIndex(records, recordRef) {
  const ref = String(recordRef || '').trim().toUpperCase();
  if (!ref) return -1;
  if (ref.startsWith('@INDEX:')) {
    const idx = Number.parseInt(ref.slice(7), 10);
    if (!Number.isFinite(idx)) return -1;
    return records.findIndex((record) => (
      parseAssignedBiqIndex(record && record.originalIndex) === idx
      || parseAssignedBiqIndex(record && record.index) === idx
    ));
  }
  return records.findIndex((record) => (
    String(record && record.key || '').trim().toUpperCase() === ref
    || String(record && record.newRecordRef || '').trim().toUpperCase() === ref
  ));
}

function normalizePlannedReorderOrder(order) {
  if (!Array.isArray(order)) return [];
  return order
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);
}

function applyPlannedRecordReorder(planned, order) {
  if (!Array.isArray(planned) || planned.length === 0) return false;
  const normalized = normalizePlannedReorderOrder(order);
  if (normalized.length === 0) return false;
  const byOriginalIndex = new Map();
  planned.forEach((record) => {
    const originalIndex = parseAssignedBiqIndex(record && record.originalIndex);
    if (Number.isFinite(originalIndex) && originalIndex >= 0) byOriginalIndex.set(originalIndex, record);
  });
  const used = new Set();
  const next = [];
  normalized.forEach((oldIndex) => {
    const record = byOriginalIndex.get(oldIndex);
    if (!record || used.has(record)) return;
    used.add(record);
    next.push(record);
  });
  planned.forEach((record) => {
    if (used.has(record)) return;
    used.add(record);
    next.push(record);
  });
  if (next.length !== planned.length) return false;
  planned.splice(0, planned.length, ...next);
  planned.forEach((record, idx) => { record.index = idx; });
  return true;
}

function getReferenceRecordOpsForPlanning(tabs, tabKey) {
  const tab = tabs && tabs[tabKey];
  return Array.isArray(tab && tab.recordOps) ? tab.recordOps : [];
}

function getReferencePlanningRecordsForSection(biqTab, sectionCode) {
  const records = getBiqRecordListForSection(biqTab, sectionCode);
  if (String(sectionCode || '').trim().toUpperCase() !== 'PRTO') return records;
  return (Array.isArray(records) ? records : []).filter((record) => !isPrtoStrategyMapRecord(record));
}

function buildPlannedReferenceIndexMaps(tabs, biqTab) {
  const out = {};
  Object.entries(BIQ_SAVE_SECTION_TO_REFERENCE_TAB).forEach(([sectionCode, tabKey]) => {
    const originalRecords = getReferencePlanningRecordsForSection(biqTab, sectionCode);
    const planned = (Array.isArray(originalRecords) ? originalRecords : []).map((record, idx) => {
      const recordIndex = parseAssignedBiqIndex(record && record.index);
      return {
        key: getBiqRecordPlanningRef(record),
        index: Number.isFinite(recordIndex) ? recordIndex : idx,
        originalIndex: Number.isFinite(recordIndex) ? recordIndex : idx
      };
    });
    const planningOps = getReferenceRecordOpsForPlanning(tabs, tabKey);
    const reorderOps = [];
    planningOps.forEach((op) => {
      const kind = String(op && op.op || '').trim().toLowerCase();
      if (kind === 'reorder') {
        reorderOps.push(op);
        return;
      }
      if (kind === 'add' || kind === 'copy') {
        const newRecordRef = String(op && op.newRecordRef || '').trim().toUpperCase();
        if (!newRecordRef) return;
        if (planned.some((record) => String(record && record.key || '').trim().toUpperCase() === newRecordRef
          || String(record && record.newRecordRef || '').trim().toUpperCase() === newRecordRef)) {
          return;
        }
        planned.push({
          key: newRecordRef,
          newRecordRef,
          index: planned.length
        });
        return;
      }
      if (kind === 'delete') {
        const deleteIdx = findPlannedRecordIndex(planned, op && op.recordRef);
        if (deleteIdx < 0) return;
        planned.splice(deleteIdx, 1);
        planned.forEach((record, idx) => { record.index = idx; });
      }
    });
    const lastReorder = reorderOps.length > 0 ? reorderOps[reorderOps.length - 1] : null;
    if (lastReorder && String(sectionCode || '').trim().toUpperCase() === 'PRTO') {
      applyPlannedRecordReorder(planned, lastReorder.order);
    }
    const byKey = new Map();
    planned.forEach((record, idx) => {
      const key = String(record && record.key || '').trim().toUpperCase();
      if (key) byKey.set(key, idx);
      const newRef = String(record && record.newRecordRef || '').trim().toUpperCase();
      if (newRef) byKey.set(newRef, idx);
      const originalIndex = parseAssignedBiqIndex(record && record.originalIndex);
      if (Number.isFinite(originalIndex) && originalIndex >= 0) byKey.set(`@INDEX:${originalIndex}`, idx);
      else byKey.set(`@INDEX:${idx}`, idx);
    });
    const tabEntries = tabs && tabs[tabKey] && Array.isArray(tabs[tabKey].entries) ? tabs[tabKey].entries : [];
    tabEntries.forEach((entry) => {
      const key = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
      const originalIndex = parseAssignedBiqIndex(entry && entry.biqIndex);
      if (!key || !Number.isFinite(originalIndex) || originalIndex < 0) return;
      const plannedIndex = byKey.get(`@INDEX:${originalIndex}`);
      if (Number.isFinite(plannedIndex) && plannedIndex >= 0) byKey.set(key, plannedIndex);
    });
    out[tabKey] = {
      sectionCode,
      records: planned,
      byKey
    };
  });
  return out;
}

function normalizeReferenceFieldValueForSave(field, targetTabKey, indexMaps) {
  const target = getFieldReferenceTarget(field);
  if (!target) return false;
  const finalIndex = getPlannedReferenceIndex(indexMaps, targetTabKey, target);
  field.value = Number.isFinite(finalIndex) && finalIndex >= 0 ? String(finalIndex) : '-1';
  return true;
}

function normalizeReferenceListFieldValueForSave(field, targetTabKey, indexMaps) {
  const targets = getFieldReferenceTargets(field);
  if (targets.length === 0) return false;
  const finalIndices = targets
    .map((target) => getPlannedReferenceIndex(indexMaps, targetTabKey, target))
    .filter((idx) => Number.isFinite(idx) && idx >= 0);
  if (canonicalFieldKey(field && (field.baseKey || field.key)) === 'availableto') {
    field.value = encodeSigned32Bitmask(finalIndices);
    return true;
  }
  field.value = finalIndices.join(',');
  return true;
}

function normalizePendingReferenceTargetsForSave({ tabs, indexTabs, biqTab }) {
  const sourceTabs = tabs || {};
  const indexMaps = buildPlannedReferenceIndexMaps(indexTabs || sourceTabs, biqTab);
  let changed = 0;

  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = sourceTabs[spec.key];
    if (!tab || !Array.isArray(tab.entries)) continue;
    tab.entries.forEach((entry) => {
      (Array.isArray(entry && entry.biqFields) ? entry.biqFields : []).forEach((field) => {
        if (!field) return;
        const canon = canonicalFieldKey(field.baseKey || field.key);
        if (spec.key === 'units' && canon === 'availableto') {
          if (normalizeReferenceListFieldValueForSave(field, 'civilizations', indexMaps)) changed += 1;
          return;
        }
        const targetTabKey = getSaveReferenceTargetTabKey(spec.key, canon);
        if (!targetTabKey) return;
        if (normalizeReferenceFieldValueForSave(field, targetTabKey, indexMaps)) changed += 1;
      });
    });
  }

  for (const spec of BIQ_STRUCTURE_TAB_SPECS) {
    const tab = sourceTabs[spec.key];
    if (!tab || !Array.isArray(tab.sections)) continue;
    tab.sections.forEach((section) => {
      const sectionCode = String(section && section.code || '').trim().toUpperCase();
      (Array.isArray(section && section.records) ? section.records : []).forEach((record) => {
        (Array.isArray(record && record.fields) ? record.fields : []).forEach((field) => {
          const refSpec = getBiqStructureSaveRefSpec(sectionCode, field && (field.baseKey || field.key));
          if (!refSpec || !refSpec.tabKey) return;
          if (normalizeReferenceFieldValueForSave(field, refSpec.tabKey, indexMaps)) changed += 1;
        });
      });
    });
  }

  if (changed > 0) {
    log.info('BiqCollect', `normalizePendingReferenceTargetsForSave: resolved ${changed} reference field(s) through planned BIQ indices`);
  }
  return { changed, indexMaps };
}

function isLockedBiqField(sectionCode, fieldKey) {
  return false;
}

const BIQ_SECTION_TITLE_BY_CODE = new Map(BIQ_SECTION_DEFS.map((def) => [String(def.code || '').toUpperCase(), String(def.title || def.code || '').trim()]));

function getBiqSectionTitle(sectionCode) {
  const code = String(sectionCode || '').trim().toUpperCase();
  return BIQ_SECTION_TITLE_BY_CODE.get(code) || code || 'Records';
}

function getFieldCanonicalKey(field) {
  return canonicalFieldKey(field && (field.baseKey || field.key) || '');
}

function getFieldNumericValue(field, fallback = NaN) {
  return parseIntLoose(cleanDisplayText(field && field.value), fallback);
}

function getRecordFieldNumericValue(fields, canonicalKey, fallback = NaN) {
  const target = canonicalFieldKey(canonicalKey);
  if (!target || !Array.isArray(fields)) return fallback;
  const match = fields.find((field) => getFieldCanonicalKey(field) === target);
  return getFieldNumericValue(match, fallback);
}

function getFieldValuesAsInts(field) {
  const raw = cleanDisplayText(field && field.value);
  if (!raw || raw.toLowerCase() === '(none)') return [];
  return raw.split(/[,\s]+/)
    .map((part) => parseIntLoose(part, NaN))
    .filter((value) => Number.isFinite(value));
}

function getBiqRecordListForSection(biqTab, sectionCode) {
  const target = String(sectionCode || '').trim().toUpperCase();
  if (!biqTab || !Array.isArray(biqTab.sections) || !target) return [];
  const section = biqTab.sections.find((entry) => String(entry && entry.code || '').trim().toUpperCase() === target);
  if (!section) return [];
  if (Array.isArray(section.fullRecords) && section.fullRecords.length > 0) return section.fullRecords;
  return Array.isArray(section.records) ? section.records : [];
}

function getBiqRecordCivilopediaKey(record) {
  if (!record) return '';
  const direct = cleanDisplayText(record.civilopediaEntry);
  if (direct) return direct;
  const fields = Array.isArray(record.fields) ? record.fields : [];
  const match = fields.find((field) => getFieldCanonicalKey(field) === 'civilopediaentry');
  return cleanDisplayText(match && match.value);
}

function getBiqRecordDisplayName(record, fallback = 'Record') {
  if (!record) return fallback;
  const directName = cleanDisplayText(
    record.civilizationName
    || record.leaderName
    || record.eraName
    || record.name
    || record.english
  );
  if (directName) return directName;
  const fields = Array.isArray(record.fields) ? record.fields : [];
  const candidates = ['civilizationname', 'name', 'leadertitle', 'townname'];
  for (const key of candidates) {
    const match = fields.find((field) => getFieldCanonicalKey(field) === key);
    const value = cleanDisplayText(match && match.value);
    if (value) return value;
  }
  return fallback;
}

function getOriginalReferenceRecordInfo(biqTab, sectionCode, recordRef) {
  const targetRef = String(recordRef || '').trim().toUpperCase();
  if (!targetRef) return null;
  const records = getBiqRecordListForSection(biqTab, sectionCode);
  if (targetRef.startsWith('@INDEX:')) {
    const idx = Number.parseInt(targetRef.slice(7), 10);
    const record = Number.isFinite(idx) ? records.find((item) => Number(item && item.index) === idx) : null;
    if (!record) return null;
    return {
      index: idx,
      name: getBiqRecordDisplayName(record, targetRef)
    };
  }
  for (const record of records) {
    const civKey = getBiqRecordCivilopediaKey(record);
    if (String(civKey || '').trim().toUpperCase() !== targetRef) continue;
    const idx = Number(record && record.index);
    return {
      index: Number.isFinite(idx) ? idx : -1,
      name: getBiqRecordDisplayName(record, targetRef)
    };
  }
  return null;
}

function getCurrentReferenceRecordInfo(tabs, sectionCode, recordRef) {
  const tabKey = getReferenceTabKeyForSectionCode(sectionCode);
  const tab = tabKey ? tabs && tabs[tabKey] : null;
  const entries = Array.isArray(tab && tab.entries) ? tab.entries : [];
  const targetRef = String(recordRef || '').trim().toUpperCase();
  const entry = targetRef.startsWith('@INDEX:')
    ? entries.find((item) => `@INDEX:${Number.isFinite(item && item.biqIndex) ? Number(item.biqIndex) : -1}` === targetRef)
    : entries.find((item) => String(item && item.civilopediaKey || '').trim().toUpperCase() === targetRef);
  if (!entry) return null;
  const idx = Number.isFinite(entry && entry.biqIndex) ? Number(entry.biqIndex) : NaN;
  return {
    index: Number.isFinite(idx) ? idx : -1,
    name: cleanDisplayText(entry && (entry.name || entry.civilopediaKey)) || targetRef
  };
}

function matchesDeletedReference(field, targetIndex, matcher, context = null) {
  if (!field || !Number.isFinite(targetIndex) || typeof matcher !== 'function') return false;
  const canon = getFieldCanonicalKey(field);
  if (!canon) return false;
  return !!matcher({ canon, field, targetIndex, context });
}

function collectUnsafeReferenceDeleteIssues({ tabs, biqTab }) {
  if (!tabs || !biqTab) return [];

  const deleteOps = collectBiqReferenceRecordOps(tabs).filter((op) => String(op && op.op || '').toLowerCase() === 'delete');
  if (deleteOps.length === 0) return [];

  const dependencyRules = {
    TECH: [
      { sourceSection: 'CTZN', sourceLabel: 'Citizens', matcher: ({ canon, field, targetIndex }) => canon === 'prerequisite' && getFieldNumericValue(field) === targetIndex },
      { sourceSection: 'TFRM', sourceLabel: 'Worker Jobs', matcher: ({ canon, field, targetIndex }) => canon === 'requiredadvance' && getFieldNumericValue(field) === targetIndex }
    ],
    GOOD: [
      { sourceSection: 'TFRM', sourceLabel: 'Worker Jobs', matcher: ({ canon, field, targetIndex }) => /^requiredresource\d+$/.test(canon) && getFieldNumericValue(field) === targetIndex }
    ],
    BLDG: [],
    GOVT: [],
    PRTO: [],
    RACE: []
  };

  dependencyRules.PRTO.push(
    {
      sourceSection: 'UNIT',
      sourceLabel: 'Map Units',
      matcher: ({ canon, field, targetIndex }) => canon === 'prtonumber' && getFieldNumericValue(field) === targetIndex
    },
    {
      sourceSection: 'LEAD',
      sourceLabel: 'Players',
      matcher: ({ canon, field, targetIndex }) => /^startingunitsoftype\d+$/.test(canon) && getFieldNumericValue(field) === targetIndex
    }
  );

  dependencyRules.RACE.push(
    {
      sourceSection: 'LEAD',
      sourceLabel: 'Players',
      matcher: ({ canon, field, targetIndex }) => canon === 'civ' && getFieldNumericValue(field) === targetIndex
    },
    {
      sourceSection: 'SLOC',
      sourceLabel: 'Starting Locations',
      matcher: ({ canon, field, targetIndex, context }) => (
        canon === 'owner'
        && getFieldNumericValue(field) === targetIndex
        && getRecordFieldNumericValue(context && context.record && context.record.fields, 'ownertype', NaN) === 2
      )
    },
    {
      sourceSection: 'CITY',
      sourceLabel: 'Cities',
      matcher: ({ canon, field, targetIndex, context }) => (
        canon === 'owner'
        && getFieldNumericValue(field) === targetIndex
        && getRecordFieldNumericValue(context && context.record && context.record.fields, 'ownertype', NaN) === 2
      )
    },
    {
      sourceSection: 'UNIT',
      sourceLabel: 'Map Units',
      matcher: ({ canon, field, targetIndex, context }) => (
        canon === 'owner'
        && getFieldNumericValue(field) === targetIndex
        && getRecordFieldNumericValue(context && context.record && context.record.fields, 'ownertype', NaN) === 2
      )
    },
    {
      sourceSection: 'CLNY',
      sourceLabel: 'Colonies',
      matcher: ({ canon, field, targetIndex, context }) => (
        canon === 'owner'
        && getFieldNumericValue(field) === targetIndex
        && getRecordFieldNumericValue(context && context.record && context.record.fields, 'ownertype', NaN) === 2
      )
    }
  );

  const issues = [];

  const recordsBySection = new Map();
  const pushRecord = (sectionCode, sourceLabel, recordName, fields) => {
    const code = String(sectionCode || '').trim().toUpperCase();
    if (!code || !Array.isArray(fields) || fields.length === 0) return;
    if (!recordsBySection.has(code)) recordsBySection.set(code, []);
    recordsBySection.get(code).push({
      sourceLabel: sourceLabel || getBiqSectionTitle(code),
      recordName: cleanDisplayText(recordName) || 'Unnamed',
      fields
    });
  };

  for (const spec of REFERENCE_TAB_SPECS) {
    const sectionCode = getSectionCodeForReferenceTabKey(spec.key);
    const tab = tabs[spec.key];
    if (!sectionCode || !tab || !Array.isArray(tab.entries)) continue;
    tab.entries.forEach((entry) => {
      pushRecord(sectionCode, spec.title, entry && (entry.name || entry.civilopediaKey), entry && entry.biqFields);
    });
  }

  for (const spec of BIQ_STRUCTURE_TAB_SPECS) {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.sections)) continue;
    tab.sections.forEach((section) => {
      const sectionCode = String(section && section.code || '').trim().toUpperCase();
      const sourceLabel = cleanDisplayText(section && section.title) || getBiqSectionTitle(sectionCode);
      (Array.isArray(section && section.records) ? section.records : []).forEach((record) => {
        pushRecord(sectionCode, sourceLabel, getBiqRecordDisplayName(record, `${sourceLabel} Record`), record && record.fields);
      });
    });
  }

  const mapTab = tabs.map;
  if (mapTab && Array.isArray(mapTab.sections)) {
    mapTab.sections.forEach((section) => {
      const sectionCode = String(section && section.code || '').trim().toUpperCase();
      const sourceLabel = getBiqSectionTitle(sectionCode);
      (Array.isArray(section && section.records) ? section.records : []).forEach((record, idx) => {
        pushRecord(sectionCode, sourceLabel, getBiqRecordDisplayName(record, `${sourceLabel} ${idx + 1}`), record && record.fields);
      });
    });
  }

  deleteOps.forEach((op) => {
    const sectionCode = String(op && op.sectionCode || '').trim().toUpperCase();
    const recordRef = String(op && op.recordRef || '').trim().toUpperCase();
    const ruleSet = dependencyRules[sectionCode];
    if (!sectionCode || !recordRef || !Array.isArray(ruleSet)) return;

    const original = getCurrentReferenceRecordInfo(tabs, sectionCode, recordRef)
      || getOriginalReferenceRecordInfo(biqTab, sectionCode, recordRef);
    if (!original || !Number.isFinite(original.index) || original.index < 0) return;
    if (ruleSet.length === 0) return;

    const matches = [];
    ruleSet.forEach((rule) => {
      const sourceRecords = recordsBySection.get(String(rule.sourceSection || '').trim().toUpperCase()) || [];
      sourceRecords.forEach((record) => {
        if (!Array.isArray(record.fields)) return;
        const context = {
          sectionCode: String(rule.sourceSection || '').trim().toUpperCase(),
          record
        };
        if (!record.fields.some((field) => matchesDeletedReference(field, original.index, rule.matcher, context))) return;
        matches.push(`${record.sourceLabel}: ${record.recordName}`);
      });
    });

    if (matches.length > 0) {
      const uniqueMatches = Array.from(new Set(matches));
      issues.push({
        title: `${original.name} (${getBiqSectionTitle(sectionCode).replace(/s$/, '')})`,
        references: uniqueMatches
      });
    }
  });

  return issues;
}

function formatUnsafeReferenceDeleteError(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return '';
  const lines = ['Cannot save yet because deleted items are still in use.'];
  issues.forEach((issue) => {
    if (!issue) return;
    if (issue.reason) {
      lines.push(`${issue.title}: ${issue.reason}`);
      return;
    }
    const refs = Array.isArray(issue.references) ? issue.references : [];
    const preview = refs.slice(0, 6).join('; ');
    const suffix = refs.length > 6 ? `; and ${refs.length - 6} more` : '';
    lines.push(`${issue.title}: still used by ${preview}${suffix}. Remove or replace those links, then try saving again.`);
  });
  return lines.join(' ');
}

function mergeTabsForDeleteValidation(baseTabs, payloadTabs) {
  const merged = { ...(baseTabs || {}) };
  Object.entries(payloadTabs || {}).forEach(([tabKey, payloadTab]) => {
    const baseTab = merged[tabKey];
    if (
      baseTab
      && typeof baseTab === 'object'
      && !Array.isArray(baseTab)
      && payloadTab
      && typeof payloadTab === 'object'
      && !Array.isArray(payloadTab)
    ) {
      merged[tabKey] = { ...baseTab, ...payloadTab };
      return;
    }
    merged[tabKey] = payloadTab;
  });
  return merged;
}

function hasPendingBiqOperationPayload(tabs) {
  const source = tabs || {};
  if (String(source.scenarioSettings && source.scenarioSettings.customRulesMutation || '').trim()) return true;
  if (String(source.players && source.players.customPlayerDataMutation || '').trim()) return true;
  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = source[spec.key];
    if (tab && Array.isArray(tab.recordOps) && tab.recordOps.length > 0) return true;
  }
  for (const spec of BIQ_STRUCTURE_TAB_SPECS) {
    const tab = source[spec.key];
    if (tab && Array.isArray(tab.recordOps) && tab.recordOps.length > 0) return true;
  }
  const mapTab = source.map;
  if (mapTab && Array.isArray(mapTab.recordOps) && mapTab.recordOps.length > 0) return true;
  if (String(mapTab && mapTab.mapMutation || '').trim()) return true;
  if (mapTab && mapTab.pendingMapResize && typeof mapTab.pendingMapResize === 'object') return true;
  return false;
}

function hasPendingBiqFieldEditPayload(tabs) {
  const source = tabs || {};
  return collectBiqReferenceEdits(source).length > 0
    || collectBiqStructureEdits(source).length > 0
    || collectBiqMapEdits(source).length > 0;
}

function getTabsForDirtyBiqCollection(tabs, options = {}) {
  const source = tabs || {};
  const dirtyTabs = options && options.dirtyTabs instanceof Set ? options.dirtyTabs : new Set();
  if (dirtyTabs.size === 0 || (options && options.includeAllFieldEdits)) return source;
  const out = {};
  const shouldIncludeOperationTab = (tabKey, tab) => {
    if (!tab) return false;
    if (tabKey === 'scenarioSettings' && String(tab.customRulesMutation || '').trim()) return true;
    if (tabKey === 'players' && String(tab.customPlayerDataMutation || '').trim()) return true;
    if (Array.isArray(tab.recordOps) && tab.recordOps.length > 0) return true;
    if (tabKey === 'map') {
      if (String(tab.mapMutation || '').trim()) return true;
      if (tab.pendingMapResize && typeof tab.pendingMapResize === 'object') return true;
    }
    return false;
  };
  Object.entries(source).forEach(([tabKey, tab]) => {
    if (dirtyTabs.has(tabKey) || shouldIncludeOperationTab(tabKey, tab)) {
      out[tabKey] = tab;
    }
  });
  return out;
}

function getBiqEditableRecordListForSection(biqTab, sectionCode) {
  const target = String(sectionCode || '').trim().toUpperCase();
  if (!biqTab || !Array.isArray(biqTab.sections) || !target) return [];
  const section = biqTab.sections.find((entry) => String(entry && entry.code || '').trim().toUpperCase() === target);
  if (!section) return [];
  if (Array.isArray(section.records) && section.records.length > 0) return section.records;
  return Array.isArray(section.fullRecords) ? section.fullRecords : [];
}

function findEditableBiqRecordForReferenceEntry(biqTab, sectionCode, entry) {
  const records = getBiqEditableRecordListForSection(biqTab, sectionCode);
  if (!Array.isArray(records) || records.length === 0) return null;
  const idx = Number(entry && entry.biqIndex);
  if (Number.isFinite(idx) && idx >= 0) {
    const indexed = records.find((record) => Number(record && record.index) === idx);
    if (indexed) return indexed;
    if (records[idx]) return records[idx];
  }
  const civKey = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
  if (!civKey) return null;
  return records.find((record) => String(getBiqRecordCivilopediaKey(record) || '').trim().toUpperCase() === civKey) || null;
}

function getDiskReferenceRawMapForEntry({ biqTab, sectionCode, tabKey, entry }) {
  const record = findEditableBiqRecordForReferenceEntry(biqTab, sectionCode, entry);
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  if (fields.length === 0) return null;
  if (tabKey === 'improvements') {
    const flavorCount = Number.isFinite(Number(entry && entry.improvementFlavorCount))
      ? Number(entry.improvementFlavorCount)
      : 0;
    return collapseImprovementBiqFields(fields, flavorCount, 'value');
  }
  if (tabKey === 'technologies') {
    const flavorCount = Number.isFinite(Number(entry && entry.technologyFlavorCount))
      ? Number(entry.technologyFlavorCount)
      : 0;
    return collapseTechnologyBiqFields(fields, flavorCount, 'value');
  }
  if (tabKey === 'resources') return collapseResourceBiqFields(fields, 'value');
  if (tabKey === 'governments') return collapseGovernmentBiqFields(fields, 'value');
  if (tabKey === 'civilizations') {
    const flavorCount = Number.isFinite(Number(entry && entry.civilizationFlavorCount))
      ? Number(entry.civilizationFlavorCount)
      : 0;
    return collapseCivilizationBiqFields(fields, flavorCount, 'value');
  }
  if (tabKey === 'units') return collapseUnitBiqFields(fields, 'value');
  return null;
}

function hasReferenceTargetMetaForRawKey(entry, rawKey) {
  const targetCanon = canonicalFieldKey(rawKey);
  if (!targetCanon || !Array.isArray(entry && entry.biqFields)) return false;
  return entry.biqFields.some((field) => {
    if (!field || canonicalFieldKey(field.baseKey || field.key) !== targetCanon) return false;
    return !!getFieldReferenceTarget(field) || getFieldReferenceTargets(field).length > 0;
  });
}

function collectCollapsedReferenceRawEdits({ edits, sectionCode, recordRef, entry, currentRaw, originalRaw, diskRaw }) {
  Object.keys(currentRaw || {}).forEach((rawKey) => {
    const value = cleanDisplayText(currentRaw[rawKey]);
    let originalValue = cleanDisplayText(originalRaw && originalRaw[rawKey]);
    if (value === originalValue
      && hasReferenceTargetMetaForRawKey(entry, rawKey)
      && diskRaw
      && Object.prototype.hasOwnProperty.call(diskRaw, rawKey)) {
      originalValue = cleanDisplayText(diskRaw[rawKey]);
    }
    if (value === originalValue) return;
    edits.push({
      sectionCode,
      recordRef,
      fieldKey: rawKey,
      value
    });
  });
}

function collectBiqReferenceEdits(tabs, options = {}) {
  const edits = [];
  const biqTab = options && options.biqTab;
  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.entries)) continue;
    const sectionCode = getSectionCodeForReferenceTabKey(spec.key);
    if (!sectionCode) continue;
    const beforeCount = edits.length;
    tab.entries.forEach((entry) => {
      const civKey = String(entry && entry.civilopediaKey || '').trim().toUpperCase();
      const recordRef = Number.isFinite(entry && entry.biqIndex)
        ? `@INDEX:${Number(entry.biqIndex)}`
        : civKey;
      if (!recordRef || !Array.isArray(entry.biqFields)) return;
      if (spec.key === 'improvements') {
        const flavorCount = Number.isFinite(Number(entry && entry.improvementFlavorCount))
          ? Number(entry.improvementFlavorCount)
          : 0;
        const currentRaw = collapseImprovementBiqFields(entry.biqFields, flavorCount, 'value');
        const originalRaw = collapseImprovementBiqFields(entry.biqFields, flavorCount, 'originalValue');
        collectCollapsedReferenceRawEdits({
          edits,
          sectionCode,
          recordRef,
          entry,
          currentRaw,
          originalRaw,
          diskRaw: getDiskReferenceRawMapForEntry({ biqTab, sectionCode, tabKey: spec.key, entry })
        });
        return;
      }
      if (spec.key === 'technologies') {
        const flavorCount = Number.isFinite(Number(entry && entry.technologyFlavorCount))
          ? Number(entry.technologyFlavorCount)
          : 0;
        const currentRaw = collapseTechnologyBiqFields(entry.biqFields, flavorCount, 'value');
        const originalRaw = collapseTechnologyBiqFields(entry.biqFields, flavorCount, 'originalValue');
        collectCollapsedReferenceRawEdits({
          edits,
          sectionCode,
          recordRef,
          entry,
          currentRaw,
          originalRaw,
          diskRaw: getDiskReferenceRawMapForEntry({ biqTab, sectionCode, tabKey: spec.key, entry })
        });
        return;
      }
      if (spec.key === 'resources') {
        const currentRaw = collapseResourceBiqFields(entry.biqFields, 'value');
        const originalRaw = collapseResourceBiqFields(entry.biqFields, 'originalValue');
        collectCollapsedReferenceRawEdits({
          edits,
          sectionCode,
          recordRef,
          entry,
          currentRaw,
          originalRaw,
          diskRaw: getDiskReferenceRawMapForEntry({ biqTab, sectionCode, tabKey: spec.key, entry })
        });
        return;
      }
      if (spec.key === 'governments') {
        const currentRaw = collapseGovernmentBiqFields(entry.biqFields, 'value');
        const originalRaw = collapseGovernmentBiqFields(entry.biqFields, 'originalValue');
        collectCollapsedReferenceRawEdits({
          edits,
          sectionCode,
          recordRef,
          entry,
          currentRaw,
          originalRaw,
          diskRaw: getDiskReferenceRawMapForEntry({ biqTab, sectionCode, tabKey: spec.key, entry })
        });
        return;
      }
      if (spec.key === 'civilizations') {
        const flavorCount = Number.isFinite(Number(entry && entry.civilizationFlavorCount))
          ? Number(entry.civilizationFlavorCount)
          : 0;
        const currentRaw = collapseCivilizationBiqFields(entry.biqFields, flavorCount, 'value');
        const originalRaw = collapseCivilizationBiqFields(entry.biqFields, flavorCount, 'originalValue');
        collectCollapsedReferenceRawEdits({
          edits,
          sectionCode,
          recordRef,
          entry,
          currentRaw,
          originalRaw,
          diskRaw: getDiskReferenceRawMapForEntry({ biqTab, sectionCode, tabKey: spec.key, entry })
        });
        return;
      }
      if (spec.key === 'units') {
        const currentRaw = collapseUnitBiqFields(entry.biqFields, 'value');
        const originalRaw = collapseUnitBiqFields(entry.biqFields, 'originalValue');
        const diskRaw = getDiskReferenceRawMapForEntry({ biqTab, sectionCode, tabKey: spec.key, entry });
        Object.keys(currentRaw).forEach((rawKey) => {
          const value = currentRaw[rawKey];
          const originalValue = originalRaw[rawKey];
          const valueText = Array.isArray(value) ? value.join(',') : cleanDisplayText(value);
          let originalText = Array.isArray(originalValue) ? originalValue.join(',') : cleanDisplayText(originalValue);
          if (valueText === originalText
            && hasReferenceTargetMetaForRawKey(entry, rawKey)
            && diskRaw
            && Object.prototype.hasOwnProperty.call(diskRaw, rawKey)) {
            const diskValue = diskRaw[rawKey];
            originalText = Array.isArray(diskValue) ? diskValue.join(',') : cleanDisplayText(diskValue);
          }
          if (valueText === originalText) return;
          edits.push({
            sectionCode,
            recordRef,
            fieldKey: rawKey,
            value: valueText
          });
        });
        return;
      }
      entry.biqFields.forEach((field) => {
        if (!field) return;
        const key = String((field && (field.baseKey || field.key)) || '').trim();
        if (!key || key.toLowerCase() === 'civilopediaentry') return;
        const value = cleanDisplayText(field && field.value);
        const originalValue = cleanDisplayText(field && field.originalValue);
        if (value === originalValue) return;
        edits.push({
          sectionCode,
          recordRef,
          fieldKey: key,
          value
        });
      });
    });
    const tabEdits = edits.length - beforeCount;
    if (tabEdits > 0) {
      log.debug('BiqCollect', `collectBiqReferenceEdits: ${sectionCode} (${spec.key}) — ${tabEdits} field edit(s)`);
    }
  }
  if (edits.length > 0) {
    log.info('BiqCollect', `collectBiqReferenceEdits total: ${edits.length} field edit(s) across reference tabs`);
    edits.forEach((e) => {
      const displayVal = String(e.value != null ? e.value : '').slice(0, 40);
      log.debug('BiqCollect', `  set ${e.sectionCode}[${e.recordRef}].${e.fieldKey} = "${displayVal}"`);
    });
  }
  return edits;
}

function collectBiqReferenceRecordOps(tabs) {
  const ops = [];
  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.recordOps) || tab.recordOps.length === 0) continue;
    const sectionCode = getSectionCodeForReferenceTabKey(spec.key);
    if (!sectionCode) continue;
    tab.recordOps.forEach((op) => {
      const kind = String(op && op.op || '').toLowerCase();
      if (kind === 'add') {
        const newRecordRef = String(op.newRecordRef || '').trim();
        if (!newRecordRef) return;
        const copyFromRef = String(op.copyFromRef || '').trim().toUpperCase();
        const sourceRef = String(op.sourceRef || '').trim().toUpperCase();
        const importArtFrom = String(op.importArtFrom || '').trim();
        const nextOp = {
          op: copyFromRef ? 'copy' : 'add',
          sectionCode,
          newRecordRef,
          copyFromRef
        };
        if (sourceRef) nextOp.sourceRef = sourceRef;
        if (importArtFrom) nextOp.importArtFrom = importArtFrom;
        ops.push(nextOp);
        if (copyFromRef) {
          log.debug('BiqCollect', `collectBiqReferenceRecordOps: op=copy ${sectionCode} ${copyFromRef} -> ${newRecordRef}${importArtFrom ? ' [importArt]' : ''}`);
        } else {
          log.debug('BiqCollect', `collectBiqReferenceRecordOps: op=add ${sectionCode} newRef=${newRecordRef}${importArtFrom ? ' [importArt]' : ''}`);
        }
        return;
      }
      if (kind === 'copy') {
        const sourceRef = String(op.sourceRef || '').trim().toUpperCase();
        const newRecordRef = String(op.newRecordRef || '').trim();
        if (!sourceRef || !newRecordRef) return;
        ops.push({
          op: 'copy',
          sectionCode,
          sourceRef,
          newRecordRef
        });
        log.debug('BiqCollect', `collectBiqReferenceRecordOps: op=copy ${sectionCode} ${sourceRef} -> ${newRecordRef}`);
        return;
      }
      if (kind === 'delete') {
        const recordRef = String(op.recordRef || '').trim().toUpperCase();
        if (!recordRef) return;
        ops.push({
          op: 'delete',
          sectionCode,
          recordRef
        });
        log.debug('BiqCollect', `collectBiqReferenceRecordOps: op=delete ${sectionCode} ref=${recordRef}`);
        return;
      }
      if (kind === 'reorder') {
        if (sectionCode !== 'PRTO') return;
        const order = Array.isArray(op.order)
          ? op.order
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0)
          : [];
        if (order.length === 0) return;
        ops.push({
          op: 'reorder',
          sectionCode,
          order
        });
        log.debug('BiqCollect', `collectBiqReferenceRecordOps: op=reorder ${sectionCode} count=${order.length}`);
      }
    });
  }
  if (ops.length > 0) {
    log.info('BiqCollect', `collectBiqReferenceRecordOps total: ${ops.length} record op(s)`);
  }
  return ops;
}

function resolveExternalImportedPrtoRecordOps(ops, civ3Path) {
  if (!Array.isArray(ops) || ops.length === 0) return [];
  const parsedCache = new Map();
  const loadParsedScenario = (scenarioPath) => {
    const key = String(scenarioPath || '').trim();
    if (!key) return null;
    if (parsedCache.has(key)) return parsedCache.get(key);
    const inflated = inflateBiqIfNeeded(key, civ3Path);
    if (!inflated.ok) {
      parsedCache.set(key, null);
      return null;
    }
    const parsed = parseAllSections(inflated.buffer);
    const value = parsed && parsed.ok ? parsed : null;
    parsedCache.set(key, value);
    return value;
  };
  const findExternalRecord = (parsed, sectionCode, recordRef) => {
    const code = String(sectionCode || '').trim().toUpperCase();
    const targetRef = String(recordRef || '').trim().toUpperCase();
    const section = ((parsed && parsed.sections) || []).find((entry) => String(entry && entry.code || '').trim().toUpperCase() === code);
    if (!section || !Array.isArray(section.records) || !targetRef) return null;
    return section.records.find((record) => String(record && record.civilopediaEntry || '').trim().toUpperCase() === targetRef) || null;
  };
  return ops.map((op) => {
    const kind = String(op && op.op || '').trim().toLowerCase();
    const sectionCode = String(op && op.sectionCode || '').trim().toUpperCase();
    const sourceScenarioPath = String(op && op.importArtFrom || '').trim();
    const sourceRef = String((op && (op.sourceRef || op.copyFromRef)) || '').trim().toUpperCase();
    if (kind !== 'add' || !sourceScenarioPath || !sourceRef) return op;
    const parsed = loadParsedScenario(sourceScenarioPath);
    const externalRecord = findExternalRecord(parsed, sectionCode, sourceRef);
    if (!externalRecord) return op;
    return {
      ...op,
      op: 'copy',
      externalRecord
    };
  });
}

function collectBiqStructureRecordOps(tabs) {
  const ops = [];
  BIQ_STRUCTURE_TAB_SPECS.forEach((spec) => {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.recordOps) || tab.recordOps.length === 0) return;
    tab.recordOps.forEach((op) => {
      const kind = String(op && op.op || '').toLowerCase();
      const sectionCode = String(op && op.sectionCode || '').trim().toUpperCase();
      if (!sectionCode) return;
      if (sectionCode === 'GAME') return;
      if (kind === 'add') {
        const newRecordRef = String(op.newRecordRef || '').trim().toUpperCase();
        if (!newRecordRef) return;
        const copyFromRef = String(op.copyFromRef || '').trim().toUpperCase();
        ops.push({
          op: copyFromRef ? 'copy' : 'add',
          sectionCode,
          newRecordRef,
          copyFromRef
        });
        if (copyFromRef) {
          log.debug('BiqCollect', `collectBiqStructureRecordOps: op=copy ${sectionCode} ${copyFromRef} -> ${newRecordRef}`);
        } else {
          log.debug('BiqCollect', `collectBiqStructureRecordOps: op=add ${sectionCode} newRef=${newRecordRef}`);
        }
        return;
      }
      if (kind === 'copy') {
        const sourceRef = String(op.sourceRef || op.copyFromRef || '').trim().toUpperCase();
        const newRecordRef = String(op.newRecordRef || '').trim().toUpperCase();
        if (!sourceRef || !newRecordRef) return;
        ops.push({
          op: 'copy',
          sectionCode,
          sourceRef,
          newRecordRef
        });
        log.debug('BiqCollect', `collectBiqStructureRecordOps: op=copy ${sectionCode} ${sourceRef} -> ${newRecordRef}`);
        return;
      }
      if (kind === 'delete') {
        const recordRef = String(op.recordRef || '').trim().toUpperCase();
        if (!recordRef) return;
        ops.push({
          op: 'delete',
          sectionCode,
          recordRef
        });
        log.debug('BiqCollect', `collectBiqStructureRecordOps: op=delete ${sectionCode} ref=${recordRef}`);
      }
    });
  });
  if (ops.length > 0) {
    log.info('BiqCollect', `collectBiqStructureRecordOps total: ${ops.length} record op(s)`);
  }
  return ops;
}

function collectBiqStructureEdits(tabs) {
  const edits = [];
  BIQ_STRUCTURE_TAB_SPECS.forEach((spec) => {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.sections)) return;
    tab.sections.forEach((section) => {
      const sectionCode = String((section && section.code) || '').trim().toUpperCase();
      if (!sectionCode || !Array.isArray(section.records)) return;
      const beforeCount = edits.length;
      section.records.forEach((record) => {
        const recordIndex = Number(record && record.index);
        const isNew = !!(record && record.newRecordRef);
        if ((!Number.isFinite(recordIndex) && !isNew) || !Array.isArray(record.fields)) return;
        record.fields.forEach((field) => {
          if (!field) return;
          const key = String((field.baseKey || field.key) || '').trim();
          if (!key) return;
          if (isLockedBiqField(sectionCode, key)) return;
          const keyLower = key.toLowerCase();
          if (keyLower === 'civilopediaentry' || keyLower === 'note') return;
          const value = cleanDisplayText(field.value);
          const originalValue = cleanDisplayText(field.originalValue);
          if (value === originalValue) return;
          edits.push({
            sectionCode,
            recordRef: isNew ? String(record.newRecordRef).trim().toUpperCase() : `@INDEX:${recordIndex}`,
            fieldKey: key,
            value
          });
        });
      });
      const sectionEdits = edits.length - beforeCount;
      if (sectionEdits > 0) {
        log.debug('BiqCollect', `collectBiqStructureEdits: ${sectionCode} — ${sectionEdits} field edit(s)`);
      }
    });
  });
  if (edits.length > 0) {
    log.info('BiqCollect', `collectBiqStructureEdits total: ${edits.length} field edit(s) across structure tabs`);
    edits.forEach((e) => {
      const displayVal = String(e.value != null ? e.value : '').slice(0, 40);
      log.debug('BiqCollect', `  set ${e.sectionCode}[${e.recordRef}].${e.fieldKey} = "${displayVal}"`);
    });
  }
  return edits;
}

function collectBiqMapRecordOps(tabs) {
  const ops = [];
  const tab = tabs && tabs.map;
  const mutation = String(tab && tab.mapMutation || '').trim().toLowerCase();
  if (mutation === 'set' || mutation === 'remove') return ops;
  if (!tab || !Array.isArray(tab.recordOps) || tab.recordOps.length === 0) return ops;
  tab.recordOps.forEach((op) => {
    const kind = String(op && op.op || '').toLowerCase();
    const sectionCode = String(op && op.sectionCode || '').trim().toUpperCase();
    if (!sectionCode) return;
    if (sectionCode === 'GAME') return;
    if (kind === 'add') {
      const newRecordRef = String(op.newRecordRef || '').trim().toUpperCase();
      if (!newRecordRef) return;
      const copyFromRef = String(op.copyFromRef || '').trim().toUpperCase();
      ops.push({
        op: copyFromRef ? 'copy' : 'add',
        sectionCode,
        newRecordRef,
        copyFromRef
      });
      return;
    }
    if (kind === 'copy') {
      const sourceRef = String(op.sourceRef || op.copyFromRef || '').trim().toUpperCase();
      const newRecordRef = String(op.newRecordRef || '').trim().toUpperCase();
      if (!sourceRef || !newRecordRef) return;
      ops.push({
        op: 'copy',
        sectionCode,
        sourceRef,
        newRecordRef
      });
      return;
    }
    if (kind === 'delete') {
      const recordRef = String(op.recordRef || '').trim().toUpperCase();
      if (!recordRef) return;
      ops.push({
        op: 'delete',
        sectionCode,
        recordRef
      });
      log.debug('BiqCollect', `collectBiqMapRecordOps: op=delete ${sectionCode} ref=${recordRef}`);
    }
  });
  if (ops.length > 0) {
    log.info('BiqCollect', `collectBiqMapRecordOps total: ${ops.length} record op(s)`);
  }
  return ops;
}

function collectBiqMapStructureOps(tabs) {
  const tab = tabs && tabs.map;
  if (!tab) return [];
  const mutation = String(tab.mapMutation || '').trim().toLowerCase();
  if (!mutation) {
    const resizeOp = getBiqMapResizeOp(tab);
    return resizeOp ? [resizeOp] : [];
  }
  if (mutation === 'remove') {
    return [{ op: 'removemap' }];
  }
  if (mutation !== 'set') return [];
  const mapSectionCodes = new Set(['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY']);
  const sections = (Array.isArray(tab.sections) ? tab.sections : [])
    .filter((section) => mapSectionCodes.has(String(section && section.code || '').trim().toUpperCase()))
    .map((section) => JSON.parse(JSON.stringify(section)));
  if (sections.length === 0) return [];
  return [{
    op: 'setmap',
    sections,
    allowSetmapGeneration: ['generated', 'imported', 'custom'].includes(String(tab && tab.mapMutationSource || '').trim().toLowerCase())
  }];
}

function getBiqMapResizeOp(tab) {
  if (!tab || String(tab.mapMutation || '').trim()) return null;
  if (tab.originalHasMap === false || tab.hasMapData === false) return null;
  const sections = Array.isArray(tab.sections) ? tab.sections : [];
  const wmapSection = sections.find((section) => String(section && section.code || '').trim().toUpperCase() === 'WMAP') || null;
  const record = wmapSection && Array.isArray(wmapSection.records) ? wmapSection.records[0] : null;
  if (!record || !Array.isArray(record.fields)) return null;
  const getField = (targetKey) => record.fields.find((field) => (
    String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === String(targetKey).trim().toLowerCase()
  )) || null;
  const parseIntLooseLocal = (value) => {
    const match = String(value == null ? '' : value).trim().match(/-?\d+/);
    if (!match) return NaN;
    const parsed = Number.parseInt(match[0], 10);
    return Number.isFinite(parsed) ? parsed : NaN;
  };
  const widthField = getField('width');
  const heightField = getField('height');
  const nextWidth = parseIntLooseLocal(widthField && widthField.value);
  const nextHeight = parseIntLooseLocal(heightField && heightField.value);
  const originalWidth = parseIntLooseLocal(widthField && widthField.originalValue);
  const originalHeight = parseIntLooseLocal(heightField && heightField.originalValue);
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || !Number.isFinite(originalWidth) || !Number.isFinite(originalHeight)) {
    return null;
  }
  if (nextWidth === originalWidth && nextHeight === originalHeight) return null;
  const pendingResize = tab && tab.pendingMapResize && typeof tab.pendingMapResize === 'object'
    ? tab.pendingMapResize
    : null;
  const pendingFillTerrain = pendingResize
    && Number(pendingResize.width) === nextWidth
    && Number(pendingResize.height) === nextHeight
    ? pendingResize.fillTerrain
    : null;
  const pendingHorizontalAnchor = pendingResize
    && Number(pendingResize.width) === nextWidth
    && Number(pendingResize.height) === nextHeight
    ? pendingResize.horizontalAnchor
    : null;
  const pendingVerticalAnchor = pendingResize
    && Number(pendingResize.width) === nextWidth
    && Number(pendingResize.height) === nextHeight
    ? pendingResize.verticalAnchor
    : null;
  const op = {
    op: 'resizemap',
    width: nextWidth,
    height: nextHeight,
    fillTerrain: pendingFillTerrain
  };
  if (pendingHorizontalAnchor != null) op.horizontalAnchor = pendingHorizontalAnchor;
  if (pendingVerticalAnchor != null) op.verticalAnchor = pendingVerticalAnchor;
  return op;
}

function collectBiqMapEdits(tabs) {
  const edits = [];
  const tab = tabs && tabs.map;
  const mutation = String(tab && tab.mapMutation || '').trim().toLowerCase();
  if (mutation === 'set' || mutation === 'remove') return edits;
  if (!tab || !Array.isArray(tab.sections)) return edits;
  const hasResizeOp = !!getBiqMapResizeOp(tab);
  const editableMapSections = new Set(['WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY']);
  const resizeManagedSections = new Set(['TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY']);
  const canonicalFieldKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const getDirectRecordValue = (record, key) => {
    if (!record || typeof record !== 'object') return undefined;
    const target = canonicalFieldKey(key);
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i += 1) {
      const candidate = keys[i];
      if (canonicalFieldKey(candidate) === target) return record[candidate];
    }
    return undefined;
  };
  const getRawMapFieldValue = (record, field) => {
    if (!field) return '';
    const originalValue = cleanDisplayText(field.originalValue);
    const direct = getDirectRecordValue(record, field.baseKey || field.key);
    if (field && field.mapEditorValueEdited) {
      return cleanDisplayText(field.value);
    }
    if (direct != null) return cleanDisplayText(direct);
    const fieldValue = cleanDisplayText(field.value);
    return fieldValue;
  };
  tab.sections.forEach((section) => {
    const sectionCode = String((section && section.code) || '').trim().toUpperCase();
    if (!editableMapSections.has(sectionCode)) return;
    if (!sectionCode || !Array.isArray(section.records)) return;
    section.records.forEach((record) => {
      const recordIndex = Number(record && record.index);
      const isNew = !!(record && record.newRecordRef);
      if ((!Number.isFinite(recordIndex) && !isNew) || !Array.isArray(record.fields)) return;
      record.fields.forEach((field) => {
        if (!field) return;
        const key = String((field.baseKey || field.key) || '').trim();
        if (!key) return;
        if (isLockedBiqField(sectionCode, key)) return;
        const keyLower = key.toLowerCase();
        if (sectionCode === 'WMAP' && (keyLower === 'width' || keyLower === 'height')) return;
        if (sectionCode === 'TILE' && ['district', 'districtname', 'wondername', 'wondercity', 'naturalwonder', 'namedtile'].includes(keyLower)) return;
        if (keyLower === 'civilopediaentry' || keyLower === 'note') return;
        if (hasResizeOp && resizeManagedSections.has(sectionCode) && !field.mapEditorValueEdited && !isNew) return;
        const value = getRawMapFieldValue(record, field);
        const originalValue = cleanDisplayText(field.originalValue);
        if (value === originalValue) return;
        edits.push({
          sectionCode,
          recordRef: isNew ? String(record.newRecordRef).trim().toUpperCase() : `@INDEX:${recordIndex}`,
          fieldKey: key,
          value
        });
      });
    });
  });
  if (edits.length > 0) {
    log.info('BiqCollect', `collectBiqMapEdits total: ${edits.length} map field edit(s)`);
  }
  return edits;
}

function collectCivilopediaReferenceEdits(tabs) {
  const edits = [];
  const deleted = new Set();
  const forcedUpserts = new Set();
  const upsert = (sectionKey, value, headerKey = '') => {
    const key = String(sectionKey || '').trim().toUpperCase();
    if (!key) return;
    if (deleted.has(key)) return;
    const normalizedValue = normalizeCivilopediaTextValue(value);
    const existing = edits.find((entry) => entry.sectionKey === key);
    if (existing) {
      existing.op = 'upsert';
      existing.value = normalizedValue;
      if (headerKey) existing.headerKey = String(headerKey).trim();
      return;
    }
    edits.push({ op: 'upsert', sectionKey: key, headerKey: String(headerKey || sectionKey).trim() || key, value: normalizedValue });
  };
  const del = (sectionKey) => {
    const key = String(sectionKey || '').trim().toUpperCase();
    if (!key) return;
    deleted.add(key);
    const existing = edits.find((entry) => entry.sectionKey === key);
    if (existing) {
      existing.op = 'delete';
      delete existing.value;
      return;
    }
    edits.push({ op: 'delete', sectionKey: key });
  };

  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.entries)) continue;
    if (Array.isArray(tab.recordOps)) {
      tab.recordOps.forEach((op) => {
        const kind = String(op && op.op || '').toLowerCase();
        if (kind === 'delete') {
          const key = String(op && op.recordRef || '').trim().toUpperCase();
          if (!key) return;
          del(key);
          del(`DESC_${key}`);
          return;
        }
        if (kind === 'rename') {
          const oldKey = String(op && op.recordRef || '').trim().toUpperCase();
          const newKey = String(op && op.newRecordRef || '').trim().toUpperCase();
          if (!oldKey || !newKey) return;
          del(oldKey);
          del(`DESC_${oldKey}`);
          forcedUpserts.add(newKey);
          forcedUpserts.add(`DESC_${newKey}`);
        }
      });
    }
    tab.entries.forEach((entry) => {
      const key = String(entry && (entry.lookupCivilopediaKey || entry.civilopediaKey) || '').trim().toUpperCase();
      if (!key) return;
      const headerKey = String(entry && (entry.rawCivilopediaKey || entry.linkCivilopediaKey || entry.civilopediaKey) || key).trim();
      const section1 = normalizeCivilopediaTextValue(entry && entry.civilopediaSection1);
      const originalSection1 = normalizeCivilopediaTextValue(entry && entry.originalCivilopediaSection1);
      if (section1 !== originalSection1 || forcedUpserts.has(key)) {
        upsert(key, section1, headerKey);
      }
      const section2 = normalizeCivilopediaTextValue(entry && entry.civilopediaSection2);
      const originalSection2 = normalizeCivilopediaTextValue(entry && entry.originalCivilopediaSection2);
      if (section2 !== originalSection2 || forcedUpserts.has(`DESC_${key}`)) {
        upsert(`DESC_${key}`, section2, `DESC_${headerKey}`);
      }
    });
  }
  const terrainTab = tabs && tabs.terrain;
  const terrainCivilopedia = terrainTab && terrainTab.civilopedia;
  const nestedTabs = [
    terrainCivilopedia && terrainCivilopedia.terrain,
    terrainCivilopedia && terrainCivilopedia.workerActions
  ].filter(Boolean);
  nestedTabs.forEach((tab) => {
    if (!Array.isArray(tab.entries)) return;
    tab.entries.forEach((entry) => {
      const key = String(entry && (entry.lookupCivilopediaKey || entry.civilopediaKey) || '').trim().toUpperCase();
      if (!key) return;
      const headerKey = String(entry && (entry.rawCivilopediaKey || entry.linkCivilopediaKey || entry.civilopediaKey) || key).trim();
      const section1 = normalizeCivilopediaTextValue(entry && entry.civilopediaSection1);
      const originalSection1 = normalizeCivilopediaTextValue(entry && entry.originalCivilopediaSection1);
      if (section1 !== originalSection1) {
        upsert(key, section1, headerKey);
      }
      const section2 = normalizeCivilopediaTextValue(entry && entry.civilopediaSection2);
      const originalSection2 = normalizeCivilopediaTextValue(entry && entry.originalCivilopediaSection2);
      if (section2 !== originalSection2) {
        upsert(`DESC_${key}`, section2, `DESC_${headerKey}`);
      }
    });
  });
  return edits;
}

function collectDiplomacyReferenceEdits(tabs) {
  const civTab = tabs && tabs.civilizations;
  if (!civTab) return [];
  const rawText = String(civTab.diplomacyText || '');
  const originalRawText = String(civTab.originalDiplomacyText || '');
  if (rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n') !== originalRawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')) {
    return [{ op: 'replace', text: rawText }];
  }
  if (!Array.isArray(civTab.diplomacySlots)) return [];
  const edits = [];
  civTab.diplomacySlots.forEach((slot) => {
    const index = Number(slot && slot.index);
    if (!Number.isFinite(index) || index < 0) return;
    const firstContact = normalizeDiplomacyDialogueLine(slot && slot.firstContact);
    const originalFirstContact = normalizeDiplomacyDialogueLine(slot && slot.originalFirstContact);
    const firstDeal = normalizeDiplomacyDialogueLine(slot && slot.firstDeal);
    const originalFirstDeal = normalizeDiplomacyDialogueLine(slot && slot.originalFirstDeal);
    if (firstContact !== originalFirstContact || firstDeal !== originalFirstDeal) {
      edits.push({
        index,
        firstContact,
        firstDeal
      });
    }
  });
  edits.sort((a, b) => a.index - b.index);
  return edits;
}

function normalizePediaPathList(values) {
  return dedupeStrings(
    (Array.isArray(values) ? values : [])
      .map((v) => normalizeAssetReferencePath(v))
      .filter(Boolean)
  );
}

function normalizeRaceIconPathsForSave(values, entry) {
  const paths = normalizeRaceIconPaths(values);
  const racePaths = (Array.isArray(entry && entry.racePaths) ? entry.racePaths : [])
    .map((v) => normalizeAssetReferencePath(v))
    .filter(Boolean);
  while (paths.length > 2) {
    const index = paths.length - 1;
    const fallback = normalizeAssetReferencePath(racePaths[index - 2] || '');
    if (!fallback || paths[index].toLowerCase() !== fallback.toLowerCase()) break;
    paths.pop();
  }
  return paths;
}

function collectPediaIconsReferenceEdits(tabs) {
  const edits = [];
  const blank = (blockKey) => {
    const key = String(blockKey || '').trim().toUpperCase();
    if (!key) return;
    edits.push({ op: 'delete', blockKey: key });
  };
  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = tabs[spec.key];
    if (!tab) continue;
    if (Array.isArray(tab.recordOps)) {
      tab.recordOps.forEach((op) => {
        const kind = String(op && op.op || '').trim().toLowerCase();
        const key = String(op && op.recordRef || '').trim().toUpperCase();
        if (kind !== 'delete' && kind !== 'rename') return;
        if (!key) return;
        const shortKey = key.replace(/^(RACE_|TECH_|GOOD_|BLDG_|GOVT_|PRTO_)/, '');
        if (key.startsWith('TECH_')) {
          blank(key);
          blank(`${key}_LARGE`);
        } else {
          blank(`ICON_${key}`);
        }
        if (key.startsWith('RACE_')) {
          blank(`ICON_RACE_${shortKey}`);
          blank(key);
        }
        if (key.startsWith('PRTO_')) {
          blank(`ANIMNAME_${key}`);
        }
        if (key.startsWith('BLDG_')) {
          blank(`WON_SPLASH_${key}`);
        }
      });
    }
    if (!Array.isArray(tab.entries)) continue;
    tab.entries.forEach((entry) => {
      const key = String(
        entry && (
          entry.rawBiqCivilopediaKey
          || entry.displayCivilopediaKey
          || entry.linkCivilopediaKey
          || entry.rawCivilopediaKey
          || entry.civilopediaKey
        ) || ''
      ).trim();
      const lookupKey = String(entry && (entry.lookupCivilopediaKey || entry.civilopediaKey) || key).trim().toUpperCase();
      if (!key || !lookupKey) return;
      const shortKey = lookupKey.replace(/^(RACE_|TECH_|GOOD_|BLDG_|GOVT_|PRTO_)/, '');
      const importedFromScenario = !!String(entry && entry._importScenarioPath || '').trim();
      const shouldForceImportedPedia = importedFromScenario && !!(entry && entry.isNew);
      const shouldForcePediaIconsBlock = !!(entry && entry.forcePediaIconsBlockWrite);
      const isBuildingIcon = lookupKey.startsWith('BLDG_');
      const isRaceIcon = lookupKey.startsWith('RACE_');
      const normalizeIconPathsForEntry = (values) => isBuildingIcon
        ? (Array.isArray(values) ? values : []).map((v) => normalizeAssetReferencePath(v)).filter(Boolean)
        : (isRaceIcon ? normalizeRaceIconPathsForSave(values, entry) : normalizePediaPathList(values));
      const normalizeOriginalIconPathsForEntry = (values) => isBuildingIcon
        ? (Array.isArray(values) ? values : []).map((v) => normalizeAssetReferencePath(v)).filter(Boolean)
        : normalizePediaPathList(values);
      const nextIconPaths = normalizeIconPathsForEntry(entry && entry.iconPaths);
      const prevIconPaths = shouldForceImportedPedia || shouldForcePediaIconsBlock
        ? []
        : normalizeOriginalIconPathsForEntry(entry && entry.originalIconPaths);
      if (JSON.stringify(nextIconPaths) !== JSON.stringify(prevIconPaths)) {
        if (lookupKey.startsWith('TECH_')) {
          const large = nextIconPaths[0] || '';
          const small = nextIconPaths[1] || nextIconPaths[0] || '';
          edits.push({ blockKey: key, lines: small ? [small] : [] });
          edits.push({ blockKey: `${key}_LARGE`, lines: large ? [large] : [] });
        } else if (lookupKey.startsWith('BLDG_')) {
          edits.push({ blockKey: `ICON_${key}`, lines: buildBuildingIconLines(entry, nextIconPaths) });
        } else {
          edits.push({ blockKey: `ICON_${key}`, lines: nextIconPaths });
        }
      }

      if (lookupKey.startsWith('BLDG_')) {
        const nextKind = String(entry && entry.buildingIconKind || '').trim();
        const prevKind = String(entry && entry.originalBuildingIconKind || '').trim();
        const nextIndex = String(entry && entry.buildingIconIndex || '').trim();
        const prevIndex = String(entry && entry.originalBuildingIconIndex || '').trim();
        if ((shouldForceImportedPedia || shouldForcePediaIconsBlock || nextKind !== prevKind || nextIndex !== prevIndex)
          && JSON.stringify(nextIconPaths) === JSON.stringify(prevIconPaths)) {
          edits.push({ blockKey: `ICON_${key}`, lines: buildBuildingIconLines(entry, nextIconPaths) });
        }
        const nextSplash = normalizeAssetReferencePath(entry && entry.wonderSplashPath);
        const prevSplash = shouldForceImportedPedia
          ? ''
          : normalizeAssetReferencePath(entry && entry.originalWonderSplashPath);
        if (nextSplash !== prevSplash) {
          if (nextSplash) edits.push({ blockKey: `WON_SPLASH_${key}`, lines: [nextSplash] });
          else edits.push({ op: 'delete', blockKey: `WON_SPLASH_${key}` });
        }
      }

      const nextRacePaths = normalizePediaPathList(entry && entry.racePaths);
      const prevRacePaths = shouldForceImportedPedia
        ? []
        : normalizePediaPathList(entry && entry.originalRacePaths);
      if (JSON.stringify(nextRacePaths) !== JSON.stringify(prevRacePaths) && lookupKey.startsWith('RACE_')) {
        edits.push({ blockKey: key, lines: nextRacePaths });
      }

      const nextAnim = normalizeAssetReferencePath(entry && entry.animationName);
      const prevAnim = shouldForceImportedPedia
        ? ''
        : normalizeAssetReferencePath(entry && entry.originalAnimationName);
      if (nextAnim !== prevAnim && lookupKey.startsWith('PRTO_')) {
        edits.push({ blockKey: `ANIMNAME_${key}`, lines: nextAnim ? [nextAnim] : [] });
      }
    });
  }
  const merged = new Map();
  edits.forEach((edit) => {
    const k = String(edit.blockKey || '').trim().toUpperCase();
    if (!k) return;
    const op = String(edit.op || 'upsert').trim().toLowerCase();
    merged.set(k, op === 'delete'
      ? { op: 'delete', blockKey: k }
      : { blockKey: String(edit.blockKey || '').trim(), lines: normalizePediaIconsLines(edit.lines) });
  });
  return Array.from(merged.values());
}

function pickScenarioReferenceArtTargetRelativePath({ tabKey, group, index = -1, originalPath, sourcePath, targetContentRoot, forcePcx = false }) {
  const normalizedOriginal = normalizeAssetReferencePath(originalPath);
  const absSource = String(sourcePath || '').trim();
  const rawBaseName = path.basename(absSource || normalizedOriginal || '');
  const baseName = applyReferenceArtDefaultFileNameSuffix(
    forcePcx ? rawBaseName.replace(/\.[^.\\/]+$/i, '.pcx') : rawBaseName,
    tabKey,
    group,
    index
  );
  if (!baseName) return '';
  if (normalizedOriginal && !isAbsoluteFilesystemPath(normalizedOriginal)) {
    const originalDir = normalizeRelativePath(path.posix.dirname(normalizedOriginal));
    const shouldPreserveOriginalDir = originalDir && originalDir !== '.' &&
      isExpectedReferenceArtDirectory(tabKey, group, index, originalDir);
    if (shouldPreserveOriginalDir) {
      return normalizeRelativePath(path.posix.join(originalDir, baseName));
    }
  }
  if (tabKey === 'civilizations' && group === 'iconPaths') {
    return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Races', baseName));
  }
  if (tabKey === 'civilizations' && group === 'racePaths') {
    if (Number(index) === 0) {
      return normalizeRelativePath(path.join('Art', 'Leaderheads', baseName));
    }
    return normalizeRelativePath(path.join('Art', 'Advisors', baseName));
  }
  if (tabKey === 'improvements' && group === 'wonderSplashPath') {
    return normalizeRelativePath(path.join('Art', 'Wonder Splash', baseName));
  }
  if (tabKey === 'improvements' && group === 'iconPaths') {
    return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Buildings', baseName));
  }
  if (tabKey === 'technologies' && group === 'iconPaths') {
    return normalizeRelativePath(path.join('Art', 'tech chooser', 'Icons', baseName));
  }
  if (tabKey === 'units' && group === 'iconPaths') {
    return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Units', baseName));
  }
  if (tabKey === 'resources' && group === 'iconPaths') {
    return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Resources', baseName));
  }
  if (tabKey === 'governments' && group === 'iconPaths') {
    return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Governments', baseName));
  }
  return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', baseName));
}

function getExpectedReferenceArtDirectory(tabKey, group, index) {
  if (tabKey === 'civilizations' && group === 'iconPaths') return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Races'));
  if (tabKey === 'civilizations' && group === 'racePaths') {
    return normalizeRelativePath(Number(index) === 0 ? path.join('Art', 'Leaderheads') : path.join('Art', 'Advisors'));
  }
  if (tabKey === 'improvements' && group === 'wonderSplashPath') return normalizeRelativePath(path.join('Art', 'Wonder Splash'));
  if (tabKey === 'improvements' && group === 'iconPaths') return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Buildings'));
  if (tabKey === 'technologies' && group === 'iconPaths') return normalizeRelativePath(path.join('Art', 'tech chooser', 'Icons'));
  if (tabKey === 'units' && group === 'iconPaths') return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Units'));
  if (tabKey === 'resources' && group === 'iconPaths') return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Resources'));
  if (tabKey === 'governments' && group === 'iconPaths') return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons', 'Governments'));
  return normalizeRelativePath(path.join('Art', 'Civilopedia', 'Icons'));
}

function isExpectedReferenceArtDirectory(tabKey, group, index, dir) {
  const expected = getExpectedReferenceArtDirectory(tabKey, group, index).toLowerCase();
  const actual = normalizeRelativePath(dir).toLowerCase();
  return !!expected && actual === expected;
}

function getScenarioRelativePathForAbsoluteSource(sourcePath, targetContentRoot) {
  const absSource = String(sourcePath || '').trim();
  const absRoot = String(targetContentRoot || '').trim();
  if (!absSource || !absRoot) return '';
  const rel = normalizeRelativePath(path.relative(absRoot, absSource));
  if (!rel || rel.startsWith('../') || rel === '..') return '';
  return rel;
}

function stripScenarioFolderPrefixFromRelativeArtPath(rawPath, candidateFolderNames = []) {
  const normalized = normalizeRelativePath(rawPath);
  if (!normalized) return '';
  const lowerNormalized = normalized.toLowerCase();
  for (const candidate of candidateFolderNames) {
    const prefix = normalizeRelativePath(candidate);
    if (!prefix) continue;
    const lowerPrefix = prefix.toLowerCase();
    if (!lowerNormalized.startsWith(`${lowerPrefix}/`)) continue;
    const remainder = normalized.slice(prefix.length + 1);
    if (/^(art|text)\//i.test(remainder)) {
      return remainder;
    }
  }
  return normalized;
}

function normalizeScenarioRelativeArtReferencePath(rawPath, entry, targetContentRoot) {
  const normalized = normalizeAssetReferencePath(rawPath);
  if (!normalized || isAbsoluteFilesystemPath(normalized)) return normalized;
  const candidates = [];
  const targetBaseName = path.basename(String(targetContentRoot || '').trim());
  if (targetBaseName) candidates.push(targetBaseName);
  const importScenarioPath = String(entry && entry._importScenarioPath || '').trim();
  if (importScenarioPath) {
    const importScenarioDirName = path.basename(resolveScenarioDir(importScenarioPath));
    const importScenarioStem = path.parse(importScenarioPath).name;
    if (importScenarioDirName) candidates.push(importScenarioDirName);
    if (importScenarioStem) candidates.push(importScenarioStem);
  }
  return stripScenarioFolderPrefixFromRelativeArtPath(normalized, candidates);
}

function getPendingReferenceArtSource(entry, group, index = 0) {
  if (!entry || !entry.pendingArtSources || typeof entry.pendingArtSources !== 'object') return '';
  const key = `${String(group || '').trim()}:${Number.isFinite(Number(index)) ? Number(index) : 0}`;
  return normalizeAssetReferencePath(entry.pendingArtSources[key]);
}

function getPendingReferenceArtConversion(entry, group, index = 0) {
  if (!entry || !entry.pendingArtConversions || typeof entry.pendingArtConversions !== 'object') return null;
  const key = `${String(group || '').trim()}:${Number.isFinite(Number(index)) ? Number(index) : 0}`;
  const conversion = entry.pendingArtConversions[key];
  return conversion && typeof conversion === 'object' ? conversion : null;
}

function getPendingLeaderAnimationSource(entry, fieldKey) {
  if (!entry || !entry.pendingLeaderAnimationSources || typeof entry.pendingLeaderAnimationSources !== 'object') return '';
  return normalizeAssetReferencePath(entry.pendingLeaderAnimationSources[String(fieldKey || '').trim().toLowerCase()]);
}

function getPendingLeaderAnimationConversion(entry, fieldKey) {
  if (!entry || !entry.pendingLeaderAnimationConversions || typeof entry.pendingLeaderAnimationConversions !== 'object') return null;
  const conversion = entry.pendingLeaderAnimationConversions[String(fieldKey || '').trim().toLowerCase()];
  return conversion && typeof conversion === 'object' ? conversion : null;
}

function buildPendingLeaderAnimationConversionBuffer(conversion) {
  if (!conversion || !conversion.rgbaBase64) return null;
  return encodeRgbaToLeaderFlc(
    Buffer.from(String(conversion.rgbaBase64), 'base64'),
    Number(conversion.width) || 200,
    Number(conversion.height) || 240,
    {
      frameCount: Number(conversion.frameCount) || 30,
      speedMs: Number(conversion.speedMs) || 66
    }
  );
}

function buildPendingReferenceArtConversionBuffer(conversion, targetSize = null) {
  if (!conversion) return null;
  const sourcePath = normalizeAssetReferencePath(conversion.sourcePath);
  if (/\.pcx$/i.test(sourcePath)) {
    try {
      const decoded = decodePcx(sourcePath, { returnIndexed: true, transparentIndexes: [] });
      const targetWidth = Number(targetSize && targetSize.width);
      const targetHeight = Number(targetSize && targetSize.height);
      const matchesTarget = Number.isFinite(targetWidth) && Number.isFinite(targetHeight) &&
        Number(decoded.width) === targetWidth &&
        Number(decoded.height) === targetHeight;
      if (matchesTarget && !decoded.trueColor) {
        return fs.readFileSync(sourcePath);
      }
    } catch (_err) {
      // Fall back to the staged conversion buffer below.
    }
  }
  if (conversion.pcxBase64) return Buffer.from(String(conversion.pcxBase64), 'base64');
  if (conversion.rgbaBase64) {
    return encodeRgbaToPcx(
      Buffer.from(String(conversion.rgbaBase64), 'base64'),
      Number(conversion.width),
      Number(conversion.height)
    );
  }
  return null;
}

function resizeRgbaCover(sourceRgba, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sw = Math.max(1, Number(sourceWidth) | 0);
  const sh = Math.max(1, Number(sourceHeight) | 0);
  const tw = Math.max(1, Number(targetWidth) | 0);
  const th = Math.max(1, Number(targetHeight) | 0);
  const out = new Uint8Array(tw * th * 4);
  const scale = Math.max(tw / sw, th / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const ox = Math.floor((tw - dw) / 2);
  const oy = Math.floor((th - dh) / 2);
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const dstOff = (y * tw + x) * 4;
      const sx = Math.min(sw - 1, Math.max(0, Math.floor((x - ox + 0.5) / scale)));
      const sy = Math.min(sh - 1, Math.max(0, Math.floor((y - oy + 0.5) / scale)));
      const srcOff = (sy * sw + sx) * 4;
      out[dstOff] = sourceRgba[srcOff];
      out[dstOff + 1] = sourceRgba[srcOff + 1];
      out[dstOff + 2] = sourceRgba[srcOff + 2];
      out[dstOff + 3] = sourceRgba[srcOff + 3];
    }
  }
  return out;
}

function getImprovementArtRowCountForSave(entry) {
  const kind = String(entry && entry.buildingIconKind || '').trim().toUpperCase();
  if (kind === 'ERA') return 4;
  if (kind === 'CULTURE') return 5;
  return 1;
}

function getReferenceArtTargetSizeForSave({ tabKey, group, index = 0, entry }) {
  if (tabKey === 'civilizations' && (
    (group === 'iconPaths' && Number(index) === 3) ||
    (group === 'racePaths' && Number(index) === 1)
  )) {
    return { width: 461, height: 346 };
  }
  if (group === 'wonderSplashPath') return { width: 320, height: 320 };
  if (group === 'iconPaths') {
    if (tabKey === 'improvements' && Number(index) >= getImprovementArtRowCountForSave(entry)) {
      return { width: 32, height: 32 };
    }
    if (tabKey !== 'improvements' && Number(index) === 1) {
      return { width: 32, height: 32 };
    }
  }
  return { width: 128, height: 128 };
}

function buildLocalizedArtBufferFromSource(sourcePath, targetSize = null) {
  if (/\.pcx$/i.test(String(sourcePath || ''))) {
    try {
      const decoded = decodePcx(sourcePath, { returnIndexed: true, transparentIndexes: [] });
      const targetWidth = Number(targetSize && targetSize.width);
      const targetHeight = Number(targetSize && targetSize.height);
      const shouldResize = Number.isFinite(targetWidth) && Number.isFinite(targetHeight) &&
        (Number(decoded.width) !== targetWidth || Number(decoded.height) !== targetHeight);
      if (decoded && (decoded.trueColor || shouldResize)) {
        const rgba = shouldResize
          ? resizeRgbaCover(decoded.rgba, decoded.width, decoded.height, targetWidth, targetHeight)
          : decoded.rgba;
        return encodeRgbaToPcx(
          rgba,
          shouldResize ? targetWidth : decoded.width,
          shouldResize ? targetHeight : decoded.height
        );
      }
    } catch (_err) {
      // Preserve legacy behavior for placeholder or externally managed PCX files:
      // copy unreadable PCX bytes instead of blocking unrelated save flows.
    }
  }
  return fs.readFileSync(sourcePath);
}

function localizeScenarioReferenceArtAssets({ tabs, targetContentRoot, plannedWrites, saveReport }) {
  if (!targetContentRoot || !tabs) return { ok: true };
  const queued = new Map();
  const queuedKeys = new Map();
  const canonicalTargetKey = (targetPath) => path.resolve(String(targetPath || '')).toLowerCase();
  const buffersEqual = (a, b) => {
    const left = Buffer.isBuffer(a) ? a : Buffer.from(a || []);
    const right = Buffer.isBuffer(b) ? b : Buffer.from(b || []);
    return left.length === right.length && Buffer.compare(left, right) === 0;
  };
  const appendRelativePathSuffix = (relTarget, suffix, attempt) => {
    const normalized = normalizeRelativePath(relTarget);
    const ext = path.posix.extname(normalized) || '.pcx';
    const dir = path.posix.dirname(normalized);
    const stem = path.posix.basename(normalized, ext);
    const numberedSuffix = attempt > 0 ? `${suffix}_${attempt + 1}` : suffix;
    const nextBase = appendFileNameStemSuffix(`${stem}${ext}`, numberedSuffix);
    return normalizeRelativePath(dir && dir !== '.' ? path.posix.join(dir, nextBase) : nextBase);
  };
  const reserveRelativeArtTarget = (relTarget, data, context = {}) => {
    let candidate = normalizeRelativePath(relTarget);
    if (!candidate) return '';
    const suffix = getReferenceArtCollisionSuffix(context.tabKey, context.group, context.index);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const targetPath = path.join(targetContentRoot, candidate.replace(/\//g, path.sep));
      const key = canonicalTargetKey(targetPath);
      const existingPath = queuedKeys.get(key);
      if (!existingPath) {
        queuedKeys.set(key, targetPath);
        return candidate;
      }
      if (buffersEqual(queued.get(existingPath), data)) return candidate;
      candidate = appendRelativePathSuffix(relTarget, suffix, attempt);
    }
    throw new Error(`Multiple referenced art files resolved to the same target path: ${relTarget}`);
  };
  const queueFileWrite = (targetPath, data) => {
    const key = String(targetPath || '');
    if (!key) return;
    queued.set(key, data);
  };
  for (const spec of REFERENCE_TAB_SPECS) {
    const tab = tabs[spec.key];
    if (!tab || !Array.isArray(tab.entries)) continue;
    tab.entries.forEach((entry) => {
      const groups = [
        ['iconPaths', 'originalIconPaths'],
        ['racePaths', 'originalRacePaths']
      ];
      groups.forEach(([fieldKey, originalFieldKey]) => {
        const sourceValues = Array.isArray(entry && entry[fieldKey]) ? [...entry[fieldKey]] : [];
        const originalValues = Array.isArray(entry && entry[originalFieldKey]) ? entry[originalFieldKey] : [];
        let changed = false;
        sourceValues.forEach((rawValue, index) => {
          const pendingConversion = getPendingReferenceArtConversion(entry, fieldKey, index);
          const pendingSource = getPendingReferenceArtSource(entry, fieldKey, index);
          const normalized = normalizeScenarioRelativeArtReferencePath(rawValue, entry, targetContentRoot);
          if (!normalized) return;
          if (pendingConversion) {
            const targetSize = getReferenceArtTargetSizeForSave({
              tabKey: spec.key,
              group: fieldKey,
              index,
              entry
            });
            const sourceRelativePath = getScenarioRelativePathForAbsoluteSource(
              String(pendingConversion.sourcePath || pendingSource || ''),
              targetContentRoot
            );
            const normalizedRelative = !isAbsoluteFilesystemPath(normalized) ? normalizeRelativePath(normalized) : '';
            const shouldUseExpectedTarget = !normalizedRelative || (
              sourceRelativePath && normalizedRelative.toLowerCase() === sourceRelativePath.toLowerCase()
            );
            const relTarget = shouldUseExpectedTarget
              ? pickScenarioReferenceArtTargetRelativePath({
                tabKey: spec.key,
                group: fieldKey,
                index,
                originalPath: originalValues[index],
                sourcePath: String(pendingConversion.sourcePath || pendingSource || ''),
                targetContentRoot,
                forcePcx: true
              })
              : normalizedRelative;
            const data = buildPendingReferenceArtConversionBuffer(pendingConversion, targetSize);
            if (!relTarget || !data) {
              throw new Error(`Could not convert referenced art file: ${String(pendingConversion.sourcePath || pendingSource || rawValue)}`);
            }
            const actualRelTarget = reserveRelativeArtTarget(relTarget, data, {
              tabKey: spec.key,
              group: fieldKey,
              index
            });
            const targetPath = path.join(targetContentRoot, actualRelTarget.replace(/\//g, path.sep));
            queueFileWrite(targetPath, data);
            if (sourceValues[index] !== actualRelTarget) {
              sourceValues[index] = actualRelTarget;
              changed = true;
            }
            return;
          }
          if (pendingSource && isAbsoluteFilesystemPath(pendingSource)) {
            let stats = null;
            try {
              stats = fs.statSync(pendingSource);
            } catch (_err) {
              stats = null;
            }
            if (!stats || !stats.isFile()) {
              throw new Error(`Referenced art file does not exist: ${pendingSource}`);
            }
            const sourceRelativePath = getScenarioRelativePathForAbsoluteSource(pendingSource, targetContentRoot);
            const normalizedRelative = !isAbsoluteFilesystemPath(normalized) ? normalizeRelativePath(normalized) : '';
            const shouldUseExpectedTarget = !normalizedRelative || (
              sourceRelativePath && normalizedRelative.toLowerCase() === sourceRelativePath.toLowerCase()
            );
            const relTarget = shouldUseExpectedTarget
              ? pickScenarioReferenceArtTargetRelativePath({
                tabKey: spec.key,
                group: fieldKey,
                index,
                originalPath: originalValues[index],
                sourcePath: pendingSource,
                targetContentRoot
              })
              : normalizedRelative;
            if (!relTarget) {
              throw new Error(`Could not determine scenario-relative target for art file: ${pendingSource}`);
            }
            const data = buildLocalizedArtBufferFromSource(pendingSource, getReferenceArtTargetSizeForSave({
              tabKey: spec.key,
              group: fieldKey,
              index,
              entry
            }));
            const actualRelTarget = reserveRelativeArtTarget(relTarget, data, {
              tabKey: spec.key,
              group: fieldKey,
              index
            });
            const targetPath = path.join(targetContentRoot, actualRelTarget.replace(/\//g, path.sep));
            queueFileWrite(targetPath, data);
            if (sourceValues[index] !== actualRelTarget) {
              sourceValues[index] = actualRelTarget;
              changed = true;
            }
            return;
          }
          if (!isAbsoluteFilesystemPath(normalized)) {
            const currentValue = normalizeAssetReferencePath(rawValue);
            if (normalized !== currentValue) {
              sourceValues[index] = normalized;
              changed = true;
            }
            return;
          }
          let stats = null;
          try {
            stats = fs.statSync(normalized);
          } catch (_err) {
            stats = null;
          }
          if (!stats || !stats.isFile()) {
            throw new Error(`Referenced art file does not exist: ${normalized}`);
          }
          const relTarget = pickScenarioReferenceArtTargetRelativePath({
            tabKey: spec.key,
            group: fieldKey,
            index,
            originalPath: originalValues[index],
            sourcePath: normalized,
            targetContentRoot
          });
          if (!relTarget) {
            throw new Error(`Could not determine scenario-relative target for art file: ${normalized}`);
          }
          const data = buildLocalizedArtBufferFromSource(normalized, getReferenceArtTargetSizeForSave({
            tabKey: spec.key,
            group: fieldKey,
            index,
            entry
          }));
          const actualRelTarget = reserveRelativeArtTarget(relTarget, data, {
            tabKey: spec.key,
            group: fieldKey,
            index
          });
          const targetPath = path.join(targetContentRoot, actualRelTarget.replace(/\//g, path.sep));
          queueFileWrite(targetPath, data);
          sourceValues[index] = actualRelTarget;
          changed = true;
        });
        while (sourceValues.length > 0 && !String(sourceValues[sourceValues.length - 1] || '').trim()) {
          sourceValues.pop();
        }
        if (changed) entry[fieldKey] = sourceValues;
      });
      if (spec.key === 'civilizations' && Array.isArray(entry && entry.biqFields)) {
        entry.biqFields.forEach((field) => {
          const fieldKey = String(field && (field.baseKey || field.key) || '').trim().toLowerCase();
          if (!/^(forward|reverse)filename_for_era_\d+$/.test(fieldKey)) return;
          const pendingConversion = getPendingLeaderAnimationConversion(entry, fieldKey);
          const pendingSource = getPendingLeaderAnimationSource(entry, fieldKey);
          if (!pendingConversion && !pendingSource) return;
          const rawValue = String(field && field.value || '').trim();
          const normalizedValue = normalizeScenarioRelativeArtReferencePath(rawValue, entry, targetContentRoot);
          const relTarget = normalizedValue && !isAbsoluteFilesystemPath(normalizedValue)
            ? normalizeRelativePath(normalizedValue)
            : normalizeRelativePath(path.join('Art', 'Flics', path.basename(String(
              (pendingConversion && pendingConversion.sourcePath) || pendingSource || rawValue || 'leader.flc'
            )).replace(/\.[^.\\/]+$/i, '.flc')));
          if (!relTarget || !/^art\/flics\//i.test(relTarget)) {
            throw new Error(`Leader animation replacements must save under scenario Art\\Flics: ${rawValue || pendingSource}`);
          }
          const targetPath = path.join(targetContentRoot, relTarget.replace(/\//g, path.sep));
          if (pendingConversion) {
            const data = buildPendingLeaderAnimationConversionBuffer(pendingConversion);
            if (!data) {
              throw new Error(`Could not generate leader animation FLC from: ${String(pendingConversion.sourcePath || rawValue)}`);
            }
            queueFileWrite(targetPath, data);
          } else if (pendingSource && isAbsoluteFilesystemPath(pendingSource)) {
            let stats = null;
            try {
              stats = fs.statSync(pendingSource);
            } catch (_err) {
              stats = null;
            }
            if (!stats || !stats.isFile()) {
              throw new Error(`Leader animation FLC does not exist: ${pendingSource}`);
            }
            queueFileWrite(targetPath, fs.readFileSync(pendingSource));
          }
          field.value = relTarget.replace(/\//g, '\\');
        });
      }
      if (spec.key === 'improvements') {
        const rawSplash = String(entry && entry.wonderSplashPath || '').trim();
        const pendingSplashConversion = getPendingReferenceArtConversion(entry, 'wonderSplashPath', 0);
        const pendingSplashSource = getPendingReferenceArtSource(entry, 'wonderSplashPath', 0);
        const normalizedSplash = normalizeScenarioRelativeArtReferencePath(rawSplash, entry, targetContentRoot);
        if (pendingSplashConversion) {
          const targetSize = getReferenceArtTargetSizeForSave({
            tabKey: spec.key,
            group: 'wonderSplashPath',
            index: 0,
            entry
          });
          const relTarget = normalizedSplash && !isAbsoluteFilesystemPath(normalizedSplash)
            ? normalizeRelativePath(normalizedSplash)
            : pickScenarioReferenceArtTargetRelativePath({
              tabKey: spec.key,
              group: 'wonderSplashPath',
              originalPath: entry && entry.originalWonderSplashPath,
              sourcePath: String(pendingSplashConversion.sourcePath || pendingSplashSource || ''),
              targetContentRoot
            });
          const data = buildPendingReferenceArtConversionBuffer(pendingSplashConversion, targetSize);
          if (!relTarget || !data) {
            throw new Error(`Could not convert referenced art file: ${String(pendingSplashConversion.sourcePath || pendingSplashSource || rawSplash)}`);
          }
          const targetPath = path.join(targetContentRoot, relTarget.replace(/\//g, path.sep));
          queueFileWrite(targetPath, data);
          entry.wonderSplashPath = relTarget;
        } else if (pendingSplashSource && isAbsoluteFilesystemPath(pendingSplashSource)) {
          let stats = null;
          try {
            stats = fs.statSync(pendingSplashSource);
          } catch (_err) {
            stats = null;
          }
          if (!stats || !stats.isFile()) {
            throw new Error(`Referenced art file does not exist: ${pendingSplashSource}`);
          }
          const relTarget = normalizedSplash && !isAbsoluteFilesystemPath(normalizedSplash)
            ? normalizeRelativePath(normalizedSplash)
            : pickScenarioReferenceArtTargetRelativePath({
              tabKey: spec.key,
              group: 'wonderSplashPath',
              originalPath: entry && entry.originalWonderSplashPath,
              sourcePath: pendingSplashSource,
              targetContentRoot
            });
          if (!relTarget) {
            throw new Error(`Could not determine scenario-relative target for art file: ${pendingSplashSource}`);
          }
          const targetPath = path.join(targetContentRoot, relTarget.replace(/\//g, path.sep));
          queueFileWrite(targetPath, buildLocalizedArtBufferFromSource(pendingSplashSource, getReferenceArtTargetSizeForSave({
            tabKey: spec.key,
            group: 'wonderSplashPath',
            index: 0,
            entry
          })));
          entry.wonderSplashPath = relTarget;
        } else if (normalizedSplash && isAbsoluteFilesystemPath(normalizedSplash)) {
          let stats = null;
          try {
            stats = fs.statSync(normalizedSplash);
          } catch (_err) {
            stats = null;
          }
          if (!stats || !stats.isFile()) {
            throw new Error(`Referenced art file does not exist: ${normalizedSplash}`);
          }
          const relTarget = pickScenarioReferenceArtTargetRelativePath({
            tabKey: spec.key,
            group: 'wonderSplashPath',
            originalPath: entry && entry.originalWonderSplashPath,
            sourcePath: normalizedSplash,
            targetContentRoot
          });
          if (!relTarget) {
            throw new Error(`Could not determine scenario-relative target for art file: ${normalizedSplash}`);
          }
          const targetPath = path.join(targetContentRoot, relTarget.replace(/\//g, path.sep));
          queueFileWrite(targetPath, buildLocalizedArtBufferFromSource(normalizedSplash, getReferenceArtTargetSizeForSave({
            tabKey: spec.key,
            group: 'wonderSplashPath',
            index: 0,
            entry
          })));
          entry.wonderSplashPath = relTarget;
        } else if (normalizedSplash && normalizedSplash !== normalizeAssetReferencePath(rawSplash)) {
          entry.wonderSplashPath = normalizedSplash;
        }
      }
    });
  }
  queued.forEach((data, targetPath) => {
    plannedWrites.push({ kind: 'art', path: targetPath, data });
    saveReport.push({ kind: 'art', path: targetPath });
  });
  return { ok: true };
}

function normalizeUnitIniActionRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = String(row && row.key || '').trim().toUpperCase();
    if (!key) return;
    const relativePath = String(row && row.relativePath || '').trim();
    const timingRaw = row && row.timingSeconds;
    const timingSeconds = Number.isFinite(Number(timingRaw)) && Number(timingRaw) > 0
      ? Number(timingRaw)
      : null;
    out.push({ key, relativePath, timingSeconds });
  });
  out.sort((a, b) => String(a.key).localeCompare(String(b.key), 'en', { sensitivity: 'base' }));
  return out;
}

function toWindowsRelativeAssetPath(rawPath) {
  const normalized = normalizeRelativePath(rawPath);
  if (!normalized) return '';
  return normalized.replace(/\//g, '\\');
}

function normalizeUnitIniAnimationReferencePath(rawPath, { entry, targetPath, scenarioDir }) {
  const normalized = normalizeAssetReferencePath(rawPath);
  if (!normalized) return '';
  const targetDir = path.dirname(String(targetPath || '').trim());
  if (!targetDir) return toWindowsRelativeAssetPath(normalized);
  if (isAbsoluteFilesystemPath(normalized)) {
    return toWindowsRelativeAssetPath(path.relative(targetDir, normalized));
  }
  const scenarioRelative = normalizeScenarioRelativeArtReferencePath(normalized, entry, scenarioDir);
  if (/^art\/units\//i.test(scenarioRelative)) {
    const scenarioRoot = String(scenarioDir || '').trim();
    if (scenarioRoot) {
      const absolute = path.join(scenarioRoot, scenarioRelative.replace(/\//g, path.sep));
      return toWindowsRelativeAssetPath(path.relative(targetDir, absolute));
    }
  }
  const animationName = String(entry && entry.animationName || '').trim();
  if (animationName) {
    const prefix = `${animationName}/`;
    if (scenarioRelative.toLowerCase().startsWith(prefix.toLowerCase())) {
      return toWindowsRelativeAssetPath(scenarioRelative.slice(prefix.length));
    }
  }
  return toWindowsRelativeAssetPath(scenarioRelative);
}

function normalizeUnitIniSectionsForSave(sections, { entry, targetPath, scenarioDir }) {
  const out = [];
  (Array.isArray(sections) ? sections : []).forEach((section) => {
    const name = String(section && section.name || '').trim();
    if (!name) return;
    const fields = [];
    const isAnimations = name.toUpperCase() === 'ANIMATIONS';
    (Array.isArray(section && section.fields) ? section.fields : []).forEach((field) => {
      const key = String(field && field.key || '').trim();
      if (!key) return;
      const rawValue = String(field && field.value || '');
      fields.push({
        key,
        value: isAnimations
          ? normalizeUnitIniAnimationReferencePath(rawValue, { entry, targetPath, scenarioDir })
          : rawValue
      });
    });
    out.push({ name, fields });
  });
  return out;
}

function normalizeUnitIniSections(sections) {
  const out = [];
  (Array.isArray(sections) ? sections : []).forEach((section) => {
    const name = String(section && section.name || '').trim();
    if (!name) return;
    const fields = [];
    (Array.isArray(section && section.fields) ? section.fields : []).forEach((field) => {
      const key = String(field && field.key || '').trim();
      if (!key) return;
      fields.push({
        key,
        value: String(field && field.value || '')
      });
    });
    out.push({ name, fields });
  });
  return out;
}

function serializeUnitIniSections(sections) {
  const out = [];
  const normalized = normalizeUnitIniSections(sections);
  normalized.forEach((section, secIdx) => {
    if (secIdx > 0) out.push('');
    out.push(`[${section.name}]`);
    section.fields.forEach((field) => {
      out.push(`${field.key}=${String(field.value || '')}`);
    });
  });
  return `${out.join('\n').replace(/\r\n/g, '\n').trimEnd()}\n`;
}

function collectUnitIniReferenceEdits(tabs, scenarioDir) {
  const out = [];
  if (!tabs || !tabs.units || !Array.isArray(tabs.units.entries) || !scenarioDir) return out;
  tabs.units.entries.forEach((entry) => {
    if (!entry || !entry.unitIniEditor) return;
    const animationName = String(entry.animationName || '').trim();
    if (!animationName) return;
    const model = entry.unitIniEditor;
    const targetPath = path.join(scenarioDir, 'Art', 'Units', animationName, `${animationName}.ini`);
    const nextSections = normalizeUnitIniSectionsForSave(model.sections, { entry, targetPath, scenarioDir });
    const prevSections = normalizeUnitIniSections(model.originalSections);
    if (nextSections.length > 0 || prevSections.length > 0) {
      if (JSON.stringify(nextSections) === JSON.stringify(prevSections)) return;
      out.push({
        animationName,
        sourcePath: String(model.iniPath || '').trim(),
        targetPath,
        sections: nextSections,
        originalSections: prevSections,
        actions: normalizeUnitIniActionRows(model.actions),
        originalActions: normalizeUnitIniActionRows(model.originalActions)
      });
      return;
    }
    const nextRows = normalizeUnitIniActionRows(model.actions).map((row) => ({
      ...row,
      relativePath: normalizeUnitIniAnimationReferencePath(row.relativePath, { entry, targetPath, scenarioDir })
    }));
    const prevRows = normalizeUnitIniActionRows(model.originalActions);
    if (JSON.stringify(nextRows) === JSON.stringify(prevRows)) return;
    out.push({
      animationName,
      sourcePath: String(model.iniPath || '').trim(),
      targetPath,
      actions: nextRows,
      originalActions: prevRows
    });
  });
  return out;
}

function isSafeUnitAnimationFolderName(name) {
  const value = String(name || '').trim();
  if (!value) return false;
  if (value.includes('..')) return false;
  if (/[\\/]/.test(value)) return false;
  if (/[:*?"<>|]/.test(value)) return false;
  return true;
}

function validateUnitAnimationReferenceChanges({
  tabs,
  mode,
  civ3Path,
  scenarioRoot,
  scenarioSearchPaths,
  scenarioContentRoot,
  importedKeys
}) {
  if (mode !== 'scenario') return null;
  const entries = ((((tabs || {}).units || {}).entries) || []);
  if (!Array.isArray(entries)) return null;
  const imported = importedKeys instanceof Set ? importedKeys : new Set();
  let checkedCount = 0;
  for (const entry of entries) {
    // Skip entries being imported — art copy pipeline handles these
    if (entry && imported.has(String(entry.civilopediaKey || ''))) continue;
    const animationName = String(entry && entry.animationName || '').trim();
    if (!animationName) continue;
    if (!isSafeUnitAnimationFolderName(animationName)) {
      const msg = `Unsafe unit animation folder name: ${animationName}. Use a plain folder name (no slashes, '..', or reserved characters).`;
      log.warn('BiqValidate', `validateUnitAnimationReferenceChanges: ${msg}`);
      return msg;
    }
    const changedAnimationName = normalizeRelativePath(animationName || '') !== normalizeRelativePath((entry && entry.originalAnimationName) || '');
    const enforceSafety = !!(entry && entry.unitAnimationEdited);
    if (!changedAnimationName && !enforceSafety) continue;
    if (entry && entry.unitIniEditor) continue;
    checkedCount++;
    const localScenarioIni = scenarioContentRoot
      ? path.join(scenarioContentRoot, 'Art', 'Units', animationName, `${animationName}.ini`)
      : '';
    if (localScenarioIni && fs.existsSync(localScenarioIni)) {
      log.debug('BiqValidate', `validateUnitAnimationReferenceChanges: "${animationName}" resolved via local scenario INI`);
      continue;
    }
    const resolvedIni = resolveUnitIniPath(civ3Path, animationName, scenarioRoot, scenarioSearchPaths);
    if (!resolvedIni) {
      const msg = `Animation folder "${animationName}" is not resolvable. Choose an existing unit animation folder or edit unit INI actions before saving.`;
      log.warn('BiqValidate', `validateUnitAnimationReferenceChanges: FAILED — ${msg}`);
      return msg;
    }
    log.debug('BiqValidate', `validateUnitAnimationReferenceChanges: "${animationName}" resolved OK`);
  }
  if (checkedCount > 0) {
    log.debug('BiqValidate', `validateUnitAnimationReferenceChanges: ${checkedCount} animation reference(s) validated OK`);
  }
  return null;
}

function parseIniKeyValueLine(line) {
  const raw = String(line || '');
  const eq = raw.indexOf('=');
  if (eq < 0) return null;
  const key = raw.slice(0, eq).trim();
  if (!key) return null;
  return {
    key,
    keyUpper: key.toUpperCase(),
    value: raw.slice(eq + 1).trim()
  };
}

function readIniTextWithFallback(primaryPath, fallbackPath) {
  const pick = [primaryPath, fallbackPath].find((p) => !!p && fs.existsSync(p));
  if (!pick) return '';
  try {
    return fs.readFileSync(pick, 'latin1');
  } catch (_err) {
    return '';
  }
}

function buildScenarioUnitIniEditResult({ targetPath, sourcePath, actions, originalActions, sections, originalSections }) {
  try {
    const existing = readIniTextWithFallback(targetPath, sourcePath);
    const nextSections = normalizeUnitIniSections(sections);
    const prevSections = normalizeUnitIniSections(originalSections);
    if (nextSections.length > 0 || prevSections.length > 0) {
      const serialized = serializeUnitIniSections(nextSections);
      const normalizedExisting = String(existing || '').replace(/\r\n/g, '\n').trimEnd();
      const applied = normalizedExisting === serialized.trimEnd() ? 0 : 1;
      return { ok: true, applied, buffer: Buffer.from(serialized, 'latin1') };
    }
    const lines = String(existing || '').split(/\r?\n/);
    const out = [];
    const desiredMap = new Map();
    const timingMap = new Map();
    (Array.isArray(actions) ? actions : []).forEach((a) => {
      const key = String(a && a.key || '').trim().toUpperCase();
      if (!key) return;
      desiredMap.set(key, String(a && a.relativePath || '').trim());
      if (Number.isFinite(a && a.timingSeconds) && Number(a.timingSeconds) > 0) {
        timingMap.set(key, Number(a.timingSeconds));
      }
    });
    const managedKeys = new Set();
    (Array.isArray(originalActions) ? originalActions : []).forEach((a) => {
      const key = String(a && a.key || '').trim().toUpperCase();
      if (key) managedKeys.add(key);
    });
    desiredMap.forEach((_v, key) => managedKeys.add(key));

    let section = '';
    let sawAnimations = false;
    let sawTiming = false;
    const seenAnimKeys = new Set();
    const seenTimingKeys = new Set();

    lines.forEach((line) => {
      const sec = String(line || '').trim().match(/^\[(.+)\]$/);
      if (sec) {
        section = String(sec[1] || '').trim().toUpperCase();
        if (section === 'ANIMATIONS') sawAnimations = true;
        if (section === 'TIMING') sawTiming = true;
        out.push(line);
        return;
      }
      const kv = parseIniKeyValueLine(line);
      if (!kv || !managedKeys.has(kv.keyUpper)) {
        out.push(line);
        return;
      }
      if (section === 'ANIMATIONS') {
        seenAnimKeys.add(kv.keyUpper);
        if (desiredMap.has(kv.keyUpper)) out.push(`${kv.key}=${desiredMap.get(kv.keyUpper)}`);
        return;
      }
      if (section === 'TIMING') {
        seenTimingKeys.add(kv.keyUpper);
        if (timingMap.has(kv.keyUpper)) out.push(`${kv.key}=${Number(timingMap.get(kv.keyUpper)).toFixed(6)}`);
        return;
      }
      out.push(line);
    });

    const appendLine = (value) => {
      if (out.length === 0 || out[out.length - 1] !== '') out.push('');
      out.push(value);
    };
    if (!sawAnimations) {
      appendLine('[Animations]');
    }
    desiredMap.forEach((value, key) => {
      if (seenAnimKeys.has(key)) return;
      out.push(`${key}=${value}`);
    });
    if (!sawTiming) {
      appendLine('[Timing]');
    }
    timingMap.forEach((value, key) => {
      if (seenTimingKeys.has(key)) return;
      out.push(`${key}=${Number(value).toFixed(6)}`);
    });

    const normalizedExisting = String(existing || '').replace(/\r\n/g, '\n').trimEnd();
    const serialized = `${out.join('\n').replace(/\r\n/g, '\n').trimEnd()}\n`;
    const applied = normalizedExisting === serialized.trimEnd() ? 0 : 1;
    return { ok: true, applied, buffer: Buffer.from(serialized, 'latin1') };
  } catch (err) {
    return { ok: false, error: `Failed to save unit INI edits: ${err.message}` };
  }
}

function applyBiqReferenceEdits({ biqPath, edits, civ3Path, outputPath, textEncoding = 'windows-1252', returnBuffer = false }) {
  if (!biqPath || !Array.isArray(edits) || edits.length === 0) {
    return { ok: true, applied: 0, skipped: 0, warning: '', outputPath: '' };
  }
  log.info('BiqSave', `applyBiqReferenceEdits: ${edits.length} total edit(s) to ${log.rel(biqPath)}`);
  const opCounts = edits.reduce((acc, e) => {
    const op = String(e && e.op || 'set').toLowerCase();
    acc[op] = (acc[op] || 0) + 1;
    return acc;
  }, {});
  log.debug('BiqSave', `  edit breakdown: ${Object.entries(opCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  const inflated = inflateBiqIfNeeded(biqPath, civ3Path);
  if (!inflated.ok) {
    log.error('BiqSave', `applyBiqReferenceEdits: inflate failed — ${inflated.error || 'unknown'}`);
    return { ok: false, error: inflated.error || 'Failed to read BIQ before applying edits.' };
  }
  log.debug('BiqSave', `  inflated BIQ: ${inflated.buffer ? inflated.buffer.length : 0} bytes`);

  const finalOutputPath = String(outputPath || biqPath).trim() || biqPath;
  const allowSetmapGeneration = edits.some((edit) => String(edit && edit.op || '').toLowerCase() === 'setmap' && !!(edit && edit.allowSetmapGeneration));
  try {
    const jsResult = jsApplyBiqEdits({
      buffer: inflated.buffer,
      edits,
      textEncoding: resolveAutoTextEncoding(textEncoding),
      allowSetmapGeneration
    });
    if (!jsResult.ok) {
      log.error('BiqSave', `applyBiqReferenceEdits: jsApplyBiqEdits failed — ${jsResult.error || 'unknown'}`);
      return { ok: false, error: jsResult.error || 'BIQ edit failed' };
    }
    log.info('BiqSave', `applyBiqReferenceEdits: bridge complete — applied=${jsResult.applied} skipped=${jsResult.skipped}${jsResult.warning ? ' warnings: ' + jsResult.warning : ''}`);
    if (jsResult.skipped > 0) {
      log.warn('BiqSave', `applyBiqReferenceEdits: ${jsResult.skipped} edit(s) were skipped — check warnings above`);
    }

    if (returnBuffer) {
      log.debug('BiqSave', `applyBiqReferenceEdits: returning staged buffer (${jsResult.buffer ? jsResult.buffer.length : 0} bytes)`);
      return {
        ok: true,
        applied: jsResult.applied,
        skipped: jsResult.skipped,
        warning: jsResult.warning || '',
        outputPath: '',
        buffer: jsResult.buffer
      };
    }

    fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
    fs.writeFileSync(finalOutputPath, jsResult.buffer);
    log.debug('BiqSave', `applyBiqReferenceEdits: staged output written to ${log.rel(finalOutputPath)} (${jsResult.buffer ? jsResult.buffer.length : 0} bytes)`);
    return {
      ok: true,
      applied: jsResult.applied,
      skipped: jsResult.skipped,
      warning: jsResult.warning || '',
      outputPath: finalOutputPath,
      buffer: null
    };
  } catch (err) {
    log.error('BiqSave', `applyBiqReferenceEdits: exception — ${err.message}`);
    return { ok: false, error: `BIQ edit failed: ${err.message}` };
  }
}

module.exports = {
  FILE_SPECS,
  normalizeTextFileEncoding,
  encodeTextBuffer,
  detectTextFileEncodingFromBuffer,
  detectBiqTextEncodingFromBuffer,
  readTextFileWithEncodingInfoIfExists,
  parseIniLines,
  buildBaseModel,
  parseSectionedConfig,
  serializeSectionedConfig,
  parseScenarioDistrictsText,
  serializeScenarioDistrictsText,
  serializeBaseConfig,
  parseIniFieldDocs,
  parseIniSectionMap,
  parseSectionFieldDocs,
  buildScenarioCivilopediaEditResult,
  buildScenarioCivilopediaRepairResult,
  parseCivilopediaDocumentWithOrder,
  serializeCivilopediaDocumentWithOrder,
  parsePediaIconsDocumentWithOrder,
  serializePediaIconsDocumentWithOrder,
  buildScenarioPediaIconsEditResult,
  buildScenarioPediaIconsRepairResult,
  buildScenarioDiplomacyEditResult,
  collectPediaIconsReferenceEdits,
  pickScenarioReferenceArtTargetRelativePath,
  parseDiplomacyDocumentWithOrder,
  serializeDiplomacyDocumentWithOrder,
  parseDiplomacySlotOptions,
  buildReferenceTabs,
  buildEffectiveReferenceTabs,
  resolveScenarioDir,
  resolveBiqPath,
  createScenario,
  deleteScenario,
  loadMapImport,
  materializeMapTab,
  parseBiqSectionsFromBuffer,
  resolvePaths,
  loadBundle,
  saveBundle,
  previewSavePlan,
  collectBiqReferenceEdits,
  collectBiqStructureEdits,
  collectBiqMapStructureOps,
  collectBiqMapRecordOps,
  collectBiqMapEdits,
  findNextResourceAtlasSlot,
  getNextResourceAtlasAssignmentSlot,
  appendResourceIconToResourcesPcx,
  applyImportedResourceIconAtlasAssignments,
  findNextUnitAtlasSlot,
  getNextUnitAtlasAssignmentSlot,
  appendUnitIconToUnits32Pcx,
  applyImportedUnitIconAtlasAssignments,
  findNextBuildingCityAtlasRow,
  findNextBuildingCityAtlasPairRow,
  getNextBuildingCityAtlasAssignmentRow,
  appendBuildingCityIconRowToAtlas,
  appendBuildingCityIconRowToAtlases,
  applyImportedBuildingCityIconAtlasAssignments,
  buildScienceAdvisorArrowRoutesForEra,
  prepareScienceAdvisorArrowArtWrites,
  loadScienceAdvisorArrowMetadata,
  buildScienceAdvisorArrowMetadataWrite,
  countScienceAdvisorUnlockIconsForTech,
  previewFileDiff,
  buildUnifiedDiffRows,
  buildSyntheticUnitReferenceEntry,
  isPrtoStrategyMapRecord,
  buildPrtoStrategyMapAliases
};
