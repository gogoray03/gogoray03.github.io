import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const html=fs.readFileSync(new URL('index.html',root),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'No duplicate IDs');
for(const m of html.matchAll(/(?:href|src)="([^"]+)"/g)){
 const value=m[1];if(value.startsWith('#')){if(value.length>1)assert(ids.includes(value.slice(1)),value);}
 else if(!/^[a-z]+:/i.test(value))assert(fs.existsSync(new URL(value,root)),value);
}
assert.equal((html.match(/<h1>/g)||[]).length,1);
assert(html.includes('個人練習作品')&&html.includes('使用模擬資料')&&html.includes('待原始碼驗證'));
console.log('PASS: local assets, anchor targets, unique IDs, single H1, portfolio disclosure');
const source=fs.readFileSync(new URL('assets/main.js',root),'utf8');
function run(config,clipboard){
 const nodes={};function el(){return {children:[],attrs:{},classList:{add(){},remove(){},toggle(){}},listeners:{},hidden:true,textContent:'',setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},addEventListener(k,v){this.listeners[k]=v;},append(c){this.children.push(c);},focus(){},select(){}};}
 const document={querySelector(s){return nodes[s]??=el();},createElement:el,addEventListener(){}};
 vm.runInNewContext(source,{document,window:{SITE_CONFIG:config},URL,encodeURIComponent,navigator:{clipboard}});return nodes;
}
let nodes=run({email:'',platformUrl:''});assert.equal(nodes['#contact-links'].children.length,0);
nodes=run({email:'hello@example.com',platformName:'測試平台',platformUrl:'https://example.com/profile'});
assert.equal(nodes['#contact-links'].children.length,2);assert(nodes['#contact-links'].children[0].href.startsWith('mailto:hello@example.com?subject='));
for(const url of ['javascript:alert(1)','http://example.com','data:text/html,unsafe','invalid'])assert.equal(run({platformUrl:url})['#contact-links'].children.length,0);
for(const email of ['x@y.com?bcc=bad@example.com','bad\n@example.com','no-address'])assert.equal(run({email})['#contact-links'].children.length,0);
console.log('PASS: empty contacts hidden; configured contacts rendered; unsafe URLs and malformed email rejected');
let copied='';nodes=run({}, {async writeText(text){copied=text;}});await nodes['#copy-brief'].listeners.click();assert(copied.includes('預算範圍'));assert(nodes['#copy-status'].textContent.includes('已複製'));
nodes=run({}, {async writeText(){throw Error('Denied');}});await nodes['#copy-brief'].listeners.click();assert.equal(nodes['#brief-fallback'].hidden,false);assert(nodes['#brief-fallback'].value.includes('預算範圍'));
console.log('PASS: clipboard success and permission-denied fallback');
const files=['index.html','assets/style.css','assets/main.js','assets/config.js','assets/icon.svg'];
const bytes=files.reduce((sum,file)=>sum+fs.statSync(new URL(file,root)).size,0);console.log('Initial asset bytes (uncompressed): '+bytes);
