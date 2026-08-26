'use client';

import Papa from 'papaparse';
import { useState } from 'react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FileUpload({ onParsed }: { onParsed: (emails: string[]) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    setFileName(file.name);
    setError(null);

    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const emails = new Set<string>();
        for (const row of results.data) {
          for (const cell of row) {
            const trimmed = (cell ?? '').toString().trim();
            if (EMAIL_REGEX.test(trimmed)) {
              emails.add(trimmed.toLowerCase());
            }
          }
        }
        const list = Array.from(emails);
        setCount(list.length);
        if (list.length === 0) {
          setError('No valid email addresses were found in this file.');
        }
        onParsed(list);
      },
      error: () => {
        setError('Could not parse this file.');
        onParsed([]);
      },
    });
  }

  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition hover:bg-slate-100">
        <span className="text-sm font-medium text-slate-700">
          {fileName ?? 'Click to upload a CSV or text file of leads'}
        </span>
        <span className="mt-1 text-xs text-slate-400">One email per line or column</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </label>
      {count !== null && !error && (
        <p className="mt-2 text-sm text-emerald-700">
          {count} recipient{count === 1 ? '' : 's'} detected
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
