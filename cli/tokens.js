const path = require('path');
const AuthManager = require('../middleware/auth');
const { DEFAULT_USER_SLUG } = require('./constants');

module.exports = async function tokens(argv) {
  const subcommand = argv[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(`
  knowspace tokens - Manage access tokens

  Usage:
    knowspace tokens list         List all tokens
    knowspace tokens generate     Generate a new access token
    knowspace tokens rotate       Rotate the access token

  Options:
    --help, -h    Show this help

  Knowspace v2 is single-user: these commands act on the portal's
  own token. For legacy multi-tenant setups, pass a slug as the first
  positional arg (e.g. \`knowspace tokens generate acme\`).
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
      console.log('\n  Tokens:\n');
      for (const t of tokens) {
        const lastUsed = t.lastUsed || 'never';
        const tag = t.clientSlug === DEFAULT_USER_SLUG ? '' : ` (${t.clientSlug})`;
        console.log(`  created: ${t.createdAt}  last used: ${lastUsed}${tag}`);
      }
      console.log();
      break;
    }

    case 'generate': {
      const slug = argv[1] || DEFAULT_USER_SLUG;
      const token = auth.generateToken(slug);
      printToken(slug, token);
      break;
    }

    case 'rotate': {
      const slug = argv[1] || DEFAULT_USER_SLUG;
      const token = auth.rotateToken(slug);
      if (!token) {
        console.error(`No existing token to rotate. Run 'knowspace tokens generate' first.`);
        process.exit(1);
      }
      console.log(`\n  Token rotated.\n`);
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
  const { loadConfig } = require('./configure/state');
  const config = loadConfig();
  const baseUrl = process.env.KNOWSPACE_BASE_URL || config.baseUrl || 'http://localhost:3445';
  const tag = slug === DEFAULT_USER_SLUG ? '' : `\n  Slug:    ${slug}`;
  console.log(`
  === Token Generated ===${tag}

  Token:   ${token}
  Link:    ${baseUrl}/auth?token=${token}
`);
}
