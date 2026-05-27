'use strict';

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseIntLoose(value, fallback = 0) {
  const match = String(value == null ? '' : value).match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBit(value, bit) {
  return ((((value >>> 0) >>> bit) & 1) === 1);
}

function boolString(value) {
  return value ? 'true' : 'false';
}

function isTruthy(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function toSignedIntString(value) {
  return String(value | 0);
}

const DIRECT_FIELD_SPECS = [
  { uiKey: 'leadername', rawKey: 'name', defaultValue: '' },
  { uiKey: 'civilizationname', rawKey: 'civilizationname', defaultValue: '' },
  { uiKey: 'leadertitle', rawKey: 'leadertitle', defaultValue: '' },
  { uiKey: 'noun', rawKey: 'noun', defaultValue: '' },
  { uiKey: 'adjective', rawKey: 'adjective', defaultValue: '' },
  { uiKey: 'civilizationgender', rawKey: 'civilizationgender', defaultValue: '0' },
  { uiKey: 'plurality', rawKey: 'plurality', defaultValue: '0' },
  { uiKey: 'culturegroup', rawKey: 'culturegroup', defaultValue: '-1' },
  { uiKey: 'leadergender', rawKey: 'leadergender', defaultValue: '0' },
  { uiKey: 'kingunit', rawKey: 'kingunit', defaultValue: '-1' },
  { uiKey: 'favoritegovernment', rawKey: 'favoritegovernment', defaultValue: '-1' },
  { uiKey: 'shunnedgovernment', rawKey: 'shunnedgovernment', defaultValue: '-1' },
  { uiKey: 'aggressionlevel', rawKey: 'aggressionlevel', defaultValue: '0' },
  { uiKey: 'numcitynames', rawKey: 'numcities', defaultValue: '0' },
  { uiKey: 'numgreatleaders', rawKey: 'nummilleaders', defaultValue: '0' },
  { uiKey: 'numscientificleaders', rawKey: 'numscientificleaders', defaultValue: '0' },
  { uiKey: 'forwardfilename_for_era_0', rawKey: 'forwardfilename_0', defaultValue: '' },
  { uiKey: 'reversefilename_for_era_0', rawKey: 'reversefilename_0', defaultValue: '' },
  { uiKey: 'forwardfilename_for_era_1', rawKey: 'forwardfilename_1', defaultValue: '' },
  { uiKey: 'reversefilename_for_era_1', rawKey: 'reversefilename_1', defaultValue: '' },
  { uiKey: 'forwardfilename_for_era_2', rawKey: 'forwardfilename_2', defaultValue: '' },
  { uiKey: 'reversefilename_for_era_2', rawKey: 'reversefilename_2', defaultValue: '' },
  { uiKey: 'forwardfilename_for_era_3', rawKey: 'forwardfilename_3', defaultValue: '' },
  { uiKey: 'reversefilename_for_era_3', rawKey: 'reversefilename_3', defaultValue: '' },
  { uiKey: 'freetech1index', rawKey: 'freetech1', defaultValue: '-1' },
  { uiKey: 'freetech2index', rawKey: 'freetech2', defaultValue: '-1' },
  { uiKey: 'freetech3index', rawKey: 'freetech3', defaultValue: '-1' },
  { uiKey: 'freetech4index', rawKey: 'freetech4', defaultValue: '-1' },
  { uiKey: 'uniquecolor', rawKey: 'uniquecolor', defaultValue: '0' },
  { uiKey: 'defaultcolor', rawKey: 'defaultcolor', defaultValue: '0' },
  { uiKey: 'uniquecivcounter', rawKey: 'uniquecivcounter', defaultValue: '0' },
  { uiKey: 'diplomacytextindex', rawKey: 'diplomacytextindex', defaultValue: '-1' },
  { uiKey: 'questionmark', rawKey: 'questionmark', defaultValue: '0' }
];

const BONUS_BITS = {
  militaristic: 0,
  commercial: 1,
  expansionist: 2,
  scientific: 3,
  religious: 4,
  industrious: 5,
  agricultural: 6,
  seafaring: 7
};

const GOVERNOR_BITS = {
  managecitizens: 0,
  emphasizefood: 1,
  emphasizeshields: 2,
  emphasizetrade: 3,
  manageproduction: 4,
  nowonders: 5,
  nosmallwonders: 6
};

const BUILD_PRIORITY_BITS = {
  offensivelandunits: 0,
  defensivelandunits: 1,
  artillery: 2,
  settlers: 3,
  workers: 4,
  ships: 5,
  airunits: 6,
  growth: 7,
  production: 8,
  happiness: 9,
  science: 10,
  wealth: 11,
  trade: 12,
  exploration: 13,
  culture: 14
};

function buildFieldLookup(rawFields) {
  const byRaw = new Map();
  (Array.isArray(rawFields) ? rawFields : []).forEach((field) => {
    const rawKey = String(field && (field.baseKey || field.key) || '').trim();
    if (!rawKey) return;
    byRaw.set(normalizeKey(rawKey), field);
  });
  return byRaw;
}

function projectCivilizationBiqFields({ rawFields, civilopediaEntry, flavorCount = 0 }) {
  const lookup = buildFieldLookup(rawFields);
  const projected = [];
  const consumed = new Set();
  const pushField = (baseKey, value, originalValue, editable = true) => {
    consumed.add(normalizeKey(baseKey));
    projected.push({
      key: baseKey,
      baseKey,
      label: baseKey,
      value: String(value),
      originalValue: String(originalValue),
      editable
    });
  };
  const readRawField = (rawKey, fallbackValue) => {
    const hit = lookup.get(normalizeKey(rawKey));
    if (!hit) {
      return {
        value: String(fallbackValue),
        originalValue: String(fallbackValue),
        editable: true
      };
    }
    return {
      value: String(hit.value == null ? '' : hit.value),
      originalValue: String(hit.originalValue == null ? hit.value : hit.originalValue),
      editable: !!hit.editable
    };
  };

  pushField('civilopediaentry', civilopediaEntry || '', civilopediaEntry || '', false);

  DIRECT_FIELD_SPECS.forEach((spec) => {
    const raw = readRawField(spec.rawKey, spec.defaultValue);
    consumed.add(normalizeKey(spec.rawKey));
    pushField(spec.uiKey, raw.value || spec.defaultValue, raw.originalValue || spec.defaultValue, raw.editable);
  });

  const bonusesValue = parseIntLoose(readRawField('bonuses', 0).value, 0);
  const bonusesOriginal = parseIntLoose(readRawField('bonuses', 0).originalValue, 0);
  Object.entries(BONUS_BITS).forEach(([uiKey, bit]) => {
    pushField(uiKey, boolString(readBit(bonusesValue, bit)), boolString(readBit(bonusesOriginal, bit)));
  });

  const governorValue = parseIntLoose(readRawField('governorsettings', 0).value, 0);
  const governorOriginal = parseIntLoose(readRawField('governorsettings', 0).originalValue, 0);
  Object.entries(GOVERNOR_BITS).forEach(([uiKey, bit]) => {
    pushField(uiKey, boolString(readBit(governorValue, bit)), boolString(readBit(governorOriginal, bit)));
  });

  const buildNeverValue = parseIntLoose(readRawField('buildnever', 0).value, 0);
  const buildNeverOriginal = parseIntLoose(readRawField('buildnever', 0).originalValue, 0);
  Object.entries(BUILD_PRIORITY_BITS).forEach(([suffix, bit]) => {
    pushField(`no${suffix}`, boolString(readBit(buildNeverValue, bit)), boolString(readBit(buildNeverOriginal, bit)));
  });

  const buildOftenValue = parseIntLoose(readRawField('buildoften', 0).value, 0);
  const buildOftenOriginal = parseIntLoose(readRawField('buildoften', 0).originalValue, 0);
  Object.entries(BUILD_PRIORITY_BITS).forEach(([suffix, bit]) => {
    pushField(`many${suffix}`, boolString(readBit(buildOftenValue, bit)), boolString(readBit(buildOftenOriginal, bit)));
  });

  const flavorsValue = parseIntLoose(readRawField('flavors', 0).value, 0);
  const flavorsOriginal = parseIntLoose(readRawField('flavors', 0).originalValue, 0);
  for (let idx = 0; idx < flavorCount; idx += 1) {
    pushField(`flavor_${idx + 1}`, boolString(readBit(flavorsValue, idx)), boolString(readBit(flavorsOriginal, idx)));
  }

  ['bonuses', 'governorsettings', 'buildnever', 'buildoften', 'flavors', 'diplomacytextindex', 'questionmark'].forEach((key) => {
    consumed.add(normalizeKey(key));
  });

  (Array.isArray(rawFields) ? rawFields : []).forEach((field) => {
    const rawKey = String(field && (field.baseKey || field.key) || '').trim();
    if (!rawKey) return;
    const norm = normalizeKey(rawKey);
    if (consumed.has(norm)) return;
    projected.push({
      key: String(field.key || rawKey),
      baseKey: String(field.baseKey || rawKey),
      label: String(field.label || rawKey),
      value: String(field.value == null ? '' : field.value),
      originalValue: String(field.originalValue == null ? field.value : field.originalValue),
      editable: !!field.editable
    });
  });

  return projected;
}

function collapseCivilizationBiqFields(fields, flavorCount = 0, valueKey = 'value') {
  const byKey = new Map();
  (Array.isArray(fields) ? fields : []).forEach((field) => {
    const key = normalizeKey(field && (field.baseKey || field.key));
    if (!key) return;
    byKey.set(key, field);
  });
  const readText = (key, fallbackValue = '') => {
    const hit = byKey.get(normalizeKey(key));
    if (!hit) return String(fallbackValue);
    return String(hit && hit[valueKey] == null ? '' : hit[valueKey]);
  };
  const readBool = (key) => isTruthy(readText(key, 'false'));
  const encodeBits = (bitMap, prefix = '') => Object.entries(bitMap).reduce((sum, [key, bit]) => (
    readBool(`${prefix}${key}`) ? (sum | (2 ** bit)) : sum
  ), 0);

  const raw = {};
  DIRECT_FIELD_SPECS.forEach((spec) => {
    raw[spec.rawKey] = readText(spec.uiKey, spec.defaultValue);
  });
  raw.bonuses = toSignedIntString(encodeBits(BONUS_BITS));
  raw.governorsettings = toSignedIntString(encodeBits(GOVERNOR_BITS));
  raw.buildnever = toSignedIntString(encodeBits(BUILD_PRIORITY_BITS, 'no'));
  raw.buildoften = toSignedIntString(encodeBits(BUILD_PRIORITY_BITS, 'many'));
  let flavors = 0;
  for (let idx = 0; idx < flavorCount; idx += 1) {
    if (readBool(`flavor_${idx + 1}`)) flavors |= (2 ** idx);
  }
  raw.flavors = toSignedIntString(flavors);
  raw.name = readText('leadername', '');
  raw.civilizationName = readText('civilizationname', raw.name);
  raw.leadertitle = readText('leadertitle', '');
  raw.nummilleaders = readText('numgreatleaders', '0');
  raw.numcities = readText('numcitynames', '0');

  const hasRepeatedFields = (prefix) => {
    const target = normalizeKey(prefix);
    return (Array.isArray(fields) ? fields : []).some((field) => {
      const key = normalizeKey(field && (field.baseKey || field.key));
      return key === target || new RegExp(`^${target}\\d+$`).test(key);
    });
  };

  const readRepeatedValues = (prefix) => {
    const target = normalizeKey(prefix);
    return (Array.isArray(fields) ? fields : [])
      .filter((field) => {
        const key = normalizeKey(field && (field.baseKey || field.key));
        return key === target || new RegExp(`^${target}\\d+$`).test(key);
      })
      .map((field) => String(field ? (field[valueKey] == null ? '' : field[valueKey]) : ''))
      .filter((value) => String(value || '').trim().length > 0);
  };

  const cityNames = readRepeatedValues('cityname');
  cityNames.forEach((name, idx) => {
    raw[`cityName_${idx}`] = name;
  });

  const militaryLeaders = readRepeatedValues('milleader');
  militaryLeaders.forEach((name, idx) => {
    raw[`milLeader_${idx}`] = name;
  });

  const scientificLeaders = readRepeatedValues('scientificleader');
  scientificLeaders.forEach((name, idx) => {
    raw[`scientificLeader_${idx}`] = name;
  });

  const deriveCountsFromCurrentLists = valueKey === 'value';
  raw.numcities = deriveCountsFromCurrentLists && hasRepeatedFields('cityname')
    ? toSignedIntString(cityNames.length)
    : readText('numcitynames', '0');
  raw.nummilleaders = deriveCountsFromCurrentLists && hasRepeatedFields('milleader')
    ? toSignedIntString(militaryLeaders.length)
    : readText('numgreatleaders', '0');
  raw.numscientificleaders = deriveCountsFromCurrentLists && hasRepeatedFields('scientificleader')
    ? toSignedIntString(scientificLeaders.length)
    : readText('numscientificleaders', '0');
  return raw;
}

module.exports = {
  DIRECT_FIELD_SPECS,
  BONUS_BITS,
  GOVERNOR_BITS,
  BUILD_PRIORITY_BITS,
  projectCivilizationBiqFields,
  collapseCivilizationBiqFields
};
