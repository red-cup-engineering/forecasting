#!/bin/sh
# usage: add.sh arm member family durationMs  < json  ; appends answers with latency
D=$(dirname "$0")
node -e '
const [dir,arm,member,family,ms]=process.argv.slice(1);
const t=require("fs").readFileSync(0,"utf8");
const j=JSON.parse(t.slice(t.indexOf("{"),t.lastIndexOf("}")+1));
let n=0;const seen=new Set();
for(const a of j.answers){const id=String(a.id);if(seen.has(id))continue;seen.add(id);const p=Number(a.probability);if(!isFinite(p))continue;
require("fs").appendFileSync(dir+"/answers.jsonl",JSON.stringify({arm,member,family,id,probability:Math.min(.99,Math.max(.01,p)),batchMs:Number(ms),batchItems:j.answers.length,run:"2026-10-04-frontier"})+"\n");n++}
console.log(n+" answers")' "$D" "$@"
