/**
 * WOMP Cryptography Module (Zero-Knowledge, E2EE)
 * Powered strictly by modern browser-native Web Crypto API.
 * Uses P-256 ECDH for Key Agreement & AES-256-GCM for Message/Profile Encryption.
 */

// Helper to convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Helper to convert Base64 to ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper to convert string to ArrayBuffer (UTF-8)
export function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

// Helper to convert ArrayBuffer to string (UTF-8)
export function bufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

/**
 * 1. Secure Deterministic Client-Side Password Hashing
 * Prevents plain passwords from ever reaching Supabase.
 */
export async function hashPasswordClientSide(password: string, username: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = encoder.encode(username.toLowerCase()); // Username as deterministic salt

  // Import key material
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive a strong 256-bit hash using PBKDF2
  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const exportedKey = await window.crypto.subtle.exportKey('raw', derivedKey);
  return arrayBufferToBase64(exportedKey);
}

/**
 * 2. Key Pair Generation (ECDH P-256 Curve)
 * Used to generate Identity Keys and Pre-keys.
 */
export interface E2EEKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateE2EEKeyPair(): Promise<E2EEKeyPair> {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  ) as E2EEKeyPair;
}

// Export a public key to base64 string
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return arrayBufferToBase64(exported);
}

// Import a public key from base64 string
export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    'spki',
    buffer,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    []
  );
}

// Export a private key to base64 string (For backup or encrypted storage)
export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('pkcs8', key);
  return arrayBufferToBase64(exported);
}

// Import a private key from base64 string
export async function importPrivateKey(base64Key: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    'pkcs8',
    buffer,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * 3. E2EE Handshake / Shared Key Agreement (ECDH + HKDF)
 * Alice uses her Private Key and Bob's Public Key to generate a symmetric key.
 */
export async function deriveSharedSessionKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey
): Promise<CryptoKey> {
  // Derive a raw shared secret using Elliptic Curve Diffie-Hellman
  const sharedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: theirPublicKey
    },
    myPrivateKey,
    256 // 256 bits shared secret
  );

  // Import shared secret as key material for HKDF
  const rawSecretKey = await window.crypto.subtle.importKey(
    'raw',
    sharedBits,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  // Derive a highly secure 256-bit AES-GCM message encryption key using HKDF-SHA256
  return await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0), // empty salt
      info: new TextEncoder().encode('WOMP-E2EE-CHAT-SESSION-KEY') // App context info
    },
    rawSecretKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * 4. AES-256-GCM Encryption / Decryption
 * Encrypts and decrypts messages/payloads locally.
 */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string; // Base64 Initialization Vector
}

// Encrypt a text message
export async function encryptMessage(
  plaintext: string,
  sessionKey: CryptoKey
): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  
  // Generate random 12-byte IV for AES-GCM
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    sessionKey,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv.buffer)
  };
}

// Decrypt a text message
export async function decryptMessage(
  payload: EncryptedPayload,
  sessionKey: CryptoKey
): Promise<string> {
  const ciphertext = base64ToArrayBuffer(payload.ciphertext);
  const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    sessionKey,
    ciphertext
  );

  return bufferToString(decryptedBuffer);
}

/**
 * 5. Profile & Photo Encryption
 * Encrypts arbitrary binary data (like WebP images) with a custom key.
 */
export async function generateProfileKey(): Promise<CryptoKey> {
  return await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true,
    ['encrypt', 'decrypt']
  );
}

// Encrypt any ArrayBuffer (like an image file buffer)
export async function encryptBinary(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<EncryptedPayload> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    data
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    iv: arrayBufferToBase64(iv.buffer)
  };
}

// Decrypt any ArrayBuffer (like an image file buffer)
export async function decryptBinary(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<ArrayBuffer> {
  const ciphertext = base64ToArrayBuffer(payload.ciphertext);
  const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));

  return await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    ciphertext
  );
}
