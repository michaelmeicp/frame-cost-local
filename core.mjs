export const STORAGE_KEY = 'frame-cost.workspace.v1';
export const STALE_DAYS = 30;
export const MAX_SHOTS = 50;
export const MAX_RATES = 50;

const PRICES = 'https://fal.ai/models/fal-ai/veo3.1/fast';
const SCHEMA = 'https://fal.ai/models/fal-ai/veo3.1/fast/api#schema';
const VEO_COMBINATION_REFERENCE = 'https://aistudio.google.com/docs/veo#veo-model-parameters';
const RUNWAY_PRICES = 'https://docs.dev.runwayml.com/guides/pricing/';
const RUNWAY_SCHEMA = 'https://dev.runwayml.com/learn/veo-3-1-api';
const DAY = 86_400_000;
const RESOLUTIONS = ['480p', '540p', '720p', '1080p', '2K', '4K', '8K'];
const COMMON_CODES = ['AUD','BRL','CAD','CHF','CNY','EUR','GBP','HKD','IDR','INR','JPY','KRW','MXN','MYR','NZD','PHP','SGD','THB','TWD','USD','VND'];
const CODES = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : COMMON_CODES);
const t = value => typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
const named = (value, fallback) => t(value) || fallback;
const moneyDigits = code => {
  try { return new Intl.NumberFormat('en',{style:'currency',currency: code}).resolvedOptions().minimumFractionDigits; }
  catch { return 2; }
};

export function newShot(id) {
  return { id, name:'', finished:'6', generated:'8', count:'1', attempts:'3', resolution:'720p', audio:false };
}
export function newRate(id) {
  return { id,name:'',endpoint:'',kind:'manual',status:'active',unit:'second',currency:'USD',price:'',
    credits:'',creditBasis:'generation',durations:'4,6,8',resolution:'720p',audio:false,source:'',capabilitySource:'',checked:'',effective:'' };
}
export function createDefaultState() {
  const fast = { ...newRate('fal-silent'), name:'fal · Veo 3.1 Fast', endpoint:'fal-ai/veo3.1/fast',
    kind:'official',price:'0.10',source:PRICES,capabilitySource:SCHEMA,checked:'2026-11-18' };
  // fal lists the enums separately; the Veo model author's endpoint documents an
  // eight-second restriction at 1080p and 4K. Keep these fal snapshots conservative.
  const hd = { ...fast,resolution:'1080p',durations:'8' };
  const uhd = { ...fast,resolution:'4K',durations:'8',price:'0.30' };
  const runway = { ...newRate('runway-silent'),name:'Runway Dev · Veo 3.1 Fast',endpoint:'/v1/text_to_video · veo3.1_fast',
    kind:'official',unit:'credit',price:'0.01',credits:'10',creditBasis:'second',source:RUNWAY_PRICES,
    capabilitySource:RUNWAY_SCHEMA,checked:'2026-11-18' };
  const runwayAudio = { ...runway,id:'runway-audio',credits:'15',audio:true };
  return { shots:[{...newShot('shot-1'),name:'主畫面'}], rates:[
    fast,
    { ...fast, id:'fal-audio', price:'0.15', audio:true },
    { ...newRate('sample-generation'), name:'示範 · 逐次方案',kind:'sample',price:'0.95',unit:'generation',audio:'any' },
    { ...newRate('sample-credit'), name:'示範 · 點數方案',kind:'sample',price:'0.25',unit:'credit',currency:'TWD',credits:'3',creditBasis:'second',audio:'any' },
    { ...hd, id:'fal-1080p-silent' },
    { ...hd, id:'fal-1080p-audio',price:'0.15',audio:true },
    { ...uhd, id:'fal-4k-silent' },
    { ...uhd, id:'fal-4k-audio',price:'0.35',audio:true },
    runway, runwayAudio,
    { ...runway,id:'runway-1080p-silent',resolution:'1080p',durations:'8' },
    { ...runwayAudio,id:'runway-1080p-audio',resolution:'1080p',durations:'8' }
  ] };
}

// Decimal arithmetic is fixed-point per value, so no binary floats or currency rounding compound across attempts.
const pow = digits => 10n ** BigInt(digits);
function decimal(input, precision, min, max) {
  const s = t(input);
  if (!/^\d{1,8}(?:\.\d{1,6})?$/.test(s)) return null;
  const [integer, fraction = ''] = s.split('.');
  if (fraction.length > precision) return null;
  const v = { n: BigInt(integer + fraction), p: fraction.length };
  if (v.n > BigInt(max) * pow(v.p) || v.n < BigInt(min) * pow(v.p)) return null;
  return v;
}
const zero = { n:0n,p:0 };
const sum = (a,b) => {
  const p = Math.max(a.p,b.p);
  return { n:a.n * pow(p-a.p) + b.n * pow(p-b.p),p };
};
const times = (a,b) => ({ n:a.n*b.n,p:a.p+b.p });
const greater = (a,b) => a.n * pow(b.p) > b.n * pow(a.p);
function format(value, minimum = 0) {
  const padded = value.n.toString().padStart(value.p + 1, '0');
  const whole = value.p ? padded.slice(0,-value.p) : padded;
  const fraction = (value.p ? padded.slice(-value.p) : '').replace(/0+$/, '').padEnd(minimum,'0');
  return fraction ? whole + '.' + fraction : whole;
}
export function dateStamp(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return date.toISOString().slice(0,10);
}
function isoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && dateStamp(d) === s;
}
export function safeLink(input) {
  try {
    const url = new URL(t(input));
    return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function rateValidation(rate, today) {
  const reasons = [], warnings = [];
  if (rate.status === 'unsupported') reasons.push('目前不支援估算');
  else if (rate.status === 'retired') reasons.push('端點已退役');
  else if (rate.status !== 'active') reasons.push('服務狀態未確認');
  const name = t(rate.name);
  if (!name) reasons.push('缺少方案名稱');
  const currency = t(rate.currency).toUpperCase();
  if (!CODES.has(currency) || ['XXX','XTS'].includes(currency)) reasons.push('貨幣未知或無效');
  const price = decimal(rate.price,6,0,999999);
  if (!price) reasons.push('價格無效或遺失（0 至 999999，最多六位小數）');
  if (!['second','generation','credit'].includes(rate.unit)) reasons.push('計價單位未知');
  const credits = rate.unit === 'credit' ? decimal(rate.credits,6,0,999999) : null;
  if (rate.unit === 'credit' && (!credits?.n || !['second','generation'].includes(rate.creditBasis))) reasons.push('缺少有效的點數消耗與計量基準');
  const durations = t(rate.durations).split(/[,，、]/).map(s => decimal(s,2,0,600));
  if (durations.length > 40 || durations.some(d => !d?.n)) reasons.push('缺少有效的支援時長（以逗號分隔，最多 40 項，每項 0.01 至 600 秒）');
  if (!RESOLUTIONS.includes(rate.resolution)) reasons.push('缺少有效的支援解析度');
  if (![true,false,'any'].includes(rate.audio)) reasons.push('缺少音訊規格');
  if (rate.kind !== 'sample') {
    if (!safeLink(rate.source)) warnings.push('價格來源未提供或無效');
    if (!safeLink(rate.capabilitySource)) warnings.push('規格來源未提供或無效');
    const checked = t(rate.checked), effective = t(rate.effective);
    if (!isoDate(checked)) warnings.push('核對日期未提供或無效');
    else if (checked > today) warnings.push('核對日期晚於今天');
    else if ((Date.parse(today) - Date.parse(checked)) / DAY > STALE_DAYS) warnings.push('價格超過 30 天未複核，請重查來源');
    if (!isoDate(effective)) warnings.push('生效日期未知');
    else if (effective > today) reasons.push('此價格尚未生效');
  } else warnings.push('純示範，並非供應商價格');
  return { reasons,warnings,currency,price,credits,durations };
}
function shotValidation(shot,index) {
  const errors = [];
  const name = named(shot.name, '鏡頭 ' + (index+1));
  const finished = decimal(shot.finished,2,0,600), generated = decimal(shot.generated,2,0,600);
  const countValue = decimal(shot.count,0,1,1000), attemptsValue = decimal(shot.attempts,0,1,1000);
  if (!finished?.n) errors.push('每個鏡頭保留長度須為 0.01 至 600 秒，最多兩位小數');
  if (!generated?.n) errors.push('單次生成長度須為 0.01 至 600 秒，最多兩位小數');
  if (finished && generated && greater(finished,generated)) errors.push('保留長度不能超過單次生成長度');
  if (!countValue) errors.push('鏡頭數須為 1 至 1000 的整數');
  if (!attemptsValue) errors.push('每個鏡頭的嘗試次數須為 1 至 1000 的整數（含首次）');
  if (!RESOLUTIONS.includes(shot.resolution)) errors.push('請指定有效的解析度');
  if (typeof shot.audio !== 'boolean') errors.push('請指定是否生成音訊');
  const attempts = countValue && attemptsValue ? times(countValue,attemptsValue) : zero;
  return { shot,name,errors,attempts,retained: finished && countValue ? times(finished,countValue) : zero,
    generatedAll: generated ? times(generated,attempts) : zero,generated };
}
export const unitLabel = unit => ({second:'每秒', generation:'每次', credit:'每點'}[unit] ?? '未知');
export const kindLabel = kind => ({official:'官方快照', manual:'自訂價格',sample:'純示範'}[kind] ?? '未分類');
export const audioLabel = audio => audio === true ? '有聲' : audio === false ? '無聲' : audio === 'any' ? '兩者皆可' : '未指定';
export const ASSUMPTIONS = [
  '每個鏡頭保留一個版本，可從完整生成片段裁短。嘗試次數指預期會計費的輸出，含首次及已生成但未採用的版本。失敗／取消是否計費依供應商規則。',
  '各方案分開試算，僅含生成費；不含稅、匯差、訂閱、折扣、免費額度、後製或儲存費。不同幣別不加總、不換算。',
  'fal 只對成功輸出計費，不收伺服器錯誤或排隊時間的費用：https://fal.ai/docs/documentation/model-apis/pricing',
  'fal 1080p／4K 官方快照只試算 8 秒片段；時長限制採保守估算，參考模型開發者的文件（非 fal 端點）：' + VEO_COMBINATION_REFERENCE,
  '估算不是報價；無付款或生成。'
];
export function compare(state, now=new Date()) {
  const today = dateStamp(now);
  const shots = state.shots.map(shotValidation);
  const errors = shots.flatMap(s => s.errors.map(e => s.name + '：' + e));
  if (!shots.length) errors.push('請至少新增一組鏡頭');
  if (shots.length > MAX_SHOTS) errors.push('鏡頭組別超過上限');
  const finished = shots.reduce((a,b) => sum(a,b.retained),zero);
  const generated = shots.reduce((a,b) => sum(a,b.generatedAll),zero);
  const attempts = shots.reduce((a,b) => sum(a,b.attempts),zero);
  const results = state.rates.map(rate => {
    const {reasons,warnings,price,currency,credits,durations} = rateValidation(rate,today);
    if (errors.length) reasons.push('請先修正鏡頭設定');
    for (const s of shots) {
      if (s.errors.length) continue;
      if (s.generated && durations.every(d => !d || format(d) !== format(s.generated))) reasons.push(s.name + '：此費率未涵蓋該單次生成長度');
      if (rate.resolution !== s.shot.resolution) reasons.push(s.name + '：此方案未列入該解析度');
      if (rate.audio !== 'any' && rate.audio !== s.shot.audio) reasons.push(s.name + '：此費率不適用於該音訊設定');
    }
    const eligible = !reasons.length;
    const base = rate.unit === 'second' || (rate.unit === 'credit' && rate.creditBasis === 'second') ? 'generatedAll' : 'attempts';
    const components = eligible ? shots.map(s => {
      const u = credits ? times(s[base],credits) : s[base], subtotal = times(u,price);
      return {shotId:s.shot.id,units:format(u),total:format(subtotal,moneyDigits(currency)),subtotal};
    }) : [];
    const total = eligible ? format(components.reduce((a,b) => sum(a,b.subtotal),zero),moneyDigits(currency)) : null;
    const baseLabel = base === 'generatedAll' ? ' 秒' : ' 次';
    const formula = eligible ? format(base === 'generatedAll' ? generated : attempts) + baseLabel
      + (credits ? ' × ' + format(credits) + ' 點/' + (base === 'generatedAll' ? '秒' : '次') : '')
      + ' × ' + currency + ' ' + format(price,moneyDigits(currency)) + '/' + (credits ? '點' : baseLabel.trim()) : '';
    return {rate,reasons,warnings,eligible,currency,formula,total,
      components:components.map(({subtotal,...item}) => item)};
  });
  return {shots:shots.map(({shot,name,errors})=>({shot,name,errors})), errors,
    finishedSeconds:errors.length ? null : format(finished), generatedSeconds:errors.length ? null : format(generated),
    attempts:errors.length ? null : format(attempts), results };
}

function restoreRows(rows, factory, max) {
  if (!Array.isArray(rows) || rows.length > max) return null;
  const ids = new Set();
  const keys = Object.keys(factory(''));
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 128 || ids.has(row.id)) return null;
    ids.add(row.id);
    const restored = {};
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'string' && value.length <= 4096 || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) {
        restored[key] = value;
      } else return null;
    }
    out.push(restored);
  }
  return out;
}
export function serializeState(state) {
  return JSON.stringify({ version:1, shots:state.shots, rates:state.rates });
}
export function deserializeState(raw) {
  if (typeof raw !== 'string' || raw.length > 4_000_000) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return null;
    const shots = restoreRows(parsed.shots,newShot,MAX_SHOTS), rates = restoreRows(parsed.rates,newRate,MAX_RATES);
    return shots && rates ? {shots,rates} : null;
  } catch { return null; }
}
function rowsForExport(state,now) {
  const report = compare(state,now);
  const summary = [
    ['Frame Cost｜AI 影片製作預算估算'],
    ['匯出日期（UTC）',dateStamp(now)],
    ...ASSUMPTIONS.map(note=>['試算假設',note]),
    ['成片保留（秒）',report.finishedSeconds ?? '無效'],
    ['全部嘗試生成（秒）',report.generatedSeconds ?? '無效'],
    ['嘗試總次數',report.attempts ?? '無效'],
    ...(report.errors.map(e=>['輸入錯誤',e]))
  ];
  const shots = [
    ['鏡頭組','每個保留秒數','單次生成秒數','鏡頭數','每個鏡頭嘗試數（含首次）','解析度','音訊','輸入錯誤'],
    ...report.shots.map(({shot,name,errors})=>[name,shot.finished,shot.generated,shot.count,shot.attempts,shot.resolution,audioLabel(shot.audio),errors.join('；')])
  ];
  const results = [
    ['方案','端點','資料類型','結果狀態','幣別','生成費估算','公式','計價單位','單價','消耗點數','點數計量基準','支援時長（秒）',
      '解析度','音訊','核對日期','生效日期','價格來源','規格來源','失格原因','提醒'],
    ...report.results.map(({rate,eligible,currency,total,formula,reasons,warnings})=>[
      rate.name,rate.endpoint,kindLabel(rate.kind),eligible ? '可試算（非報價）' : '不計價',currency,total ?? '',formula,unitLabel(rate.unit),
      rate.price,rate.unit==='credit' ? rate.credits : '',rate.unit==='credit' ? unitLabel(rate.creditBasis) : '',rate.durations,
      rate.resolution,audioLabel(rate.audio),rate.checked || '未記錄',rate.effective || '未記錄',
      t(rate.source) || '未提供',t(rate.capabilitySource) || '未提供',reasons.join('；'),warnings.join('；')
    ])
  ];
  return [summary,shots,results];
}
export function csvCell(value) {
  let s = String(value ?? '');
  const normalized = s.normalize('NFKC');
  // Quote every cell and neutralize formulas, including leading controls/whitespace.
  if (/^[\p{Cf}\p{Cc}\s]*[=+\-@]/u.test(normalized) || /^[\r\n\t]/.test(normalized)) s = "'" + s;
  return '"' + s.replace(/"/g,'""') + '"';
}
export function exportCsv(state,now=new Date()) {
  return '\uFEFF' + rowsForExport(state,now).map(section=>section.map(row=>row.map(csvCell).join(',')).join('\r\n')).join('\r\n\r\n')+'\r\n';
}
export function exportText(state,now=new Date()) {
  return rowsForExport(state,now).map((section,i)=>{
    if (!i) return section.map(r=>r.join('：')).join('\n');
    const [header,...body] = section;
    if (!body.length) return header[0] + '：無';
    return body.map(row=>row.flatMap((value,index)=>value === '' ? [] : [header[index] + '：' + value]).join('\n')).join('\n\n');
  }).join('\n\n') + '\n';
}
