import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API } from '../core/auth.service';

@Component({
  selector: 'app-cards',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="container" style="max-width:720px">
    <h2>Mis tarjetas</h2>
    <p class="muted">
      Por seguridad (norma PCI-DSS) solo guardamos banco, marca y los últimos 4 dígitos.
      Nunca te pediremos el número completo ni el código de seguridad.
    </p>

    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:16px">
      <div class="card" *ngFor="let c of cards"
           style="background:linear-gradient(135deg,#2a0b4d,#0b2a4d 55%,#0b1030);color:#fff;border-color:var(--violet);box-shadow:0 0 24px rgba(164,92,255,.25)">
        <p style="margin:0;opacity:.8">{{ c.bank }}</p>
        <h3 style="letter-spacing:2px;margin:12px 0">•••• •••• •••• {{ c.last4 }}</h3>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span>{{ c.brand }}</span>
          <span *ngIf="c.creditLimit" style="opacity:.8">
            Cupo {{ c.creditLimit | currency:'CLP':'symbol-narrow':'1.0-0' }}
          </span>
        </div>
        <button class="ghost" style="margin-top:12px;color:#fff;border-color:rgba(255,255,255,.4)"
                (click)="remove(c.id)">Quitar</button>
      </div>

      <div class="card">
        <h3>Agregar tarjeta</h3>
        <label>Banco</label>
        <select [(ngModel)]="form.bank">
          <option>Banco de Chile</option>
          <option>Banco Santander</option>
          <option>BCI</option>
          <option>Banco Estado</option>
          <option>Banco Falabella</option>
          <option>Itaú</option>
          <option>Scotiabank</option>
          <option>Otro</option>
        </select>
        <label>Marca</label>
        <select [(ngModel)]="form.brand">
          <option>Visa</option><option>Mastercard</option><option>Amex</option><option>Otra</option>
        </select>
        <label>Últimos 4 dígitos</label>
        <input [(ngModel)]="form.last4" maxlength="4" placeholder="1234">
        <label>Cupo (opcional)</label>
        <input type="number" [(ngModel)]="form.creditLimit" placeholder="2.000.000">
        <label>Día de facturación (opcional)</label>
        <input type="number" min="1" max="31" [(ngModel)]="form.billingDay">
        <button style="margin-top:14px;width:100%" (click)="add()"
                [disabled]="!form.last4 || form.last4.length!==4">Guardar tarjeta</button>
        <p class="error" *ngIf="error">{{ error }}</p>
      </div>
    </div>
  </div>
  `
})
export class CardsComponent implements OnInit {
  cards: any[] = [];
  form: any = { bank: 'Banco de Chile', brand: 'Visa', last4: '', creditLimit: null, billingDay: null };
  error = '';

  constructor(private http: HttpClient) {}

  ngOnInit() { this.load(); }

  async load() {
    this.cards = await firstValueFrom(this.http.get<any[]>(`${API}/cards`));
  }

  async add() {
    this.error = '';
    try {
      const payload: any = { bank: this.form.bank, brand: this.form.brand, last4: this.form.last4 };
      if (this.form.creditLimit) payload.creditLimit = Number(this.form.creditLimit);
      if (this.form.billingDay) payload.billingDay = Number(this.form.billingDay);
      await firstValueFrom(this.http.post(`${API}/cards`, payload));
      this.form.last4 = ''; this.form.creditLimit = null; this.form.billingDay = null;
      this.load();
    } catch {
      this.error = 'Revisa los datos: solo se aceptan los últimos 4 dígitos.';
    }
  }

  async remove(id: string) {
    await firstValueFrom(this.http.delete(`${API}/cards/${id}`));
    this.load();
  }
}
