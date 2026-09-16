import {isPaid,monthKey,verifyWebhook} from './security.ts';
import {createClient} from '@supabase/supabase-js';
interface Env { SUPABASE_URL:string; SUPABASE_PUBLISHABLE_KEY:string; SUPABASE_SECRET_KEY?:string; ASSETS:Fetcher; AI:Ai; VOICE_LIMIT:RateLimit; AI_MONTHLY_CHARACTERS:string; STRIPE_SECRET_KEY?:string; STRIPE_PRICE_ID?:string; STRIPE_WEBHOOK_SECRET?:string; APP_ORIGIN?:string }
type User={id:string;name:string;email:string;customer:string|null;paid_until:number;};
const json=(data:unknown,status=200,headers:HeadersInit={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const err=(message:string,status=400)=>json({error:message},status);
function client(env:Env, jwt?:string) {const key=jwt?env.SUPABASE_PUBLISHABLE_KEY:env.SUPABASE_SECRET_KEY;if(!key)throw new Error('Server integration is not configured');return createClient(env.SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},...(jwt?{global:{headers:{Authorization:`Bearer ${jwt}`}}}:{})});}
async function checked<T>(query:PromiseLike<{data:T;error:unknown}>):Promise<T>{const {data,error}=await query;if(error)throw error;return data}
async function bytes(r:Request,max:number){const reader=r.body?.getReader();if(!reader)throw new Error('Empty body');const chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('Request is too large')}chunks.push(value)}const all=new Uint8Array(size);let at=0;for(const c of chunks){all.set(c,at);at+=c.length}return all}
async function body(r:Request,max=20000){return JSON.parse(new TextDecoder().decode(await bytes(r,max)))}
async function stripe(env:Env,path:string,form?:URLSearchParams){if(!env.STRIPE_SECRET_KEY)throw new Error('Billing is not configured');const r=await fetch(`https://api.stripe.com/v1/${path}`,{method:form?'POST':'GET',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:form});const d=await r.json() as any;if(!r.ok)throw new Error('Billing provider request failed');return d}
async function webhook(r:Request,env:Env){
  if(!env.STRIPE_WEBHOOK_SECRET||!env.STRIPE_PRICE_ID)return err('Billing is not configured',503);
  const raw=new TextDecoder().decode(await bytes(r,200000));
  if(!verifyWebhook(raw,r.headers.get('stripe-signature')||'',env.STRIPE_WEBHOOK_SECRET))return err('Invalid webhook signature',400);
  const event=JSON.parse(raw);const customer=event.data?.object?.customer;
  if(!['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','checkout.session.completed'].includes(event.type)||typeof customer!=='string')return json({received:true});
  const owner=await checked(client(env).from('entitlements').select('user_id').eq('customer',customer).maybeSingle());if(!owner)return json({received:true});
  // Read the provider's current state, so reordered/duplicate events cannot reactivate old entitlements.
  const subscriptions=await stripe(env,`subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=100`);
  const expiry=Math.max(0,...subscriptions.data.filter((s:any)=>['active','trialing'].includes(s.status)).flatMap((s:any)=>s.items.data.filter((i:any)=>i.price.id===env.STRIPE_PRICE_ID).map((i:any)=>Number(i.current_period_end??s.current_period_end??0))));
  await checked(client(env).from('entitlements').update({paid_until:expiry}).eq('customer',customer));return json({received:true});
}
async function api(r:Request,env:Env):Promise<Response>{
  const url=new URL(r.url),path=url.pathname;
  const publicConfigured=!!(env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY),serverConfigured=!!env.SUPABASE_SECRET_KEY;
  if(path==='/api/health')return json({ok:true,configured:publicConfigured,serverConfigured});
  if(!publicConfigured)return err('Supabase connection is not configured yet.',503);
  if(path==='/api/config'&&r.method==='GET')return json({url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});
  if(path==='/api/billing/webhook'&&r.method==='POST')return serverConfigured?webhook(r,env):err('Billing is not configured',503);
  if(!['GET','HEAD'].includes(r.method)&&r.headers.get('Origin')!==url.origin)return err('Origin not allowed',403);
  const jwt=r.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!jwt)return err('Please sign in.',401);
  const db=client(env,jwt),admin=serverConfigured?client(env):null;
  const {data:identity,error:authError}=await db.auth.getUser(jwt);
  if(authError||!identity.user)return err('Please sign in again.',401);
  const id=identity.user.id;
  if(admin)await checked(admin.from('entitlements').upsert({user_id:id},{onConflict:'user_id',ignoreDuplicates:true}));
  const entitlement=await checked(db.from('entitlements').select('customer,paid_until').eq('user_id',id).maybeSingle());
  const user:User={id,name:String(identity.user.user_metadata?.name||'Reader').slice(0,80),email:identity.user.email||'',customer:entitlement?.customer??null,paid_until:Number(entitlement?.paid_until)||0};
  if(path==='/api/me'&&r.method==='GET'){
    const used=await checked(db.from('voice_usage').select('characters').eq('user_id',user.id).eq('month',monthKey()).maybeSingle());
    return json({id:user.id,name:user.name,email:user.email,plan:isPaid(user)?'paid':'free',paidUntil:user.paid_until,voiceUsed:used?.characters||0,voiceLimit:Number(env.AI_MONTHLY_CHARACTERS)||100000,billingReady:!!(env.STRIPE_SECRET_KEY&&env.STRIPE_PRICE_ID&&env.STRIPE_WEBHOOK_SECRET)});
  }
  if(path==='/api/books'&&r.method==='GET'){const result=await checked(db.from('books').select('id,title,author,size,created_at').eq('user_id',user.id).eq('ready',true).order('created_at',{ascending:false}));return json(result)}
  if(path==='/api/books'&&r.method==='POST'){
    const data=await body(r);const title=String(data.title||'').trim().slice(0,300),author=String(data.author||'').slice(0,200),size=Number(data.size);
    if(!title||!Number.isInteger(size)||size<1||size>75*1024*1024)return err('Choose an EPUB smaller than 75 MB.');
    const id=crypto.randomUUID(),key=`${user.id}/${id}.epub`;
    // Atomic conditional INSERT includes pending uploads, preventing parallel requests from exceeding five slots.
    const {error}=await db.from('books').insert({id,user_id:user.id,title,author,object_key:key,size});
    if(error){if(error.message.includes('five books'))return err('Free accounts can keep five books. Remove a book or upgrade.',403);if(error.message.includes('books_size_check'))return err('Choose an EPUB smaller than 75 MB.',413);throw error}return json({id},201);
  }
  const match=path.match(/^\/api\/books\/([a-f0-9-]+)(?:\/(file|state))?$/);
  if(match){
    const book=await checked(db.from('books').select('*').eq('id',match[1]).eq('user_id',user.id).maybeSingle());if(!book)return err('Book not found',404);
    if(!match[2]&&r.method==='DELETE'){await checked(db.storage.from('epubs').remove([book.object_key]));await checked(db.from('books').delete().eq('id',book.id).eq('user_id',user.id));return json({ok:true})}
    if(match[2]==='file'&&r.method==='PUT'){
      if(book.ready)return err('This upload is already complete.',409);
      const file=await bytes(r,75*1024*1024);if(file.length!==book.size||file[0]!==80||file[1]!==75)return err('Invalid EPUB upload.');
      await checked(db.storage.from('epubs').upload(book.object_key,file,{contentType:'application/epub+zip',upsert:false}));await checked(db.from('books').update({ready:true}).eq('id',book.id));return json({ok:true});
    }
    if(match[2]==='file'&&r.method==='GET'){const {data:file,error}=await db.storage.from('epubs').download(book.object_key);return file&&!error?new Response(file,{headers:{'Content-Type':'application/epub+zip','Cache-Control':'private, no-store'}}):err('File unavailable',404)}
    if(match[2]==='state'&&r.method==='GET'){const row=await checked(db.from('reading_state').select('data').eq('book_id',book.id).eq('user_id',user.id).maybeSingle());return json(row?.data||{})}
    if(match[2]==='state'&&r.method==='PUT'){const data=await body(r,100000);await checked(db.from('reading_state').upsert({book_id:book.id,user_id:user.id,data,updated_at:new Date().toISOString()},{onConflict:'book_id'}));return json({ok:true})}
  }
  if(path==='/api/tts'&&r.method==='POST'){
    if(!isPaid(user))return err('AI narration requires a paid subscription.',403);
    if(!admin)return err('AI narration is not configured yet.',503);
    if(!(await env.VOICE_LIMIT.limit({key:user.id})).success)return err('Voice request limit reached. Retry in a minute.',429);
    const data=await body(r);const text=String(data.text||'').trim();const speakers=['athena','pluto','orpheus','pandora','vesta','minerva','zeus','orion'];
    if(!text||text.length>1800)return err('Narration passages must contain 1–1800 characters.');
    const month=monthKey(),limit=Number(env.AI_MONTHLY_CHARACTERS)||100000;
    const reserved=await checked(admin.rpc('reserve_voice',{p_user:user.id,p_month:month,p_characters:text.length,p_limit:limit}));
    if(!reserved)return err('Your monthly AI narration allowance is used. Browser narration remains available.',429);
    try{const audio=await env.AI.run('@cf/deepgram/aura-2-en' as any,{text,speaker:speakers.includes(data.speaker)?data.speaker:'athena',encoding:'mp3'} as any);return new Response(audio as ReadableStream,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store'}})}catch{
      await checked(admin.rpc('refund_voice',{p_user:user.id,p_month:month,p_characters:text.length}));return err('AI provider unavailable or its daily quota is exhausted. Your allowance was refunded. Try Browser narration.',503);
    }
  }
  if(path==='/api/billing/checkout'&&r.method==='POST'){
    if(!admin||!env.STRIPE_PRICE_ID||!env.STRIPE_WEBHOOK_SECRET)return err('Paid checkout is not activated yet.',503);
    if(isPaid(user))return err('You already have paid access. Manage it in billing settings.');
    let customer=user.customer;
    if(!customer){const created=await stripe(env,'customers',new URLSearchParams({email:user.email,name:user.name,'metadata[user_id]':user.id}));customer=created.id;await checked(admin.from('entitlements').update({customer}).eq('user_id',user.id))}
    const origin=env.APP_ORIGIN||url.origin;
    const checkout=await stripe(env,'checkout/sessions',new URLSearchParams({mode:'subscription',customer:customer!,success_url:`${origin}/?billing=success`,cancel_url:`${origin}/?billing=cancelled`,'line_items[0][price]':env.STRIPE_PRICE_ID,'line_items[0][quantity]':'1'}));return json({url:checkout.url});
  }
  if(path==='/api/billing/portal'&&r.method==='POST'){if(!admin)return err('Paid billing is not activated yet.',503);if(!user.customer)return err('No billing account yet.');const portal=await stripe(env,'billing_portal/sessions',new URLSearchParams({customer:user.customer,return_url:env.APP_ORIGIN||url.origin}));return json({url:portal.url})}
  return err('Not found',404);
}
export default {async fetch(r:Request,env:Env):Promise<Response>{
  try{const response=new URL(r.url).pathname.startsWith('/api/')?await api(r,env):await env.ASSETS.fetch(r);const safe=new Response(response.body,response);safe.headers.set('X-Content-Type-Options','nosniff');safe.headers.set('Referrer-Policy','same-origin');safe.headers.set('X-Frame-Options','DENY');return safe}catch(error){console.error('Request failed', error instanceof Error?error.name:'BackendError');return err('Unable to complete the request. Please retry.',500)}
}};
