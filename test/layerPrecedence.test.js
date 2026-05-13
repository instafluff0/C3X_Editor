const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { buildReferenceTabs } = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-layers-'));
}

function writeTextLayer(root, relDir, fileName, text) {
  const dir = path.join(root, relDir, 'Text');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), text, 'utf8');
}

function getEntryByKey(entries, key) {
  const target = String(key || '').trim().toUpperCase();
  return (Array.isArray(entries) ? entries : []).find((entry) => String(entry.civilopediaKey || '').trim().toUpperCase() === target) || null;
}

function makeDiplomacy(contactLine, dealLine) {
  return [
    '#AIFIRSTCONTACT',
    '#CIV 1',
    '#POWER 0',
    '#MOOD 0',
    '#RANDOM 1',
    `"${contactLine}"`,
    '',
    '#AIFIRSTDEAL',
    '#CIV 1',
    '#POWER 0',
    '#MOOD 0',
    '#RANDOM 1',
    `"${dealLine}"`,
    ''
  ].join('\n');
}

function makeField(baseKey, value, editable = true) {
  return {
    key: baseKey,
    baseKey,
    value: String(value),
    originalValue: String(value),
    editable
  };
}

test('global mode uses Conquests override precedence over PTW/Vanilla', () => {
  const root = mkTmpDir();

  writeTextLayer(root, '', 'Civilopedia.txt', ['#TECH_TEST_LAYER', 'Vanilla overview text', ''].join('\n'));
  writeTextLayer(root, 'civ3PTW', 'Civilopedia.txt', ['#TECH_TEST_LAYER', 'PTW overview text', ''].join('\n'));
  writeTextLayer(root, 'Conquests', 'Civilopedia.txt', ['#TECH_TEST_LAYER', 'Conquests overview text', ''].join('\n'));

  writeTextLayer(root, '', 'PediaIcons.txt', ['#TECH_TEST_LAYER', 'Art\\civilopedia\\icons\\tech chooser\\vanilla-small.pcx', '#TECH_TEST_LAYER_LARGE', 'Art\\civilopedia\\icons\\tech chooser\\vanilla-large.pcx', ''].join('\n'));
  writeTextLayer(root, 'civ3PTW', 'PediaIcons.txt', ['#TECH_TEST_LAYER', 'Art\\civilopedia\\icons\\tech chooser\\ptw-small.pcx', '#TECH_TEST_LAYER_LARGE', 'Art\\civilopedia\\icons\\tech chooser\\ptw-large.pcx', ''].join('\n'));
  writeTextLayer(root, 'Conquests', 'PediaIcons.txt', ['#TECH_TEST_LAYER', 'Art\\civilopedia\\icons\\tech chooser\\conquests-small.pcx', '#TECH_TEST_LAYER_LARGE', 'Art\\civilopedia\\icons\\tech chooser\\conquests-large.pcx', ''].join('\n'));

  writeTextLayer(root, '', 'diplomacy.txt', makeDiplomacy('Vanilla hello', 'Vanilla deal'));
  writeTextLayer(root, 'civ3PTW', 'diplomacy.txt', makeDiplomacy('PTW hello', 'PTW deal'));
  writeTextLayer(root, 'Conquests', 'diplomacy.txt', makeDiplomacy('Conquests hello', 'Conquests deal'));

  const tabs = buildReferenceTabs(root, { mode: 'global' });
  const tech = getEntryByKey(tabs.technologies.entries, 'TECH_TEST_LAYER');
  assert.ok(tech, 'expected merged tech entry');
  assert.match(String(tech.civilopediaSection1 || ''), /Conquests overview text/);
  assert.deepEqual(tech.iconPaths, [
    'Art/civilopedia/icons/tech chooser/conquests-large.pcx',
    'Art/civilopedia/icons/tech chooser/conquests-small.pcx'
  ]);

  const civTab = tabs.civilizations;
  const labels = (civTab.diplomacyOptions || []).map((o) => o.label).join('\n');
  assert.match(labels, /Conquests hello/);
  assert.doesNotMatch(labels, /PTW hello/);
});

test('scenario mode overrides conquests layer and falls back when key missing', () => {
  const root = mkTmpDir();
  const scenarioDir = path.join(root, 'Conquests', 'Scenarios', 'MyScenario');

  writeTextLayer(root, '', 'Civilopedia.txt', ['#TECH_BASE_ONLY', 'Vanilla base overview', ''].join('\n'));
  writeTextLayer(root, 'Conquests', 'Civilopedia.txt', [
    '#TECH_TEST_LAYER',
    'Conquests overview text',
    '',
    '#TECH_BASE_ONLY',
    'Conquests base overview',
    ''
  ].join('\n'));
  writeTextLayer(scenarioDir, '', 'Civilopedia.txt', ['#TECH_TEST_LAYER', 'Scenario overview text', ''].join('\n'));

  writeTextLayer(root, '', 'PediaIcons.txt', ['#TECH_TEST_LAYER', 'Art\\civilopedia\\icons\\tech chooser\\vanilla-small.pcx', '#TECH_TEST_LAYER_LARGE', 'Art\\civilopedia\\icons\\tech chooser\\vanilla-large.pcx', ''].join('\n'));
  writeTextLayer(root, 'Conquests', 'PediaIcons.txt', ['#TECH_TEST_LAYER', 'Art\\civilopedia\\icons\\tech chooser\\conquests-small.pcx', '#TECH_TEST_LAYER_LARGE', 'Art\\civilopedia\\icons\\tech chooser\\conquests-large.pcx', ''].join('\n'));
  writeTextLayer(scenarioDir, '', 'PediaIcons.txt', ['#TECH_TEST_LAYER', 'Art\\civilopedia\\icons\\tech chooser\\scenario-small.pcx', '#TECH_TEST_LAYER_LARGE', 'Art\\civilopedia\\icons\\tech chooser\\scenario-large.pcx', ''].join('\n'));

  writeTextLayer(root, 'Conquests', 'diplomacy.txt', makeDiplomacy('Conquests hello', 'Conquests deal'));
  writeTextLayer(scenarioDir, '', 'diplomacy.txt', makeDiplomacy('Scenario hello', 'Scenario deal'));

  const tabs = buildReferenceTabs(root, {
    mode: 'scenario',
    scenarioPath: scenarioDir,
    scenarioPaths: [scenarioDir]
  });

  const scenarioTech = getEntryByKey(tabs.technologies.entries, 'TECH_TEST_LAYER');
  assert.ok(scenarioTech, 'expected scenario tech entry');
  assert.match(String(scenarioTech.civilopediaSection1 || ''), /Scenario overview text/);
  assert.deepEqual(scenarioTech.iconPaths, [
    'Art/civilopedia/icons/tech chooser/scenario-large.pcx',
    'Art/civilopedia/icons/tech chooser/scenario-small.pcx'
  ]);

  const fallbackTech = getEntryByKey(tabs.technologies.entries, 'TECH_BASE_ONLY');
  assert.ok(fallbackTech, 'expected fallback tech entry');
  assert.match(String(fallbackTech.civilopediaSection1 || ''), /Conquests base overview/);

  const civTab = tabs.civilizations;
  const labels = (civTab.diplomacyOptions || []).map((o) => o.label).join('\n');
  assert.match(labels, /Scenario hello/);
  assert.doesNotMatch(labels, /Conquests hello/);

  assert.equal(path.normalize(String(civTab.sourceDetails.civilopediaScenario || '')), path.normalize(path.join(scenarioDir, 'Text', 'Civilopedia.txt')));
  assert.equal(path.normalize(String(civTab.sourceDetails.pediaIconsScenarioWrite || '')), path.normalize(path.join(scenarioDir, 'Text', 'PediaIcons.txt')));
});

test('unit era variants are kept when BIQ includes base PRTO key', () => {
  const root = mkTmpDir();

  writeTextLayer(root, 'Conquests', 'Civilopedia.txt', [
    '#PRTO_WORKER',
    'Worker overview',
    '',
    '#PRTO_WORKER_ERAS_Industrial_Age',
    'Worker industrial overview',
    ''
  ].join('\n'));
  writeTextLayer(root, 'Conquests', 'PediaIcons.txt', [
    '#ANIMNAME_PRTO_WORKER',
    'Worker',
    '#ANIMNAME_PRTO_WORKER_ERAS_Industrial_Age',
    'Worker Modern Times',
    ''
  ].join('\n'));

  const biqTab = {
    sections: [
      {
        code: 'PRTO',
        records: [
          {
            index: 0,
            fields: [{ key: 'civilopediaentry', value: 'PRTO_WORKER' }]
          }
        ]
      }
    ]
  };

  const tabs = buildReferenceTabs(root, { mode: 'global', biqTab });
  const base = getEntryByKey(tabs.units.entries, 'PRTO_WORKER');
  const era = getEntryByKey(tabs.units.entries, 'PRTO_WORKER_ERAS_Industrial_Age');
  assert.ok(base, 'expected base worker entry');
  assert.ok(era, 'expected industrial-era worker variant entry');
  assert.equal(era.animationName, 'Worker Modern Times');
});

test('units beyond BIQ record index 600 get animationName from PediaIcons and are not synthetic', () => {
  const root = mkTmpDir();

  writeTextLayer(root, 'Conquests', 'PediaIcons.txt', [
    '#ANIMNAME_PRTO_HIGH_INDEX_UNIT',
    'High Index Folder',
    ''
  ].join('\n'));

  // Build a biqTab with 650 PRTO records; the high-index unit is at slot 649
  const records = [];
  for (let i = 0; i < 649; i++) {
    records.push({ index: i, fields: [{ key: 'civilopediaentry', value: `PRTO_FILLER_${i}` }] });
  }
  records.push({ index: 649, fields: [{ key: 'civilopediaentry', value: 'PRTO_HIGH_INDEX_UNIT' }] });

  const biqTab = { sections: [{ code: 'PRTO', records }] };

  const tabs = buildReferenceTabs(root, { mode: 'global', biqTab });
  const entry = getEntryByKey(tabs.units.entries, 'PRTO_HIGH_INDEX_UNIT');
  assert.ok(entry, 'expected PRTO_HIGH_INDEX_UNIT entry for high-index BIQ record');
  assert.equal(entry.animationName, 'High Index Folder');
  assert.equal(entry.syntheticBiqOnly, undefined, 'should not be synthetic');
});

test('unit era variant animation falls back to base ANIMNAME when era block is missing', () => {
  const root = mkTmpDir();

  writeTextLayer(root, 'Conquests', 'Civilopedia.txt', [
    '#PRTO_WORKER',
    'Worker overview',
    '',
    '#PRTO_WORKER_ERAS_Industrial_Age',
    'Worker industrial overview',
    ''
  ].join('\n'));
  writeTextLayer(root, 'Conquests', 'PediaIcons.txt', [
    '#ANIMNAME_PRTO_WORKER',
    'Worker',
    ''
  ].join('\n'));

  const biqTab = {
    sections: [
      {
        code: 'PRTO',
        records: [
          {
            index: 0,
            fields: [{ key: 'civilopediaentry', value: 'PRTO_WORKER' }]
          }
        ]
      }
    ]
  };

  const tabs = buildReferenceTabs(root, { mode: 'global', biqTab });
  const era = getEntryByKey(tabs.units.entries, 'PRTO_WORKER_ERAS_Industrial_Age');
  assert.ok(era, 'expected industrial-era worker variant entry');
  assert.equal(era.animationName, 'Worker');
});

test('BIQ-backed technologies follow Quint raw order and do not dedupe duplicate civilopedia keys', () => {
  const root = mkTmpDir();
  writeTextLayer(root, 'Conquests', 'Civilopedia.txt', '');
  writeTextLayer(root, 'Conquests', 'PediaIcons.txt', '');
  writeTextLayer(root, 'Conquests', 'diplomacy.txt', '');

  const biqTab = {
    sections: [
      {
        code: 'TECH',
        records: [
          {
            index: 0,
            fields: [makeField('civilopediaentry', 'TECH_DUPLICATE', false), makeField('name', 'Alpha Tech')]
          },
          {
            index: 1,
            fields: [makeField('civilopediaentry', 'TECH_DUPLICATE', false), makeField('name', 'Beta Tech')]
          }
        ]
      }
    ]
  };

  const tabs = buildReferenceTabs(root, { mode: 'global', biqTab });
  const entries = tabs.technologies.entries;

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.name), ['Alpha Tech', 'Beta Tech']);
  assert.deepEqual(entries.map((entry) => entry.biqIndex), [0, 1]);
  assert.deepEqual(entries.map((entry) => entry.civilopediaKey), ['TECH_DUPLICATE', 'TECH_DUPLICATE']);
});

test('BIQ-backed units only fold Quint strategy-map duplicates, not same-civilopedia primary units', () => {
  const root = mkTmpDir();
  writeTextLayer(root, 'Conquests', 'Civilopedia.txt', '');
  writeTextLayer(root, 'Conquests', 'PediaIcons.txt', '');
  writeTextLayer(root, 'Conquests', 'diplomacy.txt', '');

  const biqTab = {
    sections: [
      {
        code: 'PRTO',
        records: [
          {
            index: 0,
            fields: [
              makeField('civilopediaentry', 'PRTO_SHARED', false),
              makeField('name', 'Shared Unit A'),
              makeField('AIStrategy', '1'),
              makeField('otherStrategy', '-1')
            ]
          },
          {
            index: 1,
            fields: [
              makeField('civilopediaentry', 'PRTO_SHARED', false),
              makeField('name', 'Shared Unit A Strategy Map'),
              makeField('AIStrategy', '2'),
              makeField('otherStrategy', '0')
            ]
          },
          {
            index: 2,
            fields: [
              makeField('civilopediaentry', 'PRTO_SHARED', false),
              makeField('name', 'Shared Unit B'),
              makeField('AIStrategy', '4'),
              makeField('otherStrategy', '-1')
            ]
          }
        ]
      }
    ]
  };

  const tabs = buildReferenceTabs(root, { mode: 'global', biqTab });
  const entries = tabs.units.entries;

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.name), ['Shared Unit A', 'Shared Unit B']);
  assert.deepEqual(entries.map((entry) => entry.biqIndex), [0, 2]);
  assert.deepEqual(entries.map((entry) => entry.civilopediaKey), ['PRTO_SHARED', 'PRTO_SHARED']);
});
