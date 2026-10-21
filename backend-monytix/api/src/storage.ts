import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type ObjectStore = {
  presignPut(key: string): Promise<{ url: string; method: "PUT" }>;
  getObject(key: string): Promise<Buffer | null>;
};

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const endpoint = env.OBJECT_STORAGE_ENDPOINT?.trim() ?? "";
  const bucket = env.OBJECT_STORAGE_BUCKET?.trim() ?? "";
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() ?? "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    region: env.OBJECT_STORAGE_REGION?.trim() || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export function createObjectStore(config: StorageConfig): ObjectStore {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    async presignPut(key: string) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 900 });
      return { url, method: "PUT" };
    },
    async getObject(key: string) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        const bytes = await result.Body?.transformToByteArray();
        return bytes ? Buffer.from(bytes) : null;
      } catch (error) {
        if (error instanceof NoSuchKey || (error && typeof error === "object" && "name" in error && error.name === "NoSuchKey")) return null;
        throw error;
      }
    },
  };
}
