
const numeric=x=>typeof x==="number"&&Number.isFinite(x);
export function validate(rows){
 if(!Array.isArray(rows)||rows.length>200000)throw Error("資料量不合法");
 let prev="";
 return rows.map((r,i)=>{
  if(!r||typeof r.date!=="string"||!/^\d{4}-\d\d-\d\d$/.test(r.date)||r.date<=prev)throw Error("日期順序或格式錯誤："+(i+1));
  const dt=new Date(r.date+"T00:00:00Z");
  if(!Number.isFinite(+dt)||dt.toISOString().slice(0,10)!==r.date)throw Error("無效日期");
  if(!["open","high","low","close","volume"].every(k=>numeric(r[k]))||!Number.isSafeInteger(r.volume)||r.volume<0||r.low<=0||r.high<Math.max(r.open,r.close,r.low)||r.low>Math.min(r.open,r.close))throw Error("OHLCV 錯誤："+(i+1));
  prev=r.date;return {date:r.date,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume};
 });
}
export function enrich(rows){
 return rows.map((r,i)=>{
  const change=i?(r.close/rows[i-1].close-1)*100:null;
  const avg=i>=20?rows.slice(i-20,i).reduce((s,b)=>s+b.volume,0)/20:null;
  return {...r,change,relative:avg>0?r.volume/avg:null};
 });
}
export function trade(rows,cfg,start=0,end=rows.length){
 const {rise=2,relative=1.2,hold=2,costBps=40}=cfg;
 if(![rise,relative,costBps].every(numeric)||!Number.isInteger(hold)||hold<1||hold>60||relative<0||costBps<0||costBps>1000)throw Error("策略參數無效");
 const trades=[],c=costBps/10000;let eq=1,peak=1,dd=0;
 for(let i=start;i+1+hold<end;i++){
  const s=rows[i],buy=rows[i+1],sell=rows[i+hold+1];
  if(s.change==null||s.change<rise||relative>0&&(s.relative==null||s.relative<relative)||!s.volume||!buy.volume||!sell.volume)continue;
  const net=sell.open*(1-c)/(buy.open*(1+c))-1;
  eq*=1+net;peak=Math.max(peak,eq);dd=Math.min(dd,eq/peak-1);
  trades.push({signal:s.date,entry:buy.date,exit:sell.date,net});i+=hold;
 }
 return {trades,count:trades.length,total:eq-1,winRate:trades.length?trades.filter(t=>t.net>0).length/trades.length:null,drawdown:dd};
}
export function walkForward(input,costBps=40){
 const rows=enrich(validate(input));
 if(rows.length<120)return {ok:false,reason:"至少需要 120 根日 K；30 根快照不能作回測。"};
 const split=Math.floor(rows.length*.7);
 const choices=[];
 for(const rise of [0,1,2,3])for(const relative of [0,1.2,1.5])for(const hold of [1,2,3,5]){
  const config={rise,relative,hold,costBps},train=trade(rows,config,0,split);
  if(train.count>=3)choices.push({config,train});
 }
 if(!choices.length)return {ok:false,reason:"訓練期間符合策略的交易不足。"};
 choices.sort((a,b)=>b.train.total-a.train.total);
 const winner=choices[0],test=trade(rows,winner.config,split,rows.length);
 return {ok:true,count:rows.length,splitDate:rows[split].date,trainRange:[rows[0].date,rows[split-1].date],testRange:[rows[split].date,rows.at(-1).date],config:winner.config,train:winner.train,test,baseline:rows.at(-1).close/rows[split+1].open-1,warning:test.count<3?"樣本外完成交易少於三筆，結論不可靠。":"歷史表現不保證未來；未校正除權息與無法成交情況。"};
}
export function snapshotInfo(s){
 if(!s||s.realtime!==false||!["1d","1m","3m","5m","15m"].includes(s.interval)||!["TWSE","TPEX"].includes(s.market)||typeof s.code!=="string"||!/^[0-9A-Z]{2,8}$/.test(s.code)||!Array.isArray(s.bars)||s.bars.length<1||s.bars.length>30||typeof s.source!=="string"||typeof s.dataAsOf!=="string")throw Error("資料不是有效的非即時 StockPulse 快照");
 return {market:s.market,code:s.code,interval:s.interval,source:s.source,dataAsOf:s.dataAsOf,bars:s.bars.length};
}
export function promptFor(s){
 const p=snapshotInfo(s);
 return "請分析這份歷史行情快照。先檢查來源、週期、資料截止日期與缺漏，區分事實、推論及風險。不可把歷史快照當即時報價，不可杜撰未提供的價格或保證方向。資料不足時請明確指出。這不是交易指令。\n\n"+JSON.stringify({summary:p,snapshot:s},null,2);
}
