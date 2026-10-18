
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ENCRYPTION_KEY = process.env.DRIVE_TOKEN_ENCRYPTION_KEY;

function getKey(): Buffer {
  if (!ENCRYPTION_KEY) {
    throw new Error("DRIVE_TOKEN_ENCRYPTION_KEY is missing");
  }

  const key = Buffer.from(ENCRYPTION_KEY, "base64");

  if (key.length !== 32) {
    throw new Error("Encryption key must decode to 32 bytes");
  }

  return key;
}

export function createOAuthState(uid: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid,
      exp: Date.now() + 10 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    })
  ).toString("base64url");

  const signature = createHmac("sha256", getKey())
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

export function verifyOAuthState(
  state: string
): { uid: string } | null {
  try {
    const parts = state.split(".");
    if (parts.length !== 2) return null;

    const [payload, signature] = parts;

    const expected = createHmac("sha256", getKey())
      .update(payload)
      .digest();

    const received = Buffer.from(signature, "base64url");

    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return null;
    }

    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (
      typeof data.uid !== "string" ||
      !data.uid ||
      typeof data.exp !== "number" ||
      data.exp < Date.now() ||
      typeof data.nonce !== "string"
    ) {
      return null;
    }

    return { uid: data.uid };
  } catch {
    return null;
  }
}

export function encryptRefreshToken(token: string): string {
  const key = getKey();
  const iv = randomBytes(12);

  const { createCipheriv } = require("node:crypto") as typeof import("node:crypto");
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptRefreshToken(value: string): string {
  const key = getKey();
  const parts = value.split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const [ivPart, tagPart, encryptedPart] = parts;
  const { createDecipheriv } = require("node:crypto") as typeof import("node:crypto");

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
