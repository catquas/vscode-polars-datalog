import { suite, test, strictEqual, deepEqual, ok, notOk, includes } from './runner';
import {
  coerceOutputLocation,
  deleteInside,
  ensureDir,
  FileSystemLike,
  isInside,
  joinPath,
  newestMtime,
  pruneStaleEntries,
  sessionDir,
  tempRootDir,
  workspaceKey,
  writeFileIfChanged,
} from '../outputPaths';

/** In-memory stand-in for node:fs. Directories are entries ending in '/'. */
class FakeFs implements FileSystemLike {
  files = new Map<string, { content: string; mtimeMs: number }>();
  dirs = new Set<string>();
  failWrites = false;

  addDir(path: string, mtimeMs = 0): void {
    this.dirs.add(joinPath(path));
    this.files.set(joinPath(path), { content: '', mtimeMs });
  }

  addFile(path: string, content: string, mtimeMs = 0): void {
    this.files.set(joinPath(path), { content, mtimeMs });
  }

  existsSync(path: string): boolean {
    return this.files.has(joinPath(path)) || this.dirs.has(joinPath(path));
  }

  mkdirSync(path: string): void {
    if (this.failWrites) { throw new Error('read-only'); }
    this.addDir(path);
  }

  readdirSync(path: string): string[] {
    const prefix = joinPath(path) + '/';
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split('/')[0]);
      }
    }
    return [...names];
  }

  statSync(path: string): { mtimeMs: number } {
    const entry = this.files.get(joinPath(path));
    if (!entry) { throw new Error(`missing ${path}`); }
    return { mtimeMs: entry.mtimeMs };
  }

  rmSync(path: string): void {
    const target = joinPath(path);
    for (const key of [...this.files.keys()]) {
      if (key === target || key.startsWith(target + '/')) { this.files.delete(key); }
    }
    for (const key of [...this.dirs]) {
      if (key === target || key.startsWith(target + '/')) { this.dirs.delete(key); }
    }
  }

  readFileSync(path: string): string {
    const entry = this.files.get(joinPath(path));
    if (!entry) { throw new Error(`missing ${path}`); }
    return entry.content;
  }

  writeFileSync(path: string, data: string): void {
    if (this.failWrites) { throw new Error('read-only'); }
    this.addFile(path, data, 1000);
  }
}

const HOUR = 60 * 60 * 1000;

suite('joinPath', () => {
  test('joins with forward slashes', () => strictEqual(joinPath('/tmp', 'a', 'b'), '/tmp/a/b'));
  test('normalises Windows separators', () => {
    strictEqual(joinPath('C:\\Temp', 'a'), 'C:/Temp/a');
  });
  test('collapses duplicate separators', () => strictEqual(joinPath('/tmp/', '/a/'), '/tmp/a'));
  test('drops empty segments', () => strictEqual(joinPath('/tmp', '', 'a'), '/tmp/a'));
});

suite('workspaceKey', () => {
  test('combines a readable name with a hash', () => {
    ok(/^myproj-[0-9a-f]{8}$/.test(workspaceKey('/home/user/myproj')), workspaceKey('/home/user/myproj'));
  });

  test('same-named folders in different paths do not collide', () => {
    ok(workspaceKey('/a/proj') !== workspaceKey('/b/proj'), 'distinct keys');
  });

  test('is stable across calls', () => {
    strictEqual(workspaceKey('/home/user/proj'), workspaceKey('/home/user/proj'));
  });

  test('ignores a trailing separator', () => {
    strictEqual(workspaceKey('/home/user/proj/'), workspaceKey('/home/user/proj'));
  });

  test('handles Windows paths', () => {
    ok(workspaceKey('C:\\Users\\brent\\pythontest').startsWith('pythontest-'), 'named after the folder');
  });

  test('falls back when no workspace is open', () => {
    strictEqual(workspaceKey(undefined), 'no-workspace');
  });

  test('sanitises unusual folder names', () => {
    includes(workspaceKey('/home/user/my proj (2)'), 'my_proj_2');
  });
});

suite('sessionDir', () => {
  test('sits under the temp root', () => {
    const dir = sessionDir('/tmp', '/home/user/proj');
    ok(dir.startsWith(tempRootDir('/tmp') + '/'), dir);
  });

  test('temp root is namespaced', () => {
    strictEqual(tempRootDir('/tmp'), '/tmp/vscode-datalog');
  });
});

suite('coerceOutputLocation', () => {
  test('accepts workspace', () => strictEqual(coerceOutputLocation('workspace'), 'workspace'));
  test('accepts temp', () => strictEqual(coerceOutputLocation('temp'), 'temp'));
  test('defaults to temp for anything else', () => {
    strictEqual(coerceOutputLocation('elsewhere'), 'temp');
    strictEqual(coerceOutputLocation(undefined), 'temp');
  });
});

suite('isInside', () => {
  test('accepts a child path', () => ok(isInside('/tmp/vscode-datalog', '/tmp/vscode-datalog/proj'), 'child'));
  test('accepts the root itself', () => ok(isInside('/tmp/vscode-datalog', '/tmp/vscode-datalog'), 'self'));
  test('rejects a sibling with a shared prefix', () => {
    notOk(isInside('/tmp/vscode-datalog', '/tmp/vscode-datalog-other'), 'sibling');
  });
  test('rejects an unrelated path', () => notOk(isInside('/tmp/vscode-datalog', '/home/user'), 'outside'));
  test('compares across separator styles', () => {
    ok(isInside('C:\\Temp\\vscode-datalog', 'C:/Temp/vscode-datalog/proj'), 'windows');
  });
});

suite('deleteInside', () => {
  test('removes a folder under the root', () => {
    const fs = new FakeFs();
    fs.addDir('/tmp/vscode-datalog/proj');
    fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'x');
    ok(deleteInside(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog/proj'), 'deleted');
    notOk(fs.existsSync('/tmp/vscode-datalog/proj/plog.log'), 'contents gone');
  });

  test('refuses to delete outside the root', () => {
    const fs = new FakeFs();
    fs.addDir('/home/user/proj');
    notOk(deleteInside(fs, '/tmp/vscode-datalog', '/home/user/proj'), 'refused');
    ok(fs.existsSync('/home/user/proj'), 'still there');
  });

  test('refuses to delete the root itself', () => {
    const fs = new FakeFs();
    fs.addDir('/tmp/vscode-datalog');
    notOk(deleteInside(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog'), 'refused');
  });

  test('reports false for a missing target', () => {
    notOk(deleteInside(new FakeFs(), '/tmp/vscode-datalog', '/tmp/vscode-datalog/gone'), 'nothing to do');
  });
});

suite('pruneStaleEntries', () => {
  const now = 100 * HOUR;

  function populate(): FakeFs {
    const fs = new FakeFs();
    fs.addDir('/tmp/vscode-datalog');
    fs.addDir('/tmp/vscode-datalog/fresh', now - 1 * HOUR);
    fs.addDir('/tmp/vscode-datalog/yesterday', now - 20 * HOUR);
    fs.addDir('/tmp/vscode-datalog/ancient', now - 400 * HOUR);
    return fs;
  }

  test('removes entries older than the cutoff', () => {
    const fs = populate();
    const removed = pruneStaleEntries(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 12 * HOUR, now);
    deepEqual(removed.sort(), ['ancient', 'yesterday']);
    ok(fs.existsSync('/tmp/vscode-datalog/fresh'), 'fresh kept');
  });

  test('honours the skip list', () => {
    const fs = populate();
    const removed = pruneStaleEntries(
      fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 12 * HOUR, now, ['yesterday']
    );
    deepEqual(removed, ['ancient']);
    ok(fs.existsSync('/tmp/vscode-datalog/yesterday'), 'skipped entry kept');
  });

  test('does nothing when retention is zero', () => {
    const fs = populate();
    deepEqual(pruneStaleEntries(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 0, now), []);
    ok(fs.existsSync('/tmp/vscode-datalog/ancient'), 'kept');
  });

  test('refuses to prune outside the root', () => {
    const fs = populate();
    fs.addDir('/home/user/proj/old', 0);
    deepEqual(pruneStaleEntries(fs, '/tmp/vscode-datalog', '/home/user/proj', 12 * HOUR, now), []);
    ok(fs.existsSync('/home/user/proj/old'), 'untouched');
  });

  test('tolerates a missing directory', () => {
    deepEqual(pruneStaleEntries(new FakeFs(), '/tmp/vscode-datalog', '/tmp/vscode-datalog', HOUR, now), []);
  });

  test('prunes stale files inside a session folder', () => {
    const fs = new FakeFs();
    fs.addDir('/tmp/vscode-datalog');
    fs.addDir('/tmp/vscode-datalog/proj', now);
    fs.addFile('/tmp/vscode-datalog/proj/datalog_runtime.py', 'x', 0);
    fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'y', 0);
    const removed = pruneStaleEntries(
      fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog/proj', 12 * HOUR, now, ['datalog_runtime.py']
    );
    deepEqual(removed, ['plog.log']);
    ok(fs.existsSync('/tmp/vscode-datalog/proj/datalog_runtime.py'), 'runtime kept');
  });
});

suite('ensureDir / writeFileIfChanged', () => {
  test('creates a missing directory', () => {
    const fs = new FakeFs();
    ok(ensureDir(fs, '/tmp/vscode-datalog/proj'), 'created');
    ok(fs.existsSync('/tmp/vscode-datalog/proj'), 'exists');
  });

  test('reports failure instead of throwing', () => {
    const fs = new FakeFs();
    fs.failWrites = true;
    notOk(ensureDir(fs, '/tmp/vscode-datalog/proj'), 'failed cleanly');
  });

  test('writes new content', () => {
    const fs = new FakeFs();
    ok(writeFileIfChanged(fs, '/tmp/a.py', 'source'), 'written');
    strictEqual(fs.readFileSync('/tmp/a.py'), 'source');
  });

  test('leaves an identical file untouched so its mtime survives', () => {
    const fs = new FakeFs();
    fs.addFile('/tmp/a.py', 'source', 42);
    ok(writeFileIfChanged(fs, '/tmp/a.py', 'source'), 'ok');
    strictEqual(fs.statSync('/tmp/a.py').mtimeMs, 42);
  });

  test('rewrites when the content changed', () => {
    const fs = new FakeFs();
    fs.addFile('/tmp/a.py', 'old', 42);
    ok(writeFileIfChanged(fs, '/tmp/a.py', 'new'), 'ok');
    strictEqual(fs.readFileSync('/tmp/a.py'), 'new');
  });

  test('reports failure instead of throwing', () => {
    const fs = new FakeFs();
    fs.failWrites = true;
    notOk(writeFileIfChanged(fs, '/tmp/a.py', 'x'), 'failed cleanly');
  });
});

suite('newestMtime', () => {
  test('uses the newest child, not the folder itself', () => {
    const fs = new FakeFs();
    fs.addDir('/tmp/vscode-datalog/proj', 10);
    fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'x', 900);
    strictEqual(newestMtime(fs, '/tmp/vscode-datalog/proj'), 900);
  });

  test('falls back to the entry itself when it has no children', () => {
    const fs = new FakeFs();
    fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'x', 500);
    strictEqual(newestMtime(fs, '/tmp/vscode-datalog/proj/plog.log'), 500);
  });

  test('keeps a folder that is still in use from being pruned', () => {
    const now = 100 * HOUR;
    const fs = new FakeFs();
    fs.addDir('/tmp/vscode-datalog');
    fs.addDir('/tmp/vscode-datalog/inuse', now - 500 * HOUR);
    fs.addFile('/tmp/vscode-datalog/inuse/datalog_runtime.py', 'x', now - 1 * HOUR);
    deepEqual(pruneStaleEntries(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 12 * HOUR, now), []);
    ok(fs.existsSync('/tmp/vscode-datalog/inuse/datalog_runtime.py'), 'kept');
  });
});

suite('writeFileIfChanged - forced rewrite', () => {
  test('force rewrites an identical file so its mtime moves', () => {
    const fs = new FakeFs();
    fs.addFile('/tmp/a.py', 'source', 42);
    ok(writeFileIfChanged(fs, '/tmp/a.py', 'source', true), 'ok');
    ok(fs.statSync('/tmp/a.py').mtimeMs !== 42, 'mtime refreshed');
  });
});
