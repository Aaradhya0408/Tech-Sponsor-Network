import { randomUUID } from "node:crypto";

const SIDECAR = "http://127.0.0.1:1106";
const MAX_PRIVATE_FILE_SIZE = 5 * 1024 * 1024;

function parseBucketObject(fullPath: string): {
  bucketName: string;
  objectName: string;
} {
  const parts = fullPath.replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  const objectName = parts.join("/");
  if (!bucketName || !objectName) {
    throw new Error("The private object path is not configured correctly.");
  }
  return { bucketName, objectName };
}

function privateDirectory(): string {
  const directory = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!directory) {
    throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  }
  return directory.replace(/\/+$/, "");
}

function objectPathForKey(key: string): string {
  return `/objects/${key}`;
}

async function signPrivateObjectUrl(
  key: string,
  method: "GET" | "PUT" | "DELETE",
): Promise<string> {
  const { bucketName, objectName } = parseBucketObject(
    `${privateDirectory()}/${key}`,
  );
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + (method === "PUT" ? 15 : 2) * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Private object URL signing failed (${response.status}).`);
  }
  const payload = (await response.json()) as { signed_url?: string };
  if (!payload.signed_url) throw new Error("Private object URL was not returned.");
  return payload.signed_url;
}

function privateKeyForPath(objectPath: string): string {
  if (!objectPath.startsWith("/objects/") || objectPath.includes("..")) {
    throw new Error("Invalid private object path.");
  }
  const key = objectPath.slice("/objects/".length);
  if (!key || key.startsWith("/")) throw new Error("Invalid private object path.");
  return key;
}

export async function createStagingUpload(
  creatorId: string,
  applicationId: string,
  fileKind: "INVOICE" | "WORK_PHOTO",
): Promise<{ uploadURL: string; objectPath: string }> {
  const pathKind = fileKind === "WORK_PHOTO" ? "work-photo" : "invoice";
  const key = `invoice-staging/${creatorId}/${applicationId}/${pathKind}/${randomUUID()}`;
  return {
    uploadURL: await signPrivateObjectUrl(key, "PUT"),
    objectPath: objectPathForKey(key),
  };
}

export function isCreatorStagingPath(
  objectPath: string,
  creatorId: string,
  applicationId: string,
  fileKind: "invoice" | "work-photo",
): boolean {
  return (
    new RegExp(
      `^/objects/invoice-staging/${creatorId}/${applicationId}/${fileKind}/[a-f0-9-]{36}$`,
    ).test(objectPath) &&
    !objectPath.includes("..")
  );
}

export async function readPrivateObject(
  objectPath: string,
): Promise<{ bytes: Buffer; size: number }> {
  const key = privateKeyForPath(objectPath);
  const url = await signPrivateObjectUrl(key, "GET");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) {
    throw new Error("The private upload is missing or could not be read.");
  }
  const headerSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(headerSize) && headerSize > MAX_PRIVATE_FILE_SIZE) {
    throw new Error("The uploaded file must be no larger than 5 MB.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_PRIVATE_FILE_SIZE) {
      throw new Error("The uploaded file must be no larger than 5 MB.");
    }
    chunks.push(bytes);
  }
  if (size < 1 || (Number.isFinite(headerSize) && headerSize !== size)) {
    throw new Error("The uploaded file size could not be verified.");
  }
  return { bytes: Buffer.concat(chunks, size), size };
}

export async function storeVerifiedPrivateObject(
  destinationKey: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const url = await signPrivateObjectUrl(destinationKey, "PUT");
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Saving the private invoice file failed (${response.status}).`);
  }
  return objectPathForKey(destinationKey);
}

export async function deletePrivateObject(objectPath: string): Promise<void> {
  try {
    const url = await signPrivateObjectUrl(privateKeyForPath(objectPath), "DELETE");
    await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(10_000) });
  } catch {
    // A failed cleanup leaves only an unreferenced private object.
  }
}

export async function streamPrivateObject(
  objectPath: string,
  response: import("express").Response,
  contentType: string,
  filename: string,
): Promise<void> {
  const url = await signPrivateObjectUrl(privateKeyForPath(objectPath), "GET");
  const source = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!source.ok || !source.body) {
    throw new Error(`Reading the private invoice file failed (${source.status}).`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_PRIVATE_FILE_SIZE) {
      throw new Error("The private invoice file exceeds its allowed size.");
    }
    chunks.push(bytes);
  }
  response.setHeader("Content-Type", contentType);
  response.setHeader(
    "Content-Disposition",
    `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
  );
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(Buffer.concat(chunks, size));
}

export async function removeStagingObject(objectPath: string): Promise<void> {
  await deletePrivateObject(objectPath);
}
