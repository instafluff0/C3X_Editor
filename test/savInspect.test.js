'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { inspectSavFile, formatSavDebugReport } = require('../src/biq/savInspect');
const { parseAllSections } = require('../src/biq/biqSections');

function sampleSavPath() {
  return path.resolve(__dirname, '..', '..', 'Saves', 'Conquests Autosave 120 BC.SAV');
}

test('local Conquests save sample produces live-map debug summary', (t) => {
  const savPath = sampleSavPath();
  if (!fs.existsSync(savPath)) {
    t.skip('Local Conquests save sample is not available.');
    return;
  }

  const report = inspectSavFile(savPath);
  assert.equal(report.ok, true, report.error);
  assert.equal(report.metadata.biqVersionTag, 'BICQ');
  assert.equal(report.world.width, 130);
  assert.equal(report.world.height, 130);
  assert.equal(report.tiles.count, 8450);
  assert.equal(report.game.numberOfUnits, 589);
  assert.equal(report.units.count, 589);
  assert.equal(report.game.numberOfCities, 45);
  assert.equal(report.cities.count, 45);
  assert.equal(report.game.numberOfColonies, 17);
  assert.equal(report.colonies.count, 17);
  assert.ok(report.tiles.overlays.road > 0, 'expected road overlays');
  assert.ok(report.tiles.resourceTileCount > 0, 'expected resource-bearing tiles');
  assert.ok(report.cities.records.some((city) => city.name === 'Kyoto'), 'expected Kyoto in parsed city list');
  assert.ok(report.units.byType.some((entry) => /Spearman/.test(entry.key)), 'expected unit type summary');

  const text = formatSavDebugReport(report, { limit: 5 });
  assert.match(text, /World: 130x130/);
  assert.match(text, /Tile overlays: road=/);
  assert.match(text, /Cities:/);
});

test('inspect-sav CLI prints report for local Conquests save sample', (t) => {
  const savPath = sampleSavPath();
  if (!fs.existsSync(savPath)) {
    t.skip('Local Conquests save sample is not available.');
    return;
  }

  const script = path.resolve(__dirname, '..', 'scripts', 'inspect-sav.js');
  const run = spawnSync(process.execPath, [script, savPath, '--limit', '3'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Version: 24\.10/);
  assert.match(run.stdout, /Resource tiles:/);
  assert.match(run.stdout, /Units by type:/);
});

test('inspect-sav CLI can write a parseable debug BIQ with live map sections', (t) => {
  const savPath = sampleSavPath();
  if (!fs.existsSync(savPath)) {
    t.skip('Local Conquests save sample is not available.');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'c3x-sav-debug-biq-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const outPath = path.join(tmp, 'save-debug.biq');
  const script = path.resolve(__dirname, '..', 'scripts', 'inspect-sav.js');
  const run = spawnSync(process.execPath, [script, savPath, '--biq-out', outPath, '--limit', '3'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Wrote debug BIQ:/);
  assert.ok(fs.existsSync(outPath), 'expected debug BIQ output file');

  const parsed = parseAllSections(fs.readFileSync(outPath));
  assert.equal(parsed.ok, true, parsed.error);
  const byCode = new Map(parsed.sections.map((section) => [section.code, section]));
  assert.equal(byCode.get('WMAP').records[0].width, 130);
  assert.equal(byCode.get('TILE').records.length, 8450);
  assert.equal(byCode.get('CITY').records.length, 45);
  assert.equal(byCode.get('UNIT').records.length, 589);
  assert.equal(byCode.get('CLNY').records.length, 17);
});
