/**
 * ACP terminal operations for coder mode.
 *
 * When a coder agent (claude-code, codex, …) wants to run a shell command
 * it calls createTerminal → terminalOutput / waitForTerminalExit →
 * releaseTerminal. We back each terminal with a child_process.spawn (no
 * pty for now — interactive programs that need a tty are out of scope;
 * upgrade to node-pty later if needed).
 *
 * Output is captured into an in-memory buffer with a configurable byte
 * cap; when exceeded we truncate from the beginning so the most recent
 * output is preserved. Truncation is char-safe (string slicing).
 *
 * Security: commands run with the privileges of the Knowspace process.
 * Knowspace v2's YOLO trust mode applies — there is no allowlist on
 * commands or working directories. Operators concerned about this should
 * gate their agents with --dangerously-skip-permissions equivalents at
 * the agent level rather than at the portal.
 */

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const DEFAULT_BYTE_LIMIT = 1_000_000; // 1 MB
const terminals = new Map(); // terminalId → state

function envArrayToObject(envArray) {
  const out = { ...process.env };
  for (const v of envArray || []) {
    if (v && typeof v.name === 'string') out[v.name] = String(v.value ?? '');
  }
  return out;
}

function appendOutput(state, chunk) {
  state.output += chunk.toString('utf8');
  if (state.output.length > state.limit) {
    state.output = state.output.slice(state.output.length - state.limit);
    state.truncated = true;
  }
}

function create({ command, args, cwd, env, outputByteLimit }) {
  if (!command || typeof command !== 'string') {
    throw new Error('createTerminal: command is required');
  }
  const limit = outputByteLimit ?? DEFAULT_BYTE_LIMIT;
  const id = crypto.randomUUID();
  const state = {
    id,
    command,
    args: args || [],
    cwd,
    output: '',
    truncated: false,
    exitStatus: null, // { exitCode, signal } once exited
    waiters: [],
    limit,
    child: null,
    error: null,
  };
  terminals.set(id, state);

  let child;
  try {
    child = spawn(command, args || [], {
      cwd: cwd || process.cwd(),
      env: envArrayToObject(env),
      shell: false,
    });
  } catch (err) {
    state.error = err.message;
    state.exitStatus = { exitCode: 127, signal: null };
    appendOutput(state, Buffer.from(`failed to spawn ${command}: ${err.message}\n`));
    return { terminalId: id };
  }

  state.child = child;

  child.on('error', (err) => {
    state.error = err.message;
    appendOutput(state, Buffer.from(`spawn error: ${err.message}\n`));
    if (!state.exitStatus) {
      state.exitStatus = { exitCode: 127, signal: null };
      flushWaiters(state);
    }
  });
  child.stdout?.on('data', (chunk) => appendOutput(state, chunk));
  child.stderr?.on('data', (chunk) => appendOutput(state, chunk));
  child.on('exit', (code, signal) => {
    state.exitStatus = { exitCode: code, signal };
    flushWaiters(state);
  });

  return { terminalId: id };
}

function flushWaiters(state) {
  for (const w of state.waiters) w.resolve(state.exitStatus);
  state.waiters = [];
}

function output({ terminalId }) {
  const s = terminals.get(terminalId);
  if (!s) throw new Error(`unknown terminal: ${terminalId}`);
  return {
    output: s.output,
    truncated: s.truncated,
    exitStatus: s.exitStatus,
  };
}

function waitForExit({ terminalId }) {
  const s = terminals.get(terminalId);
  if (!s) throw new Error(`unknown terminal: ${terminalId}`);
  if (s.exitStatus) return Promise.resolve(s.exitStatus);
  return new Promise((resolve) => s.waiters.push({ resolve }));
}

function release({ terminalId }) {
  const s = terminals.get(terminalId);
  if (!s) return null;
  if (s.child && !s.exitStatus) {
    try { s.child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  terminals.delete(terminalId);
  return null;
}

function kill({ terminalId }) {
  const s = terminals.get(terminalId);
  if (!s || s.exitStatus || !s.child) return null;
  try { s.child.kill('SIGTERM'); } catch { /* ignore */ }
  return null;
}

function listForTest() {
  return Array.from(terminals.keys());
}

module.exports = {
  create,
  output,
  waitForExit,
  release,
  kill,
  DEFAULT_BYTE_LIMIT,
  _listForTest: listForTest,
  _terminalsForTest: terminals,
};
