import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CodeFlowVisualizer from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CodeFlowVisualizer />
  </StrictMode>,
)
