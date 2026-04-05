/**
 * Workspace configuration: SOUL.md, USER.md, AGENTS.md, IDENTITY.md
 * Collects user info and renders templates.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const prompts = require('./prompts');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function collectWorkspaceInfo(existing = {}) {
  prompts.heading('Workspace');

  const slug = await prompts.ask('Client slug', existing.slug || '');
  if (!slug) {
    prompts.warn('Slug is required');
    return null;
  }

  const clientName = await prompts.ask('Client name', existing.clientName || titleCase(slug));
  const agentName = await prompts.ask('Agent name', existing.agentName || `${clientName} Assistant`);
  const timezone = await prompts.ask('Timezone', existing.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const businessContext = await prompts.ask('Business context', existing.businessContext || '');
  const vibeDescription = await prompts.ask('Brand voice', existing.vibeDescription || 'Concise, helpful, professional');

  return {
    slug,
    clientName,
    agentName,
    displayName: clientName,
    timezone,
    businessContext,
    vibeDescription,
    date: new Date().toISOString().split('T')[0],
  };
}

function renderTemplate(content, vars) {
  let result = content;
  const map = {
    slug: vars.slug,
    client_name: vars.clientName,
    agent_name: vars.agentName,
    display_name: vars.displayName,
    timezone: vars.timezone,
    business_context: vars.businessContext,
    vibe_description: vars.vibeDescription,
    date: vars.date,
  };
  for (const [key, value] of Object.entries(map)) {
    if (value) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
  }
  return result;
}

function writeTemplates(workspacePath, vars) {
  const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));

  fs.mkdirSync(workspacePath, { recursive: true });

  for (const file of files) {
    const dest = path.join(workspacePath, file);
    // Don't overwrite existing files unless user confirms
    if (fs.existsSync(dest)) continue;

    const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
    const rendered = renderTemplate(content, vars);
    fs.writeFileSync(dest, rendered);
    prompts.success(`Created ${file}`);
  }
}

function getWorkspacePath(slug) {
  return path.join(os.homedir(), slug, 'workspace');
}

function hasWorkspaceTemplates(workspacePath) {
  return fs.existsSync(path.join(workspacePath, 'SOUL.md')) &&
         fs.existsSync(path.join(workspacePath, 'USER.md'));
}

async function setupWorkspace(config) {
  const info = await collectWorkspaceInfo(config);
  if (!info) return null;

  const workspacePath = getWorkspacePath(info.slug);

  if (!hasWorkspaceTemplates(workspacePath)) {
    const doWrite = await prompts.confirm(`Write templates to ${workspacePath}?`, true);
    if (doWrite) {
      writeTemplates(workspacePath, info);
    }
  } else {
    prompts.info(`Workspace templates already exist at ${workspacePath}`);
    const overwrite = await prompts.confirm('Regenerate templates? (existing files will be kept)', false);
    if (overwrite) {
      writeTemplates(workspacePath, info);
    }
  }

  return info;
}

module.exports = {
  collectWorkspaceInfo,
  renderTemplate,
  writeTemplates,
  getWorkspacePath,
  hasWorkspaceTemplates,
  setupWorkspace,
};
