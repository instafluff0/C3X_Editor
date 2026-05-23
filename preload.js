const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('c3xManager', {
  getSettings: () => ipcRenderer.invoke('manager:get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('manager:set-settings', settings),
  pickDirectory: () => ipcRenderer.invoke('manager:pick-directory'),
  pickFile: (options) => ipcRenderer.invoke('manager:pick-file', options),
  getPathForFile: (file) => {
    if (!file || !webUtils || typeof webUtils.getPathForFile !== 'function') return '';
    try {
      return webUtils.getPathForFile(file);
    } catch (_err) {
      return '';
    }
  },
  openFilePath: (filePath) => ipcRenderer.invoke('manager:open-file-path', filePath),
  openLogFolder: () => ipcRenderer.invoke('manager:open-log-folder'),
  pathExists: (dirPath) => ipcRenderer.invoke('manager:path-exists', dirPath),
  getPathAccess: (paths) => ipcRenderer.invoke('manager:get-path-access', paths),
  listScenarios: (civ3Path) => ipcRenderer.invoke('manager:list-scenarios', civ3Path),
  createScenario: (payload) => ipcRenderer.invoke('manager:create-scenario', payload),
  deleteScenario: (payload) => ipcRenderer.invoke('manager:delete-scenario', payload),
  relaunch: () => ipcRenderer.invoke('manager:relaunch'),
  onPerformanceModeMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, mode) => handler(mode);
    ipcRenderer.on('manager:performance-mode-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:performance-mode-selected', listener);
    };
  },
  onQualityChecksMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, enabled) => handler(enabled);
    ipcRenderer.on('manager:quality-checks-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:quality-checks-selected', listener);
    };
  },
  onReloadAfterSaveMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, enabled) => handler(enabled);
    ipcRenderer.on('manager:reload-after-save-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:reload-after-save-selected', listener);
    };
  },
  onTextFileEncodingMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, encoding) => handler(encoding);
    ipcRenderer.on('manager:text-file-encoding-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:text-file-encoding-selected', listener);
    };
  },
  onLogSettingsMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, settings) => handler(settings);
    ipcRenderer.on('manager:log-settings-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:log-settings-selected', listener);
    };
  },
  onMapSettingsMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, settings) => handler(settings);
    ipcRenderer.on('manager:map-settings-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:map-settings-selected', listener);
    };
  },
  onCustomRulesMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = () => handler();
    ipcRenderer.on('manager:toggle-custom-rules', listener);
    return () => {
      ipcRenderer.removeListener('manager:toggle-custom-rules', listener);
    };
  },
  onCustomPlayerDataMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = () => handler();
    ipcRenderer.on('manager:toggle-custom-player-data', listener);
    return () => {
      ipcRenderer.removeListener('manager:toggle-custom-player-data', listener);
    };
  },
  onLog: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on('manager:log', listener);
    return () => {
      ipcRenderer.removeListener('manager:log', listener);
    };
  },
  onOperationProgress: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, entry) => handler(entry);
    ipcRenderer.on('manager:operation-progress', listener);
    return () => {
      ipcRenderer.removeListener('manager:operation-progress', listener);
    };
  },
  getPreview: (payload) => ipcRenderer.invoke('manager:get-preview', payload),
  emitRendererDebugLog: (entry) => ipcRenderer.send('manager:renderer-debug-log', entry),
  loadBundle: (payload) => ipcRenderer.invoke('manager:load-bundle', payload),
  materializeMapTab: (payload) => ipcRenderer.invoke('manager:materialize-map-tab', payload),
  validateBundle: (payload) => ipcRenderer.invoke('manager:validate-bundle', payload),
  updateScenarioOptionMenuState: (payload) => ipcRenderer.invoke('manager:update-scenario-option-menu-state', payload),
  saveBundle: (payload) => ipcRenderer.invoke('manager:save-bundle', payload),
  previewSavePlan: (payload) => ipcRenderer.invoke('manager:preview-save-plan', payload),
  previewFileDiff: (payload) => ipcRenderer.invoke('manager:preview-file-diff', payload)
});
