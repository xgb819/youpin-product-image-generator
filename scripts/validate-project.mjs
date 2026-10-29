import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT,sha,readJSON } from './lib/core.mjs';
import { inspectPsd } from './inspect-psd.mjs';

export function psdSummary(file) {
  const p=inspectPsd(file);
  return {width:p.width,height:p.height,texts:p.texts.map(t=>({name:t.name,bounds:t.bounds,text_example:t.text,font:t.style?.font?.name,size:t.style?.fontSize,leading:t.style?.leading,alignment:t.paragraphStyle?.justification}))};
}
export async function validateProject(root=ROOT) {
  const errors=[];let sourceCount=0,textSourceCount=0,templateCount=0,linkCount=0;
  for(const [manifest,collection] of [['sources.json',null],['resource-sources.json','entries']]){
    const data=await readJSON(path.join(root,'references',manifest));
    for(const entry of collection?data[collection]:data){
      const file=path.resolve(root,'references',entry.path);
      if(!file.startsWith(path.resolve(root)+path.sep)){errors.push(`Source outside repository: ${entry.id}`);continue;}
      try{
        const b=await fs.readFile(file);
        if(sha(b)!==entry.sha256||b.length!==entry.bytes)errors.push(`Source integrity mismatch: ${entry.id}`);
      }catch(e){errors.push(`Missing source: ${entry.id}`);}
      sourceCount++;
    }
  }
  try{
    const entry=await readJSON(path.join(root,'references/listing-copy-source.json'));
    const file=path.resolve(root,'references',entry.path);
    if(!file.startsWith(path.resolve(root)+path.sep))errors.push('Text source outside repository');
    else{
      const b=await fs.readFile(file);
      if(sha(b)!==entry.sha256||b.length!==entry.bytes)errors.push('Text source integrity mismatch');
      textSourceCount++;
    }
  }catch{errors.push('Missing listing text source or provenance');}
  const evidence=await readJSON(path.join(root,'references/carousel-template-evidence.json'));
  for(const e of evidence.templates){
    const file=path.resolve(root,e.path);
    if(sha(await fs.readFile(file))!==e.sha256)errors.push(`PSD hash mismatch: ${e.path}`);
    if(JSON.stringify(psdSummary(file))!==JSON.stringify(e.summary))errors.push(`PSD evidence changed: ${e.path}`);
    templateCount++;
  }
  async function walk(dir){
    for(const d of await fs.readdir(dir,{withFileTypes:true})){
      if(['node_modules','.git','.local','runs'].includes(d.name))continue;
      const file=path.join(dir,d.name);
      if(d.isDirectory())await walk(file);
      else if(d.name.endsWith('.md')){
        const text=await fs.readFile(file,'utf8');
        for(const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)){
          const target=m[1].split('#')[0];if(!target||/^(https?:|mailto:)/.test(target))continue;
          try{await fs.access(path.resolve(path.dirname(file),decodeURIComponent(target)));linkCount++;}
          catch{errors.push(`Broken link in ${path.relative(root,file)}: ${target}`);}
        }
      }
    }
  }
  await walk(root);
  return {sourceCount,textSourceCount,templateCount,linkCount,errors};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const r=await validateProject();console.log(JSON.stringify(r,null,2));if(r.errors.length)process.exitCode=1;}
  catch(e){console.error(e.message);process.exitCode=1;}
}
