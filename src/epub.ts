import JSZip from 'jszip';
import DOMPurify from 'dompurify';
export type Chapter={title:string;path:string};
export type Book={title:string;author:string;chapters:Chapter[];archive:JSZip};
function xml(text:string){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('The EPUB contains invalid XML.');return doc}
function pathAt(base:string,href:string){const parts=base.split('/');parts.pop();for(const part of decodeURIComponent(href.split('#')[0]).split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part)}return parts.join('/')}
async function text(zip:JSZip,path:string){const entry=zip.file(path);if(!entry)throw new Error(`EPUB resource is missing: ${path}`);const raw=await entry.async('string');if(raw.length>5_000_000)throw new Error('This EPUB section is too large.');return raw}
export async function openEpub(file:Blob):Promise<Book>{
  if(file.size>50*1024*1024)throw new Error('Choose an EPUB under 50 MB.');
  const archive=await JSZip.loadAsync(await file.arrayBuffer());
  if(Object.keys(archive.files).length>10000)throw new Error('This EPUB has too many resources.');
  const container=xml(await text(archive,'META-INF/container.xml'));
  const root=container.getElementsByTagNameNS('*','rootfile')[0]?.getAttribute('full-path');if(!root)throw new Error('EPUB package missing.');
  const opf=xml(await text(archive,root));
  const items=Array.from(opf.getElementsByTagNameNS('*','item'));const byId=new Map(items.map(i=>[i.getAttribute('id'),i]));const labels=new Map<string,string>();
  const nav=items.find(i=>i.getAttribute('properties')?.split(' ').includes('nav'));
  const ncx=items.find(i=>i.getAttribute('media-type')==='application/x-dtbncx+xml');
  if(nav){const navPath=pathAt(root,nav.getAttribute('href')||'');const doc=xml(await text(archive,navPath));for(const a of Array.from(doc.getElementsByTagNameNS('*','a'))){const href=a.getAttribute('href');if(href&&!labels.has(pathAt(navPath,href)))labels.set(pathAt(navPath,href),a.textContent?.trim()||'')}}
  else if(ncx){const p=pathAt(root,ncx.getAttribute('href')||'');const doc=xml(await text(archive,p));for(const n of Array.from(doc.getElementsByTagNameNS('*','navPoint'))){const href=n.getElementsByTagNameNS('*','content')[0]?.getAttribute('src'),label=n.getElementsByTagNameNS('*','text')[0]?.textContent;if(href)labels.set(pathAt(p,href),label||'')}}
  const chapters=Array.from(opf.getElementsByTagNameNS('*','itemref')).filter(i=>i.getAttribute('linear')!=='no').flatMap((ref,index)=>{const item=byId.get(ref.getAttribute('idref'));if(!item||!/html/.test(item.getAttribute('media-type')||''))return [];const path=pathAt(root,item.getAttribute('href')||'');return [{path,title:labels.get(path)||`Section ${index+1}`}]});
  if(!chapters.length)throw new Error('No readable sections were found. DRM-protected EPUBs are not supported.');
  return {archive,chapters,title:opf.getElementsByTagNameNS('*','title')[0]?.textContent?.trim()||'Untitled book',author:opf.getElementsByTagNameNS('*','creator')[0]?.textContent?.trim()||'Unknown author'};
}
export async function renderChapter(book:Book,index:number){
  const chapter=book.chapters[index];const source=await text(book.archive,chapter.path);
  const clean=DOMPurify.sanitize(source,{ALLOWED_TAGS:['p','h1','h2','h3','h4','h5','h6','em','strong','b','i','u','s','blockquote','ul','ol','li','br','hr','figure','figcaption','img','table','tbody','tr','td','th','sup','sub','span','div','a'],ALLOWED_ATTR:['src','alt','href','id','colspan','rowspan'],ALLOW_DATA_ATTR:false});
  const doc=new DOMParser().parseFromString(clean,'text/html');const urls:string[]=[];
  for(const image of Array.from(doc.querySelectorAll('img'))){const src=image.getAttribute('src')||'';image.removeAttribute('src');if(!src||/^(?:[a-z]+:|\/\/)/i.test(src))continue;const entry=book.archive.file(pathAt(chapter.path,src));if(!entry)continue;const extension=src.split('.').pop()?.toLowerCase();const mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'} as Record<string,string>)[extension||''];if(!mime)continue;const bytes=await entry.async('uint8array');if(bytes.length>10_000_000)continue;const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:mime}));urls.push(url);image.src=url;image.loading='lazy';image.alt=image.alt||'Book illustration'}
  for(const link of Array.from(doc.querySelectorAll('a'))){const href=link.getAttribute('href')||'';if(!href.startsWith('#'))link.removeAttribute('href')}
  const blocks=Array.from(doc.querySelectorAll('h1,h2,h3,h4,p,li,blockquote')).filter(n=>!n.querySelector('p,li,blockquote')).map((node,i)=>{node.setAttribute('data-block',String(i));return node.textContent?.trim()||''}).filter(Boolean);
  return {html:doc.body.innerHTML,blocks,urls};
}
export async function searchBook(book:Book,query:string){const result:{index:number;title:string;snippet:string}[]=[];for(let index=0;index<book.chapters.length;index++){const chapter=book.chapters[index];const raw=await text(book.archive,chapter.path);const content=new DOMParser().parseFromString(raw,'text/html').body.textContent||'';const at=content.toLowerCase().indexOf(query.toLowerCase());if(at>=0)result.push({index,title:chapter.title,snippet:content.slice(Math.max(0,at-45),at+130)});if(result.length>=50)break}return result}
