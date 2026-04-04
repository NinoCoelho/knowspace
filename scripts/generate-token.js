#!/usr/bin/env node

const AuthManager = require('../middleware/auth');
const authManager = new AuthManager();

const clientSlug = process.argv[2];

if (!clientSlug) {
  console.error('Usage: node scripts/generate-token.js <client-slug>');
  process.exit(1);
}

const token = authManager.generateToken(clientSlug);
const link = `https://bella.bonito-halosaur.ts.net/?token=${token}`;

console.log('\n=== Token Generated ===\n');
console.log(`Client: ${clientSlug}`);
console.log(`Token:  ${token}`);
console.log(`Link:   ${link}\n`);
