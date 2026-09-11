/* Fast2DGS forward port. Copyright (C) 2023, Inria, GRAPHDECO research group.
 * All rights reserved. Research/evaluation use; see LICENSE.md and NOTICE.md. */
export const shader = /* wgsl */`
struct Splat {u:vec4f,v:vec4f,w:vec4f,color:vec4f}
struct Params {size:vec4u,bg:vec4f}
@group(0) @binding(0) var<storage,read> splats:array<Splat>;
@group(0) @binding(1) var<storage,read> offsets:array<u32>;
@group(0) @binding(2) var<storage,read> indices:array<u32>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var output:texture_storage_2d<rgba8unorm,write>;
@compute @workgroup_size(16,16)
fn main(@builtin(global_invocation_id) gid:vec3u) {
  if(gid.x>=params.size.x || gid.y>=params.size.y) {return;}
  let pixel=vec2f(gid.xy);
  let tile=(gid.y/16u)*params.size.z+gid.x/16u;
  var transmittance=1.0; var color=vec3f(0.0);
  for(var j=offsets[tile];j<offsets[tile+1u];j++) {
    let s=splats[indices[j]];
    if(params.size.w==1u) {
      let delta=vec2f(s.u.w,s.v.w)-pixel;
      if(dot(delta,delta)<=params.bg.w*params.bg.w) {
        color=s.color.xyz;transmittance=0.0;break;
      }
      continue;
    }
    let p=cross(pixel.x*s.w.xyz-s.u.xyz,pixel.y*s.w.xyz-s.v.xyz);
    if(p.z==0.0) {continue;}
    let uv=p.xy/p.z;
    let rho3d=dot(uv,uv);
    let delta=vec2f(s.u.w,s.v.w)-pixel;
    let rho2d=2.0*dot(delta,delta);
    let rho=min(rho3d,rho2d);
    var depth=s.w.z;
    if(rho3d<=rho2d) {depth=dot(vec3f(uv,1.0),s.w.xyz);}
    if(depth<0.2) {continue;}
    let power=-0.5*rho;
    if(power>0.0) {continue;}
    let alpha=min(0.99,s.w.w*exp(power));
    if(alpha<1.0/255.0) {continue;}
    let next=transmittance*(1.0-alpha);
    // CUDA stops BEFORE accumulating the threshold-crossing contribution.
    if(next<0.0001) {break;}
    color+=s.color.xyz*(alpha*transmittance);
    transmittance=next;
  }
  textureStore(output,vec2i(gid.xy),vec4f(clamp(color+transmittance*params.bg.xyz,vec3f(0),vec3f(1)),1.0));
}`;
const display = /* wgsl */`
@group(0) @binding(0) var image:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {return textureLoad(image,vec2i(p.xy),0);}
`;
export class Renderer {
  static async create(canvas) {
    if(!navigator.gpu) throw Error('此浏览器未启用 WebGPU。请使用支持 WebGPU 的浏览器，并开启硬件加速。');
    const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if(!adapter) throw Error('无法获取 WebGPU 显卡，请检查硬件加速设置。');
    const device=await adapter.requestDevice();
    const r=new Renderer();r.device=device;r.canvas=canvas;r.context=canvas.getContext('webgpu');
    r.context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
    r.compute=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:shader}),entryPoint:'main'}});
    const module=device.createShaderModule({code:display});
    r.display=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list'}});
    r.buffers={};r.uniform=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    r.maxRefs=Math.min(16000000,Math.floor(device.limits.maxStorageBufferBindingSize/4));
    return r;
  }
  upload(name,array) {
    const d=this.device,size=Math.max(4,array.byteLength);if(size>d.limits.maxStorageBufferBindingSize) throw Error('模型超出当前 GPU 的缓冲区容量。');
    if(!this.buffers[name] || this.buffers[name].size<size) {this.buffers[name]?.destroy();this.buffers[name]=d.createBuffer({size:Math.ceil(size/256)*256,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});}
    d.queue.writeBuffer(this.buffers[name],0,array);return this.buffers[name];
  }
  async render(frame,width,height,bg=[1,1,1],options={}) {
    const d=this.device;
    if(width>d.limits.maxTextureDimension2D || height>d.limits.maxTextureDimension2D) throw Error('图像尺寸超出 GPU 限制。');
    if(!this.texture || this.canvas.width!==width || this.canvas.height!==height) {
      this.texture?.destroy();this.canvas.width=width;this.canvas.height=height;
      this.texture=d.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
      this.textureView=this.texture.createView();this.presentGroup=d.createBindGroup({layout:this.display.getBindGroupLayout(0),entries:[{binding:0,resource:this.textureView}]});
    }
    const uniform=new ArrayBuffer(32);new Uint32Array(uniform).set([width,height,Math.ceil(width/16),options.mode==='points'?1:0]);new Float32Array(uniform).set([...bg,(options.pointSize??3)/2],4);d.queue.writeBuffer(this.uniform,0,uniform);
    const buffers=[this.upload('data',frame.data),this.upload('offsets',frame.offsets),this.upload('indices',frame.indices),this.uniform];
    const group=d.createBindGroup({layout:this.compute.getBindGroupLayout(0),entries:[...buffers.map((buffer,binding)=>({binding,resource:{buffer}})),{binding:4,resource:this.textureView}]});
    const encoder=d.createCommandEncoder(),compute=encoder.beginComputePass();compute.setPipeline(this.compute);compute.setBindGroup(0,group);compute.dispatchWorkgroups(Math.ceil(width/16),Math.ceil(height/16));compute.end();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[1,1,1,1]}]});pass.setPipeline(this.display);pass.setBindGroup(0,this.presentGroup);pass.draw(3);pass.end();d.queue.submit([encoder.finish()]);await d.queue.onSubmittedWorkDone();
  }
  async readPixels() {
    const width=this.canvas.width,height=this.canvas.height,row=Math.ceil(width*4/256)*256,d=this.device;
    const buffer=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const enc=d.createCommandEncoder();enc.copyTextureToBuffer({texture:this.texture},{buffer,bytesPerRow:row},{width,height});d.queue.submit([enc.finish()]);await buffer.mapAsync(GPUMapMode.READ);
    const source=new Uint8Array(buffer.getMappedRange()),result=new Uint8Array(width*height*4);for(let y=0;y<height;y++) result.set(source.subarray(y*row,y*row+width*4),y*width*4);buffer.unmap();buffer.destroy();return result;
  }
}
