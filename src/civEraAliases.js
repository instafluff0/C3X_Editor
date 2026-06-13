(function civEraAliasesFactory(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.CivEraAliases = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function civEraAliasesInit() {
  'use strict';

  const ERA_ALIAS_COUNT = 4;
  const SOURCE_KINDS = Object.freeze([
    { key: 'noun', label: 'Noun', fieldKeys: ['noun', 'singularname'] },
    { key: 'adjective', label: 'Adjective', fieldKeys: ['adjective', 'adjectivename'] },
    { key: 'formal', label: 'Formal', fieldKeys: ['civilizationname', 'countryname'] }
  ]);

  function normalizeText(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeLookup(value) {
    return normalizeText(value).toLowerCase();
  }

  function normalizeFieldKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function splitTopLevelEntries(value) {
    let raw = normalizeText(value);
    if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1).trim();
    if (!raw) return [];
    const out = [];
    let cur = '';
    let inQuotes = false;
    let parenDepth = 0;
    for (let idx = 0; idx < raw.length; idx += 1) {
      const ch = raw[idx];
      if (ch === '"') {
        inQuotes = !inQuotes;
        cur += ch;
        continue;
      }
      if (!inQuotes) {
        if (ch === '(') parenDepth += 1;
        else if (ch === ')' && parenDepth > 0) parenDepth -= 1;
      }
      if (ch === ',' && !inQuotes && parenDepth === 0) {
        const token = cur.trim();
        if (token) out.push(token);
        cur = '';
        continue;
      }
      cur += ch;
    }
    const tail = cur.trim();
    if (tail) out.push(tail);
    return out;
  }

  function splitAliasTokens(value) {
    const raw = normalizeText(value);
    if (!raw) return [];
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let idx = 0; idx < raw.length; idx += 1) {
      const ch = raw[idx];
      if (ch === '"') {
        inQuotes = !inQuotes;
        cur += ch;
        continue;
      }
      if (/\s/.test(ch) && !inQuotes) {
        const token = cur.trim();
        if (token) out.push(stripOuterQuotes(token));
        cur = '';
        continue;
      }
      cur += ch;
    }
    const tail = cur.trim();
    if (tail) out.push(stripOuterQuotes(tail));
    return out;
  }

  function findTopLevelColon(value) {
    const raw = String(value || '');
    let inQuotes = false;
    for (let idx = 0; idx < raw.length; idx += 1) {
      const ch = raw[idx];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ':' && !inQuotes) return idx;
    }
    return -1;
  }

  function parseStringTokenAt(value, startIndex = 0) {
    const raw = String(value || '');
    let idx = Math.max(0, Number(startIndex) || 0);
    while (idx < raw.length && /\s/.test(raw[idx])) idx += 1;
    if (idx >= raw.length) return null;
    if (raw[idx] === '"') {
      const start = idx + 1;
      idx = start;
      while (idx < raw.length && raw[idx] !== '"') idx += 1;
      const text = raw.slice(start, idx);
      if (idx < raw.length && raw[idx] === '"') idx += 1;
      return { text, end: idx };
    }
    const start = idx;
    while (idx < raw.length && !/\s/.test(raw[idx]) && ![':', ',', '(', ')', '[', ']'].includes(raw[idx])) idx += 1;
    if (idx === start) return null;
    return { text: raw.slice(start, idx), end: idx };
  }

  function stripOuterQuotes(value) {
    const raw = normalizeText(value);
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
    return raw;
  }

  function quoteToken(value) {
    const clean = normalizeText(value).replace(/"/g, "'");
    if (!clean) return '';
    if (/[\s,:\[\]]/.test(clean)) return `"${clean}"`;
    return clean;
  }

  function trimReplacementList(replacements) {
    const out = Array.from({ length: ERA_ALIAS_COUNT }, (_, idx) => normalizeText(Array.isArray(replacements) ? replacements[idx] : ''));
    while (out.length > 0 && !out[out.length - 1]) out.pop();
    return out;
  }

  function makeEmptyLeaderReplacements() {
    return Array.from({ length: ERA_ALIAS_COUNT }, () => ({ name: '', gender: '', title: '' }));
  }

  function normalizeLeaderReplacement(rep) {
    return {
      name: normalizeText(rep && rep.name),
      gender: normalizeText(rep && rep.gender).toUpperCase(),
      title: normalizeText(rep && rep.title)
    };
  }

  function trimLeaderReplacementList(replacements) {
    const out = Array.from({ length: ERA_ALIAS_COUNT }, (_, idx) => normalizeLeaderReplacement(Array.isArray(replacements) ? replacements[idx] : null));
    while (out.length > 0) {
      const tail = out[out.length - 1];
      if (tail && tail.name) break;
      out.pop();
    }
    return out;
  }

  function parseLeaderMetadataAt(value, startIndex = 0) {
    const raw = String(value || '');
    let idx = Math.max(0, Number(startIndex) || 0);
    while (idx < raw.length && /\s/.test(raw[idx])) idx += 1;
    if (raw[idx] !== '(') return null;
    idx += 1;
    const genderToken = parseStringTokenAt(raw, idx);
    if (!genderToken) return null;
    const gender = normalizeText(genderToken.text).toUpperCase();
    if (gender !== 'M' && gender !== 'F') return null;
    idx = genderToken.end;
    while (idx < raw.length && /\s/.test(raw[idx])) idx += 1;
    let title = '';
    if (raw[idx] === ',') {
      idx += 1;
      const titleToken = parseStringTokenAt(raw, idx);
      if (!titleToken) return null;
      title = normalizeText(titleToken.text);
      idx = titleToken.end;
      while (idx < raw.length && /\s/.test(raw[idx])) idx += 1;
    }
    if (raw[idx] !== ')') return null;
    return { gender, title, end: idx + 1 };
  }

  function parseLeaderAliasReplacements(value) {
    const raw = String(value || '');
    const out = [];
    let idx = 0;
    while (idx < raw.length && out.length < ERA_ALIAS_COUNT) {
      const nameToken = parseStringTokenAt(raw, idx);
      if (!nameToken) break;
      idx = nameToken.end;
      const meta = parseLeaderMetadataAt(raw, idx);
      if (meta) idx = meta.end;
      out.push({
        name: normalizeText(nameToken.text),
        gender: meta ? meta.gender : '',
        title: meta ? meta.title : ''
      });
    }
    return out.filter((rep) => rep.name);
  }

  function parseCivAliasesByEra(value) {
    return splitTopLevelEntries(value).map((entry) => {
      const idx = findTopLevelColon(entry);
      if (idx < 0) {
        return {
          source: stripOuterQuotes(entry),
          replacements: []
        };
      }
      return {
        source: stripOuterQuotes(entry.slice(0, idx)),
        replacements: splitAliasTokens(entry.slice(idx + 1)).slice(0, ERA_ALIAS_COUNT)
      };
    }).filter((item) => item.source || item.replacements.length > 0);
  }

  function serializeCivAliasesByEra(items) {
    const entries = (Array.isArray(items) ? items : []).map((item) => {
      const source = normalizeText(item && item.source);
      const repls = trimReplacementList(item && item.replacements);
      if (!source || repls.length === 0) return '';
      return `${quoteToken(source)}: ${repls.map(quoteToken).join(' ')}`;
    }).filter(Boolean);
    return entries.length > 0 ? `[${entries.join(', ')}]` : '';
  }

  function parseLeaderAliasesByEra(value) {
    return splitTopLevelEntries(value).map((entry) => {
      const idx = findTopLevelColon(entry);
      if (idx < 0) {
        return {
          source: stripOuterQuotes(entry),
          replacements: []
        };
      }
      return {
        source: stripOuterQuotes(entry.slice(0, idx)),
        replacements: parseLeaderAliasReplacements(entry.slice(idx + 1))
      };
    }).filter((item) => item.source || item.replacements.length > 0);
  }

  function serializeLeaderAliasesByEra(items) {
    const entries = (Array.isArray(items) ? items : []).map((item) => {
      const source = normalizeText(item && item.source);
      const repls = trimLeaderReplacementList(item && item.replacements);
      if (!source || repls.length === 0) return '';
      const chunks = repls.map((rep) => {
        if (!rep.name) return '';
        const namePart = quoteToken(rep.name);
        if (rep.gender && rep.title) return `${namePart} (${rep.gender}, ${quoteToken(rep.title)})`;
        if (rep.gender) return `${namePart} (${rep.gender})`;
        return namePart;
      }).filter(Boolean);
      if (chunks.length === 0) return '';
      return `${quoteToken(source)}: ${chunks.join(' ')}`;
    }).filter(Boolean);
    return entries.length > 0 ? `[${entries.join(', ')}]` : '';
  }

  function readEntryField(entry, fieldKeys) {
    const wanted = new Set((Array.isArray(fieldKeys) ? fieldKeys : []).map(normalizeFieldKey).filter(Boolean));
    const fields = Array.isArray(entry && entry.biqFields) ? entry.biqFields : [];
    for (const field of fields) {
      const key = normalizeFieldKey(field && (field.baseKey || field.key));
      if (wanted.has(key)) {
        const value = normalizeText(field && field.value);
        if (value) return value;
      }
    }
    return '';
  }

  function getCivilizationAliasSources(entry) {
    const sources = {};
    SOURCE_KINDS.forEach((kind) => {
      sources[kind.key] = readEntryField(entry, kind.fieldKeys);
    });
    return sources;
  }

  function getLeaderAliasSource(entry) {
    return readEntryField(entry, ['leadername', 'leader']);
  }

  function makeEmptyAliases() {
    const aliases = {};
    SOURCE_KINDS.forEach((kind) => {
      aliases[kind.key] = Array.from({ length: ERA_ALIAS_COUNT }, () => '');
    });
    return aliases;
  }

  function normalizeAliasesByKind(input) {
    const aliases = makeEmptyAliases();
    SOURCE_KINDS.forEach((kind) => {
      const raw = Array.isArray(input && input[kind.key]) ? input[kind.key] : [];
      for (let idx = 0; idx < ERA_ALIAS_COUNT; idx += 1) aliases[kind.key][idx] = normalizeText(raw[idx]);
    });
    return aliases;
  }

  function buildCivAliasEditorModel(value, civEntries) {
    const items = parseCivAliasesByEra(value);
    const bySource = new Map();
    items.forEach((item, idx) => {
      const sourceKey = normalizeLookup(item.source);
      if (!sourceKey) return;
      if (!bySource.has(sourceKey)) bySource.set(sourceKey, []);
      bySource.get(sourceKey).push(idx);
    });

    const usedItemIndexes = new Set();
    const groups = [];
    (Array.isArray(civEntries) ? civEntries : []).forEach((entry) => {
      const sourceNames = getCivilizationAliasSources(entry);
      const aliases = makeEmptyAliases();
      let hasAlias = false;
      let hasDuplicate = false;
      SOURCE_KINDS.forEach((kind) => {
        const source = normalizeLookup(sourceNames[kind.key]);
        if (!source) return;
        const matches = bySource.get(source) || [];
        if (matches.length > 1) {
          hasDuplicate = true;
          return;
        }
        if (matches.length === 1 && !usedItemIndexes.has(matches[0])) {
          aliases[kind.key] = Array.from({ length: ERA_ALIAS_COUNT }, (_, idx) => normalizeText(items[matches[0]].replacements[idx]));
          usedItemIndexes.add(matches[0]);
          hasAlias = true;
        }
      });
      if (hasAlias && !hasDuplicate) {
        groups.push({
          civName: normalizeText(entry && entry.name),
          sourceNames,
          aliases,
          entry
        });
      } else if (hasDuplicate) {
        SOURCE_KINDS.forEach((kind) => {
          const source = normalizeLookup(sourceNames[kind.key]);
          const matches = bySource.get(source) || [];
          if (matches.length === 1) usedItemIndexes.delete(matches[0]);
        });
      }
    });

    const ungrouped = items.filter((_, idx) => !usedItemIndexes.has(idx));
    return { groups, ungrouped };
  }

  function makeEmptyGroup(entry) {
    return {
      civName: normalizeText(entry && entry.name),
      sourceNames: getCivilizationAliasSources(entry),
      aliases: makeEmptyAliases(),
      entry: entry || null
    };
  }

  function serializeCivAliasEditorModel(model) {
    const items = [];
    const groups = Array.isArray(model && model.groups) ? model.groups : [];
    groups.forEach((group) => {
      const sourceNames = group && group.sourceNames ? group.sourceNames : {};
      const aliases = normalizeAliasesByKind(group && group.aliases);
      SOURCE_KINDS.forEach((kind) => {
        const source = normalizeText(sourceNames[kind.key]);
        const replacements = trimReplacementList(aliases[kind.key]);
        if (source && replacements.length > 0) items.push({ source, replacements });
      });
    });
    (Array.isArray(model && model.ungrouped) ? model.ungrouped : []).forEach((item) => {
      items.push({
        source: normalizeText(item && item.source),
        replacements: trimReplacementList(item && item.replacements)
      });
    });
    return serializeCivAliasesByEra(items);
  }

  function buildLeaderAliasEditorModel(value, civEntries) {
    const items = parseLeaderAliasesByEra(value);
    const bySource = new Map();
    items.forEach((item, idx) => {
      const sourceKey = normalizeLookup(item.source);
      if (!sourceKey) return;
      if (!bySource.has(sourceKey)) bySource.set(sourceKey, []);
      bySource.get(sourceKey).push(idx);
    });

    const usedItemIndexes = new Set();
    const groups = [];
    (Array.isArray(civEntries) ? civEntries : []).forEach((entry) => {
      const leaderName = getLeaderAliasSource(entry);
      const source = normalizeLookup(leaderName);
      if (!source) return;
      const matches = bySource.get(source) || [];
      if (matches.length !== 1 || usedItemIndexes.has(matches[0])) return;
      groups.push({
        leaderName,
        civName: normalizeText(entry && entry.name),
        replacements: Array.from({ length: ERA_ALIAS_COUNT }, (_, idx) => normalizeLeaderReplacement(items[matches[0]].replacements[idx])),
        entry
      });
      usedItemIndexes.add(matches[0]);
    });

    const ungrouped = items.filter((_, idx) => !usedItemIndexes.has(idx));
    return { groups, ungrouped };
  }

  function makeEmptyLeaderGroup(entry) {
    return {
      leaderName: getLeaderAliasSource(entry),
      civName: normalizeText(entry && entry.name),
      replacements: makeEmptyLeaderReplacements(),
      entry: entry || null
    };
  }

  function serializeLeaderAliasEditorModel(model) {
    const items = [];
    (Array.isArray(model && model.groups) ? model.groups : []).forEach((group) => {
      const source = normalizeText(group && group.leaderName);
      const replacements = trimLeaderReplacementList(group && group.replacements);
      if (source && replacements.length > 0) items.push({ source, replacements });
    });
    (Array.isArray(model && model.ungrouped) ? model.ungrouped : []).forEach((item) => {
      items.push({
        source: normalizeText(item && item.source),
        replacements: trimLeaderReplacementList(item && item.replacements)
      });
    });
    return serializeLeaderAliasesByEra(items);
  }

  return {
    ERA_ALIAS_COUNT,
    SOURCE_KINDS,
    parseCivAliasesByEra,
    serializeCivAliasesByEra,
    parseLeaderAliasesByEra,
    serializeLeaderAliasesByEra,
    getCivilizationAliasSources,
    getLeaderAliasSource,
    buildCivAliasEditorModel,
    makeEmptyGroup,
    serializeCivAliasEditorModel,
    buildLeaderAliasEditorModel,
    makeEmptyLeaderGroup,
    serializeLeaderAliasEditorModel
  };
}));
