// Inspect live Desktop Host via Node inspector WebSocket protocol
const hostJson = await (await fetch('http://127.0.0.1:24573/json/list')).json()
const hostTarget = hostJson[0]
if (!hostTarget) {
  console.error('No host target found')
  process.exit(1)
}

console.log('Host target:', hostTarget.title, hostTarget.webSocketDebuggerUrl)

const ws = new WebSocket(hostTarget.webSocketDebuggerUrl)

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
console.log('Connected to Host inspector')

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
  // Check global or context variables in Host
  const inspectExpr = `
    (async () => {
      // Find cordis context or root fiber
      const g = globalThis;
      return {
        hasGlobalThis: true,
        keys: Object.keys(g).filter(k => !k.startsWith('_')),
      };
    })()
  `
  const info = await evaluate(inspectExpr)
  console.log('Host inspection:', info)
} catch (err) {
  console.error('Evaluation failed:', err)
} finally {
  ws.close()
}
