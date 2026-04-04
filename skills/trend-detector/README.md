# Trend Detector - Trend Monitor

## Description

Detects viral trends on X/Twitter and LinkedIn to feed content matrices with relevant and trending themes.

## Features

- **Trend detection**: Searches for viral posts about your niche
- **Hook analysis**: Identifies hook patterns that work
- **Theme suggestions**: Generates ready-to-use themes for content matrices
- **History**: Maintains cache of detected trends

## Commands

### 1. Detect - Detect Trends

```bash
# All sources, last 24h
python scripts/trend_detector.py detect --source all --hours 24

# Only X/Twitter
python scripts/trend_detector.py detect --source x --hours 12

# Only LinkedIn
python scripts/trend_detector.py detect --source linkedin --hours 48

# Filter by high virality
python scripts/trend_detector.py detect --source all --virality high

# Save to JSON
python scripts/trend_detector.py detect --source all --output trends.json
```

Output:
```
🔍 Detecting trends: all (24h)

📱 Searching X/Twitter...
   ⚠️  X_API_KEY not configured - using examples
   ✅ 2 posts found
💼 Searching LinkedIn...
   ⚠️  LINKEDIN_ACCESS_TOKEN not configured - using examples
   ✅ 2 posts found

📊 4 trends found
------------------------------------------------------------
🔥 [1] X
   Author: @comex_br (50,000 followers)
   Text: ⚠️ URGENT: New ordinance from SECEX changes LI deadlines. You have 30 days...
   Engagement: 15,420
   Category: regulatory
   Hook Pattern: ⚠️ URGENT: {context}. You have {deadline} to {action}...

📈 [2] X
   Author: @logistica_brasil (35,000 followers)
   Text: 📢 International freight increased 150% in 2024. What does this mean...
   Engagement: 8,900
   Category: macroeconomic
   Hook Pattern: 📢 {topic} {variation}. {question}...
```

### 2. Patterns - Analyze Hook Patterns

```bash
# Analyze last 7 days
python scripts/trend_detector.py patterns --source all --days 7

# Only X/Twitter
python scripts/trend_detector.py patterns --source x --days 30
```

Output:
```
🎣 Analyzing hook patterns: all (7 days)

🎣 4 patterns found
------------------------------------------------------------
1. ⚠️ URGENT: {context}. You have {deadline} to {action}
   Category: regulatory
   Virality Score: 7.5/10

2. 📢 {topic} {variation}. {question}
   Category: macroeconomic
   Virality Score: 7.5/10

3. GOLDEN TIP: After {context}, I learned that {lesson}
   Category: personal
   Virality Score: 7.5/10

4. I just {action}. {impact}. {structure}
   Category: regulatory
   Virality Score: 7.5/10
```

### 3. Suggest - Suggest Themes

```bash
# Generate 5 suggested themes
python scripts/trend_detector.py suggest --source all --limit 5

# Save themes to JSON
python scripts/trend_detector.py suggest --source all --output themes.json
```

Output:
```
💡 Generating theme suggestions: all

💡 5 themes suggested
------------------------------------------------------------
1. Ordinance
   Keywords: ordinance, li, license, deadline, secex
   Avg Engagement: 15420
   Suggested Framework: PAS

2. Freight
   Keywords: freight, import, china, exchange, international
   Avg Engagement: 8900
   Suggested Framework: INSIGHT

3. Import
   Keywords: import, china, negotiation
   Avg Engagement: 5600
   Suggested Framework: STORY
```

## Integration with Content Matrix

### Complete Workflow

```bash
# 1. Detect recent trends
cd {skill_dir}
python scripts/trend_detector.py suggest --output themes.json

# 2. Import themes into Content Matrix
cd ../content-matrix
python scripts/content_matrix.py generate --json ../trend-detector/themes.json

# 3. View queue
python scripts/content_matrix.py queue

# 4. Export to Buffer
python scripts/content_matrix.py export --buffer --upload
```

### Single Command

```bash
# Detect trends and generate content automatically
cd {workspace}

# Get theme in variable
THEME=$(python3 {skill_dir}/scripts/trend_detector.py suggest --limit 1 | jq -r '.[0].titulo')

# Generate content
python3 scripts/content_matrix.py generate --titulo "$THEME"
```

## API Configuration

### X API (Twitter)

```bash
# Get API key at https://developer.twitter.com/
export X_API_KEY="your_x_api_key"
```

### LinkedIn API

```bash
# LinkedIn requires OAuth 2.0
# More complex to configure
export LINKEDIN_ACCESS_TOKEN="your_linkedin_token"
```

**Note**: Without the APIs configured, Trend Detector uses example data for demonstration.

## Monitored Keywords

Trend Detector monitors 30+ keywords from the OPEX/COMEX niche:

| Category | Keywords |
|----------|----------|
| Regulatory | ordinance, normative instruction, official gazette, secex, rfb |
| Operational | duimp, ncm, customs, dispatch, li, license |
| Tax | tariff, tax, tribute, fee, drawback |
| Logistics | freight, container, logistics, transport |
| Macroeconomic | exchange rate, dollar, inflation, interest rates |
| Commercial | china, mercosur, agreement, export, import |

## Data Structures

### TrendingPost

```python
@dataclass
class TrendingPost:
    id: str
    source: str              # x, linkedin
    author: str
    author_followers: int
    text: str
    url: str
    engagement: int
    virality: str            # high, medium, low

    extracted_keywords: List[str]
    hook_pattern: str
    content_category: str
```

### HookPattern

```python
@dataclass
class HookPattern:
    pattern: str             # "⚠️ URGENT: {context}..."
    category: str            # regulatory, geopolitical, etc
    virality_score: float    # 0-10
    usage_count: int
    examples: List[str]
```

## Cache and History

Detected trends are saved in:

```
{workspace}/.openclaw/trend-detector/cache/
├── trend_history.json     # Post history
└── hook_patterns.json     # Identified patterns
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

## Roadmap

- [ ] Real integration with X API v2
- [ ] Integration with LinkedIn API
- [ ] Automatic detection of new patterns with NLP
- [ ] Niche influencer ranking
- [ ] Real-time alerts for emerging trends
