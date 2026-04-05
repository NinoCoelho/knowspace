/**
 * First-run wizard — sequential setup of workspace, vault, skills, and token.
 */

const prompts = require('./prompts');
const workspace = require('./workspace');
const vault = require('./vault');
const skills = require('./skills');
const { loadConfig, saveConfig } = require('./state');
const AuthManager = require('../../middleware/auth');

module.exports = async function wizard() {
  console.log('\n  ╭─────────────────────────────────────────╮');
  console.log('  │  Welcome to Knowspace! Let\'s set up.    │');
  console.log('  ╰─────��──────────────────────────���────────╯');

  const config = loadConfig();

  // Step 1 — Workspace
  console.log('\n  Step 1/4 — Workspace\n');
  const info = await workspace.setupWorkspace(config);
  if (!info) {
    prompts.warn('Setup cancelled');
    prompts.close();
    return;
  }
  config.slug = info.slug;
  config.clientName = info.clientName;
  config.agentName = info.agentName;
  config.timezone = info.timezone;
  config.businessContext = info.businessContext;
  config.vibeDescription = info.vibeDescription;

  // Step 2 — Vault
  console.log('\n  Step 2/4 — Vault');
  config.vaultPath = await vault.configureVault(config);

  // Step 3 — Skills
  console.log('\n  Step 3/4 — Skills');
  config.installedSkills = await skills.interactiveSkillSetup(config);

  // Step 4 — Access token
  console.log('\n  Step 4/4 — Access Token\n');
  const auth = new AuthManager();
  const existing = auth.listTokens().find(t => t.clientSlug === config.slug);
  if (existing) {
    prompts.info(`Token already exists for ${config.slug}`);
  } else {
    const token = auth.generateToken(config.slug);
    const baseUrl = process.env.KNOWSPACE_BASE_URL || 'http://localhost:3445';
    prompts.success(`Token generated for ${config.slug}`);
    prompts.info(`Access: ${baseUrl}/auth?token=${token}`);
  }

  // Save
  config.configured = true;
  config.configuredAt = new Date().toISOString();
  saveConfig(config);

  console.log('\n  ✓ Configuration saved to ~/.knowspace/config.json\n');
  prompts.close();
};
