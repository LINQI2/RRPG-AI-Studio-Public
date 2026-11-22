import {it,expect,afterEach} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {configuration,appRoot} from '../src/server/config.js';
import {rulesRoot,baseRule,leadRule,ruleHash,rulesView,saveSupplement} from '../src/server/rules.js';
import {Store} from '../src/server/db.js';
import {Studio} from '../src/server/studio.js';
import {Transport} from '../src/server/codex/transport.js';
import {webServer} from '../src/server/http.js';
const close:Array<()=>any>=[];
afterEach(async()=>{for(const f of close.splice(0).reverse())await f();});
function setup(){
  const runtime=fs.mkdtempSync(path.join(appRoot,'runtime/rules-test-'));
  const cfg={...configuration(),runtime,rulesRoot:path.join(runtime,'rules'),home:path.join(runtime,'home'),project:path.join(runtime,'project'),inbox:path.join(runtime,'inbox')};
  for(const p of [cfg.home,cfg.project,cfg.inbox])fs.mkdirSync(p,{recursive:true});
  fs.cpSync(rulesRoot,cfg.rulesRoot,{recursive:true});
  const db=new Store(path.join(runtime,'test.sqlite'));close.push(()=>db.close());return {cfg,db};
}
it('file-backed roles retain the complete technical and safety contract; extra preferences remain separate',()=>{
  expect(baseRule('developer')).toContain('你对技术交付负责');
  expect(baseRule('developer')).not.toContain('studio:dsh:v1:');
  expect(leadRule('developer')).toContain('studio:dsh:v1:');
  expect(leadRule('developer')).toContain('read-only / never');
  expect(baseRule('planner')).toContain('你对游戏设计质量负责');
  expect(baseRule('planner')).not.toContain('studio_request_decision');
  expect(leadRule('planner')).toContain('studio_request_decision');
  expect(baseRule('dsh')).toContain('禁止全局SaveAssets/SaveChanges');
  expect(()=>leadRule('../auth')).toThrow('仅支持');
  const {cfg,db}=setup();const before=rulesView(db,cfg).roles[1];
  saveSupplement(db,cfg,'developer','先汇报成果，再列问题。',before.revision);
  expect(leadRule('developer',cfg.rulesRoot)).toContain('先汇报成果，再列问题');
  expect(baseRule('developer',cfg.rulesRoot)).toBe(before.baseText);
  expect(rulesView(db,cfg).roles[1].applicationStatus).toContain('待后续');
  expect(db.all('messages')).toHaveLength(0);
  expect(fs.readdirSync(path.join(cfg.runtime,'rule-backups'))).toHaveLength(1);
  expect(db.db.prepare("SELECT type FROM events WHERE type='rules.supplement_saved'").all()).toHaveLength(1);
});
it('conflict, unauthorized roles, oversized text and null bytes cannot overwrite rules',()=>{
  const {cfg,db}=setup();const row=rulesView(db,cfg).roles[0];
  saveSupplement(db,cfg,'planner','新要求',row.revision);
  expect(()=>saveSupplement(db,cfg,'planner','旧页面覆盖',row.revision)).toThrow('未覆盖');
  expect(()=>saveSupplement(db,cfg,'dsh','更改权限',row.revision)).toThrow('仅支持');
  expect(()=>saveSupplement(db,cfg,'planner','x'.repeat(8001),row.revision)).toThrow('8000');
  expect(()=>saveSupplement(db,cfg,'planner','bad\0text',row.revision)).toThrow('空字符');
  expect(fs.readFileSync(path.join(cfg.rulesRoot,'preferences/planner.md'),'utf8')).toBe('新要求');
  const view=rulesView(db,cfg);expect(view.skills[0].loaded).toBe(false);expect(view.skills[0].content).toContain('尚无自动注册');
});
it('empty or invalid base rules fail closed and a newer restore hash takes precedence over an older turn',()=>{
  const {cfg,db}=setup(),source=path.join(cfg.rulesRoot,'roles/planner.md');
  const hash=ruleHash(leadRule('planner',cfg.rulesRoot));
  db.create('agents',{id:'planner',instructionContentHash:hash,instructionAppliedAt:'2026-10-25T02:00:00Z',lastTurnRuleHash:'older',lastTurnRuleAt:'2026-10-25T01:00:00Z'});
  expect(rulesView(db,cfg).roles[0].appliedHash).toBe(hash);
  fs.writeFileSync(source,'  ');expect(()=>leadRule('planner',cfg.rulesRoot)).toThrow('不能为空');
  fs.writeFileSync(source,Buffer.from([255]));expect(()=>leadRule('planner',cfg.rulesRoot)).toThrow('UTF-8');
});
it('rules save is session/CSRF protected and does not start or alter an active native turn',async()=>{
  const {cfg,db}=setup();const rpc=new Transport(process.execPath,[path.join(appRoot,'tests/fake-server.mjs')],cfg.runtime,{...process.env,FAKE_STATE:path.join(cfg.runtime,'fake.json')},1000);
  close.push(()=>rpc.stop());const studio=new Studio(db,rpc,cfg);await studio.connect();await studio.initialize();
  expect(rulesView(db,cfg).roles[0].appliedHash).toBe(ruleHash(leadRule('planner',cfg.rulesRoot)));
  const app=await webServer(studio);close.push(()=>app.close());
  expect((await app.inject({url:'/api/rules',headers:{host:'127.0.0.1'}})).statusCode).toBe(401);
  const session=await app.inject({url:'/api/session',headers:{host:'127.0.0.1'}});
  const cookie=session.headers['set-cookie']!.toString().split(';')[0];
  const headers={host:'127.0.0.1',cookie,'content-type':'application/json','x-studio-csrf':session.json().csrf};
  const view=(await app.inject({url:'/api/rules',headers})).json();const before=studio.agent('developer');
  db.update('agents','developer',{status:'active',activeTurnId:'untouched-turn'});
  const payload={content:'请以简明中文汇报。',expectedRevision:view.roles[1].revision};
  expect((await app.inject({method:'PUT',url:'/api/rules/developer',headers:{...headers,'x-studio-csrf':'bad'},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'PUT',url:'/api/rules/developer',headers,payload})).statusCode).toBe(200);
  expect(studio.agent('developer')).toMatchObject({threadId:before.threadId,activeTurnId:'untouched-turn',status:'active'});
  expect(db.all('messages')).toHaveLength(0);
  expect((await app.inject({method:'PUT',url:'/api/rules/developer',headers,payload:{...payload,content:'覆盖'}})).statusCode).toBe(409);
  db.update('agents','developer',{status:'idle',activeTurnId:null});
  const calls:any[]=[];const original=rpc.call.bind(rpc);rpc.call=async(method,p,...rest)=>{if(method==='turn/start')calls.push(p);return original(method,p,...rest);};
  studio.submit({recipient:'developer',content:'协议模拟检查',clientRequestId:'rules-turn-context'});
  for(let i=0;i<80&&!calls.length;i++)await new Promise(r=>setTimeout(r,20));
  expect(calls[0].additionalContext['rrpg-studio-role'].value).toContain('请以简明中文汇报');
  expect(calls[0].sandboxPolicy).toEqual({type:'readOnly'});expect(calls[0].approvalPolicy).toBe('never');
  expect(studio.agent('developer').lastTurnRuleHash).toBe(ruleHash(leadRule('developer',cfg.rulesRoot)));
  for(let i=0;i<100&&studio.agent('developer').status!=='idle';i++)await new Promise(r=>setTimeout(r,20));
  fs.writeFileSync(path.join(cfg.rulesRoot,'roles/developer.md'),'');
  const message=studio.submit({recipient:'developer',content:'规则损坏不得启动',clientRequestId:'invalid-rules-no-model'});
  for(let i=0;i<100&&db.get('messages',message.id)?.delivery!=='failed';i++)await new Promise(r=>setTimeout(r,20));
  expect(calls).toHaveLength(1);
  expect(db.get('messages',message.id)?.delivery).toBe('failed');
  expect(studio.agent('developer').status).toBe('idle');
});

it('developer protocol is loaded separately and missing protocol prevents dispatch context',()=>{
 const {cfg,db}=setup();const v=rulesView(db,cfg).roles.find(r=>r.id==='developer')!;
 expect(v.baseText).not.toContain('studio:dsh:v1:');expect(v.protocolText).toContain('studio:dsh:v1:');
 fs.writeFileSync(path.join(cfg.rulesRoot,'protocols/developer.md'),'');expect(()=>leadRule('developer',cfg.rulesRoot)).toThrow('协议不能为空');
 fs.unlinkSync(path.join(cfg.rulesRoot,'protocols/developer.md'));expect(()=>leadRule('developer',cfg.rulesRoot)).toThrow();
});

it('planner protocol is required and included in effective rule hash',()=>{
 const {cfg,db}=setup();const before=rulesView(db,cfg).roles[0];
 expect(before.baseText).toContain('游戏设计质量');expect(before.protocolText).toContain('read-only / never');
 const file=path.join(cfg.rulesRoot,'protocols/planner.md');fs.appendFileSync(file,'\n协议变更核验');
 expect(rulesView(db,cfg).roles[0].effectiveHash).not.toBe(before.effectiveHash);
 expect(leadRule('planner',cfg.rulesRoot)).toContain('协议变更核验');
 fs.writeFileSync(file,'');expect(()=>leadRule('planner',cfg.rulesRoot)).toThrow('协议不能为空');
 fs.unlinkSync(file);expect(()=>leadRule('planner',cfg.rulesRoot)).toThrow();
});
