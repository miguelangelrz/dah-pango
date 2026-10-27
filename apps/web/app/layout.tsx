import type { Metadata, Viewport } from 'next';
import { Anton, Inter } from 'next/font/google';
import './globals.css';

const anton = Anton({ weight: '400', subsets: ['latin'], variable: '--font-anton' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Dah Pango',
  description: 'Centro Artístico y Cultural Dah Pango. Hip hop, house, dancehall y acrobacia en Bogotá.',
};

export const viewport: Viewport = {
  themeColor: '#0e0e0e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${anton.variable} ${inter.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
