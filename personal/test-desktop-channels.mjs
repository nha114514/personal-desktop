// Full verification script across Desktop channels
const targets = await (await fetch('http://127.0.0.1:24572/json/list')).json()
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

// 1. Helper to create new session
async function createNewSession() {
  await evaluate(`
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('新会话'));
      if (btn) btn.click();
    })()
  `)
  await sleep(600)
}

// 2. Helper to select model
async function selectModel(modelTitle) {
  const result = await evaluate(`
    (async () => {
      // 1. Open model menu
      let trigger = document.querySelector('button[aria-label*="选择模型"]');
      if (!trigger) {
        trigger = Array.from(document.querySelectorAll('button')).find(b => b.className.includes('R3fYQa_trigger'));
      }
      if (!trigger) return { error: 'Model trigger not found' };
      trigger.click();
      await new Promise(r => setTimeout(r, 400));
      
      // 2. Check if sub-menu for '模型' exists
      const modelCell = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('模型') && (b.className.includes('cell') || b.className.includes('R3fYQa')));
      if (modelCell) {
        modelCell.click();
        await new Promise(r => setTimeout(r, 400));
      }
      
      // 3. Find option with matching title or text
      const options = Array.from(document.querySelectorAll('button.R3fYQa_modelOption, button[class*="modelOption"]'));
      const targetOption = options.find(o => o.getAttribute('title') === ${JSON.stringify(modelTitle)} || o.innerText.trim() === ${JSON.stringify(modelTitle)});
      if (!targetOption) {
        return {
          error: 'Target option not found',
          available: options.map(o => o.getAttribute('title') || o.innerText.trim())
        };
      }
      
      targetOption.click();
      await new Promise(r => setTimeout(r, 400));
      
      // Verify trigger text
      trigger = document.querySelector('button[aria-label*="选择模型"]');
      return { success: true, currentText: trigger ? trigger.innerText : '' };
    })()
  `)
  return result
}

// 3. Helper to send message and wait for turn completion
async function sendMessage(text, timeoutMs = 60000) {
  await evaluate(`
    (() => {
      const textarea = document.querySelector('textarea');
      if (!textarea) throw new Error('Textarea not found');
      
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      
      const sendBtn = document.querySelector('button[aria-label="发送消息"]');
      if (!sendBtn) throw new Error('Send button not found');
      sendBtn.click();
    })()
  `)

  // Poll for completion
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    await sleep(1000)
    const status = await evaluate(`
      (() => {
        // Find send button state (if disabled or icon is stop square)
        const sendBtn = document.querySelector('button[aria-label="发送消息"]');
        const stopBtn = document.querySelector('button[aria-label="停止生成"]');
        
        // Find turns / assistant bubbles
        const assistantNodes = Array.from(document.querySelectorAll('[data-chat-role="assistant"], [class*="assistant"], [class*="markdown"], [class*="Turn"]'));
        
        // Find last status pill / badge
        const pills = Array.from(document.querySelectorAll('button, div, span')).filter(el => {
          const t = el.innerText;
          return t.includes('已完成') || t.includes('处理失败') || t.includes('正在生成') || t.includes('已停止');
        }).map(el => el.innerText);

        // Find assistant text
        const textElements = Array.from(document.querySelectorAll('p, pre, code, [class*="markdown"]')).map(e => e.innerText);

        return {
          isGenerating: !!stopBtn,
          pills: pills.slice(-5),
          fullText: document.body.innerText.slice(-2000),
        };
      })()
    `)

    const isFinished = status.pills.some(p => p.includes('已完成') || p.includes('处理失败'))
    if (!status.isGenerating && isFinished) {
      return status
    }
  }

  throw new Error('Timeout waiting for response')
}

console.log('--- Starting Verification ---')

try {
  // Test 1: Gemini Member Account 1
  console.log('\n[Test 1] Testing Gemini 会员账号 1...')
  await createNewSession()
  const sel1 = await selectModel('Gemini 3.8 Flash (会员账号 1)')
  console.log('Model selection result 1:', sel1)
  
  console.log('Sending message to Gemini 会员账号 1...')
  const res1 = await sendMessage('请回复：【会员账号1测试成功】，不要调用任何工具。', 45000)
  console.log('Response 1 Pills:', res1.pills)
  console.log('Response 1 Text excerpt:\n', res1.fullText.slice(-600))

  // Test 2: Gemini Member Account 2
  console.log('\n[Test 2] Testing Gemini 会员账号 2...')
  await createNewSession()
  const sel2 = await selectModel('Gemini 3.8 Flash (会员账号 2)')
  console.log('Model selection result 2:', sel2)
  
  console.log('Sending message to Gemini 会员账号 2...')
  const res2 = await sendMessage('请回复：【会员账号2测试成功】，不要调用任何工具。', 45000)
  console.log('Response 2 Pills:', res2.pills)
  console.log('Response 2 Text excerpt:\n', res2.fullText.slice(-600))

  // Test 3: Gemini API Channel (Should guide user to member accounts without key)
  console.log('\n[Test 3] Testing Gemini API channel without key...')
  await createNewSession()
  const sel3 = await selectModel('Gemini 3.8 Flash (API)')
  console.log('Model selection result 3:', sel3)
  
  console.log('Sending message to Gemini API...')
  const res3 = await sendMessage('测试 API 通道', 30000)
  console.log('Response 3 Pills:', res3.pills)
  console.log('Response 3 Text excerpt:\n', res3.fullText.slice(-600))

  // Test 4: Primary Model Delegation
  console.log('\n[Test 4] Testing Primary Model (Codex) & Subagent Delegation...')
  await createNewSession()
  const sel4 = await selectModel('GPT-6-Sol')
  console.log('Model selection result 4:', sel4)

  console.log('Sending delegation task to primary model...')
  const res4 = await sendMessage('请委托 Gemini 子代理 (subagent_gemini_1) 计算 123 + 456 的结果，并向我汇报。', 45000)
  console.log('Response 4 Pills:', res4.pills)
  console.log('Response 4 Text excerpt:\n', res4.fullText.slice(-600))

} catch (err) {
  console.error('Test encountered error:', err)
} finally {
  ws.close()
  console.log('\n--- Verification Finished ---')
}
