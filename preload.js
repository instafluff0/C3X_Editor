const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('c3xManager', {
  getSettings: () => ipcRenderer.invoke('manager:get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('manager:set-settings', settings),
  pickDirectory: (options) => ipcRenderer.invoke('manager:pick-directory', options),
  pickFile: (options) => ipcRenderer.invoke('manager:pick-file', options),
  getPathForFile: (file) => {
    if (!file || !webUtils || typeof webUtils.getPathForFile !== 'function') return '';
    try {
      return webUtils.getPathForFile(file);
    } catch (_err) {
      return '';
    }
  },
  getEncodedByteLength: (text, encoding) => ipcRenderer.sendSync('manager:get-encoded-byte-length', { text, encoding }),
  clipTextToEncodedByteLimit: (text, maxBytes, encoding) => ipcRenderer.sendSync('manager:clip-text-to-encoded-byte-limit', { text, maxBytes, encoding }),
  openFilePath: (filePath) => ipcRenderer.invoke('manager:open-file-path', filePath),
  openLogFolder: () => ipcRenderer.invoke('manager:open-log-folder'),
  setCivAdvisorOverlayEnabled: (enabled) => ipcRenderer.invoke('manager:set-civ-advisor-overlay-enabled', !!enabled),
  setCivAdvisorOverlayStatus: (status) => ipcRenderer.invoke('manager:set-civ-advisor-overlay-status', status || {}),
  pathExists: (dirPath) => ipcRenderer.invoke('manager:path-exists', dirPath),
  getPathAccess: (paths) => ipcRenderer.invoke('manager:get-path-access', paths),
  listScenarios: (civ3Path) => ipcRenderer.invoke('manager:list-scenarios', civ3Path),
  listRecentCivAssistSaves: (payload) => ipcRenderer.invoke('manager:list-recent-civ-assist-saves', payload),
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
  onCivAdvisorLoadModeMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, mode) => handler(mode);
    ipcRenderer.on('manager:civ-advisor-load-mode-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:civ-advisor-load-mode-selected', listener);
    };
  },
  onTooltipDelayMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, value) => handler(value);
    ipcRenderer.on('manager:tooltip-delay-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:tooltip-delay-selected', listener);
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
  onResourceSettingsMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, settings) => handler(settings);
    ipcRenderer.on('manager:resource-settings-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:resource-settings-selected', listener);
    };
  },
  onUnitSettingsMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, settings) => handler(settings);
    ipcRenderer.on('manager:unit-settings-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:unit-settings-selected', listener);
    };
  },
  onImprovementSettingsMenuSelect: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, settings) => handler(settings);
    ipcRenderer.on('manager:improvement-settings-selected', listener);
    return () => {
      ipcRenderer.removeListener('manager:improvement-settings-selected', listener);
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
  onAppCommand: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('manager:app-command', listener);
    return () => {
      ipcRenderer.removeListener('manager:app-command', listener);
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
  onCivAdvisorOverlayOpenAlerts: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }
    const listener = () => handler();
    ipcRenderer.on('manager:civ-advisor-overlay-open-alerts', listener);
    return () => {
      ipcRenderer.removeListener('manager:civ-advisor-overlay-open-alerts', listener);
    };
  },
  getPreview: (payload) => ipcRenderer.invoke('manager:get-preview', payload),
  emitRendererDebugLog: (entry) => ipcRenderer.send('manager:renderer-debug-log', entry),
  loadBundle: (payload) => ipcRenderer.invoke('manager:load-bundle', payload),
  loadMapImport: (payload) => ipcRenderer.invoke('manager:load-map-import', payload),
  materializeMapTab: (payload) => ipcRenderer.invoke('manager:materialize-map-tab', payload),
  validateBundle: (payload) => ipcRenderer.invoke('manager:validate-bundle', payload),
  updateScenarioOptionMenuState: (payload) => ipcRenderer.invoke('manager:update-scenario-option-menu-state', payload),
  saveBundle: (payload) => ipcRenderer.invoke('manager:save-bundle', payload),
  previewSavePlan: (payload) => ipcRenderer.invoke('manager:preview-save-plan', payload),
  previewFileDiff: (payload) => ipcRenderer.invoke('manager:preview-file-diff', payload),
  inspectAudioFile: (filePath) => ipcRenderer.invoke('manager:inspect-audio-file', filePath),
  inspectCivColorPalettes: (payload) => ipcRenderer.invoke('manager:inspect-civ-color-palettes', payload),
  inspectCivAssistSave: (payload) => ipcRenderer.invoke('manager:inspect-civ-assist-save', payload),
  flicWorkshop: (payload) => ipcRenderer.invoke('manager:flic-workshop', payload)
});
