'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeRaceDependentSections, normalizeDeletedReferenceSections } = require('../src/biq/biqSections');

function section(code, records) {
  return { code, records };
}

function cloneSections(sections) {
  return (sections || []).map((entry) => ({ ...entry, records: (entry.records || []).map((record) => ({ ...record })) }));
}

function getChangedSectionCodes(beforeSections, afterSections) {
  const beforeByCode = new Map((beforeSections || []).map((section) => [section.code, section.records || []]));
  const afterByCode = new Map((afterSections || []).map((section) => [section.code, section.records || []]));
  return Array.from(new Set([...beforeByCode.keys(), ...afterByCode.keys()])).filter((code) => {
    return JSON.stringify(beforeByCode.get(code) || []) !== JSON.stringify(afterByCode.get(code) || []);
  });
}

function runCascade({ sections, edits, originalRefsBySection }) {
  const parsed = { sections: cloneSections(sections) };
  const raceResult = normalizeRaceDependentSections(parsed, edits, (originalRefsBySection && originalRefsBySection.RACE) || []);
  assert.equal(raceResult.ok, true, String(raceResult.error || 'race cascade failed'));
  const result = normalizeDeletedReferenceSections(parsed, edits, originalRefsBySection);
  assert.equal(result.ok, true, String(result.error || 'cascade failed'));
  return parsed;
}

test('delete cascade remaps supported technology references', () => {
  const parsed = runCascade({
    sections: [
      section('TECH', [
        { civilopediaEntry: 'TECH_0', prerequisites: [-1, -1, -1, -1] },
        { civilopediaEntry: 'TECH_2', prerequisites: [1, 2, -1, -1] }
      ]),
      section('GOOD', [{ prerequisite: 1 }, { prerequisite: 2 }]),
      section('RACE', [{ freeTechs: [1, 2, -1, -1] }]),
      section('GOVT', [{ prerequisiteTechnology: 2 }]),
      section('CTZN', [{ prerequisite: 1 }, { prerequisite: 2 }]),
      section('PRTO', [{ requiredTech: 2 }]),
      section('BLDG', [{ reqAdvance: 1, obsoleteBy: 2 }]),
      section('TFRM', [{ requiredAdvance: 1 }, { requiredAdvance: 2 }]),
      section('LEAD', [{ techIndices: [1, 2], numStartTechs: 2 }])
    ],
    edits: [{ op: 'delete', sectionCode: 'TECH', recordRef: 'TECH_1' }],
    originalRefsBySection: { TECH: ['TECH_0', 'TECH_1', 'TECH_2'] }
  });

  assert.equal(parsed.sections.find((s) => s.code === 'GOOD').records[0].prerequisite, -1);
  assert.equal(parsed.sections.find((s) => s.code === 'GOOD').records[1].prerequisite, 1);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'RACE').records[0].freeTechs, [-1, 1, -1, -1]);
  assert.equal(parsed.sections.find((s) => s.code === 'GOVT').records[0].prerequisiteTechnology, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'CTZN').records[0].prerequisite, -1);
  assert.equal(parsed.sections.find((s) => s.code === 'CTZN').records[1].prerequisite, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'PRTO').records[0].requiredTech, 1);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'BLDG').records[0], { reqAdvance: -1, obsoleteBy: 1 });
  assert.equal(parsed.sections.find((s) => s.code === 'TFRM').records[0].requiredAdvance, -1);
  assert.equal(parsed.sections.find((s) => s.code === 'TFRM').records[1].requiredAdvance, 1);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'TECH').records[1].prerequisites, [-1, 1, -1, -1]);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'LEAD').records[0].techIndices, [1]);
  assert.equal(parsed.sections.find((s) => s.code === 'LEAD').records[0].numStartTechs, 1);
});

test('delete cascade remaps supported resource references', () => {
  const parsed = runCascade({
    sections: [
      section('GOOD', [
        { civilopediaEntry: 'GOOD_0' },
        { civilopediaEntry: 'GOOD_2' }
      ]),
      section('PRTO', [{ requiredResource1: 1, requiredResource2: 2, requiredResource3: -1 }]),
      section('BLDG', [{ reqResource1: 1, reqResource2: 2 }]),
      section('RULE', [{ defaultMoneyResource: 2 }]),
      section('TERR', [{ numTotalResources: 3, possibleResources: Buffer.from([0b00000111]) }]),
      section('TFRM', [{ requiredResource1: 1, requiredResource2: 2 }, { requiredResource1: -1, requiredResource2: 1 }])
    ],
    edits: [{ op: 'delete', sectionCode: 'GOOD', recordRef: 'GOOD_1' }],
    originalRefsBySection: { GOOD: ['GOOD_0', 'GOOD_1', 'GOOD_2'] }
  });

  assert.deepEqual(parsed.sections.find((s) => s.code === 'PRTO').records[0], {
    requiredResource1: -1,
    requiredResource2: 1,
    requiredResource3: -1
  });
  assert.deepEqual(parsed.sections.find((s) => s.code === 'BLDG').records[0], {
    reqResource1: -1,
    reqResource2: 1
  });
  assert.deepEqual(parsed.sections.find((s) => s.code === 'TFRM').records[0], {
    requiredResource1: -1,
    requiredResource2: 1
  });
  assert.deepEqual(parsed.sections.find((s) => s.code === 'TFRM').records[1], {
    requiredResource1: -1,
    requiredResource2: -1
  });
  assert.equal(parsed.sections.find((s) => s.code === 'RULE').records[0].defaultMoneyResource, 1);
  const terr = parsed.sections.find((s) => s.code === 'TERR').records[0];
  assert.equal(terr.numTotalResources, 2);
  assert.equal(terr.possibleResources[0] & 0b11, 0b11);
});

test('delete cascade remaps supported building references', () => {
  const parsed = runCascade({
    sections: [
      section('BLDG', [
        { civilopediaEntry: 'BLDG_0', gainInEveryCity: 1, gainOnContinent: 2, reqImprovement: 1, doublesHappiness: 2 },
        { civilopediaEntry: 'BLDG_2', gainInEveryCity: 0, gainOnContinent: 0, reqImprovement: 0, doublesHappiness: 0 }
      ]),
      section('CITY', [{ buildings: [0, 1, 2], numBuildings: 3 }]),
      section('PRTO', [{ legalBuildingTelepads: [1, 2] }])
    ],
    edits: [{ op: 'delete', sectionCode: 'BLDG', recordRef: 'BLDG_1' }],
    originalRefsBySection: { BLDG: ['BLDG_0', 'BLDG_1', 'BLDG_2'] }
  });

  assert.deepEqual(parsed.sections.find((s) => s.code === 'BLDG').records[0], {
    civilopediaEntry: 'BLDG_0',
    gainInEveryCity: 0,
    gainOnContinent: 1,
    reqImprovement: 0,
    doublesHappiness: 1
  });
  assert.deepEqual(parsed.sections.find((s) => s.code === 'CITY').records[0].buildings, [0, 1]);
  assert.equal(parsed.sections.find((s) => s.code === 'CITY').records[0].numBuildings, 2);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'PRTO').records[0].legalBuildingTelepads, [1]);
});

test('delete cascade remaps supported government references and shrinks relations', () => {
  const parsed = runCascade({
    sections: [
      section('GOVT', [
        {
          civilopediaEntry: 'GOVT_0',
          relations: [
            { canBribe: 10, briberyMod: 10, resistanceMod: 10 },
            { canBribe: 11, briberyMod: 11, resistanceMod: 11 },
            { canBribe: 12, briberyMod: 12, resistanceMod: 12 }
          ],
          numGovts: 3
        },
        {
          civilopediaEntry: 'GOVT_2',
          relations: [
            { canBribe: 20, briberyMod: 20, resistanceMod: 20 },
            { canBribe: 21, briberyMod: 21, resistanceMod: 21 },
            { canBribe: 22, briberyMod: 22, resistanceMod: 22 }
          ],
          numGovts: 3
        }
      ]),
      section('RACE', [{ favoriteGovernment: 1, shunnedGovernment: 2 }]),
      section('BLDG', [{ reqGovernment: 2 }]),
      section('LEAD', [{ government: 2 }])
    ],
    edits: [{ op: 'delete', sectionCode: 'GOVT', recordRef: 'GOVT_1' }],
    originalRefsBySection: { GOVT: ['GOVT_0', 'GOVT_1', 'GOVT_2'] }
  });

  const race0 = parsed.sections.find((s) => s.code === 'RACE').records[0];
  assert.equal(race0.favoriteGovernment, -1);
  assert.equal(race0.shunnedGovernment, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'BLDG').records[0].reqGovernment, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'LEAD').records[0].government, 1);
  const govt0 = parsed.sections.find((s) => s.code === 'GOVT').records[0];
  assert.equal(govt0.numGovts, 2);
  assert.deepEqual(govt0.relations.map((entry) => entry.canBribe), [10, 12]);
});

test('delete cascade remaps supported unit references', () => {
  const parsed = runCascade({
    sections: [
      section('PRTO', [
        {
          civilopediaEntry: 'PRTO_0',
          upgradeTo: 1,
          enslaveResultsIn: 2,
          legalUnitTelepads: [1, 2],
          stealthTargets: [1, 2]
        },
        { civilopediaEntry: 'PRTO_2', upgradeTo: -1, enslaveResultsIn: -1, legalUnitTelepads: [], stealthTargets: [] }
      ]),
      section('RACE', [{ kingUnit: 1 }]),
      section('BLDG', [{ unitProduced: 2 }]),
      section('RULE', [{ advancedBarbarian: 2, startUnit1: 1, flagUnit: 2 }]),
      section('LEAD', [{ startUnits: [{ startUnitCount: 1, startUnitIndex: 1 }, { startUnitCount: 2, startUnitIndex: 2 }], numStartUnits: 2 }]),
      section('UNIT', [{ pRTONumber: 2 }])
    ],
    edits: [{ op: 'delete', sectionCode: 'PRTO', recordRef: 'PRTO_1' }],
    originalRefsBySection: { PRTO: ['PRTO_0', 'PRTO_1', 'PRTO_2'] }
  });

  const prto0 = parsed.sections.find((s) => s.code === 'PRTO').records[0];
  assert.equal(prto0.upgradeTo, -1);
  assert.equal(prto0.enslaveResultsIn, 1);
  assert.deepEqual(prto0.legalUnitTelepads, [1]);
  assert.deepEqual(prto0.stealthTargets, [1]);
  assert.equal(parsed.sections.find((s) => s.code === 'RACE').records[0].kingUnit, -1);
  assert.equal(parsed.sections.find((s) => s.code === 'BLDG').records[0].unitProduced, 1);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'RULE').records[0], {
    advancedBarbarian: 1,
    startUnit1: -1,
    flagUnit: 1
  });
  assert.deepEqual(parsed.sections.find((s) => s.code === 'LEAD').records[0].startUnits, [
    { startUnitCount: 2, startUnitIndex: 1 }
  ]);
  assert.equal(parsed.sections.find((s) => s.code === 'LEAD').records[0].numStartUnits, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'UNIT').records[0].pRTONumber, 1);
});

test('delete cascade shifts PRTO availableTo bitmask when a civilization is deleted', () => {
  const parsed = runCascade({
    sections: [
      section('RACE', [
        { civilopediaEntry: 'RACE_0' },
        { civilopediaEntry: 'RACE_2' }
      ]),
      section('PRTO', [
        { availableTo: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 5) }
      ])
    ],
    edits: [{ op: 'delete', sectionCode: 'RACE', recordRef: 'RACE_1' }],
    originalRefsBySection: { RACE: ['RACE_0', 'RACE_1', 'RACE_2'] }
  });

  // Quint-style behavior: remove deleted civ bit and shift later civ bits down within the live civ range.
  // Bits beyond the existing civ list are left alone.
  assert.equal(parsed.sections.find((s) => s.code === 'PRTO').records[0].availableTo, (1 << 0) | (1 << 1) | (1 << 5));
});

test('delete cascade remaps eras and difficulties across TECH, LEAD, and RULE', () => {
  const parsed = runCascade({
    sections: [
      section('ERAS', [
        { civilopediaEntry: 'ERA_0' },
        { civilopediaEntry: 'ERA_2' }
      ]),
      section('DIFF', [
        { name: 'Diff 0' },
        { name: 'Diff 2' }
      ]),
      section('TECH', [{ era: 2 }]),
      section('LEAD', [{ initialEra: 2, difficulty: 2 }]),
      section('RULE', [{ defaultDifficultyLevel: 2 }])
    ],
    edits: [
      { op: 'delete', sectionCode: 'ERAS', recordRef: 'ERA_1' },
      { op: 'delete', sectionCode: 'DIFF', recordRef: 'DIFF_1' }
    ],
    originalRefsBySection: {
      ERAS: ['ERA_0', 'ERA_1', 'ERA_2'],
      DIFF: ['DIFF_0', 'DIFF_1', 'DIFF_2']
    }
  });

  assert.equal(parsed.sections.find((s) => s.code === 'TECH').records[0].era, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'LEAD').records[0].initialEra, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'LEAD').records[0].difficulty, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'RULE').records[0].defaultDifficultyLevel, 1);
});

test('delete cascade remaps GAME playable civs, LEAD civ, GOVT espionage immunity, and TERR worker refs', () => {
  const parsed = runCascade({
    sections: [
      section('RACE', [
        { civilopediaEntry: 'RACE_0' },
        { civilopediaEntry: 'RACE_2' }
      ]),
      section('ESPN', [
        { civilopediaEntry: 'ESPN_0' },
        { civilopediaEntry: 'ESPN_2' }
      ]),
      section('TFRM', [
        { civilopediaEntry: 'TFRM_0' },
        { civilopediaEntry: 'TFRM_2' }
      ]),
      section('TERR', [
        { civilopediaEntry: 'TERR_0', workerJob: 2, pollutionEffect: 2 },
        { civilopediaEntry: 'TERR_2', workerJob: 0, pollutionEffect: 0 }
      ]),
      section('GAME', [{ playableCivIds: [0, 1, 2], civPartOfWhichAlliance: [0, 1, 2] }]),
      section('LEAD', [{ civ: 2 }]),
      section('GOVT', [{ immuneTo: 2 }])
    ],
    edits: [
      { op: 'delete', sectionCode: 'RACE', recordRef: 'RACE_1' },
      { op: 'delete', sectionCode: 'ESPN', recordRef: 'ESPN_1' },
      { op: 'delete', sectionCode: 'TFRM', recordRef: 'TFRM_1' },
      { op: 'delete', sectionCode: 'TERR', recordRef: 'TERR_1' }
    ],
    originalRefsBySection: {
      RACE: ['RACE_0', 'RACE_1', 'RACE_2'],
      ESPN: ['ESPN_0', 'ESPN_1', 'ESPN_2'],
      TFRM: ['TFRM_0', 'TFRM_1', 'TFRM_2'],
      TERR: ['TERR_0', 'TERR_1', 'TERR_2']
    }
  });

  const game = parsed.sections.find((s) => s.code === 'GAME').records[0];
  assert.deepEqual(game.playableCivIds, [0, 1]);
  assert.deepEqual(game.civPartOfWhichAlliance, [0, 2]);
  assert.equal(parsed.sections.find((s) => s.code === 'LEAD').records[0].civ, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'GOVT').records[0].immuneTo, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'TERR').records[0].workerJob, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'TERR').records[0].pollutionEffect, 1);
});

test('delete cascade removes player-owned map records and shifts surviving player owners like Quint', () => {
  const originalSections = [
    section('LEAD', [
      { civ: 0 },
      { civ: 2 }
    ]),
    section('TILE', [
      { index: 0, xpos: 0, ypos: 0, city: 0, colony: 0 },
      { index: 1, xpos: 2, ypos: 0, city: 1, colony: 1 },
      { index: 2, xpos: 0, ypos: 1, city: 2, colony: 2 }
    ]),
    section('SLOC', [
      { ownerType: 3, owner: 0, x: 0, y: 0 },
      { ownerType: 3, owner: 1, x: 2, y: 0 },
      { ownerType: 3, owner: 2, x: 0, y: 1 }
    ]),
    section('CITY', [
      { index: 0, ownerType: 3, owner: 0, x: 0, y: 0 },
      { index: 1, ownerType: 3, owner: 1, x: 2, y: 0 },
      { index: 2, ownerType: 3, owner: 2, x: 0, y: 1 }
    ]),
    section('UNIT', [
      { index: 0, ownerType: 3, owner: 0, x: 0, y: 0 },
      { index: 1, ownerType: 3, owner: 1, x: 2, y: 0 },
      { index: 2, ownerType: 3, owner: 2, x: 0, y: 1 }
    ]),
    section('CLNY', [
      { index: 0, ownerType: 3, owner: 0, x: 0, y: 0, improvementType: 0 },
      { index: 1, ownerType: 3, owner: 1, x: 2, y: 0, improvementType: 0 },
      { index: 2, ownerType: 3, owner: 2, x: 0, y: 1, improvementType: 2 }
    ])
  ];
  const parsed = runCascade({
    sections: originalSections,
    edits: [{ op: 'delete', sectionCode: 'LEAD', recordRef: 'LEAD_1' }],
    originalRefsBySection: { LEAD: ['LEAD_0', 'LEAD_1', 'LEAD_2'] }
  });

  assert.deepEqual(parsed.sections.find((s) => s.code === 'SLOC').records, [
    { ownerType: 3, owner: 0, x: 0, y: 0 },
    { ownerType: 3, owner: 1, x: 0, y: 1 }
  ]);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'CITY').records, [
    { index: 0, ownerType: 3, owner: 0, x: 0, y: 0 },
    { index: 1, ownerType: 3, owner: 1, x: 0, y: 1 }
  ]);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'UNIT').records, [
    { index: 0, ownerType: 3, owner: 0, x: 0, y: 0 },
    { index: 1, ownerType: 3, owner: 1, x: 0, y: 1 }
  ]);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'CLNY').records, [
    { index: 0, ownerType: 3, owner: 0, x: 0, y: 0, improvementType: 0 },
    { index: 1, ownerType: 3, owner: 1, x: 0, y: 1, improvementType: 2 }
  ]);
  assert.deepEqual(parsed.sections.find((s) => s.code === 'TILE').records.map((record) => ({ city: record.city, colony: record.colony })), [
    { city: 0, colony: 0 },
    { city: -1, colony: -1 },
    { city: 1, colony: 1 }
  ]);
  assert.deepEqual(getChangedSectionCodes(originalSections, parsed.sections), ['TILE', 'SLOC', 'CITY', 'UNIT', 'CLNY']);
});

test('delete cascade remaps surviving civ-owned map owner references when a civilization is deleted', () => {
  const originalSections = [
    section('RACE', [
      { civilopediaEntry: 'RACE_0' },
      { civilopediaEntry: 'RACE_2' }
    ]),
    section('SLOC', [{ ownerType: 2, owner: 2, x: 0, y: 0 }]),
    section('CITY', [{ index: 0, ownerType: 2, owner: 2, x: 0, y: 0 }]),
    section('UNIT', [{ index: 0, ownerType: 2, owner: 2, x: 0, y: 0 }]),
    section('CLNY', [{ index: 0, ownerType: 2, owner: 2, x: 0, y: 0, improvementType: 0 }]),
    section('TILE', [{ index: 0, xpos: 0, ypos: 0, city: 0, colony: 0 }])
  ];
  const parsed = runCascade({
    sections: originalSections,
    edits: [{ op: 'delete', sectionCode: 'RACE', recordRef: 'RACE_1' }],
    originalRefsBySection: { RACE: ['RACE_0', 'RACE_1', 'RACE_2'] }
  });

  assert.equal(parsed.sections.find((s) => s.code === 'SLOC').records[0].owner, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'CITY').records[0].owner, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'UNIT').records[0].owner, 1);
  assert.equal(parsed.sections.find((s) => s.code === 'CLNY').records[0].owner, 1);
  assert.deepEqual(getChangedSectionCodes(originalSections, parsed.sections), ['RACE', 'SLOC', 'CITY', 'UNIT', 'CLNY']);
});
