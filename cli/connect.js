/**
 * knowspace connect — configure the OpenClaw gateway connection.
 *
 * v2 note: skill installation (knowspace-onboard) was removed. With the
 * provider abstraction in place, agents are configured via
 * `knowspace agents add` and OpenClaw is just one of several providers.
 * This command now only handles the gateway link.
 */

const prompts = require('./configure/prompts');
const gateway = require('./configure/gateway');
const { loadConfig, saveConfig } = require('./configure/state');

module.exports = async function connect(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  knowspace connect — Configure the OpenClaw gateway connection

  Usage:
    knowspace connect

  What it does:
    1. Detects or prompts for OpenClaw gateway config (~/.openclaw/openclaw.json)
    2. Saves connection settings to ~/.knowspace/.env if needed

  For agent registration, use:
    knowspace providers list
    knowspace agents add <id> --cmd <binary> [--kind coder] [--cwd <path>]

  Run without arguments — fully interactive.
`);
    return;
  }

  console.log('\n  ╭─────────────────────────────────────────╮');
  console.log('  │  Knowspace → OpenClaw Connect           │');
  console.log('  ╰─────────────────────────────────────────╯');

  const config = loadConfig();
  const gw = await gateway.configureGateway(config);
  if (!gw) {
    prompts.warn('Cancelled');
    prompts.close();
    return;
  }
  config.openclawDir = gw.openclawDir;
  config.gatewayUrl = gw.url;
  saveConfig({ ...config, configured: config.configured ?? false });

  console.log('\n  ✓ Gateway configured\n');
  prompts.close();
};
