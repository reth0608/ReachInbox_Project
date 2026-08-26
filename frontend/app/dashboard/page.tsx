'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/Header';
import { Tabs } from '@/components/Tabs';
import { EmailJobsTable } from '@/components/Table';
import { EmptyState } from '@/components/EmptyState';
import { ComposeModal } from '@/components/ComposeModal';
import { api } from '@/lib/api';

const POLL_INTERVAL_MS = 7000;

type TabKey = 'scheduled' | 'sent';

export default function DashboardPage() {
  const [tab, setTab] = useState<TabKey>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);

  const statuses = tab === 'scheduled' ? (['scheduled', 'processing'] as const) : (['sent', 'failed'] as const);

  const jobsQuery = useQuery({
    queryKey: ['email-jobs', tab],
    queryFn: () => api.emailJobs([...statuses]),
    refetchInterval: POLL_INTERVAL_MS,
  });

  return (
    <div className="min-h-screen">
      <Header />

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={[
              { key: 'scheduled', label: 'Scheduled Emails' },
              { key: 'sent', label: 'Sent Emails' },
            ]}
            active={tab}
            onChange={(k) => setTab(k as TabKey)}
          />
          <button
            onClick={() => setComposeOpen(true)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            + Compose New Email
          </button>
        </div>

        <div className="mt-6">
          {jobsQuery.isLoading ? (
            <p className="py-16 text-center text-sm text-slate-400">Loading…</p>
          ) : jobsQuery.isError ? (
            <p className="py-16 text-center text-sm text-red-600">Failed to load emails. Retrying…</p>
          ) : jobsQuery.data && jobsQuery.data.jobs.length > 0 ? (
            <EmailJobsTable jobs={jobsQuery.data.jobs} variant={tab} />
          ) : (
            <EmptyState
              title={tab === 'scheduled' ? 'No scheduled emails yet' : 'No sent emails yet'}
              subtitle={
                tab === 'scheduled'
                  ? 'Compose a new email to schedule your first campaign.'
                  : 'Sent (and failed) emails will show up here once campaigns run.'
              }
            />
          )}
        </div>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}
