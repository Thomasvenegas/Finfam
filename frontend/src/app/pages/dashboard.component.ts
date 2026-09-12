import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartConfiguration } from 'chart.js';
import { API } from '../core/auth.service';
import { SocketService } from '../core/socket.service';
import { CATEGORIAS } from '../core/categorias';
import { ThemeService } from '../core/theme.service';

declare const Fintoc: any;

// Chart.js asume fondo claro; los ejes se re-tiñen con cada cambio de tema.
function tintarChartJs() {
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--ink-soft').trim();
  Chart.defaults.borderColor = css.getPropertyValue('--line').trim();
}

/** Mezcla dos colores #rrggbb; con cualquier otro formato devuelve el primero. */
function mezclar(a: string, b: string, t: number): string {
  const rgb = (h: string) =>
    /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : null;
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a;
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective, RouterLink],
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
      <!-- Navegar entre meses para ver cómo cerró uno anterior -->
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:6px">
        <button class="ghost" (click)="irAMes(s.previousMonth)" title="Mes anterior" style="padding:4px 14px">‹</button>
        <strong style="min-width:150px;text-transform:capitalize">{{ nombreMes(s.month) }}</strong>
        <button class="ghost" (click)="irAMes(s.nextMonth)" [disabled]="!s.nextMonth" title="Mes siguiente" style="padding:4px 14px">›</button>
      </div>
      <p class="muted" style="margin:0">{{ s.isCurrentMonth ? 'Disponible este mes' : 'Así cerró el mes' }}</p>
      <div class="saldo" [class.ok]="!s.overspent" [class.bad]="s.overspent">
        {{ s.available | currency:'CLP':'symbol-narrow':'1.0-0' }}
      </div>
      <p *ngIf="s.overspent" class="error">
        {{ s.isCurrentMonth ? 'Has gastado más de lo que ganas este mes.' : 'Ese mes gastaste más de lo que ganaste.' }}
      </p>
      <p class="muted">
        Ingresos {{ s.totalIncome | currency:'CLP':'symbol-narrow':'1.0-0' }} ·
        Fijos {{ s.totalFixed | currency:'CLP':'symbol-narrow':'1.0-0' }} ·
        Variables {{ s.totalVariable | currency:'CLP':'symbol-narrow':'1.0-0' }}
      </p>

      <!-- La proyección solo tiene sentido en el mes en curso -->
      <p *ngIf="s.projection" style="margin:10px 0 0">
        A este ritmo terminarás el mes con
        <strong [style.color]="s.projection.projectedAvailable < 0 ? 'var(--red)' : 'var(--green)'">
          {{ s.projection.projectedAvailable | currency:'CLP':'symbol-narrow':'1.0-0' }}
        </strong>
        <span *ngIf="s.projection.preliminar" class="muted">(estimación preliminar: llevas pocos días)</span>
      </p>
      <p *ngIf="textoComparacion() as t" class="muted" style="margin:6px 0 0">{{ t }}</p>

      <button *ngIf="!s.isCurrentMonth" class="ghost" (click)="irAMes(null)" style="margin-top:12px">
        Volver al mes actual
      </button>
    </div>

    <!-- Lo que pide atención pronto: pagos por vencer y presupuestos al límite -->
    <div class="grid" [class.grid-2]="s.upcomingPayments?.length" style="margin-top:16px" *ngIf="s.isCurrentMonth">
      <div class="card" *ngIf="s.upcomingPayments?.length">
        <h3>Próximos pagos</h3>
        <div *ngFor="let p of s.upcomingPayments"
             style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)">
          <span>{{ p.label }} <span class="muted">· {{ cuandoVence(p.daysLeft) }}</span></span>
          <strong style="white-space:nowrap">{{ p.amount | currency:'CLP':'symbol-narrow':'1.0-0' }}</strong>
        </div>
      </div>

      <div class="card">
        <h3>Presupuestos</h3>
        <div *ngFor="let b of alertas" style="padding:4px 0 8px">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <span style="text-transform:capitalize">{{ b.category }}</span>
            <strong [style.color]="b.level === 'excedido' ? 'var(--red)' : 'var(--yellow)'">{{ b.pct }}%</strong>
          </div>
          <div style="height:8px;border-radius:5px;background:var(--card-hi);overflow:hidden;margin-top:4px">
            <div [style.width.%]="b.pct > 100 ? 100 : b.pct"
                 [style.background]="b.level === 'excedido' ? 'var(--red)' : 'var(--yellow)'" style="height:100%"></div>
          </div>
        </div>
        <p *ngIf="!alertas.length" class="muted" style="margin:0">
          {{ s.budgets?.length ? 'Vas dentro de todos tus presupuestos.' : 'Define topes por categoría y te avisamos antes de pasarte.' }}
        </p>
        <a routerLink="/presupuestos" style="display:inline-block;margin-top:10px">
          {{ s.budgets?.length ? 'Ver presupuestos' : 'Definir presupuestos' }} →
        </a>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Gasto acumulado vs ingreso</h3>
        <div class="chart-box">
          <canvas baseChart type="line" [data]="lineData" [options]="lineOpts"></canvas>
        </div>
      </div>
      <div class="card">
        <h3>¿En qué se va la plata?</h3>
        <div class="chart-box">
          <canvas baseChart type="doughnut" [data]="donutData" [options]="donutOpts"></canvas>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
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
        <!-- Búsqueda y filtro sobre todo el historial, y descarga para Excel -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          <input [(ngModel)]="filtro.q" (ngModelChange)="filtrar()" placeholder="Buscar…"
                 style="flex:2;min-width:120px">
          <select [(ngModel)]="filtro.category" (ngModelChange)="filtrar()" style="flex:1;min-width:110px">
            <option value="">Todas</option>
            <option *ngFor="let c of categories" [value]="c">{{ c }}</option>
            <option value="ingreso">ingresos</option>
          </select>
          <button class="ghost" (click)="exportar()" [disabled]="exportando"
                  title="Descargar lo filtrado en CSV para Excel">{{ exportando ? '…' : '⬇ CSV' }}</button>
        </div>
        <div *ngIf="!movements.length && !cargandoMas" class="muted">
          {{ hayFiltro ? 'Ningún movimiento coincide con la búsqueda.' : 'Aún no hay movimientos. Registra un gasto o conecta tu banco.' }}
        </div>

        <!-- Alto acotado con scroll propio: al llegar al final se pide la
             página siguiente, así se puede ir hacia atrás en el tiempo. -->
        <div #listaMovs (scroll)="alScrollear(listaMovs)"
             style="max-height:340px;overflow-y:auto;overscroll-behavior:contain">
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
        </div>

        <p *ngIf="cargandoMas" class="muted" style="margin:8px 0 0">Cargando más…</p>
        <p *ngIf="!hayMasMovs && movements.length" class="muted" style="margin:8px 0 0">
          No hay más movimientos.
        </p>

        <button class="ghost" style="margin-top:14px" (click)="connectBank()">
          Conectar Banco de Chile (y otros)
        </button>
        <p class="muted">Vía Fintoc: tus movimientos llegan solos y el saldo baja al instante.</p>
      </div>
    </div>

    <!-- Apariencia: los temas son bloques de variables CSS, así que el cambio
         es instantáneo y alcanza a toda la app, gráficos incluidos -->
    <div class="card" style="margin-top:16px">
      <h3>Apariencia</h3>
      <p class="muted" style="margin-top:0">
        Elige cómo se ve FinFam. La preferencia se guarda en este dispositivo.
      </p>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button *ngFor="let t of tema.temas" class="ghost"
                (click)="tema.elegirTema(t.id)"
                [style.borderColor]="tema.temaActual() === t.id ? 'var(--neon)' : ''"
                [style.borderWidth]="tema.temaActual() === t.id ? '2px' : ''"
                style="display:flex;align-items:center;gap:8px;padding:8px 12px">
          <span style="display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--line)">
            <span *ngFor="let c of t.muestra"
                  [style.background]="c"
                  style="width:12px;height:18px;display:block"></span>
          </span>
          {{ t.nombre }}
          <span *ngIf="tema.temaActual() === t.id" style="color:var(--neon)">✓</span>
        </button>
      </div>

      <label style="margin-top:16px">Color de los botones</label>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input type="color" [value]="tema.acento() || tema.color('--neon')"
               (input)="tema.elegirAcento($any($event.target).value)"
               style="width:56px;height:38px;padding:2px;cursor:pointer">
        <button *ngIf="tema.acento()" class="ghost" (click)="tema.elegirAcento(null)">
          Volver al del tema
        </button>
        <span class="muted">Cambia el acento sin cambiar el resto de la paleta.</span>
      </div>
    </div>

    <!-- Ingresos: los que se repiten cuentan todos los meses; los puntuales
         (un bono, una devolución) solo en el suyo -->
    <div class="card" style="margin-top:16px">
      <h3>Ingresos del mes</h3>
      <p class="muted" style="margin-top:0">
        Total: <strong>{{ s.totalIncome | currency:'CLP':'symbol-narrow':'1.0-0' }}</strong>
      </p>

      <div *ngIf="ingresosFallaron" class="error">No se pudieron cargar tus ingresos. Recarga la página.</div>
      <div *ngIf="!ingresos.length && !ingresosFallaron" class="muted">Todavía no tienes ingresos registrados.</div>

      <div *ngFor="let i of ingresos" style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div *ngIf="editandoIngreso !== i.id" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <span style="flex:1;min-width:0">
            {{ i.label }}
            <span class="muted">· {{ i.recurring ? 'todos los meses' : 'solo este mes' }}</span>
          </span>
          <strong style="color:var(--green);white-space:nowrap">
            +{{ i.amount | currency:'CLP':'symbol-narrow':'1.0-0' }}
          </strong>
          <button class="ghost" (click)="editarIngreso(i)" title="Editar"
                  style="padding:2px 8px;line-height:1.4">✎</button>
          <button class="ghost" (click)="borrarIngreso(i)" [disabled]="busyId === i.id" title="Quitar"
                  style="padding:2px 8px;line-height:1.4">✕</button>
        </div>

        <div *ngIf="editandoIngreso === i.id" style="display:grid;gap:8px;padding:4px 0">
          <input [(ngModel)]="borradorIngreso.label" placeholder="Nombre (ej. Sueldo)">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="number" [(ngModel)]="borradorIngreso.amount" placeholder="Monto" style="flex:1;min-width:120px">
            <label style="margin:0;display:flex;gap:6px;align-items:center;white-space:nowrap">
              <input type="checkbox" [(ngModel)]="borradorIngreso.recurring" style="width:auto">
              Se repite todos los meses
            </label>
          </div>
          <div style="display:flex;gap:8px">
            <button (click)="guardarIngreso(i)" [disabled]="busyId === i.id || !borradorIngreso.label || !borradorIngreso.amount">
              Guardar
            </button>
            <button class="ghost" (click)="editandoIngreso = null">Cancelar</button>
          </div>
        </div>
      </div>

      <div *ngIf="!agregandoIngreso" style="margin-top:12px">
        <button class="ghost" (click)="nuevoIngreso()">+ Agregar ingreso</button>
      </div>

      <div *ngIf="agregandoIngreso" style="display:grid;gap:8px;margin-top:12px">
        <input [(ngModel)]="borradorIngreso.label" placeholder="Nombre (ej. Bono, Arriendo)">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="number" [(ngModel)]="borradorIngreso.amount" placeholder="Monto" style="flex:1;min-width:120px">
          <label style="margin:0;display:flex;gap:6px;align-items:center;white-space:nowrap">
            <input type="checkbox" [(ngModel)]="borradorIngreso.recurring" style="width:auto">
            Se repite todos los meses
          </label>
        </div>
        <p class="muted" style="margin:0">
          {{ borradorIngreso.recurring
             ? 'Contará en el saldo de todos los meses, como un sueldo.'
             : 'Contará solo en el mes actual, como un bono o una devolución.' }}
        </p>
        <div style="display:flex;gap:8px">
          <button (click)="crearIngreso()" [disabled]="!borradorIngreso.label || !borradorIngreso.amount">Agregar</button>
          <button class="ghost" (click)="agregandoIngreso = false">Cancelar</button>
        </div>
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

      <div *ngIf="fijosFallaron" class="error">No se pudieron cargar tus gastos fijos. Recarga la página.</div>
      <div *ngIf="!fijos.length && !fijosFallaron" class="muted">Todavía no tienes gastos fijos registrados.</div>

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

  mesVisto: string | null = null;      // null = el mes en curso
  filtro = { q: '', category: '' };
  historialCargado = false;
  exportando = false;
  private seqHist = 0;
  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;
  private static readonly MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // Edición en línea: se trabaja sobre un borrador para poder cancelar
  // sin haber tocado lo que se ve en pantalla.
  editandoGasto: string | null = null;
  borrador: any = {};
  fijos: any[] = [];
  editandoFijo: string | null = null;
  agregandoFijo = false;
  borradorFijo: any = {};
  ingresos: any[] = [];
  editandoIngreso: string | null = null;
  agregandoIngreso = false;
  borradorIngreso: any = {};
  fijosFallaron = false;
  ingresosFallaron = false;
  movimientos: any[] = [];
  hayMasMovs = true;
  cargandoMas = false;
  private readonly PAGINA = 20;

  /**
   * Historial paginado. Solo se recurre al resumen del mes si /movements nunca
   * respondió: con un filtro sin resultados la lista vacía es la respuesta
   * correcta, no una señal para mostrar los movimientos sin filtrar.
   */
  get movements(): any[] {
    if (this.historialCargado || !this.s) return this.movimientos;
    return this.s.lastMovements || [];
  }
  newDesc = ''; newAmount: number | null = null; newCategory = 'supermercado';
  categories = CATEGORIAS;
  private sub?: Subscription;
  private incomeSub?: Subscription;
  private pendingSub?: Subscription;
  private temaSub?: Subscription;

  lineData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  lineOpts: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false, // el alto lo pone .chart-box
    plugins: { legend: { display: true } },
    scales: { y: { beginAtZero: true } }
  };
  donutOpts: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false
  };
  donutData: ChartConfiguration<'doughnut'>['data'] = { labels: [], datasets: [] };

  constructor(
    private http: HttpClient,
    private socket: SocketService,
    public tema: ThemeService
  ) {}

  /**
   * Un color por categoría. Con 18 categorías no alcanzan los 7 del tema, y
   * Chart.js pinta las tajadas sobrantes con un gris casi transparente,
   * invisible sobre fondo oscuro. Se agregan variantes más claras y más
   * oscuras de los mismos colores, así la dona sigue la paleta elegida.
   */
  private paletaCategorias(n: number): string[] {
    const base = ['--magenta', '--neon', '--green', '--violet', '--yellow', '--red', '--ink-soft']
      .map(v => this.tema.color(v));
    const tinta = this.tema.color('--ink');
    const fondo = this.tema.color('--card');
    const variantes = [
      ...base,
      ...base.map(c => mezclar(c, tinta, 0.45)),
      ...base.map(c => mezclar(c, fondo, 0.4))
    ];
    return Array.from({ length: Math.max(n, 1) }, (_, i) => variantes[i % variantes.length]);
  }

  /** Chart.js necesita el color con alfa para el relleno bajo la curva. */
  private conAlfa(color: string, alfa: number): string {
    return `color-mix(in srgb, ${color} ${Math.round(alfa * 100)}%, transparent)`;
  }

  ngOnInit() {
    this.load();
    this.loadIngestAddress();
    this.loadGmailStatus();
    this.loadPending();
    this.loadFijos();
    this.loadIngresos();
    this.recargarMovimientos();
    this.readGmailReturn();
    this.socket.connect();
    // Tiempo real: gasto nuevo (manual, webhook Fintoc o correo) => refrescar
    this.sub = this.socket.expenseCreated$.subscribe(() => {
      this.load();
      this.recargarMovimientos();
    });
    // Un abono avisado por correo también mueve el saldo: refrescar igual.
    this.incomeSub = this.socket.incomeCreated$.subscribe(() => {
      this.load();
      this.recargarMovimientos();
    });
    // Un correo recién detectado aparece en la bandeja sin recargar la página
    this.pendingSub = this.socket.pendingCreated$.subscribe(() => this.loadPending());

    // Los gráficos se pintan con colores calculados en JS, no con CSS: a
    // diferencia del resto de la app no se enteran solos del cambio de tema.
    tintarChartJs();
    this.temaSub = this.tema.cambios$.subscribe(() => {
      tintarChartJs();
      if (this.s) this.pintarGraficos();
    });
  }
  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.incomeSub?.unsubscribe();
    this.pendingSub?.unsubscribe();
    this.temaSub?.unsubscribe();
  }

  async load() {
    try {
      const mes = this.mesVisto ? `?month=${this.mesVisto}` : '';
      this.s = await firstValueFrom(this.http.get<any>(`${API}/dashboard/summary${mes}`));
      this.sinConexion = false;
    } catch {
      // Instalada como app puede abrirse sin red: mejor decirlo que dejar la
      // pantalla en blanco esperando datos que no van a llegar. No se relanza
      // para no dejar promesas rechazadas sueltas en cada llamador.
      this.sinConexion = true;
      // Sin resumen no hay nada que pintar; seguir aquí reventaba con
      // this.s null la primera vez que se abría la app sin red.
      return;
    }
    this.pintarGraficos();
  }

  /** Construye los datasets con los colores del tema activo. */
  private pintarGraficos() {
    const days = this.s.cumulative.map((_: number, i: number) => i + 1);
    this.lineData = {
      labels: days,
      datasets: [
        {
          label: 'Gasto acumulado',
          data: this.s.cumulative,
          borderColor: this.tema.color('--magenta'),
          backgroundColor: this.conAlfa(this.tema.color('--magenta'), .16),
          fill: true, tension: .25, pointRadius: 0
        },
        {
          label: 'Ingreso del mes',
          data: days.map(() => this.s.incomeLine),
          borderColor: this.tema.color('--green'),
          borderDash: [6, 6], pointRadius: 0
        }
      ]
    };
    this.donutData = {
      labels: Object.keys(this.s.byCategory),
      datasets: [{
        data: Object.values(this.s.byCategory) as number[],
        backgroundColor: this.paletaCategorias(Object.keys(this.s.byCategory).length),
        borderColor: this.tema.color('--card'),
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

  // ---- Historial de movimientos ----

  /** Vuelve a la primera página: tras crear, editar, borrar o cambiar el filtro. */
  async recargarMovimientos() {
    // Cada recarga abre una "época": lo que llegue de una anterior se descarta.
    // Si no, una respuesta lenta de la búsqueda previa se mezclaba con la nueva.
    this.seqHist++;
    this.movimientos = [];
    this.hayMasMovs = true;
    this.cargandoMas = false; // la recarga manda aunque haya una página en vuelo
    await this.cargarMasMovimientos();
  }

  async cargarMasMovimientos() {
    if (this.cargandoMas || !this.hayMasMovs) return;
    const epoca = this.seqHist;
    this.cargandoMas = true;
    try {
      const params = this.paramsFiltro();
      params.set('limit', String(this.PAGINA));
      params.set('offset', String(this.movimientos.length));
      const r = await firstValueFrom(this.http.get<any>(`${API}/movements?${params}`));
      if (epoca !== this.seqHist) return; // llegó tarde: ya se pidió otra cosa
      this.movimientos = [...this.movimientos, ...r.items];
      this.hayMasMovs = r.hayMas;
      this.historialCargado = true;
    } catch {
      // Sin historial no se corta la página: el resumen del mes sigue sirviendo.
      if (epoca === this.seqHist) this.hayMasMovs = false;
    } finally {
      if (epoca === this.seqHist) this.cargandoMas = false;
    }
  }

  get hayFiltro() { return !!(this.filtro.q.trim() || this.filtro.category); }

  private paramsFiltro() {
    const p = new URLSearchParams();
    if (this.filtro.q.trim()) p.set('q', this.filtro.q.trim());
    if (this.filtro.category) p.set('category', this.filtro.category);
    return p;
  }

  /** Espera a que se deje de escribir: una petición por búsqueda, no por tecla. */
  filtrar() {
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => this.recargarMovimientos(), 300);
  }

  /**
   * Un <a href> no puede mandar el token de sesión, así que el CSV se baja por
   * HttpClient y se entrega al navegador como archivo local.
   */
  async exportar() {
    this.exportando = true;
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API}/movements/export?${this.paramsFiltro()}`, { responseType: 'blob' })
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finfam-movimientos-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      // Revocar al instante puede cortar la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      this.exportando = false;
    }
  }

  // ---- Navegación por meses ----

  irAMes(mes: string | null) {
    this.mesVisto = mes;
    this.load();
  }

  nombreMes(clave?: string | null): string {
    if (!clave) return '';
    const [y, m] = clave.split('-').map(Number);
    return `${DashboardComponent.MESES[m - 1]} ${y}`;
  }

  /** "Llevas 12% más que a esta altura de agosto", o null si no hay base. */
  textoComparacion(): string | null {
    const c = this.s?.comparison;
    if (!c || c.variationPct === null || c.variationPct === undefined) return null;
    const mesAnterior = DashboardComponent.MESES[Number(this.s.previousMonth.split('-')[1]) - 1];
    const v = c.variationPct;
    if (v === 0) return c.samePeriod ? `Vas igual que a esta altura de ${mesAnterior}.` : `Gastaste lo mismo que en ${mesAnterior}.`;
    const cuanto = `${Math.abs(v)}% ${v > 0 ? 'más' : 'menos'}`;
    return c.samePeriod
      ? `Llevas ${cuanto} en gastos variables que a esta altura de ${mesAnterior}.`
      : `Gastaste ${cuanto} en gastos variables que en ${mesAnterior}.`;
  }

  /** Presupuestos que ya piden atención (80% o más). */
  get alertas(): any[] {
    return (this.s?.budgets || []).filter((b: any) => b.level !== 'ok');
  }

  cuandoVence(dias: number) {
    return dias === 0 ? 'vence hoy' : dias === 1 ? 'vence mañana' : `en ${dias} días`;
  }

  /** Pide la página siguiente al acercarse al final de la lista. */
  alScrollear(el: HTMLElement) {
    const faltan = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (faltan < 120) this.cargarMasMovimientos();
  }

  // ---- Ingresos ----

  async loadIngresos() {
    try {
      this.ingresos = await firstValueFrom(this.http.get<any[]>(`${API}/incomes`));
      this.ingresosFallaron = false;
    } catch {
      // Vaciar la lista diría "no tienes ingresos", que es una afirmación
      // distinta —y peligrosa en una app de plata— a "no pude leerlos".
      this.ingresosFallaron = true;
    }
  }

  nuevoIngreso() {
    this.agregandoIngreso = true;
    this.editandoIngreso = null;
    this.borradorIngreso = { label: '', amount: null, recurring: true };
  }

  editarIngreso(i: any) {
    this.editandoIngreso = i.id;
    this.agregandoIngreso = false;
    this.borradorIngreso = { label: i.label, amount: i.amount, recurring: i.recurring };
  }

  private cuerpoIngreso() {
    return {
      label: this.borradorIngreso.label,
      amount: Number(this.borradorIngreso.amount),
      recurring: !!this.borradorIngreso.recurring
    };
  }

  async crearIngreso() {
    await firstValueFrom(this.http.post(`${API}/incomes`, this.cuerpoIngreso()));
    this.agregandoIngreso = false;
    await this.refrescarIngresos();
  }

  async guardarIngreso(i: any) {
    this.busyId = i.id;
    try {
      await firstValueFrom(this.http.patch(`${API}/incomes/${i.id}`, this.cuerpoIngreso()));
      this.editandoIngreso = null;
      await this.refrescarIngresos();
    } finally {
      this.busyId = null;
    }
  }

  async borrarIngreso(i: any) {
    this.busyId = i.id;
    try {
      await firstValueFrom(this.http.delete(`${API}/incomes/${i.id}`));
      await this.refrescarIngresos();
    } finally {
      this.busyId = null;
    }
  }

  /** Los ingresos entran en el saldo disponible: hay que recargar el resumen. */
  private async refrescarIngresos() {
    await this.loadIngresos();
    await this.load();
    await this.recargarMovimientos();
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
      await this.recargarMovimientos();
    } finally {
      this.busyId = null;
    }
  }

  // ---- Gastos fijos ----

  async loadFijos() {
    try {
      this.fijos = await firstValueFrom(this.http.get<any[]>(`${API}/fixed-expenses`));
      this.fijosFallaron = false;
    } catch {
      this.fijosFallaron = true;
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
      await this.recargarMovimientos();
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
    this.loadIngresos();
    this.recargarMovimientos();
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
    this.recargarMovimientos();
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
