// Verification script for YouTube and X integration in Personal Desktop
import { writeFileSync } from 'node:fs';

async function main() {
  console.log('--- Personal Desktop Foreign Platforms Verification ---');
  const listRes = await fetch('http://127.0.0.1:24572/json/list');
  const targets = await listRes.json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) {
    console.error('Fatal: No page target found on port 24572');
    process.exit(1);
  }
  console.log('Connecting to WebSocket:', pageTarget.webSocketDebuggerUrl);

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let reqId = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      cb(msg);
    }
  };

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = reqId++;
    callbacks.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise((resolve) => ws.onopen = resolve);
  await send('Runtime.enable');
  await send('DOM.enable');

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  };

  const results = {
    checks: [],
    errors: [],
  };

  function pass(name, detail = {}) {
    console.log(`[PASS] ${name}`);
    results.checks.push({ name, status: 'PASS', detail });
  }

  function fail(name, error) {
    console.error(`[FAIL] ${name}:`, error);
    results.errors.push({ name, error: String(error) });
  }

  // 1. Check Personal Crawlers IPC presence & platform count (must be 9: bili, xhs, dy, ks, wb, tieba, zhihu, youtube, x)
  try {
    const status = await evaluate('window.dshDesktop.personalCrawlers.status()');
    if (!status || !Array.isArray(status.platforms)) {
      fail('PersonalCrawlers: status()', 'No platforms returned');
    } else {
      const ids = status.platforms.map(p => p.id);
      console.log('Platform IDs in Personal Desktop:', ids.join(', '));
      if (ids.includes('youtube') && ids.includes('x') && status.platforms.length === 9) {
        pass('PersonalCrawlers: 9 platforms registered including youtube & x', {
          platforms: status.platforms.map(p => ({ id: p.id, name: p.name, status: p.status })),
        });
      } else {
        fail('PersonalCrawlers: platform list', `Expected 9 platforms including youtube & x, got: ${ids.join(', ')}`);
      }
    }
  } catch (e) {
    fail('PersonalCrawlers status check', e);
  }

  // 2. Real Desktop Crawl for YouTube
  try {
    console.log('Starting desktop crawl for youtube...');
    const crawlRes = await evaluate(`
      window.dshDesktop.personalCrawlers.crawl('youtube', 'OpenAI Sora', 3)
    `);
    if (crawlRes && Array.isArray(crawlRes.results) && crawlRes.results.length > 0) {
      const ytResults = crawlRes.results.filter(r => r.platform === 'youtube');
      if (ytResults.length > 0) {
        pass('PersonalCrawlers: Real YouTube crawl via Desktop IPC', {
          count: ytResults.length,
          sampleTitle: ytResults[0].title,
          sampleUrl: ytResults[0].url,
        });
      } else {
        fail('PersonalCrawlers: Real YouTube crawl', 'No youtube results in returned snapshot');
      }
    } else {
      fail('PersonalCrawlers: Real YouTube crawl', 'Crawl did not return results');
    }
  } catch (e) {
    fail('PersonalCrawlers: Real YouTube crawl exception', e);
  }

  // 3. Verify getResults('youtube') via Desktop IPC
  try {
    const resultsList = await evaluate(`
      window.dshDesktop.personalCrawlers.getResults('youtube')
    `);
    if (Array.isArray(resultsList) && resultsList.length > 0) {
      pass('PersonalCrawlers: getResults("youtube") returns cached records', {
        count: resultsList.length,
        first: resultsList[0],
      });
    } else {
      fail('PersonalCrawlers: getResults("youtube")', 'No records returned');
    }
  } catch (e) {
    fail('PersonalCrawlers getResults check', e);
  }

  // 4. Test X / Twitter error behavior in Desktop (Extension not connected / login required)
  try {
    console.log('Testing X crawl in desktop without extension bridge...');
    let errorCaught = false;
    let errorMsg = '';
    try {
      await evaluate(`
        window.dshDesktop.personalCrawlers.crawl('x', 'OpenAI', 2)
      `);
    } catch (e) {
      errorCaught = true;
      errorMsg = String(e);
    }
    if (errorCaught) {
      pass('PersonalCrawlers: X crawl properly detects bridge status or login requirement', {
        error: errorMsg,
      });
    } else {
      fail('PersonalCrawlers: X crawl error check', 'Expected error when OpenCLI extension is not connected');
    }
  } catch (e) {
    fail('PersonalCrawlers: X crawl unexpected error', e);
  }

  // 5. Check desktop logs streaming
  try {
    const status = await evaluate('window.dshDesktop.personalCrawlers.status()');
    if (status && Array.isArray(status.logs) && status.logs.length > 0) {
      pass('PersonalCrawlers: logs recorded during crawl operations', {
        logsCount: status.logs.length,
        recentLog: status.logs[status.logs.length - 1],
      });
    } else {
      fail('PersonalCrawlers: logs streaming', 'No logs recorded');
    }
  } catch (e) {
    fail('PersonalCrawlers logs check', e);
  }

  ws.close();

  console.log('\n--- FOREIGN PLATFORMS DESKTOP SUMMARY ---');
  console.log(`Passed: ${results.checks.length}, Failed: ${results.errors.length}`);
  writeFileSync('D:/desktop/personal-data/evidence/foreign-platforms-desktop-result.json', JSON.stringify(results, null, 2), 'utf8');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
