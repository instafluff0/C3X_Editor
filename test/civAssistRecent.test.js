const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listRecentCivAssistSaves } = require('../src/civAssistRecent');

test('Civ Advisor recent saves are filtered, newest-first, and limited', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-civ-advisor-recent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const savesDir = path.join(root, 'Conquests', 'Saves');
  fs.mkdirSync(savesDir, { recursive: true });
  const baseTime = Date.now() - 60_000;
  for (let idx = 0; idx < 12; idx += 1) {
    const filePath = path.join(savesDir, `Turn ${String(idx).padStart(2, '0')}.SAV`);
    fs.writeFileSync(filePath, Buffer.alloc(idx + 1, idx));
    const modified = new Date(baseTime + (idx * 1000));
    fs.utimesSync(filePath, modified, modified);
  }
  fs.writeFileSync(path.join(savesDir, 'not-a-save.txt'), 'ignore me');

  const result = listRecentCivAssistSaves(root, 10);
  assert.equal(result.ok, true);
  assert.equal(result.savesDir, savesDir);
  assert.equal(result.saves.length, 10);
  assert.deepEqual(result.saves.map((save) => save.fileName), [
    'Turn 11.SAV',
    'Turn 10.SAV',
    'Turn 09.SAV',
    'Turn 08.SAV',
    'Turn 07.SAV',
    'Turn 06.SAV',
    'Turn 05.SAV',
    'Turn 04.SAV',
    'Turn 03.SAV',
    'Turn 02.SAV'
  ]);
  assert.ok(result.saves.every((save) => Number.isFinite(save.modifiedMs) && Number.isFinite(save.size)));

  const fromConquestsPath = listRecentCivAssistSaves(path.join(root, 'Conquests'), 1);
  assert.equal(fromConquestsPath.saves[0].fileName, 'Turn 11.SAV');
});

test('Civ Advisor recent save listing tolerates a missing Saves folder', () => {
  const result = listRecentCivAssistSaves(path.join(os.tmpdir(), 'missing-civ3-root'), 10);
  assert.equal(result.ok, true);
  assert.deepEqual(result.saves, []);
  assert.match(result.savesDir, /Conquests[\\/]Saves$/);
});

test('Civ Advisor UI exposes native recent-save selection and five-second following', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

  assert.match(html, /id="civassist-save-select"/);
  assert.match(html, /class="mode-pill mode-select civassist-save-select"/);
  assert.match(html, /id="civassist-follow-latest" type="checkbox"/);
  assert.match(html, />Auto-update</);
  assert.match(renderer, /const CIV_ASSIST_RECENT_SAVE_LIMIT = 10;/);
  assert.match(renderer, /const CIV_ASSIST_POLL_INTERVAL_MS = 5000;/);
  assert.match(renderer, /recentGroup\.label = 'Recent Saves'/);
  assert.match(renderer, /browse\.textContent = 'Browse\.\.\.'/);
  assert.match(renderer, /state\.civAssist\.followingLatest = false;[\s\S]*?loadCivAssistSave\(selected/);
  assert.match(main, /label: 'Civ Advisor'[\s\S]*?label: 'Choose Saves Manually'[\s\S]*?label: 'Load Latest When Opened'[\s\S]*?label: 'Follow Latest While Open'/);
  assert.match(main, /manager:list-recent-civ-assist-saves/);
  assert.match(preload, /listRecentCivAssistSaves/);
  assert.match(preload, /onCivAdvisorLoadModeMenuSelect/);
});
