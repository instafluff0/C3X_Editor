const { contextBridge, ipcRenderer } = require('electron');

let overlayState = {
  hasAlerts: false,
  alertsSeen: false,
  enabled: false
};

function getOpenMainButton() {
  return document.getElementById('open-main');
}

function renderOverlayState() {
  const button = getOpenMainButton();
  if (!button) return;
  const hasAlerts = !!overlayState.hasAlerts;
  const unseen = hasAlerts && !overlayState.alertsSeen;
  button.classList.toggle('has-alerts', hasAlerts);
  button.classList.toggle('has-unseen-alerts', unseen);
  button.setAttribute('aria-label', hasAlerts ? 'Open Civ Advisor alerts' : 'Open Civ Advisor');
  button.title = hasAlerts ? 'Open Civ Advisor alerts' : 'Open Civ Advisor';
}

window.addEventListener('DOMContentLoaded', () => {
  const button = getOpenMainButton();
  if (button) {
    button.addEventListener('click', () => {
      ipcRenderer.send('manager:civ-advisor-overlay-open-main');
    });
  }
  renderOverlayState();
});

ipcRenderer.on('manager:civ-advisor-overlay-state', (_event, state) => {
  overlayState = {
    hasAlerts: !!(state && state.hasAlerts),
    alertsSeen: !!(state && state.alertsSeen),
    enabled: !!(state && state.enabled)
  };
  renderOverlayState();
});

contextBridge.exposeInMainWorld('civAdvisorOverlay', {
  openMainWindow: () => ipcRenderer.send('manager:civ-advisor-overlay-open-main')
});
