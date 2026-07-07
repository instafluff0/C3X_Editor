const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { auditBundle, auditLoadedBundle } = require('../src/bundleAudit');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-bundle-audit-'));
}

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

const DAY_NIGHT_TERRAIN_FIXTURE_FILES = [
  'xtgc.pcx', 'xpgc.pcx', 'xdgc.pcx', 'xdpc.pcx', 'xdgp.pcx', 'xggc.pcx',
  'wCSO.pcx', 'wSSS.pcx', 'wOOO.pcx',
  'lxtgc.pcx', 'lxpgc.pcx', 'lxdgc.pcx', 'lxdpc.pcx', 'lxdgp.pcx', 'lxggc.pcx',
  'lwCSO.pcx', 'lwSSS.pcx', 'lwOOO.pcx',
  'polarICEcaps-final.pcx',
  'xhills.pcx', 'hill forests.pcx', 'hill jungle.pcx', 'LMHills.pcx',
  'floodplains.pcx',
  'deltaRivers.pcx', 'mtnRivers.pcx',
  'waterfalls.pcx',
  'irrigation DESETT.pcx', 'irrigation PLAINS.pcx', 'irrigation.pcx', 'irrigation TUNDRA.pcx',
  'Volcanos.pcx', 'Volcanos forests.pcx', 'Volcanos jungles.pcx', 'Volcanos-snow.pcx',
  'marsh.pcx',
  'LMMountains.pcx', 'Mountains.pcx', 'mountain forests.pcx', 'mountain jungles.pcx', 'Mountains-snow.pcx',
  'roads.pcx', 'railroads.pcx',
  'LMForests.pcx', 'grassland forests.pcx', 'plains forests.pcx', 'tundra forests.pcx',
  'landmark_terrain.pcx', 'tnt.pcx', 'goodyhuts.pcx', 'TerrainBuildings.pcx',
  'pollution.pcx', 'craters.pcx',
  'x_airfields and detect.pcx', 'x_victory.pcx',
  'resources.pcx',
  'rAMER.pcx', 'rEURO.pcx', 'rROMAN.pcx', 'rMIDEAST.pcx', 'rASIAN.pcx',
  'AMERWALL.pcx', 'EUROWALL.pcx', 'ROMANWALL.pcx', 'MIDEASTWALL.pcx', 'ASIANWALL.pcx',
  'DESTROY.pcx'
];

function touchDayNightTerrainSet(root, season, hour) {
  DAY_NIGHT_TERRAIN_FIXTURE_FILES.forEach((fileName) => {
    touch(path.join(root, 'Art', 'DayNight', season, hour, fileName));
  });
}

function writeFile(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'latin1');
}

function writeSafePediaIcons(filePath) {
  writeFile(filePath, [
    '#HomelessIcons',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderssmall.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverssmall.pcx',
    '#END CIVILOPEDIA ART',
    ''
  ].join('\r\n'));
}

function buildFallbackPediaIconsText() {
  const lines = [
    '#ERA_SPLASH_ERAS_Ancient_Times',
    'art\\erasplash\\ancient.pcx',
    '#ERA_SPLASH_ERAS_Middle_Ages',
    'art\\erasplash\\middle.pcx',
    '#ICON_SS_Planetary_Party_Lounge',
    'art\\civilopedia\\icons\\buildings\\spaceshiplarge.pcx',
    'art\\civilopedia\\icons\\buildings\\spaceshipsmall.pcx'
  ];
  for (let i = 0; i < 55; i += 1) {
    lines.push(`#ICON_BLDG_STOCK_${i}`);
    lines.push(`art\\civilopedia\\icons\\buildings\\stock${i}large.pcx`);
    lines.push(`art\\civilopedia\\icons\\buildings\\stock${i}small.pcx`);
  }
  lines.push(
    '#HomelessIcons',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderssmall.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverssmall.pcx',
    '#END CIVILOPEDIA ART',
    ''
  );
  return lines.join('\r\n');
}

function buildFallbackCivilopediaText() {
  const lines = [
    '#BLDG_SS_Planetary_Party_Lounge',
    '^Planetary Party Lounge',
    '#DESC_BLDG_SS_Planetary_Party_Lounge',
    '^A spaceship component.'
  ];
  for (let i = 0; i < 55; i += 1) {
    lines.push(`#BLDG_STOCK_${i}`);
    lines.push(`^Stock article ${i}.`);
  }
  lines.push('');
  return lines.join('\r\n');
}

function attachScenarioTextSourceDetails(bundle, paths) {
  bundle.tabs.civilizations.sourceDetails = {
    civilopediaScenario: paths.civilopediaScenario || '',
    civilopediaConquests: paths.civilopediaFallback || '',
    pediaIconsScenario: paths.pediaIconsScenario || '',
    pediaIconsConquests: paths.pediaIconsFallback || ''
  };
  return bundle;
}

function makeSection(fields) {
  return {
    marker: '#Section',
    comments: [],
    fields: Object.entries(fields || {}).map(([key, value]) => ({ key, value }))
  };
}

function makeBiqRecord(fields) {
  return {
    fields: Object.entries(fields || {}).map(([key, value]) => ({
      key,
      baseKey: key,
      label: key,
      value: String(value)
    }))
  };
}

function makeBiqSection(code, records) {
  return {
    code,
    records: (Array.isArray(records) ? records : []).map(makeBiqRecord)
  };
}

function makeBundle(c3xPath, overrides = {}) {
  return {
    c3xPath,
    civ3Path: c3xPath,
    scenarioPath: '',
    scenarioInputPath: '',
    scenarioSearchPaths: [],
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    },
    ...overrides
  };
}

function makeTechEntry(name, biqIndex, prereqs = []) {
  const fields = [
    { key: 'name', baseKey: 'name', label: 'name', value: String(name || '') }
  ];
  for (let i = 0; i < 4; i += 1) {
    fields.push({
      key: `prerequisite${i + 1}`,
      baseKey: `prerequisite${i + 1}`,
      label: `Prerequisite ${i + 1}`,
      value: prereqs[i] == null ? 'None' : String(prereqs[i])
    });
  }
  return {
    name,
    civilopediaKey: `TECH_${String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
    biqIndex,
    biqFields: fields
  };
}

function makeScenarioPlayersBundle(c3xPath, { playableIds, leadRows, civNames }) {
  const bundle = makeBundle(c3xPath);
  bundle.tabs.civilizations = {
    entries: (Array.isArray(civNames) ? civNames : []).map((name, biqIndex) => ({ name, biqIndex }))
  };
  const gameFields = {
    number_of_playable_civs: String((Array.isArray(playableIds) ? playableIds : []).length)
  };
  (Array.isArray(playableIds) ? playableIds : []).forEach((id, idx) => {
    gameFields[`playable_civ_${idx}`] = `${civNames[id] || `RACE #${id}`} (${id})`;
  });
  bundle.tabs.scenarioSettings = {
    sections: [makeBiqSection('GAME', [gameFields])]
  };
  bundle.tabs.players = {
    sections: [makeBiqSection('LEAD', (Array.isArray(leadRows) ? leadRows : []).map((row) => ({
      humanplayer: row.human ? 'true' : 'false',
      civ: row.civLabel != null
        ? row.civLabel
        : (row.civ >= 0 ? `${civNames[row.civ] || `RACE #${row.civ}`} (${row.civ})` : (row.civ === -2 ? 'Random' : 'Any'))
    })))]
  };
  return bundle;
}

test('auditLoadedBundle reports technologies that list themselves as prerequisites', () => {
  const baseTabs = makeBundle('').tabs;
  const bundle = makeBundle('', {
    tabs: {
      ...baseTabs,
      technologies: {
        entries: [
          makeTechEntry('Pottery', 0, ['Pottery (0)']),
          makeTechEntry('Cultivation', 1, ['None'])
        ]
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.match(result.tabs.technologies.sections['0'][0].message, /Pottery lists itself as a prerequisite/);
  assert.equal(result.tabs.technologies.sections['0'][0].code, 'tech-self-prerequisite');
  assert.match(result.tabs.technologies.general[0].message, /self-prerequisite tech/);
});

test('auditLoadedBundle reports circular technology prerequisite chains on every affected tech', () => {
  const baseTabs = makeBundle('').tabs;
  const bundle = makeBundle('', {
    tabs: {
      ...baseTabs,
      technologies: {
        entries: [
          makeTechEntry('Pottery', 0, ['Barding (1)']),
          makeTechEntry('Barding', 1, ['The Saddle (2)']),
          makeTechEntry('The Saddle', 2, ['Spoked Wheel (3)']),
          makeTechEntry('Spoked Wheel', 3, ['Pottery (0)']),
          makeTechEntry('Fermentation', 4, ['Cultivation (5)']),
          makeTechEntry('Cultivation', 5, ['None'])
        ]
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  ['0', '1', '2', '3'].forEach((idx) => {
    assert.equal(result.tabs.technologies.sections[idx][0].code, 'tech-prerequisite-cycle');
    assert.match(result.tabs.technologies.sections[idx][0].message, /Pottery -> Barding -> The Saddle -> Spoked Wheel -> Pottery/);
  });
  assert.equal(result.tabs.technologies.sections['4'], undefined);
  assert.equal(result.tabs.technologies.sections['5'], undefined);
  assert.match(result.tabs.technologies.general[0].message, /1 circular prerequisite chain/);
});

test('auditLoadedBundle accepts acyclic technology prerequisite chains', () => {
  const baseTabs = makeBundle('').tabs;
  const bundle = makeBundle('', {
    tabs: {
      ...baseTabs,
      technologies: {
        entries: [
          makeTechEntry('Pottery', 0, ['None']),
          makeTechEntry('Cultivation', 1, ['Pottery (0)']),
          makeTechEntry('Fermentation', 2, ['Cultivation (1)'])
        ]
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.tabs.technologies, undefined);
});

test('auditLoadedBundle accepts no-era technology sentinel but reports missing era indexes', () => {
  const noEraTech = makeTechEntry('City-State', 0, ['None']);
  noEraTech.biqFields.push({ key: 'era', baseKey: 'era', label: 'Era', value: '-1' });
  const badEraTech = makeTechEntry('Bad Future', 1, ['None']);
  badEraTech.biqFields.push({ key: 'era', baseKey: 'era', label: 'Era', value: '7' });
  const baseTabs = makeBundle('').tabs;
  const bundle = makeBundle('', {
    biq: {
      sections: [
        makeBiqSection('ERAS', [
          { name: 'Ancient Times' },
          { name: 'Middle Ages' },
          { name: 'Industrial Ages' },
          { name: 'Modern Times' }
        ])
      ]
    },
    tabs: {
      ...baseTabs,
      technologies: {
        entries: [noEraTech, badEraTech]
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.tabs.technologies.sections['0'], undefined);
  const issues = result.tabs.technologies.sections['1'] || [];
  assert.equal(issues[0].code, 'biq-reference-out-of-range');
  assert.equal(issues[0].fieldKey, 'era');
  assert.equal(issues[0].target, 'eras');
  assert.equal(issues[0].value, 7);
  assert.match(issues[0].message, /Bad Future Era points to missing era index 7/);
});

test('auditLoadedBundle reports out-of-range technology prerequisite fields by fixed slot', () => {
  const baseTabs = makeBundle('').tabs;
  const bundle = makeBundle('', {
    tabs: {
      ...baseTabs,
      technologies: {
        entries: [
          makeTechEntry('High-Density Batteries', 0, ['None']),
          makeTechEntry('Gravimetric Maneuver', 1, ['High-Density Batteries (0)', 'None', '100', 'None'])
        ]
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  const issues = result.tabs.technologies.sections['1'] || [];
  assert.equal(issues[0].code, 'biq-reference-out-of-range');
  assert.equal(issues[0].fieldKey, 'prerequisite3');
  assert.equal(issues[0].target, 'technologies');
  assert.equal(issues[0].value, 100);
  assert.match(issues[0].message, /Gravimetric Maneuver Prerequisite 3 points to missing tech index 100/);
  assert.match(result.tabs.base.general[0].message, /1 BIQ reference index/);
});

test('auditLoadedBundle reports out-of-range non-tech BIQ reference fields', () => {
  const baseTabs = makeBundle('').tabs;
  const bundle = makeBundle('', {
    tabs: {
      ...baseTabs,
      technologies: {
        entries: [
          makeTechEntry('Pottery', 0, ['None'])
        ]
      },
      resources: {
        entries: [
          {
            name: 'Strategic Spice',
            civilopediaKey: 'GOOD_STRATEGIC_SPICE',
            biqIndex: 0,
            biqFields: [
              { key: 'prerequisite', baseKey: 'prerequisite', label: 'Prerequisite', value: '12' }
            ]
          }
        ]
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  const issues = result.tabs.resources.sections['0'] || [];
  assert.equal(issues[0].code, 'biq-reference-out-of-range');
  assert.equal(issues[0].fieldKey, 'prerequisite');
  assert.equal(issues[0].target, 'technologies');
  assert.match(issues[0].message, /Strategic Spice Prerequisite points to missing tech index 12/);
});

test('auditLoadedBundle reports playable civs that have no fixed Scenario Player slot', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeScenarioPlayersBundle(c3xRoot, {
    civNames: ['Barbarians', 'Rome', 'Egypt', 'Japan'],
    playableIds: [1, 2, 3],
    leadRows: [
      { human: true, civ: 3 },
      { human: false, civ: -3 }
    ]
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  const playersMessages = ((result.tabs.players || {}).general) || [];
  assert.equal(playersMessages.length, 1);
  assert.equal(playersMessages[0].code, 'playable-civ-without-lead-slot');
  assert.match(playersMessages[0].message, /Rome, Egypt/);
  assert.match(playersMessages[0].message, /Civ3 can freeze/);
});

test('auditLoadedBundle accepts playable civs fixed to AI Scenario Player slots', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeScenarioPlayersBundle(c3xRoot, {
    civNames: ['Barbarians', 'Rome', 'Egypt', 'Japan'],
    playableIds: [1, 2, 3],
    leadRows: [
      { human: true, civ: 1 },
      { human: false, civ: 2 },
      { human: false, civ: 3 }
    ]
  });

  const result = auditLoadedBundle(bundle);
  const playersMessages = ((result.tabs.players || {}).general) || [];
  assert.equal(playersMessages.some((entry) => entry.code === 'playable-civ-without-lead-slot'), false);
});

test('auditLoadedBundle accepts broad playable list with an explicit human wildcard slot', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeScenarioPlayersBundle(c3xRoot, {
    civNames: ['Barbarians', 'Rome', 'Egypt', 'Japan'],
    playableIds: [1, 2, 3],
    leadRows: [
      { human: true, civ: -3 },
      { human: false, civ: -3 }
    ]
  });

  const result = auditLoadedBundle(bundle);
  const playersMessages = ((result.tabs.players || {}).general) || [];
  assert.equal(playersMessages.some((entry) => entry.code === 'playable-civ-without-lead-slot'), false);
});

test('auditLoadedBundle reports missing current district-family art', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'true' }
        ]
      },
      districts: {
        model: {
          sections: [
            makeSection({ name: 'Market', img_paths: 'Market.pcx' })
          ]
        }
      },
      wonders: {
        model: {
          sections: [
            makeSection({ name: 'Temple of Artemis', img_path: 'Wonders.pcx' })
          ]
        }
      },
      naturalWonders: {
        model: {
          sections: [
            makeSection({ name: 'Mt. Doom', img_path: 'NaturalWonders.pcx' })
          ]
        }
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 4);
  assert.match(result.tabs.districts.sections['0'][0].message, /Missing district art "Market\.pcx"/);
  assert.match(result.tabs.districts.general[0].message, /Missing district art "Abandoned\.pcx"/);
  assert.match(result.tabs.wonders.sections['0'][0].message, /Missing wonder district art "Wonders\.pcx"/);
  assert.match(result.tabs.naturalWonders.sections['0'][0].message, /Missing natural wonder art "NaturalWonders\.pcx"/);
});

test('auditLoadedBundle resolves district-family art from scenario Art paths and C3X fallback art', () => {
  const c3xRoot = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  touch(path.join(scenarioRoot, 'Art', 'Districts', '1200', 'WondersCustom.PCX'));
  touch(path.join(c3xRoot, 'Art', 'Districts', '1200', 'Wonders.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', '1200', 'NaturalWonders.pcx'));

  const bundle = makeBundle(c3xRoot, {
    scenarioPath: path.join(scenarioRoot, 'Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      wonders: {
        model: {
          sections: [
            makeSection({ name: 'The Statue of Liberty', img_path: 'Art/Districts/1200/WondersCustom.PCX' }),
            makeSection({ name: 'The Pyramids', img_path: 'Art/Wonders.pcx' })
          ]
        }
      },
      naturalWonders: {
        model: {
          sections: [
            makeSection({ name: 'Grand Canyon', img_path: 'Art/NaturalWonders.pcx' })
          ]
        }
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
  assert.equal(result.tabs.wonders, undefined);
  assert.equal(result.tabs.naturalWonders, undefined);
});

test('auditLoadedBundle resolves current district-family art from C3X Summer 1200 fallback', () => {
  const c3xRoot = mkTmpDir();
  touch(path.join(c3xRoot, 'Art', 'Districts', 'Summer', '1200', 'Market.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', 'Summer', '1200', 'Abandoned.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', 'Summer', '1200', 'Wonders.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', 'Summer', '1200', 'NaturalWonders.pcx'));

  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'true' }
        ]
      },
      districts: {
        model: {
          sections: [
            makeSection({ name: 'Market', img_paths: 'Market.pcx' })
          ]
        }
      },
      wonders: {
        model: {
          sections: [
            makeSection({ name: 'The Pyramids', img_path: 'Wonders.pcx' })
          ]
        }
      },
      naturalWonders: {
        model: {
          sections: [
            makeSection({ name: 'Angel Falls', img_path: 'NaturalWonders.pcx' })
          ]
        }
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
  assert.equal(result.tabs.districts, undefined);
  assert.equal(result.tabs.wonders, undefined);
  assert.equal(result.tabs.naturalWonders, undefined);
});

test('auditLoadedBundle skips day-night checks when cycle mode is off', () => {
  const c3xRoot = mkTmpDir();
  touch(path.join(c3xRoot, 'Art', 'Districts', '1200', 'Market.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', '1200', 'Abandoned.pcx'));

  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'true' }
        ]
      },
      districts: {
        model: {
          sections: [
            makeSection({ name: 'Market', img_paths: 'Market.pcx' })
          ]
        }
      },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
  assert.equal(result.tabs.base, undefined);
});

test('auditLoadedBundle reports unknown conditional district bonus improvement references', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [{
          name: 'Library Place',
          biqFields: [{ key: 'name', baseKey: 'name', value: 'Library Place' }]
        }]
      },
      districts: {
        model: {
          sections: [
            makeSection({
              name: 'Campus',
              culture_bonus: '1, "Library Place": 2, grassland: 1',
              science_bonus: '1, "Missing Lab": 4, river: 1'
            })
          ]
        }
      },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const messages = ((result.tabs.districts || {}).sections || {})['0'].map((issue) => issue.message);
  assert.ok(messages.some((message) => /Science Bonus conditional reference: Missing Lab/.test(message)), messages.join('\n'));
  assert.equal(messages.some((message) => /Library Place|grassland|river/.test(message)), false);
});

test('auditBundle uses the provided bundle snapshot for live scenario-option previews', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'true' }
        ]
      },
      districts: {
        model: {
          sections: [
            makeSection({ name: 'Market', img_paths: 'Market.pcx' })
          ]
        }
      }
    }
  });

  const result = auditBundle({
    mode: 'scenario',
    c3xPath: path.join(c3xRoot, 'does-not-matter'),
    civ3Path: path.join(c3xRoot, 'does-not-matter'),
    scenarioPath: path.join(c3xRoot, 'preview.biq'),
    bundleSnapshot: bundle
  });

  assert.equal(result.totalWarnings, 2);
  assert.match(result.tabs.districts.sections['0'][0].message, /Missing district art "Market\.pcx"/);
  assert.match(result.tabs.districts.general[0].message, /Missing district art "Abandoned\.pcx"/);
});

test('auditLoadedBundle reports missing day-night terrain and district hour art', () => {
  const c3xRoot = mkTmpDir();
  touch(path.join(c3xRoot, 'Art', 'Districts', '1200', 'Market.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', '1200', 'Abandoned.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', '2400', 'Market.pcx'));
  touch(path.join(c3xRoot, 'Art', 'Districts', '2400', 'Abandoned.pcx'));

  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'timer' },
          { key: 'enable_districts', value: 'true' }
        ]
      },
      districts: {
        model: {
          sections: [
            makeSection({ name: 'Market', img_paths: 'Market.pcx' })
          ]
        }
      },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.ok(Array.isArray(result.tabs.base.general));
  assert.ok(result.tabs.base.general.some((entry) => /Day\/night hour 0100 is missing terrain art/.test(entry.message)));
  assert.ok(result.tabs.districts.sections['0'].some((entry) => /Day\/night art "Market\.pcx" is missing/.test(entry.message) && /0100/.test(entry.message)));
  assert.ok(result.tabs.districts.general.some((entry) => /Day\/night art "Abandoned\.pcx" is missing/.test(entry.message) && /0100/.test(entry.message)));
});

test('auditLoadedBundle resolves scenario seasonal day-night terrain and district art', () => {
  const c3xRoot = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  touchDayNightTerrainSet(scenarioRoot, 'Winter', '1800');
  touch(path.join(scenarioRoot, 'Art', 'Districts', 'Summer', '1200', 'MySuperDistrict.PCX'));
  touch(path.join(scenarioRoot, 'Art', 'Districts', 'Summer', '1200', 'Abandoned.PCX'));
  touch(path.join(scenarioRoot, 'Art', 'Districts', 'Winter', '1800', 'MySuperDistrict.PCX'));
  touch(path.join(scenarioRoot, 'Art', 'Districts', 'Winter', '1800', 'Abandoned.PCX'));

  const bundle = makeBundle(c3xRoot, {
    scenarioPath: path.join(scenarioRoot, 'Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'specified' },
          { key: 'pinned_hour_for_day_night_cycle', value: '18' },
          { key: 'seasonal_cycle_mode', value: 'specified' },
          { key: 'pinned_season_for_seasonal_cycle', value: 'winter' },
          { key: 'enable_districts', value: 'true' }
        ]
      },
      districts: {
        model: {
          sections: [
            makeSection({ name: 'My Super District', img_paths: 'MySuperDistrict.PCX' })
          ]
        }
      },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.tabs.base, undefined);
  assert.equal(result.tabs.districts, undefined);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle resolves day-night and district art across multiple BIQ search folders', () => {
  const c3xRoot = mkTmpDir();
  const biqRoot = mkTmpDir();
  const firstSearchRoot = mkTmpDir();
  const secondSearchRoot = mkTmpDir();
  touchDayNightTerrainSet(secondSearchRoot, 'Winter', '1800');
  touch(path.join(secondSearchRoot, 'Art', 'Districts', 'Summer', '1200', 'MySuperDistrict.PCX'));
  touch(path.join(secondSearchRoot, 'Art', 'Districts', 'Summer', '1200', 'Abandoned.PCX'));
  touch(path.join(secondSearchRoot, 'Art', 'Districts', 'Winter', '1800', 'MySuperDistrict.PCX'));
  touch(path.join(secondSearchRoot, 'Art', 'Districts', 'Winter', '1800', 'Abandoned.PCX'));

  const bundle = makeBundle(c3xRoot, {
    scenarioPath: biqRoot,
    scenarioInputPath: path.join(biqRoot, 'Scenario.biq'),
    scenarioSearchPaths: [firstSearchRoot, secondSearchRoot],
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'specified' },
          { key: 'pinned_hour_for_day_night_cycle', value: '18' },
          { key: 'seasonal_cycle_mode', value: 'specified' },
          { key: 'pinned_season_for_seasonal_cycle', value: 'winter' },
          { key: 'enable_districts', value: 'true' }
        ]
      },
      districts: {
        model: {
          sections: [
            makeSection({ name: 'My Super District', img_paths: 'MySuperDistrict.PCX' })
          ]
        }
      },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.tabs.base, undefined);
  assert.equal(result.tabs.districts, undefined);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle reports missing reference art files for Civs, Techs, Resources, Governments, Improvements, and Units', () => {
  const civ3Root = mkTmpDir();
  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: {
        entries: [
          {
            name: 'Rome',
            civilopediaKey: 'RACE_ROMANS',
            iconPaths: ['Art/Civilopedia/Icons/Races/romeLarge.pcx'],
            racePaths: ['Art/Advisors/rome_all.pcx']
          }
        ]
      },
      technologies: {
        entries: [
          {
            name: 'Pottery',
            civilopediaKey: 'TECH_POTTERY',
            iconPaths: ['Art/Civilopedia/Icons/Techs/potterylarge.pcx']
          }
        ]
      },
      resources: {
        entries: [
          {
            name: 'Iron',
            civilopediaKey: 'GOOD_IRON',
            iconPaths: ['Art/Civilopedia/Icons/Resources/ironlarge.pcx']
          }
        ]
      },
      governments: {
        entries: [
          {
            name: 'Despotism',
            civilopediaKey: 'GOVT_DESPOTISM',
            iconPaths: ['Art/Civilopedia/Icons/Governments/despotismlarge.pcx']
          }
        ]
      },
      improvements: {
        entries: [
          {
            name: 'Granary',
            civilopediaKey: 'BLDG_GRANARY',
            iconPaths: ['Art/Civilopedia/Icons/Buildings/granarylarge.pcx']
          }
        ]
      },
      units: {
        entries: [
          {
            name: 'Warrior',
            civilopediaKey: 'PRTO_WARRIOR',
            iconPaths: ['Art/Civilopedia/Icons/Units/warriorlarge.pcx']
          }
        ]
      },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 7);
  assert.match(result.tabs.civilizations.sections['0'][0].message, /Rome: Missing art file "Art\/Civilopedia\/Icons\/Races\/romeLarge\.pcx"/);
  assert.match(result.tabs.civilizations.sections['0'][1].message, /Rome: Missing art file "Art\/Advisors\/rome_all\.pcx"/);
  assert.match(result.tabs.technologies.sections['0'][0].message, /Pottery: Missing art file "Art\/Civilopedia\/Icons\/Techs\/potterylarge\.pcx"/);
  assert.match(result.tabs.resources.sections['0'][0].message, /Iron: Missing art file "Art\/Civilopedia\/Icons\/Resources\/ironlarge\.pcx"/);
  assert.match(result.tabs.governments.sections['0'][0].message, /Despotism: Missing art file "Art\/Civilopedia\/Icons\/Governments\/despotismlarge\.pcx"/);
  assert.match(result.tabs.improvements.sections['0'][0].message, /Granary: Missing art file "Art\/Civilopedia\/Icons\/Buildings\/granarylarge\.pcx"/);
  assert.match(result.tabs.units.sections['0'][0].message, /Warrior: Missing art file "Art\/Civilopedia\/Icons\/Units\/warriorlarge\.pcx"/);

  const mapOpenResult = auditLoadedBundle(bundle, { skipReferenceArt: true });
  assert.equal(mapOpenResult.totalWarnings, 0, 'reference-art checks should be skippable during deferred map-open critical work');
});

test('auditLoadedBundle warns and offers a staged repair for Civ3-long reference art paths', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const longPath = 'Art/Civilopedia/Icons/Governments/algorithmic_governance_small.pcx';
  touch(path.join(scenarioRoot, ...longPath.split('/')));

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Instafluff_Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      technologies: {
        entries: [{
          name: 'Artificial General Intelligence',
          civilopediaKey: 'TECH_ARTIFICIAL_GENERAL_INTELLIGENCE',
          iconPaths: [longPath],
          originalIconPaths: [longPath]
        }]
      },
      civilizations: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  const warning = result.tabs.technologies.sections['0'][0];
  assert.equal(warning.code, 'reference-art-path-too-long');
  assert.match(warning.message, /is 66 characters/);
  assert.deepEqual(warning.action, {
    type: 'shorten-reference-art-path',
    tabKey: 'technologies',
    group: 'iconPaths',
    index: 0,
    civilopediaKey: 'TECH_ARTIFICIAL_GENERAL_INTELLIGENCE',
    currentPath: longPath,
    replacementPath: 'Art/tech chooser/Icons/algorithmic_governance_small.pcx',
    sourcePath: path.join(scenarioRoot, ...longPath.split('/')),
    label: 'Shorten to Art/tech chooser/Icons/algorithmic_governance_small.pcx',
    description: 'Stage this art under Art/tech chooser/Icons/algorithmic_governance_small.pcx.'
  });
  assert.ok(warning.action.replacementPath.replace(/\//g, '\\').length <= 65);
});

test('auditLoadedBundle does not propose a shortened art path already used by sibling art', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const largePath = 'Art/Civilopedia/Icons/Buildings/superintelligence_institute.pcx';
  const smallPath = 'Art/Civilopedia/Icons/Buildings/superintelligence_institute_small.pcx';
  const shortenedSmallPath = 'Art/Civilopedia/Icons/Buildings/superintelligence_ins_small.pcx';
  touch(path.join(scenarioRoot, ...largePath.split('/')));
  touch(path.join(scenarioRoot, ...smallPath.split('/')));
  fs.mkdirSync(path.dirname(path.join(scenarioRoot, ...shortenedSmallPath.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(scenarioRoot, ...shortenedSmallPath.split('/')), 'different art');

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Instafluff_Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [{
          name: 'The Superintelligence Institute',
          civilopediaKey: 'BLDG_SUPERINTELLIGENCE_INSTITUTE',
          iconPaths: [largePath, smallPath],
          originalIconPaths: [largePath, smallPath]
        }]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  const warning = result.tabs.improvements.sections['0'][0];
  assert.equal(warning.code, 'reference-art-path-too-long');
  assert.notEqual(warning.action.replacementPath, largePath);
  assert.notEqual(warning.action.replacementPath, shortenedSmallPath);
  assert.equal(warning.action.replacementPath, 'Art/Civilopedia/Icons/Buildings/superintelligence_insti_small.pcx');
  assert.ok(warning.action.replacementPath.replace(/\//g, '\\').length <= 65);
});

test('auditLoadedBundle does not warn for stock 65-character standard-game art paths', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const longPath = 'art/civilopedia/icons/buildings/offshoredrillingplatformlarge.pcx';
  touch(path.join(scenarioRoot, ...longPath.split('/')));

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Instafluff_Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [{
          name: 'Offshore Platform',
          civilopediaKey: 'BLDG_OFFSHORE_PLATFORM',
          iconPaths: [longPath],
          originalIconPaths: [longPath]
        }]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle reuses an existing shortened art path when it already matches the source file', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const longPath = 'art/civilopedia/icons/buildings/offshoredrillingplatformfacilitylarge.pcx';
  const shortenedPath = 'Art/Civilopedia/Icons/Buildings/offshoredrillingplatfor_large.pcx';
  fs.mkdirSync(path.dirname(path.join(scenarioRoot, ...longPath.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(scenarioRoot, ...longPath.split('/')), 'same art');
  fs.mkdirSync(path.dirname(path.join(scenarioRoot, ...shortenedPath.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(scenarioRoot, ...shortenedPath.split('/')), 'same art');

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Instafluff_Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [{
          name: 'Offshore Platform',
          civilopediaKey: 'BLDG_OFFSHORE_PLATFORM',
          iconPaths: [longPath],
          originalIconPaths: [longPath]
        }]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  const warning = result.tabs.improvements.sections['0'][0];
  assert.equal(warning.action.replacementPath, shortenedPath);
});

test('auditLoadedBundle suggests an already-used matching shortened art path for repeated ERA art', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const longPath = 'art/civilopedia/icons/buildings/offshoredrillingplatformfacilitylarge.pcx';
  const shortenedPath = 'Art/Civilopedia/Icons/Buildings/offshoredrillingplatfor_large.pcx';
  fs.mkdirSync(path.dirname(path.join(scenarioRoot, ...longPath.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(scenarioRoot, ...longPath.split('/')), 'same art');
  fs.mkdirSync(path.dirname(path.join(scenarioRoot, ...shortenedPath.split('/'))), { recursive: true });
  fs.writeFileSync(path.join(scenarioRoot, ...shortenedPath.split('/')), 'same art');

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Instafluff_Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [{
          name: 'Offshore Platform',
          civilopediaKey: 'BLDG_OFFSHORE_PLATFORM',
          buildingIconKind: 'ERA',
          buildingIconIndex: '26',
          iconPaths: [shortenedPath, longPath],
          originalIconPaths: [shortenedPath, longPath]
        }]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  const warning = result.tabs.improvements.sections['0'][0];
  assert.equal(warning.action.replacementPath, shortenedPath);
});

test('auditLoadedBundle preserves large and small suffixes when shortening unseparated art names', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const largePath = 'art/civilopedia/icons/buildings/offshoredrillingplatformfacilitylarge.pcx';
  const smallPath = 'art/civilopedia/icons/buildings/offshoredrillingplatformfacilitysmall.pcx';
  touch(path.join(scenarioRoot, ...largePath.split('/')));
  touch(path.join(scenarioRoot, ...smallPath.split('/')));
  touch(path.join(scenarioRoot, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'offshoredrillingplatformlar.pcx'));
  touch(path.join(scenarioRoot, 'Art', 'Civilopedia', 'Icons', 'Buildings', 'offshoredrillingplatformsma.pcx'));

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Instafluff_Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [{
          name: 'Offshore Platform',
          civilopediaKey: 'BLDG_OFFSHORE_PLATFORM',
          iconPaths: [largePath, smallPath],
          originalIconPaths: [largePath, smallPath]
        }]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 2);
  const warnings = result.tabs.improvements.sections['0'];
  assert.equal(warnings[0].action.replacementPath, 'Art/Civilopedia/Icons/Buildings/offshoredrillingplatfor_large.pcx');
  assert.equal(warnings[1].action.replacementPath, 'Art/Civilopedia/Icons/Buildings/offshoredrillingplatfor_small.pcx');
  assert.ok(warnings.every((warning) => warning.action.replacementPath.replace(/\//g, '\\').length <= 65));
});

test('auditLoadedBundle reports BIQ improvements missing from scenario PediaIcons files', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  touch(scenarioCivilopedia);
  writeSafePediaIcons(scenarioPediaIcons);

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Instafluff_Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        sourceDetails: {
          civilopediaScenario: scenarioCivilopedia,
          pediaIconsScenario: scenarioPediaIcons
        },
        entries: [
          {
            name: 'Barracks',
            civilopediaKey: 'BLDG_BARRACKS',
            displayCivilopediaKey: 'BLDG_Barracks',
            rawBiqCivilopediaKey: 'BLDG_Barracks',
            biqIndex: 1,
            iconPaths: [],
            sourceMeta: {
              civilopediaSection1: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt') },
              civilopediaSection2: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt') },
              iconPaths: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt') }
            }
          }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  assert.match(result.tabs.improvements.sections['0'][0].message, /Barracks: Scenario PediaIcons\.txt is missing #ICON_BLDG_Barracks/);
  assert.deepEqual(result.tabs.improvements.sections['0'][0].action, {
    type: 'copy-scenario-pediaicons-block',
    tabKey: 'improvements',
    label: 'Add #ICON_BLDG_Barracks',
    expectedLabel: '#ICON_BLDG_Barracks',
    expectedKeys: ['ICON_BLDG_Barracks'],
    civilopediaKey: 'BLDG_Barracks',
    sourcePath: path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt'),
    targetPath: scenarioPediaIcons
  });
});

test('auditLoadedBundle warns when scenario PediaIcons is missing BIQ technology blocks', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  touch(scenarioCivilopedia);
  writeFile(scenarioPediaIcons, [
    '#ICON_BLDG_Barracks',
    'art\\civilopedia\\icons\\buildings\\barrackslarge.pcx',
    'art\\civilopedia\\icons\\buildings\\barrackssmall.pcx',
    '#HomelessIcons',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderssmall.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverssmall.pcx',
    '#END CIVILOPEDIA ART',
    ''
  ].join('\r\n'));

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      technologies: {
        sourceDetails: {
          civilopediaScenario: scenarioCivilopedia,
          pediaIconsScenario: scenarioPediaIcons
        },
        entries: [
          {
            name: 'Mysticism',
            civilopediaKey: 'TECH_MYSTICISM',
            displayCivilopediaKey: 'TECH_Mysticism',
            rawBiqCivilopediaKey: 'TECH_Mysticism',
            biqIndex: 1,
            iconPaths: [],
            sourceMeta: {
              civilopediaSection1: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt') },
              civilopediaSection2: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt') },
              iconPaths: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt') }
            }
          }
        ]
      },
      improvements: {
        sourceDetails: {
          civilopediaScenario: scenarioCivilopedia,
          pediaIconsScenario: scenarioPediaIcons
        },
        entries: [
          {
            name: 'Barracks',
            civilopediaKey: 'BLDG_BARRACKS',
            displayCivilopediaKey: 'BLDG_Barracks',
            rawBiqCivilopediaKey: 'BLDG_Barracks',
            biqIndex: 1,
            iconPaths: [],
            sourceMeta: {
              civilopediaSection1: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt') },
              civilopediaSection2: { readPath: path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt') },
              iconPaths: { readPath: scenarioPediaIcons }
            }
          }
        ]
      },
      civilizations: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  assert.match(result.tabs.technologies.sections['0'][0].message, /Mysticism: Scenario PediaIcons\.txt is missing #TECH_Mysticism and #TECH_Mysticism_LARGE/);
  assert.deepEqual(result.tabs.technologies.sections['0'][0].action, {
    type: 'copy-scenario-pediaicons-block',
    tabKey: 'technologies',
    label: 'Add #TECH_Mysticism and #TECH_Mysticism_LARGE',
    expectedLabel: '#TECH_Mysticism and #TECH_Mysticism_LARGE',
    expectedKeys: ['TECH_Mysticism', 'TECH_Mysticism_LARGE'],
    civilopediaKey: 'TECH_Mysticism',
    sourcePath: path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt'),
    targetPath: scenarioPediaIcons
  });
});

test('auditLoadedBundle ignores BIQ technologies with blank Civilopedia keys for PediaIcons coverage', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  touch(scenarioCivilopedia);
  writeSafePediaIcons(scenarioPediaIcons);

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      technologies: {
        sourceDetails: {
          civilopediaScenario: scenarioCivilopedia,
          pediaIconsScenario: scenarioPediaIcons
        },
        entries: [
          {
            name: 'BLOCKER_TECH',
            civilopediaKey: '',
            displayCivilopediaKey: '',
            rawBiqCivilopediaKey: '',
            biqIndex: 84,
            iconPaths: [],
            sourceMeta: {
              iconPaths: { readPath: '' }
            }
          }
        ]
      },
      improvements: { entries: [] },
      civilizations: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle accepts BIQ improvements covered by scenario PediaIcons files', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  touch(scenarioCivilopedia);
  writeFile(scenarioPediaIcons, [
    '#ICON_BLDG_Barracks',
    'art\\civilopedia\\icons\\buildings\\barrackslarge.pcx',
    'art\\civilopedia\\icons\\buildings\\barrackssmall.pcx',
    '#HomelessIcons',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\borderssmall.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverslarge.pcx',
    '#',
    'art\\civilopedia\\icons\\terrain\\riverssmall.pcx',
    '#END CIVILOPEDIA ART',
    ''
  ].join('\r\n'));

  const bundle = makeBundle(civ3Root, {
    scenarioPath: path.join(scenarioRoot, 'Scenario.biq'),
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        sourceDetails: {
          civilopediaScenario: scenarioCivilopedia,
          pediaIconsScenario: scenarioPediaIcons
        },
        entries: [
          {
            name: 'Barracks',
            civilopediaKey: 'BLDG_BARRACKS',
            displayCivilopediaKey: 'BLDG_Barracks',
            rawBiqCivilopediaKey: 'BLDG_Barracks',
            biqIndex: 1,
            iconPaths: [],
            sourceMeta: {
              civilopediaSection1: { readPath: scenarioCivilopedia },
              civilopediaSection2: { readPath: scenarioCivilopedia },
              iconPaths: { readPath: scenarioPediaIcons }
            }
          }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle warns about damaged scenario PediaIcons HomelessIcons before Firaxis editor freezes', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  writeFile(scenarioPediaIcons, [
    '#ICON_BLDG_Temple',
    'art\\civilopedia\\icons\\buildings\\templelarge.pcx',
    'art\\civilopedia\\icons\\buildings\\templesmall.pcx',
    '#HomelessIcons',
    '#END CIVILOPEDIA ART',
    ''
  ].join('\n'));

  const bundle = attachScenarioTextSourceDetails(makeBundle(civ3Root), {
    pediaIconsScenario: scenarioPediaIcons
  });

  const result = auditLoadedBundle(bundle);
  const codes = result.tabs.civilizations.general.map((entry) => entry.code);
  assert.deepEqual(codes.sort(), ['scenario-pediaicons-homeless-damaged']);
  assert.match(result.tabs.civilizations.general.find((entry) => entry.code === 'scenario-pediaicons-homeless-damaged').message, /Firaxis Conquests editor can freeze/);
});

test('auditLoadedBundle warns when scenario text overrides are missing fallback EraSplash or look suspiciously small', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const fallbackPediaIcons = path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt');
  const fallbackCivilopedia = path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  writeFile(fallbackPediaIcons, buildFallbackPediaIconsText());
  writeFile(fallbackCivilopedia, buildFallbackCivilopediaText());
  writeSafePediaIcons(scenarioPediaIcons);
  writeFile(scenarioCivilopedia, [
    '#PRTO_Custom_Jet',
    '^Custom jet.',
    ''
  ].join('\r\n'));

  const bundle = attachScenarioTextSourceDetails(makeBundle(civ3Root), {
    civilopediaScenario: scenarioCivilopedia,
    civilopediaFallback: fallbackCivilopedia,
    pediaIconsScenario: scenarioPediaIcons,
    pediaIconsFallback: fallbackPediaIcons
  });

  const result = auditLoadedBundle(bundle);
  const codes = result.tabs.civilizations.general.map((entry) => entry.code).sort();
  assert.deepEqual(codes, [
    'scenario-civilopedia-suspiciously-small',
    'scenario-pediaicons-era-splash-missing',
    'scenario-pediaicons-suspiciously-small'
  ]);
  assert.match(
    result.tabs.civilizations.general.find((entry) => entry.code === 'scenario-pediaicons-era-splash-missing').message,
    /crash the game on era transitions/
  );
});

test('auditLoadedBundle accepts healthy scenario-local Civilopedia and PediaIcons text', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const fallbackPediaIcons = path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt');
  const fallbackCivilopedia = path.join(civ3Root, 'Conquests', 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const pediaText = buildFallbackPediaIconsText();
  const civilopediaText = buildFallbackCivilopediaText();
  writeFile(fallbackPediaIcons, pediaText);
  writeFile(fallbackCivilopedia, civilopediaText);
  writeFile(scenarioPediaIcons, pediaText);
  writeFile(scenarioCivilopedia, civilopediaText);

  const bundle = attachScenarioTextSourceDetails(makeBundle(civ3Root), {
    civilopediaScenario: scenarioCivilopedia,
    civilopediaFallback: fallbackCivilopedia,
    pediaIconsScenario: scenarioPediaIcons,
    pediaIconsFallback: fallbackPediaIcons
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle skips reference art warnings when files exist on disk', () => {
  const civ3Root = mkTmpDir();
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Races', 'romeLarge.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Advisors', 'rome_all.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Techs', 'potterylarge.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Resources', 'ironlarge.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Governments', 'despotismlarge.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Buildings', 'granarylarge.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Units', 'warriorlarge.pcx'));

  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: {
        entries: [
          {
            name: 'Rome',
            civilopediaKey: 'RACE_ROMANS',
            iconPaths: ['Art/Civilopedia/Icons/Races/romeLarge.pcx'],
            racePaths: ['Art/Advisors/rome_all.pcx']
          }
        ]
      },
      technologies: {
        entries: [
          { name: 'Pottery', civilopediaKey: 'TECH_POTTERY', iconPaths: ['Art/Civilopedia/Icons/Techs/potterylarge.pcx'] }
        ]
      },
      resources: {
        entries: [
          { name: 'Iron', civilopediaKey: 'GOOD_IRON', iconPaths: ['Art/Civilopedia/Icons/Resources/ironlarge.pcx'] }
        ]
      },
      governments: {
        entries: [
          { name: 'Despotism', civilopediaKey: 'GOVT_DESPOTISM', iconPaths: ['Art/Civilopedia/Icons/Governments/despotismlarge.pcx'] }
        ]
      },
      improvements: {
        entries: [
          { name: 'Granary', civilopediaKey: 'BLDG_GRANARY', iconPaths: ['Art/Civilopedia/Icons/Buildings/granarylarge.pcx'] }
        ]
      },
      units: {
        entries: [
          { name: 'Warrior', civilopediaKey: 'PRTO_WARRIOR', iconPaths: ['Art/Civilopedia/Icons/Units/warriorlarge.pcx'] }
        ]
      },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
  assert.equal(result.tabs.civilizations, undefined);
  assert.equal(result.tabs.technologies, undefined);
  assert.equal(result.tabs.resources, undefined);
  assert.equal(result.tabs.governments, undefined);
  assert.equal(result.tabs.improvements, undefined);
  assert.equal(result.tabs.units, undefined);
});

test('auditLoadedBundle reports Civilopedia link target case mismatches only for target keys', () => {
  const civ3Root = mkTmpDir();
  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [
          {
            name: 'Resin Shop',
            civilopediaKey: 'BLDG_RESIN_SHOP',
            iconPaths: [],
            civilopediaSection1: 'Exact $LINK<any label=BLDG_RESIN_SHOP> and bad $LINK<resin shop=BLDG_Resin_Shop>.',
            civilopediaSection2: ''
          }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  assert.match(
    result.tabs.improvements.sections['0'][0].message,
    /Civilopedia link target "BLDG_Resin_Shop" differs in case from actual key "BLDG_RESIN_SHOP"/
  );
});

test('auditLoadedBundle reports Civilopedia links to missing entries', () => {
  const civ3Root = mkTmpDir();
  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      units: {
        entries: [
          {
            name: 'Arctic Ape',
            civilopediaKey: 'PRTO_ARCTIC_APE',
            iconPaths: [],
            civilopediaSection1: 'Available to $LINK<Trolls=RACE_Trolls> and uses $LINK<Summons=GCON_Summoning>.',
            civilopediaSection2: ''
          }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      gameConcepts: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 2);
  const messages = result.tabs.units.sections['0'].map((entry) => entry.message);
  assert.match(messages[0], /Civilopedia link target "RACE_Trolls" has no matching entry/);
  assert.match(messages[1], /Civilopedia link target "GCON_Summoning" has no matching entry/);
});

test('auditLoadedBundle ignores missing Civilopedia link targets that are not Civ3 pedia keys', () => {
  const civ3Root = mkTmpDir();
  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      units: {
        entries: [
          {
            name: 'Arctic Ape',
            civilopediaKey: 'PRTO_ARCTIC_APE',
            iconPaths: [],
            civilopediaSection1: 'Lore $LINK<Trolls=Trolls>.',
            civilopediaSection2: ''
          }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle accepts links matching raw mixed-case Civilopedia keys', () => {
  const civ3Root = mkTmpDir();
  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      resources: {
        entries: [
          {
            name: 'Horses',
            civilopediaKey: 'GOOD_HORSES',
            rawCivilopediaKey: 'GOOD_Horses',
            iconPaths: [],
            civilopediaSection1: 'Horses require $LINK<The Wheel=TECH_The_Wheel> and appear on $LINK<Grassland=TERR_Grassland>.',
            civilopediaSection2: ''
          }
        ]
      },
      technologies: {
        entries: [{ name: 'The Wheel', civilopediaKey: 'TECH_THE_WHEEL', rawCivilopediaKey: 'TECH_The_Wheel', iconPaths: [] }]
      },
      terrain: {
        civilopedia: {
          terrain: {
            entries: [{ name: 'Grassland', civilopediaKey: 'TERR_GRASSLAND', rawCivilopediaKey: 'TERR_Grassland' }]
          },
          workerActions: { entries: [] }
        }
      },
      civilizations: { entries: [] },
      improvements: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle still reports links differing from raw mixed-case keys', () => {
  const civ3Root = mkTmpDir();
  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      resources: {
        entries: [
          {
            name: 'Horses',
            civilopediaKey: 'GOOD_HORSES',
            rawCivilopediaKey: 'GOOD_Horses',
            iconPaths: [],
            civilopediaSection1: 'Bad link: $LINK<The Wheel=TECH_THE_WHEEL>.',
            civilopediaSection2: ''
          }
        ]
      },
      technologies: {
        entries: [{ name: 'The Wheel', civilopediaKey: 'TECH_THE_WHEEL', rawCivilopediaKey: 'TECH_The_Wheel', iconPaths: [] }]
      },
      civilizations: { entries: [] },
      improvements: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  assert.match(result.tabs.resources.sections['0'][0].message, /actual key "TECH_The_Wheel"/);
});

test('auditLoadedBundle includes improvement wonder splash art in missing-art checks', () => {
  const civ3Root = mkTmpDir();
  const bundle = makeBundle(civ3Root, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      improvements: {
        entries: [
          {
            name: 'Resin Shop',
            civilopediaKey: 'BLDG_RESIN_SHOP',
            iconPaths: [],
            wonderSplashPath: 'Art/Civilopedia/Icons/Buildings/w_ResinShop.pcx'
          }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 1);
  assert.match(result.tabs.improvements.sections['0'][0].message, /w_ResinShop\.pcx/);
});

test('auditLoadedBundle resolves reference art from civ3Path rather than c3xPath', () => {
  const civ3Root = mkTmpDir();
  const c3xRoot = mkTmpDir();
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Races', 'romanslarge.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Civilopedia', 'Icons', 'Races', 'romanssmall.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Leaderheads', 'CE.pcx'));
  touch(path.join(civ3Root, 'Conquests', 'Art', 'Advisors', 'CE_all.pcx'));

  const bundle = makeBundle(c3xRoot, {
    civ3Path: civ3Root,
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: {
        entries: [
          {
            name: 'Rome',
            civilopediaKey: 'RACE_ROMANS',
            iconPaths: [
              'art/civilopedia/icons/races/romanslarge.pcx',
              'art/civilopedia/icons/races/romanssmall.pcx'
            ],
            racePaths: [
              'art/leaderheads/CE.pcx',
              'art/advisors/CE_all.pcx'
            ]
          }
        ]
      },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.equal(result.totalWarnings, 0);
  assert.equal(result.tabs.civilizations, undefined);
});

test('auditLoadedBundle reports base unknown keys and invalid base values', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'every_turn' },
          { key: 'enable_districts', value: 'maybe' },
          { key: 'mystery_setting', value: '123' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.ok(result.tabs.base.general.some((entry) => /day_night_cycle_mode.+unknown value "every_turn"/i.test(entry.message)));
  assert.ok(result.tabs.base.general.some((entry) => /enable_districts.+invalid boolean value "maybe"/i.test(entry.message)));
  assert.ok(result.tabs.base.general.some((entry) => /Unknown C3X key "mystery_setting"/.test(entry.message)));
});

test('auditLoadedBundle reports C3X base references that do not match loaded rule names', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'true' },
          { key: 'enable_great_wall_districts', value: 'true' },
          { key: 'auto_build_great_wall_around_territory', value: 'true' },
          { key: 'buildings_generating_resources', value: '["Hollywood": local yields "Films"]' },
          { key: 'building_prereqs_for_units', value: '["Barracks": "Warrior" "Ghost Unit"]' },
          { key: 'production_perfume', value: '["Temple": 20, "Archer": -50%, "Missing Producer": 10]' },
          { key: 'technology_perfume', value: '["Electricity": 12, "Missing Tech": 5]' },
          { key: 'resource_perfume', value: '["Films": 20, "Missing Resource": 1]' },
          { key: 'government_perfume', value: '["Democracy": 1, "Missing Government": 2]' },
          { key: 'work_area_improvements', value: '["Aqueduct": 3, "Missing Building": 2]' },
          { key: 'unit_limits', value: '["Settler": 1 per-city, "Missing Unit": 1]' },
          { key: 'can_bombard_only_sea_tiles', value: '["Battleship" "Missing Boat"]' },
          { key: 'great_wall_auto_build_wonder_name', value: '"Hollywood"' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [{ name: 'Electricity' }] },
      resources: { entries: [{ name: 'Films' }] },
      governments: { entries: [{ name: 'Democracy' }] },
      improvements: {
        entries: [
          { name: 'Hollywoodzz', improvementKind: 'wonder' },
          { name: 'Barracks', improvementKind: 'normal' },
          { name: 'Temple', improvementKind: 'normal' },
          { name: 'Aqueduct', improvementKind: 'normal' },
          { name: 'Great Wall', improvementKind: 'wonder' }
        ]
      },
      units: {
        entries: [
          { name: 'Warrior' },
          { name: 'Archer' },
          { name: 'Settler' },
          { name: 'Battleship' }
        ]
      },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const messages = ((result.tabs.base || {}).general || []).map((entry) => String(entry.message || ''));
  assert.ok(messages.some((msg) => /buildings_generating_resources.+Hollywood/.test(msg)));
  assert.ok(messages.some((msg) => /building_prereqs_for_units.+Ghost Unit/.test(msg)));
  assert.ok(messages.some((msg) => /production_perfume.+Missing Producer/.test(msg)));
  assert.ok(messages.some((msg) => /technology_perfume.+Missing Tech/.test(msg)));
  assert.ok(messages.some((msg) => /resource_perfume.+Missing Resource/.test(msg)));
  assert.ok(messages.some((msg) => /government_perfume.+Missing Government/.test(msg)));
  assert.ok(messages.some((msg) => /work_area_improvements.+Missing Building/.test(msg)));
  assert.ok(messages.some((msg) => /unit_limits.+Missing Unit/.test(msg)));
  assert.ok(messages.some((msg) => /can_bombard_only_sea_tiles.+Missing Boat/.test(msg)));
  assert.ok(messages.some((msg) => /great_wall_auto_build_wonder_name.+Hollywood/.test(msg)));
  assert.equal(messages.some((msg) => /buildings_generating_resources.+Films/.test(msg)), false);
});

test('auditLoadedBundle skips Great Wall auto-build wonder reference when district features are inactive', () => {
  const c3xRoot = mkTmpDir();
  const baseRows = [
    { key: 'day_night_cycle_mode', value: 'off' },
    { key: 'great_wall_auto_build_wonder_name', value: '"Hollywood"' }
  ];
  const tabs = (rows) => ({
    base: { rows },
    civilizations: { entries: [] },
    technologies: { entries: [] },
    resources: { entries: [] },
    governments: { entries: [] },
    improvements: {
      entries: [
        { name: 'Great Wall', improvementKind: 'wonder' }
      ]
    },
    units: { entries: [] },
    districts: { model: { sections: [] } },
    wonders: { model: { sections: [] } },
    naturalWonders: { model: { sections: [] } }
  });

  [
    [
      { key: 'enable_districts', value: 'false' },
      { key: 'enable_great_wall_districts', value: 'true' },
      { key: 'auto_build_great_wall_around_territory', value: 'true' }
    ],
    [
      { key: 'enable_districts', value: 'true' },
      { key: 'enable_great_wall_districts', value: 'false' },
      { key: 'auto_build_great_wall_around_territory', value: 'true' }
    ],
    [
      { key: 'enable_districts', value: 'true' },
      { key: 'enable_great_wall_districts', value: 'true' },
      { key: 'auto_build_great_wall_around_territory', value: 'false' }
    ]
  ].forEach((featureRows) => {
    const bundle = makeBundle(c3xRoot, { tabs: tabs([...baseRows, ...featureRows]) });
    const messages = (((auditLoadedBundle(bundle).tabs.base || {}).general) || []).map((entry) => String(entry.message || ''));
    assert.equal(messages.some((msg) => /great_wall_auto_build_wonder_name.+Hollywood/.test(msg)), false);
  });
});

test('auditLoadedBundle recognizes shipped exclude_passengers_from_stealth_attack key', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'exclude_passengers_from_stealth_attack', value: 'false' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const general = (((result || {}).tabs || {}).base || {}).general || [];
  assert.ok(general.every((entry) => !/Unknown C3X key "exclude_passengers_from_stealth_attack"/.test(entry.message)));
});

test('auditLoadedBundle reports unknown section keys and invalid section values', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: {
        model: {
          sections: [
            makeSection({
              name: 'Airport Hub',
              buildable_on_rivers: 'sometimes',
              ai_build_strategy: 'roads-only',
              buildable_on: 'grassland,moon',
              mystery_flag: '1'
            })
          ]
        }
      },
      wonders: {
        model: {
          sections: [
            makeSection({
              name: 'Apollo Program',
              img_row: 'left'
            })
          ]
        }
      },
      naturalWonders: {
        model: {
          sections: [
            makeSection({
              name: 'Crystal Cave',
              terrain_type: 'moon',
              adjacency_dir: 'upward'
            })
          ]
        }
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  assert.ok(result.tabs.districts.sections['0'].some((entry) => /buildable_on_rivers.+invalid boolean value "sometimes"/i.test(entry.message)));
  assert.ok(result.tabs.districts.sections['0'].some((entry) => /ai_build_strategy.+unknown value "roads-only"/i.test(entry.message)));
  assert.ok(result.tabs.districts.sections['0'].some((entry) => /buildable_on.+unknown list values?: moon/i.test(entry.message)));
  assert.ok(result.tabs.districts.sections['0'].some((entry) => /Unknown field "mystery_flag"/.test(entry.message)));
  assert.ok(result.tabs.wonders.sections['0'].some((entry) => /img_row.+invalid integer value "left"/i.test(entry.message)));
  assert.ok(result.tabs.naturalWonders.sections['0'].some((entry) => /terrain_type.+unknown value "moon"/i.test(entry.message)));
  assert.ok(result.tabs.naturalWonders.sections['0'].some((entry) => /adjacency_dir.+unknown value "upward"/i.test(entry.message)));
});

test('auditLoadedBundle allows empty bitfield-list base values', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'special_defensive_bombard_rules', value: '[]' },
          { key: 'special_zone_of_control_rules', value: '[]' },
          { key: 'land_transport_rules', value: '[]' },
          { key: 'special_helicopter_rules', value: '[]' },
          { key: 'enabled_seasons', value: '[]' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const baseMessages = ((result.tabs.base || {}).general || []).map((entry) => String(entry.message || ''));
  assert.equal(baseMessages.some((msg) => /special_defensive_bombard_rules/.test(msg)), false);
  assert.equal(baseMessages.some((msg) => /special_zone_of_control_rules/.test(msg)), false);
  assert.equal(baseMessages.some((msg) => /land_transport_rules/.test(msg)), false);
  assert.equal(baseMessages.some((msg) => /special_helicopter_rules/.test(msg)), false);
  assert.equal(baseMessages.some((msg) => /enabled_seasons/.test(msg)), false);
});

test('auditLoadedBundle accepts C3X special base values for railroad, unit limits, and land transport rules', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'limit_railroad_movement', value: '6' },
          { key: 'limit_units_per_tile', value: '5' },
          { key: 'limit_units_per_tile', value: '[false false 10]' },
          { key: 'land_transport_rules', value: 'load-onto-boat join-army no-defense-from-inside' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const baseMessages = ((result.tabs.base || {}).general || []).map((entry) => String(entry.message || ''));
  assert.equal(baseMessages.some((msg) => /limit_railroad_movement/.test(msg)), false);
  assert.equal(baseMessages.some((msg) => /limit_units_per_tile/.test(msg)), false);
  assert.equal(baseMessages.some((msg) => /land_transport_rules/.test(msg)), false);
});

test('auditLoadedBundle allows district and natural-wonder parser aliases used by C3X', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: {
        model: {
          sections: [
            makeSection({
              name: 'Ski Resort',
              buildable_on: 'snow-mountains',
              buildable_on_overlays: 'swamp',
              buildable_without_removal: 'forests,swamps',
              buildable_adjacent_to: 'mountains,city',
              buildable_adjacent_to_overlays: 'rivers,forests'
            })
          ]
        }
      },
      wonders: {
        model: {
          sections: [
            makeSection({
              name: 'Hoover Dam',
              buildable_on: 'mountains'
            })
          ]
        }
      },
      naturalWonders: {
        model: {
          sections: [
            makeSection({
              name: 'Crystal Marsh',
              terrain_type: 'swamp',
              adjacent_to: 'snow-mountains'
            })
          ]
        }
      }
    }
  });

  const result = auditLoadedBundle(bundle);
  const districtMessages = ((result.tabs.districts || {}).sections || {})['0'] || [];
  const wonderMessages = ((result.tabs.wonders || {}).sections || {})['0'] || [];
  const naturalMessages = ((result.tabs.naturalWonders || {}).sections || {})['0'] || [];
  assert.equal(districtMessages.some((entry) => /unknown list value|unknown value/i.test(String(entry.message || ''))), false);
  assert.equal(wonderMessages.some((entry) => /unknown list value|unknown value/i.test(String(entry.message || ''))), false);
  assert.equal(naturalMessages.some((entry) => /unknown list value|unknown value/i.test(String(entry.message || ''))), false);
});

test('auditLoadedBundle accepts marsh for buildable_without_removal', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: {
        model: {
          sections: [
            makeSection({
              name: 'Great Wall',
              buildable_without_removal: 'marsh'
            })
          ]
        }
      },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const districtMessages = ((result.tabs.districts || {}).sections || {})['0'] || [];
  assert.equal(districtMessages.some((entry) => /unknown list value|unknown value/i.test(String(entry.message || ''))), false);
});

test('auditLoadedBundle recognizes wonder buildable_on_rivers as a valid field', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: { model: { sections: [] } },
      wonders: {
        model: {
          sections: [
            makeSection({
              name: 'Hoover Dam',
              buildable_on_rivers: '1'
            })
          ]
        }
      },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const wonderMessages = ((result.tabs.wonders || {}).sections || {})['0'] || [];
  assert.equal(wonderMessages.some((entry) => /Unknown field "buildable_on_rivers"/.test(String(entry.message || ''))), false);
});

test('auditLoadedBundle recognizes district advance_prereq as a valid legacy field alias', () => {
  const c3xRoot = mkTmpDir();
  const bundle = makeBundle(c3xRoot, {
    tabs: {
      base: {
        rows: [
          { key: 'day_night_cycle_mode', value: 'off' },
          { key: 'enable_districts', value: 'false' }
        ]
      },
      civilizations: { entries: [] },
      technologies: { entries: [] },
      resources: { entries: [] },
      governments: { entries: [] },
      improvements: { entries: [] },
      units: { entries: [] },
      districts: {
        model: {
          sections: [
            makeSection({
              name: 'Aerodrome',
              advance_prereq: 'Flight'
            })
          ]
        }
      },
      wonders: { model: { sections: [] } },
      naturalWonders: { model: { sections: [] } }
    }
  });

  const result = auditLoadedBundle(bundle);
  const districtMessages = ((result.tabs.districts || {}).sections || {})['0'] || [];
  assert.equal(districtMessages.some((entry) => /Unknown field "advance_prereq"/.test(String(entry.message || ''))), false);
});
