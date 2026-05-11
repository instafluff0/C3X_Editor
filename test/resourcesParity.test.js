'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle } = require('../src/configCore');
const { projectResourceBiqFields, collapseResourceBiqFields } = require('../src/biq/goodCodec');

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

function getRawGoodMap(bundle, civilopediaKey) {
  const sections = (((bundle || {}).biq || {}).sections || []);
  const goodSection = sections.find((section) => String(section && section.code || '').toUpperCase() === 'GOOD');
  const record = ((goodSection && goodSection.records) || []).find((candidate) => {
    const civField = ((candidate && candidate.fields) || []).find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').toUpperCase() === civilopediaKey;
  });
  assert.ok(record, `Expected ${civilopediaKey} raw GOOD record`);
  const map = new Map();
  (record.fields || []).forEach((field) => {
    map.set(String(field && (field.baseKey || field.key) || '').toLowerCase(), String(field && field.value || ''));
  });
  return map;
}

test('Iron in TIDES projects GOOD fields into canonical resource UI fields with readonly civilopedia entry', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const iron = bundle.tabs.resources.entries.find((entry) => entry.civilopediaKey === 'GOOD_IRON');
  assert.ok(iron, 'Expected Iron / GOOD_IRON resource');

  const fieldKeys = new Set((iron.biqFields || []).map((field) => String(field.baseKey || field.key || '').toLowerCase()));
  assert.ok(fieldKeys.has('civilopediaentry'));
  assert.ok(fieldKeys.has('type'));
  assert.ok(fieldKeys.has('appearanceratio'));
  assert.ok(fieldKeys.has('disapperanceprobability'));
  assert.ok(fieldKeys.has('icon'));
  assert.ok(fieldKeys.has('prerequisite'));
  assert.ok(fieldKeys.has('foodbonus'));
  assert.ok(fieldKeys.has('shieldsbonus'));
  assert.ok(fieldKeys.has('commercebonus'));

  assert.equal(iron.civilopediaKey, 'GOOD_IRON');
  assert.equal(getField(iron, 'civilopediaentry').value, 'GOOD_Iron');
  assert.equal(getField(iron, 'civilopediaentry').editable, false);
  assert.equal(getField(iron, 'type').value, 'Strategic (2)');
  assert.equal(getField(iron, 'appearanceratio').value, '175');
  assert.equal(getField(iron, 'disapperanceprobability').value, '0');
  assert.equal(getField(iron, 'icon').value, '12');
  assert.equal(getField(iron, 'prerequisite').value, 'Iron Working (7)');
  assert.equal(getField(iron, 'foodbonus').value, '0');
  assert.equal(getField(iron, 'shieldsbonus').value, '1');
  assert.equal(getField(iron, 'commercebonus').value, '1');
});

test('Iron resource UI fields collapse back to the original raw GOOD storage fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const iron = bundle.tabs.resources.entries.find((entry) => entry.civilopediaKey === 'GOOD_IRON');
  assert.ok(iron, 'Expected Iron / GOOD_IRON resource');

  const raw = getRawGoodMap(bundle, 'GOOD_IRON');
  const collapsed = collapseResourceBiqFields(iron.biqFields, 'value');
  const expectedKeys = [
    'type',
    'appearanceratio',
    'disapperanceprobability',
    'icon',
    'prerequisite',
    'foodbonus',
    'shieldsbonus',
    'commercebonus'
  ];

  expectedKeys.forEach((key) => {
    assert.equal(
      collapsed[key],
      raw.get(key),
      `Expected collapsed UI value for ${key} to round-trip to original raw GOOD value`
    );
  });
});

test('GOOD codec round-trips resource identity, prerequisite, and bonus fields without exposing storage drift', () => {
  const rawFields = [
    { baseKey: 'name', key: 'name', value: 'Iron', originalValue: 'Iron', editable: true },
    { baseKey: 'type', key: 'type', value: 'Strategic (2)', originalValue: 'Strategic (2)', editable: true },
    { baseKey: 'appearanceratio', key: 'appearanceratio', value: '175', originalValue: '175', editable: true },
    { baseKey: 'disapperanceprobability', key: 'disapperanceprobability', value: '0', originalValue: '0', editable: true },
    { baseKey: 'icon', key: 'icon', value: '12', originalValue: '12', editable: true },
    { baseKey: 'prerequisite', key: 'prerequisite', value: 'Iron Working (7)', originalValue: 'Iron Working (7)', editable: true },
    { baseKey: 'foodbonus', key: 'foodbonus', value: '0', originalValue: '0', editable: true },
    { baseKey: 'shieldsbonus', key: 'shieldsbonus', value: '1', originalValue: '1', editable: true },
    { baseKey: 'commercebonus', key: 'commercebonus', value: '1', originalValue: '1', editable: true }
  ];

  const projected = projectResourceBiqFields({
    rawFields,
    civilopediaEntry: 'GOOD_TEST'
  });
  const projectedByKey = new Map(projected.map((field) => [field.baseKey, field]));

  assert.equal(projectedByKey.get('civilopediaentry').editable, false);
  assert.equal(projectedByKey.get('type').value, 'Strategic (2)');
  assert.equal(projectedByKey.get('icon').value, '12');
  assert.equal(projectedByKey.get('prerequisite').value, 'Iron Working (7)');
  assert.equal(projectedByKey.get('shieldsbonus').value, '1');

  const collapsed = collapseResourceBiqFields(projected, 'value');
  assert.equal(collapsed.type, 'Strategic (2)');
  assert.equal(collapsed.appearanceratio, '175');
  assert.equal(collapsed.icon, '12');
  assert.equal(collapsed.prerequisite, 'Iron Working (7)');
  assert.equal(collapsed.shieldsbonus, '1');
});
