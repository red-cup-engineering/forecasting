#!/usr/bin/env node
/** The weather store's archives of aged derived records. --list shows them; --restore <day> imports one back (the file must be at <root>/archive/<day>.ctar; offload-host-state --restore fetches it from R2). */
import {resolve} from 'node:path';
import {archiveFile,readArchiveIndex,restoreArchive} from '../src/weather-archive.mjs';
import {weatherRoot,withWeatherCycleLock} from '../src/weather-engine.mjs';
const args=process.argv.slice(2),flag=args[0],day=args[1];
const usage='usage: forecasting-weather-archive --list [WEATHER_STATE_DIR] | --restore YYYY-MM-DD [WEATHER_STATE_DIR]';
if(flag==='--list'){
  const root=resolve(args[1]??weatherRoot());
  console.log(JSON.stringify(await readArchiveIndex(root),null,2));
}else if(flag==='--restore'&&day){
  const root=resolve(args[2]??weatherRoot());
  try{console.log(JSON.stringify(await withWeatherCycleLock(root,()=>restoreArchive({root,day})),null,2));}
  catch(error){
    console.error(error.message);
    if(error.code==='WEATHER_ARCHIVE_NOT_LOCAL')console.error(`expected at ${archiveFile(root,day)}`);
    process.exitCode=1;
  }
}else throw new Error(usage);
