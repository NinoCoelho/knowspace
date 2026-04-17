const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_PATH = process.env.KNOWSPACE_PROVIDERS_FILE
  || path.join(os.homedir(), '.knowspace', 'providers.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return { providers: {} };
    throw err;
  }
}

function saveConfig(cfg) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function ensure(cfg, providerId) {
  cfg.providers = cfg.providers || {};
  cfg.providers[providerId] = cfg.providers[providerId] || {};
  return cfg.providers[providerId];
}

module.exports = async function providers(argv) {
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`
  knowspace providers - Manage portal providers

  Usage:
    knowspace providers list              Show registered providers and their status
    knowspace providers enable <id>       Enable a provider (default for all known)
    knowspace providers disable <id>      Disable a provider
    knowspace providers path              Print the path to providers.json

  Built-in providers:
    openclaw    OpenClaw gateway
    acp         Agent Client Protocol (Claude Code, Hermes, Codex, ...)

  Config file: ${CONFIG_PATH}
`);
    return;
  }

  switch (sub) {
    case 'path': {
      console.log(CONFIG_PATH);
      return;
    }

    case 'list': {
      // Loading the registry runs the config side-effects, so the
      // listing reflects the actual runtime state.
      const registry = require('../adapters/providers');
      const cfg = loadConfig();
      const list = registry.listProviders();
      const known = new Set(list.map(p => p.id));
      // Also surface providers that the config knows about but which
      // aren't loaded (e.g. disabled).
      for (const id of Object.keys(cfg.providers || {})) known.add(id);

      console.log('\n  Providers:\n');
      for (const id of known) {
        const enabled = cfg.providers?.[id]?.enabled !== false;
        const loaded = list.find(p => p.id === id);
        const cap = loaded ? Object.entries(loaded.capabilities || {})
          .filter(([, v]) => v && typeof v !== 'object')
          .map(([k]) => k).join(', ') : '';
        const tag = loaded ? '[loaded]' : '[disabled]';
        const flag = enabled ? '✓' : '✗';
        console.log(`  ${flag} ${id.padEnd(12)} ${tag.padEnd(11)} ${cap}`);
      }
      console.log();
      return;
    }

    case 'enable':
    case 'disable': {
      const id = argv[1];
      if (!id) {
        console.error(`Usage: knowspace providers ${sub} <id>`);
        process.exit(1);
      }
      const cfg = loadConfig();
      ensure(cfg, id).enabled = (sub === 'enable');
      saveConfig(cfg);
      console.log(`Provider "${id}" ${sub}d. Restart the server to apply.`);
      return;
    }

    default:
      console.error(`Unknown subcommand: ${sub}`);
      console.error('Run knowspace providers --help for usage.');
      process.exit(1);
  }
};

module.exports._configPath = CONFIG_PATH;
module.exports._loadConfig = loadConfig;
module.exports._saveConfig = saveConfig;
