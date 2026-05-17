import React, { useState, useEffect, useRef } from 'react';
import {
  Lock,
  Send,
  Settings,
  LogOut,
  Search,
  UserPlus,
  X,
  MessageSquare,
  Key,
  CloudOff,
  Database,
  ArrowRight,
  ArrowLeft,
  Shield,
  Upload
} from 'lucide-react';
import { useChatStore } from './store/chatStore';

export default function App() {
  const {
    currentUser,
    isAuthenticated,
    isLoading,
    isLiveMode,
    friends,
    pendingRequests,
    activeFriendId,
    messages,
    toasts,
    initializeSession,
    registerUser,
    loginUser,
    logoutUser,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    sendMessage,
    selectActiveChat,
    updateAvatar
  } = useChatStore();

  // Auth form state
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // UI tabs & inputs
  const [activeTab, setActiveTab] = useState<'chats' | 'friends'>('chats');
  const [friendUsernameInput, setFriendUsernameInput] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [searchFriendQuery, setSearchFriendQuery] = useState('');

  // Modals state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize session on load
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current) {
      initializeSession();
      initRef.current = true;
    }
  }, [initializeSession]);

  // Auto scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeFriendId]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    if (isRegisterMode) {
      await registerUser(username, password);
    } else {
      await loginUser(username, password);
    }
  };

  const handleSendMessageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    sendMessage(messageInput);
    setMessageInput('');
  };

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendUsernameInput.trim()) return;
    const success = await sendFriendRequest(friendUsernameInput);
    if (success) {
      setFriendUsernameInput('');
      setActiveTab('chats');
    }
  };

  // Profile Picture Upload Handler (Canvas Compressing + E2EE Client-Side Encryption)
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        // Use HTML Canvas to compress the avatar image to WebP
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Convert canvas image to WebP with 0.8 quality (very lightweight, ~15-30KB)
        const compressedDataUrl = canvas.toDataURL('image/webp', 0.8);
        updateAvatar(compressedDataUrl); // Triggers encryption & upload
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Format timestamp helper
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const activeFriend = friends.find(f => f.id === activeFriendId);
  const activeMessages = activeFriendId ? (messages[activeFriendId] || []) : [];

  // Filter friends list based on query
  const filteredFriends = friends.filter(f =>
    f.username.toLowerCase().includes(searchFriendQuery.toLowerCase())
  );

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

      {/* 1. Auth Page View */}
      {!isAuthenticated ? (
        <div className="auth-container">
          <form className="auth-card" onSubmit={handleAuthSubmit}>
            <div className="auth-header">
              <div className="auth-logo">
                WOMP
              </div>
              <div className="auth-subtitle">
                chat aman karena gw yang bikin
              </div>
              <span className="auth-badge">Enkripsi E2EE</span>
            </div>

            {/* Warn user about simulation mode */}
            {!isLiveMode && (
              <div className="alert alert-info">
                <CloudOff size={16} />
                <div>
                  <strong>Mode Simulasi Aktif</strong><br />
                  Supabase belum terhubung. Kunci obrolan disimpan aman di IndexedDB browser kamu.
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
              <span>{isRegisterMode ? 'Daftar & Buat Kunci' : 'Masuk & Buka Obrolan'}</span>
              <ArrowRight size={16} />
            </button>

            <div className="auth-footer">
              {isRegisterMode ? (
                <>
                  Udah punya akun?{' '}
                  <a href="#" className="auth-link" onClick={() => setIsRegisterMode(false)}>
                    Masuk sini
                  </a>
                </>
              ) : (
                <>
                  Baru di sini?{' '}
                  <a href="#" className="auth-link" onClick={() => setIsRegisterMode(true)}>
                    Mulai bikin akun baru
                  </a>
                </>
              )}
            </div>
          </form>
        </div>
      ) : (
        /* 2. Chat Dashboard View */
        <div className={`app-container ${activeFriendId ? 'has-active-chat' : ''}`}>

          {/* LEFT SIDEBAR */}
          <div className="sidebar">

            {/* Sidebar Profile Header */}
            <div className="sidebar-header">
              <div className="user-profile-summary" onClick={() => setIsSettingsOpen(true)}>
                <div className="avatar">
                  {currentUser?.avatarUrl ? (
                    <img src={currentUser.avatarUrl} alt="Avatar" />
                  ) : (
                    currentUser?.username.substring(0, 2).toUpperCase()
                  )}
                </div>
                <div className="user-info">
                  <span className="user-name">@{currentUser?.username}</span>
                </div>
              </div>
              <div className="header-actions">
                <button className="icon-btn" title="Settings" onClick={() => setIsSettingsOpen(true)}>
                  <Settings size={18} />
                </button>
                <button className="icon-btn" title="Log Out" onClick={logoutUser}>
                  <LogOut size={18} />
                </button>
              </div>
            </div>

            {/* Sidebar Navigation Tabs */}
            <div className="sidebar-tabs">
              <button
                className={`tab-btn ${activeTab === 'chats' ? 'active' : ''}`}
                onClick={() => setActiveTab('chats')}
              >
                <MessageSquare size={16} />
                <span>Chat</span>
              </button>
              <button
                className={`tab-btn ${activeTab === 'friends' ? 'active' : ''}`}
                onClick={() => setActiveTab('friends')}
              >
                <UserPlus size={16} />
                <span>Teman</span>
                {pendingRequests.length > 0 && (
                  <span className="tab-badge">{pendingRequests.length}</span>
                )}
              </button>
            </div>

            {/* Sidebar Dynamic Content */}
            <div className="sidebar-content">
              {activeTab === 'chats' ? (
                <>
                  <div className="search-bar">
                    <div className="search-input-wrapper">
                      <Search size={14} className="search-icon" />
                      <input
                        type="text"
                        placeholder="Cari obrolan..."
                        className="search-input"
                        value={searchFriendQuery}
                        onChange={(e) => setSearchFriendQuery(e.target.value)}
                      />
                    </div>
                  </div>

                  {filteredFriends.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500 }}>
                      Daftar teman kamu masih kosong.<br />
                      Yuk tambah teman baru di tab Teman!
                    </div>
                  ) : (
                    filteredFriends.map((friend) => {
                      const chatMsgs = messages[friend.id] || [];
                      const lastMsg = chatMsgs[chatMsgs.length - 1];

                      return (
                        <div
                          key={friend.id}
                          className={`list-item ${activeFriendId === friend.id ? 'active' : ''}`}
                          onClick={() => selectActiveChat(friend.id)}
                        >
                          <div className="avatar">
                            {friend.avatarUrl ? (
                              <img src={friend.avatarUrl} alt="" />
                            ) : (
                              friend.username.substring(0, 2).toUpperCase()
                            )}
                          </div>
                          <div className="item-details">
                            <div className="item-header">
                              <span className="item-title">@{friend.username}</span>
                              {lastMsg && (
                                <span className="item-meta">{formatTime(lastMsg.timestamp)}</span>
                              )}
                            </div>
                            <div className="item-subtitle">
                              {lastMsg ? lastMsg.text : 'Obrolan terenkripsi aman'}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              ) : (
                /* TAB: ADD FRIEND */
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <form onSubmit={handleSendFriendRequest} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="form-group">
                      <label className="form-label">masukin username temen lu</label>
                      <div className="input-wrapper">
                        <span className="input-icon">@</span>
                        <input
                          type="text"
                          placeholder="username teman..."
                          className="form-input"
                          value={friendUsernameInput}
                          onChange={(e) => setFriendUsernameInput(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <button type="submit" className="btn btn-primary btn-xs" style={{ padding: '12px' }}>
                      Tambah Teman
                    </button>
                  </form>

                  {/* Pending Friend Requests */}
                  {pendingRequests.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <h4 style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
                        Permintaan masuk
                      </h4>
                      {pendingRequests.map((req) => (
                        <div key={req.id} className="list-item" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                          <div className="avatar" style={{ width: '32px', height: '32px', fontSize: '12px' }}>
                            {req.sender.username.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="item-details">
                            <span className="item-title" style={{ fontSize: '13px' }}>@{req.sender.username}</span>
                            <div className="request-actions">
                              <button className="btn btn-primary btn-xs" onClick={() => acceptFriendRequest(req.id)}>
                                Terima Mutual
                              </button>
                              <button className="btn btn-secondary btn-xs" onClick={() => rejectFriendRequest(req.id)}>
                                Tolak
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* MAIN CHAT AREA */}
          <div className="chat-workspace">
            {!activeFriendId ? (
              /* Screen Empty / No chat active */
              <div className="empty-chat-screen">
                <div className="empty-chat-icon">
                  <Lock size={32} />
                </div>
                <h2 className="empty-chat-title">WOMP</h2>
                <p className="empty-chat-desc">
                  Pilih teman di sebelah kiri buat mulai obrolan terenkripsi.
                </p>
              </div>
            ) : (
              /* Active Chat Screen */
              <>
                <div className="chat-header">
                  <div className="chat-user-summary">
                    <button
                      className="back-btn"
                      onClick={() => selectActiveChat(null as any)}
                      title="Back to Chats"
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <div className="avatar">
                      {activeFriend?.avatarUrl ? (
                        <img src={activeFriend.avatarUrl} alt="" />
                      ) : (
                        activeFriend?.username.substring(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="chat-user-details">
                      <span className="chat-user-name">@{activeFriend?.username}</span>
                      <span className="chat-user-status">
                        aktif
                      </span>
                    </div>
                  </div>
                </div>

                {/* Messages Feed */}
                <div className="messages-container">
                  <div className="message-date-separator">
                    Obrolan dimulai hari ini
                  </div>

                  <div className="alert alert-success" style={{ margin: '0 auto 10px', maxWidth: '400px', display: 'flex', gap: '8px', fontSize: '11px', padding: '8px 12px' }}>
                    <Key size={14} />
                    <div>
                      obrolan epic akan segera dimulai
                    </div>
                  </div>

                  {activeMessages.map((msg) => {
                    const isMe = msg.senderId === currentUser?.id;
                    return (
                      <div key={msg.id} className={`message-bubble ${isMe ? 'sent' : 'received'}`}>
                        <div className="message-content">
                          {msg.content}

                          {/* Mini info overlay */}
                          <div className="message-info">
                            <span>{formatTime(msg.createdAt)}</span>
                            {isMe && (
                              <span style={{ fontSize: '9px', fontWeight: 600 }}>
                                {msg.isRead ? 'dibaca' : 'terkirim'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Anchor for auto scroll */}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input box */}
                <div className="chat-input-area">
                  <form onSubmit={handleSendMessageSubmit} className="chat-form">
                    <div className="chat-input-wrapper">
                      <input
                        type="text"
                        placeholder={`Kirim pesan aman ke @${activeFriend?.username}...`}
                        className="chat-input"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        required
                      />
                    </div>
                    <button type="submit" className="icon-btn" style={{ background: 'var(--accent)', color: '#000', borderRadius: '10px', width: '40px', height: '40px' }}>
                      <Send size={16} />
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>

          {/* 3. SETTINGS & PROFILE EDITOR MODAL */}
          {isSettingsOpen && (
            <div className="modal-overlay">
              <div className="modal-card">
                <div className="modal-header">
                  <h3 className="modal-title">Ubah Profil</h3>
                  <button className="close-btn" onClick={() => setIsSettingsOpen(false)}>
                    <X size={18} />
                  </button>
                </div>

                {/* E2EE Profile Picture Upload Section */}
                <div className="profile-photo-editor">
                  <div className="avatar-large" onClick={() => fileInputRef.current?.click()}>
                    {currentUser?.avatarUrl ? (
                      <img src={currentUser.avatarUrl} alt="Upload" />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', fontSize: '32px', fontWeight: 'bold' }}>
                        {currentUser?.username.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="avatar-overlay">
                      <Upload size={20} />
                    </div>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept="image/*"
                    onChange={handleAvatarChange}
                  />
                  <div className="avatar-help-text">
                    Klik untuk pilih foto profil.<br />
                    Foto akan dikompresi ke WebP dan dienkripsi AES-GCM sebelum diunggah.
                  </div>
                </div>

                <div className="alert alert-info" style={{ display: 'flex', gap: '8px', fontSize: '11px', padding: '8px 12px' }}>
                  <Database size={16} />
                  <div>
                    <strong>Info Enkripsi</strong><br />
                    Spek Kunci: ECDH P-256 Key Pair<br />
                    Penyimpanan: IndexedDB Browser
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Badge Akun Kamu</label>
                  <input
                    type="text"
                    className="form-input"
                    value={`@${currentUser?.username}`}
                    disabled
                    style={{ background: 'rgba(0,0,0,0.2)', color: 'var(--text-secondary)' }}
                  />
                </div>

                <button
                  className="btn btn-secondary"
                  onClick={() => setIsSettingsOpen(false)}
                  style={{ marginTop: '10px' }}
                >
                  Selesai
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
