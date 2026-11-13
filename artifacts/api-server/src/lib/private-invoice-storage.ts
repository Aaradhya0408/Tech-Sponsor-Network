import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Storage, type File } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

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

function privateFile(key: string): File {
  const { bucketName, objectName } = parseBucketObject(
    `${privateDirectory()}/${key}`,
  );
  return storage.bucket(bucketName).file(objectName);
}

async function signPrivateUpload(key: string): Promise<string> {
  const { bucketName, objectName } = parseBucketObject(
    `${privateDirectory()}/${key}`,
  );
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Private upload URL signing failed (${response.status}).`);
  }
  const payload = (await response.json()) as { signed_url?: string };
  if (!payload.signed_url) throw new Error("Private upload URL was not returned.");
  return payload.signed_url;
}

export async function createStagingUpload(
  creatorId: string,
  applicationId: string,
  fileKind: "INVOICE" | "WORK_PHOTO",
): Promise<{ uploadURL: string; objectPath: string }> {
  const pathKind = fileKind === "WORK_PHOTO" ? "work-photo" : "invoice";
  const key = `invoice-staging/${creatorId}/${applicationId}/${pathKind}/${randomUUID()}`;
  return {
    uploadURL: await signPrivateUpload(key),
    objectPath: `/objects/${key}`,
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

export function getPrivateObject(objectPath: string): File {
  if (!objectPath.startsWith("/objects/") || objectPath.includes("..")) {
    throw new Error("Invalid private object path.");
  }
  return privateFile(objectPath.slice("/objects/".length));
}

export async function readPrivateObject(
  objectPath: string,
): Promise<{ file: File; bytes: Buffer; size: number }> {
  const file = getPrivateObject(objectPath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 * 1024) {
    throw new Error("The uploaded file must be no larger than 5 MB.");
  }
  const [bytes] = await file.download();
  if (bytes.length !== size) {
    throw new Error("The uploaded file size could not be verified.");
  }
  return { file, bytes, size };
}

export async function storeVerifiedPrivateObject(
  destinationKey: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const destination = privateFile(destinationKey);
  await destination.save(bytes, {
    resumable: false,
    validation: "crc32c",
    metadata: {
      contentType,
      cacheControl: "private, no-store",
    },
  });
  return `/objects/${destinationKey}`;
}

export async function deletePrivateObject(objectPath: string): Promise<void> {
  try {
    await getPrivateObject(objectPath).delete({ ignoreNotFound: true });
  } catch {
    // A failed cleanup leaves only an unreferenced private object.
  }
}

export async function streamPrivateObject(
  file: File,
  response: import("express").Response,
  contentType: string,
  filename: string,
): Promise<void> {
  response.setHeader("Content-Type", contentType);
  response.setHeader(
    "Content-Disposition",
    `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
  );
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on("error", reject);
    response.on("finish", resolve);
    Readable.from(stream).pipe(response);
  });
}

export async function removeStagingObject(objectPath: string): Promise<void> {
  await deletePrivateObject(objectPath);
}
