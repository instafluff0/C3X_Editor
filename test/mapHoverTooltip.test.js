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
    /const drawHoverBorder = \(hit\) => \{[\s\S]*?shadowColor = 'rgba\(0, 214, 255, 0\.72\)'[\s\S]*?hoverCtx\.stroke\(\);/,
    'hover border should draw a visible outlined diamond around the hovered tile'
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
    /canvas\.addEventListener\('pointermove', \(ev\) => \{[\s\S]*?updateHoverTooltip\(ev\);/,
    'map canvas should update the coordinate tooltip on pointer movement'
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
});
