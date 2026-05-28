const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('base field renderers do not mutate rows during initial render', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.doesNotMatch(
    text,
    /rerender\(\);\s*recalc\(\);\s*return wrap;/,
    'limit_units_per_tile renderer should not call recalc during initial render'
  );

  assert.doesNotMatch(
    text,
    /onChange\(serializeBuildingPrereqItems\(items\)\);\s*rerender\(\);\s*return wrap;/,
    'building_prereqs_for_units renderer should not normalize row.value during initial render'
  );

  assert.doesNotMatch(
    text,
    /onChange\(serializeBuildingResourceItems\(items\)\);\s*rerender\(\);\s*return wrap;/,
    'buildings_generating_resources renderer should not normalize row.value during initial render'
  );
});

test('building prereq parser preserves quoted multi-word unit names', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const snippetMatch = text.match(/function parseBuildingPrereqItems\(value\) \{[\s\S]*?\n\}/);

  assert.ok(snippetMatch, 'parseBuildingPrereqItems should exist');
  const snippet = snippetMatch[0];

  assert.match(
    snippet,
    /const units = parseBracketedOptionTokens\(item\.slice\(i \+ 1\)\);/,
    'building_prereqs_for_units should parse unit lists with quote-aware tokenization'
  );

  assert.doesNotMatch(
    snippet,
    /replace\(\/\\s\+\/g, ','\)/,
    'building_prereqs_for_units should not rewrite spaces into commas before tokenization'
  );
});

test('C3X name/value parsers keep single colon entries intact', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function parseDelimitedStructuredEntries\(value\)/,
    'Renderer should provide a delimiter-only parser for C3X colon entry lists'
  );

  assert.match(
    text,
    /function parseNameAmountItems\(value\) \{[\s\S]*?return parseDelimitedStructuredEntries\(value\)\.map/,
    'name/amount C3X fields should not split a single ["Name": amount] entry on whitespace'
  );

  assert.match(
    text,
    /function parseBuildingPrereqItems\(value\) \{[\s\S]*?return parseDelimitedStructuredEntries\(value\)\.map/,
    'building_prereqs_for_units should not split a single ["Building": "Unit"] entry on whitespace'
  );

  assert.match(
    text,
    /function parseBuildingResourceItems\(value\) \{[\s\S]*?return parseDelimitedStructuredEntries\(value\)\.map/,
    'buildings_generating_resources should not split a single ["Building": flags "Resource"] entry on whitespace'
  );
});

test('tech era dropdown uses BIQ era names when available', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /makeBiqSectionIndexOptions\('ERAS', false\)/,
    'Tech reference resolver should read era labels from the ERAS section'
  );

  assert.match(
    text,
    /if \(eraOptions\.length > 0\) return eraOptions;/,
    'Tech reference resolver should prefer BIQ era labels before falling back'
  );
});

test('civilization playable toggle is read-only for barbarians', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function isBarbarianCivilizationEntry\(entry\)/,
    'Renderer should expose a barbarian-civilization guard for the Civs playable toggle'
  );

  assert.match(
    text,
    /if \(isBarbarianCivilizationEntry\(entry\)\) return false;/,
    'Playable state writes should refuse barbarian civilization entries'
  );

  assert.match(
    text,
    /const playableReadonly = !referenceEditable \|\| isBarbarianCivilizationEntry\(entry\);/,
    'Playable checkbox should render read-only for barbarian civilization entries'
  );
});

test('map owner picker scopes owner choices by Quint owner type', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const ownerPickerBlock = text.match(/const getMapOwnerPickerOptions = \(ownerTypeRaw = null\) => \{[\s\S]*?\n  \};\n  const getMapOwnerTypeFromPickerValue/);
  assert.ok(ownerPickerBlock, 'Renderer should expose a map owner picker option builder');

  assert.match(
    ownerPickerBlock[0],
    /if \(ownerType === 1\) \{[\s\S]*?return barbarianOption \? \[barbarianOption\] : \[\];[\s\S]*?\}/,
    'Direct barbarian ownership should use only the direct barbarian option'
  );
  assert.match(
    ownerPickerBlock[0],
    /if \(ownerType === 3\) \{[\s\S]*?return leadRecordsForOwner\.map/,
    'Player-owned map options should be sourced from LEAD player records'
  );
  assert.match(
    ownerPickerBlock[0],
    /if \(ownerType === 2 \|\| !Number\.isFinite\(ownerType\)\) \{[\s\S]*?return civilizationEntriesForOwner[\s\S]*?\.filter\(\(\{ entry, civIndex \}\) => civIndex !== 0 && !isBarbarianCivilizationEntry\(entry\)\)[\s\S]*?\.map/,
    'Civilization-owned map options should be sourced from non-barbarian RACE civilization records'
  );
  assert.doesNotMatch(
    ownerPickerBlock[0],
    /options\.push/,
    'Owner pickers must return a single owner-type model rather than accumulating a unioned list'
  );
  assert.match(
    text,
    /const getDefaultMapOwnerPickerValueForType = \(ownerTypeRaw\) => \{[\s\S]*?if \(ownerType === 2\) \{[\s\S]*?const firstNonBarbarian = options\.find/,
    'Switching to Civilization ownership should default to the first non-barbarian civ like Quint'
  );
});

test('map owner picker keeps direct barbarians separate from civilization assignment', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const ownerPickerBlock = text.match(/const getMapOwnerPickerOptions = \(ownerTypeRaw = null\) => \{[\s\S]*?\n  \};\n  const getMapOwnerTypeFromPickerValue/);
  const pickerValueBlock = text.match(/const getMapOwnerPickerValueFromOwnership = \(ownerTypeRaw, ownerRaw\) => \{[\s\S]*?\n  \};\n  const getMapUnitOwnerOptions/);
  assert.ok(ownerPickerBlock, 'Renderer should expose map owner picker option building');
  assert.ok(pickerValueBlock, 'Renderer should expose map ownership-to-picker value resolution');

  assert.match(
    ownerPickerBlock[0],
    /\.filter\(\(\{ entry, civIndex \}\) => civIndex !== 0 && !isBarbarianCivilizationEntry\(entry\)\)/,
    'Civilization assignment owner lists should not include RACE 0 barbarians'
  );
  assert.match(
    pickerValueBlock[0],
    /if \(ownerType === 1\) return getBarbarianCivilizationPickerEntry\(\) \? BARBARIAN_OWNER_PICKER_VALUE : '';/,
    'Direct barbarian ownership should use the direct barbarian picker value'
  );
  assert.match(
    pickerValueBlock[0],
    /if \(ownerType === 2\) \{[\s\S]*?return mapOwnerPickerValueForCivilization\(civId\);[\s\S]*?\}/,
    'Civilization-owned records should resolve to civ:n picker values'
  );
  assert.doesNotMatch(
    pickerValueBlock[0],
    /ownerType === 2[\s\S]*?matchingPlayer/,
    'Civilization-owned records must not be converted to a matching player owner in the picker'
  );
});

test('map city and unit Tile Info owner editors switch owner list by owner type', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const addCityOwnerTypePicker = \(\) => \{[\s\S]*?row\.className = 'map-city-field map-city-field-wide';[\s\S]*?text\.textContent = 'Assignment';[\s\S]*?\{ value: '1', label: 'Barbarians' \},[\s\S]*?\{ value: '2', label: 'Civilization' \},[\s\S]*?\{ value: '3', label: 'Player' \}[\s\S]*?getDefaultMapOwnerPickerValueForType\(select\.value\)[\s\S]*?applyCityOwnerSelection\(value, \{ source: 'city-owner-type', refreshTileInfo: true \}\)/,
    'City Tile Info should expose a Quint-style owner-type control that swaps to the matching owner list'
  );
  assert.match(
    text,
    /const addCityOwnerPicker = \(\) => \{[\s\S]*?const ownerType = getCityOwnerType\(\);[\s\S]*?if \(ownerType === 1\) return;[\s\S]*?const options = getMapOwnerPickerOptions\(ownerType\);/,
    'City owner picker should hide direct Barbarians and request only the owner list for the current city owner type'
  );
  assert.match(
    text,
    /ownerTypeRow\.className = 'map-city-field map-city-field-wide';[\s\S]*?const ownerTypeSelect = document\.createElement\('select'\);[\s\S]*?\{ value: '1', label: 'Barbarians' \},[\s\S]*?\{ value: '2', label: 'Civilization' \},[\s\S]*?\{ value: '3', label: 'Player' \}[\s\S]*?activeOwnerType = parseOwnerType\(ownerTypeSelect\.value\);[\s\S]*?applyUnitOwnerSelection\(value, \{ action: 'owner-type-change', refreshTileInfo: true \}\)/,
    'Unit Tile Info should expose a Quint-style owner-type control that swaps to the matching owner list'
  );
  assert.match(
    text,
    /const ownerOptions = getMapUnitOwnerOptions\(activeOwnerType\);/,
    'Unit owner picker should request only the owner list for the current unit owner type'
  );
  assert.match(
    text,
    /if \(ownerOptions\.length > 0 && activeOwnerType !== 1\)/,
    'Unit owner picker should hide the owner dropdown for direct Barbarians like Quint'
  );
  assert.match(
    text,
    /const applyCityOwnerSelection = \(value, options = \{\}\) => \{[\s\S]*?if \(options && options\.refreshTileInfo\) scheduleTileInfoRender\(0\);/,
    'City assignment changes should refresh Tile Info without rebuilding the whole map modal'
  );
  assert.match(
    text,
    /const applyUnitOwnerSelection = \(value, options = \{\}\) => \{[\s\S]*?if \(options && options\.refreshTileInfo\) scheduleTileInfoRender\(0\);/,
    'Unit assignment changes should refresh Tile Info without rebuilding the whole map modal'
  );
});

test('map owner-support refresh includes Civs, Players, and custom player data', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const supportBlock = text.match(/function isMapOwnerSupportReferenceField\(tabKey, baseKey\) \{[\s\S]*?\n\}/);
  assert.ok(supportBlock, 'Renderer should expose map owner-support invalidation');

  assert.match(supportBlock[0], /tab === 'civilizations'/, 'Civ edits should invalidate map owner rendering');
  assert.match(supportBlock[0], /tab === 'players'\) return true;/, 'Player edits should invalidate map owner rendering');
  assert.match(supportBlock[0], /tab === 'scenariosettings'/, 'Scenario custom-player-data edits should invalidate map owner rendering');
  assert.match(text, /refreshMapAfterOwnerSupportChange\('players', 'records'\)/, 'Player add/delete and count sync should refresh open Map views');
  assert.match(text, /refreshMapAfterOwnerSupportChange\('scenarioSettings', 'customPlayerData'\)/, 'Custom player data toggles should refresh open Map views');
});

test('C3X bitfield base settings serialize with whitespace-separated bracket lists', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function serializeWhitespaceStructuredEntries\(entries\) \{[\s\S]*?cleaned\.join\(' '\)/,
    'Renderer should provide a whitespace-delimited structured serializer for C3X bitfield fields'
  );

  assert.match(
    text,
    /if \(BASE_MULTI_CHOICE_LIST_OPTIONS\[row\.key\]\) \{[\s\S]*?onChange\(serializeWhitespaceStructuredEntries\(ordered\)\);[\s\S]*?\}/,
    'C3X multi-choice bitfield controls should write whitespace-delimited bracket lists'
  );

  assert.doesNotMatch(
    text,
    /if \(BASE_MULTI_CHOICE_LIST_OPTIONS\[row\.key\]\) \{[\s\S]*?onChange\(serializeStructuredEntries\(ordered\)\);[\s\S]*?\}/,
    'C3X multi-choice bitfield controls must not write comma-delimited lists'
  );
});

test('C3X quoted reference-list settings serialize with whitespace-separated quoted bracket lists', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function serializeQuotedWhitespaceStructuredEntries\(entries\) \{[\s\S]*?cleaned\.join\(' '\)/,
    'Renderer should provide a whitespace-delimited quoted serializer for unit/improvement reference lists'
  );

  assert.match(
    text,
    /if \(BASE_REFERENCE_LIST_TAB_BY_KEY\[row\.key\]\) \{[\s\S]*?onValuesChange: \(values\) => onChange\(serializeQuotedWhitespaceStructuredEntries\(values\)\)[\s\S]*?\}/,
    'C3X reference-list controls should write whitespace-delimited quoted bracket lists'
  );

  assert.doesNotMatch(
    text,
    /if \(BASE_REFERENCE_LIST_TAB_BY_KEY\[row\.key\]\) \{[\s\S]*?onValuesChange: \(values\) => onChange\(serializeQuotedStructuredEntries\(values\)\)[\s\S]*?\}/,
    'C3X reference-list controls must not write comma-delimited quoted lists'
  );
});

test('C3X special zone of control options match injected_code source tokens', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /special_zone_of_control_rules:\s*\['amphibious', 'lethal', 'aerial', 'not-from-inside', 'all'\]/,
    'ZoC option list should expose only the C3X-supported tokens plus all'
  );

  assert.doesNotMatch(
    text,
    /special_zone_of_control_rules:\s*\[[^\]]*no-city-no-defense[^\]]*\]/,
    'ZoC option list must not advertise unsupported no-city-no-defense'
  );
});

test('C3X retreat-rule options match injected_code source tokens', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const manifestPath = path.join(__dirname, '..', 'src', 'c3xBaseManifest.js');
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  const manifestText = fs.readFileSync(manifestPath, 'utf8');

  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expected = "['standard', 'none', 'all-units', 'if-faster', 'if-not-slower', 'if-fast-and-not-slower']";
  assert.match(
    rendererText,
    new RegExp(`land_retreat_rules:\\s*${escapeRegex(expected)}`),
    'Renderer should expose all C3X-supported land retreat rule options'
  );
  assert.match(
    rendererText,
    new RegExp(`sea_retreat_rules:\\s*${escapeRegex(expected)}`),
    'Renderer should expose all C3X-supported sea retreat rule options'
  );
  assert.match(
    manifestText,
    new RegExp(`land_retreat_rules:\\s*Object\\.freeze\\(${escapeRegex(expected)}\\)`),
    'Manifest should track the full land retreat rule enum'
  );
  assert.match(
    manifestText,
    new RegExp(`sea_retreat_rules:\\s*Object\\.freeze\\(${escapeRegex(expected)}\\)`),
    'Manifest should track the full sea retreat rule enum'
  );
});

test('C3X source-backed enum readers match renderer and manifest options', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const manifestPath = path.join(__dirname, '..', 'src', 'c3xBaseManifest.js');
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const sourceEnumOptions = {
    draw_lines_using_gdi_plus: ['never', 'wine', 'always'],
    double_minimap_size: ['never', 'high-def', 'always'],
    unit_cycle_search_criteria: ['standard', 'similar-near-start', 'similar-near-destination'],
    work_area_limit: ['none', 'cultural', 'cultural-min-2', 'cultural-or-adjacent'],
    day_night_cycle_mode: ['off', 'timer', 'user-time', 'every-turn', 'specified'],
    override_no_ai_patrol: ['none', 'one', 'zero'],
    override_barbarian_activity_level_for_scenario_maps: ['none', 'No Barbarians', 'Sedentary', 'Roaming', 'Restless', 'Raging', 'Random'],
    distribution_hub_yield_division_mode: ['flat', 'scale-by-city-count'],
    ai_distribution_hub_build_strategy: ['auto', 'by-city-count'],
    ai_auto_build_great_wall_strategy: ['all-borders', 'other-civ-bordered-only'],
    land_retreat_rules: ['standard', 'none', 'all-units', 'if-faster', 'if-not-slower', 'if-fast-and-not-slower'],
    sea_retreat_rules: ['standard', 'none', 'all-units', 'if-faster', 'if-not-slower', 'if-fast-and-not-slower']
  };

  Object.entries(sourceEnumOptions).forEach(([key, options]) => {
    const arrayLiteral = `[${options.map((opt) => `'${opt}'`).join(', ')}]`;
    assert.match(
      rendererText,
      new RegExp(`${escapeRegex(key)}:\\s*${escapeRegex(arrayLiteral)}`),
      `Renderer options for ${key} should match injected_code.c`
    );
    assert.match(
      manifestText,
      new RegExp(`${escapeRegex(key)}:\\s*Object\\.freeze\\(${escapeRegex(arrayLiteral)}\\)`),
      `Manifest options for ${key} should match injected_code.c`
    );
  });
});

test('C3X can_bombard_only_sea_tiles uses the shared quoted unit-list wiring', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const manifestPath = path.join(__dirname, '..', 'src', 'c3xBaseManifest.js');
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  const manifestText = fs.readFileSync(manifestPath, 'utf8');

  assert.match(
    rendererText,
    /can_bombard_only_sea_tiles:\s*'units'/,
    'Renderer should map can_bombard_only_sea_tiles to the units reference-list picker'
  );
  assert.match(
    manifestText,
    /can_bombard_only_sea_tiles:\s*'quoted_reference_list'/,
    'Manifest should classify can_bombard_only_sea_tiles as a quoted reference list'
  );
  assert.match(
    manifestText,
    /can_bombard_only_sea_tiles:\s*Object\.freeze\(\{ tab: 'units' \}\)/,
    'Manifest should bind can_bombard_only_sea_tiles to unit references'
  );
});

test('C3X base typing uses grouped undo sessions instead of per-keystroke snapshots', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function makeInputForBaseRow\(row, onChange, options = \{\}\) \{[\s\S]*?wireGroupedUndoSession\(input, \{[\s\S]*?key: baseUndoKey,/,
    'Base-row inputs should use grouped undo wiring keyed per C3X setting'
  );

  assert.match(
    text,
    /const input = document\.createElement\('input'\);[\s\S]*?wireBaseGroupedUndo\(input\);[\s\S]*?input\.addEventListener\('input', \(\) => onChange\(input\.value, \{ captureUndo: false \}\)\);/,
    'Plain base text/number inputs should avoid capturing a full undo snapshot on every keystroke'
  );

  assert.match(
    text,
    /const input = makeInputForBaseRow\(row, \(newValue, changeOptions = null\) => \{[\s\S]*?if \(!changeOptions \|\| changeOptions\.captureUndo !== false\) \{\s*rememberUndoSnapshotForKey\(`BASE:/m,
    'Base-row change application should still capture undo snapshots for discrete non-grouped actions'
  );
});

test('C3X base undo snapshots are scoped to the base tab and restore supports partial snapshots', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function getUndoSnapshotForKey\(key = ''\) \{[\s\S]*?if \(normalizedKey\.startsWith\('BASE:'\)\) \{\s*return snapshotSelectedEditableTabs\(\{\s*tabKeys: \['base'\],\s*scope: 'base'\s*\}\);/m,
    'Base undo capture should snapshot only the base tab instead of every editable tab'
  );

  assert.match(
    text,
    /if \(normalizedKey\.startsWith\('RULE_FIELD:'\)\) \{[\s\S]*?return snapshotSelectedEditableTabs\(\{\s*tabKeys: \[tabKey\],\s*scope: `tab:\$\{tabKey\}`\s*\}\);[\s\S]*?if \(normalizedKey\.startsWith\('BIQ_FIELD:'\)\) \{[\s\S]*?const tabKey = String\(state\.activeTab \|\| ''\)\.trim\(\)\.toLowerCase\(\);[\s\S]*?return snapshotSelectedEditableTabs\(\{\s*tabKeys: \[tabKey\],\s*scope: `tab:\$\{tabKey\}`\s*\}\);/m,
    'BIQ-backed field edits should capture tab-scoped undo snapshots instead of falling back to full editable-tab snapshots'
  );

  assert.match(
    text,
    /function extractUndoSnapshotTabs\(snapshot\) \{[\s\S]*?snapshot\.kind === 'partial-tabs'[\s\S]*?snapshot\.tabs/,
    'Undo restore should understand partial-tab snapshot entries'
  );

  assert.match(
    text,
    /const restoredSearchFolder = Object\.prototype\.hasOwnProperty\.call\(restoredEditableTabs, 'scenarioSettings'\)[\s\S]*?getScenarioSearchFolderValueFromTabs\(state\.bundle && state\.bundle\.tabs \? state\.bundle\.tabs : \{\}\);/,
    'Partial undo restores should preserve the current scenario search folder when that tab was not part of the snapshot'
  );

  assert.match(
    text,
    /const isScopedBaseSnapshot = isScopedBaseUndoSnapshot\(targetSnapshot\);[\s\S]*?const isSerializedReferenceEntrySnapshot = !!\([\s\S]*?targetSnapshot\.kind === 'serialized-reference-entry'[\s\S]*?\);[\s\S]*?const isSerializedSectionSnapshot = !!\([\s\S]*?targetSnapshot\.kind === 'serialized-section-item'[\s\S]*?\);[\s\S]*?const isScopedSectionTabSnapshot = isScopedSectionTabUndoSnapshot\(targetSnapshot\);[\s\S]*?const isScopedTabSnapshot = isScopedTabUndoSnapshot\(targetSnapshot\);[\s\S]*?if \(\s*!isScopedBaseSnapshot[\s\S]*?!isSerializedReferenceEntrySnapshot[\s\S]*?&& !isSerializedSectionSnapshot[\s\S]*?&& !isScopedSectionTabSnapshot[\s\S]*?&& !isScopedTabSnapshot[\s\S]*?await loadBundleAndRender\(\{/m,
    'Scoped base, entry-scoped reference, section-scoped, and tab-scoped undo should skip the scenario reload path so unrelated in-memory edits are not discarded before the snapshot is applied'
  );
});

test('reference CRUD captures undo before pending BIQ record ops mutate', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const sliceBetween = (source, startNeedle, endNeedle) => {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Expected start marker: ${startNeedle}`);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(end, -1, `Expected end marker: ${endNeedle}`);
    return source.slice(start, end);
  };
  const assertBefore = (source, firstNeedle, secondNeedle, label) => {
    const first = source.indexOf(firstNeedle);
    const second = source.indexOf(secondNeedle);
    assert.ok(first >= 0, `${label}: missing ${firstNeedle}`);
    assert.ok(second >= 0, `${label}: missing ${secondNeedle}`);
    assert.ok(first < second, `${label}: ${firstNeedle} should appear before ${secondNeedle}`);
  };

  const referenceCrud = sliceBetween(
    text,
    "if (referenceEditable && REFERENCE_MUTABLE_ENTITY_TABS.has(tabKey)) {",
    "actionRow.appendChild(addBtn);"
  );
  const addHandler = sliceBetween(
    referenceCrud,
    "addBtn.addEventListener('click', () => {",
    "copyBtn.addEventListener('click', () => {"
  );
  const copyHandler = sliceBetween(
    referenceCrud,
    "copyBtn.addEventListener('click', () => {",
    "importBtn.addEventListener('click', async () => {"
  );
  const importHandler = sliceBetween(
    referenceCrud,
    "importBtn.addEventListener('click', async () => {",
    "});\n\n    deleteBtn.addEventListener('click', async () => {"
  );

  assertBefore(addHandler, 'rememberUndoSnapshot();', 'ops.push({', 'reference add');
  assertBefore(copyHandler, 'rememberUndoSnapshot();', 'ops.push({', 'reference copy');
  assertBefore(importHandler, 'rememberUndoSnapshotForKey(`REFERENCE_TAB:${tabKey}`);', 'tab.diplomacySlots.push({', 'reference import diplomacy');
  assertBefore(importHandler, 'rememberUndoSnapshotForKey(`REFERENCE_TAB:${tabKey}`);', 'ops.push({', 'reference import');
});

test('BIQ reference tab count text uses filtered counts and countable unit rows', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const stylePath = path.join(__dirname, '..', 'src', 'styles.css');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const styles = fs.readFileSync(stylePath, 'utf8');

  assert.match(
    text,
    /function isCountableReferenceEntry\(tabKey, entry\) \{[\s\S]*?!== 'units'[\s\S]*?return !isUnitEraVariantReferenceEntry\(entry\) && !isUnitStrategyMapDuplicateReferenceEntry\(entry\);[\s\S]*?\}/,
    'Units counts should skip synthetic era rows and strategy-map duplicate PRTO records'
  );

  assert.match(
    text,
    /const totalEntryCount = countReferenceEntriesForDisplay\(tabKey, allEntries\);[\s\S]*?const visibleEntryCount = countReferenceEntriesForDisplay\(tabKey, filteredEntries\);[\s\S]*?countText\.textContent = formatReferenceCountText\(tabKey, tab, visibleEntryCount, totalEntryCount\);/,
    'Reference tabs should render total and filtered item counts in the toolbar'
  );

  assert.match(
    text,
    /if \(visibleCount !== totalCount\) return `\$\{visibleCount\} of \$\{totalCount\} total`;[\s\S]*?return `\$\{totalCount\} total`;/,
    'Reference count text should use generic total wording instead of repeating the tab name'
  );

  assert.match(
    styles,
    /\.reference-count-text \{[\s\S]*?font-size: 0\.78rem;[\s\S]*?font-weight: 700;[\s\S]*?white-space: nowrap;[\s\S]*?\}/,
    'Reference count text should match tab-label scale and weight while staying compact'
  );
});

test('long-list C3X base editors avoid full local rerenders on add/remove', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  const sections = [
    {
      start: "if (row.key === 'unit_limits') {",
      end: "if (row.key === 'civ_aliases_by_era') {"
    },
    {
      start: "if (row.key === 'production_perfume' || row.key === 'perfume_specs' || row.key === 'technology_perfume' || row.key === 'resource_perfume' || row.key === 'government_perfume') {",
      end: "if (row.key === 'work_area_improvements') {"
    },
    {
      start: "if (row.key === 'work_area_improvements') {",
      end: "if (row.key === 'great_wall_auto_build_wonder_name') {"
    },
    {
      start: "if (row.key === 'building_prereqs_for_units') {",
      end: "if (row.key === 'buildings_generating_resources') {"
    },
    {
      start: "if (row.key === 'buildings_generating_resources') {",
      end: "if (isStructuredBaseField(row)) {"
    }
  ];

  sections.forEach(({ start, end }) => {
    const startIdx = text.indexOf(start);
    const endIdx = text.indexOf(end);
    assert.ok(startIdx >= 0 && endIdx > startIdx, `Expected renderer section between ${start} and ${end}`);
    const sectionText = text.slice(startIdx, endIdx);
    assert.doesNotMatch(
      sectionText,
      /wrap\.innerHTML\s*=\s*''/,
      'Long-list base editors should update incrementally instead of rebuilding the whole field UI'
    );
  });
});

test('long-list C3X base editors lazily mount offscreen items within mounted rows', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const supportsLazyItemMount = lazyItemMount && typeof window !== 'undefined' && typeof window\.IntersectionObserver === 'function';/,
    'Incremental list editor helper should support lazy per-item mounting'
  );

  assert.match(
    text,
    /const placeholder = document\.createElement\('div'\);[\s\S]*?placeholder\.className = 'structured-list-item-placeholder';[\s\S]*?placeholder\.textContent = 'Loading item\.\.\.';/,
    'Lazy list items should use lightweight placeholders before constructing picker-heavy cards'
  );

  assert.match(
    text,
    /lazyItemMount: true,[\s\S]*?eagerItemCount: 5,[\s\S]*?itemPlaceholderMinHeight: 76,[\s\S]*?if \(row\.key === 'production_perfume'/,
    'Perfume-style long lists should enable lazy per-item mounting'
  );
});

test('C3X base rows lazily mount offscreen editors', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const supportsLazyBaseRowMount = typeof window !== 'undefined' && typeof window\.IntersectionObserver === 'function';/,
    'Base tab should detect IntersectionObserver support for lazy editor mounting'
  );

  assert.match(
    text,
    /const inputPlaceholder = document\.createElement\('div'\);[\s\S]*?inputPlaceholder\.className = 'base-row-input-placeholder';[\s\S]*?inputPlaceholder\.textContent = 'Loading editor\.\.\.';/,
    'Base rows should render a lightweight placeholder before constructing offscreen editors'
  );

  assert.match(
    text,
    /if \(!baseRowLazyObserver \|\| rowElements\.length <= 18\) \{\s*ensureInputMounted\(\);\s*\} else \{\s*baseRowLazyObserver\.observe\(r\);\s*\}/m,
    'Base tab should eagerly mount only the initial visible rows and defer the rest'
  );
});

test('C3X base search debounces filter work instead of running on every keystroke', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /filterInput\.addEventListener\('input', \(\) => \{\s*scheduleTabSearchRender\('base', applyFilter, \{ delayMs: 90 \}\);/m,
    'Base-tab search should debounce row filtering work behind scheduleTabSearchRender'
  );

  assert.doesNotMatch(
    text,
    /filterInput\.addEventListener\('input', applyFilter\);/,
    'Base-tab search should no longer run applyFilter directly on every keystroke'
  );
});

test('improvements top board renderer receives the reference context it uses for undo keys', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function renderImprovementDenseTopBoard\(entry, tabKey, selectedBaseIndex, referenceEditable\)/,
    'Improvements top board should accept tabKey and selectedBaseIndex because its controls build entry-scoped undo keys'
  );

  assert.match(
    text,
    /renderImprovementDenseTopBoard\(entry, tabKey, selectedBaseIndex, referenceEditable\)/,
    'Improvements rules layout should pass the active reference context into the top board renderer'
  );
});

test('reference warning badges include Game Concepts', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /\['civilizations', 'technologies', 'resources', 'governments', 'improvements', 'gameConcepts'\]\.includes\(key\)/,
    'Game Concepts should use the shared reference-tab warning badge path'
  );
});

test('C3X base warning rows expose Next warning navigation', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function getBaseAuditMessagesByKey\(\) \{[\s\S]*?getLoadAuditGeneralEntries\('base'\)[\s\S]*?getBaseKeyFromAuditEntry/,
    'Base tab should map general C3X audit warnings back to row keys'
  );

  assert.match(
    text,
    /const nextWarningBtn = createNextWarningButton\(\);[\s\S]*?filterActions\.appendChild\(nextWarningBtn\);[\s\S]*?const updateBaseNextWarningButton = \(\) =>/,
    'Base tab should render a Next warning control beside the setting filter'
  );

  assert.match(
    text,
    /const warningRows = rowElements\.filter\(\(entry\) => baseWarningKeys\.has\(entry\.key\) && entry\.el\.style\.display !== 'none'\);[\s\S]*?focusBaseRowByKey\(next\.key\);/,
    'Base Next warning should jump to the next visible warned setting row'
  );
});

test('improvements required districts picker wires district dropdown thumbnails', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /renderImprovementRequiredDistrictsControl[\s\S]*createReferencePicker\(\{[\s\S]*renderOptionThumb:\s*\(\{\s*holder,\s*option\s*\}\)\s*=>\s*\{[\s\S]*findDistrictSectionByName\(option\.value\)[\s\S]*loadDistrictRepresentativePreview\(section,\s*holder,\s*14\)[\s\S]*return true;[\s\S]*\}[\s\S]*\}\)/m,
    'Improvements required-district picker should provide the shared district thumbnail renderer so dropdown options do not collapse to empty placeholder boxes'
  );
});

test('editable BIQ reference pickers lazily hydrate improvement thumbnails', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /showOptionThumbs:\s*targetTabKey === 'units' \|\| targetTabKey === 'governments' \|\| targetTabKey === 'improvements'/,
    'Editable BIQ reference pickers should lazily hydrate Improvement option thumbnails for fields like Gain In Every City'
  );
});

test('BIQ reference picker search placeholders use display labels', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const labelText = String\(displayLabel \|\| field\.label \|\| field\.key \|\| 'value'\)\.trim\(\);[\s\S]*?searchPlaceholder: `Search \$\{labelText\}\.\.\.`/,
    'BIQ reference picker search placeholders should use readable display labels instead of raw field keys like gainineverycity'
  );
});
