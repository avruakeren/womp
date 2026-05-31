import React, { useState, useEffect } from 'react';
import { Lock, CloudOff, ArrowRight } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useChatStore } from '../store/chatStore';

export default function Login() {
  const { loginUser, isAuthenticated, isLoading, isLiveMode } = useChatStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    
    const success = await loginUser(username, password);
    if (success) {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="auth-container">
      <form className="auth-card" onSubmit={handleAuthSubmit}>
        <div className="auth-header">
          <div className="auth-logo">WOMP</div>
          <div className="auth-subtitle">chat aman karena gw yang bikin</div>
        </div>

        {!isLiveMode && (
          <div className="alert alert-info">
            <CloudOff size={16} />
            <div>
              <strong>Mode Simulasi Aktif</strong><br />
              InsForge belum terhubung. Kunci obrolan disimpan aman di IndexedDB browser kamu.
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">username</label>
          <div className="input-wrapper">
            <span className="input-icon">@</span>
            <input
              type="text"
              className="form-input"
              placeholder="misal: ikan_ngoding..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">password</label>
          <div className="input-wrapper">
            <Lock size={16} className="input-icon" />
            <input
              type="password"
              className="form-input"
              placeholder="masukin password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          <span>Masuk & Buka Obrolan</span>
          <ArrowRight size={16} />
        </button>

        <div className="auth-footer">
          Baru di sini?{' '}
          <Link to="/register" className="auth-link">
            Mulai bikin akun baru
          </Link>
        </div>
      </form>
    </div>
  );
}
