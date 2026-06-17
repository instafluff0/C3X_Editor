const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { loadBundle, previewSavePlan, previewFileDiff, deleteScenario, materializeMapTab, encodeTextBuffer } = require('./src/configCore');
const { getPreview } = require('./src/artPreview');
const log = require('./src/log');

const APP_SETTINGS_FILE = 'settings.json';
const APP_NAME = 'Civ 3 C3X Modern Editor';
const SUPPORTED_C3X_RELEASE = 'R27';
const DEV_APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');
app.setName(APP_NAME);
app.name = APP_NAME;

function applyAppIdentity() {
  app.setName(APP_NAME);
  app.name = APP_NAME;
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion()
    });
  }
}

function getSettingsPathUnsafe() {
  try {
    return path.join(app.getPath('userData'), APP_SETTINGS_FILE);
  } catch (_err) {
    return '';
  }
}

function readStartupPerformanceMode() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return 'high';
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizePerformanceMode(raw && raw.performanceMode);
  } catch (_err) {
    return 'high';
  }
}

function readStartupRunQualityChecks() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return true;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeRunQualityChecks(raw && raw.runQualityChecks);
  } catch (_err) {
    return true;
  }
}

function readStartupReloadAfterSave() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return false;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeReloadAfterSave(raw && raw.reloadAfterSave);
  } catch (_err) {
    return false;
  }
}

function normalizeTooltipDelay(value) {
  const raw = String(value || 'medium').trim().toLowerCase();
  const aliases = {
    instant: 'none',
    immediate: 'none',
    none: 'none',
    'no-delay': 'none',
    short: 'short',
    medium: 'medium',
    long: 'long',
    never: 'off',
    off: 'off',
    disabled: 'off'
  };
  return aliases[raw] || 'medium';
}

function readStartupTooltipDelay() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return 'medium';
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeTooltipDelay(raw && raw.tooltipDelay);
  } catch (_err) {
    return 'medium';
  }
}

function readStartupAutoAddImportedResourceIcons() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return true;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeAutoAddImportedResourceIcons(raw && raw.autoAddImportedResourceIcons);
  } catch (_err) {
    return true;
  }
}

function readStartupAutoAddImportedUnitIcons() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return true;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeAutoAddImportedUnitIcons(raw && raw.autoAddImportedUnitIcons);
  } catch (_err) {
    return true;
  }
}

function readStartupAutoAddImportedBuildingCityIcons() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return true;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeAutoAddImportedBuildingCityIcons(raw && raw.autoAddImportedBuildingCityIcons);
  } catch (_err) {
    return true;
  }
}

function readStartupAutoUpdateScienceAdvisorArrows() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return false;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeAutoUpdateScienceAdvisorArrows(raw && raw.autoUpdateScienceAdvisorArrows);
  } catch (_err) {
    return false;
  }
}

function readStartupTextFileEncoding() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return 'auto';
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeTextFileEncoding(raw && raw.textFileEncoding);
  } catch (_err) {
    return 'auto';
  }
}

function normalizeMapAutoDockTileInfoLeft(value) {
  return value !== false;
}

function readStartupMapAutoDockTileInfoLeft() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return true;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeMapAutoDockTileInfoLeft(raw && raw.mapAutoDockTileInfoLeft);
  } catch (_err) {
    return true;
  }
}

function getDefaultLogFolderUnsafe() {
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch (_err) {
    return '';
  }
}

function normalizeWriteLogFiles(value) {
  return value !== false;
}

function normalizeLogFolder(value) {
  const raw = String(value || '').trim();
  if (raw) return path.resolve(raw);
  return getDefaultLogFolderUnsafe();
}

function readStartupWriteLogFiles() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return true;
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeWriteLogFiles(raw && raw.writeLogFiles);
  } catch (_err) {
    return true;
  }
}

function readStartupLogFolder() {
  try {
    const settingsPath = getSettingsPathUnsafe();
    if (!settingsPath || !fs.existsSync(settingsPath)) return getDefaultLogFolderUnsafe();
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeLogFolder(raw && raw.logFolder);
  } catch (_err) {
    return getDefaultLogFolderUnsafe();
  }
}

function normalizePerformanceMode(value) {
  return String(value || 'high').toLowerCase() === 'safe' ? 'safe' : 'high';
}

function normalizeRunQualityChecks(value) {
  return value !== false;
}

function normalizeReloadAfterSave(value) {
  return value === true;
}

function normalizeAutoAddImportedResourceIcons(value) {
  return value !== false;
}

function normalizeAutoAddImportedUnitIcons(value) {
  return value !== false;
}

function normalizeAutoAddImportedBuildingCityIcons(value) {
  return value !== false;
}

function normalizeAutoUpdateScienceAdvisorArrows(value) {
  return value === true;
}

function normalizeTextFileEncoding(value) {
  const raw = String(value || 'auto').trim().toLowerCase();
  const aliases = {
    auto: 'auto',
    utf8: 'utf8',
    'utf-8': 'utf8',
    'windows-1252': 'windows-1252',
    cp1252: 'windows-1252',
    'windows-1251': 'windows-1251',
    cp1251: 'windows-1251',
    gbk: 'gbk',
    cp936: 'gbk',
    big5: 'big5',
    cp950: 'big5',
    shift_jis: 'shift_jis',
    'shift-jis': 'shift_jis',
    sjis: 'shift_jis',
    cp932: 'shift_jis',
    'euc-kr': 'euc-kr',
    euc_kr: 'euc-kr',
    cp949: 'euc-kr'
  };
  return aliases[raw] || 'auto';
}

function normalizeBiqByteEncoding(value) {
  const normalized = normalizeTextFileEncoding(value);
  return normalized === 'auto' ? 'windows-1252' : normalized;
}

function getEncodedByteLength(text, encoding) {
  return encodeTextBuffer(String(text || ''), normalizeBiqByteEncoding(encoding)).length;
}

function clipTextToEncodedByteLimit(text, maxBytes, encoding) {
  const limit = Math.max(0, Number(maxBytes) || 0);
  const source = String(text || '');
  if (getEncodedByteLength(source, encoding) <= limit) return source;
  const chars = Array.from(source);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (getEncodedByteLength(chars.slice(0, mid).join(''), encoding) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('');
}

function parseReleaseNum(value) {
  const n = parseInt(String(value || '').replace(/^R/i, ''), 10);
  return isNaN(n) ? 0 : n;
}

function normalizeC3xVersion(value) {
  const raw = String(value || SUPPORTED_C3X_RELEASE).trim() || SUPPORTED_C3X_RELEASE;
  const supported = parseReleaseNum(SUPPORTED_C3X_RELEASE);
  const parsed = parseReleaseNum(raw);
  if (supported > 0 && parsed !== supported) return SUPPORTED_C3X_RELEASE;
  return raw;
}

const startupPerformanceMode = readStartupPerformanceMode();
const startupRunQualityChecks = readStartupRunQualityChecks();
const startupReloadAfterSave = readStartupReloadAfterSave();
const startupTooltipDelay = readStartupTooltipDelay();
const startupAutoAddImportedResourceIcons = readStartupAutoAddImportedResourceIcons();
const startupAutoAddImportedUnitIcons = readStartupAutoAddImportedUnitIcons();
const startupAutoAddImportedBuildingCityIcons = readStartupAutoAddImportedBuildingCityIcons();
const startupAutoUpdateScienceAdvisorArrows = readStartupAutoUpdateScienceAdvisorArrows();
const startupTextFileEncoding = readStartupTextFileEncoding();
const startupMapAutoDockTileInfoLeft = readStartupMapAutoDockTileInfoLeft();
const startupWriteLogFiles = readStartupWriteLogFiles();
const startupLogFolder = readStartupLogFolder();
let currentPerformanceMode = startupPerformanceMode;
let currentRunQualityChecks = startupRunQualityChecks;
let currentReloadAfterSave = startupReloadAfterSave;
let currentTooltipDelay = startupTooltipDelay;
let currentAutoAddImportedResourceIcons = startupAutoAddImportedResourceIcons;
let currentAutoAddImportedUnitIcons = startupAutoAddImportedUnitIcons;
let currentAutoAddImportedBuildingCityIcons = startupAutoAddImportedBuildingCityIcons;
let currentAutoUpdateScienceAdvisorArrows = startupAutoUpdateScienceAdvisorArrows;
let currentTextFileEncoding = startupTextFileEncoding;
let currentMapAutoDockTileInfoLeft = startupMapAutoDockTileInfoLeft;
let currentWriteLogFiles = startupWriteLogFiles;
let currentLogFolder = startupLogFolder;
let currentScenarioOptionMenuState = {
  visible: false,
  enabled: false,
  customRulesEnabled: false,
  customPlayerDataEnabled: false
};
log.configureFileLogging({ enabled: currentWriteLogFiles, folder: currentLogFolder });
// Prevent frequent macOS IOSurface allocation crashes in canvas-heavy screens.
if (process.platform === 'darwin' && startupPerformanceMode === 'safe' && process.env.C3X_MANAGER_FORCE_GPU !== '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

function dirExists(dirPath) {
  try {
    return !!dirPath && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch (_err) {
    return false;
  }
}

function pathExists(anyPath) {
  try {
    return !!anyPath && fs.existsSync(anyPath);
  } catch (_err) {
    return false;
  }
}

function resolveCiv3RootPath(civ3Path) {
  if (!civ3Path) return '';
  const base = path.basename(civ3Path).toLowerCase();
  if (base === 'conquests' || base === 'civ3ptw') {
    return path.dirname(civ3Path);
  }
  return civ3Path;
}

function listKnownScenarios(civ3Path) {
  const root = resolveCiv3RootPath(civ3Path);
  if (!root) return [];
  const conquestsRoot = path.join(root, 'Conquests');
  const groups = [
    { source: 'Conquests', dir: path.join(conquestsRoot, 'Conquests') },
    { source: 'Scenarios', dir: path.join(conquestsRoot, 'Scenarios') }
  ];
  const out = [];
  groups.forEach((group) => {
    if (!dirExists(group.dir)) return;
    const entries = fs.readdirSync(group.dir, { withFileTypes: true })
      .filter((d) => d.isFile() && /\.biq$/i.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    entries.forEach((fileName) => {
      out.push({
        source: group.source,
        fileName,
        name: fileName.replace(/\.biq$/i, ''),
        path: path.join(group.dir, fileName)
      });
    });
  });
  return out;
}

function looksLikeC3xFolder(dirPath) {
  return dirExists(dirPath) && fs.existsSync(path.join(dirPath, 'default.c3x_config.ini'));
}

function inferDefaultPaths(existing) {
  const next = { ...existing };

  // Backward compatibility: older settings stored a Conquests path directly.
  if (!next.civ3Path && next.civ3ConquestsPath) {
    const old = next.civ3ConquestsPath;
    if (path.basename(old).toLowerCase() === 'conquests') next.civ3Path = path.dirname(old);
    else next.civ3Path = old;
  }

  if (!looksLikeC3xFolder(next.c3xPath)) {
    const c3xCandidates = [
      path.join(__dirname, 'C3X'),
      path.join(path.dirname(__dirname), 'C3X'),
      __dirname,
      path.dirname(__dirname)
    ];
    const foundC3x = c3xCandidates.find((p) => looksLikeC3xFolder(p));
    if (foundC3x) {
      next.c3xPath = foundC3x;
    }
  }

  if (!dirExists(next.civ3Path)) {
    const appParent = path.dirname(__dirname);
    const appGrandParent = path.dirname(appParent);
    if (path.basename(appParent).toLowerCase() === 'conquests') {
      next.civ3Path = appGrandParent;
    } else if (path.basename(__dirname).toLowerCase() === 'conquests') {
      next.civ3Path = path.dirname(__dirname);
    } else if (looksLikeC3xFolder(next.c3xPath)) {
      const c3xParent = path.dirname(next.c3xPath);
      if (path.basename(c3xParent).toLowerCase() === 'conquests') {
        next.civ3Path = path.dirname(c3xParent);
      }
    }
  }

  return next;
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), APP_SETTINGS_FILE);
}

function findFirstExisting(paths) {
  return paths.find((p) => !!p && fs.existsSync(p)) || '';
}

function readJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getStandardGameBiqPath(civ3Path) {
  const root = resolveCiv3RootPath(civ3Path);
  return root ? path.join(root, 'Conquests', 'conquests.biq') : '';
}

let currentLogContextPayload = {
  mode: 'global',
  civ3Path: '',
  biqPath: ''
};

function applyLogContextFromPayload(payload) {
  const hasExplicitMode = !!(payload && Object.prototype.hasOwnProperty.call(payload, 'mode'));
  const mode = hasExplicitMode
    ? ((payload && payload.mode) || 'global')
    : (currentLogContextPayload.mode || 'global');
  const civ3Path = (payload && payload.civ3Path) || currentLogContextPayload.civ3Path || '';
  const biqPath = mode === 'scenario'
    ? ((payload && payload.scenarioPath) || currentLogContextPayload.biqPath || '')
    : getStandardGameBiqPath(civ3Path);
  currentLogContextPayload = { mode, civ3Path, biqPath };
  log.setContext({ mode, biqPath });
}

function getCurrentLogConfig() {
  return {
    enabled: currentWriteLogFiles,
    folder: currentLogFolder || getDefaultLogFolderUnsafe()
  };
}

function persistSettingsPatch(patch) {
  const settingsPath = getSettingsPath();
  const existing = readJsonIfExists(settingsPath, {});
  writeJson(settingsPath, {
    ...(existing || {}),
    ...(patch || {})
  });
}

async function openLogFolder() {
  const folder = currentLogFolder || getDefaultLogFolderUnsafe();
  if (!folder) return { ok: false, error: 'No log folder is configured.' };
  try {
    fs.mkdirSync(folder, { recursive: true });
    const openErr = await shell.openPath(folder);
    if (openErr) {
      log.warn('openLogFolder', `Shell error: ${openErr}`);
      return { ok: false, error: openErr };
    }
    log.info('openLogFolder', `Opened: ${log.rel(folder)}`);
    return { ok: true, folder };
  } catch (err) {
    log.error('openLogFolder', err && err.message ? err.message : 'Could not open log folder.');
    return { ok: false, error: err && err.message ? err.message : 'Could not open log folder.' };
  }
}

function createWindow() {
  const windowIcon = fs.existsSync(DEV_APP_ICON_PATH) ? DEV_APP_ICON_PATH : undefined;
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    title: 'Civ 3 | C3X Modern Editor',
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const openExternalUrl = (url) => {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) return false;
    shell.openExternal(target).catch(() => {});
    return true;
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (openExternalUrl(url)) {
      event.preventDefault();
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    const reason = String(details && details.reason || 'unknown');
    const exitCode = Number.isFinite(Number(details && details.exitCode)) ? Number(details.exitCode) : null;
    const extra = exitCode == null ? '' : ` (exit code ${exitCode})`;
    log.error('renderer', `Process gone: ${reason}${extra}`);
    if (!win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'error',
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
        title: APP_NAME,
        message: 'The app content crashed and had to stop rendering.',
        detail: 'Unsaved changes in the current session may be lost. Use View > Reload to restore the window. If this keeps happening, switch to Safe performance mode and send the debug log.'
      }).catch(() => {});
    }
  });
  win.webContents.on('unresponsive', () => {
    log.warn('renderer', 'Renderer became unresponsive.');
  });
  win.webContents.on('responsive', () => {
    log.info('renderer', 'Renderer became responsive again.');
  });

  // Forward main-process log entries to the renderer's in-app debug log panel.
  win.webContents.on('did-finish-load', () => {
    log.setForwarder((level, category, msg) => {
      if (!win.isDestroyed()) {
        win.webContents.send('manager:log', { level, category, msg });
      }
    });
  });
  win.on('closed', () => {
    log.setForwarder(null);
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

function sendOperationProgress(target, entry) {
  if (!target || target.isDestroyed()) return;
  target.send('manager:operation-progress', {
    ...entry,
    timestamp: Date.now()
  });
}

function runWorkerTask(task, payload, options = {}) {
  const onProgress = options && typeof options.onProgress === 'function'
    ? options.onProgress
    : null;
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'src', 'operationWorker.js'), {
      workerData: {
        task,
        payload: payload || {},
        logConfig: getCurrentLogConfig()
      }
    });
    let settled = false;
    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    worker.on('message', (message) => {
      const type = String(message && message.type || '').trim();
      if (type === 'progress') {
        if (onProgress) onProgress(message.entry || {});
        return;
      }
      if (type === 'result') {
        finishResolve(message.result);
        return;
      }
      if (type === 'error') {
        finishReject(new Error(String(message && message.error || 'Worker operation failed.')));
      }
    });
    worker.on('error', (err) => {
      finishReject(err);
    });
    worker.on('exit', (code) => {
      if (settled) return;
      if (code === 0) {
        finishReject(new Error(`Worker "${task}" exited without a result.`));
        return;
      }
      finishReject(new Error(`Worker "${task}" exited with code ${code}.`));
    });
  });
}

function sendPerformanceModeSelection(mode) {
  currentPerformanceMode = normalizePerformanceMode(mode);
  try {
    const settingsPath = getSettingsPath();
    const existing = readJsonIfExists(settingsPath, {});
    writeJson(settingsPath, {
      ...(existing || {}),
      performanceMode: currentPerformanceMode
    });
  } catch (_err) {
    // Best effort: renderer event below still applies mode for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:performance-mode-selected', currentPerformanceMode);
}

function sendQualityChecksSelection(enabled) {
  currentRunQualityChecks = normalizeRunQualityChecks(enabled);
  try {
    const settingsPath = getSettingsPath();
    const existing = readJsonIfExists(settingsPath, {});
    writeJson(settingsPath, {
      ...(existing || {}),
      runQualityChecks: currentRunQualityChecks
    });
  } catch (_err) {
    // Best effort: renderer event below still applies mode for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:quality-checks-selected', currentRunQualityChecks);
}

function sendReloadAfterSaveSelection(enabled) {
  currentReloadAfterSave = normalizeReloadAfterSave(enabled);
  try {
    persistSettingsPatch({ reloadAfterSave: currentReloadAfterSave });
  } catch (_err) {
    // Best effort: renderer event below still applies setting for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:reload-after-save-selected', currentReloadAfterSave);
}

function sendTooltipDelaySelection(value) {
  currentTooltipDelay = normalizeTooltipDelay(value);
  try {
    persistSettingsPatch({ tooltipDelay: currentTooltipDelay });
  } catch (_err) {
    // Best effort: renderer event below still applies setting for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:tooltip-delay-selected', currentTooltipDelay);
}

function sendAutoAddImportedResourceIconsSelection(enabled) {
  currentAutoAddImportedResourceIcons = normalizeAutoAddImportedResourceIcons(enabled);
  try {
    persistSettingsPatch({ autoAddImportedResourceIcons: currentAutoAddImportedResourceIcons });
  } catch (_err) {
    // Best effort: renderer event below still applies setting for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:resource-settings-selected', {
    autoAddImportedResourceIcons: currentAutoAddImportedResourceIcons
  });
}

function sendAutoAddImportedUnitIconsSelection(enabled) {
  currentAutoAddImportedUnitIcons = normalizeAutoAddImportedUnitIcons(enabled);
  try {
    persistSettingsPatch({ autoAddImportedUnitIcons: currentAutoAddImportedUnitIcons });
  } catch (_err) {
    // Best effort: renderer event below still applies setting for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:unit-settings-selected', {
    autoAddImportedUnitIcons: currentAutoAddImportedUnitIcons
  });
}

function sendAutoAddImportedBuildingCityIconsSelection(enabled) {
  currentAutoAddImportedBuildingCityIcons = normalizeAutoAddImportedBuildingCityIcons(enabled);
  try {
    persistSettingsPatch({ autoAddImportedBuildingCityIcons: currentAutoAddImportedBuildingCityIcons });
  } catch (_err) {
    // Best effort: renderer event below still applies setting for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:improvement-settings-selected', {
    autoAddImportedBuildingCityIcons: currentAutoAddImportedBuildingCityIcons
  });
}

function sendTextFileEncodingSelection(value) {
  currentTextFileEncoding = normalizeTextFileEncoding(value);
  try {
    const settingsPath = getSettingsPath();
    const existing = readJsonIfExists(settingsPath, {});
    writeJson(settingsPath, {
      ...(existing || {}),
      textFileEncoding: currentTextFileEncoding
    });
  } catch (_err) {
    // Best effort: renderer event below still applies mode for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:text-file-encoding-selected', currentTextFileEncoding);
}

function sendWriteLogFilesSelection(enabled) {
  currentWriteLogFiles = normalizeWriteLogFiles(enabled);
  log.configureFileLogging(getCurrentLogConfig());
  try {
    persistSettingsPatch({ writeLogFiles: currentWriteLogFiles, logFolder: currentLogFolder });
  } catch (_err) {
    // Best effort: renderer event below still applies mode for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:log-settings-selected', getCurrentLogConfig());
}

async function chooseLogFolder() {
  const result = await dialog.showOpenDialog({
    title: 'Choose Log Folder',
    defaultPath: currentLogFolder || getDefaultLogFolderUnsafe(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return;
  }
  currentLogFolder = normalizeLogFolder(result.filePaths[0]);
  log.configureFileLogging(getCurrentLogConfig());
  try {
    persistSettingsPatch({ writeLogFiles: currentWriteLogFiles, logFolder: currentLogFolder });
  } catch (_err) {
    // Best effort: renderer event below still applies folder for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:log-settings-selected', getCurrentLogConfig());
}

function resetLogFolder() {
  currentLogFolder = getDefaultLogFolderUnsafe();
  log.configureFileLogging(getCurrentLogConfig());
  try {
    persistSettingsPatch({ writeLogFiles: currentWriteLogFiles, logFolder: currentLogFolder });
  } catch (_err) {
    // Best effort: renderer event below still applies folder for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:log-settings-selected', getCurrentLogConfig());
}

function buildLogMenuItems() {
  return [
    {
      label: 'Write Debug Logs to Files',
      type: 'checkbox',
      checked: currentWriteLogFiles,
      click: (item) => sendWriteLogFilesSelection(item && item.checked)
    },
    { type: 'separator' },
    {
      label: 'Open Log Folder',
      click: () => { openLogFolder().catch((err) => log.error('openLogFolder', err && err.message)); }
    },
    {
      label: 'Choose Log Folder...',
      click: () => { chooseLogFolder().catch((err) => log.error('chooseLogFolder', err && err.message)); }
    },
    {
      label: 'Reset Log Folder to Default',
      click: resetLogFolder
    }
  ];
}

function sendMapAutoDockTileInfoLeftSelection(enabled) {
  currentMapAutoDockTileInfoLeft = normalizeMapAutoDockTileInfoLeft(enabled);
  try {
    persistSettingsPatch({ mapAutoDockTileInfoLeft: currentMapAutoDockTileInfoLeft });
  } catch (_err) {
    // Best effort: renderer event below still applies setting for active session.
  }
  buildAppMenu();
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send('manager:map-settings-selected', {
    mapAutoDockTileInfoLeft: currentMapAutoDockTileInfoLeft
  });
}

function normalizeScenarioOptionMenuState(raw) {
  const next = raw && typeof raw === 'object' ? raw : {};
  return {
    visible: !!next.visible,
    enabled: !!next.enabled,
    customRulesEnabled: !!next.customRulesEnabled,
    customPlayerDataEnabled: !!next.customPlayerDataEnabled
  };
}

function sendScenarioOptionToggle(channel) {
  const target = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;
  target.webContents.send(channel);
}

function buildAppMenu() {
  const fileMenu = {
    label: 'File',
    submenu: [
      {
        label: 'Enable Custom Rules',
        type: 'checkbox',
        visible: currentScenarioOptionMenuState.visible,
        enabled: currentScenarioOptionMenuState.enabled,
        checked: currentScenarioOptionMenuState.customRulesEnabled,
        click: () => sendScenarioOptionToggle('manager:toggle-custom-rules')
      },
      {
        label: 'Enable Custom Player Data',
        type: 'checkbox',
        visible: currentScenarioOptionMenuState.visible,
        enabled: currentScenarioOptionMenuState.enabled,
        checked: currentScenarioOptionMenuState.customPlayerDataEnabled,
        click: () => sendScenarioOptionToggle('manager:toggle-custom-player-data')
      },
      { type: 'separator', visible: currentScenarioOptionMenuState.visible },
      {
        label: 'Settings',
        submenu: [
          {
            label: 'Run Quality Checks After Load',
            type: 'checkbox',
            checked: currentRunQualityChecks,
            click: (item) => sendQualityChecksSelection(item && item.checked)
          },
          {
            label: 'Reload After Save',
            type: 'checkbox',
            checked: currentReloadAfterSave,
            click: (item) => sendReloadAfterSaveSelection(item && item.checked)
          },
          {
            label: 'Tooltips',
            submenu: [
              { label: 'No Delay', type: 'radio', checked: currentTooltipDelay === 'none', click: () => sendTooltipDelaySelection('none') },
              { label: 'Short Delay - 300ms', type: 'radio', checked: currentTooltipDelay === 'short', click: () => sendTooltipDelaySelection('short') },
              { label: 'Medium Delay - 800ms', type: 'radio', checked: currentTooltipDelay === 'medium', click: () => sendTooltipDelaySelection('medium') },
              { label: 'Long Delay - 2s', type: 'radio', checked: currentTooltipDelay === 'long', click: () => sendTooltipDelaySelection('long') },
              { label: 'Never Show', type: 'radio', checked: currentTooltipDelay === 'off', click: () => sendTooltipDelaySelection('off') }
            ]
          },
          {
            label: 'Logging',
            submenu: buildLogMenuItems()
          },
          {
            label: 'Map',
            submenu: [
              {
                label: 'Auto-Dock Tile Info Left Near Right Edge',
                type: 'checkbox',
                checked: currentMapAutoDockTileInfoLeft,
                click: (item) => sendMapAutoDockTileInfoLeftSelection(item && item.checked)
              }
            ]
          },
          {
            label: 'Resources',
            submenu: [
              {
                label: 'Automatically Add Imported Resource Icons to resources.pcx',
                type: 'checkbox',
                checked: currentAutoAddImportedResourceIcons,
                click: (item) => sendAutoAddImportedResourceIconsSelection(item && item.checked)
              }
            ]
          },
          {
            label: 'Units',
            submenu: [
              {
                label: 'Automatically Add Imported Unit Icons to units_32.pcx',
                type: 'checkbox',
                checked: currentAutoAddImportedUnitIcons,
                click: (item) => sendAutoAddImportedUnitIconsSelection(item && item.checked)
              }
            ]
          },
          {
            label: 'Improvements',
            submenu: [
              {
                label: 'Automatically Add Imported City Icons to buildings PCX Files',
                type: 'checkbox',
                checked: currentAutoAddImportedBuildingCityIcons,
                click: (item) => sendAutoAddImportedBuildingCityIconsSelection(item && item.checked)
              }
            ]
          },
          { type: 'separator' },
          {
            label: 'Performance',
            submenu: [
              {
                label: 'High',
                type: 'radio',
                checked: currentPerformanceMode === 'high',
                click: () => sendPerformanceModeSelection('high')
              },
              {
                label: 'Safe',
                type: 'radio',
                checked: currentPerformanceMode === 'safe',
                click: () => sendPerformanceModeSelection('safe')
              }
            ]
          },
          {
            label: 'Text File Encoding',
            submenu: [
              { label: 'Auto Detect', type: 'radio', checked: currentTextFileEncoding === 'auto', click: () => sendTextFileEncodingSelection('auto') },
              { label: 'Windows-1252', type: 'radio', checked: currentTextFileEncoding === 'windows-1252', click: () => sendTextFileEncodingSelection('windows-1252') },
              { label: 'Windows-1251', type: 'radio', checked: currentTextFileEncoding === 'windows-1251', click: () => sendTextFileEncodingSelection('windows-1251') },
              { label: 'GBK / CP936', type: 'radio', checked: currentTextFileEncoding === 'gbk', click: () => sendTextFileEncodingSelection('gbk') },
              { label: 'Big5 / CP950', type: 'radio', checked: currentTextFileEncoding === 'big5', click: () => sendTextFileEncodingSelection('big5') },
              { label: 'Shift-JIS / CP932', type: 'radio', checked: currentTextFileEncoding === 'shift_jis', click: () => sendTextFileEncodingSelection('shift_jis') },
              { label: 'EUC-KR / CP949', type: 'radio', checked: currentTextFileEncoding === 'euc-kr', click: () => sendTextFileEncodingSelection('euc-kr') },
              { label: 'UTF-8', type: 'radio', checked: currentTextFileEncoding === 'utf8', click: () => sendTextFileEncodingSelection('utf8') }
            ]
          }
        ]
      },
      process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
    ]
  };

  const appMenu = {
    label: APP_NAME,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  };

  const template = [
    ...(process.platform === 'darwin' ? [appMenu] : []),
    fileMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  applyAppIdentity();
  log.info('App', `C3X Config Manager v${app.getVersion()} starting on ${process.platform} (perf=${startupPerformanceMode})`);
  if (process.platform === 'darwin' && fs.existsSync(DEV_APP_ICON_PATH)) {
    app.dock.setIcon(nativeImage.createFromPath(DEV_APP_ICON_PATH));
  }
  buildAppMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('manager:get-encoded-byte-length', (event, payload) => {
  try {
    event.returnValue = getEncodedByteLength(payload && payload.text, payload && payload.encoding);
  } catch (_err) {
    event.returnValue = String(payload && payload.text || '').length;
  }
});

ipcMain.on('manager:clip-text-to-encoded-byte-limit', (event, payload) => {
  try {
    event.returnValue = clipTextToEncodedByteLimit(payload && payload.text, payload && payload.maxBytes, payload && payload.encoding);
  } catch (_err) {
    event.returnValue = String(payload && payload.text || '').slice(0, Math.max(0, Number(payload && payload.maxBytes) || 0));
  }
});

ipcMain.handle('manager:get-settings', async () => {
  const defaults = {
    c3xPath: '',
    civ3Path: '',
    scenarioPath: '',
    mode: 'global',
    textFileEncoding: 'auto',
    performanceMode: 'high',
    runQualityChecks: true,
    reloadAfterSave: false,
    tooltipDelay: 'medium',
    autoAddImportedResourceIcons: true,
    autoAddImportedUnitIcons: true,
    autoAddImportedBuildingCityIcons: true,
    autoUpdateScienceAdvisorArrows: false,
    mapAutoDockTileInfoLeft: true,
    writeLogFiles: true,
    logFolder: getDefaultLogFolderUnsafe(),
    uiFontScale: 1,
    uiStateByContext: {},
    c3xVersion: SUPPORTED_C3X_RELEASE
  };
  const saved = readJsonIfExists(getSettingsPath(), defaults);
  const merged = { ...defaults, ...(saved || {}) };
  merged.performanceMode = normalizePerformanceMode(merged.performanceMode);
  merged.runQualityChecks = normalizeRunQualityChecks(merged.runQualityChecks);
  merged.reloadAfterSave = normalizeReloadAfterSave(merged.reloadAfterSave);
  merged.tooltipDelay = normalizeTooltipDelay(merged.tooltipDelay);
  merged.autoAddImportedResourceIcons = normalizeAutoAddImportedResourceIcons(merged.autoAddImportedResourceIcons);
  merged.autoAddImportedUnitIcons = normalizeAutoAddImportedUnitIcons(merged.autoAddImportedUnitIcons);
  merged.autoAddImportedBuildingCityIcons = normalizeAutoAddImportedBuildingCityIcons(merged.autoAddImportedBuildingCityIcons);
  merged.autoUpdateScienceAdvisorArrows = normalizeAutoUpdateScienceAdvisorArrows(merged.autoUpdateScienceAdvisorArrows);
  merged.textFileEncoding = normalizeTextFileEncoding(merged.textFileEncoding);
  merged.mapAutoDockTileInfoLeft = normalizeMapAutoDockTileInfoLeft(merged.mapAutoDockTileInfoLeft);
  merged.writeLogFiles = normalizeWriteLogFiles(merged.writeLogFiles);
  merged.logFolder = normalizeLogFolder(merged.logFolder);
  merged.c3xVersion = normalizeC3xVersion(merged.c3xVersion);
  const inferred = inferDefaultPaths(merged);
  inferred.performanceMode = normalizePerformanceMode(inferred.performanceMode);
  inferred.runQualityChecks = normalizeRunQualityChecks(inferred.runQualityChecks);
  inferred.reloadAfterSave = normalizeReloadAfterSave(inferred.reloadAfterSave);
  inferred.tooltipDelay = normalizeTooltipDelay(inferred.tooltipDelay);
  inferred.autoAddImportedResourceIcons = normalizeAutoAddImportedResourceIcons(inferred.autoAddImportedResourceIcons);
  inferred.autoAddImportedUnitIcons = normalizeAutoAddImportedUnitIcons(inferred.autoAddImportedUnitIcons);
  inferred.autoAddImportedBuildingCityIcons = normalizeAutoAddImportedBuildingCityIcons(inferred.autoAddImportedBuildingCityIcons);
  inferred.autoUpdateScienceAdvisorArrows = normalizeAutoUpdateScienceAdvisorArrows(inferred.autoUpdateScienceAdvisorArrows);
  inferred.textFileEncoding = normalizeTextFileEncoding(inferred.textFileEncoding);
  inferred.mapAutoDockTileInfoLeft = normalizeMapAutoDockTileInfoLeft(inferred.mapAutoDockTileInfoLeft);
  inferred.writeLogFiles = normalizeWriteLogFiles(inferred.writeLogFiles);
  inferred.logFolder = normalizeLogFolder(inferred.logFolder);
  currentPerformanceMode = inferred.performanceMode;
  currentRunQualityChecks = inferred.runQualityChecks;
  currentReloadAfterSave = inferred.reloadAfterSave;
  currentTooltipDelay = inferred.tooltipDelay;
  currentAutoAddImportedResourceIcons = inferred.autoAddImportedResourceIcons;
  currentAutoAddImportedUnitIcons = inferred.autoAddImportedUnitIcons;
  currentAutoAddImportedBuildingCityIcons = inferred.autoAddImportedBuildingCityIcons;
  currentAutoUpdateScienceAdvisorArrows = inferred.autoUpdateScienceAdvisorArrows;
  currentTextFileEncoding = inferred.textFileEncoding;
  currentMapAutoDockTileInfoLeft = inferred.mapAutoDockTileInfoLeft;
  currentWriteLogFiles = inferred.writeLogFiles;
  currentLogFolder = inferred.logFolder;
  log.configureFileLogging(getCurrentLogConfig());
  buildAppMenu();

  // Update log root so subsequent rel() calls use the right base
  log.setCiv3Root(inferred.civ3Path || '');
  applyLogContextFromPayload(inferred);
  const c3xValid = looksLikeC3xFolder(inferred.c3xPath);
  const civ3Valid = !!inferred.civ3Path && dirExists(inferred.civ3Path);
  log.info('settings', `mode=${inferred.mode}, version=${inferred.c3xVersion}, perf=${inferred.performanceMode}, qc=${inferred.runQualityChecks ? 'on' : 'off'}, reloadAfterSave=${inferred.reloadAfterSave ? 'on' : 'off'}, tooltipDelay=${inferred.tooltipDelay}, autoResourceIcons=${inferred.autoAddImportedResourceIcons ? 'on' : 'off'}, autoUnitIcons=${inferred.autoAddImportedUnitIcons ? 'on' : 'off'}, autoBuildingCityIcons=${inferred.autoAddImportedBuildingCityIcons ? 'on' : 'off'}, autoScienceArrows=${inferred.autoUpdateScienceAdvisorArrows ? 'on' : 'off'}`);
  log.info('settings', `c3xPath=${log.rel(inferred.c3xPath)} [${c3xValid ? 'OK' : 'NOT FOUND'}]`);
  log.info('settings', `civ3Path=${log.rel(inferred.civ3Path)} [${civ3Valid ? 'OK' : 'NOT FOUND'}]`);
  if (inferred.mode === 'scenario') {
    log.info('settings', `scenarioPath=${log.rel(inferred.scenarioPath)}`);
  }
  if (JSON.stringify(merged) !== JSON.stringify(inferred)) {
    log.info('settings', 'Paths inferred from install location and persisted.');
    writeJson(getSettingsPath(), inferred);
  }
  return inferred;
});

ipcMain.handle('manager:set-settings', async (_event, settings) => {
  const normalized = {
    ...(settings || {}),
    performanceMode: normalizePerformanceMode(settings && settings.performanceMode),
    runQualityChecks: normalizeRunQualityChecks(settings && settings.runQualityChecks),
    reloadAfterSave: normalizeReloadAfterSave(settings && settings.reloadAfterSave),
    tooltipDelay: normalizeTooltipDelay(settings && settings.tooltipDelay),
    autoAddImportedResourceIcons: normalizeAutoAddImportedResourceIcons(settings && settings.autoAddImportedResourceIcons),
    autoAddImportedUnitIcons: normalizeAutoAddImportedUnitIcons(settings && settings.autoAddImportedUnitIcons),
    autoAddImportedBuildingCityIcons: normalizeAutoAddImportedBuildingCityIcons(settings && settings.autoAddImportedBuildingCityIcons),
    autoUpdateScienceAdvisorArrows: normalizeAutoUpdateScienceAdvisorArrows(settings && settings.autoUpdateScienceAdvisorArrows),
    textFileEncoding: normalizeTextFileEncoding(settings && settings.textFileEncoding),
    c3xVersion: normalizeC3xVersion(settings && settings.c3xVersion),
    mapAutoDockTileInfoLeft: normalizeMapAutoDockTileInfoLeft(settings && settings.mapAutoDockTileInfoLeft),
    writeLogFiles: normalizeWriteLogFiles(settings && settings.writeLogFiles),
    logFolder: normalizeLogFolder(settings && settings.logFolder)
  };
  log.setCiv3Root(normalized.civ3Path || '');
  applyLogContextFromPayload(normalized);
  log.configureFileLogging({ enabled: normalized.writeLogFiles, folder: normalized.logFolder });
  log.info('settings', `Saving: mode=${normalized.mode}, version=${normalized.c3xVersion}, perf=${normalized.performanceMode}, qc=${normalized.runQualityChecks ? 'on' : 'off'}, reloadAfterSave=${normalized.reloadAfterSave ? 'on' : 'off'}, tooltipDelay=${normalized.tooltipDelay}, autoResourceIcons=${normalized.autoAddImportedResourceIcons ? 'on' : 'off'}, autoUnitIcons=${normalized.autoAddImportedUnitIcons ? 'on' : 'off'}, autoBuildingCityIcons=${normalized.autoAddImportedBuildingCityIcons ? 'on' : 'off'}, autoScienceArrows=${normalized.autoUpdateScienceAdvisorArrows ? 'on' : 'off'}`);
  log.info('settings', `c3xPath=${log.rel(normalized.c3xPath)}, civ3Path=${log.rel(normalized.civ3Path)}`);
  if (normalized.mode === 'scenario') {
    log.info('settings', `scenarioPath=${log.rel(normalized.scenarioPath)}`);
  }
  writeJson(getSettingsPath(), normalized);
  if (currentPerformanceMode !== normalized.performanceMode) {
    log.info('settings', `Performance mode changed: ${currentPerformanceMode} -> ${normalized.performanceMode}`);
    currentPerformanceMode = normalized.performanceMode;
    buildAppMenu();
  }
  if (currentRunQualityChecks !== normalized.runQualityChecks) {
    currentRunQualityChecks = normalized.runQualityChecks;
    buildAppMenu();
  }
  if (currentReloadAfterSave !== normalized.reloadAfterSave) {
    currentReloadAfterSave = normalized.reloadAfterSave;
    buildAppMenu();
  }
  if (currentTooltipDelay !== normalized.tooltipDelay) {
    currentTooltipDelay = normalized.tooltipDelay;
    buildAppMenu();
  }
  if (currentAutoAddImportedResourceIcons !== normalized.autoAddImportedResourceIcons) {
    currentAutoAddImportedResourceIcons = normalized.autoAddImportedResourceIcons;
    buildAppMenu();
  }
  if (currentAutoAddImportedUnitIcons !== normalized.autoAddImportedUnitIcons) {
    currentAutoAddImportedUnitIcons = normalized.autoAddImportedUnitIcons;
    buildAppMenu();
  }
  if (currentAutoAddImportedBuildingCityIcons !== normalized.autoAddImportedBuildingCityIcons) {
    currentAutoAddImportedBuildingCityIcons = normalized.autoAddImportedBuildingCityIcons;
    buildAppMenu();
  }
  if (currentAutoUpdateScienceAdvisorArrows !== normalized.autoUpdateScienceAdvisorArrows) {
    currentAutoUpdateScienceAdvisorArrows = normalized.autoUpdateScienceAdvisorArrows;
    buildAppMenu();
  }
  if (currentTextFileEncoding !== normalized.textFileEncoding) {
    currentTextFileEncoding = normalized.textFileEncoding;
    buildAppMenu();
  }
  if (currentMapAutoDockTileInfoLeft !== normalized.mapAutoDockTileInfoLeft) {
    currentMapAutoDockTileInfoLeft = normalized.mapAutoDockTileInfoLeft;
    buildAppMenu();
  }
  if (currentWriteLogFiles !== normalized.writeLogFiles || currentLogFolder !== normalized.logFolder) {
    currentWriteLogFiles = normalized.writeLogFiles;
    currentLogFolder = normalized.logFolder;
    log.configureFileLogging(getCurrentLogConfig());
    buildAppMenu();
  }
  return { ok: true };
});

ipcMain.handle('manager:pick-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('manager:pick-file', async (_event, options) => {
  const dialogOptions = {
    properties: ['openFile']
  };
  if (options && Array.isArray(options.filters) && options.filters.length > 0) {
    dialogOptions.filters = options.filters;
  }
  if (options && typeof options.defaultPath === 'string' && options.defaultPath.trim()) {
    dialogOptions.defaultPath = options.defaultPath.trim();
  }
  const result = await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('manager:open-file-path', async (_event, filePath) => {
  const target = String(filePath || '').trim();
  if (!target) return { ok: false, error: 'No file path provided.' };
  try {
    if (!fs.existsSync(target)) {
      log.warn('openFilePath', `Not found: ${log.rel(target)}`);
      return { ok: false, error: 'File does not exist.' };
    }
    const openErr = await shell.openPath(target);
    if (openErr) {
      log.warn('openFilePath', `Shell error for ${log.rel(target)}: ${openErr}`);
      return { ok: false, error: openErr };
    }
    log.info('openFilePath', `Opened: ${log.rel(target)}`);
    return { ok: true };
  } catch (err) {
    log.error('openFilePath', `${log.rel(target)}: ${err && err.message}`);
    return { ok: false, error: err && err.message ? err.message : 'Could not open file.' };
  }
});

ipcMain.handle('manager:open-log-folder', async () => {
  return openLogFolder();
});

ipcMain.handle('manager:path-exists', async (_event, dirPath) => {
  return pathExists(dirPath);
});

ipcMain.handle('manager:get-path-access', async (_event, paths) => {
  const out = {};
  const list = Array.isArray(paths) ? paths : [];
  const findNearestExistingParent = (absPath) => {
    let cursor = path.dirname(absPath);
    while (cursor && cursor !== path.dirname(cursor)) {
      if (fs.existsSync(cursor)) return cursor;
      cursor = path.dirname(cursor);
    }
    if (cursor && fs.existsSync(cursor)) return cursor;
    return '';
  };
  list.forEach((raw) => {
    const target = String(raw || '').trim();
    if (!target) return;
    try {
      const resolved = path.resolve(target);
      const exists = fs.existsSync(resolved);
      let writable = false;
      let parentPath = '';
      let parentWritable = false;
      if (exists) {
        try {
          fs.accessSync(resolved, fs.constants.W_OK);
          writable = true;
        } catch (_err) {
          writable = false;
        }
      } else {
        parentPath = findNearestExistingParent(resolved);
        if (parentPath) {
          try {
            fs.accessSync(parentPath, fs.constants.W_OK);
            parentWritable = true;
          } catch (_err) {
            parentWritable = false;
          }
        }
      }
      out[target] = {
        exists,
        writable,
        readOnly: exists && !writable,
        parentPath,
        parentWritable
      };
    } catch (err) {
      out[target] = { exists: false, writable: false, readOnly: false, error: err.message };
    }
  });
  return out;
});

ipcMain.handle('manager:list-scenarios', async (_event, civ3Path) => {
  try {
    const scenarios = listKnownScenarios(civ3Path);
    log.info('listScenarios', `Found ${scenarios.length} scenario(s) under ${log.rel(civ3Path)}`);
    return scenarios;
  } catch (err) {
    log.error('listScenarios', `Failed: ${err.message}`);
    return [];
  }
});

ipcMain.handle('manager:create-scenario', async (_event, payload) => {
  applyLogContextFromPayload(payload || {});
  log.info('createScenario', `template=${payload && payload.template}, name="${payload && payload.scenarioName}"`);
  const result = await runWorkerTask('createScenario', payload || {}, {
    onProgress: payload && payload.dryRun
      ? null
      : (entry) => sendOperationProgress(_event.sender, {
        operation: 'createScenario',
        ...entry
      })
  });
  if (result && result.ok) {
    log.info('createScenario', `Created: ${log.rel(result.path)}`);
  } else {
    log.warn('createScenario', `Failed: ${result && result.error}`);
  }
  return result;
});

ipcMain.handle('manager:delete-scenario', async (_event, payload) => {
  applyLogContextFromPayload(payload || {});
  log.info('deleteScenario', `scenario=${log.rel(payload && payload.scenarioPath)}`);
  const result = await runWorkerTask('deleteScenario', payload || {}, {
    onProgress: payload && payload.dryRun
      ? null
      : (entry) => sendOperationProgress(_event.sender, {
        operation: 'deleteScenario',
        ...entry
      })
  });
  if (result && result.ok) {
    const deleted = Array.isArray(result.deleteResults) ? result.deleteResults.filter((entry) => entry && entry.status === 'deleted') : [];
    log.info('deleteScenario', `Deleted OK: ${deleted.map((entry) => log.rel(entry.path)).join(', ')}`);
  } else {
    log.warn('deleteScenario', `Failed: ${result && result.error}`);
    if (result && result.rollback) {
      log.warn('deleteScenario', `Rollback: attempted=${result.rollback.attempted}, failed=${result.rollback.failed}`);
    }
  }
  return result;
});

ipcMain.handle('manager:relaunch', async () => {
  app.relaunch();
  app.exit(0);
  return { ok: true };
});

ipcMain.handle('manager:load-bundle', async (_event, payload) => {
  const mode = (payload && payload.mode) || 'global';
  log.setCiv3Root(payload && payload.civ3Path || '');
  applyLogContextFromPayload(payload || {});
  log.info('loadBundle', `mode=${mode}, c3x=${log.rel(payload && payload.c3xPath)}, civ3=${log.rel(payload && payload.civ3Path)}`);
  if (mode === 'scenario') {
    log.info('loadBundle', `scenario=${log.rel(payload && payload.scenarioPath)}`);
  }
  try {
    const bundle = loadBundle(payload || {});
    const tabKeys = bundle && bundle.tabs ? Object.keys(bundle.tabs) : [];
    log.info('loadBundle', `OK — tabs=[${tabKeys.join(', ')}], readFiles=${bundle && Array.isArray(bundle.readFiles) ? bundle.readFiles.length : 0}`);
    return bundle;
  } catch (err) {
    log.error('loadBundle', `Threw: ${err.message}`);
    throw err;
  }
});

ipcMain.handle('manager:materialize-map-tab', async (_event, payload) => {
  applyLogContextFromPayload(payload || {});
  try {
    const tab = materializeMapTab(payload || {});
    const sectionCount = Array.isArray(tab && tab.sections) ? tab.sections.length : 0;
    log.info('materializeMapTab', `OK — sections=${sectionCount}, hasMapData=${tab && tab.hasMapData ? 'yes' : 'no'}`);
    return tab;
  } catch (err) {
    log.error('materializeMapTab', `Threw: ${err.message}`);
    throw err;
  }
});

ipcMain.handle('manager:load-map-import', async (_event, payload) => {
  const mode = 'scenario';
  log.setCiv3Root(payload && payload.civ3Path || '');
  applyLogContextFromPayload({ ...(payload || {}), mode });
  log.info('loadMapImport', `scenario=${log.rel(payload && payload.scenarioPath)}`);
  try {
    const result = await runWorkerTask('loadMapImport', { ...(payload || {}), mode });
    log.info('loadMapImport', `OK — ${result && result.width || 0}x${result && result.height || 0}, tiles=${result && result.tileCount || 0}, durationMs=${result && result.durationMs || 0}`);
    return result;
  } catch (err) {
    log.error('loadMapImport', `Threw: ${err.message}`);
    throw err;
  }
});

ipcMain.handle('manager:save-bundle', async (_event, payload) => {
  const mode = (payload && payload.mode) || 'global';
  log.setCiv3Root(payload && payload.civ3Path || '');
  applyLogContextFromPayload(payload || {});
  const dirtyTabs = Array.isArray(payload && payload.dirtyTabs) ? payload.dirtyTabs : [];
  log.info('saveBundle', `mode=${mode}, dirtyTabs=[${dirtyTabs.join(', ')}]`);
  const result = await runWorkerTask('saveBundle', payload || {}, {
    onProgress: (entry) => sendOperationProgress(_event.sender, {
      operation: 'save',
      ...entry
    })
  });
  if (result && result.ok) {
    const written = Array.isArray(result.writeResults) ? result.writeResults : [];
    const savedPaths = written.filter((r) => r.status === 'saved').map((r) => log.rel(r.path));
    log.info('saveBundle', `OK — wrote ${savedPaths.length} file(s): [${savedPaths.join(', ')}]`);
  } else {
    log.error('saveBundle', `Failed: ${result && result.error}`);
    if (result && result.rollback) {
      log.warn('saveBundle', `Rollback: attempted=${result.rollback.attempted}, failed=${result.rollback.failed}`);
    }
  }
  return result;
});

ipcMain.handle('manager:validate-bundle', async (_event, payload) => {
  const mode = (payload && payload.mode) || 'global';
  log.setCiv3Root(payload && payload.civ3Path || '');
  applyLogContextFromPayload(payload || {});
  log.info('validateBundle', `mode=${mode}, c3x=${log.rel(payload && payload.c3xPath)}, civ3=${log.rel(payload && payload.civ3Path)}`);
  if (mode === 'scenario') {
    log.info('validateBundle', `scenario=${log.rel(payload && payload.scenarioPath)}`);
  }
  const result = await runWorkerTask('validateBundle', payload || {});
  log.info('validateBundle', `OK — warnings=${Number(result && result.totalWarnings || 0)}`);
  return result;
});

ipcMain.handle('manager:update-scenario-option-menu-state', async (_event, payload) => {
  currentScenarioOptionMenuState = normalizeScenarioOptionMenuState(payload);
  buildAppMenu();
  return { ok: true };
});

ipcMain.handle('manager:preview-save-plan', async (_event, payload) => {
  applyLogContextFromPayload(payload || {});
  const result = previewSavePlan(payload || {});
  if (result && result.ok && Array.isArray(result.writes)) {
    log.debug('previewSavePlan', `${result.writes.length} pending write(s): [${result.writes.map((w) => log.rel(w.path)).join(', ')}]`);
  } else if (result && !result.ok) {
    log.warn('previewSavePlan', `Failed: ${result.error}`);
  }
  return result;
});

ipcMain.handle('manager:preview-file-diff', async (_event, payload) => {
  applyLogContextFromPayload(payload || {});
  return previewFileDiff(payload || {});
});

ipcMain.handle('manager:get-preview', async (_event, payload) => {
  applyLogContextFromPayload(payload || {});
  const kind = payload && payload.kind;
  try {
    const result = getPreview(payload || {});
    if (!result || !result.ok) {
      log.warn('getPreview', `kind=${kind} — not found: ${result && result.error}`);
    }
    return result;
  } catch (err) {
    log.error('getPreview', `kind=${kind} threw: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

ipcMain.on('manager:renderer-debug-log', (_event, entry) => {
  try {
    const payload = entry && typeof entry === 'object' ? entry : {};
    const level = String(payload.level || 'debug').trim().toLowerCase();
    const category = String(payload.category || 'renderer-debug').trim() || 'renderer-debug';
    const msg = String(payload.msg || '').trim();
    if (!msg) return;
    if (level === 'error') log.error(category, msg);
    else if (level === 'warn' || level === 'warning') log.warn(category, msg);
    else if (level === 'info') log.info(category, msg);
    else log.debug(category, msg);
  } catch (_err) {}
});
