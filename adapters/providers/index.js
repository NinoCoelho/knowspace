/**
 * Provider registry — single entry point for all backends.
 *
 * Loads built-in providers and exposes lookups by id. Future providers
 * (`acp`, etc.) register here. Configuration of which providers to enable
 * lives in ~/.knowspace/providers.json (loaded lazily where needed).
 */

const openclaw = require('./openclaw');
const acp = require('./acp');

/** @type {Map<string, import('./types').Provider>} */
const providers = new Map();
providers.set(openclaw.provider.id, openclaw.provider);
providers.set(acp.provider.id, acp.provider);

const DEFAULT_PROVIDER_ID = 'openclaw';

function getProvider(id) {
  const p = providers.get(id || DEFAULT_PROVIDER_ID);
  if (!p) throw new Error(`unknown provider: ${id}`);
  return p;
}

function listProviders() {
  return Array.from(providers.values());
}

function registerProvider(provider) {
  if (!provider || !provider.id) throw new Error('provider must have an id');
  providers.set(provider.id, provider);
}

function getDefaultProvider() {
  return getProvider(DEFAULT_PROVIDER_ID);
}

function unregisterProvider(id) {
  return providers.delete(id);
}

const registry = {
  DEFAULT_PROVIDER_ID,
  getProvider,
  listProviders,
  registerProvider,
  unregisterProvider,
  getDefaultProvider,
  // Back-compat: legacy `engine` shape used by server.js, routes/api.js, etc.
  // Keeps existing code working while we migrate call sites incrementally.
  engine: openclaw,
};

// Apply ~/.knowspace/providers.json overrides at module load time so the
// rest of the app sees the configured set. Loading is best-effort —
// missing or malformed files leave the defaults in place.
try {
  const config = require('./config');
  config.applyConfig(registry);
} catch (err) {
  console.warn(`[providers] config load failed: ${err.message}`);
}

module.exports = registry;
