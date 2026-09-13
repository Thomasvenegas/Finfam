import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/auth.service';
import { SessionService } from './core/session.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, CommonModule],
  template: `
    <nav *ngIf="auth.user()" style="background:var(--card);border-bottom:1px solid var(--line)">
      <div class="container nav-bar" style="display:flex;align-items:center;gap:20px;padding-top:14px;padding-bottom:14px">
        <strong style="font-family:var(--font-display);color:var(--magenta)">FinFam</strong>
        <a routerLink="/dashboard">Resumen</a>
        <a routerLink="/tarjetas">Tarjetas</a>
        <a routerLink="/presupuestos">Presupuestos</a>
        <a routerLink="/metas">Metas</a>
        <span style="flex:1"></span>
        <span class="muted nav-user">{{ auth.user()?.name }}</span>
        <button class="ghost" (click)="auth.logout()">Salir</button>
      </div>
    </nav>
    <!-- Instalada como app, el service worker sirve la versión guardada:
         sin este aviso el usuario se queda en una versión vieja por días. -->
    <div *ngIf="hayVersionNueva"
         style="background:var(--magenta);color:var(--bg-deep);padding:8px 20px;display:flex;
                align-items:center;justify-content:center;gap:12px;font-weight:600">
      Hay una versión nueva de FinFam
      <button (click)="actualizar()" style="background:var(--bg-deep);color:var(--ink);padding:4px 12px">
        Actualizar
      </button>
    </div>
    <!-- Aviso de cierre por inactividad durante el último minuto -->
    <div *ngIf="sesion.aviso() !== null" role="alert"
         style="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:50;max-width:92vw;
                background:var(--card);border:1px solid var(--yellow);border-radius:12px;padding:12px 16px;
                display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 8px 24px rgba(0,0,0,.4)">
      <span>Por inactividad, tu sesión se cerrará en <strong>{{ sesion.aviso() }} s</strong>.</span>
      <button (click)="sesion.seguirConectado()">Seguir conectado</button>
    </div>
    <router-outlet />
  `
})
export class AppComponent {
  hayVersionNueva = false;

  constructor(public auth: AuthService, public sesion: SessionService, private updates: SwUpdate) {
    if (this.updates.isEnabled) {
      this.updates.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => (this.hayVersionNueva = true));
    }
  }

  async actualizar() {
    await this.updates.activateUpdate();
    location.reload();
  }
}
