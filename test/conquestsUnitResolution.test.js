const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getPreview } = require('../src/artPreview');

const DEFAULT_CONQUESTS_ROOT = path.resolve(__dirname, '..', '..');
const CONQUESTS_ROOT = process.env.C3X_CONQUESTS_ROOT || DEFAULT_CONQUESTS_ROOT;
const MOVEMENT_ACTION_KEYS = new Set(['DEFAULT', 'RUN', 'WALK']);
const WALK_SKIP_DIR_NAMES = new Set(['Art', 'Text', '.git', 'node_modules']);

function shouldSkipWalkDir(dirName) {
  const name = String(dirName || '');
  return !name || name.startsWith('.') || WALK_SKIP_DIR_NAMES.has(name);
}

function listDirectories(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !shouldSkipWalkDir(entry.name))
      .map((entry) => entry.name);
  } catch (_err) {
    return [];
  }
}

function findNamedIniInUnitFolder(unitDir, unitName) {
  let entries = [];
  try {
    entries = fs.readdirSync(unitDir, { withFileTypes: true });
  } catch (_err) {
    return '';
  }
  const exactNameLower = `${String(unitName || '').toLowerCase()}.ini`;
  const direct = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === exactNameLower);
  return direct ? path.join(unitDir, direct.name) : '';
}

function listIniFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ini$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch (_err) {
    return [];
  }
}

function discoverUnitsRoots(conquestsRoot) {
  const roots = [];
  const baseUnitsRoot = path.join(conquestsRoot, 'Art', 'Units');
  if (fs.existsSync(baseUnitsRoot)) {
    roots.push({
      label: 'Base Conquests',
      unitsRoot: baseUnitsRoot,
      scenarioRoot: ''
    });
  }

  ['Conquests', 'Scenarios'].forEach((parentName) => {
    const parentRoot = path.join(conquestsRoot, parentName);
    if (!fs.existsSync(parentRoot)) return;
    const stack = [parentRoot];
    while (stack.length) {
      const current = stack.pop();
      const unitsRoot = path.join(current, 'Art', 'Units');
      if (fs.existsSync(unitsRoot)) {
        roots.push({
          label: path.relative(conquestsRoot, current),
          unitsRoot,
          scenarioRoot: current
        });
      }
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (_err) {
        continue;
      }
      entries.forEach((entry) => {
        if (!entry.isDirectory()) return;
        if (shouldSkipWalkDir(entry.name)) return;
        stack.push(path.join(current, entry.name));
      });
    }
  });
  return roots;
}

function collectResolutionSnapshot(conquestsRoot) {
  const civ3Root = path.dirname(conquestsRoot);
  const unitsRoots = discoverUnitsRoots(conquestsRoot);
  const missingIniFolders = [];
  const missingNamedIni = [];
  const missingActionFlc = [];
  const missingMovementFlc = [];
  const resolvedUnits = [];
  let totalUnitFolders = 0;

  unitsRoots.forEach(({ label, unitsRoot, scenarioRoot }) => {
    const units = listDirectories(unitsRoot);
    units.forEach((unitName) => {
      totalUnitFolders += 1;
      const unitDir = path.join(unitsRoot, unitName);
      const namedIniPath = findNamedIniInUnitFolder(unitDir, unitName);
      const id = `${label}/${unitName}`;
      if (!namedIniPath) {
        if (!listIniFiles(unitDir).length) {
          missingIniFolders.push(id);
          return;
        }
        missingNamedIni.push(id);
        return;
      }

      const requestBase = {
        kind: 'unitAnimationManifest',
        civ3Path: civ3Root,
        animationName: unitName
      };

      const resByRoot = getPreview({
        ...requestBase,
        scenarioPath: scenarioRoot || undefined
      });
      assert.equal(
        resByRoot.ok,
        true,
        `${id}: expected unitAnimationManifest resolution to succeed`
      );
      assert.ok(String(resByRoot.iniPath || '').trim(), `${id}: expected resolved iniPath`);
      assert.equal(fs.existsSync(String(resByRoot.iniPath || '')), true, `${id}: resolved iniPath does not exist`);
      assert.equal(
        path.basename(String(resByRoot.iniPath || '')).toLowerCase(),
        `${String(unitName || '').toLowerCase()}.ini`,
        `${id}: resolved INI filename should match unit folder name`
      );

      if (scenarioRoot) {
        const resByBiq = getPreview({
          ...requestBase,
          scenarioPath: path.join(scenarioRoot, '__test__.biq')
        });
        assert.equal(
          resByBiq.ok,
          true,
          `${id}: expected .biq scenario path resolution to succeed`
        );
        assert.ok(String(resByBiq.iniPath || '').trim(), `${id}: expected .biq resolved iniPath`);
        assert.equal(fs.existsSync(String(resByBiq.iniPath || '')), true, `${id}: .biq resolved iniPath does not exist`);
        assert.equal(
          path.basename(String(resByBiq.iniPath || '')).toLowerCase(),
          `${String(unitName || '').toLowerCase()}.ini`,
          `${id}: .biq resolved INI filename should match unit folder name`
        );
      }

      resolvedUnits.push(id);
      (Array.isArray(resByRoot.actions) ? resByRoot.actions : []).forEach((action) => {
        if (action.exists) return;
        const entry = `${id}#${String(action.key || '').toUpperCase()}`;
        missingActionFlc.push(entry);
        if (MOVEMENT_ACTION_KEYS.has(String(action.key || '').toUpperCase())) {
          missingMovementFlc.push(entry);
        }
      });
    });
  });

  return {
    rootsCount: unitsRoots.length,
    totalUnitFolders,
    resolvedUnits,
    missingIniFolders: missingIniFolders.sort(),
    missingNamedIni: missingNamedIni.sort(),
    missingActionFlc: missingActionFlc.sort(),
    missingMovementFlc: missingMovementFlc.sort()
  };
}

function normalizeTidesScenarioVariant(entry) {
  return String(entry || '')
    .replace(/\\/g, '/')
    .replace(
    /^Scenarios\/TIDES OF CRIMSON 2\.93\//,
    'Scenarios/Tides of Crimson/'
    )
    .replace(
      /^Scenarios\/TIDES OF CRIMSON Copy\//i,
      'Scenarios/Tides of Crimson/'
    );
}

function uniqueNormalizedEntries(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeTidesScenarioVariant))).sort();
}

function uniqueNormalizedBaselineEntries(values) {
  return uniqueNormalizedEntries(values)
    .filter((entry) => !entry.startsWith('Scenarios/Fallout/'));
}

test('Conquests unit INI resolution works across base and all scenario folders', () => {
  if (!fs.existsSync(CONQUESTS_ROOT)) {
    test.skip(`Conquests root not found: ${CONQUESTS_ROOT}`);
    return;
  }

  const snapshot = collectResolutionSnapshot(CONQUESTS_ROOT);

  assert.ok(snapshot.rootsCount >= 1, 'Expected at least one Art/Units root');
  assert.ok(snapshot.totalUnitFolders >= 1, 'Expected at least one unit folder');
  assert.ok(snapshot.resolvedUnits.length >= 1, 'Expected at least one resolvable unit INI');
});

test('Conquests movement/action FLC references match known baseline', () => {
  if (!fs.existsSync(CONQUESTS_ROOT)) {
    test.skip(`Conquests root not found: ${CONQUESTS_ROOT}`);
    return;
  }

  const snapshot = collectResolutionSnapshot(CONQUESTS_ROOT);

  // These scenario folders are helper/art folders, not unit definitions.
  assert.deepEqual(uniqueNormalizedBaselineEntries(snapshot.missingIniFolders), [
    'Scenarios/CCM3/Palettes',
    'Scenarios/CCM3/m42',
    'Scenarios/Tides of Crimson/Corel Auto-Preserve',
    'Scenarios/Tides of Crimson/Cyrstal Dragon',
    'Scenarios/Tides of Crimson/Dragon Sounds',
    'Scenarios/Tides of Crimson/ITEMS',
    'Scenarios/Tides of Crimson/Palettes',
    'Scenarios/Tides of Crimson/SOUNDS',
    'Scenarios/Tides of Crimson/SOUNDZ',
    'Scenarios/Tides of Crimson/SPELLS',
    'Scenarios/Tides of Crimson/ScorpaSounds'
  ].sort());

  // Unit folders that have an INI, but not UnitFolderName.ini.
  assert.deepEqual(uniqueNormalizedBaselineEntries(snapshot.missingNamedIni), [
    'Scenarios/CCM3/AsianLine Infantry1',
    'Scenarios/CCM3/German Inf.Div.mot',
    'Scenarios/CCM3/Hull (Capitalship)-CA',
    'Scenarios/CCM3/Hull (Capitalship)-orig',
    'Scenarios/CCM3/Nuclear Jetbomber-Tu-16',
    'Scenarios/CCM3/Panzergrenadiere-grau',
    'Scenarios/CCM3/Portugese Mot.Inf',
    'Scenarios/CCM3/Rumanian Mot.Inf',
    'Scenarios/CCM3/Scharnhorst (WW I)-small',
    'Scenarios/CCM3/Spanish Mot.Inf',
    'Scenarios/CCM3/Suffren B',
    'Scenarios/CCM3/Tlecuahuitl-alternative',
    'Scenarios/CCM3/USS New Mexico Class1',
    'Scenarios/CCM3/Uboat-Type VII-Delta',
    'Scenarios/CCM3/shinden',
    'Scenarios/CCM3/tatra',
    'Scenarios/Tides of Crimson/FrigateAlt',
    'Scenarios/Tides of Crimson/Ninja (from Version 1.6)',
    'Scenarios/Tides of Crimson/Phoenix Guard (from Version 1.6)',
    'Scenarios/Tides of Crimson/Wheat - Test Instafluff'
  ].sort());

  // Known missing FLC references in current local Conquests content.
  assert.deepEqual(uniqueNormalizedBaselineEntries(snapshot.missingActionFlc), [
    'Scenarios/CCM3/Asian Su76M#RUN',
    'Scenarios/CCM3/Elvis#DEATH',
    'Scenarios/CCM3/Elvis#DEFAULT',
    'Scenarios/CCM3/Elvis#FORTIFY',
    'Scenarios/CCM3/Elvis#RUN',
    'Scenarios/CCM3/Elvis#VICTORY',
    'Scenarios/CCM3/Fighter#VICTORY',
    'Scenarios/CCM3/French Helldiver#VICTORY',
    'Scenarios/CCM3/Furutaka Class#VICTORY',
    'Scenarios/CCM3/Morane#VICTORY',
    'Scenarios/CCM3/SE5a#VICTORY',
    'Scenarios/CCM3/Soviet Paratrooper#DEFEND',
    'Scenarios/CCM3/T-72 (Desert)#DEFEND',
    'Scenarios/Tides of Crimson/Sooside Bomma#DEATH'
  ].sort());

  // Known missing movement defaults/run references in current local Conquests content.
  assert.deepEqual(uniqueNormalizedBaselineEntries(snapshot.missingMovementFlc), [
    'Scenarios/CCM3/Asian Su76M#RUN',
    'Scenarios/CCM3/Elvis#DEFAULT',
    'Scenarios/CCM3/Elvis#RUN'
  ].sort());
});
