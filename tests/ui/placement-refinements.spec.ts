import { test, expect, type Page } from '@playwright/test';
import { selectLastVisibleNote } from './helpers';

async function fresh(page: Page) {
  await page.goto('/'); await expect(page.locator('#song-name')).toHaveText('曹操');
  await page.locator('#new-project').click(); await page.locator('#apply-settings').click();
}
async function blankPoint(page: Page) {
  return page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const p = el.spatialPreview!, b = el.getBoundingClientRect();
    for (let y = b.height * .4; y < b.height * .8; y += 20) for (let x = b.width * .35; x < b.width * .65; x += 20) {
      if (document.elementFromPoint(b.x + x, b.y + y) === el && !p.pick(x, y)) return { x: b.x + x, y: b.y + y };
    }
    throw new Error('No empty scene point');
  });
}
async function padPoint(page: Page, lane: number, upper: boolean) {
  return page.locator('#preview').evaluate((el: HTMLCanvasElement, { lane, upper }) => {
    const p = el.spatialPreview!, pad = p.scene.getObjectByName(`obstacle-slot-${lane}`)!, b = el.getBoundingClientRect();
    const point = p.screenPosition({ x: pad.position.x, y: pad.position.y + .035, z: pad.position.z + (upper ? -.28 : .28) });
    return { x: point.x + b.x, y: point.y + b.y };
  }, { lane, upper });
}

test('blank clicks clear selection, controls preserve it, grouping appears only for multiple hands, and Del button deletes', async ({ page }) => {
  await fresh(page); await expect(page.locator('#group')).toBeHidden();
  await page.locator('#add-at-beat').click(); await selectLastVisibleNote(page);
  await expect(page.locator('#quick-group')).toBeHidden(); await expect(page.locator('#group')).toBeHidden();
  await page.locator('#camera-reset').click(); await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  const blank = await blankPoint(page); await page.mouse.click(blank.x, blank.y);
  await expect(page.locator('#selection-count')).toHaveText('未选中'); await expect(page.locator('#note-count')).toHaveText('1');
  await page.locator('#add-foot').click(); await page.keyboard.press('Control+a');
  await expect(page.locator('#selection-count')).toHaveText('已选 2 项');
  await expect(page.locator('#quick-group')).toBeHidden(); await expect(page.locator('#group')).toBeHidden();
  await page.locator('#delete').click(); await expect(page.locator('#note-count')).toHaveText('0');
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('2');
  await selectLastVisibleNote(page); await page.mouse.move(blank.x, blank.y); await page.keyboard.press('Delete');
  await expect(page.locator('#note-count')).toHaveText('1'); // Selection takes precedence even over empty canvas.
  await page.keyboard.press('Delete'); await expect(page.locator('#note-count')).toHaveText('1');
  await page.mouse.move(blank.x + 1, blank.y); await page.mouse.click(blank.x, blank.y);
  await expect(page.locator('#selection-count')).toHaveText('未选中');
});

test('1/2/3 switch categories, disable vertical/diagonal wall mirrors, and never intercept text input', async ({ page }) => {
  await fresh(page); await page.keyboard.press('2');
  await expect(page.locator('[data-mode="obstacles"]')).toHaveClass('active');
  await expect(page.locator('#mirror-left-right')).toBeEnabled(); await expect(page.locator('#mirror-up-down')).toBeDisabled(); await expect(page.locator('#mirror-diagonal')).toBeDisabled();
  await page.keyboard.press('3'); await expect(page.locator('[data-mode="events"]')).toHaveClass('active');
  await page.keyboard.press('1'); await expect(page.locator('[data-mode="notes"]')).toHaveClass('active');
  await expect(page.locator('#mirror-up-down')).toBeEnabled(); await expect(page.locator('#mirror-diagonal')).toBeEnabled();
  await page.locator('#search').fill(''); await page.keyboard.type('123'); await expect(page.locator('#search')).toHaveValue('123');
  await expect(page.locator('[data-mode="notes"]')).toHaveClass('active');
  await page.locator('#snap-denominator').fill('12'); await page.keyboard.press('Enter');
  await expect(page.locator('[data-mode="notes"]')).toHaveClass('active');
});

test('floor subdivisions follow preset and custom SNAP at the default depth and remain bounded for extreme custom values', async ({ page }) => {
  await fresh(page); await expect(page.locator('#depth-zoom')).toHaveValue('5');
  const guides = () => page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
    const p = el.spatialPreview!, mesh = p.scene.getObjectByName('snap-guides') as import('three').LineSegments;
    return { count: mesh.geometry.getAttribute('position').count / 2, step: mesh.userData.step, spacing: p.beatSpacing, labels: p.scene.children.filter(n => n.name === 'ground-beat-label' && n.visible).length };
  });
  expect(await guides()).toMatchObject({ count: 24, step: .25, labels: 9 });
  await page.locator('#division').selectOption('1'); expect((await guides()).count).toBe(0);
  await page.locator('#division').selectOption('8'); expect(await guides()).toMatchObject({ count: 56, step: .125 });
  await page.locator('#snap-denominator').fill('5'); await page.keyboard.press('Enter');
  expect(await guides()).toMatchObject({ count: 32, step: .2 });
  await page.locator('#snap-denominator').fill('1000000'); await page.keyboard.press('Enter');
  const extreme = await guides(); expect(extreme.count).toBeLessThanOrEqual(4096); expect(extreme.step).toBe(.000001);
});

test('four pads preview and place thin full/half walls by mouse height, with fixed defaults and no duration control', async ({ page }) => {
  await fresh(page); await page.keyboard.press('2');
  await expect(page.locator('#wall-width, #wall-type')).toHaveCount(0);
  for (const lane of [0,1,2,3]) {
    const upper = lane % 2 === 1, point = await padPoint(page, lane, upper);
    await page.mouse.move(point.x, point.y);
    const ghost = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
      const p = el.spatialPreview!, mesh = p.scene.getObjectByName('wall-placement-preview') as import('three').Mesh;
      return { visible: mesh.visible, placement: mesh.userData.placement, height: mesh.scale.y, width: mesh.scale.x, depth: mesh.scale.z, opacity: (mesh.material as import('three').MeshBasicMaterial).opacity };
    });
    expect(ghost.visible).toBe(true); expect(ghost.placement).toMatchObject({ lineIndex: lane, type: upper ? 1 : 0, width: 1, duration: .04 });
    expect(ghost.height).toBeCloseTo(upper ? 1.55 : 3.1); expect(ghost.width).toBeCloseTo(1.15); expect(ghost.depth).toBeCloseTo(.33); expect(ghost.opacity).toBeLessThan(.13);
    if (lane === 3) await page.screenshot({ path: 'test-results/wall-hover-preview.png' });
    await page.mouse.click(point.x, point.y);
    const wall = await page.locator('#preview').evaluate((el: HTMLCanvasElement) => {
      const mesh = el.spatialPreview!.scene.getObjectByName('obstacles') as import('three').InstancedMesh;
      return { count: mesh.count, scale: mesh.userData.batch.records.at(-1).scale.toArray() };
    });
    expect(wall.count).toBe(lane + 1); expect(wall.scale[0]).toBeCloseTo(ghost.width); expect(wall.scale[1]).toBeCloseTo(ghost.height); expect(wall.scale[2]).toBeCloseTo(ghost.depth);
    await expect(page.locator('#selection-count')).toHaveText('未选中');
  }
  await page.keyboard.press('Control+a'); await expect(page.locator('#selection-count')).toHaveText('已选 4 项');
  await expect(page.locator('[data-field="duration"], [data-field="width"]')).toHaveCount(0);
  await expect(page.locator('#quick-group')).toBeHidden(); await expect(page.locator('#group')).toBeHidden();
  await page.locator('#mirror-left-right').click(); await expect(page.locator('[data-field="lineIndex"]')).toHaveValue('3');
  await page.locator('#undo').click(); await page.locator('#undo').click(); // Undo mirror, then last placement; hovering adds no history.
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => (el.spatialPreview!.scene.getObjectByName('obstacles') as import('three').InstancedMesh).count)).toBe(3);
  expect(await page.locator('#preview').evaluate((el: HTMLCanvasElement) => el.spatialPreview!.scene.getObjectByName('wall-placement-preview')!.visible)).toBe(false);
  await page.keyboard.press('1'); await expect(page.locator('#note-count')).toHaveText('0');
  await page.screenshot({ path: 'test-results/wall-placement-refinements.png' });
});
