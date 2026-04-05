#!/usr/bin/env python3
"""
LinkedIn Post Generator - Generic Multi-Client Version

Complete LinkedIn post generation with Designer skill for visuals.
Follows content frameworks: PAS, Story-Result, Insight-Value.
Generates professional banners (1200x627) + long-form copy (300-500 words).
Delivers to Telegram for manual review before publishing.
Optional Google Drive sync via ArtifactsSaver.
Optional Ghostwriter integration for authentic voice.

Usage:
    python3 linkedin_post_generator.py "Your hook here" [--framework pas|story|insight] [--cta "Your CTA"]
"""

import os
import sys
import json
from typing import Dict, Any, List, Optional
from pathlib import Path

# Import Designer skill (required)
try:
    # Try relative path first (when in skills directory)
    DESIGNER_DIR = Path(__file__).parent.parent.parent / "designer" / "scripts"
    if DESIGNER_DIR.exists():
        sys.path.insert(0, str(DESIGNER_DIR))
    
    from designer import Designer
    DESIGNER_AVAILABLE = True
except ImportError:
    DESIGNER_AVAILABLE = False
    print("Warning: Designer skill not available. Banner generation disabled.", file=sys.stderr)

# Import ArtifactsSaver (optional)
try:
    # Try to import from various possible locations
    ARTIFACTS_SAVER_PATHS = [
        Path(__file__).parent.parent.parent,  # Same skills directory
        Path(os.environ.get("KNOWSPACE_WORKSPACE") or os.environ.get("OPENCLAW_WORKSPACE") or "") / "skills" / "public",
        Path.home() / ".openclaw" / "workspace" / "skills" / "public",  # Legacy fallback
    ]
    
    for path in ARTIFACTS_SAVER_PATHS:
        if (path / "artifacts_saver.py").exists():
            sys.path.insert(0, str(path))
            from artifacts_saver import ArtifactsSaver
            ARTIFACTS_SAVER_AVAILABLE = True
            break
    else:
        ARTIFACTS_SAVER_AVAILABLE = False
except ImportError:
    ARTIFACTS_SAVER_AVAILABLE = False


def get_ghostwriter_content(topic: str, framework: str = "pas") -> Optional[Dict[str, Any]]:
    """
    Get content from ghostwriter skill (optional integration)
    
    Set GHOSTWRITER_PATH environment variable to enable.
    
    Args:
        topic: Topic keyword or description
        framework: Content framework (pas, story, insight)
        
    Returns:
        Dictionary with ghostwriter content or None if unavailable
    """
    import subprocess
    
    ghostwriter_path = os.environ.get("GHOSTWRITER_PATH")
    if not ghostwriter_path or not Path(ghostwriter_path).exists():
        return None
    
    try:
        cmd = ["node", ghostwriter_path, f"--{framework}", f"--linkedin", topic]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            env=os.environ.copy()
        )
        
        if result.returncode == 0:
            return json.loads(result.stdout)
    except Exception as e:
        print(f"Ghostwriter unavailable: {e}", file=sys.stderr)
    
    return None


# ===== CONFIGURATION =====

class Config:
    """System configuration for LinkedIn post generation"""

    # Content Frameworks
    FRAMEWORKS = {
        "pas": {
            "name": "PAS (Problem-Agitation-Solution)",
            "usage": 70,
            "structure": ["Hook", "Problem", "Agitation", "Solution", "CTA"]
        },
        "story": {
            "name": "Story-Result-Success",
            "usage": 20,
            "structure": ["Hook", "Story", "Result", "Success", "CTA"]
        },
        "insight": {
            "name": "Insight-Value-CTA",
            "usage": 10,
            "structure": ["Hook", "Insight", "Value", "CTA"]
        }
    }

    # CTAs padrão por framework
    DEFAULT_CTAS = {
        "pas": "DM 'INFO' and I'll show you how",
        "story": "DM 'STORY' and I'll share the details",
        "insight": "DM 'INSIGHT' and I'll explain more"
    }

    # LinkedIn Character Limits
    MAX_POST_LENGTH = 3000  # LinkedIn max
    OPTIMAL_LENGTH = 2000   # Optimal for engagement
    MIN_LENGTH = 1000       # Minimum for long-form


# ===== CAPTION GENERATOR =====

class LinkedInCaptionGenerator:
    """LinkedIn long-form captions with PAS, Story, and Insight frameworks"""

    def generate_pas_caption(self, hook: str, cta: str) -> str:
        """
        Generate PAS framework caption for LinkedIn
        
        Args:
            hook: Opening hook (first 2 lines)
            cta: Call to action
            
        Returns:
            Complete caption
        """
        caption = f"""{hook}

The problem is real. The data shows it. The impact is significant.

Companies are struggling with this challenge every day. The numbers don't lie.

✅ Impact area 1
✅ Impact area 2  
✅ Impact area 3
✅ Impact area 4

The solution exists.

✅ Solution benefit 1
✅ Solution benefit 2
✅ Solution benefit 3
✅ Solution benefit 4

What's your experience with this?

{cta}

#Business #Strategy #Growth #Leadership #Professional
"""
        return caption.strip()

    def generate_story_caption(self, hook: str, cta: str) -> str:
        """
        Generate Story-Result-Success framework caption for LinkedIn
        
        Args:
            hook: Opening hook (growth metric or achievement)
            cta: Call to action
            
        Returns:
            Complete caption
        """
        caption = f"""{hook}

The journey started with a vision. A challenge. An opportunity.

Through dedication and strategic decisions, transformation happened.

✅ Achievement 1
✅ Achievement 2
✅ Achievement 3
✅ Achievement 4

The secret?

Three pillars:

1️⃣ Pillar 1
2️⃣ Pillar 2
3️⃣ Pillar 3

Result: Sustainable growth and success.

Ready to write your own success story?

{cta}

#Growth #Success #Business #Leadership #Achievement
"""
        return caption.strip()

    def generate_insight_caption(self, hook: str, cta: str) -> str:
        """
        Generate Insight-Value-CTA framework caption for LinkedIn
        
        Args:
            hook: Opening hook (data-driven insight)
            cta: Call to action
            
        Returns:
            Complete caption
        """
        caption = f"""{hook}

The data reveals a clear trend. Understanding it creates opportunity.

📊 Key insight: The numbers tell an important story
📈 Implication: What this means for the industry
💡 Opportunity: How to leverage this information

Why this matters:

✅ Relevance point 1
✅ Relevance point 2
✅ Relevance point 3

Who is paying attention to this trend?

{cta}

#Insights #Data #Trends #Business #Strategy
"""
        return caption.strip()

    def generate_caption(self, hook: str, framework: str = "pas", custom_cta: str = None) -> str:
        """
        Generate LinkedIn caption based on hook and framework
        
        Integrates with Ghostwriter for authentic voice (if configured).
        
        Args:
            hook: Opening hook text
            framework: "pas", "story", or "insight"
            custom_cta: Custom CTA text (optional)
            
        Returns:
            Complete LinkedIn caption
        """
        # Try Ghostwriter first (if configured)
        ghostwriter_content = get_ghostwriter_content(hook, framework)
        
        if ghostwriter_content and "caption" in ghostwriter_content:
            caption = ghostwriter_content["caption"]
            
            # Apply custom CTA if provided
            if custom_cta:
                lines = caption.split('\n')
                for i in range(len(lines) - 1, -1, -1):
                    if lines[i] and not lines[i].startswith('#'):
                        lines[i] = custom_cta
                        break
                caption = '\n'.join(lines)
            
            return caption
        
        # Fallback to original generation logic
        cta = custom_cta or Config.DEFAULT_CTAS.get(framework, Config.DEFAULT_CTAS["pas"])
        
        if framework == "pas":
            return self.generate_pas_caption(hook, cta)
        elif framework == "story":
            return self.generate_story_caption(hook, cta)
        elif framework == "insight":
            return self.generate_insight_caption(hook, cta)
        else:
            return self.generate_pas_caption(hook, cta)


# ===== HASHTAG GENERATOR =====

class LinkedInHashtagGenerator:
    """SEO-optimized LinkedIn hashtags"""

    # Generic industry hashtags (customize for your industry)
    POPULAR = ["#Business", "#Leadership", "#Strategy", "#Growth", "#Professional"]
    
    NICHE = ["#Industry", "#Innovation", "#Trends", "#Expert", "#Insights"]
    
    BRAND = ["#YourBrand", "#YourCompany"]  # Customize with your brand

    def generate_hashtags(self, topic="business", count=10):
        """
        Generate SEO-optimized hashtag mix for LinkedIn
        
        Args:
            topic: Topic category (for future customization)
            count: Number of hashtags
            
        Returns:
            list: Hashtags with # prefix
        """
        # Mix: 5 popular + 3 niche + 2 brand
        popular_count = min(5, len(self.POPULAR))
        niche_count = min(3, len(self.NICHE))
        brand_count = min(2, len(self.BRAND))
        
        hashtags = []
        hashtags.extend(self.POPULAR[:popular_count])
        hashtags.extend(self.NICHE[:niche_count])
        hashtags.extend(self.BRAND[:brand_count])
        
        # Deduplicate while preserving order
        seen = set()
        result = []
        for tag in hashtags:
            if tag not in seen:
                seen.add(tag)
                result.append(tag)
        
        return result[:count]


# ===== MAIN GENERATOR =====

class LinkedInPostGenerator:
    """Main LinkedIn post generator using Designer skill for visuals"""

    def __init__(self, save_to_drive=False):
        self.designer = Designer() if DESIGNER_AVAILABLE else None
        self.caption_gen = LinkedInCaptionGenerator()
        self.hashtag_gen = LinkedInHashtagGenerator()
        self.save_to_drive = save_to_drive and ARTIFACTS_SAVER_AVAILABLE
        self.artifacts_saver = ArtifactsSaver() if ARTIFACTS_SAVER_AVAILABLE else None

    def generate_post(self, hook: str, framework: str = "pas", custom_cta: str = None) -> Dict[str, Any]:
        """
        Generate complete LinkedIn post (banner + caption) using Designer skill
        
        Args:
            hook: Opening hook text (first 2 lines)
            framework: "pas", "story", or "insight"
            custom_cta: Custom CTA text (optional, uses default if not provided)
            
        Returns:
            dict: {banners, caption, hashtags, complete_post_data}
        """
        if not hook or not hook.strip():
            raise ValueError("Hook is required and cannot be empty")
        
        # Set defaults
        framework = framework or "pas"
        cta = custom_cta or Config.DEFAULT_CTAS.get(framework, Config.DEFAULT_CTAS["pas"])
        
        print(f"💼 Generating LinkedIn post...")
        print(f"📐 Format: 1.91:1 landscape (1200x627)")
        print(f"🎨 Framework: {Config.FRAMEWORKS[framework]['name']}")
        print(f"📝 Hook: {hook}")
        
        if self.designer:
            print(f"🎨 Using Designer skill")
        else:
            print(f"⚠️  Designer skill not available - skipping banner")
        
        # Generate caption
        caption = self.caption_gen.generate_caption(hook, framework, cta)
        
        # Generate hashtags
        hashtags = self.hashtag_gen.generate_hashtags(topic="business", count=10)
        
        # Build full content for Designer
        full_content = f"{hook}. {caption}"
        
        # Generate banner using Designer skill
        banner_urls = []
        if self.designer:
            print(f"🎨 Generating LinkedIn banner with Designer skill...")
            
            try:
                result = self.designer.generate({
                    "content": full_content,
                    "platform": "linkedin",
                    "format": "banner"
                })
                
                if result["success"]:
                    banner_urls = result["images"]
                    
                    # Log any brand corrections
                    if result.get("brand_corrections"):
                        print(f"⚠️  Applied {len(result['brand_corrections'])} brand correction(s)")
                    
                    print(f"✅ Banner generated successfully")
                else:
                    print(f"❌ Designer error: {result.get('error', 'Unknown error')}")
            except Exception as e:
                print(f"❌ Banner generation failed: {e}")
        
        post_result = {
            "hook": hook,
            "framework": framework,
            "banners": banner_urls,
            "caption": caption,
            "hashtags": hashtags,
            "hashtag_string": " ".join(hashtags),
            "caption_length": len(caption),
            "platform": "linkedin"
        }
        
        # Save to Google Drive (if enabled)
        if self.save_to_drive and self.artifacts_saver:
            try:
                print(f"\n💾 Saving to Google Drive...")
                folder = self.artifacts_saver.create_post_folder(
                    topic=hook,
                    platform="linkedin",
                    framework=framework
                )
                saved = self.artifacts_saver.save_full_post(
                    folder, post_result, download_images=True
                )
                post_result["drive_folder"] = str(folder)
                post_result["saved_files"] = list(saved.keys())
                print(f"✅ Saved to: {folder.name}")
            except Exception as e:
                print(f"⚠️  Drive save error: {e}")
        
        return post_result

    def format_for_telegram(self, post_data: Dict[str, Any]) -> str:
        """
        Format LinkedIn post for Telegram delivery
        
        Args:
            post_data: Post data with banner and caption
            
        Returns:
            Formatted message ready for Telegram
        """
        framework_name = Config.FRAMEWORKS.get(post_data['framework'], {}).get('name', post_data['framework'])
        
        # Extract mention suggestions based on content keywords
        mention_suggestions = self._get_mention_suggestions(post_data['caption'])
        
        message = f"""💼 LinkedIn Post Ready

🎨 Framework: {framework_name}
📏 Caption: {post_data['caption_length']:,} characters
🏷️ Hashtags: {len(post_data['hashtags'])} tags

---

{post_data['caption']}

---

🏷️ Hashtags:
{post_data['hashtag_string']}

💡 Mention Suggestions:
{mention_suggestions}

📊 Metadata:
• Framework: {post_data['framework'].upper()}
• Banner: {'✅ Generated (1200x627)' if post_data['banners'] else '❌ Not generated'}
• Optimal posting: Tue-Thu, 8-10am or 4-6pm

{'🔗 Banner URL: ' + post_data['banners'][0] if post_data['banners'] else ''}"""
        
        return message
    
    def format_for_copy(self, post_data: Dict[str, Any]) -> str:
        """
        Format LinkedIn post for direct copy/paste
        
        Args:
            post_data: Post data with banner and caption
            
        Returns:
            Clean text ready to copy to LinkedIn
        """
        return f"""{post_data['caption']}

{post_data['hashtag_string']}"""

    def _get_mention_suggestions(self, caption: str) -> str:
        """
        Generate mention suggestions based on caption content
        
        Args:
            caption: The post caption
            
        Returns:
            Formatted mention suggestions
        """
        # This is a placeholder - in production, this would analyze content
        # and suggest relevant LinkedIn pages/company mentions
        suggestions = []
        
        # Common business/industry keywords
        if any(word in caption.lower() for word in ['business', 'strategy', 'leadership']):
            suggestions.append("• Relevant industry leaders")
        if any(word in caption.lower() for word in ['tech', 'ai', 'digital', 'software']):
            suggestions.append("• Tech companies in your niche")
        if any(word in caption.lower() for word in ['growth', 'startup', 'founder']):
            suggestions.append("• Startup community leaders")
        
        if not suggestions:
            suggestions.append("• No specific suggestions - add manually")
        
        return "\n".join(suggestions)


# ===== CLI =====

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="LinkedIn post generator - Professional banners with long-form copy",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage with custom hook
  python linkedin_post_generator.py "Your compelling hook here"
  
  # Use specific framework
  python linkedin_post_generator.py "Your hook" --framework story
  
  # Custom hook with custom CTA
  python linkedin_post_generator.py "Your hook" --cta "DM me for details"
  
  # Output format for Telegram delivery
  python linkedin_post_generator.py "Your hook" --format telegram
  
  # Output clean copy/paste format
  python linkedin_post_generator.py "Your hook" --format copy
  
  # Enable Google Drive save
  python linkedin_post_generator.py "Your hook" --save-to-drive

Frameworks:
  pas     - Problem-Agitation-Solution (default, 70% of posts)
  story   - Story-Result-Success (20% of posts)
  insight - Insight-Value-CTA (10% of posts)

Formats:
  telegram - Full metadata + banner URL (for Telegram delivery)
  copy     - Clean text only (for direct copy/paste to LinkedIn)
  json     - Raw JSON output (for programmatic use)

Environment Variables:
  GHOSTWRITER_PATH         - Path to ghostwriter script (optional)
        """
    )

    parser.add_argument(
        "hook",
        help="Opening hook text (first 2 lines, attention-grabbing)"
    )
    parser.add_argument(
        "--framework",
        choices=["pas", "story", "insight"],
        default="pas",
        help="Framework to use (default: pas)"
    )
    parser.add_argument(
        "--cta",
        help="Custom CTA text (uses default for framework if not specified)"
    )
    parser.add_argument(
        "--format",
        choices=["telegram", "copy", "json"],
        default="telegram",
        help="Output format (default: telegram)"
    )
    parser.add_argument(
        "--save-to-drive",
        action="store_true",
        help="Save to Google Drive (requires ArtifactsSaver)"
    )

    args = parser.parse_args()

    try:
        generator = LinkedInPostGenerator(
            save_to_drive=args.save_to_drive
        )
        result = generator.generate_post(args.hook, framework=args.framework, custom_cta=args.cta)

        # Output based on format
        if args.format == "json":
            print(json.dumps(result, indent=2))
        elif args.format == "copy":
            print(generator.format_for_copy(result))
        else:  # telegram (default)
            print(generator.format_for_telegram(result))

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
