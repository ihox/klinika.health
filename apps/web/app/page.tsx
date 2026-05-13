import { redirect } from 'next/navigation';

export default function HomePage() {
  // The frontend root is a thin redirect to `/login` — actual role
  // routing happens after auth (login form sets the correct home).
  redirect('/login');
}
