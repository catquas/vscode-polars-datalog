"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("./runner");
const outputPaths_1 = require("../outputPaths");
/** In-memory stand-in for node:fs. Directories are entries ending in '/'. */
class FakeFs {
    constructor() {
        this.files = new Map();
        this.dirs = new Set();
        this.failWrites = false;
    }
    addDir(path, mtimeMs = 0) {
        this.dirs.add((0, outputPaths_1.joinPath)(path));
        this.files.set((0, outputPaths_1.joinPath)(path), { content: '', mtimeMs });
    }
    addFile(path, content, mtimeMs = 0) {
        this.files.set((0, outputPaths_1.joinPath)(path), { content, mtimeMs });
    }
    existsSync(path) {
        return this.files.has((0, outputPaths_1.joinPath)(path)) || this.dirs.has((0, outputPaths_1.joinPath)(path));
    }
    mkdirSync(path) {
        if (this.failWrites) {
            throw new Error('read-only');
        }
        this.addDir(path);
    }
    readdirSync(path) {
        const prefix = (0, outputPaths_1.joinPath)(path) + '/';
        const names = new Set();
        for (const key of [...this.files.keys(), ...this.dirs]) {
            if (key.startsWith(prefix)) {
                names.add(key.slice(prefix.length).split('/')[0]);
            }
        }
        return [...names];
    }
    statSync(path) {
        const entry = this.files.get((0, outputPaths_1.joinPath)(path));
        if (!entry) {
            throw new Error(`missing ${path}`);
        }
        return { mtimeMs: entry.mtimeMs };
    }
    rmSync(path) {
        const target = (0, outputPaths_1.joinPath)(path);
        for (const key of [...this.files.keys()]) {
            if (key === target || key.startsWith(target + '/')) {
                this.files.delete(key);
            }
        }
        for (const key of [...this.dirs]) {
            if (key === target || key.startsWith(target + '/')) {
                this.dirs.delete(key);
            }
        }
    }
    readFileSync(path) {
        const entry = this.files.get((0, outputPaths_1.joinPath)(path));
        if (!entry) {
            throw new Error(`missing ${path}`);
        }
        return entry.content;
    }
    writeFileSync(path, data) {
        if (this.failWrites) {
            throw new Error('read-only');
        }
        this.addFile(path, data, 1000);
    }
}
const HOUR = 60 * 60 * 1000;
(0, runner_1.suite)('joinPath', () => {
    (0, runner_1.test)('joins with forward slashes', () => (0, runner_1.strictEqual)((0, outputPaths_1.joinPath)('/tmp', 'a', 'b'), '/tmp/a/b'));
    (0, runner_1.test)('normalises Windows separators', () => {
        (0, runner_1.strictEqual)((0, outputPaths_1.joinPath)('C:\\Temp', 'a'), 'C:/Temp/a');
    });
    (0, runner_1.test)('collapses duplicate separators', () => (0, runner_1.strictEqual)((0, outputPaths_1.joinPath)('/tmp/', '/a/'), '/tmp/a'));
    (0, runner_1.test)('drops empty segments', () => (0, runner_1.strictEqual)((0, outputPaths_1.joinPath)('/tmp', '', 'a'), '/tmp/a'));
});
(0, runner_1.suite)('workspaceKey', () => {
    (0, runner_1.test)('combines a readable name with a hash', () => {
        (0, runner_1.ok)(/^myproj-[0-9a-f]{8}$/.test((0, outputPaths_1.workspaceKey)('/home/user/myproj')), (0, outputPaths_1.workspaceKey)('/home/user/myproj'));
    });
    (0, runner_1.test)('same-named folders in different paths do not collide', () => {
        (0, runner_1.ok)((0, outputPaths_1.workspaceKey)('/a/proj') !== (0, outputPaths_1.workspaceKey)('/b/proj'), 'distinct keys');
    });
    (0, runner_1.test)('is stable across calls', () => {
        (0, runner_1.strictEqual)((0, outputPaths_1.workspaceKey)('/home/user/proj'), (0, outputPaths_1.workspaceKey)('/home/user/proj'));
    });
    (0, runner_1.test)('ignores a trailing separator', () => {
        (0, runner_1.strictEqual)((0, outputPaths_1.workspaceKey)('/home/user/proj/'), (0, outputPaths_1.workspaceKey)('/home/user/proj'));
    });
    (0, runner_1.test)('handles Windows paths', () => {
        (0, runner_1.ok)((0, outputPaths_1.workspaceKey)('C:\\Users\\brent\\pythontest').startsWith('pythontest-'), 'named after the folder');
    });
    (0, runner_1.test)('falls back when no workspace is open', () => {
        (0, runner_1.strictEqual)((0, outputPaths_1.workspaceKey)(undefined), 'no-workspace');
    });
    (0, runner_1.test)('sanitises unusual folder names', () => {
        (0, runner_1.includes)((0, outputPaths_1.workspaceKey)('/home/user/my proj (2)'), 'my_proj_2');
    });
});
(0, runner_1.suite)('sessionDir', () => {
    (0, runner_1.test)('sits under the temp root', () => {
        const dir = (0, outputPaths_1.sessionDir)('/tmp', '/home/user/proj');
        (0, runner_1.ok)(dir.startsWith((0, outputPaths_1.tempRootDir)('/tmp') + '/'), dir);
    });
    (0, runner_1.test)('temp root is namespaced', () => {
        (0, runner_1.strictEqual)((0, outputPaths_1.tempRootDir)('/tmp'), '/tmp/vscode-datalog');
    });
});
(0, runner_1.suite)('coerceOutputLocation', () => {
    (0, runner_1.test)('accepts workspace', () => (0, runner_1.strictEqual)((0, outputPaths_1.coerceOutputLocation)('workspace'), 'workspace'));
    (0, runner_1.test)('accepts temp', () => (0, runner_1.strictEqual)((0, outputPaths_1.coerceOutputLocation)('temp'), 'temp'));
    (0, runner_1.test)('defaults to temp for anything else', () => {
        (0, runner_1.strictEqual)((0, outputPaths_1.coerceOutputLocation)('elsewhere'), 'temp');
        (0, runner_1.strictEqual)((0, outputPaths_1.coerceOutputLocation)(undefined), 'temp');
    });
});
(0, runner_1.suite)('isInside', () => {
    (0, runner_1.test)('accepts a child path', () => (0, runner_1.ok)((0, outputPaths_1.isInside)('/tmp/vscode-datalog', '/tmp/vscode-datalog/proj'), 'child'));
    (0, runner_1.test)('accepts the root itself', () => (0, runner_1.ok)((0, outputPaths_1.isInside)('/tmp/vscode-datalog', '/tmp/vscode-datalog'), 'self'));
    (0, runner_1.test)('rejects a sibling with a shared prefix', () => {
        (0, runner_1.notOk)((0, outputPaths_1.isInside)('/tmp/vscode-datalog', '/tmp/vscode-datalog-other'), 'sibling');
    });
    (0, runner_1.test)('rejects an unrelated path', () => (0, runner_1.notOk)((0, outputPaths_1.isInside)('/tmp/vscode-datalog', '/home/user'), 'outside'));
    (0, runner_1.test)('compares across separator styles', () => {
        (0, runner_1.ok)((0, outputPaths_1.isInside)('C:\\Temp\\vscode-datalog', 'C:/Temp/vscode-datalog/proj'), 'windows');
    });
});
(0, runner_1.suite)('deleteInside', () => {
    (0, runner_1.test)('removes a folder under the root', () => {
        const fs = new FakeFs();
        fs.addDir('/tmp/vscode-datalog/proj');
        fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'x');
        (0, runner_1.ok)((0, outputPaths_1.deleteInside)(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog/proj'), 'deleted');
        (0, runner_1.notOk)(fs.existsSync('/tmp/vscode-datalog/proj/plog.log'), 'contents gone');
    });
    (0, runner_1.test)('refuses to delete outside the root', () => {
        const fs = new FakeFs();
        fs.addDir('/home/user/proj');
        (0, runner_1.notOk)((0, outputPaths_1.deleteInside)(fs, '/tmp/vscode-datalog', '/home/user/proj'), 'refused');
        (0, runner_1.ok)(fs.existsSync('/home/user/proj'), 'still there');
    });
    (0, runner_1.test)('refuses to delete the root itself', () => {
        const fs = new FakeFs();
        fs.addDir('/tmp/vscode-datalog');
        (0, runner_1.notOk)((0, outputPaths_1.deleteInside)(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog'), 'refused');
    });
    (0, runner_1.test)('reports false for a missing target', () => {
        (0, runner_1.notOk)((0, outputPaths_1.deleteInside)(new FakeFs(), '/tmp/vscode-datalog', '/tmp/vscode-datalog/gone'), 'nothing to do');
    });
});
(0, runner_1.suite)('pruneStaleEntries', () => {
    const now = 100 * HOUR;
    function populate() {
        const fs = new FakeFs();
        fs.addDir('/tmp/vscode-datalog');
        fs.addDir('/tmp/vscode-datalog/fresh', now - 1 * HOUR);
        fs.addDir('/tmp/vscode-datalog/yesterday', now - 20 * HOUR);
        fs.addDir('/tmp/vscode-datalog/ancient', now - 400 * HOUR);
        return fs;
    }
    (0, runner_1.test)('removes entries older than the cutoff', () => {
        const fs = populate();
        const removed = (0, outputPaths_1.pruneStaleEntries)(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 12 * HOUR, now);
        (0, runner_1.deepEqual)(removed.sort(), ['ancient', 'yesterday']);
        (0, runner_1.ok)(fs.existsSync('/tmp/vscode-datalog/fresh'), 'fresh kept');
    });
    (0, runner_1.test)('honours the skip list', () => {
        const fs = populate();
        const removed = (0, outputPaths_1.pruneStaleEntries)(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 12 * HOUR, now, ['yesterday']);
        (0, runner_1.deepEqual)(removed, ['ancient']);
        (0, runner_1.ok)(fs.existsSync('/tmp/vscode-datalog/yesterday'), 'skipped entry kept');
    });
    (0, runner_1.test)('does nothing when retention is zero', () => {
        const fs = populate();
        (0, runner_1.deepEqual)((0, outputPaths_1.pruneStaleEntries)(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 0, now), []);
        (0, runner_1.ok)(fs.existsSync('/tmp/vscode-datalog/ancient'), 'kept');
    });
    (0, runner_1.test)('refuses to prune outside the root', () => {
        const fs = populate();
        fs.addDir('/home/user/proj/old', 0);
        (0, runner_1.deepEqual)((0, outputPaths_1.pruneStaleEntries)(fs, '/tmp/vscode-datalog', '/home/user/proj', 12 * HOUR, now), []);
        (0, runner_1.ok)(fs.existsSync('/home/user/proj/old'), 'untouched');
    });
    (0, runner_1.test)('tolerates a missing directory', () => {
        (0, runner_1.deepEqual)((0, outputPaths_1.pruneStaleEntries)(new FakeFs(), '/tmp/vscode-datalog', '/tmp/vscode-datalog', HOUR, now), []);
    });
    (0, runner_1.test)('prunes stale files inside a session folder', () => {
        const fs = new FakeFs();
        fs.addDir('/tmp/vscode-datalog');
        fs.addDir('/tmp/vscode-datalog/proj', now);
        fs.addFile('/tmp/vscode-datalog/proj/datalog_runtime.py', 'x', 0);
        fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'y', 0);
        const removed = (0, outputPaths_1.pruneStaleEntries)(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog/proj', 12 * HOUR, now, ['datalog_runtime.py']);
        (0, runner_1.deepEqual)(removed, ['plog.log']);
        (0, runner_1.ok)(fs.existsSync('/tmp/vscode-datalog/proj/datalog_runtime.py'), 'runtime kept');
    });
});
(0, runner_1.suite)('ensureDir / writeFileIfChanged', () => {
    (0, runner_1.test)('creates a missing directory', () => {
        const fs = new FakeFs();
        (0, runner_1.ok)((0, outputPaths_1.ensureDir)(fs, '/tmp/vscode-datalog/proj'), 'created');
        (0, runner_1.ok)(fs.existsSync('/tmp/vscode-datalog/proj'), 'exists');
    });
    (0, runner_1.test)('reports failure instead of throwing', () => {
        const fs = new FakeFs();
        fs.failWrites = true;
        (0, runner_1.notOk)((0, outputPaths_1.ensureDir)(fs, '/tmp/vscode-datalog/proj'), 'failed cleanly');
    });
    (0, runner_1.test)('writes new content', () => {
        const fs = new FakeFs();
        (0, runner_1.ok)((0, outputPaths_1.writeFileIfChanged)(fs, '/tmp/a.py', 'source'), 'written');
        (0, runner_1.strictEqual)(fs.readFileSync('/tmp/a.py'), 'source');
    });
    (0, runner_1.test)('leaves an identical file untouched so its mtime survives', () => {
        const fs = new FakeFs();
        fs.addFile('/tmp/a.py', 'source', 42);
        (0, runner_1.ok)((0, outputPaths_1.writeFileIfChanged)(fs, '/tmp/a.py', 'source'), 'ok');
        (0, runner_1.strictEqual)(fs.statSync('/tmp/a.py').mtimeMs, 42);
    });
    (0, runner_1.test)('rewrites when the content changed', () => {
        const fs = new FakeFs();
        fs.addFile('/tmp/a.py', 'old', 42);
        (0, runner_1.ok)((0, outputPaths_1.writeFileIfChanged)(fs, '/tmp/a.py', 'new'), 'ok');
        (0, runner_1.strictEqual)(fs.readFileSync('/tmp/a.py'), 'new');
    });
    (0, runner_1.test)('reports failure instead of throwing', () => {
        const fs = new FakeFs();
        fs.failWrites = true;
        (0, runner_1.notOk)((0, outputPaths_1.writeFileIfChanged)(fs, '/tmp/a.py', 'x'), 'failed cleanly');
    });
});
(0, runner_1.suite)('newestMtime', () => {
    (0, runner_1.test)('uses the newest child, not the folder itself', () => {
        const fs = new FakeFs();
        fs.addDir('/tmp/vscode-datalog/proj', 10);
        fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'x', 900);
        (0, runner_1.strictEqual)((0, outputPaths_1.newestMtime)(fs, '/tmp/vscode-datalog/proj'), 900);
    });
    (0, runner_1.test)('falls back to the entry itself when it has no children', () => {
        const fs = new FakeFs();
        fs.addFile('/tmp/vscode-datalog/proj/plog.log', 'x', 500);
        (0, runner_1.strictEqual)((0, outputPaths_1.newestMtime)(fs, '/tmp/vscode-datalog/proj/plog.log'), 500);
    });
    (0, runner_1.test)('keeps a folder that is still in use from being pruned', () => {
        const now = 100 * HOUR;
        const fs = new FakeFs();
        fs.addDir('/tmp/vscode-datalog');
        fs.addDir('/tmp/vscode-datalog/inuse', now - 500 * HOUR);
        fs.addFile('/tmp/vscode-datalog/inuse/datalog_runtime.py', 'x', now - 1 * HOUR);
        (0, runner_1.deepEqual)((0, outputPaths_1.pruneStaleEntries)(fs, '/tmp/vscode-datalog', '/tmp/vscode-datalog', 12 * HOUR, now), []);
        (0, runner_1.ok)(fs.existsSync('/tmp/vscode-datalog/inuse/datalog_runtime.py'), 'kept');
    });
});
(0, runner_1.suite)('writeFileIfChanged - forced rewrite', () => {
    (0, runner_1.test)('force rewrites an identical file so its mtime moves', () => {
        const fs = new FakeFs();
        fs.addFile('/tmp/a.py', 'source', 42);
        (0, runner_1.ok)((0, outputPaths_1.writeFileIfChanged)(fs, '/tmp/a.py', 'source', true), 'ok');
        (0, runner_1.ok)(fs.statSync('/tmp/a.py').mtimeMs !== 42, 'mtime refreshed');
    });
});
//# sourceMappingURL=outputPaths.test.js.map