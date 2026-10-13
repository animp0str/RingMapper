import { test, expect, type Page } from './fixtures';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { parse } from 'yaml';
import { selectLastVisibleNote } from './helpers';
async function exported(page: Page, filename: string) { const pending=page.waitForEvent('download'); await page.locator('#export').click(); const download=await pending; const zip=await JSZip.loadAsync(await fs.readFile((await download.path())!)); return parse(await zip.file(filename)!.async('string')); }
async function fresh(page: Page) { await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await page.locator('#new-project').click(); await page.locator('#apply-settings').click(); }
async function point(page: Page, position: {x:number;y:number;z:number}) { return page.locator('#preview').evaluate((el:HTMLCanvasElement,position)=>{const p=el.spatialPreview!.screenPosition(position),b=el.getBoundingClientRect();return{x:b.x+p.x,y:b.y+p.y};},position); }
async function hand(page:Page,col:number,row:number){ return page.locator('#preview').evaluate(async(el:HTMLCanvasElement,[col,row])=>{const module='/src/layout.ts',{handWorldPosition}=await import(module),p=el.spatialPreview!.screenPosition(handWorldPosition(col,row)),b=el.getBoundingClientRect();return{x:b.x+p.x,y:b.y+p.y};},[col,row]); }
async function click(page:Page,p:{x:number;y:number}){await page.mouse.click(p.x,p.y);}
async function beat(page:Page,value:number){await page.locator('#beat-input').fill(String(value));await page.keyboard.press('Enter');}

test('transport restores 1x without stopping and bookmark shortcut shows permanent seek markers with undo',async({page})=>{
  await fresh(page); await expect(page.locator('#speed-reset')).toBeHidden();
  await page.locator('#speed').fill('0.73');await page.locator('#speed').dispatchEvent('input');await expect(page.locator('#speed-reset')).toBeVisible();
  await page.locator('#play').click();await page.waitForTimeout(160);const before=Number(await page.locator('#beat-input').inputValue());
  await page.locator('#speed-reset').click();await expect(page.locator('#speed')).toHaveValue('1');await expect(page.locator('#speed-reset')).toBeHidden();await expect(page.locator('#play .lucide-pause')).toBeVisible();
  expect(Number(await page.locator('#beat-input').inputValue())).toBeGreaterThanOrEqual(before);await page.keyboard.press('Space');
  await beat(page,3.125);await page.keyboard.press('Control+b');await expect(page.locator('.seek-bookmark')).toHaveCount(1);await expect(page.locator('.seek-bookmark')).toHaveAttribute('title',/3.125/);
  await beat(page,8);await page.keyboard.press('Control+b');await expect(page.locator('.seek-bookmark')).toHaveCount(2);
  await page.locator('#toggle-timeline').click();await expect(page.locator('.seek-bookmark').first()).toBeVisible();await page.locator('.seek-bookmark').first().click();await expect(page.locator('#beat-input')).toHaveValue('3.125');
  await page.locator('#undo').click();await expect(page.locator('.seek-bookmark')).toHaveCount(1);
  expect((await exported(page,'Ring/NormalRing.yaml')).customData.bookmarks).toEqual([{time:3.125,name:'书签 1'}]);
});

test('mixed red-blue groups have a head ring and subtle outline, allow joining, ungroup from a single member, and Ctrl+A is visibility scoped',async({page})=>{
  await fresh(page);const first=await hand(page,0,0),second=await hand(page,3,0),third=await hand(page,1,0);
  await click(page,first);await page.keyboard.press('q');await click(page,second);
  await click(page,first);await page.keyboard.down('Shift');await click(page,second);await page.keyboard.up('Shift');
  await expect(page.locator('#quick-group')).toHaveText('＋ 打组');await page.locator('#quick-group').click();await expect(page.locator('#quick-group')).toHaveText('取消组');await expect(page.locator('#group')).toBeHidden();
  const appearance=await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>{const children=el.spatialPreview!.scene.children;return{heads:children.filter(n=>n.name==='group-head-marker'&&n.visible).length,outlines:children.filter(n=>n.name==='grouped-note-outline'&&n.visible).length,groupOpacity:((children.find(n=>n.name==='grouped-note-outline') as any).material.opacity),selectionOpacity:((children.find(n=>n.name==='selected-note-edge') as any).material.opacity)};});
  expect(appearance.heads).toBe(1);expect(appearance.outlines).toBe(2);expect(appearance.groupOpacity).toBeLessThan(appearance.selectionOpacity/2);
  await click(page,third);await click(page,first);await page.keyboard.down('Shift');await click(page,third);await page.keyboard.up('Shift');
  await expect(page.locator('#quick-join-group')).toBeVisible();await expect(page.locator('#quick-group')).toHaveText('＋ 打组');await page.locator('#quick-join-group').click();
  const grouped=(await exported(page,'Ring/NormalRing.yaml')).notes; expect(new Set(grouped.map((n:any)=>n.groupId)).size).toBe(1); expect(new Set(grouped.map((n:any)=>n.type)).size).toBe(2); expect(grouped.filter((n:any)=>n.groupNoteType===1)).toHaveLength(1); expect(grouped.filter((n:any)=>n.groupNoteType===2)).toHaveLength(1);
  await click(page,first);await expect(page.locator('#quick-group')).toHaveText('取消组');await page.locator('#quick-group').click();await expect(page.locator('[data-field="groupId"]')).toHaveValue('');
  await expect(page.locator('#ungroup')).toHaveCount(0);await page.locator('#undo').click();
  await beat(page,20);await page.locator('#add-at-beat').click();await beat(page,0);await page.keyboard.press('Control+a');await expect(page.locator('#selection-count')).toHaveText('已选 3 项');
  await click(page,first);await page.keyboard.press('Control+f');await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('3');await expect(page.locator('[data-field="type"]')).toHaveValue('0');
  await page.screenshot({path:'test-results/group-head-and-glow.png'});
});

test('foot track labels face the camera and overlapping labels are culled, camera reset adds ten degrees downward',async({page})=>{
  await fresh(page);await page.locator('#add-foot').click();await selectLastVisibleNote(page,'ringNotes');await page.locator('[data-field="lineIndex"]').fill('17');await page.locator('[data-field="lineIndex"]').dispatchEvent('change');
  await page.keyboard.press('Escape');await page.locator('#add-foot').click();await selectLastVisibleNote(page,'ringNotes');await page.locator('[data-field="lineIndex"]').fill('18');await page.locator('[data-field="lineIndex"]').dispatchEvent('change');
  const labels=await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>{const p=el.spatialPreview!,labels=p.scene.children.filter(n=>n.name==='foot-track-label'),delta=p.camera.position.clone().sub(p.controls.target);return{total:labels.length,visible:labels.filter(n=>n.visible).length,facing:labels.every(n=>Math.abs(n.quaternion.dot(p.camera.quaternion))>.999),pitch:Math.atan2(delta.y,Math.hypot(delta.x,delta.z))*180/Math.PI};});
  expect(labels.total).toBe(2);expect(labels.visible).toBe(1);expect(labels.facing).toBe(true);expect(labels.pitch).toBeCloseTo(Math.atan2(5.7,11.9)*180/Math.PI+10);
});

test('wall placement fills the ring-sized front rectangle and switches type at its middle divider',async({page})=>{
  await fresh(page);await page.keyboard.press('2');
  for(const [lane,y,type]of [[0,3.8,1],[1,.9,0]]){
    const pos=await point(page,{x:(lane-1.5)*4.6/4,y,z:.08});await page.mouse.move(pos.x,pos.y);
    const ghost=await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>{const m=el.spatialPreview!.scene.getObjectByName('wall-placement-preview')!;return{visible:m.visible,note:m.userData.placement};});
    expect(ghost.visible).toBe(true);expect(ghost.note).toMatchObject({lineIndex:lane,type,duration:.04,width:1});await click(page,pos);
  }
  expect(await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>(el.spatialPreview!.scene.getObjectByName('obstacles') as any).count)).toBe(2);
  await page.screenshot({path:'test-results/large-wall-placement.png'});
});

test('ten 3D lighting lanes place native events, speed dots show levels, events can be selected, edited, dragged and deleted',async({page})=>{
  await fresh(page);const spacing=await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>el.spatialPreview!.beatSpacing);await page.keyboard.press('3');await page.locator('#light-focus').click();await expect(page.locator('#light-track option')).toHaveCount(10);
  await page.locator('#light-value').selectOption('5');
  const location=await point(page,{x:3.05+1.5*.38,y:.04,z:-2*spacing});await click(page,location);
  expect(await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>(el.spatialPreview!.scene.getObjectByName('lighting-events') as any).count)).toBe(1);
  const eventPoint=await point(page,{x:3.05+1.5*.38,y:.25,z:-2*spacing});await click(page,eventPoint);
  await expect(page.locator('[data-field="type"]')).toHaveValue('2');await expect(page.locator('[data-field="value"]')).toHaveValue('5');await expect(page.locator('[data-field="time"]')).toHaveValue('2');
  await page.locator('[data-field="value"]').selectOption('6');await page.keyboard.press('Escape');
  await page.locator('#light-track').selectOption('3');await page.locator('#light-value').selectOption('6');
  const speedPoint=await point(page,{x:3.05+.5*.38,y:.04,z:-1*spacing});await click(page,speedPoint);
  expect(await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>(el.spatialPreview!.scene.getObjectByName('lighting-speeds') as any).count)).toBe(1);
  const dot=await point(page,{x:3.05+.5*.38,y:1.26,z:-spacing});await click(page,dot);await expect(page.locator('[data-field="value"]')).toHaveValue('6');
  const moved=await point(page,{x:3.05+3.5*.38,y:.04,z:-3*spacing});await page.keyboard.down('Alt');await page.mouse.move(dot.x,dot.y);await page.mouse.down();await page.mouse.move(moved.x,moved.y,{steps:8});await page.mouse.up();await page.keyboard.up('Alt');
  await expect(page.locator('[data-field="type"]')).toHaveValue('5');await expect(page.locator('[data-field="time"]')).toHaveValue('3');
  await page.locator('#undo').click();await beat(page,2);expect(await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>el.spatialPreview!.scene.getObjectByName('light-effect-left')!.visible)).toBe(true);
  await beat(page,0);await page.keyboard.press('Control+a');await expect(page.locator('#selection-count')).toHaveText('已选 2 项');await page.locator('#delete').click();
  expect(await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>(el.spatialPreview!.scene.getObjectByName('lighting-events') as any).count)).toBe(0);
  await page.locator('#undo').click();await page.keyboard.press('Escape');await page.locator('#light-mapping').click();await expect(page.locator('[data-light-map]')).toHaveCount(10);await page.locator('[data-light-map="left"]').fill('101');await page.locator('#light-map-apply').click();
  await expect(page.locator('#light-track option[value="101"]')).toHaveText('左侧灯光');await expect(page.locator('#light-track option[value="2"]')).toHaveText('扩展 2');
  expect((await exported(page,'Ring/NormalRingEvent.yaml')).events).toEqual([{time:1,type:3,value:6},{time:2,type:2,value:6}]);
  await page.screenshot({path:'test-results/lighting-runway.png'});
});

test('song information copies plain text, difficulty modes live in the song panel, and opacity only appears in settings',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await page.goto('/');await expect(page.locator('#song-name')).toHaveText('曹操');
  await expect(page.locator('.library #difficulties')).toHaveCount(0);await expect(page.locator('.scene-song [data-difficulty-mode="Ring"]')).toBeVisible();await expect(page.locator('.scene-song [data-difficulty-mode="RingDance"]')).toBeVisible();
  await expect(page.locator('.scene-camera #ring-opacity')).toHaveCount(0);await expect(page.locator('#view-settings')).toHaveText('设置');
  await page.locator('#song-name').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=window.getSelection()!;s.removeAllRanges();s.addRange(r);});
  await page.keyboard.press('Control+c');expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('曹操');
  await page.evaluate(()=>window.getSelection()?.removeAllRanges());await page.locator('#view-settings').click();await page.locator('#ring-opacity').fill('37');await page.locator('#ring-opacity').dispatchEvent('input');await page.locator('#view-apply').click();
  expect(await page.locator('#preview').evaluate((el:HTMLCanvasElement)=>el.spatialPreview!.ringOpacity)).toBe(.37);
  await page.locator('#view-settings').click();await expect(page.locator('#ring-opacity')).toHaveValue('37');await page.locator('#view-apply').click();
});
