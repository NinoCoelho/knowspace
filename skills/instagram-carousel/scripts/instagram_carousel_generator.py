#!/usr/bin/env python3
"""
Instagram Carousel Generator - Generic/Reusable Version

Generates Instagram carousels with PAS/Story/Insight frameworks.
Configuration loaded from {workspace}/.openclaw/instagram-carousel.json

Features:
- Generates Instagram carousels with configurable frameworks
- Outputs content formatted for Telegram delivery (manual review)
- Integrates with Designer skill for visual generation
- Optional Ghostwriter integration for authentic voice
"""

import os
import sys
import json
import random
from typing import Dict, Any, List, Optional
from pathlib import Path

# Default config path relative to workspace
DEFAULT_CONFIG_PATH = ".openclaw/instagram-carousel.json"


def get_workspace_path() -> Path:
    """Get workspace path from environment or default"""
    workspace = os.environ.get("KNOWSPACE_WORKSPACE") or os.environ.get("OPENCLAW_WORKSPACE") or os.path.expanduser("~/.openclaw/workspace")
    return Path(workspace)


def load_client_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """Load client-specific configuration from JSON file"""
    if config_path:
        config_file = Path(config_path)
    else:
        config_file = get_workspace_path() / DEFAULT_CONFIG_PATH
    
    if not config_file.exists():
        print(f"Warning: Client config not found at {config_file}", file=sys.stderr)
        print("Using minimal defaults. Create config file for full functionality.", file=sys.stderr)
        return get_default_config()
    
    try:
        with open(config_file, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading config: {e}", file=sys.stderr)
        return get_default_config()


def get_default_config() -> Dict[str, Any]:
    """Return minimal default configuration"""
    return {
        "brand": {
            "name": "Brand",
            "handle": "@handle",
            "portrait_url": None
        },
        "hashtags": {
            "popular": ["#business", "#entrepreneur", "#success"],
            "brand": [],
            "location": []
        },
        "ctas": {
            "default": "DM for more information",
            "custom": {}
        },
        "hooks": {},
        "integrations": {
            "ghostwriter": {"enabled": False}
        }
    }


# Import Designer skill (try multiple paths)
def import_designer():
    """Import Designer class from designer skill"""
    designer_paths = [
        # Workspace-level skill
        get_workspace_path() / "skills/public/designer/scripts",
        # Global skill
        Path(__file__).parent.parent.parent / "designer/scripts",
        # Via npm global
        Path.home() / ".npm-global/lib/node_modules/openclaw/skills/designer/scripts"
    ]
    
    for path in designer_paths:
        if path.exists():
            sys.path.insert(0, str(path))
            try:
                from designer import Designer
                return Designer
            except ImportError:
                continue
    
    return None


# ===== CONFIGURATION =====

class Config:
    """System configuration loaded from client config file"""
    
    def __init__(self, client_config: Dict[str, Any]):
        self.client = client_config
        
        # Content Frameworks
        self.FRAMEWORKS = {
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
    
    @property
    def hooks(self) -> Dict[str, Any]:
        return self.client.get("hooks", {})
    
    @property
    def ctas(self) -> Dict[str, Any]:
        return self.client.get("ctas", {})
    
    @property
    def hashtags(self) -> Dict[str, List[str]]:
        return self.client.get("hashtags", {})
    
    @property
    def brand(self) -> Dict[str, Any]:
        return self.client.get("brand", {})
    
    @property
    def integrations(self) -> Dict[str, Any]:
        return self.client.get("integrations", {})
    
    def get_cta(self, framework: str = "pas", topic: str = None) -> str:
        """Get CTA for framework/topic"""
        ctas = self.ctas
        if topic and topic in ctas.get("custom", {}):
            return ctas["custom"][topic]
        return ctas.get("default", "DM for more information")


def get_ghostwriter_content(ghostwriter_path: str, topic: str, framework: str = "pas") -> Optional[Dict[str, Any]]:
    """
    Get content from Ghostwriter skill if available
    
    Args:
        ghostwriter_path: Path to ghostwriter script
        topic: Topic keyword
        framework: Content framework
    
    Returns:
        Dictionary with ghostwriter content or None
    """
    import subprocess
    
    if not ghostwriter_path or not Path(ghostwriter_path).exists():
        return None
    
    try:
        cmd = ["node", ghostwriter_path, f"--{framework}", "--instagram", topic]
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


# ===== CAPTION GENERATOR =====

class CaptionGenerator:
    """SEO-optimized Instagram captions with PAS, Story, and Insight frameworks"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_pas_caption(self, hook: str, cta: str, topic_data: Dict[str, Any] = None) -> str:
        """Generate PAS framework caption"""
        # Use topic_data if provided, otherwise use defaults
        problem = topic_data.get("problem", "The challenge you're facing is real.") if topic_data else "The challenge you're facing is real."
        agitation = topic_data.get("agitation", "The costs keep adding up. The delays persist.") if topic_data else "The costs keep adding up. The delays persist."
        solution = topic_data.get("solution", "There's a better way to handle this.") if topic_data else "There's a better way to handle this."
        
        caption = f"""{hook.upper()}

{problem}

{agitation}

{solution}

{cta}
"""
        return caption.strip()
    
    def generate_story_caption(self, hook: str, cta: str, topic_data: Dict[str, Any] = None) -> str:
        """Generate Story-Result-Success framework caption"""
        story = topic_data.get("story", "Every journey starts somewhere.") if topic_data else "Every journey starts somewhere."
        result = topic_data.get("result", "The transformation speaks for itself.") if topic_data else "The transformation speaks for itself."
        
        caption = f"""{hook.upper()}

{story}

{result}

{cta}
"""
        return caption.strip()
    
    def generate_insight_caption(self, hook: str, cta: str, topic_data: Dict[str, Any] = None) -> str:
        """Generate Insight-Value-CTA framework caption"""
        insight = topic_data.get("insight", "Here's what the data shows.") if topic_data else "Here's what the data shows."
        value = topic_data.get("value", "This creates an opportunity.") if topic_data else "This creates an opportunity."
        
        caption = f"""{hook.upper()}

{insight}

{value}

{cta}
"""
        return caption.strip()
    
    def generate_caption(self, topic_key_or_hook: str, framework: str = None, custom_cta: str = None,
                         ghostwriter_path: str = None) -> str:
        """
        Generate Instagram caption based on topic/hook and framework
        
        Args:
            topic_key_or_hook: Key from hooks config OR custom hook text
            framework: "pas", "story", or "insight"
            custom_cta: Custom CTA text
            ghostwriter_path: Path to ghostwriter script (optional)
        
        Returns:
            Complete Instagram caption
        """
        # Try Ghostwriter first for predefined topics
        if ghostwriter_path and topic_key_or_hook in self.config.hooks:
            framework = framework or self.config.hooks[topic_key_or_hook].get("framework", "pas")
            ghostwriter_content = get_ghostwriter_content(ghostwriter_path, topic_key_or_hook, framework)
            
            if ghostwriter_content and "caption" in ghostwriter_content:
                caption = ghostwriter_content["caption"]
                if custom_cta:
                    lines = caption.split('\n')
                    for i in range(len(lines) - 1, -1, -1):
                        if lines[i] and not lines[i].startswith('#'):
                            lines[i] = custom_cta
                            break
                    caption = '\n'.join(lines)
                return caption
        
        # Determine hook and framework
        if topic_key_or_hook in self.config.hooks:
            topic_data = self.config.hooks[topic_key_or_hook]
            hook = topic_data["hook"]
            framework = framework or topic_data.get("framework", "pas")
            cta = custom_cta or topic_data.get("cta", self.config.get_cta(framework, topic_key_or_hook))
        else:
            hook = topic_key_or_hook
            framework = framework or "pas"
            cta = custom_cta or self.config.get_cta(framework)
            topic_data = {}
        
        if framework == "pas":
            return self.generate_pas_caption(hook, cta, topic_data)
        elif framework == "story":
            return self.generate_story_caption(hook, cta, topic_data)
        elif framework == "insight":
            return self.generate_insight_caption(hook, cta, topic_data)
        else:
            return self.generate_pas_caption(hook, cta, topic_data)


# ===== HASHTAG GENERATOR =====

class HashtagGenerator:
    """Configurable Instagram hashtags"""
    
    def __init__(self, config: Config):
        self.config = config
    
    def generate_hashtags(self, topic: str = None, count: int = 15) -> List[str]:
        """
        Generate hashtag mix from client config
        
        Args:
            topic: Topic key (not currently used, for future expansion)
            count: Number of hashtags
        
        Returns:
            List of hashtags with # prefix
        """
        hashtags = []
        client_tags = self.config.hashtags
        
        # Mix: popular + niche + brand + location
        popular = client_tags.get("popular", [])
        niche = client_tags.get("niche", [])
        brand = client_tags.get("brand", [])
        location = client_tags.get("location", [])
        
        # Ratios: 40% popular, 30% niche, 20% brand, 10% location
        hashtags.extend(popular[:int(count * 0.4)])
        hashtags.extend(niche[:int(count * 0.3)])
        hashtags.extend(brand[:int(count * 0.2)])
        hashtags.extend(location[:int(count * 0.1)])
        
        # Deduplicate and shuffle
        hashtags = list(set(hashtags))
        random.shuffle(hashtags)
        
        return hashtags[:count]


# ===== MAIN GENERATOR =====

class InstagramCarouselGenerator:
    """Main generator using Designer skill for visuals"""
    
    def __init__(self, config_path: Optional[str] = None):
        self.client_config = load_client_config(config_path)
        self.config = Config(self.client_config)
        self.caption_gen = CaptionGenerator(self.config)
        self.hashtag_gen = HashtagGenerator(self.config)
        
        ghostwriter_integration = self.config.integrations.get("ghostwriter", {})
        self.ghostwriter_path = ghostwriter_integration.get("path") if ghostwriter_integration.get("enabled") else None
        
        # Import Designer
        DesignerClass = import_designer()
        if DesignerClass:
            self.designer = DesignerClass()
        else:
            self.designer = None
            print("Warning: Designer skill not available", file=sys.stderr)
    
    def generate_carousel(self, topic_key_or_hook: str, num_slides: int = 4, 
                          framework: str = None, custom_cta: str = None) -> Dict[str, Any]:
        """
        Generate complete Instagram carousel
        
        Args:
            topic_key_or_hook: Key from hooks config OR custom hook text
            num_slides: Number of slides (4 or 5)
            framework: "pas", "story", or "insight"
            custom_cta: Custom CTA text
        
        Returns:
            dict: {images, caption, hashtags, ...}
        """
        # Determine if using predefined hook
        is_predefined = topic_key_or_hook in self.config.hooks
        
        if is_predefined:
            topic_data = self.config.hooks[topic_key_or_hook]
            hook_text = topic_data["hook"]
            framework = framework or topic_data.get("framework", "pas")
            custom_cta = custom_cta or topic_data.get("cta", self.config.get_cta(framework, topic_key_or_hook))
            topic_for_hashtags = topic_key_or_hook
        else:
            hook_text = topic_key_or_hook
            framework = framework or "pas"
            custom_cta = custom_cta or self.config.get_cta(framework)
            topic_for_hashtags = None
        
        print(f"📱 Generating Instagram carousel...")
        print(f"📐 Format: 4:5 portrait (1080x1350)")
        print(f"🎨 Framework: {self.config.FRAMEWORKS[framework]['name']}")
        print(f"📝 Hook: {hook_text}")
        
        # Generate caption
        caption = self.caption_gen.generate_caption(
            topic_key_or_hook, framework, custom_cta, self.ghostwriter_path
        )
        
        # Generate hashtags
        hashtags = self.hashtag_gen.generate_hashtags(topic=topic_for_hashtags, count=15)
        
        # Build full content for Designer
        full_content = f"{hook_text}. {caption}"
        
        # Generate visuals
        image_urls = []
        if self.designer:
            print(f"🎨 Generating {num_slides} carousel slides...")
            
            result = self.designer.generate({
                "content": full_content,
                "platform": "instagram",
                "format": "carousel"
            })
            
            if result.get("success"):
                image_urls = result.get("images", [])
                if result.get("brand_corrections"):
                    print(f"⚠️  Applied {len(result['brand_corrections'])} brand correction(s)")
            else:
                print(f"❌ Designer error: {result.get('error', 'Unknown error')}")
        else:
            print("⚠️  Designer not available, skipping image generation")
        
        carousel_result = {
            "hook": hook_text,
            "num_slides": num_slides,
            "images": image_urls,
            "caption": caption,
            "hashtags": hashtags,
            "hashtag_string": " ".join(hashtags),
            "platform": "instagram",
            "framework": framework,
            "topic": topic_key_or_hook
        }
        
        return carousel_result


# ===== TELEGRAM OUTPUT =====

def format_for_telegram(result: Dict[str, Any]) -> str:
    """Format carousel result for Telegram delivery"""
    lines = [
        "📱 *Instagram Carousel Ready*",
        "",
        f"🎯 *Hook:* {result['hook']}",
        f"📊 *Slides:* {result['num_slides']}",
        f"🎨 *Framework:* {result['framework'].upper()}",
        "",
        "📝 *Caption:*",
        "```",
        result['caption'],
        "```",
        "",
        "🏷️ *Hashtags:*",
        f"`{result['hashtag_string']}`",
        ""
    ]
    
    if result['images']:
        lines.append("🖼️ *Images:*")
        for i, url in enumerate(result['images'], 1):
            lines.append(f"{i}. {url}")
        lines.append("")
    
    lines.append("✅ Review and post manually to Instagram")
    
    return "\n".join(lines)


# ===== CLI =====

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Instagram carousel generator with PAS framework",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Use predefined topic
  python instagram_carousel_generator.py topic_key

  # Use custom hook
  python instagram_carousel_generator.py "Your custom hook here"

  # With specific framework
  python instagram_carousel_generator.py "Hook" --framework story

  # With custom CTA
  python instagram_carousel_generator.py "Hook" --cta "DM 'ACTION'"

  # Custom config path
  python instagram_carousel_generator.py "Hook" --config /path/to/config.json
        """
    )
    
    parser.add_argument("topic_or_hook", help="Predefined topic key OR custom hook text")
    parser.add_argument("--num-slides", type=int, default=4, help="Number of slides (4 or 5)")
    parser.add_argument("--framework", choices=["pas", "story", "insight"], help="Framework to use")
    parser.add_argument("--cta", help="Custom CTA text")
    parser.add_argument("--config", help="Path to client config JSON file")
    parser.add_argument("--json", action="store_true", help="Output as JSON for programmatic use")
    
    args = parser.parse_args()
    
    try:
        generator = InstagramCarouselGenerator(
            config_path=args.config
        )
        
        result = generator.generate_carousel(
            args.topic_or_hook,
            num_slides=args.num_slides,
            framework=args.framework,
            custom_cta=args.cta
        )
        
        # Output as JSON for programmatic use (e.g., Telegram delivery by agent)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            # Human-readable output for Telegram delivery
            print("\n" + "="*80)
            print("📱 INSTAGRAM CAROUSEL READY FOR REVIEW")
            print("="*80)
            print(f"🎯 Hook: {result['hook']}")
            print(f"📊 Slides: {result['num_slides']}")
            print(f"🎨 Framework: {result['framework'].upper()}")
            
            print(f"\n📝 Caption ({len(result['caption'])} chars):")
            print("-"*80)
            print(result['caption'])
            print("-"*80)
            
            print(f"\n🏷️ Hashtags ({len(result['hashtags'])}):")
            print(result['hashtag_string'])
            
            if result['images']:
                print("\n" + "="*80)
                print("🖼️ IMAGE URLS:")
                for i, url in enumerate(result['images'], 1):
                    print(f"{i}. {url}")
                print("="*80)
            
            print("\n✅ Review and post manually to Instagram")
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
