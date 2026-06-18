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

function extractConstObjectSource(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `expected ${name} object to exist`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const semi = source.indexOf(';', index);
        assert.notEqual(semi, -1, `expected ${name} object terminator`);
        return source.slice(start, semi + 1);
      }
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function loadSortHelpers() {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const context = { module: { exports: {} }, exports: {} };
  vm.runInNewContext([
    extractConstObjectSource(rendererText, 'UNIT_AI_STRATEGY_BADGE_BITS'),
    extractConstObjectSource(rendererText, 'UNIT_AI_STRATEGY_BADGE_LABELS'),
    extractFunctionSource(rendererText, 'cloneStateMap'),
    extractFunctionSource(rendererText, 'normalizeRuleLookupKey'),
    extractFunctionSource(rendererText, 'normalizeMainUnitReferenceSort'),
    extractFunctionSource(rendererText, 'sanitizeReferenceUnitSortMap'),
    extractFunctionSource(rendererText, 'getUnitReferenceSortOptions'),
    extractFunctionSource(rendererText, 'normalizeUnitPrimaryReorderOrder'),
    extractFunctionSource(rendererText, 'summarizeUnitReorderOrderForLog'),
    extractFunctionSource(rendererText, 'normalizeUnitReorderMovedIndexes'),
    extractFunctionSource(rendererText, 'isUnitReferenceReorderOp'),
    extractFunctionSource(rendererText, 'getUnitReferenceInGameSortIndex'),
    extractFunctionSource(rendererText, 'normalizeUnitBiqIndexBadgeNumber'),
    extractFunctionSource(rendererText, 'getReferenceTabUnitReorderMovedIndexes'),
    extractFunctionSource(rendererText, 'hasReferenceEntryStructuralDirtyState'),
    extractFunctionSource(rendererText, 'getReferenceRecordOpDirtyCount'),
    extractFunctionSource(rendererText, 'combineReferenceDirtyCountWithRecordOps'),
    extractFunctionSource(rendererText, 'buildUnitReorderUndoSnapshot'),
    extractFunctionSource(rendererText, 'applyUnitReorderUndoSnapshotToTabs'),
    extractFunctionSource(rendererText, 'getUnitBiqIndexBadgeRows'),
    extractFunctionSource(rendererText, 'buildUnitBiqIndexBadgeText'),
    extractFunctionSource(rendererText, 'isTruthyUnitBadgeFieldValue'),
    extractFunctionSource(rendererText, 'getUnitAiStrategyMaskForBadge'),
    extractFunctionSource(rendererText, 'getUnitAiStrategyLabelsForBadge'),
    extractFunctionSource(rendererText, 'buildUnitBiqIndexBadgeTitle'),
    extractFunctionSource(rendererText, 'getUnitAiStrategyBitCountFromMask'),
    extractFunctionSource(rendererText, 'getUnitReorderAutoScrollSpeed'),
    extractFunctionSource(rendererText, 'copyCanvasPixelsToClone'),
    extractFunctionSource(rendererText, 'compareUnitReferenceInGameOrder'),
    'module.exports = { normalizeMainUnitReferenceSort, sanitizeReferenceUnitSortMap, getUnitReferenceSortOptions, normalizeUnitPrimaryReorderOrder, summarizeUnitReorderOrderForLog, normalizeUnitReorderMovedIndexes, isUnitReferenceReorderOp, getUnitReferenceInGameSortIndex, normalizeUnitBiqIndexBadgeNumber, getReferenceTabUnitReorderMovedIndexes, hasReferenceEntryStructuralDirtyState, getReferenceRecordOpDirtyCount, combineReferenceDirtyCountWithRecordOps, buildUnitReorderUndoSnapshot, applyUnitReorderUndoSnapshotToTabs, getUnitBiqIndexBadgeRows, buildUnitBiqIndexBadgeText, getUnitAiStrategyLabelsForBadge, buildUnitBiqIndexBadgeTitle, getUnitAiStrategyBitCountFromMask, getUnitReorderAutoScrollSpeed, copyCanvasPixelsToClone, compareUnitReferenceInGameOrder };'
  ].join('\n'), context);
  return { rendererText, ...context.module.exports };
}

test('main Units sort excludes Manual and sanitizes persisted Manual to In-game order', () => {
  const {
    rendererText,
    normalizeMainUnitReferenceSort,
    sanitizeReferenceUnitSortMap,
    getUnitReferenceSortOptions
  } = loadSortHelpers();

  assert.deepEqual(
    Array.from(getUnitReferenceSortOptions().map((opt) => opt.value)),
    ['ingame', 'az', 'za']
  );
  assert.deepEqual(
    Array.from(getUnitReferenceSortOptions({ includeManual: true }).map((opt) => opt.value)),
    ['ingame', 'az', 'za', 'manual']
  );
  assert.equal(normalizeMainUnitReferenceSort('manual'), 'ingame');
  assert.equal(normalizeMainUnitReferenceSort('az'), 'az');
  assert.deepEqual({ ...sanitizeReferenceUnitSortMap({ units: 'manual' }) }, { units: 'ingame' });

  const unitTablePanelSource = extractFunctionSource(rendererText, 'createUnitTablePanel');
  assert.match(
    unitTablePanelSource,
    /getUnitReferenceSortOptions\(\{ includeManual: true \}\)/,
    'Unit Table should be the only Units UI that asks for Manual sort'
  );
  assert.doesNotMatch(
    unitTablePanelSource,
    /state\.referenceUnitSort/,
    'Unit Table sort state must not leak into the main Units list sort state'
  );
});

test('in-game unit ordering keeps BIQ records before synthetic era variants after no-reload save reconciliation', () => {
  const { compareUnitReferenceInGameOrder } = loadSortHelpers();
  const rows = [
    { name: 'Army Eras Ancient Times', biqIndex: null },
    { name: 'Tomb Crawler', biqIndex: 120 },
    { name: 'Settler', biqIndex: 0 },
    { name: 'Worker Eras Modern Era', biqIndex: null },
    { name: 'Crusader', biqIndex: 41 }
  ];

  rows.sort(compareUnitReferenceInGameOrder);

  assert.deepEqual(
    rows.map((row) => row.name),
    ['Settler', 'Crusader', 'Tomb Crawler', 'Army Eras Ancient Times', 'Worker Eras Modern Era']
  );
});

test('main Units in-game sort surfaces unsaved new entries until save reconciliation assigns final order', () => {
  const { compareUnitReferenceInGameOrder } = loadSortHelpers();
  const rows = [
    { name: 'Settler Eras Modern Era', biqIndex: null, isNew: false },
    { name: 'Tomb Crawler', biqIndex: 120, isNew: false },
    { name: 'Tomb Crawler Copy', biqIndex: null, isNew: true },
    { name: 'Settler', biqIndex: 0, isNew: false }
  ];

  const liveRows = rows.slice().sort((a, b) => compareUnitReferenceInGameOrder(a, b, { preferUnsavedNew: true }));
  assert.deepEqual(
    liveRows.map((row) => row.name),
    ['Tomb Crawler Copy', 'Settler', 'Tomb Crawler', 'Settler Eras Modern Era']
  );

  const reconciledRows = [
    { name: 'Tomb Crawler Copy', biqIndex: 121, isNew: true },
    { name: 'Settler', biqIndex: 0, isNew: false },
    { name: 'Tomb Crawler', biqIndex: 120, isNew: false }
  ].sort(compareUnitReferenceInGameOrder);
  assert.deepEqual(
    reconciledRows.map((row) => row.name),
    ['Settler', 'Tomb Crawler', 'Tomb Crawler Copy']
  );
});

test('main Units in-game sort previews pending unit reorder without changing saved BIQ indices', () => {
  const {
    compareUnitReferenceInGameOrder,
    getUnitReferenceInGameSortIndex,
    normalizeUnitPrimaryReorderOrder
  } = loadSortHelpers();
  const rows = [
    { name: 'Settler', biqIndex: 0 },
    { name: 'Worker', biqIndex: 1, pendingBiqIndex: 2 },
    { name: 'Scout', biqIndex: 2, pendingBiqIndex: 1 }
  ].sort(compareUnitReferenceInGameOrder);

  assert.deepEqual(
    rows.map((row) => row.name),
    ['Settler', 'Scout', 'Worker']
  );
  assert.equal(getUnitReferenceInGameSortIndex(rows[1]), 1);
  assert.equal(rows[1].biqIndex, 2, 'pending order must not rewrite the saved BIQ index before save reconciliation');
  assert.deepEqual(normalizeUnitPrimaryReorderOrder(['2', 0, 'bad', 1.5, 1]), [2, 0, 1]);
});

test('unit reorder drag auto-scroll accelerates near list edges', () => {
  const { getUnitReorderAutoScrollSpeed } = loadSortHelpers();

  assert.equal(getUnitReorderAutoScrollSpeed(220, 100, 500), 0);
  assert.equal(getUnitReorderAutoScrollSpeed(102, 100, 500, { threshold: 50, maxSpeed: 20 }), -19);
  assert.equal(getUnitReorderAutoScrollSpeed(498, 100, 500, { threshold: 50, maxSpeed: 20 }), 19);
  assert.equal(getUnitReorderAutoScrollSpeed(50, 100, 500, { threshold: 50, maxSpeed: 20 }), -20);
  assert.equal(getUnitReorderAutoScrollSpeed(550, 100, 500, { threshold: 50, maxSpeed: 20 }), 20);
});

test('unit reorder recordOps keep reference tab dirty count and Undo All state alive', () => {
  const {
    rendererText,
    summarizeUnitReorderOrderForLog,
    normalizeUnitReorderMovedIndexes,
    getReferenceTabUnitReorderMovedIndexes,
    hasReferenceEntryStructuralDirtyState,
    getReferenceRecordOpDirtyCount,
    combineReferenceDirtyCountWithRecordOps
  } = loadSortHelpers();

  const reorderTab = { recordOps: [{ op: 'reorder', sectionCode: 'PRTO', order: [0, 2, 1], movedIndexes: [12, '14', null, -1] }] };
  assert.deepEqual(normalizeUnitReorderMovedIndexes([12, '14', null, '', -1, 'bad', 0]), [12, 14, 0]);
  assert.equal(
    summarizeUnitReorderOrderForLog([0, 2, 1, 3], 2),
    'count:4;head:0,2;tail:1,3;checksum:189'
  );
  assert.deepEqual(Array.from(getReferenceTabUnitReorderMovedIndexes(reorderTab)), [12, 14]);
  assert.equal(hasReferenceEntryStructuralDirtyState('units', { biqIndex: 12, pendingBiqIndex: 14 }, { tab: reorderTab }), true);
  assert.equal(hasReferenceEntryStructuralDirtyState('units', { biqIndex: 13, pendingBiqIndex: 14 }, { tab: reorderTab }), false);
  assert.equal(hasReferenceEntryStructuralDirtyState('units', { biqIndex: 12, pendingBiqIndex: 12 }, { tab: reorderTab }), false);
  assert.equal(hasReferenceEntryStructuralDirtyState('technologies', { biqIndex: 12, pendingBiqIndex: 14 }, { tab: reorderTab }), false);
  assert.equal(hasReferenceEntryStructuralDirtyState('units', { biqIndex: null, pendingBiqIndex: 14 }, { tab: reorderTab }), false);
  assert.equal(hasReferenceEntryStructuralDirtyState('units', { biqIndex: 12, pendingBiqIndex: 14 }), false);
  assert.equal(getReferenceRecordOpDirtyCount(null), 0);
  assert.equal(getReferenceRecordOpDirtyCount({ recordOps: [] }), 0);
  assert.equal(getReferenceRecordOpDirtyCount({ recordOps: [{ op: 'reorder' }] }), 1);
  assert.equal(combineReferenceDirtyCountWithRecordOps(0, { recordOps: [{ op: 'reorder' }] }), 1);
  assert.equal(combineReferenceDirtyCountWithRecordOps(3, { recordOps: [{ op: 'reorder' }] }), 3);
  assert.equal(combineReferenceDirtyCountWithRecordOps(0, { recordOps: [] }), 0);

  assert.match(
    extractFunctionSource(rendererText, 'computeTabDirtyCount'),
    /isReferenceEntryDirtyForCache\(tabKey,\s*entry,[\s\S]*?\{\s*tab:\s*currentTab\s*\}[\s\S]*?combineReferenceDirtyCountWithRecordOps\(changed,\s*currentTab\)/,
    'full tab dirty-count recompute must count individual unit rows whose planned BIQ indices changed'
  );
  assert.match(
    extractFunctionSource(rendererText, 'rebuildDirtyTabCounts'),
    /isReferenceEntryDirtyForCache\(tabKey,\s*entry,[\s\S]*?\{\s*tab\s*\}[\s\S]*?combineReferenceDirtyCountWithRecordOps\(set\.size \+ extra,\s*tab\)/,
    'Undo All preflight recompute must not erase individual unit reorder row badges'
  );
  assert.match(
    extractFunctionSource(rendererText, 'rebuildReferenceDirtyCacheForTab'),
    /isReferenceEntryDirtyForCache\(normalizedTabKey,\s*entry,[\s\S]*?combineReferenceDirtyCountWithRecordOps\(set\.size \+ extra,\s*tab\)/,
    'reference-list dirty cache rebuild must preserve individual unit reorder row badges'
  );
  assert.match(
    extractFunctionSource(rendererText, 'updateActiveDirtyCaches'),
    /isReferenceEntryDirtyForCache\(tabKey,\s*entry,[\s\S]*?combineReferenceDirtyCountWithRecordOps\(set\.size \+ extra,\s*tab\)/,
    'active reference dirty cache refresh must preserve individual unit reorder row badges'
  );
  assert.match(
    extractFunctionSource(rendererText, 'refreshActiveReferenceListDirtyBadges'),
    /isReferenceEntryDirtyForCache\(tabKey,\s*entry,\s*cleanEntry,\s*item && item\.idx,\s*\{\s*tab\s*\}\)/,
    'active list row badges must treat planned unit BIQ index moves as dirty'
  );
  assert.match(
    extractFunctionSource(rendererText, 'rebuildUnitTableDirtyCache'),
    /isReferenceEntryDirtyForCache\(tabKey,\s*entry,\s*cleanEntry,\s*idx,\s*\{\s*tab:\s*resolvedTab\s*\}\)/,
    'Unit Table dirty cache must count individual unit rows whose planned BIQ indices changed'
  );
  assert.match(
    rendererText,
    /const syncUnitTableDirtyCount = \(\) => \{[\s\S]*?combineReferenceDirtyCountWithRecordOps\(dirtySet\.size,\s*tab\)/,
    'Unit Table dirty sync must preserve pure unit recordOps changes'
  );
  assert.match(
    rendererText,
    /const hasReorder = applyPendingUnitReorderOrder\(nextOrder,\s*\{\s*movedSavedIndex:\s*sourceSavedIndex\s*\}\)/,
    'unit drag drops must mark the source saved index as the intentionally moved dirty row'
  );
  assert.match(
    rendererText,
    /logUnitReorder\('dragstart'[\s\S]*?logUnitReorder\('dragover-target'[\s\S]*?logUnitReorder\('drop'[\s\S]*?logUnitReorder\('drop-applied'[\s\S]*?orderSummary:\s*summarizeUnitReorderOrderForLog\(nextOrder\)/,
    'unit reorder drag/drop should keep diagnostic logging around source, target, and applied order summary'
  );
  assert.match(
    rendererText,
    /logUnitReorder\('pane-drop-no-row-handler'/,
    'unit reorder should log when a drop reaches the list pane without a row drop handler'
  );
  assert.match(
    rendererText,
    /movedIndexes:\s*movedIndexList/,
    'unit reorder ops must preserve the intentionally moved indexes for UI dirty badges'
  );

  const biqSectionsText = fs.readFileSync(path.join(__dirname, '..', 'src', 'biq', 'biqSections.js'), 'utf8');
  assert.match(
    biqSectionsText,
    /BiqReferenceNormalize'[\s\S]*?PRTO reorder remap[\s\S]*?affectedReferenceFields=\$\{summarizePrtoReferenceRemapTouchesForLog\(parsed,\s*prtoRemap\)\}/,
    'BIQ save should log which downstream unit-reference field families are affected by a PRTO reorder'
  );
  assert.match(
    biqSectionsText,
    /BiqApplyEdits'[\s\S]*?op=reorder PRTO plan[\s\S]*?childOtherStrategyRemaps=\$\{childOtherStrategyRemaps\}\/\$\{children\.length\}/,
    'BIQ save should log hidden PRTO AI-strategy child-row remaps during unit reorder'
  );
});

test('unit reorder Undo uses a targeted fast snapshot instead of full Units-tab restore', () => {
  const { rendererText } = loadSortHelpers();

  assert.match(
    rendererText,
    /rememberUndoSnapshotForKey\('UNIT_REORDER:units'\)/,
    'unit drag drops should snapshot only unit reorder state'
  );
  assert.doesNotMatch(
    rendererText,
    /rememberUndoSnapshotForKey\('REFERENCE_TAB:units'\);[\s\S]{0,220}const hasReorder = applyPendingUnitReorderOrder\(nextOrder/,
    'unit drag drops should not use the full Units tab undo snapshot'
  );
  assert.match(
    extractFunctionSource(rendererText, 'getUndoSnapshotForKey'),
    /normalizedKey === 'UNIT_REORDER' \|\| normalizedKey === 'UNIT_REORDER:UNITS'[\s\S]*?return buildUnitReorderUndoSnapshot\(\);/,
    'unit reorder undo key should build the targeted unit-reorder snapshot'
  );
  assert.match(
    extractFunctionSource(rendererText, 'restoreEditableSnapshot'),
    /const isUnitReorderSnapshot = !!\([\s\S]*?targetSnapshot\.kind === 'unit-reorder'[\s\S]*?\);[\s\S]*?&& !isUnitReorderSnapshot[\s\S]*?loadBundleAndRender/,
    'unit reorder undo snapshots should bypass the scenario reload slow path'
  );
  assert.match(
    extractFunctionSource(rendererText, 'applyEditableSnapshotToCurrentBundle'),
    /const isUnitReorderSnapshot = !!\([\s\S]*?targetSnapshot\.kind === 'unit-reorder'[\s\S]*?\);[\s\S]*?applyUnitReorderUndoSnapshotToTabs\(mergedTabs,\s*targetSnapshot\)/,
    'unit reorder undo snapshots should apply in memory'
  );
  assert.match(
    extractFunctionSource(rendererText, 'applyUnitReorderUndoSnapshotToTabs'),
    /recordOpsJson[\s\S]*?pendingRowsJson[\s\S]*?delete entry\.pendingBiqIndex[\s\S]*?state\.referenceSelection\[tabKey\]/,
    'unit reorder undo restore should cover recordOps, pending row indices, and selection'
  );
});

test('unit BIQ index badge text uses plain primary and hidden strategy row numbers', () => {
  const {
    normalizeUnitBiqIndexBadgeNumber,
    buildUnitBiqIndexBadgeText,
    getUnitAiStrategyLabelsForBadge,
    buildUnitBiqIndexBadgeTitle,
    getUnitAiStrategyBitCountFromMask
  } = loadSortHelpers();

  assert.equal(normalizeUnitBiqIndexBadgeNumber(null), null);
  assert.equal(normalizeUnitBiqIndexBadgeNumber(''), null);
  assert.equal(normalizeUnitBiqIndexBadgeNumber('0'), 0);
  assert.equal(buildUnitBiqIndexBadgeText({ biqIndex: 64, prtoStrategyRowIndexes: [155, '156', null, '', -1] }), '64 (155, 156)');
  assert.equal(buildUnitBiqIndexBadgeText({ biqIndex: 64 }, { primaryIndex: 62, strategyRows: [170] }), '62 (170)');
  assert.equal(buildUnitBiqIndexBadgeText({ biqIndex: 64, prtoStrategyRowIndexes: [] }), '64');
  assert.equal(buildUnitBiqIndexBadgeText({ biqIndex: null, prtoStrategyRowIndexes: [155] }), '');
  assert.doesNotMatch(buildUnitBiqIndexBadgeText({ biqIndex: 64, prtoStrategyRowIndexes: [155] }), /[#＋+]/);
  const strategyEntry = {
    biqIndex: 64,
    biqFields: [{ baseKey: 'aistrategy', value: String((1 << 0) | (1 << 2) | (1 << 7)) }]
  };
  assert.deepEqual(Array.from(getUnitAiStrategyLabelsForBadge(strategyEntry)), ['Attack', 'Bombard', 'Air Defense']);
  assert.match(
    buildUnitBiqIndexBadgeTitle(strategyEntry, { primaryIndex: 62, strategyRows: [170, 171] }),
    /Primary Index: 62\nPrimary AI strategy: Attack\nAI strategy rows: 170 Bombard, 171 Air Defense\nSaved PRTO index: 64/
  );
  assert.equal(getUnitAiStrategyBitCountFromMask(0), 0);
  assert.equal(getUnitAiStrategyBitCountFromMask(0b1), 1);
  assert.equal(getUnitAiStrategyBitCountFromMask(0b10000001), 2);
});

test('File Settings Units can toggle Unit BIQ index badges without reloading', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const mainText = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const configCoreText = fs.readFileSync(path.join(__dirname, '..', 'src', 'configCore.js'), 'utf8');
  const stylesText = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

  assert.match(mainText, /label:\s*'Show Unit BIQ Indices'/);
  assert.match(mainText, /label:\s*'Show Unit BIQ Index Details on Hover'/);
  assert.match(mainText, /sendShowUnitBiqIndicesSelection\(item && item\.checked\)/);
  assert.match(mainText, /sendShowUnitBiqIndexTooltipsSelection\(item && item\.checked\)/);
  assert.match(mainText, /showUnitBiqIndices:\s*false/);
  assert.match(mainText, /showUnitBiqIndexTooltips:\s*true/);
  assert.match(mainText, /manager:unit-settings-selected'[\s\S]*showUnitBiqIndices:\s*currentShowUnitBiqIndices/);
  assert.match(mainText, /manager:unit-settings-selected'[\s\S]*showUnitBiqIndexTooltips:\s*currentShowUnitBiqIndexTooltips/);

  assert.match(rendererText, /state\.settings\.showUnitBiqIndices = settings\.showUnitBiqIndices === true/);
  assert.match(rendererText, /state\.settings\.showUnitBiqIndexTooltips = settings\.showUnitBiqIndexTooltips !== false/);
  assert.match(rendererText, /state\.activeTab === 'units'[\s\S]*renderActiveTab\(\{ preserveTabScroll: true \}\)/);
  assert.match(rendererText, /buildUnitBiqIndexBadgeText\(entry/);
  assert.match(rendererText, /attachRichTooltip\(itemBtn,\s*\(\) => itemBtn\.dataset\.unitBiqIndexTooltip \|\| ''\)/);
  assert.match(rendererText, /biqIndexBadge\.removeAttribute\('title'\)/);
  assert.match(rendererText, /const showTooltip = state\.settings && state\.settings\.showUnitBiqIndexTooltips !== false/);
  assert.match(rendererText, /itemBtn\.dataset\.unitBiqIndexTooltip = buildUnitBiqIndexBadgeTitle\(entry,\s*plannedRows\)/);
  assert.match(rendererText, /buildUnitBiqIndexBadgeRowsByIdentity/);
  assert.match(rendererText, /getUnitAiStrategyMaskForBadge/);
  assert.match(rendererText, /onFieldValueChange: refreshUnitBiqIndexBadges/);
  assert.match(configCoreText, /const prtoStrategyRowIndexes = duplicates/);
  assert.match(configCoreText, /prtoStrategyRowIndexes: tabSpec\.key === 'units'/);
  assert.match(stylesText, /\.entry-list-biq-index\s*\{[\s\S]*position:\s*absolute;[\s\S]*bottom:\s*5px;/);
  assert.match(stylesText, /\.entry-list-item\.help-hover-target\s*\{[\s\S]*?padding:\s*7px 8px;[\s\S]*?border-radius:\s*10px;/);
  assert.match(stylesText, /\.entry-list-item\.unit-reorder-draggable\.help-hover-target,[\s\S]*?cursor:\s*grab;/);
  assert.match(stylesText, /\.entry-list-item\.unit-reorder-dragging\.help-hover-target,[\s\S]*?cursor:\s*grabbing;/);
  assert.doesNotMatch(stylesText, /entry-list-item-has-biq-index[\s\S]{0,160}grid-template-columns/);
});

test('File Settings Units can disable unit reordering and remove drag affordances', () => {
  const rendererText = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const mainText = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(mainText, /function normalizeEnableUnitReordering\(value\) \{[\s\S]*?return value !== false;/);
  assert.match(mainText, /enableUnitReordering:\s*true/);
  assert.match(mainText, /const startupEnableUnitReordering = readStartupEnableUnitReordering\(\);/);
  assert.match(mainText, /label:\s*'Enable Unit Reordering'[\s\S]*?checked:\s*currentEnableUnitReordering[\s\S]*?sendEnableUnitReorderingSelection\(item && item\.checked\)/);
  assert.match(mainText, /manager:unit-settings-selected'[\s\S]*enableUnitReordering:\s*currentEnableUnitReordering/);
  assert.match(mainText, /enableUnitReordering:\s*normalizeEnableUnitReordering\(settings && settings\.enableUnitReordering\)/);

  assert.match(rendererText, /if \(typeof state\.settings\.enableUnitReordering !== 'boolean'\) \{[\s\S]*?state\.settings\.enableUnitReordering = true;/);
  assert.match(rendererText, /if \(state\.settings && state\.settings\.enableUnitReordering === false\) return 'Unit reordering is disabled in File > Settings > Units\.';/);
  assert.match(rendererText, /if \(Object\.prototype\.hasOwnProperty\.call\(settings, 'enableUnitReordering'\)\) \{[\s\S]*?state\.settings\.enableUnitReordering = settings\.enableUnitReordering !== false;[\s\S]*?renderActiveTab\(\{ preserveTabScroll: true \}\)/);
  assert.match(rendererText, /const canDragUnit = !reorderDisabledReason && isUnitReorderableEntry\(entry\);[\s\S]*?if \(canDragUnit\) \{[\s\S]*?itemBtn\.draggable = true;[\s\S]*?itemBtn\.classList\.add\('unit-reorder-draggable'\)/);
  assert.match(rendererText, /else if \(reorderDisabledReason && isUnitReorderableEntry\(entry\) && !itemBtn\.title\) \{[\s\S]*?itemBtn\.title = reorderDisabledReason;/);
});

test('unit reorder drag preview copies painted canvas pixels into cloned row', () => {
  const { copyCanvasPixelsToClone } = loadSortHelpers();
  let copiedImage = null;
  let cleared = null;
  const sourceCanvas = { width: 28, height: 28 };
  const cloneCanvas = {
    width: 1,
    height: 1,
    getContext() {
      return {
        clearRect(x, y, w, h) { cleared = [x, y, w, h]; },
        drawImage(canvas, x, y) { copiedImage = [canvas, x, y]; }
      };
    }
  };
  const sourceNode = { querySelectorAll: () => [sourceCanvas] };
  const cloneNode = { querySelectorAll: () => [cloneCanvas] };

  assert.equal(copyCanvasPixelsToClone(sourceNode, cloneNode), 1);
  assert.deepEqual(cleared, [0, 0, 28, 28]);
  assert.deepEqual(copiedImage, [sourceCanvas, 0, 0]);
  assert.equal(cloneCanvas.width, 28);
  assert.equal(cloneCanvas.height, 28);
});
