import React, { useState, useRef } from 'react';
import html2canvas from 'html2canvas';
import { Copy, Download, Share2, ZoomIn, ZoomOut, RefreshCw, CodeIcon, Globe, Image } from 'lucide-react';
import './App.css';

// Advanced multi-language code flow parsing
const languageParsers = {
  python: {
    filterLines: (line) => {
      const trimmedLine = line.trim();
      return trimmedLine !== '' && 
             !trimmedLine.startsWith('#') &&
             !trimmedLine.startsWith('import') &&
             !trimmedLine.startsWith('from');
    },
    detectCharacteristics: (line) => ({
      isControlFlow: 
        line.includes('def ') || 
        line.includes('if ') || 
        line.includes('for ') || 
        line.includes('while ') || 
        line.includes('class '),
      isFunction: line.includes('def '),
      isLoop: line.includes('for ') || line.includes('while '),
      isConditional: line.includes('if ') || line.includes('elif') || line.includes('else')
    })
  },
  javascript: {
    filterLines: (line) => {
      const trimmedLine = line.trim();
      return trimmedLine !== '' && 
             !trimmedLine.startsWith('//') &&
             !trimmedLine.startsWith('import') &&
             !trimmedLine.startsWith('export');
    },
    detectCharacteristics: (line) => ({
      isControlFlow: 
        line.includes('function ') || 
        line.includes('const ') && line.includes('=>') ||
        line.includes('if ') || 
        line.includes('for ') || 
        line.includes('while ') || 
        line.includes('class '),
      isFunction: line.includes('function ') || line.includes('=>'),
      isLoop: line.includes('for ') || line.includes('while '),
      isConditional: line.includes('if ') || line.includes('else')
    })
  },
  java: {
    filterLines: (line) => {
      const trimmedLine = line.trim();
      return trimmedLine !== '' && 
             !trimmedLine.startsWith('//') &&
             !trimmedLine.startsWith('import') &&
             !trimmedLine.startsWith('package');
    },
    detectCharacteristics: (line) => ({
      isControlFlow: 
        line.includes('public ') && line.includes('(') ||
        line.includes('if ') || 
        line.includes('for ') || 
        line.includes('while ') || 
        line.includes('class '),
      isFunction: line.includes('public ') && line.includes('(') && line.includes('{'),
      isLoop: line.includes('for ') || line.includes('while '),
      isConditional: line.includes('if ') || line.includes('else')
    })
  },
  ruby: {
    filterLines: (line) => {
      const trimmedLine = line.trim();
      return trimmedLine !== '' && 
             !trimmedLine.startsWith('#') &&
             !trimmedLine.startsWith('require');
    },
    detectCharacteristics: (line) => ({
      isControlFlow: 
        line.includes('def ') || 
        line.includes('if ') || 
        line.includes('do ') || 
        line.includes('end') ||
        line.includes('class '),
      isFunction: line.includes('def '),
      isLoop: line.includes('do ') || line.includes('each '),
      isConditional: line.includes('if ') || line.includes('else')
    })
  },
  cpp: {
    filterLines: (line) => {
      const trimmedLine = line.trim();
      return trimmedLine !== '' && 
             !trimmedLine.startsWith('//') &&
             !trimmedLine.startsWith('#include') &&
             !trimmedLine.startsWith('#define');
    },
    detectCharacteristics: (line) => ({
      isControlFlow: 
        line.includes('void ') || 
        line.includes('int ') && line.includes('(') ||
        line.includes('if ') || 
        line.includes('for ') || 
        line.includes('while ') || 
        line.includes('class '),
      isFunction: line.includes('void ') || line.includes('int ') && line.includes('(') && line.includes('{'),
      isLoop: line.includes('for ') || line.includes('while '),
      isConditional: line.includes('if ') || line.includes('else')
    })
  }
};

// Detect language based on code characteristics
const detectLanguage = (code) => {
  const normalizedCode = code.trim().toLowerCase();

  const languageDetectors = {
    python: [
      /\bprint\s*\(["']/.test(normalizedCode),
      /\bdef\s+\w+\s*\(/.test(normalizedCode),
      /:\s*$/.test(normalizedCode.split('\n').find(line => 
        line.includes('def ') || line.includes('class ') || 
        line.includes('for ') || line.includes('while ')
      ) || ''),
      /\bimport\s+\w+/.test(normalizedCode),
      normalizedCode.includes('__init__'),
    ],
    javascript: [
      /\bconsole\.log\s*\(["']/.test(normalizedCode),
      /\b(const|let|var)\s+\w+\s*=/.test(normalizedCode),
      /\b(function|class)\s+\w+/.test(normalizedCode),
      /=>\s*{?/.test(normalizedCode),
      normalizedCode.includes('export ') || normalizedCode.includes('import '),
    ],
    ruby: [
      /\bputs\s+["']/.test(normalizedCode),
      /\bdef\s+\w+\b/.test(normalizedCode),
      /\bclass\s+\w+\b/.test(normalizedCode),
      /\bdo\s*\|/.test(normalizedCode),
      normalizedCode.includes('end'),
    ],
    java: [
      /System\.out\.println\s*\(["']/.test(normalizedCode),
      /\bpublic\s+(static\s+)?void\s+main/.test(normalizedCode),
      /\bclass\s+\w+\s*{/.test(normalizedCode),
      /\bimport\s+\w+\./.test(normalizedCode),
    ],
    cpp: [
      /\bstd::cout\s*<<\s*["']/.test(normalizedCode),
      /\bint\s+main\s*\(\)/.test(normalizedCode),
      /#include\s*<\w+>/.test(normalizedCode),
      /\bstd::\w+/.test(normalizedCode),
    ]
  };

  const languageScores = Object.fromEntries(
    Object.entries(languageDetectors).map(([lang, detectors]) => [
      lang, 
      detectors.filter(detector => detector).length
    ])
  );

  const detectedLanguage = Object.entries(languageScores)
    .reduce((max, [lang, score]) => 
      score > max.score ? { lang, score } : max, 
      { lang: 'javascript', score: 0 }
    ).lang;
  
  return detectedLanguage;
};

const parseCodeFlow = (code) => {
  const language = detectLanguage(code);
  const languageParser = languageParsers[language] || languageParsers.javascript;

  const lines = code.split('\n')
    .filter(languageParser.filterLines);
  
  const flowNodes = lines.map((line, index) => {
    const characteristics = languageParser.detectCharacteristics(line);

    return {
      id: `node-${index}`,
      content: line.trim(),
      x: index % 2 === 0 ? 50 : 350,
      y: index * 150,
      type: characteristics.isControlFlow ? 'control-flow' : 'standard',
      characteristics,
      language
    };
  });

  const connections = flowNodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: flowNodes[index + 1].id
  }));

  return { 
    flowNodes, 
    connections, 
    language 
  };
};

// Flow Node Component
const FlowNode = ({ node, onNodeClick, isSelected, zoomLevel }) => {
  const [isHovered, setIsHovered] = useState(false);

  const nodeStyle = {
    position: 'absolute',
    left: `${node.x}px`,
    top: `${node.y}px`,
    transform: isHovered 
      ? `scale(${1.05 * zoomLevel}) translateY(-5px)` 
      : `scale(${zoomLevel})`,
    fontSize: `${0.85 * zoomLevel}rem`
  };

  return (
    <div 
      className={`flow-node 
        ${isHovered ? 'hovered' : ''} 
        ${isSelected ? 'highlighted' : ''} 
        ${node.characteristics.isFunction ? 'function-node' : ''} 
        ${node.characteristics.isLoop ? 'loop-node' : ''} 
        ${node.characteristics.isConditional ? 'conditional-node' : ''}`}
      style={nodeStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onNodeClick(node)}
    >
      {node.content}
    </div>
  );
};

// Flow Connection Component
const FlowConnection = ({ from, to, zoomLevel }) => {
  const calculatePath = () => {
    const padding = 20 * zoomLevel;
    return `M${from.x + (from.x < to.x ? 250 : -50)} ${from.y + 25} 
            L${to.x + (from.x < to.x ? -50 : 250)} ${to.y + 25}`;
  };

  return (
    <svg 
      className="flow-connection"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}
    >
      <defs>
        <marker 
          id="arrowhead" 
          markerWidth="10" 
          markerHeight="7" 
          refX="5" 
          refY="3.5" 
          orient="auto"
        >
          <path d="M0,0 L10,3.5 L0,7" fill="#5e81ac" />
        </marker>
      </defs>
      <path
        d={calculatePath()}
        fill="none"
        stroke="#5e81ac"
        strokeWidth={2 * zoomLevel}
        markerEnd="url(#arrowhead)"
        strokeDasharray="5"
        className="animated-connection"
      />
    </svg>
  );
};

// Main Visualizer Component
const CodeFlowVisualizer = () => {
  const [code, setCode] = useState('');
  const [flowData, setFlowData] = useState({ flowNodes: [], connections: [], language: null });
  const [selectedNode, setSelectedNode] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [codeStats, setCodeStats] = useState({
    totalLines: 0,
    controlFlowLines: 0,
    functionLines: 0
  });
  const flowDiagramRef = useRef(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleVisualize = () => {
    const parsedFlow = parseCodeFlow(code);
    setFlowData(parsedFlow);
    const stats = {
      totalLines: parsedFlow.flowNodes.length,
      controlFlowLines: parsedFlow.flowNodes.filter(node => node.characteristics.isControlFlow).length,
      functionLines: parsedFlow.flowNodes.filter(node => node.characteristics.isFunction).length
    };
    setCodeStats(stats);
    if (flowDiagramRef.current) {
      const lastNode = parsedFlow.flowNodes[parsedFlow.flowNodes.length - 1];
      flowDiagramRef.current.style.height = `${lastNode.y + 150}px`;
    }
  };

  const handleNodeClick = (node) => {
    setSelectedNode(node === selectedNode ? null : node);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    alert('Code copied to clipboard!');
  };

  const handleDownloadCode = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'code_flow.txt';
    link.click();
  };

  const handleZoomIn = () => {
    setZoomLevel(Math.min(zoomLevel + 0.2, 2));
  };

  const handleZoomOut = () => {
    setZoomLevel(Math.max(zoomLevel - 0.2, 0.5));
  };

  const resetZoom = () => {
    setZoomLevel(1);
  };

  const handleDownloadFlowChart = async () => {
    if (!flowDiagramRef.current) return;
  
    try {
      setIsDownloading(true);
  
      // Reset zoom to ensure the diagram is downloaded at the right scale
      const originalZoom = zoomLevel;
      setZoomLevel(1); // Reset zoom for clean image
  
      // Delay to ensure re-render for a clean capture
      await new Promise(resolve => setTimeout(resolve, 100));
  
      // Capture the diagram as a canvas
      const canvas = await html2canvas(flowDiagramRef.current, {
        useCORS: true,
        scale: 2, // Higher scale for better resolution
        logging: false,
        backgroundColor: '#ffffff',
        allowTaint: true,
        removeContainer: true
      });
  
      // Generate a download link for the image
      canvas.toBlob((blob) => {
        const link = document.createElement('a');
        link.download = `code_flow_chart_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        link.href = URL.createObjectURL(blob);
        link.click();
      });
  
      // Restore the original zoom level after download
      setZoomLevel(originalZoom);
  
    } catch (error) {
      console.error('Failed to download flow chart:', error);
      alert('Failed to download flow chart. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };
  

  return (
    <div className="code-flow-container">
      <div className="header">
        <h1>FlowStruct</h1>
        <p>Transform your code into an interactive visual journey across multiple languages</p>
      </div>
      
      <div className="input-section">
        <div className="textarea-actions">
          <button onClick={handleCopyCode} title="Copy Code">
            <Copy size={20} />
          </button>
          <button onClick={handleDownloadCode} title="Download Code">
            <Download size={20} />
          </button>
          {flowData.language && (
            <div className="language-badge">
              <Globe size={16} /> {flowData.language.toUpperCase()}
            </div>
          )}
        </div>
        <textarea 
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Paste your code (Python, JavaScript, Java, Ruby, C++)..."
          rows={10}
        />
        <button 
          className="visualize-btn" 
          onClick={handleVisualize}
        >
          Visualize Flow
        </button>
      </div>

      <div className="visualization-area">
        <div 
          className="flow-diagram" 
          ref={flowDiagramRef}
        >
          <div className="diagram-controls">
            <button onClick={handleZoomIn} title="Zoom In">
              <ZoomIn size={20} />
            </button>
            <button onClick={handleZoomOut} title="Zoom Out">
              <ZoomOut size={20} />
            </button>
            <button onClick={resetZoom} title="Reset Zoom">
              <RefreshCw size={20} />
            </button>
            <button 
              onClick={handleDownloadFlowChart} 
              title="Download Flow Chart"
              disabled={isDownloading || flowData.flowNodes.length === 0}
            >
              {isDownloading ? 'Downloading...' : <Image size={20} />}
            </button>
          </div>
          
          <div 
            className="flow-diagram-content" 
            style={{ 
              transform: `scale(${zoomLevel})`, 
              transformOrigin: 'top left' 
            }}
          >
            {flowData.flowNodes.map(node => (
              <FlowNode 
                key={node.id} 
                node={node} 
                onNodeClick={handleNodeClick}
                isSelected={selectedNode === node}
                zoomLevel={zoomLevel}
              />
            ))}
            {flowData.connections.map((conn, index) => {
              const from = flowData.flowNodes.find(n => n.id === conn.from);
              const to = flowData.flowNodes.find(n => n.id === conn.to);
              return (
                <FlowConnection 
                  key={`conn-${index}`} 
                  from={from} 
                  to={to} 
                  zoomLevel={zoomLevel}
                />
              );
            })}
          </div>
        </div>

        <div className="sidebar">
          {selectedNode && (
            <div className="node-details">
              <h3>Node Insights</h3>
              <pre>{selectedNode.content}</pre>
              <div className="node-characteristics">
                <span className={`badge ${selectedNode.characteristics.isFunction ? 'active' : ''}`}>
                  <CodeIcon size={16} /> Function
                </span>
                <span className={`badge ${selectedNode.characteristics.isLoop ? 'active' : ''}`}>
                  Loop
                </span>
                <span className={`badge ${selectedNode.characteristics.isConditional ? 'active' : ''}`}>
                  Conditional
                </span>
              </div>
            </div>
          )}
          
          {flowData.flowNodes.length > 0 && (
            <div className="code-statistics">
              <h3>Code Statistics</h3>
              <div className="stat-item">
                <span>Total Lines:</span>
                <span>{codeStats.totalLines}</span>
              </div>
              <div className="stat-item">
                <span>Control Flow Lines:</span>
                <span>{codeStats.controlFlowLines}</span>
              </div>
              <div className="stat-item">
                <span>Function Lines:</span>
                <span>{codeStats.functionLines}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodeFlowVisualizer;