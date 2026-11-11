import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../lib/store.js';
import { bootstrapDemo } from '../lib/bootstrap.js';

const env = {
  DEMO_BOOTSTRAP: '1', INITIAL_RESTAURANT: 'Review Restaurant',
  INITIAL_NAME: 'Reviewer', INITIAL_EMAIL: 'review@example.com',
  INITIAL_PASSWORD: 'test-only-password-123'
};
function fixture(t) { const store=openStore(':memory:');t.after(()=>store.db.close());return store; }
test('demo bootstrap is disabled unless explicitly enabled', t => {
  const store=fixture(t);assert.equal(bootstrapDemo(store,{}),false);assert.equal(store.needsSetup(),true);
});
test('demo setup creates a usable account and recreates it on a fresh database', t => {
  for(let i=0;i<2;i++) {
    const store=fixture(t);assert.equal(bootstrapDemo(store,env),true);
    assert.equal(store.login({email:env.INITIAL_EMAIL,password:env.INITIAL_PASSWORD}).user.role,'owner');
    assert.ok(store.db.prepare('SELECT COUNT(*) AS count FROM products').get().count>0);
  }
});
test('bootstrap does not overwrite an existing account or restaurant', t => {
  const store=fixture(t);bootstrapDemo(store,env);
  assert.equal(bootstrapDemo(store,{...env,INITIAL_PASSWORD:'changed-password-123'}),false);
  assert.ok(store.login({email:env.INITIAL_EMAIL,password:env.INITIAL_PASSWORD}));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM users').get().count,1);
});
test('incomplete or invalid bootstrap configuration does not leave partial setup', t => {
  const store=fixture(t);
  assert.throws(()=>bootstrapDemo(store,{...env,INITIAL_PASSWORD:''}),/INITIAL_PASSWORD/);
  assert.equal(store.needsSetup(),true);
  assert.throws(()=>bootstrapDemo(store,{...env,INITIAL_PASSWORD:'short'}),/12–200/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM restaurants').get().count,0);
});
