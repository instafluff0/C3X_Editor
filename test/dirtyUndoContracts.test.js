const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_PATH = path.join(__dirname, '..', 'src', 'renderer.js');

function rendererSource() {
  return fs.readFileSync(RENDERER_PATH, 'utf8');
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

function extractEditableTabKeys(source) {
  const match = source.match(/const EDITABLE_TAB_KEYS = \[([\s\S]*?)\];/);
  assert.ok(match, 'expected EDITABLE_TAB_KEYS to be declared as a literal array');
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

test('dirty counts cover every editable tab family through the shared recompute path', () => {
  const source = rendererSource();
  const editableKeys = extractEditableTabKeys(source);

  assert.deepEqual(editableKeys, [
    'base',
    'districts',
    'wonders',
    'naturalWonders',
    'animations',
    'civilizations',
    'technologies',
    'resources',
    'improvements',
    'governments',
    'units',
    'gameConcepts',
    'terrainPedia',
    'workerActions',
    'map',
    'scenarioSettings',
    'players',
    'terrain',
    'world',
    'rules'
  ]);

  const computeTabDirtyCount = extractFunctionSource(source, 'computeTabDirtyCount');
  assert.match(
    computeTabDirtyCount,
    /currentTab\.type === 'reference'[\s\S]*?isReferenceEntryDirtyForCache\(tabKey, entry,[\s\S]*?\{\s*tab:\s*currentTab\s*\}[\s\S]*?combineReferenceDirtyCountWithRecordOps\(changed,\s*currentTab\)/,
    'reference tabs must count per-entry dirty rows plus pending structural recordOps'
  );
  assert.match(
    computeTabDirtyCount,
    /currentTab\.model && Array\.isArray\(currentTab\.model\.sections\)[\s\S]*?sectionName[\s\S]*?return changed;/,
    'sectioned tabs must compute item counts by stable section identity'
  );
  assert.match(
    computeTabDirtyCount,
    /currentTab\.type === 'biqStructure' && Array\.isArray\(currentTab\.sections\)[\s\S]*?return 1;/,
    'BIQ structure tabs must remain dirty even when counting every record would be too expensive'
  );
  assert.match(
    computeTabDirtyCount,
    /tabKey === 'base' && Array\.isArray\(currentTab\.rows\)[\s\S]*?prevByKey[\s\S]*?return changed;/,
    'base config rows must compute dirty counts by key'
  );

  const rebuildDirtyTabCounts = extractFunctionSource(source, 'rebuildDirtyTabCounts');
  assert.match(
    rebuildDirtyTabCounts,
    /EDITABLE_TAB_KEYS\.forEach\(\(tabKey\) => \{[\s\S]*?tab\.type === 'reference'[\s\S]*?isReferenceEntryDirtyForCache\(tabKey, entry, cleanEntry, idx, \{ tab \}\)[\s\S]*?setTabDirtyCount\(tabKey, combineReferenceDirtyCountWithRecordOps\(set\.size \+ extra, tab\)\)/,
    'full dirty recompute must preserve reference row badges and recordOps-only changes'
  );
  assert.match(
    rebuildDirtyTabCounts,
    /tab\.model && Array\.isArray\(tab\.model\.sections\)[\s\S]*?setTabDirtyCount\(tabKey, set\.size\)[\s\S]*?setTabDirtyCount\(tabKey, computeTabDirtyCount\(tabKey\)\)/,
    'full dirty recompute must cover sectioned tabs and all fallback editable tab families'
  );

  const recomputeDirtyStateFromBundle = extractFunctionSource(source, 'recomputeDirtyStateFromBundle');
  assert.match(
    recomputeDirtyStateFromBundle,
    /state\.isDirty = true;[\s\S]*?rebuildDirtyTabCounts\(\);[\s\S]*?state\.isDirty = Object\.keys\(state\.dirtyTabCounts \|\| \{\}\)\.length > 0;/,
    'dirty-state recompute must derive global dirty state from rebuilt tab counts'
  );
});

test('dirty badge refreshes are centralized for main tabs, reference rows, and BIQ record lists', () => {
  const source = rendererSource();

  const applyDirtyBadgeToTabButton = extractFunctionSource(source, 'applyDirtyBadgeToTabButton');
  assert.match(
    applyDirtyBadgeToTabButton,
    /Array\.from\(button\.querySelectorAll\('\.dirty-dot-badge'\)\)[\s\S]*?const dirtyCount = getTabDirtyCount\(key\);[\s\S]*?appendDirtyBadge\(button,[\s\S]*?dirtyCount\)/,
    'tab buttons must remove stale dirty badges and render the current dirty count'
  );

  const refreshTabDirtyBadges = extractFunctionSource(source, 'refreshTabDirtyBadges');
  assert.match(
    refreshTabDirtyBadges,
    /querySelectorAll\('\.tab-btn\[data-tab-key\]'\)[\s\S]*?applyDirtyBadgeToTabButton\(button, key, tab\)/,
    'tab dirty badge refresh must visit every mounted tab button'
  );

  const refreshActiveReferenceListDirtyBadges = extractFunctionSource(source, 'refreshActiveReferenceListDirtyBadges');
  assert.match(
    refreshActiveReferenceListDirtyBadges,
    /const dirtySet = state\.dirtyReferenceKeysByTab && state\.dirtyReferenceKeysByTab\[tabKey\][\s\S]*?isReferenceEntryDirtyForCache\(tabKey, entry, cleanEntry, item && item\.idx, \{ tab \}\)[\s\S]*?appendDirtyBadge\(itemBtn,/,
    'reference list row badges must use the maintained dirty-key set with an active-row precision refresh'
  );

  const refreshActiveBiqRecordListDirtyBadges = extractFunctionSource(source, 'refreshActiveBiqRecordListDirtyBadges');
  assert.match(
    refreshActiveBiqRecordListDirtyBadges,
    /querySelectorAll\('\.entry-list-pane \.entry-list-item\[data-index\]'\)[\s\S]*?Array\.from\(itemBtn\.querySelectorAll\('\.dirty-dot-badge'\)\)[\s\S]*?isBiqRecordDirty\(ownerTabKey, selectionState\.selected\.code, record\)[\s\S]*?appendDirtyBadge\(\s*itemBtn,/,
    'BIQ structure record-list badges must remove stale badges and append current per-record dirty state'
  );

  const flushDirtyUiRefresh = extractFunctionSource(source, 'flushDirtyUiRefresh');
  assert.match(
    flushDirtyUiRefresh,
    /updateActiveDirtyCaches\(\)[\s\S]*?refreshDirtyUi\(\)[\s\S]*?refreshTabDirtyBadges\(\)[\s\S]*?refreshActiveReferenceListDirtyBadges\(\)[\s\S]*?refreshActiveBiqRecordListDirtyBadges\(\)/,
    'deferred dirty refresh must update counts, chrome, tab badges, reference row badges, and BIQ record badges together'
  );

  const setDirty = extractFunctionSource(source, 'setDirty');
  assert.match(
    setDirty,
    /if \(!next\) \{[\s\S]*?state\.isDirty = false;[\s\S]*?clearDirtyTabCounts\(\);[\s\S]*?refreshDirtyUi\(\);[\s\S]*?refreshTabDirtyBadges\(\);[\s\S]*?refreshActiveReferenceListDirtyBadges\(\);[\s\S]*?refreshActiveBiqRecordListDirtyBadges\(\);/,
    'clearing dirty state must clear counts and every badge surface immediately'
  );
  assert.match(
    setDirty,
    /if \(knownDirtyTab\) \{[\s\S]*?setTabDirtyCount\(knownDirtyTab, Math\.max\(1, previousCount\)\);[\s\S]*?scheduleDirtyUiRefresh\(`set-dirty:\$\{knownDirtyTab\}`\);/,
    'known-tab dirty calls must preserve an existing precise count and schedule a shared refresh'
  );
});

test('Undo and Undo All activation use effective unsaved state across main app and modals', () => {
  const source = rendererSource();

  const refreshDirtyUi = extractFunctionSource(source, 'refreshDirtyUi');
  assert.match(
    refreshDirtyUi,
    /const hasUndoHistory = \(Array\.isArray\(state\.undoHistory\) && state\.undoHistory\.length > 0\) \|\| hasPendingTrackedEditSessions\(\);[\s\S]*?el\.undoBtn\.disabled = !hasUndoHistory \|\| state\.isLoading;[\s\S]*?el\.undoAllBtn\.disabled = !hasEffectiveUnsavedChanges\(\) \|\| state\.isLoading;/,
    'main Undo should depend on undo history, while main Undo All should depend on effective unsaved changes'
  );
  assert.match(
    refreshDirtyUi,
    /refreshTechTreeModalActionButtons\(\);[\s\S]*?refreshUnitAvailabilityModalActionButtons\(\);[\s\S]*?refreshUnitTableModalActionButtons\(\);[\s\S]*?refreshMapModalUndoButtons\(\);/,
    'global dirty UI refresh must update every modal undo/save button cluster'
  );

  const hasEffectiveUnsavedChanges = extractFunctionSource(source, 'hasEffectiveUnsavedChanges');
  assert.match(
    hasEffectiveUnsavedChanges,
    /state\.isDirty \|\| hasPendingTrackedEditSessions\(\) \|\| hasUnsavedTechTreeArrowArtChanges\(\)/,
    'effective dirty state must include normal dirty tabs, in-progress edit sessions, and Science Advisor arrow art'
  );

  const hasImmediateEffectiveUndoableChanges = extractFunctionSource(source, 'hasImmediateEffectiveUndoableChanges');
  assert.match(
    hasImmediateEffectiveUndoableChanges,
    /hasEffectiveUnsavedChanges\(\) && hasImmediateUndoableChanges\(\)/,
    'modal Undo and Save activation must require both dirty state and an undoable snapshot/session'
  );

  const setModalUndoSaveButtonState = extractFunctionSource(source, 'setModalUndoSaveButtonState');
  assert.match(
    setModalUndoSaveButtonState,
    /modal\.undoBtn\.disabled = undoDisabled;[\s\S]*?modal\.undoAllBtn\.disabled = undoDisabled;[\s\S]*?modal\.saveBtn\.disabled = undoDisabled \|\| !hasSaveable/,
    'modal Undo, Undo All, and Save buttons must share one disabled-state contract'
  );

  [
    'refreshTechTreeModalActionButtons',
    'refreshUnitAvailabilityModalActionButtons',
    'refreshUnitTableModalActionButtons'
  ].forEach((name) => {
    const fn = extractFunctionSource(source, name);
    assert.match(
      fn,
      /const hasUndoable = hasImmediateEffectiveUndoableChanges\(\);[\s\S]*?setModalUndoSaveButtonState\([^,]+, \{[\s\S]*?hasUndoable,[\s\S]*?hasSaveable: hasUndoable/,
      `${name} must use immediate effective undoable state for Undo, Undo All, and Save`
    );
  });

  const refreshMapModalUndoButtons = extractFunctionSource(source, 'refreshMapModalUndoButtons');
  assert.match(
    refreshMapModalUndoButtons,
    /const hasUndoable = hasMapModalUndoableChanges\(\);[\s\S]*?setModalUndoSaveButtonState\(mapModal, \{[\s\S]*?canEdit: isScenarioMode\(\),[\s\S]*?hasUndoable,[\s\S]*?hasSaveable: hasUndoable && hasTrackedUnsavedMapChanges\(\)/,
    'map modal buttons must use the map-scoped dirty and undo snapshot contract'
  );

  const hasTrackedUnsavedMapChanges = extractFunctionSource(source, 'hasTrackedUnsavedMapChanges');
  assert.match(
    hasTrackedUnsavedMapChanges,
    /getTabDirtyCount\('map'\) > 0[\s\S]*?hasPendingMapWriteState\(mapTab\)[\s\S]*?getLatestScopedUndoSnapshot\('map'\)[\s\S]*?hasChangedFromClean\(mapTab, getCleanTabsObject\(\)\.map \|\| null\)/,
    'map dirty tracking must account for badge counts, pending map write state, scoped undo snapshots, and clean-snapshot comparison'
  );
});

test('Undo and Undo All effects restore snapshots and refresh all dirty badge surfaces', () => {
  const source = rendererSource();

  const applyEditableSnapshotToCurrentBundle = extractFunctionSource(source, 'applyEditableSnapshotToCurrentBundle');
  assert.match(
    applyEditableSnapshotToCurrentBundle,
    /applyUndoRestoreEphemeralState\(nextUndoHistory\);[\s\S]*?recomputeDirtyStateFromBundle\(\);[\s\S]*?refreshDirtyUi\(\);[\s\S]*?refreshTabDirtyBadges\(\);[\s\S]*?refreshActiveReferenceListDirtyBadges\(\);[\s\S]*?refreshActiveBiqRecordListDirtyBadges\(\);/,
    'generic undo restore must recompute dirty state and refresh every badge surface'
  );

  const applyMapUndoSnapshotToCurrentBundle = extractFunctionSource(source, 'applyMapUndoSnapshotToCurrentBundle');
  assert.match(
    applyMapUndoSnapshotToCurrentBundle,
    /applyUndoRestoreEphemeralState\(nextUndoHistory\);[\s\S]*?recomputeDirtyStateFromBundle\(\);[\s\S]*?refreshDirtyUi\(\);[\s\S]*?refreshTabDirtyBadges\(\);[\s\S]*?refreshActiveReferenceListDirtyBadges\(\);[\s\S]*?refreshActiveBiqRecordListDirtyBadges\(\);/,
    'map undo restore must recompute dirty state and refresh every badge surface'
  );

  const undoOneStep = extractFunctionSource(source, 'undoOneStep');
  assert.match(
    undoOneStep,
    /flushDirtyUiRefresh\(\);[\s\S]*?commitAllTrackedEditSessions\(\);[\s\S]*?const undoSnapshot = getLatestUndoSnapshot\(\);[\s\S]*?restoreEditableSnapshot\(undoSnapshot, \{[\s\S]*?undoHistory: state\.undoHistory\.slice\(0, -1\)/,
    'Undo must flush pending UI/edit sessions and restore the latest snapshot while popping history'
  );
  assert.match(
    undoOneStep,
    /if \(!state\.isDirty\) \{[\s\S]*?state\.techTreeArrowArtDirty = false;[\s\S]*?refreshDirtyUi\(\);[\s\S]*?refreshTabDirtyBadges\(\);[\s\S]*?refreshActiveReferenceListDirtyBadges\(\);[\s\S]*?refreshActiveBiqRecordListDirtyBadges\(\);/,
    'Undo that returns to clean must also clear arrow-art dirty state and refresh all badges'
  );

  const undoAllChanges = extractFunctionSource(source, 'undoAllChanges');
  assert.match(
    undoAllChanges,
    /flushDirtyUiRefresh\(\);[\s\S]*?commitAllTrackedEditSessions\(\);[\s\S]*?recomputeDirtyStateFromBundle\(\);[\s\S]*?if \(!state\.bundle \|\| !hasEffectiveUnsavedChanges\(\)\)/,
    'Undo All must commit pending sessions and recompute dirty state before deciding whether there is work to do'
  );
  assert.match(
    undoAllChanges,
    /restoreEditableSnapshot\(state\.cleanSnapshot \|\| 'null', \{[\s\S]*?undoHistory: \[\],[\s\S]*?\}\);[\s\S]*?restoreCleanTechTreeArrowStyleState\(\);[\s\S]*?recomputeDirtyStateFromBundle\(\);[\s\S]*?refreshDirtyUi\(\);/,
    'Undo All must restore the clean snapshot, clear undo history, restore clean arrow state, and refresh dirty UI'
  );

  const undoAllMapChanges = extractFunctionSource(source, 'undoAllMapChanges');
  assert.match(
    undoAllMapChanges,
    /if \(!state\.bundle \|\| !hasTrackedUnsavedMapChanges\(\)\)[\s\S]*?const cleanMapSnapshot = getCleanMapUndoSnapshot\(\);[\s\S]*?applyMapUndoSnapshotToCurrentBundle\(cleanMapSnapshot, \{[\s\S]*?removeAll: true/,
    'map Undo All must use map-scoped clean snapshots and remove map-scoped undo history'
  );
});

test('all current modal undo surfaces are inventoried and use the shared guard before mutating state', () => {
  const source = rendererSource();

  const modalSurfaces = [
    {
      name: 'Tech Tree',
      fn: 'openTechTreeModal',
      undoGuard: /if \(!hasImmediateEffectiveUndoableChanges\(\)\) return;[\s\S]*?await undoOneStep\(\{ suppressTechTreeModalRefresh: true \}\)/,
      undoAllGuard: /if \(!hasImmediateEffectiveUndoableChanges\(\)\) return;[\s\S]*?await undoAllChanges\(\{ suppressTechTreeModalRefresh: true \}\)/
    },
    {
      name: 'Availability by Civ',
      fn: 'createUnitAvailabilityPanel',
      undoGuard: /if \(!referenceEditable \|\| !hasImmediateEffectiveUndoableChanges\(\)\) return;[\s\S]*?await undoOneStep\(\);/,
      undoAllGuard: /if \(!referenceEditable \|\| !hasImmediateEffectiveUndoableChanges\(\)\) return;[\s\S]*?await undoAllChanges\(\);/
    },
    {
      name: 'Unit Table',
      fn: 'openUnitTableModal',
      undoGuard: /if \(!isScenarioMode\(\) \|\| !hasImmediateEffectiveUndoableChanges\(\)\) return;[\s\S]*?await undoOneStep\(\);/,
      undoAllGuard: /if \(!isScenarioMode\(\) \|\| !hasImmediateEffectiveUndoableChanges\(\)\) return;[\s\S]*?await undoAllChanges\(\);/
    },
    {
      name: 'Map Editor',
      fn: 'ensureMapModalNode',
      undoGuard: /if \(!isScenarioMode\(\) \|\| !hasMapModalUndoableChanges\(\)\) return;[\s\S]*?await undoMapOneStep\(\);/,
      undoAllGuard: /if \(!isScenarioMode\(\) \|\| !hasMapModalUndoableChanges\(\)\) return;[\s\S]*?await undoAllMapChanges\(\);/
    }
  ];

  modalSurfaces.forEach((surface) => {
    const fn = extractFunctionSource(source, surface.fn);
    assert.match(fn, surface.undoGuard, `${surface.name} Undo must guard on the shared effective undoable state`);
    assert.match(fn, surface.undoAllGuard, `${surface.name} Undo All must guard on the shared effective undoable state`);
  });
});
