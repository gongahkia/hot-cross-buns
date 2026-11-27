import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { embeddingBlocked, localAppStatus } from '../local-app-status.mjs';

const parent='http://127.0.0.1:4317',target='http://127.0.0.1:3000/';
const discover=async options=>{assert.deepEqual(options,{fresh:true});return {servers:[{port:3000,process:'node'}]};};

test('embedding checks respect enforced ancestor policies, multiple policies and X-Frame-Options',()=>{
  for(const headers of [
    {'content-security-policy':"frame-ancestors 'none'"},
    {'content-security-policy':"frame-ancestors 'self'"},
    {'content-security-policy':"frame-ancestors http://localhost:4317"},
    {'content-security-policy':"frame-ancestors *; default-src 'self', frame-ancestors 'none'"},
    {'x-frame-options':'DENY'}, {'x-frame-options':'SAMEORIGIN'},
  ])assert.equal(embeddingBlocked(new Headers(headers),target,parent),true,JSON.stringify(headers));
  for(const headers of [
    {},{'content-security-policy':"default-src 'self'"},
    {'content-security-policy':"frame-ancestors http://127.0.0.1:4317"},
    {'content-security-policy':"frame-ancestors http://127.0.0.1:*"},
    {'content-security-policy':"frame-ancestors *://127.0.0.1:*"},
    {'content-security-policy':"frame-ancestors *",'x-frame-options':'DENY'},
    {'content-security-policy-report-only':"frame-ancestors 'none'"},
  ])assert.equal(embeddingBlocked(new Headers(headers),target,parent),false,JSON.stringify(headers));
  assert.equal(embeddingBlocked(new Headers({'x-frame-options':'SAMEORIGIN'}),parent,parent),false);
});

test('preview admission rejects unrelated, remote, internal and stopped servers before making a request',async()=>{
  let calls=0;
  const fetcher=()=>{calls++;throw Error('must not contact');};
  for(const value of ['https://example.com','http://127.0.0.1:4317/','http://localhost:4317/','http://user:secret@localhost:3000/'])await assert.rejects(localAppStatus(value,parent,discover,fetcher));
  for(const servers of [[],[{port:3000,internal:true}],[{port:3000,application:'HCB'}],[{port:3000,process:'hot-cross-buns-runtime'}]]) {
    const result=await localAppStatus(target,parent,async()=>({servers}),fetcher);
    assert.equal(result.state,'unavailable');assert.match(result.message,/under HCB/);
  }
  assert.equal(calls,0);
});

test('preview requests are bounded header-only checks and do not follow redirects or send credentials',async()=>{
  const ready=await localAppStatus(target,parent,discover,async(url,options)=>{
    assert.equal(url,target);assert.equal(options.method,'HEAD');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.ok(options.signal instanceof AbortSignal);
    return new Response(null,{status:200});
  });assert.deepEqual(ready,{state:'ready'});
  const redirect=await localAppStatus(target,parent,discover,async()=>new Response(null,{status:302,headers:{location:'https://example.com'}}));
  assert.equal(redirect.state,'external');assert.match(redirect.message,/redirects/);
  const refused=await localAppStatus(target,parent,discover,async()=>{throw Error('private network diagnostics');});
  assert.equal(refused.state,'unavailable');assert.doesNotMatch(refused.message,/private/);
});

test('real HTTP responses distinguish embeddable, blocked, missing and stopped local apps',async t=>{
  let method;
  const app=createServer((request,response)=>{
    method=request.method;
    if(request.url==='/blocked')response.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
    response.writeHead(request.url==='/missing'?404:200,{'Content-Type':'text/html'});response.end('<h1>App fixture</h1>');
  });
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.close());
  const port=app.address().port,url='http://127.0.0.1:'+port;
  const owned=async()=>({servers:[{port,process:'node'}]});
  assert.equal((await localAppStatus(url,parent,owned)).state,'ready');assert.equal(method,'HEAD');
  const blocked=await localAppStatus(url+'/blocked',parent,owned);assert.equal(blocked.state,'external');assert.match(blocked.message,/blocks embedded/);
  const missing=await localAppStatus(url+'/missing',parent,owned);assert.equal(missing.state,'unavailable');assert.match(missing.message,/HTTP 404/);
  await new Promise(resolve=>app.close(resolve));
  assert.equal((await localAppStatus(url,parent,owned)).state,'unavailable');
});
