'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inflateSavIfNeeded, extractEmbeddedBiqFromSavFile } = require('./savExtract');
const { parseAllSections, sectionRecordName } = require('./biqSections');
const { inspectSavFile } = require('./savInspect');

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

const RULE_SIGNATURE_FIELDS = Object.freeze({
  RACE: ['civilizationName', 'civilopediaEntry'],
  TECH: ['name', 'civilopediaEntry', 'era'],
  GOOD: ['name', 'civilopediaEntry'],
  BLDG: ['name', 'civilopediaEntry'],
  PRTO: ['name', 'civilopediaEntry'],
  GOVT: ['name', 'civilopediaEntry'],
  ERAS: ['name', 'civilopediaEntry'],
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

function activePlayers(players) {
  return players
    .filter((player) => Number(player && player.playerID) > 0 && Number(player.raceID) >= 0 && Number(player.capitalCity) >= 0)
    .sort((a, b) => Number(a.playerID) - Number(b.playerID));
}

function findHumanPlayer(players, humanPlayersMask) {
  const mask = (Number(humanPlayersMask) || 0) >>> 0;
  return activePlayers(players).find((player) => ((mask & (1 << Number(player.playerID))) !== 0)) || activePlayers(players)[0] || null;
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

function parseScoreTail(buf, report, players) {
  const active = activePlayers(players);
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
    const owner = body1 + 2 <= buf.length ? buf.readInt8(body1 + 1) : -1;
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
    const owner = body1 + 2 <= buf.length ? buf.readInt8(body1 + 1) : -1;
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
    const cityWithWorkers = body4 + 22 <= buf.length ? buf.readInt16LE(body4 + 20) : -1;
    const coords = tileCoordsByIndex(width, index);
    tiles.push({
      index,
      x: coords.x,
      y: coords.y,
      owner,
      cityID,
      terrainID,
      c3cOverlays,
      exploredBy,
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

function parseC3XDistrictTileMap(buf) {
  const bookend = Buffer.from([0x22, 0x43, 0x33, 0x58]);
  if (!Buffer.isBuffer(buf) || buf.length < 12) return [];
  if (!buf.subarray(buf.length - 4).equals(bookend)) return [];
  const segmentSize = buf.readInt32LE(buf.length - 8);
  const segmentStart = buf.length - segmentSize - 8;
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

function hasTechPrereqs(techs, techMasks, playerID, techIndex, eraIndex) {
  const tech = techs[techIndex] || {};
  const techEra = Number(tech.era);
  if (Number.isFinite(techEra) && techEra >= 0 && Number.isFinite(Number(eraIndex)) && techEra > Number(eraIndex)) return false;
  const prereqKeys = ['prerequisite1', 'prerequisite2', 'prerequisite3', 'prerequisite4'];
  for (const key of prereqKeys) {
    const prereq = Number(tech[key]);
    if (Number.isFinite(prereq) && prereq >= 0 && !playerHasTech(techMasks, prereq, playerID)) return false;
  }
  return true;
}

function hasResearchPrereqs(techs, techMasks, playerID, techIndex, eraIndex) {
  const tech = techs[techIndex] || {};
  const techEra = Number(tech.era);
  if (Number.isFinite(techEra) && techEra >= 0 && Number.isFinite(Number(eraIndex)) && techEra > Number(eraIndex)) return false;
  const prerequisites = Array.isArray(tech.prerequisites) ? tech.prerequisites : [];
  return prerequisites.every((value) => {
    const prereq = Number(value);
    return !Number.isFinite(prereq) || prereq < 0 || playerHasTech(techMasks, prereq, playerID);
  });
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
    report, human, humanVisible, humanDetails, races, players, techs, techMasks, buildings,
    gameRules, ruleRecord, ruleSignatures,
  } = context;
  const playerById = new Map((players || []).map((player) => [Number(player.playerID), player]));
  const humanCities = (report.cities && report.cities.records || [])
    .filter((city) => Number(city.owner) === Number(human.playerID))
    .map((city) => ({
      id: Number(city.id),
      name: city.name || `City ${city.id}`,
      culture: Number(city.culture) || 0,
      culturePerTurn: Number(city.culturePerTurn) || 0,
      shieldsPerTurn: Number(city.shieldsPerTurn) || 0,
      shieldsCollected: Number(city.shieldsCollected) || 0,
      buildingRecords: Array.isArray(city.buildingRecords) ? city.buildingRecords : [],
      cityArt: makeCityArtMetadata(city, {
        player: human,
        playerDetails: humanDetails,
        races,
        ruleRecord,
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
      if (Number.isFinite(reqAdvance) && reqAdvance >= 0 && !playerHasTech(techMasks, reqAdvance, human.playerID)) {
        missing.push(recordName(techs, reqAdvance, 'TECH', `Technology ${reqAdvance}`));
      }
      const reqImprovement = Number(building && building.reqImprovement);
      const requiredCount = Math.max(0, Number(building && building.numReqBuildings) || 0);
      if (Number.isFinite(reqImprovement) && reqImprovement >= 0) {
        const requirementName = recordName(buildings, reqImprovement, 'BLDG', `Improvement ${reqImprovement}`);
        if (requiredCount > 1) {
          const ownedCount = humanCities.filter((item) => cityHasBuilding(item, reqImprovement)).length;
          if (ownedCount < requiredCount) missing.push(`${requiredCount - ownedCount} more ${requirementName}${requiredCount - ownedCount === 1 ? '' : 's'}`);
        } else if (!cityHasBuilding(city, reqImprovement)) {
          missing.push(requirementName);
        }
      }
      if ((((Number(building && building.smallWonderCharacteristics) || 0) >>> 0) & 0x400) !== 0) missing.push('victorious Army');
      if (Number(building && building.armiesRequired) > 0) missing.push(`${Number(building.armiesRequired)} Armies`);
      const obsoleteBy = Number(building && building.obsoleteBy);
      const obsolete = Number.isFinite(obsoleteBy) && obsoleteBy >= 0 && playerHasTech(techMasks, obsoleteBy, human.playerID);
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
        const owner = builtElsewhere.civilization && Number(report.cities.records.find((item) => Number(item.id) === builtElsewhere.cityID)?.owner) !== Number(human.playerID)
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
  const civilizationCulture = Number(humanVisible && humanVisible.culture) || Number(humanDetails && humanDetails.cultureTotal) || 0;
  const civilizationCulturePerTurn = Number(humanVisible && humanVisible.culturePerTurn) || Number(humanDetails && humanDetails.culturePerTurn) || 0;
  return {
    defaultCityID,
    cities: humanCities.map((city) => ({
      id: city.id,
      name: city.name,
      culture: city.culture,
      culturePerTurn: city.culturePerTurn,
      cityArt: city.cityArt,
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
    report, human, humanDetails, races, ruleRecord,
  } = context;
  const allCities = report.cities && report.cities.records || [];
  const humanCities = allCities.filter((city) => Number(city.owner) === Number(human.playerID));
  const capital = humanCities.find((city) => Number(city.id) === Number(human.capitalCity)) || humanCities[0] || null;
  const units = report.units && report.units.records || [];
  return {
    rows: humanCities.map((city) => {
      const population = Math.max(0, Number(city.population) || 0);
      const happy = Math.max(0, Number(city.happyCitizens) || 0);
      const unhappy = Math.max(0, Number(city.unhappyCitizens) || 0);
      const corruption = Math.max(0, Number(city.corruption) || 0);
      const waste = Math.max(0, Number(city.productionLoss) || 0);
      const garrison = units.filter((unit) => Number(unit.owner) === Number(human.playerID)
        && Number(unit.x) === Number(city.x)
        && Number(unit.y) === Number(city.y)).length;
      return {
        id: Number(city.id),
        city: city.name || '',
        cityArt: makeCityArtMetadata(city, {
          player: human,
          playerDetails: humanDetails,
          races,
          ruleRecord,
        }),
        size: `${Number(city.id) === Number(human.capitalCity) ? '*' : ''}${population}`,
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
        resistors: '',
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
    buf, report, human, humanDetails, humanVisible, playerRows, terrainRecords, unitTypes, races, ruleRecord,
    perspectiveMask,
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
  const ownedTiles = tiles.filter((tile) => Number(tile.owner) === Number(human.playerID));
  const ownedLand = ownedTiles.filter(isLand);
  const ownedDominationTiles = ownedTiles.filter(isDominationTile);
  const districtTiles = parseC3XDistrictTileMap(buf);
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
    .filter((city) => Number(city.owner) === Number(human.playerID));
  const units = report.units && report.units.records || [];
  const humanUnits = units.filter((unit) => Number(unit.owner) === Number(human.playerID));
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
  const cityRows = humanCities.map((city) => {
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
      city: city.name || '',
      cityArt: makeCityArtMetadata(city, {
        player: human,
        playerDetails: humanDetails,
        races,
        ruleRecord,
      }),
      size: `${Number(city.id) === Number(human.capitalCity) ? '*' : ''}${Number(city.population) || 0}`,
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
      dominationLimit: '?',
      tilesOwned: Number(humanVisible && humanVisible.land) || ownedTiles.length,
      dominationTiles: ownedDominationTiles.length,
      tilesToLimit: '?',
      unclaimedTiles: '?',
      citizensLimit: citizens,
      citizensLimitPercent: territoryRatio(citizens, totalKnownPopulation),
      districtInstances: districtTiles.length,
      ownedLandDistricts: ownedLandDistricts.length,
    },
    statistics: {
      cities: humanCities.length,
      citizens,
      specialists,
      tilesPerCity: humanCities.length > 0 ? (Number(humanVisible && humanVisible.land) / humanCities.length).toFixed(1) : '',
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

function makeEconomyReport(context) {
  const {
    buf, report, human, humanDetails, humanVisible, governments, buildings, unitTypes,
    ruleRecord, techs, techMasks, players, races, humanTradeTail, tradeRows, ruleSignatures,
  } = context;
  const governmentIndex = Number(humanDetails && humanDetails.government);
  const government = governments[governmentIndex] || {};
  const humanCities = (report.cities && report.cities.records || []).filter((city) => Number(city.owner) === Number(human.playerID));
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
  const cityRows = humanCities.map((city) => {
    const productionLoss = Math.max(0, Number(city.productionLoss) || 0);
    const corruption = Math.max(0, Number(city.corruption) || 0);
    const production = Math.max(0, Number(city.productionIncome) || 0);
    const cashIncome = Math.max(0, Number(city.cashIncome) || 0);
    const taxes = Math.max(0, Number(city.taxIncome) || 0);
    const maintenance = Math.max(0, Number(city.maintenanceGPT) || 0);
    const buildingStatuses = buildingOptions.map((option) => makeCityBuildingStatus({
      city,
      building: buildings[Number(option.buildingIndex)],
      buildingIndex: Number(option.buildingIndex),
      buildings,
      humanCities,
      builtLocations,
      report,
      human,
      techs,
      techMasks,
      ruleSignatures,
    }));
    return {
      id: Number(city.id),
      name: city.name || '',
      cityArt: makeCityArtMetadata(city, {
        player: human,
        playerDetails: humanDetails,
        races,
        ruleRecord,
      }),
      size: Math.max(0, Number(city.population) || 0),
      production,
      waste: productionLoss,
      wastePercent: percentage(productionLoss, production + productionLoss),
      science: Math.max(0, Number(city.scienceIncome) || 0),
      luxury: Math.max(0, Number(city.luxuryIncome) || 0),
      taxes,
      corruption,
      corruptionPercent: percentage(corruption, cashIncome + corruption),
      maintenance,
      netGold: taxes - maintenance,
      buildingStatuses,
    };
  });

  const maxTownSize = Math.max(0, Number(ruleRecord && ruleRecord.maxCity1Size) || 6);
  const maxCitySize = Math.max(maxTownSize, Number(ruleRecord && ruleRecord.maxCity2Size) || 12);
  let freeUnits = Number(government.freeUnits) || 0;
  const maintenanceFreeUnits = (report.units && report.units.records || []).filter((unit) => {
    if (Number(unit.owner) !== Number(human.playerID)) return false;
    const unitType = unitTypes[Number(unit.unitType)] || {};
    const isKing = (((Number(unitType.unitAbilities) || 0) >>> 0) & (1 << 29)) !== 0;
    return Number(unit.nationality) !== Number(human.raceID) || isKing;
  }).length;
  const paidUnits = (report.units && report.units.records || []).filter((unit) => {
    if (Number(unit.owner) !== Number(human.playerID)) return false;
    const unitType = unitTypes[Number(unit.unitType)] || {};
    const isKing = (((Number(unitType.unitAbilities) || 0) >>> 0) & (1 << 29)) !== 0;
    return Number(unit.nationality) === Number(human.raceID) && !isKing;
  }).length;
  if (freeUnits < 0) freeUnits = paidUnits;
  else {
    for (const city of humanCities) {
      const population = Math.max(0, Number(city.population) || 0);
      freeUnits += population > maxCitySize
        ? Math.max(0, Number(government.perMetropolis) || 0)
        : population > maxTownSize
          ? Math.max(0, Number(government.perCity) || 0)
          : Math.max(0, Number(government.perTown) || 0);
    }
  }
  const supportedUnits = Math.max(0, paidUnits - freeUnits);
  const costPerUnit = Math.max(0, Number(government.costPerUnit) || 0);
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
  const fromCities = cityRows.reduce((sum, row) => sum + row.taxes + row.science + row.luxury + row.corruption, 0);
  const fromTaxmen = humanCities.reduce((sum, city) => sum + Math.max(0, Number(city.specialistTaxIncome) || 0), 0);
  const science = cityRows.reduce((sum, row) => sum + row.science, 0);
  const entertainment = cityRows.reduce((sum, row) => sum + row.luxury, 0);
  const corruption = cityRows.reduce((sum, row) => sum + row.corruption, 0);
  const maintenance = cityRows.reduce((sum, row) => sum + row.maintenance, 0);
  const income = fromCities + fromTaxmen + incomingGpt + interest;
  const expenses = science + entertainment + corruption + maintenance + unitCosts + outgoingGpt;
  const netGain = income - expenses;
  const scienceRate = Math.max(0, readLeadInt32(buf, human, 396, 0)) * 10;
  const luxuryRate = Math.max(0, readLeadInt32(buf, human, 392, 0)) * 10;
  const goldenAgeEnd = readLeadInt32(buf, human, 32, -1);
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
    defaultBuildingIndex,
    buildingOptions,
    cityRows,
  };
}

function makeProductionReport(context) {
  const {
    report, human, humanDetails, races, ruleRecord, buildings, unitTypes, ruleSignatures,
  } = context;
  const productionFactor = bitSet(report.game && report.game.rules, 5) ? 5 : 10;
  const rows = (report.cities && report.cities.records || [])
    .filter((city) => Number(city.owner) === Number(human.playerID))
    .map((city) => {
      const orderType = Number(city.constructingType);
      const orderIndex = Number(city.constructingIndex);
      const records = orderType === 1 ? buildings : orderType === 2 ? unitTypes : [];
      const sectionCode = orderType === 1 ? 'BLDG' : orderType === 2 ? 'PRTO' : '';
      const tabKey = orderType === 1 ? 'improvements' : orderType === 2 ? 'units' : '';
      const order = records[orderIndex] || {};
      const name = sectionCode ? recordName(records, orderIndex, sectionCode, '') : '';
      const baseCost = orderType === 1 ? Number(order.cost) : orderType === 2 ? Number(order.shieldCost) : 0;
      const cost = Math.max(0, Number(baseCost) || 0) * (orderType === 1 ? productionFactor : 1);
      const collected = Math.max(0, Number(city.shieldsCollected) || 0);
      const perTurn = Math.max(0, Number(city.productionIncome) || 0);
      const remaining = Math.max(0, cost - collected);
      const turns = remaining > 0 && perTurn > 0 ? Math.ceil(remaining / perTurn) : 0;
      const overrun = turns > 0 ? Math.max(0, turns * perTurn - remaining) : Math.max(0, collected - cost);
      const waste = Math.max(0, Number(city.productionLoss) || 0);
      return {
        cityID: Number(city.id),
        city: city.name || '',
        cityArt: makeCityArtMetadata(city, {
          player: human,
          playerDetails: humanDetails,
          races,
          ruleRecord,
        }),
        producing: name || 'Nothing',
        producingRef: sectionCode ? makeRef(tabKey, sectionCode, orderIndex, name, ruleSignatures) : null,
        orderType: orderType === 1 ? 'Improvement' : orderType === 2 ? 'Unit' : '',
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
  return { productionFactor, rows };
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
  } = context;
  const humanUnits = (report.units && report.units.records || [])
    .filter((unit) => Number(unit.owner) === Number(human.playerID));
  const humanCities = (report.cities && report.cities.records || [])
    .filter((city) => Number(city.owner) === Number(human.playerID));
  const cityByCoordinate = new Map(humanCities.map((city) => [`${city.x},${city.y}`, city.name || '']));
  const upgradeGoldPerShield = Math.max(0, Number(gameRules && gameRules.upgradeCost) || 3);
  const unitRows = humanUnits.map((unit) => {
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
    const nationality = recordName(races, nationalityIndex, 'RACE', '');
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
      nationality,
      nationalityRef: makeRef('civilizations', 'RACE', nationalityIndex, nationality, ruleSignatures),
      foreign: nationalityIndex >= 0 && nationalityIndex !== Number(human.raceID),
      damaged: currentHealth < maxHealth,
      spent: remainingMovementThirds <= 0,
    };
  });

  const groups = new Map();
  unitRows.forEach((unit) => {
    if (!groups.has(unit.typeIndex)) groups.set(unit.typeIndex, []);
    groups.get(unit.typeIndex).push(unit);
  });
  const roster = Array.from(groups.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([typeIndex, units]) => {
      const type = unitTypes[typeIndex] || {};
      const name = recordName(unitTypes, typeIndex, 'PRTO', 'Unknown unit');
      const upgrade = resolveAvailableUpgrade(unitTypes, typeIndex, human.raceID);
      const upgradeName = upgrade ? recordName(unitTypes, upgrade.index, 'PRTO', '') : '';
      const experienceMix = experienceLevels.map((level, index) => ({
        name: level.name || `Level ${index + 1}`,
        count: units.filter((unit) => unit.experienceIndex === index).length,
      })).filter((item) => item.count > 0);
      return {
        typeIndex,
        name,
        ref: makeRef('units', 'PRTO', typeIndex, name, ruleSignatures),
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
    cityArt: options.cityArt || null,
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

function summarizeTradeRows(rows, getRefs, limit = 4) {
  const source = Array.isArray(rows) ? rows : [];
  const shown = source.slice(0, limit).map((row) => `${row.nation}: ${joinNames(getRefs(row), 3)}`).filter(Boolean);
  return source.length > shown.length ? `${shown.join('; ')}; and ${source.length - shown.length} more` : shown.join('; ');
}

function makeAlertsReport(context) {
  const {
    report, gameDate, timePlayed, economy, production, military, technology, cities, tradeRows, currentTradeRows,
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
      { tab: 'economy', sort: 20 }
    ));
  });

  (cities && cities.rows || []).forEach((row) => {
    if (Number(row.plusValue) < 0) {
      alerts.push(makeAlert(
        `city-riot-${row.id}`,
        'critical',
        'Cities',
        `${row.city} may riot`,
        `${row.city} has more unhappy citizens than happy citizens.`,
        { tab: 'cities', cityArt: row.cityArt, sort: 30 }
      ));
    }
    if (Number(row.pollution) > 0) {
      alerts.push(makeAlert(
        `city-pollution-${row.id}`,
        'warning',
        'Cities',
        `${row.city} has pollution`,
        `${row.city} has ${row.pollution} pollution marker${Number(row.pollution) === 1 ? '' : 's'}.`,
        { tab: 'cities', cityArt: row.cityArt, sort: 40 }
      ));
    }
  });

  const productionOverrunRows = (production && production.rows || []).filter((row) => Number(row.overrun) > 0);
  productionOverrunRows.forEach((row) => {
    alerts.push(makeAlert(
      `production-overrun-${row.cityID}`,
      Number(row.turns) <= 1 ? 'warning' : 'info',
      'Production',
      `${row.city} will overrun production`,
      `${row.producing} is projected to waste ${row.overrun} shield${Number(row.overrun) === 1 ? '' : 's'}${Number(row.turns) > 0 ? ` in ${row.turns} turn${Number(row.turns) === 1 ? '' : 's'}` : ''}.`,
      {
        tab: 'production',
        refs: [row.producingRef],
        detailRows: [
          { label: 'City', value: row.city },
          { label: 'Build', items: [{ name: row.producing, ref: row.producingRef }] },
          { label: 'Progress', value: `${row.collected} / ${row.cost} shields` },
          { label: 'Projected waste', value: `${row.overrun} shield${Number(row.overrun) === 1 ? '' : 's'}` },
        ],
        sort: 50 + Math.max(0, Number(row.turns) || 0),
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

  if (technology && technology.progress && technology.progress.remaining && Number(technology.progress.remaining.turns) <= 1) {
    alerts.push(makeAlert(
      'research-overrun',
      'warning',
      'Research',
      `${technology.currentProject || 'Research'} completes next turn`,
      `${technology.progress.remaining.beakers} beakers remain; end wastage is ${technology.progress.endWastage && technology.progress.endWastage.beakers || 0}.`,
      {
        tab: 'techs',
        refs: [technology.currentProjectRef],
        detailRows: [
          { label: 'Project', items: [{ name: technology.currentProject, ref: technology.currentProjectRef }] },
          { label: 'Remaining', value: `${technology.progress.remaining.beakers} beakers` },
          { label: 'End wastage', value: `${technology.progress.endWastage && technology.progress.endWastage.beakers || 0} beakers` },
        ],
        sort: 130,
      }
    ));
  }

  if (military && military.summary && Number(military.summary.damaged) > 0) {
    alerts.push(makeAlert(
      'damaged-units',
      'warning',
      'Military',
      `${military.summary.damaged} unit${Number(military.summary.damaged) === 1 ? '' : 's'} damaged`,
      'Damaged units are visible in the Military units list.',
      { tab: 'military', subtab: 'units', sort: 140 }
    ));
  }

  const current = alerts.sort((a, b) => (
    alertSeverityRank(a.severity) - alertSeverityRank(b.severity)
    || Number(a.sort) - Number(b.sort)
    || String(a.title).localeCompare(String(b.title))
  ));

  const coverage = [
    {
      id: 'trade',
      label: 'Trade opportunities and expiring deals',
      status: 'Active',
      note: 'Shows current buy/sell opportunities and timed deals that expire next turn.',
      tab: 'trade',
      alertIds: ['buy-tech', 'buy-resource', 'sell-tech', 'sell-resource', 'rival-cash', 'trade-expiring'],
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
      id: 'production',
      label: 'Production overrun',
      status: 'Active',
      note: 'Uses saved city production and projected shield overflow.',
      tab: 'production',
      alertIdPrefixes: ['production-overrun-'],
    },
    {
      id: 'economy',
      label: 'Treasury and city deficits',
      status: 'Active',
      note: 'Uses the saved-state economy model used by the Economy tab.',
      tab: 'economy',
      alertIds: ['economy-deficit'],
      alertIdPrefixes: ['city-deficit-'],
    },
    {
      id: 'research',
      label: 'Research completion overrun',
      status: 'Active',
      note: 'Fires when the current research project is due next turn.',
      tab: 'techs',
      alertIds: ['research-overrun'],
    },
    {
      id: 'cities',
      label: 'City riot and pollution warnings',
      status: 'Active',
      note: 'Uses saved city morale and visible city pollution values.',
      tab: 'cities',
      alertIdPrefixes: ['city-riot-', 'city-pollution-'],
    },
    {
      id: 'military',
      label: 'Damaged units',
      status: 'Active',
      note: 'Uses saved unit health and links to the Military units list.',
      tab: 'military',
      subtab: 'units',
      alertIds: ['damaged-units'],
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

function makeDiplomacyReport({ tradeRows, humanVisible, humanTradeTail, currentTurn }) {
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
    return {
      playerID,
      nation: row.nation,
      nationRef: row.nationRef,
      color: row.color,
      colorSlot: row.colorSlot,
      ourCulture: cultureComparisonLabel(humanVisible && humanVisible.culture, row.culture),
      theirCulture: cultureComparisonLabel(row.culture, humanVisible && humanVisible.culture),
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
      { label: 'Culture comparison', status: 'Active', note: 'Ratio-based label using saved culture totals; exact CivAssist thresholds still need confirmation.' },
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

function inspectCivAssistSaveFile(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: `SAV file not found: ${filePath || '(empty path)'}` };
  const inflated = inflateSavIfNeeded(fs.readFileSync(filePath));
  if (!inflated.ok) return inflated;
  const extract = extractEmbeddedBiqFromSavFile(filePath);
  if (!extract.ok) return extract;
  const parsed = parseAllSections(extract.buffer);
  if (!parsed.ok) return { ok: false, error: `Embedded BIQ parse failed: ${parsed.error || 'unknown error'}` };
  const report = inspectSavFile(filePath);
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
  };
  const cityById = new Map((report.cities && report.cities.records || []).map((city) => [Number(city.id), city]));
  const players = Array.isArray(report.players) ? report.players : [];
  const active = activePlayers(players);
  const humanPlayer = findHumanPlayer(players, report.game && report.game.humanPlayersMask);
  if (!humanPlayer) return { ok: false, error: 'No active human player found in SAV.' };
  const requestedPlayerID = Number(options && options.selectedPlayerID);
  const selectedPlayer = Number.isFinite(requestedPlayerID)
    ? active.find((player) => Number(player.playerID) === requestedPlayerID)
    : null;
  const human = selectedPlayer || humanPlayer;
  const perspectiveMask = playerBitMask(human.playerID) || ((Number(report.game && report.game.humanPlayersMask) || 0) >>> 0);

  const detailsByPlayer = parsePlayerDetails(inflated.buffer, players, cityById);
  const playerById = new Map(players.map((player) => [Number(player.playerID), player]));
  const humanDetails = detailsByPlayer.get(human.playerID) || {};
  humanDetails.buffer = inflated.buffer;
  const scoreTail = parseScoreTail(inflated.buffer, report, players);
  const known = parseKnownTiles(inflated.buffer, report, perspectiveMask);
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

  const visible = active
    .map((player) => {
      const details = detailsByPlayer.get(player.playerID) || {};
      const score = scoreTail.get(player.playerID) || {};
      const race = races[player.raceID] || {};
      const defaultColorSlot = Number(race.defaultColor);
      const colorSlot = defaultColorSlot;
      return {
        playerID: player.playerID,
        raceID: player.raceID,
        nation: recordName(races, player.raceID, 'RACE', `Player ${player.playerID}`),
        leader: race.name || '',
        traits: traitsForRace(race),
        colorSlot: Number.isFinite(colorSlot) ? colorSlot : null,
        color: CIV_COLOR_SWATCHES[Math.max(0, Number.isFinite(colorSlot) ? colorSlot : 0) % CIV_COLOR_SWATCHES.length],
        government: recordName(governments, details.government, 'GOVT', ''),
        governmentIndex: Number(details.government),
        era: recordName(eras, details.era, 'ERAS', ''),
        eraIndex: Number(details.era),
        gold: displayGold(details.gold),
        cities: Number(details.cities) || 0,
        units: Number(details.units) || 0,
        land: ownedLandByPlayer.get(player.playerID) || known.knownLandByPlayer.get(player.playerID) || 0,
        population: populationByPlayer.get(player.playerID) || 0,
        score: Number(score.score) || 0,
        culture: Number(details.cultureTotal) || Number(score.culture) || 0,
        culturePerTurn: Number(details.culturePerTurn) || 0,
        capital: details.capitalName || '',
      };
    })
    .filter((player) => player.land > 0);

  const humanRace = races[human.raceID] || {};
  const humanScore = scoreTail.get(human.playerID) || {};
  const humanVisible = visible.find((player) => player.playerID === human.playerID) || {
    playerID: human.playerID,
    raceID: human.raceID,
    nation: recordName(races, human.raceID, 'RACE', `Player ${human.playerID}`),
    leader: humanRace.name || '',
    traits: traitsForRace(humanRace),
    colorSlot: Number.isFinite(Number(humanRace.defaultColor)) ? Number(humanRace.defaultColor) : null,
    color: CIV_COLOR_SWATCHES[Math.max(0, Number.isFinite(Number(humanRace.defaultColor)) ? Number(humanRace.defaultColor) : 0) % CIV_COLOR_SWATCHES.length],
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
    const defaultColorSlot = Number(race.defaultColor);
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
      colorSlot: Number.isFinite(defaultColorSlot) ? defaultColorSlot : null,
      color: CIV_COLOR_SWATCHES[Math.max(0, Number.isFinite(defaultColorSlot) ? defaultColorSlot : 0) % CIV_COLOR_SWATCHES.length],
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
    const contact = readLeadVectorInt32(inflated.buffer, human, 3732, 32)[Number(row.playerID)] || 0;
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
      if (humanHas && !rivalHas && hasTechPrereqs(techs, techMasks, row.playerID, i, playerDetails.era)) sellTechs.push(item);
      if (rivalHas && !humanHas && hasTechPrereqs(techs, techMasks, human.playerID, i, humanDetails.era)) buyTechs.push(item);
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
    techs,
    techMasks,
    buildings,
    gameRules,
    ruleRecord,
    ruleSignatures,
  });
  const cities = makeCitiesReport({
    report,
    human,
    humanDetails,
    races,
    ruleRecord,
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
    races,
    humanTradeTail,
    tradeRows,
    ruleSignatures,
  });
  const production = makeProductionReport({
    report,
    human,
    humanDetails,
    races,
    ruleRecord,
    buildings,
    unitTypes,
    ruleSignatures,
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
  });
  const alerts = makeAlertsReport({
    report,
    gameDate,
    timePlayed,
    economy,
    production,
    military,
    technology,
    cities,
    tradeRows,
    currentTradeRows,
  });

  return {
    ok: true,
    sourcePath: filePath,
    title,
    ruleSignatures,
    humanPlayerID: Number(humanPlayer.playerID),
    selectedPlayerID: Number(human.playerID),
    viewingCiv: {
      playerID: Number(human.playerID),
      raceID: Number(human.raceID),
      nation: humanVisible ? humanVisible.nation : recordName(races, human.raceID, 'RACE', ''),
      leader: humanVisible ? humanVisible.leader : humanRace.name || '',
      color: humanVisible ? humanVisible.color : null,
      colorSlot: humanVisible ? humanVisible.colorSlot : null,
      isHuman: Number(human.playerID) === Number(humanPlayer.playerID),
      ref: makeRef('civilizations', 'RACE', human.raceID, humanVisible ? humanVisible.nation : recordName(races, human.raceID, 'RACE', ''), ruleSignatures),
    },
    viewingOptions,
    general: {
      gameInfo: [
        { label: 'Game Version', value: report.metadata.savMajorVersion === 24 && report.metadata.savMinorVersion === 10 ? 'C3C122' : `${report.metadata.savMajorVersion}.${report.metadata.savMinorVersion}` },
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
        { label: 'Score', value: String(humanVisible ? humanVisible.score : 0) },
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
    debug: {
      humanPlayerID: humanPlayer.playerID,
      selectedPlayerID: human.playerID,
      visiblePlayerIDs: visible.map((player) => player.playerID),
    },
  };
}

module.exports = {
  inspectCivAssistSaveFile,
  makeRuleSectionSignature,
};
