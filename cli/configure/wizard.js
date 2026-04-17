/**
 * First-run wizard — connects to OpenClaw gateway (optional), sets the
 * vault path, captures the public URL, and generates an access token.
 *
 * v2 is single-user: no "Client slug" prompt, no multi-tenant
 * onboarding steps. The auth layer uses a fixed default slug
 * internally (see cli/constants.js).
 */

const prompts = require('./prompts');
const gateway = require('./gateway');
const vault = require('./vault');
const env = require('./env');
const { loadConfig, saveConfig } = require('./state');
const AuthManager = require('../../middleware/auth');
const { DEFAULT_USER_SLUG } = require('../constants');

module.exports = async function wizard() {
  console.log('\n  ╭──────────────────────────────────────────╮');
  console.log('  │  Welcome to Knowspace! Let\'s set up.     │');
  console.log('  ╰──────────────────────────────────────────╯');

  const config = loadConfig();

  // Step 1 — OpenClaw gateway (optional — skip if user doesn't use OpenClaw)
  console.log('\n  Step 1/3 — OpenClaw Gateway (optional)\n');
  prompts.info('Knowspace v2 can run without OpenClaw. Leave the fields blank to skip.');
  const gw = await gateway.configureGateway(config);
  if (gw) {
    config.openclawDir = gw.openclawDir;
    config.gatewayUrl = gw.url;
  }

  // Step 2 — Vault location
  console.log('\n  Step 2/3 — Vault\n');
  config.vaultPath = await vault.configureVault(config);

  // Step 3 — Public URL + Access Token
  console.log('\n  Step 3/3 — Access\n');
  prompts.info('The public URL is used for access token links (e.g. your Cloudflare Tunnel domain).');
  const defaultPort = process.env.KNOWSPACE_PORT || '3445';
  const currentBaseUrl = env.getKey('KNOWSPACE_BASE_URL') || config.baseUrl || `http://localhost:${defaultPort}`;
  const baseUrl = await prompts.ask('Public URL', currentBaseUrl);
  if (baseUrl && baseUrl !== `http://localhost:${defaultPort}`) {
    env.setKey('KNOWSPACE_BASE_URL', baseUrl);
    prompts.success(`Saved KNOWSPACE_BASE_URL=${baseUrl}`);
  }
  config.baseUrl = baseUrl;

  const auth = new AuthManager();
  const slug = DEFAULT_USER_SLUG;
  const existing = auth.listTokens().find(t => t.clientSlug === slug);
  if (existing) {
    prompts.info('Access token already exists.');
    prompts.info(`Sign in at ${baseUrl}/login (use 'knowspace tokens list' to review).`);
  } else {
    const token = auth.generateToken(slug);
    prompts.success('Access token generated.');
    prompts.info(`Sign in at ${baseUrl}/login`);
    prompts.info(`Or share the one-click link: ${baseUrl}/auth?token=${token}`);
  }

  config.configured = true;
  config.configuredAt = new Date().toISOString();
  saveConfig(config);

  console.log('\n  ✓ Configuration saved to ~/.knowspace/config.json\n');
  prompts.close();
};
