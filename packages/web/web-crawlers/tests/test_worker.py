import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from scrapling.parser import Selector

spec = importlib.util.spec_from_file_location('crawler_worker', Path(__file__).parents[1] / 'runtime/crawler.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Page:
    status = 200
    url = 'https://example.com/'

    def __init__(self, html):
        self.selector = Selector(html)
        self.html_content = html

    def css(self, query):
        return self.selector.css(query)


class WorkerTests(unittest.TestCase):
    def test_lite_results_keep_snippets_and_unwrap_source_urls(self):
        page = Page('<table><tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2FD4Vinci%2FScrapling">Scrapling</a></td></tr><tr><td class="result-snippet">Python scraper</td></tr></table>')
        with patch.object(worker, 'get_page', return_value=page):
            result = worker.web_search(dict(query='Scrapling', searchEngine='duckduckgo', maxResults=2))
        self.assertEqual(result['sources'], [dict(url='https://github.com/D4Vinci/Scrapling', title='Scrapling', snippet='Python scraper')])

    def test_fetch_removes_script_and_css_contents(self):
        page = Page('<html><style>SECRET_CSS</style><script>SECRET_JS</script><body><h1>Example</h1><p>Readable text</p></body></html>')
        with patch.object(worker, 'get_page', return_value=page):
            result = worker.web_fetch(dict(url=page.url, maxBodyChars=5000))
        self.assertIn('Readable text', result['body']['content'])
        self.assertNotIn('SECRET', result['body']['content'])

    def test_empty_search_does_not_fabricate_success(self):
        with patch.object(worker, 'get_page', return_value=Page('<p>Verification</p>')):
            with self.assertRaises(worker.CrawlerFailure) as caught:
                worker.web_search(dict(query='Scrapling', searchEngine='duckduckgo', maxResults=2))
        self.assertEqual(caught.exception.code, 'WEB_SEARCH_BLOCKED')


if __name__ == '__main__':
    unittest.main()
