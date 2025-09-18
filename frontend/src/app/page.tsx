import { redirect } from 'next/navigation'

export default function Home() {
  // Redirect root to the new Dashboard to avoid the old portal icon and marketing layout
  redirect('/dashboard')
}
