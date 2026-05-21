'use strict';

// Field-by-field tests for biqSections.js parsers.
// Verifies that every registered section produces human-readable field names
// and record names — i.e. no "TERR 1" labels or "u32_N" field keys.

const test = require('node:test');
const assert = require('node:assert/strict');

const { BiqWriter } = require('../src/biq/biqBuffer');
const {
  BiqIO,
  SECTION_REGISTRY,
  serializeSection,
  sectionToEnglish,
  sectionRecordName,
  sectionWritableKeys,
  TILE_FIELDS,
} = require('../src/biq/biqSections');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIo(overrides) {
  return new BiqIO({ versionTag: 'BICX', majorVersion: 12, minorVersion: 8, numEras: 3, mapWidth: 80, ...overrides });
}

function ws(str, len) {
  const src = Buffer.from(String(str || ''), 'latin1');
  const buf = Buffer.alloc(len, 0);
  src.copy(buf, 0, 0, Math.min(src.length, len));
  return buf;
}

/** Parse the english output into a key→value Map. */
function parseEnglish(english) {
  const map = new Map();
  for (const line of String(english || '').split('\n')) {
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    map.set(line.slice(0, ci).trim(), line.slice(ci + 1).trim());
  }
  return map;
}

/** Assert no generic "u32_N" field names appear in the english output. */
function assertNoGenericFields(english, label) {
  for (const line of String(english || '').split('\n')) {
    assert.ok(
      !/^u32_\d+:/i.test(line),
      `${label}: found generic pass-through field — "${line}"`
    );
  }
}

/** Assert the record name is not the fallback "CODE N" form. */
function assertNameNotFallback(rec, code) {
  const name = sectionRecordName(rec, code);
  assert.ok(
    !new RegExp(`^${code}\\s+\\d+$`).test(name),
    `${code}: expected human-readable record name, got: "${name}"`
  );
  return name;
}

// ---------------------------------------------------------------------------
// TECH
// ---------------------------------------------------------------------------

test('TECH parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.TECH;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Pottery', 32));
  w.writeBytes(ws('TECH_POTTERY', 32));
  w.writeInt(80);    // cost
  w.writeInt(0);     // era
  w.writeInt(5);     // advanceIcon
  w.writeInt(3);     // x
  w.writeInt(7);     // y
  for (let i = 0; i < 4; i++) w.writeInt(-1); // prerequisites
  w.writeInt(0);     // flags
  w.writeInt(2);     // flavors (Conquests)
  w.writeInt(0);     // questionMark
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Pottery');
  assert.equal(rec.civilopediaEntry, 'TECH_POTTERY');
  assert.equal(rec.cost, 80);
  assert.equal(rec.x, 3);
  assert.equal(rec.y, 7);

  const english = sectionToEnglish({ index: 0, ...rec }, 'TECH', io);
  assertNoGenericFields(english, 'TECH');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Pottery');
  assert.equal(map.get('cost'), '80');
  assert.equal(map.get('x'), '3');
  assert.equal(map.get('y'), '7');

  assertNameNotFallback({ index: 0, ...rec }, 'TECH');
});

test('PRTO serializer preserves Conquests record layout when clearing requirement fields', () => {
  const reg = SECTION_REGISTRY.PRTO;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(0); // zoneOfControl
  w.writeBytes(ws('Ronin', 32));
  w.writeBytes(ws('PRTO_RONIN', 32));
  // PRTO primary scalars
  [
    0, 0, 0, 30, 2, 0, 4,
    0, 0, 1, 1, 5, 6,
    7, -1, -1
  ].forEach((value) => w.writeInt(value));
  // PRTO mid scalars, including PTWActionsMix as stored on disk
  [
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 65536
  ].forEach((value) => w.writeInt(value));
  w.writeInt(0); // bombardEffects
  for (let i = 0; i < 14; i++) w.writeByte(0); // ignoreMovementCost
  w.writeInt(0); // requiresSupport
  w.writeInt(7); // useExactCost
  w.writeInt(0); // telepadRange
  w.writeInt(1); // questionMark3
  w.writeInt(0); // numLegalUnitTelepads
  w.writeInt(-1); // enslaveResultsIn
  w.writeInt(1); // questionMark5
  w.writeInt(0); // numStealthTargets
  w.writeInt(1); // questionMark6
  w.writeInt(0); // numLegalBuildingTelepads
  w.writeByte(0); // createsCraters
  w.writeFloat(0); // workerStrengthFloat
  w.writeInt(0); // questionMark8
  w.writeInt(0); // airDefence
  const original = w.toBuffer();

  const rec = reg.parse(original, io);
  assert.equal(rec.requiredTech, 5);
  assert.equal(rec.requiredResource1, 7);
  assert.equal(rec.requiredResource2, -1);
  assert.equal(rec.upgradeTo, 6);
  assert.equal(rec.PTWActionsMix, 0);

  rec.requiredTech = -1;
  rec.requiredResource1 = -1;
  rec.upgradeTo = -1;

  const serialized = reg.serialize(rec, io);
  assert.equal(serialized.length, original.length, 'PRTO byte length must stay stable after edit');

  const reparsed = reg.parse(serialized, io);
  assert.equal(reparsed.requiredTech, -1);
  assert.equal(reparsed.requiredResource1, -1);
  assert.equal(reparsed.requiredResource2, -1);
  assert.equal(reparsed.upgradeTo, -1);
  assert.equal(reparsed.PTWActionsMix, 0);
  assert.equal(reparsed.bombardEffects, 0);
  assert.equal(reparsed.useExactCost, 7);
  assert.equal(reparsed.questionMark6, 1);
  assert.equal(reparsed.airDefence, 0);
});

// ---------------------------------------------------------------------------
// BLDG
// ---------------------------------------------------------------------------

test('BLDG parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.BLDG;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Barracks description', 64));
  w.writeBytes(ws('Barracks', 32));
  w.writeBytes(ws('BLDG_BARRACKS', 32));
  // BLDG_SCALAR_NAMES — 35 int32s
  const scalarCount = 35;
  for (let i = 0; i < scalarCount; i++) w.writeInt(i === 4 ? 40 : 0); // cost=40 at index 4
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Barracks');
  assert.equal(rec.civilopediaEntry, 'BLDG_BARRACKS');
  assert.equal(rec.cost, 40);

  const english = sectionToEnglish({ index: 0, ...rec }, 'BLDG', io);
  assertNoGenericFields(english, 'BLDG');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Barracks');
  assert.ok(map.has('cost'), 'BLDG: expected cost field');
});

// ---------------------------------------------------------------------------
// GOOD (Resources)
// ---------------------------------------------------------------------------

test('GOOD parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.GOOD;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Aluminum', 24));
  w.writeBytes(ws('GOOD_ALUMINUM', 32));
  w.writeInt(1);  // type
  w.writeInt(10); // appearanceRatio
  w.writeInt(5);  // disapperanceProbability
  w.writeInt(3);  // icon
  w.writeInt(-1); // prerequisite
  w.writeInt(0);  // foodBonus
  w.writeInt(1);  // shieldsBonus
  w.writeInt(2);  // commerceBonus
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Aluminum');
  assert.equal(rec.civilopediaEntry, 'GOOD_ALUMINUM');
  assert.equal(rec.shieldsBonus, 1);
  assert.equal(rec.commerceBonus, 2);

  const english = sectionToEnglish({ index: 0, ...rec }, 'GOOD', io);
  assertNoGenericFields(english, 'GOOD');
  const map = parseEnglish(english);
  assert.equal(map.get('shieldsBonus'), '1');
  assert.equal(map.get('commerceBonus'), '2');
});

// ---------------------------------------------------------------------------
// GOVT
// ---------------------------------------------------------------------------

test('GOVT parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.GOVT;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(0); // defaultType
  w.writeInt(1); // transitionType
  w.writeInt(1); // requiresMaintenance
  w.writeInt(0); // questionMark1
  w.writeInt(2); // tilePenalty
  w.writeInt(3); // commerceBonus
  w.writeBytes(ws('Despotism', 64));
  w.writeBytes(ws('GOVT_DESPOTISM', 32));
  for (let i = 0; i < 8; i++) w.writeBytes(ws(`Ruler${i}`, 32)); // rulerTitles
  w.writeInt(5);  // corruption
  w.writeInt(0);  // immuneTo
  w.writeInt(0);  // diplomatLevel
  w.writeInt(0);  // spyLevel
  w.writeInt(0);  // numGovts (no relations)
  // s2names: 17 × int32
  for (let i = 0; i < 17; i++) w.writeInt(i === 0 ? 99 : 0); // hurrying=99
  // Conquests: xenophobic=1, forceResettlement=0
  w.writeInt(1);
  w.writeInt(0);
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Despotism');
  assert.equal(rec.civilopediaEntry, 'GOVT_DESPOTISM');
  assert.equal(rec.corruption, 5);
  assert.equal(rec.hurrying, 99);
  assert.equal(rec.xenophobic, 1);

  const english = sectionToEnglish({ index: 0, ...rec }, 'GOVT', io);
  assertNoGenericFields(english, 'GOVT');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Despotism');
  assert.equal(map.get('corruption'), '5');
  assert.equal(map.get('xenophobic'), '1');
  // numGovts=0 in fixture → numGovts field must be present
  assert.equal(map.get('numGovts'), '0', 'GOVT: expected numGovts');
});

test('GOVT toEnglish expands relations array', () => {
  const reg = SECTION_REGISTRY.GOVT;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(0); // defaultType
  w.writeInt(1); // transitionType
  w.writeInt(0); // requiresMaintenance
  w.writeInt(0); // questionMark1
  w.writeInt(0); // tilePenalty
  w.writeInt(0); // commerceBonus
  w.writeBytes(ws('Republic', 64));
  w.writeBytes(ws('GOVT_REPUBLIC', 32));
  for (let i = 0; i < 8; i++) w.writeBytes(ws('', 32)); // rulerTitles
  w.writeInt(0);  // corruption
  w.writeInt(0);  // immuneTo
  w.writeInt(0);  // diplomatLevel
  w.writeInt(0);  // spyLevel
  w.writeInt(2);  // numGovts = 2 relations
  // relation 0: canBribe=1, briberyMod=50, resistanceMod=25
  w.writeInt(1); w.writeInt(50); w.writeInt(25);
  // relation 1: canBribe=0, briberyMod=0, resistanceMod=10
  w.writeInt(0); w.writeInt(0); w.writeInt(10);
  // s2names: 17 × int32
  for (let i = 0; i < 17; i++) w.writeInt(0);
  // Conquests: xenophobic=0, forceResettlement=0
  w.writeInt(0); w.writeInt(0);
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.numGovts, 2);
  assert.deepEqual(rec.relations, [
    { canBribe: 1, briberyMod: 50, resistanceMod: 25 },
    { canBribe: 0, briberyMod: 0, resistanceMod: 10 },
  ]);

  const english = sectionToEnglish({ index: 0, ...rec }, 'GOVT', io);
  assertNoGenericFields(english, 'GOVT');
  const map = parseEnglish(english);
  assert.equal(map.get('numGovts'), '2', 'GOVT: expected numGovts=2');
  assert.equal(map.get('govt_relation_0_can_bribe'), '1', 'GOVT: expected relation 0 canBribe');
  assert.equal(map.get('govt_relation_0_bribery_mod'), '50', 'GOVT: expected relation 0 briberyMod');
  assert.equal(map.get('govt_relation_0_resistance_mod'), '25', 'GOVT: expected relation 0 resistanceMod');
  assert.equal(map.get('govt_relation_1_can_bribe'), '0', 'GOVT: expected relation 1 canBribe');
  assert.equal(map.get('govt_relation_1_resistance_mod'), '10', 'GOVT: expected relation 1 resistanceMod');
});

// ---------------------------------------------------------------------------
// RACE
// ---------------------------------------------------------------------------

test('RACE parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.RACE;
  const io = makeIo({ numEras: 3 });
  const w = new BiqWriter();
  // cityNames: numCities=2, 2×24
  w.writeInt(2);
  w.writeBytes(ws('Rome', 24));
  w.writeBytes(ws('Antium', 24));
  // milLeaderNames: numMilLeaders=1, 1×32
  w.writeInt(1);
  w.writeBytes(ws('Caesar', 32));
  w.writeBytes(ws('Caesar', 32));   // leaderName
  w.writeBytes(ws('Emperor', 24));  // leaderTitle
  w.writeBytes(ws('RACE_ROME', 32));// civilopediaEntry
  w.writeBytes(ws('Roman', 40));    // adjective
  w.writeBytes(ws('Roman Empire', 40)); // civilizationName
  w.writeBytes(ws('Romans', 40));   // noun
  // forward + reverse filenames: numEras=3, 6×260
  for (let i = 0; i < 6; i++) w.writeBytes(ws('', 260));
  w.writeInt(0); // cultureGroup
  w.writeInt(0); // leaderGender
  w.writeInt(0); // civilizationGender
  w.writeInt(2); // aggressionLevel
  w.writeInt(0); // uniqueCivCounter
  w.writeInt(-1); // shunnedGovernment
  w.writeInt(0);  // favoriteGovernment
  w.writeInt(5);  // defaultColor
  w.writeInt(5);  // uniqueColor
  for (let i = 0; i < 4; i++) w.writeInt(-1); // freeTechs
  w.writeInt(0); // bonuses
  w.writeInt(0); // governorSettings
  w.writeInt(0); // buildNever
  w.writeInt(0); // buildOften
  w.writeInt(0); // plurality
  // PTW+: kingUnit
  w.writeInt(-1);
  // Conquests: flavors, questionMark, diplomacyTextIndex, numScientificLeaders=0
  w.writeInt(0);
  w.writeInt(0);
  w.writeInt(0);
  w.writeInt(0);
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Caesar');
  assert.equal(rec.civilopediaEntry, 'RACE_ROME');
  assert.equal(rec.aggressionLevel, 2);

  const english = sectionToEnglish({ index: 0, ...rec }, 'RACE', io);
  assertNoGenericFields(english, 'RACE');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Caesar');
  assert.equal(map.get('aggressionLevel'), '2');
  // City names array must be expanded
  assert.equal(map.get('numCities'), '2', 'RACE: expected numCities');
  assert.equal(map.get('cityName_0'), 'Rome', 'RACE: expected cityName_0');
  assert.equal(map.get('cityName_1'), 'Antium', 'RACE: expected cityName_1');
  // Military leader names array must be expanded
  assert.equal(map.get('numMilLeaders'), '1', 'RACE: expected numMilLeaders');
  assert.equal(map.get('milLeader_0'), 'Caesar', 'RACE: expected milLeader_0');
  // Era filenames must be expanded (3 eras, empty in fixture)
  assert.ok(map.has('forwardFilename_0'), 'RACE: expected forwardFilename_0');
  assert.ok(map.has('reverseFilename_0'), 'RACE: expected reverseFilename_0');
  // uniqueCivCounter and governorSettings must be present
  assert.ok(map.has('uniqueCivCounter'), 'RACE: expected uniqueCivCounter');
  assert.ok(map.has('governorSettings'), 'RACE: expected governorSettings');
  // PTW+: kingUnit must be present
  assert.ok(map.has('kingUnit'), 'RACE: expected kingUnit (PTW+)');
  // Conquests: numScientificLeaders (0 in fixture)
  assert.equal(map.get('numScientificLeaders'), '0', 'RACE: expected numScientificLeaders');
  assertNameNotFallback({ index: 0, ...rec }, 'RACE');
});

// ---------------------------------------------------------------------------
// PRTO
// ---------------------------------------------------------------------------

test('PRTO parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.PRTO;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(1);  // zoc
  w.writeBytes(ws('Warrior', 32));
  w.writeBytes(ws('PRTO_WARRIOR', 32));
  w.writeInt(0); // bombardStrength
  w.writeInt(0); // bombardRange
  w.writeInt(0); // capacity
  w.writeInt(10); // shieldCost
  w.writeInt(1); // defence
  w.writeInt(3); // iconIndex
  w.writeInt(1); // attack
  w.writeInt(0); // operationalRange
  w.writeInt(0); // populationCost
  w.writeInt(0); // rateOfFire
  w.writeInt(1); // movement
  w.writeInt(-1); // requiredTech
  w.writeInt(-1); // upgradeTo
  w.writeInt(-1); // requiredResource1
  w.writeInt(-1); // requiredResource2
  w.writeInt(-1); // requiredResource3
  w.writeInt(0); // unitAbilities
  w.writeInt(1); // AIStrategy
  w.writeInt(0); // availableTo
  w.writeInt(0); // standardOrdersSpecialActions
  w.writeInt(0); // airMissions
  w.writeInt(0); // unitClass
  w.writeInt(-1); // otherStrategy
  w.writeInt(0); // hitPointBonus
  w.writeInt(0); // PTWStandardOrders
  w.writeInt(0); // PTWSpecialActions
  w.writeInt(0); // PTWWorkerActions
  w.writeInt(0); // PTWAirMissions
  w.writeInt(65536); // PTWActionsMix encoded with fixed high word
  w.writeInt(0); // bombardEffects
  for (let i = 0; i < 14; i += 1) w.writeByte(0); // ignoreMovementCost
  w.writeInt(0); // requiresSupport
  w.writeInt(7); // useExactCost
  w.writeInt(0); // telepadRange
  w.writeInt(1); // questionMark3
  w.writeInt(0); // numLegalUnitTelepads
  w.writeInt(-1); // enslaveResultsIn
  w.writeInt(1); // questionMark5
  w.writeInt(0); // numStealthTargets
  w.writeInt(1); // questionMark6
  w.writeInt(0); // numLegalBuildingTelepads
  w.writeByte(0); // createsCraters
  w.writeFloat(1); // workerStrengthFloat
  w.writeInt(0); // questionMark8
  w.writeInt(0); // airDefence
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Warrior');
  assert.equal(rec.civilopediaEntry, 'PRTO_WARRIOR');
  assert.equal(rec.attack, 1);
  assert.equal(rec.shieldCost, 10);

  const english = sectionToEnglish({ index: 0, ...rec }, 'PRTO', io);
  assertNoGenericFields(english, 'PRTO');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Warrior');
  assert.equal(map.get('attack'), '1');
  assert.equal(map.get('zoneOfControl'), '1', 'PRTO: expected zoneOfControl');
  assert.equal(map.get('defence'), '1', 'PRTO: expected defence');
  assert.equal(map.get('movement'), '1', 'PRTO: expected movement');
  assert.equal(map.get('shieldCost'), '10', 'PRTO: expected shieldCost');
  assert.equal(map.get('iconIndex'), '3', 'PRTO: expected iconIndex');
  assert.equal(map.get('requiredTech'), '-1', 'PRTO: expected requiredTech');
  assert.equal(map.get('requiredResource1'), '-1', 'PRTO: expected requiredResource1');
  assert.equal(map.get('AIStrategy'), '1', 'PRTO: expected AIStrategy');
  assert.equal(map.get('unitClass'), '0', 'PRTO: expected unitClass');
  assert.equal(map.get('useExactCost'), '7', 'PRTO: expected useExactCost');
  assert.equal(map.get('workerStrengthFloat'), '1', 'PRTO: expected workerStrengthFloat');
  assert.equal(map.get('bombardRange'), '0', 'PRTO: expected bombardRange');
  assert.equal(map.get('bombardStrength'), '0', 'PRTO: expected bombardStrength');
  assert.equal(map.get('airDefence'), '0', 'PRTO: expected airDefence');
});

// ---------------------------------------------------------------------------
// CTZN
// ---------------------------------------------------------------------------

test('CTZN parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.CTZN;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(1);   // defaultCitizen
  w.writeBytes(ws('Scientist', 32));
  w.writeBytes(ws('CTZN_SCIENTIST', 32));
  w.writeBytes(ws('Scientists', 32)); // pluralName
  w.writeInt(-1);  // prerequisite
  w.writeInt(3);   // luxuries
  w.writeInt(8);   // research
  w.writeInt(0);   // taxes
  w.writeInt(0);   // corruption (Conquests)
  w.writeInt(0);   // construction (Conquests)
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Scientist');
  assert.equal(rec.research, 8);

  const english = sectionToEnglish({ index: 0, ...rec }, 'CTZN', io);
  assertNoGenericFields(english, 'CTZN');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Scientist');
  assert.equal(map.get('research'), '8');
  assertNameNotFallback({ index: 0, ...rec }, 'CTZN');
});

// ---------------------------------------------------------------------------
// CULT
// ---------------------------------------------------------------------------

test('CULT parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.CULT;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Western', 64));
  w.writeInt(75);  // propagandaSuccess
  w.writeInt(50);  // cultRatioPercent
  w.writeInt(100); // ratioDenominator
  w.writeInt(50);  // ratioNumerator
  w.writeInt(25);  // initResistanceChance
  w.writeInt(10);  // continuedResistanceChance
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Western');
  assert.equal(rec.propagandaSuccess, 75);

  const english = sectionToEnglish({ index: 0, ...rec }, 'CULT', io);
  assertNoGenericFields(english, 'CULT');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Western');
  assert.equal(map.get('propagandaSuccess'), '75');
  assertNameNotFallback({ index: 0, ...rec }, 'CULT');
});

// ---------------------------------------------------------------------------
// DIFF
// ---------------------------------------------------------------------------

test('DIFF parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.DIFF;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Chieftain', 64));
  // 14 DIFF_SCALAR_NAMES
  w.writeInt(3);  // contentCitizens
  w.writeInt(0);  // maxGovtTransition
  w.writeInt(0);  // AIDefenceStart
  w.writeInt(0);  // AIOffenceStart
  w.writeInt(0);  // extraStart1
  w.writeInt(0);  // extraStart2
  w.writeInt(0);  // additionalFreeSupport
  w.writeInt(0);  // bonusPerCity
  w.writeInt(0);  // attackBarbariansBonus
  w.writeInt(100);// costFactor
  w.writeInt(90); // percentOptimal
  w.writeInt(0);  // AIAITrade
  w.writeInt(20); // corruptionPercent
  w.writeInt(0);  // militaryLaw
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Chieftain');
  assert.equal(rec.contentCitizens, 3);
  assert.equal(rec.corruptionPercent, 20);

  const english = sectionToEnglish({ index: 0, ...rec }, 'DIFF', io);
  assertNoGenericFields(english, 'DIFF');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Chieftain');
  assert.equal(map.get('contentCitizens'), '3');
  assert.equal(map.get('corruptionPercent'), '20');
  assertNameNotFallback({ index: 0, ...rec }, 'DIFF');
});

// ---------------------------------------------------------------------------
// ERAS
// ---------------------------------------------------------------------------

test('ERAS parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.ERAS;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Ancient', 64));          // eraName
  w.writeBytes(ws('ERA_ANCIENT', 32));      // civilopediaEntry
  for (let i = 0; i < 5; i++) w.writeBytes(ws(i === 0 ? 'Darwin' : '', 32)); // researchers
  w.writeInt(1);  // usedResearcherNames
  w.writeInt(0);  // questionMark (Conquests)
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.eraName, 'Ancient');
  assert.equal(rec.civilopediaEntry, 'ERA_ANCIENT');

  const english = sectionToEnglish({ index: 0, ...rec }, 'ERAS', io);
  assertNoGenericFields(english, 'ERAS');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Ancient');
  assert.ok(map.has('usedResearcherNames'), 'ERAS: expected usedResearcherNames field');
  assertNameNotFallback({ index: 0, ...rec }, 'ERAS');
});

// ---------------------------------------------------------------------------
// ESPN
// ---------------------------------------------------------------------------

test('ESPN parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.ESPN;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Steal a technology', 128)); // description
  w.writeBytes(ws('Steal Tech', 64));           // name
  w.writeBytes(ws('ESPN_STEAL_TECH', 32));      // civilopediaEntry
  w.writeInt(2);   // missionPerformedBy
  w.writeInt(500); // baseCost
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Steal Tech');
  assert.equal(rec.baseCost, 500);

  const english = sectionToEnglish({ index: 0, ...rec }, 'ESPN', io);
  assertNoGenericFields(english, 'ESPN');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Steal Tech');
  assert.equal(map.get('baseCost'), '500');
  assertNameNotFallback({ index: 0, ...rec }, 'ESPN');
});

// ---------------------------------------------------------------------------
// EXPR
// ---------------------------------------------------------------------------

test('EXPR parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.EXPR;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Veteran', 32));
  w.writeInt(10);  // baseHitPoints
  w.writeInt(5);   // retreatBonus
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Veteran');
  assert.equal(rec.baseHitPoints, 10);

  const english = sectionToEnglish({ index: 0, ...rec }, 'EXPR', io);
  assertNoGenericFields(english, 'EXPR');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Veteran');
  assert.equal(map.get('baseHitPoints'), '10');
  assertNameNotFallback({ index: 0, ...rec }, 'EXPR');
});

// ---------------------------------------------------------------------------
// TFRM
// ---------------------------------------------------------------------------

test('TFRM parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.TFRM;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Plant Forest', 32));
  w.writeBytes(ws('TFRM_PLANT_FOREST', 32));
  w.writeInt(10); // turnsToComplete
  w.writeInt(-1); // requiredAdvance
  w.writeInt(-1); // requiredResource1
  w.writeInt(-1); // requiredResource2
  w.writeBytes(ws('Plant Forest', 32)); // order
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Plant Forest');
  assert.equal(rec.turnsToComplete, 10);

  const english = sectionToEnglish({ index: 0, ...rec }, 'TFRM', io);
  assertNoGenericFields(english, 'TFRM');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Plant Forest');
  assert.equal(map.get('turnsToComplete'), '10');
  assertNameNotFallback({ index: 0, ...rec }, 'TFRM');
});

// ---------------------------------------------------------------------------
// WSIZ
// ---------------------------------------------------------------------------

test('WSIZ parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.WSIZ;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(16);  // optimalNumberOfCities
  w.writeInt(100); // techRate
  w.writeBytes(Buffer.alloc(24)); // padding
  w.writeBytes(ws('Small', 32));  // name
  w.writeInt(100); // height
  w.writeInt(8);   // distanceBetweenCivs
  w.writeInt(8);   // numberOfCivs
  w.writeInt(160); // width
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Small');
  assert.equal(rec.width, 160);
  assert.equal(rec.height, 100);

  const english = sectionToEnglish({ index: 0, ...rec }, 'WSIZ', io);
  assertNoGenericFields(english, 'WSIZ');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Small');
  assert.equal(map.get('width'), '160');
  assertNameNotFallback({ index: 0, ...rec }, 'WSIZ');
});

// ---------------------------------------------------------------------------
// WCHR
// ---------------------------------------------------------------------------

test('WCHR parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.WCHR;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(2);  // selectedClimate
  w.writeInt(2);  // actualClimate
  w.writeInt(1);  // selectedBarbarian
  w.writeInt(1);  // actualBarbarian
  w.writeInt(0);  // selectedLandform
  w.writeInt(0);  // actualLandform
  w.writeInt(3);  // selectedOcean
  w.writeInt(3);  // actualOcean
  w.writeInt(1);  // selectedTemp
  w.writeInt(1);  // actualTemp
  w.writeInt(2);  // selectedAge
  w.writeInt(2);  // actualAge
  w.writeInt(4);  // worldSize
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.selectedClimate, 2);
  assert.equal(rec.worldSize, 4);

  const english = sectionToEnglish({ index: 0, ...rec }, 'WCHR', io);
  assertNoGenericFields(english, 'WCHR');
  const map = parseEnglish(english);
  assert.equal(map.get('selectedClimate'), '2');
  assert.equal(map.get('worldSize'), '4');
  // Record name is a static label (not name/civKey)
  const name = sectionRecordName({ index: 0, ...rec }, 'WCHR');
  assert.ok(name.length > 0 && !/^WCHR\s+\d+$/.test(name), `WCHR: expected non-fallback name, got "${name}"`);
});

// ---------------------------------------------------------------------------
// WMAP
// ---------------------------------------------------------------------------

test('WMAP parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.WMAP;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(3);   // numResources
  w.writeInt(10);  // resourceOccurrences[0]
  w.writeInt(20);  // resourceOccurrences[1]
  w.writeInt(30);  // resourceOccurrences[2]
  w.writeInt(5);   // numContinents
  w.writeInt(100); // height
  w.writeInt(8);   // distanceBetweenCivs
  w.writeInt(8);   // numCivs
  w.writeInt(0);   // qm1
  w.writeInt(0);   // qm2
  w.writeInt(160); // width
  w.writeInt(0);   // qm3
  w.writeBytes(Buffer.alloc(124)); // unknownBytes
  w.writeInt(12345); // mapSeed
  w.writeInt(0);     // flags
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.width, 160);
  assert.equal(rec.height, 100);
  assert.equal(rec.mapSeed, 12345);

  const english = sectionToEnglish({ index: 0, ...rec }, 'WMAP', io);
  assertNoGenericFields(english, 'WMAP');
  const map = parseEnglish(english);
  assert.equal(map.get('width'), '160');
  assert.equal(map.get('height'), '100');
  assert.equal(map.get('mapSeed'), '12345');
  // resourceOccurrences array must be expanded
  assert.equal(map.get('numResources'), '3', 'WMAP: expected numResources');
  assert.equal(map.get('resource_occurrence_0'), '10', 'WMAP: expected resource_occurrence_0');
  assert.equal(map.get('resource_occurrence_1'), '20', 'WMAP: expected resource_occurrence_1');
  assert.equal(map.get('resource_occurrence_2'), '30', 'WMAP: expected resource_occurrence_2');
});

// ---------------------------------------------------------------------------
// TERR — the primary regression section
// ---------------------------------------------------------------------------

test('TERR parser produces human-readable fields (not "TERR 1" or "u32_N")', () => {
  const reg = SECTION_REGISTRY.TERR;
  const io = makeIo();
  const w = new BiqWriter();
  // numTotalResources = 8 → maskLen = 1
  w.writeInt(8);
  w.writeByte(0xff); // possibleResources mask (all 8 resources enabled)
  w.writeBytes(ws('Grassland', 32));
  w.writeBytes(ws('TERR_GRASSLAND', 32));
  // 10 scalars
  w.writeInt(1);  // foodBonus
  w.writeInt(0);  // shieldsBonus
  w.writeInt(0);  // commerceBonus
  w.writeInt(10); // defenceBonus
  w.writeInt(1);  // movementCost
  w.writeInt(2);  // food
  w.writeInt(0);  // shields
  w.writeInt(1);  // commerce
  w.writeInt(3);  // workerJob
  w.writeInt(0);  // pollutionEffect
  // 8 boolean bytes
  w.writeByte(1);  // allowCities
  w.writeByte(1);  // allowColonies
  w.writeByte(0);  // impassable
  w.writeByte(0);  // impassableByWheeled
  w.writeByte(1);  // allowAirfields
  w.writeByte(1);  // allowForts
  w.writeByte(1);  // allowOutposts
  w.writeByte(1);  // allowRadarTowers
  // Conquests extras
  w.writeInt(0);   // questionMark
  w.writeByte(0);  // landmarkEnabled
  // landmarkScalars: 8 × int32
  for (let i = 0; i < 8; i++) w.writeInt(0);
  w.writeBytes(ws('', 32));  // landmarkName
  w.writeBytes(ws('', 32));  // landmarkCivilopediaEntry
  w.writeInt(0);   // questionMark2
  w.writeInt(0);   // terrainFlags
  w.writeInt(0);   // diseaseStrength
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Grassland');
  assert.equal(rec.civilopediaEntry, 'TERR_GRASSLAND');
  assert.equal(rec.food, 2);
  assert.equal(rec.commerce, 1);
  assert.equal(rec.defenceBonus, 10);
  assert.equal(rec.allowCities, 1);
  assert.equal(rec.workerJob, 3);

  const english = sectionToEnglish({ index: 0, ...rec }, 'TERR', io);
  assertNoGenericFields(english, 'TERR');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Grassland');
  assert.equal(map.get('food'), '2');
  assert.equal(map.get('defenceBonus'), '10');
  assert.equal(map.get('allowCities'), '1');

  // This is the key regression check: record name must be "Grassland" not "TERR 1"
  const name = assertNameNotFallback({ index: 0, ...rec }, 'TERR');
  assert.equal(name, 'Grassland');
});

// ---------------------------------------------------------------------------
// RULE
// ---------------------------------------------------------------------------

test('RULE parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.RULE;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeBytes(ws('Town', 32));
  w.writeBytes(ws('City', 32));
  w.writeBytes(ws('Metropolis', 32));
  w.writeInt(5);  // numSSParts
  for (let i = 0; i < 5; i++) w.writeInt(i + 1); // numberOfPartsRequired
  // Visible Quint RULE fields before the culture-level block.
  const primaryScalarNames = [
    'advancedBarbarian', 'basicBarbarian', 'barbarianSeaUnit', 'citiesForArmy', 'chanceOfRioting',
    'draftTurnPenalty', 'shieldCostInGold', 'fortressDefenceBonus', 'citizensAffectedByHappyFace',
    'questionMark1', 'questionMark2', 'forestValueInShields', 'shieldValueInGold', 'citizenValueInShields',
    'defaultDifficultyLevel', 'battleCreatedUnit', 'buildArmyUnit', 'buildingDefensiveBonus',
    'citizenDefensiveBonus', 'defaultMoneyResource', 'chanceToInterceptAirMissions',
    'chanceToInterceptStealthMissions', 'startingTreasury', 'questionMark3', 'foodConsumptionPerCitizen',
    'riverDefensiveBonus', 'turnPenaltyForWhip', 'scout', 'slave', 'roadMovementRate', 'startUnit1', 'startUnit2',
    'WLTKDMinimumPop', 'townDefenceBonus', 'cityDefenceBonus', 'metropolisDefenceBonus',
    'maxCity1Size', 'maxCity2Size', 'questionMark4', 'fortificationsDefenceBonus'
  ];
  for (let i = 0; i < primaryScalarNames.length; i++) w.writeInt(i + 1);
  w.writeInt(3); // numCultureLevels
  w.writeBytes(ws('Village', 64));
  w.writeBytes(ws('Town', 64));
  w.writeBytes(ws('City', 64));
  w.writeInt(2); // borderExpansionMultiplier
  w.writeInt(10); // borderFactor
  const trailingScalarNames = ['futureTechCost', 'goldenAgeDuration', 'maximumResearchTime', 'minimumResearchTime', 'flagUnit', 'upgradeCost'];
  for (let i = 0; i < trailingScalarNames.length; i++) w.writeInt(41 + i);
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.townName, 'Town');
  assert.equal(rec.cityName, 'City');
  assert.equal(rec.metropolisName, 'Metropolis');
  assert.equal(rec.advancedBarbarian, 1);
  assert.equal(rec.slave, 29);
  assert.equal(rec.roadMovementRate, 30);
  assert.equal(rec.startUnit1, 31);
  assert.equal(rec.startUnit2, 32);
  assert.equal(rec.WLTKDMinimumPop, 33);
  assert.equal(rec.maxCity1Size, 37);
  assert.equal(rec.maxCity2Size, 38);
  assert.equal(rec.questionMark4, 39);
  assert.equal(rec.fortificationsDefenceBonus, 40);
  assert.equal(rec.numCultureLevels, 3);
  assert.deepEqual(rec.culturalLevelNames, ['Village', 'Town', 'City']);
  assert.equal(rec.borderExpansionMultiplier, 2);
  assert.equal(rec.borderFactor, 10);
  assert.equal(rec.futureTechCost, 41);
  assert.equal(rec.goldenAgeDuration, 42);
  assert.equal(rec.maximumResearchTime, 43);
  assert.equal(rec.minimumResearchTime, 44);
  assert.equal(rec.flagUnit, 45);
  assert.equal(rec.upgradeCost, 46);

  const english = sectionToEnglish({ index: 0, ...rec }, 'RULE', io);
  assertNoGenericFields(english, 'RULE');
  const map = parseEnglish(english);
  assert.equal(map.get('townName'), 'Town');
  assert.equal(map.get('cityName'), 'City');
  assert.equal(map.get('advancedBarbarian'), '1');
  assert.equal(map.get('slave'), '29');
  assert.equal(map.get('roadMovementRate'), '30');
  // Spaceship parts must be present
  assert.equal(map.get('numSpaceshipParts'), '5', 'RULE: expected numSpaceshipParts');
  assert.equal(map.get('number_of_parts_0_required'), '1', 'RULE: expected number_of_parts_0_required');
  assert.equal(map.get('number_of_parts_4_required'), '5', 'RULE: expected number_of_parts_4_required');
  assert.equal(map.get('futureTechCost'), '41');
  assert.equal(map.get('goldenAgeDuration'), '42');
  assert.equal(map.get('maximumResearchTime'), '43');
  assert.equal(map.get('minimumResearchTime'), '44');
  assert.equal(map.get('flagUnit'), '45');
  assert.equal(map.get('upgradeCost'), '46');

  // RULE has a static name, verify it is not a code+index fallback
  const name = sectionRecordName({ index: 0, ...rec }, 'RULE');
  assert.ok(!/^RULE\s+\d+$/.test(name), `RULE: expected non-fallback name, got "${name}"`);
});

// ---------------------------------------------------------------------------
// LEAD
// ---------------------------------------------------------------------------

test('LEAD parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.LEAD;
  const io = makeIo(); // isPTWPlus
  const w = new BiqWriter();
  w.writeInt(0);   // customCivData
  w.writeInt(1);   // humanPlayer
  w.writeBytes(ws('Caesar', 32)); // leaderName
  w.writeInt(0);   // questionMark1
  w.writeInt(0);   // questionMark2
  w.writeInt(1);   // numStartUnits
  w.writeInt(2);   // startUnitCount
  w.writeInt(3);   // startUnitIndex
  w.writeInt(0);   // genderOfLeaderName
  w.writeInt(2);   // numStartTechs
  w.writeInt(0);   // techIndices[0]
  w.writeInt(1);   // techIndices[1]
  w.writeInt(3);   // difficulty
  w.writeInt(0);   // initialEra
  w.writeInt(500); // startCash
  w.writeInt(0);   // government
  w.writeInt(5);   // civ
  w.writeInt(2);   // color
  // PTW+: skipFirstTurn, questionMark3, startEmbassies
  w.writeInt(0);
  w.writeInt(0);
  w.writeByte(1);  // startEmbassies
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.leaderName, 'Caesar');
  assert.equal(rec.humanPlayer, 1);
  assert.equal(rec.startCash, 500);
  assert.equal(rec.civ, 5);

  const english = sectionToEnglish({ index: 0, ...rec }, 'LEAD', io);
  assertNoGenericFields(english, 'LEAD');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Caesar');
  assert.equal(map.get('startCash'), '500');
  // Start units array must be expanded
  assert.equal(map.get('numberOfDifferentStartUnits'), '1', 'LEAD: expected numberOfDifferentStartUnits');
  assert.equal(map.get('starting_units_of_type_3'), '2', 'LEAD: expected starting_units_of_type_3 (count=2)');
  // Starting techs array must be expanded
  assert.equal(map.get('numberOfStartingTechnologies'), '2', 'LEAD: expected numberOfStartingTechnologies');
  assert.equal(map.get('starting_technology_0'), '0', 'LEAD: expected starting_technology_0');
  assert.equal(map.get('starting_technology_1'), '1', 'LEAD: expected starting_technology_1');
  assertNameNotFallback({ index: 0, ...rec }, 'LEAD');
});

// ---------------------------------------------------------------------------
// GAME
// ---------------------------------------------------------------------------

test('GAME parser produces human-readable fields with individual playable_civ_N entries', () => {
  const reg = SECTION_REGISTRY.GAME;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(1);   // useDefaultRules
  w.writeInt(0);   // defaultVictoryConditions
  w.writeInt(3);   // numPlayableCivs
  w.writeInt(1);   // playableCivIds[0]
  w.writeInt(3);   // playableCivIds[1]
  w.writeInt(5);   // playableCivIds[2]
  w.writeInt(7);   // victoryConditionsAndRules
  // Minimal tail (11 scalars + 7 + 7 + 5200)
  for (let i = 0; i < 11 + 7 + 7; i++) w.writeInt(0);
  w.writeBytes(Buffer.alloc(5200));
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.useDefaultRules, 1);
  assert.equal(rec.numPlayableCivs, 3);
  assert.deepEqual(rec.playableCivIds, [1, 3, 5]);

  const english = sectionToEnglish({ index: 0, ...rec }, 'GAME', io);
  assertNoGenericFields(english, 'GAME');
  const map = parseEnglish(english);
  assert.equal(map.get('useDefaultRules'), '1');
  // playable_civ_0, playable_civ_1, playable_civ_2 must exist individually
  assert.equal(map.get('playable_civ_0'), '1');
  assert.equal(map.get('playable_civ_1'), '3');
  assert.equal(map.get('playable_civ_2'), '5');
  // Must not have a combined "playableCivIds" key
  assert.ok(!map.has('playableCivIds'), 'GAME: playableCivIds should be expanded into individual playable_civ_N fields');
  // Playable civ count field must be present
  assert.equal(map.get('number_of_playable_civs'), '3', 'GAME: expected number_of_playable_civs');
  // Time scale: individual section fields must be present (7 slots, all 0 in fixture)
  assert.equal(map.get('turns_in_time_section_0'), '0', 'GAME: expected turns_in_time_section_0');
  assert.equal(map.get('turns_in_time_section_6'), '0', 'GAME: expected turns_in_time_section_6');
  assert.equal(map.get('time_per_turn_in_time_section_0'), '0', 'GAME: expected time_per_turn_in_time_section_0');
  // victoryConditionsAndRules=7 means bits 0,1,2 set: domination, spaceRace, diplomactic
  assert.equal(map.get('dominationEnabled'), '1', 'GAME: expected dominationEnabled=1 for vcr=7');
  assert.equal(map.get('spaceRaceEnabled'), '1', 'GAME: expected spaceRaceEnabled=1 for vcr=7');
  assert.equal(map.get('diplomacticEnabled'), '1', 'GAME: expected diplomacticEnabled=1 for vcr=7');
  assert.equal(map.get('conquestEnabled'), '0', 'GAME: expected conquestEnabled=0 for vcr=7');
});

test('GAME parser emits Victory Point Limits panel fields', () => {
  const reg = SECTION_REGISTRY.GAME;
  const io = makeIo();
  const w = new BiqWriter();
  // Head
  w.writeInt(0);   // useDefaultRules
  w.writeInt(0);   // defaultVictoryConditions
  w.writeInt(2);   // numPlayableCivs
  w.writeInt(1);   // playableCivIds[0]
  w.writeInt(2);   // playableCivIds[1]
  w.writeInt(0);   // victoryConditionsAndRules
  // 11 scalars (placeCaptureUnits..turnTimeLimit)
  for (let i = 0; i < 11; i++) w.writeInt(0);
  // 7 turnsPerTimescale + 7 timeUnitsPerTurn
  for (let i = 0; i < 14; i++) w.writeInt(0);
  // 5200 scenario search folders
  w.writeBytes(Buffer.alloc(5200));
  // civPartOfWhichAlliance (2 civs)
  w.writeInt(4); w.writeInt(4);
  // 13 VP ints: victoryPointLimit=500, cityEliminationCount=10, oneCityCultureWinLimit=200,
  //             allCitiesCultureWinLimit=1000, dominationTerrainPercent=66, dominationPopulationPercent=50,
  //             wonderVP=5, defeatingOpposingUnitVP=2, advancementVP=3, cityConquestVP=4, victoryPointVP=6,
  //             captureSpecialUnitVP=7, questionMark1=0
  w.writeInt(500); w.writeInt(10); w.writeInt(200); w.writeInt(1000);
  w.writeInt(66); w.writeInt(50);
  w.writeInt(5); w.writeInt(2); w.writeInt(3); w.writeInt(4); w.writeInt(6); w.writeInt(7);
  w.writeInt(0); // questionMark1
  w.writeByte(0); // questionMark2
  // 5 alliance names (256 bytes each)
  for (let i = 0; i < 5; i++) w.writeBytes(Buffer.alloc(256));
  // warWith (25 ints)
  for (let i = 0; i < 25; i++) w.writeInt(0);
  w.writeInt(0); // allianceVictoryType
  w.writeBytes(Buffer.alloc(260)); // plaugeName
  w.writeByte(0); // permitPlagues
  for (let i = 0; i < 6; i++) w.writeInt(0); // plague scalars
  w.writeInt(0); // questionMark3
  w.writeBytes(Buffer.alloc(260)); // unknown
  w.writeInt(1); // respawnFlagUnits
  w.writeByte(1); // captureAnyFlag
  w.writeInt(99); // goldForCapture
  w.writeByte(0); // mapVisible
  w.writeByte(0); // retainCulture
  w.writeInt(0); // questionMark4
  w.writeInt(0); // eruptionPeriod
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.victoryPointLimit, 500);
  assert.equal(rec.cityEliminationCount, 10);
  assert.equal(rec.dominationTerrainPercent, 66);
  assert.equal(rec.dominationPopulationPercent, 50);
  assert.equal(rec.wonderVP, 5);
  assert.equal(rec.advancementVP, 3);
  assert.equal(rec.respawnFlagUnits, 1);
  assert.equal(rec.captureAnyFlag, 1);
  assert.equal(rec.goldForCapture, 99);

  const english = sectionToEnglish({ index: 0, ...rec }, 'GAME', io);
  assertNoGenericFields(english, 'GAME VP');
  const map = parseEnglish(english);
  assert.equal(map.get('victoryPointLimit'), '500', 'GAME: victoryPointLimit must appear in english output');
  assert.equal(map.get('cityEliminationCount'), '10', 'GAME: cityEliminationCount must appear');
  assert.equal(map.get('oneCityCultureWinLimit'), '200', 'GAME: oneCityCultureWinLimit must appear');
  assert.equal(map.get('allCitiesCultureWinLimit'), '1000', 'GAME: allCitiesCultureWinLimit must appear');
  assert.equal(map.get('dominationTerrainPercent'), '66', 'GAME: dominationTerrainPercent must appear');
  assert.equal(map.get('dominationPopulationPercent'), '50', 'GAME: dominationPopulationPercent must appear');
  assert.equal(map.get('wonderVP'), '5', 'GAME: wonderVP must appear');
  assert.equal(map.get('defeatingOpposingUnitVP'), '2', 'GAME: defeatingOpposingUnitVP must appear');
  assert.equal(map.get('advancementVP'), '3', 'GAME: advancementVP must appear');
  assert.equal(map.get('cityConquestVP'), '4', 'GAME: cityConquestVP must appear');
  assert.equal(map.get('victoryPointVP'), '6', 'GAME: victoryPointVP must appear');
  assert.equal(map.get('captureSpecialUnitVP'), '7', 'GAME: captureSpecialUnitVP must appear');
  assert.equal(map.get('respawnFlagUnits'), '1', 'GAME: respawnFlagUnits must appear');
  assert.equal(map.get('captureAnyFlag'), '1', 'GAME: captureAnyFlag must appear');
  assert.equal(map.get('goldForCapture'), '99', 'GAME: goldForCapture must appear');
});

test('GAME parser emits Disasters panel fields (plague + volcano)', () => {
  const reg = SECTION_REGISTRY.GAME;
  const io = makeIo();
  const w = new BiqWriter();
  // Head + fixed fields (minimal, all zeros)
  w.writeInt(0); w.writeInt(0); w.writeInt(0); // useDefaultRules, defaultVictoryConditions, numPlayableCivs
  w.writeInt(0); // victoryConditionsAndRules
  for (let i = 0; i < 11 + 14; i++) w.writeInt(0); // scalars + timescale
  w.writeBytes(Buffer.alloc(5200)); // search folders
  // No civPartOfWhichAlliance (numPlayableCivs=0)
  // 13 VP ints + questionMark1
  for (let i = 0; i < 13; i++) w.writeInt(0);
  w.writeByte(0); // questionMark2
  for (let i = 0; i < 5; i++) w.writeBytes(Buffer.alloc(256)); // alliance names
  for (let i = 0; i < 25; i++) w.writeInt(0); // warWith
  w.writeInt(0); // allianceVictoryType
  // plaugeName: "Black Death"
  const pName = Buffer.alloc(260, 0);
  Buffer.from('Black Death', 'latin1').copy(pName);
  w.writeBytes(pName);
  w.writeByte(1); // permitPlagues = true
  w.writeInt(20);  // plagueEarliestStart
  w.writeInt(5);   // plagueVariation
  w.writeInt(8);   // plagueDuration
  w.writeInt(3);   // plagueStrength
  w.writeInt(10);  // plagueGracePeriod
  w.writeInt(2);   // plagueMaxOccurance
  w.writeInt(0);   // questionMark3
  w.writeBytes(Buffer.alloc(260)); // unknown
  w.writeInt(0); w.writeByte(0); w.writeInt(0); // respawnFlagUnits, captureAnyFlag, goldForCapture
  w.writeByte(0); w.writeByte(0); // mapVisible, retainCulture
  w.writeInt(0);   // questionMark4
  w.writeInt(15);  // eruptionPeriod
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.permitPlagues, 1);
  assert.equal(rec.plaugeName, 'Black Death');
  assert.equal(rec.plagueEarliestStart, 20);
  assert.equal(rec.plagueDuration, 8);
  assert.equal(rec.eruptionPeriod, 15);

  const english = sectionToEnglish({ index: 0, ...rec }, 'GAME', io);
  assertNoGenericFields(english, 'GAME Disasters');
  const map = parseEnglish(english);
  assert.equal(map.get('permitPlagues'), '1', 'GAME: permitPlagues must appear in english output');
  assert.equal(map.get('plaugeName'), 'Black Death', 'GAME: plaugeName must appear');
  assert.equal(map.get('plagueEarliestStart'), '20', 'GAME: plagueEarliestStart must appear');
  assert.equal(map.get('plagueVariation'), '5', 'GAME: plagueVariation must appear');
  assert.equal(map.get('plagueDuration'), '8', 'GAME: plagueDuration must appear');
  assert.equal(map.get('plagueStrength'), '3', 'GAME: plagueStrength must appear');
  assert.equal(map.get('plagueGracePeriod'), '10', 'GAME: plagueGracePeriod must appear');
  assert.equal(map.get('plagueMaxOccurance'), '2', 'GAME: plagueMaxOccurance must appear');
  assert.equal(map.get('eruptionPeriod'), '15', 'GAME: eruptionPeriod must appear');
});

test('GAME parser emits MP timer fields only when minorVersion >= 7', () => {
  const reg = SECTION_REGISTRY.GAME;

  function buildMinimalGame(w) {
    w.writeInt(0); w.writeInt(0); w.writeInt(0); w.writeInt(0); // head
    for (let i = 0; i < 11 + 14; i++) w.writeInt(0);
    w.writeBytes(Buffer.alloc(5200));
    for (let i = 0; i < 13; i++) w.writeInt(0); // VP ints
    w.writeByte(0);
    for (let i = 0; i < 5; i++) w.writeBytes(Buffer.alloc(256));
    for (let i = 0; i < 25; i++) w.writeInt(0);
    w.writeInt(0); w.writeBytes(Buffer.alloc(260)); w.writeByte(0);
    for (let i = 0; i < 6; i++) w.writeInt(0);
    w.writeInt(0); w.writeBytes(Buffer.alloc(260));
    w.writeInt(0); w.writeByte(0); w.writeInt(0);
    w.writeByte(0); w.writeByte(0); w.writeInt(0); w.writeInt(0);
  }

  // With minorVersion >= 7: mp fields present
  const w1 = new BiqWriter();
  buildMinimalGame(w1);
  w1.writeInt(300); w1.writeInt(400); w1.writeInt(500); // mpBaseTime, mpCityTime, mpUnitTime
  const io7 = makeIo({ minorVersion: 7 });
  const rec7 = reg.parse(w1.toBuffer(), io7);
  assert.equal(rec7.mpBaseTime, 300);
  assert.equal(rec7.mpCityTime, 400);
  assert.equal(rec7.mpUnitTime, 500);
  const map7 = parseEnglish(sectionToEnglish({ index: 0, ...rec7 }, 'GAME', io7));
  assert.equal(map7.get('mpBaseTime'), '300', 'GAME: mpBaseTime must appear when minorVersion >= 7');
  assert.equal(map7.get('mpCityTime'), '400', 'GAME: mpCityTime must appear when minorVersion >= 7');
  assert.equal(map7.get('mpUnitTime'), '500', 'GAME: mpUnitTime must appear when minorVersion >= 7');

  // With minorVersion < 7: mp fields absent
  const w2 = new BiqWriter();
  buildMinimalGame(w2);
  const io6 = makeIo({ minorVersion: 6 });
  const rec6 = reg.parse(w2.toBuffer(), io6);
  const map6 = parseEnglish(sectionToEnglish({ index: 0, ...rec6 }, 'GAME', io6));
  assert.ok(!map6.has('mpBaseTime'), 'GAME: mpBaseTime must NOT appear when minorVersion < 7');
});

test('GAME serialization roundtrip preserves all Conquests tail fields', () => {
  const reg = SECTION_REGISTRY.GAME;
  const io = makeIo({ minorVersion: 8 });
  const w = new BiqWriter();
  w.writeInt(1);   // useDefaultRules
  w.writeInt(0);   // defaultVictoryConditions
  w.writeInt(2);   // numPlayableCivs
  w.writeInt(7); w.writeInt(9); // playableCivIds
  w.writeInt(3);   // victoryConditionsAndRules
  for (let i = 0; i < 11; i++) w.writeInt(i); // scalars
  for (let i = 0; i < 14; i++) w.writeInt(i + 1); // timescale arrays
  w.writeBytes(Buffer.alloc(5200)); // search folders
  w.writeInt(1); w.writeInt(2); // civPartOfWhichAlliance
  // VP fields with known values
  w.writeInt(750); w.writeInt(5); w.writeInt(300); w.writeInt(2000);
  w.writeInt(55); w.writeInt(45);
  w.writeInt(10); w.writeInt(3); w.writeInt(4); w.writeInt(6); w.writeInt(8); w.writeInt(9);
  w.writeInt(42); // questionMark1
  w.writeByte(1);  // questionMark2
  // alliance names
  const names = ['Romans', 'Barbarians', 'Greeks', 'Persians', ''];
  for (const name of names) {
    const buf = Buffer.alloc(256, 0);
    Buffer.from(name, 'latin1').copy(buf);
    w.writeBytes(buf);
  }
  for (let i = 0; i < 25; i++) w.writeInt(i % 2); // warWith
  w.writeInt(2); // allianceVictoryType
  const pn = Buffer.alloc(260, 0); Buffer.from('Plague', 'latin1').copy(pn); w.writeBytes(pn);
  w.writeByte(1); // permitPlagues
  w.writeInt(15); w.writeInt(3); w.writeInt(6); w.writeInt(2); w.writeInt(8); w.writeInt(1);
  w.writeInt(0); // questionMark3
  w.writeBytes(Buffer.alloc(260));
  w.writeInt(1); // respawnFlagUnits
  w.writeByte(1); // captureAnyFlag
  w.writeInt(50); // goldForCapture
  w.writeByte(1); // mapVisible
  w.writeByte(1); // retainCulture
  w.writeInt(0);  // questionMark4
  w.writeInt(20); // eruptionPeriod
  w.writeInt(100); w.writeInt(200); w.writeInt(300); // mpBaseTime, mpCityTime, mpUnitTime
  const original = w.toBuffer();

  const rec = reg.parse(original, io);
  const reserialized = reg.serialize(rec, io);
  const rec2 = reg.parse(reserialized, io);

  assert.equal(rec2.victoryPointLimit, 750, 'roundtrip: victoryPointLimit');
  assert.equal(rec2.cityEliminationCount, 5, 'roundtrip: cityEliminationCount');
  assert.equal(rec2.dominationTerrainPercent, 55, 'roundtrip: dominationTerrainPercent');
  assert.equal(rec2.wonderVP, 10, 'roundtrip: wonderVP');
  assert.equal(rec2.alliance0, 'Romans', 'roundtrip: alliance0');
  assert.equal(rec2.alliance1, 'Barbarians', 'roundtrip: alliance1');
  assert.equal(rec2.allianceVictoryType, 2, 'roundtrip: allianceVictoryType');
  assert.equal(rec2.plaugeName, 'Plague', 'roundtrip: plaugeName');
  assert.equal(rec2.permitPlagues, 1, 'roundtrip: permitPlagues');
  assert.equal(rec2.plagueEarliestStart, 15, 'roundtrip: plagueEarliestStart');
  assert.equal(rec2.eruptionPeriod, 20, 'roundtrip: eruptionPeriod');
  assert.equal(rec2.mapVisible, 1, 'roundtrip: mapVisible');
  assert.equal(rec2.retainCulture, 1, 'roundtrip: retainCulture');
  assert.equal(rec2.mpBaseTime, 100, 'roundtrip: mpBaseTime');
  assert.equal(rec2.mpCityTime, 200, 'roundtrip: mpCityTime');
  assert.equal(rec2.mpUnitTime, 300, 'roundtrip: mpUnitTime');
  assert.equal(reserialized.length, original.length, 'roundtrip: serialized length must match original');
});

// ---------------------------------------------------------------------------
// UNIT
// ---------------------------------------------------------------------------

test('UNIT parser produces human-readable fields including PTW+ customName', () => {
  const reg = SECTION_REGISTRY.UNIT;
  const io = makeIo(); // isPTWPlus = true (BICX majorVersion 12 >= 2)
  const w = new BiqWriter();
  w.writeBytes(ws('Warrior', 32));  // name
  w.writeInt(1);  // ownerType
  w.writeInt(2);  // experienceLevel
  w.writeInt(3);  // owner
  w.writeInt(5);  // pRTONumber
  w.writeInt(0);  // AIStrategy
  w.writeInt(10); // x
  w.writeInt(20); // y
  // PTW+: customName (57 bytes) + useCivilizationKing (4)
  w.writeBytes(ws('Legionary', 57));
  w.writeInt(1);  // useCivilizationKing
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.name, 'Warrior');
  assert.equal(rec.pRTONumber, 5);
  assert.equal(rec.customName, 'Legionary');
  assert.equal(rec.useCivilizationKing, 1);

  const english = sectionToEnglish({ index: 0, ...rec }, 'UNIT', io);
  assertNoGenericFields(english, 'UNIT');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Warrior');
  assert.equal(map.get('x'), '10');
  assert.equal(map.get('y'), '20');
  assert.equal(map.get('pRTONumber'), '5');
  assert.equal(map.get('customName'), 'Legionary', 'UNIT: expected customName (PTW+)');
  assert.equal(map.get('useCivilizationKing'), '1', 'UNIT: expected useCivilizationKing (PTW+)');
});

// ---------------------------------------------------------------------------
// TILE
// ---------------------------------------------------------------------------

test('TILE toEnglish produces human-readable fields (xpos, ypos, baseRealTerrain)', () => {
  const reg = SECTION_REGISTRY.TILE;
  const io = makeIo({ mapWidth: 80 });

  // Build a synthetic raw TILE record: 4-byte dataLen + 45-byte body
  const body = Buffer.alloc(45, 0);
  // Set baseRealTerrain at off=11 = terrain type 2 (Plains)
  body[11] = 2;
  // Set fogOfWar at off=37 (int16LE) = 1
  body.writeInt16LE(1, 37);
  // Set resource at off=2 (int32LE) = 5
  body.writeInt32LE(5, 2);

  const rawRecord = Buffer.allocUnsafe(49);
  rawRecord.writeUInt32LE(45, 0);
  body.copy(rawRecord, 4);

  // Simulate parseTILE result (fields from raw record + xpos/ypos)
  const tileIndex = 5;
  const half = Math.floor(80 / 2);  // 40
  const yPos = Math.floor(tileIndex / half); // 0
  const xPos = (tileIndex % half) * 2 + (yPos & 1); // 10

  const fakeTileRec = { index: tileIndex, xpos: xPos, ypos: yPos, baseRealTerrain: 2, fogOfWar: 1, resource: 5, _rawRecord: rawRecord };

  const english = reg.toEnglish(fakeTileRec, io);
  assertNoGenericFields(english, 'TILE');
  const map = parseEnglish(english);
  assert.equal(map.get('xpos'), String(xPos));
  assert.equal(map.get('ypos'), String(yPos));
  assert.equal(map.get('baseRealTerrain'), '2');
  assert.equal(map.get('fogOfWar'), '1');
  assert.equal(map.get('resource'), '5');
});

// ---------------------------------------------------------------------------
// CONT / SLOC / CLNY — fixed-size sections
// ---------------------------------------------------------------------------

test('CONT parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.CONT;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(1);    // continentClass
  w.writeInt(500);  // numTiles
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.continentClass, 1);
  assert.equal(rec.numTiles, 500);

  const english = sectionToEnglish({ index: 0, ...rec }, 'CONT', io);
  assertNoGenericFields(english, 'CONT');
  const map = parseEnglish(english);
  assert.equal(map.get('continentClass'), '1');
  assert.equal(map.get('numTiles'), '500');
});

test('SLOC parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.SLOC;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(1);  // ownerType
  w.writeInt(2);  // owner
  w.writeInt(10); // x
  w.writeInt(20); // y
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.ownerType, 1);
  assert.equal(rec.x, 10);
  assert.equal(rec.y, 20);

  const english = sectionToEnglish({ index: 0, ...rec }, 'SLOC', io);
  assertNoGenericFields(english, 'SLOC');
  const map = parseEnglish(english);
  assert.equal(map.get('x'), '10');
  assert.equal(map.get('y'), '20');
});

test('CLNY parser produces human-readable fields', () => {
  const reg = SECTION_REGISTRY.CLNY;
  const io = makeIo();
  const w = new BiqWriter();
  w.writeInt(1);  // ownerType
  w.writeInt(3);  // owner
  w.writeInt(4);  // x
  w.writeInt(8);  // y
  w.writeInt(2);  // improvementType
  const data = w.toBuffer();

  const rec = reg.parse(data, io);
  assert.equal(rec.improvementType, 2);
  assert.equal(rec.x, 4);

  const english = sectionToEnglish({ index: 0, ...rec }, 'CLNY', io);
  assertNoGenericFields(english, 'CLNY');
  const map = parseEnglish(english);
  assert.equal(map.get('improvementType'), '2');
});

test('CLNY fixed-size serialization preserves improvementType in Conquests record layout', () => {
  const io = makeIo();
  const section = {
    code: 'CLNY',
    records: [
      {
        index: 0,
        ownerType: 1,
        owner: 3,
        x: 4,
        y: 8,
        improvementType: 2
      }
    ]
  };
  const buf = serializeSection(section, io);
  assert.equal(buf.readUInt32LE(4), 1, 'expected one CLNY record');
  assert.equal(buf.length, 8 + 24, 'expected Conquests CLNY record to include 4-byte length prefix plus 20-byte body');
  assert.equal(buf.readUInt32LE(8), 20, 'expected CLNY dataLength to remain 20 in Conquests layout');
  assert.equal(buf.readInt32LE(28), 2, 'expected improvementType to remain present at the end of the CLNY body');
});

// ---------------------------------------------------------------------------
// FLAV toEnglish
// ---------------------------------------------------------------------------

test('FLAV toEnglish produces human-readable fields', () => {
  const io = makeIo();
  const flavRec = {
    index: 0,
    name: 'Militaristic',
    questionMark: 0,
    numRelations: 3,
    relations: [10, -5, 2],
  };

  const english = sectionToEnglish(flavRec, 'FLAV', io);
  assertNoGenericFields(english, 'FLAV');
  const map = parseEnglish(english);
  assert.equal(map.get('name'), 'Militaristic');
  assert.equal(map.get('relation_with_flavor_0'), '10');
  assert.equal(map.get('relation_with_flavor_1'), '-5');
  assertNameNotFallback(flavRec, 'FLAV');
});

// ---------------------------------------------------------------------------
// writableKeys: all registered sections must return non-empty writable keys
// (ensures the UI can expose editable fields)
// ---------------------------------------------------------------------------

test('all registered sections return writable keys', () => {
  const expectedNonEmpty = [
    'TECH', 'BLDG', 'GOOD', 'GOVT', 'RACE', 'PRTO', 'CTZN', 'CULT', 'DIFF', 'ERAS',
    'ESPN', 'EXPR', 'TFRM', 'WSIZ', 'WCHR', 'WMAP', 'TERR', 'RULE', 'LEAD',
    'CITY', 'UNIT', 'GAME', 'TILE', 'CONT', 'SLOC', 'CLNY', 'FLAV'
  ];
  for (const code of expectedNonEmpty) {
    const keys = sectionWritableKeys(code);
    assert.ok(Array.isArray(keys) && keys.length > 0, `${code}: expected non-empty writableKeys`);
  }
});

// ---------------------------------------------------------------------------
// sectionRecordName: fallback "CODE N" only when name and civKey are absent
// ---------------------------------------------------------------------------

test('sectionRecordName falls back to "CODE N+1" only when name and civKey absent', () => {
  // With name
  assert.equal(sectionRecordName({ index: 0, name: 'Foo' }, 'TERR'), 'Foo');
  // With civKey only
  assert.equal(sectionRecordName({ index: 0, civilopediaEntry: 'TERR_PLAINS' }, 'TERR'), 'TERR_PLAINS');
  // With both (name wins)
  assert.equal(sectionRecordName({ index: 0, name: 'Plains', civilopediaEntry: 'TERR_PLAINS' }, 'TERR'), 'Plains');
  // Fallback: no name or civKey
  assert.equal(sectionRecordName({ index: 0 }, 'TERR'), 'TERR 1');
  assert.equal(sectionRecordName({ index: 4 }, 'DIFF'), 'DIFF 5');
});
