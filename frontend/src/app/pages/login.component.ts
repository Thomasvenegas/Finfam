import { Component, AfterViewInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { environment } from '../../environments/environment';

declare const google: any;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div style="min-height:100vh;display:grid;place-items:center">
    <div class="card" style="width:min(420px,92vw)">
      <h1 style="color:var(--copper)">FinFam</h1>
      <p class="muted">Tu mes, de un vistazo. Ingresos, gastos y saldo en tiempo real.</p>

      <div style="display:flex;gap:8px;margin:16px 0">
        <button class="ghost" [style.borderColor]="mode==='login' ? 'var(--copper)' : ''" (click)="mode='login'">Iniciar sesión</button>
        <button class="ghost" [style.borderColor]="mode==='register' ? 'var(--copper)' : ''" (click)="mode='register'">Crear cuenta</button>
      </div>

      <div *ngIf="mode==='register'">
        <label>Nombre</label>
        <input [(ngModel)]="name" placeholder="María Pérez">
      </div>
      <label>Correo</label>
      <input [(ngModel)]="email" type="email" placeholder="tu@correo.cl">
      <label>Contraseña</label>
      <input [(ngModel)]="password" type="password" placeholder="Mínimo 8 caracteres">

      <button style="width:100%;margin-top:16px" [disabled]="busy" (click)="submit()">
        {{ mode==='login' ? 'Entrar' : 'Crear cuenta' }}
      </button>
      <p class="error" *ngIf="error">{{ error }}</p>

      <div style="display:flex;align-items:center;gap:10px;margin:18px 0">
        <hr style="flex:1;border:none;border-top:1px solid var(--line)"> <span class="muted">o</span>
        <hr style="flex:1;border:none;border-top:1px solid var(--line)">
      </div>
      <!-- Botón oficial de Google Identity Services -->
      <div id="googleBtn" style="display:flex;justify-content:center"></div>
    </div>
  </div>
  `
})
export class LoginComponent implements AfterViewInit {
  mode: 'login' | 'register' = 'login';
  name = ''; email = ''; password = '';
  error = ''; busy = false;

  // Reemplaza con tu Client ID de Google Cloud Console
  readonly GOOGLE_CLIENT_ID = environment.googleClientId;

  constructor(private auth: AuthService, private zone: NgZone) {}

  ngAfterViewInit() {
    const init = () => {
      if (typeof google === 'undefined') return setTimeout(init, 300);
      google.accounts.id.initialize({
        client_id: this.GOOGLE_CLIENT_ID,
        callback: (res: any) => this.zone.run(() => this.auth.loginWithGoogle(res.credential)
          .catch(() => this.error = 'No se pudo iniciar sesión con Google'))
      });
      google.accounts.id.renderButton(document.getElementById('googleBtn'), {
        theme: 'outline', size: 'large', text: 'continue_with', locale: 'es'
      });
    };
    init();
  }

  async submit() {
    this.error = ''; this.busy = true;
    try {
      if (this.mode === 'login') await this.auth.login(this.email, this.password);
      else await this.auth.register(this.name, this.email, this.password);
    } catch (e: any) {
      this.error = e?.error?.error || 'Revisa tus datos e intenta de nuevo';
    } finally { this.busy = false; }
  }
}
