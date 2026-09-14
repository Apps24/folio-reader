import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyWebhook,isPaid} from '../worker/security.ts';
test('webhook rejects forged and replayed signatures',()=>{const raw='{"type":"invoice.paid"}',time=100000,secret='local-fixture';const sig=createHmac('sha256',secret).update(`${time}.${raw}`).digest('hex');assert(verifyWebhook(raw,`t=${time},v1=${sig}`,secret,time));assert(!verifyWebhook(raw+' ',`t=${time},v1=${sig}`,secret,time));assert(!verifyWebhook(raw,`t=${time},v1=${sig}`,secret,time+301));assert(!verifyWebhook(raw,`t=${time},v1=bad`,secret,time))});
test('paid access expires at the boundary',()=>{assert(isPaid({paid_until:101},100));assert(!isPaid({paid_until:100},100))});
