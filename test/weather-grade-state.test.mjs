import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,writeFileSync,appendFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createModelGradeAccumulator} from '../src/weather-learning.mjs';
import {gradeHistory,gradable,createCompactGradeAccumulator} from '../src/weather-grade-state.mjs';

/**
 * 443 rows of the desk's real resolved.jsonl (Cold Red Gate, 2026-10-18: every sixtieth row, and 120 consecutive ones so
 * that a contract is forecast more than once). The reference is the grading this replaced, verbatim: two passes over the
 * rows with the object-per-entry accumulator.
 */
const lines=gunzipSync(readFileSync(new URL('./fixtures/resolved-rows-sample.jsonl.gz',import.meta.url))).toString('utf8').split('\n').filter(Boolean);
const key=(r,m)=>`${r.ticker}/${r.stage}/${r.ruleKey}/${m.id}`;
function reference(texts){
  const rows=texts.map(l=>JSON.parse(l)),first=new Map();
  for(const r of rows)if(gradable(r))for(const m of r.models){const k=key(r,m),at=first.get(k);if(at===undefined||r.at.localeCompare(at)<0)first.set(k,r.at);}
  const accumulator=createModelGradeAccumulator();
  for(const r of rows)if(gradable(r))for(const m of r.models){const k=key(r,m);if(first.get(k)!==r.at)continue;first.delete(k);accumulator.add({...r,models:[m]});}
  return accumulator.report();
}
const json=value=>JSON.stringify(value);

test('the compact accumulator writes the report of the object accumulator, byte for byte, on real rows',()=>{
  const rows=lines.map(l=>JSON.parse(l)),compact=createCompactGradeAccumulator(),plain=createModelGradeAccumulator();
  for(const r of rows)if(gradable(r))for(const m of r.models){compact.add({...r,models:[m]});plain.add({...r,models:[m]});}
  const report=compact.report();
  assert.ok(Object.keys(report).length>100,'many groups were graded');
  assert.equal(json(report),json(plain.report()));
});

test('grading a file is the grading the object accumulator gave, whatever order the rows were appended in',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'grade-state-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'resolved.jsonl');
  assert.deepEqual(await gradeHistory({path}),{},'no file, no grades');
  writeFileSync(path,lines.map(l=>l+'\n').join(''));
  assert.equal(json(await gradeHistory({path})),json(reference(lines)));
  // a forecast scored after a later one for the same key is the earliest of its key, and replaces the one counted
  const earlier=lines.map(l=>JSON.parse(l)).filter(gradable).find(r=>r.models.some(m=>Number.isFinite(m.p)&&m.p>=0&&m.p<=1));
  const moved=json({...earlier,id:earlier.id+'-earlier',at:new Date(Date.parse(earlier.at)-60_000).toISOString()});
  appendFileSync(path,moved+'\n');
  assert.equal(json(await gradeHistory({path})),json(reference([...lines,moved])));
  // reversed, shuffled: the same rows give the same grades up to the order the report lists them in
  const shuffled=[...lines].reverse();writeFileSync(path,shuffled.map(l=>l+'\n').join(''));
  assert.equal(json(await gradeHistory({path})),json(reference(shuffled)));
  // a last line still being written is not a row yet
  writeFileSync(path,lines.map(l=>l+'\n').join('')+lines[0].slice(0,100));
  assert.equal(json(await gradeHistory({path})),json(reference(lines)));
});
