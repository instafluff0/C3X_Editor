'use strict';

const fs = require('node:fs');
const iconv = require('iconv-lite');
const { extractEmbeddedBiqFromSavBuffer, extractEmbeddedBiqFromSavFile, inflateSavIfNeeded } = require('./savExtract');
const { parseAllSections, buildBiqBuffer, sectionRecordName } = require('./biqSections');

const OVERLAY_MASKS = Object.freeze({
  road: 0x00000001,
  railroad: 0x00000002,
  mine: 0x00000004,
  irrigation: 0x00000008,
  fort: 0x00000010,
  goodyHut: 0x00000020,
  pollution: 0x00000040,
  barbarianCamp: 0x00000080,
  crater: 0x00000100,
  barricade: 0x10000000,
  airfield: 0x20000000,
  radarTower: 0x40000000,
  outpost: 0x80000000,
});

class Reader {
  constructor(buffer, offset = 0) {
    this.buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    this.off = offset;
  }

  tell() { return this.off; }
  seek(off) { this.off = off; }
  remaining() { return Math.max(0, this.buf.length - this.off); }

  ensure(len, label) {
    if (this.off < 0 || this.off + len > this.buf.length) {
      throw new Error(`SAV is truncated while reading ${label || 'data'} at offset ${this.off}.`);
    }
  }

  tag() {
    this.ensure(4, 'tag');
    const out = this.buf.subarray(this.off, this.off + 4).toString('latin1');
    this.off += 4;
    return out;
  }

  peekTag(off = this.off) {
    if (off < 0 || off + 4 > this.buf.length) return '';
    return this.buf.subarray(off, off + 4).toString('latin1');
  }

  int32() {
    this.ensure(4, 'int32');
    const out = this.buf.readInt32LE(this.off);
    this.off += 4;
    return out;
  }

  uint32() {
    this.ensure(4, 'uint32');
    const out = this.buf.readUInt32LE(this.off);
    this.off += 4;
    return out;
  }

  int16() {
    this.ensure(2, 'int16');
    const out = this.buf.readInt16LE(this.off);
    this.off += 2;
    return out;
  }

  uint16() {
    this.ensure(2, 'uint16');
    const out = this.buf.readUInt16LE(this.off);
    this.off += 2;
    return out;
  }

  int8() {
    this.ensure(1, 'int8');
    const out = this.buf.readInt8(this.off);
    this.off += 1;
    return out;
  }

  uint8() {
    this.ensure(1, 'uint8');
    const out = this.buf[this.off];
    this.off += 1;
    return out;
  }

  skip(len) {
    this.ensure(len, 'skip');
    this.off += len;
  }

  bytes(len) {
    this.ensure(len, 'bytes');
    const out = this.buf.subarray(this.off, this.off + len);
    this.off += len;
    return out;
  }
}

function cleanString(bytes, encoding = 'win1252') {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const nullPos = buf.indexOf(0);
  const body = nullPos >= 0 ? buf.subarray(0, nullPos) : buf;
  return iconv.decode(body, encoding).trim();
}

function section(parsed, code) {
  return parsed.sections.find((s) => String(s && s.code || '').toUpperCase() === code) || { records: [], count: 0 };
}

function sectionNames(parsed, code) {
  return section(parsed, code).records.map((record) => sectionRecordName(record, code));
}

function countBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return Array.from(out.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function namedIndex(names, index, fallbackPrefix) {
  const n = Number(index);
  if (!Number.isFinite(n) || n < 0) return 'None';
  const name = names[n];
  return name ? `${name} (${n})` : `${fallbackPrefix || 'Index'} ${n}`;
}

function parseLengthSection(reader, expectedTag) {
  const start = reader.tell();
  const tag = reader.tag();
  if (tag !== expectedTag) throw new Error(`Expected ${expectedTag} at ${start}, found ${tag}.`);
  const length = reader.uint32();
  reader.skip(length);
  return { tag, offset: start, length };
}

function parseGame(reader, counts, savVersion) {
  const start = reader.tell();
  const tag = reader.tag();
  if (tag !== 'GAME') throw new Error(`Expected GAME at ${start}, found ${tag}.`);
  const dataLength = reader.uint32();
  const game = {
    offset: start,
    dataLength,
    unknown1: reader.int32(),
    preferences: reader.int32(),
    rules: reader.int32(),
    unknown2: reader.int32(),
    difficulty: reader.int32(),
    unknown3: reader.int32(),
    numberOfUnits: reader.int32(),
    numberOfCities: reader.int32(),
    numberOfColonies: reader.int32(),
    nukesUsed: reader.int32(),
    globalWarmingState: reader.int32(),
    victoryType: reader.int32(),
    winner: reader.int32(),
    unknown4: reader.int32(),
    turnNumber: reader.int32(),
    gameYear: reader.int32(),
    randomSeed: reader.int32(),
    unknown5: reader.int32(),
    humanPlayersMask: reader.int32(),
    remainingPlayersMask: reader.int32(),
    remainingRacesMask: reader.int32(),
  };
  game.unknownString1 = cleanString(reader.bytes(24));
  game.powerbarCheck = reader.uint8();
  game.megaTrainerXLCheck = reader.uint8();
  reader.skip(54);
  game.civRanking = [];
  for (let i = 0; i < 32; i += 1) game.civRanking.push(reader.int32());
  game.numConts = reader.int32();
  game.numPlayers = reader.int32();

  if (savVersion.major >= 18) {
    game.numAirbases = reader.int32();
    game.numVictoryLocations = reader.int32();
    game.numRadarTowers = reader.int32();
    game.numOutposts = reader.int32();
    game.nextPlayerID = reader.int32();
    game.unknownByte1 = reader.uint8();
    if (savVersion.minor >= 6 || savVersion.major > 18) {
      game.adminPassword = cleanString(reader.bytes(228));
      reader.skip(39);
      game.victoryPointLimit = reader.int32();
      game.turnLimit = reader.int32();
      game.timePlayedMs = reader.int32();
    }
  }
  if (savVersion.major >= 24 && (savVersion.minor >= 8 || savVersion.major > 25)) {
    reader.skip(204);
    game.cityEliminationCount = reader.int32();
    game.oneCityCultureWin = reader.int32();
    game.allCitiesCultureWin = reader.int32();
    game.dominationTerrain = reader.int32();
    game.dominationPopulation = reader.int32();
    game.wonderCost = reader.int32();
    game.defeatingOpposingUnitCost = reader.int32();
    game.advancementCost = reader.int32();
    game.cityConquestPopulation = reader.int32();
    game.victoryPointScoring = reader.int32();
    game.capturingSpecialUnit = reader.int32();
  }

  game.citiesPerContinent = [];
  for (let i = 0; i < game.numConts; i += 1) game.citiesPerContinent.push(reader.int32());
  reader.skip(counts.techs * 4);
  reader.skip(counts.buildings * 4);
  reader.skip(counts.buildings);
  reader.skip(counts.buildings * 4);
  reader.skip(counts.buildings * 4);
  reader.skip(counts.units * 4);
  reader.skip(counts.units * 4);
  reader.skip(counts.techs * 4);
  game.endOffset = reader.tell();
  return game;
}

function parseWorld(reader) {
  const start = reader.tell();
  const tag = reader.tag();
  if (tag !== 'WRLD') throw new Error(`Expected WRLD at ${start}, found ${tag}.`);
  const dataLength = reader.uint32();
  const continentCount = reader.int16();
  const secondHeader = reader.tag();
  const dataLength2 = reader.uint32();
  const numLandConts = reader.int32();
  const height = reader.int32();
  const civDistance = reader.int32();
  const numCivs = reader.int32();
  const percentWater = reader.int32();
  const unknown4 = reader.int32();
  const width = reader.int32();
  reader.skip(128);
  const worldSeed = reader.int32();
  const mapFlags = reader.int32();
  const thirdHeader = reader.tag();
  const dataLength3 = reader.uint32();
  const climateSelected = reader.int32();
  const climateActual = reader.int32();
  const barbariansSelected = reader.int32();
  const barbariansActual = reader.int32();
  const landformSelected = reader.int32();
  const landformActual = reader.int32();
  const oceanCoverageSelected = reader.int32();
  const oceanCoverageActual = reader.int32();
  const temperatureSelected = reader.int32();
  const temperatureActual = reader.int32();
  const worldAgeSelected = reader.int32();
  const worldAgeActual = reader.int32();
  const worldSize = reader.int32();
  return {
    offset: start,
    dataLength,
    continentCount,
    secondHeader,
    dataLength2,
    numLandConts,
    height,
    civDistance,
    numCivs,
    percentWater,
    unknown4,
    width,
    worldSeed,
    mapFlags,
    thirdHeader,
    dataLength3,
    climateSelected,
    climateActual,
    barbariansSelected,
    barbariansActual,
    landformSelected,
    landformActual,
    oceanCoverageSelected,
    oceanCoverageActual,
    temperatureSelected,
    temperatureActual,
    worldAgeSelected,
    worldAgeActual,
    worldSize,
    endOffset: reader.tell(),
  };
}

function tileCoordsByIndex(width, index) {
  const half = Math.floor(Number(width) / 2);
  if (!Number.isFinite(half) || half <= 0) return { x: 0, y: 0 };
  const y = Math.floor(index / half);
  let x = (index % half) * 2;
  if ((y & 1) === 1) x += 1;
  return { x, y };
}

function parseTile(reader, index, width) {
  const start = reader.tell();
  if (reader.tag() !== 'TILE') throw new Error(`Expected TILE at ${start}.`);
  const dataLength = reader.uint32();
  const riverInfo = reader.uint8();
  const owner = reader.int8();
  const unknown = reader.int16();
  const resource = reader.int32();
  const topUnitID = reader.int32();
  const image = reader.uint8();
  const file = reader.uint8();
  const unknown2 = reader.int16();
  const overlayBits = reader.uint8();
  const terrainBits = reader.uint8();
  const bonusBits = reader.uint8();
  const riverData = reader.uint8();
  const barbCampID = reader.int16();
  const cityID = reader.int16();
  const colonyID = reader.int16();
  const continent = reader.int16();
  const unknown3 = reader.int16();
  const unknown4 = reader.int16();
  const hasRuins = reader.int32();
  if (dataLength > 36) reader.skip(dataLength - 36);

  if (reader.tag() !== 'TILE') throw new Error(`Expected second TILE for tile ${index}.`);
  const dataLength2 = reader.uint32();
  const c3cOverlays = reader.uint32();
  const unknown5 = reader.uint8();
  const c3cBaseRealTerrain = reader.uint8();
  const unknown6 = reader.int16();
  const c3cBonuses = reader.uint32();
  if (dataLength2 > 12) reader.skip(dataLength2 - 12);

  if (reader.tag() !== 'TILE') throw new Error(`Expected third TILE for tile ${index}.`);
  const dataLength3 = reader.uint32();
  const unknown7 = reader.int32();
  if (dataLength3 > 4) reader.skip(dataLength3 - 4);

  if (reader.tag() !== 'TILE') throw new Error(`Expected fourth TILE for tile ${index}.`);
  const dataLength4 = reader.uint32();
  const exploredBy = reader.int32();
  const visibleToByUnits = reader.int32();
  const visibleTo2 = reader.int32();
  const visibleToByCities = reader.int32();
  const unknown8 = reader.int32();
  const cityWithWorkers = reader.int16();
  reader.skip(32 * 2);
  reader.skip(32);
  reader.skip(10);
  if (dataLength4 > 128) reader.skip(dataLength4 - 128);

  return {
    index,
    ...tileCoordsByIndex(width, index),
    offset: start,
    riverInfo,
    owner,
    unknown,
    resource,
    topUnitID,
    image,
    file,
    unknown2,
    overlayBits,
    terrainBits,
    bonusBits,
    riverData,
    barbCampID,
    cityID,
    colonyID,
    continent,
    unknown3,
    unknown4,
    hasRuins,
    c3cOverlays,
    unknown5,
    c3cBaseRealTerrain,
    unknown6,
    c3cBonuses,
    unknown7,
    exploredBy,
    visibleToByUnits,
    visibleTo2,
    visibleToByCities,
    unknown8,
    cityWithWorkers,
  };
}

function parseContinent(reader, index) {
  const start = reader.tell();
  const tag = reader.tag();
  if (tag !== 'CONT') throw new Error(`Expected CONT at ${start}, found ${tag}.`);
  const dataLength = reader.uint32();
  const type = reader.int32();
  const tileCount = reader.int32();
  if (dataLength > 8) reader.skip(dataLength - 8);
  return { index, offset: start, type, tileCount };
}

function parseLeadSummaries(buf, start, end) {
  const out = [];
  let off = buf.indexOf(Buffer.from('LEAD', 'latin1'), start);
  while (off >= 0 && off < end && out.length < 32) {
    if (off + 56 <= end) {
      const dataLength = buf.readUInt32LE(off + 4);
      const playerID = buf.readInt32LE(off + 8);
      const raceID = buf.readInt32LE(off + 12);
      const power = buf.readInt32LE(off + 20);
      const capitalCity = buf.readInt32LE(off + 24);
      const difficulty = buf.readInt32LE(off + 28);
      const playerFlags = buf.readInt32LE(off + 44);
      if (dataLength > 500 && dataLength < 50000 && playerID >= 0 && playerID < 32 && raceID >= -1 && raceID < 256) {
        out.push({ offset: off, dataLength, playerID, raceID, power, capitalCity, difficulty, playerFlags });
      }
    }
    off = buf.indexOf(Buffer.from('LEAD', 'latin1'), off + 1);
  }
  return out;
}

function readUnitAt(buf, off) {
  if (off < 0 || off + 480 > buf.length || buf.subarray(off, off + 4).toString('latin1') !== 'UNIT') return null;
  const length = buf.readUInt32LE(off + 4);
  if (length < 472 || off + 8 + length > buf.length) return null;
  const body = off + 8;
  const c3cUnitFlags = buf.readInt32LE(body + 464);
  let next = off + 8 + length;
  let idlsItems = 0;
  if (buf.subarray(next, next + 4).toString('latin1') === 'IDLS') {
    if (next + 16 > buf.length) return null;
    idlsItems = buf.readInt32LE(next + 12);
    if (idlsItems < 0 || idlsItems > 10000 || next + 16 + idlsItems * 4 > buf.length) return null;
    next += 16 + idlsItems * 4;
  }
  return { length, c3cUnitFlags, idlsItems, next };
}

function validateUnitRun(buf, off, count) {
  let pos = off;
  for (let i = 0; i < count; i += 1) {
    const unit = readUnitAt(buf, pos);
    if (!unit) return null;
    pos = unit.next;
  }
  const nextTag = pos + 4 <= buf.length ? buf.subarray(pos, pos + 4).toString('latin1') : '';
  return nextTag === 'CITY' ? { start: off, end: pos } : null;
}

function findUnitRun(buf, from, count) {
  const needle = Buffer.from('UNIT', 'latin1');
  let off = buf.indexOf(needle, from);
  while (off >= 0) {
    const run = validateUnitRun(buf, off, count);
    if (run) return run;
    off = buf.indexOf(needle, off + 1);
  }
  return null;
}

function parseUnits(buf, start, count) {
  const units = [];
  let pos = start;
  for (let i = 0; i < count; i += 1) {
    const unitInfo = readUnitAt(buf, pos);
    if (!unitInfo) throw new Error(`Could not parse UNIT ${i} at ${pos}.`);
    const body = pos + 8;
    const name = cleanString(buf.subarray(body + 84, body + 144));
    units.push({
      index: i,
      offset: pos,
      id: buf.readInt32LE(body),
      x: buf.readInt32LE(body + 4),
      y: buf.readInt32LE(body + 8),
      previousX: buf.readInt32LE(body + 12),
      previousY: buf.readInt32LE(body + 16),
      owner: buf.readInt32LE(body + 20),
      nationality: buf.readInt32LE(body + 24),
      barbTribe: buf.readInt32LE(body + 28),
      unitType: buf.readInt32LE(body + 32),
      experienceLevel: buf.readInt32LE(body + 36),
      flags1: buf.readInt32LE(body + 40),
      damage: buf.readInt32LE(body + 44),
      movementUsed: buf.readInt32LE(body + 48),
      workerJob: buf.readInt32LE(body + 60),
      loadedOnUnitID: buf.readInt32LE(body + 68),
      flags2: buf.readInt32LE(body + 72),
      useName: buf.readInt32LE(body + 80),
      name,
      goToX: buf.readInt32LE(body + 144),
      goToY: buf.readInt32LE(body + 148),
      c3cUnitFlags: unitInfo.c3cUnitFlags,
      idlsItems: unitInfo.idlsItems,
    });
    pos = unitInfo.next;
  }
  return { units, endOffset: pos };
}

function parseCity(reader, index, savVersion) {
  const start = reader.tell();
  const tag = reader.peekTag();
  if (tag !== 'CITY' && tag !== 'CTPG') return null;
  reader.skip(4);
  const dataLength = reader.uint32();
  if (dataLength !== 0x88) {
    reader.skip(dataLength);
    return { dummy: true, index, offset: start, tag, dataLength };
  }
  const body = reader.bytes(dataLength);
  const city = {
    index,
    offset: start,
    id: body.readInt32LE(0),
    x: body.readInt16LE(4),
    y: body.readInt16LE(6),
    owner: body.readInt8(8),
    maintenanceGPT: body.readInt32LE(12),
    cityFlags: body.readInt32LE(16),
    governorSettings: body.readInt32LE(20),
    totalFood: body.readInt32LE(32),
    shieldsCollected: body.readInt32LE(36),
    pollution: body.readInt32LE(40),
    constructing: body.readInt32LE(44),
    constructingType: body.readInt32LE(48),
    yearBuilt: body.readInt32LE(52),
    borderLevel: body.readInt32LE(60),
    militaryPolice: body.readInt32LE(64),
    luxConnectedCount: body.readInt32LE(68),
    luxConnectedBits: body.readInt32LE(72),
    draftTurnsLeft: body.readInt32LE(80),
  };

  parseLengthSection(reader, 'CITY');
  parseLengthSection(reader, 'CITY');

  const fourthStart = reader.tell();
  if (reader.tag() !== 'CITY') throw new Error(`Expected fourth CITY at ${fourthStart}.`);
  const fourthLength = reader.uint32();
  city.culturePerTurn = reader.int32();
  city.cultureByPlayer = [];
  for (let playerID = 0; playerID < 32; playerID += 1) city.cultureByPlayer.push(reader.int32());
  city.culture = Number(city.cultureByPlayer[city.owner]) || 0;
  reader.skip(8);
  city.foodPerTurn = reader.int32();
  city.shieldsPerTurn = reader.int32();
  city.commercePerTurn = reader.int32();
  const fourthRead = reader.tell() - fourthStart - 8;
  if (fourthLength > fourthRead) reader.skip(fourthLength - fourthRead);

  const fifthStart = reader.tell();
  if (reader.tag() !== 'CITY') throw new Error(`Expected fifth CITY at ${fifthStart}.`);
  const fifthLength = reader.uint32();
  const fifthBodyStart = reader.tell();
  city.name = cleanString(reader.bytes(24));
  city.queueSlotsUsed = reader.int32();
  city.queue = [];
  for (let q = 0; q < 9; q += 1) city.queue.push({ constructing: reader.int32(), constructingType: reader.int32() });
  city.foodPerTurnForPopulation = reader.int32();
  city.corruptShieldsPerTurn = reader.int32();
  city.corruptGoldPerTurn = reader.int32();
  city.excessFoodPerTurn = reader.int32();
  city.unwastedFoodPerTurn = reader.int32();
  city.uncorruptGoldPerTurn = reader.int32();
  city.luxGoldPerTurn = reader.int32();
  city.scienceGoldPerTurn = reader.int32();
  city.addCash = reader.int32();
  city.addLuxury = reader.int32();
  city.addScience = reader.int32();
  city.addTaxes = reader.int32();
  city.foodRequired = city.foodPerTurnForPopulation;
  city.productionLoss = city.corruptShieldsPerTurn;
  city.corruption = city.corruptGoldPerTurn;
  city.foodIncome = city.excessFoodPerTurn;
  city.productionIncome = city.unwastedFoodPerTurn;
  city.cashIncome = city.uncorruptGoldPerTurn;
  city.luxuryIncome = city.luxGoldPerTurn;
  city.scienceIncome = city.scienceGoldPerTurn;
  city.taxIncome = city.addCash;
  city.specialistLuxuryIncome = city.addLuxury;
  city.specialistScienceIncome = city.addScience;
  city.specialistTaxIncome = city.addTaxes;
  const fifthRead = reader.tell() - fifthBodyStart;
  if (fifthLength > fifthRead) reader.skip(fifthLength - fifthRead);

  const popdStart = reader.tell();
  if (reader.tag() !== 'POPD') throw new Error(`Expected POPD at ${popdStart}.`);
  const popdLength = reader.uint32();
  city.specialistCount = reader.int32();
  city.citizenCount = reader.int32();
  city.citizens = [];
  for (let c = 0; c < city.citizenCount; c += 1) {
    const citizenStart = reader.tell();
    if (reader.tag() !== 'CTZN') throw new Error(`Expected CTZN at ${citizenStart}.`);
    const citizenLength = reader.uint32();
    const citizenBody = reader.bytes(citizenLength);
    city.citizens.push({
      isSpecialist: citizenLength >= 5 ? citizenBody.readUInt8(4) === 0 : false,
      workerType: citizenLength >= 320 ? citizenBody.readInt32LE(316) : -1,
      mood: citizenLength >= 268 ? citizenBody.readInt32LE(264) : -1,
      nationality: citizenLength >= 292 ? citizenBody.readInt32LE(288) : -1,
    });
  }
  const popdRead = reader.tell() - popdStart - 8;
  if (popdLength > popdRead) reader.skip(popdLength - popdRead);

  const binfStart = reader.tell();
  if (reader.tag() !== 'BINF') throw new Error(`Expected BINF at ${binfStart}.`);
  const binfLength = reader.uint32();
  city.buildingCount = reader.int32();
  city.buildings = [];
  for (let buildingIndex = 0; buildingIndex < city.buildingCount; buildingIndex += 1) {
    city.buildings.push({
      buildingIndex,
      yearBuilt: reader.int32(),
      originalOwner: reader.int32(),
      culture: reader.int32(),
    });
  }
  const binfRead = reader.tell() - binfStart - 8;
  if (binfLength > binfRead) reader.skip(binfLength - binfRead);

  parseLengthSection(reader, 'BITM');
  if (savVersion.major >= 18) parseLengthSection(reader, 'DATE');

  return city;
}

function parseCities(reader, savVersion) {
  const realCities = [];
  const dummyCities = [];
  let index = 0;
  while (reader.peekTag() === 'CITY' || reader.peekTag() === 'CTPG') {
    const city = parseCity(reader, index, savVersion);
    if (!city) break;
    if (city.dummy) dummyCities.push(city);
    else realCities.push(city);
    index += 1;
  }
  return { realCities, dummyCities, endOffset: reader.tell() };
}

function parseColonies(reader, count) {
  const colonies = [];
  for (let i = 0; i < count && reader.peekTag() === 'CLNY'; i += 1) {
    const start = reader.tell();
    reader.skip(4);
    const sectionLength = reader.uint32();
    const uniqueID = reader.int32();
    const x = reader.int32();
    const y = reader.int32();
    const controllingPlayer = reader.int32();
    if (sectionLength > 16) reader.skip(sectionLength - 16);
    colonies.push({ index: i, offset: start, sectionLength, uniqueID, x, y, controllingPlayer });
  }
  return colonies;
}

function summarizeTiles(tiles, names) {
  const overlays = {};
  for (const [key, mask] of Object.entries(OVERLAY_MASKS)) {
    overlays[key] = tiles.filter((tile) => (tile.c3cOverlays & mask) !== 0).length;
  }
  const resourceTiles = tiles.filter((tile) => tile.resource >= 0);
  const resourceCounts = countBy(resourceTiles, (tile) => namedIndex(names.resources, tile.resource, 'Resource'));
  const terrainCounts = countBy(tiles, (tile) => {
    const index = tile.c3cBaseRealTerrain & 0x0f;
    return namedIndex(names.terrain, index, 'Terrain');
  });
  return {
    count: tiles.length,
    resourceTileCount: resourceTiles.length,
    overlays,
    resourceCounts,
    terrainCounts,
    sampleResourceTiles: resourceTiles.slice(0, 25).map((tile) => ({
      x: tile.x,
      y: tile.y,
      resource: namedIndex(names.resources, tile.resource, 'Resource'),
      overlays: tile.c3cOverlays,
    })),
  };
}

function summarizeUnits(units, names, players) {
  const playerById = new Map(players.map((p) => [p.playerID, p]));
  const ownerName = (owner) => {
    const player = playerById.get(owner);
    return player ? namedIndex(names.civs, player.raceID, 'Race') : `Player ${owner}`;
  };
  return {
    count: units.length,
    byType: countBy(units, (unit) => namedIndex(names.units, unit.unitType, 'Unit')),
    byOwner: countBy(units, (unit) => ownerName(unit.owner)),
    records: units.map((unit) => ({
      id: unit.id,
      x: unit.x,
      y: unit.y,
      owner: unit.owner,
      nationality: unit.nationality,
      unitType: unit.unitType,
      experienceLevel: unit.experienceLevel,
      ownerName: ownerName(unit.owner),
      type: namedIndex(names.units, unit.unitType, 'Unit'),
      name: unit.name,
      damage: unit.damage,
      movementUsed: unit.movementUsed,
      loadedOnUnitID: unit.loadedOnUnitID,
    })),
  };
}

function summarizeCities(cities, names, players) {
  const playerById = new Map(players.map((p) => [p.playerID, p]));
  const ownerName = (owner) => {
    const player = playerById.get(owner);
    return player ? namedIndex(names.civs, player.raceID, 'Race') : `Player ${owner}`;
  };
  return {
    count: cities.length,
    byOwner: countBy(cities, (city) => ownerName(city.owner)),
    records: cities.map((city) => {
      const owner = playerById.get(city.owner);
      const ownerRaceID = owner ? Number(owner.raceID) : -1;
      const citizens = Array.isArray(city.citizens) ? city.citizens : [];
      return ({
      id: city.id,
      name: city.name,
      x: city.x,
      y: city.y,
      owner: city.owner,
      ownerName: ownerName(city.owner),
      cityFlags: city.cityFlags,
      yearBuilt: city.yearBuilt,
      population: city.citizenCount,
      specialists: city.specialistCount,
      citizens,
      happyCitizens: citizens.filter((citizen) => Number(citizen.mood) === 0).length,
      unhappyCitizens: citizens.filter((citizen) => Number(citizen.mood) === 2).length,
      contentCitizens: citizens.filter((citizen) => Number(citizen.mood) === 1).length,
      resistingCitizens: Math.max(0, citizens.filter((citizen) => {
        const mood = Number(citizen.mood);
        return mood !== 0 && mood !== 1 && mood !== 2;
      }).length - city.specialistCount),
      alienCitizens: citizens.filter((citizen) => Number(citizen.nationality) >= 0 && Number(citizen.nationality) !== ownerRaceID).length,
      buildings: city.buildingCount,
      buildingRecords: city.buildings,
      foodPerTurn: city.foodPerTurn,
      shieldsPerTurn: city.shieldsPerTurn,
      shieldsCollected: city.shieldsCollected,
      commercePerTurn: city.commercePerTurn,
      culturePerTurn: city.culturePerTurn,
      culture: city.culture,
      pollution: city.pollution,
      maintenanceGPT: city.maintenanceGPT,
      totalFood: city.totalFood,
      foodRequired: city.foodRequired,
      foodIncome: city.foodIncome,
      productionLoss: city.productionLoss,
      corruption: city.corruption,
      productionIncome: city.productionIncome,
      cashIncome: city.cashIncome,
      luxuryIncome: city.luxuryIncome,
      scienceIncome: city.scienceIncome,
      taxIncome: city.taxIncome,
      addCash: city.addCash,
      addLuxury: city.addLuxury,
      addScience: city.addScience,
      addTaxes: city.addTaxes,
      specialistLuxuryIncome: city.specialistLuxuryIncome,
      specialistScienceIncome: city.specialistScienceIncome,
      specialistTaxIncome: city.specialistTaxIncome,
      constructingIndex: city.constructing,
      constructingType: city.constructingType,
      productionQueue: city.queue,
      constructing: city.constructingType === 1
        ? namedIndex(names.buildings, city.constructing, 'Building')
        : city.constructingType === 2
          ? namedIndex(names.units, city.constructing, 'Unit')
          : `Type ${city.constructingType}:${city.constructing}`,
      });
    }),
  };
}

function makeBiqTileRecordFromSavTile(tile, cityIdToIndex, colonyIdToIndex) {
  const raw = Buffer.alloc(49, 0);
  raw.writeUInt32LE(45, 0);
  raw[4] = tile.riverInfo & 0xff;
  raw[5] = tile.riverData & 0xff;
  raw.writeInt32LE(Number(tile.resource) | 0, 6);
  raw[10] = tile.image & 0xff;
  raw[11] = tile.file & 0xff;
  raw.writeInt16LE(Number(tile.unknown) | 0, 12);
  raw[14] = tile.overlayBits & 0xff;
  raw[15] = tile.terrainBits & 0xff;
  raw[16] = tile.bonusBits & 0xff;
  raw[17] = 0;
  raw.writeInt16LE(Number(tile.barbCampID) | 0, 18);
  raw.writeInt16LE(cityIdToIndex.has(tile.cityID) ? cityIdToIndex.get(tile.cityID) : -1, 20);
  raw.writeInt16LE(colonyIdToIndex.has(tile.colonyID) ? colonyIdToIndex.get(tile.colonyID) : -1, 22);
  raw.writeInt16LE(Number(tile.continent) | 0, 24);
  raw[26] = 6;
  raw.writeInt16LE(-1, 27);
  raw.writeInt32LE(Number(tile.hasRuins) | 0, 29);
  raw.writeInt32LE(Number(tile.c3cOverlays) | 0, 33);
  raw[37] = Number(tile.unknown3) & 0xff;
  raw[38] = tile.c3cBaseRealTerrain & 0xff;
  raw.writeInt16LE(Number(tile.unknown4) | 0, 39);
  raw.writeInt16LE(1, 41);
  raw.writeInt32LE(Number(tile.c3cBonuses) | 0, 43);
  raw.writeInt16LE(Number(tile.unknown5) | 0, 47);
  return raw;
}

function makeDebugBiqSection(code, records) {
  return {
    code,
    count: records.length,
    records,
    _modified: true,
  };
}

function makeCivAdvisorMapData({ world, tiles, cities, units, colonies, players }) {
  const cityIdToIndex = new Map((cities || []).map((city, index) => [Number(city.id), index]));
  const colonyIdToIndex = new Map((colonies || []).map((colony, index) => [Number(colony.uniqueID), index]));
  const capitalCityIds = new Set((players || [])
    .map((player) => Number(player.capitalCity))
    .filter((id) => Number.isFinite(id) && id >= 0));
  return {
    width: Number(world && world.width) || 0,
    height: Number(world && world.height) || 0,
    flags: Number(world && world.mapFlags) || 0,
    tiles: (tiles || []).map((tile, index) => ({
      index,
      x: Number(tile.x) || 0,
      y: Number(tile.y) || 0,
      riverConnectionInfo: Number(tile.riverInfo) || 0,
      border: 0,
      ownerType: Number(tile.owner) >= 0 ? 3 : 0,
      owner: Number(tile.owner),
      resource: Number(tile.resource),
      image: Number(tile.image) || 0,
      file: Number(tile.file) || 0,
      questionMark: Number(tile.unknown) || 0,
      overlays: Number(tile.overlayBits) || 0,
      baseRealTerrain: Number(tile.terrainBits) || 0,
      bonuses: Number(tile.bonusBits) || 0,
      riverCrossingData: Number(tile.riverData) || 0,
      barbarianTribe: Number(tile.barbCampID),
      city: cityIdToIndex.has(Number(tile.cityID)) ? cityIdToIndex.get(Number(tile.cityID)) : -1,
      colony: colonyIdToIndex.has(Number(tile.colonyID)) ? colonyIdToIndex.get(Number(tile.colonyID)) : -1,
      continent: Number(tile.continent) || 0,
      victoryPointLocation: -1,
      ruin: Number(tile.hasRuins) ? 1 : 0,
      c3cOverlays: Number(tile.c3cOverlays) >>> 0,
      c3cBaseRealTerrain: Number(tile.c3cBaseRealTerrain) || 0,
      fogOfWar: 1,
      c3cBonuses: Number(tile.c3cBonuses) >>> 0,
      exploredBy: Number(tile.exploredBy) >>> 0,
      visibleBy: (
        (Number(tile.visibleToByUnits) >>> 0)
        | (Number(tile.visibleTo2) >>> 0)
        | (Number(tile.visibleToByCities) >>> 0)
      ) >>> 0,
    })),
    cities: (cities || []).map((city, index) => ({
      index,
      hasWalls: 0,
      hasPalace: capitalCityIds.has(Number(city.id)) ? 1 : 0,
      name: city.name || `City ${city.id}`,
      ownerType: 3,
      owner: Number(city.owner),
      buildings: [],
      culture: Number(city.totalCulture) || 0,
      size: Math.max(1, Number(city.citizenCount) || 1),
      x: Number(city.x) || 0,
      y: Number(city.y) || 0,
      cityLevel: (Number(city.citizenCount) || 1) >= 13 ? 2 : ((Number(city.citizenCount) || 1) >= 7 ? 1 : 0),
      borderLevel: Number(city.borderLevel) || 0,
      useAutoName: 0,
    })),
    units: (units || []).map((unit, index) => ({
      index,
      name: unit.name || '',
      ownerType: 3,
      experienceLevel: Number(unit.experienceLevel) || 0,
      owner: Number(unit.owner),
      pRTONumber: Number(unit.unitType) || 0,
      AIStrategy: 0,
      x: Number(unit.x) || 0,
      y: Number(unit.y) || 0,
      customName: unit.name || '',
      useCivilizationKing: 0,
    })),
    colonies: (colonies || []).map((colony, index) => ({
      index,
      ownerType: 3,
      owner: Number(colony.controllingPlayer),
      x: Number(colony.x) || 0,
      y: Number(colony.y) || 0,
      improvementType: 0,
    })),
  };
}

function buildDebugBiqBufferFromSaveData({ extract, parsed, game, world, tiles, continents, goodCounts, units, cities, colonies, players, names }) {
  const header = Buffer.from(extract.buffer.subarray(0, 736));
  header.write('BICX', 0, 'latin1');
  const title = Buffer.from('Debug BIQ from SAV', 'latin1');
  title.copy(header, 672, 0, Math.min(title.length, 63));

  const cityIdToIndex = new Map(cities.map((city, index) => [city.id, index]));
  const colonyIdToIndex = new Map(colonies.map((colony, index) => [colony.uniqueID, index]));
  const capitalCityIds = new Set(players.map((player) => Number(player.capitalCity)).filter((id) => Number.isFinite(id) && id >= 0));

  const mapSections = [
    makeDebugBiqSection('WCHR', [{
      selectedClimate: world.climateSelected,
      actualClimate: world.climateActual,
      selectedBarbarian: world.barbariansSelected,
      actualBarbarian: world.barbariansActual,
      selectedLandform: world.landformSelected,
      actualLandform: world.landformActual,
      selectedOcean: world.oceanCoverageSelected,
      actualOcean: world.oceanCoverageActual,
      selectedTemp: world.temperatureSelected,
      actualTemp: world.temperatureActual,
      selectedAge: world.worldAgeSelected,
      actualAge: world.worldAgeActual,
      worldSize: world.worldSize,
    }]),
    makeDebugBiqSection('WMAP', [{
      name: 'World Map',
      numResources: goodCounts.length,
      resourceOccurrences: goodCounts,
      numContinents: game.numConts,
      height: world.height,
      distanceBetweenCivs: world.civDistance,
      numCivs: world.numCivs,
      qm1: world.percentWater,
      qm2: world.unknown4,
      width: world.width,
      qm3: -1,
      unknownBytes: Buffer.alloc(124),
      mapSeed: world.worldSeed,
      flags: world.mapFlags,
      _tail: Buffer.alloc(0),
    }]),
    makeDebugBiqSection('TILE', tiles.map((tile, index) => ({
      index,
      ...tile,
      _rawRecord: makeBiqTileRecordFromSavTile(tile, cityIdToIndex, colonyIdToIndex),
    }))),
    makeDebugBiqSection('CONT', continents.map((continent, index) => ({
      index,
      continentClass: continent.type,
      numTiles: continent.tileCount,
    }))),
  ];

  const slocRecords = tiles
    .filter((tile) => (Number(tile.c3cBonuses) & 0x00000008) !== 0)
    .map((tile, index) => ({
      index,
      ownerType: 0,
      owner: -1,
      x: tile.x,
      y: tile.y,
    }));
  if (slocRecords.length > 0) mapSections.push(makeDebugBiqSection('SLOC', slocRecords));

  mapSections.push(makeDebugBiqSection('CITY', cities.map((city, index) => ({
    index,
    hasWalls: 0,
    hasPalace: capitalCityIds.has(city.id) ? 1 : 0,
    name: city.name || `City ${city.id}`,
    ownerType: 3,
    owner: city.owner,
    buildings: [],
    culture: 0,
    size: Math.max(1, Number(city.citizenCount) || 1),
    x: city.x,
    y: city.y,
    cityLevel: (Number(city.citizenCount) || 1) >= 13 ? 2 : ((Number(city.citizenCount) || 1) >= 7 ? 1 : 0),
    borderLevel: city.borderLevel,
    useAutoName: 0,
  }))));

  mapSections.push(makeDebugBiqSection('UNIT', units.map((unit, index) => ({
    index,
    name: names.units[unit.unitType] || `Unit ${unit.unitType}`,
    ownerType: 3,
    experienceLevel: unit.experienceLevel,
    owner: unit.owner,
    pRTONumber: unit.unitType,
    AIStrategy: 0,
    x: unit.x,
    y: unit.y,
    customName: unit.name || '',
    useCivilizationKing: 0,
  }))));

  if (colonies.length > 0) {
    mapSections.push(makeDebugBiqSection('CLNY', colonies.map((colony, index) => ({
      index,
      ownerType: 3,
      owner: colony.controllingPlayer,
      x: colony.x,
      y: colony.y,
      improvementType: 0,
    }))));
  }

  const beforeGame = [];
  const afterMap = [];
  for (const originalSection of parsed.sections) {
    const code = String(originalSection && originalSection.code || '').toUpperCase();
    if (['WCHR', 'WMAP', 'TILE', 'CONT', 'SLOC', 'CITY', 'UNIT', 'CLNY'].includes(code)) continue;
    if (code === 'GAME' || code === 'LEAD') afterMap.push(originalSection);
    else beforeGame.push(originalSection);
  }

  return buildBiqBuffer({
    ...parsed,
    versionTag: 'BICX',
    _headerBuf: header,
    sections: beforeGame.concat(mapSections, afterMap),
  });
}

function inspectSavBuffer(input, options = {}) {
  const suppliedInflated = options && options.inflated && Buffer.isBuffer(options.inflated.buffer)
    ? options.inflated
    : null;
  const inflated = suppliedInflated || inflateSavIfNeeded(input);
  if (!inflated.ok) return inflated;
  const suppliedExtract = options && options.extract && options.extract.ok && Buffer.isBuffer(options.extract.buffer)
    ? options.extract
    : null;
  const extract = suppliedExtract || extractEmbeddedBiqFromSavBuffer(inflated.buffer);
  if (!extract.ok) return extract;
  const suppliedParsed = options && options.parsed && options.parsed.ok && Array.isArray(options.parsed.sections)
    ? options.parsed
    : null;
  const parsed = suppliedParsed || parseAllSections(extract.buffer);
  if (!parsed.ok) return { ok: false, error: `Embedded BIQ parse failed: ${parsed.error || 'unknown error'}` };

  const names = {
    resources: sectionNames(parsed, 'GOOD'),
    units: sectionNames(parsed, 'PRTO'),
    civs: section(parsed, 'RACE').records.map((record) => record.civilizationName || sectionRecordName(record, 'RACE')),
    terrain: sectionNames(parsed, 'TERR'),
    buildings: sectionNames(parsed, 'BLDG'),
  };
  const counts = {
    techs: section(parsed, 'TECH').records.length,
    buildings: section(parsed, 'BLDG').records.length,
    units: section(parsed, 'PRTO').records.length,
    resources: section(parsed, 'GOOD').records.length,
  };

  try {
    const reader = new Reader(inflated.buffer, extract.metadata.biqOffset + extract.metadata.biqDataLength);
    const savVersion = { major: extract.metadata.savMajorVersion, minor: extract.metadata.savMinorVersion };
    const game = parseGame(reader, counts, savVersion);
    parseLengthSection(reader, 'DATE');
    parseLengthSection(reader, 'PLGI');
    parseLengthSection(reader, 'PLGI');
    parseLengthSection(reader, 'DATE');
    parseLengthSection(reader, 'DATE');
    if (reader.peekTag() !== 'CNSL') {
      const cnsl = inflated.buffer.indexOf(Buffer.from('CNSL', 'latin1'), reader.tell());
      if (cnsl < 0 || cnsl - reader.tell() > 16) throw new Error(`Expected CNSL near ${reader.tell()}, found ${reader.peekTag()}.`);
      reader.seek(cnsl);
    }
    parseLengthSection(reader, 'CNSL');
    const world = parseWorld(reader);
    const tileCount = Math.floor(world.width * world.height / 2);
    const tiles = [];
    for (let i = 0; i < tileCount; i += 1) tiles.push(parseTile(reader, i, world.width));
    const continents = [];
    for (let i = 0; i < game.numConts; i += 1) continents.push(parseContinent(reader, i));
    const goodCounts = [];
    for (let i = 0; i < counts.resources; i += 1) goodCounts.push(reader.int32());

    const unitRun = findUnitRun(inflated.buffer, reader.tell(), game.numberOfUnits);
    if (!unitRun) throw new Error(`Could not find a valid UNIT run for ${game.numberOfUnits} units after offset ${reader.tell()}.`);
    const players = parseLeadSummaries(inflated.buffer, reader.tell(), unitRun.start);
    const parsedUnits = parseUnits(inflated.buffer, unitRun.start, game.numberOfUnits);
    reader.seek(parsedUnits.endOffset);
    const parsedCities = parseCities(reader, savVersion);
    const colonies = parseColonies(reader, game.numberOfColonies);

    const report = {
      ok: true,
      sourcePath: options.sourcePath || '',
      metadata: extract.metadata,
      rules: {
        resources: counts.resources,
        unitTypes: counts.units,
        civilizations: names.civs.length,
        terrainTypes: names.terrain.length,
        buildings: counts.buildings,
        technologies: counts.techs,
      },
      game,
      world,
      players,
      continents,
      goodCounts: goodCounts.map((count, index) => ({ resource: namedIndex(names.resources, index, 'Resource'), count })),
      tiles: summarizeTiles(tiles, names),
      units: summarizeUnits(parsedUnits.units, names, players),
      cities: summarizeCities(parsedCities.realCities, names, players),
      colonies: {
        count: colonies.length,
        records: colonies,
      },
      parseOffsets: {
        afterEmbeddedBiq: extract.metadata.biqOffset + extract.metadata.biqDataLength,
        afterGame: game.endOffset,
        afterWorld: world.endOffset,
        afterTiles: continents.length > 0 ? continents[0].offset : reader.tell(),
        unitStart: unitRun.start,
        unitEnd: parsedUnits.endOffset,
        cityEnd: parsedCities.endOffset,
      },
      warnings: [],
    };
    if (game.numberOfCities !== parsedCities.realCities.length) {
      report.warnings.push(`GAME says ${game.numberOfCities} cities; parsed ${parsedCities.realCities.length} real city records.`);
    }
    if (players.length < 32) report.warnings.push(`Parsed ${players.length} LEAD summaries; expected 32.`);
    if (game.numberOfColonies !== colonies.length) {
      report.warnings.push(`GAME says ${game.numberOfColonies} colonies; parsed ${colonies.length} colony records.`);
    }
    if (options && options.debugBiqBuffer) {
      report.debugBiqBuffer = buildDebugBiqBufferFromSaveData({
        extract,
        parsed,
        game,
        world,
        tiles,
        continents,
        goodCounts,
        units: parsedUnits.units,
        cities: parsedCities.realCities,
        colonies,
        players,
        names,
      });
    }
    if (options && options.includeMapData) {
      report.mapData = makeCivAdvisorMapData({
        world,
        tiles,
        cities: parsedCities.realCities,
        units: parsedUnits.units,
        colonies,
        players,
      });
    }
    return report;
  } catch (err) {
    return { ok: false, error: `SAV inspect failed: ${err.message}` };
  }
}

function inspectSavFile(filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: `SAV file not found: ${filePath || '(empty path)'}` };
  return inspectSavBuffer(fs.readFileSync(filePath), { ...options, sourcePath: filePath });
}

function topList(items, limit = 12) {
  return items.slice(0, limit).map((entry) => `  - ${entry.key}: ${entry.count}`).join('\n');
}

function formatSavDebugReport(report, options = {}) {
  if (!report || !report.ok) return String(report && report.error || 'SAV inspect failed.');
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 12;
  const lines = [];
  lines.push(`SAV: ${report.sourcePath || '(buffer)'}`);
  lines.push(`Version: ${report.metadata.savMajorVersion}.${report.metadata.savMinorVersion}; embedded ${report.metadata.biqVersionTag} bytes=${report.metadata.biqDataLength}`);
  if (report.metadata.searchPath) lines.push(`Scenario search path: ${report.metadata.searchPath}`);
  lines.push(`Turn: ${report.game.turnNumber}; units=${report.game.numberOfUnits}; cities=${report.game.numberOfCities}; colonies=${report.game.numberOfColonies}`);
  lines.push(`World: ${report.world.width}x${report.world.height} (${report.tiles.count} stored tiles), seed=${report.world.worldSeed}, water=${report.world.percentWater}%`);
  lines.push(`Rules: resources=${report.rules.resources}, unit types=${report.rules.unitTypes}, civs=${report.rules.civilizations}, terrain=${report.rules.terrainTypes}`);
  lines.push('');
  lines.push(`Tile overlays: road=${report.tiles.overlays.road}, railroad=${report.tiles.overlays.railroad}, mine=${report.tiles.overlays.mine}, irrigation=${report.tiles.overlays.irrigation}, pollution=${report.tiles.overlays.pollution}`);
  lines.push(`Resource tiles: ${report.tiles.resourceTileCount}`);
  if (report.tiles.resourceCounts.length) lines.push(topList(report.tiles.resourceCounts, limit));
  lines.push('');
  lines.push('Terrain counts:');
  lines.push(topList(report.tiles.terrainCounts, limit));
  lines.push('');
  lines.push('Units by type:');
  lines.push(topList(report.units.byType, limit));
  lines.push('');
  lines.push('Units by owner:');
  lines.push(topList(report.units.byOwner, limit));
  lines.push('');
  lines.push('Cities:');
  for (const city of report.cities.records.slice(0, limit)) {
    lines.push(`  - ${city.name || '(unnamed)'} (${city.x},${city.y}) pop=${city.population} owner=${city.ownerName} builds=${city.constructing}`);
  }
  if (report.warnings.length) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n');
}

module.exports = {
  inspectSavBuffer,
  inspectSavFile,
  formatSavDebugReport,
  buildDebugBiqBufferFromSaveData,
  OVERLAY_MASKS,
};
