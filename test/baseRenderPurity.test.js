const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('BIQ Scenario title and description editors enforce fixed header byte limits in UI', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const preloadPath = path.join(__dirname, '..', 'preload.js');
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  const preloadText = fs.readFileSync(preloadPath, 'utf8');

  assert.match(
    preloadText,
    /clipTextToEncodedByteLimit:\s*\(text, maxBytes, encoding\) => ipcRenderer\.sendSync\('manager:clip-text-to-encoded-byte-limit', \{ text, maxBytes, encoding \}\)/,
    'preload should expose byte-accurate text clipping through main-process IPC'
  );
  assert.doesNotMatch(
    preloadText,
    /require\('iconv-lite'\)/,
    'preload should not load iconv-lite directly because preload startup must stay dependency-light'
  );
  assert.match(
    rendererText,
    /const BIQ_HEADER_TEXT_LIMITS = \{\s*title:\s*63,\s*description:\s*639\s*\};/,
    'renderer should use the null-terminated BIQ header payload limits'
  );
  assert.match(
    rendererText,
    /encodedByteLimit:\s*BIQ_HEADER_TEXT_LIMITS\[base\] \|\| 0,[\s\S]*?textEncoding:\s*state\.bundle && state\.bundle\.biqTextEncoding/,
    'Scenario title and description editors should receive the detected BIQ encoding and byte limit'
  );
  assert.match(
    rendererText,
    /input\.addEventListener\('input', \(\) => \{[\s\S]*?clipTextToEncodedByteLimit\(input\.value, maxEncodedBytes, resolvedTextEncoding\)[\s\S]*?onChange\(input\.value\);[\s\S]*?\}\);/,
    'BIQ text editor input should clip before mutating the field value'
  );
});

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

test('Rules Citizens hides dangling BIQ Civilopedia entry field', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /if \(selected\.code === 'CTZN' && baseKeyRaw === 'civilopediaentry'\) return;/,
    'Citizens should not show CTZN_* Civilopedia keys because stock Civ3 has no per-citizen articles'
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

test('Improvement Required By Units is a reverse editor for building_prereqs_for_units', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function getImprovementRequiredByUnitNames\(entry, row = null\) \{[\s\S]*?parseBuildingPrereqItems\(sourceRow\.value\)[\s\S]*?c3xNameMatches\(item && item\.building, buildingName\)/,
    'Improvement Required By Units should find units from entries whose building matches the selected improvement'
  );
  assert.match(
    text,
    /function renderImprovementRequiredByUnitsControl\(entry, c3xEditable\) \{[\s\S]*?targetTabKey: 'units'[\s\S]*?searchPlaceholder: 'Add Unit\.\.\.'[\s\S]*?commitUnits\(\[\.\.\.selectedUnits, normalized\]\)/,
    'Improvement Required By Units should provide an Add Unit picker backed by Units'
  );
  assert.match(
    text,
    /function renderImprovementRequiredByUnitsControl\(entry, c3xEditable\) \{[\s\S]*?withRemoveIcon\(remove, ''\)[\s\S]*?commitUnits\(selectedUnits\.filter/,
    'Improvement Required By Units should remove individual unit prerequisites'
  );
  assert.match(
    text,
    /function renderImprovementRequiredByUnitsControl\(entry, c3xEditable\) \{[\s\S]*?const baseKey = 'building_prereqs_for_units'[\s\S]*?createImprovementC3XTopBoardCell\([\s\S]*?'Required By Units'[\s\S]*?baseKey[\s\S]*?Reverse view of unit building prerequisites/,
    'Improvement Required By Units tooltip should identify the C3X reverse relationship'
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

test('C3X comma-delimited structured entries treat newlines as item whitespace', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function tokenizeCommaDelimitedStructuredEntries\(text\) \{[\s\S]*?if \(ch === ',' && parenDepth === 0\)/,
    'Comma-delimited C3X structured fields should split top-level items only on commas'
  );

  assert.match(
    text,
    /function parseStructuredEntries\(value\) \{[\s\S]*?if \(\/,\/\.test\(v\)\) return tokenizeCommaDelimitedStructuredEntries\(v\);[\s\S]*?return tokenizeWhitespacePreservingQuotes\(v\);/,
    'Generic structured C3X fields should treat newline-only bracket contents as whitespace lists'
  );

  assert.match(
    text,
    /function parseDelimitedStructuredEntries\(value\) \{[\s\S]*?return tokenizeCommaDelimitedStructuredEntries\(v\);/,
    'Name/value C3X fields should not treat line wrapping as a top-level item separator'
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

test('map owner-support refresh includes Civs, Players, Rules, and custom player data', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const supportBlock = text.match(/function isMapOwnerSupportReferenceField\(tabKey, baseKey\) \{[\s\S]*?\n\}/);
  assert.ok(supportBlock, 'Renderer should expose map owner-support invalidation');

  assert.match(supportBlock[0], /tab === 'civilizations'/, 'Civ edits should invalidate map owner rendering');
  assert.match(supportBlock[0], /tab === 'players'\) return true;/, 'Player edits should invalidate map owner rendering');
  assert.match(supportBlock[0], /tab === 'rules'\) return base === 'borderfactor';/, 'Border Factor edits should invalidate map border rendering');
  assert.match(supportBlock[0], /tab === 'scenariosettings'/, 'Scenario custom-player-data edits should invalidate map owner rendering');
  assert.match(text, /refreshMapAfterOwnerSupportChange\('players', 'records'\)/, 'Player add/delete and count sync should refresh open Map views');
  assert.match(text, /refreshMapAfterOwnerSupportChange\('scenarioSettings', 'customPlayerData'\)/, 'Custom player data toggles should refresh open Map views');
});

test('Scenario Players panel mutates LEAD through the players tab like Quint', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const structureOpsTab = selected\.code === 'LEAD' \? selectedSectionTab : tab;[\s\S]*?structureOpsTab && structureOpsTab\.key === 'players'/,
    'LEAD add/delete actions should remain enabled when Players are rendered through Scenario -> Players'
  );
  assert.match(
    text,
    /selected\.code === 'LEAD'[\s\S]*?buildQuintLeadRecord\(newRef, selected\.records\.length\)/,
    'Adding a player should seed Quint-style LEAD defaults'
  );
  assert.match(
    text,
    /function setGamePlayableCivilizations[\s\S]*?resetLeadCivilizationsOutsidePlayableSet\(normalizedIds\);[\s\S]*?return count;/,
    'Playable civilization edits should not resize the LEAD player list'
  );
});

test('Scenario Players panel renders the GAME playable civ checklist beside LEAD players', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function renderPlayableCivilizationsPanel\(\{ readOnly = false \} = \{\}\) \{[\s\S]*?title\.textContent = 'Playable Civs';[\s\S]*?setGamePlayableCivilizations\(record, Array\.from\(selectedIds\)\);/,
    'Playable Civilizations should have a dedicated Players-panel checklist bound to the GAME playable civ fields'
  );
  assert.match(
    text,
    /const showPlayableCivsPanel = selected\.code === 'LEAD'[\s\S]*?selectedSectionTab\.key === 'players'[\s\S]*?selectedBaseCode === 'GAME'[\s\S]*?activeGamePanel\.id === 'players'/,
    'The checklist should render on the effective Scenario -> Players route, not only on a hidden physical players tab'
  );
  assert.match(
    text,
    /if \(selected\.code === 'GAME' && groupName === 'Player Options'\) \{[\s\S]*?playableFields\.forEach\(\(field\) => consumedSpecialFields\.add\(field\)\);[\s\S]*?\n        \}/,
    'Scenario -> Scenario should still consume raw GAME playable civ fields without showing the old checklist there'
  );
});

test('Scenario Players top search filters Playable Civs and preserves focus', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function renderActiveTabPreservingInputFocus\(input, options = \{\}\) \{[\s\S]*?rememberInputFocusForRender\(input\);[\s\S]*?renderActiveTab\(options\);[\s\S]*?\}/,
    'Renderer should provide a rerender helper that carries the active input focus through DOM replacement'
  );
  assert.match(
    text,
    /const playableCivsFilterKey = 'players:playable-civs';[\s\S]*?const primaryFilterKey = showPlayableCivsPanel \? playableCivsFilterKey : recordFilterKey;[\s\S]*?recordSearch\.placeholder = showPlayableCivsPanel \? 'Search playable civs\.\.\.' : `Search \$\{getFriendlyBiqSectionTitle\(selected\)\.toLowerCase\(\)\}\.\.\.`;/,
    'The main Scenario -> Players search should become the Playable Civs search on the Players route'
  );
  assert.match(
    text,
    /recordSearch\.dataset\.preserveFocusKey = showPlayableCivsPanel[\s\S]*?\? `biq-search:\$\{playableCivsFilterKey\}`[\s\S]*?: `biq-record-search:\$\{recordFilterKey\}`;[\s\S]*?state\.biqRecordFilter\[primaryFilterKey\] = recordSearch\.value;[\s\S]*?renderActiveTabPreservingInputFocus\(recordSearch, \{ preserveTabScroll: true \}\);/,
    'The main search should retain focus while updating the active filter key'
  );
  assert.match(
    text,
    /const recordNeedle = showPlayableCivsPanel \? '' : String\(state\.biqRecordFilter\[recordFilterKey\] \|\| ''\)\.trim\(\)\.toLowerCase\(\);/,
    'The LEAD player list should not be filtered on Scenario -> Players'
  );
  assert.doesNotMatch(
    text,
    /search\.placeholder = 'Search civs\.\.\.';/,
    'The Playable Civs panel should not render its own mini search input'
  );
});

test('Scenario Players panel renders LEAD starting units as a structured list', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function parseLeadStartUnitFieldIndex\(field\)[\s\S]*?^function getBiqStructureDisplayLabel/m,
    'Renderer should parse LEAD starting unit fields instead of exposing only the raw count field'
  );
  assert.match(
    text,
    /selected\.code === 'LEAD' && groupName === 'Starting Units'[\s\S]*?consumedSpecialFields\.add\(countField\)[\s\S]*?Add Starting Unit/,
    'Starting Units should consume the raw count field and render Add/Remove unit rows'
  );
  assert.match(
    text,
    /entry\.field\.value = '0';[\s\S]*?markStartingUnitsDirty\(\);[\s\S]*?renderActiveTab/,
    'Removing a starting unit should stage a zero-count field edit so save removes that unit from LEAD.startUnits'
  );
});

test('map support rendering reads dirty BIQ field values before original load values', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const getFieldRawValue = \(record, baseKey\) => \{[\s\S]*?const current = String\(field\.value == null \? '' : field\.value\)\.trim\(\);[\s\S]*?const raw = String\(field\.originalValue == null \? '' : field\.originalValue\)\.trim\(\);[\s\S]*?if \(current && current !== raw\) return current;[\s\S]*?if \(raw\) return raw;/,
    'Map support sections should consume dirty Rules/Civs/Players values when rerendering or reopening the map'
  );
});

test('map civilization support preserves RACE indexes from reference entries', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const getReferenceBiqSectionFromTab = \(referenceTab, code\) => \{[\s\S]*?index: Number\.isFinite\(entry && entry\.biqIndex\) \? Number\(entry\.biqIndex\) : fallbackIdx,[\s\S]*?fields: Array\.isArray\(entry && entry\.biqFields\) \? entry\.biqFields : \[\]/,
    'Map RACE support should be synthesized from live civilization reference entries without losing BIQ indexes'
  );
  assert.match(
    text,
    /const raceIndex = Number\.isFinite\(record && record\.index\) \? Number\(record\.index\) : idx;[\s\S]*?getFieldRawValue\(record, 'civilizationname'\)[\s\S]*?raceIdByName\[civilizationName\.toLowerCase\(\)\] = raceIndex;[\s\S]*?raceDefaultColorById\[raceIndex\] = parseFieldInt\(record, 'defaultcolor', NaN\);/,
    'Map owner resolution should use live RACE civilization names and default colors keyed by BIQ index'
  );
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

  assert.match(
    text,
    /show_tile_destruct_animation_after:\s*\['bombard', 'bomb', 'pillage'\]/,
    'show_tile_destruct_animation_after should use the same structured bitfield editor as other C3X token lists'
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

test('Units tab exposes C3X unit-name arrays as contextual booleans', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  const expectedKeys = [
    'ptw_like_artillery_targeting',
    'can_bombard_only_sea_tiles',
    'exclude_types_from_units_per_tile_limit',
    'limit_defensive_retreat_on_water_to_types'
  ];

  expectedKeys.forEach((key) => {
    assert.match(
      rendererText,
      new RegExp(`key:\\s*'${key}'`),
      `Units C3X contextual rules should include ${key}`
    );
  });
  assert.match(
    rendererText,
    /function setUnitC3XListMembership\(row, unitName, enabled\)[\s\S]*?parseUnitC3XListValues\(row\.value\)[\s\S]*?serializeQuotedWhitespaceStructuredEntries\(withoutUnit\)/,
    'Units C3X booleans should preserve the structured quoted-list serializer'
  );
  assert.match(
    rendererText,
    /const c3xEditable = canEditC3XBaseRows\(\);[\s\S]*?const c3xCol = document\.createElement\('div'\);[\s\S]*?unit-dashboard-col-c3x[\s\S]*?const c3xRulesCard = renderUnitC3XRulesCard\(entry, c3xEditable\);[\s\S]*?if \(c3xRulesCard\) c3xCol\.appendChild\(c3xRulesCard\);[\s\S]*?if \(c3xCol\.childElementCount > 0\) dashboardGrid\.appendChild\(c3xCol\);/,
    'Units dense rules layout should place the contextual C3X rule card in the lower dashboard grid'
  );
});

test('C3X era alias editors use compact semantic table styling', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const stylesPath = path.join(__dirname, '..', 'src', 'styles.css');
  const rendererText = fs.readFileSync(rendererPath, 'utf8');
  const stylesText = fs.readFileSync(stylesPath, 'utf8');

  assert.match(
    rendererText,
    /const table = document\.createElement\('table'\);[\s\S]*?table\.className = 'civ-era-alias-table'/,
    'C3X civilization alias editor should use an actual table element'
  );
  assert.match(
    rendererText,
    /const table = document\.createElement\('table'\);[\s\S]*?table\.className = 'civ-era-alias-table leader-era-alias-table'/,
    'C3X leader alias editor should use an actual table element'
  );
  assert.match(
    stylesText,
    /\.civ-era-alias-table \{[\s\S]*?border-collapse: separate;[\s\S]*?border-spacing: 0;[\s\S]*?border: 1px solid rgba\(73, 69, 98, 0\.16\);/,
    'Era alias tables should have visible compact table framing'
  );
  assert.match(
    stylesText,
    /\.civ-era-alias-table input,\n\.civ-era-alias-table select \{[\s\S]*?border: 1px solid transparent;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
    'Era alias table controls should read like table cells until focused'
  );
  assert.match(
    stylesText,
    /\.civilization-inline-alias-table \{[\s\S]*?min-width: 0;/,
    'Civs tab inline alias tables should avoid forced horizontal scrolling'
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
  assertBefore(copyHandler, 'rememberUndoSnapshot();', 'ops.push(copyOp);', 'reference copy');
  assertBefore(importHandler, 'rememberUndoSnapshotForKey(`REFERENCE_TAB:${tabKey}`);', 'tab.diplomacySlots.push({', 'reference import diplomacy');
  assertBefore(importHandler, 'rememberUndoSnapshotForKey(`REFERENCE_TAB:${tabKey}`);', 'ops.push({', 'reference import');
});

test('renaming a pending reference entry updates pending copy sources that point at it', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const start = text.indexOf('function renameReferenceEntryKey(');
  assert.notEqual(start, -1, 'Expected renameReferenceEntryKey function');
  const end = text.indexOf('function hideEntityModal()', start);
  assert.notEqual(end, -1, 'Expected function after renameReferenceEntryKey');
  const fn = text.slice(start, end);

  assert.match(
    fn,
    /if \(String\(op\.newRecordRef \|\| ''\)\.toUpperCase\(\) === oldKey\) op\.newRecordRef = nextKey;[\s\S]*?if \(String\(op\.sourceRef \|\| ''\)\.toUpperCase\(\) === oldKey\) op\.sourceRef = nextKey;[\s\S]*?if \(String\(op\.copyFromRef \|\| ''\)\.toUpperCase\(\) === oldKey\) op\.copyFromRef = nextKey;/,
    'pending same-session copy chains must follow the final key of a renamed unsaved reference row'
  );
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
    /function renderImprovementDenseTopBoard\(entry, tabKey, selectedBaseIndex, referenceEditable, c3xBaseEditable, c3xDistrictEditable\)/,
    'Improvements top board should accept tabKey and selectedBaseIndex because its controls build entry-scoped undo keys'
  );

  assert.match(
    text,
    /renderImprovementDenseTopBoard\(entry, tabKey, selectedBaseIndex, referenceEditable, c3xBaseEditable, c3xDistrictEditable\)/,
    'Improvements rules layout should pass the active reference context into the top board renderer'
  );
});

test('contextual C3X reference-tab controls use C3X editability instead of BIQ editability', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function canEditC3XBaseRows\(row = null\) \{[\s\S]*?state\.bundle[\s\S]*?tabs\.base[\s\S]*?tab\.readOnly/,
    'Contextual C3X controls should derive editability from the base C3X tab'
  );

  assert.match(
    text,
    /function renderUnitDenseRulesLayout[\s\S]*?const c3xEditable = canEditC3XBaseRows\(\);[\s\S]*?renderUnitResourcePrereqEditor\(\{[\s\S]*?c3xEditable,[\s\S]*?renderUnitBuildingPrereqsControl\(entry, c3xEditable\)[\s\S]*?renderUnitC3XRulesCard\(entry, c3xEditable\)/,
    'Units tab C3X controls should stay editable in Standard mode while BIQ controls remain read-only'
  );

  assert.match(
    text,
    /function renderCivilizationDenseRulesLayout[\s\S]*?const c3xEditable = canEditC3XBaseRows\(\);[\s\S]*?renderCivilizationC3XAliasesCard\(entry, c3xEditable\)/,
    'Civilization alias controls should use C3X base editability'
  );

  assert.match(
    text,
    /function renderImprovementDenseRulesLayout[\s\S]*?const c3xBaseEditable = canEditC3XBaseRows\(\);[\s\S]*?const c3xDistrictEditable = canEditC3XConfigTab\('districts'\);[\s\S]*?renderImprovementDenseTopBoard\(entry, tabKey, selectedBaseIndex, referenceEditable, c3xBaseEditable, c3xDistrictEditable\)/,
    'Improvement C3X controls should split base-row and district-config editability from BIQ editability'
  );

  assert.match(
    text,
    /function renderImprovementDenseTopBoard[\s\S]*?renderImprovementGeneratedResourcesControl\(entry, c3xBaseEditable\)[\s\S]*?renderImprovementRequiredByUnitsControl\(entry, c3xBaseEditable\)[\s\S]*?renderImprovementProductionPerfumeControl\(entry, c3xBaseEditable\)/,
    'Improvement C3X base controls should place Required By Units after Generated Resources and before Production Perfume'
  );

  assert.match(
    text,
    /function renderImprovementRequiredByUnitsControl\(entry, c3xEditable\) \{[\s\S]*?const baseKey = 'building_prereqs_for_units'[\s\S]*?createImprovementC3XTopBoardCell\([\s\S]*?'Required By Units'[\s\S]*?baseKey/,
    'Improvement Required By Units should edit the C3X building_prereqs_for_units base row'
  );

  assert.match(
    text,
    /function setImprovementRequiredByUnitMembership\(entry, row, unitNames\) \{[\s\S]*?parseBuildingPrereqItems\(row\.value\)[\s\S]*?serializeBuildingPrereqItems\(nextItems\)/,
    'Improvement Required By Units should preserve the building_prereqs_for_units structured format'
  );

  assert.match(
    text,
    /function renderTechnologyDenseRulesLayout[\s\S]*?const c3xEditable = canEditC3XBaseRows\(\);[\s\S]*?renderTechnologyPerfumeControl\(entry, c3xEditable\)/,
    'Technology perfume should be available as a contextual C3X base control'
  );
});

test('reference warning badges include Game Concepts', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /\['civilizations', 'technologies', 'resources', 'governments', 'improvements', 'gameConcepts', 'music'\]\.includes\(key\)/,
    'Game Concepts should use the shared reference-tab warning badge path'
  );
});

test('reference sidebar toggle is available on resource and government detail tabs', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const REFERENCE_CONTEXT_TOGGLE_TABS = new Set\(\['civilizations', 'technologies', 'resources', 'improvements', 'governments', 'units'\]\)/,
    'Resources and Governments should use the shared Hide Sidebar / Show Sidebar control'
  );

  assert.match(
    text,
    /if \(REFERENCE_CONTEXT_TOGGLE_TABS\.has\(tabKey\)\) \{[\s\S]*?sidebarLabel\.textContent = visible \? 'Hide Sidebar' : 'Show Sidebar'/,
    'Inline reference navigation should render the sidebar toggle from the shared tab set'
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

test('reference pickers refresh labels from live target entries', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /const getOptionDisplayLabel = \(option, fallback = noneLabel\) => \{[\s\S]*?getReferenceEntryDisplayName\(targetTabKey, option\.entry\)[\s\S]*?option\.entry\.name/,
    'Reference picker labels should resolve through the live target entry instead of only the option snapshot'
  );

  assert.match(
    text,
    /const refreshMenuRowsLabels = \(\) => \{[\s\S]*?row\.__referencePickerOption[\s\S]*?row\.dataset\.search = label\.toLowerCase\(\);[\s\S]*?text\.textContent = label;/,
    'Reference picker menu rows should refresh labels and search text when reopened after a target rename'
  );

  assert.match(
    text,
    /activeReferencePickerCloser = closeMenu;[\s\S]*?renderButton\(selectedPickerValue\);[\s\S]*?buildMenuRows\(\);[\s\S]*?refreshMenuRowsLabels\(\);/,
    'Opening a picker should repaint the selected button and option labels from live entry names'
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

test('BIQ reference pickers display unresolved current values as invalid references', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /function makeInvalidReferenceOption\(targetTabKey, value\)[\s\S]*?`Invalid \$\{noun\} index: \$\{parsed\}`/,
    'Reference pickers should format unresolved numeric current values as invalid target indexes'
  );

  assert.match(
    text,
    /if \(currentValue && currentValue !== '-1' && !findOptionByValue\(normalizedOptions, currentValue\)\) \{[\s\S]*?normalizedOptions\.push\(makeInvalidReferenceOption\(targetTabKey, currentValue\)\);[\s\S]*?\}/,
    'Reference pickers should add the unresolved current value as a selectable invalid option instead of falling back to none'
  );
});

test('Unit Available To panel exposes a visible Add All action', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const text = fs.readFileSync(rendererPath, 'utf8');

  assert.match(
    text,
    /if \(referenceEditable && cfg\.kind === 'availableTo'\) \{[\s\S]*?addAllBtn\.textContent = 'Add All';[\s\S]*?field\.value = encodeAvailableToFromIndices\(allSelectedValues\);/,
    'Unit Available To should provide a visible Add All action that writes all civilization indexes into the bitmask'
  );
});

test('Unit list panels render abilities and Available To as checkbox lists', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const stylesPath = path.join(__dirname, '..', 'src', 'styles.css');
  const text = fs.readFileSync(rendererPath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.ok(
    text.includes('function renderUnitAbilityCheckboxEditor(entry, { readOnly = false, onValuesChange = null } = {})')
      && text.includes('UNIT_ABILITY_OPTION_KEYS.forEach((key) => {')
      && text.includes("text.textContent = UNIT_RULE_FRIENDLY_LABELS[key] || toFriendlyKey(key);")
      && text.includes("check.type = 'checkbox';"),
    'Unit Abilities should list every known ability as a friendly checkbox row'
  );
  assert.ok(
    text.includes('function renderUnitAvailableToCheckboxEditor(entry, options, { readOnly = false, onValuesChange = null } = {})')
      && text.includes("thumb.className = 'entry-thumb unit-available-to-thumb';")
      && text.includes("loadReferenceListThumbnail('civilizations', opt.entry, thumb);")
      && text.includes("check.type = 'checkbox';"),
    'Unit Available To should list civilization options with thumbnails and checkboxes'
  );
  assert.match(
    text,
    /footsoldier: 'Foot Unit'[\s\S]*?rangedattackanimations: 'Ranged Attack Animation'[\s\S]*?transportsonlyairunits: 'Transports Only Aircraft'/,
    'Unit ability labels should use Quint-style names for non-obvious PRTO fields'
  );
  assert.match(
    styles,
    /\.unit-list-panel \.unit-checkbox-list[\s\S]*?overflow: auto;[\s\S]*?\.unit-list-panel \.unit-checkbox-row[\s\S]*?display: grid;/,
    'Unit checkbox lists should scroll inside the existing Units bottom-list panels'
  );
});
