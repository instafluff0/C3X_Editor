'use strict';

// BIQ section parsers, serializers, and english-field generators.
// Supports Conquests (BICX, majorVersion=12) as primary target.

const { BiqReader, BiqWriter } = require('./biqBuffer');
const { decompress } = require('./decompress');
const log = require('../log');
const iconv = require('iconv-lite');

let currentBiqTextEncoding = 'windows-1252';

function normalizeBiqTextEncoding(value) {
  const raw = String(value || 'windows-1252').trim().toLowerCase();
  const aliases = {
    'windows-1252': 'windows-1252',
    cp1252: 'windows-1252',
    latin1: 'windows-1252',
    'windows-1251': 'windows-1251',
    cp1251: 'windows-1251',
    gbk: 'gbk',
    cp936: 'gbk',
    big5: 'big5',
    cp950: 'big5',
    shift_jis: 'shift_jis',
    'shift-jis': 'shift_jis',
    sjis: 'shift_jis',
    cp932: 'shift_jis',
    'euc-kr': 'euc-kr',
    euc_kr: 'euc-kr',
    cp949: 'euc-kr',
    utf8: 'utf8',
    'utf-8': 'utf8'
  };
  return aliases[raw] || 'windows-1252';
}

function decodeBiqTextBytes(buffer, encoding = currentBiqTextEncoding) {
  const codec = normalizeBiqTextEncoding(encoding);
  if (codec === 'windows-1252') return iconv.decode(buffer, 'win1252');
  return iconv.decode(buffer, codec);
}

function setCurrentBiqTextEncoding(encoding) {
  currentBiqTextEncoding = normalizeBiqTextEncoding(encoding);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readStr(buf, offset, len) {
  let end = 0;
  while (end < len && buf[offset + end] !== 0) end++;
  return decodeBiqTextBytes(buf.subarray(offset, offset + end));
}

function writeStr(w, str, len) {
  const encoded = iconv.encode(String(str || ''), normalizeBiqTextEncoding(currentBiqTextEncoding));
  if (encoded.length >= len) {
    w.writeString(decodeBiqTextBytes(encoded.subarray(0, Math.max(0, len - 1))), len, currentBiqTextEncoding);
    return;
  }
  w.writeString(str || '', len, currentBiqTextEncoding);
}

function lines(pairs) {
  return pairs.filter((p) => p != null).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function parseIntMaybe(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// IO context (shared during a full parse pass)
// ---------------------------------------------------------------------------

class BiqIO {
  constructor(opts = {}) {
    this.versionTag = opts.versionTag || 'BICX';
    this.majorVersion = opts.majorVersion || 12;
    this.minorVersion = opts.minorVersion || 8;
    this.numEras = opts.numEras || 3;
    this.mapWidth = opts.mapWidth || 0;
    this.textEncoding = normalizeBiqTextEncoding(opts.textEncoding);
    this.isConquests = this.versionTag.startsWith('BIC') && this.majorVersion === 12;
    this.isPTWPlus = this.versionTag.startsWith('BIC') && this.majorVersion >= 2;
  }
}

// ---------------------------------------------------------------------------
// Per-section parsers
// Each parser takes (data: Buffer, io: BiqIO) and returns a plain object.
// data is the record body (after the 4-byte dataLen prefix).
// ---------------------------------------------------------------------------

function parseTECH(data, io) {
  let off = 0;
  const name = readStr(data, off, 32); off += 32;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const cost = data.readInt32LE(off); off += 4;
  const era = data.readInt32LE(off); off += 4;
  const advanceIcon = data.readInt32LE(off); off += 4;
  const x = data.readInt32LE(off); off += 4;
  const y = data.readInt32LE(off); off += 4;
  const prerequisites = [];
  for (let i = 0; i < 4; i++) { prerequisites.push(data.readInt32LE(off)); off += 4; }
  const flags = data.readInt32LE(off); off += 4;
  let flavors = 0, questionMark = 0;
  if (io.isConquests && off + 8 <= data.length) {
    flavors = data.readInt32LE(off); off += 4;
    questionMark = data.readInt32LE(off); off += 4;
  }
  return { name, civilopediaEntry, cost, era, advanceIcon, x, y, prerequisites, flags, flavors, questionMark };
}

function serializeTECH(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.name, 32);
  writeStr(w, rec.civilopediaEntry, 32);
  w.writeInt(rec.cost | 0);
  w.writeInt(rec.era | 0);
  w.writeInt(rec.advanceIcon | 0);
  w.writeInt(rec.x | 0);
  w.writeInt(rec.y | 0);
  const prereqs = Array.isArray(rec.prerequisites) ? rec.prerequisites : [-1, -1, -1, -1];
  for (let i = 0; i < 4; i++) w.writeInt(prereqs[i] != null ? (prereqs[i] | 0) : -1);
  w.writeInt(rec.flags | 0);
  if (io.isConquests) {
    w.writeInt(rec.flavors | 0);
    w.writeInt(rec.questionMark | 0);
  }
  return w.toBuffer();
}

function toEnglishTECH(rec, io) {
  const prereqs = Array.isArray(rec.prerequisites) ? rec.prerequisites : [-1, -1, -1, -1];
  return lines([
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['cost', String(rec.cost | 0)],
    ['era', String(rec.era | 0)],
    ['advanceIcon', String(rec.advanceIcon | 0)],
    ['x', String(rec.x | 0)],
    ['y', String(rec.y | 0)],
    ...prereqs.map((p, i) => [`prerequisite${i + 1}`, String(p != null ? (p | 0) : -1)]),
    ['flags', String(rec.flags | 0)],
    io.isConquests ? ['flavors', String(rec.flavors | 0)] : null,
    io.isConquests ? ['questionMark', String(rec.questionMark | 0)] : null,
  ]);
}

const WRITABLE_TECH = ['name', 'cost', 'era', 'advance_icon', 'x', 'y', 'prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4', 'flags', 'flavors'];

// ---------------------------------------------------------------------------
// BLDG
// ---------------------------------------------------------------------------

const BLDG_SCALAR_NAMES = [
  'doublesHappiness', 'gainInEveryCity', 'gainOnContinent', 'reqImprovement',
  'cost', 'culture', 'bombardDefence', 'navalBombardDefence', 'defenceBonus', 'navalDefenceBonus',
  'maintenanceCost', 'happyAll', 'happy', 'unhappyAll', 'unhappy', 'numReqBuildings', 'airPower',
  'navalPower', 'pollution', 'production', 'reqGovernment', 'spaceshipPart',
  'reqAdvance', 'obsoleteBy', 'reqResource1', 'reqResource2', 'improvements', 'otherChar',
  'smallWonderCharacteristics', 'wonderCharacteristics', 'armiesRequired', 'flavors', 'questionMark',
  'unitProduced', 'unitFrequency'
];

function parseBLDG(data, io) {
  let off = 0;
  const description = readStr(data, off, 64); off += 64;
  const name = readStr(data, off, 32); off += 32;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const scalars = {};
  for (const sn of BLDG_SCALAR_NAMES) {
    if (off + 4 > data.length) { scalars[sn] = 0; continue; }
    scalars[sn] = data.readInt32LE(off); off += 4;
  }
  return { description, name, civilopediaEntry, ...scalars };
}

function serializeBLDG(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.description, 64);
  writeStr(w, rec.name, 32);
  writeStr(w, rec.civilopediaEntry, 32);
  for (const sn of BLDG_SCALAR_NAMES) {
    w.writeInt((rec[sn] != null ? rec[sn] : 0) | 0);
  }
  return w.toBuffer();
}

function toEnglishBLDG(rec, io) {
  const pairs = [
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['description', rec.description || ''],
  ];
  for (const sn of BLDG_SCALAR_NAMES) {
    const k = sn.replace(/([A-Z])/g, (m) => '_' + m.toLowerCase());
    pairs.push([k, String((rec[sn] != null ? rec[sn] : 0) | 0)]);
  }
  return lines(pairs);
}

const WRITABLE_BLDG = ['name', 'description', 'cost', 'culture', 'maintenance_cost', 'req_advance', 'obsolete_by', 'req_resource1', 'req_resource2', 'req_government', 'req_improvement', 'doubles_happiness', 'gain_in_every_city', 'gain_on_continent', 'defence_bonus', 'naval_defence_bonus', 'bombard_defence', 'naval_bombard_defence', 'happy_all', 'happy', 'unhappy_all', 'unhappy', 'num_req_buildings', 'air_power', 'naval_power', 'pollution', 'production', 'spaceship_part', 'other_char', 'small_wonder_characteristics', 'wonder_characteristics', 'armies_required', 'flavors', 'unit_produced', 'unit_frequency'];

// ---------------------------------------------------------------------------
// GOOD (Resources)
// ---------------------------------------------------------------------------

function parseGOOD(data, io) {
  let off = 0;
  const name = readStr(data, off, 24); off += 24;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const type = data.readInt32LE(off); off += 4;
  const appearanceRatio = data.readInt32LE(off); off += 4;
  const disapperanceProbability = data.readInt32LE(off); off += 4;
  const icon = data.readInt32LE(off); off += 4;
  const prerequisite = data.readInt32LE(off); off += 4;
  const foodBonus = data.readInt32LE(off); off += 4;
  const shieldsBonus = data.readInt32LE(off); off += 4;
  const commerceBonus = data.readInt32LE(off); off += 4;
  return { name, civilopediaEntry, type, appearanceRatio, disapperanceProbability, icon, prerequisite, foodBonus, shieldsBonus, commerceBonus };
}

function serializeGOOD(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.name, 24);
  writeStr(w, rec.civilopediaEntry, 32);
  w.writeInt(rec.type | 0);
  w.writeInt(rec.appearanceRatio | 0);
  w.writeInt(rec.disapperanceProbability | 0);
  w.writeInt(rec.icon | 0);
  w.writeInt(rec.prerequisite | 0);
  w.writeInt(rec.foodBonus | 0);
  w.writeInt(rec.shieldsBonus | 0);
  w.writeInt(rec.commerceBonus | 0);
  return w.toBuffer();
}

function toEnglishGOOD(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['type', String(rec.type | 0)],
    ['appearanceRatio', String(rec.appearanceRatio | 0)],
    ['disapperanceProbability', String(rec.disapperanceProbability | 0)],
    ['icon', String(rec.icon | 0)],
    ['prerequisite', String(rec.prerequisite | 0)],
    ['foodBonus', String(rec.foodBonus | 0)],
    ['shieldsBonus', String(rec.shieldsBonus | 0)],
    ['commerceBonus', String(rec.commerceBonus | 0)],
  ]);
}

const WRITABLE_GOOD = ['name', 'type', 'appearance_ratio', 'disapperance_probability', 'icon', 'prerequisite', 'food_bonus', 'shields_bonus', 'commerce_bonus'];

// ---------------------------------------------------------------------------
// GOVT (Governments)
// ---------------------------------------------------------------------------

function parseGOVT(data, io) {
  let off = 0;
  const defaultType = data.readInt32LE(off); off += 4;
  const transitionType = data.readInt32LE(off); off += 4;
  const requiresMaintenance = data.readInt32LE(off); off += 4;
  const questionMark1 = data.readInt32LE(off); off += 4;
  const tilePenalty = data.readInt32LE(off); off += 4;
  const commerceBonus = data.readInt32LE(off); off += 4;
  const name = readStr(data, off, 64); off += 64;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  // 8 ruler title strings × 32 bytes each
  const rulerTitles = [];
  for (let i = 0; i < 8; i++) { rulerTitles.push(readStr(data, off, 32)); off += 32; }
  const corruption = data.readInt32LE(off); off += 4;
  const immuneTo = data.readInt32LE(off); off += 4;
  const diplomatLevel = data.readInt32LE(off); off += 4;
  const spyLevel = data.readInt32LE(off); off += 4;
  const numGovts = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  // numGovts × 3 int32 relations
  const relations = [];
  for (let i = 0; i < numGovts && off + 12 <= data.length; i++) {
    const canBribe = data.readInt32LE(off); off += 4;
    const briberyMod = data.readInt32LE(off); off += 4;
    const resistanceMod = data.readInt32LE(off); off += 4;
    relations.push({ canBribe, briberyMod, resistanceMod });
  }
  const scalars2 = {};
  const s2names = ['hurrying', 'assimilation', 'draftLimit', 'militaryPolice', 'rulerTitlePairsUsed',
    'prerequisiteTechnology', 'scienceCap', 'workerRate', 'qm2', 'qm3', 'qm4',
    'freeUnits', 'perTown', 'perCity', 'perMetropolis', 'costPerUnit', 'warWeariness'];
  for (const sn of s2names) {
    scalars2[sn] = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  }
  let xenophobic = 0, forceResettlement = 0;
  if (io.isConquests && off + 8 <= data.length) {
    xenophobic = data.readInt32LE(off); off += 4;
    forceResettlement = data.readInt32LE(off); off += 4;
  }
  return {
    defaultType, transitionType, requiresMaintenance, questionMark1, tilePenalty, commerceBonus,
    name, civilopediaEntry, rulerTitles, corruption, immuneTo, diplomatLevel, spyLevel,
    numGovts, relations, ...scalars2, xenophobic, forceResettlement
  };
}

function serializeGOVT(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.defaultType | 0);
  w.writeInt(rec.transitionType | 0);
  w.writeInt(rec.requiresMaintenance | 0);
  w.writeInt(rec.questionMark1 | 0);
  w.writeInt(rec.tilePenalty | 0);
  w.writeInt(rec.commerceBonus | 0);
  writeStr(w, rec.name, 64);
  writeStr(w, rec.civilopediaEntry, 32);
  const titles = Array.isArray(rec.rulerTitles) ? rec.rulerTitles : [];
  for (let i = 0; i < 8; i++) writeStr(w, titles[i] || '', 32);
  w.writeInt(rec.corruption | 0);
  w.writeInt(rec.immuneTo | 0);
  w.writeInt(rec.diplomatLevel | 0);
  w.writeInt(rec.spyLevel | 0);
  const rels = Array.isArray(rec.relations) ? rec.relations : [];
  w.writeInt(rels.length);
  for (const r of rels) {
    w.writeInt((r.canBribe != null ? r.canBribe : 0) | 0);
    w.writeInt((r.briberyMod != null ? r.briberyMod : 0) | 0);
    w.writeInt((r.resistanceMod != null ? r.resistanceMod : 0) | 0);
  }
  const s2names = ['hurrying', 'assimilation', 'draftLimit', 'militaryPolice', 'rulerTitlePairsUsed',
    'prerequisiteTechnology', 'scienceCap', 'workerRate', 'qm2', 'qm3', 'qm4',
    'freeUnits', 'perTown', 'perCity', 'perMetropolis', 'costPerUnit', 'warWeariness'];
  for (const sn of s2names) w.writeInt((rec[sn] != null ? rec[sn] : 0) | 0);
  if (io.isConquests) {
    w.writeInt(rec.xenophobic | 0);
    w.writeInt(rec.forceResettlement | 0);
  }
  return w.toBuffer();
}

function toEnglishGOVT(rec, io) {
  const pairs = [
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['defaultType', String(rec.defaultType | 0)],
    ['transitionType', String(rec.transitionType | 0)],
    ['requiresMaintenance', String(rec.requiresMaintenance | 0)],
    ['tilePenalty', String(rec.tilePenalty | 0)],
    ['commerceBonus', String(rec.commerceBonus | 0)],
    ['corruption', String(rec.corruption | 0)],
    ['immuneTo', String(rec.immuneTo | 0)],
    ['diplomatLevel', String(rec.diplomatLevel | 0)],
    ['spyLevel', String(rec.spyLevel | 0)],
    ['hurrying', String(rec.hurrying | 0)],
    ['assimilation', String(rec.assimilation | 0)],
    ['draftLimit', String(rec.draftLimit | 0)],
    ['militaryPolice', String(rec.militaryPolice | 0)],
    ['prerequisiteTechnology', String(rec.prerequisiteTechnology | 0)],
    ['scienceCap', String(rec.scienceCap | 0)],
    ['workerRate', String(rec.workerRate | 0)],
    ['questionMark1', String(rec.questionMark1 | 0)],
    ['qm2', String(rec.qm2 | 0)],
    ['qm3', String(rec.qm3 | 0)],
    ['qm4', String(rec.qm4 | 0)],
    ['freeUnits', String(rec.freeUnits | 0)],
    ['perTown', String(rec.perTown | 0)],
    ['perCity', String(rec.perCity | 0)],
    ['perMetropolis', String(rec.perMetropolis | 0)],
    ['costPerUnit', String(rec.costPerUnit | 0)],
    ['warWeariness', String(rec.warWeariness | 0)],
    ['rulerTitlePairsUsed', String(rec.rulerTitlePairsUsed | 0)],
  ];
  const titles = Array.isArray(rec.rulerTitles) ? rec.rulerTitles : [];
  const titleLabels = ['maleTitleEra1', 'femaleTitleEra1', 'maleTitleEra2', 'femaleTitleEra2',
    'maleTitleEra3', 'femaleTitleEra3', 'maleTitleEra4', 'femaleTitleEra4'];
  for (let i = 0; i < 8; i++) pairs.push([titleLabels[i] || `rulerTitle${i + 1}`, titles[i] || '']);
  const rels = Array.isArray(rec.relations) ? rec.relations : [];
  pairs.push(['numGovts', String(rels.length)]);
  rels.forEach((r, i) => {
    pairs.push([`govt_relation_${i}_can_bribe`, String((r.canBribe != null ? r.canBribe : 0) | 0)]);
    pairs.push([`govt_relation_${i}_bribery_mod`, String((r.briberyMod != null ? r.briberyMod : 0) | 0)]);
    pairs.push([`govt_relation_${i}_resistance_mod`, String((r.resistanceMod != null ? r.resistanceMod : 0) | 0)]);
  });
  if (io.isConquests) {
    pairs.push(['xenophobic', String(rec.xenophobic | 0)]);
    pairs.push(['forceResettlement', String(rec.forceResettlement | 0)]);
  }
  return lines(pairs);
}

const WRITABLE_GOVT = ['name', 'default_type', 'transition_type', 'requires_maintenance', 'tile_penalty', 'commerce_bonus', 'corruption', 'immune_to', 'diplomat_level', 'spy_level', 'hurrying', 'assimilation', 'draft_limit', 'military_police', 'prerequisite_technology', 'science_cap', 'worker_rate', 'free_units', 'per_town', 'per_city', 'per_metropolis', 'cost_per_unit', 'war_weariness'];

// ---------------------------------------------------------------------------
// RACE (Civilizations)
// ---------------------------------------------------------------------------

function parseRACE(data, io) {
  let off = 0;
  const numCities = data.readInt32LE(off); off += 4;
  const cityNames = [];
  for (let i = 0; i < numCities && off + 24 <= data.length; i++) {
    cityNames.push(readStr(data, off, 24)); off += 24;
  }
  const numMilLeaders = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const milLeaderNames = [];
  for (let i = 0; i < numMilLeaders && off + 32 <= data.length; i++) {
    milLeaderNames.push(readStr(data, off, 32)); off += 32;
  }
  const name = readStr(data, off, 32); off += 32; // leaderName
  const leaderTitle = readStr(data, off, 24); off += 24;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const adjective = readStr(data, off, 40); off += 40;
  const civilizationName = readStr(data, off, 40); off += 40;
  const noun = readStr(data, off, 40); off += 40;
  // numEras × forward + reverse filenames (260 bytes each)
  const forwardFilenames = [];
  const reverseFilenames = [];
  for (let i = 0; i < io.numEras && off + 260 <= data.length; i++) {
    forwardFilenames.push(readStr(data, off, 260)); off += 260;
  }
  for (let i = 0; i < io.numEras && off + 260 <= data.length; i++) {
    reverseFilenames.push(readStr(data, off, 260)); off += 260;
  }
  const cultureGroup = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const leaderGender = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const civilizationGender = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const aggressionLevel = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const uniqueCivCounter = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const shunnedGovernment = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const favoriteGovernment = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const defaultColor = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const uniqueColor = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const freeTechs = [];
  for (let i = 0; i < 4 && off + 4 <= data.length; i++) {
    freeTechs.push(data.readInt32LE(off)); off += 4;
  }
  const bonuses = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const governorSettings = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const buildNever = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const buildOften = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const plurality = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  // PTW+ kingUnit
  let kingUnit = 0;
  if (io.isPTWPlus && off + 4 <= data.length) { kingUnit = data.readInt32LE(off); off += 4; }
  // Conquests extras
  let flavors = 0, questionMark = 0, diplomacyTextIndex = 0;
  let numScientificLeaders = 0;
  const scientificLeaderNames = [];
  if (io.isConquests) {
    if (off + 4 <= data.length) { flavors = data.readInt32LE(off); off += 4; }
    if (off + 4 <= data.length) { questionMark = data.readInt32LE(off); off += 4; }
    if (off + 4 <= data.length) { diplomacyTextIndex = data.readInt32LE(off); off += 4; }
    if (off + 4 <= data.length) { numScientificLeaders = data.readInt32LE(off); off += 4; }
    for (let i = 0; i < numScientificLeaders && off + 32 <= data.length; i++) {
      scientificLeaderNames.push(readStr(data, off, 32)); off += 32;
    }
  }
  return {
    numCities, cityNames, numMilLeaders, milLeaderNames,
    name, leaderTitle, civilopediaEntry, adjective, civilizationName, noun,
    forwardFilenames, reverseFilenames,
    cultureGroup, leaderGender, civilizationGender, aggressionLevel,
    uniqueCivCounter, shunnedGovernment, favoriteGovernment, defaultColor, uniqueColor,
    freeTechs, bonuses, governorSettings, buildNever, buildOften, plurality,
    kingUnit, flavors, questionMark, diplomacyTextIndex,
    numScientificLeaders, scientificLeaderNames
  };
}

function serializeRACE(rec, io) {
  const w = new BiqWriter();
  const cityNames = Array.isArray(rec.cityNames) ? rec.cityNames : [];
  w.writeInt(cityNames.length);
  for (const cn of cityNames) writeStr(w, cn, 24);
  const milLeaderNames = Array.isArray(rec.milLeaderNames) ? rec.milLeaderNames : [];
  w.writeInt(milLeaderNames.length);
  for (const ml of milLeaderNames) writeStr(w, ml, 32);
  writeStr(w, rec.name, 32);
  writeStr(w, rec.leaderTitle, 24);
  writeStr(w, rec.civilopediaEntry, 32);
  writeStr(w, rec.adjective, 40);
  writeStr(w, rec.civilizationName, 40);
  writeStr(w, rec.noun, 40);
  const fwd = Array.isArray(rec.forwardFilenames) ? rec.forwardFilenames : [];
  const rev = Array.isArray(rec.reverseFilenames) ? rec.reverseFilenames : [];
  for (let i = 0; i < io.numEras; i++) writeStr(w, fwd[i] || '', 260);
  for (let i = 0; i < io.numEras; i++) writeStr(w, rev[i] || '', 260);
  w.writeInt(rec.cultureGroup | 0);
  w.writeInt(rec.leaderGender | 0);
  w.writeInt(rec.civilizationGender | 0);
  w.writeInt(rec.aggressionLevel | 0);
  w.writeInt(rec.uniqueCivCounter | 0);
  w.writeInt(rec.shunnedGovernment | 0);
  w.writeInt(rec.favoriteGovernment | 0);
  w.writeInt(rec.defaultColor | 0);
  w.writeInt(rec.uniqueColor | 0);
  const ft = Array.isArray(rec.freeTechs) ? rec.freeTechs : [-1, -1, -1, -1];
  for (let i = 0; i < 4; i++) w.writeInt((ft[i] != null ? ft[i] : -1) | 0);
  w.writeInt(rec.bonuses | 0);
  w.writeInt(rec.governorSettings | 0);
  w.writeInt(rec.buildNever | 0);
  w.writeInt(rec.buildOften | 0);
  w.writeInt(rec.plurality | 0);
  if (io.isPTWPlus) w.writeInt(rec.kingUnit | 0);
  if (io.isConquests) {
    w.writeInt(rec.flavors | 0);
    w.writeInt(rec.questionMark | 0);
    w.writeInt(rec.diplomacyTextIndex | 0);
    const sl = Array.isArray(rec.scientificLeaderNames) ? rec.scientificLeaderNames : [];
    w.writeInt(sl.length);
    for (const sln of sl) writeStr(w, sln, 32);
  }
  return w.toBuffer();
}

function toEnglishRACE(rec, io) {
  const pairs = [
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['leaderTitle', rec.leaderTitle || ''],
    ['adjective', rec.adjective || ''],
    ['civilizationName', rec.civilizationName || ''],
    ['noun', rec.noun || ''],
    ['cultureGroup', String(rec.cultureGroup | 0)],
    ['leaderGender', String(rec.leaderGender | 0)],
    ['civilizationGender', String(rec.civilizationGender | 0)],
    ['aggressionLevel', String(rec.aggressionLevel | 0)],
    ['favoriteGovernment', String(rec.favoriteGovernment | 0)],
    ['shunnedGovernment', String(rec.shunnedGovernment | 0)],
    ['defaultColor', String(rec.defaultColor | 0)],
    ['uniqueColor', String(rec.uniqueColor | 0)],
    ['uniqueCivCounter', String(rec.uniqueCivCounter | 0)],
    ['governorSettings', String(rec.governorSettings | 0)],
    ['bonuses', String(rec.bonuses | 0)],
    ['buildNever', String(rec.buildNever | 0)],
    ['buildOften', String(rec.buildOften | 0)],
    ['plurality', String(rec.plurality | 0)],
  ];
  const ft = Array.isArray(rec.freeTechs) ? rec.freeTechs : [-1, -1, -1, -1];
  ft.forEach((v, i) => pairs.push([`freeTech${i + 1}`, String(v != null ? (v | 0) : -1)]));
  const cityNames = Array.isArray(rec.cityNames) ? rec.cityNames : [];
  pairs.push(['numCities', String(cityNames.length)]);
  cityNames.forEach((cn, i) => pairs.push([`cityName_${i}`, cn || '']));
  const milLeaderNames = Array.isArray(rec.milLeaderNames) ? rec.milLeaderNames : [];
  pairs.push(['numMilLeaders', String(milLeaderNames.length)]);
  milLeaderNames.forEach((ml, i) => pairs.push([`milLeader_${i}`, ml || '']));
  const fwd = Array.isArray(rec.forwardFilenames) ? rec.forwardFilenames : [];
  fwd.forEach((fn, i) => pairs.push([`forwardFilename_${i}`, fn || '']));
  const rev = Array.isArray(rec.reverseFilenames) ? rec.reverseFilenames : [];
  rev.forEach((fn, i) => pairs.push([`reverseFilename_${i}`, fn || '']));
  if (io.isPTWPlus) {
    pairs.push(['kingUnit', String(rec.kingUnit | 0)]);
  }
  if (io.isConquests) {
    pairs.push(['flavors', String(rec.flavors | 0)]);
    pairs.push(['questionMark', String(rec.questionMark | 0)]);
    pairs.push(['diplomacyTextIndex', String(rec.diplomacyTextIndex | 0)]);
    const sl = Array.isArray(rec.scientificLeaderNames) ? rec.scientificLeaderNames : [];
    pairs.push(['numScientificLeaders', String(sl.length)]);
    sl.forEach((sln, i) => pairs.push([`scientificLeader_${i}`, sln || '']));
  }
  return lines(pairs);
}

const WRITABLE_RACE = ['name', 'leader_title', 'adjective', 'civilization_name', 'noun', 'culture_group', 'leader_gender', 'civilization_gender', 'aggression_level', 'favorite_government', 'shunned_government', 'default_color', 'unique_color', 'unique_civ_counter', 'governor_settings', 'bonuses', 'build_never', 'build_often', 'plurality', 'free_tech1', 'free_tech2', 'free_tech3', 'free_tech4', 'king_unit', 'flavors', 'question_mark', 'diplomacy_text_index'];

// ---------------------------------------------------------------------------
// PRTO (Unit Types)
// ---------------------------------------------------------------------------

const PRTO_PRIMARY_SCALAR_FIELDS = [
  'bombardStrength', 'bombardRange', 'capacity', 'shieldCost', 'defence', 'iconIndex', 'attack',
  'operationalRange', 'populationCost', 'rateOfFire', 'movement', 'requiredTech', 'upgradeTo',
  'requiredResource1', 'requiredResource2', 'requiredResource3'
];

const PRTO_MID_SCALAR_FIELDS = [
  'unitAbilities', 'AIStrategy', 'availableTo', 'standardOrdersSpecialActions', 'airMissions',
  'unitClass', 'otherStrategy', 'hitPointBonus', 'PTWStandardOrders', 'PTWSpecialActions',
  'PTWWorkerActions', 'PTWAirMissions', 'PTWActionsMix'
];

function readIntSafe(buf, offset, fallback = 0) {
  if (offset + 4 > buf.length) return fallback;
  return buf.readInt32LE(offset);
}

function readFloatSafe(buf, offset, fallback = 0) {
  if (offset + 4 > buf.length) return fallback;
  return buf.readFloatLE(offset);
}

function readByteSafe(buf, offset, fallback = 0) {
  if (offset >= buf.length) return fallback;
  return buf[offset];
}

function writeIntArray(writer, values, count, fallback = -1) {
  const list = Array.isArray(values) ? values : [];
  for (let i = 0; i < count; i += 1) {
    const value = list[i];
    writer.writeInt(Number.isFinite(value) ? value : fallback);
  }
}

function cloneIntList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value));
}

function parseEditInt(value, fallback = NaN) {
  const raw = String(value).trim();
  const lowered = raw.toLowerCase();
  if (lowered === 'true' || lowered === 'yes' || lowered === 'on' || lowered === 'enabled') return 1;
  if (lowered === 'false' || lowered === 'no' || lowered === 'off' || lowered === 'disabled') return 0;
  let n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    const match = raw.match(/\((-?\d+)\)$/);
    if (match) n = Number.parseInt(match[1], 10);
  }
  if (!Number.isFinite(n) && raw === 'None') n = -1;
  return Number.isFinite(n) ? n : fallback;
}

function ensureArraySize(arr, size, fillValue) {
  const next = Array.isArray(arr) ? arr.slice() : [];
  while (next.length < size) next.push(fillValue);
  return next;
}

function parsePRTO(data, io) {
  let off = 0;
  if (data.length < 68) return { name: '', civilopediaEntry: '', _rawData: data };

  const rec = {
    zoneOfControl: readIntSafe(data, off, 0)
  };
  off += 4;
  rec.name = readStr(data, off, 32); off += 32;
  rec.civilopediaEntry = readStr(data, off, 32); off += 32;

  PRTO_PRIMARY_SCALAR_FIELDS.forEach((key) => {
    rec[key] = readIntSafe(data, off, key === 'upgradeTo' || key === 'requiredTech' || key.startsWith('requiredResource') ? -1 : 0);
    off += 4;
  });

  PRTO_MID_SCALAR_FIELDS.forEach((key) => {
    rec[key] = readIntSafe(data, off, 0);
    off += 4;
  });

  const terrainCount = io && io.isConquests ? 14 : 12;
  rec.PTWActionsMix = (rec.PTWActionsMix | 0) - 65536;
  rec.bombardEffects = readIntSafe(data, off, 0); off += 4;
  rec.ignoreMovementCost = [];
  for (let i = 0; i < terrainCount; i += 1) {
    rec.ignoreMovementCost.push(readByteSafe(data, off, 0));
    off += 1;
  }
  rec.requiresSupport = readIntSafe(data, off, 0); off += 4;

  if (io && io.isConquests) {
    rec.useExactCost = readIntSafe(data, off, 7); off += 4;
    rec.telepadRange = readIntSafe(data, off, 0); off += 4;
    rec.questionMark3 = readIntSafe(data, off, 1); off += 4;

    const numLegalUnitTelepads = Math.max(0, readIntSafe(data, off, 0)); off += 4;
    rec.legalUnitTelepads = [];
    for (let i = 0; i < numLegalUnitTelepads; i += 1) {
      rec.legalUnitTelepads.push(readIntSafe(data, off, -1));
      off += 4;
    }

    rec.enslaveResultsIn = readIntSafe(data, off, -1); off += 4;
    rec.questionMark5 = readIntSafe(data, off, 1); off += 4;

    const numStealthTargets = Math.max(0, readIntSafe(data, off, 0)); off += 4;
    rec.stealthTargets = [];
    for (let i = 0; i < numStealthTargets; i += 1) {
      rec.stealthTargets.push(readIntSafe(data, off, -1));
      off += 4;
    }

    rec.questionMark6 = readIntSafe(data, off, 1); off += 4;

    const numLegalBuildingTelepads = Math.max(0, readIntSafe(data, off, 0)); off += 4;
    rec.legalBuildingTelepads = [];
    for (let i = 0; i < numLegalBuildingTelepads; i += 1) {
      rec.legalBuildingTelepads.push(readIntSafe(data, off, -1));
      off += 4;
    }

    rec.createsCraters = readByteSafe(data, off, 0); off += 1;
    rec.workerStrengthFloat = readFloatSafe(data, off, 0); off += 4;
    rec.questionMark8 = readIntSafe(data, off, 0); off += 4;
    rec.airDefence = readIntSafe(data, off, 0); off += 4;
  } else {
    rec.useExactCost = 7;
    rec.telepadRange = 0;
    rec.questionMark3 = 1;
    rec.legalUnitTelepads = [];
    rec.enslaveResultsIn = -1;
    rec.questionMark5 = 1;
    rec.stealthTargets = [];
    rec.questionMark6 = 1;
    rec.legalBuildingTelepads = [];
    rec.createsCraters = 0;
    rec.workerStrengthFloat = 0;
    rec.questionMark8 = 0;
    rec.airDefence = 0;
  }

  rec._tail = off < data.length ? Buffer.from(data.subarray(off)) : Buffer.alloc(0);
  return rec;
}

function serializePRTO(rec, io) {
  if (rec._rawData) return Buffer.from(rec._rawData);
  const w = new BiqWriter();
  w.writeInt(rec.zoneOfControl | 0);
  writeStr(w, rec.name, 32);
  writeStr(w, rec.civilopediaEntry, 32);
  PRTO_PRIMARY_SCALAR_FIELDS.forEach((key) => w.writeInt((rec[key] != null ? rec[key] : 0) | 0));
  PRTO_MID_SCALAR_FIELDS.forEach((key) => {
    if (key === 'PTWActionsMix') {
      w.writeInt(((rec.PTWActionsMix | 0) + 65536) | 0);
      return;
    }
    w.writeInt((rec[key] != null ? rec[key] : 0) | 0);
  });
  w.writeInt(rec.bombardEffects | 0);

  const terrainCount = io && io.isConquests ? 14 : 12;
  const ignoreMovementCost = Array.isArray(rec.ignoreMovementCost) ? rec.ignoreMovementCost : [];
  for (let i = 0; i < terrainCount; i += 1) {
    w.writeByte(Number(ignoreMovementCost[i] || 0) & 0xff);
  }
  w.writeInt(rec.requiresSupport | 0);

  if (io && io.isConquests) {
    w.writeInt(rec.useExactCost == null ? 7 : (rec.useExactCost | 0));
    w.writeInt(rec.telepadRange | 0);
    w.writeInt(rec.questionMark3 == null ? 1 : (rec.questionMark3 | 0));
    const legalUnitTelepads = cloneIntList(rec.legalUnitTelepads);
    w.writeInt(legalUnitTelepads.length);
    writeIntArray(w, legalUnitTelepads, legalUnitTelepads.length, -1);
    w.writeInt(rec.enslaveResultsIn == null ? -1 : (rec.enslaveResultsIn | 0));
    w.writeInt(rec.questionMark5 == null ? 1 : (rec.questionMark5 | 0));
    const stealthTargets = cloneIntList(rec.stealthTargets);
    w.writeInt(stealthTargets.length);
    writeIntArray(w, stealthTargets, stealthTargets.length, -1);
    w.writeInt(rec.questionMark6 == null ? 1 : (rec.questionMark6 | 0));
    const legalBuildingTelepads = cloneIntList(rec.legalBuildingTelepads);
    w.writeInt(legalBuildingTelepads.length);
    writeIntArray(w, legalBuildingTelepads, legalBuildingTelepads.length, -1);
    w.writeByte(Number(rec.createsCraters || 0) & 0xff);
    w.writeFloat(Number.isFinite(rec.workerStrengthFloat) ? rec.workerStrengthFloat : 0);
    w.writeInt(rec.questionMark8 | 0);
    w.writeInt(rec.airDefence | 0);
  }

  if (rec._tail && rec._tail.length > 0) w.writeBytes(rec._tail);
  return w.toBuffer();
}

function toEnglishPRTO(rec, io) {
  if (rec._rawData) {
    const data = rec._rawData;
    const name = readStr(data, 4, 32);
    const civKey = readStr(data, 36, 32);
    return lines([['name', name], ['civilopediaEntry', civKey]]);
  }
  const pairs = [
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['zoneOfControl', String(rec.zoneOfControl | 0)]
  ];
  PRTO_PRIMARY_SCALAR_FIELDS.forEach((key) => {
    pairs.push([key, String(rec[key] != null ? rec[key] : 0)]);
  });
  PRTO_MID_SCALAR_FIELDS.forEach((key) => {
    pairs.push([key, String(rec[key] != null ? rec[key] : 0)]);
  });
  pairs.push(['bombardEffects', String(rec.bombardEffects | 0)]);
  (Array.isArray(rec.ignoreMovementCost) ? rec.ignoreMovementCost : []).forEach((value) => {
    pairs.push(['ignoreMovementCost', String(value | 0)]);
  });
  pairs.push(['requiresSupport', String(rec.requiresSupport | 0)]);
  if (io && io.isConquests) {
    pairs.push(['useExactCost', String(rec.useExactCost == null ? 7 : (rec.useExactCost | 0))]);
    pairs.push(['telepadRange', String(rec.telepadRange | 0)]);
    pairs.push(['questionMark3', String(rec.questionMark3 == null ? 1 : (rec.questionMark3 | 0))]);
    const legalUnitTelepads = cloneIntList(rec.legalUnitTelepads);
    pairs.push(['numLegalUnitTelepads', String(legalUnitTelepads.length)]);
    legalUnitTelepads.forEach((value) => pairs.push(['legalUnitTelepad', String(value)]));
    pairs.push(['enslaveResultsIn', String(rec.enslaveResultsIn == null ? -1 : (rec.enslaveResultsIn | 0))]);
    pairs.push(['questionMark5', String(rec.questionMark5 == null ? 1 : (rec.questionMark5 | 0))]);
    const stealthTargets = cloneIntList(rec.stealthTargets);
    pairs.push(['numStealthTargets', String(stealthTargets.length)]);
    stealthTargets.forEach((value) => pairs.push(['stealthTarget', String(value)]));
    pairs.push(['questionMark6', String(rec.questionMark6 == null ? 1 : (rec.questionMark6 | 0))]);
    const legalBuildingTelepads = cloneIntList(rec.legalBuildingTelepads);
    pairs.push(['numLegalBuildingTelepads', String(legalBuildingTelepads.length)]);
    legalBuildingTelepads.forEach((value) => pairs.push(['legalBuildingTelepad', String(value)]));
    pairs.push(['createsCraters', String(Number(rec.createsCraters || 0))]);
    pairs.push(['workerStrengthFloat', String(Number.isFinite(rec.workerStrengthFloat) ? rec.workerStrengthFloat : 0)]);
    pairs.push(['questionMark8', String(rec.questionMark8 | 0)]);
    pairs.push(['airDefence', String(rec.airDefence | 0)]);
  }
  return lines(pairs);
}

const WRITABLE_PRTO = [
  'name', 'zone_of_control',
  'bombard_strength', 'bombard_range', 'capacity', 'shield_cost', 'defence', 'icon_index', 'attack',
  'operational_range', 'population_cost', 'rate_of_fire', 'movement', 'required_tech', 'upgrade_to',
  'required_resource1', 'required_resource2', 'required_resource3',
  'unit_abilities', 'ai_strategy', 'available_to', 'standard_orders_special_actions', 'air_missions',
  'unit_class', 'other_strategy', 'hit_point_bonus', 'ptw_standard_orders', 'ptw_special_actions',
  'ptw_worker_actions', 'ptw_air_missions', 'ptw_actions_mix',
  'bombard_effects', 'ignore_movement_cost', 'requires_support',
  'use_exact_cost', 'telepad_range', 'question_mark3',
  'num_legal_unit_telepads', 'legal_unit_telepad',
  'enslave_results_in', 'question_mark5',
  'num_stealth_targets', 'stealth_target',
  'question_mark6',
  'num_legal_building_telepads', 'legal_building_telepad',
  'creates_craters', 'worker_strength_float', 'question_mark8', 'air_defence'
];

// ---------------------------------------------------------------------------
// CITY (scenario cities) - needed for ADD operations
// ---------------------------------------------------------------------------

function parseCITY(data, io) {
  let off = 0;
  if (data.length < 2) return { hasWalls: 0, hasPalace: 0, name: '', ownerType: 0, numBuildings: 0, buildings: [], culture: 0, owner: 0, size: 0, x: 0, y: 0, cityLevel: 0, borderLevel: 0, useAutoName: 0 };
  const hasWalls = data[off++];
  const hasPalace = data[off++];
  const name = readStr(data, off, 24); off += 24;
  const ownerType = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const numBuildings = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const buildings = [];
  for (let i = 0; i < numBuildings && off + 4 <= data.length; i++) {
    buildings.push(data.readInt32LE(off)); off += 4;
  }
  const culture = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const owner = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const size = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const x = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const y = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const cityLevel = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const borderLevel = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const useAutoName = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  return { hasWalls, hasPalace, name, ownerType, numBuildings, buildings, culture, owner, size, x, y, cityLevel, borderLevel, useAutoName };
}

function serializeCITY(rec, io) {
  const w = new BiqWriter();
  w.writeByte(rec.hasWalls | 0);
  w.writeByte(rec.hasPalace | 0);
  writeStr(w, rec.name, 24);
  w.writeInt(rec.ownerType | 0);
  const blds = Array.isArray(rec.buildings) ? rec.buildings : [];
  w.writeInt(blds.length);
  for (const b of blds) w.writeInt(b | 0);
  w.writeInt(rec.culture | 0);
  w.writeInt(rec.owner | 0);
  w.writeInt(rec.size || 1);
  w.writeInt(rec.x | 0);
  w.writeInt(rec.y | 0);
  w.writeInt(rec.cityLevel | 0);
  w.writeInt(rec.borderLevel | 0);
  w.writeInt(rec.useAutoName | 0);
  return w.toBuffer();
}

function toEnglishCITY(rec, io) {
  const pairs = [
    ['name', rec.name || ''],
    ['hasWalls', String(rec.hasWalls | 0)],
    ['hasPalace', String(rec.hasPalace | 0)],
    ['ownerType', String(rec.ownerType | 0)],
    ['owner', String(rec.owner | 0)],
    ['size', String(rec.size || 1)],
    ['x', String(rec.x | 0)],
    ['y', String(rec.y | 0)],
    ['culture', String(rec.culture | 0)],
    ['cityLevel', String(rec.cityLevel | 0)],
    ['borderLevel', String(rec.borderLevel | 0)],
    ['useAutoName', String(rec.useAutoName | 0)],
    ['numBuildings', String(Array.isArray(rec.buildings) ? rec.buildings.length : (rec.numBuildings | 0))],
  ];
  const blds = Array.isArray(rec.buildings) ? rec.buildings : [];
  blds.forEach((b, i) => pairs.push([i === 0 ? 'building' : `building_${i + 1}`, String(b | 0)]));
  return lines(pairs);
}

const WRITABLE_CITY = ['name', 'has_walls', 'has_palace', 'owner_type', 'owner', 'size', 'x', 'y', 'culture', 'city_level', 'border_level', 'use_auto_name', 'num_buildings', 'buildings'];

// ---------------------------------------------------------------------------
// UNIT (scenario map units)
// ---------------------------------------------------------------------------

function parseUNIT(data, io) {
  let off = 0;
  const name = readStr(data, off, 32); off += 32;
  const ownerType = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const experienceLevel = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const owner = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const pRTONumber = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const AIStrategy = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const x = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const y = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  // PTW+: customName(57 bytes) + useCivilizationKing(4)
  let customName = '';
  let useCivilizationKing = 0;
  if (io.isPTWPlus && off + 57 <= data.length) {
    customName = readStr(data, off, 57); off += 57;
    if (off + 4 <= data.length) { useCivilizationKing = data.readInt32LE(off); off += 4; }
  }
  return { name, ownerType, experienceLevel, owner, pRTONumber, AIStrategy, x, y, customName, useCivilizationKing };
}

function serializeUNIT(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.name, 32);
  w.writeInt(rec.ownerType | 0);
  w.writeInt(rec.experienceLevel | 0);
  w.writeInt(rec.owner | 0);
  w.writeInt(rec.pRTONumber | 0);
  w.writeInt(rec.AIStrategy | 0);
  w.writeInt(rec.x | 0);
  w.writeInt(rec.y | 0);
  if (io.isPTWPlus) {
    writeStr(w, rec.customName, 57);
    w.writeInt(rec.useCivilizationKing | 0);
  }
  return w.toBuffer();
}

function toEnglishUNIT(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['ownerType', String(rec.ownerType | 0)],
    ['owner', String(rec.owner | 0)],
    ['pRTONumber', String(rec.pRTONumber | 0)],
    ['AIStrategy', String(rec.AIStrategy | 0)],
    ['experienceLevel', String(rec.experienceLevel | 0)],
    ['x', String(rec.x | 0)],
    ['y', String(rec.y | 0)],
    io.isPTWPlus ? ['customName', rec.customName || ''] : null,
    io.isPTWPlus ? ['useCivilizationKing', String(rec.useCivilizationKing | 0)] : null,
  ]);
}

const WRITABLE_UNIT = ['name', 'owner_type', 'owner', 'p_r_t_o_number', 'a_i_strategy', 'experience_level', 'x', 'y', 'custom_name', 'use_civilization_king'];

// ---------------------------------------------------------------------------
// GAME (Scenario Properties)
// ---------------------------------------------------------------------------

function parseGAME(data, io) {
  let off = 0;
  function ri() {
    if (off + 4 > data.length) { off += 4; return 0; }
    const v = data.readInt32LE(off); off += 4; return v;
  }
  function rb() {
    if (off >= data.length) { off += 1; return 0; }
    const v = data[off]; off += 1; return v;
  }
  function rs(len) {
    const s = off + len <= data.length ? readStr(data, off, len) : '';
    off += len; return s;
  }

  const useDefaultRules = ri();
  const defaultVictoryConditions = ri();
  const numPlayableCivs = ri();
  const playableCivIds = [];
  for (let i = 0; i < numPlayableCivs; i++) playableCivIds.push(ri());
  const victoryConditionsAndRules = ri();

  const placeCaptureUnits = ri();
  const autoPlaceKings = ri();
  const autoPlaceVictoryLocations = ri();
  const debugMode = ri();
  const useTimeLimit = ri();
  const baseTimeUnit = ri();
  const startMonth = ri();
  const startWeek = ri();
  const startYear = ri();
  const minuteTimeLimit = ri();
  const turnTimeLimit = ri();

  const turnsPerTimescale = [];
  for (let i = 0; i < 7; i++) turnsPerTimescale.push(ri());
  const timeUnitsPerTurn = [];
  for (let i = 0; i < 7; i++) timeUnitsPerTurn.push(ri());

  const scenarioSearchFolders = rs(5200);

  // Conquests tail: civPartOfWhichAlliance (numPlayableCivs int32s, no length prefix)
  const civPartOfWhichAlliance = [];
  for (let i = 0; i < numPlayableCivs; i++) civPartOfWhichAlliance.push(ri());

  // Victory point fields (13 int32s)
  const victoryPointLimit = ri();
  const cityEliminationCount = ri();
  const oneCityCultureWinLimit = ri();
  const allCitiesCultureWinLimit = ri();
  const dominationTerrainPercent = ri();
  const dominationPopulationPercent = ri();
  const wonderVP = ri();
  const defeatingOpposingUnitVP = ri();
  const advancementVP = ri();
  const cityConquestVP = ri();
  const victoryPointVP = ri();
  const captureSpecialUnitVP = ri();
  const questionMark1 = ri();
  const questionMark2 = rb();

  // 5 alliance name strings (256 bytes each), stored as individual properties
  const alliance0 = rs(256);
  const alliance1 = rs(256);
  const alliance2 = rs(256);
  const alliance3 = rs(256);
  const alliance4 = rs(256);

  // warWith[k][j]: interleaved — 5 rounds of 5 ints (k=source alliance, j=target)
  const warWith = [[], [], [], [], []];
  for (let round = 0; round < 5; round++) {
    for (let k = 0; k < 5; k++) warWith[k].push(ri());
  }

  const allianceVictoryType = ri();
  const plaugeName = rs(260); // note: intentional typo preserved from original format
  const permitPlagues = rb();
  const plagueEarliestStart = ri();
  const plagueVariation = ri();
  const plagueDuration = ri();
  const plagueStrength = ri();
  const plagueGracePeriod = ri();
  const plagueMaxOccurance = ri();
  const questionMark3 = ri();
  const _unknownStr = rs(260);
  const respawnFlagUnits = ri();
  const captureAnyFlag = rb();
  const goldForCapture = ri();
  const mapVisible = rb();
  const retainCulture = rb();
  const questionMark4 = ri();
  const eruptionPeriod = ri();

  let mpBaseTime = 0, mpCityTime = 0, mpUnitTime = 0;
  if (io.isConquests && io.minorVersion >= 7 && off + 12 <= data.length) {
    mpBaseTime = ri(); mpCityTime = ri(); mpUnitTime = ri();
  }

  return {
    useDefaultRules, defaultVictoryConditions, numPlayableCivs, playableCivIds, victoryConditionsAndRules,
    placeCaptureUnits, autoPlaceKings, autoPlaceVictoryLocations, debugMode, useTimeLimit,
    baseTimeUnit, startMonth, startWeek, startYear, minuteTimeLimit, turnTimeLimit,
    turnsPerTimescale, timeUnitsPerTurn, scenarioSearchFolders,
    civPartOfWhichAlliance,
    victoryPointLimit, cityEliminationCount, oneCityCultureWinLimit, allCitiesCultureWinLimit,
    dominationTerrainPercent, dominationPopulationPercent,
    wonderVP, defeatingOpposingUnitVP, advancementVP, cityConquestVP, victoryPointVP, captureSpecialUnitVP,
    questionMark1, questionMark2,
    alliance0, alliance1, alliance2, alliance3, alliance4,
    warWith, allianceVictoryType,
    plaugeName, permitPlagues,
    plagueEarliestStart, plagueVariation, plagueDuration, plagueStrength, plagueGracePeriod, plagueMaxOccurance,
    questionMark3, _unknownStr,
    respawnFlagUnits, captureAnyFlag, goldForCapture, mapVisible, retainCulture, questionMark4, eruptionPeriod,
    mpBaseTime, mpCityTime, mpUnitTime,
  };
}

function serializeGAME(rec, io) {
  // Legacy fallback: records with a raw _tail (e.g. parsed before this rewrite)
  if (rec._tail && rec._tail.length > 0) {
    const w = new BiqWriter();
    w.writeInt(rec.useDefaultRules | 0);
    w.writeInt(rec.defaultVictoryConditions | 0);
    const civIds = Array.isArray(rec.playableCivIds) ? rec.playableCivIds : [];
    w.writeInt(civIds.length);
    for (const id of civIds) w.writeInt(id | 0);
    w.writeInt(rec.victoryConditionsAndRules | 0);
    w.writeBytes(rec._tail);
    return w.toBuffer();
  }

  const w = new BiqWriter();
  const civIds = Array.isArray(rec.playableCivIds) ? rec.playableCivIds : [];

  w.writeInt(rec.useDefaultRules | 0);
  w.writeInt(rec.defaultVictoryConditions | 0);
  w.writeInt(civIds.length);
  for (const id of civIds) w.writeInt(id | 0);
  w.writeInt(rec.victoryConditionsAndRules | 0);

  w.writeInt(rec.placeCaptureUnits | 0);
  w.writeInt(rec.autoPlaceKings | 0);
  w.writeInt(rec.autoPlaceVictoryLocations | 0);
  w.writeInt(rec.debugMode | 0);
  w.writeInt(rec.useTimeLimit | 0);
  w.writeInt(rec.baseTimeUnit | 0);
  w.writeInt(rec.startMonth | 0);
  w.writeInt(rec.startWeek | 0);
  w.writeInt(rec.startYear | 0);
  w.writeInt(rec.minuteTimeLimit | 0);
  w.writeInt(rec.turnTimeLimit | 0);

  const tpts = Array.isArray(rec.turnsPerTimescale) ? rec.turnsPerTimescale : [];
  for (let i = 0; i < 7; i++) w.writeInt((tpts[i] != null ? tpts[i] : 0) | 0);
  const tupt = Array.isArray(rec.timeUnitsPerTurn) ? rec.timeUnitsPerTurn : [];
  for (let i = 0; i < 7; i++) w.writeInt((tupt[i] != null ? tupt[i] : 0) | 0);

  writeStr(w, rec.scenarioSearchFolders || '', 5200);

  const cpa = Array.isArray(rec.civPartOfWhichAlliance) ? rec.civPartOfWhichAlliance : [];
  for (let i = 0; i < civIds.length; i++) w.writeInt((cpa[i] != null ? cpa[i] : 4) | 0);

  w.writeInt(rec.victoryPointLimit | 0);
  w.writeInt(rec.cityEliminationCount | 0);
  w.writeInt(rec.oneCityCultureWinLimit | 0);
  w.writeInt(rec.allCitiesCultureWinLimit | 0);
  w.writeInt(rec.dominationTerrainPercent | 0);
  w.writeInt(rec.dominationPopulationPercent | 0);
  w.writeInt(rec.wonderVP | 0);
  w.writeInt(rec.defeatingOpposingUnitVP | 0);
  w.writeInt(rec.advancementVP | 0);
  w.writeInt(rec.cityConquestVP | 0);
  w.writeInt(rec.victoryPointVP | 0);
  w.writeInt(rec.captureSpecialUnitVP | 0);
  w.writeInt(rec.questionMark1 | 0);
  w.writeByte(rec.questionMark2 | 0);

  writeStr(w, rec.alliance0 || '', 256);
  writeStr(w, rec.alliance1 || '', 256);
  writeStr(w, rec.alliance2 || '', 256);
  writeStr(w, rec.alliance3 || '', 256);
  writeStr(w, rec.alliance4 || '', 256);

  const ww = Array.isArray(rec.warWith) ? rec.warWith : [[], [], [], [], []];
  for (let round = 0; round < 5; round++) {
    for (let k = 0; k < 5; k++) {
      const arr = Array.isArray(ww[k]) ? ww[k] : [];
      w.writeInt((arr[round] != null ? arr[round] : 0) | 0);
    }
  }

  w.writeInt(rec.allianceVictoryType | 0);
  writeStr(w, rec.plaugeName || '', 260);
  w.writeByte(rec.permitPlagues | 0);
  w.writeInt(rec.plagueEarliestStart | 0);
  w.writeInt(rec.plagueVariation | 0);
  w.writeInt(rec.plagueDuration | 0);
  w.writeInt(rec.plagueStrength | 0);
  w.writeInt(rec.plagueGracePeriod | 0);
  w.writeInt(rec.plagueMaxOccurance | 0);
  w.writeInt(rec.questionMark3 | 0);
  writeStr(w, rec._unknownStr || '', 260);
  w.writeInt(rec.respawnFlagUnits | 0);
  w.writeByte(rec.captureAnyFlag | 0);
  w.writeInt(rec.goldForCapture | 0);
  w.writeByte(rec.mapVisible | 0);
  w.writeByte(rec.retainCulture | 0);
  w.writeInt(rec.questionMark4 | 0);
  w.writeInt(rec.eruptionPeriod | 0);

  if (io.isConquests && io.minorVersion >= 7) {
    w.writeInt(rec.mpBaseTime | 0);
    w.writeInt(rec.mpCityTime | 0);
    w.writeInt(rec.mpUnitTime | 0);
  }

  return w.toBuffer();
}

function toEnglishGAME(rec, io) {
  const civIds = Array.isArray(rec.playableCivIds) ? rec.playableCivIds : [];
  const pairs = [
    ['useDefaultRules', String(rec.useDefaultRules | 0)],
    ['defaultVictoryConditions', String(rec.defaultVictoryConditions | 0)],
    ['number_of_playable_civs', String(civIds.length)],
    ...civIds.map((id, i) => [`playable_civ_${i}`, String(id | 0)]),
    // victoryConditionsAndRules bitmask: expand to individual bool flags
    ...[
      ['dominationEnabled', 0], ['spaceRaceEnabled', 1], ['diplomacticEnabled', 2],
      ['conquestEnabled', 3], ['culturalEnabled', 4], ['civSpecificAbilitiesEnabled', 5],
      ['culturallyLinkedStart', 6], ['restartPlayersEnabled', 7],
      ['preserveRandomSeed', 8], ['acceleratedProduction', 9],
      ['eliminationEnabled', 10], ['regicideEnabled', 11], ['massRegicideEnabled', 12],
      ['victoryLocationsEnabled', 13], ['captureTheFlag', 14], ['allowCulturalConversions', 15],
      ['wonderVictoryEnabled', 16], ['reverseCaptureTheFlag', 17], ['scientificLeaders', 18],
    ].map(([name, bit]) => [name, String(((rec.victoryConditionsAndRules | 0) >> bit) & 1)]),
    ['placeCaptureUnits', String(rec.placeCaptureUnits | 0)],
    ['autoPlaceKings', String(rec.autoPlaceKings | 0)],
    ['autoPlaceVictoryLocations', String(rec.autoPlaceVictoryLocations | 0)],
    ['debugMode', String(rec.debugMode | 0)],
    ['useTimeLimit', String(rec.useTimeLimit | 0)],
    ['baseTimeUnit', String(rec.baseTimeUnit | 0)],
    ['startMonth', String(rec.startMonth | 0)],
    ['startWeek', String(rec.startWeek | 0)],
    ['startYear', String(rec.startYear | 0)],
    ['minuteTimeLimit', String(rec.minuteTimeLimit | 0)],
    ['turnTimeLimit', String(rec.turnTimeLimit | 0)],
    ['mapVisible', String(rec.mapVisible | 0)],
    ['retainCulture', String(rec.retainCulture | 0)],
  ];

  // Time scale: individual fields for schema-driven UI display
  const tpts = Array.isArray(rec.turnsPerTimescale) ? rec.turnsPerTimescale : [];
  const tupt = Array.isArray(rec.timeUnitsPerTurn) ? rec.timeUnitsPerTurn : [];
  for (let i = 0; i < 7; i++) {
    pairs.push([`turns_in_time_section_${i}`, String((tpts[i] != null ? tpts[i] : 0) | 0)]);
    pairs.push([`time_per_turn_in_time_section_${i}`, String((tupt[i] != null ? tupt[i] : 0) | 0)]);
  }

  pairs.push(['scenarioSearchFolders', rec.scenarioSearchFolders || '(none)']);

  // Victory Point Winning Conditions
  pairs.push(['victoryPointLimit', String(rec.victoryPointLimit | 0)]);
  pairs.push(['cityEliminationCount', String(rec.cityEliminationCount | 0)]);
  pairs.push(['oneCityCultureWinLimit', String(rec.oneCityCultureWinLimit | 0)]);
  pairs.push(['allCitiesCultureWinLimit', String(rec.allCitiesCultureWinLimit | 0)]);
  pairs.push(['dominationTerrainPercent', String(rec.dominationTerrainPercent | 0)]);
  pairs.push(['dominationPopulationPercent', String(rec.dominationPopulationPercent | 0)]);
  pairs.push(['respawnFlagUnits', String(rec.respawnFlagUnits | 0)]);
  pairs.push(['captureAnyFlag', String(rec.captureAnyFlag | 0)]);

  // Victory Points
  pairs.push(['wonderVP', String(rec.wonderVP | 0)]);
  pairs.push(['defeatingOpposingUnitVP', String(rec.defeatingOpposingUnitVP | 0)]);
  pairs.push(['advancementVP', String(rec.advancementVP | 0)]);
  pairs.push(['cityConquestVP', String(rec.cityConquestVP | 0)]);
  pairs.push(['victoryPointVP', String(rec.victoryPointVP | 0)]);
  pairs.push(['captureSpecialUnitVP', String(rec.captureSpecialUnitVP | 0)]);
  pairs.push(['goldForCapture', String(rec.goldForCapture | 0)]);

  // Alliance names and settings
  pairs.push(['alliance0', rec.alliance0 || '']);
  pairs.push(['alliance1', rec.alliance1 || '']);
  pairs.push(['alliance2', rec.alliance2 || '']);
  pairs.push(['alliance3', rec.alliance3 || '']);
  pairs.push(['alliance4', rec.alliance4 || '']);
  pairs.push(['allianceVictoryType', String(rec.allianceVictoryType | 0)]);

  // warWith flags (display only, not writable)
  const ww = Array.isArray(rec.warWith) ? rec.warWith : [[], [], [], [], []];
  for (let k = 0; k < 5; k++) {
    const arr = Array.isArray(ww[k]) ? ww[k] : [];
    for (let j = 0; j < 5; j++) {
      pairs.push([`alliance${k}_is_at_war_with_alliance${j}_0`, String((arr[j] != null ? arr[j] : 0) | 0)]);
    }
  }

  // Plague Information
  pairs.push(['permitPlagues', String(rec.permitPlagues | 0)]);
  pairs.push(['plaugeName', rec.plaugeName || '']);
  pairs.push(['plagueEarliestStart', String(rec.plagueEarliestStart | 0)]);
  pairs.push(['plagueVariation', String(rec.plagueVariation | 0)]);
  pairs.push(['plagueDuration', String(rec.plagueDuration | 0)]);
  pairs.push(['plagueStrength', String(rec.plagueStrength | 0)]);
  pairs.push(['plagueGracePeriod', String(rec.plagueGracePeriod | 0)]);
  pairs.push(['plagueMaxOccurance', String(rec.plagueMaxOccurance | 0)]);

  // Volcanos
  pairs.push(['eruptionPeriod', String(rec.eruptionPeriod | 0)]);

  // MP Timers (Conquests minorVersion >= 7 only)
  if (io.isConquests && io.minorVersion >= 7) {
    pairs.push(['mpBaseTime', String(rec.mpBaseTime | 0)]);
    pairs.push(['mpCityTime', String(rec.mpCityTime | 0)]);
    pairs.push(['mpUnitTime', String(rec.mpUnitTime | 0)]);
  }

  return lines(pairs);
}

// scenarioSearchFolders and warWith are read-only; all other named fields are writable
const WRITABLE_GAME = [
  'use_default_rules', 'default_victory_conditions',
  'domination_enabled', 'space_race_enabled', 'diplomactic_enabled',
  'conquest_enabled', 'cultural_enabled', 'civ_specific_abilities_enabled',
  'culturally_linked_start', 'restart_players_enabled',
  'preserve_random_seed', 'accelerated_production',
  'elimination_enabled', 'regicide_enabled', 'mass_regicide_enabled',
  'victory_locations_enabled', 'capture_the_flag', 'allow_cultural_conversions',
  'wonder_victory_enabled', 'reverse_capture_the_flag', 'scientific_leaders',
  'place_capture_units', 'auto_place_kings', 'auto_place_victory_locations',
  'debug_mode', 'use_time_limit', 'start_month', 'start_week', 'start_year',
  'minute_time_limit', 'turn_time_limit', 'base_time_unit',
  'map_visible', 'retain_culture',
  'victory_point_limit', 'city_elimination_count', 'one_city_culture_win_limit', 'all_cities_culture_win_limit',
  'domination_terrain_percent', 'domination_population_percent',
  'respawn_flag_units', 'capture_any_flag',
  'wonder_v_p', 'defeating_opposing_unit_v_p', 'advancement_v_p', 'city_conquest_v_p', 'victory_point_v_p', 'capture_special_unit_v_p', 'gold_for_capture',
  'alliance0', 'alliance1', 'alliance2', 'alliance3', 'alliance4', 'alliance_victory_type',
  'permit_plagues', 'plauge_name',
  'plague_earliest_start', 'plague_variation', 'plague_duration', 'plague_strength', 'plague_grace_period', 'plague_max_occurance',
  'eruption_period',
  'mp_base_time', 'mp_city_time', 'mp_unit_time',
];

// ---------------------------------------------------------------------------
// TILE - fixed-size, surgical edits via raw buffer
// ---------------------------------------------------------------------------

// Tile record body layout (Conquests, 45 bytes after 4-byte dataLen):
const TILE_FIELDS = [
  { name: 'riverConnectionInfo', off: 0, size: 1, type: 'uint8' },
  { name: 'border',              off: 1, size: 1, type: 'uint8' },
  { name: 'resource',            off: 2, size: 4, type: 'int32' },
  { name: 'image',               off: 6, size: 1, type: 'uint8' },
  { name: 'file',                off: 7, size: 1, type: 'uint8' },
  { name: 'questionMark',        off: 8, size: 2, type: 'int16' },
  { name: 'overlays',            off: 10, size: 1, type: 'uint8' },
  { name: 'baseRealTerrain',     off: 11, size: 1, type: 'uint8' },
  { name: 'bonuses',             off: 12, size: 1, type: 'uint8' },
  { name: 'riverCrossingData',   off: 13, size: 1, type: 'uint8' },
  { name: 'barbarianTribe',      off: 14, size: 2, type: 'int16' },
  { name: 'city',                off: 16, size: 2, type: 'int16' },
  { name: 'colony',              off: 18, size: 2, type: 'int16' },
  { name: 'continent',           off: 20, size: 2, type: 'int16' },
  { name: 'qm2',                 off: 22, size: 1, type: 'uint8' },
  { name: 'victoryPointLocation',off: 23, size: 2, type: 'int16' },
  { name: 'ruin',                off: 25, size: 4, type: 'int32' },
  { name: 'c3cOverlays',         off: 29, size: 4, type: 'int32' },
  { name: 'qm3',                 off: 33, size: 1, type: 'uint8' },
  { name: 'c3cBaseRealTerrain',  off: 34, size: 1, type: 'uint8' },
  { name: 'qm4',                 off: 35, size: 2, type: 'int16' },
  { name: 'fogOfWar',            off: 37, size: 2, type: 'int16' },
  { name: 'c3cBonuses',          off: 39, size: 4, type: 'int32' },
  { name: 'qm5',                 off: 43, size: 2, type: 'int16' },
];

const TILE_FIELD_MAP = new Map(TILE_FIELDS.map((f) => [f.name.toLowerCase(), f]));

function parseTILE(rawRecord, tileIndex, io) {
  // rawRecord includes 4-byte dataLen prefix
  const body = rawRecord.subarray(4);
  const fields = {};
  for (const fd of TILE_FIELDS) {
    if (fd.off >= body.length) continue;
    switch (fd.type) {
      case 'uint8': fields[fd.name] = body[fd.off]; break;
      case 'uint16': fields[fd.name] = body.readUInt16LE(fd.off); break;
      case 'int16': fields[fd.name] = body.readInt16LE(fd.off); break;
      case 'int32': fields[fd.name] = body.readInt32LE(fd.off); break;
      default: fields[fd.name] = body[fd.off];
    }
  }
  // Compute xpos/ypos from tileIndex + mapWidth
  let xPos = 0, yPos = 0;
  const half = Math.floor(io.mapWidth / 2);
  if (half > 0) {
    yPos = Math.floor(tileIndex / half);
    xPos = (tileIndex % half) * 2;
    if ((yPos & 1) === 1) xPos += 1;
  }
  return { ...fields, xpos: xPos, ypos: yPos, _rawRecord: Buffer.from(rawRecord) };
}

function serializeTILE(rec) {
  // Always return raw record (we do surgical edits in-place)
  return Buffer.from(rec._rawRecord);
}

function setTileRecordFieldValue(rec, fieldName, value) {
  if (!rec) return false;
  const fd = TILE_FIELD_MAP.get(String(fieldName || '').trim().toLowerCase());
  if (!fd) return false;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return false;
  const raw = rec._rawRecord;
  if (raw) {
    const bodyOff = 4 + fd.off;
    switch (fd.type) {
      case 'uint8': raw[bodyOff] = n & 0xff; break;
      case 'int16': raw.writeInt16LE(n, bodyOff); break;
      case 'uint16': raw.writeUInt16LE(n & 0xffff, bodyOff); break;
      case 'int32': raw.writeInt32LE(n | 0, bodyOff); break;
      default: raw[bodyOff] = n & 0xff;
    }
  }
  rec[fd.name] = n;
  return true;
}

function toEnglishTILE(rec, io) {
  const pairs = [
    ['xpos', String(rec.xpos | 0)],
    ['ypos', String(rec.ypos | 0)],
  ];
  for (const fd of TILE_FIELDS) {
    const v = rec[fd.name];
    if (v != null) pairs.push([fd.name, String(v)]);
  }
  return lines(pairs);
}

const WRITABLE_TILE = ['base_real_terrain', 'c3c_base_real_terrain', 'overlays', 'c3c_overlays', 'resource', 'bonuses', 'c3c_bonuses', 'fog_of_war', 'city', 'colony', 'river_crossing_data', 'river_connection_info', 'border', 'ruin', 'victory_point_location', 'barbarian_tribe', 'image', 'file'];

// ---------------------------------------------------------------------------
// CTZN (Citizen Types)
// ---------------------------------------------------------------------------

function parseCTZN(data, io) {
  let off = 0;
  const defaultCitizen = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const name = readStr(data, off, 32); off += 32;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const pluralName = readStr(data, off, 32); off += 32;
  const prerequisite = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const luxuries = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const research = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const taxes = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  let corruption = 0, construction = 0;
  if (io.isConquests && off + 8 <= data.length) {
    corruption = data.readInt32LE(off); off += 4;
    construction = data.readInt32LE(off); off += 4;
  }
  return { defaultCitizen, name, civilopediaEntry, pluralName, prerequisite, luxuries, research, taxes, corruption, construction };
}

function serializeCTZN(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.defaultCitizen | 0);
  writeStr(w, rec.name, 32);
  writeStr(w, rec.civilopediaEntry, 32);
  writeStr(w, rec.pluralName, 32);
  w.writeInt(rec.prerequisite | 0);
  w.writeInt(rec.luxuries | 0);
  w.writeInt(rec.research | 0);
  w.writeInt(rec.taxes | 0);
  if (io.isConquests) {
    w.writeInt(rec.corruption | 0);
    w.writeInt(rec.construction | 0);
  }
  return w.toBuffer();
}

function toEnglishCTZN(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['pluralName', rec.pluralName || ''],
    ['defaultCitizen', String(rec.defaultCitizen | 0)],
    ['prerequisite', String(rec.prerequisite | 0)],
    ['luxuries', String(rec.luxuries | 0)],
    ['research', String(rec.research | 0)],
    ['taxes', String(rec.taxes | 0)],
    io.isConquests ? ['corruption', String(rec.corruption | 0)] : null,
    io.isConquests ? ['construction', String(rec.construction | 0)] : null,
  ]);
}

const WRITABLE_CTZN = ['name', 'plural_name', 'default_citizen', 'prerequisite', 'luxuries', 'research', 'taxes', 'corruption', 'construction'];

// ---------------------------------------------------------------------------
// CULT (Culture Groups)
// ---------------------------------------------------------------------------

function parseCULT(data, io) {
  let off = 0;
  const name = readStr(data, off, 64); off += 64;
  const propagandaSuccess = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const cultRatioPercent = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const ratioDenominator = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const ratioNumerator = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const initResistanceChance = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const continuedResistanceChance = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  return { name, propagandaSuccess, cultRatioPercent, ratioDenominator, ratioNumerator, initResistanceChance, continuedResistanceChance };
}

function serializeCULT(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.name, 64);
  w.writeInt(rec.propagandaSuccess | 0);
  w.writeInt(rec.cultRatioPercent | 0);
  w.writeInt(rec.ratioDenominator | 0);
  w.writeInt(rec.ratioNumerator | 0);
  w.writeInt(rec.initResistanceChance | 0);
  w.writeInt(rec.continuedResistanceChance | 0);
  return w.toBuffer();
}

function toEnglishCULT(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['propagandaSuccess', String(rec.propagandaSuccess | 0)],
    ['cultRatioPercent', String(rec.cultRatioPercent | 0)],
    ['ratioDenominator', String(rec.ratioDenominator | 0)],
    ['ratioNumerator', String(rec.ratioNumerator | 0)],
    ['initResistanceChance', String(rec.initResistanceChance | 0)],
    ['continuedResistanceChance', String(rec.continuedResistanceChance | 0)],
  ]);
}

const WRITABLE_CULT = ['name', 'propaganda_success', 'cult_ratio_percent', 'ratio_denominator', 'ratio_numerator', 'init_resistance_chance', 'continued_resistance_chance'];

// ---------------------------------------------------------------------------
// DIFF (Difficulty Levels)
// ---------------------------------------------------------------------------

const DIFF_SCALAR_NAMES = [
  'contentCitizens', 'maxGovtTransition', 'AIDefenceStart', 'AIOffenceStart',
  'extraStart1', 'extraStart2', 'additionalFreeSupport', 'bonusPerCity',
  'attackBarbariansBonus', 'costFactor', 'percentOptimal', 'AIAITrade',
  'corruptionPercent', 'militaryLaw'
];

function parseDIFF(data, io) {
  let off = 0;
  const name = readStr(data, off, 64); off += 64;
  const scalars = {};
  for (const sn of DIFF_SCALAR_NAMES) {
    scalars[sn] = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  }
  return { name, ...scalars };
}

function serializeDIFF(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.name, 64);
  for (const sn of DIFF_SCALAR_NAMES) w.writeInt((rec[sn] != null ? rec[sn] : 0) | 0);
  return w.toBuffer();
}

function toEnglishDIFF(rec, io) {
  const pairs = [['name', rec.name || '']];
  for (const sn of DIFF_SCALAR_NAMES) pairs.push([sn, String((rec[sn] != null ? rec[sn] : 0) | 0)]);
  return lines(pairs);
}

const WRITABLE_DIFF = ['name', 'content_citizens', 'max_govt_transition', 'a_i_defence_start', 'a_i_offence_start', 'extra_start1', 'extra_start2', 'additional_free_support', 'bonus_per_city', 'attack_barbarians_bonus', 'cost_factor', 'percent_optimal', 'a_i_a_i_trade', 'corruption_percent', 'military_law'];

// ---------------------------------------------------------------------------
// ERAS (Historical Eras)
// ---------------------------------------------------------------------------

function parseERAS(data, io) {
  let off = 0;
  const eraName = readStr(data, off, 64); off += 64;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const researchers = [];
  for (let i = 0; i < 5 && off + 32 <= data.length; i++) {
    researchers.push(readStr(data, off, 32)); off += 32;
  }
  const usedResearcherNames = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  let questionMark = 0;
  if (io.isConquests && off + 4 <= data.length) {
    questionMark = data.readInt32LE(off); off += 4;
  }
  return { name: eraName, eraName, civilopediaEntry, researchers, usedResearcherNames, questionMark };
}

function serializeERAS(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.eraName || rec.name, 64);
  writeStr(w, rec.civilopediaEntry, 32);
  const researchers = Array.isArray(rec.researchers) ? rec.researchers : [];
  for (let i = 0; i < 5; i++) writeStr(w, researchers[i] || '', 32);
  w.writeInt(rec.usedResearcherNames | 0);
  if (io.isConquests) w.writeInt(rec.questionMark | 0);
  return w.toBuffer();
}

function toEnglishERAS(rec, io) {
  const pairs = [
    ['name', rec.eraName || rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
  ];
  const researchers = Array.isArray(rec.researchers) ? rec.researchers : [];
  for (let i = 0; i < 5; i++) pairs.push([`researcher${i + 1}`, researchers[i] || '']);
  pairs.push(['usedResearcherNames', String(rec.usedResearcherNames | 0)]);
  if (io.isConquests) pairs.push(['questionMark', String(rec.questionMark | 0)]);
  return lines(pairs);
}

const WRITABLE_ERAS = ['name', 'used_researcher_names'];

// ---------------------------------------------------------------------------
// ESPN (Espionage Missions)
// ---------------------------------------------------------------------------

function parseESPN(data, io) {
  let off = 0;
  const description = readStr(data, off, 128); off += 128;
  const name = readStr(data, off, 64); off += 64;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const missionPerformedBy = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  let baseCost = 0;
  if (off + 4 <= data.length) { baseCost = data.readInt32LE(off); off += 4; }
  return { description, name, civilopediaEntry, missionPerformedBy, baseCost };
}

function serializeESPN(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.description, 128);
  writeStr(w, rec.name, 64);
  writeStr(w, rec.civilopediaEntry, 32);
  w.writeInt(rec.missionPerformedBy | 0);
  w.writeInt(rec.baseCost | 0);
  return w.toBuffer();
}

function toEnglishESPN(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['description', rec.description || ''],
    ['missionPerformedBy', String(rec.missionPerformedBy | 0)],
    ['baseCost', String(rec.baseCost | 0)],
  ]);
}

const WRITABLE_ESPN = ['name', 'description', 'mission_performed_by', 'base_cost'];

// ---------------------------------------------------------------------------
// EXPR (Experience Levels)
// ---------------------------------------------------------------------------

function parseEXPR(data, io) {
  let off = 0;
  const name = readStr(data, off, 32); off += 32;
  const baseHitPoints = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  let retreatBonus = 0;
  if (off + 4 <= data.length) { retreatBonus = data.readInt32LE(off); off += 4; }
  return { name, baseHitPoints, retreatBonus };
}

function serializeEXPR(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.name, 32);
  w.writeInt(rec.baseHitPoints | 0);
  w.writeInt(rec.retreatBonus | 0);
  return w.toBuffer();
}

function toEnglishEXPR(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['baseHitPoints', String(rec.baseHitPoints | 0)],
    ['retreatBonus', String(rec.retreatBonus | 0)],
  ]);
}

const WRITABLE_EXPR = ['name', 'base_hit_points', 'retreat_bonus'];

// ---------------------------------------------------------------------------
// TFRM (Terrain Transformations)
// ---------------------------------------------------------------------------

function parseTFRM(data, io) {
  let off = 0;
  const name = readStr(data, off, 32); off += 32;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const turnsToComplete = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const requiredAdvance = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const requiredResource1 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const requiredResource2 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const order = readStr(data, off, 32); off += 32;
  return { name, civilopediaEntry, turnsToComplete, requiredAdvance, requiredResource1, requiredResource2, order };
}

function serializeTFRM(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.name, 32);
  writeStr(w, rec.civilopediaEntry, 32);
  w.writeInt(rec.turnsToComplete | 0);
  w.writeInt(rec.requiredAdvance | 0);
  w.writeInt(rec.requiredResource1 | 0);
  w.writeInt(rec.requiredResource2 | 0);
  writeStr(w, rec.order, 32);
  return w.toBuffer();
}

function toEnglishTFRM(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['turnsToComplete', String(rec.turnsToComplete | 0)],
    ['requiredAdvance', String(rec.requiredAdvance | 0)],
    ['requiredResource1', String(rec.requiredResource1 | 0)],
    ['requiredResource2', String(rec.requiredResource2 | 0)],
    ['order', rec.order || ''],
  ]);
}

const WRITABLE_TFRM = ['name', 'turns_to_complete', 'required_advance', 'required_resource1', 'required_resource2', 'order'];

// ---------------------------------------------------------------------------
// WSIZ (World Sizes)
// ---------------------------------------------------------------------------

function parseWSIZ(data, io) {
  let off = 0;
  const optimalNumberOfCities = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const techRate = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  // 24 bytes padding/empty
  off += 24;
  const name = readStr(data, off, 32); off += 32;
  const height = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const distanceBetweenCivs = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const numberOfCivs = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const width = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  return { name, optimalNumberOfCities, techRate, height, distanceBetweenCivs, numberOfCivs, width };
}

function serializeWSIZ(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.optimalNumberOfCities | 0);
  w.writeInt(rec.techRate | 0);
  w.writeBytes(Buffer.alloc(24));
  writeStr(w, rec.name, 32);
  w.writeInt(rec.height | 0);
  w.writeInt(rec.distanceBetweenCivs | 0);
  w.writeInt(rec.numberOfCivs | 0);
  w.writeInt(rec.width | 0);
  return w.toBuffer();
}

function toEnglishWSIZ(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['optimalNumberOfCities', String(rec.optimalNumberOfCities | 0)],
    ['techRate', String(rec.techRate | 0)],
    ['height', String(rec.height | 0)],
    ['distanceBetweenCivs', String(rec.distanceBetweenCivs | 0)],
    ['numberOfCivs', String(rec.numberOfCivs | 0)],
    ['width', String(rec.width | 0)],
  ]);
}

const WRITABLE_WSIZ = ['name', 'optimal_number_of_cities', 'tech_rate', 'height', 'distance_between_civs', 'number_of_civs', 'width'];

// ---------------------------------------------------------------------------
// WCHR (World Parameters)
// ---------------------------------------------------------------------------

function parseWCHR(data, io) {
  let off = 0;
  const selectedClimate = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const actualClimate = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const selectedBarbarian = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const actualBarbarian = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const selectedLandform = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const actualLandform = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const selectedOcean = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const actualOcean = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const selectedTemp = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const actualTemp = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const selectedAge = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const actualAge = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const worldSize = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  return {
    name: 'World Parameters',
    selectedClimate, actualClimate, selectedBarbarian, actualBarbarian,
    selectedLandform, actualLandform, selectedOcean, actualOcean,
    selectedTemp, actualTemp, selectedAge, actualAge, worldSize
  };
}

function serializeWCHR(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.selectedClimate | 0);
  w.writeInt(rec.actualClimate | 0);
  w.writeInt(rec.selectedBarbarian | 0);
  w.writeInt(rec.actualBarbarian | 0);
  w.writeInt(rec.selectedLandform | 0);
  w.writeInt(rec.actualLandform | 0);
  w.writeInt(rec.selectedOcean | 0);
  w.writeInt(rec.actualOcean | 0);
  w.writeInt(rec.selectedTemp | 0);
  w.writeInt(rec.actualTemp | 0);
  w.writeInt(rec.selectedAge | 0);
  w.writeInt(rec.actualAge | 0);
  w.writeInt(rec.worldSize | 0);
  return w.toBuffer();
}

function toEnglishWCHR(rec, io) {
  return lines([
    ['name', 'World Parameters'],
    ['selectedClimate', String(rec.selectedClimate | 0)],
    ['actualClimate', String(rec.actualClimate | 0)],
    ['selectedBarbarian', String(rec.selectedBarbarian | 0)],
    ['actualBarbarian', String(rec.actualBarbarian | 0)],
    ['selectedLandform', String(rec.selectedLandform | 0)],
    ['actualLandform', String(rec.actualLandform | 0)],
    ['selectedOcean', String(rec.selectedOcean | 0)],
    ['actualOcean', String(rec.actualOcean | 0)],
    ['selectedTemp', String(rec.selectedTemp | 0)],
    ['actualTemp', String(rec.actualTemp | 0)],
    ['selectedAge', String(rec.selectedAge | 0)],
    ['actualAge', String(rec.actualAge | 0)],
    ['worldSize', String(rec.worldSize | 0)],
  ]);
}

const WRITABLE_WCHR = ['selected_climate', 'selected_barbarian', 'selected_landform', 'selected_ocean', 'selected_temp', 'selected_age', 'world_size'];

// ---------------------------------------------------------------------------
// WMAP (World Map)
// ---------------------------------------------------------------------------

function parseWMAP(data, io) {
  let off = 0;
  const numResources = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const resourceOccurrences = [];
  for (let i = 0; i < numResources && off + 4 <= data.length; i++) {
    resourceOccurrences.push(data.readInt32LE(off)); off += 4;
  }
  const numContinents = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const height = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const distanceBetweenCivs = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const numCivs = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const qm1 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const qm2 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const width = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const qm3 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  // 124 unknown bytes
  const unknownBytes = off + 124 <= data.length ? Buffer.from(data.subarray(off, off + 124)) : Buffer.alloc(0);
  off += Math.min(124, data.length - off);
  const mapSeed = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const flags = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const _tail = off < data.length ? Buffer.from(data.subarray(off)) : Buffer.alloc(0);
  return {
    name: 'World Map',
    numResources, resourceOccurrences, numContinents, height, distanceBetweenCivs,
    numCivs, qm1, qm2, width, qm3, unknownBytes, mapSeed, flags, _tail
  };
}

function serializeWMAP(rec, io) {
  const w = new BiqWriter();
  const resOcc = Array.isArray(rec.resourceOccurrences) ? rec.resourceOccurrences : [];
  w.writeInt(resOcc.length);
  for (const v of resOcc) w.writeInt(v | 0);
  w.writeInt(rec.numContinents | 0);
  w.writeInt(rec.height | 0);
  w.writeInt(rec.distanceBetweenCivs | 0);
  w.writeInt(rec.numCivs | 0);
  w.writeInt(rec.qm1 | 0);
  w.writeInt(rec.qm2 | 0);
  w.writeInt(rec.width | 0);
  w.writeInt(rec.qm3 | 0);
  const unk = Buffer.isBuffer(rec.unknownBytes) ? rec.unknownBytes : Buffer.alloc(124);
  const padded = Buffer.alloc(124);
  unk.copy(padded, 0, 0, Math.min(unk.length, 124));
  w.writeBytes(padded);
  w.writeInt(rec.mapSeed | 0);
  w.writeInt(rec.flags | 0);
  if (rec._tail && rec._tail.length > 0) w.writeBytes(rec._tail);
  return w.toBuffer();
}

function toEnglishWMAP(rec, io) {
  const resOcc = Array.isArray(rec.resourceOccurrences) ? rec.resourceOccurrences : [];
  const pairs = [
    ['name', 'World Map'],
    ['width', String(rec.width | 0)],
    ['height', String(rec.height | 0)],
    ['numContinents', String(rec.numContinents | 0)],
    ['numCivs', String(rec.numCivs | 0)],
    ['distanceBetweenCivs', String(rec.distanceBetweenCivs | 0)],
    ['mapSeed', String(rec.mapSeed | 0)],
    ['flags', String(rec.flags | 0)],
    ['numResources', String(resOcc.length)],
  ];
  resOcc.forEach((v, i) => pairs.push([`resource_occurrence_${i}`, String(v | 0)]));
  return lines(pairs);
}

const WRITABLE_WMAP = ['width', 'height', 'num_continents', 'num_civs', 'distance_between_civs', 'map_seed', 'flags'];

// ---------------------------------------------------------------------------
// TERR (Terrain Types)
// ---------------------------------------------------------------------------

function parseTERR(data, io) {
  let off = 0;
  const numTotalResources = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const maskLen = Math.ceil(numTotalResources / 8);
  const possibleResources = off + maskLen <= data.length
    ? Buffer.from(data.subarray(off, off + maskLen))
    : Buffer.alloc(maskLen);
  off += maskLen;
  const name = readStr(data, off, 32); off += 32;
  const civilopediaEntry = readStr(data, off, 32); off += 32;
  const terrScalars = ['foodBonus', 'shieldsBonus', 'commerceBonus', 'defenceBonus', 'movementCost',
    'food', 'shields', 'commerce', 'workerJob', 'pollutionEffect'];
  const scalars = {};
  for (const sn of terrScalars) {
    scalars[sn] = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  }
  const allowCities = off < data.length ? data[off] : 0; off++;
  const allowColonies = off < data.length ? data[off] : 0; off++;
  const impassable = off < data.length ? data[off] : 0; off++;
  const impassableByWheeled = off < data.length ? data[off] : 0; off++;
  const allowAirfields = off < data.length ? data[off] : 0; off++;
  const allowForts = off < data.length ? data[off] : 0; off++;
  const allowOutposts = off < data.length ? data[off] : 0; off++;
  const allowRadarTowers = off < data.length ? data[off] : 0; off++;

  let questionMark = 0, landmarkEnabled = 0, questionMark2 = 0, terrainFlags = 0, diseaseStrength = 0;
  let landmarkName = '', landmarkCivilopediaEntry = '';
  const landmarkScalars = { landmarkFood: 0, landmarkShields: 0, landmarkCommerce: 0, landmarkFoodBonus: 0, landmarkShieldsBonus: 0, landmarkCommerceBonus: 0, landmarkMovementCost: 0, landmarkDefenceBonus: 0 };

  if (io.isConquests && off + 4 <= data.length) {
    questionMark = data.readInt32LE(off); off += 4;
    if (off < data.length) { landmarkEnabled = data[off]; off++; }
    for (const k of Object.keys(landmarkScalars)) {
      landmarkScalars[k] = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
    }
    landmarkName = readStr(data, off, 32); off += 32;
    landmarkCivilopediaEntry = readStr(data, off, 32); off += 32;
    questionMark2 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
    terrainFlags = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
    diseaseStrength = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  }
  const _tail = off < data.length ? Buffer.from(data.subarray(off)) : Buffer.alloc(0);

  return {
    name, civilopediaEntry, numTotalResources, possibleResources,
    ...scalars,
    allowCities, allowColonies, impassable, impassableByWheeled,
    allowAirfields, allowForts, allowOutposts, allowRadarTowers,
    questionMark, landmarkEnabled, ...landmarkScalars,
    landmarkName, landmarkCivilopediaEntry,
    questionMark2, terrainFlags, diseaseStrength, _tail
  };
}

function serializeTERR(rec, io) {
  const w = new BiqWriter();
  const resOcc = Array.isArray(rec.resourceOccurrences) ? rec.resourceOccurrences : [];
  const numTotalResources = rec.numTotalResources != null ? (rec.numTotalResources | 0) : resOcc.length;
  w.writeInt(numTotalResources);
  const maskLen = Math.ceil(numTotalResources / 8);
  const mask = Buffer.isBuffer(rec.possibleResources) ? rec.possibleResources : Buffer.alloc(maskLen);
  const padMask = Buffer.alloc(maskLen);
  mask.copy(padMask, 0, 0, Math.min(mask.length, maskLen));
  w.writeBytes(padMask);
  writeStr(w, rec.name, 32);
  writeStr(w, rec.civilopediaEntry, 32);
  const terrScalars = ['foodBonus', 'shieldsBonus', 'commerceBonus', 'defenceBonus', 'movementCost',
    'food', 'shields', 'commerce', 'workerJob', 'pollutionEffect'];
  for (const sn of terrScalars) w.writeInt((rec[sn] != null ? rec[sn] : 0) | 0);
  w.writeByte((rec.allowCities != null ? rec.allowCities : 0) & 0xff);
  w.writeByte((rec.allowColonies != null ? rec.allowColonies : 0) & 0xff);
  w.writeByte((rec.impassable != null ? rec.impassable : 0) & 0xff);
  w.writeByte((rec.impassableByWheeled != null ? rec.impassableByWheeled : 0) & 0xff);
  w.writeByte((rec.allowAirfields != null ? rec.allowAirfields : 0) & 0xff);
  w.writeByte((rec.allowForts != null ? rec.allowForts : 0) & 0xff);
  w.writeByte((rec.allowOutposts != null ? rec.allowOutposts : 0) & 0xff);
  w.writeByte((rec.allowRadarTowers != null ? rec.allowRadarTowers : 0) & 0xff);
  if (io.isConquests) {
    w.writeInt(rec.questionMark | 0);
    w.writeByte((rec.landmarkEnabled != null ? rec.landmarkEnabled : 0) & 0xff);
    const landmarkScalarNames = ['landmarkFood', 'landmarkShields', 'landmarkCommerce', 'landmarkFoodBonus', 'landmarkShieldsBonus', 'landmarkCommerceBonus', 'landmarkMovementCost', 'landmarkDefenceBonus'];
    for (const sn of landmarkScalarNames) w.writeInt((rec[sn] != null ? rec[sn] : 0) | 0);
    writeStr(w, rec.landmarkName, 32);
    writeStr(w, rec.landmarkCivilopediaEntry, 32);
    w.writeInt(rec.questionMark2 | 0);
    w.writeInt(rec.terrainFlags | 0);
    w.writeInt(rec.diseaseStrength | 0);
  }
  if (rec._tail && rec._tail.length > 0) w.writeBytes(rec._tail);
  return w.toBuffer();
}

function toEnglishTERR(rec, io) {
  const resourceCount = Math.max(0, rec.numTotalResources | 0);
  const resourceMask = [];
  const resourceBytes = Buffer.isBuffer(rec.possibleResources) ? rec.possibleResources : Buffer.alloc(0);
  for (let i = 0; i < resourceCount; i += 1) {
    const byteIndex = i >> 3;
    const bitMask = 1 << (i & 7);
    const enabled = byteIndex < resourceBytes.length && (resourceBytes[byteIndex] & bitMask) !== 0;
    resourceMask.push(enabled ? 1 : 0);
  }
  const pairs = [
    ['numPossibleResources', String(resourceCount)],
    ['possibleResourcesMask', resourceMask.join(',')],
    ['name', rec.name || ''],
    ['civilopediaEntry', rec.civilopediaEntry || ''],
    ['foodBonus', String(rec.foodBonus | 0)],
    ['shieldsBonus', String(rec.shieldsBonus | 0)],
    ['commerceBonus', String(rec.commerceBonus | 0)],
    ['defenceBonus', String(rec.defenceBonus | 0)],
    ['movementCost', String(rec.movementCost | 0)],
    ['food', String(rec.food | 0)],
    ['shields', String(rec.shields | 0)],
    ['commerce', String(rec.commerce | 0)],
    ['workerJob', String(rec.workerJob | 0)],
    ['pollutionEffect', String(rec.pollutionEffect | 0)],
    ['allowCities', String(rec.allowCities | 0)],
    ['allowColonies', String(rec.allowColonies | 0)],
    ['impassable', String(rec.impassable | 0)],
    ['impassableByWheeled', String(rec.impassableByWheeled | 0)],
    ['allowAirfields', String(rec.allowAirfields | 0)],
    ['allowForts', String(rec.allowForts | 0)],
    ['allowOutposts', String(rec.allowOutposts | 0)],
    ['allowRadarTowers', String(rec.allowRadarTowers | 0)],
  ];
  if (io.isConquests) {
    pairs.push(['landmarkEnabled', String(rec.landmarkEnabled | 0)]);
    pairs.push(['landmarkFood', String(rec.landmarkFood | 0)]);
    pairs.push(['landmarkShields', String(rec.landmarkShields | 0)]);
    pairs.push(['landmarkCommerce', String(rec.landmarkCommerce | 0)]);
    pairs.push(['landmarkFoodBonus', String(rec.landmarkFoodBonus | 0)]);
    pairs.push(['landmarkShieldsBonus', String(rec.landmarkShieldsBonus | 0)]);
    pairs.push(['landmarkCommerceBonus', String(rec.landmarkCommerceBonus | 0)]);
    pairs.push(['landmarkMovementCost', String(rec.landmarkMovementCost | 0)]);
    pairs.push(['landmarkDefenceBonus', String(rec.landmarkDefenceBonus | 0)]);
    pairs.push(['landmarkName', rec.landmarkName || '']);
    pairs.push(['landmarkCivilopediaEntry', rec.landmarkCivilopediaEntry || '']);
    pairs.push(['terrainFlags', String(rec.terrainFlags | 0)]);
    pairs.push(['diseaseStrength', String(rec.diseaseStrength | 0)]);
  }
  return lines(pairs);
}

const WRITABLE_TERR = ['food_bonus', 'shields_bonus', 'commerce_bonus', 'defence_bonus', 'movement_cost', 'food', 'shields', 'commerce', 'worker_job', 'pollution_effect', 'allow_cities', 'allow_colonies', 'impassable', 'impassable_by_wheeled', 'allow_airfields', 'allow_forts', 'allow_outposts', 'allow_radar_towers', 'landmark_enabled', 'landmark_food', 'landmark_shields', 'landmark_commerce', 'landmark_food_bonus', 'landmark_shields_bonus', 'landmark_commerce_bonus', 'landmark_movement_cost', 'landmark_defence_bonus', 'landmark_name', 'terrain_flags', 'disease_strength'];

// ---------------------------------------------------------------------------
// RULE (Game Rules) - partial: parse what we can, store tail
// ---------------------------------------------------------------------------

const RULE_VISIBLE_SCALAR_NAMES = [
  'advancedBarbarian', 'basicBarbarian', 'barbarianSeaUnit', 'citiesForArmy', 'chanceOfRioting',
  'draftTurnPenalty', 'shieldCostInGold', 'fortressDefenceBonus', 'citizensAffectedByHappyFace',
  'questionMark1', 'questionMark2', 'forestValueInShields', 'shieldValueInGold', 'citizenValueInShields',
  'defaultDifficultyLevel', 'battleCreatedUnit', 'buildArmyUnit', 'buildingDefensiveBonus',
  'citizenDefensiveBonus', 'defaultMoneyResource', 'chanceToInterceptAirMissions',
  'chanceToInterceptStealthMissions', 'startingTreasury', 'questionMark3', 'foodConsumptionPerCitizen',
  'riverDefensiveBonus', 'turnPenaltyForWhip', 'scout', 'slave', 'roadMovementRate', 'startUnit1',
  'startUnit2', 'WLTKDMinimumPop', 'townDefenceBonus', 'cityDefenceBonus', 'metropolisDefenceBonus',
  'maxCity1Size', 'maxCity2Size', 'questionMark4', 'fortificationsDefenceBonus'
];

const RULE_TRAILING_SCALAR_NAMES = [
  'futureTechCost', 'goldenAgeDuration', 'maximumResearchTime', 'minimumResearchTime'
];

function readInt32Safe(data, off, fallback = 0) {
  return off + 4 <= data.length ? data.readInt32LE(off) : fallback;
}

function parseRULE(data, io) {
  let off = 0;
  const townName = readStr(data, off, 32).trim(); off += 32;
  const cityName = readStr(data, off, 32).trim(); off += 32;
  const metropolisName = readStr(data, off, 32).trim(); off += 32;
  const numSSParts = readInt32Safe(data, off); off += 4;
  const numberOfPartsRequired = [];
  for (let i = 0; i < numSSParts && off + 4 <= data.length; i++) {
    numberOfPartsRequired.push(data.readInt32LE(off)); off += 4;
  }
  const scalars = {};
  for (const sn of RULE_VISIBLE_SCALAR_NAMES) {
    scalars[sn] = readInt32Safe(data, off); off += 4;
  }
  const numCultureLevels = readInt32Safe(data, off); off += 4;
  const culturalLevelNames = [];
  for (let i = 0; i < numCultureLevels && off + 64 <= data.length; i++) {
    culturalLevelNames.push(readStr(data, off, 64).trim()); off += 64;
  }
  const borderExpansionMultiplier = readInt32Safe(data, off); off += 4;
  const borderFactor = readInt32Safe(data, off, 10); off += 4;
  const trailingScalars = {};
  for (const sn of RULE_TRAILING_SCALAR_NAMES) {
    trailingScalars[sn] = readInt32Safe(data, off); off += 4;
  }
  let flagUnit = 0;
  if (io.isPTWPlus) {
    flagUnit = readInt32Safe(data, off); off += 4;
  }
  let upgradeCost = 0;
  if (io.isConquests) {
    upgradeCost = readInt32Safe(data, off); off += 4;
  }
  const _tail = off < data.length ? Buffer.from(data.subarray(off)) : Buffer.alloc(0);
  return {
    name: 'Rules',
    townName, cityName, metropolisName,
    numSSParts, numberOfPartsRequired,
    ...scalars,
    numCultureLevels,
    culturalLevelNames,
    borderExpansionMultiplier,
    borderFactor,
    ...trailingScalars,
    flagUnit,
    upgradeCost,
    _tail
  };
}

function serializeRULE(rec, io) {
  const w = new BiqWriter();
  writeStr(w, rec.townName, 32);
  writeStr(w, rec.cityName, 32);
  writeStr(w, rec.metropolisName, 32);
  const parts = Array.isArray(rec.numberOfPartsRequired) ? rec.numberOfPartsRequired : [];
  w.writeInt(parts.length);
  for (const p of parts) w.writeInt(p | 0);
  for (const sn of RULE_VISIBLE_SCALAR_NAMES) w.writeInt((rec[sn] != null ? rec[sn] : 0) | 0);
  const culturalLevelNames = Array.isArray(rec.culturalLevelNames) ? rec.culturalLevelNames : [];
  w.writeInt(culturalLevelNames.length);
  for (const levelName of culturalLevelNames) writeStr(w, levelName, 64);
  w.writeInt((rec.borderExpansionMultiplier != null ? rec.borderExpansionMultiplier : 0) | 0);
  w.writeInt((rec.borderFactor != null ? rec.borderFactor : 10) | 0);
  for (const sn of RULE_TRAILING_SCALAR_NAMES) w.writeInt((rec[sn] != null ? rec[sn] : 0) | 0);
  if (io.isPTWPlus) w.writeInt((rec.flagUnit != null ? rec.flagUnit : 0) | 0);
  if (io.isConquests) w.writeInt((rec.upgradeCost != null ? rec.upgradeCost : 0) | 0);
  if (rec._tail && rec._tail.length > 0) w.writeBytes(rec._tail);
  return w.toBuffer();
}

function toEnglishRULE(rec, io) {
  const pairs = [
    ['name', 'Rules'],
    ['townName', rec.townName || ''],
    ['cityName', rec.cityName || ''],
    ['metropolisName', rec.metropolisName || ''],
    ['numSpaceshipParts', String(rec.numSSParts | 0)],
  ];
  (rec.numberOfPartsRequired || []).forEach((v, i) => {
    pairs.push([`number_of_parts_${i}_required`, String(v | 0)]);
  });
  for (const sn of RULE_VISIBLE_SCALAR_NAMES) {
    pairs.push([sn, String((rec[sn] != null ? rec[sn] : 0) | 0)]);
  }
  pairs.push(['borderExpansionMultiplier', String((rec.borderExpansionMultiplier != null ? rec.borderExpansionMultiplier : 0) | 0)]);
  pairs.push(['borderFactor', String((rec.borderFactor != null ? rec.borderFactor : 10) | 0)]);
  for (const sn of RULE_TRAILING_SCALAR_NAMES) {
    pairs.push([sn, String((rec[sn] != null ? rec[sn] : 0) | 0)]);
  }
  if (io.isPTWPlus) {
    pairs.push(['flagUnit', String((rec.flagUnit != null ? rec.flagUnit : 0) | 0)]);
  }
  if (io.isConquests) {
    pairs.push(['upgradeCost', String((rec.upgradeCost != null ? rec.upgradeCost : 0) | 0)]);
  }
  return lines(pairs);
}

const WRITABLE_RULE = ['town_name', 'city_name', 'metropolis_name', 'advanced_barbarian', 'basic_barbarian', 'barbarian_sea_unit', 'cities_for_army', 'chance_of_rioting', 'draft_turn_penalty', 'shield_cost_in_gold', 'fortress_defence_bonus', 'citizens_affected_by_happy_face', 'forest_value_in_shields', 'shield_value_in_gold', 'citizen_value_in_shields', 'default_difficulty_level', 'battle_created_unit', 'build_army_unit', 'building_defensive_bonus', 'citizen_defensive_bonus', 'default_money_resource', 'chance_to_intercept_air_missions', 'chance_to_intercept_stealth_missions', 'starting_treasury', 'food_consumption_per_citizen', 'river_defensive_bonus', 'turn_penalty_for_whip', 'scout', 'slave', 'road_movement_rate', 'start_unit1', 'start_unit2', 'w_l_t_k_d_minimum_pop', 'town_defence_bonus', 'city_defence_bonus', 'metropolis_defence_bonus', 'max_city1_size', 'max_city2_size', 'question_mark_1', 'question_mark_2', 'question_mark_3', 'question_mark_4', 'fortifications_defence_bonus', 'border_expansion_multiplier', 'border_factor', 'future_tech_cost', 'golden_age_duration', 'maximum_research_time', 'minimum_research_time', 'flag_unit', 'upgrade_cost'];

// ---------------------------------------------------------------------------
// LEAD (Scenario Leaders)
// ---------------------------------------------------------------------------

function parseLEAD(data, io) {
  let off = 0;
  const customCivData = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const humanPlayer = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const leaderName = readStr(data, off, 32); off += 32;
  const questionMark1 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const questionMark2 = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const numStartUnits = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const startUnits = [];
  for (let i = 0; i < numStartUnits && off + 8 <= data.length; i++) {
    const startUnitCount = data.readInt32LE(off); off += 4;
    const startUnitIndex = data.readInt32LE(off); off += 4;
    startUnits.push({ startUnitCount, startUnitIndex });
  }
  const genderOfLeaderName = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const numStartTechs = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const techIndices = [];
  for (let i = 0; i < numStartTechs && off + 4 <= data.length; i++) {
    techIndices.push(data.readInt32LE(off)); off += 4;
  }
  const difficulty = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const initialEra = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const startCash = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const government = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const civ = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const color = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  let skipFirstTurn = 0, questionMark3 = 0, startEmbassies = 0;
  if (io.isPTWPlus && off + 4 <= data.length) {
    skipFirstTurn = data.readInt32LE(off); off += 4;
    if (off + 4 <= data.length) { questionMark3 = data.readInt32LE(off); off += 4; }
    if (off < data.length) { startEmbassies = data[off]; off++; }
  }
  const _tail = off < data.length ? Buffer.from(data.subarray(off)) : Buffer.alloc(0);
  return {
    name: leaderName, leaderName, customCivData, humanPlayer,
    questionMark1, questionMark2, numStartUnits, startUnits,
    genderOfLeaderName, numStartTechs, techIndices,
    difficulty, initialEra, startCash, government, civ, color,
    skipFirstTurn, questionMark3, startEmbassies, _tail
  };
}

function serializeLEAD(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.customCivData | 0);
  w.writeInt(rec.humanPlayer | 0);
  writeStr(w, rec.leaderName || rec.name, 32);
  w.writeInt(rec.questionMark1 | 0);
  w.writeInt(rec.questionMark2 | 0);
  const startUnits = Array.isArray(rec.startUnits) ? rec.startUnits : [];
  w.writeInt(startUnits.length);
  for (const su of startUnits) {
    w.writeInt((su.startUnitCount != null ? su.startUnitCount : 0) | 0);
    w.writeInt((su.startUnitIndex != null ? su.startUnitIndex : 0) | 0);
  }
  w.writeInt(rec.genderOfLeaderName | 0);
  const techIndices = Array.isArray(rec.techIndices) ? rec.techIndices : [];
  w.writeInt(techIndices.length);
  for (const ti of techIndices) w.writeInt(ti | 0);
  w.writeInt(rec.difficulty | 0);
  w.writeInt(rec.initialEra | 0);
  w.writeInt(rec.startCash | 0);
  w.writeInt(rec.government | 0);
  w.writeInt(rec.civ | 0);
  w.writeInt(rec.color | 0);
  if (io.isPTWPlus) {
    w.writeInt(rec.skipFirstTurn | 0);
    w.writeInt(rec.questionMark3 | 0);
    w.writeByte((rec.startEmbassies != null ? rec.startEmbassies : 0) & 0xff);
  }
  if (rec._tail && rec._tail.length > 0) w.writeBytes(rec._tail);
  return w.toBuffer();
}

function toEnglishLEAD(rec, io) {
  const pairs = [
    ['name', rec.leaderName || rec.name || ''],
    ['humanPlayer', String(rec.humanPlayer | 0)],
    ['customCivData', String(rec.customCivData | 0)],
    ['civ', String(rec.civ | 0)],
    ['government', String(rec.government | 0)],
    ['initialEra', String(rec.initialEra | 0)],
    ['difficulty', String(rec.difficulty | 0)],
    ['startCash', String(rec.startCash | 0)],
    ['color', String(rec.color | 0)],
    ['genderOfLeaderName', String(rec.genderOfLeaderName | 0)],
  ];
  const startUnits = Array.isArray(rec.startUnits) ? rec.startUnits : [];
  pairs.push(['numberOfDifferentStartUnits', String(startUnits.length)]);
  startUnits.forEach((su) => {
    pairs.push([`starting_units_of_type_${su.startUnitIndex}`, String(su.startUnitCount | 0)]);
  });
  const techIndices = Array.isArray(rec.techIndices) ? rec.techIndices : [];
  pairs.push(['numberOfStartingTechnologies', String(techIndices.length)]);
  techIndices.forEach((idx, i) => {
    pairs.push([`starting_technology_${i}`, String(idx | 0)]);
  });
  if (io.isPTWPlus) {
    pairs.push(['skipFirstTurn', String(rec.skipFirstTurn | 0)]);
    pairs.push(['startEmbassies', String(rec.startEmbassies | 0)]);
  }
  return lines(pairs);
}

const WRITABLE_LEAD = ['human_player', 'custom_civ_data', 'civ', 'government', 'initial_era', 'difficulty', 'start_cash', 'color', 'gender_of_leader_name', 'skip_first_turn', 'start_embassies'];

// ---------------------------------------------------------------------------
// CONT (Continent data) - fixed-size 12
// ---------------------------------------------------------------------------

function parseCONT(data, io) {
  let off = 0;
  const continentClass = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const numTiles = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  return { continentClass, numTiles };
}

function serializeCONT(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.continentClass | 0);
  w.writeInt(rec.numTiles | 0);
  return w.toBuffer();
}

function toEnglishCONT(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['continentClass', String(rec.continentClass | 0)],
    ['numTiles', String(rec.numTiles | 0)],
  ]);
}

const WRITABLE_CONT = ['continent_class', 'num_tiles'];

// ---------------------------------------------------------------------------
// SLOC (Starting Locations) - fixed-size 20
// ---------------------------------------------------------------------------

function parseSLOC(data, io) {
  let off = 0;
  const ownerType = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const owner = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const x = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const y = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  return { ownerType, owner, x, y };
}

function serializeSLOC(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.ownerType | 0);
  w.writeInt(rec.owner | 0);
  w.writeInt(rec.x | 0);
  w.writeInt(rec.y | 0);
  return w.toBuffer();
}

function toEnglishSLOC(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['ownerType', String(rec.ownerType | 0)],
    ['owner', String(rec.owner | 0)],
    ['x', String(rec.x | 0)],
    ['y', String(rec.y | 0)],
  ]);
}

const WRITABLE_SLOC = ['owner_type', 'owner', 'x', 'y'];

// ---------------------------------------------------------------------------
// CLNY (Colonies) - fixed-size 20 (Conquests may have 24)
// ---------------------------------------------------------------------------

function parseCLNY(data, io) {
  let off = 0;
  const ownerType = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const owner = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const x = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  const y = off + 4 <= data.length ? data.readInt32LE(off) : 0; off += 4;
  let improvementType = 0;
  if (off + 4 <= data.length) { improvementType = data.readInt32LE(off); off += 4; }
  return { ownerType, owner, x, y, improvementType };
}

function serializeCLNY(rec, io) {
  const w = new BiqWriter();
  w.writeInt(rec.ownerType | 0);
  w.writeInt(rec.owner | 0);
  w.writeInt(rec.x | 0);
  w.writeInt(rec.y | 0);
  w.writeInt(rec.improvementType | 0);
  return w.toBuffer();
}

function toEnglishCLNY(rec, io) {
  return lines([
    ['name', rec.name || ''],
    ['ownerType', String(rec.ownerType | 0)],
    ['owner', String(rec.owner | 0)],
    ['x', String(rec.x | 0)],
    ['y', String(rec.y | 0)],
    ['improvementType', String(rec.improvementType | 0)],
  ]);
}

const WRITABLE_CLNY = ['owner_type', 'owner', 'x', 'y', 'improvement_type'];

// ---------------------------------------------------------------------------
// FLAV (Flavor Definitions) - special non-standard section structure
// Parsing is handled specially in parseAllSections; these helpers are for
// toEnglish and serialization of individual flavor records.
// ---------------------------------------------------------------------------

function toEnglishFLAV(rec, io) {
  const pairs = [
    ['name', rec.name || ''],
    ['questionMark', String(rec.questionMark | 0)],
  ];
  const relations = Array.isArray(rec.relations) ? rec.relations : [];
  for (let i = 0; i < relations.length; i++) {
    pairs.push([`relation_with_flavor_${i}`, String(relations[i] | 0)]);
  }
  return lines(pairs);
}

function serializeFLAVSection(section) {
  // Writes entire section: tag(4) + numGroups=1(4) + numFlavors(4) + all flavor records
  const w = new BiqWriter();
  w.writeTag('FLAV');
  w.writeInt(1); // numGroups
  const records = Array.isArray(section.records) ? section.records : [];
  w.writeInt(records.length); // numFlavors
  for (const rec of records) {
    w.writeInt(rec.questionMark | 0);
    writeStr(w, rec.name, 256);
    const relations = Array.isArray(rec.relations) ? rec.relations : [];
    w.writeInt(relations.length);
    for (const rv of relations) w.writeInt(rv | 0);
  }
  return w.toBuffer();
}

const WRITABLE_FLAV = ['name', 'question_mark'];

// ---------------------------------------------------------------------------
// Generic / pass-through sections
// ---------------------------------------------------------------------------

function parseGeneric(data) {
  const pairs = [['byteLength', String(data.length)]];
  const maxInts = Math.min(12, Math.floor(data.length / 4));
  for (let i = 0; i < maxInts; i++) {
    pairs.push([`u32_${i}`, String(data.readUInt32LE(i * 4))]);
  }
  return { _rawData: Buffer.from(data), _englishPairs: pairs };
}

function toEnglishGeneric(rec) {
  if (rec._englishPairs) return lines(rec._englishPairs);
  return '';
}

// ---------------------------------------------------------------------------
// SECTION REGISTRY
// ---------------------------------------------------------------------------

const SECTION_REGISTRY = {
  TECH: { parse: parseTECH, serialize: serializeTECH, toEnglish: toEnglishTECH, writableKeys: WRITABLE_TECH, hasCivKey: true, mode: 'len' },
  BLDG: { parse: parseBLDG, serialize: serializeBLDG, toEnglish: toEnglishBLDG, writableKeys: WRITABLE_BLDG, hasCivKey: true, mode: 'len' },
  GOOD: { parse: parseGOOD, serialize: serializeGOOD, toEnglish: toEnglishGOOD, writableKeys: WRITABLE_GOOD, hasCivKey: true, mode: 'len' },
  GOVT: { parse: parseGOVT, serialize: serializeGOVT, toEnglish: toEnglishGOVT, writableKeys: WRITABLE_GOVT, hasCivKey: true, mode: 'len' },
  RACE: { parse: parseRACE, serialize: serializeRACE, toEnglish: toEnglishRACE, writableKeys: WRITABLE_RACE, hasCivKey: true, mode: 'len' },
  PRTO: { parse: parsePRTO, serialize: serializePRTO, toEnglish: toEnglishPRTO, writableKeys: WRITABLE_PRTO, hasCivKey: true, mode: 'len' },
  CITY: { parse: parseCITY, serialize: serializeCITY, toEnglish: toEnglishCITY, writableKeys: WRITABLE_CITY, hasCivKey: false, mode: 'len' },
  UNIT: { parse: parseUNIT, serialize: serializeUNIT, toEnglish: toEnglishUNIT, writableKeys: WRITABLE_UNIT, hasCivKey: false, mode: 'len' },
  GAME: { parse: parseGAME, serialize: serializeGAME, toEnglish: toEnglishGAME, writableKeys: WRITABLE_GAME, hasCivKey: false, mode: 'len' },
  TILE: { toEnglish: toEnglishTILE, writableKeys: WRITABLE_TILE, hasCivKey: false, mode: 'fixed' },
  CTZN: { parse: parseCTZN, serialize: serializeCTZN, toEnglish: toEnglishCTZN, writableKeys: WRITABLE_CTZN, hasCivKey: true, mode: 'len' },
  CULT: { parse: parseCULT, serialize: serializeCULT, toEnglish: toEnglishCULT, writableKeys: WRITABLE_CULT, hasCivKey: false, mode: 'len' },
  DIFF: { parse: parseDIFF, serialize: serializeDIFF, toEnglish: toEnglishDIFF, writableKeys: WRITABLE_DIFF, hasCivKey: false, mode: 'len' },
  ERAS: { parse: parseERAS, serialize: serializeERAS, toEnglish: toEnglishERAS, writableKeys: WRITABLE_ERAS, hasCivKey: true, mode: 'len' },
  ESPN: { parse: parseESPN, serialize: serializeESPN, toEnglish: toEnglishESPN, writableKeys: WRITABLE_ESPN, hasCivKey: true, mode: 'len' },
  EXPR: { parse: parseEXPR, serialize: serializeEXPR, toEnglish: toEnglishEXPR, writableKeys: WRITABLE_EXPR, hasCivKey: false, mode: 'len' },
  TFRM: { parse: parseTFRM, serialize: serializeTFRM, toEnglish: toEnglishTFRM, writableKeys: WRITABLE_TFRM, hasCivKey: true, mode: 'len' },
  WSIZ: { parse: parseWSIZ, serialize: serializeWSIZ, toEnglish: toEnglishWSIZ, writableKeys: WRITABLE_WSIZ, hasCivKey: false, mode: 'len' },
  WCHR: { parse: parseWCHR, serialize: serializeWCHR, toEnglish: toEnglishWCHR, writableKeys: WRITABLE_WCHR, hasCivKey: false, mode: 'len' },
  WMAP: { parse: parseWMAP, serialize: serializeWMAP, toEnglish: toEnglishWMAP, writableKeys: WRITABLE_WMAP, hasCivKey: false, mode: 'len' },
  TERR: { parse: parseTERR, serialize: serializeTERR, toEnglish: toEnglishTERR, writableKeys: WRITABLE_TERR, hasCivKey: true, mode: 'len' },
  RULE: { parse: parseRULE, serialize: serializeRULE, toEnglish: toEnglishRULE, writableKeys: WRITABLE_RULE, hasCivKey: false, mode: 'len' },
  LEAD: { parse: parseLEAD, serialize: serializeLEAD, toEnglish: toEnglishLEAD, writableKeys: WRITABLE_LEAD, hasCivKey: false, mode: 'len' },
  CONT: { parse: parseCONT, serialize: serializeCONT, toEnglish: toEnglishCONT, writableKeys: WRITABLE_CONT, hasCivKey: false, mode: 'fixed' },
  SLOC: { parse: parseSLOC, serialize: serializeSLOC, toEnglish: toEnglishSLOC, writableKeys: WRITABLE_SLOC, hasCivKey: false, mode: 'fixed' },
  CLNY: { parse: parseCLNY, serialize: serializeCLNY, toEnglish: toEnglishCLNY, writableKeys: WRITABLE_CLNY, hasCivKey: false, mode: 'fixed' },
  FLAV: { toEnglish: toEnglishFLAV, writableKeys: WRITABLE_FLAV, hasCivKey: false, mode: 'special' },
};

// ---------------------------------------------------------------------------
// parseAllSections: parse a complete BIQ buffer
// ---------------------------------------------------------------------------

const SECTION_ORDER = [
  'BLDG', 'CTZN', 'CULT', 'DIFF', 'ERAS', 'ESPN', 'EXPR', 'GOOD', 'GOVT', 'RULE',
  'PRTO', 'RACE', 'TECH', 'TFRM', 'TERR', 'WSIZ', 'FLAV',
  'WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY',
  'GAME', 'LEAD'
];

const OPTIONAL_SECTIONS = new Set(['FLAV', 'WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY', 'LEAD']);

const FIXED_SECTION_SIZES = { CONT: 12, SLOC: 20, CLNY: 20 };

function getFixedSectionSize(code, io) {
  const upper = String(code || '').trim().toUpperCase();
  if (upper === 'TILE') return getTileRecordLength(io && io.versionTag, io && io.majorVersion);
  if (upper === 'CLNY') {
    return io && io.isConquests ? 24 : 20;
  }
  return FIXED_SECTION_SIZES[upper] || 0;
}

function getTileRecordLength(versionTag, majorVersion) {
  if (versionTag === 'BICX' && majorVersion === 12) return 49; // 4+45
  if (versionTag === 'BICX') return 33;
  if (versionTag === 'BIC ' && majorVersion === 2) return 26;
  return 27;
}

function readUInt32Safe(buf, off) {
  if (off < 0 || off + 4 > buf.length) return null;
  return buf.readUInt32LE(off);
}

function findSectionTag(buf, tag, fromOff) {
  const needle = Buffer.from(tag, 'latin1');
  let idx = buf.indexOf(needle, fromOff);
  while (idx >= 0) {
    const count = readUInt32Safe(buf, idx + 4);
    if (count !== null && count < 50000000) return { offset: idx, count };
    idx = buf.indexOf(needle, idx + 1);
  }
  return null;
}

function parseAllSections(buf, options = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  setCurrentBiqTextEncoding(options && options.textEncoding);

  if (buf.length >= 8) {
    const initialVersionTag = buf.subarray(0, 4).toString('latin1');
    const initialVerHeaderTag = buf.subarray(4, 8).toString('latin1');
    if (!initialVersionTag.startsWith('BIC') || initialVerHeaderTag !== 'VER#') {
      const inflated = decompress(buf);
      if (inflated && inflated.ok && Buffer.isBuffer(inflated.data)) {
        buf = inflated.data;
      }
    }
  }

  // Parse header
  if (buf.length < 736) return { ok: false, error: 'Buffer too small for BIQ header' };
  const versionTag = buf.subarray(0, 4).toString('latin1');
  const verHeaderTag = buf.subarray(4, 8).toString('latin1');
  if (!versionTag.startsWith('BIC') || verHeaderTag !== 'VER#') {
    return { ok: false, error: `Invalid BIQ header: ${versionTag} ${verHeaderTag}` };
  }
  const majorVersion = buf.readUInt32LE(24);
  const minorVersion = buf.readUInt32LE(28);
  let off = 0;
  const numHeaders = buf.readUInt32LE(8);
  const headerLength = buf.readUInt32LE(12);
  let biqDescription = '';
  let end = 32;
  while (end < 672 && buf[end] !== 0) end++;
  biqDescription = decodeBiqTextBytes(buf.subarray(32, end));
  let titleEnd = 672;
  while (titleEnd < 736 && buf[titleEnd] !== 0) titleEnd++;
  const biqTitle = decodeBiqTextBytes(buf.subarray(672, titleEnd));

  const io = new BiqIO({ versionTag, majorVersion, minorVersion, textEncoding: currentBiqTextEncoding });
  const sections = [];
  let searchFrom = 736;

  for (const code of SECTION_ORDER) {
    const found = findSectionTag(buf, code, searchFrom);
    if (!found) {
      if (OPTIONAL_SECTIONS.has(code)) continue;
      // Non-optional missing section: skip gracefully
      continue;
    }

    const sectionOffset = found.offset;
    const count = found.count;
    const dataStart = sectionOffset + 8; // after tag+count

    // If next section is ERAS, capture numEras
    if (code === 'ERAS') io.numEras = count;
    const reg = SECTION_REGISTRY[code];

    // FLAV special handling: non-standard section structure
    if (code === 'FLAV') {
      // dataStart points directly to numFlavors (int32), then flavor records (no len-prefix)
      const records = [];
      let pos = dataStart;
      const numFlavors = pos + 4 <= buf.length ? buf.readUInt32LE(pos) : 0; pos += 4;
      for (let i = 0; i < numFlavors && pos + 264 <= buf.length; i++) {
        const questionMark = buf.readInt32LE(pos); pos += 4;
        const flavName = readStr(buf, pos, 256); pos += 256;
        const numRelations = pos + 4 <= buf.length ? buf.readInt32LE(pos) : 0; pos += 4;
        const relations = [];
        for (let j = 0; j < numRelations && pos + 4 <= buf.length; j++) {
          relations.push(buf.readInt32LE(pos)); pos += 4;
        }
        records.push({ index: i, name: flavName, questionMark, numRelations, relations });
      }
      sections.push({
        code,
        count: numFlavors,
        records,
        _sectionOffset: sectionOffset,
        _rawBuf: buf.subarray(sectionOffset),
      });
      searchFrom = sectionOffset + 4;
      continue;
    }

    const isFixed = reg ? (reg.mode === 'fixed') : (FIXED_SECTION_SIZES[code] != null);
    const fixedSize = getFixedSectionSize(code, io);

    const records = [];
    let pos = dataStart;

    if (isFixed && fixedSize > 0) {
      for (let i = 0; i < count && pos + fixedSize <= buf.length; i++, pos += fixedSize) {
        const rawRecord = Buffer.from(buf.subarray(pos, pos + fixedSize));
        if (code === 'TILE' && reg) {
          records.push({ index: i, ...parseTILE(rawRecord, i, io), _tileIndex: i });
        } else if (reg && reg.parse) {
          const body = rawRecord.subarray(4); // skip dataLen
          try {
            const parsed = reg.parse(body, io);
            records.push({ index: i, ...parsed, _rawRecord: rawRecord });
          } catch (_err) {
            records.push({ index: i, ...parseGeneric(body), _rawRecord: rawRecord });
          }
        } else {
          const body = rawRecord.subarray(4); // skip dataLen
          records.push({ index: i, ...parseGeneric(body), _rawRecord: rawRecord });
        }
      }
    } else {
      // len mode
      for (let i = 0; i < count && pos + 4 <= buf.length; i++) {
        const dataLen = buf.readUInt32LE(pos);
        const bodyStart = pos + 4;
        const bodyEnd = bodyStart + dataLen;
        if (bodyEnd > buf.length) break;
        const body = buf.subarray(bodyStart, bodyEnd);

        let rec;
        if (reg && reg.parse) {
          try {
            rec = reg.parse(body, io);
          } catch (_err) {
            rec = parseGeneric(body);
          }
        } else {
          rec = parseGeneric(body);
        }
        records.push({ index: i, ...rec });
        pos = bodyEnd;
      }
    }

    // Capture map width from WMAP after parsing
    if (code === 'WMAP' && records.length > 0) {
      const wmapRec = records[0];
      if (wmapRec.width) io.mapWidth = wmapRec.width;
    }

    sections.push({
      code,
      count,
      records,
      _sectionOffset: sectionOffset,
      _rawBuf: buf.subarray(sectionOffset), // lazy, will trim to next section
    });
    searchFrom = sectionOffset + 4;
  }

  // Trim _rawBuf for each section to just its own bytes
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const nextOff = i + 1 < sections.length ? sections[i + 1]._sectionOffset : buf.length;
    s._rawBuf = Buffer.from(buf.subarray(s._sectionOffset, nextOff));
  }

  return {
    ok: true,
    versionTag, verHeaderTag, majorVersion, minorVersion,
    numHeaders, headerLength, biqDescription, biqTitle,
    sections, io,
    _headerBuf: Buffer.from(buf.subarray(0, 736))
  };
}

// ---------------------------------------------------------------------------
// serializeSection: rebuild a single section's binary bytes (tag+count+records)
// ---------------------------------------------------------------------------

function serializeSection(section, io) {
  const code = section.code;
  const reg = SECTION_REGISTRY[code];
  const records = code === 'PRTO' ? buildQuintPrtoOutputRecords(section.records || []) : (section.records || []);

  // FLAV: special non-standard serialization
  if (code === 'FLAV') {
    return serializeFLAVSection(section);
  }

  const w = new BiqWriter();
  w.writeTag(code);
  w.writeInt(records.length);

  const isFixed = reg ? (reg.mode === 'fixed') : (FIXED_SECTION_SIZES[code] != null);

  if (isFixed) {
    const fixedSize = getFixedSectionSize(code, io);
    for (const rec of records) {
      if (code === 'TILE') {
        // TILE always uses raw record (surgical edits done in-place)
        if (rec._rawRecord) {
          w.writeBytes(rec._rawRecord);
        } else {
          w.writeBytes(Buffer.alloc(fixedSize));
        }
      } else if (reg && reg.serialize) {
        // For CONT/SLOC/CLNY with proper parsers: use serialize for faithfulness when modified
        // We still wrap with dataLen prefix to match the fixed-size record format
        try {
          const body = reg.serialize(rec, io);
          // Fixed records include a 4-byte dataLen prefix in the raw record
          const dlen = Buffer.allocUnsafe(4);
          dlen.writeUInt32LE(body.length >>> 0, 0);
          w.writeBytes(dlen);
          w.writeBytes(body);
        } catch (_err) {
          if (rec._rawRecord) {
            w.writeBytes(rec._rawRecord);
          } else {
            w.writeBytes(Buffer.alloc(fixedSize));
          }
        }
      } else if (rec._rawRecord) {
        w.writeBytes(rec._rawRecord);
      } else {
        w.writeBytes(Buffer.alloc(fixedSize));
      }
    }
    return w.toBuffer();
  }

  // Len mode
  for (const rec of records) {
    let body;
    if (reg && reg.serialize) {
      try {
        body = reg.serialize(rec, io);
      } catch (_err) {
        body = rec._rawData || Buffer.alloc(0);
      }
    } else {
      body = rec._rawData || Buffer.alloc(0);
    }
    w.writeUInt(body.length);
    w.writeBytes(body);
  }
  return w.toBuffer();
}

function getPrtoStrategyBits(value) {
  const bits = [];
  const raw = Number(value) | 0;
  for (let bit = 0; bit < 20; bit += 1) {
    const mask = 1 << bit;
    if ((raw & mask) === mask) bits.push(mask);
  }
  return bits;
}

function buildQuintPrtoOutputRecords(records) {
  const source = Array.isArray(records) ? records : [];
  const duplicatesByPrimary = new Map();
  source.forEach((rec) => {
    const primaryIdx = Number(rec && rec.otherStrategy);
    if (!Number.isFinite(primaryIdx) || primaryIdx < 0) return;
    if (!duplicatesByPrimary.has(primaryIdx)) duplicatesByPrimary.set(primaryIdx, []);
    duplicatesByPrimary.get(primaryIdx).push(rec);
  });
  const baseRecords = source.filter((rec) => !Number.isFinite(Number(rec && rec.otherStrategy)) || Number(rec.otherStrategy) < 0);
  const output = [];

  baseRecords.forEach((rec, logicalIndex) => {
    let mergedAi = Number(rec && rec.AIStrategy) | 0;
    const duplicates = duplicatesByPrimary.get(Number(rec && rec.index)) || [];
    duplicates.forEach((dupRec) => {
      mergedAi |= Number(dupRec && dupRec.AIStrategy) | 0;
    });
    const strategyBits = getPrtoStrategyBits(mergedAi);
    const primaryStrategy = strategyBits[0] || 0;
    output.push({
      ...rec,
      index: logicalIndex,
      otherStrategy: -1,
      AIStrategy: primaryStrategy
    });
  });

  baseRecords.forEach((rec, logicalIndex) => {
    let mergedAi = Number(rec && rec.AIStrategy) | 0;
    const duplicates = duplicatesByPrimary.get(Number(rec && rec.index)) || [];
    duplicates.forEach((dupRec) => {
      mergedAi |= Number(dupRec && dupRec.AIStrategy) | 0;
    });
    const strategyBits = getPrtoStrategyBits(mergedAi);
    if (strategyBits.length <= 1) return;
    for (let i = 1; i < strategyBits.length; i += 1) {
      output.push({
        ...rec,
        index: output.length,
        otherStrategy: logicalIndex,
        AIStrategy: strategyBits[i]
      });
    }
  });

  return output;
}

// ---------------------------------------------------------------------------
// buildBiqBuffer: assemble complete BIQ binary from parsed structure
// ---------------------------------------------------------------------------

function buildBiqBuffer(parsed) {
  const { _headerBuf, sections, io } = parsed;
  const parts = [_headerBuf];
  for (const section of sections) {
    const isModified = section._modified;
    if (!isModified && section._rawBuf) {
      parts.push(section._rawBuf);
    } else {
      parts.push(serializeSection(section, io));
    }
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Field SET helpers
// ---------------------------------------------------------------------------

function canonicalKey(k) {
  return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function encodeFixedBiqText(value, len) {
  const out = Buffer.alloc(len, 0);
  const encoding = normalizeBiqTextEncoding(currentBiqTextEncoding);
  let encoded = iconv.encode(String(value || ''), encoding);
  if (encoded.length >= len) {
    const clippedText = decodeBiqTextBytes(encoded.subarray(0, Math.max(0, len - 1)), encoding);
    encoded = iconv.encode(clippedText, encoding);
  }
  encoded.copy(out, 0, 0, Math.min(encoded.length, Math.max(0, len - 1)));
  return out;
}

function applyBiqHeaderTextEdit(parsed, fieldKey, value) {
  const ck = canonicalKey(fieldKey);
  const spec = ck === 'title'
    ? { offset: 672, len: 64, prop: 'biqTitle' }
    : (ck === 'description' ? { offset: 32, len: 640, prop: 'biqDescription' } : null);
  if (!spec) return false;
  const existing = Buffer.isBuffer(parsed && parsed._headerBuf) ? parsed._headerBuf : Buffer.alloc(736, 0);
  const header = Buffer.alloc(Math.max(736, existing.length), 0);
  existing.copy(header, 0, 0, Math.min(existing.length, header.length));
  encodeFixedBiqText(value, spec.len).copy(header, spec.offset);
  parsed._headerBuf = header.subarray(0, 736);
  parsed[spec.prop] = String(value || '');
  return true;
}

function findRecordByRef(records, recordRef) {
  const ref = String(recordRef || '').trim();
  const upper = ref.toUpperCase();
  if (upper.startsWith('@INDEX:')) {
    const idx = Number.parseInt(upper.slice(7), 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < records.length) return records[idx];
    return null;
  }
  // Search by civilopediaEntry for normal BIQ sections, and by transient
  // newRecordRef for newly added map/structure records before serialization.
  return records.find((r) => {
    const ce = String(r.civilopediaEntry || '').trim().toUpperCase();
    if (ce === upper) return true;
    const newRef = String(r && r.newRecordRef || '').trim().toUpperCase();
    return newRef === upper;
  }) || null;
}

function dropPrtoStrategyMapDuplicates(records, primaryIndex, keepRecord) {
  if (!Array.isArray(records) || !Number.isFinite(primaryIndex) || primaryIndex < 0) return false;
  let changed = false;
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (!record || record === keepRecord) continue;
    const otherStrategy = Number(record && record.otherStrategy);
    if (!Number.isFinite(otherStrategy) || otherStrategy !== primaryIndex) continue;
    records.splice(i, 1);
    changed = true;
  }
  if (changed) records.forEach((record, idx) => { if (record) record.index = idx; });
  return changed;
}

function applySetToRecord(rec, fieldKey, value, code, io) {
  const ck = canonicalKey(fieldKey);

  if (code === 'RACE') {
    const freeTechMatch = ck.match(/^freetech(\d+)(index)?$/);
    if (freeTechMatch) {
      const idx = Number.parseInt(freeTechMatch[1], 10) - 1;
      if (!Number.isFinite(idx) || idx < 0) return false;
      rec.freeTechs = ensureArraySize(rec.freeTechs, Math.max(4, idx + 1), -1);
      rec.freeTechs[idx] = parseEditInt(value, -1);
      return true;
    }

    const filenameMatch = ck.match(/^(forwardfilename|reversefilename)(?:forera|)(\d+)$/);
    if (filenameMatch) {
      const kind = filenameMatch[1];
      const idx = Number.parseInt(filenameMatch[2], 10);
      if (!Number.isFinite(idx) || idx < 0) return false;
      if (kind === 'forwardfilename') {
        rec.forwardFilenames = ensureArraySize(rec.forwardFilenames, idx + 1, '');
        rec.forwardFilenames[idx] = String(value);
      } else {
        rec.reverseFilenames = ensureArraySize(rec.reverseFilenames, idx + 1, '');
        rec.reverseFilenames[idx] = String(value);
      }
      return true;
    }

    const listSpecs = [
      { prefix: 'cityname', arrayKey: 'cityNames', countKey: 'numCities' },
      { prefix: 'milleader', arrayKey: 'milLeaderNames', countKey: 'numMilLeaders' },
      { prefix: 'scientificleader', arrayKey: 'scientificLeaderNames', countKey: 'numScientificLeaders' }
    ];
    for (const spec of listSpecs) {
      if (ck === canonicalKey(spec.countKey)) {
        const n = Math.max(0, Number.parseInt(String(value), 10) || 0);
        if (!Array.isArray(rec[spec.arrayKey])) rec[spec.arrayKey] = [];
        const next = rec[spec.arrayKey].slice(0, n);
        while (next.length < n) next.push('');
        rec[spec.arrayKey] = next;
        rec[spec.countKey] = n;
        return true;
      }
      const match = ck.match(new RegExp(`^${spec.prefix}(\\d+)$`));
      if (match) {
        const idx = Number.parseInt(match[1], 10);
        if (!Number.isFinite(idx) || idx < 0) return false;
        if (!Array.isArray(rec[spec.arrayKey])) rec[spec.arrayKey] = [];
        while (rec[spec.arrayKey].length <= idx) rec[spec.arrayKey].push('');
        rec[spec.arrayKey][idx] = String(value);
        rec[spec.countKey] = rec[spec.arrayKey].length;
        return true;
      }
    }
  }

  if (code === 'TECH') {
    const prereqMatch = ck.match(/^prerequisite(\d+)$/);
    if (prereqMatch) {
      const idx = Number.parseInt(prereqMatch[1], 10) - 1;
      if (!Number.isFinite(idx) || idx < 0) return false;
      rec.prerequisites = ensureArraySize(rec.prerequisites, Math.max(4, idx + 1), -1);
      rec.prerequisites[idx] = parseEditInt(value, -1);
      return true;
    }
  }

  if (code === 'GOVT') {
    const aliasMap = {
      assimilationchance: 'assimilation',
      militarypolicelimit: 'militaryPolice',
      freeunitspertown: 'perTown',
      freeunitspercity: 'perCity',
      freeunitspermetropolis: 'perMetropolis',
      questionmarkone: 'questionMark1',
      questionmarktwo: 'qm2',
      questionmarkthree: 'qm3',
      questionmarkfour: 'qm4'
    };
    if (Object.prototype.hasOwnProperty.call(aliasMap, ck)) {
      rec[aliasMap[ck]] = parseEditInt(value, 0);
      return true;
    }
    const titleMatch = ck.match(/^(male|female)titleera(\d+)$/);
    if (titleMatch) {
      const isFemale = titleMatch[1] === 'female';
      const eraIdx = Number.parseInt(titleMatch[2], 10) - 1;
      if (!Number.isFinite(eraIdx) || eraIdx < 0) return false;
      const titleIdx = eraIdx * 2 + (isFemale ? 1 : 0);
      rec.rulerTitles = ensureArraySize(rec.rulerTitles, Math.max(8, titleIdx + 1), '');
      rec.rulerTitles[titleIdx] = String(value);
      return true;
    }
    const relationMatch = ck.match(/^govtrelation(\d+)(canbribe|briberymod|resistancemod)$/);
    if (relationMatch) {
      const relIdx = Number.parseInt(relationMatch[1], 10);
      if (!Number.isFinite(relIdx) || relIdx < 0) return false;
      rec.relations = ensureArraySize(rec.relations, relIdx + 1, { canBribe: 0, briberyMod: 0, resistanceMod: 0 });
      if (!rec.relations[relIdx] || typeof rec.relations[relIdx] !== 'object') {
        rec.relations[relIdx] = { canBribe: 0, briberyMod: 0, resistanceMod: 0 };
      }
      const parsed = parseEditInt(value, 0);
      if (relationMatch[2] === 'canbribe') rec.relations[relIdx].canBribe = parsed;
      if (relationMatch[2] === 'briberymod') rec.relations[relIdx].briberyMod = parsed;
      if (relationMatch[2] === 'resistancemod') rec.relations[relIdx].resistanceMod = parsed;
      rec.numGovts = rec.relations.length;
      return true;
    }
  }

  if (code === 'ERAS' && ck === 'name') {
    rec.name = String(value);
    rec.eraName = String(value);
    return true;
  }

  // TILE: surgical raw edit
  if (code === 'TILE') {
    return setTileRecordFieldValue(rec, ck, value);
  }

  // CITY buildings list
  if (code === 'CITY' && (ck === 'buildings' || ck === 'numbuildings')) {
    if (ck === 'numbuildings') return true; // numBuildings derived from array length
    const parts = String(value || '').split(/[,\s]+/).filter(Boolean);
    rec.buildings = parts.map((p) => Number.parseInt(p, 10)).filter((n) => Number.isFinite(n));
    return true;
  }

  // LEAD: tech indices (dynamic list keyed by position)
  if (code === 'LEAD') {
    if (ck === 'numberofdifferentstartunits') {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n) && n >= 0) {
        if (!Array.isArray(rec.startUnits)) rec.startUnits = [];
        while (rec.startUnits.length < n) rec.startUnits.push({ startUnitCount: 0, startUnitIndex: rec.startUnits.length });
        if (rec.startUnits.length > n) rec.startUnits.length = n;
        rec.numStartUnits = rec.startUnits.length;
      }
      return true;
    }
    const startUnitMatch = ck.match(/^startingunitsoftype(.+)$/);
    if (startUnitMatch) {
      const rawTarget = String(startUnitMatch[1] || '').trim().toLowerCase();
      let startUnitIndex = Number.parseInt(rawTarget, 10);
      if (!Number.isFinite(startUnitIndex)) {
        if (rawTarget === 'settler') startUnitIndex = 0;
        else if (rawTarget === 'worker') startUnitIndex = 1;
      }
      if (!Number.isFinite(startUnitIndex) || startUnitIndex < 0) return true;
      if (!Array.isArray(rec.startUnits)) rec.startUnits = [];
      const startUnitCount = Number.parseInt(value, 10);
      const existingIdx = rec.startUnits.findIndex((entry) => Number(entry && entry.startUnitIndex) === startUnitIndex);
      if (!Number.isFinite(startUnitCount) || startUnitCount <= 0) {
        if (existingIdx >= 0) rec.startUnits.splice(existingIdx, 1);
      } else if (existingIdx >= 0) {
        rec.startUnits[existingIdx].startUnitCount = startUnitCount;
      } else {
        rec.startUnits.push({ startUnitCount, startUnitIndex });
      }
      rec.startUnits.sort((a, b) => Number(a.startUnitIndex) - Number(b.startUnitIndex));
      rec.numStartUnits = rec.startUnits.length;
      return true;
    }
    if (ck === 'numberofstartingtechnologies') {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n) && n >= 0) {
        if (!Array.isArray(rec.techIndices)) rec.techIndices = [];
        while (rec.techIndices.length < n) rec.techIndices.push(0);
        if (rec.techIndices.length > n) rec.techIndices.length = n;
      }
      return true;
    }
    const techMatch = ck.match(/^startingtechnology(\d+)$/);
    if (techMatch) {
      const techPos = Number.parseInt(techMatch[1], 10);
      if (!Array.isArray(rec.techIndices)) rec.techIndices = [];
      while (rec.techIndices.length <= techPos) rec.techIndices.push(0);
      const n = Number.parseInt(value, 10);
      rec.techIndices[techPos] = Number.isFinite(n) ? n : 0;
      return true;
    }
  }

  // GAME: victoryConditionsAndRules bitmask individual flags
  if (code === 'GAME') {
    if (ck === 'numberofplayablecivs') {
      const n = Math.max(0, parseEditInt(value, 0));
      rec.playableCivIds = ensureArraySize(rec.playableCivIds, n, -1).slice(0, n);
      rec.civPartOfWhichAlliance = ensureArraySize(rec.civPartOfWhichAlliance, n, 4).slice(0, n);
      rec.numPlayableCivs = n;
      return true;
    }
    if (ck === 'playablecivids') {
      const ids = String(value || '')
        .split(/[,\s]+/)
        .map((part) => parseEditInt(part, NaN))
        .filter((part) => Number.isFinite(part) && part >= 0);
      rec.playableCivIds = ids;
      rec.civPartOfWhichAlliance = ensureArraySize(rec.civPartOfWhichAlliance, ids.length, 4).slice(0, ids.length);
      rec.numPlayableCivs = ids.length;
      return true;
    }
    const playableMatch = ck.match(/^playableciv(\d+)$/);
    if (playableMatch) {
      const idx = Number.parseInt(playableMatch[1], 10);
      if (!Number.isFinite(idx) || idx < 0) return false;
      rec.playableCivIds = ensureArraySize(rec.playableCivIds, idx + 1, -1);
      rec.playableCivIds[idx] = parseEditInt(value, -1);
      rec.civPartOfWhichAlliance = ensureArraySize(rec.civPartOfWhichAlliance, rec.playableCivIds.length, 4).slice(0, rec.playableCivIds.length);
      rec.numPlayableCivs = rec.playableCivIds.length;
      return true;
    }
    const turnsMatch = ck.match(/^turnsintimesection(\d+)$/);
    if (turnsMatch) {
      const idx = Number.parseInt(turnsMatch[1], 10);
      if (!Number.isFinite(idx) || idx < 0) return false;
      rec.turnsPerTimescale = ensureArraySize(rec.turnsPerTimescale, idx + 1, 0);
      rec.turnsPerTimescale[idx] = parseEditInt(value, 0);
      return true;
    }
    const perTurnMatch = ck.match(/^timeperturnintimesection(\d+)$/);
    if (perTurnMatch) {
      const idx = Number.parseInt(perTurnMatch[1], 10);
      if (!Number.isFinite(idx) || idx < 0) return false;
      rec.timeUnitsPerTurn = ensureArraySize(rec.timeUnitsPerTurn, idx + 1, 0);
      rec.timeUnitsPerTurn[idx] = parseEditInt(value, 0);
      return true;
    }
    const VCR_FLAG_BITS = {
      dominationenabled: 0, spaceraceenabled: 1, diplomacticenabled: 2,
      conquestenabled: 3, culturalenabled: 4, civspecificabilitiesenabled: 5,
      culturallylinkedstart: 6, restartplayersenabled: 7,
      preserverandomseed: 8, acceleratedproduction: 9,
      eliminationenabled: 10, regicideenabled: 11, massregicideenabled: 12,
      victorylocationsenabled: 13, capturetheflag: 14, allowculturalconversions: 15,
      wondervictoryenabled: 16, reversecapturetheflag: 17, scientificleaders: 18,
    };
    if (Object.prototype.hasOwnProperty.call(VCR_FLAG_BITS, ck)) {
      const bit = VCR_FLAG_BITS[ck];
      const on = value === '1' || value === 'true';
      const cur = rec.victoryConditionsAndRules | 0;
      rec.victoryConditionsAndRules = on ? (cur | (1 << bit)) : (cur & ~(1 << bit));
      return true;
    }
  }

  if (code === 'TERR') {
    if (ck === 'numpossibleresources') {
      const count = Math.max(0, parseEditInt(value, 0));
      const nextMask = Buffer.alloc(Math.ceil(count / 8));
      const currentMask = Buffer.isBuffer(rec.possibleResources) ? rec.possibleResources : Buffer.alloc(0);
      currentMask.copy(nextMask, 0, 0, Math.min(currentMask.length, nextMask.length));
      rec.numTotalResources = count;
      rec.possibleResources = nextMask;
      return true;
    }
    if (ck === 'possibleresourcesmask') {
      const maskValues = String(value || '')
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((part) => parseEditInt(part, 0) ? 1 : 0);
      const count = Math.max(rec.numTotalResources | 0, maskValues.length);
      const nextMask = Buffer.alloc(Math.ceil(count / 8));
      for (let i = 0; i < maskValues.length; i += 1) {
        if (!maskValues[i]) continue;
        nextMask[i >> 3] |= (1 << (i & 7));
      }
      rec.numTotalResources = count;
      rec.possibleResources = nextMask;
      return true;
    }
  }

  // PRTO: list fields stored under plural camelCase keys in the rec object,
  // but edits arrive with singular keys from collapseUnitBiqFields.
  if (code === 'PRTO') {
    const prtoListMap = {
      stealthtarget: 'stealthTargets',
      legalunittelepad: 'legalUnitTelepads',
      legalbuildingtelepad: 'legalBuildingTelepads',
    };
    if (Object.prototype.hasOwnProperty.call(prtoListMap, ck)) {
      const arrayKey = prtoListMap[ck];
      const parts = String(value || '').split(',').filter(Boolean);
      rec[arrayKey] = parts.map((p) => parseEditInt(p.trim(), NaN)).filter((n) => Number.isFinite(n));
      return true;
    }
    if (ck === 'numstealthtargets' || ck === 'numlegalunittelepads' || ck === 'numlegalbuildingtelepads') {
      return true; // derived from array length on write; no-op
    }
  }

  if (code === 'CLNY') {
    if (ck === 'ownertype') {
      rec.ownerType = parseEditInt(value, 0);
      return true;
    }
    if (ck === 'owner') {
      rec.owner = parseEditInt(value, -1);
      return true;
    }
    if (ck === 'x') {
      rec.x = parseEditInt(value, 0);
      return true;
    }
    if (ck === 'y') {
      rec.y = parseEditInt(value, 0);
      return true;
    }
    if (ck === 'improvementtype') {
      rec.improvementType = parseEditInt(value, 0);
      return true;
    }
  }

  // Generic: set field on rec object
  // Try exact camelCase match first
  for (const key of Object.keys(rec)) {
    if (key.startsWith('_')) continue;
    if (canonicalKey(key) === ck) {
      const old = rec[key];
      if (typeof old === 'number' || old == null) {
        const n = parseEditInt(value, NaN);
        rec[key] = Number.isFinite(n) ? n : (old || 0);
      } else if (typeof old === 'string') {
        rec[key] = String(value);
      } else if (Array.isArray(old)) {
        // Try to parse as array
        const parts = String(value || '').split(/[,\s]+/).filter(Boolean);
        rec[key] = parts.map((p) => Number.parseInt(p, 10)).filter((n) => Number.isFinite(n));
      } else {
        rec[key] = value;
      }
      return true;
    }
  }

  // If field doesn't exist yet (new record), create it
  const n = parseEditInt(value, NaN);
  if (Number.isFinite(n)) {
    rec[ck] = n;
  } else {
    rec[ck] = value;
  }
  return true;
}

// ---------------------------------------------------------------------------
// createDefaultRecord: create a blank record for ADD operation
// ---------------------------------------------------------------------------

function createDefaultRecord(code, civKey, io) {
  const name = civKey.replace(/^[A-Z]+_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  switch (code) {
    case 'TECH': return {
      name, civilopediaEntry: civKey, cost: 0, era: 0, advanceIcon: 0, x: 0, y: 0,
      prerequisites: [-1, -1, -1, -1], flags: 0, flavors: 0, questionMark: 0
    };
    case 'BLDG': {
      const rec = { description: '', name, civilopediaEntry: civKey };
      for (const sn of BLDG_SCALAR_NAMES) rec[sn] = 0;
      rec.doublesHappiness = -1; rec.gainInEveryCity = -1; rec.gainOnContinent = -1;
      rec.reqImprovement = -1; rec.reqAdvance = -1; rec.obsoleteBy = -1;
      rec.reqResource1 = -1; rec.reqResource2 = -1; rec.reqGovernment = -1;
      rec.spaceshipPart = -1; rec.unitProduced = -1;
      return rec;
    }
    case 'GOOD': return {
      name, civilopediaEntry: civKey, type: 0, appearanceRatio: 0, disapperanceProbability: 0,
      icon: 0, prerequisite: -1, foodBonus: 0, shieldsBonus: 0, commerceBonus: 0
    };
    case 'GOVT': {
      return {
        defaultType: 0, transitionType: 0, requiresMaintenance: 0, questionMark1: 0,
        tilePenalty: 0, commerceBonus: 0, name, civilopediaEntry: civKey,
        rulerTitles: Array(8).fill(''), corruption: 0, immuneTo: 0, diplomatLevel: 0, spyLevel: 0,
        numGovts: 0, relations: [],
        hurrying: 0, assimilation: 0, draftLimit: 0, militaryPolice: 0, rulerTitlePairsUsed: 0,
        prerequisiteTechnology: -1, scienceCap: 0, workerRate: 0, qm2: 0, qm3: 0, qm4: 0,
        freeUnits: 0, perTown: 0, perCity: 0, perMetropolis: 0, costPerUnit: 0, warWeariness: 0,
        xenophobic: 0, forceResettlement: 0
      };
    }
    case 'RACE': {
      return {
        numCities: 0, cityNames: [], numMilLeaders: 0, milLeaderNames: [],
        name, leaderTitle: '', civilopediaEntry: civKey, adjective: name, civilizationName: name, noun: name,
        forwardFilenames: Array(io.numEras).fill(''), reverseFilenames: Array(io.numEras).fill(''),
        cultureGroup: 0, leaderGender: 0, civilizationGender: 0, aggressionLevel: 0,
        uniqueCivCounter: 0, shunnedGovernment: -1, favoriteGovernment: -1, defaultColor: 0, uniqueColor: 0,
        freeTechs: [-1, -1, -1, -1], bonuses: 0, governorSettings: 0, buildNever: 0, buildOften: 0, plurality: 0,
        kingUnit: -1, flavors: 0, questionMark: 0, diplomacyTextIndex: -1, numScientificLeaders: 0, scientificLeaderNames: []
      };
    }
    case 'PRTO': {
      const terrainCount = io && io.isConquests ? 14 : 12;
      const prtoRec = {
        zoneOfControl: 0, name, civilopediaEntry: civKey,
        bombardEffects: 0, ignoreMovementCost: Array(terrainCount).fill(0),
        requiresSupport: 0, useExactCost: 7, telepadRange: 0, questionMark3: 1,
        legalUnitTelepads: [], enslaveResultsIn: -1, questionMark5: 1,
        stealthTargets: [], questionMark6: 1, legalBuildingTelepads: [],
        createsCraters: 0, workerStrengthFloat: 0, questionMark8: 0, airDefence: 0,
        _tail: Buffer.alloc(0)
      };
      PRTO_PRIMARY_SCALAR_FIELDS.forEach((key) => {
        prtoRec[key] = (key === 'upgradeTo' || key === 'requiredTech' || key.startsWith('requiredResource')) ? -1 : 0;
      });
      PRTO_MID_SCALAR_FIELDS.forEach((key) => { prtoRec[key] = 0; });
      // Match Quint's new PRTO path: new PRTO(...); setNewUnitDefaults()
      prtoRec.movement = 1;
      prtoRec.AIStrategy = 3;
      prtoRec.availableTo = -2;
      prtoRec.otherStrategy = -1;
      prtoRec.PTWStandardOrders = 127;
      prtoRec.PTWSpecialActions = 781;
      return prtoRec;
    }
    case 'LEAD':
      return {
        humanPlayer: 0,
        customCivData: 0,
        leaderName: '',
        questionMark1: 0,
        questionMark2: 0,
        numStartUnits: 0,
        startUnits: [],
        genderOfLeaderName: 0,
        numStartTechs: 0,
        techIndices: [],
        difficulty: -1,
        initialEra: 0,
        startCash: 10,
        government: 1,
        civ: -3,
        color: 0,
        skipFirstTurn: 0,
        startEmbassies: 0
      };
    case 'CITY': return {
      hasWalls: 0, hasPalace: 0, name: '', ownerType: 2, numBuildings: 0, buildings: [],
      culture: 0, owner: 1, size: 1, x: 0, y: 0, cityLevel: 0, borderLevel: 1, useAutoName: 0
    };
    case 'UNIT': return {
      name: '', ownerType: 1, experienceLevel: 0, owner: 0, pRTONumber: 0,
      AIStrategy: 0, x: 0, y: 0, customName: '', useCivilizationKing: 0
    };
    case 'SLOC': return {
      ownerType: 2, owner: 1, x: 0, y: 0
    };
    case 'CLNY': return {
      ownerType: 2, owner: 1, x: 0, y: 0, improvementType: 0
    };
    default: return { _rawData: Buffer.alloc(0) };
  }
}

// ---------------------------------------------------------------------------
// copyRecord: deep clone a record
// ---------------------------------------------------------------------------

function copyRecord(src) {
  const clone = {};
  for (const [k, v] of Object.entries(src)) {
    if (Buffer.isBuffer(v)) clone[k] = Buffer.from(v);
    else if (Array.isArray(v)) clone[k] = v.map((x) => (Buffer.isBuffer(x) ? Buffer.from(x) : x));
    else clone[k] = v;
  }
  return clone;
}

function getSectionByCode(parsed, sectionCode) {
  const code = String(sectionCode || '').trim().toUpperCase();
  return ((parsed && parsed.sections) || []).find((section) => String(section && section.code || '').trim().toUpperCase() === code) || null;
}

function getRecordCivilopediaRef(record) {
  return String(record && record.civilopediaEntry || '').trim().toUpperCase();
}

function getRecordStructureRef(record) {
  if (!record) return '';
  const newRef = String(record.newRecordRef || '').trim().toUpperCase();
  if (newRef) return newRef;
  const civRef = getRecordCivilopediaRef(record);
  if (civRef) return civRef;
  const idx = Number.parseInt(String(record.index), 10);
  if (Number.isFinite(idx) && idx >= 0) return `@INDEX:${idx}`;
  return '';
}

function normalizeRaceDependentSections(parsed, edits, originalRaceRefs) {
  const raceSection = getSectionByCode(parsed, 'RACE');
  if (!raceSection || !Array.isArray(raceSection.records)) return { ok: true };

  const finalRaceRefs = raceSection.records.map((record) => getRecordCivilopediaRef(record));
  const finalRaceCount = finalRaceRefs.length;
  if (finalRaceCount > 32) {
    return {
      ok: false,
      error: 'Civilization III supports at most 32 civilizations total, including Barbarians. Delete a civilization before adding or importing another one.'
    };
  }

  raceSection.records.forEach((record, index) => {
    record.index = index;
    if (Object.prototype.hasOwnProperty.call(record || {}, 'uniqueCivCounter')) record.uniqueCivCounter = index;
  });

  const raceCrudTouched = (Array.isArray(edits) ? edits : []).some((edit) => {
    const code = String(edit && edit.sectionCode || '').trim().toUpperCase();
    const op = String(edit && edit.op || 'set').trim().toLowerCase();
    return code === 'RACE' && (op === 'add' || op === 'copy' || op === 'delete');
  });
  if (!raceCrudTouched) return { ok: true };

  const oldRaceCount = Array.isArray(originalRaceRefs) ? originalRaceRefs.length : 0;
  const raceDeleteIndices = (Array.isArray(edits) ? edits : [])
    .filter((edit) => {
      const code = String(edit && edit.sectionCode || '').trim().toUpperCase();
      const op = String(edit && edit.op || '').trim().toLowerCase();
      return code === 'RACE' && op === 'delete';
    })
    .map((edit) => (Array.isArray(originalRaceRefs) ? originalRaceRefs : []).indexOf(String(edit && edit.recordRef || '').trim().toUpperCase()))
    .filter((index) => Number.isFinite(index) && index >= 0)
    .sort((a, b) => a - b);
  const deletedRaceIndexSet = new Set(raceDeleteIndices);
  const countDeletedBefore = (index) => {
    let count = 0;
    for (const deletedIndex of raceDeleteIndices) {
      if (deletedIndex >= index) break;
      count += 1;
    }
    return count;
  };

  const hasExplicitPlayableGameEdits = (Array.isArray(edits) ? edits : []).some((edit) => {
    if (String(edit && edit.sectionCode || '').trim().toUpperCase() !== 'GAME') return false;
    const fieldKey = canonicalKey(edit && edit.fieldKey);
    return fieldKey === 'numberofplayablecivs'
      || fieldKey === 'playablecivids'
      || /^playableciv\d+$/.test(fieldKey);
  });
  const hasExplicitLeadCivEdits = (Array.isArray(edits) ? edits : []).some((edit) => {
    if (String(edit && edit.sectionCode || '').trim().toUpperCase() !== 'LEAD') return false;
    return canonicalKey(edit && edit.fieldKey) === 'civ';
  });

  const remapCivilizationIndex = (value) => {
    const parsedValue = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) return null;
    if (parsedValue < oldRaceCount) {
      if (deletedRaceIndexSet.has(parsedValue)) return null;
      return parsedValue - countDeletedBefore(parsedValue);
    }
    if (parsedValue < finalRaceCount) return parsedValue;
    return null;
  };

  const gameSection = getSectionByCode(parsed, 'GAME');
  const gameRecord = gameSection && Array.isArray(gameSection.records) ? gameSection.records[0] : null;
  if (gameRecord) {
    const currentIds = Array.isArray(gameRecord.playableCivIds) ? gameRecord.playableCivIds : [];
    const currentAlliance = Array.isArray(gameRecord.civPartOfWhichAlliance) ? gameRecord.civPartOfWhichAlliance : [];
    const nextIds = [];
    const nextAlliance = [];
    currentIds.forEach((id, idx) => {
      let nextId = null;
      if (hasExplicitPlayableGameEdits) {
        const parsedId = Number.parseInt(String(id), 10);
        nextId = Number.isFinite(parsedId) && parsedId >= 0 && parsedId < finalRaceCount ? parsedId : null;
      } else {
        nextId = remapCivilizationIndex(id);
      }
      if (!Number.isFinite(nextId) || nextId < 0 || nextId >= finalRaceCount) return;
      nextIds.push(nextId);
      nextAlliance.push(Number.isFinite(Number(currentAlliance[idx])) ? Number(currentAlliance[idx]) : 4);
    });
    gameRecord.playableCivIds = nextIds;
    gameRecord.civPartOfWhichAlliance = nextAlliance;
    gameRecord.numPlayableCivs = nextIds.length;
    gameSection._modified = true;
  }

  const leadSection = getSectionByCode(parsed, 'LEAD');
  if (leadSection && Array.isArray(leadSection.records)) {
    leadSection.records.forEach((record) => {
      const currentCiv = Number.parseInt(String(record && record.civ), 10);
      if (!Number.isFinite(currentCiv) || currentCiv < 0) return;
      let nextCiv = null;
      if (hasExplicitLeadCivEdits) {
        nextCiv = currentCiv < finalRaceCount ? currentCiv : null;
      } else {
        nextCiv = remapCivilizationIndex(currentCiv);
      }
      record.civ = Number.isFinite(nextCiv) && nextCiv >= 0 ? nextCiv : 0;
    });
    leadSection._modified = true;
  }

  parsed._raceDependentSectionsNormalized = true;
  return { ok: true };
}

function buildDeletedSectionRemap(originalRefs, finalRefs, deletedIndices = []) {
  const oldToNew = new Map();
  const oldList = Array.isArray(originalRefs) ? originalRefs : [];
  const newList = Array.isArray(finalRefs) ? finalRefs : [];
  const normalizedDeleted = Array.from(new Set((Array.isArray(deletedIndices) ? deletedIndices : [])
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value >= 0 && value < oldList.length)))
    .sort((a, b) => a - b);

  if (normalizedDeleted.length > 0) {
    const deletedSet = new Set(normalizedDeleted);
    let deletedBefore = 0;
    for (let oldIndex = 0; oldIndex < oldList.length; oldIndex += 1) {
      if (deletedSet.has(oldIndex)) {
        deletedBefore += 1;
        continue;
      }
      oldToNew.set(oldIndex, oldIndex - deletedBefore);
    }
  } else {
    oldList.forEach((ref, oldIndex) => {
      const newIndex = newList.indexOf(ref);
      if (newIndex >= 0) oldToNew.set(oldIndex, newIndex);
    });
  }
  return {
    oldCount: oldList.length,
    finalCount: newList.length,
    oldToNew
  };
}

function composeDeletedSectionRemaps(firstRemap, secondRemap) {
  if (!firstRemap) return secondRemap || null;
  if (!secondRemap) return firstRemap || null;
  const oldToNew = new Map();
  for (let oldIndex = 0; oldIndex < firstRemap.oldCount; oldIndex += 1) {
    const midIndex = remapDeletedSectionIndex(oldIndex, firstRemap, null);
    if (!Number.isFinite(midIndex) || midIndex < 0) continue;
    const finalIndex = remapDeletedSectionIndex(midIndex, secondRemap, null);
    if (!Number.isFinite(finalIndex) || finalIndex < 0) continue;
    oldToNew.set(oldIndex, finalIndex);
  }
  return {
    oldCount: firstRemap.oldCount,
    finalCount: secondRemap.finalCount,
    oldToNew
  };
}

function remapDeletedSectionIndex(value, remap, deletedFallback = -1) {
  const parsedValue = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) return parsedValue;
  if (!remap) return parsedValue;
  if (parsedValue < remap.oldCount) {
    return remap.oldToNew.has(parsedValue) ? remap.oldToNew.get(parsedValue) : deletedFallback;
  }
  if (parsedValue < remap.finalCount) return parsedValue;
  return deletedFallback;
}

function remapDeletedSectionList(values, remap, deletedFallback = -1) {
  return (Array.isArray(values) ? values : []).map((value) => remapDeletedSectionIndex(value, remap, deletedFallback));
}

function remapDeletedSectionListRemovingDeleted(values, remap) {
  return (Array.isArray(values) ? values : [])
    .map((value) => remapDeletedSectionIndex(value, remap, null))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function shiftPossibleResourcesMask(mask, totalCount, remap) {
  const oldCount = Number.isFinite(Number(totalCount)) ? Math.max(0, Number(totalCount)) : 0;
  const bits = [];
  const source = Buffer.isBuffer(mask) ? mask : Buffer.alloc(0);
  for (let i = 0; i < oldCount; i += 1) {
    const byteIndex = i >> 3;
    const bitMask = 1 << (i & 7);
    bits.push(byteIndex < source.length && (source[byteIndex] & bitMask) !== 0 ? 1 : 0);
  }
  const nextBits = [];
  for (let i = 0; i < oldCount; i += 1) {
    const nextIndex = remapDeletedSectionIndex(i, remap, null);
    if (!Number.isFinite(nextIndex) || nextIndex < 0) continue;
    nextBits[nextIndex] = bits[i] ? 1 : 0;
  }
  const nextCount = remap ? remap.finalCount : oldCount;
  const nextMask = Buffer.alloc(Math.ceil(nextCount / 8));
  for (let i = 0; i < nextCount; i += 1) {
    if (!nextBits[i]) continue;
    nextMask[i >> 3] |= 1 << (i & 7);
  }
  return { numTotalResources: nextCount, possibleResources: nextMask };
}

function remapDeletedCivilizationAvailabilityMask(maskValue, remap) {
  const parsedMask = Number.parseInt(String(maskValue), 10);
  const unsignedMask = Number.isFinite(parsedMask) ? (parsedMask >>> 0) : 0;
  if (!remap) return unsignedMask | 0;
  let nextMask = 0 >>> 0;
  const upperBound = Math.min(32, Number.isFinite(remap.oldCount) ? remap.oldCount : 32);
  for (let oldIndex = 0; oldIndex < upperBound; oldIndex += 1) {
    if (((unsignedMask >>> oldIndex) & 1) !== 1) continue;
    const nextIndex = remapDeletedSectionIndex(oldIndex, remap, null);
    if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= 32) continue;
    nextMask = (nextMask | ((1 << nextIndex) >>> 0)) >>> 0;
  }
  if (upperBound < 32) {
    for (let bit = upperBound; bit < 32; bit += 1) {
      if (((unsignedMask >>> bit) & 1) !== 1) continue;
      nextMask = (nextMask | ((1 << bit) >>> 0)) >>> 0;
    }
  }
  return nextMask | 0;
}

function normalizeDeletedReferenceSections(parsed, edits, originalRefsBySection) {
  const deleteTouchedCodes = new Set((Array.isArray(edits) ? edits : [])
    .filter((edit) => String(edit && edit.op || '').trim().toLowerCase() === 'delete')
    .map((edit) => String(edit && edit.sectionCode || '').trim().toUpperCase())
    .filter(Boolean));
  if (deleteTouchedCodes.size === 0) return { ok: true };

  const sections = ((parsed && parsed.sections) || []);
  const remaps = new Map();
  deleteTouchedCodes.forEach((code) => {
    const section = getSectionByCode(parsed, code);
    const originalRefs = (originalRefsBySection && originalRefsBySection[code]) || [];
    const deletedIndices = (Array.isArray(edits) ? edits : [])
      .filter((edit) => String(edit && edit.op || '').trim().toLowerCase() === 'delete'
        && String(edit && edit.sectionCode || '').trim().toUpperCase() === code)
      .map((edit) => originalRefs.indexOf(String(edit && edit.recordRef || '').trim().toUpperCase()))
      .filter((index) => index >= 0);
    const finalRefs = section && Array.isArray(section.records)
      ? section.records.map((record) => getRecordStructureRef(record))
      : [];
    remaps.set(code, buildDeletedSectionRemap(originalRefs, finalRefs, deletedIndices));
  });

  const techRemap = remaps.get('TECH');
  const goodRemap = remaps.get('GOOD');
  const bldgRemap = remaps.get('BLDG');
  const govtRemap = remaps.get('GOVT');
  const prtoRemap = remaps.get('PRTO');
  let raceRemap = remaps.get('RACE');
  const raceDependentSectionsAlreadyNormalized = parsed && parsed._raceDependentSectionsNormalized === true;
  const erasRemap = remaps.get('ERAS');
  const diffRemap = remaps.get('DIFF');
  const espnRemap = remaps.get('ESPN');
  const tfrmRemap = remaps.get('TFRM');
  const terrRemap = remaps.get('TERR');
  const leadRemap = remaps.get('LEAD');
  const markModified = (section) => {
    if (section) section._modified = true;
  };
  const normalizeMapOwnerSection = (sectionCode, ownerTypeToMatch, remap, options = {}) => {
    if (!remap) return { ok: true, remap: null };
    const section = getSectionByCode(parsed, sectionCode);
    if (!section || !Array.isArray(section.records)) return { ok: true, remap: null };
    const originalRefs = section.records.map((record) => getRecordStructureRef(record));
    const nextRecords = [];
    const deletedOriginalIndices = [];
    let changed = false;
    for (let originalIndex = 0; originalIndex < section.records.length; originalIndex += 1) {
      const record = section.records[originalIndex];
      const ownerType = Number.parseInt(String(record && record.ownerType), 10);
      if (ownerType !== ownerTypeToMatch) {
        nextRecords.push(record);
        continue;
      }
      const nextOwner = remapDeletedSectionIndex(record && record.owner, remap, null);
      if (!Number.isFinite(nextOwner) || nextOwner < 0) {
        if (options.failOnDeletedOwner) {
          return {
            ok: false,
            error: `Deleting civilization(s) still referenced by ${sectionCode} map ownership is not supported safely; ${sectionCode} record ${originalIndex} still points at deleted civilization ${record && record.owner}.`
          };
        }
        if (options.deleteOnDeletedOwner) {
          deletedOriginalIndices.push(originalIndex);
          changed = true;
          continue;
        }
        nextRecords.push(record);
        continue;
      }
      if (Number(record.owner) !== nextOwner) {
        record.owner = nextOwner;
        changed = true;
      }
      nextRecords.push(record);
    }
    nextRecords.forEach((record, index) => {
      if (Object.prototype.hasOwnProperty.call(record || {}, 'index')) record.index = index;
    });
    if (changed || deletedOriginalIndices.length > 0 || nextRecords.length !== section.records.length) {
      section.records = nextRecords;
      markModified(section);
    }
    return {
      ok: true,
      remap: deletedOriginalIndices.length > 0
        ? buildDeletedSectionRemap(originalRefs, nextRecords.map((record) => getRecordStructureRef(record)), deletedOriginalIndices)
        : null
    };
  };

  const raceSection = getSectionByCode(parsed, 'RACE');
  if (raceSection && Array.isArray(raceSection.records)) {
    raceSection.records.forEach((rec) => {
      if (techRemap) rec.freeTechs = remapDeletedSectionList(ensureArraySize(rec.freeTechs, 4, -1), techRemap, -1);
      if (govtRemap) {
        rec.favoriteGovernment = remapDeletedSectionIndex(rec.favoriteGovernment, govtRemap, -1);
        rec.shunnedGovernment = remapDeletedSectionIndex(rec.shunnedGovernment, govtRemap, -1);
      }
      if (prtoRemap) rec.kingUnit = remapDeletedSectionIndex(rec.kingUnit, prtoRemap, -1);
    });
    if (techRemap || govtRemap || prtoRemap) markModified(raceSection);
  }

  const goodSection = getSectionByCode(parsed, 'GOOD');
  if (goodSection && Array.isArray(goodSection.records) && techRemap) {
    goodSection.records.forEach((rec) => {
      rec.prerequisite = remapDeletedSectionIndex(rec.prerequisite, techRemap, -1);
    });
    markModified(goodSection);
  }

  const techSection = getSectionByCode(parsed, 'TECH');
  if (techSection && Array.isArray(techSection.records)) {
    techSection.records.forEach((rec, index) => {
      if (techRemap) rec.prerequisites = remapDeletedSectionList(ensureArraySize(rec.prerequisites, 4, -1), techRemap, -1);
      if (erasRemap) rec.era = remapDeletedSectionIndex(rec.era, erasRemap, -1);
      rec.index = index;
    });
    if (techRemap || erasRemap) markModified(techSection);
  }

  const govtSection = getSectionByCode(parsed, 'GOVT');
  if (govtSection && Array.isArray(govtSection.records)) {
    govtSection.records.forEach((rec, index) => {
      if (techRemap) rec.prerequisiteTechnology = remapDeletedSectionIndex(rec.prerequisiteTechnology, techRemap, -1);
      if (espnRemap) rec.immuneTo = remapDeletedSectionIndex(rec.immuneTo, espnRemap, -1);
      rec.index = index;
    });
    if (govtRemap) {
      govtSection.records.forEach((rec) => {
        const relations = Array.isArray(rec.relations) ? rec.relations : [];
        const nextRelations = [];
        for (let oldIndex = 0; oldIndex < relations.length; oldIndex += 1) {
          const nextIndex = remapDeletedSectionIndex(oldIndex, govtRemap, null);
          if (!Number.isFinite(nextIndex) || nextIndex < 0) continue;
          nextRelations[nextIndex] = relations[oldIndex];
        }
        rec.relations = [];
        for (let i = 0; i < govtRemap.finalCount; i += 1) {
          rec.relations.push(nextRelations[i] || { canBribe: 0, briberyMod: 0, resistanceMod: 0 });
        }
        rec.numGovts = rec.relations.length;
      });
    }
    if (techRemap || govtRemap || espnRemap) markModified(govtSection);
  }

  const ctznSection = getSectionByCode(parsed, 'CTZN');
  if (ctznSection && Array.isArray(ctznSection.records) && techRemap) {
    ctznSection.records.forEach((rec) => {
      rec.prerequisite = remapDeletedSectionIndex(rec.prerequisite, techRemap, -1);
    });
    markModified(ctznSection);
  }

  const bldgSection = getSectionByCode(parsed, 'BLDG');
  if (bldgSection && Array.isArray(bldgSection.records)) {
    bldgSection.records.forEach((rec) => {
      if (techRemap) {
        rec.reqAdvance = remapDeletedSectionIndex(rec.reqAdvance, techRemap, -1);
        rec.obsoleteBy = remapDeletedSectionIndex(rec.obsoleteBy, techRemap, -1);
      }
      if (goodRemap) {
        rec.reqResource1 = remapDeletedSectionIndex(rec.reqResource1, goodRemap, -1);
        rec.reqResource2 = remapDeletedSectionIndex(rec.reqResource2, goodRemap, -1);
      }
      if (govtRemap) rec.reqGovernment = remapDeletedSectionIndex(rec.reqGovernment, govtRemap, -1);
      if (bldgRemap) {
        rec.gainInEveryCity = remapDeletedSectionIndex(rec.gainInEveryCity, bldgRemap, 0);
        rec.gainOnContinent = remapDeletedSectionIndex(rec.gainOnContinent, bldgRemap, 0);
        rec.reqImprovement = remapDeletedSectionIndex(rec.reqImprovement, bldgRemap, 0);
        rec.doublesHappiness = remapDeletedSectionIndex(rec.doublesHappiness, bldgRemap, 0);
      }
      if (prtoRemap) rec.unitProduced = remapDeletedSectionIndex(rec.unitProduced, prtoRemap, -1);
    });
    if (techRemap || goodRemap || govtRemap || bldgRemap || prtoRemap) markModified(bldgSection);
  }

  const gameSection = getSectionByCode(parsed, 'GAME');
  if (gameSection && Array.isArray(gameSection.records) && raceRemap && !raceDependentSectionsAlreadyNormalized) {
    gameSection.records.forEach((rec) => {
      const currentIds = Array.isArray(rec.playableCivIds) ? rec.playableCivIds : [];
      rec.playableCivIds = remapDeletedSectionListRemovingDeleted(currentIds, raceRemap);
      rec.numPlayableCivs = rec.playableCivIds.length;
      const currentAlliances = Array.isArray(rec.civPartOfWhichAlliance) ? rec.civPartOfWhichAlliance : [];
      rec.civPartOfWhichAlliance = ensureArraySize(currentAlliances, rec.playableCivIds.length, 4)
        .slice(0, rec.playableCivIds.length);
    });
    markModified(gameSection);
  }

  const prtoSection = getSectionByCode(parsed, 'PRTO');
  if (prtoSection && Array.isArray(prtoSection.records)) {
    prtoSection.records.forEach((rec) => {
      if (raceRemap) rec.availableTo = remapDeletedCivilizationAvailabilityMask(rec.availableTo, raceRemap);
      if (goodRemap) {
        rec.requiredResource1 = remapDeletedSectionIndex(rec.requiredResource1, goodRemap, -1);
        rec.requiredResource2 = remapDeletedSectionIndex(rec.requiredResource2, goodRemap, -1);
        rec.requiredResource3 = remapDeletedSectionIndex(rec.requiredResource3, goodRemap, -1);
      }
      if (techRemap) rec.requiredTech = remapDeletedSectionIndex(rec.requiredTech, techRemap, -1);
      if (prtoRemap) {
        rec.upgradeTo = remapDeletedSectionIndex(rec.upgradeTo, prtoRemap, -1);
        rec.enslaveResultsIn = remapDeletedSectionIndex(rec.enslaveResultsIn, prtoRemap, -1);
        rec.legalUnitTelepads = remapDeletedSectionListRemovingDeleted(rec.legalUnitTelepads, prtoRemap);
        rec.stealthTargets = remapDeletedSectionListRemovingDeleted(rec.stealthTargets, prtoRemap);
      }
      if (bldgRemap) rec.legalBuildingTelepads = remapDeletedSectionListRemovingDeleted(rec.legalBuildingTelepads, bldgRemap);
    });
    if (raceRemap || goodRemap || techRemap || prtoRemap || bldgRemap) markModified(prtoSection);
  }

  const ruleSection = getSectionByCode(parsed, 'RULE');
  if (ruleSection && Array.isArray(ruleSection.records)) {
    ruleSection.records.forEach((rec) => {
      if (diffRemap && Object.prototype.hasOwnProperty.call(rec, 'defaultDifficultyLevel')) {
        rec.defaultDifficultyLevel = remapDeletedSectionIndex(rec.defaultDifficultyLevel, diffRemap, -1);
      }
      if (goodRemap) rec.defaultMoneyResource = remapDeletedSectionIndex(rec.defaultMoneyResource, goodRemap, -1);
      if (prtoRemap) {
        [
          'advancedBarbarian', 'basicBarbarian', 'barbarianSeaUnit', 'battleCreatedUnit',
          'buildArmyUnit', 'scout', 'slave', 'startUnit1', 'startUnit2', 'flagUnit'
        ].forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(rec, key)) rec[key] = remapDeletedSectionIndex(rec[key], prtoRemap, -1);
        });
      }
    });
    if (diffRemap || goodRemap || prtoRemap) markModified(ruleSection);
  }

  const terrSection = getSectionByCode(parsed, 'TERR');
  if (terrSection && Array.isArray(terrSection.records)) {
    terrSection.records.forEach((rec) => {
      if (goodRemap) {
        const next = shiftPossibleResourcesMask(rec.possibleResources, rec.numTotalResources, goodRemap);
        rec.numTotalResources = next.numTotalResources;
        rec.possibleResources = next.possibleResources;
      }
      if (tfrmRemap) rec.workerJob = remapDeletedSectionIndex(rec.workerJob, tfrmRemap, -1);
      if (terrRemap) rec.pollutionEffect = remapDeletedSectionIndex(rec.pollutionEffect, terrRemap, -1);
    });
    if (goodRemap || tfrmRemap || terrRemap) markModified(terrSection);
  }

  const tfrmSection = getSectionByCode(parsed, 'TFRM');
  if (tfrmSection && Array.isArray(tfrmSection.records)) {
    tfrmSection.records.forEach((rec) => {
      if (techRemap) rec.requiredAdvance = remapDeletedSectionIndex(rec.requiredAdvance, techRemap, -1);
      if (goodRemap) {
        rec.requiredResource1 = remapDeletedSectionIndex(rec.requiredResource1, goodRemap, -1);
        rec.requiredResource2 = remapDeletedSectionIndex(rec.requiredResource2, goodRemap, -1);
      }
    });
    if (techRemap || goodRemap) markModified(tfrmSection);
  }

  const slocPlayerCascade = normalizeMapOwnerSection('SLOC', 3, leadRemap, { deleteOnDeletedOwner: true });
  if (!slocPlayerCascade.ok) return slocPlayerCascade;
  const cityPlayerCascade = normalizeMapOwnerSection('CITY', 3, leadRemap, { deleteOnDeletedOwner: true });
  if (!cityPlayerCascade.ok) return cityPlayerCascade;
  const unitPlayerCascade = normalizeMapOwnerSection('UNIT', 3, leadRemap, { deleteOnDeletedOwner: true });
  if (!unitPlayerCascade.ok) return unitPlayerCascade;
  const clnyPlayerCascade = normalizeMapOwnerSection('CLNY', 3, leadRemap, { deleteOnDeletedOwner: true });
  if (!clnyPlayerCascade.ok) return clnyPlayerCascade;

  const slocCivCascade = normalizeMapOwnerSection('SLOC', 2, raceRemap, { failOnDeletedOwner: true });
  if (!slocCivCascade.ok) return slocCivCascade;
  const cityCivCascade = normalizeMapOwnerSection('CITY', 2, raceRemap, { failOnDeletedOwner: true });
  if (!cityCivCascade.ok) return cityCivCascade;
  const unitCivCascade = normalizeMapOwnerSection('UNIT', 2, raceRemap, { failOnDeletedOwner: true });
  if (!unitCivCascade.ok) return unitCivCascade;
  const clnyCivCascade = normalizeMapOwnerSection('CLNY', 2, raceRemap, { failOnDeletedOwner: true });
  if (!clnyCivCascade.ok) return clnyCivCascade;

  const citySection = getSectionByCode(parsed, 'CITY');
  if (citySection && Array.isArray(citySection.records) && bldgRemap) {
    citySection.records.forEach((rec) => {
      rec.buildings = remapDeletedSectionListRemovingDeleted(rec.buildings, bldgRemap);
      rec.numBuildings = Array.isArray(rec.buildings) ? rec.buildings.length : 0;
    });
    markModified(citySection);
  }

  const unitSection = getSectionByCode(parsed, 'UNIT');
  if (unitSection && Array.isArray(unitSection.records) && prtoRemap) {
    unitSection.records.forEach((rec) => {
      rec.pRTONumber = remapDeletedSectionIndex(rec.pRTONumber, prtoRemap, -1);
    });
    markModified(unitSection);
  }

  const tileSection = getSectionByCode(parsed, 'TILE');
  let cityRemap = remaps.get('CITY');
  let clnyRemap = remaps.get('CLNY');
  cityRemap = composeDeletedSectionRemaps(cityRemap, cityPlayerCascade.remap);
  clnyRemap = composeDeletedSectionRemaps(clnyRemap, clnyPlayerCascade.remap);
  if (tileSection && Array.isArray(tileSection.records) && (cityRemap || clnyRemap)) {
    tileSection.records.forEach((rec) => {
      if (cityRemap) setTileRecordFieldValue(rec, 'city', remapDeletedSectionIndex(rec.city, cityRemap, -1));
      if (clnyRemap) setTileRecordFieldValue(rec, 'colony', remapDeletedSectionIndex(rec.colony, clnyRemap, -1));
    });
    markModified(tileSection);
  }

  const leadSection = getSectionByCode(parsed, 'LEAD');
  if (leadSection && Array.isArray(leadSection.records)) {
    leadSection.records.forEach((rec) => {
      if (raceRemap && !raceDependentSectionsAlreadyNormalized) rec.civ = remapDeletedSectionIndex(rec.civ, raceRemap, -1);
      if (techRemap) rec.techIndices = remapDeletedSectionList(Array.isArray(rec.techIndices) ? rec.techIndices : [], techRemap, -1).filter((value) => Number.isFinite(value) && value >= 0);
      if (govtRemap) rec.government = remapDeletedSectionIndex(rec.government, govtRemap, -1);
      if (diffRemap) rec.difficulty = remapDeletedSectionIndex(rec.difficulty, diffRemap, -1);
      if (erasRemap) rec.initialEra = remapDeletedSectionIndex(rec.initialEra, erasRemap, -1);
      if (prtoRemap) {
        rec.startUnits = (Array.isArray(rec.startUnits) ? rec.startUnits : [])
          .map((entry) => ({
            ...entry,
            startUnitIndex: remapDeletedSectionIndex(entry && entry.startUnitIndex, prtoRemap, -1)
          }))
          .filter((entry) => Number.isFinite(entry.startUnitIndex) && entry.startUnitIndex >= 0 && Number(entry.startUnitCount) > 0);
        rec.numStartUnits = rec.startUnits.length;
      }
      if (techRemap) rec.numStartTechs = Array.isArray(rec.techIndices) ? rec.techIndices.length : 0;
    });
    if ((raceRemap && !raceDependentSectionsAlreadyNormalized) || techRemap || govtRemap || diffRemap || erasRemap || prtoRemap) markModified(leadSection);
  }

  return { ok: true };
}

function collectMapReferenceIntegrityIssues(parsed) {
  const issues = [];
  const tileSection = getSectionByCode(parsed, 'TILE');
  if (!tileSection || !Array.isArray(tileSection.records)) return issues;
  const wmapSection = getSectionByCode(parsed, 'WMAP');
  const raceSection = getSectionByCode(parsed, 'RACE');
  const leadSection = getSectionByCode(parsed, 'LEAD');
  const slocSection = getSectionByCode(parsed, 'SLOC');
  const citySection = getSectionByCode(parsed, 'CITY');
  const unitSection = getSectionByCode(parsed, 'UNIT');
  const clnySection = getSectionByCode(parsed, 'CLNY');
  const mapWidth = Number(parsed && parsed.io && parsed.io.mapWidth)
    || Number(wmapSection && Array.isArray(wmapSection.records) && wmapSection.records[0] && wmapSection.records[0].width)
    || 0;
  const mapHeight = Number(wmapSection && Array.isArray(wmapSection.records) && wmapSection.records[0] && wmapSection.records[0].height) || 0;
  const cityCount = citySection && Array.isArray(citySection.records) ? citySection.records.length : 0;
  const unitCount = unitSection && Array.isArray(unitSection.records) ? unitSection.records.length : 0;
  const clnyCount = clnySection && Array.isArray(clnySection.records) ? clnySection.records.length : 0;
  const raceCount = raceSection && Array.isArray(raceSection.records) ? raceSection.records.length : 0;
  const playerCount = leadSection && Array.isArray(leadSection.records) ? leadSection.records.length : 0;
  const normalizeRef = (value) => {
    const parsedValue = Number.parseInt(String(value), 10);
    return Number.isFinite(parsedValue) ? parsedValue : -1;
  };
  const tileByCoords = new Map();
  const cityRefCounts = new Map();
  const colonyRefCounts = new Map();
  const getCoords = (record, xKey = 'x', yKey = 'y') => ({
    x: normalizeRef(record && record[xKey]),
    y: normalizeRef(record && record[yKey])
  });
  const getTileCoords = (record) => ({
    x: normalizeRef(record && record.xpos),
    y: normalizeRef(record && record.ypos)
  });
  const isInBounds = (coords) => (
    Number.isFinite(coords.x)
    && Number.isFinite(coords.y)
    && coords.x >= 0
    && coords.y >= 0
    && (!mapWidth || coords.x < mapWidth)
    && (!mapHeight || coords.y < mapHeight)
  );
  const validateOwnerRef = (sectionCode, recordIndex, record) => {
    const ownerType = normalizeRef(record && record.ownerType);
    const owner = normalizeRef(record && record.owner);
    if (ownerType === 0 || ownerType === 1) return;
    if (ownerType === 2) {
      if (owner < 0 || owner >= raceCount) {
        issues.push({
          kind: `${String(sectionCode || '').toLowerCase()}-owner-ref`,
          sectionCode,
          recordRef: recordIndex,
          ownerType,
          owner,
          raceCount,
          playerCount
        });
      }
      return;
    }
    if (ownerType === 3) {
      if (owner < 0 || owner >= playerCount) {
        issues.push({
          kind: `${String(sectionCode || '').toLowerCase()}-owner-ref`,
          sectionCode,
          recordRef: recordIndex,
          ownerType,
          owner,
          raceCount,
          playerCount
        });
      }
      return;
    }
    issues.push({
      kind: `${String(sectionCode || '').toLowerCase()}-owner-type`,
      sectionCode,
      recordRef: recordIndex,
      ownerType,
      owner
    });
  };
  tileSection.records.forEach((rec, tileIndex) => {
    const tileCoords = getTileCoords(rec);
    if (isInBounds(tileCoords)) tileByCoords.set(`${tileCoords.x},${tileCoords.y}`, rec);
    const cityRef = normalizeRef(rec && rec.city);
    if (cityRef >= cityCount) {
      issues.push({
        kind: 'tile-city-ref',
        tileIndex,
        cityRef,
        cityCount
      });
    } else if (cityRef >= 0) {
      cityRefCounts.set(cityRef, (cityRefCounts.get(cityRef) || 0) + 1);
      const cityRecord = citySection && citySection.records ? citySection.records[cityRef] : null;
      const cityCoords = getCoords(cityRecord);
      if (cityCoords.x !== tileCoords.x || cityCoords.y !== tileCoords.y) {
        issues.push({
          kind: 'tile-city-coords',
          tileIndex,
          cityRef,
          tileX: tileCoords.x,
          tileY: tileCoords.y,
          cityX: cityCoords.x,
          cityY: cityCoords.y
        });
      }
    }
    const colonyRef = normalizeRef(rec && rec.colony);
    if (colonyRef >= clnyCount) {
      issues.push({
        kind: 'tile-colony-ref',
        tileIndex,
        colonyRef,
        colonyCount: clnyCount
      });
    } else if (colonyRef >= 0) {
      colonyRefCounts.set(colonyRef, (colonyRefCounts.get(colonyRef) || 0) + 1);
      const colonyRecord = clnySection && clnySection.records ? clnySection.records[colonyRef] : null;
      const colonyCoords = getCoords(colonyRecord);
      if (colonyCoords.x !== tileCoords.x || colonyCoords.y !== tileCoords.y) {
        issues.push({
          kind: 'tile-colony-coords',
          tileIndex,
          colonyRef,
          tileX: tileCoords.x,
          tileY: tileCoords.y,
          colonyX: colonyCoords.x,
          colonyY: colonyCoords.y
        });
      }
    }
  });
  if (citySection && Array.isArray(citySection.records)) {
    citySection.records.forEach((rec, cityIndex) => {
      validateOwnerRef('CITY', cityIndex, rec);
      const coords = getCoords(rec);
      const tile = tileByCoords.get(`${coords.x},${coords.y}`) || null;
      if (!isInBounds(coords)) {
        issues.push({
          kind: 'city-out-of-bounds',
          cityRef: cityIndex,
          cityX: coords.x,
          cityY: coords.y,
          mapWidth,
          mapHeight
        });
        return;
      }
      if (!tile) {
        issues.push({
          kind: 'city-missing-tile',
          cityRef: cityIndex,
          cityX: coords.x,
          cityY: coords.y
        });
        return;
      }
      if (normalizeRef(tile.city) !== cityIndex) {
        issues.push({
          kind: 'city-tile-backref',
          cityRef: cityIndex,
          cityX: coords.x,
          cityY: coords.y,
          tileCityRef: normalizeRef(tile.city)
        });
      }
      if ((cityRefCounts.get(cityIndex) || 0) !== 1) {
        issues.push({
          kind: 'city-ref-count',
          cityRef: cityIndex,
          count: cityRefCounts.get(cityIndex) || 0
        });
      }
    });
  }
  if (clnySection && Array.isArray(clnySection.records)) {
    clnySection.records.forEach((rec, colonyIndex) => {
      validateOwnerRef('CLNY', colonyIndex, rec);
      const coords = getCoords(rec);
      const tile = tileByCoords.get(`${coords.x},${coords.y}`) || null;
      if (!isInBounds(coords)) {
        issues.push({
          kind: 'colony-out-of-bounds',
          colonyRef: colonyIndex,
          colonyX: coords.x,
          colonyY: coords.y,
          mapWidth,
          mapHeight
        });
        return;
      }
      if (!tile) {
        issues.push({
          kind: 'colony-missing-tile',
          colonyRef: colonyIndex,
          colonyX: coords.x,
          colonyY: coords.y
        });
        return;
      }
      if (normalizeRef(tile.colony) !== colonyIndex) {
        issues.push({
          kind: 'colony-tile-backref',
          colonyRef: colonyIndex,
          colonyX: coords.x,
          colonyY: coords.y,
          tileColonyRef: normalizeRef(tile.colony)
        });
      }
      if ((colonyRefCounts.get(colonyIndex) || 0) !== 1) {
        issues.push({
          kind: 'colony-ref-count',
          colonyRef: colonyIndex,
          count: colonyRefCounts.get(colonyIndex) || 0
        });
      }
    });
  }
  if (slocSection && Array.isArray(slocSection.records)) {
    slocSection.records.forEach((rec, slocIndex) => {
      validateOwnerRef('SLOC', slocIndex, rec);
      const coords = getCoords(rec);
      if (!isInBounds(coords)) {
        issues.push({
          kind: 'sloc-out-of-bounds',
          slocRef: slocIndex,
          slocX: coords.x,
          slocY: coords.y,
          mapWidth,
          mapHeight
        });
        return;
      }
      const tile = tileByCoords.get(`${coords.x},${coords.y}`);
      if (!tile) {
        issues.push({
          kind: 'sloc-missing-tile',
          slocRef: slocIndex,
          slocX: coords.x,
          slocY: coords.y
        });
      }
    });
  }
  if (unitSection && Array.isArray(unitSection.records)) {
    unitSection.records.forEach((rec, unitIndex) => {
      validateOwnerRef('UNIT', unitIndex, rec);
      const coords = getCoords(rec);
      if (!isInBounds(coords)) {
        issues.push({
          kind: 'unit-out-of-bounds',
          unitRef: unitIndex,
          unitX: coords.x,
          unitY: coords.y,
          mapWidth,
          mapHeight
        });
        return;
      }
      if (!tileByCoords.has(`${coords.x},${coords.y}`)) {
        issues.push({
          kind: 'unit-missing-tile',
          unitRef: unitIndex,
          unitX: coords.x,
          unitY: coords.y,
          tileCount: tileSection.records.length,
          unitCount
        });
      }
    });
  }
  return issues;
}

function collectColonyOverlayCoherenceIssues(parsed) {
  const issues = [];
  const tileSection = getSectionByCode(parsed, 'TILE');
  const clnySection = getSectionByCode(parsed, 'CLNY');
  if (!tileSection || !Array.isArray(tileSection.records) || !clnySection || !Array.isArray(clnySection.records)) {
    return issues;
  }
  const normalizeRef = (value) => {
    const parsedValue = Number.parseInt(String(value), 10);
    return Number.isFinite(parsedValue) ? parsedValue : -1;
  };
  const getOverlayType = (tile) => {
    const overlays = Number(tile && tile.c3cOverlays) >>> 0;
    if ((overlays & 0x20000000) === 0x20000000) return 1;
    if ((overlays & 0x40000000) === 0x40000000) return 2;
    if ((overlays & 0x80000000) === 0x80000000) return 3;
    return 0;
  };
  tileSection.records.forEach((tile, tileIndex) => {
    const colonyRef = normalizeRef(tile && tile.colony);
    if (colonyRef < 0) return;
    const colony = clnySection.records[colonyRef];
    if (!colony) return;
    const overlayType = getOverlayType(tile);
    const improvementType = normalizeRef(colony && colony.improvementType);
    if (overlayType !== improvementType) {
      issues.push({
        kind: 'colony-overlay-type-mismatch',
        tileIndex,
        colonyRef,
        overlayType,
        improvementType
      });
    }
  });
  return issues;
}

function buildMapSectionRecordFromUi(sectionCode, record, io, recordIndex) {
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  const valueByKey = new Map();
  fields.forEach((field) => {
    const key = canonicalKey(field && (field.baseKey || field.key));
    if (!key) return;
    valueByKey.set(key, String(field && field.value != null ? field.value : ''));
  });
  const getInt = (key, fallback = 0) => {
    const raw = valueByKey.get(canonicalKey(key));
    if (raw == null) return fallback;
    const parsed = Number.parseInt(String(raw).match(/-?\d+/)?.[0] || '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const getString = (key, fallback = '') => {
    const raw = valueByKey.get(canonicalKey(key));
    return raw == null ? String(fallback) : String(raw);
  };
  if (sectionCode === 'WCHR') {
    return {
      name: 'World Parameters',
      selectedClimate: getInt('selectedclimate', 1),
      actualClimate: getInt('actualclimate', getInt('selectedclimate', 1)),
      selectedBarbarian: getInt('selectedbarbarianactivity', 1),
      actualBarbarian: getInt('actualbarbarianactivity', getInt('selectedbarbarianactivity', 1)),
      selectedLandform: getInt('selectedlandform', 1),
      actualLandform: getInt('actuallandform', getInt('selectedlandform', 1)),
      selectedOcean: getInt('selectedoceancoverage', 1),
      actualOcean: getInt('actualoceancoverage', getInt('selectedoceancoverage', 1)),
      selectedTemp: getInt('selectedtemperature', 1),
      actualTemp: getInt('actualtemperature', getInt('selectedtemperature', 1)),
      selectedAge: getInt('selectedage', 1),
      actualAge: getInt('actualage', getInt('selectedage', 1)),
      worldSize: getInt('worldsize', 2)
    };
  }
  if (sectionCode === 'WMAP') {
    return {
      name: 'World Map',
      numResources: 0,
      resourceOccurrences: [],
      numContinents: getInt('numcontinents', 1),
      height: getInt('height', 130),
      distanceBetweenCivs: getInt('distancebetweencivs', 20),
      numCivs: getInt('numcivs', 8),
      qm1: getInt('questionmark1', 0),
      qm2: getInt('questionmark2', 0),
      width: getInt('width', 130),
      qm3: getInt('questionmark3', -1),
      unknownBytes: Buffer.alloc(124),
      mapSeed: getInt('mapseed', 0),
      flags: getInt('flags', 0),
      _tail: Buffer.alloc(0)
    };
  }
  if (sectionCode === 'TILE') {
    const rawRecord = Buffer.alloc(getTileRecordLength(io.versionTag, io.majorVersion));
    rawRecord.writeUInt32LE(Math.max(0, rawRecord.length - 4), 0);
    for (const fd of TILE_FIELDS) {
      const bodyOff = 4 + fd.off;
      const value = getInt(fd.name, 0);
      switch (fd.type) {
        case 'uint8': rawRecord[bodyOff] = value & 0xff; break;
        case 'uint16': rawRecord.writeUInt16LE(value & 0xffff, bodyOff); break;
        case 'int16': rawRecord.writeInt16LE(value | 0, bodyOff); break;
        case 'int32': rawRecord.writeInt32LE(value | 0, bodyOff); break;
        default: rawRecord[bodyOff] = value & 0xff;
      }
    }
    return { index: recordIndex, ...parseTILE(rawRecord, recordIndex, io), _rawRecord: rawRecord };
  }
  if (sectionCode === 'CONT') {
    return {
      continentClass: getInt('continentclass', 0),
      numTiles: getInt('numtiles', 0)
    };
  }
  if (sectionCode === 'SLOC') {
    return {
      ownerType: getInt('ownertype', 0),
      owner: getInt('owner', -1),
      x: getInt('x', 0),
      y: getInt('y', 0)
    };
  }
  if (sectionCode === 'CLNY') {
    return {
      ownerType: getInt('ownertype', 0),
      owner: getInt('owner', -1),
      x: getInt('x', 0),
      y: getInt('y', 0),
      improvementType: getInt('improvementtype', 0)
    };
  }
  if (sectionCode === 'CITY') {
    const buildingFields = fields
      .filter((field) => /^building(?:_\d+)?$/i.test(String(field && (field.baseKey || field.key) || '')))
      .map((field) => Number.parseInt(String(field && field.value || '').match(/-?\d+/)?.[0] || '', 10))
      .filter((n) => Number.isFinite(n) && n >= 0);
    const buildingsRaw = getString('buildings', '');
    const buildings = buildingsRaw
      ? buildingsRaw.split(/[,\s]+/).map((part) => Number.parseInt(part, 10)).filter((n) => Number.isFinite(n) && n >= 0)
      : buildingFields;
    return {
      hasWalls: getInt('haswalls', 0),
      hasPalace: getInt('haspalace', 0),
      name: getString('name', ''),
      ownerType: getInt('ownertype', 0),
      numBuildings: buildings.length,
      buildings,
      culture: getInt('culture', 0),
      owner: getInt('owner', -1),
      size: getInt('size', 1),
      x: getInt('x', 0),
      y: getInt('y', 0),
      cityLevel: getInt('citylevel', 0),
      borderLevel: getInt('borderlevel', 0),
      useAutoName: getInt('useautoname', 0)
    };
  }
  if (sectionCode === 'UNIT') {
    return {
      name: getString('name', ''),
      ownerType: getInt('ownertype', 0),
      experienceLevel: getInt('experiencelevel', 0),
      owner: getInt('owner', -1),
      pRTONumber: getInt('prtonumber', getInt('unit', 0)),
      AIStrategy: getInt('aistrategy', 0),
      x: getInt('x', 0),
      y: getInt('y', 0),
      customName: getString('customname', ''),
      useCivilizationKing: getInt('usecivilizationking', 0)
    };
  }
  return { _rawData: Buffer.alloc(0) };
}

function buildMapSectionFromUi(section, io) {
  const code = String(section && section.code || '').trim().toUpperCase();
  const records = Array.isArray(section && section.records) ? section.records : [];
  const nextSection = {
    code,
    count: records.length,
    records: records.map((record, index) => {
      const built = buildMapSectionRecordFromUi(code, record, io, index);
      if (built && !Number.isFinite(built.index)) built.index = index;
      return built;
    }),
    _modified: true
  };
  if (code === 'WMAP' && nextSection.records[0] && Number.isFinite(nextSection.records[0].width)) {
    io.mapWidth = nextSection.records[0].width;
  }
  return nextSection;
}

function removeMapSectionsFromParsed(parsed) {
  parsed.sections = parsed.sections.filter((section) => !['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY'].includes(String(section && section.code || '').toUpperCase()));
}

function removeCustomRulesSectionsFromParsed(parsed) {
  const codes = new Set(['BLDG', 'CTZN', 'CULT', 'DIFF', 'ERAS', 'ESPN', 'EXPR', 'FLAV', 'GOOD', 'GOVT', 'PRTO', 'RACE', 'RULE', 'TECH', 'TERR', 'TFRM', 'WSIZ']);
  parsed.sections = parsed.sections.filter((section) => !codes.has(String(section && section.code || '').toUpperCase()));
}

function removeCustomPlayerDataSectionsFromParsed(parsed) {
  parsed.sections = parsed.sections.filter((section) => String(section && section.code || '').toUpperCase() !== 'LEAD');
}

function addCustomPlayerDataSectionToParsed(parsed) {
  removeCustomPlayerDataSectionsFromParsed(parsed);
  const leadSection = {
    code: 'LEAD',
    mode: 'len',
    records: [],
    _modified: true
  };
  const insertAt = parsed.sections.findIndex((section) => String(section && section.code || '').toUpperCase() === 'GAME');
  if (insertAt >= 0) parsed.sections.splice(insertAt + 1, 0, leadSection);
  else parsed.sections.push(leadSection);
}

function setMapSectionsOnParsed(parsed, uiSections) {
  removeMapSectionsFromParsed(parsed);
  const mapSections = Array.isArray(uiSections) ? uiSections : [];
  const builtSections = [];
  mapSections.forEach((section) => {
    const code = String(section && section.code || '').trim().toUpperCase();
    if (!['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY'].includes(code)) return;
    builtSections.push(buildMapSectionFromUi(section, parsed.io));
  });
  const insertAt = parsed.sections.findIndex((section) => {
    const code = String(section && section.code || '').toUpperCase();
    return code === 'GAME' || code === 'LEAD';
  });
  if (insertAt >= 0) parsed.sections.splice(insertAt, 0, ...builtSections);
  else parsed.sections.push(...builtSections);
}

function normalizeResizeMapDimension(value, label) {
  const parsed = Number.parseInt(String(value == null ? '' : value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Map ${label} must be a positive integer.`);
  }
  if (String(label || '').trim().toLowerCase() === 'width' && (parsed % 2) !== 0) {
    return parsed + 1;
  }
  return parsed;
}

const BIQ_TERRAIN = {
  DESERT: 0,
  PLAINS: 1,
  GRASSLAND: 2,
  TUNDRA: 3,
  COAST: 11,
  SEA: 12,
  OCEAN: 13
};
const RESIZE_FILL_TERRAIN_VALUES = new Set([
  BIQ_TERRAIN.DESERT,
  BIQ_TERRAIN.PLAINS,
  BIQ_TERRAIN.GRASSLAND,
  BIQ_TERRAIN.TUNDRA,
  BIQ_TERRAIN.COAST,
  BIQ_TERRAIN.SEA,
  BIQ_TERRAIN.OCEAN
]);

function normalizeResizeFillTerrain(value, fallback = BIQ_TERRAIN.SEA) {
  const parsed = Number.parseInt(String(value == null ? '' : value), 10);
  if (RESIZE_FILL_TERRAIN_VALUES.has(parsed)) return parsed;
  return fallback;
}

function normalizeResizeHorizontalAnchor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'east' || normalized === 'west' || normalized === 'both' ? normalized : 'both';
}

function normalizeResizeVerticalAnchor(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'north' || normalized === 'south' || normalized === 'both' ? normalized : 'both';
}

function buildResizedTileTemplateCoord(xPos, yPos, width, height) {
  const maxX = Math.max(0, Number(width) - 1);
  const maxY = Math.max(0, Number(height) - 1);
  let y = Math.max(0, Math.min(maxY, Number(yPos) || 0));
  let x = Math.max(0, Math.min(maxX, Number(xPos) || 0));
  const desiredParity = y & 1;
  if ((x & 1) !== desiredParity) {
    if ((x + 1) <= maxX) x += 1;
    else if ((x - 1) >= 0) x -= 1;
  }
  return { x, y };
}

function computeResizeOffsets(sourceWidth, sourceHeight, targetWidth, targetHeight, horizontalAnchor = 'both', verticalAnchor = 'both') {
  const widthDiff = Number(targetWidth) - Number(sourceWidth);
  const heightDiff = Number(targetHeight) - Number(sourceHeight);
  const horizontal = normalizeResizeHorizontalAnchor(horizontalAnchor);
  const vertical = normalizeResizeVerticalAnchor(verticalAnchor);
  const getParity = (value) => ((Math.abs(Number(value) || 0) % 2) + 2) % 2;
  const buildAxisCandidates = (diff, anchor, lowSide, highSide) => {
    const min = Math.min(0, Number(diff));
    const max = Math.max(0, Number(diff));
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    const ideal = Number(diff) / 2;
    const preferred = anchor === lowSide ? Number(diff) : anchor === highSide ? 0 : ideal;
    const weight = anchor === 'both' ? 1 : 1000;
    const out = [];
    for (let value = min; value <= max; value += 1) {
      out.push({
        value,
        parity: getParity(value),
        cost: Math.abs(value - preferred) * weight,
        centerCost: Math.abs(value - ideal),
        anchorCost: Math.abs(value - preferred)
      });
    }
    return out;
  };
  const xCandidates = buildAxisCandidates(widthDiff, horizontal, 'west', 'east');
  const yCandidates = buildAxisCandidates(heightDiff, vertical, 'north', 'south');
  const candidates = [];
  xCandidates.forEach((xCandidate) => {
    yCandidates.forEach((yCandidate) => {
      if (xCandidate.parity !== yCandidate.parity) return;
      candidates.push({
        parity: xCandidate.parity,
        x: xCandidate.value,
        y: yCandidate.value,
        cost: xCandidate.cost + yCandidate.cost,
        anchorCost: xCandidate.anchorCost + yCandidate.anchorCost,
        centerCost: xCandidate.centerCost + yCandidate.centerCost
      });
    });
  });
  if (candidates.length <= 0) {
    return {
      x: Math.round(widthDiff / 2),
      y: Math.round(heightDiff / 2)
    };
  }
  candidates.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.anchorCost !== b.anchorCost) return a.anchorCost - b.anchorCost;
    if (a.centerCost !== b.centerCost) return a.centerCost - b.centerCost;
    return a.parity - b.parity;
  });
  return { x: candidates[0].x, y: candidates[0].y };
}

function clearResizedTileBackrefs(tile) {
  setTileRecordFieldValue(tile, 'city', -1);
  setTileRecordFieldValue(tile, 'colony', -1);
}

function getResizedTileFillTerrainCode(sourceX, sourceY, sourceWidth, sourceHeight, template, fallbackTerrain, allowTemplateTerrain = false) {
  const yInBounds = Number.isFinite(sourceY) && sourceY >= 0 && sourceY < sourceHeight;
  const xInBounds = Number.isFinite(sourceX) && sourceX >= 0 && sourceX < sourceWidth;
  if (allowTemplateTerrain && !xInBounds && yInBounds && template) {
    return getTileBaseTerrain(template);
  }
  return fallbackTerrain;
}

function resetNewResizedTileToTerrain(tile, terrainId = BIQ_TERRAIN.SEA) {
  if (!tile) return;
  const terrainCode = normalizeResizeFillTerrain(terrainId, BIQ_TERRAIN.SEA);
  const packedTerrain = ((terrainCode & 0x0f) << 4) | (terrainCode & 0x0f);
  setTileRecordFieldValue(tile, 'riverConnectionInfo', 0);
  setTileRecordFieldValue(tile, 'border', 0);
  setTileRecordFieldValue(tile, 'resource', -1);
  setTileRecordFieldValue(tile, 'image', 0);
  setTileRecordFieldValue(tile, 'file', terrainCode === BIQ_TERRAIN.PLAINS ? 1
    : terrainCode === BIQ_TERRAIN.DESERT ? 2
      : terrainCode === BIQ_TERRAIN.GRASSLAND ? 5
        : terrainCode === BIQ_TERRAIN.COAST ? 6
          : terrainCode === BIQ_TERRAIN.SEA ? 7
            : terrainCode === BIQ_TERRAIN.OCEAN ? 8
              : 0);
  setTileRecordFieldValue(tile, 'overlays', 0);
  setTileRecordFieldValue(tile, 'baseRealTerrain', packedTerrain);
  setTileRecordFieldValue(tile, 'bonuses', 0);
  setTileRecordFieldValue(tile, 'riverCrossingData', 0);
  setTileRecordFieldValue(tile, 'barbarianTribe', -1);
  setTileRecordFieldValue(tile, 'city', -1);
  setTileRecordFieldValue(tile, 'colony', -1);
  setTileRecordFieldValue(tile, 'continent', 0);
  setTileRecordFieldValue(tile, 'victoryPointLocation', -1);
  setTileRecordFieldValue(tile, 'ruin', 0);
  setTileRecordFieldValue(tile, 'c3cOverlays', 0);
  setTileRecordFieldValue(tile, 'c3cBaseRealTerrain', packedTerrain);
  setTileRecordFieldValue(tile, 'fogOfWar', 0);
  setTileRecordFieldValue(tile, 'c3cBonuses', 0);
}

function getTileBaseTerrain(tile) {
  if (!tile) return BIQ_TERRAIN.COAST;
  const packed = Number.parseInt(String(
    tile.c3cBaseRealTerrain != null ? tile.c3cBaseRealTerrain : tile.baseRealTerrain
  ), 10);
  if (!Number.isFinite(packed)) return BIQ_TERRAIN.COAST;
  return packed & 0x0f;
}

function computeBiqTerrainSpriteImageIdx(southBase, westBase, northBase, eastBase, spec) {
  if (!spec) return -1;
  if (!spec.needImage) return spec.image;
  let sum = 0;
  if (northBase === spec.terr2) sum += 1;
  if (northBase === spec.terr3) sum += 2;
  if (westBase === spec.terr2) sum += 3;
  if (westBase === spec.terr3) sum += 6;
  if (eastBase === spec.terr2) sum += 9;
  if (eastBase === spec.terr3) sum += 18;
  if (southBase === spec.terr2) sum += 27;
  if (southBase === spec.terr3) sum += 54;
  return sum;
}

function computeBiqStoredTerrainSpriteSpec(southBase, westBase, northBase, eastBase) {
  const s = Number(southBase);
  const w = Number(westBase);
  const n = Number(northBase);
  const e = Number(eastBase);
  if (s === BIQ_TERRAIN.OCEAN && w === BIQ_TERRAIN.OCEAN && n === BIQ_TERRAIN.OCEAN && e === BIQ_TERRAIN.OCEAN) {
    return { file: 8, image: 0, needImage: false, terr2: 0, terr3: 0 };
  }
  if (s === BIQ_TERRAIN.SEA && w === BIQ_TERRAIN.SEA && n === BIQ_TERRAIN.SEA && e === BIQ_TERRAIN.SEA) {
    return { file: 7, image: 0, needImage: false, terr2: 0, terr3: 0 };
  }
  if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.TUNDRA)) {
    return { file: 0, needImage: true, terr2: BIQ_TERRAIN.GRASSLAND, terr3: BIQ_TERRAIN.COAST };
  }
  if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.SEA)) {
    return { file: 6, needImage: true, terr2: BIQ_TERRAIN.SEA, terr3: BIQ_TERRAIN.OCEAN };
  }
  if ([s, w, n, e].every((t) => t !== BIQ_TERRAIN.COAST)) {
    return { file: 4, needImage: true, terr2: BIQ_TERRAIN.GRASSLAND, terr3: BIQ_TERRAIN.PLAINS };
  }
  if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.DESERT)) {
    if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.PLAINS)) {
      return { file: 3, needImage: true, terr2: BIQ_TERRAIN.PLAINS, terr3: BIQ_TERRAIN.COAST };
    }
    if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.GRASSLAND)) {
      return { file: 2, needImage: true, terr2: BIQ_TERRAIN.GRASSLAND, terr3: BIQ_TERRAIN.COAST };
    }
    if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.COAST)) {
      return { file: 2, needImage: true, terr2: BIQ_TERRAIN.PLAINS, terr3: BIQ_TERRAIN.COAST };
    }
    return null;
  }
  if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.PLAINS)) {
    return { file: 1, needImage: true, terr2: BIQ_TERRAIN.GRASSLAND, terr3: BIQ_TERRAIN.COAST };
  }
  if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.GRASSLAND)) {
    return { file: 5, needImage: true, terr2: BIQ_TERRAIN.GRASSLAND, terr3: BIQ_TERRAIN.COAST };
  }
  if ([s, w, n, e].some((t) => t === BIQ_TERRAIN.COAST)) {
    return { file: 6, needImage: true, terr2: BIQ_TERRAIN.SEA, terr3: BIQ_TERRAIN.OCEAN };
  }
  return null;
}

function recomputeResizedTileTerrainFileImage(tileRecords, width, height) {
  if (!Array.isArray(tileRecords) || !tileRecords.length) return;
  const tileByCoord = new Map();
  tileRecords.forEach((record) => {
    const x = Number.parseInt(String(record && record.xpos), 10);
    const y = Number.parseInt(String(record && record.ypos), 10);
    if (!isMapResizeCoordInBounds(x, y, width, height)) return;
    tileByCoord.set(`${x},${y}`, record);
  });
  const getTerrainBaseForCoord = (xPos, yPos) => {
    let x = Number(xPos);
    const y = Number(yPos);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return BIQ_TERRAIN.COAST;
    if (y < 0 || y >= height) return BIQ_TERRAIN.COAST;
    x = ((x % width) + width) % width;
    return getTileBaseTerrain(tileByCoord.get(`${x},${y}`) || null);
  };
  tileRecords.forEach((record) => {
    const x = Number.parseInt(String(record && record.xpos), 10);
    const y = Number.parseInt(String(record && record.ypos), 10);
    if (!isMapResizeCoordInBounds(x, y, width, height)) return;
    const southBase = getTerrainBaseForCoord(x, y);
    const westBase = getTerrainBaseForCoord(x - 1, y - 1);
    const northBase = getTerrainBaseForCoord(x, y - 2);
    const eastBase = getTerrainBaseForCoord(x + 1, y - 1);
    const spec = computeBiqStoredTerrainSpriteSpec(southBase, westBase, northBase, eastBase);
    if (!spec) return;
    setTileRecordFieldValue(record, 'file', spec.file);
    setTileRecordFieldValue(record, 'image', computeBiqTerrainSpriteImageIdx(southBase, westBase, northBase, eastBase, spec));
  });
}

function recalculateContinentTileCounts(tileSection, contSection) {
  if (!tileSection || !Array.isArray(tileSection.records) || !contSection || !Array.isArray(contSection.records)) return;
  const counts = new Array(contSection.records.length).fill(0);
  tileSection.records.forEach((tile) => {
    const idx = Number.parseInt(String(tile && tile.continent), 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= counts.length) return;
    counts[idx] += 1;
  });
  let changed = false;
  contSection.records.forEach((record, index) => {
    const next = counts[index] || 0;
    if (Number(record && record.numTiles) === next) return;
    if (record && typeof record === 'object') record.numTiles = next;
    changed = true;
  });
  if (changed) contSection._modified = true;
}

function isMapResizeCoordInBounds(x, y, width, height) {
  return Number.isFinite(x)
    && Number.isFinite(y)
    && x >= 0
    && y >= 0
    && x < width
    && y < height;
}

function sanitizeResizedMapEntitySections(parsed, width, height, offsets = {}) {
  const tileSection = getSectionByCode(parsed, 'TILE');
  if (!tileSection || !Array.isArray(tileSection.records)) return;
  const offsetX = Number.isFinite(offsets.x) ? Number(offsets.x) : 0;
  const offsetY = Number.isFinite(offsets.y) ? Number(offsets.y) : 0;
  const sectionSpecs = [
    { code: 'CITY', xKey: 'x', yKey: 'y' },
    { code: 'UNIT', xKey: 'x', yKey: 'y' },
    { code: 'SLOC', xKey: 'x', yKey: 'y' },
    { code: 'CLNY', xKey: 'x', yKey: 'y' }
  ];
  sectionSpecs.forEach((spec) => {
    const section = getSectionByCode(parsed, spec.code);
    if (!section || !Array.isArray(section.records)) return;
    let changed = false;
    const nextRecords = section.records.filter((record) => {
      const x = Number.parseInt(String(record && record[spec.xKey]), 10);
      const y = Number.parseInt(String(record && record[spec.yKey]), 10);
      const shiftedX = x + offsetX;
      const shiftedY = y + offsetY;
      if (!Number.isFinite(shiftedX) || !Number.isFinite(shiftedY)) {
        changed = true;
        return false;
      }
      if (record && typeof record === 'object') {
        if (record[spec.xKey] !== shiftedX) changed = true;
        if (record[spec.yKey] !== shiftedY) changed = true;
        record[spec.xKey] = shiftedX;
        record[spec.yKey] = shiftedY;
      }
      if (!isMapResizeCoordInBounds(shiftedX, shiftedY, width, height)) {
        changed = true;
        return false;
      }
      return true;
    });
    if (!changed && nextRecords.length === section.records.length) return;
    section.records = nextRecords;
    section.records.forEach((record, index) => {
      if (record && typeof record === 'object') record.index = index;
    });
    section.count = section.records.length;
    section._modified = true;
  });

  const tileByCoord = new Map();
  tileSection.records.forEach((record) => {
    const x = Number.parseInt(String(record && record.xpos), 10);
    const y = Number.parseInt(String(record && record.ypos), 10);
    if (!isMapResizeCoordInBounds(x, y, width, height)) return;
    tileByCoord.set(`${x},${y}`, record);
    setTileRecordFieldValue(record, 'city', -1);
    setTileRecordFieldValue(record, 'colony', -1);
  });

  const citySection = getSectionByCode(parsed, 'CITY');
  if (citySection && Array.isArray(citySection.records)) {
    citySection.records.forEach((record, index) => {
      const tile = tileByCoord.get(`${record.x},${record.y}`) || null;
      if (!tile) return;
      setTileRecordFieldValue(tile, 'city', index);
    });
  }

  const clnySection = getSectionByCode(parsed, 'CLNY');
  if (clnySection && Array.isArray(clnySection.records)) {
    clnySection.records.forEach((record, index) => {
      const tile = tileByCoord.get(`${record.x},${record.y}`) || null;
      if (!tile) return;
      setTileRecordFieldValue(tile, 'colony', index);
    });
  }

  tileSection._modified = true;
}

function resizeMapSectionsOnParsed(parsed, targetWidth, targetHeight, fillTerrain, horizontalAnchor = 'both', verticalAnchor = 'both') {
  const width = normalizeResizeMapDimension(targetWidth, 'width');
  const height = normalizeResizeMapDimension(targetHeight, 'height');
  const fillTerrainCode = normalizeResizeFillTerrain(fillTerrain, BIQ_TERRAIN.SEA);
  const normalizedHorizontalAnchor = normalizeResizeHorizontalAnchor(horizontalAnchor);
  const normalizedVerticalAnchor = normalizeResizeVerticalAnchor(verticalAnchor);
  const allowImplicitEdgeTerrain = fillTerrain == null || String(fillTerrain).trim() === '';
  const tileCount = Math.floor((width * height) / 2);
  if (tileCount > 65536) {
    throw new Error(`Map dimensions ${width}x${height} exceed the Civ 3 custom-map limit of 65,536 tiles.`);
  }
  const wmapSection = getSectionByCode(parsed, 'WMAP');
  const tileSection = getSectionByCode(parsed, 'TILE');
  if (!wmapSection || !Array.isArray(wmapSection.records) || !wmapSection.records[0] || !tileSection || !Array.isArray(tileSection.records)) {
    throw new Error('Cannot resize a BIQ map that is missing WMAP or TILE data.');
  }
  const sourceWidth = Number(parsed && parsed.io && parsed.io.mapWidth)
    || Number(wmapSection.records[0] && wmapSection.records[0].width)
    || 0;
  const sourceHeight = Number(wmapSection.records[0] && wmapSection.records[0].height) || 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Cannot resize a BIQ map with invalid source dimensions.');
  }
  if (sourceWidth === width && sourceHeight === height) return;
  const resizeOffsets = computeResizeOffsets(
    sourceWidth,
    sourceHeight,
    width,
    height,
    normalizedHorizontalAnchor,
    normalizedVerticalAnchor
  );

  const sourceTileByCoord = new Map();
  const firstTile = tileSection.records[0] || null;
  tileSection.records.forEach((record) => {
    const x = Number.parseInt(String(record && record.xpos), 10);
    const y = Number.parseInt(String(record && record.ypos), 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    sourceTileByCoord.set(`${x},${y}`, record);
  });

  const nextTileRecords = [];
  let nextIndex = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = (y & 1); x < width; x += 2) {
      const sourceX = x - resizeOffsets.x;
      const sourceY = y - resizeOffsets.y;
      const existing = sourceTileByCoord.get(`${sourceX},${sourceY}`) || null;
      const templateCoord = existing
        ? null
        : buildResizedTileTemplateCoord(sourceX, sourceY, sourceWidth, sourceHeight);
      const template = existing
        || sourceTileByCoord.get(`${templateCoord.x},${templateCoord.y}`)
        || firstTile;
      if (!template) {
        throw new Error('Cannot resize a BIQ map without any source TILE records.');
      }
      const nextRecord = copyRecord(template);
      nextRecord.index = nextIndex;
      nextRecord.xpos = x;
      nextRecord.ypos = y;
      if (!existing) {
        const terrainCode = getResizedTileFillTerrainCode(
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          template,
          fillTerrainCode,
          allowImplicitEdgeTerrain
        );
        resetNewResizedTileToTerrain(nextRecord, terrainCode);
        clearResizedTileBackrefs(nextRecord);
      }
      nextTileRecords.push(nextRecord);
      nextIndex += 1;
    }
  }

  tileSection.records = nextTileRecords;
  tileSection.count = nextTileRecords.length;
  tileSection._modified = true;

  wmapSection.records[0].width = width;
  wmapSection.records[0].height = height;
  wmapSection._modified = true;
  parsed.io.mapWidth = width;

  recomputeResizedTileTerrainFileImage(nextTileRecords, width, height);
  sanitizeResizedMapEntitySections(parsed, width, height, resizeOffsets);

  const contSection = getSectionByCode(parsed, 'CONT');
  recalculateContinentTileCounts(tileSection, contSection);
}

function setCustomRulesSectionsOnParsed(parsed, uiSections) {
  removeCustomRulesSectionsFromParsed(parsed);
  const ruleSectionCodes = new Set(['BLDG', 'CTZN', 'CULT', 'DIFF', 'ERAS', 'ESPN', 'EXPR', 'FLAV', 'GOOD', 'GOVT', 'PRTO', 'RACE', 'RULE', 'TECH', 'TERR', 'TFRM', 'WSIZ']);
  const builtSections = [];
  (Array.isArray(uiSections) ? uiSections : []).forEach((section) => {
    const code = String(section && section.code || '').trim().toUpperCase();
    if (!ruleSectionCodes.has(code)) return;
    builtSections.push(JSON.parse(JSON.stringify(section)));
  });
  const insertAt = parsed.sections.findIndex((section) => {
    const code = String(section && section.code || '').toUpperCase();
    return code === 'WCHR' || code === 'WMAP' || code === 'GAME' || code === 'LEAD';
  });
  if (insertAt >= 0) parsed.sections.splice(insertAt, 0, ...builtSections);
  else parsed.sections.push(...builtSections);
}

// ---------------------------------------------------------------------------
// applyEdits: apply SET/ADD/COPY/DELETE edits to a buffer, return new buffer
// ---------------------------------------------------------------------------

function applyEdits(buf, edits, options = {}) {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: true, buffer: buf, applied: 0, skipped: 0, warning: '' };
  }

  log.debug('BiqApplyEdits', `applyEdits: ${edits.length} edit(s) — buf size ${buf ? buf.length : 0}`);

  const parsed = parseAllSections(buf, options);
  if (!parsed.ok) {
    log.error('BiqApplyEdits', `parseAllSections failed: ${parsed.error || 'unknown'}`);
    return { ok: false, error: parsed.error || 'Failed to parse BIQ' };
  }

  const { io } = parsed;
  const originalRefsBySection = {};
  ['RACE', 'TECH', 'GOOD', 'BLDG', 'GOVT', 'PRTO', 'CITY', 'CLNY'].forEach((code) => {
    const section = getSectionByCode(parsed, code);
    originalRefsBySection[code] = section && Array.isArray(section.records)
      ? section.records.map((record) => getRecordStructureRef(record))
      : [];
  });
  const originalRaceSection = getSectionByCode(parsed, 'RACE');
  const originalRaceRefs = originalRaceSection && Array.isArray(originalRaceSection.records)
    ? originalRaceSection.records.map((record) => getRecordCivilopediaRef(record))
    : [];
  let sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));

  let applied = 0;
  let skipped = 0;
  const warnings = [];

  for (const edit of edits) {
    const op = String(edit.op || 'set').toLowerCase();
    if (op === 'removemap') {
      log.debug('BiqApplyEdits', 'op=removemap: removing all map sections');
      removeMapSectionsFromParsed(parsed);
      sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));
      applied++;
      continue;
    }
    if (op === 'setmap') {
      if (!options.allowSetmapGeneration || !edit.allowSetmapGeneration) {
        log.error('BiqApplyEdits', 'op=setmap rejected: whole-map replacement is only allowed for explicit map generation, custom-map creation, or map import saves');
        return { ok: false, error: 'Whole-map BIQ replacement is blocked for normal saves. Only explicit map generation, custom-map creation, or map import writes may replace all map sections.' };
      }
      const mapSecCodes = Array.isArray(edit.sections) ? edit.sections.map((s) => s && s.code).filter(Boolean).join(',') : '(none)';
      log.debug('BiqApplyEdits', `op=setmap: replacing map sections [${mapSecCodes}]`);
      setMapSectionsOnParsed(parsed, edit.sections);
      sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));
      applied++;
      continue;
    }
    if (op === 'resizemap') {
      try {
        resizeMapSectionsOnParsed(parsed, edit.width, edit.height, edit.fillTerrain, edit.horizontalAnchor, edit.verticalAnchor);
      } catch (err) {
        const errorText = err && err.message ? err.message : 'Failed to resize BIQ map.';
        log.error('BiqApplyEdits', `op=resizemap rejected: ${errorText}`);
        return { ok: false, error: errorText };
      }
      sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));
      applied++;
      continue;
    }
    if (op === 'removecustomrules') {
      log.debug('BiqApplyEdits', 'op=removecustomrules: removing custom-rules sections');
      removeCustomRulesSectionsFromParsed(parsed);
      sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));
      applied++;
      continue;
    }
    if (op === 'removecustomplayerdata') {
      log.debug('BiqApplyEdits', 'op=removecustomplayerdata: removing LEAD section');
      removeCustomPlayerDataSectionsFromParsed(parsed);
      sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));
      applied++;
      continue;
    }
    if (op === 'setcustomrules') {
      const sectionCodes = Array.isArray(edit.sections) ? edit.sections.map((s) => s && s.code).filter(Boolean).join(',') : '(none)';
      log.debug('BiqApplyEdits', `op=setcustomrules: replacing custom-rules sections [${sectionCodes}]`);
      setCustomRulesSectionsOnParsed(parsed, edit.sections);
      sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));
      applied++;
      continue;
    }
    if (op === 'addcustomplayerdata') {
      log.debug('BiqApplyEdits', 'op=addcustomplayerdata: inserting empty LEAD section');
      addCustomPlayerDataSectionToParsed(parsed);
      sectionByCode = new Map(parsed.sections.map((s) => [s.code, s]));
      applied++;
      continue;
    }
    const code = String(edit.sectionCode || '').toUpperCase();
    if (op === 'set' && code === 'GAME' && applyBiqHeaderTextEdit(parsed, edit.fieldKey, edit.value)) {
      applied++;
      const headerField = canonicalKey(edit.fieldKey) === 'title' ? 'title' : 'description';
      log.debug('BiqApplyEdits', `op=set header.${headerField}`);
      continue;
    }
    const section = sectionByCode.get(code);

    if (op === 'add' || op === 'copy') {
      const newRef = String(edit.newRecordRef || '').trim();
      const newRefLookup = newRef.toUpperCase();
      const sourceRef = String(edit.sourceRef || edit.copyFromRef || '').trim().toUpperCase();
      const externalRecord = edit && typeof edit.externalRecord === 'object' ? edit.externalRecord : null;
      if (!newRef) {
        skipped++;
        warnings.push(`${op}: missing newRecordRef for ${code}`);
        log.warn('BiqApplyEdits', `op=${op} SKIPPED: missing newRecordRef in section ${code}`);
        continue;
      }
      if (!section) {
        skipped++;
        warnings.push(`${op}: section ${code} not found`);
        log.warn('BiqApplyEdits', `op=${op} SKIPPED: section ${code} not found`);
        continue;
      }

      // Check for duplicate
      const existing = section.records.find((r) =>
        String(r.civilopediaEntry || '').trim().toUpperCase() === newRefLookup ||
        String(r.newRecordRef || '').trim().toUpperCase() === newRefLookup
      );
      if (existing) {
        skipped++;
        warnings.push(`${op}: record ${newRef} already exists in ${code}`);
        log.warn('BiqApplyEdits', `op=${op} SKIPPED: record ${newRef} already exists in ${code}`);
        continue;
      }

      let newRec;
      if (op === 'copy' && sourceRef) {
        const src = findRecordByRef(section.records, sourceRef);
        if (src) {
          newRec = copyRecord(src);
          newRec.civilopediaEntry = newRef;
          if (newRec._rawData) delete newRec._rawData;
          if (newRec._rawRecord) delete newRec._rawRecord; // force re-serialize
          log.debug('BiqApplyEdits', `op=copy ${code}: ${sourceRef} -> ${newRef} (from local BIQ)`);
        } else if (externalRecord) {
          newRec = copyRecord(externalRecord);
          newRec.civilopediaEntry = newRef;
          if (newRec._rawData) delete newRec._rawData;
          if (newRec._rawRecord) delete newRec._rawRecord; // force re-serialize
          log.debug('BiqApplyEdits', `op=copy ${code}: external record -> ${newRef}`);
        } else {
          warnings.push(`copy: source ${sourceRef} not found in ${code}, creating blank`);
          log.warn('BiqApplyEdits', `op=copy ${code}: source ${sourceRef} not found, creating blank record ${newRef}`);
          newRec = createDefaultRecord(code, newRef, io);
        }
      } else {
        log.debug('BiqApplyEdits', `op=add ${code}: creating new record ${newRef}`);
        newRec = createDefaultRecord(code, newRef, io);
      }
      newRec.newRecordRef = newRef;
      newRec.index = section.records.length;
      section.records.push(newRec);
      section._modified = true;
      applied++;
      continue;
    }

    if (op === 'delete') {
      const ref = String(edit.recordRef || '').trim().toUpperCase();
      if (!section) { skipped++; continue; }
      const idx = section.records.findIndex((r) => {
        if (ref.startsWith('@INDEX:')) {
          const n = Number.parseInt(ref.slice(7), 10);
          return Number.isFinite(n) && r.index === n;
        }
        const ce = String(r && r.civilopediaEntry || '').trim().toUpperCase();
        if (ce === ref) return true;
        const newRef = String(r && r.newRecordRef || '').trim().toUpperCase();
        return newRef === ref;
      });
      if (idx < 0) {
        skipped++;
        warnings.push(`delete: ${ref} not found in ${code}`);
        log.warn('BiqApplyEdits', `op=delete SKIPPED: ${ref} not found in ${code}`);
        continue;
      }
      log.debug('BiqApplyEdits', `op=delete ${code}: removed record ${ref} (was at index ${idx})`);
      section.records.splice(idx, 1);
      // Re-number indices
      section.records.forEach((r, i) => { r.index = i; });
      section._modified = true;
      applied++;
      continue;
    }

    // SET
    if (!section) { skipped++; continue; }
    const rec = findRecordByRef(section.records, edit.recordRef);
    if (!rec) {
      skipped++;
      warnings.push(`set: record ${edit.recordRef} not found in ${code}`);
      log.warn('BiqApplyEdits', `op=set SKIPPED: record ${edit.recordRef} not found in ${code}`);
      continue;
    }

    const fieldKey = String(edit.fieldKey || '').trim();
    // Decode value
    let value = String(edit.value != null ? edit.value : '');
    // Note: edit.value is already the decoded string (configCore.js decodes base64 before creating the edit object)
    // But in the Java path, values are base64-encoded in the TSV and decoded by Java.
    // In our JS path, configCore.js calls applyBiqEdits directly with plain strings.

    const ok = applySetToRecord(rec, fieldKey, value, code, io);
    if (ok) {
      if (code === 'PRTO' && canonicalKey(fieldKey) === 'aistrategy') {
        const primaryIndex = Number(rec && rec.index);
        const isPrimary = !Number.isFinite(Number(rec && rec.otherStrategy)) || Number(rec && rec.otherStrategy) < 0;
        if (isPrimary && dropPrtoStrategyMapDuplicates(section.records, primaryIndex, rec)) {
          log.debug('BiqApplyEdits', `op=set ${code}[${edit.recordRef}].${fieldKey}: dropped stale strategy-map duplicate records for primary index ${primaryIndex}`);
        }
      }
      section._modified = true;
      applied++;
      const displayVal = value.length > 40 ? value.slice(0, 40) + '…' : value;
      log.debug('BiqApplyEdits', `op=set ${code}[${edit.recordRef}].${fieldKey} = "${displayVal}"`);
    } else {
      skipped++;
      log.warn('BiqApplyEdits', `op=set SKIPPED: ${code}[${edit.recordRef}].${fieldKey} — applySetToRecord returned false`);
    }
  }

  log.debug('BiqApplyEdits', `loop complete: applied=${applied} skipped=${skipped}`);

  const normalizeRaceResult = normalizeRaceDependentSections(parsed, edits, originalRaceRefs);
  if (!normalizeRaceResult.ok) {
    log.error('BiqApplyEdits', `normalizeRaceDependentSections failed: ${normalizeRaceResult.error || 'unknown'}`);
    return { ok: false, error: normalizeRaceResult.error || 'Failed to normalize civilization-dependent BIQ data.' };
  }
  const normalizeDeleteResult = normalizeDeletedReferenceSections(parsed, edits, originalRefsBySection);
  if (!normalizeDeleteResult.ok) {
    log.error('BiqApplyEdits', `normalizeDeletedReferenceSections failed: ${normalizeDeleteResult.error || 'unknown'}`);
    return { ok: false, error: normalizeDeleteResult.error || 'Failed to normalize deleted BIQ references.' };
  }
  const mapReferenceIssues = collectMapReferenceIntegrityIssues(parsed);
  if (mapReferenceIssues.length > 0) {
    const issue = mapReferenceIssues[0];
    let detail = `map integrity issue ${issue.kind}`;
    if (issue.kind === 'tile-city-ref') {
      detail = `tile ${issue.tileIndex} references CITY ${issue.cityRef} but only ${issue.cityCount} city record(s) remain`;
    } else if (issue.kind === 'tile-colony-ref') {
      detail = `tile ${issue.tileIndex} references CLNY ${issue.colonyRef} but only ${issue.colonyCount} colony record(s) remain`;
    } else if (issue.kind === 'tile-city-coords') {
      detail = `tile ${issue.tileIndex} points at CITY ${issue.cityRef}, but tile ${issue.tileX},${issue.tileY} does not match city ${issue.cityX},${issue.cityY}`;
    } else if (issue.kind === 'tile-colony-coords') {
      detail = `tile ${issue.tileIndex} points at CLNY ${issue.colonyRef}, but tile ${issue.tileX},${issue.tileY} does not match colony ${issue.colonyX},${issue.colonyY}`;
    } else if (issue.kind === 'city-tile-backref') {
      detail = `CITY ${issue.cityRef} at ${issue.cityX},${issue.cityY} is not linked back from its tile (tile has CITY ${issue.tileCityRef})`;
    } else if (issue.kind === 'colony-tile-backref') {
      detail = `CLNY ${issue.colonyRef} at ${issue.colonyX},${issue.colonyY} is not linked back from its tile (tile has CLNY ${issue.tileColonyRef})`;
    } else if (issue.kind === 'city-ref-count') {
      detail = `CITY ${issue.cityRef} is referenced by ${issue.count} tile(s) instead of exactly 1`;
    } else if (issue.kind === 'colony-ref-count') {
      detail = `CLNY ${issue.colonyRef} is referenced by ${issue.count} tile(s) instead of exactly 1`;
    } else if (issue.kind === 'city-out-of-bounds') {
      detail = `CITY ${issue.cityRef} is out of bounds at ${issue.cityX},${issue.cityY} for map ${issue.mapWidth}x${issue.mapHeight}`;
    } else if (issue.kind === 'colony-out-of-bounds') {
      detail = `CLNY ${issue.colonyRef} is out of bounds at ${issue.colonyX},${issue.colonyY} for map ${issue.mapWidth}x${issue.mapHeight}`;
    } else if (issue.kind === 'unit-out-of-bounds') {
      detail = `UNIT ${issue.unitRef} is out of bounds at ${issue.unitX},${issue.unitY} for map ${issue.mapWidth}x${issue.mapHeight}`;
    } else if (issue.kind === 'city-missing-tile') {
      detail = `CITY ${issue.cityRef} points to missing tile ${issue.cityX},${issue.cityY}`;
    } else if (issue.kind === 'colony-missing-tile') {
      detail = `CLNY ${issue.colonyRef} points to missing tile ${issue.colonyX},${issue.colonyY}`;
    } else if (issue.kind === 'unit-missing-tile') {
      detail = `UNIT ${issue.unitRef} points to missing tile ${issue.unitX},${issue.unitY}`;
    } else if (/^(city|unit|clny|sloc)-owner-ref$/.test(issue.kind)) {
      detail = `${issue.sectionCode} ${issue.recordRef} has invalid owner ${issue.owner} for ownerType ${issue.ownerType} (races=${issue.raceCount}, players=${issue.playerCount})`;
    } else if (/^(city|unit|clny|sloc)-owner-type$/.test(issue.kind)) {
      detail = `${issue.sectionCode} ${issue.recordRef} has unsupported ownerType ${issue.ownerType}`;
    } else if (issue.kind === 'sloc-out-of-bounds') {
      detail = `SLOC ${issue.slocRef} is out of bounds at ${issue.slocX},${issue.slocY} for map ${issue.mapWidth}x${issue.mapHeight}`;
    } else if (issue.kind === 'sloc-missing-tile') {
      detail = `SLOC ${issue.slocRef} points to missing tile ${issue.slocX},${issue.slocY}`;
    }
    log.error('BiqApplyEdits', `collectMapReferenceIntegrityIssues failed: ${detail}`);
    return { ok: false, error: `Map reference integrity check failed after BIQ edits: ${detail}.` };
  }
  const touchedColonyLikeState = edits.some((edit) => {
    const op = String(edit && edit.op || 'set').toLowerCase();
    const sectionCode = String(edit && edit.sectionCode || '').toUpperCase();
    const fieldKey = canonicalKey(edit && edit.fieldKey);
    if (op === 'setmap' || op === 'resizemap') return true;
    if (sectionCode === 'CLNY') return true;
    if (sectionCode === 'TILE' && (fieldKey === 'colony' || fieldKey === 'c3coverlays')) return true;
    return false;
  });
  if (touchedColonyLikeState) {
    const colonyOverlayIssues = collectColonyOverlayCoherenceIssues(parsed);
    if (colonyOverlayIssues.length > 0) {
      const issue = colonyOverlayIssues[0];
      const detail = `tile ${issue.tileIndex} links CLNY ${issue.colonyRef} with improvementType ${issue.improvementType}, but tile overlay state resolves to ${issue.overlayType}`;
      log.error('BiqApplyEdits', `collectColonyOverlayCoherenceIssues failed: ${detail}`);
      return { ok: false, error: `Colony overlay coherence check failed after BIQ edits: ${detail}.` };
    }
  }

  const newBuf = buildBiqBuffer(parsed);
  log.debug('BiqApplyEdits', `buildBiqBuffer complete: output size ${newBuf ? newBuf.length : 0} — applied=${applied} skipped=${skipped}${warnings.length > 0 ? ' warnings=' + warnings.length : ''}`);
  return {
    ok: true,
    buffer: newBuf,
    applied,
    skipped,
    warning: warnings.join('; ')
  };
}

// ---------------------------------------------------------------------------
// English output for bridge format
// ---------------------------------------------------------------------------

function sectionToEnglish(rec, code, io) {
  const reg = SECTION_REGISTRY[code];
  if (reg && reg.toEnglish) {
    try { return reg.toEnglish(rec, io); } catch (_e) { /* fall through */ }
  }
  return toEnglishGeneric(rec);
}

function sectionWritableKeys(code) {
  const reg = SECTION_REGISTRY[code];
  return reg ? (reg.writableKeys || []) : [];
}

function sectionRecordName(rec, code) {
  if (code === 'RACE' && rec && rec.civilizationName) return String(rec.civilizationName);
  if (rec.name) return String(rec.name);
  if (rec.civilopediaEntry) return String(rec.civilopediaEntry);
  return `${code} ${(rec.index || 0) + 1}`;
}

module.exports = {
  parseAllSections,
  buildBiqBuffer,
  serializeSection,
  applyEdits,
  applySetToRecord,
  sectionToEnglish,
  sectionWritableKeys,
  sectionRecordName,
  BiqIO,
  SECTION_REGISTRY,
  TILE_FIELDS,
  TILE_FIELD_MAP,
  getTileRecordLength,
  normalizeRaceDependentSections,
  normalizeDeletedReferenceSections,
  collectMapReferenceIntegrityIssues,
  collectColonyOverlayCoherenceIssues,
};
