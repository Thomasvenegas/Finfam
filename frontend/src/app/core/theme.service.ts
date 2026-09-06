import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export interface Tema {
  id: string;
  nombre: string;
  muestra: string[]; // colores para el botón de vista previa
}

export const TEMAS: Tema[] = [
  { id: 'cyberpunk', nombre: 'Cyberpunk', muestra: ['#0b0b16', '#ff2e97', '#00e5ff'] },
  { id: 'noche',     nombre: 'Noche',     muestra: ['#10141c', '#7c8cf8', '#4c9ffe'] },
  { id: 'bosque',    nombre: 'Bosque',    muestra: ['#0e1512', '#e0a04a', '#58d68d'] },
  { id: 'claro',     nombre: 'Claro',     muestra: ['#f4f6fa', '#d33b86', '#0f7fd4'] }
];

const CLAVE_TEMA = 'finfam_tema';
const CLAVE_ACENTO = 'finfam_acento';

/**
 * Apariencia de la app. Los temas son bloques de variables CSS en styles.css;
 * cambiar de tema es cambiar un atributo en <html>.
 *
 * La preferencia vive en localStorage, o sea que es por dispositivo: si la
 * app se usa en el teléfono y en el escritorio, cada uno guarda la suya.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly temas = TEMAS;
  temaActual = signal<string>('cyberpunk');
  acento = signal<string | null>(null);

  /** Avisa a quien pinte con estos colores por fuera del CSS (los gráficos). */
  cambios$ = new Subject<void>();

  constructor() {
    this.aplicar(
      localStorage.getItem(CLAVE_TEMA) || 'cyberpunk',
      localStorage.getItem(CLAVE_ACENTO)
    );
  }

  aplicar(tema: string, acento: string | null) {
    const raiz = document.documentElement;
    raiz.dataset['theme'] = tema;

    // El acento personalizado pisa la variable del tema; se aplica en línea
    // sobre <html> para ganarle a cualquier hoja de estilos.
    if (acento) {
      raiz.style.setProperty('--neon', acento);
      raiz.style.setProperty('--neon-dark', acento);
    } else {
      raiz.style.removeProperty('--neon');
      raiz.style.removeProperty('--neon-dark');
    }

    this.temaActual.set(tema);
    this.acento.set(acento);
    localStorage.setItem(CLAVE_TEMA, tema);
    acento ? localStorage.setItem(CLAVE_ACENTO, acento) : localStorage.removeItem(CLAVE_ACENTO);

    this.sincronizarBarraDelSistema();
    this.cambios$.next();
  }

  elegirTema(tema: string) { this.aplicar(tema, this.acento()); }
  elegirAcento(acento: string | null) { this.aplicar(this.temaActual(), acento); }

  /** Color de una variable del tema, para pintar los gráficos. */
  color(nombre: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  }

  /** Instalada como PWA, la barra de estado toma este color. */
  private sincronizarBarraDelSistema() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', this.color('--bg'));
  }
}
