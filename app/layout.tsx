import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { I18nProvider } from '@/app/lib/i18n'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Extender — AI Image Outpainting',
  description:
    'Extend any image in any direction with AI. Click an edge, type intent, done.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  )
}
