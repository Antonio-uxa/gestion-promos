import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http'; // <--- ESTO ES VITAL
import { AppComponent } from './app/app'; // <-- Cambia 'App' por 'AppComponent'

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient() // <--- SIN ESTO, HttpClientModule no funciona
  ]
}).catch(err => console.error(err));

