import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme";
import { Providers } from "@/components/providers";
import { ResizeObserverFix } from "@/components/ResizeObserverFix";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "MCP Portal - The Ultimate Model Context Protocol Hub",
    template: "%s | MCP Portal"
  },
  description: "Aggregate tools from multiple MCP servers into a unified portal with dynamic discovery, visual management, and cross-platform Docker support.",
  keywords: ["MCP", "Model Context Protocol", "AI Tools", "Portal", "Dashboard", "Agent Management"],
  authors: [{ name: "MCP Portal Team" }],
  creator: "MCP Portal",
  publisher: "MCP Portal",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://mcpportal.dev"),
  openGraph: {
    title: "MCP Portal - The Ultimate Model Context Protocol Hub",
    description: "Aggregate and manage MCP servers with a beautiful, intuitive dashboard featuring React Flow visualizations and real-time monitoring.",
    type: "website",
    siteName: "MCP Portal",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "MCP Portal Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MCP Portal - The Ultimate Model Context Protocol Hub",
    description: "Aggregate and manage MCP servers with a beautiful, intuitive dashboard.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // Add verification IDs as needed
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={`${inter.variable} font-sans antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          defaultTheme="dark"
          enableSystem={true}
        >
          <Providers>
            <ResizeObserverFix />
            {children}
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
