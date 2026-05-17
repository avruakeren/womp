import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { useChatStore } from './store/chatStore';

import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';

export default function App() {
  const { toasts, initializeSession } = useChatStore();
  const initRef = useRef(false);

  // Initialize session on load
  useEffect(() => {
    if (!initRef.current) {
      initializeSession();
      initRef.current = true;
    }
  }, [initializeSession]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      {/* Toast Notification Renderer */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <Shield size={16} color="var(--accent)" />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
