#!/usr/bin/env node
/**
 * Debug utility: load and display chat history for a client session.
 * Usage: node scripts/debug-history.js <slug> [sessionKey]
 */

const engine = require('../adapters/providers/openclaw');

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/debug-history.js <slug> [sessionKey]');
  process.exit(1);
}

(async () => {
  const sessionKey = process.argv[3] || engine.paths.getDefaultSessionKey(slug);
  console.log('Session key:', sessionKey);

  const history = await engine.chat.loadHistory(sessionKey);
  console.log(`Loaded ${history.length} messages:\n`);
  for (const m of history.slice(-10)) {
    console.log(`[${m.role}] ${m.content.substring(0, 120)}${m.content.length > 120 ? '...' : ''}`);
  }
})();
