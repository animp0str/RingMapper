import { type Page } from '@playwright/test';

/** Explicit selection through the canvas: creation itself must never select the new note. */
export async function selectLastVisibleNote(page: Page, kind: 'notes' | 'ringNotes' = 'notes') {
  const point = await page.evaluate(async kind => {
    const p = (document.querySelector('#preview') as HTMLCanvasElement).spatialPreview!;
    const layoutPath = '/src/layout.ts'; const { handWorldPosition, footX, stage } = await import(layoutPath);
    const mesh = p.scene.getObjectByName(kind === 'notes' ? 'hand-notes' : 'foot-notes') as import('three').InstancedMesh;
    const record = mesh.userData.batch.records.at(-1);
    if (!record) throw new Error('No visible note to select');
    const xy = kind === 'notes' ? handWorldPosition(record.hit.lineIndex, record.hit.lineLayer) : { x: footX(record.hit.lineIndex), y: stage.footY };
    return p.screenPosition({ ...xy, z: mesh.instanceMatrix.array[(mesh.count - 1) * 16 + 14] });
  }, kind);
  const box = await page.locator('#preview').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.click(box!.x + point.x, box!.y + point.y);
  await page.keyboard.up('Alt');
}

/** Stable scale for existing screen-coordinate interaction fixtures. Defaults are covered separately. */
export async function unitDepth(page: Page) {
  await page.locator('#depth-zoom').evaluate((el: HTMLInputElement) => { el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
}

/** A stable frontal camera fixture for geometric picking tests, independent of product presets. */
export async function frontCamera(page: Page) {
  await page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const p = el.spatialPreview!; p.controls.enableDamping = false; p.controls.update();
    p.camera.position.set(0, 2.3, 10.5); p.controls.target.set(0, 2, 0); p.controls.update(); p.controls.enableDamping = true; p.render();
  });
}
