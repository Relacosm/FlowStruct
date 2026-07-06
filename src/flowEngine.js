// flowEngine.js
// Control-flow parsing for FlowStruct.
//   1. mask strings/comments so braces inside them don't break nesting
//   2. compute per-line depth (indent for Python, end-stack for Ruby, braces otherwise)
//   3. build a real block tree (if/elif/else, loops, functions as parents)
//   4. extract a CLEAN human label per node + tag jumps (return/break/continue)
//      with their enclosing loop/function so the layout can route them properly.

export const KIND = {
  FUNCTION: 'function', CLASS: 'class', IF: 'if', ELIF: 'elif', ELSE: 'else',
  LOOP: 'loop', TRY: 'try', CATCH: 'catch', SWITCH: 'switch', CASE: 'case',
  RETURN: 'return', BREAK: 'break', CONTINUE: 'continue', STMT: 'stmt', START: 'start',
};

// ---------- language detection ----------

export const detectLanguage = (code) => {
  const c = code.trim();
  const scores = {
    python: [/\bprint\s*\(/, /\bdef\s+\w+\s*\(/, /:\s*(#.*)?$/m, /\bimport\s+\w+/, /\belif\b/, /\bself\b/],
    javascript: [/\bconsole\.\w+\s*\(/, /\b(const|let|var)\s+\w+/, /\bfunction\b|=>/, /\bimport\b.*\bfrom\b/, /;\s*$/m],
    ruby: [/\bputs\s+/, /\bdef\s+\w+/, /\bend\b/, /\bdo\s*\|/, /\belsif\b/, /\.each\b/],
    java: [/System\.out\.print/, /\bpublic\s+(static\s+)?\w+/, /\bclass\s+\w+\s*\{/, /\bimport\s+\w+\./, /;\s*$/m],
    cpp: [/std::\w+/, /#include\s*<\w+>/, /\bint\s+main\s*\(/, /\bcout\b/, /->/],
  };
  const ranked = Object.entries(scores)
    .map(([lang, tests]) => [lang, tests.filter((t) => t.test(c)).length])
    .sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : 'javascript';
};

// ---------- comment / string masking (preserves positions + newlines) ----------

function maskStringsAndComments(code, language) {
  const braceStyle = ['javascript', 'java', 'cpp'].includes(language);
  let out = '';
  for (let i = 0; i < code.length;) {
    const ch = code[i];
    const two = code.slice(i, i + 2);
    if ((braceStyle && two === '//') || (!braceStyle && ch === '#')) {
      while (i < code.length && code[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (braceStyle && two === '/*') {
      out += '  '; i += 2;
      while (i < code.length && code.slice(i, i + 2) !== '*/') { out += code[i] === '\n' ? '\n' : ' '; i++; }
      if (i < code.length) { out += '  '; i += 2; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; out += ' '; i++;
      while (i < code.length && code[i] !== q) {
        if (code[i] === '\\') { out += '  '; i += 2; continue; }
        out += code[i] === '\n' ? '\n' : ' '; i++;
      }
      if (i < code.length) { out += ' '; i++; }
      continue;
    }
    out += ch; i++;
  }
  return out;
}

// ---------- line classification ----------

function classifyLine(t, language) {
  const rules = {
    python: [
      [/^def\s+\w+/, KIND.FUNCTION], [/^class\s+\w+/, KIND.CLASS],
      [/^if\b.*:/, KIND.IF], [/^elif\b.*:/, KIND.ELIF], [/^else\s*:/, KIND.ELSE],
      [/^(for|while)\b.*:/, KIND.LOOP], [/^match\b.*:/, KIND.SWITCH], [/^case\b.*:/, KIND.CASE],
      [/^try\s*:/, KIND.TRY], [/^except\b.*:/, KIND.CATCH],
      [/^return\b/, KIND.RETURN], [/^break\b/, KIND.BREAK], [/^continue\b/, KIND.CONTINUE],
    ],
    ruby: [
      [/^def\s+\w+/, KIND.FUNCTION], [/^class\s+\w+/, KIND.CLASS],
      [/^if\b/, KIND.IF], [/^elsif\b/, KIND.ELIF], [/^else\b/, KIND.ELSE],
      [/^(for|while|until)\b/, KIND.LOOP], [/\bdo\s*(\|[^|]*\|)?\s*$/, KIND.LOOP],
      [/^case\b/, KIND.SWITCH], [/^when\b/, KIND.CASE],
      [/^begin\b/, KIND.TRY], [/^rescue\b/, KIND.CATCH],
      [/^return\b/, KIND.RETURN], [/^break\b/, KIND.BREAK], [/^next\b/, KIND.CONTINUE],
    ],
    _brace: [
      // control keywords FIRST so a greedy function-signature regex can't steal them
      [/^(\}\s*)?else\s+if\s*\(/, KIND.ELIF], [/^(\}\s*)?else\b/, KIND.ELSE],
      [/^if\s*\(/, KIND.IF], [/^(for|while)\s*\(/, KIND.LOOP],
      [/^switch\s*\(/, KIND.SWITCH], [/^case\b|^default\s*:?$/, KIND.CASE],
      [/^try\b/, KIND.TRY], [/^(\}\s*)?catch\b/, KIND.CATCH],
      [/^return\b/, KIND.RETURN], [/^break\b/, KIND.BREAK], [/^continue\b/, KIND.CONTINUE],
      [/^(export\s+)?(default\s+)?(async\s+)?function\b/, KIND.FUNCTION],
      [/^(const|let|var)\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>/, KIND.FUNCTION],
      [/^(export\s+)?(public\s+|private\s+)?(abstract\s+)?class\s+\w+/, KIND.CLASS],
      [/^(public|private|protected|static|final|\s)*[\w<>\[\],\s]+\s+\w+\s*\([^)]*\)\s*$/, KIND.FUNCTION],
    ],
  };
  const set = rules[language] || rules._brace;
  for (const [re, kind] of set) if (re.test(t)) return kind;
  return KIND.STMT;
}

const isOpener = (k) => [KIND.FUNCTION, KIND.CLASS, KIND.IF, KIND.ELIF, KIND.ELSE, KIND.LOOP, KIND.TRY, KIND.CATCH, KIND.SWITCH, KIND.CASE].includes(k);
const isContinuation = (k) => [KIND.ELIF, KIND.ELSE, KIND.CATCH].includes(k);

// ---------- clean label extraction (the thing that makes it read like a flowchart) ----------

function balancedParen(s) {
  const start = s.indexOf('(');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return s.slice(start + 1, i).trim(); }
  }
  return s.slice(start + 1).trim();
}

function stripTail(s) {
  return s.replace(/[:{]\s*$/, '').replace(/;\s*$/, '').trim();
}

export function makeLabel(kind, raw, language) {
  const t = raw.trim();
  switch (kind) {
    case KIND.FUNCTION: {
      // grab name(args) — drop def/function/modifiers and trailing brace/colon
      let s = t.replace(/^\s*(export\s+)?(default\s+)?(public|private|protected|static|final|async|def|function)\s+/g, '');
      s = s.replace(/^(public|private|protected|static|final|async|def|function)\s+/g, '');
      s = s.replace(/\s*=>.*$/, '').replace(/\s*=\s*\(?.*/, (m) => m.includes('(') ? m : '');
      const nameMatch = t.match(/(\w+)\s*\(/);
      const args = balancedParen(t);
      if (nameMatch) return `${nameMatch[1]}(${args !== null ? args : ''})`;
      return stripTail(s) || t;
    }
    case KIND.CLASS: {
      const m = t.match(/class\s+(\w+)/);
      return m ? `class ${m[1]}` : stripTail(t);
    }
    case KIND.IF: case KIND.ELIF: {
      let cond;
      if (t.includes('(')) cond = balancedParen(t);
      else cond = t.replace(/^\s*(\}?\s*else\s+)?(else\s+)?(el?s?if|if|elsif)\s+/i, '').replace(/:\s*$/, '').trim();
      cond = (cond || t).replace(/\s+/g, ' ');
      return `${cond}?`;
    }
    case KIND.LOOP: {
      let s = stripTail(t);
      if (t.includes('(')) {
        const inner = balancedParen(t);
        const kw = t.match(/^\s*(for|while)/i);
        s = `${kw ? kw[1] : 'loop'} (${inner})`;
      }
      return s;
    }
    case KIND.SWITCH: {
      const inner = t.includes('(') ? balancedParen(t) : stripTail(t).replace(/^(switch|match|case)\s+/, '');
      return `switch ${inner}`;
    }
    case KIND.CASE: return stripTail(t);
    case KIND.ELSE: return 'else';
    case KIND.TRY: return 'try';
    case KIND.CATCH: {
      const inner = t.includes('(') ? balancedParen(t) : '';
      return inner ? `catch (${inner})` : stripTail(t).replace(/^(except|rescue)\s*/, 'catch ') || 'catch';
    }
    case KIND.RETURN: return stripTail(t);
    case KIND.BREAK: return 'break';
    case KIND.CONTINUE: return language === 'ruby' ? 'next' : 'continue';
    default: return stripTail(t);
  }
}

// ---------- depth computation → flat classified lines ----------

function computeLines(code, language) {
  const masked = maskStringsAndComments(code, language);
  const rawLines = code.split('\n');
  const maskedLines = masked.split('\n');
  const out = [];

  if (language === 'python') {
    const stack = [0];
    for (const raw of rawLines) {
      if (!raw.trim()) continue;
      const indent = raw.match(/^\s*/)[0].replace(/\t/g, '    ').length;
      while (stack.length > 1 && indent < stack[stack.length - 1]) stack.pop();
      if (indent > stack[stack.length - 1]) stack.push(indent);
      out.push({ text: raw.trim(), depth: stack.length - 1, kind: classifyLine(raw.trim(), language) });
    }
    return out;
  }

  if (language === 'ruby') {
    let depth = 0;
    const opens = /(^|[^.\w])(def|class|module|do|if|unless|while|until|begin|case)([^.\w]|$)/;
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i]; const m = (maskedLines[i] || '').trim();
      if (!raw.trim()) continue;
      if (/^end\b/.test(m)) { depth = Math.max(0, depth - 1); continue; }
      const kind = classifyLine(raw.trim(), language);
      const d = isContinuation(kind) ? Math.max(0, depth - 1) : depth;
      out.push({ text: raw.trim(), depth: d, kind });
      const isInlineMod = /\b(if|unless|while|until)\b.*\bthen\b|\bend\s*$/.test(m);
      if (opens.test(m) && !isInlineMod) depth++;
    }
    return out;
  }

  // brace languages: statement-split on { } ; so inline blocks like
  // `if (x) { break; }` become properly-nested separate nodes.
  let depth = 0;
  let paren = 0; // () and [] nesting — delimiters only fire at paren==0
  let bufStart = -1;
  const flush = (endIdx, d) => {
    if (bufStart === -1) return;
    const realText = code.slice(bufStart, endIdx).trim();
    const maskedText = masked.slice(bufStart, endIdx).trim();
    bufStart = -1;
    if (!maskedText) return;
    out.push({ text: realText, depth: Math.max(0, d), kind: classifyLine(realText, language) });
  };
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[') { paren++; if (bufStart === -1) bufStart = i; continue; }
    if (ch === ')' || ch === ']') { paren = Math.max(0, paren - 1); continue; }
    if (paren > 0) { continue; } // inside parens: never a delimiter
    if (ch === '{') { flush(i, depth); depth++; }
    else if (ch === '}') { flush(i, depth); depth = Math.max(0, depth - 1); }
    else if (ch === ';') { flush(i, depth); }
    else if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') { if (bufStart === -1) continue; }
    else if (bufStart === -1) { bufStart = i; }
  }
  flush(masked.length, depth);
  return out;
}

// ---------- tree builder ----------

let idc = 0;
const nextId = () => `n${idc++}`;

export function buildAST(code, language) {
  idc = 0;
  const lines = computeLines(code, language);
  const rootSeq = [];
  const stack = [{ depth: -1, seq: rootSeq, lastIf: null, loopId: null, funcId: null }];

  for (const line of lines) {
    while (stack.length > 1 && line.depth <= stack[stack.length - 1].depth) stack.pop();
    const top = stack[stack.length - 1];

    if (isContinuation(line.kind) && top.lastIf) {
      const owner = top.lastIf;
      const seq = [];
      const label = makeLabel(line.kind, line.text, language);
      if (line.kind === KIND.ELIF) (owner.elifs ||= []).push({ label, text: line.text, seq });
      else if (line.kind === KIND.CATCH) owner.catchSeq = seq;
      else owner.elseSeq = seq;
      stack.push({ depth: line.depth + 0.5, seq, lastIf: null, loopId: top.loopId, funcId: top.funcId });
      continue;
    }

    const node = {
      id: nextId(), kind: line.kind, text: line.text,
      label: makeLabel(line.kind, line.text, language),
      loopId: top.loopId, funcId: top.funcId, // enclosure for jump routing
    };
    top.seq.push(node);
    if (line.kind === KIND.IF || line.kind === KIND.TRY) top.lastIf = node;

    if (isOpener(line.kind) && !isContinuation(line.kind)) {
      node.body = [];
      stack.push({
        depth: line.depth, seq: node.body, lastIf: null,
        loopId: line.kind === KIND.LOOP ? node.id : top.loopId,
        funcId: line.kind === KIND.FUNCTION ? node.id : top.funcId,
      });
    }
  }
  return rootSeq;
}

// ---------- stats ----------

export function computeStats(seq) {
  let total = 0, decisions = 0, functions = 0, loops = 0, maxDepth = 0;
  const walk = (nodes, d) => {
    maxDepth = Math.max(maxDepth, d);
    for (const n of nodes) {
      total++;
      if (n.kind === KIND.IF) decisions += 1 + (n.elifs?.length || 0);
      if (n.kind === KIND.LOOP) { decisions++; loops++; }
      if (n.kind === KIND.SWITCH) decisions += Math.max(1, (n.body || []).filter((c) => c.kind === KIND.CASE).length);
      if (n.kind === KIND.FUNCTION) functions++;
      if (n.body) walk(n.body, d + 1);
      if (n.elseSeq) walk(n.elseSeq, d + 1);
      if (n.catchSeq) walk(n.catchSeq, d + 1);
      n.elifs?.forEach((e) => walk(e.seq, d + 1));
    }
  };
  walk(seq, 0);
  return { total, decisions, functions, loops, cyclomatic: decisions + 1, maxDepth };
}
