const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { previewFileDiff } = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-preview-diff-'));
}

function seedDefaultFiles(root) {
  fs.writeFileSync(path.join(root, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_config.txt'), '#District\nname = Base\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_wonders_config.txt'), '#Wonder\nname = W\nimg_row = 0\nimg_column = 0\nimg_construct_row = 0\nimg_construct_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.districts_natural_wonders_config.txt'), '#Wonder\nname = N\nterrain_type = grassland\nimg_row = 0\nimg_column = 0\n', 'utf8');
  fs.writeFileSync(path.join(root, 'default.tile_animations.txt'), '#Animation\nname = A\nini_path = X\\Y.ini\ntype = terrain\nterrain_types = grassland\n', 'utf8');
}

test('previewFileDiff returns surgical Civilopedia hunk with line numbers', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  const initial = [
    '#RACE_AZTECS',
    'Legacy Aztecs overview',
    '',
    '#DESC_RACE_AZTECS',
    'Legacy entry',
    '',
    '#RACE_MAYANS',
    'Legacy Mayans overview',
    ''
  ].join('\n');
  fs.writeFileSync(civPath, Buffer.from(initial, 'latin1'));

  const tabs = {
    civilizations: {
      title: 'Civs',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'RACE_AZTECS',
          civilopediaSection1: 'Updated Aztecs overview',
          originalCivilopediaSection1: 'Legacy Aztecs overview',
          civilopediaSection2: 'Legacy entry',
          originalCivilopediaSection2: 'Legacy entry',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ],
      sourceDetails: {
        civilopediaScenario: civPath
      }
    }
  };

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs,
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  assert.equal(res.kind, 'civilopedia');
  assert.equal(res.exists, true);
  assert.ok(Array.isArray(res.diffRows));

  const hunks = res.diffRows.filter((row) => row.kind === 'hunk');
  const delRows = res.diffRows.filter((row) => row.kind === 'del');
  const addRows = res.diffRows.filter((row) => row.kind === 'add');
  assert.equal(hunks.length, 1);
  const overviewDel = delRows.find((row) => row.text === 'Legacy Aztecs overview');
  const overviewAdd = addRows.find((row) => row.text === 'Updated Aztecs overview');
  assert.ok(overviewDel, 'expected removed overview line');
  assert.ok(overviewAdd, 'expected added overview line');
  assert.equal(overviewDel.oldLine, 2);
  assert.equal(overviewAdd.newLine, 2);
  assert.ok(res.diffRows.length < 15, 'diff should be local to changed section');
});

test('previewFileDiff keeps line-ending-only Civilopedia normalization silent', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  fs.writeFileSync(civPath, Buffer.from([
    '#RACE_TEST',
    'Legacy overview',
    ''
  ].join('\n'), 'latin1'));

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs: {
      civilizations: {
        sourceDetails: {
          civilopediaScenario: civPath
        }
      }
    },
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  assert.equal(res.kind, 'civilopedia');
  assert.equal(res.lineEndingOnlyChange, true);
  assert.match(res.diffRows[0].text, /No textual differences/);
  assert.equal((res.newText.match(/(?<!\r)\n/g) || []).length, 0);
});

test('previewFileDiff shows only Civilopedia content edits when line endings are also normalized', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  fs.writeFileSync(civPath, Buffer.from([
    '#DESC_TECH_POLYTHEISM',
    '^Polytheism original text.',
    '^More original text.',
    ''
  ].join('\n'), 'latin1'));

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs: {
      civilizations: {
        sourceDetails: {
          civilopediaScenario: civPath
        }
      },
      technologies: {
        title: 'Technologies',
        type: 'reference',
        entries: [{
          civilopediaKey: 'TECH_POLYTHEISM',
          civilopediaSection1: '',
          originalCivilopediaSection1: '',
          civilopediaSection2: '^Polytheism original text. ',
          originalCivilopediaSection2: '^Polytheism original text.',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }]
      }
    },
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  assert.equal(res.kind, 'civilopedia');
  assert.equal(res.lineEndingsNormalized, true);
  assert.equal(res.lineEndingOnlyChange, false);
  assert.equal(res.diffRows.some((row) => row.kind === 'del' && row.text === '^Polytheism original text.'), true);
  assert.equal(res.diffRows.some((row) => row.kind === 'add' && row.text === '^Polytheism original text. '), true);
  assert.equal((res.newText.match(/(?<!\r)\n/g) || []).length, 0);
});

test('previewFileDiff is case-sensitive for text changes', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  const initial = [
    '#RACE_TEST_CIV',
    'Mixed Case Entry',
    '',
    '#DESC_RACE_TEST_CIV',
    'Original Description',
    ''
  ].join('\n');
  fs.writeFileSync(civPath, Buffer.from(initial, 'latin1'));

  const tabs = {
    civilizations: {
      title: 'Civs',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'RACE_TEST_CIV',
          civilopediaSection1: 'mixed case entry',
          originalCivilopediaSection1: 'Mixed Case Entry',
          civilopediaSection2: 'Original Description',
          originalCivilopediaSection2: 'Original Description',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ],
      sourceDetails: {
        civilopediaScenario: civPath
      }
    }
  };

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs,
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  const delRows = res.diffRows.filter((row) => row.kind === 'del');
  const addRows = res.diffRows.filter((row) => row.kind === 'add');
  assert.ok(delRows.some((row) => row.text === 'Mixed Case Entry'));
  assert.ok(addRows.some((row) => row.text === 'mixed case entry'));
});

test('previewFileDiff does not add newline-only churn for single Civilopedia line edit', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  const initial = [
    '#GCON_City_Sizes',
    'Original concept line',
    '',
    '#DESC_GCON_City_Sizes',
    'Original desc line',
    '',
    '#RACE_UNTOUCHED',
    'Keep this untouched exactly',
    ''
  ].join('\n');
  fs.writeFileSync(civPath, Buffer.from(initial, 'latin1'));

  const tabs = {
    gameConcepts: {
      title: 'Concepts',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'GCON_CITY_SIZES',
          civilopediaSection1: 'Updated concept line',
          originalCivilopediaSection1: 'Original concept line',
          civilopediaSection2: 'Original desc line',
          originalCivilopediaSection2: 'Original desc line',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ]
    }
  };

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs,
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  const delRows = res.diffRows.filter((row) => row.kind === 'del');
  const addRows = res.diffRows.filter((row) => row.kind === 'add');
  assert.ok(delRows.some((row) => row.text === 'Original concept line'));
  assert.ok(addRows.some((row) => row.text === 'Updated concept line'));
  assert.equal(
    addRows.filter((row) => row.text === '').length,
    0,
    'should not add blank-line-only rows for a single-line edit'
  );
});

test('previewFileDiff for caret-formatted unit entry changes only edited line', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  const beforeOverviewLines = [
    '^This unit is currently unavailable.',
    '',
    '^Aggros are found in almost all Dark Elven armies.  They should be at the forefront of any early invasions launched by these Elves to expand their territory.  Aggros that win battles have a chance of creating a Colonizer.',
    '^',
    '^AVAILABLE TO: $LINK<Dark Elves=RACE_Dark_Elves>',
    '^HIT POINT BONUS: 0',
    '^ABILITIES:',
    '^*$LINK<Summons=GCON_Summoning> $LINK<Colonizer=PRTO_Colonizer>'
  ];
  const afterOverviewLines = beforeOverviewLines.slice();
  afterOverviewLines[7] = '^*$LINK<Summons=GCON_Summoning> $LINK<Colonizer=PRTO_Colonizer>z';
  const initial = [
    '#PRTO_Bamboo_Warrior',
    ...beforeOverviewLines,
    '',
    '#TECH_Blood_Cult',
    '^This tech is Faction-specific and not researchable.',
    ''
  ].join('\n');
  fs.writeFileSync(civPath, Buffer.from(initial, 'latin1'));

  const tabs = {
    units: {
      title: 'Units',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'PRTO_Bamboo_Warrior',
          civilopediaSection1: afterOverviewLines.join('\n'),
          originalCivilopediaSection1: beforeOverviewLines.join('\n'),
          civilopediaSection2: '',
          originalCivilopediaSection2: '',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ]
    }
  };

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs,
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  const delRows = res.diffRows.filter((row) => row.kind === 'del');
  const addRows = res.diffRows.filter((row) => row.kind === 'add');
  assert.equal(delRows.length, 1);
  assert.equal(addRows.length, 1);
  assert.equal(delRows[0].text, beforeOverviewLines[7]);
  assert.equal(addRows[0].text, afterOverviewLines[7]);
  assert.equal(delRows.some((row) => /TECH_Blood_Cult/i.test(row.text)), false);
});

test('previewFileDiff does not remove duplicate unrelated sections when editing one entry', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  const initial = [
    '#PRTO_Bamboo_Warrior',
    '^This unit is currently unavailable.',
    '',
    '#PRTO_Bamboo_Warrior',
    '^This unit is currently unavailable.',
    '',
    '#TECH_Blood_Cult',
    '^This tech is Faction-specific and not researchable.',
    '',
    '#TECH_Blood_Cult',
    '^This tech is Faction-specific and not researchable.',
    '',
    '#DESC_BLDG_ALTAR_OF_KHAZ',
    'Old text',
    ''
  ].join('\n');
  fs.writeFileSync(civPath, Buffer.from(initial, 'latin1'));

  const tabs = {
    improvements: {
      title: 'Improvements',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'BLDG_ALTAR_OF_KHAZ',
          civilopediaSection1: '',
          originalCivilopediaSection1: '',
          civilopediaSection2: 'sdfsdfsdfds',
          originalCivilopediaSection2: 'Old text',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ]
    }
  };

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs,
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  const delRows = res.diffRows.filter((row) => row.kind === 'del');
  const addRows = res.diffRows.filter((row) => row.kind === 'add');
  assert.ok(delRows.some((row) => row.text === 'Old text'));
  assert.ok(addRows.some((row) => row.text === 'sdfsdfsdfds'));
  assert.equal(delRows.some((row) => /Bamboo_Warrior|Blood_Cult/i.test(row.text)), false);
  assert.equal(addRows.some((row) => /Bamboo_Warrior|Blood_Cult/i.test(row.text)), false);
});

test('previewFileDiff does not trim untouched trailing spaces in Civilopedia lines', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  seedDefaultFiles(root);

  const civPath = path.join(textDir, 'Civilopedia.txt');
  const initial = [
    '#RACE_ENGLISH',
    '^In this scenario the nations are strong.',
    'and New Zealand Army Corps, was often used when referring to troops from both countries. ',
    '',
    '#DESC_RACE_ENGLISH',
    '^',
    ''
  ].join('\n');
  fs.writeFileSync(civPath, Buffer.from(initial, 'latin1'));

  const tabs = {
    civilizations: {
      title: 'Civs',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'RACE_ENGLISH',
          civilopediaSection1: [
            '^In CHANGE HERE this scenario the nations are strong.',
            'and New Zealand Army Corps, was often used when referring to troops from both countries. '
          ].join('\n'),
          originalCivilopediaSection1: [
            '^In this scenario the nations are strong.',
            'and New Zealand Army Corps, was often used when referring to troops from both countries. '
          ].join('\n'),
          civilopediaSection2: '^',
          originalCivilopediaSection2: '^',
          iconPaths: [],
          originalIconPaths: [],
          racePaths: [],
          originalRacePaths: [],
          animationName: '',
          originalAnimationName: '',
          biqFields: []
        }
      ],
      sourceDetails: {
        civilopediaScenario: civPath
      }
    }
  };

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs,
    targetPath: civPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  const delRows = res.diffRows.filter((row) => row.kind === 'del');
  const addRows = res.diffRows.filter((row) => row.kind === 'add');
  assert.equal(delRows.length, 1);
  assert.equal(addRows.length, 1);
  assert.equal(delRows[0].text, '^In this scenario the nations are strong.');
  assert.equal(addRows[0].text, '^In CHANGE HERE this scenario the nations are strong.');
});

test('previewFileDiff for new scenario diplomacy target shows full-file additions', () => {
  const root = mkTmpDir();
  const civ3 = mkTmpDir();
  const scenario = mkTmpDir();
  const conquestsTextDir = path.join(civ3, 'Conquests', 'Text');
  const scenarioTextDir = path.join(scenario, 'Text');
  fs.mkdirSync(conquestsTextDir, { recursive: true });
  fs.mkdirSync(scenarioTextDir, { recursive: true });
  seedDefaultFiles(root);

  const sourceDiplomacyPath = path.join(conquestsTextDir, 'diplomacy.txt');
  const scenarioDiplomacyPath = path.join(scenarioTextDir, 'diplomacy.txt');
  const source = [
    '; source fixture',
    '#AIFIRSTCONTACT',
    '#CIV 1',
    '#POWER 0',
    '#MOOD 0',
    '#RANDOM 1',
    '"Contact 0 old"',
    '',
    '#AIFIRSTDEAL',
    '#CIV 1',
    '#POWER 0',
    '#MOOD 0',
    '#RANDOM 1',
    '"Deal 0 old"',
    '',
    '#AIDEMANDTRIBUTE',
    '#CIV 1',
    '#POWER 0',
    '#MOOD 0',
    '#RANDOM 3',
    '"Unrelated text kept."',
    ''
  ].join('\n');
  fs.writeFileSync(sourceDiplomacyPath, Buffer.from(source, 'latin1'));
  assert.equal(fs.existsSync(scenarioDiplomacyPath), false);

  const tabs = {
    civilizations: {
      title: 'Civilizations',
      type: 'reference',
      entries: [],
      diplomacySlots: [
        {
          index: 0,
          firstContact: 'Contact 0 new',
          originalFirstContact: 'Contact 0 old',
          firstDeal: 'Deal 0 old',
          originalFirstDeal: 'Deal 0 old'
        }
      ],
      sourceDetails: {
        diplomacyScenarioWrite: scenarioDiplomacyPath,
        diplomacyActive: sourceDiplomacyPath
      }
    }
  };

  const res = previewFileDiff({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: civ3,
    scenarioPath: scenario,
    tabs,
    targetPath: scenarioDiplomacyPath
  });

  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  assert.equal(res.kind, 'diplomacy');
  assert.equal(res.exists, false);
  const addRows = res.diffRows.filter((row) => row.kind === 'add');
  assert.equal(res.diffRows.some((row) => row.kind === 'del'), false);
  assert.ok(addRows.some((row) => row.text === '"Contact 0 new"'));
  assert.ok(addRows.some((row) => row.text === '#AIDEMANDTRIBUTE'));
});
