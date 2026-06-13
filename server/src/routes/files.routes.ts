import { randomUUID } from 'crypto';
import path from 'path';
import Busboy from 'busboy';
import { Router, Request, Response } from 'express';
import { query } from '../config/db';
import { ensureFileBucket, fileBucket, getObjectUrl, storageClient } from '../config/storage';

const router = Router();
const MAX_FILE_BYTES = Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 25 * 1024 * 1024);

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeFilename(filename: string): string {
  const parsed = path.parse(filename);
  const base = parsed.name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'upload';
  const ext = parsed.ext.replace(/[^a-z0-9.]/gi, '').slice(0, 16);
  return `${base}${ext}`;
}

router.post('/upload', async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.query.sessionId;

  if (!isUuid(sessionId)) {
    res.status(400).json({ error: 'A valid sessionId query parameter is required' });
    return;
  }

  try {
    const { rows } = await query<{ status: string }>(
      'SELECT status FROM sessions WHERE id = $1',
      [sessionId],
    );

    if (!rows[0]) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (rows[0].status === 'ENDED') {
      res.status(409).json({ error: 'Session has ended' });
      return;
    }
  } catch (err) {
    console.error('[Files] Session validation error:', (err as Error).message);
    res.status(500).json({ error: 'Failed to validate session' });
    return;
  }

  const contentType = req.headers['content-type'];
  if (!contentType?.includes('multipart/form-data')) {
    res.status(415).json({ error: 'multipart/form-data is required' });
    return;
  }

  await ensureFileBucket();

  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 1, fileSize: MAX_FILE_BYTES },
  });
  let uploadPromise: Promise<void> | null = null;
  let originalName = '';
  let objectKey = '';
  let mimeType = 'application/octet-stream';
  let limited = false;
  let responded = false;

  function sendOnce(status: number, body: unknown): void {
    if (responded) return;
    responded = true;
    res.status(status).json(body);
  }

  busboy.on('file', (_fieldName, file, info) => {
    originalName = info.filename || 'upload';
    mimeType = info.mimeType || 'application/octet-stream';
    objectKey = `${sessionId}/${randomUUID()}-${safeFilename(originalName)}`;

    file.on('limit', () => {
      limited = true;
      file.resume();
    });

    uploadPromise = storageClient
      .putObject(fileBucket, objectKey, file, undefined, {
        'Content-Type': mimeType,
        'X-Amz-Meta-Original-Name': originalName,
      })
      .then(() => undefined);
  });

  busboy.on('error', (err) => {
    sendOnce(400, { error: err instanceof Error ? err.message : 'Malformed multipart upload' });
  });

  busboy.on('finish', async () => {
    if (responded) return;
    if (!uploadPromise || !objectKey) {
      sendOnce(400, { error: 'No file was uploaded' });
      return;
    }

    try {
      await uploadPromise;

      if (limited) {
        await storageClient.removeObject(fileBucket, objectKey).catch(() => undefined);
        sendOnce(413, { error: `File exceeds ${MAX_FILE_BYTES} bytes` });
        return;
      }

      const url = await getObjectUrl(objectKey);
      sendOnce(201, {
        url,
        objectKey,
        filename: originalName,
        mimeType,
        sizeLimit: MAX_FILE_BYTES,
      });
    } catch (err) {
      console.error('[Files] Upload error:', (err as Error).message);
      sendOnce(500, { error: 'Failed to upload file' });
    }
  });

  req.pipe(busboy);
});

export default router;
