// Built CLI, real read tools, local mock provider. No external model or workflow.
import {afterEach, test} from 'vitest';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chatEnv,describeRun,lastManifest,makeWorkspace,removeWorkspace,runCli} from './helpers/run-cli.js';
import {startMockProvider,scriptedCompletions,type MockCompletion} from './helpers/mock-provider.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()!();});
const batch=(offset=0):MockCompletion=>({kind:'message',toolCalls:Array.from({length:4},(_,i)=>({name:'read_file',arguments:{path:`context-${offset+i}.txt`}}))});
async function run(final:MockCompletion, options:{maxSteps?:number;env?:Record<string,string>;args?:string[]}={}) {
 const provider=await startMockProvider(scriptedCompletions([batch(),batch(4),final]));cleanup.push(provider.close);
 const ws=await makeWorkspace({baseUrl:provider.baseUrl,stream:false,prompt:'Independently review eight context files, then return an explicit verdict.',extraConfig:{roles:{reviewer:'e2e-mock'}}});cleanup.push(()=>removeWorkspace(ws));
 for(let i=0;i<8;i++)await writeFile(join(ws,`context-${i}.txt`),`Context ${i}\n`);
 const result=await runCli({cwd:ws,args:['chat','-q','--role','reviewer','--prompt-file','prompt.md','--max-steps',String(options.maxSteps??8),'--max-seconds','20','--output-format','json',...(options.args??[])],env:chatEnv(ws,{SC_BASE_URL:provider.baseUrl,SC_ROLE_MAX_FIXES:'0',...options.env})});
 for(let i=0;i<8;i++)assert.equal(await readFile(join(ws,`context-${i}.txt`),'utf8'),`Context ${i}\n`);
 return {result,requests:provider.requests.filter(r=>r.url.endsWith('/chat/completions'))};
}
for(const verdict of ['approve','request_changes'])test(`real reviewer completes eight reads with ${verdict}`,async()=>{
 const {result,requests}=await run({kind:'message',content:`Evidence inspected.\nVERDICT: ${verdict}`});
 assert.equal(result.code,10,describeRun(result));assert.equal(requests.length,3);
 const final=requests[2].json as {tools:unknown[];tool_choice:string};assert.deepEqual(final.tools,[]);assert.equal(final.tool_choice,'none');
 const m=lastManifest(result.stdout) as ReturnType<typeof lastManifest>&{review:{verdict:string;explicit:boolean}};
 assert.equal(m.tool_calls_total,8);assert.equal(m.iterations,3);assert.equal(m.review.verdict,verdict);assert.equal(m.review.explicit,true);assert.equal(m.exit_reason,'no_changes');
});
for(const [name,final] of Object.entries({
 extraTool:batch(),empty:{kind:'message',content:''},missing:{kind:'message',content:'Looks good.'},
 embedded:{kind:'message',content:'<tool_call>{"name":"read_file","arguments":{"path":"context-0.txt"}}</tool_call>\nVERDICT: approve'},
 multiple:{kind:'message',content:'VERDICT: request_changes\nVERDICT: approve'},
  nul:{kind:'message',content:'Invalid\0text\nVERDICT: approve'},
  carriageReturn:{kind:'message',content:'Review\r\nVERDICT: approve'},
} satisfies Record<string,MockCompletion>))test(`real reviewer rejects ${name} finalization`,async()=>{
 const {result,requests}=await run(final);assert.equal(result.code,22,describeRun(result));assert.equal(requests.length,3);
 const m=lastManifest(result.stdout) as ReturnType<typeof lastManifest>&{review?:unknown};assert.equal(m.tool_calls_total,8);assert.equal(m.exit_reason,'budget_exceeded');assert.ok(!m.review);
});
test('real reviewer rejects oversized batch before dispatch',async()=>{
 const {result,requests}=await run({kind:'message',content:'VERDICT: approve'},{maxSteps:6});
 assert.equal(result.code,22,describeRun(result));assert.equal(requests.length,2);assert.equal(lastManifest(result.stdout).tool_calls_total,4);
});
test('real reviewer does not add a call beyond the iteration limit',async()=>{
 const {result,requests}=await run({kind:'message',content:'VERDICT: approve'},{env:{SC_MAX_ITERATIONS:'2'}});
 assert.equal(result.code,22,describeRun(result));assert.equal(requests.length,2);assert.equal(lastManifest(result.stdout).tool_calls_total,8);
});
