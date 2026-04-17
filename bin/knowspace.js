#!/usr/bin/env node

const commands = {
  serve: '../cli/serve',
  connect: '../cli/connect',
  configure: '../cli/configure',
  daemon: '../cli/daemon',
  tokens: '../cli/tokens',
  providers: '../cli/providers',
  agents: '../cli/agents',
};

const command = process.argv[2];

if (!command || command === '--help' || command === '-h') {
  console.log(`
  knowspace — multi-provider agent portal

  Usage:
    knowspace <command> [options]

  Commands:
    serve                          Start the portal server
    connect                        Configure the OpenClaw gateway (optional)
    configure                      Interactive setup (wizard or menu)
    daemon <sub>                   Manage the Knowspace daemon (install/uninstall/start/stop/restart/status/logs)
    tokens <sub>                   Manage access tokens (list/generate/rotate)
    providers <sub>                Manage providers (list/enable/disable/path)
    agents <sub>                   Manage agents (list/add/remove/show)

  Options:
    --help, -h                     Show this help

  Run 'knowspace <command> --help' for command-specific help.
`);
  process.exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}`);
  console.error('Run knowspace --help for available commands.');
  process.exit(1);
}

const handler = require(commands[command]);
const args = process.argv.slice(3);
handler(args);
