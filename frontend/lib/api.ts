'use client';

import { getSession } from 'next-auth/react';
import type { Campaign, CreateCampaignInput, CreateCampaignResponse, EmailJob, EmailJobStatus, Sender } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = await getSession();
  const token = session?.accessToken;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, body.error ?? `Request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  senders: () => request<{ senders: Sender[] }>('/api/senders'),

  campaigns: () => request<{ campaigns: Campaign[] }>('/api/campaigns'),

  createCampaign: (input: CreateCampaignInput) =>
    request<CreateCampaignResponse>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  emailJobs: (statuses: EmailJobStatus[]) =>
    request<{ jobs: EmailJob[] }>(`/api/email-jobs?status=${statuses.join(',')}`),
};
