/**
 * knowspace gateway — manage the OpenClaw gateway daemon.
 *
 * Subcommands: install, uninstall, start, stop, restart, status
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const prompts = require('./configure/prompts');
const { loadConfig } = require('./configure/state');
const { detectFromDir, DEFAULT_OPENCLAW_DIR } = require('./configure/gateway');

// ─── Platform ───────────────────────────────────────────────────────────────

function getDriver() {
  if (process.platform === 'darwin') return require('./gateway/launchd');
  if (process.platform === 'linux')  return require('./gateway/systemd');
  throw new Error(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
}

// ─── Binary detection ────────────────────────────────────────────────────────

function findBinary(openclawDir) {
  // 1. Next to config dir (e.g. ~/.openclaw/openclaw)
  const candidates = [
    path.join(openclawDir, 'openclaw'),
    path.join(openclawDir, 'bin', 'openclaw'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 2. PATH
  try {
    const found = execSync('which openclaw', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (found) return found;
  } catch { /* not on PATH */ }
  return null;
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

async function cmdInstall() {
  const driver = getDriver();
  const config = loadConfig();
  const openclawDir = config.openclawDir || DEFAULT_OPENCLAW_DIR;

  prompts.heading('Gateway Install');

  // Locate binary
  let binaryPath = findBinary(openclawDir);
  if (!binaryPath) {
    prompts.warn('OpenClaw binary not found automatically.');
    binaryPath = await prompts.ask('Path to openclaw binary', '/usr/local/bin/openclaw');
  }
  if (!fs.existsSync(binaryPath)) {
    prompts.warn(`Binary not found: ${binaryPath}`);
    prompts.close();
    return;
  }

  // Confirm
  const gwConfig = detectFromDir(openclawDir);
  const port = gwConfig ? new URL(gwConfig.url.replace('ws://', 'http://')).port || 18789 : 18789;

  prompts.info(`Binary     : ${binaryPath}`);
  prompts.info(`Config dir : ${openclawDir}`);
  prompts.info(`Port       : ${port}`);
  console.log();

  const ok = await prompts.confirm('Install and start gateway daemon?', true);
  if (!ok) { prompts.close(); return; }

  try {
    driver.install(binaryPath, openclawDir, port);
    prompts.success('Gateway daemon installed and started.');
    if (driver.SERVICE_PATH) prompts.info(`Service file: ${driver.SERVICE_PATH}`);
    if (driver.PLIST_PATH)   prompts.info(`Plist file  : ${driver.PLIST_PATH}`);
  } catch (err) {
    prompts.warn(`Install failed: ${err.message}`);
  }
  prompts.close();
}

async function cmdUninstall() {
  const driver = getDriver();
  prompts.heading('Gateway Uninstall');

  const ok = await prompts.confirm('Stop and remove the gateway daemon?', false);
  if (!ok) { prompts.close(); return; }

  try {
    driver.uninstall();
    prompts.success('Gateway daemon removed.');
  } catch (err) {
    prompts.warn(`Uninstall failed: ${err.message}`);
  }
  prompts.close();
}

function cmdStart() {
  const driver = getDriver();
  try {
    driver.start();
    console.log('    ✓ Gateway started.');
  } catch (err) {
    console.error(`    ✗ ${err.message}`);
    process.exit(1);
  }
}

function cmdStop() {
  const driver = getDriver();
  try {
    driver.stop();
    console.log('    ✓ Gateway stopped.');
  } catch (err) {
    console.error(`    ✗ ${err.message}`);
    process.exit(1);
  }
}

function cmdRestart() {
  const driver = getDriver();
  try {
    driver.restart();
    console.log('    ✓ Gateway restarted.');
  } catch (err) {
    console.error(`    ✗ ${err.message}`);
    process.exit(1);
  }
}

function cmdStatus() {
  const driver = getDriver();
  const s = driver.status();

  console.log('\n  OpenClaw Gateway Status\n');
  if (!s.installed) {
    console.log('    Not installed. Run: knowspace gateway install\n');
    return;
  }
  console.log(`    Installed : yes`);
  console.log(`    Running   : ${s.running ? 'yes' : 'no'}`);
  if (s.pid)     console.log(`    PID       : ${s.pid}`);
  if (s.plist)   console.log(`    Plist     : ${s.plist}`);
  if (s.service) console.log(`    Service   : ${s.service}`);
  console.log();
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const HELP = `
  knowspace gateway — manage the OpenClaw gateway daemon

  Usage:
    knowspace gateway <subcommand>

  Subcommands:
    install     Detect binary, write service file, start daemon
    uninstall   Stop daemon and remove service file
    start       Start the daemon
    stop        Stop the daemon
    restart     Restart the daemon
    status      Show daemon status

  macOS : ~/Library/LaunchAgents/com.openclaw.gateway.plist  (launchd)
  Linux : ~/.config/systemd/user/openclaw-gateway.service    (systemd --user)
`;

module.exports = async function gateway(argv) {
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return;
  }

  try {
    switch (sub) {
      case 'install':   await cmdInstall();   break;
      case 'uninstall': await cmdUninstall(); break;
      case 'start':     cmdStart();            break;
      case 'stop':      cmdStop();             break;
      case 'restart':   cmdRestart();          break;
      case 'status':    cmdStatus();           break;
      default:
        console.error(`  Unknown subcommand: ${sub}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    if (err.message.includes('Unsupported platform')) {
      console.error(`  ✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
};
