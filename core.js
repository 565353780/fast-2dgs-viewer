/* Fast2DGS forward port. Copyright (C) 2023, Inria, GRAPHDECO research group.
 * All rights reserved. Research/evaluation use; see LICENSE.md and NOTICE.md. */
const TYPES = {char:[1,'getInt8'],uchar:[1,'getUint8'],short:[2,'getInt16'],ushort:[2,'getUint16'],int:[4,'getInt32'],uint:[4,'getUint32'],float:[4,'getFloat32'],double:[8,'getFloat64'],int8:[1,'getInt8'],uint8:[1,'getUint8'],int16:[2,'getInt16'],uint16:[2,'getUint16'],int32:[4,'getInt32'],uint32:[4,'getUint32'],float32:[4,'getFloat32'],float64:[8,'getFloat64']};
export const TILE = 16;
export function parsePLY(buffer) {
  const bytes = new Uint8Array(buffer), decoder = new TextDecoder();
  const head = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 1048576)));
  const end = /(?:^|\n)end_header\r?\n/.exec(head);
  if (!end || !head.startsWith('ply\n') && !head.startsWith('ply\r\n')) throw Error('不是有效的 PLY 文件（缺少文件头）。');
  const offset = end.index + end[0].length;
  let format, vertex, current, stride = 0; const props = [];
  for (const line of head.slice(0, end.index).split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'format') { format = p[1]; if(p[2] !== '1.0') throw Error('仅支持 PLY 1.0。'); }
    if (p[0] === 'element') {
      if (!vertex && p[1] !== 'vertex' && Number(p[2]) !== 0) throw Error('vertex 必须是首个非空元素。');
      current = p[1]; if(current === 'vertex') { if(vertex) throw Error('重复 vertex 元素。'); vertex = Number(p[2]); }
    }
    if (p[0] === 'property' && current === 'vertex') {
      const type = TYPES[p[1]];
      if (!type) throw Error('不支持 vertex list 或未知属性类型。');
      if(props.some(x=>x.name===p[2])) throw Error('PLY 属性重复。');
      props.push({name:p[2], type, offset:stride}); stride += type[0];
    }
  }
  if (!Number.isInteger(vertex) || vertex < 1 || vertex > 1000000) throw Error('支持 1 至 1,000,000 个面片。');
  if (!['ascii','binary_little_endian','binary_big_endian'].includes(format)) throw Error('不支持此 PLY 编码。');
  const names = new Map(props.map((p,i)=>[p.name,i]));
  const required = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','rot_0','rot_1','rot_2','rot_3'];
  for(const name of required) if(!names.has(name)) throw Error(`缺少 ${name}；需要 Fast2DGS Gaussian PLY。`);
  if(props.filter(p=>p.name.startsWith('scale_')).length !== 2) throw Error('需要双轴 2DGS PLY；不支持三轴 3DGS 或网格 PLY。');
  const rest = props.filter(p=>p.name.startsWith('f_rest_')).length;
  const degree = [0,9,24,45].indexOf(rest);
  if(degree < 0 || Array.from({length:rest},(_,i)=>!names.has(`f_rest_${i}`)).some(Boolean)) throw Error('球谐属性不完整，支持 SH 0–3 阶。');
  const coeffs=(degree+1)**2, position=new Float32Array(vertex*3), tangent=new Float32Array(vertex*6), opacity=new Float32Array(vertex), sh=new Float32Array(vertex*coeffs*3);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let rows, cursor=0;
  if(format==='ascii') rows=decoder.decode(bytes.subarray(offset)).trim().split(/\s+/);
  else if(offset+vertex*stride > bytes.length) throw Error('PLY 文件被截断。');
  const view=new DataView(buffer), little=format==='binary_little_endian';
  const values=new Float64Array(props.length);
  const get=name=>values[names.get(name)];
  for(let i=0;i<vertex;i++) {
    for(let j=0;j<props.length;j++) {
      const p=props[j]; const value=rows?Number(rows[cursor++]):view[p.type[1]](offset+i*stride+p.offset,little);
      if(!Number.isFinite(value)) throw Error(`第 ${i+1} 个面片含无效数值。`);
      values[j]=value;
    }
    for(let k=0;k<3;k++) {const v=get(['x','y','z'][k]);position[i*3+k]=v;min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);}
    const s0=Math.exp(get('scale_0')),s1=Math.exp(get('scale_1'));
    let [w,x,y,z]=[0,1,2,3].map(k=>get(`rot_${k}`)); const norm=Math.hypot(w,x,y,z);
    if(!norm || !Number.isFinite(s0+s1) || s0<1e-38 || s1<1e-38 || s0>1e30 || s1>1e30) throw Error('面片尺度或四元数无效。');
    w/=norm;x/=norm;y/=norm;z/=norm;
    tangent.set([(1-2*(y*y+z*z))*s0,2*(x*y+w*z)*s0,2*(x*z-w*y)*s0,2*(x*y-w*z)*s1,(1-2*(x*x+z*z))*s1,2*(y*z+w*x)*s1],i*6);
    opacity[i]=1/(1+Math.exp(-get('opacity')));
    for(let ch=0;ch<3;ch++) {
      sh[i*coeffs*3+ch*coeffs]=get(`f_dc_${ch}`);
      for(let k=1;k<coeffs;k++) sh[i*coeffs*3+ch*coeffs+k]=get(`f_rest_${ch*(coeffs-1)+k-1}`);
    }
  }
  for(const data of [position,tangent,sh]) if(data.some(v=>!Number.isFinite(v))) throw Error('属性超出 float32 范围。');
  return {count:vertex,degree,coeffs,position,tangent,opacity,sh,bounds:{min,max}};
}
export function shBasis(x,y,z) {
  const xx=x*x,yy=y*y,zz=z*z;
  return [0.28209479177387814,-0.4886025119029199*y,0.4886025119029199*z,-0.4886025119029199*x,1.0925484305920792*x*y,-1.0925484305920792*y*z,0.31539156525252005*(2*zz-xx-yy),-1.0925484305920792*x*z,0.5462742152960396*(xx-yy),-0.5900435899266435*y*(3*xx-yy),2.890611442640554*x*y*z,-0.4570457994644658*y*(4*zz-xx-yy),0.3731763325901154*z*(2*zz-3*xx-3*yy),-0.4570457994644658*x*(4*zz-xx-yy),1.445305721320277*z*(xx-yy),-0.5900435899266435*x*(xx-3*yy)];
}
export function compactCutoff(opacity,mult=0.6) {return mult>0?Math.min(3,Math.sqrt(Math.max(mult*2*Math.log(Math.max(opacity*255,1+1e-6)),1e-6))):3;}
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
export function orbitCamera(target,distance,yaw,pitch,width,height,fov=50) {
  const eye=target.map((v,i)=>v+distance*[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)][i]);
  const forward=normalize(target.map((v,i)=>v-eye[i])),right=normalize(cross(forward,[0,1,0])),down=cross(forward,right);
  const f=height/(2*Math.tan(fov*Math.PI/360));
  return {eye,right,down,forward,width,height,fx:f,fy:f,cx:(width-1)/2,cy:(height-1)/2,mult:0.6};
}
export function prepare(scene,camera,maxRefs=16000000) {
  const {width,height,eye,right,down,forward,fx,fy,cx,cy}=camera;
  const nx=Math.ceil(width/TILE),ny=Math.ceil(height/TILE),tiles=nx*ny;
  const data=new Float32Array(scene.count*16), depth=new Float32Array(scene.count), rects=new Int32Array(scene.count*4),counts=new Uint32Array(tiles);
  const visible=[]; let total=0;
  for(let i=0;i<scene.count;i++) {
    const p=Array.from(scene.position.subarray(i*3,i*3+3)),delta=p.map((v,k)=>v-eye[k]);
    const z=dot(delta,forward); if(z<=0.2) continue;
    const a=scene.tangent.subarray(i*6,i*6+3),b=scene.tangent.subarray(i*6+3,i*6+6);
    if(dot(delta,cross(a,b))===0) continue;
    const vx=[dot(a,right),dot(b,right),dot(delta,right)],vy=[dot(a,down),dot(b,down),dot(delta,down)],w=[dot(a,forward),dot(b,forward),z];
    const u=vx.map((v,k)=>fx*v+cx*w[k]),v=vy.map((v,k)=>fy*v+cy*w[k]);
    const cutoff=compactCutoff(scene.opacity[i],camera.mult),c2=cutoff*cutoff,den=c2*(w[0]*w[0]+w[1]*w[1])-w[2]*w[2];
    if(den===0) continue;
    const f=[c2/den,c2/den,-1/den],sum=(a,b)=>f[0]*a[0]*b[0]+f[1]*a[1]*b[1]+f[2]*a[2]*b[2];
    const px=sum(u,w),py=sum(v,w),ex=Math.sqrt(Math.max(1e-4,px*px-sum(u,u))),ey=Math.sqrt(Math.max(1e-4,py*py-sum(v,v)));
    const radius=Math.ceil(Math.max(ex,ey,cutoff*0.707106));
    // CUDA getRect truncates toward zero and uses BLOCK_X - 1 (not ceil).
    const x0=Math.min(nx,Math.max(0,Math.trunc((px-radius)/16))),y0=Math.min(ny,Math.max(0,Math.trunc((py-radius)/16)));
    const x1=Math.min(nx,Math.max(0,Math.trunc((px+radius+15)/16))),y1=Math.min(ny,Math.max(0,Math.trunc((py+radius+15)/16)));
    if(x1<=x0 || y1<=y0 || !Number.isFinite(radius)) continue;
    total+=(x1-x0)*(y1-y0); if(total>maxRefs) throw Error('当前视角超出 GPU 分块容量；请缩小视图或使用较小的模型。');
    rects.set([x0,y0,x1,y1],i*4);depth[i]=z;visible.push(i);
    const dir=normalize(delta),basis=shBasis(...dir),color=[];
    for(let ch=0;ch<3;ch++) {let c=0.5;for(let k=0;k<scene.coeffs;k++) c+=basis[k]*scene.sh[i*scene.coeffs*3+ch*scene.coeffs+k];color.push(Math.max(0,c));}
    data.set([...u,px,...v,py,...w,scene.opacity[i],...color,0],i*16);
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) counts[y*nx+x]++;
  }
  visible.sort((a,b)=>depth[a]-depth[b] || a-b);
  const offsets=new Uint32Array(tiles+1);for(let t=0;t<tiles;t++) offsets[t+1]=offsets[t]+counts[t];
  const cursors=offsets.slice(0,tiles),indices=new Uint32Array(Math.max(1,total));
  for(const i of visible) {const [x0,y0,x1,y1]=rects.subarray(i*4,i*4+4);for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) indices[cursors[y*nx+x]++]=i;}
  return {data,offsets,indices,visible:visible.length,references:total};
}
