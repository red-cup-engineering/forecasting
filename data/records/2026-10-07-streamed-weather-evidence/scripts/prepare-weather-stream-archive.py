from pathlib import Path
import json,hashlib,uuid,subprocess
repo=Path('/home/emsenn/info');f=Path(Path('/tmp/weather-forecasting-root').read_text().strip());r=f/'data/records/2026-10-07-streamed-weather-evidence';r.mkdir(parents=True,exist_ok=True);(r/'scripts').mkdir(exist_ok=True);Path('/tmp/weather-stream-archive-record').write_text(str(r));p=f/'src/weather-engine.mjs';before=p.read_text();after=before;replacements=[]
def replace(a,b):
 global after
 assert after.count(a)==1,a;after=after.replace(a,b);replacements.append({'before':a,'after':b})
replace("import { createReadStream } from 'node:fs';", "import { createReadStream, createWriteStream } from 'node:fs';\nimport { Readable } from 'node:stream';\nimport { pipeline } from 'node:stream/promises';")
replace("import { gzipSync, gunzipSync } from 'node:zlib';", "import { createGzip, gunzipSync } from 'node:zlib';")
old="""async function archivePacket(path,evidence){
  const tmp=`${path}.${process.pid}.${randomUUID()}.tmp`;
  try{await writeFile(tmp,gzipSync(JSON.stringify(evidence)),{mode:0o600,flag:'wx'});try{await link(tmp,path);}catch(e){if(e.code!=='EEXIST')throw e;}}
  finally{await rm(tmp,{force:true});}
}"""
new="""// Weather packets are JSON trees. Split their maps and arrays into records;
// never retain another packet-sized JSON string beside the live evidence tree.
// Native JSON serialization at each leaf preserves numbers, escaping and omission.
function* packetJsonRecords(value,key='',depth=0){
 const container=value!==null&&typeof value==='object'&&(Array.isArray(value)||[Object.prototype,null].includes(Object.getPrototypeOf(value)))&&!('toJSON' in value);
 if(!container||depth>=3){
  // The wrapper supplies the original property/index key to native toJSON.
  const encoded=JSON.stringify({[key]:value});if(encoded!=='{}')yield encoded.slice(JSON.stringify(key).length+2,-1);return;
 }
 if(Array.isArray(value)){
  const length=value.length;yield '[';for(let i=0;i<length;i++){if(i)yield ',';const parts=packetJsonRecords(value[i],String(i),depth+1),first=parts.next();if(first.done)yield 'null';else{yield first.value;yield* parts;}}yield ']';
 }else{
  const keys=Object.keys(value);yield '{';let comma=false;for(const name of keys){const parts=packetJsonRecords(value[name],name,depth+1),first=parts.next();if(first.done)continue;if(comma)yield ',';comma=true;yield JSON.stringify(name)+':';yield first.value;yield* parts;}yield '}';
 }
}
async function archivePacket(root,evidence){
 const tmp=join(root,`.packet-${process.pid}-${randomUUID()}.tmp`),hash=createHash('sha256');
 async function* bytes(){let chunks=[],size=0,written=0;for(const text of packetJsonRecords(evidence)){chunks.push(text);size+=text.length;if(size>=65536){const b=Buffer.from(chunks.join(''));chunks=[];size=0;written+=b.length;hash.update(b);yield b;}}if(chunks.length){const b=Buffer.from(chunks.join(''));written+=b.length;hash.update(b);yield b;}if(!written)throw new TypeError('weather packet must have a JSON representation');}
 try{
  await pipeline(Readable.from(bytes()),createGzip(),createWriteStream(tmp,{mode:0o600,flags:'wx'}));const evidenceId=hash.digest('hex');try{await link(tmp,join(root,evidenceId+'.json.gz'));}catch(e){if(e.code!=='EEXIST')throw e;}return evidenceId;
 }finally{await rm(tmp,{force:true});}
}"""
replace(old,new)
replace("const sourceEvidenceId=digest(evidence);await archivePacket(join(root,'evidence',`${sourceEvidenceId}.json.gz`),evidence);", "const sourceEvidenceId=await archivePacket(join(root,'evidence'),evidence);")
replace("const evidenceId=digest(evidence);await archivePacket(join(root,'evidence',`${evidenceId}.json.gz`),evidence);return evidenceId;", "return archivePacket(join(root,'evidence'),evidence);")
old="const evidenceId=digest(packet);await archivePacket(join(root,'evidence',`${evidenceId}.json.gz`),packet);"
assert after.count(old)==2;after=after.replace(old,"const evidenceId=await archivePacket(join(root,'evidence'),packet);");replacements.append({'before':old,'after':"const evidenceId=await archivePacket(join(root,'evidence'),packet);",'expectedCount':2})
old="const evidenceId=digest(packet);await archivePacket(join(root,'evidence',evidenceId+'.json.gz'),packet);"
assert after.count(old)==3;after=after.replace(old,"const evidenceId=await archivePacket(join(root,'evidence'),packet);");replacements.append({'before':old,'after':"const evidenceId=await archivePacket(join(root,'evidence'),packet);",'expectedCount':3})
name=str(p.relative_to(repo));sha=hashlib.sha256(before.encode()).hexdigest();clauses=['single-byte-stream-identity-and-compression','record-bounded-json-allocation','same-json-carrier-and-native-readers','all-weather-archive-consumers-migrated','failed-writes-never-publish','shared-house-and-trade-controls-preserved'];inventory={'kind':'source-patchset-input','version':1,'sourceRoot':str(repo),'files':{name:{'state':'present','sha256':sha}},'clauses':clauses};patch={'kind':'source-patchset','version':1,'disposition':'candidate','reason':'Remove duplicate packet-sized JSON strings and synchronous compression from the entire weather evidence archive family, retaining exact JSON bytes, content addresses and existing readers.','changes':[{'operation':'edit','path':name,'inputSha256':sha,'replacements':[{'before':before,'after':after}],'clauses':clauses}]}
(r/'weather-engine.before.mjs').write_text(before);(r/'weather-engine.candidate.mjs').write_text(after);(r/'input-inventory.json').write_text(json.dumps(inventory,indent=2)+'\n');(r/'source-patchset.json').write_text(json.dumps(patch,indent=2)+'\n');(r/'receiving-conditions.json').write_text(json.dumps({'conditions':['identical uncompressed bytes and SHA for actual archived full evidence','native JSON omission, escaping, key order and array behavior retained','source and derived archives use one canonical stream each','concurrent identical writes converge without mutable replacement','invalid serialization leaves no archive or temporary files','native CPU and peak RSS measured against the previous route','installed native reader retrieves streamed output','full producer cycle checked without changing resource limits']},indent=2)+'\n')
stage=Path('/tmp/weather-stream-archive-stage-'+uuid.uuid4().hex);tool=repo/Path('/tmp/weather-source-patchset-tool').read_text().strip();subprocess.run(['python3',str(tool),str(r/'input-inventory.json'),str(r/'source-patchset.json'),str(stage)],check=True);Path('/tmp/weather-stream-archive-stage').write_text(str(stage));subprocess.run(['node','--check',str(stage/name)],check=True);print(json.dumps({'record':str(r),'sourcePaths':1,'archiveConsumers':7,'canonicalChanged':False}))
