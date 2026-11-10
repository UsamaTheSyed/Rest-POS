import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQuantity} from '../public/cart.js';
test('typed order quantities support bulk counts and reject ambiguous input',()=>{
  assert.equal(parseQuantity('125'),125);
  assert.equal(parseQuantity('999'),999);
  assert.equal(parseQuantity('002'),2);
  for(const value of ['',0,-1,'1.5','1e2','abc',1000])assert.equal(parseQuantity(value),null);
});
