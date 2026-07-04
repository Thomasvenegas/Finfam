import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, CommonModule],
  template: `
    <nav *ngIf="auth.user()" style="background:var(--card);border-bottom:1px solid var(--line)">
      <div class="container" style="display:flex;align-items:center;gap:20px;padding-top:14px;padding-bottom:14px">
        <strong style="font-family:var(--font-display);color:var(--copper)">FinFam</strong>
        <a routerLink="/dashboard">Resumen</a>
        <a routerLink="/tarjetas">Tarjetas</a>
        <span style="flex:1"></span>
        <span class="muted">{{ auth.user()?.name }}</span>
        <button class="ghost" (click)="auth.logout()">Salir</button>
      </div>
    </nav>
    <router-outlet />
  `
})
export class AppComponent {
  constructor(public auth: AuthService) {}
}
