import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API, AuthService } from '../core/auth.service';
import { CATEGORIAS } from '../core/categorias';

interface Item { label: string; amount: number | null; category?: string; }

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="container" style="max-width:640px">
    <p class="muted">Paso {{ step }} de 4</p>
    <div style="height:6px;background:var(--line);border-radius:3px;margin-bottom:24px">
      <div [style.width.%]="step*25" style="height:6px;background:var(--neon);border-radius:3px;transition:width .3s"></div>
    </div>

    <!-- Paso 1: hogar -->
    <div class="card" *ngIf="step===1">
      <h2>¿Para quién es este presupuesto?</h2>
      <div style="display:flex;gap:12px;margin:16px 0">
        <button class="ghost" [style.borderColor]="householdType==='individual' ? 'var(--neon)' : ''" (click)="householdType='individual'">Solo para mí</button>
        <button class="ghost" [style.borderColor]="householdType==='familia' ? 'var(--neon)' : ''" (click)="householdType='familia'">Mi familia</button>
      </div>
      <label>¿Cuántos hijos tienes?</label>
      <input type="number" min="0" [(ngModel)]="childrenCount">
    </div>

    <!-- Paso 2: ingresos -->
    <div class="card" *ngIf="step===2">
      <h2>Tus ingresos mensuales</h2>
      <label>Sueldo líquido (CLP)</label>
      <input type="number" [(ngModel)]="monthlySalary" placeholder="1.200.000">
      <h3 style="margin-top:20px;font-size:15px">Otros ingresos (arriendos, pensión, freelance...)</h3>
      <div *ngFor="let i of extraIncomes; let idx = index" style="display:flex;gap:8px;margin-bottom:8px">
        <input [(ngModel)]="i.label" placeholder="Arriendo depto">
        <input type="number" [(ngModel)]="i.amount" placeholder="Monto" style="max-width:160px">
        <button class="ghost" (click)="extraIncomes.splice(idx,1)">✕</button>
      </div>
      <button class="ghost" (click)="extraIncomes.push({label:'',amount:null})">+ Agregar ingreso</button>
    </div>

    <!-- Paso 3: gastos fijos -->
    <div class="card" *ngIf="step===3">
      <h2>Gastos fijos del mes</h2>
      <p class="muted">Dividendo o arriendo, colegio, cuentas, seguros: lo que se paga sí o sí.</p>
      <div *ngFor="let f of fixedExpenses; let idx = index" style="display:flex;gap:8px;margin-bottom:8px">
        <input [(ngModel)]="f.label" placeholder="Dividendo hipotecario">
        <input type="number" [(ngModel)]="f.amount" placeholder="Monto" style="max-width:140px">
        <!-- La misma lista que el resto de la app. La propia tenía "educacion"
             sin tilde, distinta de "educación": esos gastos quedaban fuera de
             filtros y presupuestos, y al editarlos cambiaban de categoría. -->
        <select [(ngModel)]="f.category" style="max-width:150px">
          <option *ngFor="let c of categorias" [value]="c">{{ c }}</option>
        </select>
        <button class="ghost" (click)="fixedExpenses.splice(idx,1)">✕</button>
      </div>
      <button class="ghost" (click)="fixedExpenses.push({label:'',amount:null,category:'otros'})">+ Agregar gasto fijo</button>
    </div>

    <!-- Paso 4: resumen -->
    <div class="card" *ngIf="step===4">
      <h2>Listo. Así parte tu mes:</h2>
      <p>Ingresos: <strong>{{ totalIncome | currency:'CLP':'symbol-narrow':'1.0-0' }}</strong></p>
      <p>Gastos fijos: <strong>{{ totalFixed | currency:'CLP':'symbol-narrow':'1.0-0' }}</strong></p>
      <p>Disponible para el mes:
        <span class="saldo" [class.ok]="totalIncome-totalFixed>=0" [class.bad]="totalIncome-totalFixed<0">
          {{ totalIncome - totalFixed | currency:'CLP':'symbol-narrow':'1.0-0' }}
        </span>
      </p>
      <p class="muted">Después podrás conectar tu Banco de Chile para que los gastos se descuenten solos.</p>
    </div>

    <div style="display:flex;justify-content:space-between;margin-top:20px">
      <button class="ghost" *ngIf="step>1" (click)="step = step - 1">Atrás</button>
      <span></span>
      <button *ngIf="step<4" [disabled]="!canNext" (click)="step = step + 1">Continuar</button>
      <button *ngIf="step===4" [disabled]="busy" (click)="finish()">Ir a mi resumen</button>
    </div>
    <p class="error" *ngIf="error">{{ error }}</p>
  </div>
  `
})
export class OnboardingComponent {
  step = 1;
  householdType: 'individual' | 'familia' = 'individual';
  childrenCount = 0;
  monthlySalary: number | null = null;
  extraIncomes: Item[] = [];
  fixedExpenses: Item[] = [{ label: '', amount: null, category: 'vivienda' }];
  categorias = CATEGORIAS;
  busy = false; error = '';

  constructor(private http: HttpClient, private router: Router, private auth: AuthService) {}

  get canNext() { return this.step !== 2 || (this.monthlySalary ?? 0) > 0; }
  get totalIncome() {
    return (this.monthlySalary ?? 0) + this.extraIncomes.reduce((s, i) => s + (i.amount ?? 0), 0);
  }
  get totalFixed() { return this.fixedExpenses.reduce((s, f) => s + (f.amount ?? 0), 0); }

  async finish() {
    this.busy = true; this.error = '';
    try {
      await firstValueFrom(this.http.post(`${API}/onboarding`, {
        householdType: this.householdType,
        childrenCount: Number(this.childrenCount) || 0,
        monthlySalary: this.monthlySalary,
        extraIncomes: this.extraIncomes.filter(i => i.label && i.amount),
        fixedExpenses: this.fixedExpenses.filter(f => f.label && f.amount)
      }));
      this.auth.markOnboarded();
      this.router.navigate(['/dashboard']);
    } catch {
      this.error = 'No pudimos guardar tus datos. Intenta de nuevo.';
    } finally { this.busy = false; }
  }
}
