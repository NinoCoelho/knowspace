/**
 * knowspace connect — configure OpenClaw connection and install the onboard skill.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const prompts = require('./configure/prompts');
const gateway = require('./configure/gateway');
const env = require('./configure/env');
const { loadConfig, saveConfig } = require('./configure/state');
const enginePaths = require('../adapters/providers/openclaw/paths');

const SKILL_NAME = 'knowspace-onboard';
const SKILL_SRC = path.join(__dirname, '..', 'skills', SKILL_NAME);

module.exports = async function connect(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  knowspace connect — Configure OpenClaw connection and install onboard skill

  Usage:
    knowspace connect

  What it does:
    1. Detects or prompts for OpenClaw gateway config (~/.openclaw/openclaw.json)
    2. Saves connection settings to ~/.knowspace/.env if needed
    3. Installs/reinstalls the knowspace-onboard skill to the agent workspace
    4. Registers the skill in the workspace AGENTS.md

  Run without arguments — fully interactive.
`);
    return;
  }

  console.log('\n  ╭─────────────────────────────────────────╮');
  console.log('  │  Knowspace → OpenClaw Connect           │');
  console.log('  ╰─────────────────────────────────────────╯');

  const config = loadConfig();

  // Step 1 — Gateway
  console.log('\n  Step 1/2 — OpenClaw Gateway\n');
  const gw = await gateway.configureGateway(config);
  if (!gw) {
    prompts.warn('Cancelled');
    prompts.close();
    return;
  }
  config.openclawDir = gw.openclawDir;
  config.gatewayUrl = gw.url;

  // Step 2 — Install skill
  console.log('\n  Step 2/2 — Onboard Skill\n');

  const skillsTarget = enginePaths.getSkillsTargetPath();
  const skillDest = path.join(skillsTarget, SKILL_NAME);

  if (!fs.existsSync(SKILL_SRC)) {
    prompts.warn(`Skill source not found: ${SKILL_SRC}`);
    prompts.close();
    return;
  }

  const exists = fs.existsSync(skillDest);
  const action = exists ? 'Reinstall' : 'Install';

  const ok = await prompts.confirm(`${action} ${SKILL_NAME} to ${skillsTarget}?`, true);
  if (ok) {
    if (exists) fs.rmSync(skillDest, { recursive: true, force: true });
    fs.mkdirSync(skillsTarget, { recursive: true });
    fs.cpSync(SKILL_SRC, skillDest, {
      recursive: true,
      filter: (src) => !src.includes('__pycache__'),
    });
    prompts.success(`${SKILL_NAME} installed at ${skillDest}`);

    // Register in AGENTS.md
    const agentsMd = path.join(skillsTarget, '..', 'AGENTS.md');
    if (fs.existsSync(agentsMd)) {
      const content = fs.readFileSync(agentsMd, 'utf8');
      const ref = `- Skill: \`${skillDest}/\``;
      if (!content.includes(`/${SKILL_NAME}/`)) {
        fs.appendFileSync(agentsMd, `\n${ref}\n`);
        prompts.success('Registered in AGENTS.md');
      } else {
        prompts.info('Already registered in AGENTS.md');
      }
    } else {
      prompts.warn(`AGENTS.md not found at ${path.dirname(agentsMd)} — add manually:\n    - Skill: \`${skillDest}/\``);
    }
  }

  // Save
  saveConfig({ ...config, configured: config.configured ?? false });

  console.log('\n  ✓ Done\n');
  prompts.close();
};
