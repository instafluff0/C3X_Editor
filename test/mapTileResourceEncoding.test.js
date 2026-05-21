const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Map TILE resource display follows Quint zero-based GOOD icon mapping', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const configCoreText = fs.readFileSync(path.join(__dirname, '..', 'src', 'configCore.js'), 'utf8');

  assert.match(
    configCoreText,
    /if \(k === 'resource'\) field\.value = maybeFormatIdReference\(goodIndex, v\);/,
    'TILE.resource should format as a zero-based GOOD reference with -1 as none'
  );
  assert.match(
    rendererText,
    /const resourceId = parseIntLoose\(getFieldByBaseKey\(record, 'resource'\)\?\.value, -1\);[\s\S]*?const iconIdx = goodIconById\[resourceId\];/,
    'map drawing should use TILE.resource directly as the GOOD record index before reading GOOD.icon'
  );
  assert.match(
    rendererText,
    /function getMapGoodRecords\(bundle = state\.bundle\)[\s\S]*?section\.code \|\| ''\)\.toUpperCase\(\) === 'GOOD'/,
    'resource icon lookup should prefer BIQ map GOOD records when available'
  );
  assert.match(
    rendererText,
    /function getMapResourceRecordField\(record, baseKey\)[\s\S]*?Array\.isArray\(record\.biqFields\)[\s\S]*?getFieldByBaseKey\(\{ fields: record\.biqFields \}, baseKey\)/,
    'resource icon lookup should read GOOD.icon from BIQ-backed reference entry fields'
  );
  assert.match(
    rendererText,
    /const iconField = getMapResourceRecordField\(entry, 'icon'\);[\s\S]*?iconById\[resourceId\] = Number\.isFinite\(parsedIcon\) && parsedIcon >= 0 \? parsedIcon : idx;/,
    'resource icon lookup should map TILE.resource to GOOD.icon, not to the row index when icon data exists'
  );
  assert.doesNotMatch(
    rendererText,
    /distinctIcons\.size <= 1[\s\S]*?iconById\[resourceId\] = idx;/,
    'resource icon lookup should not replace valid GOOD.icon values with row-index fallback'
  );
  assert.match(
    rendererText,
    /baseKey: 'resource', value: generatedTile \? generatedTile\.resource : -1/,
    'generated map records should preserve zero-based resource ids and -1 none sentinel'
  );
});
