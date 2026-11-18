import {createDefaultState,compare,serializeState,deserializeState,exportCsv,exportText,STORAGE_KEY,safeLink,newShot,newRate} from './core.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=createDefaultState(),notice='';
try {const raw=localStorage.getItem(STORAGE_KEY);if(raw){const recovered=deserializeState(raw);if(!recovered)throw Error();state=recovered;}}catch{notice='無法讀取先前的紀錄，目前使用初始試算。'}
const status=t=>{$('status').textContent=t;};
const save=()=>{try{localStorage.setItem(STORAGE_KEY,serializeState(state));status('已儲存在此瀏覽器。');}catch{status('無法儲存。請匯出試算以保留結果。');}};
const unitNames={second:'每秒',generation:'每次生成',credit:'點數'};
const kinds={official:'官方快照',sample:'示範費率',manual:'自訂費率'};
const states={active:'可用',unsupported:'未核實支援',retired:'已停用'};
function field(k,label,val,opts=null,type='text'){
const attr='data-key="'+k+'"',v=esc(val);return '<label>'+label+(opts?'<select '+attr+'>'+opts.map(([a,b])=>'<option value="'+esc(a)+'" '+(String(a)===String(val)?'selected':'')+'>'+esc(b)+'</option>').join('')+'</select>':'<input '+attr+' maxlength="4096" type="'+type+'" value="'+v+'" '+(type==='number'?'step="any" inputmode="decimal"':'')+'>')+'</label>';
}
const n=(k,l,v)=>field(k,l,v,null,'number');
const res=['480p','540p','720p','1080p','2K','4K','8K'].map(v=>[v,v]);
const audio=[[false,'無音訊'],[true,'含音訊']];
function drawShots(){
$('shots').innerHTML=state.shots.map((s,i)=>'<article class="shot-card" data-i="'+i+'"><div class="card-head"><strong>鏡組 '+String(i+1).padStart(2,'0')+'</strong><button class="icon-button" data-remove="shot" '+(state.shots.length===1?'disabled':'')+' aria-label="移除鏡組 '+(i+1)+'">移除</button></div><div class="fields">'+field('name','鏡組名稱',s.name)+n('finished','每鏡成片秒數',s.finished)+n('generated','單次生成秒數',s.generated)+n('count','相同規格鏡頭數',s.count)+n('attempts','每鏡付費嘗試（含首次）',s.attempts)+field('resolution','解析度',s.resolution,res)+field('audio','聲音',s.audio,audio)+'</div></article>').join('');
}
function rateTitle(r){return '<strong>'+esc(r.name||'未命名費率')+'</strong> <small>'+esc(r.resolution)+' · '+(r.audio==='any'?'含／無音訊同價':r.audio?'含音訊':'無音訊')+'</small> <span class="badge badge-neutral">'+esc(kinds[r.kind])+'</span>';}
function rateEditor(r,i){return '<details class="rate-card" data-i="'+i+'"><summary>'+rateTitle(r)+'</summary><p class="muted">每列代表一個端點、一組規格和一種計價。修改官方或示範快照會轉為自訂費率。</p><div class="fields">'+field('name','名稱',r.name)+field('endpoint','端點／模型',r.endpoint)+field('unit','計價方式',r.unit,Object.entries(unitNames))+n('price','金額／計價單位',r.price)+field('currency','貨幣代碼（例：USD）',r.currency)+field('resolution','解析度',r.resolution,res)+field('audio','聲音',r.audio,[...audio,['any','兩者同價']])+field('durations','可生成秒數（以逗號分隔）',r.durations)+field('status','可用狀態',r.status,Object.entries(states))+'<label data-credit>每單位消耗點數<input data-key="credits" type="number" step="any" value="'+esc(r.credits)+'"></label><label data-credit>點數扣抵單位<select data-key="creditBasis">'+['second','generation'].map(x=>'<option value="'+x+'" '+(x===r.creditBasis?'selected':'')+'>'+unitNames[x]+'</option>').join('')+'</select></label>'+field('checked','核對日期',r.checked,null,'date')+field('effective','生效日期（不詳可留空）',r.effective,null,'date')+field('source','定價來源網址',r.source)+field('capabilitySource','規格來源網址',r.capabilitySource)+'</div><button class="icon-button" data-remove="rate">移除此列</button></details>';}
function drawRates(){ $('rates').innerHTML=state.rates.map(rateEditor).join('');document.querySelectorAll('[data-credit]').forEach(el=>el.hidden=state.rates[+el.closest('[data-i]').dataset.i].unit!=='credit'); }
function link(v,t){try{const href=safeLink(v);if(href)return '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+t+' ↗</a>';}catch{}return '<span>'+t+'未提供</span>';}
let showMismatch=false;
function results(){
const q=compare(state);
$('summary').innerHTML=[[q.finishedSeconds,'成片秒數'],[q.generatedSeconds,'付費生成秒數'],[q.attempts,'生成次數']].map(([v,l])=>'<div><strong>'+esc(q.errors.length?'—':v)+'</strong><small>'+l+'</small></div>').join('');
const quote=z=>{const r=z.rate;
return '<article class="quote-card"><div class="card-head"><span class="badge '+(z.eligible?'badge-good':'badge-warn')+'">'+(z.eligible?'符合規格':'無法試算')+'</span><span class="muted">'+esc(kinds[r.kind])+'</span></div><h3>'+esc(r.name||'未命名費率')+'</h3><p class="muted">'+esc(r.resolution)+' · '+(r.audio==='any'?'含／無音訊同價':r.audio?'含音訊':'無音訊')+'</p><div class="quote-amount">'+(z.eligible?'<small>'+esc(z.currency||r.currency)+'</small> '+esc(z.total):'—')+'</div><p class="quote-math">'+esc(z.formula)+'</p>'+[...z.reasons,...z.warnings].map(w=>'<p class="quote-warning">'+esc(w)+'</p>').join('')+'<details><summary>規格與來源</summary><p>'+esc(r.endpoint)+' · '+esc(r.resolution)+' · '+esc(r.durations)+' 秒 · '+(r.audio==='any'?'音訊不限':r.audio?'含音訊':'無音訊')+'</p><p>核對：'+esc(r.checked||'未知')+'<br>生效：'+esc(r.effective||'未公布／未知')+'</p><p>'+link(r.source,'定價')+' · '+link(r.capabilitySource,'規格')+'</p></details></article>';};
const yes=q.results.filter(z=>z.eligible).sort((a,b)=>Number(a.rate.kind==='sample')-Number(b.rate.kind==='sample')),no=q.results.filter(z=>!z.eligible);
$('quotes').innerHTML=(q.errors.length?'<p class="input-errors" role="alert">'+q.errors.map(esc).join('；')+'</p>':'')+yes.map(quote).join('')+(no.length?'<details id="mismatches" class="mismatch" '+(showMismatch||!yes.length?'open':'')+'><summary>不符合規格或資料不足（'+no.length+'）</summary><div class="quote-list">'+no.map(quote).join('')+'</div></details>':'')+(!state.rates.length?'<p>目前沒有費率，請新增自訂費率。</p>':'');const m=$('mismatches');if(m)m.addEventListener('toggle',()=>{if(m.isConnected&&yes.length)showMismatch=m.open;});
}
function redraw(){drawShots();drawRates();results();}
for(const group of ['shots','rates']){
$(group).addEventListener('input',e=>{const el=e.target,k=el.dataset.key;if(!k)return;const card=el.closest('[data-i]'),r=state[group][+card.dataset.i];r[k]=k==='audio'?(el.value==='any'?'any':el.value==='true'):el.value;if(group==='rates'){r.kind='manual';card.querySelector('summary').innerHTML=rateTitle(r);card.querySelectorAll('[data-credit]').forEach(a=>a.hidden=r.unit!=='credit');}results();save();});
$(group).addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(!b)return;const i=+b.closest('[data-i]').dataset.i;if(group==='shots'&&state.shots.length===1)return;if(!confirm('確定移除「'+(state[group][i].name||'未命名')+'」？'))return;state[group].splice(i,1);redraw();save();$(group==='shots'?'add-shot':'add-rate').focus();});
}
let seq=0;
function add(group,factory){if(state[group].length>=50){status('每份試算最多可設定 50 組鏡頭及 50 列費率。');return;}state[group].push(factory('local-'+Date.now()+'-'+(++seq)));group==='shots'?drawShots():drawRates();results();save();const card=$(group).lastElementChild;if(group==='rates')card.open=true;card.querySelector('input').focus();}
$('add-shot').onclick=()=>add('shots',newShot);$('add-rate').onclick=()=>add('rates',newRate);
$('reset').onclick=()=>{if(confirm('重設會移除這個瀏覽器內的自訂鏡組及費率，並還原內建試算。確定重設？')){state=createDefaultState();redraw();save();status('已還原初始試算。');}};
function download(kind){const csv=kind==='csv',data=csv?exportCsv(state):exportText(state),blob=new Blob([csv&&!data.startsWith('\ufeff')?'\ufeff':'',data],{type:csv?'text/csv;charset=utf-8':'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='frame-cost-'+new Date().toISOString().slice(0,10)+'.'+(csv?'csv':'txt');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);status('已產生'+(csv?' CSV':'文字')+'預算檔。');}
$('export-text').onclick=()=>download('txt');$('export-csv').onclick=()=>download('csv');
redraw();if(notice)status(notice);
