/**
 * .env file reader/writer for managing API keys.
 * Reads/writes to both ~/.knowspace/.env and ~/.openclaw/.env
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const KNOWSPACE_ENV = path.join(os.homedir(), '.knowspace', '.env');
const OPENCLAW_ENV = path.join(os.homedir(), '.openclaw', '.env');

function readEnv(envPath) {
  const vars = {};
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  } catch {
    // File doesn't exist yet
  }
  return vars;
}

function writeEnv(envPath, vars) {
  // Read existing to preserve comments and order
  let lines = [];
  try {
    lines = fs.readFileSync(envPath, 'utf8').split('\n');
  } catch {
    // New file
  }

  const written = new Set();
  const updated = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key in vars) {
      written.add(key);
      return `${key}=${vars[key]}`;
    }
    return line;
  });

  // Append new keys not already in file
  for (const [key, value] of Object.entries(vars)) {
    if (!written.has(key)) {
      updated.push(`${key}=${value}`);
    }
  }

  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(envPath, updated.join('\n') + '\n');
}

function getKey(key) {
  // Check knowspace env first, then openclaw, then process.env
  const ksVars = readEnv(KNOWSPACE_ENV);
  if (ksVars[key]) return ksVars[key];

  const ocVars = readEnv(OPENCLAW_ENV);
  if (ocVars[key]) return ocVars[key];

  return process.env[key] || '';
}

function setKey(key, value) {
  // Write to both locations
  const ksVars = readEnv(KNOWSPACE_ENV);
  ksVars[key] = value;
  writeEnv(KNOWSPACE_ENV, ksVars);

  const ocVars = readEnv(OPENCLAW_ENV);
  ocVars[key] = value;
  writeEnv(OPENCLAW_ENV, ocVars);
}

function syncEnv() {
  // Copy all keys from ~/.knowspace/.env to ~/.openclaw/.env
  const ksVars = readEnv(KNOWSPACE_ENV);
  if (Object.keys(ksVars).length === 0) return;

  const ocVars = readEnv(OPENCLAW_ENV);
  let changed = false;
  for (const [key, value] of Object.entries(ksVars)) {
    if (ocVars[key] !== value) {
      ocVars[key] = value;
      changed = true;
    }
  }
  if (changed) {
    writeEnv(OPENCLAW_ENV, ocVars);
  }
}

module.exports = {
  readEnv,
  writeEnv,
  getKey,
  setKey,
  syncEnv,
  KNOWSPACE_ENV,
  OPENCLAW_ENV,
};
