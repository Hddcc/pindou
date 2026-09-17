import 'fake-indexeddb/auto';
import {expect, it} from 'vitest';
import {blank} from '../src/domain/editor';
import {lastLocal, listLocal, putLocal, removeLocal, uuid, type LocalWork} from '../src/infrastructure/local';

it('persists multiple drafts and account-scoped refs atomically', async () => {
  const a: LocalWork = {localKey: uuid(), document: blank('第一张'), cloudRefs: {one: {userId: 'one', key: uuid(), id: 'wrk_1', revision: 2}, two: {userId: 'two', key: uuid()}}};
  const b: LocalWork = {localKey: uuid(), document: blank('第二张'), cloudRefs: {}};
  await putLocal(a); await putLocal(b); expect(await lastLocal()).toEqual(b); expect(await listLocal()).toHaveLength(2);
  expect((await listLocal()).find(w => w.localKey === a.localKey)?.cloudRefs.one.revision).toBe(2);
  await removeLocal(a.localKey); expect(await listLocal()).toHaveLength(1); expect(await lastLocal()).toEqual(b);
});
