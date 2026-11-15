import { it, expect, vi } from 'vitest';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { McpClient } from './client.js';

const script = `
const fs=require('node:fs');
let buf='';
setInterval(()=>{},1000);
process.stdin.on('data',data=>{
 buf+=data;
 let i;
 while((i=buf.indexOf('\\n'))>=0){
  const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);
  const reply=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
  if(m.method==='initialize')reply({capabilities:{}});
  else if(m.method==='tools/list')reply({tools:[]});
  else if(m.method==='tools/call' && m.params.name==='close-input'){
   process.stdin.once('close',()=>{
    try { fs.closeSync(0); } catch(e) { if(e.code!=='EBADF')throw e; }
    reply({content:[{type:'text',text:'input closed'}]});
   });
   process.stdin.destroy();
  }
 }
});`;

async function fixture() {
  const client = new McpClient('closure', { command: process.execPath, args: ['-e', script], timeoutMs: 2000 });
  await client.connect();
  const child = (client as unknown as { child: ChildProcess }).child;
  const closed = once(child, 'close');
  return { client, child, async cleanup() { client.kill(); await closed; } };
}

it('rejects all pending and future requests immediately on explicit shutdown', async () => {
  const f = await fixture();
  try {
    const first = f.client.callTool('stall', {}).catch(e => e);
    const second = f.client.callTool('stall', {}).catch(e => e);
    f.client.kill();
    expect(f.client.isAlive()).toBe(false);
    expect((await first).message).toMatch(/was closed/);
    expect((await second).message).toMatch(/was closed/);
    await expect(f.client.callTool('stall', {})).rejects.toThrow(/was closed/);
    expect(() => f.child.stdin!.emit('error', new Error('late EPIPE'))).not.toThrow();
    f.client.kill();
    await expect(f.client.callTool('stall', {})).rejects.toThrow(/was closed/);
  } finally { await f.cleanup(); }
});

// Closing CRT fd 0 does not close Node's inherited pipe handle on Windows.
// All platforms also exercise the stream error event and real process shutdown.
it.skipIf(process.platform === 'win32')('isolates a real closed input pipe while the server process remains alive', async () => {
  const f = await fixture();
  try {
    expect(await f.client.callTool('close-input', {})).toBe('input closed');
    expect(f.child.exitCode).toBe(null);
    await expect(f.client.callTool('stall', { data: 'x'.repeat(262144) })).rejects.toThrow(/stdin failed/);
    expect(f.client.isAlive()).toBe(false);
    await expect(f.client.callTool('stall', {})).rejects.toThrow(/stdin failed/);
  } finally { await f.cleanup(); }
});

it('contains a stdin stream error with pending requests on every platform', async () => {
  const f = await fixture();
  try {
    const pending = f.client.callTool('stall', {}).catch(e => e);
    expect(f.child.exitCode).toBe(null);
    expect(() => f.child.stdin!.emit('error', new Error('broken input pipe'))).not.toThrow();
    expect((await pending).message).toMatch(/stdin failed: broken input pipe/);
    expect(f.client.isAlive()).toBe(false);
    await expect(f.client.callTool('stall', {})).rejects.toThrow(/stdin failed: broken input pipe/);
  } finally { await f.cleanup(); }
});

it('rejects pending requests when write throws synchronously and preserves the cause', async () => {
  const f = await fixture();
  try {
    const pending = f.client.callTool('stall', {}).catch(e => e);
    const write = vi.spyOn(f.child.stdin!, 'write').mockImplementation(() => { throw new Error('closed stream'); });
    await expect(f.client.callTool('stall', {})).rejects.toThrow(/stdin write failed: closed stream/);
    expect((await pending).message).toMatch(/stdin write failed: closed stream/);
    expect(f.client.isAlive()).toBe(false);
    write.mockRestore();
  } finally { await f.cleanup(); }
});
