const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { decodePcx, encodePcx } = require('../src/artPreview');
const {
  DEFAULT_LIGHT_KEYS,
  draftLightAnnotation,
  makeReservedLightSlots,
  writeDraftLightAnnotation
} = require('../src/dayNightAnnotationDraft');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'day-night', 'Art', 'Districts', 'Summer');
const WARM_KEY_RGB = DEFAULT_LIGHT_KEYS.slice(0, 2).map((rgb) => rgb.join(','));

function rgbAt(decoded, index) {
  const off = index * 4;
  return [decoded.rgba[off], decoded.rgba[off + 1], decoded.rgba[off + 2]];
}

function isMagicRgb(rgb) {
  return (rgb[0] === 0 && rgb[1] === 255 && rgb[2] === 0) || (rgb[0] === 255 && rgb[1] === 0 && rgb[2] === 255);
}

function makeWarmAnnotationMask(annotationPath, radius = 3) {
  const annotation = decodePcx(annotationPath, { transparentIndexes: [] });
  const exact = new Uint8Array(annotation.width * annotation.height);
  const dilated = new Uint8Array(annotation.width * annotation.height);
  let count = 0;
  for (let i = 0; i < exact.length; i += 1) {
    if (!WARM_KEY_RGB.includes(rgbAt(annotation, i).join(','))) continue;
    exact[i] = 1;
    count += 1;
  }
  for (let y = 0; y < annotation.height; y += 1) {
    for (let x = 0; x < annotation.width; x += 1) {
      if (!exact[y * annotation.width + x]) continue;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(annotation.height - 1, y + radius); yy += 1) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(annotation.width - 1, x + radius); xx += 1) {
          dilated[yy * annotation.width + xx] = 1;
        }
      }
    }
  }
  return { exact, dilated, count };
}

test('day-night annotation draft reserves all light keys before Civ3 transparent slots', () => {
  const sourcePath = path.join(FIXTURE_ROOT, '1200', 'Wonders.PCX');
  const result = draftLightAnnotation(sourcePath, { maxLights: 50 });
  const expectedSlots = makeReservedLightSlots(DEFAULT_LIGHT_KEYS);
  assert.deepEqual(result.lightSlots, expectedSlots);
  assert.deepEqual(result.lightSlots, [245, 246, 247, 248, 249, 250, 251, 252, 253]);
  result.lightKeys.forEach((rgb, index) => {
    const slot = result.lightSlots[index];
    assert.deepEqual(Array.from(result.palette.slice(slot * 3, slot * 3 + 3)), rgb);
  });
  assert.deepEqual(Array.from(result.palette.slice(254 * 3, 254 * 3 + 3)), [0, 255, 0]);
  assert.deepEqual(Array.from(result.palette.slice(255 * 3, 255 * 3 + 3)), [255, 0, 255]);
});

test('day-night annotation draft only auto-places orange and yellow light keys', () => {
  const sourcePath = path.join(FIXTURE_ROOT, '1200', 'Wonders.PCX');
  const result = draftLightAnnotation(sourcePath);
  const warmSlots = new Set(result.lightSlots.slice(0, 2));
  const otherSlots = new Set(result.lightSlots.slice(2));
  let warm = 0;
  let other = 0;
  for (const index of result.indices) {
    if (warmSlots.has(index)) warm += 1;
    if (otherSlots.has(index)) other += 1;
  }
  assert.equal(warm, result.selectedCount);
  assert.equal(other, 0);
  assert.ok(warm > 100, `expected a useful draft, got ${warm} warm pixels`);
  assert.ok(warm < 1600, `expected a sparse draft, got ${warm} warm pixels`);
});

test('day-night annotation draft is byte deterministic', () => {
  const sourcePath = path.join(FIXTURE_ROOT, '1200', 'Campus.PCX');
  const first = draftLightAnnotation(sourcePath);
  const second = draftLightAnnotation(sourcePath);
  assert.deepEqual(first.buffer, second.buffer);
});

test('day-night annotation draft preserves magic background and avoids placing lights there', () => {
  const sourcePath = path.join(FIXTURE_ROOT, '1200', 'Wonders.PCX');
  const source = decodePcx(sourcePath, { returnIndexed: true, transparentIndexes: [] });
  const result = draftLightAnnotation(sourcePath);
  const warmSlots = new Set(result.lightSlots.slice(0, 2));
  let magicLightPixels = 0;
  let sourceMagicPixels = 0;
  let outputMagicPixels = 0;
  for (let i = 0; i < result.indices.length; i += 1) {
    const sourceRgb = [
      source.palette[source.indices[i] * 3],
      source.palette[source.indices[i] * 3 + 1],
      source.palette[source.indices[i] * 3 + 2]
    ];
    const outputRgb = [
      result.palette[result.indices[i] * 3],
      result.palette[result.indices[i] * 3 + 1],
      result.palette[result.indices[i] * 3 + 2]
    ];
    if (isMagicRgb(sourceRgb)) {
      sourceMagicPixels += 1;
      if (warmSlots.has(result.indices[i])) magicLightPixels += 1;
    }
    if (isMagicRgb(outputRgb)) outputMagicPixels += 1;
  }
  assert.equal(magicLightPixels, 0);
  assert.equal(outputMagicPixels, sourceMagicPixels);
});

test('day-night annotation draft displaces source colors that collide with reserved light slots', () => {
  const width = 8;
  const height = 4;
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i += 1) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = i;
    palette[i * 3 + 2] = i;
  }
  palette[2 * 3] = 90;
  palette[2 * 3 + 1] = 80;
  palette[2 * 3 + 2] = 70;
  palette[245 * 3] = 35;
  palette[245 * 3 + 1] = 30;
  palette[245 * 3 + 2] = 25;
  palette[10 * 3] = DEFAULT_LIGHT_KEYS[0][0];
  palette[10 * 3 + 1] = DEFAULT_LIGHT_KEYS[0][1];
  palette[10 * 3 + 2] = DEFAULT_LIGHT_KEYS[0][2];
  palette[254 * 3] = 0;
  palette[254 * 3 + 1] = 255;
  palette[254 * 3 + 2] = 0;
  palette[255 * 3] = 255;
  palette[255 * 3 + 1] = 0;
  palette[255 * 3 + 2] = 255;
  const indices = new Uint8Array(width * height).fill(2);
  indices[9] = 245;
  indices[10] = 10;
  indices[0] = 254;
  indices[31] = 255;
  const buffer = encodePcx(indices, palette, width, height);
  const result = draftLightAnnotation(buffer, { maxLights: 0 });
  const lightSlots = new Set(result.lightSlots);
  for (let i = 0; i < result.indices.length; i += 1) {
    assert.equal(lightSlots.has(result.indices[i]), false, `unexpected light slot at ${i}`);
  }
  assert.deepEqual(Array.from(result.palette.slice(254 * 3, 254 * 3 + 3)), [0, 255, 0]);
  assert.deepEqual(Array.from(result.palette.slice(255 * 3, 255 * 3 + 3)), [255, 0, 255]);
});

test('day-night annotation draft lands a meaningful sparse subset near known warm annotations', () => {
  const cases = ['Wonders.PCX', 'Campus.PCX'];
  for (const fileName of cases) {
    const sourcePath = path.join(FIXTURE_ROOT, '1200', fileName);
    const annotationPath = path.join(FIXTURE_ROOT, 'Annotations', fileName.replace(/\.pcx$/i, '_lights.PCX'));
    const result = draftLightAnnotation(sourcePath);
    const reference = makeWarmAnnotationMask(annotationPath);
    const warmSlots = new Set(result.lightSlots.slice(0, 2));
    let predicted = 0;
    let nearReference = 0;
    for (let i = 0; i < result.indices.length; i += 1) {
      if (!warmSlots.has(result.indices[i])) continue;
      predicted += 1;
      if (reference.dilated[i]) nearReference += 1;
    }
    assert.ok(reference.count > 250, `${fileName} should have warm reference annotations`);
    assert.ok(predicted > 100 && predicted < 1600, `${fileName} predicted ${predicted} pixels`);
    assert.ok(nearReference / predicted >= 0.18, `${fileName} only placed ${nearReference}/${predicted} near known annotations`);
  }
});

test('day-night annotation draft writes a valid indexed PCX file', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-light-draft-'));
  const outputPath = path.join(temp, 'Wonders_lights.pcx');
  const sourcePath = path.join(FIXTURE_ROOT, '1200', 'Wonders.PCX');
  const result = writeDraftLightAnnotation(sourcePath, outputPath, { maxLights: 25 });
  const decoded = decodePcx(outputPath, { returnIndexed: true, transparentIndexes: [] });
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(result.selectedCount, 25);
  assert.equal(decoded.width, result.width);
  assert.equal(decoded.height, result.height);
});
