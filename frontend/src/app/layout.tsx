import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Header from '@/components/Header';
import Providers from '@/components/Providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'feedzydev',
  description: 'A personal feed of DevOps blogs.',
};

const themeScript = `try{var t=localStorage.getItem('fz-theme');if(t!=='light')document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <Header />
          <main className="mx-auto max-w-5xl px-3 py-6 sm:px-4">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
