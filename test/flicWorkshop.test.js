const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  decodeCiv3Flc,
  parseFlicsterFxm,
  decodeIndexedPcx,
  parseJascPalette,
  exportFlicsterStoryboardFromFlc,
  loadFlicsterStoryboard,
  buildFlcFromFlicsterStoryboard,
  selectCiv3AnimationFrames,
  handleFlicWorkshop
} = require('../src/flcWorkshop');

const fixtureCowDir = path.join(__dirname, 'fixtures', 'flcWorkshop', 'Cow');
const tmpCowDir = path.join(__dirname, '..', 'tmp', 'Cow');
const cowDir = fs.existsSync(path.join(fixtureCowDir, 'black and white cow.flc')) ? fixtureCowDir : tmpCowDir;
const cowFlc = path.join(cowDir, 'black and white cow.flc');
const cowFxm = path.join(cowDir, 'black and white cow_StoryBoard.FXM');
const cowPcx = path.join(cowDir, 'black and white cow.pcx');
const cowPal = path.join(cowDir, 'black and white cow.pal');
const cowAlphaPal = path.join(cowDir, 'black and white cow_Alpha.pal');
const hasCowFixture = fs.existsSync(cowFlc) && fs.existsSync(cowFxm) && fs.existsSync(cowPcx);
const vanillaDir = path.join(__dirname, 'fixtures', 'flcWorkshop', 'Vanilla');
const vanillaFixtures = [
  {
    name: 'WorkerDefault',
    file: path.join(vanillaDir, 'Worker', 'WorkerDefault.flc'),
    meta: { width: 50, height: 51, frameCountHeader: 120, decodedFrames: 128, speed: 125, directions: 8, framesPerDirection: 15, animTime: 1875, directionMask: 255 }
  },
  {
    name: 'SpearmanAttackA',
    file: path.join(vanillaDir, 'Spearman', 'SpearmanAttackA.flc'),
    meta: { width: 129, height: 78, frameCountHeader: 120, decodedFrames: 128, speed: 66, directions: 8, framesPerDirection: 15, animTime: 1000, directionMask: 255 }
  },
  {
    name: 'DestroyerDefault',
    file: path.join(vanillaDir, 'Destroyer', 'DestroyerDefault.flc'),
    meta: { width: 120, height: 69, frameCountHeader: 80, decodedFrames: 88, speed: 166, directions: 8, framesPerDirection: 10, animTime: 1666, directionMask: 255 }
  },
  {
    name: 'VolcanoSmoke',
    file: path.join(vanillaDir, 'VolcanoSmoke', 'VolcanoSmoke.flc'),
    meta: { width: 33, height: 73, frameCountHeader: 20, decodedFrames: 21, speed: 100, directions: 1, framesPerDirection: 20, animTime: 2000, directionMask: 1 }
  }
];
const hasVanillaFixtures = vanillaFixtures.every((fixture) => fs.existsSync(fixture.file));

function framesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function assertFramesEqual(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} frame count`);
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(framesEqual(actual[i], expected[i]), true, `${label} frame ${i}`);
  }
}

function scaleIndexedFrameNearest(frame, width, height, scale) {
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < outWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      out[y * outWidth + x] = frame[srcY * width + srcX];
    }
  }
  return { frame: out, width: outWidth, height: outHeight };
}

function makeDarkenedPalette(palette, hour) {
  const factor = hour <= 12 ? 0.35 + (hour / 12) * 0.65 : 1 - ((hour - 12) / 12) * 0.55;
  const out = new Uint8Array(palette);
  for (let i = 0; i < 224; i += 1) {
    out[i * 3] = Math.max(0, Math.min(255, Math.round(out[i * 3] * factor)));
    out[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(out[i * 3 + 1] * factor)));
    out[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(out[i * 3 + 2] * factor)));
  }
  return out;
}

function makeCurrentViewerFixture(flcPath, scale = 1.2, delay = 80) {
  const decoded = decodeCiv3Flc(flcPath);
  const civ3 = decoded.meta.civ3;
  const sourceFrames = selectCiv3AnimationFrames(decoded.frames, civ3.numAnims, civ3.animLength);
  const scaled = sourceFrames.map((frame) => scaleIndexedFrameNearest(frame, decoded.meta.width, decoded.meta.height, scale));
  const frameWidth = scaled[0].width;
  const frameHeight = scaled[0].height;
  const frames = scaled.map((item, idx) => {
    const next = new Uint8Array(item.frame);
    next[(idx % frameHeight) * frameWidth + (idx % frameWidth)] = (40 + idx) % 223;
    return next;
  });
  const palette = makeDarkenedPalette(decoded.palette, 24);
  palette[0] = 15;
  palette[1] = 90;
  palette[2] = 180;
  palette[14 * 3] = 200;
  palette[14 * 3 + 1] = 40;
  palette[14 * 3 + 2] = 10;
  return {
    decoded,
    frames,
    palette,
    frameWidth,
    frameHeight,
    delay,
    framesBase64: frames.map((frame) => Buffer.from(frame).toString('base64')),
    paletteBase64: Buffer.from(palette).toString('base64')
  };
}

test('legacy Cow fixture metadata parses from FLC, FXM, PCX, and palettes', { skip: !hasCowFixture }, () => {
  const decoded = decodeCiv3Flc(cowFlc);
  assert.equal(decoded.meta.width, 60);
  assert.equal(decoded.meta.height, 60);
  assert.equal(decoded.meta.depth, 8);
  assert.equal(decoded.meta.frameCountHeader, 256);
  assert.equal(decoded.meta.speed, 170);
  assert.equal(decoded.meta.civ3.numAnims, 8);
  assert.equal(decoded.meta.civ3.animLength, 32);
  assert.equal(decoded.meta.civ3.xOffset, 90);
  assert.equal(decoded.meta.civ3.yOffset, 90);
  assert.equal(decoded.meta.civ3.xsOrig, 240);
  assert.equal(decoded.meta.civ3.ysOrig, 240);
  assert.equal(decoded.meta.civ3.animTime, 5440);
  assert.equal(decoded.meta.civ3.directions, 255);
  assert.equal(decoded.chunkCounts[4], 1);
  assert.equal(decoded.chunkCounts[7], 256);
  assert.equal(decoded.chunkCounts[15], 8);

  const fxm = parseFlicsterFxm(cowFxm);
  assert.equal(fxm.frameWidth, 60);
  assert.equal(fxm.frameHeight, 60);
  assert.equal(fxm.delay, 170);
  assert.equal(fxm.civ3.numAnims, 8);
  assert.equal(fxm.civ3.animLength, 32);
  assert.equal(fxm.civ3.xOffset, 90);
  assert.equal(fxm.civ3.yOffset, 90);
  assert.equal(fxm.civ3.animTime, 5440);

  const pcx = decodeIndexedPcx(cowPcx);
  assert.equal(pcx.width, 1953);
  assert.equal(pcx.height, 489);
  assert.equal(pcx.palette.length, 768);
  assert.equal(parseJascPalette(cowPal).length, 768);
  assert.equal(parseJascPalette(cowAlphaPal).length, 768);
});

test('exported storyboard matches Cow storyboard frames', { skip: !hasCowFixture }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-export-'));
  const exported = exportFlicsterStoryboardFromFlc(cowFlc, out, { baseName: 'cow' });
  assert.equal(exported.ok, true);
  assert.ok(fs.existsSync(exported.paths.pcxPath));
  assert.ok(fs.existsSync(exported.paths.palPath));
  assert.ok(fs.existsSync(exported.paths.alphaPalPath));
  assert.ok(fs.existsSync(exported.paths.fxmPath));

  const original = loadFlicsterStoryboard(cowFxm);
  const roundtrip = loadFlicsterStoryboard(exported.paths.fxmPath);
  assert.equal(roundtrip.storyboard.width, 1953);
  assert.equal(roundtrip.storyboard.height, 489);
  assert.equal(roundtrip.frames.length, original.frames.length);
  for (let i = 0; i < original.frames.length; i += 1) {
    assert.equal(framesEqual(roundtrip.frames[i], original.frames[i]), true, `frame ${i}`);
  }
});

test('exported storyboard honors selected palette and delay options', { skip: !hasCowFixture }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-export-options-'));
  const decoded = decodeCiv3Flc(cowFlc);
  const palette = new Uint8Array(decoded.palette);
  palette[0] = 12;
  palette[1] = 34;
  palette[2] = 56;
  const exported = exportFlicsterStoryboardFromFlc(cowFlc, out, {
    baseName: 'cow-options',
    palette,
    delay: 120
  });
  assert.equal(exported.ok, true);
  const fxm = parseFlicsterFxm(exported.paths.fxmPath);
  assert.equal(fxm.delay, 120);
  assert.equal(fxm.civ3.animTime, 32 * 120);
  const pal = parseJascPalette(exported.paths.palPath);
  const pcx = decodeIndexedPcx(exported.paths.pcxPath);
  assert.deepEqual(Array.from(pal.slice(0, 3)), [12, 34, 56]);
  assert.deepEqual(Array.from(pcx.palette.slice(0, 3)), [12, 34, 56]);
});

test('exported storyboard honors frame size and frame count options', { skip: !hasCowFixture }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-export-geometry-'));
  const exported = exportFlicsterStoryboardFromFlc(cowFlc, out, {
    baseName: 'cow-geometry',
    frameWidth: 80,
    frameHeight: 90,
    framesPerDirection: 40
  });
  assert.equal(exported.ok, true);
  const fxm = parseFlicsterFxm(exported.paths.fxmPath);
  const pcx = decodeIndexedPcx(exported.paths.pcxPath);
  assert.equal(fxm.frameWidth, 80);
  assert.equal(fxm.frameHeight, 90);
  assert.equal(fxm.civ3.animLength, 40);
  assert.equal(fxm.civ3.xOffset, 80);
  assert.equal(fxm.civ3.yOffset, 75);
  assert.equal(fxm.civ3.animTime, 40 * 170);
  assert.equal(pcx.width, (80 + 1) * 40 + 1);
  assert.equal(pcx.height, (90 + 1) * 8 + 1);

  const shrinkOut = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-export-shrink-'));
  const shrink = exportFlicsterStoryboardFromFlc(cowFlc, shrinkOut, {
    baseName: 'cow-shrink',
    frameWidth: 50,
    frameHeight: 45
  });
  assert.equal(shrink.ok, true);
  const shrinkFxm = parseFlicsterFxm(shrink.paths.fxmPath);
  const shrinkPcx = decodeIndexedPcx(shrink.paths.pcxPath);
  assert.equal(shrinkFxm.frameWidth, 50);
  assert.equal(shrinkFxm.frameHeight, 45);
  assert.equal(shrinkFxm.civ3.xOffset, 95);
  assert.equal(shrinkFxm.civ3.yOffset, 98);
  assert.equal(shrinkPcx.width, (50 + 1) * 32 + 1);
  assert.equal(shrinkPcx.height, (45 + 1) * 8 + 1);
});


test('legacy storyboard builds a Civ3 unit FLC with compatible metadata and chunks', { skip: !hasCowFixture }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-build-'));
  const outputPath = path.join(out, 'cow-built.flc');
  const built = buildFlcFromFlicsterStoryboard(cowFxm, outputPath);
  assert.equal(built.ok, true);
  const source = loadFlicsterStoryboard(cowFxm);
  const decoded = decodeCiv3Flc(outputPath);
  assert.equal(decoded.meta.magic, 0xaf12);
  assert.equal(decoded.meta.frameCountHeader, 256);
  assert.equal(decoded.meta.width, 60);
  assert.equal(decoded.meta.height, 60);
  assert.equal(decoded.meta.depth, 8);
  assert.equal(decoded.meta.speed, 170);
  assert.equal(decoded.meta.civ3.numAnims, 8);
  assert.equal(decoded.meta.civ3.animLength, 32);
  assert.equal(decoded.meta.civ3.animTime, 5440);
  assert.equal(decoded.chunkCounts[4], 1);
  assert.equal(decoded.chunkCounts[7], 256);
  assert.equal(decoded.chunkCounts[15], 8);

  const animationFrames = selectCiv3AnimationFrames(decoded.frames, 8, 32);
  assert.equal(animationFrames.length, source.frames.length);
  for (let i = 0; i < source.frames.length; i += 1) {
    assert.equal(framesEqual(animationFrames[i], source.frames[i]), true, `frame ${i}`);
  }
});

test('vanilla FLC fixtures decode with expected Civ3 metadata diversity', { skip: !hasVanillaFixtures }, () => {
  for (const fixture of vanillaFixtures) {
    const decoded = decodeCiv3Flc(fixture.file);
    const civ3 = decoded.meta.civ3;
    assert.equal(decoded.meta.magic, 0xaf12, `${fixture.name} magic`);
    assert.equal(decoded.meta.depth, 8, `${fixture.name} depth`);
    assert.equal(decoded.meta.width, fixture.meta.width, `${fixture.name} width`);
    assert.equal(decoded.meta.height, fixture.meta.height, `${fixture.name} height`);
    assert.equal(decoded.meta.frameCountHeader, fixture.meta.frameCountHeader, `${fixture.name} frame header`);
    assert.equal(decoded.frames.length, fixture.meta.decodedFrames, `${fixture.name} decoded frames`);
    assert.equal(decoded.meta.speed, fixture.meta.speed, `${fixture.name} speed`);
    assert.equal(civ3.numAnims, fixture.meta.directions, `${fixture.name} direction count`);
    assert.equal(civ3.animLength, fixture.meta.framesPerDirection, `${fixture.name} frames per direction`);
    assert.equal(civ3.animTime, fixture.meta.animTime, `${fixture.name} animation time`);
    assert.equal(civ3.directions, fixture.meta.directionMask, `${fixture.name} direction mask`);
    assert.equal(decoded.chunkCounts[4], 1, `${fixture.name} color chunk`);
    assert.ok(decoded.chunkCounts[7] > 0, `${fixture.name} delta chunks`);
    assert.ok(decoded.chunkCounts[15] > 0, `${fixture.name} byte-run chunks`);
    assert.equal(selectCiv3AnimationFrames(decoded.frames, civ3.numAnims, civ3.animLength).length, civ3.numAnims * civ3.animLength);
  }
});

test('vanilla FLC fixtures export to storyboard and rebuild compatible FLCs', { skip: !hasVanillaFixtures }, () => {
  for (const fixture of vanillaFixtures) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), `c3x-flic-${fixture.name}-`));
    const exported = exportFlicsterStoryboardFromFlc(fixture.file, out, { baseName: fixture.name });
    assert.equal(exported.ok, true, `${fixture.name} export`);

    const loaded = loadFlicsterStoryboard(exported.paths.fxmPath);
    const pcx = decodeIndexedPcx(exported.paths.pcxPath);
    const fxm = parseFlicsterFxm(exported.paths.fxmPath);
    const sourceDecoded = decodeCiv3Flc(fixture.file);
    assert.equal(fxm.frameWidth, fixture.meta.width, `${fixture.name} FXM width`);
    assert.equal(fxm.frameHeight, fixture.meta.height, `${fixture.name} FXM height`);
    assert.equal(fxm.delay, fixture.meta.speed, `${fixture.name} FXM delay`);
    assert.equal(fxm.civ3.numAnims, fixture.meta.directions, `${fixture.name} FXM directions`);
    assert.equal(fxm.civ3.animLength, fixture.meta.framesPerDirection, `${fixture.name} FXM frames`);
    assert.equal(fxm.civ3.xOffset, sourceDecoded.meta.civ3.xOffset, `${fixture.name} FXM x offset`);
    assert.equal(fxm.civ3.yOffset, sourceDecoded.meta.civ3.yOffset, `${fixture.name} FXM y offset`);
    assert.equal(fxm.civ3.xsOrig, sourceDecoded.meta.civ3.xsOrig, `${fixture.name} FXM original width`);
    assert.equal(fxm.civ3.ysOrig, sourceDecoded.meta.civ3.ysOrig, `${fixture.name} FXM original height`);
    assert.equal(pcx.width, (fixture.meta.width + 1) * fixture.meta.framesPerDirection + 1, `${fixture.name} storyboard width`);
    assert.equal(pcx.height, (fixture.meta.height + 1) * fixture.meta.directions + 1, `${fixture.name} storyboard height`);

    const sourceFrames = selectCiv3AnimationFrames(sourceDecoded.frames, fixture.meta.directions, fixture.meta.framesPerDirection);
    assertFramesEqual(loaded.frames, sourceFrames, `${fixture.name} storyboard`);

    const builtPath = path.join(out, `${fixture.name}-rebuilt.flc`);
    buildFlcFromFlicsterStoryboard(exported.paths.fxmPath, builtPath);
    const rebuilt = decodeCiv3Flc(builtPath);
    assert.equal(rebuilt.meta.width, fixture.meta.width, `${fixture.name} rebuilt width`);
    assert.equal(rebuilt.meta.height, fixture.meta.height, `${fixture.name} rebuilt height`);
    assert.equal(rebuilt.meta.speed, fixture.meta.speed, `${fixture.name} rebuilt delay`);
    assert.equal(rebuilt.meta.civ3.numAnims, fixture.meta.directions, `${fixture.name} rebuilt directions`);
    assert.equal(rebuilt.meta.civ3.animLength, fixture.meta.framesPerDirection, `${fixture.name} rebuilt frames per direction`);
    assert.equal(rebuilt.meta.civ3.animTime, fixture.meta.framesPerDirection * fixture.meta.speed, `${fixture.name} rebuilt time`);
    assert.equal(rebuilt.chunkCounts[4], 1, `${fixture.name} rebuilt color chunk`);
    assert.equal(rebuilt.chunkCounts[15], fixture.meta.directions, `${fixture.name} rebuilt byte-run chunks`);
    assert.equal(rebuilt.chunkCounts[7], fixture.meta.directions * fixture.meta.framesPerDirection, `${fixture.name} rebuilt delta chunks`);
    assertFramesEqual(selectCiv3AnimationFrames(rebuilt.frames, fixture.meta.directions, fixture.meta.framesPerDirection), loaded.frames, `${fixture.name} rebuilt`);
  }
});

test('inspected storyboard metadata survives UI-style Save as FLC rebuild', { skip: !hasVanillaFixtures }, () => {
  const fixture = vanillaFixtures.find((item) => item.name === 'WorkerDefault');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-storyboard-ui-build-'));
  const exported = exportFlicsterStoryboardFromFlc(fixture.file, out, { baseName: 'worker-ui-build' });
  const sourceDecoded = decodeCiv3Flc(fixture.file);
  const inspected = handleFlicWorkshop({ action: 'inspectStoryboard', fxmPath: exported.paths.fxmPath });
  assert.equal(inspected.ok, true);
  assert.ok(inspected.storyboardMeta, 'inspectStoryboard should expose flat storyboard metadata');
  assert.equal(inspected.storyboardMeta.frameWidth, fixture.meta.width);
  assert.equal(inspected.storyboardMeta.frameHeight, fixture.meta.height);
  assert.equal(inspected.storyboardMeta.directionCount, fixture.meta.directions);
  assert.equal(inspected.storyboardMeta.framesPerDirection, fixture.meta.framesPerDirection);
  assert.equal(inspected.storyboardMeta.xOffset, sourceDecoded.meta.civ3.xOffset);
  assert.equal(inspected.storyboardMeta.yOffset, sourceDecoded.meta.civ3.yOffset);
  assert.equal(inspected.storyboardMeta.xsOrig, sourceDecoded.meta.civ3.xsOrig);
  assert.equal(inspected.storyboardMeta.ysOrig, sourceDecoded.meta.civ3.ysOrig);
  assert.equal(inspected.storyboardMeta.directions, sourceDecoded.meta.civ3.directions);

  const meta = inspected.storyboardMeta;
  const builtPath = path.join(out, 'worker-ui-built.flc');
  const built = handleFlicWorkshop({
    action: 'buildFlc',
    outputPath: builtPath,
    framesBase64: inspected.indexedFramesBase64,
    paletteBase64: inspected.paletteBase64,
    frameWidth: meta.frameWidth,
    frameHeight: meta.frameHeight,
    directionCount: meta.directionCount,
    framesPerDirection: meta.framesPerDirection,
    delay: meta.delay,
    xOffset: meta.xOffset,
    yOffset: meta.yOffset,
    xsOrig: meta.xsOrig,
    ysOrig: meta.ysOrig,
    directions: meta.directions
  });
  assert.equal(built.ok, true);
  const rebuilt = decodeCiv3Flc(builtPath);
  assert.equal(rebuilt.meta.width, fixture.meta.width);
  assert.equal(rebuilt.meta.height, fixture.meta.height);
  assert.equal(rebuilt.meta.speed, fixture.meta.speed);
  assert.equal(rebuilt.meta.frameCountHeader, fixture.meta.directions * fixture.meta.framesPerDirection);
  assert.equal(rebuilt.meta.civ3.numAnims, sourceDecoded.meta.civ3.numAnims);
  assert.equal(rebuilt.meta.civ3.animLength, sourceDecoded.meta.civ3.animLength);
  assert.equal(rebuilt.meta.civ3.xOffset, sourceDecoded.meta.civ3.xOffset);
  assert.equal(rebuilt.meta.civ3.yOffset, sourceDecoded.meta.civ3.yOffset);
  assert.equal(rebuilt.meta.civ3.xsOrig, sourceDecoded.meta.civ3.xsOrig);
  assert.equal(rebuilt.meta.civ3.ysOrig, sourceDecoded.meta.civ3.ysOrig);
  assert.equal(rebuilt.meta.civ3.directions, sourceDecoded.meta.civ3.directions);
  assertFramesEqual(
    selectCiv3AnimationFrames(rebuilt.frames, meta.directionCount, meta.framesPerDirection),
    loadFlicsterStoryboard(exported.paths.fxmPath).frames,
    'UI-style storyboard rebuild'
  );
});

test('current viewer transforms survive storyboard export and Save as FLC rebuild', { skip: !hasVanillaFixtures }, () => {
  const fixture = vanillaFixtures.find((item) => item.name === 'WorkerDefault');
  const viewer = makeCurrentViewerFixture(fixture.file, 1.2, 80);
  const civ3 = viewer.decoded.meta.civ3;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-viewer-export-'));
  const exported = exportFlicsterStoryboardFromFlc(fixture.file, out, {
    baseName: 'viewer-worker',
    palette: viewer.palette,
    framesBase64: viewer.framesBase64,
    sourceFrameWidth: viewer.frameWidth,
    sourceFrameHeight: viewer.frameHeight,
    frameWidth: viewer.frameWidth,
    frameHeight: viewer.frameHeight,
    framesPerDirection: civ3.animLength,
    delay: viewer.delay
  });

  const loaded = loadFlicsterStoryboard(exported.paths.fxmPath);
  const pcx = decodeIndexedPcx(exported.paths.pcxPath);
  const pal = parseJascPalette(exported.paths.palPath);
  const fxm = parseFlicsterFxm(exported.paths.fxmPath);
  assert.equal(fxm.frameWidth, viewer.frameWidth);
  assert.equal(fxm.frameHeight, viewer.frameHeight);
  assert.equal(fxm.delay, viewer.delay);
  assert.equal(fxm.civ3.animTime, civ3.animLength * viewer.delay);
  assert.equal(pcx.width, (viewer.frameWidth + 1) * civ3.animLength + 1);
  assert.equal(pcx.height, (viewer.frameHeight + 1) * civ3.numAnims + 1);
  assert.deepEqual(Array.from(pal.slice(0, 3)), [15, 90, 180]);
  assert.deepEqual(Array.from(pcx.palette.slice(14 * 3, 14 * 3 + 3)), [200, 40, 10]);
  assertFramesEqual(loaded.frames, viewer.frames, 'viewer storyboard frames');

  const builtPath = path.join(out, 'viewer-worker.flc');
  const built = handleFlicWorkshop({
    action: 'buildFlc',
    outputPath: builtPath,
    framesBase64: viewer.framesBase64,
    paletteBase64: viewer.paletteBase64,
    frameWidth: viewer.frameWidth,
    frameHeight: viewer.frameHeight,
    directionCount: civ3.numAnims,
    framesPerDirection: civ3.animLength,
    delay: viewer.delay,
    xOffset: 90,
    yOffset: 89,
    xsOrig: 240,
    ysOrig: 240,
    directions: civ3.directions
  });
  assert.equal(built.ok, true);
  const rebuilt = decodeCiv3Flc(builtPath);
  assert.equal(rebuilt.meta.width, viewer.frameWidth);
  assert.equal(rebuilt.meta.height, viewer.frameHeight);
  assert.equal(rebuilt.meta.speed, viewer.delay);
  assert.equal(rebuilt.meta.civ3.animTime, civ3.animLength * viewer.delay);
  assert.deepEqual(Array.from(rebuilt.palette.slice(0, 3)), [15, 90, 180]);
  assertFramesEqual(selectCiv3AnimationFrames(rebuilt.frames, civ3.numAnims, civ3.animLength), viewer.frames, 'viewer rebuilt frames');
});

test('storyboard import rejects malformed PCX and palette companions', { skip: !hasVanillaFixtures }, () => {
  const fixture = vanillaFixtures.find((item) => item.name === 'WorkerDefault');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-invalid-storyboard-'));
  const exported = exportFlicsterStoryboardFromFlc(fixture.file, out, { baseName: 'invalid-worker' });

  const badDimensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-invalid-dim-'));
  for (const name of ['invalid-worker_StoryBoard.FXM', 'invalid-worker.pal', 'invalid-worker_Alpha.pal']) {
    fs.copyFileSync(path.join(out, name), path.join(badDimensionDir, name));
  }
  const badPcx = Buffer.from(fs.readFileSync(exported.paths.pcxPath));
  badPcx.writeUInt16LE(badPcx.readUInt16LE(8) + 1, 8);
  fs.writeFileSync(path.join(badDimensionDir, 'invalid-worker.pcx'), badPcx);
  assert.throws(
    () => loadFlicsterStoryboard(path.join(badDimensionDir, 'invalid-worker_StoryBoard.FXM')),
    /Storyboard PCX is .* expected/
  );

  const badModeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-invalid-mode-'));
  for (const name of ['invalid-worker_StoryBoard.FXM', 'invalid-worker.pal', 'invalid-worker_Alpha.pal']) {
    fs.copyFileSync(path.join(out, name), path.join(badModeDir, name));
  }
  const trueColorPcx = Buffer.from(fs.readFileSync(exported.paths.pcxPath));
  trueColorPcx[65] = 3;
  fs.writeFileSync(path.join(badModeDir, 'invalid-worker.pcx'), trueColorPcx);
  assert.throws(
    () => loadFlicsterStoryboard(path.join(badModeDir, 'invalid-worker_StoryBoard.FXM')),
    /8-bit indexed color/
  );

  const badPaletteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-flic-invalid-pal-'));
  for (const name of ['invalid-worker_StoryBoard.FXM', 'invalid-worker.pcx', 'invalid-worker_Alpha.pal']) {
    fs.copyFileSync(path.join(out, name), path.join(badPaletteDir, name));
  }
  fs.writeFileSync(path.join(badPaletteDir, 'invalid-worker.pal'), 'JASC-PAL\n0100\n255\n0 0 0\n', 'latin1');
  assert.throws(
    () => loadFlicsterStoryboard(path.join(badPaletteDir, 'invalid-worker_StoryBoard.FXM')),
    /256 colors/
  );
});

test('renderer exposes the Units-tab FLC Workshop entry point', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.match(renderer, /workshopBtn\.textContent = 'FLC Workshop'/);
  assert.match(renderer, /unitFlicWorkshopLabel\.textContent = 'FLC Workshop'/);
  assert.match(renderer, /unitFlicWorkshopIcon\.textContent = '🎞'/);
  assert.match(renderer, /unitFlicWorkshopBtn\.addEventListener\('click'/);
  assert.match(renderer, /openFlicWorkshopForUnitEntry\(selectedEntry\)/);
  assert.match(renderer, /flcEdit\.innerHTML = '<span class="btn-icon">🎞<\/span>Edit'/);
  assert.match(renderer, /openFlicWorkshopForUnitAnimationModel\(activeModelForRow, row\.key\)/);
  assert.match(renderer, /openFlicWorkshopForUnitAnimationModel\(activeModel, String\(activeAction \|\| ui\.actionKey \|\| ''\)/);
  assert.match(renderer, /openFlicWorkshopModal\(\{/);
  assert.match(renderer, /actionRows: rows/);
  assert.match(renderer, /flicWorkshopModal\.title\.textContent = 'FLC Workshop'/);
  assert.match(renderer, /class="ghost flic-workshop-close" aria-label="Close">Close<\/button>/);
  assert.match(renderer, /renderFlicWorkshopActionBar\(\)/);
  assert.match(renderer, /overlay\.querySelector\('\.flic-workshop-header-source'\)/);
  assert.match(renderer, /chooser\.className = 'flic-workshop-source-native-select'/);
  assert.match(renderer, /knownGroup\.label = 'Known FLCs'/);
  assert.match(renderer, /separator\.disabled = true/);
  assert.match(renderer, /browseGroup\.label = 'Other'/);
  assert.match(renderer, /browseSource\.textContent = 'Browse FLC or Storyboard'/);
  assert.doesNotMatch(renderer, /Exports PCX, PAL, Alpha PAL/);
  assert.match(renderer, /loadFlicWorkshopFlc\(row, \{ resetStatus: true \}\)/);
  assert.match(renderer, /browseFlicWorkshopSource\(\)/);
  assert.match(renderer, /extensions: \['flc', 'fxm'\]/);
  assert.match(renderer, /\.fxm\$\/i\.test\(clean\)/);
  assert.match(renderer, /action: 'inspectStoryboard'/);
  assert.match(renderer, /action: 'exportStoryboard'/);
  assert.match(renderer, /action: 'buildFlc'/);
  assert.match(renderer, /function getFlicWorkshopStoryboardBuildMeta\(storyboard\)/);
  assert.match(renderer, /const flat = source\.storyboardMeta \|\| \{\}/);
  assert.match(renderer, /directionCount: meta\.directionCount/);
  assert.match(renderer, /framesPerDirection: meta\.framesPerDirection/);
  assert.match(renderer, /xOffset: frameSizeChanged \? Math\.max\(0, Math\.round\(\(xsOrig - frameWidth\) \/ 2\)\) : meta\.xOffset/);
  assert.match(renderer, /saveBtn\.textContent = 'Save as FLC'/);
  assert.match(renderer, /configuredName === 'conquests' \|\| configuredName === 'civ3ptw'/);
  assert.match(renderer, /\['File', flicWorkshopModal\.sourcePath \? getFlicWorkshopDisplayPath\(flicWorkshopModal\.sourcePath\) : '\(none\)'\]/);
  assert.match(renderer, /getFlicWorkshopDefaultOutputDir\(\)/);
  assert.match(renderer, /confirmFlicWorkshopOverwrite\(outputPaths\)/);
  assert.match(renderer, /confirmFlicWorkshopOverwrite\(\[outputPath\]\)/);
  assert.match(renderer, /function promptFlicWorkshopOverwriteModal\(paths\)/);
  assert.match(renderer, /layer\.className = 'flic-workshop-confirm-layer'/);
  assert.match(renderer, /modal\.className = 'confirm-modal flic-workshop-overwrite-modal'/);
  assert.match(renderer, /overwriteBtn\.textContent = 'Overwrite'/);
  assert.match(renderer, /Overwrite: \$\{getFlicWorkshopDisplayPath\(filePath\)\}/);
  assert.doesNotMatch(renderer, /Overwrite\?`/);
  assert.match(renderer, /showFlicWorkshopToast\(\{/);
  assert.match(renderer, /window\.c3xManager\.openFilePath\(folder\)/);
  assert.match(renderer, /function setFlicWorkshopOutputDirectoryInput\(input, outputDir\)/);
  assert.match(renderer, /input\.dataset\.outputDir = clean/);
  assert.match(renderer, /input\.value = clean \? getFlicWorkshopDisplayPath\(clean\) : ''/);
  assert.match(renderer, /function getFlicWorkshopOutputDirectoryInput\(input\)/);
  assert.match(renderer, /pickDirectory\(\{ defaultPath: getFlicWorkshopOutputDirectoryInput\(outputValue\) \|\| getFlicWorkshopDefaultOutputDir\(\) \}\)/);
  assert.match(renderer, /renderFlicWorkshopCivColorPicker\(displayControls\)/);
  assert.match(renderer, /layout\.className = 'flic-workshop-preview-layout'/);
  assert.match(renderer, /controls\.className = 'flic-workshop-controls flic-workshop-preview-controls'/);
  assert.match(renderer, /createReferencePicker\(\{[\s\S]*pickerClassName: 'flic-workshop-civ-picker'/);
  assert.match(renderer, /parseCivilizationColorSlot\(entry, 'defaultcolor'\)/);
  assert.match(renderer, /renderFlicWorkshopExportPalettePicker\(pickerWrap\)/);
  assert.match(renderer, /flicWorkshopModal\.exportEditor = flicWorkshopModal\.exportEditor === key \? '' : key/);
  assert.match(renderer, /className = 'flic-workshop-export-popover-layer'/);
  assert.match(renderer, /className = 'ghost flic-workshop-export-popover-close'/);
  assert.match(renderer, /delayInput\.type = 'range'/);
  assert.match(renderer, /delayInput\.max = '170'/);
  assert.match(renderer, /flicWorkshopModal\.frameDelay/);
  assert.match(renderer, /flicWorkshopModal\.frameWidth/);
  assert.match(renderer, /flicWorkshopModal\.frameHeight/);
  assert.match(renderer, /getFlicWorkshopFrameWidth\(\)/);
  assert.match(renderer, /getFlicWorkshopFrameHeight\(\)/);
  assert.match(renderer, /const fileWidth = Math\.max\(1, Number\(meta\.width\) \|\| 1\)/);
  assert.match(renderer, /const sourceWidth = getFlicWorkshopFrameWidth\(\)/);
  assert.match(renderer, /const sourceHeight = getFlicWorkshopFrameHeight\(\)/);
  assert.match(renderer, /function resetFlicWorkshopViewerToDisk\(\)/);
  assert.match(renderer, /resetBtn\.className = 'ghost flic-workshop-reset-btn'/);
  assert.match(renderer, /function getFlicWorkshopViewerFramePayload\(\)/);
  assert.match(renderer, /indexedFramesBase64: framedFrames\.map\(\(indices\) => toBase64FromUint8\(indices\)\)/);
  assert.match(renderer, /flicWorkshopModal\.exportSizeMode = 'viewer'/);
  assert.match(renderer, /flicWorkshopModal\.exportPaletteMode = 'viewer'/);
  assert.match(renderer, /flicWorkshopModal\.exportDelayMode = 'viewer'/);
  assert.match(renderer, /framesBase64: useViewerFrames && viewerPayload \? viewerPayload\.framesBase64 : null/);
  assert.match(renderer, /sourceFrameWidth: useViewerFrames && viewerPayload \? viewerPayload\.frameWidth : 0/);
  assert.match(renderer, /framesBase64: viewerPayload && viewerPayload\.framesBase64/);
  assert.match(renderer, /delay: viewerPayload \? viewerPayload\.delay/);
  assert.match(renderer, /Current Viewer Size \(\$\{sourceWidth\} x \$\{sourceHeight\}\)/);
  assert.match(renderer, /Original Size \(\$\{fileWidth\} x \$\{fileHeight\}\)/);
  assert.match(renderer, /if \(flicWorkshopModal\.exportSizeMode === 'viewer'\) return sourceWidth;/);
  assert.match(renderer, /if \(flicWorkshopModal\.exportSizeMode === 'viewer'\) return sourceHeight;/);
  assert.match(renderer, /getFlicWorkshopMinFrameWidth\(\)/);
  assert.match(renderer, /getFlicWorkshopMinFrameHeight\(\)/);
  assert.match(renderer, /scaleFlicWorkshopFullIndexedFrame\(frame, width, height, scale, bg\)/);
  assert.match(renderer, /padFlicWorkshopIndexedFrames\(zoomResult\.frames/);
  assert.match(renderer, /zoomInput\.type = 'range'/);
  assert.match(renderer, /zoomInput\.min = '0\.5'/);
  assert.match(renderer, /zoomInput\.max = '1\.5'/);
  assert.match(renderer, /hourInput\.type = 'range'/);
  assert.match(renderer, /hourInput\.value = String\(clampFlicWorkshopHour\(flicWorkshopModal\.hour\)\)/);
  assert.match(renderer, /hourText\.textContent = 'Day\/Night'/);
  assert.match(renderer, /getFlicWorkshopPaletteForHour\(palette, frames\)/);
  assert.match(renderer, /getFlicWorkshopFramesForZoom\(indexedFrames/);
  assert.match(renderer, /outputWidth:\s*width \+ padLeft \+ padRight/);
  assert.match(renderer, /width:\s*targetWidth/);
  assert.match(renderer, /Maximum Size \(\$\{maxWidth\} x \$\{maxHeight\}\)/);
  assert.match(renderer, /Maximum Frame Count \(64\)/);
  assert.match(renderer, /getFlicWorkshopCivilizationColorOptions\(\)/);
  assert.match(renderer, /const storyboardTabLabel = flicWorkshopModal\.sourceKind === 'storyboard' \? 'Save as FLC' : 'Export Storyboard'/);
  assert.match(renderer, /\['storyboard', storyboardTabLabel, '▥'\]/);
  assert.match(renderer, /exportBtn\.textContent = 'Export Storyboard'/);
  assert.doesNotMatch(renderer, /\['build'/);
  assert.doesNotMatch(renderer, /renderFlicWorkshopBuildTab/);
  assert.match(renderer, /const displayPalette = getFlicWorkshopDisplayPalette\(palette, civPalette, indexedFrames\)/);
  assert.match(renderer, /paletteBase64: selectedPalette/);
  assert.match(renderer, /frameWidth: getTargetWidth\(\)/);
  assert.match(renderer, /framesPerDirection: getTargetFrameCount\(\)/);
  assert.doesNotMatch(renderer, /Civ Color \$\{Number\(slot\.slot\) \+ 1\}/);
  assert.doesNotMatch(renderer, /Use the decoded frame size\./);
  assert.doesNotMatch(renderer, /FLICster/);
  assert.doesNotMatch(renderer, /FLC Workshop - \$\{/);
  assert.doesNotMatch(renderer, /getFlicWorkshopCivColorOptions/);
});

test('preload and main expose the FLC Workshop IPC bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(preload, /flicWorkshop: \(payload\) => ipcRenderer\.invoke\('manager:flic-workshop', payload\)/);
  assert.match(preload, /pickDirectory: \(options\) => ipcRenderer\.invoke\('manager:pick-directory', options\)/);
  assert.match(main, /ipcMain\.handle\('manager:pick-directory', async \(_event, options\) =>/);
  assert.match(main, /dialogOptions\.defaultPath = options\.defaultPath\.trim\(\)/);
  assert.match(main, /ipcMain\.handle\('manager:flic-workshop'/);
  assert.match(main, /handleFlicWorkshop\(payload \|\| \{\}\)/);
});

test('FLC Workshop backend can build from current viewer frames', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'flcWorkshop.js'), 'utf8');
  assert.match(source, /function prepareStoryboardExportFramesFromIndexed\(sourceFrames, sourceMeta, meta\)/);
  assert.match(source, /function buildFlcFromIndexedFrames\(framesBase64, paletteBase64, outputPath, options = \{\}\)/);
  assert.match(source, /framesBase64: payload\.framesBase64/);
  assert.match(source, /sourceFrameWidth: Number\(payload\.sourceFrameWidth\)/);
  assert.match(source, /if \(Array\.isArray\(payload\.framesBase64\) && payload\.framesBase64\.length > 0\)/);
});

test('FLC Workshop modal has an opaque stable-height shell', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const panelRule = css.match(/\.flic-workshop-modal-panel\s*\{[^}]+\}/);
  const bodyRule = css.match(/\.flic-workshop-body\s*\{[^}]+\}/);
  assert.ok(panelRule, 'missing modal panel rule');
  assert.ok(bodyRule, 'missing modal body rule');
  assert.match(panelRule[0], /background:\s*#ffffff;/);
  assert.match(panelRule[0], /width:\s*min\(780px,\s*calc\(100vw - 48px\)\);/);
  assert.match(panelRule[0], /height:\s*min\(600px,\s*calc\(100vh - 48px\)\);/);
  assert.doesNotMatch(panelRule[0], /var\(--panel-bg\)/);
  assert.match(bodyRule[0], /background:\s*#ffffff;/);
  assert.match(bodyRule[0], /flex:\s*1 1 auto;/);
  assert.match(bodyRule[0], /min-height:\s*0;/);
});

test('FLC Workshop tabs use map-mode style segmented buttons', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const tabsRule = css.match(/\.flic-workshop-tabs\s*\{[^}]+\}/);
  const tabRule = css.match(/\.flic-workshop-tab\s*\{[^}]+\}/);
  const activeRule = css.match(/\.flic-workshop-tab\.active\s*\{[^}]+\}/);
  const resetRule = css.match(/\.flic-workshop-reset-btn\s*\{[^}]+\}/);
  assert.match(renderer, /btn\.dataset\.tab = key/);
  assert.match(renderer, /btn\.innerHTML = `<span class="btn-icon">\$\{icon\}<\/span>\$\{label\}`/);
  assert.ok(tabsRule, 'missing workshop tabs rule');
  assert.ok(tabRule, 'missing workshop tab rule');
  assert.ok(activeRule, 'missing active workshop tab rule');
  assert.ok(resetRule, 'missing reset button rule');
  assert.match(tabsRule[0], /border-radius:\s*10px;/);
  assert.match(tabsRule[0], /width:\s*calc\(100% - 28px\);/);
  assert.match(tabsRule[0], /padding:\s*3px;/);
  assert.doesNotMatch(tabsRule[0], /border:/);
  assert.doesNotMatch(tabsRule[0], /box-shadow:/);
  assert.match(resetRule[0], /margin-left:\s*auto;/);
  assert.match(tabRule[0], /border-radius:\s*8px;/);
  assert.match(tabRule[0], /font-weight:\s*700;/);
  assert.match(activeRule[0], /background:\s*var\(--mode-grad\);/);
});

test('FLC Workshop action selector and palette grid stay compact', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const headerSourceRule = css.match(/\.flic-workshop-header-source\s*\{[^}]+\}/);
  const sourceBarRule = css.match(/\.flic-workshop-sourcebar\s*\{[^}]+\}/);
  const headerSourceBarRule = css.match(/\.flic-workshop-sourcebar\.in-header\s*\{[^}]+\}/);
  const sourceOpenRule = css.match(/\.flic-workshop-sourcebar-open\s*\{[^}]+\}/);
  const sourceNativeSelectRule = css.match(/\.flic-workshop-source-native-select\s*\{[^}]+\}/);
  const toastRule = css.match(/\.flic-workshop-toast\s*\{[^}]+\}/);
  const modalPanelRule = css.match(/\.flic-workshop-modal-panel\s*\{[^}]+\}/);
  const directionDisabledRule = css.match(/\.unit-direction-btn:disabled\s*\{[^}]+\}/);
  const workshopHideRule = css.match(/@media \(max-width:\s*1320px\)\s*\{[^}]*\.unit-flic-workshop-action-btn\s*\{[^}]+\}/);
  const previewLayoutRule = css.match(/\.flic-workshop-preview-layout\s*\{[^}]+\}/);
  const previewControlsRule = css.match(/\.flic-workshop-preview-controls\s*\{[^}]+\}/);
  const previewPointerRule = css.match(/\.flic-workshop-preview-controls \.flic-workshop-civ-picker \.tech-picker-btn,\s*\.flic-workshop-preview-controls \.flic-workshop-checkbox-control,\s*\.flic-workshop-preview-controls \.flic-workshop-check input,\s*\.flic-workshop-preview-controls input\[type="range"\]\s*\{[^}]+\}/);
  const controlGroupRule = css.match(/^\.flic-workshop-control-group\s*\{[^}]+\}/m);
  const exportFormRule = css.match(/\.flic-workshop-export-form\s*\{[^}]+\}/);
  const exportFormCompactRule = css.match(/\.flic-workshop-export-form\.compact\s*\{[^}]+\}/);
  const exportChoiceRule = css.match(/\.flic-workshop-export-choice\s*\{[^}]+\}/);
  const exportInputRule = css.match(/\.flic-workshop-export-row select,\s*\.flic-workshop-export-row input\[type="text"\],\s*\.flic-workshop-export-row input\[type="number"\]\s*\{[^}]+\}/);
  const exportPopoverRule = css.match(/\.flic-workshop-export-popover-layer\s*\{[^}]+\}/);
  const exportEditorSelectedRule = css.match(/\.flic-workshop-export-editor-option:has\(input\[type="radio"\]:checked\)\s*\{[^}]+\}/);
  const exportEditorInputRule = css.match(/\.flic-workshop-export-editor-option input\s*\{[^}]+\}/);
  const overwriteLayerRule = css.match(/\.flic-workshop-confirm-layer\s*\{[^}]+\}/);
  const overwriteModalRule = css.match(/\.flic-workshop-overwrite-modal\s*\{[^}]+\}/);
  const overwritePathsRule = css.match(/\.flic-workshop-overwrite-paths\s*\{[^}]+\}/);
  const previewRowRule = css.match(/\.flic-workshop-preview-row\s*\{[^}]+\}/);
  const paletteGridRule = css.match(/\.flic-workshop-palette-grid\s*\{[^}]+\}/);
  const paletteSwatchRule = css.match(/\.flic-workshop-palette-swatch\s*\{[^}]+\}/);
  assert.ok(headerSourceRule, 'missing header source rule');
  assert.ok(sourceBarRule, 'missing source bar rule');
  assert.ok(headerSourceBarRule, 'missing header source bar rule');
  assert.ok(sourceOpenRule, 'missing source open wrapper rule');
  assert.ok(sourceNativeSelectRule, 'missing native source select rule');
  assert.ok(toastRule, 'missing workshop toast rule');
  assert.ok(modalPanelRule, 'missing modal panel rule');
  assert.ok(directionDisabledRule, 'missing disabled direction rule');
  assert.ok(workshopHideRule, 'missing lower-width toolbar hide rule');
  assert.ok(previewLayoutRule, 'missing preview layout rule');
  assert.ok(previewControlsRule, 'missing preview controls rule');
  assert.ok(previewPointerRule, 'missing preview pointer cursor rule');
  assert.match(previewPointerRule[0], /cursor:\s*pointer/);
  assert.ok(controlGroupRule, 'missing control group rule');
  assert.ok(exportFormRule, 'missing export form rule');
  assert.ok(exportFormCompactRule, 'missing compact export form rule');
  assert.ok(exportChoiceRule, 'missing export choice rule');
  assert.ok(exportInputRule, 'missing export input rule');
  assert.ok(exportPopoverRule, 'missing export popover rule');
  assert.ok(exportEditorSelectedRule, 'missing selected export editor rule');
  assert.ok(exportEditorInputRule, 'missing export editor input rule');
  assert.ok(overwriteLayerRule, 'missing overwrite layer rule');
  assert.ok(overwriteModalRule, 'missing overwrite modal rule');
  assert.ok(overwritePathsRule, 'missing overwrite paths rule');
  assert.ok(previewRowRule, 'missing preview row rule');
  assert.ok(paletteGridRule, 'missing palette grid rule');
  assert.ok(paletteSwatchRule, 'missing palette swatch rule');
  assert.match(renderer, /document\.createElement\('select'\)/);
  assert.match(renderer, /chooser\.className = 'flic-workshop-source-native-select'/);
  assert.match(renderer, /knownGroup\.label = 'Known FLCs'/);
  assert.match(renderer, /separator\.disabled = true/);
  assert.match(renderer, /browseGroup\.label = 'Other'/);
  assert.match(renderer, /browseSource\.textContent = 'Browse FLC or Storyboard'/);
  assert.match(renderer, /getFlicWorkshopToastHost\(\)\.appendChild\(toast\)/);
  assert.match(renderer, /hideFlicWorkshopToast\(\)/);
  assert.match(renderer, /function getPreviewAvailableDirectionIndexes\(preview\)/);
  assert.match(renderer, /function getPreviewCiv3Meta\(preview\)/);
  assert.match(renderer, /preview && preview\.civ3NumAnims/);
  assert.match(renderer, /preview && preview\.civ3AnimLength/);
  assert.match(renderer, /directionCount \* \(explicitPerDir \+ 1\)/);
  assert.match(renderer, /const start = dirPosition \* decodedBlockSize/);
  assert.match(renderer, /btn\.disabled = disabled/);
  assert.match(renderer, /getFlicWorkshopPreviewForDisplay\(activeDirection\)/);
  assert.match(renderer, /displayPreviewCache/);
  assert.match(renderer, /sliceBase64FramesByDirection\(preview\.indexedFramesBase64, preview, directionIndex\)/);
  assert.match(headerSourceRule[0], /justify-self:\s*stretch;/);
  assert.match(sourceBarRule[0], /grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/);
  assert.match(headerSourceBarRule[0], /width:\s*100%;/);
  assert.doesNotMatch(renderer, /flic-workshop-sourcebar-label/);
  assert.doesNotMatch(css, /\.flic-workshop-sourcebar-label/);
  assert.match(sourceOpenRule[0], /position:\s*relative;/);
  assert.match(sourceNativeSelectRule[0], /position:\s*absolute;/);
  assert.match(sourceNativeSelectRule[0], /opacity:\s*0;/);
  assert.match(sourceNativeSelectRule[0], /cursor:\s*pointer;/);
  assert.match(toastRule[0], /position:\s*absolute;/);
  assert.match(toastRule[0], /bottom:\s*14px;/);
  assert.match(modalPanelRule[0], /position:\s*relative;/);
  assert.match(directionDisabledRule[0], /cursor:\s*not-allowed;/);
  assert.match(previewLayoutRule[0], /grid-template-columns:\s*minmax\(220px,\s*280px\) minmax\(0,\s*1fr\);/);
  assert.match(previewControlsRule[0], /grid-template-columns:\s*1fr;/);
  assert.match(controlGroupRule[0], /grid-template-rows:\s*auto 1fr;/);
  assert.match(controlGroupRule[0], /border-radius:\s*8px;/);
  assert.match(exportFormRule[0], /width:\s*100%;/);
  assert.match(exportFormRule[0], /max-width:\s*none;/);
  assert.match(exportFormCompactRule[0], /max-width:\s*none;/);
  assert.match(exportChoiceRule[0], /min-height:\s*38px;/);
  assert.match(exportChoiceRule[0], /font-size:\s*0\.82rem;/);
  assert.match(exportChoiceRule[0], /font-weight:\s*400;/);
  assert.match(exportChoiceRule[0], /text-align:\s*left;/);
  assert.match(exportInputRule[0], /font-size:\s*0\.82rem;/);
  assert.match(exportInputRule[0], /font-weight:\s*400;/);
  assert.match(exportPopoverRule[0], /position:\s*absolute;/);
  assert.match(exportPopoverRule[0], /background:\s*rgba\(36,\s*25,\s*64,\s*0\.1\);/);
  assert.match(exportEditorSelectedRule[0], /border-color:\s*rgba\(11,\s*127,\s*120,\s*0\.38\);/);
  assert.match(exportEditorSelectedRule[0], /background:\s*rgba\(232,\s*255,\s*252,\s*0\.86\);/);
  assert.match(exportEditorInputRule[0], /accent-color:\s*var\(--accent\);/);
  assert.match(overwriteLayerRule[0], /position:\s*absolute;/);
  assert.match(overwriteLayerRule[0], /backdrop-filter:\s*blur\(2px\);/);
  assert.match(overwriteModalRule[0], /width:\s*min\(560px,\s*100%\);/);
  assert.match(overwritePathsRule[0], /max-height:\s*170px;/);
  assert.match(previewRowRule[0], /grid-template-columns:\s*max-content auto;/);
  assert.match(paletteGridRule[0], /grid-template-columns:\s*repeat\(16,\s*13px\);/);
  assert.match(paletteSwatchRule[0], /width:\s*13px;/);
  assert.match(paletteSwatchRule[0], /height:\s*13px;/);
});
