import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '../core/auth.service';
import { clp } from '../core/categorias';

interface Meta {
  id: string;
  name: string;
  target: number;
  saved: number;
  pct: number;
  deadline: string | null;
}

const DIA = 864e5;

/** Metas de ahorro con aportes, retiros y cuánto apartar al mes. */
@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="container">
    <h2>Metas de ahorro</h2>
    <p class="muted" style="margin-top:0">
      Aparta plata para algo concreto. Aportar no descuenta tu saldo del mes: la plata sigue
      en tu cuenta, solo la marcas como destinada a la meta.
    </p>

    <p *ngIf="error" class="error">{{ error }}</p>

    <div class="card" *ngIf="cargado && !metas.length">
      <p class="muted" style="margin:0">Todavía no tienes metas. ¿Vacaciones, un fondo de emergencia, el auto?</p>
    </div>

    <div class="grid grid-2" *ngIf="metas.length">
      <div class="card" *ngFor="let g of metas">

        <ng-container *ngIf="editando !== g.id">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
            <h3 style="margin:0">{{ g.name }}</h3>
            <strong [style.color]="g.pct >= 100 ? 'var(--green)' : 'var(--neon)'">{{ g.pct }}%</strong>
          </div>
          <p class="muted" style="margin:4px 0 8px">
            {{ g.saved | currency:'CLP':'symbol-narrow':'1.0-0' }} de {{ g.target | currency:'CLP':'symbol-narrow':'1.0-0' }}
          </p>

          <div style="height:10px;border-radius:6px;background:var(--card-hi);overflow:hidden">
            <div [style.width.%]="g.pct" [style.background]="g.pct >= 100 ? 'var(--green)' : 'var(--neon)'"
                 style="height:100%;transition:width .3s"></div>
          </div>

          <p class="muted" style="margin:8px 0 0">{{ plazo(g) }}</p>

          <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
            <input type="number" [(ngModel)]="montos[g.id]" placeholder="Monto" style="flex:1;min-width:110px">
            <button (click)="mover(g, 1)" [disabled]="!montos[g.id] || busy === g.id">Aportar</button>
            <button class="ghost" (click)="mover(g, -1)" [disabled]="!montos[g.id] || busy === g.id">Retirar</button>
          </div>

          <div style="display:flex;gap:6px;margin-top:10px;justify-content:flex-end">
            <button class="ghost" (click)="editar(g)" title="Editar" style="padding:2px 8px">✎</button>
            <button class="ghost" (click)="borrar(g)" title="Quitar" style="padding:2px 8px">✕</button>
          </div>
        </ng-container>

        <div *ngIf="editando === g.id" style="display:grid;gap:8px">
          <input [(ngModel)]="borrador.name" placeholder="Nombre">
          <input type="number" [(ngModel)]="borrador.target" placeholder="Monto objetivo">
          <label style="margin:0">Fecha límite (opcional)</label>
          <input type="date" [(ngModel)]="borrador.deadline">
          <div style="display:flex;gap:8px">
            <button (click)="guardar(g)" [disabled]="!borrador.name || !borrador.target">Guardar</button>
            <button class="ghost" (click)="editando = null">Cancelar</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Nueva meta</h3>
      <div style="display:grid;gap:8px">
        <input [(ngModel)]="nueva.name" placeholder="Nombre (ej. Vacaciones en el sur)">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="number" [(ngModel)]="nueva.target" placeholder="Monto objetivo" style="flex:1;min-width:140px">
          <input type="date" [(ngModel)]="nueva.deadline" style="flex:1;min-width:140px" title="Fecha límite (opcional)">
        </div>
        <button (click)="crear()" [disabled]="!nueva.name || !nueva.target || nueva.target <= 0">Crear meta</button>
      </div>
    </div>
  </div>
  `
})
export class GoalsComponent implements OnInit {
  metas: Meta[] = [];
  montos: Record<string, number | null> = {};
  cargado = false;
  error = '';
  busy: string | null = null;
  editando: string | null = null;
  borrador: any = {};
  nueva: { name: string; target: number | null; deadline: string } = { name: '', target: null, deadline: '' };

  constructor(private http: HttpClient) {}

  ngOnInit() { this.cargar(); }

  async cargar() {
    try {
      this.metas = await firstValueFrom(this.http.get<Meta[]>(`${API}/goals`));
      this.error = '';
    } catch {
      this.error = 'No se pudieron cargar tus metas.';
    } finally {
      this.cargado = true;
    }
  }

  /** Cuánto falta y cuánto apartar al mes para llegar a tiempo. */
  plazo(g: Meta): string {
    if (g.pct >= 100) return '¡Meta cumplida!';
    const falta = g.target - g.saved;
    if (!g.deadline) return `Te faltan ${clp(falta)}.`;

    const dias = Math.ceil((new Date(g.deadline).getTime() - Date.now()) / DIA);
    if (dias < 0) return `El plazo venció y faltan ${clp(falta)}.`;
    const meses = Math.max(1, Math.ceil(dias / 30.44));
    return `Faltan ${dias} días: aparta ${clp(Math.ceil(falta / meses))} al mes para llegar a tiempo.`;
  }

  /** Aporte (signo 1) o retiro (signo -1). */
  async mover(g: Meta, signo: 1 | -1) {
    this.busy = g.id;
    try {
      await firstValueFrom(this.http.post(`${API}/goals/${g.id}/aporte`, {
        amount: signo * Number(this.montos[g.id])
      }));
      this.montos[g.id] = null;
      this.error = '';
      await this.cargar();
    } catch (e: any) {
      // El backend rechaza retirar más de lo ahorrado: mostrar su mensaje.
      this.error = e?.error?.error || 'No se pudo registrar el movimiento.';
    } finally {
      this.busy = null;
    }
  }

  async crear() {
    try {
      await firstValueFrom(this.http.post(`${API}/goals`, {
        name: this.nueva.name,
        target: Number(this.nueva.target),
        deadline: this.nueva.deadline || null
      }));
      this.nueva = { name: '', target: null, deadline: '' };
      await this.cargar();
    } catch (e: any) {
      this.error = e?.error?.error || 'No se pudo crear la meta.';
    }
  }

  editar(g: Meta) {
    this.editando = g.id;
    this.borrador = { name: g.name, target: g.target, deadline: g.deadline ? g.deadline.slice(0, 10) : '' };
  }

  async guardar(g: Meta) {
    try {
      await firstValueFrom(this.http.patch(`${API}/goals/${g.id}`, {
        name: this.borrador.name,
        target: Number(this.borrador.target),
        deadline: this.borrador.deadline || null
      }));
      this.editando = null;
      await this.cargar();
    } catch (e: any) {
      this.error = e?.error?.error || 'No se pudo actualizar la meta.';
    }
  }

  async borrar(g: Meta) {
    try {
      await firstValueFrom(this.http.delete(`${API}/goals/${g.id}`));
      await this.cargar();
    } catch (e: any) {
      this.error = e?.error?.error || 'No se pudo quitar la meta.';
    }
  }
}
