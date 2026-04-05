/**
 * Vault location configuration.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const prompts = require('./prompts');

function getDefaultVaultPath(slug) {
  return path.join(os.homedir(), slug, 'workspace', 'vault');
}

async function configureVault(config) {
  prompts.heading('Vault location');

  const defaultPath = getDefaultVaultPath(config.slug || 'main');
  const currentPath = config.vaultPath || defaultPath;

  const vaultPath = await prompts.ask('Vault path', currentPath);

  if (!fs.existsSync(vaultPath)) {
    const create = await prompts.confirm(`${vaultPath} does not exist. Create it?`, true);
    if (create) {
      fs.mkdirSync(vaultPath, { recursive: true });
      // Create standard subdirectories
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
