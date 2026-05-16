import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const isReviewPortal =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('app') === 'review';

const ReviewPortal = lazy(() => import('./review/ReviewPortal'));

const root = ReactDOM.createRoot(document.getElementById('root'));

if (isReviewPortal) {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0a0908' }} />}>
        <ReviewPortal />
      </Suspense>
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

reportWebVitals();
