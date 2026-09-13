import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

// Aquí un 401 significa "credenciales incorrectas", no "sesión vencida".
const SIN_SESION = ['/auth/login', '/auth/register', '/auth/google'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('finfam_token');
  if (token && req.url.includes('/api/')) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      // El token vence en el servidor tras un rato sin uso. En vez de dejar la
      // app a medio andar llena de errores, se vuelve al login avisando.
      // Recarga completa y no AuthService.logout(): inyectar AuthService aquí
      // arma un ciclo, porque AuthService usa HttpClient en su constructor.
      if (err.status === 401 && token && req.url.includes('/api/') && !SIN_SESION.some(p => req.url.includes(p))) {
        localStorage.removeItem('finfam_token');
        localStorage.removeItem('finfam_actividad');
        location.assign('/login?motivo=expirada');
      }
      return throwError(() => err);
    })
  );
};
