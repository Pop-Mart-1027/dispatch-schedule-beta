const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
const b=await chromium.launch({channel:'msedge'});const p=await b.newPage({viewport:{width:800,height:900}});
const data=fs.readFileSync('C:/Users/老涂/Desktop/810559509.285622.mp4').toString('base64');
await p.setContent('<video controls style="height:850px" src="data:video/mp4;base64,'+data+'"></video>');
await p.waitForFunction(()=>document.querySelector('video').readyState>=2);
const duration=await p.$eval('video',v=>v.duration);console.log(duration);
fs.mkdirSync('outputs/video',{recursive:true});
for(let n=0;n<6;n++){await p.$eval('video',(v,t)=>new Promise(r=>{v.onseeked=r;v.currentTime=t}),Math.max(.01,duration*n/6));await p.screenshot({path:`outputs/video/frame-${n}.png`});}
await b.close();
})();
