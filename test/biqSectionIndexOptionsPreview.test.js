'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunctionSource(sourceText, name) {
  const needle = `function ${name}(`;
  const start = sourceText.indexOf(needle);
  if (start < 0) throw new Error(`Could not find function ${name} in renderer.js`);
  let paramDepth = 0;
  let signatureEnd = -1;
  for (let i = start + needle.length - 1; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    if (ch === '(') paramDepth += 1;
    if (ch === ')') {
      paramDepth -= 1;
      if (paramDepth === 0) {
        signatureEnd = i;
        break;
      }
    }
  }
  if (signatureEnd < 0) throw new Error(`Could not find parameter list end for function ${name}`);
  const bodyStart = sourceText.indexOf('{', signatureEnd);
  if (bodyStart < 0) throw new Error(`Could not find body for function ${name}`);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`Could not determine end of function ${name}`);
  return sourceText.slice(start, end);
}

function loadPreviewOptionHelpers(bundle) {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const functionNames = [
    'normalizeConfigToken',
    'tokenizeListPreservingQuotes',
    'getFieldValue',
    'getFallbackBiqSectionForOptions',
    'makeBiqSectionIndexOptions',
    'getBiqFieldByBaseKey',
    'getBiqEraLabelByIndex',
    'getCivilizationAnimationRows',
    'getTechnologyUnlockTechName',
    'getReferenceEntriesForUnlockGroup',
    'isTechnologyUnlockBiqStructureGroup',
    'getTechnologyUnlockDirtyTabKey',
    'getBiqStructureRecordsForUnlockGroup',
    'getDistrictSectionsForUnlockGroup',
    'getTechnologyUnlockEntriesForSpec',
    'getTechnologyUnlockEntryIndex',
    'getTechnologyUnlockEntryIndexForSpec',
    'isTechnologyPrerequisiteUnlockGroup',
    'getTechnologyPrerequisiteFieldKeys',
    'getTechnologyPrerequisiteFieldsForUnlockGroup',
    'technologyEntryHasUnlockPrerequisite',
    'getTechnologyUnlockPrerequisiteOpenField',
    'canTechnologyAcceptUnlockPrerequisite',
    'getTechnologyUnlockOptions',
    'getDistrictAdvancePrereqTokens',
    'setDistrictAdvancePrereqTokens',
    'getTechnologyUnlockFieldByBaseKey',
    'ensureTechnologyUnlockFieldByBaseKey',
    'setTechnologyUnlockTechReferenceTarget',
    'getTechnologyUnlockSelectedEntries',
    'setTechnologyUnlockMembership'
  ];
  const cleanTabs = JSON.parse(JSON.stringify((bundle && bundle.tabs) || {}));
  const sandbox = {
    state: { bundle, dirtyReferenceKeysByTab: {}, dirtyTabCounts: {}, isDirty: false },
    cleanTabs,
    dirtyTabs: [],
    BIQ_SECTION_TO_REFERENCE_TAB: {
      RACE: 'civilizations',
      TECH: 'technologies',
      GOOD: 'resources',
      BLDG: 'improvements',
      GOVT: 'governments',
      PRTO: 'units'
    },
    getReferenceEntryIndexForOption: (_targetTabKey, entry, fallbackIdx, options = {}) => {
      if (Number.isFinite(Number(entry && entry.biqIndex))) return Number(entry.biqIndex);
      return options && options.allowFallback ? Number(fallbackIdx) : null;
    },
    getReferenceEntryDisplayName: (_tabKey, entry) => String(entry && entry.name || '').trim(),
    getFieldByBaseKey: (record, baseKey) => {
      const fields = Array.isArray(record && record.fields) ? record.fields : [];
      return fields.find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === String(baseKey || '').toLowerCase()) || null;
    },
    getBiqSectionFromTab: (tab, code) => {
      const sections = Array.isArray(tab && tab.sections) ? tab.sections : [];
      return sections.find((section) => String(section && section.code || '').toUpperCase() === String(code || '').toUpperCase()) || null;
    },
    getDisplayBiqRecordName: (_sectionCode, record, idxFallback = 0) => {
      const idx = Number.isFinite(Number(record && record.index)) ? Number(record.index) : Number(idxFallback) || 0;
      return String(record && record.name || '').trim() || `${_sectionCode} ${idx + 1}`;
    },
    ensureSyntheticReferenceEntryForBiqRecord: (_tabKey, _sectionCode, rec) => ({
      name: String(rec && rec.name || ''),
      civilopediaKey: String((sandbox.getFieldByBaseKey(rec, 'civilopediaentry') || {}).value || '').trim().toUpperCase()
    }),
    getBiqFieldByBaseKey: (entry, baseKey) => {
      const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
      return fields.find((field) => String(field && (field.baseKey || field.key) || '').toLowerCase() === String(baseKey || '').toLowerCase()) || null;
    },
    ensureBiqFieldByBaseKey: (entry, baseKey, label = '', initialValue = '') => {
      let field = sandbox.getBiqFieldByBaseKey(entry, baseKey);
      if (field) return field;
      if (!Array.isArray(entry.biqFields)) entry.biqFields = [];
      field = {
        key: String(baseKey || '').toLowerCase(),
        baseKey: String(baseKey || '').toLowerCase(),
        label,
        value: String(initialValue || ''),
        originalValue: '',
        editable: true
      };
      entry.biqFields.push(field);
      return field;
    },
    makeIndexOptionsForTab: (tabKey) => {
      const tab = sandbox.state.bundle && sandbox.state.bundle.tabs
        ? sandbox.state.bundle.tabs[tabKey]
        : null;
      const entries = tab && Array.isArray(tab.entries) ? tab.entries : [];
      return entries.map((entry, fallbackIdx) => ({
        value: String(sandbox.getReferenceEntryIndexForOption(tabKey, entry, fallbackIdx, { allowFallback: true })),
        label: String(entry && (entry.name || entry.civilopediaKey) || ''),
        entry
      }));
    },
    setFieldReferenceTargetMeta: (field, targetTabKey, option, value, options = []) => {
      if (!field) return;
      const normalized = String(value == null ? '' : value).trim();
      if (!normalized || normalized === '-1') {
        delete field.referenceTarget;
        return;
      }
      const match = (option && option.entry)
        ? option
        : (Array.isArray(options) ? options : []).find((opt) => String(opt && opt.value) === normalized);
      const key = String(match && match.entry && match.entry.civilopediaKey || '').trim().toUpperCase();
      if (key) field.referenceTarget = { tabKey: String(targetTabKey || ''), key };
      else delete field.referenceTarget;
    },
    resolveTechIndexFromValue: (rawValue) => {
      const text = String(rawValue == null ? '' : rawValue).trim();
      if (!text || /^none$/i.test(text)) return -1;
      const paren = text.match(/\((-?\d+)\)\s*$/);
      if (paren) return Number.parseInt(paren[1], 10);
      if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
      return null;
    },
    setDirty: (_next, options = {}) => {
      sandbox.state.isDirty = _next === true;
      sandbox.dirtyTabs.push(String(options && options.knownDirtyTab || ''));
    },
    rebuildReferenceDirtyCacheForTab: (tabKey) => {
      const tab = sandbox.state.bundle && sandbox.state.bundle.tabs
        ? sandbox.state.bundle.tabs[tabKey]
        : null;
      const entries = tab && Array.isArray(tab.entries) ? tab.entries : [];
      const set = new Set();
      entries.forEach((entry, idx) => {
        const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
        if (fields.some((field) => String(field && field.value || '') !== String(field && field.originalValue || ''))) {
          set.add(`idx:${idx}`);
        }
      });
      sandbox.state.dirtyReferenceKeysByTab[tabKey] = set;
      if (set.size > 0) sandbox.state.dirtyTabCounts[tabKey] = set.size;
      else delete sandbox.state.dirtyTabCounts[tabKey];
      return true;
    },
    recomputeDirtyCountForTab: (tabKey) => {
      const currentTab = sandbox.state.bundle && sandbox.state.bundle.tabs
        ? sandbox.state.bundle.tabs[tabKey]
        : null;
      const cleanTab = sandbox.cleanTabs && sandbox.cleanTabs[tabKey];
      const sections = currentTab && currentTab.model && Array.isArray(currentTab.model.sections)
        ? currentTab.model.sections
        : (Array.isArray(currentTab && currentTab.sections) ? currentTab.sections : []);
      const cleanSections = cleanTab && cleanTab.model && Array.isArray(cleanTab.model.sections)
        ? cleanTab.model.sections
        : (Array.isArray(cleanTab && cleanTab.sections) ? cleanTab.sections : []);
      let count = 0;
      sections.forEach((section, idx) => {
        if (JSON.stringify(section) !== JSON.stringify(cleanSections[idx] || null)) count += 1;
      });
      if (count > 0) sandbox.state.dirtyTabCounts[tabKey] = count;
      else delete sandbox.state.dirtyTabCounts[tabKey];
      return count;
    },
    globalThis: null
  };
  sandbox.globalThis = sandbox;
  const scriptSource = functionNames.map((name) => extractFunctionSource(sourceText, name)).join('\n\n')
    + '\n\nglobalThis.__helpers = { '
    + functionNames.map((name) => `${name}: ${name}`).join(', ')
    + ' };';
  vm.runInNewContext(scriptSource, sandbox, { filename: 'renderer-biq-section-index-options-preview.vm' });
  return { ...sandbox.__helpers, state: sandbox.state };
}

function makeField(baseKey, value, originalValue = value) {
  return {
    baseKey,
    key: baseKey,
    value: String(value),
    originalValue: String(originalValue)
  };
}

test('makeBiqSectionIndexOptions prefers live tab RACE records over stale BIQ sections', () => {
  const bundle = {
    biq: {
      sections: []
    },
    tabs: {
      civilizations: {
        entries: [
          { civilopediaKey: 'RACE_ROMANS', biqIndex: 1, name: 'Romans' }
        ],
        sections: [{
          code: 'RACE',
          records: [{
            index: 1,
            name: 'Romans',
            fields: [makeField('civilopediaentry', 'RACE_ROMANS')]
          }]
        }]
      }
    }
  };
  const { makeBiqSectionIndexOptions } = loadPreviewOptionHelpers(bundle);

  const options = makeBiqSectionIndexOptions('RACE', false);

  assert.deepEqual(options.map((opt) => ({ value: opt.value, label: opt.label })), [
    { value: '1', label: 'Romans' }
  ]);
});

test('makeBiqSectionIndexOptions can build non-reference section options from preview tabs', () => {
  const bundle = {
    biq: {
      sections: []
    },
    tabs: {
      rules: {
        sections: [{
          code: 'ERAS',
          records: [
            { index: 0, name: 'Ancient Times', fields: [] },
            { index: 1, name: 'Middle Ages', fields: [] }
          ]
        }]
      }
    }
  };
  const { makeBiqSectionIndexOptions } = loadPreviewOptionHelpers(bundle);

  const options = makeBiqSectionIndexOptions('ERAS', false);

  assert.deepEqual(options.map((opt) => ({ value: opt.value, label: opt.label })), [
    { value: '0', label: 'Ancient Times' },
    { value: '1', label: 'Middle Ages' }
  ]);
});

test('getCivilizationAnimationRows uses loaded scenario era names', () => {
  const bundle = {
    biq: {
      sections: []
    },
    tabs: {
      rules: {
        sections: [{
          code: 'ERAS',
          records: [
            { index: 0, name: 'Pre-War', fields: [] },
            { index: 1, name: 'Early War', fields: [] },
            { index: 2, name: 'Late War', fields: [] },
            { index: 3, name: 'Cold War', fields: [] }
          ]
        }]
      }
    }
  };
  const { getCivilizationAnimationRows } = loadPreviewOptionHelpers(bundle);
  const entry = {
    biqFields: [
      makeField('forwardfilename_for_era_0', 'Art\\Flics\\china_T.flc'),
      makeField('reversefilename_for_era_0', 'Art\\Flics\\china_T.flc'),
      makeField('forwardfilename_for_era_1', 'Art\\Flics\\china_M.flc'),
      makeField('reversefilename_for_era_1', 'Art\\Flics\\china_M.flc'),
      makeField('forwardfilename_for_era_2', 'Art\\Flics\\china_I.flc'),
      makeField('reversefilename_for_era_2', 'Art\\Flics\\china_I.flc'),
      makeField('forwardfilename_for_era_3', 'Art\\Flics\\china_A.flc'),
      makeField('reversefilename_for_era_3', 'Art\\Flics\\china_A.flc')
    ]
  };

  const rows = getCivilizationAnimationRows(entry);

  assert.equal(
    JSON.stringify(rows.map((row) => row.era)),
    JSON.stringify(['Pre-War', 'Early War', 'Late War', 'Cold War'])
  );
});

test('Tech unlock membership edits mutate only matching target BIQ tech fields', () => {
  const makeEntry = (name, biqIndex, requiredTech) => ({
    name,
    biqIndex,
    biqFields: [
      makeField('requiredtech', requiredTech)
    ]
  });
  const bundle = {
    tabs: {
      units: {
        entries: [
          makeEntry('Archer', 0, '2'),
          makeEntry('Knight', 1, '3'),
          makeEntry('Cannon', 2, 'None')
        ]
      }
    }
  };
  const helpers = loadPreviewOptionHelpers(bundle);
  const spec = {
    key: 'units',
    tabKey: 'units',
    fieldKey: 'requiredtech'
  };

  assert.deepEqual(
    helpers.getTechnologyUnlockSelectedEntries(spec, 2).map((item) => item.entryIndex),
    [0]
  );

  helpers.setTechnologyUnlockMembership(spec, 2, [1, 2]);

  assert.equal(bundle.tabs.units.entries[0].biqFields[0].value, '-1');
  assert.equal(bundle.tabs.units.entries[1].biqFields[0].value, '2');
  assert.equal(bundle.tabs.units.entries[2].biqFields[0].value, '2');
  assert.equal(helpers.state.dirtyTabCounts.units, 3);
});

test('Tech unlock membership preserves already-matching references and precise dirty counts', () => {
  const makeEntry = (name, biqIndex, requiredTech) => ({
    name,
    biqIndex,
    biqFields: [
      makeField('requiredtech', requiredTech)
    ]
  });
  const bundle = {
    tabs: {
      units: {
        entries: [
          makeEntry('Modern Paratrooper', 0, 'Synthetic Fibers (2)'),
          makeEntry('Modern Armor', 1, '2'),
          makeEntry('Ancient Cavalry', 2, '-1'),
          makeEntry('Mechanized Infantry', 3, '3')
        ]
      }
    }
  };
  const helpers = loadPreviewOptionHelpers(bundle);
  const spec = {
    key: 'units',
    tabKey: 'units',
    fieldKey: 'requiredtech'
  };

  helpers.setTechnologyUnlockMembership(spec, 2, [0, 2]);

  assert.equal(bundle.tabs.units.entries[0].biqFields[0].value, 'Synthetic Fibers (2)');
  assert.equal(bundle.tabs.units.entries[1].biqFields[0].value, '-1');
  assert.equal(bundle.tabs.units.entries[2].biqFields[0].value, '2');
  assert.equal(bundle.tabs.units.entries[3].biqFields[0].value, '3');
  assert.equal(helpers.state.dirtyTabCounts.units, 2);
});

test('Tech unlock membership edits district advance prerequisites with precise dirty counts', () => {
  const makeSection = (name, advancePrereqs = '') => ({
    fields: [
      { key: 'name', value: name },
      ...(advancePrereqs ? [{ key: 'advance_prereqs', value: advancePrereqs }] : [])
    ]
  });
  const bundle = {
    tabs: {
      districts: {
        model: {
          sections: [
            makeSection('Airfield', 'Synthetic Fibers, Flight'),
            makeSection('Canal', 'Map Making'),
            makeSection('Bridge', '')
          ]
        }
      }
    }
  };
  const helpers = loadPreviewOptionHelpers(bundle);
  const spec = {
    key: 'districts',
    tabKey: 'districts',
    fieldKey: 'advance_prereqs',
    kind: 'section'
  };
  const techEntry = { name: 'Synthetic Fibers', biqIndex: 2 };

  assert.deepEqual(
    helpers.getTechnologyUnlockSelectedEntries(spec, 2, techEntry).map((item) => item.entryIndex),
    [0]
  );

  helpers.setTechnologyUnlockMembership(spec, 2, [0, 2], techEntry);

  assert.equal(bundle.tabs.districts.model.sections[0].fields.find((field) => field.key === 'advance_prereqs').value, 'Synthetic Fibers, Flight');
  assert.equal(bundle.tabs.districts.model.sections[1].fields.find((field) => field.key === 'advance_prereqs').value, 'Map Making');
  assert.equal(bundle.tabs.districts.model.sections[2].fields.find((field) => field.key === 'advance_prereqs').value, 'Synthetic Fibers');
  assert.equal(helpers.state.dirtyTabCounts.districts, 1);

  helpers.setTechnologyUnlockMembership(spec, 2, [2], techEntry);

  assert.equal(bundle.tabs.districts.model.sections[0].fields.find((field) => field.key === 'advance_prereqs').value, 'Flight');
  assert.equal(bundle.tabs.districts.model.sections[2].fields.find((field) => field.key === 'advance_prereqs').value, 'Synthetic Fibers');
  assert.equal(helpers.state.dirtyTabCounts.districts, 2);
});

test('Tech unlock membership edits downstream technology prerequisites with precise dirty counts', () => {
  const makeTechEntry = (name, biqIndex, prereqs) => ({
    name,
    biqIndex,
    biqFields: ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4']
      .map((key, idx) => makeField(key, prereqs[idx] == null ? '-1' : prereqs[idx]))
  });
  const bundle = {
    tabs: {
      technologies: {
        entries: [
          makeTechEntry('Pottery', 0, ['-1', '-1', '-1', '-1']),
          makeTechEntry('Writing', 1, ['0', '-1', '-1', '-1']),
          makeTechEntry('Bronze Working', 2, ['-1', '-1', '-1', '-1']),
          makeTechEntry('Iron Working', 3, ['Bronze Working (2)', '1', '-1', '-1']),
          makeTechEntry('Horseback Riding', 4, ['0', '-1', '-1', '-1']),
          makeTechEntry('Philosophy', 5, ['0', '1', '3', '4'])
        ]
      }
    }
  };
  const helpers = loadPreviewOptionHelpers(bundle);
  const spec = {
    key: 'technologies',
    tabKey: 'technologies',
    kind: 'technologyPrerequisite',
    fieldKeys: ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4']
  };

  assert.deepEqual(
    helpers.getTechnologyUnlockSelectedEntries(spec, 2).map((item) => item.entryIndex),
    [3]
  );
  assert.deepEqual(
    helpers.getTechnologyUnlockOptions(spec, 2).map((opt) => opt.value),
    ['4', '3', '0', '1'].sort((a, b) => {
      const names = { 0: 'Pottery', 1: 'Writing', 3: 'Iron Working', 4: 'Horseback Riding' };
      return names[a].localeCompare(names[b], 'en', { sensitivity: 'base' });
    }),
    'downstream tech options should exclude the selected tech and techs whose prereq slots are full'
  );

  helpers.setTechnologyUnlockMembership(spec, 2, [3, 4, 2]);

  assert.equal(bundle.tabs.technologies.entries[2].biqFields[0].value, '-1', 'selected tech should not gain itself as a prerequisite');
  assert.equal(bundle.tabs.technologies.entries[3].biqFields[0].value, 'Bronze Working (2)', 'already-matching display references should be preserved');
  assert.equal(bundle.tabs.technologies.entries[4].biqFields[1].value, '2', 'new downstream tech should use the first open prerequisite slot');
  assert.equal(bundle.tabs.technologies.entries[5].biqFields[0].value, '0', 'full unrelated tech should remain untouched');
  assert.equal(helpers.state.dirtyTabCounts.technologies, 1);

  helpers.setTechnologyUnlockMembership(spec, 2, [4]);

  assert.equal(bundle.tabs.technologies.entries[3].biqFields[0].value, '-1', 'removing a downstream tech should clear only this prerequisite');
  assert.equal(bundle.tabs.technologies.entries[3].biqFields[1].value, '1', 'removing one prerequisite should preserve other target prerequisites');
  assert.equal(bundle.tabs.technologies.entries[4].biqFields[1].value, '2');
  assert.equal(helpers.state.dirtyTabCounts.technologies, 2);
});

test('Tech unlock dropdown edits refresh the unlock board instead of rebuilding the whole tab', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const sourceText = fs.readFileSync(rendererPath, 'utf8');
  const pickerStart = sourceText.indexOf('function renderTechnologyUnlockPicker(');
  const pickerEnd = sourceText.indexOf('function makeTechnologyUnlockDeferredPicker(', pickerStart);
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart, 'renderer should define the Tech unlock picker before the deferred picker');
  const pickerSource = sourceText.slice(pickerStart, pickerEnd);

  assert.match(
    sourceText,
    /function refreshTechnologyUnlocksBoardInPlace\(anchor, techEntry, referenceEditable\) \{[\s\S]*?currentBoard\.replaceWith\(nextBoard\);/,
    'Tech unlock edits should have a focused board refresh helper'
  );
  assert.match(
    pickerSource,
    /if \(!refreshTechnologyUnlocksBoardInPlace\(picker, techEntry, referenceEditable\)\) \{\s*renderActiveTab\(\{ preserveTabScroll: true \}\);\s*\}/,
    'Tech unlock picker changes should use the focused board refresh and keep full-tab render only as a fallback'
  );
});
