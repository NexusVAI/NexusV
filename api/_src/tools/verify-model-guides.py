"""Browser regression for the API home and imported guides. Never sends a real API request.

Run from GitHub/: python -I api/_src/tools/verify-model-guides.py [--screenshots DIR]
Requires Python Playwright and local Edge.
"""
import argparse
import json
from functools import lru_cache, partial
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import unquote, urlsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parents[3]
GUIDES = '/api/docs/guides/'
BOOK = json.loads((ROOT / 'api/_src/model-guides.json').read_text(encoding='utf-8'))
SLUGS = [item[-1] if len(item) == 3 else item[0] for group in BOOK for item in group['items']]
CATALOG = {
    'https://chat.nexusvai.xyz/functions/v1/chat-gateway',
    'https://cn.nexusvai.xyz/functions/v1/chat-gateway',
}


class QuietServer(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class Ids(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = set()

    def handle_starttag(self, _, attrs):
        self.values.update(value for name, value in attrs if name == 'id')


@lru_cache(maxsize=None)
def site_ids(path):
    document = ROOT / unquote(path).lstrip('/')
    if document.is_dir():
        document /= 'index.html'
    if not document.is_file():
        return None
    ids = Ids()
    if document.suffix == '.html':
        ids.feed(document.read_text(encoding='utf-8'))
    return ids.values


def documents(context, base, screenshots):
    unexpected_requests = set()

    def route_request(route):
        url = route.request.url
        if url.startswith(base + '/'):
            route.continue_()
        elif url in CATALOG:
            route.fulfill(json={'models': []}, headers={'access-control-allow-origin': '*'})
        else:
            unexpected_requests.add(url)
            route.fulfill(status=204)

    context.route('**/*', route_request)
    page = context.new_page()
    page.set_default_timeout(5000)
    errors = []
    requests = []
    page.on('request', lambda request: requests.append(request.url))
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.on('response', lambda response: errors.append(f'{response.status} {response.url}')
            if response.url.startswith(base + '/') and response.status >= 400 else None)

    def visit(path):
        response = page.goto(base + path, wait_until='networkidle', timeout=20000)
        assert response and response.status == 200, path
        assert page.locator('h1').first.is_visible() or path == '/api/', path
        return page.locator('#main' if path == '/api/' else '#mainContent')

    def snapshot(name):
        if screenshots:
            page.screenshot(path=screenshots / (name + '.png'))

    def bad_links(article):
        attrs = article.evaluate('''node => [...node.querySelectorAll('a[href], [src], [poster], [srcset]')]
          .flatMap(el => ['href', 'src', 'poster', 'srcset'].flatMap(attr => {
            const value = el.getAttribute(attr);
            if (!value) return [];
            return (attr === 'srcset' ? value.split(',').map(s => s.trim().split(/\\s+/)[0]) : [value])
              .map(url => new URL(url, document.baseURI).href);
          }))''')
        return sorted(set(url for url in attrs if not url.startswith((base + '/', 'data:', 'blob:'))))

    home = visit('/api/')
    snapshot('home')
    assert 'NexusVAI API' in home.text_content()
    assert not bad_links(home), bad_links(home)
    assert not errors, '\n'.join(errors)
    path = GUIDES + 'text/'
    article = visit(path)
    snapshot('text')
    intro = article.locator('p').first.inner_text()
    assert 'NexusVAI API' in intro and 'ChatGPT' not in intro, intro
    meta = page.locator('meta[name="description"]').get_attribute('content')
    assert 'NexusVAI API' in meta, meta
    link = article.get_by_role('link', name='Responses API', exact=True).first
    assert link.get_attribute('href') == '/api/reference/responses/'
    link.click()
    page.wait_for_url(base + '/api/reference/responses/')
    assert page.get_by_role('heading', name='创建响应', exact=True).is_visible()
    page.go_back(wait_until='networkidle')
    sample = page.locator('#mainContent [data-code-sample]').first
    language = sample.get_by_role('combobox', name='选择代码语言')
    language.select_option(label='Node.js')
    code = sample.locator('[data-code-pane]:not(.hidden) code').inner_text()
    assert 'process.env.CANCRI_API_KEY' in code and 'https://cn.nexusvai.xyz/v1' in code, code
    language.select_option(label='Python')
    code = sample.locator('[data-code-pane]:not(.hidden) code').inner_text()
    assert 'from openai import OpenAI' in code and 'https://cn.nexusvai.xyz/v1' in code, code
    language.select_option(label='cURL')
    sample.get_by_role('button', name='复制代码').click()
    copied = page.evaluate('navigator.clipboard.readText()')
    assert 'https://cn.nexusvai.xyz/v1/responses' in copied and '$CANCRI_API_KEY' in copied, copied
    assert 'api.openai.com' not in copied, copied
    print('OK: home, text branding, Responses navigation, SDK selector and actual clipboard')

    issues = []
    for slug in SLUGS:
        path = f'{GUIDES}{slug}/'
        article = visit(path)
        before = len(issues)
        external = bad_links(article)
        if external:
            issues.append(f'{slug}: {len(external)} external destinations: {external[:3]}')
        code = ' '.join(article.locator('pre, [data-guide-copy]').all_text_contents())
        for forbidden in ('api.openai.com', 'OPENAI_API_KEY', 'openai-documentation.vercel.app'):
            if forbidden in code:
                issues.append(f'{slug}: example still uses {forbidden}')
        for url in set(article.locator('a[href^="/"], a[href^="#"]').evaluate_all('xs => xs.map(a => a.href)')):
            dest = urlsplit(url)
            if dest.netloc != urlsplit(base).netloc or not dest.path.startswith('/api/'):
                continue
            ids = site_ids(dest.path)
            if ids is None or (dest.fragment and unquote(dest.fragment) not in ids):
                issues.append(f'{slug}: broken local link {dest.path}#{dest.fragment}')
        if len(issues) == before:
            print(f'OK: {slug}')
    assert not issues, '\n'.join(issues)

    for slug, widget, entry in [
        ('code-generation', 'CodeGallery', 'CodeGallery.react.5W_qk2nf.js'),
        ('image-generation', 'ImageGallery', 'ImageGallery.react.B9yz12N0.js'),
    ]:
        requests.clear()
        article = visit(GUIDES + slug + '/')
        boot = page.locator('script[src*="/widgets/boot.js"]').get_attribute('src')
        version = urlsplit(boot).query
        assert version and any(url.endswith('/widgets/' + entry + '?' + version) for url in requests), (
            f'{widget}: boot must load the entry with the page asset version'
        )
        gallery = article.locator(f'[data-guide-widget="{widget}"][data-guide-ready="true"]')
        try:
            gallery.get_by_role('button', name='浏览示例').click()
        except PlaywrightTimeoutError as error:
            article.locator('[data-guide-widget]').scroll_into_view_if_needed()
            snapshot(f'{widget}-failure')
            raise AssertionError(f'{widget} did not mount: {errors}') from error
        gallery.locator('[data-grid-item]').first.click()
        gallery.locator('[data-gallery-state="detail"]').wait_for(state='visible')
        detail = gallery.locator('[data-gallery-detail-active]')
        detail.wait_for(state='visible')
        preview = detail.locator('img').first
        assert preview.evaluate('(img) => img.decode().then(() => img.naturalWidth > 0)')
        assert preview.is_visible()
        if widget == 'CodeGallery':
            snapshot('CodeGallery-preview')
            gallery.get_by_role('button', name='显示提示词').click()
        page.evaluate('navigator.clipboard.writeText("")')
        detail.get_by_role('button', name='复制提示词').click()
        copied = page.evaluate('navigator.clipboard.readText()')
        assert copied.strip() and copied.strip() in detail.inner_text(), copied
        assert not bad_links(gallery), bad_links(gallery)
        assert gallery.locator('iframe').count() == 0
        snapshot(widget)
        gallery.get_by_role('button', name='关闭示例库').click()
        page.wait_for_function('!new URLSearchParams(location.search).has("gallery")')
        print(f'OK: {widget} detail, local preview and prompt copy')

    assert not errors, '\n'.join(errors)
    assert not unexpected_requests, sorted(unexpected_requests)
    print(f'OK: {len(SLUGS)} rendered guides; no third-party requests, broken links or page errors (site catalog mocked)')


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--screenshots', type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietServer, directory=str(ROOT))) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel='msedge', headless=True)
                try:
                    context = browser.new_context(viewport={'width': 1440, 'height': 960},
                                                  permissions=['clipboard-read', 'clipboard-write'],
                                                  service_workers='block')
                    documents(context, f'http://127.0.0.1:{server.server_port}', args.screenshots)
                finally:
                    browser.close()
        finally:
            server.shutdown()


if __name__ == '__main__':
    main()
