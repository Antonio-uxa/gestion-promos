import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, HostListener } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import { AdminPanelComponent } from './admin-panel.component';
Chart.register(...registerables);

type ModoTrabajo = 'GENERAL' | 'ESPECIFICO';
type TipoPaquete = ModoTrabajo | 'AMBOS';

interface PaqueteAnalistaGuardado {
  paqueteAnalistaNombre: string;
  tipoPaquete?: TipoPaquete;
  bloqueadoEdicion?: boolean;
  unidadesLoteGeneralFijado?: boolean;
  modoRepartoGeneral?: 'PROMEDIO' | 'MANUAL';
  unidadesPorUsuarioGeneral?: { [key: number]: number };
  paqueteAnalistaCantidadPromos: number | null;
  nombreLote: string;
  nombrePaqueteEspecifico: string;
  modoTrabajo: ModoTrabajo;
  idsSeleccionados: number[];
  unidadesLoteGeneral: number;
  registroCantidades: any;
  segundos: number;
  tiempoAcumuladoMs: number;
  inicioCronometroMs: number | null;
  corriendo: boolean;
  sesionId?: number | null;
  sesionInicioIso?: string | null;
  sesionFinIso?: string | null;
  sesionDuracionSegundos?: number;
}

interface SesionUsuarioPaqueteGuardada {
  id: number;
  usuario_id: number;
  paquete_nombre: string;
  modo: ModoTrabajo;
  started_at: string | null;
  ended_at: string | null;
  elapsed_seconds: number;
  activo: boolean;
  finalizado?: boolean;
}

interface StatusResumenGlobal {
  registros: number;
  paquetes: number;
  analistas: number;
  meta_total: number;
  real_total: number;
  desviacion_total: number;
  rendimiento_global: number;
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
}

interface StatusFila {
  nombre_paquete?: string;
  modo?: string;
  fecha_creacion?: string | null;
  fecha_ultima?: string | null;
  estado_paquete?: string;
  analista_id?: number;
  nombre?: string;
  registros: number;
  meta_total: number;
  real_total: number;
  desviacion_total: number;
  rendimiento: number;
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
}

interface StatusPaqueteOpcion {
  nombre: string;
  fecha_creacion: string | null;
  estado_paquete?: string;
}

interface StatusPaqueteBasico {
  nombre: string;
  fecha_creacion: string | null;
  estado_paquete: string;
  meta_total: number;
  real_total: number;
  rendimiento: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule, FormsModule, AdminPanelComponent],
  templateUrl: './app.html',
  styleUrls: []
})
export class AppComponent implements OnInit {
  baseUrl = "http://127.0.0.1:5000/api";
  rolActual: 'admin' | 'analista' | 'dashboard' = 'analista';
  adminModo: 'GESTION' | 'GENERAL' | 'ESPECIFICO' = 'GESTION';
  modoTrabajo: ModoTrabajo = 'ESPECIFICO';
  paqueteAnalistaNombre: string = '';
  paqueteAnalistaCantidadPromos: number | null = null;
  paqueteAnalistaActivo: boolean = false;
  paqueteBloqueadoEdicion: boolean = false;
  paquetesGuardados: string[] = [];

  // Datos Base
  usuarios: any[] = [];
  configuracionPromos: any[] = [];
  registroCantidades: any = {}; 
  usuariosAbiertos: { [key: number]: boolean } = {};
  nuevoUsuario: string = '';
  usuarioEditando: any = null;
  paqueteEditandoOriginal: string | null = null;
  paqueteEditandoNombre: string = '';
  paqueteEditandoTipo: TipoPaquete = 'ESPECIFICO';
  nuevoPaqueteTipo: TipoPaquete = 'ESPECIFICO';
  busquedaPaquetes: string = '';

  // Modo General Plural
  idsSeleccionados: number[] = [];
  unidadesLoteGeneral: number = 0;
  unidadesLoteGeneralFijado: boolean = false;
  modoRepartoGeneral: 'PROMEDIO' | 'MANUAL' = 'PROMEDIO';
  unidadesPorUsuarioGeneral: { [key: number]: number } = {};
  nombreLote: string = '';
  nombrePaqueteEspecifico: string = '';
  
  // Cronómetro
  segundos: number = 0;
  timer: any;
  corriendo: boolean = false;
  tiempoAcumuladoMs: number = 0;
  inicioCronometroMs: number | null = null;
  sesionId: number | null = null;
  sesionInicioIso: string | null = null;
  sesionFinIso: string | null = null;
  sesionDuracionSegundos: number = 0;
  sesionesUsuarios: { [key: number]: SesionUsuarioPaqueteGuardada } = {}
  sesionesUsuariosBaseSegundos: { [key: number]: number } = {}
  refrescoTiempoUsuarios: any;

  // Status público (solo lectura)
  statusOpcionesPaquetes: StatusPaqueteOpcion[] = [];
  statusPaquetesSeleccionados: string[] = [];
  statusSeleccionarTodos: boolean = true;
  statusTipoEstadistica: 'TODO' | 'PAQUETE' = 'TODO';
  statusPaquetesDesplegado: boolean = false;
  statusUsuarioIndividualId: number | null = null;
  statusFiltroModo: 'ALL' | ModoTrabajo = 'ALL';
  statusFiltroNombre: string = '';
  statusFechaDesde: string = '';
  statusFechaHasta: string = '';
  statusResumenGlobal: StatusResumenGlobal | null = null;
  statusPorPaquete: StatusFila[] = [];
  statusPorAnalista: StatusFila[] = [];
  statusCargando: boolean = false;

  appHost = this;

  // Autenticación admin
  adminToken: string | null = null;
  adminLoginPassword: string = '';
  adminLoginError: string = '';
  adminAutenticando: boolean = false;

  @ViewChild('myChart') canvas!: ElementRef;
  chart: any;

  constructor(public http: HttpClient, public cdr: ChangeDetectorRef) {}

  @HostListener('document:pointerdown', ['$event'])
  onGlobalPointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const accionDirecta = target.closest('button, a, [role="button"], input[type="checkbox"], input[type="radio"]');
    if (!accionDirecta) return;

    const activo = document.activeElement as HTMLElement | null;
    if (!activo) return;

    const esCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activo.tagName) || activo.isContentEditable;
    if (!esCampo) return;

    if (activo !== target && !activo.contains(target)) {
      activo.blur();
    }
  }

  ngOnInit() { 
    this.cargarDatos();
    setTimeout(() => {
      const rolGuardado = localStorage.getItem('rolActual');
      this.adminToken = sessionStorage.getItem('adminToken');
      if (rolGuardado === 'dashboard') {
        this.setRol('dashboard');
      } else if (rolGuardado === 'admin') {
        this.setRol('admin');
      }
    }, 100);
  }

  get adminAutenticado(): boolean {
    return Boolean(this.adminToken);
  }

  private adminRequestOptions() {
    return {
      headers: {
        'X-Admin-Token': this.adminToken || ''
      }
    };
  }

  private manejarNoAutorizadoAdmin(err: any): boolean {
    if (err?.status === 401) {
      this.cerrarSesionAdmin('Tu sesión de administrador expiró. Inicia sesión nuevamente.');
      return true;
    }
    return false;
  }

  loginAdmin() {
    const password = (this.adminLoginPassword || '').trim();
    if (!password) {
      this.adminLoginError = 'Ingresa la contraseña de administrador.';
      this.cdr.detectChanges();
      return;
    }

    this.adminAutenticando = true;
    this.adminLoginError = '';

    this.http.post(`${this.baseUrl}/admin/login`, { password }).subscribe({
      next: (res: any) => {
        const token = String(res?.token || '');
        if (!token) {
          this.adminLoginError = 'No se recibió token de sesión.';
          this.adminAutenticando = false;
          return;
        }

        this.adminToken = token;
        sessionStorage.setItem('adminToken', token);
        this.adminLoginPassword = '';
        this.adminAutenticando = false;
        this.adminLoginError = '';
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.adminAutenticando = false;
        this.adminLoginError = err?.error?.message || 'Credenciales inválidas.';
        this.cdr.detectChanges();
      }
    });
  }

  cerrarSesionAdmin(mensaje?: string) {
    const options = this.adminRequestOptions();
    this.http.post(`${this.baseUrl}/admin/logout`, {}, options).subscribe({
      next: () => {},
      error: () => {}
    });

    this.adminToken = null;
    sessionStorage.removeItem('adminToken');
    if (this.rolActual === 'admin') {
      this.adminLoginPassword = '';
      this.adminLoginError = mensaje || '';
    }
    if (mensaje) alert(mensaje);
    this.cdr.detectChanges();
  }

  cargarDatos() {
    this.http.get(`${this.baseUrl}/data`).subscribe({
      next: (res: any) => {
        this.usuarios = res.usuarios || [];
        this.configuracionPromos = res.promos || [];
        this.registroCantidades = this.crearMatrizVacia();
        this.refrescarPaquetesGuardados();
        this.restaurarPaqueteActivo();
        this.cdr.detectChanges();
      }
    });
  }

  private crearMatrizVacia() {
    const matrizTemporal: any = {};
    this.usuarios.forEach((u: any) => {
      matrizTemporal[u.id] = {};
      this.configuracionPromos.forEach(p => {
        matrizTemporal[u.id][p.id] = 0;
      });
    });
    return matrizTemporal;
  }

  private obtenerPaquetesGuardados(): Record<string, PaqueteAnalistaGuardado> {
    const guardado = localStorage.getItem('paquetesAnalista');
    const parsed = guardado ? JSON.parse(guardado) : {};
    const normalizados: Record<string, PaqueteAnalistaGuardado> = {};

    Object.keys(parsed || {}).forEach((key) => {
      const paquete = parsed[key] || {};
      const tipoRaw = ((paquete.tipoPaquete || 'ESPECIFICO') as string).toUpperCase();
      const tipo: TipoPaquete = tipoRaw === 'GENERAL' || tipoRaw === 'AMBOS' ? tipoRaw : 'ESPECIFICO';
      const modoRaw = ((paquete.modoTrabajo || '') as string).toUpperCase();
      const modoGuardado: ModoTrabajo = modoRaw === 'GENERAL' ? 'GENERAL' : 'ESPECIFICO';
      const repartoRaw = ((paquete.modoRepartoGeneral || 'PROMEDIO') as string).toUpperCase();
      const repartoGuardado: 'PROMEDIO' | 'MANUAL' = repartoRaw === 'MANUAL' ? 'MANUAL' : 'PROMEDIO';
      const asignaciones = Object.entries(paquete.unidadesPorUsuarioGeneral || {}).reduce((acc: { [key: number]: number }, [uid, valor]) => {
        const id = Number(uid);
        const num = Math.max(0, Math.floor(Number(valor || 0)));
        if (Number.isFinite(id)) {
          acc[id] = num;
        }
        return acc;
      }, {});

      normalizados[key] = {
        ...paquete,
        paqueteAnalistaNombre: paquete.paqueteAnalistaNombre || key,
        tipoPaquete: tipo,
        bloqueadoEdicion: Boolean(paquete.bloqueadoEdicion),
        unidadesLoteGeneralFijado: Boolean(paquete.unidadesLoteGeneralFijado ?? false),
        modoRepartoGeneral: repartoGuardado,
        unidadesPorUsuarioGeneral: asignaciones,
        modoTrabajo: modoGuardado,
        nombreLote: paquete.nombreLote || (paquete.paqueteAnalistaNombre || key),
        nombrePaqueteEspecifico: paquete.nombrePaqueteEspecifico || (paquete.paqueteAnalistaNombre || key)
      };
    });

    return normalizados;
  }

  private guardarPaquetesGuardados(paquetes: Record<string, PaqueteAnalistaGuardado>) {
    localStorage.setItem('paquetesAnalista', JSON.stringify(paquetes));
    this.paquetesGuardados = Object.keys(paquetes).sort((a, b) => a.localeCompare(b));
  }

  paqueteGuardado(nombre: string): PaqueteAnalistaGuardado | null {
    return this.obtenerPaquetesGuardados()[nombre] || null;
  }

  tipoPaqueteDe(nombre: string): TipoPaquete {
    const paquete = this.obtenerPaquetesGuardados()[nombre];
    const tipo = ((paquete?.tipoPaquete || 'ESPECIFICO') as string).toUpperCase();
    return tipo === 'GENERAL' || tipo === 'AMBOS' ? (tipo as TipoPaquete) : 'ESPECIFICO';
  }

  private coincideBusquedaPaquete(nombre: string): boolean {
    const q = (this.busquedaPaquetes || '').trim().toLowerCase();
    return !q || nombre.toLowerCase().includes(q);
  }

  get paquetesGeneralesFiltrados(): string[] {
    return this.paquetesGuardados.filter((nombre) => {
      const tipo = this.tipoPaqueteDe(nombre);
      return (tipo === 'GENERAL' || tipo === 'AMBOS') && this.coincideBusquedaPaquete(nombre);
    });
  }

  get paquetesEspecificosFiltrados(): string[] {
    return this.paquetesGuardados.filter((nombre) => {
      const tipo = this.tipoPaqueteDe(nombre);
      return (tipo === 'ESPECIFICO' || tipo === 'AMBOS') && this.coincideBusquedaPaquete(nombre);
    });
  }

  private refrescarPaquetesGuardados() {
    this.paquetesGuardados = Object.keys(this.obtenerPaquetesGuardados()).sort((a, b) => a.localeCompare(b));
  }

  private capturarPaqueteActual(): PaqueteAnalistaGuardado | null {
    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) return null;

    const tiempoAcumuladoMs = this.obtenerTiempoActualMs();

    return {
      paqueteAnalistaNombre: nombre,
      tipoPaquete: this.nuevoPaqueteTipo,
      bloqueadoEdicion: this.paqueteBloqueadoEdicion,
      unidadesLoteGeneralFijado: this.unidadesLoteGeneralFijado,
      paqueteAnalistaCantidadPromos: this.paqueteAnalistaCantidadPromos,
      nombreLote: this.nombreLote,
      nombrePaqueteEspecifico: this.nombrePaqueteEspecifico,
      modoTrabajo: this.modoTrabajo,
      modoRepartoGeneral: this.modoRepartoGeneral,
      idsSeleccionados: [...this.idsSeleccionados],
      unidadesLoteGeneral: this.unidadesLoteGeneral,
      unidadesPorUsuarioGeneral: { ...this.unidadesPorUsuarioGeneral },
      registroCantidades: JSON.parse(JSON.stringify(this.registroCantidades || {})),
      segundos: Math.floor(tiempoAcumuladoMs / 1000),
      tiempoAcumuladoMs,
      inicioCronometroMs: this.corriendo ? (this.inicioCronometroMs ?? Date.now()) : null,
      corriendo: this.corriendo,
      sesionId: this.sesionId,
      sesionInicioIso: this.sesionInicioIso,
      sesionFinIso: this.sesionFinIso,
      sesionDuracionSegundos: this.sesionDuracionSegundos
    };
  }

  private obtenerTiempoActualMs(): number {
    const base = this.tiempoAcumuladoMs || 0;
    if (!this.corriendo || this.inicioCronometroMs === null) {
      return base;
    }

    return base + (Date.now() - this.inicioCronometroMs);
  }

  private limpiarIntervaloCronometro() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private refrescarTiempoVisibleDesdeSesion() {
    if (this.corriendo && this.sesionInicioIso) {
      const inicio = new Date(this.sesionInicioIso).getTime();
      this.segundos = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
      return;
    }

    if (this.sesionFinIso) {
      this.segundos = Math.max(0, Math.floor(this.sesionDuracionSegundos || 0));
      return;
    }

    this.segundos = 0;
  }

  private iniciarIntervaloSesion() {
    this.limpiarIntervaloCronometro();
    if (!this.corriendo || !this.sesionInicioIso) {
      return;
    }

    this.timer = setInterval(() => {
      this.refrescarTiempoVisibleDesdeSesion();
      this.cdr.detectChanges();
    }, 1000);
  }

  private aplicarSesionRespuesta(sesion: any) {
    if (!sesion) {
      this.sesionId = null;
      this.sesionInicioIso = null;
      this.sesionFinIso = null;
      this.sesionDuracionSegundos = 0;
      this.tiempoAcumuladoMs = 0;
      this.inicioCronometroMs = null;
      this.corriendo = false;
      this.segundos = 0;
      this.refrescarTiempoVisibleDesdeSesion();
      return;
    }

    this.sesionId = sesion.id ?? null;
    this.sesionInicioIso = sesion.started_at ?? null;
    this.sesionFinIso = sesion.ended_at ?? null;
    this.sesionDuracionSegundos = Number(sesion.elapsed_seconds || 0);
    this.corriendo = Boolean(sesion.activo);
    this.tiempoAcumuladoMs = this.corriendo && this.sesionInicioIso ? 0 : this.sesionDuracionSegundos * 1000;
    this.inicioCronometroMs = this.corriendo && this.sesionInicioIso ? new Date(this.sesionInicioIso).getTime() : null;
    this.refrescarTiempoVisibleDesdeSesion();
    this.iniciarIntervaloSesion();
  }

  private cargarSesionPaquete(nombre: string, modo: ModoTrabajo = this.modoTrabajo, fallbackPaquete?: PaqueteAnalistaGuardado) {
    if (!nombre.trim()) {
      this.aplicarSesionRespuesta(null);
      return;
    }

    this.http.get(`${this.baseUrl}/sesiones-paquete`, { params: { nombre, modo } }).subscribe({
      next: (res: any) => {
        const sesion = res?.activa || res?.ultima || null;
        if (sesion) {
          this.aplicarSesionRespuesta(sesion);
        } else if (fallbackPaquete) {
          this.aplicarEstadoLocalPaquete(fallbackPaquete);
        } else {
          this.aplicarSesionRespuesta(null);
        }
      },
      error: () => {
        if (fallbackPaquete) {
          this.aplicarEstadoLocalPaquete(fallbackPaquete);
        } else {
          this.aplicarSesionRespuesta(null);
        }
      }
    });
  }

  private iniciarSesionBackend(nombre: string) {
    return this.http.post(`${this.baseUrl}/paquetes/iniciar`, {
      paquete_nombre: nombre,
      modo: this.modoTrabajo
    });
  }

  private finalizarSesionBackend(nombre: string) {
    return this.http.post(`${this.baseUrl}/paquetes/finalizar`, {
      paquete_nombre: nombre,
      modo: this.modoTrabajo
    });
  }

  private iniciarRefrescoUsuarios() {
    if (this.refrescoTiempoUsuarios) {
      clearInterval(this.refrescoTiempoUsuarios);
      this.refrescoTiempoUsuarios = null;
    }

    if (!this.haySesionesUsuariosActivas()) {
      return;
    }

    this.refrescoTiempoUsuarios = setInterval(() => {
      this.cdr.detectChanges();
      if (!this.haySesionesUsuariosActivas()) {
        this.detenerRefrescoUsuarios();
      }
    }, 1000);
  }

  private detenerRefrescoUsuarios() {
    if (this.refrescoTiempoUsuarios) {
      clearInterval(this.refrescoTiempoUsuarios);
      this.refrescoTiempoUsuarios = null;
    }
  }

  private haySesionesUsuariosActivas(): boolean {
    return Object.values(this.sesionesUsuarios || {}).some((sesion: SesionUsuarioPaqueteGuardada | undefined) => Boolean(sesion?.activo));
  }

  private cargarSesionesUsuarios(nombre: string, modo: ModoTrabajo = this.modoTrabajo) {
    if (!nombre.trim()) {
      this.sesionesUsuarios = {};
      this.sesionesUsuariosBaseSegundos = {};
      this.detenerRefrescoUsuarios();
      return;
    }

    this.http.get(`${this.baseUrl}/sesiones-usuario-paquete`, { params: { paquete: nombre, modo } }).subscribe({
      next: (res: any) => {
        const sesiones = Array.isArray(res?.sesiones) ? res.sesiones : [];
        const mapa: { [key: number]: SesionUsuarioPaqueteGuardada } = {};
        const acumulado: { [key: number]: number } = {};
        sesiones.forEach((sesion: SesionUsuarioPaqueteGuardada) => {
          acumulado[sesion.usuario_id] = (acumulado[sesion.usuario_id] || 0) + Number(sesion.elapsed_seconds || 0);
          if (!mapa[sesion.usuario_id]) {
            mapa[sesion.usuario_id] = sesion;
          }
        });
        this.sesionesUsuarios = mapa;
        this.sesionesUsuariosBaseSegundos = acumulado;
        this.iniciarRefrescoUsuarios();
        this.cdr.detectChanges();
      },
      error: () => {
        this.sesionesUsuarios = {};
        this.sesionesUsuariosBaseSegundos = {};
        this.detenerRefrescoUsuarios();
      }
    });
  }

  obtenerSesionUsuario(usuarioId: number): SesionUsuarioPaqueteGuardada | null {
    return this.sesionesUsuarios?.[usuarioId] || null;
  }

  sesionUsuarioActiva(usuarioId: number): boolean {
    return Boolean(this.obtenerSesionUsuario(usuarioId)?.activo);
  }

  sesionUsuarioFinalizada(usuarioId: number): boolean {
    return Boolean(this.obtenerSesionUsuario(usuarioId)?.finalizado);
  }

  obtenerSegundosSesionUsuario(usuarioId: number): number {
    const sesion = this.obtenerSesionUsuario(usuarioId);
    const base = Number(this.sesionesUsuariosBaseSegundos?.[usuarioId] || 0);
    if (!sesion) return Math.max(0, base);

    if (sesion.activo && sesion.started_at) {
      return Math.max(0, base + Math.floor((Date.now() - new Date(sesion.started_at).getTime()) / 1000));
    }

    return Math.max(0, base);
  }

  get segundosAcumuladosUsuarios(): number {
    if (!Array.isArray(this.usuarios) || this.usuarios.length === 0) return 0;
    return this.usuarios.reduce((acc, u: any) => acc + this.obtenerSegundosSesionUsuario(u.id), 0);
  }

  get segundosAcumuladosSeleccionadosGeneral(): number {
    if (!Array.isArray(this.idsSeleccionados) || this.idsSeleccionados.length === 0) return 0;
    return this.idsSeleccionados.reduce((acc, id) => acc + this.obtenerSegundosSesionUsuario(id), 0);
  }

  get detalleAcumuladoUsuarios(): Array<{ id: number; nombre: string; segundos: number; activo: boolean; inicio: string | null; fin: string | null }> {
    if (!Array.isArray(this.usuarios) || this.usuarios.length === 0) return [];

    return this.usuarios.map((u: any) => {
      const sesion = this.obtenerSesionUsuario(u.id);
      return {
        id: u.id,
        nombre: u.nombre,
        segundos: this.obtenerSegundosSesionUsuario(u.id),
        activo: Boolean(sesion?.activo),
        inicio: sesion?.started_at || null,
        fin: sesion?.ended_at || null
      };
    }).sort((a, b) => b.segundos - a.segundos);
  }

  formatearFechaSesion(valor: string | null | undefined): string {
    return valor ? new Date(valor).toLocaleString() : '-';
  }

  private iniciarSesionUsuarioRequest(usuarioId: number) {
    return this.http.post(`${this.baseUrl}/sesiones-usuario-paquete/iniciar`, {
      paquete_nombre: this.paqueteAnalistaNombre.trim(),
      usuario_id: usuarioId,
      modo: this.modoTrabajo
    });
  }

  private pausarSesionUsuarioRequest(usuarioId: number) {
    return this.http.post(`${this.baseUrl}/sesiones-usuario-paquete/pausar`, {
      paquete_nombre: this.paqueteAnalistaNombre.trim(),
      usuario_id: usuarioId,
      modo: this.modoTrabajo
    });
  }

  private finalizarSesionUsuarioRequest(usuarioId: number) {
    return this.http.post(`${this.baseUrl}/sesiones-usuario-paquete/finalizar`, {
      paquete_nombre: this.paqueteAnalistaNombre.trim(),
      usuario_id: usuarioId,
      modo: this.modoTrabajo
    });
  }

  private obtenerUsuariosObjetivoCronometros(): any[] {
    if (!this.paqueteAnalistaActivo) return [];
    if (this.modoTrabajo === 'GENERAL') return [...this.usuariosSeleccionadosGeneral];
    return Array.isArray(this.usuarios) ? [...this.usuarios] : [];
  }

  private obtenerSesionesObjetivoPaquete(): SesionUsuarioPaqueteGuardada[] {
    const usuariosObjetivo = this.obtenerUsuariosObjetivoCronometros();
    if (usuariosObjetivo.length > 0) {
      return usuariosObjetivo
        .map((u: any) => this.obtenerSesionUsuario(u.id))
        .filter((s): s is SesionUsuarioPaqueteGuardada => Boolean(s));
    }

    return Object.values(this.sesionesUsuarios || {}).filter((s): s is SesionUsuarioPaqueteGuardada => Boolean(s));
  }

  private estadoPaqueteDesdeGuardado(paquete?: PaqueteAnalistaGuardado | null): 'ACTIVO' | 'EN PROCESO' | 'FINALIZADO' | 'SIN ESTADO' {
    if (!paquete) return 'SIN ESTADO';
    if (paquete.corriendo) return 'ACTIVO';
    if (paquete.sesionFinIso || paquete.bloqueadoEdicion) return 'FINALIZADO';

    const tieneDatos = Boolean(
      paquete.sesionInicioIso ||
      paquete.tiempoAcumuladoMs ||
      paquete.segundos ||
      (paquete.idsSeleccionados || []).length ||
      Number(paquete.unidadesLoteGeneral || 0) > 0 ||
      Object.keys(paquete.registroCantidades || {}).length
    );

    return tieneDatos ? 'EN PROCESO' : 'SIN ESTADO';
  }

  estadoPaqueteGuardado(nombre: string): 'ACTIVO' | 'EN PROCESO' | 'FINALIZADO' | 'SIN ESTADO' {
    return this.estadoPaqueteDesdeGuardado(this.obtenerPaquetesGuardados()[nombre]);
  }

  claseEstadoPaqueteGuardado(nombre: string): 'status-chip-green' | 'status-chip-yellow' | 'status-chip-red' {
    const estado = this.estadoPaqueteGuardado(nombre);
    if (estado === 'ACTIVO') return 'status-chip-green';
    if (estado === 'EN PROCESO') return 'status-chip-yellow';
    return 'status-chip-red';
  }

  private aplicarEstadoLocalPaquete(paquete: PaqueteAnalistaGuardado) {
    this.sesionId = paquete.sesionId ?? null;
    this.sesionInicioIso = paquete.sesionInicioIso ?? null;
    this.sesionFinIso = paquete.sesionFinIso ?? null;
    this.sesionDuracionSegundos = Number(paquete.sesionDuracionSegundos || paquete.segundos || 0);
    this.corriendo = Boolean(paquete.corriendo);
    this.tiempoAcumuladoMs = Number(paquete.tiempoAcumuladoMs ?? ((paquete.segundos || 0) * 1000));
    this.inicioCronometroMs = paquete.inicioCronometroMs !== null && paquete.inicioCronometroMs !== undefined
      ? Number(paquete.inicioCronometroMs)
      : null;
    this.refrescarTiempoVisibleDesdeSesion();
    this.iniciarIntervaloSesion();
  }

  get estadoPaqueteActual(): 'SIN INICIAR' | 'ACTIVO' | 'EN PAUSA' | 'FINALIZADO' {
    const sesiones = this.obtenerSesionesObjetivoPaquete();
    if (!sesiones.length) return 'SIN INICIAR';
    if (sesiones.some((s) => Boolean(s.activo))) return 'ACTIVO';
    if (sesiones.some((s) => !s.activo && !s.finalizado && Boolean(s.ended_at))) return 'EN PAUSA';
    if (sesiones.every((s) => Boolean(s.finalizado))) return 'FINALIZADO';
    return 'EN PAUSA';
  }

  get estadoPaqueteMenuPrincipal(): 'SIN PAQUETE ACTIVO' | 'SIN INICIAR' | 'ACTIVO' | 'EN PAUSA' | 'FINALIZADO' {
    if (!this.paqueteAnalistaActivo) return 'SIN PAQUETE ACTIVO';
    return this.estadoPaqueteActual;
  }

  get statusOpcionesUsuariosEnVista(): Array<{ analista_id: number; nombre: string }> {
    const mapa = new Map<number, string>();
    this.statusPorAnalista.forEach((fila) => {
      if (fila.analista_id !== undefined && fila.analista_id !== null) {
        mapa.set(Number(fila.analista_id), String(fila.nombre || `Usuario ${fila.analista_id}`));
      }
    });
    return Array.from(mapa.entries())
      .map(([analista_id, nombre]) => ({ analista_id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  reiniciarPaqueteGuardado() {
    if (!this.paqueteAnalistaActivo || !this.paqueteBloqueadoEdicion) return;

    const confirmar = confirm(
      'Esto reiniciará el paquete actual para volver a hacerlo desde cero. ¿Deseas continuar?'
    );
    if (!confirmar) return;

    this.paqueteBloqueadoEdicion = false;
    this.unidadesLoteGeneralFijado = false;

    if (this.modoTrabajo === 'GENERAL') {
      this.idsSeleccionados = [];
      this.unidadesLoteGeneral = 0;
      this.modoRepartoGeneral = 'PROMEDIO';
      this.unidadesPorUsuarioGeneral = {};
      this.nombreLote = this.paqueteAnalistaNombre;
    } else {
      this.registroCantidades = this.crearMatrizVacia();
      this.nombrePaqueteEspecifico = this.paqueteAnalistaNombre;
    }

    this.limpiarIntervaloCronometro();
    this.detenerRefrescoUsuarios();
    this.segundos = 0;
    this.tiempoAcumuladoMs = 0;
    this.inicioCronometroMs = null;
    this.corriendo = false;
    this.sesionId = null;
    this.sesionInicioIso = null;
    this.sesionFinIso = null;
    this.sesionDuracionSegundos = 0;
    this.sesionesUsuarios = {};
    this.sesionesUsuariosBaseSegundos = {};
    this.guardarPaqueteActual();
    this.cdr.detectChanges();
  }

  private bloquearEdicionPaqueteActual() {
    this.paqueteBloqueadoEdicion = true;
    this.guardarPaqueteActual();
  }

  get puedeIniciarTodosCronometros(): boolean {
    if (this.paqueteBloqueadoEdicion) return false;
    const usuarios = this.obtenerUsuariosObjetivoCronometros();
    return usuarios.some((u: any) => !this.sesionUsuarioActiva(u.id) && !this.sesionUsuarioFinalizada(u.id));
  }

  get puedePausarTodosCronometros(): boolean {
    if (this.paqueteBloqueadoEdicion) return false;
    const usuarios = this.obtenerUsuariosObjetivoCronometros();
    return usuarios.some((u: any) => this.sesionUsuarioActiva(u.id) && !this.sesionUsuarioFinalizada(u.id));
  }

  get puedeFinalizarTodosCronometros(): boolean {
    if (this.paqueteBloqueadoEdicion) return false;
    const usuarios = this.obtenerUsuariosObjetivoCronometros();
    return usuarios.some((u: any) => this.sesionUsuarioActiva(u.id) && !this.sesionUsuarioFinalizada(u.id));
  }

  iniciarTodosCronometros() {
    this.ejecutarAccionCronometrosEnLote('iniciar');
  }

  pausarTodosCronometros() {
    this.ejecutarAccionCronometrosEnLote('pausar');
  }

  finalizarTodosCronometros() {
    this.ejecutarAccionCronometrosEnLote('finalizar');
  }

  private ejecutarAccionCronometrosEnLote(accion: 'iniciar' | 'pausar' | 'finalizar') {
    if (this.paqueteBloqueadoEdicion) {
      alert('El paquete ya fue guardado y está bloqueado. Pulsa REINICIAR PAQUETE para volver a hacerlo.');
      return;
    }

    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) {
      alert('Define primero el nombre del paquete.');
      return;
    }

    const usuarios = this.obtenerUsuariosObjetivoCronometros();
    if (!usuarios.length) {
      alert('No hay usuarios disponibles para ejecutar esta acción.');
      return;
    }

    const candidatos = usuarios.filter((u: any) => {
      if (accion === 'iniciar') return !this.sesionUsuarioActiva(u.id) && !this.sesionUsuarioFinalizada(u.id);
      if (accion === 'pausar') return this.sesionUsuarioActiva(u.id) && !this.sesionUsuarioFinalizada(u.id);
      return this.sesionUsuarioActiva(u.id) && !this.sesionUsuarioFinalizada(u.id);
    });

    if (!candidatos.length) {
      const label = accion === 'iniciar' ? 'iniciar' : (accion === 'pausar' ? 'pausar' : 'finalizar');
      alert(`No hay cronómetros válidos para ${label}.`);
      return;
    }

    if (accion === 'finalizar') {
      const confirmar = confirm(`¿Seguro que deseas finalizar ${candidatos.length} cronómetros al mismo tiempo?`);
      if (!confirmar) return;
    }

    let completados = 0;
    let exitosos = 0;
    let fallidos = 0;

    const cerrarLote = () => {
      this.cargarSesionesUsuarios(nombre, this.modoTrabajo);
      this.iniciarRefrescoUsuarios();
      this.cdr.detectChanges();
      const verbo = accion === 'iniciar' ? 'iniciaron' : (accion === 'pausar' ? 'pausaron' : 'finalizaron');
      if (fallidos > 0) {
        alert(`Proceso terminado: ${exitosos} cronómetros se ${verbo} y ${fallidos} fallaron.`);
      } else {
        alert(`Proceso terminado: ${exitosos} cronómetros se ${verbo} correctamente.`);
      }
    };

    candidatos.forEach((u: any) => {
      const req = accion === 'iniciar'
        ? this.iniciarSesionUsuarioRequest(u.id)
        : (accion === 'pausar' ? this.pausarSesionUsuarioRequest(u.id) : this.finalizarSesionUsuarioRequest(u.id));

      req.subscribe({
        next: (res: any) => {
          if (res?.sesion) {
            this.sesionesUsuarios = {
              ...this.sesionesUsuarios,
              [u.id]: res.sesion
            };
          }
          exitosos += 1;
          completados += 1;
          if (completados === candidatos.length) cerrarLote();
        },
        error: () => {
          fallidos += 1;
          completados += 1;
          if (completados === candidatos.length) cerrarLote();
        }
      });
    });
  }

  iniciarSesionUsuario(usuario: any) {
    if (this.paqueteBloqueadoEdicion) {
      alert('El paquete está bloqueado para edición.');
      return;
    }

    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) {
      alert('Define primero el nombre del paquete.');
      return;
    }

    this.iniciarSesionUsuarioRequest(usuario.id).subscribe({
      next: (res: any) => {
        if (res?.sesion) {
          this.sesionesUsuarios = {
            ...this.sesionesUsuarios,
            [usuario.id]: res.sesion
          };
          if (!res?.reutilizada) {
            this.sesionesUsuariosBaseSegundos = {
              ...this.sesionesUsuariosBaseSegundos,
              [usuario.id]: Number(this.sesionesUsuariosBaseSegundos?.[usuario.id] || 0)
            };
          }
          this.iniciarRefrescoUsuarios();
          this.cdr.detectChanges();
        }
      },
      error: (err: any) => {
        const mensaje = err?.error?.message || 'No se pudo iniciar la sesión del usuario.';
        alert(mensaje);
      }
    });
  }

  finalizarSesionUsuario(usuario: any) {
    if (this.paqueteBloqueadoEdicion) {
      alert('El paquete está bloqueado para edición.');
      return;
    }

    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) {
      alert('Define primero el nombre del paquete.');
      return;
    }

    const confirmar = confirm(`¿Seguro que deseas finalizar el conteo de ${usuario.nombre}?`);
    if (!confirmar) return;

    this.finalizarSesionUsuarioRequest(usuario.id).subscribe({
      next: (res: any) => {
        if (res?.sesion) {
          this.sesionesUsuarios = {
            ...this.sesionesUsuarios,
            [usuario.id]: res.sesion
          };
          this.sesionesUsuariosBaseSegundos = {
            ...this.sesionesUsuariosBaseSegundos,
            [usuario.id]: Number(this.sesionesUsuariosBaseSegundos?.[usuario.id] || 0)
          };
          this.cargarSesionesUsuarios(nombre, this.modoTrabajo);
          this.iniciarRefrescoUsuarios();
          this.cdr.detectChanges();
        }
      },
      error: () => alert('No se pudo finalizar la sesión del usuario.')
    });
  }

  pausarSesionUsuario(usuario: any) {
    if (this.paqueteBloqueadoEdicion) {
      alert('El paquete está bloqueado para edición.');
      return;
    }

    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) {
      alert('Define primero el nombre del paquete.');
      return;
    }

    this.pausarSesionUsuarioRequest(usuario.id).subscribe({
      next: (res: any) => {
        if (res?.sesion) {
          this.sesionesUsuarios = {
            ...this.sesionesUsuarios,
            [usuario.id]: res.sesion
          };
          this.cargarSesionesUsuarios(nombre, this.modoTrabajo);
          this.iniciarRefrescoUsuarios();
          this.cdr.detectChanges();
        }
      },
      error: () => alert('No se pudo pausar la sesión del usuario.')
    });
  }

  private calcularSegundosDesdePaquete(paquete: PaqueteAnalistaGuardado): number {
    const acumuladoMs = Number(paquete.tiempoAcumuladoMs ?? ((paquete.segundos || 0) * 1000));
    if (paquete.corriendo && paquete.inicioCronometroMs) {
      return Math.floor((acumuladoMs + (Date.now() - Number(paquete.inicioCronometroMs))) / 1000);
    }
    return Math.floor(acumuladoMs / 1000);
  }

  private actualizarEstadoCronometroDesdePaquete(paquete: PaqueteAnalistaGuardado) {
    this.tiempoAcumuladoMs = Number(paquete.tiempoAcumuladoMs ?? ((paquete.segundos || 0) * 1000));
    this.inicioCronometroMs = null;
    this.corriendo = false;
    this.segundos = Math.floor(this.tiempoAcumuladoMs / 1000);
  }

  private pausarCronometroActual() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.corriendo && this.inicioCronometroMs !== null) {
      this.tiempoAcumuladoMs += Date.now() - this.inicioCronometroMs;
    }
    this.inicioCronometroMs = null;
    this.corriendo = false;
    this.segundos = Math.floor(this.tiempoAcumuladoMs / 1000);
  }

  private guardarPaqueteEnLocal(nombre: string, paquete: PaqueteAnalistaGuardado) {
    const paquetes = this.obtenerPaquetesGuardados();
    paquetes[nombre] = paquete;
    this.guardarPaquetesGuardados(paquetes);
    localStorage.setItem('paqueteAnalistaActivo', nombre);
  }

  guardarPaqueteActual() {
    const paquete = this.capturarPaqueteActual();
    if (!paquete) return;

    this.guardarPaqueteEnLocal(paquete.paqueteAnalistaNombre, paquete);
  }

  abrirPaqueteGuardado(nombre: string, modoPreferido?: ModoTrabajo) {
    if (this.paqueteAnalistaNombre.trim()) {
      this.guardarPaqueteActual();
    }

    this.limpiarIntervaloCronometro();
    this.detenerRefrescoUsuarios();

    const paquete = this.obtenerPaquetesGuardados()[nombre];
    if (!paquete) return;

    const tipoRaw = ((paquete.tipoPaquete || 'ESPECIFICO') as string).toUpperCase();
    const tipo: TipoPaquete = tipoRaw === 'GENERAL' || tipoRaw === 'AMBOS' ? (tipoRaw as TipoPaquete) : 'ESPECIFICO';
    const modoRaw = ((paquete.modoTrabajo || '') as string).toUpperCase();
    const modoGuardado: ModoTrabajo = modoRaw === 'GENERAL' ? 'GENERAL' : 'ESPECIFICO';
    const modoInicial: ModoTrabajo = tipo === 'AMBOS'
      ? (modoPreferido || modoGuardado)
      : (tipo as ModoTrabajo);

    this.paqueteAnalistaNombre = paquete.paqueteAnalistaNombre;
    this.paqueteAnalistaCantidadPromos = paquete.paqueteAnalistaCantidadPromos;
    this.nombreLote = paquete.nombreLote || paquete.paqueteAnalistaNombre;
    this.nombrePaqueteEspecifico = paquete.nombrePaqueteEspecifico || paquete.paqueteAnalistaNombre;
    this.modoTrabajo = modoInicial;
    this.nuevoPaqueteTipo = tipo;
    this.modoRepartoGeneral = paquete.modoRepartoGeneral === 'MANUAL' ? 'MANUAL' : 'PROMEDIO';
    this.idsSeleccionados = [...(paquete.idsSeleccionados || [])];
    this.unidadesLoteGeneral = paquete.unidadesLoteGeneral || 0;
    this.unidadesPorUsuarioGeneral = { ...(paquete.unidadesPorUsuarioGeneral || {}) };
    this.unidadesLoteGeneralFijado = Boolean(paquete.unidadesLoteGeneralFijado ?? (this.unidadesLoteGeneral > 0));
    this.registroCantidades = JSON.parse(JSON.stringify(paquete.registroCantidades || this.crearMatrizVacia()));
    this.paqueteBloqueadoEdicion = Boolean(paquete.bloqueadoEdicion);
    this.paqueteAnalistaActivo = true;
    this.cargarSesionPaquete(nombre, this.modoTrabajo, paquete);
    this.cargarSesionesUsuarios(nombre, this.modoTrabajo);
    this.cdr.detectChanges();
    localStorage.setItem('paqueteAnalistaActivo', nombre);
  }

  abrirPaqueteGuardadoEnModo(nombre: string, modo: ModoTrabajo) {
    this.abrirPaqueteGuardado(nombre, modo);
  }

  cambiarModoTrabajo(modo: ModoTrabajo) {
    if (this.paqueteAnalistaActivo && this.nuevoPaqueteTipo !== 'AMBOS' && this.nuevoPaqueteTipo !== modo) {
      alert(`Este paquete es de tipo ${this.nuevoPaqueteTipo}.`);
      return;
    }

    if (this.paqueteAnalistaActivo && this.nuevoPaqueteTipo === 'AMBOS' && this.modoTrabajo !== modo) {
      alert('Este paquete AMBOS trabaja en un solo flujo activo. Usa Volver y ábrelo desde la columna del modo que quieres usar.');
      return;
    }

    if (this.modoTrabajo === modo) return;
    this.modoTrabajo = modo;

    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) {
      this.sesionesUsuarios = {};
      this.sesionesUsuariosBaseSegundos = {};
      return;
    }

    this.cargarSesionPaquete(nombre, this.modoTrabajo, this.paqueteGuardado(nombre) || undefined);
    this.cargarSesionesUsuarios(nombre, this.modoTrabajo);
    this.guardarPaqueteActual();
  }

  seleccionarPaqueteAdmin(nombre: string) {
    const paquete = (nombre || '').trim();
    if (!paquete) return;
    localStorage.setItem('paqueteAnalistaActivo', paquete);
    this.abrirPaqueteGuardado(paquete);
    alert(`Paquete ${paquete} seleccionado como activo.`);
  }

  iniciarEdicionPaquete(nombre: string) {
    this.paqueteEditandoOriginal = nombre;
    this.paqueteEditandoNombre = nombre;
    this.paqueteEditandoTipo = this.tipoPaqueteDe(nombre);
  }

  cancelarEdicionPaquete() {
    this.paqueteEditandoOriginal = null;
    this.paqueteEditandoNombre = '';
    this.paqueteEditandoTipo = 'ESPECIFICO';
  }

  guardarEdicionPaquete() {
    const original = (this.paqueteEditandoOriginal || '').trim();
    const nuevo = (this.paqueteEditandoNombre || '').trim();
    if (!original) return;
    if (!nuevo) {
      alert('El nombre del paquete no puede estar vacío.');
      return;
    }

    const paquetes = this.obtenerPaquetesGuardados();
    if (!paquetes[original]) {
      this.cancelarEdicionPaquete();
      return;
    }

    if (original !== nuevo && paquetes[nuevo]) {
      alert('Ya existe un paquete con ese nombre.');
      return;
    }

    const tipo = this.paqueteEditandoTipo;
    const modoPrevio: ModoTrabajo = paquetes[original]?.modoTrabajo === 'GENERAL' ? 'GENERAL' : 'ESPECIFICO';
    const data = {
      ...paquetes[original],
      paqueteAnalistaNombre: nuevo,
      nombreLote: nuevo,
      nombrePaqueteEspecifico: nuevo,
      tipoPaquete: tipo,
      modoTrabajo: tipo === 'AMBOS' ? modoPrevio : (tipo as ModoTrabajo)
    };
    delete paquetes[original];
    paquetes[nuevo] = data;
    this.guardarPaquetesGuardados(paquetes);

    if (localStorage.getItem('paqueteAnalistaActivo') === original) {
      localStorage.setItem('paqueteAnalistaActivo', nuevo);
    }

    if (this.paqueteAnalistaNombre === original) {
      this.paqueteAnalistaNombre = nuevo;
      this.nombreLote = nuevo;
      this.nombrePaqueteEspecifico = nuevo;
      this.nuevoPaqueteTipo = tipo;
      this.modoTrabajo = tipo === 'AMBOS' ? modoPrevio : (tipo as ModoTrabajo);
      this.cargarSesionPaquete(nuevo, this.modoTrabajo, paquetes[nuevo]);
      this.cargarSesionesUsuarios(nuevo, this.modoTrabajo);
      this.guardarPaqueteActual();
    }

    this.cancelarEdicionPaquete();
  }

  eliminarPaqueteAdmin(nombre: string) {
    const paquete = (nombre || '').trim();
    if (!paquete) return;

    const confirmado = confirm(`¿Eliminar el paquete ${paquete}?`);
    if (!confirmado) return;

    this.http.delete(`${this.baseUrl}/paquetes/${encodeURIComponent(paquete)}`, this.adminRequestOptions()).subscribe({
      next: (res: any) => {
        const aliasEliminados = Array.isArray(res?.alias_eliminados) ? res.alias_eliminados : [paquete];
        const paquetes = this.obtenerPaquetesGuardados();
        aliasEliminados.forEach((alias: string) => {
          if (paquetes[alias]) delete paquetes[alias];
        });
        this.guardarPaquetesGuardados(paquetes);

        if (aliasEliminados.includes(localStorage.getItem('paqueteAnalistaActivo') || '')) {
          localStorage.removeItem('paqueteAnalistaActivo');
        }

        if (aliasEliminados.includes(this.paqueteAnalistaNombre)) {
          this.limpiarPaqueteAnalista();
        }

        if (this.rolActual === 'dashboard') {
          this.cargarStatusOpciones();
          this.cargarStatusResumen();
        }
      },
      error: (err: any) => {
        if (this.manejarNoAutorizadoAdmin(err)) return;
        alert(err?.error?.message || 'No se pudo eliminar el paquete en base de datos.');
      }
    });
  }

  restaurarPaqueteActivo() {
    const nombreActivo = localStorage.getItem('paqueteAnalistaActivo');
    if (nombreActivo && this.obtenerPaquetesGuardados()[nombreActivo]) {
      this.abrirPaqueteGuardado(nombreActivo);
    }
  }

  // --- LÓGICA MODO GENERAL PLURAL ---
  toggleSeleccionAnalista(id: number) {
    if (this.paqueteBloqueadoEdicion) return;
    const index = this.idsSeleccionados.indexOf(id);
    if (index > -1) this.idsSeleccionados.splice(index, 1);
    else this.idsSeleccionados.push(id);

    if (this.modoRepartoGeneral === 'PROMEDIO') {
      this.recalcularRepartoPromedio();
    }

    if (!this.idsSeleccionados.includes(id)) {
      delete this.unidadesPorUsuarioGeneral[id];
    } else if (this.unidadesPorUsuarioGeneral[id] === undefined) {
      this.unidadesPorUsuarioGeneral[id] = 0;
    }

    this.guardarPaqueteActual();
  }

  get usuariosSeleccionadosGeneral(): any[] {
    return this.usuarios.filter((u: any) => this.idsSeleccionados.includes(u.id));
  }

  get totalAsignadoGeneral(): number {
    return this.idsSeleccionados.reduce((acc, id) => acc + Number(this.unidadesPorUsuarioGeneral[id] || 0), 0);
  }

  get promocionesRestantesGeneral(): number {
    return Math.max(0, Number(this.unidadesLoteGeneral || 0) - this.totalAsignadoGeneral);
  }

  get totalPromocionesGeneralFijado(): boolean {
    return this.unidadesLoteGeneralFijado && Number(this.unidadesLoteGeneral || 0) > 0;
  }

  toggleTotalPromocionesGeneralFijado() {
    if (this.paqueteBloqueadoEdicion) return;
    if (!Number(this.unidadesLoteGeneral || 0)) return;
    this.unidadesLoteGeneralFijado = !this.unidadesLoteGeneralFijado;
    this.guardarPaqueteActual();
  }

  get pasoGeneralParticipantesHabilitado(): boolean {
    return Number(this.unidadesLoteGeneral || 0) > 0;
  }

  get pasoGeneralRepartoHabilitado(): boolean {
    return this.pasoGeneralParticipantesHabilitado && this.idsSeleccionados.length > 0;
  }

  get estadoComparativoGeneral(): Array<{ id: number; nombre: string; promos: number; meta: number; real: number; delta: number }> {
    return this.usuariosSeleccionadosGeneral.map((u: any) => {
      const promos = Number(this.unidadesPorUsuarioGeneral[u.id] || 0);
      const meta = promos * Number(u?.tiempo_general || 0);
      const real = this.obtenerSegundosSesionUsuario(u.id) / 60;
      const delta = real - meta;
      return { id: u.id, nombre: u.nombre, promos, meta, real, delta };
    });
  }

  setModoRepartoGeneral(modo: 'PROMEDIO' | 'MANUAL') {
    if (this.paqueteBloqueadoEdicion) return;
    this.modoRepartoGeneral = modo;
    if (modo === 'PROMEDIO') {
      this.recalcularRepartoPromedio();
    } else {
      this.idsSeleccionados.forEach((id) => {
        if (this.unidadesPorUsuarioGeneral[id] === undefined) {
          this.unidadesPorUsuarioGeneral[id] = 0;
        }
      });
    }

    this.guardarPaqueteActual();
  }

  onUnidadesTotalesGeneralChange() {
    if (this.paqueteBloqueadoEdicion) return;
    let total = Number(this.unidadesLoteGeneral || 0);
    if (!Number.isFinite(total) || total < 0) total = 0;
    total = Math.floor(total);
    this.unidadesLoteGeneral = total;

    if (this.modoRepartoGeneral === 'PROMEDIO') {
      this.recalcularRepartoPromedio();
    } else {
      const total = this.totalAsignadoGeneral;
      if (total > this.unidadesLoteGeneral) {
        let exceso = total - this.unidadesLoteGeneral;
        [...this.idsSeleccionados].reverse().forEach((id) => {
          if (exceso <= 0) return;
          const actual = Number(this.unidadesPorUsuarioGeneral[id] || 0);
          const bajar = Math.min(actual, exceso);
          this.unidadesPorUsuarioGeneral[id] = actual - bajar;
          exceso -= bajar;
        });
      }
    }

    this.guardarPaqueteActual();
  }

  onUnidadesUsuarioGeneralChange(usuarioId: number) {
    if (this.paqueteBloqueadoEdicion) return;
    let valor = Number(this.unidadesPorUsuarioGeneral[usuarioId] || 0);
    if (!Number.isFinite(valor) || valor < 0) valor = 0;
    valor = Math.floor(valor);
    this.unidadesPorUsuarioGeneral[usuarioId] = valor;

    if (this.modoRepartoGeneral !== 'MANUAL') return;

    const total = this.totalAsignadoGeneral;
    if (total > this.unidadesLoteGeneral) {
      const exceso = total - this.unidadesLoteGeneral;
      this.unidadesPorUsuarioGeneral[usuarioId] = Math.max(0, valor - exceso);
    }

    this.guardarPaqueteActual();
  }

  private recalcularRepartoPromedio() {
    const cantidad = this.idsSeleccionados.length;
    this.unidadesPorUsuarioGeneral = { ...this.unidadesPorUsuarioGeneral };

    if (cantidad === 0) return;

    const total = Math.max(0, Math.floor(Number(this.unidadesLoteGeneral || 0)));
    const base = Math.floor(total / cantidad);
    const resto = total % cantidad;

    this.idsSeleccionados.forEach((id, index) => {
      this.unidadesPorUsuarioGeneral[id] = base + (index < resto ? 1 : 0);
    });
  }

  get metaGeneralPlural(): number {
    if (this.idsSeleccionados.length === 0) return 0;
    return this.idsSeleccionados.reduce((acc, id) => {
      const u = this.usuarios?.find(user => user.id === id);
      const unidades = Number(this.unidadesPorUsuarioGeneral[id] || 0);
      return acc + (unidades * Number(u?.tiempo_general || 5.0));
    }, 0);
  }

  get flujoCronometrosGeneralCompleto(): boolean {
    if (!Array.isArray(this.idsSeleccionados) || this.idsSeleccionados.length === 0) return false;
    return this.idsSeleccionados.every((id) => {
      const sesion = this.obtenerSesionUsuario(id);
      return Boolean(sesion?.started_at) && Boolean(sesion?.ended_at) && Boolean(sesion?.finalizado);
    });
  }

  private calcularRendimientoConSigno(metaMin: number, realMin: number): number {
    const meta = Number(metaMin || 0);
    const real = Number(realMin || 0);
    if (real <= 0) return meta > 0 ? 100 : 0;
    return ((meta - real) / real) * 100;
  }

  iniciarSesionPaquete() {
    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) {
      alert('Define el nombre del paquete antes de iniciar la sesión.');
      return;
    }

    this.iniciarSesionBackend(nombre).subscribe({
      next: (res: any) => {
        this.paqueteAnalistaActivo = true;
        this.aplicarSesionRespuesta(res?.sesion || null);
        this.guardarPaqueteActual();
        this.cdr.detectChanges();
      },
      error: () => alert('No se pudo iniciar la sesión del paquete.')
    });
  }

  finalizarSesionPaquete() {
    const nombre = this.paqueteAnalistaNombre.trim();
    if (!nombre) {
      alert('Define el nombre del paquete antes de finalizar la sesión.');
      return;
    }

    const confirmar = confirm(`¿Seguro que deseas finalizar el conteo del paquete ${nombre}?`);
    if (!confirmar) return;

    this.finalizarSesionBackend(nombre).subscribe({
      next: (res: any) => {
        this.aplicarSesionRespuesta(res?.sesion || null);
        this.guardarPaqueteActual();
        this.cdr.detectChanges();
      },
      error: () => alert('No se pudo finalizar la sesión del paquete.')
    });
  }

  activarPaqueteAnalista() {
    const nombre = this.paqueteAnalistaNombre.trim();

    if (!nombre) {
      alert('Debes ingresar el nombre del paquete antes de continuar.');
      return;
    }

    this.modoTrabajo = this.nuevoPaqueteTipo === 'GENERAL' ? 'GENERAL' : 'ESPECIFICO';
    this.nombreLote = nombre;
    this.nombrePaqueteEspecifico = nombre;
    this.modoRepartoGeneral = 'PROMEDIO';
    this.unidadesPorUsuarioGeneral = {};
    if (this.paqueteAnalistaCantidadPromos !== null && this.paqueteAnalistaCantidadPromos <= 0) {
      this.paqueteAnalistaCantidadPromos = null;
    }
    this.paqueteAnalistaActivo = true;
    if (!Object.keys(this.registroCantidades || {}).length) {
      this.registroCantidades = this.crearMatrizVacia();
    }
    this.limpiarIntervaloCronometro();
    this.detenerRefrescoUsuarios();
    this.corriendo = false;
    this.tiempoAcumuladoMs = 0;
    this.inicioCronometroMs = null;
    this.sesionId = null;
    this.sesionInicioIso = null;
    this.sesionFinIso = null;
    this.sesionDuracionSegundos = 0;
    this.sesionesUsuarios = {};
    this.sesionesUsuariosBaseSegundos = {};
    this.paqueteBloqueadoEdicion = false;
    this.unidadesLoteGeneralFijado = false;
    this.guardarPaqueteActual();
  }

  limpiarPaqueteAnalista() {
    this.guardarPaqueteActual();
    this.limpiarIntervaloCronometro();
    this.detenerRefrescoUsuarios();
    this.paqueteAnalistaNombre = '';
    this.paqueteAnalistaCantidadPromos = null;
    this.nuevoPaqueteTipo = 'ESPECIFICO';
    this.paqueteAnalistaActivo = false;
    this.nombreLote = '';
    this.nombrePaqueteEspecifico = '';
    this.modoTrabajo = 'ESPECIFICO';
    this.idsSeleccionados = [];
    this.modoRepartoGeneral = 'PROMEDIO';
    this.unidadesPorUsuarioGeneral = {};
    this.unidadesLoteGeneral = 0;
    this.unidadesLoteGeneralFijado = false;
    this.segundos = 0;
    this.tiempoAcumuladoMs = 0;
    this.inicioCronometroMs = null;
    this.corriendo = false;
    this.sesionId = null;
    this.sesionInicioIso = null;
    this.sesionFinIso = null;
    this.sesionDuracionSegundos = 0;
    this.sesionesUsuarios = {};
    this.sesionesUsuariosBaseSegundos = {};
    this.paqueteBloqueadoEdicion = false;
    this.registroCantidades = this.crearMatrizVacia();
    localStorage.removeItem('paqueteAnalistaActivo');
  }

  volverASeleccionPaquetes() {
    this.limpiarPaqueteAnalista();
  }

  finalizarLoteGeneral() {
    if (this.paqueteBloqueadoEdicion) {
      alert('El paquete ya está guardado y bloqueado. Usa REINICIAR PAQUETE para volver a hacerlo.');
      return;
    }

    if (!this.paqueteAnalistaActivo || !this.nombreLote.trim()) {
      alert('Ingresa el nombre del paquete general antes de guardar.');
      return;
    }

    if (this.idsSeleccionados.length === 0) {
      alert('Selecciona al menos un analista para guardar el lote.');
      return;
    }

    if (!this.flujoCronometrosGeneralCompleto) {
      alert('Para guardar el lote, cada analista seleccionado debe completar el flujo: INICIAR y luego FINALIZAR su cronómetro.');
      return;
    }

    const totalDeclarado = Number(this.unidadesLoteGeneral || 0);
    let totalParaGuardar = totalDeclarado;

    if (this.totalAsignadoGeneral !== totalDeclarado) {
      const confirmarAjuste = confirm(
        `El reparto asignado (${this.totalAsignadoGeneral}) no coincide con el total declarado (${totalDeclarado}).\n\n` +
        '¿Deseas guardar el lote usando el total asignado actual?'
      );
      if (!confirmarAjuste) return;

      totalParaGuardar = this.totalAsignadoGeneral;
      this.unidadesLoteGeneral = totalParaGuardar;
      if (totalParaGuardar > 0) {
        this.unidadesLoteGeneralFijado = true;
      }
    }

    const tiemposRealesPorUsuario: any = {};
    const tiemposMetaPorUsuario: any = {};
    const unidadesPorUsuario: any = {};

    this.idsSeleccionados.forEach((id) => {
      const usuario = this.usuarios.find((u: any) => u.id === id);
      const unidades = Number(this.unidadesPorUsuarioGeneral[id] || 0);
      unidadesPorUsuario[id] = unidades;
      tiemposMetaPorUsuario[id] = unidades * Number(usuario?.tiempo_general || 0);
      tiemposRealesPorUsuario[id] = this.obtenerSegundosSesionUsuario(id) / 60;
    });

    const tiempoRealTotalMin = this.idsSeleccionados.reduce((acc, id) => acc + (tiemposRealesPorUsuario[id] || 0), 0);

    const data = {
      analista_ids: this.idsSeleccionados,
      nombre_paquete: this.nombreLote,
      modo: 'GENERAL',
      unidades_general: totalParaGuardar,
      tiempo_meta: this.metaGeneralPlural,
      tiempo_real: tiempoRealTotalMin,
      unidades_por_usuario: unidadesPorUsuario,
      tiempos_meta_por_usuario: tiemposMetaPorUsuario,
      tiempos_reales_por_usuario: tiemposRealesPorUsuario
    };
    this.http.post(`${this.baseUrl}/guardar-reporte-plural`, data).subscribe((res: any) => {
      alert(`Guardado con éxito. Rendimiento Grupal: ${res.rendimiento}%`);
      this.bloquearEdicionPaqueteActual();
    });
  }

  guardarMatrizEspecifica() {
    if (this.paqueteBloqueadoEdicion) {
      alert('El paquete ya está guardado y bloqueado. Usa REINICIAR PAQUETE para volver a hacerlo.');
      return;
    }

    if (!this.paqueteAnalistaActivo || !this.nombrePaqueteEspecifico.trim()) {
      alert('Ingresa el nombre del paquete específico antes de guardar.');
      return;
    }

    const usuariosPayload = this.usuarios.map((u: any) => ({
      analista_id: u.id,
      tiempo_meta: this.calcularTiempoUsuario(u),
      tiempo_real: this.obtenerSegundosSesionUsuario(u.id) / 60,
      rendimiento: Math.round(this.calcularRendimientoConSigno(this.calcularTiempoUsuario(u), this.obtenerSegundosSesionUsuario(u.id) / 60) * 100) / 100,
      detalle_especifico: this.configuracionPromos.map((p: any) => ({
        promocion_id: p.id,
        promocion: p.nombre,
        cantidad: Number(this.registroCantidades[u.id]?.[p.id] || 0),
        minutos_unitarios: Number(u?.config_tiempos?.[p.id] || 0),
        tiempo_total: this.calcularTiempoPromo(u.id, p)
      }))
    }));

    this.http.post(`${this.baseUrl}/guardar-reporte-especifico`, {
      nombre_paquete: this.nombrePaqueteEspecifico,
      usuarios: usuariosPayload
    }).subscribe(() => {
      alert('Paquete específico guardado correctamente.');
      this.bloquearEdicionPaqueteActual();
    });
  }

  resetLote() {
    this.idsSeleccionados = [];
    this.modoRepartoGeneral = 'PROMEDIO';
    this.unidadesPorUsuarioGeneral = {};
    this.unidadesLoteGeneral = 0;
    this.unidadesLoteGeneralFijado = false;
    this.nombreLote = '';
    this.segundos = 0;
    this.tiempoAcumuladoMs = 0;
    this.inicioCronometroMs = null;
    this.limpiarIntervaloCronometro();
    this.guardarPaqueteActual();
  }

  // --- LÓGICA ORIGINAL (MATRIZ) ---
  calcularTiempoPromo(uId: number, p: any): number {
    const cant = Number(this.registroCantidades[uId]?.[p.id] || 0);
    const u = this.usuarios?.find(user => user.id === uId);
    return cant * Number(u?.config_tiempos?.[p.id] || 0);
  }

  calcularTiempoUsuario(u: any): number {
    return this.configuracionPromos.reduce((acc, p) => acc + this.calcularTiempoPromo(u.id, p), 0);
  }

  get sumaGeneralGlobal(): number {
    return this.usuarios?.reduce((acc, u) => acc + this.calcularTiempoUsuario(u), 0) || 0;
  }

  // --- ADMIN & OTROS ---
  setRol(rol: any) { 
    if (rol === 'admin') {
      this.rolActual = 'admin';
      localStorage.setItem('rolActual', 'admin');
      this.cdr.detectChanges();
      return;
    }

    this.rolActual = rol;
    localStorage.setItem('rolActual', rol);
    if (rol === 'dashboard') {
      this.cargarStatusOpciones();
      this.cargarStatusResumen();
      setTimeout(() => this.renderGrafico(), 100);
    }
  }

  cargarStatusOpciones() {
    this.http.get(`${this.baseUrl}/status/opciones`).subscribe({
      next: (res: any) => {
        const opcionesBackend = Array.isArray(res?.paquetes) ? res.paquetes : [];
        const paquetesLocales = this.obtenerPaquetesGuardados();
        const mapa = new Map<string, StatusPaqueteOpcion>();

        opcionesBackend.forEach((p: any) => {
          if (p?.nombre) {
            mapa.set(p.nombre, {
              nombre: p.nombre,
              fecha_creacion: p.fecha_creacion || null,
              estado_paquete: p.estado_paquete || 'FINALIZADO'
            });
          }
        });

        Object.values(paquetesLocales).forEach((paquete) => {
          const nombre = paquete.paqueteAnalistaNombre;
          if (!nombre) return;
          mapa.set(nombre, {
            nombre,
            fecha_creacion: paquete.sesionInicioIso || paquete.sesionFinIso || mapa.get(nombre)?.fecha_creacion || null,
            estado_paquete: this.estadoPaqueteDesdeGuardado(paquete)
          });
        });

        this.statusOpcionesPaquetes = Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
        if (!this.statusSeleccionarTodos) {
          const disponibles = new Set(this.statusOpcionesPaquetes.map((p) => p.nombre));
          this.statusPaquetesSeleccionados = this.statusPaquetesSeleccionados.filter((p) => disponibles.has(p));
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.statusOpcionesPaquetes = [];
        this.cdr.detectChanges();
      }
    });
  }

  toggleStatusPaquete(paquete: string) {
    if (this.statusSeleccionarTodos) {
      this.statusSeleccionarTodos = false;
      this.statusTipoEstadistica = 'PAQUETE';
      this.statusPaquetesSeleccionados = [];
    }

    const idx = this.statusPaquetesSeleccionados.indexOf(paquete);
    if (idx >= 0) {
      this.statusPaquetesSeleccionados.splice(idx, 1);
    } else {
      this.statusPaquetesSeleccionados.push(paquete);
    }
    this.statusUsuarioIndividualId = null;
  }

  toggleStatusPaquetesPanel() {
    if (this.statusTipoEstadistica !== 'PAQUETE') return;
    this.statusPaquetesDesplegado = !this.statusPaquetesDesplegado;
  }

  seleccionarStatusPaquete(paquete: string) {
    const nombre = (paquete || '').trim();
    if (!nombre) return;
    this.statusSeleccionarTodos = false;
    this.statusTipoEstadistica = 'PAQUETE';
    this.statusPaquetesSeleccionados = [nombre];
    this.statusUsuarioIndividualId = null;
    this.statusPaquetesDesplegado = false;
    this.cargarStatusResumen();
  }

  setStatusTodosPaquetes(valor: boolean) {
    this.statusSeleccionarTodos = valor;
    this.statusTipoEstadistica = valor ? 'TODO' : 'PAQUETE';
    if (valor) {
      this.statusPaquetesSeleccionados = [];
      this.statusPaquetesDesplegado = false;
    } else {
      this.statusPaquetesDesplegado = true;
    }
    this.statusUsuarioIndividualId = null;
  }

  setStatusTipoEstadistica(tipo: 'TODO' | 'PAQUETE') {
    this.statusTipoEstadistica = tipo;
    this.onStatusTipoEstadisticaChange();
    this.cargarStatusResumen();
  }

  onStatusTipoEstadisticaChange() {
    const esTodo = this.statusTipoEstadistica === 'TODO';
    this.statusSeleccionarTodos = esTodo;
    if (esTodo) {
      this.statusPaquetesSeleccionados = [];
      this.statusUsuarioIndividualId = null;
      this.statusPaquetesDesplegado = false;
      return;
    }

    this.statusPaquetesDesplegado = false;
    this.statusPaquetesSeleccionados = [];
    this.statusUsuarioIndividualId = null;
  }

  get statusPaqueteSeleccionado(): string | null {
    return this.statusPaquetesSeleccionados.length ? this.statusPaquetesSeleccionados[0] : null;
  }

  get statusPaquetesBasicosVista(): StatusPaqueteBasico[] {
    const mapa = new Map<string, StatusPaqueteBasico>();

    this.statusOpcionesPaquetes.forEach((p) => {
      mapa.set(p.nombre, {
        nombre: p.nombre,
        fecha_creacion: p.fecha_creacion || null,
        estado_paquete: p.estado_paquete || 'SIN ESTADO',
        meta_total: 0,
        real_total: 0,
        rendimiento: 0
      });
    });

    this.statusPorPaquete.forEach((fila) => {
      const nombre = (fila.nombre_paquete || '').trim();
      if (!nombre) return;

      const base = mapa.get(nombre) || {
        nombre,
        fecha_creacion: fila.fecha_creacion || null,
        estado_paquete: fila.estado_paquete || 'SIN ESTADO',
        meta_total: 0,
        real_total: 0,
        rendimiento: 0
      };

      base.meta_total += Number(fila.meta_total || 0);
      base.real_total += Number(fila.real_total || 0);
      base.estado_paquete = fila.estado_paquete || base.estado_paquete;
      base.fecha_creacion = base.fecha_creacion || fila.fecha_creacion || null;
      mapa.set(nombre, base);
    });

    return Array.from(mapa.values())
      .map((item) => {
        const rendimiento = item.real_total > 0 ? ((item.meta_total - item.real_total) / item.real_total) * 100 : 0;
        return {
          ...item,
          meta_total: Math.round(item.meta_total * 100) / 100,
          real_total: Math.round(item.real_total * 100) / 100,
          rendimiento: Math.round(rendimiento * 100) / 100
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  get statusFilasPaqueteSeleccionado(): StatusFila[] {
    const seleccionado = this.statusPaqueteSeleccionado;
    if (!seleccionado) return [];
    return this.statusPorPaquete.filter((fila) => (fila.nombre_paquete || '').trim() === seleccionado);
  }

  get puedeFiltrarUsuarioIndividualStatus(): boolean {
    return !this.statusSeleccionarTodos && this.statusPaquetesSeleccionados.length === 1;
  }

  get statusPorAnalistaVista(): StatusFila[] {
    if (!this.puedeFiltrarUsuarioIndividualStatus || !this.statusUsuarioIndividualId) {
      return this.statusPorAnalista;
    }
    return this.statusPorAnalista.filter((fila) => Number(fila.analista_id) === Number(this.statusUsuarioIndividualId));
  }

  cargarStatusResumen() {
    this.statusCargando = true;
    this.cdr.detectChanges();

    const paquetesParam = this.statusSeleccionarTodos
      ? 'ALL'
      : (this.statusPaquetesSeleccionados.length ? this.statusPaquetesSeleccionados.join(',') : 'ALL');

    const params: any = {
      paquetes: paquetesParam,
      modo: this.statusFiltroModo
    };

    if (this.puedeFiltrarUsuarioIndividualStatus && this.statusUsuarioIndividualId !== null) {
      params.analista_id = this.statusUsuarioIndividualId;
    }

    if ((this.statusFiltroNombre || '').trim()) params.nombre = this.statusFiltroNombre.trim();
    if (this.statusFechaDesde) params.desde = this.statusFechaDesde;
    if (this.statusFechaHasta) params.hasta = this.statusFechaHasta;

    this.http.get(`${this.baseUrl}/status/resumen`, { params }).subscribe({
      next: (res: any) => {
        this.statusResumenGlobal = res?.resumen_global || null;
        const filasBackend = Array.isArray(res?.por_paquete) ? res.por_paquete : [];
        const mapaFilas = new Map<string, StatusFila>();

        filasBackend.forEach((fila: StatusFila) => {
          const clave = `${fila.nombre_paquete || ''}__${fila.modo || ''}`;
          mapaFilas.set(clave, fila);
        });

        Object.values(this.obtenerPaquetesGuardados()).forEach((paquete) => {
          const nombre = paquete.paqueteAnalistaNombre;
          if (!nombre) return;
          const modo = paquete.modoTrabajo || this.modoTrabajo;
          const clave = `${nombre}__${modo}`;
          const existente = mapaFilas.get(clave);
          const estado = this.estadoPaqueteDesdeGuardado(paquete);

          if (existente) {
            existente.estado_paquete = estado;
            existente.fecha_creacion = existente.fecha_creacion || paquete.sesionInicioIso || paquete.sesionFinIso || null;
          } else {
            mapaFilas.set(clave, {
              nombre_paquete: nombre,
              modo,
              fecha_creacion: paquete.sesionInicioIso || paquete.sesionFinIso || null,
              fecha_ultima: paquete.sesionFinIso || paquete.sesionInicioIso || null,
              estado_paquete: estado,
              registros: 0,
              meta_total: 0,
              real_total: 0,
              desviacion_total: 0,
              rendimiento: 0,
              semaforo: estado === 'ACTIVO' ? 'VERDE' : (estado === 'EN PROCESO' ? 'AMARILLO' : 'ROJO')
            });
          }
        });

        this.statusPorPaquete = Array.from(mapaFilas.values());
        this.statusPorAnalista = Array.isArray(res?.por_analista) ? res.por_analista : [];
        if (this.statusUsuarioIndividualId !== null) {
          const existe = this.statusPorAnalista.some((fila) => Number(fila.analista_id) === Number(this.statusUsuarioIndividualId));
          if (!existe) {
            this.statusUsuarioIndividualId = null;
          }
        }
        this.statusCargando = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.statusResumenGlobal = null;
        this.statusPorPaquete = [];
        this.statusPorAnalista = [];
        this.statusCargando = false;
        this.cdr.detectChanges();
      }
    });
  }

  validarYGuardarTiempo(u: any, pId: number) {
    this.http.post(`${this.baseUrl}/configurar-tiempo`, { 
      usuario_id: u.id, promocion_id: pId, minutos: u.config_tiempos[pId] 
    }, this.adminRequestOptions()).subscribe({
      error: (err: any) => {
        this.manejarNoAutorizadoAdmin(err);
      }
    });
  }

  validarYGuardarTiempoGeneral(u: any) {
    this.http.post(`${this.baseUrl}/configurar-tiempo-general`, {
      usuario_id: u.id,
      minutos: u.tiempo_general
    }, this.adminRequestOptions()).subscribe({
      error: (err: any) => {
        this.manejarNoAutorizadoAdmin(err);
      }
    });
  }

  iniciarEdicionUsuario(u: any) {
    this.usuarioEditando = {
      id: u.id,
      nombre: u.nombre,
      tiempo_general: u.tiempo_general
    };
  }

  cancelarEdicionUsuario() {
    this.usuarioEditando = null;
  }

  guardarEdicionUsuario() {
    if (!this.usuarioEditando) return;

    this.http.put(`${this.baseUrl}/usuarios/${this.usuarioEditando.id}`, {
      nombre: this.usuarioEditando.nombre,
      tiempo_general: this.usuarioEditando.tiempo_general
    }, this.adminRequestOptions()).subscribe({
      next: () => {
        this.usuarioEditando = null;
        this.cargarDatos();
      },
      error: (err: any) => {
        if (this.manejarNoAutorizadoAdmin(err)) return;
        alert(err?.error?.message || 'No se pudo guardar la edición del usuario.');
      }
    });
  }

  eliminarUsuario(u: any) {
    const confirmado = confirm(`¿Eliminar a ${u.nombre}? Esta acción también quitará sus reportes.`);
    if (!confirmado) return;

    this.http.delete(`${this.baseUrl}/usuarios/${u.id}`, this.adminRequestOptions()).subscribe({
      next: () => {
        this.idsSeleccionados = this.idsSeleccionados.filter((id) => id !== u.id);
        delete this.unidadesPorUsuarioGeneral[u.id];
        delete this.sesionesUsuarios[u.id];
        delete this.sesionesUsuariosBaseSegundos[u.id];

      if (this.usuarioEditando?.id === u.id) {
        this.usuarioEditando = null;
      }
      this.cargarDatos();
      if (this.rolActual === 'dashboard') {
        this.cargarStatusOpciones();
        this.cargarStatusResumen();
      }
      },
      error: (err: any) => {
        if (this.manejarNoAutorizadoAdmin(err)) return;
        alert(err?.error?.message || 'No se pudo eliminar el usuario en base de datos.');
      }
    });
  }

  agregarUsuario() {
    this.http.post(`${this.baseUrl}/usuarios`, { nombre: this.nuevoUsuario }, this.adminRequestOptions()).subscribe({
      next: () => {
        this.nuevoUsuario = '';
        this.cargarDatos();
      },
      error: (err: any) => {
        if (this.manejarNoAutorizadoAdmin(err)) return;
        alert(err?.error?.message || 'No se pudo crear el usuario.');
      }
    });
  }

  guardarDatos() {
    localStorage.setItem('registroPromos', JSON.stringify(this.registroCantidades));
    this.guardarPaqueteActual();
  }
  toggleUsuario(id: number) { this.usuariosAbiertos[id] = !this.usuariosAbiertos[id]; }
  objectKeys(obj: any) { return Object.keys(obj); }
  formatearCrono(s: number) { return new Date(s * 1000).toISOString().substr(11, 8); }

  get promosAgrupadas() {
    const grupos: any = {};
    this.configuracionPromos.forEach(p => {
      if (!grupos[p.categoria]) grupos[p.categoria] = [];
      grupos[p.categoria].push(p);
    });
    return grupos;
  }

  renderGrafico() {
    if (this.chart) this.chart.destroy();
    this.chart = new Chart(this.canvas.nativeElement, {
      type: 'bar',
      data: {
        labels: this.usuarios?.map(u => u.nombre),
        datasets: [{ label: 'Minutos Totales', data: this.usuarios?.map(u => this.calcularTiempoUsuario(u)), backgroundColor: '#3498db' }]
      }
    });
  }
}