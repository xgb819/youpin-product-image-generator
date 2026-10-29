import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON,checkImage,assert } from './lib/core.mjs';

export async function verifyImage(file,reportFile){return checkImage(file,await readJSON(reportFile));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),index=args.indexOf('--report');assert(args[0]&&index>=0&&args[index+1],'Usage: node scripts/verify-image.mjs image --report image.report.json');
    const result=await verifyImage(args[0],args[index+1]);console.log(JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
