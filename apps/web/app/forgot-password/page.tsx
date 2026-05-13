import type { Metadata } from 'next';
import { ForgotPasswordForm } from './forgot-form';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata: Metadata = {
  title: 'Harruat fjalëkalimin · Klinika',
  description: 'Rivendos fjalëkalimin',
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Harruat fjalëkalimin?"
      subtitle="Shkruani email-in tuaj — do ju dërgojmë një lidhje për ta rivendosur."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
