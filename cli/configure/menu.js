/**
 * Configuration menu — for subsequent runs after first setup.
 */

const prompts = require('./prompts');
const gateway = require('./gateway');
const workspace = require('./workspace');
const vault = require('./vault');
const skills = require('./skills');
const env = require('./env');
const { loadConfig, saveConfig } = require('./state');
const AuthManager = require('../../middleware/auth');

module.exports = async function menu() {
  const config = loadConfig();

  console.log(`\n  Knowspace — ${config.slug || 'not configured'}\n`);

  while (true) {
    const installed = (config.installedSkills || []).length;
    const options = [
      { label: 'Gateway', description: config.gatewayUrl || config.openclawDir || 'not set' },
      { label: 'Vault location', description: config.vaultPath || 'not set' },
      { label: 'Skills', description: `${installed} installed` },
      { label: 'Access tokens', description: 'generate or list' },
      { label: 'Environment keys', description: 'view and update API keys' },
      { label: 'Workspace templates', description: 'SOUL, USER, AGENTS, IDENTITY' },
      { label: 'Quit' },
    ];

    const choice = await prompts.select('What would you like to configure?', options);

    switch (choice) {
      case 0: { // Gateway
        const gw = await gateway.configureGateway(config);
        if (gw) {
          config.openclawDir = gw.openclawDir;
          config.gatewayUrl = gw.url;
          saveConfig(config);
        }
        break;
      }

      case 1: { // Vault
        config.vaultPath = await vault.configureVault(config);
        saveConfig(config);
        break;
      }

      case 2: { // Skills
        config.installedSkills = await skills.interactiveSkillSetup(config);
        saveConfig(config);
        break;
      }

      case 3: { // Tokens
        const auth = new AuthManager();
        const tokenOpts = [
          { label: 'List tokens' },
          { label: 'Generate new token' },
          { label: 'Back' },
        ];
        const tokenChoice = await prompts.select('Token management', tokenOpts);
        if (tokenChoice === 0) {
          const tokens = auth.listTokens();
          if (tokens.length === 0) {
            prompts.info('No tokens found');
          } else {
            for (const t of tokens) {
              prompts.info(`${t.clientSlug.padEnd(24)} created: ${t.createdAt}`);
            }
          }
        } else if (tokenChoice === 1) {
          const slug = await prompts.ask('Client slug', config.slug || '');
          if (slug) {
            const token = auth.generateToken(slug);
            const baseUrl = process.env.KNOWSPACE_BASE_URL || 'http://localhost:3445';
            prompts.success(`Token: ${token}`);
            prompts.info(`Link: ${baseUrl}/auth?token=${token}`);
          }
        }
        break;
      }

      case 4: { // Environment
        prompts.heading('Environment keys');
        const ksVars = env.readEnv(env.KNOWSPACE_ENV);
        const keys = Object.keys(ksVars);
        if (keys.length === 0) {
          prompts.info('No keys configured yet. Install skills to add keys.');
        } else {
          for (const key of keys) {
            const val = ksVars[key];
            const masked = val.length > 12 ? val.substring(0, 8) + '...' + val.substring(val.length - 4) : val;
            prompts.info(`${key.padEnd(30)} ${masked}`);
          }
          console.log();
          const update = await prompts.confirm('Update a key?', false);
          if (update) {
            const keyName = await prompts.ask('Key name');
            if (keyName) {
              const value = await prompts.askSecret(`New value for ${keyName}`);
              if (value) {
                env.setKey(keyName, value);
                prompts.success(`${keyName} updated`);
              }
            }
          }
        }
        break;
      }

      case 5: { // Workspace templates
        const info = await workspace.setupWorkspace(config);
        if (info) {
          config.slug = info.slug;
          config.clientName = info.clientName;
          config.agentName = info.agentName;
          config.timezone = info.timezone;
          config.businessContext = info.businessContext;
          config.vibeDescription = info.vibeDescription;
          saveConfig(config);
        }
        break;
      }

      case 6: // Quit
        prompts.close();
        return;
    }
  }
};
