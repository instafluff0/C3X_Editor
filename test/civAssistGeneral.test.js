'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
      { label: 'Gold per Turn', value: '-31' },
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

test('CivAssist Tokugawa save rule signatures match Instafluff scenario BIQ', (t) => {
  if (!fs.existsSync(TOKUGAWA_SAVE) || !fs.existsSync(INSTAFLUFF_BIQ)) {
    t.skip('Tokugawa save or Instafluff scenario BIQ is not available.');
    return;
  }

  const report = inspectCivAssistSaveFile(TOKUGAWA_SAVE);
  assert.equal(report.ok, true, report.error);
  const parsed = parseAllSections(fs.readFileSync(INSTAFLUFF_BIQ));
  assert.equal(parsed.ok, true, parsed.error);

  for (const code of ['RACE', 'GOVT', 'GOOD', 'ERAS']) {
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

  for (const code of ['RACE', 'GOVT', 'GOOD', 'ERAS']) {
    assert.deepEqual(
      report.ruleSignatures[code],
      makeRuleSectionSignature(code, projectedBundleRecords(bundle, code)),
      `${code} signature should match the loaded Instafluff editor bundle`
    );
  }
});
