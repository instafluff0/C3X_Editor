'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_PATH = path.join(__dirname, '..', 'src', 'renderer.js');
const STYLES_PATH = path.join(__dirname, '..', 'src', 'styles.css');

test('Governments view exposes Required By improvements backed by downstream records', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  const groupsMatch = source.match(/const GOVERNMENT_REQUIRED_BY_GROUPS = \[[\s\S]*?\];/);
  assert.ok(groupsMatch, 'Expected government Required By group specs');
  const groupsSource = groupsMatch[0];

  assert.match(groupsSource, /key: 'improvements'[\s\S]*?fieldKey: 'reqgovernment'[\s\S]*?sectionCode: 'BLDG'/);
  assert.match(groupsSource, /key: 'districts'[\s\S]*?fieldKey: 'buildable_by_civ_govs'[\s\S]*?kind: 'sectionList'/);
  assert.match(source, /renderGovernmentUsageBoard\('Required By', GOVERNMENT_REQUIRED_BY_GROUPS/);
});

test('Governments usage edits dirty the owning downstream records', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');

  assert.match(
    source,
    /function setGovernmentUsageMembership\(spec, governmentIndex, selectedEntryIndices, governmentEntry = null\) \{[\s\S]*?ensureTechnologyUnlockFieldByBaseKey\(entry, spec\.fieldKey, 'Required Government', '-1'\)[\s\S]*?field\.value = String\(governmentIndex\)[\s\S]*?setGovernmentUsageReferenceTarget\(field, governmentEntry, governmentIndex\)/,
    'Expected selected improvements to write the selected government into reqgovernment'
  );
  assert.match(
    source,
    /function setGovernmentUsageMembership\(spec, governmentIndex, selectedEntryIndices, governmentEntry = null\) \{[\s\S]*?field\.value = '-1'[\s\S]*?setFieldReferenceTargetMeta\(field, 'governments', null, '-1', \[\]\)/,
    'Expected unselected improvements to clear reqgovernment'
  );
  assert.match(
    source,
    /function setGovernmentUsageMembership\(spec, governmentIndex, selectedEntryIndices, governmentEntry = null\) \{[\s\S]*?rebuildReferenceDirtyCacheForTab\(spec\.tabKey\)/,
    'Expected government usage edits to dirty the downstream improvements tab'
  );
  assert.match(
    source,
    /function setGovernmentUsageMembership\(spec, governmentIndex, selectedEntryIndices, governmentEntry = null\) \{[\s\S]*?isGovernmentUsageSectionGroup\(spec\)[\s\S]*?setSectionResourceListTokens\(section, spec\.fieldKey, tokens\.concat\(governmentName\)\)[\s\S]*?markResourceUsageSectionDirty\(spec, didChange\)/,
    'Expected selected districts to write the selected government into buildable_by_civ_govs'
  );
  assert.match(
    source,
    /function rememberGovernmentUsageUndoSnapshot\(spec\) \{[\s\S]*?isGovernmentUsageSectionGroup\(spec\)[\s\S]*?rememberUndoSnapshotForKey\(`SECTION_TAB:\$\{String\(spec && spec\.tabKey/,
    'Expected district government usage edits to use the C3X section-tab undo scope'
  );
  assert.match(
    source,
    /function isGovernmentUsageSpecEditable\(spec, referenceEditable\) \{[\s\S]*?isGovernmentUsageSectionGroup\(spec\)[\s\S]*?canEditC3XConfigTab\(spec\.tabKey\)[\s\S]*?return !!referenceEditable/,
    'Expected district government usage edits to use C3X section editability'
  );
});

test('Governments usage UI is mounted in the Governments detail pane and styled', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  const styles = fs.readFileSync(STYLES_PATH, 'utf8');

  assert.match(source, /governmentUsageBoards = renderGovernmentUsageBoards\(\{[\s\S]*?entry,[\s\S]*?selectedBaseIndex,[\s\S]*?referenceEditable[\s\S]*?\}\)/);
  assert.match(
    source,
    /else if \(tabKey === 'governments'\) \{[\s\S]*?identityMeta\.appendChild\(identityGrid\);[\s\S]*?if \(governmentUtilityStack\) identityMeta\.appendChild\(governmentUtilityStack\);[\s\S]*?governmentIdentityTechStack[\s\S]*?identityMeta\.appendChild\(governmentIdentityTechStack\);[\s\S]*?if \(governmentUsageBoards\) identityMeta\.appendChild\(governmentUsageBoards\);[\s\S]*?\}/,
    'Expected Governments detail order to be identity, Civilopedia\/icons, Required Tech, then Required By'
  );

  assert.match(styles, /\.resource-identity-stack,\n\.government-identity-stack \{/);
  assert.match(styles, /\.resource-identity-tech-stack,\n\.government-identity-tech-stack \{/);
  assert.match(styles, /\.government-usage-boards \{/);
  assert.match(styles, /\.technology-unlocks-board,\n\.resource-usage-board,\n\.government-usage-board \{/);
  assert.match(styles, /\.technology-unlock-cell,\n\.resource-usage-cell,\n\.government-usage-cell \{/);
});
