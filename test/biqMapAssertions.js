'use strict';

const assert = require('node:assert/strict');

const {
  serializeSection,
  collectMapReferenceIntegrityIssues,
  collectColonyOverlayCoherenceIssues
} = require('../src/biq/biqSections');

const DEFAULT_MAP_SECTION_CODES = ['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY'];

function getRawSectionBytesByCode(parsed, codes = DEFAULT_MAP_SECTION_CODES) {
  const out = new Map();
  codes.forEach((code) => {
    const section = (parsed.sections || []).find((entry) => entry.code === code);
    assert.ok(section, `expected ${code} section`);
    out.set(code, serializeSection(section, parsed.io));
  });
  return out;
}

function getChangedSectionCodes(before, after, codes = DEFAULT_MAP_SECTION_CODES) {
  const beforeBytes = getRawSectionBytesByCode(before, codes);
  const afterBytes = getRawSectionBytesByCode(after, codes);
  return codes.filter((code) => !beforeBytes.get(code).equals(afterBytes.get(code)));
}

function assertRawSectionsEqual(before, after, codes = DEFAULT_MAP_SECTION_CODES, messagePrefix = 'expected unchanged save to preserve raw') {
  codes.forEach((code) => {
    const beforeSection = (before.sections || []).find((section) => section.code === code);
    const afterSection = (after.sections || []).find((section) => section.code === code);
    assert.ok(beforeSection, `expected original ${code} section`);
    assert.ok(afterSection, `expected saved ${code} section`);
    assert.deepEqual(
      serializeSection(beforeSection, before.io),
      serializeSection(afterSection, after.io),
      `${messagePrefix} ${code} section bytes`
    );
  });
}

function assertNoMapReferenceIssues(parsed, message = '') {
  const issues = collectMapReferenceIntegrityIssues(parsed);
  assert.deepEqual(issues, [], message || `expected valid map references, got ${JSON.stringify(issues)}`);
}

function assertNoColonyOverlayIssues(parsed, message = '') {
  const issues = collectColonyOverlayCoherenceIssues(parsed);
  assert.deepEqual(issues, [], message || `expected coherent colony overlays, got ${JSON.stringify(issues)}`);
}

module.exports = {
  DEFAULT_MAP_SECTION_CODES,
  getRawSectionBytesByCode,
  getChangedSectionCodes,
  assertRawSectionsEqual,
  assertNoMapReferenceIssues,
  assertNoColonyOverlayIssues
};
