import type { Metadata } from 'next';
import { ProfilePage } from './profile-page';

export const metadata: Metadata = {
  title: 'Profili im · Klinika',
  description: 'Profili im',
};

export default function ProfileRoute() {
  return <ProfilePage />;
}
