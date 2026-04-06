/**
 * Linux systemd --user daemon management for the Knowspace server.
 * Manages ~/.config/systemd/user/knowspace.service
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const SERVICE_NAME = 'knowspace';
const SERVICE_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_PATH = path.join(SERVICE_DIR, `${SERVICE_NAME}.service`);
const LOG_DIR = path.join(os.homedir(), '.knowspace');
const LOG_FILE = path.join(LOG_DIR, 'knowspace.log');
const ERROR_LOG = path.join(LOG_DIR, 'knowspace.error.log');

function buildUnit(nodeBin, serverJs, env) {
  const envLines = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join('\n');

  return `[Unit]
Description=Knowspace Portal Server
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} ${serverJs}
${envLines}
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_FILE}
StandardError=append:${ERROR_LOG}

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
  return ctl('is-active', SERVICE_NAME).stdout.trim() === 'active';
}

function install(nodeBin, serverJs, env) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(SERVICE_DIR)) fs.mkdirSync(SERVICE_DIR, { recursive: true });

  fs.writeFileSync(SERVICE_PATH, buildUnit(nodeBin, serverJs, env));
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
  if (!fs.existsSync(SERVICE_PATH)) throw new Error('Not installed. Run: knowspace daemon install');
  ctlExec('start', SERVICE_NAME);
}

function stop() {
  if (!isActive()) throw new Error('Knowspace daemon is not running.');
  ctlExec('stop', SERVICE_NAME);
}

function restart() {
  if (!fs.existsSync(SERVICE_PATH)) throw new Error('Not installed. Run: knowspace daemon install');
  ctlExec('restart', SERVICE_NAME);
}

function status() {
  if (!fs.existsSync(SERVICE_PATH)) return { installed: false, running: false };
  const active = isActive();
  let pid = null;
  if (active) {
    try {
      const out = execSync(`systemctl --user show ${SERVICE_NAME} --property=MainPID`, { encoding: 'utf8' });
      const m = out.match(/MainPID=(\d+)/);
      if (m && m[1] !== '0') pid = parseInt(m[1], 10);
    } catch { /* ignore */ }
  }
  return { installed: true, running: active, pid, file: SERVICE_PATH };
}

module.exports = { install, uninstall, start, stop, restart, status, LOG_FILE, ERROR_LOG };
