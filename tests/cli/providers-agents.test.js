// CLI integration tests — drive `knowspace providers` and `knowspace agents`
// against an isolated providers.json file.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'knowspace.js');
let tmpFile;

function run(args) {
  try {
    return execFileSync('node', [BIN, ...args], {
      env: { ...process.env, KNOWSPACE_PROVIDERS_FILE: tmpFile },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    err.stdout = err.stdout?.toString();
    err.stderr = err.stderr?.toString();
    throw err;
  }
}

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `kn-cli-${Date.now()}-${Math.random()}.json`);
});
afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
});

describe('cli/providers', () => {
  it('providers --help prints usage', () => {
    const out = run(['providers', '--help']);
    assert.match(out, /knowspace providers/);
    assert.match(out, /enable <id>/);
  });

  it('providers list shows openclaw and acp loaded by default', () => {
    const out = run(['providers', 'list']);
    assert.match(out, /openclaw/);
    assert.match(out, /acp/);
    assert.match(out, /\[loaded\]/);
  });

  it('providers disable writes the file', () => {
    run(['providers', 'disable', 'acp']);
    const cfg = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    assert.equal(cfg.providers.acp.enabled, false);
  });

  it('providers enable updates the file', () => {
    run(['providers', 'disable', 'acp']);
    run(['providers', 'enable', 'acp']);
    const cfg = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    assert.equal(cfg.providers.acp.enabled, true);
  });
});

describe('cli/agents', () => {
  it('agents list groups by provider', () => {
    const out = run(['agents', 'list']);
    assert.match(out, /\[openclaw\]/);
    assert.match(out, /\[acp\]/);
    assert.match(out, /claude-code/);
  });

  it('agents list --provider acp filters', () => {
    const out = run(['agents', 'list', '--provider', 'acp']);
    assert.match(out, /\[acp\]/);
    assert.doesNotMatch(out, /\[openclaw\]/);
  });

  it('agents add writes a new override and show prints it', () => {
    run(['agents', 'add', 'my-coder',
      '--cmd', '/usr/local/bin/acp',
      '--args', '--mode coder',
      '--kind', 'coder',
      '--description', 'My local coder',
    ]);
    const cfg = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    assert.equal(cfg.providers.acp.agents['my-coder'].cmd, '/usr/local/bin/acp');
    assert.deepEqual(cfg.providers.acp.agents['my-coder'].args, ['--mode', 'coder']);

    const out = run(['agents', 'show', 'my-coder']);
    const recipe = JSON.parse(out);
    assert.equal(recipe.kind, 'coder');
    assert.equal(recipe.description, 'My local coder');
  });

  it('agents add fails without --cmd', () => {
    assert.throws(() => run(['agents', 'add', 'no-cmd']), /Command failed/);
  });

  it('agents remove deletes the override', () => {
    run(['agents', 'add', 'temp', '--cmd', 'foo']);
    run(['agents', 'remove', 'temp']);
    const cfg = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    assert.equal(cfg.providers.acp.agents.temp, undefined);
  });

  it('agents add overrides a builtin recipe by id', () => {
    run(['agents', 'add', 'claude-code',
      '--cmd', '/custom/bin/claude',
      '--name', 'Custom Claude',
    ]);
    const out = run(['agents', 'show', 'claude-code']);
    const recipe = JSON.parse(out);
    assert.equal(recipe.cmd, '/custom/bin/claude');
    assert.equal(recipe.name, 'Custom Claude');
    // args fall through from the builtin since override didn't set them
    assert.deepEqual(recipe.args, ['-y', '@agentclientprotocol/claude-agent-acp']);
  });
});
