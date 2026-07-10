'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inflateSavIfNeeded, extractEmbeddedBiqFromSavBuffer } = require('./savExtract');
const { parseAllSections, sectionRecordName } = require('./biqSections');
const { inspectSavBuffer } = require('./savInspect');
const { buildReferenceTabs, resolveScenarioSearchDirs } = require('../configCore');

const TRAIT_BITS = Object.freeze([
  [1, 'Militaristic'],
  [2, 'Commercial'],
  [4, 'Expansionist'],
  [8, 'Scientific'],
  [16, 'Religious'],
  [32, 'Industrious'],
  [64, 'Agricultural'],
  [128, 'Seafaring'],
]);

const VICTORY_BITS = Object.freeze([
  [0, 'Domination'],
  [1, 'Space Race'],
  [2, 'Diplomatic'],
  [3, 'Conquest'],
  [4, 'Cultural'],
]);

const CIV_COLOR_SWATCHES = Object.freeze([
  '#6b7280', '#b9f27d', '#f2d16b', '#f59f22', '#f05a52', '#2f6de0', '#244fb8', '#8a5a2b',
  '#8fd6ff', '#7a58c9', '#b7e978', '#003d9e', '#0b8f24', '#f2e157', '#2ecad3', '#c218ff',
  '#e03535', '#6f7f2a', '#c7cddf', '#c4a46c', '#0f7a44', '#8066c7', '#c9e2c8', '#ffcc88',
  '#b6c1f0', '#e9c3f4', '#d9e1c9', '#9bd5c8', '#ffb3a2', '#d2b48c', '#94a3b8', '#111827',
]);
const CIV_COLOR_DUPLICATE_FALLBACK_SLOTS = Object.freeze([
  4, 10, 1, 3, 5, 6, 9, 0, 12, 13, 14, 15, 16, 17, 18, 19,
  20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
]);

const DISTRICT_COMPLETED_STATE = 1;
const WONDER_COMPLETED_STATE = 2;
const WONDER_DISTRICT_ID = 1;
const DEFAULT_DISTRICT_BUILDABLE_TERRAINS = Object.freeze(new Set([
  'desert', 'plains', 'grassland', 'tundra', 'floodplain', 'hills',
]));
const TERRAIN_ID_TO_C3X_TOKEN = Object.freeze([
  'desert', 'plains', 'grassland', 'tundra', 'floodplain', 'hills', 'mountains',
  'forest', 'jungle', 'marsh', 'volcano', 'coast', 'sea', 'ocean',
]);

const RULE_SIGNATURE_FIELDS = Object.freeze({
  RACE: ['civilizationName', 'civilopediaEntry'],
  TECH: ['name', 'civilopediaEntry', 'era'],
  GOOD: ['name', 'civilopediaEntry'],
  BLDG: ['name', 'civilopediaEntry'],
  PRTO: ['name', 'civilopediaEntry'],
  GOVT: ['name', 'civilopediaEntry'],
  ERAS: ['name', 'civilopediaEntry'],
  CULT: ['name'],
});

function section(parsed, code) {
  return parsed.sections.find((s) => String(s && s.code || '').toUpperCase() === code) || { records: [] };
}

function recordName(records, index, code, fallback) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return fallback || '';
  const record = records[n];
  if (!record) return fallback || `${code || 'Record'} ${n}`;
  return sectionRecordName(record, code) || fallback || `${code || 'Record'} ${n}`;
}

function canonicalKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function primitiveText(value) {
  if (Array.isArray(value)) return value.map(primitiveText).join('|');
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value == null) return '';
  return String(value).trim();
}

function getRecordIdentityValue(record, key) {
  if (!record || !key) return '';
  if (Object.prototype.hasOwnProperty.call(record, key)) return primitiveText(record[key]);
  const wanted = canonicalKey(key);
  const directKey = Object.keys(record).find((candidate) => canonicalKey(candidate) === wanted);
  if (directKey) return primitiveText(record[directKey]);
  const fields = Array.isArray(record.fields) ? record.fields : [];
  const field = fields.find((item) => {
    const base = item && (item.baseKey || item.key || item.label);
    return canonicalKey(base) === wanted;
  });
  return primitiveText(field && field.value);
}

function makeRuleSectionSignature(sectionCode, records) {
  const code = String(sectionCode || '').trim().toUpperCase();
  const fields = RULE_SIGNATURE_FIELDS[code] || ['name', 'civilopediaEntry'];
  const sourceRecords = Array.isArray(records) ? records : [];
  return {
    sectionCode: code,
    count: sourceRecords.length,
    records: sourceRecords.map((record, fallbackIndex) => ({
      index: Number.isFinite(record && record.index) ? Number(record.index) : fallbackIndex,
      values: fields.map((key) => getRecordIdentityValue(record, key)),
    })),
  };
}

function makeRef(tabKey, sectionCode, biqIndex, name, ruleSignatures) {
  const code = String(sectionCode || '').trim().toUpperCase();
  return {
    tabKey,
    sectionCode: code,
    biqIndex,
    name,
    sourceSignature: ruleSignatures && ruleSignatures[code] ? ruleSignatures[code] : null,
  };
}

function resolveCiv3RootPath(civ3Path) {
  const raw = String(civ3Path || '').trim();
  if (!raw) return '';
  const base = path.basename(raw).toLowerCase();
  if (base === 'conquests' || base === 'civ3ptw') return path.dirname(raw);
  return raw;
}

function splitScenarioSearchFolderValue(value) {
  return String(value || '')
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item && item !== '(none)' && item !== '(truncated)');
}

function makeSlimSaveArtEntry(entry, tabKey, scenarioPath, scenarioPaths) {
  if (!entry) return null;
  return {
    tabKey,
    id: String(entry.id || ''),
    name: String(entry.name || entry.displayCivilopediaKey || entry.civilopediaKey || ''),
    civilopediaKey: String(entry.civilopediaKey || ''),
    displayCivilopediaKey: String(entry.displayCivilopediaKey || entry.civilopediaKey || ''),
    biqIndex: Number.isFinite(Number(entry.biqIndex)) ? Number(entry.biqIndex) : null,
    thumbPath: String(entry.thumbPath || ''),
    iconPaths: Array.isArray(entry.iconPaths) ? entry.iconPaths.map((item) => String(item || '')).filter(Boolean) : [],
    racePaths: Array.isArray(entry.racePaths) ? entry.racePaths.map((item) => String(item || '')).filter(Boolean) : [],
    animationName: String(entry.animationName || ''),
    scenarioPath: String(scenarioPath || ''),
    scenarioPaths: Array.isArray(scenarioPaths) ? scenarioPaths.map((item) => String(item || '')).filter(Boolean) : []
  };
}

function makeFieldBackedEmbeddedBiqTab(parsed) {
  if (!parsed || !Array.isArray(parsed.sections)) return parsed;
  return {
    ...parsed,
    sections: parsed.sections.map((section) => ({
      ...section,
      records: (Array.isArray(section && section.records) ? section.records : []).map((record) => {
        if (!record || (Array.isArray(record.fields) && record.fields.length > 0)) return record;
        const fields = Object.entries(record)
          .filter(([key, value]) => key !== 'fields' && key !== 'english' && value != null && typeof value !== 'object')
          .map(([key, value]) => ({
            key,
            baseKey: key,
            label: key,
            value: String(value),
            editable: false
          }));
        return { ...record, fields };
      })
    }))
  };
}

function buildCivAdvisorSaveArtContext(parsed, gameRules, options = {}) {
  const civ3Path = String(options.civ3Path || '').trim();
  if (!civ3Path || !parsed || !parsed.ok) return null;
  try {
    const folders = splitScenarioSearchFolderValue(gameRules && gameRules.scenarioSearchFolders);
    const civ3Root = resolveCiv3RootPath(civ3Path);
    const scenarioBasePath = civ3Root ? path.join(civ3Root, 'Conquests', 'Scenarios', '__civ_advisor_save__.biq') : '';
    const scenarioSearchPaths = folders.length > 0
      ? resolveScenarioSearchDirs({
        scenarioPath: scenarioBasePath,
        civ3Path,
        folders,
        includeMissing: false
      })
      : [];
    const mode = scenarioSearchPaths.length > 0 ? 'scenario' : 'global';
    const scenarioPath = mode === 'scenario' ? scenarioSearchPaths[0] : '';
    const referenceTabs = buildReferenceTabs(civ3Path, {
      mode,
      scenarioPath,
      scenarioPaths: scenarioSearchPaths,
      biqTab: makeFieldBackedEmbeddedBiqTab(parsed)
    });
    const tabKeys = ['civilizations', 'technologies', 'resources', 'improvements', 'governments', 'units'];
    const tabs = {};
    tabKeys.forEach((tabKey) => {
      const tab = referenceTabs && referenceTabs[tabKey];
      const entries = Array.isArray(tab && tab.entries) ? tab.entries : [];
      tabs[tabKey] = {
        entries: entries.map((entry) => makeSlimSaveArtEntry(entry, tabKey, scenarioPath, scenarioSearchPaths)).filter(Boolean)
      };
    });
    return {
      mode,
      scenarioSearchFolders: folders,
      scenarioPath,
      scenarioSearchPaths,
      tabs
    };
  } catch (err) {
    return {
      mode: 'unavailable',
      error: err && err.message ? String(err.message) : 'Could not build save art context.',
      scenarioSearchFolders: splitScenarioSearchFolderValue(gameRules && gameRules.scenarioSearchFolders),
      scenarioPath: '',
      scenarioSearchPaths: [],
      tabs: {}
    };
  }
}

function formatYesNo(value) {
  return value ? 'Yes' : 'No';
}

function bitSet(value, bit) {
  return ((Number(value) || 0) & (1 << bit)) !== 0;
}

function playerBitMask(playerID) {
  const id = Number(playerID);
  if (!Number.isFinite(id) || id < 0 || id > 31) return 0;
  return (1 << id) >>> 0;
}

function countBits32(value) {
  let n = (Number(value) || 0) >>> 0;
  let count = 0;
  while (n) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}

function formatGameDate(turnNumber, gameRules) {
  let year = Number(gameRules && gameRules.startYear);
  if (!Number.isFinite(year)) year = -4000;
  let remaining = Math.max(0, Number(turnNumber) || 0);
  const spans = Array.isArray(gameRules && gameRules.turnsPerTimescale) ? gameRules.turnsPerTimescale : [];
  const units = Array.isArray(gameRules && gameRules.timeUnitsPerTurn) ? gameRules.timeUnitsPerTurn : [];
  for (let i = 0; i < spans.length && remaining > 0; i += 1) {
    const spanTurns = Math.max(0, Number(spans[i]) || 0);
    const step = Number(units[i]) || 1;
    const used = Math.min(remaining, spanTurns);
    year += used * step;
    remaining -= used;
  }
  if (remaining > 0) year += remaining;
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year} AD`;
}

function traitsForRace(race) {
  const value = Number(race && race.bonuses) || 0;
  return TRAIT_BITS.filter(([mask]) => (value & mask) !== 0).map(([, label]) => label);
}

function ordinal(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return '';
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

function competitionRank(items, valueKey, playerID) {
  const current = items.find((item) => item.playerID === playerID);
  if (!current) return '';
  const value = Number(current[valueKey]) || 0;
  const higher = items.filter((item) => (Number(item[valueKey]) || 0) > value).length;
  return ordinal(higher + 1);
}

function readInt32Safe(buf, offset, fallback = 0) {
  if (!Buffer.isBuffer(buf) || offset < 0 || offset + 4 > buf.length) return fallback;
  return buf.readInt32LE(offset);
}

function readUInt8Safe(buf, offset, fallback = 0) {
  if (!Buffer.isBuffer(buf) || offset < 0 || offset >= buf.length) return fallback;
  return buf.readUInt8(offset);
}

function activePlayers(players, game = null) {
  const remainingMask = Number(game && game.remainingPlayersMask);
  const hasRemainingMask = Number.isFinite(remainingMask) && remainingMask !== 0;
  return players
    .filter((player) => {
      const playerID = Number(player && player.playerID);
      if (!(playerID > 0) || Number(player && player.raceID) < 0) return false;
      if (hasRemainingMask) return (((remainingMask >>> 0) & playerBitMask(playerID)) !== 0);
      return Number(player && player.capitalCity) >= 0;
    })
    .sort((a, b) => Number(a.playerID) - Number(b.playerID));
}

function findHumanPlayer(players, humanPlayersMask, game = null) {
  const mask = (Number(humanPlayersMask) || 0) >>> 0;
  const active = activePlayers(players, game);
  return active.find((player) => ((mask & playerBitMask(Number(player.playerID))) !== 0)) || active[0] || null;
}

function normalizeColorSlot(value) {
  const slot = Number(value);
  return Number.isFinite(slot) && slot >= 0 ? Math.max(0, Math.min(31, slot | 0)) : null;
}

function getPlayerDefaultColorSlot(race = null) {
  const defaultSlot = Number(race && race.defaultColor);
  return normalizeColorSlot(defaultSlot);
}

function getPlayerUniqueColorSlot(race = null) {
  const uniqueSlot = Number(race && race.uniqueColor);
  return normalizeColorSlot(uniqueSlot);
}

function buildPlayerColorSlots(players, races) {
  const slots = new Map();
  const used = new Set();
  const pushFallbacks = (out, race) => {
    const defaultSlot = getPlayerDefaultColorSlot(race);
    const uniqueSlot = getPlayerUniqueColorSlot(race);
    if (defaultSlot !== null) out.push(defaultSlot);
    if (uniqueSlot !== null && uniqueSlot !== defaultSlot) out.push(uniqueSlot);
    CIV_COLOR_DUPLICATE_FALLBACK_SLOTS.forEach((slot) => out.push(slot));
    for (let slot = 0; slot < 32; slot += 1) out.push(slot);
  };
  for (const player of players || []) {
    const playerID = Number(player && player.playerID);
    if (!Number.isFinite(playerID) || playerID < 0) continue;
    const race = races && races[Number(player.raceID)] || null;
    const candidates = [];
    pushFallbacks(candidates, race);
    let resolved = null;
    for (const candidate of candidates) {
      const slot = normalizeColorSlot(candidate);
      if (slot === null || used.has(slot)) continue;
      resolved = slot;
      break;
    }
    if (resolved === null) resolved = getPlayerDefaultColorSlot(race);
    if (resolved !== null) {
      slots.set(playerID, resolved);
      used.add(resolved);
    }
  }
  return slots;
}

function getPlayerColorSlot(player, race = null, colorSlotsByPlayer = null) {
  const playerID = Number(player && player.playerID);
  if (colorSlotsByPlayer instanceof Map && colorSlotsByPlayer.has(playerID)) return colorSlotsByPlayer.get(playerID);
  return getPlayerDefaultColorSlot(race);
}

function getPlayerColorCss(colorSlot) {
  const slot = Number(colorSlot);
  return CIV_COLOR_SWATCHES[Math.max(0, Number.isFinite(slot) ? slot : 0) % CIV_COLOR_SWATCHES.length];
}

function parsePlayerDetails(buf, players, cityById) {
  const ordered = Array.isArray(players) ? players.slice().sort((a, b) => Number(a.offset) - Number(b.offset)) : [];
  const nextByOffset = new Map();
  for (let i = 0; i < ordered.length; i += 1) {
    nextByOffset.set(ordered[i].offset, ordered[i + 1] ? ordered[i + 1].offset : buf.length);
  }
  return new Map(players.map((player) => {
    const body = Number(player.offset) + 8;
    const gold = readInt32Safe(buf, body + 40) + readInt32Safe(buf, body + 44);
    const government = readInt32Safe(buf, body + 132, -1);
    const era = readInt32Safe(buf, body + 216, -1);
    const units = readInt32Safe(buf, body + 368, 0);
    const cities = readInt32Safe(buf, body + 376, 0);
    const relationVectorOffset = body + 3349;
    const culture = findCultureBlock(buf, body + Number(player.dataLength), nextByOffset.get(player.offset), player.playerID);
    const capital = cityById.get(Number(player.capitalCity)) || null;
    return [player.playerID, {
      gold,
      government,
      era,
      units,
      cities,
      capitalName: capital && capital.name ? capital.name : '',
      relationVectorOffset,
      cultureTotal: culture ? culture.total : 0,
      culturePerTurn: culture ? culture.perTurn : 0,
    }];
  }));
}

function findCultureBlock(buf, start, end, playerID) {
  const limit = Math.min(Number(end) || buf.length, buf.length);
  let off = buf.indexOf(Buffer.from('CULT', 'latin1'), Math.max(0, Number(start) || 0));
  while (off >= 0 && off + 24 <= limit) {
    const length = buf.readUInt32LE(off + 4);
    if (length === 16 && off + 8 + length <= limit) {
      const owner = buf.readInt32LE(off + 20);
      if (owner === Number(playerID)) {
        return {
          offset: off,
          total: buf.readInt32LE(off + 12),
          perTurn: buf.readInt32LE(off + 16),
        };
      }
    }
    off = buf.indexOf(Buffer.from('CULT', 'latin1'), off + 1);
  }
  return null;
}

function findInt32Vector(buf, from, values) {
  if (!Array.isArray(values) || values.length === 0) return -1;
  const start = Math.max(0, Number(from) || 0);
  const max = buf.length - values.length * 4;
  for (let off = start; off <= max; off += 1) {
    let matched = true;
    for (let i = 0; i < values.length; i += 1) {
      if (buf.readInt32LE(off + i * 4) !== values[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return off;
  }
  return -1;
}

function parseScoreSummaryBlock(buf, report, players) {
  const scores = new Map();
  if (!Buffer.isBuffer(buf)) return scores;
  const turnNumber = Number(report && report.game && report.game.turnNumber);
  if (!Number.isFinite(turnNumber)) return scores;
  const active = activePlayers(players, report && report.game);
  const activeIDs = active
    .map((player) => Number(player.playerID))
    .filter((playerID) => Number.isInteger(playerID) && playerID >= 0 && playerID < 32);
  if (activeIDs.length === 0) return scores;

  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const start = Math.max(0, Number(report && report.parseOffsets && report.parseOffsets.cityEnd) || 0);
  const max = buf.length - 24;
  for (let off = start; off <= max; off += 1) {
    if (readInt32Safe(buf, off, null) !== turnNumber) continue;
    const year = readInt32Safe(buf, off + 4, null);
    if (!Number.isInteger(year) || year < -4000 || year > 9999) continue;
    const count = readInt32Safe(buf, off + 8, 0);
    if (!Number.isInteger(count) || count < activeIDs.length || count > 32) continue;

    const idsBase = off + 12;
    const powersBase = idsBase + count * 4;
    const scoreBase = powersBase + count * 4;
    const cultureBase = scoreBase + count * 4;
    if (cultureBase + count * 4 > buf.length) continue;

    const ids = [];
    const seen = new Set();
    let validIDs = true;
    for (let i = 0; i < count; i += 1) {
      const playerID = readInt32Safe(buf, idsBase + i * 4, -1);
      if (!Number.isInteger(playerID) || playerID < 0 || playerID >= 32 || seen.has(playerID)) {
        validIDs = false;
        break;
      }
      seen.add(playerID);
      ids.push(playerID);
    }
    if (!validIDs) continue;
    if (!activeIDs.every((playerID) => seen.has(playerID))) continue;

    let matchedPowers = 0;
    for (let i = 0; i < count; i += 1) {
      const player = playerById.get(ids[i]);
      if (!player) continue;
      if (readInt32Safe(buf, powersBase + i * 4, null) === (Number(player.power) || 0)) {
        matchedPowers += 1;
      }
    }
    if (matchedPowers < Math.max(3, activeIDs.length)) continue;

    const parsed = new Map();
    let validScores = true;
    for (let i = 0; i < count; i += 1) {
      const score = readInt32Safe(buf, scoreBase + i * 4, null);
      const culture = readInt32Safe(buf, cultureBase + i * 4, null);
      if (!Number.isInteger(score) || score < 0 || score > 10000000 || !Number.isInteger(culture) || culture < 0) {
        validScores = false;
        break;
      }
      parsed.set(ids[i], {
        power: readInt32Safe(buf, powersBase + i * 4, 0),
        score,
        culture,
      });
    }
    if (!validScores) continue;
    return parsed;
  }
  return scores;
}

function parseLegacyScoreTail(buf, report, players) {
  const active = activePlayers(players, report && report.game);
  const powers = active.map((player) => Number(player.power) || 0);
  const base = findInt32Vector(buf, report.parseOffsets && report.parseOffsets.cityEnd, powers);
  const scores = new Map();
  if (base < 0) return scores;
  const scoreBase = base + active.length * 4;
  const cultureBase = scoreBase + active.length * 4;
  for (let i = 0; i < active.length; i += 1) {
    scores.set(active[i].playerID, {
      power: readInt32Safe(buf, base + i * 4),
      score: readInt32Safe(buf, scoreBase + i * 4),
      culture: readInt32Safe(buf, cultureBase + i * 4),
    });
  }
  return scores;
}

function parseScoreTail(buf, report, players) {
  const summaryScores = parseScoreSummaryBlock(buf, report, players);
  return summaryScores.size > 0 ? summaryScores : parseLegacyScoreTail(buf, report, players);
}

function parseKnownTiles(buf, report, humanMask) {
  const start = Number(report.parseOffsets && report.parseOffsets.afterWorld) || -1;
  const tileCount = Math.floor((Number(report.world && report.world.width) || 0) * (Number(report.world && report.world.height) || 0) / 2);
  const knownLandByPlayer = new Map();
  const cityExploredMaskById = new Map();
  if (start < 0 || tileCount <= 0) return { knownLandByPlayer, cityExploredMaskById };
  let off = start;
  for (let i = 0; i < tileCount; i += 1) {
    if (off + 8 > buf.length || buf.subarray(off, off + 4).toString('latin1') !== 'TILE') break;
    const len1 = buf.readUInt32LE(off + 4);
    const body1 = off + 8;
    const riverInfo = body1 + 1 <= buf.length ? buf.readUInt8(body1) : 0;
    const owner = body1 + 2 <= buf.length ? buf.readInt8(body1 + 1) : -1;
    const resource = body1 + 8 <= buf.length ? buf.readInt32LE(body1 + 4) : -1;
    const riverData = body1 + 18 <= buf.length ? buf.readUInt8(body1 + 17) : 0;
    const cityID = body1 + 24 <= buf.length ? buf.readInt16LE(body1 + 22) : -1;
    const off2 = off + 8 + len1;
    if (off2 + 8 > buf.length || buf.subarray(off2, off2 + 4).toString('latin1') !== 'TILE') break;
    const len2 = buf.readUInt32LE(off2 + 4);
    const off3 = off2 + 8 + len2;
    if (off3 + 8 > buf.length || buf.subarray(off3, off3 + 4).toString('latin1') !== 'TILE') break;
    const len3 = buf.readUInt32LE(off3 + 4);
    const off4 = off3 + 8 + len3;
    if (off4 + 8 > buf.length || buf.subarray(off4, off4 + 4).toString('latin1') !== 'TILE') break;
    const len4 = buf.readUInt32LE(off4 + 4);
    const exploredBy = readInt32Safe(buf, off4 + 8, 0);
    if (((exploredBy >>> 0) & ((Number(humanMask) || 0) >>> 0)) !== 0) {
      if (owner >= 0) knownLandByPlayer.set(owner, (knownLandByPlayer.get(owner) || 0) + 1);
      if (cityID >= 0) cityExploredMaskById.set(cityID, exploredBy);
    }
    off = off4 + 8 + len4;
  }
  return { knownLandByPlayer, cityExploredMaskById };
}

function tileCoordsByIndex(width, index) {
  const halfWidth = Math.floor((Number(width) || 0) / 2);
  if (halfWidth <= 0) return { x: 0, y: 0 };
  const y = Math.floor(Number(index) / halfWidth);
  let x = (Number(index) % halfWidth) * 2;
  if ((y & 1) === 1) x += 1;
  return { x, y };
}

function parseTerritoryTiles(buf, report) {
  const start = Number(report.parseOffsets && report.parseOffsets.afterWorld) || -1;
  const width = Number(report.world && report.world.width) || 0;
  const height = Number(report.world && report.world.height) || 0;
  const tileCount = Math.floor((width * height) / 2);
  const tiles = [];
  if (!Buffer.isBuffer(buf) || start < 0 || tileCount <= 0) return tiles;
  let off = start;
  for (let index = 0; index < tileCount; index += 1) {
    if (off + 8 > buf.length || buf.subarray(off, off + 4).toString('latin1') !== 'TILE') break;
    const len1 = buf.readUInt32LE(off + 4);
    const body1 = off + 8;
    const riverInfo = body1 + 1 <= buf.length ? buf.readUInt8(body1) : 0;
    const owner = body1 + 2 <= buf.length ? buf.readInt8(body1 + 1) : -1;
    const resource = body1 + 8 <= buf.length ? buf.readInt32LE(body1 + 4) : -1;
    const riverData = body1 + 18 <= buf.length ? buf.readUInt8(body1 + 17) : 0;
    const cityID = body1 + 24 <= buf.length ? buf.readInt16LE(body1 + 22) : -1;
    const off2 = off + 8 + len1;
    if (off2 + 8 > buf.length || buf.subarray(off2, off2 + 4).toString('latin1') !== 'TILE') break;
    const len2 = buf.readUInt32LE(off2 + 4);
    const body2 = off2 + 8;
    const c3cOverlays = body2 + 4 <= buf.length ? buf.readUInt32LE(body2) : 0;
    const c3cBaseRealTerrain = body2 + 6 <= buf.length ? buf.readUInt8(body2 + 5) : 0;
    const terrainID = c3cBaseRealTerrain & 0x0f;
    const off3 = off2 + 8 + len2;
    if (off3 + 8 > buf.length || buf.subarray(off3, off3 + 4).toString('latin1') !== 'TILE') break;
    const len3 = buf.readUInt32LE(off3 + 4);
    const off4 = off3 + 8 + len3;
    if (off4 + 8 > buf.length || buf.subarray(off4, off4 + 4).toString('latin1') !== 'TILE') break;
    const len4 = buf.readUInt32LE(off4 + 4);
    const body4 = off4 + 8;
    const exploredBy = readInt32Safe(buf, body4, 0) >>> 0;
    const visibleBy = (
      (readInt32Safe(buf, body4 + 4, 0) >>> 0)
      | (readInt32Safe(buf, body4 + 8, 0) >>> 0)
      | (readInt32Safe(buf, body4 + 12, 0) >>> 0)
    ) >>> 0;
    const cityWithWorkers = body4 + 22 <= buf.length ? buf.readInt16LE(body4 + 20) : -1;
    const coords = tileCoordsByIndex(width, index);
    tiles.push({
      index,
      x: coords.x,
      y: coords.y,
      owner,
      cityID,
      resource,
      terrainID,
      riverInfo,
      riverData,
      river: riverInfo !== 0 || riverData !== 0,
      c3cOverlays,
      exploredBy,
      visibleBy,
      cityWithWorkers,
      roaded: (c3cOverlays & 0x01) !== 0,
      railroaded: (c3cOverlays & 0x02) !== 0,
      mined: (c3cOverlays & 0x04) !== 0,
      irrigated: (c3cOverlays & 0x08) !== 0,
    });
    off = off4 + 8 + len4;
  }
  return tiles;
}

function alignC3XChunkOffset(offset) {
  return (Number(offset) + 4) & ~3;
}

const C3X_MOD_SAVE_BOOKEND = Buffer.from([0x22, 0x43, 0x33, 0x58]);

function getC3XModSaveSegment(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) {
    return {
      hasC3XSegment: false,
      segmentSize: 0,
      segmentStart: -1,
      segmentEnd: -1,
      chunks: [],
    };
  }
  if (!buf.subarray(buf.length - 4).equals(C3X_MOD_SAVE_BOOKEND)) {
    return {
      hasC3XSegment: false,
      segmentSize: 0,
      segmentStart: -1,
      segmentEnd: -1,
      chunks: [],
    };
  }
  const segmentSize = buf.readInt32LE(buf.length - 8);
  const segmentStart = buf.length - segmentSize - 8;
  const segmentEnd = segmentStart + segmentSize;
  if (segmentSize <= 0 || segmentStart < 4 || segmentEnd > buf.length - 8
    || !buf.subarray(segmentStart - 4, segmentStart).equals(C3X_MOD_SAVE_BOOKEND)) {
    return {
      hasC3XSegment: false,
      segmentSize: 0,
      segmentStart: -1,
      segmentEnd: -1,
      chunks: [],
    };
  }
  const segment = buf.subarray(segmentStart, segmentEnd);
  const chunks = [];
  const knownLabels = [
    'district_config_names',
    'district_pending_requests',
    'distribution_hub_records',
    'district_tile_map',
    'natural_wonder_districts',
    'great_wall_auto_build_done_civs',
  ];
  for (const label of knownLabels) {
    const labelOffset = segment.indexOf(Buffer.from(label, 'latin1'));
    if (labelOffset >= 0) chunks.push(label);
  }
  return {
    hasC3XSegment: true,
    segmentSize,
    segmentStart,
    segmentEnd,
    chunks,
  };
}

function parseC3XDistrictTileMap(buf, c3xSegmentInfo = null) {
  const bookend = Buffer.from([0x22, 0x43, 0x33, 0x58]);
  if (!Buffer.isBuffer(buf) || buf.length < 12) return [];
  const info = c3xSegmentInfo && typeof c3xSegmentInfo === 'object'
    ? c3xSegmentInfo
    : getC3XModSaveSegment(buf);
  if (!info.hasC3XSegment) return [];
  const segmentSize = Number(info.segmentSize) || 0;
  const segmentStart = Number(info.segmentStart);
  if (segmentSize <= 0 || segmentStart < 4 || !buf.subarray(segmentStart - 4, segmentStart).equals(bookend)) return [];
  const segment = buf.subarray(segmentStart, segmentStart + segmentSize);
  const label = Buffer.from('district_tile_map', 'latin1');
  const labelOffset = segment.indexOf(label);
  if (labelOffset < 0) return [];
  const dataOffset = alignC3XChunkOffset(labelOffset + label.length);
  if (dataOffset + 4 > segment.length) return [];
  const count = segment.readInt32LE(dataOffset);
  const bytesNeeded = 4 + count * 9 * 4;
  if (count < 0 || count > 100000 || dataOffset + bytesNeeded > segment.length) return [];
  const rows = [];
  let off = dataOffset + 4;
  for (let i = 0; i < count; i += 1) {
    rows.push({
      x: segment.readInt32LE(off),
      y: segment.readInt32LE(off + 4),
      districtID: segment.readInt32LE(off + 8),
      state: segment.readInt32LE(off + 12),
      builtByCivID: segment.readInt32LE(off + 16),
      completedTurn: segment.readInt32LE(off + 20),
      wonderState: segment.readInt32LE(off + 24),
      wonderCityID: segment.readInt32LE(off + 28),
      wonderIndex: segment.readInt32LE(off + 32),
    });
    off += 9 * 4;
  }
  return rows;
}

function displayGold(value) {
  return Number(value) || 0;
}

function relationFor(humanDetails, playerID) {
  const offset = Number(humanDetails && humanDetails.relationVectorOffset) + Number(playerID) - 1;
  const value = readUInt8Safe(humanDetails && humanDetails.buffer, offset, 0);
  return value === 1 ? { label: 'War', atWar: true } : { label: 'Peace', atWar: false };
}

function readLeadInt32(buf, player, bodyOffset, fallback = 0) {
  return readInt32Safe(buf, Number(player && player.offset) + 8 + Number(bodyOffset), fallback);
}

function readLeadVectorInt32(buf, player, bodyOffset, length = 32) {
  const values = [];
  for (let i = 0; i < length; i += 1) values.push(readLeadInt32(buf, player, Number(bodyOffset) + i * 4, 0));
  return values;
}

function parseTechCivMasks(buf, game, techCount) {
  const count = Math.max(0, Number(techCount) || 0);
  const offset = Number(game && game.offset) + 4 + 852 + 4 * (Number(game && game.numConts) || 0);
  const masks = [];
  for (let i = 0; i < count; i += 1) masks.push(readInt32Safe(buf, offset + i * 4, 0) >>> 0);
  return masks;
}

function playerHasTech(techMasks, techIndex, playerID) {
  const mask = (techMasks[techIndex] || 0) >>> 0;
  return (mask & (1 << Number(playerID))) !== 0;
}

function getTechnologyPrerequisites(tech) {
  const prereqKeys = ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4'];
  const source = tech || {};
  return Array.isArray(source.prerequisites)
    ? source.prerequisites
    : prereqKeys.map((key) => source[key]);
}

function isTechnologyTradeable(tech) {
  return (((Number(tech && tech.flags) || 0) >>> 0) & 0x80000) === 0;
}

function canTradeTechToPlayer(techs, techMasks, playerID, techIndex) {
  const tech = techs[techIndex] || {};
  if (!isTechnologyTradeable(tech)) return false;
  const prerequisites = getTechnologyPrerequisites(tech);
  for (const value of prerequisites) {
    const prereq = Number(value);
    if (Number.isFinite(prereq) && prereq >= 0 && !playerHasTech(techMasks, prereq, playerID)) return false;
  }
  return true;
}

function hasResearchPrereqs(techs, techMasks, playerID, techIndex, eraIndex) {
  const tech = techs[techIndex] || {};
  const techEra = Number(tech.era);
  if (Number.isFinite(techEra) && techEra >= 0 && Number.isFinite(Number(eraIndex)) && techEra > Number(eraIndex)) return false;
  const prerequisites = getTechnologyPrerequisites(tech);
  for (const value of prerequisites) {
    const prereq = Number(value);
    if (Number.isFinite(prereq) && prereq >= 0 && !playerHasTech(techMasks, prereq, playerID)) return false;
  }
  return true;
}

function estimateTechCost(tech, techIndex, context) {
  const baseCost = Math.max(0, Number(tech && tech.cost) || 0);
  const activeMask = (Number(context && context.activePlayersMask) || 0) >>> 0;
  const activeCount = Math.max(1, countBits32(activeMask));
  const knownDenominator = Math.max(1, Math.floor((activeCount * 7) / 4));
  const humanPlayerID = Number(context && context.humanPlayerID);
  const contacts = Array.isArray(context && context.contacts) ? context.contacts : [];
  let knownCount = 0;
  for (let playerID = 1; playerID < 32; playerID += 1) {
    if ((activeMask & (1 << playerID)) === 0) continue;
    if (!playerHasTech(context.techMasks, techIndex, playerID)) continue;
    if (playerID === humanPlayerID || ((Number(contacts[playerID]) || 0) & 1) !== 0) knownCount += 1;
  }
  const productionFactor = bitSet(context.gameRules, 5) ? 5 : 10;
  const discounted = Math.trunc(((knownDenominator - knownCount) * baseCost * productionFactor) / knownDenominator);
  const costFactor = Math.max(1, Math.min(10, Number(context.difficultyCostFactor) || 10));
  const worldTechRate = Math.max(1, Number(context.worldTechRate) || 100);
  return Math.max(1, Math.trunc((worldTechRate * discounted) / (costFactor * 10)));
}

function makeTechnologyReport(context) {
  const {
    buf, report, human, humanDetails, humanEra, techs, eras, races, rivalRows, techMasks, ruleSignatures,
    worldSizes, difficulties,
  } = context;
  const currentTechID = readLeadInt32(buf, human, 224, -1);
  const gatheredBeakers = Math.max(0, readLeadInt32(buf, human, 220, 0));
  const gatheredTurns = Math.max(0, readLeadInt32(buf, human, 228, 0));
  const scienceRate = Math.max(0, readLeadInt32(buf, human, 396, 0)) * 10;
  const grossCommercePerTurn = (report.cities && report.cities.records || [])
    .filter((city) => Number(city.owner) === Number(human.playerID))
    .reduce((sum, city) => sum + (Number(city.commercePerTurn) || 0), 0);
  const worldSize = worldSizes[Number(report.world && report.world.worldSize)] || {};
  const difficulty = difficulties[Number(report.game && report.game.difficulty)] || {};
  const beakersPerTurn = Math.max(0, Math.round(
    grossCommercePerTurn * (scienceRate / 100) * (Math.min(10, Number(difficulty.costFactor) || 10) / 10)
  ));
  const contacts = readLeadVectorInt32(buf, human, 3732, 32);
  const costContext = {
    activePlayersMask: report.game.remainingPlayersMask,
    humanPlayerID: human.playerID,
    contacts,
    techMasks,
    gameRules: report.game.rules,
    difficultyCostFactor: difficulty.costFactor,
    worldTechRate: worldSize.techRate,
  };
  const currentTech = techs[currentTechID] || null;
  const requiredBeakers = currentTech ? estimateTechCost(currentTech, currentTechID, costContext) : 0;
  const remainingBeakers = Math.max(0, requiredBeakers - gatheredBeakers);
  const remainingTurns = remainingBeakers > 0 && beakersPerTurn > 0 ? Math.ceil(remainingBeakers / beakersPerTurn) : 0;
  const requiredTurns = gatheredTurns + remainingTurns;
  const endWastage = remainingTurns > 0 ? Math.max(0, remainingTurns * beakersPerTurn - remainingBeakers) : 0;
  const wastagePercent = remainingBeakers > 0 ? Math.floor((endWastage * 100) / remainingBeakers) : 0;
  const optionalSkipped = techs
    .map((tech, index) => ({ tech, index }))
    .filter(({ tech, index }) => Number(tech && tech.era) >= 0
      && Number(tech.era) < humanEra
      && ((Number(tech.flags) || 0) & 0x20000) !== 0
      && !playerHasTech(techMasks, index, human.playerID))
    .map(({ tech, index }) => {
      const name = recordName(techs, index, 'TECH', '');
      return { name, ref: makeRef('technologies', 'TECH', index, name, ruleSignatures) };
    });
  const currentEraName = recordName(eras, humanEra, 'ERAS', '');
  const currentProjectName = recordName(techs, currentTechID, 'TECH', '');
  const rows = techs
    .map((tech, index) => ({ tech, index }))
    .filter(({ tech }) => Number(tech && tech.era) >= 0)
    .map(({ tech, index }) => {
      const name = recordName(techs, index, 'TECH', '');
      const knownTo = rivalRows
        .filter((rival) => playerHasTech(techMasks, index, rival.playerID))
        .map((rival) => ({
          name: rival.nation,
          ref: rival.nationRef,
          color: rival.color,
          colorSlot: rival.colorSlot,
        }));
      const humanKnows = playerHasTech(techMasks, index, human.playerID);
      const researching = index === currentTechID;
      const available = !humanKnows && !researching && hasResearchPrereqs(techs, techMasks, human.playerID, index, humanEra);
      return {
        index: index + 1,
        biqIndex: index,
        name,
        ref: makeRef('technologies', 'TECH', index, name, ruleSignatures),
        optional: ((Number(tech.flags) || 0) & 0x20000) !== 0,
        knownTo,
        knownToText: knownTo.length > 0 ? `(${knownTo.length}) ${knownTo.map((item) => item.name).join(', ')}` : '',
        estimatedCost: estimateTechCost(tech, index, costContext),
        status: researching ? 'researching' : humanKnows ? 'known' : available ? 'available' : 'unavailable',
      };
    });
  return {
    currentEra: currentEraName,
    currentEraRef: makeRef('world', 'ERAS', humanEra, currentEraName, ruleSignatures),
    techsKnown: techs.filter((tech, index) => Number(tech && tech.era) >= 0 && playerHasTech(techMasks, index, human.playerID)).length,
    optionalSkipped,
    currentProject: currentProjectName,
    currentProjectRef: makeRef('technologies', 'TECH', currentTechID, currentProjectName, ruleSignatures),
    scienceRate: `${scienceRate}%`,
    beakersPerTurn,
    progress: {
      required: { beakers: requiredBeakers, turns: requiredTurns },
      gathered: { beakers: gatheredBeakers, turns: gatheredTurns },
      remaining: { beakers: remainingBeakers, turns: remainingTurns },
      endWastage: { beakers: endWastage, detail: `${wastagePercent}% of ${remainingBeakers}` },
    },
    rows,
  };
}

function formatBuiltDate(year) {
  const value = Number(year) || 0;
  return value < 0 ? `${Math.abs(value)} BC` : `${value} AD`;
}

function cityHasBuilding(city, buildingIndex) {
  const records = Array.isArray(city && city.buildingRecords) ? city.buildingRecords : [];
  return records.some((item) => Number(item.buildingIndex) === Number(buildingIndex) && Number(item.originalOwner) >= 0);
}

function makeCityBuildingStatus(context) {
  const {
    city, building, buildingIndex, humanCities, builtLocations,
    report, human, techs, techMasks, ruleSignatures,
  } = context || {};
  const savedByIndex = new Map((city && city.buildingRecords || []).map((item) => [Number(item.buildingIndex), item]));
  const saved = savedByIndex.get(Number(buildingIndex)) || { originalOwner: -1, yearBuilt: 0 };
  const isGreatWonder = (((Number(building && building.otherChar) || 0) >>> 0) & 4) !== 0;
  const builtHere = Number(saved.originalOwner) >= 0;
  const builtElsewhere = isGreatWonder && builtLocations ? builtLocations.get(Number(buildingIndex)) : null;
  const missing = [];
  const reqAdvance = Number(building && building.reqAdvance);
  if (Number.isFinite(reqAdvance) && reqAdvance >= 0 && !playerHasTech(techMasks, reqAdvance, human && human.playerID)) {
    missing.push(recordName(techs, reqAdvance, 'TECH', `Technology ${reqAdvance}`));
  }
  const reqImprovement = Number(building && building.reqImprovement);
  const requiredCount = Math.max(0, Number(building && building.numReqBuildings) || 0);
  if (Number.isFinite(reqImprovement) && reqImprovement >= 0) {
    const requirementName = recordName(context && context.buildings || [], reqImprovement, 'BLDG', `Improvement ${reqImprovement}`);
    if (requiredCount > 1) {
      const ownedCount = (humanCities || []).filter((item) => cityHasBuilding(item, reqImprovement)).length;
      if (ownedCount < requiredCount) missing.push(`${requiredCount - ownedCount} more ${requirementName}${requiredCount - ownedCount === 1 ? '' : 's'}`);
    } else if (!cityHasBuilding(city, reqImprovement)) {
      missing.push(requirementName);
    }
  }
  if ((((Number(building && building.smallWonderCharacteristics) || 0) >>> 0) & 0x400) !== 0) missing.push('victorious Army');
  if (Number(building && building.armiesRequired) > 0) missing.push(`${Number(building.armiesRequired)} Armies`);
  const obsoleteBy = Number(building && building.obsoleteBy);
  const obsolete = Number.isFinite(obsoleteBy) && obsoleteBy >= 0 && playerHasTech(techMasks, obsoleteBy, human && human.playerID);
  const improvementFlags = (Number(building && building.improvements) || 0) >>> 0;
  const otherCharacteristics = (Number(building && building.otherChar) || 0) >>> 0;
  const locationIssue = (otherCharacteristics & 1) !== 0
    ? 'City not on coast'
    : (improvementFlags & 0x8000) !== 0
      ? 'City not on river'
      : '';
  const cost = Math.max(0, Number(building && building.cost) || 0) * 10;
  const projectedShields = Math.max(0, Number(city && city.shieldsPerTurn) || Number(city && city.productionIncome) || 0) + 1;
  const collected = Math.max(0, Number(city && city.shieldsCollected) || 0);
  const turnsNeeded = projectedShields > 0
    ? Math.max(0, Math.floor(Math.max(0, cost - collected) / projectedShields))
    : null;
  let status = '';
  let statusKind = 'unavailable';
  if (builtHere) {
    status = `Built in ${formatBuiltDate(saved.yearBuilt)}`;
    statusKind = 'built';
  } else if (obsolete) {
    status = 'Expired';
    statusKind = 'expired';
  } else if (builtElsewhere && Number(builtElsewhere.cityID) !== Number(city && city.id)) {
    const builtCity = report && report.cities && report.cities.records
      ? report.cities.records.find((item) => Number(item.id) === Number(builtElsewhere.cityID))
      : null;
    const owner = builtElsewhere.civilization && Number(builtCity && builtCity.owner) !== Number(human && human.playerID)
      ? ` [${builtElsewhere.civilization}]`
      : '';
    status = `Already built in ${builtElsewhere.cityName}${owner}`;
    statusKind = 'elsewhere';
  } else if (locationIssue) {
    status = locationIssue;
  } else if (missing.length > 0) {
    status = `Need ${missing.join(' and ')}`;
  } else {
    status = turnsNeeded == null ? 'Available' : `Available, ${turnsNeeded} turns needed`;
    statusKind = 'available';
  }
  return {
    buildingIndex: Number(buildingIndex),
    status,
    statusKind,
    ref: makeRef('improvements', 'BLDG', buildingIndex, recordName(context && context.buildings || [], buildingIndex, 'BLDG', ''), ruleSignatures),
  };
}

function isWonderBuilding(building) {
  const otherChar = (Number(building && building.otherChar) || 0) >>> 0;
  const smallWonderCharacteristics = (Number(building && building.smallWonderCharacteristics) || 0) >>> 0;
  return (otherChar & 4) !== 0 || smallWonderCharacteristics !== 0;
}

function getProductionFacet(orderType, order) {
  if (!order) return 'other';
  if (orderType === 1) return isWonderBuilding(order) ? 'wonders' : 'improvements';
  if (orderType === 2) {
    const unitClass = Number(order && order.unitClass);
    if (unitClass === 0) return 'land';
    if (unitClass === 1) return 'sea';
    if (unitClass === 2) return 'air';
  }
  return 'other';
}

function clampCityArtIndex(value, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(n)));
}

function makeCityArtMetadata(city, context) {
  const {
    player, playerDetails, races, ruleRecord,
  } = context || {};
  const population = Math.max(1, Number(city && city.population) || Number(city && city.size) || 1);
  const maxTownSize = Math.max(0, Number(ruleRecord && ruleRecord.maxCity1Size) || 6);
  const maxCitySize = Math.max(maxTownSize, Number(ruleRecord && ruleRecord.maxCity2Size) || 12);
  const raceID = Number(player && player.raceID);
  const race = Number.isFinite(raceID) && races ? races[raceID] : null;
  const rawCultureGroup = race && Number(race.cultureGroup);
  const cultureGroup = clampCityArtIndex(Number.isFinite(rawCultureGroup) && rawCultureGroup >= 0 ? rawCultureGroup : 2, 4, 2);
  const rawEra = Number(playerDetails && playerDetails.era);
  const era = clampCityArtIndex(rawEra === 4 ? 3 : rawEra, 3, 0);
  const hasPalace = Number(city && city.id) === Number(player && player.capitalCity);
  let citySizeBucket = population > maxCitySize ? 2 : (population > maxTownSize ? 1 : 0);
  if (hasPalace && citySizeBucket < 2) citySizeBucket += 1;
  return {
    playerID: Number(player && player.playerID),
    raceID: Number.isFinite(raceID) ? raceID : -1,
    cultureGroup,
    era,
    population,
    citySizeBucket,
    hasPalace,
    hasWalls: !!(city && city.hasWalls),
  };
}

function makeCityOwnerContext(city, context) {
  const {
    human, humanDetails, players, detailsByPlayer, races, ruleRecord, ruleSignatures, colorSlotsByPlayer,
  } = context || {};
  const playerById = context && context.playerById instanceof Map
    ? context.playerById
    : new Map((players || []).map((player) => [Number(player.playerID), player]));
  const ownerPlayer = playerById.get(Number(city && city.owner)) || human || {};
  const ownerDetails = detailsByPlayer && detailsByPlayer.get(Number(ownerPlayer.playerID)) || humanDetails || {};
  const ownerRaceID = Number(ownerPlayer.raceID);
  const ownerName = recordName(races || [], ownerRaceID, 'RACE', '');
  const ownerRace = races && races[ownerRaceID] || null;
  return {
    player: ownerPlayer,
    details: ownerDetails,
    ownerPlayerID: Number(ownerPlayer.playerID),
    ownerRaceID,
    civ: ownerName,
    civRef: makeRef('civilizations', 'RACE', ownerRaceID, ownerName, ruleSignatures),
    colorSlot: getPlayerColorSlot(ownerPlayer, ownerRace, colorSlotsByPlayer),
    cityArt: makeCityArtMetadata(city, {
      player: ownerPlayer,
      playerDetails: ownerDetails,
      races,
      ruleRecord,
    }),
  };
}

function makeCityOwnerFields(ownerContext, include) {
  if (!include || !ownerContext) return {};
  return {
    ownerPlayerID: ownerContext.ownerPlayerID,
    ownerRaceID: ownerContext.ownerRaceID,
    civ: ownerContext.civ,
    civRef: ownerContext.civRef,
    colorSlot: ownerContext.colorSlot,
  };
}

function estimateCultureWinDate({ currentTurn, currentCulture, culturePerTurn, limit, gameRules }) {
  const target = Math.max(0, Number(limit) || 0);
  const gathered = Math.max(0, Number(currentCulture) || 0);
  const perTurn = Math.max(0, Number(culturePerTurn) || 0);
  if (target <= 0 || gathered >= target || perTurn <= 0) return '';
  const turns = Math.ceil((target - gathered) / perTurn);
  return formatGameDate((Number(currentTurn) || 0) + turns, gameRules);
}

function makeCultureReport(context) {
  const {
    report, human, humanVisible, humanDetails, races, players, detailsByPlayer, techs, techMasks, buildings,
    gameRules, ruleRecord, ruleSignatures, allPlayersMode, colorSlotsByPlayer,
  } = context;
  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const activePlayerIDs = new Set(activePlayers(players || [], report && report.game).map((player) => Number(player.playerID)));
  const selectedCityRecords = (report.cities && report.cities.records || [])
    .filter((city) => allPlayersMode ? activePlayerIDs.has(Number(city.owner)) : Number(city.owner) === Number(human.playerID));
  const humanCities = selectedCityRecords
    .map((city) => ({
      id: Number(city.id),
      name: city.name || `City ${city.id}`,
      culture: Number(city.culture) || 0,
      culturePerTurn: Number(city.culturePerTurn) || 0,
      shieldsPerTurn: Number(city.shieldsPerTurn) || 0,
      shieldsCollected: Number(city.shieldsCollected) || 0,
      buildingRecords: Array.isArray(city.buildingRecords) ? city.buildingRecords : [],
      owner: makeCityOwnerContext(city, {
        human,
        humanDetails,
        playerById,
        detailsByPlayer,
        races,
        ruleRecord,
        ruleSignatures,
        colorSlotsByPlayer,
      }),
    }));
  const defaultCityID = humanCities.some((city) => city.id === Number(human.capitalCity))
    ? Number(human.capitalCity)
    : (humanCities[0] ? humanCities[0].id : -1);
  const builtLocations = new Map();
  for (const city of report.cities && report.cities.records || []) {
    for (const item of city.buildingRecords || []) {
      if (Number(item.originalOwner) < 0 || builtLocations.has(Number(item.buildingIndex))) continue;
      const ownerPlayer = playerById.get(Number(city.owner));
      const ownerRace = ownerPlayer ? races[Number(ownerPlayer.raceID)] : null;
      builtLocations.set(Number(item.buildingIndex), {
        cityID: Number(city.id),
        cityName: city.name || '',
        civilization: ownerRace ? recordName(races, ownerPlayer.raceID, 'RACE', '') : '',
      });
    }
  }
  const currentYear = Number(report.game && report.game.turnNumber) >= 0
    ? Number(String(formatGameDate(report.game.turnNumber, gameRules)).split(' ')[0]) * (String(formatGameDate(report.game.turnNumber, gameRules)).endsWith('BC') ? -1 : 1)
    : 0;
  const buildingRowsByCity = {};
  for (const city of humanCities) {
    const cityOwner = city.owner || makeCityOwnerContext(city, {
      human,
      humanDetails,
      playerById,
      detailsByPlayer,
      races,
      ruleRecord,
      ruleSignatures,
      colorSlotsByPlayer,
    });
    const ownerPlayer = cityOwner.player || human;
    const ownerCities = humanCities.filter((item) => Number(item.owner && item.owner.ownerPlayerID) === Number(ownerPlayer.playerID));
    const savedByIndex = new Map(city.buildingRecords.map((item) => [Number(item.buildingIndex), item]));
    buildingRowsByCity[city.id] = buildings.map((building, buildingIndex) => {
      const saved = savedByIndex.get(buildingIndex) || { originalOwner: -1, yearBuilt: 0, culture: 0 };
      const name = recordName(buildings, buildingIndex, 'BLDG', '');
      const culturePerTurn = Math.max(0, Number(building && building.culture) || 0);
      const isGreatWonder = (((Number(building && building.otherChar) || 0) >>> 0) & 4) !== 0;
      const isWonder = isWonderBuilding(building);
      const builtHere = Number(saved.originalOwner) >= 0;
      const builtElsewhere = isGreatWonder ? builtLocations.get(buildingIndex) : null;
      const missing = [];
      const reqAdvance = Number(building && building.reqAdvance);
      if (Number.isFinite(reqAdvance) && reqAdvance >= 0 && !playerHasTech(techMasks, reqAdvance, ownerPlayer.playerID)) {
        missing.push(recordName(techs, reqAdvance, 'TECH', `Technology ${reqAdvance}`));
      }
      const reqImprovement = Number(building && building.reqImprovement);
      const requiredCount = Math.max(0, Number(building && building.numReqBuildings) || 0);
      if (Number.isFinite(reqImprovement) && reqImprovement >= 0) {
        const requirementName = recordName(buildings, reqImprovement, 'BLDG', `Improvement ${reqImprovement}`);
        if (requiredCount > 1) {
          const ownedCount = ownerCities.filter((item) => cityHasBuilding(item, reqImprovement)).length;
          if (ownedCount < requiredCount) missing.push(`${requiredCount - ownedCount} more ${requirementName}${requiredCount - ownedCount === 1 ? '' : 's'}`);
        } else if (!cityHasBuilding(city, reqImprovement)) {
          missing.push(requirementName);
        }
      }
      if ((((Number(building && building.smallWonderCharacteristics) || 0) >>> 0) & 0x400) !== 0) missing.push('victorious Army');
      if (Number(building && building.armiesRequired) > 0) missing.push(`${Number(building.armiesRequired)} Armies`);
      const obsoleteBy = Number(building && building.obsoleteBy);
      const obsolete = Number.isFinite(obsoleteBy) && obsoleteBy >= 0 && playerHasTech(techMasks, obsoleteBy, ownerPlayer.playerID);
      const cost = Math.max(0, Number(building && building.cost) || 0) * 10;
      const projectedShields = city.shieldsPerTurn + 1;
      const turnsNeeded = projectedShields > 0
        ? Math.max(0, Math.floor(Math.max(0, cost - city.shieldsCollected) / projectedShields))
        : null;
      const improvementFlags = (Number(building && building.improvements) || 0) >>> 0;
      const otherCharacteristics = (Number(building && building.otherChar) || 0) >>> 0;
      const locationIssue = (otherCharacteristics & 1) !== 0
        ? 'City not on coast'
        : (improvementFlags & 0x8000) !== 0
          ? 'City not on river'
          : '';
      let status = '';
      let statusKind = 'unavailable';
      if (builtHere) {
        status = `Built in ${formatBuiltDate(saved.yearBuilt)}`;
        statusKind = 'built';
      } else if (obsolete) {
        status = 'Expired';
        statusKind = 'expired';
      } else if (builtElsewhere && builtElsewhere.cityID !== city.id) {
        const owner = builtElsewhere.civilization && Number(report.cities.records.find((item) => Number(item.id) === builtElsewhere.cityID)?.owner) !== Number(ownerPlayer.playerID)
          ? ` [${builtElsewhere.civilization}]`
          : '';
        status = `Already built in ${builtElsewhere.cityName}${owner}`;
        statusKind = 'elsewhere';
      } else if (locationIssue) {
        status = locationIssue;
      } else if (missing.length > 0) {
        status = `Need ${missing.join(' and ')}`;
      } else {
        status = turnsNeeded == null ? 'Available' : `Available, ${turnsNeeded} turns needed`;
        statusKind = 'available';
      }
      const doubled = builtHere && currentYear - Number(saved.yearBuilt) > 999;
      return {
        buildingIndex,
        name,
        ref: makeRef('improvements', 'BLDG', buildingIndex, name, ruleSignatures),
        wonder: isWonder,
        cultural: culturePerTurn > 0,
        status,
        statusKind,
        cost: builtHere ? '' : cost,
        shieldsPerCulture: !builtHere && culturePerTurn > 0 ? (cost / culturePerTurn).toFixed(2) : '',
        culturePerTurn,
        bonus: doubled ? '2x' : '',
        culture: builtHere ? Math.max(0, Number(saved.culture) || 0) : '',
      };
    });
  }
  const civilizationCulture = allPlayersMode
    ? humanCities.reduce((sum, city) => sum + (Number(city.culture) || 0), 0)
    : Number(humanVisible && humanVisible.culture) || Number(humanDetails && humanDetails.cultureTotal) || 0;
  const civilizationCulturePerTurn = allPlayersMode
    ? humanCities.reduce((sum, city) => sum + (Number(city.culturePerTurn) || 0), 0)
    : Number(humanVisible && humanVisible.culturePerTurn) || Number(humanDetails && humanDetails.culturePerTurn) || 0;
  return {
    defaultCityID,
    allCivs: !!allPlayersMode,
    cities: humanCities.map((city) => ({
      id: city.id,
      name: city.name,
      ...makeCityOwnerFields(city.owner, allPlayersMode),
      culture: city.culture,
      culturePerTurn: city.culturePerTurn,
      cityArt: city.owner.cityArt,
      estimatedWinDate: estimateCultureWinDate({
        currentTurn: report.game.turnNumber,
        currentCulture: city.culture,
        culturePerTurn: city.culturePerTurn,
        limit: report.game.oneCityCultureWin,
        gameRules,
      }),
    })),
    civilization: {
      culture: civilizationCulture,
      culturePerTurn: civilizationCulturePerTurn,
      estimatedWinDate: estimateCultureWinDate({
        currentTurn: report.game.turnNumber,
        currentCulture: civilizationCulture,
        culturePerTurn: civilizationCulturePerTurn,
        limit: report.game.allCitiesCultureWin,
        gameRules,
      }),
    },
    buildingRowsByCity,
    wonders: (buildingRowsByCity[defaultCityID] || [])
      .filter((row) => row.wonder)
      .map((row) => ({
        buildingIndex: row.buildingIndex,
        name: row.name,
        ref: row.ref,
        status: row.status,
        statusKind: row.statusKind,
        topLocations: row.statusKind === 'available'
          ? humanCities
            .map((city) => {
              const cityRows = buildingRowsByCity[city.id] || [];
              const cityRow = cityRows.find((item) => Number(item.buildingIndex) === Number(row.buildingIndex));
              const match = String(cityRow && cityRow.status || '').match(/Available,\s*(\d+)\s+turns needed/i);
              return match ? { city: city.name, turns: Number(match[1]) } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.turns - b.turns || String(a.city).localeCompare(String(b.city)))
            .slice(0, 10)
            .map((item) => `${item.city} [${item.turns}]`)
            .join(' and ')
          : '',
      })),
  };
}

function civ3CityDistance(left, right, worldWidth) {
  if (!left || !right) return 0;
  let dx = Number(left.x) - Number(right.x);
  const width = Math.max(0, Number(worldWidth) || 0);
  if (width > 0 && Math.abs(dx) > width / 2) dx += dx < 0 ? width : -width;
  const dy = Number(left.y) - Number(right.y);
  const dq = (dx - dy) / 2;
  return Math.max(Math.abs(dq), Math.abs(dy), Math.abs(dq + dy)) + 1;
}

function makeCitiesReport(context) {
  const {
    report, human, humanDetails, races, ruleRecord, players, detailsByPlayer, ruleSignatures, allPlayersMode, colorSlotsByPlayer,
  } = context;
  const allCities = report.cities && report.cities.records || [];
  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const activePlayerIDs = new Set(activePlayers(players || [], report && report.game).map((player) => Number(player.playerID)));
  const selectedCities = allPlayersMode
    ? allCities.filter((city) => activePlayerIDs.has(Number(city.owner)))
    : allCities.filter((city) => Number(city.owner) === Number(human.playerID));
  const capitalByPlayer = new Map((players || []).map((player) => [
    Number(player.playerID),
    allCities.find((city) => Number(city.id) === Number(player.capitalCity)) || null,
  ]));
  const fallbackCapital = selectedCities.find((city) => Number(city.id) === Number(human.capitalCity)) || selectedCities[0] || null;
  const units = report.units && report.units.records || [];
  return {
    allCivs: !!allPlayersMode,
    rows: selectedCities.map((city) => {
      const ownerPlayer = playerById.get(Number(city.owner)) || human;
      const ownerDetails = detailsByPlayer && detailsByPlayer.get(Number(ownerPlayer.playerID)) || humanDetails;
      const capital = capitalByPlayer.get(Number(ownerPlayer.playerID)) || fallbackCapital;
      const ownerName = recordName(races, Number(ownerPlayer.raceID), 'RACE', '');
      const population = Math.max(0, Number(city.population) || 0);
      const happy = Math.max(0, Number(city.happyCitizens) || 0);
      const unhappy = Math.max(0, Number(city.unhappyCitizens) || 0);
      const corruption = Math.max(0, Number(city.corruption) || 0);
      const waste = Math.max(0, Number(city.productionLoss) || 0);
      const garrison = units.filter((unit) => Number(unit.owner) === Number(ownerPlayer.playerID)
        && Number(unit.x) === Number(city.x)
        && Number(unit.y) === Number(city.y)).length;
      return {
        id: Number(city.id),
        ...(allPlayersMode ? {
          ownerPlayerID: Number(ownerPlayer.playerID),
          ownerRaceID: Number(ownerPlayer.raceID),
          civ: ownerName,
          civRef: makeRef('civilizations', 'RACE', Number(ownerPlayer.raceID), ownerName, ruleSignatures),
          colorSlot: getPlayerColorSlot(ownerPlayer, races[Number(ownerPlayer.raceID)], colorSlotsByPlayer),
        } : {}),
        city: city.name || '',
        cityArt: makeCityArtMetadata(city, {
          player: ownerPlayer,
          playerDetails: ownerDetails,
          races,
          ruleRecord,
        }),
        size: `${Number(city.id) === Number(ownerPlayer.capitalCity) ? '*' : ''}${population}`,
        sizeValue: population,
        happy: population > 0 ? `${Math.round((happy * 100) / population)}%` : '',
        happyValue: population > 0 ? Math.round((happy * 100) / population) : 0,
        unhappy: population > 0 && unhappy > 0 ? `${Math.round((unhappy * 100) / population)}%` : '',
        unhappyValue: population > 0 ? Math.round((unhappy * 100) / population) : 0,
        plus: `${happy - unhappy >= 0 ? '+' : ''}${happy - unhappy}`,
        plusValue: happy - unhappy,
        corruption: corruption > 0 && Number(city.commercePerTurn) > 0
          ? `${Math.floor((corruption * 100) / Number(city.commercePerTurn))}%`
          : '0%',
        corruptionValue: corruption,
        waste: waste > 0 && Number(city.shieldsPerTurn) + waste > 0
          ? `${Math.floor((waste * 100) / (Number(city.shieldsPerTurn) + waste))}%`
          : '0%',
        wasteValue: waste,
        resistors: Number(city.resistingCitizens) > 0 ? Number(city.resistingCitizens) : '',
        aliens: Number(city.alienCitizens) > 0 ? Number(city.alienCitizens) : '',
        entertainers: Number(city.specialistLuxuryIncome) > 0 ? Number(city.specialistLuxuryIncome) : '',
        taxmen: Number(city.specialistTaxIncome) > 0 ? Number(city.specialistTaxIncome) : '',
        scientists: Number(city.specialistScienceIncome) > 0 ? Number(city.specialistScienceIncome) : '',
        police: '',
        engineers: '',
        garrison,
        flipRisk: '-',
        pollution: Number(city.pollution) > 0 ? Number(city.pollution) : '',
        distance: civ3CityDistance(city, capital, report.world && report.world.width),
        rank: 1,
      };
    }),
  };
}

function makeTerrainNameSet(records, names) {
  const wanted = new Set(names.map((name) => canonicalKey(name)));
  const out = new Set();
  (records || []).forEach((record, index) => {
    const name = recordName(records, index, 'TERR', '');
    if (wanted.has(canonicalKey(name))) out.add(index);
  });
  return out;
}

function countTerritoryImprovements(tiles, options = {}) {
  const source = Array.isArray(tiles) ? tiles : [];
  const excludeMined = typeof options.excludeMined === 'function' ? options.excludeMined : null;
  const all = source.length;
  const roaded = source.filter((tile) => tile.roaded).length;
  const railroaded = source.filter((tile) => tile.railroaded).length;
  const irrigated = source.filter((tile) => tile.irrigated).length;
  const mined = source.filter((tile) => tile.mined && !(excludeMined && excludeMined(tile))).length;
  return {
    all,
    roaded,
    irrigated,
    mined,
    unroaded: all - roaded,
    unrailed: Math.max(0, roaded - railroaded),
  };
}

function territoryRatio(part, whole) {
  const denominator = Math.max(0, Number(whole) || 0);
  if (denominator <= 0) return '';
  return `${((Math.max(0, Number(part) || 0) * 100) / denominator).toFixed(1)}%`;
}

function makeTerritoryReport(context) {
  const {
    buf, report, human, humanDetails, humanVisible, playerRows, terrainRecords, unitTypes, races, ruleRecord, gameRules,
    perspectiveMask, players, detailsByPlayer, ruleSignatures, allPlayersMode, colorSlotsByPlayer, c3xSegmentInfo,
  } = context;
  const tiles = parseTerritoryTiles(buf, report);
  const humanMask = (Number(perspectiveMask) || 0) >>> 0;
  const waterTerrains = makeTerrainNameSet(terrainRecords, ['Coast', 'Sea', 'Ocean']);
  const nonDominationTerrains = makeTerrainNameSet(terrainRecords, ['Sea', 'Ocean']);
  const forestTerrains = makeTerrainNameSet(terrainRecords, ['Forest']);
  const jungleMarshTerrains = makeTerrainNameSet(terrainRecords, ['Jungle', 'Marsh']);
  const isWater = (tile) => waterTerrains.has(Number(tile.terrainID));
  const isLand = (tile) => !isWater(tile);
  const isDominationTile = (tile) => !nonDominationTerrains.has(Number(tile.terrainID));
  const isForest = (tile) => forestTerrains.has(Number(tile.terrainID));
  const isJungleOrMarsh = (tile) => jungleMarshTerrains.has(Number(tile.terrainID));
  const explored = tiles.filter((tile) => ((Number(tile.exploredBy) >>> 0) & humanMask) !== 0);
  const exploredLand = explored.filter(isLand);
  const exploredWater = explored.filter(isWater);
  const activePlayerIDs = new Set(activePlayers(players || [], report && report.game).map((player) => Number(player.playerID)));
  const selectedOwnerIDs = allPlayersMode ? activePlayerIDs : new Set([Number(human.playerID)]);
  const ownedTiles = tiles.filter((tile) => selectedOwnerIDs.has(Number(tile.owner)));
  const ownedLand = ownedTiles.filter(isLand);
  const ownedDominationTiles = ownedTiles.filter(isDominationTile);
  const dominationTiles = tiles.filter(isDominationTile);
  const dominationTerrainPercent = Math.max(0, Number(
    report && report.game && Number.isFinite(Number(report.game.dominationTerrain))
      ? report.game.dominationTerrain
      : gameRules && gameRules.dominationTerrainPercent
  ) || 0);
  const dominationLimit = dominationTerrainPercent > 0 && dominationTiles.length > 0
    ? Math.floor((dominationTiles.length * dominationTerrainPercent) / 100)
    : '?';
  const unclaimedDominationTiles = dominationTiles.filter((tile) => !activePlayerIDs.has(Number(tile.owner))).length;
  const districtTiles = parseC3XDistrictTileMap(buf, c3xSegmentInfo);
  const districtCoordSet = new Set(districtTiles.map((tile) => `${Number(tile.x)},${Number(tile.y)}`));
  const ownedLandDistricts = ownedLand.filter((tile) => districtCoordSet.has(`${Number(tile.x)},${Number(tile.y)}`));
  const excludeDistrictMine = (tile) => {
    if (!tile.mined) return false;
    if (districtCoordSet.size <= 0) return false;
    return districtCoordSet.has(`${Number(tile.x)},${Number(tile.y)}`);
  };
  const worked = ownedLand.filter((tile) => Number(tile.cityWithWorkers) >= 0);
  const unworked = ownedLand.filter((tile) => Number(tile.cityWithWorkers) < 0);
  const workedStats = countTerritoryImprovements(worked, { excludeMined: excludeDistrictMine });
  const unworkedStats = countTerritoryImprovements(unworked, { excludeMined: excludeDistrictMine });
  const humanCities = (report.cities && report.cities.records || [])
    .filter((city) => selectedOwnerIDs.has(Number(city.owner)));
  const units = report.units && report.units.records || [];
  const humanUnits = units.filter((unit) => selectedOwnerIDs.has(Number(unit.owner)));
  const workerTypeIndexes = new Set((unitTypes || [])
    .map((unit, index) => ({ unit, index, name: recordName(unitTypes, index, 'PRTO', '') }))
    .filter((item) => canonicalKey(item.name) === 'worker')
    .map((item) => item.index));
  const workerUnits = humanUnits.filter((unit) => workerTypeIndexes.has(Number(unit.unitType)));
  const slaveWorkers = workerUnits.filter((unit) => Number(unit.nationality) >= 0 && Number(unit.nationality) !== Number(human.raceID)).length;
  const citizens = humanCities.reduce((sum, city) => sum + (Number(city.population) || 0), 0);
  const totalKnownPopulation = (Array.isArray(playerRows) ? playerRows : [])
    .reduce((sum, player) => sum + (Number(player && player.population) || 0), 0);
  const specialists = humanCities.reduce((sum, city) => sum
    + (Number(city.specialistLuxuryIncome) || 0)
    + (Number(city.specialistTaxIncome) || 0)
    + (Number(city.specialistScienceIncome) || 0), 0);
  const cityById = new Map(humanCities.map((city) => [Number(city.id), city]));
  const cityTiles = new Map();
  worked.forEach((tile) => {
    const cityID = Number(tile.cityWithWorkers);
    if (!cityTiles.has(cityID)) cityTiles.set(cityID, []);
    cityTiles.get(cityID).push(tile);
  });
  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const cityRows = humanCities.map((city) => {
    const owner = makeCityOwnerContext(city, {
      human,
      humanDetails,
      playerById,
      detailsByPlayer,
      races,
      ruleRecord,
      ruleSignatures,
      colorSlotsByPlayer,
    });
    const assigned = cityTiles.get(Number(city.id)) || [];
    const assignedNonDistrict = assigned.filter((tile) => !districtCoordSet.has(`${Number(tile.x)},${Number(tile.y)}`));
    const assignedStats = countTerritoryImprovements(assignedNonDistrict);
    const food = Math.max(0, Number(city.foodIncome) || 0);
    const shields = Math.max(0, Number(city.shieldsPerTurn) || 0);
    const waste = Math.max(0, Number(city.productionLoss) || 0);
    const trade = Math.max(0, Number(city.cashIncome) || 0);
    const corruption = Math.max(0, Number(city.corruption) || 0);
    return {
      id: Number(city.id),
      ...makeCityOwnerFields(owner, allPlayersMode),
      city: city.name || '',
      cityArt: owner.cityArt,
      size: `${Number(city.id) === Number(owner.player && owner.player.capitalCity) ? '*' : ''}${Number(city.population) || 0}`,
      sizeValue: Number(city.population) || 0,
      assigned: assigned.length,
      worked: assignedStats.irrigated + assignedStats.mined + assigned.filter(isForest).length,
      mined: assignedStats.mined,
      irrigated: assignedStats.irrigated,
      forested: assigned.filter(isForest).length || '',
      unimproved: assigned.filter((tile) => !tile.roaded && !tile.irrigated && !tile.mined && !isForest(tile)).length || '',
      food,
      shields,
      waste: percentage(waste, shields + waste),
      trade,
      corruption: percentage(corruption, trade + corruption),
      complete: '100.0%',
    };
  });
  return {
    exploration: {
      worldTiles: tiles.length,
      exploredTiles: explored.length,
      exploredPercent: territoryRatio(explored.length, tiles.length),
      land: exploredLand.length,
      landPercent: territoryRatio(exploredLand.length, explored.length),
      water: exploredWater.length,
      waterPercent: territoryRatio(exploredWater.length, explored.length),
    },
    territory: {
      dominationLimit,
      tilesOwned: Number(humanVisible && humanVisible.land) || ownedTiles.length,
      dominationTiles: ownedDominationTiles.length,
      tilesToLimit: Number.isFinite(Number(dominationLimit)) ? Math.max(0, Number(dominationLimit) - ownedDominationTiles.length) : '?',
      unclaimedTiles: unclaimedDominationTiles,
      citizensLimit: citizens,
      citizensLimitPercent: territoryRatio(citizens, totalKnownPopulation),
      districtInstances: districtTiles.length,
      ownedLandDistricts: ownedLandDistricts.length,
    },
    statistics: {
      cities: humanCities.length,
      citizens,
      specialists,
      tilesPerCity: humanCities.length > 0 ? ((allPlayersMode ? ownedTiles.length : Number(humanVisible && humanVisible.land)) / humanCities.length).toFixed(1) : '',
      workerCount: workerUnits.length,
      nativeWorkers: workerUnits.length - slaveWorkers,
      nativeWorkersPercent: territoryRatio(workerUnits.length - slaveWorkers, workerUnits.length),
      slaveWorkers,
      slaveWorkersPercent: territoryRatio(slaveWorkers, workerUnits.length),
      workersPerCity: humanCities.length > 0 ? (workerUnits.length / humanCities.length).toFixed(1) : '',
      tilesPerWorker: workerUnits.length > 0 ? (ownedLand.length / workerUnits.length).toFixed(1) : '',
    },
    improvementRows: [
      { label: 'All Tiles', worked: workedStats.all, unworked: unworkedStats.all },
      { label: 'Roaded', worked: workedStats.roaded, unworked: unworkedStats.roaded },
      { label: 'Irrigated', worked: workedStats.irrigated, unworked: unworkedStats.irrigated },
      { label: 'Mined', worked: workedStats.mined, unworked: unworkedStats.mined },
      { label: 'Unroaded', worked: workedStats.unroaded, unworked: unworkedStats.unroaded },
      { label: 'Unrailed', worked: workedStats.unrailed, unworked: unworkedStats.unrailed },
      { label: 'Jungle or Marsh', worked: worked.filter(isJungleOrMarsh).length, unworked: unworked.filter(isJungleOrMarsh).length },
    ],
    cityRows,
    allCivs: !!allPlayersMode,
  };
}

function percentage(part, whole) {
  const denominator = Math.max(0, Number(whole) || 0);
  if (denominator <= 0) return 0;
  return Math.max(0, Math.round(((Number(part) || 0) * 100) / denominator));
}

function activeTradeGroups(tradeTail, playerID, turnNumber) {
  return ((tradeTail && tradeTail.lists && tradeTail.lists.get(Number(playerID))) || [])
    .filter((group) => Number(group.endTurn) === 0 || Number(group.endTurn) > Number(turnNumber));
}

function sumTradeGpt(groups) {
  return (Array.isArray(groups) ? groups : []).reduce((total, group) => (
    total + (group.offers || []).reduce((sum, offer) => (
      Number(offer && offer.kind) === 7 && Number(offer.param1) === 0
        ? sum + Math.max(0, Number(offer.param2) || 0)
        : sum
    ), 0)
  ), 0);
}

function computeGovernmentUnitSupport({ government, humanCities, report, human, unitTypes, ruleRecord }) {
  const maxTownSize = Math.max(0, Number(ruleRecord && ruleRecord.maxCity1Size) || 6);
  const maxCitySize = Math.max(maxTownSize, Number(ruleRecord && ruleRecord.maxCity2Size) || 12);
  const units = report && report.units && Array.isArray(report.units.records) ? report.units.records : [];
  const paidUnits = units.filter((unit) => {
    if (Number(unit.owner) !== Number(human.playerID)) return false;
    const unitType = unitTypes[Number(unit.unitType)] || {};
    const isKing = (((Number(unitType.unitAbilities) || 0) >>> 0) & (1 << 29)) !== 0;
    return Number(unit.nationality) === Number(human.raceID) && !isKing;
  }).length;
  const maintenanceFreeUnits = units.filter((unit) => {
    if (Number(unit.owner) !== Number(human.playerID)) return false;
    const unitType = unitTypes[Number(unit.unitType)] || {};
    const isKing = (((Number(unitType.unitAbilities) || 0) >>> 0) & (1 << 29)) !== 0;
    return Number(unit.nationality) !== Number(human.raceID) || isKing;
  }).length;
  let freeUnits = Number(government && government.freeUnits) || 0;
  if (freeUnits < 0) freeUnits = paidUnits;
  else {
    for (const city of humanCities || []) {
      const population = Math.max(0, Number(city.population) || 0);
      freeUnits += population > maxCitySize
        ? Math.max(0, Number(government && government.perMetropolis) || 0)
        : population > maxTownSize
          ? Math.max(0, Number(government && government.perCity) || 0)
          : Math.max(0, Number(government && government.perTown) || 0);
    }
  }
  const supportedUnits = Math.max(0, paidUnits - freeUnits);
  const costPerUnit = Math.max(0, Number(government && government.costPerUnit) || 0);
  return { paidUnits, freeUnits, maintenanceFreeUnits, supportedUnits, costPerUnit };
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}

function governmentCorruptionWeight(government) {
  const level = Number(government && government.corruption);
  if (level === 0) return 0.55; // Minimal
  if (level === 1) return 0.75; // Nuisance
  if (level === 2) return 1.00; // Problematic
  if (level === 3) return 1.30; // Rampant
  if (level === 4) return 1.60; // Catastrophic
  if (level === 5) return 0.95; // Communal: distribution differs, but empire-wide output is often near Problematic.
  if (level === 6) return 0.00; // Off
  return 1.00;
}

function governmentTilePenaltyMultiplier(currentGovernment, previewGovernment) {
  const currentPenalty = Number(currentGovernment && currentGovernment.tilePenalty) !== 0;
  const previewPenalty = Number(previewGovernment && previewGovernment.tilePenalty) !== 0;
  if (currentPenalty === previewPenalty) return 1;
  return previewPenalty ? 0.90 : 1.10;
}

function estimateGovernmentCommerceBonusDelta(row, currentGovernment, previewGovernment) {
  const currentBonus = Math.max(0, Number(currentGovernment && currentGovernment.commerceBonus) || 0);
  const previewBonus = Math.max(0, Number(previewGovernment && previewGovernment.commerceBonus) || 0);
  const delta = previewBonus - currentBonus;
  if (!delta) return 0;
  const workedTilesEstimate = Math.max(0, Math.min(Number(row.size) + 1, Number(row.baseScience) + Number(row.baseLuxury) + Number(row.baseTaxes) + Number(row.corruption)));
  return delta * workedTilesEstimate;
}

function scaleCityCommerceChannels(row, uncorruptedCommerce) {
  const currentUncorrupted = Math.max(0, Number(row.baseScience) + Number(row.baseLuxury) + Number(row.baseTaxes));
  if (currentUncorrupted <= 0 || uncorruptedCommerce <= 0) {
    return { baseScience: 0, baseLuxury: 0, baseTaxes: 0 };
  }
  let baseScience = Math.round((Number(row.baseScience) || 0) * uncorruptedCommerce / currentUncorrupted);
  let baseLuxury = Math.round((Number(row.baseLuxury) || 0) * uncorruptedCommerce / currentUncorrupted);
  let baseTaxes = Math.max(0, uncorruptedCommerce - baseScience - baseLuxury);
  const overflow = baseScience + baseLuxury + baseTaxes - uncorruptedCommerce;
  if (overflow > 0) baseTaxes = Math.max(0, baseTaxes - overflow);
  return { baseScience, baseLuxury, baseTaxes };
}

function estimateCityGovernmentPreview(row, currentGovernment, previewGovernment) {
  const currentCorruptionWeight = governmentCorruptionWeight(currentGovernment);
  const previewCorruptionWeight = governmentCorruptionWeight(previewGovernment);
  const corruptionScale = currentCorruptionWeight > 0 ? previewCorruptionWeight / currentCorruptionWeight : 1;
  const tilePenaltyMultiplier = governmentTilePenaltyMultiplier(currentGovernment, previewGovernment);
  const savedGrossCommerce = Math.max(0, Number(row.baseScience) + Number(row.baseLuxury) + Number(row.baseTaxes) + Number(row.corruption));
  const commerceBonusDelta = estimateGovernmentCommerceBonusDelta(row, currentGovernment, previewGovernment);
  const grossCommerce = Math.max(0, Math.round((savedGrossCommerce + commerceBonusDelta) * tilePenaltyMultiplier));
  const corruption = clampInt(Number(row.corruption) * corruptionScale, 0, grossCommerce);
  const uncorruptedCommerce = Math.max(0, grossCommerce - corruption);
  const channels = scaleCityCommerceChannels(row, uncorruptedCommerce);
  const science = channels.baseScience + (Number(row.addedScience) || 0);
  const luxury = channels.baseLuxury + (Number(row.addedLuxury) || 0);
  const taxes = channels.baseTaxes + (Number(row.addedTaxes) || 0);
  const savedGrossProduction = Math.max(0, Number(row.production) + Number(row.waste));
  const grossProduction = Math.max(0, Math.round(savedGrossProduction * tilePenaltyMultiplier));
  const waste = clampInt(Number(row.waste) * corruptionScale, 0, grossProduction);
  const production = Math.max(0, grossProduction - waste);
  return {
    id: row.id,
    name: row.name,
    production,
    waste,
    wastePercent: percentage(waste, production + waste),
    science,
    luxury,
    taxes,
    baseScience: channels.baseScience,
    baseLuxury: channels.baseLuxury,
    baseTaxes: channels.baseTaxes,
    addedScience: row.addedScience,
    addedLuxury: row.addedLuxury,
    addedTaxes: row.addedTaxes,
    corruption,
    corruptionPercent: percentage(corruption, uncorruptedCommerce + corruption),
    maintenance: row.maintenance,
    netGold: taxes - row.maintenance,
    estimated: true,
  };
}

function makeEconomyReport(context) {
  const {
    buf, report, human, humanDetails, humanVisible, governments, buildings, unitTypes,
    ruleRecord, techs, techMasks, players, detailsByPlayer, races, humanTradeTail, tradeRows, ruleSignatures,
    allPlayersMode, colorSlotsByPlayer,
  } = context;
  const governmentIndex = Number(humanDetails && humanDetails.government);
  const government = governments[governmentIndex] || {};
  const humanCities = (report.cities && report.cities.records || []).filter((city) => Number(city.owner) === Number(human.playerID));
  const activePlayerIDs = new Set(activePlayers(players || [], report && report.game).map((player) => Number(player.playerID)));
  const cityRowRecords = (report.cities && report.cities.records || [])
    .filter((city) => allPlayersMode ? activePlayerIDs.has(Number(city.owner)) : Number(city.owner) === Number(human.playerID));
  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const buildingIndexByKey = new Map(buildings.map((building, index) => [canonicalKey(building && building.name), index]));
  const marketplaceIndex = buildingIndexByKey.get('marketplace');
  const buildingOptions = buildings
    .map((building, buildingIndex) => {
      const name = recordName(buildings, buildingIndex, 'BLDG', '');
      return {
        buildingIndex,
        name,
        ref: makeRef('improvements', 'BLDG', buildingIndex, name, ruleSignatures),
      };
    })
    .filter((item) => item.name);
  const defaultBuildingIndex = Number.isFinite(marketplaceIndex)
    ? marketplaceIndex
    : (buildingOptions[0] ? Number(buildingOptions[0].buildingIndex) : -1);
  const builtLocations = new Map();
  for (const city of report.cities && report.cities.records || []) {
    for (const item of city.buildingRecords || []) {
      if (Number(item.originalOwner) < 0 || builtLocations.has(Number(item.buildingIndex))) continue;
      const ownerPlayer = playerById.get(Number(city.owner));
      const ownerRace = ownerPlayer ? races[Number(ownerPlayer.raceID)] : null;
      builtLocations.set(Number(item.buildingIndex), {
        cityID: Number(city.id),
        cityName: city.name || '',
        civilization: ownerRace ? recordName(races, ownerPlayer.raceID, 'RACE', '') : '',
      });
    }
  }
  const adminBuilding = (key) => {
    const buildingIndex = buildingIndexByKey.get(key);
    if (!Number.isFinite(buildingIndex)) return null;
    const building = buildings[buildingIndex] || {};
    const city = humanCities.find((item) => cityHasBuilding(item, buildingIndex));
    const name = recordName(buildings, buildingIndex, 'BLDG', '');
    return {
      name,
      city: city ? city.name : '',
      built: !!city,
      ref: makeRef('improvements', 'BLDG', buildingIndex, name, ruleSignatures),
    };
  };
  const cityRows = cityRowRecords.map((city) => {
    const owner = makeCityOwnerContext(city, {
      human,
      humanDetails,
      playerById,
      detailsByPlayer,
      races,
      ruleRecord,
      ruleSignatures,
      colorSlotsByPlayer,
    });
    const ownerCities = allPlayersMode
      ? (report.cities && report.cities.records || []).filter((item) => Number(item.owner) === Number(owner.ownerPlayerID))
      : humanCities;
    const productionLoss = Math.max(0, Number(city.productionLoss) || 0);
    const corruption = Math.max(0, Number(city.corruption) || 0);
    const production = Math.max(0, Number(city.productionIncome) || 0);
    const cashIncome = Math.max(0, Number(city.cashIncome) || 0);
    const baseScience = Math.max(0, Number(city.scienceIncome) || 0);
    const baseLuxury = Math.max(0, Number(city.luxuryIncome) || 0);
    const baseTaxes = Math.max(0, Number(city.taxIncome) || 0);
    const addedScience = Math.max(0, Number(city.addScience) || Number(city.specialistScienceIncome) || 0);
    const addedLuxury = Math.max(0, Number(city.addLuxury) || Number(city.specialistLuxuryIncome) || 0);
    const addedTaxes = Math.max(0, Number(city.addTaxes) || Number(city.specialistTaxIncome) || 0);
    const science = baseScience + addedScience;
    const luxury = baseLuxury + addedLuxury;
    const taxes = baseTaxes + addedTaxes;
    const maintenance = Math.max(0, Number(city.maintenanceGPT) || 0);
    const buildingStatuses = buildingOptions.map((option) => makeCityBuildingStatus({
      city,
      building: buildings[Number(option.buildingIndex)],
      buildingIndex: Number(option.buildingIndex),
      buildings,
      humanCities: ownerCities,
      builtLocations,
      report,
      human: owner.player || human,
      techs,
      techMasks,
      ruleSignatures,
    }));
    return {
      id: Number(city.id),
      ...makeCityOwnerFields(owner, allPlayersMode),
      name: city.name || '',
      cityArt: owner.cityArt,
      size: Math.max(0, Number(city.population) || 0),
      production,
      waste: productionLoss,
      wastePercent: percentage(productionLoss, production + productionLoss),
      science,
      luxury,
      taxes,
      baseScience,
      baseLuxury,
      baseTaxes,
      addedScience,
      addedLuxury,
      addedTaxes,
      corruption,
      corruptionPercent: percentage(corruption, cashIncome + corruption),
      maintenance,
      netGold: taxes - maintenance,
      buildingStatuses,
    };
  });

  const unitSupport = computeGovernmentUnitSupport({ government, humanCities, report, human, unitTypes, ruleRecord });
  const { paidUnits, freeUnits, maintenanceFreeUnits, supportedUnits, costPerUnit } = unitSupport;
  const unitCosts = supportedUnits * costPerUnit;
  const outgoingGpt = tradeRows.reduce((sum, row) => (
    sum + sumTradeGpt(activeTradeGroups(humanTradeTail, row.playerID, report.game.turnNumber))
  ), 0);
  const incomingGpt = tradeRows.reduce((sum, row) => (
    sum + sumTradeGpt(activeTradeGroups(row.tradeTail, human.playerID, report.game.turnNumber))
  ), 0);
  const treasury = Number(humanVisible && humanVisible.gold) || 0;
  const hasInterestWonder = buildings.some((building, buildingIndex) => (
    (((Number(building && building.smallWonderCharacteristics) || 0) >>> 0) & (1 << 3)) !== 0
      && humanCities.some((city) => cityHasBuilding(city, buildingIndex))
  ));
  const interest = hasInterestWonder ? Math.min(50, Math.floor(treasury / 20)) : 0;
  const fromCities = cityRows.reduce((sum, row) => sum + row.baseTaxes + row.baseScience + row.baseLuxury + row.corruption, 0);
  const fromTaxmen = humanCities.reduce((sum, city) => sum + Math.max(0, Number(city.addTaxes) || Number(city.specialistTaxIncome) || 0), 0);
  const science = cityRows.reduce((sum, row) => sum + row.baseScience, 0);
  const entertainment = cityRows.reduce((sum, row) => sum + row.baseLuxury, 0);
  const corruption = cityRows.reduce((sum, row) => sum + row.corruption, 0);
  const maintenance = cityRows.reduce((sum, row) => sum + row.maintenance, 0);
  const income = fromCities + fromTaxmen + incomingGpt + interest;
  const expenses = science + entertainment + corruption + maintenance + unitCosts + outgoingGpt;
  const netGain = income - expenses;
  const scienceRate = Math.max(0, readLeadInt32(buf, human, 396, 0)) * 10;
  const luxuryRate = Math.max(0, readLeadInt32(buf, human, 392, 0)) * 10;
  const goldenAgeEnd = readLeadInt32(buf, human, 32, -1);
  const governmentOptions = governments.map((option, index) => {
    const name = recordName(governments, index, 'GOVT', '');
    if (!name) return null;
    return {
      value: String(index),
      label: name,
      governmentIndex: index,
      name,
      current: index === governmentIndex,
      freeUnits: Number(option && option.freeUnits) || 0,
      perTown: Math.max(0, Number(option && option.perTown) || 0),
      perCity: Math.max(0, Number(option && option.perCity) || 0),
      perMetropolis: Math.max(0, Number(option && option.perMetropolis) || 0),
      costPerUnit: Math.max(0, Number(option && option.costPerUnit) || 0),
      corruption: Number(option && option.corruption) || 0,
      tilePenalty: Number(option && option.tilePenalty) || 0,
      commerceBonus: Number(option && option.commerceBonus) || 0,
      scienceCap: Number(option && option.scienceCap) || 0,
      requiresMaintenance: Number(option && option.requiresMaintenance) || 0,
      ref: makeRef('governments', 'GOVT', index, name, ruleSignatures),
    };
  }).filter(Boolean);
  const governmentPreviews = governmentOptions.map((option) => {
    const previewGovernment = governments[Number(option.governmentIndex)] || {};
    const previewUnitSupport = computeGovernmentUnitSupport({ government: previewGovernment, humanCities, report, human, unitTypes, ruleRecord });
    const previewUnitCosts = previewUnitSupport.supportedUnits * previewUnitSupport.costPerUnit;
    const previewCityRows = cityRows.map((row) => estimateCityGovernmentPreview(row, government, previewGovernment));
    const previewFromCities = previewCityRows.reduce((sum, row) => sum + row.baseTaxes + row.baseScience + row.baseLuxury + row.corruption, 0);
    const previewScience = previewCityRows.reduce((sum, row) => sum + row.baseScience, 0);
    const previewEntertainment = previewCityRows.reduce((sum, row) => sum + row.baseLuxury, 0);
    const previewCorruption = previewCityRows.reduce((sum, row) => sum + row.corruption, 0);
    const previewMaintenance = previewCityRows.reduce((sum, row) => sum + row.maintenance, 0);
    const previewIncome = previewFromCities + fromTaxmen + incomingGpt + interest;
    const previewExpenses = previewScience + previewEntertainment + previewCorruption + previewMaintenance + previewUnitCosts + outgoingGpt;
    return {
      governmentIndex: option.governmentIndex,
      name: option.name,
      ref: option.ref,
      current: option.current,
      unitSupport: previewUnitSupport,
      income: { fromCities: previewFromCities, fromTaxmen, fromOtherCivs: incomingGpt, interest, total: previewIncome },
      expenses: { science: previewScience, entertainment: previewEntertainment, corruption: previewCorruption, maintenance: previewMaintenance, unitCosts: previewUnitCosts, toOtherCivs: outgoingGpt, total: previewExpenses },
      netGain: previewIncome - previewExpenses,
      cityRows: previewCityRows,
      notes: [
        'Unit support is recalculated exactly from saved units and cities.',
        'City commerce, corruption, and waste are estimated from saved aggregate city output plus the selected government settings.',
      ],
    };
  });
  return {
    administration: {
      government: recordName(governments, governmentIndex, 'GOVT', ''),
      governmentRef: makeRef('governments', 'GOVT', governmentIndex, recordName(governments, governmentIndex, 'GOVT', ''), ruleSignatures),
      mobilization: readLeadInt32(buf, human, 136, 0) === 1 ? 'Active' : 'Inactive',
      goldenAge: goldenAgeEnd >= 0 && Number(report.game.turnNumber) < goldenAgeEnd ? 'Active' : 'Inactive',
      capital: humanDetails && humanDetails.capitalName || '',
      forbiddenPalace: adminBuilding('forbiddenpalace'),
      secretPoliceHQ: adminBuilding('secretpolicehq'),
    },
    sliders: { science: scienceRate, luxury: luxuryRate, taxes: Math.max(0, 100 - scienceRate - luxuryRate) },
    treasury,
    income: { fromCities, fromTaxmen, fromOtherCivs: incomingGpt, interest, total: income },
    expenses: { science, entertainment, corruption, maintenance, unitCosts, toOtherCivs: outgoingGpt, total: expenses },
    netGain,
    unitSupport: { paidUnits, freeUnits, maintenanceFreeUnits, supportedUnits, costPerUnit },
    currentGovernmentIndex: governmentIndex,
    governmentOptions,
    governmentPreviews,
    defaultBuildingIndex,
    buildingOptions,
    cityRows,
    allCivs: !!allPlayersMode,
  };
}

function makeProductionReport(context) {
  const {
    report, human, humanDetails, races, ruleRecord, buildings, unitTypes, players, detailsByPlayer, ruleSignatures,
    allPlayersMode, colorSlotsByPlayer,
  } = context;
  const productionFactor = bitSet(report.game && report.game.rules, 5) ? 5 : 10;
  const activePlayerIDs = new Set(activePlayers(players || [], report && report.game).map((player) => Number(player.playerID)));
  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const rows = (report.cities && report.cities.records || [])
    .filter((city) => allPlayersMode ? activePlayerIDs.has(Number(city.owner)) : Number(city.owner) === Number(human.playerID))
    .map((city) => {
      const owner = makeCityOwnerContext(city, {
        human,
        humanDetails,
        playerById,
        detailsByPlayer,
        races,
        ruleRecord,
        ruleSignatures,
        colorSlotsByPlayer,
      });
      const orderType = Number(city.constructingType);
      const orderIndex = Number(city.constructingIndex);
      const records = orderType === 1 ? buildings : orderType === 2 ? unitTypes : [];
      const sectionCode = orderType === 1 ? 'BLDG' : orderType === 2 ? 'PRTO' : '';
      const tabKey = orderType === 1 ? 'improvements' : orderType === 2 ? 'units' : '';
      const order = records[orderIndex] || null;
      const name = sectionCode ? recordName(records, orderIndex, sectionCode, '') : '';
      const baseCost = orderType === 1 ? Number(order && order.cost) : orderType === 2 ? Number(order && order.shieldCost) : 0;
      const cost = Math.max(0, Number(baseCost) || 0) * (orderType === 1 ? productionFactor : 1);
      const collected = Math.max(0, Number(city.shieldsCollected) || 0);
      const perTurn = Math.max(0, Number(city.productionIncome) || 0);
      const remaining = Math.max(0, cost - collected);
      const turns = remaining > 0 && perTurn > 0 ? Math.ceil(remaining / perTurn) : 0;
      const overrun = turns > 0 ? Math.max(0, turns * perTurn - remaining) : Math.max(0, collected - cost);
      const waste = Math.max(0, Number(city.productionLoss) || 0);
      return {
        cityID: Number(city.id),
        ...makeCityOwnerFields(owner, allPlayersMode),
        city: city.name || '',
        cityArt: owner.cityArt,
        producing: name || 'Nothing',
        producingRef: sectionCode ? makeRef(tabKey, sectionCode, orderIndex, name, ruleSignatures) : null,
        orderType: orderType === 1 ? 'Improvement' : orderType === 2 ? 'Unit' : '',
        productionFacet: getProductionFacet(orderType, order),
        cost,
        collected,
        progressPercent: cost > 0 ? Math.max(0, Math.min(100, Math.round((collected * 100) / cost))) : 0,
        perTurn,
        remaining,
        turns,
        overrun,
        overrunPercent: perTurn > 0 ? Math.round((overrun * 100) / perTurn) : 0,
        waste,
        wastePercent: percentage(waste, perTurn + waste),
      };
    });
  return { productionFactor, rows, allCivs: !!allPlayersMode };
}

function unitAvailableToRace(unitType, raceID) {
  const mask = (Number(unitType && unitType.availableTo) || 0) >>> 0;
  const bit = Number(raceID);
  return bit >= 0 && bit < 32 && (mask & ((1 << bit) >>> 0)) !== 0;
}

function resolveAvailableUpgrade(unitTypes, unitTypeIndex, raceID) {
  const visited = new Set([Number(unitTypeIndex)]);
  let next = Number(unitTypes[Number(unitTypeIndex)] && unitTypes[Number(unitTypeIndex)].upgradeTo);
  while (Number.isFinite(next) && next >= 0 && next < unitTypes.length && !visited.has(next)) {
    visited.add(next);
    const candidate = unitTypes[next] || {};
    if (unitAvailableToRace(candidate, raceID)) return { index: next, record: candidate };
    next = Number(candidate.upgradeTo);
  }
  return null;
}

function formatMovementThirds(value) {
  const points = Math.max(0, Number(value) || 0) / 3;
  return Number.isInteger(points) ? String(points) : points.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function makeMilitaryReport(context) {
  const {
    report, human, unitTypes, experienceLevels, races, gameRules, ruleSignatures, economy,
    players, allPlayersMode, colorSlotsByPlayer,
  } = context;
  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const activePlayerIDs = new Set(activePlayers(players || [], report && report.game).map((player) => Number(player.playerID)));
  const selectedOwnerIDs = allPlayersMode ? activePlayerIDs : new Set([Number(human.playerID)]);
  const selectedUnits = (report.units && report.units.records || [])
    .filter((unit) => selectedOwnerIDs.has(Number(unit.owner)));
  const selectedCities = (report.cities && report.cities.records || [])
    .filter((city) => selectedOwnerIDs.has(Number(city.owner)));
  const cityByCoordinate = new Map(selectedCities.map((city) => [`${city.x},${city.y}`, city.name || '']));
  const upgradeGoldPerShield = Math.max(0, Number(gameRules && gameRules.upgradeCost) || 3);
  const makeUnitOwner = (unit) => {
    const ownerPlayer = playerById.get(Number(unit && unit.owner)) || human || {};
    const ownerRaceIndex = Number(ownerPlayer.raceID);
    const ownerRaceName = recordName(races, ownerRaceIndex, 'RACE', '');
    const ownerRace = races[ownerRaceIndex] || {};
    return {
      playerID: Number(ownerPlayer.playerID),
      raceID: ownerRaceIndex,
      name: ownerRaceName,
      ref: makeRef('civilizations', 'RACE', ownerRaceIndex, ownerRaceName, ruleSignatures),
      colorSlot: getPlayerColorSlot(ownerPlayer, ownerRace, colorSlotsByPlayer),
    };
  };
  const unitRows = selectedUnits.map((unit) => {
    const owner = makeUnitOwner(unit);
    const typeIndex = Number(unit.unitType);
    const type = unitTypes[typeIndex] || {};
    const experienceIndex = Number(unit.experienceLevel);
    const experience = experienceLevels[experienceIndex] || {};
    const maxHealth = Math.max(1, Number(experience.baseHitPoints) || 0) + (Number(type.hitPointBonus) || 0);
    const currentHealth = Math.max(0, maxHealth - Math.max(0, Number(unit.damage) || 0));
    const maxMovementThirds = Math.max(0, Number(type.movement) || 0) * 3;
    const movementUsed = Math.max(0, Number(unit.movementUsed) || 0);
    const remainingMovementThirds = Math.max(0, maxMovementThirds - movementUsed);
    const nationalityIndex = Number(unit.nationality);
    const originalNationality = recordName(races, nationalityIndex, 'RACE', '');
    const typeName = recordName(unitTypes, typeIndex, 'PRTO', 'Unknown unit');
    return {
      id: Number(unit.id),
      typeIndex,
      type: typeName,
      typeRef: makeRef('units', 'PRTO', typeIndex, typeName, ruleSignatures),
      description: `${experience.name || 'Regular'} ${unit.name || typeName}`,
      experienceIndex,
      experience: experience.name || `Level ${experienceIndex + 1}`,
      currentHealth,
      maxHealth,
      health: `${currentHealth}/${maxHealth}`,
      remainingMovement: formatMovementThirds(remainingMovementThirds),
      maxMovement: formatMovementThirds(maxMovementThirds),
      movement: `${formatMovementThirds(remainingMovementThirds)}/${formatMovementThirds(maxMovementThirds)}`,
      location: cityByCoordinate.get(`${unit.x},${unit.y}`) || `${unit.x}, ${unit.y}`,
      x: Number(unit.x),
      y: Number(unit.y),
      ownerPlayerID: owner.playerID,
      ownerRaceID: owner.raceID,
      nationality: owner.name,
      nationalityRef: owner.ref,
      colorSlot: owner.colorSlot,
      originalNationality,
      originalNationalityRef: makeRef('civilizations', 'RACE', nationalityIndex, originalNationality, ruleSignatures),
      foreign: false,
      damaged: currentHealth < maxHealth,
      spent: remainingMovementThirds <= 0,
    };
  });

  const groups = new Map();
  unitRows.forEach((unit) => {
    const key = allPlayersMode ? `${unit.typeIndex}:${unit.ownerPlayerID}` : `${unit.typeIndex}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(unit);
  });
  const roster = Array.from(groups.values())
    .sort((a, b) => (
      (Number(a[0] && a[0].typeIndex) - Number(b[0] && b[0].typeIndex))
      || (Number(a[0] && a[0].ownerPlayerID) - Number(b[0] && b[0].ownerPlayerID))
    ))
    .map((units) => {
      const typeIndex = Number(units[0] && units[0].typeIndex);
      const type = unitTypes[typeIndex] || {};
      const name = recordName(unitTypes, typeIndex, 'PRTO', 'Unknown unit');
      const ownerRaceID = Number(units[0] && units[0].ownerRaceID);
      const ownerRaceName = String(units[0] && units[0].nationality || '');
      const ownerRaceRef = units[0] && units[0].nationalityRef;
      const ownerColorSlot = Number(units[0] && units[0].colorSlot);
      const upgrade = resolveAvailableUpgrade(unitTypes, typeIndex, ownerRaceID);
      const upgradeName = upgrade ? recordName(unitTypes, upgrade.index, 'PRTO', '') : '';
      const experienceMix = experienceLevels.map((level, index) => ({
        name: level.name || `Level ${index + 1}`,
        count: units.filter((unit) => unit.experienceIndex === index).length,
      })).filter((item) => item.count > 0);
      const civs = [{ name: ownerRaceName, ref: ownerRaceRef, colorSlot: ownerColorSlot }];
      return {
        typeIndex,
        name,
        ref: makeRef('units', 'PRTO', typeIndex, name, ruleSignatures),
        civs,
        civText: civs.map((civ) => civ.name).join(', '),
        attack: Math.max(0, Number(type.attack) || 0),
        defence: Math.max(0, Number(type.defence) || 0),
        movement: Math.max(0, Number(type.movement) || 0),
        stats: `${Math.max(0, Number(type.attack) || 0)} / ${Math.max(0, Number(type.defence) || 0)} / ${Math.max(0, Number(type.movement) || 0)}`,
        count: units.length,
        experienceMix,
        damaged: units.filter((unit) => unit.damaged).length,
        spent: units.filter((unit) => unit.spent).length,
        upgrade: upgradeName,
        upgradeRef: upgrade ? makeRef('units', 'PRTO', upgrade.index, upgradeName, ruleSignatures) : null,
        upgradeCost: upgrade ? Math.max(0, (Number(upgrade.record.shieldCost) || 0) - (Number(type.shieldCost) || 0)) * upgradeGoldPerShield : 0,
        shieldCost: Math.max(0, Number(type.shieldCost) || 0),
        unitClass: Math.max(0, Number(type.unitClass) || 0),
      };
    });
  const typeFor = (unit) => unitTypes[Number(unit.typeIndex)] || {};
  return {
    allCivs: !!allPlayersMode,
    summary: {
      total: unitRows.length,
      combat: unitRows.filter((unit) => {
        const type = typeFor(unit);
        return (Number(type.attack) || 0) > 0 || (Number(type.defence) || 0) > 0;
      }).length,
      civilian: unitRows.filter((unit) => {
        const type = typeFor(unit);
        return (Number(type.attack) || 0) === 0 && (Number(type.defence) || 0) === 0;
      }).length,
      naval: unitRows.filter((unit) => Number(typeFor(unit).unitClass) === 1).length,
      air: unitRows.filter((unit) => Number(typeFor(unit).unitClass) === 2).length,
      foreign: unitRows.filter((unit) => unit.foreign).length,
      damaged: unitRows.filter((unit) => unit.damaged).length,
      spent: unitRows.filter((unit) => unit.spent).length,
      unitSupport: Math.max(0, Number(economy && economy.expenses && economy.expenses.unitCosts) || 0),
    },
    roster,
    units: unitRows,
  };
}

function alertSeverityRank(severity) {
  switch (String(severity || '').toLowerCase()) {
    case 'critical': return 0;
    case 'warning': return 1;
    case 'opportunity': return 2;
    default: return 3;
  }
}

function joinNames(items, limit = 4) {
  const source = Array.isArray(items) ? items.filter(Boolean) : [];
  if (source.length === 0) return '';
  const names = source.slice(0, limit).map((item) => String(item && item.name || item)).filter(Boolean);
  return source.length > names.length ? `${names.join(', ')} and ${source.length - names.length} more` : names.join(', ');
}

function makeAlert(id, severity, category, title, detail, options = {}) {
  return {
    id,
    severity,
    category,
    title,
    detail,
    tab: options.tab || '',
    subtab: options.subtab || '',
    refs: Array.isArray(options.refs) ? options.refs.filter(Boolean) : [],
    detailRows: Array.isArray(options.detailRows) ? options.detailRows.filter(Boolean) : [],
    mapTargets: Array.isArray(options.mapTargets) ? options.mapTargets.filter((target) => (
      target && Number.isFinite(Number(target.x)) && Number.isFinite(Number(target.y))
    )).map((target) => ({
      x: Number(target.x),
      y: Number(target.y),
      label: String(target.label || ''),
    })) : [],
    cityArt: options.cityArt || null,
    amount: options.amount !== null && options.amount !== undefined && String(options.amount).trim() !== '' && Number.isFinite(Number(options.amount))
      ? Number(options.amount)
      : null,
    sort: Number.isFinite(Number(options.sort)) ? Number(options.sort) : 0,
  };
}

function uniqueRefs(refs, limit = 10) {
  const out = [];
  const seen = new Set();
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (!ref) continue;
    const key = `${ref.sectionCode || ''}:${ref.biqIndex}:${ref.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= limit) break;
  }
  return out;
}

function parseConfigBoolValue(value, fallback = false) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) return false;
  return fallback;
}

function parseConfigIntValue(value, fallback = 0) {
  const n = Number.parseInt(String(value == null ? '' : value).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function tokenizeConfigList(value) {
  const text = String(value == null ? '' : value);
  const items = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      const trimmed = current.trim();
      if (trimmed) items.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) items.push(trimmed);
  return items;
}

function configSectionFieldMap(section) {
  const out = {};
  for (const field of section && Array.isArray(section.fields) ? section.fields : []) {
    const key = String(field && field.key || '').trim().toLowerCase();
    if (!key) continue;
    out[key] = String(field.value != null ? field.value : '');
  }
  return out;
}

function normalizeListKey(value) {
  return canonicalKey(value);
}

function normalizeTerrainKey(value) {
  const key = normalizeListKey(value);
  const aliases = {
    desert: 'desert',
    deserts: 'desert',
    plain: 'plains',
    plains: 'plains',
    grassland: 'grassland',
    grasslands: 'grassland',
    tundra: 'tundra',
    tundras: 'tundra',
    floodplain: 'floodplain',
    floodplains: 'floodplain',
    hill: 'hills',
    hills: 'hills',
    mountain: 'mountains',
    mountains: 'mountains',
    forest: 'forest',
    forests: 'forest',
    jungle: 'jungle',
    jungles: 'jungle',
    marsh: 'marsh',
    marshes: 'marsh',
    swamp: 'marsh',
    swamps: 'marsh',
    volcano: 'volcano',
    volcanoes: 'volcano',
    coast: 'coast',
    coasts: 'coast',
    sea: 'sea',
    seas: 'sea',
    ocean: 'ocean',
    oceans: 'ocean',
    river: 'river',
    rivers: 'river',
    any: 'any',
  };
  return aliases[key] || key;
}

function makeDistrictAlertConfig(section, fallbackIndex) {
  const fields = configSectionFieldMap(section);
  const name = String(fields.name || '').trim() || `District ${Number(fallbackIndex) + 1}`;
  const list = (key) => tokenizeConfigList(fields[key]).map((item) => String(item || '').trim()).filter(Boolean);
  return {
    id: Number.isFinite(Number(section && section.index)) ? Number(section.index) : Number(fallbackIndex),
    name,
    key: normalizeListKey(name),
    command: String(fields.command || '').trim(),
    fields,
    dependentImprovs: list('dependent_improvs'),
    buildableOn: list('buildable_on'),
    hasBuildableOn: Object.prototype.hasOwnProperty.call(fields, 'buildable_on'),
    buildableOnRivers: parseConfigBoolValue(fields.buildable_on_rivers, false),
    buildableWithoutRemoval: list('buildable_without_removal'),
    buildableOnOverlays: list('buildable_on_overlays'),
    buildableOnDistricts: list('buildable_on_districts'),
    buildableAdjacentTo: list('buildable_adjacent_to'),
    buildableAdjacentToDistricts: list('buildable_adjacent_to_districts'),
    buildableAdjacentToOverlays: list('buildable_adjacent_to_overlays'),
  };
}

function makeWonderAlertConfig(section, fallbackIndex) {
  const config = makeDistrictAlertConfig(section, fallbackIndex);
  const name = String(config.fields.name || '').trim() || `Wonder ${Number(fallbackIndex) + 1}`;
  return {
    ...config,
    name,
    key: normalizeListKey(name),
    restrictedByCiv: [
      'buildable_by_civs',
      'buildable_by_civ_traits',
      'buildable_by_civ_govs',
      'buildable_by_civ_cultures',
    ].some((key) => String(config.fields[key] || '').trim()),
  };
}

function normalizeDistrictAlertContext(input) {
  if (!input || typeof input !== 'object') return null;
  const base = input.base && typeof input.base === 'object' ? input.base : {};
  const districts = (Array.isArray(input.districts) ? input.districts : []).map(makeDistrictAlertConfig);
  const wonders = (Array.isArray(input.wonders) ? input.wonders : []).map(makeWonderAlertConfig);
  return {
    base,
    districts,
    wonders,
    districtsEnabled: parseConfigBoolValue(base.enable_districts, false),
    wonderDistrictsEnabled: parseConfigBoolValue(base.enable_wonder_districts, false),
    cityWorkRadius: Math.max(1, parseConfigIntValue(base.city_work_radius, 2)),
  };
}

function tileKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

function cityWorkableTiles(city, tiles, worldWidth, radius) {
  if (!city || !Array.isArray(tiles)) return [];
  const maxDistance = Math.max(1, Number(radius) || 2) + 1;
  return tiles.filter((tile) => civ3CityDistance(city, tile, worldWidth) <= maxDistance);
}

function tileTerrainTokenSet(tile, terrainRecords) {
  const set = new Set();
  const terrainID = Number(tile && tile.terrainID);
  const fixed = TERRAIN_ID_TO_C3X_TOKEN[terrainID];
  if (fixed) set.add(normalizeTerrainKey(fixed));
  const display = recordName(terrainRecords || [], terrainID, 'TERR', '');
  if (display) set.add(normalizeTerrainKey(display));
  if (tile && tile.river) set.add('river');
  return set;
}

function terrainListMatchesTile(list, tile, terrainRecords, useDefault = true) {
  const raw = Array.isArray(list) ? list : [];
  if (raw.some((item) => normalizeTerrainKey(item) === 'any')) return true;
  const wanted = raw.length > 0
    ? new Set(raw.map(normalizeTerrainKey).filter(Boolean))
    : (useDefault ? DEFAULT_DISTRICT_BUILDABLE_TERRAINS : new Set());
  if (wanted.size === 0) return false;
  const actual = tileTerrainTokenSet(tile, terrainRecords);
  for (const token of wanted) {
    if (actual.has(token)) return true;
  }
  return false;
}

function tileHasOverlayToken(tile, token, terrainRecords) {
  const key = normalizeTerrainKey(token);
  if (!key) return false;
  if (key === 'road' || key === 'roads') return !!(tile && tile.roaded);
  if (key === 'railroad' || key === 'railroads') return !!(tile && tile.railroaded);
  if (key === 'mine' || key === 'mines') return !!(tile && tile.mined);
  if (key === 'irrigation' || key === 'irrigated') return !!(tile && tile.irrigated);
  if (key === 'river' || key === 'rivers') return !!(tile && tile.river);
  return tileTerrainTokenSet(tile, terrainRecords).has(key);
}

function anyOverlayMatches(tile, tokens, terrainRecords) {
  return (Array.isArray(tokens) ? tokens : []).some((token) => tileHasOverlayToken(tile, token, terrainRecords));
}

function adjacentTiles(tile, tileByCoord) {
  if (!tile || !(tileByCoord instanceof Map)) return [];
  const x = Number(tile.x);
  const y = Number(tile.y);
  const deltas = [
    [-2, 0], [2, 0],
    [-1, -1], [1, -1],
    [-1, 1], [1, 1],
    [0, -2], [0, 2],
  ];
  return deltas.map(([dx, dy]) => tileByCoord.get(tileKey(x + dx, y + dy))).filter(Boolean);
}

function completedDistrictAtTile(tile, districtByCoord, districtConfigs) {
  const row = districtByCoord instanceof Map ? districtByCoord.get(tileKey(tile && tile.x, tile && tile.y)) : null;
  if (!row || Number(row.state) !== DISTRICT_COMPLETED_STATE) return null;
  const districtID = Number(row.districtID);
  const config = (districtConfigs || [])[districtID] || null;
  return {
    row,
    districtID,
    name: config ? config.name : `District ${districtID}`,
    key: config ? config.key : normalizeListKey(`District ${districtID}`),
  };
}

function tileMatchesDistrictBuildability(config, tile, evalContext, wonderConfig = null) {
  if (!config || !tile) return false;
  if (Number(tile.cityID) >= 0) return false;
  const terrainRecords = evalContext.terrainRecords || [];
  const tileByCoord = evalContext.tileByCoord;
  const districtByCoord = evalContext.districtByCoord;
  const districtConfigs = evalContext.districtConfigs || [];
  const buildableOn = wonderConfig ? wonderConfig.buildableOn : config.buildableOn;
  const hasBuildableOn = wonderConfig ? wonderConfig.hasBuildableOn : config.hasBuildableOn;
  const squareMatches = terrainListMatchesTile(buildableOn, tile, terrainRecords, !hasBuildableOn || buildableOn.length === 0);
  const requiredOverlays = [...(config.buildableOnOverlays || []), ...((wonderConfig && wonderConfig.buildableOnOverlays) || [])];
  const overlayRequired = requiredOverlays.length > 0;
  if (overlayRequired && !anyOverlayMatches(tile, requiredOverlays, terrainRecords)) return false;
  const overlayAllowed = anyOverlayMatches(tile, config.buildableWithoutRemoval, terrainRecords);
  if ((config.buildableOnRivers || (wonderConfig && wonderConfig.buildableOnRivers)) && !tile.river) return false;
  if (!squareMatches && !overlayAllowed && !overlayRequired) return false;

  if ((config.buildableOnDistricts || []).length > 0) {
    const current = completedDistrictAtTile(tile, districtByCoord, districtConfigs);
    const wanted = new Set(config.buildableOnDistricts.map(normalizeListKey));
    if (!current || !wanted.has(current.key)) return false;
  }

  const adjacent = adjacentTiles(tile, tileByCoord);
  const adjacentTerrain = [...(config.buildableAdjacentTo || []), ...((wonderConfig && wonderConfig.buildableAdjacentTo) || [])];
  if (adjacentTerrain.length > 0) {
    const allowCity = adjacentTerrain.some((item) => normalizeListKey(item) === 'city');
    const terrainTokens = adjacentTerrain.filter((item) => normalizeListKey(item) !== 'city');
    const cityAdjacent = adjacent.some((item) => Number(item.cityID) >= 0);
    if (cityAdjacent && !allowCity) return false;
    const matches = (allowCity && cityAdjacent)
      || adjacent.some((item) => terrainListMatchesTile(terrainTokens, item, terrainRecords, false));
    if (!matches) return false;
  }
  const adjacentDistricts = config.buildableAdjacentToDistricts || [];
  if (adjacentDistricts.length > 0) {
    const wanted = new Set(adjacentDistricts.map(normalizeListKey));
    const matches = adjacent.some((item) => {
      const current = completedDistrictAtTile(item, districtByCoord, districtConfigs);
      return current && wanted.has(current.key);
    });
    if (!matches) return false;
  }
  const adjacentOverlays = config.buildableAdjacentToOverlays || [];
  if (adjacentOverlays.length > 0 && !adjacent.some((item) => anyOverlayMatches(item, adjacentOverlays, terrainRecords))) return false;
  return true;
}

function cityHasCompletedDistrict(city, districtID, evalContext, options = {}) {
  const tiles = cityWorkableTiles(city, evalContext.territoryTiles, evalContext.worldWidth, evalContext.cityWorkRadius);
  return tiles.some((tile) => {
    const current = completedDistrictAtTile(tile, evalContext.districtByCoord, evalContext.districtConfigs);
    if (!current || Number(current.districtID) !== Number(districtID)) return false;
    if (options.requireRiver && !tile.river) return false;
    return true;
  });
}

function findDistrictCandidateTile(city, districtConfig, evalContext, wonderConfig = null) {
  if (!city || !districtConfig) return null;
  const tiles = cityWorkableTiles(city, evalContext.territoryTiles, evalContext.worldWidth, evalContext.cityWorkRadius);
  return tiles.find((tile) => Number(tile.owner) === Number(city.owner)
    && tileMatchesDistrictBuildability(districtConfig, tile, evalContext, wonderConfig)) || null;
}

function collectUnconnectedResourceWarnings(context) {
  const {
    territoryTiles, resources, humanTradeTail, techMasks, playerID, ruleSignatures,
  } = context || {};
  if (!Array.isArray(territoryTiles) || !Array.isArray(resources) || !humanTradeTail || !Number.isFinite(Number(playerID))) return [];
  const grouped = new Map();
  for (const tile of territoryTiles) {
    if (Number(tile.owner) !== Number(playerID)) continue;
    const resourceID = Number(tile.resource);
    if (!Number.isFinite(resourceID) || resourceID < 0 || resourceID >= resources.length) continue;
    const resource = resources[resourceID];
    if (!isTradeNetworkResource(resource)) continue;
    if (!hasResourcePrereq(resource, techMasks, playerID)) continue;
    const count = Number(humanTradeTail.resourceCounts && humanTradeTail.resourceCounts[resourceID]) || 0;
    if (count > 0) continue;
    if (!grouped.has(resourceID)) grouped.set(resourceID, []);
    grouped.get(resourceID).push(tile);
  }
  return [...grouped.entries()].map(([resourceID, tiles]) => {
    const name = resourceName(resources, resourceID) || `Resource ${resourceID}`;
    return {
      resourceID,
      name,
      count: tiles.length,
      tiles: tiles.slice(0, 8).map((tile) => ({ x: tile.x, y: tile.y })),
      ref: makeRef('resources', 'GOOD', resourceID, name, ruleSignatures),
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function collectForeignUnitWarnings(context) {
  const {
    territoryTiles, units, players, unitTypes, races, playerID, perspectiveMask, atWarPlayerIDs, ruleSignatures,
  } = context || {};
  const selectedPlayerID = Number(playerID);
  const visibilityMask = (Number(perspectiveMask) || 0) >>> 0;
  if (!Number.isFinite(selectedPlayerID) || visibilityMask === 0) return [];

  const tileByCoord = new Map((territoryTiles || [])
    .filter((tile) => Number(tile.owner) === selectedPlayerID && (((Number(tile.visibleBy) >>> 0) & visibilityMask) !== 0))
    .map((tile) => [tileKey(tile.x, tile.y), tile]));
  const playerByID = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const warOwners = atWarPlayerIDs instanceof Set
    ? atWarPlayerIDs
    : new Set(Array.isArray(atWarPlayerIDs) ? atWarPlayerIDs.map(Number) : []);
  const stacks = new Map();

  for (const unit of Array.isArray(units) ? units : []) {
    const owner = Number(unit && unit.owner);
    if (!Number.isFinite(owner) || owner < 0 || owner === selectedPlayerID) continue;
    if (Number(unit && unit.loadedOnUnitID) >= 0) continue;
    const typeIndex = Number(unit.unitType);
    const typeRecord = unitTypes && unitTypes[typeIndex] || {};
    const invisible = typeRecord.invisible === true
      || Number(typeRecord.invisible) === 1
      || canonicalKey(typeRecord.invisible) === 'true';
    if (invisible) continue;
    const key = tileKey(unit.x, unit.y);
    const tile = tileByCoord.get(key);
    if (!tile) continue;
    if (!stacks.has(key)) stacks.set(key, { x: Number(tile.x), y: Number(tile.y), units: [] });
    const player = playerByID.get(owner) || {};
    const raceID = Number(player.raceID);
    const nation = recordName(races, raceID, 'RACE', `Player ${owner}`);
    const type = recordName(unitTypes, typeIndex, 'PRTO', 'Unknown unit');
    stacks.get(key).units.push({
      owner,
      raceID,
      nation,
      typeIndex,
      type,
      atWar: warOwners.has(owner),
      nationRef: makeRef('civilizations', 'RACE', raceID, nation, ruleSignatures),
      typeRef: makeRef('units', 'PRTO', typeIndex, type, ruleSignatures),
    });
  }

  return Array.from(stacks.values()).map((stack) => {
    const ownerGroups = new Map();
    stack.units.forEach((unit) => {
      if (!ownerGroups.has(unit.owner)) {
        ownerGroups.set(unit.owner, {
          owner: unit.owner,
          nation: unit.nation,
          nationRef: unit.nationRef,
          atWar: unit.atWar,
          types: new Map(),
        });
      }
      const ownerGroup = ownerGroups.get(unit.owner);
      if (!ownerGroup.types.has(unit.typeIndex)) {
        ownerGroup.types.set(unit.typeIndex, { name: unit.type, ref: unit.typeRef, count: 0 });
      }
      ownerGroup.types.get(unit.typeIndex).count += 1;
    });
    const owners = Array.from(ownerGroups.values()).map((owner) => ({
      ...owner,
      types: Array.from(owner.types.values()),
    }));
    const atWar = owners.some((owner) => owner.atWar);
    const detail = owners.map((owner) => {
      const types = owner.types.map((type) => `${type.count > 1 ? `${type.count} ` : ''}${type.name}`).join(', ');
      return `${owner.nation} (${owner.atWar ? 'at war' : 'at peace'}): ${types}`;
    }).join('; ');
    return {
      x: stack.x,
      y: stack.y,
      atWar,
      unitCount: stack.units.length,
      detail,
      owners,
      refs: uniqueRefs(owners.flatMap((owner) => [owner.nationRef, ...owner.types.map((type) => type.ref)])),
    };
  }).sort((a, b) => Number(b.atWar) - Number(a.atWar) || a.y - b.y || a.x - b.x);
}

function isTradeNetworkResource(resource) {
  const type = Number(resource && resource.type);
  return type === 1 || type === 2;
}

function collectDistrictOpportunityWarnings(context) {
  const {
    districtAlertContext, report, culture, buildings, terrainRecords, territoryTiles, districtRows, allPlayersMode,
  } = context || {};
  if (allPlayersMode) return { buildings: [], wonders: [] };
  const cfg = normalizeDistrictAlertContext(districtAlertContext);
  if (!cfg || !cfg.districtsEnabled || cfg.districts.length === 0) return { buildings: [], wonders: [] };
  const worldWidth = Number(report && report.world && report.world.width) || 0;
  const tileByCoord = new Map((territoryTiles || []).map((tile) => [tileKey(tile.x, tile.y), tile]));
  const districtByCoord = new Map((districtRows || []).map((row) => [tileKey(row.x, row.y), row]));
  const evalContext = {
    territoryTiles: territoryTiles || [],
    terrainRecords: terrainRecords || [],
    worldWidth,
    tileByCoord,
    districtByCoord,
    districtConfigs: cfg.districts,
    cityWorkRadius: cfg.cityWorkRadius,
  };
  const nameToBuildingIndex = new Map((buildings || []).map((building, index) => [
    normalizeListKey(recordName(buildings, index, 'BLDG', '')),
    index,
  ]));
  const prereqByBuilding = new Map();
  cfg.districts.forEach((district) => {
    for (const item of district.dependentImprovs || []) {
      const buildingIndex = nameToBuildingIndex.get(normalizeListKey(item));
      if (!Number.isFinite(buildingIndex)) continue;
      if (!prereqByBuilding.has(buildingIndex)) prereqByBuilding.set(buildingIndex, []);
      prereqByBuilding.get(buildingIndex).push(district);
    }
  });

  const cityById = new Map((report && report.cities && report.cities.records || []).map((city) => [Number(city.id), city]));
  const buildingRowsByCity = culture && culture.buildingRowsByCity || {};
  const buildingWarnings = [];
  const wonderWarnings = [];
  const wonderDistrict = cfg.districts[WONDER_DISTRICT_ID]
    || cfg.districts.find((district) => normalizeListKey(district.name) === 'wonderdistrict')
    || null;

  for (const [cityIDText, rows] of Object.entries(buildingRowsByCity)) {
    const city = cityById.get(Number(cityIDText));
    if (!city || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || row.statusKind !== 'available') continue;
      const buildingIndex = Number(row.buildingIndex);
      const building = buildings && buildings[buildingIndex];
      const isWonder = isWonderBuilding(building);
      const requiresRiverDistrict = (((Number(building && building.improvements) || 0) >>> 0) & 0x8000) !== 0;
      const prereqDistricts = prereqByBuilding.get(buildingIndex) || [];
      if (isWonder && cfg.wonderDistrictsEnabled && wonderDistrict && prereqDistricts.some((district) => Number(district.id) === WONDER_DISTRICT_ID)) {
        const wonderConfig = cfg.wonders.find((wonder) => wonder.key === normalizeListKey(row.name)) || null;
        if (wonderConfig && wonderConfig.restrictedByCiv) continue;
        if (cityHasCompletedDistrict(city, WONDER_DISTRICT_ID, evalContext, { requireRiver: requiresRiverDistrict })) continue;
        const candidate = findDistrictCandidateTile(city, wonderDistrict, evalContext, wonderConfig);
        if (!candidate) continue;
        if (districtByCoord.has(tileKey(candidate.x, candidate.y))) continue;
        wonderWarnings.push({
          cityID: Number(city.id),
          city: city.name || `City ${city.id}`,
          buildingIndex,
          name: row.name,
          ref: row.ref,
          district: wonderDistrict.name,
          tile: { x: candidate.x, y: candidate.y },
        });
        continue;
      }
      const missing = prereqDistricts.find((district) => !cityHasCompletedDistrict(city, district.id, evalContext, { requireRiver: requiresRiverDistrict }));
      if (!missing || Number(missing.id) === WONDER_DISTRICT_ID) continue;
      const candidate = findDistrictCandidateTile(city, missing, evalContext);
      if (!candidate) continue;
      buildingWarnings.push({
        cityID: Number(city.id),
        city: city.name || `City ${city.id}`,
        buildingIndex,
        name: row.name,
        ref: row.ref,
        district: missing.name,
        tile: { x: candidate.x, y: candidate.y },
      });
    }
  }
  const sorter = (a, b) => String(a.city).localeCompare(String(b.city)) || String(a.name).localeCompare(String(b.name));
  return {
    buildings: buildingWarnings.sort(sorter),
    wonders: wonderWarnings.sort(sorter),
  };
}

function summarizeTradeRows(rows, getRefs, limit = 4) {
  const source = Array.isArray(rows) ? rows : [];
  const shown = source.slice(0, limit).map((row) => `${row.nation}: ${joinNames(getRefs(row), 3)}`).filter(Boolean);
  return source.length > shown.length ? `${shown.join('; ')}; and ${source.length - shown.length} more` : shown.join('; ');
}

function cityName(city) {
  return String(city && (city.name || city.city) || `City ${Number(city && city.id) || 0}`).trim();
}

function cityMapTarget(city) {
  if (!city || !Number.isFinite(Number(city.x)) || !Number.isFinite(Number(city.y))) return null;
  return { x: Number(city.x), y: Number(city.y), label: cityName(city) };
}

function cityDetailRows(city, rows = []) {
  const out = [];
  if (city && Number.isFinite(Number(city.x)) && Number.isFinite(Number(city.y))) {
    out.push({ label: 'Location', value: `${Number(city.x)},${Number(city.y)}` });
  }
  return out.concat(rows);
}

function cityFoodBoxSize(city) {
  const population = Math.max(0, Number(city && city.population) || 0);
  if (population <= 6) return 20;
  if (population <= 12) return 40;
  return 60;
}

function buildingHasBoolField(building, key) {
  const normalized = canonicalKey(key);
  const improvements = (Number(building && building.improvements) || 0) >>> 0;
  if (normalized === 'allowcitylevel2') return (improvements & (1 << 11)) !== 0;
  if (normalized === 'allowcitylevel3') return (improvements & (1 << 12)) !== 0;
  return parseConfigBoolValue(getRecordIdentityValue(building, key), false);
}

function cityHasBuiltBuildingFlag(city, buildings, key) {
  const records = Array.isArray(city && city.buildingRecords) ? city.buildingRecords : [];
  return records.some((record) => {
    if (Number(record && record.originalOwner) < 0) return false;
    const building = Array.isArray(buildings) ? buildings[Number(record.buildingIndex)] : null;
    return buildingHasBoolField(building, key);
  });
}

function cityCanGrowFromCurrentSize(city, buildings, freshWaterCityIDs = new Set()) {
  const population = Math.max(0, Number(city && city.population) || 0);
  if (population < 6) return true;
  if (population < 12) return freshWaterCityIDs.has(Number(city && city.id)) || cityHasBuiltBuildingFlag(city, buildings, 'allowcitylevel2');
  return false;
}

function selectedAlertCityRecords(report, cities) {
  const selectedIDs = new Set((cities && Array.isArray(cities.rows) ? cities.rows : [])
    .map((row) => Number(row && row.id))
    .filter((id) => Number.isFinite(id)));
  return (report && report.cities && Array.isArray(report.cities.records) ? report.cities.records : [])
    .filter((city) => selectedIDs.size === 0 || selectedIDs.has(Number(city.id)));
}

function makeAlertsReport(context) {
  const {
    report, gameDate, timePlayed, economy, production, military, technology, territory, cities, tradeRows, currentTradeRows,
    unconnectedResources, districtOpportunities, foreignUnitWarnings, pollutedTiles, buildings, freshWaterCityIDs,
  } = context;
  const alerts = [];
  const status = [
    { label: 'Current date', value: gameDate || '' },
    { label: 'Turn', value: String(report && report.game ? report.game.turnNumber : '') },
    { label: 'Time played', value: timePlayed || '' },
  ];
  const goldenAge = economy && economy.administration ? economy.administration.goldenAge : 'Inactive';
  status.push({ label: 'Golden Age', value: goldenAge || 'Inactive' });

  if (economy && Number(economy.netGain) < 0) {
    const treasury = Math.max(0, Number(economy.treasury) || 0);
    const deficit = Math.abs(Number(economy.netGain) || 0);
    const turns = deficit > 0 ? Math.floor(treasury / deficit) : null;
    alerts.push(makeAlert(
      'economy-deficit',
      'warning',
      'Economy',
      `Treasury is losing ${deficit} GPT`,
      Number.isFinite(turns) ? `${treasury} gold can cover about ${turns} turns at the current rate.` : 'Expenses exceed income at the current rate.',
      { tab: 'economy', sort: 10 }
    ));
  }

  (economy && economy.cityRows || []).filter((row) => Number(row.netGold) < 0).forEach((row) => {
    alerts.push(makeAlert(
      `city-deficit-${row.id}`,
      'warning',
      'Cities',
      `${row.name} is running a local deficit`,
      `${row.name} nets ${row.netGold} gold after maintenance.`,
      { tab: 'economy', amount: row.netGold, sort: 20 }
    ));
  });

  const cityRecords = selectedAlertCityRecords(report, cities);
  cityRecords.forEach((city) => {
    const foodStored = Math.max(0, Number(city.totalFood) || 0);
    const foodIncome = Number(city.foodIncome) || 0;
    const foodBox = cityFoodBoxSize(city);
    const name = cityName(city);
    if (foodIncome < 0 && foodStored + foodIncome < 0) {
      alerts.push(makeAlert(
        `city-starvation-${city.id}`,
        'critical',
        'Cities',
        `${name} is about to starve`,
        `${name} has ${foodStored} food stored and nets ${foodIncome} food.`,
        {
          tab: 'cities',
          detailRows: cityDetailRows(city, [
            { label: 'Stored food', value: foodStored },
            { label: 'Net food', value: foodIncome },
          ]),
          sort: 32,
        }
      ));
      return;
    }
    if (foodIncome > 0) {
      const canGrow = cityCanGrowFromCurrentSize(city, buildings, freshWaterCityIDs);
      if (canGrow && foodStored + foodIncome >= foodBox) {
        alerts.push(makeAlert(
          `city-growth-${city.id}`,
          'opportunity',
          'Cities',
          `${name} is about to grow`,
          `${name} will reach ${foodBox} food with +${foodIncome} food this turn.`,
          {
            tab: 'cities',
            detailRows: cityDetailRows(city, [
              { label: 'Stored food', value: foodStored },
              { label: 'Net food', value: `+${foodIncome}` },
              { label: 'Food box', value: foodBox },
            ]),
            sort: 130,
          }
        ));
      } else if (!canGrow && (foodStored >= foodBox || (Number(city.population) > 12 && foodStored + foodIncome > foodBox))) {
        alerts.push(makeAlert(
          `city-food-waste-${city.id}`,
          'warning',
          'Cities',
          `${name} is wasting food`,
          `${name} has filled its ${foodBox}-food box but cannot grow past size ${Number(city.population) || 0}.`,
          {
            tab: 'cities',
            detailRows: cityDetailRows(city, [
              { label: 'Stored food', value: foodStored },
              { label: 'Net food', value: `+${foodIncome}` },
              { label: 'Food box', value: foodBox },
            ]),
            sort: 34,
          }
        ));
      }
    }
  });

  cityRecords.filter((city) => Number(city.resistingCitizens) > 0).forEach((city) => {
    const name = cityName(city);
    alerts.push(makeAlert(
      `city-resistance-${city.id}`,
      'critical',
      'Cities',
      `${name} is in resistance`,
      `${name} has ${Number(city.resistingCitizens)} resisting citizen${Number(city.resistingCitizens) === 1 ? '' : 's'}.`,
      {
        tab: 'cities',
        detailRows: cityDetailRows(city, [
          { label: 'Resisting citizens', value: Number(city.resistingCitizens) },
        ]),
        sort: 36,
      }
    ));
  });

  const researchProgress = technology && technology.progress ? technology.progress : {};
  const researchWaste = Number(researchProgress.endWastage && researchProgress.endWastage.beakers) || 0;
  const remainingTurns = Number(researchProgress.remaining && researchProgress.remaining.turns) || 0;
  const remainingBeakers = Number(researchProgress.remaining && researchProgress.remaining.beakers) || 0;
  if (researchWaste > 0 && remainingTurns <= 1) {
    alerts.push(makeAlert(
      'research-overrun',
      'warning',
      'Techs',
      `Research will overrun ${researchWaste} beakers`,
      `${technology.currentProject || 'Current research'} needs ${remainingBeakers} more beakers and produces ${Number(technology.beakersPerTurn) || 0} beakers per turn.`,
      {
        tab: 'techs',
        refs: uniqueRefs([technology.currentProjectRef]),
        detailRows: [
          { label: 'Research', items: technology.currentProjectRef ? [{ name: technology.currentProject, ref: technology.currentProjectRef }] : [] },
          { label: 'Beakers per turn', value: Number(technology.beakersPerTurn) || 0 },
          { label: 'Beakers needed', value: remainingBeakers },
          { label: 'Overrun', value: `${researchWaste} beakers` },
        ],
        sort: 38,
      }
    ));
  }

  (production && production.rows || []).filter((row) => Number(row.overrun) > 0).forEach((row) => {
    alerts.push(makeAlert(
      `production-overrun-${row.cityID}`,
      'warning',
      'Production',
      `${row.city} has production overrun`,
      `${row.city} will overrun ${row.overrun} shield${Number(row.overrun) === 1 ? '' : 's'} (${row.overrunPercent}%) on ${row.producing}.`,
      {
        tab: 'production',
        refs: uniqueRefs([row.producingRef]),
        detailRows: [
          { label: 'Build', items: row.producingRef ? [{ name: row.producing, ref: row.producingRef }] : [] },
          { label: 'Overrun', value: `${row.overrun} shield${Number(row.overrun) === 1 ? '' : 's'}` },
          { label: 'Overrun percent', value: `${row.overrunPercent}%` },
        ],
        amount: row.overrun,
        sort: 42,
      }
    ));
  });

  (territory && territory.cityRows || []).filter((row) => Number(row.unimproved) > 0).forEach((row) => {
    alerts.push(makeAlert(
      `worked-unimproved-${row.id}`,
      'warning',
      'Territory',
      `${row.city} is working unimproved tiles`,
      `${row.city} is working ${row.unimproved} unimproved tile${Number(row.unimproved) === 1 ? '' : 's'}.`,
      {
        tab: 'territory',
        detailRows: [
          { label: 'Unimproved worked tiles', value: Number(row.unimproved) },
        ],
        amount: row.unimproved,
        sort: 44,
      }
    ));
  });

  const polluted = Array.isArray(pollutedTiles) ? pollutedTiles : [];
  if (polluted.length > 0) {
    alerts.push(makeAlert(
      'polluted-tiles',
      'warning',
      'Territory',
      `${polluted.length} polluted tile${polluted.length === 1 ? '' : 's'} in our territory`,
      polluted.map((tile, index) => `#${index + 1}: ${tile.x},${tile.y}`).join('; '),
      {
        tab: 'map',
        mapTargets: polluted.map((tile, index) => ({ x: tile.x, y: tile.y, label: `Pollution #${index + 1}` })),
        detailRows: polluted.map((tile, index) => ({ label: `Pollution #${index + 1}`, value: `${tile.x},${tile.y}` })),
        sort: 46,
      }
    ));
  }

  (foreignUnitWarnings || []).forEach((row) => {
    const unitLabel = `${row.unitCount} ${row.atWar ? 'enemy' : 'foreign'} unit${row.unitCount === 1 ? '' : 's'}`;
    alerts.push(makeAlert(
      `foreign-units-${row.x}-${row.y}`,
      row.atWar ? 'critical' : 'warning',
      'Military',
      `${unitLabel} on our territory at ${row.x}, ${row.y}`,
      row.detail,
      {
        tab: 'military',
        subtab: 'units',
        refs: row.refs,
        mapTargets: [{ x: row.x, y: row.y, label: unitLabel }],
        detailRows: row.owners.map((owner) => ({
          label: `${owner.nation} (${owner.atWar ? 'at war' : 'at peace'})`,
          labelRef: owner.nationRef,
          items: owner.types.map((type) => ({
            name: `${type.count > 1 ? `${type.count} ` : ''}${type.name}`,
            ref: type.ref,
          })),
        })),
        sort: 30,
      }
    ));
  });

  (currentTradeRows || [])
    .filter((row) => String(row.nation || '').trim() === '' && Number(row.turnsLeft) > 0 && Number(row.turnsLeft) <= 1)
    .forEach((row, index) => {
      alerts.push(makeAlert(
        `trade-expiring-${index}`,
        'warning',
        'Trade',
        'A trade deal expires next turn',
        `We give ${row.weGive || 'nothing'} and receive ${row.weReceive || 'nothing'}.`,
        {
          tab: 'trade',
          subtab: 'current',
          refs: [...(row.weGiveRefs || []), ...(row.weReceiveRefs || [])],
          detailRows: [
            { label: 'We give', items: (row.weGiveRefs || []).map((ref) => ({ name: ref.name, ref })) },
            { label: 'We receive', items: (row.weReceiveRefs || []).map((ref) => ({ name: ref.name, ref })) },
            { label: 'Turns left', value: row.turnsLeft },
          ],
          sort: 60,
        }
      ));
    });

  const contactRows = (tradeRows || []).filter((row) => row.hasContact);
  const sellTechRows = contactRows.filter((row) => row.sell && Array.isArray(row.sell.technologyRefs) && row.sell.technologyRefs.length > 0);
  const sellResourceRows = contactRows.filter((row) => row.sell && Array.isArray(row.sell.resourceRefs) && row.sell.resourceRefs.length > 0);
  const buyTechRows = contactRows.filter((row) => row.buy && Array.isArray(row.buy.technologyRefs) && row.buy.technologyRefs.length > 0);
  const buyResourceRows = contactRows.filter((row) => row.buy && Array.isArray(row.buy.resourceRefs) && row.buy.resourceRefs.length > 0);
  const cashRows = contactRows.filter((row) => Number(row.gold) >= 50);
  const talkRows = contactRows.filter((row) => row.atWar && row.willTalk);

  if (buyTechRows.length > 0) {
    alerts.push(makeAlert(
      'buy-tech',
      'opportunity',
      'Trade',
      `Technology is for sale from ${buyTechRows.length} civ${buyTechRows.length === 1 ? '' : 's'}`,
      summarizeTradeRows(buyTechRows, (row) => row.buy.technologyRefs),
      {
        tab: 'trade',
        subtab: 'buy',
        refs: uniqueRefs(buyTechRows.flatMap((row) => row.buy.technologyRefs)),
        detailRows: buyTechRows.map((row) => ({
          label: row.nation,
          labelRef: row.nationRef,
          items: row.buy.technologyRefs.map((ref) => ({ name: ref.name, ref })),
        })),
        sort: 70,
      }
    ));
  }
  if (buyResourceRows.length > 0) {
    alerts.push(makeAlert(
      'buy-resource',
      'opportunity',
      'Trade',
      `Resources are for sale from ${buyResourceRows.length} civ${buyResourceRows.length === 1 ? '' : 's'}`,
      summarizeTradeRows(buyResourceRows, (row) => row.buy.resourceRefs),
      {
        tab: 'trade',
        subtab: 'buy',
        refs: uniqueRefs(buyResourceRows.flatMap((row) => row.buy.resourceRefs)),
        detailRows: buyResourceRows.map((row) => ({
          label: row.nation,
          labelRef: row.nationRef,
          items: row.buy.resourceRefs.map((ref) => ({ name: ref.name, ref })),
        })),
        sort: 80,
      }
    ));
  }
  if (sellTechRows.length > 0) {
    alerts.push(makeAlert(
      'sell-tech',
      'opportunity',
      'Trade',
      `We can sell technology to ${sellTechRows.length} civ${sellTechRows.length === 1 ? '' : 's'}`,
      summarizeTradeRows(sellTechRows, (row) => row.sell.technologyRefs),
      {
        tab: 'trade',
        subtab: 'sell',
        refs: uniqueRefs(sellTechRows.flatMap((row) => row.sell.technologyRefs)),
        detailRows: sellTechRows.map((row) => ({
          label: row.nation,
          labelRef: row.nationRef,
          items: row.sell.technologyRefs.map((ref) => ({ name: ref.name, ref })),
        })),
        sort: 90,
      }
    ));
  }
  if (sellResourceRows.length > 0) {
    alerts.push(makeAlert(
      'sell-resource',
      'opportunity',
      'Trade',
      `We can sell resources to ${sellResourceRows.length} civ${sellResourceRows.length === 1 ? '' : 's'}`,
      summarizeTradeRows(sellResourceRows, (row) => row.sell.resourceRefs),
      {
        tab: 'trade',
        subtab: 'sell',
        refs: uniqueRefs(sellResourceRows.flatMap((row) => row.sell.resourceRefs)),
        detailRows: sellResourceRows.map((row) => ({
          label: row.nation,
          labelRef: row.nationRef,
          items: row.sell.resourceRefs.map((ref) => ({ name: ref.name, ref })),
        })),
        sort: 100,
      }
    ));
  }
  if (cashRows.length > 0) {
    alerts.push(makeAlert(
      'rival-cash',
      'info',
      'Trade',
      `${cashRows.length} rival${cashRows.length === 1 ? ' has' : 's have'} notable cash`,
      cashRows.map((row) => `${row.nation}: ${row.gold} gold`).join('; '),
      {
        tab: 'trade',
        subtab: 'sell',
        refs: uniqueRefs(cashRows.map((row) => row.nationRef)),
        detailRows: cashRows.map((row) => ({ label: row.nation, labelRef: row.nationRef, value: `${row.gold} gold` })),
        sort: 110,
      }
    ));
  }
  if (talkRows.length > 0) {
    alerts.push(makeAlert(
      'will-talk',
      'opportunity',
      'Diplomacy',
      `${talkRows.length} enem${talkRows.length === 1 ? 'y is' : 'ies are'} willing to negotiate`,
      talkRows.map((row) => row.nation).join(', '),
      {
        tab: 'diplomacy',
        refs: uniqueRefs(talkRows.map((row) => row.nationRef)),
        detailRows: talkRows.map((row) => ({ label: row.nation, labelRef: row.nationRef, value: 'Will talk' })),
        sort: 120,
      }
    ));
  }

  const unconnected = Array.isArray(unconnectedResources) ? unconnectedResources : [];
  if (unconnected.length > 0) {
    alerts.push(makeAlert(
      'unconnected-resources',
      'warning',
      'Resources',
      `${unconnected.length} resource${unconnected.length === 1 ? '' : 's'} in our territory ${unconnected.length === 1 ? 'is' : 'are'} unconnected`,
      unconnected.map((row) => `${row.name}: ${row.count} source${Number(row.count) === 1 ? '' : 's'}`).join('; '),
      {
        tab: 'territory',
        refs: uniqueRefs(unconnected.map((row) => row.ref)),
        mapTargets: unconnected.flatMap((row) => row.tiles.map((tile) => ({
          x: tile.x,
          y: tile.y,
          label: row.name,
        }))),
        detailRows: unconnected.map((row) => ({
          label: row.name,
          labelRef: row.ref,
          value: row.tiles.map((tile) => `${tile.x},${tile.y}`).join('; '),
        })),
        sort: 150,
      }
    ));
  }

  const districtBuildings = districtOpportunities && Array.isArray(districtOpportunities.buildings) ? districtOpportunities.buildings : [];
  if (districtBuildings.length > 0) {
    alerts.push(makeAlert(
      'district-building-opportunities',
      'opportunity',
      'Districts',
      `${districtBuildings.length} building${districtBuildings.length === 1 ? '' : 's'} could unlock with districts`,
      districtBuildings.slice(0, 6).map((row) => `${row.city}: ${row.name} via ${row.district}`).join('; '),
      {
        tab: 'culture',
        refs: uniqueRefs(districtBuildings.map((row) => row.ref)),
        mapTargets: districtBuildings.map((row) => ({ x: row.tile.x, y: row.tile.y, label: `${row.city}: ${row.district}` })),
        detailRows: districtBuildings.map((row) => ({
          label: row.city,
          items: [{ name: row.name, ref: row.ref }],
          value: `${row.district} at ${row.tile.x},${row.tile.y}`,
        })),
        sort: 160,
      }
    ));
  }

  const districtWonders = districtOpportunities && Array.isArray(districtOpportunities.wonders) ? districtOpportunities.wonders : [];
  if (districtWonders.length > 0) {
    alerts.push(makeAlert(
      'wonder-district-opportunities',
      'opportunity',
      'Districts',
      `${districtWonders.length} wonder${districtWonders.length === 1 ? '' : 's'} could unlock with Wonder Districts`,
      districtWonders.slice(0, 6).map((row) => `${row.city}: ${row.name} at ${row.tile.x},${row.tile.y}`).join('; '),
      {
        tab: 'culture',
        refs: uniqueRefs(districtWonders.map((row) => row.ref)),
        mapTargets: districtWonders.map((row) => ({ x: row.tile.x, y: row.tile.y, label: `${row.city}: ${row.district}` })),
        detailRows: districtWonders.map((row) => ({
          label: row.city,
          items: [{ name: row.name, ref: row.ref }],
          value: `${row.district} at ${row.tile.x},${row.tile.y}`,
        })),
        sort: 170,
      }
    ));
  }

  const current = alerts.sort((a, b) => (
    alertSeverityRank(a.severity) - alertSeverityRank(b.severity)
    || Number(a.sort) - Number(b.sort)
    || String(a.title).localeCompare(String(b.title))
  ));

  const coverage = [
    {
      id: 'trade-buy-tech',
      label: 'Techs we can buy',
      status: 'Active',
      note: 'Shows technology purchase opportunities from contacted rivals.',
      tab: 'trade',
      alertIds: ['buy-tech'],
    },
    {
      id: 'trade-buy-resources',
      label: 'Resources we can buy',
      status: 'Active',
      note: 'Shows resource purchase opportunities from contacted rivals.',
      tab: 'trade',
      alertIds: ['buy-resource'],
    },
    {
      id: 'trade-sell-tech',
      label: 'Techs we can sell',
      status: 'Active',
      note: 'Shows technology sale opportunities to contacted rivals.',
      tab: 'trade',
      alertIds: ['sell-tech'],
    },
    {
      id: 'trade-sell-resources',
      label: 'Resources we can sell',
      status: 'Active',
      note: 'Shows resource sale opportunities to contacted rivals.',
      tab: 'trade',
      alertIds: ['sell-resource'],
    },
    {
      id: 'trade-rival-cash',
      label: 'Rivals with notable cash',
      status: 'Active',
      note: 'Shows contacted rivals with enough gold to be worth checking.',
      tab: 'trade',
      alertIds: ['rival-cash'],
    },
    {
      id: 'trade-expiring',
      label: 'Expiring trade deals',
      status: 'Active',
      note: 'Shows timed deals that expire next turn.',
      tab: 'trade',
      alertIdPrefixes: ['trade-expiring-'],
    },
    {
      id: 'diplomacy',
      label: 'Enemies willing to negotiate',
      status: 'Active',
      note: 'Uses live diplomacy state for contacted rivals currently at war.',
      tab: 'diplomacy',
      alertIds: ['will-talk'],
    },
    {
      id: 'research-overrun',
      label: 'Research overrun',
      status: 'Active',
      note: 'Shows last-turn research waste when current beaker output exceeds the remaining cost.',
      tab: 'techs',
      alertIds: ['research-overrun'],
    },
    {
      id: 'economy-treasury',
      label: 'Treasury deficit',
      status: 'Active',
      note: 'Shows when the national treasury cannot cover projected losses.',
      tab: 'economy',
      alertIds: ['economy-deficit'],
    },
    {
      id: 'economy-city-deficits',
      label: 'City local deficits',
      status: 'Active',
      note: 'Shows cities losing gold after maintenance.',
      tab: 'economy',
      alertIdPrefixes: ['city-deficit-'],
    },
    {
      id: 'city-starvation',
      label: 'Cities about to starve',
      status: 'Active',
      note: 'Shows cities that will run out of stored food this turn.',
      tab: 'cities',
      alertIdPrefixes: ['city-starvation-'],
    },
    {
      id: 'city-growth',
      label: 'Cities about to grow',
      status: 'Active',
      note: 'Shows cities that can grow when this turn fills the food box.',
      tab: 'cities',
      alertIdPrefixes: ['city-growth-'],
    },
    {
      id: 'city-resistance',
      label: 'Cities in resistance',
      status: 'Active',
      note: 'Shows cities with resisting citizens in the saved city population data.',
      tab: 'cities',
      alertIdPrefixes: ['city-resistance-'],
    },
    {
      id: 'city-food-waste',
      label: 'Cities wasting food',
      status: 'Active',
      note: 'Shows cities that fill the food box but cannot grow past the current size cap.',
      tab: 'cities',
      alertIdPrefixes: ['city-food-waste-'],
    },
    {
      id: 'city-production-overrun',
      label: 'City production overrun',
      status: 'Active',
      note: 'Shows cities whose current shield output will exceed the remaining build cost.',
      tab: 'production',
      alertIdPrefixes: ['production-overrun-'],
    },
    {
      id: 'resources',
      label: 'Unconnected resources',
      status: 'Active',
      note: 'Compares owned resource tiles against the save trade-network resource counts.',
      tab: 'territory',
      alertIds: ['unconnected-resources'],
    },
    {
      id: 'city-worked-unimproved',
      label: 'Worked unimproved tiles',
      status: 'Active',
      note: 'Shows cities assigning citizens to tiles without roads, irrigation, mines, forests, or districts.',
      tab: 'territory',
      alertIdPrefixes: ['worked-unimproved-'],
    },
    {
      id: 'polluted-tiles',
      label: 'Polluted tiles',
      status: 'Active',
      note: 'Shows polluted owned tiles and links them to the Civ Advisor map.',
      tab: 'territory',
      alertIds: ['polluted-tiles'],
    },
    {
      id: 'foreign-units',
      label: 'Foreign units in our territory',
      status: 'Active',
      note: 'Groups visible foreign units by tile and raises the severity when any unit owner is at war.',
      tab: 'military',
      alertIdPrefixes: ['foreign-units-'],
    },
    {
      id: 'district-buildings',
      label: 'District buildings available',
      status: 'Active',
      note: 'Shows improvements unlocked by existing or buildable districts.',
      category: 'districts',
      tab: 'culture',
      alertIds: ['district-building-opportunities'],
    },
    {
      id: 'district-wonders',
      label: 'Wonder district sites',
      status: 'Active',
      note: 'Shows terrain-qualified Wonder District opportunities.',
      category: 'districts',
      tab: 'culture',
      alertIds: ['wonder-district-opportunities'],
    },
  ];

  return {
    current,
    status,
    coverage,
    counts: {
      total: current.length,
      critical: current.filter((alert) => alert.severity === 'critical').length,
      warning: current.filter((alert) => alert.severity === 'warning').length,
      opportunity: current.filter((alert) => alert.severity === 'opportunity').length,
      info: current.filter((alert) => alert.severity === 'info').length,
    },
  };
}

function hasResourcePrereq(resource, techMasks, playerID) {
  const prereq = Number(resource && resource.prerequisite);
  return !Number.isFinite(prereq) || prereq < 0 || playerHasTech(techMasks, prereq, playerID);
}

function formatTradeItems(items, limit = 3) {
  const source = Array.isArray(items) ? items.filter(Boolean) : [];
  if (source.length === 0) return '';
  const shown = source.slice(0, Math.max(1, Number(limit) || 3)).map((item) => String(item && item.name || item));
  return source.length > shown.length
    ? `(${source.length}) ${shown.join(', ')}...`
    : shown.join(', ');
}

function sliceTradeRefs(items, limit = null) {
  const source = Array.isArray(items) ? items.filter(Boolean) : [];
  const max = limit == null ? source.length : Math.max(1, Number(limit) || 0);
  const shown = source.slice(0, max);
  return {
    refs: shown.map((item) => item && item.ref).filter(Boolean),
    total: source.length,
    truncated: source.length > shown.length,
  };
}

function getDynamicTailCounts(report, sections, rules) {
  return {
    improvements: Math.max(0, Number(sections && sections.improvements) || 0),
    unitTypes: Math.max(0, Number(sections && sections.units) || 0),
    resources: Math.max(0, Number(sections && sections.resources) || 0),
    spaceshipParts: Math.max(0, Number(rules && rules.numSSParts) || 0),
    continents: Math.max(0, Number(report && report.game && report.game.numConts) || 0),
  };
}

function parseTradeOfferGroups(items) {
  const groups = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || item.kind !== -1) continue;
    const count = Math.max(0, Number(item.param1) || 0);
    const endTurn = Number(item.param2) || 0;
    const offers = items.slice(i + 1, i + 1 + count);
    groups.push({ endTurn, offers });
    i += count;
  }
  return groups;
}

function parseLeaderTradeTail(buf, player, counts) {
  const lists = new Map();
  const resourceStates = [];
  const resourceCounts = [];
  let off = Number(player && player.offset) + 8 + Number(player && player.dataLength);
  if (!Buffer.isBuffer(buf) || !Number.isFinite(off) || off < 0 || off > buf.length) return { lists, resourceStates, resourceCounts };

  for (let playerID = 0; playerID < 32; playerID += 1) {
    const count = readInt32Safe(buf, off, 0);
    off += 4;
    const offers = [];
    for (let i = 0; i < count && off + 12 <= buf.length; i += 1) {
      offers.push({
        kind: readInt32Safe(buf, off, 0),
        param1: readInt32Safe(buf, off + 4, 0),
        param2: readInt32Safe(buf, off + 8, 0),
      });
      off += 12;
    }
    lists.set(playerID, parseTradeOfferGroups(offers));
  }

  const body = Number(player && player.offset) + 8;
  const hasDynamicArrays = readInt32Safe(buf, body + 0x1198, 0) !== 0;
  if (!hasDynamicArrays) return { lists, resourceStates, resourceCounts };

  const improvementCount = Math.max(0, Number(counts && counts.improvements) || 0);
  const unitTypeCount = Math.max(0, Number(counts && counts.unitTypes) || 0);
  const spaceshipParts = Math.max(0, Number(counts && counts.spaceshipParts) || 0);
  const resourceCount = Math.max(0, Number(counts && counts.resources) || 0);
  const continentCount = Math.max(0, Number(counts && counts.continents) || 0);
  off += improvementCount * 2 * 3;
  off += improvementCount * 4;
  off += improvementCount;
  off += unitTypeCount * 2 * 3;
  off += spaceshipParts * 2;

  const resourceTableStart = off;
  for (let resourceID = 0; resourceID < resourceCount; resourceID += 1) {
    const perPlayer = [];
    for (let playerID = 0; playerID < 32; playerID += 1) {
      const entry = resourceTableStart + (resourceID * 32 + playerID) * 3;
      perPlayer.push({
        available: readUInt8Safe(buf, entry, 0),
        importable: readUInt8Safe(buf, entry + 1, 0),
        marker: readUInt8Safe(buf, entry + 2, 0),
      });
    }
    resourceStates.push(perPlayer);
  }
  off += resourceCount * 0x60;
  for (let resourceID = 0; resourceID < resourceCount; resourceID += 1) {
    resourceCounts.push(readUInt8Safe(buf, off + resourceID, 0));
  }
  off += resourceCount;
  off += continentCount * 4 * 5;
  return { lists, resourceStates, resourceCounts, endOffset: off };
}

function resourceName(resources, resourceID) {
  return recordName(resources, resourceID, 'GOOD', '');
}

function makeResourceItem(resources, resourceID, count, ruleSignatures) {
  const name = resourceName(resources, resourceID);
  if (!name) return null;
  const suffix = Number.isFinite(Number(count)) ? ` (${Number(count) || 0})` : '';
  return {
    name: `${name}${suffix}`,
    ref: makeRef('resources', 'GOOD', resourceID, name, ruleSignatures),
  };
}

function tradeOfferItem(offer, context) {
  if (!offer) return null;
  const kind = Number(offer.kind);
  if (kind === 0 && Number(offer.param1) === 0) return { name: 'Peace Treaty', ref: null };
  if (kind === 5 || kind === 6) {
    const resourceID = Number(offer.param1);
    const name = resourceName(context.resources, resourceID);
    if (!name) return null;
    return { name, ref: makeRef('resources', 'GOOD', resourceID, name, context.ruleSignatures) };
  }
  if (kind === 8) {
    const techID = Number(offer.param1);
    const name = recordName(context.techs, techID, 'TECH', '');
    if (!name) return null;
    return { name, ref: makeRef('technologies', 'TECH', techID, name, context.ruleSignatures) };
  }
  if (kind === 7) {
    const amount = Math.max(0, Number(offer.param2) || 0);
    return { name: Number(offer.param1) === 0 ? `${amount} GPT` : `${amount} Gold`, ref: null };
  }
  return null;
}

function tradeOfferItems(offers, context) {
  return (Array.isArray(offers) ? offers : [])
    .map((offer) => tradeOfferItem(offer, context))
    .filter(Boolean);
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function cultureComparisonLabel(subjectCulture, otherCulture) {
  const subject = Math.max(0, Number(subjectCulture) || 0);
  const other = Math.max(0, Number(otherCulture) || 0);
  if (subject <= 0 && other <= 0) return 'unknown';
  if (subject > 0 && other <= 0) return 'in awe of';
  if (subject <= 0) return 'disdainful of';
  const ratio = subject / Math.max(1, other);
  if (ratio >= 2) return 'in awe of';
  if (ratio >= 1.2) return 'admirers of';
  if (ratio >= 0.8) return 'impressed by';
  if (ratio >= 0.5) return 'unimpressed by';
  return 'disdainful of';
}

function makeCultureComparisonRef(label, cultureRecords, ruleSignatures) {
  const aliases = {
    impressedby: 'impressedwith',
  };
  const wanted = aliases[canonicalKey(label)] || canonicalKey(label);
  const index = (cultureRecords || []).findIndex((record) => canonicalKey(record && record.name) === wanted);
  if (index < 0) return null;
  return makeRef('rules', 'CULT', index, recordName(cultureRecords, index, 'CULT', label), ruleSignatures);
}

function makeDiplomacyReport({ tradeRows, humanVisible, humanTradeTail, currentTurn, cultureRecords, ruleSignatures }) {
  const turn = Number(currentTurn) || 0;
  const humanPlayerID = Number(humanVisible && humanVisible.playerID);
  const rows = (tradeRows || []).map((row) => {
    const playerID = Number(row.playerID);
    const outgoingDeals = ((humanTradeTail && humanTradeTail.lists && humanTradeTail.lists.get(playerID)) || [])
      .filter((group) => Number(group.endTurn) > turn);
    const incomingDeals = ((row.tradeTail && row.tradeTail.lists && row.tradeTail.lists.get(humanPlayerID)) || [])
      .filter((group) => Number(group.endTurn) > turn);
    const sellCount = (Number(row.sell && row.sell.technologyTotal) || 0) + (Number(row.sell && row.sell.resourceTotal) || 0);
    const buyCount = (Number(row.buy && row.buy.technologyTotal) || 0) + (Number(row.buy && row.buy.resourceTotal) || 0);
    const ourCulture = cultureComparisonLabel(humanVisible && humanVisible.culture, row.culture);
    const theirCulture = cultureComparisonLabel(row.culture, humanVisible && humanVisible.culture);
    return {
      playerID,
      nation: row.nation,
      nationRef: row.nationRef,
      color: row.color,
      colorSlot: row.colorSlot,
      ourCulture,
      ourCultureRef: makeCultureComparisonRef(ourCulture, cultureRecords, ruleSignatures),
      theirCulture,
      theirCultureRef: makeCultureComparisonRef(theirCulture, cultureRecords, ruleSignatures),
      contact: yesNo(row.hasContact),
      relation: row.relation,
      willTalk: yesNo(row.willTalk),
      activeDeals: outgoingDeals.length + incomingDeals.length,
      canTrade: yesNo(row.hasContact && (!row.atWar || row.willTalk)),
      sellOptions: sellCount,
      buyOptions: buyCount,
      gold: row.gold,
      government: row.government,
      governmentRef: row.governmentRef,
      currentEra: row.currentEra,
      currentEraRef: row.currentEraRef,
    };
  });
  const contacts = rows.filter((row) => row.contact === 'Yes').length;
  const wars = rows.filter((row) => row.relation === 'War').length;
  return {
    summary: [
      { label: 'Known Civs', value: String(contacts) },
      { label: 'At War', value: String(wars) },
      { label: 'Will Talk', value: String(rows.filter((row) => row.willTalk === 'Yes').length) },
      { label: 'Trade Partners', value: String(rows.filter((row) => row.canTrade === 'Yes').length) },
      { label: 'Timed Deals', value: String(rows.reduce((sum, row) => sum + (Number(row.activeDeals) || 0), 0)) },
    ],
    rows,
    coverage: [
      { label: 'Contact, relation, will talk', status: 'Active', note: 'Read from live LEAD diplomacy vectors.' },
      { label: 'Culture comparison', status: 'Active', note: 'Ratio-based label using saved culture totals; exact Civ Advisor thresholds still need confirmation.' },
      { label: 'Embassy, spy, ROP, MPP, alliances', status: 'Planned', note: 'Live save offsets are not yet verified, so the tab does not guess.' },
      { label: 'Trade context', status: 'Active', note: 'Shows active timed deal counts plus current buy/sell opportunity counts.' },
    ],
  };
}

function canExportResource(exporterTrade, exporterID, importerTrade, importerID, resourceID, requireSurplus) {
  const exporterStates = exporterTrade && exporterTrade.resourceStates && exporterTrade.resourceStates[resourceID];
  const importerStates = importerTrade && importerTrade.resourceStates && importerTrade.resourceStates[resourceID];
  if (!exporterStates || !importerStates) return false;
  for (let playerID = 0; playerID < 32; playerID += 1) {
    const state = importerStates[playerID];
    if (state && state.available && state.importable) return false;
  }
  const alreadyExporting = exporterStates[importerID] && exporterStates[importerID].available;
  if (alreadyExporting) return false;
  const surplus = Number(exporterTrade.resourceCounts && exporterTrade.resourceCounts[resourceID]) || 0;
  if (surplus > 0) return true;
  if (requireSurplus) return false;
  const ownState = exporterStates[exporterID];
  return !!(ownState && ownState.available);
}

function resourceTradeItemsForExport(resources, techMasks, exporter, exporterTrade, importer, importerTrade, requireSurplus, ruleSignatures) {
  const items = [];
  for (let resourceID = 0; resourceID < resources.length; resourceID += 1) {
    const resource = resources[resourceID] || {};
    const type = Number(resource.type);
    if (type !== 1 && type !== 2) continue;
    if (!hasResourcePrereq(resource, techMasks, importer.playerID)) continue;
    if (!canExportResource(exporterTrade, exporter.playerID, importerTrade, importer.playerID, resourceID, requireSurplus)) continue;
    const item = makeResourceItem(resources, resourceID, exporterTrade.resourceCounts[resourceID], ruleSignatures);
    if (item) items.push(item);
  }
  return items;
}

function inspectCivAdvisorSaveFile(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: `SAV file not found: ${filePath || '(empty path)'}` };
  const raw = fs.readFileSync(filePath);
  const inflated = inflateSavIfNeeded(raw);
  if (!inflated.ok) return inflated;
  const extract = extractEmbeddedBiqFromSavBuffer(inflated.buffer);
  if (!extract.ok) return extract;
  const parsed = parseAllSections(extract.buffer);
  if (!parsed.ok) return { ok: false, error: `Embedded BIQ parse failed: ${parsed.error || 'unknown error'}` };
  const report = inspectSavBuffer(inflated.buffer, {
    sourcePath: filePath,
    inflated,
    extract,
    parsed,
    includeMapData: options && options.includeMap === true,
  });
  if (!report.ok) return report;

  const gameRules = section(parsed, 'GAME').records[0] || {};
  const races = section(parsed, 'RACE').records;
  const governments = section(parsed, 'GOVT').records;
  const difficulties = section(parsed, 'DIFF').records;
  const eras = section(parsed, 'ERAS').records;
  const techs = section(parsed, 'TECH').records;
  const resources = section(parsed, 'GOOD').records;
  const buildings = section(parsed, 'BLDG').records;
  const unitTypes = section(parsed, 'PRTO').records;
  const terrainRecords = section(parsed, 'TERR').records;
  const experienceLevels = section(parsed, 'EXPR').records;
  const cultureRecords = section(parsed, 'CULT').records;
  const worldSizes = section(parsed, 'WSIZ').records;
  const ruleRecord = section(parsed, 'RULE').records[0] || {};
  const ruleSignatures = {
    RACE: makeRuleSectionSignature('RACE', races),
    TECH: makeRuleSectionSignature('TECH', techs),
    GOOD: makeRuleSectionSignature('GOOD', resources),
    BLDG: makeRuleSectionSignature('BLDG', buildings),
    PRTO: makeRuleSectionSignature('PRTO', unitTypes),
    GOVT: makeRuleSectionSignature('GOVT', governments),
    ERAS: makeRuleSectionSignature('ERAS', eras),
    CULT: makeRuleSectionSignature('CULT', cultureRecords),
  };
  const saveArtContext = buildCivAdvisorSaveArtContext(parsed, gameRules, options);
  const cityById = new Map((report.cities && report.cities.records || []).map((city) => [Number(city.id), city]));
  const players = Array.isArray(report.players) ? report.players : [];
  const active = activePlayers(players, report.game);
  const colorSlotsByPlayer = buildPlayerColorSlots(active, races);
  const humanPlayer = findHumanPlayer(players, report.game && report.game.humanPlayersMask, report.game);
  if (!humanPlayer) return { ok: false, error: 'No active human player found in SAV.' };
  const requestedPlayerID = Number(options && options.selectedPlayerID);
  const allPlayersMode = requestedPlayerID === -1;
  const selectedPlayer = Number.isFinite(requestedPlayerID)
    ? active.find((player) => Number(player.playerID) === requestedPlayerID)
    : null;
  const human = allPlayersMode ? humanPlayer : (selectedPlayer || humanPlayer);
  const perspectiveMask = playerBitMask(human.playerID) || ((Number(report.game && report.game.humanPlayersMask) || 0) >>> 0);
  const detailsByPlayer = parsePlayerDetails(inflated.buffer, players, cityById);

  let map = null;
  if (options && options.includeMap === true && report.mapData) {
    const mapPerspectivePlayer = allPlayersMode ? humanPlayer : human;
    const mapPerspectiveMask = playerBitMask(mapPerspectivePlayer.playerID)
      || ((Number(report.game && report.game.humanPlayersMask) || 0) >>> 0);
    const mapTiles = (report.mapData.tiles || []).map((tile) => {
      const explored = ((Number(tile.exploredBy) >>> 0) & mapPerspectiveMask) !== 0;
      const visibleNow = explored && (((Number(tile.visibleBy) >>> 0) & mapPerspectiveMask) !== 0);
      return {
        ...tile,
        visibility: visibleNow ? 2 : (explored ? 1 : 0),
      };
    });
    const compactRecords = (records, keys) => (records || []).map((record, index) => {
      const out = { index };
      keys.forEach((key) => {
        if (record && Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
      });
      return out;
    });
    map = {
      ...report.mapData,
      tiles: mapTiles,
      perspectivePlayerID: Number(mapPerspectivePlayer.playerID),
      perspectiveNation: recordName(races, mapPerspectivePlayer.raceID, 'RACE', `Player ${mapPerspectivePlayer.playerID}`),
      exploredTiles: mapTiles.filter((tile) => Number(tile.visibility) > 0).length,
      visibleTiles: mapTiles.filter((tile) => Number(tile.visibility) === 2).length,
      support: {
        races: compactRecords(races, ['name', 'civilizationName', 'civilopediaEntry', 'defaultColor', 'cultureGroup']),
        unitTypes: compactRecords(unitTypes, ['name', 'civilopediaEntry', 'iconIndex', 'unitClass', 'defence']),
        terrain: compactRecords(terrainRecords, [
          'name', 'civilopediaEntry', 'food', 'shields', 'commerce', 'foodBonus', 'shieldsBonus', 'commerceBonus',
          'landmarkFood', 'landmarkShields', 'landmarkCommerce', 'landmarkFoodBonus', 'landmarkShieldsBonus', 'landmarkCommerceBonus',
        ]),
        eras: compactRecords(eras, ['name', 'civilopediaEntry']),
        rule: compactRecords([ruleRecord], ['maxCity1Size', 'maxCity2Size', 'borderFactor']),
        players: (players || []).map((player) => ({
          index: Number(player.playerID),
          name: `Player ${Number(player.playerID)}`,
          civ: Number(player.raceID),
          initialEra: Number(detailsByPlayer.get(Number(player.playerID))?.era) || 0,
          customCivData: 0,
          color: getPlayerColorSlot(player, races[Number(player.raceID)], colorSlotsByPlayer),
        })),
      },
    };
  }

  const playerById = new Map(players.map((player) => [Number(player.playerID), player]));
  const humanDetails = detailsByPlayer.get(human.playerID) || {};
  humanDetails.buffer = inflated.buffer;
  const c3xSegmentInfo = getC3XModSaveSegment(inflated.buffer);
  const scoreTail = parseScoreTail(inflated.buffer, report, players);
  const known = parseKnownTiles(inflated.buffer, report, perspectiveMask);
  const useKnownPerspectiveCounts = Number(human.playerID) === Number(humanPlayer.playerID);
  const territoryTiles = parseTerritoryTiles(inflated.buffer, report);
  const ownedLandByPlayer = new Map();
  for (const tile of territoryTiles) {
    const owner = Number(tile && tile.owner);
    if (owner < 0) continue;
    ownedLandByPlayer.set(owner, (ownedLandByPlayer.get(owner) || 0) + 1);
  }
  const populationByPlayer = new Map();
  for (const city of report.cities.records || []) {
    const owner = Number(city.owner);
    populationByPlayer.set(owner, (populationByPlayer.get(owner) || 0) + (Number(city.population) || 0));
  }

  const contactByPlayer = readLeadVectorInt32(inflated.buffer, human, 3732, 32);
  const visible = active
    .map((player) => {
      const details = detailsByPlayer.get(player.playerID) || {};
      const score = scoreTail.get(player.playerID) || {};
      const race = races[player.raceID] || {};
      const colorSlot = getPlayerColorSlot(player, race, colorSlotsByPlayer);
      return {
        playerID: player.playerID,
        raceID: player.raceID,
        nation: recordName(races, player.raceID, 'RACE', `Player ${player.playerID}`),
        leader: race.name || '',
        traits: traitsForRace(race),
        colorSlot: Number.isFinite(colorSlot) ? colorSlot : null,
        color: getPlayerColorCss(colorSlot),
        government: recordName(governments, details.government, 'GOVT', ''),
        governmentIndex: Number(details.government),
        era: recordName(eras, details.era, 'ERAS', ''),
        eraIndex: Number(details.era),
        gold: displayGold(details.gold),
        cities: Number(details.cities) || 0,
        units: Number(details.units) || 0,
        land: useKnownPerspectiveCounts
          ? (known.knownLandByPlayer.get(player.playerID) || 0)
          : (ownedLandByPlayer.get(player.playerID) || known.knownLandByPlayer.get(player.playerID) || 0),
        population: useKnownPerspectiveCounts
          ? ((() => {
            let total = 0;
            for (const city of report.cities.records || []) {
              if (Number(city.owner) !== Number(player.playerID)) continue;
              const explored = (known.cityExploredMaskById.get(Number(city.id)) || 0) >>> 0;
              if ((explored & perspectiveMask) !== 0) total += Number(city.population) || 0;
            }
            return total;
          })())
          : (populationByPlayer.get(player.playerID) || 0),
        score: Number(score.score) || 0,
        culture: Number(details.cultureTotal) || Number(score.culture) || 0,
        culturePerTurn: Number(details.culturePerTurn) || 0,
        capital: details.capitalName || '',
      };
    })
    .filter((player) => player.land > 0 || Number(player.playerID) === Number(human.playerID) || (Number(contactByPlayer[Number(player.playerID)]) || 0) !== 0);

  const humanRace = races[human.raceID] || {};
  const humanScore = scoreTail.get(human.playerID) || {};
  const humanColorSlot = getPlayerColorSlot(human, humanRace, colorSlotsByPlayer);
  const humanVisible = visible.find((player) => player.playerID === human.playerID) || {
    playerID: human.playerID,
    raceID: human.raceID,
    nation: recordName(races, human.raceID, 'RACE', `Player ${human.playerID}`),
    leader: humanRace.name || '',
    traits: traitsForRace(humanRace),
    colorSlot: Number.isFinite(humanColorSlot) ? humanColorSlot : null,
    color: getPlayerColorCss(humanColorSlot),
    government: recordName(governments, humanDetails.government, 'GOVT', ''),
    governmentIndex: Number(humanDetails.government),
    era: recordName(eras, humanDetails.era, 'ERAS', ''),
    eraIndex: Number(humanDetails.era),
    gold: displayGold(humanDetails.gold),
    cities: Number(humanDetails.cities) || 0,
    units: Number(humanDetails.units) || 0,
    land: 0,
    population: 0,
    score: Number(humanScore.score) || 0,
    culture: Number(humanDetails.cultureTotal) || Number(humanScore.culture) || 0,
    culturePerTurn: Number(humanDetails.culturePerTurn) || 0,
    capital: humanDetails.capitalName || '',
  };
  const viewingOptions = active.map((player) => {
    const details = detailsByPlayer.get(player.playerID) || {};
    const race = races[player.raceID] || {};
    const colorSlot = getPlayerColorSlot(player, race, colorSlotsByPlayer);
    const nation = recordName(races, player.raceID, 'RACE', `Player ${player.playerID}`);
    const cityCount = (report.cities && report.cities.records || [])
      .filter((city) => Number(city.owner) === Number(player.playerID)).length;
    return {
      playerID: Number(player.playerID),
      raceID: Number(player.raceID),
      nation,
      leader: race.name || '',
      label: nation,
      cityCount,
      isHuman: Number(player.playerID) === Number(humanPlayer.playerID),
      colorSlot: Number.isFinite(colorSlot) ? colorSlot : null,
      color: getPlayerColorCss(colorSlot),
      government: recordName(governments, details.government, 'GOVT', ''),
      currentEra: recordName(eras, details.era, 'ERAS', ''),
      ref: makeRef('civilizations', 'RACE', player.raceID, nation, ruleSignatures),
    };
  });
  const rivalRows = visible
    .filter((player) => player.playerID !== human.playerID)
    .map((player) => {
      const relation = relationFor(humanDetails, player.playerID);
      return {
        playerID: player.playerID,
        raceID: player.raceID,
        nation: player.nation,
        nationRef: makeRef('civilizations', 'RACE', player.raceID, player.nation, ruleSignatures),
        color: player.color,
        colorSlot: player.colorSlot,
        traits: player.traits.join(', '),
        relation: relation.label,
        atWar: relation.atWar,
        government: player.government,
        governmentRef: makeRef('governments', 'GOVT', player.governmentIndex, player.government, ruleSignatures),
        currentEra: player.era,
        currentEraRef: makeRef('world', 'ERAS', player.eraIndex, player.era, ruleSignatures),
        gold: player.gold,
        cities: player.cities,
        land: player.land,
        population: player.population,
        score: player.score,
      };
    });

  const techMasks = parseTechCivMasks(inflated.buffer, report.game, techs.length);
  const tailCounts = getDynamicTailCounts(report, {
    improvements: section(parsed, 'BLDG').records.length,
    units: section(parsed, 'PRTO').records.length,
    resources: resources.length,
  }, section(parsed, 'RULE').records[0] || {});
  const tradeTailByPlayer = new Map(players.map((player) => [
    Number(player.playerID),
    parseLeaderTradeTail(inflated.buffer, player, tailCounts),
  ]));
  const humanTradeTail = tradeTailByPlayer.get(Number(human.playerID)) || { lists: new Map(), resourceStates: [], resourceCounts: [] };
  const tradeOfferContext = { resources, techs, ruleSignatures };
  const tradeRows = rivalRows.map((row) => {
    const player = playerById.get(Number(row.playerID));
    const playerDetails = detailsByPlayer.get(Number(row.playerID)) || {};
    const rivalTradeTail = tradeTailByPlayer.get(Number(row.playerID)) || { lists: new Map(), resourceStates: [], resourceCounts: [] };
    const contact = contactByPlayer[Number(row.playerID)] || 0;
    const willTalk = readLeadVectorInt32(inflated.buffer, human, 2964, 32)[Number(row.playerID)] || 0;
    const sellTechs = [];
    const buyTechs = [];
    for (let i = 0; i < techs.length; i += 1) {
      const techName = recordName(techs, i, 'TECH', '');
      const techEra = Number(techs[i] && techs[i].era);
      if (!techName || (Number.isFinite(techEra) && techEra < 0)) continue;
      const humanHas = playerHasTech(techMasks, i, human.playerID);
      const rivalHas = playerHasTech(techMasks, i, row.playerID);
      const item = { name: techName, ref: makeRef('technologies', 'TECH', i, techName, ruleSignatures) };
      if (humanHas && !rivalHas && canTradeTechToPlayer(techs, techMasks, row.playerID, i)) sellTechs.push(item);
      if (rivalHas && !humanHas && canTradeTechToPlayer(techs, techMasks, human.playerID, i)) buyTechs.push(item);
    }
    const rivalExportPlayer = {
      playerID: Number(row.playerID),
    };
    const humanExportPlayer = {
      playerID: Number(human.playerID),
    };
    const sellResources = resourceTradeItemsForExport(
      resources,
      techMasks,
      humanExportPlayer,
      humanTradeTail,
      rivalExportPlayer,
      rivalTradeTail,
      false,
      ruleSignatures
    );
    const buyResources = resourceTradeItemsForExport(
      resources,
      techMasks,
      rivalExportPlayer,
      rivalTradeTail,
      humanExportPlayer,
      humanTradeTail,
      true,
      ruleSignatures
    );
    const sellTechRefs = sliceTradeRefs(sellTechs);
    const buyTechRefs = sliceTradeRefs(buyTechs);
    const sellResourceRefs = sliceTradeRefs(sellResources);
    const buyResourceRefs = sliceTradeRefs(buyResources);
    return {
      ...row,
      hasContact: contact !== 0,
      willTalk: willTalk === 0,
      tradeTail: rivalTradeTail,
      sell: {
        gold: row.gold,
        workers: 0,
        technologies: formatTradeItems(sellTechs),
        technologyRefs: sellTechRefs.refs,
        technologyTotal: sellTechRefs.total,
        technologyTruncated: sellTechRefs.truncated,
        resources: formatTradeItems(sellResources, sellResources.length || 3),
        resourceRefs: sellResourceRefs.refs,
        resourceTotal: sellResourceRefs.total,
        resourceTruncated: sellResourceRefs.truncated,
        contacts: '',
        maps: '',
      },
      buy: {
        gold: row.gold,
        workers: row.atWar ? '--' : 0,
        technologies: formatTradeItems(buyTechs),
        technologyRefs: buyTechRefs.refs,
        technologyTotal: buyTechRefs.total,
        technologyTruncated: buyTechRefs.truncated,
        resources: formatTradeItems(buyResources, buyResources.length || 3),
        resourceRefs: buyResourceRefs.refs,
        resourceTotal: buyResourceRefs.total,
        resourceTruncated: buyResourceRefs.truncated,
        contacts: '',
        maps: '',
      },
    };
  });
  const currentTradeRows = [];
  for (const row of tradeRows.filter((item) => !item.atWar)) {
    currentTradeRows.push({
      nation: row.nation,
      nationRef: row.nationRef,
      color: row.color,
      colorSlot: row.colorSlot,
      turnsLeft: '--',
      weGive: 'Peace Treaty',
      weReceive: 'Peace Treaty',
    });
    const humanGroups = (humanTradeTail.lists.get(Number(row.playerID)) || []).filter((group) => Number(group.endTurn) > Number(report.game.turnNumber));
    const rivalGroups = (row.tradeTail.lists.get(Number(human.playerID)) || []).filter((group) => Number(group.endTurn) > Number(report.game.turnNumber));
    for (const group of humanGroups) {
      const reciprocal = rivalGroups.find((item) => Number(item.endTurn) === Number(group.endTurn));
      const giveItems = tradeOfferItems(group.offers, tradeOfferContext);
      const receiveItems = reciprocal ? tradeOfferItems(reciprocal.offers, tradeOfferContext) : [];
      if (giveItems.length === 0 && receiveItems.length === 0) continue;
      const giveRefs = sliceTradeRefs(giveItems);
      const receiveRefs = sliceTradeRefs(receiveItems);
      currentTradeRows.push({
        nation: '',
        nationRef: null,
        color: null,
        colorSlot: null,
        turnsLeft: String(Math.max(0, Number(group.endTurn) - Number(report.game.turnNumber || 0))),
        weGive: formatTradeItems(giveItems, giveItems.length || 3),
        weGiveRefs: giveRefs.refs,
        weGiveTotal: giveRefs.total,
        weGiveTruncated: giveRefs.truncated,
        weReceive: formatTradeItems(receiveItems, receiveItems.length || 3),
        weReceiveRefs: receiveRefs.refs,
        weReceiveTotal: receiveRefs.total,
        weReceiveTruncated: receiveRefs.truncated,
      });
    }
  }
  const diplomacy = makeDiplomacyReport({
    tradeRows,
    humanVisible,
    humanTradeTail,
    currentTurn: report.game && report.game.turnNumber,
    cultureRecords,
    ruleSignatures,
  });

  const victoryTypes = VICTORY_BITS
    .filter(([bit]) => bitSet(report.game.rules, bit))
    .map(([, label]) => label);
  const gameDate = formatGameDate(report.game.turnNumber, gameRules);
  const timePlayed = formatElapsed(report.game.timePlayedMs);
  const winner = Number(report.game.winner) >= 0 ? visible.find((player) => player.playerID === Number(report.game.winner)) : null;
  const playerRows = visible;
  const title = path.basename(filePath, path.extname(filePath));
  const technology = makeTechnologyReport({
    buf: inflated.buffer,
    report,
    human,
    humanDetails,
    humanEra: Number(humanDetails.era),
    techs,
    eras,
    races,
    rivalRows,
    techMasks,
    ruleSignatures,
    worldSizes,
    difficulties,
  });
  const culture = makeCultureReport({
    report,
    human,
    humanVisible,
    humanDetails,
    races,
    players,
    detailsByPlayer,
    techs,
    techMasks,
    buildings,
    gameRules,
    ruleRecord,
    ruleSignatures,
    allPlayersMode,
    colorSlotsByPlayer,
  });
  const cities = makeCitiesReport({
    report,
    human,
    humanDetails,
    races,
    ruleRecord,
    players,
    detailsByPlayer,
    ruleSignatures,
    allPlayersMode,
    colorSlotsByPlayer,
    c3xSegmentInfo,
  });
  const economy = makeEconomyReport({
    buf: inflated.buffer,
    report,
    human,
    humanDetails,
    humanVisible,
    governments,
    buildings,
    unitTypes,
    ruleRecord,
    techs,
    techMasks,
    players,
    detailsByPlayer,
    races,
    humanTradeTail,
    tradeRows,
    ruleSignatures,
    allPlayersMode,
    colorSlotsByPlayer,
  });
  const production = makeProductionReport({
    report,
    human,
    humanDetails,
    races,
    ruleRecord,
    buildings,
    unitTypes,
    players,
    detailsByPlayer,
    ruleSignatures,
    allPlayersMode,
    colorSlotsByPlayer,
  });
  const territory = makeTerritoryReport({
    buf: inflated.buffer,
    report,
    human,
    humanDetails,
    humanVisible,
    perspectiveMask,
    playerRows,
    terrainRecords,
    unitTypes,
    races,
    ruleRecord,
    gameRules,
    players,
    detailsByPlayer,
    ruleSignatures,
    allPlayersMode,
    colorSlotsByPlayer,
  });
  const military = makeMilitaryReport({
    report,
    human,
    unitTypes,
    experienceLevels,
    races,
    gameRules: ruleRecord,
    ruleSignatures,
    economy,
    players,
    allPlayersMode,
    colorSlotsByPlayer,
  });
  const districtRows = parseC3XDistrictTileMap(inflated.buffer, c3xSegmentInfo);
  const atWarPlayerIDs = new Set(active
    .filter((player) => Number(player.playerID) !== Number(human.playerID) && relationFor(humanDetails, player.playerID).atWar)
    .map((player) => Number(player.playerID)));
  const foreignUnitWarnings = allPlayersMode ? [] : collectForeignUnitWarnings({
    territoryTiles,
    units: report.units && report.units.records,
    players,
    unitTypes,
    races,
    playerID: human.playerID,
    perspectiveMask,
    atWarPlayerIDs,
    ruleSignatures,
  });
  const unconnectedResources = allPlayersMode ? [] : collectUnconnectedResourceWarnings({
    territoryTiles,
    resources,
    humanTradeTail,
    techMasks,
    playerID: human.playerID,
    ruleSignatures,
  });
  const pollutedTiles = allPlayersMode ? [] : territoryTiles
    .filter((tile) => Number(tile.owner) === Number(human.playerID) && (((Number(tile.c3cOverlays) || 0) >>> 0) & 0x40) !== 0)
    .map((tile) => ({ x: tile.x, y: tile.y }));
  const freshWaterCityIDs = new Set(territoryTiles
    .filter((tile) => Number(tile.cityID) >= 0 && tile.river)
    .map((tile) => Number(tile.cityID)));
  const districtOpportunities = collectDistrictOpportunityWarnings({
    districtAlertContext: options && options.districtAlertContext,
    report,
    culture,
    buildings,
    terrainRecords,
    territoryTiles,
    districtRows,
    allPlayersMode,
  });
  const alerts = makeAlertsReport({
    report,
    gameDate,
    timePlayed,
    economy,
    production,
    military,
    technology,
    territory,
    cities,
    tradeRows,
    currentTradeRows,
    unconnectedResources,
    districtOpportunities,
    foreignUnitWarnings,
    pollutedTiles,
    buildings,
    freshWaterCityIDs,
  });

  return {
    ok: true,
    sourcePath: filePath,
    title,
    ruleSignatures,
    saveArtContext,
    saveMetadata: {
      embeddedSearchPath: report.metadata && report.metadata.searchPath || '',
      embeddedSaveFileName: report.metadata && report.metadata.saveFileName || '',
      hasC3XSegment: !!c3xSegmentInfo.hasC3XSegment,
      c3xSegmentSize: Number(c3xSegmentInfo.segmentSize) || 0,
      c3xChunks: c3xSegmentInfo.chunks || [],
      c3xDistrictInstanceCount: districtRows.length,
    },
    humanPlayerID: Number(humanPlayer.playerID),
    selectedPlayerID: allPlayersMode ? -1 : Number(human.playerID),
    viewingCiv: {
      playerID: allPlayersMode ? -1 : Number(human.playerID),
      raceID: allPlayersMode ? -1 : Number(human.raceID),
      nation: allPlayersMode ? 'All Civs' : (humanVisible ? humanVisible.nation : recordName(races, human.raceID, 'RACE', '')),
      leader: allPlayersMode ? '' : (humanVisible ? humanVisible.leader : humanRace.name || ''),
      color: humanVisible ? humanVisible.color : null,
      colorSlot: humanVisible ? humanVisible.colorSlot : null,
      isHuman: !allPlayersMode && Number(human.playerID) === Number(humanPlayer.playerID),
      ref: allPlayersMode ? null : makeRef('civilizations', 'RACE', human.raceID, humanVisible ? humanVisible.nation : recordName(races, human.raceID, 'RACE', ''), ruleSignatures),
    },
    viewingOptions,
    general: {
      gameInfo: [
        { label: 'Game Version', value: report.metadata.savMajorVersion === 24 && report.metadata.savMinorVersion === 10 ? 'C3C122' : `${report.metadata.savMajorVersion}.${report.metadata.savMinorVersion}` },
        { label: 'Embedded Scenario', value: report.metadata && report.metadata.searchPath ? report.metadata.searchPath : 'Standard rules' },
        {
          label: 'C3X Save Data',
          value: c3xSegmentInfo.hasC3XSegment
            ? `Present${districtRows.length > 0 ? ` (${districtRows.length} district instance${districtRows.length === 1 ? '' : 's'})` : ''}`
            : 'Not present',
        },
        { label: 'Game Type', value: countBits32(report.game.humanPlayersMask) === 1 ? 'Single Player' : 'Multiplayer' },
        { label: 'Difficulty', value: recordName(difficulties, report.game.difficulty, 'DIFF', '') },
        { label: 'Victory Types', value: victoryTypes.join(', ') },
        { label: 'Preserve Seed', value: formatYesNo(bitSet(report.game.rules, 8)) },
        { label: 'Respawn AI', value: formatYesNo(Number(gameRules.respawnFlagUnits) === 0) },
        { label: 'Culture Flip', value: formatYesNo(bitSet(report.game.rules, 15)) },
        { label: 'Scientific Leaders', value: formatYesNo(bitSet(report.game.rules, 18)) },
        { label: 'Turn Number', value: String(report.game.turnNumber) },
        { label: 'Game Date', value: gameDate },
        { label: 'Time Played', value: timePlayed },
        { label: 'Game Status', value: Number(report.game.victoryType) < 0 ? 'Incomplete' : 'Complete' },
        { label: 'Winning Player', value: winner ? winner.nation : '', muted: !winner },
      ],
      playerInfo: [
        { label: 'Civilization', value: humanVisible ? humanVisible.nation : recordName(races, human.raceID, 'RACE', ''), ref: makeRef('civilizations', 'RACE', human.raceID, humanVisible ? humanVisible.nation : recordName(races, human.raceID, 'RACE', ''), ruleSignatures), color: humanVisible ? humanVisible.color : null, colorSlot: humanVisible ? humanVisible.colorSlot : null },
        { label: 'Traits', value: humanVisible ? humanVisible.traits.join(', ') : traitsForRace(races[human.raceID]).join(', ') },
        { label: 'Score', value: String(humanVisible ? humanVisible.score : 0), rank: competitionRank(playerRows, 'score', human.playerID) },
        { label: 'Culture', value: String(humanVisible ? humanVisible.culture : 0) },
        { label: 'Culture Per Turn', value: String(humanVisible ? humanVisible.culturePerTurn : 0) },
        { label: 'Government', value: humanVisible ? humanVisible.government : '', ref: makeRef('governments', 'GOVT', humanVisible ? humanVisible.governmentIndex : -1, humanVisible ? humanVisible.government : '', ruleSignatures) },
        { label: 'Capital', value: humanVisible ? humanVisible.capital : '' },
        { label: 'Gold', value: String(humanVisible ? humanVisible.gold : 0), rank: competitionRank(playerRows, 'gold', human.playerID) },
        { label: 'Cities', value: String(humanVisible ? humanVisible.cities : 0), rank: competitionRank(playerRows, 'cities', human.playerID) },
        { label: 'Land', value: String(humanVisible ? humanVisible.land : 0), rank: competitionRank(playerRows, 'land', human.playerID) },
        { label: 'Population', value: String(humanVisible ? humanVisible.population : 0), rank: competitionRank(playerRows, 'population', human.playerID) },
        { label: 'Units', value: String(humanVisible ? humanVisible.units : 0) },
      ],
      rivals: rivalRows,
    },
    trade: {
      treasury: [
        { label: 'Gold', value: String(humanVisible ? humanVisible.gold : 0) },
        { label: 'Gold per Turn', value: String(economy.netGain) },
      ],
      currentTrades: currentTradeRows,
      sellOptions: tradeRows.filter((row) => row.hasContact).map((row) => ({
        nation: row.nation,
        nationRef: row.nationRef,
        color: row.color,
        colorSlot: row.colorSlot,
        ...row.sell,
      })),
      buyOptions: tradeRows.filter((row) => row.hasContact).map((row) => ({
        nation: row.nation,
        nationRef: row.nationRef,
        color: row.color,
        colorSlot: row.colorSlot,
        ...row.buy,
      })),
    },
    diplomacy,
    technology,
    territory,
    culture,
    cities,
    economy,
    production,
    military,
    alerts,
    map,
    debug: {
      humanPlayerID: humanPlayer.playerID,
      selectedPlayerID: allPlayersMode ? -1 : human.playerID,
      visiblePlayerIDs: visible.map((player) => player.playerID),
    },
  };
}

module.exports = {
  inspectCivAdvisorSaveFile,
  makeRuleSectionSignature,
  _test: {
    canTradeTechToPlayer,
    collectDistrictOpportunityWarnings,
    collectForeignUnitWarnings,
    collectUnconnectedResourceWarnings,
    makeAlertsReport,
    normalizeDistrictAlertContext,
    tileMatchesDistrictBuildability,
  },
};
