'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_PATH = path.join(__dirname, '..', 'src', 'renderer.js');
const STYLES_PATH = path.join(__dirname, '..', 'src', 'styles.css');

test('Techs Enables includes Worker Jobs backed by TFRM requiredadvance', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  const groupMatch = source.match(/key: 'workerJobs'[\s\S]*?dirtyTabKey: 'terrain'/);
  assert.ok(groupMatch, 'Expected workerJobs unlock group to be present');
  const groupSource = groupMatch[0];
  assert.match(groupSource, /title: 'Worker Jobs'/);
  assert.match(groupSource, /tabKey: 'workerActions'/);
  assert.match(groupSource, /sectionTabKey: 'terrain'/);
  assert.match(groupSource, /fieldKey: 'requiredadvance'/);
  assert.match(groupSource, /sectionCode: 'TFRM'/);
  assert.match(groupSource, /kind: 'biqStructureSection'/);
});

test('Techs Enables BIQ structure groups dirty the owning structure tab', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  assert.match(
    source,
    /isTechnologyUnlockBiqStructureGroup\(spec\)[\s\S]*?recomputeDirtyCountForTab\(getTechnologyUnlockDirtyTabKey\(spec\)\)/,
    'Expected BIQ structure unlock edits to recompute the owning tab dirty count'
  );
  assert.match(
    source,
    /isTechnologyUnlockBiqStructureGroup\(spec\)[\s\S]*?rememberUndoSnapshotForKey\(dirtyTabKey \? `SECTION_TAB:\$\{dirtyTabKey\}` : ''\)/,
    'Expected BIQ structure unlock edits to use a scoped structure-tab undo snapshot'
  );
});

test('Techs Enables Worker Jobs thumbnails use TFRM command buttons', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  assert.match(
    source,
    /function getTechnologyUnlockBiqStructureThumbnailEntry\(spec, record\) \{[\s\S]*?getTerrainCivilopediaEntryForRecord\(terrainTab, 'TFRM', record\)/,
    'Expected Worker Jobs unlock thumbnails to resolve through the Terrain -> Worker Jobs Civilopedia entry'
  );
  assert.match(
    source,
    /items\.push\(\{ tabKey: 'workerActions', entry: thumbEntry, commandButtonRecord: item\.entry \|\| null \}\)/,
    'Expected Tech Tree worker-job unlock items to carry the TFRM record for command-button art'
  );
  assert.match(
    source,
    /loadTfrmCommandButtonThumbnail\(item\.commandButtonRecord, holder\)[\s\S]*?if \(!ok && holder\.isConnected\) loadReferenceListThumbnail\(item\.tabKey, item\.entry, holder\)/,
    'Expected Tech Tree worker-job unlock thumbnails to use command buttons with Civilopedia art fallback'
  );
  assert.match(
    source,
    /isBiqStructureGroup \? \(\(\{ holder, option \}\) => \([\s\S]*?renderTechnologyUnlockBiqStructureThumb\(spec, holder, option\)/,
    'Expected the Techs Enables picker to request custom BIQ structure thumbnails'
  );
});

test('Tech Tree boxes include obsoleted improvements with red X thumbnails', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  assert.match(
    source,
    /const TECH_TREE_TECHBOX_UNLOCK_GROUP_KEYS = new Set\(\['units', 'improvements', 'workerJobs', 'obsoleteImprovements'\]\)/,
    'Expected obsoleted improvements to contribute to Tech Tree box icon counts'
  );
  assert.match(
    source,
    /obsolete: String\(spec\.key \|\| ''\) === 'obsoleteImprovements'/,
    'Expected obsolete improvement unlock items to be tagged'
  );
  assert.match(
    source,
    /if \(item\.obsolete\) unlockThumb\.classList\.add\('tech-tree-node-obsolete-thumb'\)/,
    'Expected obsolete improvement thumbnails to receive the red-X overlay class'
  );
});

test('Tech Tree marks techs not required for era advancement in the UI layer', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  assert.match(
    source,
    /function isTechNotRequiredForEraAdvancement\(entry\) \{[\s\S]*?getTechField\(entry, 'notrequiredforadvancement'\)[\s\S]*?raw === 'true' \|\| raw === '1' \|\| raw === 'yes'/,
    'Expected Tech Tree nodes to read the TECH notrequiredforadvancement flag'
  );
  assert.match(
    source,
    /const notRequiredForEraAdvancement = isTechNotRequiredForEraAdvancement\(node\.entry\);[\s\S]*?elNode\.classList\.add\('tech-tree-node-not-required'\);[\s\S]*?badge\.className = 'tech-tree-node-era-optional-badge'/,
    'Expected optional-era tech nodes to receive italic title and no-go badge classes'
  );

  const styles = fs.readFileSync(STYLES_PATH, 'utf8');
  assert.match(styles, /\.tech-tree-node-not-required \.tech-tree-node-label \{[\s\S]*?font-style: italic;/);
  assert.match(styles, /\.tech-tree-node-era-optional-badge \{[\s\S]*?width: 18px;[\s\S]*?height: 18px;[\s\S]*?border: 2px solid #58789a/);
  assert.match(styles, /\.tech-tree-node-era-optional-badge::after \{[\s\S]*?transform: rotate\(45deg\)/);
});

test('Tech Tree generated-arrow preview uses the shared Science Advisor rasterer', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const configCore = fs.readFileSync(path.join(__dirname, '..', 'src', 'configCore.js'), 'utf8');

  assert.match(indexHtml, /<script src="\.\/scienceAdvisorArrows\.js"><\/script>[\s\S]*?<script src="\.\/renderer\.js"><\/script>/);
  assert.match(
    source,
    /const scienceAdvisorArrows = \(typeof window !== 'undefined' && window\.ScienceAdvisorArrows\) \? window\.ScienceAdvisorArrows : null;/,
    'Expected renderer to consume the shared Science Advisor arrow rasterer'
  );
  assert.match(
    source,
    /const lines = document\.createElement\('canvas'\);[\s\S]*?lines\.classList\.add\('tech-tree-lines'\)/,
    'Expected generated-arrow preview to use a raster canvas layer'
  );
  assert.match(
    source,
    /assetPath,[\s\S]*?options: \{ returnIndexed: true \}/,
    'Expected Science Advisor background previews to include palette data for matching raster colors'
  );
  assert.match(
    source,
    /scienceAdvisorArrows\.drawScienceAdvisorRoutesRgba\(\{[\s\S]*?palette,[\s\S]*?routes: allEdges\.map\(\(edgeObj\) => edgeObj\.route\)\.filter\(Boolean\),[\s\S]*?techBoxLayout,[\s\S]*?style: getStoredScienceAdvisorArrowStyle\(\)[\s\S]*?\}\)/,
    'Expected generated-arrow preview to draw with the same shared rasterer used for save output'
  );
  assert.match(
    configCore,
    /const scienceAdvisorArrows = require\('\.\/scienceAdvisorArrows'\);[\s\S]*?scienceAdvisorArrows\.drawScienceAdvisorRoutesIndexed\(\{ indices, palette: decoded\.palette, width, height, routes, techBoxLayout, eraIndex, style: arrowStyle \}\)/,
    'Expected save-time Science Advisor arrow writes to use the shared rasterer'
  );
  assert.match(
    source,
    /arrowStyleBtnLabel\.textContent = 'Arrow Style'[\s\S]*?arrowStyleBtnChevron\.textContent = '▾'[\s\S]*?Body Thickness[\s\S]*?Head Height[\s\S]*?Glint Color/,
    'Expected Tech Tree to expose live generated-arrow style controls'
  );
  assert.match(
    source,
    /scienceAdvisorArrowStyle: shouldUpdateScienceAdvisorArrows && state\.settings\.scienceAdvisorArrowStyle[\s\S]*?deepCloneUiValue\(state\.settings\.scienceAdvisorArrowStyle\)/,
    'Expected generated Science Advisor arrow saves to carry the selected style'
  );
  assert.match(
    source,
    /techTreeArrowCivFiltersByEra: shouldUpdateScienceAdvisorArrows[\s\S]*?buildScienceAdvisorArrowCivFiltersByEra\(techTreeArrowDirtyEras\)/,
    'Expected generated Science Advisor arrow saves to carry the visible civ-scoped tech-box sizing context'
  );
  assert.match(
    configCore,
    /annotateScienceAdvisorNodeRects\(\{ nodes, tabs: tabs \|\| \{\}, layout, civFiltersByEra \}\)/,
    'Expected save-time Science Advisor route rectangles to use the preview civ filter'
  );
  assert.match(
    source,
    /function getRefreshButtons\(\) \{[\s\S]*?return \[el\.refreshBtn, techTreeModal\.refreshBtn, mapModal\.refreshBtn\]\.filter\(\(btn\) => btn && btn\.isConnected\);[\s\S]*?function updateRefreshButtonState\(\)/,
    'Expected Tech Tree refresh to share the main Refresh disabled-state wiring'
  );
  assert.match(
    source,
    /<button type="button" class="ghost nav-btn refresh-btn tech-tree-refresh-btn" data-act="refresh" aria-label="Refresh from disk" title="Refresh from disk">⟳<\/button>[\s\S]*?<button type="button" class="secondary tech-tree-save-btn" data-act="save"><span class="btn-icon">💾<\/span>Save<\/button>[\s\S]*?techTreeModal\.refreshBtn = overlay\.querySelector\('\[data-act="refresh"\]'\);[\s\S]*?techTreeModal\.saveBtn = overlay\.querySelector\('\[data-act="save"\]'\);[\s\S]*?techTreeModal\.refreshBtn\.addEventListener\('click', \(\) => \{[\s\S]*?void refreshCurrentBundleFromDisk\(\);[\s\S]*?techTreeModal\.saveBtn\.addEventListener\('click', saveCurrentBundle\);/,
    'Expected Tech Tree modal Save and Refresh to route through the main app handlers'
  );
  assert.doesNotMatch(
    source,
    /if \(!autoArrowPreviewActive\) return;/,
    'Expected route-handle rendering to use the live generated-arrow preview state'
  );
  assert.match(
    source,
    /const hasLoadedScienceAdvisorArrowMetadataForEra = \(\) => !!\([\s\S]*?state\.techTreeArrowMetadataEraKeys[\s\S]*?state\.techTreeArrowMetadataEraKeys\[eraDirtyKey\][\s\S]*?\);[\s\S]*?const isAutoArrowPreviewActive = \(\) => autoArrowCheck\.checked === true && \([\s\S]*?state\.techTreeArrowArtDirtyByEra\[eraDirtyKey\][\s\S]*?\|\| hasLoadedScienceAdvisorArrowMetadataForEra\(\)/,
    'Expected saved scenario arrow metadata, not transient route hints, to make route handles available before an era is dirty'
  );
  assert.match(
    source,
    /function applyLoadedScienceAdvisorArrowMetadata\(metadata\) \{[\s\S]*?state\.techTreeArrowRouteSnapshots = getScienceAdvisorArrowMetadataSnapshotValue\(source\.routeSnapshots \|\| \{\}\);[\s\S]*?state\.techTreeArrowMetadataEraKeys = source\.exists[\s\S]*?getScienceAdvisorArrowMetadataEraKeysFromMaps\(state\.techTreeArrowBaselineRouteHints, state\.techTreeArrowRouteOverrides, state\.techTreeArrowRouteSnapshots\)[\s\S]*?: \{\};/,
    'Expected scenario arrow metadata eras to be tracked only when the sidecar exists'
  );
  assert.match(
    source,
    /techTreeArrowDirtyEras: shouldUpdateScienceAdvisorArrows \? techTreeArrowDirtyEras : \[\]/,
    'Expected generated Science Advisor arrow saves to carry the exact dirty eras instead of regenerating every era'
  );
  assert.match(
    source,
    /const scienceAdvisorArrowMetadataEraKeys = shouldUpdateScienceAdvisorArrows[\s\S]*?getScienceAdvisorArrowMetadataEraKeysForSave\(techTreeArrowDirtyEras\)[\s\S]*?techTreeArrowRouteOverrides: shouldUpdateScienceAdvisorArrows[\s\S]*?filterScienceAdvisorArrowMetadataMapByEra\(state\.techTreeArrowRouteOverrides \|\| \{\}, scienceAdvisorArrowMetadataEraKeys\)[\s\S]*?techTreeArrowRouteSnapshots: shouldUpdateScienceAdvisorArrows[\s\S]*?filterScienceAdvisorArrowMetadataMapByEra\(state\.techTreeArrowRouteSnapshots \|\| \{\}, scienceAdvisorArrowMetadataEraKeys\)[\s\S]*?techTreeArrowBaselineRouteHints: shouldUpdateScienceAdvisorArrows[\s\S]*?filterScienceAdvisorArrowMetadataMapByEra\(state\.techTreeArrowBaselineRouteHints \|\| \{\}, scienceAdvisorArrowMetadataEraKeys\)/,
    'Expected scenario arrow metadata saves to exclude route caches for untouched, non-metadata eras'
  );
  assert.match(
    indexHtml,
    /id="files-filter-type-art-pcx"[\s\S]*?<span>Art PCX<\/span>/,
    'Expected Files modal to expose generated Science Advisor PCX write targets'
  );
  assert.match(
    source,
    /function getScienceAdvisorArrowPendingWriteEntries\(\) \{[\s\S]*?state\.settings\.autoUpdateScienceAdvisorArrows === true[\s\S]*?Object\.keys\(state\.techTreeArrowArtDirtyByEra \|\| \{\}\)[\s\S]*?TECH_TREE_ERA_BACKGROUND_CANDIDATES\[eraIndex\][\s\S]*?Generated Science Advisor arrow background/,
    'Expected Files modal to list dirty generated Science Advisor PCX write targets before saving'
  );
  assert.match(
    source,
    /2: \['Art\/Advisors\/science_industrial_new\.pcx', 'Art\/Advisors\/science_industrial\.pcx'\]/,
    'Expected Industrial Science Advisor preview to prefer the scenario-used new PCX filename and fall back to the base filename'
  );
  assert.match(
    configCore,
    /\['Art\/Advisors\/science_industrial_new\.pcx', 'Art\/Advisors\/science_industrial\.pcx'\]/,
    'Expected save-time Industrial Science Advisor writes to prefer the scenario-used new PCX filename and fall back to the base filename'
  );
  assert.match(
    source,
    /function snapshotTechTreeArrowStyleState\(\) \{[\s\S]*?kind: 'tech-tree-arrow-style'[\s\S]*?scienceAdvisorArrowStyle: getScienceAdvisorArrowStyleSnapshotValue\(\)[\s\S]*?techTreeArrowArtDirtyByEra: deepCloneUiValue\(state\.techTreeArrowArtDirtyByEra \|\| \{\}\)[\s\S]*?techTreeArrowMetadataEraKeys: deepCloneUiValue\(state\.techTreeArrowMetadataEraKeys \|\| \{\}\)/,
    'Expected Tech Tree arrow style settings and metadata-backed visual mode to have a dedicated undo snapshot'
  );
  assert.match(
    source,
    /function rememberUndoSnapshotForKey\(key = ''\) \{[\s\S]*?rememberUndoSnapshotValue\(getUndoSnapshotForKey\(key\), key\);[\s\S]*?\}[\s\S]*?function rememberUndoSnapshotValue\(snapshot, key = ''\)/,
    'Expected callers that capture state before route mutation to be able to push that exact undo snapshot'
  );
  assert.match(
    source,
    /const beginArrowStyleUndoSession = \(\) => \{[\s\S]*?ensureTrackedEditSession\([\s\S]*?'TECH_TREE_ARROW_STYLE'[\s\S]*?\);[\s\S]*?\};[\s\S]*?updateScienceAdvisorArrowStyle[\s\S]*?beginArrowStyleUndoSession\(\)/,
    'Expected arrow style controls to activate Undo before mutating settings'
  );
  assert.match(
    source,
    /resetArrowStyleBtn\.addEventListener\('click', \(\) => \{[\s\S]*?hasOwnProperty\.call\(state\.settings, 'scienceAdvisorArrowStyle'\)[\s\S]*?return;[\s\S]*?rememberUndoSnapshotForKey\('TECH_TREE_ARROW_STYLE'\)/,
    'Expected Reset to be a no-op without a custom style and undoable when it changes style'
  );
  assert.match(
    source,
    /const undoSnapshot = snapshotTechTreeArrowStyleState\(\);[\s\S]*?const route = ensureRouteOverrideForEdge\(edgeObj\);[\s\S]*?undoSnapshot,[\s\S]*?if \(!drag\.dirty\) \{[\s\S]*?rememberUndoSnapshotValue\(drag\.undoSnapshot, 'TECH_TREE_ARROW_ROUTE'\);[\s\S]*?markArrowRouteDirty\(edgeObj\.key\);/,
    'Expected each arrow route drag to push the pre-drag arrow state as its own undo step'
  );
  assert.match(
    source,
    /const snapRouteDragPoint = \(route, pointIndex, point, options = \{\}\) => \{[\s\S]*?const threshold = 8;[\s\S]*?const axisCandidates = \{ x: \[\], y: \[\] \};[\s\S]*?const addSegmentAxes = \(routePoints, priority = 1\) => \{[\s\S]*?Math\.abs\(ax - bx\) <= 2[\s\S]*?addAxisCandidate\('x', \(ax \+ bx\) \/ 2, priority\)[\s\S]*?Math\.abs\(ay - by\) <= 2[\s\S]*?addAxisCandidate\('y', \(ay \+ by\) \/ 2, priority\)[\s\S]*?\};[\s\S]*?addSegmentAxes\(points, 1\);[\s\S]*?options\.routes[\s\S]*?addSegmentAxes\(candidateRoute\.points, 2\);/,
    'Expected arrow route handle drags to gently snap near horizontal and vertical route segments'
  );
  assert.match(
    source,
    /const isArrowRouteSnapEnabled = \(\) => !\(state\.settings && state\.settings\.scienceAdvisorArrowRouteSnap === false\);[\s\S]*?snapArrowText\.textContent = 'Snap drag'[\s\S]*?state\.settings\.scienceAdvisorArrowRouteSnap = snapArrowCheck\.checked === true;/,
    'Expected Background Arrows to expose a persisted route-handle snap toggle'
  );
  assert.match(
    source,
    /updateRouteOverridePoint\(edgeObj, drag\.pointIndex, drag\.latest, \{[\s\S]*?bypass: drag\.bypassSnap,[\s\S]*?routes: allEdges\.map\(\(candidateEdge\) => candidateEdge && candidateEdge\.route\)\.filter\(Boolean\)[\s\S]*?\}\)[\s\S]*?drag\.bypassSnap = !isArrowRouteSnapEnabled\(\) \|\| !!moveEv\.altKey;/,
    'Expected Alt/Option-drag and the snap toggle to bypass route-handle snap when precision is needed'
  );
  assert.match(
    source,
    /if \(typeof state\.settings\.scienceAdvisorArrowRouteSnap !== 'boolean'\) \{[\s\S]*?state\.settings\.scienceAdvisorArrowRouteSnap = true;[\s\S]*?\}/,
    'Expected route-handle snapping to default on for existing users'
  );
  assert.match(
    source,
    /if \(hasUnsavedTechTreeArrowArtChanges\(\)\) \{[\s\S]*?setTabDirtyCount\('techtreearrowart', 1\);[\s\S]*?\}/,
    'Expected dirty recomputation to preserve style-only arrow art edits'
  );
  assert.match(
    source,
    /function hasEffectiveUnsavedChanges\(\) \{[\s\S]*?state\.isDirty[\s\S]*?hasPendingTrackedEditSessions\(\)[\s\S]*?hasUnsavedTechTreeArrowArtChanges\(\)[\s\S]*?\}/,
    'Expected Undo All to use effective unsaved changes, including pending tracked edits'
  );
  assert.match(
    source,
    /function hasImmediateEffectiveUndoableChanges\(\) \{[\s\S]*?return hasEffectiveUnsavedChanges\(\) && hasImmediateUndoableChanges\(\);[\s\S]*?\}[\s\S]*?function refreshTechTreeModalActionButtons\(\) \{[\s\S]*?const hasUndoable = hasImmediateEffectiveUndoableChanges\(\);[\s\S]*?setModalUndoSaveButtonState\(techTreeModal, \{[\s\S]*?hasUndoable,[\s\S]*?hasSaveable: hasUndoable[\s\S]*?\}\);[\s\S]*?\}/,
    'Expected Tech Tree Undo, Undo All, and Save to share the same immediate undoable state'
  );
  assert.match(
    source,
    /initialCivFilter = '',[\s\S]*?initialEra = null[\s\S]*?const requestedInitialEra = Number\.parseInt\(String\(initialEra\), 10\);[\s\S]*?const resolvedInitialEra = Number\.isFinite\(requestedInitialEra\) \? requestedInitialEra : selectedEraFromTech;[\s\S]*?eraSelect\.value = hasEra \? String\(resolvedInitialEra\)/,
    'Expected Tech Tree modal rebuilds to support preserving the viewed era separately from the selected/restored tech'
  );
  assert.match(
    source,
    /const preservedEra = getTechTreeModalPreservedEra\(modalConfig\);[\s\S]*?await undoOneStep\(\{ suppressTechTreeModalRefresh: true \}\);[\s\S]*?reopenTechTreeModalAfterUndo\(modalConfig, preservedEra\);[\s\S]*?await undoAllChanges\(\{ suppressTechTreeModalRefresh: true \}\);[\s\S]*?reopenTechTreeModalAfterUndo\(modalConfig, preservedEra\);/,
    'Expected Tech Tree modal Undo and Undo All to preserve the current era instead of navigating to the restored tech era'
  );
  assert.match(
    source,
    /const isTechTreeOpen = !!\([\s\S]*?techTreeModal\.node[\s\S]*?!techTreeModal\.node\.classList\.contains\('hidden'\)[\s\S]*?activeTab === 'technologies'[\s\S]*?\);[\s\S]*?techTreeModalOpen: isTechTreeOpen,[\s\S]*?if \(\(!snapshot\.techTreeModalOpen \|\| state\.activeTab !== 'technologies'\) && techTreeModal\.node\) \{[\s\S]*?closeTechTreeModal\(\{ skipActiveTabRefresh: true \}\);[\s\S]*?\}[\s\S]*?if \(snapshot\.techTreeModalOpen && state\.activeTab === 'technologies'\) \{[\s\S]*?reopenTechTreeModalForCurrentState\(\);/,
    'Expected navigation history to restore an open Tech Tree modal'
  );
  assert.match(
    source,
    /async function undoAllChanges\(options = \{\}\) \{[\s\S]*?commitAllTrackedEditSessions\(\);[\s\S]*?recomputeDirtyStateFromBundle\(\);[\s\S]*?if \(!state\.bundle \|\| !hasEffectiveUnsavedChanges\(\)\)/,
    'Expected Undo All to recompute dirty state after committing pending edits'
  );
  assert.ok(source.includes("if (/\\.pcx$/i.test(pathValue)) return 'artPcx';"), 'Expected Files modal to classify PCX art files');
  assert.ok(source.includes("if (f.typeArtPcx) selectedTypes.push('artPcx');"), 'Expected Files modal filters to include PCX art files');
  assert.match(
    configCore,
    /!decoded\.palette \|\| typeof decoded\.palette\.length !== 'number'/,
    'Expected save-time Science Advisor arrow writes to accept Buffer and Uint8Array palettes'
  );

  const styles = fs.readFileSync(STYLES_PATH, 'utf8');
  assert.doesNotMatch(styles, /\.tech-tree-lines-auto-preview \.tech-tree-link\.is-selected/);
  assert.doesNotMatch(styles, /\.tech-tree-lines-auto-preview \.tech-tree-link-highlight\.is-selected/);
});

test('Tech Tree clicks select without being treated as drags', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');

  assert.match(
    source,
    /const movedEnough = Math\.abs\(dx\) > 3 \|\| Math\.abs\(dy\) > 3;[\s\S]*?if \(!drag\.moved && !movedEnough\) return false;/,
    'Expected Tech Tree node movement to require crossing the drag threshold'
  );
  assert.match(
    source,
    /if \(!drag\.moved\) \{[\s\S]*?const identity = getReferenceEntryIdentity\('technologies', node\.entry, node\.index\);[\s\S]*?rememberUndoSnapshotForKey\(identity \? `TECH_TREE_NODE_DRAG:\$\{identity\}` : buildReferenceEntryUndoKey\('technologies', node\.entry, node\.index\)\);[\s\S]*?refreshUndoButton\(\);[\s\S]*?\}[\s\S]*?drag\.moved = true;/,
    'Expected Tech Tree drag undo snapshots to capture coordinates and generated-arrow state after real movement starts'
  );
  assert.match(
    source,
    /updateDraggedNodePosition\(ev\.clientX, ev\.clientY\);[\s\S]*?const moved = drag\.moved;[\s\S]*?if \(!referenceEditable \|\| !moved\) return;/,
    'Expected pointerup without movement to preserve normal click and double-click behavior'
  );
  assert.match(
    source,
    /const finishDrag = \(ev\) => \{[\s\S]*?if \(autoArrowCheck\.checked === true\) \{[\s\S]*?markCurrentArrowEraDirty\(\);[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'techtreearrowart', reason: 'tech-tree-node-drag' \}\);[\s\S]*?\}[\s\S]*?redrawLines\(\);[\s\S]*?renderArrowHandles\(\);[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'technologies', reason: 'tech-tree-node-drag' \}\);[\s\S]*?\};/,
    'Expected Tech Tree node drops to update the current tree in place instead of rebuilding the whole era'
  );
  assert.match(
    source,
    /elNode\.addEventListener\('dblclick', \(\) => \{[\s\S]*?if \(elNode\.dataset\.dragged === '1'\) return;[\s\S]*?navigateWithHistory\(\(\) => \{[\s\S]*?state\.referenceSelection\[tabKey\] = node\.index;[\s\S]*?closeTechTreeModal\(\{ skipActiveTabRefresh: true \}\);[\s\S]*?\}, \{ preserveTabScroll: true \}\);[\s\S]*?\}\);/,
    'Expected double-clicking a Tech Tree node to create a Back-restorable modal-close navigation step'
  );
  assert.match(
    source,
    /kind: 'tech-tree-node-drag'[\s\S]*?entrySnapshot[\s\S]*?arrowState: snapshotTechTreeArrowStyleState\(\)/,
    'Expected Tech Tree node drags to snapshot the generated-arrow state with the moved tech entry'
  );
  assert.match(
    source,
    /if \(isTechTreeNodeDragSnapshot && techTreeNodeDragEntrySnapshot\) \{[\s\S]*?applySerializedReferenceEntrySnapshotToTabs\(mergedTabs, techTreeNodeDragEntrySnapshot\);[\s\S]*?\}[\s\S]*?if \(isTechTreeNodeDragSnapshot\) \{[\s\S]*?restoreTechTreeArrowStyleState\(targetSnapshot\.arrowState\);[\s\S]*?\}/,
    'Expected single Undo after a Tech Tree drag to restore both the tech entry and generated-arrow preview state'
  );
});

test('Tech Tree Auto-Position is wired into undo, dirty state, and save payloads', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');

  assert.match(
    source,
    /function snapshotTechTreeAutoPositionState\(\) \{[\s\S]*?snapshotSelectedEditableTabs\(\{ tabKeys: \['technologies'\], scope: 'tab:technologies' \}\)[\s\S]*?kind: 'tech-tree-auto-position'[\s\S]*?arrowState: snapshotTechTreeArrowStyleState\(\)/,
    'Expected Auto-Position to snapshot both technology coordinates and Tech Tree arrow state'
  );
  assert.match(
    source,
    /if \(normalizedKey === 'TECH_TREE_AUTO_POSITION'\) \{[\s\S]*?return snapshotTechTreeAutoPositionState\(\);[\s\S]*?\}/,
    'Expected Auto-Position to have a dedicated undo snapshot key'
  );
  assert.match(
    source,
    /techTreeAutoLayoutModeByTab: \{\}[\s\S]*?techTreeAutoLayoutModeByTab: cloneStateMap\(state\.techTreeAutoLayoutModeByTab\)[\s\S]*?state\.techTreeAutoLayoutModeByTab = cloneStateMap\(snapshot\.techTreeAutoLayoutModeByTab\)/,
    'Expected Tech Tree Auto-Position mode to persist with the view state'
  );
  assert.match(
    source,
    /layoutModeGroup\.setAttribute\('aria-label', 'Auto-position layout mode'\)[\s\S]*?\{ value: 'tidy', label: 'Tidy'[\s\S]*?\{ value: 'rebuild', label: 'Rebuild'[\s\S]*?state\.techTreeAutoLayoutModeByTab\[tabKey\] = autoLayoutMode/,
    'Expected Auto-Position to expose Tidy and Rebuild modes instead of Snap to Grid'
  );
  assert.doesNotMatch(source, /Snap to Grid/);
  assert.doesNotMatch(source, /snapCheck/);
  assert.match(
    source,
    /autoLayoutTechTreeNodes\(context\.nodes, \{[\s\S]*?preserveExisting: autoLayoutMode === 'rebuild' \? false : true[\s\S]*?grid: 16[\s\S]*?minColumnGap: 96[\s\S]*?minRowGap: 32[\s\S]*?\}\);/,
    'Expected Auto-Position mode to choose Rebuild or Tidy with grid-aligned breathing room'
  );
  assert.match(
    source,
    /rememberUndoSnapshotForKey\('TECH_TREE_AUTO_POSITION'\);[\s\S]*?setTechFieldInt\(node\.entry, 'x', 'X Position', x\);[\s\S]*?setTechFieldInt\(node\.entry, 'y', 'Y Position', y\);[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'technologies', reason: 'tech-tree-auto-position' \}\);[\s\S]*?rebuildReferenceDirtyCacheForTab\('technologies'\);/,
    'Expected Auto-Position to capture undo, dirty Technologies, and refresh per-tech dirty badges for every moved tech'
  );
  assert.match(
    source,
    /if \(autoArrowCheck\.checked === true\) \{[\s\S]*?markScienceAdvisorArrowEraDirty\(context\.eraValue\);[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'techtreearrowart', reason: 'tech-tree-auto-position' \}\);[\s\S]*?\}/,
    'Expected Auto-Position to dirty generated Science Advisor arrow art only when auto arrows are enabled'
  );
  assert.match(
    source,
    /if \(isTechTreeAutoPositionSnapshot\) \{[\s\S]*?restoreTechTreeArrowStyleState\(targetSnapshot\.arrowState\);[\s\S]*?\}/,
    'Expected Undo to restore Auto-Position arrow route and dirty-era state with the coordinates'
  );
  assert.match(
    source,
    /else if \(isTechTreeAutoPositionSnapshot && isTechTreeModalVisible\(\)\) \{[\s\S]*?techTreeModal\.needsActiveTabRefresh = true;[\s\S]*?if \(!options\.suppressTechTreeModalRefresh\) reopenTechTreeModalForCurrentState\(\);[\s\S]*?\}/,
    'Expected modal Auto-Position Undo to refresh the main Technologies tab after the modal closes'
  );
  assert.match(
    source,
    /function recomputeDirtyStateForScopedTabSnapshot\(snapshot\) \{[\s\S]*?if \(tab && tab\.type === 'reference' && Array\.isArray\(tab\.entries\)\) \{[\s\S]*?rebuildReferenceDirtyCacheForTab\(tabKey\);[\s\S]*?return true;[\s\S]*?\}/,
    'Expected Undo for scoped reference-tab snapshots to rebuild per-row dirty badges'
  );
  assert.match(
    source,
    /async function undoOneStep\(options = \{\}\) \{[\s\S]*?if \(!state\.isDirty\) \{[\s\S]*?state\.techTreeArrowArtDirty = false;[\s\S]*?state\.techTreeArrowArtDirtyByEra = \{\};[\s\S]*?refreshDirtyUi\(\);[\s\S]*?refreshActiveReferenceListDirtyBadges\(\);[\s\S]*?\}/,
    'Expected single Undo to refresh main dirty controls after clearing clean Tech Tree arrow state'
  );
  assert.match(
    source,
    /const shouldUpdateScienceAdvisorArrows = state\.settings\.autoUpdateScienceAdvisorArrows === true[\s\S]*?&& techTreeArrowDirtyEras\.length > 0;[\s\S]*?techTreeArrowDirtyEras: shouldUpdateScienceAdvisorArrows \? techTreeArrowDirtyEras : \[\]/,
    'Expected Save payloads to include generated arrow art only for dirty eras'
  );
});

test('Tech Tree civ filter defaults to the first civilization when available', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  assert.match(
    source,
    /const firstCivFilterValue = civOptions\.length > 0 \? String\(civOptions\[0\]\.value \|\| ''\) : '';/,
    'Expected Tech Tree to derive a first-civ default from civ picker options'
  );
  assert.match(
    source,
    /let selectedCivFilterValue = String\(initialCivFilter \|\| firstCivFilterValue \|\| ''\);/,
    'Expected blank Tech Tree civ filters to default to the first civilization'
  );
  assert.match(
    source,
    /currentValue: selectedCivFilterValue \|\| '-1'/,
    'Expected All Techs to remain the fallback only when no civilization exists'
  );
});
