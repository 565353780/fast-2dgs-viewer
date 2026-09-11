import test from 'node:test';import assert from 'node:assert/strict';
import {parsePLY,prepare,orbitCamera,compactCutoff,shBasis} from '../core.js';
import {plyBuffer,fixture,reference} from './fixtures.js';
for(const format of ['ascii','binary_little_endian','binary_big_endian']) test(`PLY ${format}: planar SH, logits, log scales, quaternion`,()=>{
  const s=parsePLY(plyBuffer([{x:1,opacity:Math.log(3),scale_0:Math.log(2),rot_0:Math.SQRT1_2,rot_3:Math.SQRT1_2,f_rest_14:7,f_rest_15:8,f_rest_44:9}],3,format));
  assert.equal(s.count,1);assert.equal(s.degree,3);assert.equal(s.sh[15],7);assert.equal(s.sh[17],8);assert.equal(s.sh[47],9);assert.ok(Math.abs(s.opacity[0]-.75)<1e-6);assert.ok(Math.abs(s.tangent[1]-2)<1e-6);
});
test('invalid / truncated / 3DGS data fail explicitly',()=>{
  assert.throws(()=>parsePLY(new ArrayBuffer(10)));assert.throws(()=>parsePLY(plyBuffer([{}],3,'binary_little_endian').slice(0,-1)),/截断/);
  assert.throws(()=>parsePLY(plyBuffer([{}],3,'ascii',['scale_2'])),/双轴/);
  assert.throws(()=>parsePLY(plyBuffer([{rot_0:0}])),/四元数/);
  assert.throws(()=>parsePLY(plyBuffer([{x:NaN}])),/无效/);
});
test('Compact Box uses mult under sqrt, SH3 preserves cubic term',()=>{
  assert.ok(Math.abs(compactCutoff(.1,.6)-Math.sqrt(.6*2*Math.log(25.5)))<1e-12);assert.equal(compactCutoff(1,0),3);assert.equal(shBasis(1,0,0)[15],-.5900435899266435);
});
test('camera pixel centers, plane transform and near plane',()=>{
  const s=parsePLY(plyBuffer([{z:0},{z:2.81}],0)),c=orbitCamera([0,0,0],3,0,0,64,64),f=prepare(s,c);
  assert.equal(f.visible,1);assert.equal(f.data[3],31.5);assert.equal(f.data[7],31.5);assert.equal(f.data[10],3);assert.equal(f.data[8],0);assert.equal(f.data[9],0);
});
test('stable front-to-back tile order and explicit capacity failure',()=>{
  const s=parsePLY(plyBuffer([{z:0},{z:1},{z:1}],0)),c=orbitCamera([0,0,0],3,0,0,64,64),f=prepare(s,c);const tile=5;
  assert.deepEqual(Array.from(f.indices.subarray(f.offsets[tile],f.offsets[tile+1])),[1,2,0]);assert.throws(()=>prepare(s,c,0),/容量/);
});
test('reference includes HDR color before final clamp and non-background pixels',()=>{
  const s=fixture(),c=orbitCamera([0,0,0],3,0,0,64,64),f=prepare(s,c),r=reference(s,c,f);
  assert.ok(f.data[12]>1);assert.ok(r.some((x,i)=>i%4!==3&&x<150));assert.equal(r.length,64*64*4);
});
