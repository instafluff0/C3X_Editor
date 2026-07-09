'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyEdits,
  parseAllSections,
  serializeSection
} = require('../src/biq/biqSections');
const { decompress } = require('../src/biq/decompress');

function getStableMapUnitsFixturePath() {
  return path.resolve(__dirname, 'fixtures', 'biq_map_units_fixture.biq');
}

function parseFixture() {
  const raw = fs.readFileSync(getStableMapUnitsFixturePath());
  const inflated = decompress(raw);
  const parsed = parseAllSections(inflated.ok ? inflated.data : raw);
  assert.equal(parsed.ok, true, 'expected stable fixture BIQ parse');
  return parsed;
}

function buildBuffer(parsed) {
  return Buffer.concat([
    parsed._headerBuf,
    ...parsed.sections.map((section) => serializeSection(section, parsed.io))
  ]);
}

function getGovtSection(parsed) {
  const section = (parsed.sections || []).find((entry) => entry.code === 'GOVT');
  assert.ok(section && Array.isArray(section.records), 'expected GOVT section');
  return section;
}

test('BIQ government add expands every GOVT relation matrix row', () => {
  const fixturePath = getStableMapUnitsFixturePath();
  if (!fs.existsSync(fixturePath)) return;

  const parsed = parseFixture();
  const beforeCount = getGovtSection(parsed).records.length;
  const newRef = 'GOVT_C3X_MATRIX_ADD';

  const result = applyEdits(buildBuffer(parsed), [{
    op: 'add',
    sectionCode: 'GOVT',
    newRecordRef: newRef
  }]);
  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const reParsed = parseAllSections(result.buffer);
  assert.equal(reParsed.ok, true, 'expected edited BIQ buffer to parse');
  const records = getGovtSection(reParsed).records;
  assert.equal(records.length, beforeCount + 1);
  records.forEach((record, index) => {
    assert.equal(record.numGovts, records.length, `GOVT ${index} should store final government count`);
    assert.equal(record.relations.length, records.length, `GOVT ${index} should have a square relation matrix row`);
  });
  records.slice(0, beforeCount).forEach((record) => {
    const addedRelation = record.relations[records.length - 1];
    assert.deepEqual(addedRelation, { canBribe: 0, briberyMod: 0, resistanceMod: 0 });
  });
  assert.ok(records.some((record) => String(record.civilopediaEntry).toUpperCase() === newRef));
});

test('BIQ government copy deep-clones relation rows before same-save edits', () => {
  const fixturePath = getStableMapUnitsFixturePath();
  if (!fs.existsSync(fixturePath)) return;

  const parsed = parseFixture();
  const source = getGovtSection(parsed).records[0];
  assert.ok(source && source.civilopediaEntry, 'expected source government');
  const sourceRef = String(source.civilopediaEntry).toUpperCase();
  const originalSourceCanBribe = source.relations[0] && source.relations[0].canBribe;
  const newRef = 'GOVT_C3X_MATRIX_COPY';

  const result = applyEdits(buildBuffer(parsed), [
    {
      op: 'copy',
      sectionCode: 'GOVT',
      sourceRef,
      newRecordRef: newRef
    },
    {
      op: 'set',
      sectionCode: 'GOVT',
      recordRef: newRef,
      fieldKey: 'govtRelation0canBribe',
      value: '77'
    }
  ]);
  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const reParsed = parseAllSections(result.buffer);
  assert.equal(reParsed.ok, true, 'expected edited BIQ buffer to parse');
  const records = getGovtSection(reParsed).records;
  const reSource = records.find((record) => String(record.civilopediaEntry).toUpperCase() === sourceRef);
  const copied = records.find((record) => String(record.civilopediaEntry).toUpperCase() === newRef);
  assert.ok(reSource, 'expected original government after copy');
  assert.ok(copied, 'expected copied government after copy');
  assert.equal(reSource.relations[0].canBribe, originalSourceCanBribe);
  assert.equal(copied.relations[0].canBribe, 77);
  records.forEach((record, index) => {
    assert.equal(record.numGovts, records.length, `GOVT ${index} should store final government count`);
    assert.equal(record.relations.length, records.length, `GOVT ${index} should have a square relation matrix row`);
  });
});

test('BIQ save repairs pre-existing GOVT relation matrix mismatches', () => {
  const fixturePath = getStableMapUnitsFixturePath();
  if (!fs.existsSync(fixturePath)) return;

  const parsed = parseFixture();
  const govtRecords = getGovtSection(parsed).records;
  assert.ok(govtRecords.length >= 2, 'expected multiple governments');
  govtRecords[0].relations = govtRecords[0].relations.slice(0, Math.max(0, govtRecords.length - 1));
  govtRecords[0].numGovts = govtRecords[0].relations.length;
  const malformedBuffer = buildBuffer(parsed);

  const result = applyEdits(malformedBuffer, [{
    op: 'set',
    sectionCode: 'GOVT',
    recordRef: '@INDEX:0',
    fieldKey: 'hurrying',
    value: String((Number(govtRecords[0].hurrying) || 0) + 1)
  }]);
  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const reParsed = parseAllSections(result.buffer);
  assert.equal(reParsed.ok, true, 'expected repaired BIQ buffer to parse');
  const records = getGovtSection(reParsed).records;
  records.forEach((record, index) => {
    assert.equal(record.numGovts, records.length, `GOVT ${index} should store final government count`);
    assert.equal(record.relations.length, records.length, `GOVT ${index} should have a square relation matrix row`);
  });
});
