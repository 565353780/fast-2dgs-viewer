import {cross,dot,normalize,parsePLY} from '../core.js';
export function plyBuffer(rows,degree=3,format='ascii',extra=[]) {
  const rest=3*((degree+1)**2-1),names=['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2',...Array.from({length:rest},(_,i)=>`f_rest_${i}`),'opacity','scale_0','scale_1','rot_0','rot_1','rot_2','rot_3',...extra];
  const header=new TextEncoder().encode(`ply\nformat ${format} 1.0\nelement vertex ${rows.length}\n${names.map(n=>`property float ${n}\n`).join('')}end_header\n`);
  const values=rows.flatMap(row=>names.map(n=>row[n]??(n==='rot_0'?1:n.startsWith('scale_')?-2:0)));
  if(format==='ascii') {const body=new TextEncoder().encode(values.join(' '));const b=new Uint8Array(header.length+body.length);b.set(header);b.set(body,header.length);return b.buffer;}
  const b=new Uint8Array(header.length+values.length*4);b.set(header);const view=new DataView(b.buffer);values.forEach((v,i)=>view.setFloat32(header.length+i*4,v,format==='binary_little_endian'));return b.buffer;
}
export function fixture() {
  const rows=[
    {x:0,y:0,z:0,opacity:2,scale_0:-1.2,scale_1:-1.7,f_dc_0:2.7,f_rest_14:1.3},
    {x:.15,y:.09,z:-.18,rot_0:.92,rot_1:.22,rot_2:.32,opacity:4,scale_0:-1,scale_1:-1.4,f_dc_1:2,f_rest_23:.9},
    {x:-.2,y:-.2,z:.3,rot_0:.7,rot_1:.3,rot_2:.5,rot_3:.2,opacity:-1,scale_0:-1.8,scale_1:-2,f_dc_2:1.8,f_rest_44:-1.4},
    {x:0,y:0,z:2.95,opacity:6}, // near-plane culling for first camera
    {x:.4,y:.1,z:0,opacity:-8},
  ];
  // Overlap enough high-opacity planes to exercise early exit.
  for(let i=0;i<5;i++) rows.push({x:-.45,y:.3,z:-i*.01,opacity:9,scale_0:-1.5,scale_1:-1.5,f_dc_0:i?0:5});
  return parsePLY(plyBuffer(rows));
}
// Independent world-space ray/plane reference: does not use the GPU's transMat
// cross-product intersection. The prepared tile list and low-pass center are
// shared; projection/binning invariants are checked separately in core.test.js.
export function reference(scene,camera,frame,bg=[1,1,1]) {
  const {width,height,eye,right,down,forward,fx,fy,cx,cy}=camera,nx=Math.ceil(width/16),out=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const ray=forward.map((v,k)=>v+right[k]*(x-cx)/fx+down[k]*(y-cy)/fy),tile=Math.floor(y/16)*nx+Math.floor(x/16);let T=1,C=[0,0,0];
    for(let j=frame.offsets[tile];j<frame.offsets[tile+1];j++) {
      const i=frame.indices[j],a=scene.tangent.subarray(i*6,i*6+3),b=scene.tangent.subarray(i*6+3,i*6+6),p=scene.position.subarray(i*3,i*3+3),n=cross(a,b),den=dot(ray,n);
      if(den===0)continue;
      const delta=Array.from(p,(v,k)=>v-eye[k]),distance=dot(delta,n)/den;
      const relative=ray.map((v,k)=>v*distance-delta[k]),u=dot(relative,a)/dot(a,a),v=dot(relative,b)/dot(b,b),r3=u*u+v*v;
      const r2=2*((frame.data[i*16+3]-x)**2+(frame.data[i*16+7]-y)**2);
      const depth=r3<=r2?distance:dot(delta,forward);if(depth<.2)continue;
      const alpha=Math.min(.99,scene.opacity[i]*Math.exp(-.5*Math.min(r2,r3)));if(alpha<1/255)continue;
      const next=T*(1-alpha);if(next<1e-4)break;
      C=C.map((v,k)=>v+frame.data[i*16+12+k]*alpha*T);T=next;
    }
    const offset=(y*width+x)*4;for(let k=0;k<3;k++)out[offset+k]=Math.round(Math.max(0,Math.min(1,C[k]+T*bg[k]))*255);out[offset+3]=255;
  }
  return out;
}
// Brute-force point oracle, independent of tile binning and prepared screen centers.
export function referencePoints(scene,camera,bg) {
  const points=[];
  for(let i=0;i<scene.count;i++) {const d=Array.from(scene.position.subarray(i*3,i*3+3),(v,k)=>v-camera.eye[k]),z=dot(d,camera.forward);if(z<=.2)continue;
    points.push({i,z,x:camera.fx*dot(d,camera.right)/z+camera.cx,y:camera.fy*dot(d,camera.down)/z+camera.cy});}
  points.sort((a,b)=>a.z-b.z||a.i-b.i);
  const out=new Uint8Array(camera.width*camera.height*4);
  for(let y=0;y<camera.height;y++)for(let x=0;x<camera.width;x++){
    const p=points.find(p=>(p.x-x)**2+(p.y-y)**2<=(camera.pointSize/2)**2);
    // SH0 fixtures isolate coverage, size and opaque depth ordering.
    const color=p?Array.from({length:3},(_,ch)=>Math.max(0,.5+.28209479177387814*scene.sh[p.i*3+ch])):bg;
    const k=(y*camera.width+x)*4;out.set([...color.map(c=>Math.round(Math.min(1,c)*255)),255],k);
  }
  return out;
}
