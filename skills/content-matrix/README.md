# Content Matrix v3.0 - CLI

## Description

Main interface for the Content Matrix v3.0 system. Generate content, monitor sources, manage queue, and export to Buffer with simple commands.

## Configuration

```bash
# Buffer API (uses the same token as the Buffer skill)
export BUFFER_API_KEY="your_token_here"

# Replicate API (for Designer skill)
export REPLICATE_API_TOKEN="your_token_here"

# Optional: Override skills path (auto-detected by default)
export CONTENT_MATRIX_SKILLS_PATH="/path/to/skills/public"

# Optional: Workspace for state storage (auto-detected by default)
export OPENCLAW_WORKSPACE="/path/to/workspace"
```

**Note**: Content Matrix uses the same tokens as existing skills. If you've already configured the Buffer skill, `BUFFER_API_KEY` should already be available.

## Commands

### 1. Generate - Manual Content Generation

```bash
python content_matrix.py generate --titulo "DUIMP Ordinance 30 days"
```

Output:
```
🎯 Generating manual content...

📦 IG-FAQ-OPERACION-portaria_duimp_30_dias
   [HIGH] FAQ → instagram
   SEO: 75/100 | Images: 4
```

### 2. Monitor - Monitor Sources

```bash
python content_matrix.py monitor --source all --hours 24
```

Available sources:
- `all` - All sources
- `dou` - Government sites only
- `google` - Google Alerts only

### 3. Queue - View Queue

```bash
python content_matrix.py queue
```

Output:
```
📦 Queue: 3 packages
------------------------------------------------------------
1. [CRITICAL] LI-PAS-REGULATORIO-portaria_duimp
   PAS → linkedin | SEO: 78/100
2. [HIGH] IG-INSIGHT-GEOPOLITICO-tarifas_china
   INSIGHT → instagram | SEO: 82/100
3. [MEDIUM] LI-STORY-PESSOAL-minha_jornada
   STORY → linkedin | SEO: 65/100
```

### 4. Export - Export to Buffer

```bash
python content_matrix.py export --buffer --output buffer_drafts.json
```

Generates JSON file ready for Buffer upload.

### 5. Status - System Status

```bash
python content_matrix.py status
```

Output:
```
📊 Content Matrix v3.0 - Status
============================================================

Components:
  classifier: ✅
  ghostwriter: ✅
  builder: ✅
  seo_analyzer: ✅ (integrated existing skill)
  designer: ✅ (integrated existing skill)
  buffer: ⚠️ (configure BUFFER_API_KEY)

Queue: 3 packages
Ready for Buffer: 3

Balance:
  reactive: 2 (66.7%)
  evergreen: 1 (33.3%)

Paths:
  Skills: /path/to/skills/public
  State: /path/to/workspace/.openclaw/content-matrix
```

## Usage Examples

### Generate content about DOU news

```bash
python content_matrix.py generate \
  --titulo "Portaria SECEX 123 altera DUIMP" \
  --conteudo "Prazo de 30 dias para adaptação" \
  --fonte "dou.gov.br"
```

### Monitor and generate automatically

```bash
# Monitor DOU from last 24h
python content_matrix.py monitor --source dou --hours 24

# Monitor all sources
python content_matrix.py monitor --source all --hours 24
```

### View detailed queue

```bash
python content_matrix.py queue --verbose
```

### Export to Buffer

```bash
# Export to Buffer format (saves JSON)
python content_matrix.py export --buffer

# Save to file
python content_matrix.py export --buffer --output drafts.json

# Send directly to Buffer as drafts
python content_matrix.py export --buffer --upload
```

**Note**: The `--upload` command uses the existing Buffer GraphQL skill and requires `BUFFER_API_KEY` configured.

### Detect Viral Trends

```bash
# Detect trends (list only)
python content_matrix.py detect-trends --source all --hours 24

# Detect trends and generate content automatically
python content_matrix.py detect-trends --source all --suggest --limit 3
```

### System Status

```bash
python content_matrix.py status
```

## Directory Structure

```
skills/content-matrix/
├── scripts/
│   └── content_matrix.py  # Main CLI
├── SKILL.md               # Skill documentation
└── README.md              # This file
```

## State Storage

State files are stored in: `{workspace}/.openclaw/content-matrix/`

This includes:
- `buffer_export.json` - Last Buffer export
- `upload_history.json` - History of Buffer uploads
- Other cache and state files

## Integrated Skills Structure

```
skills/public/
├── content-classifier/     # Classification
├── news-monitor/           # DOU monitoring
├── email-alerts-reader/    # Google Alerts
├── seo-analyzer/           # SEO
├── designer/               # Visuals
├── ghostwriter-v3/         # Text generation
├── content-builder/        # Orchestrator
└── content-matrix/         # Main CLI ← YOU ARE HERE
```

## Complete Flow

```
User executes:
  python content_matrix.py generate --titulo "..."
        ↓
Content Matrix CLI:
  1. Classifies theme (Content Classifier)
  2. Generates text (Ghostwriter v3.0)
  3. Optimizes SEO (SEO Analyzer)
  4. Generates visuals (Designer v2.0)
  5. Combines everything (Content Builder)
        ↓
Output:
  Content Package ready for Buffer
```

## Environment Variables

- `BUFFER_API_KEY` - Buffer API token (for uploads)
- `REPLICATE_API_TOKEN` - Replicate API token (for Designer)
- `CONTENT_MATRIX_SKILLS_PATH` - Override skills location
- `OPENCLAW_WORKSPACE` - Workspace directory for state storage

## Troubleshooting

### Missing optional skills

If optional skills (designer, seo-analyzer, trend-detector) are not available, you'll see warnings but core functionality will work.

### Buffer upload fails

1. Verify `BUFFER_API_KEY` is set
2. Check Buffer skill is installed
3. Verify API key has correct permissions

### State files location

If you need to change where state files are stored:
```bash
export OPENCLAW_WORKSPACE=/your/custom/path
```

## Content Package Format

Each package includes:
- **Content Code**: `{CHANNEL}-{FRAMEWORK}-{TYPE}-{SLUG}`
- **Priority**: CRITICAL | HIGH | MEDIUM | LOW
- **Framework**: FAQ | INSIGHT | STORY | HOW_TO | etc.
- **Channel**: instagram | linkedin | twitter | etc.
- **SEO Score**: 0-100
- **Body**: Full text content
- **Images**: Generated visuals
- **Hashtags**: Optimized tags
