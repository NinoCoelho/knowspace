/**
 * Provider configuration loader.
 *
 * Reads ~/.knowspace/providers.json and applies it to the registered
 * providers. The file is optional; defaults are sensible enough that
 * Knowspace works out of the box (OpenClaw enabled, ACP enabled with
 * the three built-in recipes).
 *
 * Schema:
 *
 *   {
 *     "providers": {
 *       "openclaw": { "enabled": true },
 *       "acp": {
 *         "enabled": true,
 *         "agents": {
 *           "claude-code": { "name": "Claude" },                  // override builtin
 *           "my-coder": {                                          // brand new
 *             "name": "My Coder",
 *             "kind": "coder",
 *             "cmd": "/path/to/binary",
 *             "args": ["--acp"],
 *             "defaultCwd": "~/Code/proj"
 *           }
 *         }
 *       }
 *     }
 *   }
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PATH = path.join(os.homedir(), '.knowspace', 'providers.json');

function getConfigPath() {
  return process.env.KNOWSPACE_PROVIDERS_FILE || DEFAULT_PATH;
}

function loadConfig() {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.warn(`[providers] failed to load ${configPath}: ${err.message}`);
    return null;
  }
}

function isEnabled(config, providerId) {
  if (!config?.providers) return true;
  const entry = config.providers[providerId];
  if (!entry) return true; // present-but-not-mentioned defaults to enabled
  return entry.enabled !== false;
}

function getAcpOverrides(config) {
  return config?.providers?.acp?.agents || {};
}

/**
 * Apply the loaded config to the registry. Currently:
 *   - sets ACP recipe overrides
 *   - removes disabled providers from the registry
 */
function applyConfig(registry, config = loadConfig()) {
  if (!config) return { applied: false, reason: 'no config file' };

  // Apply ACP recipe overrides
  try {
    const acp = require('./acp');
    acp.setRecipeOverrides(getAcpOverrides(config));
  } catch (err) {
    console.warn(`[providers] could not apply ACP overrides: ${err.message}`);
  }

  // Remove disabled providers
  for (const p of registry.listProviders()) {
    if (!isEnabled(config, p.id)) {
      registry.unregisterProvider?.(p.id);
    }
  }

  return { applied: true, configPath: getConfigPath() };
}

module.exports = {
  getConfigPath,
  loadConfig,
  applyConfig,
  isEnabled,
  getAcpOverrides,
  DEFAULT_PATH,
};
