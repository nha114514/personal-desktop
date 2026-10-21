// Inspect model menu items
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
      const menu = document.querySelector('._surface_ri079_1');
      if (!menu) return { error: 'menu not found' };
      
      const items = Array.from(menu.querySelectorAll('*')).map(el => ({
        tag: el.tagName,
        text: el.innerText,
        className: el.className,
      }));
      
      // Let's click the element containing 'GPT-6-Sol' inside the menu
      const modelItem = Array.from(menu.querySelectorAll('button, [role="button"], div')).find(el => el.innerText.trim() === 'GPT-6-Sol');
      if (modelItem) {
        modelItem.click();
        await new Promise(r => setTimeout(r, 500));
      }
      
      const allMenus = Array.from(document.querySelectorAll('._surface_ri079_1, [role="menu"], [class*="menu"]')).map(m => m.innerText);
      
      return {
        items: items.slice(0, 15),
        allMenus,
      };
    })()
  `)
  console.log('Model menu inspection:', JSON.stringify(result, null, 2))
} catch (err) {
  console.error('Failed:', err)
} finally {
  ws.close()
}
