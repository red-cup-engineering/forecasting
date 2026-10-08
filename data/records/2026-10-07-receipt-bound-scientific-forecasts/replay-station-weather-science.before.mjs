/** Verify archived physical station forecasts without changing live science or market state. */
import {readdir,stat,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {updateStationScience,readStationScience} from '../src/station-weather-science.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--archives','--universe','--output'].includes(args[i])||!args[i+1])throw new Error('usage: --archives EVIDENCE_DIRECTORY --universe LATEST_JSON --output NEW_REPLAY_DIRECTORY');options[args[i].slice(2)]=resolve(args[i+1]);}
if(!options.archives||!options.universe||!options.output)throw new Error('archives, universe and output required');
// Refuse existing outputs, especially live state. Replay is an isolated retrospective experiment.
await mkdir(options.output,{recursive:false,mode:0o700});
const universe=JSON.parse(await readFile(options.universe,'utf8')),bindings=new Map();
for(const c of universe.contracts??[]){const b=c.binding;if(b)bindings.set(b.station,{station:b.station,timeZone:b.timeZone});}
const files=await Promise.all((await readdir(options.archives)).filter(n=>/^[a-f0-9]{64}\.json\.gz$/.test(n)).map(async name=>({name,mtime:(await stat(join(options.archives,name))).mtimeMs})));
files.sort((a,b)=>a.mtime-b.mtime||a.name.localeCompare(b.name));
let packets=0,skipped=0,scored=0,forecasted=0;const outcomes=[];
for(const {name,mtime} of files){
 const e=JSON.parse(gunzipSync(await readFile(join(options.archives,name))));
 if(e.science||![e.local,e.guidance,e.hourlyGuidance,e.lamp,e.indices,e.observations,e.ecmwfEnsemble||e.relational].some(v=>v&&typeof v==='object'&&!Array.isArray(v))||Date.parse(e.at)>mtime){skipped++;continue;}
 e.stations??=[...bindings.values()].filter(r=>e.local?.[r.station]||e.guidance?.stations?.[r.station]);
 const result=await updateStationScience(e,{root:options.output,now:mtime,sourceEvidenceId:name.slice(0,64)});
 packets++;scored+=result.scored;forecasted+=result.forecasted;outcomes.push(...result.outcomes);
}
const report={evaluation:'retrospective replay of immutable archived forecasts; filesystem write time conservatively defines availability; latest contracts supply only station time zones; does not qualify trading or seed production calibration',packets,skipped,scored,forecasted,...await readStationScience({root:options.output})};
await writeFile(join(options.output,'outcomes.jsonl'),outcomes.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600});
await writeFile(join(options.output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
