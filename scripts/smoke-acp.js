/**
 * End-to-end smoke test for the ACP provider as wired in production.
 * Spawns Claude Code via the recipe registered in adapters/providers/acp,
 * runs a one-shot prompt, and prints the streamed reply.
 *
 * Usage: node scripts/smoke-acp.js [agentId]   # default: claude-code
 */

const { provider, _connection } = require('../adapters/providers/acp');

async function main() {
  const agentId = process.argv[2] || 'claude-code';
  const text = process.argv.slice(3).join(' ') || 'Reply with exactly: ACP-PROVIDER-SMOKE-OK';

  console.log(`[smoke] agent=${agentId}`);
  console.log(`[smoke] prompt=${text}`);

  const sessionKey = await provider.createSession(agentId, { cwd: process.cwd() });
  console.log(`[smoke] session=${sessionKey}`);

  const before = (await provider.loadHistory(sessionKey)).length;
  await provider.sendMessage(sessionKey, text);

  const result = await provider.pollForReply(sessionKey, before, {
    pollIntervalMs: 200,
    maxPolls: 600,
    onProgress: ({ status, tools }) => console.log(`[smoke] status=${status} tools=${tools.map(t => t.tool).join(',')}`),
    onMessage: (m) => console.log(`[smoke] reply: ${m.content}`),
  });

  console.log(`[smoke] done found=${result.found}`);
  await provider.deleteSession(sessionKey);
  _connection.shutdownAll();
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
