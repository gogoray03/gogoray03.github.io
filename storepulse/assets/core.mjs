export const REQUIRED = ['date','order_id','product','quantity','unit_price','channel'];
export const MAX_ROWS = 20000;
const statuses = {paid:'paid', completed:'paid', 已付款:'paid', 已完成:'paid', 正常:'paid', refund:'refunded', refunded:'refunded', 退款:'refunded', 已退款:'refunded', cancelled:'cancelled', canceled:'cancelled', 取消:'cancelled', 已取消:'cancelled'};
const num = (value, fallback=0) => {
  if ((value ?? '') === '') return fallback;
  const x = Number(String(value).replaceAll(',','').trim());
  if (!Number.isFinite(x) || x < 0) throw new Error('金額或數量必須是非負數');
  return x;
};
export function parseCSV(source) {
  const text = source.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('CSV 檔案是空的');
  const rows=[]; let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"') { if(quoted && text[i+1]==='"'){value+='"';i++;} else if (quoted || value==='') quoted=!quoted; else throw new Error('引號位置不正確'); }
    else if (ch===',' && !quoted){row.push(value);value='';}
    else if ((ch==='\n'||ch==='\r') && !quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(v=>v.trim()!==''))rows.push(row);row=[];value='';}
    else value+=ch;
  }
  if(quoted) throw new Error('CSV 引號未正確關閉');
  row.push(value); if(row.some(v=>v.trim()!==''))rows.push(row);
  if(rows.length<2) throw new Error('CSV 沒有資料列');
  const headers=rows.shift().map(s=>s.trim().toLowerCase());
  if(new Set(headers).size!==headers.length)throw new Error('CSV 有重複欄位名稱');
  const missing=REQUIRED.filter(h=>!headers.includes(h));
  if(missing.length)throw new Error(`缺少必要欄位：${missing.join(', ')}`);
  if(rows.length>MAX_ROWS)throw new Error(`資料超過 ${MAX_ROWS.toLocaleString()} 列限制`);
  return rows.map((cells,idx)=>{
    if(cells.length!==headers.length) throw new Error(`第 ${idx+2} 行欄位數不正確`);
    return Object.fromEntries(headers.map((h,j)=>[h,cells[j].trim()]));
  });
}
export function normalize(raw){
  const good=[],errors=[];
  raw.forEach((r,i)=>{
    try {
      const line=i+2;
      const {date,order_id,product,channel}=r;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('日期需為有效 YYYY-MM-DD');
      if(!order_id||!product||!channel)throw new Error('訂單編號、商品、通路不可空白');
      const quantity=num(r.quantity,NaN),unit_price=num(r.unit_price,NaN);
      if(!Number.isInteger(quantity)||quantity<=0)throw new Error('數量必須是正整數');
      if(!Number.isFinite(unit_price))throw new Error('單價必填');
      const discount=num(r.discount), shipping=num(r.shipping), cost=r.cost===''||r.cost===undefined?null:num(r.cost);
      const status=statuses[(r.status||'paid').toLowerCase()];
      if(!status)throw new Error(`不支援的狀態：${r.status}`);
      const gross=Math.round(quantity*unit_price*100),off=Math.round(discount*100),freight=Math.round(shipping*100);
      if(off>gross)throw new Error('折扣不可超過該列商品金額');
      good.push({date,order_id,product,channel,quantity,gross,discount:off,shipping:freight,cost:cost===null?null:Math.round(cost*quantity*100),status,line});
    }catch(e){errors.push({line:i+2,reason:e.message});}
  });
  return {rows:good,errors};
}
export function summarize(rows){
  let gross=0,discount=0,refund=0,shipping=0,units=0,cost=0,costComplete=true;
  const orderIds=new Set(), daily=new Map(),products=new Map(),channels=new Map();
  for(const r of rows){
    if(r.status==='cancelled')continue;
    const sign=r.status==='refunded'?-1:1;
    const net=sign*(r.gross-r.discount+r.shipping);
    gross += r.status==='paid'?r.gross:0;
    discount += r.status==='paid'?r.discount:0;
    refund += r.status==='refunded'?(r.gross-r.discount+r.shipping):0;
    shipping += r.status==='paid'?r.shipping:0;
    if(r.status==='paid')orderIds.add(r.order_id);
    units+=sign*r.quantity;
    if(r.cost===null) costComplete=false; else cost+=sign*r.cost;
    daily.set(r.date,(daily.get(r.date)||0)+net);
    const p=products.get(r.product)||{name:r.product,net:0,units:0};p.net+=net;p.units+=sign*r.quantity;products.set(r.product,p);
    channels.set(r.channel,(channels.get(r.channel)||0)+net);
  }
  const net=gross-discount-refund+shipping;
  return {gross,discount,refund,shipping,net,units,orders:orderIds.size,aov:orderIds.size?Math.round(net/orderIds.size):0,costComplete,profit:costComplete?net-cost:null,daily:[...daily].sort((a,b)=>a[0].localeCompare(b[0])),products:[...products.values()].sort((a,b)=>b.net-a.net),channels:[...channels].sort((a,b)=>b[1]-a[1])};
}
export function escapeCSV(v){const t=String(v??'');const safe=/^[=+@\-\t\r]/.test(t)?"'"+t:t; return /[",\r\n]/.test(safe)?'"'+safe.replaceAll('"','""')+'"':safe;}
export function buildCSV(rows){return '\uFEFF'+rows.map(r=>r.map(escapeCSV).join(',')).join('\r\n');}
