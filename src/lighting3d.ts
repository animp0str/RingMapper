import * as THREE from 'three';
import { items, snap } from './model';
import type { ViewState, Selection } from './render';
import { defaultLightTracks, lightTracks, lightColor, lightAt, type LightTrack } from './lighting-data';
import type { PreviewHit } from './preview3d';

/** A real 3D event runway beside the note lanes. Native event type/value are preserved. */
export class LightingRunway {
  readonly root = new THREE.Group();
  readonly surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#1c3c37', transparent: true, opacity: .62, side: THREE.DoubleSide }));
  readonly guide = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#589078', transparent: true, opacity: .38 }));
  private bars: THREE.InstancedMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.26, .35, .055), new THREE.MeshBasicMaterial({ toneMapped: false }), 256);
  private dots: THREE.InstancedMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.085, 10, 8), new THREE.MeshBasicMaterial({ color: '#76f5b5', toneMapped: false }), 256);
  private speedColumns: THREE.InstancedMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.26,1,.055),new THREE.MeshBasicMaterial({color:'#52d69a',transparent:true,opacity:.2,depthWrite:false}),256);
  private selected: THREE.InstancedMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.31, .43, .095), new THREE.MeshBasicMaterial({ color: '#62ffd4', wireframe: true, depthTest: false }), 256);
  private stems = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#52d69a', transparent: true, opacity: .6 }));
  private effects = new Map<string, THREE.Object3D>();
  private labels: THREE.Sprite[] = [];
  private textures: THREE.Texture[] = [];
  private records: { index: number; position: THREE.Vector3; speed: boolean }[] = [];
  private tracks: LightTrack[] = [];
  private trackSignature = '';
  mapping = defaultLightTracks.map(t => ({ ...t }));
  private state?: ViewState;
  private spacing = 1;
  private ahead = 8;
  get trackCount() { return this.tracks.length; }
  readonly startX = 3.05;
  readonly laneWidth = .38;
  constructor() {
    this.root.name = 'lighting-runway'; this.surface.name = 'lighting-placement-surface'; this.surface.rotation.x = -Math.PI / 2;
    this.speedColumns.name = 'lighting-speed-fill'; this.speedColumns.count=0; this.speedColumns.frustumCulled=false;
    this.bars.name = 'lighting-events'; this.dots.name = 'lighting-speeds'; this.selected.name = 'selected-lighting-events';
    this.bars.count = this.dots.count = this.selected.count = 0;
    this.bars.frustumCulled = this.dots.frustumCulled = this.selected.frustumCulled = false;
    this.root.add(this.surface, this.guide, this.bars, this.dots, this.selected, this.stems, this.speedColumns);
    for (const key of ['left','right','main','rhythm','diamond','stars']) {
      let object: THREE.Object3D;
      if (key === 'stars') {
        const points = Array.from({ length: 80 }, (_, i) => new THREE.Vector3(Math.sin(i*7.13)*3, Math.cos(i*3.73)*2, -i%5));
        object = new THREE.Points(new THREE.BufferGeometry().setFromPoints(points),new THREE.PointsMaterial({color:'#6ee8b1',size:.07,transparent:true,depthWrite:false})); object.position.set(0,3,-12);
      } else {
        const points: THREE.Vector3[] = [];
        if(key==='left'||key==='right') for(let i=0;i<7;i++) { const x=key==='left'?-2.8:2.8; points.push(new THREE.Vector3(x,.1,-i*2),new THREE.Vector3(x,2.8,-i*2)); }
        else if(key==='diamond') { for(let i=0;i<4;i++) { const a=i*Math.PI/2,b=(i+1)*Math.PI/2;points.push(new THREE.Vector3(Math.cos(a)*2,Math.sin(a)*2,0),new THREE.Vector3(Math.cos(b)*2,Math.sin(b)*2,0)); } }
        else { const y=key==='main'?4.8:.12;points.push(new THREE.Vector3(-2.8,y,0),new THREE.Vector3(-2.8,y,-14),new THREE.Vector3(2.8,y,0),new THREE.Vector3(2.8,y,-14)); }
        object=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#70e8b8',transparent:true,opacity:.6,depthWrite:false}));
        if(key==='diamond')object.position.set(0,2.8,-12);
      }
      object.name=`light-effect-${key}`;object.visible=false;this.effects.set(key,object);this.root.add(object);
    }
  }
  private capacity(mesh: THREE.InstancedMesh, count: number) {
    if (count <= mesh.instanceMatrix.count) return mesh;
    const next = new THREE.InstancedMesh(mesh.geometry, mesh.material, 2 ** Math.ceil(Math.log2(count)));
    next.name = mesh.name; next.frustumCulled = false; this.root.remove(mesh); mesh.dispose(); this.root.add(next); return next;
  }
  private lines(mesh: THREE.LineSegments, points: THREE.Vector3[]) {
    const old = mesh.geometry; mesh.geometry = new THREE.BufferGeometry().setFromPoints(points); old.dispose();
  }
  update(state: ViewState, spacing: number, ahead: number) {
    this.state = state; this.spacing = spacing; this.ahead = ahead;
    this.tracks = lightTracks(items(state.project, 'events'), this.mapping);
    const signature = this.tracks.map(t => `${t.type}:${t.name}`).join('|');
    if (signature !== this.trackSignature) {
      this.trackSignature = signature;
      for (const label of this.labels) { this.root.remove(label); (label.material as THREE.SpriteMaterial).dispose(); }
      this.labels = []; this.textures.forEach(t => t.dispose()); this.textures = [];
      this.tracks.forEach((track, i) => {
        const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 384;
        const c = canvas.getContext('2d')!; c.fillStyle = '#132a24e8'; c.fillRect(0,0,100,384); c.fillStyle = track.speed ? '#6beaab' : '#e6ebcb'; c.font = 'bold 42px sans-serif'; c.textAlign = 'center';
        [...track.name].forEach((letter, j) => c.fillText(letter, 50, 52 + j * 49));
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.textures.push(texture);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); label.name = 'lighting-track-label'; label.scale.set(.30,1.15,1); label.position.set(this.startX + (i + .5) * this.laneWidth, .7, .9); this.root.add(label); this.labels.push(label);
      });
    }
    this.root.visible = true; this.labels.forEach(label => { label.visible = state.mode === 'events'; });
    this.surface.material.opacity = state.mode === 'events' ? .62 : .18;
    const depth = ahead * spacing, width = this.tracks.length * this.laneWidth;
    this.surface.scale.set(width, depth + .5, 1); this.surface.position.set(this.startX + width/2, .04, -depth/2 + .25);
    const points: THREE.Vector3[] = [];
    for(let lane=0;lane<=this.tracks.length;lane++) { const x=this.startX+lane*this.laneWidth; points.push(new THREE.Vector3(x,.055,.5),new THREE.Vector3(x,.055,-depth)); }
    const step = Math.max(1/state.division, ahead/512);
    for(let tick=Math.ceil(state.beat/step);tick*step<=state.beat+ahead;tick++) { const z=(state.beat-tick*step)*spacing; points.push(new THREE.Vector3(this.startX,.06,z),new THREE.Vector3(this.startX+width,.06,z)); }
    this.lines(this.guide,points);
    const events = items(state.project,'events'); this.records = [];
    events.forEach((event,index)=>{ const lane=this.tracks.findIndex(t=>t.type===event.type); if(lane<0||event.time<state.beat-.1||event.time>state.beat+ahead)return;
      const speed=this.tracks[lane].speed, height=speed?.16+THREE.MathUtils.clamp(event.value,0,6)/6*1.1:.25;
      this.records.push({ index, speed, position:new THREE.Vector3(this.startX+(lane+.5)*this.laneWidth,height,(state.beat-event.time)*spacing) });
    });
    this.bars=this.capacity(this.bars,this.records.length||1); this.dots=this.capacity(this.dots,this.records.length||1); this.selected=this.capacity(this.selected,this.records.length||1); this.speedColumns=this.capacity(this.speedColumns,this.records.length||1);
    this.bars.count=this.dots.count=this.selected.count=this.speedColumns.count=0;
    const stems:THREE.Vector3[]=[], barRefs:number[]=[], dotRefs:number[]=[], matrix=new THREE.Matrix4();
    for(const record of this.records) {
      const mesh=record.speed?this.dots:this.bars, event=events[record.index], instance=mesh.count++;
      matrix.makeTranslation(record.position.x,record.position.y,record.position.z); mesh.setMatrixAt(instance,matrix); mesh.setColorAt(instance,new THREE.Color(record.speed?'#70efad':lightColor(event.value)));
      (record.speed?dotRefs:barRefs).push(record.index);
      if(record.speed) { stems.push(new THREE.Vector3(record.position.x,.06,record.position.z),record.position.clone()); const m=new THREE.Matrix4().makeScale(1,record.position.y-.06,1);m.setPosition(record.position.x,(record.position.y+.06)/2,record.position.z);this.speedColumns.setMatrixAt(this.speedColumns.count++,m); }
      if(state.selections?.some(s=>s.kind==='events'&&s.index===record.index))this.selected.setMatrixAt(this.selected.count++,matrix);
    }
    for(const [key,object] of this.effects) {
      const type=this.mapping.find(t=>t.key===key)?.type, stateAt=type===undefined?{intensity:0,color:'#000000'}:lightAt(events,type,state.beat);
      object.visible=stateAt.intensity>0;
      const material=(object as THREE.LineSegments).material as THREE.LineBasicMaterial;material.color.set(stateAt.color);material.opacity=stateAt.intensity*.65;
      const speedType=this.mapping.find(t=>t.key===`${key}-speed`)?.type;
      const speed=speedType===undefined?0:Math.min(6,lightAt(events,speedType,state.beat).value);
      if(key==='diamond'||key==='stars')object.rotation.z=state.beat*speed*.08;
      if(key==='left'||key==='right')object.rotation.y=Math.sin(state.beat*speed*.12)*.09;
    }
    this.bars.userData.indices=barRefs; this.dots.userData.indices=dotRefs; this.speedColumns.userData.indices=dotRefs; this.lines(this.stems,stems);
    for(const mesh of [this.bars,this.dots,this.selected,this.speedColumns]) { mesh.instanceMatrix.needsUpdate=true; if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true; mesh.computeBoundingSphere(); }
  }
  pick(raycaster:THREE.Raycaster, layer:'all'|'targets'|'notes'): PreviewHit|undefined {
    if(!this.state)return;
    if(layer!=='targets') { const hit=raycaster.intersectObjects([this.bars,this.dots,this.speedColumns],false)[0]; if(hit?.instanceId!==undefined) { const index=hit.object.userData.indices[hit.instanceId], event=items(this.state.project,'events')[index]; return {kind:'events',index,lineIndex:event.type,lineLayer:0,time:event.time}; } }
    if(layer==='notes')return;
    const hit=raycaster.intersectObject(this.surface,false)[0]; if(!hit)return;
    const lane=Math.floor((hit.point.x-this.startX)/this.laneWidth),track=this.tracks[lane]; if(!track)return;
    return {kind:'events',lineIndex:track.type,lineLayer:0,time:snap(Math.max(0,this.state.beat-hit.point.z/this.spacing),this.state.division)};
  }
  visibleRecords() { return this.records.map(r=>({ ref:{kind:'events',index:r.index} as Selection, position:r.position })); }
  center(type:number,time:number) { const lane=this.tracks.findIndex(t=>t.type===type); return new THREE.Vector3(this.startX+(lane+.5)*this.laneWidth,.3,((this.state?.beat??0)-time)*this.spacing); }
  disposeTextures() { this.textures.forEach(t=>t.dispose()); }
}
