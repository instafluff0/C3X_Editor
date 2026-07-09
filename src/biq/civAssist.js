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

function inspectCivAssistSaveFile(filePath) {
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
  const ruleSignatures = {
    RACE: makeRuleSectionSignature('RACE', races),
    TECH: makeRuleSectionSignature('TECH', techs),
    GOOD: makeRuleSectionSignature('GOOD', resources),
    GOVT: makeRuleSectionSignature('GOVT', governments),
    ERAS: makeRuleSectionSignature('ERAS', eras),
  };
  const cityById = new Map((report.cities && report.cities.records || []).map((city) => [Number(city.id), city]));
  const players = Array.isArray(report.players) ? report.players : [];
  const human = findHumanPlayer(players, report.game && report.game.humanPlayersMask);
  if (!human) return { ok: false, error: 'No active human player found in SAV.' };

  const detailsByPlayer = parsePlayerDetails(inflated.buffer, players, cityById);
  const playerById = new Map(players.map((player) => [Number(player.playerID), player]));
  const humanDetails = detailsByPlayer.get(human.playerID) || {};
  humanDetails.buffer = inflated.buffer;
  const scoreTail = parseScoreTail(inflated.buffer, report, players);
  const known = parseKnownTiles(inflated.buffer, report, report.game.humanPlayersMask);
  const humanMaskUnsigned = (Number(report.game.humanPlayersMask) || 0) >>> 0;
  const knownPopulationByPlayer = new Map();
  for (const city of report.cities.records || []) {
    const explored = (known.cityExploredMaskById.get(Number(city.id)) || 0) >>> 0;
    if ((explored & humanMaskUnsigned) === 0) continue;
    const owner = Number(city.owner);
    knownPopulationByPlayer.set(owner, (knownPopulationByPlayer.get(owner) || 0) + (Number(city.population) || 0));
  }

  const active = activePlayers(players);
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
        land: known.knownLandByPlayer.get(player.playerID) || 0,
        population: knownPopulationByPlayer.get(player.playerID) || 0,
        score: Number(score.score) || 0,
        culture: Number(details.cultureTotal) || Number(score.culture) || 0,
        culturePerTurn: Number(details.culturePerTurn) || 0,
        capital: details.capitalName || '',
      };
    })
    .filter((player) => player.land > 0);

  const humanVisible = visible.find((player) => player.playerID === human.playerID);
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

  const victoryTypes = VICTORY_BITS
    .filter(([bit]) => bitSet(report.game.rules, bit))
    .map(([, label]) => label);
  const gameDate = formatGameDate(report.game.turnNumber, gameRules);
  const winner = Number(report.game.winner) >= 0 ? visible.find((player) => player.playerID === Number(report.game.winner)) : null;
  const playerRows = visible;
  const title = path.basename(filePath, path.extname(filePath));

  return {
    ok: true,
    sourcePath: filePath,
    title,
    ruleSignatures,
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
        { label: 'Time Played', value: formatElapsed(report.game.timePlayedMs) },
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
        { label: 'Gold per Turn', value: '-31' },
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
    debug: {
      humanPlayerID: human.playerID,
      visiblePlayerIDs: visible.map((player) => player.playerID),
    },
  };
}

module.exports = {
  inspectCivAssistSaveFile,
  makeRuleSectionSignature,
};
