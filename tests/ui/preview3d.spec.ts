import { test, expect, type Page } from '@playwright/test';
import { selectLastVisibleNote, unitDepth, frontCamera } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操'); await unitDepth(page);
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
  await expect(page.locator('#song-name')).toHaveText('未命名歌曲'); await expect(page.locator('#note-count')).toHaveText('0');
  await expect(page.locator('#preview')).toHaveAttribute('data-renderer', 'webgl');
  await frontCamera(page);
}
async function slot(page: Page, column: number, layer: number) {
  return page.evaluate(async ([col, row]) => {
    const layoutPath = '/src/layout.ts';
    const spatialPreview = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!; const { handWorldPosition } = await import(layoutPath);
    return spatialPreview.screenPosition(handWorldPosition(col, row));
  }, [column, layer]);
}
async function camera(page: Page) {
  return page.evaluate(async () => { const spatialPreview = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!; return { position: spatialPreview.camera.position.toArray(), target: spatialPreview.controls.target.toArray(), distance: spatialPreview.camera.position.distanceTo(spatialPreview.controls.target) }; });
}

test('WebGL renders ten real 3D sectors, and all ten can be picked without using inner cells', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await fresh(page);
  const renderer = await page.evaluate(async () => { const p = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!; return { webgl: p.renderer.getContext() instanceof WebGL2RenderingContext, sectors: p.ring.children.length, types: p.ring.children.map((m: any) => m.geometry.type), perspective: p.camera.isPerspectiveCamera }; });
  expect(renderer.webgl).toBe(true); expect(renderer.perspective).toBe(true); expect(renderer.sectors).toBe(10); expect(renderer.types.every((s: string) => s === 'ExtrudeGeometry')).toBe(true);
  const box = await page.locator('#preview').boundingBox();
  const positions = [[0,2],[1,2],[2,2],[3,2],[3,1],[3,0],[2,0],[1,0],[0,0],[0,1]];
  for (const [col, layer] of positions) {
    const position = await slot(page, col, layer); await page.mouse.click(box!.x + position.x, box!.y + position.y);
    await expect(page.locator('#selection-count')).toHaveText('未选中');
    await selectLastVisibleNote(page);
    await expect(page.locator('[data-field="lineIndex"]')).toHaveValue(String(col)); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue(String(layer));
  }
  await expect(page.locator('#note-count')).toHaveText('10');
  // Property edits must not reintroduce either unused middle cell.
  await page.locator('[data-field="lineIndex"]').fill('1'); await page.locator('[data-field="lineIndex"]').dispatchEvent('change');
  await expect(page.locator('#toast')).toContainText('未使用'); await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('0');
  await page.locator('[data-field="lineIndex"]').fill('2'); await page.locator('[data-field="lineIndex"]').dispatchEvent('change');
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('0'); expect(errors).toEqual([]);
});

test('wheel seeks without zoom; orbit, zoom buttons, WASD, right-button Shift/Space and reset control the camera', async ({ page }) => {
  await fresh(page); const box = await page.locator('#preview').boundingBox(); const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  const before = await camera(page);
  await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.move(x + 100, y + 30, { steps: 12 }); await page.mouse.up({ button: 'right' });
  await expect.poll(async () => JSON.stringify((await camera(page)).position)).not.toBe(JSON.stringify(before.position));
  const orbited = await camera(page);
  await page.locator('#beat-input').focus(); await page.mouse.move(x, y); await page.mouse.wheel(0, -400);
  await expect.poll(async () => Number(await page.locator('#beat-input').inputValue())).toBeCloseTo(1, 2);
  expect((await camera(page)).distance).toBeCloseTo(orbited.distance, 4);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => Number(await page.locator('#beat-input').inputValue())).toBeCloseTo(.75, 2);
  await page.mouse.wheel(0, 400); await expect(page.locator('#beat-input')).toHaveValue('0.000');
  await page.locator('#camera-near').click();
  await expect.poll(async () => (await camera(page)).distance).toBeLessThan(orbited.distance - .1);
  await page.locator('#camera-far').click(); expect((await camera(page)).distance).toBeCloseTo(orbited.distance, 3);
  await page.locator('#preview').focus(); const oldTarget = (await camera(page)).target;
  await page.keyboard.down('w'); await page.waitForTimeout(200); await page.keyboard.up('w');
  expect((await camera(page)).target).not.toEqual(oldTarget);
  const startY = (await camera(page)).target[1];
  await page.keyboard.down('Shift'); await page.waitForTimeout(120); await page.keyboard.up('Shift');
  await page.keyboard.down('Control'); await page.waitForTimeout(120); await page.keyboard.up('Control');
  expect((await camera(page)).target[1]).toBeCloseTo(startY, 4);
  await page.mouse.move(x, y); await page.mouse.down({ button: 'right' });
  await page.keyboard.down('Shift'); await page.waitForTimeout(160); await page.keyboard.up('Shift');
  expect((await camera(page)).target[1]).toBeLessThan(startY - .2);
  const lowerY = (await camera(page)).target[1];
  await page.keyboard.down('Space'); await page.waitForTimeout(160);
  expect((await camera(page)).target[1]).toBeGreaterThan(lowerY + .2);
  await expect(page.locator('#beat-input')).toHaveValue('0.000');
  await page.mouse.up({ button: 'right' }); const releasedY = (await camera(page)).target[1];
  await page.waitForTimeout(120); expect((await camera(page)).target[1]).toBeCloseTo(releasedY, 4);
  await page.keyboard.up('Space');
  // Modifier chords must keep editing semantics and must not leave the camera moving.
  await page.keyboard.press('Control+s'); await expect(page.locator('#new-song-id')).toBeVisible();
  await page.locator('#close-modal').click();
  await page.locator('#preview').focus(); const stoppedY = (await camera(page)).position[1];
  await page.waitForTimeout(120); expect((await camera(page)).position[1]).toBeCloseTo(stoppedY, 4);
  await page.locator('#camera-reset').click(); await expect(page.locator('#preview')).toHaveAttribute('data-camera', 'center');
  await expect(page.locator('#note-count')).toHaveText('0');
  // Picking is done against the rotated camera, not old 2D pixel geometry.
  const position = await slot(page, 0, 2);  await page.mouse.click(box!.x + position.x, box!.y + position.y); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('0'); await expect(page.locator('[data-field="lineLayer"]')).toHaveValue('2');
});

test('playhead moves mesh depth, and the lower platform produces foot notes with 3D holds', async ({ page }) => {
  await fresh(page); await page.locator('#beat-input').fill('4'); await page.locator('#beat-input').dispatchEvent('change');
  await page.locator('#add-at-beat').click();
  const depth = () => page.evaluate(async () => { const spatialPreview = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!; const mesh = spatialPreview.scene.getObjectByName('hand-notes') as import('three').InstancedMesh; return mesh.instanceMatrix.array[14]; });
  await page.locator('#beat-input').fill('0'); await page.locator('#beat-input').dispatchEvent('change'); const distant = await depth();
  await page.locator('#beat-input').fill('2'); await page.locator('#beat-input').dispatchEvent('change'); expect(await depth()).toBeGreaterThan(distant);
  await page.locator('#beat-input').fill('4'); await page.locator('#beat-input').dispatchEvent('change'); expect(await depth()).toBeCloseTo(0);

  const box = await page.locator('#preview').boundingBox();
  const foot = await page.evaluate(async () => { const layoutPath = '/src/layout.ts'; const spatialPreview = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!; const { footX, stage } = await import(layoutPath); return spatialPreview.screenPosition({ x: footX(18), y: stage.footY - .1, z: .35 }); });
  await page.mouse.click(box!.x + foot.x, box!.y + foot.y); await selectLastVisibleNote(page, 'ringNotes');
  await expect(page.locator('[data-field="ringNoteType"]')).toBeVisible();
  await page.locator('[data-field="ringNoteType"]').fill('1'); await page.locator('[data-field="ringNoteType"]').dispatchEvent('change');
  await page.locator('[data-field="duration"]').fill('4'); await page.locator('[data-field="duration"]').dispatchEvent('change');
  const hold = await page.evaluate(async () => { const spatialPreview = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!; const mesh = spatialPreview.scene.getObjectByName('foot-holds') as import('three').InstancedMesh; return { count: mesh.count, length: mesh.instanceMatrix.array[10] }; });
  expect(hold.count).toBe(1); expect(hold.length).toBeGreaterThan(6);
  const pedal = await page.evaluate(async () => {
    const el = document.querySelector('#preview') as HTMLCanvasElement, p = el.spatialPreview!;
    const layoutPath = '/src/layout.ts'; const { footX, stage } = await import(layoutPath);
    const head = p.scene.getObjectByName('foot-notes') as import('three').InstancedMesh;
    const tail = p.scene.getObjectByName('foot-holds') as import('three').InstancedMesh;
    head.geometry.computeBoundingBox(); tail.geometry.computeBoundingBox();
    const bounds = head.geometry.boundingBox!, tailBounds = tail.geometry.boundingBox!;
    const point = p.screenPosition({ x: footX(24), y: stage.footY - .1, z: .35 });
    return { width: bounds.max.x - bounds.min.x, height: bounds.max.y - bounds.min.y,
      depth: bounds.max.z - bounds.min.z, platformWidth: stage.footWidth,
      tailWidth: tailBounds.max.x - tailBounds.min.x, target: p.pick(point.x, point.y, 'targets'),
      hit: p.pick(point.x, point.y, 'notes'), point };
  });
  expect(pedal.width / pedal.platformWidth).toBeCloseTo(.45);
  expect(pedal.width / pedal.depth).toBeCloseTo(1.8, 1);
  expect(pedal.height / pedal.width).toBeLessThan(.1);
  expect(pedal.tailWidth).toBeCloseTo(pedal.width);
  // The broad pedal covers another placement position; clicking that edge must select, not add.
  expect(pedal.target).toMatchObject({ kind: 'ringNotes', lineIndex: 24 });
  expect(pedal.hit).toMatchObject({ kind: 'ringNotes', lineIndex: 18 });
  await page.mouse.click(box!.x + pedal.point.x, box!.y + pedal.point.y);
  await expect(page.locator('#note-count')).toHaveText('2');
  await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('18');
  await page.keyboard.press('Delete'); await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('2');

  await page.locator('[data-mode="events"]').click(); await page.locator('#add-at-beat').click();
  await expect(page.locator('.preview-events')).toHaveCount(0);
  await page.locator('#beat-input').fill('5'); await page.locator('#beat-input').dispatchEvent('change'); await expect(page.locator('.preview-events')).toHaveCount(0);
  await page.locator('#beat-input').fill('4'); await page.locator('#beat-input').dispatchEvent('change');
  await page.locator('#camera-reset').click(); await page.screenshot({ path: 'test-results/editor-3d.png', fullPage: true });
});


test('song-panel difficulties and floating tools work with a timeline that resizes the 3D viewport', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('.scene-song #difficulties')).toBeVisible();
  await expect(page.locator('#add-difficulty, #mode-name')).toHaveCount(0);
  await expect(page.locator('.scene-song [data-create-mode="Ring"][data-create-difficulty="Hard"]')).toBeVisible();
  await expect(page.locator('.preview-panel #tools-panel')).toBeVisible();
  await expect(page.locator('.preview-panel #modal')).toHaveCount(1);
  const scene = await page.locator('#scene-workspace').boundingBox();
  expect(await page.locator('#preview').boundingBox()).toEqual(scene);
  expect(scene!.y).toBe(0); expect(scene!.height).toBe(1100);
  await expect(page.locator('#timeline-panel')).toBeHidden();
  await page.locator('#toggle-timeline').click();
  await expect(page.locator('#toggle-timeline')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#timeline-panel')).toBeVisible();
  const reduced = await page.locator('#preview').boundingBox(), drawer = await page.locator('#timeline-panel').boundingBox();
  expect(reduced!.height).toBeLessThan(scene!.height - 200);
  expect(reduced!.y + reduced!.height).toBeLessThanOrEqual(drawer!.y);
  const aspect = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.camera.aspect);
  expect(aspect).toBeCloseTo(reduced!.width / reduced!.height, 3);
  // Both windows remain operable with the timeline open.
  await page.locator('#division').selectOption('8');
  await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  await expect(page.locator('[data-field="time"]')).toHaveValue('0');
  await page.locator('#range-select').click(); await page.locator('#close-modal').click();
  await page.locator('#hide-timeline').click();
  await expect(page.locator('#timeline-panel')).toBeHidden();
  expect(await page.locator('#preview').boundingBox()).toEqual(scene);
  const tools = await page.locator('#tools-panel').boundingBox();
  const heading = await page.locator('#tools-handle').boundingBox();
  await page.mouse.move(heading!.x + 80, heading!.y + 20); await page.mouse.down();
  await page.mouse.move(heading!.x - 100, heading!.y + 100, { steps: 5 }); await page.mouse.up();
  const moved = await page.locator('#tools-panel').boundingBox();
  expect(moved!.x).toBeLessThan(tools!.x - 100);
  await page.locator('#toggle-tools').click(); await expect(page.locator('#tools-body')).toBeHidden();
  await page.locator('#toggle-tools').click(); await expect(page.locator('#tools-body')).toBeVisible();
  await page.locator('#tools-handle').dblclick({ position: { x: 80, y: 20 } });
  expect((await page.locator('#tools-panel').boundingBox())!.x).toBe(tools!.x);
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.locator('#preview').boundingBox()).toEqual(await page.locator('#scene-workspace').boundingBox());
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(720);
  await page.screenshot({ path: 'test-results/scene-workspace.png' });
});

test('transparent ring and hand-note sectors share geometry without arrow meshes; opacity changes preserve picking', async ({ page }) => {
  await fresh(page);
  await page.locator('#add-at-beat').click();
  const geometry = await page.evaluate(() => {
    const p = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!;
    const slot = p.ring.children[0] as import('three').Mesh;
    const material = slot.material as import('three').MeshStandardMaterial;
    const notes = p.scene.getObjectByName('hand-notes') as import('three').InstancedMesh;
    return { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite,
      shape: notes.geometry.type, equalProfile: JSON.stringify(Array.from(notes.geometry.getAttribute('position').array).filter((_, i) => i % 3 !== 2)) === JSON.stringify(Array.from(slot.geometry.getAttribute('position').array).filter((_, i) => i % 3 !== 2)),
      hasArrows: p.noteRoot.children.some(n => n.name.startsWith('direction-')) };
  });
  expect(geometry).toEqual({ transparent: true, opacity: .22, depthWrite: false, shape: 'ExtrudeGeometry', equalProfile: true, hasArrows: false });
  await selectLastVisibleNote(page);
  // Direction metadata remains editable and is not rewritten by the visual change.
  await page.locator('[data-field="cutDirection"]').fill('3'); await page.locator('[data-field="cutDirection"]').dispatchEvent('change');
  await page.locator('#view-settings').click(); await page.locator('#ring-opacity').fill('12'); await page.locator('#ring-opacity').dispatchEvent('input'); await page.locator('#view-apply').click();
  await page.locator('[data-field="time"]').fill('.25'); await page.locator('[data-field="time"]').dispatchEvent('change');
  const hit = await page.evaluate(async () => {
    const p = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!;
    const layoutPath = '/src/layout.ts'; const { handWorldPosition } = await import(layoutPath);
    const point = p.screenPosition({ ...handWorldPosition(0, 0), z: -.25 * 1.65 });
    return { hit: p.pick(point.x, point.y), opacity: p.ringOpacity };
  });
  expect(hit.opacity).toBe(.12); expect(hit.hit).toMatchObject({ kind: 'notes', index: 0, lineIndex: 0, lineLayer: 0 });
  await expect(page.locator('[data-field="cutDirection"]')).toHaveValue('3');
});
