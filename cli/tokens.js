const path = require('path');
const AuthManager = require('../middleware/auth');

module.exports = async function tokens(argv) {
  const subcommand = argv[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(`
  knowspace tokens - Manage client access tokens

  Usage:
    knowspace tokens list                 List all tokens
    knowspace tokens generate <slug>      Generate a new token
    knowspace tokens rotate <slug>        Rotate an existing token

  Options:
    --help, -h    Show this help
`);
    return;
  }

  const tokensPath = path.join(__dirname, '..', '.tokens.json');
  const auth = new AuthManager(tokensPath);

  switch (subcommand) {
    case 'list': {
      const tokens = auth.listTokens();
      if (tokens.length === 0) {
        console.log('No tokens found.');
        return;
      }
      console.log('\n  Client Tokens:\n');
      for (const t of tokens) {
        const lastUsed = t.lastUsed || 'never';
        console.log(`  ${t.clientSlug.padEnd(24)} created: ${t.createdAt}  last used: ${lastUsed}`);
      }
      console.log();
      break;
    }

    case 'generate': {
      const slug = argv[1];
      if (!slug) {
        console.error('Usage: knowspace tokens generate <slug>');
        process.exit(1);
      }
      const token = auth.generateToken(slug);
      printToken(slug, token);
      break;
    }

    case 'rotate': {
      const slug = argv[1];
      if (!slug) {
        console.error('Usage: knowspace tokens rotate <slug>');
        process.exit(1);
      }
      const token = auth.rotateToken(slug);
      if (!token) {
        console.error(`No existing token found for "${slug}". Use 'knowspace tokens generate ${slug}' instead.`);
        process.exit(1);
      }
      console.log(`\n  Token rotated for "${slug}".\n`);
      printToken(slug, token);
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Run knowspace tokens --help for usage.');
      process.exit(1);
  }
};

function printToken(slug, token) {
  console.log(`
  === Token Generated ===

  Client:  ${slug}
  Token:   ${token}
  Link:    https://bella.bonito-halosaur.ts.net/?token=${token}
`);
}
