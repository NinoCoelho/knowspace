---
name: content-matrix
description: Content Matrix v3.0 - CLI for automated content generation, curation, and distribution.
requires_env:
  - key: REPLICATE_API_TOKEN
    description: Replicate API for image generation via Designer skill
    required: false
  - key: BUFFER_API_KEY
    description: Buffer API for social media scheduling
    required: false
requires_skills:
  - name: content-classifier
    required: true
  - name: ghostwriter-v3
    required: true
  - name: content-builder
    required: true
  - name: designer
    required: false
  - name: trend-detector
    required: false
---

# content-matrix

Content Matrix v3.0 - CLI for automated content generation, curation, and distribution.

## Description

A unified CLI interface that orchestrates multiple content skills to generate, classify, monitor, and export content automatically. Content is delivered via Telegram for manual review before publishing to social media platforms.

## Installation

This skill requires several companion skills to be available:
- content-classifier
- ghostwriter-v3
- content-builder
- seo-analyzer (optional)
- designer (optional)
- trend-detector (optional)
- news-monitor (optional)
- email-alerts-reader (optional)

## Configuration

Set environment variables for API integrations:

```bash
# Replicate API (for Designer skill - optional)
export REPLICATE_API_TOKEN="your_token_here"
```

No API keys required for core functionality. Content is exported for manual publishing.

## Commands

### Generate Content Manually

```bash
python content_matrix.py generate --titulo "Portaria DUIMP 30 dias"
```

Options:
- `--titulo` (required): Title/topic for content
- `--conteudo`: Additional content/context
- `--fonte`: Source identifier (default: manual)
- `--verbose`, `-v`: Detailed output

### Monitor Sources

```bash
# Monitor all sources for last 24 hours
python content_matrix.py monitor --source all --hours 24

# Monitor only government sources (DOU)
python content_matrix.py monitor --source dou --hours 48

# Monitor only Google Alerts
python content_matrix.py monitor --source google --hours 12
```

Options:
- `--source`: `all`, `dou`, or `google` (default: all)
- `--hours`: Hours to look back (default: 24)
- `--export`: Export to JSON file

### View Queue

```bash
# Basic queue view
python content_matrix.py queue

# Detailed view
python content_matrix.py queue --verbose
```

### Export for Manual Review

```bash
# Export to Telegram format for manual review
python content_matrix.py export --telegram --limit 5

# Export to JSON file (for external tools)
python content_matrix.py export --buffer --output drafts.json
```

Options:
- `--telegram`: Export in Telegram format (clean, ready-to-post format)
- `--buffer`: Export in Buffer-compatible JSON format
- `--output`: Save to file
- `--limit`: Limit number of packages to export

**Telegram Format Includes:**
- Platform indicator (Instagram/LinkedIn/Twitter)
- Clean post text (ready for copy/paste)
- Hashtags
- Media information
- Suggested posting time
- Content metadata (framework, priority, SEO score)

### Detect Viral Trends

```bash
# List trends only
python content_matrix.py detect-trends --source all --hours 24

# Generate content from top trends
python content_matrix.py detect-trends --source buffer --suggest --limit 3
```

Options:
- `--source`: `x`, `linkedin`, `buffer`, `perplexity`, or `all` (default: buffer)
- `--hours`: Hours to search (for x/linkedin)
- `--days`: Days to search (for buffer)
- `--suggest`: Generate content from detected trends
- `--limit`: Max themes to generate (default: 3)

### System Status

```bash
python content_matrix.py status
```

Shows:
- Component availability
- Queue size
- Content balance (reactive vs evergreen)
- Ready-to-export count

## Vault Structure

State files use the vault pattern for persistent storage:

**Base directory:** `{workspace}/vault/content-matrix/`

**State files:**
- `vault/content-matrix/queue.json` — Content queue cache
- `vault/content-matrix/history.json` — Export and generation history
- `vault/content-matrix/packages/` — Generated content packages
- `vault/content-matrix/telegram_export.txt` — Latest Telegram export
- `vault/content-matrix/buffer_export.json` — Latest Buffer JSON export

The vault pattern separates skill state from configuration, keeping `{workspace}/.openclaw/` clean for settings only.

## Architecture

```
Content Matrix CLI
├── Content Classifier (categorizes themes)
├── Ghostwriter v3 (generates text)
├── Content Builder (orchestrates assembly)
├── SEO Analyzer (optimizes content) [optional]
├── Designer (creates visuals) [optional]
└── Trend Detector (viral content) [optional]
```

## Output Format

Each content package includes:
- **Content Code**: `{CHANNEL}-{FRAMEWORK}-{TYPE}-{SLUG}`
- **Priority**: CRITICAL | HIGH | MEDIUM | LOW
- **Framework**: FAQ | INSIGHT | STORY | HOW_TO | etc.
- **Channel**: instagram | linkedin | twitter | etc.
- **SEO Score**: 0-100
- **Body**: Full text content
- **Images**: Generated visuals
- **Hashtags**: Optimized tags

## Example Workflow

```bash
# 1. Check system status
python content_matrix.py status

# 2. Monitor sources and generate content
python content_matrix.py monitor --source all --hours 24

# 3. Review queue
python content_matrix.py queue --verbose

# 4. Export for manual review
python content_matrix.py export --telegram

# 5. Review content in Telegram output

# 6. Manually copy/paste and publish to platforms
```

**Publishing Process:**
1. Content is generated and queued locally
2. Export to Telegram format for easy review
3. Copy post text from Telegram output
4. Attach media files manually
5. Publish to Instagram, LinkedIn, Twitter, etc.
6. Maintain full control over what gets published and when

## Error Handling

- Missing optional skills show warnings but don't block core functionality
- API errors are caught and reported with actionable messages
- Partial failures in batch operations are logged individually
