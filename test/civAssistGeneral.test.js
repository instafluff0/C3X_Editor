'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { inspectCivAssistSaveFile, makeRuleSectionSignature } = require('../src/biq/civAssist');
const { parseAllSections } = require('../src/biq/biqSections');
const { loadBundle } = require('../src/configCore');

const TOKUGAWA_SAVE = '/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 740 AD.SAV';
const INSTAFLUFF_BIQ = '/Users/nicdobbins/fun/Civilization III Complete/Conquests/Scenarios/Instafluff_Scenario.biq';
const CIV3_ROOT = '/Users/nicdobbins/fun/Civilization III Complete';
const C3X_ROOT = '/Users/nicdobbins/fun/Civilization III Complete/Conquests/C3X_Districts';

function fieldMap(fields) {
  return new Map((fields || []).map((field) => [field.label, field]));
}

function section(parsed, code) {
  return (parsed.sections || []).find((item) => String(item && item.code || '').toUpperCase() === code) || { records: [] };
}

function projectedBundleRecords(bundle, code) {
  const sectionCode = String(code || '').toUpperCase();
  const tabs = bundle && bundle.tabs ? bundle.tabs : {};
  if (sectionCode === 'PRTO') {
    const rawSection = (bundle && bundle.biq && Array.isArray(bundle.biq.sections) ? bundle.biq.sections : [])
      .find((item) => String(item && item.code || '').toUpperCase() === sectionCode);
    if (rawSection) return rawSection.records || [];
  }
  if (sectionCode === 'TECH') {
    const entries = tabs.technologies && Array.isArray(tabs.technologies.entries) ? tabs.technologies.entries : [];
    return entries
      .filter((entry) => Number.isFinite(Number(entry && entry.biqIndex)))
      .sort((a, b) => Number(a.biqIndex) - Number(b.biqIndex))
      .map((entry) => {
        const eraField = (entry.biqFields || []).find((field) => String(field && field.baseKey || '').toLowerCase() === 'era');
        const match = String(eraField && eraField.value || '').match(/\((-?\d+)\)\s*$/);
        return {
          index: Number(entry.biqIndex),
          name: entry.name || '',
          civilopediaEntry: entry.displayCivilopediaKey || entry.civilopediaKey || '',
          era: match ? Number(match[1]) : -1,
          biqFields: Array.isArray(entry.biqFields) ? entry.biqFields : [],
        };
      });
  }
  if (sectionCode === 'BLDG' || sectionCode === 'PRTO') {
    const tabKey = sectionCode === 'BLDG' ? 'improvements' : 'units';
    const entries = tabs[tabKey] && Array.isArray(tabs[tabKey].entries) ? tabs[tabKey].entries : [];
    return entries
      .filter((entry) => Number.isFinite(Number(entry && entry.biqIndex)))
      .sort((a, b) => Number(a.biqIndex) - Number(b.biqIndex))
      .map((entry) => ({
        index: Number(entry.biqIndex),
        name: entry.name || '',
        civilopediaEntry: entry.displayCivilopediaKey || entry.civilopediaKey || '',
        biqFields: Array.isArray(entry.biqFields) ? entry.biqFields : [],
      }));
  }
  if (sectionCode === 'RACE' || sectionCode === 'GOVT' || sectionCode === 'GOOD') {
    const tabKey = sectionCode === 'RACE' ? 'civilizations' : sectionCode === 'GOVT' ? 'governments' : 'resources';
    const entries = tabs[tabKey] && Array.isArray(tabs[tabKey].entries) ? tabs[tabKey].entries : [];
    return entries
      .filter((entry) => Number.isFinite(Number(entry && entry.biqIndex)))
      .sort((a, b) => Number(a.biqIndex) - Number(b.biqIndex))
      .map((entry) => ({
        index: Number(entry.biqIndex),
        name: sectionCode === 'GOVT' ? (entry.name || '') : '',
        civilizationName: sectionCode === 'RACE' ? (entry.name || '') : '',
        ...(sectionCode === 'GOOD' ? { name: entry.name || '' } : {}),
        civilopediaEntry: entry.displayCivilopediaKey || entry.civilopediaKey || '',
        biqFields: Array.isArray(entry.biqFields) ? entry.biqFields : [],
      }));
  }
  for (const tab of Object.values(tabs)) {
    const found = (tab.sections || []).find((item) => String(item && item.code || '').toUpperCase() === sectionCode);
    if (found) return found.records || [];
  }
  return [];
}

function civAssistTestPrimitive(value) {
  if (Array.isArray(value)) return value.map(civAssistTestPrimitive).join('|');
  if (value == null) return '';
  return String(value).trim();
}

function civAssistTestRecordValue(record, key) {
  const wanted = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!record || !wanted) return '';
  if (wanted === 'civilopediaentry') {
    if (record.displayCivilopediaKey != null) return civAssistTestPrimitive(record.displayCivilopediaKey);
    if (record.civilopediaKey != null) return civAssistTestPrimitive(record.civilopediaKey);
  }
  if (Object.prototype.hasOwnProperty.call(record, key)) return civAssistTestPrimitive(record[key]);
  const directKey = Object.keys(record).find((candidate) => String(candidate || '').toLowerCase().replace(/[^a-z0-9]/g, '') === wanted);
  if (directKey) return civAssistTestPrimitive(record[directKey]);
  for (const fields of [record.fields || [], record.biqFields || []]) {
    const field = fields.find((item) => {
      const base = item && (item.baseKey || item.key || item.label);
      return String(base || '').toLowerCase().replace(/[^a-z0-9]/g, '') === wanted;
    });
    if (field) return civAssistTestPrimitive(field.value);
  }
  return '';
}

function civAssistTestRefSourceValues(ref) {
  const signature = ref && ref.sourceSignature;
  const targetIndex = Number(ref && ref.biqIndex);
  const records = signature && Array.isArray(signature.records) ? signature.records : [];
  const sourceRecord = records.find((record, fallbackIndex) => {
    const index = Number.isFinite(Number(record && record.index)) ? Number(record.index) : fallbackIndex;
    return index === targetIndex;
  });
  return sourceRecord && Array.isArray(sourceRecord.values) ? sourceRecord.values : [];
}

function civAssistTestUnitEntryValues(entry) {
  return [
    civAssistTestRecordValue(entry, 'name'),
    civAssistTestRecordValue(entry, 'civilopediaEntry'),
  ];
}

function civAssistTestValuesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function civAssistTestFindUnitEntry(bundle, ref) {
  const entries = bundle && bundle.tabs && bundle.tabs.units && Array.isArray(bundle.tabs.units.entries)
    ? bundle.tabs.units.entries
    : [];
  const targetIndex = Number(ref && ref.biqIndex);
  const sourceValues = civAssistTestRefSourceValues(ref);
  if (Number.isFinite(targetIndex) && targetIndex >= 0) {
    const byIndex = entries.find((entry, fallbackIndex) => [
      entry && entry.biqIndex,
      entry && entry.primaryBiqIndex,
      entry && entry.recordIndex,
      entry && entry.index,
      fallbackIndex,
    ].some((raw) => Number(raw) === targetIndex));
    if (byIndex && (sourceValues.length === 0 || civAssistTestValuesEqual(civAssistTestUnitEntryValues(byIndex), sourceValues))) {
      return byIndex;
    }
  }
  const bySourceIdentity = entries.find((entry) => civAssistTestValuesEqual(civAssistTestUnitEntryValues(entry), sourceValues));
  if (bySourceIdentity) return bySourceIdentity;
  const targetName = String(ref && ref.name || '').trim().toLowerCase();
  return entries.find((entry) => String(entry && entry.name || '').trim().toLowerCase() === targetName) || null;
}

test('CivAssist General tab matches Tokugawa 740 AD reference save', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE)) {
    t.skip('Tokugawa 740 AD reference save is not available.');
    return;
  }

  const report = inspectCivAssistSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);

  const game = fieldMap(report.general.gameInfo);
  assert.equal(game.get('Game Version').value, 'C3C122');
  assert.equal(game.get('Game Type').value, 'Single Player');
  assert.equal(game.get('Difficulty').value, 'Emperor');
  assert.equal(game.get('Victory Types').value, 'Domination, Space Race, Conquest');
  assert.equal(game.get('Preserve Seed').value, 'No');
  assert.equal(game.get('Respawn AI').value, 'No');
  assert.equal(game.get('Culture Flip').value, 'No');
  assert.equal(game.get('Scientific Leaders').value, 'Yes');
  assert.equal(game.get('Turn Number').value, '288');
  assert.equal(game.get('Game Date').value, '740 AD');
  assert.equal(game.get('Time Played').value, '02:07:51');
  assert.equal(game.get('Game Status').value, 'Incomplete');
  assert.equal(game.get('Winning Player').value, '');

  const player = fieldMap(report.general.playerInfo);
  assert.equal(player.get('Civilization').value, 'Japan');
  assert.equal(player.get('Civilization').colorSlot, 11);
  assert.equal(player.get('Civilization').ref.tabKey, 'civilizations');
  assert.equal(player.get('Civilization').ref.sectionCode, 'RACE');
  assert.equal(player.get('Civilization').ref.biqIndex, 8);
  assert.equal(player.get('Civilization').ref.name, 'Japan');
  assert.deepEqual(player.get('Civilization').ref.sourceSignature, report.ruleSignatures.RACE);
  assert.equal(player.get('Traits').value, 'Militaristic, Religious');
  assert.equal(player.get('Score').value, '760');
  assert.equal(player.get('Culture').value, '6021');
  assert.equal(player.get('Culture Per Turn').value, '56');
  assert.equal(player.get('Government').value, 'Republic');
  assert.equal(player.get('Government').ref.tabKey, 'governments');
  assert.equal(player.get('Government').ref.sectionCode, 'GOVT');
  assert.equal(player.get('Government').ref.biqIndex, 4);
  assert.equal(player.get('Government').ref.name, 'Republic');
  assert.deepEqual(player.get('Government').ref.sourceSignature, report.ruleSignatures.GOVT);
  assert.equal(player.get('Capital').value, 'Kyoto');
  assert.deepEqual(
    ['Gold', 'Cities', 'Land', 'Population', 'Units'].map((label) => {
      const item = player.get(label);
      return { label, value: item.value, rank: item.rank || '' };
    }),
    [
      { label: 'Gold', value: '501', rank: '1st' },
      { label: 'Cities', value: '2', rank: '4th' },
      { label: 'Land', value: '199', rank: '1st' },
      { label: 'Population', value: '24', rank: '1st' },
      { label: 'Units', value: '38', rank: '' },
    ]
  );

  assert.deepEqual(
    report.general.rivals.map((row) => ({
      nation: row.nation,
      traits: row.traits,
      relation: row.relation,
      government: row.government,
      currentEra: row.currentEra,
      colorSlot: row.colorSlot,
      gold: row.gold,
      cities: row.cities,
      land: row.land,
      population: row.population,
    })),
    [
      { nation: 'Greece', traits: 'Commercial, Scientific', relation: 'Peace', government: 'Feudalism', currentEra: 'Middle Ages', colorSlot: 10, gold: 0, cities: 3, land: 42, population: 2 },
      { nation: 'Germany', traits: 'Militaristic, Scientific', relation: 'Peace', government: 'Republic', currentEra: 'Middle Ages', colorSlot: 6, gold: 0, cities: 1, land: 32, population: 0 },
      { nation: 'England', traits: 'Commercial, Seafaring', relation: 'Peace', government: 'Republic', currentEra: 'Middle Ages', colorSlot: 2, gold: 0, cities: 2, land: 130, population: 9 },
      { nation: 'Persia', traits: 'Scientific, Industrious', relation: 'War', government: 'Feudalism', currentEra: 'Middle Ages', colorSlot: 13, gold: 84, cities: 1, land: 28, population: 0 },
      { nation: 'City of Sparta', traits: 'Militaristic, Agricultural', relation: 'Peace', government: 'Despotism', currentEra: 'Ancient Times', colorSlot: 21, gold: 0, cities: 1, land: 37, population: 0 },
      { nation: 'Spain', traits: 'Religious, Seafaring', relation: 'War', government: 'Monarchy', currentEra: 'Ancient Times', colorSlot: 18, gold: 28, cities: 4, land: 157, population: 14 },
      { nation: 'China', traits: 'Militaristic, Industrious', relation: 'Peace', government: 'Republic', currentEra: 'Middle Ages', colorSlot: 5, gold: 1, cities: 2, land: 53, population: 8 },
      { nation: 'Aztecs', traits: 'Militaristic, Agricultural', relation: 'War', government: 'Republic', currentEra: 'Ancient Times', colorSlot: 4, gold: 0, cities: 4, land: 100, population: 13 },
      { nation: 'Mongols', traits: 'Militaristic, Expansionist', relation: 'Peace', government: 'Monarchy', currentEra: 'Ancient Times', colorSlot: 17, gold: 16, cities: 2, land: 111, population: 7 },
    ]
  );

  assert.deepEqual(
    report.trade.treasury,
    [
      { label: 'Gold', value: '501' },
      { label: 'Gold per Turn', value: '3' },
    ]
  );
  assert.deepEqual(
    report.trade.currentTrades.map((row) => ({
      nation: row.nation,
      turnsLeft: row.turnsLeft,
      weGive: row.weGive,
      weReceive: row.weReceive,
    })),
    [
      { nation: 'Greece', turnsLeft: '--', weGive: 'Peace Treaty', weReceive: 'Peace Treaty' },
      { nation: 'Germany', turnsLeft: '--', weGive: 'Peace Treaty', weReceive: 'Peace Treaty' },
      { nation: 'England', turnsLeft: '--', weGive: 'Peace Treaty', weReceive: 'Peace Treaty' },
      { nation: 'City of Sparta', turnsLeft: '--', weGive: 'Peace Treaty', weReceive: 'Peace Treaty' },
      { nation: 'China', turnsLeft: '--', weGive: 'Peace Treaty', weReceive: 'Peace Treaty' },
      { nation: '', turnsLeft: '14', weGive: 'Salt, Gold', weReceive: 'Silks' },
      { nation: 'Mongols', turnsLeft: '--', weGive: 'Peace Treaty', weReceive: 'Peace Treaty' },
    ]
  );
  const timedChinaDeal = report.trade.currentTrades.find((row) => row.turnsLeft === '14');
  assert.deepEqual(timedChinaDeal.weGiveRefs.map((ref) => ref.name), ['Salt', 'Gold']);
  assert.deepEqual(timedChinaDeal.weReceiveRefs.map((ref) => ref.name), ['Silks']);
  assert.deepEqual(timedChinaDeal.weGiveRefs.map((ref) => ref.sourceSignature), [report.ruleSignatures.GOOD, report.ruleSignatures.GOOD]);
  assert.deepEqual(timedChinaDeal.weReceiveRefs.map((ref) => ref.sourceSignature), [report.ruleSignatures.GOOD]);
  assert.deepEqual(
    report.trade.sellOptions.map((row) => ({
      nation: row.nation,
      gold: row.gold,
      workers: row.workers,
      technologies: row.technologies,
    })).slice(0, 7),
    [
      { nation: 'Greece', gold: 0, workers: 0, technologies: 'The Republic, Theology, Chivalry' },
      { nation: 'Germany', gold: 0, workers: 0, technologies: 'Theology, Chivalry' },
      { nation: 'England', gold: 0, workers: 0, technologies: 'Theology, Chivalry' },
      { nation: 'Persia', gold: 84, workers: 0, technologies: 'Theology, Chivalry' },
      { nation: 'City of Sparta', gold: 0, workers: 0, technologies: '(13) Ceremonial Burial, Iron Working, Mysticism...' },
      { nation: 'Spain', gold: 28, workers: 0, technologies: '(4) Map Making, Currency, The Republic...' },
      { nation: 'China', gold: 1, workers: 0, technologies: 'Theology, Chivalry' },
    ]
  );
  assert.deepEqual(
    report.trade.sellOptions.map((row) => ({ nation: row.nation, resources: row.resources })).slice(0, 7),
    [
      { nation: 'Greece', resources: '' },
      { nation: 'Germany', resources: 'Horses (1), Iron (2), Salt (1), Wines (0)' },
      { nation: 'England', resources: '' },
      { nation: 'Persia', resources: 'Horses (1), Gold (1)' },
      { nation: 'City of Sparta', resources: '' },
      { nation: 'Spain', resources: 'Wines (0), Gold (1)' },
      { nation: 'China', resources: 'Iron (2), Wines (0), Stone (2)' },
    ]
  );
  assert.deepEqual(
    report.trade.sellOptions.find((row) => row.nation === 'China').resourceRefs.map((ref) => ref.name),
    ['Iron', 'Wines', 'Stone']
  );
  assert.deepEqual(
    report.trade.buyOptions.map((row) => ({ nation: row.nation, resources: row.resources })),
    [
      { nation: 'Greece', resources: '' },
      { nation: 'Germany', resources: '' },
      { nation: 'England', resources: '' },
      { nation: 'Persia', resources: '' },
      { nation: 'City of Sparta', resources: '' },
      { nation: 'Spain', resources: '' },
      { nation: 'China', resources: '' },
      { nation: 'Aztecs', resources: 'Incense (1), Gems (2)' },
      { nation: 'Mongols', resources: 'Incense (5)' },
    ]
  );
  assert.deepEqual(
    report.trade.buyOptions.find((row) => row.nation === 'Aztecs').resourceRefs.map((ref) => ref.name),
    ['Incense', 'Gems']
  );

  assert.deepEqual(report.diplomacy.summary, [
    { label: 'Known Civs', value: '9' },
    { label: 'At War', value: '3' },
    { label: 'Will Talk', value: '9' },
    { label: 'Trade Partners', value: '9' },
    { label: 'Timed Deals', value: '2' },
  ]);
  assert.deepEqual(
    report.diplomacy.rows.map((row) => ({
      nation: row.nation,
      ourCulture: row.ourCulture,
      theirCulture: row.theirCulture,
      contact: row.contact,
      relation: row.relation,
      willTalk: row.willTalk,
      activeDeals: row.activeDeals,
      canTrade: row.canTrade,
      sellOptions: row.sellOptions,
      buyOptions: row.buyOptions,
    })),
    [
      { nation: 'Greece', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 3, buyOptions: 0 },
      { nation: 'Germany', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 6, buyOptions: 0 },
      { nation: 'England', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 2, buyOptions: 0 },
      { nation: 'Persia', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'War', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 4, buyOptions: 0 },
      { nation: 'City of Sparta', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 13, buyOptions: 0 },
      { nation: 'Spain', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'War', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 6, buyOptions: 0 },
      { nation: 'China', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 2, canTrade: 'Yes', sellOptions: 5, buyOptions: 0 },
      { nation: 'Aztecs', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'War', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 5, buyOptions: 2 },
      { nation: 'Mongols', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 6, buyOptions: 1 },
    ]
  );
  assert.equal(report.diplomacy.coverage.find((row) => row.label === 'Embassy, spy, ROP, MPP, alliances').status, 'Planned');

  assert.equal(report.technology.currentEra, 'Middle Ages');
  assert.equal(report.technology.currentEraRef.sectionCode, 'ERAS');
  assert.equal(report.technology.currentEraRef.biqIndex, 1);
  assert.equal(report.technology.techsKnown, 25);
  assert.deepEqual(report.technology.optionalSkipped, []);
  assert.equal(report.technology.currentProject, 'Education');
  assert.equal(report.technology.currentProjectRef.sectionCode, 'TECH');
  assert.equal(report.technology.currentProjectRef.biqIndex, 29);
  assert.equal(report.technology.scienceRate, '30%');
  assert.equal(report.technology.beakersPerTurn, 22);
  assert.deepEqual(report.technology.progress, {
    required: { beakers: 1815, turns: 35 },
    gathered: { beakers: 1614, turns: 25 },
    remaining: { beakers: 201, turns: 10 },
    endWastage: { beakers: 19, detail: '9% of 201' },
  });
  assert.deepEqual(
    report.technology.rows.slice(0, 30).map((row) => ({
      index: row.index,
      name: row.name,
      knownToText: row.knownToText,
      estimatedCost: row.estimatedCost,
      optional: row.optional,
      status: row.status,
    })),
    [
      [1, 'Bronze Working', '(9) Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols', 66, false, 'known'],
      [2, 'Masonry', '(9) Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols', 86, false, 'known'],
      [3, 'Alphabet', '(9) Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols', 111, false, 'known'],
      [4, 'Pottery', '(9) Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols', 41, false, 'known'],
      [5, 'The Wheel', '(9) Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols', 86, false, 'known'],
      [6, 'Warrior Code', '(9) Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols', 66, false, 'known'],
      [7, 'Ceremonial Burial', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 45, false, 'known'],
      [8, 'Iron Working', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 144, false, 'known'],
      [9, 'Writing', '(9) Greece, Germany, England, Persia, City of Sparta, Spain, China, Aztecs, Mongols', 177, false, 'known'],
      [10, 'Mysticism', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 94, false, 'known'],
      [11, 'Mathematics', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 193, false, 'known'],
      [12, 'Philosophy', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 144, false, 'known'],
      [13, 'Code of Laws', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 243, false, 'known'],
      [14, 'Literature', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 243, true, 'known'],
      [15, 'Map Making', '(8) Greece, Germany, England, Persia, City of Sparta, China, Aztecs, Mongols', 288, false, 'known'],
      [16, 'Horseback Riding', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 119, false, 'known'],
      [17, 'Polytheism', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 288, false, 'known'],
      [18, 'Currency', '(5) Greece, Germany, England, Persia, China', 478, false, 'known'],
      [19, 'The Republic', '(6) Germany, England, Persia, China, Aztecs, Mongols', 783, true, 'known'],
      [20, 'Monarchy', '(8) Greece, Germany, England, Persia, Spain, China, Aztecs, Mongols', 581, true, 'known'],
      [21, 'Construction', '(6) Greece, Germany, England, Persia, China, Aztecs', 561, false, 'known'],
      [22, 'Monotheism', '(5) Greece, Germany, England, Persia, China', 1076, false, 'known'],
      [23, 'Feudalism', '(5) Greece, Germany, England, Persia, China', 957, false, 'known'],
      [24, 'Engineering', '', 1485, false, 'available'],
      [25, 'Theology', '', 1571, false, 'known'],
      [26, 'Chivalry', '', 1258, true, 'known'],
      [27, 'Invention', '', 1815, false, 'unavailable'],
      [28, 'Printing Press', '', 1485, true, 'available'],
      [29, 'Music Theory', '', 1650, true, 'unavailable'],
      [30, 'Education', '', 1815, false, 'researching'],
    ].map(([index, name, knownToText, estimatedCost, optional, status]) => ({ index, name, knownToText, estimatedCost, optional, status }))
  );
  assert.deepEqual(report.technology.rows[0].knownTo.map((item) => item.name), [
    'Greece', 'Germany', 'England', 'Persia', 'City of Sparta', 'Spain', 'China', 'Aztecs', 'Mongols'
  ]);
  assert.ok(report.technology.rows[0].knownTo.every((item) => item.ref.sectionCode === 'RACE'));
  assert.deepEqual(report.technology.rows[0].ref.sourceSignature, report.ruleSignatures.TECH);

  assert.equal(report.culture.defaultCityID, 0);
  assert.deepEqual(report.culture.cities.map((city) => ({
    id: city.id,
    name: city.name,
    culture: city.culture,
    culturePerTurn: city.culturePerTurn,
    estimatedWinDate: city.estimatedWinDate,
  })), [
    { id: 0, name: 'Kyoto', culture: 3811, culturePerTurn: 28, estimatedWinDate: '2167 AD' },
    { id: 22, name: 'Osaka', culture: 2194, culturePerTurn: 28, estimatedWinDate: '2224 AD' },
  ]);
  assert.deepEqual(report.culture.cities.map((city) => ({
    name: city.name,
    cityArt: city.cityArt,
  })), [
    {
      name: 'Kyoto',
      cityArt: { playerID: 1, raceID: 8, cultureGroup: 4, era: 1, population: 12, citySizeBucket: 2, hasPalace: true, hasWalls: false },
    },
    {
      name: 'Osaka',
      cityArt: { playerID: 1, raceID: 8, cultureGroup: 4, era: 1, population: 12, citySizeBucket: 1, hasPalace: false, hasWalls: false },
    },
  ]);
  assert.deepEqual(report.culture.civilization, {
    culture: 6021,
    culturePerTurn: 56,
    estimatedWinDate: '3267 AD',
  });
  assert.deepEqual(
    report.culture.buildingRowsByCity[0].filter((row) => row.cultural).slice(0, 16).map((row) => ({
      name: row.name,
      status: row.status,
      cost: row.cost,
      shieldsPerCulture: row.shieldsPerCulture,
      culturePerTurn: row.culturePerTurn,
      bonus: row.bonus,
      culture: row.culture,
    })),
    [
      ['Palace', 'Built in 4000 BC', '', '', 1, '2x', 552],
      ['Temple', 'Built in 1675 BC', '', '', 2, '2x', 842],
      ['Library', 'Built in 180 AD', '', '', 3, '', 309],
      ['Cathedral', 'Built in 455 AD', '', '', 3, '', 171],
      ['University', 'Need Education', 200, '50.00', 4, '', ''],
      ['Colosseum', 'Built in 350 AD', '', '', 2, '', 156],
      ['AI Lab', 'Need Advanced Semiconductors and University', 200, '100.00', 2, '', ''],
      ['The Pyramids', 'Available, 17 turns needed', 400, '100.00', 4, '', ''],
      ['The Hanging Gardens', 'Already built in Osaka', 300, '75.00', 4, '', ''],
      ['The Colossus', 'Already built in Karakorum [Mongols]', 200, '66.67', 3, '', ''],
      ['The Great Lighthouse', 'Already built in Nassau [Rome]', 300, '150.00', 2, '', ''],
      ['The Great Library', 'Built in 20 BC', '', '', 6, '', 738],
      ['The Oracle', 'Expired', 300, '75.00', 4, '', ''],
      ['The Great Wall', 'Built in 430 AD', '', '', 2, '', 124],
      ["Sun Tzu's Art of War", 'Available, 26 turns needed', 600, '300.00', 2, '', ''],
      ['Sistine Chapel', 'Available, 26 turns needed', 600, '100.00', 6, '', ''],
    ].map(([name, status, cost, shieldsPerCulture, culturePerTurn, bonus, culture]) => ({
      name, status, cost, shieldsPerCulture, culturePerTurn, bonus, culture,
    }))
  );
  assert.equal(report.culture.buildingRowsByCity[0].find((row) => row.name === "Magellan's Voyage").status, 'City not on coast');
  assert.equal(report.culture.buildingRowsByCity[0].find((row) => row.name === 'Hoover Dam').status, 'City not on river');
  assert.equal(report.culture.buildingRowsByCity[0][0].ref.sectionCode, 'BLDG');
  assert.deepEqual(report.culture.buildingRowsByCity[0][0].ref.sourceSignature, report.ruleSignatures.BLDG);
  assert.deepEqual(
    report.culture.wonders.slice(0, 9).map((row) => ({
      name: row.name,
      status: row.status,
      topLocations: row.topLocations,
    })),
    [
      { name: 'The Pyramids', status: 'Available, 17 turns needed', topLocations: 'Kyoto [17] and Osaka [17]' },
      { name: 'The Hanging Gardens', status: 'Already built in Osaka', topLocations: '' },
      { name: 'The Colossus', status: 'Already built in Karakorum [Mongols]', topLocations: '' },
      { name: 'The Great Lighthouse', status: 'Already built in Nassau [Rome]', topLocations: '' },
      { name: 'The Great Library', status: 'Built in 20 BC', topLocations: '' },
      { name: 'The Oracle', status: 'Expired', topLocations: '' },
      { name: 'The Great Wall', status: 'Built in 430 AD', topLocations: '' },
      { name: "Sun Tzu's Art of War", status: 'Available, 26 turns needed', topLocations: 'Kyoto [26] and Osaka [26]' },
      { name: 'Sistine Chapel', status: 'Available, 26 turns needed', topLocations: 'Kyoto [26] and Osaka [26]' },
    ]
  );
  assert.ok(report.culture.wonders.every((row) => row.ref.sectionCode === 'BLDG'));

  assert.equal(report.territory.territory.districtInstances, 90);
  assert.equal(report.territory.territory.ownedLandDistricts, 40);

  assert.deepEqual(report.cities.rows.map(({ cityArt, ...row }) => row), [
    {
      id: 0, city: 'Kyoto', size: '*12', sizeValue: 12,
      happy: '83%', happyValue: 83, unhappy: '8%', unhappyValue: 8,
      plus: '+9', plusValue: 9, corruption: '0%', corruptionValue: 0,
      waste: '0%', wasteValue: 0, resistors: '', aliens: '', entertainers: '', taxmen: '',
      scientists: '', police: '', engineers: '', garrison: 18, flipRisk: '-', pollution: '', distance: 1, rank: 1,
    },
    {
      id: 22, city: 'Osaka', size: '12', sizeValue: 12,
      happy: '100%', happyValue: 100, unhappy: '', unhappyValue: 0,
      plus: '+12', plusValue: 12, corruption: '12%', corruptionValue: 6,
      waste: '8%', wasteValue: 2, resistors: '', aliens: '', entertainers: '', taxmen: '',
      scientists: '', police: '', engineers: '', garrison: 3, flipRisk: '-', pollution: '', distance: 9, rank: 1,
    },
  ]);
  assert.deepEqual(report.cities.rows.map((row) => ({
    city: row.city,
    cityArt: row.cityArt,
  })), [
    {
      city: 'Kyoto',
      cityArt: { playerID: 1, raceID: 8, cultureGroup: 4, era: 1, population: 12, citySizeBucket: 2, hasPalace: true, hasWalls: false },
    },
    {
      city: 'Osaka',
      cityArt: { playerID: 1, raceID: 8, cultureGroup: 4, era: 1, population: 12, citySizeBucket: 1, hasPalace: false, hasWalls: false },
    },
  ]);

  assert.deepEqual(report.economy.administration, {
    government: 'Republic',
    governmentRef: report.general.playerInfo.find((field) => field.label === 'Government').ref,
    mobilization: 'Inactive',
    goldenAge: 'Inactive',
    capital: 'Kyoto',
    forbiddenPalace: {
      name: 'Forbidden Palace',
      city: '',
      built: false,
      ref: report.economy.administration.forbiddenPalace.ref,
    },
    secretPoliceHQ: {
      name: 'Secret Police HQ',
      city: '',
      built: false,
      ref: report.economy.administration.secretPoliceHQ.ref,
    },
  });
  assert.equal(report.economy.administration.forbiddenPalace.ref.sectionCode, 'BLDG');
  assert.equal(report.economy.administration.secretPoliceHQ.ref.sectionCode, 'BLDG');
  assert.deepEqual(report.economy.sliders, { science: 30, luxury: 0, taxes: 70 });
  assert.equal(report.economy.treasury, 501);
  assert.deepEqual(report.economy.income, {
    fromCities: 132,
    fromTaxmen: 0,
    fromOtherCivs: 0,
    interest: 0,
    total: 132,
  });
  assert.deepEqual(report.economy.expenses, {
    science: 38,
    entertainment: 0,
    corruption: 6,
    maintenance: 23,
    unitCosts: 62,
    toOtherCivs: 0,
    total: 129,
  });
  assert.equal(report.economy.netGain, 3);
  assert.deepEqual(report.economy.unitSupport, {
    paidUnits: 37,
    freeUnits: 6,
    maintenanceFreeUnits: 1,
    supportedUnits: 31,
    costPerUnit: 2,
  });
  assert.equal(report.economy.defaultBuildingIndex, 4);
  assert.deepEqual(
    report.economy.buildingOptions.slice(0, 7).map(({ ref, ...row }) => row),
    [
      { buildingIndex: 0, name: 'Palace' },
      { buildingIndex: 1, name: 'Barracks' },
      { buildingIndex: 2, name: 'Granary' },
      { buildingIndex: 3, name: 'Temple' },
      { buildingIndex: 4, name: 'Marketplace' },
      { buildingIndex: 5, name: 'Library' },
      { buildingIndex: 6, name: 'Courthouse' },
    ]
  );
  assert.ok(report.economy.buildingOptions.every((row) => row.ref.sectionCode === 'BLDG'));
  assert.deepEqual(
    report.economy.cityRows.map(({ buildingStatuses, cityArt, ...row }) => ({
      ...row,
      marketplaceStatus: buildingStatuses.find((item) => item.buildingIndex === report.economy.defaultBuildingIndex).status,
      courthouseStatus: buildingStatuses.find((item) => item.buildingIndex === 6).status,
    })),
    [
      {
        id: 0, name: 'Kyoto', size: 12, production: 20, waste: 0, wastePercent: 0,
        science: 19, luxury: 0, taxes: 43, corruption: 0, corruptionPercent: 0,
        maintenance: 11, netGold: 32, marketplaceStatus: 'Built in 365 AD', courthouseStatus: 'Available, 1 turns needed',
      },
      {
        id: 22, name: 'Osaka', size: 12, production: 19, waste: 2, wastePercent: 10,
        science: 19, luxury: 0, taxes: 45, corruption: 6, corruptionPercent: 9,
        maintenance: 12, netGold: 33, marketplaceStatus: 'Built in 365 AD', courthouseStatus: 'Built in 510 AD',
      },
    ]
  );
  assert.ok(report.economy.cityRows.every((row) => (
    row.buildingStatuses.find((item) => item.buildingIndex === report.economy.defaultBuildingIndex).ref.sectionCode === 'BLDG'
  )));

  assert.equal(report.production.productionFactor, 10);
  assert.deepEqual(
    report.production.rows.map(({ producingRef, cityArt, ...row }) => ({
      ...row,
      cityArt,
      producingRef: {
        tabKey: producingRef.tabKey,
        sectionCode: producingRef.sectionCode,
        biqIndex: producingRef.biqIndex,
        name: producingRef.name,
      },
    })),
    [
      {
        cityID: 0, city: 'Kyoto', producing: 'Samurai', orderType: 'Unit', cost: 70,
        collected: 40, progressPercent: 57, perTurn: 20, remaining: 30, turns: 2,
        overrun: 10, overrunPercent: 50, waste: 0, wastePercent: 0,
        cityArt: { playerID: 1, raceID: 8, cultureGroup: 4, era: 1, population: 12, citySizeBucket: 2, hasPalace: true, hasWalls: false },
        producingRef: { tabKey: 'units', sectionCode: 'PRTO', biqIndex: 59, name: 'Samurai' },
      },
      {
        cityID: 22, city: 'Osaka', producing: 'Galley', orderType: 'Unit', cost: 30,
        collected: 19, progressPercent: 63, perTurn: 19, remaining: 11, turns: 1,
        overrun: 8, overrunPercent: 42, waste: 2, wastePercent: 10,
        cityArt: { playerID: 1, raceID: 8, cultureGroup: 4, era: 1, population: 12, citySizeBucket: 1, hasPalace: false, hasWalls: false },
        producingRef: { tabKey: 'units', sectionCode: 'PRTO', biqIndex: 29, name: 'Galley' },
      },
    ]
  );
  assert.ok(report.production.rows.every((row) => row.producingRef.sourceSignature === report.ruleSignatures.PRTO));

  assert.deepEqual(report.military.summary, {
    total: 38,
    combat: 32,
    civilian: 6,
    naval: 2,
    air: 0,
    foreign: 0,
    damaged: 0,
    spent: 1,
    unitSupport: 62,
  });
  assert.equal(report.military.units.some((row) => row.originalNationality === 'Germany'), true);
  assert.equal(report.military.units.some((row) => row.foreign), false);
  assert.deepEqual(
    report.military.roster.map((row) => ({
      name: row.name,
      stats: row.stats,
      count: row.count,
      experienceMix: row.experienceMix,
      upgrade: row.upgrade,
      upgradeCost: row.upgradeCost,
      civText: row.civText,
    })),
    [
      { name: 'Worker', stats: '0 / 0 / 1', count: 6, experienceMix: [{ name: 'Regular', count: 3 }, { name: 'Veteran', count: 3 }], upgrade: '', upgradeCost: 0, civText: 'Japan' },
      { name: 'Archer', stats: '2 / 1 / 1', count: 3, experienceMix: [{ name: 'Regular', count: 2 }, { name: 'Veteran', count: 1 }], upgrade: 'Longbowman', upgradeCost: 60, civText: 'Japan' },
      { name: 'Swordsman', stats: '3 / 2 / 1', count: 9, experienceMix: [{ name: 'Veteran', count: 8 }, { name: 'Elite', count: 1 }], upgrade: 'Medieval Infantry', upgradeCost: 30, civText: 'Japan' },
      { name: 'Pikeman', stats: '1 / 3 / 1', count: 2, experienceMix: [{ name: 'Veteran', count: 2 }], upgrade: 'Musketman', upgradeCost: 90, civText: 'Japan' },
      { name: 'Galley', stats: '1 / 1 / 3', count: 2, experienceMix: [{ name: 'Veteran', count: 2 }], upgrade: 'Caravel', upgradeCost: 30, civText: 'Japan' },
      { name: 'Crusader', stats: '5 / 3 / 1', count: 1, experienceMix: [{ name: 'Veteran', count: 1 }], upgrade: '', upgradeCost: 0, civText: 'Japan' },
      { name: 'Samurai', stats: '4 / 4 / 2', count: 15, experienceMix: [{ name: 'Veteran', count: 15 }], upgrade: 'Cavalry', upgradeCost: 30, civText: 'Japan' },
    ]
  );
  assert.ok(report.military.roster.every((row) => row.ref.sourceSignature === report.ruleSignatures.PRTO));
  assert.ok(report.military.roster.every((row) => row.civs.length === 1 && row.civs[0].name === 'Japan'));
  assert.deepEqual(
    report.military.units.slice(0, 5).map((row) => ({
      description: row.description,
      health: row.health,
      movement: row.movement,
      location: row.location,
      nationality: row.nationality,
    })),
    [
      { description: 'Veteran Samurai', health: '4/4', movement: '2/2', location: 'Kyoto', nationality: 'Japan' },
      { description: 'Veteran Worker', health: '4/4', movement: '1/1', location: '86, 24', nationality: 'Japan' },
      { description: 'Veteran Samurai', health: '4/4', movement: '2/2', location: 'Kyoto', nationality: 'Japan' },
      { description: 'Veteran Samurai', health: '4/4', movement: '2/2', location: 'Kyoto', nationality: 'Japan' },
      { description: 'Veteran Galley', health: '4/4', movement: '3/3', location: '71, 31', nationality: 'Japan' },
    ]
  );
  const capturedWorker = report.military.units.find((row) => row.originalNationality === 'Germany');
  assert.equal(capturedWorker.type, 'Worker');
  assert.equal(capturedWorker.nationality, 'Japan');
  assert.equal(capturedWorker.nationalityRef.sectionCode, 'RACE');
  assert.equal(report.military.units.find((row) => row.type === 'Crusader').movement, '0/1');

  assert.deepEqual(report.alerts.status, [
    { label: 'Current date', value: '740 AD' },
    { label: 'Turn', value: '288' },
    { label: 'Time played', value: '02:07:51' },
    { label: 'Golden Age', value: 'Inactive' },
  ]);
  assert.deepEqual(report.alerts.counts, {
    total: 7,
    critical: 0,
    warning: 1,
    opportunity: 4,
    info: 2,
  });
  assert.deepEqual(
    report.alerts.current.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      category: alert.category,
      title: alert.title,
      detail: alert.detail,
      tab: alert.tab,
      subtab: alert.subtab,
    })),
    [
      {
        id: 'production-overrun-22',
        severity: 'warning',
        category: 'Production',
        title: 'Osaka will overrun production',
        detail: 'Galley is projected to waste 8 shields in 1 turn.',
        tab: 'production',
        subtab: '',
      },
      {
        id: 'buy-resource',
        severity: 'opportunity',
        category: 'Trade',
        title: 'Resources are for sale from 2 civs',
        detail: 'Aztecs: Incense, Gems; Mongols: Incense',
        tab: 'trade',
        subtab: 'buy',
      },
      {
        id: 'sell-tech',
        severity: 'opportunity',
        category: 'Trade',
        title: 'We can sell technology to 9 civs',
        detail: 'Greece: The Republic, Theology, Chivalry; Germany: Theology, Chivalry; England: Theology, Chivalry; Persia: Theology, Chivalry; and 5 more',
        tab: 'trade',
        subtab: 'sell',
      },
      {
        id: 'sell-resource',
        severity: 'opportunity',
        category: 'Trade',
        title: 'We can sell resources to 6 civs',
        detail: 'Germany: Horses, Iron, Salt and 1 more; Persia: Horses, Gold; Spain: Wines, Gold; China: Iron, Wines, Stone; and 2 more',
        tab: 'trade',
        subtab: 'sell',
      },
      {
        id: 'will-talk',
        severity: 'opportunity',
        category: 'Diplomacy',
        title: '3 enemies are willing to negotiate',
        detail: 'Persia, Spain, Aztecs',
        tab: 'diplomacy',
        subtab: '',
      },
      {
        id: 'production-overrun-0',
        severity: 'info',
        category: 'Production',
        title: 'Kyoto will overrun production',
        detail: 'Samurai is projected to waste 10 shields in 2 turns.',
        tab: 'production',
        subtab: '',
      },
      {
        id: 'rival-cash',
        severity: 'info',
        category: 'Trade',
        title: '1 rival has notable cash',
        detail: 'Persia: 84 gold',
        tab: 'trade',
        subtab: 'sell',
      },
    ]
  );
  assert.deepEqual(report.alerts.current.find((alert) => alert.id === 'sell-tech').refs.slice(0, 3).map((ref) => ref.name), [
    'The Republic', 'Theology', 'Chivalry'
  ]);
  assert.deepEqual(
    report.alerts.current.find((alert) => alert.id === 'buy-resource').detailRows.map((row) => ({
      label: row.label,
      items: row.items.map((item) => item.name),
    })),
    [
      { label: 'Aztecs', items: ['Incense', 'Gems'] },
      { label: 'Mongols', items: ['Incense'] },
    ]
  );
  const sellTechAlert = report.alerts.current.find((alert) => alert.id === 'sell-tech');
  assert.equal(sellTechAlert.detailRows[0].label, 'Greece');
  assert.deepEqual(sellTechAlert.detailRows[0].items.map((item) => item.name), ['The Republic', 'Theology', 'Chivalry']);
  const sellResourceAlert = report.alerts.current.find((alert) => alert.id === 'sell-resource');
  assert.deepEqual(
    sellResourceAlert.detailRows.find((row) => row.label === 'China').items.map((item) => item.name),
    ['Iron', 'Wines', 'Stone']
  );
  assert.deepEqual(
    report.alerts.coverage.map((row) => ({ id: row.id, label: row.label, status: row.status, tab: row.tab })),
    [
      { id: 'trade', label: 'Trade opportunities and expiring deals', status: 'Active', tab: 'trade' },
      { id: 'diplomacy', label: 'Enemies willing to negotiate', status: 'Active', tab: 'diplomacy' },
      { id: 'production', label: 'Production overrun', status: 'Active', tab: 'production' },
      { id: 'economy', label: 'Treasury and city deficits', status: 'Active', tab: 'economy' },
      { id: 'research', label: 'Research completion overrun', status: 'Active', tab: 'techs' },
      { id: 'cities', label: 'City riot and pollution warnings', status: 'Active', tab: 'cities' },
      { id: 'military', label: 'Damaged units', status: 'Active', tab: 'military' },
    ]
  );
  assert.ok(report.alerts.coverage.every((row) => row.status !== 'Planned'));

  assert.deepEqual(report.territory.exploration, {
    worldTiles: 5000,
    exploredTiles: 1461,
    exploredPercent: '29.2%',
    land: 539,
    landPercent: '36.9%',
    water: 922,
    waterPercent: '63.1%',
  });
  assert.deepEqual(report.territory.territory, {
    dominationLimit: '?',
    tilesOwned: 199,
    dominationTiles: 185,
    tilesToLimit: '?',
    unclaimedTiles: '?',
    citizensLimit: 24,
    citizensLimitPercent: '31.2%',
    districtInstances: 90,
    ownedLandDistricts: 40,
  });
  assert.deepEqual(report.territory.statistics, {
    cities: 2,
    citizens: 24,
    specialists: 0,
    tilesPerCity: '99.5',
    workerCount: 6,
    nativeWorkers: 5,
    nativeWorkersPercent: '83.3%',
    slaveWorkers: 1,
    slaveWorkersPercent: '16.7%',
    workersPerCity: '3.0',
    tilesPerWorker: '25.7',
  });
  assert.deepEqual(
    report.territory.improvementRows.map((row) => ({ label: row.label, worked: row.worked, unworked: row.unworked })),
    [
      { label: 'All Tiles', worked: 26, unworked: 128 },
      { label: 'Roaded', worked: 26, unworked: 81 },
      { label: 'Irrigated', worked: 14, unworked: 8 },
      { label: 'Mined', worked: 10, unworked: 12 },
      { label: 'Unroaded', worked: 0, unworked: 47 },
      { label: 'Unrailed', worked: 26, unworked: 80 },
      { label: 'Jungle or Marsh', worked: 0, unworked: 0 },
    ]
  );

  assert.deepEqual(
    report.general.rivals.map((row) => ({
      nation: row.nation,
      tabKey: row.currentEraRef.tabKey,
      sectionCode: row.currentEraRef.sectionCode,
      biqIndex: row.currentEraRef.biqIndex,
      name: row.currentEraRef.name,
      sourceSignature: row.currentEraRef.sourceSignature,
    })),
    [
      { nation: 'Greece', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 1, name: 'Middle Ages', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'Germany', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 1, name: 'Middle Ages', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'England', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 1, name: 'Middle Ages', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'Persia', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 1, name: 'Middle Ages', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'City of Sparta', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 0, name: 'Ancient Times', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'Spain', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 0, name: 'Ancient Times', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'China', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 1, name: 'Middle Ages', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'Aztecs', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 0, name: 'Ancient Times', sourceSignature: report.ruleSignatures.ERAS },
      { nation: 'Mongols', tabKey: 'world', sectionCode: 'ERAS', biqIndex: 0, name: 'Ancient Times', sourceSignature: report.ruleSignatures.ERAS },
    ]
  );
});

test('Civ Advisor can inspect the same save from another active civ perspective', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE)) {
    t.skip('Tokugawa 740 AD reference save is not available.');
    return;
  }

  const defaultReport = inspectCivAssistSaveFile(TOKUGAWA_SAVE);
  assert.equal(defaultReport.ok, true, defaultReport.error);
  assert.equal(defaultReport.humanPlayerID, 1);
  assert.equal(defaultReport.selectedPlayerID, 1);
  assert.equal(defaultReport.viewingCiv.nation, 'Japan');
  assert.ok((defaultReport.viewingOptions || []).some((row) => row.nation === 'Rome' && row.playerID === 2 && !row.isHuman));

  const romeReport = inspectCivAssistSaveFile(TOKUGAWA_SAVE, { selectedPlayerID: 2 });
  assert.equal(romeReport.ok, true, romeReport.error);
  assert.equal(romeReport.humanPlayerID, 1, 'the actual human player should remain identified separately');
  assert.equal(romeReport.selectedPlayerID, 2);
  assert.equal(romeReport.viewingCiv.nation, 'Rome');

  const player = fieldMap(romeReport.general.playerInfo);
  assert.equal(player.get('Civilization').value, 'Rome');
  assert.equal(player.get('Capital').value, 'Rome');
  assert.deepEqual(
    romeReport.cities.rows.map((row) => row.city).sort(),
    ['Nassau', 'Paris', 'Rome', 'Thebes'].sort(),
    'Cities tab rows should switch to the selected player city set'
  );
  assert.deepEqual(
    romeReport.territory.cityRows.map((row) => row.city).sort(),
    ['Nassau', 'Paris', 'Rome', 'Thebes'].sort(),
    'Territory city rows should switch to the selected player city set'
  );
  assert.ok(
    romeReport.general.rivals.some((row) => row.nation === 'Japan'),
    'the original player should become a rival when inspecting another civ'
  );

  const allReport = inspectCivAssistSaveFile(TOKUGAWA_SAVE, { selectedPlayerID: -1 });
  assert.equal(allReport.ok, true, allReport.error);
  assert.equal(allReport.selectedPlayerID, -1);
  assert.equal(allReport.viewingCiv.nation, 'All Civs');
  assert.equal(allReport.cities.allCivs, true);
  assert.ok(allReport.cities.rows.length > defaultReport.cities.rows.length);
  assert.ok(allReport.cities.rows.some((row) => row.city === 'Kyoto' && row.civ === 'Japan'));
  assert.ok(allReport.cities.rows.some((row) => row.city === 'Rome' && row.civ === 'Rome'));
  assert.equal(allReport.culture.allCivs, true);
  assert.ok(allReport.culture.cities.some((row) => row.name === 'Kyoto' && row.civ === 'Japan'));
  assert.ok(allReport.culture.cities.some((row) => row.name === 'Rome' && row.civ === 'Rome'));
  assert.equal(allReport.territory.allCivs, true);
  assert.ok(allReport.territory.cityRows.some((row) => row.city === 'Kyoto' && row.civ === 'Japan'));
  assert.ok(allReport.territory.cityRows.some((row) => row.city === 'Rome' && row.civ === 'Rome'));
  assert.equal(allReport.economy.allCivs, true);
  assert.ok(allReport.economy.cityRows.some((row) => row.name === 'Kyoto' && row.civ === 'Japan'));
  assert.ok(allReport.economy.cityRows.some((row) => row.name === 'Rome' && row.civ === 'Rome'));
  assert.equal(allReport.production.allCivs, true);
  assert.ok(allReport.production.rows.some((row) => row.city === 'Kyoto' && row.civ === 'Japan'));
  assert.ok(allReport.production.rows.some((row) => row.city === 'Rome' && row.civ === 'Rome'));
});

test('Civ Advisor table links fill their columns and trade continuation rows omit empty civ chips', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(
    renderer,
    /if \(String\(row\.nation \|\| ''\)\.trim\(\)\) \{[\s\S]*?makeCivAssistReferenceChip\(row\.nationRef, row\.nation,[\s\S]*?\} else \{[\s\S]*?civassist-trade-continuation/,
    'blank timed-trade continuation rows should not render an empty civilization chip'
  );
  assert.match(
    styles,
    /\.civassist-rival-table td > \.civassist-ref-chip\s*\{[\s\S]*?width: 100%;[\s\S]*?justify-content: flex-start;/,
    'civilization, government, and era chips should fill their table columns'
  );
  assert.match(
    renderer,
    /const isCivChip = !!options\.civChip[\s\S]*?target\.tabKey === 'civilizations'/,
    'Civ Advisor should centrally detect civilization reference chips'
  );
  assert.match(
    renderer,
    /if \(isCivChip\) button\.classList\.add\('civassist-civ-chip'\)/,
    'linked civilization chips should get the fixed-width civ chip class'
  );
  assert.match(
    styles,
    /\.civassist-civ-chip\s*\{[\s\S]*?width: min\(150px, 100%\);/,
    'civilization thumbnail chips should have a consistent visual length'
  );
});

test('Civ Advisor Economy and Production tabs render saved-state reports', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(renderer, /function renderCivAssistEconomy\(report\) \{[\s\S]*?City Economy[\s\S]*?sortCivAssistRows\(economy\.cityRows \|\| \[\][\s\S]*?makeCivAssistCityName\(row, row\.name\)/);
  assert.doesNotMatch(renderer, /selectedEconomyBuildingIndex/);
  assert.doesNotMatch(renderer, /getCivAssistEconomyBuildingStatus/);
  assert.doesNotMatch(styles, /civassist-economy-building-picker|civassist-economy-building-status|building-status/);
  assert.match(renderer, /function renderCivAssistProduction\(report\) \{[\s\S]*?search\.placeholder = 'Search Production\.\.\.'[\s\S]*?state\.civAssist\.productionSearch = search\.value[\s\S]*?makeCivAssistCityName\(row, row\.city \|\| ''\)[\s\S]*?makeCivAssistReferenceChip\(row\.producingRef, row\.producing\)[\s\S]*?civassist-production-progress/);
  assert.doesNotMatch(renderer, /heading\.textContent = 'City Production'/);
  assert.match(renderer, /\{ key: 'economy', label: 'Economy' \}/);
  assert.match(renderer, /\{ key: 'production', label: 'Production' \}/);
  assert.match(renderer, /state\.civAssist\.activeTab === 'production'[\s\S]*?renderCivAssistProduction\(report\)/);
  assert.match(
    renderer,
    /if \(code === 'PRTO'\) \{[\s\S]*?state\.bundle\.biq[\s\S]*?rawSection\.records/,
    'unit links should compare against raw BIQ PRTO records rather than synthetic Units-tab entries'
  );
  assert.match(styles, /\.civassist-production-table\s*\{[\s\S]*?min-width: 1180px/);
  assert.doesNotMatch(styles, /civassist-production-card/);
});

test('Civ Advisor Diplomacy tab renders verified diplomacy without coverage notes', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(renderer, /function renderCivAssistDiplomacy\(report\) \{[\s\S]*?Diplomacy Summary[\s\S]*?Diplomacy Info/);
  assert.doesNotMatch(renderer, /Coverage Notes/);
  assert.match(renderer, /sortCivAssistRows\(diplomacy\.rows \|\| \[\], columns, 'diplomacy'\)/);
  assert.match(renderer, /\{ key: 'diplomacy', label: 'Diplomacy' \}/);
  assert.match(renderer, /state\.civAssist\.activeTab === 'diplomacy'[\s\S]*?renderCivAssistDiplomacy\(report\)/);
  assert.match(styles, /\.civassist-tab\[data-tab-key="diplomacy"\]\.active/);
  assert.match(styles, /\.civassist-diplomacy\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
});

test('Civ Advisor Territory tab renders exploration and improvement stats', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(renderer, /el\.civAssistModalTitle\.textContent = 'Civ Advisor'/);
  assert.doesNotMatch(renderer, /Civ Advisor -/);
  assert.doesNotMatch(renderer, /Viewing selected save:/);
  assert.match(renderer, /formatCivAssistCountPercent\(exploration\.exploredTiles \|\| 0, exploration\.exploredPercent\)/);
  assert.match(renderer, /function renderCivAssistTerritory\(report\) \{[\s\S]*?Exploration[\s\S]*?Tile Improvements[\s\S]*?City Territory/);
  assert.match(renderer, /bucketHead\.textContent = 'Tiles'[\s\S]*?\['Worked', 'worked'\][\s\S]*?\['Unworked', 'unworked'\]/);
  assert.match(renderer, /\{ key: 'territory', label: 'Territory' \}/);
  assert.match(renderer, /state\.civAssist\.activeTab === 'territory'[\s\S]*?renderCivAssistTerritory\(report\)/);
  assert.match(styles, /\.civassist-tab\[data-tab-key="territory"\]\.active/);
  assert.match(styles, /\.civassist-territory\s*\{[\s\S]*?grid-template-rows: auto auto minmax\(150px, 1fr\)/);
  assert.match(styles, /\.civassist-territory-improvements-table col:nth-child\(n\+2\)/);
  assert.doesNotMatch(renderer, /civassist-territory-(?:row-note|caveats)/);
  assert.doesNotMatch(styles, /civassist-territory-(?:row-note|caveats)/);
});

test('Civ Advisor Military tab separates roster and individual-unit views', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(renderer, /function renderCivAssistMilitary\(report\) \{[\s\S]*?Unit Types \(\$\{\(military\.roster \|\| \[\]\)\.length\}\)[\s\S]*?Individual Units \(\$\{\(military\.units \|\| \[\]\)\.length\}\)/);
  assert.match(renderer, /function renderCivAssistMilitaryRoster\(military\) \{[\s\S]*?Search Unit Types\.\.\.[\s\S]*?state\.civAssist\.militaryRosterSearch = search\.value[\s\S]*?\{ key: 'civText', label: 'Civ', className: 'civ' \}[\s\S]*?row\.upgradeRef[\s\S]*?row\.experienceMix[\s\S]*?appendCivAssistMilitaryCivs\(civ, row\.civs\)/);
  assert.match(renderer, /function renderCivAssistMilitaryUnits\(military\) \{[\s\S]*?Search Individual Units\.\.\.[\s\S]*?state\.civAssist\.militaryUnitsSearch = search\.value[\s\S]*?\{ key: 'nationality', label: 'Civ', className: 'nationality' \}[\s\S]*?row\.health[\s\S]*?row\.movement[\s\S]*?row\.nationalityRef/);
  assert.match(renderer, /function refocusCivAssistMilitaryRosterSearch\(value, selectionStart, selectionEnd\)/);
  assert.match(renderer, /function refocusCivAssistMilitaryUnitsSearch\(value, selectionStart, selectionEnd\)/);
  assert.doesNotMatch(renderer, /appendCivAssistMilitarySummary|Force Roster|Roster \(\$\{|label: 'Nationality'|civassist-military-filter|All unit types|military-units-\$\{/);
  assert.match(renderer, /\{ key: 'military', label: 'Military' \}/);
  assert.match(renderer, /activeMilitarySubtab: \['roster', 'units'\]\.includes/);
  assert.match(renderer, /function civAssistRefMatchesCurrentRecord\(ref, currentSignature\) \{[\s\S]*?sourceRecord[\s\S]*?currentRecord/);
  assert.match(renderer, /sectionCode === 'PRTO' && \([\s\S]*?civAssistRefMatchesCurrentRecord\(ref, currentSignature\)[\s\S]*?civAssistRefMatchesFoldedCurrentRecord\(ref, currentSignature\)/);
  assert.match(renderer, /function getCivAssistRecordSignatureIndex\(record, fallbackIndex\) \{[\s\S]*?record && record\.biqIndex[\s\S]*?Number\(raw\)/);
  assert.match(renderer, /function getCivAssistRecordIdentityValue\(record, key\) \{[\s\S]*?record\.displayCivilopediaKey[\s\S]*?record\.civilopediaKey/);
  assert.match(renderer, /function civAssistRefMatchesFoldedCurrentRecord\(ref, currentSignature\) \{[\s\S]*?currentSignature\.count[\s\S]*?sourceSignature\.count[\s\S]*?sourceValues/);
  assert.match(renderer, /function getCivAssistReferenceEntry\(ref\) \{[\s\S]*?const sourceValues = getCivAssistRefSourceValues\(ref\)[\s\S]*?bySourceIdentity/);
  assert.match(renderer, /if \(byIndex\) \{[\s\S]*?civAssistReferenceEntryMatchesSource\(ref, byIndex\)[\s\S]*?return byIndex/);
  assert.match(renderer, /function getCivAssistLinkTarget\(ref\) \{[\s\S]*?civAssistReferenceEntryMatchesSource\(ref, entry\)[\s\S]*?type: 'reference'/);
  assert.match(renderer, /button\.dataset\.subtabKey = tab\.key/);
  assert.match(styles, /\.civassist-military\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.civassist-military-controls\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent/);
  assert.match(styles, /\.civassist-military-roster-table col\.civ \{ width: 12%; \}/);
  assert.match(styles, /\.civassist-military-roster-search,\s*\.civassist-military-units-search\s*\{[\s\S]*?width: min\(640px, 100%\)/);
  assert.doesNotMatch(styles, /civassist-military-summary|civassist-military-filter/);
  assert.match(styles, /\.civassist-subtab\[data-subtab-key="roster"\]\.active,\s*\.civassist-subtab\[data-subtab-key="units"\]\.active/);
});

test('Civ Advisor Alerts tab groups current alerts without foregrounding the app', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const renderAlertsStart = renderer.indexOf('function renderCivAssistAlerts(report)');
  const renderAlertsEnd = renderer.indexOf('function renderCivAssistModal()', renderAlertsStart);
  const renderAlertsBody = renderer.slice(renderAlertsStart, renderAlertsEnd);
  assert.match(renderAlertsBody, /Alert Settings/);
  assert.match(renderAlertsBody, /renderCivAssistAlertCoverageRow\(row, currentRows\)/);
  assert.doesNotMatch(renderAlertsBody, /Current Alerts/);
  assert.doesNotMatch(renderer, /statusHeading\.textContent = 'Save Status'/);
  assert.match(renderer, /function renderCivAssistTabAlertBanner\(report, tabKey\) \{[\s\S]*?getCivAssistTabAlerts\(report, tabKey\)[\s\S]*?civassist-tab-alerts/);
  assert.match(renderer, /function renderCivAssistAlertCoverageRow\(coverage, currentRows\) \{[\s\S]*?checkbox\.type = 'checkbox'[\s\S]*?setCivAssistAlertCoverageEnabled/);
  assert.match(renderer, /function civAssistCoverageMatchesAlert\(coverage, alert\) \{/);
  assert.match(renderer, /function getCivAssistAlertCoverageRows\(report\) \{[\s\S]*?toLowerCase\(\) === 'active'/);
  assert.doesNotMatch(renderer, /<th>Check<\/th><th>Status<\/th><th>Notes<\/th>/);
  assert.match(renderer, /count: tab\.key === 'alerts' \? 0 : getCivAssistTabAlerts\(report, tab\.key\)\.length/);
  assert.match(renderer, /function applyCivAssistAlertTarget\(alert\) \{[\s\S]*?state\.civAssist\.activeTradeSubtab = String\(alert\.subtab\)/);
  assert.match(renderer, /activeAlertID/);
  assert.match(renderer, /civassist-tab-count dirty-dot-badge dirty-count-badge/);
  assert.doesNotMatch(renderer, /BrowserWindow\.getFocusedWindow\(\)\.focus\(\)/);
  assert.match(styles, /\.civassist-tab-alerts\s*\{/);
  assert.match(styles, /\.civassist-alert-coverage-row input\s*\{/);
  assert.match(styles, /\.civassist-tab\[data-tab-key="alerts"\]\.active/);
});

test('Civ Advisor tables expose Unit Table-style sortable headers', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const loadSaveStart = renderer.indexOf('async function loadCivAssistSave');
  const loadSaveEnd = renderer.indexOf('function getCivAssistReferenceEntry', loadSaveStart);
  const loadSaveBody = renderer.slice(loadSaveStart, loadSaveEnd);
  assert.match(
    renderer,
    /function appendCivAssistSortableHeaderCell\(headerRow, tableKey, column\) \{[\s\S]*?button\.className = 'civassist-sort-header-btn'[\s\S]*?aria-sort[\s\S]*?renderCivAssistModal\(\);[\s\S]*?\}/,
    'Civ Advisor headers should use clickable sort buttons with aria-sort state'
  );
  assert.match(
    renderer,
    /if \(sameColumn && current\.direction === 'desc'\) \{[\s\S]*?delete state\.civAssist\.sortState\[key\];[\s\S]*?return;[\s\S]*?\}/,
    'clicking a sorted Civ Advisor column a third time should return the table to unsorted report order'
  );
  assert.match(
    renderer,
    /loadCivAssistSave\(latest\.path, \{ saveMeta: latest, fingerprint, automatic: true \}\)/,
    'automatic latest-save refresh should reuse the normal Civ Advisor save load path'
  );
  assert.match(
    renderer,
    /window\.c3xManager\.inspectCivAssistSave\(\{\s*filePath: target,\s*selectedPlayerID\s*\}\)/,
    'Civ Advisor save inspection should pass the selected player ID so auto-refresh preserves the selected civ perspective'
  );
  assert.match(
    renderer,
    /function renderCivAssistViewingSelector\(report\) \{[\s\S]*?createReferencePicker\(\{[\s\S]*?includeNone: true,[\s\S]*?noneLabel: 'All Civs'[\s\S]*?pickerClassName: 'civassist-viewing-civ-picker'[\s\S]*?loadCivAssistSave\(state\.civAssist\.savePath/,
    'Civ Advisor should render a structured global viewing-civ selector with All Civs and reload the current save for that player'
  );
  assert.match(
    renderer,
    /function getCivAssistViewingOptions\(report\) \{[\s\S]*?const civEntryByIndex = new Map\(getCivilizationBitmaskOptions\(\)[\s\S]*?entry: civEntryByIndex\.get\(String\(item\.raceID\)\) \|\| null/,
    'Civ Advisor viewing-civ options should use live civilization entries so the structured picker can show leader thumbnails'
  );
  assert.match(renderer, /selectedPlayerID: 0,/);
  assert.match(renderer, /label\.textContent = 'Civ'/);
  assert.doesNotMatch(renderer, /item\.isHuman \? 'Human'|getOptionMetaText: \(option\) => option && option\.meta/);
  assert.match(
    renderer,
    /function renderCivAssistViewingCivThumb\(holder, option\) \{[\s\S]*?if \(option\.entry\) \{[\s\S]*?loadReferenceListThumbnail\('civilizations', option\.entry, holder\)/,
    'Civ Advisor viewing-civ selector should render leader thumbnails from live civilization entries'
  );
  assert.match(
    renderer,
    /const columns = \[[\s\S]*?\.\.\.\(cities\.allCivs \? \[\{ key: 'civ', label: 'Civ'/,
    'Cities tab should add an owner Civ column when All Civs is selected'
  );
  assert.match(
    renderer,
    /const columns = \[[\s\S]*?\.\.\.\(territory\.allCivs \? \[\{ key: 'civ', label: 'Civ'/,
    'Territory city list should add an owner Civ column when All Civs is selected'
  );
  assert.match(
    renderer,
    /const columns = \[[\s\S]*?\.\.\.\(economy\.allCivs \? \[\{ key: 'civ', label: 'Civ'/,
    'Economy city list should add an owner Civ column when All Civs is selected'
  );
  assert.match(
    renderer,
    /const hasAllCivs = !!production\.allCivs;[\s\S]*const columns = \[[\s\S]*?\.\.\.\(hasAllCivs \? \[\{ key: 'civ', label: 'Civ'/,
    'Production city list should add an owner Civ column when All Civs is selected'
  );
  assert.match(styles, /\.civassist-territory-city-table col\.civ \{ width: 12%; \}/);
  assert.match(styles, /\.civassist-economy-table col\.civ \{ width: 12%; \}/);
  assert.match(styles, /\.civassist-production-table col\.civ \{ width: 12%; \}/);
  assert.match(
    renderer,
    /state\.civAssist\.selectedPlayerID = Number\.isFinite\(resolvedPlayerID\) && \(resolvedPlayerID > 0 \|\| resolvedPlayerID === -1\)[\s\S]*?state\.civAssist\.report = result/,
    'loaded Civ Advisor reports should sync selectedPlayerID from the backend fallback-aware result'
  );
  assert.match(
    loadSaveBody,
    /state\.civAssist\.report = result;[\s\S]*?state\.civAssist\.loadedFingerprint =/,
    'loading a new Civ Advisor save should replace report data and metadata'
  );
  assert.doesNotMatch(
    loadSaveBody,
    /sortState/,
    'loading a new Civ Advisor save should preserve the active table sort schema for the refreshed rows'
  );
  assert.match(
    renderer,
    /sortCivAssistRows\(general\.rivals \|\| \[\], columns, 'general-rivals'\)/,
    'Rival Info rows should be sorted through shared Civ Advisor sort state'
  );
  assert.match(
    renderer,
    /tableKey === 'trade-current'[\s\S]*?sortCivAssistCurrentTradeRows\(rows \|\| \[\], columns, tableKey\)/,
    'current trade sorting should use grouped rows so continuation deals stay attached'
  );
  assert.match(
    renderer,
    /const techRows = \(technology\.rows \|\| \[\]\)\.filter[\s\S]*?sortCivAssistRows\(techRows, columns, 'techs'\)/,
    'Tech table rows should be searchable before shared Civ Advisor sorting is applied'
  );
  assert.match(
    renderer,
    /search\.placeholder = 'Search Techs\.\.\.'[\s\S]*?state\.civAssist\.techSearch = search\.value/,
    'Tech table should expose a search box for filtering technology rows'
  );
  assert.match(
    renderer,
    /function refocusCivAssistTechSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civassist-tech-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Tech search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /function appendCivAssistKnownPills\(parent, items, emptyText = ''\)[\s\S]*?civassist-tech-known-pill/,
    'Known To should render compact non-link pills instead of full civilization reference chips'
  );
  assert.doesNotMatch(
    renderer,
    /\{ key: 'index', label: 'Index', num: true \}/,
    'Tech table should not render a separate index column'
  );
  assert.doesNotMatch(
    renderer,
    /tr\.append\(index, name, known, cost\)/,
    'Tech table rows should start with the technology cell, not a hidden index cell'
  );
  assert.match(
    renderer,
    /search\.className = 'app-search-input civassist-culture-search'[\s\S]*?search\.placeholder = 'Search Improvements & Wonders\.\.\.'[\s\S]*?state\.civAssist\.cultureSearch = search\.value/,
    'Culture table should expose a search box for filtering combined improvement and wonder rows'
  );
  assert.match(
    renderer,
    /function refocusCivAssistCultureSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civassist-culture-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Culture search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /const visibleRows = rows\.filter\(\(row\) => \{[\s\S]*?row\.wonder \? 'wonder' : ''[\s\S]*?appendCivAssistCultureTable\(wrap, search, visibleRows[\s\S]*?`culture-\$\{selectedID\}`\)/,
    'Culture should search and sort the selected city improvement and wonder rows together'
  );
  assert.doesNotMatch(
    renderer,
    /textContent = 'Show all improvements'|civassist-culture-show-all/,
    'Culture should not expose the ambiguous Show all improvements checkbox'
  );
  assert.doesNotMatch(
    renderer,
    /className = 'civassist-subtabs civassist-culture-subtabs'|culture-wonders|appendCivAssistCultureTable\(wrap, 'Wonders'/,
    'Culture should not split wonders into a separate subtab'
  );
  assert.match(
    renderer,
    /search\.placeholder = 'Search Cities\.\.\.'[\s\S]*?state\.civAssist\.citiesSearch = search\.value/,
    'Cities table should expose a search box for filtering city rows'
  );
  assert.match(
    renderer,
    /function refocusCivAssistCitiesSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civassist-cities-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Cities search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /el\.civAssistModalOverlay && !el\.civAssistModalOverlay\.classList\.contains\('hidden'\) && ev\.key === 'Escape'[\s\S]*?target instanceof HTMLInputElement[\s\S]*?target\.classList\.contains\('app-search-input'\)[\s\S]*?target\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)[\s\S]*?return;[\s\S]*?closeCivAssistModal\(\)/,
    'Escape in Civ Advisor search inputs should clear the search before the modal close branch can run'
  );
  assert.match(
    renderer,
    /const cityRows = \(cities\.rows \|\| \[\]\)\.filter[\s\S]*?sortCivAssistRows\(cityRows, columns, 'cities'\)/,
    'Cities rows should be searchable before shared Civ Advisor sorting is applied'
  );
  assert.match(
    renderer,
    /search\.placeholder = 'Search Production\.\.\.'[\s\S]*?state\.civAssist\.productionSearch = search\.value/,
    'Production table should expose a search box for filtering production rows'
  );
  assert.match(
    renderer,
    /function refocusCivAssistProductionSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civassist-production-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Production search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /const productionRows = \(production\.rows \|\| \[\]\)\.filter[\s\S]*?sortCivAssistRows\(productionRows, columns, 'production'\)/,
    'Production rows should be searchable before shared Civ Advisor sorting is applied'
  );
  assert.match(
    renderer,
    /function makeCivAssistCityThumb\(cityArt, label = ''\)[\s\S]*?drawCivAssistCityThumb\(canvas, cityArt\)/,
    'Civ Advisor city lists should render reusable city thumbnails from save-derived art metadata'
  );
  assert.match(
    renderer,
    /function makeCivAssistCityThumb\(cityArt, label = ''\)[\s\S]*?thumb\._civAssistCityArt = cityArt \|\| null;[\s\S]*?thumb\.dataset\.cityArtKey = getCivAssistCityArtKey\(cityArt\)/,
    'Civ Advisor city thumbnails should keep their city-art metadata so async PCX loads can hydrate first-render placeholders'
  );
  assert.match(
    renderer,
    /if \(CIV_ASSIST_CITY_ART_KEYS\.has\(pendingAssetKey\)\) \{[\s\S]*?refreshCivAssistCityThumbnails\(pendingAssetKey\)/,
    'Civ Advisor city art asset loads should hydrate mounted thumbnails without requiring a tab switch'
  );
  assert.match(
    renderer,
    /makeCivAssistCityPicker\(cities, selectedID[\s\S]*?makeCivAssistCityName\(selected, `\$\{selected\.name\} \(\$\{selected\.culture\}\)`\)/,
    'Culture should use a structured city dropdown so city thumbnails can appear beside city names'
  );
  assert.match(
    renderer,
    /td\.classList\.add\('civassist-city-name-cell'\);[\s\S]*?makeCivAssistCityName\(row, row\[column\.key\]\)/,
    'Cities table city cells should use the same thumbnail city-name component'
  );
  assert.match(
    styles,
    /\.civassist-sort-header-btn\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 14px;[\s\S]*?cursor: pointer;/,
    'Civ Advisor sortable headers should match the Unit Table button affordance'
  );
  assert.match(
    styles,
    /\.civassist-rival-table th\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0;[\s\S]*?z-index: 4;/,
    'Civ Advisor table headers should stay visible while scrolling table bodies'
  );
  assert.match(
    styles,
    /\.civassist-rival-table th:first-child,\s*\.civassist-rival-table td:first-child\s*\{[\s\S]*?position: sticky;[\s\S]*?left: 0;/,
    'Civ Advisor first columns should stay visible during horizontal table scrolling'
  );
  assert.match(
    styles,
    /\.civassist-rival-table th:first-child\s*\{[\s\S]*?z-index: 6;/,
    'Civ Advisor sticky header corner should layer above both header and first-column cells'
  );
  assert.match(
    styles,
    /\.civassist-modal-body\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/,
    'Civ Advisor should use inner table scrolling instead of a second modal-body scrollbar'
  );
  assert.match(
    styles,
    /\.civassist-viewing-strip\s*\{[\s\S]*?margin-left: auto;/,
    'Civ Advisor viewing-civ selector should share the tab row and align to the right'
  );
  assert.match(
    styles,
    /\.civassist-viewing-civ-picker \.tech-picker-btn\s*\{[\s\S]*?min-height: 34px;[\s\S]*?font-weight: 800;/,
    'Civ Advisor viewing-civ selector should customize sizing without overriding shared structured-picker corners'
  );
  assert.match(styles, /\.civassist-viewing-civ-picker\s*\{[\s\S]*?width: 200px;[\s\S]*?max-width: 200px;/);
  assert.match(styles, /\.civassist-viewing-civ-picker-menu\s*\{[\s\S]*?width: 200px;[\s\S]*?min-width: 200px;/);
  assert.doesNotMatch(styles, /\.civassist-viewing-civ-picker [^{]+\{[^}]*border-radius:\s*999px;/);
  assert.match(
    styles,
    /\.civassist-tech-progress th,\s*\.civassist-tech-progress td\s*\{[\s\S]*?border: 1px solid rgba\(72, 84, 121, 0\.14\);/,
    'Techs research progress cells should have thin borders so the summary reads as a table'
  );
  assert.match(
    styles,
    /\.civassist-tech-summary-list\s*\{[\s\S]*?align-items: center;/,
    'Techs research summary label/value rows should align centered'
  );
  assert.match(
    styles,
    /\.civassist-tech-known-pill\s*\{[\s\S]*?border-radius: 999px;/,
    'Known To civ names should use compact pill styling'
  );
  assert.doesNotMatch(
    styles,
    /\.civassist-tech-search\s*\{[^}]*font-size:/,
    'Techs search should inherit the shared app-search-input font sizing'
  );
  assert.doesNotMatch(
    styles,
    /\.civassist-cities-search\s*\{[^}]*font-size:/,
    'Cities search should inherit the shared app-search-input font sizing'
  );
  assert.doesNotMatch(
    styles,
    /\.civassist-production-search\s*\{[^}]*font-size:/,
    'Production search should inherit the shared app-search-input font sizing'
  );
});

test('CivAssist Tokugawa save rule signatures match Instafluff scenario BIQ', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE) || !fs.existsSync(INSTAFLUFF_BIQ)) {
    t.skip('Tokugawa save or Instafluff scenario BIQ is not available.');
    return;
  }

  const report = inspectCivAssistSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);
  const parsed = parseAllSections(fs.readFileSync(INSTAFLUFF_BIQ));
  assert.equal(parsed.ok, true, parsed.error);

  for (const code of ['RACE', 'TECH', 'BLDG', 'PRTO', 'GOVT', 'GOOD', 'ERAS']) {
    assert.deepEqual(
      report.ruleSignatures[code],
      makeRuleSectionSignature(code, section(parsed, code).records),
      `${code} signature should match Instafluff scenario rules`
    );
  }
});

test('CivAssist Tokugawa save rule signatures match loaded Instafluff editor bundle', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE) || !fs.existsSync(INSTAFLUFF_BIQ) || !fs.existsSync(CIV3_ROOT)) {
    t.skip('Tokugawa save, Instafluff BIQ, or Civ3 root is not available.');
    return;
  }

  const report = inspectCivAssistSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath: INSTAFLUFF_BIQ,
  });

  for (const code of ['RACE', 'TECH', 'BLDG', 'PRTO', 'GOVT', 'GOOD', 'ERAS']) {
    assert.deepEqual(
      report.ruleSignatures[code],
      makeRuleSectionSignature(code, projectedBundleRecords(bundle, code)),
      `${code} signature should match the loaded Instafluff editor bundle`
    );
  }
});

test('Civ Advisor unit refs from Tokugawa save resolve to visible Instafluff unit thumbnails', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE) || !fs.existsSync(INSTAFLUFF_BIQ) || !fs.existsSync(CIV3_ROOT)) {
    t.skip('Tokugawa save, Instafluff BIQ, or Civ3 root is not available.');
    return;
  }

  const report = inspectCivAssistSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath: INSTAFLUFF_BIQ,
  });

  const refs = [];
  for (const row of report.production.rows || []) refs.push(['production', row.producing, row.producingRef]);
  for (const row of report.military.roster || []) {
    refs.push(['military roster', row.name, row.ref]);
    if (row.upgradeRef) refs.push(['military upgrade', row.upgrade, row.upgradeRef]);
  }
  for (const row of report.military.units || []) refs.push(['military unit', row.type, row.typeRef]);

  assert.ok(refs.length > 0, 'fixture should contain unit references');
  for (const [kind, label, ref] of refs) {
    const entry = civAssistTestFindUnitEntry(bundle, ref);
    assert.ok(entry, `${kind} ${label} should resolve to a visible Units-tab entry`);
    assert.ok(entry.thumbPath, `${kind} ${label} should resolve to a Units-tab entry with thumbnail art`);
    if (label === 'Samurai') {
      assert.equal(entry.name, 'Samurai', 'save-only Samurai duplicate PRTO rows should not resolve to unrelated BIQ-index entries');
      assert.equal(entry.biqIndex, 59, 'save-only Samurai duplicate PRTO rows should resolve to the visible Samurai primary row');
    }
  }
});
