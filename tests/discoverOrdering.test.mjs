import assert from 'node:assert/strict';
import stableDiscoverOrder from '../src/utils/discoverOrdering.js';

const items = [
  { type: 'post', data: { id: 'p1', imageMeta: { aspectRatio: 1 } } },
  { type: 'user', data: { uid: 'u1', displayName: 'Alice' } },
  { type: 'post', data: { id: 'p2', imageMeta: { aspectRatio: 0.6 } } },
  { type: 'post', data: { id: 'p3', imageMeta: { aspectRatio: 2.0 } } },
  { type: 'user', data: { uid: 'u2', displayName: 'Bob' } },
  { type: 'post', data: { id: 'p4', imageMeta: { aspectRatio: 0.8 } } },
];

const getId = (i) => (i.type === 'post' ? i.data.id : i.data.uid);

const o1 = stableDiscoverOrder(items, { sessionSeed: 'seed-alpha', query: '', getId, getType: (i) => i.type });
const o2 = stableDiscoverOrder(items, { sessionSeed: 'seed-alpha', query: '', getId, getType: (i) => i.type });

assert.deepEqual(o1.map(getId), o2.map(getId), 'Ordering should be deterministic for same seed+input');

const o3 = stableDiscoverOrder(items, { sessionSeed: 'seed-beta', query: '', getId, getType: (i) => i.type });
assert.notDeepEqual(o1.map(getId), o3.map(getId), 'Different seed should usually produce a different order');

console.log('discoverOrdering tests passed');
