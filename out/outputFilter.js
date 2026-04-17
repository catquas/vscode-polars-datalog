"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TracebackFilter = void 0;
const TRACEBACK_START = /^Traceback \(most recent call last\):/;
const FRAME_FILE_RE = /^  File "(.*?)", line \d+, in /;
/**
 * Stateful filter for a stream of Python stdout/stderr output.
 *
 * Pass-through behaviour for normal text.
 * For tracebacks it strips every frame whose source file is outside the
 * workspace root (i.e. installed packages and stdlib), keeping only the
 * "Traceback ..." header, workspace frames, and the final exception line.
 * If every frame belongs to external code a one-line note is inserted so
 * the traceback still makes sense.
 */
class TracebackFilter {
    constructor(wsRoot) {
        this.lineBuffer = '';
        this.inTraceback = false;
        this.tracebackLines = [];
        this.wsRoot = wsRoot.replace(/\\/g, '/');
    }
    /**
     * Feed a chunk of output text (may be partial lines).
     * Returns the filtered text for all complete lines received so far.
     */
    feed(chunk) {
        this.lineBuffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const parts = this.lineBuffer.split('\n');
        this.lineBuffer = parts.pop() ?? ''; // incomplete last line stays buffered
        return this.processLines(parts);
    }
    /**
     * Call at end of session to flush any buffered content.
     */
    flush() {
        const remaining = this.lineBuffer;
        this.lineBuffer = '';
        let out = this.processLines(remaining ? [remaining] : []);
        if (this.inTraceback) {
            const tb = this.emitTraceback();
            if (tb.length > 0) {
                out += tb.join('\n') + '\n';
            }
            this.inTraceback = false;
            this.tracebackLines = [];
        }
        return out;
    }
    processLines(lines) {
        const out = [];
        for (const line of lines) {
            if (!this.inTraceback) {
                if (TRACEBACK_START.test(line)) {
                    this.inTraceback = true;
                    this.tracebackLines = [line];
                }
                else {
                    out.push(line);
                }
            }
            else {
                // Lines inside a traceback are either:
                //   "  File ..." / "    <code>"  — frame lines (two-space or four-space indent)
                //   ""                           — blank separator (e.g. between chained tracebacks)
                //   anything else                — the final exception line; ends the traceback
                if (line.startsWith('  ') || line === '') {
                    this.tracebackLines.push(line);
                }
                else {
                    this.tracebackLines.push(line); // exception line
                    out.push(...this.emitTraceback());
                    this.inTraceback = false;
                    this.tracebackLines = [];
                }
            }
        }
        return out.map(l => l + '\n').join('');
    }
    emitTraceback() {
        const lines = this.tracebackLines;
        if (lines.length === 0) {
            return [];
        }
        const result = [lines[0]]; // "Traceback (most recent call last):"
        let keptFrames = 0;
        let i = 1;
        while (i < lines.length) {
            const line = lines[i];
            const m = FRAME_FILE_RE.exec(line);
            if (m) {
                const filePath = m[1].replace(/\\/g, '/');
                const inWorkspace = filePath.startsWith(this.wsRoot + '/') || filePath === this.wsRoot;
                if (inWorkspace) {
                    result.push(line);
                    keptFrames++;
                    // Include the following code line (4-space indent) if present
                    if (i + 1 < lines.length && lines[i + 1].startsWith('    ')) {
                        result.push(lines[i + 1]);
                        i += 2;
                    }
                    else {
                        i++;
                    }
                }
                else {
                    // External frame: skip File line and its code line
                    i++;
                    if (i < lines.length && lines[i].startsWith('    ')) {
                        i++;
                    }
                }
            }
            else {
                // Blank line, "During handling..." continuation, or final exception line
                result.push(line);
                i++;
            }
        }
        if (keptFrames === 0 && result.length > 1) {
            // All frames are in external code — insert a note so the output isn't confusing
            result.splice(1, 0, '  (error originates in external package — no project frames)');
        }
        return result;
    }
}
exports.TracebackFilter = TracebackFilter;
//# sourceMappingURL=outputFilter.js.map