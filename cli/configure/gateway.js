/**
 * OpenClaw gateway detection and configuration.
 * Reads from ~/.openclaw/openclaw.json; falls back to manual entry.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const prompts = require('./prompts');
const env = require('./env');

const DEFAULT_OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');

function readOpenClawConfig(openclawDir) {
  try {
    const configPath = path.join(openclawDir, 'openclaw.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function detectFromDir(openclawDir) {
  const config = readOpenClawConfig(openclawDir);
  if (!config) return null;

  const port = config.gateway?.port || 18789;
  const url = `ws://127.0.0.1:${port}`;
  const token = config.gateway?.auth?.token || '';

  return { url, token };
}

async function configureGateway(existingConfig) {
  prompts.heading('OpenClaw Gateway');

  const currentDir = existingConfig.openclawDir || DEFAULT_OPENCLAW_DIR;
  const detected = detectFromDir(currentDir);

  if (detected) {
    prompts.success(`OpenClaw config found at ${currentDir}`);
    prompts.info(`Gateway URL : ${detected.url}`);
    prompts.info(`Token       : ${detected.token ? '✓ configured' : '✗ not set'}`);
    console.log();

    const ok = await prompts.confirm('Use this configuration?', true);
    if (ok) return { openclawDir: currentDir, url: detected.url };
  } else {
    prompts.warn(`openclaw.json not found at ${currentDir}`);
  }

  // Ask for folder
  const altDir = await prompts.ask('OpenClaw folder', currentDir);
  const detectedAlt = detectFromDir(altDir);

  if (detectedAlt) {
    prompts.success(`Found config at ${altDir}`);
    prompts.info(`Gateway URL : ${detectedAlt.url}`);
    prompts.info(`Token       : ${detectedAlt.token ? '✓ configured' : '✗ not set'}`);
    return { openclawDir: altDir, url: detectedAlt.url };
  }

  // Manual fallback
  prompts.warn('Could not read openclaw.json — enter gateway details manually');
  const url = await prompts.ask('Gateway URL', 'ws://127.0.0.1:18789');
  const token = await prompts.askSecret('Gateway token');

  if (url) env.setKey('KNOWSPACE_GATEWAY_URL', url);
  if (token) env.setKey('KNOWSPACE_GATEWAY_TOKEN', token);
  if (url || token) prompts.success('Saved to ~/.knowspace/.env');

  return { openclawDir: altDir, url };
}

module.exports = {
  configureGateway,
  detectFromDir,
  DEFAULT_OPENCLAW_DIR,
};
