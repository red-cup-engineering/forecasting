#!/usr/bin/env node
/** Move a weather state root's evidence archives into the content tree store. Dry run unless --apply. */
import {resolve} from 'node:path';
import {migrateWeatherEvidence} from '../src/weather-evidence-migration.mjs';
import {weatherRoot,withWeatherCycleLock} from '../src/weather-engine.mjs';
const args=process.argv.slice(2),apply=args.includes('--apply');
const rest=args.filter(a=>a!=='--apply');
if(rest.length>1||rest[0]?.startsWith('--'))throw new Error('usage: migrate-weather-evidence [--apply] [WEATHER_STATE_DIR]');
const root=resolve(rest[0]??weatherRoot());
const run=()=>migrateWeatherEvidence({root,apply,log:m=>console.error(m)});
const report=apply?await withWeatherCycleLock(root,run):await run();
console.log(JSON.stringify(report,null,2));
if(report.failed.length||report.corrupt.length)process.exitCode=1;
