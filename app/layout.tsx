import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Smore Ops — 재고원장',
  description: '스모어 재고 운영 시스템',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
