/** NWS source projection over the shared HTTP GET acquisition owner. The
 * original deadline continues through the existing bounded JSON body read. */
import {acquireHttpResponse as readNwsResponse} from '@red-cup-engineering/http-services-section/acquire-response';
import {readBody} from '@red-cup-engineering/http-services-section/body/web';
import {JSON_RESOURCE_ENVELOPE} from '@red-cup-engineering/json-services-section/canonical-json';
export {readNwsResponse};
export async function readNwsJson(url,options={}) {
 const acquired=await readNwsResponse(url,options);
 const bytes=await readBody({body:acquired.response.body,headers:acquired.response.headers,signal:acquired.signal},{maxBytes:JSON_RESOURCE_ENVELOPE.maxSourceBytes,decodeContentEncoding:false});
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
