# LinkedIn Post Generator

Professional LinkedIn post generation with banners and long-form copy.

## Overview

This skill generates complete LinkedIn posts with:
- **Professional banners** (1200x627, landscape format)
- **Long-form captions** (300-500 words)
- **Framework-based content** (PAS, Story, Insight)
- **LinkedIn-optimized hashtags** (5-10 per post)
- **Automatic Buffer integration** (optional)

## Features

### Content Frameworks
- **PAS Framework** (70% of posts): Problem → Agitation → Solution → CTA
- **Story Framework** (20% of posts): Hook → Story → Result → Success → CTA
- **Insight Framework** (10% of posts): Hook → Insight → Value → CTA

### Visual Generation
- Uses Designer skill for brand-consistent banners
- 1.91:1 landscape format (optimal for LinkedIn)
- Professional, cinematic quality
- Text ≤8 words for mobile readability

### Distribution
- Automatic Buffer integration (draft mode)
- Google Drive backup (optional)
- Direct output to console

## Installation

### Prerequisites
- Python 3.x
- Designer skill (for banner generation)
- Buffer skill (optional, for Buffer integration)

### Environment Variables

```bash
# Buffer Integration (optional)
export BUFFER_API_KEY="your_buffer_api_key"
export BUFFER_PROFILE_ID_LINKEDIN="your_linkedin_profile_id"

# Ghostwriter Integration (optional)
export GHOSTWRITER_PATH="/path/to/your/ghostwriter/script"
```

## Usage

### Basic Usage

```bash
python3 scripts/linkedin_post_generator.py "Your compelling hook here"
```

### With Framework

```bash
python3 scripts/linkedin_post_generator.py "Your hook" --framework story
```

### With Custom CTA

```bash
python3 scripts/linkedin_post_generator.py "Your hook" --cta "DM 'INFO' for details"
```

### Without Buffer

```bash
python3 scripts/linkedin_post_generator.py "Your hook" --no-buffer
```

### With Google Drive Backup

```bash
python3 scripts/linkedin_post_generator.py "Your hook" --save-to-drive
```

## Frameworks

### PAS (Problem-Agitation-Solution)
Best for: Problem-solving posts, pain points, direct value propositions

Structure:
```
Hook (attention-grabbing)
→ Problem (data, pain points)
→ Agitation (amplify with numbers)
→ Solution (benefits)
→ CTA (action)
→ Hashtags
```

### Story-Result-Success
Best for: Growth stories, case studies, milestones, journey posts

Structure:
```
Hook (growth metric/achievement)
→ Story (beginning context)
→ Result (transformation with data)
→ Success (current achievements)
→ CTA (action)
→ Hashtags
```

### Insight-Value-CTA
Best for: Market trends, thought leadership, industry analysis

Structure:
```
Hook (data-driven insight)
→ Insight (interpretation)
→ Value (relevance to reader)
→ CTA (action)
→ Hashtags
```

## Customization

### Hashtags
Edit `references/linkedin-hashtags.md` to customize hashtag lists for your industry.

### Templates
Edit `references/linkedin-templates.md` to create custom caption templates.

### Brand Identity
Configure your brand colors and visual identity in the Designer skill.

### CTAs
Pass custom CTAs via command line or set defaults in the script.

## Integration

### Designer Skill
The LinkedIn Post Generator uses the Designer skill for banner generation. Ensure Designer is installed and configured with your brand guidelines.

### Buffer Skill
Optional Buffer integration allows automatic posting to Buffer as drafts for review and scheduling.

### Ghostwriter Integration
Optional ghostwriter integration enables authentic voice generation. Set GHOSTWRITER_PATH to your ghostwriter script.

### Google Drive
Optional Google Drive backup via ArtifactsSaver. Enable with --save-to-drive flag.

## Best Practices

### LinkedIn Banners
- Text ≤8 words
- High contrast
- Professional visuals
- Consistent brand colors

### LinkedIn Captions
- Hook in first 2 lines (mobile preview)
- Use paragraphs (not bullets)
- Data-driven (specific numbers)
- Professional tone
- Single, clear CTA
- 5-10 hashtags

### Posting Strategy
- 70% PAS (problem-solving)
- 20% Story (authority building)
- 10% Insight (thought leadership)
- 2-3x per week
- Tue-Thu, 8-10am or 4-6pm

## Troubleshooting

### Banner Generation Failed
- Check REPLICATE_API_TOKEN
- Verify Designer skill is installed
- Check API rate limits

### Buffer Integration Failed
- Verify BUFFER_API_KEY is set
- Check BUFFER_PROFILE_ID_LINKEDIN
- Test Buffer skill independently

### Designer Skill Not Found
- Verify Designer skill is installed
- Check Python path includes Designer scripts
- Import Designer in Python to test

### Caption Too Long
- Script automatically limits to 3,000 characters
- Optimal length is 2,000 characters
- Manual trimming if needed

## File Structure

```
linkedin_post/
├── SKILL.md                          # Skill metadata and guide
├── README.md                         # This file
├── scripts/
│   └── linkedin_post_generator.py    # Main generator script
└── references/
    ├── linkedin-templates.md         # Caption templates
    └── linkedin-hashtags.md          # Hashtag database
```

## API Reference

### LinkedInPostGenerator Class

```python
from linkedin_post_generator import LinkedInPostGenerator

generator = LinkedInPostGenerator(
    auto_buffer=True,      # Auto-send to Buffer
    save_to_drive=False    # Save to Google Drive
)

result = generator.generate_post(
    hook="Your hook here",
    framework="pas",       # pas, story, or insight
    custom_cta="Your CTA"  # Optional
)

# Returns:
# {
#   "hook": str,
#   "framework": str,
#   "banners": [str],      # URLs
#   "caption": str,
#   "hashtags": [str],
#   "hashtag_string": str,
#   "caption_length": int,
#   "platform": "linkedin"
# }
```

## Examples

### Generate PAS Post
```bash
python3 scripts/linkedin_post_generator.py \
  "Is your strategy costing you money?" \
  --framework pas \
  --cta "DM 'STRATEGY' for a free review"
```

### Generate Story Post
```bash
python3 scripts/linkedin_post_generator.py \
  "From idea to 7-figures: Our journey" \
  --framework story \
  --no-buffer
```

### Generate Insight Post
```bash
python3 scripts/linkedin_post_generator.py \
  "New data shows 47% increase in industry adoption" \
  --framework insight \
  --save-to-drive
```

## Contributing

To customize for your organization:
1. Fork this skill to your workspace
2. Update hashtag lists in references/
3. Modify templates for your industry
4. Configure Designer with your brand
5. Set up Buffer integration

## License

This skill is part of the OpenClaw skills system.

## Support

For issues or questions:
- Check the troubleshooting section
- Review SKILL.md for detailed guidance
- Consult Designer skill documentation
- Test Buffer skill independently
