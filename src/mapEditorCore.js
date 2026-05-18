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

  function overlayFieldKey(overlayType) {
    var key = String(overlayType || '').trim().toLowerCase();
    var map = {
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

  function addCity(section, tileRecord, x, y, owner, ownerType, name, newRecordRef) {
    var city = makeRecordFromTemplate(section, newRecordRef);
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
    applyOverlay: applyOverlay,
    applyFog: applyFog,
    applyDistrict: applyDistrict,
    addCity: addCity,
    addUnit: addUnit
  };
}));
