const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listRecentCivAdvisorSaves } = require('../src/civAdvisorRecent');

test('Civ Advisor recent saves are filtered, newest-first, and limited', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-civ-advisor-recent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const savesDir = path.join(root, 'Conquests', 'Saves');
  const autoDir = path.join(savesDir, 'Auto');
  fs.mkdirSync(savesDir, { recursive: true });
  fs.mkdirSync(autoDir, { recursive: true });
  const baseTime = Date.now() - 60_000;
  for (let idx = 0; idx < 12; idx += 1) {
    const filePath = path.join(savesDir, `Turn ${String(idx).padStart(2, '0')}.SAV`);
    fs.writeFileSync(filePath, Buffer.alloc(idx + 1, idx));
    const modified = new Date(baseTime + (idx * 1000));
    fs.utimesSync(filePath, modified, modified);
  }
  const autoOld = path.join(autoDir, 'Auto Older.SAV');
  fs.writeFileSync(autoOld, Buffer.alloc(3, 1));
  fs.utimesSync(autoOld, new Date(baseTime + 500), new Date(baseTime + 500));
  const autoLatest = path.join(autoDir, 'Autosave.SAV');
  fs.writeFileSync(autoLatest, Buffer.alloc(4, 2));
  fs.utimesSync(autoLatest, new Date(baseTime + 20_000), new Date(baseTime + 20_000));
  fs.writeFileSync(path.join(savesDir, 'not-a-save.txt'), 'ignore me');
  fs.writeFileSync(path.join(autoDir, 'not-a-save.txt'), 'ignore me');

  const result = listRecentCivAdvisorSaves(root, 10);
  assert.equal(result.ok, true);
  assert.equal(result.savesDir, savesDir);
  assert.equal(result.saves.length, 10);
  assert.deepEqual(result.saves.map((save) => save.relativeName), [
    path.join('Auto', 'Autosave.SAV'),
    'Turn 11.SAV',
    'Turn 10.SAV',
    'Turn 09.SAV',
    'Turn 08.SAV',
    'Turn 07.SAV',
    'Turn 06.SAV',
    'Turn 05.SAV',
    'Turn 04.SAV',
    'Turn 03.SAV'
  ]);
  assert.equal(result.saves[0].fileName, 'Autosave.SAV');
  assert.equal(result.saves[0].path, autoLatest);
  assert.ok(result.saves.every((save) => Number.isFinite(save.modifiedMs) && Number.isFinite(save.size)));

  const fromConquestsPath = listRecentCivAdvisorSaves(path.join(root, 'Conquests'), 1);
  assert.equal(fromConquestsPath.saves[0].fileName, 'Autosave.SAV');
});

test('Civ Advisor recent save listing tolerates a missing Saves folder', () => {
  const result = listRecentCivAdvisorSaves(path.join(os.tmpdir(), 'missing-civ3-root'), 10);
  assert.equal(result.ok, true);
  assert.deepEqual(result.saves, []);
  assert.match(result.savesDir, /Conquests[\\/]Saves$/);
});

test('Civ Advisor UI exposes native recent-save selection and five-second following', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

  assert.match(html, /id="civadvisor-save-select"/);
  assert.match(html, /class="mode-pill mode-select civadvisor-save-select"/);
  assert.match(html, /id="civadvisor-follow-latest" type="checkbox"/);
  assert.match(html, />Auto-update</);
  assert.match(renderer, /const CIV_ADVISOR_RECENT_SAVE_LIMIT = 10;/);
  assert.match(renderer, /const CIV_ADVISOR_POLL_INTERVAL_MS = 5000;/);
  assert.match(renderer, /recentGroup\.label = 'Recent Saves'/);
  assert.match(renderer, /save\.relativeName \|\| save\.fileName \|\| getPathTail\(save\.path\)/);
  assert.match(renderer, /browse\.textContent = 'Browse\.\.\.'/);
  assert.match(renderer, /state\.civAdvisor\.followingLatest = false;[\s\S]*?loadCivAdvisorSave\(selected/);
  assert.match(main, /label: 'Civ Advisor'[\s\S]*?label: 'Choose Saves Manually'[\s\S]*?label: 'Load Latest When Opened'[\s\S]*?label: 'Follow Latest While Open'/);
  assert.match(main, /manager:list-recent-civ-advisor-saves/);
  assert.match(preload, /listRecentCivAdvisorSaves/);
  assert.match(preload, /onCivAdvisorLoadModeMenuSelect/);
});
