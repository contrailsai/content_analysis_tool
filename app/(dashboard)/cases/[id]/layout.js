import { IBM_Plex_Mono } from "next/font/google";

const caseMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--case-mono",
});

/** Case detail inherits root Inter; mono for timecodes and tabular data only. */
export default function CaseDetailLayout({ children }) {
  return (
    <div className={`${caseMono.variable} mx-auto w-full max-w-[1920px] text-slate-900 antialiased`}>
      {children}
    </div>
  );
}
