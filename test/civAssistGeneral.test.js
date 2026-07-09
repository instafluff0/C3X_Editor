'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { inspectCivAssistSaveFile } = require('../src/biq/civAssist');

const TOKUGAWA_SAVE = '/Users/nicdobbins/fun/Civilization III Complete/Conquests/Saves/Tokugawa of the Japanese, 740 AD.SAV';

function fieldMap(fields) {
  return new Map((fields || []).map((field) => [field.label, field]));
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
  assert.equal(player.get('Traits').value, 'Militaristic, Religious');
  assert.equal(player.get('Score').value, '760');
  assert.equal(player.get('Culture').value, '6021');
  assert.equal(player.get('Culture Per Turn').value, '56');
  assert.equal(player.get('Government').value, 'Republic');
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
      gold: row.gold,
      cities: row.cities,
      land: row.land,
      population: row.population,
    })),
    [
      { nation: 'Greece', traits: 'Commercial, Scientific', relation: 'Peace', government: 'Feudalism', currentEra: 'Middle Ages', gold: 0, cities: 3, land: 42, population: 2 },
      { nation: 'Germany', traits: 'Militaristic, Scientific', relation: 'Peace', government: 'Republic', currentEra: 'Middle Ages', gold: 0, cities: 1, land: 32, population: 0 },
      { nation: 'England', traits: 'Commercial, Seafaring', relation: 'Peace', government: 'Republic', currentEra: 'Middle Ages', gold: 0, cities: 2, land: 130, population: 9 },
      { nation: 'Persia', traits: 'Scientific, Industrious', relation: 'War*', government: 'Feudalism', currentEra: 'Middle Ages', gold: 84, cities: 1, land: 28, population: 0 },
      { nation: 'City of Sparta', traits: 'Militaristic, Agricultural', relation: 'Peace', government: 'Despotism', currentEra: 'Ancient Times', gold: 0, cities: 1, land: 37, population: 0 },
      { nation: 'Spain', traits: 'Religious, Seafaring', relation: 'War*', government: 'Monarchy', currentEra: 'Ancient Times', gold: 28, cities: 4, land: 157, population: 14 },
      { nation: 'China', traits: 'Militaristic, Industrious', relation: 'Peace', government: 'Republic', currentEra: 'Middle Ages', gold: 1, cities: 2, land: 53, population: 8 },
      { nation: 'Aztecs', traits: 'Militaristic, Agricultural', relation: 'War*', government: 'Republic', currentEra: 'Ancient Times', gold: 0, cities: 4, land: 100, population: 13 },
      { nation: 'Mongols', traits: 'Militaristic, Expansionist', relation: 'Peace', government: 'Monarchy', currentEra: 'Ancient Times', gold: 16, cities: 2, land: 111, population: 7 },
    ]
  );
});
