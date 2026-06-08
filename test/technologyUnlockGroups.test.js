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
