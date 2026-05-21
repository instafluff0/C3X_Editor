'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadBundle } = require('../src/configCore');

const CIV3_ROOT = path.resolve(__dirname, '..', '..');
const SCENARIOS_DIR = path.join(CIV3_ROOT, 'Scenarios');
const LARGE_MAP_FIXTURES = [
  {
    label: 'Quint 100x100 desert blank map',
    fileName: '100x100_desert.biq'
  },
  {
    label: 'Firaxis 100x100 world blank map',
    fileName: '100x100_world_firaxis.biq'
  }
];

function getSection(tab, code) {
  const target = String(code || '').trim().toUpperCase();
  return (tab && Array.isArray(tab.sections) ? tab.sections : []).find((section) => (
    String(section && section.code || '').trim().toUpperCase() === target
  )) || null;
}

function getRecordField(record, key) {
  const target = String(key || '').trim().toLowerCase();
  return (Array.isArray(record && record.fields) ? record.fields : []).find((field) => (
    String(field && (field.baseKey || field.key) || '').trim().toLowerCase() === target
  )) || null;
}

function getIntField(record, key, fallback = 0) {
  const field = getRecordField(record, key);
  const match = String(field && field.value != null ? field.value : '').match(/-?\d+/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

LARGE_MAP_FIXTURES.forEach(({ label, fileName }) => {
  test(`fixture-backed BIQ load parity: ${label}`, (t) => {
    const scenarioPath = path.join(SCENARIOS_DIR, fileName);
    if (!fs.existsSync(scenarioPath)) {
      t.skip(`Missing BIQ fixture: ${scenarioPath}`);
      return;
    }
    const bundle = loadBundle({
      mode: 'scenario',
      civ3Path: CIV3_ROOT,
      scenarioPath
    });
    assert.ok(bundle && bundle.tabs && bundle.tabs.map, 'expected bundle to include a map tab');
    const wmap = getSection(bundle.tabs.map, 'WMAP');
    const tile = getSection(bundle.tabs.map, 'TILE');
    assert.ok(wmap, 'expected WMAP section');
    assert.ok(tile, 'expected TILE section');
    assert.equal(getIntField((wmap.records || [])[0], 'width', -1), 100, 'expected 100-tile map width');
    assert.equal(getIntField((wmap.records || [])[0], 'height', -1), 100, 'expected 100-tile map height');
    assert.equal((tile.records || []).length, 5000, 'expected Quint/Firaxis 100x100 BIQs to contain 5000 TILE records');
  });
});
