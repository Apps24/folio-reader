import {createClient, type SupabaseClient} from '@supabase/supabase-js';
let client: Promise<SupabaseClient> | undefined;
export function getSupabase() {
  return client ??= fetch('/api/config').then(async response => {
    const config = await response.json() as {url?:string;publishableKey?:string;error?:string};
    if (!response.ok || !config.url || !config.publishableKey) throw new Error(config.error || 'Account service is not configured yet.');
    return createClient(config.url, config.publishableKey);
  }).catch(error => {client = undefined; throw error;});
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
