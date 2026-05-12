import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

const catDescription =
  "CAT (Content Analysis Toolkit) — in-depth technical analysis on images, video, and other media: logos, on-screen text, and rich file metadata.";

export const metadata = {
  applicationName: "CAT",
  title: {
    default: "CAT — Content Analysis Toolkit",
    template: "%s | CAT",
  },
  description: catDescription,
  openGraph: {
    title: "CAT — Content Analysis Toolkit",
    description: catDescription,
    siteName: "CAT",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "CAT — Content Analysis Toolkit",
    description: catDescription,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
