'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle } = require('../src/configCore');
const { projectImprovementBiqFields, collapseImprovementBiqFields } = require('../src/biq/bldgCodec');

const CIV3_ROOT = process.env.C3X_CIV3_ROOT || path.resolve(__dirname, '..', '..', '..');
const TIDES_BIQ = path.join(CIV3_ROOT, 'Conquests', 'Scenarios', 'TIDES OF CRIMSON.biq');

function getAcademyBundle() {
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

function getRawBldgMap(bundle, civilopediaKey) {
  const sections = (((bundle || {}).biq || {}).sections || []);
  const bldg = sections.find((section) => String(section && section.code || '').toUpperCase() === 'BLDG');
  const record = ((bldg && bldg.records) || []).find((candidate) => {
    const civField = ((candidate && candidate.fields) || []).find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').toUpperCase() === civilopediaKey;
  });
  assert.ok(record, `Expected ${civilopediaKey} raw BLDG record`);
  const map = new Map();
  (record.fields || []).forEach((field) => {
    map.set(String(field && (field.baseKey || field.key) || '').toLowerCase(), String(field && field.value || ''));
  });
  return map;
}

test('Academy in TIDES projects raw BLDG fields into Quint-style improvement UI fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getAcademyBundle();
  const academy = bundle.tabs.improvements.entries.find((entry) => entry.civilopediaKey === 'BLDG_LIBRARY');
  assert.ok(academy, 'Expected Academy / BLDG_LIBRARY improvement');

  const fieldKeys = new Set((academy.biqFields || []).map((field) => String(field.baseKey || field.key || '').toLowerCase()));
  assert.ok(fieldKeys.has('civilopediaentry'));
  assert.ok(fieldKeys.has('reqadvance'));
  assert.ok(fieldKeys.has('reqresource1'));
  assert.ok(fieldKeys.has('reqimprovement'));
  assert.ok(fieldKeys.has('maintenancecost'));
  assert.ok(fieldKeys.has('increasedresearch'));
  assert.ok(fieldKeys.has('scientific'));
  assert.ok(fieldKeys.has('improvement'));
  assert.ok(fieldKeys.has('wonder') && fieldKeys.has('smallwonder'));

  assert.equal(fieldKeys.has('req_advance'), false);
  assert.equal(fieldKeys.has('req_resource1'), false);
  assert.equal(fieldKeys.has('req_improvement'), false);
  assert.equal(fieldKeys.has('maintenance_cost'), false);
  assert.equal(fieldKeys.has('other_char'), false);
  assert.equal(fieldKeys.has('small_wonder_characteristics'), false);
  assert.equal(fieldKeys.has('wonder_characteristics'), false);

  assert.equal(academy.civilopediaKey, 'BLDG_LIBRARY');
  assert.equal(getField(academy, 'civilopediaentry').value, 'BLDG_Library');
  assert.equal(getField(academy, 'civilopediaentry').editable, false);
  assert.equal(getField(academy, 'reqadvance').value, '55');
  assert.equal(getField(academy, 'reqresource1').value, '31');
  assert.equal(getField(academy, 'reqimprovement').value, '14');
  assert.equal(getField(academy, 'reqgovernment').value, '-1');
  assert.equal(getField(academy, 'obsoleteby').value, '-1');
  assert.equal(getField(academy, 'maintenancecost').value, '3');
  assert.equal(getField(academy, 'culture').value, '1');
  assert.equal(getField(academy, 'unitfrequency').value, '1');

  assert.equal(getField(academy, 'increasedresearch').value, 'true');
  assert.equal(getField(academy, 'scientific').value, 'true');
  assert.equal(getField(academy, 'improvement').value, 'true');
  assert.equal(getField(academy, 'wonder').value, 'false');
  assert.equal(getField(academy, 'smallwonder').value, 'false');
});

test('Academy improvement UI fields collapse back to the original raw BLDG storage fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getAcademyBundle();
  const academy = bundle.tabs.improvements.entries.find((entry) => entry.civilopediaKey === 'BLDG_LIBRARY');
  assert.ok(academy, 'Expected Academy / BLDG_LIBRARY improvement');

  const raw = getRawBldgMap(bundle, 'BLDG_LIBRARY');
  const collapsed = collapseImprovementBiqFields(academy.biqFields, academy.improvementFlavorCount, 'value');

  const expectedKeys = [
    'cost',
    'culture',
    'maintenance_cost',
    'req_advance',
    'req_resource1',
    'req_resource2',
    'req_improvement',
    'req_government',
    'obsolete_by',
    'improvements',
    'other_char',
    'small_wonder_characteristics',
    'wonder_characteristics',
    'armies_required',
    'unit_produced',
    'unit_frequency',
    'flavors'
  ];

  expectedKeys.forEach((key) => {
    assert.equal(
      collapsed[key],
      raw.get(key),
      `Expected collapsed UI value for ${key} to round-trip to original raw BIQ value`
    );
  });
});

test('BLDG codec round-trips Quint packed flags without losing category, traits, or references', () => {
  const rawFields = [
    { baseKey: 'name', key: 'name', value: 'Parity Test', originalValue: 'Parity Test', editable: true },
    { baseKey: 'description', key: 'description', value: '', originalValue: '', editable: true },
    { baseKey: 'req_advance', key: 'req_advance', value: '55', originalValue: '55', editable: true },
    { baseKey: 'req_resource1', key: 'req_resource1', value: '31', originalValue: '31', editable: true },
    { baseKey: 'req_improvement', key: 'req_improvement', value: '14', originalValue: '14', editable: true },
    { baseKey: 'cost', key: 'cost', value: '9', originalValue: '9', editable: true },
    { baseKey: 'maintenance_cost', key: 'maintenance_cost', value: '3', originalValue: '3', editable: true },
    { baseKey: 'improvements', key: 'improvements', value: '4', originalValue: '4', editable: true },
    { baseKey: 'other_char', key: 'other_char', value: '32', originalValue: '32', editable: true },
    { baseKey: 'small_wonder_characteristics', key: 'small_wonder_characteristics', value: '0', originalValue: '0', editable: true },
    { baseKey: 'wonder_characteristics', key: 'wonder_characteristics', value: '0', originalValue: '0', editable: true },
    { baseKey: 'flavors', key: 'flavors', value: '5', originalValue: '5', editable: true }
  ];

  const projected = projectImprovementBiqFields({
    rawFields,
    civilopediaEntry: 'BLDG_TEST',
    flavorCount: 4
  });

  assert.equal(projected.some((field) => field.baseKey === 'req_advance'), false);
  assert.equal(projected.some((field) => field.baseKey === 'other_char'), false);
  assert.equal(projected.some((field) => field.baseKey === 'wonder_characteristics'), false);

  const projectedByKey = new Map(projected.map((field) => [field.baseKey, field]));
  assert.equal(projectedByKey.get('reqadvance').value, '55');
  assert.equal(projectedByKey.get('reqresource1').value, '31');
  assert.equal(projectedByKey.get('reqimprovement').value, '14');
  assert.equal(projectedByKey.get('increasedresearch').value, 'true');
  assert.equal(projectedByKey.get('scientific').value, 'true');
  assert.equal(projectedByKey.get('improvement').value, 'true');
  assert.equal(projectedByKey.get('flavor_1').value, 'true');
  assert.equal(projectedByKey.get('flavor_2').value, 'false');
  assert.equal(projectedByKey.get('flavor_3').value, 'true');
  assert.equal(projectedByKey.get('flavor_4').value, 'false');

  const collapsed = collapseImprovementBiqFields(projected, 4, 'value');
  assert.equal(collapsed.req_advance, '55');
  assert.equal(collapsed.req_resource1, '31');
  assert.equal(collapsed.req_improvement, '14');
  assert.equal(collapsed.improvements, '4');
  assert.equal(collapsed.other_char, '32');
  assert.equal(collapsed.small_wonder_characteristics, '0');
  assert.equal(collapsed.wonder_characteristics, '0');
  assert.equal(collapsed.flavors, '5');
});
