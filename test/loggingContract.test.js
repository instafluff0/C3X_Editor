const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
}

test('debug log lines are formatted once and shared by renderer, stdout, and in-app log', () => {
  const rendererText = readRepoFile('src', 'renderer.js');
  const mainText = readRepoFile('main.js');
  const logText = readRepoFile('src', 'log.js');

  assert.match(
    rendererText,
    /const formatted = `\[C3X\]\[\$\{getDebugLogTimestamp\(\)\}\]\[\$\{level\}\]\[\$\{category\}\] \$\{parsed\.message\}\$\{payload\}`;[\s\S]*?appendDebugLogLine\(formatted\);[\s\S]*?emitRendererDebugLog\(\{[\s\S]*?formatted/,
    'renderer debug logging should append and emit the same preformatted line'
  );
  assert.match(
    rendererText,
    /const shouldMirrorExternally = !\(options && options\.external === false\);/,
    'renderer debug logs should mirror externally by default'
  );
  assert.match(
    rendererText,
    /window\.c3xManager\.onLog\(\(entry\) => \{[\s\S]*?entry && entry\.formatted[\s\S]*?appendDebugLogLine\(formatted\);/,
    'main-process logs forwarded to the renderer should not be rewrapped'
  );
  assert.match(
    mainText,
    /ipcMain\.on\('manager:renderer-debug-log'[\s\S]*?const formatted = String\(payload\.formatted \|\| payload\.msg \|\| ''\)\.trimEnd\(\);[\s\S]*?log\.writeFormatted\(formatted,/,
    'renderer-origin logs should be written to stdout/file without main-process reformatting'
  );
  assert.match(
    mainText,
    /log\.setForwarder\(\(entry\) => \{[\s\S]*?win\.webContents\.send\('manager:log', entry\);/,
    'main-process logs should forward the already formatted log entry'
  );
  assert.match(
    logText,
    /const formatted = _fmt\(level, category, msg\);[\s\S]*?_forwarder\(\{ level, category, msg, formatted \}\);/,
    'the shared main logger should format once and forward that exact line'
  );
  assert.match(
    logText,
    /function writeFormatted\(formatted, level = 'DBG'\) \{[\s\S]*?console\.log\(line\);[\s\S]*?_writeFileLine\(line\);/,
    'raw formatted renderer lines should be written exactly as received'
  );
});
