// Smoke test for ACP session persistence + reattach.
//
// Phase 1: send a message, leave the session on disk
// Phase 2: simulate a "restart" by reloading the module cache, then
//          send another message — reattach should kick in transparently.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// Use a temp sessions dir so we don't pollute ~/.knowspace
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-acp-restart-'));
process.env.KNOWSPACE_ACP_SESSIONS_DIR = tmpDir;

async function phase1() {
  const acp = require('../adapters/providers/acp');
  const sessionKey = await acp.provider.createSession('claude-code', { cwd: process.cwd() });
  console.log(`[phase1] session=${sessionKey}`);
  const before = (await acp.provider.loadHistory(sessionKey)).length;
  await acp.provider.sendMessage(sessionKey, 'Reply with exactly: HELLO-1');
  const r = await acp.provider.pollForReply(sessionKey, before, {
    pollIntervalMs: 200, maxPolls: 600,
    onMessage: m => console.log(`[phase1] reply: ${m.content}`),
  });
  console.log(`[phase1] found=${r.found}`);
  acp._connection.shutdownAll();
  return sessionKey;
}

async function phase2(sessionKey) {
  // Drop module cache to simulate a fresh process
  for (const k of Object.keys(require.cache)) {
    if (k.includes('adapters/providers/acp/')) delete require.cache[k];
  }
  const acp = require('../adapters/providers/acp');
  console.log(`[phase2] re-required acp; checking session is restored…`);
  const restored = await acp.provider.loadHistory(sessionKey);
  console.log(`[phase2] restored history length=${restored.length}`);
  if (restored.length === 0) throw new Error('history not restored');

  const before = restored.length;
  await acp.provider.sendMessage(sessionKey, 'Reply with exactly: HELLO-2');
  const r = await acp.provider.pollForReply(sessionKey, before, {
    pollIntervalMs: 200, maxPolls: 600,
    onMessage: m => console.log(`[phase2] reply: ${m.content}`),
  });
  console.log(`[phase2] found=${r.found}`);
  acp._connection.shutdownAll();
}

(async () => {
  try {
    const key = await phase1();
    await new Promise(r => setTimeout(r, 500));
    await phase2(key);
    console.log('OK');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  } catch (err) {
    console.error(err);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
})();
