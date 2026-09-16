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
  const [supabase,config,{Upload}] = await Promise.all([getSupabase(),getSupabaseConfig(),import('tus-js-client')]);
  const {data,error} = await supabase.auth.getSession();
  if(error)throw error;if(!data.session)throw new Error('Please sign in.');
  const projectRef=new URL(config.url).hostname.split('.')[0];
  if(!/^[a-z0-9-]+$/.test(projectRef))throw new Error('Invalid storage configuration.');
  await new Promise<void>((resolve,reject)=>{
    const upload=new Upload(file,{
      endpoint:`https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays:[0,3000,5000,10000,20000],
      headers:{authorization:`Bearer ${data.session.access_token}`,apikey:config.publishableKey},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      chunkSize:6*1024*1024,
      metadata:{bucketName:'epubs',objectName:`${data.session.user.id}/${id}.epub`,contentType:'application/epub+zip',cacheControl:'3600'},
      onError:error=>reject(new Error(error.message||'EPUB upload failed.')),
      onProgress:(uploaded,total)=>onProgress?.(Math.round(uploaded/total*100)),
      onSuccess:()=>resolve()
    });
    upload.findPreviousUploads().then(previous=>{if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start()}).catch(reject);
  });
}
