import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { CLAVE_ACTIVIDAD, INACTIVIDAD_MS } from './session.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.token) return router.createUrlTree(['/login']);

  // Al abrir la app después de un rato: si ya pasaron 20 minutos sin actividad,
  // la sesión se cierra aquí, antes de que la página alcance a mostrar un dato.
  const ultima = Number(localStorage.getItem(CLAVE_ACTIVIDAD));
  if (ultima && Date.now() - ultima >= INACTIVIDAD_MS) {
    auth.cerrarSesionLocal();
    return router.createUrlTree(['/login'], { queryParams: { motivo: 'inactividad' } });
  }
  return true;
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
