/**
 * Revision ledger: a JSON state that changes a little each cycle, stored as the
 * changes and not as the whole state.
 *
 * CONTRACT
 *   Layout of a ledger directory:
 *     head.json                    small pointer, rewritten atomically per commit:
 *                                  {version,revision,segment,seq,bytes,rawBytes,snapshotRawBytes,at}
 *     segments/<n>.jsonl.gz        gzip members, one per entry, appended. An entry is one
 *                                  JSON line {parent,seq,at,snapshot?|set?,del?,put?,outcomes?}.
 *                                  A segment begins with an entry that carries `snapshot`
 *                                  (the whole state) except the very first segment, which may
 *                                  begin from the empty state `{}`.
 *     outcomes.jsonl.gz            permanent, append-only lineage that is never replayed:
 *                                  members `<ni>\t<json>\n`, ni = sha-256 of the json text.
 *   Revision: a revision is the RFC 6920 `ni:///sha-256;...` name of the entry's exact JSON
 *   line. The line holds its parent's revision, so the revisions form a hash chain; the
 *   head revision names the entire state.
 *   State is `{[collection]: {[key]: row}, ...scalars}`. An entry changes it by
 *     snapshot : replace the whole state
 *     del      : {collection: [key,...]}   delete rows
 *     set      : {collection: {key: row}}  write rows
 *     put      : {field: value}            write top-level scalars
 *   applied in the order snapshot, del, set, put.
 *   Cost of a commit is the size of the changed rows, plus a snapshot only when the
 *   segment's deltas have outgrown the last snapshot (then a new segment starts, so a
 *   reader replays at most about two states' worth of text). Segments older than
 *   `keepSegments` are deleted; past revisions older than that are unreachable and
 *   `findRevision` says so. The head state is always reachable.
 *   Crash safety: bytes past head.bytes in the head segment are an uncommitted tail; they
 *   are ignored by readers and overwritten by the next commit. Writers hold the caller's
 *   lock; the ledger takes none.
 *   Ownership: openLedger returns a private mutable `state`; commit hands it back to a
 *   one-slot in-process cache so a second open in the same process replays nothing.
 */
import {createHash} from 'node:crypto';
import {gzip,gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {open,mkdir,readFile,writeFile,rename,readdir,rm,appendFile} from 'node:fs/promises';
import {join} from 'node:path';

const gzipAsync=promisify(gzip),gunzipAsync=promisify(gunzip);
const NI_PREFIX='ni:///sha-256;';
const NI_PATTERN=/^ni:\/\/\/sha-256;([A-Za-z0-9_-]{43})$/u;

/** RFC 6920 name of bytes (identical to uri-services-section makeNiUri, but with the native digest). */
export const niOf=bytes=>NI_PREFIX+createHash('sha256').update(bytes).digest('base64url');
export const niOfHex=hex=>{
  if(!/^[a-f0-9]{64}$/u.test(hex??''))throw new TypeError('a sha-256 hex digest is required');
  return NI_PREFIX+Buffer.from(hex,'hex').toString('base64url');
};
export const hexOfNi=ni=>{
  const m=NI_PATTERN.exec(ni??'');
  const bytes=m&&Buffer.from(m[1],'base64url');
  if(!bytes||bytes.length!==32||bytes.toString('base64url')!==m[1])throw new TypeError('a canonical sha-256 ni URI is required');
  return bytes.toString('hex');
};
export const isNi=value=>{try{hexOfNi(value);return true;}catch{return false;}};

const headPath=dir=>join(dir,'head.json');
const segmentPath=(dir,n)=>join(dir,'segments',String(n).padStart(6,'0')+'.jsonl.gz');
const MIN_SEGMENT_RAW=32*1024*1024;
const cache=new Map();

async function readHead(dir){
  try{return JSON.parse(await readFile(headPath(dir),'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function atomicWrite(path,text){
  const tmp=`${path}.${process.pid}.tmp`;
  await writeFile(tmp,text,{mode:0o600});await rename(tmp,path);
}

export function applyEntry(state,entry){
  if(entry.snapshot!==undefined)state=entry.snapshot;
  for(const [collection,keys] of Object.entries(entry.del??{})){const rows=state[collection];if(rows)for(const key of keys)delete rows[key];}
  for(const [collection,rows] of Object.entries(entry.set??{}))Object.assign(state[collection]??={},rows);
  Object.assign(state,entry.put??{});
  return state;
}

/** Entries of one segment as {entry,revision,line}, verifying the hash chain. */
async function readSegment(dir,n,{limit}={}){
  let bytes=await readFile(segmentPath(dir,n));
  if(limit!==undefined)bytes=bytes.subarray(0,limit);
  const text=(await gunzipAsync(bytes)).toString('utf8');
  const out=[];let parent;
  for(const line of text.split('\n')){
    if(!line)continue;
    const entry=JSON.parse(line),revision=niOf(Buffer.from(line,'utf8'));
    if(parent!==undefined&&entry.parent!==parent)throw new Error(`weather ledger chain broken in segment ${n} at seq ${entry.seq}`);
    parent=revision;out.push({entry,revision,line});
  }
  return out;
}

async function replayHead(dir,head){
  let state={};
  const entries=await readSegment(dir,head.segment,{limit:head.bytes});
  for(const {entry} of entries)state=applyEntry(state,entry);
  if(entries.at(-1)?.revision!==head.revision)throw new Error('weather ledger head does not match its segment');
  return state;
}

export class Ledger{
  constructor(dir,head,state){this.dir=dir;this.head=head;this.state=state;this.open=true;}
  /** Hand the state back unchanged (nothing to commit) so the next open in this process replays nothing. */
  release(){if(this.open&&this.head){cache.set(this.dir,{revision:this.head.revision,state:this.state,lent:false});}this.open=false;}
  /**
   * Append one revision. `delta` is {set,del,put,snapshot,outcomes}. With `applied:true` the
   * caller has already made the same changes to `this.state` (cheaper than a copy).
   * `outcomes` is an array of lineage rows that are written once to outcomes.jsonl.gz; the
   * entry keeps only their ni name.
   */
  async commit({set,del,put,snapshot,outcomes,at=new Date().toISOString(),applied=false,keepSegments=3}={}){
    if(!this.open)throw new Error('weather ledger handle already committed');
    const dir=this.dir;await mkdir(join(dir,'segments'),{recursive:true,mode:0o700});
    const entry={parent:this.head?.revision??null,seq:(this.head?.seq??0)+1,at};
    if(snapshot!==undefined)entry.snapshot=snapshot;
    if(del&&Object.values(del).some(keys=>keys.length))entry.del=Object.fromEntries(Object.entries(del).filter(([,keys])=>keys.length));
    if(set&&Object.values(set).some(rows=>Object.keys(rows).length))entry.set=Object.fromEntries(Object.entries(set).filter(([,rows])=>Object.keys(rows).length));
    if(put&&Object.keys(put).length)entry.put=put;
    if(!entry.snapshot&&!entry.set&&!entry.del&&!entry.put&&!outcomes?.length){this.release();return {revision:this.head?.revision??null,seq:this.head?.seq??0,rolledOver:false,bytesWritten:0,segmentBytes:0,outcomes:null,unchanged:true};}
    if(!applied)this.state=applyEntry(this.state,entry);
    else if(snapshot!==undefined)this.state=snapshot;
    let outcomeBytes=0;
    if(outcomes?.length){
      const text=JSON.stringify(outcomes),ni=niOf(Buffer.from(text,'utf8'));
      const member=await gzipAsync(Buffer.from(`${ni}\t${text}\n`,'utf8'));
      await appendFile(join(dir,'outcomes.jsonl.gz'),member,{mode:0o600});outcomeBytes=member.length;
      entry.outcomes={ni,count:outcomes.length};
    }
    let segment=this.head?.segment??1,rawBytes=this.head?.rawBytes??0,snapshotRawBytes=this.head?.snapshotRawBytes??0,rollover=false;
    let line=JSON.stringify(entry);
    if(this.head&&entry.snapshot===undefined&&rawBytes+line.length>Math.max(MIN_SEGMENT_RAW,snapshotRawBytes)){
      // The deltas have outgrown the snapshot: start a segment from the current state.
      const {set:_s,del:_d,put:_p,...rest}=entry;
      line=JSON.stringify({...rest,snapshot:this.state});rollover=true;segment+=1;
    }
    const raw=Buffer.from(line,'utf8'),member=await gzipAsync(Buffer.from(line+'\n','utf8'));
    const path=segmentPath(dir,segment);
    let size;
    if(rollover||!this.head){
      await writeFile(path,member,{mode:0o600});size=member.length;rawBytes=0;
    }else{
      const fh=await open(path,'r+');
      try{await fh.truncate(this.head.bytes);await fh.write(member,0,member.length,this.head.bytes);await fh.sync();}
      finally{await fh.close();}
      size=this.head.bytes+member.length;
    }
    const isSnapshot=entry.snapshot!==undefined||rollover;
    const head={version:1,revision:niOf(raw),segment,seq:entry.seq,bytes:size,rawBytes:isSnapshot?0:rawBytes+raw.length,
      snapshotRawBytes:isSnapshot?raw.length:snapshotRawBytes,at};
    const headText=JSON.stringify(head)+'\n';
    await atomicWrite(headPath(dir),headText);
    const written=member.length+headText.length+outcomeBytes;
    this.head=head;this.open=false;
    cache.set(dir,{revision:head.revision,state:this.state,lent:false});
    if(rollover)await pruneSegments(dir,segment,keepSegments);
    return {revision:head.revision,seq:head.seq,rolledOver:rollover,bytesWritten:written,segmentBytes:member.length,outcomes:entry.outcomes??null};
  }
}

async function pruneSegments(dir,current,keep){
  let names=[];try{names=await readdir(join(dir,'segments'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const name of names){const n=Number.parseInt(name,10);if(Number.isInteger(n)&&n<=current-keep)await rm(join(dir,'segments',name),{force:true});}
}

/** Open the head state for update; an empty ledger yields the empty state `{}` and head null. */
export async function openLedger(dir){
  const head=await readHead(dir);
  if(!head)return new Ledger(dir,null,{});
  const cached=cache.get(dir);
  if(cached&&cached.revision===head.revision&&!cached.lent){cache.delete(dir);return new Ledger(dir,head,cached.state);}
  cache.delete(dir);
  return new Ledger(dir,head,await replayHead(dir,head));
}

/** Read-only head state with its source revision; callers must not mutate it. */
export async function readLedger(dir){
  const head=await readHead(dir);
  if(!head)return {head:null,state:{}};
  const cached=cache.get(dir);
  if(cached&&cached.revision===head.revision){cached.lent=true;return {head,state:cached.state};}
  const state=await replayHead(dir,head);cache.set(dir,{revision:head.revision,state,lent:true});
  return {head,state};
}

export function forgetLedgerCache(dir){if(dir===undefined)cache.clear();else cache.delete(dir);}

/** The entry named by `revision` and the state after it, or null when its segment was pruned. */
export async function findRevision(dir,revision){
  const head=await readHead(dir);
  if(!head)return null;
  for(let n=head.segment;n>=1;n--){
    let entries;
    try{entries=await readSegment(dir,n,n===head.segment?{limit:head.bytes}:{});}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
    const at=entries.findIndex(r=>r.revision===revision);
    if(at<0)continue;
    let state={};
    for(const {entry} of entries.slice(0,at+1))state=applyEntry(state,entry);
    return {entry:entries[at].entry,state};
  }
  return null;
}

/** Lineage rows by their ni name, from the permanent outcomes file; null when not found. */
export async function readOutcomes(dir,ni){
  let bytes;
  try{bytes=await readFile(join(dir,'outcomes.jsonl.gz'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  const prefix=ni+'\t';
  for(const line of (await gunzipAsync(bytes)).toString('utf8').split('\n')){
    if(!line.startsWith(prefix))continue;
    const text=line.slice(prefix.length);
    if(niOf(Buffer.from(text,'utf8'))!==ni)throw new Error('weather outcomes lineage does not hash to its name');
    return JSON.parse(text);
  }
  return null;
}

/** Append lineage rows without a state entry (used by migration); returns their ni name. */
export async function appendOutcomes(dir,outcomes){
  await mkdir(dir,{recursive:true,mode:0o700});
  const text=JSON.stringify(outcomes),ni=niOf(Buffer.from(text,'utf8'));
  await appendFile(join(dir,'outcomes.jsonl.gz'),await gzipAsync(Buffer.from(`${ni}\t${text}\n`,'utf8')),{mode:0o600});
  return ni;
}

/** Every ni name already in the outcomes file (names only; rows are not parsed). */
export async function listOutcomes(dir){
  let bytes;
  try{bytes=await readFile(join(dir,'outcomes.jsonl.gz'));}
  catch(e){if(e.code==='ENOENT')return new Set();throw e;}
  const names=new Set();
  for(const line of (await gunzipAsync(bytes)).toString('utf8').split('\n')){const tab=line.indexOf('\t');if(tab>0)names.add(line.slice(0,tab));}
  return names;
}
