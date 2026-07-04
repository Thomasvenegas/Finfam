import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export const API = environment.apiUrl;

export interface User { id: string; email: string; name: string; onboarded: boolean; }
interface AuthResponse { token: string; user: User; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  user = signal<User | null>(null);

  constructor(private http: HttpClient, private router: Router) {
    if (this.token) {
      this.http.get<User>(`${API}/auth/me`).subscribe({
        next: u => this.user.set(u),
        error: () => this.logout()
      });
    }
  }

  get token() { return localStorage.getItem('finfam_token'); }

  private handle(res: AuthResponse) {
    localStorage.setItem('finfam_token', res.token);
    this.user.set(res.user);
    this.router.navigate([res.user.onboarded ? '/dashboard' : '/onboarding']);
  }

  async login(email: string, password: string) {
    this.handle(await firstValueFrom(this.http.post<AuthResponse>(`${API}/auth/login`, { email, password })));
  }

  async register(name: string, email: string, password: string) {
    this.handle(await firstValueFrom(this.http.post<AuthResponse>(`${API}/auth/register`, { name, email, password })));
  }

  async loginWithGoogle(credential: string) {
    this.handle(await firstValueFrom(this.http.post<AuthResponse>(`${API}/auth/google`, { credential })));
  }

  markOnboarded() {
    const u = this.user();
    if (u) this.user.set({ ...u, onboarded: true });
  }

  logout() {
    localStorage.removeItem('finfam_token');
    this.user.set(null);
    this.router.navigate(['/login']);
  }
}
