import { Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API, AuthService } from './auth.service';

export const CLAVE_ACTIVIDAD = 'finfam_actividad';

export const INACTIVIDAD_MS = 20 * 60 * 1000;   // la sesión se cierra tras 20 min sin actividad
const AVISO_MS = 60 * 1000;              // se avisa durante el último minuto
const RENOVAR_CADA_MS = 2 * 60 * 1000;   // el token se renueva como mucho cada 2 min activos
const REVISAR_CADA_MS = 1000;
const EVENTOS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'];

/**
 * Cierra la sesión tras 20 minutos sin actividad.
 *
 * Se calcula con una marca de tiempo guardada en localStorage, no con un
 * contador regresivo: el navegador congela los timers de las pestañas en
 * segundo plano y de la PWA con el teléfono bloqueado, así que un contador se
 * detendría justo cuando importa. Al volver se compara la hora y listo.
 *
 * La marca es compartida entre pestañas: actividad en una mantiene vivas las
 * demás, y cerrar sesión en una la cierra en todas.
 *
 * Esto es la capa de la app. El servidor emite tokens de vida corta que se
 * renuevan mientras hay actividad, así que un token copiado tampoco sirve
 * después de un rato sin uso.
 */
@Injectable({ providedIn: 'root' })
export class SessionService implements OnDestroy {
  /** Segundos que quedan antes del cierre, o null si no hay que avisar. */
  aviso = signal<number | null>(null);

  private ultimaEscritura = 0;
  private ultimaRenovacion = Date.now();
  private intervalo?: ReturnType<typeof setInterval>;

  private readonly onActividad = () => this.registrarActividad();
  private readonly onVisible = () => { if (!document.hidden) this.revisar(); };
  private readonly onStorage = (e: StorageEvent) => {
    // Otra pestaña cerró la sesión: esta también.
    if (e.key === 'finfam_token' && !e.newValue && this.auth.user()) {
      this.zone.run(() => this.auth.logout());
    }
  };

  constructor(private auth: AuthService, private http: HttpClient, private zone: NgZone) {
    // Fuera de la zona de Angular: un mousemove no debe disparar detección de
    // cambios en toda la app. Solo se entra a la zona cuando cambia algo visible.
    this.zone.runOutsideAngular(() => {
      EVENTOS.forEach(e => window.addEventListener(e, this.onActividad, { passive: true }));
      document.addEventListener('visibilitychange', this.onVisible);
      window.addEventListener('storage', this.onStorage);
      this.intervalo = setInterval(() => this.revisar(), REVISAR_CADA_MS);
    });
    // El chequeo al abrir la app lo hace authGuard, antes de mostrar un dato.
  }

  ngOnDestroy() {
    EVENTOS.forEach(e => window.removeEventListener(e, this.onActividad));
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('storage', this.onStorage);
    clearInterval(this.intervalo);
  }

  /** El usuario hizo algo: la sesión sigue viva. */
  registrarActividad() {
    if (!this.auth.token) return;
    const ahora = Date.now();
    // Escribir en localStorage en cada mousemove sería ruido: basta cada 5 s.
    if (ahora - this.ultimaEscritura > 5000) {
      localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora));
      this.ultimaEscritura = ahora;
    }
    if (this.aviso() !== null) this.zone.run(() => this.aviso.set(null));
    if (ahora - this.ultimaRenovacion > RENOVAR_CADA_MS) this.renovar();
  }

  /** Botón "Seguir conectado" del aviso. */
  seguirConectado() {
    this.ultimaEscritura = 0;
    this.registrarActividad();
    this.renovar();
  }

  private revisar() {
    if (!this.auth.token) {
      if (this.aviso() !== null) this.zone.run(() => this.aviso.set(null));
      return;
    }
    const guardada = Number(localStorage.getItem(CLAVE_ACTIVIDAD));
    if (!guardada) {
      // Sesión iniciada antes de existir esta función: parte desde ahora.
      localStorage.setItem(CLAVE_ACTIVIDAD, String(Date.now()));
      return;
    }
    const inactivo = Date.now() - guardada;
    if (inactivo >= INACTIVIDAD_MS) {
      this.zone.run(() => {
        this.aviso.set(null);
        this.auth.logout('inactividad');
      });
    } else if (inactivo >= INACTIVIDAD_MS - AVISO_MS) {
      const quedan = Math.ceil((INACTIVIDAD_MS - inactivo) / 1000);
      if (this.aviso() !== quedan) this.zone.run(() => this.aviso.set(quedan));
    } else if (this.aviso() !== null) {
      // Hubo actividad en otra pestaña: se retira el aviso también aquí.
      this.zone.run(() => this.aviso.set(null));
    }
  }

  /** Pide un token nuevo mientras hay actividad (vida corta del lado servidor). */
  private async renovar() {
    this.ultimaRenovacion = Date.now();
    try {
      const r = await firstValueFrom(this.http.post<{ token: string }>(`${API}/auth/refresh`, {}));
      if (this.auth.token) localStorage.setItem('finfam_token', r.token);
    } catch {
      // Si el token ya venció, el interceptor se encarga de cerrar la sesión.
    }
  }
}
