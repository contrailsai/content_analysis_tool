import Link from "next/link";

export default function CaseNotFound() {
  return (
    <div className="rounded-none border border-slate-200 bg-white p-10 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">We could not find that case</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        The link may be out of date, or the case may have been removed.
      </p>
      <Link
        href="/cases"
        className="mt-6 inline-block rounded-none border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Return to cases
      </Link>
    </div>
  );
}
