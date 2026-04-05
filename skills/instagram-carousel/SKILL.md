---
name: instagram-carousel
description: Generate Instagram carousels and single posts with PAS framework (Problem-Agitation-Solution-CTA). Creates 4-5 image carousels with SEO-optimized captions and hashtags. Delivers content via Telegram for manual review before posting. Requires client configuration in {workspace}/vault/instagram-carousel/config.json for branding, CTAs, and hashtags.
requires_env:
  - key: REPLICATE_API_TOKEN
    description: Replicate API for image generation via Designer skill
    required: true
  - key: GHOSTWRITER_PATH
    description: Path to ghostwriter skill for authentic voice
    required: false
requires_skills:
  - name: designer
    required: true
---

# Instagram Carousel Generator

Generate Instagram carousels and single posts with PAS framework and SEO optimization.

## Client Configuration Required

This skill requires a client configuration file at `{workspace}/vault/instagram-carousel/config.json`:

```json
{
  "brand": {
    "name": "Your Brand Name",
    "handle": "@yourhandle",
    "portrait_url": "https://example.com/portrait.jpg"
  },
  "hashtags": {
    "popular": ["#business", "#entrepreneur"],
    "brand": ["#yourbrand"],
    "location": ["#yourcity", "#yourcountry"]
  },
  "ctas": {
    "default": "DM for info",
    "custom": {
      "topic1": "DM 'TOPIC1'",
      "topic2": "DM 'TOPIC2'"
    }
  },
  "hooks": {
    "topic_key": {
      "hook": "Hook text here",
      "framework": "pas",
      "cta": "DM 'ACTION'"
    }
  },
  "integrations": {
    "ghostwriter": {
      "enabled": false,
      "path": null
    }
  }
}
```

## Vault Structure

State and generated content are organized under `{workspace}/vault/instagram-carousel/`:

- **Config:** `vault/instagram-carousel/config.json` - Client branding, CTAs, hashtags, integrations
- **Generated:** `vault/instagram-carousel/generated/` - Output images, captions, and metadata

## Quick Start

### Generate Carousel

```bash
cd {workspace}
python3 ~/.npm-global/lib/node_modules/openclaw/skills/instagram-carousel/scripts/instagram_carousel_generator.py \
  "Your hook text here" \
  --num-slides 4 \
  --type carousel
```

### Generate Single Post

```bash
python3 ~/.npm-global/lib/node_modules/openclaw/skills/instagram-carousel/scripts/instagram_carousel_generator.py \
  "Your hook text" \
  --type single
```

### Use Predefined Hook

```bash
python3 ~/.npm-global/lib/node_modules/openclaw/skills/instagram-carousel/scripts/instagram_carousel_generator.py \
  topic_key \
  --framework pas
```

## Frameworks

### PAS (Problem-Agitation-Solution) - 70% of posts
```
Slide 1: Problem statement
Slide 2: Agitation (amplify pain)
Slide 3: Solution
Slide 4: CTA with portrait
```

### Story-Result-Success - 20% of posts
```
Slide 1: Hook/Story opener
Slide 2: Challenge
Slide 3: Result/Transformation
Slide 4: CTA
```

### Insight-Value-CTA - 10% of posts
```
Slide 1: Insight/Data hook
Slide 2: Value/Analysis
Slide 3: CTA
```

## Image Specifications

- **Format:** 4:5 Portrait (1080x1350)
- **Max File Size:** 8MB
- **Text in Image:** Short (≤6 words recommended)

## Telegram Delivery

Generated content is delivered via Telegram for manual review before posting. The agent will send:

1. **Clean Caption** - Ready for copy/paste to Instagram
2. **Image Files** - Generated carousel images (URLs or attachments)
3. **Hashtags List** - Separate, easy to copy
4. **Post Metadata** - Carousel slide count, framework used, topic

### Delivery Format

When a carousel is generated, you'll receive:

```
📱 Instagram Carousel Ready

🎯 Hook: [Hook text]
📊 Slides: [N]
🎨 Framework: [PAS/Story/Insight]

📝 Caption:
---
[clean caption text]
---

🏷️ Hashtags:
[space-separated hashtags]

🖼️ Images:
1. [image URL 1]
2. [image URL 2]
...

✅ Review and post manually to Instagram
```

### Workflow

1. Agent generates carousel content and images
2. Content delivered to configured Telegram channel
3. Human reviews caption, hashtags, and images
4. Human manually posts to Instagram (or copies to Buffer/scheduling tool)

## CLI Options

```bash
python3 scripts/instagram_carousel_generator.py <topic_or_hook> \
  [--num-slides 4] \
  [--framework pas|story|insight] \
  [--cta "Custom CTA"] \
  [--config /path/to/config.json]
```

## File Structure

```
instagram-carousel/
├── SKILL.md
├── scripts/
│   └── instagram_carousel_generator.py
└── references/
    ├── pas_examples.md
    └── caption_templates.md
```

## Integration with Other Skills

- **Designer skill** - For visual generation (required)
- **Ghostwriter skill** - For authentic voice (optional, configure path in client config)

## Environment Setup

```bash
# Load environment
source ~/.openclaw/.env

# Required for image generation
REPLICATE_API_TOKEN=your_token
```

## Quality Checklist

- [ ] Client config exists at `{workspace}/vault/instagram-carousel/config.json`
- [ ] Portrait image URL configured
- [ ] Brand hashtags configured
- [ ] CTAs defined
- [ ] Environment variables loaded
