/**
 * Skill discovery, installation, and configuration.
 * Reads requires_env and requires_skills from SKILL.md frontmatter.
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const prompts = require('./prompts');
const env = require('./env');
const enginePaths = require('../../adapters/engine/paths');

const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

function listAvailableSkills() {
  try {
    return fs.readdirSync(SKILLS_DIR)
      .filter(d => {
        const skillMd = path.join(SKILLS_DIR, d, 'SKILL.md');
        return fs.existsSync(skillMd);
      })
      .map(d => parseSkillManifest(d))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseSkillManifest(skillName) {
  const skillMd = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  try {
    const content = fs.readFileSync(skillMd, 'utf8');
    const { data } = matter(content);
    return {
      name: data.name || skillName,
      dirName: skillName,
      description: (data.description || '').split('.')[0], // first sentence
      requiresEnv: data.requires_env || [],
      requiresSkills: data.requires_skills || [],
    };
  } catch {
    return {
      name: skillName,
      dirName: skillName,
      description: '',
      requiresEnv: [],
      requiresSkills: [],
    };
  }
}

function isSkillInstalled(skillName, skillsTarget) {
  return fs.existsSync(path.join(skillsTarget, skillName));
}

function installSkill(skillName, skillsTarget) {
  const src = path.join(SKILLS_DIR, skillName);
  const dest = path.join(skillsTarget, skillName);

  if (!fs.existsSync(src)) {
    prompts.warn(`Skill ${skillName} not found in bundled skills`);
    return false;
  }

  if (!fs.existsSync(skillsTarget)) {
    fs.mkdirSync(skillsTarget, { recursive: true });
  }

  fs.cpSync(src, dest, {
    recursive: true,
    filter: (source) => !source.includes('__pycache__'),
  });

  // Add skill reference to AGENTS.md in the workspace so the agent knows about it
  const agentsMd = path.join(skillsTarget, '..', 'AGENTS.md');
  if (fs.existsSync(agentsMd)) {
    const content = fs.readFileSync(agentsMd, 'utf8');
    const skillRef = `- Skill: \`${skillsTarget}/${skillName}/\``;
    if (!content.includes(`/${skillName}/`)) {
      fs.appendFileSync(agentsMd, `\n${skillRef}\n`);
    }
  }

  return true;
}

async function configureSkillKeys(skill) {
  if (!skill.requiresEnv || skill.requiresEnv.length === 0) {
    return;
  }

  prompts.info(`\n    ${skill.name} environment keys:\n`);

  for (const envReq of skill.requiresEnv) {
    const current = env.getKey(envReq.key);
    const reqLabel = envReq.required ? '(required)' : '(optional)';

    if (current) {
      const masked = current.substring(0, 8) + '...' + current.substring(current.length - 4);
      const keep = await prompts.confirm(
        `${envReq.key} ${reqLabel} — current: ${masked}. Keep?`,
        true
      );
      if (keep) continue;
    }

    const desc = envReq.description ? ` — ${envReq.description}` : '';
    const value = await prompts.askSecret(`${envReq.key}${desc} ${reqLabel}`);

    if (value) {
      env.setKey(envReq.key, value);
      prompts.success(`${envReq.key} saved`);
    } else if (envReq.required) {
      prompts.warn(`${envReq.key} is required but was skipped`);
    }
  }
}

async function interactiveSkillSetup(config) {
  const skills = listAvailableSkills();
  if (skills.length === 0) {
    prompts.warn('No skills found');
    return [];
  }

  const skillsTarget = enginePaths.getSkillsTargetPath();
  const installed = (config.installedSkills || []);

  const options = skills.map(s => {
    const isInstalled = installed.includes(s.dirName);
    return {
      label: s.name + (isInstalled ? ' (installed)' : ''),
      description: s.description,
    };
  });

  const preSelected = skills
    .map((s, i) => installed.includes(s.dirName) ? i : -1)
    .filter(i => i >= 0);

  const selectedIdx = await prompts.multiSelect('Select skills to install', options, preSelected);

  const selectedSkills = [];
  for (const idx of selectedIdx) {
    const skill = skills[idx];
    selectedSkills.push(skill.dirName);

    if (!isSkillInstalled(skill.dirName, skillsTarget)) {
      if (installSkill(skill.dirName, skillsTarget)) {
        prompts.success(`${skill.name} installed`);
      }
    }

    await configureSkillKeys(skill);
  }

  // Sync env to openclaw
  env.syncEnv();

  return selectedSkills;
}

module.exports = {
  listAvailableSkills,
  parseSkillManifest,
  isSkillInstalled,
  installSkill,
  configureSkillKeys,
  interactiveSkillSetup,
};
