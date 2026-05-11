'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle } = require('../src/configCore');
const { projectCivilizationBiqFields, collapseCivilizationBiqFields } = require('../src/biq/civCodec');

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');
const TIDES_BIQ = path.join(CIV3_ROOT, 'Conquests', 'Scenarios', 'TIDES OF CRIMSON.biq');

function getTidesBundle() {
  if (!fs.existsSync(TIDES_BIQ)) return null;
  return loadBundle({
    mode: 'scenario',
    civ3Path: CIV3_ROOT,
    scenarioPath: TIDES_BIQ
  });
}

function getField(entry, key) {
  return (entry.biqFields || []).find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === String(key || '').toLowerCase()) || null;
}

function getRawRaceMap(bundle, civilopediaKey) {
  const sections = (((bundle || {}).biq || {}).sections || []);
  const raceSection = sections.find((section) => String(section && section.code || '').toUpperCase() === 'RACE');
  const record = ((raceSection && raceSection.records) || []).find((candidate) => {
    const civField = ((candidate && candidate.fields) || []).find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').toUpperCase() === civilopediaKey;
  });
  assert.ok(record, `Expected ${civilopediaKey} raw RACE record`);
  const map = new Map();
  (record.fields || []).forEach((field) => {
    map.set(String(field && (field.baseKey || field.key) || '').toLowerCase(), String(field && field.value || ''));
  });
  return map;
}

test('Amazonians in TIDES project raw RACE fields into Quint-style civilization UI fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const civ = bundle.tabs.civilizations.entries.find((entry) => entry.civilopediaKey === 'RACE_AMAZONIANS');
  assert.ok(civ, 'Expected Amazonians / RACE_AMAZONIANS civilization');

  const fieldKeys = new Set((civ.biqFields || []).map((field) => String(field.baseKey || field.key || '').toLowerCase()));
  assert.ok(fieldKeys.has('civilopediaentry'));
  assert.ok(fieldKeys.has('leadername'));
  assert.ok(fieldKeys.has('freetech1index'));
  assert.ok(fieldKeys.has('freetech2index'));
  assert.ok(fieldKeys.has('numcitynames'));
  assert.ok(fieldKeys.has('numgreatleaders'));
  assert.ok(fieldKeys.has('forwardfilename_for_era_0'));
  assert.ok(fieldKeys.has('reversefilename_for_era_0'));
  assert.ok(fieldKeys.has('commercial'));
  assert.ok(fieldKeys.has('religious'));
  assert.ok(fieldKeys.has('managecitizens'));
  assert.ok(fieldKeys.has('manageproduction'));
  assert.ok(fieldKeys.has('manyartillery'));
  assert.ok(fieldKeys.has('manyships'));
  assert.ok(fieldKeys.has('manyhappiness'));
  assert.ok(fieldKeys.has('flavor_2'));

  assert.equal(fieldKeys.has('name'), false);
  assert.equal(fieldKeys.has('freetech1'), false);
  assert.equal(fieldKeys.has('numcities'), false);
  assert.equal(fieldKeys.has('nummilleaders'), false);
  assert.equal(fieldKeys.has('forwardfilename_0'), false);
  assert.equal(fieldKeys.has('reversefilename_0'), false);
  assert.equal(fieldKeys.has('bonuses'), false);
  assert.equal(fieldKeys.has('governorsettings'), false);
  assert.equal(fieldKeys.has('buildoften'), false);
  assert.equal(fieldKeys.has('buildnever'), false);
  assert.equal(fieldKeys.has('flavors'), false);

  assert.equal(civ.civilopediaKey, 'RACE_AMAZONIANS');
  assert.equal(getField(civ, 'civilopediaentry').value, 'RACE_Amazonians');
  assert.equal(getField(civ, 'civilopediaentry').editable, false);
  assert.equal(getField(civ, 'leadername').value, 'Kerigan');
  assert.equal(getField(civ, 'leadertitle').value, 'Lady');
  assert.equal(getField(civ, 'freetech1index').value, 'AMAZONIANS (101)');
  assert.equal(getField(civ, 'freetech2index').value, 'Farming (2)');
  assert.equal(getField(civ, 'numcitynames').value, '20');
  assert.equal(getField(civ, 'numgreatleaders').value, '5');
  assert.equal(getField(civ, 'forwardfilename_for_era_0').value, 'Art\\Flics\\am_01.flc');
  assert.equal(getField(civ, 'reversefilename_for_era_0').value, 'Art\\Flics\\am_02.flc');
  assert.equal(getField(civ, 'commercial').value, 'true');
  assert.equal(getField(civ, 'religious').value, 'true');
  assert.equal(getField(civ, 'managecitizens').value, 'true');
  assert.equal(getField(civ, 'manageproduction').value, 'true');
  assert.equal(getField(civ, 'manyartillery').value, 'true');
  assert.equal(getField(civ, 'manyships').value, 'true');
  assert.equal(getField(civ, 'manyhappiness').value, 'true');
  assert.equal(getField(civ, 'flavor_1').value, 'false');
  assert.equal(getField(civ, 'flavor_2').value, 'true');
  assert.equal(getField(civ, 'flavor_3').value, 'false');
});

test('Amazonians civilization UI fields collapse back to the original raw RACE storage fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const civ = bundle.tabs.civilizations.entries.find((entry) => entry.civilopediaKey === 'RACE_AMAZONIANS');
  assert.ok(civ, 'Expected Amazonians / RACE_AMAZONIANS civilization');

  const raw = getRawRaceMap(bundle, 'RACE_AMAZONIANS');
  const collapsed = collapseCivilizationBiqFields(civ.biqFields, civ.civilizationFlavorCount, 'value');
  const expectedKeys = [
    'name',
    'leadertitle',
    'adjective',
    'noun',
    'culturegroup',
    'leadergender',
    'civilizationgender',
    'aggressionlevel',
    'favoritegovernment',
    'shunnedgovernment',
    'defaultcolor',
    'uniquecolor',
    'plurality',
    'freetech1',
    'freetech2',
    'freetech3',
    'freetech4',
    'numcities',
    'nummilleaders',
    'forwardfilename_0',
    'reversefilename_0',
    'bonuses',
    'governorsettings',
    'buildoften',
    'buildnever',
    'flavors',
    'diplomacytextindex',
    'numscientificleaders'
  ];

  expectedKeys.forEach((key) => {
    assert.equal(
      collapsed[key],
      raw.get(key),
      `Expected collapsed UI value for ${key} to round-trip to original raw RACE value`
    );
  });
});

test('RACE codec round-trips Quint packed traits, governor flags, build priorities, and flavors', () => {
  const rawFields = [
    { baseKey: 'name', key: 'name', value: 'Kerigan', originalValue: 'Kerigan', editable: true },
    { baseKey: 'leadertitle', key: 'leadertitle', value: 'Lady', originalValue: 'Lady', editable: true },
    { baseKey: 'noun', key: 'noun', value: 'Amazonians', originalValue: 'Amazonians', editable: true },
    { baseKey: 'adjective', key: 'adjective', value: 'Amazonian', originalValue: 'Amazonian', editable: true },
    { baseKey: 'favoritegovernment', key: 'favoritegovernment', value: 'Earth Sphere (5)', originalValue: 'Earth Sphere (5)', editable: true },
    { baseKey: 'shunnedgovernment', key: 'shunnedgovernment', value: 'Fire Sphere (2)', originalValue: 'Fire Sphere (2)', editable: true },
    { baseKey: 'freetech1', key: 'freetech1', value: 'AMAZONIANS (101)', originalValue: 'AMAZONIANS (101)', editable: true },
    { baseKey: 'freetech2', key: 'freetech2', value: 'Farming (2)', originalValue: 'Farming (2)', editable: true },
    { baseKey: 'numcities', key: 'numcities', value: '20', originalValue: '20', editable: true },
    { baseKey: 'nummilleaders', key: 'nummilleaders', value: '5', originalValue: '5', editable: true },
    { baseKey: 'forwardfilename_0', key: 'forwardfilename_0', value: 'Art\\\\Flics\\\\am_01.flc', originalValue: 'Art\\\\Flics\\\\am_01.flc', editable: true },
    { baseKey: 'reversefilename_0', key: 'reversefilename_0', value: 'Art\\\\Flics\\\\am_02.flc', originalValue: 'Art\\\\Flics\\\\am_02.flc', editable: true },
    { baseKey: 'bonuses', key: 'bonuses', value: '18', originalValue: '18', editable: true },
    { baseKey: 'governorsettings', key: 'governorsettings', value: '17', originalValue: '17', editable: true },
    { baseKey: 'buildnever', key: 'buildnever', value: '0', originalValue: '0', editable: true },
    { baseKey: 'buildoften', key: 'buildoften', value: '548', originalValue: '548', editable: true },
    { baseKey: 'flavors', key: 'flavors', value: '2', originalValue: '2', editable: true }
  ];

  const projected = projectCivilizationBiqFields({
    rawFields,
    civilopediaEntry: 'RACE_TEST',
    flavorCount: 4
  });

  assert.equal(projected.some((field) => field.baseKey === 'bonuses'), false);
  assert.equal(projected.some((field) => field.baseKey === 'governorsettings'), false);
  assert.equal(projected.some((field) => field.baseKey === 'buildoften'), false);
  assert.equal(projected.some((field) => field.baseKey === 'buildnever'), false);
  assert.equal(projected.some((field) => field.baseKey === 'flavors'), false);

  const projectedByKey = new Map(projected.map((field) => [field.baseKey, field]));
  assert.equal(projectedByKey.get('civilopediaentry').editable, false);
  assert.equal(projectedByKey.get('leadername').value, 'Kerigan');
  assert.equal(projectedByKey.get('freetech1index').value, 'AMAZONIANS (101)');
  assert.equal(projectedByKey.get('commercial').value, 'true');
  assert.equal(projectedByKey.get('religious').value, 'true');
  assert.equal(projectedByKey.get('managecitizens').value, 'true');
  assert.equal(projectedByKey.get('manageproduction').value, 'true');
  assert.equal(projectedByKey.get('manyartillery').value, 'true');
  assert.equal(projectedByKey.get('manyships').value, 'true');
  assert.equal(projectedByKey.get('manyhappiness').value, 'true');
  assert.equal(projectedByKey.get('flavor_1').value, 'false');
  assert.equal(projectedByKey.get('flavor_2').value, 'true');
  assert.equal(projectedByKey.get('flavor_3').value, 'false');
  assert.equal(projectedByKey.get('flavor_4').value, 'false');

  const collapsed = collapseCivilizationBiqFields(projected, 4, 'value');
  assert.equal(collapsed.name, 'Kerigan');
  assert.equal(collapsed.freetech1, 'AMAZONIANS (101)');
  assert.equal(collapsed.numcities, '20');
  assert.equal(collapsed.nummilleaders, '5');
  assert.equal(collapsed.bonuses, '18');
  assert.equal(collapsed.governorsettings, '17');
  assert.equal(collapsed.buildoften, '548');
  assert.equal(collapsed.buildnever, '0');
  assert.equal(collapsed.flavors, '2');
});
