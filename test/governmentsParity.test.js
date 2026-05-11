'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle } = require('../src/configCore');
const { projectGovernmentBiqFields, collapseGovernmentBiqFields } = require('../src/biq/govtCodec');

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

function getRawGovtMap(bundle, civilopediaKey) {
  const sections = (((bundle || {}).biq || {}).sections || []);
  const govtSection = sections.find((section) => String(section && section.code || '').toUpperCase() === 'GOVT');
  const record = ((govtSection && govtSection.records) || []).find((candidate) => {
    const civField = ((candidate && candidate.fields) || []).find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').toUpperCase() === civilopediaKey;
  });
  assert.ok(record, `Expected ${civilopediaKey} raw GOVT record`);
  const map = new Map();
  (record.fields || []).forEach((field) => {
    map.set(String(field && (field.baseKey || field.key) || '').toLowerCase(), String(field && field.value || ''));
  });
  return map;
}

test('Air Sphere in TIDES projects raw GOVT fields into Quint-style government UI fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const govt = bundle.tabs.governments.entries.find((entry) => entry.civilopediaKey === 'GOVT_AIR');
  assert.ok(govt, 'Expected Air Sphere / GOVT_AIR government');

  const fieldKeys = new Set((govt.biqFields || []).map((field) => String(field.baseKey || field.key || '').toLowerCase()));
  assert.ok(fieldKeys.has('civilopediaentry'));
  assert.ok(fieldKeys.has('assimilationchance'));
  assert.ok(fieldKeys.has('militarypolicelimit'));
  assert.ok(fieldKeys.has('freeunitspertown'));
  assert.ok(fieldKeys.has('freeunitspercity'));
  assert.ok(fieldKeys.has('freeunitspermetropolis'));
  assert.ok(fieldKeys.has('malerulertitle1'));
  assert.ok(fieldKeys.has('femalerulertitle1'));
  assert.ok(fieldKeys.has('performance_of_this_government_versus_government_0'));
  assert.ok(fieldKeys.has('resistancemodifier'));
  assert.ok(fieldKeys.has('briberymodifier'));

  assert.equal(fieldKeys.has('assimilation'), false);
  assert.equal(fieldKeys.has('militarypolice'), false);
  assert.equal(fieldKeys.has('pertown'), false);
  assert.equal(fieldKeys.has('percity'), false);
  assert.equal(fieldKeys.has('permetropolis'), false);
  assert.equal(fieldKeys.has('maletitleera1'), false);
  assert.equal(fieldKeys.has('femaletitleera1'), false);
  assert.equal(fieldKeys.has('govt_relation_0_resistance_mod'), false);
  assert.equal(fieldKeys.has('govt_relation_0_bribery_mod'), false);

  assert.equal(govt.civilopediaKey, 'GOVT_AIR');
  assert.equal(getField(govt, 'civilopediaentry').value, 'GOVT_Air');
  assert.equal(getField(govt, 'civilopediaentry').editable, false);
  assert.equal(getField(govt, 'assimilationchance').value, '5');
  assert.equal(getField(govt, 'militarypolicelimit').value, '1');
  assert.equal(getField(govt, 'freeunitspertown').value, '0');
  assert.equal(getField(govt, 'freeunitspercity').value, '2');
  assert.equal(getField(govt, 'freeunitspermetropolis').value, '2');
  assert.equal(getField(govt, 'malerulertitle1').value, 'Sir');
  assert.equal(getField(govt, 'femalerulertitle1').value, 'Madame');
  assert.equal(getField(govt, 'performance_of_this_government_versus_government_0').value, 'Anarchy');
  assert.equal(getField(govt, 'performance_of_this_government_versus_government_0').label, 'Performance Vs Anarchy');
  assert.equal(getField(govt, 'resistancemodifier').value, '-5');
  assert.equal(getField(govt, 'briberymodifier').value, '30');
});

test('Air Sphere government UI fields collapse back to the original raw GOVT storage fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const govt = bundle.tabs.governments.entries.find((entry) => entry.civilopediaKey === 'GOVT_AIR');
  assert.ok(govt, 'Expected Air Sphere / GOVT_AIR government');

  const raw = getRawGovtMap(bundle, 'GOVT_AIR');
  const collapsed = collapseGovernmentBiqFields(govt.biqFields, 'value');
  const expectedKeys = [
    'prerequisitetechnology',
    'corruption',
    'sciencecap',
    'workerrate',
    'assimilation',
    'draftlimit',
    'militarypolice',
    'freeunits',
    'pertown',
    'percity',
    'permetropolis',
    'costperunit',
    'warweariness',
    'maletitleera1',
    'femaletitleera1',
    'govt_relation_0_can_bribe',
    'govt_relation_0_bribery_mod',
    'govt_relation_0_resistance_mod'
  ];
  expectedKeys.forEach((key) => {
    assert.equal(
      collapsed[key],
      raw.get(key),
      `Expected collapsed UI value for ${key} to round-trip to original raw GOVT value`
    );
  });
});

test('GOVT codec round-trips alias-normalized government fields and relation rows', () => {
  const rawFields = [
    { baseKey: 'name', key: 'name', value: 'Air Sphere', originalValue: 'Air Sphere', editable: true },
    { baseKey: 'prerequisitetechnology', key: 'prerequisitetechnology', value: 'Air Sphere (41)', originalValue: 'Air Sphere (41)', editable: true },
    { baseKey: 'assimilation', key: 'assimilation', value: '5', originalValue: '5', editable: true },
    { baseKey: 'militarypolice', key: 'militarypolice', value: '1', originalValue: '1', editable: true },
    { baseKey: 'pertown', key: 'pertown', value: '1', originalValue: '1', editable: true },
    { baseKey: 'percity', key: 'percity', value: '2', originalValue: '2', editable: true },
    { baseKey: 'permetropolis', key: 'permetropolis', value: '2', originalValue: '2', editable: true },
    { baseKey: 'maletitleera1', key: 'maletitleera1', value: 'Sir', originalValue: 'Sir', editable: true },
    { baseKey: 'femaletitleera1', key: 'femaletitleera1', value: 'Madame', originalValue: 'Madame', editable: true },
    { baseKey: 'govt_relation_0_can_bribe', key: 'govt_relation_0_can_bribe', value: '37644688', originalValue: '37644688', editable: true },
    { baseKey: 'govt_relation_0_bribery_mod', key: 'govt_relation_0_bribery_mod', value: '30', originalValue: '30', editable: true },
    { baseKey: 'govt_relation_0_resistance_mod', key: 'govt_relation_0_resistance_mod', value: '-5', originalValue: '-5', editable: true }
  ];

  const projected = projectGovernmentBiqFields({
    rawFields,
    civilopediaEntry: 'GOVT_TEST',
    governmentNames: ['Anarchy']
  });

  assert.equal(projected.some((field) => field.baseKey === 'assimilation'), false);
  assert.equal(projected.some((field) => field.baseKey === 'militarypolice'), false);
  assert.equal(projected.some((field) => field.baseKey === 'pertown'), false);
  assert.equal(projected.some((field) => field.baseKey === 'maletitleera1'), false);
  assert.equal(projected.some((field) => field.baseKey === 'govt_relation_0_bribery_mod'), false);

  const projectedByKey = new Map(projected.map((field, idx) => [`${field.baseKey}:${idx}`, field]));
  assert.equal(projected[0].baseKey, 'civilopediaentry');
  assert.equal(projected[0].editable, false);
  assert.equal(projected.find((field) => field.baseKey === 'assimilationchance').value, '5');
  assert.equal(projected.find((field) => field.baseKey === 'militarypolicelimit').value, '1');
  assert.equal(projected.find((field) => field.baseKey === 'freeunitspertown').value, '1');
  assert.equal(projected.find((field) => field.baseKey === 'malerulertitle1').value, 'Sir');
  assert.equal(projected.find((field) => field.baseKey === 'femalerulertitle1').value, 'Madame');
  assert.equal(projected.find((field) => field.baseKey === 'performance_of_this_government_versus_government_0').label, 'Performance Vs Anarchy');
  assert.equal(projected.find((field) => field.baseKey === 'resistancemodifier').value, '-5');
  assert.equal(projected.find((field) => field.baseKey === 'briberymodifier').value, '30');

  const collapsed = collapseGovernmentBiqFields(projected, 'value');
  assert.equal(collapsed.assimilation, '5');
  assert.equal(collapsed.militarypolice, '1');
  assert.equal(collapsed.pertown, '1');
  assert.equal(collapsed.percity, '2');
  assert.equal(collapsed.permetropolis, '2');
  assert.equal(collapsed.maletitleera1, 'Sir');
  assert.equal(collapsed.femaletitleera1, 'Madame');
  assert.equal(collapsed.govt_relation_0_can_bribe, '37644688');
  assert.equal(collapsed.govt_relation_0_resistance_mod, '-5');
  assert.equal(collapsed.govt_relation_0_bribery_mod, '30');
});

test('GOVT codec projects and collapses the full core government field set', () => {
  const rawFields = [
    { baseKey: 'name', value: 'Republic', originalValue: 'Republic', editable: true },
    { baseKey: 'prerequisitetechnology', value: '3', originalValue: '3', editable: true },
    { baseKey: 'corruption', value: '2', originalValue: '2', editable: true },
    { baseKey: 'sciencecap', value: '8', originalValue: '8', editable: true },
    { baseKey: 'workerrate', value: '3', originalValue: '3', editable: true },
    { baseKey: 'assimilation', value: '1', originalValue: '1', editable: true },
    { baseKey: 'draftlimit', value: '2', originalValue: '2', editable: true },
    { baseKey: 'militarypolice', value: '0', originalValue: '0', editable: true },
    { baseKey: 'defaulttype', value: '1', originalValue: '1', editable: true },
    { baseKey: 'transitiontype', value: '0', originalValue: '0', editable: true },
    { baseKey: 'requiresmaintenance', value: '1', originalValue: '1', editable: true },
    { baseKey: 'tilepenalty', value: '0', originalValue: '0', editable: true },
    { baseKey: 'commercebonus', value: '1', originalValue: '1', editable: true },
    { baseKey: 'xenophobic', value: '0', originalValue: '0', editable: true },
    { baseKey: 'forceresettlement', value: '1', originalValue: '1', editable: true },
    { baseKey: 'diplomatlevel', value: '2', originalValue: '2', editable: true },
    { baseKey: 'spylevel', value: '3', originalValue: '3', editable: true },
    { baseKey: 'immuneto', value: '4', originalValue: '4', editable: true },
    { baseKey: 'freeunits', value: '5', originalValue: '5', editable: true },
    { baseKey: 'costperunit', value: '6', originalValue: '6', editable: true },
    { baseKey: 'pertown', value: '7', originalValue: '7', editable: true },
    { baseKey: 'percity', value: '8', originalValue: '8', editable: true },
    { baseKey: 'permetropolis', value: '9', originalValue: '9', editable: true },
    { baseKey: 'hurrying', value: '1', originalValue: '1', editable: true },
    { baseKey: 'warweariness', value: '2', originalValue: '2', editable: true },
    { baseKey: 'questionMark1', value: '10', originalValue: '10', editable: true },
    { baseKey: 'qm2', value: '11', originalValue: '11', editable: true },
    { baseKey: 'qm3', value: '12', originalValue: '12', editable: true },
    { baseKey: 'qm4', value: '13', originalValue: '13', editable: true },
    { baseKey: 'rulertitlepairsused', value: '4', originalValue: '4', editable: true },
    { baseKey: 'maletitleera1', value: 'Consul', originalValue: 'Consul', editable: true },
    { baseKey: 'femaletitleera1', value: 'Consul', originalValue: 'Consul', editable: true },
    { baseKey: 'maletitleera2', value: 'Minister', originalValue: 'Minister', editable: true },
    { baseKey: 'femaletitleera2', value: 'Minister', originalValue: 'Minister', editable: true },
    { baseKey: 'maletitleera3', value: 'President', originalValue: 'President', editable: true },
    { baseKey: 'femaletitleera3', value: 'President', originalValue: 'President', editable: true },
    { baseKey: 'maletitleera4', value: 'Premier', originalValue: 'Premier', editable: true },
    { baseKey: 'femaletitleera4', value: 'Premier', originalValue: 'Premier', editable: true },
    { baseKey: 'govt_relation_0_can_bribe', value: '1', originalValue: '1', editable: true },
    { baseKey: 'govt_relation_0_bribery_mod', value: '14', originalValue: '14', editable: true },
    { baseKey: 'govt_relation_0_resistance_mod', value: '15', originalValue: '15', editable: true }
  ];

  const projected = projectGovernmentBiqFields({
    rawFields,
    civilopediaEntry: 'GOVT_REPUBLIC',
    governmentNames: ['Anarchy']
  });

  [
    'name',
    'prerequisitetechnology',
    'corruption',
    'sciencecap',
    'workerrate',
    'assimilationchance',
    'draftlimit',
    'militarypolicelimit',
    'defaulttype',
    'transitiontype',
    'requiresmaintenance',
    'tilepenalty',
    'commercebonus',
    'xenophobic',
    'forceresettlement',
    'diplomatlevel',
    'spylevel',
    'immuneto',
    'freeunits',
    'costperunit',
    'freeunitspertown',
    'freeunitspercity',
    'freeunitspermetropolis',
    'hurrying',
    'warweariness',
    'questionmarkone',
    'questionmarktwo',
    'questionmarkthree',
    'questionmarkfour',
    'rulertitlepairsused',
    'malerulertitle1',
    'femalerulertitle1',
    'malerulertitle2',
    'femalerulertitle2',
    'malerulertitle3',
    'femalerulertitle3',
    'malerulertitle4',
    'femalerulertitle4',
    'performance_of_this_government_versus_government_0',
    'canbribe',
    'resistancemodifier',
    'briberymodifier'
  ].forEach((key) => {
    assert.ok(projected.find((field) => field.baseKey === key), `expected projected field ${key}`);
  });

  const collapsed = collapseGovernmentBiqFields(projected, 'value');
  assert.deepEqual(collapsed, {
    name: 'Republic',
    prerequisitetechnology: '3',
    corruption: '2',
    sciencecap: '8',
    workerrate: '3',
    assimilation: '1',
    draftlimit: '2',
    militarypolice: '0',
    defaulttype: '1',
    transitiontype: '0',
    requiresmaintenance: '1',
    tilepenalty: '0',
    commercebonus: '1',
    xenophobic: '0',
    forceresettlement: '1',
    diplomatlevel: '2',
    spylevel: '3',
    immuneto: '4',
    freeunits: '5',
    costperunit: '6',
    pertown: '7',
    percity: '8',
    permetropolis: '9',
    hurrying: '1',
    warweariness: '2',
    questionmarkone: '10',
    questionmarktwo: '11',
    questionmarkthree: '12',
    questionmarkfour: '13',
    rulertitlepairsused: '4',
    maletitleera1: 'Consul',
    femaletitleera1: 'Consul',
    maletitleera2: 'Minister',
    femaletitleera2: 'Minister',
    maletitleera3: 'President',
    femaletitleera3: 'President',
    maletitleera4: 'Premier',
    femaletitleera4: 'Premier',
    govt_relation_0_can_bribe: '1',
    govt_relation_0_resistance_mod: '15',
    govt_relation_0_bribery_mod: '14'
  });
});
