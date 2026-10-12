import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type SignedUpload = {
  url: string;
  headers: Record<string, string>;
};

export type StoredObject = {
  body: Buffer;
  size: number;
  etag: string;
};

export type ObjectStorage = {
  presignUpload(input: {
    key: string;
    contentType: string;
    byteSize: number;
  }): Promise<SignedUpload>;
  readObject(key: string): Promise<StoredObject | null>;
  copyObject(sourceKey: string, targetKey: string): Promise<string>;
  deleteObject(key: string): Promise<void>;
  close(): Promise<void>;
};

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const endpoint = env.OBJECT_STORAGE_ENDPOINT?.trim() ?? "";
  const bucket = env.OBJECT_STORAGE_BUCKET?.trim() ?? "";
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() ?? "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    endpoint,
    region: env.OBJECT_STORAGE_REGION?.trim() || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export function createObjectStorage(config: StorageConfig): ObjectStorage {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async presignUpload(input) {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
      });
      const url = await getSignedUrl(client, command, { expiresIn: 900 });
      return {
        url,
        headers: {
          "content-type": input.contentType,
          "content-length": String(input.byteSize),
        },
      };
    },

    async readObject(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (!result.Body) {
          return null;
        }
        const body = Buffer.from(await result.Body.transformToByteArray());
        return { body, size: body.length, etag: result.ETag ?? "" };
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      }
    },

    async copyObject(sourceKey, targetKey) {
      const result = await client.send(new CopyObjectCommand({
        Bucket: config.bucket,
        Key: targetKey,
        CopySource: `${config.bucket}/${sourceKey}`,
      }));
      return result.CopyObjectResult?.ETag ?? "";
    },

    async deleteObject(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }
    },

    async close() {
      client.destroy();
    },
  };
}

export function sha256Hex(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  const code = "$metadata" in error && error.$metadata && typeof error.$metadata === "object" && "httpStatusCode" in error.$metadata
    ? Number(error.$metadata.httpStatusCode)
    : 0;
  return name === "NoSuchKey" || name === "NotFound" || code === 404;
}
