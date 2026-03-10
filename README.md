<div align="center">
  <img src="icon-v2.png" alt="自律" width="120" />
  <h1>自律</h1>
  <p><strong>一款简洁的习惯打卡 PWA 应用</strong></p>
  <p>帮助你养成良好的作息和生活习惯<br/>支持 iOS / Android 添加到主屏幕，像原生 App 一样使用</p>
</div>

<br/>

## ✨ 功能特性

### 😴 睡眠打卡

- 每日记录入睡时间，打卡时间窗口为 **21:00 ~ 次日 04:00**
- ECharts 可视化入睡时间趋势曲线
- 支持本周 / 本月 / 半年 / 一年多维度查看
- 实时时钟显示，打卡后展示记录时间
- 支持撤回重新打卡

### ✅ 习惯打卡

- **每日习惯**：每天需要完成的打卡任务
- **每周习惯**：设定每周目标次数（1~7次），灵活安排打卡日
- **额外打卡**：周目标完成后，仍可在未打卡的天进行额外打卡
- 打卡 / 撤回操作带 FLIP 卡片动画，已打卡的卡片自动下沉排列
- 进度条实时显示本周完成情况

### 📅 缺卡记录

- 月历视图，直观查看每日缺卡情况
- 四级颜色标识：

  | 颜色 | 含义 | 缺卡次数 |
  |:---:|:---:|:---:|
  | 🟢 绿色 | 完美 | 0 次 |
  | 🟡 黄色 | 良好 | 1 次 |
  | 🟠 橙色 | 一般 | 2~3 次 |
  | 🔴 红色 | 严重 | 4 次及以上 |
  | ⬜ 灰色 | — | 今天 / 未来 / 无任务 |

- 缺卡计算以凌晨 4:00 为日期分界线

## 🛠️ 技术栈

| 类别 | 技术 |
|:---:|:---|
| 核心 | HTML + CSS + JavaScript（无框架、无构建工具） |
| 样式 | Tailwind CSS (CDN) + 自定义 CSS |
| 图表 | ECharts 5 |
| 字体 | ZCOOL KuaiLe + Noto Sans SC (Google Fonts) |
| PWA | manifest.json 支持添加到主屏幕 |
| 存储 | localStorage 本地持久化 |

##  快速开始

### 本地运行

项目为纯静态页面，直接用浏览器打开 `index.html` 即可，或使用静态文件服务器：

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .
```

### 部署到 GitHub Pages

1. 将代码推送到 GitHub 仓库
2. 进入仓库 **Settings → Pages → Source** 选择 `main` 分支
3. 访问 `https://<username>.github.io/<repo-name>/`

### 📱 添加到手机主屏幕

- **iOS**：Safari 打开 → 点击分享按钮 → "添加到主屏幕"
- **Android**：Chrome 打开 → 菜单 → "添加到主屏幕"

## ⏰ 日期规则

应用以 **凌晨 4:00** 作为日期分界线：

- 凌晨 4:00 之前的操作算作**前一天**
- 凌晨 4:00 之后的操作算作**当天**
- 每周从**周一**开始计算

## 📁 项目结构

```
u-can-do-it/
├── index.html        # 页面入口
├── app.js            # 核心业务逻辑
├── style.css         # 自定义样式
├── manifest.json     # PWA 配置
├── icon-v2.png       # 应用图标
└── README.md         # 项目说明
```

## 📝 License

MIT
