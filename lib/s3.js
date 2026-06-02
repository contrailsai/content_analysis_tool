import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getBucket() {
  const b = process.env.AWS_BUCKET?.trim();
  if (!b) throw new Error("AWS_BUCKET must be set.");
  return b;
}

export function getS3Client() {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error("AWS_REGION must be set.");
  return new S3Client({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

export function bucketName() {
  return getBucket();
}

export async function putObjectToS3({ key, body, contentType, metadata, contentDisposition }) {
  const client = getS3Client();
  const bucket = getBucket();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      ...(metadata && Object.keys(metadata).length ? { Metadata: metadata } : {}),
      ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
    }),
  );
  return { bucket, key };
}

export async function getPresignedGetUrl({ key, expiresIn = 3600 }) {
  const client = getS3Client();
  const bucket = getBucket();
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, cmd, { expiresIn });
}

/** Browser PUT: sign only Content-Type to avoid 403 header/signature mismatches. */
export async function getPresignedPutUrl({ key, contentType, expiresIn = 900 }) {
  const client = getS3Client();
  const bucket = getBucket();
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

/** Apply user metadata + disposition after a bare presigned PUT (server-side). */
export async function applyObjectMetadata({ key, contentType, metadata, contentDisposition }) {
  const client = getS3Client();
  const bucket = getBucket();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: key,
      CopySource: `${bucket}/${encodeURIComponent(key)}`,
      MetadataDirective: "REPLACE",
      ContentType: contentType || "application/octet-stream",
      ...(metadata && Object.keys(metadata).length ? { Metadata: metadata } : {}),
      ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
    }),
  );
}

export async function headObjectFromS3({ key }) {
  const client = getS3Client();
  const bucket = getBucket();
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}
