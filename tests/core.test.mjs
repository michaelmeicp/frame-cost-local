import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultState,newShot,newRate,compare,serializeState,deserializeState,
  csvCell,exportCsv,exportText,safeLink
} from '../core.mjs';

const CHECK = new Date('2026-11-18T12:00:00Z');
const base = () => createDefaultState();
const quote = state => compare(state,CHECK).results;
const fal = state => quote(state)[0];

test('official fal Fast 720p exact price fixtures, silent and audio', () => {
  const state=base();
  let qs=quote(state);
  assert.equal(qs[0].total,'2.40');
  assert.equal(qs[1].total,null);
  state.shots[0].audio=true;
  qs=quote(state);
  assert.equal(qs[0].total,null);
  assert.equal(qs[1].total,'3.60');
  assert.equal(qs[1].formula,'24 秒 × USD 0.15/秒');
  assert.equal(qs[1].rate.effective,'');
  assert.equal(qs[1].rate.checked,'2026-11-18');
  assert.match(qs[1].rate.capabilitySource,/fal\.ai.*\/fast\/api/);
  assert.match(qs[1].rate.source,/fal\.ai.*\/fast/);
});

test('fal high-resolution rows apply distinct pricing and only cover exact eight-second clips', () => {
  const state=base();
  for (const [resolution,expected] of [['1080p',['2.40','3.60']],['4K',['7.20','8.40']]]) {
    for (const [audio,total] of [[false,expected[0]],[true,expected[1]]]) {
      Object.assign(state.shots[0],{resolution,audio,generated:'8',finished:'4'});
      const matching = quote(state).filter(q=>q.eligible && q.rate.id.startsWith('fal-'));
      assert.equal(matching.length,1);
      assert.equal(matching[0].total,total);
      assert.equal(matching[0].rate.durations,'8');
      for (const generated of ['4','6']) {
        state.shots[0].generated=generated;
        const row = quote(state).find(q=>q.rate.id===matching[0].rate.id);
        assert.equal(row.total,null);
        assert.match(row.reasons.join('|'),/未涵蓋該單次生成長度/);
      }
    }
  }
});

test('Runway Dev uses USD 0.01 per credit, 10 / 15 credits per generated second', () => {
  const state=base();
  for (const [resolution,generated,valid] of [['720p','4',true],['720p','6',true],['720p','8',true],
    ['1080p','4',false],['1080p','6',false],['1080p','8',true],['4K','8',false]]) {
    for (const audio of [false,true]) {
      Object.assign(state.shots[0],{resolution,audio,generated,finished:'4'});
      const matching = quote(state).filter(q=>q.eligible && q.rate.id.startsWith('runway-'));
      assert.equal(matching.length,valid ? 1 : 0);
      if (!valid) continue;
      assert.equal(matching[0].currency,'USD');
      assert.equal(matching[0].total, (3*Number(generated)*(audio?15:10)/100).toFixed(2));
      assert.match(matching[0].formula,new RegExp((audio?'15':'10')+' 點/秒 × USD 0.01/點'));
      assert.match(matching[0].rate.endpoint,/text_to_video.*veo3.1_fast/);
      assert.match(matching[0].rate.capabilitySource,/dev\.runwayml\.com/);
    }
  }
});

test('two shot groups multiply counts and attempts, retaining only one clip per shot', () => {
  const state=base();
  state.shots.push({...newShot('two'),finished:'3.5',generated:'4',count:'2',attempts:'5'});
  const result=compare(state,CHECK);
  assert.equal(result.finishedSeconds,'13');
  assert.equal(result.generatedSeconds,'64');
  assert.equal(result.attempts,'13');
  assert.equal(result.results[0].total,'6.40');
  assert.deepEqual(result.results[0].components.map(x=>x.total),['2.40','4.00']);
  assert.equal(result.results[2].total,'12.35');
  assert.equal(result.results[3].total,'48.00');
  assert.deepEqual(result.results.filter(x=>x.eligible).map(x=>x.currency),['USD','USD','TWD','USD']);
});

test('credit rate can apply per generation, with exact fractional credit arithmetic', () => {
  const state=base();
  Object.assign(state.rates[3],{price:'0.000123',credits:'0.123456',creditBasis:'generation',currency:'USD'});
  const result=quote(state)[3];
  assert.equal(result.total,'0.000045555264');
  assert.equal(result.components[0].units,'0.370368');
  assert.match(result.formula,/點\/次/);
});
test('do not adapt 5 seconds to a valid fal duration or silently change quality or audio', () => {
  const state=base();
  Object.assign(state.shots[0],{finished:'4',generated:'5',resolution:'1080p',audio:true});
  const result=fal(state);
  assert.equal(result.total,null);
  assert.equal(result.eligible,false);
  assert.match(result.reasons.join('|'),/生成長度.*解析度.*音訊/);
});
test('mixed settings are excluded unless the same rate applies to every shot',()=>{
  const state=base();
  state.shots.push({...newShot('sound'),audio:true});
  assert.equal(quote(state)[0].eligible,false);
  assert.equal(quote(state)[1].eligible,false);
  assert.equal(quote(state)[2].total,'5.70');
});

test('not priced when retired, unsupported, or currency unknown, including plausible three letter code', () => {
  const state=base();
  Object.assign(state.rates[0],{status:'retired'});
  Object.assign(state.rates[1],{status:'unsupported',audio:false});
  Object.assign(state.rates[2],{currency:'XXX'});
  Object.assign(state.rates[3],{currency:'ABC'});
  const qs=quote(state).slice(0,4);
  assert.ok(qs.every(q=>!q.eligible && q.total===null));
  assert.match(qs[0].reasons[0],/退役/);
  assert.match(qs[1].reasons[0],/不支援/);
  assert.match(qs[2].reasons[0],/貨幣/);
});
test('strict boundaries: finite decimal lengths, counts, attempts, rates, and retained <= generated', () => {
  const state=base(), shot=state.shots[0];
  Object.assign(shot,{finished:'600',generated:'600',count:'1000',attempts:'1000'});
  state.rates=[{...newRate('boundary'),name:'極限',price:'999999',durations:'600'}];
  assert.equal(fal(state).total,'599999400000000.00');
  Object.assign(shot,{count:'1001', attempts:'1.5',finished:'601',generated:'1e3'});
  assert.equal(compare(state,CHECK).errors.length,4);
  assert.equal(compare(state,CHECK).attempts,null);
  assert.equal(fal(state).total,null);
  Object.assign(shot,{finished:'4.01',generated:'4',count:'1',attempts:'1'});
  assert.match(compare(state,CHECK).errors[0],/不能超過/);
  Object.assign(shot,{finished:'0.01'});
  state.rates[0].durations='4';
  state.rates[0].price='0';
  assert.equal(fal(state).total,'0.00');
  state.rates[0].price='0.0000001';
  assert.equal(fal(state).total,null);
});
test('staleness is explicit at 31 days, missing dates/sources visible, future effective disallows quoting', () => {
  const state=base();
  assert.ok(!compare(state,new Date('2026-12-18')).results[0].warnings.some(x=>x.includes('30')));
  assert.ok(compare(state,new Date('2026-12-19')).results[0].warnings.some(x=>x.includes('30')));
  Object.assign(state.rates[0],{source:'javascript:alert(1)',capabilitySource:'',checked:'2026-02-30',effective:'2027-01-01'});
  const result=fal(state);
  assert.equal(result.total,null);
  assert.match(result.reasons.join(' '),/尚未生效/);
  assert.match(result.warnings.join(' '),/價格來源.*規格來源.*核對日期/);
  assert.equal(safeLink('https://user:pass@fal.ai/'),null);
  assert.equal(safeLink('https://fal.ai/a'), 'https://fal.ai/a');
});
test('restore edited values and empty tables, reject damaged persistence payloads', () => {
  const state=base();
  state.shots[0].name='片頭';
  state.rates[0].price='0.1234';
  assert.deepEqual(deserializeState(serializeState(state)),state);
  assert.deepEqual(deserializeState(serializeState({shots:[],rates:[]})),{shots:[],rates:[]});
  assert.equal(deserializeState(null),null);
  assert.equal(deserializeState('{BROKEN'),null);
  assert.equal(deserializeState('{"version":99,"shots":[],"rates":[]}'),null);
  state.shots.push({...state.shots[0]});
  assert.equal(deserializeState(serializeState(state)),null);
});
test('CSV preserves UTF-8, quotes safely, and neutralizes formula payloads in editable fields', () => {
  assert.equal(csvCell('標題, "剪輯"'),'"標題, ""剪輯"""');
  for (const attack of ['=1+1',' +1','\t-1','\n=1','\rhello',' @SUM(1)','\u200b=1','＝1']) {
    assert.ok(csvCell(attack).startsWith('"\''),JSON.stringify(attack));
  }
  const state=base();
  state.shots[0].name='=1+1';
  state.rates[0].name='@1';
  const csv=exportCsv(state,CHECK);
  const txt=exportText(state,CHECK);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'@1"'));
  for (const report of [csv,txt]) assert.match(report,/2026-11-18[\s\S]+不含稅[\s\S]+2\.40[\s\S]+https:\/\/fal\.ai/);
});
