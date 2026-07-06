// layoutEngine.js
// Recursive tidy-tree layout. Produces absolutely-positioned elements + edges.
// Two edge kinds matter for usefulness:
//   - normal flow / branch edges (built during recursion)
//   - JUMP edges (return→end, break→loop-exit, continue→loop-head) built in a
//     post-pass once every node has an absolute position.

import { KIND } from './flowEngine';

const V_GAP = 52;
const H_GAP = 44;
const PAD_X = 20;
const LINE_H = 17;
const MIN_W = 150;
const MAX_W = 300;
const DIAMOND_MIN_H = 66;

// wrap text into <= maxChars lines (cap 4), returns array of strings
export function wrapText(text, maxChars, cap = 4) {
  if (text.length <= maxChars) return [text];
  const words = text.split(/(?<=[\s,(){}=<>+\-*/|&.])/); // keep delimiters
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + w).length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur += w;
    if (lines.length >= cap) break;
  }
  if (cur && lines.length < cap) lines.push(cur);
  if (lines.length >= cap && (cur || words.length)) {
    lines[cap - 1] = (lines[cap - 1] || '').slice(0, maxChars - 1) + '…';
  }
  return lines.slice(0, cap);
}

function measure(text, ctx) {
  const raw = ctx ? (() => { try { return ctx.measureText(text).width + 2 * PAD_X; } catch { return text.length * 7.3 + 2 * PAD_X; } })() : text.length * 7.3 + 2 * PAD_X;
  return Math.max(MIN_W, Math.min(MAX_W, raw));
}

function nodeBox(node, ctx) {
  const isDiamond = [KIND.IF, KIND.ELIF, KIND.LOOP, KIND.SWITCH, KIND.TRY].includes(node.kind);
  let w = measure(node.label, ctx);
  // a rhombus only offers ~55% of its width at the vertical centre, so pad diamonds
  const maxChars = Math.floor((w - 2 * PAD_X) / 7.3);
  const lines = wrapText(node.label, Math.max(10, maxChars), node.kind === KIND.FUNCTION || node.kind === KIND.CLASS ? 2 : 3);
  const textH = lines.length * LINE_H;
  if (isDiamond) w = Math.min(MAX_W + 90, w * 1.5 + 20);
  const h = isDiamond ? Math.max(DIAMOND_MIN_H, textH + 44) : Math.max(48, textH + 22);
  return { w, h, lines };
}

function shapeFor(kind) {
  if ([KIND.IF, KIND.LOOP, KIND.SWITCH, KIND.TRY].includes(kind)) return 'diamond';
  if (kind === KIND.FUNCTION || kind === KIND.CLASS) return 'container';
  if (kind === KIND.RETURN) return 'stadium';
  if ([KIND.BREAK, KIND.CONTINUE].includes(kind)) return 'jump';
  return 'rect';
}

// shift a subtree result by (dx,dy)
function shift(r, dx, dy) {
  r.elements.forEach((e) => { e.x += dx; e.y += dy; });
  r.edges.forEach((e) => { e.from = { ...e.from, x: e.from.x + dx, y: e.from.y + dy }; e.to = { ...e.to, x: e.to.x + dx, y: e.to.y + dy }; });
  if (r.entry) r.entry = { ...r.entry, x: r.entry.x + dx, y: r.entry.y + dy };
  r.exits = r.exits.map((ex) => ({ ...ex, x: ex.x + dx, y: ex.y + dy }));
}
function center(r, cx) { shift(r, cx - r.width / 2, 0); }

function emptyResult() {
  return { width: MIN_W, height: 0, elements: [], edges: [], entry: null, exits: [{ x: MIN_W / 2, y: 0, label: null }] };
}

function layoutSequence(seq, ctx, collapsed) {
  if (!seq || !seq.length) return emptyResult();
  let width = 0, y = 0, entry = null, pending = [];
  const elements = [], edges = [];
  seq.forEach((node, i) => {
    const r = layoutNode(node, ctx, collapsed);
    width = Math.max(width, r.width);
    shift(r, 0, y);
    elements.push(...r.elements); edges.push(...r.edges);
    if (i === 0) entry = r.entry;
    else pending.forEach((pe) => { if (r.entry) edges.push({ from: pe, to: r.entry, label: pe.label || null, kind: 'flow' }); });
    pending = r.exits;
    y += r.height + (i < seq.length - 1 ? V_GAP : 0);
  });
  return { width, height: y, elements, edges, entry, exits: pending };
}

function layoutNode(node, ctx, collapsed) {
  const shape = shapeFor(node.kind);
  const box = nodeBox(node, ctx);

  if (node.kind === KIND.IF) return layoutIf(node, ctx, collapsed, box);
  if (node.kind === KIND.LOOP) return layoutLoop(node, ctx, collapsed, box);
  if (node.kind === KIND.TRY) return layoutTry(node, ctx, collapsed, box);
  if (node.kind === KIND.SWITCH) return layoutSwitch(node, ctx, collapsed, box);
  if (shape === 'container') return layoutContainer(node, ctx, collapsed, box);

  // leaf (rect / stadium / jump)
  const el = {
    id: node.id, kind: node.kind, shape, label: node.label, text: node.text,
    lines: box.lines, x: 0, y: 0, w: box.w, h: box.h,
    loopId: node.loopId, funcId: node.funcId,
  };
  // return / break / continue are TERMINAL — no normal outgoing flow edge
  const terminal = [KIND.RETURN, KIND.BREAK, KIND.CONTINUE].includes(node.kind);
  return {
    width: box.w, height: box.h, elements: [el], edges: [],
    entry: { x: box.w / 2, y: 0 },
    exits: terminal ? [] : [{ x: box.w / 2, y: box.h, label: null }],
  };
}

function layoutIf(node, ctx, collapsed, box) {
  const branches = [{ label: 'yes', seq: node.body || [] }];
  (node.elifs || []).forEach((e) => branches.push({ label: e.label.replace(/\?$/, '') || 'elif', seq: e.seq }));
  branches.push({ label: 'no', seq: node.elseSeq || [] });

  const rs = branches.map((b) => layoutSequence(b.seq, ctx, collapsed));
  const totalW = rs.reduce((s, r) => s + Math.max(r.width, MIN_W), 0) + H_GAP * (branches.length - 1);
  const width = Math.max(box.w, totalW);
  const dx = width / 2 - box.w / 2;
  const dEl = { id: node.id, kind: node.kind, shape: 'diamond', label: node.label, text: node.text, lines: box.lines, x: dx, y: 0, w: box.w, h: box.h };
  const elements = [dEl]; const edges = []; const exits = [];
  const top = box.h + V_GAP;
  let x = (width - totalW) / 2; let maxH = 0;
  const dBottom = { x: width / 2, y: box.h };
  rs.forEach((r, i) => {
    const bw = Math.max(r.width, MIN_W);
    center(r, x + bw / 2); shift(r, 0, top);
    elements.push(...r.elements); edges.push(...r.edges);
    if (r.entry) { edges.push({ from: dBottom, to: r.entry, label: branches[i].label, kind: 'branch' }); exits.push(...r.exits); }
    else exits.push({ x: x + bw / 2, y: top, label: branches[i].label, passthrough: true, from: dBottom });
    maxH = Math.max(maxH, r.height); x += bw + H_GAP;
  });
  return { width, height: top + maxH, elements, edges, entry: { x: width / 2, y: 0 }, exits };
}

function layoutSwitch(node, ctx, collapsed, box) {
  // cases are children of the switch body; each CASE opens its own mini-sequence
  const cases = [];
  let cur = null;
  (node.body || []).forEach((child) => {
    if (child.kind === KIND.CASE) { cur = { label: child.label.replace(/^case\s*/, '').replace(/:$/, ''), seq: [] }; cases.push(cur); }
    else if (cur) cur.seq.push(child);
    else { cur = { label: '…', seq: [child] }; cases.push(cur); }
  });
  if (!cases.length) cases.push({ label: '', seq: node.body || [] });
  const rs = cases.map((c) => layoutSequence(c.seq, ctx, collapsed));
  const totalW = rs.reduce((s, r) => s + Math.max(r.width, MIN_W), 0) + H_GAP * (cases.length - 1);
  const width = Math.max(box.w, totalW);
  const dEl = { id: node.id, kind: node.kind, shape: 'diamond', label: node.label, text: node.text, lines: box.lines, x: width / 2 - box.w / 2, y: 0, w: box.w, h: box.h };
  const elements = [dEl]; const edges = []; const exits = [];
  const top = box.h + V_GAP; let x = (width - totalW) / 2; let maxH = 0;
  const dBottom = { x: width / 2, y: box.h };
  rs.forEach((r, i) => {
    const bw = Math.max(r.width, MIN_W);
    center(r, x + bw / 2); shift(r, 0, top);
    elements.push(...r.elements); edges.push(...r.edges);
    if (r.entry) { edges.push({ from: dBottom, to: r.entry, label: cases[i].label, kind: 'branch' }); exits.push(...r.exits); }
    else exits.push({ x: x + bw / 2, y: top, label: cases[i].label, passthrough: true, from: dBottom });
    maxH = Math.max(maxH, r.height); x += bw + H_GAP;
  });
  return { width, height: top + maxH, elements, edges, entry: { x: width / 2, y: 0 }, exits };
}

function layoutLoop(node, ctx, collapsed, box) {
  const body = layoutSequence(node.body || [], ctx, collapsed);
  const width = Math.max(box.w + 110, body.width + 110);
  const dEl = { id: node.id, kind: node.kind, shape: 'diamond', label: node.label, text: node.text, lines: box.lines, x: width / 2 - box.w / 2, y: 0, w: box.w, h: box.h, isLoop: true };
  const elements = [dEl]; const edges = [];
  const top = box.h + V_GAP;
  center(body, width / 2); shift(body, 0, top);
  elements.push(...body.elements); edges.push(...body.edges);
  const dBottom = { x: width / 2, y: box.h };
  const dRight = { x: width / 2 + box.w / 2, y: box.h / 2 };
  if (body.entry) {
    edges.push({ from: dBottom, to: body.entry, label: 'do', kind: 'branch' });
    body.exits.forEach((ex) => edges.push({ from: ex, to: dRight, label: null, kind: 'loopback' }));
  }
  return {
    width, height: top + body.height, elements, edges,
    entry: { x: width / 2, y: 0 },
    exits: [{ x: dEl.x, y: box.h / 2, label: 'done', loopExit: true }],
  };
}

function layoutTry(node, ctx, collapsed, box) {
  const t = layoutSequence(node.body || [], ctx, collapsed);
  const c = layoutSequence(node.catchSeq || [], ctx, collapsed);
  const totalW = Math.max(t.width, MIN_W) + H_GAP + Math.max(c.width, MIN_W);
  const width = Math.max(box.w, totalW);
  const dEl = { id: node.id, kind: node.kind, shape: 'diamond', label: node.label, text: node.text, lines: box.lines, x: width / 2 - box.w / 2, y: 0, w: box.w, h: box.h };
  const elements = [dEl]; const edges = []; const exits = [];
  const top = box.h + V_GAP; let x = (width - totalW) / 2;
  const tw = Math.max(t.width, MIN_W), cw = Math.max(c.width, MIN_W);
  center(t, x + tw / 2); shift(t, 0, top); x += tw + H_GAP;
  center(c, x + cw / 2); shift(c, 0, top);
  elements.push(...t.elements, ...c.elements); edges.push(...t.edges, ...c.edges);
  const dBottom = { x: width / 2, y: box.h };
  if (t.entry) { edges.push({ from: dBottom, to: t.entry, label: 'ok', kind: 'branch' }); exits.push(...t.exits); }
  if (c.entry) { edges.push({ from: dBottom, to: c.entry, label: 'error', kind: 'branch' }); exits.push(...c.exits); }
  return { width, height: top + Math.max(t.height, c.height), elements, edges, entry: { x: width / 2, y: 0 }, exits };
}

function layoutContainer(node, ctx, collapsed, box) {
  const isCollapsed = collapsed.has(node.id);
  const header = {
    id: node.id, kind: node.kind, shape: 'containerHeader', label: node.label, text: node.text,
    lines: box.lines, x: 0, y: 0, w: 0, h: 42, collapsed: isCollapsed, childCount: (node.body || []).length,
  };
  if (isCollapsed || !node.body || !node.body.length) {
    const w = Math.max(box.w, MIN_W); header.w = w;
    return { width: w, height: 46, elements: [{ ...header, h: 46 }], edges: [], entry: { x: w / 2, y: 0 }, exits: [{ x: w / 2, y: 46, label: null }] };
  }
  const body = layoutSequence(node.body, ctx, collapsed);
  const pad = 26;
  const width = Math.max(box.w, body.width) + pad * 2;
  header.w = width;
  center(body, width / 2); shift(body, 0, 58);
  const boxEl = { id: node.id + '__box', kind: 'containerBox', x: 0, y: 0, w: width, h: body.height + 74 };
  return {
    width, height: body.height + 74, elements: [boxEl, header, ...body.elements], edges: body.edges,
    entry: { x: width / 2, y: 0 }, exits: body.exits.length ? body.exits : [{ x: width / 2, y: body.height + 74, label: null }],
  };
}

// ---------- top-level + jump-edge post-pass ----------

export function layoutAST(seq, ctx, collapsed) {
  const start = { id: '__start', kind: KIND.START, shape: 'stadium', label: 'Start', lines: ['Start'], x: 0, y: 0, w: 110, h: 46 };
  const end = { id: '__end', kind: KIND.START, shape: 'stadium', label: 'End', lines: ['End'], x: 0, y: 0, w: 110, h: 46 };
  const body = layoutSequence(seq, ctx, collapsed);
  const width = Math.max(body.width, 110);
  center(body, width / 2);
  const elements = []; const edges = []; let y = 0;
  start.x = width / 2 - 55; start.y = 0; y += 46 + V_GAP;
  shift(body, 0, y);
  elements.push(start, ...body.elements); edges.push(...body.edges);
  if (body.entry) edges.push({ from: { x: width / 2, y: 46 }, to: body.entry, label: null, kind: 'flow' });
  y += body.height + V_GAP;
  end.x = width / 2 - 55; end.y = y;
  (body.exits.length ? body.exits : [{ x: width / 2, y }]).forEach((ex) => {
    edges.push({ from: ex, to: { x: width / 2, y: end.y }, label: ex.label || null, kind: ex.passthrough ? 'branch' : 'flow' });
  });
  elements.push(end);
  y += 46;

  // ---- jump edges: use absolute positions now that everything is placed ----
  const posById = {};
  elements.forEach((el) => { if (el.w && el.h) posById[el.id] = el; });
  const endPoint = { x: end.x + 55, y: end.y };
  elements.forEach((el) => {
    if (el.kind === KIND.RETURN) {
      const target = el.funcId && posById[el.funcId + '__box'] ? bottomOf(posById[el.funcId + '__box']) : endPoint;
      edges.push({ from: { x: el.x + el.w / 2, y: el.y + el.h }, to: target, kind: 'jump', label: 'return' });
    } else if (el.kind === KIND.BREAK && el.loopId && posById[el.loopId]) {
      const loop = posById[el.loopId];
      edges.push({ from: { x: el.x + el.w / 2, y: el.y + el.h }, to: { x: loop.x, y: loop.y + loop.h / 2 }, kind: 'jump', label: 'break' });
    } else if (el.kind === KIND.CONTINUE && el.loopId && posById[el.loopId]) {
      const loop = posById[el.loopId];
      edges.push({ from: { x: el.x + el.w / 2, y: el.y + el.h }, to: { x: loop.x + loop.w, y: loop.y + loop.h / 2 }, kind: 'jump', label: 'continue' });
    }
  });

  return { width, height: y, elements, edges };
}

function bottomOf(el) { return { x: el.x + el.w / 2, y: el.y + el.h }; }
