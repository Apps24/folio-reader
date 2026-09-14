import { timingSafeEqual, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
export const now=()=>Math.floor(Date.now()/1000);
export function verifyWebhook(body:string,header:string,secret:string,clock=now()) {
  const parts=header.split(',').map(s=>s.split('='));const timestamp=parts.find(p=>p[0]==='t')?.[1];
  if(!timestamp||Math.abs(clock-Number(timestamp))>300)return false;
  const expected=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest();
  return parts.filter(p=>p[0]==='v1').some(p=>{const actual=Buffer.from(p[1]||'','hex');return actual.length===expected.length&&timingSafeEqual(actual,expected)});
}
export function isPaid(user:{paid_until:number},clock=now()){return user.paid_until>clock}
export function monthKey(date=new Date()){return date.toISOString().slice(0,7)}
