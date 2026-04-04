#!/usr/bin/env python3
"""
Publish HTML pages to here.now - instant web hosting service
"""

import os
import sys
import json
import hashlib
import argparse
import requests
from pathlib import Path
from datetime import datetime


def get_api_key():
    """Get API key from various sources"""
    # Check environment variable
    api_key = os.environ.get('HERENOW_API_KEY')
    if api_key:
        return api_key
    
    # Check credentials file
    cred_file = Path.home() / '.herenow' / 'credentials'
    if cred_file.exists():
        return cred_file.read_text().strip()
    
    return None


def create_html_page(content: str, title: str = "Report", style: str = "default") -> str:
    """Create a complete HTML page with styling"""
    
    styles = {
        "default": """
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #333; }
            h1, h2, h3 { color: #2c3e50; margin-top: 24px; }
            table { border-collapse: collapse; width: 100%; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #3498db; color: white; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            img { max-width: 100%; height: auto; margin: 20px 0; border-radius: 8px; }
            code { background-color: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
            pre { background-color: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
            blockquote { border-left: 4px solid #3498db; margin: 20px 0; padding-left: 16px; color: #666; }
            .timestamp { color: #999; font-size: 0.9em; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; }
        """,
        "dark": """
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #e0e0e0; background-color: #1e1e1e; }
            h1, h2, h3 { color: #61dafb; margin-top: 24px; }
            table { border-collapse: collapse; width: 100%; margin: 20px 0; }
            th, td { border: 1px solid #444; padding: 12px; text-align: left; }
            th { background-color: #2d2d2d; color: #61dafb; }
            tr:nth-child(even) { background-color: #252525; }
            img { max-width: 100%; height: auto; margin: 20px 0; border-radius: 8px; }
            code { background-color: #2d2d2d; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; color: #f8f8f2; }
            pre { background-color: #2d2d2d; padding: 16px; border-radius: 8px; overflow-x: auto; }
            blockquote { border-left: 4px solid #61dafb; margin: 20px 0; padding-left: 16px; color: #999; }
            .timestamp { color: #666; font-size: 0.9em; margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; }
        """,
        "report": """
            body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 40px 20px; line-height: 1.8; color: #2c3e50; background: #fff; }
            h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
            h2 { color: #34495e; margin-top: 32px; border-left: 4px solid #3498db; padding-left: 12px; }
            h3 { color: #7f8c8d; }
            table { border-collapse: collapse; width: 100%; margin: 24px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            th, td { border: 1px solid #ddd; padding: 14px 16px; text-align: left; }
            th { background-color: #3498db; color: white; font-weight: 600; }
            tr:hover { background-color: #f5f5f5; }
            img { max-width: 100%; height: auto; margin: 24px 0; box-shadow: 0 4px 8px rgba(0,0,0,0.1); border-radius: 4px; }
            .metric { display: inline-block; background: #ecf0f1; padding: 12px 20px; margin: 8px; border-radius: 8px; }
            .metric-value { font-size: 2em; font-weight: bold; color: #3498db; }
            .metric-label { font-size: 0.9em; color: #7f8c8d; margin-top: 4px; }
            .timestamp { color: #95a5a6; font-size: 0.9em; margin-top: 40px; padding-top: 20px; border-top: 2px solid #ecf0f1; }
        """
    }
    
    css = styles.get(style, styles["default"])
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>{css}</style>
</head>
<body>
{content}
<div class="timestamp">Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')} via here.now</div>
</body>
</html>"""
    
    return html


def compute_hash(content: bytes) -> str:
    """Compute SHA-256 hash"""
    return hashlib.sha256(content).hexdigest()


def publish_to_herenow(html_content: str, title: str = "Report", api_key: str = None) -> dict:
    """Publish HTML to here.now and return URL info"""
    
    # Prepare file
    html_bytes = html_content.encode('utf-8')
    file_hash = compute_hash(html_bytes)
    
    # Step 1: Create site
    headers = {
        'Content-Type': 'application/json',
        'X-HereNow-Client': 'openclaw/herenow-skill'
    }
    
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    
    create_payload = {
        'files': [{
            'path': 'index.html',
            'size': len(html_bytes),
            'contentType': 'text/html; charset=utf-8',
            'hash': file_hash
        }],
        'viewer': {
            'title': title,
            'description': 'Published by OpenClaw agent'
        }
    }
    
    # Create site
    resp = requests.post(
        'https://here.now/api/v1/publish',
        headers=headers,
        json=create_payload
    )
    
    if resp.status_code != 200:
        raise Exception(f"Failed to create site: {resp.status_code} - {resp.text}")
    
    create_data = resp.json()
    slug = create_data['slug']
    site_url = create_data['siteUrl']
    upload_info = create_data['upload']
    
    # Step 2: Upload file
    upload_data = upload_info['uploads'][0]
    upload_url = upload_data['url']
    
    upload_resp = requests.put(
        upload_url,
        headers={'Content-Type': 'text/html; charset=utf-8'},
        data=html_bytes
    )
    
    if upload_resp.status_code not in [200, 204]:
        raise Exception(f"Failed to upload file: {upload_resp.status_code}")
    
    # Step 3: Finalize
    finalize_resp = requests.post(
        upload_info['finalizeUrl'],
        headers=headers,
        json={'versionId': upload_info['versionId']}
    )
    
    if finalize_resp.status_code != 200:
        raise Exception(f"Failed to finalize: {finalize_resp.status_code}")
    
    result = {
        'slug': slug,
        'siteUrl': site_url,
        'size_bytes': len(html_bytes),
        'authenticated': api_key is not None
    }
    
    # Anonymous sites get claim info
    if 'claimUrl' in create_data:
        result['claimUrl'] = create_data['claimUrl']
        result['claimToken'] = create_data.get('claimToken')
        result['expiresAt'] = create_data.get('expiresAt')
        result['warning'] = "Anonymous site expires in 24 hours. Share claimUrl to make it permanent."
    
    return result


def main():
    parser = argparse.ArgumentParser(description="Publish HTML pages to here.now")
    parser.add_argument("--content", help="HTML content (or use --file)")
    parser.add_argument("--file", help="Read content from file")
    parser.add_argument("--title", default="Report", help="Page title")
    parser.add_argument("--style", choices=["default", "dark", "report"], default="default", help="Page style")
    parser.add_argument("--api-key", help="API key (or use HERENOW_API_KEY env or ~/.herenow/credentials)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    
    args = parser.parse_args()
    
    # Get API key
    api_key = args.api_key or get_api_key()
    
    # Get content
    if args.file:
        content = Path(args.file).read_text()
    elif args.content:
        content = args.content
    else:
        # Read from stdin
        content = sys.stdin.read()
    
    # Generate HTML
    html = create_html_page(content, args.title, args.style)
    
    try:
        # Publish to here.now
        result = publish_to_herenow(html, args.title, api_key)
        
        # Output
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"✅ Published to here.now!")
            print(f"🌐 URL: {result['siteUrl']}")
            print(f"📦 Size: {result['size_bytes']} bytes")
            
            if 'claimUrl' in result:
                print(f"\n⚠️  {result['warning']}")
                print(f"🔗 Claim URL: {result['claimUrl']}")
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
