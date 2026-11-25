import {walkForward,promptFor,snapshotInfo} from "./research-core.mjs";
import {parseCsv} from "./data.mjs";
const $=id=>document.getElementById(id);let prompt="",last=null;
const pct=v=>v==null?"資料不足":(v*100).toFixed(2)+"%";
function download(name,body,type="text/plain;charset=utf-8"){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$("snapshot-file").addEventListener("change",async e=>{
 $("copy-prompt").disabled=$("download-prompt").disabled=true;prompt="";
 try {const f=e.target.files[0];if(!f)return;if(f.size>1000000)throw Error("檔案超過 1 MB");
 const snapshot=JSON.parse(await f.text());const info=snapshotInfo(snapshot);prompt=promptFor(snapshot);
 $("snapshot-status").textContent="已核對："+info.market+" "+info.code+"；"+info.interval+"；行情截至 "+info.dataAsOf+"；來源 "+info.source+"。這不是即時報價。";
 $("copy-prompt").disabled=$("download-prompt").disabled=false;
 }catch(err){$("snapshot-status").textContent=err.message;}
});
$("copy-prompt").addEventListener("click",async()=>{
 try{await navigator.clipboard.writeText(prompt);$("snapshot-status").textContent="已複製；請貼給 ChatGPT。";}
 catch{$("snapshot-status").textContent="無法存取剪貼簿，請下載文字檔。";}
});
$("download-prompt").addEventListener("click",()=>download("stockpulse-ai-analysis.txt",prompt));
$("lab-form").addEventListener("submit",async e=>{
 e.preventDefault();$("lab-result").hidden=true;last=null;
 try{
 const code=$("lab-code").value.toUpperCase(),files=[...$("lab-files").files];
 if(files.length>24||files.some(f=>f.size>8000000)||files.reduce((sum,f)=>sum+f.size,0)>30000000)throw Error("最多 24 份 CSV；單檔 8 MB、總計 30 MB。");
 const all=[];for(const file of files){const result=parseCsv(await file.text(),{code,interval:0});all.push(...result.rows);}
 const unique=new Map(all.map(b=>[b.date,b]));const sorted=[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date));
 const result=walkForward(sorted,Number($("lab-cost").value));$("lab-status").textContent=result.ok?"樣本外測試完成。":result.reason;
 if(!result.ok)return;
 last={...result,code,realtime:false,files:files.map(f=>f.name),generatedAt:new Date().toISOString()};
 $("lab-details").textContent="共 "+result.count+" 根日 K，樣本外自 "+result.splitDate+" 開始；訓練期 "+pct(result.train.total)+"，樣本外 "+pct(result.test.total)+"，勝率 "+pct(result.test.winRate)+"，完成交易 "+result.test.count+" 筆，最大已平倉回撤 "+pct(result.test.drawdown)+"。同期簡單持有參考 "+pct(result.baseline)+"。"+result.warning;
 $("lab-result").hidden=false;
 }catch(err){$("lab-status").textContent="無法驗證資料："+err.message;}
});
$("lab-save").addEventListener("click",()=>{if(last)download("stockpulse-walkforward.json",JSON.stringify(last,null,2),"application/json");});