const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listDistrictArtFiles } = require('../src/artPreview');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-district-art-list-'));
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

test('listDistrictArtFiles groups scenario and base PCX files and marks filename overrides', () => {
  const c3xRoot = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  touch(path.join(scenarioRoot, 'Art', 'Districts', 'Summer', '1200', 'Market.pcx'));
  touch(path.join(scenarioRoot, 'Art', 'Districts', '1200', 'LegacyScenario.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', 'Summer', '1200', 'Market.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', 'Summer', '1200', 'Campus.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Terrain', 'TerrainOnly.pcx'));

  const result = listDistrictArtFiles({
    c3xPath: c3xRoot,
    scenarioPath: path.join(scenarioRoot, 'Scenario.biq')
  });

  assert.equal(result.ok, true);
  assert.equal(result.total, 4);
  assert.deepEqual(result.groups.map((group) => group.label), ['Scenario Art', 'Base C3X Art']);
  const scenarioFiles = result.groups[0].files.map((entry) => entry.fileName).sort();
  assert.deepEqual(scenarioFiles, ['LegacyScenario.pcx', 'Market.pcx']);
  const baseMarket = result.groups[1].files.find((entry) => entry.fileName === 'Market.pcx');
  assert.equal(baseMarket.effective, false);
  assert.equal(baseMarket.overriddenBy.source, 'scenario');
  const baseCampus = result.groups[1].files.find((entry) => entry.fileName === 'Campus.pcx');
  assert.equal(baseCampus.effective, true);
  assert.equal(result.groups[1].files.some((entry) => entry.fileName === 'TerrainOnly.pcx'), false);
});
