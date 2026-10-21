import { writeFileSync } from 'node:fs';

async function inspect() {
  const r = await fetch('http://127.0.0.1:24572/json/list');
  const targets = await r.json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const send = (expr) => new Promise(resolve => {
    const cur = id++;
    const handler = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id === cur) {
        ws.removeEventListener('message', handler);
        resolve(msg.result?.result?.value);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: cur, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });

  await new Promise(res => ws.onopen = res);
  const data = await send(`
    (() => {
      const stopBtn = document.querySelector('button[aria-label="停止生成"]');
      const messages = Array.from(document.querySelectorAll('[data-chat-role], [class*="message"], [class*="Message"]')).map(el => ({
        role: el.getAttribute('data-chat-role') || 'unknown',
        text: el.innerText.trim().slice(0, 500)
      }));
      const pills = Array.from(document.querySelectorAll('button, div, span')).filter(el => {
        const t = el.innerText.trim();
        return t.startsWith('已完成') || t.startsWith('处理失败') || t.startsWith('已停止');
      }).map(el => el.innerText.trim());
      const allText = document.body.innerText.slice(-2000);
      return {
        isGenerating: !!stopBtn,
        messagesCount: messages.length,
        recentMessages: messages.slice(-4),
        pills: pills.slice(-3),
        allTextTail: allText
      };
    })()
  `);
  console.log(JSON.stringify(data, null, 2));
  ws.close();
}

inspect().catch(console.error);
