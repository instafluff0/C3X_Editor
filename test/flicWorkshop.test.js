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
  selectCiv3AnimationFrames
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

function framesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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

test('renderer exposes the Units-tab FLC Workshop entry point', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.match(renderer, /workshopBtn\.textContent = 'FLC Workshop'/);
  assert.match(renderer, /openFlicWorkshopModal\(\{/);
  assert.match(renderer, /actionRows: Array\.isArray\(activeModel\.typeRows\) \? activeModel\.typeRows : \[\]/);
  assert.match(renderer, /flicWorkshopModal\.title\.textContent = 'FLC Workshop'/);
  assert.match(renderer, /renderFlicWorkshopActionBar\(\)/);
  assert.match(renderer, /loadFlicWorkshopFlc\(row, \{ resetStatus: true \}\)/);
  assert.match(renderer, /browseFlicWorkshopFlc\(\)/);
  assert.match(renderer, /browseFlicWorkshopStoryboard\(\)/);
  assert.match(renderer, /action: 'inspectStoryboard'/);
  assert.match(renderer, /action: 'exportStoryboard'/);
  assert.match(renderer, /action: 'buildFlc'/);
  assert.match(renderer, /saveBtn\.textContent = 'Save as FLC'/);
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
  assert.match(renderer, /zoomInput\.type = 'range'/);
  assert.match(renderer, /zoomInput\.min = '0\.5'/);
  assert.match(renderer, /zoomInput\.max = '1\.5'/);
  assert.match(renderer, /hourInput\.type = 'range'/);
  assert.match(renderer, /hourInput\.value = String\(clampFlicWorkshopHour\(flicWorkshopModal\.hour\)\)/);
  assert.match(renderer, /getFlicWorkshopPaletteForHour\(palette, frames\)/);
  assert.match(renderer, /getFlicWorkshopFramesForZoom\(indexedFrames/);
  assert.match(renderer, /outputWidth:\s*width \+ padLeft \+ padRight/);
  assert.match(renderer, /width:\s*zoomResult\.width/);
  assert.match(renderer, /Maximum Size \(\$\{maxWidth\} x \$\{maxHeight\}\)/);
  assert.match(renderer, /Maximum Frame Count \(64\)/);
  assert.match(renderer, /\['storyboard', 'Export', '▥'\]/);
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
});

test('preload and main expose the FLC Workshop IPC bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(preload, /flicWorkshop: \(payload\) => ipcRenderer\.invoke\('manager:flic-workshop', payload\)/);
  assert.match(main, /ipcMain\.handle\('manager:flic-workshop'/);
  assert.match(main, /handleFlicWorkshop\(payload \|\| \{\}\)/);
});

test('FLC Workshop modal has an opaque stable-height shell', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const panelRule = css.match(/\.flic-workshop-modal-panel\s*\{[^}]+\}/);
  const bodyRule = css.match(/\.flic-workshop-body\s*\{[^}]+\}/);
  assert.ok(panelRule, 'missing modal panel rule');
  assert.ok(bodyRule, 'missing modal body rule');
  assert.match(panelRule[0], /background:\s*#ffffff;/);
  assert.match(panelRule[0], /width:\s*min\(780px,\s*calc\(100vw - 48px\)\);/);
  assert.match(panelRule[0], /height:\s*min\(560px,\s*calc\(100vh - 48px\)\);/);
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
  assert.match(renderer, /btn\.dataset\.tab = key/);
  assert.match(renderer, /btn\.innerHTML = `<span class="btn-icon">\$\{icon\}<\/span>\$\{label\}`/);
  assert.ok(tabsRule, 'missing workshop tabs rule');
  assert.ok(tabRule, 'missing workshop tab rule');
  assert.ok(activeRule, 'missing active workshop tab rule');
  assert.match(tabsRule[0], /border-radius:\s*10px;/);
  assert.match(tabsRule[0], /padding:\s*3px;/);
  assert.doesNotMatch(tabsRule[0], /border:/);
  assert.doesNotMatch(tabsRule[0], /box-shadow:/);
  assert.match(tabRule[0], /border-radius:\s*8px;/);
  assert.match(tabRule[0], /font-weight:\s*700;/);
  assert.match(activeRule[0], /background:\s*var\(--mode-grad\);/);
});

test('FLC Workshop action selector and palette grid stay compact', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const actionBarRule = css.match(/\.flic-workshop-actionbar\s*\{[^}]+\}/);
  const sourceBarRule = css.match(/\.flic-workshop-sourcebar\s*\{[^}]+\}/);
  const sourceChoiceRule = css.match(/\.flic-workshop-source-choice\s*\{[^}]+\}/);
  const previewLayoutRule = css.match(/\.flic-workshop-preview-layout\s*\{[^}]+\}/);
  const previewControlsRule = css.match(/\.flic-workshop-preview-controls\s*\{[^}]+\}/);
  const controlGroupRule = css.match(/^\.flic-workshop-control-group\s*\{[^}]+\}/m);
  const exportChoiceRule = css.match(/\.flic-workshop-export-choice\s*\{[^}]+\}/);
  const exportPopoverRule = css.match(/\.flic-workshop-export-popover-layer\s*\{[^}]+\}/);
  const previewRowRule = css.match(/\.flic-workshop-preview-row\s*\{[^}]+\}/);
  const paletteGridRule = css.match(/\.flic-workshop-palette-grid\s*\{[^}]+\}/);
  const paletteSwatchRule = css.match(/\.flic-workshop-palette-swatch\s*\{[^}]+\}/);
  assert.ok(actionBarRule, 'missing action bar rule');
  assert.ok(sourceBarRule, 'missing source bar rule');
  assert.ok(sourceChoiceRule, 'missing source choice rule');
  assert.ok(previewLayoutRule, 'missing preview layout rule');
  assert.ok(previewControlsRule, 'missing preview controls rule');
  assert.ok(controlGroupRule, 'missing control group rule');
  assert.ok(exportChoiceRule, 'missing export choice rule');
  assert.ok(exportPopoverRule, 'missing export popover rule');
  assert.ok(previewRowRule, 'missing preview row rule');
  assert.ok(paletteGridRule, 'missing palette grid rule');
  assert.ok(paletteSwatchRule, 'missing palette swatch rule');
  assert.match(actionBarRule[0], /padding:\s*0 14px 10px;/);
  assert.match(sourceBarRule[0], /grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;/);
  assert.match(sourceChoiceRule[0], /text-align:\s*left;/);
  assert.match(previewLayoutRule[0], /grid-template-columns:\s*minmax\(220px,\s*280px\) minmax\(0,\s*1fr\);/);
  assert.match(previewControlsRule[0], /grid-template-columns:\s*1fr;/);
  assert.match(controlGroupRule[0], /grid-template-rows:\s*auto 1fr;/);
  assert.match(controlGroupRule[0], /border-radius:\s*8px;/);
  assert.match(exportChoiceRule[0], /min-height:\s*38px;/);
  assert.match(exportChoiceRule[0], /font-size:\s*0\.86rem;/);
  assert.match(exportChoiceRule[0], /text-align:\s*left;/);
  assert.match(exportPopoverRule[0], /position:\s*absolute;/);
  assert.match(exportPopoverRule[0], /background:\s*rgba\(36,\s*25,\s*64,\s*0\.1\);/);
  assert.match(previewRowRule[0], /grid-template-columns:\s*max-content auto;/);
  assert.match(paletteGridRule[0], /grid-template-columns:\s*repeat\(16,\s*13px\);/);
  assert.match(paletteSwatchRule[0], /width:\s*13px;/);
  assert.match(paletteSwatchRule[0], /height:\s*13px;/);
});
