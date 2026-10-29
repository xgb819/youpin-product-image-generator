import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateListing} from './lib/listing-copy.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const md=text=>String(text).replaceAll('|','\\|').replaceAll('\n',' ');
export async function exportListing(manifestFile,{out,production=false,replace=false}={}){
  if(!out)throw Error('--out is required');
  const file=path.resolve(manifestFile),raw=await fs.readFile(file),s=JSON.parse(raw);
  if(typeof s.product!=='string'||!s.product)throw Error('product must reference the persisted product-facts JSON');
  const productFile=path.resolve(path.dirname(file),s.product),productRaw=await fs.readFile(productFile),product=JSON.parse(productRaw);
  const validation=validateListing(s,product,{production});
  if(validation.errors.length)throw Error(`Listing rejected: ${validation.errors.map(e=>`${e.field??'manifest'}:${e.code}`).join(', ')}`);
  const txt=validation.fields.map(f=>`${f.label}：${f.text}`).join('\n')+'\n';
  const report={schema_version:1,id:s.id,revision:s.revision,mode:production?'production':'draft',product_id:product.product_id??null,sku_ids:s.sku_ids,manifest_sha256:hash(raw),product_sha256:hash(productRaw),output_sha256:hash(Buffer.from(txt)),validation};
  const dir=path.resolve(out);await fs.mkdir(dir,{recursive:true});
  const base=path.join(dir,s.id),reportFile=base+'.report.json';
  try{
    const old=JSON.parse(await fs.readFile(reportFile,'utf8'));
    if(!replace&&(old.revision!==s.revision||old.output_sha256!==report.output_sha256))throw Error('Use a new revision and output directory to retain history');
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const rows=validation.fields.map(f=>`| ${f.label} | ${md(f.text)} | ${f.count}/${f.max} | ${f.count>=f.preferred_min?'接近上限':'内容较短，不强行填充'} |`).join('\n');
  const notes=validation.warnings.map(w=>`- ${w.field??'整体'}：${w.code} — ${w.message}`).join('\n');
  const markdown=`# 上架七字段文案\n\n状态：${production?'已提供逐字段审核记录，仍需按实际后台复核':'草稿，已复用现有商品事实，不代表用户已审定本轮措辞'}。这是纯文字输出，未生成图片。\n\n| 字段 | 内容 | 字数/上限 | 长度提示 |\n|---|---|---|---|\n${rows}\n\n计数：空格、数字、英文及标点均计入，以UTF-16码元保守计算；后台口径未独立实测。\n\n${validation.source_notes.map(n=>'- '+n).join('\n')}\n\n${notes?'待核对提示：\n\n'+notes+'\n':''}\n逐句事实依据与文本哈希见同名report.json。字数及格式通过不等于自然语言宣传或法律审核通过。\n`;
  const outputs=[[base+'.txt',txt],[base+'.md',markdown],[reportFile,JSON.stringify(report,null,2)]];
  for(const [target,data] of outputs){const temp=target+`.${process.pid}.tmp`;try{await fs.writeFile(temp,data,'utf8');await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}}
  return {textFile:base+'.txt',markdownFile:base+'.md',reportFile,report};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),opts={};let manifest;
    for(let i=0;i<args.length;i++){
      if(args[i]==='--out'){if(!args[i+1])throw Error('Missing --out value');opts.out=args[++i];}
      else if(args[i]==='--production')opts.production=true;
      else if(args[i]==='--replace')opts.replace=true;
      else if(!manifest&&!args[i].startsWith('-'))manifest=args[i];else throw Error(`Unknown argument: ${args[i]}`);
    }
    if(!manifest)throw Error('Usage: node scripts/export-listing-copy.mjs listing.json --out run-dir [--production]');
    const r=await exportListing(manifest,opts);console.log(JSON.stringify({textFile:r.textFile,report:r.reportFile,mode:r.report.mode,counts:r.report.validation.fields.map(f=>({field:f.label,count:f.count,max:f.max})),warnings:r.report.validation.warnings}));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
