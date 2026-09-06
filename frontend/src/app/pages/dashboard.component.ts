import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartConfiguration } from 'chart.js';
import { API } from '../core/auth.service';
import { SocketService } from '../core/socket.service';

declare const Fintoc: any;

// Chart.js asume fondo claro: sin esto, ejes y leyendas quedan invisibles.
Chart.defaults.color = '#9d9bd0';
Chart.defaults.borderColor = 'rgba(122,122,255,.16)';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
  template: `
  <div class="container" *ngIf="!s && sinConexion">
    <div class="card" style="text-align:center">
      <h3>Sin conexión</h3>
      <p class="muted" style="margin:0">
        FinFam necesita internet para mostrarte el saldo del mes. Se actualizará solo al volver.
      </p>
    </div>
  </div>

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
        <div *ngIf="!movements.length" class="muted">
          Aún no hay movimientos este mes. Registra un gasto o conecta tu banco.
        </div>
        <div *ngFor="let m of movements" style="padding:6px 0;border-bottom:1px solid var(--line)">

          <!-- Lectura -->
          <div *ngIf="editandoGasto !== m.id" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
            <span style="flex:1;min-width:0">
              {{ m.description }}
              <span class="muted">· {{ m.category }} · {{ m.source }}</span>
            </span>
            <a *ngIf="mailUrl(m) as url" [href]="url" target="_blank" rel="noopener"
               class="muted" title="Abrir en Gmail el correo del que salió este movimiento"
               style="white-space:nowrap">✉ Ver correo</a>
            <strong [style.color]="m.type === 'income' ? 'var(--green)' : 'var(--red)'" style="white-space:nowrap">
              {{ m.type === 'income' ? '+' : '-' }}{{ m.amount | currency:'CLP':'symbol-narrow':'1.0-0' }}
            </strong>
            <button *ngIf="m.type === 'expense'" class="ghost" (click)="editarGasto(m)"
                    title="Corregir glosa, monto o categoría"
                    style="padding:2px 8px;line-height:1.4">✎</button>
            <button *ngIf="m.type === 'expense'" class="ghost" (click)="removeExpense(m)"
                    [disabled]="busyId === m.id" title="Quitar este gasto y devolver el monto al saldo"
                    style="padding:2px 8px;line-height:1.4">✕</button>
          </div>

          <!-- Edición -->
          <div *ngIf="editandoGasto === m.id" style="display:grid;gap:8px;padding:8px 0">
            <input [(ngModel)]="borrador.description" placeholder="Descripción">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input type="number" [(ngModel)]="borrador.amount" placeholder="Monto" style="flex:1;min-width:120px">
              <select [(ngModel)]="borrador.category" style="flex:1;min-width:140px">
                <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
              </select>
            </div>
            <div style="display:flex;gap:8px">
              <button (click)="guardarGasto(m)" [disabled]="busyId === m.id || !borrador.description || !borrador.amount">
                Guardar
              </button>
              <button class="ghost" (click)="editandoGasto = null">Cancelar</button>
            </div>
          </div>
        </div>
        <button class="ghost" style="margin-top:14px" (click)="connectBank()">
          Conectar Banco de Chile (y otros)
        </button>
        <p class="muted">Vía Fintoc: tus movimientos llegan solos y el saldo baja al instante.</p>
      </div>
    </div>

    <!-- Gastos fijos: se descuentan todos los meses, así que tienen que
         poder corregirse y no quedar congelados desde el onboarding -->
    <div class="card" style="margin-top:16px">
      <h3>Gastos fijos del mes</h3>
      <p class="muted" style="margin-top:0">
        Se descuentan de tu saldo todos los meses. Total:
        <strong>{{ s.totalFixed | currency:'CLP':'symbol-narrow':'1.0-0' }}</strong>
      </p>

      <div *ngIf="!fijos.length" class="muted">Todavía no tienes gastos fijos registrados.</div>

      <div *ngFor="let f of fijos" style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div *ngIf="editandoFijo !== f.id" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <span style="flex:1;min-width:0">
            {{ f.label }}
            <span class="muted">· {{ f.category }}<span *ngIf="f.dueDay"> · día {{ f.dueDay }}</span></span>
          </span>
          <strong style="white-space:nowrap">{{ f.amount | currency:'CLP':'symbol-narrow':'1.0-0' }}</strong>
          <button class="ghost" (click)="editarFijo(f)" title="Editar"
                  style="padding:2px 8px;line-height:1.4">✎</button>
          <button class="ghost" (click)="borrarFijo(f)" [disabled]="busyId === f.id" title="Quitar"
                  style="padding:2px 8px;line-height:1.4">✕</button>
        </div>

        <div *ngIf="editandoFijo === f.id" style="display:grid;gap:8px;padding:4px 0">
          <input [(ngModel)]="borradorFijo.label" placeholder="Nombre (ej. Dividendo)">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="number" [(ngModel)]="borradorFijo.amount" placeholder="Monto" style="flex:1;min-width:110px">
            <select [(ngModel)]="borradorFijo.category" style="flex:1;min-width:130px">
              <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
            </select>
            <input type="number" [(ngModel)]="borradorFijo.dueDay" placeholder="Día" min="1" max="31" style="width:90px">
          </div>
          <div style="display:flex;gap:8px">
            <button (click)="guardarFijo(f)" [disabled]="busyId === f.id || !borradorFijo.label || !borradorFijo.amount">
              Guardar
            </button>
            <button class="ghost" (click)="editandoFijo = null">Cancelar</button>
          </div>
        </div>
      </div>

      <div *ngIf="!agregandoFijo" style="margin-top:12px">
        <button class="ghost" (click)="nuevoFijo()">+ Agregar gasto fijo</button>
      </div>

      <div *ngIf="agregandoFijo" style="display:grid;gap:8px;margin-top:12px">
        <input [(ngModel)]="borradorFijo.label" placeholder="Nombre (ej. Dividendo)">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="number" [(ngModel)]="borradorFijo.amount" placeholder="Monto" style="flex:1;min-width:110px">
          <select [(ngModel)]="borradorFijo.category" style="flex:1;min-width:130px">
            <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
          </select>
          <input type="number" [(ngModel)]="borradorFijo.dueDay" placeholder="Día" min="1" max="31" style="width:90px">
        </div>
        <div style="display:flex;gap:8px">
          <button (click)="crearFijo()" [disabled]="!borradorFijo.label || !borradorFijo.amount">Agregar</button>
          <button class="ghost" (click)="agregandoFijo = false">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- Bandeja de confirmación: nada toca el saldo sin tu visto bueno -->
    <div class="card" style="margin-top:16px" *ngIf="pending.length">
      <h3>Por confirmar ({{ pending.length }})</h3>
      <p class="muted" style="margin-top:0">
        Detectamos esto en los correos de tu banco. No afecta tu saldo hasta que lo apruebes.
      </p>

      <div *ngFor="let p of pending"
           style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <strong>{{ p.description }}</strong>
          <div class="muted" style="font-size:13px">
            {{ p.type === 'income' ? 'Ingreso' : 'Gasto' }}
            · {{ p.category }}
            <span *ngIf="p.bank">· {{ p.bank }}</span>
            · {{ p.date | date:'shortDate' }}
          </div>
        </div>
        <strong [style.color]="p.type === 'income' ? 'var(--green)' : 'var(--red)'" style="white-space:nowrap">
          {{ p.type === 'income' ? '+' : '-' }}{{ p.amount | currency:'CLP':'symbol-narrow':'1.0-0' }}
        </strong>
        <div style="display:flex;gap:6px;align-items:center">
          <a *ngIf="mailUrl(p) as url" [href]="url" target="_blank" rel="noopener"
             class="muted" title="Abrir en Gmail el correo que originó esta propuesta"
             style="white-space:nowrap;margin-right:4px">✉ Ver correo</a>
          <button (click)="approve(p)" [disabled]="busyId === p.id">
            {{ p.type === 'income' ? 'Sumar' : 'Descontar' }}
          </button>
          <button class="ghost" (click)="reject(p)" [disabled]="busyId === p.id">Descartar</button>
        </div>
      </div>
    </div>

    <!-- Movimientos automáticos desde el correo del banco -->
    <div class="card" style="margin-top:16px">
      <h3>Conectar tu correo del banco</h3>
      <p class="muted" style="margin-top:0">
        Sirve con cualquier banco: las compras descuentan del saldo y los abonos lo suben,
        apareciendo solos en «Últimos movimientos».
      </p>

      <div *ngIf="gmailMsg" [class.error]="gmailMsg.includes('No')" class="muted">{{ gmailMsg }}</div>

      <!-- Vía principal: lectura directa de Gmail -->
      <ng-container *ngIf="gmail?.configured">
        <ng-container *ngIf="!gmail?.connected">
          <button style="margin-top:8px" (click)="connectGmail()">Conectar Gmail</button>
          <p class="muted">
            Solo se leen los correos de tu banco que lleguen a la bandeja de entrada
            <strong>a partir de ahora</strong>: no se importa tu historial. Cada
            movimiento detectado te lo mostramos para que decidas si entra o no.
          </p>
        </ng-container>

        <ng-container *ngIf="gmail?.connected">
          <p style="margin:8px 0">
            Conectado como <strong>{{ gmail.email }}</strong>
            <span class="muted" *ngIf="gmail.lastSyncAt"> · última revisión {{ gmail.lastSyncAt | date:'short' }}</span>
          </p>
          <p class="muted" *ngIf="gmail.expiresAt">
            Google corta el permiso el {{ gmail.expiresAt | date:'shortDate' }} (la app está en
            modo de prueba). Cuando pase, vuelve a conectarlo aquí.
          </p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button (click)="syncGmail()" [disabled]="syncing">
              {{ syncing ? 'Revisando…' : 'Revisar correos ahora' }}
            </button>
            <button class="ghost" (click)="disconnectGmail()">Desconectar</button>
          </div>
        </ng-container>
      </ng-container>

      <p *ngIf="gmail && !gmail.configured" class="muted">
        La conexión con Gmail aún no está configurada en el servidor.
      </p>

      <!-- Vía alternativa: reenvío, para quien no quiera dar acceso a Gmail -->
      <details *ngIf="ingest?.configured" style="margin-top:16px">
        <summary class="muted" style="cursor:pointer">
          ¿Prefieres no conectar tu Gmail? Reenvía los correos en su lugar
        </summary>
        <div style="margin-top:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <code style="flex:1;min-width:260px;background:var(--card-hi);border:1px solid var(--line);border-radius:8px;padding:10px 12px;word-break:break-all">{{ ingest?.address }}</code>
            <button class="ghost" (click)="copyIngest()">{{ copied ? '¡Copiada!' : 'Copiar' }}</button>
          </div>
          <ol class="muted" style="padding-left:18px;line-height:1.7">
            <li>Gmail → <strong>Configuración → Reenvío</strong> → añade esa dirección.</li>
            <li>Crea un filtro con el correo de tu banco en «De» y marca <strong>Reenviarlo a</strong>.</li>
          </ol>
        </div>
      </details>
    </div>
  </div>
  `
})
export class DashboardComponent implements OnInit, OnDestroy {
  s: any = null;
  ingest: { address: string; configured: boolean } | null = null;
  copied = false;
  gmail: any = null;
  gmailMsg = '';
  syncing = false;
  pending: any[] = [];
  busyId: string | null = null;
  sinConexion = false;

  // Edición en línea: se trabaja sobre un borrador para poder cancelar
  // sin haber tocado lo que se ve en pantalla.
  editandoGasto: string | null = null;
  borrador: any = {};
  fijos: any[] = [];
  editandoFijo: string | null = null;
  agregandoFijo = false;
  borradorFijo: any = {};

  /** Gastos y abonos del mes mezclados; cae a solo gastos si el backend es viejo. */
  get movements(): any[] {
    if (this.s?.lastMovements) return this.s.lastMovements;
    return (this.s?.lastExpenses || []).map((e: any) => ({ ...e, type: 'expense' }));
  }
  newDesc = ''; newAmount: number | null = null; newCategory = 'supermercado';
  categories = ['supermercado', 'comida', 'transporte', 'salud', 'cuentas', 'ocio', 'otros'];
  private sub?: Subscription;
  private incomeSub?: Subscription;
  private pendingSub?: Subscription;

  lineData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  lineOpts: ChartConfiguration<'line'>['options'] = {
    plugins: { legend: { display: true } },
    scales: { y: { beginAtZero: true } }
  };
  donutData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };

  constructor(private http: HttpClient, private socket: SocketService) {}

  ngOnInit() {
    this.load();
    this.loadIngestAddress();
    this.loadGmailStatus();
    this.loadPending();
    this.loadFijos();
    this.readGmailReturn();
    this.socket.connect();
    // Tiempo real: gasto nuevo (manual, webhook Fintoc o correo) => refrescar
    this.sub = this.socket.expenseCreated$.subscribe(() => this.load());
    // Un abono avisado por correo también mueve el saldo: refrescar igual.
    this.incomeSub = this.socket.incomeCreated$.subscribe(() => this.load());
    // Un correo recién detectado aparece en la bandeja sin recargar la página
    this.pendingSub = this.socket.pendingCreated$.subscribe(() => this.loadPending());
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.incomeSub?.unsubscribe();
    this.pendingSub?.unsubscribe();
  }

  async load() {
    try {
      this.s = await firstValueFrom(this.http.get<any>(`${API}/dashboard/summary`));
      this.sinConexion = false;
    } catch {
      // Instalada como app puede abrirse sin red: mejor decirlo que dejar la
      // pantalla en blanco esperando datos que no van a llegar. No se relanza
      // para no dejar promesas rechazadas sueltas en cada llamador.
      this.sinConexion = true;
    }
    const days = this.s.cumulative.map((_: number, i: number) => i + 1);
    this.lineData = {
      labels: days,
      datasets: [
        { label: 'Gasto acumulado', data: this.s.cumulative, borderColor: '#ff2e97', backgroundColor: 'rgba(255,46,151,.16)', fill: true, tension: .25, pointRadius: 0 },
        { label: 'Ingreso del mes', data: days.map(() => this.s.incomeLine), borderColor: '#3dffb0', borderDash: [6, 6], pointRadius: 0 }
      ]
    };
    this.donutData = {
      labels: Object.keys(this.s.byCategory),
      datasets: [{
        data: Object.values(this.s.byCategory) as number[],
        backgroundColor: ['#ff2e97', '#00e5ff', '#3dffb0', '#a45cff', '#ffd93d', '#ff8a3d', '#7a7aff'],
        borderColor: '#14142b',
        borderWidth: 2
      }]
    };
  }

  /** Dirección personal a la que el usuario reenvía los correos de su banco. */
  async loadIngestAddress() {
    try {
      this.ingest = await firstValueFrom(
        this.http.get<{ address: string; configured: boolean }>(`${API}/bank/ingest-address`)
      );
    } catch {
      this.ingest = null;
    }
  }

  // ---- Corregir un gasto ya registrado ----

  editarGasto(m: any) {
    this.editandoGasto = m.id;
    this.borrador = { description: m.description, amount: m.amount, category: m.category };
  }

  async guardarGasto(m: any) {
    this.busyId = m.id;
    try {
      await firstValueFrom(this.http.patch(`${API}/expenses/${m.id}`, {
        description: this.borrador.description,
        amount: Number(this.borrador.amount),
        category: this.borrador.category
      }));
      this.editandoGasto = null;
      await this.load();
    } finally {
      this.busyId = null;
    }
  }

  // ---- Gastos fijos ----

  async loadFijos() {
    try {
      this.fijos = await firstValueFrom(this.http.get<any[]>(`${API}/fixed-expenses`));
    } catch {
      this.fijos = [];
    }
  }

  nuevoFijo() {
    this.agregandoFijo = true;
    this.editandoFijo = null;
    this.borradorFijo = { label: '', amount: null, category: 'cuentas', dueDay: null };
  }

  editarFijo(f: any) {
    this.editandoFijo = f.id;
    this.agregandoFijo = false;
    this.borradorFijo = { label: f.label, amount: f.amount, category: f.category, dueDay: f.dueDay };
  }

  /** El backend espera dueDay como número o null, nunca como texto vacío. */
  private cuerpoFijo() {
    const dia = Number(this.borradorFijo.dueDay);
    return {
      label: this.borradorFijo.label,
      amount: Number(this.borradorFijo.amount),
      category: this.borradorFijo.category,
      dueDay: Number.isInteger(dia) && dia >= 1 && dia <= 31 ? dia : null
    };
  }

  async crearFijo() {
    await firstValueFrom(this.http.post(`${API}/fixed-expenses`, this.cuerpoFijo()));
    this.agregandoFijo = false;
    await this.refrescarFijos();
  }

  async guardarFijo(f: any) {
    this.busyId = f.id;
    try {
      await firstValueFrom(this.http.patch(`${API}/fixed-expenses/${f.id}`, this.cuerpoFijo()));
      this.editandoFijo = null;
      await this.refrescarFijos();
    } finally {
      this.busyId = null;
    }
  }

  async borrarFijo(f: any) {
    this.busyId = f.id;
    try {
      await firstValueFrom(this.http.delete(`${API}/fixed-expenses/${f.id}`));
      await this.refrescarFijos();
    } finally {
      this.busyId = null;
    }
  }

  /** Los fijos entran en el saldo disponible: hay que recargar el resumen. */
  private async refrescarFijos() {
    await this.loadFijos();
    await this.load();
  }

  /** Quita un gasto mal registrado y devuelve el monto al saldo. */
  async removeExpense(m: any) {
    this.busyId = m.id;
    try {
      await firstValueFrom(this.http.delete(`${API}/expenses/${m.id}`));
      await this.load();
    } finally {
      this.busyId = null;
    }
  }

  /**
   * Enlace al correo del que salió un movimiento. El identificador guardado
   * cambia según cómo llegó:
   *   gmail:<id>  → id de la API de Gmail, que es el mismo del fragmento de URL
   *   email:<id>  → Message-ID original, que se busca con rfc822msgid
   * Devuelve null para gastos manuales o de Fintoc, que no vienen de un correo.
   */
  mailUrl(m: any): string | null {
    const ext: string | undefined = m?.externalId;
    if (!ext) return null;

    // Sin la cuenta conectada se cae a /u/0, que es la sesión de Google por
    // defecto del navegador y puede no ser la misma del banco.
    const base = this.gmail?.email
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(this.gmail.email)}`
      : 'https://mail.google.com/mail/u/0/';

    if (ext.startsWith('gmail:')) return `${base}#all/${ext.slice(6)}`;
    if (ext.startsWith('email:')) return `${base}#search/rfc822msgid:${encodeURIComponent(ext.slice(6))}`;
    return null;
  }

  /** Movimientos detectados en correos que esperan tu confirmación. */
  async loadPending() {
    try {
      this.pending = await firstValueFrom(this.http.get<any[]>(`${API}/pending`));
    } catch {
      this.pending = [];
    }
  }

  async approve(p: any) {
    this.busyId = p.id;
    try {
      await firstValueFrom(this.http.post(`${API}/pending/${p.id}/approve`, {}));
      await this.loadPending();
      await this.load();
    } finally {
      this.busyId = null;
    }
  }

  async reject(p: any) {
    this.busyId = p.id;
    try {
      await firstValueFrom(this.http.post(`${API}/pending/${p.id}/reject`, {}));
      await this.loadPending();
    } finally {
      this.busyId = null;
    }
  }

  /** Estado de la conexión con Gmail. */
  async loadGmailStatus() {
    try {
      this.gmail = await firstValueFrom(this.http.get<any>(`${API}/gmail/status`));
    } catch {
      this.gmail = null;
    }
  }

  /** Lee el ?gmail=ok|error con que vuelve el usuario desde Google. */
  readGmailReturn() {
    const estado = new URLSearchParams(location.search).get('gmail');
    if (!estado) return;
    this.gmailMsg = estado === 'ok'
      ? 'Gmail conectado. Desde ahora avisaremos de cada movimiento que llegue.'
      : 'No se pudo conectar Gmail. Inténtalo de nuevo.';
    history.replaceState({}, '', location.pathname);
    if (estado === 'ok') this.syncGmail();
  }

  async connectGmail() {
    const { url } = await firstValueFrom(this.http.get<{ url: string }>(`${API}/gmail/auth-url`));
    location.href = url;
  }

  async syncGmail() {
    this.syncing = true;
    try {
      const r = await firstValueFrom(this.http.post<any>(`${API}/gmail/sync`, {}));
      this.gmailMsg = r.propuestos
        ? `Revisados ${r.revisados} correos: ${r.propuestos} por confirmar más abajo.`
        : `Revisados ${r.revisados} correos, nada nuevo.`;
      await this.loadPending();
      await this.loadGmailStatus();
    } catch (e: any) {
      this.gmailMsg = e?.error?.error || 'No se pudo revisar el correo.';
      await this.loadGmailStatus();
    } finally {
      this.syncing = false;
    }
  }

  async disconnectGmail() {
    await firstValueFrom(this.http.delete(`${API}/gmail/disconnect`));
    this.gmailMsg = 'Gmail desconectado.';
    this.loadGmailStatus();
    this.loadPending();
    this.loadFijos();
  }

  async copyIngest() {
    if (!this.ingest?.address) return;
    await navigator.clipboard.writeText(this.ingest.address);
    this.copied = true;
    setTimeout(() => (this.copied = false), 2000);
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
