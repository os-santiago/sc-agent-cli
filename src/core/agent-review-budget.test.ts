import {afterEach, test, vi} from 'vitest';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Agent} from './agent.js';
import {phasePolicy, resolveRole, resolveRolePipeline, runRolePipeline} from './roles.js';

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const p of directories.splice(0)) rmSync(p, {recursive:true, force:true}); });
function fixture(maxSteps=8) {
  const workspaceRoot=mkdtempSync(join(tmpdir(),'review-budget-')); directories.push(workspaceRoot);
  writeFileSync(join(workspaceRoot,'context.txt'),'Independent review fixture.\n');
  return new Agent({workspaceRoot, maxSteps, quiet:true, autoApprove:true,
    config:{model:{provider:'openai-compatible',baseUrl:'http://test.api/v1',model:'fixture',stream:false},roles:{reviewer:'fixture'}}});
}
function reads(n=4) { return {content:'',tool_calls:Array.from({length:n},(_,i)=>({id:`r${i}`,type:'function' as const,function:{name:'read_file',arguments:'{"path":"context.txt"}'}}))}; }
function review(agent:Agent, signal?:AbortSignal) { return agent.run('Review the fixture.',[],signal,{routing:resolveRole(agent.options.config,'reviewer'),...phasePolicy('reviewer')}); }

for (const verdict of ['approve','request_changes']) test(`eight reads permit one new explicit ${verdict} without tools`,async()=>{
  const a=fixture(); let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async options=>{
    calls++; if(calls<3) return reads();
    assert.deepEqual(options.tools,[]);assert.equal(options.tool_choice,'none');
    return {content:`Inspected the available evidence.\nVERDICT: ${verdict}`};
  });
  const result=await runRolePipeline(a,resolveRolePipeline(a.options.config,'reviewer'),'Review fixture.');
  assert.equal(calls,3);assert.equal(a.getStats().toolRunCount,8);assert.equal(a.getStats().budgetExceeded,null);
  assert.equal(result.decision?.verdict,verdict);assert.equal(result.decision?.explicit,true);
});

for (const [name,response] of Object.entries({
  extraTool:reads(1),empty:{content:''},missing:{content:'Looks good.'},
  ambiguous:{content:'VERDICT: request_changes\nVERDICT: approve'},
  quoted:{content:'```\nVERDICT: approve\n```'},
  nul:{content:'Invalid\0text\nVERDICT: approve'},carriageReturn:{content:'Review\r\nVERDICT: approve'},
  embedded:{content:'<tool_call>{"name":"read_file","arguments":{"path":"context.txt"}}</tool_call>\nVERDICT: approve'},
})) test(`finalization rejects ${name} without another tool or request`,async()=>{
  const a=fixture();let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async()=> ++calls<3?reads():response);
  const r=await runRolePipeline(a,resolveRolePipeline(a.options.config,'reviewer'),'Review fixture.');
  assert.equal(calls,3);assert.equal(a.getStats().toolRunCount,8);assert.equal(a.getStats().budgetExceeded,'steps');assert.equal(r.decision,null);
});

test('an oversized reviewer batch dispatches none of that batch',async()=>{
  const a=fixture(6);let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async()=>{calls++;return reads();});
  await review(a);assert.equal(calls,2);assert.equal(a.getStats().toolRunCount,4);assert.equal(a.getStats().budgetExceeded,'steps');
});

test('model iteration cap leaves no opportunity to reuse an earlier verdict',async()=>{
  vi.stubEnv('SC_MAX_ITERATIONS','2');const a=fixture();let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async()=>{calls++;return {...reads(),content:'VERDICT: approve'};});
  const r=await runRolePipeline(a,resolveRolePipeline(a.options.config,'reviewer'),'Review fixture.');
  assert.equal(calls,2);assert.equal(a.getStats().budgetExceeded,'steps');assert.equal(r.decision,null);
});

for (const duringFinal of [false,true]) test(`cancellation ${duringFinal?'during':'before'} finalization cannot complete a review`,async()=>{
  const a=fixture();const controller=new AbortController();let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async()=>{
    calls++;if(calls===(duringFinal?3:2))controller.abort();
    return calls<3?reads():{content:'VERDICT: approve'};
  });
  await review(a,controller.signal);assert.equal(calls,duringFinal?3:2);assert.equal(a.getStats().toolRunCount,8);assert.equal(a.getStats().budgetExceeded,'steps');
});

for (const dimension of ['seconds','tokens'] as const) for (const duringFinal of [false,true]) test(`${dimension} limit ${duringFinal?'during':'before'} finalization wins over the tool limit`,async()=>{
  const a=fixture();let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
  if(dimension==='seconds')a.options.maxSeconds=10;else a.options.maxTotalTokens=1_000_000;
  let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async()=>{
    calls++;if(calls===(duringFinal?3:2)){if(dimension==='seconds')now+=11000;else a.tokenTracker.addInput(1_000_001);}
    return calls<3?reads():{content:'VERDICT: approve'};
  });
  const r=await runRolePipeline(a,resolveRolePipeline(a.options.config,'reviewer'),'Review fixture.');
  assert.equal(calls,duringFinal?3:2);assert.equal(a.getStats().toolRunCount,8);assert.equal(a.getStats().budgetExceeded,dimension);assert.equal(r.decision,null);
});

test('planner keeps stop-before-next-call behavior',async()=>{
  const a=fixture(4);let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async()=>{calls++;return reads();});
  await a.run('Plan.',[],undefined,{routing:resolveRole(a.options.config,'planner'),...phasePolicy('planner')});
  assert.equal(calls,1);assert.equal(a.getStats().budgetExceeded,'steps');
});

test('a new reviewer phase cannot finalize a budget spent by another phase',async()=>{
  const a=fixture(4);let calls=0;
  vi.spyOn(a.provider,'chatCompletion').mockImplementation(async()=>{calls++;return reads();});
  await a.run('Plan.',[],undefined,{routing:resolveRole(a.options.config,'planner'),...phasePolicy('planner')});
  await review(a);assert.equal(calls,1);assert.equal(a.getStats().budgetExceeded,'steps');
});
