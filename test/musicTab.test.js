const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadBundle,
  saveBundle,
  previewSavePlan
} = require('../src/configCore');

const RENDERER_PATH = path.join(__dirname, '..', 'src', 'renderer.js');
const STYLES_PATH = path.join(__dirname, '..', 'src', 'styles.css');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-music-'));
}

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, data = '') {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, data);
}

function getMusicTracks(bundle, eraKey, cultureKey) {
  return (((bundle.tabs.music.assignments || {})[eraKey] || {})[cultureKey]) || [];
}

function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected ${name} to exist`);
  let parenDepth = 0;
  let braceStart = -1;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;
    if (char === '{' && parenDepth === 0) {
      braceStart = index;
      break;
    }
  }
  assert.notEqual(braceStart, -1, `expected ${name} body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

test('music tab loads playlists into Civ3 era and culture cells', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();

  writeFile(path.join(civ3Root, 'Conquests', 'Text', 'music.txt'), 'AncientEC.mp3\r\nModern.mp3\r\n');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'AncientEC.mp3'), 'standard ancient');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Modern.mp3'), 'standard modern');
  writeFile(path.join(scenarioRoot, 'Text', 'music.txt'), 'AncientEC.mp3\r\nMiddleGR.mp3\r\nIndOR.mp3\r\nModern.mp3\r\nNeutralTheme.mp3\r\n');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'AncientEC.mp3'), 'scenario ancient');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'MiddleGR.mp3'), 'scenario medieval');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'IndOR.mp3'), 'scenario industrial');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'Modern.mp3'), 'scenario modern');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'NeutralTheme.mp3'), 'scenario generic');

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot
  });

  assert.equal(bundle.tabs.music.targetPath, path.join(scenarioRoot, 'Text', 'music.txt'));
  assert.equal(getMusicTracks(bundle, 'ancient', 'european')[0].relativePath, 'AncientEC.mp3');
  assert.equal(getMusicTracks(bundle, 'medieval', 'roman')[0].relativePath, 'MiddleGR.mp3');
  assert.equal(getMusicTracks(bundle, 'industrial', 'asian')[0].relativePath, 'IndOR.mp3');
  assert.equal(getMusicTracks(bundle, 'modern', 'all')[0].relativePath, 'Modern.mp3');
  assert.equal(getMusicTracks(bundle, 'playlist', 'all')[0].relativePath, 'NeutralTheme.mp3');
  assert.deepEqual(bundle.tabs.music.cultures.map((culture) => culture.label), ['American', 'European', 'Roman', 'Mideast', 'Asian']);
});

test('standard music falls back to stock Conquests build songs when music.txt is absent', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Ancient Music', 'AncNA.mp3'), 'american ancient');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Ancient Music', 'AncEC.mp3'), 'european ancient');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Middle Ages', 'MidGRFull.mp3'), 'roman medieval');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'IndModern', 'IndMEFull.mp3'), 'mideast industrial');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'IndModern', 'SmashFull.mp3'), 'modern smash');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Misc', 'ModernFull.mp3'), 'modern conquests');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Japanese', 'Japanese1.mp3'), 'ambiguous stock');

  const bundle = loadBundle({
    mode: 'global',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: ''
  });

  assert.equal(bundle.tabs.music.effectiveSource, 'standard-library');
  assert.equal(bundle.tabs.music.sourceDetails.generatedFromLibrary, true);
  assert.equal(getMusicTracks(bundle, 'ancient', 'american')[0].relativePath, 'Ancient Music/AncNA.mp3');
  assert.equal(getMusicTracks(bundle, 'ancient', 'european')[0].relativePath, 'Ancient Music/AncEC.mp3');
  assert.equal(getMusicTracks(bundle, 'medieval', 'roman')[0].relativePath, 'Middle Ages/MidGRFull.mp3');
  assert.equal(getMusicTracks(bundle, 'industrial', 'mideast')[0].relativePath, 'IndModern/IndMEFull.mp3');
  assert.deepEqual(getMusicTracks(bundle, 'modern', 'all').map((track) => track.relativePath), [
    'IndModern/SmashFull.mp3',
    'Misc/ModernFull.mp3'
  ]);
  assert.equal(getMusicTracks(bundle, 'medieval', 'american').length, 0);
  assert.equal(getMusicTracks(bundle, 'playlist', 'all')[0].relativePath, 'Japanese/Japanese1.mp3');
});

test('scenario without music.txt inherits standard music and localizes it on music save', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Ancient Music', 'AncNA.mp3'), 'american ancient');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Ancient Music', 'AncEC.mp3'), 'european ancient');

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot
  });

  assert.equal(bundle.tabs.music.effectiveSource, 'standard-library');
  assert.equal(bundle.tabs.music.sourceDetails.inheritedFromStandard, true);
  assert.equal(bundle.tabs.music.targetPath, path.join(scenarioRoot, 'Text', 'music.txt'));
  assert.equal(getMusicTracks(bundle, 'ancient', 'american')[0].relativePath, 'Ancient Music/AncNA.mp3');
  assert.equal(getMusicTracks(bundle, 'ancient', 'american')[0].inherited, true);

  const preview = previewSavePlan({
    mode: 'scenario',
    scenarioPath: scenarioRoot,
    dirtyTabs: ['music'],
    tabs: { music: bundle.tabs.music }
  });
  assert.equal(preview.ok, true, preview.error || 'preview failed');
  assert.deepEqual(
    preview.writes.map((entry) => ({ kind: entry.kind, path: path.relative(scenarioRoot, entry.path) })),
    [
      { kind: 'musicAudio', path: path.join('Sounds', 'Build', 'Ancient Music', 'AncNA.mp3') },
      { kind: 'musicAudio', path: path.join('Sounds', 'Build', 'Ancient Music', 'AncEC.mp3') },
      { kind: 'music', path: path.join('Text', 'music.txt') }
    ]
  );
});

test('scenario without scenario music.txt inherits standard music.txt when present', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  writeFile(path.join(civ3Root, 'Conquests', 'Text', 'music.txt'), 'AncientEC.mp3\r\n');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'AncientEC.mp3'), 'standard ancient');

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot
  });

  assert.equal(bundle.tabs.music.effectiveSource, 'standard');
  assert.equal(bundle.tabs.music.sourceDetails.inheritedFromStandard, true);
  assert.equal(getMusicTracks(bundle, 'ancient', 'european')[0].relativePath, 'AncientEC.mp3');
});

test('music saves copy pending MP3 imports into scenario Sounds/Build without overwriting', () => {
  const scenarioRoot = mkTmpDir();
  const importRoot = mkTmpDir();
  const sourceMp3 = path.join(importRoot, 'theme.mp3');
  const existingMp3 = path.join(scenarioRoot, 'Sounds', 'Build', 'theme.mp3');
  writeFile(sourceMp3, 'new music bytes');
  writeFile(existingMp3, 'existing music bytes');

  const tabs = {
    music: {
      type: 'music',
      targetPath: path.join(scenarioRoot, 'Text', 'music.txt'),
      assignments: {
        ancient: {
          american: [{
            relativePath: 'theme.mp3',
            displayPath: 'theme.mp3',
            pendingSourcePath: sourceMp3
          }]
        }
      },
      sourceDetails: {}
    }
  };

  const preview = previewSavePlan({
    mode: 'scenario',
    scenarioPath: scenarioRoot,
    dirtyTabs: ['music'],
    tabs
  });
  assert.equal(preview.ok, true, preview.error || 'preview failed');
  assert.deepEqual(
    preview.writes.map((entry) => ({ kind: entry.kind, path: path.relative(scenarioRoot, entry.path) })),
    [
      { kind: 'musicAudio', path: path.join('Sounds', 'Build', 'theme_2.mp3') },
      { kind: 'music', path: path.join('Text', 'music.txt') }
    ]
  );
  assert.equal(tabs.music.assignments.ancient.american[0].relativePath, 'theme.mp3');
  assert.equal(tabs.music.assignments.ancient.american[0].pendingSourcePath, sourceMp3);

  const saved = saveBundle({
    mode: 'scenario',
    scenarioPath: scenarioRoot,
    dirtyTabs: ['music'],
    tabs
  });
  assert.equal(saved.ok, true, saved.error || 'save failed');
  assert.equal(fs.readFileSync(existingMp3, 'utf8'), 'existing music bytes');
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Sounds', 'Build', 'theme_2.mp3'), 'utf8'), 'new music bytes');
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Text', 'music.txt'), 'latin1'), 'theme_2.mp3\r\n');
  assert.equal(saved.saveReport.find((entry) => entry.kind === 'musicAudio').relativePath, 'theme_2.mp3');
});

test('music playlist UI uses direct add/remove and draggable song rows', () => {
  const renderer = fs.readFileSync(RENDERER_PATH, 'utf8');
  const styles = fs.readFileSync(STYLES_PATH, 'utf8');
  const renderMusicTrackRow = extractFunctionSource(renderer, 'renderMusicTrackRow');
  const renderMusicTab = extractFunctionSource(renderer, 'renderMusicTab');
  const renderMusicCell = extractFunctionSource(renderer, 'renderMusicCell');
  const renderMusicNowPlayingPanel = extractFunctionSource(renderer, 'renderMusicNowPlayingPanel');
  const playLocalAudioPreviewPath = extractFunctionSource(renderer, 'playLocalAudioPreviewPath');

  assert.match(renderMusicTrackRow, /row\.draggable = true;/);
  assert.match(renderMusicTrackRow, /dropMusicTrack\(tab, eraKey, cultureKey/);
  assert.match(renderMusicTrackRow, /className = 'ghost music-remove-btn'/);
  assert.match(renderMusicTrackRow, /playBtn\.dataset\.audioPath/);
  assert.match(renderMusicTrackRow, /isAudioPreviewPlayingPath\(playable\)/);
  assert.match(renderMusicTrackRow, /addEventListener\('pointerdown'/);
  assert.match(renderMusicTrackRow, /handleMusicPlayPointer/);
  assert.match(renderMusicTrackRow, /eventIsFromInteractiveControl\(ev\)/);
  assert.doesNotMatch(renderMusicTrackRow, /Replace this song|textContent = 'Replace'/);
  assert.doesNotMatch(renderMusicCell, /Stock default/);
  assert.match(renderMusicCell, /No assigned song/);
  assert.doesNotMatch(renderMusicCell, /Drop MP3/);
  assert.match(renderMusicTab, /getMusicRenderEras\(tab\)/);
  assert.match(renderMusicTab, /music-playlist-head/);
  assert.doesNotMatch(renderer, /Other Stock Music|renderMusicUnassignedLibrary|renderMusicLibraryTrackRow/);
  assert.doesNotMatch(renderMusicTab, /Set Era|music-set-era|pickMusicFileForEra/);
  assert.doesNotMatch(renderMusicTab, /compactPathFromCiv3Root|targetPath|music\.txt/i);
  assert.match(renderMusicTab, /reference-count-text music-count-text/);
  assert.match(renderMusicTab, /renderMusicNowPlayingPanel\(\)/);
  assert.match(renderMusicNowPlayingPanel, /music-waveform-canvas/);
  assert.match(renderMusicNowPlayingPanel, /audio\.currentTime = \(x \/ Math\.max\(1, rect\.width\)\) \* duration/);
  assert.match(playLocalAudioPreviewPath, /isSamePath && getAudioPreviewIsPlaying\(\)/);
  assert.match(playLocalAudioPreviewPath, /const token = \+\+audioPreviewState\.token/);
  assert.match(playLocalAudioPreviewPath, /audioPreviewState\.token !== token \|\| audioPreviewState\.path !== normalizedPath/);
  assert.match(playLocalAudioPreviewPath, /audioPreviewState\.token !== token \|\| audioPreviewState\.audio !== playAudio/);
  assert.doesNotMatch(playLocalAudioPreviewPath, /pathExists/);
  assert.match(styles, /\.music-play-btn[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;/);
  assert.match(styles, /\.music-play-symbol[\s\S]*?border-left: 9px solid currentColor;/);
  assert.match(styles, /\.music-play-btn\.playing \.music-play-symbol[\s\S]*?border-right: 3px solid currentColor;/);
  assert.match(styles, /\.music-remove-btn[\s\S]*?border-radius: 50%;/);
  assert.match(styles, /\.music-now-playing/);
  assert.match(styles, /\.music-table-grid[\s\S]*?min-width: 1060px;/);
});
