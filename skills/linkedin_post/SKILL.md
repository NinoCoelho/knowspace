---
name: linkedin_post
description: Complete LinkedIn post generation with professional banners. Generates landscape banners (1200x627) + long-form copy (300-500 words) using PAS, Story-Result, or Insight-Value frameworks. Captions start with strong hook in first 2 lines, follow professional structure (paragraphs with data), end with clear CTA + LinkedIn hashtags. Use when creating LinkedIn posts with professional banners, data-driven long-form copy, and LinkedIn-optimized hashtags. Delivers to Telegram for manual review.
requires_env:
  - key: REPLICATE_API_TOKEN
    description: Replicate API for banner generation via Designer skill
    required: true
  - key: GHOSTWRITER_PATH
    description: Path to ghostwriter skill for authentic voice
    required: false
requires_skills:
  - name: designer
    required: true
---

# LinkedIn Post Generator

Complete system for LinkedIn content generation with professional banners and long-form copy.

**Telegram Delivery:** Generated posts are delivered to Telegram for manual review before publishing.

## Quick Start

### Option 1: Use Custom Hook

```bash
python3 scripts/linkedin_post_generator.py "Your custom hook here"
```

**Result:**
- 1 professional banner (1200x627, 1.91:1 landscape)
- Long-form caption (300-500 words)
- PAS framework (Problem → Agitation → Solution → CTA)
- LinkedIn-optimized hashtags (5-10)
- Delivered to Telegram for review

### Option 2: Custom Hook + Framework + CTA

```bash
python3 scripts/linkedin_post_generator.py "Your hook" --framework story --cta "DM 'YOUR_CTA'"
```

### Option 3: Generate for Copy/Paste

```bash
python3 scripts/linkedin_post_generator.py "Your hook" --format copy
```

Outputs clean text ready to copy directly to LinkedIn.

## Telegram Delivery Format

Generated posts are delivered to Telegram with the following structure:

```
💼 LinkedIn Post Ready

🎨 Framework: PAS (Problem-Agitation-Solution)
📏 Caption: 1,547 characters
🏷️ Hashtags: 8 tags

---

[CAPTION - Ready to copy/paste]

---

🏷️ Hashtags:
#Business #Strategy #Growth #Leadership #Professional #Industry #Innovation #Trends

💡 Mention Suggestions:
@company-name (if relevant)
@industry-leader (if relevant)

📊 Metadata:
• Framework: PAS
• Banner: ✅ Generated (1200x627)
• Optimal posting: Tue-Thu, 8-10am or 4-6pm

[Banner Image Attached]
```

## Content Frameworks

### PAS Framework (70% of LinkedIn posts)

**Structure:**
```
Hook (first 2 lines - attention grabbing)
→ Problem (paragraph with real data)
→ Agitation (amplify pain with numbers)
→ Solution (Your solution with benefits)
→ CTA (direct action)
→ LinkedIn Hashtags
```

**Best for:**
- Problem-solution posts
- Pain points and solutions
- Direct value propositions

### Story-Result-Success Framework (20% of LinkedIn posts)

**Structure:**
```
Hook (first 2 lines - growth metric)
→ Story (beginning context)
→ Result (transformation with data)
→ Success (current state with achievements)
→ CTA (direct action)
→ LinkedIn Hashtags
```

**Best for:**
- Growth stories
- Company milestones
- Founder journey
- Case studies

### Insight-Value-CTA Framework (10% of LinkedIn posts)

**Structure:**
```
Hook (first 2 lines - data-driven insight)
→ Insight (what the data means)
→ Value (why it matters for the reader)
→ CTA (direct action)
→ LinkedIn Hashtags
```

**Best for:**
- Market trends
- Thought leadership
- Industry analysis
- Opportunities

## Banner Specifications

### LinkedIn Feed
- **Format:** 1.91:1 Landscape (1200x627)
- **Max File Size:** 5MB (PNG/JPG)
- **Text in Banner:** Short (≤8 words)
- **Style:** Professional, cinematic, data-driven

### Banner Layout Patterns

**PAS Framework:**
- Left: Bold headline (60% width)
- Right: Professional visual
- Bottom: Subtle gradient overlay

**Story Framework:**
- Left: Growth metric/achievement
- Right: Data visualization showing upward trend
- Background: Professional with gradient

**Insight Framework:**
- Left: Statistical insight/number
- Right: Charts/graphs showing market data
- Background: Professional, analytical

## Caption Structure

### LinkedIn Character Limits
- **Max:** 3,000 characters
- **Optimal:** 2,000 characters (best engagement)
- **Min:** 1,000 characters (for long-form)

### Caption Templates

See `references/linkedin-templates.md` for full templates.

#### PAS Caption Template

```markdown
[HOOK - First 2 lines, attention grabbing]

[PROBLEM]
Short paragraph with real data and pain point.

[AGITATION]
Amplify pain with specific numbers and consequences.
Bullet points for impact.

[SOLUTION]
Your solution with clear benefits:
✅ Benefit 1
✅ Benefit 2
✅ Benefit 3
✅ Benefit 4

[CTA - Direct Action]
Question + Call to action

[LINKEDIN HASHTAGS]
5-10 relevant hashtags
```

#### Story Caption Template

```markdown
[HOOK - Growth metric or achievement]

[STORY]
Beginning context (year founded, mission, challenge)

[RESULT]
Transformation with specific metrics and data.

[SUCCESS]
Current state with achievements:
✅ Achievement 1
✅ Achievement 2
✅ Achievement 3
✅ Achievement 4

The secret? (Key insights)

1️⃣ Pillar 1
2️⃣ Pillar 2
3️⃣ Pillar 3

[CTA - Direct Action]
Question + Call to action

[LINKEDIN HASHTAGS]
5-10 relevant hashtags
```

#### Insight Caption Template

```markdown
[HOOK - Data-driven insight with specific number]

[INSIGHT]
What the data means (interpretation)

[VALUE]
Why it matters for the reader (opportunities)

[CTA - Direct Action]
Question + Call to action

[LINKEDIN HASHTAGS]
5-10 relevant hashtags
```

## LinkedIn Hashtags

### Strategy
- **5-10 hashtags** per post (LinkedIn optimal)
- **Mix:** 6 popular + 3 niche + 1 brand
- **Quality over quantity** (unlike Instagram)

See `references/linkedin-hashtags.md` for comprehensive hashtag database.

### Best Practices
- Use relevant hashtags to your industry
- Mix popular (high volume) and niche (specific) tags
- Include your brand hashtag
- Use PascalCase for readability (e.g., #BusinessStrategy)

## Visual Identity

The Designer skill handles brand colors and visual identity. Configure your brand in the Designer skill.

### Best Practices for LinkedIn Banners
- First impression matters (professional, clean)
- Text ≤8 words (legible on mobile)
- High contrast for readability
- Professional visuals relevant to your industry
- Consistent brand colors

## Best Practices

### For LinkedIn Banners
- First impression matters (professional, clean)
- Text ≤8 words (legible on mobile)
- High contrast for readability
- Professional visuals
- Consistent brand colors

### For LinkedIn Captions
- **Hook in first 2 lines** (mobile preview)
- **Paragraphs** (not bullet points like Instagram)
- **Data-driven** (specific numbers, statistics)
- **Professional tone** (B2B audience)
- **Clear CTA** (single action)
- **5-10 hashtags** (quality over quantity)

### For LinkedIn Strategy
- **70% PAS** (addressing pains, offering solutions)
- **20% Story** (building authority, showing results)
- **10% Insight** (market intelligence, thought leadership)
- **Post frequency:** 2-3x per week
- **Best times:** Tue-Thu, 8-10am or 4-6pm (your timezone)

## Integration with Ghostwriter Skills

This skill integrates with ghostwriter skills for authentic voice:

**How it works:**
1. Set GHOSTWRITER_PATH environment variable to your ghostwriter script
2. The generator will attempt to use ghostwriter for content
3. Falls back to original templates if ghostwriter is unavailable

**Usage:**
```bash
# Set ghostwriter path (optional)
export GHOSTWRITER_PATH="/path/to/your/ghostwriter/script"

# Generate with ghostwriter integration
python3 scripts/linkedin_post_generator.py "Your topic"
```

## Vault Structure

Client-specific configurations and generated content are stored in the workspace vault:

```
{workspace}/vault/linkedin_post/
├── config.json                        # Client branding, CTAs, hashtags
├── templates/                         # Custom caption templates
└── generated/                         # Generated posts (banners + captions)
```

- **Templates:** `{workspace}/vault/linkedin_post/templates/` — Override default frameworks with client-specific templates
- **Generated Posts:** `vault/linkedin_post/generated/` — Output directory for banners and captions
- **Custom Config:** `vault/linkedin_post/config.json` — Client branding, default CTAs, hashtag sets

## Skill File Structure

```
linkedin_post/
├── SKILL.md                           # This file
├── README.md                          # Detailed documentation
├── EXAMPLES.md                        # Usage examples
├── CHANGELOG.md                       # Version history
├── scripts/
│   └── linkedin_post_generator.py     # Main generator
└── references/
    ├── linkedin-templates.md          # Caption templates
    └── linkedin-hashtags.md           # Hashtag database
```

## Getting Started

1. **Review frameworks** (PAS, Story, Insight)
2. **Create your hook** (attention-grabbing opening)
3. **Generate post** with the script
4. **Receive on Telegram** (banner + caption + metadata)
5. **Review banner** (professional quality)
6. **Review caption** (data-driven, professional)
7. **Copy/paste to LinkedIn** (or schedule)
8. **Post at optimal time** (Tue-Thu, 8-10am or 4-6pm)
9. **Track performance** (optimize based on data)

## Common Errors & Solutions

### Error 1: Banner Generation Failed
**Solution:** Check REPLICATE_API_TOKEN, try again (API rate limits)

### Error 2: Caption Too Long
**Solution:** Trim to 2,000 characters (optimal for engagement)

### Error 3: Low Engagement
**Solution:** Test different hooks, add more data, adjust posting time

### Error 4: Designer Skill Not Found
**Solution:** Ensure Designer skill is installed in skills directory

### Error 5: Telegram Delivery Failed
**Solution:** Check Telegram bot token, chat ID, network connection

## Notes

- LinkedIn works differently than Instagram
- Long-form copy (300-500 words) performs best
- Professional tone (B2B audience)
- Data-driven (specific numbers)
- 5-10 hashtags (not 30 like Instagram)
- Banner quality matters (professional, clean)
- Hooks in first 2 lines (mobile preview)
- Clear CTAs (single action)
- Post timing matters (Tue-Thu optimal)
