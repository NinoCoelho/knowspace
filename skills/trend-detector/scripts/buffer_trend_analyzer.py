#!/usr/bin/env python3
"""
Buffer Trend Analyzer - Detects trends based on Buffer posts

Analyzes posts already published on Buffer to identify:
- Posts with highest engagement
- Hook patterns that work
- Best posting times
- Most popular themes

Usage:
    python buffer_trend_analyzer.py analyze --days 30
"""

import os
import sys
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass
from pathlib import Path


def get_workspace_dir() -> Path:
    """Get the current workspace directory"""
    # Try environment variable first
    workspace = os.environ.get("OPENCLAW_WORKSPACE")
    if workspace:
        return Path(workspace)
    
    # Try current working directory
    cwd = Path.cwd()
    if (cwd / ".openclaw").exists():
        return cwd
    
    # Fall back to default
    return Path.home() / ".openclaw" / "workspace"


def find_skill_path(skill_name: str) -> Optional[Path]:
    """
    Find a skill directory in multiple possible locations
    
    Args:
        skill_name: Name of the skill to find
        
    Returns:
        Path to skill directory or None if not found
    """
    # Possible locations in order of preference
    locations = [
        # Global shared skills
        Path.home() / ".npm-global" / "lib" / "node_modules" / "openclaw" / "skills" / skill_name,
        # Workspace-level skills (for backward compatibility)
        get_workspace_dir() / "skills" / "public" / skill_name,
        # Legacy location
        Path.home() / ".openclaw" / "workspace" / "skills" / "public" / skill_name,
    ]
    
    for location in locations:
        if location.exists():
            return location
    
    return None


# Add Buffer skill to path
buffer_skill = find_skill_path("buffer")
if buffer_skill:
    sys.path.insert(0, str(buffer_skill / "scripts"))

try:
    import buffer_client
    HAS_BUFFER = True
except ImportError:
    HAS_BUFFER = False


@dataclass
class PostMetrics:
    """Metrics for a Buffer post"""
    id: str
    text: str
    channel: str           # linkedin, instagram, twitter
    service: str
    status: str            # sent, scheduled, draft
    created_at: str
    sent_at: Optional[str]
    due_at: Optional[str]

    # Engagement metrics (when available)
    likes: int = 0
    comments: int = 0
    shares: int = 0
    total_engagement: int = 0

    # Extracted analysis
    hook_pattern: str = ""
    content_category: str = ""
    keywords: List[str] = None

    def __post_init__(self):
        if self.keywords is None:
            self.keywords = []


class BufferTrendAnalyzer:
    """Trend analyzer based on Buffer posts"""

    # Keywords for the OPEX/COMEX niche (customize for your niche)
    COMEX_KEYWORDS = [
        "importação", "exportação", "comex", "duimp", "ncm",
        "aduana", "despacho", "li", "licença", "drawback",
        "secex", "rfb", "receita", "tarifa", "imposto",
        "câmbio", "dólar", "frete", "contêiner", "logística",
        "china", "mercosul", "acordo", "portaria", "dou"
    ]

    def __init__(self, api_key: Optional[str] = None, org_id: Optional[str] = None, demo_mode: bool = False):
        """
        Initialize Buffer Trend Analyzer

        Args:
            api_key: Buffer API key (uses env var if not provided)
            org_id: Organization ID (searches if not provided)
            demo_mode: If True, uses example data when API key not available
        """
        if not HAS_BUFFER:
            raise ImportError("Buffer skill not available")

        self.api_key = api_key or os.environ.get("BUFFER_API_KEY")
        if not self.api_key:
            if demo_mode:
                self.api_key = "demo"
                self.org_id = "demo_org"
                return
            raise ValueError("BUFFER_API_KEY not configured")

        self.org_id = org_id or buffer_client.get_organization_id(self.api_key)

    def analyze_posts(
        self,
        days: int = 30,
        status: Optional[List[str]] = None
    ) -> List[PostMetrics]:
        """
        Analyzes Buffer posts

        Args:
            days: Days to analyze
            status: Filter by status (sent, scheduled, draft)

        Returns:
            List of post metrics
        """
        print(f"📊 Analyzing Buffer posts ({days} days)")
        print()

        # Demo mode - returns example data
        if self.api_key == "demo":
            print("   ⚠️  Demo mode - using example data")
            return self._demo_posts()

        if status is None:
            status = ["sent"]  # Only sent posts

        # Get posts from Buffer
        result = buffer_client.list_posts(
            organization_id=self.org_id,
            api_key=self.api_key,
            status=status,
            first=100,
            sort_by="createdAt",
            sort_direction="desc"
        )

        if "error" in result:
            print(f"❌ Error fetching posts: {result['error']}")
            return []

        # Process posts
        posts = result.get("data", {}).get("posts", {}).get("edges", [])

        metrics_list = []
        cutoff_date = datetime.now() - timedelta(days=days)

        for edge in posts:
            node = edge.get("node", {})
            post_data = self._extract_post_data(node)

            # Filter by date
            if post_data["created_at"]:
                created_date = datetime.fromisoformat(post_data["created_at"].replace("Z", "+00:00"))
                if created_date < cutoff_date:
                    continue

            # Create metrics
            metrics = PostMetrics(
                id=post_data["id"],
                text=post_data["text"],
                channel=post_data["channel"],
                service=post_data["service"],
                status=post_data["status"],
                created_at=post_data["created_at"],
                sent_at=post_data.get("sent_at"),
                due_at=post_data.get("due_at")
            )

            # Extract keywords
            metrics.keywords = self._extract_keywords(metrics.text)

            # Detect hook pattern
            metrics.hook_pattern = self._detect_hook_pattern(metrics.text)

            # Classify category
            metrics.content_category = self._classify_category(metrics.text, metrics.keywords)

            # Simulate engagement (Buffer doesn't provide this info directly)
            # In practice, you would need to fetch from each social network
            metrics.total_engagement = self._estimate_engagement(metrics)

            metrics_list.append(metrics)

        # Sort by engagement
        metrics_list.sort(key=lambda m: m.total_engagement, reverse=True)

        print(f"✅ {len(metrics_list)} posts analyzed")
        return metrics_list

    def get_top_performing_posts(
        self,
        days: int = 30,
        limit: int = 10
    ) -> List[PostMetrics]:
        """
        Returns top performing posts

        Args:
            days: Days to analyze
            limit: Post limit

        Returns:
            List of top performer posts
        """
        metrics = self.analyze_posts(days)
        return metrics[:limit]

    def get_hook_patterns_performance(
        self,
        days: int = 30
    ) -> Dict[str, Dict[str, Any]]:
        """
        Analyzes hook pattern performance

        Args:
            days: Days to analyze

        Returns:
            Dictionary with performance by pattern
        """
        metrics = self.analyze_posts(days)

        # Group by hook pattern
        pattern_stats = {}

        for m in metrics:
            pattern = m.hook_pattern or "no_pattern"

            if pattern not in pattern_stats:
                pattern_stats[pattern] = {
                    "count": 0,
                    "total_engagement": 0,
                    "posts": []
                }

            pattern_stats[pattern]["count"] += 1
            pattern_stats[pattern]["total_engagement"] += m.total_engagement
            pattern_stats[pattern]["posts"].append(m)

        # Calculate averages
        for pattern, stats in pattern_stats.items():
            stats["avg_engagement"] = stats["total_engagement"] / stats["count"]

        # Sort by average engagement
        return dict(sorted(
            pattern_stats.items(),
            key=lambda x: x[1]["avg_engagement"],
            reverse=True
        ))

    def get_trending_keywords(
        self,
        days: int = 30
    ) -> List[Dict[str, Any]]:
        """
        Identifies trending keywords

        Args:
            days: Days to analyze

        Returns:
            List of keywords with metrics
        """
        metrics = self.analyze_posts(days)

        # Count keywords
        keyword_counts = {}
        keyword_engagement = {}

        for m in metrics:
            for keyword in m.keywords:
                if keyword not in keyword_counts:
                    keyword_counts[keyword] = 0
                    keyword_engagement[keyword] = 0

                keyword_counts[keyword] += 1
                keyword_engagement[keyword] += m.total_engagement

        # Calculate average engagement
        trending = []
        for keyword, count in keyword_counts.items():
            if count >= 2:  # Appeared at least 2 times
                trending.append({
                    "keyword": keyword,
                    "count": count,
                    "total_engagement": keyword_engagement[keyword],
                    "avg_engagement": keyword_engagement[keyword] / count
                })

        # Sort by average engagement
        trending.sort(key=lambda x: x["avg_engagement"], reverse=True)

        return trending

    def _demo_posts(self) -> List[PostMetrics]:
        """Returns example posts for demonstration"""
        now = datetime.now()
        return [
            PostMetrics(
                id="demo_001",
                text="⚠️ URGENTE: Nova portaria da SECEX altera prazos de LI. Você tem 30 dias para se adaptar.",
                channel="linkedin",
                service="linkedin",
                status="sent",
                created_at=(now - timedelta(days=2)).isoformat(),
                sent_at=(now - timedelta(days=2)).isoformat(),
                due_at=None,
                likes=120,
                comments=25,
                shares=15,
                total_engagement=850,
                hook_pattern="alerta_urgente",
                content_category="regulatorio",
                keywords=["portaria", "secex", "li", "prazos"]
            ),
            PostMetrics(
                id="demo_002",
                text="DICA DE OURO: Depois de 15 anos trabalhando com importação da China, aprendi que o segredo não é negociar preço.",
                channel="linkedin",
                service="linkedin",
                status="sent",
                created_at=(now - timedelta(days=5)).isoformat(),
                sent_at=(now - timedelta(days=5)).isoformat(),
                due_at=None,
                likes=95,
                comments=18,
                shares=10,
                total_engagement=720,
                hook_pattern="dica_ouro",
                content_category="pessoal",
                keywords=["importação", "china", "negociação"]
            ),
            PostMetrics(
                id="demo_003",
                text="📢 Frete internacional subiu 150% em 2024. O que isso significa para seu custo de importação?",
                channel="instagram",
                service="instagram",
                status="sent",
                created_at=(now - timedelta(days=7)).isoformat(),
                sent_at=(now - timedelta(days=7)).isoformat(),
                due_at=None,
                likes=85,
                comments=12,
                shares=8,
                total_engagement=620,
                hook_pattern="anuncio",
                content_category="macroeconomico",
                keywords=["frete", "importação", "custo"]
            ),
            PostMetrics(
                id="demo_004",
                text="DUIMP: Saiba como o novo sistema vai impactar suas importações. Principais mudanças e prazos.",
                channel="linkedin",
                service="linkedin",
                status="sent",
                created_at=(now - timedelta(days=10)).isoformat(),
                sent_at=(now - timedelta(days=10)).isoformat(),
                due_at=None,
                likes=75,
                comments=10,
                shares=5,
                total_engagement=510,
                hook_pattern="generic",
                content_category="operacional",
                keywords=["duimp", "importação", "prazos"]
            )
        ]

    # Helper methods

    def _extract_post_data(self, node: Dict) -> Dict[str, Any]:
        """Extracts post data from Buffer"""
        channel_data = node.get("channel", {})

        return {
            "id": node.get("id", ""),
            "text": node.get("text", ""),
            "channel": channel_data.get("service", ""),  # linkedin, instagram, etc
            "service": channel_data.get("service", ""),
            "status": node.get("status", ""),
            "created_at": node.get("createdAt", ""),
            "sent_at": node.get("sentAt", ""),
            "due_at": node.get("dueAt", "")
        }

    def _extract_keywords(self, text: str) -> List[str]:
        """Extracts keywords from text"""
        text_lower = text.lower()
        found = []

        for keyword in self.COMEX_KEYWORDS:
            if keyword in text_lower:
                found.append(keyword)

        return found

    def _detect_hook_pattern(self, text: str) -> str:
        """Detects hook pattern in text"""
        text_stripped = text.strip()

        # Known patterns
        patterns = [
            ("⚠️", "alerta_urgente"),
            ("🚨", "alerta_urgente"),
            ("URGENTE", "urgente_texto"),
            ("DICA DE OURO", "dica_ouro"),
            ("DICA", "dica"),
            ("💡", "ideia"),
            ("📢", "anuncio"),
            ("Você tem", "prazo_pergunta"),
            ("Depois de", "experiencia"),
            ("Acabei de", "acao_recente"),
            ("?", "pergunta"),
            ("📈", "crescimento"),
            ("📉", "queda")
        ]

        for marker, pattern in patterns:
            if marker in text_stripped[:50]:  # Check only beginning
                return pattern

        return "generic"

    def _classify_category(self, text: str, keywords: List[str]) -> str:
        """Classifies content category"""
        text_lower = text.lower()

        # Regulatory
        if any(kw in text_lower for kw in ["portaria", "dou", "instrução normativa", "secex", "rfb"]):
            return "regulatorio"

        # Personal/Experience
        if any(kw in text_lower for kw in ["depois de", "anos", "experiência", "aprendi"]):
            return "pessoal"

        # Macroeconomic
        if any(kw in text_lower for kw in ["câmbio", "dólar", "inflação", "piu", "crescimento"]):
            return "macroeconomico"

        # Geopolitical
        if any(kw in text_lower for kw in ["acordo", "china", "eua", "guerra comercial", "tarifa"]):
            return "geopolitico"

        # Operational
        if any(kw in text_lower for kw in ["duimp", "ncm", "aduana", "despacho", "li"]):
            return "operacional"

        return "geral"

    def _estimate_engagement(self, metrics: PostMetrics) -> int:
        """
        Estimates engagement based on post characteristics

        Note: Buffer doesn't provide engagement metrics directly.
        In practice, you would need to fetch from each API (LinkedIn, Instagram, etc).
        """
        score = 0

        # Base score
        score += 100

        # Hook pattern
        hook_bonus = {
            "alerta_urgente": 500,
            "urgente_texto": 400,
            "dica_ouro": 300,
            "pergunta": 200,
            "anuncio": 150
        }
        score += hook_bonus.get(metrics.hook_pattern, 0)

        # Text length
        text_len = len(metrics.text)
        if 100 <= text_len <= 500:
            score += 100
        elif 500 < text_len <= 1000:
            score += 50

        # Hashtags
        hashtag_count = metrics.text.count("#")
        score += hashtag_count * 20

        # Keywords
        score += len(metrics.keywords) * 30

        # Emoji
        emoji_count = sum(1 for c in metrics.text if ord(c) > 127)
        if emoji_count > 0:
            score += emoji_count * 10

        return score


def main():
    """CLI interface"""
    import argparse

    parser = argparse.ArgumentParser(description="Buffer Trend Analyzer")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    # Command: analyze
    analyze_parser = subparsers.add_parser("analyze", help="Analyze posts")
    analyze_parser.add_argument("--days", type=int, default=30, help="Days to analyze")
    analyze_parser.add_argument("--limit", type=int, default=10, help="Post limit")

    # Command: hooks
    hooks_parser = subparsers.add_parser("hooks", help="Analyze hook patterns")
    hooks_parser.add_argument("--days", type=int, default=30, help="Days to analyze")

    # Command: keywords
    keywords_parser = subparsers.add_parser("keywords", help="Trending keywords")
    keywords_parser.add_argument("--days", type=int, default=30, help="Days to analyze")

    args = parser.parse_args()

    try:
        # Use demo mode if API key not configured
        has_api_key = os.environ.get("BUFFER_API_KEY")
        analyzer = BufferTrendAnalyzer(demo_mode=not has_api_key)

        if args.command == "analyze":
            posts = analyzer.get_top_performing_posts(args.days, args.limit)

            print(f"📊 Top {len(posts)} Posts ({args.days} days)")
            print("-" * 60)

            for i, post in enumerate(posts, 1):
                print(f"\n{i}. [{post.service.upper()}] {post.channel}")
                print(f"   Hook: {post.hook_pattern}")
                print(f"   Category: {post.content_category}")
                print(f"   Engagement: {post.total_engagement}")
                print(f"   Text: {post.text[:80]}...")
                if post.keywords:
                    print(f"   Keywords: {', '.join(post.keywords[:5])}")

        elif args.command == "hooks":
            patterns = analyzer.get_hook_patterns_performance(args.days)

            print("🎣 Hook Performance")
            print("-" * 60)

            for pattern, stats in patterns.items():
                print(f"\n{pattern}:")
                print(f"   Count: {stats['count']}")
                print(f"   Avg Engagement: {stats['avg_engagement']:.0f}")

        elif args.command == "keywords":
            trending = analyzer.get_trending_keywords(args.days)

            print("🔥 Trending Keywords")
            print("-" * 60)

            for i, kw in enumerate(trending[:15], 1):
                print(f"{i}. {kw['keyword']}")
                print(f"   Count: {kw['count']}")
                print(f"   Avg Engagement: {kw['avg_engagement']:.0f}")

        else:
            parser.print_help()

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
