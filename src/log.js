'use strict';

// Shared debug logger for the C3X Config Manager main process.
//
// Usage:
//   const log = require('./log');
//   log.setCiv3Root(civ3Path);   // call once at startup / on settings load
//   log.info('category', 'message with ' + log.rel('/some/absolute/path'));
//
// Privacy: all absolute paths should go through log.rel() before logging.
// log.rel() returns a path relative to the Civ3 root, so user home-directory
// components (e.g. /Users/johndoe/...) are never written to the log.
//
// In-app debug log forwarding:
//   log.setForwarder((level, category, msg) => { ... });
//   Call this from main.js after the BrowserWindow is ready to forward log
//   entries to the renderer's in-app debug log panel via IPC.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

let _civ3Root = '';
let _forwarder = null;
let _fileLoggingEnabled = false;
let _logFolder = '';
let _fileLoggingWarned = false;
let _contextMode = '';
let _contextBiqPath = '';

// Set the Civ3 root path used by rel() for path sanitization.
// Call this whenever civ3Path is known (settings load, bundle load, etc.).
function setCiv3Root(root) {
  _civ3Root = String(root || '').replace(/[/\\]+$/, '');
}

// Set a forwarding function called on every log entry in addition to console output.
// Used by main.js to push log messages to the renderer's in-app debug log panel.
function setForwarder(fn) {
  _forwarder = typeof fn === 'function' ? fn : null;
}

function configureFileLogging(options) {
  const next = options || {};
  _fileLoggingEnabled = next.enabled !== false;
  _logFolder = String(next.folder || '').trim();
  _fileLoggingWarned = false;
}

function setContext(context) {
  const next = context || {};
  _contextMode = String(next.mode || '').trim();
  _contextBiqPath = String(next.biqPath || next.scenarioPath || '').trim();
}

// Returns a privacy-safe representation of an absolute path for logging:
//   - Paths under the Civ3 root are shown relative to it (e.g. "Conquests/Scenarios/foo.biq")
//   - Paths under the OS temp dir are shown as "[tmp]/filename"
//   - All other paths are shown as just the final filename component
//     to avoid revealing user account names or system layout.
function rel(absPath) {
  const p = String(absPath || '');
  if (!p) return '(none)';

  // Normalize separators for comparison
  const norm = p.replace(/\\/g, '/');
  const rootNorm = _civ3Root.replace(/\\/g, '/');

  if (rootNorm && norm.toLowerCase().startsWith(rootNorm.toLowerCase() + '/')) {
    return norm.slice(rootNorm.length + 1);
  }
  if (rootNorm && norm.toLowerCase() === rootNorm.toLowerCase()) {
    return '(civ3Root)';
  }

  const tmpNorm = os.tmpdir().replace(/\\/g, '/');
  if (tmpNorm && norm.startsWith(tmpNorm + '/')) {
    return '[tmp]/' + path.basename(p);
  }

  // Unknown root: just the filename
  return path.basename(p) || p;
}

// Format an array of paths for a compact log line.
function relList(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return '(none)';
  return paths.map(rel).join(', ');
}

function _stamp() {
  // ISO-8601 local-ish timestamp without TZ noise: "2026-03-21 14:05:32.123"
  return new Date().toISOString().slice(0, 23).replace('T', ' ');
}

function _localDateStamp() {
  const d = new Date();
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function _contextPrefix() {
  const parts = [];
  if (_contextMode) {
    parts.push(`mode=${_contextMode === 'global' ? 'Standard Game' : _contextMode}`);
  }
  if (_contextBiqPath) {
    parts.push(`biq=${path.basename(_contextBiqPath)}`);
  }
  return parts.length ? `[${parts.join('][')}]` : '';
}

function _fmt(level, category, msg) {
  return `[C3X][${_stamp()}][${level}]${_contextPrefix()}[${category}] ${msg}`;
}

const _inTest = !!process.env.NODE_TEST_CONTEXT;

function _writeFileLine(formatted) {
  if (_inTest || !_fileLoggingEnabled || !_logFolder) return;
  try {
    fs.mkdirSync(_logFolder, { recursive: true });
    const filePath = path.join(_logFolder, `c3x-config-manager-${_localDateStamp()}.log`);
    fs.appendFileSync(filePath, `${formatted}${os.EOL}`, 'utf8');
  } catch (err) {
    if (!_fileLoggingWarned) {
      _fileLoggingWarned = true;
      try {
        console.warn(`[C3X][${_stamp()}][WRN][log] File logging failed: ${err && err.message ? err.message : err}`);
      } catch (_) {}
    }
  }
}

function _dispatch(level, category, msg) {
  const formatted = _fmt(level, category, msg);
  if (!_inTest) {
    if (level === 'WRN') console.warn(formatted);
    else if (level === 'ERR') console.error(formatted);
    else console.log(formatted);
  }
  _writeFileLine(formatted);
  if (_forwarder) {
    try { _forwarder(level, category, msg); } catch (_) {}
  }
}

function debug(category, msg) { _dispatch('DBG', category, msg); }
function info(category, msg)  { _dispatch('INF', category, msg); }
function warn(category, msg)  { _dispatch('WRN', category, msg); }
function error(category, msg) { _dispatch('ERR', category, msg); }

module.exports = {
  debug,
  info,
  warn,
  error,
  rel,
  relList,
  setCiv3Root,
  setForwarder,
  configureFileLogging,
  setContext
};
