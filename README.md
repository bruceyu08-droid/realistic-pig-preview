# 真实小猪试玩

本地 Three.js 工作室预览：Grab3D 的写实家猪模型，点按肚皮或腮帮时只有很轻的软肉晃动。

## 如何打开

不要直接用浏览器双击 `index.html`（ES 模块和 `.glb` 在 `file://` 下通常无法加载）。在本目录启动一个本地服务器：

```bash
cd /workspace/realistic-pig-prototype
./serve.sh
```

然后打开 http://127.0.0.1:8080/

或：

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

## 操作

- 在空白处拖动：环绕观看
- 滚轮或双指开合：缩放
- 点按或轻拖小猪的肚皮、腮帮：一点皮下脂肪般的轻微晃动（不是果冻弹跳）

## 模型

Grab3D “Pig”，CC0 1.0。详见 `LICENSE.md` 与 `models/LICENSE.txt`。
