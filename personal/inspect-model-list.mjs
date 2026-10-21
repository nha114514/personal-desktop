// Click the model selection button and inspect opened sub-menu
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
      // Find button whose text includes '模型'
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('模型') && b.innerText.includes('GPT-6-Sol'));
      if (!btn) return { error: 'model row button not found' };
      
      btn.click();
      await new Promise(r => setTimeout(r, 600));
      
      // Now inspect all open menus / dialogs / popovers
      const surfaces = Array.from(document.querySelectorAll('._surface_ri079_1, [role="menu"], [class*="menu"], [class*="list"]'));
      return {
        clicked: btn.innerText,
        surfaces: surfaces.map(s => ({
          className: s.className,
          text: s.innerText,
        }))
      };
    })()
  `)
  console.log('Model list inspection:', JSON.stringify(result, null, 2))
} catch (err) {
  console.error('Failed:', err)
} finally {
  ws.close()
}
