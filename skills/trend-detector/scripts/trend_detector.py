#!/usr/bin/env python3
"""
Trend Detector - Trend Monitor for Content Strategies v4.0

Detects trends using multiple sources:
- Buffer: Published posts with engagement metrics (RECOMMENDED)
- Perplexity: Real-time trend search
- X/Twitter and LinkedIn: Direct APIs (requires API keys)

Features:
- Find viral posts about your niche
- Identify hook patterns that work
- Suggest themes based on trends
- Store trend history

Usage:
    # Detect trends from Buffer (RECOMMENDED)
    python trend_detector.py detect --source buffer --days 30

    # Detect trends with Perplexity
    python trend_detector.py detect --source perplexity --results 5

    # Detect trends X/LinkedIn (requires API keys)
    python trend_detector.py detect --source all --hours 24

    # Analyze hook patterns from Buffer
    python trend_detector.py patterns --source buffer --days 30

    # Generate suggested themes
    python trend_detector.py suggest --source buffer --limit 5
"""

import os
import sys
import json
import hashlib
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from pathlib import Path
from enum import Enum


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


class TrendSource(Enum):
    """Trend sources"""
    X = "x"           # X/Twitter (requires API key)
    LINKEDIN = "linkedin"  # LinkedIn (requires API key)
    BUFFER = "buffer"      # Buffer posts (RECOMMENDED - already configured)
    PERPLEXITY = "perplexity"  # Perplexity API (real-time search)
    ALL = "all"        # All sources


class ViralityThreshold(Enum):
    """Virality thresholds"""
    HIGH = "high"      # > 10K engagement
    MEDIUM = "medium"  # > 1K engagement
    LOW = "low"        # > 100 engagement


@dataclass
class TrendingPost:
    """Trending post"""
    id: str
    source: str           # x, linkedin
    author: str
    author_followers: int
    text: str
    url: str
    engagement: int       # likes + comments + shares
    virality: str         # high, medium, low

    # Extracted metadata
    extracted_keywords: List[str] = field(default_factory=list)
    hook_pattern: str = ""
    content_category: str = ""  # regulatory, geopolitical, etc

    # Timestamps
    published_at: str = ""
    detected_at: str = ""

    def to_theme(self) -> Dict[str, Any]:
        """Converts trending post to theme for Content Matrix"""
        # Extract title from first words
        titulo = self.text[:100].split('\n')[0].strip()

        return {
            "titulo": titulo,
            "conteudo": self.text,
            "fonte": f"trend_{self.source}",
            "url": self.url,
            "dados_extraidos": {
                "virality": self.virality,
                "engagement": self.engagement,
                "author_followers": self.author_followers,
                "hook_pattern": self.hook_pattern,
                "keywords": self.extracted_keywords
            }
        }


@dataclass
class HookPattern:
    """Identified hook pattern"""
    pattern: str           # Ex: "⚠️ URGENT: {deadline} days"
    category: str          # regulatory, geopolitical, etc
    virality_score: float  # Score based on average engagement
    usage_count: int       # How many times it was used
    examples: List[str] = field(default_factory=list)

    def generate_hook(self, context: Dict) -> str:
        """Generates hook based on pattern"""
        # Placeholder for dynamic generation
        return self.pattern.format(**context)


class TrendDetector:
    """Trend monitor for Content Matrix"""

    # Keywords for the OPEX/COMEX niche (customize for your niche)
    COMEX_KEYWORDS = [
        "importação", "exportação", "comex", "duimp", "ncm",
        "aduana", "aduaneiro", "despacho", "li", "licença",
        "drawback", "ex-tarifário", "secex", "rfb", "receita",
        "tarifa", "imposto", "tributo", "taxa", "prazo",
        "portaria", "instrução normativa", "dou", "diário oficial",
        "câmbio", "dólar", "frete", "contêiner", "logística",
        "china", "importar da china", "exportar para china",
        "mercosul", "acordo", "trade war", "guerra comercial"
    ]

    # Minimum virality by category
    VIRALITY_THRESHOLDS = {
        ViralityThreshold.HIGH: 10000,
        ViralityThreshold.MEDIUM: 1000,
        ViralityThreshold.LOW: 100
    }

    def __init__(
        self,
        x_api_key: Optional[str] = None,
        linkedin_token: Optional[str] = None,
        cache_dir: Optional[Path] = None
    ):
        """
        Initialize Trend Detector

        Args:
            x_api_key: X API key (optional, uses env var if not provided)
            linkedin_token: LinkedIn access token (optional)
            cache_dir: Directory for trend cache
        """
        self.x_api_key = x_api_key or os.environ.get("X_API_KEY")
        self.linkedin_token = linkedin_token or os.environ.get("LINKEDIN_ACCESS_TOKEN")

        # Cache directory - workspace-relative
        if cache_dir is None:
            workspace = get_workspace_dir()
            cache_dir = workspace / ".openclaw" / "trend-detector" / "cache"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Load history
        self.trend_history_file = self.cache_dir / "trend_history.json"
        self.trend_history = self._load_history()

        # Hook patterns
        self.patterns_file = self.cache_dir / "hook_patterns.json"
        self.hook_patterns = self._load_patterns()

    def detect_trends(
        self,
        source: str = "buffer",
        hours: int = 24,
        virality: str = "medium",
        days: int = 30
    ) -> List[TrendingPost]:
        """
        Detects trends on social media

        Args:
            source: Source (buffer, perplexity, x, linkedin, all)
            hours: Hours to search (used for x/linkedin)
            days: Days to search (used for buffer)
            virality: Minimum virality (high, medium, low)

        Returns:
            List of trending posts
        """
        print(f"🔍 Detecting trends: {source}")
        print()

        trending_posts = []

        # Buffer - Analysis of published posts
        if source in ["all", "buffer"]:
            print("📊 Analyzing Buffer posts...")
            buffer_posts = self._detect_buffer_trends(days, virality)
            trending_posts.extend(buffer_posts)
            print(f"   ✅ {len(buffer_posts)} posts found")

        # Perplexity - Real-time search
        if source in ["all", "perplexity"]:
            print("🤖 Searching with Perplexity...")
            perplexity_posts = self._detect_perplexity_trends()
            trending_posts.extend(perplexity_posts)
            print(f"   ✅ {len(perplexity_posts)} posts found")

        # X/Twitter - Direct API
        if source in ["all", "x"]:
            print("📱 Searching X/Twitter...")
            x_posts = self._detect_x_trends(hours, virality)
            trending_posts.extend(x_posts)
            print(f"   ✅ {len(x_posts)} posts found")

        # LinkedIn - Direct API
        if source in ["all", "linkedin"]:
            print("💼 Searching LinkedIn...")
            li_posts = self._detect_linkedin_trends(hours, virality)
            trending_posts.extend(li_posts)
            print(f"   ✅ {len(li_posts)} posts found")

        # Sort by engagement
        trending_posts.sort(key=lambda p: p.engagement, reverse=True)

        # Save to history
        self._save_to_history(trending_posts)

        return trending_posts

    def analyze_hook_patterns(
        self,
        source: str = "all",
        days: int = 7
    ) -> List[HookPattern]:
        """
        Analyzes hook patterns that work

        Args:
            source: Source to analyze
            days: Days to analyze

        Returns:
            List of identified patterns
        """
        print(f"🎣 Analyzing hook patterns: {source} ({days} days)")
        print()

        # Get posts from history
        cutoff_date = datetime.now() - timedelta(days=days)
        relevant_posts = [
            p for p in self.trend_history
            if (source == "all" or p["source"] == source)
            and datetime.fromisoformat(p["detected_at"]) > cutoff_date
        ]

        if not relevant_posts:
            print("⚠️  No posts found in the period")
            return []

        # Analyze patterns
        patterns = self._extract_hook_patterns(relevant_posts)

        # Sort by virality_score
        patterns.sort(key=lambda p: p.virality_score, reverse=True)

        # Save patterns
        self._save_patterns(patterns)

        return patterns

    def suggest_themes(
        self,
        source: str = "all",
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Suggests themes based on trends

        Args:
            source: Source of trends
            limit: Theme limit

        Returns:
            List of suggested themes
        """
        print(f"💡 Generating theme suggestions: {source}")
        print()

        # Get recent trends
        recent_trends = [
            p for p in self.trend_history
            if datetime.fromisoformat(p["detected_at"]) > datetime.now() - timedelta(hours=48)
        ]

        if not recent_trends:
            print("⚠️  No recent trends found")
            return []

        # Group by keywords
        theme_clusters = self._cluster_by_keywords(recent_trends)

        # Generate themes
        themes = []
        for cluster in theme_clusters[:limit]:
            theme = {
                "titulo": cluster["main_keyword"].title(),
                "conteudo": f"Trend detected with {cluster['post_count']} posts",
                "fonte": f"trend_{source}",
                "dados": {
                    "keywords": cluster["keywords"],
                    "avg_engagement": cluster["avg_engagement"],
                    "virality": cluster["virality"],
                    "suggested_framework": self._suggest_framework(cluster)
                }
            }
            themes.append(theme)

        return themes

    # Private methods

    def _detect_x_trends(
        self,
        hours: int,
        virality: str
    ) -> List[TrendingPost]:
        """Detects trends on X/Twitter"""
        posts = []

        # If no API key, return example
        if not self.x_api_key:
            print("   ⚠️  X_API_KEY not configured - using examples")
            return self._example_x_trends()

        # Real implementation would use X API v2
        # For now, returns examples
        return self._example_x_trends()

    def _detect_linkedin_trends(
        self,
        hours: int,
        virality: str
    ) -> List[TrendingPost]:
        """Detects trends on LinkedIn"""
        posts = []

        # If no token, return example
        if not self.linkedin_token:
            print("   ⚠️  LINKEDIN_ACCESS_TOKEN not configured - using examples")
            return self._example_linkedin_trends()

        # Real implementation would use LinkedIn API
        # For now, returns examples
        return self._example_linkedin_trends()

    def _example_x_trends(self) -> List[TrendingPost]:
        """Returns example X trends for testing"""
        return [
            TrendingPost(
                id="x_001",
                source="x",
                author="@comex_br",
                author_followers=50000,
                text="⚠️ URGENTE: Nova portaria da SECEX altera prazos de LI. Você tem 30 dias para se adaptar ou suas importações vão parar.",
                url="https://x.com/comex_br/status/123456",
                engagement=15420,
                virality="high",
                extracted_keywords=["portaria", "secex", "li", "prazos"],
                hook_pattern="⚠️ URGENTE: {contexto}. Você tem {prazo} para {ação}",
                content_category="regulatorio",
                published_at=(datetime.now() - timedelta(hours=2)).isoformat(),
                detected_at=datetime.now().isoformat()
            ),
            TrendingPost(
                id="x_002",
                source="x",
                author="@logistica_brasil",
                author_followers=35000,
                text="📢 Frete internacional subiu 150% em 2024. O que isso significa para seu custo de importação?",
                url="https://x.com/logistica_brasil/status/123457",
                engagement=8900,
                virality="high",
                extracted_keywords=["frete", "importação", "custo"],
                hook_pattern="📢 {tema} {variação}. {pergunta}",
                content_category="macroeconomico",
                published_at=(datetime.now() - timedelta(hours=5)).isoformat(),
                detected_at=datetime.now().isoformat()
            )
        ]

    def _example_linkedin_trends(self) -> List[TrendingPost]:
        """Returns example LinkedIn trends for testing"""
        return [
            TrendingPost(
                id="li_001",
                source="linkedin",
                author="João Silva - Especialista em COMEX",
                author_followers=15000,
                text="Acabei de ler a nova Instrução Normativa da RFB sobre DUIMP. As mudanças são significativas e impactam diretamente o dia a dia dos importadores. Principais pontos: 1) Novo leiaute de processo...",
                url="https://linkedin.com/post/123456",
                engagement=3200,
                virality="medium",
                extracted_keywords=["instrução normativa", "rfb", "duimp", "importadores"],
                hook_pattern="Acabei de {ação}. {impacto}. {estrutura}",
                content_category="regulatorio",
                published_at=(datetime.now() - timedelta(hours=3)).isoformat(),
                detected_at=datetime.now().isoformat()
            ),
            TrendingPost(
                id="li_002",
                source="linkedin",
                author="Maria Santos - Comércio Exterior",
                author_followers=25000,
                text="DICA DE OURO: Depois de 15 anos trabalhando com importação da China, aprendi que o segredo não é negociar preço, é negociar prazo de entrega.",
                url="https://linkedin.com/post/123457",
                engagement=5600,
                virality="high",
                extracted_keywords=["importação", "china", "negociação"],
                hook_pattern="DICA DE OURO: Depois de {contexto}, aprendi que {ensinamento}",
                content_category="pessoal",
                published_at=(datetime.now() - timedelta(hours=8)).isoformat(),
                detected_at=datetime.now().isoformat()
            )
        ]

    def _example_perplexity_trends(self) -> List[TrendingPost]:
        """Returns example Perplexity trends for testing"""
        return [
            TrendingPost(
                id="plx_001",
                source="perplexity",
                author="Perplexity AI",
                author_followers=0,
                text="As importações brasileiras cresceram 12% no último trimestre, impulsionadas pelo aumento da demanda por bens de capital. O setor de máquinas e equipamentos liderou o crescimento, com alta de 23% em comparação com o mesmo período do ano anterior.",
                url="https://example.com/news1",
                engagement=500,
                virality="medium",
                extracted_keywords=["importações", "cresceram", "equipamentos"],
                hook_pattern="data_statistic",
                content_category="macroeconomico",
                published_at=(datetime.now() - timedelta(hours=6)).isoformat(),
                detected_at=datetime.now().isoformat()
            ),
            TrendingPost(
                id="plx_002",
                source="perplexity",
                author="Perplexity AI",
                author_followers=0,
                text="Novas regras do DUIMP entram em vigor em 90 dias. O sistema unificado de importação vai substituir os atuais sistemas da RFB e simplificar o processo de licenciamento de importações.",
                url="https://example.com/news2",
                engagement=750,
                virality="high",
                extracted_keywords=["duimp", "regras", "rfb", "importação"],
                hook_pattern="announcement",
                content_category="regulatorio",
                published_at=(datetime.now() - timedelta(hours=12)).isoformat(),
                detected_at=datetime.now().isoformat()
            )
        ]

    def _detect_buffer_trends(
        self,
        days: int,
        virality: str
    ) -> List[TrendingPost]:
        """Detects trends by analyzing Buffer posts"""
        try:
            from buffer_trend_analyzer import BufferTrendAnalyzer

            # Create analyzer with demo mode if API key not available
            has_api_key = os.environ.get("BUFFER_API_KEY")
            analyzer = BufferTrendAnalyzer(demo_mode=not has_api_key)
            metrics = analyzer.analyze_posts(days=days)

            # Convert to TrendingPost
            posts = []
            for m in metrics[:20]:  # Top 20
                virality_level = "high" if m.total_engagement > 500 else "medium" if m.total_engagement > 200 else "low"

                posts.append(TrendingPost(
                    id=m.id,
                    source="buffer",
                    author="OPEX",  # Buffer doesn't have author
                    author_followers=0,
                    text=m.text,
                    url="",  # Buffer doesn't have public URL
                    engagement=m.total_engagement,
                    virality=virality_level,
                    extracted_keywords=m.keywords,
                    hook_pattern=m.hook_pattern,
                    content_category=m.content_category,
                    published_at=m.created_at,
                    detected_at=datetime.now().isoformat()
                ))

            return posts

        except ImportError:
            print("   ⚠️  Buffer Trend Analyzer not available")
            return []
        except Exception as e:
            print(f"   ⚠️  Error analyzing Buffer: {e}")
            return []

    def _detect_perplexity_trends(self) -> List[TrendingPost]:
        """Detects trends using Perplexity API (existing skill)"""
        try:
            # Find Perplexity skill
            perplexity_skill = find_skill_path("perplexity")
            if not perplexity_skill:
                print("   ⚠️  Perplexity skill not found - using examples")
                return self._example_perplexity_trends()
            
            # Add Perplexity skill to path
            sys.path.insert(0, str(perplexity_skill / "scripts"))
            from perplexity_search import perplexity_search

            api_key = os.environ.get("PERPLEXITY_API_KEY")
            if not api_key:
                print("   ⚠️  PERPLEXITY_API_KEY not configured - using examples")
                return self._example_perplexity_trends()

            # Trend queries
            trend_queries = [
                "tendências importação exportação Brasil 2024 últimos 30 dias",
                "novas regras comex DUIMP aduana Brasil últimas semanas",
                "notícias comércio exterior Brasil últimas 2 semanas"
            ]

            posts = []
            for query in trend_queries[:3]:  # Maximum 3 queries
                result = perplexity_search(
                    query=query,
                    api_key=api_key,
                    model="sonar",
                    search_recency_filter="month"
                )

                if "error" in result:
                    continue

                content = result.get("content", "")
                citations = result.get("citations", [])

                # Extract keywords
                keywords = self._extract_keywords(content)

                posts.append(TrendingPost(
                    id=f"perplexity_{hash(content[:50])}",
                    source="perplexity",
                    author="Perplexity AI",
                    author_followers=0,
                    text=content[:500],  # First 500 characters
                    url=citations[0] if citations else "",
                    engagement=100,  # Placeholder
                    virality="medium",
                    extracted_keywords=keywords,
                    hook_pattern="search_result",
                    content_category="general",
                    published_at=datetime.now().isoformat(),
                    detected_at=datetime.now().isoformat()
                ))

            return posts

        except ImportError:
            print("   ⚠️  Perplexity skill not available")
            return []
        except Exception as e:
            print(f"   ⚠️  Error searching Perplexity: {e}")
            return []

    def _extract_keywords(self, text: str) -> List[str]:
        """Extracts keywords from text based on COMEX_KEYWORDS list"""
        text_lower = text.lower()
        found = []

        for keyword in self.COMEX_KEYWORDS:
            if keyword in text_lower:
                found.append(keyword)

        return found

    def _extract_hook_patterns(self, posts: List[Dict]) -> List[HookPattern]:
        """Extracts hook patterns from posts"""
        # Simplified implementation - in practice would use NLP
        patterns = []

        # Manual patterns based on observation
        manual_patterns = [
            {
                "pattern": "⚠️ URGENTE: {contexto}. Você tem {prazo} para {ação}",
                "category": "regulatorio",
                "examples": []
            },
            {
                "pattern": "📢 {tema} {variação}. {pergunta}",
                "category": "macroeconomico",
                "examples": []
            },
            {
                "pattern": "DICA DE OURO: Depois de {contexto}, aprendi que {ensinamento}",
                "category": "pessoal",
                "examples": []
            },
            {
                "pattern": "Acabei de {ação}. {impacto}. {estrutura}",
                "category": "regulatorio",
                "examples": []
            }
        ]

        for p in manual_patterns:
            patterns.append(HookPattern(
                pattern=p["pattern"],
                category=p["category"],
                virality_score=7.5,  # Placeholder
                usage_count=0,
                examples=p["examples"]
            ))

        return patterns

    def _cluster_by_keywords(self, posts: List[Dict]) -> List[Dict]:
        """Groups posts by keywords to identify themes"""
        # Count keywords
        keyword_counts = {}
        keyword_posts = {}

        for post in posts:
            for keyword in post.get("extracted_keywords", []):
                keyword_counts[keyword] = keyword_counts.get(keyword, 0) + 1
                if keyword not in keyword_posts:
                    keyword_posts[keyword] = []
                keyword_posts[keyword].append(post)

        # Create clusters
        clusters = []
        for keyword, count in sorted(keyword_counts.items(), key=lambda x: x[1], reverse=True):
            related_posts = keyword_posts[keyword]
            avg_engagement = sum(p.get("engagement", 0) for p in related_posts) / len(related_posts)

            clusters.append({
                "main_keyword": keyword,
                "keywords": [keyword] + self._get_related_keywords(keyword, keyword_counts.keys()),
                "post_count": count,
                "avg_engagement": avg_engagement,
                "virality": "high" if avg_engagement > 10000 else "medium" if avg_engagement > 1000 else "low"
            })

        return sorted(clusters, key=lambda c: c["avg_engagement"], reverse=True)

    def _get_related_keywords(self, keyword: str, all_keywords: List[str]) -> List[str]:
        """Returns related keywords"""
        # Simplified - in practice would use word embeddings
        related_map = {
            "duimp": ["ncm", "aduana", "despacho"],
            "importação": ["frete", "china", "câmbio"],
            "prazo": ["portaria", "licença", "li"],
            "tarifa": ["imposto", "tributo", "taxa"]
        }
        return related_map.get(keyword, [])[:3]

    def _suggest_framework(self, cluster: Dict) -> str:
        """Suggests framework based on cluster"""
        keyword = cluster["main_keyword"].lower()

        if keyword in ["portaria", "prazo", "urgente", "nova regra"]:
            return "PAS"
        elif keyword in ["dica", "aprendi", "experiência", "anos"]:
            return "STORY"
        elif keyword in ["frete", "câmbio", "aumentou", "dados"]:
            return "INSIGHT"
        elif keyword in ["melhor", "pior", "deveria", "erro"]:
            return "TAKE"
        else:
            return "INSIGHT"

    def _load_history(self) -> List[Dict]:
        """Loads trend history"""
        if self.trend_history_file.exists():
            with open(self.trend_history_file, 'r') as f:
                return json.load(f)
        return []

    def _save_to_history(self, posts: List[TrendingPost]):
        """Saves posts to history"""
        for post in posts:
            post_dict = {
                "id": post.id,
                "source": post.source,
                "author": post.author,
                "text": post.text,
                "url": post.url,
                "engagement": post.engagement,
                "virality": post.virality,
                "extracted_keywords": post.extracted_keywords,
                "hook_pattern": post.hook_pattern,
                "content_category": post.content_category,
                "published_at": post.published_at,
                "detected_at": post.detected_at
            }
            self.trend_history.append(post_dict)

        # Save file
        with open(self.trend_history_file, 'w') as f:
            json.dump(self.trend_history, f, indent=2, ensure_ascii=False)

    def _load_patterns(self) -> List[HookPattern]:
        """Loads hook patterns"""
        if self.patterns_file.exists():
            with open(self.patterns_file, 'r') as f:
                patterns_data = json.load(f)
                return [
                    HookPattern(
                        pattern=p["pattern"],
                        category=p["category"],
                        virality_score=p["virality_score"],
                        usage_count=p["usage_count"],
                        examples=p["examples"]
                    )
                    for p in patterns_data
                ]
        return []

    def _save_patterns(self, patterns: List[HookPattern]):
        """Saves hook patterns"""
        patterns_data = [
            {
                "pattern": p.pattern,
                "category": p.category,
                "virality_score": p.virality_score,
                "usage_count": p.usage_count,
                "examples": p.examples
            }
            for p in patterns
        ]
        with open(self.patterns_file, 'w') as f:
            json.dump(patterns_data, f, indent=2, ensure_ascii=False)


def get_trend_detector() -> TrendDetector:
    """Factory function"""
    return TrendDetector()


# CLI interface
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Trend Detector - Trend Monitor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Detect trends
  python trend_detector.py detect --source all --hours 24

  # Analyze hook patterns
  python trend_detector.py patterns --source all --days 7

  # Generate suggested themes
  python trend_detector.py suggest --source all
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Command")

    # Command: detect
    detect_parser = subparsers.add_parser("detect", help="Detect trends")
    detect_parser.add_argument("--source", choices=["x", "linkedin", "buffer", "perplexity", "all"], default="buffer", help="Source (buffer=recommended)")
    detect_parser.add_argument("--hours", type=int, default=24, help="Hours to search (x/linkedin)")
    detect_parser.add_argument("--days", type=int, default=30, help="Days to search (buffer)")
    detect_parser.add_argument("--virality", choices=["high", "medium", "low"], default="medium", help="Minimum virality")
    detect_parser.add_argument("--output", help="Save to JSON file")

    # Command: patterns
    patterns_parser = subparsers.add_parser("patterns", help="Analyze hook patterns")
    patterns_parser.add_argument("--source", choices=["x", "linkedin", "buffer", "perplexity", "all"], default="buffer", help="Source")
    patterns_parser.add_argument("--days", type=int, default=7, help="Days to analyze")

    # Command: suggest
    suggest_parser = subparsers.add_parser("suggest", help="Suggest themes")
    suggest_parser.add_argument("--source", choices=["x", "linkedin", "all"], default="all", help="Source")
    suggest_parser.add_argument("--limit", type=int, default=5, help="Theme limit")
    suggest_parser.add_argument("--output", help="Save to JSON file")

    args = parser.parse_args()

    detector = get_trend_detector()

    if args.command == "detect":
        trends = detector.detect_trends(args.source, args.hours, args.virality, args.days)

        print()
        print(f"📊 {len(trends)} trends found")
        print("-" * 60)

        for i, trend in enumerate(trends[:10], 1):  # Show top 10
            emoji = "🔥" if trend.virality == "high" else "📈" if trend.virality == "medium" else "📉"
            print(f"{emoji} [{i}] {trend.source.upper()}")
            print(f"   Author: {trend.author} ({trend.author_followers:,} followers)")
            print(f"   Text: {trend.text[:80]}...")
            print(f"   Engagement: {trend.engagement:,}")
            print(f"   Category: {trend.content_category}")
            print(f"   Hook Pattern: {trend.hook_pattern[:60]}...")
            print()

        if args.output:
            # Export to JSON
            output_data = [
                {
                    "id": t.id,
                    "source": t.source,
                    "text": t.text,
                    "url": t.url,
                    "engagement": t.engagement,
                    "virality": t.virality,
                    "hook_pattern": t.hook_pattern
                }
                for t in trends
            ]
            with open(args.output, 'w') as f:
                json.dump(output_data, f, indent=2, ensure_ascii=False)
            print(f"✅ Saved to {args.output}")

    elif args.command == "patterns":
        patterns = detector.analyze_hook_patterns(args.source, args.days)

        print()
        print(f"🎣 {len(patterns)} patterns found")
        print("-" * 60)

        for i, pattern in enumerate(patterns, 1):
            print(f"{i}. {pattern.pattern}")
            print(f"   Category: {pattern.category}")
            print(f"   Virality Score: {pattern.virality_score:.1f}/10")
            print()

    elif args.command == "suggest":
        themes = detector.suggest_themes(args.source, args.limit)

        print()
        print(f"💡 {len(themes)} themes suggested")
        print("-" * 60)

        for i, theme in enumerate(themes, 1):
            print(f"{i}. {theme['titulo']}")
            print(f"   Keywords: {', '.join(theme['dados']['keywords'][:5])}")
            print(f"   Avg Engagement: {theme['dados']['avg_engagement']:.0f}")
            print(f"   Suggested Framework: {theme['dados']['suggested_framework']}")
            print()

        if args.output:
            with open(args.output, 'w') as f:
                json.dump(themes, f, indent=2, ensure_ascii=False)
            print(f"✅ Saved to {args.output}")

    else:
        parser.print_help()
