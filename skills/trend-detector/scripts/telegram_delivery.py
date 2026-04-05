#!/usr/bin/env python3
"""
Telegram Delivery - Sends trend analysis results to Telegram for manual review

Formats and delivers:
- Trend analysis results
- Recommended hooks/angles
- Source links
- Actionable insights

Usage:
    python telegram_delivery.py send --trends-file trends.json
    python telegram_delivery.py send --trends-file trends.json --chat-id -1001234567890
"""

import os
import sys
import json
import asyncio
from typing import Dict, List, Any, Optional
from pathlib import Path
from datetime import datetime


def get_workspace_dir() -> Path:
    """Get the current workspace directory"""
    workspace = os.environ.get("KNOWSPACE_WORKSPACE") or os.environ.get("OPENCLAW_WORKSPACE")
    if workspace:
        return Path(workspace)
    
    cwd = Path.cwd()
    if (cwd / ".openclaw").exists():
        return cwd
    
    return Path.home() / ".openclaw" / "workspace"


def find_skill_path(skill_name: str) -> Optional[Path]:
    """Find a skill directory in multiple possible locations"""
    locations = [
        get_workspace_dir() / "skills" / "public" / skill_name,
        Path.home() / ".npm-global" / "lib" / "node_modules" / "openclaw" / "skills" / skill_name,
        Path.home() / ".openclaw" / "workspace" / "skills" / "public" / skill_name,
    ]
    
    for location in locations:
        if location.exists():
            return location
    
    return None


# Try to load wacli skill for Telegram delivery
wacli_skill = find_skill_path("wacli")
if wacli_skill:
    sys.path.insert(0, str(wacli_skill / "scripts"))


class TelegramTrendDelivery:
    """Delivers trend analysis results to Telegram"""
    
    def __init__(self, bot_token: Optional[str] = None, default_chat_id: Optional[str] = None):
        """
        Initialize Telegram delivery
        
        Args:
            bot_token: Telegram bot token (uses env var if not provided)
            default_chat_id: Default chat ID for delivery (uses env var if not provided)
        """
        self.bot_token = bot_token or os.environ.get("TELEGRAM_BOT_TOKEN")
        self.default_chat_id = default_chat_id or os.environ.get("TELEGRAM_CHAT_ID")
        
        if not self.bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN not configured")
    
    def format_trend_report(self, trends: List[Dict[str, Any]], analysis_type: str = "buffer") -> str:
        """
        Format trends into a Telegram-friendly message
        
        Args:
            trends: List of trend data
            analysis_type: Source type (buffer, perplexity, etc)
            
        Returns:
            Formatted message string
        """
        if not trends:
            return "📊 *Trend Analysis Complete*\n\nNo trends found in this analysis."
        
        # Header
        lines = [
            "📊 *TREND ANALYSIS REPORT*",
            f"_Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}_",
            f"_Source: {analysis_type.upper()}_",
            "",
            f"Found *{len(trends)}* trending topics",
            ""
        ]
        
        # Top 5 trends with details
        for i, trend in enumerate(trends[:5], 1):
            emoji = "🔥" if trend.get('virality') == 'high' else "📈" if trend.get('virality') == 'medium' else "📊"
            
            lines.append(f"{emoji} *TREND #{i}*")
            lines.append("")
            
            # Hook/Angle
            if trend.get('hook_pattern'):
                lines.append(f"🎣 *Hook Pattern:* `{trend['hook_pattern']}`")
            
            # Category
            if trend.get('content_category'):
                lines.append(f"📂 *Category:* {trend['content_category'].title()}")
            
            # Engagement
            engagement = trend.get('engagement', 0)
            if engagement > 0:
                lines.append(f"💫 *Engagement:* {engagement:,}")
            
            # Source link
            if trend.get('url'):
                lines.append(f"🔗 *Source:* [View Original]({trend['url']})")
            
            # Preview text
            text = trend.get('text', '')
            if text:
                preview = text[:150].replace('\n', ' ')
                if len(text) > 150:
                    preview += "..."
                lines.append(f"📝 *Preview:*")
                lines.append(f"_{preview}_")
            
            # Keywords
            keywords = trend.get('extracted_keywords', [])
            if keywords:
                lines.append(f"🏷 *Keywords:* {', '.join(keywords[:5])}")
            
            lines.append("")
            lines.append("─" * 30)
            lines.append("")
        
        # Actionable insights section
        lines.append("💡 *ACTIONABLE INSIGHTS*")
        lines.append("")
        insights = self._generate_insights(trends)
        for insight in insights:
            lines.append(f"• {insight}")
        
        lines.append("")
        lines.append("─" * 30)
        
        # Footer
        lines.append("")
        lines.append("_Reply to approve content creation or provide feedback_")
        lines.append("_Use /create-content <trend_number> to generate posts_")
        
        return "\n".join(lines)
    
    def format_hook_analysis(self, patterns: List[Dict[str, Any]]) -> str:
        """
        Format hook pattern analysis for Telegram
        
        Args:
            patterns: List of hook patterns with performance data
            
        Returns:
            Formatted message string
        """
        if not patterns:
            return "🎣 *Hook Analysis Complete*\n\nNo hook patterns identified."
        
        lines = [
            "🎣 *HOOK PATTERN ANALYSIS*",
            f"_Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}_",
            "",
            f"Identified *{len(patterns)}* effective hook patterns",
            "",
            ""
        ]
        
        for i, pattern in enumerate(patterns[:5], 1):
            lines.append(f"*PATTERN #{i}*")
            lines.append(f"Template: `{pattern.get('pattern', 'N/A')}`")
            lines.append(f"Category: {pattern.get('category', 'N/A').title()}")
            lines.append(f"Virality Score: {pattern.get('virality_score', 0):.1f}/10")
            lines.append(f"Usage Count: {pattern.get('usage_count', 0)}")
            lines.append("")
        
        lines.append("💡 *RECOMMENDATION*")
        lines.append("Use high-scoring patterns for maximum engagement")
        lines.append("")
        lines.append("_Reply with /apply-hook <number> to use a pattern_")
        
        return "\n".join(lines)
    
    def format_keyword_trends(self, keywords: List[Dict[str, Any]]) -> str:
        """
        Format trending keywords for Telegram
        
        Args:
            keywords: List of keyword data
            
        Returns:
            Formatted message string
        """
        if not keywords:
            return "🏷 *Keyword Analysis Complete*\n\nNo trending keywords found."
        
        lines = [
            "🏷 *TRENDING KEYWORDS*",
            f"_Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}_",
            "",
            ""
        ]
        
        for i, kw in enumerate(keywords[:10], 1):
            avg_eng = kw.get('avg_engagement', 0)
            count = kw.get('count', 0)
            
            lines.append(
                f"{i}. *{kw['keyword'].title()}* "
                f"(🔥 {avg_eng:.0f} avg, 📊 {count}x)"
            )
        
        lines.append("")
        lines.append("💡 *TIP*")
        lines.append("Combine multiple trending keywords in your content")
        
        return "\n".join(lines)
    
    def _generate_insights(self, trends: List[Dict[str, Any]]) -> List[str]:
        """Generate actionable insights from trends"""
        insights = []
        
        if not trends:
            return ["No trends to analyze"]
        
        # Analyze categories
        categories = {}
        for trend in trends:
            cat = trend.get('content_category', 'general')
            categories[cat] = categories.get(cat, 0) + 1
        
        top_category = max(categories.items(), key=lambda x: x[1])
        insights.append(f"*{top_category[0].title()}* content trending - consider focusing here")
        
        # Analyze hook patterns
        patterns = [t.get('hook_pattern') for t in trends if t.get('hook_pattern')]
        if patterns:
            common_pattern = max(set(patterns), key=patterns.count)
            insights.append(f"`{common_pattern}` hook performing well - replicate this style")
        
        # High virality trends
        high_viral = [t for t in trends if t.get('virality') == 'high']
        if high_viral:
            insights.append(f"*{len(high_viral)}* high-virality trends found - prioritize these")
        
        # Engagement insights
        avg_engagement = sum(t.get('engagement', 0) for t in trends) / len(trends)
        insights.append(f"Average engagement: *{avg_engagement:.0f}* - aim above this")
        
        # Timing insight
        insights.append("Post during peak hours for maximum reach")
        
        return insights[:5]  # Limit to 5 insights
    
    async def send_message(
        self,
        chat_id: Optional[str],
        text: str,
        parse_mode: str = "Markdown"
    ) -> Dict[str, Any]:
        """
        Send message to Telegram
        
        Args:
            chat_id: Target chat ID (uses default if not provided)
            text: Message text
            parse_mode: Parse mode (Markdown, HTML)
            
        Returns:
            API response
        """
        import aiohttp
        
        target_chat = chat_id or self.default_chat_id
        if not target_chat:
            raise ValueError("No chat ID provided and no default configured")
        
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                json={
                    "chat_id": target_chat,
                    "text": text,
                    "parse_mode": parse_mode,
                    "disable_web_page_preview": False
                }
            ) as response:
                result = await response.json()
                
                if not result.get("ok"):
                    raise Exception(f"Telegram API error: {result.get('description', 'Unknown error')}")
                
                return result
    
    def send_trends(
        self,
        trends: List[Dict[str, Any]],
        chat_id: Optional[str] = None,
        analysis_type: str = "buffer"
    ) -> Dict[str, Any]:
        """
        Format and send trend analysis to Telegram
        
        Args:
            trends: List of trend data
            chat_id: Target chat ID
            analysis_type: Source type
            
        Returns:
            API response
        """
        message = self.format_trend_report(trends, analysis_type)
        
        # Split long messages (Telegram limit: 4096 chars)
        if len(message) > 4000:
            # Split into parts
            parts = self._split_message(message)
            results = []
            
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            for part in parts:
                result = loop.run_until_complete(self.send_message(chat_id, part))
                results.append(result)
            
            loop.close()
            return {"ok": True, "results": results}
        else:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(self.send_message(chat_id, message))
            loop.close()
            return result
    
    def send_patterns(
        self,
        patterns: List[Dict[str, Any]],
        chat_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Format and send hook pattern analysis to Telegram
        
        Args:
            patterns: List of hook patterns
            chat_id: Target chat ID
            
        Returns:
            API response
        """
        message = self.format_hook_analysis(patterns)
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(self.send_message(chat_id, message))
        loop.close()
        return result
    
    def send_keywords(
        self,
        keywords: List[Dict[str, Any]],
        chat_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Format and send trending keywords to Telegram
        
        Args:
            keywords: List of keyword data
            chat_id: Target chat ID
            
        Returns:
            API response
        """
        message = self.format_keyword_trends(keywords)
        
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(self.send_message(chat_id, message))
        loop.close()
        return result
    
    def _split_message(self, message: str, max_length: int = 4000) -> List[str]:
        """Split long message into parts"""
        if len(message) <= max_length:
            return [message]
        
        parts = []
        current_part = ""
        
        for line in message.split('\n'):
            if len(current_part) + len(line) + 1 > max_length:
                parts.append(current_part)
                current_part = line + '\n'
            else:
                current_part += line + '\n'
        
        if current_part:
            parts.append(current_part)
        
        return parts


def main():
    """CLI interface"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Telegram Trend Delivery")
    subparsers = parser.add_subparsers(dest="command", help="Command")
    
    # Command: send
    send_parser = subparsers.add_parser("send", help="Send trend analysis to Telegram")
    send_parser.add_argument("--trends-file", required=True, help="JSON file with trends")
    send_parser.add_argument("--chat-id", help="Target chat ID (uses default if not provided)")
    send_parser.add_argument("--type", default="buffer", help="Analysis type")
    
    # Command: send-patterns
    patterns_parser = subparsers.add_parser("send-patterns", help="Send hook patterns to Telegram")
    patterns_parser.add_argument("--patterns-file", required=True, help="JSON file with patterns")
    patterns_parser.add_argument("--chat-id", help="Target chat ID")
    
    # Command: send-keywords
    keywords_parser = subparsers.add_parser("send-keywords", help="Send trending keywords to Telegram")
    keywords_parser.add_argument("--keywords-file", required=True, help="JSON file with keywords")
    keywords_parser.add_argument("--chat-id", help="Target chat ID")
    
    # Command: format
    format_parser = subparsers.add_parser("format", help="Format trends without sending")
    format_parser.add_argument("--trends-file", required=True, help="JSON file with trends")
    format_parser.add_argument("--type", default="buffer", help="Analysis type")
    format_parser.add_argument("--output", help="Save formatted message to file")
    
    args = parser.parse_args()
    
    try:
        delivery = TelegramTrendDelivery()
        
        if args.command == "send":
            with open(args.trends_file, 'r') as f:
                trends = json.load(f)
            
            result = delivery.send_trends(trends, args.chat_id, args.type)
            print("✅ Trends sent to Telegram")
            print(f"Message ID: {result.get('result', {}).get('message_id', 'N/A')}")
        
        elif args.command == "send-patterns":
            with open(args.patterns_file, 'r') as f:
                patterns = json.load(f)
            
            result = delivery.send_patterns(patterns, args.chat_id)
            print("✅ Patterns sent to Telegram")
        
        elif args.command == "send-keywords":
            with open(args.keywords_file, 'r') as f:
                keywords = json.load(f)
            
            result = delivery.send_keywords(keywords, args.chat_id)
            print("✅ Keywords sent to Telegram")
        
        elif args.command == "format":
            with open(args.trends_file, 'r') as f:
                trends = json.load(f)
            
            message = delivery.format_trend_report(trends, args.type)
            
            if args.output:
                with open(args.output, 'w') as f:
                    f.write(message)
                print(f"✅ Formatted message saved to {args.output}")
            else:
                print(message)
        
        else:
            parser.print_help()
    
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
