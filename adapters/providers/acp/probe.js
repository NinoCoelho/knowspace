/**
 * Availability probe for ACP agent recipes.
 *
 * For binaries in PATH (hermes, codex, custom paths) we do `which`.
 * For npx-based recipes we assume availability (npx will fetch on first
 * use — we don't want to pay that cost at probe time). The probe is
 * pessimistic: if we can't confirm, we report unavailable.
 *
 * Results are cached per-recipe-id for 5 minutes so repeated
 * /api/agents calls don't fork N processes each time.
 */

const { exec } = require('node:child_process');

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // id -> { at, available, detail }

function which(cmd) {
  return new Promise((resolve) => {
    // Absolute paths: just stat
    if (cmd && cmd.startsWith('/')) {
      require('node:fs').stat(cmd, (err, stat) => {
        if (err || !stat.isFile()) return resolve(null);
        resolve(cmd);
      });
      return;
    }
    exec(`command -v ${JSON.stringify(cmd)}`, { timeout: 2000 }, (err, stdout) => {
      if (err) return resolve(null);
      const path = String(stdout).trim().split('\n')[0];
      resolve(path || null);
    });
  });
}

async function probeRecipe(recipe) {
  if (!recipe || !recipe.cmd) return { available: false, reason: 'missing cmd' };

  // npx is practically always present (Node ships it). Treat npx recipes
  // as available so we don't block the happy path.
  if (recipe.cmd === 'npx') {
    return { available: true, reason: 'npx' };
  }

  const found = await which(recipe.cmd);
  if (!found) {
    return { available: false, reason: `\`${recipe.cmd}\` not in PATH` };
  }
  return { available: true, reason: `found at ${found}` };
}

async function probeWithCache(recipe) {
  const key = recipe.id;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return { available: hit.available, reason: hit.reason };
  const result = await probeRecipe(recipe);
  cache.set(key, { at: now, ...result });
  return result;
}

function clearCache() { cache.clear(); }

module.exports = { probeRecipe, probeWithCache, clearCache, _cacheForTest: cache };
