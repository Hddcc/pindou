# MARD291 色库来源与许可

项目使用 291 个真实 MARD 色号与 HEX 预览色值，源数据为开源社区整理，未取得品牌官方色度校准认证。不同屏幕、材质和批次可能存在色差。

直接来源：[Archmays/mard-bead-generator](https://github.com/Archmays/mard-bead-generator)，提交 `309d47825c5d0a144b17a6fbcb9da9ed86412d42` 的 `src/data/mard-291.json`，MIT License，Copyright (c) 2026 Archmays。

该数据注明原始来源：[maxcleme/beadcolors](https://github.com/maxcleme/beadcolors)，提交 `29229889daab404fb30531d4bb785fd73f7f58e3` 的 `raw/mard.csv`，MIT License，Copyright (c) 2020 maxcleme。

本项目仅转换字段并按色号排序，分别保存到 `web/src/data/mard291.json`、`server/data/mard291.json`。代码示例中的 M001 等演示编号未用于实际色库。

两项来源的 MIT 许可条款如下，以上版权声明分别适用：

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Culori 4.0.2 用于 CIEDE2000 相近色计算，MIT License，Copyright (c) 2018 Dan Burzo；适用上方 MIT 条款。源码及许可：[Evercoder/culori](https://github.com/Evercoder/culori)，本地许可保留在 `web/node_modules/culori/LICENSE`。

React、Vite、Lucide、Workbox、Vitest、SQLite 驱动及其他依赖的许可保留在各自的软件包中，版本通过 `web/package-lock.json`、`server/go.sum` 锁定。
