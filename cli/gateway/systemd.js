/**
 * Linux systemd --user daemon management for OpenClaw gateway.
 * Manages ~/.config/systemd/user/openclaw-gateway.service
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const SERVICE_NAME = 'openclaw-gateway';
const SERVICE_FILE = `${SERVICE_NAME}.service`;
const SERVICE_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_PATH = path.join(SERVICE_DIR, SERVICE_FILE);

function buildUnit(binaryPath, openclawDir) {
  return `[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
ExecStart=${binaryPath}
WorkingDirectory=${openclawDir}
Restart=on-failure
RestartSec=5
StandardOutput=append:${openclawDir}/gateway.log
StandardError=append:${openclawDir}/gateway.error.log

[Install]
WantedBy=default.target
`;
}

function ctl(...args) {
  return spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
}

function ctlExec(...args) {
  execSync(`systemctl --user ${args.join(' ')}`, { stdio: 'pipe' });
}

function isActive() {
  const r = ctl('is-active', SERVICE_NAME);
  return r.stdout.trim() === 'active';
}

function install(binaryPath, openclawDir) {
  if (!fs.existsSync(SERVICE_DIR)) fs.mkdirSync(SERVICE_DIR, { recursive: true });
  fs.writeFileSync(SERVICE_PATH, buildUnit(binaryPath, openclawDir));
  ctlExec('daemon-reload');
  ctlExec('enable', '--now', SERVICE_NAME);
}

function uninstall() {
  if (isActive()) ctlExec('stop', SERVICE_NAME);
  try { ctlExec('disable', SERVICE_NAME); } catch { /* ignore */ }
  if (fs.existsSync(SERVICE_PATH)) fs.unlinkSync(SERVICE_PATH);
  try { ctlExec('daemon-reload'); } catch { /* ignore */ }
}

function start() {
  if (!fs.existsSync(SERVICE_PATH)) throw new Error('Not installed. Run: knowspace gateway install');
  ctlExec('start', SERVICE_NAME);
}

function stop() {
  if (!isActive()) throw new Error('Gateway is not running.');
  ctlExec('stop', SERVICE_NAME);
}

function restart() {
  if (!fs.existsSync(SERVICE_PATH)) throw new Error('Not installed. Run: knowspace gateway install');
  ctlExec('restart', SERVICE_NAME);
}

function status() {
  if (!fs.existsSync(SERVICE_PATH)) {
    return { installed: false, running: false, service: null };
  }
  const active = isActive();
  let pid = null;
  if (active) {
    try {
      const out = execSync(`systemctl --user show ${SERVICE_NAME} --property=MainPID`, { encoding: 'utf8' });
      const m = out.match(/MainPID=(\d+)/);
      if (m && m[1] !== '0') pid = parseInt(m[1], 10);
    } catch { /* ignore */ }
  }
  return { installed: true, running: active, pid, service: SERVICE_PATH };
}

module.exports = { install, uninstall, start, stop, restart, status, SERVICE_PATH };
