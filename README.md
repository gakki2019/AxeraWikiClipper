# AxeraWikiClipper

一个 Obsidian 插件，用来把公司内网 Confluence wiki（`https://wiki.aixin-chip.com`）上的某一篇页面
连同页面里的附件一次性下载到你的 vault 里，正文自动转换成 Markdown。

下载命令只做一件事，没有同步、没有递归、没有花哨功能——贴个 URL 进去，一份干净的本地笔记就出来了。

## 主要功能

- 命令面板里一条命令：粘贴 wiki 页面的链接（或者只贴纯数字 pageId）按回车即可。
- 页面正文会被转成标准 Markdown，常见的 Confluence 宏（代码块 `code`、提示框 `info/note/warning/tip`、
  图片 `ac:image`、附件链接 `ac:link` 等）都有对应的转换规则。
- 所有附件会下载到一个以页面标题命名的子文件夹里。
- 正文里的图片 / 附件引用会被自动改写成本地相对路径，Obsidian 预览里图片和 PDF 链接可以直接打开。
- 可选写入 YAML frontmatter：`source`、`pageId`、`spaceKey`、`version`、`originalTitle`、
  `createdBy`、`createdAt`、`lastModifiedBy`、`lastModifiedAt`、`fetchedAt`。
- 附件引用格式可选 **Obsidian wikilink `![[...]]`**（默认）或 **标准 Markdown `![](...)`**——
  前者在 Obsidian 里体验最好，后者适合把笔记同步到其他支持 Markdown 的工具里。

## 安装（开发 / 手动安装）

```powershell
git clone <本仓库地址> d:\path\to\AxeraWikiClipper
cd d:\path\to\AxeraWikiClipper
npm install
npm run build
```

然后把编译出来的 `main.js`、`manifest.json`、`styles.css` 三个文件，拷到你 vault 下的插件目录：

```
<你的vault>/.obsidian/plugins/ax-wiki-clipper/
```

> 目录名必须叫 `ax-wiki-clipper`（等于 `manifest.json` 里的 `id`）。显示名 `AxeraWikiClipper`
> 只影响 Obsidian 界面上的展示。

打开 Obsidian → **设置 → 第三方插件**，找到 AxeraWikiClipper，开启开关。

## 配置

开启插件后进入 **设置 → AxeraWikiClipper**，从上到下填：

1. **Wiki base URL** — 默认 `https://wiki.aixin-chip.com`，不用改。
2. **Authentication mode** — 选 `Basic Auth`（推荐）或 `Cookie`。
3. 选了 Basic Auth：填 **Username** 和 **Password**（就是登录 wiki 的账号密码）。
4. 选了 Cookie：从浏览器 DevTools → Application → Cookies 里，把整条
   `JSESSIONID=...; seraph.confluence=...` 粘贴进去。SSO 场景下用这个。
5. **Inbox folder** — 下载出来的 Markdown 和附件放在 vault 下的哪个子目录，默认 `inbox`。
6. **Filename source** — Markdown 文件名是用 **页面标题** 还是 **页面 ID**。
7. **Overwrite existing files** — 关掉的话，已经下过的页面会跳过。
8. **Download all attachments** — 默认**关闭**。打开后会把 API 返回的全部附件都下载下来，
   包括页面历史版本里已经被替换掉的旧附件；关闭时只下载当前正文引用到的那些。
9. **Write frontmatter** — 关掉的话 Markdown 文件顶部就不会有 YAML 块。
10. **Attachment link style** — 默认 `Obsidian wikilink ![[path]]`；需要跨工具可读时选
    `Standard Markdown ![](path)`。

> ⚠ 密码和 Cookie 是**明文**保存在
> `<你的vault>/.obsidian/plugins/ax-wiki-clipper/data.json` 里。
> 如果担心安全，请用一个权限受限的专用 wiki 账号，不要用你的主力账号。

## 使用

三种等价的触发方式：

- 点击 Obsidian 左侧 ribbon 里的 Axera logo 图标。
- Ctrl+P 打开命令面板，搜索 `AxeraWikiClipper: Download wiki page by URL`。
- 在 **设置 → 快捷键** 里给这条命令分配一个你喜欢的快捷键。

会弹出一个输入框，支持下面几种输入：

- 完整链接：`https://wiki.aixin-chip.com/pages/viewpage.action?pageId=242053973`
- 完整链接：`https://wiki.aixin-chip.com/spaces/~foo/pages/242053973/Some+Title`
- 纯数字 ID：`242053973`

> 短链格式 `/x/...` 这版**不支持**，请用上面三种之一。

下载完之后，目录结构大概是这样（以默认 `inbox/` 为例）：

```
inbox/
├── AX8860 AXCL runtime 支持pytorch VMM.md
└── AX8860 AXCL runtime 支持pytorch VMM/
    ├── image2026-4-22_20-21-0.png
    ├── 虚拟内存到物理内存映射.pdf
    └── ...
```

## 调试日志

设置页最下面有一个 **Enable debug logs** 开关。拨到 ON，再用 `Ctrl+Shift+I` 打开开发者工具的
Console，就能看到所有带 `[AxeraWikiClipper]` 前缀的日志——HTTP 请求、URL 解析、转换过程每一步都有。
拨回 OFF 就关掉。

## 运行测试

```powershell
npm test
```

跑的是 `vitest` + `jsdom`，覆盖 URL 解析、文件名清洗、XHTML → Markdown 转换、HTTP 客户端的
重定向回退、以及整个 pipeline 的端到端用例。

## 范围

做的：

- 单条 URL 下载单页 + 附件
- 冲突时覆盖
- Basic Auth 和 Cookie 两种认证

**不**做的：

- 自动递归子页面
- 增量同步 / 变更检测
- 反向同步（Obsidian → Confluence）
- SSO / OAuth
- 评论、版本历史

## 上传代码需要哪些文件

提交到 git 时只需要源码，构建产物和依赖**不**要提交。需要上传的：

```
.gitignore
README.md
manifest.json
package.json
package-lock.json
tsconfig.json
esbuild.config.mjs
styles.css
main.ts
src/              所有 .ts
tests/            所有 .ts 和 fixtures
docs/             PLAN.md、TASKS.md、wiki.svg
```

**不要**上传（已在 `.gitignore` 里）：`node_modules/`、`main.js`（构建产物）、`*.js.map`、
`dist/`、`.env`、`.vscode/`、`coverage/`。

别人克隆后跑 `npm install && npm run build` 即可得到 `main.js`。
# AX Wiki Clipper

An Obsidian plugin that downloads a page from the internal Confluence wiki
(`https://wiki.aixin-chip.com`) together with all of its attachments into your
vault, converting the page body to standard Markdown.

## Features

- One command: paste a wiki page URL (or the bare numeric pageId) and hit Enter.
- The page body is converted to Markdown via turndown + GFM + custom rules for
  Confluence storage-format macros (`ac:structured-macro`, `ac:image`,
  `ac:link`, callouts, …).
- All attachments are downloaded to a sub-folder named after the page title.
- Image and attachment references in the Markdown are rewritten to local paths
  so previews render correctly in Obsidian.
- Optional YAML frontmatter with `source`, `pageId`, `spaceKey`, `version`,
  `originalTitle`, `fetchedAt`.

## Install (development)

```powershell
git clone <this repo> d:\path\to\ax-wiki-clipper
cd d:\path\to\ax-wiki-clipper
npm install
npm run build
```

Then copy (or symlink) `main.js`, `manifest.json`, and `styles.css` into your
vault's plugin folder:

```
<vault>/.obsidian/plugins/ax-wiki-clipper/
```

Enable the plugin under **Settings → Community plugins**.

## Configure

Open **Settings → AX Wiki Clipper** and fill in:

1. **Wiki base URL** — defaults to `https://wiki.aixin-chip.com`.
2. **Authentication mode** — `Basic Auth` (recommended) or `Cookie`.
3. For Basic Auth: your wiki **username** and **password**.
4. For Cookie: paste the full `Cookie` header value from a logged-in browser
   (Chrome DevTools → Application → Cookies, copy `JSESSIONID=...; seraph.confluence=...`).
5. **Inbox folder** — vault-relative folder (default `inbox`).
6. **Filename source** — `Page title` or `Page ID`.
7. **Overwrite existing files** — off will skip already-downloaded pages.
8. **Download all attachments** — off will download only those referenced in the page body.
9. **Write frontmatter** — off will skip the YAML block.

> ⚠ Credentials are saved in plain text in
> `<vault>/.obsidian/plugins/ax-wiki-clipper/data.json`. Use a dedicated
> restricted wiki account if this concerns you.

## Use

Three equivalent triggers:

- Click the `book-down` icon in the left ribbon.
- Command Palette (`Ctrl+P`) → `AX Wiki Clipper: Download wiki page by URL`.
- A custom hotkey you assign under **Settings → Hotkeys**.

A modal asks for a URL or page ID. Accepted inputs:

- `https://wiki.aixin-chip.com/pages/viewpage.action?pageId=242053973`
- `https://wiki.aixin-chip.com/spaces/~foo/pages/242053973/Some+Title`
- `242053973` (bare numeric id)

Short links (`/x/...`) are **not** supported in this release.

After the command runs, you'll see something like this under `inbox/`:

```
inbox/
├── AX8860 AXCL runtime 支持pytorch VMM.md
└── AX8860 AXCL runtime 支持pytorch VMM/
    ├── image2026-4-22_20-21-0.png
    ├── 虚拟内存到物理内存映射.pdf
    └── ...
```

## Debug logs

The settings page has an **Enable debug logs** button. Click it, then open the
developer tools with `Ctrl+Shift+I` to see verbose `[AX Wiki Clipper]` messages
for each HTTP request and conversion step.

## Run tests

```powershell
npm test
```

Unit tests run with `vitest` + `jsdom` and cover the utilities and the
XHTML → Markdown converter against a real fixture.

## Scope / non-goals

In scope:

- Single-URL download of a single page + its attachments.
- Overwrite-on-conflict.
- Basic Auth and Cookie authentication.

Not in scope:

- Recursive download of child pages.
- Incremental sync / change detection.
- SSO / OAuth flows.
- Two-way sync.
