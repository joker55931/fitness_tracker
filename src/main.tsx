import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { telegram } from './telegram';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);

telegram?.ready();
if (telegram?.initData) {
  telegram.expand();
  if (telegram.isVersionAtLeast?.('7.7')) telegram.disableVerticalSwipes?.();
}
