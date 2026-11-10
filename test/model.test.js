import test from 'node:test';
import assert from 'node:assert/strict';
import {menu,totals} from '../public/model.js';
test('empty orders have no tax',()=>assert.deepEqual(totals([]),{subtotal:0,tax:0,total:0}));
test('quantities and rounded tax produce the correct charge',()=>assert.deepEqual(totals([{price:590,qty:2},{price:150,qty:1}]),{subtotal:1330,tax:67,total:1397}));
test('menu ids are unique and all prices are positive',()=>{assert.equal(new Set(menu.map(x=>x.id)).size,menu.length);assert.ok(menu.every(x=>x.price>0));});
