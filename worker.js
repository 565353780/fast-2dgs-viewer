import {parsePLY,prepare} from './core.js?v=2';
let scene,generation;
self.onmessage=({data:m})=>{
  try {
    if(m.type==='load') {generation=m.generation;scene=null;scene=parsePLY(m.buffer);self.postMessage({type:'loaded',generation,count:scene.count,degree:scene.degree,bounds:scene.bounds});}
    if(m.type==='frame') {const start=performance.now(),frame=prepare(scene,m.camera,m.maxRefs);self.postMessage({type:'frame',generation,id:m.id,ms:performance.now()-start,...frame},[frame.data.buffer,frame.offsets.buffer,frame.indices.buffer]);}
  } catch(e) {self.postMessage({type:'error',generation,message:e.message,id:m.id});}
};
