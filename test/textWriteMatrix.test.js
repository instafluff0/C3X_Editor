const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  saveBundle,
  buildReferenceTabs,
  buildScenarioCivilopediaEditResult,
  buildScenarioPediaIconsEditResult,
  parseCivilopediaDocumentWithOrder,
  parsePediaIconsDocumentWithOrder
} = require('../src/configCore');
const { decodePcx, encodePcx } = require('../src/artPreview');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-text-matrix-'));
}

function encodeTruecolorPcx({ width, height, rgbAt }) {
  const bytesPerLine = width % 2 === 0 ? width : width + 1;
  const header = Buffer.alloc(128, 0);
  header[0] = 10;
  header[1] = 5;
  header[2] = 1;
  header[3] = 8;
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(width - 1, 8);
  header.writeUInt16LE(height - 1, 10);
  header.writeUInt16LE(72, 12);
  header.writeUInt16LE(72, 14);
  header[65] = 3;
  header.writeUInt16LE(bytesPerLine, 66);
  header.writeUInt16LE(1, 68);
  const body = [];
  const emit = (value) => {
    const v = value & 0xff;
    if (v >= 0xc0) body.push(0xc1, v);
    else body.push(v);
  };
  for (let y = 0; y < height; y += 1) {
    for (let plane = 0; plane < 3; plane += 1) {
      for (let x = 0; x < bytesPerLine; x += 1) {
        const rgb = x < width ? rgbAt(x, y) : [0, 0, 0];
        emit(rgb[plane]);
      }
    }
  }
  return Buffer.concat([header, Buffer.from(body)]);
}

function docTextByKey(doc, key) {
  const upper = String(key || '').trim().toUpperCase();
  const sec = doc.sections[upper];
  if (!sec || !Array.isArray(sec.rawLines)) return '';
  return sec.rawLines.join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function normPediaLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, '/'));
}

function setupScenarioTextFiles() {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const civilopediaPath = path.join(textDir, 'Civilopedia.txt');
  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');

  const civilopedia = [
    '#RACE_TEST_CIV',
    'Original civ overview line.',
    '',
    '#DESC_RACE_TEST_CIV',
    'Original civ description.',
    '',
    '#TECH_TEST_TECH',
    'Original tech overview.',
    '',
    '#DESC_TECH_TEST_TECH',
    'Original tech description.',
    '',
    '#GOOD_TEST_RESOURCE',
    'Original resource overview.',
    '',
    '#DESC_GOOD_TEST_RESOURCE',
    'Original resource description.',
    '',
    '#BLDG_TEST_IMPROVEMENT',
    'Original improvement overview.',
    '',
    '#DESC_BLDG_TEST_IMPROVEMENT',
    'Original improvement description.',
    '',
    '#GOVT_TEST_GOV',
    'Original government overview.',
    '',
    '#DESC_GOVT_TEST_GOV',
    'Original government description.',
    '',
    '#PRTO_TEST_UNIT',
    'Original unit overview.',
    '',
    '#DESC_PRTO_TEST_UNIT',
    'Original unit description.',
    '',
    '#GCON_TEST_CONCEPT',
    'Original concept overview.',
    '',
    '#DESC_GCON_TEST_CONCEPT',
    'Original concept description.',
    '',
    '#TERR_TEST_TERRAIN',
    'Original terrain overview.',
    '',
    '#DESC_TERR_TEST_TERRAIN',
    'Original terrain description.',
    '',
    '#TFRM_TEST_WORK',
    'Original worker action overview.',
    '',
    '#DESC_TFRM_TEST_WORK',
    'Original worker action description.',
    '',
    '#RACE_UNTOUCHED',
    'founded Tenochtitl\u00e1n',
    '',
    '#DESC_RACE_UNTOUCHED',
    'Unchanged long description.',
    ''
  ].join('\n');

  const pediaIcons = [
    '#ICON_RACE_TEST_CIV',
    'art\\civilopedia\\icons\\races\\test-civ-large.pcx',
    'art\\civilopedia\\icons\\races\\test-civ-small.pcx',
    '',
    '#ICON_GOOD_TEST_RESOURCE',
    'art\\civilopedia\\icons\\resources\\resource-large.pcx',
    'art\\civilopedia\\icons\\resources\\resource-small.pcx',
    '',
    '#ICON_BLDG_TEST_IMPROVEMENT',
    'SINGLE',
    '121',
    'art\\civilopedia\\icons\\buildings\\impr-large.pcx',
    'art\\civilopedia\\icons\\buildings\\impr-small.pcx',
    '',
    '#TECH_TEST_TECH',
    'art\\civilopedia\\icons\\tech chooser\\tech-small.pcx',
    '',
    '#TECH_TEST_TECH_LARGE',
    'art\\civilopedia\\icons\\tech chooser\\tech-large.pcx',
    '',
    '#ANIMNAME_PRTO_TEST_UNIT',
    'TestUnit',
    '',
    '#ICON_RACE_UNTOUCHED',
    'art\\civilopedia\\icons\\races\\untouched-large.pcx',
    'art\\civilopedia\\icons\\races\\untouched-small.pcx',
    ''
  ].join('\n');

  fs.writeFileSync(civilopediaPath, Buffer.from(civilopedia, 'latin1'));
  fs.writeFileSync(pediaIconsPath, Buffer.from(pediaIcons, 'latin1'));

  return { root, scenario, civilopediaPath, pediaIconsPath };
}

function makeEntry(civilopediaKey, overrides = {}) {
  return {
    civilopediaKey,
    civilopediaSection1: `Updated ${civilopediaKey} overview`,
    originalCivilopediaSection1: `Original ${civilopediaKey} overview`,
    civilopediaSection2: `Updated ${civilopediaKey} description`,
    originalCivilopediaSection2: `Original ${civilopediaKey} description`,
    iconPaths: [],
    originalIconPaths: [],
    racePaths: [],
    originalRacePaths: [],
    animationName: '',
    originalAnimationName: '',
    biqFields: [],
    ...overrides
  };
}

test('text write matrix: all supported Civilopedia/PediaIcons edit kinds persist and untouched sections remain valid', () => {
  const { root, scenario, civilopediaPath, pediaIconsPath } = setupScenarioTextFiles();

  const tabs = {
    civilizations: {
      title: 'Civs',
      type: 'reference',
      entries: [
        makeEntry('RACE_TEST_CIV', {
          civilopediaSection1: 'Updated civ overview text.',
          originalCivilopediaSection1: 'Original civ overview line.',
          civilopediaSection2: 'Updated civ description text.',
          originalCivilopediaSection2: 'Original civ description.',
          iconPaths: [
            'art\\civilopedia\\icons\\races\\new-civ-large.pcx',
            'art\\civilopedia\\icons\\races\\new-civ-small.pcx'
          ],
          originalIconPaths: [
            'art\\civilopedia\\icons\\races\\test-civ-large.pcx',
            'art\\civilopedia\\icons\\races\\test-civ-small.pcx'
          ]
        })
      ],
      sourceDetails: {
        civilopediaScenario: civilopediaPath,
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    technologies: {
      title: 'Techs',
      type: 'reference',
      entries: [
        makeEntry('TECH_TEST_TECH', {
          civilopediaSection1: 'Updated tech overview text.',
          originalCivilopediaSection1: 'Original tech overview.',
          civilopediaSection2: 'Updated tech description text.',
          originalCivilopediaSection2: 'Original tech description.',
          iconPaths: [
            'art\\civilopedia\\icons\\tech chooser\\new-tech-large.pcx',
            'art\\civilopedia\\icons\\tech chooser\\new-tech-small.pcx'
          ],
          originalIconPaths: [
            'art\\civilopedia\\icons\\tech chooser\\tech-large.pcx',
            'art\\civilopedia\\icons\\tech chooser\\tech-small.pcx'
          ]
        })
      ]
    },
    resources: {
      title: 'Resources',
      type: 'reference',
      entries: [
        makeEntry('GOOD_TEST_RESOURCE', {
          civilopediaSection1: 'Updated resource overview text.',
          originalCivilopediaSection1: 'Original resource overview.',
          civilopediaSection2: 'Updated resource description text.',
          originalCivilopediaSection2: 'Original resource description.',
          iconPaths: [
            'art\\civilopedia\\icons\\resources\\new-resource-large.pcx',
            'art\\civilopedia\\icons\\resources\\new-resource-small.pcx'
          ],
          originalIconPaths: [
            'art\\civilopedia\\icons\\resources\\resource-large.pcx',
            'art\\civilopedia\\icons\\resources\\resource-small.pcx'
          ]
        })
      ]
    },
    improvements: {
      title: 'Improvements',
      type: 'reference',
      entries: [
        makeEntry('BLDG_TEST_IMPROVEMENT', {
          civilopediaSection1: 'Updated improvement overview text.',
          originalCivilopediaSection1: 'Original improvement overview.',
          civilopediaSection2: 'Updated improvement description text.',
          originalCivilopediaSection2: 'Original improvement description.',
          iconPaths: [
            'art\\civilopedia\\icons\\buildings\\new-impr-large.pcx',
            'art\\civilopedia\\icons\\buildings\\new-impr-small.pcx'
          ],
          originalIconPaths: [
            'art\\civilopedia\\icons\\buildings\\impr-large.pcx',
            'art\\civilopedia\\icons\\buildings\\impr-small.pcx'
          ],
          buildingIconKind: 'SINGLE',
          originalBuildingIconKind: 'SINGLE',
          buildingIconIndex: '121',
          originalBuildingIconIndex: '121'
        })
      ]
    },
    governments: {
      title: 'Governments',
      type: 'reference',
      entries: [
        makeEntry('GOVT_TEST_GOV', {
          civilopediaSection1: 'Updated government overview text.',
          originalCivilopediaSection1: 'Original government overview.',
          civilopediaSection2: 'Updated government description text.',
          originalCivilopediaSection2: 'Original government description.'
        })
      ]
    },
    units: {
      title: 'Units',
      type: 'reference',
      entries: [
        makeEntry('PRTO_TEST_UNIT', {
          civilopediaSection1: 'Updated unit overview text.',
          originalCivilopediaSection1: 'Original unit overview.',
          civilopediaSection2: 'Updated unit description text.',
          originalCivilopediaSection2: 'Original unit description.',
          animationName: 'TestUnitNew',
          originalAnimationName: 'TestUnit',
          unitIniEditor: {}
        })
      ]
    },
    gameConcepts: {
      title: 'Game Concepts',
      type: 'reference',
      entries: [
        makeEntry('GCON_TEST_CONCEPT', {
          civilopediaSection1: 'Updated concept overview text.',
          originalCivilopediaSection1: 'Original concept overview.',
          civilopediaSection2: 'Updated concept description text.',
          originalCivilopediaSection2: 'Original concept description.'
        })
      ]
    },
    terrainPedia: {
      title: 'Terrain',
      type: 'reference',
      entries: [
        makeEntry('TERR_TEST_TERRAIN', {
          civilopediaSection1: 'Updated terrain overview text.',
          originalCivilopediaSection1: 'Original terrain overview.',
          civilopediaSection2: 'Updated terrain description text.',
          originalCivilopediaSection2: 'Original terrain description.'
        })
      ]
    },
    workerActions: {
      title: 'Worker Actions',
      type: 'reference',
      entries: [
        makeEntry('TFRM_TEST_WORK', {
          civilopediaSection1: 'Updated worker overview text.',
          originalCivilopediaSection1: 'Original worker action overview.',
          civilopediaSection2: 'Updated worker description text.',
          originalCivilopediaSection2: 'Original worker action description.'
        })
      ]
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const civilopediaSaved = fs.readFileSync(civilopediaPath).toString('latin1');
  const pediaSaved = fs.readFileSync(pediaIconsPath).toString('latin1');
  const civDoc = parseCivilopediaDocumentWithOrder(civilopediaSaved);
  const pediaDoc = parsePediaIconsDocumentWithOrder(pediaSaved);

  assert.match(docTextByKey(civDoc, 'RACE_TEST_CIV'), /Updated civ overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_RACE_TEST_CIV'), /Updated civ description text\./);
  assert.match(docTextByKey(civDoc, 'TECH_TEST_TECH'), /Updated tech overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_TECH_TEST_TECH'), /Updated tech description text\./);
  assert.match(docTextByKey(civDoc, 'GOOD_TEST_RESOURCE'), /Updated resource overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_GOOD_TEST_RESOURCE'), /Updated resource description text\./);
  assert.match(docTextByKey(civDoc, 'BLDG_TEST_IMPROVEMENT'), /Updated improvement overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_BLDG_TEST_IMPROVEMENT'), /Updated improvement description text\./);
  assert.match(docTextByKey(civDoc, 'GOVT_TEST_GOV'), /Updated government overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_GOVT_TEST_GOV'), /Updated government description text\./);
  assert.match(docTextByKey(civDoc, 'PRTO_TEST_UNIT'), /Updated unit overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_PRTO_TEST_UNIT'), /Updated unit description text\./);
  assert.match(docTextByKey(civDoc, 'GCON_TEST_CONCEPT'), /Updated concept overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_GCON_TEST_CONCEPT'), /Updated concept description text\./);
  assert.match(docTextByKey(civDoc, 'TERR_TEST_TERRAIN'), /Updated terrain overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_TERR_TEST_TERRAIN'), /Updated terrain description text\./);
  assert.match(docTextByKey(civDoc, 'TFRM_TEST_WORK'), /Updated worker overview text\./);
  assert.match(docTextByKey(civDoc, 'DESC_TFRM_TEST_WORK'), /Updated worker description text\./);

  assert.match(docTextByKey(civDoc, 'RACE_UNTOUCHED'), /founded Tenochtitl\u00e1n/);
  assert.match(docTextByKey(civDoc, 'DESC_RACE_UNTOUCHED'), /Unchanged long description\./);

  assert.deepEqual(normPediaLines(pediaDoc.blocks.TECH_TEST_TECH), ['art/civilopedia/icons/tech chooser/new-tech-small.pcx']);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.TECH_TEST_TECH_LARGE), ['art/civilopedia/icons/tech chooser/new-tech-large.pcx']);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ICON_GOOD_TEST_RESOURCE), [
    'art/civilopedia/icons/resources/new-resource-large.pcx',
    'art/civilopedia/icons/resources/new-resource-small.pcx'
  ]);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ICON_BLDG_TEST_IMPROVEMENT), [
    'SINGLE',
    '121',
    'art/civilopedia/icons/buildings/new-impr-large.pcx',
    'art/civilopedia/icons/buildings/new-impr-small.pcx'
  ]);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ICON_RACE_TEST_CIV), [
    'art/civilopedia/icons/races/new-civ-large.pcx',
    'art/civilopedia/icons/races/new-civ-small.pcx'
  ]);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ANIMNAME_PRTO_TEST_UNIT), ['TestUnitNew']);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ICON_RACE_UNTOUCHED), [
    'art/civilopedia/icons/races/untouched-large.pcx',
    'art/civilopedia/icons/races/untouched-small.pcx'
  ]);
});

test('large Civilopedia file: single-entry edit keeps all other entries parseable and unchanged', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  const civilopediaPath = path.join(textDir, 'Civilopedia.txt');

  const sections = [];
  for (let i = 0; i < 220; i += 1) {
    const key = `GCON_BULK_${i}`;
    sections.push(`#${key}`);
    sections.push(`Overview ${i}`);
    sections.push('');
    sections.push(`#DESC_${key}`);
    sections.push(`Description ${i}`);
    sections.push('');
  }
  fs.writeFileSync(civilopediaPath, Buffer.from(sections.join('\n'), 'latin1'));

  const tabs = {
    civilizations: {
      title: 'Civs',
      type: 'reference',
      entries: [],
      sourceDetails: {
        civilopediaScenario: civilopediaPath
      }
    },
    gameConcepts: {
      title: 'Game Concepts',
      type: 'reference',
      entries: [
        {
          civilopediaKey: 'GCON_BULK_111',
          civilopediaSection1: 'Overview 111 edited',
          originalCivilopediaSection1: 'Overview 111',
          civilopediaSection2: 'Description 111 edited',
          originalCivilopediaSection2: 'Description 111',
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

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: '',
    scenarioPath: scenario,
    tabs
  });
  assert.equal(result.ok, true, String(result.error || 'save failed'));

  const saved = fs.readFileSync(civilopediaPath).toString('latin1');
  const doc = parseCivilopediaDocumentWithOrder(saved);
  assert.equal(doc.order.length, 440);
  assert.equal(docTextByKey(doc, 'GCON_BULK_0'), 'Overview 0');
  assert.equal(docTextByKey(doc, 'DESC_GCON_BULK_0'), 'Description 0');
  assert.equal(docTextByKey(doc, 'GCON_BULK_111'), 'Overview 111 edited');
  assert.equal(docTextByKey(doc, 'DESC_GCON_BULK_111'), 'Description 111 edited');
  assert.equal(docTextByKey(doc, 'GCON_BULK_219'), 'Overview 219');
  assert.equal(docTextByKey(doc, 'DESC_GCON_BULK_219'), 'Description 219');
});

test('new Civilopedia and PediaIcons entries insert before terminal markers', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  const civilopediaPath = path.join(textDir, 'Civilopedia.txt');
  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');

  fs.writeFileSync(civilopediaPath, [
    '#GCON_EXISTING',
    'Existing text.',
    '#EOF',
    '#GCON_AFTER_EOF',
    'Legacy accidental trailing text.',
    ''
  ].join('\n'), 'latin1');
  fs.writeFileSync(pediaIconsPath, [
    '#ICON_BLDG_EXISTING',
    'SINGLE',
    '10',
    'Art\\Civilopedia\\Icons\\Buildings\\ExistingL.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\ExistingS.pcx',
    '#END CIVILOPEDIA ART',
    '#ICON_BLDG_AFTER_END',
    'Art\\Civilopedia\\Icons\\Buildings\\AfterEndL.pcx',
    ''
  ].join('\n'), 'latin1');

  const civResult = buildScenarioCivilopediaEditResult({
    targetPath: civilopediaPath,
    edits: [{ sectionKey: 'BLDG_RESIN_SHOP', value: 'Resin Shop\n^New entry.' }]
  });
  assert.equal(civResult.ok, true, String(civResult.error || 'civilopedia edit failed'));
  const civSaved = civResult.buffer.toString('latin1');
  assert.equal((civSaved.match(/^#EOF$/gm) || []).length, 1);
  assert.ok(civSaved.indexOf('#BLDG_RESIN_SHOP') < civSaved.indexOf('#EOF'));
  assert.ok(civSaved.indexOf('#GCON_AFTER_EOF') < civSaved.indexOf('#EOF'));
  assert.ok(civSaved.trimEnd().endsWith('#EOF'));

  const pediaResult = buildScenarioPediaIconsEditResult({
    targetPath: pediaIconsPath,
    edits: [{
      blockKey: 'ICON_BLDG_RESIN_SHOP',
      lines: ['SINGLE', '243', 'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx', 'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx']
    }]
  });
  assert.equal(pediaResult.ok, true, String(pediaResult.error || 'pedia edit failed'));
  const pediaSaved = pediaResult.buffer.toString('latin1');
  assert.equal((pediaSaved.match(/^#END CIVILOPEDIA ART$/gm) || []).length, 1);
  assert.ok(pediaSaved.indexOf('#ICON_BLDG_RESIN_SHOP') < pediaSaved.indexOf('#END CIVILOPEDIA ART'));
  assert.ok(pediaSaved.indexOf('#ICON_BLDG_AFTER_END') > pediaSaved.indexOf('#END CIVILOPEDIA ART'));
});

test('new mixed-case Civilopedia section keeps user-entered header and terminal EOF', () => {
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  const civilopediaPath = path.join(textDir, 'Civilopedia.txt');
  fs.writeFileSync(civilopediaPath, [
    '#GCON_EXISTING',
    'Existing text.',
    '#EOF',
    ''
  ].join('\n'), 'latin1');

  const result = buildScenarioCivilopediaEditResult({
    targetPath: civilopediaPath,
    edits: [{
      sectionKey: 'BLDG_RESIN_SHOP',
      headerKey: 'BLDG_Resin_Shop',
      value: 'Here is the Resin shop.'
    }]
  });

  assert.equal(result.ok, true, String(result.error || 'civilopedia edit failed'));
  const saved = result.buffer.toString('latin1');
  assert.equal(saved.includes('#BLDG_Resin_Shop\nHere is the Resin shop.'), true);
  assert.equal(saved.includes('#BLDG_RESIN_SHOP\nHere is the Resin shop.'), false);
  assert.equal((saved.match(/^#EOF$/gm) || []).length, 1);
  assert.ok(saved.indexOf('#BLDG_Resin_Shop') < saved.indexOf('#EOF'));
  assert.ok(saved.trimEnd().endsWith('#EOF'));
});

test('building PediaIcons structured blocks load metadata and save complete Resin Shop small wonder art', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(path.join(textDir, 'Civilopedia.txt'), [
    '; Small Wonders',
    '#BLDG_RESIN_SHOP',
    'Resin Shop',
    '^Can be purchased from $LINK<Resin Shop=BLDG_RESIN_SHOP>',
    ''
  ].join('\n'), 'latin1');
  fs.writeFileSync(pediaIconsPath, [
    '#ICON_BLDG_RESIN_SHOP',
    'SINGLE',
    '243',
    'Art\\Civilopedia\\Icons\\Buildings\\ResinShopL.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\TinctureShopS.pcx',
    '#WON_SPLASH_BLDG_RESIN_SHOP',
    'Art\\Civilopedia\\Icons\\Buildings\\w_ResinShop.pcx',
    '#END CIVILOPEDIA ART',
    ''
  ].join('\n'), 'latin1');

  const tabs = buildReferenceTabs(root, { mode: 'scenario', civ3Path: root, scenarioPath: scenario });
  const resin = tabs.improvements.entries.find((entry) => entry.civilopediaKey === 'BLDG_RESIN_SHOP');
  assert.ok(resin, 'expected Resin Shop improvement entry');
  assert.deepEqual(resin.iconPaths, [
    'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
    'Art/Civilopedia/Icons/Buildings/TinctureShopS.pcx'
  ]);
  assert.equal(resin.buildingIconKind, 'SINGLE');
  assert.equal(resin.buildingIconIndex, '243');
  assert.equal(resin.wonderSplashPath, 'Art/Civilopedia/Icons/Buildings/w_ResinShop.pcx');

  const unchanged = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs: {
      civilizations: { sourceDetails: { pediaIconsScenarioWrite: pediaIconsPath } },
      improvements: { entries: [resin] }
    }
  });
  assert.equal(unchanged.ok, true, String(unchanged.error || 'unchanged save failed'));
  assert.equal((unchanged.saveReport || []).some((row) => /PediaIcons\.txt$/i.test(String(row.path || ''))), false);

  const edited = {
    ...JSON.parse(JSON.stringify(resin)),
    iconPaths: [
      'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
      'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
    ],
    originalIconPaths: [
      'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
      'Art/Civilopedia/Icons/Buildings/TinctureShopS.pcx'
    ],
    wonderSplashPath: 'Art/Civilopedia/Icons/Buildings/w_ResinShopNew.pcx',
    originalWonderSplashPath: 'Art/Civilopedia/Icons/Buildings/w_ResinShop.pcx'
  };
  const changed = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs: {
      civilizations: { sourceDetails: { pediaIconsScenarioWrite: pediaIconsPath } },
      improvements: { entries: [edited] }
    }
  });
  assert.equal(changed.ok, true, String(changed.error || 'changed save failed'));
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  const pediaDoc = parsePediaIconsDocumentWithOrder(saved);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ICON_BLDG_RESIN_SHOP), [
    'SINGLE',
    '243',
    'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
    'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
  ]);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.WON_SPLASH_BLDG_RESIN_SHOP), [
    'Art/Civilopedia/Icons/Buildings/w_ResinShopNew.pcx'
  ]);

  const reloaded = buildReferenceTabs(root, { mode: 'scenario', civ3Path: root, scenarioPath: scenario });
  const reloadedResin = reloaded.improvements.entries.find((entry) => entry.civilopediaKey === 'BLDG_RESIN_SHOP');
  assert.deepEqual(reloadedResin.iconPaths, [
    'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
    'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
  ]);
});

test('building PediaIcons ERA blocks preserve repeated positional slots on load and save', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(path.join(textDir, 'Civilopedia.txt'), [
    '; City Improvements',
    '#BLDG_GRANARY',
    'Granary',
    ''
  ].join('\n'), 'latin1');
  fs.writeFileSync(pediaIconsPath, [
    '#ICON_BLDG_GRANARY',
    'ERA',
    '2',
    'Art\\Civilopedia\\Icons\\Buildings\\granaryancrenindlarge.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\granaryancrenindlarge.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\granaryancrenindlarge.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\granarymodlarge.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\granaryancrenindsmall.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\granaryancrenindsmall.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\granaryancrenindsmall.pcx',
    'Art\\Civilopedia\\Icons\\Buildings\\granarymodsmall.pcx',
    ''
  ].join('\n'), 'latin1');

  const tabs = buildReferenceTabs(root, { mode: 'scenario', civ3Path: root, scenarioPath: scenario });
  const granary = tabs.improvements.entries.find((entry) => entry.civilopediaKey === 'BLDG_GRANARY');
  assert.ok(granary, 'expected Granary improvement entry');
  assert.equal(granary.buildingIconKind, 'ERA');
  assert.equal(granary.buildingIconIndex, '2');
  assert.deepEqual(granary.iconPaths, [
    'Art/Civilopedia/Icons/Buildings/granaryancrenindlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granarymodlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindsmall.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindsmall.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindsmall.pcx',
    'Art/Civilopedia/Icons/Buildings/granarymodsmall.pcx'
  ]);

  const edited = {
    ...JSON.parse(JSON.stringify(granary)),
    iconPaths: granary.iconPaths.map((p) => p.replace('granarymodsmall', 'granarymodernsmall')),
    originalIconPaths: granary.originalIconPaths
  };
  const changed = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs: {
      civilizations: { sourceDetails: { pediaIconsScenarioWrite: pediaIconsPath } },
      improvements: { entries: [edited] }
    }
  });
  assert.equal(changed.ok, true, String(changed.error || 'changed save failed'));
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  const pediaDoc = parsePediaIconsDocumentWithOrder(saved);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ICON_BLDG_GRANARY), [
    'ERA',
    '2',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granarymodlarge.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindsmall.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindsmall.pcx',
    'Art/Civilopedia/Icons/Buildings/granaryancrenindsmall.pcx',
    'Art/Civilopedia/Icons/Buildings/granarymodernsmall.pcx'
  ]);
});

test('scenario save localizes uploaded improvement art into building icon and wonder splash folders', () => {
  const root = mkTmpDir();
  const scenario = mkTmpDir();
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  const largeSource = path.join(external, 'UploadedTempleLarge.pcx');
  const smallSource = path.join(external, 'UploadedTempleSmall.pcx');
  const splashSource = path.join(external, 'UploadedTempleSplash.pcx');
  fs.writeFileSync(largeSource, Buffer.from([1, 2, 3]));
  fs.writeFileSync(smallSource, Buffer.from([4, 5, 6]));
  fs.writeFileSync(splashSource, Buffer.from([7, 8, 9]));
  fs.writeFileSync(path.join(textDir, 'Civilopedia.txt'), [
    '; Small Wonders',
    '#BLDG_UPLOAD_TEMPLE',
    'Upload Temple',
    ''
  ].join('\n'), 'latin1');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');

  const entry = {
    civilopediaKey: 'BLDG_UPLOAD_TEMPLE',
    lookupCivilopediaKey: 'BLDG_UPLOAD_TEMPLE',
    displayCivilopediaKey: 'BLDG_UPLOAD_TEMPLE',
    rawBiqCivilopediaKey: 'BLDG_UPLOAD_TEMPLE',
    linkCivilopediaKey: 'BLDG_UPLOAD_TEMPLE',
    improvementKind: 'small_wonder',
    iconPaths: [largeSource, smallSource],
    originalIconPaths: [],
    buildingIconKind: 'SINGLE',
    originalBuildingIconKind: '',
    buildingIconIndex: '3',
    originalBuildingIconIndex: '',
    wonderSplashPath: splashSource,
    originalWonderSplashPath: ''
  };

  const changed = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs: {
      civilizations: { sourceDetails: { pediaIconsScenarioWrite: pediaIconsPath } },
      improvements: { entries: [entry] }
    }
  });
  assert.equal(changed.ok, true, String(changed.error || 'changed save failed'));
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'UploadedTempleLarge.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'UploadedTempleSmall.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Wonder Splash', 'UploadedTempleSplash.pcx')), true);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  const pediaDoc = parsePediaIconsDocumentWithOrder(saved);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.ICON_BLDG_UPLOAD_TEMPLE), [
    'SINGLE',
    '3',
    'Art/Civilopedia/Icons/Buildings/UploadedTempleLarge.pcx',
    'Art/Civilopedia/Icons/Buildings/UploadedTempleSmall.pcx'
  ]);
  assert.deepEqual(normPediaLines(pediaDoc.blocks.WON_SPLASH_BLDG_UPLOAD_TEMPLE), [
    'Art/Wonder Splash/UploadedTempleSplash.pcx'
  ]);
});

test('buildReferenceTabs preserves raw mixed-case Civilopedia keys for link validation', () => {
  const root = mkTmpDir();
  const textDir = path.join(root, 'Conquests', 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  fs.writeFileSync(path.join(textDir, 'Civilopedia.txt'), [
    '#TECH_The_Wheel',
    'The Wheel',
    '',
    '#GOOD_Horses',
    'Horses',
    '^Requires $LINK<The Wheel=TECH_The_Wheel>.',
    '',
    '#TERR_Grassland',
    'Grassland',
    ''
  ].join('\n'), 'latin1');
  fs.writeFileSync(path.join(textDir, 'PediaIcons.txt'), '', 'latin1');

  const tabs = buildReferenceTabs(root, { mode: 'global', civ3Path: root });
  const wheel = tabs.technologies.entries.find((entry) => entry.lookupCivilopediaKey === 'TECH_THE_WHEEL');
  const horses = tabs.resources.entries.find((entry) => entry.lookupCivilopediaKey === 'GOOD_HORSES');
  const grassland = tabs.terrainPedia.entries.find((entry) => entry.lookupCivilopediaKey === 'TERR_GRASSLAND');

  assert.equal(wheel.civilopediaKey, 'TECH_THE_WHEEL');
  assert.equal(wheel.displayCivilopediaKey, 'TECH_The_Wheel');
  assert.equal(wheel.rawCivilopediaKey, 'TECH_The_Wheel');
  assert.equal(wheel.linkCivilopediaKey, 'TECH_The_Wheel');
  assert.equal(horses.civilopediaKey, 'GOOD_HORSES');
  assert.equal(horses.displayCivilopediaKey, 'GOOD_Horses');
  assert.equal(horses.rawCivilopediaKey, 'GOOD_Horses');
  assert.equal(grassland.rawCivilopediaKey, 'TERR_Grassland');
});

test('buildReferenceTabs displays and projects raw BIQ Civilopedia entry casing', () => {
  const root = mkTmpDir();
  const textDir = path.join(root, 'Conquests', 'Text');
  fs.mkdirSync(textDir, { recursive: true });
  fs.writeFileSync(path.join(textDir, 'Civilopedia.txt'), [
    '#TECH_The_Wheel',
    'The Wheel',
    ''
  ].join('\n'), 'latin1');
  fs.writeFileSync(path.join(textDir, 'PediaIcons.txt'), '', 'latin1');

  const tabs = buildReferenceTabs(root, {
    mode: 'global',
    civ3Path: root,
    biqTab: {
      sections: [{
        code: 'TECH',
        records: [{
          index: 3,
          fields: [
            { key: 'civilopediaentry', value: 'TECH_The_Wheel' },
            { key: 'name', value: 'The Wheel' }
          ]
        }]
      }]
    }
  });

  const wheel = tabs.technologies.entries.find((entry) => entry.lookupCivilopediaKey === 'TECH_THE_WHEEL');
  assert.ok(wheel, 'expected The Wheel technology entry');
  assert.equal(wheel.civilopediaKey, 'TECH_THE_WHEEL');
  assert.equal(wheel.displayCivilopediaKey, 'TECH_The_Wheel');
  assert.equal(wheel.rawBiqCivilopediaKey, 'TECH_The_Wheel');
  assert.equal(wheel.rawCivilopediaKey, 'TECH_The_Wheel');
  assert.equal(wheel.biqFields.find((field) => field.baseKey === 'civilopediaentry').value, 'TECH_The_Wheel');
});

test('scenario save rewrites imported tech icon paths to scenario-root-relative Windows paths', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const sourceScenario = path.join(root, 'Eldorado5');
  const textDir = path.join(scenario, 'Text');
  const sourceArtDir = path.join(sourceScenario, 'Art', 'tech chooser', 'Icons');
  fs.mkdirSync(textDir, { recursive: true });
  fs.mkdirSync(sourceArtDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, Buffer.from([
    '#TECH_003',
    'Art\\tech chooser\\Icons\\old-small.pcx',
    '#TECH_003_LARGE',
    'Art\\tech chooser\\Icons\\old-large.pcx',
    ''
  ].join('\n'), 'latin1'));
  fs.writeFileSync(path.join(sourceArtDir, 'Pirate_Small.pcx'), 'small');
  fs.writeFileSync(path.join(sourceArtDir, 'Pirate_Large.pcx'), 'large');

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    technologies: {
      entries: [{
        civilopediaKey: 'TECH_003',
        isNew: true,
        _importScenarioPath: path.join(root, 'Eldorado5.biq'),
        iconPaths: [
          'Eldorado5/Art/tech chooser/Icons/Pirate_Large.pcx',
          'Eldorado5/Art/tech chooser/Icons/Pirate_Small.pcx'
        ],
        originalIconPaths: [
          'Eldorado5/Art/tech chooser/Icons/Pirate_Large.pcx',
          'Eldorado5/Art/tech chooser/Icons/Pirate_Small.pcx'
        ],
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: [{
        op: 'add',
        newRecordRef: 'TECH_003',
        importArtFrom: path.join(root, 'Eldorado5.biq')
      }]
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#TECH_003\r?\nArt\\tech chooser\\Icons\\Pirate_Small\.pcx/);
  assert.match(saved, /#TECH_003_LARGE\r?\nArt\\tech chooser\\Icons\\Pirate_Large\.pcx/);
  assert.doesNotMatch(saved, /Eldorado5[\\/]/);
  assert.deepEqual(tabs.technologies.entries[0].iconPaths, [
    'Art/tech chooser/Icons/Pirate_Large.pcx',
    'Art/tech chooser/Icons/Pirate_Small.pcx'
  ]);
});

test('scenario save localizes uploaded tech icons into tech chooser folder', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const largeSource = path.join(external, 'UploadedTechLarge.pcx');
  const smallSource = path.join(external, 'UploadedTechSmall.pcx');
  fs.writeFileSync(largeSource, 'large');
  fs.writeFileSync(smallSource, 'small');

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    technologies: {
      entries: [{
        civilopediaKey: 'TECH_UPLOAD',
        iconPaths: [largeSource, smallSource],
        originalIconPaths: [],
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'tech chooser', 'Icons', 'UploadedTechLarge.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'tech chooser', 'Icons', 'UploadedTechSmall.pcx')), true);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#TECH_UPLOAD\r?\nArt\\tech chooser\\Icons\\UploadedTechSmall\.pcx/);
  assert.match(saved, /#TECH_UPLOAD_LARGE\r?\nArt\\tech chooser\\Icons\\UploadedTechLarge\.pcx/);
  assert.deepEqual(tabs.technologies.entries[0].iconPaths, [
    'Art/tech chooser/Icons/UploadedTechLarge.pcx',
    'Art/tech chooser/Icons/UploadedTechSmall.pcx'
  ]);
});

test('scenario save copies pending staged improvement art from visible scenario path source map', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const largeSource = path.join(external, 'statue_of_liberty_lg.pcx');
  fs.writeFileSync(largeSource, 'large');

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_STATUE_OF_LIBERTY',
        iconPaths: ['Art/Civilopedia/Icons/Buildings/statue_of_liberty_lg.pcx'],
        originalIconPaths: [],
        pendingArtSources: {
          'iconPaths:0': largeSource
        },
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: '',
        buildingIconIndex: '',
        originalBuildingIconIndex: '',
        wonderSplashPath: '',
        originalWonderSplashPath: '',
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'statue_of_liberty_lg.pcx')), true);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#ICON_BLDG_STATUE_OF_LIBERTY\r?\nSINGLE\r?\nArt\\Civilopedia\\Icons\\Buildings\\statue_of_liberty_lg\.pcx/);
});

test('scenario save converts pending staged improvement RGBA art to right-sized PCX', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const rgba = Buffer.alloc(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i += 1) {
    rgba[i * 4] = 20;
    rgba[i * 4 + 1] = 120;
    rgba[i * 4 + 2] = 220;
    rgba[i * 4 + 3] = 255;
  }

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_STATUE_OF_LIBERTY',
        iconPaths: ['Art/Civilopedia/Icons/Buildings/statue_of_liberty_lg.pcx'],
        originalIconPaths: [],
        pendingArtConversions: {
          'iconPaths:0': {
            sourcePath: '/tmp/statue_of_liberty_lg.png',
            width: 128,
            height: 128,
            rgbaBase64: rgba.toString('base64')
          }
        },
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: '',
        buildingIconIndex: '',
        originalBuildingIconIndex: '',
        wonderSplashPath: '',
        originalWonderSplashPath: '',
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  const pcxPath = path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'statue_of_liberty_lg.pcx');
  assert.equal(fs.existsSync(pcxPath), true);
  const decoded = decodePcx(pcxPath);
  assert.equal(decoded.width, 128);
  assert.equal(decoded.height, 128);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /Art\\Civilopedia\\Icons\\Buildings\\statue_of_liberty_lg\.pcx/);
});

test('scenario save converts pending truecolor PCX art to indexed Civ3 PCX', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const source = path.join(external, 'statue_of_liberty_lg.pcx');
  fs.writeFileSync(source, encodeTruecolorPcx({
    width: 128,
    height: 128,
    rgbAt: (x, y) => [x * 2, y * 2, 120]
  }));

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_STATUE_OF_LIBERTY',
        iconPaths: ['Art/Civilopedia/Icons/Buildings/statue_of_liberty_lg.pcx'],
        originalIconPaths: [],
        pendingArtSources: {
          'iconPaths:0': source
        },
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: '',
        buildingIconIndex: '',
        originalBuildingIconIndex: '',
        wonderSplashPath: '',
        originalWonderSplashPath: '',
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  const pcxPath = path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'statue_of_liberty_lg.pcx');
  const decoded = decodePcx(pcxPath, { returnIndexed: true });
  assert.equal(decoded.width, 128);
  assert.equal(decoded.height, 128);
  assert.ok(decoded.indices instanceof Uint8Array);
  assert.ok(decoded.palette instanceof Uint8Array);
});

test('scenario save copies matching indexed PCX art without re-encoding', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const source = path.join(external, 'statue_of_liberty.pcx');
  const indices = new Uint8Array(128 * 128);
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i += 1) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = (i * 3) % 256;
    palette[i * 3 + 2] = (255 - i);
  }
  for (let i = 0; i < indices.length; i += 1) indices[i] = i % 254;
  const sourceBytes = encodePcx(indices, palette, 128, 128);
  fs.writeFileSync(source, sourceBytes);

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_STATUE_OF_LIBERTY',
        iconPaths: ['Art/Civilopedia/Icons/Buildings/statue_of_liberty.pcx'],
        originalIconPaths: [],
        pendingArtSources: {
          'iconPaths:0': source
        },
        pendingArtConversions: {
          'iconPaths:0': {
            sourcePath: source,
            width: 128,
            height: 128,
            rgbaBase64: Buffer.alloc(128 * 128 * 4, 255).toString('base64')
          }
        },
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: '',
        buildingIconIndex: '',
        originalBuildingIconIndex: '',
        wonderSplashPath: '',
        originalWonderSplashPath: '',
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  const pcxPath = path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'statue_of_liberty.pcx');
  assert.deepEqual(fs.readFileSync(pcxPath), sourceBytes);
});

test('scenario save resizes pending indexed PCX art to slot dimensions', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const source = path.join(external, 'statue_source.pcx');
  const indices = new Uint8Array(128 * 128);
  indices.fill(12);
  const palette = new Uint8Array(768);
  palette[12 * 3] = 10;
  palette[12 * 3 + 1] = 140;
  palette[12 * 3 + 2] = 80;
  fs.writeFileSync(source, encodePcx(indices, palette, 128, 128));

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_STATUE_OF_LIBERTY',
        iconPaths: [
          'Art/Civilopedia/Icons/Buildings/statue_large.pcx',
          'Art/Civilopedia/Icons/Buildings/statue_small.pcx'
        ],
        originalIconPaths: [],
        pendingArtSources: {
          'iconPaths:1': source
        },
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: '',
        buildingIconIndex: '',
        originalBuildingIconIndex: '',
        wonderSplashPath: '',
        originalWonderSplashPath: '',
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  const pcxPath = path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'statue_small.pcx');
  const decoded = decodePcx(pcxPath, { returnIndexed: true });
  assert.equal(decoded.width, 32);
  assert.equal(decoded.height, 32);
});

test('scenario save localizes uploaded unit Civilopedia icons into unit icon folder', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const largeSource = path.join(external, 'UploadedUnitLarge.pcx');
  const smallSource = path.join(external, 'UploadedUnitSmall.pcx');
  fs.writeFileSync(largeSource, 'large');
  fs.writeFileSync(smallSource, 'small');

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    units: {
      entries: [{
        civilopediaKey: 'PRTO_UPLOAD_UNIT',
        iconPaths: [largeSource, smallSource],
        originalIconPaths: [],
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Units', 'UploadedUnitLarge.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Units', 'UploadedUnitSmall.pcx')), true);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#ICON_PRTO_UPLOAD_UNIT\r?\nArt\\Civilopedia\\Icons\\Units\\UploadedUnitLarge\.pcx\r?\nArt\\Civilopedia\\Icons\\Units\\UploadedUnitSmall\.pcx/);
  assert.deepEqual(tabs.units.entries[0].iconPaths, [
    'Art/Civilopedia/Icons/Units/UploadedUnitLarge.pcx',
    'Art/Civilopedia/Icons/Units/UploadedUnitSmall.pcx'
  ]);
});

test('scenario save localizes uploaded civilization icon and portrait art into civ folders', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const largeSource = path.join(external, 'UploadedCivLarge.pcx');
  const smallSource = path.join(external, 'UploadedCivSmall.pcx');
  const leaderheadSource = path.join(external, 'UploadedLeader.pcx');
  const advisorSource = path.join(external, 'UploadedAdvisorAll.pcx');
  fs.writeFileSync(largeSource, 'large');
  fs.writeFileSync(smallSource, 'small');
  fs.writeFileSync(leaderheadSource, 'leader');
  fs.writeFileSync(advisorSource, 'advisor');

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      },
      entries: [{
        civilopediaKey: 'RACE_UPLOAD_CIV',
        iconPaths: [largeSource, smallSource],
        originalIconPaths: [],
        racePaths: [leaderheadSource, advisorSource],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Races', 'UploadedCivLarge.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Races', 'UploadedCivSmall.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Leaderheads', 'UploadedLeader.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Advisors', 'UploadedAdvisorAll.pcx')), true);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#ICON_RACE_UPLOAD_CIV\r?\nArt\\Civilopedia\\Icons\\Races\\UploadedCivLarge\.pcx\r?\nArt\\Civilopedia\\Icons\\Races\\UploadedCivSmall\.pcx/);
  assert.match(saved, /#RACE_UPLOAD_CIV\r?\nArt\\Leaderheads\\UploadedLeader\.pcx\r?\nArt\\Advisors\\UploadedAdvisorAll\.pcx/);
  assert.deepEqual(tabs.civilizations.entries[0].iconPaths, [
    'Art/Civilopedia/Icons/Races/UploadedCivLarge.pcx',
    'Art/Civilopedia/Icons/Races/UploadedCivSmall.pcx'
  ]);
  assert.deepEqual(tabs.civilizations.entries[0].racePaths, [
    'Art/Leaderheads/UploadedLeader.pcx',
    'Art/Advisors/UploadedAdvisorAll.pcx'
  ]);
});

test('scenario save localizes uploaded resource icons into resource icon folder', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const largeSource = path.join(external, 'UploadedResourceLarge.pcx');
  const smallSource = path.join(external, 'UploadedResourceSmall.pcx');
  fs.writeFileSync(largeSource, 'large');
  fs.writeFileSync(smallSource, 'small');

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    resources: {
      entries: [{
        civilopediaKey: 'GOOD_UPLOAD_RESOURCE',
        iconPaths: [largeSource, smallSource],
        originalIconPaths: [],
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Resources', 'UploadedResourceLarge.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Resources', 'UploadedResourceSmall.pcx')), true);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#ICON_GOOD_UPLOAD_RESOURCE\r?\nArt\\Civilopedia\\Icons\\Resources\\UploadedResourceLarge\.pcx\r?\nArt\\Civilopedia\\Icons\\Resources\\UploadedResourceSmall\.pcx/);
  assert.deepEqual(tabs.resources.entries[0].iconPaths, [
    'Art/Civilopedia/Icons/Resources/UploadedResourceLarge.pcx',
    'Art/Civilopedia/Icons/Resources/UploadedResourceSmall.pcx'
  ]);
});

test('scenario save localizes uploaded government icons into government icon folder', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const external = mkTmpDir();
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, '', 'latin1');
  const largeSource = path.join(external, 'UploadedGovernmentLarge.pcx');
  const smallSource = path.join(external, 'UploadedGovernmentSmall.pcx');
  fs.writeFileSync(largeSource, 'large');
  fs.writeFileSync(smallSource, 'small');

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      }
    },
    governments: {
      entries: [{
        civilopediaKey: 'GOVT_UPLOAD_GOVERNMENT',
        iconPaths: [largeSource, smallSource],
        originalIconPaths: [],
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Governments', 'UploadedGovernmentLarge.pcx')), true);
  assert.equal(fs.existsSync(path.join(scenario, 'Art', 'Civilopedia', 'Icons', 'Governments', 'UploadedGovernmentSmall.pcx')), true);
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#ICON_GOVT_UPLOAD_GOVERNMENT\r?\nArt\\Civilopedia\\Icons\\Governments\\UploadedGovernmentLarge\.pcx\r?\nArt\\Civilopedia\\Icons\\Governments\\UploadedGovernmentSmall\.pcx/);
  assert.deepEqual(tabs.governments.entries[0].iconPaths, [
    'Art/Civilopedia/Icons/Governments/UploadedGovernmentLarge.pcx',
    'Art/Civilopedia/Icons/Governments/UploadedGovernmentSmall.pcx'
  ]);
});

test('scenario save rewrites imported generic icon and race path blocks to scenario-root-relative Windows paths', () => {
  const root = mkTmpDir();
  const scenario = path.join(root, 'MyScenario');
  const textDir = path.join(scenario, 'Text');
  fs.mkdirSync(textDir, { recursive: true });

  const pediaIconsPath = path.join(textDir, 'PediaIcons.txt');
  fs.writeFileSync(pediaIconsPath, Buffer.from([
    '#ICON_GOOD_TEST_RESOURCE',
    'Art\\Civilopedia\\Icons\\Resources\\old-large.pcx',
    'Art\\Civilopedia\\Icons\\Resources\\old-small.pcx',
    '#ICON_RACE_AMAZONIANS',
    'Art\\Civilopedia\\Icons\\Races\\old-race-large.pcx',
    'Art\\Civilopedia\\Icons\\Races\\old-race-small.pcx',
    '#RACE_AMAZONIANS',
    'Art\\Advisors\\old_all.pcx',
    'Art\\Leaderheads\\old large.pcx',
    ''
  ].join('\n'), 'latin1'));

  const tabs = {
    civilizations: {
      sourceDetails: {
        pediaIconsScenarioWrite: pediaIconsPath
      },
      entries: [{
        civilopediaKey: 'RACE_AMAZONIANS',
        isNew: true,
        _importScenarioPath: path.join(root, 'Eldorado5.biq'),
        iconPaths: [
          'Eldorado5/Art/Civilopedia/Icons/Races/AmazoniansLarge.pcx',
          'Eldorado5/Art/Civilopedia/Icons/Races/AmazoniansSmall.pcx'
        ],
        originalIconPaths: [
          'Eldorado5/Art/Civilopedia/Icons/Races/AmazoniansLarge.pcx',
          'Eldorado5/Art/Civilopedia/Icons/Races/AmazoniansSmall.pcx'
        ],
        racePaths: [
          'Eldorado5/Art/Advisors/amazonians_all.pcx',
          'Eldorado5/Art/Leaderheads/amazonians large.pcx'
        ],
        originalRacePaths: [
          'Eldorado5/Art/Advisors/amazonians_all.pcx',
          'Eldorado5/Art/Leaderheads/amazonians large.pcx'
        ],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    },
    resources: {
      entries: [{
        civilopediaKey: 'GOOD_TEST_RESOURCE',
        isNew: true,
        _importScenarioPath: path.join(root, 'Eldorado5.biq'),
        iconPaths: [
          'Eldorado5/Art/Civilopedia/Icons/Resources/NewLarge.pcx',
          'Eldorado5/Art/Civilopedia/Icons/Resources/NewSmall.pcx'
        ],
        originalIconPaths: [
          'Eldorado5/Art/Civilopedia/Icons/Resources/NewLarge.pcx',
          'Eldorado5/Art/Civilopedia/Icons/Resources/NewSmall.pcx'
        ],
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: '',
        biqFields: []
      }],
      recordOps: []
    }
  };

  const result = saveBundle({
    mode: 'scenario',
    c3xPath: root,
    civ3Path: root,
    scenarioPath: scenario,
    tabs
  });

  assert.equal(result.ok, true, String(result.error || 'save failed'));
  const saved = fs.readFileSync(pediaIconsPath).toString('latin1');
  assert.match(saved, /#ICON_GOOD_TEST_RESOURCE\r?\nArt\\Civilopedia\\Icons\\Resources\\NewLarge\.pcx\r?\nArt\\Civilopedia\\Icons\\Resources\\NewSmall\.pcx/);
  assert.match(saved, /#ICON_RACE_AMAZONIANS\r?\nArt\\Civilopedia\\Icons\\Races\\AmazoniansLarge\.pcx\r?\nArt\\Civilopedia\\Icons\\Races\\AmazoniansSmall\.pcx/);
  assert.match(saved, /#RACE_AMAZONIANS\r?\nArt\\Advisors\\amazonians_all\.pcx\r?\nArt\\Leaderheads\\amazonians large\.pcx/);
  assert.doesNotMatch(saved, /Eldorado5[\\/]/);
  assert.deepEqual(tabs.resources.entries[0].iconPaths, [
    'Art/Civilopedia/Icons/Resources/NewLarge.pcx',
    'Art/Civilopedia/Icons/Resources/NewSmall.pcx'
  ]);
  assert.deepEqual(tabs.civilizations.entries[0].iconPaths, [
    'Art/Civilopedia/Icons/Races/AmazoniansLarge.pcx',
    'Art/Civilopedia/Icons/Races/AmazoniansSmall.pcx'
  ]);
  assert.deepEqual(tabs.civilizations.entries[0].racePaths, [
    'Art/Advisors/amazonians_all.pcx',
    'Art/Leaderheads/amazonians large.pcx'
  ]);
});
