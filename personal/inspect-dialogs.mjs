// Inspect dialog/popover DOM after clicking model button
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
  const result = await evaluate(`
    (async () => {
      // Find modal / dialog / popover
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="menu"], [data-floating-ui-portal], [class*="popover"], [class*="dialog"], [class*="menu"], [class*="modal"]'));
      return dialogs.map(d => ({
        tag: d.tagName,
        className: d.className,
        text: d.innerText.slice(0, 1000),
      }));
    })()
  `)
  console.log('Dialogs/Popovers:', JSON.stringify(result, null, 2))
} catch (err) {
  console.error('Failed:', err)
} finally {
  ws.close()
}
