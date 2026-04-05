const { parseArgs } = require('node:util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AuthManager = require('../middleware/auth');
const enginePaths = require('../adapters/engine/paths');

const SKILLS = [
  'client-onboard',
  'instagram-carousel',
  'content-matrix',
  'trend-detector',
  'linkedin_post',
  'herenow',
];

const DEFAULT_SKILLS_TARGET = enginePaths.getSkillsTargetPath();

module.exports = function onboard(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: 'string', short: 'o' },
      'skills-target': { type: 'string' },
      'skip-skills': { type: 'boolean' },
      'skip-token': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
  knowspace onboard - Onboard a client

  Usage:
    knowspace onboard <slug> [options]

  Installs skills to the engine, outputs workspace templates,
  and generates a portal access token.

  Options:
    --output, -o <dir>          Write templates to directory (default: print to stdout)
    --skills-target <path>      Engine skills directory (default: auto-detected)
    --skip-skills               Skip skill installation
    --skip-token                Skip token generation
    --help, -h                  Show this help

  Examples:
    knowspace onboard acme-corp
    knowspace onboard acme-corp --output ~/acme-corp/workspace
    knowspace onboard acme-corp --skills-target /opt/engine/skills
`);
    return;
  }

  const slug = positionals[0];
  if (!slug) {
    console.error('Usage: knowspace onboard <slug>');
    console.error('Run knowspace onboard --help for details.');
    process.exit(1);
  }

  const skillsTarget = values['skills-target'] || DEFAULT_SKILLS_TARGET;
  const repoRoot = path.join(__dirname, '..');

  // --- 1. Install skills ---
  if (!values['skip-skills']) {
    installSkills(repoRoot, skillsTarget);
  }

  // --- 2. Templates ---
  const templateVars = buildTemplateVars(slug);
  if (values.output) {
    writeTemplates(repoRoot, values.output, templateVars);
  } else {
    printTemplates(repoRoot, templateVars);
  }

  // --- 3. Generate token ---
  if (!values['skip-token']) {
    generateToken(repoRoot, slug);
  }

  // --- 4. Workspace check ---
  const workspacePath = path.join(os.homedir(), slug, 'workspace');
  if (!fs.existsSync(workspacePath)) {
    console.log(`  \u26a0  Workspace not found at ${workspacePath}`);
    console.log('     Create it via the main agent before the client can use the portal.\n');
  } else {
    console.log(`  Workspace: ${workspacePath}\n`);
  }
};

function installSkills(repoRoot, target) {
  if (!fs.existsSync(target)) {
    console.error(`\n  ERROR: Skills target directory not found: ${target}`);
    console.error('  Is the engine installed? Use --skills-target to specify the correct path.\n');
    process.exit(1);
  }

  console.log('\n  Installing skills...\n');
  const skillsSource = path.join(repoRoot, 'skills');

  for (const skill of SKILLS) {
    const src = path.join(skillsSource, skill);
    const dest = path.join(target, skill);

    if (!fs.existsSync(src)) {
      console.log(`    SKIP  ${skill} (not found in repo)`);
      continue;
    }

    fs.cpSync(src, dest, {
      recursive: true,
      filter: (source) => !source.includes('__pycache__'),
    });
    console.log(`    OK    ${skill}`);
  }
  console.log();
}

function buildTemplateVars(slug) {
  const titleCase = slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return {
    slug,
    client_name: titleCase,
    agent_name: `${titleCase} Assistant`,
    display_name: titleCase,
    timezone: 'UTC',
    business_context: '(to be filled by administrator)',
    vibe_description: 'Concise, helpful, professional',
    date: new Date().toISOString().split('T')[0],
  };
}

function renderTemplate(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

function writeTemplates(repoRoot, outputDir, vars) {
  const templatesDir = path.join(repoRoot, 'templates');
  const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.md'));

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`  Writing templates to ${outputDir}:\n`);
  for (const file of files) {
    const content = fs.readFileSync(path.join(templatesDir, file), 'utf-8');
    const rendered = renderTemplate(content, vars);
    fs.writeFileSync(path.join(outputDir, file), rendered);
    console.log(`    OK    ${file}`);
  }
  console.log();
}

function printTemplates(repoRoot, vars) {
  const templatesDir = path.join(repoRoot, 'templates');
  const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.md'));

  console.log('  --- Templates (customize and save to workspace) ---\n');
  for (const file of files) {
    const content = fs.readFileSync(path.join(templatesDir, file), 'utf-8');
    const rendered = renderTemplate(content, vars);
    console.log(`  ===== ${file} =====`);
    console.log(rendered);
    console.log();
  }
}

function generateToken(repoRoot, slug) {
  const tokensPath = path.join(repoRoot, '.tokens.json');
  const auth = new AuthManager(tokensPath);
  const token = auth.generateToken(slug);

  const baseUrl = process.env.KNOWSPACE_BASE_URL || 'http://localhost:3445';
  console.log(`  === Portal Token ===

  Client:  ${slug}
  Token:   ${token}
  Link:    ${baseUrl}/auth?token=${token}
`);
}
