# Map 谱面结构与实现依据

本说明基于仓库中的真实文件以及用户对音符对应关系的最终确认。视频逐字稿用于补充编辑流程，不作为事件枚举表或坐标公式的来源。

## 目录

```text
Map/<song>/
  Info.yaml
  <audio>.ogg
  cover.png
  Ring/
    EasyRing.yaml
    EasyRingEvent.yaml
    NormalRing.yaml
    NormalRingEvent.yaml
    ...
  RingDance/
    NormalRingDance.yaml
    NormalRingDanceEvent.yaml
    ...
```

初始数据共有 137 份 Info.yaml、603 份音符谱面、603 份事件文件。另有部分没有 Info.yaml 的资源目录，这些目录不会自动当作完整歌曲加载。

## 歌曲元数据

常见字段：`version`、`songName`、`songSubName`、`songAuthorName`、`levelAuthorName`、`beatsPerMinute`、`songTimeOffset`、`songDuration`、`songFilename`、`coverImageFilename`、`previewStartTime`、`previewDuration`、`environmentName`、`customData`。

两种元数据形式都存在：

| 新命名 | 旧命名 |
| --- | --- |
| `difficultyCiphermapSets` | `difficultyBeatmapSets` |
| `ciphermapCharacteristicName` | `beatmapCharacteristicName` |
| `difficultyCiphermaps` | `difficultyBeatmaps` |
| `ciphermapFilename` | `beatmapFilename` |

每个难度条目还可能包含 `eventmapFilename`、`difficultyRank`、手脚音符各自的 `noteJumpMovementSpeed` / `ringNoteJumpMovementSpeed` 和起始拍偏移，以及统计字段。

部分 Info 仍引用 `Standard/` 下的旧路径，实际只有 `Ring/` 文件。曲库根据真实文件扫描难度，不直接信任失效引用；保存当前谱面时，在元数据中补充其实际路径。其他历史元数据保留。

## 手部音符：notes

```yaml
notes:
  - time: 7.5
    lineIndex: 0
    lineLayer: 2
    type: 0
    cutDirection: 2
    groupNoteType: 1
    groupId: "51685936810987"
```

- `time`：拍，允许很细的小数，编辑时不会自动量化所有旧音符。
- `lineIndex`：0–3；`lineLayer`：0–2。但只有外圈 **10 个有效位置**；`(1,1)` 和 `(2,1)` 是未使用的内部格。全库手部音符在这两个位置的计数均为 0，编辑器禁止新增或修改到这两个位置。
- `type`：样本有 0、1、3。根据用户视频将 0/1 表示为左手红 / 右手蓝，3 表示为地雷。
- `cutDirection`：0–8。编辑器方向约定为上、下、左、右、左上、右上、左下、右下、无方向，游戏方向枚举仍需实机核对。
- `groupId`：字符串，保留长数字形式，不转换为 JS 数字。`groupNoteType` 样本出现 1 / 2；结合组内时间顺序作为头 / 尾，其他成员通常不含该字段。
- `specialType`：样本有 1，保留并允许原值编辑，不猜测具体动作效果。

预览与时间轴共用外圈的 10 个 `(列, 层)`，从左上区域顺时针排列：

```text
(0,2) (1,2) (2,2) (3,2) (3,1)
(3,0) (2,0) (1,0) (0,0) (0,1)
```

原始 3×4 网格示意（层级从上到下为 2、1、0）：

```text
(0,2)  (1,2)  (2,2)  (3,2)
(0,1)    ×      ×    (3,1)
(0,0)  (1,0)  (2,0)  (3,0)
```

`src/layout.ts` 提供唯一的位置表，供数据校验、时间轴和 3D 预览共用。3D 中以每段 36° 的等分圆环表示，可旋转和反转编号方向；手部网格索引原样导出。具体角度与尺寸是可校准的编辑器视图参数，不改写谱面数据。

## 三维预览

`src/preview3d.ts` 使用 WebGLRenderer、PerspectiveCamera、真实网格、光照与深度缓冲。圆环是有厚度的 10 段挤出几何体，手脚音符与障碍物位于三维坐标中；音符从负 Z 方向接近 Z=0 判定面。长音符按持续拍数延伸，持续期间已通过判定面的部分会缩短；组内手部音符用三维线段连接。

预览间距用于编辑可视化，目前未模拟官方跳跃速度 / 出生偏移的完整运动公式。WebGL 射线拾取随相机实时计算；左键编辑，右键旋转，滚轮定位歌曲进度，WASD 水平移动相机，按住右键时 Shift 降低、空格升高，＋ / − 按钮调整相机距离。圆环默认 22% 不透明度；手部音符使用同形的立体弧段，不绘制方向箭头，但保留 cutDirection 字段。3D 中直接点击圆环或脚部平台可放置，新增项默认不选中；Alt＋左键拖动按同一深度平面映射到对应轨道的合法位置，不改变 time、cutDirection、duration 或分组字段。时间轴继续使用二维画布，展开时实际缩小 3D 画布，方便精确编辑拍数。

## 脚部音符：ringNotes

```yaml
ringNotes:
  - time: 6.5
    lineIndex: 11
    ringNoteType: 1
    duration: 3.5
    type: 1
```

- `lineIndex`：样本覆盖 0–35。编辑器暂在线性下方平台显示，编号原样保存。
- `ringNoteType`：0 短音符、1 长音符；长音符带 `duration`（拍）。
- `type`：0 / 1，保留原始类型，不将其擅自解释为左脚或右脚。

**字段名含 Ring 不表示它属于上方手部圆环**；此对应关系以用户最终更正为准。

## 障碍物：obstacles

```yaml
obstacles:
  - time: 20
    duration: 0.04
    type: 0
    lineIndex: 2
    width: 2
```

`lineIndex` 为 0–3，`width` 为 1–4，`type` 有 0 / 1，部分对象额外包含 `style: 0`。编辑器可修改原始字段，预览用半透明区域表示。原游戏中类型对应的全身 / 下蹲等行为未知。

发现 75 个 `duration` 为字符串数值（如 `"0.1"`），计算时转换为数字，未经用户修改的原字段类型继续保留。

## 独立事件文件

```yaml
version: 2.3.0
events:
  - time: 4
    type: 2
    value: 6
```

样本事件类型为 0–10、12、13、101，值为 0–7。轨道包含 0–13 和 101，以预留中间编号；未知新编号仍保存在数据中，可通过属性修改。不可仅凭视频将数字直接对应为主灯、菱形、星空或速度。

## 扩展与编码

保留 `customData`、`bookmarks`、`BPMChanges`、`waypoints` 等额外数据。样本中的 BPMChanges 均为空，当前时间换算只应用歌曲固定 BPM。

34 份歌曲信息不是 UTF-8，可用 GB18030 解码。读取时先严格检测 UTF-8，失败再尝试 GB18030；保存统一 UTF-8，并保留原文件的字节备份。

## 写入与数据边界

本地服务仅绑定回环地址。读取路径限制在 Map 内，拒绝路径穿越、绝对路径、NTFS 数据流与符号链接。保存前备份将覆盖的文件；通过临时文件替换，并在普通写入异常时回滚已替换文件。多文件保存不能保证突然断电或进程被强制结束时的整体原子性，可从备份恢复。

校验与往返测试保证的是 YAML 数据结构，不等于游戏已接受导出的谱包。官方灯光枚举、精确音符坐标和加载规则还需要游戏端或原始代码验证。

### 镜像与视图拉伸

- 左右镜像：手部 `lineIndex = 3 - lineIndex`，左右击打方向互换；脚部 `lineIndex = 35 - lineIndex`，障碍物 `lineIndex = 4 - lineIndex - width`。
- 上下镜像：仅手部 `lineLayer = 2 - lineLayer`，上下击打方向互换。脚部及障碍物保持原位。
- 对角镜像：按用户确认的语义执行上下、左右同时翻转；不是沿 45° 斜线反射。仍只使用 10 个合法手部位置。
- 左右／对角互换手脚音符的 `type 0 / 1`；上下保留颜色，地雷类型不变。所有模式不修改 `time`、分组、时长或扩展字段。灯光事件不变。
- 3D 纵深拉伸仅令 `z = (当前拍 - 音符拍) × 1.65 × 拉伸倍数`，长音符、障碍物、拍线与地面拍号共用该倍数；不写回 YAML，不改变 BPM 或音频进度。
