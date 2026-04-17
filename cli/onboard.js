const { parseArgs } = require('node:util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AuthManager = require('../middleware/auth');

module.exports = function onboard(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      output: { type: 'string', short: 'o' },
      'skip-token': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
  knowspace onboard - Set up workspace templates and a portal token (legacy)

  This command pre-dates the v2 multi-provider rewrite. It is kept for
  workspace template scaffolding and one-shot token generation. Skill
  installation was removed — use the provider/agent CLI instead:

    knowspace providers list
    knowspace agents add <id> --cmd <binary> [...]

  Usage:
    knowspace onboard <slug> [options]

  Options:
    --output, -o <dir>          Write templates to directory (default: print to stdout)
    --skip-token                Skip token generation
    --help, -h                  Show this help
`);
    return;
  }

  const slug = positionals[0];
  if (!slug) {
    console.error('Usage: knowspace onboard <slug>');
    console.error('Run knowspace onboard --help for details.');
    process.exit(1);
  }

  const repoRoot = path.join(__dirname, '..');

  // --- 1. Templates ---
  const templateVars = buildTemplateVars(slug);
  if (values.output) {
    writeTemplates(repoRoot, values.output, templateVars);
  } else {
    printTemplates(repoRoot, templateVars);
  }

  // --- 2. Generate token ---
  if (!values['skip-token']) {
    generateToken(repoRoot, slug);
  }

  // --- 3. Workspace check ---
  const workspacePath = path.join(os.homedir(), slug, 'workspace');
  if (!fs.existsSync(workspacePath)) {
    console.log(`  \u26a0  Workspace not found at ${workspacePath}`);
    console.log('     Create it manually if you intend to use it as a vault.\n');
  } else {
    console.log(`  Workspace: ${workspacePath}\n`);
  }
};

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
  const templatesDir = path.join(repoRoot, 'templates', 'client');
  const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.md'));

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'vault'), { recursive: true });

  console.log(`  Writing templates to ${outputDir}:\n`);
  for (const file of files) {
    const content = fs.readFileSync(path.join(templatesDir, file), 'utf-8');
    const rendered = renderTemplate(content, vars);
    fs.writeFileSync(path.join(outputDir, file), rendered);
    console.log(`    OK    ${file}`);
  }
  console.log(`    OK    vault/`);
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
