import './style.css';
import JSZip from 'jszip';
import { createIcons, AudioLines, Bell, ClipboardPaste, Copy, Download, Eraser, FlipHorizontal2, FolderInput, Image, Keyboard, LocateFixed, MousePointer2, Music2, Orbit, Pause, Pencil, Play, Plus, Redo2, Repeat2, Save, ScanLine, Search, Settings2, SkipBack, SlidersHorizontal, Sparkles, Trash2, Undo2, Volume2, X } from 'lucide';
const icons = { AudioLines, Bell, ClipboardPaste, Copy, Download, Eraser, FlipHorizontal2, FolderInput, Image, Keyboard, LocateFixed, MousePointer2, Music2, Orbit, Pause, Pencil, Play, Plus, Redo2, Repeat2, Save, ScanLine, Search, Settings2, SkipBack, SlidersHorizontal, Sparkles, Trash2, Undo2, Volume2, X };
import { History, beatToSeconds, secondsToBeat, snap, newItem, newProject, items, ensureItems, kinds, labels, decodeText, readYaml, writeYaml, sortedProject, validateChart, updateMetadata, type Project, type Song, type Kind, type Item } from './model';
import { drawTimeline, timelineHeight, timelineHit, timelineLane, timelineMargin, bands, eventTypes, type Selection, type ViewState } from './render';
import { handPositions, isHandPosition } from './layout';
import { SpatialPreview } from './preview3d';
import { mirroredItem, type MirrorMode } from './transforms';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const escape = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let project = newProject(), songs: Song[] = [], activeSong: Song | undefined;
let selected: Selection[] = [], clipboard: { kind: Kind; item: Item }[] = [];
let dirty = false, beat = 0, start = 0, scale = 48, division = 4, active: Kind = 'notes', tool = 'select', noteType = 0;
let ringRotation = 0, ringReverse = false, playing = false, waveform: number[] = [], waveToken = 0, audioUrl = '';
let virtualStart = 0, virtualBeat = 0, lastClickBeat = -1, loop = false, loopStart = 0, loopEnd = 16, metronome = false;
let saving = false, loadingProject = 0, shiftHeld = false;
let localAssets = new Map<string, Blob>(), history = new History(), savedSignature = '', draftTimer: ReturnType<typeof setTimeout>;
const audio = new Audio(); audio.preload = 'auto';
const app = $('app');
app.innerHTML = `
<div class="workspace"><aside class="library"><div class="brand"><span class="brand-mark">◎</span><div>RingMapper<small>闪韵灵境 · 谱面工作台</small></div></div><div class="section-label">WORKSPACE <span>本地曲库</span></div><div class="library-actions"><button id="new-project">${icon('plus')}新建</button><button id="import">${icon('folder-input')}导入</button></div><div class="search-wrap">${icon('search')}<input id="search" placeholder="搜索歌曲 / 艺术家" aria-label="搜索歌曲"></div><div class="library-caption"><span>全部歌曲</span><span id="song-count">加载中</span></div><div id="song-list" class="song-list"></div><section class="difficulty-bar" aria-label="当前歌曲难度"><div class="difficulty-heading"><span>当前歌曲 · 难度</span><div class="mode-badge" id="mode-name">Ring</div></div><div id="difficulties"></div><button id="add-difficulty" class="text-button">${icon('plus')}添加难度</button><span id="source-path">Ring/NormalRing.yaml</span></section><div class="library-bottom"><span class="status-dot"></span>本地工作区<span>Map /</span></div></aside>
<main id="scene-workspace"><section class="preview-panel" aria-label="3D 工作区">
<div class="preview-viewport"><canvas id="preview" tabindex="0" aria-label="3D 圆环手部与下方脚部音符预览"></canvas></div><div class="preview-footer"><span><i class="legend-dot pink"></i>左手 / 类型 0</span><span><i class="legend-dot blue"></i>右手 / 类型 1</span><span>右键旋转 · 滚轮调节进度 · WASD 移动 · 按住右键：Shift 降低 / 空格升高</span></div>
<div class="scene-top"><div class="scene-song"><section class="songbar"><div class="song-cover" id="current-cover">◎</div><div class="song-info"><h1 id="song-name">未命名歌曲</h1><p id="artist-name">开始创作你的节奏</p></div><div class="song-meta"><span>BPM<strong id="bpm-display">120</strong></span><span>音符<strong id="note-count">0</strong></span></div><button id="settings" title="歌曲设置">${icon('settings-2')}</button></section>
<div class="scene-status"><div class="project-title"><span class="status-dot"></span><span id="project-title">新建谱面</span><span class="badge" id="save-state">未保存</span></div></div></div><div class="header-actions"><button id="help">${icon('keyboard')}<span>快捷键</span></button><button id="export">${icon('download')}<span>导出 ZIP</span></button><button id="save" class="primary">${icon('save')}<span>保存谱面</span></button></div></div>
<div class="scene-camera"><span>${icon('orbit')}3D 空间预览</span><div><select id="camera-preset" aria-label="相机视角"><option value="perspective">透视</option><option value="front">正面</option><option value="top">俯视</option></select><button id="camera-reset" title="重置相机">${icon('locate-fixed')}</button><button id="camera-near" title="拉近相机" aria-label="拉近相机">＋</button><button id="camera-far" title="拉远相机" aria-label="拉远相机">−</button><button id="view-settings" title="视图设置">${icon('sliders-horizontal')}</button><button id="toggle-color" class="placement-color" data-placement-color="0" title="切换放置颜色（Q）" aria-label="切换放置颜色"><i class="legend-dot pink"></i>红 Q</button></div><label class="scene-depth">纵深拉伸<input id="depth-zoom" aria-label="3D 纵深拉伸" type="range" min="0.25" max="3" step="0.05" value="1"><output id="depth-zoom-value">1.00×</output></label></div>
<section class="inspector-panel" id="tools-panel" aria-label="编辑工具子窗口"><div class="panel-heading" id="tools-handle" title="拖动移动工具窗口，双击复位"><span>${icon('mouse-pointer-2')}编辑工具</span><div><span class="subtle" id="selection-count">未选中</span><button id="toggle-tools" aria-label="收起编辑工具" aria-controls="tools-body" aria-expanded="true">−</button></div></div><div id="tools-body"><div class="tool-tabs"><button data-tool="select" class="active" title="选择 (V)">${icon('mouse-pointer-2')}选择</button><button data-tool="draw" title="放置 (B)">${icon('pencil')}放置</button><button data-tool="erase" title="擦除 (E)">${icon('eraser')}擦除</button></div><div class="kind-tabs"><button data-kind="notes" class="active">手部 · 圆环</button><button data-kind="ringNotes">脚部</button><button data-kind="obstacles">障碍物</button><button data-kind="events">灯光事件</button></div><div id="inspector"></div><div class="mirror-controls"><label>镜像<select id="mirror-mode" aria-label="镜像方式" title="上下仅翻转手部层级；左右与对角同时互换红蓝"><option value="left-right">左右</option><option value="up-down">上下（水平轴）</option><option value="diagonal">对角（上下＋左右）</option></select></label></div><div class="edit-actions"><button id="undo" title="撤销 Ctrl+Z">${icon('undo-2')}</button><button id="redo" title="重做 Ctrl+Y">${icon('redo-2')}</button><button id="copy" title="复制 Ctrl+C">${icon('copy')}</button><button id="paste" title="粘贴 Ctrl+V">${icon('clipboard-paste')}</button><button id="mirror" title="按所选方式镜像选中音符">${icon('flip-horizontal-2')}</button><button id="delete" title="删除 Delete">${icon('trash-2')}</button></div><div class="inspector-bottom"><button id="range-select">范围选取</button><button id="group">打组</button><button id="ungroup">取消组</button><button id="check">${icon('scan-line')}检查谱面</button></div></div></section>
<section class="timeline-panel is-collapsed" id="timeline-panel" aria-label="时间轴子窗口" inert><div class="timeline-toolbar"><div class="timeline-title">${icon('audio-lines')}时间轴 <span class="badge">BEATS</span></div><div class="timeline-options"><button id="hide-timeline" title="向下收起时间轴">向下收起 ↓</button><label>吸附<select id="division"><option value="1">1 拍</option><option value="2">1/2 拍</option><option value="4" selected>1/4 拍</option><option value="8">1/8 拍</option><option value="16">1/16 拍</option><option value="32">1/32 拍</option></select></label><label>缩放<input id="zoom" type="range" min="12" max="160" value="48"></label><button id="follow" title="定位到播放头">${icon('locate-fixed')}</button></div></div><div class="timeline-wrap"><canvas id="timeline" aria-label="谱面时间轴"></canvas></div><input id="scroll" class="timeline-scroll" type="range" min="0" max="256" step="0.25" value="0" aria-label="滚动时间轴"><div class="timeline-hint"><span>左键选择 / 放置 · 拖动移动 · Shift 多选 · 右键删除 · Alt 拖动手部方向 · 中键换色</span><span id="visible-range">0 — 16 拍</span></div></section>

<footer class="transport"><button id="toggle-timeline" aria-controls="timeline-panel" aria-expanded="false" title="展开时间轴">${icon('audio-lines')}<span>时间轴 ↑</span></button><div class="transport-buttons"><button id="home" title="回到开始">${icon('skip-back')}</button><button id="play" class="play-button" title="播放 / 暂停 Space">${icon('play')}</button><button id="loop" title="循环播放">${icon('repeat-2')}</button><button id="metronome" title="节拍器">${icon('bell')}</button></div><div class="transport-time"><strong id="time-display">00:00.000</strong><span>BEAT <input id="beat-input" type="number" min="0" step="0.25" value="0" aria-label="当前节拍"></span></div><input id="seek" type="range" min="0" max="256" step="0.01" value="0" aria-label="播放进度"><label class="speed-label"><select id="speed" aria-label="播放速度"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1.0×</option><option value="1.5">1.5×</option></select></label><label class="volume-label">${icon('volume-2')}<input id="volume" type="range" min="0" max="1" step="0.05" value="0.7" aria-label="音量"></label></footer>
<div id="toast" role="status"></div><dialog id="modal"><div id="modal-content"></div></dialog><input id="import-input" type="file" accept=".zip,.yaml,.yml" multiple hidden><input id="audio-input" type="file" accept="audio/ogg,audio/mpeg,audio/wav" hidden><input id="cover-input" type="file" accept="image/png,image/jpeg,image/webp" hidden></section></main></div>`;
function iconsRefresh() { createIcons({ icons }); }
function notify(message: string) { $('toast').textContent = message; $('toast').classList.add('show'); setTimeout(() => $('toast').classList.remove('show'), 4500); }
async function api<T>(url: string, options?: RequestInit): Promise<T> { const r = await fetch(url, options); const data = await r.json(); if (!r.ok) throw new Error(data.error || r.statusText); return data; }
function asset(song: string, file: string) { return `/api/asset?song=${encodeURIComponent(song)}&file=${encodeURIComponent(file)}`; }
function view(): ViewState { return { project, beat, start, scale, division, selected: selected[0], selections: selected, active, tool, ringRotation, ringReverse }; }
const preview = $<HTMLCanvasElement>('preview'), timeline = $<HTMLCanvasElement>('timeline');
let spatialPreview: SpatialPreview | undefined;
try { spatialPreview = new SpatialPreview(preview); }
catch (e) { preview.dataset.renderer = 'unavailable'; const message = document.createElement('div'); message.className = 'preview-error'; message.textContent = '3D 预览无法初始化，请启用浏览器硬件加速或使用支持 WebGL 2 的浏览器。时间轴仍可编辑。'; preview.parentElement!.append(message); console.warn('3D preview unavailable:', e); }
import.meta.hot?.dispose(() => spatialPreview?.dispose());
function draw() { spatialPreview?.update(view()); drawTimeline(timeline, view(), waveform); if (selectionBox) { const c = timeline.getContext('2d')!; c.fillStyle = '#a9f2d920'; c.strokeStyle = '#a9f2d9'; const b = selectionBox; c.fillRect(b.x, b.y, b.endX - b.x, b.endY - b.y); c.strokeRect(b.x, b.y, b.endX - b.x, b.endY - b.y); } }
function totalBeats() { return Math.max(16, secondsToBeat(Number(project.info.songDuration) || 120, project.info.beatsPerMinute, project.info.songTimeOffset || 0), ...kinds.map(k => items(project, k).reduce((max, n) => Math.max(max, n.time + Number(n.duration || 0) + 4), 0))); }
function changed() {
  dirty = JSON.stringify(project) !== savedSignature;
  $('save-state').textContent = dirty ? '有未保存修改' : '已保存'; $('save-state').classList.toggle('unsaved', dirty);
  clearTimeout(draftTimer); draftTimer = setTimeout(() => { try { localStorage.setItem('ringmapper-draft', JSON.stringify({ project, date: Date.now() })); } catch { notify('浏览器草稿空间不足，请保存到本地'); } }, 600);
  renderSummary(); draw();
}
function mutate(fn: () => void) { history.push(project); fn(); changed(); renderInspector(); }
function renderSummary() {
  $('song-name').textContent = project.info.songName; $('project-title').textContent = project.info.songName;
  $('artist-name').textContent = `${project.info.songAuthorName || '未知艺术家'}  /  ${project.info.levelAuthorName || '未填写谱师'}`;
  $('bpm-display').textContent = String(project.info.beatsPerMinute); $('note-count').textContent = String(items(project, 'notes').length + items(project, 'ringNotes').length);
  $('source-path').textContent = project.chartPath; $('mode-name').textContent = project.chartPath.split('/')[0];
  $<HTMLInputElement>('seek').max = String(totalBeats()); $<HTMLInputElement>('scroll').max = String(totalBeats());
  $('difficulties').innerHTML = chartEntries().map(c => `<button class="difficulty ${c.path === project.chartPath ? 'active' : ''}" data-chart="${escape(c.path)}">${escape(c.difficulty)}${c.mode !== project.chartPath.split('/')[0] ? `<small>${escape(c.mode)}</small>` : ''}</button>`).join('');
}
function renderLibrary() {
  const query = $<HTMLInputElement>('search').value.toLocaleLowerCase();
  const visible = songs.filter(s => `${s.name} ${s.artist} ${s.id}`.toLowerCase().includes(query));
  $('song-count').textContent = `${visible.length} 首`;
  $('song-list').innerHTML = visible.map(s => `<button class="song-card ${s.id === activeSong?.id ? 'active' : ''}" data-song="${escape(s.id)}"><div class="thumb">${s.cover ? `<img loading="lazy" src="${asset(s.id, s.cover)}" alt="">` : '◎'}</div><div class="song-card-info"><strong>${escape(s.name)}</strong><span>${escape(s.artist)}</span><small>${s.bpm} BPM <i>·</i> ${s.charts.length} 张谱面</small></div>${s.id === activeSong?.id ? '<span class="song-active-dot"></span>' : ''}</button>`).join('') || '<div class="empty-library">没有找到歌曲</div>';
}
const fields: Record<Kind, string[]> = { notes: ['time', 'lineIndex', 'lineLayer', 'type', 'cutDirection', 'groupId', 'groupNoteType', 'specialType'], ringNotes: ['time', 'lineIndex', 'type', 'ringNoteType', 'duration'], obstacles: ['time', 'lineIndex', 'type', 'width', 'duration', 'style'], events: ['time', 'type', 'value'] };
const fieldNames: Record<string, string> = { time: '节拍', lineIndex: '位置编号', lineLayer: '层级', type: '类型 / 颜色', cutDirection: '击打方向', ringNoteType: '脚部音符类型', duration: '持续拍数', width: '宽度', value: '事件值', groupId: '分组 ID', groupNoteType: '分组标记', specialType: '特殊类型', style: '样式' };
function renderInspector() {
  $('selection-count').textContent = selected.length ? `已选 ${selected.length} 项` : '未选中';
  $('toggle-color').dataset.placementColor = String(noteType);
  $('toggle-color').innerHTML = `<i class="legend-dot ${noteType === 0 ? 'pink' : 'blue'}"></i>${noteType === 0 ? '红' : '蓝'} Q`;
  $('toggle-color').setAttribute('aria-label', `当前放置${noteType === 0 ? '红色' : '蓝色'}，Q 切换红蓝`);
  document.querySelectorAll('[data-kind]').forEach(e => e.classList.toggle('active', (e as HTMLElement).dataset.kind === active));
  document.querySelectorAll('[data-tool]').forEach(e => e.classList.toggle('active', (e as HTMLElement).dataset.tool === tool));
  const first = selected[0], n = first ? items(project, first.kind)[first.index] : undefined;
  if (n && first) {
    $('inspector').innerHTML = `<div class="inspector-caption">${labels[first.kind]}属性 <span>${selected.length > 1 ? '修改将应用到同类选中项' : '原始字段无损保留'}</span></div><div class="field-grid">${fields[first.kind].map(key => `<label>${fieldNames[key]}<input data-field="${key}" aria-label="${fieldNames[key]}" ${key === 'groupId' ? 'type="text"' : 'type="number" step="any"'} value="${escape(n[key] ?? '')}" placeholder="未设置"></label>`).join('')}</div><p class="field-help">${first.kind === 'notes' ? '圆环外圈 10 个位置；中间层仅 0、3 列可用。type 0 红 / 1 蓝 / 3 地雷；方向 0–7，8 无方向。分组 1 头、2 尾。' : first.kind === 'ringNotes' ? '位置 0–35；ringNoteType 0 短音符 / 1 长音符，时长单位为拍。' : first.kind === 'events' ? '按原文件的 type / value 编辑。具体灯光语义尚待游戏验证。' : '障碍物位置 0–3，宽度 1–4。'}</p>`;
  } else {
    $('inspector').innerHTML = `<div class="inspector-caption">放置 ${labels[active]}<span>当前节拍 ${beat.toFixed(2)}</span></div><div class="color-picker"><button data-color="0" class="${noteType === 0 ? 'active' : ''}"><i class="legend-dot pink"></i>${active === 'notes' ? '左手 · 红' : '类型 0'}</button><button data-color="1" class="${noteType === 1 ? 'active' : ''}"><i class="legend-dot blue"></i>${active === 'notes' ? '右手 · 蓝' : '类型 1'}</button></div><div class="empty-selection"><span class="empty-icon">${icon(active === 'events' ? 'sparkles' : 'mouse-pointer-2')}</span><strong>让节奏从这里开始</strong><p>直接点击圆环或脚部区域即可放置。<br>点击已有音符选中，Alt + 左键拖动换位。</p></div><div class="quick-add"><button id="add-at-beat">${icon('plus')}在当前拍添加</button><button id="hold-add">${active === 'ringNotes' ? '添加长音符' : '添加书签'}</button></div>`;
  }
  iconsRefresh();
}
function select(refs: Selection[]) { selected = refs; if (refs[0]) active = refs[0].kind; renderInspector(); draw(); }
function currentSeconds() { return beatToSeconds(beat, Number(project.info.beatsPerMinute), Number(project.info.songTimeOffset) || 0); }
function setBeat(value: number) {
  beat = Math.max(0, Math.min(totalBeats(), value));
  if (audioUrl) audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : Infinity, currentSeconds()));
  virtualStart = performance.now(); virtualBeat = beat; updateTransport(); draw();
}
function updateTransport() {
  const sec = Math.max(0, currentSeconds()); $('time-display').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(3).padStart(6, '0')}`;
  if (document.activeElement !== $('beat-input')) $<HTMLInputElement>('beat-input').value = beat.toFixed(3);
  $<HTMLInputElement>('seek').value = String(beat);
  $('visible-range').textContent = `${start.toFixed(1)} — ${(start + (timeline.clientWidth - timelineMargin) / scale).toFixed(1)} 拍`;
}
function stop() { audio.pause(); playing = false; $('play').innerHTML = icon('play'); iconsRefresh(); }
async function togglePlay() {
  if (playing) { stop(); return; }
  if (beat >= totalBeats()) setBeat(0);
  if (audioUrl) { try { await audio.play(); } catch { notify('音频无法播放，请检查文件格式或重新选择音频'); return; } }
  virtualStart = performance.now(); virtualBeat = beat; playing = true; $('play').innerHTML = icon('pause'); iconsRefresh();
}
let audioContext: AudioContext | undefined;
function clickBeat() {
  audioContext ??= new AudioContext(); void audioContext.resume(); const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.frequency.value = Math.floor(beat) % 4 === 0 ? 1200 : 800; gain.gain.setValueAtTime(.06, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .04); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + .05);
}
function frame(now: number) {
  spatialPreview?.tick(now);
  if (playing) {
    beat = audioUrl ? Math.max(0, secondsToBeat(audio.currentTime, project.info.beatsPerMinute, project.info.songTimeOffset || 0)) : virtualBeat + (now - virtualStart) / 1000 * project.info.beatsPerMinute / 60 * Number($<HTMLSelectElement>('speed').value);
    if (loop && beat >= loopEnd) setBeat(loopStart);
    if (metronome && Math.floor(beat) !== lastClickBeat) { lastClickBeat = Math.floor(beat); clickBeat(); }
    if (beat >= totalBeats() || audio.ended && !!audioUrl) stop();
    const windowSize = (timeline.clientWidth - timelineMargin) / scale;
    if (beat > start + windowSize * .85 || beat < start) { start = Math.max(0, beat - windowSize * .15); $<HTMLInputElement>('scroll').value = String(start); }
    updateTransport(); draw();
  }
  requestAnimationFrame(frame);
}
async function loadAudio(url: string) {
  const token = ++waveToken; stop(); waveform = [];
  if (audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
  audioUrl = url; audio.src = url; audio.volume = Number($<HTMLInputElement>('volume').value); audio.playbackRate = Number($<HTMLSelectElement>('speed').value);
  if (!url) { audio.removeAttribute('src'); audio.load(); draw(); return; }
  try {
    const response = await fetch(url); if (!response.ok) throw new Error('无法读取音频');
    const bytes = await response.arrayBuffer(); audioContext ??= new AudioContext(); const decoded = await audioContext.decodeAudioData(bytes);
    if (token !== waveToken) return;
    const data = decoded.getChannelData(0), count = 4000, stride = Math.max(1, Math.floor(data.length / count));
    waveform = Array.from({ length: count }, (_, i) => { let max = 0; for (let j = i * stride; j < Math.min(data.length, (i + 1) * stride); j += 16) max = Math.max(max, Math.abs(data[j])); return max; }); draw();
  } catch { if (token === waveToken) notify('无法生成音频波形，仍可继续编辑谱面'); }
}
function modal(title: string, html: string) { $('modal-content').innerHTML = `<div class="modal-heading"><h2>${title}</h2><button id="close-modal">${icon('x')}</button></div>${html}`; $<HTMLDialogElement>('modal').showModal(); iconsRefresh(); }
function confirmDiscard(action: () => void) {
  if (!dirty) { action(); return; }
  modal('离开当前谱面？', '<p>当前修改尚未保存。请先保存，或选择放弃修改后继续。</p><div class="modal-actions"><button id="discard" class="danger">放弃修改并继续</button><button id="cancel-modal">继续编辑</button></div>');
  $('discard').onclick = () => { $<HTMLDialogElement>('modal').close(); action(); };
}
async function openSong(song: Song, chartPath?: string) {
  const loadId = ++loadingProject;
  try {
    const entry = chartPath ? song.charts.find(c => c.path === chartPath) : song.charts.find(c => c.difficulty === 'Normal') ?? song.charts[0];
    if (!entry) { notify('此歌曲没有谱面文件，可新建谱面并导入该歌曲音频'); return; }
    const p = await api<Project>(`/api/project?song=${encodeURIComponent(song.id)}&chart=${encodeURIComponent(entry.path)}`);
    if (loadId !== loadingProject) return;
    activeSong = song; localAssets.clear(); project = p; history.clear(); selected = []; beat = 0; start = 0; dirty = false; savedSignature = JSON.stringify(project);
    $('current-cover').innerHTML = song.cover ? `<img src="${asset(song.id, song.cover)}" alt="歌曲封面">` : '◎';
    $('save-state').textContent = '已保存'; $('save-state').classList.remove('unsaved'); renderSummary(); renderLibrary(); renderInspector(); updateTransport(); draw();
    void loadAudio(song.audio ? asset(song.id, song.audio) : '');
    if (song.warnings.length) notify(`已按实际文件加载；发现 ${song.warnings.length} 个旧元数据路径引用`);
  } catch (e: any) { notify(e.message); }
}
function add(kind: Kind, lineIndex = 0, layer = 0, time = snap(beat, division), hold = false) {
  if (shiftHeld) return;
  if (kind === 'notes' && !isHandPosition(lineIndex, layer)) { notify('圆环只使用外圈 10 个位置，(1,1) 和 (2,1) 不可放置'); return; }
  mutate(() => { const n = newItem(kind, time, lineIndex, noteType); if (kind === 'notes') n.lineLayer = layer; if (kind === 'ringNotes' && hold) { n.ringNoteType = 1; n.duration = 1; } const list = ensureItems(project, kind); list.push(n); selected = []; active = kind; });
}
function removeSelected() { if (!selected.length) return; mutate(() => { for (const k of kinds) { const indices = new Set(selected.filter(s => s.kind === k).map(s => s.index)); const list = ensureItems(project, k); for (let i = list.length - 1; i >= 0; i--) if (indices.has(i)) list.splice(i, 1); } selected = []; }); }
function copy() { clipboard = selected.map(s => ({ kind: s.kind, item: structuredClone(items(project, s.kind)[s.index]) })); notify(`已复制 ${clipboard.length} 项`); }
function paste() {
  if (!clipboard.length) return; const min = Math.min(...clipboard.map(c => c.item.time)), groups = new Map<string, string>();
  mutate(() => { selected = clipboard.map(c => { const n = structuredClone(c.item); n.time = Math.max(0, n.time - min + snap(beat, division)); if (n.groupId) { if (!groups.has(n.groupId)) groups.set(n.groupId, crypto.randomUUID()); n.groupId = groups.get(n.groupId); } const list = ensureItems(project, c.kind); list.push(n); return { kind: c.kind, index: list.length - 1 }; }); });
}
function mirror() {
  if (!selected.length) return;
  const mode = $<HTMLSelectElement>('mirror-mode').value as MirrorMode;
  mutate(() => { for (const s of selected) { const n = items(project, s.kind)[s.index]; Object.assign(n, mirroredItem(s.kind, n, mode)); } });
}
function togglePlacementColor() { noteType = 1 - noteType; renderInspector(); }
function groupNotes(ungroup = false) {
  const notes = selected.filter(s => s.kind === 'notes').map(s => items(project, 'notes')[s.index]).sort((a, b) => a.time - b.time);
  if (notes.length < (ungroup ? 1 : 2)) { notify('至少选择两个手部音符才能打组'); return; }
  if (!ungroup && (notes.some(n => n.type !== notes[0].type) || notes[0].type === 3)) { notify('请选择同色且非地雷的手部音符'); return; }
  mutate(() => { const id = crypto.randomUUID(); for (const n of notes) { delete n.groupId; delete n.groupNoteType; if (!ungroup) n.groupId = id; } if (!ungroup) { notes[0].groupNoteType = 1; notes.at(-1)!.groupNoteType = 2; } });
}
async function saveProject(songId = project.songId) {
  if (saving) return;
  if (!songId) { modal('保存到本地曲库', '<p>输入新歌曲目录名，谱面将写入项目的 Map 目录。音频、封面及其他难度会一同保存。</p><label class="full-field">目录名<input id="new-song-id" value="my-song"></label><div class="modal-actions"><button id="confirm-save" class="primary">保存</button></div>'); $('confirm-save').onclick = () => { const id = $<HTMLInputElement>('new-song-id').value.trim(); $<HTMLDialogElement>('modal').close(); void saveProject(id); }; return; }
  try {
    saving = true; $<HTMLButtonElement>('save').disabled = true;
    const original = structuredClone(project); const p = sortedProject(project); p.songId = songId;
    const assets: Record<string, string> = {};
    for (const [name, blob] of localAssets) assets[name] = await blobBase64(blob);
    const result = await api<{ revision: string; backup: string; info: any }>('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, assets }) });
    const sameContext = project.songId === original.songId && project.chartPath === original.chartPath;
    if (sameContext) {
      const unchanged = JSON.stringify(project) === JSON.stringify(original);
      project.songId = songId; project.revision = result.revision;
      if (unchanged) project.info = result.info; else updateMetadata(project);
      original.songId = songId; original.revision = result.revision; original.info = result.info; savedSignature = JSON.stringify(original);
      if (unchanged) localAssets.clear(); changed();
    }
    songs = await api<Song[]>('/api/catalog'); if (sameContext) activeSong = songs.find(s => s.id === songId); renderLibrary(); renderSummary(); notify(result.backup ? '谱面已保存，原文件已自动备份' : '谱面已保存到 Map/' + songId);
  } catch (e: any) { notify('保存失败：' + e.message); }
  finally { saving = false; $<HTMLButtonElement>('save').disabled = false; }
}
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
async function exportProject() {
  try {
    const p = sortedProject(project), errors = validateChart(p.chart, p.event); if (errors.length) throw new Error(errors[0]); updateMetadata(p);
    let zip: JSZip;
    if (project.songId) { const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); if (!r.ok) throw new Error((await r.json()).error); zip = await JSZip.loadAsync(await r.arrayBuffer()); }
    else { zip = new JSZip(); zip.file('Info.yaml', writeYaml(p.info)); zip.file(p.chartPath, writeYaml(p.chart)); zip.file(p.eventPath, writeYaml(p.event)); }
    for (const [name, blob] of localAssets) zip.file(name, blob);
    zip.file('Info.yaml', writeYaml(p.info)); zip.file(p.chartPath, writeYaml(p.chart)); zip.file(p.eventPath, writeYaml(p.event));
    download(await zip.generateAsync({ type: 'blob' }), `${p.info.songName || 'RingMapper'}.zip`); notify('ZIP 已导出，包含音频、封面及已有难度');
  } catch (e: any) { notify('导出失败：' + e.message); }
}
function settings() {
  const values = ['songName', 'songAuthorName', 'levelAuthorName', 'beatsPerMinute', 'songTimeOffset', 'songDuration'];
  const names = ['歌曲名称', '艺术家', '谱师', 'BPM', '音频偏移（秒）', '歌曲时长（秒）'];
  const sets = [...(project.info.difficultyCiphermapSets ?? []), ...(project.info.difficultyBeatmapSets ?? [])];
  const entry = sets.flatMap((s: any) => s.difficultyCiphermaps ?? s.difficultyBeatmaps ?? []).find((e: any) => (e.ciphermapFilename ?? e.beatmapFilename) === project.chartPath) ?? {};
  modal('歌曲与难度设置', `<div class="field-grid settings-grid">${values.map((key, i) => `<label>${names[i]}<input data-info="${key}" type="${i > 2 ? 'number' : 'text'}" step="any" value="${escape(project.info[key])}"></label>`).join('')}${['noteJumpMovementSpeed', 'noteJumpStartBeatOffset', 'ringNoteJumpMovementSpeed', 'ringNoteJumpStartBeatOffset'].map((key, i) => `<label>${['手部跳跃速度', '手部出生拍偏移', '脚部跳跃速度', '脚部出生拍偏移'][i]}<input data-difficulty-field="${key}" type="number" step="any" value="${escape(entry[key] ?? (i % 2 ? 2 : 10))}"></label>`).join('')}</div><p class="field-help">偏移约定：音频秒数 = 节拍 × 60 / BPM + 偏移。需试听校准。推荐 OGG 音频与 512 × 512 PNG 封面。</p><div class="modal-actions"><button id="choose-audio">${icon('music-2')}导入音频</button><button id="choose-cover">${icon('image')}导入封面</button><button id="tap-tempo">点击测 BPM</button><button id="apply-settings" class="primary">应用设置</button></div>`);
  $('choose-audio').onclick = () => $<HTMLInputElement>('audio-input').click(); $('choose-cover').onclick = () => $<HTMLInputElement>('cover-input').click();
  const taps: number[] = []; $('tap-tempo').onclick = () => { taps.push(performance.now()); if (taps.length > 8) taps.shift(); if (taps.length > 1) { const bpm = Math.round(60000 * (taps.length - 1) / (taps.at(-1)! - taps[0])); (document.querySelector('[data-info="beatsPerMinute"]') as HTMLInputElement).value = String(bpm); $('tap-tempo').textContent = `${bpm} BPM · 继续点击`; } };
  $('apply-settings').onclick = () => {
    const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-info]')];
    if (inputs.some(i => i.type === 'number' && (!i.value.trim() || !Number.isFinite(i.valueAsNumber))) || Number(inputs.find(i => i.dataset.info === 'beatsPerMinute')!.value) <= 0) { notify('请填写有效数值，BPM 必须大于 0'); return; }
    mutate(() => { for (const i of inputs) project.info[i.dataset.info!] = i.type === 'number' ? Number(i.value) : i.value; updateMetadata(project); const all = [...(project.info.difficultyCiphermapSets ?? []), ...(project.info.difficultyBeatmapSets ?? [])]; const target = all.flatMap((s: any) => s.difficultyCiphermaps ?? s.difficultyBeatmaps ?? []).find((e: any) => (e.ciphermapFilename ?? e.beatmapFilename) === project.chartPath); for (const i of document.querySelectorAll<HTMLInputElement>('[data-difficulty-field]')) target[i.dataset.difficultyField!] = Number(i.value); });
    setBeat(beat); $<HTMLDialogElement>('modal').close();
  };
}
function checkChart() {
  const errors = validateChart(project.chart, project.event), overlaps: string[] = [], groups = new Map<string, Item[]>();
  for (const kind of kinds) { const seen = new Set<string>(); for (const n of items(project, kind)) { const key = `${n.time}:${n.lineIndex ?? n.type}:${n.lineLayer ?? ''}`; if (seen.has(key)) overlaps.push(`${labels[kind]}第 ${n.time} 拍，位置 ${n.lineIndex ?? n.type}`); seen.add(key); if (kind === 'notes' && n.groupId) { const list = groups.get(n.groupId) ?? []; list.push(n); groups.set(n.groupId, list); } } }
  for (const [id, notes] of groups) { const list = [...notes].sort((a, b) => a.time - b.time); if (list.length < 2 || list[0].groupNoteType !== 1 || list.at(-1)!.groupNoteType !== 2 || list.filter(n => n.groupNoteType === 1).length !== 1 || list.filter(n => n.groupNoteType === 2).length !== 1 || new Set(list.map(n => n.type)).size !== 1) errors.push(`分组 ${id} 需要同色音符、一个组头和一个组尾`); }
  const hands = items(project, 'notes'), left = hands.filter(n => n.type === 0).length, right = hands.filter(n => n.type === 1).length;
  modal('谱面检查与统计', `<div class="stats-grid"><div><strong>${hands.length}</strong>手部音符</div><div><strong>${items(project, 'ringNotes').length}</strong>脚部音符</div><div><strong>${items(project, 'obstacles').length}</strong>障碍物</div><div><strong>${((hands.length + items(project, 'ringNotes').length) / (Number(project.info.songDuration) || 1)).toFixed(2)}</strong>平均每秒音符</div></div><p>红 / 蓝：${left} / ${right}（比值 ${right ? (left / right).toFixed(2) : '—'}） · 上 / 中 / 下层：${[2, 1, 0].map(l => hands.filter(n => n.lineLayer === l).length).join(' / ')} · ${groups.size} 个分组</p><h3>字段与分组 ${errors.length ? `· ${errors.length} 项问题` : '· 通过'}</h3><ul class="check-list">${errors.slice(0, 50).map(e => `<li>${escape(e)}</li>`).join('') || '<li>未发现字段或分组问题。</li>'}</ul><h3>重叠位置 · ${overlaps.length} 项</h3><ul class="check-list">${overlaps.slice(0, 50).map(e => `<li>${escape(e)}</li>`).join('') || '<li>未发现同拍同位置音符。</li>'}</ul><p class="field-help">检查只反映文件结构与相同位置；实际动作可玩性仍需在游戏中验证。</p>`);
}
function rangeDialog() {
  modal('范围选取', `<div class="field-grid"><label>起始拍<input id="range-start" type="number" min="0" step="any" value="${Math.floor(beat)}"></label><label>结束拍<input id="range-end" type="number" min="0" step="any" value="${Math.floor(beat) + 4}"></label></div><label class="full-field">选取内容<select id="range-kind"><option value="all">所有内容</option>${kinds.map(k => `<option value="${k}">${labels[k]}</option>`).join('')}</select></label><div class="modal-actions"><button id="range-apply" class="primary">选取范围</button><button id="range-delete" class="danger">删除范围内容</button></div>`);
  const apply = () => { const a = Number($<HTMLInputElement>('range-start').value), b = Number($<HTMLInputElement>('range-end').value), k = $<HTMLSelectElement>('range-kind').value; if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a) { notify('范围必须满足 0 ≤ 起始拍 ≤ 结束拍'); return false; } selected = kinds.filter(kind => k === 'all' || kind === k).flatMap(kind => items(project, kind).map((n, index) => ({ n, index })).filter(({ n }) => n.time >= a && n.time <= b).map(({ index }) => ({ kind, index }))); return true; };
  $('range-apply').onclick = () => { if (!apply()) return; $<HTMLDialogElement>('modal').close(); select(selected); };
  $('range-delete').onclick = () => { if (!apply()) return; $<HTMLDialogElement>('modal').close(); removeSelected(); };
}
function addDifficulty() {
  modal('添加难度', `<div class="field-grid"><label>模式<select id="new-mode"><option>Ring</option><option>RingDance</option></select></label><label>难度<select id="new-difficulty"><option>Easy</option><option>Normal</option><option selected>Hard</option><option>Expert</option><option>ExpertPlus</option></select></label></div><label class="checkbox"><input id="clone-chart" type="checkbox">复制当前音符与障碍物</label><label class="checkbox"><input id="clone-events" type="checkbox" checked>复制当前灯光事件</label><div class="modal-actions"><button id="difficulty-create" class="primary">创建难度</button></div>`);
  $('difficulty-create').onclick = async () => {
    const mode = $<HTMLSelectElement>('new-mode').value, difficulty = $<HTMLSelectElement>('new-difficulty').value, nextPath = `${mode}/${difficulty}${mode}.yaml`;
    if (nextPath === project.chartPath || activeSong?.charts.some(c => c.path === nextPath) || localAssets.has(nextPath)) { notify('此难度已存在'); return; }
    updateMetadata(project);
    const clone = $<HTMLInputElement>('clone-chart').checked, cloneEvents = $<HTMLInputElement>('clone-events').checked;
    localAssets.set(project.chartPath, new Blob([writeYaml(project.chart)])); localAssets.set(project.eventPath, new Blob([writeYaml(project.event)]));
    mutate(() => {
      project.chartPath = nextPath; project.eventPath = nextPath.replace('.yaml', 'Event.yaml');
      if (!clone) project.chart = { version: '2.3.0', notes: [], ringNotes: [], obstacles: [], customData: { bookmarks: [] } };
      if (!cloneEvents) project.event = { version: '2.3.0', events: [] }; selected = []; updateMetadata(project);
    });
    // New targets require a fresh revision including missing files, obtained without changing source files.
    if (project.songId) { try { project.revision = (await api<{ revision: string }>(`/api/revision?song=${encodeURIComponent(project.songId)}&chart=${encodeURIComponent(project.chartPath)}&event=${encodeURIComponent(project.eventPath)}`)).revision; } catch (e: any) { notify(e.message); } }
    $<HTMLDialogElement>('modal').close(); renderSummary(); notify('已创建新难度，保存后写入歌曲目录');
  };
}
async function importFiles(files: File[]) {
  try {
    let p = newProject(); const assets = new Map<string, Blob>();
    if (files[0]?.name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(files[0]); const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
      if (names.length > 3000) throw new Error('ZIP 文件数量过多');
      const infoName = names.find(n => /(^|\/)Info\.yaml$/i.test(n)); if (!infoName) throw new Error('ZIP 中缺少 Info.yaml');
      const prefix = infoName.slice(0, -'Info.yaml'.length); let bytes = 0;
      for (const name of names.filter(n => n.startsWith(prefix))) { const relative = name.slice(prefix.length); if (!relative || relative.includes('..') || relative.startsWith('/') || relative.includes(':')) continue; const blob = await zip.files[name].async('blob'); bytes += blob.size; if (bytes > 200_000_000) throw new Error('解压内容超过 200MB'); assets.set(relative, blob); }
      p.info = readYaml(await blobText(assets.get('Info.yaml')!));
      const charts = [...assets.keys()].filter(n => /\.yaml$/i.test(n) && n !== 'Info.yaml' && !/Event\.yaml$/i.test(n));
      if (!charts.length) throw new Error('ZIP 中没有谱面文件');
      p.chartPath = charts.find(n => /Normal/.test(n)) ?? charts[0]; p.eventPath = p.chartPath.replace('.yaml', 'Event.yaml');
      p.chart = readYaml(await blobText(assets.get(p.chartPath)!)); p.event = assets.has(p.eventPath) ? readYaml(await blobText(assets.get(p.eventPath)!)) : { version: p.chart.version, events: [] };
    } else {
      const chartFile = files.find(f => !/Event\.ya?ml$/i.test(f.name) && f.name !== 'Info.yaml'); if (!chartFile) throw new Error('请选择音符 YAML，可同时选择 Info.yaml 与 Event.yaml');
      p.chart = readYaml(await blobText(chartFile)); p.chartPath = `Ring/${chartFile.name}`; p.eventPath = p.chartPath.replace(/\.ya?ml$/, 'Event.yaml');
      const info = files.find(f => f.name === 'Info.yaml'); if (info) p.info = readYaml(await blobText(info));
      const events = files.find(f => /Event\.ya?ml$/i.test(f.name)); if (events) p.event = readYaml(await blobText(events));
    }
    const errors = validateChart(p.chart, p.event); if (errors.length) throw new Error(errors.slice(0, 3).join('；'));
    if (!(Number(p.info.beatsPerMinute) > 0)) throw new Error('Info.yaml 的 BPM 必须大于 0');
    project = p; activeSong = undefined; localAssets = assets; selected = []; history.clear(); beat = start = 0; savedSignature = ''; changed(); renderLibrary(); renderInspector();
    const audioBlob = assets.get(p.info.songFilename); void loadAudio(audioBlob ? URL.createObjectURL(audioBlob) : '');
    const cover = assets.get(p.info.coverImageFilename); setCover(cover); notify('谱面导入成功，全部难度与原始字段已保留');
  } catch (e: any) { notify('导入失败：' + e.message); }
}
let coverUrl = '';
function setCover(blob?: Blob) { if (coverUrl) URL.revokeObjectURL(coverUrl); coverUrl = blob ? URL.createObjectURL(blob) : ''; $('current-cover').innerHTML = coverUrl ? `<img src="${coverUrl}" alt="歌曲封面">` : '◎'; }
function undo(redo = false) {
  const next = redo ? history.redo(project) : history.undo(project); if (!next) return;
  const revision = project.revision; project = next; project.revision = revision; selected = []; changed(); renderInspector();
}
const actions: Record<string, () => void> = {
  'toggle-color': togglePlacementColor,
  save: () => void saveProject(), export: () => void exportProject(), settings, check: checkChart, 'range-select': rangeDialog,
  group: () => groupNotes(), ungroup: () => groupNotes(true), copy, paste, mirror, delete: removeSelected, undo: () => undo(), redo: () => undo(true),
  play: () => void togglePlay(), home: () => { stop(); setBeat(0); start = 0; draw(); }, follow: () => { start = Math.max(0, beat - 2); draw(); },
  'new-project': () => confirmDiscard(() => { project = newProject(); activeSong = undefined; localAssets.clear(); history.clear(); selected = []; beat = start = 0; savedSignature = ''; void loadAudio(''); setCover(); changed(); renderLibrary(); renderInspector(); settings(); }),
  import: () => confirmDiscard(() => $<HTMLInputElement>('import-input').click()),
  'add-difficulty': addDifficulty,
  'add-at-beat': () => add(active), 'hold-add': () => { if (active === 'ringNotes') add(active, 0, 0, snap(beat, division), true); else mutate(() => { const data = project.chart.customData ??= {}; (data.bookmarks ??= []).push({ time: snap(beat, division), name: `标记 ${snap(beat, division)}` }); }); },
  loop: () => {
    if (loop) { loop = false; $('loop').classList.remove('active'); return; }
    modal('循环播放区间', `<div class="field-grid"><label>起始拍<input id="loop-start" type="number" min="0" value="${loopStart}"></label><label>结束拍<input id="loop-end" type="number" min="0" value="${loopEnd}"></label></div><div class="modal-actions"><button id="loop-apply" class="primary">启用循环</button></div>`);
    $('loop-apply').onclick = () => { const a = Number($<HTMLInputElement>('loop-start').value), b = Number($<HTMLInputElement>('loop-end').value); if (a < 0 || b <= a || !Number.isFinite(a + b)) { notify('循环结束拍必须大于起始拍'); return; } loopStart = a; loopEnd = b; loop = true; $('loop').classList.add('active'); if (beat < a || beat >= b) setBeat(a); $<HTMLDialogElement>('modal').close(); };
  },
  metronome: () => { metronome = !metronome; $('metronome').classList.toggle('active', metronome); if (metronome) clickBeat(); },
  'view-settings': () => {
    modal('3D 视图设置', `<p>圆环使用 4 列 × 3 层网格外圈的 10 个位置，内部 (1,1)、(2,1) 不使用。右键拖动旋转，滚轮调整歌曲进度；聚焦预览后 WASD 移动相机，按住右键时 Shift 降低、空格升高；松开右键后空格播放 / 暂停。</p><div class="field-grid"><label>圆环不透明度（%）<input id="ring-opacity" type="number" min="5" max="60" value="${Math.round((spatialPreview?.ringOpacity ?? .22) * 100)}"></label><label>旋转角度<input id="ring-rotation" type="number" value="${ringRotation}" step="15"></label><label>方向<select id="ring-reverse"><option value="0">顺时针</option><option value="1" ${ringReverse ? 'selected' : ''}>逆时针</option></select></label></div><label class="full-field">预览范围（拍）<select id="preview-range">${[4, 8, 16].map(n => `<option value="${n}" ${spatialPreview?.lookAhead === n ? 'selected' : ''}>未来 ${n} 拍</option>`).join('')}</select></label><div class="modal-actions"><button id="view-apply" class="primary">应用</button></div>`);
    $('view-apply').onclick = () => { ringRotation = Number($<HTMLInputElement>('ring-rotation').value) || 0; ringReverse = $<HTMLSelectElement>('ring-reverse').value === '1'; if (spatialPreview) { spatialPreview.lookAhead = Number($<HTMLSelectElement>('preview-range').value); spatialPreview.setRingOpacity(Number($<HTMLInputElement>('ring-opacity').value) / 100 || .22); } $<HTMLDialogElement>('modal').close(); draw(); };
  },
  help: () => modal('快捷键与操作', `<div class="shortcut-list">${[['Space', '播放 / 暂停'], ['V / B / E', '选择 / 放置 / 擦除'], ['Ctrl + Z / Y', '撤销 / 重做'], ['Ctrl + C / V', '复制 / 在播放头粘贴'], ['Ctrl + S', '保存谱面'], ['Delete', '删除鼠标下的音符；鼠标在画布外时删除选中项'], ['Q', '切换红蓝放置颜色'], ['按住 Shift', '暂时禁止放置（保留多选与相机控制）'], ['← / →', '前后移动一个吸附单位'], ['Shift + 点击', '多选'], ['拖动时间轴音符', '移动节拍和位置'], ['Alt + 拖动手部音符', '更改击打方向'], ['Alt + 拖动脚部 / 障碍物', '调整持续时长'], ['鼠标中键', '切换类型 0 / 1'], ['时间轴右键', '删除音符'], ['3D 右键拖动 / WASD', '旋转 / 移动相机'], ['3D 滚轮', '向下前进 / 向上后退（步长随细分调整）'], ['3D 右键 + Shift / 空格', '降低 / 升高相机'], ['3D Alt + 左键拖动', '拖动音符到对应轨道的其他位置'], ['3D Alt + 点击', '直接选中与圆环重叠的已有音符'], ['3D ＋ / −', '拉近 / 拉远相机'], ['滚轮 / Ctrl + 滚轮', '滚动时间轴 / 缩放']].map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div><p class="field-help">源文件保存前自动备份到 .ringmapper-backups。浏览器会保存最近一次工作草稿；本工具不连接官方账号。</p>`),
};
app.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!el) return;
  if ((e.shiftKey || shiftHeld) && (el.dataset.tool === 'draw' || el.id === 'add-at-beat' || el.id === 'hold-add')) { e.preventDefault(); return; }
  if (el.id === 'close-modal' || el.id === 'cancel-modal') { $<HTMLDialogElement>('modal').close(); return; }
  if (actions[el.id]) { actions[el.id](); return; }
  if (el.dataset.song) { const s = songs.find(s => s.id === el.dataset.song)!; confirmDiscard(() => void openSong(s)); }
  if (el.dataset.chart && el.dataset.chart !== project.chartPath) { if (localAssets.has(el.dataset.chart)) void openLocalChart(el.dataset.chart); else if (activeSong) confirmDiscard(() => void openSong(activeSong!, el.dataset.chart)); }
  if (el.dataset.kind) { active = el.dataset.kind as Kind; selected = []; renderInspector(); draw(); }
  if (el.dataset.tool) { tool = el.dataset.tool; renderInspector(); }
  if (el.dataset.color) { noteType = Number(el.dataset.color); renderInspector(); }
});
$('inspector').addEventListener('change', e => {
  const input = e.target as HTMLInputElement, key = input.dataset.field; if (!key || !selected.length) return;
  const value = key === 'groupId' ? input.value : input.value === '' ? undefined : Number(input.value);
  const trial = structuredClone(project);
  for (const s of selected.filter(s => s.kind === selected[0].kind)) { const n = items(trial, s.kind)[s.index]; if (value === undefined || value === '') delete n[key]; else n[key] = value; }
  const errors = validateChart(trial.chart, trial.event); if (errors.length) { notify(errors[0]); renderInspector(); return; }
  mutate(() => { project = trial; });
});
$('search').addEventListener('input', renderLibrary);
$('division').addEventListener('change', () => { division = Number($<HTMLSelectElement>('division').value); draw(); });
$('zoom').addEventListener('input', () => { scale = Number($<HTMLInputElement>('zoom').value); draw(); updateTransport(); });
$('scroll').addEventListener('input', () => { start = Number($<HTMLInputElement>('scroll').value); draw(); updateTransport(); });
$('seek').addEventListener('input', () => setBeat(Number($<HTMLInputElement>('seek').value)));
$('beat-input').addEventListener('change', () => { const value = Number($<HTMLInputElement>('beat-input').value); if (Number.isFinite(value)) setBeat(value); });
$('speed').addEventListener('change', () => { audio.playbackRate = Number($<HTMLSelectElement>('speed').value); virtualBeat = beat; virtualStart = performance.now(); });
$('volume').addEventListener('input', () => { audio.volume = Number($<HTMLInputElement>('volume').value); });
$('import-input').addEventListener('change', () => { const input = $<HTMLInputElement>('import-input'); if (input.files?.length) void importFiles([...input.files]); input.value = ''; });
$('audio-input').addEventListener('change', () => {
  const file = $<HTMLInputElement>('audio-input').files?.[0]; if (!file) return;
  mutate(() => { project.info.songFilename = file.name; localAssets.set(file.name, file); }); void loadAudio(URL.createObjectURL(file));
  audio.addEventListener('loadedmetadata', () => { if (Number.isFinite(audio.duration)) { project.info.songDuration = audio.duration; const input = document.querySelector<HTMLInputElement>('[data-info="songDuration"]'); if (input) input.value = String(audio.duration); changed(); } }, { once: true }); notify('音频已载入');
});
$('cover-input').addEventListener('change', async () => {
  const file = $<HTMLInputElement>('cover-input').files?.[0]; if (!file) return;
  try { const image = await createImageBitmap(file), canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; const side = Math.min(image.width, image.height); canvas.getContext('2d')!.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 512, 512); image.close(); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('封面处理失败')), 'image/png')); mutate(() => { project.info.coverImageFilename = 'cover.png'; localAssets.set('cover.png', blob); }); setCover(blob); notify('封面已居中裁剪为 512 × 512 PNG'); } catch (e: any) { notify(e.message); }
});
let selectionBox: { x: number; y: number; endX: number; endY: number; base: Selection[] } | undefined;
let drag: { x: number; y: number; refs: Selection[]; originals: Item[]; pushed: boolean; alt: boolean } | undefined;
function canvasPoint(e: PointerEvent | MouseEvent, canvas: HTMLCanvasElement) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: (e.clientY - r.top) * (canvas === timeline ? timelineHeight / r.height : 1) }; }
timeline.addEventListener('pointerdown', e => {
  const { x, y } = canvasPoint(e, timeline), hit = timelineHit(x, y, view());
  if (y < 32 && x >= timelineMargin && e.button === 0) { setBeat(snap(start + (x - timelineMargin) / scale, division)); return; }
  if (!hit) return;
  if (hit.index !== undefined) {
    const ref = { kind: hit.kind, index: hit.index };
    if (e.button === 2 || tool === 'erase' && e.button === 0) { select([ref]); removeSelected(); return; }
    if (e.button === 1) { e.preventDefault(); mutate(() => { const n = items(project, hit.kind)[hit.index!]; if (n.type === 0 || n.type === 1) n.type = 1 - n.type; }); return; }
    if (e.button !== 0) return;
    const exists = selected.some(s => s.kind === ref.kind && s.index === ref.index);
    if (e.shiftKey) select(exists ? selected.filter(s => s.kind !== ref.kind || s.index !== ref.index) : [...selected, ref]); else if (!exists) select([ref]);
    drag = { x, y, refs: [...selected], originals: selected.map(s => structuredClone(items(project, s.kind)[s.index])), pushed: false, alt: e.altKey };
    timeline.setPointerCapture(e.pointerId);
  } else if (e.button === 0) {
    if (tool === 'draw' && !e.shiftKey) { const index = hit.kind === 'notes' ? handPositions[hit.lane][0] : hit.kind === 'events' ? eventTypes[hit.lane] : hit.lane; const layer = hit.kind === 'notes' ? handPositions[hit.lane][1] : 0; add(hit.kind, index, layer, snap(hit.time, division)); }
    else if (tool === 'select') { selectionBox = { x, y, endX: x, endY: y, base: e.shiftKey ? [...selected] : [] }; timeline.setPointerCapture(e.pointerId); setBeat(snap(hit.time, division)); }
  }
});
timeline.addEventListener('pointermove', e => {
  if (selectionBox) { const p = canvasPoint(e, timeline); selectionBox.endX = p.x; selectionBox.endY = p.y; draw(); return; }
  if (!drag) return; const { x, y } = canvasPoint(e, timeline); if (Math.abs(x - drag.x) + Math.abs(y - drag.y) < 3) return;
  if (!drag.pushed) { history.push(project); drag.pushed = true; }
  const requested = Math.round((x - drag.x) / scale * division) / division, min = Math.min(...drag.originals.map(n => n.time)), delta = Math.max(-min, requested);
  const directionVectors = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (let i = 0; i < drag.refs.length; i++) {
    const s = drag.refs[i], n = items(project, s.kind)[s.index], original = drag.originals[i];
    if (drag.alt && s.kind === 'notes') {
      const angle = Math.atan2(y - drag.y, x - drag.x); let best = 0, diff = Infinity;
      directionVectors.forEach(([vx, vy], index) => { const d = Math.abs(Math.atan2(Math.sin(angle - Math.atan2(vy, vx)), Math.cos(angle - Math.atan2(vy, vx)))); if (d < diff) { diff = d; best = index; } }); n.cutDirection = best;
    } else if (drag.alt && (s.kind === 'ringNotes' || s.kind === 'obstacles')) { n.duration = Math.max(1 / division, Number(original.duration ?? 1) + requested); if (s.kind === 'ringNotes') n.ringNoteType = 1;
    } else { n.time = Math.round((original.time + delta) * 1e6) / 1e6;
      if (drag.refs.length === 1) { const hit = timelineHit(x, y, view()); if (hit?.kind === s.kind && s.kind !== 'events') { n.lineIndex = s.kind === 'notes' ? handPositions[hit.lane][0] : hit.lane; if (s.kind === 'notes') n.lineLayer = handPositions[hit.lane][1]; } }
    }
  } draw();
});
function finishDrag() {
  if (selectionBox) { const b = selectionBox, refs = [...b.base];
    for (const kind of kinds) items(project, kind).forEach((n, index) => { const band = bands[kind], row = timelineLane(kind, n); const x = timelineMargin + (n.time - start) * scale, y = band.top + (row + .5) / band.lanes * band.height; if (x >= Math.min(b.x, b.endX) && x <= Math.max(b.x, b.endX) && y >= Math.min(b.y, b.endY) && y <= Math.max(b.y, b.endY) && !refs.some(s => s.kind === kind && s.index === index)) refs.push({ kind, index }); }); selectionBox = undefined; select(refs);
  }
  if (drag?.pushed) { changed(); renderInspector(); } drag = undefined; }
timeline.addEventListener('pointerup', finishDrag); timeline.addEventListener('pointercancel', finishDrag);
timeline.addEventListener('contextmenu', e => e.preventDefault());
timeline.addEventListener('wheel', e => { e.preventDefault(); if (e.ctrlKey) { scale = Math.max(12, Math.min(160, scale * (e.deltaY < 0 ? 1.1 : .9))); $<HTMLInputElement>('zoom').value = String(scale); } else start = Math.max(0, Math.min(totalBeats(), start + (e.deltaX || e.deltaY) / scale)); $<HTMLInputElement>('scroll').value = String(start); updateTransport(); draw(); }, { passive: false });
let previewPress: { x: number; y: number; button: number; shift: boolean } | undefined;
let spatialDrag: { ref: Selection; original: Item; pushed: boolean; pointerId: number } | undefined;
preview.addEventListener('pointerdown', e => {
  if (e.button === 1) e.preventDefault();
  previewPress = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey };
  if (e.button !== 0 || !e.altKey) return;
  const { x, y } = canvasPoint(e, preview), hit = spatialPreview?.pick(x, y, 'notes');
  if (hit?.index === undefined) return;
  stop(); select([{ kind: hit.kind, index: hit.index }]);
  spatialDrag = { ref: { kind: hit.kind, index: hit.index }, original: structuredClone(items(project, hit.kind)[hit.index]), pushed: false, pointerId: e.pointerId };
  preview.setPointerCapture(e.pointerId); e.preventDefault(); preview.classList.add('dragging-note');
});
preview.addEventListener('pointermove', e => {
  if (!spatialDrag || !previewPress || Math.hypot(e.clientX - previewPress.x, e.clientY - previewPress.y) < 4) return;
  const { x, y } = canvasPoint(e, preview), d = spatialDrag;
  const position = spatialPreview?.dragPosition(x, y, d.ref.kind, d.original); if (!position) return;
  const note = items(project, d.ref.kind)[d.ref.index];
  if (note.lineIndex === position.lineIndex && (d.ref.kind !== 'notes' || note.lineLayer === position.lineLayer)) return;
  if (!d.pushed) { history.push(project); d.pushed = true; }
  note.lineIndex = position.lineIndex; if (d.ref.kind === 'notes') note.lineLayer = position.lineLayer;
  draw(); renderInspector();
});
function finishSpatialDrag() {
  if (!spatialDrag) return false;
  const d = spatialDrag; spatialDrag = undefined; previewPress = undefined;
  if (preview.hasPointerCapture(d.pointerId)) preview.releasePointerCapture(d.pointerId);
  preview.classList.remove('dragging-note'); if (d.pushed) changed();
  return true;
}
preview.addEventListener('pointercancel', () => { finishSpatialDrag(); previewPress = undefined; });
preview.addEventListener('lostpointercapture', () => { finishSpatialDrag(); });
window.addEventListener('blur', () => { finishSpatialDrag(); previewPress = undefined; });
preview.addEventListener('pointerup', e => {
  if (finishSpatialDrag()) return;
  const press = previewPress; previewPress = undefined;
  if (!press || press.button === 2 || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return;
  const { x, y } = canvasPoint(e, preview);
  const target = spatialPreview?.pick(x, y, 'targets'), noteHit = spatialPreview?.pick(x, y, 'notes');
  // Clicking a target places at the playhead even when a future note is visible behind it.
  // A note already occupying this beat is selected instead of creating a duplicate.
  const atTarget = target ? items(project, target.kind).findIndex(n => Math.abs(n.time - snap(beat, division)) < 1e-6 && n.lineIndex === target.lineIndex && (target.kind !== 'notes' || n.lineLayer === target.lineLayer)) : -1;
  // A wide pedal covers several placement positions: its visible edges still select the pedal.
  const occupiedFoot = noteHit?.kind === 'ringNotes' && noteHit.index !== undefined && items(project, 'ringNotes')[noteHit.index].time <= snap(beat, division) + 1e-6 ? noteHit : undefined;
  if (e.button === 0 && !e.altKey && !e.shiftKey && !press.shift && tool !== 'erase' && !occupiedFoot && target && atTarget < 0) { add(target.kind, target.lineIndex, target.lineLayer); return; }
  const hit = occupiedFoot ?? (target && atTarget >= 0 ? { ...target, index: atTarget } : noteHit);
  if (hit?.index === undefined) return;
  const ref = { kind: hit.kind, index: hit.index };
  if (tool === 'erase' && e.button === 0) { select([ref]); removeSelected(); }
  else if (e.button === 1) { e.preventDefault(); mutate(() => { const n = items(project, ref.kind)[ref.index]; if (n.type === 0 || n.type === 1) n.type = 1 - n.type; }); }
  else if (e.button === 0) {
    const exists = selected.some(s => s.kind === ref.kind && s.index === ref.index);
    select(e.shiftKey ? exists ? selected.filter(s => s.kind !== ref.kind || s.index !== ref.index) : [...selected, ref] : [ref]);
  }
});
preview.addEventListener('wheel', e => {
  e.preventDefault(); preview.focus({ preventScroll: true });
  // Normalize pixels, lines and pages. A typical wheel notch advances one snap interval;
  // high-resolution trackpads retain fractional progress rather than jumping a whole beat.
  const delta = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? preview.clientHeight : 1);
  if (delta) setBeat(Math.round((beat + delta / 100 / division) * 1e6) / 1e6);
}, { passive: false });
preview.addEventListener('contextmenu', e => e.preventDefault());
preview.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
$('depth-zoom').addEventListener('input', () => {
  const value = Number($<HTMLInputElement>('depth-zoom').value);
  spatialPreview?.setDepthScale(value); $('depth-zoom-value').textContent = `${value.toFixed(2)}×`;
});
// Resolve a fresh hit when Delete is pressed; cached indices go stale after deletion or playback.
let pointerPosition: { x: number; y: number } | undefined;
window.addEventListener('pointermove', e => { pointerPosition = { x: e.clientX, y: e.clientY }; }, { capture: true });
window.addEventListener('pointerdown', e => { pointerPosition = { x: e.clientX, y: e.clientY }; }, { capture: true });
window.addEventListener('pointerout', e => { if (!e.relatedTarget) pointerPosition = undefined; });
function deleteHovered() {
  if (!pointerPosition) return false;
  const target = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
  if (target !== preview && target !== timeline) return false;
  if (spatialDrag || drag || selectionBox) return true;
  const box = target.getBoundingClientRect(), x = pointerPosition.x - box.left, y = pointerPosition.y - box.top;
  const hit = target === preview ? spatialPreview?.pick(x, y, 'notes') : timelineHit(x, y * timelineHeight / box.height, view());
  if (hit?.index !== undefined) {
    const kind = hit.kind, index = hit.index;
    mutate(() => {
      ensureItems(project, kind).splice(index, 1);
      selected = selected.filter(s => s.kind !== kind || s.index !== index).map(s => s.kind === kind && s.index > index ? { ...s, index: s.index - 1 } : s);
    });
  }
  return true;
}
function setShiftHeld(value: boolean) { shiftHeld = value; document.body.classList.toggle('shift-held', value); }
window.addEventListener('keydown', e => { if (e.key === 'Shift') setShiftHeld(true); }, { capture: true });
window.addEventListener('keyup', e => { if (e.key === 'Shift') setShiftHeld(false); }, { capture: true });
window.addEventListener('blur', () => { setShiftHeld(false); pointerPosition = undefined; });
$('camera-near').addEventListener('click', () => spatialPreview?.zoomCamera(.85));
$('camera-far').addEventListener('click', () => spatialPreview?.zoomCamera(1 / .85));
function showTimeline(open: boolean) {
  $('scene-workspace').classList.toggle('timeline-open', open);
  const panel = $('timeline-panel'); panel.classList.toggle('is-collapsed', !open); panel.inert = !open;
  $('toggle-timeline').setAttribute('aria-expanded', String(open));
  $('toggle-timeline').classList.toggle('active', open);
  $('toggle-timeline').querySelector('span')!.textContent = open ? '时间轴 ↓' : '时间轴 ↑';
  $('toggle-timeline').title = open ? '向下收起时间轴' : '展开时间轴';
  if (!open && panel.contains(document.activeElement)) $('toggle-timeline').focus();
  draw(); updateTransport();
}
$('toggle-timeline').onclick = () => showTimeline($('timeline-panel').inert);
$('hide-timeline').onclick = () => showTimeline(false);
$('toggle-tools').onclick = () => {
  const body = $('tools-body'), open = body.hidden; body.hidden = !open;
  $('toggle-tools').textContent = open ? '−' : '＋';
  $('toggle-tools').setAttribute('aria-expanded', String(open));
  $('toggle-tools').setAttribute('aria-label', open ? '收起编辑工具' : '展开编辑工具');
};
// Keep the floating editor inside the 3D workspace, including after a browser resize.
const toolsPanel = $('tools-panel'), toolsHandle = $('tools-handle'), sceneWorkspace = $('scene-workspace');
let toolsDrag: { x: number; y: number; left: number; top: number } | undefined;
function positionTools(left: number, top: number) {
  const maxX = Math.max(8, sceneWorkspace.clientWidth - toolsPanel.offsetWidth - 8);
  const maxY = Math.max(8, preview.clientHeight - toolsPanel.offsetHeight - (sceneWorkspace.classList.contains('timeline-open') ? 12 : 88));
  toolsPanel.style.left = `${Math.max(8, Math.min(maxX, left))}px`;
  toolsPanel.style.top = `${Math.max(8, Math.min(maxY, top))}px`; toolsPanel.style.right = 'auto';
}
toolsHandle.addEventListener('pointerdown', e => {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
  toolsDrag = { x: e.clientX, y: e.clientY, left: toolsPanel.offsetLeft, top: toolsPanel.offsetTop };
  toolsHandle.setPointerCapture(e.pointerId); e.preventDefault();
});
toolsHandle.addEventListener('pointermove', e => { if (toolsDrag) positionTools(toolsDrag.left + e.clientX - toolsDrag.x, toolsDrag.top + e.clientY - toolsDrag.y); });
toolsHandle.addEventListener('pointerup', () => { toolsDrag = undefined; });
toolsHandle.addEventListener('pointercancel', () => { toolsDrag = undefined; });
toolsHandle.addEventListener('dblclick', () => { toolsPanel.removeAttribute('style'); });
new ResizeObserver(() => { if (toolsPanel.style.left) positionTools(toolsPanel.offsetLeft, toolsPanel.offsetTop); }).observe(preview);
$('camera-preset').addEventListener('change', () => spatialPreview?.setCamera($<HTMLSelectElement>('camera-preset').value as 'perspective' | 'front' | 'top'));
$('camera-reset').addEventListener('click', () => { spatialPreview?.setCamera('perspective'); $<HTMLSelectElement>('camera-preset').value = 'perspective'; });
// Mouse-operated controls return keyboard focus to the editor; text entry stays local.
function focusEditor() { if (!$<HTMLDialogElement>('modal').open) preview.focus({ preventScroll: true }); }
app.addEventListener('click', e => {
  const button = (e.target as HTMLElement).closest('button');
  if (button && !button.closest('dialog')) queueMicrotask(focusEditor);
});
app.addEventListener('change', e => {
  const control = e.target as HTMLElement;
  if (control.matches('select,input[type="range"],input[type="checkbox"]') && !control.closest('dialog')) queueMicrotask(focusEditor);
});
$('modal').addEventListener('close', focusEditor);
window.addEventListener('keydown', e => {
  const target = e.target as HTMLElement;
  if ($<HTMLDialogElement>('modal').open || target.isContentEditable || target.matches('textarea,input:not([type=range]):not([type=checkbox]):not([type=button])')) {
    if (e.key === 'Enter' && target.matches('input') && !$<HTMLDialogElement>('modal').open) { target.blur(); focusEditor(); }
    return;
  }
  if (target.matches('select') && e.code !== 'Space') return;
  if (e.ctrlKey || e.metaKey) { const key = e.key.toLowerCase(); if (['s', 'z', 'y', 'c', 'v', 'a'].includes(key)) e.preventDefault(); if (key === 's') void saveProject(); if (key === 'z') undo(e.shiftKey); if (key === 'y') undo(true); if (key === 'c') copy(); if (key === 'v') paste(); if (key === 'a') select(kinds.flatMap(kind => items(project, kind).map((_, index) => ({ kind, index })))); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { focusEditor(); void togglePlay(); } }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!e.repeat && !deleteHovered()) removeSelected(); }
  if (e.key.toLowerCase() === 'q' && !e.altKey && !e.repeat) { e.preventDefault(); togglePlacementColor(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setBeat(snap(beat + (e.key === 'ArrowRight' ? 1 : -1) / division, division)); }
  if (['v', 'b', 'e'].includes(e.key.toLowerCase())) { tool = ({ v: 'select', b: 'draw', e: 'erase' } as Record<string, string>)[e.key.toLowerCase()]; renderInspector(); }
  if (e.key === 'Escape') select([]);
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
new ResizeObserver(() => { draw(); updateTransport(); }).observe($('timeline-panel') ?? timeline.parentElement!);
new ResizeObserver(draw).observe(preview);
async function init() {
  iconsRefresh(); renderSummary(); renderInspector(); draw(); requestAnimationFrame(frame);
  try { songs = await api<Song[]>('/api/catalog'); renderLibrary();
    const draft = localStorage.getItem('ringmapper-draft');
    if (draft) {
      const data = JSON.parse(draft);
      modal('恢复上次工作', `<p>发现「${escape(data.project.info.songName)}」的浏览器草稿。是否继续编辑？</p><p class="field-help">草稿保存谱面数据；未保存的本地音频和封面需要重新导入。</p><div class="modal-actions"><button id="restore-draft" class="primary">恢复草稿</button><button id="skip-draft">打开曲库</button></div>`);
      $('restore-draft').onclick = () => { project = data.project; activeSong = songs.find(s => s.id === project.songId); savedSignature = ''; selected = []; changed(); renderLibrary(); renderInspector(); if (activeSong?.audio) void loadAudio(asset(activeSong.id, activeSong.audio)); $<HTMLDialogElement>('modal').close(); };
      $('skip-draft').onclick = () => { localStorage.removeItem('ringmapper-draft'); $<HTMLDialogElement>('modal').close(); void openSong(songs.find(s => s.id === 'caocao') ?? songs[0]); };
    } else if (songs.length) await openSong(songs.find(s => s.id === 'caocao') ?? songs[0]);
  } catch (e: any) { $('song-list').innerHTML = '<div class="empty-library">本地曲库暂不可用<br>仍可新建或导入 ZIP 编辑</div>'; notify(e.message); }
}
void init();

async function blobBase64(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }

async function blobText(blob: Blob) { return decodeText(new Uint8Array(await blob.arrayBuffer())); }

function chartEntries() {
  const entries = new Map((activeSong?.charts ?? []).map(c => [c.path, c]));
  for (const filename of [...localAssets.keys(), project.chartPath]) {
    if (!/\.yaml$/i.test(filename) || filename === 'Info.yaml' || /Event\.yaml$/i.test(filename)) continue;
    entries.set(filename, { path: filename, eventPath: filename.replace(/\.yaml$/, 'Event.yaml'), mode: filename.split('/')[0], difficulty: filename.split('/').pop()!.replace(/RingDance|Ring|\.yaml/g, '') });
  }
  return [...entries.values()];
}
async function openLocalChart(filename: string) {
  try {
    updateMetadata(project); localAssets.set(project.chartPath, new Blob([writeYaml(project.chart)])); localAssets.set(project.eventPath, new Blob([writeYaml(project.event)]));
    const chart = readYaml(await blobText(localAssets.get(filename)!));
    const entry = [...(project.info.difficultyCiphermapSets ?? []), ...(project.info.difficultyBeatmapSets ?? [])].flatMap((s: any) => s.difficultyCiphermaps ?? s.difficultyBeatmaps ?? []).find((e: any) => (e.ciphermapFilename ?? e.beatmapFilename) === filename);
    const eventPath = entry?.eventmapFilename ?? filename.replace(/\.yaml$/, 'Event.yaml');
    const event = localAssets.has(eventPath) ? readYaml(await blobText(localAssets.get(eventPath)!)) : { version: chart.version, events: [] };
    stop(); project.chart = chart; project.event = event; project.chartPath = filename; project.eventPath = eventPath; selected = []; history.clear();
    if (project.songId) project.revision = (await api<{ revision: string }>(`/api/revision?song=${encodeURIComponent(project.songId)}&chart=${encodeURIComponent(filename)}&event=${encodeURIComponent(eventPath)}`)).revision;
    changed(); renderInspector();
  } catch (e: any) { notify('切换难度失败：' + e.message); }
}
