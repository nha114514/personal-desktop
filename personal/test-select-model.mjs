// Test model selection helper
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

export async function selectModel(title) {
  // Check if dropdown or sub-menu is already open, if so close it
  await evaluate(`
    (() => {
      // Click body to dismiss any open popovers
      const backdrop = document.querySelector('[class*="backdrop"], [class*="overlay"]');
      if (backdrop) backdrop.click();
    })()
  `)
  await sleep(300)

  const res = await evaluate(`
    (async () => {
      const trigger = document.querySelector('button[aria-label*="选择模型"], .R3fYQa_trigger');
      if (!trigger) return { error: 'trigger not found' };
      trigger.click();
      await new Promise(r => setTimeout(r, 400));
      
      const modelCell = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('模型') && (b.className.includes('cell') || b.className.includes('R3fYQa')));
      if (modelCell) {
        modelCell.click();
        await new Promise(r => setTimeout(r, 400));
      }
      
      const options = Array.from(document.querySelectorAll('button.R3fYQa_modelOption, button[class*="modelOption"]'));
      const target = options.find(o => o.getAttribute('title') === ${JSON.stringify(title)} || o.innerText.trim() === ${JSON.stringify(title)});
      if (!target) {
        return {
          error: 'option not found',
          available: options.map(o => o.getAttribute('title') || o.innerText.trim())
        };
      }
      
      target.click();
      await new Promise(r => setTimeout(r, 400));

      const updatedTrigger = document.querySelector('button[aria-label*="选择模型"], .R3fYQa_trigger');
      return {
        success: true,
        triggerText: updatedTrigger ? updatedTrigger.innerText : null,
      };
    })()
  `)
  return res
}

const r1 = await selectModel('Gemini 3.8 Flash (会员账号 1)')
console.log('Selected Gemini 3.8 Flash (会员账号 1):', r1)
await sleep(1000)

const r2 = await selectModel('Gemini 3.8 Flash (会员账号 2)')
console.log('Selected Gemini 3.8 Flash (会员账号 2):', r2)
await sleep(1000)

const rCodex = await selectModel('GPT-6-Sol')
console.log('Selected back to GPT-6-Sol:', rCodex)

ws.close()
