// Find input element in Renderer
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
  const res = await evaluate(`
    (() => {
      const inputs = Array.from(document.querySelectorAll('textarea, input, [contenteditable]')).map(el => ({
        tag: el.tagName,
        className: el.className,
        contentEditable: el.contentEditable,
        placeholder: el.getAttribute('placeholder'),
        value: el.value,
        outerHTML: el.outerHTML.slice(0, 150),
      }));
      return inputs;
    })()
  `)
  console.log('Inputs found:', res)
} finally {
  ws.close()
}
