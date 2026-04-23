import { Routes } from '@angular/router';
// SOLUCIÓN: Cambia './app.component' por './app'
import { AppComponent } from './app'; // El nombre debe ser AppComponent

export const routes: Routes = [
  { path: '', redirectTo: 'analista', pathMatch: 'full' },
  { path: 'admin', component: AppComponent },
  { path: 'analista', component: AppComponent },
  { path: '**', redirectTo: 'analista' }
]; 