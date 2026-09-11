import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const iconBase = process.env.GITHUB_ACTIONS ? '/dispatch-schedule-beta' : '';

export const metadata: Metadata = {
  title: '調度工作台',
  manifest: `${iconBase}/manifest.webmanifest`,
  icons: {
    icon: [
      { url: `${iconBase}/favicon.ico?v=3`, type: 'image/x-icon' },
      { url: `${iconBase}/icons/smile-bike-v3-32.png`, sizes: '32x32', type: 'image/png' },
      { url: `${iconBase}/icons/smile-bike-v3-16.png`, sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: `${iconBase}/apple-touch-icon.png?v=3`, sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
