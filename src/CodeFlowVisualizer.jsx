import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import html2canvas from 'html2canvas';
import {
  Copy, Download, ZoomIn, ZoomOut, RefreshCw, Globe, Image as ImageIcon,
  ChevronDown, ChevronRight, Activity, Maximize2, FileCode,
} from 'lucide-react';
import { detectLanguage, buildAST, computeStats, KIND } from './flowEngine';
import { layoutAST } from './layoutEngine';
import { SAMPLES } from './samples';
import './App.css';

const COLORS = {
  if: '#f0a92e', elif: '#f0a92e', loop: '#2fb59f', switch: '#3fa7d6', try: '#e0605f',
  function: '#a480e8', class: '#a480e8', return: '#5a86d6', break: '#e0605f',
  continue: '#e0605f', stmt: '#7d8494', start: '#4caf78',
};
const colorFor = (k) => COLORS[k] || COLORS.stmt;

// wrap-aware multiline text inside a shape
function NodeText({ el, dark = true }) {
  const lines = el.lines || [el.label];
  const lh = 15;
  const startY = el.y + el.h / 2 - ((lines.length - 1) * lh) / 2;
  return (
    <text textAnchor="middle" fontFamily='"SF Mono", Menlo, monospace' fontSize="12.5" fill={dark ? '#e9eaf0' : '#14141a'} style={{ pointerEvents: 'none' }}>
      {lines.map((ln, i) => (
        <tspan key={i} x={el.x + el.w / 2} y={startY + i * lh + 4}>{ln}</tspan>
      ))}
    </text>
  );
}

function Diamond({ el, selected, hovered, onClick, onEnter, onLeave }) {
  const { x, y, w, h, id, kind } = el;
  const pts = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
  const active = selected === id;
  return (
    <g onClick={() => onClick(id)} onMouseEnter={() => onEnter(id)} onMouseLeave={onLeave} style={{ cursor: 'pointer' }}>
      <polygon points={pts} fill={active ? '#fff' : `${colorFor(kind)}26`} stroke={colorFor(kind)} strokeWidth={active || hovered === id ? 3 : 2} />
      <NodeText el={el} dark={!active} />
    </g>
  );
}

function Box({ el, selected, hovered, onClick, onEnter, onLeave }) {
  const { x, y, w, h, id, kind, shape } = el;
  const rx = shape === 'stadium' ? h / 2 : shape === 'jump' ? 6 : 9;
  const active = selected === id;
  const dashed = shape === 'jump';
  return (
    <g onClick={() => onClick(id)} onMouseEnter={() => onEnter(id)} onMouseLeave={onLeave} style={{ cursor: 'pointer' }}>
      <rect x={x} y={y} width={w} height={h} rx={rx}
        fill={active ? '#fff' : `${colorFor(kind)}1c`} stroke={colorFor(kind)}
        strokeWidth={active || hovered === id ? 3 : 1.7} strokeDasharray={dashed ? '5 4' : 'none'} />
      <NodeText el={el} dark={!active} />
    </g>
  );
}

function Container({ el, selected, hovered, onClick, onEnter, onLeave, onToggle }) {
  const { x, y, w, h, id, collapsed, childCount } = el;
  const active = selected === id;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={9}
        fill={active ? '#fff' : `${colorFor('function')}30`} stroke={colorFor('function')}
        strokeWidth={active || hovered === id ? 3 : 1.8}
        onClick={() => onClick(id)} onMouseEnter={() => onEnter(id)} onMouseLeave={onLeave} style={{ cursor: 'pointer' }} />
      <g transform={`translate(${x + 8}, ${y + h / 2 - 9})`} onClick={(e) => { e.stopPropagation(); onToggle(id); }} style={{ cursor: 'pointer' }}>
        <circle cx="9" cy="9" r="9" fill="#00000055" />
        <path d={collapsed ? 'M6,5 L12,9 L6,13 Z' : 'M5,7 L13,7 L9,13 Z'} fill="#fff" />
      </g>
      <text x={x + w / 2 + 8} y={y + h / 2 + 4} textAnchor="middle" fontFamily='"SF Mono", monospace' fontSize="12.5" fill={active ? '#14141a' : '#e9eaf0'} fontWeight="600" style={{ pointerEvents: 'none' }}>
        {el.label}{collapsed && childCount ? `  {…${childCount}}` : ''}
      </text>
    </g>
  );
}

function Edge({ edge, dim }) {
  const { from, to, label, kind } = edge;
  const isJump = kind === 'jump';
  const isLoop = kind === 'loopback';
  let d, lx, ly;
  if (isLoop) {
    const mx = Math.max(from.x, to.x) + 55;
    d = `M ${from.x} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${to.x} ${to.y}`;
    lx = mx - 8; ly = (from.y + to.y) / 2;
  } else if (isJump) {
    const mx = Math.min(from.x, to.x) - 40 - Math.abs(from.y - to.y) * 0.04;
    d = `M ${from.x} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${to.x} ${to.y}`;
    lx = mx + 4; ly = (from.y + to.y) / 2;
  } else {
    const my = (from.y + to.y) / 2;
    d = `M ${from.x} ${from.y} C ${from.x} ${my}, ${to.x} ${my}, ${to.x} ${to.y}`;
    lx = (from.x + to.x) / 2; ly = my;
  }
  const stroke = isJump ? '#e0605f' : kind === 'branch' ? '#f0a92ebb' : '#69707e';
  return (
    <g opacity={dim ? 0.25 : 1}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={isJump ? 1.6 : 1.8}
        strokeDasharray={isJump ? '4 4' : 'none'} markerEnd={`url(#arrow-${isJump ? 'jump' : 'norm'})`} />
      {label && (
        <>
          <rect x={lx - label.length * 3.4 - 5} y={ly - 9} width={label.length * 6.8 + 10} height={17} rx={4} fill="#191921" stroke={isJump ? '#e0605f55' : '#33333f'} />
          <text x={lx} y={ly + 3.5} fontSize="10.5" textAnchor="middle" fill={isJump ? '#f3a3a3' : '#d6d9e0'}>{label}</text>
        </>
      )}
    </g>
  );
}

export default function CodeFlowVisualizer() {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState(null);
  const [ast, setAst] = useState(null);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const panStart = useRef(null);
  const captureRef = useRef(null);
  const viewportRef = useRef(null);
  const ctxRef = useRef(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const c = document.createElement('canvas').getContext('2d');
      c.font = '12.5px "SF Mono", Menlo, monospace';
      ctxRef.current = c;
    }
    return ctxRef.current;
  }, []);

  const layout = useMemo(() => (ast ? layoutAST(ast, getCtx(), collapsed) : null), [ast, collapsed, getCtx]);

  const fitToView = useCallback((lo = layout) => {
    if (!lo || !viewportRef.current) return;
    const vw = viewportRef.current.clientWidth - 48;
    const vh = viewportRef.current.clientHeight - 48;
    const z = Math.min(1, Math.min(vw / lo.width, vh / lo.height));
    setZoom(+z.toFixed(3));
    setPan({ x: (viewportRef.current.clientWidth - lo.width * z) / 2, y: 24 });
  }, [layout]);

  const handleVisualize = () => {
    if (!code.trim()) return;
    const lang = detectLanguage(code);
    const tree = buildAST(code, lang);
    setLanguage(lang); setAst(tree); setStats(computeStats(tree));
    setSelected(null); setCollapsed(new Set());
    const lo = layoutAST(tree, getCtx(), new Set());
    setTimeout(() => fitToView(lo), 0);
  };

  useEffect(() => { if (layout && ast) { /* keep view on collapse */ } }, [layout, ast]);

  const toggleCollapse = useCallback((id) => setCollapsed((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  }), []);

  const onDown = (e) => { if (e.button !== 0) return; setPanning(true); panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; };
  const onMove = (e) => { if (panning && panStart.current) setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y }); };
  const onUp = () => { setPanning(false); panStart.current = null; };
  const onWheel = (e) => { e.preventDefault(); const d = e.deltaY > 0 ? -0.08 : 0.08; setZoom((z) => Math.min(2.4, Math.max(0.25, +(z + d).toFixed(2)))); };

  const exportPng = async () => {
    if (!captureRef.current) return;
    try {
      setDownloading(true);
      const canvas = await html2canvas(captureRef.current, { scale: 2, backgroundColor: '#14141a', useCORS: true, logging: false });
      canvas.toBlob((blob) => { const a = document.createElement('a'); a.download = `flowstruct_${Date.now()}.png`; a.href = URL.createObjectURL(blob); a.click(); });
    } finally { setDownloading(false); }
  };

  const findNode = useCallback((id, nodes = ast || []) => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const kids = [...(n.body || []), ...(n.elseSeq || []), ...(n.catchSeq || []), ...((n.elifs || []).flatMap((e) => e.seq))];
      const f = findNode(id, kids); if (f) return f;
    }
    return null;
  }, [ast]);
  const selNode = selected ? findNode(selected) : null;

  const loadSample = (lang) => { setCode(SAMPLES[lang]); };

  return (
    <div className="fs-app">
      <header className="fs-header">
        <h1>FlowStruct</h1>
        <p>Paste code — get a real control-flow chart. Conditions, loops, and jumps, not just boxed-up lines.</p>
      </header>

      <section className="fs-input">
        <div className="fs-input-bar">
          <button onClick={() => navigator.clipboard.writeText(code)} title="Copy"><Copy size={17} /></button>
          <button onClick={() => { const b = new Blob([code], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'source.txt'; a.click(); }} title="Download source"><Download size={17} /></button>
          <div className="fs-samples">
            <FileCode size={15} />
            {Object.keys(SAMPLES).map((l) => <button key={l} className="fs-sample-btn" onClick={() => loadSample(l)}>{l}</button>)}
          </div>
          {language && <span className="fs-lang"><Globe size={13} /> {language.toUpperCase()}</span>}
        </div>
        <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} rows={9}
          placeholder="Paste code (Python, JavaScript, Java, Ruby, C++) — or load a sample above…" />
        <button className="fs-run" onClick={handleVisualize}>Visualize Flow</button>
      </section>

      <section className="fs-work">
        <div className="fs-canvas-wrap">
          <div className="fs-controls">
            <button onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.15).toFixed(2)))} title="Zoom in"><ZoomIn size={17} /></button>
            <button onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.15).toFixed(2)))} title="Zoom out"><ZoomOut size={17} /></button>
            <button onClick={() => fitToView()} title="Fit to view" disabled={!layout}><Maximize2 size={17} /></button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset"><RefreshCw size={17} /></button>
            <button onClick={exportPng} title="Export PNG" disabled={!layout || downloading}>{downloading ? '…' : <ImageIcon size={17} />}</button>
          </div>
          <div className="fs-legend">
            <span><i style={{ background: COLORS.if }} />decision</span>
            <span><i style={{ background: COLORS.loop }} />loop</span>
            <span><i style={{ background: COLORS.function }} />function</span>
            <span><i style={{ background: COLORS.break }} />jump</span>
          </div>

          <div ref={viewportRef} className="fs-viewport" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel} style={{ cursor: panning ? 'grabbing' : 'grab' }}>
            {!layout && <div className="fs-empty">Paste code and hit <b>Visualize Flow</b> — or try a sample.</div>}
            {layout && (
              <div ref={captureRef} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: layout.width, height: layout.height }}>
                <svg width={layout.width + 60} height={layout.height + 40} style={{ overflow: 'visible' }}>
                  <defs>
                    <marker id="arrow-norm" markerWidth="9" markerHeight="7" refX="7.5" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="#69707e" /></marker>
                    <marker id="arrow-jump" markerWidth="9" markerHeight="7" refX="7.5" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="#e0605f" /></marker>
                  </defs>
                  {layout.elements.filter((e) => e.kind === 'containerBox').map((el) => (
                    <rect key={el.id} x={el.x} y={el.y} width={el.w} height={el.h} rx={13} fill="none" stroke={`${colorFor('function')}55`} strokeDasharray="6 5" strokeWidth={1.5} />
                  ))}
                  {layout.edges.map((e, i) => <Edge key={i} edge={e} dim={false} />)}
                  {layout.elements.filter((e) => e.kind !== 'containerBox').map((el) => {
                    const common = { el, selected, hovered, onClick: (id) => setSelected((p) => p === id ? null : id), onEnter: setHovered, onLeave: () => setHovered(null) };
                    if (el.shape === 'diamond') return <Diamond key={el.id} {...common} />;
                    if (el.shape === 'containerHeader') return <Container key={el.id} {...common} onToggle={toggleCollapse} />;
                    return <Box key={el.id} {...common} />;
                  })}
                </svg>
              </div>
            )}
          </div>
          <div className="fs-hint">scroll = zoom · drag = pan · click a function ▸ to collapse · {layout ? `${Math.round(zoom * 100)}%` : ''}</div>
        </div>

        <aside className="fs-sidebar">
          {selNode && (
            <div className="fs-card">
              <h3>Selected node</h3>
              <div className="fs-kind-tag" style={{ borderColor: colorFor(selNode.kind), color: colorFor(selNode.kind) }}>{selNode.kind}</div>
              <pre>{selNode.text}</pre>
            </div>
          )}
          {stats && (
            <div className="fs-card">
              <h3><Activity size={14} /> Flow stats</h3>
              <Stat label="Total nodes" val={stats.total} />
              <Stat label="Decision points" val={stats.decisions} />
              <Stat label="Functions" val={stats.functions} />
              <Stat label="Loops" val={stats.loops} />
              <Stat label="Max nesting" val={stats.maxDepth} />
              <Stat label="Cyclomatic complexity" val={stats.cyclomatic} accent={stats.cyclomatic > 10} />
              {stats.cyclomatic > 10 && <div className="fs-warn">High complexity — consider splitting this up.</div>}
            </div>
          )}
          {!stats && <div className="fs-card fs-muted">Flow stats appear here after you visualize.</div>}
        </aside>
      </section>
    </div>
  );
}

function Stat({ label, val, accent }) {
  return <div className="fs-stat"><span>{label}</span><span className={accent ? 'fs-stat-hot' : ''}>{val}</span></div>;
}

