import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolveCopy} from './copy-evidence.mjs';

export const LISTING_PROFILE=JSON.parse(readFileSync(new URL('../../references/listing-fields.json',import.meta.url),'utf8'));
export const LISTING_FIELDS=LISTING_PROFILE.fields;
export const textHash=text=>createHash('sha256').update(text,'utf8').digest('hex');
export function countText(text){return {count:text.length,code_points:[...text].length,mode:LISTING_PROFILE.counting};}
const canonical=text=>text.normalize('NFKC').replace(/[\p{P}\p{Z}\p{S}]/gu,'').toLowerCase();
const promotion=['新品','有品定制','内购','新人专享','包邮','秒杀','折扣','满减','优惠券','限时抢购'];
const brandAssets=['有品','小米','Xiaomi','Redmi','雷军','米家','小爱同学','米兔','MIUI','POCO','雷总'];

export function validateListing(manifest,product,{production=false}={}){
  const errors=[],warnings=[],fields=[];
  const issue=(target,field,code,message)=>target.push({field,code,message});
  const fail=(field,code,message)=>issue(errors,field,code,message);
  const warn=(field,code,message)=>issue(warnings,field,code,message);
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return {errors:[{code:'invalid_manifest'}],warnings,fields};
  const allowed=new Set(['schema_version','id','revision','product','sku_ids','brand_fact_id','mijia_fact_id','parallel_categories_fact_id','fields']);
  for(const k of Object.keys(manifest))if(!allowed.has(k))fail(null,'unknown_manifest_field',k);
  if(manifest.schema_version!==1)fail(null,'invalid_schema_version','schema_version must be 1');
  if(typeof manifest.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(manifest.id))fail(null,'invalid_id','Invalid listing id');
  if(!Number.isInteger(manifest.revision)||manifest.revision<1)fail(null,'invalid_revision','revision must be positive');
  const skus=manifest.sku_ids;
  if(!Array.isArray(skus)||!skus.length||skus.some(s=>typeof s!=='string'||!s)||new Set(skus).size!==skus.length)fail(null,'invalid_sku_ids','sku_ids must be distinct nonempty strings');
  const validSkus=Array.isArray(skus)&&skus.length?skus:[];
  const mapping=manifest.fields;
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))fail(null,'invalid_fields','A seven-field copy-ID mapping is required');
  else for(const k of Object.keys(mapping))if(!LISTING_FIELDS.some(f=>f.id===k))fail(k,'unknown_listing_field','Do not invent an eighth field');
  const scopedFact=id=>{
    const f=product?.facts?.[id];
    if(!f||f.status!=='confirmed'||!f.source||!Array.isArray(f.sku_ids)||!validSkus.every(s=>f.sku_ids.includes(s)))return null;
    return f;
  };
  const brandFact=manifest.brand_fact_id?scopedFact(manifest.brand_fact_id):null;
  const brand=typeof brandFact?.value==='string'?brandFact.value:null;
  if(manifest.brand_fact_id&&!brand)fail('product_name','unconfirmed_brand','Brand must be a sourced confirmed fact applying to all listed SKUs');
  if(!manifest.brand_fact_id)(production?fail:warn)('product_name','brand_missing','Reuse the confirmed brand if available; do not invent one');
  const parallel=manifest.parallel_categories_fact_id?scopedFact(manifest.parallel_categories_fact_id):null;
  const mijia=manifest.mijia_fact_id?scopedFact(manifest.mijia_fact_id):null;
  for(const def of LISTING_FIELDS){
    const copyId=mapping?.[def.id],entry=product?.copy?.[copyId];
    if(typeof copyId!=='string'||!copyId||!entry||typeof entry.text!=='string'||!entry.text.trim()){
      fail(def.id,'missing_field','Each requested field needs a nonempty copy entry');continue;
    }
    const text=entry.text,c=countText(text),isName=['product_name','short_name'].includes(def.id),isPoint=def.id.startsWith('selling_point_');
    const bound=new Set((Array.isArray(entry.assertions)?entry.assertions:[]).map(a=>a.fact_id));
    const evidence=[];
    if(entry.kind!=='factual')fail(def.id,'listing_requires_facts','Listing fields must bind factual assertions; creative is not an evidence bypass');
    for(const sku of validSkus){
      try{const r=resolveCopy(product,[copyId],sku,production)[0];evidence.push({sku_id:sku,facts:r.evidence});}
      catch(e){fail(def.id,'fact_or_approval_error',e.message);}
    }
    if(production&&entry.review?.text_sha256!==textHash(text))fail(def.id,'stale_text_review','Approved review must match the exact current text hash');
    if(c.count>def.max)fail(def.id,'over_limit',`${c.count}/${def.max}; rewrite the phrase, do not cut it blindly`);
    if(c.count<def.preferred_min)warn(def.id,'below_preferred_length',`${c.count}/${def.max}; improve only with supported content, never pad with new claims`);
    if(text!==text.trim()||/[\r\n\t\p{C}\u00a0]/u.test(text))fail(def.id,'invalid_whitespace','No leading/trailing, multiline, control or invisible characters');
    if(/\p{Extended_Pictographic}/u.test(text))fail(def.id,'emoji_not_supported','Use ordinary text for predictable platform counting');
    if(/<[^>]+>/.test(text))fail(def.id,'markup_not_plain_text','Do not export HTML markup');
    if(!canonical(text))fail(def.id,'no_meaningful_content','Text cannot consist only of punctuation');
    const promo=promotion.filter(t=>text.includes(t));if(promo.length)fail(def.id,'promotional_copy',promo.join(', '));
    if(/雷总同款|雷总直播间|雷总推荐|牙医推荐|爆品推荐/.test(text))fail(def.id,'unsupported_endorsement','Unsupported endorsement or platform association');
    if(/[|｜「」・【】+]/u.test(text.normalize('NFKC')))fail(def.id,'forbidden_separator','Use the ordinary naming/selling-point profile; endorsement exceptions require separate review');
    if(/[“”‘’]/u.test(text))fail(def.id,'use_ascii_quotes','Use ASCII double quotes when quotation is needed');
    if(isName){
      let rest=text;
      if(def.id==='product_name'&&brand){
        if(!text.startsWith(brand+' '))fail(def.id,'brand_spacing','Long name starts with the confirmed brand and one ASCII space');
        else rest=text.slice(brand.length+1);
        if(!bound.has(manifest.brand_fact_id))fail(def.id,'brand_not_bound','The long-name assertion set must include the brand fact');
      }else if(def.id==='short_name'&&brand&&rest.startsWith(brand))rest=rest.slice(brand.length).replace(/^ /,'');
      if(/\s/u.test(rest))fail(def.id,'name_extra_spacing','Do not separate name clauses with spaces');
      let punctuation=rest.replaceAll('"','');
      if((text.match(/"/g)?.length??0)%2)fail(def.id,'unbalanced_quotes','Use balanced ASCII quotes');
      if(punctuation.includes('/')){
        if(parallel?.value===true&&bound.has(manifest.parallel_categories_fact_id))punctuation=punctuation.replaceAll('/','');
        else fail(def.id,'unverified_category_slash','Slash requires a confirmed parallel-category fact');
      }
      if(/[\p{P}\p{S}]/u.test(punctuation))fail(def.id,'name_punctuation','Ordinary names do not use punctuation to separate phrases');
      if(/有品/.test(text))fail(def.id,'platform_in_name','Names cannot contain 有品 or 小米有品');
      if(/[A-Za-z]/.test(rest))warn(def.id,'english_name_review','Check familiar terms, Title Case and proper-noun exceptions against actual product facts');
      if(/\d/.test(rest))warn(def.id,'spec_in_name_review','The source recommends omitting specifications from long names; do not add numbers to fill length');
    }else{
      if(/[，、；;]/u.test(text))fail(def.id,'use_ascii_comma','Use ASCII comma for clause separation');
      if(/\b(?:APP|app)\b/.test(text))fail(def.id,'app_case','Use App');
      if(isPoint&&/[,，。.!！?？:：;；、]$/u.test(text))fail(def.id,'point_trailing_punctuation','No sentence punctuation at the end of a core selling point');
    }
    let associations=text;
    if(brandAssets.some(t=>t.toLowerCase()===brand?.toLowerCase())&&bound.has(manifest.brand_fact_id))associations=associations.split(brand).join('');
    if(associations.includes('接入米家')&&mijia?.value===true&&bound.has(manifest.mijia_fact_id))associations=associations.replaceAll('接入米家','');
    const unauthorized=brandAssets.filter(t=>associations.toLowerCase().includes(t.toLowerCase()));
    if(unauthorized.length)fail(def.id,'unverified_brand_association',unauthorized.join(', '));
    if(/提升(?:智力|专注力)|开发智力|绝不|永不|零风险|100%|认证|检测|食品级|无毒/.test(text))warn(def.id,'claim_needs_semantic_review','Match the exact claim, evidence and scope; this scanner does not decide legal compliance');
    if(/\d(?:\.\d+)?\s*(?:毫升|厘米|千米|千克|克|米)(?!色|豆)/u.test(text))warn(def.id,'unit_notation_review','Check standard mL/m/km/cm/g/kg notation');
    if(isPoint){
      if(!entry.primary_fact_id||!bound.has(entry.primary_fact_id))fail(def.id,'missing_primary_fact','Core points need distinct primary facts included in their assertions');
    }
    fields.push({...def,copy_id:copyId,text,...c,primary_fact_id:entry.primary_fact_id??null,text_sha256:textHash(text),copy_status:entry.status,evidence});
  }
  const points=fields.filter(f=>f.id.startsWith('selling_point_'));
  if(new Set(points.map(f=>canonical(f.text))).size<points.length)fail(null,'duplicate_core_text','Three selling points cannot repeat the same content');
  if(points.length===3&&new Set(points.map(f=>f.primary_fact_id)).size!==3)fail(null,'duplicate_core_topic','Core points must focus on different primary facts');
  const name=fields.find(f=>f.id==='product_name');
  if(name&&points.some(f=>canonical(f.text)===canonical(name.text)))fail(null,'point_copies_name','A selling point cannot copy the product name');
  return {profile_id:LISTING_PROFILE.profile_id,errors,warnings,fields,source_notes:LISTING_PROFILE.source_notes,review:['Natural-language evidence support and semantic repetition still need review','Backend counting has not been independently measured']};
}
