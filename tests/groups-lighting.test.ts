import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'yaml';
import { newProject, type Item } from '../src/model';
import { groupingOptions, applyGrouping, groupHeads, repairGroups } from '../src/groups';
import { defaultLightTracks, lightTracks, validLightMapping, lightAt } from '../src/lighting-data';
const hand = (time: number, type = 0): Item => ({ time, type, lineIndex: 0, lineLayer: 0 });
const refs = (...indices: number[]) => indices.map(index => ({kind:'notes' as const,index}));
test('mixed-color grouping, joining, splitting and ungrouping preserve group boundary markers and undo data', () => {
  const p = newProject(); p.chart.notes=[hand(1),hand(3,1),hand(2),hand(5,1)];
  assert.equal(applyGrouping(p,refs(0,1),'create'),true); const id=p.chart.notes[0].groupId;
  assert.equal(p.chart.notes[1].groupId,id); assert.equal(groupingOptions(p,refs(0)).canUngroup,true); assert.equal(groupingOptions(p,refs(0,1)).canCreate,false);
  assert.equal(groupingOptions(p,refs(0,2)).canJoin,true); assert.equal(applyGrouping(p,refs(0,2),'join',id),true);
  assert.deepEqual(p.chart.notes.slice(0,3).map(n=>n.groupId),[id,id,id]); assert.deepEqual([...groupHeads(p.chart.notes)],[0]);
  const before=structuredClone(p); assert.equal(applyGrouping(p,refs(0,3),'create'),true); assert.equal(p.chart.notes[1].groupNoteType,2); assert.equal(p.chart.notes[2].groupNoteType,1);
  assert.equal(applyGrouping(p,refs(0),'ungroup'),true); assert.equal(p.chart.notes[3].groupId,undefined); assert.equal(p.chart.notes[1].groupId,id);
  assert.equal(before.chart.notes![0].groupId,id); // History snapshots retain original membership.
  p.chart.notes.splice(1,1); repairGroups(p,new Set([id])); assert.equal(p.chart.notes[1].groupId,undefined);
});
test('lighting mapping exposes ten named lanes plus preserved extension types and caps no imported data', () => {
  assert.equal(defaultLightTracks.length,10); assert.equal(defaultLightTracks.filter(t=>t.speed).length,4); assert.equal(validLightMapping(defaultLightTracks.map(t=>t.type)),true);
  assert.equal(validLightMapping(Array(10).fill(1)),false);
  const events=[{time:0,type:101,value:999},{time:0,type:3,value:7}]; const original=structuredClone(events);
  assert.equal(lightTracks(events,defaultLightTracks).at(-1)?.type,101); assert.deepEqual(events,original);
  assert.equal(lightAt([{time:2,type:1,value:1},{time:4,type:1,value:0}],1,3).intensity,1);
  assert.equal(lightAt([{time:2,type:1,value:1},{time:4,type:1,value:0}],1,4).intensity,0);
});
test('3n3rgizer Normal around 15 seconds contains nine native type-3 mines, not malformed regular notes', () => {
  const info=parse(fs.readFileSync('Map/3n3rgizer/Info.yaml','utf8')),chart=parse(fs.readFileSync('Map/3n3rgizer/Ring/NormalRing.yaml','utf8'));
  assert.equal(info.beatsPerMinute,150); const start=15*info.beatsPerMinute/60;
  const mines=chart.notes.filter((n:Item)=>n.time>=start&&n.time<=39.25); assert.equal(mines.length,9); assert.ok(mines.every((n:Item)=>n.type===3));
});
