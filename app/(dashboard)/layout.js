import Link from "next/link";

export default function DashboardLayout({ children }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
            <span className="text-lg font-semibold tracking-tight text-blue-600">CAT</span>
            <span className="truncate text-xs font-medium text-slate-500">
              Content Analysis Toolkit
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/cases"
              className="rounded-none border border-transparent px-3 py-2 font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Cases
            </Link>
            <Link
              href="/run-analysis"
              className="rounded-none border border-transparent px-3 py-2 font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              New analysis
            </Link>
            <form action="/api/logout" method="post" className="inline">
              <button
                type="submit"
                className="rounded-none border border-slate-400 bg-white px-3 py-2 font-medium text-slate-800 hover:bg-slate-100"
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-full flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
