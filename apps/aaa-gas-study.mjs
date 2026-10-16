#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compareAaaGasParticipation} from '@red-cup-engineering/forecasting/aaa-gas-participation';
import {replayFuelMakerFillSelection} from '../src/fuel-maker-fill-retrospective.mjs';

const [mode,path,...other]=process.argv.slice(2);
if(!['pooled-fuel-fill','participation'].includes(mode)||!path||other.length)
 throw new TypeError('usage: aaa-gas-study.mjs pooled-fuel-fill CSV_PATH | participation JSON_PATH');
const raw=await readFile(path);
if(raw.length>16_000_000)throw new RangeError('research input is too large');
const text=raw.toString('utf8');
const report=mode==='pooled-fuel-fill'
 ? replayFuelMakerFillSelection({csv:text,sourceId:createHash('sha256').update(raw).digest('hex')})
 : compareAaaGasParticipation(JSON.parse(text));
process.stdout.write(JSON.stringify({entrypoint:'read-only-aaa-research-v1',mode,
 inputBytes:raw.length,report},null,2)+'\n');
