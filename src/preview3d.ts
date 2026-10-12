import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { items, snap, type Kind, type Item } from './model';
import { groupingOptions, groupHeads } from './groups';
import { LightingRunway } from './lighting3d';
import type { ViewState, Selection } from './render';
import { handPositions, handLane, handAngle, handWorldPosition, footX, noteDepth, durationExtent, stage, footNoteSize, footTrack, obstacleBounds, defaultDepthScale, defaultPreviewRange, defaultObstacleDuration } from './layout';

declare global { interface HTMLCanvasElement { spatialPreview?: SpatialPreview } }

export type PreviewHit = { kind: Kind; lineIndex: number; lineLayer: number; index?: number; obstacleType?: 0 | 1; time?: number };
type Instance = { position: THREE.Vector3; scale?: THREE.Vector3; rotation?: THREE.Quaternion; color: THREE.Color; hit?: PreviewHit };
const handColors = [new THREE.Color('#ff1744'), new THREE.Color('#1261ff')];
const amber = new THREE.Color('#e9b56e');
const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), unit = new THREE.Vector3(1, 1, 1);

/** Ring targets and approaching hand notes share exactly the same annular profile. */
function ringSectorGeometry(depth = .16) {
  const inner = 1.34, outer = 1.76, half = Math.PI / 10 - .014;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, -half, half, false);
  shape.lineTo(Math.cos(half) * inner, Math.sin(half) * inner);
  shape.absarc(0, 0, inner, half, -half, true); shape.closePath();
  const sectorGeometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 1, steps: 1, curveSegments: 20 });
  sectorGeometry.translate(0, 0, -depth / 2);
  return sectorGeometry;
}

/** Reuses GPU buffers as the playhead moves, rather than allocating a mesh for every frame. */
class InstanceBatch {
  mesh: THREE.InstancedMesh;
  records: Instance[] = [];
  constructor(private root: THREE.Group, readonly geometry: THREE.BufferGeometry, readonly material: THREE.Material, name: string) {
    this.mesh = this.make(128, name); root.add(this.mesh);
  }
  private make(capacity: number, name: string) {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = name; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.userData.batch = this;
    return mesh;
  }
  sync(records: Instance[]) {
    if (records.length > this.mesh.instanceMatrix.count) {
      const previous = this.mesh; this.mesh = this.make(2 ** Math.ceil(Math.log2(records.length)), previous.name);
      this.mesh.scale.copy(previous.scale); this.root.remove(previous); previous.dispose(); this.root.add(this.mesh);
    }
    this.records = records; this.mesh.count = records.length;
    records.forEach((record, i) => {
      matrix.compose(record.position, record.rotation ?? quaternion, record.scale ?? unit);
      this.mesh.setMatrixAt(i, matrix); this.mesh.setColorAt(i, record.color);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }
}

export class SpatialPreview {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, .08, 100);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly ring = new THREE.Group();
  readonly noteRoot = new THREE.Group();
  readonly targets: THREE.Object3D[] = [];
  readonly lighting = new LightingRunway();
  private wallArea = new THREE.Group();
  private wallAreaTargets: THREE.Mesh[] = [];
  private groupEdges: THREE.LineSegments[] = [];
  private groupHeadMarkers: THREE.Mesh[] = [];
  private groupEdgeMaterial = new THREE.LineBasicMaterial({ color: '#e4edfa', transparent: true, opacity: .28, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
  private groupHaloMaterial = new THREE.LineBasicMaterial({ color: '#b4d9f8', transparent: true, opacity: .08, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
  private groupHeadGeometry = new THREE.RingGeometry(.075, .098, 32);
  private groupHeadMaterial = new THREE.MeshBasicMaterial({ color: '#e3f6ff', toneMapped: false, transparent: true, opacity: .8, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  private obstacleTargets: THREE.Mesh[] = [];
  private wallHover?: { x: number; y: number };
  private wallPreview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffca70', transparent: true, opacity: .085, depthWrite: false, side: THREE.DoubleSide }));
  private padTextures: THREE.Texture[] = [];
  private footLabels: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; track: number; active: boolean }[] = [];
  private selectionEdges: THREE.LineSegments[] = [];
  private edgeGeometry = { notes: new THREE.EdgesGeometry(ringSectorGeometry(.34)), ringNotes: new THREE.EdgesGeometry(new THREE.BoxGeometry(footNoteSize.width, footNoteSize.height, footNoteSize.depth)), obstacles: new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)) };
  private edgeMaterial = new THREE.LineBasicMaterial({ color: '#62ffd4', toneMapped: false, depthTest: false, transparent: true, opacity: .95 });
  private annotations = document.createElement('div');
  private markers: HTMLSpanElement[] = [];
  private anchors: { el: HTMLElement; position: THREE.Vector3; offset: number }[] = [];
  private quickGroup = document.createElement('button');
  private quickJoin = document.createElement('button');
  private quickFill = document.createElement('button');
  handOpacity = 1;
  footOpacity = 1;
  lookAhead = defaultPreviewRange;
  depthScale = defaultDepthScale;
  get beatSpacing() { return stage.beatSpacing * this.depthScale; }
  private floor!: THREE.Mesh;
  private floorGrid!: THREE.GridHelper;
  private beatLabels: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; value: number }[] = [];
  private state?: ViewState;
  private raycaster = new THREE.Raycaster();
  private handBatch: InstanceBatch;
  private footBatch: InstanceBatch;
  private tailBatch: InstanceBatch;
  private wallBatch: InstanceBatch;
  private wallWireBatch: InstanceBatch;
  ringOpacity = .22;
  private groupLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#b4e9d3', transparent: true, opacity: .55 }));
  private beatLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#48635e', transparent: true, opacity: .45 }));
  private snapLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#6b9185', transparent: true, opacity: .22 }));
  private keys = new Set<string>();
  private previousTick = 0;
  private lost = false;
  private disposed = false;
  private hud: HTMLDivElement;
  private ringSetting = '';
  private rightHeld = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.2;
    this.scene.background = new THREE.Color('#121c24'); this.scene.fog = new THREE.Fog('#121c24', 20, 43);
    this.scene.add(new THREE.HemisphereLight('#d0e9ff', '#324a40', 2.5));
    const key = new THREE.DirectionalLight('#fff1df', 3); key.position.set(3, 7, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight('#66b8d8', 2); rim.position.set(-5, 4, -10); this.scene.add(rim);
    this.ring.name = 'hand-ring-ten-positions'; this.noteRoot.name = 'chart-objects';
    this.beatLines.name = 'beat-guides'; this.snapLines.name = 'snap-guides';
    this.wallPreview.name = 'wall-placement-preview'; this.wallPreview.visible = false;
    const previewEdge = new THREE.LineSegments(new THREE.EdgesGeometry(this.wallPreview.geometry), new THREE.LineBasicMaterial({ color: '#ffd486', transparent: true, opacity: .32, depthWrite: false }));
    this.wallPreview.add(previewEdge);
    this.scene.add(this.ring, this.noteRoot, this.groupLines, this.beatLines, this.snapLines, this.wallPreview, this.wallArea, this.lighting.root);
    this.makeStage();
    this.handBatch = new InstanceBatch(this.noteRoot, ringSectorGeometry(.32), new THREE.MeshStandardMaterial({ roughness: .4, metalness: .08 }), 'hand-notes');
    this.handBatch.mesh.scale.x = stage.ringScaleX;
    this.footBatch = new InstanceBatch(this.noteRoot, new THREE.BoxGeometry(footNoteSize.width, footNoteSize.height, footNoteSize.depth), new THREE.MeshStandardMaterial({ roughness: .85, metalness: 0 }), 'foot-notes');
    this.tailBatch = new InstanceBatch(this.noteRoot, new THREE.BoxGeometry(footNoteSize.width, .055, 1), new THREE.MeshStandardMaterial({ transparent: true, opacity: .5, roughness: .85, metalness: 0, depthWrite: false }), 'foot-holds');
    this.wallBatch = new InstanceBatch(this.noteRoot, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide }), 'obstacles');
    this.wallWireBatch = new InstanceBatch(this.noteRoot, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: .6, depthWrite: false }), 'obstacle-edges');
    this.controls = new OrbitControls(this.camera, canvas);
    // Left/middle clicks edit the chart; wheel seeks and modifiers move the camera vertically.
    this.controls.mouseButtons = { LEFT: -1 as THREE.MOUSE, MIDDLE: -1 as THREE.MOUSE, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enableDamping = true; this.controls.dampingFactor = .15;
    this.controls.minDistance = 3; this.controls.maxDistance = 35;
    this.controls.minPolarAngle = .12; this.controls.maxPolarAngle = Math.PI * .51;
    this.controls.enableZoom = false; this.controls.enablePan = false;
    this.controls.addEventListener('change', this.render);
    this.hud = document.createElement('div'); this.hud.className = 'preview-hud'; this.hud.setAttribute('aria-live', 'off');
    this.hud.innerHTML = '<span class="preview-beat">BEAT 0.00</span>';
    this.annotations.className = 'scene-annotations'; this.quickGroup.id = 'quick-group'; this.quickGroup.textContent = '＋ 打组'; this.quickGroup.hidden = true;
    this.quickGroup.onclick = () => this.canvas.dispatchEvent(new CustomEvent('group-selection', { bubbles: true, detail: { action: this.quickGroup.dataset.action } }));
    this.quickJoin.id = 'quick-join-group'; this.quickJoin.textContent = '加入组'; this.quickJoin.hidden = true;
    this.quickJoin.onclick = () => this.canvas.dispatchEvent(new CustomEvent('group-selection', { bubbles: true, detail: { action: 'join' } }));
    this.quickFill.id = 'quick-fill'; this.quickFill.textContent = '＋ 填充'; this.quickFill.hidden = true;
    this.quickFill.onclick = () => this.canvas.dispatchEvent(new CustomEvent('fill-selection', { bubbles: true }));
    this.annotations.append(this.quickGroup, this.quickJoin, this.quickFill); canvas.parentElement!.append(this.annotations);
    canvas.parentElement!.append(this.hud);
    canvas.dataset.renderer = 'webgl'; canvas.dataset.handPositions = '10';
    canvas.addEventListener('keydown', this.keyDown); canvas.addEventListener('keyup', this.keyUp);
    canvas.addEventListener('blur', this.clearKeys); window.addEventListener('blur', this.clearKeys);
    canvas.addEventListener('pointerdown', this.focusCanvas);
    canvas.addEventListener('pointermove', this.hoverWall); canvas.addEventListener('pointerleave', this.clearWallHover);
    window.addEventListener('mouseup', this.releaseCamera);
    canvas.addEventListener('pointercancel', this.clearKeys);
    canvas.addEventListener('webglcontextlost', this.contextLost); canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.resetCamera(); this.resize(); this.canvas.spatialPreview = this;
  }

  private makeStage() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 42), new THREE.MeshStandardMaterial({ color: '#15272b', roughness: .85, metalness: .12 }));
    this.floor = floor; floor.rotation.x = -Math.PI / 2; floor.position.set(0, -.03, -14); this.scene.add(floor);
    const grid = this.floorGrid = new THREE.GridHelper(40, 40, '#34575c', '#213b40'); grid.position.set(0, 0, -12); this.scene.add(grid);
    const base = new THREE.Mesh(new THREE.BoxGeometry(5.1, .2, 1.25), new THREE.MeshStandardMaterial({ color: '#11181e', roughness: .45, metalness: .25 }));
    base.position.set(0, .11, 0); this.scene.add(base);
    for (let i = 0; i < 36; i++) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(stage.footWidth / 36 - .008, .055, .7), new THREE.MeshStandardMaterial({ color: i % 9 === 0 ? '#708b83' : '#485f60', roughness: .5, metalness: .22 }));
      pad.position.set(footX(i), stage.footY - .1, 0); pad.name = `foot-slot-${i}`;
      pad.userData.hit = { kind: 'ringNotes', lineIndex: i, lineLayer: 0 } satisfies PreviewHit;
      this.scene.add(pad); this.targets.push(pad);
    }
    for (let i = 0; i < 4; i++) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(stage.footWidth / 4 - .055, .07, .7), new THREE.MeshStandardMaterial({ color: '#daa548', transparent: true, opacity: .8 }));
      pad.position.set((i - 1.5) * stage.footWidth / 4, .12, .95); pad.name = `obstacle-slot-${i}`; pad.visible = false;
      pad.userData.hit = { kind: 'obstacles', lineIndex: i, lineLayer: 0 } satisfies PreviewHit;
      const labelCanvas = document.createElement('canvas'); labelCanvas.width = 128; labelCanvas.height = 96;
      const c = labelCanvas.getContext('2d')!; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#182922'; c.font = 'bold 38px Consolas'; c.fillText(String(i + 1), 64, 48);
      c.font = '18px sans-serif'; c.fillText('上半墙', 64, 14); c.fillText('全高墙', 64, 82);
      c.strokeStyle = '#18292288'; c.beginPath(); c.moveTo(5, 48); c.lineTo(40, 48); c.moveTo(88, 48); c.lineTo(123, 48); c.stroke();
      const texture = new THREE.CanvasTexture(labelCanvas); this.padTextures.push(texture);
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.02, .66), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
      label.rotation.x = -Math.PI / 2; label.position.y = .037; pad.add(label);
      this.scene.add(pad); this.obstacleTargets.push(pad);
    }
    this.wallArea.name = 'wall-placement-area'; this.wallArea.visible = false;
    const bottom = .20, top = stage.ringY + 1.9, middle = (bottom + top) / 2;
    const lines: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(stage.footWidth / 4, top - bottom), new THREE.MeshBasicMaterial({ color: '#edc87c', transparent: true, opacity: .018, side: THREE.DoubleSide, depthWrite: false }));
      plane.position.set((i - 1.5) * stage.footWidth / 4, middle, .08); plane.name = `wall-area-lane-${i}`;
      plane.userData.hit = { kind: 'obstacles', lineIndex: i, lineLayer: 0 }; plane.userData.wallArea = true;
      this.wallArea.add(plane); this.wallAreaTargets.push(plane);
    }
    for (let i = 0; i <= 4; i++) { const x = -stage.footWidth / 2 + i * stage.footWidth / 4; lines.push(new THREE.Vector3(x,bottom,.09),new THREE.Vector3(x,top,.09)); }
    for (const y of [bottom, middle, top]) lines.push(new THREE.Vector3(-stage.footWidth/2,y,.09),new THREE.Vector3(stage.footWidth/2,y,.09));
    this.wallArea.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines),new THREE.LineBasicMaterial({ color:'#c2b382', transparent:true, opacity:.3, depthWrite:false })));
    const divider = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-stage.footWidth/2,middle,.1),new THREE.Vector3(stage.footWidth/2,middle,.1)]),new THREE.LineBasicMaterial({color:'#eacb85',transparent:true,opacity:.65,depthWrite:false})); divider.name='wall-height-divider'; this.wallArea.add(divider);
    const rails = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2.55, .025, 1), new THREE.Vector3(-2.55, .025, -20),
      new THREE.Vector3(2.55, .025, 1), new THREE.Vector3(2.55, .025, -20),
      new THREE.Vector3(-2.55, .22, .5), new THREE.Vector3(2.55, .22, .5),
    ]);
    this.scene.add(new THREE.LineSegments(rails, new THREE.LineBasicMaterial({ color: '#75b5a8', transparent: true, opacity: .6 })));
    const supports = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-.95, 1.42, 0), new THREE.Vector3(-2.45, .25, .4),
      new THREE.Vector3(.95, 1.42, 0), new THREE.Vector3(2.45, .25, .4),
    ]);
    this.scene.add(new THREE.LineSegments(supports, new THREE.LineBasicMaterial({ color: '#809b95' })));
    const sectorGeometry = ringSectorGeometry();
    handPositions.forEach(([col, layer], i) => {
      const mesh = new THREE.Mesh(sectorGeometry, new THREE.MeshStandardMaterial({ color: i % 2 ? '#566970' : '#63777b', roughness: .42, metalness: .3, transparent: true, opacity: this.ringOpacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      mesh.name = `hand-slot-${col}-${layer}`;
      mesh.userData.hit = { kind: 'notes', lineIndex: col, lineLayer: layer } satisfies PreviewHit;
      this.ring.add(mesh); this.targets.push(mesh);
    });
    this.ring.position.y = stage.ringY; this.ring.scale.x = stage.ringScaleX;
    this.updateRing(0, false);
  }

  private updateRing(rotation: number, reverse: boolean) {
    const setting = `${rotation}:${reverse}`; if (setting === this.ringSetting) return; this.ringSetting = setting;
    this.ring.children.forEach((mesh, i) => {
      const a = handAngle(i, rotation, reverse); mesh.rotation.z = a;
    });
  }
  setDepthScale(value: number) {
    if (!Number.isFinite(value)) return;
    this.depthScale = THREE.MathUtils.clamp(value, .25, 10);
    if (this.state) this.update(this.state);
  }
  private updateBeatLabels(beats: number[]) {
    while (this.beatLabels.length < beats.length) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.75, .38), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      mesh.name = 'ground-beat-label'; this.scene.add(mesh);
      this.beatLabels.push({ mesh, canvas, texture, value: NaN });
    }
    this.beatLabels.forEach((label, i) => {
      const beat = beats[i]; label.mesh.visible = beat !== undefined; if (beat === undefined) return;
      label.mesh.userData.beat = beat;
      label.mesh.position.set(-2.95, .18, noteDepth(beat, this.state!.beat, this.beatSpacing));
      if (label.value === beat) return;
      label.value = beat;
      const c = label.canvas.getContext('2d')!; c.clearRect(0, 0, 256, 128);
      c.font = 'bold 76px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.strokeStyle = '#0a171e'; c.lineWidth = 10; c.strokeText(String(beat), 128, 64);
      c.fillStyle = beat % 4 === 0 ? '#c5f7e5' : '#86b8ac'; c.fillText(String(beat), 128, 64);
      label.texture.needsUpdate = true;
    });
  }
  setNoteOpacity(hand: number, foot: number) {
    this.handOpacity = THREE.MathUtils.clamp(hand, 0, 1); this.footOpacity = THREE.MathUtils.clamp(foot, 0, 1);
    for (const [batch, opacity] of [[this.handBatch, this.handOpacity], [this.footBatch, this.footOpacity], [this.tailBatch, this.footOpacity * .5]] as const) {
      const material = batch.material;
      material.opacity = opacity; material.transparent = opacity < 1; material.depthWrite = opacity === 1; material.needsUpdate = true;
    }
    for (const label of this.footLabels) (label.mesh.material as THREE.Material).opacity = this.footOpacity;
    this.render();
  }
  setRingOpacity(opacity: number) {
    this.ringOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    this.ring.children.forEach(object => { ((object as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = this.ringOpacity; });
    this.render();
  }
  zoomCamera(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(offset); this.controls.update();
  }

  private updateFootLabels(feet: Instance[]) {
    while (this.footLabels.length < feet.length) {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.78, .4), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
      (mesh.material as THREE.Material).opacity = this.footOpacity;
      mesh.name = 'foot-track-label'; this.scene.add(mesh);
      this.footLabels.push({ mesh, canvas, texture, track: NaN, active: false });
    }
    this.footLabels.forEach((label, i) => {
      const note = feet[i]; label.active = !!note; label.mesh.visible = !!note; if (!note) return;
      label.mesh.position.copy(note.position); label.mesh.position.y += .30; label.mesh.position.z += .1; label.mesh.userData.index = note.hit!.index;
      const track = footTrack(note.hit!.lineIndex); label.mesh.userData.track = track;
      if (track === label.track) return; label.track = track;
      const c = label.canvas.getContext('2d')!; c.clearRect(0, 0, 256, 128); c.font = 'bold 86px Consolas, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.strokeStyle = '#10242ecc'; c.lineWidth = 8; c.strokeText(String(track), 128, 64); c.fillStyle = '#fff'; c.fillText(String(track), 128, 64); label.texture.needsUpdate = true;
    });
  }
  private itemCenter(kind: string, n: Item) {
    if (kind === 'events') return this.lighting.center(n.type, n.time);
    const xy = kind === 'notes' ? handWorldPosition(n.lineIndex, n.lineLayer, this.state!.ringRotation, this.state!.ringReverse) : kind === 'ringNotes' ? { x: footX(n.lineIndex), y: stage.footY + .15 } : obstacleBounds(n);
    if (!xy) return undefined;
    const z = noteDepth(n.time, this.state!.beat, this.beatSpacing);
    return new THREE.Vector3(xy.x, xy.y, kind !== 'notes' && Number(n.duration) > 0 ? Math.min(0, z) : z);
  }
  private updateSelection(state: ViewState, hands: Instance[], feet: Instance[], walls: Instance[]) {
    const refs = state.selections ?? [], selected = new Set(refs.map(s => `${s.kind}:${s.index}`));
    this.selectionEdges.forEach(edge => { edge.visible = false; }); this.markers.forEach(el => { el.hidden = true; }); this.quickGroup.hidden = true; this.quickJoin.hidden = true; this.quickFill.hidden = true; this.anchors = [];
    let count = 0, markerCount = 0;
    const addMarker = (text: string, cls: string, position: THREE.Vector3, offset: number) => {
      const el = this.markers[markerCount] ?? document.createElement('span');
      if (!this.markers[markerCount]) { this.markers.push(el); this.annotations.append(el); } markerCount++;
      el.textContent = text; el.className = cls; this.anchors.push({ el, position, offset });
    };
    const centers: THREE.Vector3[] = [];
    for (const [kind, records] of [['notes', hands], ['ringNotes', feet], ['obstacles', walls]] as const) for (const record of records) {
      if (!selected.has(`${kind}:${record.hit!.index}`)) continue;
      let edge = this.selectionEdges[count++];
      if (!edge) { edge = new THREE.LineSegments(this.edgeGeometry[kind], this.edgeMaterial); edge.name = 'selected-note-edge'; edge.renderOrder = 10; this.scene.add(edge); this.selectionEdges.push(edge); }
      edge.geometry = this.edgeGeometry[kind]; edge.visible = true; edge.position.copy(record.position); edge.quaternion.copy(record.rotation ?? quaternion); edge.scale.copy(record.scale ?? unit);
      edge.matrixAutoUpdate = false; edge.matrix.compose(record.position, record.rotation ?? quaternion, record.scale ?? unit);
      if (kind === 'notes') edge.matrix.premultiply(new THREE.Matrix4().makeScale(stage.ringScaleX, 1, 1));
      const center = this.itemCenter(kind, items(state.project, kind)[record.hit!.index!]);
      if (center) { centers.push(center); addMarker('✓', 'selection-marker', center, -16); }
    }
    const options = groupingOptions(state.project, refs);
    const canFill = refs.length === 2 && refs.every(r => r.kind === 'notes');
    if ((options.canCreate || options.canUngroup || canFill) && centers.length) {
      this.quickGroup.disabled = false; this.quickGroup.dataset.action = options.canUngroup ? 'ungroup' : 'create';
      this.quickGroup.textContent = options.canUngroup ? '取消组' : '＋ 打组';
      this.quickGroup.title = options.canUngroup ? '解散选中音符所属的组' : '以选中音符创建新组，支持红蓝混合';
      const visible = centers.filter(p => { const v = p.clone().project(this.camera); return v.z > -1 && v.z < 1 && Math.abs(v.x) < .9 && Math.abs(v.y) < .9; });
      if (visible.length) {
        const position = visible.reduce((a,b)=>a.add(b),new THREE.Vector3()).divideScalar(visible.length);
        if (options.canCreate || options.canUngroup) this.anchors.push({ el:this.quickGroup,position,offset:-72 });
        this.quickFill.style.marginLeft = options.canCreate || options.canUngroup ? '88px' : '0';
        if (canFill) this.anchors.push({ el: this.quickFill, position, offset: -72 });
        if(options.canJoin)this.anchors.push({ el:this.quickJoin,position,offset:-110 });
      }
    }
    for (const overlap of state.overlaps) {
      const note = items(state.project, overlap.kind)[overlap.indices[0]], dt = note.time - state.beat;
      if (dt > this.lookAhead || dt + Number(note.duration ?? 0) < -.2) continue;
      const center = this.itemCenter(overlap.kind, note);
      if (center) addMarker(`! beat ${Number(note.time.toFixed(5))} 音符重叠`, 'overlap-marker', center, -34);
    }
  }
  update(state: ViewState) {
    this.state = state;
    if (this.disposed || this.lost) return;
    this.updateRing(state.ringRotation, state.ringReverse); this.resize();
    this.obstacleTargets.forEach(pad => { pad.visible = state.mode === 'obstacles'; }); this.wallArea.visible = state.mode === 'obstacles';
    const hands: Instance[] = [], feet: Instance[] = [], tails: Instance[] = [], walls: Instance[] = [];
    const groups = new Map<string, { time: number; position: THREE.Vector3 }[]>();
    for (const kind of ['notes', 'ringNotes', 'obstacles'] as const) items(state.project, kind).forEach((n, index) => {
      const dt = n.time - state.beat, duration = Number(n.duration ?? 0);
      if (dt > this.lookAhead || dt + duration < -.2) return;
      const hit: PreviewHit = { kind, index, lineIndex: n.lineIndex, lineLayer: n.lineLayer ?? 0 };
      const color = n.type === 3 ? new THREE.Color('#c398eb') : handColors[n.type === 1 ? 1 : 0];
      if (kind === 'notes') {
        const pos = handWorldPosition(n.lineIndex, n.lineLayer, state.ringRotation, state.ringReverse); if (!pos) return;
        const position = new THREE.Vector3(pos.x, pos.y, noteDepth(n.time, state.beat, this.beatSpacing));
        // R = rotation around the ring center, then X scale to match the elliptical target ring.
        const angle = handAngle(handLane(n.lineIndex, n.lineLayer), state.ringRotation, state.ringReverse);
        hands.push({ position: new THREE.Vector3(0, stage.ringY, position.z), color, hit,
          rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle) });
        if (n.groupId) { const list = groups.get(n.groupId) ?? []; list.push({ time: n.time, position }); groups.set(n.groupId, list); }
      } else if (kind === 'ringNotes') {
        const hold = n.ringNoteType === 1;
        const z = hold ? Math.min(0, noteDepth(n.time, state.beat, this.beatSpacing)) : noteDepth(n.time, state.beat, this.beatSpacing);
        feet.push({ position: new THREE.Vector3(footX(n.lineIndex), stage.footY, z), color, hit });
        if (hold && duration > 0) {
          const extent = durationExtent(n, state.beat, this.beatSpacing);
          tails.push({ position: new THREE.Vector3(footX(n.lineIndex), stage.footY, extent.center), scale: new THREE.Vector3(1, 1, extent.length), color, hit });
        }
      } else {
        const extent = durationExtent(n, state.beat, this.beatSpacing), bounds = obstacleBounds(n);
        walls.push({ position: new THREE.Vector3(bounds.x, bounds.y, extent.center), scale: new THREE.Vector3(bounds.width, bounds.height, extent.length), color: amber, hit });
      }
    });
    this.handBatch.sync(hands); this.footBatch.sync(feet); this.tailBatch.sync(tails); this.wallBatch.sync(walls); this.wallWireBatch.sync(walls);
    this.lighting.update(state, this.beatSpacing, this.lookAhead);
    this.updateGroupAppearance(state, hands);
    this.updateFootLabels(feet); this.updateSelection(state, hands, feet, walls);
    const links: THREE.Vector3[] = [];
    for (const list of groups.values()) { list.sort((a, b) => a.time - b.time); for (let i = 1; i < list.length; i++) links.push(list[i - 1].position, list[i].position); }
    this.replaceLines(this.groupLines, links);
    const beatPoints: THREE.Vector3[] = [], beats: number[] = [];
    for (let b = Math.floor(state.beat); b <= state.beat + this.lookAhead; b++) { beats.push(b); const z = noteDepth(b, state.beat, this.beatSpacing); beatPoints.push(new THREE.Vector3(-2.5, .025, z), new THREE.Vector3(2.5, .025, z)); }
    // Integer beats keep their stronger lines and labels; subdivisions track SNAP.
    // Bound drawing cost for arbitrarily large custom denominators without changing snapping.
    const subdivisions: THREE.Vector3[] = [], firstTick = Math.ceil(state.beat * state.division), lastTick = Math.floor((state.beat + this.lookAhead) * state.division);
    const stride = Math.max(1, Math.ceil((lastTick - firstTick + 1) / 4096));
    for (let tick = firstTick; tick <= lastTick; tick += stride) {
      const b = tick / state.division; if (Math.abs(b - Math.round(b)) < 1e-8) continue;
      const z = noteDepth(b, state.beat, this.beatSpacing); subdivisions.push(new THREE.Vector3(-2.5, .026, z), new THREE.Vector3(2.5, .026, z));
    }
    this.snapLines.userData.step = 1 / state.division;
    this.replaceLines(this.snapLines, subdivisions);
    this.replaceLines(this.beatLines, beatPoints); this.updateBeatLabels(beats);
    const depth = Math.max(42, (this.lookAhead + 2) * this.beatSpacing + 12);
    this.floor.scale.y = depth / 42; this.floor.position.z = 6 - depth / 2;
    this.floorGrid.scale.z = Math.max(1, depth / 40); this.floorGrid.position.z = this.floor.position.z;
    const fog = this.scene.fog as THREE.Fog; fog.far = Math.max(43, this.lookAhead * this.beatSpacing + 15); fog.near = Math.max(20, fog.far * .48);
    this.camera.far = Math.max(100, depth + this.camera.position.length() + 50); this.camera.updateProjectionMatrix();
    this.hud.querySelector('.preview-beat')!.textContent = `BEAT ${state.beat.toFixed(2)} · 未来 ${Number(this.lookAhead.toFixed(2))} 拍`;
    this.canvas.dataset.visibleNotes = String(hands.length + feet.length); this.render();
  }
  private replaceLines(lines: THREE.LineSegments, points: THREE.Vector3[]) {
    const geometry = lines.geometry; const attribute = geometry.getAttribute('position');
    if (attribute && attribute.count === points.length) { points.forEach((p, i) => attribute.setXYZ(i, p.x, p.y, p.z)); attribute.needsUpdate = true; geometry.computeBoundingSphere(); }
    else { lines.geometry = new THREE.BufferGeometry().setFromPoints(points); geometry.dispose(); }
  }
  resize() {
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) { this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }
  render = () => {
    if (this.disposed || this.lost) return;
    this.camera.updateMatrixWorld(true);
    this.updateWallPreview();
    this.faceFootLabels();
    this.groupHeadMarkers.forEach(marker => marker.quaternion.copy(this.camera.quaternion));
    for (const label of this.beatLabels) label.mesh.quaternion.copy(this.camera.quaternion);
    this.scene.updateMatrixWorld(true); this.renderer.render(this.scene, this.camera);
    for (const { el, position, offset } of this.anchors) {
      const projected = position.clone().project(this.camera), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const x = (projected.x + 1) / 2 * w, y = (1 - projected.y) / 2 * h;
      el.hidden = projected.z < -1 || projected.z > 1 || x < 0 || x > w || y < 0 || y > h;
      el.style.left = `${Math.min(w - 70, Math.max(70, x))}px`; el.style.top = `${Math.max(26, y + offset)}px`;
    }
  };
  tick(now: number) {
    if (this.disposed || this.lost) return;
    const elapsed = Math.min(.05, Math.max(0, (now - this.previousTick) / 1000)); this.previousTick = now;
    if (this.keys.size && document.activeElement === this.canvas) {
      const forward = this.camera.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
      const right = forward.clone().cross(new THREE.Vector3(0, 1, 0));
      const move = new THREE.Vector3();
      if (this.keys.has('w')) move.add(forward); if (this.keys.has('s')) move.sub(forward);
      if (this.keys.has('d')) move.add(right); if (this.keys.has('a')) move.sub(right);
      if (this.rightHeld && this.keys.has('shift')) move.y -= 1;
      if (this.rightHeld && this.keys.has(' ')) move.y += 1;
      move.normalize().multiplyScalar(elapsed * 5); this.camera.position.add(move); this.controls.target.add(move);
    }
    this.controls.update();
  }
  resetCamera() {
    this.clearKeys(); this.controls.enableDamping = false; this.controls.update();
    const distance = Math.hypot(5.7, 11.9), pitch = Math.atan2(5.7, 11.9) + Math.PI / 18;
    this.controls.target.set(0, 1.1, -3.3); this.camera.position.set(0, 1.1 + Math.sin(pitch) * distance, -3.3 + Math.cos(pitch) * distance);
    this.controls.update(); this.controls.enableDamping = true; this.canvas.dataset.camera = 'center'; this.render();
  }
  focusLighting() {
    this.clearKeys(); this.controls.enableDamping = false; this.controls.update();
    const center = 4.4 + Math.max(0, this.lighting.trackCount - 10) * this.lighting.laneWidth / 2;
    this.camera.position.set(center, 10.8, 13.8); this.controls.target.set(center, .15, -3.8);
    this.controls.update(); this.controls.enableDamping = true; this.render();
  }
  visibleSelections(): Selection[] {
    if (!this.state) return [];
    const candidates = this.state.mode === 'events' ? this.lighting.visibleRecords() : (this.state.mode === 'obstacles' ? [this.wallBatch] : [this.handBatch, this.footBatch]).flatMap(batch => batch.records.flatMap(record => {
      const hit = record.hit!; const position = this.itemCenter(hit.kind, items(this.state!.project, hit.kind)[hit.index!]);
      return position ? [{ ref: { kind: hit.kind, index: hit.index! }, position }] : [];
    }));
    this.camera.updateMatrixWorld(true); const b = this.canvas.getBoundingClientRect();
    return candidates.filter(({ position }) => {
      const v = position.clone().project(this.camera); if(v.z < -1 || v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return false;
      const x = b.x + (v.x + 1) / 2 * b.width, y = b.y + (1 - v.y) / 2 * b.height;
      return document.elementFromPoint(x, y) === this.canvas;
    }).map(c=>c.ref);
  }
  private faceFootLabels() {
    const occupied: { x:number; y:number; w:number; h:number }[] = [];
    const selected = new Set((this.state?.selections ?? []).filter(s=>s.kind==='ringNotes').map(s=>s.index));
    const labels = [...this.footLabels].sort((a,b) => Number(selected.has(b.mesh.userData.index)) - Number(selected.has(a.mesh.userData.index)) || a.mesh.position.distanceToSquared(this.camera.position) - b.mesh.position.distanceToSquared(this.camera.position));
    for(const label of labels) {
      label.mesh.visible = false; if(!label.active)continue;
      label.mesh.quaternion.copy(this.camera.quaternion);
      const v = label.mesh.position.clone().project(this.camera), depth = -label.mesh.position.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
      const h = .4 * this.canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2) * depth), w=h*1.95;
      if(h<11 || v.z < -1 || v.z>1 || Math.abs(v.x)>1 || Math.abs(v.y)>1)continue;
      const rect={x:(v.x+1)/2*this.canvas.clientWidth,y:(1-v.y)/2*this.canvas.clientHeight,w,h};
      if(occupied.some(r=>Math.abs(r.x-rect.x)<(r.w+w)/2+3 && Math.abs(r.y-rect.y)<(r.h+h)/2+3))continue;
      occupied.push(rect); label.mesh.visible=true;
    }
  }
  private updateGroupAppearance(state: ViewState, hands: Instance[]) {
    this.groupEdges.forEach(edge=>{edge.visible=false;}); this.groupHeadMarkers.forEach(marker=>{marker.visible=false;});
    const heads=groupHeads(items(state.project,'notes')); let edgeIndex=0,headIndex=0;
    for(const record of hands) {
      const note=items(state.project,'notes')[record.hit!.index!]; if(!note.groupId)continue;
      for(const halo of [false,true]) {
        let edge=this.groupEdges[edgeIndex++];
        if(!edge){edge=new THREE.LineSegments(this.edgeGeometry.notes,halo?this.groupHaloMaterial:this.groupEdgeMaterial);edge.name=halo?'grouped-note-halo':'grouped-note-outline';this.scene.add(edge);this.groupEdges.push(edge);}
        edge.visible=true;edge.matrixAutoUpdate=false;edge.matrix.compose(record.position,record.rotation??quaternion,new THREE.Vector3(halo?1.012:1.002,halo?1.012:1.002,1.04));edge.matrix.premultiply(new THREE.Matrix4().makeScale(stage.ringScaleX,1,1));
      }
      if(heads.has(record.hit!.index!)) {
        let marker=this.groupHeadMarkers[headIndex++];
        if(!marker){marker=new THREE.Mesh(this.groupHeadGeometry,this.groupHeadMaterial);marker.name='group-head-marker';this.scene.add(marker);this.groupHeadMarkers.push(marker);}
        marker.position.copy(this.itemCenter('notes',note)!); marker.position.addScaledVector(this.camera.position.clone().sub(marker.position).normalize(),.24); marker.visible=true; marker.userData.index=record.hit!.index;
      }
    }
  }
  /** Raycast actual scene geometry, respecting camera orbit, zoom and perspective. */
  pick(x: number, y: number, layer: 'all' | 'targets' | 'notes' = 'all'): PreviewHit | undefined {
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2(x / this.canvas.clientWidth * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1), this.camera);
    const mode = this.state?.mode ?? 'notes';
    if (mode === 'events') return this.lighting.pick(this.raycaster, layer);
    const targets = mode === 'obstacles' ? [...this.wallAreaTargets, ...this.obstacleTargets] : mode === 'notes' ? this.targets : [];
    const noteMeshes = (mode === 'obstacles' ? [this.wallBatch] : mode === 'notes' ? [this.handBatch, this.footBatch, this.tailBatch, this.wallBatch] : []).map(b => b.mesh);
    const hits = layer === 'targets' ? this.raycaster.intersectObjects(targets, false) : this.raycaster.intersectObjects(noteMeshes, false);
    if (layer === 'all') hits.push(...this.raycaster.intersectObjects(targets, false));
    for (const hit of hits) {
      if (hit.instanceId !== undefined) { const batch = hit.object.userData.batch as InstanceBatch; const record = batch.records[hit.instanceId]; if (record?.hit) return record.hit; }
      if (hit.object.userData.hit) {
        const target = hit.object.userData.hit as PreviewHit;
        if (target.kind === 'obstacles') {
          if (hit.object.userData.wallArea) return { ...target, obstacleType: hit.point.y >= hit.object.position.y ? 1 : 0 };
          const center = this.screenPosition({ x: hit.object.position.x, y: hit.object.position.y + .035, z: hit.object.position.z });
          return { ...target, obstacleType: y < center.y ? 1 : 0 };
        }
        return target;
      }
    }
  }
  private hoverWall = (e: PointerEvent) => {
    if (e.buttons) { this.clearWallHover(); return; }
    const box = this.canvas.getBoundingClientRect(); this.wallHover = { x: e.clientX - box.left, y: e.clientY - box.top }; this.render();
  };
  private clearWallHover = () => { this.wallHover = undefined; if (this.wallPreview.visible) { this.wallPreview.visible = false; this.render(); } };
  private updateWallPreview() {
    this.wallPreview.visible = false;
    this.wallAreaTargets.forEach(plane => { (plane.material as THREE.MeshBasicMaterial).opacity = .018; });
    if (!this.wallHover || this.state?.mode !== 'obstacles' || this.rightHeld) return;
    const hit = this.pick(this.wallHover.x, this.wallHover.y, 'targets');
    if (hit?.kind !== 'obstacles') return;
    (this.wallAreaTargets[hit.lineIndex].material as THREE.MeshBasicMaterial).opacity = .065;
    const note = { time: snap(this.state.beat, this.state.division), lineIndex: hit.lineIndex, type: hit.obstacleType, width: 1, duration: defaultObstacleDuration };
    const bounds = obstacleBounds(note), extent = durationExtent(note, this.state.beat, this.beatSpacing);
    this.wallPreview.position.set(bounds.x, bounds.y, extent.center);
    this.wallPreview.scale.set(bounds.width, bounds.height, extent.length);
    this.wallPreview.userData.placement = note; this.wallPreview.visible = true;
  }
  /** Drag on the note's own depth plane, then snap to the format's valid positions. */
  dragPosition(x: number, y: number, kind: Kind, note: Item) {
    if (!this.state) return;
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2(x / this.canvas.clientWidth * 2 - 1, 1 - y / this.canvas.clientHeight * 2), this.camera);
    if (kind === 'events') { const hit = this.lighting.pick(this.raycaster, 'targets'); return hit ? { lineIndex: hit.lineIndex, lineLayer: 0, time: hit.time } : undefined; }
    const depth = kind === 'ringNotes' && note.ringNoteType === 1 ? Math.min(0, noteDepth(note.time, this.state.beat, this.beatSpacing)) : noteDepth(note.time, this.state.beat, this.beatSpacing);
    const point = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -depth), new THREE.Vector3());
    if (!point) return;
    if (kind === 'notes') {
      const angle = Math.atan2(point.y - stage.ringY, point.x / stage.ringScaleX);
      let closest = 0, distance = Infinity;
      handPositions.forEach((_, i) => {
        const delta = angle - handAngle(i, this.state!.ringRotation, this.state!.ringReverse);
        const d = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
        if (d < distance) { closest = i; distance = d; }
      });
      return { lineIndex: handPositions[closest][0], lineLayer: handPositions[closest][1] };
    }
    const lanes = kind === 'ringNotes' ? 36 : 4;
    return { lineIndex: THREE.MathUtils.clamp(Math.floor((point.x / stage.footWidth + .5) * lanes), 0, kind === 'obstacles' ? Math.max(0, 4 - Number(note.width || 1)) : 35), lineLayer: 0 };
  }
  /** Useful for positioning UI overlays and verifying pick/projection consistency. */
  screenPosition(position: { x: number; y: number; z: number }) {
    this.camera.updateMatrixWorld(true); const v = new THREE.Vector3(position.x, position.y, position.z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight };
  }
  private focusCanvas = (e: PointerEvent) => {
    if (e.button !== 1) this.canvas.focus({ preventScroll: true });
    if (e.button === 2) { this.rightHeld = true; if (e.shiftKey) this.keys.add('shift'); }
  };
  private releaseCamera = (e: MouseEvent) => { if (e.button === 2) this.rightHeld = false; };
  private keyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === 'shift') { this.keys.add(key); if (this.rightHeld) e.preventDefault(); return; }
    if (key === ' ' && this.rightHeld) { this.keys.add(key); e.preventDefault(); e.stopPropagation(); return; }
    // Editing shortcuts retain priority; camera height never uses Ctrl.
    if (e.ctrlKey || e.metaKey || e.altKey) { this.keys.clear(); return; }
    if (['w', 'a', 's', 'd'].includes(key)) { this.keys.add(key); e.preventDefault(); e.stopPropagation(); }
  };
  private keyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private clearKeys = () => { this.keys.clear(); this.rightHeld = false; };
  private contextLost = (e: Event) => { e.preventDefault(); this.lost = true; this.canvas.dataset.renderer = 'context-lost'; this.hud.textContent = '3D 上下文暂时丢失，等待浏览器恢复'; };
  private contextRestored = () => { this.lost = false; this.canvas.dataset.renderer = 'webgl'; this.hud.innerHTML = '<span class="preview-beat"></span>'; if (this.state) this.update(this.state); };
  dispose() {
    delete this.canvas.spatialPreview;
    this.disposed = true; this.controls.removeEventListener('change', this.render); this.controls.dispose();
    this.canvas.removeEventListener('keydown', this.keyDown); this.canvas.removeEventListener('keyup', this.keyUp); this.canvas.removeEventListener('blur', this.clearKeys); window.removeEventListener('blur', this.clearKeys); this.canvas.removeEventListener('pointerdown', this.focusCanvas);
    this.canvas.removeEventListener('pointermove', this.hoverWall); this.canvas.removeEventListener('pointerleave', this.clearWallHover);
    window.removeEventListener('mouseup', this.releaseCamera); this.canvas.removeEventListener('pointercancel', this.clearKeys);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scene.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m); if (object instanceof THREE.InstancedMesh) object.dispose(); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.beatLabels.forEach(label => label.texture.dispose()); this.padTextures.forEach(texture => texture.dispose()); this.footLabels.forEach(label => label.texture.dispose()); Object.values(this.edgeGeometry).forEach(g => g.dispose()); this.edgeMaterial.dispose(); this.lighting.disposeTextures(); this.groupEdgeMaterial.dispose(); this.groupHaloMaterial.dispose(); this.groupHeadGeometry.dispose(); this.groupHeadMaterial.dispose(); this.renderer.dispose(); this.hud.remove(); this.annotations.remove();
  }
}
