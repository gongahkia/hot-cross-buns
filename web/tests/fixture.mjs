import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from 'node:crypto';
import { startWeb } from "../server.mjs";

export async function fixture({ inlineWork = false, modelWindows, contextWindow=262144, startScheduler = false, introductionReplies = false, schedulingTask = false, introductionStatus = "", voiceOptions, memories = [], chatCount = 0, dialogueCount = 0, runtimePath, draftsEnabled = true, designateMain = true, startInSide = false, conversationalReplies = false, planningQuestions = false, filesystemTask = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "hcb-web-"));
  const workspace = join(root, "workspace");
  const payloads = [];
  let release, blocked = false, afterTool = false;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks).toString());
    payloads.push(value);
    const system = value.messages.filter(item => item.role === "system").map(item => item.content).join("\n");
    const prompt = JSON.stringify(value.messages.filter(item => item.role === "user"));
    const tool = value.tools?.some(item => item.function?.name === "web_access");
    const review = tool && prompt.includes("fixture approval") && !value.messages.some(item => item.role === "tool");
    const classification = system.includes("Classify the user's immediate request");
    let routed;
    try { routed = JSON.parse(value.messages.findLast(item => item.role === 'user').content); } catch {}
    const decision = system.includes("conversation") && system.includes("reply") && !value.tools?.length && routed?.can_start_task !== undefined;
    const correctionTarget = routed?.message?.includes('This is a correction request for review') && routed.tasks?.find(task => task.can_correct_action);
    const planTarget = planningQuestions && routed?.message?.includes('This is a correction request for review') && routed.tasks?.find(task => task.can_revise_plan);
    const proposal = planningQuestions && system.includes("Propose a plan for the user's task");
    const plan = {outcome:'A parser using the chosen format',steps:[{id:'inspect',text:'Inspect the parser after review'}],sources:[],effects:['read'],...(!routed?.correction ? {questions:[{id:'format',question:'Which format should the parser support?',options:['JSON','YAML']}]} : {})};
    const read = value.tools?.some(item => item.function?.name === "read_file") && prompt.includes("fixture activity") && !value.messages.some(item => item.role === "tool");
    const fileRead = filesystemTask && value.tools?.some(tool => tool.function?.name === "filesystem") && !value.messages.some(item => item.role === "tool");
    const scheduleTool=schedulingTask&&value.tools?.some(item=>item.function?.name==='hot_cross_buns_app_update');
    const inspectedSchedules=value.messages.some(item=>item.role==='tool'&&item.content.includes('"management_permission"'));
    const changedSchedule=value.messages.some(item=>item.role==='tool'&&item.content.includes('"setting":"schedule"'));
    const scheduleMessage=scheduleTool&&!changedSchedule?{role:'assistant',tool_calls:[{id:inspectedSchedules?'create-schedule':'inspect-schedules',type:'function',function:{name:inspectedSchedules?'hot_cross_buns_app_update':'hot_cross_buns_app_inspect',arguments:JSON.stringify(inspectedSchedules?{setting:'schedule',value:{action:'create',title:'Fixture scheduled reminder',prompt:'Remind me to inspect the garden.',...(schedulingTask==='event'?{trigger:{types:['issue'],match:{repository:'fixture'}}}:{run_at:new Date(Math.floor(Date.now()/60000)*60000+3600000).toISOString().replace('.000Z','Z')}),timezone:'Asia/Singapore'}}:{topic:'schedules'})}}]}:undefined;
    const introductionResponse=introductionReplies && system.includes('one-time onboarding conversation') ? routed.message.includes('Alice') ? {kind:'reply',reply:'Nice to meet you, Alice. How would you like me to reply?'} : routed.message.includes('skip') ? {kind:'skip'} : {kind:'propose',answers:{'profile.name':'My name is Alice.','preference.tone':'Casual and concise','profile.projects':'A garden project'}} : undefined;
    const message = scheduleMessage ? scheduleMessage : introductionResponse ? {role:"assistant",content:JSON.stringify(introductionResponse)} : fileRead ? {role:"assistant",tool_calls:[{id:"live-file",type:"function",function:{name:"filesystem",arguments:JSON.stringify({operation:"read",path:join(workspace,"note.md")})}}]} : review ? {
      role: "assistant", tool_calls: [{ id: "exact-local-review", type: "function", function: {
        name: "web_access", arguments: JSON.stringify({ action: "request", scope: "sites", origins: [prompt.includes('Use a different site.') ? 'https://corrected.invalid' : "https://example.invalid"], reason: "Review this fixture request." }),
      } }],
    } : read ? {
      role: "assistant", content: "I’ll read the note first.",
      tool_calls: [{ id: "read-fixture", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "source/note.md", display_icon: 'book-open' }) } }],
    } : { role: "assistant", content: proposal ? JSON.stringify(plan) : classification ? '{"mode":"inspect"}' : planTarget ? JSON.stringify({kind:'revise_plan',target:planTarget.id,instruction:routed.message}) : correctionTarget ? JSON.stringify({ kind: 'revise_action', target: correctionTarget.id, instruction: 'Use a different site.' }) : decision ? conversationalReplies && !routed.message.includes('fixture activity') ? JSON.stringify({kind:'reply',text:'A continuing conversation.'}) : JSON.stringify({kind:planningQuestions ? 'plan' : inlineWork ? 'work' : 'task'}) : "## Fixture answer\n\nThe message reached the running Go backend." };
    if ((blocked && !classification && !review && !decision) || afterTool && value.messages.some(item => item.role === "tool")) await new Promise(resolve => { release = resolve; });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls?.length ? "tool_calls" : "stop" }] }));
  });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "note.md"), "Private fixture note content must stay out of the public activity trace.");
  const config = join(root, "config");
  await mkdir(join(config, "hot-cross-buns"), { recursive: true });
  await writeFile(join(config, "hot-cross-buns", "config.json"), JSON.stringify({
    version: 4, defaults: { provider: "fixture", model: "fixture" },
    context_windows: {"fixture:fixture":contextWindow,...Object.fromEntries(Object.entries(modelWindows||{}).map(([name,window])=>["fixture:"+name,window]))},
    ...(introductionStatus?{desktop:{introduction:introductionStatus}}:{}),
    custom_providers: [{ id: "fixture", default_model: "fixture", models: ["fixture",...Object.keys(modelWindows||{}).filter(name=>name!=="fixture")], base_url: "http://127.0.0.1:" + provider.address().port + "/chat" }],
  }));
  const binary = process.env.HOT_CROSS_BUNS_WEB_BINARY || fileURLToPath(new URL(
    "../../runtime/hot-cross-buns-runtime" + (process.platform === "win32" ? ".exe" : ""), import.meta.url));
  const env = { ...process.env, ...(runtimePath ? { PATH: runtimePath + ":" + process.env.PATH } : {}), XDG_CACHE_HOME: join(root, "cache"), HOT_CROSS_BUNS_INTERNAL_COMMANDS: "1", HOT_CROSS_BUNS_CONFIG_DIR: config, HOT_CROSS_BUNS_STATE_DIR: join(root, "state") };
  const draftFile = join(root, 'app', 'drafts', createHash('sha256').update(env.HOT_CROSS_BUNS_STATE_DIR).digest('hex') + '.json');
  if (!draftsEnabled) {
    await mkdir(join(root, 'app', 'drafts'), {recursive:true});
    await writeFile(draftFile, JSON.stringify({version:1,enabled:false,drafts:[]}));
  }
  const seededChats = [];
  for (let i = 0; i < chatCount; i++) {
    const id = 'work-fixture-' + String(i).padStart(3, '0'), at = new Date(Date.now() - (i + 1) * 60000).toISOString();
    const directory = join(root, 'state', 'hot-cross-buns', 'conversations', id);
    await mkdir(join(directory, 'revisions'), { recursive: true, mode: 0o700 });
    const record = { version: 2, id, title: 'Retained chat ' + i, source_path: workspace, snapshot_id: '', created_at: at, updated_at: at };
    await writeFile(join(directory, 'conversation.json'), JSON.stringify(record), { mode: 0o600 });
    seededChats.push(record);
    if (i === 0 && dialogueCount) {
      await mkdir(join(directory, 'dialogue'), { recursive: true, mode: 0o700 });
      for (let n = 1; n <= dialogueCount; n++) {
        const client = 'fixture-dialogue-' + n, turnID = createHash('sha256').update(client).digest('hex');
        const reaction = n === dialogueCount, response = reaction ? "You're welcome." : 'A quiet note ' + n + '.\n\n' + 'There is a little room for reading and thinking. '.repeat(12);
        const turn = { version: 1, revision: 3, sequence: n, id: turnID, client_id: client, conversation_id: id,
          text: reaction ? 'Thanks!' : 'A thought for the day ' + n, options: { version: 1, source: workspace, run_options: {} }, state: 'answered',
          decision: { kind: 'reply', text: response, ...(reaction ? { reaction: 'appreciation' } : {}) }, response, created_at: at, updated_at: at };
        await writeFile(join(directory, 'dialogue', String(n).padStart(20, '0') + '-' + turnID + '.json'), JSON.stringify(turn), { mode: 0o600 });
      }
    }
  }
  if (designateMain && seededChats.length) await writeFile(join(root,'state','hot-cross-buns','conversations','primary.json'),JSON.stringify({version:1,conversation_id:seededChats[0].id}),{mode:0o600});
  for (const text of memories) await promisify(execFile)(binary, ["memory", "add", "--kind", "preference", text], { env, timeout: 5000 });
  let app;
  const appOptions={binary,workspace,userData:join(root,'app'),env,startScheduler};
  try {
    app = await startWeb(appOptions, 0, voiceOptions);
    if (startInSide) {
      const abort=new AbortController();
      try {
        const response=await fetch(app.url+'/api/events',{signal:abort.signal}),reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer='';
        while(!buffer.includes('\n\n')){const part=await reader.read();if(part.done)throw Error('Fixture startup ended');buffer+=part.value;}
        const current=JSON.parse(buffer.slice(6,buffer.indexOf('\n\n')));
        const opened=await fetch(app.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:app.url},body:JSON.stringify({op:'navigate',context:current.context,route:'/new'})});
        if(!opened.ok)throw Error('Could not open the fixture side chat');
      }finally{abort.abort();}
    }
  } catch (error) {
    provider.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    get url() {return app.url;}, payloads, seededChats, draftFile, historyCache: join(env.HOT_CROSS_BUNS_STATE_DIR, 'hot-cross-buns/cache/conversations-v1.sqlite'),
    async restart() { await app.close(); app=await startWeb(appOptions,0,voiceOptions); },
    block() { blocked = true; },
    blockAfterTool() { afterTool = true; },
    release() { blocked = false; afterTool = false; release?.(); },
    async close() {
      this.release();
      try { await app.close(); }
      finally {
        await new Promise(resolve => provider.close(resolve));
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}
