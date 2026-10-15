import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNbhBulletin} from '../src/nbm-hourly-guidance.mjs';
const hours=h=>Array.from({length:25},(_,i)=>String((h+i+1)%24).padStart(3)).join('');
const row=(label,v)=>` ${label.padEnd(4)}`+Array.from({length:25},(_,i)=>String(v+i%3).padStart(3)).join('');
const block=(station,date)=>[`   ${station}  NBM V5.0 NBH GUIDANCE    ${date}  1200 UTC`,` UTC ${hours(12)}`,row('TMP',78),row('TSD',1),''].join('\n');
test('headers parse with an unpadded month, as NOAA prints for January to September',()=>{
 const m=parseNbhBulletin(block('KMIA','9/20/2026')+'\n'+block('KFLL','10/13/2026'),['KMIA','KFLL']);
 assert.equal(m.get('KMIA').runtime,'2026-09-20T12:00:00.000Z');
 assert.equal(m.get('KFLL').runtime,'2026-10-13T12:00:00.000Z');
 assert.equal(m.get('KMIA').rows.length,25);
 assert.equal(m.get('KMIA').rows[0].tmp,78);
});
