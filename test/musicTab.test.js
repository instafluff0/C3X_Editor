const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  loadBundle,
  saveBundle,
  previewSavePlan,
  inspectAudioFileBasic
} = require('../src/configCore');
const { auditLoadedBundle } = require('../src/bundleAudit');

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
  assert.notEqual(start, -1, `expected ${name} function to exist`);
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
  assert.notEqual(braceStart, -1, `expected ${name} function body to exist`);
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

test('MP3 inspection extracts duration and common Civ3 metadata', () => {
  const root = mkTmpDir();
  const mp3Path = path.join(root, 'test.mp3');
  const data = Buffer.alloc(16000, 0);
  data[0] = 0xff;
  data[1] = 0xfb;
  data[2] = 0x90;
  data[3] = 0x64;
  writeFile(mp3Path, data);

  const info = inspectAudioFileBasic(mp3Path);
  assert.equal(info.bitrateKbps, 128);
  assert.equal(info.sampleRateHz, 44100);
  assert.equal(info.channelMode, 'stereo');
  assert.ok(info.durationSeconds > 0);
});

test('Music now-playing panel exposes metadata and allows selected-track waveform seeking before playback', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const stylesText = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const renderMusicNowPlayingPanel = extractFunctionSource(rendererText, 'renderMusicNowPlayingPanel');
  const seekSelectedMusicTrack = extractFunctionSource(rendererText, 'seekSelectedMusicTrack');
  const getMusicNowPlayingMeta = extractFunctionSource(rendererText, 'getMusicNowPlayingMeta');
  const playMusicTrack = extractFunctionSource(rendererText, 'playMusicTrack');
  const setMusicAudioTime = extractFunctionSource(rendererText, 'setMusicAudioTime');
  const syncMusicPlayerTimingFromAudio = extractFunctionSource(rendererText, 'syncMusicPlayerTimingFromAudio');
  const attachMusicAudioHandlers = extractFunctionSource(rendererText, 'attachMusicAudioHandlers');
  const ensureMusicAudioForTrack = extractFunctionSource(rendererText, 'ensureMusicAudioForTrack');
  const appendMusicDebugLog = extractFunctionSource(rendererText, 'appendMusicDebugLog');
  const getMusicPendingSeekRatioValue = extractFunctionSource(rendererText, 'getMusicPendingSeekRatioValue');
  const getMusicPendingSeekTimeValue = extractFunctionSource(rendererText, 'getMusicPendingSeekTimeValue');
  const applyPendingMusicSeek = extractFunctionSource(rendererText, 'applyPendingMusicSeek');

  assert.match(
    renderMusicNowPlayingPanel,
    /meta\.className = 'music-now-time';[\s\S]*?meta\.textContent = getMusicNowPlayingMeta\(selectedTrack, player\);/,
    'now-playing panel should render live time and technical metadata'
  );
  assert.match(
    renderMusicNowPlayingPanel,
    /wave\.addEventListener\('pointerdown'[\s\S]*?void seekSelectedMusicTrack\(ratio\);/,
    'waveform clicks should seek through the shared selected-track seek path'
  );
  assert.match(
    seekSelectedMusicTrack,
    /setMusicPendingSeekRatio\(activePlayer, normalizedRatio\);[\s\S]*?await ensureMusicAudioForTrack\(selectedTrack\);[\s\S]*?await waitForMusicMetadata\(activePlayer\);[\s\S]*?applyPendingMusicSeek\(activePlayer\);/,
    'selected-track seeking should persist the waveform ratio, lazily prepare audio, then apply the seek after metadata'
  );
  assert.match(
    ensureMusicAudioForTrack,
    /player\.audio = new Audio\(\);[\s\S]*?attachMusicAudioHandlers\(player, Number\(player\.token \|\| 0\)\);[\s\S]*?player\.audio\.src = url;[\s\S]*?player\.audio\.load\(\);/,
    'audio event handlers should be attached before assigning/loading the source so early metadata/reset events are captured'
  );
  assert.match(
    appendMusicDebugLog,
    /external: true,[\s\S]*?category: 'music-player'/,
    'music seek diagnostics should be mirrored into the app log for live repro evidence'
  );
  assert.match(
    renderMusicNowPlayingPanel,
    /logMusicPlayerDebug\('waveform-pointerdown'[\s\S]*?ratio: formatMusicDebugNumber\(ratio\)/,
    'waveform clicks should log the requested seek ratio and geometry'
  );
  assert.match(
    getMusicNowPlayingMeta,
    /formatMusicTime\(current\)[\s\S]*?formatMusicTime\(duration\)[\s\S]*?bitrateKbps[\s\S]*?getMusicSampleRateLabel[\s\S]*?channelMode/,
    'now-playing metadata should include current/total time, bitrate, sample rate, and channel mode'
  );
  assert.doesNotMatch(
    renderMusicNowPlayingPanel,
    /music-now-subtitle|textContent\s*=[^;\n]*['"`](Selected|Playing)['"`]/,
    'now-playing panel should not spend a line saying only that the track is selected or playing'
  );
  assert.match(
    playMusicTrack,
    /reconcileMusicPlayerPlaybackState\(\{ forceRender: true, clearBuffering: true \}\);[\s\S]*?return getMusicAudioIsActuallyPlaying\(state\.musicPlayer\);/,
    'playback UI state should be reconciled from the real Audio element after play attempts'
  );
  assert.match(
    getMusicPendingSeekRatioValue,
    /value === null \|\| value === undefined \|\| value === ''[\s\S]*?return Number\.isFinite\(ratio\) && ratio >= 0 && ratio <= 1 \? ratio : null;/,
    'cleared pending seek ratio must not be treated as an explicit seek to zero'
  );
  assert.match(
    getMusicPendingSeekTimeValue,
    /value === null \|\| value === undefined \|\| value === ''[\s\S]*?return Number\.isFinite\(seconds\) && seconds >= 0 \? seconds : null;/,
    'cleared pending seek time must not be treated as an explicit seek to zero'
  );
  assert.match(
    playMusicTrack,
    /if \(getMusicPendingSeekRatioValue\(player\) != null \|\| getMusicPendingSeekTimeValue\(player\) != null\) \{/,
    'play should only reapply a seek when a real pending seek exists'
  );
  assert.match(
    applyPendingMusicSeek,
    /const pendingRatio = getMusicPendingSeekRatioValue\(player\);[\s\S]*?const pendingTime = getMusicPendingSeekTimeValue\(player\);[\s\S]*?if \(pendingRatio != null[\s\S]*?if \(pendingTime == null\)/,
    'pending seek application should distinguish null from a deliberate zero-second seek'
  );
  assert.doesNotMatch(
    rendererText,
    /Number\.isFinite\(Number\(player\.pendingSeek(?:Ratio|TimeSeconds)\)\)/,
    'Number(null) must not be used for pending seek existence checks'
  );
  assert.match(
    rendererText,
    /function settleMusicPlayerPlaybackState\(isPlaying[\s\S]*?player\.isPlaying = nextPlaying;[\s\S]*?syncMusicPlayerTimingFromAudio\(player\);/,
    'media pause, end, abort, and error events should update the shared player state'
  );
  assert.match(
    setMusicAudioTime,
    /const duration = Number\(player\.audio\.duration\);[\s\S]*?if \(!Number\.isFinite\(duration\) \|\| duration <= 0\) \{[\s\S]*?player\.pendingSeekTimeSeconds = target;[\s\S]*?return false;[\s\S]*?const clamped = Math\.max\(0, Math\.min\(duration, target\)\);[\s\S]*?player\.audio\.currentTime = clamped;[\s\S]*?options\.clearPending === true/,
    'waveform seeks must wait for real audio duration before assigning currentTime'
  );
  assert.doesNotMatch(
    setMusicAudioTime,
    /try \{\s*player\.audio\.currentTime = target;/,
    'waveform seeks should not write currentTime before metadata exists'
  );
  assert.match(
    seekSelectedMusicTrack,
    /activePlayer\.isBuffering = true;[\s\S]*?await waitForMusicMetadata\(activePlayer\);[\s\S]*?activePlayer\.isBuffering = false;[\s\S]*?activePlayer\.audio\.play\(\);[\s\S]*?reconcileMusicPlayerPlaybackState\(\{ forceRender: true, clearBuffering: true \}\);/,
    'seeking should show buffering, wait for metadata, then resume and reconcile from the Audio element'
  );
  assert.match(
    syncMusicPlayerTimingFromAudio,
    /const hasPendingSeek =[\s\S]*?if \(!hasPendingSeek && Number\.isFinite\(current\) && current >= 0\) player\.currentTimeSeconds = current;/,
    'audio timing sync must not overwrite a pending seek with stale currentTime'
  );
  assert.match(
    attachMusicAudioHandlers,
    /player\.audio\.onseeked = \(\) => \{[\s\S]*?if \(isMusicPendingSeekLanded\(state\.musicPlayer\)\) \{[\s\S]*?clearMusicPendingSeek\(state\.musicPlayer\);[\s\S]*?else if \(getMusicPendingSeekTargetSeconds\(state\.musicPlayer\) != null\) \{[\s\S]*?applyPendingMusicSeek\(state\.musicPlayer\);/,
    'pending waveform seeks should clear only after seeked lands near the requested target, otherwise reapply'
  );
  assert.match(
    renderMusicNowPlayingPanel,
    /play\.classList\.toggle\('buffering', !!player\.isBuffering\);/,
    'now-playing play button should show buffering while metadata is loading for a seek'
  );
  assert.match(
    stylesText,
    /\.music-play-btn\.playing::before,[\s\S]*?\.music-play-btn\.buffering::before \{[\s\S]*?display: block;/,
    'buffering should use the same visible spinning ring as active playback'
  );
});

test('standard music classifies stock root and Conquests MP3s into matrix plus other music', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  writeFile(path.join(civ3Root, 'Sounds', 'Build', 'ancient', 'AncNAfull.mp3'), 'american ancient');
  writeFile(path.join(civ3Root, 'Sounds', 'Build', 'Middle Ages', 'MidGRFull.mp3'), 'roman middle');
  writeFile(path.join(civ3Root, 'Sounds', 'Build', 'IndModern', 'IndMEFull.mp3'), 'mideast industrial');
  writeFile(path.join(civ3Root, 'Sounds', 'Build', 'IndModern', 'StarsFull.mp3'), 'modern shared');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Ancient Music', 'AncEC.mp3'), 'european ancient');
  writeFile(path.join(civ3Root, 'Conquests', 'Sounds', 'Build', 'Japanese', 'Japanese1.mp3'), 'other stock');

  const bundle = loadBundle({
    mode: 'global',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: ''
  });

  assert.equal(bundle.tabs.music.layout, 'stock');
  assert.equal(bundle.tabs.music.effectiveSource, 'standard-library');
  assert.equal(getMusicTracks(bundle, 'ancient', 'american')[0].relativePath, 'ancient/AncNAfull.mp3');
  assert.equal(getMusicTracks(bundle, 'ancient', 'european')[0].relativePath, 'Ancient Music/AncEC.mp3');
  assert.equal(getMusicTracks(bundle, 'medieval', 'roman')[0].relativePath, 'Middle Ages/MidGRFull.mp3');
  assert.equal(getMusicTracks(bundle, 'industrial', 'mideast')[0].relativePath, 'IndModern/IndMEFull.mp3');
  assert.equal(getMusicTracks(bundle, 'modern', 'all')[0].relativePath, 'IndModern/StarsFull.mp3');
  assert.equal(getMusicTracks(bundle, 'playlist', 'all')[0].relativePath, 'Japanese/Japanese1.mp3');
  assert.deepEqual(bundle.tabs.music.cultures.map((culture) => culture.label), ['American', 'European', 'Roman', 'Mideast', 'Asian']);
});

test('scenario without Music.txt inherits standard stock matrix without creating custom music', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  writeFile(path.join(civ3Root, 'Sounds', 'Build', 'ancient', 'AncNAfull.mp3'), 'american ancient');

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot
  });

  assert.equal(bundle.tabs.music.layout, 'stock');
  assert.equal(bundle.tabs.music.sourceDetails.inheritedFromStandard, true);
  assert.equal(bundle.tabs.music.targetPath, path.join(scenarioRoot, 'Text', 'music.txt'));
  assert.equal(getMusicTracks(bundle, 'ancient', 'american')[0].inherited, true);

  const preview = previewSavePlan({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot,
    dirtyTabs: [],
    tabs: { music: bundle.tabs.music }
  });
  assert.equal(preview.ok, true, preview.error || 'preview failed');
  assert.deepEqual(preview.writes, []);
});

test('scenario Music.txt loads as one flat playlist', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  writeFile(path.join(scenarioRoot, 'Text', 'Music.txt'), 'AncEC.mp3\r\nNeutralTheme.mp3\r\n');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'AncEC.mp3'), 'scenario ancient');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'NeutralTheme.mp3'), 'scenario neutral');

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot
  });

  assert.equal(bundle.tabs.music.layout, 'playlist');
  assert.equal(bundle.tabs.music.effectiveSource, 'scenario');
  assert.deepEqual(
    getMusicTracks(bundle, 'playlist', 'all').map((track) => track.relativePath),
    ['AncEC.mp3', 'NeutralTheme.mp3']
  );
  assert.equal(getMusicTracks(bundle, 'ancient', 'european').length, 0);
});

test('music audit warns only for explicit missing playlist MP3s', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  writeFile(path.join(scenarioRoot, 'Text', 'music.txt'), 'MissingTheme.mp3\r\n');

  const bundle = loadBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.tabs.music.count, 1);
  assert.equal(result.tabs.music.general[0].code, 'music-file-missing');

  const inherited = loadBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: mkTmpDir()
  });
  const inheritedResult = auditLoadedBundle(inherited);
  assert.equal(inheritedResult.tabs.music, undefined);
});

test('custom scenario music saves playlist and copied MP3s under scenario Sounds/Build', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const importRoot = mkTmpDir();
  const sourceMp3 = path.join(importRoot, 'theme.mp3');
  const existingMp3 = path.join(scenarioRoot, 'Sounds', 'Build', 'theme.mp3');
  writeFile(sourceMp3, 'new music bytes');
  writeFile(existingMp3, 'existing music bytes');

  const tabs = {
    music: {
      type: 'music',
      title: 'Music',
      layout: 'playlist',
      targetPath: path.join(scenarioRoot, 'Text', 'music.txt'),
      buildTargetPath: path.join(scenarioRoot, 'Sounds', 'Build'),
      assignments: {
        playlist: {
          all: [{
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
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
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

  const saved = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot,
    dirtyTabs: ['music'],
    tabs
  });
  assert.equal(saved.ok, true, saved.error || 'save failed');
  assert.equal(fs.readFileSync(existingMp3, 'utf8'), 'existing music bytes');
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Sounds', 'Build', 'theme_2.mp3'), 'utf8'), 'new music bytes');
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Text', 'music.txt'), 'latin1'), 'theme_2.mp3\r\n');
});

test('pre-resolved custom music import names are preserved on save', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const importRoot = mkTmpDir();
  const sourceMp3 = path.join(importRoot, 'theme.mp3');
  writeFile(sourceMp3, 'new music bytes');
  writeFile(path.join(scenarioRoot, 'Sounds', 'Build', 'theme.mp3'), 'existing music bytes');

  const tabs = {
    music: {
      type: 'music',
      title: 'Music',
      layout: 'playlist',
      targetPath: path.join(scenarioRoot, 'Text', 'music.txt'),
      buildTargetPath: path.join(scenarioRoot, 'Sounds', 'Build'),
      assignments: {
        playlist: {
          all: [{
            relativePath: 'theme_2.mp3',
            displayPath: 'theme_2.mp3',
            pendingSourcePath: sourceMp3
          }]
        }
      },
      sourceDetails: {}
    }
  };

  const saved = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot,
    dirtyTabs: ['music'],
    tabs
  });
  assert.equal(saved.ok, true, saved.error || 'save failed');
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Sounds', 'Build', 'theme.mp3'), 'utf8'), 'existing music bytes');
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Sounds', 'Build', 'theme_2.mp3'), 'utf8'), 'new music bytes');
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Text', 'music.txt'), 'latin1'), 'theme_2.mp3\r\n');
});

test('custom music already in scenario Sounds/Build is referenced without duplicate copying', () => {
  const c3xRoot = mkTmpDir();
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const localMp3 = path.join(scenarioRoot, 'Sounds', 'Build', 'local.mp3');
  writeFile(localMp3, 'local music bytes');

  const tabs = {
    music: {
      type: 'music',
      title: 'Music',
      layout: 'playlist',
      targetPath: path.join(scenarioRoot, 'Text', 'music.txt'),
      buildTargetPath: path.join(scenarioRoot, 'Sounds', 'Build'),
      assignments: {
        playlist: {
          all: [{
            relativePath: 'local.mp3',
            displayPath: 'local.mp3',
            pendingSourcePath: localMp3
          }]
        }
      },
      sourceDetails: {}
    }
  };

  const preview = previewSavePlan({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot,
    dirtyTabs: ['music'],
    tabs
  });
  assert.equal(preview.ok, true, preview.error || 'preview failed');
  assert.deepEqual(
    preview.writes.map((entry) => ({ kind: entry.kind, path: path.relative(scenarioRoot, entry.path) })),
    [{ kind: 'music', path: path.join('Text', 'music.txt') }]
  );

  const saved = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioRoot,
    dirtyTabs: ['music'],
    tabs
  });
  assert.equal(saved.ok, true, saved.error || 'save failed');
  assert.equal(fs.readFileSync(localMp3, 'utf8'), 'local music bytes');
  assert.equal(fs.existsSync(path.join(scenarioRoot, 'Sounds', 'Build', 'local_2.mp3')), false);
  assert.equal(fs.readFileSync(path.join(scenarioRoot, 'Text', 'music.txt'), 'latin1'), 'local.mp3\r\n');
});
