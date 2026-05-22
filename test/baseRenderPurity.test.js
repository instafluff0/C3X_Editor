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
    /const isScopedBaseSnapshot = isScopedBaseUndoSnapshot\(targetSnapshot\);[\s\S]*?const isSerializedReferenceEntrySnapshot = !!\([\s\S]*?targetSnapshot\.kind === 'serialized-reference-entry'[\s\S]*?\);[\s\S]*?const isSerializedSectionSnapshot = !!\([\s\S]*?targetSnapshot\.kind === 'serialized-section-item'[\s\S]*?\);[\s\S]*?if \(\s*!isScopedBaseSnapshot[\s\S]*?!isSerializedReferenceEntrySnapshot[\s\S]*?&& !isSerializedSectionSnapshot[\s\S]*?await loadBundleAndRender\(\{/m,
    'Scoped base, entry-scoped reference, and section-scoped undo should skip the scenario reload path so unrelated in-memory edits are not discarded before the snapshot is applied'
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
