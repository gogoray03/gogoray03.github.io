'use strict';
const toggle=document.querySelector('.menu-toggle'),nav=document.querySelector('#navigation');
toggle.hidden=false;nav.classList.add('enhanced');
function closeMenu(){toggle.setAttribute('aria-expanded','false');toggle.textContent='開啟選單';nav.classList.remove('open');}
toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'關閉選單':'開啟選單';nav.classList.toggle('open',open);});
nav.addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){closeMenu();toggle.focus();}});
const config=window.SITE_CONFIG||{},links=document.querySelector('#contact-links');
function addContact(text,url){const a=document.createElement('a');a.className='button primary';a.textContent=text;a.href=url;links.append(a);}
if(typeof config.email==='string'&&/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(config.email))addContact('電子郵件洽詢','mailto:'+config.email+'?subject='+encodeURIComponent('專案合作洽詢'));
try{const url=new URL(config.platformUrl);if(url.protocol==='https:')addContact(config.platformName||'接案平台洽詢',url.href);}catch{}
if(links.children.length)document.querySelector('#contact-status').textContent='請透過以上方式聯絡，並附上簡要需求。';
const brief='您好，我想洽詢專案合作：\n\n目前的工作方式與問題：\n希望完成的功能或產出：\n資料格式與範例（請先去識別化）：\n預計時程：\n預算範圍：\n';
const copy=document.querySelector('#copy-brief');copy.hidden=false;
copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(brief);document.querySelector('#copy-status').textContent='已複製，可以貼到郵件或接案平台訊息。';}catch{const field=document.querySelector('#brief-fallback');field.hidden=false;field.value=brief;field.focus();field.select();document.querySelector('#copy-status').textContent='請手動複製下方需求範本。';}});
