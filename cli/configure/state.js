/**
 * Knowspace configuration state (~/.knowspace/config.json)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.knowspace');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {
    // corrupted or missing
  }
  return {};
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

function isFirstRun() {
  const config = loadConfig();
  return !config.configured;
}

module.exports = {
  loadConfig,
  saveConfig,
  isFirstRun,
  CONFIG_DIR,
  CONFIG_FILE,
};
