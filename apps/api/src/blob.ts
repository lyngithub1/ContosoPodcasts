/**
 * Azure Blob Storage adapter — stores synthesized audio and transcript
 * artifacts and streams them back for playback.
 *
 * Auth uses the platform managed identity (Storage Blob Data Contributor) via
 * DefaultAzureCredential — no account keys or connection strings. The audio
 * containers keep no public access, so playback is proxied through the API
 * rather than handed out as public URLs.
 */

import { BlobServiceClient } from '@azure/storage-blob';
import { config } from './config.js';
import { credential } from './azure.js';

export function blobEnabled(): boolean {
  return Boolean(config.storageBlobEndpoint);
}

let service: BlobServiceClient | undefined;

function client(): BlobServiceClient {
  if (!config.storageBlobEndpoint) throw new Error('STORAGE_BLOB_ENDPOINT is not configured');
  if (!service) service = new BlobServiceClient(config.storageBlobEndpoint, credential());
  return service;
}

export interface UploadResult {
  container: string;
  blobPath: string;
  bytes: number;
}

/** Upload a buffer to a container, overwriting any existing blob. */
export async function uploadBlob(
  container: string,
  blobPath: string,
  data: Buffer,
  contentType: string,
): Promise<UploadResult> {
  if (!blobEnabled()) throw new Error('Blob storage is not configured');
  const block = client().getContainerClient(container).getBlockBlobClient(blobPath);
  await block.uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } });
  return { container, blobPath, bytes: data.length };
}

/** Download a blob into a Buffer. Throws when the blob does not exist. */
export async function downloadBlob(container: string, blobPath: string): Promise<Buffer> {
  if (!blobEnabled()) throw new Error('Blob storage is not configured');
  const block = client().getContainerClient(container).getBlockBlobClient(blobPath);
  return block.downloadToBuffer();
}

/** Copy a blob between containers (used when promoting a preview to approved). */
export async function copyBlob(
  srcContainer: string,
  srcPath: string,
  destContainer: string,
  destPath: string,
): Promise<void> {
  if (!blobEnabled()) throw new Error('Blob storage is not configured');
  const data = await downloadBlob(srcContainer, srcPath);
  const src = client().getContainerClient(srcContainer).getBlockBlobClient(srcPath);
  const props = await src.getProperties().catch(() => undefined);
  await uploadBlob(destContainer, destPath, data, props?.contentType ?? 'application/octet-stream');
}
