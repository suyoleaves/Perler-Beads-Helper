# 🧩 拼豆助手 （Perler Beads Helper）

一个运行在浏览器中的纯前端拼豆图纸生成与识别工具。支持将普通图片转为拼豆图纸（通道 A），或从已有的实物/图纸照片中识别提取色号（通道 B）。

A pure front-end web tool for generating and recognizing Perler bead patterns. Supports converting images to patterns (Channel A) or extracting color codes from existing photos/scans (Channel B).

![Screenshot](./public/screenshot_preview.png)
*(注：请在 `public` 目录下放入预览图 `screenshot_preview.png` 以显示预览)*

## ✨ 功能特性 (Features)

### 🎨 通道 A：像素图转换 (Pixel Art to Pattern)
适用于将普通图片或像素画转换为拼豆图纸。
*   **自动色彩匹配**：使用 **CIEDE2000** 色差算法，将像素颜色精准映射到 **MARD 221 色** 拼豆色卡。
*   **自定义网格校准**：通过拖动参考线定义单个像素格大小，支持任意比例的源图片。
*   **跟做模式**：生成图纸后，支持点击标记已完成的格子，辅助拼豆过程。

### 📐 通道 B：图纸识别 (Pattern Recognition)
适用于识别带有网格和色号标注的成品图纸或实物照片。
*   **高精度网格对齐**：
    *   拖动四条参考线定义“一个豆子单元格”，算法自动平铺推算全图网格。
    *   支持 **DPR 高清渲染** 与 **边缘吸附**，确保参考线精准对齐像素边缘。
*   **智能识别**：
    *   基于 **OpenCV.js** (WebAssembly) 的图像处理。
    *   **智能过滤**：自动忽略白色背景或极浅色格子。
    *   **透视校正**：支持四点透视变换，修复拍摄时的倾斜变形。
*   **实时预览**：实时显示当前单元格尺寸与预测阵列大小。

### 🛠️ 通用功能
*   **纯前端运行**：所有计算均在浏览器本地完成，图片**不会**上传到任何服务器，保护隐私。
*   **Web Worker 加速**：使用后台线程处理复杂的 CV 算法与色彩匹配，保持 UI 流畅。
*   **响应式设计**：适配桌面端与移动端操作。

## 🚀 技术栈 (Tech Stack)

*   **Core**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
*   **Build**: [Vite 7](https://vitejs.dev/)
*   **Styling**: [TailwindCSS 4](https://tailwindcss.com/)
*   **Image Processing**: 
    *   [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) (for heavy lifting)
    *   Canvas API (for rendering & calibration)
*   **Color Science**: CIEDE2000 algorithm for perceptual color matching.

## 📦 快速开始 (Getting Started)

### 环境要求
*   Node.js 20+

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev
```
访问 `http://localhost:5173` 查看效果。

### 构建生产版本
```bash
npm run build
```
构建产物将输出到 `dist` 目录。

## 🚢 部署 (Deployment)

本项目已配置 GitHub Actions 自动部署。

1.  将代码推送到 GitHub 仓库。
2.  进入仓库 Settings -> Pages。
3.  在 "Build and deployment" 下，Source 选择 **GitHub Actions**。
4.  每次 push 到 `master` 或 `main` 分支时，Actions 会自动构建并部署到 GitHub Pages。

**手动部署**：
由于 `vite.config.ts` 已配置 `base: './'`，你可以直接将 `dist` 目录下的文件部署到任何静态文件服务器（如 Nginx, Vercel, Netlify）。

## 📄 许可证 (License)

MIT License.

---
*Created with ❤️ for Perler Bead lovers.*
