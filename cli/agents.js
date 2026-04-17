const providers = require('./providers');

function loadConfig() { return providers._loadConfig(); }
function saveConfig(cfg) { return providers._saveConfig(cfg); }

function ensureAcpAgentsMap(cfg) {
  cfg.providers = cfg.providers || {};
  cfg.providers.acp = cfg.providers.acp || {};
  cfg.providers.acp.agents = cfg.providers.acp.agents || {};
  return cfg.providers.acp.agents;
}

// Flags that take a value (everything else is boolean).
const VALUE_FLAGS = new Set(['name', 'kind', 'cmd', 'args', 'cwd', 'description', 'provider']);

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (VALUE_FLAGS.has(key)) {
      flags[key] = argv[i + 1];
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

module.exports = async function agents(argv) {
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`
  knowspace agents - Manage configured agents

  Usage:
    knowspace agents list [--provider <id>]    List agents, optionally filtered
    knowspace agents add <id> [options]        Register a new ACP agent
    knowspace agents remove <id>               Remove an ACP agent override
    knowspace agents show <id>                 Print the resolved recipe for an agent

  Options for "add":
    --name <display name>          Human-readable name (default: id)
    --kind chat|coder              Default: chat
    --cmd <binary>                 Command to launch the ACP server (required)
    --args <space-separated>       Args passed to the binary
    --cwd <path>                   Default working directory (coders)
    --description <text>           Optional description

  Examples:
    knowspace agents list
    knowspace agents list --provider acp
    knowspace agents add my-coder --cmd /usr/local/bin/acp-server --args "--mode coder" --kind coder
    knowspace agents remove my-coder
`);
    return;
  }

  switch (sub) {
    case 'list': {
      const flags = parseFlags(argv.slice(1));
      const registry = require('../adapters/providers');
      const targets = flags.provider
        ? [registry.getProvider(flags.provider)]
        : registry.listProviders();
      console.log('');
      for (const p of targets) {
        try {
          const list = await p.listAgents();
          console.log(`  [${p.id}]`);
          if (list.length === 0) {
            console.log('    (none)');
          } else {
            for (const a of list) {
              const desc = a.description ? ` — ${a.description}` : '';
              const cwd = a.defaultCwd ? `  cwd=${a.defaultCwd}` : '';
              console.log(`    ${a.id.padEnd(18)} ${a.kind.padEnd(6)} ${a.name}${desc}${cwd}`);
            }
          }
          console.log('');
        } catch (err) {
          console.error(`  [${p.id}] error: ${err.message}`);
        }
      }
      return;
    }

    case 'add': {
      const id = argv[1];
      const flags = parseFlags(argv.slice(2));
      if (!id) {
        console.error('Usage: knowspace agents add <id> --cmd <binary> [options]');
        process.exit(1);
      }
      if (!flags.cmd) {
        console.error('--cmd is required (the binary that launches the ACP server)');
        process.exit(1);
      }
      const cfg = loadConfig();
      const map = ensureAcpAgentsMap(cfg);
      // Only write fields the user actually provided, so this composes
      // sensibly when overriding a builtin recipe.
      const entry = { cmd: flags.cmd };
      if (flags.name)        entry.name = flags.name;
      if (flags.kind)        entry.kind = flags.kind;
      if (flags.args)        entry.args = flags.args.split(/\s+/);
      if (flags.cwd)         entry.defaultCwd = flags.cwd;
      if (flags.description) entry.description = flags.description;
      map[id] = entry;
      saveConfig(cfg);
      console.log(`Agent "${id}" added. Restart the server to apply.`);
      return;
    }

    case 'remove': {
      const id = argv[1];
      if (!id) {
        console.error('Usage: knowspace agents remove <id>');
        process.exit(1);
      }
      const cfg = loadConfig();
      const map = ensureAcpAgentsMap(cfg);
      if (!map[id]) {
        console.error(`No override registered for "${id}".`);
        process.exit(1);
      }
      delete map[id];
      saveConfig(cfg);
      console.log(`Agent override "${id}" removed. Restart the server to apply.`);
      return;
    }

    case 'show': {
      const id = argv[1];
      if (!id) {
        console.error('Usage: knowspace agents show <id>');
        process.exit(1);
      }
      const cfg = loadConfig();
      const acpAgents = require('../adapters/providers/acp/agents');
      const overrides = cfg.providers?.acp?.agents || {};
      const recipe = acpAgents.recipeById(id, overrides);
      if (!recipe) {
        console.error(`Unknown agent "${id}".`);
        process.exit(1);
      }
      console.log(JSON.stringify(recipe, null, 2));
      return;
    }

    default:
      console.error(`Unknown subcommand: ${sub}`);
      console.error('Run knowspace agents --help for usage.');
      process.exit(1);
  }
};
