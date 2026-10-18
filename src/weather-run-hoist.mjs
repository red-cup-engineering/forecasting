/**
 * Run-level hoisting: what every row of one forecast run shares is stored once, not per row.
 *
 * CONTRACT
 *   A forecast run is made at one instant `stamp` (the ISO string of the cycle's `now`). Every row
 *   it computes carries that instant as availableAt (and, for learned pools, as learning.fitAvailableAt
 *   and learning.outcomeReceiptBoundAt), and carries leadHours = (validTime - stamp) / 3600000. Those
 *   change with every run even when a row's forecast does not, which makes consecutive runs' rows
 *   differ byte for byte and defeats the content tree store's sharing.
 *   hoistRun(value, stamp) replaces, anywhere inside value,
 *     - every string equal to `stamp` with the token "@run", and
 *     - every leadHours that equals (validTime - stamp)/3600000 of the same object with null,
 *   keeping key order and everything else, so an unchanged row is identical across runs.
 *   unhoistRun(value, stamp) restores both exactly (the same arithmetic as the producer).
 *   hoistRun refuses (hoisted:false, value unchanged) if the value already uses the token or a
 *   null leadHours, so the pair is lossless: JSON.stringify(unhoistRun(hoistRun(v, s).value, s))
 *   equals JSON.stringify(v). Rows whose availableAt differs from the stamp (a relational forecast
 *   with its own receipt time) keep their own value.
 */
export const RUN_TOKEN='@run';

export function hoistRun(value,stamp){
  const t0=Date.parse(stamp);
  if(!Number.isFinite(t0))return {value,hoisted:false};
  let clash=false;
  const walk=v=>{
    if(typeof v==='string'){if(v===RUN_TOKEN)clash=true;return v===stamp?RUN_TOKEN:v;}
    if(Array.isArray(v))return v.map(walk);
    if(v&&typeof v==='object'){
      const out={};
      const derived=typeof v.validTime==='string'&&typeof v.leadHours==='number'&&v.leadHours===(Date.parse(v.validTime)-t0)/3600000;
      for(const [k,x] of Object.entries(v)){
        if(k==='leadHours'&&derived)out[k]=null;
        else{if(k==='leadHours'&&x===null)clash=true;out[k]=walk(x);}
      }
      return out;
    }
    return v;
  };
  const hoisted=walk(value);
  return clash?{value,hoisted:false}:{value:hoisted,hoisted:true};
}

export function unhoistRun(value,stamp){
  const t0=Date.parse(stamp);
  const walk=v=>{
    if(v===RUN_TOKEN)return stamp;
    if(Array.isArray(v))return v.map(walk);
    if(v&&typeof v==='object'){
      const out={};
      for(const [k,x] of Object.entries(v))out[k]=k==='leadHours'&&x===null?(Date.parse(v.validTime)-t0)/3600000:walk(x);
      return out;
    }
    return v;
  };
  return walk(value);
}
