const AuthManager = require('../middleware/auth');
const { DEFAULT_USER_SLUG } = require('./constants');

module.exports = async function tokens(argv) {
  const subcommand = argv[0];

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(`
  knowspace tokens — Manage the portal access token

  Usage:
    knowspace tokens info          Show the current token's status (no secret)
    knowspace tokens generate      Generate a new token (replaces the existing one)
    knowspace tokens rotate        Rotate the existing token

  Knowspace v2 uses a single access token. Share the login link or paste
  the token into /login on a browser. Rotating invalidates prior sessions.
`);
    return;
  }

  const auth = new AuthManager();

  switch (subcommand) {
    case 'info':
    case 'list': {
      const all = auth.listTokens();
      if (all.length === 0) {
        console.log('No token configured. Run `knowspace tokens generate` to create one.');
        return;
      }
      if (all.length > 1) {
        console.log(`⚠  ${all.length} token entries found (legacy multi-client layout).`);
        console.log('   Run `knowspace tokens generate` to consolidate into a single token.');
      }
      for (const t of all) {
        const tag = t.clientSlug === DEFAULT_USER_SLUG ? '' : ` (legacy slug: ${t.clientSlug})`;
        console.log(`  created: ${t.createdAt}  last used: ${t.lastUsed || 'never'}${tag}`);
      }
      return;
    }

    case 'generate': {
      const token = auth.generateToken(DEFAULT_USER_SLUG);
      printToken(token);
      return;
    }

    case 'rotate': {
      const existing = auth.getTokenInfo(DEFAULT_USER_SLUG);
      if (!existing) {
        console.error('No existing token. Run `knowspace tokens generate` first.');
        process.exit(1);
      }
      const token = auth.rotateToken(DEFAULT_USER_SLUG);
      console.log('\n  Token rotated. Prior sessions invalidated on next reload.\n');
      printToken(token);
      return;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Run `knowspace tokens --help` for usage.');
      process.exit(1);
  }
};

function printToken(token) {
  const { loadConfig } = require('./configure/state');
  const config = loadConfig();
  const baseUrl = (process.env.KNOWSPACE_BASE_URL || config.baseUrl || 'http://localhost:3445')
    .replace(/\/+$/, '');
  console.log(`
  === Access token ===

  Token:      ${token}
  Sign in:    ${baseUrl}/login
  One-click:  ${baseUrl}/auth?token=${token}
`);
}
