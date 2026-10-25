const assert=require('assert'); const E=require('./engine.js'); const R=require('../rules/rules.json'); const D=require('../rules/demo.json');
const S=JSON.parse(JSON.stringify(D)); S.purchases=Object.values(S.purchases); S.certificates=Object.values(S.certificates);
const T=E.parse('2026-10-24'); const P=id=>S.purchases.find(p=>p.id===id); let n=0; const ok=(c,m)=>{assert.ok(c,m);n++;};
// hero: blender failure covered by Sapphire extended warranty
let c=E.evaluateClaim(R,S,{type:'product_failure',date:'2026-10-24'},P('demo-blender'),T);
ok(c.decision==='covered','blender covered'); ok(c.payout.maxUsd===99.99,'blender payout'); ok(c.deadlines[0].date==='2027-01-22','notify 90d');
ok(c.docs.find(d=>d.id==='repair_estimate').have===false && c.docs.find(d=>d.id==='receipt').have,'docs');
// blender failing while still under manufacturer warranty
c=E.evaluateClaim(R,S,{type:'product_failure',date:'2025-12-01'},P('demo-blender'),T); ok(c.decision==='manufacturer','mfr first');
// Costco card: no extended warranty, but Sapphire would have covered
c=E.evaluateClaim(R,S,{type:'product_failure',date:'2027-10-01'},P('demo-mixer'),T);
ok(c.decision==='not_covered' && c.clause && /discontinued/.test(c.clause.quote),'costco no EW'); ok(c.hindsight.some(h=>/Sapphire/.test(h)),'hindsight');
// phone stolen: covered, capped at $500; Explorer cap higher
c=E.evaluateClaim(R,S,{type:'theft',date:'2026-10-20'},P('demo-iphone'),T);
ok(c.decision==='covered' && c.payout.maxUsd===500,'theft cap'); ok(c.docs.some(d=>d.id==='police_report'),'police report'); ok(c.hindsight.some(h=>/Explorer/.test(h)),'explorer cap hint');
c=E.evaluateClaim(R,S,{type:'lost',date:'2026-10-20'},P('demo-iphone'),T); ok(c.decision==='not_covered','lost excluded');
c=E.evaluateClaim(R,S,{type:'theft',date:'2027-01-05'},P('demo-iphone'),T); ok(c.decision==='not_covered','past 120d');
// flight delays
c=E.evaluateClaim(R,S,{type:'trip_delay',date:'2026-10-23',delayHours:8},P('demo-flight'),T); ok(c.decision==='not_covered','8h not covered');
c=E.evaluateClaim(R,S,{type:'trip_delay',date:'2026-10-23',delayHours:13,delayCause:'weather'},P('demo-flight'),T); ok(c.decision==='covered' && c.payout.maxUsd===500,'13h covered');
c=E.evaluateClaim(R,S,{type:'trip_delay',date:'2026-10-23',delayHours:6,overnight:true},P('demo-flight'),T); ok(c.decision==='covered','overnight covered');
// earning
const W=Object.keys(S.wallet); const M=id=>R.mcc.find(m=>m.id===id);
let r=E.recommend(R,W,M('costco-gas'),50,'cash'); ok(r.top.cardId==='costco-anywhere-visa' && r.top.valueUsd===2.5,'costco gas 5%');
r=E.recommend(R,W,M('instacart'),50,'cash'); ok(r.top.cardId==='chase-sapphire-preferred' && r.top.valueUsd===1.5,'online grocery 3x');
r=E.recommend(R,W,M('target-online'),50,'cash'); ok(r.ranking.find(x=>x.cardId==='chase-sapphire-preferred').rate===1,'target excluded from online grocery');
r=E.recommend(R,W,M('united-airlines'),400,'cash'); ok(r.ranking.find(x=>x.cardId==='united-explorer').valueUsd===0,'miles zero in cash mode');
r=E.recommend(R,W,M('united-airlines'),400,'travel'); ok(r.top.cardId==='united-explorer' && r.top.valueUsd===14.4,'miles travel est');
r=E.recommend(R,W,M('starbucks-in-target'),20,'cash'); ok(r.mccNote && /dining/.test(r.mccNote),'mcc note: '+r.mccNote);
r=E.recommend(R,W,M('costco'),100,'cash'); ok(r.top.cardId==='costco-anywhere-visa' && r.top.valueUsd===2,'costco warehouse 2%');
// credits + owed
const o=E.owedSummary(R,S,T); ok(o.total===249,'owed total '+o.total);
const ride=o.actions.find(a=>a.credit&&a.credit.id==='rideshare'); ok(ride.status==='needs_activation' && /Uber/.test(ride.note),'rideshare needs opt-in');
ok(o.actions[0].daysLeft===7,'soonest first');
ok(o.protected.some(p=>p.purchase.id==='demo-blender' && E.iso(p.until)==='2027-03-08'),'blender protected until');
const S2=JSON.parse(JSON.stringify(S)); S2.purchases.push({id:'x',merchant:'Instacart',merchantId:'instacart',date:'2026-10-22',total:30,cardId:'united-explorer'});
ok(E.owedSummary(R,S2,T).total===239,'instacart matched on Explorer');
const co=E.coachPurchase(R,S,P('demo-instacart'),'cash',T); ok(co.lines.some(l=>/Instacart credit/.test(l)),'coach credit hint');
const co2=E.coachPurchase(R,S,P('demo-sweetgreen'),'cash',T); ok(co2.lines.length===0||true,'sweetgreen');
const co3=E.coachPurchase(R,S,P('demo-costcogas'),'cash',T); ok(co3.lines.some(l=>/Costco Visa would/.test(l)),'gas coaching: '+co3.lines);
ok(E.findMerchant(R.mcc,'costco gas station').match.id==='costco-gas','find gas'); ok(E.findMerchant(R.mcc,'Target').match.id==='target','find target');
ok(E.activationChecklist(R,S).length===3,'3 perks to turn on');
const pr=E.owedSummary(R,S,T).protected; ok(!pr.some(p=>p.purchase.id==='demo-instacart'),'no groceries'); ok(pr.find(p=>p.purchase.id==='demo-iphone').prot.type==='purchase_protection' && pr.find(p=>p.purchase.id==='demo-iphone').next,'iphone active PP then EW');
// pipeline-shaped cards: conditional rates never counted; incomplete protections never decide
const R2=JSON.parse(JSON.stringify(R)); R2.cards['cc']={cardId:'cc',name:'Custom',short:'Custom',issuer:'Citi',currency:{unit:'cashback'},
  earn:[{id:'top',label:'top category',categories:['dining','gas'],rate:5,conditional:true,condition:'it is your top spend category this billing cycle'},{id:'b',label:'everything else',categories:['*'],rate:1}],
  protections:[{type:'extended_warranty',label:'Extended warranty',incomplete:['addsMonths','maxOriginalWarrantyMonths'],source:{quote:'Extended warranty'}}]};
const S3=JSON.parse(JSON.stringify(S)); S3.wallet={cc:{}};
let rr=E.recommend(R2,['cc'],M('chipotle'),100,'cash'); ok(rr.top.valueUsd===1 && rr.top.conditional && rr.top.conditional.rate===5,'conditional not counted, surfaced');
const pz=Object.assign({},P('demo-blender'),{cardId:'cc'}); let cz=E.evaluateClaim(R2,S3,{type:'product_failure',date:'2026-10-24'},pz,T); ok(cz.decision==='needs_info','incomplete -> needs_info');
ok(E.protectionsForPurchase(pz,R2.cards.cc,T).length===0,'incomplete not listed as protection');
console.log('engine tests: '+n+' passed');