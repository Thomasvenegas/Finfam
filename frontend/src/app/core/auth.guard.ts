import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.token) return true;
  router.navigate(['/login']);
  return false;
};

export const onboardedGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const u = auth.user();
  if (u && !u.onboarded) {
    router.navigate(['/onboarding']);
    return false;
  }
  return true;
};
