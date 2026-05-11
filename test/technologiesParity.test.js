'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle } = require('../src/configCore');
const { projectTechnologyBiqFields, collapseTechnologyBiqFields } = require('../src/biq/techCodec');

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

function getRawTechMap(bundle, civilopediaKey) {
  const sections = (((bundle || {}).biq || {}).sections || []);
  const techSection = sections.find((section) => String(section && section.code || '').toUpperCase() === 'TECH');
  const record = ((techSection && techSection.records) || []).find((candidate) => {
    const civField = ((candidate && candidate.fields) || []).find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').toUpperCase() === civilopediaKey;
  });
  assert.ok(record, `Expected ${civilopediaKey} raw TECH record`);
  const map = new Map();
  (record.fields || []).forEach((field) => {
    map.set(String(field && (field.baseKey || field.key) || '').toLowerCase(), String(field && field.value || ''));
  });
  return map;
}

test('Writing in TIDES projects raw TECH flags into Quint-style technology UI fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const writing = bundle.tabs.technologies.entries.find((entry) => entry.civilopediaKey === 'TECH_WRITING');
  assert.ok(writing, 'Expected Writing / TECH_WRITING technology');

  const fieldKeys = new Set((writing.biqFields || []).map((field) => String(field.baseKey || field.key || '').toLowerCase()));
  assert.ok(fieldKeys.has('civilopediaentry'));
  assert.ok(fieldKeys.has('prerequisite1'));
  assert.ok(fieldKeys.has('questionmark'));
  assert.ok(fieldKeys.has('enablesdiplomats'));
  assert.ok(fieldKeys.has('disablesfloodplaindisease'));
  assert.ok(fieldKeys.has('enablesrop'));
  assert.ok(fieldKeys.has('enablesalliances'));
  assert.ok(fieldKeys.has('notrequiredforadvancement'));
  assert.ok(fieldKeys.has('cannotbetraded'));
  assert.ok(fieldKeys.has('flavor_1'));

  assert.equal(fieldKeys.has('flags'), false);
  assert.equal(fieldKeys.has('flavors'), false);

  assert.equal(writing.civilopediaKey, 'TECH_WRITING');
  assert.equal(getField(writing, 'civilopediaentry').value, 'TECH_Writing');
  assert.equal(getField(writing, 'questionmark').value, '1');
  assert.equal(getField(writing, 'enablesdiplomats').value, 'true');
  assert.equal(getField(writing, 'disablesfloodplaindisease').value, 'true');
  assert.equal(getField(writing, 'enablesrop').value, 'true');
  assert.equal(getField(writing, 'enablesalliances').value, 'true');
  assert.equal(getField(writing, 'notrequiredforadvancement').value, 'false');
  assert.equal(getField(writing, 'cannotbetraded').value, 'false');
});

test('Chivalry in TIDES projects TECH flavors and round-trips back to original raw storage', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const chivalry = bundle.tabs.technologies.entries.find((entry) => entry.civilopediaKey === 'TECH_CHIVALRY');
  assert.ok(chivalry, 'Expected Chivalry / TECH_CHIVALRY technology');

  assert.equal(chivalry.technologyFlavorCount, 7);
  assert.equal(getField(chivalry, 'notrequiredforadvancement').value, 'true');
  assert.equal(getField(chivalry, 'flavor_1').value, 'true');
  assert.equal(getField(chivalry, 'flavor_2').value, 'true');
  assert.equal(getField(chivalry, 'flavor_3').value, 'true');
  assert.equal(getField(chivalry, 'flavor_4').value, 'true');
  assert.equal(getField(chivalry, 'flavor_5').value, 'true');
  assert.equal(getField(chivalry, 'flavor_6').value, 'false');
  assert.equal(getField(chivalry, 'flavor_7').value, 'false');

  const raw = getRawTechMap(bundle, 'TECH_CHIVALRY');
  const collapsed = collapseTechnologyBiqFields(chivalry.biqFields, chivalry.technologyFlavorCount, 'value');
  const expectedKeys = [
    'cost',
    'era',
    'advanceicon',
    'x',
    'y',
    'prerequisite1',
    'prerequisite2',
    'prerequisite3',
    'prerequisite4',
    'flags',
    'flavors',
    'questionmark'
  ];

  expectedKeys.forEach((key) => {
    assert.equal(
      collapsed[key],
      raw.get(key),
      `Expected collapsed UI value for ${key} to round-trip to original raw TECH value`
    );
  });
});

test('TECH codec round-trips Quint packed flags and flavor bits without exposing raw storage fields', () => {
  const rawFields = [
    { baseKey: 'name', key: 'name', value: 'Parity Tech', originalValue: 'Parity Tech', editable: true },
    { baseKey: 'cost', key: 'cost', value: '8', originalValue: '8', editable: true },
    { baseKey: 'era', key: 'era', value: 'Dark Ages (0)', originalValue: 'Dark Ages (0)', editable: true },
    { baseKey: 'advanceicon', key: 'advanceicon', value: '82', originalValue: '82', editable: true },
    { baseKey: 'x', key: 'x', value: '285', originalValue: '285', editable: true },
    { baseKey: 'y', key: 'y', value: '281', originalValue: '281', editable: true },
    { baseKey: 'prerequisite1', key: 'prerequisite1', value: 'Farming (2)', originalValue: 'Farming (2)', editable: true },
    { baseKey: 'prerequisite2', key: 'prerequisite2', value: 'None', originalValue: 'None', editable: true },
    { baseKey: 'prerequisite3', key: 'prerequisite3', value: 'None', originalValue: 'None', editable: true },
    { baseKey: 'prerequisite4', key: 'prerequisite4', value: 'None', originalValue: 'None', editable: true },
    { baseKey: 'flags', key: 'flags', value: '1545', originalValue: '1545', editable: true },
    { baseKey: 'flavors', key: 'flavors', value: '5', originalValue: '5', editable: true },
    { baseKey: 'questionmark', key: 'questionmark', value: '1', originalValue: '1', editable: true }
  ];

  const projected = projectTechnologyBiqFields({
    rawFields,
    civilopediaEntry: 'TECH_TEST',
    flavorCount: 4
  });

  assert.equal(projected.some((field) => field.baseKey === 'flags'), false);
  assert.equal(projected.some((field) => field.baseKey === 'flavors'), false);

  const projectedByKey = new Map(projected.map((field) => [field.baseKey, field]));
  assert.equal(projectedByKey.get('civilopediaentry').editable, false);
  assert.equal(projectedByKey.get('questionmark').value, '1');
  assert.equal(projectedByKey.get('enablesdiplomats').value, 'true');
  assert.equal(projectedByKey.get('disablesfloodplaindisease').value, 'true');
  assert.equal(projectedByKey.get('enablesrop').value, 'true');
  assert.equal(projectedByKey.get('enablesalliances').value, 'true');
  assert.equal(projectedByKey.get('flavor_1').value, 'true');
  assert.equal(projectedByKey.get('flavor_2').value, 'false');
  assert.equal(projectedByKey.get('flavor_3').value, 'true');
  assert.equal(projectedByKey.get('flavor_4').value, 'false');

  const collapsed = collapseTechnologyBiqFields(projected, 4, 'value');
  assert.equal(collapsed.flags, '1545');
  assert.equal(collapsed.flavors, '5');
  assert.equal(collapsed.questionmark, '1');
  assert.equal(collapsed.prerequisite1, 'Farming (2)');
});
