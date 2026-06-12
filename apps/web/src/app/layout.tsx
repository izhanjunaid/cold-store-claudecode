import type { Metadata } from 'next';
import { Inter, Noto_Nastaliq_Urdu } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const nastaliq = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400', '700'],
  variable: '--font-urdu',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ColdChain — Cold Storage Management',
  description: 'Agricultural cold storage management platform for mandi supply chain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${nastaliq.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
