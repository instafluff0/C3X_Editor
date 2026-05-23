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

function makeSection(fields) {
  return {
    marker: '#Section',
    comments: [],
    fields: Object.entries(fields || {}).map(([key, value]) => ({ key, value }))
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
});

test('auditLoadedBundle reports BIQ improvements missing from scenario PediaIcons files', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  touch(scenarioCivilopedia);
  touch(scenarioPediaIcons);

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
    label: 'Add #ICON_BLDG_Barracks',
    civilopediaKey: 'BLDG_Barracks',
    sourcePath: path.join(civ3Root, 'Conquests', 'Text', 'PediaIcons.txt'),
    targetPath: scenarioPediaIcons
  });
});

test('auditLoadedBundle ignores missing scenario Civilopedia entries and non-improvement PediaIcons fallbacks', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  touch(scenarioCivilopedia);
  touch(scenarioPediaIcons);

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
  assert.equal(result.totalWarnings, 0);
});

test('auditLoadedBundle accepts BIQ improvements covered by scenario PediaIcons files', () => {
  const civ3Root = mkTmpDir();
  const scenarioRoot = mkTmpDir();
  const scenarioCivilopedia = path.join(scenarioRoot, 'Text', 'Civilopedia.txt');
  const scenarioPediaIcons = path.join(scenarioRoot, 'Text', 'PediaIcons.txt');
  touch(scenarioCivilopedia);
  touch(scenarioPediaIcons);

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
          { key: 'enable_districts', value: 'false' },
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
