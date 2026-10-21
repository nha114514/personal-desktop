// Inspect model items DOM elements
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

try {
  const items = await evaluate(`
    (async () => {
      // Find all clickable items in the open menu
      const elements = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], li'));
      return elements
        .filter(el => el.innerText.includes('Gemini') || el.innerText.includes('GPT'))
        .map(el => ({
          tag: el.tagName,
          className: el.className,
          text: el.innerText.trim(),
        }));
    })()
  `)
  console.log('Clickable model elements:', JSON.stringify(items, null, 2))
} catch (err) {
  console.error('Failed:', err)
} finally {
  ws.close()
}
