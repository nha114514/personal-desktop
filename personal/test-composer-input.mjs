// Test setting input text in contenteditable composer
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
      const input = document.querySelector('[data-composer-input="true"]');
      if (!input) return { error: 'input not found' };
      
      input.focus();
      input.innerText = '测试输入';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      const sendBtn = document.querySelector('button[aria-label="发送消息"]');
      return {
        inputText: input.innerText,
        sendBtnFound: !!sendBtn,
        sendBtnDisabled: sendBtn?.disabled,
      };
    })()
  `)
  console.log('Composer test:', res)
} finally {
  ws.close()
}
