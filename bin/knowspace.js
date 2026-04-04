#!/usr/bin/env node

const path = require('path');

const commands = {
  serve: '../cli/serve',
  onboard: '../cli/onboard',
  tokens: '../cli/tokens',
};

const command = process.argv[2];

if (!command || command === '--help' || command === '-h') {
  console.log(`
  knowspace - Client Portal CLI

  Usage:
    knowspace <command> [options]

  Commands:
    serve                       Start the portal server
    onboard <slug>              Onboard client (install skills, generate templates & token)
    tokens list                 List all client tokens
    tokens generate <slug>      Generate a new token
    tokens rotate <slug>        Rotate an existing token

  Options:
    --help, -h                  Show this help

  Run knowspace <command> --help for command-specific help.
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
