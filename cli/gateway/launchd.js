/**
 * macOS launchd daemon management for OpenClaw gateway.
 * Manages ~/Library/LaunchAgents/com.openclaw.gateway.plist
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const PLIST_LABEL = 'com.openclaw.gateway';
const PLIST_PATH = path.join(
  os.homedir(),
  'Library', 'LaunchAgents',
  `${PLIST_LABEL}.plist`
);

function buildPlist(binaryPath, openclawDir, port) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${openclawDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${openclawDir}/gateway.log</string>
  <key>StandardErrorPath</key>
  <string>${openclawDir}/gateway.error.log</string>
</dict>
</plist>
`;
}

function isLoaded() {
  try {
    const result = spawnSync('launchctl', ['list', PLIST_LABEL], { encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

function install(binaryPath, openclawDir, port) {
  const dir = path.dirname(PLIST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PLIST_PATH, buildPlist(binaryPath, openclawDir, port));
  if (isLoaded()) {
    execSync(`launchctl unload "${PLIST_PATH}"`, { stdio: 'pipe' });
  }
  execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: 'pipe' });
}

function uninstall() {
  if (isLoaded()) {
    execSync(`launchctl unload -w "${PLIST_PATH}"`, { stdio: 'pipe' });
  }
  if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
}

function start() {
  if (!fs.existsSync(PLIST_PATH)) throw new Error('Not installed. Run: knowspace gateway install');
  if (!isLoaded()) execSync(`launchctl load -w "${PLIST_PATH}"`, { stdio: 'pipe' });
  execSync(`launchctl start ${PLIST_LABEL}`, { stdio: 'pipe' });
}

function stop() {
  if (!isLoaded()) throw new Error('Gateway is not running.');
  execSync(`launchctl stop ${PLIST_LABEL}`, { stdio: 'pipe' });
}

function restart() {
  stop();
  start();
}

function status() {
  if (!fs.existsSync(PLIST_PATH)) {
    return { installed: false, running: false, plist: null };
  }
  const loaded = isLoaded();
  let pid = null;
  if (loaded) {
    try {
      const out = execSync(`launchctl list ${PLIST_LABEL}`, { encoding: 'utf8' });
      const m = out.match(/"PID"\s*=\s*(\d+)/);
      if (m) pid = parseInt(m[1], 10);
    } catch { /* not running */ }
  }
  return { installed: true, running: loaded && pid != null, pid, plist: PLIST_PATH };
}

module.exports = { install, uninstall, start, stop, restart, status, PLIST_PATH };
