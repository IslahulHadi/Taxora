import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Taxora — Indonesian Tax Operating System',
  description:
    'B2B SaaS untuk otomasi kepatuhan pajak Indonesia (PPN, PPh 21 TER, PPh 23). ' +
    'Sistem akuntansi yang berbicara langsung ke Coretax DJP.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="font-sans">{children}</body>
    </html>
  );
}
