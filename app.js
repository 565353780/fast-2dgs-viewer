import {Renderer} from './renderer.js';
import {orbitCamera} from './core.js';
const $=id=>document.getElementById(id),canvas=$('canvas'),worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
let renderer,ready=false,busy=false,dirty=false,bounds,target,distance,yaw=0,pitch=0.12,auto=false,last=performance.now(),frameID=0,activeCamera,filename='',loadID=0,dragDepth=0,lastCompleted=0;
const message=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
const request=()=>{dirty=true;};
function fit(){target=bounds.min.map((v,i)=>(v+bounds.max[i])/2);const radius=Math.hypot(...bounds.max.map((v,i)=>(v-bounds.min[i])/2));distance=Math.max(0.5,radius/Math.sin(25*Math.PI/180)*1.15+0.2);yaw=0;pitch=0.12;request();}
function dimensions(){const scale=Number($('quality').value);return [Math.max(16,Math.round(canvas.clientWidth*scale)),Math.max(16,Math.round(canvas.clientHeight*scale))];}
async function openFile(file){
  if(!file) return;
  if(!file.name.toLowerCase().endsWith('.ply')) return message('请选择 .ply 文件。',true);
  if(file.size>512*1024*1024) return message('文件超过 512 MB，请使用较小的模型。',true);
  const id=++loadID;ready=false;auto=false;$('rotate').setAttribute('aria-pressed','false');message('正在读取 PLY…');
  try {const buffer=await file.arrayBuffer();if(id!==loadID) return;filename=file.name;worker.postMessage({type:'load',generation:id,buffer},[buffer]);}
  catch(e){message(e.message,true);}
}
worker.onmessage=async({data:m})=>{
  if(m.generation!==loadID){if(m.type==='frame'||m.type==='error')busy=false;return;}
  if(m.type==='loaded'){
    bounds=m.bounds;ready=true;$('filename').textContent=filename;$('details').textContent=`${m.count.toLocaleString()} 个面片 · SH ${m.degree} · Fast2DGS`;
    $('welcome').hidden=true;$('toolbar').hidden=false;$('model-info').hidden=false;message('正在绘制…');fit();
  }
  if(m.type==='frame'){
    if(!ready){busy=false;return;}
    try {const start=performance.now(),c=activeCamera;await renderer.render(m,c.width,c.height,background());
      const now=performance.now(),timing=auto&&lastCompleted?`${(1000/(now-lastCompleted)).toFixed(1)} FPS`:`${(now-start+m.ms).toFixed(1)} ms`;lastCompleted=now;
      $('stats').textContent=`${c.width} × ${c.height} · ${timing} · ${m.visible.toLocaleString()} 可见`;
      message('');
    } catch(e){message(e.message,true);auto=false;}
    busy=false;
  }
  if(m.type==='error'){busy=false;auto=false;message(m.message,true);}
};
worker.onerror=e=>{busy=false;ready=false;message(`工作线程错误：${e.message}`,true);};
function background(){return $('background').value.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16)/255);}
function tick(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(auto&&ready){yaw+=dt*.24;request();}
  if(dirty&&!busy&&ready&&renderer){dirty=false;busy=true;const [w,h]=dimensions();activeCamera=orbitCamera(target,distance,yaw,pitch,w,h);worker.postMessage({type:'frame',id:++frameID,camera:activeCamera,maxRefs:renderer.maxRefs});}
  requestAnimationFrame(tick);
}
$('open').onclick=$('open-main').onclick=()=>$('file').click();$('file').onchange=e=>{openFile(e.target.files[0]);e.target.value='';};
$('reset').onclick=fit;$('rotate').onclick=()=>{auto=!auto;$('rotate').setAttribute('aria-pressed',String(auto));};
$('background').oninput=$('quality').onchange=request;
$('save').onclick=async()=>{
  try {const w=canvas.width,h=canvas.height,pixels=await renderer.readPixels(),copy=document.createElement('canvas');copy.width=w;copy.height=h;copy.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),w,h),0,0);
    copy.toBlob(blob=>{if(!blob)return;const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=filename.replace(/\.ply$/i,'')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  }catch(e){message(e.message,true);}
};
const points=new Map();let previousPinch;
canvas.onpointerdown=e=>{if(!ready)return;canvas.setPointerCapture(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});auto=false;$('rotate').setAttribute('aria-pressed','false');};
canvas.onpointermove=e=>{
  const prev=points.get(e.pointerId);if(!prev||!ready)return;
  const dx=e.clientX-prev.x,dy=e.clientY-prev.y;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(points.size===2){const p=[...points.values()],gap=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);if(previousPinch)distance*=previousPinch/gap;previousPinch=gap;}
  else if(e.buttons===2||e.shiftKey){const c=orbitCamera(target,distance,yaw,pitch,canvas.clientWidth,canvas.clientHeight),step=2*distance*Math.tan(25*Math.PI/180)/canvas.clientHeight;target=target.map((v,i)=>v-(c.right[i]*dx+c.down[i]*dy)*step);}
  else {yaw-=dx*.005;pitch=Math.max(-1.54,Math.min(1.54,pitch+dy*.005));}
  distance=Math.max(.21,Math.min(1e8,distance));request();
};
canvas.onpointerup=canvas.onpointercancel=e=>{points.delete(e.pointerId);previousPinch=undefined;};canvas.oncontextmenu=e=>e.preventDefault();
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!ready)return;distance=Math.max(.21,Math.min(1e8,distance*Math.exp(Math.max(-500,Math.min(500,e.deltaY))*.001)));request();},{passive:false});
window.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'&&ready&&!['INPUT','SELECT'].includes(e.target.tagName))fit();});
new ResizeObserver(request).observe($('stage'));
window.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;$('drop-hint').hidden=false;});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('dragleave',e=>{e.preventDefault();if(--dragDepth<=0)$('drop-hint').hidden=true;});
window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-hint').hidden=true;openFile(e.dataTransfer.files[0]);});
try {renderer=await Renderer.create(canvas);renderer.device.lost.then(info=>{ready=false;message(`GPU 连接已断开：${info.message}。请刷新页面重试。`,true);});renderer.device.addEventListener('uncapturederror',e=>message(`GPU 错误：${e.error.message}`,true));requestAnimationFrame(tick);}
catch(e){message(e.message,true);$('open-main').disabled=true;$('stats').textContent='WebGPU 不可用';}
