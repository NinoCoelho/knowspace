---
name: herenow
description: >
  Generate HTML pages and publish them to here.now for instant browser visualization.
  AUTOMATIC PUBLISHING (no asking): (1) User asks for report/document/summary, (2) Multiple
  images/gallery, (3) Tables with >10 rows, (4) Content >500 words. ASK FIRST when user
  doesn't specify format but content could benefit from browser view. Anonymous sites expire
  in 24h; authenticated sites are permanent.
requires_env:
  - key: HERENOW_API_KEY
    description: API key for here.now publishing service
    required: false
---

# Herenow - Publish HTML to here.now

Create beautiful HTML pages and publish them instantly to here.now for browser visualization.

## What It Does

- **Generates HTML pages** with professional styling
- **Publishes to here.now** - get live URLs instantly
- **Supports multiple styles** (default, dark, report)
- **Anonymous or authenticated** - 24h expiry or permanent
- **Perfect for**: reports, image galleries, tables, long-form content

## When to Use

**Automatic triggers:**
- User asks for a report
- Multiple images need display
- Tables with many rows
- Long-form content (>500 words)

**Manual triggers:**
- User asks for "browser view"
- User says "show me a nice version"
- Content is complex (charts, diagrams, etc.)

## Setup (Optional)

For permanent sites, get an API key:

```bash
# Via email verification
curl -sS https://here.now/api/auth/agent/request-code \
  -H "content-type: application/json" \
  -d '{"email": "user@example.com"}'

# Verify code (user pastes from email)
curl -sS https://here.now/api/auth/agent/verify-code \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","code":"ABCD-2345"}'

# Save API key
mkdir -p ~/.herenow && echo "YOUR_API_KEY" > ~/.herenow/credentials && chmod 600 ~/.herenow/credentials
```

Without API key: anonymous sites (24h expiry, still work perfectly).

## Usage

### Basic Report

```bash
python3 {skill_dir}/scripts/publish_html.py --content "<h1>My Report</h1><p>Content here</p>" --title "Report"
```

**Output:**
```
✅ Published to here.now!
🌐 URL: https://bright-canvas-a7k2.here.now/
📦 Size: 1234 bytes
```

### From File

```bash
python3 {skill_dir}/scripts/publish_html.py --file report.md --title "Monthly Report"
```

### With Style

```bash
python3 {skill_dir}/scripts/publish_html.py --content "<h1>Data</h1>" --style dark
```

**Styles:**
- `default` - Clean, professional, light theme
- `dark` - Dark mode for reduced eye strain
- `report` - Formal report with metrics support

### Pipe Content

```bash
cat << 'EOF' | python3 {skill_dir}/scripts/publish_html.py --title "Report"
<h1>Summary</h1>
<p>Your content here...</p>
EOF
```

## Common Patterns

### Image Gallery

```bash
cat << 'EOF' | python3 {skill_dir}/scripts/publish_html.py --title "Pizza Gallery" --style dark
<h1>🍕 Casa Marin Pizza Gallery</h1>

<h2>Featured Pizzas</h2>

<img src="margherita.jpg" alt="Margherita">
<p><strong>Margherita</strong> - Fresh mozzarella, tomato, basil</p>

<img src="pepperoni.jpg" alt="Pepperoni">
<p><strong>Pepperoni</strong> - Classic pepperoni with extra cheese</p>
EOF
```

### Report with Metrics

```bash
cat << 'EOF' | python3 {skill_dir}/scripts/publish_html.py --title "Performance Report" --style report
<h1>📊 Monthly Performance</h1>

<div class="metric">
  <div class="metric-value">1,234</div>
  <div class="metric-label">Total Views</div>
</div>

<div class="metric">
  <div class="metric-value">56.7%</div>
  <div class="metric-label">Engagement Rate</div>
</div>

<h2>Detailed Breakdown</h2>

<table>
  <tr><th>Platform</th><th>Posts</th><th>Engagement</th></tr>
  <tr><td>Instagram</td><td>12</td><td>8.5%</td></tr>
  <tr><td>LinkedIn</td><td>8</td><td>12.3%</td></tr>
</table>
EOF
```

### Data Table

```bash
cat << 'EOF' | python3 {skill_dir}/scripts/publish_html.py --title "Lead Database"
<h1>Lead Database</h1>

<table>
  <tr>
    <th>Name</th>
    <th>Email</th>
    <th>Source</th>
    <th>Status</th>
  </tr>
  <tr>
    <td>John Doe</td>
    <td>john@example.com</td>
    <td>Instagram</td>
    <td>Qualified</td>
  </tr>
</table>
EOF
```

## Workflow Integration

### For Reports

When user asks for a report:

1. Generate report content
2. **Ask:** "Want a browser-friendly version?"
3. If yes → use herenow
4. Return URL: `https://slug.here.now/`

### For Images

When generating multiple images:

1. Save images to `vault/assets/`
2. Create HTML gallery referencing images
3. Publish with herenow
4. Return URL

### For Large Content

When response would be >500 words or complex tables:

1. **Proactively ask:** "This is long - want a browser view?"
2. If yes → use herenow
3. Keep chat response brief with link

## Anonymous vs Authenticated

**Anonymous (no API key):**
- ✅ Works immediately
- ✅ Perfect for temporary reports
- ⚠️  Expires in 24 hours
- 💡 Share `claimUrl` to make permanent

**Authenticated (with API key):**
- ✅ Permanent sites
- ✅ Higher limits (5GB files)
- ✅ 500 sites free

## Tips

- **Use `--style dark`** for content viewed at night
- **Use `--style report`** for formal business reports
- **Share the claimUrl** for anonymous sites you want to keep
- **Images work best** when published together in one site
- **Combine with markdown** - write in markdown, convert to HTML

## Notes

- here.now is a real service: https://here.now
- URLs are publicly accessible
- Anonymous sites expire in 24h (share claimUrl to keep)
- No server management needed
- Works from any machine with internet
