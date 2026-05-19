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
    /prtoClassById\[idx\]\s*=\s*normalizeUnitClassValue\(getFieldByBaseKey\(record,\s*'unitclass'\)\?\.value\);[\s\S]*?const unitClass = prtoClassById\[unitId\] \|\| 'land';[\s\S]*?const unitYOffset = unitClass === 'air'[\s\S]*?Math\.round\(30 \* tileScale\)[\s\S]*?\(unitClass === 'sea' \? Math\.round\(14 \* tileScale\) : 0\);[\s\S]*?dy = quintUnitBottom - flcH \+ unitYOffset;[\s\S]*?dy = quintUnitTop \+ unitYOffset;/,
    'unit overlays should cache unit class and apply larger zoom-scaled offsets for air than sea units in both FLC and units32 paths'
  );
});
