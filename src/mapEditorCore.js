(function mapEditorCoreFactory(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.MapEditorCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function mapEditorCoreInit() {
  function canonicalKey(raw) {
    return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function parseIntLoose(value, fallback) {
    var s = String(value == null ? '' : value).trim();
    var lower = s.toLowerCase();
    if (lower === 'false') return 0;
    if (lower === 'true') return 1;
    var referenceMatch = s.match(/\((-?\d+)\)\s*$/);
    if (referenceMatch) return Number.parseInt(referenceMatch[1], 10);
    var m = s.match(/-?\d+/);
    if (!m) return Number.isFinite(fallback) ? fallback : 0;
    return Number.parseInt(m[0], 10);
  }

  function getField(record, key) {
    if (!record || !Array.isArray(record.fields)) return null;
    var target = canonicalKey(key);
    for (var i = 0; i < record.fields.length; i += 1) {
      var field = record.fields[i];
      if (canonicalKey(field && (field.baseKey || field.key)) === target) return field;
    }
    return null;
  }

  function ensureField(record, key, label, value) {
    if (!record) return null;
    if (!Array.isArray(record.fields)) record.fields = [];
    var field = getField(record, key);
    if (field) return field;
    field = {
      key: String(key || ''),
      baseKey: String(key || ''),
      label: String(label || key || ''),
      value: String(value == null ? '' : value),
      originalValue: ''
    };
    record.fields.push(field);
    return field;
  }

  function setField(record, key, value, label) {
    var field = ensureField(record, key, label || key, value);
    if (!field) return;
    field.value = String(value == null ? '' : value);
    field.mapEditorValueEdited = true;
    if (record && typeof record === 'object') {
      var target = canonicalKey(key);
      var keys = Object.keys(record);
      for (var i = 0; i < keys.length; i += 1) {
        if (canonicalKey(keys[i]) !== target) continue;
        record[keys[i]] = String(value == null ? '' : value);
        break;
      }
    }
  }

  function tileCoordsByIndex(width, index) {
    var half = Math.floor(width / 2);
    if (!Number.isFinite(half) || half <= 0) return { xPos: 0, yPos: 0 };
    var row = Math.floor(index / half);
    var column = (index % half) * 2;
    if ((row & 1) === 1) column += 1;
    return { xPos: column, yPos: row };
  }

  function tileGridCoordsByIndex(width, index) {
    var half = Math.floor(width / 2);
    if (!Number.isFinite(half) || half <= 0) return { col: 0, row: 0 };
    return {
      col: index % half,
      row: Math.floor(index / half)
    };
  }

  function wrapDelta(value, span) {
    var delta = Number(value) || 0;
    var size = Math.floor(Number(span) || 0);
    if (size <= 0) return delta;
    var best = delta;
    var minus = delta - size;
    var plus = delta + size;
    if (Math.abs(minus) < Math.abs(best)) best = minus;
    if (Math.abs(plus) < Math.abs(best)) best = plus;
    return best;
  }

  function computeBrushTileIndexes(width, tileCount, centerIndex, diameter, options) {
    var out = [];
    var radius = Math.max(0, (Math.max(1, Number(diameter) || 1) - 1) / 2);
    var center = tileCoordsByIndex(width, centerIndex);
    var wrapX = !options || options.wrapX !== false;
    var mapWidth = Math.floor(Number(width) || 0);
    var maxDistance = radius * 2;
    for (var i = 0; i < tileCount; i += 1) {
      var p = tileCoordsByIndex(width, i);
      var dx = p.xPos - center.xPos;
      if (wrapX && mapWidth > 0) dx = wrapDelta(dx, mapWidth);
      var dy = p.yPos - center.yPos;
      // Use Civ3 logical tile axes instead of the packed TILE record grid so
      // screen-space NxN brushes stay centered on the isometric lattice.
      var axisA = dx + dy;
      var axisB = dx - dy;
      if (Math.max(Math.abs(axisA), Math.abs(axisB)) <= maxDistance) out.push(i);
    }
    return out;
  }

  function applyTerrain(records, indexes, terrainCode) {
    var code = Number.parseInt(String(terrainCode), 10);
    if (!Number.isFinite(code) || code < 0) return;
    var packed = ((code & 0x0f) << 4) | (code & 0x0f);
    indexes.forEach(function (idx) {
      var tile = records[idx];
      if (!tile) return;
      setField(tile, 'baserealterrain', String(packed), 'Base Real Terrain');
      setField(tile, 'c3cbaserealterrain', String(packed), 'C3C Base Real Terrain');
    });
  }

  function collectTundraTransitionNeighborFixups(seedIndexes, getTerrainCode, getNeighborIndexes, terrainEnum) {
    if (!Array.isArray(seedIndexes) || typeof getTerrainCode !== 'function' || typeof getNeighborIndexes !== 'function' || !terrainEnum) return [];
    var candidates = new Set();
    seedIndexes.forEach(function (idx) {
      if (!Number.isFinite(idx) || idx < 0) return;
      candidates.add(idx);
      var neighbors = getNeighborIndexes(idx);
      if (!Array.isArray(neighbors)) return;
      neighbors.forEach(function (neighborIdx) {
        if (!Number.isFinite(neighborIdx) || neighborIdx < 0) return;
        candidates.add(neighborIdx);
      });
    });
    var fixups = [];
    candidates.forEach(function (idx) {
      var terrain = Number(getTerrainCode(idx));
      if (!Number.isFinite(terrain)) return;
      if (terrain === terrainEnum.TUNDRA || terrain === terrainEnum.GRASSLAND || terrain === terrainEnum.COAST || terrain === terrainEnum.SEA || terrain === terrainEnum.OCEAN) return;
      if (terrain !== terrainEnum.PLAINS && terrain !== terrainEnum.DESERT) return;
      var neighbors = getNeighborIndexes(idx);
      if (!Array.isArray(neighbors) || neighbors.length === 0) return;
      var touchesTundra = neighbors.some(function (neighborIdx) {
        return Number(getTerrainCode(neighborIdx)) === terrainEnum.TUNDRA;
      });
      if (!touchesTundra) return;
      fixups.push({ index: idx, terrainCode: terrainEnum.GRASSLAND });
    });
    return fixups;
  }

  function collectGrasslandPlainsDesertCoastFixups(transitionQuartets, terrainEnum) {
    if (!Array.isArray(transitionQuartets) || !terrainEnum) return [];
    var fixupsByIndex = new Map();
    transitionQuartets.forEach(function (quartet) {
      if (!Array.isArray(quartet) || quartet.length === 0) return;
      var hasGrassland = false;
      var hasPlains = false;
      var hasDesert = false;
      var hasCoast = false;
      quartet.forEach(function (entry) {
        var terrain = Number(entry && entry.terrainCode);
        if (terrain === terrainEnum.GRASSLAND) hasGrassland = true;
        else if (terrain === terrainEnum.PLAINS) hasPlains = true;
        else if (terrain === terrainEnum.DESERT) hasDesert = true;
        else if (terrain === terrainEnum.COAST) hasCoast = true;
      });
      if (!(hasGrassland && hasPlains && hasDesert && hasCoast)) return;
      var preferredOrder = [2, 1, 3, 0];
      for (var i = 0; i < preferredOrder.length; i += 1) {
        var entry = quartet[preferredOrder[i]];
        var index = Number(entry && entry.index);
        var terrain = Number(entry && entry.terrainCode);
        if (!Number.isFinite(index) || index < 0) continue;
        if (terrain !== terrainEnum.GRASSLAND) continue;
        fixupsByIndex.set(index, { index: index, terrainCode: terrainEnum.PLAINS });
        return;
      }
    });
    return Array.from(fixupsByIndex.values());
  }

  function resolveTerrainPaintCode(requestedTerrainCode, hasRiverConnection, terrainEnum) {
    var code = Number(requestedTerrainCode);
    if (!Number.isFinite(code) || !terrainEnum) return code;
    if (code !== terrainEnum.FLOODPLAIN) return code;
    return hasRiverConnection ? terrainEnum.FLOODPLAIN : terrainEnum.DESERT;
  }

  function sanitizeTerrainBonusMask(terrainCode, bonusMask, terrainEnum, tileBonusEnum) {
    var code = Number(terrainCode);
    var mask = Number(bonusMask) >>> 0;
    if (!Number.isFinite(code) || !terrainEnum || !tileBonusEnum) return mask;
    var allowed = 0;
    if (
      code === terrainEnum.DESERT
      || code === terrainEnum.PLAINS
      || code === terrainEnum.GRASSLAND
      || code === terrainEnum.HILLS
      || code === terrainEnum.MOUNTAIN
      || code === terrainEnum.FOREST
      || code === terrainEnum.SEA
    ) {
      allowed |= Number(tileBonusEnum.LANDMARK) >>> 0;
    }
    if (code === terrainEnum.GRASSLAND) allowed |= Number(tileBonusEnum.BONUS_GRASSLAND) >>> 0;
    if (code === terrainEnum.FOREST) allowed |= Number(tileBonusEnum.PINE_FOREST) >>> 0;
    if (code === terrainEnum.MOUNTAIN) allowed |= Number(tileBonusEnum.SNOW_CAPPED_MOUNTAIN) >>> 0;
    return (mask & allowed) >>> 0;
  }

  var RIVER_MASK = {
    NE: 2,
    SE: 8,
    SW: 32,
    NW: 128
  };

  var RIVER_DIRECTIONS = [
    { name: 'NE', dx: 1, dy: -1, mask: RIVER_MASK.NE, oppositeMask: RIVER_MASK.SW },
    { name: 'SE', dx: 1, dy: 1, mask: RIVER_MASK.SE, oppositeMask: RIVER_MASK.NW },
    { name: 'SW', dx: -1, dy: 1, mask: RIVER_MASK.SW, oppositeMask: RIVER_MASK.NE },
    { name: 'NW', dx: -1, dy: -1, mask: RIVER_MASK.NW, oppositeMask: RIVER_MASK.SE }
  ];

  function getTileCoords(record) {
    if (!record) return null;
    var x = parseIntLoose(getField(record, 'xpos') && getField(record, 'xpos').value, NaN);
    var y = parseIntLoose(getField(record, 'ypos') && getField(record, 'ypos').value, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { xPos: x, yPos: y };
  }

  function getRiverMask(record) {
    return parseIntLoose(getField(record, 'riverconnectioninfo') && getField(record, 'riverconnectioninfo').value, 0) >>> 0;
  }

  function setRiverMask(record, mask) {
    var next = Number(mask) >>> 0;
    var current = getRiverMask(record);
    if (next === current) return false;
    setField(record, 'riverconnectioninfo', String(next), 'River Connection Info');
    return true;
  }

  function decodeTerrain(record) {
    var c3cPacked = getField(record, 'c3cbaserealterrain');
    var legacyPacked = getField(record, 'baserealterrain');
    var rawValue = c3cPacked && String(c3cPacked.value || '').trim()
      ? c3cPacked.value
      : (legacyPacked ? legacyPacked.value : '');
    var packed = parseIntLoose(rawValue, 0) & 0xff;
    if (packed >= 0 && packed <= 0x0f) return { baseTerrain: packed, realTerrain: packed };
    return {
      baseTerrain: packed & 0x0f,
      realTerrain: (packed >>> 4) & 0x0f
    };
  }

  function isWaterTile(record) {
    return decodeTerrain(record).realTerrain >= 11;
  }

  function buildTileCoordLookup(records) {
    var byCoord = new Map();
    var indexByRecord = new Map();
    var maxX = -1;
    (Array.isArray(records) ? records : []).forEach(function (record, idx) {
      if (!record) return;
      var coords = getTileCoords(record);
      if (!coords) return;
      indexByRecord.set(record, idx);
      byCoord.set(String(coords.xPos) + ',' + String(coords.yPos), record);
      if (coords.xPos > maxX) maxX = coords.xPos;
    });
    return {
      byCoord: byCoord,
      indexByRecord: indexByRecord,
      mapWidth: maxX + 1
    };
  }

  function normalizeWrappedX(xPos, mapWidth) {
    var width = Math.floor(Number(mapWidth) || 0);
    if (width <= 0) return xPos;
    var wrapped = xPos % width;
    if (wrapped < 0) wrapped += width;
    return wrapped;
  }

  function getNeighborRiverTile(lookup, coords, direction) {
    if (!lookup || !lookup.byCoord || !coords || !direction) return null;
    var xPos = normalizeWrappedX(coords.xPos + direction.dx, lookup.mapWidth);
    var yPos = coords.yPos + direction.dy;
    return lookup.byCoord.get(String(xPos) + ',' + String(yPos)) || null;
  }

  function connectRiverPair(tile, neighbor, direction, changedIndexes, indexByRecord) {
    if (!tile || !neighbor || !direction) return false;
    var changed = false;
    var tileIndex = Number(indexByRecord && indexByRecord.get(tile));
    var neighborIndex = Number(indexByRecord && indexByRecord.get(neighbor));
    if (setRiverMask(tile, getRiverMask(tile) | direction.mask)) {
      changed = true;
      if (Number.isFinite(tileIndex) && changedIndexes) changedIndexes.add(tileIndex);
    }
    if (setRiverMask(neighbor, getRiverMask(neighbor) | direction.oppositeMask)) {
      changed = true;
      if (Number.isFinite(neighborIndex) && changedIndexes) changedIndexes.add(neighborIndex);
    }
    return changed;
  }

  function applyRiverOverlay(records, indexes, enabled) {
    var selected = new Set((Array.isArray(indexes) ? indexes : []).filter(function (idx) {
      return Number.isFinite(idx) && idx >= 0 && records && records[idx];
    }));
    if (selected.size === 0) return [];
    var lookup = buildTileCoordLookup(records);
    var changedIndexes = new Set();
    if (!enabled) {
      selected.forEach(function (idx) {
        var tile = records[idx];
        var coords = getTileCoords(tile);
        if (!tile || !coords) return;
        if (setRiverMask(tile, 0)) changedIndexes.add(idx);
        RIVER_DIRECTIONS.forEach(function (direction) {
          var neighbor = getNeighborRiverTile(lookup, coords, direction);
          if (!neighbor) return;
          var nextMask = getRiverMask(neighbor) & (~direction.oppositeMask);
          if (setRiverMask(neighbor, nextMask)) {
            var neighborIndex = Number(lookup.indexByRecord && lookup.indexByRecord.get(neighbor));
            if (Number.isFinite(neighborIndex)) changedIndexes.add(neighborIndex);
          }
        });
      });
      return Array.from(changedIndexes);
    }
    selected.forEach(function (idx) {
      var tile = records[idx];
      var coords = getTileCoords(tile);
      if (!tile || !coords || isWaterTile(tile)) return;
      var connected = false;
      RIVER_DIRECTIONS.forEach(function (direction) {
        var neighbor = getNeighborRiverTile(lookup, coords, direction);
        var neighborIndex = Number(neighbor && lookup.indexByRecord && lookup.indexByRecord.get(neighbor));
        var shouldConnect = false;
        if (neighbor && !isWaterTile(neighbor)) {
          shouldConnect = selected.has(neighborIndex) || getRiverMask(neighbor) !== 0;
        }
        if (!shouldConnect) return;
        if (connectRiverPair(tile, neighbor, direction, changedIndexes, lookup.indexByRecord)) connected = true;
      });
      if (connected || getRiverMask(tile) !== 0) return;
      for (var i = 0; i < RIVER_DIRECTIONS.length; i += 1) {
        var fallbackDirection = RIVER_DIRECTIONS[i];
        var fallbackNeighbor = getNeighborRiverTile(lookup, coords, fallbackDirection);
        if (!fallbackNeighbor || isWaterTile(fallbackNeighbor)) continue;
        connectRiverPair(tile, fallbackNeighbor, fallbackDirection, changedIndexes, lookup.indexByRecord);
        break;
      }
    });
    return Array.from(changedIndexes);
  }

  function overlayFieldKey(overlayType) {
    var key = String(overlayType || '').trim().toLowerCase();
    var map = {
      river: { kind: 'river', field: 'riverconnectioninfo', label: 'River Connection Info' },
      road: { kind: 'mask', field: 'c3coverlays', mask: 0x00000001, label: 'C3C Overlays' },
      railroad: { kind: 'mask', field: 'c3coverlays', mask: 0x00000002, label: 'C3C Overlays' },
      mine: { kind: 'mask', field: 'c3coverlays', mask: 0x00000004, label: 'C3C Overlays' },
      irrigate: { kind: 'mask', field: 'c3coverlays', mask: 0x00000008, label: 'C3C Overlays' },
      irrigation: { kind: 'mask', field: 'c3coverlays', mask: 0x00000008, label: 'C3C Overlays' },
      fort: { kind: 'mask', field: 'c3coverlays', mask: 0x00000010, label: 'C3C Overlays' },
      goodyhut: { kind: 'mask', field: 'c3coverlays', mask: 0x00000020, label: 'C3C Overlays' },
      pollution: { kind: 'mask', field: 'c3coverlays', mask: 0x00000040, label: 'C3C Overlays' },
      barbariancamp: { kind: 'mask', field: 'c3coverlays', mask: 0x00000080, label: 'C3C Overlays' },
      crater: { kind: 'mask', field: 'c3coverlays', mask: 0x00000100, label: 'C3C Overlays' },
      barricade: { kind: 'mask', field: 'c3coverlays', mask: 0x10000000, label: 'C3C Overlays' },
      airfield: { kind: 'mask', field: 'c3coverlays', mask: 0x20000000, label: 'C3C Overlays' },
      radartower: { kind: 'mask', field: 'c3coverlays', mask: 0x40000000, label: 'C3C Overlays' },
      outpost: { kind: 'mask', field: 'c3coverlays', mask: 0x80000000, label: 'C3C Overlays' },
      startinglocation: { kind: 'mask', field: 'c3cbonuses', mask: 0x00000008, label: 'C3C Bonuses' },
      ruins: { kind: 'scalar', field: 'ruin', on: '1', off: '0', label: 'Ruin' },
      victorypoint: { kind: 'scalar', field: 'victorypointlocation', on: '0', off: '-1', label: 'Victory Point Location' }
    };
    return map[key] || null;
  }

  function applyOverlay(records, indexes, overlayType, enabled) {
    var spec = overlayFieldKey(overlayType);
    if (!spec) return false;
    if (spec.kind === 'river') return applyRiverOverlay(records, indexes, enabled).length > 0;
    var changed = false;
    indexes.forEach(function (idx) {
      var tile = records[idx];
      if (!tile) return;
      if (spec.kind === 'scalar') {
        setField(tile, spec.field, enabled ? spec.on : spec.off, spec.label);
        changed = true;
        return;
      }
      var field = getField(tile, spec.field);
      var current = parseIntLoose(field && field.value, 0) >>> 0;
      var next = enabled ? ((current | spec.mask) >>> 0) : ((current & (~spec.mask)) >>> 0);
      if (next === current) return;
      setField(tile, spec.field, String(next >>> 0), spec.label);
      changed = true;
    });
    return changed;
  }

  function applyFog(records, indexes, addFog) {
    indexes.forEach(function (idx) {
      var tile = records[idx];
      if (!tile) return;
      setField(tile, 'fogofwar', addFog ? '0' : '1', 'Fog Of War');
    });
  }

  function applyDistrict(records, indexes, districtType, districtState, enabled) {
    var type = Number.parseInt(String(districtType), 10);
    var state = Number.parseInt(String(districtState), 10);
    if (!enabled) {
      indexes.forEach(function (idx) {
        var tile = records[idx];
        if (!tile) return;
        setField(tile, 'district', '', 'District');
      });
      return;
    }
    if (!Number.isFinite(type) || type < 0) return;
    if (!Number.isFinite(state) || state < 0) state = 1;
    indexes.forEach(function (idx) {
      var tile = records[idx];
      if (!tile) return;
      setField(tile, 'district', String(type) + ',' + String(state), 'District');
    });
  }

  function makeRecordFromTemplate(section, newRecordRef) {
    var records = Array.isArray(section && section.records) ? section.records : [];
    var template = records.length > 0 ? JSON.parse(JSON.stringify(records[0])) : { fields: [] };
    if (!Array.isArray(template.fields)) template.fields = [];
    template.newRecordRef = String(newRecordRef || '').trim().toUpperCase();
    template.index = records.reduce(function (max, rec) {
      var idx = Number(rec && rec.index);
      return Number.isFinite(idx) ? Math.max(max, idx) : max;
    }, -1) + 1;
    template.fields = template.fields.map(function (field) {
      var canon = canonicalKey(field && (field.baseKey || field.key));
      if (canon === 'name') return Object.assign({}, field, { value: template.newRecordRef });
      if (canon === 'x' || canon === 'y' || canon === 'owner' || canon === 'ownertype' || canon === 'citylevel' || canon === 'size' || canon === 'culture') {
        return Object.assign({}, field, { value: '0', originalValue: '' });
      }
      return Object.assign({}, field, { originalValue: '' });
    });
    return template;
  }

  function clearCityBuildings(record) {
    if (!record) return;
    if (Array.isArray(record.fields)) {
      record.fields = record.fields.filter(function (field) {
        var canon = canonicalKey(field && (field.baseKey || field.key));
        if (canon === 'building' || canon === 'buildings' || /^building\d+$/.test(canon)) return false;
        return true;
      });
      ['numbuildings', 'haswalls', 'haspalace'].forEach(function (key) {
        var field = getField(record, key);
        if (!field) return;
        field.value = '0';
        field.originalValue = '';
        field.mapEditorValueEdited = true;
      });
    }
    record.buildings = [];
    record.numBuildings = 0;
    record.hasWalls = 0;
    record.hasPalace = 0;
  }

  function addCity(section, tileRecord, x, y, owner, ownerType, name, newRecordRef) {
    var city = makeRecordFromTemplate(section, newRecordRef);
    clearCityBuildings(city);
    setField(city, 'name', name || 'New City', 'Name');
    setField(city, 'x', String(x), 'X');
    setField(city, 'y', String(y), 'Y');
    setField(city, 'owner', String(owner), 'Owner');
    setField(city, 'ownertype', String(ownerType), 'Owner Type');
    setField(city, 'size', '1', 'Size');
    setField(city, 'citylevel', '0', 'City Level');
    setField(city, 'culture', '0', 'Culture');
    if (!Array.isArray(section.records)) section.records = [];
    section.records.push(city);
    setField(tileRecord, 'city', String(city.index), 'City');
    return city;
  }

  function addUnit(section, tileRecord, x, y, owner, ownerType, prtoNumber, newRecordRef) {
    var unit = makeRecordFromTemplate(section, newRecordRef);
    setField(unit, 'x', String(x), 'X');
    setField(unit, 'y', String(y), 'Y');
    setField(unit, 'owner', String(owner), 'Owner');
    setField(unit, 'ownertype', String(ownerType), 'Owner Type');
    setField(unit, 'prtonumber', String(prtoNumber), 'Unit');
    if (!Array.isArray(section.records)) section.records = [];
    section.records.push(unit);
    setField(tileRecord, 'unit_on_tile', String(unit.index), 'Unit On Tile');
    return unit;
  }

  function addOrUpdateStartingLocation(section, x, y, owner, ownerType, newRecordRef) {
    if (!section) return { changed: false, created: false, record: null, removedRecords: [] };
    if (!Array.isArray(section.records)) section.records = [];
    var targetX = Number(x);
    var targetY = Number(y);
    var targetOwner = parseIntLoose(owner, -1);
    var targetOwnerType = parseIntLoose(ownerType, 0);
    var removedRecords = [];
    if ((targetOwnerType === 2 || targetOwnerType === 3) && targetOwner >= 0) {
      section.records = section.records.filter(function (record) {
        var recordOwnerType = parseIntLoose(getField(record, 'ownertype') && getField(record, 'ownertype').value, 0);
        var recordOwner = parseIntLoose(getField(record, 'owner') && getField(record, 'owner').value, -1);
        if (recordOwnerType !== targetOwnerType || recordOwner !== targetOwner) return true;
        var recordX = parseIntLoose(getField(record, 'x') && getField(record, 'x').value, NaN);
        var recordY = parseIntLoose(getField(record, 'y') && getField(record, 'y').value, NaN);
        if (recordX === targetX && recordY === targetY) return true;
        removedRecords.push(record);
        return false;
      });
    }
    var existing = null;
    for (var i = 0; i < section.records.length; i += 1) {
      var record = section.records[i];
      var sx = parseIntLoose(getField(record, 'x') && getField(record, 'x').value, NaN);
      var sy = parseIntLoose(getField(record, 'y') && getField(record, 'y').value, NaN);
      if (sx === targetX && sy === targetY) {
        existing = record;
        break;
      }
    }
    if (existing) {
      setField(existing, 'ownertype', String(targetOwnerType), 'Owner Type');
      setField(existing, 'owner', String(targetOwner), 'Owner');
      setField(existing, 'x', String(targetX), 'X');
      setField(existing, 'y', String(targetY), 'Y');
      return { changed: true, created: false, record: existing, removedRecords: removedRecords };
    }
    var sloc = makeRecordFromTemplate(section, newRecordRef);
    setField(sloc, 'ownertype', String(targetOwnerType), 'Owner Type');
    setField(sloc, 'owner', String(targetOwner), 'Owner');
    setField(sloc, 'x', String(targetX), 'X');
    setField(sloc, 'y', String(targetY), 'Y');
    section.records.push(sloc);
    return { changed: true, created: true, record: sloc, removedRecords: removedRecords };
  }

  return {
    canonicalKey: canonicalKey,
    parseIntLoose: parseIntLoose,
    getField: getField,
    ensureField: ensureField,
    setField: setField,
    tileCoordsByIndex: tileCoordsByIndex,
    tileGridCoordsByIndex: tileGridCoordsByIndex,
    computeBrushTileIndexes: computeBrushTileIndexes,
    applyTerrain: applyTerrain,
    collectTundraTransitionNeighborFixups: collectTundraTransitionNeighborFixups,
    collectGrasslandPlainsDesertCoastFixups: collectGrasslandPlainsDesertCoastFixups,
    resolveTerrainPaintCode: resolveTerrainPaintCode,
    sanitizeTerrainBonusMask: sanitizeTerrainBonusMask,
    RIVER_MASK: RIVER_MASK,
    applyRiverOverlay: applyRiverOverlay,
    applyOverlay: applyOverlay,
    applyFog: applyFog,
    applyDistrict: applyDistrict,
    addCity: addCity,
    addUnit: addUnit,
    addOrUpdateStartingLocation: addOrUpdateStartingLocation
  };
}));
