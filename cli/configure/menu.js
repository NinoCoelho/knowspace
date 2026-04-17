/**
 * Configuration menu — for subsequent runs after first setup.
 */

const prompts = require('./prompts');
const gateway = require('./gateway');
const vault = require('./vault');
const skills = require('./skills');
const env = require('./env');
const { loadConfig, saveConfig } = require('./state');
const AuthManager = require('../../middleware/auth');
const { DEFAULT_USER_SLUG } = require('../constants');

module.exports = async function menu() {
  const config = loadConfig();

  const configured = !!config.configuredAt;
  console.log(`\n  Knowspace — ${configured ? 'configured' : 'not configured'}\n`);

  while (true) {
    const currentBaseUrl = env.getKey('KNOWSPACE_BASE_URL') || config.baseUrl || 'http://localhost:3445';
    const options = [
      { label: 'Gateway (OpenClaw)', description: config.gatewayUrl || config.openclawDir || 'not set' },
      { label: 'Vault location', description: config.vaultPath || 'not set' },
      { label: 'Public URL', description: currentBaseUrl },
      { label: 'Access tokens', description: 'generate or list' },
      { label: 'Environment keys', description: 'view and update API keys' },
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

      case 2: { // Public URL
        prompts.heading('Public URL');
        prompts.info('Used in access token links (e.g. your Cloudflare Tunnel domain).');
        const newUrl = await prompts.ask('Public URL', currentBaseUrl);
        if (newUrl) {
          env.setKey('KNOWSPACE_BASE_URL', newUrl);
          config.baseUrl = newUrl;
          saveConfig(config);
          prompts.success(`Saved KNOWSPACE_BASE_URL=${newUrl}`);
        }
        break;
      }

      case 3: { // Tokens
        const auth = new AuthManager();
        const tokenOpts = [
          { label: 'List tokens' },
          { label: 'Generate new token' },
          { label: 'Rotate existing token' },
          { label: 'Back' },
        ];
        const tokenChoice = await prompts.select('Token management', tokenOpts);
        if (tokenChoice === 0) {
          const tokens = auth.listTokens();
          if (tokens.length === 0) {
            prompts.info('No tokens found');
          } else {
            for (const t of tokens) {
              const tag = t.clientSlug === DEFAULT_USER_SLUG ? '' : ` (${t.clientSlug})`;
              prompts.info(`created: ${t.createdAt}${tag}`);
            }
          }
        } else if (tokenChoice === 1 || tokenChoice === 2) {
          const baseUrl = env.getKey('KNOWSPACE_BASE_URL') || config.baseUrl || 'http://localhost:3445';
          const token = tokenChoice === 1
            ? auth.generateToken(DEFAULT_USER_SLUG)
            : auth.rotateToken(DEFAULT_USER_SLUG);
          if (!token) {
            prompts.warn('No existing token to rotate.');
          } else {
            prompts.success(`Token: ${token}`);
            prompts.info(`Sign in at ${baseUrl}/login`);
            prompts.info(`Or: ${baseUrl}/auth?token=${token}`);
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

      case 5: // Quit
        prompts.close();
        return;
    }
  }
};
