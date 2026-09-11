# Attribution and scope

The JavaScript preprocessing and WGSL forward rasterizer in `core.js` and
`renderer.js` are a browser port of the RGB Fast2DGS surfel renderer, derived
from `diff-surfel-rasterization` (2D Gaussian Splatting) and its Fast2DGS variant.

Copyright (C) 2023, Inria. GRAPHDECO research group,
https://team.inria.fr/graphdeco. All rights reserved.
This software is free for non-commercial, research and evaluation use under
the terms of LICENSE.md. For inquiries contact george.drettakis@inria.fr.

The complete upstream license is retained in LICENSE.md and applies to this
distribution. No third-party JavaScript package or compiled rasterizer is bundled.

Reference revisions: gs-fit `190b491e99e267c5e52607550e121bb2c04f1608`;
fast-2dgs `448ea2fe32215fdaa52798c9fa453cddf318df45`.
Reference files: `fast_twodgs/Model/gs.py`, `Method/render_kernel.py`,
`Module/gs_renderer.py`, and the CUDA rasterizer's `forward.cu` / `auxiliary.h`.
Only the RGB forward path is ported. Training, gradients, service orchestration,
segmentation, pose estimation and mesh extraction are not part of this viewer.

Related upstream project: https://github.com/hbb1/2d-gaussian-splatting
