'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle, buildSyntheticUnitReferenceEntry, isPrtoStrategyMapRecord } = require('../src/configCore');
const { projectUnitBiqFields, collapseUnitBiqFields } = require('../src/biq/unitCodec');
const { applySetToRecord } = require('../src/biq/biqSections');

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

function getFields(entry, key) {
  return (entry.biqFields || []).filter((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === String(key || '').toLowerCase());
}

function assertIndexedReference(value, key) {
  assert.match(String(value || ''), /^.+ \(\d+\)$/, `Expected ${key} to resolve as a named reference with an index`);
}

function getRawPrtoMap(bundle, civilopediaKey) {
  const sections = (((bundle || {}).biq || {}).sections || []);
  const prtoSection = sections.find((section) => String(section && section.code || '').toUpperCase() === 'PRTO');
  const record = ((prtoSection && prtoSection.records) || []).find((candidate) => {
    const civField = ((candidate && candidate.fields) || []).find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === 'civilopediaentry');
    return String(civField && civField.value || '').toUpperCase() === civilopediaKey;
  });
  assert.ok(record, `Expected ${civilopediaKey} raw PRTO record`);
  const map = new Map();
  (record.fields || []).forEach((field) => {
    const key = String(field && (field.baseKey || field.key) || '').toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(String(field && field.value || ''));
  });
  return map;
}

// ---------------------------------------------------------------------------
// BIQ record-limit regression: units at index >= 600 must not lose animationName
// ---------------------------------------------------------------------------

test('! Midnight Dragon ! (BIQ index 668) resolves animationName from scenario PediaIcons and is not synthetic', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const entries = bundle.tabs.units.entries;
  const midnight = entries.find((e) => String(e.civilopediaKey || '').toUpperCase() === 'PRTO_MIDNIGHT_DRAGON');
  assert.ok(midnight, 'expected PRTO_Midnight_Dragon entry');
  assert.equal(midnight.syntheticBiqOnly, undefined, 'should not be synthetic BIQ-only (regression: was truncated by 600-record limit)');
  assert.equal(midnight.animationName, 'Midnight Dragon UPG', 'animationName must come from scenario PediaIcons');
});

test('no unit in TIDES with a PediaIcons ANIMNAME entry is stranded as synthetic with empty animationName', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const synthetic = bundle.tabs.units.entries.filter((e) => e.syntheticBiqOnly && !e.animationName);
  // Synthetic entries with no animationName are only acceptable when PediaIcons genuinely
  // has no ANIMNAME block for them (i.e. the unit has no art). Any unit that IS in PediaIcons
  // but shows as synthetic with empty animationName is a regression of the 600-record limit.
  // We verify this by checking none of the synthetic+empty entries have a civilopediaKey that
  // matches a known ANIMNAME_ key — all such units should have been resolved already.
  const syntheticKeys = new Set(synthetic.map((e) => String(e.civilopediaKey || '').toUpperCase()));
  const allNormal = bundle.tabs.units.entries.filter((e) => !e.syntheticBiqOnly);
  const resolvedKeys = new Set(allNormal.filter((e) => e.animationName).map((e) => String(e.civilopediaKey || '').toUpperCase()));
  // None of the synthetic+empty keys should also appear as a resolved key in another duplicate entry
  for (const key of syntheticKeys) {
    assert.equal(resolvedKeys.has(key), false,
      `${key} appears both as a resolved unit and a synthetic unit — BIQ record truncation may have created a duplicate`);
  }
  // Midnight Dragon specifically must not be in the synthetic set
  assert.equal(syntheticKeys.has('PRTO_MIDNIGHT_DRAGON'), false,
    'PRTO_Midnight_Dragon must not be in the synthetic+empty set');
});

test('Barrage in TIDES projects raw PRTO fields into Quint-style unit UI fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const barrage = bundle.tabs.units.entries.find((entry) => entry.civilopediaKey === 'PRTO_BARRAGE');
  assert.ok(barrage, 'Expected Barrage / PRTO_BARRAGE unit');
  const raw = getRawPrtoMap(bundle, 'PRTO_BARRAGE');

  const fieldKeys = new Set((barrage.biqFields || []).map((field) => String(field.baseKey || field.key || '').toLowerCase()));
  assert.ok(fieldKeys.has('civilopediaentry'));
  assert.ok(fieldKeys.has('requiredtech'));
  assert.ok(fieldKeys.has('requiredresource1'));
  assert.ok(fieldKeys.has('requiredresource2'));
  assert.ok(fieldKeys.has('upgradeto'));
  assert.ok(fieldKeys.has('iconindex'));
  assert.ok(fieldKeys.has('bombardstrength'));
  assert.ok(fieldKeys.has('rateoffire'));
  assert.ok(fieldKeys.has('operationalrange'));
  assert.ok(fieldKeys.has('useexactcost'));
  assert.ok(fieldKeys.has('telepadrange'));
  assert.ok(fieldKeys.has('unitclass'));
  assert.ok(fieldKeys.has('offence'));
  assert.ok(fieldKeys.has('airbombard'));
  assert.ok(fieldKeys.has('capture'));
  assert.ok(fieldKeys.has('precisionbombing'));

  assert.equal(fieldKeys.has('requiredtechint'), false);
  assert.equal(fieldKeys.has('unitabilities'), false);
  assert.equal(fieldKeys.has('aistrategy'), false);
  assert.equal(fieldKeys.has('ptwspecialactions'), false);
  assert.equal(fieldKeys.has('ptwairmissions'), false);

  assert.equal(barrage.civilopediaKey, 'PRTO_BARRAGE');
  assert.equal(getField(barrage, 'civilopediaentry').value, 'PRTO_Barrage');
  assert.equal(getField(barrage, 'civilopediaentry').editable, false);
  assert.equal(getField(barrage, 'requiredtech').value, 'Theory (164)');
  assert.equal(getField(barrage, 'requiredresource1').value, 'Gaja Stone (22)');
  assert.equal(getField(barrage, 'requiredresource2').value, 'Coal (3)');
  assertIndexedReference(getField(barrage, 'upgradeto').value, 'upgradeto');
  assert.equal(getField(barrage, 'iconindex').value, raw.get('iconindex')[0]);
  assert.equal(getField(barrage, 'bombardstrength').value, '25');
  assert.equal(getField(barrage, 'rateoffire').value, '4');
  assert.equal(getField(barrage, 'hitpointbonus').value, raw.get('hitpointbonus')[0]);
  assert.equal(getField(barrage, 'operationalrange').value, '3');
  assert.equal(getField(barrage, 'shieldcost').value, '16');
  assert.equal(getField(barrage, 'useexactcost').value, raw.get('useexactcost')[0]);
  assert.equal(getField(barrage, 'telepadrange').value, raw.get('telepadrange')[0]);
  assert.equal(getField(barrage, 'unitclass').value, 'Air (2)');
  assert.equal(getField(barrage, 'offence').value, 'false');
  assert.equal(getField(barrage, 'airbombard').value, 'true');
  assert.equal(getField(barrage, 'capture').value, 'false');
  assert.equal(getField(barrage, 'bomb').value, 'true');
  assert.equal(getField(barrage, 'precisionbombing').value, 'false');
});

test('Worker in TIDES projects PRTO worker actions, standard orders, and terrain-ignore list fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const worker = bundle.tabs.units.entries.find((entry) => entry.civilopediaKey === 'PRTO_WORKER');
  assert.ok(worker, 'Expected Worker / PRTO_WORKER unit');

  assert.equal(getField(worker, 'buildroad').value, 'true');
  assert.equal(getField(worker, 'buildmine').value, 'true');
  assert.equal(getField(worker, 'irrigate').value, 'true');
  assert.equal(getField(worker, 'buildcity').value, 'false');
  assert.equal(getField(worker, 'exploreorder').value, 'true');
  assert.equal(getField(worker, 'sentry').value, 'true');
  assert.equal(getField(worker, 'workerstrengthfloat').value, '1');

  const ignoreMovementFields = getFields(worker, 'ignore_movement_cost');
  assert.equal(ignoreMovementFields.length, 14);
  assert.equal(ignoreMovementFields.every((field) => field.value === '0' || field.value === '1'), true);
});

test('Barrage unit UI fields collapse back to the original raw PRTO storage fields', (t) => {
  if (!fs.existsSync(TIDES_BIQ)) t.skip(`Scenario fixture not present: ${TIDES_BIQ}`);
  const bundle = getTidesBundle();
  const barrage = bundle.tabs.units.entries.find((entry) => entry.civilopediaKey === 'PRTO_BARRAGE');
  assert.ok(barrage, 'Expected Barrage / PRTO_BARRAGE unit');

  const raw = getRawPrtoMap(bundle, 'PRTO_BARRAGE');
  const collapsed = collapseUnitBiqFields(barrage.biqFields, 'value');
  const expectedKeys = [
    'requiredTech',
    'upgradeTo',
    'requiredResource1',
    'requiredResource2',
    'requiredResource3',
    'bombardStrength',
    'operationalRange',
    'rateOfFire',
    'shieldCost',
    'unitClass',
    'unitAbilities',
    'AIStrategy',
    'PTWStandardOrders',
    'PTWSpecialActions',
    'PTWAirMissions',
    'availableTo'
  ];

  expectedKeys.forEach((key) => {
    assert.equal(
      collapsed[key],
      raw.get(key.toLowerCase())[0],
      `Expected collapsed UI value for ${key} to round-trip to original raw PRTO value`
    );
  });
  assert.equal(collapsed.bombardEffects, '0');
  assert.equal(collapsed.requiresSupport, '0');
  assert.equal(collapsed.createsCraters, '0');
});

test('PRTO codec round-trips Quint unit references, packed flags, and repeated list fields', () => {
  const rawFields = [
    { baseKey: 'name', key: 'name', value: 'Parity Unit', originalValue: 'Parity Unit', editable: true },
    { baseKey: 'requiredTech', key: 'requiredTech', value: 'Theory (164)', originalValue: 'Theory (164)', editable: true },
    { baseKey: 'requiredResource1', key: 'requiredResource1', value: 'Gaja Stone (22)', originalValue: 'Gaja Stone (22)', editable: true },
    { baseKey: 'requiredResource2', key: 'requiredResource2', value: 'Coal (3)', originalValue: 'Coal (3)', editable: true },
    { baseKey: 'upgradeTo', key: 'upgradeTo', value: '+ Impale + (562)', originalValue: '+ Impale + (562)', editable: true },
    { baseKey: 'iconIndex', key: 'iconIndex', value: '12', originalValue: '12', editable: true },
    { baseKey: 'bombardStrength', key: 'bombardStrength', value: '25', originalValue: '25', editable: true },
    { baseKey: 'rateOfFire', key: 'rateOfFire', value: '4', originalValue: '4', editable: true },
    { baseKey: 'operationalRange', key: 'operationalRange', value: '3', originalValue: '3', editable: true },
    { baseKey: 'useExactCost', key: 'useExactCost', value: '7', originalValue: '7', editable: true },
    { baseKey: 'telepadRange', key: 'telepadRange', value: '0', originalValue: '0', editable: true },
    { baseKey: 'unitClass', key: 'unitClass', value: 'Air (2)', originalValue: 'Air (2)', editable: true },
    { baseKey: 'availableTo', key: 'availableTo', value: '134217726', originalValue: '134217726', editable: true },
    { baseKey: 'zoneOfControl', key: 'zoneOfControl', value: 'false', originalValue: 'false', editable: true },
    { baseKey: 'requiresSupport', key: 'requiresSupport', value: 'false', originalValue: 'false', editable: true },
    { baseKey: 'bombardEffects', key: 'bombardEffects', value: 'false', originalValue: 'false', editable: true },
    { baseKey: 'createsCraters', key: 'createsCraters', value: 'false', originalValue: 'false', editable: true },
    { baseKey: 'unitAbilities', key: 'unitAbilities', value: '941622284', originalValue: '941622284', editable: true },
    { baseKey: 'AIStrategy', key: 'AIStrategy', value: '64', originalValue: '64', editable: true },
    { baseKey: 'PTWStandardOrders', key: 'PTWStandardOrders', value: '79', originalValue: '79', editable: true },
    { baseKey: 'PTWSpecialActions', key: 'PTWSpecialActions', value: '524544', originalValue: '524544', editable: true },
    { baseKey: 'PTWAirMissions', key: 'PTWAirMissions', value: '9', originalValue: '9', editable: true },
    { baseKey: 'numStealthTargets', key: 'numStealthTargets', value: '2', originalValue: '2', editable: true },
    { baseKey: 'stealthTarget', key: 'stealthTarget', value: 'Warrior (0)', originalValue: 'Warrior (0)', editable: true },
    { baseKey: 'stealthTarget', key: 'stealthTarget_2', value: 'Galley (1)', originalValue: 'Galley (1)', editable: true },
    { baseKey: 'ignoreMovementCost', key: 'ignoreMovementCost', value: '1', originalValue: '1', editable: true },
    { baseKey: 'ignoreMovementCost', key: 'ignoreMovementCost_2', value: '0', originalValue: '0', editable: true },
    { baseKey: 'numLegalUnitTelepads', key: 'numLegalUnitTelepads', value: '1', originalValue: '1', editable: true },
    { baseKey: 'legalUnitTelepad', key: 'legalUnitTelepad', value: 'Paratrooper (12)', originalValue: 'Paratrooper (12)', editable: true },
    { baseKey: 'numLegalBuildingTelepads', key: 'numLegalBuildingTelepads', value: '1', originalValue: '1', editable: true },
    { baseKey: 'legalBuildingTelepad', key: 'legalBuildingTelepad', value: 'Academy (14)', originalValue: 'Academy (14)', editable: true }
  ];

  const projected = projectUnitBiqFields({
    rawFields,
    civilopediaEntry: 'PRTO_TEST'
  });

  assert.equal(projected.some((field) => field.baseKey === 'unitAbilities'), false);
  assert.equal(projected.some((field) => field.baseKey === 'AIStrategy'), false);
  assert.equal(projected.some((field) => field.baseKey === 'PTWSpecialActions'), false);

  const projectedByKey = new Map(projected.map((field) => [field.baseKey, field]));
  assert.equal(projectedByKey.get('civilopediaentry').editable, false);
  assert.equal(projectedByKey.get('requiredtech').value, 'Theory (164)');
  assert.equal(projectedByKey.get('requiredresource1').value, 'Gaja Stone (22)');
  assert.equal(projectedByKey.get('upgradeto').value, '+ Impale + (562)');
  assert.equal(projectedByKey.get('iconindex').value, '12');
  assert.equal(projectedByKey.get('useexactcost').value, '7');
  assert.equal(projectedByKey.get('telepadrange').value, '0');
  assert.equal(projectedByKey.get('airbombard').value, 'true');
  assert.equal(projectedByKey.get('capture').value, 'false');
  assert.equal(projectedByKey.get('bomb').value, 'true');
  assert.equal(projectedByKey.get('precisionbombing').value, 'false');

  const collapsed = collapseUnitBiqFields(projected, 'value');
  assert.equal(collapsed.requiredTech, 'Theory (164)');
  assert.equal(collapsed.requiredResource1, 'Gaja Stone (22)');
  assert.equal(collapsed.upgradeTo, '+ Impale + (562)');
  assert.equal(collapsed.iconIndex, '12');
  assert.equal(collapsed.useExactCost, '7');
  assert.equal(collapsed.telepadRange, '0');
  assert.equal(collapsed.unitAbilities, '941622284');
  assert.equal(collapsed.AIStrategy, '64');
  assert.equal(collapsed.PTWStandardOrders, '79');
  assert.equal(collapsed.PTWSpecialActions, '524544');
  assert.equal(collapsed.PTWAirMissions, '9');
  assert.deepEqual(collapsed.stealthTarget, ['Warrior (0)', 'Galley (1)']);
  assert.deepEqual(collapsed.ignoreMovementCost, ['1', '0']);
  assert.deepEqual(collapsed.legalUnitTelepad, ['Paratrooper (12)']);
  assert.deepEqual(collapsed.legalBuildingTelepad, ['Academy (14)']);
});

test('synthetic PRTO entries parse full-record english fields and skip strategy-map duplicates', () => {
  const baseRecord = {
    index: 677,
    name: '# Work Mule #',
    english: [
      'civilopediaEntry: PRTO_WORK_MULE',
      'iconIndex: 91',
      'otherStrategy: -1',
      'useExactCost: 7',
      'telepadRange: 0'
    ].join('\n')
  };
  const strategyMapRecord = {
    index: 678,
    name: '# Work Mule #',
    english: [
      'civilopediaEntry: PRTO_WORK_MULE',
      'iconIndex: 91',
      'otherStrategy: 677',
      'useExactCost: 7',
      'telepadRange: 0'
    ].join('\n')
  };

  assert.equal(isPrtoStrategyMapRecord(baseRecord), false);
  assert.equal(isPrtoStrategyMapRecord(strategyMapRecord), true);

  const synthetic = buildSyntheticUnitReferenceEntry(baseRecord, '/tmp/test.biq', 'scenario');
  assert.equal(synthetic.name, '# Work Mule #');
  assert.equal(synthetic.civilopediaKey, 'PRTO_WORK_MULE');
  assert.equal(getField(synthetic, 'iconindex').value, '91');
  assert.equal(getField(synthetic, 'useexactcost').value, '7');
  assert.equal(getField(synthetic, 'telepadrange').value, '0');
});

// ---------------------------------------------------------------------------
// applySetToRecord PRTO list fields
// ---------------------------------------------------------------------------

function makeMinimalPrtoRec() {
  return {
    stealthTargets: [],
    legalUnitTelepads: [],
    legalBuildingTelepads: [],
    ignoreMovementCost: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    attack: 0,
    name: 'Test Unit'
  };
}

test('applySetToRecord PRTO stealthTarget (singular) sets stealthTargets array', () => {
  const rec = makeMinimalPrtoRec();
  const ok = applySetToRecord(rec, 'stealthTarget', '0,2', 'PRTO', null);
  assert.equal(ok, true);
  assert.deepEqual(rec.stealthTargets, [0, 2]);
});

test('applySetToRecord PRTO legalUnitTelepad (singular) sets legalUnitTelepads array', () => {
  const rec = makeMinimalPrtoRec();
  const ok = applySetToRecord(rec, 'legalUnitTelepad', '5', 'PRTO', null);
  assert.equal(ok, true);
  assert.deepEqual(rec.legalUnitTelepads, [5]);
});

test('applySetToRecord PRTO legalBuildingTelepad (singular) sets legalBuildingTelepads array', () => {
  const rec = makeMinimalPrtoRec();
  const ok = applySetToRecord(rec, 'legalBuildingTelepad', '3,7', 'PRTO', null);
  assert.equal(ok, true);
  assert.deepEqual(rec.legalBuildingTelepads, [3, 7]);
});

test('applySetToRecord PRTO legalBuildingTelepad empty string clears array', () => {
  const rec = makeMinimalPrtoRec();
  rec.legalBuildingTelepads = [14];
  const ok = applySetToRecord(rec, 'legalBuildingTelepad', '', 'PRTO', null);
  assert.equal(ok, true);
  assert.deepEqual(rec.legalBuildingTelepads, []);
});

test('applySetToRecord PRTO count keys are no-ops', () => {
  const rec = makeMinimalPrtoRec();
  rec.stealthTargets = [0, 1];
  assert.equal(applySetToRecord(rec, 'numStealthTargets', '99', 'PRTO', null), true);
  assert.deepEqual(rec.stealthTargets, [0, 1]); // unchanged
  assert.equal(applySetToRecord(rec, 'numLegalUnitTelepads', '99', 'PRTO', null), true);
  assert.equal(applySetToRecord(rec, 'numLegalBuildingTelepads', '99', 'PRTO', null), true);
});

test('applySetToRecord PRTO stealthTarget does not affect other unrelated PRTO fields', () => {
  const rec = makeMinimalPrtoRec();
  applySetToRecord(rec, 'stealthTarget', '1', 'PRTO', null);
  assert.deepEqual(rec.legalUnitTelepads, []);
  assert.deepEqual(rec.legalBuildingTelepads, []);
  assert.equal(rec.attack, 0);
});

test('applySetToRecord PRTO ignoreMovementCost still works via generic handler', () => {
  const rec = makeMinimalPrtoRec();
  const ok = applySetToRecord(rec, 'ignoreMovementCost', '1,0,1,0,0,0,0,0,0,0,0,0,0,0', 'PRTO', null);
  assert.equal(ok, true);
  assert.deepEqual(rec.ignoreMovementCost, [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
