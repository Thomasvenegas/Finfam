import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { API } from '../core/auth.service';
import { SocketService } from '../core/socket.service';

declare const Fintoc: any;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
  template: `
  <div class="container" *ngIf="s">

    <!-- Firma: saldo disponible en vivo -->
    <div class="card" style="text-align:center;padding:32px">
      <p class="muted" style="margin:0">Disponible este mes ({{ s.month }})</p>
      <div class="saldo" [class.ok]="!s.overspent" [class.bad]="s.overspent">
        {{ s.available | currency:'CLP':'symbol-narrow':'1.0-0' }}
      </div>
      <p *ngIf="s.overspent" class="error">Has gastado más de lo que ganas este mes.</p>
      <p class="muted">
        Ingresos {{ s.totalIncome | currency:'CLP':'symbol-narrow':'1.0-0' }} ·
        Fijos {{ s.totalFixed | currency:'CLP':'symbol-narrow':'1.0-0' }} ·
        Variables {{ s.totalVariable | currency:'CLP':'symbol-narrow':'1.0-0' }}
      </p>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px">
      <div class="card">
        <h3>Gasto acumulado vs ingreso</h3>
        <canvas baseChart type="line" [data]="lineData" [options]="lineOpts"></canvas>
      </div>
      <div class="card">
        <h3>¿En qué se va la plata?</h3>
        <canvas baseChart type="doughnut" [data]="donutData"></canvas>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px">
      <!-- Alta rápida de gastos -->
      <div class="card">
        <h3>Registrar un gasto</h3>
        <label>Descripción</label>
        <input [(ngModel)]="newDesc" placeholder="Supermercado Líder">
        <label>Monto (CLP)</label>
        <input type="number" [(ngModel)]="newAmount" placeholder="45.000">
        <label>Categoría</label>
        <select [(ngModel)]="newCategory">
          <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
        </select>
        <button style="margin-top:14px;width:100%" [disabled]="!newDesc || !newAmount" (click)="addExpense()">
          Descontar del saldo
        </button>
      </div>

      <!-- Últimos movimientos + banco -->
      <div class="card">
        <h3>Últimos movimientos</h3>
        <div *ngIf="!s.lastExpenses.length" class="muted">
          Aún no hay gastos este mes. Registra uno o conecta tu banco.
        </div>
        <div *ngFor="let e of s.lastExpenses" style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)">
          <span>{{ e.description }} <span class="muted">· {{ e.category }} · {{ e.source }}</span></span>
          <strong>-{{ e.amount | currency:'CLP':'symbol-narrow':'1.0-0' }}</strong>
        </div>
        <button class="ghost" style="margin-top:14px" (click)="connectBank()">
          Conectar Banco de Chile (y otros)
        </button>
        <p class="muted">Vía Fintoc: tus movimientos llegan solos y el saldo baja al instante.</p>
      </div>
    </div>
  </div>
  `
})
export class DashboardComponent implements OnInit, OnDestroy {
  s: any = null;
  newDesc = ''; newAmount: number | null = null; newCategory = 'supermercado';
  categories = ['supermercado', 'comida', 'transporte', 'salud', 'cuentas', 'ocio', 'otros'];
  private sub?: Subscription;

  lineData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  lineOpts: ChartConfiguration<'line'>['options'] = {
    plugins: { legend: { display: true } },
    scales: { y: { beginAtZero: true } }
  };
  donutData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };

  constructor(private http: HttpClient, private socket: SocketService) {}

  ngOnInit() {
    this.load();
    this.socket.connect();
    // Tiempo real: gasto nuevo (manual, webhook Fintoc o correo) => refrescar
    this.sub = this.socket.expenseCreated$.subscribe(() => this.load());
  }
  ngOnDestroy() { this.sub?.unsubscribe(); }

  async load() {
    this.s = await firstValueFrom(this.http.get<any>(`${API}/dashboard/summary`));
    const days = this.s.cumulative.map((_: number, i: number) => i + 1);
    this.lineData = {
      labels: days,
      datasets: [
        { label: 'Gasto acumulado', data: this.s.cumulative, borderColor: '#b4653f', backgroundColor: 'rgba(180,101,63,.12)', fill: true, tension: .25, pointRadius: 0 },
        { label: 'Ingreso del mes', data: days.map(() => this.s.incomeLine), borderColor: '#1f6f50', borderDash: [6, 6], pointRadius: 0 }
      ]
    };
    this.donutData = {
      labels: Object.keys(this.s.byCategory),
      datasets: [{
        data: Object.values(this.s.byCategory) as number[],
        backgroundColor: ['#b4653f', '#1f6f50', '#5b6675', '#d8a47f', '#8fb3a3', '#b03a34', '#1b2431']
      }]
    };
  }

  async addExpense() {
    await firstValueFrom(this.http.post(`${API}/expenses`, {
      description: this.newDesc,
      amount: this.newAmount,
      category: this.newCategory
    }));
    this.newDesc = ''; this.newAmount = null;
    // el socket dispara load(), pero refrescamos por si acaso
    this.load();
  }

  /** Abre el widget de Fintoc: el usuario elige Banco de Chile (u otro) y
   *  entrega sus credenciales directamente a Fintoc, nunca a nuestra app. */
  connectBank() {
    if (typeof Fintoc === 'undefined') {
      alert('El widget de Fintoc aún no carga. Revisa tu conexión.');
      return;
    }
    const widget = Fintoc.create({
      publicKey: 'pk_test_TU_LLAVE_PUBLICA', // reemplaza con tu llave de fintoc.com
      holderType: 'individual',
      product: 'movements',
      country: 'cl',
      onSuccess: async (link: any) => {
        await firstValueFrom(this.http.post(`${API}/bank/link`, {
          linkToken: link.token ?? link.id,
          institution: link.institution?.id ?? 'cl_banco_de_chile'
        }));
        this.load();
      }
    });
    widget.open();
  }
}
