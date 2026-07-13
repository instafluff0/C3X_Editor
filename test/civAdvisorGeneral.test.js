'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { inspectCivAdvisorSaveFile, makeRuleSectionSignature, _test: civAdvisorInternals } = require('../src/biq/civAdvisor');
const { parseAllSections } = require('../src/biq/biqSections');
const { loadBundle } = require('../src/configCore');

const TOKUGAWA_SAVE = '/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 740 AD.SAV';
const TOKUGAWA_1498_SAVE = '/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 1498 AD.SAV';
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

function civAdvisorTestPrimitive(value) {
  if (Array.isArray(value)) return value.map(civAdvisorTestPrimitive).join('|');
  if (value == null) return '';
  return String(value).trim();
}

function civAdvisorTestRecordValue(record, key) {
  const wanted = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!record || !wanted) return '';
  if (wanted === 'civilopediaentry') {
    if (record.displayCivilopediaKey != null) return civAdvisorTestPrimitive(record.displayCivilopediaKey);
    if (record.civilopediaKey != null) return civAdvisorTestPrimitive(record.civilopediaKey);
  }
  if (Object.prototype.hasOwnProperty.call(record, key)) return civAdvisorTestPrimitive(record[key]);
  const directKey = Object.keys(record).find((candidate) => String(candidate || '').toLowerCase().replace(/[^a-z0-9]/g, '') === wanted);
  if (directKey) return civAdvisorTestPrimitive(record[directKey]);
  for (const fields of [record.fields || [], record.biqFields || []]) {
    const field = fields.find((item) => {
      const base = item && (item.baseKey || item.key || item.label);
      return String(base || '').toLowerCase().replace(/[^a-z0-9]/g, '') === wanted;
    });
    if (field) return civAdvisorTestPrimitive(field.value);
  }
  return '';
}

function civAdvisorTestRefSourceValues(ref) {
  const signature = ref && ref.sourceSignature;
  const targetIndex = Number(ref && ref.biqIndex);
  const records = signature && Array.isArray(signature.records) ? signature.records : [];
  const sourceRecord = records.find((record, fallbackIndex) => {
    const index = Number.isFinite(Number(record && record.index)) ? Number(record.index) : fallbackIndex;
    return index === targetIndex;
  });
  return sourceRecord && Array.isArray(sourceRecord.values) ? sourceRecord.values : [];
}

function civAdvisorTestUnitEntryValues(entry) {
  return [
    civAdvisorTestRecordValue(entry, 'name'),
    civAdvisorTestRecordValue(entry, 'civilopediaEntry'),
  ];
}

function civAdvisorTestValuesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function civAdvisorTestFindUnitEntry(bundle, ref) {
  const entries = bundle && bundle.tabs && bundle.tabs.units && Array.isArray(bundle.tabs.units.entries)
    ? bundle.tabs.units.entries
    : [];
  const targetIndex = Number(ref && ref.biqIndex);
  const sourceValues = civAdvisorTestRefSourceValues(ref);
  if (Number.isFinite(targetIndex) && targetIndex >= 0) {
    const byIndex = entries.find((entry, fallbackIndex) => [
      entry && entry.biqIndex,
      entry && entry.primaryBiqIndex,
      entry && entry.recordIndex,
      entry && entry.index,
      fallbackIndex,
    ].some((raw) => Number(raw) === targetIndex));
    if (byIndex && (sourceValues.length === 0 || civAdvisorTestValuesEqual(civAdvisorTestUnitEntryValues(byIndex), sourceValues))) {
      return byIndex;
    }
  }
  const bySourceIdentity = entries.find((entry) => civAdvisorTestValuesEqual(civAdvisorTestUnitEntryValues(entry), sourceValues));
  if (bySourceIdentity) return bySourceIdentity;
  const targetName = String(ref && ref.name || '').trim().toLowerCase();
  return entries.find((entry) => String(entry && entry.name || '').trim().toLowerCase() === targetName) || null;
}

test('Civ Advisor tech trade eligibility requires recipient prerequisites for Trade and Alerts', () => {
  const { canTradeTechToPlayer } = civAdvisorInternals;
  const techMasks = [
    1 << 1,
    0,
    1 << 1,
  ];
  const rawParsedTechs = [
    { name: 'Prereq', prerequisites: [-1, -1, -1, -1] },
    { name: 'Blocked Trade Tech', prerequisites: [0, -1, -1, -1] },
    { name: 'Open Trade Tech', prerequisites: [-1, -1, -1, -1] },
    { name: 'Cannot Be Traded Tech', prerequisites: [-1, -1, -1, -1], flags: 0x80000 },
  ];
  assert.equal(canTradeTechToPlayer(rawParsedTechs, techMasks, 1, 1), true);
  assert.equal(canTradeTechToPlayer(rawParsedTechs, techMasks, 2, 1), false);
  assert.equal(canTradeTechToPlayer(rawParsedTechs, techMasks, 2, 2), true);
  assert.equal(canTradeTechToPlayer(rawParsedTechs, techMasks, 1, 3), false);

  const uiShapedTechs = [
    { name: 'Prereq' },
    { name: 'Blocked Trade Tech', prerequisite1: 0, prerequisite2: -1, prerequisite3: -1, prerequisite4: -1 },
  ];
  assert.equal(canTradeTechToPlayer(uiShapedTechs, techMasks, 1, 1), true);
  assert.equal(canTradeTechToPlayer(uiShapedTechs, techMasks, 2, 1), false);
});

test('Civ Advisor save inspection accepts renderer district alert context', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE)) {
    t.skip('Tokugawa 740 AD reference save is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE, {
    districtAlertContext: {
      base: { enable_districts: 'true', enable_wonder_districts: 'true', city_work_radius: '2' },
      districts: [
        {
          index: 0,
          fields: [
            { key: 'name', value: 'City Center' },
            { key: 'buildable_on', value: 'Grassland, Plains' },
          ],
        },
      ],
      wonders: [],
    },
  });

  assert.equal(report.ok, true, report.error);
  assert.ok(Array.isArray(report.alerts.current));
});

test('Civ Advisor General tab matches Tokugawa 740 AD reference save', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE)) {
    t.skip('Tokugawa 740 AD reference save is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);

  const game = fieldMap(report.general.gameInfo);
  assert.equal(game.get('Game Version').value, 'C3C122');
  assert.equal(game.get('Embedded Scenario').value, 'Scenarios\\Instafluff_Scenario\\');
  assert.equal(game.get('C3X Save Data').value, 'Present (90 district instances)');
  assert.equal(report.saveMetadata.hasC3XSegment, true);
  assert.equal(report.saveMetadata.c3xDistrictInstanceCount, 90);
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
      { nation: 'City of Sparta', gold: 0, workers: 0, technologies: '(9) Ceremonial Burial, Iron Working, Mathematics...' },
      { nation: 'Spain', gold: 28, workers: 0, technologies: '(6) Map Making, Currency, The Republic...' },
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
      { nation: 'City of Sparta', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 9, buyOptions: 0 },
      { nation: 'Spain', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'War', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 8, buyOptions: 0 },
      { nation: 'China', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 2, canTrade: 'Yes', sellOptions: 5, buyOptions: 0 },
      { nation: 'Aztecs', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'War', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 7, buyOptions: 2 },
      { nation: 'Mongols', ourCulture: 'in awe of', theirCulture: 'disdainful of', contact: 'Yes', relation: 'Peace', willTalk: 'Yes', activeDeals: 0, canTrade: 'Yes', sellOptions: 8, buyOptions: 1 },
    ]
  );
  assert.ok(report.diplomacy.rows.every((row) => row.ourCultureRef && row.ourCultureRef.sectionCode === 'CULT'));
  assert.ok(report.diplomacy.rows.every((row) => row.theirCultureRef && row.theirCultureRef.sectionCode === 'CULT'));
  assert.ok(report.diplomacy.rows.every((row) => row.ourCultureRef.tabKey === 'rules' && row.theirCultureRef.tabKey === 'rules'));
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
  assert.equal(report.economy.currentGovernmentIndex, 4);
  assert.deepEqual(
    report.economy.governmentOptions.map((row) => ({ governmentIndex: row.governmentIndex, name: row.name, current: row.current, costPerUnit: row.costPerUnit })),
    [
      { governmentIndex: 0, name: 'Anarchy', current: false, costPerUnit: 1 },
      { governmentIndex: 1, name: 'Despotism', current: false, costPerUnit: 1 },
      { governmentIndex: 2, name: 'Monarchy', current: false, costPerUnit: 1 },
      { governmentIndex: 3, name: 'Communism', current: false, costPerUnit: 1 },
      { governmentIndex: 4, name: 'Republic', current: true, costPerUnit: 2 },
      { governmentIndex: 5, name: 'Democracy', current: false, costPerUnit: 1 },
      { governmentIndex: 6, name: 'Fascism', current: false, costPerUnit: 1 },
      { governmentIndex: 7, name: 'Feudalism', current: false, costPerUnit: 3 },
      { governmentIndex: 8, name: 'Algorithmic Governance', current: false, costPerUnit: 1 },
    ]
  );
  assert.deepEqual(
    report.economy.governmentPreviews
      .filter((row) => ['Monarchy', 'Republic', 'Feudalism'].includes(row.name))
      .map((row) => ({
        name: row.name,
        current: row.current,
        unitCosts: row.expenses.unitCosts,
        netGain: row.netGain,
        freeUnits: row.unitSupport.freeUnits,
        supportedUnits: row.unitSupport.supportedUnits,
        costPerUnit: row.unitSupport.costPerUnit,
      })),
    [
      { name: 'Monarchy', current: false, unitCosts: 29, netGain: 55, freeUnits: 8, supportedUnits: 29, costPerUnit: 1 },
      { name: 'Republic', current: true, unitCosts: 62, netGain: 3, freeUnits: 6, supportedUnits: 31, costPerUnit: 2 },
      { name: 'Feudalism', current: false, unitCosts: 99, netGain: -15, freeUnits: 4, supportedUnits: 33, costPerUnit: 3 },
    ]
  );
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
    report.economy.cityRows.map(({ buildingStatuses, cityArt, baseScience, baseLuxury, baseTaxes, addedScience, addedLuxury, addedTaxes, commerceSimulation, productionSimulation, ...row }) => ({
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
  const osakaEconomy = report.economy.cityRows.find((row) => row.name === 'Osaka');
  assert.deepEqual(
    {
      source: osakaEconomy.productionSimulation.source,
      rawProduction: osakaEconomy.productionSimulation.rawProduction,
      unmultipliedProduction: osakaEconomy.productionSimulation.unmultipliedProduction,
      productionMultiplier: osakaEconomy.productionSimulation.productionMultiplier,
      waste: osakaEconomy.productionSimulation.waste,
      inferenceAmbiguity: osakaEconomy.commerceSimulation.inferenceAmbiguity,
      rawCommerce: osakaEconomy.commerceSimulation.rawCommerce,
      grossCommerce: osakaEconomy.commerceSimulation.grossCommerce,
      corruption: osakaEconomy.commerceSimulation.corruption,
      wealthIncome: osakaEconomy.commerceSimulation.wealthIncome,
    },
    {
      source: 'saved-output-inferred',
      rawProduction: 21,
      unmultipliedProduction: 19,
      productionMultiplier: 4,
      waste: 2,
      inferenceAmbiguity: 2,
      rawCommerce: 42,
      grossCommerce: 48,
      corruption: 6,
      wealthIncome: 2,
    }
  );

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
        productionFacet: 'land',
        collected: 40, progressPercent: 57, perTurn: 20, remaining: 30, turns: 2,
        overrun: 10, overrunPercent: 50, waste: 0, wastePercent: 0,
        cityArt: { playerID: 1, raceID: 8, cultureGroup: 4, era: 1, population: 12, citySizeBucket: 2, hasPalace: true, hasWalls: false },
        producingRef: { tabKey: 'units', sectionCode: 'PRTO', biqIndex: 59, name: 'Samurai' },
      },
      {
        cityID: 22, city: 'Osaka', producing: 'Galley', orderType: 'Unit', cost: 30,
        productionFacet: 'sea',
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
    total: 10,
    critical: 0,
    warning: 5,
    opportunity: 4,
    info: 1,
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
        id: 'city-food-waste-0',
        severity: 'warning',
        category: 'Cities',
        title: 'Kyoto is wasting food',
        detail: 'Kyoto has filled its 40-food box but cannot grow past size 12.',
        tab: 'cities',
        subtab: '',
      },
      {
        id: 'production-overrun-0',
        severity: 'warning',
        category: 'Production',
        title: 'Kyoto has production overrun',
        detail: 'Kyoto will overrun 10 shields (50%) on Samurai.',
        tab: 'production',
        subtab: '',
      },
      {
        id: 'production-overrun-22',
        severity: 'warning',
        category: 'Production',
        title: 'Osaka has production overrun',
        detail: 'Osaka will overrun 8 shields (42%) on Galley.',
        tab: 'production',
        subtab: '',
      },
      {
        id: 'polluted-tiles',
        severity: 'warning',
        category: 'Territory',
        title: '1 polluted tile in our territory',
        detail: '#1: 78,18',
        tab: 'map',
        subtab: '',
      },
      {
        id: 'unconnected-resources',
        severity: 'warning',
        category: 'Resources',
        title: '1 resource in our territory is unconnected',
        detail: 'Wines: 2 sources',
        tab: 'territory',
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
  const unconnectedAlert = report.alerts.current.find((alert) => alert.id === 'unconnected-resources');
  assert.deepEqual(
    unconnectedAlert.detailRows.map((row) => ({ label: row.label, value: row.value })),
    [
      { label: 'Wines', value: '86,24; 85,25' },
    ]
  );
  assert.deepEqual(unconnectedAlert.mapTargets, [
    { x: 86, y: 24, label: 'Wines' },
    { x: 85, y: 25, label: 'Wines' },
  ]);
  assert.deepEqual(
    report.alerts.coverage.map((row) => ({ id: row.id, label: row.label, status: row.status, tab: row.tab })),
    [
      { id: 'trade-buy-tech', label: 'Techs we can buy', status: 'Active', tab: 'trade' },
      { id: 'trade-buy-resources', label: 'Resources we can buy', status: 'Active', tab: 'trade' },
      { id: 'trade-sell-tech', label: 'Techs we can sell', status: 'Active', tab: 'trade' },
      { id: 'trade-sell-resources', label: 'Resources we can sell', status: 'Active', tab: 'trade' },
      { id: 'trade-rival-cash', label: 'Rivals with notable cash', status: 'Active', tab: 'trade' },
      { id: 'trade-expiring', label: 'Expiring trade deals', status: 'Active', tab: 'trade' },
      { id: 'diplomacy', label: 'Enemies willing to negotiate', status: 'Active', tab: 'diplomacy' },
      { id: 'research-overrun', label: 'Research overrun', status: 'Active', tab: 'techs' },
      { id: 'economy-treasury', label: 'Treasury deficit', status: 'Active', tab: 'economy' },
      { id: 'economy-city-deficits', label: 'City local deficits', status: 'Active', tab: 'economy' },
      { id: 'city-starvation', label: 'Cities about to starve', status: 'Active', tab: 'cities' },
      { id: 'city-growth', label: 'Cities about to grow', status: 'Active', tab: 'cities' },
      { id: 'city-resistance', label: 'Cities in resistance', status: 'Active', tab: 'cities' },
      { id: 'city-food-waste', label: 'Cities wasting food', status: 'Active', tab: 'cities' },
      { id: 'city-production-overrun', label: 'City production overrun', status: 'Active', tab: 'production' },
      { id: 'resources', label: 'Unconnected resources', status: 'Active', tab: 'territory' },
      { id: 'city-worked-unimproved', label: 'Worked unimproved tiles', status: 'Active', tab: 'territory' },
      { id: 'polluted-tiles', label: 'Polluted tiles', status: 'Active', tab: 'territory' },
      { id: 'foreign-units', label: 'Foreign units in our territory', status: 'Active', tab: 'military' },
      { id: 'district-buildings', label: 'District buildings available', status: 'Active', tab: 'culture' },
      { id: 'district-wonders', label: 'Wonder district sites', status: 'Active', tab: 'culture' },
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
    dominationLimit: 1332,
    tilesOwned: 199,
    dominationTiles: 185,
    tilesToLimit: 1147,
    unclaimedTiles: 432,
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

  const defaultReport = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE);
  assert.equal(defaultReport.ok, true, defaultReport.error);
  assert.equal(defaultReport.humanPlayerID, 1);
  assert.equal(defaultReport.selectedPlayerID, 1);
  assert.equal(defaultReport.viewingCiv.nation, 'Japan');
  assert.ok((defaultReport.viewingOptions || []).some((row) => row.nation === 'Rome' && row.playerID === 2 && !row.isHuman));

  const romeReport = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE, { selectedPlayerID: 2 });
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

  const allReport = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE, { selectedPlayerID: -1 });
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
  assert.equal(allReport.military.allCivs, true);
  assert.equal(allReport.military.summary.total, 437);
  assert.equal(allReport.military.units.length, 437);
  assert.ok(allReport.military.summary.total > defaultReport.military.summary.total);
  assert.ok(allReport.military.units.some((row) => row.type === 'Samurai' && row.nationality === 'Japan'));
  assert.ok(allReport.military.units.some((row) => row.type === 'Worker' && row.nationality === 'Rome'));
  assert.ok(allReport.military.roster.some((row) => row.name === 'Samurai' && row.civText === 'Japan' && row.count === 15));
  assert.ok(allReport.military.roster.some((row) => row.name === 'Worker' && row.civText === 'Rome' && row.count === 9));
});

test('Civ Advisor lazily builds a player-perspective SAV map with explored and current visibility states', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE)) {
    t.skip('Tokugawa 740 AD reference save is not available.');
    return;
  }

  const normalReport = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE);
  assert.equal(normalReport.ok, true, normalReport.error);
  assert.equal(normalReport.map, null, 'normal advisor loads should not carry the full map payload');

  const japanReport = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE, { includeMap: true });
  assert.equal(japanReport.ok, true, japanReport.error);
  assert.equal(japanReport.map.perspectivePlayerID, 1);
  assert.equal(japanReport.map.perspectiveNation, 'Japan');
  assert.equal(japanReport.map.width, 100);
  assert.equal(japanReport.map.height, 100);
  assert.equal(japanReport.map.tiles.length, 5000);
  assert.deepEqual(
    [0, 1, 2].map((visibility) => japanReport.map.tiles.filter((tile) => tile.visibility === visibility).length),
    [3539, 1176, 285],
    'the reference save should retain distinct unexplored, explored-fogged, and currently-visible tile states'
  );
  assert.equal(japanReport.map.cities.length, 31);
  assert.equal(japanReport.map.units.length, 437);
  const japanMapPlayer = japanReport.map.support.players.find((player) => player.index === 1);
  assert.equal(japanMapPlayer.initialEra, 1);
  assert.equal(japanReport.map.support.eras[japanMapPlayer.initialEra].name, 'Middle Ages');

  const romeReport = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE, { selectedPlayerID: 2, includeMap: true });
  assert.equal(romeReport.map.perspectivePlayerID, 2);
  assert.equal(romeReport.map.perspectiveNation, 'Rome');
  assert.notDeepEqual(
    romeReport.map.tiles.map((tile) => tile.visibility),
    japanReport.map.tiles.map((tile) => tile.visibility),
    'changing the selected civilization should change the map perspective'
  );

  const allReport = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE, { selectedPlayerID: -1, includeMap: true });
  assert.equal(allReport.map.perspectivePlayerID, 1, 'All Civs should not reveal an omniscient map');
  assert.equal(allReport.map.perspectiveNation, 'Japan');
});

test('Civ Advisor map UI reuses the map renderer in read-only mode and lazy-loads its SAV payload', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'src', 'operationWorker.js'), 'utf8');
  assert.match(renderer, /\{ key: 'map', label: 'Map' \}/);
  assert.match(renderer, /renderBiqMapSection\(tab, tileSection, \{[\s\S]*?readOnly: true,[\s\S]*?advisorPerspective:/);
  assert.match(renderer, /const visibleOverlayPassItems = readOnly && advisorPerspective[\s\S]*?isAdvisorTileRemembered\(item\.record\)/);
  assert.match(renderer, /const drawUnitOverlay = \(record, geom, screenX, screenY\) => \{[\s\S]*?!isAdvisorTileCurrentlyVisible\(record\)/);
  assert.match(renderer, /drawAdvisorVisibilityOverlay[\s\S]*?drawAdvisorTargetOverlay/);
  assert.match(renderer, /includeMap: true/);
  assert.match(main, /includeMap: request\.includeMap === true/);
  assert.match(worker, /includeMap: payload && payload\.includeMap === true/);
  assert.match(styles, /\.civadvisor-map[\s\S]*?\.biq-map-toolbar\.read-only/);
});

test('Civ Advisor main and overlay buttons share the CA brown-gold treatment', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const overlayHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'civAdvisorOverlay.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(indexHtml, /id="civadvisor-toggle"[^>]*>CA<\/button>/);
  assert.match(main, /const CIV_ADVISOR_OVERLAY_SIZE = 38;/);
  assert.match(overlayHtml, /<span class="civ-advisor-button-mark" aria-hidden="true">CA<\/span>/);
  assert.doesNotMatch(overlayHtml, /<svg\b/);
  assert.match(
    overlayHtml,
    /button\s*\{[\s\S]*?width: 38px;[\s\S]*?height: 38px;[\s\S]*?border: 1px solid #9a8550;[\s\S]*?border-radius: 999px;[\s\S]*?background: linear-gradient\(180deg, #e1cf97 0%, #b99653 100%\);[\s\S]*?color: #56431d;/,
    'the Civ 3 overlay button should use the shared CA brown-gold visual treatment'
  );
  assert.match(
    styles,
    /\.civadvisor-fab\s*\{[\s\S]*?width: 38px;[\s\S]*?height: 38px;[\s\S]*?border: 1px solid #9a8550;[\s\S]*?color: #56431d;[\s\S]*?background: linear-gradient\(180deg, #e1cf97 0%, #b99653 100%\);/,
    'the main floating Civ Advisor button should use the same CA brown-gold visual treatment'
  );
});

test('Civ Advisor table links fill their columns and trade continuation rows omit empty civ chips', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(
    renderer,
    /if \(String\(row\.nation \|\| ''\)\.trim\(\)\) \{[\s\S]*?makeCivAdvisorReferenceChip\(row\.nationRef, row\.nation,[\s\S]*?\} else \{[\s\S]*?civadvisor-trade-continuation/,
    'blank timed-trade continuation rows should not render an empty civilization chip'
  );
  assert.match(
    styles,
    /\.civadvisor-rival-table td > \.civadvisor-ref-chip\s*\{[\s\S]*?width: 100%;[\s\S]*?justify-content: flex-start;/,
    'civilization, government, and era chips should fill their table columns'
  );
  assert.match(
    styles,
    /\.civadvisor-ref-chip,\s*[\r\n]\.civadvisor-ref-link-inline\s*\{[\s\S]*?cursor: pointer;/,
    'linked Civ Advisor reference chips should show a pointer cursor'
  );
  assert.match(
    styles,
    /\.civadvisor-ref-chip-unlinked\s*\{[\s\S]*?cursor: default;/,
    'unlinked Civ Advisor reference chips should keep the default cursor'
  );
  assert.match(
    renderer,
    /const isCivChip = !!options\.civChip[\s\S]*?target\.tabKey === 'civilizations'/,
    'Civ Advisor should centrally detect civilization reference chips'
  );
  assert.match(
    renderer,
    /if \(isCivChip\) button\.classList\.add\('civadvisor-civ-chip'\)/,
    'linked civilization chips should get the fixed-width civ chip class'
  );
  assert.match(
    styles,
    /\.civadvisor-civ-chip\s*\{[\s\S]*?width: min\(150px, 100%\);/,
    'civilization thumbnail chips should have a consistent visual length'
  );
});

test('Civ Advisor Economy and Production tabs render saved-state reports', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(renderer, /function renderCivAdvisorEconomy\(report\) \{[\s\S]*?City Economy[\s\S]*?sortCivAdvisorRows\(economy\.cityRows \|\| \[\][\s\S]*?makeCivAdvisorCityName\(row, row\.name\)/);
  assert.match(renderer, /economyPreviewGovernmentIndex: -1/);
  assert.match(renderer, /economyPreviewScienceRate: null[\s\S]*?economyPreviewLuxuryRate: null/);
  assert.match(renderer, /function getCivAdvisorEconomyRateSimulation\(economy\) \{[\s\S]*?savedScience[\s\S]*?savedLuxury[\s\S]*?rawStateScience == null \? NaN : Number\(rawStateScience\)[\s\S]*?rawStateLuxury == null \? NaN : Number\(rawStateLuxury\)[\s\S]*?taxes[\s\S]*?changed:/);
  assert.match(renderer, /function distributeCivAdvisorEconomyRates\(total, rates\) \{[\s\S]*?civAdvisorRateStep\(rates && rates\.science\)[\s\S]*?civAdvisorIntDiv\(scienceStep \* budgetable \+ 5, 10\)[\s\S]*?civAdvisorIntDiv\(luxuryStep \* budgetable \+ 5, 10\)[\s\S]*?budgetable - science - luxury/);
  assert.match(renderer, /function applyCivAdvisorEconomyCommerceMultipliers\(channels, simulation\) \{[\s\S]*?scienceMultiplier[\s\S]*?luxuryMultiplier[\s\S]*?taxMultiplier[\s\S]*?wealthIncome/);
  assert.match(renderer, /function makeCivAdvisorEconomyRatePreview\(economy, basePreview, rates\) \{[\s\S]*?makeCivAdvisorEconomyRateCityRow[\s\S]*?sliders: \{ science: rates\.science, luxury: rates\.luxury, taxes: rates\.taxes \}/);
  assert.match(renderer, /\{ key: 'size', label: 'Pop', className: 'size', num: true \}/);
  assert.doesNotMatch(renderer, /\{ key: 'size', label: 'Size', className: 'size', num: true \}/);
  assert.match(renderer, /function getCivAdvisorEconomyGovernmentPreview\(economy\) \{[\s\S]*?economy\.governmentPreviews[\s\S]*?selectedGovernmentIndex/);
  assert.match(renderer, /function isCivAdvisorEconomyGovernmentSimulated\(economy\) \{[\s\S]*?selectedGovernmentIndex !== currentGovernmentIndex/);
  assert.match(renderer, /function makeCivAdvisorEconomySectionHeading\(title, badges = \[\]\) \{[\s\S]*?civadvisor-section-heading-with-badges[\s\S]*?civadvisor-section-heading-badges/);
  assert.match(renderer, /makeCivAdvisorEconomySectionHeading\('Government & Administration', \[[\s\S]*?isCivAdvisorEconomyGovernmentSimulated\(economy\)[\s\S]*?Government simulated/);
  assert.match(renderer, /makeCivAdvisorEconomySectionHeading\('National Economy', \[[\s\S]*?rateSimulation\.changed[\s\S]*?Rates simulated/);
  assert.match(renderer, /function getCivAdvisorEconomyPreview\(economy\) \{[\s\S]*?getCivAdvisorEconomyGovernmentPreview\(economy\)[\s\S]*?getCivAdvisorEconomyRateSimulation\(economy\)[\s\S]*?makeCivAdvisorEconomyRatePreview\(economy, governmentPreview, rates\)/);
  assert.match(renderer, /function makeCivAdvisorGovernmentPicker\(economy, administration, preview\) \{[\s\S]*?menuPortalRoot: \(\) => document\.body[\s\S]*?getOptionMetaText:[\s\S]*?Current save[\s\S]*?Simulated[\s\S]*?state\.civAdvisor\.economyPreviewGovernmentIndex = Number\.isFinite\(next\)[\s\S]*?renderCivAdvisorModal\(\)/);
  assert.match(renderer, /state\.civAdvisor\.economyPreviewScienceRate = null[\s\S]*?state\.civAdvisor\.economyPreviewLuxuryRate = null[\s\S]*?const resolvedPlayerID = Number\(result\.selectedPlayerID\)/);
  assert.match(renderer, /civadvisor-economy-slider-input[\s\S]*?track\.type = 'range'[\s\S]*?track\.max = '100'[\s\S]*?setCivAdvisorEconomyRateSimulation\(economy[\s\S]*?setValueText\(updatedValue\)[\s\S]*?track\.addEventListener\('change'[\s\S]*?renderCivAdvisorModal\(\)/);
  assert.match(renderer, /function setCivAdvisorEconomyRateSimulation\(economy, science, luxury, changedKey = null\) \{[\s\S]*?if \(nextScience \+ nextLuxury > 100\) \{[\s\S]*?changedKey === 'science'[\s\S]*?nextScience = Math\.max\(0, 100 - nextLuxury\)[\s\S]*?else nextLuxury = Math\.max\(0, 100 - nextScience\)/);
  assert.match(renderer, /setCivAdvisorEconomyRateSimulation\(economy, next, latestRates\.luxury, 'science'\)/);
  assert.match(renderer, /setCivAdvisorEconomyRateSimulation\(economy, latestRates\.science, next, 'luxury'\)/);
  const sliderInputHandler = renderer.match(/track\.addEventListener\('input', \(\) => \{([\s\S]*?)\n      \}\);/);
  assert.ok(sliderInputHandler, 'expected Economy slider input handler');
  assert.doesNotMatch(sliderInputHandler[1], /renderCivAdvisorModal/, 'Economy sliders should not rerender while dragging');
  assert.match(renderer, /function makeCivAdvisorEconomyValue\(value, savedValue, options = \{\}\) \{[\s\S]*?civadvisor-economy-delta[\s\S]*?formatCivAdvisorEconomyDelta\(delta\)/);
  assert.match(renderer, /function applyCivAdvisorEconomyDeltaCellClass\(cell, value, savedValue, options = \{\}\) \{[\s\S]*?civadvisor-economy-cell-changed[\s\S]*?cell\.classList\.add\('positive'\)[\s\S]*?cell\.classList\.add\('negative'\)/);
  assert.match(renderer, /function appendCivAdvisorUnitSupportBreakdown\(parent, economy, preview\) \{[\s\S]*?Unit support basis[\s\S]*?Paid native units[\s\S]*?Free support[\s\S]*?Charged units[\s\S]*?GPT\/unit/);
  assert.match(renderer, /previewCityRowsById[\s\S]*?applyCivAdvisorEconomyDeltaCellClass\(td, value, row\.waste[\s\S]*?makeCivAdvisorEconomyValue\(value, row\.waste[\s\S]*?applyCivAdvisorEconomyDeltaCellClass\(td, value, row\[column\.key\]/);
  assert.doesNotMatch(renderer, /function appendCivAdvisorEconomyPreview|Preview government/);
  assert.match(renderer, /state\.civAdvisor\.economyPreviewGovernmentIndex = -1[\s\S]*?selectedPlayerID: nextID/);
  assert.doesNotMatch(renderer, /selectedEconomyBuildingIndex/);
  assert.doesNotMatch(renderer, /getCivAdvisorEconomyBuildingStatus/);
  assert.doesNotMatch(styles, /civadvisor-economy-building-picker|civadvisor-economy-building-status|building-status/);
  assert.match(styles, /\.civadvisor-economy-government-picker-menu\.tech-picker-menu-portaled \{[\s\S]*?z-index: 1300;/);
  assert.match(styles, /\.civadvisor-economy-delta \{[\s\S]*?font-size: 0\.72rem;[\s\S]*?font-weight: 650;/);
  assert.match(styles, /\.civadvisor-economy-sliders \{[\s\S]*?grid-auto-rows: 28px;[\s\S]*?\.civadvisor-economy-slider \{[\s\S]*?52px minmax\(110px, 1fr\) 42px[\s\S]*?min-height: 28px;[\s\S]*?\.civadvisor-economy-slider-input \{[\s\S]*?width: 100%;[\s\S]*?accent-color: #55588a;/);
  assert.match(styles, /\.civadvisor-section-heading-with-badges \{[\s\S]*?justify-content: space-between;[\s\S]*?\.civadvisor-section-heading-badges \{/);
  assert.doesNotMatch(styles, /--rate-value|--rate-color|::-webkit-slider-thumb|linear-gradient\(to right, var\(--rate-color\)/);
  assert.match(styles, /\.civadvisor-economy-table td\.civadvisor-economy-cell-changed\.positive \{[\s\S]*?rgba\(20, 118, 93, 0\.06\)[\s\S]*?\.civadvisor-economy-table td\.civadvisor-economy-cell-changed\.negative \{[\s\S]*?rgba\(179, 69, 56, 0\.06\)/);
  assert.match(renderer, /function renderCivAdvisorProduction\(report\) \{[\s\S]*?search\.placeholder = 'Search Production\.\.\.'[\s\S]*?state\.civAdvisor\.productionSearch = search\.value[\s\S]*?makeCivAdvisorCityName\(row, row\.city \|\| ''\)[\s\S]*?makeCivAdvisorReferenceChip\(row\.producingRef, row\.producing\)[\s\S]*?civadvisor-production-progress/);
  assert.doesNotMatch(renderer, /heading\.textContent = 'City Production'/);
  assert.match(renderer, /\{ key: 'economy', label: 'Economy' \}/);
  assert.match(renderer, /\{ key: 'production', label: 'Production' \}/);
  assert.match(renderer, /state\.civAdvisor\.activeTab === 'production'[\s\S]*?renderCivAdvisorProduction\(report\)/);
  assert.match(
    renderer,
    /if \(code === 'PRTO'\) \{[\s\S]*?state\.bundle\.biq[\s\S]*?rawSection\.records/,
    'unit links should compare against raw BIQ PRTO records rather than synthetic Units-tab entries'
  );
  assert.match(styles, /\.civadvisor-production-table\s*\{[\s\S]*?min-width: 1000px/);
  assert.match(styles, /\.civadvisor-production-table\.all-civs\s*\{[\s\S]*?min-width: 1060px/);
  assert.match(styles, /\.civadvisor-production-table col\.producing \{ width: 20%; \}/);
  assert.match(styles, /\.civadvisor-production-table col\.collected \{ width: 18%; \}/);
  assert.match(styles, /\.civadvisor-production-table col\.shields \{ width: 7%; \}/);
  assert.match(styles, /\.civadvisor-production-table col\.turns \{ width: 7%; \}/);
  assert.match(styles, /\.civadvisor-production-table col\.waste \{ width: 7%; \}/);
  assert.match(styles, /\.civadvisor-production-table \.civadvisor-sort-header-label\s*\{[\s\S]*?white-space: nowrap;/);
  assert.doesNotMatch(styles, /civadvisor-production-card/);
});

test('Civ Advisor Diplomacy tab renders verified diplomacy without coverage notes', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const diplomacyRenderer = renderer.slice(
    renderer.indexOf('function renderCivAdvisorDiplomacy(report)'),
    renderer.indexOf('function appendCivAdvisorLinkedItems')
  );
  assert.match(renderer, /function renderCivAdvisorDiplomacy\(report\) \{[\s\S]*?Diplomacy Summary[\s\S]*?Diplomacy Info/);
  assert.doesNotMatch(renderer, /Coverage Notes/);
  assert.match(renderer, /sortCivAdvisorRows\(diplomacy\.rows \|\| \[\], columns, 'diplomacy'\)/);
  assert.match(renderer, /column\.key === 'ourCulture' \|\| column\.key === 'theirCulture'[\s\S]*?makeCivAdvisorReferenceChip\(row\[`\$\{column\.key\}Ref`\], row\[column\.key\]\)/);
  assert.doesNotMatch(diplomacyRenderer, /key: 'sellOptions'|key: 'buyOptions'|label: 'Sell'|label: 'Buy'/);
  assert.match(diplomacyRenderer, /\{ key: 'gold', label: 'Gold', num: true, width: '10%' \}/);
  assert.match(renderer, /case 'CULT': return \['name'\];/);
  assert.match(renderer, /\{ key: 'diplomacy', label: 'Diplomacy' \}/);
  assert.match(renderer, /state\.civAdvisor\.activeTab === 'diplomacy'[\s\S]*?renderCivAdvisorDiplomacy\(report\)/);
  assert.match(styles, /\.civadvisor-tab\[data-tab-key="diplomacy"\]\.active/);
  assert.match(styles, /\.civadvisor-diplomacy\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.doesNotMatch(styles, /\.civadvisor-diplomacy-table\s*\{[\s\S]*?min-width:/);
});

test('Civ Advisor Territory tab renders exploration and improvement stats', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(renderer, /el\.civAdvisorModalTitle\.textContent = 'Civ Advisor'/);
  assert.doesNotMatch(renderer, /Civ Advisor -/);
  assert.doesNotMatch(renderer, /Viewing selected save:/);
  assert.match(renderer, /formatCivAdvisorCountPercent\(exploration\.exploredTiles \|\| 0, exploration\.exploredPercent\)/);
  assert.match(renderer, /function renderCivAdvisorTerritory\(report\) \{[\s\S]*?Exploration[\s\S]*?Tile Improvements[\s\S]*?City Territory/);
  assert.match(renderer, /\{ key: 'size', label: 'Pop', fullLabel: 'Population', className: 'size', num: true, sortValue: \(row\) => row\.sizeValue \}/);
  assert.match(renderer, /label: 'Corrupt', fullLabel: 'Corruption'/);
  assert.match(renderer, /const titleLabel = String\(column && column\.fullLabel \|\| label\)/);
  assert.match(renderer, /bucketHead\.textContent = 'Tiles'[\s\S]*?\['Worked', 'worked'\][\s\S]*?\['Unworked', 'unworked'\]/);
  assert.match(renderer, /\{ key: 'territory', label: 'Territory' \}/);
  assert.match(renderer, /state\.civAdvisor\.activeTab === 'territory'[\s\S]*?renderCivAdvisorTerritory\(report\)/);
  assert.match(styles, /\.civadvisor-tab\[data-tab-key="territory"\]\.active/);
  assert.match(styles, /\.civadvisor-territory\s*\{[\s\S]*?grid-template-rows: auto auto minmax\(150px, 1fr\)/);
  assert.match(styles, /\.civadvisor-territory-improvements-table col:nth-child\(n\+2\)/);
  assert.match(styles, /\.civadvisor-territory-city-table\s*\{[\s\S]*?max-width: 1150px;/);
  assert.doesNotMatch(styles, /\.civadvisor-territory-city-table \.civadvisor-sort-header-btn/);
  assert.doesNotMatch(renderer, /civadvisor-territory-(?:row-note|caveats)/);
  assert.doesNotMatch(styles, /civadvisor-territory-(?:row-note|caveats)/);
});

test('Civ Advisor Military tab separates roster and individual-unit views', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(renderer, /function renderCivAdvisorMilitary\(report\) \{[\s\S]*?Unit Types \(\$\{\(military\.roster \|\| \[\]\)\.length\}\)[\s\S]*?Individual Units \(\$\{\(military\.units \|\| \[\]\)\.length\}\)/);
  assert.match(renderer, /function renderCivAdvisorMilitaryRoster\(military\) \{[\s\S]*?Search Unit Types\.\.\.[\s\S]*?state\.civAdvisor\.militaryRosterSearch = search\.value[\s\S]*?\{ key: 'civText', label: 'Civ', className: 'civ' \}[\s\S]*?row\.upgradeRef[\s\S]*?row\.experienceMix[\s\S]*?appendCivAdvisorMilitaryCivs\(civ, row\.civs\)/);
  assert.match(renderer, /function renderCivAdvisorMilitaryUnits\(military\) \{[\s\S]*?Search Individual Units\.\.\.[\s\S]*?state\.civAdvisor\.militaryUnitsSearch = search\.value[\s\S]*?\{ key: 'nationality', label: 'Civ', className: 'nationality' \}[\s\S]*?row\.health[\s\S]*?row\.movement[\s\S]*?row\.nationalityRef/);
  assert.match(renderer, /makeCivAdvisorReferenceChip\(item\.ref, item\.name, \{ inline: true, colorSlot: item\.colorSlot \}\)/);
  assert.match(renderer, /makeCivAdvisorReferenceChip\(row\.nationalityRef, row\.nationality, \{ colorSlot: row\.colorSlot \}\)/);
  assert.match(renderer, /let slot = Number\(options\.colorSlot\);[\s\S]*?if \(!Number\.isFinite\(slot\) && target && target\.type === 'reference' && target\.tabKey === 'civilizations'\)/);
  assert.match(renderer, /function refocusCivAdvisorMilitaryRosterSearch\(value, selectionStart, selectionEnd\)/);
  assert.match(renderer, /function refocusCivAdvisorMilitaryUnitsSearch\(value, selectionStart, selectionEnd\)/);
  assert.doesNotMatch(renderer, /appendCivAdvisorMilitarySummary|Force Roster|Roster \(\$\{|label: 'Nationality'|civadvisor-military-filter|All unit types|military-units-\$\{/);
  assert.match(renderer, /\{ key: 'military', label: 'Military' \}/);
  assert.match(renderer, /activeMilitarySubtab: \['roster', 'units'\]\.includes/);
  assert.match(renderer, /function civAdvisorRefMatchesCurrentRecord\(ref, currentSignature\) \{[\s\S]*?sourceRecord[\s\S]*?currentRecord/);
  assert.match(renderer, /sectionCode === 'PRTO' && \([\s\S]*?civAdvisorRefMatchesCurrentRecord\(ref, currentSignature\)[\s\S]*?civAdvisorRefMatchesFoldedCurrentRecord\(ref, currentSignature\)/);
  assert.match(renderer, /function getCivAdvisorRecordSignatureIndex\(record, fallbackIndex\) \{[\s\S]*?record && record\.biqIndex[\s\S]*?Number\(raw\)/);
  assert.match(renderer, /function getCivAdvisorRecordIdentityValue\(record, key\) \{[\s\S]*?record\.displayCivilopediaKey[\s\S]*?record\.civilopediaKey/);
  assert.match(renderer, /function civAdvisorRefMatchesFoldedCurrentRecord\(ref, currentSignature\) \{[\s\S]*?currentSignature\.count[\s\S]*?sourceSignature\.count[\s\S]*?sourceValues/);
  assert.match(renderer, /function getCivAdvisorReferenceEntry\(ref\) \{[\s\S]*?const sourceValues = getCivAdvisorRefSourceValues\(ref\)[\s\S]*?bySourceIdentity/);
  assert.match(renderer, /if \(byIndex\) \{[\s\S]*?civAdvisorReferenceEntryMatchesSource\(ref, byIndex\)[\s\S]*?return byIndex/);
  assert.match(renderer, /function getCivAdvisorSaveArtTarget\(ref\) \{[\s\S]*?report\.saveArtContext[\s\S]*?getCivAdvisorRefSourceCivilopediaKey\(ref\)[\s\S]*?cloneCivAdvisorSaveArtEntry/);
  assert.match(renderer, /function getCivAdvisorLinkTarget\(ref\) \{[\s\S]*?civAdvisorReferenceEntryMatchesSource\(ref, entry\)[\s\S]*?type: 'reference'/);
  assert.match(renderer, /const artTarget = getCivAdvisorSaveArtTarget\(ref\) \|\| \(target && target\.type === 'reference' \? target : null\)/);
  assert.match(renderer, /if \(!target\) \{[\s\S]*?Open the matching scenario to enable links[\s\S]*?appendThumbnail\(span, artTarget\)/);
  assert.match(renderer, /button\.dataset\.subtabKey = tab\.key/);
  assert.match(styles, /\.civadvisor-military\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.civadvisor-military-controls\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent/);
  assert.match(styles, /\.civadvisor-military-roster-table col\.civ \{ width: 12%; \}/);
  assert.match(styles, /\.civadvisor-military-roster-search,\s*\.civadvisor-military-units-search\s*\{[\s\S]*?width: min\(640px, 100%\)/);
  assert.doesNotMatch(styles, /civadvisor-military-summary|civadvisor-military-filter/);
  assert.match(styles, /\.civadvisor-subtab\[data-subtab-key="roster"\]\.active,\s*\.civadvisor-subtab\[data-subtab-key="units"\]\.active/);
});

test('Civ Advisor Alerts tab groups current alerts without foregrounding the app', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const civAdvisor = fs.readFileSync(path.join(__dirname, '..', 'src', 'biq', 'civAdvisor.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const renderAlertsStart = renderer.indexOf('function renderCivAdvisorAlerts(report)');
  const renderAlertsEnd = renderer.indexOf('function renderCivAdvisorModal()', renderAlertsStart);
  const renderAlertsBody = renderer.slice(renderAlertsStart, renderAlertsEnd);
  const alertLineStyleStart = styles.indexOf('.civadvisor-alert-line {');
  const alertLineStyleEnd = styles.indexOf('.civadvisor-alert-line.active', alertLineStyleStart);
  const alertLineStyleBody = styles.slice(alertLineStyleStart, alertLineStyleEnd);
  assert.match(renderAlertsBody, /Current Alerts/);
  assert.match(renderAlertsBody, /Available Alerts/);
  assert.match(renderAlertsBody, /getCivAdvisorAlertCoverageGroups\(report\)/);
  assert.match(renderAlertsBody, /civadvisor-alert-coverage-group-summary/);
  assert.match(renderAlertsBody, /renderCivAdvisorAlertCoverageRow\(row\)/);
  assert.match(renderAlertsBody, /civadvisor-alert-line/);
  assert.match(renderAlertsBody, /getCivAdvisorAlertGroups\(report, currentRows\)/);
  assert.match(renderAlertsBody, /civadvisor-alert-group-summary/);
  assert.match(renderAlertsBody, /heading\.textContent = String\(group\.summary \|\| group\.label \|\| 'Current alert'\)/);
  assert.doesNotMatch(renderAlertsBody, /civadvisor-alert-group-title-count/);
  assert.doesNotMatch(renderAlertsBody, /civadvisor-alert-group-preview/);
  assert.doesNotMatch(renderAlertsBody, /civadvisor-alert-group-count/);
  assert.match(renderAlertsBody, /coverage-collapsed/);
  assert.match(renderAlertsBody, /civadvisor-alert-coverage-toggle/);
  assert.match(renderAlertsBody, /civadvisor-alert-coverage-rail/);
  assert.doesNotMatch(renderAlertsBody, /civadvisor-alert-coverage-rail-icon/);
  assert.match(renderAlertsBody, /Alert Types/);
  assert.match(renderAlertsBody, /enabledCoverageCount/);
  assert.match(renderAlertsBody, /state\.civAdvisor\.alertCoverageCollapsed = !state\.civAdvisor\.alertCoverageCollapsed/);
  assert.match(renderAlertsBody, /section\.open = !!\(state\.civAdvisor\.alertGroupExpanded && state\.civAdvisor\.alertGroupExpanded\[group\.id\]\)/);
  assert.match(renderAlertsBody, /section\.addEventListener\('toggle', \(\) => \{[\s\S]*?state\.civAdvisor\.alertGroupExpanded = \{[\s\S]*?\[group\.id\]: !!section\.open[\s\S]*?syncCurrentNavigationSnapshot\(\)/);
  assert.match(renderAlertsBody, /getCivAdvisorEnabledAlerts\(report\)/);
  assert.match(renderer, /alertCoverageCollapsed: false/);
  assert.match(renderer, /alertCoverageCollapsed: !!source\.alertCoverageCollapsed/);
  assert.match(renderer, /alertGroupExpanded: \{\}/);
  assert.match(renderer, /alertGroupExpanded: cloneStateMap\(source\.alertGroupExpanded\)/);
  assert.match(renderer, /state\.civAdvisor\.alertGroupExpanded = cloneStateMap\(civAdvisorView\.alertGroupExpanded\)/);
  assert.match(renderer, /function renderCivAdvisorAlertCoverageRow\(coverage\) \{[\s\S]*?checkbox\.type = 'checkbox'[\s\S]*?setCivAdvisorAlertCoverageEnabled/);
  assert.match(renderer, /function civAdvisorCoverageMatchesAlert\(coverage, alert\) \{/);
  assert.match(renderer, /function getCivAdvisorAlertCoverageRows\(report\) \{[\s\S]*?toLowerCase\(\) === 'active'/);
  assert.match(renderer, /function getCivAdvisorAlertCoverageGroups\(report\) \{[\s\S]*?CIV_ADVISOR_ALERT_COVERAGE_CATEGORY_ORDER/);
  assert.match(renderer, /function formatCivAdvisorAlertNameList\(names, limit = 5\) \{[\s\S]*?and \$\{source\.length - shown\.length\} more/);
  assert.match(renderer, /function getCivAdvisorAlertGroups\(report, alerts\) \{[\s\S]*?city-deficit-[\s\S]*?summarizeCivAdvisorNamedAlertGroup\(cityRows, ' is running a local deficit'[\s\S]*?gold\$\{cityRows\.length === 1 \? '' : ' combined'\}/);
  assert.match(renderer, /group\.id === 'city-food-waste'[\s\S]*?summarizeCivAdvisorNamedAlertGroup\(group\.rows, ' is wasting food', 'is wasting food', 'are wasting food'\)/);
  assert.match(renderer, /group\.id === 'city-production-overrun'[\s\S]*?summarizeCivAdvisorNamedAlertGroup\(group\.rows, ' has production overrun', 'has production overrun', 'have production overrun'\)/);
  assert.match(renderer, /const firstDetail = String\(group\.rows\[0\] && group\.rows\[0\]\.detail \|\| ''\)\.trim\(\)/);
  assert.match(renderer, /firstDetail && firstDetail !== firstTitle \? `\$\{firstTitle\}: \$\{firstDetail\}` : firstTitle/);
  assert.match(renderer, /CIV_ADVISOR_ALERT_COVERAGE_CATEGORY_ORDER = \[[\s\S]*?'districts'/);
  assert.match(renderer, /CIV_ADVISOR_ALERT_COVERAGE_CATEGORY_LABELS = \{[\s\S]*?districts: 'Districts'[\s\S]*?trade: 'Trade'/);
  assert.match(renderer, /CIV_ADVISOR_DEFAULT_ALERT_COVERAGE_ENABLED = new Set\(\[[\s\S]*?'trade-buy-tech'[\s\S]*?'trade-rival-cash'[\s\S]*?'research-overrun'[\s\S]*?'economy-city-deficits'[\s\S]*?'city-starvation'[\s\S]*?'city-production-overrun'[\s\S]*?'polluted-tiles'[\s\S]*?'foreign-units'/);
  assert.doesNotMatch(renderer, /legacyIds/);
  assert.match(civAdvisor, /id: 'trade-buy-tech'[\s\S]*?alertIds: \['buy-tech'\]/);
  assert.match(civAdvisor, /id: 'trade-buy-resources'[\s\S]*?alertIds: \['buy-resource'\]/);
  assert.match(civAdvisor, /id: 'trade-sell-tech'[\s\S]*?alertIds: \['sell-tech'\]/);
  assert.match(civAdvisor, /id: 'trade-sell-resources'[\s\S]*?alertIds: \['sell-resource'\]/);
  assert.match(civAdvisor, /id: 'research-overrun'[\s\S]*?alertIds: \['research-overrun'\]/);
  assert.match(civAdvisor, /id: 'economy-treasury'[\s\S]*?alertIds: \['economy-deficit'\]/);
  assert.match(civAdvisor, /id: 'economy-city-deficits'[\s\S]*?alertIdPrefixes: \['city-deficit-'\]/);
  assert.match(civAdvisor, /id: 'city-starvation'[\s\S]*?alertIdPrefixes: \['city-starvation-'\]/);
  assert.match(civAdvisor, /id: 'city-growth'[\s\S]*?alertIdPrefixes: \['city-growth-'\]/);
  assert.match(civAdvisor, /id: 'city-resistance'[\s\S]*?alertIdPrefixes: \['city-resistance-'\]/);
  assert.match(civAdvisor, /id: 'city-food-waste'[\s\S]*?alertIdPrefixes: \['city-food-waste-'\]/);
  assert.match(civAdvisor, /id: 'city-production-overrun'[\s\S]*?alertIdPrefixes: \['production-overrun-'\]/);
  assert.match(civAdvisor, /id: 'city-worked-unimproved'[\s\S]*?alertIdPrefixes: \['worked-unimproved-'\]/);
  assert.match(civAdvisor, /id: 'polluted-tiles'[\s\S]*?alertIds: \['polluted-tiles'\]/);
  assert.match(civAdvisor, /id: 'district-buildings'[\s\S]*?category: 'districts'[\s\S]*?alertIds: \['district-building-opportunities'\]/);
  assert.match(civAdvisor, /id: 'district-wonders'[\s\S]*?category: 'districts'[\s\S]*?alertIds: \['wonder-district-opportunities'\]/);
  assert.match(civAdvisor, /function cityCanGrowFromCurrentSize\(city, buildings, freshWaterCityIDs = new Set\(\)\) \{[\s\S]*?allowcitylevel2[\s\S]*?return false/);
  assert.match(civAdvisor, /resistingCitizens/);
  assert.doesNotMatch(civAdvisor, /legacyIds/);
  assert.match(renderer, /function isCivAdvisorAlertCoverageEnabled\(coverage\) \{[\s\S]*?Object\.prototype\.hasOwnProperty\.call\(overrides, id\)[\s\S]*?getDefaultCivAdvisorAlertCoverageEnabled\(id\)/);
  assert.match(renderer, /function setCivAdvisorAlertCoverageEnabled\(coverage, enabled\) \{[\s\S]*?state\.settings\.civAdvisorAlertCoverageEnabled[\s\S]*?window\.c3xManager\.setSettings\(state\.settings\)/);
  assert.match(renderer, /state\.settings\.civAdvisorAlertCoverageEnabled = normalizeCivAdvisorAlertCoverageEnabled\(state\.settings\.civAdvisorAlertCoverageEnabled\)/);
  assert.match(renderer, /function renderCivAdvisorEmptyState\(message, isError = false\) \{[\s\S]*?body\.textContent = message \|\| 'Open a \.SAV file to view Civ Advisor data\.'[\s\S]*?wrap\.appendChild\(body\)/);
  assert.doesNotMatch(renderer, /Select a Civ III save|Open SAV/);
  const tradeHelperStart = civAdvisor.indexOf('function canTradeTechToPlayer(techs, techMasks, playerID, techIndex)');
  const tradeHelperEnd = civAdvisor.indexOf('function hasResearchPrereqs', tradeHelperStart);
  const tradeHelperBody = civAdvisor.slice(tradeHelperStart, tradeHelperEnd);
  assert.match(civAdvisor, /function getTechnologyPrerequisites\(tech\) \{[\s\S]*?prerequisite1[\s\S]*?Array\.isArray\(source\.prerequisites\)/);
  assert.match(tradeHelperBody, /const prerequisites = getTechnologyPrerequisites\(tech\)/);
  assert.doesNotMatch(tradeHelperBody, /techEra/);
  assert.match(main, /civAdvisorAlertCoverageEnabled: \{\}/);
  assert.match(main, /function normalizeCivAdvisorAlertCoverageEnabled\(value\) \{[\s\S]*?next\[id\] = value\[key\] === true/);
  assert.doesNotMatch(renderer, /<th>Check<\/th><th>Status<\/th><th>Notes<\/th>/);
  assert.doesNotMatch(renderAlertsBody, /civadvisor-alert-category|civadvisor-alert-severity/);
  assert.match(renderer, /function applyCivAdvisorAlertTarget\(alert\) \{[\s\S]*?state\.civAdvisor\.activeTradeSubtab = String\(alert\.subtab\)/);
  assert.match(renderer, /activeAlertID/);
  assert.doesNotMatch(renderer, /BrowserWindow\.getFocusedWindow\(\)\.focus\(\)/);
  assert.match(styles, /\.civadvisor-alerts-simple\s*\{/);
  assert.match(styles, /\.civadvisor-alerts-simple\s*\{[\s\S]*?--civadvisor-alert-heading-height: 44px/);
  assert.match(styles, /\.civadvisor-alerts-simple\.coverage-collapsed\s*\{[\s\S]*?grid-template-columns: 52px minmax\(0, 1fr\)/);
  assert.match(styles, /\.civadvisor-alert-current > h3,\s*\.civadvisor-alert-coverage > h3\s*\{[\s\S]*?min-height: var\(--civadvisor-alert-heading-height, 42px\)/);
  assert.match(styles, /\.civadvisor-alert-coverage-toggle\s*\{/);
  assert.match(styles, /\.civadvisor-alert-coverage-rail\s*\{[\s\S]*?display: none/);
  assert.match(styles, /\.civadvisor-alerts-simple\.coverage-collapsed \.civadvisor-alert-coverage-rail\s*\{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) max-content/);
  assert.doesNotMatch(styles, /\.civadvisor-alert-coverage-rail-icon/);
  assert.match(styles, /\.civadvisor-alert-coverage-rail-label\s*\{[\s\S]*?writing-mode: vertical-rl/);
  assert.match(styles, /\.civadvisor-alert-coverage-group::before\s*\{[\s\S]*?width: 3px[\s\S]*?background: rgba\(82, 100, 154, 0\.24\)/);
  assert.match(styles, /\.civadvisor-alert-coverage-group-summary\s*\{[\s\S]*?grid-template-columns: max-content minmax\(0, 1fr\) max-content/);
  assert.match(styles, /\.civadvisor-alert-coverage-group-summary:hover\s*\{/);
  assert.match(styles, /\.civadvisor-alert-coverage-group-list\s*\{[\s\S]*?padding: 2px 5px 0 8px/);
  assert.match(styles, /\.civadvisor-alert-coverage-row\s*\{[\s\S]*?min-height: 25px[\s\S]*?background: transparent/);
  assert.match(styles, /\.civadvisor-alert-coverage-row:hover\s*\{/);
  assert.match(styles, /\.civadvisor-alert-coverage-row:focus-within\s*\{/);
  assert.match(styles, /\.civadvisor-alert-coverage-row input\s*\{[\s\S]*?width: 15px/);
  assert.match(styles, /\.civadvisor-alert-line:focus-visible,\s*\.civadvisor-alert-group-summary:focus-visible\s*\{/);
  assert.match(styles, /\.civadvisor-alert-group-summary\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 12px[\s\S]*?min-height: 36px/);
  assert.doesNotMatch(styles, /\.civadvisor-alert-group-count\s*\{/);
  assert.doesNotMatch(styles, /\.civadvisor-alert-group-title-count\s*\{/);
  assert.doesNotMatch(styles, /\.civadvisor-alert-group-preview\s*\{/);
  assert.match(styles, /\.civadvisor-alert-group-title\s*\{[\s\S]*?color: var\(--civadvisor-alert-group-color\)[\s\S]*?font-weight: 850[\s\S]*?font-variant-numeric: tabular-nums/);
  assert.match(styles, /\.civadvisor-alert-group-list\s*\{[\s\S]*?grid-auto-rows: max-content/);
  assert.match(styles, /\.civadvisor-alert-list\s*\{[\s\S]*?grid-auto-rows: max-content/);
  assert.match(styles, /\.civadvisor-alert-line\s*\{[\s\S]*?min-height: 44px/);
  assert.doesNotMatch(alertLineStyleBody, /border-left-width/);
  assert.doesNotMatch(styles, /\.civadvisor-alert-line\.severity-/);
  assert.match(styles, /\.civadvisor-alert-group\s*\{[\s\S]*?--civadvisor-alert-group-bg: #ffffff[\s\S]*?--civadvisor-alert-group-bg-hover: #f7f9ff[\s\S]*?--civadvisor-alert-group-bg-open: #fafbfe/);
  assert.match(styles, /\.civadvisor-alert-group\.severity-critical\s*\{[\s\S]*?--civadvisor-alert-group-color: #c53a34[\s\S]*?border-left-color: #c53a34/);
  assert.match(styles, /\.civadvisor-alert-group\.severity-warning\s*\{[\s\S]*?--civadvisor-alert-group-color: #d48728[\s\S]*?border-left-color: #d48728/);
  assert.match(styles, /\.civadvisor-alert-group\.severity-opportunity\s*\{[\s\S]*?--civadvisor-alert-group-color: #2e9389[\s\S]*?border-left-color: #2e9389/);
  assert.match(styles, /\.civadvisor-alert-group\.severity-info\s*\{[\s\S]*?--civadvisor-alert-group-color: #5f72b2[\s\S]*?border-left-color: #5f72b2/);
  assert.doesNotMatch(styles, /\.civadvisor-alert-group\.severity-[^{]+\{[^}]*--civadvisor-alert-group-bg: rgba/);
});

test('Civ Advisor SAV inspection runs in the operation worker and reuses parsed save data', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'src', 'operationWorker.js'), 'utf8');
  const civAdvisor = fs.readFileSync(path.join(__dirname, '..', 'src', 'biq', 'civAdvisor.js'), 'utf8');
  const savInspect = fs.readFileSync(path.join(__dirname, '..', 'src', 'biq', 'savInspect.js'), 'utf8');

  assert.doesNotMatch(
    main,
    /require\('\.\/src\/biq\/civAdvisor'\)/,
    'main process should not load the Civ Advisor parser directly'
  );
  assert.match(
    main,
    /ipcMain\.handle\('manager:inspect-civ-advisor-save'[\s\S]*?runWorkerTask\('inspectCivAdvisorSave', \{[\s\S]*?filePath: target,[\s\S]*?civ3Path: request\.civ3Path,[\s\S]*?selectedPlayerID: request\.selectedPlayerID/,
    'main process should route Civ Advisor save inspection through the operation worker'
  );
  assert.match(
    worker,
    /const \{ inspectCivAdvisorSaveFile \} = require\('\.\/biq\/civAdvisor'\);[\s\S]*?task === 'inspectCivAdvisorSave'[\s\S]*?inspectCivAdvisorSaveFile\(payload && \(payload\.filePath \|\| payload\.path\), \{[\s\S]*?civ3Path: payload && payload\.civ3Path,[\s\S]*?selectedPlayerID: payload && payload\.selectedPlayerID/,
    'operation worker should own the synchronous SAV parser call'
  );
  assert.doesNotMatch(
    savInspect,
    /colorSlot = buf\.readInt32LE\(off \+ 16\)|raceID, colorSlot, power/,
    'SAV live LEAD body +8 is not a display color slot'
  );
  assert.match(
    civAdvisor,
    /const raw = fs\.readFileSync\(filePath\);[\s\S]*?const inflated = inflateSavIfNeeded\(raw\);[\s\S]*?const extract = extractEmbeddedBiqFromSavBuffer\(inflated\.buffer\);[\s\S]*?const report = inspectSavBuffer\(inflated\.buffer, \{[\s\S]*?inflated,[\s\S]*?extract,[\s\S]*?parsed,/,
    'Civ Advisor should read and inflate the selected SAV once before sharing extracted data with the live-save inspector'
  );
  assert.match(
    savInspect,
    /const suppliedInflated = options && options\.inflated[\s\S]*?const inflated = suppliedInflated \|\| inflateSavIfNeeded\(input\);[\s\S]*?const suppliedExtract = options && options\.extract[\s\S]*?const extract = suppliedExtract \|\| extractEmbeddedBiqFromSavBuffer\(inflated\.buffer\);[\s\S]*?const suppliedParsed = options && options\.parsed/,
    'SAV inspection should accept pre-inflated and pre-parsed embedded rules from callers that already paid that cost'
  );
});

test('Civ Advisor tables expose Unit Table-style sortable headers', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const loadSaveStart = renderer.indexOf('async function loadCivAdvisorSave');
  const loadSaveEnd = renderer.indexOf('function getCivAdvisorReferenceEntry', loadSaveStart);
  const loadSaveBody = renderer.slice(loadSaveStart, loadSaveEnd);
  assert.match(
    renderer,
    /function appendCivAdvisorSortableHeaderCell\(headerRow, tableKey, column\) \{[\s\S]*?button\.className = 'civadvisor-sort-header-btn'[\s\S]*?aria-sort[\s\S]*?renderCivAdvisorModal\(\);[\s\S]*?\}/,
    'Civ Advisor headers should use clickable sort buttons with aria-sort state'
  );
  assert.match(
    renderer,
    /if \(sameColumn && current\.direction === 'desc'\) \{[\s\S]*?delete state\.civAdvisor\.sortState\[key\];[\s\S]*?return;[\s\S]*?\}/,
    'clicking a sorted Civ Advisor column a third time should return the table to unsorted report order'
  );
  assert.match(
    renderer,
    /loadCivAdvisorSave\(latest\.path, \{ saveMeta: latest, fingerprint, automatic: true \}\)/,
    'automatic latest-save refresh should reuse the normal Civ Advisor save load path'
  );
  assert.match(
    renderer,
    /window\.c3xManager\.inspectCivAdvisorSave\(\{\s*filePath: target,\s*civ3Path: state\.settings && state\.settings\.civ3Path,\s*selectedPlayerID,\s*districtAlertContext: makeCivAdvisorDistrictAlertContext\(\),\s*includeMap\s*\}\)/,
    'Civ Advisor save inspection should preserve the selected civ perspective and request full map data only when needed'
  );
  assert.match(
    renderer,
    /function renderCivAdvisorViewingSelector\(report\) \{[\s\S]*?createReferencePicker\(\{[\s\S]*?includeNone: true,[\s\S]*?noneLabel: 'All Civs'[\s\S]*?pickerClassName: 'civadvisor-viewing-civ-picker'[\s\S]*?loadCivAdvisorSave\(state\.civAdvisor\.savePath/,
    'Civ Advisor should render a structured global viewing-civ selector with All Civs and reload the current save for that player'
  );
  assert.match(
    renderer,
    /function getCivAdvisorViewingOptions\(report\) \{[\s\S]*?const civEntryByIndex = new Map\(getCivilizationBitmaskOptions\(\)[\s\S]*?entry: civEntryByIndex\.get\(String\(item\.raceID\)\) \|\| null/,
    'Civ Advisor viewing-civ options should use live civilization entries so the structured picker can show leader thumbnails'
  );
  assert.match(renderer, /selectedPlayerID: 0,/);
  assert.match(renderer, /label\.textContent = 'Civ'/);
  assert.doesNotMatch(renderer, /item\.isHuman \? 'Human'|getOptionMetaText: \(option\) => option && option\.meta/);
  assert.match(
    renderer,
    /function renderCivAdvisorViewingCivThumb\(holder, option\) \{[\s\S]*?if \(option\.entry\) \{[\s\S]*?loadReferenceListThumbnail\('civilizations', option\.entry, holder\)/,
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
  assert.match(renderer, /if \(hasAllCivs\) table\.classList\.add\('all-civs'\)/);
  assert.match(styles, /\.civadvisor-territory-city-table col\.civ \{ width: 10%; \}/);
  assert.match(styles, /\.civadvisor-economy-table col\.civ \{ width: 12%; \}/);
  assert.match(styles, /\.civadvisor-production-table col\.civ \{ width: 10%; \}/);
  assert.match(
    renderer,
    /state\.civAdvisor\.selectedPlayerID = Number\.isFinite\(resolvedPlayerID\) && \(resolvedPlayerID > 0 \|\| resolvedPlayerID === -1\)[\s\S]*?state\.civAdvisor\.report = result/,
    'loaded Civ Advisor reports should sync selectedPlayerID from the backend fallback-aware result'
  );
  assert.match(
    loadSaveBody,
    /state\.civAdvisor\.report = result;[\s\S]*?state\.civAdvisor\.loadedFingerprint =/,
    'loading a new Civ Advisor save should replace report data and metadata'
  );
  assert.doesNotMatch(
    loadSaveBody,
    /sortState/,
    'loading a new Civ Advisor save should preserve the active table sort schema for the refreshed rows'
  );
  assert.match(
    renderer,
    /sortCivAdvisorRows\(general\.rivals \|\| \[\], columns, 'general-rivals'\)/,
    'Rival Info rows should be sorted through shared Civ Advisor sort state'
  );
  assert.match(
    renderer,
    /\{ key: 'population', label: 'Pop', width: 7, num: true \},\s*\{ key: 'score', label: 'Score', width: 9, num: true \}/,
    'Rival Info should use a compact Pop label and include a sortable Score column'
  );
  assert.match(
    renderer,
    /tableKey === 'trade-current'[\s\S]*?sortCivAdvisorCurrentTradeRows\(rows \|\| \[\], columns, tableKey\)/,
    'current trade sorting should use grouped rows so continuation deals stay attached'
  );
  assert.match(
    renderer,
    /const techRows = \(technology\.rows \|\| \[\]\)\.filter[\s\S]*?sortCivAdvisorRows\(techRows, columns, 'techs'\)/,
    'Tech table rows should be searchable before shared Civ Advisor sorting is applied'
  );
  assert.match(
    renderer,
    /search\.placeholder = 'Search Techs\.\.\.'[\s\S]*?state\.civAdvisor\.techSearch = search\.value/,
    'Tech table should expose a search box for filtering technology rows'
  );
  assert.match(
    renderer,
    /function refocusCivAdvisorTechSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civadvisor-tech-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Tech search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /function appendCivAdvisorKnownPills\(parent, items, emptyText = ''\)[\s\S]*?civadvisor-tech-known-pill/,
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
    /search\.className = 'app-search-input civadvisor-culture-search'[\s\S]*?search\.placeholder = 'Search Improvements & Wonders\.\.\.'[\s\S]*?state\.civAdvisor\.cultureSearch = search\.value/,
    'Culture table should expose a search box for filtering combined improvement and wonder rows'
  );
  assert.match(
    renderer,
    /function refocusCivAdvisorCultureSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civadvisor-culture-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Culture search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /const visibleRows = rows\.filter\(\(row\) => \{[\s\S]*?row\.wonder \? 'wonder' : ''[\s\S]*?appendCivAdvisorCultureTable\(wrap, search, visibleRows[\s\S]*?`culture-\$\{selectedID\}`\)/,
    'Culture should search and sort the selected city improvement and wonder rows together'
  );
  assert.match(
    styles,
    /\.civadvisor-culture-city-info\s*\{[\s\S]*?grid-template-columns: minmax\(280px, 0\.42fr\) minmax\(0, 1\.58fr\)/,
    'Culture city selector should use a compact left control area'
  );
  assert.match(
    styles,
    /\.civadvisor-culture-city-select\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?gap: 5px;/,
    'Culture city selector should stack its label above the picker instead of stretching label and button horizontally'
  );
  assert.doesNotMatch(
    styles,
    /\.civadvisor-culture-table\s*\{[\s\S]*?min-width:/,
    'Culture table should not force a horizontal scrollbar at the standard Civ Advisor modal width'
  );
  assert.match(
    styles,
    /\.civadvisor-culture-table col\.status \{ width: 28%; \}/,
    'Culture table Status column should not dominate the table width'
  );
  assert.doesNotMatch(
    renderer,
    /textContent = 'Show all improvements'|civadvisor-culture-show-all/,
    'Culture should not expose the ambiguous Show all improvements checkbox'
  );
  assert.doesNotMatch(
    renderer,
    /className = 'civadvisor-subtabs civadvisor-culture-subtabs'|culture-wonders|appendCivAdvisorCultureTable\(wrap, 'Wonders'/,
    'Culture should not split wonders into a separate subtab'
  );
  assert.match(
    renderer,
    /search\.placeholder = 'Search Cities\.\.\.'[\s\S]*?state\.civAdvisor\.citiesSearch = search\.value/,
    'Cities table should expose a search box for filtering city rows'
  );
  assert.match(
    renderer,
    /function refocusCivAdvisorCitiesSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civadvisor-cities-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Cities search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /el\.civAdvisorModalOverlay && !el\.civAdvisorModalOverlay\.classList\.contains\('hidden'\) && ev\.key === 'Escape'[\s\S]*?target instanceof HTMLInputElement[\s\S]*?target\.classList\.contains\('app-search-input'\)[\s\S]*?target\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)[\s\S]*?return;[\s\S]*?closeCivAdvisorModal\(\)/,
    'Escape in Civ Advisor search inputs should clear the search before the modal close branch can run'
  );
  assert.match(
    renderer,
    /const cityRows = \(cities\.rows \|\| \[\]\)\.filter[\s\S]*?sortCivAdvisorRows\(cityRows, columns, 'cities'\)/,
    'Cities rows should be searchable before shared Civ Advisor sorting is applied'
  );
  assert.match(
    renderer,
    /\{ key: 'city', label: 'City', width: cities\.allCivs \? 11 : 16 \}[\s\S]*?\{ key: 'size', label: 'Pop', fullLabel: 'Population', width: 5, num: true, sortValue: \(row\) => row\.sizeValue \}/,
    'Cities table should use a compact City column and Pop header'
  );
  assert.match(
    renderer,
    /label: 'Corrupt', fullLabel: 'Corruption'[\s\S]*?label: 'Resist', fullLabel: 'Resistors'[\s\S]*?label: 'Foreign', fullLabel: 'Foreign Citizens'[\s\S]*?label: 'Lux', fullLabel: 'Specialist Luxury Output'[\s\S]*?label: 'Tax', fullLabel: 'Specialist Tax Output'[\s\S]*?label: 'Sci', fullLabel: 'Specialist Science Output'[\s\S]*?label: 'Pollute', fullLabel: 'Pollution'[\s\S]*?label: 'Dist', fullLabel: 'Distance'/,
    'Cities table should use compact headers with full accessibility labels'
  );
  assert.doesNotMatch(
    renderer,
    /key: 'plus'|key: 'flipRisk'|key: 'rank'|key: 'police'|key: 'engineers'|label: 'Plus'|label: 'Flip Risk'|label: 'Rank'|label: 'Pol'|label: 'Eng'/,
    'Cities table should not render Plus, Flip Risk, Rank, Police, or Engineer columns'
  );
  assert.doesNotMatch(
    styles,
    /\.civadvisor-cities-table\s*\{[\s\S]*?min-width:/,
    'Cities table should not force a horizontal scrollbar at the standard Civ Advisor modal width'
  );
  assert.match(
    renderer,
    /search\.placeholder = 'Search Production\.\.\.'[\s\S]*?state\.civAdvisor\.productionSearch = search\.value/,
    'Production table should expose a search box for filtering production rows'
  );
  assert.match(
    renderer,
    /CIV_ADVISOR_PRODUCTION_FACET_OPTIONS[\s\S]*?Improvements[\s\S]*?Wonders[\s\S]*?Land[\s\S]*?Air[\s\S]*?Sea[\s\S]*?Other/,
    'Production table should define the expected faceted search chips'
  );
  assert.match(
    renderer,
    /heading\.append\(facets, search\)/,
    'Production facets should render above the search box'
  );
  assert.match(
    renderer,
    /selectedProductionFacets\.has\(getCivAdvisorProductionRowFacet\(row\)\)[\s\S]*?productionQuery/,
    'Production facets should filter rows before text search is applied'
  );
  assert.match(
    renderer,
    /\{ key: 'waste', label: 'Waste', className: 'waste', num: true \}[\s\S]*?waste\.textContent = `\$\{row\.waste == null \? '' : row\.waste\} \(\$\{row\.wastePercent == null \? '' : row\.wastePercent\}%\)`/,
    'Production Waste column should show shield waste with percent in parentheses'
  );
  assert.match(
    renderer,
    /if \(values == null\) return validValues;[\s\S]*?return Array\.from\(new Set\(source/,
    'Production facet normalization should default missing state to all without turning an explicitly empty selection back on'
  );
  assert.match(
    renderer,
    /function refocusCivAdvisorProductionSearch\(value, selectionStart, selectionEnd\)[\s\S]*?querySelector\('\.civadvisor-production-search'\)[\s\S]*?setSelectionRange\(start, end\)/,
    'Production search should restore focus and caret position after filtering re-renders the table'
  );
  assert.match(
    renderer,
    /const productionRows = \(production\.rows \|\| \[\]\)\.filter[\s\S]*?sortCivAdvisorRows\(productionRows, columns, 'production'\)/,
    'Production rows should be searchable before shared Civ Advisor sorting is applied'
  );
  assert.match(
    renderer,
    /function makeCivAdvisorCityThumb\(cityArt, label = ''\)[\s\S]*?drawCivAdvisorCityThumb\(canvas, cityArt\)/,
    'Civ Advisor city lists should render reusable city thumbnails from save-derived art metadata'
  );
  assert.match(
    renderer,
    /function makeCivAdvisorCityThumb\(cityArt, label = ''\)[\s\S]*?thumb\._civAdvisorCityArt = cityArt \|\| null;[\s\S]*?thumb\.dataset\.cityArtKey = getCivAdvisorCityArtKey\(cityArt\)/,
    'Civ Advisor city thumbnails should keep their city-art metadata so async PCX loads can hydrate first-render placeholders'
  );
  assert.match(
    renderer,
    /if \(CIV_ADVISOR_CITY_ART_KEYS\.has\(pendingAssetKey\)\) \{[\s\S]*?refreshCivAdvisorCityThumbnails\(pendingAssetKey\)[\s\S]*?\['culture', 'territory', 'cities', 'economy', 'production'\]/,
    'Civ Advisor city art asset loads should hydrate or rerender mounted city thumbnails without requiring a tab switch'
  );
  assert.match(
    renderer,
    /makeCivAdvisorCityPicker\(cities, selectedID[\s\S]*?makeCivAdvisorCityName\(selected, `\$\{selected\.name\} \(\$\{selected\.culture\}\)`\)/,
    'Culture should use a structured city dropdown so city thumbnails can appear beside city names'
  );
  assert.match(
    renderer,
    /td\.classList\.add\('civadvisor-city-name-cell'\);[\s\S]*?makeCivAdvisorCityName\(row, row\[column\.key\]\)/,
    'Cities table city cells should use the same thumbnail city-name component'
  );
  assert.match(
    styles,
    /\.civadvisor-sort-header-btn\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 14px;[\s\S]*?cursor: pointer;/,
    'Civ Advisor sortable headers should match the Unit Table button affordance'
  );
  assert.match(
    styles,
    /\.civadvisor-rival-table th\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0;[\s\S]*?z-index: 4;[\s\S]*?font-size: 0\.64rem;[\s\S]*?font-weight: 700;/,
    'Civ Advisor table headers should stay visible while scrolling table bodies and use the shared compact weight'
  );
  assert.match(
    styles,
    /\.civadvisor-rival-table th:first-child,\s*\.civadvisor-rival-table td:first-child\s*\{[\s\S]*?position: sticky;[\s\S]*?left: 0;/,
    'Civ Advisor first columns should stay visible during horizontal table scrolling'
  );
  assert.match(
    styles,
    /\.civadvisor-rival-table th:first-child\s*\{[\s\S]*?z-index: 6;/,
    'Civ Advisor sticky header corner should layer above both header and first-column cells'
  );
  assert.match(
    styles,
    /\.civadvisor-modal-body\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/,
    'Civ Advisor should use inner table scrolling instead of a second modal-body scrollbar'
  );
  assert.match(
    styles,
    /\.civadvisor-viewing-strip\s*\{[\s\S]*?margin-left: auto;/,
    'Civ Advisor viewing-civ selector should share the tab row and align to the right'
  );
  assert.match(
    styles,
    /\.civadvisor-viewing-civ-picker \.tech-picker-btn\s*\{[\s\S]*?min-height: 34px;[\s\S]*?font-weight: 800;/,
    'Civ Advisor viewing-civ selector should customize sizing without overriding shared structured-picker corners'
  );
  assert.match(styles, /\.civadvisor-viewing-civ-picker\s*\{[\s\S]*?width: 200px;[\s\S]*?max-width: 200px;/);
  assert.match(styles, /\.civadvisor-viewing-civ-picker-menu\s*\{[\s\S]*?width: 200px;[\s\S]*?min-width: 200px;/);
  assert.doesNotMatch(styles, /\.civadvisor-viewing-civ-picker [^{]+\{[^}]*border-radius:\s*999px;/);
  assert.match(
    styles,
    /\.civadvisor-tech-progress th,\s*\.civadvisor-tech-progress td\s*\{[\s\S]*?border: 1px solid rgba\(72, 84, 121, 0\.14\);/,
    'Techs research progress cells should have thin borders so the summary reads as a table'
  );
  assert.match(
    styles,
    /\.civadvisor-tech-summary-list\s*\{[\s\S]*?align-items: center;/,
    'Techs research summary label/value rows should align centered'
  );
  assert.match(
    styles,
    /\.civadvisor-tech-known-pill\s*\{[\s\S]*?border-radius: 999px;/,
    'Known To civ names should use compact pill styling'
  );
  assert.doesNotMatch(
    styles,
    /\.civadvisor-tech-search\s*\{[^}]*font-size:/,
    'Techs search should inherit the shared app-search-input font sizing'
  );
  assert.doesNotMatch(
    styles,
    /\.civadvisor-cities-search\s*\{[^}]*font-size:/,
    'Cities search should inherit the shared app-search-input font sizing'
  );
  assert.doesNotMatch(
    styles,
    /\.civadvisor-production-search\s*\{[^}]*font-size:/,
    'Production search should inherit the shared app-search-input font sizing'
  );
});

test('Civ Advisor Tokugawa save rule signatures match Instafluff scenario BIQ', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE) || !fs.existsSync(INSTAFLUFF_BIQ)) {
    t.skip('Tokugawa save or Instafluff scenario BIQ is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);
  const parsed = parseAllSections(fs.readFileSync(INSTAFLUFF_BIQ));
  assert.equal(parsed.ok, true, parsed.error);

  for (const code of ['RACE', 'TECH', 'BLDG', 'PRTO', 'GOVT', 'GOOD', 'ERAS', 'CULT']) {
    assert.deepEqual(
      report.ruleSignatures[code],
      makeRuleSectionSignature(code, section(parsed, code).records),
      `${code} signature should match Instafluff scenario rules`
    );
  }
});

test('Civ Advisor Tokugawa save rule signatures match loaded Instafluff editor bundle', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE) || !fs.existsSync(INSTAFLUFF_BIQ) || !fs.existsSync(CIV3_ROOT)) {
    t.skip('Tokugawa save, Instafluff BIQ, or Civ3 root is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);
  const bundle = loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    c3xPath: C3X_ROOT,
    scenarioPath: INSTAFLUFF_BIQ,
  });

  for (const code of ['RACE', 'TECH', 'BLDG', 'PRTO', 'GOVT', 'GOOD', 'ERAS', 'CULT']) {
    assert.deepEqual(
      report.ruleSignatures[code],
      makeRuleSectionSignature(code, projectedBundleRecords(bundle, code)),
      `${code} signature should match the loaded Instafluff editor bundle`
    );
  }
});

test('Civ Advisor save art context resolves thumbnails from SAV Civilopedia keys independent of current rule labels', (t) => {
  if (!fs.existsSync(TOKUGAWA_1498_SAVE) || !fs.existsSync(CIV3_ROOT)) {
    t.skip('Tokugawa 1498 save or Civ3 root is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_1498_SAVE, { civ3Path: CIV3_ROOT });
  assert.equal(report.ok, true, report.error);
  const saltRef = report.trade.currentTrades
    .flatMap((row) => [...(row.weGiveRefs || []), ...(row.weReceiveRefs || [])])
    .find((ref) => ref && ref.sectionCode === 'GOOD' && ref.biqIndex === 2);
  assert.ok(saltRef, 'fixture should include the save-renamed Salt resource trade ref');
  const sourceRecord = (saltRef.sourceSignature.records || []).find((record) => Number(record.index) === 2);
  assert.deepEqual(sourceRecord && sourceRecord.values, ['Salt', 'GOOD_Saltpeter']);

  const resourceEntries = report.saveArtContext
    && report.saveArtContext.tabs
    && report.saveArtContext.tabs.resources
    && report.saveArtContext.tabs.resources.entries;
  assert.ok(Array.isArray(resourceEntries), 'save art context should include resource entries');
  const saltpeterArt = resourceEntries.find((entry) => String(entry.civilopediaKey || '').toUpperCase() === 'GOOD_SALTPETER');
  assert.ok(saltpeterArt, 'save art context should preserve the embedded GOOD_Saltpeter key');
  assert.equal(saltpeterArt.name, 'Salt', 'save art context should keep the save-native display name');
  assert.ok(saltpeterArt.thumbPath, 'save art context should resolve a resource thumbnail path from PediaIcons');
});

test('Civ Advisor General tab resolves active rival colors and contacted remaining rivals', (t) => {
  if (!fs.existsSync(TOKUGAWA_1498_SAVE)) {
    t.skip('Tokugawa 1498 save is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_1498_SAVE, { civ3Path: CIV3_ROOT });
  assert.equal(report.ok, true, report.error);
  const game = fieldMap(report.general.gameInfo);
  assert.equal(game.get('Embedded Scenario').value, 'Scenarios\\Custom\\');
  assert.equal(game.get('C3X Save Data').value, 'Not present');
  assert.deepEqual({
    hasC3XSegment: report.saveMetadata.hasC3XSegment,
    c3xSegmentSize: report.saveMetadata.c3xSegmentSize,
    c3xChunks: report.saveMetadata.c3xChunks,
    c3xDistrictInstanceCount: report.saveMetadata.c3xDistrictInstanceCount,
  }, {
    hasC3XSegment: false,
    c3xSegmentSize: 0,
    c3xChunks: [],
    c3xDistrictInstanceCount: 0,
  });
  assert.deepEqual(
    report.economy.cityRows
      .filter((row) => ['Iwakura', 'Hiroshima'].includes(row.name))
      .map((row) => ({
        name: row.name,
        science: row.science,
        luxury: row.luxury,
        taxes: row.taxes,
        netGold: row.netGold,
        baseTaxes: row.baseTaxes,
        addedTaxes: row.addedTaxes,
        addedLuxury: row.addedLuxury,
      })),
    [
      { name: 'Iwakura', science: 9, luxury: 5, taxes: 40, netGold: 24, baseTaxes: 30, addedTaxes: 10, addedLuxury: 5 },
      { name: 'Hiroshima', science: 14, luxury: 3, taxes: 46, netGold: 25, baseTaxes: 42, addedTaxes: 4, addedLuxury: 3 },
    ],
    'local Economy rows should include saved AddLuxury/AddTaxes while national totals remain Domestic Advisor based'
  );
  const anarchyPreview = report.economy.governmentPreviews.find((row) => row.name === 'Anarchy');
  const republicPreview = report.economy.governmentPreviews.find((row) => row.name === 'Republic');
  assert.ok(anarchyPreview && republicPreview);
  assert.equal(report.economy.netGain, 376);
  assert.equal(anarchyPreview.netGain, -553);
  assert.equal(republicPreview.netGain, 1738);
  assert.deepEqual(
    republicPreview.cityRows
      .filter((row) => ['Kyoto', 'Amsterdam'].includes(row.name))
      .map((row) => ({
        name: row.name,
        production: row.production,
        waste: row.waste,
        science: row.science,
        taxes: row.taxes,
        corruption: row.corruption,
        netGold: row.netGold,
        estimated: row.estimated,
      })),
    [
      { name: 'Kyoto', production: 57, waste: 0, science: 200, taxes: 296, corruption: 0, netGold: 274, estimated: true },
      { name: 'Amsterdam', production: 7, waste: 7, science: 8, taxes: 17, corruption: 11, netGold: 13, estimated: true },
    ],
    'government previews should estimate visible city-level commerce/waste changes, not only unit support'
  );
  assert.deepEqual(report.territory.territory, {
    dominationLimit: 1991,
    tilesOwned: 1369,
    dominationTiles: 1207,
    tilesToLimit: 784,
    unclaimedTiles: 248,
    citizensLimit: 856,
    citizensLimitPercent: '56.2%',
    districtInstances: 0,
    ownedLandDistricts: 0,
  });
  const player = fieldMap(report.general.playerInfo);
  assert.equal(player.get('Score').value, '2221');
  assert.equal(player.get('Score').rank, '2nd');
  assert.equal(player.get('Culture').value, '79799');
  assert.deepEqual(
    report.general.rivals.map((row) => ({
      nation: row.nation,
      colorSlot: row.colorSlot,
      cities: row.cities,
      land: row.land,
      population: row.population,
      score: row.score,
    })),
    [
      { nation: 'France', colorSlot: 7, cities: 8, land: 218, population: 91, score: 786 },
      { nation: 'England', colorSlot: 2, cities: 12, land: 389, population: 102, score: 1477 },
      { nation: 'Iroquois', colorSlot: 8, cities: 0, land: 0, population: 0, score: 728 },
      { nation: 'Inca', colorSlot: 4, cities: 56, land: 1360, population: 475, score: 3369 },
    ]
  );
  assert.deepEqual(
    report.diplomacy.rows.map((row) => ({ nation: row.nation, contact: row.contact, colorSlot: row.colorSlot })),
    [
      { nation: 'France', contact: 'Yes', colorSlot: 7 },
      { nation: 'England', contact: 'Yes', colorSlot: 2 },
      { nation: 'Iroquois', contact: 'Yes', colorSlot: 8 },
      { nation: 'Inca', contact: 'Yes', colorSlot: 4 },
    ]
  );
  assert.deepEqual(report.debug.visiblePlayerIDs, [1, 6, 10, 11, 12]);
  assert.deepEqual(
    report.trade.buyOptions.map((row) => ({
      nation: row.nation,
      technologies: row.technologies,
      resources: row.resources,
    })),
    [
      { nation: 'France', technologies: '', resources: 'Silks (4)' },
      { nation: 'England', technologies: '', resources: '' },
      { nation: 'Iroquois', technologies: '', resources: '' },
      { nation: 'Inca', technologies: '', resources: 'Wines (3), Furs (4), Incense (3), Spices (5)' },
    ],
    'Tokugawa 1498 should match CivAssist and in-game negotiation by suppressing TECH.flags 0x80000 techs'
  );
});

test('Civ Advisor alerts include current-state CivAssist examples from Tokugawa 1498', (t) => {
  if (!fs.existsSync(TOKUGAWA_1498_SAVE)) {
    t.skip('Tokugawa 1498 save is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_1498_SAVE, { civ3Path: CIV3_ROOT });
  assert.equal(report.ok, true, report.error);
  const titlesByPrefix = (prefix) => report.alerts.current
    .filter((alert) => String(alert.id || '').startsWith(prefix))
    .map((alert) => alert.title)
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(titlesByPrefix('city-starvation-'), ['Tikal is about to starve']);
  assert.deepEqual(titlesByPrefix('city-resistance-'), ['Seville is in resistance']);
  assert.deepEqual(titlesByPrefix('city-growth-'), [
    'Antium is about to grow',
    'Chichén Itza is about to grow',
    'Reykjavik is about to grow',
    'Trondheim is about to grow',
  ]);
  assert.deepEqual(titlesByPrefix('city-food-waste-'), [
    'Dazaifu is wasting food',
    'Katsuura is wasting food',
    'Ogaki is wasting food',
  ]);
  const research = report.alerts.current.find((alert) => alert.id === 'research-overrun');
  assert.ok(research, 'expected research overrun alert');
  assert.equal(research.tab, 'techs');
  assert.match(research.title, /Research will overrun \d+ beakers/);
  const pollution = report.alerts.current.find((alert) => alert.id === 'polluted-tiles');
  assert.ok(pollution, 'expected polluted tile alert');
  assert.equal(pollution.mapTargets.length, 12);
  assert.deepEqual(pollution.mapTargets[0], { x: 89, y: 69, label: 'Pollution #1' });
  assert.ok(
    report.alerts.current.some((alert) => alert.id === 'production-overrun-92' && alert.title === 'Iwakuni has production overrun'),
    'expected Iwakuni production overrun alert'
  );
  assert.ok(
    report.alerts.current.some((alert) => alert.id === 'worked-unimproved-27' && alert.title === 'Bergen is working unimproved tiles'),
    'expected worked unimproved tile city alert'
  );
});

test('Civ Advisor unit refs from Tokugawa save resolve to visible Instafluff unit thumbnails', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE) || !fs.existsSync(INSTAFLUFF_BIQ) || !fs.existsSync(CIV3_ROOT)) {
    t.skip('Tokugawa save, Instafluff BIQ, or Civ3 root is not available.');
    return;
  }

  const report = inspectCivAdvisorSaveFile(TOKUGAWA_SAVE);
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
    const entry = civAdvisorTestFindUnitEntry(bundle, ref);
    assert.ok(entry, `${kind} ${label} should resolve to a visible Units-tab entry`);
    assert.ok(entry.thumbPath, `${kind} ${label} should resolve to a Units-tab entry with thumbnail art`);
    if (label === 'Samurai') {
      assert.equal(entry.name, 'Samurai', 'save-only Samurai duplicate PRTO rows should not resolve to unrelated BIQ-index entries');
      assert.equal(entry.biqIndex, 59, 'save-only Samurai duplicate PRTO rows should resolve to the visible Samurai primary row');
    }
  }
});

test('Civ Advisor alerts detect owned resources missing from trade network counts', () => {
  const rows = civAdvisorInternals.collectUnconnectedResourceWarnings({
    territoryTiles: [
      { owner: 1, resource: 0, x: 10, y: 12 },
      { owner: 2, resource: 0, x: 12, y: 12 },
      { owner: 1, resource: 1, x: 14, y: 12 },
      { owner: 1, resource: 2, x: 16, y: 12 },
    ],
    resources: [
      { name: 'Iron', type: 2, prerequisite: -1 },
      { name: 'Horses', type: 2, prerequisite: -1 },
      { name: 'Cattle', type: 0, prerequisite: -1 },
    ],
    humanTradeTail: { resourceCounts: [0, 1, 0] },
    techMasks: [],
    playerID: 1,
    ruleSignatures: {},
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Iron');
  assert.deepEqual(rows[0].tiles, [{ x: 10, y: 12 }]);
});

test('Civ Advisor foreign-unit alerts group visible intruders per owned tile and use war severity', () => {
  const rows = civAdvisorInternals.collectForeignUnitWarnings({
    territoryTiles: [
      { owner: 1, x: 10, y: 12, visibleBy: 0b0010 },
      { owner: 1, x: 14, y: 12, visibleBy: 0b0010 },
      { owner: 1, x: 16, y: 12, visibleBy: 0 },
      { owner: 2, x: 18, y: 12, visibleBy: 0b0010 },
    ],
    units: [
      { owner: 2, unitType: 0, x: 10, y: 12 },
      { owner: 2, unitType: 0, x: 10, y: 12 },
      { owner: 3, unitType: 1, x: 10, y: 12 },
      { owner: 2, unitType: 1, x: 14, y: 12 },
      { owner: 3, unitType: 1, x: 16, y: 12 },
      { owner: 3, unitType: 1, x: 18, y: 12 },
      { owner: 1, unitType: 1, x: 14, y: 12 },
      { owner: 3, unitType: 1, x: 10, y: 12, loadedOnUnitID: 99 },
      { owner: 3, unitType: 2, x: 10, y: 12, loadedOnUnitID: -1 },
    ],
    players: [
      { playerID: 1, raceID: 0 },
      { playerID: 2, raceID: 1 },
      { playerID: 3, raceID: 2 },
    ],
    races: [
      { civilizationName: 'Japan' },
      { civilizationName: 'France' },
      { civilizationName: 'England' },
    ],
    unitTypes: [{ name: 'Infantry' }, { name: 'Cavalry' }, { name: 'Spy', invisible: true }],
    playerID: 1,
    perspectiveMask: 0b0010,
    atWarPlayerIDs: new Set([3]),
    ruleSignatures: {},
  });

  assert.equal(rows.length, 2, 'only visible, non-transported foreign stacks on tiles owned by the selected player should alert');
  assert.deepEqual(
    rows.map((row) => ({ x: row.x, y: row.y, unitCount: row.unitCount, atWar: row.atWar })),
    [
      { x: 10, y: 12, unitCount: 3, atWar: true },
      { x: 14, y: 12, unitCount: 1, atWar: false },
    ]
  );
  assert.match(rows[0].detail, /France \(at peace\): 2 Infantry/);
  assert.match(rows[0].detail, /England \(at war\): Cavalry/);

  const alerts = civAdvisorInternals.makeAlertsReport({
    report: { game: { turnNumber: 1 } },
    gameDate: '',
    timePlayed: '',
    economy: { netGain: 0, administration: { goldenAge: 'Inactive' }, cityRows: [] },
    tradeRows: [],
    currentTradeRows: [],
    unconnectedResources: [],
    districtOpportunities: {},
    foreignUnitWarnings: rows,
  }).current;
  assert.deepEqual(
    alerts.map((alert) => ({ id: alert.id, severity: alert.severity, mapTargets: alert.mapTargets })),
    [
      { id: 'foreign-units-10-12', severity: 'critical', mapTargets: [{ x: 10, y: 12, label: '3 enemy units' }] },
      { id: 'foreign-units-14-12', severity: 'warning', mapTargets: [{ x: 14, y: 12, label: '1 foreign unit' }] },
    ]
  );
});

test('Civ Advisor city-deficit alerts retain sortable deficit amounts', () => {
  const alerts = civAdvisorInternals.makeAlertsReport({
    report: { game: { turnNumber: 1 } },
    gameDate: '',
    timePlayed: '',
    economy: {
      netGain: 0,
      administration: { goldenAge: 'Inactive' },
      cityRows: [
        { id: 1, name: 'Small loss', netGold: -1 },
        { id: 2, name: 'Large loss', netGold: -8 },
      ],
    },
    production: {},
    military: {},
    technology: {},
    cities: {},
    tradeRows: [],
    currentTradeRows: [],
    unconnectedResources: [],
    districtOpportunities: {},
  });

  assert.deepEqual(
    alerts.current.map((alert) => ({ id: alert.id, amount: alert.amount })),
    [
      { id: 'city-deficit-2', amount: -8 },
      { id: 'city-deficit-1', amount: -1 },
    ]
  );
});

test('Civ Advisor district alerts find buildings unlocked by buildable dependent districts', () => {
  const opportunities = civAdvisorInternals.collectDistrictOpportunityWarnings({
    districtAlertContext: {
      base: { enable_districts: 'true', city_work_radius: '2' },
      districts: [
        {
          index: 2,
          fields: [
            { key: 'name', value: 'Campus' },
            { key: 'dependent_improvs', value: 'Library' },
            { key: 'buildable_on', value: 'grassland' },
          ],
        },
      ],
      wonders: [],
    },
    report: {
      world: { width: 40 },
      cities: { records: [{ id: 7, owner: 1, name: 'Kyoto', x: 10, y: 10 }] },
    },
    culture: {
      buildingRowsByCity: {
        7: [{ buildingIndex: 0, name: 'Library', statusKind: 'available', ref: { sectionCode: 'BLDG', biqIndex: 0, name: 'Library' } }],
      },
    },
    buildings: [{ name: 'Library', otherChar: 0, smallWonderCharacteristics: 0, improvements: 0 }],
    terrainRecords: [{ name: 'Desert' }, { name: 'Plains' }, { name: 'Grassland' }],
    territoryTiles: [
      { x: 10, y: 10, owner: 1, cityID: 7, terrainID: 2 },
      { x: 12, y: 10, owner: 1, cityID: -1, terrainID: 2 },
    ],
    districtRows: [],
    allPlayersMode: false,
  });

  assert.equal(opportunities.buildings.length, 1);
  assert.equal(opportunities.buildings[0].city, 'Kyoto');
  assert.equal(opportunities.buildings[0].district, 'Campus');
  assert.deepEqual(opportunities.buildings[0].tile, { x: 12, y: 10 });
});

test('Civ Advisor wonder district alerts honor wonder terrain restrictions', () => {
  const opportunities = civAdvisorInternals.collectDistrictOpportunityWarnings({
    districtAlertContext: {
      base: { enable_districts: 'true', enable_wonder_districts: 'true', city_work_radius: '2' },
      districts: [
        {
          index: 1,
          fields: [
            { key: 'name', value: 'Wonder District' },
            { key: 'dependent_improvs', value: 'Pyramids' },
            { key: 'buildable_on', value: 'grassland, coast' },
          ],
        },
      ],
      wonders: [
        {
          index: 0,
          fields: [
            { key: 'name', value: 'Pyramids' },
            { key: 'buildable_on', value: 'coast' },
          ],
        },
      ],
    },
    report: {
      world: { width: 40 },
      cities: { records: [{ id: 7, owner: 1, name: 'Kyoto', x: 10, y: 10 }] },
    },
    culture: {
      buildingRowsByCity: {
        7: [{ buildingIndex: 0, name: 'Pyramids', statusKind: 'available', ref: { sectionCode: 'BLDG', biqIndex: 0, name: 'Pyramids' } }],
      },
    },
    buildings: [{ name: 'Pyramids', otherChar: 4, smallWonderCharacteristics: 0, improvements: 0 }],
    terrainRecords: [
      { name: 'Desert' }, { name: 'Plains' }, { name: 'Grassland' }, { name: 'Tundra' },
      { name: 'Flood Plains' }, { name: 'Hills' }, { name: 'Mountains' }, { name: 'Forest' },
      { name: 'Jungle' }, { name: 'Marsh' }, { name: 'Volcano' }, { name: 'Coast' },
    ],
    territoryTiles: [
      { x: 10, y: 10, owner: 1, cityID: 7, terrainID: 2 },
      { x: 12, y: 10, owner: 1, cityID: -1, terrainID: 2 },
      { x: 9, y: 11, owner: 1, cityID: -1, terrainID: 11 },
    ],
    districtRows: [],
    allPlayersMode: false,
  });

  assert.equal(opportunities.wonders.length, 1);
  assert.equal(opportunities.wonders[0].name, 'Pyramids');
  assert.deepEqual(opportunities.wonders[0].tile, { x: 9, y: 11 });
});
