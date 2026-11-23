'use strict';
const toggle=document.querySelector('.menu-toggle'),nav=document.querySelector('#navigation');
toggle.hidden=false;nav.classList.add('enhanced');
function closeMenu(){toggle.setAttribute('aria-expanded','false');toggle.textContent='開啟選單';nav.classList.remove('open');}
toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'關閉選單':'開啟選單';nav.classList.toggle('open',open);});
nav.addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){closeMenu();toggle.focus();}});
const config=window.SITE_CONFIG||{},links=document.querySelector('#contact-links');
const contactStatus=document.querySelector('#contact-status');
contactStatus.setAttribute('role','status');
contactStatus.setAttribute('aria-live','polite');
const email=typeof config.email==='string'?config.email.trim():'';
const validEmail=/^[^\s@?&#,;<>:"\\]+@[^\s@?&#,;<>:"\\]+\.[^\s@?&#,;<>:"\\]+$/.test(email);
function addContact(text,url){const a=document.createElement('a');a.className='button primary';a.textContent=text;a.href=url;links.append(a);return a;}
if(validEmail){
 const subject='專案合作洽詢';
 const gmailUrl=new URL('https://mail.google.com/mail/');
 gmailUrl.searchParams.set('view','cm');
 gmailUrl.searchParams.set('fs','1');
 gmailUrl.searchParams.set('to',email);
 gmailUrl.searchParams.set('su',subject);
 const gmailLink=addContact('透過 Gmail 撰寫郵件',gmailUrl.href);
 gmailLink.target='_blank';
 gmailLink.rel='noopener noreferrer';
 gmailLink.setAttribute('aria-label','透過 Gmail 撰寫郵件（另開分頁）');
 addContact('其他郵件軟體（mailto）','mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(subject));
 const copyEmail=document.createElement('button');
 copyEmail.type='button';copyEmail.className='button primary';copyEmail.textContent='複製電子郵件地址';
 links.append(copyEmail);
 copyEmail.addEventListener('click',async()=>{
  copyEmail.disabled=true;
  contactStatus.textContent='正在複製電子郵件地址…';
  try{
   if(!navigator.clipboard||typeof navigator.clipboard.writeText!=='function')throw new Error('Clipboard unavailable');
   await navigator.clipboard.writeText(email);
   contactStatus.textContent='已複製電子郵件地址，可貼到你慣用的郵件服務。';
  }catch{
   contactStatus.textContent='無法自動複製，請選取並手動複製此地址：'+email;
  }finally{copyEmail.disabled=false;}
 });
}
try{const url=new URL(config.platformUrl);if(url.protocol==='https:')addContact(config.platformName||'接案平台洽詢',url.href);}catch{}
if(validEmail)contactStatus.textContent='Gmail 可能需要登入；若郵件軟體無法開啟，請複製地址至你慣用的郵件服務。';
else contactStatus.textContent=links.children.length?'電子郵件暫時無法使用，請透過上方接案平台聯絡。':'電子郵件尚未設定或格式不正確，暫時無法提供郵件聯絡。';
const brief='您好，我想洽詢專案合作：\n\n目前的工作方式與問題：\n希望完成的功能或產出：\n資料格式與範例（請先去識別化）：\n預計時程：\n預算範圍：\n';
const copy=document.querySelector('#copy-brief');copy.hidden=false;
copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(brief);document.querySelector('#copy-status').textContent='已複製，可以貼到郵件或接案平台訊息。';}catch{const field=document.querySelector('#brief-fallback');field.hidden=false;field.value=brief;field.focus();field.select();document.querySelector('#copy-status').textContent='請手動複製下方需求範本。';}});
