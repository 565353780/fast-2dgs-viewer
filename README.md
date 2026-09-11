# Fast2DGS Viewer

**[在线体验 → https://565353780.github.io/fast-2dgs-viewer/](https://565353780.github.io/fast-2dgs-viewer/)**

纯原生 HTML / CSS / JavaScript / WGSL 的 Fast2DGS PLY 查看器。无需构建、npm 依赖、CDN、后端或模型上传接口。文件通过浏览器 File API 在本地读取。

打开 `.ply` 或拖入页面。在“显示”中切换 **2DGS 渲染 / 点云**，保留当前视角。点云显示每个 Gaussian 的中心，使用当前视角的 SH 颜色、按深度遮挡，可调整点大小（1–8 CSS 像素）；不应用面片尺度与透明度，适合检查分布和漂浮点，不能代替 2DGS 外观验收。默认仍为原来的 Fast2DGS 渲染。

左键拖动旋转，右键 / Shift 拖动平移，滚轮缩放，F 适配。触屏支持单指旋转与双指缩放。可切换背景、分辨率、自动旋转和导出 PNG。1× 对应视口 CSS 像素；2× 提供更高分辨率，不改变面片数量或 SH 阶数。

## 渲染约定

这是 Fast2DGS **RGB 前向路径的 WebGPU 移植**。浏览器不能直接运行 PyTorch / CUDA 脚本；数学路径与源实现对应，浮点运算和执行后端不同，不承诺逐位一致。

| 项目 | 约定 |
|---|---|
| PLY | ASCII / binary little-endian / big-endian；标准 Gaussian 属性 |
| 面片 | 恰好 `scale_0/1`，使用 exp(log-scale)，无第三轴替代或体高斯 |
| 旋转、透明度 | 归一化 wxyz 四元数；sigmoid(opacity logit) |
| 颜色 | SH 0–3 阶；`f_rest_*` 按通道排列；方向 normalize(position − camera) |
| 色彩截断 | SH 加 0.5 后仅截断负数；合成完成后截断到 [0,1]；不附加 gamma 或色调映射 |
| 投影 | 透视 ray–surfel 交点，整数像素中心；右 / 下 / 前的光栅相机坐标 |
| 分块 | 16×16；同源 AABB 与 getRect；按面片中心深度稳定排序 |
| Compact Box | 默认 mult=0.6，cutoff=min(3,sqrt(max(mult×2×log(max(opacity×255,1+1e−6)),1e−6))) |
| 低通 | rho=min(rho3d,2×屏幕距离²)，low-pass 分支采用中心深度 |
| 裁剪 | 中心深度 ≤0.2 不可见；逐像素深度 <0.2 跳过；双面可见 |
| 合成 | alpha=min(0.99,opacity×exp(−rho/2))；小于 1/255 跳过；T_next<1e−4 时在累积前停止 |
| 背景 | 默认白色；输出 C+T×background |

PLY 不包含训练相机。初始视角根据包围盒适配，保持模型世界尺度，不变换或归一化几何。若需与某个训练帧比较，必须同时对齐相机外参、内参、分辨率、背景和 mult；单凭相同 PLY 不意味着相同截图。`core.js` 的 `prepare(scene,camera)` 接受明确的 eye/right/down/forward 与 fx/fy/cx/cy，可用于固定相机验证。

## 运行与验证

```sh
python3 -m http.server 8000
# 打开 http://localhost:8000
npm test
# 打开 http://localhost:8000/tests/browser.html 运行真实 WebGPU 数值回归
```

需要启用 WebGPU 和硬件加速的浏览器，通过 HTTPS 或 localhost 访问。无 WebGPU 时明确提示，不回退到不同的渲染算法。

Node 测试覆盖三种 PLY 编码、激活、SH 通道布局、裁剪、投影中心、稳定排序和损坏输入。浏览器测试用独立的世界坐标射线/平面求交参考实现，比较多视角 GPU 输出，要求每通道误差不超过 1/255。此测试验证移植的一致性，但不是运行原始 CUDA 二进制的端到端对比。

预处理、排序与分块在 Web Worker；逐像素前向合成在 GPU。静止后停止重绘，交互时连续渲染。状态栏静止时显示预处理加 GPU 提交完成的耗时，自动旋转时显示实际完成帧间隔对应 FPS。性能取决于模型、分辨率及显卡，不保证所有模型达到 60 FPS。

显式容量限制：文件 ≤512 MB、面片 ≤1,000,000、分块引用 ≤16,000,000，并受设备缓冲区上限约束；超限报错，不静默删减面片。拒绝三轴 3DGS、网格及缺少 Gaussian 属性的点云。

## 发布

发布更新时同步递增 `index.html`、`app.js`、`worker.js` 中的资源版本参数，避免浏览器缓存混用不同版本。

`gh-pages` 分支只包含运行所需的静态文件和授权声明，可直接作为 GitHub Pages 的发布源（根目录）。仓库保留测试与本说明，发布版本不带测试数据、PLY、服务地址、访问凭据或训练代码。

源版本与授权见 [NOTICE.md](NOTICE.md) 和 [LICENSE.md](LICENSE.md)。
