'use client';

import type { EmailJob } from '@/lib/types';

const STATUS_STYLES: Record<EmailJob['status'], string> = {
  scheduled: 'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  sent: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: EmailJob['status'] }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function EmailJobsTable({
  jobs,
  variant,
}: {
  jobs: EmailJob[];
  variant: 'scheduled' | 'sent';
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium text-slate-500">Recipient</th>
            <th className="px-4 py-2.5 text-left font-medium text-slate-500">Subject</th>
            <th className="px-4 py-2.5 text-left font-medium text-slate-500">Status</th>
            <th className="px-4 py-2.5 text-left font-medium text-slate-500">
              {variant === 'scheduled' ? 'Scheduled Time' : 'Sent Time'}
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-slate-500">Attempts</th>
            <th className="px-4 py-2.5 text-left font-medium text-slate-500">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {jobs.map((job) => (
            <tr key={job.id}>
              <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">{job.recipientEmail}</td>
              <td className="max-w-[16rem] truncate px-4 py-2.5 text-slate-600">{job.campaignSubject}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={job.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                {variant === 'scheduled' ? formatDate(job.scheduledTime) : formatDate(job.sentAt)}
              </td>
              <td className="px-4 py-2.5 text-slate-600">{job.attempts}</td>
              <td
                className="max-w-[14rem] truncate px-4 py-2.5 text-red-600"
                title={job.errorMessage ?? undefined}
              >
                {job.errorMessage ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
