const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.resolve(__dirname, '..', 'test');

const BIQ_TESTS = new Set([
  'biqRoundtrip.test.js',
  'catalogParity.test.js',
  'civilizationsParity.test.js',
  'crudOperations.test.js',
  'governmentsParity.test.js',
  'improvementsParity.test.js',
  'resourcesParity.test.js',
  'ruleParity.test.js',
  'stealthTargetResolution.test.js',
  'technologiesParity.test.js',
  'terrainParity.test.js',
  'unitsParity.test.js'
]);

const TIERS = new Set(['fast', 'biq', 'full']);

function listTestFiles() {
  return fs.readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => ({
      name,
      filePath: path.join(TEST_DIR, name)
    }));
}

function getTierFiles(tier) {
  const files = listTestFiles();
  if (tier === 'full') return files;
  if (tier === 'biq') return files.filter((file) => BIQ_TESTS.has(file.name));
  return files.filter((file) => !BIQ_TESTS.has(file.name));
}

function printUsage() {
  console.error('Usage: node scripts/run-tests.js [fast|biq|full] [-- node --test args]');
}

const separatorIndex = process.argv.indexOf('--');
const rawArgs = separatorIndex >= 0 ? process.argv.slice(2, separatorIndex) : process.argv.slice(2);
const passThroughArgs = separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : [];
const tier = rawArgs[0] || 'fast';

if (!TIERS.has(tier) || rawArgs.length > 1) {
  printUsage();
  process.exit(2);
}

const files = getTierFiles(tier);
if (files.length === 0) {
  console.error(`No test files selected for tier "${tier}".`);
  process.exit(2);
}

console.log(`Running ${tier} test tier (${files.length} file${files.length === 1 ? '' : 's'}).`);
if (tier !== 'full') {
  console.log(files.map((file) => `- ${path.relative(process.cwd(), file.filePath)}`).join('\n'));
}

const result = spawnSync(process.execPath, ['--test', ...passThroughArgs, ...files.map((file) => file.filePath)], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
