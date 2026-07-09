const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { saveBundle } = require('../src/configCore');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'c3x-unit-ini-save-'));
}

test('scenario save writes edited unit INI to scenario Art/Units and preserves base unit INI', () => {
  const civ3Root = mkTmpDir();
  const c3xRoot = mkTmpDir();
  const scenarioDir = mkTmpDir();
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');

  const baseUnitDir = path.join(civ3Root, 'Conquests', 'Art', 'Units', 'TestUnit');
  fs.mkdirSync(baseUnitDir, { recursive: true });
  const baseIniPath = path.join(baseUnitDir, 'TestUnit.ini');
  fs.writeFileSync(baseIniPath, [
    '[Animations]',
    'DEFAULT=TestDefault.flc',
    'RUN=TestRun.flc',
    '[Timing]',
    'DEFAULT=0.500000',
    'RUN=0.500000'
  ].join('\n'), 'latin1');

  const tabs = {
    units: {
      entries: [
        {
          animationName: 'TestUnit',
          unitIniEditor: {
            iniPath: baseIniPath,
            actions: [
              { key: 'DEFAULT', relativePath: 'TestDefault.flc', timingSeconds: 0.5 },
              { key: 'RUN', relativePath: 'TestRunFast.flc', timingSeconds: 0.25 },
              { key: 'FIDGET', relativePath: 'TestFidget.flc', timingSeconds: 0.75 }
            ],
            originalActions: [
              { key: 'DEFAULT', relativePath: 'TestDefault.flc', timingSeconds: 0.5 },
              { key: 'RUN', relativePath: 'TestRun.flc', timingSeconds: 0.5 }
            ]
          }
        }
      ]
    }
  };

  const res = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioDir,
    tabs
  });

  assert.equal(res.ok, true);
  const scenarioIni = path.join(scenarioDir, 'Art', 'Units', 'TestUnit', 'TestUnit.ini');
  assert.equal(fs.existsSync(scenarioIni), true);
  const scenarioText = fs.readFileSync(scenarioIni, 'latin1');
  assert.match(scenarioText, /RUN=TestRunFast\.flc/);
  assert.match(scenarioText, /FIDGET=TestFidget\.flc/);
  assert.match(scenarioText, /RUN=0\.250000/);
  assert.match(scenarioText, /FIDGET=0\.750000/);

  const baseText = fs.readFileSync(baseIniPath, 'latin1');
  assert.match(baseText, /RUN=TestRun\.flc/);
  assert.doesNotMatch(baseText, /TestRunFast\.flc/);
});

test('scenario save writes full unit INI sections when section model is provided', () => {
  const civ3Root = mkTmpDir();
  const c3xRoot = mkTmpDir();
  const scenarioDir = mkTmpDir();
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');

  const baseUnitDir = path.join(civ3Root, 'Conquests', 'Art', 'Units', 'TemplateUnit');
  fs.mkdirSync(baseUnitDir, { recursive: true });
  const baseIniPath = path.join(baseUnitDir, 'TemplateUnit.ini');
  fs.writeFileSync(baseIniPath, [
    '[Speed]',
    'Normal Speed=225',
    '[Animations]',
    'DEFAULT=TemplateDefault.flc',
    '[Timing]',
    'DEFAULT=0.500000'
  ].join('\n'), 'latin1');

  const tabs = {
    units: {
      entries: [
        {
          animationName: 'TemplateUnit',
          unitIniEditor: {
            iniPath: baseIniPath,
            sections: [
              {
                name: 'Speed',
                fields: [
                  { key: 'Normal Speed', value: '160' },
                  { key: 'Fast Speed', value: '140' }
                ]
              },
              {
                name: 'Animations',
                fields: [
                  { key: 'DEFAULT', value: 'TemplateDefault.flc' },
                  { key: 'RUN', value: 'TemplateRun.flc' }
                ]
              },
              {
                name: 'Timing',
                fields: [
                  { key: 'DEFAULT', value: '0.42' },
                  { key: 'RUN', value: '0.30' }
                ]
              },
              {
                name: 'Sound Effects',
                fields: [
                  { key: 'RUN', value: 'TemplateRun.amb' }
                ]
              }
            ],
            originalSections: [
              {
                name: 'Speed',
                fields: [
                  { key: 'Normal Speed', value: '225' }
                ]
              },
              {
                name: 'Animations',
                fields: [
                  { key: 'DEFAULT', value: 'TemplateDefault.flc' }
                ]
              },
              {
                name: 'Timing',
                fields: [
                  { key: 'DEFAULT', value: '0.500000' }
                ]
              }
            ]
          }
        }
      ]
    }
  };

  const res = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioDir,
    tabs
  });
  assert.equal(res.ok, true);

  const scenarioIni = path.join(scenarioDir, 'Art', 'Units', 'TemplateUnit', 'TemplateUnit.ini');
  assert.equal(fs.existsSync(scenarioIni), true);
  const scenarioText = fs.readFileSync(scenarioIni, 'latin1');
  assert.match(scenarioText, /\[Speed\]/);
  assert.match(scenarioText, /Normal Speed=160/);
  assert.match(scenarioText, /Fast Speed=140/);
  assert.match(scenarioText, /\[Animations\]/);
  assert.match(scenarioText, /RUN=TemplateRun\.flc/);
  assert.match(scenarioText, /\[Sound Effects\]/);
  assert.match(scenarioText, /RUN=TemplateRun\.amb/);
});

test('scenario save rewrites action-row unit INI animation paths to Windows relative paths', () => {
  const civ3Root = mkTmpDir();
  const c3xRoot = mkTmpDir();
  const scenarioDir = path.join(mkTmpDir(), 'MyScenario');
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');

  const baseUnitDir = path.join(civ3Root, 'Conquests', 'Art', 'Units', 'TestUnit');
  fs.mkdirSync(baseUnitDir, { recursive: true });
  const baseIniPath = path.join(baseUnitDir, 'TestUnit.ini');
  fs.writeFileSync(baseIniPath, [
    '[Animations]',
    'DEFAULT=TestDefault.flc',
    'RUN=TestRun.flc',
    '[Timing]',
    'DEFAULT=0.500000',
    'RUN=0.500000'
  ].join('\n'), 'latin1');

  const tabs = {
    units: {
      entries: [
        {
          civilopediaKey: 'PRTO_TEST',
          animationName: 'TestUnit',
          _importScenarioPath: path.join(civ3Root, 'Eldorado5.biq'),
          unitIniEditor: {
            iniPath: baseIniPath,
            actions: [
              { key: 'DEFAULT', relativePath: 'MyScenario/Art/Units/TestUnit/TestDefault.flc', timingSeconds: 0.5 },
              { key: 'RUN', relativePath: 'Eldorado5/Art/Units/TestUnit/TestRunFast.flc', timingSeconds: 0.25 },
              { key: 'FIDGET', relativePath: 'Art/Units/SharedUnit/SharedFidget.flc', timingSeconds: 0.75 }
            ],
            originalActions: [
              { key: 'DEFAULT', relativePath: 'TestDefault.flc', timingSeconds: 0.5 },
              { key: 'RUN', relativePath: 'TestRun.flc', timingSeconds: 0.5 }
            ]
          }
        }
      ]
    }
  };

  const res = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioDir,
    tabs
  });

  assert.equal(res.ok, true);
  const scenarioIni = path.join(scenarioDir, 'Art', 'Units', 'TestUnit', 'TestUnit.ini');
  const scenarioText = fs.readFileSync(scenarioIni, 'latin1');
  assert.match(scenarioText, /DEFAULT=TestDefault\.flc/);
  assert.match(scenarioText, /RUN=TestRunFast\.flc/);
  assert.match(scenarioText, /FIDGET=\.\.\\SharedUnit\\SharedFidget\.flc/);
  assert.doesNotMatch(scenarioText, /MyScenario[\\/]/);
  assert.doesNotMatch(scenarioText, /Eldorado5[\\/]/);
});

test('scenario save rewrites section-model unit INI animation paths to Windows relative paths', () => {
  const civ3Root = mkTmpDir();
  const c3xRoot = mkTmpDir();
  const scenarioDir = path.join(mkTmpDir(), 'MyScenario');
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');

  const baseUnitDir = path.join(civ3Root, 'Conquests', 'Art', 'Units', 'TemplateUnit');
  fs.mkdirSync(baseUnitDir, { recursive: true });
  const baseIniPath = path.join(baseUnitDir, 'TemplateUnit.ini');
  fs.writeFileSync(baseIniPath, [
    '[Animations]',
    'DEFAULT=TemplateDefault.flc'
  ].join('\n'), 'latin1');

  const tabs = {
    units: {
      entries: [
        {
          civilopediaKey: 'PRTO_TEMPLATE',
          animationName: 'TemplateUnit',
          _importScenarioPath: path.join(civ3Root, 'Eldorado5.biq'),
          unitIniEditor: {
            iniPath: baseIniPath,
            sections: [
              {
                name: 'Animations',
                fields: [
                  { key: 'DEFAULT', value: 'MyScenario/Art/Units/TemplateUnit/TemplateDefault.flc' },
                  { key: 'RUN', value: 'Eldorado5/Art/Units/TemplateUnit/TemplateRun.flc' },
                  { key: 'ATTACK1', value: 'Art/Units/SharedUnit/SharedAttack.flc' }
                ]
              },
              {
                name: 'Sound Effects',
                fields: [
                  { key: 'DEFAULT', value: path.join(scenarioDir, 'Art', 'Units', 'TemplateUnit', 'TemplateDefault.wav') },
                  { key: 'RUN', value: path.join(scenarioDir, 'Art', 'Units', 'Modern Armor', 'ModernArmorDeath.wav') },
                  { key: 'ATTACK1', value: 'Art/Units/SharedUnit/SharedAttack.wav' }
                ]
              },
              {
                name: 'Timing',
                fields: [
                  { key: 'DEFAULT', value: '0.42' },
                  { key: 'RUN', value: '0.30' }
                ]
              }
            ],
            originalSections: [
              {
                name: 'Animations',
                fields: [
                  { key: 'DEFAULT', value: 'TemplateDefault.flc' }
                ]
              }
            ]
          }
        }
      ]
    }
  };

  const res = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioDir,
    tabs
  });
  assert.equal(res.ok, true);

  const scenarioIni = path.join(scenarioDir, 'Art', 'Units', 'TemplateUnit', 'TemplateUnit.ini');
  const scenarioText = fs.readFileSync(scenarioIni, 'latin1');
  assert.match(scenarioText, /DEFAULT=TemplateDefault\.flc/);
  assert.match(scenarioText, /RUN=TemplateRun\.flc/);
  assert.match(scenarioText, /ATTACK1=\.\.\\SharedUnit\\SharedAttack\.flc/);
  assert.match(scenarioText, /DEFAULT=TemplateDefault\.wav/);
  assert.match(scenarioText, /RUN=\.\.\\Modern Armor\\ModernArmorDeath\.wav/);
  assert.match(scenarioText, /ATTACK1=\.\.\\SharedUnit\\SharedAttack\.wav/);
  assert.doesNotMatch(scenarioText, /MyScenario[\\/]/);
  assert.doesNotMatch(scenarioText, /Eldorado5[\\/]/);
});

test('Unit tab FLC and sound browse selections normalize to Unit INI relative paths', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.match(renderer, /function toUnitIniRelativePath\(filePath, iniPath, fallbackIniPath = ''\)/);
  assert.match(renderer, /const logicalRel = makeUnitArtLogicalRelativePath\(full, baseDir\)/);
  assert.match(renderer, /function getUnitArtFolderReference\(value\)/);
  assert.equal(renderer.includes("return rel.replace(/\\//g, '\\\\');"), true);
  assert.match(
    renderer,
    /const nextRel = toUnitIniRelativePath\(filePath, targetIniPath, getUnitIniTargetPath\(entry\.animationName\)\);[\s\S]*if \(isSound\) row\.soundPath = nextRel;[\s\S]*else row\.relativePath = nextRel;/
  );
});

test('scenario save blocks unresolved new animation folder names without INI edits', () => {
  const civ3Root = mkTmpDir();
  const c3xRoot = mkTmpDir();
  const scenarioDir = mkTmpDir();
  fs.writeFileSync(path.join(c3xRoot, 'default.c3x_config.ini'), 'flag = true\n', 'utf8');

  const tabs = {
    units: {
      entries: [
        {
          civilopediaKey: 'PRTO_TEST',
          animationName: 'NotARealUnitFolder',
          originalAnimationName: '',
          unitAnimationEdited: true
        }
      ]
    }
  };

  const res = saveBundle({
    mode: 'scenario',
    c3xPath: c3xRoot,
    civ3Path: civ3Root,
    scenarioPath: scenarioDir,
    tabs
  });
  assert.equal(res.ok, false);
  assert.match(String(res.error || ''), /not resolvable/i);
  assert.match(String(res.error || ''), /existing unit animation folder/i);
});
