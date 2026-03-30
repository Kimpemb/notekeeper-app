// src/features/backup/lib/crypto.ts
//
// Password-based AES-256-GCM encryption using the Web Crypto API.
// No external dependencies — runs entirely in the webview.
//
// Encrypt flow:
//   password + Uint8Array → derive key (PBKDF2) → encrypt (AES-GCM) → base64 string
//
// Decrypt flow:
//   password + base64 string → extract salt/iv → derive key → decrypt → Uint8Array

// ─── Constants ────────────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 310_000;
const SALT_LENGTH       = 16;
const IV_LENGTH         = 12;
const KEY_LENGTH        = 256;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length)) as Uint8Array<ArrayBuffer>;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary  = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array<ArrayBuffer> {
  const binary = atob(str);
  const buffer = new ArrayBuffer(binary.length);
  const view   = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return view as Uint8Array<ArrayBuffer>;
}

// ─── Key derivation ───────────────────────────────────────────────────────────

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();

  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name:       "PBKDF2",
      salt:       salt.slice() as Uint8Array<ArrayBuffer>,
      iterations: PBKDF2_ITERATIONS,
      hash:       "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypts raw bytes with a password.
 * Returns a base64-encoded string: salt[16] + iv[12] + ciphertext[n]
 */
export async function encrypt(data: Uint8Array<ArrayBuffer>, password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const iv   = randomBytes(IV_LENGTH);
  const key  = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.slice() as Uint8Array<ArrayBuffer> },
    key,
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  );

  const packed = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  packed.set(salt, 0);
  packed.set(iv, SALT_LENGTH);
  packed.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

  return toBase64(packed.buffer as ArrayBuffer);
}

/**
 * Decrypts a base64-encoded encrypted string with a password.
 * Returns raw bytes. Throws if the password is wrong or data is corrupted.
 */
export async function decrypt(encoded: string, password: string): Promise<Uint8Array<ArrayBuffer>> {
  const packed = fromBase64(encoded);

  const salt       = packed.slice(0, SALT_LENGTH) as Uint8Array<ArrayBuffer>;
  const iv         = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH) as Uint8Array<ArrayBuffer>;
  const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH) as Uint8Array<ArrayBuffer>;

  const key = await deriveKey(password, salt);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error("Incorrect password or corrupted backup file.");
  }

  return new Uint8Array(plaintext) as Uint8Array<ArrayBuffer>;
}