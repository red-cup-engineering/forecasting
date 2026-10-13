/** The weather family's one NWS acquisition owner: original deadline includes
 * shared server cooldown and Code's bounded retries; no second outer retry. */
import {retryWithBackoff,delay} from '@red-cup-engineering/javascript-node-services-section/retry';
import {retryAfterDelayMs} from '@red-cup-engineering/http-services-section/retry-after';
import {readBody} from '@red-cup-engineering/http-services-section/body/web';
import {JSON_RESOURCE_ENVELOPE} from '@red-cup-engineering/json-services-section/canonical-json';
const cooldowns=new WeakMap();
export async function readNwsResponse(url,{fetchImpl=fetch,headers={},timeoutMs=10000}={}) {
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw new TypeError('positive finite acquisition timeout required');
 const target=new URL(url),deadline=Date.now()+timeoutMs,receipts=[];
 let origins=cooldowns.get(fetchImpl);if(!origins){origins=new Map();cooldowns.set(fetchImpl,origins);}
 let latest=null,signal,attempts=0;
 const refused=(reason)=>Object.assign(new Error(`NWS ${reason}: ${target.href}; ${JSON.stringify({attempts,rateLimits:receipts,cooldownUntil:origins.get(target.origin)??null})}`),{source:target.href,attempts,rateLimits:receipts});
 const wait=async milliseconds=>{
  const remaining=deadline-Date.now();
  if(milliseconds>=remaining)throw refused('retry delay exceeds original acquisition deadline');
  if(milliseconds>0)await delay(milliseconds);
 };
 const result=await retryWithBackoff({
  operation:async()=>{
   await wait(Math.max(0,(origins.get(target.origin)??0)-Date.now()));
   const remaining=deadline-Date.now();if(remaining<=0)throw refused('original acquisition deadline exhausted');
   signal=AbortSignal.timeout(remaining);attempts++;
   const response=await fetchImpl(target,{headers,signal});
   if(response.ok)return {ok:true,value:response};
   const at=Date.now(),retryAfterMs=retryAfterDelayMs(response.headers?.get('retry-after'),at);
   latest={status:response.status,receivedAt:new Date(at).toISOString(),retryAfterMs};
   await response.body?.cancel().catch(()=>{});
   if(response.status===429){receipts.push(latest);if(retryAfterMs!==null)origins.set(target.origin,Math.max(origins.get(target.origin)??0,at+retryAfterMs));}
   return {ok:false,refusal:latest};
  },
  isRetryable:refusal=>refusal.status===429,
  delay:milliseconds=>wait(Math.max(milliseconds,(origins.get(target.origin)??0)-Date.now())),
 });
 if(!result.ok)throw refused(`HTTP ${latest?.status??'unknown'}`);
 return {response:result.value,signal,attempts,rateLimits:receipts};
}
export async function readNwsJson(url,options={}) {
 const acquired=await readNwsResponse(url,options);
 const bytes=await readBody({body:acquired.response.body,headers:acquired.response.headers,signal:acquired.signal},{maxBytes:JSON_RESOURCE_ENVELOPE.maxSourceBytes,decodeContentEncoding:false});
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
