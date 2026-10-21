// Inspect Renderer via Chrome DevTools Protocol
const targets = await (await fetch('http://127.0.0.1:24572/json/list')).json()
console.log('Renderer targets:', targets)

const pageTarget = targets.find(t => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found')
  process.exit(1)
}

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
console.log('Connected to Renderer CDP')

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
  const pageInfo = await evaluate(`
    ({
      title: document.title,
      url: window.location.href,
      bodyText: document.body.innerText.slice(0, 500),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText).filter(Boolean).slice(0, 20),
    })
  `)
  console.log('Page info:', pageInfo)
} catch (err) {
  console.error('Evaluation failed:', err)
} finally {
  ws.close()
}
