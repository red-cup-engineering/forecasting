import {open,rename,rm} from 'node:fs/promises';import {createReadStream} from 'node:fs';
// Keep the existing state JSON carrier. Decode/encode each map record without
// retaining a second, file-sized JSON string alongside the live state object.
async function readStateJson(path){
  const stream=createReadStream(path,{encoding:'utf8',highWaterMark:65536}),iterator=stream[Symbol.asyncIterator]();let buffer='',at=0,done=false;
  const fill=async()=>{while(at>=buffer.length&&!done){const part=await iterator.next();done=part.done;buffer=done?'':part.value;at=0;}return at<buffer.length;};
  const space=async()=>{while(await fill()){while(at<buffer.length&&/[ \t\r\n]/.test(buffer[at]))at++;if(at<buffer.length)return;}};
  const expect=async char=>{await space();if(!await fill()||buffer[at++]!==char)throw new SyntaxError('station science: invalid state JSON');};
  const raw=async()=>{
    await space();if(!await fill())throw new SyntaxError('station science: truncated state JSON');
    const first=buffer[at],container=first==='{'||first==='[',quoted=first==='"',parts=[];let depth=0,string=false,escape=false;
    while(await fill()){
      const begin=at;
      while(at<buffer.length){
        const char=buffer[at];
        if(!container&&!quoted&&(char===','||char==='}'||char===']'||/[ \t\r\n]/.test(char))){parts.push(buffer.slice(begin,at));return parts.join('');}
        at++;
        if(string){if(escape)escape=false;else if(char==='\\')escape=true;else if(char==='"'){string=false;if(quoted){parts.push(buffer.slice(begin,at));return parts.join('');}}}
        else if(char==='"')string=true;
        else if(container){if(char==='{'||char==='[')depth++;else if(char==='}'||char===']'){depth--;if(depth===0){parts.push(buffer.slice(begin,at));return parts.join('');}}}
      }
      parts.push(buffer.slice(begin,at));
    }
    if(container||quoted)throw new SyntaxError('station science: truncated state JSON');return parts.join('');
  };
  const object=async root=>{
    await expect('{');const result={};await space();if(await fill()&&buffer[at]==='}'){at++;return result;}
    while(true){
      const name=JSON.parse(await raw());if(typeof name!=='string')throw new SyntaxError('station science: state JSON key must be a string');await expect(':');await space();
      const value=root&&await fill()&&buffer[at]==='{'?await object(false):JSON.parse(await raw());
      Object.defineProperty(result,name,{value,writable:true,configurable:true,enumerable:true});await space();if(!await fill())throw new SyntaxError('station science: truncated state JSON');const next=buffer[at++];if(next==='}')return result;if(next!==',')throw new SyntaxError('station science: invalid state JSON');
    }
  };
  try{const result=await object(true);await space();if(await fill())throw new SyntaxError('station science: trailing state JSON');return result;}finally{stream.destroy();}
}
const read=async(path,fallback)=>{try{return await readStateJson(path);}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function atomic(path,value){
  const tmp=path+'.'+process.pid+'.tmp',handle=await open(tmp,'w',0o600);let chunks=[],bytes=0;
  const flush=async()=>{if(!chunks.length)return;const buffer=Buffer.from(chunks.join(''));chunks=[];bytes=0;let offset=0;while(offset<buffer.length){const {bytesWritten}=await handle.write(buffer,offset,buffer.length-offset,null);if(!bytesWritten)throw new Error('station science: state write did not advance');offset+=bytesWritten;}};
  const put=async text=>{chunks.push(text);bytes+=text.length;if(bytes>=65536)await flush();};
  const map=async(object,root=false)=>{await put('{');let comma=false;for(const name of Object.keys(object)){const item=object[name],nested=root&&item!==null&&!Array.isArray(item)&&typeof item==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(item)),encoded=nested?null:JSON.stringify(item);if(encoded===undefined)continue;if(comma)await put(',');comma=true;await put(JSON.stringify(name)+':');
    // Root maps are serialized record by record, including all unknown fields.
    if(nested)await map(item);else await put(encoded);
  }await put('}');};
  try{await map(value,true);await put('\n');await flush();await handle.close();await rename(tmp,path);}catch(e){await handle.close().catch(()=>{});await rm(tmp,{force:true});throw e;}
}

export {readStateJson,atomic};
