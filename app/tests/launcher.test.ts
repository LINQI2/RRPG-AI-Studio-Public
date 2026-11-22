import {it, expect, afterEach} from 'vitest';
import http from 'node:http';
// @ts-expect-error launcher is intentionally a standalone Node script
import {ready, browserCommand, ensureStudio} from '../scripts/open-studio.mjs';
const closers:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closers.splice(0))await close();});
it('loopback readiness ignores a broken environment proxy and does not restart a live service',async()=>{
  const server=http.createServer((_req,res)=>res.end(JSON.stringify({csrf:'local-session'})));
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  closers.push(()=>new Promise<void>(r=>server.close(()=>r())));
  const old=process.env.HTTP_PROXY;process.env.HTTP_PROXY='http://127.0.0.1:1';
  try{
    const url=`http://127.0.0.1:${(server.address() as any).port}/`;
    expect(await ready(url)).toBe(true);
    expect(await ensureStudio({app:'unused',runtime:'unused',url,start:()=>{throw Error('must not start');}})).toBe('already-running');
    expect(await ready('http://example.com/')).toBe(false);
  }finally{if(old===undefined)delete process.env.HTTP_PROXY;else process.env.HTTP_PROXY=old;}
});
it('browser uses a separate local profile without changing global proxy or external model configuration',()=>{
  const command=browserCommand('D:\\Studio\\app','http://127.0.0.1:3178/',{},()=>true);
  expect(command.args).toContain('--no-proxy-server');
  expect(command.args).toContain('--new-window');
  expect(command.args).toContain('http://127.0.0.1:3178/');
  expect(command.args.some((s:string)=>s.startsWith('--app='))).toBe(false);
  expect(command.args.some((s:string)=>s.startsWith('--user-data-dir=')&&s.includes('studio-browser'))).toBe(true);
  expect(()=>browserCommand('D:\\Studio','https://example.com/',{},()=>true)).toThrow('本机');
  expect(()=>browserCommand('D:\\Studio','http://127.0.0.1:3178/',{},()=>false)).toThrow('后台保持运行');
});
