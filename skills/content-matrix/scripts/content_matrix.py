#!/usr/bin/env python3
"""
Content Matrix v3.0 - CLI Principal

Interface principal para o sistema de geração de conteúdo OPEX.

Uso:
    # Gerar conteúdo a partir de tema manual
    python content_matrix.py generate --titulo "Portaria DUIMP 30 dias"

    # Monitorar fontes e gerar conteúdo
    python content_matrix.py monitor --source all

    # Mostrar fila de conteúdo
    python content_matrix.py queue

    # Exportar para Buffer (JSON)
    python content_matrix.py export --buffer

    # Exportar formato Telegram para revisão manual
    python content_matrix.py export --telegram
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Any


def get_skills_path():
    """Get skills path from environment or default location"""
    # First check environment variable
    env_path = os.environ.get('CONTENT_MATRIX_SKILLS_PATH')
    if env_path:
        return Path(env_path)
    
    # Check for workspace environment variable
    workspace = os.environ.get('OPENCLAW_WORKSPACE')
    if workspace:
        return Path(workspace) / 'skills' / 'public'
    
    # Default to standard location relative to this script
    # This script is in skills/content-matrix/scripts/
    # So skills/public is ../../
    script_dir = Path(__file__).parent
    return script_dir.parent.parent


def get_state_path():
    """Get state storage path"""
    # Use workspace if available
    workspace = os.environ.get('OPENCLAW_WORKSPACE')
    if workspace:
        state_path = Path(workspace) / '.openclaw' / 'content-matrix'
    else:
        # Fallback to home directory
        state_path = Path.home() / '.openclaw' / 'content-matrix'
    
    # Ensure directory exists
    state_path.mkdir(parents=True, exist_ok=True)
    return state_path


# Add skills to path
SKILLS_PATH = get_skills_path()
sys.path.insert(0, str(SKILLS_PATH / "content-classifier" / "scripts"))
sys.path.insert(0, str(SKILLS_PATH / "ghostwriter-v3" / "scripts"))
sys.path.insert(0, str(SKILLS_PATH / "content-builder" / "scripts"))
sys.path.insert(0, str(SKILLS_PATH / "seo-analyzer" / "scripts"))
sys.path.insert(0, str(SKILLS_PATH / "designer" / "scripts"))
sys.path.insert(0, str(SKILLS_PATH / "trend-detector" / "scripts"))

from content_classifier import ContentClassifier
from ghostwriter_v3 import GhostwriterV3
from content_builder import ContentBuilder, Priority, ContentType

# Try to import optional components
try:
    from designer import Designer
    HAS_DESIGNER = True
except ImportError:
    HAS_DESIGNER = False

try:
    from seo_analyzer import SEOAnalyzer
    HAS_SEO = True
except ImportError:
    HAS_SEO = False

try:
    from trend_detector import TrendDetector
    HAS_TREND_DETECTOR = True
except ImportError:
    HAS_TREND_DETECTOR = False


class ContentMatrix:
    """Sistema completo de geração de conteúdo OPEX"""

    def __init__(self):
        """Initialize Content Matrix"""
        self.classifier = ContentClassifier()
        self.ghostwriter = GhostwriterV3()
        self.state_path = get_state_path()

        # Inicializar Designer se disponível
        designer = Designer() if HAS_DESIGNER else None

        # Inicializar SEO Analyzer se disponível
        seo_analyzer = SEOAnalyzer() if HAS_SEO else None

        self.builder = ContentBuilder(
            ghostwriter=self.ghostwriter,
            designer=designer,
            seo_analyzer=seo_analyzer
        )

    def generate_from_input(
        self,
        titulo: str,
        conteudo: str = "",
        fonte: str = "",
        dados: Dict = None
    ) -> Dict[str, Any]:
        """
        Gera conteúdo completo a partir de input manual

        Args:
            titulo: Título do tema
            conteudo: Conteúdo opcional
            fonte: Fonte do tema
            dados: Dados adicionais

        Returns:
            ContentPackage completo
        """
        # Criar tema
        theme_input = {
            "titulo": titulo,
            "conteudo": conteudo,
            "fonte": fonte,
            "dados": dados or {}
        }

        # Classificar
        classified = self.classifier.classify(theme_input)

        # Build completo
        package = self.builder.build_from_theme(classified)

        return package

    def monitor_and_generate(
        self,
        source: str = "all",
        hours: int = 24
    ) -> List[Dict[str, Any]]:
        """
        Monitora fontes e gera conteúdo

        Args:
            source: Fonte a monitorar (dou, google, all)
            hours: Horas para buscar

        Returns:
            Lista de ContentPackages
        """
        # Importar monitores
        sys.path.insert(0, str(SKILLS_PATH / "news-monitor" / "scripts"))
        sys.path.insert(0, str(SKILLS_PATH / "email-alerts-reader" / "scripts"))

        try:
            from news_monitor import NewsMonitor
            from email_alerts_reader import EmailAlertsReader
        except ImportError:
            print("Monitores não disponíveis")
            return []

        themes = []

        # News Monitor
        if source in ["all", "dou", "gov"]:
            monitor = NewsMonitor()
            themes.extend(monitor.check_all_sources(hours))

        # Email Alerts
        if source in ["all", "google", "alerts"]:
            reader = EmailAlertsReader()
            themes.extend(reader.read_all_alerts(hours))

        # Classificar tudo
        classified_themes = self.classifier.classify_batch(themes)

        # Build tudo
        packages = self.builder.build_batch(classified_themes)

        return packages

    def get_queue(self) -> List[Dict]:
        """Retorna fila de conteúdo atual"""
        queue = self.builder.get_queue()

        return [
            {
                "content_code": p.content_code,
                "priority": p.priority.value,
                "type": p.content_type.value,
                "framework": p.framework,
                "channel": p.channel,
                "hook": p.hook,
                "seo_score": p.seo_score,
                "images_count": len(p.images)
            }
            for p in queue
        ]

    def export_to_buffer(self, output_file: str = None) -> List[Dict]:
        """
        Exporta pacotes prontos para Buffer em formato JSON

        Args:
            output_file: Arquivo para salvar JSON

        Returns:
            Lista de pacotes em formato Buffer
        """
        buffer_packages = self.builder.get_buffer_ready_packages()

        # If no output file specified, use state path
        if not output_file:
            output_file = str(self.state_path / 'buffer_export.json')

        if output_file:
            with open(output_file, 'w') as f:
                json.dump(buffer_packages, f, indent=2, ensure_ascii=False)
            print(f"✅ Exportados {len(buffer_packages)} pacotes para {output_file}")

        return buffer_packages

    def format_for_telegram(self, package: Dict) -> str:
        """
        Formata pacote de conteúdo para entrega via Telegram

        Args:
            package: Pacote de conteúdo em formato Buffer

        Returns:
            String formatada para Telegram
        """
        metadata = package.get("metadata", {})
        service = package.get("service", "unknown")

        # Platform mapping
        platform_emoji = {
            "instagram": "📸",
            "linkedin": "💼",
            "twitter": "🐦",
            "threads": "🧵"
        }
        platform_icon = platform_emoji.get(service.lower(), "📱")

        # Build Telegram message
        lines = []
        lines.append(f"{platform_icon} **{service.upper()}**")
        lines.append(f"📋 `{metadata.get('content_code', 'N/A')}`")
        lines.append("")

        # Post text (ready for copy/paste)
        lines.append("📝 **Post Text:**")
        lines.append("```")
        lines.append(package.get("text", ""))
        lines.append("```")
        lines.append("")

        # Hashtags
        if package.get("hashtags"):
            lines.append("🏷️ **Hashtags:**")
            lines.append(" ".join(package["hashtags"]))
            lines.append("")

        # Media info
        media = package.get("media", [])
        if media:
            lines.append(f"🖼️ **Media:** {len(media)} file(s)")
            for i, m in enumerate(media, 1):
                if isinstance(m, dict):
                    lines.append(f"  {i}. {m.get('description', 'Image')}")
                else:
                    lines.append(f"  {i}. Image")
            lines.append("")

        # Scheduling suggestion
        lines.append("⏰ **Suggested Posting Time:**")
        if package.get("scheduled_at"):
            lines.append(f"  {package['scheduled_at']}")
        else:
            lines.append("  Manually schedule based on platform analytics")
        lines.append("")

        # Metadata
        lines.append("📊 **Content Metadata:**")
        lines.append(f"  • Framework: {metadata.get('framework', 'N/A')}")
        lines.append(f"  • Priority: {metadata.get('priority', 'N/A')}")
        lines.append(f"  • SEO Score: {metadata.get('seo_score', 'N/A')}/100")
        lines.append(f"  • Content Type: {metadata.get('content_type', 'N/A')}")
        lines.append("")

        # Instructions
        lines.append("─" * 40)
        lines.append("✅ Copy text above and post manually to " + service)
        lines.append("📎 Attach media files before publishing")

        return "\n".join(lines)

    def export_to_telegram(self, limit: int = None) -> List[str]:
        """
        Exporta pacotes prontos em formato Telegram para revisão manual

        Args:
            limit: Limite de pacotes a exportar

        Returns:
            Lista de mensagens formatadas para Telegram
        """
        buffer_packages = self.builder.get_buffer_ready_packages()

        if limit:
            buffer_packages = buffer_packages[:limit]

        telegram_messages = []
        for pkg in buffer_packages:
            telegram_messages.append(self.format_for_telegram(pkg))

        # Save to file for reference
        output_file = self.state_path / 'telegram_export.txt'
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("\n\n".join(telegram_messages))

        print(f"✅ {len(telegram_messages)} pacotes formatados para Telegram")
        print(f"📄 Salvo em: {output_file}")

        return telegram_messages

    def get_status(self) -> Dict[str, Any]:
        """Retorna status completo do sistema"""
        queue = self.builder.get_queue()
        balance = self.builder.get_balance_report()

        return {
            "queue_size": len(queue),
            "balance": balance,
            "ready_for_export": len(self.builder.get_buffer_ready_packages()),
            "components": {
                "classifier": "✅",
                "ghostwriter": "✅",
                "builder": "✅",
                "seo_analyzer": "✅" if HAS_SEO else "⚠️ (opcional)",
                "designer": "✅" if HAS_DESIGNER else "⚠️ (opcional)",
                "trend_detector": "✅" if HAS_TREND_DETECTOR else "⚠️ (opcional)"
            },
            "state_path": str(self.state_path),
            "skills_path": str(SKILLS_PATH)
        }


def print_package(package: Dict, verbose: bool = False):
    """Imprime pacote de forma formatada"""
    print(f"📦 {package['content_code']}")
    priority = package['priority'].value if hasattr(package['priority'], 'value') else package['priority']
    print(f"   [{priority.upper()}] {package['framework']} → {package['channel']}")
    print(f"   SEO: {package['seo_score']}/100 | Images: {package['images_count']}")

    if verbose:
        print(f"   Hook: {package['hook'][:60]}...")


def main():
    parser = argparse.ArgumentParser(
        description="Content Matrix v3.0 - Sistema de Geração de Conteúdo OPEX",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  # Gerar conteúdo manual
  python content_matrix.py generate --titulo "Portaria DUIMP 30 dias"

  # Monitorar fontes
  python content_matrix.py monitor --source all --hours 24

  # Ver fila
  python content_matrix.py queue

  # Exportar para Buffer (JSON)
  python content_matrix.py export --buffer

  # Exportar para revisão via Telegram
  python content_matrix.py export --telegram --limit 5

  # Status do sistema
  python content_matrix.py status

Environment Variables:
  CONTENT_MATRIX_SKILLS_PATH  Override skills location
  OPENCLAW_WORKSPACE          Workspace directory (for state storage)

Workflow de Publicação:
  1. Gerar conteúdo: python content_matrix.py generate --titulo "Tema"
  2. Revisar fila: python content_matrix.py queue
  3. Exportar para revisão: python content_matrix.py export --telegram
  4. Revisar conteúdo no Telegram
  5. Publicar manualmente nas plataformas (Instagram, LinkedIn, etc.)
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Comando a executar")

    # Comando: generate
    parser_generate = subparsers.add_parser("generate", help="Gerar conteúdo manual")
    parser_generate.add_argument("--titulo", required=True, help="Título do tema")
    parser_generate.add_argument("--conteudo", help="Conteúdo do tema")
    parser_generate.add_argument("--fonte", default="manual", help="Fonte do tema")
    parser_generate.add_argument("--verbose", "-v", action="store_true", help="Output detalhado")

    # Comando: monitor
    parser_monitor = subparsers.add_parser("monitor", help="Monitorar fontes e gerar conteúdo")
    parser_monitor.add_argument("--source", choices=["all", "dou", "google"], default="all", help="Fonte a monitorar")
    parser_monitor.add_argument("--hours", type=int, default=24, help="Horas para buscar")
    parser_monitor.add_argument("--export", help="Exportar para arquivo JSON")

    # Comando: queue
    parser_queue = subparsers.add_parser("queue", help="Mostrar fila de conteúdo")
    parser_queue.add_argument("--verbose", "-v", action="store_true", help="Mostrar detalhes")

    # Comando: export
    parser_export = subparsers.add_parser("export", help="Exportar conteúdo")
    parser_export.add_argument("--buffer", action="store_true", help="Exportar no formato Buffer (JSON)")
    parser_export.add_argument("--telegram", action="store_true", help="Exportar formato Telegram para revisão manual")
    parser_export.add_argument("--output", help="Arquivo de saída")
    parser_export.add_argument("--limit", type=int, help="Limite de pacotes a exportar (Telegram)")

    # Comando: detect-trends
    parser_trends = subparsers.add_parser("detect-trends", help="Detectar tendências virais")
    parser_trends.add_argument("--source", choices=["x", "linkedin", "buffer", "perplexity", "all"], default="buffer", help="Fonte das tendências")
    parser_trends.add_argument("--hours", type=int, default=24, help="Horas para buscar (x/linkedin)")
    parser_trends.add_argument("--days", type=int, default=30, help="Dias para buscar (buffer)")
    parser_trends.add_argument("--suggest", action="store_true", help="Gerar conteúdo a partir de tendências")
    parser_trends.add_argument("--limit", type=int, default=3, help="Limite de temas para gerar")

    # Comando: status
    parser_status = subparsers.add_parser("status", help="Status do sistema")

    args = parser.parse_args()

    # Executar comando
    matrix = ContentMatrix()

    if args.command == "generate":
        print("🎯 Gerando conteúdo manual...")
        print()

        package = matrix.generate_from_input(
            titulo=args.titulo,
            conteudo=args.conteudo or "",
            fonte=args.fonte
        )

        print_package({
            "content_code": package.content_code,
            "priority": package.priority,
            "content_type": package.content_type,
            "framework": package.framework,
            "channel": package.channel,
            "hook": package.hook,
            "seo_score": package.seo_score,
            "images_count": len(package.images)
        }, verbose=args.verbose)

        if args.verbose:
            print()
            print("DETALHES:")
            print(f"Body: {package.body[:200]}...")
            print(f"CTA: {package.cta}")
            print(f"Hashtags: {' '.join(package.hashtags)}")

    elif args.command == "monitor":
        print(f"🔍 Monitorando fontes: {args.source} ({args.hours}h)")
        print()

        packages = matrix.monitor_and_generate(args.source, args.hours)

        print(f"✅ {len(packages)} pacotes gerados")
        print("-" * 60)

        for pkg in packages:
            print_package({
                "content_code": pkg.content_code,
                "priority": pkg.priority,
                "content_type": pkg.content_type,
                "framework": pkg.framework,
                "channel": pkg.channel,
                "hook": pkg.hook,
                "seo_score": pkg.seo_score,
                "images_count": len(pkg.images)
            })

        if args.export:
            matrix.export_to_buffer(args.export)

    elif args.command == "queue":
        queue = matrix.get_queue()

        print(f"📦 Fila: {len(queue)} pacotes")
        print("-" * 60)

        for pkg in queue:
            print_package(pkg, verbose=args.verbose)

    elif args.command == "export":
        if args.buffer:
            print("📤 Exportando para formato Buffer (JSON)...")
            buffer_packages = matrix.export_to_buffer(args.output)
            print()
            print(f"{len(buffer_packages)} pacotes prontos:")
            for i, pkg in enumerate(buffer_packages[:3], 1):
                print(f"  {i}. {pkg['metadata']['content_code']}")
                print(f"     Service: {pkg['service']} | Text: {len(pkg['text'])} chars | Media: {len(pkg['media'])} files")

        elif args.telegram:
            print("📱 Exportando formato Telegram para revisão manual...")
            print()
            messages = matrix.export_to_telegram(args.limit)
            print()
            print("─" * 60)
            print("Preview (primeiro pacote):")
            print("─" * 60)
            if messages:
                print(messages[0])
            print("─" * 60)
            print()
            print(f"💡 Dica: Use 'matrix.export_to_telegram()' para enviar via Telegram skill")

    elif args.command == "detect-trends":
        if not HAS_TREND_DETECTOR:
            print("⚠️  Trend Detector não disponível")
            exit(1)

        detector = TrendDetector()

        if args.suggest:
            # Detectar tendências e gerar conteúdo
            print("🔍 Detectando tendências e gerando conteúdo...")
            print()

            themes = detector.suggest_themes(args.source, args.limit)

            print(f"💡 {len(themes)} temas encontrados")
            print("-" * 60)

            for i, theme in enumerate(themes, 1):
                print(f"{i}. {theme['titulo']}")
                print(f"   Framework sugerido: {theme['dados']['suggested_framework']}")

                # Gerar conteúdo
                package = matrix.generate_from_input(
                    titulo=theme['titulo'],
                    conteudo=theme['conteudo'],
                    fonte=theme['fonte'],
                    dados=theme['dados']
                )

                print_package({
                    "content_code": package.content_code,
                    "priority": package.priority,
                    "content_type": package.content_type,
                    "framework": package.framework,
                    "channel": package.channel,
                    "hook": package.hook,
                    "seo_score": package.seo_score,
                    "images_count": len(package.images)
                })
                print()
        else:
            # Apenas detectar tendências
            trends = detector.detect_trends(args.source, args.hours, days=args.days)

            print()
            print(f"📊 {len(trends)} tendências encontradas")
            print("-" * 60)

            for i, trend in enumerate(trends[:10], 1):
                emoji = "🔥" if trend.virality == "high" else "📈" if trend.virality == "medium" else "📉"
                print(f"{emoji} [{i}] {trend.source.upper()}")
                print(f"   Text: {trend.text[:80]}...")
                print(f"   Engagement: {trend.engagement:,}")
                print()

    elif args.command == "status":
            status = matrix.get_status()

            print("📊 Content Matrix v3.0 - Status")
            print("=" * 60)
            print()
            print("Componentes:")
            for comp, st in status["components"].items():
                print(f"  {comp}: {st}")
            print()
            print(f"Fila: {status['queue_size']} pacotes")
            print(f"Prontos para exportar: {status['ready_for_export']}")
            print()
            print("Balanceamento:")
            balance = status["balance"]
            print(f"  Total: {balance['total']}")
            print(f"  Status: {balance['balance']}")
            for ctype, data in balance["by_type"].items():
                if data["count"] > 0:
                    print(f"  {ctype}: {data['count']} ({data['percentage']:.1f}%)")
            print()
            print("Paths:")
            print(f"  Skills: {status['skills_path']}")
            print(f"  State: {status['state_path']}")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
