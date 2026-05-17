import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import * as webCrypto from '../crypto/webCrypto';
import * as keyStore from '../crypto/keyStore';

export interface UserProfile {
  id: string;
  username: string;
  avatarUrl?: string;
  publicIdentityKey?: string;
  isOnline?: boolean;
}

export interface LocalMessage {
  id: string;
  senderId: string;
  recipientId: string;
  text: string; // Plaintext (only decoded in memory!)
  ciphertext: string;
  iv: string;
  timestamp: string;
  isDelivered: boolean;
  isEncrypted: boolean;
}

export interface FriendRequest {
  id: string;
  sender: UserProfile;
}

interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning';
}

interface ChatStore {
  // Authentication & Profile
  currentUser: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Realtime Status
  isLiveMode: boolean;
  isWsConnected: boolean;

  // Conversations & Contacts
  friends: UserProfile[];
  pendingRequests: FriendRequest[];
  activeFriendId: string | null;
  messages: { [friendId: string]: LocalMessage[] };
  toasts: ToastMessage[];

  addToast: (message: string, type?: 'info' | 'success' | 'warning') => void;
  removeToast: (id: string) => void;
  
  initializeSession: () => Promise<void>;
  registerUser: (username: string, password: string) => Promise<boolean>;
  loginUser: (username: string, password: string) => Promise<boolean>;
  logoutUser: () => Promise<void>;
  
  sendFriendRequest: (targetUsername: string) => Promise<boolean>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  rejectFriendRequest: (requestId: string) => Promise<void>;
  
  sendMessage: (text: string) => Promise<void>;
  selectActiveChat: (friendId: string) => void;
  
  updateAvatar: (avatarDataUrl: string) => Promise<void>;
  syncSupabaseData: (userId: string) => Promise<void>;
}

// Helper to generate a random UUID for simulated mode
const generateUUID = () => crypto.randomUUID();

export const useChatStore = create<ChatStore>((set, get) => {
  
  // Channel registry: track all subscribed pair channels
  let friendshipChannel: any = null;
  const pairChannels: Map<string, any> = new Map();

  // Deterministic shared channel ID for any two users
  const getPairChannelId = (userA: string, userB: string) =>
    `womp:pair:${[userA, userB].sort().join('_')}`;

  // Subscribe to friendship-level realtime (friend requests only)
  const setupFriendshipChannel = (userId: string) => {
    if (!isSupabaseConfigured()) return;
    if (friendshipChannel) return; // Already subscribed

    friendshipChannel = supabase
      .channel(`womp:meta:${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friendships'
      }, async () => {
        await get().syncSupabaseData(userId);
      })
      .subscribe((status) => {
        set({ isWsConnected: status === 'SUBSCRIBED' });
      });
  };

  // Subscribe to a shared pair channel with a specific friend
  const subscribeToFriendChannel = (myId: string, friendId: string) => {
    if (!isSupabaseConfigured()) return;
    const channelId = getPairChannelId(myId, friendId);
    if (pairChannels.has(channelId)) return; // Already subscribed

    const ch = supabase
      .channel(channelId)
      .on('broadcast', { event: 'new-message' }, async (payload) => {
        const { senderId, ciphertext, iv, msgId } = payload.payload;

        // Ignore messages sent by self (we already show them locally)
        if (senderId === myId) return;

        const sessionKey = await keyStore.getSessionKey(senderId);
        if (!sessionKey) {
          get().addToast('Pesan masuk, tapi kunci handshake belum ada.', 'warning');
          return;
        }

        try {
          const decryptedText = await webCrypto.decryptMessage({ ciphertext, iv }, sessionKey);
          const newMsg: LocalMessage = {
            id: msgId || generateUUID(),
            senderId,
            recipientId: myId,
            text: decryptedText,
            ciphertext,
            iv,
            timestamp: new Date().toISOString(),
            isDelivered: true,
            isEncrypted: true
          };

          set((state) => {
            const current = state.messages[senderId] || [];
            if (current.some(m => m.id === newMsg.id)) return state;
            return {
              messages: { ...state.messages, [senderId]: [...current, newMsg] }
            };
          });
        } catch (err) {
          console.error('Decryption failed:', err);
          get().addToast('Gagal mendekripsi pesan.', 'warning');
        }
      })
      .subscribe();

    pairChannels.set(channelId, ch);
  };

  return {
    currentUser: null,
    isAuthenticated: false,
    isLoading: false,
    isLiveMode: isSupabaseConfigured(),
    isWsConnected: false,
    friends: [],
    pendingRequests: [],
    activeFriendId: null,
    messages: {},
    toasts: [],

    // Toast Actions
    addToast: (message, type = 'info') => {
      const id = generateUUID();
      set((state) => ({
        toasts: [...state.toasts, { id, message, type }]
      }));
      setTimeout(() => get().removeToast(id), 4000);
    },
    removeToast: (id) => set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    })),

    // Session recovery on start
    initializeSession: async () => {
      set({ isLoading: true });
      try {
        const storedUser = localStorage.getItem('womp-current-user');
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          
          // Verify if local private keys exist in IndexedDB
          const privKey = await keyStore.getMyKey('identity-private');
          if (privKey) {
            set({ currentUser: parsedUser, isAuthenticated: true });
            get().addToast(`Sesi dipulihkan. Kunci E2EE dimuat dari IndexedDB!`, 'success');
            
            if (isSupabaseConfigured()) {
              setupFriendshipChannel(parsedUser.id);
              await get().syncSupabaseData(parsedUser.id);
            } else {
              // Load mock simulation data
              get().addToast('Menjalankan dalam Mode Simulasi (Konfigurasi Supabase kosong)', 'info');
              
              // Load initial mock friends
              set({
                friends: [
                  { id: 'mock-bob-id', username: 'bob_secure', isOnline: true },
                  { id: 'mock-charlie-id', username: 'charlie_crypto', isOnline: false }
                ],
                pendingRequests: [
                  {
                    id: 'req-david',
                    sender: { id: 'mock-david-id', username: 'david_e2ee' }
                  }
                ]
              });

              // Generate mock shared keys for Simulation Bob & Charlie
              const myPrivKey = await keyStore.getMyKey('identity-private') as CryptoKey;
              
              const fakeBobKeyPair = await webCrypto.generateE2EEKeyPair();
              const derivedBobKey = await webCrypto.deriveSharedSessionKey(myPrivKey, fakeBobKeyPair.publicKey);
              await keyStore.saveSessionKey('mock-bob-id', derivedBobKey);

              const fakeCharlieKeyPair = await webCrypto.generateE2EEKeyPair();
              const derivedCharlieKey = await webCrypto.deriveSharedSessionKey(myPrivKey, fakeCharlieKeyPair.publicKey);
              await keyStore.saveSessionKey('mock-charlie-id', derivedCharlieKey);
            }
          } else {
            localStorage.removeItem('womp-current-user');
          }
        }
      } catch (err) {
        console.error('Session init error', err);
      } finally {
        set({ isLoading: false });
      }
    },

    // User Registration
    registerUser: async (username, password) => {
      set({ isLoading: true });
      try {
        // 1. Client-side deterministic hash of password
        await webCrypto.hashPasswordClientSide(password, username);

        // 2. Generate local E2EE Key Pair
        const identityKeys = await webCrypto.generateE2EEKeyPair();
        const publicIdentityKeyBase64 = await webCrypto.exportPublicKey(identityKeys.publicKey);
        await webCrypto.exportPrivateKey(identityKeys.privateKey);

        // Save raw keys in local IndexedDB
        await keyStore.saveMyKey('identity-private', identityKeys.privateKey);
        await keyStore.saveMyKey('identity-public', identityKeys.publicKey);

        // Generate profile symmetric key
        const profileKey = await webCrypto.generateProfileKey();
        await keyStore.saveMyKey('profile-key', profileKey);

        const newUserId = generateUUID();
        const userData: UserProfile = {
          id: newUserId,
          username: username.toLowerCase(),
          publicIdentityKey: publicIdentityKeyBase64
        };

        if (isSupabaseConfigured()) {
          // Check if username already exists in Supabase
          const { data: existingUser } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', username.toLowerCase())
            .maybeSingle();

          if (existingUser) {
            throw new Error('Username sudah terpakai. Silakan pilih username lain.');
          }

          // Supabase signup (Direct base64 string storage!)
          const { error } = await supabase.from('profiles').insert({
            id: newUserId,
            username: username.toLowerCase(),
            public_identity_key: publicIdentityKeyBase64,
          });
          if (error) throw error;
        }

        // Save session locally
        localStorage.setItem('womp-current-user', JSON.stringify(userData));
        set({ currentUser: userData, isAuthenticated: true });
        
        get().addToast('Registrasi Sukses! Kunci E2EE disimpan di perangkat.', 'success');
        
        if (isSupabaseConfigured()) {
          setupSupabaseRealtime(newUserId);
          await get().syncSupabaseData(newUserId);
        } else {
          // Init Simulation Mode
          set({
            friends: [
              { id: 'mock-bob-id', username: 'bob_secure', isOnline: true }
            ]
          });
          // Setup mock keys
          const derivedBobKey = await webCrypto.deriveSharedSessionKey(identityKeys.privateKey, (await webCrypto.generateE2EEKeyPair()).publicKey);
          await keyStore.saveSessionKey('mock-bob-id', derivedBobKey);
        }

        return true;
      } catch (err: any) {
        console.error(err);
        get().addToast(`Pendaftaran gagal: ${err.message || err}`, 'warning');
        return false;
      } finally {
        set({ isLoading: false });
      }
    },

    // User Login (Zero-Knowledge Authenticate)
    loginUser: async (username, password) => {
      set({ isLoading: true });
      try {
        await webCrypto.hashPasswordClientSide(password, username);
        
        let targetUserId = generateUUID();
        
        if (isSupabaseConfigured()) {
          // Fetch existing profile from Supabase
          const { data: serverProfile, error: searchErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('username', username.toLowerCase())
            .maybeSingle();

          if (searchErr || !serverProfile) {
            throw new Error('Username tidak terdaftar. Silakan bikin akun baru.');
          }

          targetUserId = serverProfile.id;

          // Check if local private key exists for this session
          const existingPrivKey = await keyStore.getMyKey('identity-private');
          
          if (!existingPrivKey) {
            // New device / cleared IndexedDB. Generate a new keypair and update server profile.
            get().addToast('Browser baru terdeteksi. Membuat kunci E2EE baru (kunci lama terhapus).', 'info');
            
            const identityKeys = await webCrypto.generateE2EEKeyPair();
            await keyStore.saveMyKey('identity-private', identityKeys.privateKey);
            await keyStore.saveMyKey('identity-public', identityKeys.publicKey);
            
            const profileKey = await webCrypto.generateProfileKey();
            await keyStore.saveMyKey('profile-key', profileKey);

            // Export and update on Supabase (Direct Base64 String!)
            const publicIdentityKeyBase64 = await webCrypto.exportPublicKey(identityKeys.publicKey);
            const { error: updateErr } = await supabase
              .from('profiles')
              .update({
                public_identity_key: publicIdentityKeyBase64
              })
              .eq('id', targetUserId);

            if (updateErr) throw updateErr;
          }
        } else {
          // Simulation backup check
          const existingPrivKey = await keyStore.getMyKey('identity-private');
          if (!existingPrivKey) {
            const identityKeys = await webCrypto.generateE2EEKeyPair();
            await keyStore.saveMyKey('identity-private', identityKeys.privateKey);
            await keyStore.saveMyKey('identity-public', identityKeys.publicKey);
            
            const profileKey = await webCrypto.generateProfileKey();
            await keyStore.saveMyKey('profile-key', profileKey);
          }
        }

        const userData: UserProfile = {
          id: targetUserId,
          username: username.toLowerCase()
        };

        localStorage.setItem('womp-current-user', JSON.stringify(userData));
        set({ currentUser: userData, isAuthenticated: true });
        
        get().addToast(`Login sukses! Kunci E2EE diaktifkan.`, 'success');

        if (isSupabaseConfigured()) {
          setupSupabaseRealtime(targetUserId);
          await get().syncSupabaseData(targetUserId);
        } else {
          set({
            friends: [
              { id: 'mock-bob-id', username: 'bob_secure', isOnline: true }
            ]
          });
          // Setup mock keys
          const myPriv = await keyStore.getMyKey('identity-private') as CryptoKey;
          const derivedBobKey = await webCrypto.deriveSharedSessionKey(myPriv, (await webCrypto.generateE2EEKeyPair()).publicKey);
          await keyStore.saveSessionKey('mock-bob-id', derivedBobKey);
        }

        return true;
      } catch (err: any) {
        console.error(err);
        get().addToast(err.message || 'Gagal masuk.', 'warning');
        return false;
      } finally {
        set({ isLoading: false });
      }
    },

    // User Logout
    logoutUser: async () => {
      try {
        if (realtimeChannel) {
          realtimeChannel.unsubscribe();
        }
        await keyStore.clearAllLocalKeys();
        localStorage.removeItem('womp-current-user');
        set({
          currentUser: null,
          isAuthenticated: false,
          friends: [],
          pendingRequests: [],
          activeFriendId: null,
          messages: {}
        });
        get().addToast('Logged out. Kunci E2EE aman terhapus dari perangkat.', 'info');
      } catch (err) {
        console.error('Logout error', err);
      }
    },

    // Add Friend / Send Request
    sendFriendRequest: async (targetUsername) => {
      let sanitized = targetUsername.toLowerCase().trim();
      if (sanitized.startsWith('@')) {
        sanitized = sanitized.substring(1);
      }
      const current = get().currentUser;
      if (!current) return false;

      if (sanitized === current.username) {
        get().addToast('Anda tidak bisa berteman dengan diri sendiri.', 'warning');
        return false;
      }

      // Check if already friends
      if (get().friends.some(f => f.username === sanitized)) {
        get().addToast('User ini sudah berteman dengan Anda.', 'warning');
        return false;
      }

      get().addToast(`Mengirim request ke @${sanitized}...`, 'info');

      try {
        if (isSupabaseConfigured()) {
          // Fetch target profile public key from Supabase
          const { data: targetProfile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('username', sanitized)
            .maybeSingle();

          if (error || !targetProfile) {
            get().addToast('Pengguna tidak ditemukan.', 'warning');
            return false;
          }

          // Check if request already exists in friendships
          const { data: existingFriendship } = await supabase
            .from('friendships')
            .select('*')
            .or(`and(requester_id.eq.${current.id},addressee_id.eq.${targetProfile.id}),and(requester_id.eq.${targetProfile.id},addressee_id.eq.${current.id})`)
            .maybeSingle();

          if (existingFriendship) {
            get().addToast('Permintaan pertemanan sudah dikirim sebelumnya.', 'warning');
            return false;
          }

          // Create friendship request in Supabase
          const { error: insertErr } = await supabase.from('friendships').insert({
            requester_id: current.id,
            addressee_id: targetProfile.id,
            status: 'pending'
          });
          if (insertErr) throw insertErr;
        } else {
          // Simulation mode: automatically accept friend after 1.5 seconds!
          setTimeout(async () => {
            const myPrivKey = await keyStore.getMyKey('identity-private') as CryptoKey;
            
            // Generate Bob public key simulation
            const targetKeyPair = await webCrypto.generateE2EEKeyPair();
            const targetPubBase64 = await webCrypto.exportPublicKey(targetKeyPair.publicKey);
            
            // Derive shared E2EE key locally
            const sessionKey = await webCrypto.deriveSharedSessionKey(myPrivKey, targetKeyPair.publicKey);
            
            // Save derived key under Bob's new mock ID
            const newFriendId = 'mock-' + sanitized + '-id';
            await keyStore.saveSessionKey(newFriendId, sessionKey);

            set((state) => ({
              friends: [
                ...state.friends,
                { id: newFriendId, username: sanitized, isOnline: true, publicIdentityKey: targetPubBase64 }
              ]
            }));

            get().addToast(`@${sanitized} menyetujui pertemanan. Handshake E2EE selesai!`, 'success');
          }, 1500);
        }

        get().addToast(`Request terkirim ke @${sanitized}`, 'success');
        return true;
      } catch (err) {
        console.error(err);
        get().addToast('Gagal menambah teman.', 'warning');
        return false;
      }
    },

    // Accept friend request
    acceptFriendRequest: async (requestId) => {
      const request = get().pendingRequests.find(r => r.id === requestId);
      if (!request) return;

      get().addToast('Menyetujui request pertemanan...', 'info');

      try {
        const myPrivKey = await keyStore.getMyKey('identity-private') as CryptoKey;

        if (isSupabaseConfigured()) {
          // Update friendship status
          const { error: updateErr } = await supabase
            .from('friendships')
            .update({ status: 'accepted' })
            .eq('id', requestId);
          
          if (updateErr) throw updateErr;
          
          // Download friend's public key (Clean base64!)
          const friendPubKeyObj = await webCrypto.importPublicKey(request.sender.publicIdentityKey!);
          
          // Derive shared key
          const derivedKey = await webCrypto.deriveSharedSessionKey(myPrivKey, friendPubKeyObj);
          await keyStore.saveSessionKey(request.sender.id, derivedKey);
        } else {
          // Simulated approval
          const friendKeyPair = await webCrypto.generateE2EEKeyPair();
          const derived = await webCrypto.deriveSharedSessionKey(myPrivKey, friendKeyPair.publicKey);
          await keyStore.saveSessionKey(request.sender.id, derived);
        }

        set((state) => ({
          friends: [...state.friends, { ...request.sender, isOnline: true }],
          pendingRequests: state.pendingRequests.filter(r => r.id !== requestId)
        }));

        get().addToast(`Handshake E2EE selesai. Sekarang terhubung dengan @${request.sender.username}!`, 'success');
        
        if (isSupabaseConfigured() && get().currentUser) {
          await get().syncSupabaseData(get().currentUser!.id);
        }
      } catch (err) {
        console.error('Handshake failed on acceptance:', err);
        get().addToast('Gagal melakukan handshake E2EE.', 'warning');
      }
    },

    // Reject friend request
    rejectFriendRequest: async (requestId) => {
      try {
        if (isSupabaseConfigured()) {
          // Delete friendship request row from server
          await supabase.from('friendships').delete().eq('id', requestId);
        }
        set((state) => ({
          pendingRequests: state.pendingRequests.filter(r => r.id !== requestId)
        }));
        get().addToast('Request pertemanan ditolak.', 'info');
      } catch (err) {
        console.error('Failed to reject friend request', err);
      }
    },

    // Select Active Chat
    selectActiveChat: (friendId) => {
      set({ activeFriendId: friendId });
    },

    // Send Message
    sendMessage: async (text) => {
      const activeId = get().activeFriendId;
      const current = get().currentUser;
      if (!activeId || !current || !text.trim()) return;

      const messageText = text.trim();

      try {
        // Fetch derived key from IndexedDB
        const sessionKey = await keyStore.getSessionKey(activeId);
        if (!sessionKey) {
          get().addToast('Gagal mengirim: Kunci enkripsi belum terbuat.', 'warning');
          return;
        }

        // 1. Encrypt message locally using AES-256-GCM
        const encrypted = await webCrypto.encryptMessage(messageText, sessionKey);
        
        const newMsg: LocalMessage = {
          id: generateUUID(),
          senderId: current.id,
          recipientId: activeId,
          text: messageText, // Saved locally in memory
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          timestamp: new Date().toISOString(),
          isDelivered: false,
          isEncrypted: true
        };

        // Update local UI immediately
        set((state) => {
          const currentMsgs = state.messages[activeId] || [];
          return {
            messages: {
              ...state.messages,
              [activeId]: [...currentMsgs, newMsg]
            }
          };
        });

        if (isSupabaseConfigured()) {
          // 1. Insert to offline queue FIRST to get server-assigned ID
          const { data: inserted, error: insertErr } = await supabase.from('messages').insert({
            sender_id: current.id,
            recipient_id: activeId,
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv
          }).select('id').single();

          if (insertErr) {
            console.error('Failed to queue message:', insertErr);
            get().addToast('Gagal mengirim pesan ke server.', 'warning');
            return;
          }

          const serverId = inserted.id;

          // Update local message with server ID so dedup guard works
          set((state) => ({
            messages: {
              ...state.messages,
              [activeId]: (state.messages[activeId] || []).map(m =>
                m.id === newMsg.id ? { ...m, id: serverId, isDelivered: true } : m
              )
            }
          }));

          // 2. Broadcast on shared PAIR channel (both users are subscribed to this)
          const pairChannelId = getPairChannelId(current.id, activeId);
          const pairCh = pairChannels.get(pairChannelId);
          if (pairCh) {
            await pairCh.send({
              type: 'broadcast',
              event: 'new-message',
              payload: {
                msgId: serverId,
                senderId: current.id,
                ciphertext: encrypted.ciphertext,
                iv: encrypted.iv
              }
            });
          } else {
            console.warn('Pair channel not found for', pairChannelId);
          }
        } else {
          // Simulation auto-reply behavior!
          setTimeout(() => {
            set((state) => {
              const msgs = state.messages[activeId] || [];
              const updated = msgs.map(m => m.id === newMsg.id ? { ...m, isDelivered: true } : m);
              return { messages: { ...state.messages, [activeId]: updated } };
            });
          }, 800);

          // Simulated reply after 1.5 seconds
          setTimeout(async () => {
            const replies = [
              "Ini adalah balasan otomatis terenkripsi client-side AES-256-GCM.",
              "Sistem Zero-Knowledge mendeteksi pesan masuk dan mendekripsinya di browser saya.",
              "Kunci sesi kita terenkripsi penuh. Server Supabase tidak tahu apa yang kita bahas.",
              "Keren banget! Enkripsi ini super cepat karena pakai native Web Crypto API browser!"
            ];
            const randomReply = replies[Math.floor(Math.random() * replies.length)];
            
            // Encrypt reply using Bob's mock key
            const replyEncrypted = await webCrypto.encryptMessage(randomReply, sessionKey);
            
            const replyMsg: LocalMessage = {
              id: generateUUID(),
              senderId: activeId,
              recipientId: current.id,
              text: randomReply,
              ciphertext: replyEncrypted.ciphertext,
              iv: replyEncrypted.iv,
              timestamp: new Date().toISOString(),
              isDelivered: true,
              isEncrypted: true
            };

            set((state) => {
              const currentMsgs = state.messages[activeId] || [];
              return {
                messages: {
                  ...state.messages,
                  [activeId]: [...currentMsgs, replyMsg]
                }
              };
            });

            get().addToast(`Pesan baru didekripsi dari @${get().friends.find(f => f.id === activeId)?.username}`, 'success');
          }, 2000);
        }
      } catch (err) {
        console.error('Send error', err);
        get().addToast('Gagal mengenkripsi/mengirim pesan.', 'warning');
      }
    },

    // Update Avatar — direct upload (no encryption)
    updateAvatar: async (avatarDataUrl) => {
      const current = get().currentUser;
      if (!current) return;

      get().addToast('Mengupload foto profil...', 'info');

      try {
        // Update local state immediately for snappy UX
        set((state) => ({
          currentUser: { ...state.currentUser!, avatarUrl: avatarDataUrl }
        }));
        localStorage.setItem('womp-current-user', JSON.stringify({
          ...current,
          avatarUrl: avatarDataUrl
        }));

        if (isSupabaseConfigured()) {
          // Convert base64 dataUrl to Blob
          const base64Data = avatarDataUrl.split(',')[1];
          const byteString = atob(base64Data);
          const mimeMatch = avatarDataUrl.match(/data:([^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          const byteArray = new Uint8Array(byteString.length);
          for (let i = 0; i < byteString.length; i++) {
            byteArray[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([byteArray], { type: mimeType });
          const ext = mimeType.split('/')[1] || 'jpg';
          const fileName = `${current.id}.${ext}`;

          const { error: uploadErr } = await supabase.storage
            .from('avatars')
            .upload(fileName, blob, { upsert: true, contentType: mimeType });

          if (uploadErr) throw uploadErr;

          const { data: publicUrlData } = supabase.storage
            .from('avatars')
            .getPublicUrl(fileName);

          const { error: profileUpdateErr } = await supabase
            .from('profiles')
            .update({ profile_avatar_url: publicUrlData.publicUrl })
            .eq('id', current.id);

          if (profileUpdateErr) throw profileUpdateErr;
        }

        get().addToast('Foto profil berhasil diupload!', 'success');
      } catch (err) {
        console.error(err);
        get().addToast('Gagal upload foto profil.', 'warning');
      }
    },

    // Sync Database (Fetch accepted friends, pending requests, and offline messages queue)
    syncSupabaseData: async (userId) => {
      if (!isSupabaseConfigured()) return;
      
      try {
        // 1. Fetch user's profile to make sure they exist on the server
        const { data: myProfile, error: profileErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();
        
        if (profileErr || !myProfile) {
          console.warn('Profile not found on Supabase server', profileErr);
          return;
        }

        // Update local state with latest avatar URL if any
        if (myProfile.profile_avatar_url) {
          set((state) => ({
            currentUser: state.currentUser ? {
              ...state.currentUser,
              avatarUrl: myProfile.profile_avatar_url
            } : state.currentUser
          }));
        }

        // 2. Fetch accepted friendships (where I am either requester or addressee)
        const { data: activeFriendships, error: friendsErr } = await supabase
          .from('friendships')
          .select('*')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
          .eq('status', 'accepted');

        if (!friendsErr && activeFriendships) {
          const loadedFriends: UserProfile[] = [];
          const myPrivKey = await keyStore.getMyKey('identity-private') as CryptoKey;

          for (const f of activeFriendships) {
            const partnerId = f.requester_id === userId ? f.addressee_id : f.requester_id;
            
            // Get partner's profile details
            const { data: partnerProfile, error: partnerErr } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', partnerId)
              .maybeSingle();

            if (!partnerErr && partnerProfile) {
              const pubKeyBase64 = partnerProfile.public_identity_key; // Direct string!
              
              // Load derived session key from IndexedDB, if not derived yet, do it!
              let sessionKey = await keyStore.getSessionKey(partnerId);
              if (!sessionKey && myPrivKey) {
                try {
                  const partnerPubKeyObj = await webCrypto.importPublicKey(pubKeyBase64);
                  const derived = await webCrypto.deriveSharedSessionKey(myPrivKey, partnerPubKeyObj);
                  await keyStore.saveSessionKey(partnerId, derived);
                  sessionKey = derived;
                } catch (handshakeErr) {
                  console.error('Failed to auto-derive E2EE handshake key', handshakeErr);
                }
              }

              loadedFriends.push({
                id: partnerId,
                username: partnerProfile.username,
                publicIdentityKey: pubKeyBase64,
                avatarUrl: partnerProfile.profile_avatar_url,
                isOnline: true // Active
              });
            }
          }
          set({ friends: loadedFriends });

          // Subscribe to pair channel for each friend (idempotent)
          const currentUserId = get().currentUser?.id;
          if (currentUserId) {
            loadedFriends.forEach(f => subscribeToFriendChannel(currentUserId, f.id));
          }
        }

        // 3. Fetch pending incoming friend requests
        const { data: pendingReqs, error: reqsErr } = await supabase
          .from('friendships')
          .select('*')
          .eq('addressee_id', userId)
          .eq('status', 'pending');

        if (!reqsErr && pendingReqs) {
          const loadedRequests: FriendRequest[] = [];
          for (const r of pendingReqs) {
            const { data: senderProfile, error: senderErr } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', r.requester_id)
              .maybeSingle();

            if (!senderErr && senderProfile) {
              loadedRequests.push({
                id: r.id,
                sender: {
                  id: senderProfile.id,
                  username: senderProfile.username,
                  publicIdentityKey: senderProfile.public_identity_key // Direct string!
                }
              });
            }
          }
          set({ pendingRequests: loadedRequests });
        }

        // 4. Consume offline messages queue
        const { data: offlineMsgs, error: msgsErr } = await supabase
          .from('messages')
          .select('*')
          .eq('recipient_id', userId)
          .eq('is_delivered', false);

        if (!msgsErr && offlineMsgs && offlineMsgs.length > 0) {
          const newMsgsMap: { [friendId: string]: LocalMessage[] } = { ...get().messages };

          for (const m of offlineMsgs) {
            const senderId = m.sender_id;
            const sessionKey = await keyStore.getSessionKey(senderId);
            
            if (sessionKey) {
              try {
                // Decrypt directly from String!
                const decryptedText = await webCrypto.decryptMessage({ 
                  ciphertext: m.ciphertext, 
                  iv: m.iv 
                }, sessionKey);
                
                const localMsg: LocalMessage = {
                  id: m.id,
                  senderId,
                  recipientId: userId,
                  text: decryptedText,
                  ciphertext: m.ciphertext,
                  iv: m.iv,
                  timestamp: m.timestamp || new Date().toISOString(),
                  isDelivered: true,
                  isEncrypted: true
                };

                if (!newMsgsMap[senderId]) {
                  newMsgsMap[senderId] = [];
                }
                // Avoid duplicate appends
                if (!newMsgsMap[senderId].some(existing => existing.id === m.id)) {
                  newMsgsMap[senderId].push(localMsg);
                }
              } catch (decErr) {
                console.error('Failed to decrypt offline message', decErr);
              }
            }
          }
          set({ messages: newMsgsMap });

          // Mark consumed offline messages as delivered in Supabase
          const msgIds = offlineMsgs.map(m => m.id);
          await supabase
            .from('messages')
            .update({ is_delivered: true })
            .in('id', msgIds);
        }

      } catch (syncErr) {
        console.error('Failed to sync Supabase data', syncErr);
      }
    }
  };
});
