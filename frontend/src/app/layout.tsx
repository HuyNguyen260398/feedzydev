import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import BackToTop from '@/components/BackToTop';
import Header from '@/components/Header';
import Providers from '@/components/Providers';
import ServiceWorker from '@/components/ServiceWorker';
import SplashScreen from '@/components/SplashScreen';
import { THEME_COLORS } from '@/lib/themeColors';
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
  applicationName: 'feedzydev',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'feedzydev', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icon.svg', apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Dark is the default theme; ThemeProvider keeps this in sync when it changes.
  themeColor: THEME_COLORS.dark,
};

const themeScript = `try{var t=localStorage.getItem('fz-theme');if(t!=='light')document.documentElement.classList.add('dark')}catch(e){document.documentElement.classList.add('dark')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SplashScreen />
        <noscript>
          <style>{'.fz-splash{display:none}'}</style>
        </noscript>
        <Providers>
          <Header />
          <main className="mx-auto max-w-5xl px-3 py-6 sm:px-4">{children}</main>
          <BackToTop />
        </Providers>
        <ServiceWorker />
      </body>
    </html>
  );
}
