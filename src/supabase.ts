import {createClient, type SupabaseClient} from '@supabase/supabase-js';
type SupabaseConfig={url:string;publishableKey:string};
let client: Promise<SupabaseClient> | undefined;
let configuration: Promise<SupabaseConfig> | undefined;
export function getSupabaseConfig() {
  return configuration ??= fetch('/api/config').then(async response => {
    const config = await response.json() as Partial<SupabaseConfig> & {error?:string};
    if (!response.ok || !config.url || !config.publishableKey) throw new Error(config.error || 'Account service is not configured yet.');
    return config as SupabaseConfig;
  }).catch(error => {configuration = undefined; throw error;});
}
export function getSupabase() {
  return client ??= getSupabaseConfig().then(config => createClient(config.url, config.publishableKey)).catch(error => {client = undefined; throw error;});
}
export async function authenticatedFetch(path:string, options:RequestInit = {}) {
  const {data, error} = await (await getSupabase()).auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Please sign in.');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  // The Worker verifies this token with Auth; local session data never grants access.
  return fetch(path, {...options, headers});
}
export async function uploadEpub(id:string,file:File,onProgress?:(percent:number)=>void) {
  const supabase = await getSupabase();
  const {data,error} = await supabase.auth.getSession();
  if(error)throw error;if(!data.session)throw new Error('Please sign in.');
  await new Promise<void>((resolve,reject)=>{
    const request=new XMLHttpRequest();
    request.open('PUT',`/api/books/${encodeURIComponent(id)}/file`);
    request.setRequestHeader('Authorization',`Bearer ${data.session.access_token}`);
    request.setRequestHeader('Content-Type','application/epub+zip');
    request.upload.onprogress=event=>{if(event.lengthComputable)onProgress?.(Math.round(event.loaded/event.total*100))};
    request.onerror=()=>reject(new Error('EPUB upload was interrupted. Please retry.'));
    request.onabort=()=>reject(new Error('EPUB upload was cancelled.'));
    request.onload=()=>{
      let message='EPUB upload failed.';
      try{message=(JSON.parse(request.responseText) as {error?:string}).error||message}catch{}
      request.status>=200&&request.status<300?resolve():reject(new Error(message));
    };
    request.send(file);
  });
}
