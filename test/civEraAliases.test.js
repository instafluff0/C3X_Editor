const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCivAliasesByEra,
  serializeCivAliasesByEra,
  buildCivAliasEditorModel,
  serializeCivAliasEditorModel,
  parseLeaderAliasesByEra,
  serializeLeaderAliasesByEra,
  buildLeaderAliasEditorModel,
  serializeLeaderAliasEditorModel
} = require('../src/civEraAliases');

function civEntry(name, fields) {
  return {
    name,
    biqFields: Object.entries(fields).map(([key, value]) => ({
      key,
      baseKey: key,
      value,
      originalValue: value,
      editable: true
    }))
  };
}

test('civ era aliases parse and serialize C3X quoted token syntax', () => {
  const parsed = parseCivAliasesByEra('[Rome: Rome "Byzantine Empire" Italy Italy, Roman: Roman Byzantine Italian Italian, France: Gaul]');
  assert.deepEqual(parsed, [
    { source: 'Rome', replacements: ['Rome', 'Byzantine Empire', 'Italy', 'Italy'] },
    { source: 'Roman', replacements: ['Roman', 'Byzantine', 'Italian', 'Italian'] },
    { source: 'France', replacements: ['Gaul'] }
  ]);

  assert.equal(serializeCivAliasesByEra(parsed), '[Rome: Rome "Byzantine Empire" Italy Italy, Roman: Roman Byzantine Italian Italian, France: Gaul]');
});

test('civ era aliases group noun, adjective, and formal names by civilization', () => {
  const rome = civEntry('Rome', {
    noun: 'Rome',
    adjective: 'Roman',
    civilizationname: 'Roman Empire'
  });
  const france = civEntry('France', {
    noun: 'France',
    adjective: 'French',
    civilizationname: 'France'
  });

  const model = buildCivAliasEditorModel([
    'Rome: Rome "Byzantine Empire" Italy Italy',
    'Roman: Roman Byzantine Italian Italian',
    '"Roman Empire": "Roman Republic" "Byzantine Empire" Italy',
    'Mystery: Alpha Beta'
  ].join(', '), [rome, france]);

  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].civName, 'Rome');
  assert.deepEqual(model.groups[0].aliases.noun, ['Rome', 'Byzantine Empire', 'Italy', 'Italy']);
  assert.deepEqual(model.groups[0].aliases.adjective, ['Roman', 'Byzantine', 'Italian', 'Italian']);
  assert.deepEqual(model.groups[0].aliases.formal, ['Roman Republic', 'Byzantine Empire', 'Italy', '']);
  assert.deepEqual(model.ungrouped, [{ source: 'Mystery', replacements: ['Alpha', 'Beta'] }]);

  assert.equal(
    serializeCivAliasEditorModel(model),
    '[Rome: Rome "Byzantine Empire" Italy Italy, Roman: Roman Byzantine Italian Italian, "Roman Empire": "Roman Republic" "Byzantine Empire" Italy, Mystery: Alpha Beta]'
  );
});

test('duplicate civ alias source keys stay ungrouped to preserve override semantics', () => {
  const rome = civEntry('Rome', {
    noun: 'Rome',
    adjective: 'Roman',
    civilizationname: 'Roman Empire'
  });

  const model = buildCivAliasEditorModel('[Rome: Early, Rome: Late, Roman: Roman Italian]', [rome]);
  assert.equal(model.groups.length, 0);
  assert.deepEqual(model.ungrouped, [
    { source: 'Rome', replacements: ['Early'] },
    { source: 'Rome', replacements: ['Late'] },
    { source: 'Roman', replacements: ['Roman', 'Italian'] }
  ]);
  assert.equal(serializeCivAliasEditorModel(model), '[Rome: Early, Rome: Late, Roman: Roman Italian]');
});

test('leader era aliases parse and serialize gender and title syntax', () => {
  const parsed = parseLeaderAliasesByEra('["Joan d\'Arc": Vercingetorix (M, King) "Joan d\'Arc" (F) Napoleon (M) "De Gaulle" (M, President)]');
  assert.deepEqual(parsed, [
    {
      source: "Joan d'Arc",
      replacements: [
        { name: 'Vercingetorix', gender: 'M', title: 'King' },
        { name: "Joan d'Arc", gender: 'F', title: '' },
        { name: 'Napoleon', gender: 'M', title: '' },
        { name: 'De Gaulle', gender: 'M', title: 'President' }
      ]
    }
  ]);

  assert.equal(
    serializeLeaderAliasesByEra(parsed),
    '["Joan d\'Arc": Vercingetorix (M, King) "Joan d\'Arc" (F) Napoleon (M) "De Gaulle" (M, President)]'
  );
});

test('leader era aliases group by civilization leader field and preserve unknown entries', () => {
  const france = civEntry('France', {
    leadername: "Joan d'Arc",
    noun: 'France',
    adjective: 'French',
    civilizationname: 'France'
  });
  const rome = civEntry('Rome', {
    leadername: 'Caesar',
    noun: 'Rome',
    adjective: 'Roman',
    civilizationname: 'Roman Empire'
  });

  const model = buildLeaderAliasEditorModel([
    '"Joan d\'Arc": Vercingetorix (M, King) "Joan d\'Arc" (F) Napoleon (M)',
    'Mystery: Alpha (F)'
  ].join(', '), [france, rome]);

  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].leaderName, "Joan d'Arc");
  assert.equal(model.groups[0].civName, 'France');
  assert.deepEqual(model.groups[0].replacements, [
    { name: 'Vercingetorix', gender: 'M', title: 'King' },
    { name: "Joan d'Arc", gender: 'F', title: '' },
    { name: 'Napoleon', gender: 'M', title: '' },
    { name: '', gender: '', title: '' }
  ]);
  assert.deepEqual(model.ungrouped, [
    { source: 'Mystery', replacements: [{ name: 'Alpha', gender: 'F', title: '' }] }
  ]);
  assert.equal(
    serializeLeaderAliasEditorModel(model),
    '["Joan d\'Arc": Vercingetorix (M, King) "Joan d\'Arc" (F) Napoleon (M), Mystery: Alpha (F)]'
  );
});

test('leader era aliases keep quoted multi-word titles attached to the preceding leader', () => {
  const parsed = parseLeaderAliasesByEra('[Julius: Julius (M, Emperor) "Lorenzo de Medici" (M, Duke) "Silvio Berlusconi" (M, "Prime Minister")]');
  assert.deepEqual(parsed, [
    {
      source: 'Julius',
      replacements: [
        { name: 'Julius', gender: 'M', title: 'Emperor' },
        { name: 'Lorenzo de Medici', gender: 'M', title: 'Duke' },
        { name: 'Silvio Berlusconi', gender: 'M', title: 'Prime Minister' }
      ]
    }
  ]);
  assert.equal(
    serializeLeaderAliasesByEra(parsed),
    '[Julius: Julius (M, Emperor) "Lorenzo de Medici" (M, Duke) "Silvio Berlusconi" (M, "Prime Minister")]'
  );
});
