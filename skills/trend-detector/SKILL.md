# Trend Detector Skill

## Description

Detects viral trends using multiple sources and delivers analysis to Telegram for manual review and content strategy planning.

## Trend Sources

| Source | Description | Configuration | Recommendation |
|--------|-------------|---------------|----------------|
| **Buffer** | Analyzes published posts with engagement metrics | Uses `BUFFER_API_KEY` | ✅ **RECOMMENDED** |
| **Perplexity** | Real-time trend search | `PERPLEXITY_API_KEY` | ✅ Excellent for discovery |
| X/Twitter | Direct X API | `X_API_KEY` | ⚠️ Requires paid API key |
| LinkedIn | Direct LinkedIn API | `LINKEDIN_ACCESS_TOKEN` | ⚠️ Complex to configure |

## Features

### 1. Buffer Trend Analyzer (RECOMMENDED)
Analyzes posts already published on Buffer to identify:
- Posts with highest engagement
- Hook patterns that work
- Best posting times
- Most popular themes

### 2. Perplexity Trend Detector
Searches for real-time trends using Perplexity API:
- Discovery of new topics
- Recent news analysis
- Current trending topics

### 3. Hook Pattern Analysis
Identifies hook patterns that generate more engagement:
- "⚠️ URGENT: {context}. You have {deadline} to {action}"
- "📢 {topic} {variation}. {question}"
- "GOLDEN TIP: After {context}, I learned that {lesson}"

### 4. Theme Suggestions
Generates suggested themes for content matrices.

### 5. Telegram Delivery
Delivers trend analysis to Telegram for manual review:
- Trend analysis results
- Recommended hooks/angles
- Source links
- Actionable insights

## Usage

### Detect trends from Buffer (RECOMMENDED)

```bash
cd {skill_dir}
python scripts/trend_detector.py detect --source buffer --days 30
```

### Detect trends with Perplexity

```bash
python scripts/trend_detector.py detect --source perplexity --results 5
```

### Analyze Buffer separately

```bash
python scripts/buffer_trend_analyzer.py analyze --days 30

# Top posts
python scripts/buffer_trend_analyzer.py analyze --days 30 --limit 10

# Hooks performance
python scripts/buffer_trend_analyzer.py hooks --days 30

# Trending keywords
python scripts/buffer_trend_analyzer.py keywords --days 30
```

### Search with Perplexity separately

```bash
# Specific search
python scripts/perplexity_trends.py search --query "import trends 2024"

# Trending keywords
python scripts/perplexity_trends.py keywords --limit 10

# Suggest themes
python scripts/perplexity_trends.py suggest --limit 5
```

### Generate themes for Content Matrix

```bash
# Suggest themes
python scripts/trend_detector.py suggest --source buffer --limit 5
```

### Send trend analysis to Telegram

```bash
# Detect trends and save to file
python scripts/trend_detector.py detect --source buffer --days 30 --output trends.json

# Send to Telegram for review
python scripts/telegram_delivery.py send --trends-file trends.json

# Send to specific chat
python scripts/telegram_delivery.py send --trends-file trends.json --chat-id -1001234567890

# Format without sending (preview)
python scripts/telegram_delivery.py format --trends-file trends.json
```

### Send hook patterns to Telegram

```bash
# Analyze patterns
python scripts/trend_detector.py patterns --source buffer --days 30 --output patterns.json

# Send to Telegram
python scripts/telegram_delivery.py send-patterns --patterns-file patterns.json
```

### Send trending keywords to Telegram

```bash
# Analyze keywords
python scripts/buffer_trend_analyzer.py keywords --days 30 > keywords.json

# Send to Telegram
python scripts/telegram_delivery.py send-keywords --keywords-file keywords.json
```

## Workflow

### Recommended Workflow for Trend Analysis

1. **Detect Trends**: Analyze Buffer posts or use Perplexity for real-time trends
   ```bash
   python scripts/trend_detector.py detect --source buffer --days 30 --output trends.json
   ```

2. **Review on Telegram**: Results are sent to Telegram for manual review
   ```bash
   python scripts/telegram_delivery.py send --trends-file trends.json
   ```

3. **Analyze Hook Patterns**: Identify which hook styles perform best
   ```bash
   python scripts/trend_detector.py patterns --source buffer --days 30 --output patterns.json
   python scripts/telegram_delivery.py send-patterns --patterns-file patterns.json
   ```

4. **Identify Trending Keywords**: Find which keywords drive engagement
   ```bash
   python scripts/buffer_trend_analyzer.py keywords --days 30
   ```

5. **Manual Decision**: Review insights on Telegram and decide which trends to pursue

6. **Content Creation**: Use approved trends to create content manually or with other skills

## Configuration

```bash
# Buffer (already configured)
export BUFFER_API_KEY="your_token"  # Already existing in your environment

# Perplexity (optional - get at https://www.perplexity.ai/)
export PERPLEXITY_API_KEY="your_perplexity_token"

# Telegram (required for delivery)
export TELEGRAM_BOT_TOKEN="your_bot_token"
export TELEGRAM_CHAT_ID="your_chat_id"  # Optional: default chat for delivery
```

## Integration with Content Matrix

```bash
cd {workspace}

# Detect trends from Buffer (list only)
python scripts/content_matrix.py detect-trends --source buffer --days 30

# Detect trends AND generate content automatically
python scripts/content_matrix.py detect-trends --source buffer --suggest --limit 3
```

## Telegram Message Format

Trend analysis sent to Telegram includes:

### 📊 Trend Report Structure
- **Header**: Analysis timestamp and source
- **Top 5 Trends**: Each with:
  - Hook pattern identified
  - Content category
  - Engagement metrics
  - Source link (when available)
  - Preview text
  - Keywords
- **Actionable Insights**: Recommendations based on analysis
- **Interactive Footer**: Commands for content creation

### 💡 Insight Types
- Category focus recommendations
- High-performing hook patterns
- Virality alerts
- Engagement benchmarks
- Timing recommendations

## Monitored Keywords

- **Regulatory**: ordinance, normative instruction, official gazette, secex, rfb
- **Operational**: duimp, ncm, customs, dispatch, li, license
- **Tax**: tariff, tax, tribute, drawback
- **Logistics**: freight, container, logistics, transport
- **Macroeconomic**: exchange rate, dollar, inflation, interest rates
- **Commercial**: china, mercosur, agreement, export, import

## File Structure

```
{skill_dir}/
├── scripts/
│   ├── trend_detector.py        # Main CLI (all sources)
│   ├── buffer_trend_analyzer.py # Buffer analyzer
│   ├── perplexity_trends.py     # Perplexity search
│   └── telegram_delivery.py     # Telegram delivery
├── references/
│   └── (documentation files)
├── SKILL.md                     # This file
└── README.md
```

## Vault Structure

Cache files are stored in the workspace vault:

```
{workspace}/vault/trend-detector/cache/
├── trend_history.json     # Post history
└── hook_patterns.json     # Identified patterns
```

The vault pattern keeps all skill data isolated and persistent across sessions.

## Example Telegram Output

```
📊 *TREND ANALYSIS REPORT*
_Generated: 2024-01-15 14:30_
_Source: BUFFER_

Found *15* trending topics

🔥 *TREND #1*

🎣 *Hook Pattern:* `alerta_urgente`
📂 *Category:* Regulatory
💫 *Engagement:* 850
🔗 *Source:* [View Original](https://buffer.com/...)
📝 *Preview:*
_⚠️ URGENT: New ordinance from SECEX changes LI deadlines..._
🏷 *Keywords:* portaria, secex, li, prazos

──────────────────────

💡 *ACTIONABLE INSIGHTS*

• *Regulatory* content trending - consider focusing here
• `alerta_urgente` hook performing well - replicate this style
• *3* high-virality trends found - prioritize these
• Average engagement: *520* - aim above this
• Post during peak hours for maximum reach

──────────────────────

_Reply to approve content creation or provide feedback_
_Use /create-content <trend_number> to generate posts_
```

## Customization

The skill monitors keywords related to foreign trade (COMEX) by default. To customize for other niches:

1. Edit `scripts/trend_detector.py`
2. Modify the `COMEX_KEYWORDS` list with your niche keywords
3. Update the `COMEX_KEYWORDS` list in `scripts/buffer_trend_analyzer.py` as well

## Dependencies

- Python 3.7+
- Buffer skill (optional, for Buffer integration)
- Perplexity skill (optional, for Perplexity integration)
- `BUFFER_API_KEY` environment variable (for Buffer)
- `PERPLEXITY_API_KEY` environment variable (for Perplexity)
- `TELEGRAM_BOT_TOKEN` environment variable (required for Telegram delivery)
- `TELEGRAM_CHAT_ID` environment variable (optional, default chat for delivery)
- `aiohttp` Python package (for Telegram API calls)
