import { helper } from './native.mjs';

const fields=new Set(['action','revision','endpoint','folder_id','api_key','key','choice']);
export async function memorySync(host,request) {
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!fields.has(key))||!['status','configure','enable','disable','run','resolve'].includes(request.action))throw new Error('Choose a memory sync action.');
  if(Object.values(request).some(value=>typeof value!=='string')||JSON.stringify(request).length>24000)throw new Error('Check the memory sync settings.');
  const bytes=await helper(host.binary,['memory','sync','request'],{input:JSON.stringify(request),maxBytes:2*1024*1024,signal:AbortSignal.timeout(30000),cwd:host.workspace,env:{...host.env,HOT_CROSS_BUNS_INTERNAL_COMMANDS:'1',HOT_CROSS_BUNS_STATE_DIR:host.backendStateRoot}});
  return JSON.parse(bytes.toString('utf8'));
}
