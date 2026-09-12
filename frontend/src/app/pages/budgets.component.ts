import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '../core/auth.service';
import { CATEGORIAS, clp } from '../core/categorias';

interface Avance {
  id: string;
  category: string;
  spent: number;
  limit: number;
  remaining: number;
  pct: number;
  level: 'ok' | 'alerta' | 'excedido';
}

/** Topes mensuales de gasto variable por categoría, con su avance del mes. */
@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="container">
    <h2>Presupuestos</h2>
    <p class="muted" style="margin-top:0">
      Un tope mensual de gasto por categoría. Te avisamos al llegar al 80% y cuando te pasas.
      Los gastos fijos no cuentan aquí: esos ya están comprometidos desde el día 1.
    </p>

    <p *ngIf="error" class="error">{{ error }}</p>

    <div class="card" *ngIf="cargado && !avances.length">
      <p class="muted" style="margin:0">
        Todavía no defines presupuestos. Parte por la categoría donde más gastas.
      </p>
    </div>

    <div class="card" *ngIf="avances.length" style="display:grid;gap:20px">
      <div *ngFor="let b of avances">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
          <strong style="text-transform:capitalize">{{ b.category }}</strong>
          <span class="muted">
            {{ b.spent | currency:'CLP':'symbol-narrow':'1.0-0' }} de {{ b.limit | currency:'CLP':'symbol-narrow':'1.0-0' }}
          </span>
        </div>

        <div style="height:10px;border-radius:6px;background:var(--card-hi);overflow:hidden;margin:6px 0">
          <div [style.width.%]="minimo(b.pct, 100)" [style.background]="color(b.level)"
               style="height:100%;transition:width .3s"></div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span [style.color]="color(b.level)" style="font-size:13px;font-weight:600">{{ mensaje(b) }}</span>

          <span *ngIf="editando !== b.id" style="display:flex;gap:6px">
            <button class="ghost" (click)="editar(b)" title="Cambiar el tope" style="padding:2px 8px">✎</button>
            <button class="ghost" (click)="borrar(b)" title="Quitar" style="padding:2px 8px">✕</button>
          </span>
          <span *ngIf="editando === b.id" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <input type="number" [(ngModel)]="nuevoTope" style="width:130px">
            <button (click)="guardar(b)" [disabled]="!nuevoTope || nuevoTope <= 0">Guardar</button>
            <button class="ghost" (click)="editando = null">Cancelar</button>
          </span>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px" *ngIf="cargado && sinPresupuesto.length">
      <h3>Agregar presupuesto</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:160px">
          <label>Categoría</label>
          <select [(ngModel)]="nueva.category">
            <option *ngFor="let c of sinPresupuesto" [value]="c">{{ etiqueta(c) }}</option>
          </select>
        </div>
        <div style="flex:1;min-width:130px">
          <label>Tope mensual (CLP)</label>
          <input type="number" [(ngModel)]="nueva.amount" placeholder="150000">
        </div>
        <button (click)="crear()" [disabled]="!nueva.category || !nueva.amount || nueva.amount <= 0">Agregar</button>
      </div>
    </div>
  </div>
  `
})
export class BudgetsComponent implements OnInit {
  avances: Avance[] = [];
  gastado: Record<string, number> = {};
  cargado = false;
  error = '';
  editando: string | null = null;
  nuevoTope: number | null = null;
  nueva: { category: string; amount: number | null } = { category: '', amount: null };

  constructor(private http: HttpClient) {}

  ngOnInit() { this.cargar(); }

  /** Solo se ofrecen categorías sin presupuesto: hay uno por categoría. */
  get sinPresupuesto(): string[] {
    const con = new Set(this.avances.map(a => a.category));
    return CATEGORIAS.filter(c => !con.has(c));
  }

  /** El resumen del mes ya trae el avance de cada presupuesto calculado. */
  async cargar() {
    try {
      const s = await firstValueFrom(this.http.get<any>(`${API}/dashboard/summary`));
      this.avances = s.budgets || [];
      this.gastado = s.byCategory || {};
      if (!this.sinPresupuesto.includes(this.nueva.category)) {
        this.nueva.category = this.sinPresupuesto[0] || '';
      }
      this.error = '';
    } catch {
      this.error = 'No se pudieron cargar tus presupuestos.';
    } finally {
      this.cargado = true;
    }
  }

  /** Al elegir categoría ayuda saber cuánto va gastado en ella este mes. */
  etiqueta(c: string) {
    const g = this.gastado[c];
    return g ? `${c} — llevas ${clp(g)} este mes` : c;
  }

  mensaje(b: Avance) {
    if (b.level === 'excedido') return `Te pasaste por ${clp(-b.remaining)}`;
    if (b.level === 'alerta') return `Ojo: vas en ${b.pct}%, quedan ${clp(b.remaining)}`;
    return `Quedan ${clp(b.remaining)}`;
  }

  color(level: Avance['level']) {
    return level === 'excedido' ? 'var(--red)' : level === 'alerta' ? 'var(--yellow)' : 'var(--green)';
  }

  minimo(a: number, b: number) { return Math.min(a, b); }

  async crear() {
    try {
      await firstValueFrom(this.http.post(`${API}/budgets`, {
        category: this.nueva.category,
        amount: Number(this.nueva.amount)
      }));
      this.nueva.amount = null;
      await this.cargar();
    } catch (e: any) {
      this.error = e?.error?.error || 'No se pudo guardar el presupuesto.';
    }
  }

  editar(b: Avance) {
    this.editando = b.id;
    this.nuevoTope = b.limit;
  }

  async guardar(b: Avance) {
    try {
      await firstValueFrom(this.http.patch(`${API}/budgets/${b.id}`, { amount: Number(this.nuevoTope) }));
      this.editando = null;
      await this.cargar();
    } catch (e: any) {
      this.error = e?.error?.error || 'No se pudo actualizar el presupuesto.';
    }
  }

  async borrar(b: Avance) {
    try {
      await firstValueFrom(this.http.delete(`${API}/budgets/${b.id}`));
      await this.cargar();
    } catch (e: any) {
      this.error = e?.error?.error || 'No se pudo quitar el presupuesto.';
    }
  }
}
