const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectPediaIconsReferenceEdits,
  buildScenarioPediaIconsEditResult
} = require('../src/configCore');

test('collectPediaIconsReferenceEdits writes civ racePaths back to the RACE block', () => {
  const edits = collectPediaIconsReferenceEdits({
    civilizations: {
      entries: [{
        civilopediaKey: 'RACE_AMAZONIANS',
        iconPaths: ['Art/Civilopedia/Icons/Races/AmazoniansLarge.pcx', 'Art/Civilopedia/Icons/Races/AmazoniansSmall.pcx'],
        originalIconPaths: ['Art/Civilopedia/Icons/Races/AmazoniansLarge.pcx', 'Art/Civilopedia/Icons/Races/AmazoniansSmall.pcx'],
        racePaths: ['Art/Advisors/amazonians_all.pcx', 'Art/Leaderheads/amazonians large.pcx'],
        originalRacePaths: ['Art/Advisors/original_all.pcx', 'Art/Leaderheads/original large.pcx'],
        animationName: '',
        originalAnimationName: ''
      }],
      recordOps: []
    }
  });

  assert.deepEqual(edits, [{
    blockKey: 'RACE_AMAZONIANS',
    lines: ['Art/Advisors/amazonians_all.pcx', 'Art/Leaderheads/amazonians large.pcx']
  }]);
});

test('collectPediaIconsReferenceEdits removes stale civ icon and race blocks on delete', () => {
  const edits = collectPediaIconsReferenceEdits({
    civilizations: {
      entries: [],
      recordOps: [{ op: 'delete', recordRef: 'RACE_AMAZONIANS' }]
    }
  });

  assert.deepEqual(edits, [
    { op: 'delete', blockKey: 'ICON_RACE_AMAZONIANS' },
    { op: 'delete', blockKey: 'RACE_AMAZONIANS' }
  ]);
});

test('collectPediaIconsReferenceEdits forces first-save icon writes for imported scenario entries', () => {
  const edits = collectPediaIconsReferenceEdits({
    civilizations: {
      entries: [{
        civilopediaKey: 'RACE_AMAZONIANS',
        isNew: true,
        _importScenarioPath: '/tmp/Tides of Crimson.biq',
        iconPaths: ['Art/Civilopedia/Icons/Races/PYLarge.pcx', 'Art/Civilopedia/Icons/Races/PYSmall.pcx'],
        originalIconPaths: ['Art/Civilopedia/Icons/Races/PYLarge.pcx', 'Art/Civilopedia/Icons/Races/PYSmall.pcx'],
        racePaths: [],
        originalRacePaths: [],
        animationName: '',
        originalAnimationName: ''
      }],
      recordOps: []
    }
  });

  assert.deepEqual(edits, [{
    blockKey: 'ICON_RACE_AMAZONIANS',
    lines: ['Art/Civilopedia/Icons/Races/PYLarge.pcx', 'Art/Civilopedia/Icons/Races/PYSmall.pcx']
  }]);
});

test('buildScenarioPediaIconsEditResult deletes blocks instead of leaving empty headers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-pediaicons-'));
  const targetPath = path.join(dir, 'PediaIcons.txt');
  fs.writeFileSync(targetPath, [
    '#ICON_RACE_AMAZONIANS',
    'Art/Civilopedia/Icons/Races/AmazoniansLarge.pcx',
    'Art/Civilopedia/Icons/Races/AmazoniansSmall.pcx',
    '#RACE_AMAZONIANS',
    'Art/Advisors/amazonians_all.pcx',
    ''
  ].join('\n'), 'latin1');

  const result = buildScenarioPediaIconsEditResult({
    targetPath,
    edits: [
      { op: 'delete', blockKey: 'ICON_RACE_AMAZONIANS' },
      { op: 'delete', blockKey: 'RACE_AMAZONIANS' }
    ]
  });

  assert.equal(result.ok, true);
  const text = result.buffer.toString('latin1');
  assert.equal(text.includes('#ICON_RACE_AMAZONIANS'), false);
  assert.equal(text.includes('#RACE_AMAZONIANS'), false);
});

test('collectPediaIconsReferenceEdits writes complete structured building icon block when large icon changes', () => {
  const edits = collectPediaIconsReferenceEdits({
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_RESIN_SHOP',
        iconPaths: [
          'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
          'Art/Civilopedia/Icons/Buildings/TinctureShopS.pcx'
        ],
        originalIconPaths: [
          'Art/Civilopedia/Icons/Buildings/TinctureShopL.pcx',
          'Art/Civilopedia/Icons/Buildings/TinctureShopS.pcx'
        ],
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: 'SINGLE',
        buildingIconIndex: '243',
        originalBuildingIconIndex: '243',
        wonderSplashPath: '',
        originalWonderSplashPath: ''
      }],
      recordOps: []
    }
  });

  assert.deepEqual(edits, [{
    blockKey: 'ICON_BLDG_RESIN_SHOP',
    lines: [
      'SINGLE',
      '243',
      'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
      'Art/Civilopedia/Icons/Buildings/TinctureShopS.pcx'
    ]
  }]);
});

test('collectPediaIconsReferenceEdits writes complete structured building icon block when small icon changes', () => {
  const edits = collectPediaIconsReferenceEdits({
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_RESIN_SHOP',
        iconPaths: [
          'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
          'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
        ],
        originalIconPaths: [
          'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
          'Art/Civilopedia/Icons/Buildings/TinctureShopS.pcx'
        ],
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: 'SINGLE',
        buildingIconIndex: '243',
        originalBuildingIconIndex: '243',
        wonderSplashPath: '',
        originalWonderSplashPath: ''
      }],
      recordOps: []
    }
  });

  assert.deepEqual(edits, [{
    blockKey: 'ICON_BLDG_RESIN_SHOP',
    lines: [
      'SINGLE',
      '243',
      'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
      'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
    ]
  }]);
});

test('collectPediaIconsReferenceEdits preserves user-entered building key casing on upserted blocks', () => {
  const edits = collectPediaIconsReferenceEdits({
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_RESIN_SHOP',
        lookupCivilopediaKey: 'BLDG_RESIN_SHOP',
        displayCivilopediaKey: 'BLDG_Resin_Shop',
        rawBiqCivilopediaKey: 'BLDG_Resin_Shop',
        linkCivilopediaKey: 'BLDG_Resin_Shop',
        improvementKind: 'small_wonder',
        iconPaths: [
          'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
          'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
        ],
        originalIconPaths: [],
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: '',
        buildingIconIndex: '243',
        originalBuildingIconIndex: '',
        wonderSplashPath: 'Art/Civilopedia/Icons/Buildings/w_ResinShop.pcx',
        originalWonderSplashPath: ''
      }],
      recordOps: []
    }
  });

  assert.deepEqual(edits, [
    {
      blockKey: 'ICON_BLDG_Resin_Shop',
      lines: [
        'SINGLE',
        '243',
        'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
        'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
      ]
    },
    {
      blockKey: 'WON_SPLASH_BLDG_Resin_Shop',
      lines: ['Art/Civilopedia/Icons/Buildings/w_ResinShop.pcx']
    }
  ]);
});

test('collectPediaIconsReferenceEdits writes wonder splash only when improvement splash changes', () => {
  const edits = collectPediaIconsReferenceEdits({
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_RESIN_SHOP',
        improvementKind: 'small_wonder',
        iconPaths: [
          'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
          'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
        ],
        originalIconPaths: [
          'Art/Civilopedia/Icons/Buildings/ResinShopL.pcx',
          'Art/Civilopedia/Icons/Buildings/ResinShopS.pcx'
        ],
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: 'SINGLE',
        buildingIconIndex: '243',
        originalBuildingIconIndex: '243',
        wonderSplashPath: 'Art/Civilopedia/Icons/Buildings/w_ResinShop.pcx',
        originalWonderSplashPath: ''
      }],
      recordOps: []
    }
  });

  assert.deepEqual(edits, [{
    blockKey: 'WON_SPLASH_BLDG_RESIN_SHOP',
    lines: ['Art/Civilopedia/Icons/Buildings/w_ResinShop.pcx']
  }]);
});

test('collectPediaIconsReferenceEdits does not create untouched normal improvement splash block', () => {
  const edits = collectPediaIconsReferenceEdits({
    improvements: {
      entries: [{
        civilopediaKey: 'BLDG_MARKET',
        improvementKind: 'normal',
        iconPaths: ['Art/Civilopedia/Icons/Buildings/MarketL.pcx', 'Art/Civilopedia/Icons/Buildings/MarketS.pcx'],
        originalIconPaths: ['Art/Civilopedia/Icons/Buildings/MarketL.pcx', 'Art/Civilopedia/Icons/Buildings/MarketS.pcx'],
        buildingIconKind: 'SINGLE',
        originalBuildingIconKind: 'SINGLE',
        buildingIconIndex: '50',
        originalBuildingIconIndex: '50',
        wonderSplashPath: '',
        originalWonderSplashPath: ''
      }],
      recordOps: []
    }
  });

  assert.deepEqual(edits, []);
});

test('collectPediaIconsReferenceEdits deletes stale building icon and wonder splash blocks', () => {
  const edits = collectPediaIconsReferenceEdits({
    improvements: {
      entries: [],
      recordOps: [{ op: 'delete', recordRef: 'BLDG_RESIN_SHOP' }]
    }
  });

  assert.deepEqual(edits, [
    { op: 'delete', blockKey: 'ICON_BLDG_RESIN_SHOP' },
    { op: 'delete', blockKey: 'WON_SPLASH_BLDG_RESIN_SHOP' }
  ]);
});
