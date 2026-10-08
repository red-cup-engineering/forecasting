import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {parseNbhBulletin,latestHourlyGuidance} from '../../../../src/nbm-hourly-guidance.mjs';
const text=await readFile(new URL('../fixtures/nbh-station-blocks.txt',import.meta.url),'utf8'),parsed=parseNbhBulletin(text,['KMIA','KNYC','KLAX']);
assert.equal(parsed.size,3);
for(const b of parsed.values()){assert.equal(b.rows.length,25);assert.equal(Date.parse(b.rows[0].ftime)-Date.parse(b.runtime),3600000);assert.equal(Date.parse(b.rows.at(-1).ftime)-Date.parse(b.runtime),25*3600000);assert(b.rows.every(r=>Number.isFinite(r.tmp)&&Number.isFinite(r.tsd)));}
assert.equal(parsed.get('KMIA').rows[0].tmp,79);assert.equal(parsed.get('KMIA').rows[0].tsd,1);assert.equal(parsed.get('KMIA').rows[13].ftime,'2026-10-08T00:00:00.000Z');
assert.equal(parseNbhBulletin(text.replace('UTC  11 12','UTC  12 12'),['KMIA']).size,0);
const bad=text.replace('TMP  79 79','TMP 999 79').replace('TSD   1  1','TSD 999  1');assert.equal(parseNbhBulletin(bad,['KMIA']).get('KMIA').rows[0].tmp,null);assert.equal(parseNbhBulletin(bad,['KMIA']).get('KMIA').rows[0].tsd,null);
const cacheDir=await mkdtemp('/tmp/weather-nbh-cache-proof-');let reads=0;const fetchImpl=async()=>{reads++;return {ok:true,status:200,text:async()=>text};},now=Date.parse('2026-10-07T10:59:00Z');
await latestHourlyGuidance({stations:['KMIA'],now,cacheDir},{fetchImpl});await latestHourlyGuidance({stations:['KNYC'],now,cacheDir},{fetchImpl});const both=await latestHourlyGuidance({stations:['KMIA','KNYC'],now,cacheDir},{fetchImpl});assert.equal(reads,2);assert(both.stations.KMIA&&both.stations.KNYC);
console.log(JSON.stringify({stations:parsed.size,hours:25,midnightRollover:true,missingSentinelsRejected:true,coherentRun:true,subsetCachePreservesEarlierStations:true}));
