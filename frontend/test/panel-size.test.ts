import assert from 'node:assert/strict';
import {test} from 'node:test';
import {panelSize} from '../src/features/workspace/panel-size.js';
test('desktop resizing leaves usable chat space and accepts widths beyond the former fixed maximum',()=>{
  const desktop=panelSize(1200,1600);
  assert.equal(desktop.min,320);assert.equal(desktop.max,920);
  assert.equal(desktop.clamp(2000),920);assert.equal(desktop.clamp(100),320);
  assert.ok(panelSize(1900,2300).max>980);
});
test('overlay bounds account for the navigation rail and fit small screens',()=>{
  assert.equal(panelSize(800,1000).max,944);
  const mobile=panelSize(390,390);assert.equal(mobile.max,334);assert.equal(mobile.initial,334);
  const small=panelSize(320,320);assert.equal(small.min,264);assert.equal(small.max,264);
  assert.equal(panelSize(0,1400).clamp(600),0);
});
