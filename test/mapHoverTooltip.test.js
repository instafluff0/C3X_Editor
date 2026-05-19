const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Map canvas hover tooltip shows current grid coordinates', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const stylesText = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

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
    rendererText,
    /const label = `x=\$\{geom\.xPos\}, y=\$\{geom\.yPos\}`;[\s\S]*?hoverTooltip\.textContent = label;/,
    'hover tooltip should display the hovered tile grid coordinates'
  );
  assert.match(
    rendererText,
    /const drawHoverBorder = \(hit\) => \{[\s\S]*?shadowColor = 'rgba\(196, 149, 255, 0\.52\)'[\s\S]*?hoverGradient\.addColorStop\(1, 'rgba\(244, 158, 255, 0\.96\)'\)[\s\S]*?drawTileDiamondPath\(hoverCtx, cx, cy, Math\.max\(3, Math\.round\(tilePx \/ 3\.8\)\)\);/,
    'hover border should draw a lighter inset purple-gradient diamond around the hovered tile'
  );
  assert.match(
    rendererText,
    /const drawPaintPreview = \(hit\) => \{[\s\S]*?const previewIndexes = getBrushTileIndexes\(hit\.index\);[\s\S]*?previewIndexes\.forEach\(\(tileIdx\) => \{[\s\S]*?hoverCtx\.globalAlpha = 0\.84;[\s\S]*?if \(mode === 'terrain'\) \{[\s\S]*?const previewVariantState = getMapToolTerrainVariantState\(effectiveTerrainCode\);[\s\S]*?drawTileDiamondPath\(hoverCtx, Math\.round\(logical\.cx\), Math\.round\(logical\.cy\), Math\.max\(2, Math\.round\(tilePx \/ 8\)\)\);[\s\S]*?hoverCtx\.fillStyle = terrainPreviewFillStyle\(baseTerrainForPaint\(effectiveTerrainCode\)\);[\s\S]*?drawSimpleTerrainPreviewOverlay\(hoverCtx, effectiveTerrainCode, sx, sy, logical, previewVariantState\);[\s\S]*?if \(mode === 'resource'\) \{[\s\S]*?hoverCtx\.drawImage\(atlas, col \* cellW, row \* cellH, cellW, cellH, dx, dy, Math\.round\(cellW \* scale\), Math\.round\(cellH \* scale\)\)[\s\S]*?if \(mode === 'district'\) \{[\s\S]*?drawDistrictOverlay\(hoverCtx, previewRecord, geom, sx, sy, 'all'\);/,
    'paint preview should render semi-transparent previews across the whole brush footprint for terrain, resources, and district art'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const isPine = effectiveCode === BIQ_TERRAIN\.FOREST && !!previewVariant\.pineForest;[\s\S]*?const cols = isPine \? 6 : 4;[\s\S]*?const startRow = effectiveCode === BIQ_TERRAIN\.JUNGLE[\s\S]*?\(isPine \? 8 : 4\);/,
    'forest terrain preview should use the pine-forest sprite block when the Pine Forest variant is selected'
  );
  assert.match(
    rendererText,
    /const drawSimpleTerrainPreviewOverlay = \(drawCtx, terrainCode, sx, sy, logical, variantState = null\) => \{[\s\S]*?const previewVariant = variantState \|\| \{\};[\s\S]*?const mountainSheet = previewVariant\.snowCappedMountain[\s\S]*?\(state\.biqMapArtCache\.snowMountains \|\| state\.biqMapArtCache\.mountains\)[\s\S]*?: state\.biqMapArtCache\.mountains;/,
    'mountain terrain preview should use snow-capped mountain art when the Snow-Capped variant is selected'
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
    /floatingRight = document\.createElement\('div'\);[\s\S]*?floatingRight\.className = 'biq-map-floating-panel biq-map-floating-right';[\s\S]*?if \(state\.biqMapTileInfoDockLeft\) floatingRight\.classList\.add\('dock-left'\);[\s\S]*?const updateTileInfoDockSide = \(\) => \{[\s\S]*?if \(tileInfoPanel\.classList\.contains\('hidden'\)\) \{[\s\S]*?state\.biqMapTileInfoDockLeft = false;[\s\S]*?const shouldDockLeft = distanceFromRight <= flipThreshold;[\s\S]*?state\.biqMapTileInfoDockLeft = shouldDockLeft;[\s\S]*?floatingRight\.classList\.toggle\('dock-left', shouldDockLeft\);/,
    'tile-info dock side should persist across full map rerenders so a left-docked panel does not teleport right before re-docking'
  );
  assert.doesNotMatch(
    rendererText,
    /const buildMapSelectionCategorySelect = \(value, options = \{\}\) => \{[\s\S]*?scheduleTileInfoRender\(\);[\s\S]*?refreshMapViewForToolChange\(\);/,
    'select-mode category changes should not queue an extra tile-info render and unconditional full map refresh'
  );
  assert.match(
    rendererText,
    /const BARBARIAN_OWNER_PICKER_VALUE = 'barbarian-civ';[\s\S]*?const getMapOwnerPickerOptions = \(\) => \{[\s\S]*?const barbarianOption = getBarbarianOwnerPickerOption\(\);[\s\S]*?if \(barbarianOption\) options\.push\(barbarianOption\);[\s\S]*?const addCityOwnerPicker = \(\) => \{[\s\S]*?const options = getMapOwnerPickerOptions\(\);[\s\S]*?const ownerSpec = resolveMapOwnerSelection\(value\);[\s\S]*?setMapFieldValue\(cityRecord, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(cityRecord, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?colocatedUnits\.forEach\(\(record\) => \{[\s\S]*?setMapFieldValue\(record, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(record, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?\}\);[\s\S]*?scheduleMapEditRerender\(0, \{[\s\S]*?territoryChanged:\s*true/,
    'changing a city owner in tile info should also transfer any units on that same tile to the new owner and force an immediate territory-aware map rerender'
  );
  assert.match(
    rendererText,
    /const renderCityOptions = \(host, tile, geom\) => \{[\s\S]*?if \(!cityRecord\) \{[\s\S]*?tileInfoPanel\.style\.removeProperty\('--tile-info-owner-tint'\);[\s\S]*?tileInfoPanel\.classList\.remove\('tile-info-owner-tinted'\);/,
    'empty city tile-info state should clear any prior civ tint before rendering its neutral no-city card'
  );
  assert.match(
    rendererText,
    /const ownerPicker = createReferencePicker\({[\s\S]*?onSelect: \(value\) => \{[\s\S]*?const ownerSpec = resolveMapOwnerSelection\(value\);[\s\S]*?units\.forEach\(\(record\) => \{[\s\S]*?setMapFieldValue\(record, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(record, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?\}\);[\s\S]*?const colocatedCity = getCityRecordForTile\(tile, geom\);[\s\S]*?if \(colocatedCity\) \{[\s\S]*?setMapFieldValue\(colocatedCity, 'ownertype', String\(ownerSpec\.ownerType\), 'Owner Type'\);[\s\S]*?setMapFieldValue\(colocatedCity, 'owner', String\(ownerSpec\.owner\), 'Owner'\);[\s\S]*?\}[\s\S]*?fullMapRerender:\s*!!colocatedCity/,
    'changing unit owners in tile info should also transfer any city on that tile and trigger a full map rerender when territory ownership changes'
  );
  assert.match(
    rendererText,
    /const getBarbarianOwnerPickerOption = \(\) => \{[\s\S]*?const entry = getBarbarianCivilizationPickerEntry\(\);[\s\S]*?return \{[\s\S]*?value: BARBARIAN_OWNER_PICKER_VALUE,[\s\S]*?ownerType: 1,[\s\S]*?owner: 0/,
    'city and unit owner pickers should expose the barbarian civilization as a structured option that writes civ ownership'
  );
  assert.match(
    rendererText,
    /const renderUnitOptions = \(host, tile, geom\) => \{[\s\S]*?const units = getUnitRecordsForTile\(geom\);[\s\S]*?if \(!units\.length\) \{[\s\S]*?tileInfoPanel\.style\.removeProperty\('--tile-info-owner-tint'\);[\s\S]*?tileInfoPanel\.classList\.remove\('tile-info-owner-tinted'\);/,
    'empty unit tile-info state should clear any prior civ tint before rendering its neutral no-units card'
  );
  assert.match(
    rendererText,
    /canvas\.addEventListener\('pointermove', \(ev\) => \{[\s\S]*?updateHoverTooltip\(ev\);/,
    'map canvas should update the coordinate tooltip on pointer movement'
  );
  assert.match(
    rendererText,
    /drawHoverBorder\(hit\);[\s\S]*?drawPaintPreview\(hit\);/,
    'paint mode should draw the selected paint preview into the hovered tile as the pointer moves'
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

test('map overlay rendering offsets colony-like overlays, draws barricades, and shifts ruins right/down', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(
    rendererText,
    /const drawColonyOverlay = \(record, sx, sy\) => \{[\s\S]*?const midY = sy \+ Math\.floor\(tileH \/ 2\);[\s\S]*?drawSheetSprite\(sheet, cols, rows, \(4 \* Math\.max\(0, Math\.min\(3, colonyAge\)\)\) \+ 1, sx, midY\);[\s\S]*?ctx\.drawImage\(airfieldsSheet, airfieldVariant \* 128, 0, 128, 64, sx, midY, tileW, tileH\);[\s\S]*?ctx\.drawImage\(airfieldsSheet, 0, 192, 128, 128, sx, sy - Math\.floor\(tileH \/ 2\), tileW, tileH \* 2\);[\s\S]*?ctx\.drawImage\(airfieldsSheet, outpostVariant \* 128, 64, 128, 128, sx, sy - Math\.floor\(tileH \/ 2\), tileW, tileH \* 2\);/,
    'colony, airfield, radar tower, and outpost overlays should all render half a tile lower on the map'
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
