import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { workspaceFolder } from '../server/api.ts';
import { History, newProject } from '../src/model.ts';

test('workspace folder resolves only existing paths within Map', async () => {
  assert.equal(await workspaceFolder(), path.resolve('Map'));
  assert.equal(await workspaceFolder('caocao'), path.resolve('Map/caocao'));
  for (const invalid of ['..', '../src', 'caocao/Info.yaml', 'missing-test-directory', 'C:\\Windows', 'caocao:stream']) await assert.rejects(workspaceFolder(invalid));
});
test('cancel restores history checkpoint including the redo branch', () => {
  const history = new History(), project = newProject();
  history.push(project); project.chart.notes!.push({ time: 1, lineIndex: 0, lineLayer: 0, type: 0 });
  const before = history.undo(project)!; const checkpoint = history.checkpoint();
  history.push(before); history.push(project); history.restore(checkpoint);
  assert.equal(history.undo(before), undefined);
  assert.deepEqual(history.redo(before), project);
});
