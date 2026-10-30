# GitHub Pages 发布

本项目是静态 HTML / CSS / JavaScript 原型，无需构建、服务端或 API 密钥。

## 仓库结构

- `main`：完整源码、页面图片和说明文档。
- `gh-pages`：只发布 `dist/` 里的网页文件；入口为根目录的 `index.html`。
- GitHub 仓库 Settings → Pages：选择 Deploy from a branch，分支 `gh-pages`，目录 `/ (root)`。

## 更新网页

在源码目录提交修改，然后更新发布分支：

```sh
git add dist README.md INTERACTIONS.md VERIFICATION.md DEPLOYMENT.md server.cjs .gitignore
git commit -m "Update fleet prototype"
git push origin main
git subtree split --prefix dist -b pages-release
git push origin pages-release:gh-pages
git branch -d pages-release
```

等待 GitHub Pages 部署完成后刷新网页。`dist/.nojekyll` 让站点直接使用静态文件。

## 公开范围

网页包含原型使用的地图、车辆与摄像头静态素材，以及示例车辆、计划和流程数据。公开源码仓库也会公开这些文件。仓库不包含原始 SVG 文档、浏览器保存状态、本机配置或凭据。

创建的计划和流程修改仍只保存在访问者当前浏览器的 localStorage 中，各个访问者之间不会同步。网页演示操作不会连接真实车辆或业务服务。
