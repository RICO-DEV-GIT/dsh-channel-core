import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDirectory, createDirectory } from '../lib/directory-tools.js';

const statOf = isDirectory => async () => ({ isDirectory: () => isDirectory });
const enoent = () => Object.assign(new Error('missing'), { code: 'ENOENT' });

test('a typed workspace is checked before it is saved', async () => {
  assert.deepEqual(await checkDirectory('G:\\DSWork', { statImpl: statOf(true) }), { exists: true, isDirectory: true, path: 'G:\\DSWork' });
  const file = await checkDirectory('G:\\DSWork\\a.txt', { statImpl: statOf(false) });
  assert.equal(file.exists, true);
  assert.equal(file.isDirectory, false, 'a file must not pass as a workspace');
  const missing = await checkDirectory('G:\\Nope', { statImpl: async () => { throw enoent(); } });
  assert.deepEqual(missing, { exists: false, isDirectory: false, path: 'G:\\Nope' });
});

test('invalid paths are rejected instead of guessed', async () => {
  await assert.rejects(() => checkDirectory('', { statImpl: statOf(true) }), /请填写目录路径/);
  await assert.rejects(() => checkDirectory('relative\\dir', { statImpl: statOf(true) }), /请填写绝对路径/);
});

test('an unreadable path reports why instead of claiming it is missing', async () => {
  const denied = async () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  await assert.rejects(() => checkDirectory('G:\\Locked', { statImpl: denied }), /无法读取该路径/);
});

test('creating a missing workspace makes exactly that directory', async () => {
  const calls = [];
  const result = await createDirectory('G:\\DSWork\\new-ws', { mkdirImpl: async value => { calls.push(value); } });
  assert.deepEqual(result, { created: true, path: 'G:\\DSWork\\new-ws' });
  assert.deepEqual(calls, ['G:\\DSWork\\new-ws']);
});

test('creation reports the two failure modes the page must explain', async () => {
  const exists = async () => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); };
  assert.deepEqual(await createDirectory('G:\\a', { mkdirImpl: exists, statImpl: statOf(true) }), { created: false, path: 'G:\\a' });
  await assert.rejects(
    () => createDirectory('G:\\a', { mkdirImpl: exists, statImpl: statOf(false) }),
    /该路径已存在且不是目录/,
  );
  const noParent = async () => { throw Object.assign(new Error('enoent'), { code: 'ENOENT' }); };
  await assert.rejects(() => createDirectory('G:\\X\\Y', { mkdirImpl: noParent }), /上级目录不存在/);
});
