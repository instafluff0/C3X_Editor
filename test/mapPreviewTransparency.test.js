const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Map tab PCX previews request Civ3 transparent palette slots', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function requestBiqMapArtAsset[\s\S]*?transparentIndexes:\s*\[\s*254,\s*255\s*\]/,
    'map art loader should make indexed PCX slots 254 and 255 transparent'
  );
  assert.match(
    text,
    /requestBiqMapArtAsset\('territory',\s*'Art\/Terrain\/Territory\.pcx',\s*\{\s*transparentIndexes:\s*\[\s*1,\s*254,\s*255\s*\]\s*\}\)/,
    'Territory.pcx should preserve its extra transparent slot while keeping 254/255 transparent'
  );
});

test('Map art previews prioritize BIQ scenario search roots', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function getScenarioPreviewPaths\(\)[\s\S]*?state\.bundle\.scenarioSearchPaths\.forEach\(add\);[\s\S]*?add\(state\.bundle && state\.bundle\.scenarioPath\);/,
    'scenario preview roots should start with BIQ scenario search folders before the BIQ directory'
  );
  assert.match(
    text,
    /function getActiveScenarioPreviewPath\(\)[\s\S]*?const roots = getScenarioPreviewPaths\(\);[\s\S]*?if \(roots\.length > 0\) return roots\[0\];/,
    'map art requests should use the first scenario search root as the primary asset root'
  );
  assert.match(
    text,
    /function requestBiqMapArtAsset[\s\S]*?const scenarioPath = getActiveScenarioPreviewPath\(\);[\s\S]*?const scenarioPaths = getScenarioPreviewPaths\(\);[\s\S]*?scenarioPath,[\s\S]*?scenarioPaths,/,
    'map art loader should resolve PCX assets from the active scenario roots'
  );
});

test('Map district previews do not treat fully transparent crops as drawable art', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function rgbaPreviewHasVisiblePixels\(preview\)[\s\S]*?decoded\.rgba\[i\] > 0/,
    'map district previews should inspect alpha before accepting a crop as visible'
  );
  assert.match(
    text,
    /function rgbaPreviewToVisibleCanvas\(preview,[\s\S]*?biq-map:transparent-district-preview[\s\S]*?return null;/,
    'transparent district crops should log and fall back instead of suppressing the marker'
  );
  assert.match(
    text,
    /requestBiqMapDistrictCanvas[\s\S]*?rgbaPreviewToVisibleCanvas\(preview, cacheKey,/,
    'ordinary map district cells should use the visible-canvas guard'
  );
});
