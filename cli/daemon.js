/**
 * knowspace daemon — install and manage the Knowspace portal server as a system daemon.
 *
 * Subcommands: install, uninstall, start, stop, restart, status, logs
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const prompts = require('./configure/prompts');
const { loadConfig } = require('./configure/state');

const SERVER_JS = path.resolve(__dirname, '..', 'server.js');

// ─── Platform ────────────────────────────────────────────────────────────────

function getDriver() {
  if (process.platform === 'darwin') return require('./daemon/launchd');
  if (process.platform === 'linux')  return require('./daemon/systemd');
  throw new Error(`Unsupported platform: ${process.platform}. Only macOS and Linux are supported.`);
}

// ─── Collect env vars from config ────────────────────────────────────────────

function buildEnv(config, overrides) {
  const env = {};
  if (config.gatewayUrl)   env.KNOWSPACE_GATEWAY_URL   = config.gatewayUrl;
  if (overrides.port)      env.KNOWSPACE_PORT           = String(overrides.port);
  if (overrides.baseUrl)   env.KNOWSPACE_BASE_URL       = overrides.baseUrl;
  if (overrides.adminSlug) env.KNOWSPACE_ADMIN_SLUG     = overrides.adminSlug;
  // Pass through any existing env vars the user already has set
  for (const key of ['KNOWSPACE_GATEWAY_TOKEN', 'KNOWSPACE_TOKENS_FILE', 'KNOWSPACE_BASE_URL']) {
    if (process.env[key] && !env[key]) env[key] = process.env[key];
  }
  return env;
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

async function cmdInstall() {
  const driver = getDriver();
  const config = loadConfig();

  prompts.heading('Daemon Install');

  if (!fs.existsSync(SERVER_JS)) {
    prompts.warn(`server.js not found at ${SERVER_JS}`);
    prompts.close();
    return;
  }

  const nodeBin = process.execPath;
  const defaultPort = process.env.KNOWSPACE_PORT || '3445';

  prompts.info(`Node       : ${nodeBin}`);
  prompts.info(`Server     : ${SERVER_JS}`);
  if (config.gatewayUrl) prompts.info(`Gateway    : ${config.gatewayUrl}`);
  console.log();

  const port = await prompts.ask('Port', defaultPort);
  const ok = await prompts.confirm('Install and start Knowspace as a daemon?', true);
  if (!ok) { prompts.close(); return; }

  const env = buildEnv(config, { port });

  try {
    driver.install(nodeBin, SERVER_JS, env);
    prompts.success('Knowspace daemon installed and started.');
    prompts.info(`Logs : ${driver.LOG_FILE}`);
    prompts.info(`File : ${driver.ERROR_LOG}`);
    console.log();
    prompts.info(`Portal available at http://localhost:${port}`);
  } catch (err) {
    prompts.warn(`Install failed: ${err.message}`);
  }
  prompts.close();
}

async function cmdUninstall() {
  const driver = getDriver();
  prompts.heading('Daemon Uninstall');

  const ok = await prompts.confirm('Stop and remove Knowspace daemon?', false);
  if (!ok) { prompts.close(); return; }

  try {
    driver.uninstall();
    prompts.success('Knowspace daemon removed.');
  } catch (err) {
    prompts.warn(`Uninstall failed: ${err.message}`);
  }
  prompts.close();
}

function cmdStart() {
  try {
    getDriver().start();
    console.log('    ✓ Knowspace started.');
  } catch (err) {
    console.error(`    ✗ ${err.message}`);
    process.exit(1);
  }
}

function cmdStop() {
  try {
    getDriver().stop();
    console.log('    ✓ Knowspace stopped.');
  } catch (err) {
    console.error(`    ✗ ${err.message}`);
    process.exit(1);
  }
}

function cmdRestart() {
  try {
    getDriver().restart();
    console.log('    ✓ Knowspace restarted.');
  } catch (err) {
    console.error(`    ✗ ${err.message}`);
    process.exit(1);
  }
}

function cmdStatus() {
  const s = getDriver().status();
  console.log('\n  Knowspace Daemon Status\n');
  if (!s.installed) {
    console.log('    Not installed. Run: knowspace daemon install\n');
    return;
  }
  console.log(`    Installed : yes`);
  console.log(`    Running   : ${s.running ? 'yes' : 'no'}`);
  if (s.pid)  console.log(`    PID       : ${s.pid}`);
  if (s.file) console.log(`    File      : ${s.file}`);
  console.log();
}

function cmdLogs(argv) {
  const driver = getDriver();
  const logFile = argv.includes('--error') ? driver.ERROR_LOG : driver.LOG_FILE;

  if (!fs.existsSync(logFile)) {
    console.error(`    Log file not found: ${logFile}`);
    console.error('    Run knowspace daemon install first, or use knowspace serve to run interactively.');
    process.exit(1);
  }

  console.log(`    → ${logFile}\n`);
  const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
  tail.on('error', (err) => {
    console.error(`tail failed: ${err.message}`);
    process.exit(1);
  });
  process.on('SIGINT', () => { tail.kill(); process.exit(0); });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const HELP = `
  knowspace daemon — manage the Knowspace portal server as a system daemon

  Usage:
    knowspace daemon <subcommand> [options]

  Subcommands:
    install       Write service file, start daemon (auto-starts on login)
    uninstall     Stop daemon and remove service file
    start         Start the daemon
    stop          Stop the daemon
    restart       Restart the daemon
    status        Show daemon status and PID
    logs          Stream server log (tail -f)
    logs --error  Stream error log instead

  macOS : ~/Library/LaunchAgents/com.knowspace.server.plist  (launchd)
  Linux : ~/.config/systemd/user/knowspace.service           (systemd --user)
  Logs  : ~/.knowspace/knowspace.log
`;

module.exports = async function daemon(argv) {
  const sub = argv[0];

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP);
    return;
  }

  try {
    switch (sub) {
      case 'install':   await cmdInstall();      break;
      case 'uninstall': await cmdUninstall();    break;
      case 'start':     cmdStart();              break;
      case 'stop':      cmdStop();               break;
      case 'restart':   cmdRestart();            break;
      case 'status':    cmdStatus();             break;
      case 'logs':      cmdLogs(argv.slice(1));  break;
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
