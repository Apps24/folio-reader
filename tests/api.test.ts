import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
test('unconfigured API is explicit and public config excludes the server key',async()=>{
 const env:any={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_private'};
 const request=(path:string,options?:RequestInit)=>new Request(`https://folio.test/api${path}`,options);
 assert.equal((await worker.fetch(request('/config'),{} as any)).status,503);
 const config=await worker.fetch(request('/config'),env);
 assert.deepEqual(await config.json(),{url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});
 assert.equal((await worker.fetch(request('/books'),env)).status,401);
 assert.equal((await worker.fetch(request('/books',{method:'POST',headers:{Origin:'https://evil.test'}}),env)).status,403);
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
