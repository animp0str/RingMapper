import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { items, type Kind, type Item } from './model';
import type { ViewState } from './render';
import { handPositions, handLane, handAngle, handWorldPosition, footX, noteDepth, durationExtent, stage, footNoteSize } from './layout';

declare global { interface HTMLCanvasElement { spatialPreview?: SpatialPreview } }

export type PreviewHit = { kind: Kind; lineIndex: number; lineLayer: number; index?: number };
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
  lookAhead = 8;
  depthScale = 1;
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
  private keys = new Set<string>();
  private previousTick = 0;
  private lost = false;
  private disposed = false;
  private hud: HTMLDivElement;
  private eventHud: HTMLDivElement;
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
    this.scene.add(this.ring, this.noteRoot, this.groupLines, this.beatLines);
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
    this.hud.innerHTML = '<span>WEBGL · 10 POSITIONS</span><span class="preview-beat">BEAT 0.00</span>';
    this.eventHud = document.createElement('div'); this.eventHud.className = 'preview-events'; this.eventHud.hidden = true;
    canvas.parentElement!.append(this.hud, this.eventHud);
    canvas.dataset.renderer = 'webgl'; canvas.dataset.handPositions = '10';
    canvas.addEventListener('keydown', this.keyDown); canvas.addEventListener('keyup', this.keyUp);
    canvas.addEventListener('blur', this.clearKeys); window.addEventListener('blur', this.clearKeys);
    canvas.addEventListener('pointerdown', this.focusCanvas);
    window.addEventListener('mouseup', this.releaseCamera);
    canvas.addEventListener('pointercancel', this.clearKeys);
    canvas.addEventListener('webglcontextlost', this.contextLost); canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.setCamera('perspective'); this.resize(); this.canvas.spatialPreview = this;
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
    this.depthScale = THREE.MathUtils.clamp(value, .25, 3);
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
  setRingOpacity(opacity: number) {
    this.ringOpacity = THREE.MathUtils.clamp(opacity, .05, .6);
    this.ring.children.forEach(object => { ((object as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = this.ringOpacity; });
    this.render();
  }
  zoomCamera(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.camera.position.copy(this.controls.target).add(offset); this.controls.update();
  }

  update(state: ViewState) {
    this.state = state;
    if (this.disposed || this.lost) return;
    this.updateRing(state.ringRotation, state.ringReverse); this.resize();
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
        const extent = durationExtent(n, state.beat, this.beatSpacing), width = Math.max(.1, Number(n.width) * stage.footWidth / 4);
        walls.push({ position: new THREE.Vector3(-stage.footWidth / 2 + n.lineIndex * stage.footWidth / 4 + width / 2, 1.7, extent.center), scale: new THREE.Vector3(width, 3.1, extent.length), color: amber, hit });
      }
    });
    this.handBatch.sync(hands); this.footBatch.sync(feet); this.tailBatch.sync(tails); this.wallBatch.sync(walls); this.wallWireBatch.sync(walls);
    const links: THREE.Vector3[] = [];
    for (const list of groups.values()) { list.sort((a, b) => a.time - b.time); for (let i = 1; i < list.length; i++) links.push(list[i - 1].position, list[i].position); }
    this.replaceLines(this.groupLines, links);
    const beatPoints: THREE.Vector3[] = [], beats: number[] = [];
    for (let b = Math.floor(state.beat); b <= state.beat + this.lookAhead; b++) { beats.push(b); const z = noteDepth(b, state.beat, this.beatSpacing); beatPoints.push(new THREE.Vector3(-2.5, .025, z), new THREE.Vector3(2.5, .025, z)); }
    this.replaceLines(this.beatLines, beatPoints); this.updateBeatLabels(beats);
    const depth = Math.max(42, (this.lookAhead + 2) * this.beatSpacing + 12);
    this.floor.scale.y = depth / 42; this.floor.position.z = 6 - depth / 2;
    this.floorGrid.scale.z = Math.max(1, depth / 40); this.floorGrid.position.z = this.floor.position.z;
    const fog = this.scene.fog as THREE.Fog; fog.far = Math.max(43, this.lookAhead * this.beatSpacing + 15); fog.near = Math.max(20, fog.far * .48);
    this.hud.querySelector('.preview-beat')!.textContent = `BEAT ${state.beat.toFixed(2)} · 未来 ${this.lookAhead} 拍`;
    const events = items(state.project, 'events').filter(n => n.time <= state.beat && n.time >= state.beat - .3);
    this.eventHud.hidden = events.length === 0; this.eventHud.textContent = events.length ? `事件 ${events.slice(-8).map(n => `${n.type}:${n.value}`).join(' · ')}` : '';
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
    for (const label of this.beatLabels) label.mesh.quaternion.copy(this.camera.quaternion);
    this.scene.updateMatrixWorld(true); this.renderer.render(this.scene, this.camera);
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
  setCamera(preset: 'perspective' | 'front' | 'top') {
    this.clearKeys(); this.controls.enableDamping = false; this.controls.update();
    const positions = { perspective: [4.6, 4.5, 8.8], front: [0, 2.3, 10.5], top: [0, 12, 2] };
    this.camera.position.fromArray(positions[preset]);
    this.controls.target.set(0, preset === 'top' ? .7 : 2, preset === 'front' ? 0 : -2.2);
    this.controls.update(); this.controls.enableDamping = true; this.canvas.dataset.camera = preset; this.render();
  }
  /** Raycast actual scene geometry, respecting camera orbit, zoom and perspective. */
  pick(x: number, y: number, layer: 'all' | 'targets' | 'notes' = 'all'): PreviewHit | undefined {
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2(x / this.canvas.clientWidth * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1), this.camera);
    const noteMeshes = [this.handBatch, this.footBatch, this.tailBatch, this.wallBatch].map(b => b.mesh);
    const hits = layer === 'targets' ? this.raycaster.intersectObjects(this.targets, false) : this.raycaster.intersectObjects(noteMeshes, false);
    if (layer === 'all') hits.push(...this.raycaster.intersectObjects(this.targets, false));
    for (const hit of hits) {
      if (hit.instanceId !== undefined) { const batch = hit.object.userData.batch as InstanceBatch; const record = batch.records[hit.instanceId]; if (record?.hit) return record.hit; }
      if (hit.object.userData.hit) return hit.object.userData.hit as PreviewHit;
    }
  }
  /** Drag on the note's own depth plane, then snap to the format's valid positions. */
  dragPosition(x: number, y: number, kind: Kind, note: Item) {
    if (!this.state || kind === 'events') return;
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2(x / this.canvas.clientWidth * 2 - 1, 1 - y / this.canvas.clientHeight * 2), this.camera);
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
  private contextLost = (e: Event) => { e.preventDefault(); this.lost = true; this.eventHud.hidden = true; this.canvas.dataset.renderer = 'context-lost'; this.hud.textContent = '3D 上下文暂时丢失，等待浏览器恢复'; };
  private contextRestored = () => { this.lost = false; this.canvas.dataset.renderer = 'webgl'; this.hud.innerHTML = '<span>WEBGL · 10 POSITIONS</span><span class="preview-beat"></span>'; if (this.state) this.update(this.state); };
  dispose() {
    delete this.canvas.spatialPreview;
    this.disposed = true; this.controls.removeEventListener('change', this.render); this.controls.dispose();
    this.canvas.removeEventListener('keydown', this.keyDown); this.canvas.removeEventListener('keyup', this.keyUp); this.canvas.removeEventListener('blur', this.clearKeys); window.removeEventListener('blur', this.clearKeys); this.canvas.removeEventListener('pointerdown', this.focusCanvas);
    window.removeEventListener('mouseup', this.releaseCamera); this.canvas.removeEventListener('pointercancel', this.clearKeys);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scene.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.geometry) geometries.add(mesh.geometry); if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m); if (object instanceof THREE.InstancedMesh) object.dispose(); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.beatLabels.forEach(label => label.texture.dispose()); this.renderer.dispose(); this.hud.remove(); this.eventHud.remove();
  }
}
