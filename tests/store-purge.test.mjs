import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { CoreStore } from '../lib/store.js';

const store = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-purge-'));
  const instance = new CoreStore(path.join(dir, 'state.sqlite'));
  return { instance, dir };
};

const binding = (store, accountId, suffix) => store.db.prepare('INSERT INTO bindings VALUES(?,?,?,?,?)').run(
  JSON.stringify(['feishu', accountId, 'chat-' + suffix, '', 'route']),
  'binding-' + suffix,
  'session-' + suffix,
  JSON.stringify({ provider: 'feishu', accountId, scope: {} }),
  1,
);

test('purging one account leaves its sibling untouched', () => {
  const { instance, dir } = store();
  try {
    binding(instance, 'a', 'a1');
    binding(instance, 'a', 'a2');
    binding(instance, 'b', 'b1');
    instance.setOwner('feishu', 'a', 'ou_a');
    instance.setOwner('feishu', 'b', 'ou_b');
    instance.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?)').run(
      'r-a', 'req-a', 'session-a1', 'digest', 'completed',
      JSON.stringify({ provider: 'feishu', accountId: 'a', conversationId: 'chat-a1' }), Date.now(),
    );
    instance.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?)').run(
      'r-b', 'req-b', 'session-b1', 'digest', 'completed',
      JSON.stringify({ provider: 'feishu', accountId: 'b', conversationId: 'chat-b1' }), Date.now(),
    );

    const purged = instance.purgeAccount('feishu', 'a');
    assert.equal(purged.bindings, 2);
    assert.equal(purged.receipts, 1);
    assert.equal(purged.owners, 1);

    const left = instance.db.prepare('SELECT session_id FROM bindings').all().map(row => row.session_id);
    assert.deepEqual(left, ['session-b1'], 'the other account keeps its binding');
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 1);
    assert.equal(instance.db.prepare("SELECT user_id FROM channel_owners WHERE account_id='b'").get().user_id, 'ou_b');
    assert.equal(instance.owner('feishu', 'a'), null);
    assert.equal(instance.owner('feishu', 'b').userId, 'ou_b');
  } finally { instance.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a receipt whose account id only appears in another field is not deleted', () => {
  const { instance, dir } = store();
  try {
    instance.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?)').run(
      'r-x', 'req-x', 'session-x', 'digest', 'completed',
      JSON.stringify({ provider: 'feishu', accountId: 'x', text: 'mentions a in body' }), Date.now(),
    );
    assert.equal(instance.purgeAccount('feishu', 'a').receipts, 0);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 1);
  } finally { instance.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
