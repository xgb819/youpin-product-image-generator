import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LISTING_FIELDS,countText,textHash,validateListing} from '../scripts/lib/listing-copy.mjs';
import {exportListing} from '../scripts/export-listing-copy.mjs';

const root=path.resolve(process.env.YOUPIN_TEST_TMP||os.tmpdir());
await fs.mkdir(root,{recursive:true});
const temp=await fs.mkdtemp(path.join(root,'youpin-listing-test-'));
after(async()=>{assert.equal(path.dirname(temp),root);assert.ok(path.basename(temp).startsWith('youpin-listing-test-'));await fs.rm(temp,{recursive:true,force:true});});

function fixture(){
  const scope=['green','beige'];
  const fact=value=>({value,status:'confirmed',source:'Synthetic automated-test fixture, not commercial evidence',sku_ids:scope});
  const product={product_id:'synthetic-snake',facts:{brand:fact('测试品牌'),remote:fact(true),two:fact(true),beans:fact(7),colours:fact(['绿色','米色']),lights:fact(false),music:{...fact(null),status:'unknown'}},copy:{}};
  const make=(text,ids,primary_fact_id)=>({text,kind:'factual',status:'draft',assertions:ids.map(fact_id=>({fact_id,equals:product.facts[fact_id].value})),...(primary_fact_id?{primary_fact_id}:{})});
  product.copy={
    product_name:make('测试品牌 遥控吞豆趣味接龙可双机同玩互动贪吃蛇游戏玩具',['brand','remote','two']),
    short_name:make('遥控吞豆贪吃蛇',['remote']),
    description:make('遥控吞豆趣味接龙,可双机同玩互动游戏,每套7个数字豆两色可选',['remote','two','beans','colours']),
    summary:make('遥控吞豆趣味接龙,每套7豆',['remote','beans']),
    selling_point_1:make('操控小蛇吞豆趣味接龙,一节一节接出游戏乐趣',['remote'],'remote'),
    selling_point_2:make('支持两台同时游玩互动接龙,绿色米色均可选择',['two','colours'],'two'),
    selling_point_3:make('绿色米色两款可选,每套搭配7个数字豆玩游戏',['colours','beans'],'colours')
  };
  const manifest={schema_version:1,id:'listing',revision:1,product:'product.json',sku_ids:scope,brand_fact_id:'brand',fields:Object.fromEntries(LISTING_FIELDS.map(f=>[f.id,f.id]))};
  return {product,manifest};
}
const check=f=>validateListing(f.manifest,f.product);
const codes=r=>r.errors.map(e=>e.code);

test('seven requested limits and inclusive conservative counting are explicit',()=>{
  assert.deepEqual(LISTING_FIELDS.map(f=>f.max),[30,8,30,13,24,24,24]);
  assert.equal(countText('中 A,7').count,5);
  assert.equal(countText('😀').count,2);assert.equal(countText('😀').code_points,1);
  const r=check(fixture());assert.deepEqual(r.errors,[]);assert.equal(r.fields.length,7);
});
test('maximum is enforced including spaces and punctuation, preferred minimum is soft',()=>{
  const f=fixture();f.product.copy.summary.text='豆'.repeat(13);assert.ok(!codes(check(f)).includes('over_limit'));
  f.product.copy.summary.text+='豆';assert.ok(codes(check(f)).includes('over_limit'));
  f.product.copy.summary.text='吞豆';const r=check(f);assert.deepEqual(r.errors,[]);assert.ok(r.warnings.some(w=>w.code==='below_preferred_length'));
});
test('missing, extra and creative fields cannot bypass the seven-field contract',()=>{
  const f=fixture();delete f.manifest.fields.summary;assert.ok(codes(check(f)).includes('missing_field'));
  f.manifest.fields.summary='summary';f.manifest.fields.eighth='summary';assert.ok(codes(check(f)).includes('unknown_listing_field'));
  delete f.manifest.fields.eighth;f.product.copy.summary.kind='creative';assert.ok(codes(check(f)).includes('listing_requires_facts'));
});
test('long name binds the actual brand and enforces its single space',()=>{
  const f=fixture();f.product.copy.product_name.text=f.product.copy.product_name.text.replace('测试品牌 ','测试品牌');assert.ok(codes(check(f)).includes('brand_spacing'));
  f.product.copy.product_name.text='测试品牌 遥控吞豆 贪吃蛇';assert.ok(codes(check(f)).includes('name_extra_spacing'));
  f.product.copy.product_name.text='测试品牌 遥控吞豆贪吃蛇';f.product.copy.product_name.assertions.shift();assert.ok(codes(check(f)).includes('brand_not_bound'));
});
test('unsupported, contradictory and SKU-specific facts are rejected',()=>{
  for(const [fact_id,equals] of [['music',true],['lights',true]]){
    const f=fixture();f.product.copy.summary.assertions=[{fact_id,equals}];assert.ok(codes(check(f)).includes('fact_or_approval_error'));
  }
  const f=fixture();f.product.facts.beans.sku_ids=['green'];assert.ok(codes(check(f)).includes('fact_or_approval_error'));
});
test('ordinary profile blocks promotional and unsupported association copy',()=>{
  for(const text of ['新品遥控吞豆','有品贪吃蛇','雷总推荐吞豆','小米遥控玩具']){
    const f=fixture();f.product.copy.summary.text=text;assert.ok(check(f).errors.length,text);
  }
});
test('format validation covers commas, fullwidth separators, emoji and hidden markup',()=>{
  for(const text of ['遥控吞豆，趣味接龙','遥控吞豆＋趣味接龙','遥控吞豆【趣味】','遥控吞豆😀','遥控\u200b吞豆','<b>吞豆</b>','吞豆\n互动','吞豆“互动”']){
    const f=fixture();f.product.copy.summary.text=text;assert.ok(check(f).errors.length,text);
  }
  const f=fixture();f.product.copy.selling_point_1.text+='。';assert.ok(codes(check(f)).includes('point_trailing_punctuation'));
});
test('three core points need different topics and different wording',()=>{
  const f=fixture();f.product.copy.selling_point_2=structuredClone(f.product.copy.selling_point_1);
  const r=check(f);assert.ok(codes(r).includes('duplicate_core_text'));assert.ok(codes(r).includes('duplicate_core_topic'));
  f.product.copy.selling_point_2.text='另一个说法也仍在描述吞豆';assert.ok(codes(check(f)).includes('duplicate_core_topic'));
});
test('source exceptions require specifically confirmed and bound facts',()=>{
  const f=fixture();f.product.copy.summary.text='接入米家';assert.ok(codes(check(f)).includes('unverified_brand_association'));
  f.product.facts.mijia={...f.product.facts.remote};f.manifest.mijia_fact_id='mijia';f.product.copy.summary.assertions.push({fact_id:'mijia',equals:true});assert.deepEqual(check(f).errors,[]);
  f.product.copy.short_name.text='游戏/玩具';assert.ok(codes(check(f)).includes('unverified_category_slash'));
  f.product.facts.parallel={...f.product.facts.remote};f.manifest.parallel_categories_fact_id='parallel';f.product.copy.short_name.assertions.push({fact_id:'parallel',equals:true});assert.deepEqual(check(f).errors,[]);
});
test('formal export requires review of exact text, not a stale approval',()=>{
  const f=fixture();assert.ok(validateListing(f.manifest,f.product,{production:true}).errors.length);
  for(const entry of Object.values(f.product.copy)){entry.status='approved';entry.review={source:'Synthetic test approval only',text_sha256:textHash(entry.text)};}
  assert.deepEqual(validateListing(f.manifest,f.product,{production:true}).errors,[]);
  f.product.copy.summary.text='双机同玩趣味接龙,每套7豆';assert.ok(codes(validateListing(f.manifest,f.product,{production:true})).includes('stale_text_review'));
});
test('text export produces exactly seven lines and three text files without image or font work',async()=>{
  const f=fixture(),dir=path.join(temp,'export');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'product.json'),JSON.stringify(f.product));await fs.writeFile(path.join(dir,'listing.json'),JSON.stringify(f.manifest));
  const out=path.join(dir,'v1'),r=await exportListing(path.join(dir,'listing.json'),{out});
  assert.equal(r.report.mode,'draft');assert.deepEqual(r.report.validation.errors,[]);
  assert.equal((await fs.readFile(r.textFile,'utf8')).trimEnd().split('\n').length,7);
  assert.deepEqual((await fs.readdir(out)).sort(),['listing.md','listing.report.json','listing.txt']);
  assert.ok(r.report.validation.fields.every(f=>f.evidence.length===2));
  const before=await fs.readFile(r.textFile,'utf8');
  f.product.copy.summary.text='双机同玩趣味接龙,每套7豆';f.product.copy.summary.assertions=[{fact_id:'two',equals:true},{fact_id:'beans',equals:7}];
  await fs.writeFile(path.join(dir,'product.json'),JSON.stringify(f.product));
  await assert.rejects(exportListing(path.join(dir,'listing.json'),{out}),/retain history/);
  f.manifest.revision=2;await fs.writeFile(path.join(dir,'listing-v2.json'),JSON.stringify(f.manifest));
  const v2=await exportListing(path.join(dir,'listing-v2.json'),{out:path.join(dir,'v2')});
  assert.equal(await fs.readFile(r.textFile,'utf8'),before);
  for(const original of r.report.validation.fields.filter(f=>f.id!=='summary'))assert.equal(v2.report.validation.fields.find(f=>f.id===original.id).text,original.text);
});
test('invalid copy fails before creating deliverable files',async()=>{
  const f=fixture();f.product.copy.summary.text='豆'.repeat(14);const dir=path.join(temp,'rejected');await fs.mkdir(dir);
  await fs.writeFile(path.join(dir,'product.json'),JSON.stringify(f.product));await fs.writeFile(path.join(dir,'listing.json'),JSON.stringify(f.manifest));
  await assert.rejects(exportListing(path.join(dir,'listing.json'),{out:path.join(dir,'out')}),/over_limit/);
  await assert.rejects(fs.access(path.join(dir,'out')),e=>e.code==='ENOENT');
});
