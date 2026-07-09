const fs = require('node:fs');
const path = require('node:path');

function resolveCiv3RootPath(civ3Path) {
  const target = String(civ3Path || '').trim();
  if (!target) return '';
  const base = path.basename(target).toLowerCase();
  return base === 'conquests' || base === 'civ3ptw' ? path.dirname(target) : target;
}

function listRecentCivAssistSaves(civ3Path, requestedLimit = 10) {
  const root = resolveCiv3RootPath(civ3Path);
  const savesDir = root ? path.join(root, 'Conquests', 'Saves') : '';
  const limit = Math.max(1, Math.min(50, Number.parseInt(requestedLimit, 10) || 10));
  if (!savesDir || !fs.existsSync(savesDir) || !fs.statSync(savesDir).isDirectory()) {
    return { ok: true, savesDir, saves: [] };
  }
  const saves = fs.readdirSync(savesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.sav$/i.test(entry.name))
    .map((entry) => {
      const filePath = path.join(savesDir, entry.name);
      try {
        const stat = fs.statSync(filePath);
        return {
          path: filePath,
          fileName: entry.name,
          modifiedMs: Number(stat.mtimeMs || 0),
          size: Number(stat.size || 0)
        };
      } catch (_err) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.modifiedMs - a.modifiedMs)
      || a.fileName.localeCompare(b.fileName, 'en', { sensitivity: 'base' }))
    .slice(0, limit);
  return { ok: true, savesDir, saves };
}

module.exports = {
  listRecentCivAssistSaves,
  resolveCiv3RootPath
};
