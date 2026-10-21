// Inspect model picker in Renderer
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
  // Find model button and click it to inspect options
  const result = await evaluate(`
    (async () => {
      // Find button containing 'GPT-6' or model selection trigger
      const buttons = Array.from(document.querySelectorAll('button'));
      const modelBtn = buttons.find(b => b.innerText.includes('GPT-6') || b.innerText.includes('medium') || b.innerText.includes('Flash'));
      if (!modelBtn) {
        return { error: 'Model button not found', allButtons: buttons.map(b => b.innerText) };
      }
      
      modelBtn.click();
      await new Promise(r => setTimeout(r, 500));
      
      // Look for menu / popover / dialog with models
      const popoverItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], .menu-item, [data-menu-item], li, button')).map(el => el.innerText).filter(t => t.includes('Gemini') || t.includes('GPT') || t.includes('DeepSeek') || t.includes('会员'));
      
      const allText = document.body.innerText;
      
      // Click somewhere to close menu if opened
      // document.body.click();

      return {
        modelBtnText: modelBtn.innerText,
        popoverItems: Array.from(new Set(popoverItems)),
      };
    })()
  `)
  console.log('Model button inspection:', JSON.stringify(result, null, 2))
} catch (err) {
  console.error('Failed:', err)
} finally {
  ws.close()
}
