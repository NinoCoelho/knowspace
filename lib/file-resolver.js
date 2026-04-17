/**
 * File-path resolution for the chat preview / raw endpoints.
 *
 * Agents emit paths in several conventions interchangeably:
 *
 *   /Users/x/Vault/Briefs/foo.md     (real absolute)
 *   ~/Vault/Briefs/foo.md            (tilde-expanded)
 *   /Briefs/foo.md                   (looks absolute, actually vault-rooted)
 *   Briefs/foo.md                    (vault-relative)
 *   foo.md                           (basename only — guess by filename)
 *
 * resolve() walks the strategies in priority order and returns the
 * first hit, plus a `strategy` label so callers can surface which
 * heuristic matched (useful for debugging mismatches).
 *
 * Safety: every resolved path must sit under $HOME after symlink
 * resolution. Anything that escapes ($HOME) is treated as not-found
 * rather than 403, so an attacker can't use the resolver to probe
 * the filesystem.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = (() => { try { return fs.realpathSync(os.homedir()); } catch { return os.homedir(); } })();

function isInsideHome(absResolved) {
  return absResolved === HOME || absResolved.startsWith(HOME + path.sep);
}

function tryFile(p) {
  try {
    const real = fs.realpathSync(p);
    if (!isInsideHome(real)) return null;
    const stat = fs.statSync(real);
    if (!stat.isFile()) return null;
    return real;
  } catch { return null; }
}

function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Walk the vault looking for files whose basename matches the target.
// Stops at the first level where there's a unique hit (avoids returning
// the wrong file when the same basename exists in multiple subdirs).
function findByBasename(vaultBase, basename) {
  if (!vaultBase || !fs.existsSync(vaultBase)) return null;
  const matches = [];
  const stack = [vaultBase];
  const SKIP = new Set(['.git', '.obsidian', 'node_modules', '.DS_Store']);
  while (stack.length && matches.length < 5) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === basename) matches.push(full);
    }
  }
  if (matches.length !== 1) return null; // ambiguous or missing
  return tryFile(matches[0]);
}

/**
 * @param {string} requested - the path string emitted by the agent
 * @param {string} vaultBase - resolved vault root (or '' if unset)
 * @returns {{ path: string, strategy: string } | null}
 */
function resolve(requested, vaultBase) {
  if (!requested || typeof requested !== 'string') return null;

  // 1. Tilde expansion + try as absolute
  const expanded = expandTilde(requested);
  if (path.isAbsolute(expanded)) {
    const hit = tryFile(expanded);
    if (hit) return { path: hit, strategy: requested.startsWith('~') ? 'tilde' : 'absolute' };
  }

  // 2. If vault is configured: try vault-rooted-absolute (strip leading /)
  //    then plain vault-relative.
  if (vaultBase) {
    if (path.isAbsolute(expanded)) {
      const stripped = expanded.replace(/^\/+/, '');
      const candidate = path.join(vaultBase, stripped);
      const hit = tryFile(candidate);
      if (hit) return { path: hit, strategy: 'vault-rooted' };
    } else {
      const candidate = path.join(vaultBase, expanded);
      const hit = tryFile(candidate);
      if (hit) return { path: hit, strategy: 'vault-relative' };
    }

    // 3. Last resort: search vault for a file with this basename. Only
    //    accept a unique match.
    const base = path.basename(requested);
    if (base && base !== requested) {
      const hit = findByBasename(vaultBase, base);
      if (hit) return { path: hit, strategy: 'vault-basename' };
    } else {
      // requested IS just a basename
      const hit = findByBasename(vaultBase, base);
      if (hit) return { path: hit, strategy: 'vault-basename' };
    }
  }

  return null;
}

module.exports = { resolve, isInsideHome, _findByBasename: findByBasename };
