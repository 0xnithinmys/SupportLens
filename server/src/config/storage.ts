import { Client } from 'minio';

const DEFAULT_ENDPOINT = 'http://localhost:9000';
const DEFAULT_BUCKET = 'atomquest-files';

function parseEndpoint(): URL {
  const raw = process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? DEFAULT_ENDPOINT;
  return new URL(raw.includes('://') ? raw : `http://${raw}`);
}

const endpoint = parseEndpoint();

export const fileBucket = process.env.S3_BUCKET ?? process.env.MINIO_BUCKET ?? DEFAULT_BUCKET;

export const storageClient = new Client({
  endPoint: endpoint.hostname,
  port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === 'https:' ? 443 : 80,
  useSSL: endpoint.protocol === 'https:',
  accessKey: process.env.S3_ACCESS_KEY ?? process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.S3_SECRET_KEY ?? process.env.MINIO_SECRET_KEY ?? 'minioadmin',
  region: process.env.S3_REGION ?? 'us-east-1',
});

export async function ensureFileBucket(): Promise<void> {
  const exists = await storageClient.bucketExists(fileBucket);
  if (!exists) {
    await storageClient.makeBucket(fileBucket, process.env.S3_REGION ?? 'us-east-1');
  }
}

export async function getObjectUrl(objectKey: string): Promise<string> {
  const publicBase = process.env.FILE_PUBLIC_BASE_URL ?? process.env.S3_PUBLIC_BASE_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, '')}/${encodeURIComponent(objectKey).replace(/%2F/g, '/')}`;
  }

  const expirySeconds = Number(process.env.FILE_URL_EXPIRES_SECONDS ?? 60 * 60 * 24 * 7);
  return storageClient.presignedGetObject(fileBucket, objectKey, expirySeconds);
}
