const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('district representative preview normalizes detected building columns to available picker options', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function normalizeDistrictRepresentativeBuildingSelection\(\{/,
    'renderer should expose a helper for clamping representative building selections'
  );

  assert.match(
    text,
    /filter\(\(value\) => Number\.isFinite\(value\) && value > 0 && value <= maxBuildingCol\)/,
    'by-building representative columns should be constrained to configured building buttons'
  );

  assert.match(
    text,
    /buildingCol: Math\.min\(detectedCol, maxBuildingCol\),\s*buildingCols: \[\]/,
    'by-count representative columns should clamp to the last available building option'
  );

  assert.match(
    text,
    /const normalizedBuildingSelection = normalizeDistrictRepresentativeBuildingSelection\(\{/,
    'district preview card should normalize representative building selection before syncing buttons'
  );

  assert.match(
    text,
    /if \(canUseRepresentativeDirectly\) \{\s*loadedPreview = representative;/,
    'preview card should only reuse the representative image when it still matches a valid picker state'
  );

  assert.match(
    text,
    /function getDistrictPreviewEraNames\(\) \{[\s\S]*?makeBiqSectionIndexOptions\('ERAS', false\)[\s\S]*?namesByIndex\[idx\] = label;[\s\S]*?namesByIndex\[idx\] \|\| fallback\[idx\]/,
    'district preview era buttons should use shared BIQ era labels, with stock labels only as fallback'
  );

  assert.match(
    text,
    /const ERA_NAMES = getDistrictPreviewEraNames\(\);/,
    'district representative preview should use the shared scenario-aware era-label helper'
  );

  assert.match(
    text,
    /Math\.min\(ERA_NAMES\.length - 1, Number\(representative\.representativeEraIndex\) \|\| 0\)/,
    'detected representative era rows should clamp to a visible picker button'
  );
});

test('section tab empty state uses the defined compact action flag', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.doesNotMatch(
    text,
    /useCompactEntityActions/,
    'empty section tabs should not reference an undefined compact-action flag'
  );
  assert.match(
    text,
    /if \(useInlineFilterActions\) \{\s*addFirst\.className = 'ghost action-add';/,
    'Districts/Wonder Districts/Natural Wonders empty states should use the existing inline action flag'
  );
});
