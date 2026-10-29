// Shared by image text and listing text. No image renderer or font dependency.
function assert(condition,message){if(!condition)throw new Error(message);}
export function resolveCopy(product, ids, skuId, production=false) {
  return ids.filter(Boolean).map(id=>{
    const c=product?.copy?.[id]; assert(c&&typeof c.text==='string'&&c.text.trim(),`Missing copy: ${id}`);
    assert(!/[\r\n]/.test(c.text),'This text slot supports one line');
    assert(['factual','creative'].includes(c.kind),`Unknown copy kind: ${id}`);
    assert(['draft','approved'].includes(c.status),`Unknown copy status: ${id}`);
    if(production)assert(c.status==='approved'&&c.review?.source,`Copy is not approved with a review record: ${id}`);
    const assertions=c.assertions??[];
    assert(Array.isArray(assertions),`Invalid assertions: ${id}`);
    if(c.kind==='factual')assert(assertions.length>0,`Factual copy needs assertions: ${id}`);
    const evidence=[];
    for(const a of assertions){
      const f=product?.facts?.[a.fact_id];
      assert(f&&f.status==='confirmed'&&f.source,`Unconfirmed or unsourced fact: ${a.fact_id}`);
      assert(Array.isArray(f.sku_ids)&&f.sku_ids.includes(skuId),`Fact does not apply to SKU ${skuId}: ${a.fact_id}`);
      assert(Object.hasOwn(a,'equals')&&JSON.stringify(a.equals)===JSON.stringify(f.value),`Contradictory assertion: ${a.fact_id}`);
      evidence.push({fact_id:a.fact_id,value:f.value,source:f.source});
    }
    return {id,text:c.text,kind:c.kind,status:c.status,evidence};
  });
}
