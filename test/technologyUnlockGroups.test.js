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
    /techTreeArrowDirtyEras: shouldUpdateScienceAdvisorArrows \? techTreeArrowDirtyEras : \[\]/,
    'Expected generated Science Advisor arrow saves to carry the exact dirty eras instead of regenerating every era'
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
    /function snapshotTechTreeArrowStyleState\(\) \{[\s\S]*?kind: 'tech-tree-arrow-style'[\s\S]*?scienceAdvisorArrowStyle: getScienceAdvisorArrowStyleSnapshotValue\(\)[\s\S]*?techTreeArrowArtDirtyByEra: deepCloneUiValue\(state\.techTreeArrowArtDirtyByEra \|\| \{\}\)/,
    'Expected Tech Tree arrow style settings to have a dedicated undo snapshot'
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
    /if \(techTreeModal\.undoAllBtn\) techTreeModal\.undoAllBtn\.disabled = !hasEffectiveUnsavedChanges\(\);/,
    'Expected Tech Tree Undo All to activate after the first effective change'
  );
  assert.match(
    source,
    /async function undoAllChanges\(\) \{[\s\S]*?commitAllTrackedEditSessions\(\);[\s\S]*?recomputeDirtyStateFromBundle\(\);[\s\S]*?if \(!state\.bundle \|\| !hasEffectiveUnsavedChanges\(\)\)/,
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
