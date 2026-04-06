/**
 * First-run wizard — connects to OpenClaw gateway, sets vault path, generates token.
 */

const prompts = require('./prompts');
const gateway = require('./gateway');
const vault = require('./vault');
const { loadConfig, saveConfig } = require('./state');
const AuthManager = require('../../middleware/auth');

module.exports = async function wizard() {
  console.log('\n  ╭─────────────────────────────────────────╮');
  console.log('  │  Welcome to Knowspace! Let\'s set up.    │');
  console.log('  ╰─────────────────────────────────────────╯');

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
  console.log('\n  Step 2/3 — Vault');
  config.slug = config.slug || 'main';
  config.vaultPath = await vault.configureVault(config);

  // Step 3 — Access token
  console.log('\n  Step 3/3 — Access Token\n');
  const auth = new AuthManager();
  const slug = 'main';
  const existing = auth.listTokens().find(t => t.clientSlug === slug);
  if (existing) {
    prompts.info(`Token already exists for "${slug}"`);
    const baseUrl = process.env.KNOWSPACE_BASE_URL || 'http://localhost:3445';
    prompts.info(`Access: ${baseUrl}/auth?token=<your-token>`);
    prompts.info(`(Use "knowspace tokens list" or "knowspace configure" → Access tokens to view it)`);
  } else {
    const token = auth.generateToken(slug);
    const baseUrl = process.env.KNOWSPACE_BASE_URL || 'http://localhost:3445';
    prompts.success(`Token generated for "${slug}"`);
    prompts.info(`Access: ${baseUrl}/auth?token=${token}`);
  }

  config.configured = true;
  config.configuredAt = new Date().toISOString();
  saveConfig(config);

  console.log('\n  ✓ Configuration saved to ~/.knowspace/config.json\n');
  prompts.close();
};
