// Test clicking new session button
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
  const before = await evaluate(`({
    title: document.title,
    textarea: !!document.querySelector('textarea'),
    pills: Array.from(document.querySelectorAll('button, span')).map(b => b.innerText).filter(t => t.includes('轮')),
  })`)
  console.log('Before click:', before)

  await evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('新会话'));
      if (btn) btn.click();
    })()
  `)

  await new Promise(r => setTimeout(r, 1000))

  const after = await evaluate(`({
    title: document.title,
    textarea: !!document.querySelector('textarea'),
    pills: Array.from(document.querySelectorAll('button, span')).map(b => b.innerText).filter(t => t.includes('轮')),
  })`)
  console.log('After click:', after)
} finally {
  ws.close()
}
