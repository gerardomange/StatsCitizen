import React from 'react';
import ReactDOM from 'react-dom/client';
import './fonts.js';
import './overlay.css';
import { OverlayApp } from './OverlayApp.js';

ReactDOM.createRoot(document.getElementById('overlay') as HTMLElement).render(<OverlayApp />);
