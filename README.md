# OpenRouter 模型页显示推理信息

一个油猴（Tampermonkey）脚本：在 [OpenRouter](https://openrouter.ai) 模型详情页上补两个页面本身没直接告诉你的信息——能否关闭推理、默认推理等级是哪个，不用再去翻 API。

![version](https://img.shields.io/badge/version-1.0.2-blue)

## 显示什么

1. **REASONING 卡片** — 在统计卡片行里紧跟 RELEASED 之后，和原生卡片同款。依据 `/api/v1/models` 返回的 `reasoning.mandatory`：
   - `mandatory: false` → `✓ Can disable`（请求里发 `reasoning.enabled=false` 或 `effort: "none"` 即可关闭）
   - `mandatory: true` → `✕ Cannot disable`（强制推理，发 `effort: "none"` 会被拒）
   - 整个 `reasoning` 字段缺失 → 值为 `— None`（非推理模型，或 `openrouter/auto` 等动态路由模型）
2. **默认等级标记** — Providers 区自带的 Reasoning effort 下拉是页面原生的，脚本不新建列表，只在打开这个下拉时给**默认等级那一项加粗并加 `*`**（如 `Medium*`）；选中默认等级后，折叠状态下按钮里显示的 `Medium` 同样带 `*`，不会看起来像标记消失了。依据 `reasoning.default_effort`；模型没给默认等级时不标记。等级叫法与下拉一致（`xhigh` 显示为 Extra high）。

字段含义见 OpenRouter 官方文档 [Reasoning Tokens → Discovering per-model reasoning options](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。

## 安装

1. 浏览器装好 [Tampermonkey](https://www.tampermonkey.net/)
2. 打开脚本的 raw 地址，Tampermonkey 会自动弹出安装确认：

   https://raw.githubusercontent.com/whaaoo/openrouter-reasoning-info/main/openrouter-reasoning-info.user.js

3. 打开任意模型页（如 https://openrouter.ai/openai/gpt-6.1-sol ），RELEASED 卡片后面即会出现 REASONING 卡；点开 Providers 的 Reasoning effort 下拉即可看到带 `*` 的默认等级

脚本带有 `@updateURL` / `@downloadURL`，后续本仓库更新脚本后 Tampermonkey 可自动检查更新（已装旧版的在 Tampermonkey 里点检查更新即可）。

## 实现说明

- 数据只来自 OpenRouter 官方公开接口 `GET https://openrouter.ai/api/v1/models`，**不需要 API Key**，脚本 `@grant none`，不读取、不发送任何账号数据
- REASONING 卡是克隆 RELEASED 卡的 DOM 换掉文字得到的，class 与原生卡完全一致，样式随网站走；找不到统计卡行时会退化为标题下的一行紧凑文本（含默认等级）
- 下拉标记的做法：监听页面 DOM 变化，当某个菜单容器里同时出现至少 3 个裸等级名（Low / Medium / High / Extra high / Max 等）时判定为 Reasoning effort 列表，再给默认等级项加 `*`；其他下拉（如 Standard / P50）不含这些名字，不会被误标；重复触发不会叠加多个 `*`
- OpenRouter 是 SPA：脚本监听地址变化以处理站内跳转；兼容模型子页（如 `/<provider>/<model>/api`）与 `:free`、`:batch` 等 id 后缀；页面重渲染把卡片冲掉时会自动补插
- 查目录时先精确匹配完整 id（`:free`、`:batch` 等真实变体用自己的条目）；查不到时剥掉模型名后的 `:` 后缀再查本体，使 `:floor`、`:nitro` 这类只有路由含义、目录里没有条目的后缀也能正常工作
- 候选 id 在模型目录中不存在的页面（如设置页）不会显示卡片

## 示例（2026-10-12 的接口数据）

| 模型 | REASONING 卡 | Providers 下拉里带 `*` 的项 |
| --- | --- | --- |
| `openai/gpt-6.1-sol` | ✕ Cannot disable | Medium\* |
| `deepseek/deepseek-v4-flash` | ✓ Can disable | High\* |
| `deepseek/deepseek-r1` | ✕ Cannot disable | （无默认等级，不标记） |

## License

MIT
