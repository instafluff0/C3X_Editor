const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');

const { saveBundle, createScenario, deleteScenario, loadMapImport } = require('./configCore');
const { auditBundle } = require('./bundleAudit');
const { inspectCivAdvisorSaveFile } = require('./biq/civAdvisor');
const log = require('./log');

function resolveCiv3RootPath(civ3Path) {
  if (!civ3Path) return '';
  const base = path.basename(civ3Path).toLowerCase();
  if (base === 'conquests' || base === 'civ3ptw') {
    return path.dirname(civ3Path);
  }
  return civ3Path;
}

function getStandardGameBiqPath(civ3Path) {
  const root = resolveCiv3RootPath(civ3Path);
  return root ? path.join(root, 'Conquests', 'conquests.biq') : '';
}

function configureLogging(payload) {
  const logConfig = workerData && workerData.logConfig ? workerData.logConfig : {};
  log.configureFileLogging({
    enabled: logConfig.enabled !== false,
    folder: logConfig.folder || ''
  });
  log.setCiv3Root(payload && payload.civ3Path || '');
  const mode = payload && payload.mode || 'global';
  const biqPath = mode === 'scenario'
    ? (payload && payload.scenarioPath || '')
    : getStandardGameBiqPath(payload && payload.civ3Path || '');
  log.setContext({ mode, biqPath });
}

function postMessage(type, payload = {}) {
  if (!parentPort) return;
  parentPort.postMessage({ type, ...payload });
}

function run() {
  if (!parentPort) return;
  const task = String(workerData && workerData.task || '').trim();
  const payload = workerData && workerData.payload ? workerData.payload : {};
  configureLogging(payload);
  const onProgress = (entry) => {
    postMessage('progress', { entry });
  };

  try {
    let result;
    if (task === 'saveBundle') {
      result = saveBundle(payload, { onProgress });
    } else if (task === 'createScenario') {
      result = createScenario(payload, {
        onProgress: payload && payload.dryRun ? null : onProgress
      });
    } else if (task === 'deleteScenario') {
      result = deleteScenario(payload, {
        onProgress: payload && payload.dryRun ? null : onProgress
      });
    } else if (task === 'loadMapImport') {
      result = loadMapImport(payload);
    } else if (task === 'validateBundle') {
      result = auditBundle(payload);
    } else if (task === 'inspectCivAdvisorSave') {
      result = inspectCivAdvisorSaveFile(payload && (payload.filePath || payload.path), {
        selectedPlayerID: payload && payload.selectedPlayerID,
        districtAlertContext: payload && payload.districtAlertContext
      });
    } else {
      throw new Error(`Unknown worker task: ${task || '(empty)'}`);
    }
    postMessage('result', { result });
  } catch (err) {
    postMessage('error', {
      error: err && err.message ? String(err.message) : 'Worker operation failed.'
    });
  }
}

run();
