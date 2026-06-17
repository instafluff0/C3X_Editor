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

test('Tech Tree game-box render offset stays display-only', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');

  assert.match(
    source,
    /const TECH_TREE_GAME_BOX_RENDER_Y_OFFSET = 4;/,
    'Expected the in-game Science Advisor box Y adjustment to be a named tuning constant'
  );
  assert.match(
    source,
    /function getTechTreeGameBoxRenderYOffset\(node\) \{[\s\S]*?return node && node\.autoLayout \? 0 : TECH_TREE_GAME_BOX_RENDER_Y_OFFSET;[\s\S]*?\}/,
    'Expected non-era gutter nodes to skip the game-box render offset'
  );
  assert.match(
    source,
    /function getTechTreeDisplayYFromStoredY\(storedY, baseY = 0, node = null\) \{[\s\S]*?getTechTreeGameBoxRenderYOffset\(node\)[\s\S]*?\}/,
    'Expected stored BIQ Y values to convert through a display-coordinate helper'
  );
  assert.match(
    source,
    /function getTechTreeStoredYFromDisplayY\(displayY, baseY = 0, node = null\) \{[\s\S]*?getTechTreeGameBoxRenderYOffset\(node\)[\s\S]*?\}/,
    'Expected display Y values to convert back before writing BIQ coordinates'
  );
  assert.match(
    source,
    /node\.vy = getTechTreeDisplayYFromStoredY\(node\._rawDisplayY, activeEraBaseY, node\);/,
    'Expected rendered Tech Tree game boxes to use display-adjusted Y coordinates'
  );
  assert.match(
    source,
    /y: getTechTreeDisplayYFromStoredY\(node\.y, 0, node\),/,
    'Expected Auto-Position to solve against displayed box coordinates'
  );
  assert.match(
    source,
    /const nextY = Math\.round\(getTechTreeStoredYFromDisplayY\(position\.y, 0, node\)\);[\s\S]*?setTechFieldInt\(node\.entry, 'y', 'Y Position', y\);/,
    'Expected Auto-Position to convert display results back to stored Y values'
  );
  assert.match(
    source,
    /const finalY = Math\.round\(getTechTreeStoredYFromDisplayY\(finalDisplayY, activeEraBaseY, node\)\);[\s\S]*?node\.vy = getTechTreeDisplayYFromStoredY\(snappedY, activeEraBaseY, node\);/,
    'Expected Tech Tree drags to save stored Y values while keeping rendered boxes offset'
  );
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
    /const selectedArrowLines = document\.createElement\('canvas'\);[\s\S]*?selectedArrowLines\.classList\.add\('tech-tree-selected-arrow-lines'\);[\s\S]*?const selectedArrowHandles = document\.createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\);[\s\S]*?selectedArrowHandles\.classList\.add\('tech-tree-selected-route-handles-layer'\);[\s\S]*?stage\.appendChild\(nodesLayer\);[\s\S]*?stage\.appendChild\(selectedArrowLines\);[\s\S]*?stage\.appendChild\(selectedArrowHandles\);/,
    'Expected selected Tech Tree arrows and active route handles to render on top layers above tech boxes'
  );
  assert.match(
    source,
    /assetPath,[\s\S]*?options: \{ returnIndexed: true \}/,
    'Expected Science Advisor background previews to include palette data for matching raster colors'
  );
  assert.match(
    source,
    /const getArrowBaseLayerCanvas = \(w, h, dynamicKeys, palette, style, styleKey\) => \{[\s\S]*?filter\(\(edgeObj\) => edgeObj && edgeObj\.route && !dynamicKeys\.has\(edgeObj\.key\)\)[\s\S]*?renderArrowRoutesToCanvas\(canvas, w, h, routes, palette, style\);[\s\S]*?\};[\s\S]*?const drawArrowRouteOverlay = \(ctx, w, h, routes, palette, style\) => \{[\s\S]*?renderArrowRoutesToCanvas\(arrowScratchCanvas, w, h, routes, palette, style\);[\s\S]*?ctx\.drawImage\(arrowScratchCanvas, 0, 0\);[\s\S]*?\};/,
    'Expected generated-arrow preview to cache unchanged route raster layers and draw changed route overlays'
  );
  assert.match(
    source,
    /scienceAdvisorArrows\.drawScienceAdvisorRoutesRgba\(\{[\s\S]*?rgba: image\.data,[\s\S]*?palette,[\s\S]*?routes,[\s\S]*?techBoxLayout,[\s\S]*?style[\s\S]*?\}\)/,
    'Expected generated-arrow preview layer drawing to use the same shared rasterer used for save output'
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
    /function hasScienceAdvisorArrowMetadataForEra\(eraValue\) \{[\s\S]*?state\.techTreeArrowMetadataEraKeys\[eraKey\][\s\S]*?const isGeneratedArrowPreviewActive = \(\) => !!\(state\.techTreeArrowArtDirtyByEra && state\.techTreeArrowArtDirtyByEra\[eraDirtyKey\]\);[\s\S]*?const isRouteHandlePreviewActive = \(\) => isGeneratedArrowPreviewActive\(\) \|\| hasScienceAdvisorArrowMetadataForEra\(eraValue\);[\s\S]*?lines\.classList\.toggle\('tech-tree-lines-hidden', !generatedActive\);[\s\S]*?arrowHandles\.classList\.toggle\('tech-tree-route-handles-hidden', !handlesActive\);[\s\S]*?selectedArrowLines\.classList\.toggle\('tech-tree-lines-hidden', !handlesActive\);/,
    'Expected clean Tech Tree opens to preserve disk PCX arrows while saved metadata still enables route handles'
  );
  assert.match(
    source,
    /drawPreviewFrameToCanvas\(bgPreview, c\);[\s\S]*?if \(isGeneratedArrowPreviewActive\(\)\) \{[\s\S]*?eraseTechTreeBackgroundArrowsFromCanvas\(c\);[\s\S]*?\}/,
    'Expected the Tech Tree background PCX to be erased only after generated-arrow preview becomes dirty'
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
    /function getScienceAdvisorArrowPendingWriteEntries\(\) \{[\s\S]*?if \(!isScenarioMode\(\)\) return \[\];[\s\S]*?Object\.keys\(state\.techTreeArrowArtDirtyByEra \|\| \{\}\)[\s\S]*?TECH_TREE_ERA_BACKGROUND_CANDIDATES\[eraIndex\][\s\S]*?Generated Science Advisor arrow background/,
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
    /const undoSnapshot = snapshotTechTreeArrowStyleState\(\);[\s\S]*?const startPoint = getSvgPointFromEvent\(ev\);[\s\S]*?moved: false,[\s\S]*?routeReady: false,[\s\S]*?const hasMovedEnough = \(\) => \{[\s\S]*?Math\.abs\(dx\) > 2 \|\| Math\.abs\(dy\) > 2;[\s\S]*?const ensureDragRouteOverride = \(\) => \{[\s\S]*?const route = ensureRouteOverrideForEdge\(edgeObj\);[\s\S]*?if \(!drag\.moved\) \{[\s\S]*?if \(!hasMovedEnough\(\)\) return false;[\s\S]*?rememberUndoSnapshotValue\(drag\.undoSnapshot, 'TECH_TREE_ARROW_ROUTE'\);[\s\S]*?markArrowRouteDirty\(edgeObj\.key\);/,
    'Expected each arrow route drag to defer route overrides and undo state until actual pointer movement'
  );
  assert.match(
    source,
    /const snapRouteDragPoint = \(route, pointIndex, point, options = \{\}\) => \{[\s\S]*?const threshold = 8;[\s\S]*?const axisCandidates = \{ x: \[\], y: \[\] \};[\s\S]*?const addSegmentAxes = \(routePoints, priority = 1\) => \{[\s\S]*?Math\.abs\(ax - bx\) <= 2[\s\S]*?addAxisCandidate\('x', \(ax \+ bx\) \/ 2, priority\)[\s\S]*?Math\.abs\(ay - by\) <= 2[\s\S]*?addAxisCandidate\('y', \(ay \+ by\) \/ 2, priority\)[\s\S]*?\};[\s\S]*?addSegmentAxes\(points, 1\);[\s\S]*?options\.routes[\s\S]*?addSegmentAxes\(candidateRoute\.points, 2\);/,
    'Expected arrow route handle drags to gently snap near horizontal and vertical route segments'
  );
  assert.doesNotMatch(
    source,
    /const endpointStem = 18;[\s\S]*?adjacentPoint/,
    'Expected endpoint drags to move only the selected endpoint instead of secretly moving the neighboring handle'
  );
  assert.match(
    source,
    /const getClosestRouteSegmentInsert = \(route, point\) => \{[\s\S]*?segmentIndex: i,[\s\S]*?const insertArrowRouteHandle = \(edgeObj, point\) => \{[\s\S]*?const route = ensureRouteOverrideForEdge\(edgeObj\);[\s\S]*?nextPoints\.splice\(nextIndex, 0,[\s\S]*?selectedArrowHandleIndex = nextIndex;[\s\S]*?markArrowRouteDirty\(edgeObj\.key\);/,
    'Expected double-clicking an arrow segment to insert and select an explicit route handle'
  );
  assert.match(
    source,
    /const getSelectedArrowRouteHandleDeleteState = \(\) => \{[\s\S]*?canDelete: idx > 0 && idx < points\.length - 1 && points\.length > 2[\s\S]*?syncRouteHandleDeleteButtonState = \(\) => \{[\s\S]*?setRouteHandleDeleteButtonState\(getSelectedArrowRouteHandleDeleteState\(\)\.canDelete\);[\s\S]*?const removeSelectedArrowRouteHandle = \(\) => \{[\s\S]*?const \{ edgeObj, idx, points, canDelete \} = getSelectedArrowRouteHandleDeleteState\(\);[\s\S]*?if \(!canDelete\) return false;[\s\S]*?filter\(\(_point, pointIndex\) => pointIndex !== idx\)[\s\S]*?markArrowRouteDirty\(edgeObj\.key\);/,
    'Expected Delete to remove only selected internal arrow handles while protecting endpoints'
  );
  assert.match(
    source,
    /const clearSelectedArrowRouteOverride = \(\) => \{[\s\S]*?delete state\.techTreeArrowRouteOverrides\[edgeObj\.key\];[\s\S]*?selectedArrowHandleIndex = null;[\s\S]*?markArrowRouteDirty\(edgeObj\.key\);[\s\S]*?logTechTreeArrowInteraction\('override-clear', edgeObj\);/,
    'Expected Delete on a selected arrow with no selected handle to clear the custom route override'
  );
  assert.doesNotMatch(
    source,
    /const isEndpointBoxInternalRoutePoint = \(edgeObj, point, pointIndex, pointCount\) => \{[\s\S]*?pointIndex <= 0 \|\| pointIndex >= pointCount - 1[\s\S]*?isPointInsideRectWithPad\(point, sourceRect, 1\) \|\| isPointInsideRectWithPad\(point, targetRect, 1\);[\s\S]*?const sanitizeEditableRoutePointsForEdge = \(edgeObj, points\) => \{[\s\S]*?if \(isPointInsideRectWithPad\(point, sourceRect, 1\)\) return pushPointOutsideRect\(point, sourceRect\);[\s\S]*?if \(isPointInsideRectWithPad\(point, targetRect, 1\)\) return pushPointOutsideRect\(point, targetRect\);/,
    'Expected restored arrow route editing not to hide or push endpoint-adjacent handles off tech boxes'
  );
  assert.doesNotMatch(
    source,
    /const buildSmartDragPoints = \(\) => \{[\s\S]*?if \(options && options\.bypass\) return replaceOnly\(\);[\s\S]*?verticalThenHorizontal[\s\S]*?horizontalThenVertical[\s\S]*?appendDragPoint\(out, nextPoint, meta\);[\s\S]*?incomingVertical && outgoingHorizontal[\s\S]*?appendDragPoint\(out, \{ x: prev\.x, y: nextPoint\.y \}\);[\s\S]*?appendDragPoint\(out, nextPoint, meta\);[\s\S]*?appendDragPoint\(out, \{ x: nextPoint\.x, y: next\.y \}\);/,
    'Expected restored arrow route editing not to auto-expand ordinary handle drags with companion guard handles'
  );
  assert.match(
    source,
    /const isArrowRouteSnapEnabled = \(\) => !\(state\.settings && state\.settings\.scienceAdvisorArrowRouteSnap === false\);[\s\S]*?snapArrowText\.textContent = 'Snap drag'[\s\S]*?state\.settings\.scienceAdvisorArrowRouteSnap = snapArrowCheck\.checked === true;/,
    'Expected Background Arrows to expose a persisted route-handle snap toggle'
  );
  assert.match(
    source,
    /const routeHandleDeleteBtn = document\.createElement\('button'\);[\s\S]*?withRemoveIcon\(routeHandleDeleteBtn, 'Delete handle'\);[\s\S]*?Select a non-endpoint arrow handle to delete\.[\s\S]*?routeHandleDeleteBtn\.addEventListener\('click'[\s\S]*?deleteSelectedArrowHandle\(\)/,
    'Expected Background Arrows to expose a disabled-until-valid button for deleting the selected internal route handle'
  );
  assert.match(
    source,
    /const nextPoint = updateRouteOverridePoint\(edgeObj, drag\.pointIndex, drag\.latest, \{[\s\S]*?bypass: drag\.bypassSnap,[\s\S]*?routes: allEdges\.map\(\(candidateEdge\) => candidateEdge && candidateEdge\.route\)\.filter\(Boolean\)[\s\S]*?\}\);[\s\S]*?if \(!nextPoint\) return false;[\s\S]*?drag\.bypassSnap = !isArrowRouteSnapEnabled\(\) \|\| !!moveEv\.altKey;/,
    'Expected Alt/Option-drag and the snap toggle to bypass route-handle snap while preserving raw point dragging'
  );
  assert.match(
    source,
    /const activeKey = selectedArrowKey \|\| hoveredArrowKey;[\s\S]*?allEdges\.filter\(\(edgeObj\) => edgeObj && edgeObj\.key !== selectedArrowKey && edgeObj\.key !== hoveredArrowKey\)[\s\S]*?allEdges\.filter\(\(edgeObj\) => edgeObj && edgeObj\.key === selectedArrowKey\)[\s\S]*?\(edgeObj\.key === activeKey \? selectedArrowHandles : arrowHandles\)\.appendChild\(group\);/,
    'Expected selected or hovered active arrow controls to render after lower-priority hit targets on the top SVG layer'
  );
  assert.match(
    source,
    /const renderArrowHandles = \(\) => \{[\s\S]*?syncArrowPreviewVisibility\(\);[\s\S]*?if \(!isRouteHandlePreviewActive\(\)\) return;[\s\S]*?orderedEdges\.forEach\(\(edgeObj\) => \{[\s\S]*?if \(!edgeObj \|\| !edgeObj\.route \|\| !Array\.isArray\(edgeObj\.route\.points\)\) return;[\s\S]*?const points = edgeObj\.route\.points;/,
    'Expected clean base-PCX mode to keep computed arrow hit targets available without forcing generated arrow raster overlays'
  );
  assert.match(
    source,
    /const summarizeTechTreeArrowEdgeForDebug = \(edgeObj\) => \{[\s\S]*?`key=\$\{edgeObj\.key \|\| '\(none\)'\}`[\s\S]*?`source="\$\{getTechTreeArrowDebugName\(edgeObj\.source\)\}"`[\s\S]*?`target="\$\{getTechTreeArrowDebugName\(edgeObj\.target\)\}"`[\s\S]*?`route=\[\$\{formatTechTreeArrowDebugRoute\(route\)\}\]`[\s\S]*?const logTechTreeArrowInteraction = \(eventName, edgeObj, details = ''\) => \{[\s\S]*?appendDebugLog\(`\[DBG\]\[TechTree\] arrow-\$\{eventName\}/,
    'Expected Tech Tree arrow debug logs to include edge key, endpoint names, route points, and external log mirroring'
  );
  assert.match(
    source,
    /appendDebugLog\(`\[DBG\]\[TechTree\] arrow-\$\{eventName\}[\s\S]*?external: true,[\s\S]*?category: 'TechTree'/,
    'Expected Tech Tree arrow diagnostics to mirror into the daily app log'
  );
  assert.match(
    source,
    /logTechTreeArrowInteraction\(\s*'handles-render'/,
    'Expected Tech Tree arrow logs to include active handle rendering'
  );
  [
    "logTechTreeArrowInteraction('hover', edgeObj)",
    "logTechTreeArrowInteraction('click', edgeObj",
    "logTechTreeArrowInteraction('handle-down', edgeObj",
    "logTechTreeArrowInteraction('handle-done', edgeObj",
    "logTechTreeArrowInteraction('handle-insert', edgeObj",
    "logTechTreeArrowInteraction('handle-delete', edgeObj",
    "logTechTreeArrowInteraction('override-clear', edgeObj",
    "logTechTreeArrowInteraction('override-created', edgeObj)"
  ].forEach((needle) => {
    assert.ok(source.includes(needle), `Expected Tech Tree arrow logs to include ${needle}`);
  });
  assert.match(
    source,
    /const isRepeatedArrowPointerClick = \(edgeObj, point\) => \{[\s\S]*?previous\.key !== edgeObj\.key[\s\S]*?now - previous\.time > 450[\s\S]*?<= 144[\s\S]*?group\.addEventListener\('pointerdown'[\s\S]*?const pointerPoint = getSvgPointFromEvent\(ev\);[\s\S]*?if \(isRepeatedArrowPointerClick\(edgeObj, pointerPoint\)\) \{[\s\S]*?insertArrowRouteHandle\(edgeObj, pointerPoint\);[\s\S]*?return;[\s\S]*?selectedArrowKey = edgeObj\.key;[\s\S]*?selectedArrowHandleIndex = null;[\s\S]*?state\.techTreeSelectedArrowKey = edgeObj\.key;[\s\S]*?scheduleSelectionFocusRepaint\(\);/,
    'Expected arrow hover to stay transient while pointerdown persists selection and repeated clicks insert handles even if selection rerenders the SVG layer'
  );
  assert.match(
    source,
    /points\.forEach\(\(point, pointIndex\) => \{[\s\S]*?handle\.classList\.add\('tech-tree-route-handle'\);[\s\S]*?if \(pointIndex === 0 \|\| pointIndex === points\.length - 1\) handle\.classList\.add\('tech-tree-route-handle-endpoint'\);[\s\S]*?if \(edgeObj\.key === selectedArrowKey && selectedArrowHandleIndex === pointIndex\) handle\.classList\.add\('selected-handle'\);[\s\S]*?handle\.addEventListener\('pointerdown'[\s\S]*?selectedArrowHandleIndex = pointIndex;[\s\S]*?handle\.classList\.add\('selected-handle'\);[\s\S]*?scheduleSelectionFocusRepaint\(\{ renderHandles: false \}\);/,
    'Expected route handle clicks to select a specific visible editable handle without rebuilding the SVG layer'
  );
  assert.match(
    source,
    /stage\.onkeydown = \(ev\) => \{[\s\S]*?ev\.key !== 'Delete' && ev\.key !== 'Backspace'[\s\S]*?selectedArrowHandleIndex !== null[\s\S]*?removeSelectedArrowRouteHandle\(\)[\s\S]*?clearSelectedArrowRouteOverride\(\)/,
    'Expected Delete and Backspace to remove selected handles before clearing a selected arrow override'
  );
  assert.match(
    source,
    /hitPath\.setAttribute\('stroke-width', edgeObj\.key === selectedArrowKey \? '24' : \(edgeObj\.key === hoveredArrowKey \? '18' : '10'\)\);/,
    'Expected selected and hovered arrows to get prioritized hit widths without making every route broad'
  );
  assert.match(
    source,
    /const getTechTreeSelectedRouteColors = \(role\) => \{[\s\S]*?if \(role === 'incoming'\) \{[\s\S]*?main: \{ r: 176, g: 80, b: 232 \}[\s\S]*?highlight: \{ r: 176, g: 80, b: 232 \}[\s\S]*?if \(role === 'outgoing'\) \{[\s\S]*?main: \{ r: 38, g: 214, b: 82 \}[\s\S]*?highlight: \{ r: 38, g: 214, b: 82 \}[\s\S]*?if \(role === 'selected'\) \{[\s\S]*?main: \{ r: 38, g: 164, b: 255 \}[\s\S]*?highlight: \{ r: 38, g: 164, b: 255 \}[\s\S]*?colors: getTechTreeSelectedRouteColors\(role\)/,
    'Expected selected tech and selected individual arrows to use distinct temporary colors'
  );
  assert.match(
    source,
    /const refreshSelectedVisuals = \(activeId\) => \{[\s\S]*?const prereqIds = new Set\(\);[\s\S]*?const dependentIds = new Set\(\);[\s\S]*?edgeObj\.target && edgeObj\.target\.id === activeId[\s\S]*?prereqIds\.add\(edgeObj\.source\.id\);[\s\S]*?edgeObj\.source && edgeObj\.source\.id === activeId[\s\S]*?dependentIds\.add\(edgeObj\.target\.id\);[\s\S]*?el\.classList\.toggle\('is-prereq', id !== activeId && prereqIds\.has\(id\)\);[\s\S]*?el\.classList\.toggle\('is-dependent', id !== activeId && dependentIds\.has\(id\)\);/,
    'Expected selected tech source and target boxes to inherit incoming and outgoing highlight roles'
  );
  assert.match(
    source,
    /const selectedNode = byId\.get\(selectedId\) \|\| null;[\s\S]*?if \(selectedNode\) \{[\s\S]*?setCoordsFromNode\(selectedNode\);[\s\S]*?setModalTitleForNode\(selectedNode\);[\s\S]*?\} else \{[\s\S]*?selectedId = null;[\s\S]*?\}/,
    'Expected stale selected tech state to be cleared when the selected box is not visible in the current era or civ filter'
  );
  assert.match(
    source,
    /let selectionFocusActive = false;[\s\S]*?let selectionFocusNodeIds = new Set\(\);[\s\S]*?let selectionFocusEdgeKeys = new Set\(\);[\s\S]*?let selectionFocusRepaintTimer = 0;[\s\S]*?const scheduleSelectionFocusRepaint = \(options = \{\}\) => \{[\s\S]*?renderArrowHandles\(\);[\s\S]*?window\.setTimeout\(run, 0\);[\s\S]*?const getSelectedArrowEdge = \(\) => \{[\s\S]*?selectedArrowKey[\s\S]*?allEdges\.find/,
    'Expected Tech Tree selection focus state to track selected-arrow and selected-tech neighborhoods'
  );
  assert.match(
    source,
    /const selectedArrowEdge = getSelectedArrowEdge\(\);[\s\S]*?focusNodeIds\.add\(activeId\);[\s\S]*?focusEdgeKeys\.add\(edgeObj\.key\);[\s\S]*?else if \(selectedArrowEdge\) \{[\s\S]*?focusEdgeKeys\.add\(selectedArrowEdge\.key\);[\s\S]*?focusNodeIds\.add\(selectedArrowEdge\.source\.id\);[\s\S]*?focusNodeIds\.add\(selectedArrowEdge\.target\.id\);[\s\S]*?selectionFocusActive = activeId != null \|\| !!selectedArrowEdge;/,
    'Expected selected techs and selected arrows to focus only their related boxes and routes'
  );
  assert.match(
    source,
    /el\.classList\.toggle\('is-focus-dimmed', selectionFocusActive && !focusNodeIds\.has\(id\)\);[\s\S]*?edgeObj\.dimmed = selectionFocusActive && !focusEdgeKeys\.has\(edgeObj\.key\);/,
    'Expected unrelated Tech Tree boxes and routes to be temporarily dimmed during selection focus'
  );
  assert.match(
    source,
    /selectedArrowKey = edgeObj\.key;[\s\S]*?state\.techTreeSelectedArrowKey = edgeObj\.key;[\s\S]*?hoveredArrowKey = edgeObj\.key;[\s\S]*?selectedId = null;[\s\S]*?refreshSelectedVisuals\(null\);[\s\S]*?logTechTreeArrowInteraction\('click'/,
    'Expected clicking an arrow route to switch focus from selected techs to the selected arrow endpoints'
  );
  assert.match(
    source,
    /const selectedCtx = selectedArrowLines\.getContext\('2d'\);[\s\S]*?if \(selectedCtx\) selectedCtx\.clearRect\(0, 0, w, h\);[\s\S]*?const generatedActive = syncArrowPreviewVisibility\(\);[\s\S]*?const highlightCtx = isRouteHandlePreviewActive\(\) \? \(selectedCtx \|\| ctx\) : null;[\s\S]*?const drawHighlightedRoutes = \(routes, role\) => \{[\s\S]*?if \(!highlightCtx \|\| !Array\.isArray\(routes\) \|\| routes\.length === 0\) return;[\s\S]*?drawArrowRouteOverlay\(highlightCtx, w, h, routes, null, getHighlightedScienceAdvisorArrowStyle\(role\)\);[\s\S]*?\};[\s\S]*?const incomingHighlightedRoutes = allEdges[\s\S]*?edgeObj\.highlightRole === 'incoming'[\s\S]*?const outgoingHighlightedRoutes = allEdges[\s\S]*?edgeObj\.highlightRole === 'outgoing'[\s\S]*?const selectedArrowRoutes = allEdges[\s\S]*?edgeObj\.key === selectedArrowKey[\s\S]*?drawHighlightedRoutes\(incomingHighlightedRoutes, 'incoming'\);[\s\S]*?drawHighlightedRoutes\(outgoingHighlightedRoutes, 'outgoing'\);[\s\S]*?drawHighlightedRoutes\(selectedArrowRoutes, 'selected'\);/,
    'Expected selected-tech relationship arrows and selected-arrow overlays to draw on the top selected-arrow layer when saved route metadata or generated-arrow preview is active'
  );
  assert.match(
    source,
    /let arrowFocusLayerCache = null;[\s\S]*?const getFocusArrowBaseSignature = \(w, h, dynamicKeys, styleKey, dimmedStyleKey\) => \{[\s\S]*?const role = edgeObj\.dimmed \? 'dimmed' : 'focused';[\s\S]*?const getArrowFocusLayerCanvas = \(w, h, dynamicKeys, palette, baseStyle, dimmedStyle, styleKey, dimmedStyleKey\) => \{[\s\S]*?arrowFocusLayerCache[\s\S]*?const dimmedRoutes = allEdges[\s\S]*?!dynamicKeys\.has\(edgeObj\.key\) && edgeObj\.dimmed[\s\S]*?const focusedRoutes = allEdges[\s\S]*?!dynamicKeys\.has\(edgeObj\.key\) && !edgeObj\.dimmed[\s\S]*?if \(selectionFocusActive\) \{[\s\S]*?const dynamicFocusedEdges = drawableEdges\.filter\(\(edgeObj\) => dynamicKeys\.has\(edgeObj\.key\) && !edgeObj\.dimmed\);[\s\S]*?const dynamicDimmedEdges = drawableEdges\.filter\(\(edgeObj\) => dynamicKeys\.has\(edgeObj\.key\) && edgeObj\.dimmed\);[\s\S]*?const focusLayer = getArrowFocusLayerCanvas\(w, h, dynamicKeys, palette, baseStyle, dimmedStyle, styleKey, dimmedStyleKey\);[\s\S]*?if \(focusLayer\) ctx\.drawImage\(focusLayer, 0, 0\);[\s\S]*?drawArrowRouteOverlay\(ctx, w, h, routeListFor\(dynamicDimmedEdges\), null, dimmedStyle\);[\s\S]*?drawArrowRouteOverlay\(ctx, w, h, routeListFor\(dynamicFocusedEdges\), palette, baseStyle\);[\s\S]*?\} else \{[\s\S]*?const baseLayer = getArrowBaseLayerCanvas\(w, h, dynamicKeys, palette, baseStyle, styleKey\);/,
    'Expected selected-focus arrows to cache unrelated dimmed/focused routes and redraw only dynamic routes during live drags'
  );
  assert.match(
    source,
    /const updateTechTreeArrowFrameWarnings = \(options = \{\}\) => \{[\s\S]*?const updateKeys = normalizeArrowDynamicEdgeKeys\(options\.edgeKeys\);[\s\S]*?const scanEdges = updateKeys\.size > 0[\s\S]*?allEdges\.filter\(\(edgeObj\) => edgeObj && updateKeys\.has\(edgeObj\.key\)\)[\s\S]*?const renderSignature = warningEntries[\s\S]*?if \(renderSignature === arrowFrameWarningRenderSignature\) return;[\s\S]*?const dynamicKeys = normalizeArrowDynamicEdgeKeys\(options\.dynamicEdgeKeys\);[\s\S]*?updateTechTreeArrowFrameWarnings\(\{[\s\S]*?edgeKeys: options\.recomputeRoutes === false \? dynamicKeys : null[\s\S]*?\}\);/,
    'Expected border-warning checks to scan only dynamic edges during live drags and skip unchanged warning DOM rebuilds'
  );
  assert.match(
    source,
    /const selectNodeInPlace = \(node\) => \{[\s\S]*?selectedArrowKey = '';[\s\S]*?refreshSelectedVisuals\(selectedId\);[\s\S]*?scheduleSelectionFocusRepaint\(\);/,
    'Expected selecting a tech to refresh connected-arrow highlighting and clear the selected arrow'
  );
  assert.match(
    source,
    /const clearSelectedArrow = \(options = \{\}\) => \{[\s\S]*?selectedArrowKey = '';[\s\S]*?selectedArrowHandleIndex = null;[\s\S]*?hoveredArrowKey = '';[\s\S]*?state\.techTreeSelectedArrowKey = '';[\s\S]*?refreshSelectedVisuals\(null\);[\s\S]*?if \(options\.deferRender\) return;[\s\S]*?scheduleSelectionFocusRepaint\(\);/,
    'Expected clicking away from an arrow to clear both persistent and transient route focus'
  );
  assert.match(
    source,
    /const clearSelectedTechHighlight = \(options = \{\}\) => \{[\s\S]*?selectedId = null;[\s\S]*?refreshSelectedVisuals\(null\);[\s\S]*?\};[\s\S]*?stage\.onpointerdown = \(ev\) => \{[\s\S]*?target\.closest\('\.tech-tree-node'\)[\s\S]*?target\.closest\('\.tech-tree-route-control'\)[\s\S]*?target\.closest\('\.tech-tree-route-handle'\)[\s\S]*?clearSelectedArrow\(\{ deferRender: true \}\);[\s\S]*?clearSelectedTechHighlight\(\{ deferRender: true \}\);[\s\S]*?scheduleSelectionFocusRepaint\(\);[\s\S]*?\};/,
    'Expected plain Tech Tree stage clicks to clear both selected arrows and modal-only selected-tech highlights'
  );
  assert.match(
    source,
    /eraSelect\.addEventListener\('change', \(\) => \{[\s\S]*?selectedId = null;[\s\S]*?state\.techTreeSelectedArrowKey = '';[\s\S]*?void renderForEra\(\);[\s\S]*?\}\);/,
    'Expected changing Tech Tree eras to clear stale selected box and arrow focus before rendering the new era'
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
    /const selectedEraFromTech = getTechFieldInt\(selectedEntry, 'era', 0\);[\s\S]*?const resolvedInitialEra = Number\.isFinite\(requestedInitialEra\) \? requestedInitialEra : selectedEraFromTech;[\s\S]*?let selectedId = null;/,
    'Expected opening the Tech Tree to use the selected tech for initial era only, without selecting its box'
  );
  assert.match(
    source,
    /function openTechTreeModal\(config\) \{[\s\S]*?if \(techTreeModal\.title\) \{[\s\S]*?techTreeModal\.title\.textContent = 'Tech Tree';[\s\S]*?\}/,
    'Expected the Tech Tree modal title to stay neutral until the user selects a tech inside the modal'
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
  assert.match(
    styles,
    /\.tech-tree-route-handles-layer \{[\s\S]*?z-index: 3;[\s\S]*?pointer-events: none;[\s\S]*?\}[\s\S]*?\.tech-tree-selected-arrow-lines \{[\s\S]*?pointer-events: none;[\s\S]*?z-index: 5;[\s\S]*?\}[\s\S]*?\.tech-tree-selected-route-handles-layer \{[\s\S]*?z-index: 6;[\s\S]*?pointer-events: none;[\s\S]*?\}[\s\S]*?\.tech-tree-route-hit \{[\s\S]*?pointer-events: stroke;[\s\S]*?\}[\s\S]*?\.tech-tree-nodes \{[\s\S]*?z-index: 4;[\s\S]*?pointer-events: none;[\s\S]*?\}[\s\S]*?\.tech-tree-node \{[\s\S]*?pointer-events: auto;/,
    'Expected Tech Tree boxes to sit above ordinary arrow hit targets while selected arrows and active handles sit above boxes'
  );
  assert.match(
    styles,
    /\.tech-tree-node\.is-prereq \{[\s\S]*?rgba\(176, 80, 232[\s\S]*?\.tech-tree-node\.is-dependent \{[\s\S]*?rgba\(38, 214, 82[\s\S]*?\.tech-tree-node-game-box\.is-prereq \{[\s\S]*?rgba\(176, 80, 232[\s\S]*?\.tech-tree-node-game-box\.is-dependent \{[\s\S]*?rgba\(38, 214, 82/,
    'Expected selected tech source and target boxes to use the same purple and green relationship colors as their arrows'
  );
  assert.match(
    styles,
    /\.tech-tree-node\.selected \{[\s\S]*?0 0 22px rgba\(232, 126, 54, 0\.24\)[\s\S]*?\.tech-tree-node\.is-prereq \{[\s\S]*?0 0 22px rgba\(176, 80, 232, 0\.24\)[\s\S]*?\.tech-tree-node\.is-dependent \{[\s\S]*?0 0 22px rgba\(38, 214, 82, 0\.22\)/,
    'Expected selected and related Tech Tree boxes to keep a subtle colored glow behind the outline'
  );
  assert.match(
    styles,
    /\.tech-tree-route-control\.is-focus-dimmed \.tech-tree-route-handle \{[\s\S]*?rgba\(232, 232, 220, 0\.82\)[\s\S]*?\.tech-tree-node\.is-focus-dimmed \{[\s\S]*?opacity: 0\.46;[\s\S]*?filter: grayscale\(0\.72\) saturate\(0\.58\);/,
    'Expected selected-focus dimming to mute unrelated route handles and tech boxes'
  );
  assert.match(
    styles,
    /\.tech-tree-route-control\.selected \.tech-tree-route-handle\.selected-handle \{[\s\S]*?fill: #eaf4ff;[\s\S]*?stroke: #2a73b8;[\s\S]*?stroke-width: 2\.5;/,
    'Expected the specifically selected route handle to get a distinct stable visual state'
  );
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
    /node\.vx = nextX;[\s\S]*?node\.vy = nextY;[\s\S]*?elNode\.style\.left = `\$\{nextX\}px`;[\s\S]*?elNode\.style\.top = `\$\{nextY\}px`;[\s\S]*?redrawLines\(\{[\s\S]*?recomputeRoutes: false,[\s\S]*?dynamicEdgeKeys: linked\.map\(\(edgeObj\) => edgeObj && edgeObj\.key\)\.filter\(Boolean\)[\s\S]*?\}\);/,
    'Expected live Tech Tree box drags to move the box immediately while redrawing only connected arrow overlays'
  );
  assert.match(
    source,
    /const finishDrag = \(ev\) => \{[\s\S]*?if \(autoArrowCheck\.checked === true\) \{[\s\S]*?markCurrentArrowEraDirty\(\);[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'techtreearrowart', reason: 'tech-tree-node-drag' \}\);[\s\S]*?\}[\s\S]*?redrawLines\(\{ recomputeRoutes: false \}\);[\s\S]*?renderArrowHandles\(\);[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'technologies', reason: 'tech-tree-node-drag' \}\);[\s\S]*?\};/,
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
    /function getTechTreeAdvisorFrameLayoutArea\(nativeW, nativeH\) \{[\s\S]*?scienceAdvisorArrows\.getScienceAdvisorFrameInnerLayoutArea\(width, height\)[\s\S]*?const frameArea = getTechTreeAdvisorFrameLayoutArea\(width, height\)[\s\S]*?const frameBounds = frameArea\.bounds[\s\S]*?bounds\.exclusionZones = frameArea\.exclusionZones/,
    'Expected Auto-Position bounds to come from the shared Science Advisor frame restore geometry'
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
    /if \(autoArrowCheck\.checked === true\) \{[\s\S]*?markScienceAdvisorArrowEraDirty\(context\.eraValue\);[\s\S]*?\(context\.nodes \|\| \[\]\)\.forEach\(\(target\) => \{[\s\S]*?\(Array\.isArray\(target && target\.prereqs\) \? target\.prereqs : \[\]\)\.forEach\(\(sourceId\) => \{[\s\S]*?markScienceAdvisorArrowEdgeKeyDirty\(getTechTreeArrowRouteKeyForEra\(context\.eraValue, sourceId, targetId\)\);[\s\S]*?\}\);[\s\S]*?\}\);[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'techtreearrowart', reason: 'tech-tree-auto-position' \}\);[\s\S]*?\}/,
    'Expected Auto-Position to invalidate every generated route in the era so stale snapshots cannot detach unchanged-looking edges'
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
    /const shouldUpdateScienceAdvisorArrows = state\.settings\.mode === 'scenario'[\s\S]*?&& techTreeArrowDirtyEras\.length > 0;[\s\S]*?techTreeArrowDirtyEras: shouldUpdateScienceAdvisorArrows \? techTreeArrowDirtyEras : \[\]/,
    'Expected Save payloads to include generated arrow art only for dirty scenario eras'
  );
  assert.match(
    source,
    /function filterScienceAdvisorDirtyEdgesForSave\(dirtyEdgesByEra, routeOverrides, routeSnapshots\) \{[\s\S]*?if \(overrides\[key\]\) return;[\s\S]*?out\[eraKey\]\[key\] = true;[\s\S]*?\}/,
    'Expected Save payloads to keep dirty generated-arrow edges even when a stale preview snapshot exists'
  );
  assert.match(
    source,
    /techTreeArrowDirtyEdgesByEra: shouldUpdateScienceAdvisorArrows[\s\S]*?filterScienceAdvisorDirtyEdgesForSave\([\s\S]*?state\.techTreeArrowDirtyEdgesByEra \|\| \{\},[\s\S]*?state\.techTreeArrowRouteOverrides \|\| \{\},[\s\S]*?state\.techTreeArrowRouteSnapshots \|\| \{\}/,
    'Expected Save payloads to filter generated-arrow dirty edges against current route metadata'
  );
  assert.match(
    source,
    /const removeStoredArrowOverridesForNode = \(nodeId\) => \{[\s\S]*?delete state\.techTreeArrowRouteOverrides\[key\];[\s\S]*?delete state\.techTreeArrowRouteSnapshots\[key\];[\s\S]*?delete state\.techTreeArrowBaselineRouteHints\[key\];[\s\S]*?\};/,
    'Expected moved Tech Tree nodes to invalidate stored generated-arrow routes and baseline hints'
  );
  assert.match(
    source,
    /const cacheAlgorithmBaselineRouteHint = \(edge\) => \{[\s\S]*?if \(isArrowEdgeDirty\(key\)\) \{[\s\S]*?delete cache\[key\];[\s\S]*?return null;[\s\S]*?\}[\s\S]*?if \(cache\[key\]\) return cache\[key\];/,
    'Expected dirty generated-arrow edges to bypass stale cached baseline route hints'
  );
  assert.match(
    source,
    /const cacheRouteSnapshotForEdge = \(edgeObj, options = \{\}\) => \{[\s\S]*?if \(options\.skipSnapshot === true\) return;[\s\S]*?setRawSnapshotFromDisplayRoute\(edgeObj\.key, edgeObj\.route\);[\s\S]*?if \(options\.keepDirty !== true\) clearScienceAdvisorArrowEdgeKeyDirty\(edgeObj\.key\);[\s\S]*?\};/,
    'Expected preview-generated route snapshots to defer dirty clearing during live drags and clear it after final route caching'
  );
  assert.match(
    source,
    /const overrideRoute = useStoredRoute \? getDisplayOverrideRoute\(edgeObj\.key\) : null;[\s\S]*?const rawSnapshotRoute = useStoredRoute && !edgeDirty \? getDisplayRouteSnapshot\(edgeObj\.key\) : null;[\s\S]*?const snapshotRoute = rawSnapshotRoute && isDisplayRouteSnapshotAttachedToEdge\(edgeObj, rawSnapshotRoute\)[\s\S]*?if \(!overrideRoute && route && techBoxLayout && typeof techBoxLayout\.constrainTechTreeArrowRoute === 'function'\) \{[\s\S]*?route = techBoxLayout\.constrainTechTreeArrowRoute\(route, routeConstraintArea\);/,
    'Expected explicit user-edited arrow routes to stay raw while generated and attached cached routes are constrained to the Science Advisor frame'
  );
  assert.match(
    source,
    /linked\.forEach\(\(edgeObj\) => placeEdge\(edgeObj, \{[\s\S]*?ignoreStoredRoutes: true,[\s\S]*?keepDirty: true,[\s\S]*?skipSnapshot: true[\s\S]*?\}\)\);[\s\S]*?redrawLines\(\{ recomputeRoutes: false \}\);/,
    'Expected live Tech Tree node drags to reroute connected edges without reusing stale stored routes or writing per-frame snapshots'
  );
  assert.match(
    source,
    /renderActiveTab\(persistedView \? \{ preserveTabScroll: true \} : \{\}\);[\s\S]*?if \(persistedView && persistedView\.techTreeModalOpen && state\.activeTab === 'technologies'\) \{[\s\S]*?reopenTechTreeModalForCurrentState\(\);[\s\S]*?\} else if \(techTreeModal\.node && !techTreeModal\.node\.classList\.contains\('hidden'\)\) \{[\s\S]*?closeTechTreeModal\(\{ skipActiveTabRefresh: true \}\);[\s\S]*?\}/,
    'Expected Refresh from Disk to rebuild an open Tech Tree modal from the freshly loaded bundle'
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
  assert.match(
    source,
    /displayNodes\.forEach\(\(target\) => \{[\s\S]*?target\.prereqs\.forEach\(\(sourceId\) => \{[\s\S]*?if \(target\.autoLayout \|\| target\.era !== eraValue\) return;[\s\S]*?const source = byId\.get\(sourceId\);[\s\S]*?if \(!source \|\| !displayNodeIdSet\.has\(source\.id\)\) return;[\s\S]*?if \(source\.autoLayout \|\| source\.era !== eraValue\) return;[\s\S]*?visibleEdges\.push/,
    'Expected era-less gutter techs to remain visually unconnected from era techs'
  );
});
