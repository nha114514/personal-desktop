async function testAccountClick() {
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
  const clickRes = await send(`
    (async () => {
      const btn = Array.from(document.querySelectorAll('button, [role="tab"], div')).find(b => b.innerText && b.innerText.trim() === 'Gemini 账号');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 600));
      return { clicked: !!btn };
    })()
  `);
  console.log('Clicked Gemini 账号:', clickRes);

  const wsSend = (method, params) => new Promise(resolve => {
    const cur = id++;
    const handler = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id === cur) {
        ws.removeEventListener('message', handler);
        resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: cur, method, params }));
  });

  const shot = await wsSend('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    const fs = await import('node:fs');
    fs.writeFileSync('D:/desktop/personal-data/evidence/screenshots/gemini-accounts-settings.png', Buffer.from(shot.data, 'base64'));
    console.log('Saved screenshot to D:/desktop/personal-data/evidence/screenshots/gemini-accounts-settings.png');
  }

  process.exit(0);
}

testAccountClick();
