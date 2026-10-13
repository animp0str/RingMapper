# 发布网站

RingMapper 的 `dist/` 是完整静态网站，无需 Node 后端、数据库或自有服务器。发布的只有编辑器程序和教程；不要上传 Map、备份、整个项目或本地歌曲资源。

## 构建与检查

```powershell
npm ci
npm run build
npm run preview
```

访问终端提供的本地地址。页面第一次打开应提示选择本地文件夹，不应自动显示开发者的歌曲。Chrome / Edge 中选择自己的 Map、试听并编辑，点击保存后允许写入。

- 正式访问使用 HTTPS；目录选择需要用户点击，并受浏览器权限控制。
- 没有目录接口的浏览器仍可新建、导入 ZIP / YAML、导出 ZIP。
- 本地设置、草稿和授权记录归属于网站地址。更换域名后需要重新选择目录，旧网站草稿不会自动迁移。
- 保存的备份位于用户所选 Map 内的 `.ringmapper-backups`；网站服务商不会收到这些文件。

## Cloudflare Pages：直接上传

1. 登录自己的 Cloudflare 账号，在 Workers & Pages 中创建 Pages 项目，选择上传静态资源（Direct Upload）。
2. 上传刚生成的 **dist 文件夹内的全部内容**，确保 `index.html` 位于部署根目录。
3. 发布后使用平台分配的 `*.pages.dev` HTTPS 地址；无需先购买域名。
4. 后续更新重新运行 `npm run build`，上传新的 dist。不要混用两次构建的 HTML 与带哈希文件名的 assets。

也可以使用其他 HTTPS 静态托管平台。当前部署以站点根路径为准；子路径托管需要额外配置资源路径。

官方说明：<https://developers.cloudflare.com/pages/get-started/direct-upload/>
目录访问说明：<https://developer.chrome.com/docs/capabilities/web-apis/file-system-access>

## 发布验收

```powershell
npm test
npm run test:ui
npm run test:static
```

最后一项构建网站，并用 Python 标准库静态服务器运行独立验收（本机需有 Python 3）。不使用 Vite 的文件后端。测试工作区是浏览器内的隔离副本，项目 Map 仅作只读测试数据。

上传后再用真实目录完成一次手动验收：目录选择弹窗 → 读取授权 → 修改一个测试谱面 → 写入授权 → 检查磁盘上的谱面和备份 → 刷新并重新授权。自动化测试使用真实文件句柄和隔离目录，但不替用户点击操作系统的权限弹窗。

浏览器目录接口不提供整个歌曲的多文件事务。编辑器会先备份、检查版本并在写入错误时尝试恢复；若系统断电或浏览器被强制关闭，可从上述备份目录手动恢复。正常情况下保存失败会保留编辑内容，也可立即导出 ZIP。
