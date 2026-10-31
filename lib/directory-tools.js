/**
 * Directory helpers for the settings page.
 *
 * The workspace can be typed by hand, and a typo used to surface only when the
 * first message failed to create a Session. These helpers let the page check the
 * path before saving and offer to create it, while keeping the sensitive part
 * (touching the filesystem) on the Host and testable through injected fs calls.
 */
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';

const fail = (code, message) => Object.assign(new Error(message), { code });

function normalise(target) {
  const value = String(target ?? '').trim();
  if (!value) throw fail('directory-invalid', '请填写目录路径');
  if (!path.isAbsolute(value)) throw fail('directory-invalid', '请填写绝对路径（例如 G:\\DSWork）');
  return value;
}

/** Report whether a path exists and whether it is a directory. */
export async function checkDirectory(target, { statImpl = stat } = {}) {
  const value = normalise(target);
  try {
    const info = await statImpl(value);
    return { exists: true, isDirectory: info.isDirectory(), path: value };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, isDirectory: false, path: value };
    throw fail('directory-unreadable', '无法读取该路径：' + (error?.message || error?.code || '未知原因'));
  }
}

/**
 * Create one directory. The parent must already exist: this is the workspace
 * root, and a mistyped deep path should be corrected rather than materialised.
 */
export async function createDirectory(target, { mkdirImpl = mkdir, statImpl = stat } = {}) {
  const value = normalise(target);
  try {
    await mkdirImpl(value);
    return { created: true, path: value };
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const info = await statImpl(value).catch(() => null);
      if (info?.isDirectory()) return { created: false, path: value };
      throw fail('directory-create-failed', '该路径已存在且不是目录');
    }
    if (error?.code === 'ENOENT') throw fail('directory-parent-missing', '上级目录不存在，请先用系统目录选择器逐级选择');
    throw fail('directory-create-failed', '创建目录失败：' + (error?.message || error?.code || '未知原因'));
  }
}
