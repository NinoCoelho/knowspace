const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const terminals = require('../../../adapters/providers/acp/terminals');

beforeEach(() => terminals._terminalsForTest.clear());

describe('acp/terminals', () => {
  it('create + waitForExit captures stdout from a successful command', async () => {
    const { terminalId } = terminals.create({ command: 'sh', args: ['-c', 'echo hello world'] });
    const status = await terminals.waitForExit({ terminalId });
    assert.equal(status.exitCode, 0);
    const out = terminals.output({ terminalId });
    assert.match(out.output, /hello world/);
    assert.equal(out.exitStatus.exitCode, 0);
  });

  it('captures stderr too', async () => {
    const { terminalId } = terminals.create({ command: 'sh', args: ['-c', '>&2 echo oops; exit 3'] });
    const status = await terminals.waitForExit({ terminalId });
    assert.equal(status.exitCode, 3);
    assert.match(terminals.output({ terminalId }).output, /oops/);
  });

  it('truncates output past outputByteLimit, keeping the tail', async () => {
    const { terminalId } = terminals.create({
      command: 'sh',
      args: ['-c', 'for i in 1 2 3 4 5 6 7 8 9 0; do printf "%s" "AAAAAAAAAA"; done'],
      outputByteLimit: 50,
    });
    await terminals.waitForExit({ terminalId });
    const out = terminals.output({ terminalId });
    assert.equal(out.truncated, true);
    assert.ok(out.output.length <= 50, `got length ${out.output.length}`);
    assert.match(out.output, /^A+$/);
  });

  it('release kills a still-running process and forgets it', async () => {
    const { terminalId } = terminals.create({ command: 'sh', args: ['-c', 'sleep 30'] });
    assert.ok(terminals._terminalsForTest.has(terminalId));
    terminals.release({ terminalId });
    assert.equal(terminals._terminalsForTest.has(terminalId), false);
  });

  it('kill SIGTERMs a running process; output then reports the exit', async () => {
    const { terminalId } = terminals.create({ command: 'sh', args: ['-c', 'sleep 30'] });
    terminals.kill({ terminalId });
    const status = await terminals.waitForExit({ terminalId });
    assert.ok(status.signal === 'SIGTERM' || status.exitCode != null);
    const out = terminals.output({ terminalId });
    assert.ok(out.exitStatus);
  });

  it('output throws for an unknown terminal id', () => {
    assert.throws(() => terminals.output({ terminalId: 'not-real' }), /unknown terminal/);
  });

  it('passes env variables to the child', async () => {
    const { terminalId } = terminals.create({
      command: 'sh',
      args: ['-c', 'echo $KNOWSPACE_TEST_VAR'],
      env: [{ name: 'KNOWSPACE_TEST_VAR', value: 'flagged' }],
    });
    await terminals.waitForExit({ terminalId });
    assert.match(terminals.output({ terminalId }).output, /flagged/);
  });

  it('respects cwd', async () => {
    const { terminalId } = terminals.create({
      command: 'sh',
      args: ['-c', 'pwd'],
      cwd: '/tmp',
    });
    await terminals.waitForExit({ terminalId });
    const out = terminals.output({ terminalId });
    // macOS resolves /tmp → /private/tmp
    assert.match(out.output, /\/(private\/)?tmp/);
  });

  it('records exit code 127-ish for an unknown command', async () => {
    const { terminalId } = terminals.create({ command: '/nonexistent/binary/xyz' });
    const status = await terminals.waitForExit({ terminalId });
    // child_process emits 'error' (ENOENT) before exit; we synthesize 127
    assert.ok(status.exitCode === 127 || status.exitCode === null);
  });
});
