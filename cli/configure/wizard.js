/**
 * First-run wizard — connects to OpenClaw gateway, sets vault path, generates token.
 */

const prompts = require('./prompts');
const gateway = require('./gateway');
const vault = require('./vault');
const env = require('./env');
const { loadConfig, saveConfig } = require('./state');
const AuthManager = require('../../middleware/auth');

module.exports = async function wizard() {
  console.log('\n  ╭──────────────────────────────────────────╮');
  console.log('  │  Welcome to Knowspace! Let\'s set up.     │');
  console.log('  ╰──────────────────────────────────────────╯');

  const config = loadConfig();

  // Step 1 — OpenClaw gateway
  console.log('\n  Step 1/3 — OpenClaw Gateway\n');
  const gw = await gateway.configureGateway(config);
  if (!gw) {
    prompts.warn('Setup cancelled');
    prompts.close();
    return;
  }
  config.openclawDir = gw.openclawDir;
  config.gatewayUrl = gw.url;

  // Step 2 — Vault location
  console.log('\n  Step 2/4 — Vault');
  config.slug = config.slug || 'main';
  config.vaultPath = await vault.configureVault(config);

  // Step 3 — Public URL
  console.log('\n  Step 3/4 — Public URL\n');
  prompts.info('The public URL is used to generate access links (e.g. your Cloudflare Tunnel domain).');
  const defaultPort = process.env.KNOWSPACE_PORT || '3445';
  const currentBaseUrl = env.getKey('KNOWSPACE_BASE_URL') || config.baseUrl || `http://localhost:${defaultPort}`;
  const baseUrl = await prompts.ask('Public URL', currentBaseUrl);
  if (baseUrl && baseUrl !== `http://localhost:${defaultPort}`) {
    env.setKey('KNOWSPACE_BASE_URL', baseUrl);
    prompts.success(`Saved KNOWSPACE_BASE_URL=${baseUrl}`);
  }
  config.baseUrl = baseUrl;

  // Step 4 — Access token
  console.log('\n  Step 4/4 — Access Token\n');
  const auth = new AuthManager();
  const slug = 'main';
  const existing = auth.listTokens().find(t => t.clientSlug === slug);
  if (existing) {
    prompts.info(`Token already exists for "${slug}"`);
    prompts.info(`Access: ${baseUrl}/auth?token=<your-token>`);
    prompts.info(`(Use "knowspace tokens list" or "knowspace configure" → Access tokens to view it)`);
  } else {
    const token = auth.generateToken(slug);
    prompts.success(`Token generated for "${slug}"`);
    prompts.info(`Access: ${baseUrl}/auth?token=${token}`);
  }

  config.configured = true;
  config.configuredAt = new Date().toISOString();
  saveConfig(config);

  console.log('\n  ✓ Configuration saved to ~/.knowspace/config.json\n');
  prompts.close();
};
