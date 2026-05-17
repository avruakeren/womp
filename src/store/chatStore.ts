import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

export interface FriendRequest {
  id: string;
  sender: UserProfile;
}

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning';
}

interface ChatStore {
  currentUser: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isLiveMode: boolean;

  friends: UserProfile[];
  pendingRequests: FriendRequest[];
  activeFriendId: string | null;
  messages: Record<string, Message[]>;
  toasts: Toast[];

  addToast: (msg: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;

  initializeSession: () => Promise<void>;
  registerUser: (username: string, password: string) => Promise<boolean>;
  loginUser: (username: string, password: string) => Promise<boolean>;
  logoutUser: () => void;

  sendFriendRequest: (username: string) => Promise<boolean>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  rejectFriendRequest: (requestId: string) => Promise<void>;

  sendMessage: (content: string) => Promise<void>;
  selectActiveChat: (friendId: string) => void;
  updateAvatar: (dataUrl: string) => Promise<void>;
  updateUsername: (newUsername: string) => Promise<boolean>;

  syncData: (userId: string) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();

async function hashPassword(password: string, username: string): Promise<string> {
  const data = new TextEncoder().encode(password + ':' + username.toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatStore>((set, get) => {
  let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

  const setupRealtime = (userId: string) => {
    if (!isSupabaseConfigured()) return;
    if (realtimeChannel) {
      realtimeChannel.unsubscribe();
      realtimeChannel = null;
    }

    realtimeChannel = supabase
      .channel(`womp_user_${userId}`)
      // New incoming messages
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as any;
          const msg: Message = {
            id: row.id,
            senderId: row.sender_id,
            recipientId: row.recipient_id,
            content: row.content,
            isRead: row.is_read,
            createdAt: row.created_at,
          };
          set((state) => {
            const existing = state.messages[msg.senderId] || [];
            if (existing.some(m => m.id === msg.id)) return state;
            return {
              messages: { ...state.messages, [msg.senderId]: [...existing, msg] },
            };
          });
        }
      )
      // Friend request updates
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friendships' },
        () => { get().syncData(userId); }
      )
      .subscribe();
  };

  return {
    currentUser: null,
    isAuthenticated: false,
    isLoading: false,
    isLiveMode: isSupabaseConfigured(),
    friends: [],
    pendingRequests: [],
    activeFriendId: null,
    messages: {},
    toasts: [],

    // ── Toast ──────────────────────────────────────────────────────────────
    addToast: (message, type = 'info') => {
      const id = uid();
      set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
      setTimeout(() => get().removeToast(id), 4000);
    },
    removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

    // ── Session restore ────────────────────────────────────────────────────
    initializeSession: async () => {
      const raw = localStorage.getItem('womp-user');
      if (!raw) return;
      try {
        const user = JSON.parse(raw) as UserProfile;
        set({ currentUser: user, isAuthenticated: true });
        if (isSupabaseConfigured()) {
          setupRealtime(user.id);
          await get().syncData(user.id);
        }
      } catch {
        localStorage.removeItem('womp-user');
      }
    },

    // ── Register ───────────────────────────────────────────────────────────
    registerUser: async (username, password) => {
      set({ isLoading: true });
      try {
        const clean = username.toLowerCase().trim();
        if (!clean || clean.length < 3) throw new Error('Username minimal 3 karakter.');
        if (!password || password.length < 6) throw new Error('Password minimal 6 karakter.');

        if (isSupabaseConfigured()) {
          // Check existing username
          const { data: existing } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', clean)
            .maybeSingle();

          if (existing) throw new Error('Username sudah dipakai.');

          const passwordHash = await hashPassword(password, clean);

          const { data, error } = await supabase
            .from('profiles')
            .insert({ username: clean, password_hash: passwordHash })
            .select('id, username, avatar_url')
            .single();

          if (error) throw error;

          const user: UserProfile = { id: data.id, username: data.username, avatarUrl: data.avatar_url };
          localStorage.setItem('womp-user', JSON.stringify(user));
          set({ currentUser: user, isAuthenticated: true });
          setupRealtime(user.id);
          await get().syncData(user.id);
        } else {
          // Simulation
          const user: UserProfile = { id: uid(), username: clean };
          localStorage.setItem('womp-user', JSON.stringify(user));
          set({ currentUser: user, isAuthenticated: true });
          set({ friends: [{ id: 'sim-bob', username: 'bob_sim' }] });
        }

        get().addToast('Akun berhasil dibuat!', 'success');
        return true;
      } catch (err: any) {
        get().addToast(err.message || 'Registrasi gagal.', 'warning');
        return false;
      } finally {
        set({ isLoading: false });
      }
    },

    // ── Login ──────────────────────────────────────────────────────────────
    loginUser: async (username, password) => {
      set({ isLoading: true });
      try {
        const clean = username.toLowerCase().trim();

        if (isSupabaseConfigured()) {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('username', clean)
            .maybeSingle();

          if (error || !profile) throw new Error('Username tidak ditemukan.');

          const passwordHash = await hashPassword(password, clean);
          if (profile.password_hash !== passwordHash) throw new Error('Password salah.');

          const user: UserProfile = { id: profile.id, username: profile.username, avatarUrl: profile.avatar_url };
          localStorage.setItem('womp-user', JSON.stringify(user));
          set({ currentUser: user, isAuthenticated: true });
          setupRealtime(user.id);
          await get().syncData(user.id);
        } else {
          const raw = localStorage.getItem('womp-user');
          if (!raw) throw new Error('Belum ada akun. Silakan daftar.');
          const user = JSON.parse(raw) as UserProfile;
          set({ currentUser: user, isAuthenticated: true });
        }

        get().addToast('Login berhasil!', 'success');
        return true;
      } catch (err: any) {
        get().addToast(err.message || 'Login gagal.', 'warning');
        return false;
      } finally {
        set({ isLoading: false });
      }
    },

    // ── Logout ─────────────────────────────────────────────────────────────
    logoutUser: () => {
      realtimeChannel?.unsubscribe();
      realtimeChannel = null;
      localStorage.removeItem('womp-user');
      set({ currentUser: null, isAuthenticated: false, friends: [], pendingRequests: [], messages: {}, activeFriendId: null });
    },

    // ── Friend request ─────────────────────────────────────────────────────
    sendFriendRequest: async (username) => {
      const current = get().currentUser;
      if (!current) return false;

      let target = username.toLowerCase().trim();
      if (target.startsWith('@')) target = target.slice(1);

      if (target === current.username) {
        get().addToast('Tidak bisa berteman dengan diri sendiri.', 'warning');
        return false;
      }
      if (get().friends.some(f => f.username === target)) {
        get().addToast('Sudah berteman.', 'warning');
        return false;
      }

      try {
        if (isSupabaseConfigured()) {
          const { data: targetProfile } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('username', target)
            .maybeSingle();

          if (!targetProfile) {
            get().addToast('Pengguna tidak ditemukan.', 'warning');
            return false;
          }

          const { data: existing } = await supabase
            .from('friendships')
            .select('id')
            .or(`and(requester_id.eq.${current.id},addressee_id.eq.${targetProfile.id}),and(requester_id.eq.${targetProfile.id},addressee_id.eq.${current.id})`)
            .maybeSingle();

          if (existing) {
            get().addToast('Request sudah pernah dikirim.', 'warning');
            return false;
          }

          const { error } = await supabase.from('friendships').insert({
            requester_id: current.id,
            addressee_id: targetProfile.id,
          });
          if (error) throw error;
        } else {
          // Simulation: auto-accept after 1s
          setTimeout(() => {
            const newFriend = { id: 'sim-' + target, username: target };
            set(s => ({ friends: [...s.friends, newFriend] }));
            get().addToast(`@${target} menerima pertemanan!`, 'success');
          }, 1000);
        }

        get().addToast(`Request terkirim ke @${target}`, 'success');
        return true;
      } catch (err: any) {
        get().addToast(err.message || 'Gagal kirim request.', 'warning');
        return false;
      }
    },

    // ── Accept ─────────────────────────────────────────────────────────────
    acceptFriendRequest: async (requestId) => {
      const req = get().pendingRequests.find(r => r.id === requestId);
      if (!req) return;

      try {
        if (isSupabaseConfigured()) {
          const { error } = await supabase
            .from('friendships')
            .update({ status: 'accepted' })
            .eq('id', requestId);
          if (error) throw error;
        }

        set(s => ({
          friends: [...s.friends, req.sender],
          pendingRequests: s.pendingRequests.filter(r => r.id !== requestId),
        }));

        // Fetch offline messages from this friend
        if (isSupabaseConfigured() && get().currentUser) {
          await get().syncData(get().currentUser!.id);
        }

        get().addToast(`Berteman dengan @${req.sender.username}!`, 'success');
      } catch (err: any) {
        get().addToast(err.message || 'Gagal menerima request.', 'warning');
      }
    },

    // ── Reject ─────────────────────────────────────────────────────────────
    rejectFriendRequest: async (requestId) => {
      try {
        if (isSupabaseConfigured()) {
          await supabase.from('friendships').delete().eq('id', requestId);
        }
        set(s => ({ pendingRequests: s.pendingRequests.filter(r => r.id !== requestId) }));
      } catch (err: any) {
        get().addToast(err.message || 'Gagal menolak request.', 'warning');
      }
    },

    // ── Select chat ────────────────────────────────────────────────────────
    selectActiveChat: (friendId) => {
      set({ activeFriendId: friendId });
      // Mark messages as read
      if (isSupabaseConfigured() && get().currentUser) {
        supabase
          .from('messages')
          .update({ is_read: true })
          .eq('sender_id', friendId)
          .eq('recipient_id', get().currentUser!.id)
          .eq('is_read', false)
          .then(() => {});
      }
    },

    // ── Send message ───────────────────────────────────────────────────────
    sendMessage: async (content) => {
      const friendId = get().activeFriendId;
      const current = get().currentUser;
      if (!friendId || !current || !content.trim()) return;

      const text = content.trim();

      // Optimistic UI update
      const tempMsg: Message = {
        id: uid(),
        senderId: current.id,
        recipientId: friendId,
        content: text,
        isRead: false,
        createdAt: new Date().toISOString(),
      };

      set(s => ({
        messages: {
          ...s.messages,
          [friendId]: [...(s.messages[friendId] || []), tempMsg],
        },
      }));

      try {
        if (isSupabaseConfigured()) {
          const { data, error } = await supabase
            .from('messages')
            .insert({ sender_id: current.id, recipient_id: friendId, content: text })
            .select('id')
            .single();

          if (error) throw error;

          // Replace temp ID with real server ID
          set(s => ({
            messages: {
              ...s.messages,
              [friendId]: (s.messages[friendId] || []).map(m =>
                m.id === tempMsg.id ? { ...m, id: data.id } : m
              ),
            },
          }));
        } else {
          // Simulation reply
          setTimeout(() => {
            const reply: Message = {
              id: uid(),
              senderId: friendId,
              recipientId: current.id,
              content: '👋 (simulasi balasan otomatis)',
              isRead: true,
              createdAt: new Date().toISOString(),
            };
            set(s => ({
              messages: { ...s.messages, [friendId]: [...(s.messages[friendId] || []), reply] },
            }));
          }, 1000);
        }
      } catch (err: any) {
        // Remove optimistic message on failure
        set(s => ({
          messages: {
            ...s.messages,
            [friendId]: (s.messages[friendId] || []).filter(m => m.id !== tempMsg.id),
          },
        }));
        get().addToast('Gagal mengirim pesan.', 'warning');
      }
    },

    // ── Avatar upload ──────────────────────────────────────────────────────
    updateAvatar: async (dataUrl) => {
      const current = get().currentUser;
      if (!current) return;

      set(s => ({ currentUser: { ...s.currentUser!, avatarUrl: dataUrl } }));
      localStorage.setItem('womp-user', JSON.stringify({ ...current, avatarUrl: dataUrl }));

      if (!isSupabaseConfigured()) return;

      try {
        get().addToast('Mengupload foto...', 'info');

        const base64 = dataUrl.split(',')[1];
        const mime = dataUrl.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const ext = mime.split('/')[1] || 'jpg';
        const fileName = `${current.id}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(fileName, blob, { upsert: true, contentType: mime });

        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);

        await supabase
          .from('profiles')
          .update({ avatar_url: urlData.publicUrl })
          .eq('id', current.id);

        set(s => ({ currentUser: { ...s.currentUser!, avatarUrl: urlData.publicUrl } }));
        localStorage.setItem('womp-user', JSON.stringify({ ...current, avatarUrl: urlData.publicUrl }));
        get().addToast('Foto profil diperbarui!', 'success');
      } catch (err: any) {
        get().addToast('Gagal upload foto.', 'warning');
      }
    },

    updateUsername: async (newUsername: string) => {
      const current = get().currentUser;
      if (!current || !newUsername.trim()) return false;
      const clean = newUsername.trim().toLowerCase();
      if (clean === current.username) return true;

      try {
        if (isSupabaseConfigured()) {
          const { error } = await supabase
            .from('profiles')
            .update({ username: clean })
            .eq('id', current.id);

          if (error) {
            if (error.code === '23505') { // Unique violation
              get().addToast('Username sudah dipakai orang lain!', 'warning');
            } else {
              get().addToast('Gagal update username.', 'warning');
            }
            return false;
          }
        }

        const updatedUser = { ...current, username: clean };
        set({ currentUser: updatedUser });
        localStorage.setItem('womp-user', JSON.stringify(updatedUser));
        get().addToast('Username berhasil diganti!', 'success');
        return true;
      } catch (err) {
        get().addToast('Error saat mengganti username', 'warning');
        return false;
      }
    },

    // ── Sync data ──────────────────────────────────────────────────────────
    syncData: async (userId) => {
      if (!isSupabaseConfigured()) return;

      try {
        // 1. Load accepted friends
        const { data: friendships } = await supabase
          .from('friendships')
          .select('id, requester_id, addressee_id, status')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
          .eq('status', 'accepted');

        if (friendships) {
          const partnerIds = friendships.map(f =>
            f.requester_id === userId ? f.addressee_id : f.requester_id
          );

          if (partnerIds.length > 0) {
            const { data: profiles } = await supabase
              .from('profiles')
              .select('id, username, avatar_url')
              .in('id', partnerIds);

            const friends: UserProfile[] = (profiles || []).map(p => ({
              id: p.id,
              username: p.username,
              avatarUrl: p.avatar_url,
            }));
            set({ friends });
          } else {
            set({ friends: [] });
          }
        }

        // 2. Pending requests
        const { data: pending } = await supabase
          .from('friendships')
          .select('id, requester_id')
          .eq('addressee_id', userId)
          .eq('status', 'pending');

        if (pending && pending.length > 0) {
          const senderIds = pending.map(p => p.requester_id);
          const { data: senderProfiles } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', senderIds);

          const requests: FriendRequest[] = pending.map(p => {
            const profile = (senderProfiles || []).find(sp => sp.id === p.requester_id);
            return {
              id: p.id,
              sender: { id: p.requester_id, username: profile?.username || 'unknown', avatarUrl: profile?.avatar_url },
            };
          });
          set({ pendingRequests: requests });
        } else {
          set({ pendingRequests: [] });
        }

        // 3. Load unread messages (offline queue)
        const { data: unread } = await supabase
          .from('messages')
          .select('*')
          .eq('recipient_id', userId)
          .eq('is_read', false)
          .order('created_at', { ascending: true });

        if (unread && unread.length > 0) {
          const newMsgs: Record<string, Message[]> = { ...get().messages };
          for (const row of unread) {
            const msg: Message = {
              id: row.id,
              senderId: row.sender_id,
              recipientId: row.recipient_id,
              content: row.content,
              isRead: row.is_read,
              createdAt: row.created_at,
            };
            if (!newMsgs[msg.senderId]) newMsgs[msg.senderId] = [];
            if (!newMsgs[msg.senderId].some(m => m.id === msg.id)) {
              newMsgs[msg.senderId].push(msg);
            }
          }
          set({ messages: newMsgs });
        }
      } catch (err) {
        console.error('syncData error:', err);
      }
    },
  };
});
