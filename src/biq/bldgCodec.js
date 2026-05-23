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
  { uiKey: 'name', rawKey: 'name', defaultValue: '' },
  { uiKey: 'description', rawKey: 'description', defaultValue: '' },
  { uiKey: 'doubleshappiness', rawKey: 'doubles_happiness', defaultValue: -1 },
  { uiKey: 'gainineverycity', rawKey: 'gain_in_every_city', defaultValue: -1 },
  { uiKey: 'gainoncontinent', rawKey: 'gain_on_continent', defaultValue: -1 },
  { uiKey: 'reqimprovement', rawKey: 'req_improvement', defaultValue: -1 },
  { uiKey: 'cost', rawKey: 'cost', defaultValue: 0 },
  { uiKey: 'culture', rawKey: 'culture', defaultValue: 0 },
  { uiKey: 'bombarddefence', rawKey: 'bombard_defence', defaultValue: 0 },
  { uiKey: 'navalbombarddefence', rawKey: 'naval_bombard_defence', defaultValue: 0 },
  { uiKey: 'defencebonus', rawKey: 'defence_bonus', defaultValue: 0 },
  { uiKey: 'navaldefencebonus', rawKey: 'naval_defence_bonus', defaultValue: 0 },
  { uiKey: 'maintenancecost', rawKey: 'maintenance_cost', defaultValue: 0 },
  { uiKey: 'happyall', rawKey: 'happy_all', defaultValue: 0 },
  { uiKey: 'happy', rawKey: 'happy', defaultValue: 0 },
  { uiKey: 'unhappyall', rawKey: 'unhappy_all', defaultValue: 0 },
  { uiKey: 'unhappy', rawKey: 'unhappy', defaultValue: 0 },
  { uiKey: 'numreqbuildings', rawKey: 'num_req_buildings', defaultValue: 0 },
  { uiKey: 'airpower', rawKey: 'air_power', defaultValue: 0 },
  { uiKey: 'navalpower', rawKey: 'naval_power', defaultValue: 0 },
  { uiKey: 'pollution', rawKey: 'pollution', defaultValue: 0 },
  { uiKey: 'production', rawKey: 'production', defaultValue: 0 },
  { uiKey: 'reqgovernment', rawKey: 'req_government', defaultValue: -1 },
  { uiKey: 'spaceshippart', rawKey: 'spaceship_part', defaultValue: -1 },
  { uiKey: 'reqadvance', rawKey: 'req_advance', defaultValue: -1 },
  { uiKey: 'obsoleteby', rawKey: 'obsolete_by', defaultValue: -1 },
  { uiKey: 'reqresource1', rawKey: 'req_resource1', defaultValue: -1 },
  { uiKey: 'reqresource2', rawKey: 'req_resource2', defaultValue: -1 },
  { uiKey: 'armiesrequired', rawKey: 'armies_required', defaultValue: 0 },
  { uiKey: 'unitproduced', rawKey: 'unit_produced', defaultValue: -1 },
  { uiKey: 'unitfrequency', rawKey: 'unit_frequency', defaultValue: 0 }
];

const IMPROVEMENTS_BITS = {
  centerofempire: 0,
  veteranunits: 1,
  increasedresearch: 2,
  increasedluxuries: 3,
  increasedtaxes: 4,
  removepoppollution: 5,
  reducebldgpollution: 6,
  resistanttobribery: 7,
  reducescorruption: 8,
  doublescitygrowthrate: 9,
  increasesluxurytrade: 10,
  allowcitylevel2: 11,
  allowcitylevel3: 12,
  replacesotherwiththistag: 13,
  mustbenearwater: 14,
  mustbenearriver: 15,
  mayexplodeormeltdown: 16,
  veteranseaunits: 17,
  veteranairunits: 18,
  capitalization: 19,
  allowwatertrade: 20,
  allowairtrade: 21,
  reduceswarweariness: 22,
  increasesshieldsinwater: 23,
  increasesfoodinwater: 24,
  increasestradeinwater: 25,
  charmbarrier: 26,
  stealthattackbarrier: 27,
  actsasgeneraltelepad: 28,
  doublessacrifice: 29,
  goodsmustbeincityradius: 31
};

const OTHER_CHAR_BITS = {
  coastalinstallation: 0,
  militaristic: 1,
  wonder: 2,
  smallwonder: 3,
  continentalmoodeffects: 4,
  scientific: 5,
  commercial: 6,
  expansionist: 7,
  religious: 8,
  industrious: 9,
  agricultural: 10,
  seafaring: 11
};

const SMALL_WONDER_BITS = {
  increaseschanceofleaderappearance: 0,
  buildarmieswithoutleader: 1,
  buildlargerarmies: 2,
  treasuryearnsinterest: 3,
  buildspaceshipparts: 4,
  forbiddenpalace: 5,
  decreasessuccessofmissiles: 6,
  allowspymissions: 7,
  allowshealinginenemyterritory: 8,
  requiresvictoriousarmy: 10,
  requireseliteship: 11
};

const WONDER_BITS = {
  safeseatravel: 0,
  gainanytechsknownbytwocivs: 1,
  doublecombatvsbarbarians: 2,
  increasedshipmovement: 3,
  doublesresearchoutput: 4,
  increasedtrade: 5,
  cheaperupgrades: 6,
  paystrademaintenance: 7,
  allowsnuclearweapons: 8,
  doublecitygrowth: 9,
  twofreeadvances: 10,
  empirereduceswarweariness: 11,
  doublecitydefences: 12,
  allowdiplomaticvictory: 13,
  plustwoshipmovement: 14,
  questionmarkwondertrait: 15,
  increasedarmyvalue: 16,
  touristattraction: 17
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

function projectImprovementBiqFields({ rawFields, civilopediaEntry, flavorCount = 0 }) {
  const lookup = buildFieldLookup(rawFields);
  const projected = [];
  const pushField = (baseKey, value, originalValue, editable = true) => {
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
    if (!hit) return {
      value: String(fallbackValue),
      originalValue: String(fallbackValue),
      editable: true
    };
    return {
      value: String(hit.value == null ? '' : hit.value),
      originalValue: String(hit.originalValue == null ? hit.value : hit.originalValue),
      editable: !!hit.editable
    };
  };

  pushField('civilopediaentry', civilopediaEntry || '', civilopediaEntry || '', false);

  DIRECT_FIELD_SPECS.forEach((spec) => {
    const raw = readRawField(spec.rawKey, spec.defaultValue);
    pushField(spec.uiKey, raw.value || String(spec.defaultValue), raw.originalValue || String(spec.defaultValue), raw.editable);
  });

  const improvementsValue = parseIntLoose(readRawField('improvements', 0).value, 0);
  const improvementsOriginal = parseIntLoose(readRawField('improvements', 0).originalValue, 0);
  Object.entries(IMPROVEMENTS_BITS).forEach(([uiKey, bit]) => {
    pushField(uiKey, boolString(readBit(improvementsValue, bit)), boolString(readBit(improvementsOriginal, bit)));
  });

  const otherCharValue = parseIntLoose(readRawField('other_char', 0).value, 0);
  const otherCharOriginal = parseIntLoose(readRawField('other_char', 0).originalValue, 0);
  Object.entries(OTHER_CHAR_BITS).forEach(([uiKey, bit]) => {
    pushField(uiKey, boolString(readBit(otherCharValue, bit)), boolString(readBit(otherCharOriginal, bit)));
  });
  pushField(
    'improvement',
    boolString(!readBit(otherCharValue, OTHER_CHAR_BITS.wonder) && !readBit(otherCharValue, OTHER_CHAR_BITS.smallwonder)),
    boolString(!readBit(otherCharOriginal, OTHER_CHAR_BITS.wonder) && !readBit(otherCharOriginal, OTHER_CHAR_BITS.smallwonder)),
    false
  );

  const smallWonderValue = parseIntLoose(readRawField('small_wonder_characteristics', 0).value, 0);
  const smallWonderOriginal = parseIntLoose(readRawField('small_wonder_characteristics', 0).originalValue, 0);
  Object.entries(SMALL_WONDER_BITS).forEach(([uiKey, bit]) => {
    pushField(uiKey, boolString(readBit(smallWonderValue, bit)), boolString(readBit(smallWonderOriginal, bit)));
  });

  const wonderValue = parseIntLoose(readRawField('wonder_characteristics', 0).value, 0);
  const wonderOriginal = parseIntLoose(readRawField('wonder_characteristics', 0).originalValue, 0);
  Object.entries(WONDER_BITS).forEach(([uiKey, bit]) => {
    pushField(uiKey, boolString(readBit(wonderValue, bit)), boolString(readBit(wonderOriginal, bit)));
  });

  const flavorsValue = parseIntLoose(readRawField('flavors', 0).value, 0);
  const flavorsOriginal = parseIntLoose(readRawField('flavors', 0).originalValue, 0);
  for (let idx = 0; idx < flavorCount; idx += 1) {
    const bit = idx;
    pushField(`flavor_${idx + 1}`, boolString(readBit(flavorsValue, bit)), boolString(readBit(flavorsOriginal, bit)));
  }

  return projected;
}

function collapseImprovementBiqFields(fields, flavorCount = 0, valueKey = 'value') {
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
  const readNumber = (key, fallbackValue = 0) => parseIntLoose(readText(key, fallbackValue), fallbackValue);
  const readBool = (key) => isTruthy(readText(key, 'false'));
  const encodeBits = (bitMap) => Object.entries(bitMap).reduce((sum, [key, bit]) => (
    readBool(key) ? (sum | (2 ** bit)) : sum
  ), 0);

  const raw = {};
  DIRECT_FIELD_SPECS.forEach((spec) => {
    raw[spec.rawKey] = String(readNumber(spec.uiKey, spec.defaultValue));
    if (typeof spec.defaultValue === 'string') raw[spec.rawKey] = readText(spec.uiKey, spec.defaultValue);
  });
  raw.improvements = toSignedIntString(encodeBits(IMPROVEMENTS_BITS));
  raw.other_char = toSignedIntString(encodeBits({
    coastalinstallation: OTHER_CHAR_BITS.coastalinstallation,
    militaristic: OTHER_CHAR_BITS.militaristic,
    wonder: OTHER_CHAR_BITS.wonder,
    smallwonder: OTHER_CHAR_BITS.smallwonder,
    continentalmoodeffects: OTHER_CHAR_BITS.continentalmoodeffects,
    scientific: OTHER_CHAR_BITS.scientific,
    commercial: OTHER_CHAR_BITS.commercial,
    expansionist: OTHER_CHAR_BITS.expansionist,
    religious: OTHER_CHAR_BITS.religious,
    industrious: OTHER_CHAR_BITS.industrious,
    agricultural: OTHER_CHAR_BITS.agricultural,
    seafaring: OTHER_CHAR_BITS.seafaring
  }));
  raw.small_wonder_characteristics = toSignedIntString(encodeBits(SMALL_WONDER_BITS));
  raw.wonder_characteristics = toSignedIntString(encodeBits(WONDER_BITS));
  let flavors = 0;
  for (let idx = 0; idx < flavorCount; idx += 1) {
    if (readBool(`flavor_${idx + 1}`)) flavors |= (2 ** idx);
  }
  raw.flavors = toSignedIntString(flavors);
  if (byKey.has('name')) raw.name = readText('name', '');
  if (byKey.has('description')) raw.description = readText('description', '');
  return raw;
}

module.exports = {
  DIRECT_FIELD_SPECS,
  IMPROVEMENTS_BITS,
  OTHER_CHAR_BITS,
  SMALL_WONDER_BITS,
  WONDER_BITS,
  projectImprovementBiqFields,
  collapseImprovementBiqFields
};
