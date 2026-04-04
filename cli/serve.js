const { parseArgs } = require('node:util');

module.exports = function serve(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
  knowspace serve - Start the portal server

  Usage:
    knowspace serve [--port <number>]

  Options:
    --port, -p    Port to listen on (default: $PORT or 3445)
    --help, -h    Show this help
`);
    return;
  }

  if (values.port) {
    process.env.PORT = values.port;
  }

  require('../server.js');
};
