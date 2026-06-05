const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('Map canvas hover tooltip shows current grid coordinates', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const stylesText = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const mainText = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preloadText = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const configCoreText = fs.readFileSync(path.join(__dirname, '..', 'src', 'configCore.js'), 'utf8');

  assert.match(
    rendererText,
    /const hoverTooltip = document\.createElement\('div'\);[\s\S]*?hoverTooltip\.className = 'biq-map-hover-tooltip hidden';/,
    'map renderer should create a hover tooltip element'
  );
  assert.match(
    rendererText,
    /const mapCanvasStack = document\.createElement\('div'\);[\s\S]*?mapCanvasStack\.className = 'biq-map-canvas-stack';/,
    'map renderer should stack hover overlays directly on the map canvas'
  );
  assert.match(
    rendererText,
    /const hoverCanvas = document\.createElement\('canvas'\);[\s\S]*?hoverCanvas\.className = 'biq-map-hover-canvas';/,
    'map renderer should create a transparent hover-border canvas'
  );
  assert.doesNotMatch(
    rendererText,
    /canvas\.title\s*=/,
    'map hover should not use the native browser/OS tooltip'
  );
  assert.match(
    stylesText,
    /\.entity-form-grid \{[\s\S]*?align-items: start;[\s\S]*?\}[\s\S]*?\.entity-field \{[\s\S]*?align-content: start;/,
    'entity modal name/key fields should top-align instead of stretching when one field has helper text'
  );
  assert.match(
    rendererText,
    /const renderHoverTooltipForState = \(hit, clientX, clientY, reason = ''\) => \{[\s\S]*?hoverTooltip\.textContent = `x=\$\{geom\.xPos\}, y=\$\{geom\.yPos\}`;/,
    'hover tooltip should display the hovered tile grid coordinates'
  );
  assert.match(
    rendererText,
    /const borderFactor = Math\.max\(1, parseFieldInt\(ruleRecord, 'borderfactor', 10\)\);[\s\S]*?cityCulture = Math\.floor\(cityCulture \/ borderFactor\);/,
    'map border influence should use the BIQ Border Factor instead of hard-coded culture thresholds'
  );
  assert.match(
    rendererText,
    /const drawHoverBorder = \(hit\) => \{[\s\S]*?shadowColor = 'rgba\(196, 149, 255, 0\.52\)'[\s\S]*?hoverGradient\.addColorStop\(1, 'rgba\(244, 158, 255, 0\.96\)'\)[\s\S]*?drawTileDiamondPath\(hoverCtx, cx, cy, Math\.max\(3, Math\.round\(tilePx \/ 3\.8\)\)\);/,
    'hover border should draw a lighter inset purple-gradient diamond around the hovered tile'
  );
  assert.match(
    rendererText,
    /const BIQ_TERRAIN_LM_ATLAS_FILES = \[[\s\S]*?'Art\/Terrain\/lxtgc\.pcx'[\s\S]*?'Art\/Terrain\/lxpgc\.pcx'[\s\S]*?'Art\/Terrain\/lxdgc\.pcx'[\s\S]*?'Art\/Terrain\/lxdpc\.pcx'[\s\S]*?'Art\/Terrain\/lxdgp\.pcx'[\s\S]*?'Art\/Terrain\/lxggc\.pcx'[\s\S]*?'Art\/Terrain\/lwCSO\.pcx'[\s\S]*?'Art\/Terrain\/lwSSS\.pcx'[\s\S]*?'Art\/Terrain\/lwOOO\.pcx'[\s\S]*?\];[\s\S]*?BIQ_TERRAIN_LM_ATLAS_FILES\.forEach\(\(assetPath, idx\) => \{[\s\S]*?requestBiqMapArtAsset\(`terrain-lm-\$\{idx\}`, assetPath\);[\s\S]*?\}\);/,
    'map renderer should load the full landmark terrain atlas family alongside the standard base terrain atlases'
  );
  assert.ok(
    rendererText.includes("landmarksText.textContent = 'Label Special Terrain';")
      && rendererText.includes("landmarksWrap.title = 'Show special terrain markers';")
      && rendererText.includes("appendDebugLog('biq-map:special-terrain-toggle'")
      && rendererText.includes("terrainVariantDeepwaterHarbor: false"),
    'map display controls should label the marker toggle as special terrain and include Deepwater Harbor paint state'
  );
  assert.match(
    rendererText,
    /const canUseRecordDiffUndoForPaint = \(\) => \{[\s\S]*?mode === 'terrain'[\s\S]*?mode === 'resource'[\s\S]*?mode === 'visibility'[\s\S]*?mode === 'fog'[\s\S]*?\};[\s\S]*?const canUseRecordDiffUndoForSelectedTileEdit = \(kind, spec = null\) => \{[\s\S]*?kind === 'terrainVariants'[\s\S]*?kind === 'resource'[\s\S]*?kind === 'visibility'/,
    'map edit undo should keep the fast record-diff path for simple tile-field edits, while district and overlay edits fall back to full map snapshots for correctness'
  );
  assert.match(
    rendererText,
    /async function undoMapOneStep\(\) \{[\s\S]*?appendDebugLog\('biq-map:undo-start', \{[\s\S]*?const restorePrepareStartedAt = mapPerfNowMs\(\);[\s\S]*?const historyBuildStartedAt = mapPerfNowMs\(\);[\s\S]*?appendDebugLog\('biq-map:undo-end', \{[\s\S]*?restorePrepareMs,[\s\S]*?historyBuildMs,[\s\S]*?applyMs:[\s\S]*?totalMs:/,
    'map undo should log restore preparation, history rebuild, and apply timings so remaining undo stalls can be profiled directly'
  );
  assert.match(
    rendererText,
    /const getTerrainAtlasCacheKey = \(fileIdx, useLandmarkAtlas = false\) => \{[\s\S]*?if \(useLandmarkAtlas && idx < BIQ_TERRAIN_LM_ATLAS_FILES\.length\) return `terrain-lm-\$\{idx\}`;[\s\S]*?return `terrain-\$\{idx\}`;[\s\S]*?\};[\s\S]*?const drawTerrainSpriteToContext = \(drawCtx, record, geom, sx, sy, drawW = tileW, drawH = tileH\) => \{[\s\S]*?const useLandmarkAtlas = terrainVariantStateForTile\(record\)\.landmark;[\s\S]*?drawTerrainAtlasSpriteToContext\([\s\S]*?useLandmarkAtlas[\s\S]*?\);/,
    'map terrain rendering should switch flat tile atlases to the landmark sheets when the tile has the LM variant'
  );
  assert.ok(
    rendererText.includes('const terrainSupportsDeepwaterHarbor = (terrainCode) => terrainCode === BIQ_TERRAIN.SEA;')
      && rendererText.includes("key: 'terrainVariantDeepwaterHarbor'")
      && rendererText.includes("label: 'Deepwater Harbor'")
      && rendererText.includes('deepwaterHarbor: terrainSupportsDeepwaterHarbor(code)')
      && rendererText.includes('state.mapEditorTool.terrainVariantDeepwaterHarbor = nextState.deepwaterHarbor;'),
    'Sea terrain paint should expose Deepwater Harbor as a conditional terrain variant without storing it in c3c bonus bits'
  );
  assert.ok(
    rendererText.includes('const applyDeepwaterHarborToIndexes = (indexes, bonusMask = null) => {')
      && rendererText.includes('mapCore.applyDeepwaterHarborTerrain(tile, BIQ_TERRAIN, BIQ_TILE_BONUS, bonusMask)')
      && rendererText.includes("appendDebugLog('biq-map:deepwater-harbor-apply'")
      && rendererText.includes('const deepwaterHarbor = terrainSupportsDeepwaterHarbor(terrainCode)')
      && rendererText.includes('const changedIndexes = applyDeepwaterHarborToIndexes(indices, variantMask);')
      && rendererText.includes("setStatus('Deepwater Harbor can only be painted onto Coast tiles.');"),
    'Deepwater Harbor paint should use the special Coast-to-Sea path and report invalid target tiles'
  );
  assert.ok(
    rendererText.includes('const tileHasPreservedDeepwaterGraphics = (tileIndex) => {')
      && rendererText.includes('const expectedSea = computeSeaTerrainSpriteSpecAt(tileIndex);')
      && rendererText.includes('stored.fileIdx !== expectedSea.fileIdx || stored.imageIdx !== expectedSea.imageIdx')
      && rendererText.includes('&& tileHasPreservedDeepwaterGraphics(tileIndex);'),
    'Deepwater Harbor detection should require preserved non-Sea graphics so normal Sea tiles are not mislabeled'
  );
  assert.ok(
    rendererText.includes('const preserveDeepwaterIndexes = collectDeepwaterHarborIndexesAround(seeds);')
      && rendererText.includes('preserveDeepwaterSummary: summarizeTileIndexes(Array.from(preserveDeepwaterIndexes))')
      && rendererText.includes('normalizeCoastlineAround(new Set([...normalizationSeeds, ...changedIndexes]), changedIndexes, preserveDeepwaterIndexes);'),
    'normal Sea painting should only preserve Deepwater Harbor tiles that existed before the terrain stroke'
  );
  assert.match(
    rendererText,
    /const recalculateTerrainFileAndImageAt = \(xPos, yPos\) => \{[\s\S]*?if \(isDeepwaterHarborTile\(southIdx\)\) return;[\s\S]*?const southBase = terrainInfo\(southTile\)\.baseTerrain;/,
    'terrain sprite recalculation should preserve only tightly detected Deepwater Harbor file/image graphics during later neighboring terrain edits'
  );
  assert.match(
    rendererText,
    /const normalizeCoastlineAround = \(seedIndexes, changedIndexes, preserveDeepwaterIndexes = null\) => \{[\s\S]*?if \(!isWaterTerrain\(info\.baseTerrain\)\) return;[\s\S]*?if \(preserveDeepwaterIndexes && preserveDeepwaterIndexes\.has\(idx\)\) return;[\s\S]*?const touchesLand = mapTileNeighborIndexes\(idx\)\.some/,
    'coastline normalization should protect only preexisting Deepwater Harbor tiles, not newly painted normal Sea'
  );
  assert.ok(
    rendererText.includes("specialMarkers.push({ text: 'DH', tone: 'rgba(26, 118, 168, 0.92)' });")
      && rendererText.includes('drawVariantBadgeCentered(marker.text, marker.tone, idx, specialMarkers.length);')
      && rendererText.includes("drawTerrainPreviewBadge(hoverCtx, logical, 'DH');")
      && rendererText.includes("addOptionSummary(host, 'Special Terrain: Deepwater Harbor');"),
    'Deepwater Harbor tiles should get visible DH map markers, paint-preview badges, and selected-tile detail text'
  );
  assert.match(
    rendererText,
    /const tileDrawRect = \(sx, sy\) => \(\{[\s\S]*?\}\);[\s\S]*?const tileClipInfluenceRect = \(sx, sy\) => \(\{[\s\S]*?x: sx - Math\.round\(tileW \* 1\.08\),[\s\S]*?w: Math\.round\(tileW \* 3\.18\),[\s\S]*?h: Math\.round\(tileH \* 4\.05\)[\s\S]*?\}\);[\s\S]*?if \(clips && !clips\.some\(\(rect\) => rectIntersects\(tileClipInfluenceRect\(sx, sy\), rect\)\)\) continue;/,
    'clipped map redraws should use an expanded source-tile influence rect so long river and overlay pixels repaint when nearby edits clear their area'
  );
  assert.match(
    rendererText,
    /const diagnoseTerrainAtlasSpriteMiss = \(fileIdx, imageIdx, useLandmarkAtlas = false\) => \{[\s\S]*?reason: 'missing-atlas'[\s\S]*?reason: 'invalid-image-index'[\s\S]*?reason: 'image-row-out-of-range'[\s\S]*?\};[\s\S]*?const terrainSpriteMissStats = \{[\s\S]*?total: 0,[\s\S]*?samples: \[\][\s\S]*?\};[\s\S]*?appendDebugLog\('biq-map:terrain-sprite-miss', \{[\s\S]*?total: terrainSpriteMissStats\.total,[\s\S]*?samples: terrainSpriteMissStats\.samples[\s\S]*?\}\);/,
    'map redraws should summarize terrain sprite fallback misses so atlas-key and image-index failures can be diagnosed from one trace'
  );
  assert.match(
    rendererText,
    /const terrainUsesGrasslandBase = \(terrainCode\) => \([\s\S]*?terrainCode === BIQ_TERRAIN\.MARSH[\s\S]*?terrainCode === BIQ_TERRAIN\.HILLS[\s\S]*?terrainCode === BIQ_TERRAIN\.MOUNTAIN[\s\S]*?terrainCode === BIQ_TERRAIN\.VOLCANO[\s\S]*?\);/,
    'hill, mountain, volcano, and similar feature terrains should paint over a grassland base, matching Civ3 and Quint map semantics'
  );
  assert.ok(
    rendererText.includes("function isCanalDistrictSection(section) {")
      && rendererText.includes("const DIR_NE = 1;")
      && rendererText.includes("const DIR_N = 8;")
      && rendererText.includes("function getCanalDistrictDirections(geom) {")
      && rendererText.includes("if (!hasCanalDir && waterDirs[DIR_NE] && waterDirs[DIR_SW]) { drawDir1 = DIR_NE; drawDir2 = DIR_SW; }")
      && rendererText.includes("if (drawDir1 === DIR_NE && drawDir2 === DIR_S && waterDirs[DIR_N] && waterDirs[DIR_NE]) { drawDir1 = DIR_N; drawDir2 = DIR_S; }")
      && rendererText.includes("function requestBiqMapCanalAtlasCanvas(section, context, options = {}) {")
      && rendererText.includes("kind: 'district',")
      && rendererText.includes("drawCanalDistrictOverlay(drawCtx, districtSection, record, geom, sx, sy, tileIndex, { assetRefreshMode });"),
    'canal districts should bypass the generic district-cell preview path and use a C3X-style directional atlas render with neighbor-aware direction overrides'
  );
  assert.ok(
    rendererText.includes("function isBridgeDistrictSection(section) {")
      && rendererText.includes("function tileHasBridgeDistrictAt(xPos, yPos) {")
      && rendererText.includes("function getBridgeImageIndex(record, geom) {")
      && rendererText.includes("if ((c3cOverlays & 0x00000002) === 0x00000002) {")
      && rendererText.includes("if (swNeCount === 2) return swNe;")
      && rendererText.includes("if (neLink || swLink) return swNe;")
      && rendererText.includes("function drawBridgeDistrictOverlay(drawCtx, section, record, geom, sx, sy, tileIndex, options = {}) {")
      && rendererText.includes("drawBridgeDistrictOverlay(drawCtx, districtSection, record, geom, sx, sy, tileIndex, { assetRefreshMode });"),
    'bridge districts should bypass the generic representative-building logic and use a C3X-style bridge image index based on neighboring bridges, land links, and rail overlays'
  );
  assert.ok(
    rendererText.includes("function isPortDistrictSection(section) {")
      && rendererText.includes("function wrappedDelta(from, to, span, allowWrap) {")
      && rendererText.includes("function getPortImageVariant(record, geom) {")
      && rendererText.includes("function getPortDistrictFileName(section, record, geom) {")
      && rendererText.includes("const cityIsDirectlyNortheastOfPort = (closestDx === 1) && (closestDy === -1);")
      && rendererText.includes("if (northeastTileIsOwnedLand) variant = SW;")
      && rendererText.includes("else if (southeastTileIsOwnedLand) variant = NW;")
      && rendererText.includes("else if (southwestTileIsOwnedLand) variant = NE;")
      && rendererText.includes("else if (northwestTileIsOwnedLand) variant = SE;")
      && rendererText.includes("function requestBiqMapPortCanvas(section, context, options = {}) {")
      && rendererText.includes("fileNameOverride: fileName")
      && rendererText.includes("function drawPortDistrictOverlay(drawCtx, section, record, geom, sx, sy, tileIndex, options = {}) {")
      && rendererText.includes("const fileName = getPortDistrictFileName(section, record, geom);")
      && rendererText.includes("drawPortDistrictOverlay(drawCtx, districtSection, record, geom, sx, sy, tileIndex, { assetRefreshMode });"),
    'port districts should bypass the generic district-cell crop path, choose one of the Port_NW/NE/SE/SW files from C3X-style nearby-city and coastline direction logic, and then apply the normal era/building-column crop inside that chosen file before any pixel-offset adjustments'
  );
  assert.ok(
    rendererText.includes("function isGreatWallDistrictSection(section) {")
      && rendererText.includes("function tileHasGreatWallDistrictAtWithOwnerId(xPos, yPos, ownerId) {")
      && rendererText.includes("function getGreatWallDistrictConnections(record, geom) {")
      && rendererText.includes("parseIntLoose(ownerInfo.ownerId, -1) === parseIntLoose(ownerId, -1)")
      && rendererText.includes("function requestBiqMapGreatWallAtlasCanvas(section, options = {}) {")
      && rendererText.includes("function drawGreatWallDistrictOverlay(drawCtx, section, record, geom, sx, sy, tileIndex, options = {}) {")
      && rendererText.includes("if (wallNw) drawGreatWallSprite(DIR_NW);")
      && rendererText.includes("drawGreatWallSprite(0);")
      && rendererText.includes("if (wallSe) drawGreatWallSprite(DIR_SE);")
      && rendererText.includes("drawGreatWallDistrictOverlay(drawCtx, districtSection, record, geom, sx, sy, tileIndex, { assetRefreshMode });"),
    'great wall districts should bypass the generic district-cell preview path and render base-plus-segment art using the same raw owner-id matching as C3X, including neutral tiles'
  );
  assert.match(
    rendererText,
    /const drawPaintPreview = \(hit\) => \{[\s\S]*?const previewIndexes = getBrushTileIndexes\(hit\.index\);[\s\S]*?previewIndexes\.forEach\(\(tileIdx\) => \{[\s\S]*?hoverCtx\.globalAlpha = 0\.84;[\s\S]*?if \(mode === 'terrain'\) \{[\s\S]*?const previewVariantState = getMapToolTerrainVariantState\(effectiveTerrainCode\);[\s\S]*?drawTileDiamondPath\(hoverCtx, Math\.round\(logical\.cx\), Math\.round\(logical\.cy\), Math\.max\(2, Math\.round\(tilePx \/ 8\)\)\);[\s\S]*?hoverCtx\.fillStyle = terrainPreviewFillStyle\(baseTerrainForPaint\(effectiveTerrainCode\)\);[\s\S]*?drawSimpleTerrainPreviewOverlay\(hoverCtx, effectiveTerrainCode, sx, sy, logical, previewVariantState\);[\s\S]*?if \(mode === 'resource'\) \{[\s\S]*?hoverCtx\.drawImage\(atlas, col \* cellW, row \* cellH, cellW, cellH, dx, dy, Math\.round\(cellW \* scale\), Math\.round\(cellH \* scale\)\)[\s\S]*?if \(mode === 'district'\) \{[\s\S]*?drawDistrictOverlay\(hoverCtx, previewRecord, geom, sx, sy, 'all', \{ assetRefreshMode: 'hover-only' \}\);/,
    'paint preview should render semi-transparent previews across the whole brush footprint for terrain, resources, and district art'
  );
  assert.match(
    rendererText,
    /const getOptionMetaText = typeof opts\.getOptionMetaText === 'function' \? opts\.getOptionMetaText : null;[\s\S]*?const textWrap = document\.createElement\('span'\);[\s\S]*?textWrap\.className = 'tech-picker-row-text';[\s\S]*?const text = document\.createElement\('span'\);[\s\S]*?text\.className = 'tech-picker-row-label';[\s\S]*?const metaText = getOptionMetaText \? String\(getOptionMetaText\(opt\) \|\| ''\)\.trim\(\) : '';[\s\S]*?meta\.className = 'tech-picker-row-meta';/,
    'reference pickers should support a subtle secondary meta label for dropdown row entries'
  );
  assert.match(
    rendererText,
    /const getReferenceBiqSectionFromTab = \(referenceTab, code\) => \{[\s\S]*?fields: Array\.isArray\(entry && entry\.biqFields\) \? entry\.biqFields : \[\][\s\S]*?const getMapSupportSection = \(sectionCode\) => \{[\s\S]*?if \(code === 'RACE'\) return getReferenceBiqSectionFromTab\(civilizationReferenceTab, code\);[\s\S]*?if \(code === 'TERR' \|\| code === 'TFRM'\) return getBiqSectionFromTab\(terrainSupportTab, code\);[\s\S]*?if \(code === 'ERAS'\) return getBiqSectionFromTab\(worldSupportTab, code\);[\s\S]*?if \(code === 'RULE'\) return getBiqSectionFromTab\(rulesSupportTab, code\);[\s\S]*?if \(code === 'LEAD'\) return getBiqSectionFromTab\(playersSupportTab, code\);[\s\S]*?return null;[\s\S]*?\};[\s\S]*?const terrainSectionForPicker = getMapSupportSection\('TERR'\);/,
    'map toolbar pickers should fall back to the loaded Civs/Terrain/World/Rules/Players BIQ tabs when the scenario map tab lacks those sections'
  );
  assert.match(
    rendererText,
    /const resourceWrap = createMapToolbarStructuredPicker\({[\s\S]*?renderOptionThumb: \(\{ holder, option, value \}\) => \{[\s\S]*?prepareMapToolbarPickerThumb\(holder, 'resource'\);[\s\S]*?if \(option && option\.entry\) \{[\s\S]*?loadReferenceListThumbnail\('resources', option\.entry, holder\);[\s\S]*?return true;[\s\S]*?\}/,
    'paint-mode resource picker thumbnails should use the shared resource thumbnail loader so async art loads repaint the dropdown reliably'
  );
  assert.match(
    rendererText,
    /const makeResourceButtonThumb = \(entry, resourceId = -1\) => \{[\s\S]*?if \(entry\) \{[\s\S]*?thumb\.className = 'map-option-thumb resource';[\s\S]*?loadReferenceListThumbnail\('resources', entry, thumb\);[\s\S]*?return thumb;[\s\S]*?\}[\s\S]*?return makeEmptyButtonThumb\(\);[\s\S]*?\};[\s\S]*?const renderResourceOptions = \(host, tile\) => \{[\s\S]*?thumb: makeResourceButtonThumb\(entry, resourceId\),/,
    'tile-info resource buttons should use the same shared resource thumbnail loader as the paint toolbar for consistent async thumbnail rendering'
  );
  assert.match(
    rendererText,
    /function isResourcePreviewCellEmpty\(preview, slotIndex\) \{[\s\S]*?const indices = getResourceAtlasIndices\(preview\);[\s\S]*?const palette = getResourceAtlasPalette\(preview\);[\s\S]*?if \(indices && palette\) \{[\s\S]*?!isResourceAtlasPaletteMagenta\(palette, indices\[rowOff \+ x\]\)[\s\S]*?return true;[\s\S]*?\}[\s\S]*?function findNextResourcePreviewSlot\(preview\) \{[\s\S]*?if \(!isResourcePreviewCellEmpty\(preview, idx\)\) lastOccupied = idx;/,
    'resource imports should scan indexed PCX palette data to predict the target resources.pcx slot before Save'
  );
  assert.match(
    rendererText,
    /async function refreshPendingImportedResourceIconAssignments\(tab = null\) \{[\s\S]*?const ops = getActiveImportedIconOps\(resourceTab\);[\s\S]*?const firstSlot = getNextResourcePreviewAssignmentSlot\(preview, resourceTab, ops\);[\s\S]*?const targetIconIndex = firstSlot \+ offset;[\s\S]*?entry\._pendingImportedResourceIcon = \{[\s\S]*?sourceIconIndex,[\s\S]*?targetIconIndex,[\s\S]*?\};[\s\S]*?iconField\.value = String\(targetIconIndex\);/,
    'resource imports should assign the predicted target slot to active imported entries before Save'
  );
  assert.match(
    rendererText,
    /function createResourceIconIndexPicker\(currentValue, onSelect, entry = null\) \{[\s\S]*?let pendingIconsByTarget = new Map\(\);[\s\S]*?pendingIconsByTarget = getPendingImportedIconItemsByTarget\('resources'\);[\s\S]*?getPendingImportedIconItemForTarget\(pendingIconsByTarget, 'resources', entry, idx\)[\s\S]*?drawPendingImportedResourceIconItemToCanvas\(pendingItem, canvas\)[\s\S]*?getMaxPendingImportedIconTarget\(refreshPendingIconsByTarget\(\), 'resources', entry\)/,
    'resource icon picker should render all pending imported icons in predicted target slots even before resources.pcx is saved'
  );
  assert.match(
    rendererText,
    /getResourcesAtlasPreview\(\)\.then\(\(preview\) => \{[\s\S]*?if \(!iconWarnEl\.isConnected \|\| !preview\) return;[\s\S]*?if \(getPendingImportedResourceIcon\(entry\)\) return;[\s\S]*?if \(Math\.floor\(idx \/ metrics\.cols\) >= metrics\.rows\) \{/,
    'resource icon range warning should ignore pending imported icons that will extend resources.pcx on Save'
  );
  assert.match(
    rendererText,
    /function isUnits32PreviewCellEmpty\(preview, slotIndex\) \{[\s\S]*?const indices = getUnits32AtlasIndices\(preview\);[\s\S]*?const palette = getUnits32AtlasPalette\(preview\);[\s\S]*?if \(indices && palette\) \{[\s\S]*?!isUnits32PaletteMagenta\(palette, indices\[rowOff \+ x\]\)[\s\S]*?return true;[\s\S]*?\}[\s\S]*?function findNextUnits32PreviewSlot\(preview\) \{[\s\S]*?if \(!isUnits32PreviewCellEmpty\(preview, idx\)\) lastOccupied = idx;/,
    'unit imports should scan indexed PCX palette data to predict the target units_32.pcx slot before Save'
  );
  assert.match(
    rendererText,
    /async function refreshPendingImportedUnitIconAssignments\(tab\) \{[\s\S]*?const ops = Array\.isArray\(unitsTab\.recordOps\)[\s\S]*?getActiveImportedIconOps\(unitsTab\)[\s\S]*?const firstSlot = getNextUnits32PreviewAssignmentSlot\(preview, unitsTab, ops\);[\s\S]*?const targetIconIndex = firstSlot \+ offset;[\s\S]*?entry\._pendingImportedUnitIcon = \{[\s\S]*?sourceIconIndex,[\s\S]*?targetIconIndex,[\s\S]*?\};[\s\S]*?iconField\.value = String\(targetIconIndex\);/,
    'unit imports should assign the predicted target slot to active imported entries before Save'
  );
  assert.match(
    rendererText,
    /function createUnitIconIndexPicker\(currentValue, onSelect, entry = null\) \{[\s\S]*?let pendingIconsByTarget = new Map\(\);[\s\S]*?pendingIconsByTarget = getPendingImportedIconItemsByTarget\('units'\);[\s\S]*?getPendingImportedIconItemForTarget\(pendingIconsByTarget, 'units', entry, idx\)[\s\S]*?drawPendingImportedUnitIconItemToCanvas\(pendingItem, canvas, atlasPreview\)[\s\S]*?getMaxPendingImportedIconTarget\(refreshPendingIconsByTarget\(\), 'units', entry\)/,
    'unit icon picker should render all pending imported icons in predicted target slots even before units_32.pcx is saved'
  );
  assert.match(
    rendererText,
    /await refreshPendingImportedUnitIconAssignments\(\);[\s\S]*?if \(hasPendingImportedUnitIconWarning\(entry\)\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(getPendingImportedUnitIcon\(entry\)\) return;[\s\S]*?if \(Math\.floor\(idx \/ metrics\.cols\) >= metrics\.rows\) \{/,
    'unit icon range warning should ignore pending imported icons that will extend units_32.pcx on Save'
  );
  assert.match(
    rendererText,
    /const mapOwnerPickerValueForPlayer = \(playerId\) => `player:\$\{playerId\}`;[\s\S]*?const mapOwnerPickerValueForCivilization = \(civId\) => `civ:\$\{civId\}`;[\s\S]*?const getMapOwnerPickerOptions = \(ownerTypeRaw = null\) => \{[\s\S]*?if \(ownerType === 1\) \{[\s\S]*?return barbarianOption \? \[barbarianOption\] : \[\];[\s\S]*?if \(ownerType === 3\) \{[\s\S]*?return leadRecordsForOwner\.map[\s\S]*?ownerType:\s*3,[\s\S]*?if \(ownerType === 2 \|\| !Number\.isFinite\(ownerType\)\) \{[\s\S]*?return civilizationEntriesForOwner[\s\S]*?civIndex: getReferenceEntryIndexForOption[\s\S]*?\.filter\(\(\{ entry, civIndex \}\) => civIndex !== 0 && !isBarbarianCivilizationEntry\(entry\)\)[\s\S]*?ownerType:\s*2,[\s\S]*?const resolveMapOwnerSelection = \(value, ownerTypeHint = null\) => \{[\s\S]*?if \(isBarbarianOwnerPickerValue\(value\)\) return \{ ownerType: 1, owner: 0 \};[\s\S]*?if \(playerMatch\) return \{ ownerType: 3, owner: parseIntLoose\(playerMatch\[1\], 0\) \};[\s\S]*?if \(civMatch\) return \{ ownerType: 2, owner: parseIntLoose\(civMatch\[1\], 0\) \};/,
    'city and unit owner pickers should scope direct barbarians, players, and civilizations by selected owner type'
  );
  assert.match(
    rendererText,
    /const unitPicker = createReferencePicker\({[\s\S]*?searchPlaceholder: 'Search unit\.\.\.',[\s\S]*?noneLabel: 'Choose unit\.\.\.',[\s\S]*?getOptionMetaText: \(opt\) => Number\.isFinite\(opt && opt\.mapFrequency\) \? `\(\$\{opt\.mapFrequency\} total\)` : '',/,
    'Tile Info unit-add picker should show each unit type count for the selected owner in the dropdown list'
  );
  assert.match(
    stylesText,
    /\.tech-picker-row-text \{[\s\S]*?display: inline-flex;[\s\S]*?gap: 6px;[\s\S]*?\}[\s\S]*?\.tech-picker-row-meta \{[\s\S]*?font-size: 0\.82em;[\s\S]*?color: rgba\(36, 31, 68, 0\.45\);[\s\S]*?\}/,
    'picker row meta labels should render as subtle inline suffixes'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const midY = sy \+ Math\.floor\(tileH \/ 2\);[\s\S]*?if \(!terrainPreviewUsesTallArt\(effectiveCode\) && effectiveCode !== BIQ_TERRAIN\.FLOODPLAIN\) \{[\s\S]*?drawTerrainAtlasSpriteToContext\(drawCtx, spriteSpec\.fileIdx, spriteSpec\.imageIdx, sx, midY, tileW, tileH, !!previewVariant\.landmark\)[\s\S]*?const isPine = effectiveCode === BIQ_TERRAIN\.FOREST && !!previewVariant\.pineForest;[\s\S]*?const cols = isPine \? 6 : 4;[\s\S]*?const startRow = effectiveCode === BIQ_TERRAIN\.JUNGLE[\s\S]*?\(isPine \? 8 : 4\);/,
    'forest terrain preview should use the pine-forest sprite block when the Pine Forest variant is selected'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const midY = sy \+ Math\.floor\(tileH \/ 2\);[\s\S]*?if \(!terrainPreviewUsesTallArt\(effectiveCode\) && effectiveCode !== BIQ_TERRAIN\.FLOODPLAIN\) \{[\s\S]*?const spriteSpec = resolveTerrainPreviewSpriteSpec\(effectiveCode\);[\s\S]*?drawTerrainAtlasSpriteToContext\(drawCtx, spriteSpec\.fileIdx, spriteSpec\.imageIdx, sx, midY, tileW, tileH, !!previewVariant\.landmark\)[\s\S]*?return;[\s\S]*?\}/,
    'flat terrain paint previews should render from the same terrain atlases, including landmark variants'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const forestSheet = previewVariant\.landmark[\s\S]*?\(state\.biqMapArtCache\.lmForests \|\| state\.biqMapArtCache\.grasslandForests\)[\s\S]*?: state\.biqMapArtCache\.grasslandForests;/,
    'forest terrain preview should use LM forest art when the landmark variant is selected'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const hillSheet = previewVariant\.landmark[\s\S]*?\(state\.biqMapArtCache\.lmHills \|\| state\.biqMapArtCache\.hills\)[\s\S]*?: state\.biqMapArtCache\.hills;/,
    'hill terrain preview should use LM hill art when the landmark variant is selected'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const previewVariant = variantState \|\| \{\};[\s\S]*?const mountainSheet = previewVariant\.landmark[\s\S]*?: \([\s\S]*?previewVariant\.snowCappedMountain[\s\S]*?\(state\.biqMapArtCache\.snowMountains \|\| state\.biqMapArtCache\.mountains\)[\s\S]*?: state\.biqMapArtCache\.mountains[\s\S]*?\);/,
    'mountain terrain preview should use snow-capped mountain art when the Snow-Capped variant is selected'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const mountainSheet = previewVariant\.landmark[\s\S]*?\(state\.biqMapArtCache\.lmMountains \|\| state\.biqMapArtCache\.mountains\)[\s\S]*?: \([\s\S]*?previewVariant\.snowCappedMountain/,
    'mountain terrain preview should prefer LM mountain art over snow variants when the landmark variant is selected'
  );
  assert.match(
    rendererText,
    /if \(mode === 'overlay'\) \{[\s\S]*?(drawSheetSpriteScaledToContext\(hoverCtx, state\.biqMapArtCache\.mtnRivers, 4, 4, 15, sx, midY, tileW, tileH\)|drawSheetSpriteScaledToContext\(hoverCtx, state\.biqMapArtCache\.roads, 16, 16, 0, sx, midY, tileW, tileH\))[\s\S]*?hoverCtx\.restore\(\);[\s\S]*?return;/,
    'paint preview should render river and other overlay previews directly inside hovered tiles'
  );
  assert.match(
    rendererText,
    /const mapOverlayArtCropCache = new Map\(\);[\s\S]*?function getMapOverlayArtRegion\(specOrValue\) \{[\s\S]*?case 'outpost':[\s\S]*?case 'victorypoint':[\s\S]*?function getMapOverlayArtCrop\(region, options = \{\}\) \{[\s\S]*?if \(!options\.trimTransparent\) return \{ atlas, sx, sy, sw, sh \};/,
    'overlay picker art should define per-overlay atlas regions and support transparent-bounds trimming for thumbnail and preview reuse'
  );
  assert.match(
    rendererText,
    /const crop = getMapOverlayArtCrop\(getMapOverlayArtRegion\(overlaySpec\), \{ trimTransparent: true \}\);[\s\S]*?const isColonyLike = overlayType === 'colony' \|\| overlayType === 'airfield' \|\| overlayType === 'outpost' \|\| overlayType === 'radartower';[\s\S]*?const isSmallPreviewOverlay = overlayType === 'victorypoint' \|\| overlayType === 'outpost' \|\| overlayType === 'radartower' \|\| overlayType === 'barricade';[\s\S]*?isSmallPreviewOverlay \? 0\.4 : \(isColonyLike \? 0\.54 : \(crop\.sh > crop\.sw \? 0\.72 : 0\.88\)\)[\s\S]*?isSmallPreviewOverlay \? 0\.82 : \(isColonyLike \? 1\.1 : \(crop\.sh > crop\.sw \? 1\.55 : 1\.05\)\)[\s\S]*?const anchorBottom = isColonyLike;[\s\S]*?hoverCtx\.drawImage\(crop\.atlas, crop\.sx, crop\.sy, crop\.sw, crop\.sh, dx, dy, drawW, drawH\);/,
    'overlay drag previews should render directly from trimmed overlay art with larger fitted sizing and bottom anchoring for colony-like overlays'
  );
  assert.match(
    rendererText,
    /label:\s*'Overlay',[\s\S]*?includeNone:\s*true,[\s\S]*?noneLabel:\s*'None'[\s\S]*?makeMapGlyphIcon\('⌫', 'Clear overlays', 'neutral'\)[\s\S]*?if \(overlayType === '-1'\) \{[\s\S]*?const changedIndexes = clearAllOverlaysAtIndexes\(indices\);[\s\S]*?clearAll:\s*true[\s\S]*?if \(overlayType === '-1'\) \{[\s\S]*?hoverCtx\.fillText\('⌫'/,
    'overlay paint picker should expose a None option with a clear glyph and route paint-mode clicks through full overlay clearing'
  );
  assert.match(
    rendererText,
    /label:\s*'District',[\s\S]*?includeNone:\s*true,[\s\S]*?noneLabel:\s*'None'[\s\S]*?makeMapGlyphIcon\('⌫', 'Clear district', 'neutral'\)[\s\S]*?state\.mapEditorTool\.districtType = parseIntLoose\(value, -1\);[\s\S]*?const enabled = type >= 0 && !\(state\.mapEditorTool && state\.mapEditorTool\.remove\);[\s\S]*?if \(districtType < 0\) \{[\s\S]*?hoverCtx\.fillText\('⌫'/,
    'district paint picker should expose a None option with a clear glyph and treat negative district types as erase mode'
  );
  assert.match(
    rendererText,
    /const onMapHotkeyDown = \(ev\) => \{[\s\S]*?const key = String\(ev\.key \|\| ''\)\.toLowerCase\(\);[\s\S]*?const hasCommandModifier = !!\(ev\.metaKey \|\| ev\.ctrlKey\);[\s\S]*?if \(hasCommandModifier && key === 'z' && !ev\.shiftKey && !ev\.altKey\) \{[\s\S]*?ev\.preventDefault\(\);[\s\S]*?ev\.stopPropagation\(\);[\s\S]*?undoMapOneStep\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?if \(hotkeyMap\[key\]\)/,
    'map modal should bind Ctrl/Cmd+Z to the same scoped map undo action as the Undo button'
  );
  assert.match(
    rendererText,
    /const drawSelectedTileBorder = \(drawCtx = hoverCtx\) => \{[\s\S]*?state\.biqMapSelectedTile[\s\S]*?strokeStyle = 'rgba\(58, 32, 139, 0\.98\)'[\s\S]*?drawTileDiamondPath\(drawCtx, cx, cy, 0\);/,
    'selected tile should draw a darker persistent outer purple selection marker'
  );
  assert.match(
    rendererText,
    /const tileLogicalCenter = \(sx, sy\) => \(\{[\s\S]*?cy: sy \+ tileH[\s\S]*?\}\);/,
    'hover and selected-tile outlines should use Civ3 logical tile anchors, not the upper terrain sprite center'
  );
  assert.match(
    rendererText,
    /const logical = tileLogicalCenter\(basePos\.sx \+ wrapOffset\.dx, basePos\.sy \+ wrapOffset\.dy\);[\s\S]*?const tx = logical\.cx;[\s\S]*?const ty = logical\.cy;/,
    'map hit testing should use the same logical tile center as the hover outline'
  );
  assert.match(
    rendererText,
    /const coastTerrainInfo = \(\) => \(\{[\s\S]*?baseTerrain: BIQ_TERRAIN\.COAST,[\s\S]*?realTerrain: BIQ_TERRAIN\.COAST[\s\S]*?\}\);[\s\S]*?const terrainInfoForTransitionNeighbor = \(record\) => \([\s\S]*?record \? terrainInfo\(record\) : coastTerrainInfo\(\)[\s\S]*?\);[\s\S]*?const westBase = terrainInfoForTransitionNeighbor\(getTileAtCoord\(geom\.xPos - 1, geom\.yPos - 1\)\)\.baseTerrain;[\s\S]*?const northBase = terrainInfoForTransitionNeighbor\(getTileAtCoord\(geom\.xPos, geom\.yPos - 2\)\)\.baseTerrain;[\s\S]*?const eastBase = terrainInfoForTransitionNeighbor\(getTileAtCoord\(geom\.xPos \+ 1, geom\.yPos - 1\)\)\.baseTerrain;/,
    'terrain transition rendering should treat missing non-wrapping edge neighbors as coast instead of falling back to grassland'
  );
  assert.match(
    rendererText,
    /if \(mode === 'visibility' \|\| mode === 'fog'\) \{[\s\S]*?getMapFieldStoredValue\(tile, 'fogofwar', addFog \? '1' : '0'\)[\s\S]*?setMapFieldValue\(tile, 'fogofwar', nextValue, 'Fog Of War'\);/,
    'fog paint should compare against the stored/raw fog value and write through setMapFieldValue so the map overlay updates immediately'
  );
  assert.ok(
    rendererText.includes("function parseIntLoose(value, fallback = 0)")
      && rendererText.includes("if (lower === 'false') return 0;")
      && rendererText.includes("if (lower === 'true') return 1;")
      && rendererText.includes("const referenceMatch = s.match(/\\((-?\\d+)\\)\\s*$/);")
      && rendererText.includes("if (referenceMatch) return Number.parseInt(referenceMatch[1], 10);"),
    'map numeric parsing should treat BIQ boolean strings as 0/1 and prefer trailing reference ids over label numbers'
  );
  assert.match(
    rendererText,
    /categorySelect\.addEventListener\('change', \(\) => \{[\s\S]*?const previousToolState = \{[\s\S]*?const nextToolState = \{[\s\S]*?const fogOverlayChanged = getShouldShowVisibilityFogOverlayForState\(previousToolState\) !== getShouldShowVisibilityFogOverlayForState\(nextToolState\);[\s\S]*?refreshMapViewForToolChange\(\{ redrawCanvas: fogOverlayChanged \}\);[\s\S]*?\}\);/,
    'category switches should only redraw the map canvas when they toggle Fog of War overlay visibility'
  );
  assert.match(
    rendererText,
    /const buildMapSelectionCategorySelect = \(value, options = \{\}\) => \{[\s\S]*?select\.addEventListener\('change', \(\) => \{[\s\S]*?const previousToolState = \{[\s\S]*?const nextToolState = \{[\s\S]*?const fogOverlayChanged = getShouldShowVisibilityFogOverlayForState\(previousToolState\) !== getShouldShowVisibilityFogOverlayForState\(nextToolState\);[\s\S]*?refreshMapViewForToolChange\(\{ redrawCanvas: fogOverlayChanged \}\);[\s\S]*?\}\);/,
    'select-mode category dropdown should use the same fog-aware redraw gating as the paint toolbar category switch'
  );
  assert.match(
    rendererText,
    /if \(typeof state\.biqMapControlModifierHeld !== 'boolean'\) state\.biqMapControlModifierHeld = false;[\s\S]*?let controlMoveActive = !!state\.biqMapControlModifierHeld;[\s\S]*?const onMapControlKeyDown = \(ev\) => \{[\s\S]*?state\.biqMapControlModifierHeld = true;[\s\S]*?const onMapControlKeyUp = \(ev\) => \{[\s\S]*?state\.biqMapControlModifierHeld = false;[\s\S]*?const onMapControlWindowBlur = \(\) => \{[\s\S]*?state\.biqMapControlModifierHeld = false;[\s\S]*?setControlMoveActive\(false\);[\s\S]*?\};/,
    'temporary Ctrl-based zoom/pan mode should persist across map rerenders by storing the live Control-held state in shared map state'
  );
  assert.match(
    rendererText,
    /floatingRight = document\.createElement\('div'\);[\s\S]*?floatingRight\.className = 'biq-map-floating-panel biq-map-floating-right';[\s\S]*?if \(state\.biqMapTileInfoDockLeft\) floatingRight\.classList\.add\('dock-left'\);[\s\S]*?const updateTileInfoDockSide = \(\) => \{[\s\S]*?if \(tileInfoPanel\.classList\.contains\('hidden'\)\) \{[\s\S]*?state\.biqMapTileInfoDockLeft = false;[\s\S]*?const shouldDockLeft = shouldAutoDockTileInfoLeftNearRightEdge\(\) && distanceFromRight <= flipThreshold;[\s\S]*?state\.biqMapTileInfoDockLeft = shouldDockLeft;[\s\S]*?floatingRight\.classList\.toggle\('dock-left', shouldDockLeft\);/,
    'tile-info dock side should persist across full map rerenders and honor the auto-dock setting before flipping left'
  );
  assert.match(
    rendererText,
    /function shouldAutoDockTileInfoLeftNearRightEdge\(\) \{[\s\S]*?return !state\.settings \|\| state\.settings\.mapAutoDockTileInfoLeft !== false;[\s\S]*?\}/,
    'tile-info auto-docking should be controlled by a dedicated default-on map setting'
  );
  assert.match(
    rendererText,
    /if \(typeof state\.settings\.mapAutoDockTileInfoLeft !== 'boolean'\) \{[\s\S]*?state\.settings\.mapAutoDockTileInfoLeft = true;[\s\S]*?\}/,
    'older saved settings should default tile-info auto-docking to enabled'
  );
  assert.match(
    preloadText,
    /onMapSettingsMenuSelect: \(handler\) => \{[\s\S]*?ipcRenderer\.on\('manager:map-settings-selected', listener\);/,
    'preload should expose map settings menu updates to the renderer'
  );
  assert.match(
    mainText,
    /label: 'Map',[\s\S]*?label: 'Auto-Dock Tile Info Left Near Right Edge',[\s\S]*?checked: currentMapAutoDockTileInfoLeft,[\s\S]*?sendMapAutoDockTileInfoLeftSelection\(item && item\.checked\)/,
    'File -> Settings should expose a default-on Map toggle for tile-info auto-docking'
  );
  assert.match(
    mainText,
    /label: 'Units',[\s\S]*?label: 'Automatically Add Imported Unit Icons to units_32\.pcx',[\s\S]*?checked: currentAutoAddImportedUnitIcons,[\s\S]*?sendAutoAddImportedUnitIconsSelection\(item && item\.checked\)/,
    'File -> Settings should expose a default-on Units toggle for units_32 import updates'
  );
  assert.match(
    rendererText,
    /if \(typeof state\.settings\.reloadAfterSave !== 'boolean'\) \{[\s\S]*?state\.settings\.reloadAfterSave = false;[\s\S]*?\}/,
    'older saved settings should default Reload After Save to disabled'
  );
  assert.match(
    rendererText,
    /function shouldReloadBundleAfterSave\(\) \{[\s\S]*?return !!\(state\.settings && state\.settings\.reloadAfterSave\);[\s\S]*?\}/,
    'post-save reload should be gated by the dedicated Reload After Save setting'
  );
  assert.match(
    rendererText,
    /if \(!shouldReloadBundleAfterSave\(\)\) \{[\s\S]*?markCurrentBundleCleanAfterSave\([\s\S]*?\);[\s\S]*?Skipped post-save bundle reload because Reload After Save is off/,
    'Save should keep the current bundle open and mark it clean when Reload After Save is disabled'
  );
  assert.match(
    rendererText,
    /function rerunQualityChecksAfterNoReloadSave\(\) \{[\s\S]*?void runBundleAudit\(buildAuditPayloadFromState\(\)\);[\s\S]*?\}/,
    'no-reload saves should rerun quality checks against the current in-memory bundle so stale warnings clear'
  );
  assert.match(
    rendererText,
    /function finalizeSavedAtlasStateAfterNoReload\(saveReport\) \{[\s\S]*?const kinds = getSavedAtlasKinds\(saveReport\);[\s\S]*?clearSavedAtlasPreviewCaches\(kinds\);[\s\S]*?clearSavedImportedAtlasPendingState\(kinds\);[\s\S]*?\}/,
    'no-reload saves should clear saved Resource and Unit atlas preview caches and pending overlays'
  );
  assert.match(
    rendererText,
    /if \(!shouldReloadBundleAfterSave\(\)\) \{[\s\S]*?const rerenderAfterAtlasSave = finalizeSavedAtlasStateAfterNoReload\(res\.saveReport\);[\s\S]*?markCurrentBundleCleanAfterSave\([\s\S]*?\);[\s\S]*?rerunQualityChecksAfterNoReloadSave\(\);[\s\S]*?if \(rerenderAfterAtlasSave\) renderActiveTab\(\{ preserveTabScroll: true \}\);[\s\S]*?setStatus\(`Saved \$\{res\.saveReport\.length\} file\(s\): \$\{paths\}`\);/,
    'successful no-reload saves should refresh audit warnings and re-render atlas pickers after saved Resource or Unit atlas writes'
  );
  assert.match(
    rendererText,
    /function getPendingBiqOperationDirtyTabs\(tabs\) \{[\s\S]*?Array\.isArray\(tab\.recordOps\) && tab\.recordOps\.length > 0[\s\S]*?customRulesMutation[\s\S]*?customPlayerDataMutation[\s\S]*?mapMutation[\s\S]*?\}/,
    'renderer save payloads should treat pending BIQ record and structure operations as dirty even if cached dirty counts are stale'
  );
  assert.match(
    rendererText,
    /const dirtyTabSet = new Set\(Object\.keys\(\(state\.bundle && state\.bundle\.tabs\) \|\| \{\}\)\.filter\(\(key\) => getTabDirtyCount\(key\) > 0\)\);[\s\S]*?getPendingBiqOperationDirtyTabs\(tabsToSave\)\.forEach\(\(key\) => dirtyTabSet\.add\(key\)\);[\s\S]*?const dirtyTabs = Array\.from\(dirtyTabSet\);/,
    'saveCurrentBundle should include pending BIQ operation tabs in dirtyTabs before calling saveBundle'
  );
  assert.match(
    preloadText,
    /onReloadAfterSaveMenuSelect: \(handler\) => \{[\s\S]*?ipcRenderer\.on\('manager:reload-after-save-selected', listener\);/,
    'preload should expose Reload After Save menu updates to the renderer'
  );
  assert.match(
    mainText,
    /label: 'Reload After Save',[\s\S]*?checked: currentReloadAfterSave,[\s\S]*?sendReloadAfterSaveSelection\(item && item\.checked\)/,
    'File -> Settings should expose a default-off Reload After Save toggle'
  );
  assert.match(
    configCoreText,
    /function hasPendingBiqOperationPayload\(tabs\) \{[\s\S]*?REFERENCE_TAB_SPECS[\s\S]*?Array\.isArray\(tab\.recordOps\) && tab\.recordOps\.length > 0[\s\S]*?BIQ_STRUCTURE_TAB_SPECS[\s\S]*?mapMutation[\s\S]*?\}/,
    'save planning should detect pending BIQ operations independently of renderer dirtyTabs'
  );
  assert.match(
    configCoreText,
    /function hasPendingBiqFieldEditPayload\(tabs\) \{[\s\S]*?collectBiqReferenceEdits\(source\)\.length > 0[\s\S]*?collectBiqStructureEdits\(source\)\.length > 0[\s\S]*?collectBiqMapEdits\(source\)\.length > 0;/,
    'save planning should defensively detect BIQ field edits before trusting non-BIQ dirtyTabs'
  );
  assert.match(
    configCoreText,
    /const hasPendingBiqOperations = hasPendingBiqOperationPayload\(payload\.tabs \|\| \{\}\);[\s\S]*?const hasPendingBiqFieldEdits = dirtyTabsAreOnlyNonBiq && !hasPendingBiqOperations[\s\S]*?hasPendingBiqFieldEditPayload\(payload\.tabs \|\| \{\}\)[\s\S]*?const shouldCollectBiqEdits = !dirtyTabsAreOnlyNonBiq[\s\S]*?\|\| hasPendingBiqOperations[\s\S]*?\|\| hasPendingBiqFieldEdits[\s\S]*?\|\| !!scenarioContext\.autoCreatedSearchValue;/,
    'save planning should not skip BIQ collection when the payload contains pending record operations or field edits'
  );
  assert.doesNotMatch(
    rendererText,
    /const buildMapSelectionCategorySelect = \(value, options = \{\}\) => \{[\s\S]*?scheduleTileInfoRender\(\);[\s\S]*?refreshMapViewForToolChange\(\);/,
    'select-mode category changes should not queue an extra tile-info render and unconditional full map refresh'
  );
  assert.match(
    rendererText,
    /const BARBARIAN_OWNER_PICKER_VALUE = 'barbarian-civ';[\s\S]*?const getMapOwnerPickerOptions = \(ownerTypeRaw = null\) => \{[\s\S]*?return barbarianOption \? \[barbarianOption\] : \[\];[\s\S]*?const applyCityOwnerSelection = \(value, options = \{\}\) => \{[\s\S]*?const ownerSpec = resolveMapOwnerSelection\(value, getCityOwnerType\(\)\);[\s\S]*?setMapFieldValue\(cityRecord, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(cityRecord, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?colocatedUnits\.forEach\(\(record\) => \{[\s\S]*?setMapFieldValue\(record, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(record, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?\}\);[\s\S]*?scheduleMapEditRerender\(0, \{[\s\S]*?territoryChanged:\s*true/,
    'changing a city owner in tile info should also transfer any units on that same tile to the new owner and force an immediate territory-aware map rerender'
  );
  assert.match(
    rendererText,
    /setMapFieldValue\(cityRecord, 'name', nextValue, 'Name'\);[\s\S]*?setDirty\(true\);[\s\S]*?scheduleMapPartialRefresh\(\[state\.biqMapSelectedTile\], 120, \{[\s\S]*?source: 'city-title'/,
    'renaming a city should redraw only the selected map area instead of refreshing the whole map canvas'
  );
  assert.match(
    rendererText,
    /if \(refreshMode === 'partial'\) \{[\s\S]*?scheduleMapPartialRefresh\(\[state\.biqMapSelectedTile\], 180, \{[\s\S]*?source: 'city-field'[\s\S]*?\}\);[\s\S]*?\} else if \(refreshMode === 'canvas'\)[\s\S]*?addCityField\(\{ key: 'size', label: 'Population', type: 'number', min: 1, refreshMode: 'partial', live: true \}\);[\s\S]*?addCityField\(\{ key: 'culture', label: 'Culture', type: 'number', min: 0, refreshMode: 'rerender', live: false \}\);/,
    'city population should use the clipped partial-refresh path while culture remains on the territory-aware rerender path'
  );
  assert.match(
    rendererText,
    /const isCityWallsImprovementRecord = \(buildingRecord, improvementEntry\) => \{[\s\S]*?bldgwalls[\s\S]*?citywalls[\s\S]*?\};[\s\S]*?const syncCityWallsFlagFromBuildings = \(cityRecord, buildingSet, buildingRecords\) => \{[\s\S]*?setMapFieldValue\(cityRecord, 'haswalls', nextHasWalls, 'Has Walls'\);[\s\S]*?\};[\s\S]*?setCityBuildingSet\(cityRecord, currentSet\);[\s\S]*?const wallsChanged = syncCityWallsFlagFromBuildings\(cityRecord, currentSet, bldgRecords\);[\s\S]*?scheduleMapPartialRefresh\(refreshTileIndexes, 60, \{[\s\S]*?source: 'city-building'[\s\S]*?wallsChanged/,
    'city Buildings edits should sync the game wall flag and use the existing partial redraw path so city wall art updates immediately'
  );
  assert.match(
    rendererText,
    /const renderCityOptions = \(host, tile, geom\) => \{[\s\S]*?if \(!cityRecord\) \{[\s\S]*?tileInfoPanel\.style\.removeProperty\('--tile-info-owner-tint'\);[\s\S]*?tileInfoPanel\.classList\.remove\('tile-info-owner-tinted'\);/,
    'empty city tile-info state should clear any prior civ tint before rendering its neutral no-city card'
  );
  assert.match(
    rendererText,
    /const applyUnitOwnerSelection = \(value, options = \{\}\) => \{[\s\S]*?const ownerSpec = resolveMapOwnerSelection\(value, activeOwnerType\);[\s\S]*?units\.forEach\(\(record\) => \{[\s\S]*?setMapFieldValue\(record, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(record, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?\}\);[\s\S]*?const colocatedCity = getCityRecordForTile\(tile, geom\);[\s\S]*?if \(colocatedCity\) \{[\s\S]*?setMapFieldValue\(colocatedCity, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(colocatedCity, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?\}[\s\S]*?fullMapRerender:\s*!!colocatedCity/,
    'changing unit owners in tile info should also transfer any city on that tile and trigger a full map rerender when territory ownership changes'
  );
  assert.match(
    rendererText,
    /const getBarbarianOwnerPickerOption = \(\) => \{[\s\S]*?const entry = getBarbarianCivilizationPickerEntry\(\);[\s\S]*?return \{[\s\S]*?value: BARBARIAN_OWNER_PICKER_VALUE,[\s\S]*?ownerType: 1,[\s\S]*?owner: 0/,
    'city and unit owner pickers should expose barbarians only through direct barbarian assignment'
  );
  assert.match(
    rendererText,
    /const renderUnitOptions = \(host, tile, geom\) => \{[\s\S]*?const units = getUnitRecordsForTile\(geom\);[\s\S]*?const territoryOwnerValue = \(\(\) => \{[\s\S]*?const territoryInfo = resolveTileTerritoryInfo\(tile, geom\);[\s\S]*?return ownerRaw \? getMapOwnerPickerValueFromOwnership\(String\(territoryInfo\.ownerType \|\| ''\), ownerRaw\) : '';[\s\S]*?\}\)\(\);[\s\S]*?if \(realUnitOwnerValue !== 'mixed' && realUnitOwnerValue !== ''\) \{[\s\S]*?activeOwnerValue = String\(realUnitOwnerValue\);[\s\S]*?\} else if \(!units\.length && territoryOwnerValue[\s\S]*?activeOwnerValue = territoryOwnerValue;[\s\S]*?if \(!units\.length\) \{[\s\S]*?tileInfoPanel\.style\.removeProperty\('--tile-info-owner-tint'\);[\s\S]*?tileInfoPanel\.classList\.remove\('tile-info-owner-tinted'\);/,
    'empty unit tile-info state should clear any prior civ tint before rendering its neutral no-units card'
  );
  assert.match(
    rendererText,
    /canvas\.addEventListener\('pointermove', \(ev\) => \{[\s\S]*?updateHoverTooltip\(ev\);/,
    'map canvas should update the coordinate tooltip on pointer movement'
  );
  assert.match(
    rendererText,
    /const onPaintEnd = \(ev\) => \{[\s\S]*?const didEdit = !!paintStroke\.didEdit;[\s\S]*?paintStroke = null;[\s\S]*?hideHoverTooltip\(didEdit \? 'paint-end' : 'paint-end-noop'\);[\s\S]*?if \(didEdit\) setDirty\(true, \{ knownDirtyTab: 'map', reason: 'paint-stroke' \}\);[\s\S]*?if \(ev && typeof ev\.pointerId === 'number'\)/,
    'finishing a paint stroke should clear the hover preview layer before the map dirty-state work and use the fast known-dirty map path instead of a full snapshot comparison'
  );
  assert.match(
    rendererText,
    /function applyEditableSnapshotToCurrentBundle\(targetSnapshot, options = \{\}\) \{[\s\S]*?const isMapRecordDiffSnapshot = !!\([\s\S]*?targetSnapshot\.kind === 'map-record-diff'[\s\S]*?\);[\s\S]*?if \(isMapRecordDiffSnapshot\) \{[\s\S]*?mergedTabs\.map = applyMapRecordDiffToTab\(mergedTabs\.map, targetSnapshot\);[\s\S]*?\}[\s\S]*?if \(restoredKeys\.length === 0\) \{[\s\S]*?if \(isMapRecordDiffSnapshot\) \{[\s\S]*?state\.bundle\.tabs = mergedTabs;[\s\S]*?\} else \{[\s\S]*?EDITABLE_TAB_KEYS\.forEach\(\(key\) => \{[\s\S]*?delete mergedTabs\[key\];[\s\S]*?\}\);[\s\S]*?state\.bundle\.tabs = mergedTabs;[\s\S]*?\}[\s\S]*?\}/,
    'map-record-diff undo should keep the current editable tabs intact and only patch the map tab instead of falling through the empty-snapshot tab wipe path'
  );
  assert.match(
    rendererText,
    /function restoreMapRecordContentsInPlace\(targetRecord, restoredRecord, sectionCode\) \{[\s\S]*?Object\.keys\(targetRecord\)\.forEach\(\(key\) => \{[\s\S]*?delete targetRecord\[key\];[\s\S]*?\}\);[\s\S]*?Object\.assign\(targetRecord, restored\);[\s\S]*?tagMapRecordSectionCode\(targetRecord, sectionCode\);[\s\S]*?return targetRecord;[\s\S]*?\}[\s\S]*?function applyMapRecordDiffToTab\(mapTab, snapshot\) \{[\s\S]*?section\.records\[idx\] = restoreMapRecordContentsInPlace\(section\.records\[idx\], before, sectionCode\);/,
    'map-record-diff undo should restore TILE record contents in place so the open map modal coordinate cache does not keep stale pre-undo terrain neighbors'
  );
  assert.match(
    rendererText,
    /const redrawMapAfterTileChanges = \(changedIndexes, options = \{\}\) => \{[\s\S]*?const expandedIndexes = expandTileIndexesForRedraw\(changedIndexes, options\);[\s\S]*?redrawMapCanvasInPlace\(redrawRects\);[\s\S]*?\};[\s\S]*?const redrawMapCanvasInPlace = \(clipRects = null, renderOptions = \{\}\) => \{[\s\S]*?if \(useChunkedMapRenderer && !\(renderOptions && renderOptions\.chunkDraw\)\) \{[\s\S]*?redrawChunkedMapCanvas\(clipRects, \{ force: true \}\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?const candidateIndexes = Array\.isArray\(renderOptions && renderOptions\.candidateIndexes\)[\s\S]*?const candidateCount = candidateIndexes \? candidateIndexes\.length : maxIdx \+ 1;[\s\S]*?candidateMode: candidateIndexes \? 'bounded' : 'full'[\s\S]*?for \(let drawPos = 0; drawPos < candidateCount; drawPos \+= 1\) \{[\s\S]*?const i = candidateTileIndexAt\(drawPos\);/,
    'partial map redraws should clip output to edit regions, route oversized maps through chunks, and use bounded candidates only for chunk-internal repaints'
  );
  assert.match(
    rendererText,
    /const shouldSuppressHoverTooltipForEvent = \(ev\) => \{[\s\S]*?const movement = Math\.max\(Math\.abs\(dx\), Math\.abs\(dy\)\);[\s\S]*?if \(movement <= 2\) \{[\s\S]*?return true;[\s\S]*?\}[\s\S]*?clearMapHoverResumeGate\('pointer-moved'\);[\s\S]*?return false;[\s\S]*?\};[\s\S]*?const updateHoverTooltip = \(ev\) => \{[\s\S]*?if \(shouldSuppressHoverTooltipForEvent\(ev\)\) \{[\s\S]*?hideHoverTooltip\(\);[\s\S]*?return;[\s\S]*?\}/,
    'hover preview should stay hidden after a paint stroke until the pointer actually moves again, preventing post-mouseup hover redraws from making the brush preview appear stuck'
  );
  assert.match(
    rendererText,
    /const hideHoverTooltip = \(reason = ''\) => \{[\s\S]*?hoverTooltip\.classList\.add\('hidden'\);[\s\S]*?clearHoverLayer\(\);[\s\S]*?appendDebugLog\('biq-map:hover-layer'/,
    'hover-layer clears should emit explicit debug logs so paint-end overlay stalls can be compared against dirty-UI and minimap timings'
  );
  assert.match(
    rendererText,
    /function flushDirtyUiRefresh\(\) \{[\s\S]*?const startedAt = mapPerfNowMs\(\);[\s\S]*?appendDebugLog\('biq-map:dirty-ui-refresh'/,
    'dirty-UI refresh should log map-scoped timing so Save-button enablement can be correlated with any lingering post-paint overlay delay'
  );
  assert.match(
    rendererText,
    /function flushDirtyUiRefresh\(\) \{[\s\S]*?updateActiveDirtyCachesMs[\s\S]*?snapshotCompareMs[\s\S]*?appendDebugLog\('biq-map:dirty-ui-refresh-phase'/,
    'dirty-UI refresh logging should break out dirty-cache and snapshot-compare time so long post-paint stalls can be attributed to a specific sub-step'
  );
  assert.match(
    rendererText,
    /const applySelectedTileEdit = \(editFn, options = \{\}\) => \{[\s\S]*?setDirty\(true, \{ knownDirtyTab: 'map', reason: 'selected-tile-edit' \}\);/,
    'selected-tile map edits should also use the fast known-dirty map path so save-button enablement does not wait on a whole-bundle dirty snapshot'
  );
  assert.match(
    rendererText,
    /function setDirty\(next, options = \{\}\) \{[\s\S]*?const knownDirtyTab = next[\s\S]*?if \(knownDirtyTab\) \{[\s\S]*?state\.isDirty = true;[\s\S]*?setTabDirtyCount\(knownDirtyTab, Math\.max\(1, previousCount\)\);[\s\S]*?scheduleDirtyUiRefresh\([^)]*\);[\s\S]*?return;[\s\S]*?\}/,
    'setDirty should support a known-dirty-tab fast path so map edits can skip the first-dirty full snapshot comparison'
  );
  assert.match(
    rendererText,
    /drawHoverBorder\(hit\);[\s\S]*?drawPaintPreview\(hit\);/,
    'paint mode should draw the selected paint preview into the hovered tile as the pointer moves'
  );
  assert.match(
    rendererText,
    /refreshMapHoverPreviewFromState = \(reason = ''\) => \{[\s\S]*?renderHoverTooltipForState\(\{ index: hitIndex, metric: 0 \}, hoverState\.clientX, hoverState\.clientY, reason \|\| 'hover-refresh'\);[\s\S]*?appendDebugLog\('biq-map:hover-refresh'/,
    'hover-triggered district art loads should repaint the existing hover layer in place instead of waiting for another pointermove'
  );
  assert.match(
    rendererText,
    /function biqMapArtRerender\(meta = null\) \{[\s\S]*?const requestedReason = String\(meta && meta\.reason \|\| 'asset-load'\);[\s\S]*?if \(requestedReason !== 'hover-preview-asset-load'\) \{[\s\S]*?state\.biqMapRerenderNeedsFullRefresh = true;[\s\S]*?\}[\s\S]*?const needsFullRefresh = !!state\.biqMapRerenderNeedsFullRefresh;[\s\S]*?const reason = needsFullRefresh \? 'asset-load' : requestedReason;[\s\S]*?if \(!needsFullRefresh && reason === 'hover-preview-asset-load'\)[\s\S]*?if \(assetDrivenRefresh && loadingCount > 0\) \{[\s\S]*?biqMapArtRerender\(\{ reason, assetKey \}\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?state\.biqMapRerenderNeedsFullRefresh = false;/,
    'hover-only district preview refreshes should not cancel or starve a pending full terrain-art rerender once base map assets finish loading'
  );
  assert.match(
    rendererText,
    /drawDistrictOverlay\(hoverCtx, previewRecord, geom, sx, sy, 'all', \{ assetRefreshMode: 'hover-only' \}\)/,
    'district hover previews should tag their art requests as hover-only so cache misses do not force a full map rerender'
  );
  assert.match(
    stylesText,
    /\.biq-map-hover-tooltip\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;/,
    'coordinate tooltip should be positioned as a non-interactive map overlay'
  );
  assert.match(
    stylesText,
    /\.biq-map-canvas-stack\s*\{[\s\S]*?position:\s*relative;[\s\S]*?width:\s*max-content;/,
    'map canvas stack should define the shared origin for the map and hover border canvases'
  );
  assert.match(
    stylesText,
    /\.biq-map-hover-canvas\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;/,
    'hover border canvas should be positioned as a non-interactive map overlay'
  );
  assert.doesNotMatch(
    stylesText,
    /\.biq-map-paint-cursor-ghost\s*\{/,
    'paint preview should no longer rely on a separate floating tooltip card'
  );
});

test('map unit overlay shifts sea and air units downward with zoom-scaled offsets', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /prtoClassById\[idx\]\s*=\s*normalizeUnitClassValue\(getFieldByBaseKey\(record,\s*'unitclass'\)\?\.value\);[\s\S]*?const unitClass = prtoClassById\[unitId\] \|\| 'land';[\s\S]*?const unitYOffset = unitClass === 'air'[\s\S]*?Math\.round\(45 \* tileScale\)[\s\S]*?\(unitClass === 'sea' \? Math\.round\(14 \* tileScale\) : 0\);[\s\S]*?dy = quintUnitBottom - flcH \+ unitYOffset;[\s\S]*?dy = quintUnitTop \+ unitYOffset;/,
    'unit overlays should cache unit class and apply larger zoom-scaled offsets for air than sea units in both FLC and units32 paths'
  );
});

test('barbarian unit overlays use barbarian owner color mapping on the map', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const resolveCivIdFromOwnership = \(ownerTypeRaw, ownerRaw\) => \{[\s\S]*?if \(ownerType === 1\) \{[\s\S]*?const entry = resolveReferenceEntryForPicker\('civilizations', '0'\);[\s\S]*?return entry && isBarbarianCivilizationEntry\(entry\) \? 0 : -1;[\s\S]*?\}[\s\S]*?const ownerPickerValue = getMapOwnerPickerValueFromOwnership\(ownerTypeRaw, ownerRaw\);[\s\S]*?const ownerPickerColorIdx = getMapOwnerColorSlotForPickerValue\(ownerPickerValue\);[\s\S]*?const ownerSlot = Number\.isFinite\(ownerPickerColorIdx\)[\s\S]*?ownerPickerColorIdx/,
    'unit overlay rendering should resolve barbarian ownership through the shared picker color path so barbarian stacks use barbarian map colors'
  );
});

test('civilization-owned map colors honor matching custom player data', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const getCustomPlayerColorForCivilization = \(civIdRaw\) => \{[\s\S]*?if \(!hasCustomPlayerData[\s\S]*?return NaN;[\s\S]*?parseIntLoose\(playerCivById\[p\], -1\) !== civId[\s\S]*?parseIntLoose\(playerCustomDataById\[p\], 0\) !== 1[\s\S]*?parseIntLoose\(playerColorById\[p\], NaN\)[\s\S]*?return customColor;/,
    'map color resolution should find custom LEAD colors for civ-owned records when custom player data is enabled'
  );
  assert.match(
    rendererText,
    /const getMapCivilizationColorSlot = \(civIdRaw\) => \{[\s\S]*?const customColor = getCustomPlayerColorForCivilization\(civId\);[\s\S]*?if \(Number\.isFinite\(customColor\)\) return customColor;[\s\S]*?return parseIntLoose\(raceDefaultColorById\[civId\], NaN\);/,
    'civilization color slots should prefer matching custom player color before falling back to RACE default color'
  );
  assert.match(
    rendererText,
    /const civMatch = text\.match\([\s\S]{0,80}\);[\s\S]*?if \(civMatch\) return getMapCivilizationColorSlot/,
    'civilization owner picker swatches should use the same custom-player-aware color slot'
  );
  assert.match(
    rendererText,
    /const civColorSlot = getMapCivilizationColorSlot\(civId\);/,
    'city labels and unit overlays should use the shared custom-player-aware civilization color fallback'
  );
});

test('barbarian cities contribute territory borders through city influence ownership metadata', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const cityMetaList = \(citySection\?\.records \|\| \[\]\)\.map\(\(cityRecord, cityPos\) => \{[\s\S]*?let ownerId = -1;[\s\S]*?if \(ownerType === 1\) ownerId = 0;[\s\S]*?const civId = parseIntLoose\(resolveCivIdFromOwnership\(ownerTypeRaw, ownerRaw\), -1\);[\s\S]*?let borderColorId = NaN;[\s\S]*?if \(ownerType === 1 && civId >= 0\) \{[\s\S]*?borderColorId = getMapCivilizationColorSlot\(civId\);[\s\S]*?\}[\s\S]*?if \(!cityMeta \|\| cityMeta\.ownerId < 0\) \{/,
    'barbarian-owned cities should carry valid owner and border-color metadata into the city-influence territory pass so their borders render on the map'
  );
});

test('map tab exposes terrain-overlay import and routes it through explicit whole-map import replacement', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const configCoreText = fs.readFileSync(path.join(__dirname, '..', 'src', 'configCore.js'), 'utf8');
  const biqSectionsText = fs.readFileSync(path.join(__dirname, '..', 'src', 'biq', 'biqSections.js'), 'utf8');
  const mainText = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preloadText = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const workerText = fs.readFileSync(path.join(__dirname, '..', 'src', 'operationWorker.js'), 'utf8');

  assert.match(
    rendererText,
    /async function promptImportMapAction\(\) \{[\s\S]*?el\.entityModalTitle\) el\.entityModalTitle\.textContent = 'Import Map';[\s\S]*?replace the current map and clear existing cities, units, colonies, resources, and starting locations[\s\S]*?Terrain, rivers, landmark\/bonus terrain flags, and tile overlays only\./,
    'map import should use the shared entity modal shell and clearly warn that importing replaces the current map while limiting scope to terrain and overlays'
  );
  assert.match(
    rendererText,
    /const previewFrame = document\.createElement\('div'\);[\s\S]*?previewFrame\.className = 'map-resize-preview-frame map-import-preview-frame';[\s\S]*?const previewCanvas = document\.createElement\('canvas'\);[\s\S]*?drawMapResizeMiniPreviewPlaceholder\(previewCanvas, 'Select a source\\nscenario'\);[\s\S]*?drawMapResizeMiniPreview\(previewCanvas, buildMapSectionsTerrainPreview\(sections\)\);/,
    'map import should show a compact terrain preview using the same minimap preview frame style as resize'
  );
  assert.match(
    rendererText,
    /async function loadImportMapTab\(filePath\) \{[\s\S]*?typeof window\.c3xManager\.loadMapImport !== 'function'[\s\S]*?window\.c3xManager\.loadMapImport\(\{[\s\S]*?scenarioPath: filePath,[\s\S]*?textFileEncoding:/,
    'map import should use the map-only IPC loader instead of loading and materializing a full source bundle'
  );
  assert.doesNotMatch(
    rendererText,
    /async function loadImportMapTab\(filePath\) \{[\s\S]*?window\.c3xManager\.loadBundle[\s\S]*?window\.c3xManager\.materializeMapTab/,
    'map import source loading must not regress to full loadBundle plus materializeMapTab work'
  );
  assert.match(
    rendererText,
    /const importBtn = document\.createElement\('button'\);[\s\S]*?importBtn\.className = 'ghost action-import';[\s\S]*?importBtn\.textContent = '⇪ Import Map';[\s\S]*?const result = await promptImportMapAction\(\);[\s\S]*?applyWholeMapSectionsToTab\(tab, result\.importedSections, 'set', 'imported'\);/,
    'the map tab should expose an Import Map button that routes accepted imports into the explicit whole-map replacement path'
  );
  assert.match(
    rendererText,
    /function clearScenarioDistrictsForWholeMapReplacement\(tab\) \{[\s\S]*?meta\.entries = \[\];[\s\S]*?meta\.namedTiles = \[\];[\s\S]*?\}[\s\S]*?function applyWholeMapSectionsToTab\(tab, mapSectionsInput, mutation = 'set', mutationSource = 'generated'\) \{[\s\S]*?if \(mutation === 'set'\) clearScenarioDistrictsForWholeMapReplacement\(tab\);/,
    'whole-map replacement, including imported maps, should clear scenario district and named-tile sidecar metadata immediately in the renderer'
  );
  assert.match(
    configCoreText,
    /function loadMapImport\(payload = \{\}\) \{[\s\S]*?buildMapTabFromBiq\(buildMapImportBiqTab\(biqTab\), mode\)[\s\S]*?buildImportedTerrainOverlayMapSectionsFromMapTab\(mapTab\)[\s\S]*?durationMs/,
    'config core should expose a map-only import loader that filters BIQ sections before map-tab materialization and reports timing'
  );
  assert.match(
    configCoreText,
    /function buildImportedTerrainOverlayMapSectionsFromMapTab\(sourceMapTab\) \{[\s\S]*?setRecordFieldByBaseKey\(next, 'resource', '-1'\);[\s\S]*?setRecordFieldByBaseKey\(next, 'city', '-1'\);[\s\S]*?setRecordFieldByBaseKey\(next, 'colony', '-1'\);[\s\S]*?emptySection\('SLOC'\),[\s\S]*?emptySection\('CITY'\),[\s\S]*?emptySection\('UNIT'\),[\s\S]*?emptySection\('CLNY'\)/,
    'terrain-overlay map import should strip resources and map entities while replacing the structural map sections'
  );
  assert.match(
    preloadText,
    /loadMapImport: \(payload\) => ipcRenderer\.invoke\('manager:load-map-import', payload\)/,
    'preload should expose the map-only import IPC to the renderer'
  );
  assert.match(
    mainText,
    /ipcMain\.handle\('manager:load-map-import'[\s\S]*?runWorkerTask\('loadMapImport'[\s\S]*?log\.info\('loadMapImport'/,
    'main process should run map import loading in the worker path and log timings'
  );
  assert.match(
    workerText,
    /const \{ saveBundle, createScenario, deleteScenario, loadMapImport \} = require\('\.\/configCore'\);[\s\S]*?task === 'loadMapImport'[\s\S]*?result = loadMapImport\(payload\);/,
    'operation worker should support map import loading so large source BIQs do not block the main process'
  );
  assert.match(
    configCoreText,
    /allowSetmapGeneration: \['generated', 'imported', 'custom'\]\.includes\(String\(tab && tab\.mapMutationSource \|\| ''\)\.trim\(\)\.toLowerCase\(\)\)/,
    'config save planning should allow explicit imported and custom-created map replacements to emit setmap operations'
  );
  assert.match(
    biqSectionsText,
    /Whole-map BIQ replacement is blocked for normal saves\. Only explicit map generation, custom-map creation, or map import writes may replace all map sections\./,
    'BIQ apply should still block arbitrary whole-map replacement while allowing the explicit import and custom-map paths'
  );
});

test('map tab exposes Edit Map for existing scenario maps and stages WMAP dimension changes for save', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const stylesText = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(
    rendererText,
    /function collectMapResizeTrimSummary\(tab, targetWidth, targetHeight, anchors = \{\}\) \{[\s\S]*?anchors\.horizontalAnchor,[\s\S]*?anchors\.verticalAnchor[\s\S]*?cityCount:[\s\S]*?unitCount:[\s\S]*?startingLocationCount:[\s\S]*?colonyCount:[\s\S]*?trimmedTileCount:/,
    'Edit Map should compute a concrete preview of out-of-bounds map content before the user confirms a shrink'
  );
  assert.match(
    rendererText,
    /el\.entityModalTitle\) el\.entityModalTitle\.textContent = 'Resize Map';[\s\S]*?el\.entityModalBody\) \{[\s\S]*?Change the scenario map dimensions and choose which sides receive added space or lose trimmed space\./,
    'Resize Map should keep the in-modal resize explanation'
  );
  assert.match(
    rendererText,
    /const miniPreviewField = document\.createElement\('div'\);[\s\S]*?const statusLine = document\.createElement\('div'\);[\s\S]*?statusLine\.className = 'hint map-resize-status';[\s\S]*?statusLine\.textContent = '\\u00A0';[\s\S]*?miniPreviewField\.appendChild\(statusLine\);[\s\S]*?miniPreviewField\.appendChild\(miniPreviewFrame\);/,
    'Resize Map should place the reserved status row directly above the minimap preview instead of above the whole preview section'
  );
  assert.doesNotMatch(
    rendererText,
    /miniPreviewLabel\.textContent = 'Resize Preview'|Terrain-only minimap preview\. Existing terrain follows the selected edge anchors/,
    'Resize Map should not show extra preview label or explanatory copy above the minimap'
  );
  assert.match(
    rendererText,
    /statusLine\.className = 'warning map-resize-status';[\s\S]*?Shrinking to \$\{validation\.width\}x\$\{validation\.height\} will remove[\s\S]*?statusLine\.textContent = `Expansion adds \$\{fillTerrainLabel\.toLowerCase\(\)\} tiles using east\/west: \$\{horizontalLabel\}; north\/south: \$\{verticalLabel\}\.`;/,
    'Resize Map should keep one reserved status row for shrink warnings and expansion guidance instead of separate stacked text blocks'
  );
  assert.match(
    rendererText,
    /let validation = getQuintCustomMapValidation\(widthInput\.value, heightInput\.value\);[\s\S]*?totalValue\.textContent = `\$\{validation\.tileCount\.toLocaleString\(\)\} \(\$\{validation\.width\}x\$\{validation\.height\}\)`;[\s\S]*?if \(validation\.width === currentWidth && validation\.height === currentHeight\) \{[\s\S]*?No size change yet\.[\s\S]*?else if \(validation\.width >= currentWidth && validation\.height >= currentHeight\) \{[\s\S]*?Expansion adds \$\{fillTerrainLabel\.toLowerCase\(\)\} tiles using east\/west: \$\{horizontalLabel\}; north\/south: \$\{verticalLabel\}\.[\s\S]*?widthInput\.addEventListener\('input', refreshValidation\);[\s\S]*?heightInput\.addEventListener\('input', refreshValidation\);[\s\S]*?const onConfirm = \(\) => \{[\s\S]*?refreshValidation\(\);/,
    'Resize Map should keep odd dimensions in the inputs while using the normalized even result without flashing a separate odd-dimension status message'
  );
  assert.match(
    rendererText,
    /function computeMapResizePreviewOffsets\(sourceWidth, sourceHeight, targetWidth, targetHeight, horizontalAnchor = 'both', verticalAnchor = 'both'\) \{[\s\S]*?const horizontal = normalizeMapResizeHorizontalAnchor\(horizontalAnchor\);[\s\S]*?const vertical = normalizeMapResizeVerticalAnchor\(verticalAnchor\);[\s\S]*?if \(xCandidate\.parity !== yCandidate\.parity\) return;[\s\S]*?candidates\.sort\(\(a, b\) => \{[\s\S]*?if \(a\.cost !== b\.cost\) return a\.cost - b\.cost;[\s\S]*?return \{ x: candidates\[0\]\.x, y: candidates\[0\]\.y \};[\s\S]*?\}/,
    'Resize Map should choose anchor-aware parity-matched x/y offsets so preview/source tile lookups stay on valid Civ3 coordinates'
  );
  assert.match(
    rendererText,
    /const MAP_RESIZE_MINI_PREVIEW_MAX_TILES = 50000;[\s\S]*?function buildMapResizeTerrainPreview\(tab, targetWidth, targetHeight, fillTerrain = BIQ_TERRAIN\.SEA, anchors = \{\}\) \{[\s\S]*?const fillCode = normalizeResizeFillTerrain\(fillTerrain, BIQ_TERRAIN\.SEA\);[\s\S]*?anchors\.horizontalAnchor,[\s\S]*?anchors\.verticalAnchor[\s\S]*?function drawMapResizeMiniPreview\(canvas, preview\) \{[\s\S]*?const scale = Math\.min\(stageWidth \/ Math\.max\(1, width\), stageHeight \/ Math\.max\(1, height\)\);[\s\S]*?const originX = Math\.floor\(\(stageWidth - previewWidth\) \/ 2\);[\s\S]*?const getTerrainCodeAt = \(x, y\) => \{[\s\S]*?return BIQ_TERRAIN\.SEA;[\s\S]*?\};[\s\S]*?for \(let y = 0; y < height; y \+= 1\) \{[\s\S]*?for \(let x = 0; x < width; x \+= 1\) \{[\s\S]*?getMapResizeMiniPreviewFillStyle\(getTerrainCodeAt\(x, y\)\)[\s\S]*?\}[\s\S]*?\}[\s\S]*?function drawMapResizeMiniPreviewPlaceholder\(canvas, message\) \{/,
    'Edit Map should build a terrain-only resize minimap preview, fill new resize space from the selected terrain, paint parity gaps from nearby terrain, and provide a cheap placeholder path for oversized previews'
  );
  assert.match(
    rendererText,
    /const MAP_RESIZE_HORIZONTAL_ANCHOR_OPTIONS = Object\.freeze\(\[[\s\S]*?Both equally[\s\S]*?East[\s\S]*?West[\s\S]*?\]\);[\s\S]*?const MAP_RESIZE_VERTICAL_ANCHOR_OPTIONS = Object\.freeze\(\[[\s\S]*?Both equally[\s\S]*?South[\s\S]*?North[\s\S]*?\]\);/,
    'Resize Map should define explicit horizontal and vertical anchor dropdown choices'
  );
  assert.match(
    rendererText,
    /horizontalAnchorLabel\.textContent = 'East \/ West';[\s\S]*?MAP_RESIZE_HORIZONTAL_ANCHOR_OPTIONS\.forEach[\s\S]*?verticalAnchorLabel\.textContent = 'North \/ South';[\s\S]*?MAP_RESIZE_VERTICAL_ANCHOR_OPTIONS\.forEach[\s\S]*?horizontalAnchorSelect\.addEventListener\('change', refreshValidation\);[\s\S]*?verticalAnchorSelect\.addEventListener\('change', refreshValidation\);/,
    'Resize Map should expose east/west and north/south anchor dropdowns and refresh validation plus preview when they change'
  );
  assert.match(
    rendererText,
    /const terrainField = document\.createElement\('div'\);[\s\S]*?terrainField\.className = 'entity-field map-resize-terrain-field';[\s\S]*?terrainLabel\.textContent = 'Add New Terrain as Type';[\s\S]*?const terrainSelect = document\.createElement\('select'\);[\s\S]*?QUINT_CUSTOM_MAP_BASE_TERRAIN_OPTIONS\.forEach\(\(option\) => \{[\s\S]*?terrainSelect\.value = String\(BIQ_TERRAIN\.SEA\);[\s\S]*?grid\.appendChild\(terrainField\);[\s\S]*?const miniPreviewField = document\.createElement\('div'\);[\s\S]*?terrainSelect\.addEventListener\('change', refreshValidation\);/,
    'Resize Map should expose Add New Terrain as Type in the resize grid before the minimap so it matches the Map Width and East/West control width'
  );
  assert.match(
    stylesText,
    /\.map-resize-terrain-field \{[\s\S]*?grid-column: 1 \/ span 1;[\s\S]*?\}/,
    'Resize Map terrain selector should stay in one grid column instead of spanning the modal'
  );
  assert.match(
    rendererText,
    /const miniPreviewFrame = document\.createElement\('div'\);[\s\S]*?miniPreviewFrame\.className = 'map-resize-preview-frame';[\s\S]*?const miniPreviewCanvas = document\.createElement\('canvas'\);[\s\S]*?miniPreviewCanvas\.width = 280;[\s\S]*?miniPreviewCanvas\.height = 220;[\s\S]*?miniPreviewFrame\.appendChild\(miniPreviewCanvas\);/,
    'Edit Map should mount the resize preview inside a fixed-size frame so extreme aspect ratios do not expand the modal'
  );
  assert.match(
    rendererText,
    /if \(!validation\.isValid\) \{[\s\S]*?drawMapResizeMiniPreviewPlaceholder\(miniPreviewCanvas, 'Preview unavailable\\nfor invalid dimensions'\);[\s\S]*?\} else if \(validation\.tileCount > MAP_RESIZE_MINI_PREVIEW_MAX_TILES\) \{[\s\S]*?drawMapResizeMiniPreviewPlaceholder\(miniPreviewCanvas, 'Preview hidden for\\nvery large map sizes'\);/,
    'Edit Map should skip heavy minimap generation for invalid or oversized dimensions so the modal stays responsive'
  );
  assert.match(
    rendererText,
    /const openBtn = document\.createElement\('button'\);[\s\S]*?openBtn\.className = 'ghost action-open';[\s\S]*?const liveTab = getLiveMapTabForAction\(tab\);[\s\S]*?const liveTileSection = getMapTileSection\(liveTab\) \|\| tileSection;[\s\S]*?openMapModal\(\{ tab: liveTab, tileSection: liveTileSection, title: `\$\{liveTab\.title \|\| 'Map'\} Editor` \}\);[\s\S]*?const importBtn = document\.createElement\('button'\);[\s\S]*?importBtn\.className = 'ghost action-import';[\s\S]*?const editBtn = document\.createElement\('button'\);[\s\S]*?editBtn\.className = 'ghost action-edit';[\s\S]*?editBtn\.textContent = '↔ Resize Map';[\s\S]*?const result = await promptEditMapAction\(tab\);[\s\S]*?rememberMapUndoSnapshot\(\);[\s\S]*?applyMapResizePreviewToTab\(tab, result\.width, result\.height, \{[\s\S]*?horizontalAnchor: result\.horizontalAnchor,[\s\S]*?verticalAnchor: result\.verticalAnchor[\s\S]*?\}\);[\s\S]*?openMapModal\(\{ tab, tileSection: resizedTileSection, title: `\$\{tab\.title \|\| 'Map'\} Editor` \}\);[\s\S]*?setStatus\(`Resized map preview to \$\{result\.width\}x\$\{result\.height\}\. Save to write the BIQ\.`\);/,
    'the map tab should expose Open Map, Import Map, Resize Map, then Remove Map; Open Map should resolve the live map tab before opening, and Resize Map should rebuild the in-memory map immediately before opening the resized preview'
  );
  assert.match(
    rendererText,
    /function applyMapUndoSnapshotToCurrentBundle\(targetSnapshot, options = \{\}\) \{[\s\S]*?refreshActiveBiqRecordListDirtyBadges\(\);[\s\S]*?if \(state\.activeTab === 'map'\) \{[\s\S]*?renderTabs\(\);[\s\S]*?renderActiveTab\(\{ preserveTabScroll: true \}\);[\s\S]*?\}[\s\S]*?const mapModalVisible = !!\(/,
    'scoped map undo should rerender the Map tab page before refreshing the modal so stale Open Map button closures cannot reopen an undone resized map'
  );
});

test('map tab exposes Quint-style Add Custom Map creation with even-size and tile-cap guardrails', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const QUINT_CUSTOM_MAP_MIN_DIMENSION = 16;[\s\S]*?const QUINT_CUSTOM_MAP_MAX_TILES = 65536;[\s\S]*?const QUINT_CUSTOM_MAP_BASE_TERRAIN_OPTIONS = Object\.freeze\(\[[\s\S]*?Desert[\s\S]*?Plains[\s\S]*?Grassland[\s\S]*?Tundra[\s\S]*?Coast[\s\S]*?Sea[\s\S]*?Ocean[\s\S]*?\]\);/,
    'custom map creation should follow Quint guardrails and expose the same base-terrain choices'
  );
  assert.match(
    rendererText,
    /async function promptAddCustomMapAction\(tab\) \{[\s\S]*?el\.entityModalTitle\) el\.entityModalTitle\.textContent = 'Create New Map';[\s\S]*?Create a new custom map\.[\s\S]*?65,536 tiles[\s\S]*?Custom maps require even dimensions[\s\S]*?Polar Ice Caps[\s\S]*?Allow X-wrapping[\s\S]*?Allow Y-wrapping[\s\S]*?Odd dimensions will be rounded up to the next even size/,
    'Add Custom Map should use the shared modal shell and explain Quint-style size validation clearly'
  );
  assert.match(
    rendererText,
    /async function buildBlankCustomMapSections\(tab, options = \{\}\) \{[\s\S]*?const xWrapping = options\.xWrapping == null[\s\S]*?const yWrapping = options\.yWrapping == null[\s\S]*?const polarIceCaps = options\.polarIceCaps == null[\s\S]*?const mapFlags = \(xWrapping \? 1 : 0\) \| \(yWrapping \? 2 : 0\) \| \(polarIceCaps \? 4 : 0\);[\s\S]*?const resourceCount = resourceDefs\.length;[\s\S]*?baseKey: 'numresources', value: resourceCount[\s\S]*?baseKey: 'flags', value: mapFlags[\s\S]*?baseKey: 'continentclass', value: 1[\s\S]*?createGeneratedMapSection\('SLOC', \[\]\),[\s\S]*?createGeneratedMapSection\('CITY', \[\]\),[\s\S]*?createGeneratedMapSection\('UNIT', \[\]\),[\s\S]*?createGeneratedMapSection\('CLNY', \[\]\)/,
    'custom map creation should seed Quint-style WCHR/WMAP/TILE/CONT sections while leaving map entities empty'
  );
  assert.match(
    rendererText,
    /function finalizeGeneratedBlankMapTerrainFileImage\(tileRecords, width, height\) \{[\s\S]*?setRecordFieldValue\(tileRecords\[i\], 'file', String\(spec\.file\)\);[\s\S]*?setRecordFieldValue\(tileRecords\[i\], 'image', String\(computeBiqTerrainSpriteImageIdx\(southBase, westBase, northBase, eastBase, spec\)\)\);[\s\S]*?\}[\s\S]*?finalizeGeneratedBlankMapTerrainFileImage\(tileRecords, validation\.width, validation\.height\);/,
    'blank custom map creation should precompute stored TILE file/image sprite values once, so generated maps render like normal BIQs instead of recomputing terrain transitions every redraw'
  );
  assert.match(
    rendererText,
    /if \(isScenarioMode\(\) && !hasMapData\(tab\)\) \{[\s\S]*?addCustomBtn\.className = 'ghost action-add';[\s\S]*?addCustomBtn\.textContent = '＋ Create New Map';[\s\S]*?const result = await promptAddCustomMapAction\(tab\);[\s\S]*?applyWholeMapSectionsToTab\(tab, result\.customSections, 'set', 'custom'\);[\s\S]*?openMapModal\(\{ tab, tileSection: tileSectionAfterCreate, title: `\$\{tab\.title \|\| 'Map'\} Editor` \}\);/,
    'the map tab should expose Add Custom Map only when no custom map exists, route it through the explicit whole-map custom-map path, and open the new map immediately'
  );
});

test('map art loads repaint an open map modal in place instead of rebuilding the whole modal body', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /function ensureMapModalNode\(\) \{[\s\S]*?<button type="button" class="secondary map-editor-modal-save-btn" data-act="save"><span class="btn-icon">💾<\/span>Save<\/button>[\s\S]*?mapModal\.saveBtn = overlay\.querySelector\('\[data-act="save"\]'\);[\s\S]*?if \(mapModal\.saveBtn\) \{[\s\S]*?if \(!state\.isDirty \|\| state\.isSaving \|\| state\.isLoading \|\| !state\.bundle \|\| !!state\.sectionValidationError\) return;[\s\S]*?await saveCurrentBundle\(\);[\s\S]*?\}[\s\S]*?function refreshMapModalUndoButtons\(\) \{[\s\S]*?if \(mapModal\.saveBtn\) \{[\s\S]*?mapModal\.saveBtn\.disabled = !state\.isDirty \|\| state\.isSaving \|\| state\.isLoading \|\| !state\.bundle \|\| !!state\.sectionValidationError;[\s\S]*?mapModal\.saveBtn\.title = state\.sectionValidationError \|\| '';[\s\S]*?\}/,
    'the map modal header should expose a Save button beside Undo and route it through the shared saveCurrentBundle flow with matching disabled-state rules'
  );
  assert.match(
    rendererText,
    /function biqMapArtRerender\(meta = null\) \{[\s\S]*?const requestedReason = String\(meta && meta\.reason \|\| 'asset-load'\);[\s\S]*?if \(requestedReason !== 'hover-preview-asset-load'\) \{[\s\S]*?state\.biqMapRerenderNeedsFullRefresh = true;[\s\S]*?\}[\s\S]*?if \(mapModal\.tab && mapModal\.tileSection && !mapOverlay\.classList\.contains\('hidden'\)\) \{[\s\S]*?if \(typeof mapModal\.refreshVisuals === 'function'\) \{[\s\S]*?const loadingCount = Object\.keys\(state\.biqMapArtLoading \|\| \{\}\)\.length;[\s\S]*?const needsFullRefresh = !!state\.biqMapRerenderNeedsFullRefresh;[\s\S]*?const reason = needsFullRefresh \? 'asset-load' : requestedReason;[\s\S]*?if \(!needsFullRefresh && reason === 'hover-preview-asset-load'\)[\s\S]*?if \(assetDrivenRefresh && loadingCount > 0\) \{[\s\S]*?mode: 'deferred-until-idle'[\s\S]*?biqMapArtRerender\(\{ reason, assetKey \}\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?mode: 'light-refresh'[\s\S]*?state\.biqMapRerenderNeedsFullRefresh = false;[\s\S]*?mapModal\.refreshVisuals\(\{[\s\S]*?\}\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?mode: 'full-modal-rerender'[\s\S]*?renderMapModalBody\(\);/,
    'asset-driven map rerenders should keep a pending full refresh alive until the terrain-art queue drains, while still letting hover-only district preview loads repaint just the hover layer'
  );
  assert.match(
    rendererText,
    /const resolveTerrainSpriteSpec = \(record, geom\) => \{[\s\S]*?const storedFile = parseIntLoose\(getFieldByBaseKey\(record, 'file'\)\?\.value, -1\);[\s\S]*?const storedImage = parseIntLoose\(getFieldByBaseKey\(record, 'image'\)\?\.value, -1\);[\s\S]*?if \(storedFile >= 0 && storedImage >= 0\) \{[\s\S]*?return \{ fileIdx: storedFile, imageIdx: storedImage \};[\s\S]*?\}/,
    'terrain rendering should prefer stored BIQ TILE file/image values, matching Quint and avoiding per-redraw transition recomputation for generated maps'
  );
  assert.match(
    rendererText,
    /if \(floatingUi\) \{[\s\S]*?mapModal\.refreshVisuals = \(meta = null\) => \{[\s\S]*?minimapBaseDirty = true;[\s\S]*?redrawMapCanvasInPlace\(\);[\s\S]*?if \(typeof renderMiniMap === 'function'\) renderMiniMap\(\);[\s\S]*?return true;[\s\S]*?\};[\s\S]*?\}/,
    'an open map modal should register a reusable visual refresh callback that repaints the canvas and minimap when art assets finish loading'
  );
});

test('map modal reapplies scenario district metadata before redraws', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /function syncScenarioDistrictDisplayFieldsForMapTab\(tab, tileSection = null\) \{[\s\S]*?const meta = tab && tab\.scenarioDistricts;[\s\S]*?setMapDisplayFieldValue\(tile, 'district', `\$\{districtIndex\},\$\{existingState\}`, 'District'\);[\s\S]*?setMapDisplayFieldValue\(tile, 'districtname', districtName, 'District Name'\);[\s\S]*?setMapDisplayFieldValue\(tile, 'namedtile', String\(entry && entry\.name \|\| ''\)\.trim\(\), 'Named Tile'\);[\s\S]*?\}/,
    'scenario district sidecar entries should be reapplied to TILE display fields without depending on stale modal-local state'
  );
  assert.match(
    rendererText,
    /function renderBiqMapSection\(tab, tileSection, options = \{\}\) \{[\s\S]*?appendDebugLog\('biq-map:open'[\s\S]*?syncScenarioDistrictDisplayFieldsForMapTab\(tab, tileSection\);[\s\S]*?const rerenderMapView = \(\) => \{/,
    'map modal rendering should sync scenario district metadata before computing tile visuals'
  );
  assert.match(
    rendererText,
    /function applyMapResizePreviewToTab\(tab, targetWidth, targetHeight, options = \{\}\) \{[\s\S]*?sanitizeResizePreviewEntitySections\(tab, width, height, resizeOffsets\);\s*shiftScenarioDistrictsForMapResize\(tab, width, height, resizeOffsets\);\s*syncScenarioDistrictDisplayFieldsForMapTab\(tab, tileSection\);/,
    'map resize should shift scenario district sidecar metadata and reapply display fields before redraw/save'
  );
});

test('map resize shifts and trims scenario district sidecar metadata', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const context = {
    parseIntLoose(value, fallback = 0) {
      const parsed = Number.parseInt(String(value == null ? '' : value).trim(), 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    }
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunctionSource(rendererText, 'isMapResizePreviewCoordInBounds'),
    extractFunctionSource(rendererText, 'shiftScenarioDistrictsForMapResize'),
    'this.shiftScenarioDistrictsForMapResize = shiftScenarioDistrictsForMapResize;'
  ].join('\n'), context);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const growTab = {
    scenarioDistricts: {
      entries: [
        { x: 2, y: 3, district: 'Neighborhood', wonderName: 'Colossus', wonderCity: 'Rome' },
        { x: 0, y: 0, district: 'Trimmed District' }
      ],
      namedTiles: [
        { x: '4', y: '5', name: 'Mountain Pass' },
        { x: 99, y: 99, name: 'Out of Bounds' }
      ]
    }
  };
  context.shiftScenarioDistrictsForMapResize(growTab, 8, 8, { x: 1, y: -1 });
  assert.deepEqual(plain(growTab.scenarioDistricts.entries), [
    { x: 3, y: 2, district: 'Neighborhood', wonderName: 'Colossus', wonderCity: 'Rome' }
  ]);
  assert.deepEqual(plain(growTab.scenarioDistricts.namedTiles), [
    { x: 5, y: 4, name: 'Mountain Pass' }
  ]);

  const shrinkTab = {
    scenarioDistricts: {
      entries: [
        { x: 1, y: 1, district: 'Trimmed' },
        { x: 6, y: 6, district: 'Kept' }
      ],
      namedTiles: [
        { x: 2, y: 3, name: 'Kept Tile' },
        { x: 1, y: 0, name: 'Trimmed Tile' }
      ]
    }
  };
  context.shiftScenarioDistrictsForMapResize(shrinkTab, 5, 5, { x: -2, y: -2 });
  assert.deepEqual(plain(shrinkTab.scenarioDistricts.entries), [
    { x: 4, y: 4, district: 'Kept' }
  ]);
  assert.deepEqual(plain(shrinkTab.scenarioDistricts.namedTiles), [
    { x: 0, y: 1, name: 'Kept Tile' }
  ]);
});

test('Files modal tracks scenario district sidecar writes from map edits', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const hasScenarioDistrictsEdit = \(mapTab\) => \{[\s\S]*?const meta = mapTab && mapTab\.scenarioDistricts;[\s\S]*?return JSON\.stringify\(\{ entries, namedTiles \}\) !== JSON\.stringify\(\{ entries: originalEntries, namedTiles: originalNamedTiles \}\);[\s\S]*?\};[\s\S]*?if \(getTabDirtyCount\('map'\) > 0 && hasScenarioDistrictsEdit\(tabs\.map\)\) \{[\s\S]*?addPath\(meta && meta\.targetPath\);[\s\S]*?\}/,
    'Files modal pending-path fallback should include scenario.districts.txt when map sidecar entries or named tiles changed'
  );
  assert.match(
    rendererText,
    /const scenarioDistrictsTargetPath = String\(\(scenarioDistrictsMeta && scenarioDistrictsMeta\.targetPath\) \|\| ''\)\.trim\(\);[\s\S]*?const scenarioDistrictsDirty = getTabDirtyCount\('map'\) > 0[\s\S]*?JSON\.stringify\(\{ entries, namedTiles \}\) !== JSON\.stringify\(\{ entries: originalEntries, namedTiles: originalNamedTiles \}\);[\s\S]*?note: 'Scenario Districts save target'[\s\S]*?entry\.potentialWrite = !!scenarioDistrictsDirty;/,
    'Files modal should keep scenario.districts.txt as a first-class write target and mark it changed only for sidecar edits'
  );
});

test('Unit Table header Save mirrors the main save button wiring', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const stylesText = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(
    rendererText,
    /function getSaveButtons\(\) \{[\s\S]*?return \[el\.saveBtn, unitAvailabilityModal\.saveBtn, unitTableModal\.saveBtn, mapModal\.saveBtn\]\.filter\(\(btn\) => btn && btn\.isConnected\);[\s\S]*?function updateSaveButtonLabel\(\) \{[\s\S]*?getSaveButtons\(\)\.forEach\(\(btn\) => \{[\s\S]*?state\.isSaving[\s\S]*?Saving\.\.\.[\s\S]*?Save[\s\S]*?\}\);[\s\S]*?function refreshDirtyUi\(\) \{[\s\S]*?const saveButtons = getSaveButtons\(\);[\s\S]*?saveButtons\.forEach\(\(btn\) => btn\.classList\.toggle\('dirty', state\.isDirty\)\);[\s\S]*?saveButtons\.forEach\(\(btn\) => \{[\s\S]*?btn\.disabled = saveDisabled;[\s\S]*?btn\.title = saveTitle;[\s\S]*?\}\);/,
    'modal Save buttons should share the main Save label, dirty class, disabled state, and validation title'
  );
  assert.match(
    rendererText,
    /function ensureUnitTableModalNode\(\) \{[\s\S]*?<button type="button" class="secondary unit-table-save-btn" data-act="save"><span class="btn-icon">💾<\/span>Save<\/button>[\s\S]*?unitTableModal\.saveBtn = overlay\.querySelector\('\[data-act="save"\]'\);[\s\S]*?if \(unitTableModal\.saveBtn && !unitTableModal\.saveBtn\.dataset\.bound\) \{[\s\S]*?unitTableModal\.saveBtn\.addEventListener\('click', saveCurrentBundle\);/,
    'Unit Table should expose a secondary Save button beside Undo and route clicks through saveCurrentBundle'
  );
  assert.match(
    stylesText,
    /\.unit-table-modal-actions \.unit-table-save-btn\.secondary,[\s\S]*?\.unit-table-modal-actions \.unit-table-save-btn\.secondary:hover:not\(:disabled\),[\s\S]*?\.unit-table-modal-actions \.unit-table-save-btn\.secondary\.dirty \{[\s\S]*?box-shadow: none;/,
    'Unit Table Save should use the same no-shadow action styling as the main app Save button'
  );
});

test('Availability by Civ keeps Undo actions in the modal header', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const stylesText = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(
    rendererText,
    /function ensureUnitAvailabilityModalNode\(\) \{[\s\S]*?<div class="unit-availability-modal-actions">[\s\S]*?<button type="button" class="secondary unit-availability-save-btn" data-act="save"><span class="btn-icon">💾<\/span>Save<\/button>[\s\S]*?<button type="button" class="ghost unit-availability-undo-btn" data-act="undo"><span class="btn-icon">↶<\/span>Undo<\/button>[\s\S]*?<button type="button" class="ghost unit-availability-undo-all-btn" data-act="undo-all"><span class="btn-icon">↺<\/span>Undo All<\/button>[\s\S]*?<button type="button" class="ghost" data-act="close">Close<\/button>[\s\S]*?unitAvailabilityModal\.saveBtn = overlay\.querySelector\('\[data-act="save"\]'\);[\s\S]*?unitAvailabilityModal\.undoBtn = overlay\.querySelector\('\[data-act="undo"\]'\);[\s\S]*?unitAvailabilityModal\.undoAllBtn = overlay\.querySelector\('\[data-act="undo-all"\]'\);/,
    'Availability by Civ should place Save, Undo, and Undo All in the modal header next to Close'
  );
  assert.match(
    rendererText,
    /const refreshUndoButtons = \(\) => \{[\s\S]*?unitAvailabilityModal\.undoBtn\.disabled = !referenceEditable \|\| !getLatestUndoSnapshot\(\);[\s\S]*?unitAvailabilityModal\.undoAllBtn\.disabled = !referenceEditable \|\| !state\.isDirty;[\s\S]*?\};[\s\S]*?unitAvailabilityModal\.undoBtn\.onclick = async \(\) => \{[\s\S]*?await undoOneStep\(\);[\s\S]*?render\(\);[\s\S]*?\};[\s\S]*?unitAvailabilityModal\.undoAllBtn\.onclick = async \(\) => \{[\s\S]*?await undoAllChanges\(\);[\s\S]*?render\(\);[\s\S]*?\};/,
    'Availability by Civ header Undo buttons should keep their disabled-state wiring while refreshing the mounted modal in place after undo'
  );
  assert.match(
    stylesText,
    /\.unit-availability-modal-actions \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: flex-end;[\s\S]*?gap: 8px;/,
    'Availability by Civ header actions should lay out consistently with the other modal header action groups'
  );
  assert.match(
    rendererText,
    /if \(unitAvailabilityModal\.saveBtn && !unitAvailabilityModal\.saveBtn\.dataset\.bound\) \{[\s\S]*?unitAvailabilityModal\.saveBtn\.addEventListener\('click', saveCurrentBundle\);[\s\S]*?\}[\s\S]*?overlay\.classList\.remove\('hidden'\);[\s\S]*?overlay\.setAttribute\('aria-hidden', 'false'\);[\s\S]*?refreshDirtyUi\(\);/,
    'Availability by Civ Save should route clicks through saveCurrentBundle and sync disabled state when opened'
  );
  assert.match(
    stylesText,
    /\.unit-availability-modal-actions \.unit-availability-save-btn\.secondary,[\s\S]*?\.unit-availability-modal-actions \.unit-availability-save-btn\.secondary:hover:not\(:disabled\),[\s\S]*?\.unit-availability-modal-actions \.unit-availability-save-btn\.secondary\.dirty,[\s\S]*?\.unit-table-modal-actions \.unit-table-save-btn\.secondary/s,
    'Availability by Civ Save should use the same no-shadow action styling as the main app and Unit Table Save buttons'
  );
});

test('reference tab preserved list keeps thumbnail hydration queue attached', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const rebuildPendingReferenceListThumbQueue = \(filteredEntries\) => \{[\s\S]*?entriesByIdentity\.set\(getReferenceEntryIdentity\(tabKey, entry, baseIndex\), entry\);[\s\S]*?pendingListThumbs = \[\];[\s\S]*?listPane\.querySelectorAll\('\.entry-list-item\[data-entry-id\]'\)[\s\S]*?thumb\.dataset\.thumbPending !== '1'[\s\S]*?pendingListThumbs\.push\(\{ thumb, entry \}\);[\s\S]*?\};/,
    'reference tabs should rebuild their pending thumbnail queue from mounted rows when preserving the list DOM'
  );
  assert.match(
    rendererText,
    /else \{[\s\S]*?const activeIdentity = filteredEntries\[selectedFilteredIndex\][\s\S]*?: '';[\s\S]*?rebuildPendingReferenceListThumbQueue\(filteredEntries\);[\s\S]*?Array\.from\(listPane\.querySelectorAll\('\.entry-list-item'\)\)\.forEach/,
    'selection changes that skip list rebuilds should reattach pending thumbnails before updating active row state'
  );
});

test('reference tab selection paints active row before deferred detail render', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const updateReferenceListActiveState = \(baseIndex\) => \{[\s\S]*?itemBtn\.classList\.toggle\('active', isActive\);[\s\S]*?loadReferenceListThumbnail\(tabKey, activeEntry, thumb\);[\s\S]*?updateSelectionActionButtons\(\);[\s\S]*?\};/,
    'reference tabs should expose a cheap active-row update path that does not rebuild the detail pane'
  );
  assert.match(
    rendererText,
    /const scheduleReferenceSelectionDetailRender = \(options = \{\}\) => \{[\s\S]*?window\.requestAnimationFrame\(\(\) => \{[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?renderReferenceBody\(\{[\s\S]*?skipListRebuild: true,[\s\S]*?fromScheduledSelectionRender: true[\s\S]*?\}\);/,
    'reference tab selection should defer the heavier detail-pane render until after the browser has a paint opportunity'
  );
  assert.match(
    rendererText,
    /function selectReferenceEntry\(baseIndex, options = \{\}\) \{[\s\S]*?state\.referenceSelection\[tabKey\] = baseIndex;[\s\S]*?updateReferenceListActiveState\(baseIndex\);[\s\S]*?scheduleReferenceSelectionDetailRender\(\{[\s\S]*?resetDetailScroll: !!options\.resetDetailScroll[\s\S]*?\}\);/,
    'clicking a BIQ reference entry should update the active list item before scheduling the expensive detail refresh'
  );
});

test('reference next-warning jumps scroll selected list item into view', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const scrollActiveReferenceListItemIntoView = \(\) => \{[\s\S]*?listPane\.querySelector\('\.entry-list-item\.active'\)[\s\S]*?listPane\.scrollTo\(\{ top: nextTop, behavior: 'smooth' \}\);[\s\S]*?\};/,
    'reference warning jumps should have a dedicated active-row scroll helper for preserved list DOM'
  );
  assert.match(
    rendererText,
    /nextWarningBtn\.onclick = \(\) => \{[\s\S]*?selectReferenceEntry\(next\.baseIndex, \{ resetDetailScroll: true, scrollListToSelection: true \}\);[\s\S]*?\};/,
    'Reference Next warning should request selected-row scrolling after it changes selection'
  );
});

test('reference picker defers hidden option rows until opened', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /let menuRowsBuilt = false;[\s\S]*?const buildMenuRows = \(\) => \{[\s\S]*?if \(menuRowsBuilt\) return;[\s\S]*?normalizedOptions\.forEach\(\(opt\) => \{/,
    'reference pickers should not build every hidden dropdown row during initial render'
  );
  assert.match(
    rendererText,
    /activeReferencePickerCloser = closeMenu;[\s\S]*?buildMenuRows\(\);[\s\S]*?menu\.classList\.remove\('hidden'\);/,
    'reference picker option rows should be built when the menu is opened'
  );
});

test('sectioned tab preserved list keeps thumbnail hydration queue attached', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const rebuildPendingSectionThumbQueue = \(sectionEntries\) => \{[\s\S]*?entriesByIndex\.set\(String\(entry\.sectionIndex\), entry\);[\s\S]*?pendingSectionThumbs = \[\];[\s\S]*?listPane\.querySelectorAll\('\.entry-list-item\[data-index\]'\)[\s\S]*?thumb\.dataset\.thumbPending !== '1'[\s\S]*?load: makeSectionThumbLoad\(entry\.section, thumb\)[\s\S]*?\};/,
    'sectioned tabs should rebuild their pending thumbnail queue from mounted rows when preserving the list DOM'
  );
  assert.match(
    rendererText,
    /else \{[\s\S]*?rebuildPendingSectionThumbQueue\(sectionEntries\);[\s\S]*?Array\.from\(listPane\.querySelectorAll\('\.entry-list-item'\)\)\.forEach/,
    'Districts, Wonder Districts, and Natural Wonders selection changes should reattach pending thumbnails before updating active row state'
  );
});

test('sectioned tab selection paints active row before deferred detail render', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const updateSectionListActiveState = \(sectionIndex\) => \{[\s\S]*?itemBtn\.classList\.toggle\('active', isActive\);[\s\S]*?makeSectionThumbLoad\(section, thumb\)\(\);[\s\S]*?\};/,
    'sectioned tabs should expose a cheap active-row update path that does not rebuild the detail pane'
  );
  assert.match(
    rendererText,
    /const scheduleSectionSelectionDetailRender = \(options = \{\}\) => \{[\s\S]*?window\.requestAnimationFrame\(\(\) => \{[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?renderSectionBody\(\{[\s\S]*?skipListRebuild: true,[\s\S]*?fromScheduledSelectionRender: true[\s\S]*?\}\);/,
    'Districts, Wonder Districts, and Natural Wonders selection should defer heavier detail rendering until after a paint opportunity'
  );
  assert.match(
    rendererText,
    /const selectSection = \(sectionIndex, options = \{\}\) => \{[\s\S]*?state\.sectionSelection\[tabKey\] = sectionIndex;[\s\S]*?updateSectionListActiveState\(sectionIndex\);[\s\S]*?scheduleSectionSelectionDetailRender\(\{[\s\S]*?resetDetailScroll: !!options\.resetDetailScroll[\s\S]*?\}\);/,
    'clicking a sectioned C3X entry should update the active list item before scheduling the expensive detail refresh'
  );
});

test('modal map zoom previews on the existing canvas stack and defers the expensive rerender until input settles', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const clearDeferredZoomCommit = \(\) => \{[\s\S]*?state\.biqMapZoomCommitTimer[\s\S]*?\};[\s\S]*?const applyTransientZoomPreview = \(fromZoom, toZoom, paneX, paneY, source\) => \{[\s\S]*?mapCanvasStack\.style\.transformOrigin = `\$\{originX\}px \$\{originY\}px`[\s\S]*?mapCanvasStack\.style\.transform = `scale\(\$\{factor\}\)`[\s\S]*?\};[\s\S]*?const scheduleDeferredZoomCommit = \(source\) => \{[\s\S]*?state\.biqMapZoomCommitTimer = window\.setTimeout\(\(\) => \{[\s\S]*?clearTransientZoomPreview\(\);[\s\S]*?rerenderMapView\(\);[\s\S]*?\}, 120\);[\s\S]*?\};/,
    'modal zoom should preview by scaling the existing canvas stack immediately, then pay for a single rerender once input settles'
  );
  assert.match(
    rendererText,
    /const setMapZoom = \(nextZoom, source, paneX, paneY, anchorContent\) => \{[\s\S]*?const renderedZoom = \(floatingUi && state\.biqMapZoomAnim && Number\.isFinite\(state\.biqMapZoomAnim\.renderedZoom\)\)[\s\S]*?state\.biqMapZoomAnchor = \{ fromZoom: renderedZoom, paneX: safePaneX, paneY: safePaneY, contentX, contentY \};[\s\S]*?if \(floatingUi\) \{[\s\S]*?applyTransientZoomPreview\(renderedZoom, clamped, safePaneX, safePaneY, source\);[\s\S]*?scheduleDeferredZoomCommit\(source\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?rerenderMapView\(\);[\s\S]*?const anchorContent = hovered[\s\S]*?\? \{ x: hovered\.centerX, y: hovered\.centerY \}[\s\S]*?: \{[\s\S]*?x: mapPane\.scrollLeft \+ paneX,[\s\S]*?y: mapPane\.scrollTop \+ paneY[\s\S]*?\};/,
    'modal zoom should keep anchor math based on the currently rendered zoom and prefer hovered tile centers over raw pane coordinates when choosing the committed zoom target'
  );
});

test('modal map zoom restore waits for non-zero pane metrics before consuming the saved anchor', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const hasUsablePaneMetrics = \(metrics\) => \{[\s\S]*?paneMetrics\.clientWidth > 0[\s\S]*?paneMetrics\.clientHeight > 0[\s\S]*?paneMetrics\.scrollWidth > 0[\s\S]*?paneMetrics\.scrollHeight > 0[\s\S]*?\};[\s\S]*?const applySavedMapPaneView = \(allowInitialCenter = false\) => \{[\s\S]*?const metrics = getPaneMetrics\(\);[\s\S]*?if \(!hasUsablePaneMetrics\(metrics\)\) return 'defer-layout';[\s\S]*?if \(zoomAnchor && Number\.isFinite\(zoomAnchor\.fromZoom\)\) \{[\s\S]*?const scheduleSavedMapPaneViewRestore = \(attempt = 0\) => \{[\s\S]*?const outcome = applySavedMapPaneView\(true\);[\s\S]*?if \(outcome === 'defer-layout' && attempt < 8\) \{[\s\S]*?scheduleSavedMapPaneViewRestore\(attempt \+ 1\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?\};[\s\S]*?scheduleSavedMapPaneViewRestore\(\);/,
    'modal map zoom restore should defer until the rerendered pane has measurable layout and keep retrying for a few frames, so zoom anchors are not dropped when the first post-render frame still has no scroll range'
  );
});

test('large wrapped BIQ maps keep panning smooth with native scroll and bounded redraws', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const redrawMapAfterTileChanges = \(changedIndexes, options = \{\}\) => \{[\s\S]*?const eventPrefix = String\(options\.eventPrefix \|\| 'paint'\)\.trim\(\)\.toLowerCase\(\) \|\| 'paint';[\s\S]*?const settleEvent = String\(options\.settleEvent \|\| `biq-map:\$\{eventPrefix\}-settled`\)\.trim\(\) \|\| `biq-map:\$\{eventPrefix\}-settled`[\s\S]*?const expandedIndexes = expandTileIndexesForRedraw\(changedIndexes, options\);[\s\S]*?const redrawRects = expandedIndexes\.flatMap\(\(idx\) => tileEditRedrawRects\(idx\) \|\| \[\]\);[\s\S]*?redrawMapCanvasInPlace\(redrawRects\);[\s\S]*?scheduleDeferredMiniMapRefresh\(\{[\s\S]*?settleEvent,/,
    'map edits should use partial redraw rects, defer minimap refresh, and emit a configurable settled timing event after the visual work completes'
  );
  assert.match(
    rendererText,
    /const redrawMapCanvasInPlace = \(clipRects = null, renderOptions = \{\}\) => \{/,
    'canvas redraw should continue to support clipped edit refreshes while allowing chunk-internal draw options'
  );
  assert.match(
    rendererText,
    /appendDebugLog\('biq-map:canvas-redraw-candidates', \{[\s\S]*?candidateCount,[\s\S]*?totalTiles: maxIdx \+ 1,[\s\S]*?candidateMode: candidateIndexes \? 'bounded' : 'full'/,
    'canvas redraw candidate logging should report whether a repaint is full-candidate or bounded-candidate'
  );
  assert.match(
    rendererText,
    /const candidateCount = candidateIndexes \? candidateIndexes\.length : maxIdx \+ 1;[\s\S]*?for \(let drawPos = 0; drawPos < candidateCount; drawPos \+= 1\) \{[\s\S]*?appendDebugLog\('biq-map:canvas-redraw-progress'/,
    'chunk-internal redraws should be able to iterate bounded candidates while full-canvas redraws retain the full candidate count'
  );
  assert.match(
    rendererText,
    /const filterTileIndexesForRects = \(indexes, rects\) => \{[\s\S]*?const candidates = Array\.isArray\(indexes\) \? indexes : \[\];[\s\S]*?clips\.some\(\(rect\) => rectIntersects\(tileClipInfluenceRect\(sx, sy\), rect\)\)[\s\S]*?const redrawMapChunk = \(chunk, clipRects = null\) => \{[\s\S]*?const chunkClips = getClipRectsForChunk\(chunk, clipRects\);[\s\S]*?const candidateIndexes = chunkClips[\s\S]*?filterTileIndexesForRects\(chunkCandidateIndexes, chunkClips\)[\s\S]*?redrawMapCanvasInPlace\([\s\S]*?chunkClips \|\| \[\{ x: chunk\.x, y: chunk\.y, w: chunk\.w, h: chunk\.h \}\]/,
    'clipped edit redraws should filter cached chunk candidates to the actual edited rects instead of repainting full 1024px chunks'
  );
  assert.match(
    rendererText,
    /const minimapBaseCanvas = document\.createElement\('canvas'\);[\s\S]*?let minimapBaseDirty = true;[\s\S]*?let minimapBaseReconcileIdleHandle = 0;[\s\S]*?let pendingMinimapTileIndexes = new Set\(\);/,
    'minimap redraws should keep a cached base canvas with a coalesced idle reconciliation handle'
  );
  assert.match(
    rendererText,
    /const getMiniMapTileDrawRect = \(tileIndex, metrics, paddingPx = 0\) => \{[\s\S]*?const pad = Math\.max\(0, Math\.ceil\(Number\(paddingPx\) \|\| 0\)\);[\s\S]*?const right = Math\.min\(minimapBaseCanvas\.width, Math\.ceil\(sx \+ metrics\.miniTileW\) \+ pad\);[\s\S]*?w: Math\.max\(1, right - x\),[\s\S]*?h: Math\.max\(1, bottom - y\)/,
    'minimap patch rectangles should support padded, canvas-clamped clears so subpixel terrain edges do not leave dark outlines'
  );
  assert.match(
    rendererText,
    /const expandMiniMapPatchIndexes = \(tileIndexes, depth = 5\) => \{[\s\S]*?mapTileNeighborIndexes\(item\.idx\)\.forEach[\s\S]*?const dirtyRects = unique\.map\(\(idx\) => getMiniMapTileDrawRect\(idx, metrics, 2\)\)\.filter\(Boolean\);[\s\S]*?collectMiniMapPatchCandidates\(unique, dirtyRects, metrics\)\.forEach\(\(idx\) => \{[\s\S]*?drawMiniMapBaseTile\(baseCtx, idx, metrics\);/,
    'minimap patches should clear padded edited bounds and repaint a wider local candidate set'
  );
  assert.match(
    rendererText,
    /const scheduleMiniMapBaseReconcile = \(reason = 'patch'\) => \{[\s\S]*?requestIdleCallback[\s\S]*?if \(paintStroke \|\| isDraggingMap \|\| minimapPointerId != null\)[\s\S]*?minimapBaseDirty = true;[\s\S]*?renderMiniMap\(\);[\s\S]*?appendDebugLog\('biq-map:minimap-base-reconcile'/,
    'patched minimap edits should schedule an idle full-base reconciliation after active paint and drag interactions finish'
  );
  assert.match(
    rendererText,
    /if \(!minimapBaseDirty && patchIndexes\.length > 0 && patchMiniMapBaseTiles\(patchIndexes\)\) \{[\s\S]*?scheduleMiniMapBaseReconcile\('patched-edit'\);[\s\S]*?\}[\s\S]*?renderMiniMap\(\);/,
    'deferred minimap refreshes should keep the fast patch path and queue reconciliation only after a successful patch'
  );
  assert.match(
    rendererText,
    /mapPane\.addEventListener\('scroll', \(\) => \{[\s\S]*?state\.biqMapScrollLeft = mapPane\.scrollLeft;[\s\S]*?state\.biqMapScrollTop = mapPane\.scrollTop;[\s\S]*?if \(typeof renderMiniMap === 'function'\) renderMiniMap\(\);[\s\S]*?scheduleTileInfoDockSideUpdate\(\);[\s\S]*?\}\);/,
    'scrolling the map should update persisted scroll state and the minimap without repainting the main canvas'
  );
  assert.match(
    rendererText,
    /const onDragMove = \(ev\) => \{[\s\S]*?const dx = ev\.clientX - dragLastX;[\s\S]*?const dy = ev\.clientY - dragLastY;[\s\S]*?setMapPaneScroll\([\s\S]*?mapPane\.scrollLeft - dx,[\s\S]*?mapPane\.scrollTop - dy,[\s\S]*?\{ reason: 'drag', logWhenNoHorizontal: true \}[\s\S]*?\);/,
    'drag panning should apply scroll directly so the browser can move the already rendered canvas immediately'
  );
  assert.match(
    rendererText,
    /refreshMapViewForToolChange = \(options = \{\}\) => \{[\s\S]*?if \(shouldRedrawCanvas\) redrawMapCanvasInPlace\(\);[\s\S]*?\};[\s\S]*?const applySavedMapPaneView = \(allowInitialCenter = false\) => \{[\s\S]*?if \(zoomAnchor && Number\.isFinite\(zoomAnchor\.fromZoom\)\) \{[\s\S]*?setMapPaneScroll\(targetLeft, targetTop, \{ reason: 'zoom-anchor', logWhenNoHorizontal: true \}\);[\s\S]*?return 'zoom-anchor';[\s\S]*?\}[\s\S]*?if \(Number\.isFinite\(state\.biqMapScrollLeft\) && Number\.isFinite\(state\.biqMapScrollTop\)\) \{[\s\S]*?setMapPaneScroll\(state\.biqMapScrollLeft, state\.biqMapScrollTop, \{ reason: 'restore-scroll' \}\);[\s\S]*?return 'restore-scroll';[\s\S]*?\}[\s\S]*?applySavedMapPaneView\(false\);[\s\S]*?window\.requestAnimationFrame\(\(\) => \{[\s\S]*?applySavedMapPaneView\(true\);[\s\S]*?redrawMapCanvasInPlace\(\);/,
    'initial map open and tool-driven refreshes should use a synchronous whole-canvas redraw instead of the viewport scheduler'
  );
  assert.doesNotMatch(rendererText, /const scheduleViewportRedraw = \(/, 'the reverted smooth-pan renderer should not include the viewport redraw scheduler');
  assert.doesNotMatch(rendererText, /let dragScrollRaf = 0;/, 'the reverted smooth-pan renderer should not coalesce drag scroll through an extra RAF queue');
});

test('map overlay rendering offsets colony-like overlays, draws barricades, and shifts ruins right/down', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /function getColonyTypeForTile\(tile\) \{[\s\S]*?const overlays = parseIntLoose\(getMapFieldStoredValue\(tile, 'c3coverlays', '0'\), 0\) >>> 0;[\s\S]*?if \(overlays & 0x20000000\) return 1;[\s\S]*?if \(overlays & 0x40000000\) return 2;[\s\S]*?if \(overlays & 0x80000000\) return 3;[\s\S]*?const colonyRecord = getTileColonyRecord\(tile\);/,
    'colony-like rendering should prefer tile overlay mask bits for airfield, radar tower, and outpost type detection before falling back to CLNY improvement type'
  );
  assert.match(
    rendererText,
    /const drawColonyOverlay = \(record, sx, sy\) => \{[\s\S]*?const midY = sy \+ Math\.floor\(tileH \/ 2\);[\s\S]*?drawSheetSprite\(sheet, cols, rows, \(4 \* Math\.max\(0, Math\.min\(3, colonyAge\)\)\) \+ 1, sx, midY\);[\s\S]*?ctx\.drawImage\(airfieldsSheet, airfieldVariant \* 128, 0, 128, 64, sx, midY, tileW, tileH\);[\s\S]*?ctx\.drawImage\(airfieldsSheet, 0, 192, 128, 128, sx, sy - Math\.floor\(tileH \/ 2\), tileW, tileH \* 2\);[\s\S]*?ctx\.drawImage\(airfieldsSheet, outpostVariant \* 128, 64, 128, 128, sx, sy - Math\.floor\(tileH \/ 2\), tileW, tileH \* 2\);/,
    'colony, airfield, radar tower, and outpost overlays should all render half a tile lower on the map'
  );
  assert.match(
    rendererText,
    /const syncTileColonyOverlayBits = \(tile, colonyType = -1\) => \{[\s\S]*?let next = current & \(~0xE0000000\);[\s\S]*?if \(Number\(colonyType\) === 1\) next \|= 0x20000000;[\s\S]*?else if \(Number\(colonyType\) === 2\) next \|= 0x40000000;[\s\S]*?else if \(Number\(colonyType\) === 3\) next \|= 0x80000000;/,
    'colony-like edits should keep TILE C3C overlay bits synchronized with the selected airfield, radar tower, or outpost type'
  );
  assert.match(
    rendererText,
    /if \(\(c3cOverlays & 0x10000000\) === 0x10000000\) \{[\s\S]*?drawSheetSprite\(sheet, cols, 4, 3, sx, midY\);[\s\S]*?\}/,
    'barricade overlays should render from the terrain buildings sheet when the barricade mask bit is present'
  );
  assert.match(
    rendererText,
    /const drawRuinsOverlay = \(record, sx, sy\) => \{[\s\S]*?const drawX = sx - Math\.round\(\(drawW - tileW\) \/ 2\) - Math\.round\(20 \* scale\) \+ Math\.round\(tileW \/ 4\);[\s\S]*?const drawY = sy \+ Math\.floor\(tileH \/ 2\) - Math\.round\(15 \* scale\) - Math\.round\(\(drawH - tileH\) \/ 2\) \+ Math\.round\(tileH \/ 4\);/,
    'ruins overlay should render half a tile farther right and lower than the previous placement'
  );
});

test('map modal undo all follows tracked map dirty state', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /function hasTrackedUnsavedMapChanges\(\) \{[\s\S]*?!state\.isDirty[\s\S]*?getTabDirtyCount\('map'\) > 0[\s\S]*?hasPendingMapWriteState\(mapTab\)[\s\S]*?!getLatestScopedUndoSnapshot\('map'\)[\s\S]*?hasChangedFromClean\(mapTab, getCleanTabsObject\(\)\.map \|\| null\)/,
    'map-specific undo-all enablement should use tracked dirty sources instead of passive structural map comparison'
  );
  assert.match(
    rendererText,
    /mapModal\.undoAllBtn\.disabled = !isScenarioMode\(\) \|\| !hasTrackedUnsavedMapChanges\(\) \|\| state\.isLoading;/,
    'map modal Undo All should disable unless tracked map changes exist'
  );
  assert.match(
    rendererText,
    /mapModal\.body\.appendChild\(renderBiqMapSection\(mapModal\.tab, mapModal\.tileSection, \{ inModal: true \}\)\);\s*reconcilePassiveMapRenderWithCleanSnapshot\(mapModal\.tab\);/,
    'opening the map modal should reconcile passive render-only map fields into the clean snapshot'
  );
});
