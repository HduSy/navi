import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { installNaviBridge } from './navi-bridge'
import './index.css'

// 注入 window.navi（Tauri invoke/listen 桥，替代 Electron preload）
installNaviBridge()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element not found')

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
)
