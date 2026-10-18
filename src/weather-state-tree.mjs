/**
 * Mutable weather state kept as content trees.
 *
 * CONTRACT
 *   A piece of state that changes a little each cycle (the station-science state, the desk's
 *   pending forecasts, the grades, latest) is a JSON value stored whole with
 *   `store.put(value)` and named by a ref in the weather root's content tree store
 *   (computer-file-engineering-services-section/content-tree-store). The store cuts the value
 *   into prolly-tree chunks, so a cycle writes only the chunks that changed; the ref moves to
 *   the new root only after every new node is durable (setRef flushes first). The previous root
 *   stays readable until gc, and anything a ref or a link reaches is kept: retention is
 *   reachability, there are no pruning rules here.
 *   The root address (an ni name) is the value's revision.
 *   openTree/saveTree hand a loaded value to one writer at a time: a value saved in this
 *   process is kept so the next open of the same ref replays nothing; the writer owns it until
 *   it saves again. Callers hold the cycle lock.
 *   importLegacyFile moves a pre-tree JSON file into a ref: put, read back, compare the JSON
 *   digest, name it, and only then remove the file.
 */
import {createHash} from 'node:crypto';
import {removeFile} from '@red-cup-engineering/computer-file-engineering-services-section/remove-file';
import {readFileText} from '@red-cup-engineering/computer-file-engineering-services-section/read-file';

export const jsonDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const slots=new WeakMap();
const slotsOf=store=>{if(!slots.has(store))slots.set(store,new Map());return slots.get(store);};

/** The value a ref names, owned by the caller; null if the ref does not exist. */
export async function openTree(store,ref){
  const address=await store.getRef(ref);
  if(!address)return null;
  const held=slotsOf(store).get(ref);
  if(held&&held.address===address){slotsOf(store).delete(ref);return {address,value:held.value};}
  slotsOf(store).delete(ref);
  return {address,value:await store.get(address)};
}
/** A value the caller must not mutate (no ownership taken). */
export async function readTree(store,ref){
  const address=await store.getRef(ref);
  return address?{address,value:await store.get(address)}:null;
}
/** Store `value`, name it by `ref`; resolves the root address. The ref is touched only if it moved. */
export async function saveTree(store,ref,value){
  const address=await store.put(value);
  if(await store.getRef(ref)!==address)await store.setRef(ref,address);
  else await store.flush();
  slotsOf(store).set(ref,{address,value});
  return address;
}
/** Read a pre-tree JSON file into `ref`, verified, then remove it. Resolves the address, or null if the file is absent. */
export async function importLegacyFile({store,ref,path,wrap=value=>value}){
  let text;
  try{text=await readFileText(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  const value=wrap(JSON.parse(text));
  const address=await store.put(value);
  if(jsonDigest(await store.get(address))!==jsonDigest(value))throw new Error(`${path} was not reproduced by its tree; file kept`);
  await store.setRef(ref,address);
  await removeFile({path});
  return address;
}
/** Give a value back unchanged (nothing to save) so the next open in this process replays nothing. */
export function releaseTree(store,ref,address,value){slotsOf(store).set(ref,{address,value});}
