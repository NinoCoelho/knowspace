/**
 * Vault location configuration.
 *
 * v2 default lives at ~/.knowspace/vault. Legacy multi-tenant layout
 * (~/<slug>/workspace/vault) is still honored if a slug is already
 * configured, so existing deployments keep working.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const prompts = require('./prompts');
const { DEFAULT_USER_SLUG } = require('../constants');

function getDefaultVaultPath(config) {
  // v2 single-user default
  if (!config || !config.slug || config.slug === DEFAULT_USER_SLUG) {
    return path.join(os.homedir(), '.knowspace', 'vault');
  }
  // Legacy per-slug workspace layout
  return path.join(os.homedir(), config.slug, 'workspace', 'vault');
}

async function configureVault(config) {
  prompts.heading('Vault location');

  const defaultPath = getDefaultVaultPath(config);
  const currentPath = config.vaultPath || defaultPath;

  const vaultPath = await prompts.ask('Vault path', currentPath);

  if (!fs.existsSync(vaultPath)) {
    const create = await prompts.confirm(`${vaultPath} does not exist. Create it?`, true);
    if (create) {
      fs.mkdirSync(vaultPath, { recursive: true });
      for (const sub of ['uploads', 'kanban', 'notes', 'projects', 'assets']) {
        const subDir = path.join(vaultPath, sub);
        if (!fs.existsSync(subDir)) {
          fs.mkdirSync(subDir, { recursive: true });
        }
      }
      prompts.success(`Created vault at ${vaultPath}`);
    }
  } else {
    prompts.success(`Vault exists at ${vaultPath}`);
  }

  return vaultPath;
}

module.exports = {
  getDefaultVaultPath,
  configureVault,
};
