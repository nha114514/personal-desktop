// Real Desktop End-to-End Acceptance Test
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

async function selectModel(title) {
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

async function sendPrompt(text, maxWaitSeconds = 60) {
  // Clear input
  await evaluate(`
    (() => {
      const input = document.querySelector('[data-composer-input="true"]');
      if (input) {
        input.focus();
        const sel = window.getSelection();
        sel.selectAllChildren(input);
      }
    })()
  `)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' })
  await sleep(200)

  // Focus and insert text
  await evaluate(`
    (() => {
      const input = document.querySelector('[data-composer-input="true"]');
      if (input) input.focus();
    })()
  `)
  await send('Input.insertText', { text })
  await sleep(300)

  // Record initial turns count
  const initialInfo = await evaluate(`
    (() => {
      const turns = document.querySelectorAll('[data-chat-turn], [class*="Turn_turn"]');
      return { turnsCount: turns.length };
    })()
  `)

  // Click Send
  const clicked = await evaluate(`
    (() => {
      const sendBtn = document.querySelector('button[aria-label="发送消息"]');
      if (!sendBtn || sendBtn.disabled) return false;
      sendBtn.click();
      return true;
    })()
  `)
  if (!clicked) {
    throw new Error('Failed to click Send button (maybe disabled or not found)')
  }

  // Poll until response finishes
  const start = Date.now()
  let lastStatus = null
  while ((Date.now() - start) < maxWaitSeconds * 1000) {
    await sleep(1000)
    lastStatus = await evaluate(`
      (() => {
        const stopBtn = document.querySelector('button[aria-label="停止生成"]');
        const sendBtn = document.querySelector('button[aria-label="发送消息"]');
        const bodyText = document.body.innerText;
        
        // Find latest status pill
        const pills = Array.from(document.querySelectorAll('button, div, span')).filter(el => {
          const t = el.innerText.trim();
          return t.startsWith('已完成') || t.startsWith('处理失败') || t.startsWith('已停止');
        }).map(el => el.innerText.trim());

        // Find last assistant text / markdown
        const markdowns = Array.from(document.querySelectorAll('[class*="markdown"], [class*="Markdown"]')).map(el => el.innerText);

        return {
          isGenerating: !!stopBtn,
          latestPill: pills.length > 0 ? pills[pills.length - 1] : null,
          allPills: pills.slice(-3),
          lastMarkdown: markdowns.length > 0 ? markdowns[markdowns.length - 1] : null,
          recentBodyText: bodyText.slice(-1000),
        };
      })()
    `)

    // Check if generation completed
    if (!lastStatus.isGenerating) {
      if (lastStatus.latestPill && (lastStatus.latestPill.includes('已完成') || lastStatus.latestPill.includes('处理失败'))) {
        return {
          durationMs: Date.now() - start,
          status: lastStatus,
        }
      }
    }
  }

  return {
    durationMs: Date.now() - start,
    status: lastStatus,
    timedOut: true,
  }
}

console.log('=== Desktop Real Acceptance Tests Starting ===\n')

// ==========================================
// Test 1: Gemini 会员账号 1
// ==========================================
console.log('--- Test 1: Gemini 会员账号 1 ---')
const sel1 = await selectModel('Gemini 3.8 Flash (会员账号 1)')
console.log('Selected:', sel1.triggerText)
const res1 = await sendPrompt('请回复：【会员账号1测试成功】，不要调用工具。', 60)
console.log(`Test 1 Finished in ${(res1.durationMs / 1000).toFixed(1)}s`)
console.log('Status Pill:', res1.status.latestPill)
console.log('Assistant Text:\n', res1.status.lastMarkdown || res1.status.recentBodyText.slice(-400))
console.log('--------------------------------------------------\n')

// ==========================================
// Test 2: Gemini 会员账号 2
// ==========================================
console.log('--- Test 2: Gemini 会员账号 2 ---')
const sel2 = await selectModel('Gemini 3.8 Flash (会员账号 2)')
console.log('Selected:', sel2.triggerText)
const res2 = await sendPrompt('请回复：【会员账号2测试成功】，不要调用工具。', 60)
console.log(`Test 2 Finished in ${(res2.durationMs / 1000).toFixed(1)}s`)
console.log('Status Pill:', res2.status.latestPill)
console.log('Assistant Text:\n', res2.status.lastMarkdown || res2.status.recentBodyText.slice(-400))
console.log('--------------------------------------------------\n')

// ==========================================
// Test 3: Gemini API Channel without API Key
// ==========================================
console.log('--- Test 3: Gemini API Channel (without Key) ---')
const sel3 = await selectModel('Gemini 3.8 Flash (API)')
console.log('Selected:', sel3.triggerText)
const res3 = await sendPrompt('测试 API 渠道报错提示', 30)
console.log(`Test 3 Finished in ${(res3.durationMs / 1000).toFixed(1)}s`)
console.log('Status Pill:', res3.status.latestPill)
console.log('Assistant / Error Text:\n', res3.status.recentBodyText.slice(-500))
console.log('--------------------------------------------------\n')

// ==========================================
// Test 4: Primary Model (Codex) & Subagent Delegation
// ==========================================
console.log('--- Test 4: Primary Model (GPT-6-Sol) ---')
const sel4 = await selectModel('GPT-6-Sol')
console.log('Selected:', sel4.triggerText)
const res4 = await sendPrompt('请使用 subagent_gemini_1 帮我计算 321 + 654，并汇报结果。', 45)
console.log(`Test 4 Finished in ${(res4.durationMs / 1000).toFixed(1)}s`)
console.log('Status Pill:', res4.status.latestPill)
console.log('Assistant / Error Text:\n', res4.status.recentBodyText.slice(-500))
console.log('--------------------------------------------------\n')

ws.close()
console.log('=== All Real Acceptance Tests Complete ===')
