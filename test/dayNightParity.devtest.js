const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { decodePcx, encodeRgbaToPcx } = require('../src/artPreview');
const {
  SCRIPT_DEFAULTS,
  generatedHourFolders,
  runDayNightGeneration
} = require('../src/dayNightGenerator');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'day-night');
const UPSTREAM_TOOL_DIR = path.resolve(__dirname, '..', '..', 'C3X_Districts', 'DayNight');
const UPSTREAM_VENV_BIN = path.join(UPSTREAM_TOOL_DIR, 'venv', 'bin');
const EXPECTED_SEASONS = ['Fall', 'Spring', 'Summer', 'Winter'];
const LIGHT_KEY_RGB = Object.freeze([
  [0xF6, 0x91, 0x5E],
  [0xFE, 0xF5, 0x00],
  [0x00, 0xFE, 0xFF],
  [0xE4, 0x08, 0x0A],
  [0xBD, 0x15, 0xD0],
  [0x2D, 0x9C, 0x01],
  [0xFF, 0x25, 0xC8],
  [0x0A, 0x02, 0xEB],
  [0x82, 0x62, 0xED]
]);
const COMPARED_FAMILIES = Object.freeze([
  {
    family: 'terrain',
    root: 'DayNight',
    sourceFiles: ['goodyhuts.pcx', 'xdgc.pcx']
  },
  {
    family: 'districts',
    root: 'Districts',
    sourceFiles: ['Campus.PCX', 'DataCenter.PCX', 'Wonders.PCX']
  }
]);

function dirExists(dirPath) {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch (_err) {
    return false;
  }
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_err) {
    return false;
  }
}

function makeFixtureRoot(parent, name) {
  const root = path.join(parent, name);
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(FIXTURE_ROOT, 'Art'), path.join(root, 'Art'), { recursive: true });
  return root;
}

function expectedGeneratedRelPaths() {
  const out = [];
  COMPARED_FAMILIES.forEach((familySpec) => {
    EXPECTED_SEASONS.forEach((season) => {
      generatedHourFolders().forEach((hour) => {
        familySpec.sourceFiles.forEach((fileName) => {
          out.push({
            family: familySpec.family,
            root: familySpec.root,
            rel: `${season}/${hour}/${fileName}`,
            label: `${familySpec.family}/${season}/${hour}/${fileName}`
          });
        });
      });
    });
  });
  return out.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

function expectedComparisonCount() {
  return COMPARED_FAMILIES.reduce((sum, familySpec) => {
    return sum + (EXPECTED_SEASONS.length * generatedHourFolders().length * familySpec.sourceFiles.length);
  }, 0);
}

function runUpstreamGenerate(root) {
  fs.cpSync(UPSTREAM_TOOL_DIR, path.join(root, 'DayNight'), {
    recursive: true,
    filter(src) {
      return !src.includes(`${path.sep}__pycache__${path.sep}`);
    }
  });
  const copiedGenerate = path.join(root, 'DayNight', 'generate.sh');
  const generateText = fs.readFileSync(copiedGenerate, 'utf8')
    .replace(/\$\{src,,\}/g, '$(printf "%s" "$src" | tr "[:upper:]" "[:lower:]")');
  fs.writeFileSync(copiedGenerate, generateText, 'utf8');
  const res = spawnSync('/bin/zsh', ['-lc', `PATH="${UPSTREAM_VENV_BIN}:$PATH" bash ./generate.sh`], {
    cwd: path.join(root, 'DayNight'),
    encoding: 'utf8'
  });
  assert.equal(res.error || null, null, res.error && res.error.message);
  assert.equal(res.status, 0, `${res.stdout || ''}${res.stderr || ''}`);
}

function compareDecodedPcx(actualPath, expectedPath) {
  const actual = decodePcx(actualPath, { transparentIndexes: [] });
  const expected = decodePcx(expectedPath, { transparentIndexes: [] });
  assert.equal(actual.width, expected.width, actualPath);
  assert.equal(actual.height, expected.height, actualPath);
  return compareDecodedRgba(actual, expected);
}

function compareDecodedRgba(actual, expected, mask = null) {
  let sum = 0;
  let max = 0;
  let over64 = 0;
  let over100 = 0;
  const samples = [];
  let pixelCount = 0;
  for (let i = 0; i < actual.width * actual.height; i += 1) {
    if (mask && !mask[i]) continue;
    const off = i * 4;
    let px = 0;
    let pxMax = 0;
    for (let c = 0; c < 3; c += 1) {
      const delta = Math.abs(actual.rgba[off + c] - expected.rgba[off + c]);
      px += delta;
      sum += delta;
      if (delta > pxMax) pxMax = delta;
      if (delta > max) max = delta;
    }
    if (pxMax > 64) over64 += 1;
    if (pxMax > 100) over100 += 1;
    samples.push(px / 3);
    pixelCount += 1;
  }
  samples.sort((a, b) => a - b);
  if (pixelCount <= 0) {
    return {
      meanAbs: 0,
      maxChannelDelta: 0,
      over64,
      over64Ratio: 0,
      over100,
      over100Ratio: 0,
      p95: 0,
      pixelCount
    };
  }
  const meanAbs = sum / (pixelCount * 3);
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] || 0;
  return {
    meanAbs,
    maxChannelDelta: max,
    over64,
    over64Ratio: over64 / pixelCount,
    over100,
    over100Ratio: over100 / pixelCount,
    p95,
    pixelCount
  };
}

function makeDilatedLightMask(annotationPath, radius = 3) {
  if (!fileExists(annotationPath)) return null;
  const annotation = decodePcx(annotationPath, { transparentIndexes: [] });
  const exact = new Uint8Array(annotation.width * annotation.height);
  for (let i = 0; i < exact.length; i += 1) {
    const off = i * 4;
    if (LIGHT_KEY_RGB.some((rgb) => annotation.rgba[off] === rgb[0] && annotation.rgba[off + 1] === rgb[1] && annotation.rgba[off + 2] === rgb[2])) {
      exact[i] = 1;
    }
  }
  if (radius <= 0) return exact;
  const out = new Uint8Array(exact.length);
  for (let y = 0; y < annotation.height; y += 1) {
    for (let x = 0; x < annotation.width; x += 1) {
      if (!exact[y * annotation.width + x]) continue;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(annotation.height - 1, y + radius); yy += 1) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(annotation.width - 1, x + radius); xx += 1) {
          out[yy * annotation.width + xx] = 1;
        }
      }
    }
  }
  return out;
}

function annotationPathFor(root, entry) {
  const [season, _hour, fileName] = entry.rel.split('/');
  const annotationName = fileName.replace(/\.pcx$/i, '_lights.pcx');
  const seasonPath = path.join(root, 'Art', entry.root, season, 'Annotations', annotationName);
  if (fileExists(seasonPath)) return seasonPath;
  const summerPath = path.join(root, 'Art', entry.root, 'Summer', 'Annotations', annotationName);
  return fileExists(summerPath) ? summerPath : '';
}

function writeDiffArtifact(actualPath, expectedPath, diffPath) {
  const actual = decodePcx(actualPath, { transparentIndexes: [] });
  const expected = decodePcx(expectedPath, { transparentIndexes: [] });
  const rgba = new Uint8Array(actual.width * actual.height * 4);
  for (let i = 0; i < actual.width * actual.height; i += 1) {
    const off = i * 4;
    rgba[off] = Math.min(255, Math.abs(actual.rgba[off] - expected.rgba[off]) * 4);
    rgba[off + 1] = Math.min(255, Math.abs(actual.rgba[off + 1] - expected.rgba[off + 1]) * 4);
    rgba[off + 2] = Math.min(255, Math.abs(actual.rgba[off + 2] - expected.rgba[off + 2]) * 4);
    rgba[off + 3] = 255;
  }
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, encodeRgbaToPcx(rgba, actual.width, actual.height));
}

test('day-night JavaScript output visually tracks upstream generate.sh defaults', async (t) => {
  if (!dirExists(FIXTURE_ROOT)) return t.skip('Day-night fixture is missing.');
  if (!fileExists(path.join(UPSTREAM_TOOL_DIR, 'generate.sh'))) return t.skip('Upstream generate.sh is not available.');
  if (!fileExists(path.join(UPSTREAM_TOOL_DIR, 'civ3_day_night.py'))) return t.skip('Upstream day-night Python scripts are not available.');
  if (!fileExists(path.join(UPSTREAM_VENV_BIN, 'python'))) return t.skip('Upstream Python/Pillow venv is not available.');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-day-night-parity-'));
  let keepTemp = false;
  try {
    const oracleRoot = makeFixtureRoot(temp, 'oracle');
    const appRoot = makeFixtureRoot(temp, 'app');
    runUpstreamGenerate(oracleRoot);
    const appResult = await runDayNightGeneration({
      mode: 'global',
      c3xPath: appRoot,
      families: COMPARED_FAMILIES.map((entry) => entry.family),
      options: SCRIPT_DEFAULTS
    });
    assert.equal(appResult.ok, true, appResult.error || '');

    const failures = [];
    const summary = {
      compared: 0,
      exactMatches: 0,
      visualMatches: 0,
      worstMeanAbs: 0,
      worstP95: 0,
      worstMaxChannelDelta: 0,
      worstOver64Ratio: 0,
      worstOver100Ratio: 0,
      lightCompared: 0,
      worstLightMeanAbs: 0,
      worstLightP95: 0,
      worstLightMaxChannelDelta: 0
    };
    expectedGeneratedRelPaths().forEach((entry) => {
      const appPath = path.join(appRoot, 'Art', entry.root, entry.rel);
      const oraclePath = path.join(oracleRoot, 'Art', entry.root, entry.rel);
      assert.equal(fileExists(appPath), true, `JS output missing ${entry.label}`);
      assert.equal(fileExists(oraclePath), true, `generate.sh output missing ${entry.label}`);
      summary.compared += 1;
      if (fs.readFileSync(appPath).equals(fs.readFileSync(oraclePath))) {
        summary.exactMatches += 1;
        return;
      }
      const metrics = compareDecodedPcx(appPath, oraclePath);
      summary.visualMatches += 1;
      summary.worstMeanAbs = Math.max(summary.worstMeanAbs, metrics.meanAbs);
      summary.worstP95 = Math.max(summary.worstP95, metrics.p95);
      summary.worstMaxChannelDelta = Math.max(summary.worstMaxChannelDelta, metrics.maxChannelDelta);
      summary.worstOver64Ratio = Math.max(summary.worstOver64Ratio, metrics.over64Ratio);
      summary.worstOver100Ratio = Math.max(summary.worstOver100Ratio, metrics.over100Ratio);
      if (
        metrics.meanAbs > 10 ||
        metrics.p95 > 26 ||
        metrics.maxChannelDelta > 113 ||
        metrics.over64Ratio > 0.004 ||
        metrics.over100Ratio > 0.001
      ) {
        const diffPath = path.join(temp, 'diffs', entry.family, entry.rel);
        writeDiffArtifact(appPath, oraclePath, diffPath);
        failures.push({ rel: entry.label, diffPath, ...metrics });
      }
      const annotationPath = annotationPathFor(appRoot, entry);
      const lightMask = makeDilatedLightMask(annotationPath);
      if (lightMask) {
        const appDecoded = decodePcx(appPath, { transparentIndexes: [] });
        const oracleDecoded = decodePcx(oraclePath, { transparentIndexes: [] });
        const lightMetrics = compareDecodedRgba(appDecoded, oracleDecoded, lightMask);
        if (lightMetrics.pixelCount > 0) {
          summary.lightCompared += 1;
          summary.worstLightMeanAbs = Math.max(summary.worstLightMeanAbs, lightMetrics.meanAbs);
          summary.worstLightP95 = Math.max(summary.worstLightP95, lightMetrics.p95);
          summary.worstLightMaxChannelDelta = Math.max(summary.worstLightMaxChannelDelta, lightMetrics.maxChannelDelta);
          if (
            lightMetrics.meanAbs > 20 ||
            lightMetrics.p95 > 70 ||
            lightMetrics.maxChannelDelta > 160
          ) {
            const diffPath = path.join(temp, 'diffs', 'light-region', entry.family, entry.rel);
            writeDiffArtifact(appPath, oraclePath, diffPath);
            failures.push({ rel: `${entry.label} light-region`, diffPath, ...lightMetrics });
          }
        }
      }
    });
    assert.equal(summary.compared, expectedComparisonCount());
    t.diagnostic(`Compared ${summary.compared} outputs: ${summary.exactMatches} byte-identical, ${summary.visualMatches} visually compared; worst mean=${summary.worstMeanAbs.toFixed(4)}, p95=${summary.worstP95.toFixed(4)}, max=${summary.worstMaxChannelDelta}, over64=${summary.worstOver64Ratio.toFixed(4)}, over100=${summary.worstOver100Ratio.toFixed(4)}; light regions=${summary.lightCompared}, worst light mean=${summary.worstLightMeanAbs.toFixed(4)}, light p95=${summary.worstLightP95.toFixed(4)}, light max=${summary.worstLightMaxChannelDelta}`);
    keepTemp = failures.length > 0;
    assert.deepEqual(failures, []);
  } finally {
    if (!keepTemp) fs.rmSync(temp, { recursive: true, force: true });
  }
});
