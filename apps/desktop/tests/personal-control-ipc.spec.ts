import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopExecutionManager } from '@deepseek-ai/dsh-computer-use-windows-mcp'
import { PersonalDesktopControl } from '../src/personal-desktop-control.ts'
import { DesktopHostProcess } from '../src/host-process.ts'

const roots: string[] = []
const controls: PersonalDesktopControl[] = []
const hosts: DesktopHostProcess[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  await Promise.all(controls.splice(0).map(control => control.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'personal-control-ipc-'))
  roots.push(root)
  const native = join(root, 'native.mjs')
  const log = join(root, 'native-actions.jsonl')
  writeFileSync(native, `
import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const log=${JSON.stringify(log)};
const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  if(request.method==='initialize') reply(request.id,{serverInfo:{version:'fixture'}});
  if(request.method==='tools/list') reply(request.id,{tools:['App','Clipboard','Snapshot'].map(name=>({name,inputSchema:{type:'object'}}))});
  if(request.method==='tools/call'){
    const {marker,delay=0}=request.params.arguments;
    appendFileSync(log,JSON.stringify({event:'start',marker})+'\\n');
    setTimeout(()=>{
      appendFileSync(log,JSON.stringify({event:'finish',marker})+'\\n');
      reply(request.id,{content:[{type:'text',text:marker},{type:'image',data:'AA==',mimeType:'image/png'}]});
    },delay);
  }
});
`)
  const manager = new DesktopExecutionManager({ enableFileSignal: false })
  const control = new PersonalDesktopControl({ executable: process.execPath, args: [native], dataDirectory: root, executionManager: manager })
  controls.push(control)
  const hostPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(hostPackage, 'lib'), { recursive: true })
  writeFileSync(join(hostPackage, 'package.json'), '{"type":"module"}')
  const bridgeSource = readFileSync(new URL('../../../packages/computer-use/computer-use-windows-mcp/src/parent-bridge.ts', import.meta.url), 'utf8')
  writeFileSync(join(hostPackage, 'lib', 'bridge.mjs'), ts.transpileModule(bridgeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  writeFileSync(join(hostPackage, 'lib', 'index.js'), `
import {createServer} from 'node:http';
import {DesktopParentBridge} from './bridge.mjs';
const channel={connected:()=>process.connected,send:(message,callback)=>process.send(message,callback),on:(event,listener)=>process.on(event,listener),off:(event,listener)=>process.off(event,listener)};
const bridge=new DesktopParentBridge(channel,10000);
await bridge.listTools();
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost');
  try {
    const result=await bridge.callTool('App',{marker:url.searchParams.get('marker'),delay:Number(url.searchParams.get('delay')||0)},new AbortController().signal);
    response.end(JSON.stringify({result}));
  }catch(error){response.end(JSON.stringify({error:error.message}));}
});
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
process.on('message',message=>{
  if(message.type==='shutdown'){
    bridge.dispose();server.close(()=>process.send({type:'shutdown-complete'},()=>process.disconnect()));server.closeAllConnections();
  }
});
`)
  const host = new DesktopHostProcess(process.execPath, root, root, undefined, process.env, undefined, undefined, undefined, undefined, {
    executeDesktop: (request, signal) => request.action === 'list' ? control.listMcpTools()
      : control.callMcpTool(request.name, request.arguments, signal, request.epoch),
    desktopState: () => ({ epoch: manager.getEpoch(), paused: manager.isPaused() }),
    observeModel: () => {},
  })
  hosts.push(host)
  control.subscribe(snapshot => { host.publishDesktopState(snapshot) })
  const ready = await host.start()
  const events = (): { event: string; marker: string }[] => {
    try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
    catch (_error) { return [] }
  }
  return { control, host, manager, url: ready.url, events, log }
}

describe('personal desktop private IPC', () => {
  it('serializes real child-process Host and UI calls through one native connection without losing images', async () => {
    const test = await fixture()
    const ui = test.control.callTool('App', { marker: 'ui', delay: 30 })
    const host = fetch(`${test.url}/?marker=host`).then(response => response.json())
    const [uiResult, hostResult] = await Promise.all([ui, host])
    expect(uiResult.output).toBe('ui')
    expect(hostResult.result.content[1]).toEqual({ type: 'image', data: 'AA==', mimeType: 'image/png' })
    expect(test.events().map(event => `${event.event}:${event.marker}`)).toEqual(['start:ui', 'finish:ui', 'start:host', 'finish:host'])
  }, 15000)

  it('cancels active native work and the queued Host request, then admits only fresh work after resume', async () => {
    const test = await fixture()
    const active = test.control.callTool('App', { marker: 'old-ui', delay: 2000 })
    const activeRejected = expect(active).rejects.toThrow(/stopped|abort/i)
    await expect.poll(() => test.events().some(event => event.marker === 'old-ui')).toBe(true)
    const queued = fetch(`${test.url}/?marker=old-host`).then(response => response.json())
    await expect.poll(() => test.manager.getQueueLength()).toBe(1)
    await test.control.stop()
    await activeRejected
    expect((await queued).error).toMatch(/stopped|abort/i)
    await test.control.resume()
    const fresh = await fetch(`${test.url}/?marker=fresh`).then(response => response.json())
    expect(fresh.result.content[0].text).toBe('fresh')
    expect(test.events()).not.toContainEqual({ event: 'start', marker: 'old-host' })
    expect(test.events()).not.toContainEqual({ event: 'finish', marker: 'old-ui' })
    expect(test.events()).toContainEqual({ event: 'finish', marker: 'fresh' })
  }, 15000)

  it('rejects an old-generation request without sending a native action', async () => {
    const test = await fixture()
    const previous = test.manager.getEpoch()
    await test.control.stop()
    await test.control.resume()
    await expect(test.control.callMcpTool('App', { marker: 'stale' }, new AbortController().signal, previous)).rejects.toThrow('outdated')
    expect(test.events()).toEqual([])
    appendFileSync(test.log, '')
  }, 15000)
})
