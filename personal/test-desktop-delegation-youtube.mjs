// Test primary model delegating YouTube retrieval to subagent in Personal Desktop
const listRes = await fetch('http://127.0.0.1:24572/json/list');
const targets = await listRes.json();
const pageTarget = targets.find(t => t.type === 'page');
if (!pageTarget) {
  console.error('Fatal: No page target found on port 24572');
  process.exit(1);
}

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
let id = 1;
const callbacks = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && callbacks.has(msg.id)) {
    const cb = callbacks.get(msg.id);
    callbacks.delete(msg.id);
    cb(msg);
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const reqId = id++;
    callbacks.set(reqId, resolve);
    ws.send(JSON.stringify({ id: reqId, method, params }));
  });
}
await new Promise((resolve) => ws.onopen = resolve);
await send('Runtime.enable');

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  }
  return res.result?.result?.value;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

console.log('Focusing composer input...');
await evaluate(`
  (() => {
    const input = document.querySelector('[data-composer-input="true"]');
    if (input) input.focus();
  })()
`);

const promptText = '请委派子代理检索关于 "youtube: OpenAI Sora" 的视频，并总结检索到的视频标题与链接。';
await send('Input.insertText', { text: promptText });
await sleep(500);

console.log('Clicking Send button...');
const clicked = await evaluate(`
  (() => {
    const sendBtn = document.querySelector('button[aria-label="发送消息"]');
    if (!sendBtn || sendBtn.disabled) return false;
    sendBtn.click();
    return true;
  })()
`);
console.log('Send button clicked:', clicked);

if (!clicked) {
  console.log('Could not click send button; checking composer state...');
  const state = await evaluate(`
    (() => {
      const input = document.querySelector('[data-composer-input="true"]');
      const sendBtn = document.querySelector('button[aria-label="发送消息"]');
      return {
        inputValue: input?.innerText || '',
        btnDisabled: sendBtn?.disabled,
        btnExists: !!sendBtn,
      };
    })()
  `);
  console.log('Composer state:', state);
  ws.close();
  process.exit(0);
}

const start = Date.now();
let lastStatus = null;
while ((Date.now() - start) < 60000) {
  await sleep(2000);
  lastStatus = await evaluate(`
    (() => {
      const stopBtn = document.querySelector('button[aria-label="停止生成"]');
      const pills = Array.from(document.querySelectorAll('button, div, span')).filter(el => {
        const t = el.innerText.trim();
        return t.startsWith('已完成') || t.startsWith('处理失败') || t.startsWith('已停止');
      }).map(el => el.innerText.trim());

      const tools = Array.from(document.querySelectorAll('[data-chat-role="tool"], [class*="ToolCall"], [class*="tool"]')).map(e => e.innerText.slice(0, 100));
      const markdowns = Array.from(document.querySelectorAll('[class*="markdown"], [class*="Markdown"]')).map(el => el.innerText);

      return {
        isGenerating: !!stopBtn,
        latestPill: pills.length > 0 ? pills[pills.length - 1] : null,
        tools: tools.slice(-5),
        lastMarkdown: markdowns.length > 0 ? markdowns[markdowns.length - 1] : null,
        recentText: document.body.innerText.slice(-1000),
      };
    })()
  `);

  process.stdout.write(`Elapsed: ${((Date.now() - start)/1000).toFixed(0)}s | Generating: ${lastStatus.isGenerating} | Pill: ${lastStatus.latestPill || 'none'}\r`);

  if (!lastStatus.isGenerating && lastStatus.latestPill && (lastStatus.latestPill.includes('已完成') || lastStatus.latestPill.includes('处理失败'))) {
    console.log('\nFinished in', ((Date.now() - start)/1000).toFixed(1), 's');
    console.log('Latest Pill:', lastStatus.latestPill);
    console.log('Tools:', lastStatus.tools);
    console.log('Markdown:\n', lastStatus.lastMarkdown);
    console.log('Recent text excerpt:\n', lastStatus.recentText.slice(-600));
    break;
  }
}

ws.close();
