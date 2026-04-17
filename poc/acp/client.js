// Minimal ACP client POC.
// Spawns an ACP-compatible agent (Claude Code or Hermes), runs the
// initialize -> newSession -> prompt loop, and prints streamed updates.
//
// Usage: node client.js [claude|hermes] "your prompt here"

import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));

const PROVIDERS = {
  claude: {
    cmd: process.execPath,
    args: [path.join(here, 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')],
    env: process.env,
  },
  hermes: {
    cmd: 'hermes',
    args: ['acp'],
    env: process.env,
  },
};

function log(tag, ...rest) {
  process.stderr.write(`[${tag}] ${rest.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join(' ')}\n`);
}

function describeUpdate(update) {
  const u = update.sessionUpdate;
  switch (u) {
    case 'agent_message_chunk':
      return `agent: ${update.content?.text ?? '<non-text>'}`;
    case 'agent_thought_chunk':
      return `thought: ${update.content?.text ?? '<non-text>'}`;
    case 'tool_call':
      return `tool_call(${update.toolCallId}): ${update.title ?? update.kind ?? ''}`;
    case 'tool_call_update':
      return `tool_update(${update.toolCallId}): status=${update.status ?? '?'}`;
    case 'plan':
      return `plan: ${(update.entries || []).map(e => `[${e.status}] ${e.content}`).join(' | ')}`;
    case 'available_commands_update':
      return `commands: ${(update.availableCommands || []).map(c => c.name).join(', ')}`;
    case 'current_mode_update':
      return `mode: ${update.currentModeId}`;
    default:
      return `${u}: ${JSON.stringify(update).slice(0, 200)}`;
  }
}

async function main() {
  const which = process.argv[2] || 'claude';
  const userPrompt = process.argv.slice(3).join(' ') || 'Reply with exactly: ACP-POC-OK';

  const cfg = PROVIDERS[which];
  if (!cfg) throw new Error(`unknown provider: ${which}`);

  log('spawn', cfg.cmd, ...cfg.args);
  const child = spawn(cfg.cmd, cfg.args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: cfg.env,
  });

  child.on('exit', (code, sig) => log('child-exit', `code=${code}`, `sig=${sig}`));
  child.on('error', (err) => log('child-error', err.message));

  const input = Readable.toWeb(child.stdout);
  const output = Writable.toWeb(child.stdin);
  const stream = ndJsonStream(output, input);

  const conn = new ClientSideConnection(
    () => ({
      async sessionUpdate(params) {
        log('update', describeUpdate(params.update));
      },
      async requestPermission(params) {
        log('permission-request', params.toolCall?.title ?? '?');
        const allowOpt = params.options?.find(o => o.kind === 'allow_once' || o.kind === 'allow_always') ?? params.options?.[0];
        return { outcome: { outcome: 'selected', optionId: allowOpt?.optionId } };
      },
      async readTextFile(params) {
        log('readTextFile', params.path);
        const fs = await import('node:fs/promises');
        const content = await fs.readFile(params.path, 'utf8');
        return { content };
      },
      async writeTextFile(params) {
        log('writeTextFile', params.path);
        const fs = await import('node:fs/promises');
        await fs.writeFile(params.path, params.content, 'utf8');
        return null;
      },
      async createTerminal() { throw new Error('terminal not implemented in POC'); },
      async terminalOutput() { throw new Error('terminal not implemented in POC'); },
      async releaseTerminal() { return null; },
      async waitForTerminalExit() { throw new Error('terminal not implemented in POC'); },
      async killTerminal() { return null; },
    }),
    stream,
  );

  log('initialize', `protocol=${PROTOCOL_VERSION}`);
  const init = await conn.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    },
    clientInfo: { name: 'knowspace-poc', version: '0.0.0' },
  });
  log('initialize-resp', `agent=${init.agentInfo?.name ?? '?'} v${init.agentInfo?.version ?? '?'}`);
  if (init.authMethods?.length) log('auth-methods', init.authMethods.map(m => m.id).join(','));

  log('newSession', `cwd=${process.cwd()}`);
  const session = await conn.newSession({
    cwd: process.cwd(),
    mcpServers: [],
  });
  log('newSession-resp', `sessionId=${session.sessionId}`);

  log('prompt', userPrompt);
  const reply = await conn.prompt({
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: userPrompt }],
  });
  log('prompt-done', `stopReason=${reply.stopReason ?? '?'}`);

  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 1000).unref();
}

main().catch((err) => {
  log('fatal', err.stack ?? err.message);
  process.exit(1);
});
