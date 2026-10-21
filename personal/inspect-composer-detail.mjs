// Inspect textarea and send button details
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
  const info = await evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      const form = textarea?.closest('form');
      const container = textarea?.parentElement;
      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.innerText,
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        className: b.className,
      }));
      return {
        textareaFound: !!textarea,
        textareaTag: textarea?.tagName,
        formFound: !!form,
        buttons: buttons.filter(b => b.ariaLabel || b.title || b.text.includes('发送')),
      };
    })()
  `)
  console.log('Composer details:', JSON.stringify(info, null, 2))
} catch (err) {
  console.error('Failed:', err)
} finally {
  ws.close()
}
