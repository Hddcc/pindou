import type {Document, Snapshot} from '../domain/editor';
export type User = {id: string; username: string};
export type CloudWork = {id: string; name: string; snapshot: Snapshot; revision: number; contentHash: string; createdAt: string; updatedAt: string};
export type Summary = {id: string; name: string; width: number; height: number; revision: number; updatedAt: string};
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public requestId?: string) { super(message); }
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api/v1${path}`, {...init, signal: controller.signal, credentials: 'include',
      headers: {'Content-Type': 'application/json', ...init.headers}});
    const body = await response.json();
    if (!response.ok || body.code !== 'OK') throw new ApiError(body.code, body.message ?? '请求失败', response.status, body.requestId);
    return body.data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error('网络连接失败，作品仍保留在本地，可稍后重试');
  } finally { clearTimeout(timeout); }
}
export const cloudDocument = (w: CloudWork): Document => ({fileType: 'pindou', schemaVersion: 1, name: w.name, snapshot: w.snapshot, updatedAt: w.updatedAt});
export const content = (d: Document) => JSON.stringify({name: d.name, snapshot: d.snapshot});
export const workBody = (d: Document, baseRevision?: number) => JSON.stringify({name: d.name, snapshot: d.snapshot, baseRevision, clientUpdatedAt: d.updatedAt});
