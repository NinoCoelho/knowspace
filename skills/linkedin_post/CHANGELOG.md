# Changelog

All notable changes to the LinkedIn Post Generator skill will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [2.0.0] - 2026-04-02

### Changed
- **BREAKING:** Migrated from client-specific to generic multi-client skill
- **BREAKING:** Removed all hardcoded hooks and topics
- **BREAKING:** Removed client-specific paths and references
- **BREAKING:** Removed client-specific brand colors and hashtags

### Added
- Generic framework support (PAS, Story, Insight)
- Customizable hashtag system
- Environment variable configuration
- Optional Ghostwriter integration via GHOSTWRITER_PATH
- Generic templates suitable for any industry
- Generic hashtag database for customization
- Flexible CTA system
- Command-line interface with full parameterization

### Removed
- Client-specific company references
- Client-specific person references
- Client-specific predefined topics
- Client-specific brand hashtags
- Client-specific CTAs
- Hardcoded paths to client workspaces

### Improved
- Documentation now generic and reusable
- Configuration via environment variables
- Integration flexibility (Buffer, Ghostwriter, Drive all optional)
- Error messages more generic
- Examples applicable to any business

## [1.0.0] - 2026-03-03

### Added
- Initial release with client-specific implementation
- Designer skill integration for banners
- Buffer integration for auto-posting
- Ghostwriter Giovanni integration
- PAS, Story, Insight frameworks
- Predefined topics for specific business
- Client-specific hashtags and templates
- Google Drive backup via ArtifactsSaver

---

## Migration Guide (v1.x → v2.x)

### Environment Variables

v1.x (client-specific):
```bash
source ~/.openclaw/.env
# Hardcoded paths to client workspace
```

v2.x (generic):
```bash
# Set your own environment variables
export BUFFER_API_KEY="your_key"
export BUFFER_PROFILE_ID_LINKEDIN="your_id"
export GHOSTWRITER_PATH="/path/to/your/ghostwriter"  # optional
```

### Usage

v1.x (predefined topics):
```bash
python3 scripts/linkedin_post_generator.py importacao_china
```

v2.x (custom hooks):
```bash
python3 scripts/linkedin_post_generator.py "Your custom hook here"
```

### Hashtags

v1.x (hardcoded):
```python
# Predefined client-specific hashtags
```

v2.x (customizable):
```python
# Edit references/linkedin-hashtags.md
# Or pass custom hashtags programmatically
```

### Templates

v1.x (client-specific):
```markdown
Opex International
Giovanni Machado
#OpexInternational
```

v2.x (generic):
```markdown
[Your Company]
[Your Name]
#YourBrand
```

---

## Version History

- **2.0.0** - Generic multi-client version (current)
- **1.0.0** - Initial client-specific version
