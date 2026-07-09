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
  const searchDirs = [
    { dir: savesDir, prefix: '' },
    { dir: path.join(savesDir, 'Auto'), prefix: 'Auto' }
  ].filter((item) => {
    try {
      return fs.existsSync(item.dir) && fs.statSync(item.dir).isDirectory();
    } catch (_err) {
      return false;
    }
  });
  const saves = searchDirs.flatMap(({ dir, prefix }) => fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.sav$/i.test(entry.name))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const relativeName = prefix ? path.join(prefix, entry.name) : entry.name;
      try {
        const stat = fs.statSync(filePath);
        return {
          path: filePath,
          fileName: entry.name,
          relativeName,
          modifiedMs: Number(stat.mtimeMs || 0),
          size: Number(stat.size || 0)
        };
      } catch (_err) {
        return null;
      }
    }))
    .filter(Boolean)
    .sort((a, b) => (b.modifiedMs - a.modifiedMs)
      || a.relativeName.localeCompare(b.relativeName, 'en', { sensitivity: 'base' }))
    .slice(0, limit);
  return { ok: true, savesDir, saves };
}

module.exports = {
  listRecentCivAssistSaves,
  resolveCiv3RootPath
};
