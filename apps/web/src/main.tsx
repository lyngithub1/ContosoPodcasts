import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { StudioProvider } from './store/StudioContext';
import { App } from './App';
import './styles/tokens.css';
import './styles/global.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <StudioProvider>
        <App />
      </StudioProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
