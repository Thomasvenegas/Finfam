import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

/** Escucha 'expense:created' del backend: cuando el banco (o el usuario)
 *  genera un gasto, el dashboard se refresca y el saldo baja al instante. */
@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket?: Socket;
  expenseCreated$ = new Subject<any>();
  incomeCreated$ = new Subject<any>();
  pendingCreated$ = new Subject<any>();

  connect() {
    if (this.socket?.connected) return;
    this.socket = io(environment.socketUrl, {
      auth: { token: localStorage.getItem('finfam_token') }
    });
    this.socket.on('expense:created', e => this.expenseCreated$.next(e));
    this.socket.on('income:created', i => this.incomeCreated$.next(i));
    this.socket.on('pending:created', p => this.pendingCreated$.next(p));
  }

  disconnect() { this.socket?.disconnect(); }
}
