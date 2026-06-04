const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { loadBundle } = require('../src/configCore');
const {
  applyEdits,
  parseAllSections,
  serializeSection
} = require('../src/biq/biqSections');
const { decompress } = require('../src/biq/decompress');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-biq-player-test-'));
}

function ensureDefaultC3xFiles(root) {
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = Art\\Units\\Warrior\\Warrior.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
}

function getStableMapUnitsFixturePath() {
  return path.resolve(__dirname, 'fixtures', 'biq_map_units_fixture.biq');
}

function getStableFixtureCiv3Root() {
  return path.resolve(__dirname, '..', '..');
}

function parseBiqFileForRawSections(filePath) {
  const raw = fs.readFileSync(filePath);
  const inflated = decompress(raw);
  return parseAllSections(inflated.ok ? inflated.data : raw);
}

function buildBuffer(parsed) {
  return Buffer.concat([
    parsed._headerBuf,
    ...parsed.sections.map((section) => serializeSection(section, parsed.io))
  ]);
}

function getSection(tab, code) {
  const sections = tab && Array.isArray(tab.sections) ? tab.sections : [];
  return sections.find((section) => String(section && section.code || '').toUpperCase() === String(code || '').toUpperCase()) || null;
}

function getRecordField(record, key) {
  const fields = Array.isArray(record && record.fields) ? record.fields : [];
  const target = String(key || '').trim().toLowerCase();
  return fields.find((field) => String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target) || null;
}

test('save and reload preserves all editable Scenario Player scalar fields', () => {
  const parsed = parseBiqFileForRawSections(getStableMapUnitsFixturePath());
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');
  const govCount = ((parsed.sections || []).find((section) => section.code === 'GOVT') || { records: [] }).records.length;
  const eraCount = ((parsed.sections || []).find((section) => section.code === 'ERAS') || { records: [] }).records.length;
  const targetGovernment = govCount > 1 ? 1 : 0;
  const targetEra = eraCount > 1 ? 1 : 0;

  const result = applyEdits(buildBuffer(parsed), [
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'humanplayer', value: 'true' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'customcivdata', value: 'true' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'civ', value: 'Any (-3)' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'government', value: String(targetGovernment) },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'initialera', value: String(targetEra) },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'difficulty', value: 'Any' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'startcash', value: '123' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'color', value: '7' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'genderofleadername', value: '1' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'skipfirstturn', value: 'true' },
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'startembassies', value: 'true' }
  ], {});
  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const reParsed = parseAllSections(result.buffer);
  assert.equal(reParsed.ok, true, 'expected edited BIQ buffer to parse');
  const reLead = ((reParsed.sections || []).find((section) => section.code === 'LEAD') || { records: [] }).records[0];
  assert.equal(reLead.humanPlayer, 1);
  assert.equal(reLead.customCivData, 1);
  assert.equal(reLead.civ, -3);
  assert.equal(reLead.government, targetGovernment);
  assert.equal(reLead.initialEra, targetEra);
  assert.equal(reLead.difficulty, -2);
  assert.equal(reLead.startCash, 123);
  assert.equal(reLead.color, 7);
  assert.equal(reLead.genderOfLeaderName, 1);
  assert.equal(reLead.skipFirstTurn, 1);
  assert.equal(reLead.startEmbassies, 1);
});

test('save accepts Quint LEAD civilization sentinels by label and display value', () => {
  const parsed = parseBiqFileForRawSections(getStableMapUnitsFixturePath());
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');

  const anyResult = applyEdits(buildBuffer(parsed), [
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'civ', value: 'Any' }
  ], {});
  assert.equal(anyResult.ok, true, String(anyResult.error || 'Any save failed'));
  let reParsed = parseAllSections(anyResult.buffer);
  assert.equal(reParsed.ok, true);
  assert.equal(((reParsed.sections || []).find((section) => section.code === 'LEAD') || { records: [] }).records[0].civ, -3);

  const randomResult = applyEdits(buildBuffer(parsed), [
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'civ', value: 'Random (-2)' }
  ], {});
  assert.equal(randomResult.ok, true, String(randomResult.error || 'Random save failed'));
  reParsed = parseAllSections(randomResult.buffer);
  assert.equal(reParsed.ok, true);
  assert.equal(((reParsed.sections || []).find((section) => section.code === 'LEAD') || { records: [] }).records[0].civ, -2);
});

test('loadBundle displays Quint LEAD civilization sentinels as Any and Random after reload', () => {
  const parsed = parseBiqFileForRawSections(getStableMapUnitsFixturePath());
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');
  const leadSection = (parsed.sections || []).find((section) => section.code === 'LEAD');
  assert.ok(leadSection && Array.isArray(leadSection.records) && leadSection.records.length >= 2, 'expected at least two LEAD records');
  leadSection.records[0].civ = -3;
  leadSection.records[0]._modified = true;
  leadSection.records[1].civ = -2;
  leadSection.records[1]._modified = true;

  const tmp = mkTmpDir();
  const c3x = path.join(tmp, 'C3X');
  fs.mkdirSync(c3x, { recursive: true });
  ensureDefaultC3xFiles(c3x);
  const scenarioBiq = path.join(tmp, 'scenario.biq');
  fs.writeFileSync(scenarioBiq, buildBuffer(parsed));

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath: c3x,
    civ3Path: getStableFixtureCiv3Root(),
    scenarioPath: scenarioBiq
  });
  const reLeadSection = getSection(bundle.tabs.players, 'LEAD');
  assert.ok(reLeadSection && Array.isArray(reLeadSection.records), 'expected reloaded LEAD section');
  assert.equal(getRecordField(reLeadSection.records[0], 'civ').value, 'Any (-3)');
  assert.equal(getRecordField(reLeadSection.records[1], 'civ').value, 'Random (-2)');
});

test('save normalizes fixed-player preplaced cities to civ ownership and clears orphan starts', () => {
  const parsed = parseBiqFileForRawSections(getStableMapUnitsFixturePath());
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');

  const getRawSection = (code) => ((parsed.sections || []).find((section) => section.code === code) || { records: [] });
  const citySection = getRawSection('CITY');
  const slocSection = getRawSection('SLOC');
  const tileSection = getRawSection('TILE');
  const leadSection = getRawSection('LEAD');
  const leadCivs = leadSection.records.map((record) => record.civ);
  assert.deepEqual(leadCivs, [1, 2, 6, 7], 'fixture should keep fixed playable LEAD civs');

  slocSection.records = [];
  slocSection._modified = true;
  const hostTiles = tileSection.records
    .filter((record) => record.city < 0 && record.colony < 0)
    .slice(0, leadCivs.length);
  assert.equal(hostTiles.length, leadCivs.length, 'expected enough empty host tiles');

  citySection.records = hostTiles.map((tile, playerIndex) => ({
    index: playerIndex,
    hasWalls: 0,
    hasPalace: 0,
    name: `Slot ${playerIndex + 1} City`,
    ownerType: 3,
    numBuildings: 0,
    buildings: [],
    culture: 10,
    owner: playerIndex,
    size: 1,
    x: tile.xpos,
    y: tile.ypos,
    cityLevel: 1,
    borderLevel: 1,
    useAutoName: 0
  }));
  citySection._modified = true;
  hostTiles.forEach((tile, playerIndex) => {
    tile.city = playerIndex;
    tile.c3cBonuses = (tile.c3cBonuses | 0x00000008);
    if (Buffer.isBuffer(tile._rawRecord)) {
      tile._rawRecord.writeInt16LE(playerIndex, 4 + 16);
      tile._rawRecord.writeInt32LE(tile.c3cBonuses, 4 + 39);
    }
  });
  tileSection._modified = true;

  const result = applyEdits(buildBuffer(parsed), [
    { op: 'set', sectionCode: 'LEAD', recordRef: '@INDEX:0', fieldKey: 'startcash', value: '10' }
  ], {});
  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const reParsed = parseAllSections(result.buffer);
  assert.equal(reParsed.ok, true);
  const reSection = (code) => ((reParsed.sections || []).find((section) => section.code === code) || { records: [] });
  assert.deepEqual(
    reSection('CITY').records.map((record) => [record.ownerType, record.owner]),
    leadCivs.map((civ) => [2, civ]),
    'fixed player-slot cities should save as civ-owned stock-style cities'
  );
  assert.equal(
    reSection('TILE').records.filter((record) => (record.c3cBonuses & 0x00000008) !== 0).length,
    0,
    'city-start scenario with no SLOC records should not retain orphan start flags'
  );
  assert.equal(reSection('SLOC').records.length, 0);
});
