'use strict';

// Pure-JS drop-in replacement for the Java BiqBridge.
// Exports parseBiqBuffer and applyBiqEdits, matching the shape expected
// by runBiqBridgeOnInflatedBuffer / applyBiqReferenceEdits in configCore.js.

const {
  parseAllSections,
  applyEdits,
  sectionToEnglish,
  sectionWritableKeys,
  sectionRecordName,
} = require('./biqSections');

// Section display titles (informational only)
const SECTION_TITLES = {
  BLDG: 'Improvements & Wonders',
  CTZN: 'Citizens',
  CULT: 'Culture',
  DIFF: 'Difficulty Levels',
  ERAS: 'Eras',
  ESPN: 'Espionage',
  EXPR: 'Experience',
  GOOD: 'Resources',
  GOVT: 'Governments',
  RULE: 'Rules',
  PRTO: 'Units',
  RACE: 'Civilizations',
  TECH: 'Technologies',
  TFRM: 'Terrain Transformations',
  TERR: 'Terrain Types',
  WSIZ: 'Map Size',
  FLAV: 'Flavors',
  WCHR: 'World Parameters',
  WMAP: 'World Map',
  TILE: 'Tiles',
  CONT: 'Continents',
  SLOC: 'Starting Locations',
  CITY: 'Cities',
  UNIT: 'Units (Scenario)',
  CLNY: 'Colonies',
  GAME: 'Game Options',
  LEAD: 'Leaders',
};

/**
 * Parse a BIQ buffer and return the Java-bridge-compatible JSON structure.
 *
 * @param {Buffer} buffer - Inflated (decompressed) BIQ buffer
 * @returns {{ ok: true, sections: Array } | { ok: false, error: string }}
 */
function parseBiqBuffer(buffer, options = {}) {
  const parsed = parseAllSections(buffer, options);
  if (!parsed.ok) return { ok: false, error: parsed.error || 'BIQ parse failed' };

  const { sections, io } = parsed;
  const outSections = [];

  for (const section of sections) {
    const code = section.code;
    const wk = sectionWritableKeys(code);
    const records = (section.records || []).map((rec) => {
      const name = sectionRecordName(rec, code);
      let english;
      try {
        english = sectionToEnglish(rec, code, io);
      } catch (_e) {
        english = '';
      }
      return {
        index: rec.index != null ? rec.index : 0,
        name,
        english: english || '',
        writableBaseKeys: wk,
      };
    });

    outSections.push({
      code,
      title: SECTION_TITLES[code] || code,
      count: records.length,
      records,
    });
  }

  return { ok: true, sections: outSections };
}

/**
 * Apply edit operations to a BIQ buffer.
 *
 * @param {{ buffer: Buffer, edits: Array }} opts
 * @returns {{ ok: true, buffer: Buffer, applied: number, skipped: number, warning: string } | { ok: false, error: string }}
 */
function applyBiqEdits({ buffer, edits, textEncoding, allowSetmapGeneration = false }) {
  return applyEdits(buffer, edits, { textEncoding, allowSetmapGeneration });
}

module.exports = { parseBiqBuffer, applyBiqEdits };
