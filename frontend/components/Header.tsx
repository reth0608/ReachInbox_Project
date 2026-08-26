'use client';

import { signOut, useSession } from 'next-auth/react';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-brand-600" />
        <span className="text-sm font-semibold text-slate-900">ReachInbox Scheduler</span>
      </div>

      {session?.user && (
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-slate-800">{session.user.name}</p>
            <p className="text-xs text-slate-500">{session.user.email}</p>
          </div>
          {session.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.user.image} alt="" className="h-8 w-8 rounded-full" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-slate-300" />
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="ml-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      )}
    </header>
  );
}
