// Test primary model delegating to Gemini subagent in a fresh session
const targets = await (await fetch('http://127.0.0.1:24572/json/list')).json()
const pageTarget = targets.find(t => t.type === 'page')
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)

let id = 1
const callbacks = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && callbacks.has(msg.id)) {
    const cb = callbacks.get(msg.id)
    callbacks.delete(msg.id)
    cb(msg)
  }
}
function send(method, params = {}) {
  return new Promise((resolve) => {
    const reqId = id++
    callbacks.set(reqId, resolve)
    ws.send(JSON.stringify({ id: reqId, method, params }))
  })
}
await new Promise((resolve) => ws.onopen = resolve)
await send('Runtime.enable')

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails))
  }
  return res.result?.result?.value
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// 1. Focus input
await evaluate(`
  (() => {
    const input = document.querySelector('[data-composer-input="true"]');
    if (input) input.focus();
  })()
`)

// 2. Insert text
const promptText = '请调用 subagent_gemini_1 计算 123 + 456，并将子代理计算的结果告诉我。'
await send('Input.insertText', { text: promptText })
await sleep(400)

// 3. Click Send
const clicked = await evaluate(`
  (() => {
    const sendBtn = document.querySelector('button[aria-label="发送消息"]');
    if (!sendBtn || sendBtn.disabled) return false;
    sendBtn.click();
    return true;
  })()
`)
console.log('Send clicked:', clicked)

// 4. Poll until completion
const start = Date.now()
let lastStatus = null
while ((Date.now() - start) < 60000) {
  await sleep(1500)
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
  `)

  if (!lastStatus.isGenerating && lastStatus.latestPill && (lastStatus.latestPill.includes('已完成') || lastStatus.latestPill.includes('处理失败'))) {
    console.log('Completed in', ((Date.now() - start)/1000).toFixed(1), 's')
    console.log('Latest Pill:', lastStatus.latestPill)
    console.log('Tools:', lastStatus.tools)
    console.log('Markdown:\n', lastStatus.lastMarkdown)
    console.log('Recent text:\n', lastStatus.recentText.slice(-500))
    break
  }
}

ws.close()
