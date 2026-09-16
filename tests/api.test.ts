import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
test('public integration works without exposing or requiring the server key',async()=>{
 const env:any={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_private'};
 const request=(path:string,options?:RequestInit)=>new Request(`https://folio.test/api${path}`,options);
 assert.equal((await worker.fetch(request('/config'),{} as any)).status,503);
 const config=await worker.fetch(request('/config'),env);
 assert.deepEqual(await config.json(),{url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});
 const publicOnly={SUPABASE_URL:env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:env.SUPABASE_PUBLISHABLE_KEY};
 assert.deepEqual(await (await worker.fetch(request('/config'),publicOnly as any)).json(),{url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});
 assert.deepEqual(await (await worker.fetch(request('/health'),publicOnly as any)).json(),{ok:true,configured:true,serverConfigured:false});
 assert.equal((await worker.fetch(request('/books'),env)).status,401);
 assert.equal((await worker.fetch(request('/books',{method:'POST',headers:{Origin:'https://evil.test'}}),env)).status,403);
});
test('free reading APIs preserve RLS when the server secret is absent',async(t)=>{
 const owner='11111111-1111-4111-8111-111111111111';
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,options?:RequestInit)=>{
  const url=new URL(String(input)),headers=new Headers(options?.headers);
  assert.equal(headers.get('Authorization'),'Bearer valid-token');
  if(url.pathname==='/auth/v1/user')return Response.json({id:owner,email:'reader@example.test',user_metadata:{name:'Reader'},aud:'authenticated'});
  if(url.pathname==='/rest/v1/entitlements')return Response.json(null);
  if(url.pathname==='/rest/v1/voice_usage')return Response.json(null);
  if(url.pathname==='/rest/v1/books')return Response.json([]);
  throw new Error(`Unexpected request: ${url.pathname}`);
 });
 const env:any={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',AI_MONTHLY_CHARACTERS:'100000'};
 const headers={Authorization:'Bearer valid-token'};
 const me=await worker.fetch(new Request('https://folio.test/api/me',{headers}),env);
 assert.equal(me.status,200);assert.equal((await me.json() as any).plan,'free');
 const books=await worker.fetch(new Request('https://folio.test/api/books',{headers}),env);
 assert.equal(books.status,200);assert.deepEqual(await books.json(),[]);
});
test('Worker verifies a direct Storage upload before marking the book ready',async(t)=>{
 const owner='11111111-1111-4111-8111-111111111111',book='33333333-3333-4333-8333-333333333333';let finalized=false;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,options?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.pathname==='/auth/v1/user')return Response.json({id:owner,email:'reader@example.test',user_metadata:{name:'Reader'},aud:'authenticated'});
  if(url.pathname==='/rest/v1/entitlements')return Response.json(null);
  if(url.pathname==='/rest/v1/books'){
   if(options?.method==='PATCH'){finalized=true;return new Response(null,{status:204})}
   return Response.json({id:book,user_id:owner,object_key:`${owner}/${book}.epub`,size:4,ready:false});
  }
  if(url.pathname.startsWith('/storage/v1/object/info/'))return Response.json({size:4,content_type:'application/epub+zip'});
  throw new Error(`Unexpected request: ${url.pathname}`);
 });
 const env:any={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
 const response=await worker.fetch(new Request(`https://folio.test/api/books/${book}/complete`,{method:'POST',headers:{Origin:'https://folio.test',Authorization:'Bearer valid-token'}}),env);
 assert.equal(response.status,200);assert.equal(finalized,true);
});
test('Worker verifies Auth and uses the user token for saving and retrieving reading data',async(t)=>{
 const owner='11111111-1111-4111-8111-111111111111',book='33333333-3333-4333-8333-333333333333';
 let state:unknown={};let verified=0;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,options?:RequestInit)=>{
  const url=new URL(String(input)),headers=new Headers(options?.headers);
  if(url.pathname==='/auth/v1/user'){
   verified++;if(headers.get('Authorization')!=='Bearer valid-token')return Response.json({message:'Invalid token'},{status:401});
   return Response.json({id:owner,email:'reader@example.test',user_metadata:{name:'Reader'},aud:'authenticated'});
  }
  if(url.pathname==='/rest/v1/entitlements')return options?.method==='POST'?new Response(null,{status:201}):Response.json({customer:null,paid_until:0});
  assert.equal(headers.get('Authorization'),'Bearer valid-token','data operations must preserve RLS');
  if(url.pathname==='/rest/v1/books')return Response.json({id:book,user_id:owner,object_key:`${owner}/${book}.epub`,size:4,ready:true});
  if(url.pathname==='/rest/v1/reading_state'){
   if(options?.method==='POST'){const saved=JSON.parse(String(options.body));assert.equal(saved.user_id,owner);assert.equal(saved.book_id,book);state=saved.data;return new Response(null,{status:201})}
   return Response.json({data:state});
  }
  throw new Error(`Unexpected request: ${url.pathname}`);
 });
 const env:any={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_private'};
 const call=(method:string,data?:unknown,token='valid-token')=>worker.fetch(new Request(`https://folio.test/api/books/${book}/state`,{method,headers:{Origin:'https://folio.test',Authorization:`Bearer ${token}`},body:data?JSON.stringify(data):undefined}),env);
 const saved={chapter:4,marks:[1,3],notes:[{text:'Remember this'}]};
 assert.equal((await call('PUT',saved)).status,200);
 assert.deepEqual(await (await call('GET')).json(),saved);
 assert.equal((await call('GET',undefined,'invalid-token')).status,401);
 assert.equal(verified,3);
});
