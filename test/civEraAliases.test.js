const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCivAliasesByEra,
  serializeCivAliasesByEra,
  backfillCivAliasPrecedingBlanks,
  backfillLeaderAliasPrecedingBlanks,
  getCivAliasLiveFillIndexes,
  getLeaderAliasLiveFillIndexes,
  applyCivAliasLiveEdit,
  applyLeaderAliasLiveEdit,
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

test('civ era aliases backfill empty preceding eras before serialization', () => {
  assert.deepEqual(backfillCivAliasPrecedingBlanks(['', '', '', 'Modern Rome']), [
    'Modern Rome',
    'Modern Rome',
    'Modern Rome',
    'Modern Rome'
  ]);
  assert.deepEqual(backfillCivAliasPrecedingBlanks(['Early Rome', '', 'Late Rome', '']), [
    'Early Rome',
    'Early Rome',
    'Late Rome',
    ''
  ]);
  assert.equal(
    serializeCivAliasesByEra([{ source: 'Rome', replacements: ['', '', '', 'Modern Rome'] }]),
    '[Rome: "Modern Rome" "Modern Rome" "Modern Rome" "Modern Rome"]'
  );
});

test('civ alias live edits keep auto-filled preceding eras tracking the active value', () => {
  let values = ['', '', '', ''];
  const liveFillIndexes = getCivAliasLiveFillIndexes(values, 2);
  values = applyCivAliasLiveEdit(values, 2, 'T', { liveFillIndexes });
  assert.deepEqual(values, ['T', 'T', 'T', '']);
  values = applyCivAliasLiveEdit(values, 2, 'TE', { liveFillIndexes });
  assert.deepEqual(values, ['TE', 'TE', 'TE', '']);
  values = applyCivAliasLiveEdit(values, 2, 'TEST', { liveFillIndexes });
  assert.deepEqual(values, ['TEST', 'TEST', 'TEST', '']);

  assert.deepEqual(
    applyCivAliasLiveEdit(['Ancient', '', '', ''], 2, 'Late'),
    ['Ancient', 'Ancient', 'Late', '']
  );
});

test('civ alias live edits stop tracking auto-filled cells after the focus session', () => {
  let values = ['', '', '', ''];
  const liveFillIndexes = getCivAliasLiveFillIndexes(values, 2);
  values = applyCivAliasLiveEdit(values, 2, 'TEST', { liveFillIndexes });
  assert.deepEqual(values, ['TEST', 'TEST', 'TEST', '']);

  values = applyCivAliasLiveEdit(values, 2, 'TEST2', {
    liveFillIndexes: getCivAliasLiveFillIndexes(values, 2)
  });
  assert.deepEqual(values, ['TEST', 'TEST', 'TEST2', '']);
});

test('civ alias live edits collapse trailing source-default resets after deleting a custom value', () => {
  assert.deepEqual(
    applyCivAliasLiveEdit(['TEST', 'Rome', 'TEST', 'Rome'], 2, '', { defaultValue: 'Rome' }),
    ['TEST', '', '', '']
  );
  assert.deepEqual(
    applyCivAliasLiveEdit(['TEST', 'Rome', 'TEST', 'Rome'], 1, 'Rome', { defaultValue: 'Rome' }),
    ['TEST', 'Rome', 'TEST', '']
  );
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

test('civ alias editor serialization backfills preceding era gaps but leaves trailing blanks', () => {
  const rome = civEntry('Rome', {
    noun: 'Rome',
    adjective: 'Roman',
    civilizationname: 'Roman Empire'
  });
  const model = buildCivAliasEditorModel('', [rome]);
  model.groups.push({
    civName: 'Rome',
    sourceNames: { noun: 'Rome', adjective: 'Roman', formal: 'Roman Empire' },
    aliases: {
      noun: ['Early Rome', '', 'Late Rome', ''],
      adjective: ['', '', '', 'Modern Roman'],
      formal: ['', '', '', 'Modern Rome']
    },
    entry: rome
  });

  assert.equal(
    serializeCivAliasEditorModel(model),
    '[Rome: "Early Rome" "Early Rome" "Late Rome", Roman: "Modern Roman" "Modern Roman" "Modern Roman" "Modern Roman", "Roman Empire": "Modern Rome" "Modern Rome" "Modern Rome" "Modern Rome"]'
  );
});

test('civ alias editor serialization trims trailing source-default resets but preserves positional resets', () => {
  const model = {
    groups: [{
      sourceNames: { noun: '', adjective: '', formal: 'Rome' },
      aliases: {
        noun: ['', '', '', ''],
        adjective: ['', '', '', ''],
        formal: ['TEST', 'Rome', 'TEST', 'Rome']
      }
    }],
    ungrouped: []
  };
  assert.equal(serializeCivAliasEditorModel(model), '[Rome: TEST Rome TEST]');

  model.groups[0].aliases.formal = ['TEST', 'Rome', '', 'Rome'];
  assert.equal(serializeCivAliasEditorModel(model), '[Rome: TEST]');
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

test('leader era aliases backfill empty preceding eras before serialization', () => {
  assert.deepEqual(backfillLeaderAliasPrecedingBlanks([
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' },
    { name: 'Modern Caesar', gender: 'M', title: 'Consul' }
  ]), [
    { name: 'Modern Caesar', gender: 'M', title: 'Consul' },
    { name: 'Modern Caesar', gender: 'M', title: 'Consul' },
    { name: 'Modern Caesar', gender: 'M', title: 'Consul' },
    { name: 'Modern Caesar', gender: 'M', title: 'Consul' }
  ]);
  assert.equal(
    serializeLeaderAliasesByEra([{
      source: 'Caesar',
      replacements: [
        { name: 'Ancient Caesar', gender: 'M', title: 'Consul' },
        { name: '', gender: '', title: '' },
        { name: 'Modern Caesar', gender: 'M', title: 'President' },
        { name: '', gender: '', title: '' }
      ]
    }]),
    '[Caesar: "Ancient Caesar" (M, Consul) "Ancient Caesar" (M, Consul) "Modern Caesar" (M, President)]'
  );
});

test('leader alias live edits keep auto-filled preceding eras tracking the active value', () => {
  let values = [
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' }
  ];
  const liveFillIndexes = getLeaderAliasLiveFillIndexes(values, 2);
  values = applyLeaderAliasLiveEdit(values, 2, { name: 'T', gender: 'M', title: 'Consul' }, { liveFillIndexes });
  assert.deepEqual(values, [
    { name: 'T', gender: 'M', title: 'Consul' },
    { name: 'T', gender: 'M', title: 'Consul' },
    { name: 'T', gender: 'M', title: 'Consul' },
    { name: '', gender: '', title: '' }
  ]);
  values = applyLeaderAliasLiveEdit(values, 2, { name: 'TEST', gender: 'M', title: 'Consul' }, { liveFillIndexes });
  assert.deepEqual(values, [
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: '', gender: '', title: '' }
  ]);
});

test('leader alias live edits stop tracking auto-filled cells after the focus session', () => {
  let values = [
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' },
    { name: '', gender: '', title: '' }
  ];
  const liveFillIndexes = getLeaderAliasLiveFillIndexes(values, 2);
  values = applyLeaderAliasLiveEdit(values, 2, { name: 'TEST', gender: 'M', title: 'Consul' }, { liveFillIndexes });
  assert.deepEqual(values, [
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: '', gender: '', title: '' }
  ]);

  values = applyLeaderAliasLiveEdit(values, 2, { name: 'TEST2', gender: 'M', title: 'Consul' }, {
    liveFillIndexes: getLeaderAliasLiveFillIndexes(values, 2)
  });
  assert.deepEqual(values, [
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: 'TEST', gender: 'M', title: 'Consul' },
    { name: 'TEST2', gender: 'M', title: 'Consul' },
    { name: '', gender: '', title: '' }
  ]);
});

test('leader alias live edits collapse trailing source-default names after deleting a custom value', () => {
  const values = [
    { name: 'TEST', gender: '', title: '' },
    { name: 'Caesar', gender: '', title: '' },
    { name: 'TEST', gender: '', title: '' },
    { name: 'Caesar', gender: '', title: '' }
  ];
  assert.deepEqual(
    applyLeaderAliasLiveEdit(values, 2, { name: '', gender: '', title: '' }, { defaultName: 'Caesar' }),
    [
      { name: 'TEST', gender: '', title: '' },
      { name: '', gender: '', title: '' },
      { name: '', gender: '', title: '' },
      { name: '', gender: '', title: '' }
    ]
  );
  assert.deepEqual(
    applyLeaderAliasLiveEdit(values, 1, { name: 'Caesar', gender: '', title: '' }, { defaultName: 'Caesar' }),
    [
      { name: 'TEST', gender: '', title: '' },
      { name: 'Caesar', gender: '', title: '' },
      { name: 'TEST', gender: '', title: '' },
      { name: '', gender: '', title: '' }
    ]
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
