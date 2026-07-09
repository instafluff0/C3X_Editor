'use strict';

/**
 * Catalog parity tests — hardcoded against three fixed BIQs.
 *
 * Assumption: the BIQ files and their art assets will NEVER change.
 * If counts or keys below stop matching, that's a regression.
 *
 * Scenarios under test:
 *   BASE   — Conquests/conquests.biq  (Standard Game / global mode)
 *   SENGOKU — Conquests/Conquests/7 Sengoku - Sword of the Shogun.biq
 *   TIDES  — Conquests/Scenarios/TIDES OF CRIMSON.biq
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle } = require('../src/configCore');

const CIV3 = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');

const SENGOKU_BIQ    = path.join(CIV3, 'Conquests', 'Conquests', '7 Sengoku - Sword of the Shogun.biq');
const TIDES_BIQ      = path.join(CIV3, 'Conquests', 'Scenarios', 'TIDES OF CRIMSON.biq');
const MESOPOTAMIA_BIQ = path.join(CIV3, 'Conquests', 'Conquests', '1 Mesopotamia.biq');
const MESO_BIQ       = path.join(CIV3, 'Conquests', 'Conquests', '5 Mesoamerica.biq');

const SENGOKU_DIR = path.join(CIV3, 'Conquests', 'Conquests', 'Sengoku');
const TIDES_DIR   = path.join(CIV3, 'Conquests', 'Scenarios', 'Tides of Crimson');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getField(entry, key) {
  return (entry.biqFields || []).find(
    (f) => String(f.baseKey || f.key || '').toLowerCase() === key.toLowerCase()
  ) || null;
}

function fv(entry, key) {
  const f = getField(entry, key);
  return f ? f.value : null;
}

function keys(tab) {
  return (tab.entries || []).map((e) => e.civilopediaKey);
}

function iconExists(iconPath, ...roots) {
  return roots.some((r) => {
    try { return fs.existsSync(path.join(r, iconPath)); } catch (_) { return false; }
  });
}

function isTidesScenarioRoot(rootPath) {
  const name = path.basename(String(rootPath || '')).trim().toLowerCase();
  return name === 'tides of crimson' || /^tides of crimson(?:\s+copy|\s+2\.\d+)?$/.test(name);
}

function getTidesArtRoots() {
  const roots = (getTides().scenarioSearchPaths || [])
    .map((p) => path.resolve(p))
    .filter(Boolean);
  const fallback = path.resolve(TIDES_DIR);
  if (!roots.includes(fallback)) roots.push(fallback);
  return roots;
}

// ---------------------------------------------------------------------------
// Cached bundles (loaded once per suite)
// ---------------------------------------------------------------------------

let _base, _seng, _tides, _mesopotamia, _meso;

function getBase()  { return _base  || (_base  = loadBundle({ mode: 'global',   civ3Path: CIV3 })); }
function getSeng()  { return _seng  || (_seng  = loadBundle({ mode: 'scenario', civ3Path: CIV3, scenarioPath: SENGOKU_BIQ })); }
function getTides() { return _tides || (_tides = loadBundle({ mode: 'scenario', civ3Path: CIV3, scenarioPath: TIDES_BIQ })); }
function getMesopotamia() { return _mesopotamia || (_mesopotamia = loadBundle({ mode: 'scenario', civ3Path: CIV3, scenarioPath: MESOPOTAMIA_BIQ })); }
function getMeso()  { return _meso  || (_meso  = loadBundle({ mode: 'scenario', civ3Path: CIV3, scenarioPath: MESO_BIQ })); }

// ============================================================================
// BASE GAME (Standard Game / global mode)
// ============================================================================

test('base game loads without error', () => {
  const b = getBase();
  assert.equal(b.biq.error, undefined, `BIQ error: ${b.biq.error}`);
  assert.ok(b.biq.sections.length > 0, 'Expected BIQ sections to be populated');
});

// --- Counts -----------------------------------------------------------------

test('base game civ count is exactly 32', () => {
  assert.equal(getBase().tabs.civilizations.entries.length, 32);
});
test('base game tech count is exactly 83', () => {
  assert.equal(getBase().tabs.technologies.entries.length, 83);
});
test('base game resource count is exactly 26', () => {
  assert.equal(getBase().tabs.resources.entries.length, 26);
});
test('base game improvement count is exactly 83', () => {
  assert.equal(getBase().tabs.improvements.entries.length, 83);
});
test('base game government count is exactly 8', () => {
  assert.equal(getBase().tabs.governments.entries.length, 8);
});
test('base game unit count is exactly 136', () => {
  assert.equal(getBase().tabs.units.entries.length, 136);
});

// --- Complete key sets -------------------------------------------------------

const BASE_CIVS = [
  'RACE_AMERICAN','RACE_ARABS','RACE_AZTECS','RACE_BABYLON','RACE_BYZANTINES',
  'RACE_CARTHAGINIANS','RACE_CELTS','RACE_CHINESE','RACE_EGYPTIANS','RACE_ENGLISH',
  'RACE_FRENCH','RACE_GERMANS','RACE_GREEKS','RACE_HATTI','RACE_INCANS',
  'RACE_INDIAN','RACE_IROQUOIS','RACE_JAPANESE','RACE_KOREANS','RACE_MAYANS',
  'RACE_MONGOLS','RACE_DUTCH','RACE_OTTOMANS','RACE_PERSIAN','RACE_PORTUGAL',
  'RACE_ROMANS','RACE_RUSSIAN','RACE_VIKINGS','RACE_SPANISH','RACE_SUMERIA',
  'RACE_ZULU'
];

const BASE_TECHS = [
  'TECH_ADVANCED_FLIGHT','TECH_ALPHABET','TECH_AMPHIBIOUS_WARFARE','TECH_ASTRONOMY',
  'TECH_ATOMIC_THEORY','TECH_BANKING','TECH_BRONZE_WORKING','TECH_CEREMONIAL_BURIAL',
  'TECH_CHEMISTRY','TECH_CHIVALRY','TECH_CODE_OF_LAWS','TECH_COMBUSTION',
  'TECH_COMMUNISM','TECH_COMPUTERS','TECH_CONSTRUCTION','TECH_CURRENCY',
  'TECH_DEMOCRACY','TECH_ECOLOGY','TECH_ECONOMICS','TECH_EDUCATION',
  'TECH_ELECTRICITY','TECH_ELECTRONICS','TECH_ENGINEERING','TECH_ESPIONAGE',
  'TECH_FASCISM','TECH_FEUDALISM','TECH_FISSION','TECH_FLIGHT',
  'TECH_FREE_ARTISTRY','TECH_GENETICS','TECH_GUNPOWDER','TECH_HORSEBACK_RIDING',
  'TECH_INDUSTRIALIZATION','TECH_INTEGRATED_DEFENSE','TECH_INVENTION','TECH_IRON_WORKING',
  'TECH_IRONCLADS','TECH_LITERATURE','TECH_MAGNETISM','TECH_MAP_MAKING',
  'TECH_MASONRY','TECH_MASS_PRODUCTION','TECH_MATHEMATICS','TECH_MEDICINE',
  'TECH_METALLURGY','TECH_MILITARY_TRADITION','TECH_MINIATURIZATION','TECH_MONARCHY',
  'TECH_MONOTHEISM','TECH_MOTORIZED_TRANSPORTATION','TECH_MUSIC_THEORY','TECH_MYSTICISM',
  'TECH_NATIONALISM','TECH_NAVIGATION','TECH_NUCLEAR_POWER','TECH_PHILOSOPHY',
  'TECH_PHYSICS','TECH_POLYTHEISM','TECH_POTTERY','TECH_PRINTING_PRESS',
  'TECH_RECYCLING','TECH_REFINING','TECH_REPLACEABLE_PARTS','TECH_ROBOTICS',
  'TECH_ROCKETRY','TECH_SANITATION','TECH_SATELLITES','TECH_SCIENTIFIC_METHOD',
  'TECH_SMART_WEAPONS','TECH_SPACE_FLIGHT','TECH_STEALTH','TECH_STEAM_POWER',
  'TECH_STEEL','TECH_SUPERCONDUCTOR','TECH_SYNTHETIC_FIBERS','TECH_THE_CORPORATION',
  'TECH_THE_LASER','TECH_THE_REPUBLIC','TECH_THE_WHEEL','TECH_THEOLOGY',
  'TECH_THEORY_OF_GRAVITY','TECH_WARRIOR_CODE','TECH_WRITING'
];

const BASE_RESOURCES = [
  'GOOD_ALUMINUM','GOOD_CATTLE','GOOD_COAL','GOOD_DYE','GOOD_FISH',
  'GOOD_FURS','GOOD_GAME','GOOD_DIAMONDS','GOOD_GOLD','GOOD_HORSES',
  'GOOD_INCENSE','GOOD_IRON','GOOD_IVORY','GOOD_OASIS','GOOD_OIL',
  'GOOD_RUBBER','GOOD_SALTPETER','GOOD_SILK','GOOD_SPICE','GOOD_SUGAR',
  'GOOD_TOBACCO','GOOD_BANANAS','GOOD_URANIUM','GOOD_WHALES','GOOD_WHEAT',
  'GOOD_WINE'
];

const BASE_IMPROVEMENTS = [
  'BLDG_AIRPORT','BLDG_APOLLO_PROJECT','BLDG_AQUEDUCT','BLDG_BANK','BLDG_BARRACKS',
  'BLDG_BATTLEFIELD_MEDICINE','BLDG_CATHEDRAL','BLDG_CIVIL_DEFENSE','BLDG_COAL_PLANT',
  'BLDG_COASTAL_FORTRESS','BLDG_COLOSSEUM','BLDG_COMMERCIAL_DOCK','BLDG_SOLAR_SYSTEM',
  'BLDG_COURTHOUSE','BLDG_CURE_FOR_CANCER','BLDG_FACTORY','BLDG_FORBIDDEN_PALACE',
  'BLDG_GRANARY','BLDG_HARBOR','BLDG_EPIC','BLDG_HOOVER_DAM','BLDG_HOSPITAL',
  'BLDG_HYDRO_PLANT','BLDG_INTELLIGENCE_CENTER','BLDG_GREAT_IRONWORKS',
  'BLDG_GRAND_CATHEDRAL','BLDG_KNIGHTS_TEMPLAR',"BLDG_INVENTOR'S_WORKSHOP",
  'BLDG_LIBRARY','BLDG_LONGEVITY','BLDG_CIRCUMNAVIGATION','BLDG_MANUFACTURING_PLANT',
  'BLDG_MARKETPLACE','BLDG_MASS_TRANSIT_SYSTEM','BLDG_MILITARY_ACADEMY',
  'BLDG_GREAT_UNIVERSITY','BLDG_NUCLEAR_PLANT','BLDG_OFFSHORE_PLATFORM','BLDG_PALACE',
  'BLDG_POLICE_STATION','BLDG_RECYCLING_CENTER','BLDG_LAB','BLDG_SAM_MISSILE_BATTERY',
  'BLDG_SECRET_POLICE_HQ','BLDG_SETI_PROGRAM','BLDG_GREAT_PLAYHOUSE',
  'BLDG_SISTINE_CHAPEL','BLDG_TRADING_COMPANY','BLDG_SOLAR_PLANT',
  'BLDG_SS_COCKPIT','BLDG_SS_LANDING_DOCKING_BAY','BLDG_SS_ENGINE',
  'BLDG_SS_EXTERIOR_CASING','BLDG_SS_FUEL_CELLS','BLDG_SS_LIFE_SUPPORT_SYSTEM',
  'BLDG_SS_PLANETARY_PARTY_LOUNGE','BLDG_SS_STASIS_CHAMBER','BLDG_SS_STORAGE_SUPPLY',
  'BLDG_SS_THRUSTERS','BLDG_STOCK_EXCHANGE','BLDG_SDI','BLDG_ART_OF_WAR',
  'BLDG_TEMPLE','BLDG_COLOSSUS','BLDG_GREAT_LIBRARY','BLDG_LIGHTHOUSE',
  'BLDG_GREAT_WALL','BLDG_HANGING_GARDENS','BLDG_INTERNET','BLDG_MANHATTAN_PROJECT',
  'BLDG_MAUSOLEUM','BLDG_ORACLE','BLDG_PENTAGON','BLDG_PYRAMIDS','BLDG_ZEUS',
  'BLDG_ARTEMIS','BLDG_UNITED_NATIONS','BLDG_THEORY_OF_EVOLUTION',
  'BLDG_UNIVERSAL_SUFFRAGE','BLDG_UNIVERSITY','BLDG_WALL_STREET','BLDG_WALLS',
  'BLDG_WEALTH'
];

const BASE_GOVTS = [
  'GOVT_ANARCHY','GOVT_COMMUNISM','GOVT_DEMOCRACY','GOVT_DESPOTISM',
  'GOVT_FASCISM','GOVT_FEUDALISM','GOVT_MONARCHY','GOVT_REPUBLIC'
];

const BASE_UNITS = [
  'PRTO_ABU','PRTO_AEGIS_CRUISER','PRTO_ALEXANDER','PRTO_ANCIENT_CAVALRY',
  'PRTO_ANSAR_WARRIOR','PRTO_ARCHER','PRTO_ARMY','PRTO_ARMY_ERAS_ANCIENT_TIMES',
  'PRTO_ARMY_ERAS_INDUSTRIAL_AGE','PRTO_ARMY_ERAS_MIDDLE_AGES','PRTO_ARMY_ERAS_MODERN_ERA',
  'PRTO_ARTILLERY','PRTO_BATTLESHIP','PRTO_BERSERK','PRTO_BISMARCK','PRTO_BOMBER',
  'PRTO_BOWMAN','PRTO_BRENNUS','PRTO_CAESAR','PRTO_CANNON','PRTO_CARAVEL',
  'PRTO_CARRACK','PRTO_CARRIER','PRTO_CATAPULT','PRTO_CATHERINE','PRTO_CAVALRY',
  'PRTO_CHARIOT','PRTO_CHASQUIS_SCOUT','PRTO_CLEOPATRA','PRTO_CONQUISTADOR',
  'PRTO_COSSACK','PRTO_CRUISE_MISSILE','PRTO_CRUISER','PRTO_CRUSADER','PRTO_CURRAGH',
  'PRTO_DESTROYER','PRTO_DROMON','PRTO_ELIZABETH','PRTO_ENKIDU_WARRIOR','PRTO_EXPLORER',
  'PRTO_F-15','PRTO_FIGHTER','PRTO_FLAK','PRTO_FRIGATE','PRTO_GALLEON','PRTO_GALLEY',
  'PRTO_GALLIC_SWORDSMAN','PRTO_GANDHI','PRTO_GILGAMESH','PRTO_GUERILLA',
  'PRTO_HAMMURABI','PRTO_HANNIBAL','PRTO_HELICOPTER','PRTO_HENRY','PRTO_HIAWATHA',
  'PRTO_HOPLITE','PRTO_HORSEMAN','PRTO_HWACHA','PRTO_ICBM','PRTO_IMMORTALS',
  'PRTO_IMPI','PRTO_INFANTRY','PRTO_IRONCLAD','PRTO_ISABELLA','PRTO_JAGUAR_WARRIOR',
  'PRTO_JAVELIN_THROWER','PRTO_JET_FIGHTER','PRTO_JOAN','PRTO_KESHIK','PRTO_KNIGHT',
  'PRTO_LEADER','PRTO_LEADER_ERAS_ANCIENT_TIMES','PRTO_LEADER_ERAS_INDUSTRIAL_AGE',
  'PRTO_LEADER_ERAS_MIDDLE_AGES','PRTO_LEADER_ERAS_MODERN_ERA','PRTO_LEGIONARY',
  'PRTO_LINCOLN','PRTO_LONGBOWMAN','PRTO_MAN-O-WAR','PRTO_MAO','PRTO_MARINE',
  'PRTO_MECH_INFANTRY','PRTO_MEDIEVAL_INFANTRY','PRTO_MOBILE_SAM','PRTO_MODERN_ARMOR',
  'PRTO_PARATROOPER','PRTO_MONTEZUMA','PRTO_MOUNTED_WARRIOR','PRTO_MURSILIS',
  'PRTO_MUSKETEER','PRTO_MUSKETMAN','PRTO_NUCLEAR_SUBMARINE','PRTO_LIBYAN_MERCENARY',
  'PRTO_OSMAN','PRTO_PACHACUTI','PRTO_PANZER','PRTO_WWII_PARATROOPER','PRTO_PIKEMAN',
  'PRTO_PRINCESS','PRTO_PRIVATEER','PRTO_RADAR_ARTILLERY','PRTO_RAGNAR','PRTO_RIDER',
  'PRTO_RIFLEMAN','PRTO_SAMURAI','PRTO_SCOUT','PRTO_SETTLER',
  'PRTO_SETTLER_ERAS_INDUSTRIAL_AGE','PRTO_SETTLER_ERAS_MODERN_ERA','PRTO_SHAKA',
  'PRTO_SIPAHI','PRTO_SMOKE-JAGUAR','PRTO_SPEARMAN','PRTO_STEALTH_BOMBER',
  'PRTO_STEALTH_FIGHTER','PRTO_SUBMARINE','PRTO_SWISS_MERCENARY','PRTO_SWORDSMAN',
  'PRTO_NUKE','PRTO_TANK','PRTO_TEMUJIN','PRTO_THEODORA','PRTO_THREE_MAN_CHARIOT',
  'PRTO_TOKUGAWA','PRTO_TOW_INFANTRY','PRTO_TRANSPORT','PRTO_TREBUCHET','PRTO_WANG',
  'PRTO_WAR_CHARIOT','PRTO_WAR_ELEPHANT','PRTO_WARRIOR','PRTO_WILLIAM_OF_ORANGE',
  'PRTO_WORKER','PRTO_WORKER_ERAS_INDUSTRIAL_AGE','PRTO_WORKER_ERAS_MODERN_ERA',
  'PRTO_XERXES'
];

test('base game has every expected civilization key', () => {
  const actual = new Set(keys(getBase().tabs.civilizations));
  BASE_CIVS.forEach((k) => assert.ok(actual.has(k), `Missing civ: ${k}`));
});

test('base game has every expected technology key', () => {
  const actual = new Set(keys(getBase().tabs.technologies));
  BASE_TECHS.forEach((k) => assert.ok(actual.has(k), `Missing tech: ${k}`));
});

test('base game has every expected resource key', () => {
  const actual = new Set(keys(getBase().tabs.resources));
  BASE_RESOURCES.forEach((k) => assert.ok(actual.has(k), `Missing resource: ${k}`));
});

test('base game has every expected improvement key', () => {
  const actual = new Set(keys(getBase().tabs.improvements));
  BASE_IMPROVEMENTS.forEach((k) => assert.ok(actual.has(k), `Missing improvement: ${k}`));
});

test('base game has every expected government key', () => {
  const actual = new Set(keys(getBase().tabs.governments));
  BASE_GOVTS.forEach((k) => assert.ok(actual.has(k), `Missing govt: ${k}`));
});

test('base game has every expected unit key', () => {
  const actual = new Set(keys(getBase().tabs.units));
  BASE_UNITS.forEach((k) => assert.ok(actual.has(k), `Missing unit: ${k}`));
});

// --- Spot field values -------------------------------------------------------

test('base game RACE_AMERICAN has correct leader and traits', () => {
  const b = getBase();
  const e = b.tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_AMERICAN');
  assert.ok(e, 'RACE_AMERICAN not found');
  assert.equal(e.name, 'America');
  assert.equal(fv(e, 'leadername'), 'Lincoln');
  assert.equal(fv(e, 'adjective'), 'American');
  assert.equal(fv(e, 'industrious'), 'true');
  assert.equal(fv(e, 'expansionist'), 'true');
  assert.equal(fv(e, 'militaristic'), 'false');
  assert.equal(fv(e, 'scientific'), 'false');
});

test('base game RACE_JAPANESE has correct leader and traits', () => {
  const e = getBase().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_JAPANESE');
  assert.ok(e, 'RACE_JAPANESE not found');
  assert.equal(fv(e, 'leadername'), 'Tokugawa');
  assert.equal(fv(e, 'militaristic'), 'true');
  assert.equal(fv(e, 'religious'), 'true');
  assert.equal(fv(e, 'industrious'), 'false');
});

test('base game TECH_ALPHABET has cost 5', () => {
  const e = getBase().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_ALPHABET');
  assert.ok(e, 'TECH_ALPHABET not found');
  assert.equal(fv(e, 'cost'), '5');
});

test('base game TECH_WRITING is present and projects flag bits', () => {
  const e = getBase().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_WRITING');
  assert.ok(e, 'TECH_WRITING not found');
  assert.equal(fv(e, 'enablesdiplomats'), 'true');
});

test('base game GOOD_IRON is Strategic type', () => {
  const e = getBase().tabs.resources.entries.find((x) => x.civilopediaKey === 'GOOD_IRON');
  assert.ok(e, 'GOOD_IRON not found');
  assert.equal(fv(e, 'type'), 'Strategic (2)');
});

test('base game BLDG_BARRACKS is a normal improvement', () => {
  const e = getBase().tabs.improvements.entries.find((x) => x.civilopediaKey === 'BLDG_BARRACKS');
  assert.ok(e, 'BLDG_BARRACKS not found');
  assert.equal(e.improvementKind, 'normal');
});

test('base game GOVT_DEMOCRACY has Minimal corruption', () => {
  const e = getBase().tabs.governments.entries.find((x) => x.civilopediaKey === 'GOVT_DEMOCRACY');
  assert.ok(e, 'GOVT_DEMOCRACY not found');
  assert.equal(fv(e, 'corruption'), 'Minimal (0)');
});

test('base game PRTO_WORKER has Worker animation name', () => {
  const e = getBase().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_WORKER');
  assert.ok(e, 'PRTO_WORKER not found');
  assert.equal(e.animationName, 'Worker');
});

// --- Art / iconPaths ---------------------------------------------------------

test('base game RACE_AMERICAN has 4 icon paths all resolvable under CIV3 root', () => {
  const e = getBase().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_AMERICAN');
  assert.ok(e, 'RACE_AMERICAN not found');
  assert.equal(e.iconPaths.length, 4);
  e.iconPaths.forEach((p) => {
    assert.ok(iconExists(p, CIV3), `Icon not found on disk: ${p}`);
  });
});

test('base game PRTO_WORKER has icon paths resolvable under CIV3 root', () => {
  const e = getBase().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_WORKER');
  assert.ok((e.iconPaths || []).length > 0, 'Worker has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('base game GOOD_IRON has icon paths resolvable under CIV3 root', () => {
  const e = getBase().tabs.resources.entries.find((x) => x.civilopediaKey === 'GOOD_IRON');
  assert.ok((e.iconPaths || []).length > 0, 'Iron has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('base game BLDG_BARRACKS has icon paths resolvable under CIV3 root', () => {
  const e = getBase().tabs.improvements.entries.find((x) => x.civilopediaKey === 'BLDG_BARRACKS');
  assert.ok((e.iconPaths || []).length > 0, 'Barracks has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('base game TECH_ALPHABET has icon paths resolvable under CIV3 root', () => {
  const e = getBase().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_ALPHABET');
  assert.ok((e.iconPaths || []).length > 0, 'Alphabet has no iconPaths');
  // Tech icons live under CIV3/Art/Tech Chooser (vanilla layer)
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

// ============================================================================
// SENGOKU — Conquests/Conquests/7 Sengoku - Sword of the Shogun.biq
// ============================================================================

test('Sengoku BIQ loads without error', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip(`Sengoku BIQ not present: ${SENGOKU_BIQ}`);
  const b = getSeng();
  assert.equal(b.biq.error, undefined, `BIQ error: ${b.biq.error}`);
  assert.ok(b.biq.sections.length > 0, 'Expected BIQ sections');
});

test('Sengoku scenario search path resolves to the Sengoku art/text directory', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip(`Sengoku BIQ not present: ${SENGOKU_BIQ}`);
  const b = getSeng();
  const resolved = (b.scenarioSearchPaths || []).map((p) => path.resolve(p));
  assert.ok(
    resolved.some((p) => p === path.resolve(SENGOKU_DIR)),
    `Expected ${SENGOKU_DIR} in scenarioSearchPaths, got: ${JSON.stringify(b.scenarioSearchPaths)}`
  );
});

// --- Counts -----------------------------------------------------------------

test('Sengoku civ count is exactly 19', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  assert.equal(getSeng().tabs.civilizations.entries.length, 19);
});
test('Sengoku tech count is exactly 39', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  assert.equal(getSeng().tabs.technologies.entries.length, 39);
});
test('Sengoku resource count is exactly 17', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  assert.equal(getSeng().tabs.resources.entries.length, 17);
});
test('Sengoku improvement count is exactly 32', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  assert.equal(getSeng().tabs.improvements.entries.length, 32);
});
test('Sengoku government count is exactly 3', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  assert.equal(getSeng().tabs.governments.entries.length, 3);
});
test('Sengoku unit count is exactly 42', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  assert.equal(getSeng().tabs.units.entries.length, 42);
});

// --- Complete key sets -------------------------------------------------------

const SENGOKU_CIVS = [
  'RACE_CHOSOKABE','RACE_DATE','RACE_HOJO','RACE_ICHIJO','RACE_IMAGAWA',
  'RACE_MATSUNAGA','RACE_MIYOSHI','RACE_MOGAMI','RACE_MORI','RACE_ODA',
  'RACE_OTOMO','RACE_RYUZOJI','RACE_SAITO','RACE_SHIMAZU','RACE_TAKEDA',
  'RACE_TOKUGAWA','RACE_UESUGI','RACE_URAKAMI'
];

const SENGOKU_TECHS = [
  'TECH_TRADE','TECH_ALPHABET','TECH_CEREMONIAL_BURIAL','TECH_BAJUTSU',
  'TECH_BOJUTSU','TECH_BUJUTSU','TECH_BUSHIDO','TECH_WRITING','TECH_CODE_OF_LAWS',
  'TECH_CONSTRUCTION','TECH_PORTUGUESE','TECH_RONIN','TECH_CURRENCY',
  'TECH_DIPLOMATIC','TECH_FEUDALISM','TECH_GUNPOWDER','TECH_HEIHOJUTSU',
  'TECH_HOJUTSU','TECH_HORSEBACK_RIDING','TECH_IAJUTSU','TECH_INVENTION',
  'TECH_KENJUTSU','TECH_KYUJUTSU','TECH_LITERATURE','TECH_MAP_MAKING',
  'TECH_MASONRY','TECH_MATHEMATICS','TECH_BRONZE_WORKING','TECH_MYSTICISM',
  'TECH_NAGINATAJUTSU','TECH_NINJUTSU','TECH_PHILOSOPHY','TECH_PLACE_HOLDER',
  'TECH_POTTERY','TECH_SHINTO','TECH_SOJUTSU','TECH_SUIEIJUTSU',
  'TECH_IRON_WORKING','TECH_THE_WHEEL'
];

const SENGOKU_RESOURCES = [
  'GOOD_CATTLE','GOOD_DYE','GOOD_FISH','GOOD_FURS','GOOD_GAME',
  'GOOD_DIAMONDS','GOOD_GOLD','GOOD_HORSES','GOOD_INCENSE','GOOD_IRON',
  'GOOD_JADE','GOOD_SAKE','GOOD_SALTPETER','GOOD_SILK','GOOD_SPICE',
  'GOOD_WHALES','GOOD_WHEAT'
];

const SENGOKU_IMPROVEMENTS = [
  'BLDG_AQUEDUCT','BLDG_LIBRARY','BLDG_BARRACKS','BLDG_BATTLEFIELD_MEDICINE',
  'BLDG_CIVIL_DEFENSE','BLDG_DEN','BLDG_FIEF','BLDG_GEISHA','BLDG_GRANARY',
  'BLDG_HARBOR','BLDG_EPIC','BLDG_DECREE','BLDG_SHRINE','BLDG_CATHEDRAL',
  'BLDG_GREAT_PLAYHOUSE','BLDG_COURTHOUSE','BLDG_MARKETPLACE',
  'BLDG_MILITARY_ACADEMY','BLDG_COLOSSEUM','BLDG_ORACLE','BLDG_PALACE',
  'BLDG_ART_OF_WAR','BLDG_TEMPLE','BLDG_GREAT_LIBRARY','BLDG_GREAT_WALL',
  'BLDG_TRADING_COMPANY','BLDG_BANK','BLDG_UNIVERSITY','BLDG_WALLS',
  'BLDG_COUNCIL','BLDG_WEALTH','BLDG_POLICE_STATION'
];

const SENGOKU_GOVTS = [
  'GOVT_ANARCHY','GOVT_DESPOTISM','GOVT_FEUDALISM'
];

const SENGOKU_UNITS = [
  'PRTO_ARMY','PRTO_ARMY_ERAS_ANCIENT_TIMES','PRTO_ARMY_ERAS_INDUSTRIAL_AGE',
  'PRTO_ARMY_ERAS_MIDDLE_AGES','PRTO_ARMY_ERAS_MODERN_ERA','PRTO_FOOTMAN',
  'PRTO_SWORDSMAN2','PRTO_CARAVEL','PRTO_JAPANESE_CATAPULT','PRTO_FIRE_CANNON',
  'PRTO_GALLEY','PRTO_HORSEMAN','PRTO_LEADER_ERAS_ANCIENT_TIMES',
  'PRTO_LEADER_ERAS_INDUSTRIAL_AGE','PRTO_LEADER_ERAS_MIDDLE_AGES',
  'PRTO_LEADER_ERAS_MODERN_ERA','PRTO_MOUNTED_SAMURAI','PRTO_NINJA',
  'PRTO_PEASANT_WORKER','PRTO_ROCKET_CART','PRTO_RONIN','PRTO_SAMURAI_ARCHER',
  'PRTO_ARQUEBUSIER','PRTO_LEADER','PRTO_SAMURAI_HORSE_ARCHER',
  'PRTO_SAMURAI_SPEARMAN','PRTO_SAMURAI_WARRIOR','PRTO_SETTLER2',
  'PRTO_TOKUGAWA','PRTO_SIEGE_CROSSBOW','PRTO_OTOMO_SPEARMAN',
  'PRTO_STONE_CROSSBOW','PRTO_WARRIOR_MONK'
];

test('Sengoku has every expected civilization key', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.civilizations));
  SENGOKU_CIVS.forEach((k) => assert.ok(actual.has(k), `Missing civ: ${k}`));
});

test('Sengoku has every expected technology key', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.technologies));
  SENGOKU_TECHS.forEach((k) => assert.ok(actual.has(k), `Missing tech: ${k}`));
});

test('Sengoku has every expected resource key', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.resources));
  SENGOKU_RESOURCES.forEach((k) => assert.ok(actual.has(k), `Missing resource: ${k}`));
});

test('Sengoku has every expected improvement key', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.improvements));
  SENGOKU_IMPROVEMENTS.forEach((k) => assert.ok(actual.has(k), `Missing improvement: ${k}`));
});

test('Sengoku has every expected government key', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.governments));
  SENGOKU_GOVTS.forEach((k) => assert.ok(actual.has(k), `Missing govt: ${k}`));
});

test('Sengoku has every expected unit key', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.units));
  SENGOKU_UNITS.forEach((k) => assert.ok(actual.has(k), `Missing unit: ${k}`));
});

// --- Spot field values -------------------------------------------------------

test('Sengoku RACE_ODA has correct leader', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_ODA');
  assert.ok(e, 'RACE_ODA not found');
  assert.equal(e.name, 'Oda');
  assert.equal(fv(e, 'leadername'), 'Oda Nobunaga');
});

test('Sengoku RACE_CHOSOKABE has correct leader', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_CHOSOKABE');
  assert.ok(e, 'RACE_CHOSOKABE not found');
  assert.equal(fv(e, 'leadername'), 'Chosokabe Motochika');
});

test('Sengoku RACE_TAKEDA has correct leader', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_TAKEDA');
  assert.ok(e, 'RACE_TAKEDA not found');
  assert.equal(fv(e, 'leadername'), 'Takeda Shingen');
});

test('Sengoku TECH_GUNPOWDER has cost 90', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_GUNPOWDER');
  assert.ok(e, 'TECH_GUNPOWDER not found');
  assert.equal(fv(e, 'cost'), '90');
});

test('Sengoku GOOD_IRON is present and still Strategic type', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.resources.entries.find((x) => x.civilopediaKey === 'GOOD_IRON');
  assert.ok(e, 'GOOD_IRON not found');
  assert.equal(fv(e, 'type'), 'Strategic (2)');
});

test('Sengoku BLDG_BARRACKS is a normal improvement', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.improvements.entries.find((x) => x.civilopediaKey === 'BLDG_BARRACKS');
  assert.ok(e, 'BLDG_BARRACKS not found');
  assert.equal(e.improvementKind, 'normal');
});

test('Sengoku PRTO_SAMURAI_WARRIOR has Minamoto Samurai animation', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_SAMURAI_WARRIOR');
  assert.ok(e, 'PRTO_SAMURAI_WARRIOR not found');
  assert.equal(e.animationName, 'Minamoto Samurai');
});

test('Sengoku PRTO_NINJA has Ninja animation', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_NINJA');
  assert.ok(e, 'PRTO_NINJA not found');
  assert.equal(e.animationName, 'Ninja');
});

// --- Art / iconPaths ---------------------------------------------------------

test('Sengoku RACE_ODA has 4 icon paths all resolvable under Sengoku or CIV3 roots', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_ODA');
  assert.ok(e, 'RACE_ODA not found');
  assert.equal(e.iconPaths.length, 4);
  e.iconPaths.forEach((p) => {
    assert.ok(iconExists(p, SENGOKU_DIR, CIV3), `Icon not found: ${p}`);
  });
});

test('Sengoku non-barbarian civs have non-empty iconPaths resolved from Sengoku or CIV3', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  getSeng().tabs.civilizations.entries
    .filter((e) => String(e.civilopediaKey || '').toUpperCase() !== 'RACE_BARBARIANS')
    .forEach((e) => {
    assert.ok((e.iconPaths || []).length > 0, `${e.civilopediaKey} has no iconPaths`);
    assert.ok(
      iconExists(e.iconPaths[0], SENGOKU_DIR, CIV3),
      `${e.civilopediaKey} large icon not on disk: ${e.iconPaths[0]}`
    );
    });
});

test('Sengoku GOOD_IRON icon resolves from base CIV3 art (shared resource art)', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.resources.entries.find((x) => x.civilopediaKey === 'GOOD_IRON');
  assert.ok((e.iconPaths || []).length > 0, 'Iron has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Sengoku PRTO_ARMY has icon paths resolvable under CIV3 (shared base unit art)', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_ARMY');
  assert.ok(e, 'PRTO_ARMY not found');
  assert.ok((e.iconPaths || []).length > 0, 'Army has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], SENGOKU_DIR, CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Sengoku TECH_GUNPOWDER has icon paths resolvable under CIV3', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_GUNPOWDER');
  assert.ok((e.iconPaths || []).length > 0, 'Gunpowder has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Sengoku BLDG_BARRACKS has icon paths resolvable under CIV3', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const e = getSeng().tabs.improvements.entries.find((x) => x.civilopediaKey === 'BLDG_BARRACKS');
  assert.ok((e.iconPaths || []).length > 0, 'Barracks has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

// ============================================================================
// TIDES OF CRIMSON — Conquests/Scenarios/TIDES OF CRIMSON.biq
// ============================================================================

test('Tides of Crimson BIQ loads without error', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Tides BIQ not present: ${TIDES_BIQ}`);
  const b = getTides();
  assert.equal(b.biq.error, undefined, `BIQ error: ${b.biq.error}`);
  assert.ok(b.biq.sections.length > 0, 'Expected BIQ sections');
});

test('Tides scenario search path resolves to an installed Tides of Crimson art/text directory', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const b = getTides();
  const resolved = (b.scenarioSearchPaths || []).map((p) => path.resolve(p));
  assert.ok(
    resolved.some((p) => fs.existsSync(p) && isTidesScenarioRoot(p)),
    `Expected an installed Tides of Crimson scenario root in scenarioSearchPaths, got: ${JSON.stringify(b.scenarioSearchPaths)}`
  );
});

// --- Counts -----------------------------------------------------------------

test('Tides civ count is exactly 27', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  assert.equal(getTides().tabs.civilizations.entries.length, 27);
});
test('Tides tech count is exactly 207', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  assert.equal(getTides().tabs.technologies.entries.length, 207);
});
test('Tides resource count is exactly 96', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  assert.equal(getTides().tabs.resources.entries.length, 96);
});
test('Tides improvement count is exactly 241', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  assert.equal(getTides().tabs.improvements.entries.length, 241);
});
test('Tides government count is exactly 14', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  assert.equal(getTides().tabs.governments.entries.length, 14);
});
test('Mesopotamia unit count is exactly 38', (t) => {
  if (!fs.existsSync(MESOPOTAMIA_BIQ)) t.skip();
  assert.equal(getMesopotamia().tabs.units.entries.length, 38);
});

// --- Complete key sets -------------------------------------------------------

const TIDES_CIVS = [
  'RACE_AMAZONIANS','RACE_PRETHASS','RACE_ARCHONS','RACE_BEASTMEN','RACE_VAMPIRICS',
  'RACE_HUMANS','RACE_CHAOS_DWARVES','RACE_DARK_ELVES','RACE_BURNING_LEGION',
  'RACE_ZORGE_SWARM','RACE_FROSTLINGS','RACE_GOBLINS','RACE_HIGH_ELVES',
  'RACE_HOBBITS','RACE_JADE_EMPIRE','RACE_LIZARDMEN','RACE_NIGHT_ELVES',
  'RACE_DWARVES','RACE_NAGA','RACE_ORCS','RACE_CALYPSOS','RACE_RAMAYANA_EMPIRE',
  'RACE_SKAVEN','RACE_TROLLS','RACE_UNDEAD','RACE_WOOD_ELVES'
];

const TIDES_GOVTS = [
  'GOVT_ANARCHY','GOVT_NO_SPHERE','GOVT_FIRE','GOVT_WATER','GOVT_AIR',
  'GOVT_EARTH','GOVT_LIFE','GOVT_DEATH','GOVT_BALANCE','GOVT_COSMOS',
  'GOVT_CHAOS','GOVT_ICE','GOVT_LIGHTNING','GOVT_POISON'
];

// Spot-check a representative subset of the 70 resources
const TIDES_RESOURCES_SAMPLE = [
  'GOOD_AGATTE','GOOD_ALLIGATORS','GOOD_APPLE_TREE','GOOD_BEARS','GOOD_CATTLE',
  'GOOD_COAL','GOOD_DIAMONDS','GOOD_DYE','GOOD_FISH','GOOD_FURS','GOOD_GOLD',
  'GOOD_HORSES','GOOD_INCENSE','GOOD_IRON','GOOD_JADE','GOOD_SAKE','GOOD_SILK',
  'GOOD_SPICE','GOOD_SUGAR','GOOD_WHEAT','GOOD_WINE','GOOD_FOUNTAIN',
  'GOOD_VESPHENE','GOOD_DISALLOWED'
];

// Spot-check a representative subset of techs
// Note: Tides renames/replaces many base-game techs; TECH_DEMOCRACY/TECH_CHIVALRY
// etc. don't exist as-is — only Tides-original or surviving shared keys are used here.
const TIDES_TECHS_SAMPLE = [
  'TECH_ADVANCED_WIZARDRY','TECH_AERIAL_SCIENCE','TECH_AIR_NODE',
  'TECH_ALCHEMY','TECH_AMAZONIANS','TECH_ARCANE_MAGIC','TECH_ARCHONS',
  'TECH_ASTRONOMY','TECH_BALANCE_NODE','TECH_WRITING','TECH_GUNPOWDER',
  'TECH_FEUDALISM','TECH_MYSTICISM'
];

// Spot-check a representative subset of improvements
// Note: Tides replaces BLDG_CATHEDRAL with BLDG_CATHEDRAL_OF_LIGHT etc.
const TIDES_IMPROVEMENTS_SAMPLE = [
  'BLDG_WEALTH','BLDG_LIBRARY','BLDG_AIR_NODE','BLDG_AQUEDUCT','BLDG_BARRACKS',
  'BLDG_CATHEDRAL_OF_LIGHT','BLDG_GRANARY','BLDG_HARBOR','BLDG_MARKETPLACE',
  'BLDG_PALACE','BLDG_TEMPLE'
];

// Spot-check a representative subset of units
const TIDES_UNITS_SAMPLE = [
  'PRTO_WORKER','PRTO_BARRAGE','PRTO_SCHOLARS_SCROLL','PRTO_OBSERVER_WARD',
  'PRTO_ARMY','PRTO_GALLEY','PRTO_HORSEMAN','PRTO_SETTLER'
];

test('Tides has every expected civilization key', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.civilizations));
  TIDES_CIVS.forEach((k) => assert.ok(actual.has(k), `Missing civ: ${k}`));
});

test('Tides has every expected government key', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.governments));
  TIDES_GOVTS.forEach((k) => assert.ok(actual.has(k), `Missing govt: ${k}`));
});

test('Tides has the sampled resource keys', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.resources));
  TIDES_RESOURCES_SAMPLE.forEach((k) => assert.ok(actual.has(k), `Missing resource: ${k}`));
});

test('Tides has the sampled technology keys', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.technologies));
  TIDES_TECHS_SAMPLE.forEach((k) => assert.ok(actual.has(k), `Missing tech: ${k}`));
});

test('Tides has the sampled improvement keys', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.improvements));
  TIDES_IMPROVEMENTS_SAMPLE.forEach((k) => assert.ok(actual.has(k), `Missing improvement: ${k}`));
});

test('Tides has the sampled unit keys', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.units));
  TIDES_UNITS_SAMPLE.forEach((k) => assert.ok(actual.has(k), `Missing unit: ${k}`));
});

// --- Spot field values -------------------------------------------------------

test('Tides RACE_AMAZONIANS has correct leader and traits', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_AMAZONIANS');
  assert.ok(e, 'RACE_AMAZONIANS not found');
  assert.equal(e.name, 'Amazonians');
  assert.equal(fv(e, 'leadername'), 'Kerigan');
  assert.equal(fv(e, 'leadertitle'), 'Lady');
  assert.equal(fv(e, 'commercial'), 'true');
  assert.equal(fv(e, 'religious'), 'true');
});

test('Tides RACE_ORCS has correct leader', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_ORCS');
  assert.ok(e, 'RACE_ORCS not found');
  assert.equal(fv(e, 'leadername'), 'Throle');
});

test('Tides TECH_WRITING has correct cost', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_WRITING');
  assert.ok(e, 'TECH_WRITING not found');
  assert.equal(fv(e, 'cost'), '8');
});

test('Tides TECH_WRITING projects enablesdiplomats flag', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_WRITING');
  assert.ok(e, 'TECH_WRITING not found');
  assert.equal(fv(e, 'enablesdiplomats'), 'true');
});

test('Tides BLDG_LIBRARY (Academy) is a normal improvement', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.improvements.entries.find((x) => x.civilopediaKey === 'BLDG_LIBRARY');
  assert.ok(e, 'BLDG_LIBRARY not found');
  assert.equal(e.improvementKind, 'normal');
});

test('Tides GOVT_AIR (Air Sphere) has correct assimilation chance and modifier fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.governments.entries.find((x) => x.civilopediaKey === 'GOVT_AIR');
  assert.ok(e, 'GOVT_AIR not found');
  assert.equal(fv(e, 'assimilationchance'), '5');
  assert.equal(fv(e, 'militarypolicelimit'), '1');
  assert.equal(fv(e, 'malerulertitle1'), 'Sir');
  assert.equal(fv(e, 'femalerulertitle1'), 'Madame');
});

test('Tides PRTO_BARRAGE has correct requiredtech and bombard fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_BARRAGE');
  assert.ok(e, 'PRTO_BARRAGE not found');
  assert.equal(fv(e, 'bombardstrength'), '25');
  assert.equal(fv(e, 'rateoffire'), '4');
  assert.equal(fv(e, 'airbombard'), 'true');
  assert.equal(fv(e, 'civilopediaentry').toLowerCase(), 'prto_barrage');
});

test('Tides PRTO_WORKER has Worker animation name', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_WORKER');
  assert.ok(e, 'PRTO_WORKER not found');
  assert.equal(e.animationName, 'Worker');
});

// --- Art / iconPaths ---------------------------------------------------------

test('Tides RACE_AMAZONIANS has 4 icon paths all resolvable under Tides or CIV3 roots', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_AMAZONIANS');
  assert.ok(e, 'RACE_AMAZONIANS not found');
  assert.equal(e.iconPaths.length, 4);
  e.iconPaths.forEach((p) => {
    assert.ok(iconExists(p, ...getTidesArtRoots(), CIV3), `Icon not found: ${p}`);
  });
});

test('Tides RACE_ORCS has icon paths resolvable under Tides or CIV3 roots', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.civilizations.entries.find((x) => x.civilopediaKey === 'RACE_ORCS');
  assert.ok((e.iconPaths || []).length > 0, 'Orcs has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], ...getTidesArtRoots(), CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Tides non-barbarian civs have non-empty iconPaths resolved from Tides or CIV3', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  getTides().tabs.civilizations.entries
    .filter((e) => String(e.civilopediaKey || '').toUpperCase() !== 'RACE_BARBARIANS')
    .forEach((e) => {
      assert.ok((e.iconPaths || []).length > 0, `${e.civilopediaKey} has no iconPaths`);
      assert.ok(
        iconExists(e.iconPaths[0], ...getTidesArtRoots(), CIV3),
        `${e.civilopediaKey} large icon not on disk: ${e.iconPaths[0]}`
      );
    });
});

test('Tides PRTO_BARRAGE has icon paths resolvable under Tides or CIV3 roots', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_BARRAGE');
  assert.ok((e.iconPaths || []).length > 0, 'Barrage has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], ...getTidesArtRoots(), CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Tides PRTO_WORKER has icon paths resolvable under CIV3 (shared base art)', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.units.entries.find((x) => x.civilopediaKey === 'PRTO_WORKER');
  assert.ok((e.iconPaths || []).length > 0, 'Worker has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Tides GOOD_IRON icon resolves from base CIV3 art', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.resources.entries.find((x) => x.civilopediaKey === 'GOOD_IRON');
  assert.ok((e.iconPaths || []).length > 0, 'Iron has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Tides TECH_WRITING has icon paths resolvable under CIV3', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.technologies.entries.find((x) => x.civilopediaKey === 'TECH_WRITING');
  assert.ok((e.iconPaths || []).length > 0, 'Writing has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

test('Tides GOVT_AIR has icon paths resolvable under Tides or CIV3 roots', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const e = getTides().tabs.governments.entries.find((x) => x.civilopediaKey === 'GOVT_AIR');
  assert.ok((e.iconPaths || []).length > 0, 'Air Sphere govt has no iconPaths');
  assert.ok(iconExists(e.iconPaths[0], ...getTidesArtRoots(), CIV3), `Icon not found: ${e.iconPaths[0]}`);
});

// ============================================================================
// CROSS-SCENARIO ISOLATION
// ============================================================================

test('base game contains NO Sengoku-only civs', () => {
  const actual = new Set(keys(getBase().tabs.civilizations));
  ['RACE_ODA','RACE_CHOSOKABE','RACE_DATE','RACE_HOJO','RACE_TAKEDA',
   'RACE_UESUGI','RACE_TOKUGAWA','RACE_SHIMAZU'].forEach((k) => {
    assert.equal(actual.has(k), false, `Sengoku civ ${k} must not appear in base game`);
  });
});

test('base game contains NO Tides-only civs', () => {
  const actual = new Set(keys(getBase().tabs.civilizations));
  ['RACE_AMAZONIANS','RACE_ORCS','RACE_GOBLINS','RACE_UNDEAD',
   'RACE_HIGH_ELVES','RACE_DWARVES','RACE_VAMPIRICS'].forEach((k) => {
    assert.equal(actual.has(k), false, `Tides civ ${k} must not appear in base game`);
  });
});

test('base game contains NO Tides-only governments', () => {
  const actual = new Set(keys(getBase().tabs.governments));
  ['GOVT_AIR','GOVT_BALANCE','GOVT_CHAOS','GOVT_COSMOS','GOVT_DEATH',
   'GOVT_EARTH','GOVT_FIRE','GOVT_ICE','GOVT_LIFE','GOVT_LIGHTNING',
   'GOVT_NO_SPHERE','GOVT_POISON','GOVT_WATER'].forEach((k) => {
    assert.equal(actual.has(k), false, `Tides govt ${k} must not appear in base game`);
  });
});

test('Sengoku contains NO base-game civs', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.civilizations));
  ['RACE_AMERICAN','RACE_ENGLISH','RACE_FRENCH','RACE_JAPANESE',
   'RACE_CHINESE','RACE_ROMANS','RACE_GREEKS'].forEach((k) => {
    assert.equal(actual.has(k), false, `Base civ ${k} must not appear in Sengoku`);
  });
});

test('Sengoku contains NO Tides-only civs', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.civilizations));
  ['RACE_AMAZONIANS','RACE_ORCS','RACE_GOBLINS','RACE_UNDEAD'].forEach((k) => {
    assert.equal(actual.has(k), false, `Tides civ ${k} must not appear in Sengoku`);
  });
});

test('Tides contains NO base-game civs', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.civilizations));
  ['RACE_AMERICAN','RACE_ENGLISH','RACE_JAPANESE','RACE_CHINESE',
   'RACE_ROMANS','RACE_GREEKS','RACE_ARABS'].forEach((k) => {
    assert.equal(actual.has(k), false, `Base civ ${k} must not appear in Tides`);
  });
});

test('Tides contains NO Sengoku-only civs', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const actual = new Set(keys(getTides().tabs.civilizations));
  ['RACE_ODA','RACE_CHOSOKABE','RACE_TAKEDA','RACE_UESUGI'].forEach((k) => {
    assert.equal(actual.has(k), false, `Sengoku civ ${k} must not appear in Tides`);
  });
});

test('Sengoku contains NO Tides-only resources', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const actual = new Set(keys(getSeng().tabs.resources));
  ['GOOD_AGATTE','GOOD_VESPHENE','GOOD_MYSTILE','GOOD_CALETHEA'].forEach((k) => {
    assert.equal(actual.has(k), false, `Tides resource ${k} must not appear in Sengoku`);
  });
});

// ============================================================================
// BARBARIANS — must never appear in the civilizations tab
// ============================================================================

test('base game: RACE_BARBARIANS is raw RACE record 0', () => {
  const raceSection = getBase().biq.sections.find((s) => s.code === 'RACE');
  assert.ok(raceSection, 'Expected RACE section in base BIQ');
  const first = raceSection.records[0];
  const civField = (first.fields || []).find(
    (f) => String(f.baseKey || f.key || '').toLowerCase() === 'civilopediaentry'
  );
  assert.equal(String(civField && civField.value || '').toUpperCase(), 'RACE_BARBARIANS',
    'Expected RACE_BARBARIANS at RACE record index 0');
});

test('base game: RACE_BARBARIANS appears in the civilizations tab', () => {
  const found = getBase().tabs.civilizations.entries.find(
    (e) => String(e.civilopediaKey || '').toUpperCase().includes('BARBAR')
  );
  assert.ok(found, 'Barbarian entry should appear in civilizations tab');
});

test('Sengoku: RACE_BARBARIANS is raw RACE record 0', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const raceSection = getSeng().biq.sections.find((s) => s.code === 'RACE');
  assert.ok(raceSection, 'Expected RACE section in Sengoku BIQ');
  const first = raceSection.records[0];
  const civField = (first.fields || []).find(
    (f) => String(f.baseKey || f.key || '').toLowerCase() === 'civilopediaentry'
  );
  assert.equal(String(civField && civField.value || '').toUpperCase(), 'RACE_BARBARIANS',
    'Expected RACE_BARBARIANS at RACE record index 0');
});

test('Sengoku: RACE_BARBARIANS appears in the civilizations tab', (t) => {
  if (!fs.existsSync(SENGOKU_BIQ)) t.skip();
  const found = getSeng().tabs.civilizations.entries.find(
    (e) => String(e.civilopediaKey || '').toUpperCase().includes('BARBAR')
  );
  assert.ok(found, 'Barbarian entry should appear in civilizations tab');
});

test('Tides: RACE_BARBARIANS is raw RACE record 0', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const raceSection = getTides().biq.sections.find((s) => s.code === 'RACE');
  assert.ok(raceSection, 'Expected RACE section in Tides BIQ');
  const first = raceSection.records[0];
  const civField = (first.fields || []).find(
    (f) => String(f.baseKey || f.key || '').toLowerCase() === 'civilopediaentry'
  );
  assert.equal(String(civField && civField.value || '').toUpperCase(), 'RACE_BARBARIANS',
    'Expected RACE_BARBARIANS at RACE record index 0');
});

test('Tides: RACE_BARBARIANS appears in the civilizations tab', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip();
  const found = getTides().tabs.civilizations.entries.find(
    (e) => String(e.civilopediaKey || '').toUpperCase().includes('BARBAR')
  );
  assert.ok(found, 'Barbarian entry should appear in civilizations tab');
});

test('base game contains NO Sengoku-specific techs', () => {
  const actual = new Set(keys(getBase().tabs.technologies));
  ['TECH_BAJUTSU','TECH_BUSHIDO','TECH_KENJUTSU','TECH_NINJUTSU','TECH_SHINTO'].forEach((k) => {
    assert.equal(actual.has(k), false, `Sengoku tech ${k} must not appear in base game`);
  });
});

test('base game contains NO Tides-specific techs', () => {
  const actual = new Set(keys(getBase().tabs.technologies));
  ['TECH_ADVANCED_WIZARDRY','TECH_AIR_NODE','TECH_ALCHEMY','TECH_ARCANE_MAGIC'].forEach((k) => {
    assert.equal(actual.has(k), false, `Tides tech ${k} must not appear in base game`);
  });
});

// ---------------------------------------------------------------------------
// MESOAMERICA — regression for barbarian re-appearance bug
// Bug: after visiting the Scenario tab (GAME section), the renderer's
// ensureSyntheticReferenceEntryForBiqRecord would inject a synthetic
// RACE_BARBARIANS entry into tabs.civilizations because the barbarian
// (RACE index 0) had no matching civilizations tab entry to find.
// The fix guards that function from ever creating a civilizations entry for
// RACE index 0 / RACE_BARBARIANS.
// ---------------------------------------------------------------------------

test('Mesoamerica: RACE_BARBARIANS is raw RACE record 0', (t) => {
  if (!fs.existsSync(MESO_BIQ)) t.skip(`Scenario fixture not present: ${MESO_BIQ}`);
  const raceSection = getMeso().biq.sections.find((s) => s.code === 'RACE');
  assert.ok(raceSection, 'Expected RACE section in Mesoamerica BIQ');
  const first = raceSection.records[0];
  const civField = (first.fields || []).find(
    (f) => String(f.baseKey || f.key || '').toLowerCase() === 'civilopediaentry'
  );
  assert.equal(String(civField && civField.value || '').toUpperCase(), 'RACE_BARBARIANS',
    'Expected RACE_BARBARIANS at RACE record index 0');
});

test('Mesoamerica: RACE_BARBARIANS appears in the civilizations tab', (t) => {
  if (!fs.existsSync(MESO_BIQ)) t.skip(`Scenario fixture not present: ${MESO_BIQ}`);
  const found = getMeso().tabs.civilizations.entries.find(
    (e) => String(e.civilopediaKey || '').toUpperCase().includes('BARBAR')
      || String(e.name || '').toLowerCase().includes('barbarian')
  );
  assert.ok(found, 'Barbarian entry should appear in civilizations tab');
});
