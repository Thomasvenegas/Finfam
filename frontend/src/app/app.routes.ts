import { Routes } from '@angular/router';
import { authGuard, onboardedGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login.component').then(m => m.LoginComponent) },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/onboarding.component').then(m => m.OnboardingComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, onboardedGuard],
    loadComponent: () => import('./pages/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'tarjetas',
    canActivate: [authGuard, onboardedGuard],
    loadComponent: () => import('./pages/cards.component').then(m => m.CardsComponent)
  },
  {
    path: 'presupuestos',
    canActivate: [authGuard, onboardedGuard],
    loadComponent: () => import('./pages/budgets.component').then(m => m.BudgetsComponent)
  },
  {
    path: 'metas',
    canActivate: [authGuard, onboardedGuard],
    loadComponent: () => import('./pages/goals.component').then(m => m.GoalsComponent)
  },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' }
];
