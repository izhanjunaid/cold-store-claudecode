import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
