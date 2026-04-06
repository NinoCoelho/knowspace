/**
 * macOS launchd daemon management for the Knowspace server.
 * Manages ~/Library/LaunchAgents/com.knowspace.server.plist
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const LABEL = 'com.knowspace.server';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), '.knowspace');
const LOG_FILE = path.join(LOG_DIR, 'knowspace.log');
const ERROR_LOG = path.join(LOG_DIR, 'knowspace.error.log');

function buildPlist(nodeBin, serverJs, env) {
  const envKeys = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `    <key>${k}</key>\n    <string>${v}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${serverJs}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envKeys}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${ERROR_LOG}</string>
</dict>
</plist>
`;
}

function isLoaded() {
  const r = spawnSync('launchctl', ['list', LABEL], { encoding: 'utf8' });
  return r.status === 0;
}

function install(nodeBin, serverJs, env) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const dir = path.dirname(PLIST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(PLIST_PATH, buildPlist(nodeBin, serverJs, env));

  if (isLoaded()) execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'pipe' });
  execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: 'pipe' });
}

function uninstall() {
  if (isLoaded()) execSync(`launchctl unload -w "${PLIST_PATH}"`, { stdio: 'pipe' });
  if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
}

function start() {
  if (!fs.existsSync(PLIST_PATH)) throw new Error('Not installed. Run: knowspace daemon install');
  if (!isLoaded()) execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: 'pipe' });
  execSync(`launchctl start ${LABEL}`, { stdio: 'pipe' });
}

function stop() {
  if (!isLoaded()) throw new Error('Knowspace daemon is not running.');
  execSync(`launchctl stop ${LABEL}`, { stdio: 'pipe' });
}

function restart() {
  if (!fs.existsSync(PLIST_PATH)) throw new Error('Not installed. Run: knowspace daemon install');
  if (isLoaded()) execSync(`launchctl stop ${LABEL}`, { stdio: 'pipe' });
  execSync(`launchctl start ${LABEL}`, { stdio: 'pipe' });
}

function status() {
  if (!fs.existsSync(PLIST_PATH)) return { installed: false, running: false };
  const loaded = isLoaded();
  let pid = null;
  if (loaded) {
    try {
      const out = execSync(`launchctl list ${LABEL}`, { encoding: 'utf8' });
      const m = out.match(/"PID"\s*=\s*(\d+)/);
      if (m) pid = parseInt(m[1], 10);
    } catch { /* not running */ }
  }
  return { installed: true, running: loaded && pid != null, pid, file: PLIST_PATH };
}

module.exports = { install, uninstall, start, stop, restart, status, LOG_FILE, ERROR_LOG };
